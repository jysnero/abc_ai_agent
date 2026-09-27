/**
 * 실제 API 모드(CLI production) 요청 설정 및 단계별 요청 수 검증
 * 전송 계층(global.fetch)만 Mock — 실제 네트워크 요청 없음
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { loadDesignContext } from "../../src/workflow/platform-template.js";
import { initializeWorkspace } from "../../src/workflow/save-generated-code.js";
import { createCliDependencies } from "../../src/cli/composition.js";
import { toExternalAgentMode } from "../../src/cli/output/formatter.js";
import { ClaudeAgentClient } from "../../src/runtime/claude-agent-client.js";
import { FakeAgentClient } from "../../src/runtime/fake-agent-client.js";
import { buildExecutionPlan } from "../../src/builders/plan-builder.js";
import { parseFileSections, type DeveloperAgent } from "../../src/agents/developer.js";

const contractText = fs.readFileSync(
  path.resolve("contracts/examples/ox-quiz-browser-contract.json"),
  "utf-8"
);
const plan = buildExecutionPlan(JSON.parse(contractText));

type Reply = { status?: number; text?: string; stop_reason?: string };

let requests: Array<{ model: string; max_tokens: number }> = [];
let originalFetch: typeof fetch;
let originalKey: string | undefined;

function installFetch(replies: Reply[]) {
  let i = 0;
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    const body = JSON.parse(String(init?.body ?? "{}"));
    requests.push({ model: body.model, max_tokens: body.max_tokens });
    const r = replies[Math.min(i++, replies.length - 1)];
    if (r.status && r.status !== 200) {
      return new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: "mock" } }), {
        status: r.status,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({
        id: "msg_mock",
        type: "message",
        role: "assistant",
        model: body.model,
        content: [{ type: "text", text: r.text ?? "" }],
        stop_reason: r.stop_reason ?? "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 20 },
      }),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  }) as typeof fetch;
}

const allTargets = ["src/App.tsx", "src/types.ts"].map((f) => `### File: ${f}\n\`\`\`tsx\nexport {};\n\`\`\`\n`).join("\n");
const testReply = "### Test: tests/Quiz.test.tsx\n```tsx\nexport {};\n```";

function agent(): DeveloperAgent {
  return (createCliDependencies(false, { singleTrial: true }).workflowRunner as any).developerAgent as DeveloperAgent;
}

describe("Production agent config (CLI real-API mode)", () => {
  beforeEach(() => {
    requests = [];
    originalFetch = globalThis.fetch;
    originalKey = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "test-dummy-key";
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalKey === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it("--single-trial: timeout 180000 / app retry 0 / SDK retry 0 / repair 0", () => {
    const deps = createCliDependencies(false, { singleTrial: true });
    const dev = (deps.workflowRunner as any).developerAgent as DeveloperAgent;
    assert.deepEqual(dev.getEffectiveConfig(), {
      model: "claude-opus-5-5",
      max_tokens: 8192,
      timeout_ms: 180000,
      app_max_retries: 0,
      sdk_max_retries: 0,
    });
    assert.equal(deps.workflowRunner.getMaxRepairAttempts(), 0);
  });

  it("general production policy unchanged: timeout 60000 / app retry 3 / SDK retry 0 / repair 3", () => {
    const deps = createCliDependencies(false);
    const dev = (deps.workflowRunner as any).developerAgent as DeveloperAgent;
    assert.deepEqual(dev.getEffectiveConfig(), {
      model: "claude-opus-5-5",
      max_tokens: 8192,
      timeout_ms: 60000,
      app_max_retries: 3,
      sdk_max_retries: 0,
    });
    assert.equal(deps.workflowRunner.getMaxRepairAttempts(), 3);
  });

  it("agent_mode display matches injected client", () => {
    const real = createCliDependencies(false, { singleTrial: true });
    const fake = createCliDependencies(true);
    const clientOf = (d: ReturnType<typeof createCliDependencies>) => ((d.workflowRunner as any).developerAgent as any).client;
    assert.ok(clientOf(real) instanceof ClaudeAgentClient);
    assert.equal(toExternalAgentMode(real.agentMode), "claude");
    assert.ok(clientOf(fake) instanceof FakeAgentClient);
    assert.equal(toExternalAgentMode(fake.agentMode), "fake");
  });

  it("plan: Agent generates only non-platform files", () => {
    assert.deepEqual(plan.target_files, ["src/App.tsx", "src/types.ts", "tests/Quiz.test.tsx"]);
    for (const f of ["package.json", "tsconfig.json", "demo/index.html"]) {
      assert.ok(plan.platform_files?.includes(f), `${f} should be platform-provided`);
    }
  });

  it("success path: 3 requests (1 per step) with model/max_tokens in request body", async () => {
    installFetch([{ text: allTargets }, { text: testReply }, { text: "{}" }]);
    const result = await agent().executeByPlan(plan, contractText);
    assert.equal(result.status, "success");
    assert.equal(requests.length, 3);
    assert.deepEqual(Object.keys(result.generatedCode).sort(), ["src/App.tsx", "src/types.ts"]);
    assert.deepEqual(Object.keys(result.testCode), ["tests/Quiz.test.tsx"]);
    assert.equal(result.generatedCode["src/App.tsx"], "export {};\n", "code fence must be stripped");
    assert.deepEqual(result.steps.map((s) => s.step), ["generateCode", "generateTests", "selfValidate"]);
    for (const r of requests) assert.deepEqual(r, { model: "claude-opus-5-5", max_tokens: 8192 });
  });

  it("HTTP error at step 1: exactly 1 request, no retry, later steps not called", async () => {
    installFetch([{ status: 500 }]);
    const result = await agent().executeByPlan(plan, contractText);
    assert.equal(result.status, "failure");
    assert.equal(requests.length, 1);
    assert.equal(result.steps.length, 1);
    assert.equal(result.steps[0].outcome, "error");
  });

  it("stop_reason=max_tokens at step 1: stops after 1 request, raw text/usage preserved", async () => {
    installFetch([{ text: "### File: src/App.tsx\npartial", stop_reason: "max_tokens" }]);
    const result = await agent().executeByPlan(plan, contractText);
    assert.equal(result.status, "failure");
    assert.equal(requests.length, 1);
    assert.equal(result.steps[0].outcome, "incomplete");
    assert.equal(result.steps[0].raw?.stop_reason, "max_tokens");
    assert.equal(result.steps[0].raw?.text, "### File: src/App.tsx\npartial");
    assert.deepEqual(result.steps[0].raw?.usage, { input_tokens: 10, output_tokens: 20 });
  });

  it("missing target file at step 1: stops before step 2", async () => {
    installFetch([{ text: "### File: src/App.tsx\nexport default function App() { return null; }" }]);
    const result = await agent().executeByPlan(plan, contractText);
    assert.equal(result.status, "failure");
    assert.equal(requests.length, 1);
    assert.equal(result.steps[0].outcome, "incomplete");
  });

  it("step 2 missing its test file: stops before step 3", async () => {
    installFetch([{ text: allTargets }, { text: "### Test: tests/Other.test.tsx\nexport {};" }]);
    const result = await agent().executeByPlan(plan, contractText);
    assert.equal(result.status, "failure");
    assert.equal(requests.length, 2);
    assert.deepEqual(result.steps.map((s) => s.outcome), ["ok", "incomplete"]);
  });

  it("unterminated extra section with end_turn: step is incomplete, not success-with-file-dropped", async () => {
    installFetch([{ text: `${allTargets}\n### File: src/extra.ts\n\`\`\`ts\nexport const x = (` }]);
    const result = await agent().executeByPlan(plan, contractText);
    assert.equal(result.status, "failure");
    assert.equal(requests.length, 1);
    assert.equal(result.steps[0].outcome, "incomplete");
    assert.match(result.steps[0].error ?? "", /unterminated code block: src\/extra\.ts/);
  });

  it("prompts carry approved spec, UI guide and design tokens; prompts are recorded per step", async () => {
    installFetch([{ text: allTargets }, { text: testReply }, { text: "{}" }]);
    const design = loadDesignContext("design/tokens.json");
    assert.ok(design?.uiGuide, "UI guide should be resolved from tokens $meta.guide");
    const spec = JSON.stringify({ requirements: [{ id: "REQ-TEST-01", text: "sample requirement" }] });
    const result = await agent().executeByPlan(plan, contractText, {
      requestSpec: spec,
      uiGuide: design!.uiGuide,
      designTokens: design!.designTokens,
    });
    assert.equal(result.status, "success");
    const [code, tests, validate] = result.steps.map((s) => s.prompt.user);
    assert.ok(code.includes("REQ-TEST-01") && code.includes("## UI Guide") && code.includes("#09862B"));
    assert.ok(tests.includes("REQ-TEST-01") && tests.includes("NOT against whatever the generated code currently does"));
    assert.ok(validate.includes("REQ-TEST-01"));
  });

  it("design tokens are rendered into the platform demo page", () => {
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), "tokens-ws-"));
    try {
      initializeWorkspace(ws, "browser_component", fs.readFileSync("design/tokens.json", "utf-8"));
      const html = fs.readFileSync(path.join(ws, "demo/index.html"), "utf-8");
      assert.ok(html.includes("--color-primary: #09862B;"));
      assert.ok(html.includes('"primary":"var(--color-primary)"'));
      assert.ok(!html.includes("__DESIGN_TOKENS_CSS__") && !html.includes("__TAILWIND_CONFIG__"));
    } finally {
      fs.rmSync(ws, { recursive: true, force: true });
    }
  });

  it("parser: strips wrapping fence, excludes unterminated (truncated) section", () => {
    const { files, unterminated } = parseFileSections(
      "### File: a.ts\n```ts\nconst a = 1;\n```\n\n### File: b.ts\n```ts\nconst b = ("
    );
    assert.deepEqual(files, { "a.ts": "const a = 1;\n" });
    assert.deepEqual(unterminated, ["b.ts"]);
  });

  it("incomplete response at step 2: 2 requests total, step 3 not called", async () => {
    installFetch([{ text: allTargets }, { text: "### Test: tests/X.test.tsx\npart", stop_reason: "max_tokens" }]);
    const result = await agent().executeByPlan(plan, contractText);
    assert.equal(result.status, "failure");
    assert.equal(requests.length, 2);
    assert.deepEqual(result.steps.map((s) => s.outcome), ["ok", "incomplete"]);
  });
});
