/**
 * 생성 단위 모드 (Fake 응답, API 호출 없음)
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { WorkflowRunner } from "../../src/workflow/workflow-runner.js";
import { AgentOrchestrator } from "../../src/orchestrator.js";
import { DeveloperAgent } from "../../src/agents/developer.js";
import { FakeValidationRunner } from "../../src/validation/fake-validation-runner.js";
import { initializeRun, saveArtifact, loadManifest } from "../../src/storage/run-storage.js";
import { validateGenerationPlan, parseGenerationPlan } from "../../src/workflow/generation-plan.js";
import type { ChatOptions } from "../../src/runtime/agent-client.js";

const sha = (s: string) => "sha256:" + createHash("sha256").update(s).digest("hex");
const SOURCE_RUN = "run-00000000-0000-4000-8000-00000000aaaa";
const TYPES = "export interface Item { id: string; label: string }\n";

const spec = JSON.stringify({
  type: "webview-component",
  name: "unit fixture",
  requirement: {
    rules: { core: "CORE-RULE-SENTINEL: one shared store owns submissions" },
    requirements: [
      { id: "REQ-A", text: "list", acceptance: "ACCEPT-A-SENTINEL" },
      { id: "REQ-B", text: "view", acceptance: "ACCEPT-B-SENTINEL" },
    ],
  },
});

const contract = JSON.stringify({
  contract_id: "req-fixture-units",
  version: "1.0.0",
  pattern_type: "browser_component",
  issued_by: "architect_agent",
  folder_structure: {
    required_files: ["src/types.ts", "src/lib.ts", "src/App.tsx", "tests/App.test.tsx", "package.json", "tsconfig.json", "demo/index.html"],
    allowed_globs: ["src/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}", "demo/**/*", "*.json"],
  },
  allowed_dependencies: { script_hosts: [], npm_packages: [] },
  bridge_contract_ref: { contract_id: "none", path: "" },
  bridge_policy: {},
  forbidden_patterns: [],
  design_tokens_ref: "",
});

function genPlan(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    version: 1,
    interface_contract: "INTERFACE-CONTRACT-SENTINEL: lib exports makeItems(): Item[]",
    reused_files: [
      { path: "src/types.ts", source_run: SOURCE_RUN, source_artifact: "developer-result-initial", source_step: "generateCode", sha256: sha(TYPES) },
    ],
    units: [
      { id: "lib", kind: "source", files: ["src/lib.ts"], depends_on: [], context_files: ["src/types.ts"], requirements: ["REQ-A"], include_ui_guide: false, instructions: "lib" },
      { id: "view", kind: "source", files: ["src/App.tsx"], depends_on: ["lib"], context_files: ["src/types.ts", "src/lib.ts"], requirements: ["REQ-B"], include_ui_guide: false, instructions: "view" },
      { id: "tests", kind: "test", files: ["tests/App.test.tsx"], depends_on: ["lib", "view"], context_files: ["src/lib.ts", "src/App.tsx"], requirements: ["REQ-A", "REQ-B"], include_ui_guide: false, instructions: "tests" },
    ],
    ...overrides,
  });
}

const limits = JSON.stringify({
  model: "claude-opus-5-5", app_max_retries: 0, sdk_max_retries: 0, max_repair_attempts: 0, max_logical_calls: 3,
  stop_on_first_error: true,
  units: { lib: { max_tokens: 1000, timeout_ms: 1000 }, view: { max_tokens: 2000, timeout_ms: 2000 }, tests: { max_tokens: 3000, timeout_ms: 3000 } },
});

const LIB = 'import type { Item } from "./types";\nexport function makeItems(): Item[] { return [{ id: "1", label: "a" }]; }\n';
const APP = 'import { makeItems } from "./lib";\nexport default function App() { return <ul>{makeItems().map((i) => <li key={i.id}>{i.label}</li>)}</ul>; }\n';
const TEST = 'import { it, expect } from "vitest";\nit("REQ-A: ok", () => { expect(1).toBe(1); });\n';
const reply = (files: Record<string, string>) =>
  Object.entries(files).map(([f, c]) => `### File: ${f}\n\`\`\`tsx\n${c}\`\`\``).join("\n\n");

type Reply = { content: string; stop_reason?: "end_turn" | "max_tokens" };
function scriptedClient(replies: Reply[]) {
  const calls: { user: string; options: ChatOptions }[] = [];
  return {
    calls,
    async chat(messages: { content: string }[], _s: string, options: ChatOptions) {
      calls.push({ user: messages[0].content, options });
      const r = replies[calls.length - 1];
      if (!r) throw new Error("unexpected extra call");
      return { content: r.content, stop_reason: r.stop_reason ?? ("end_turn" as const), usage: { input_tokens: 1, output_tokens: 1 } };
    },
  };
}

class CountingValidation extends FakeValidationRunner {
  runs = 0;
  async runSuite(ids: string[], checksum?: string) {
    this.runs++;
    return super.runSuite(ids, checksum);
  }
}

let root: string;
let prev: string | undefined;

async function setupSourceRun() {
  await initializeRun(SOURCE_RUN, JSON.stringify({ fixture: true }));
  await saveArtifact(SOURCE_RUN, "developer-result-initial", JSON.stringify({
    steps: [{ step: "generateCode", raw: { text: `### File: src/types.ts\n\`\`\`ts\n${TYPES}\`\`\`\n\n### File: src/App.tsx\n\`\`\`tsx\nexport default fun` } }],
  }));
}

async function startApproved(runner: WorkflowRunner, planJson = genPlan()) {
  const runId = await runner.startRun({ requestSpec: spec, architectureContract: contract, executionLimits: limits, generationPlan: planJson });
  await runner.submitSpecApproval(runId, { approver: "t" });
  return runId;
}

const runDir = (id: string) => path.join(process.env.TEST_RUN_DIR!, id);

describe("Generation units (fake responses)", () => {
  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "units-"));
    prev = process.env.TEST_RUN_DIR;
    process.env.TEST_RUN_DIR = path.join(root, "runs");
    fs.mkdirSync(process.env.TEST_RUN_DIR, { recursive: true });
    await setupSourceRun();
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.TEST_RUN_DIR;
    else process.env.TEST_RUN_DIR = prev;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("full run: outputs chain into later prompts, per-unit limits apply, validation runs once, then release gate", async () => {
    const client = scriptedClient([
      { content: reply({ "src/lib.ts": LIB }) },
      { content: reply({ "src/App.tsx": APP }) },
      { content: reply({ "tests/App.test.tsx": TEST }) },
    ]);
    const validation = new CountingValidation([{ checkId: "build", status: "passed" }, { checkId: "test", status: "passed" }, { checkId: "architecture-check", status: "passed" }]);
    const runner = new WorkflowRunner(new AgentOrchestrator(), new DeveloperAgent({ client }), validation, { maxRepairAttempts: 3 });
    const runId = await startApproved(runner);
    await runner.resumeRun(runId);

    assert.equal(client.calls.length, 3);
    // 앞 단계 산출물·재사용 파일·공통 규칙·계약·해당 요구사항이 다음 단계 입력에 정확히 포함
    const [p1, p2, p3] = client.calls.map((c) => c.user);
    assert.ok(p1.includes(TYPES.trim()), "reused types in unit 1");
    assert.ok(p2.includes(LIB.trim()), "unit 1 output in unit 2 prompt");
    assert.ok(p3.includes(APP.trim()) && p3.includes(LIB.trim()), "sources in test prompt");
    for (const p of [p1, p2, p3]) {
      assert.ok(p.includes("CORE-RULE-SENTINEL") && p.includes("INTERFACE-CONTRACT-SENTINEL"));
    }
    assert.ok(p1.includes("ACCEPT-A-SENTINEL") && !p1.includes("ACCEPT-B-SENTINEL"));
    assert.ok(p2.includes("ACCEPT-B-SENTINEL"));
    assert.ok(p3.includes("ACCEPT-A-SENTINEL") && p3.includes("ACCEPT-B-SENTINEL") && p3.includes("NOT against whatever"));
    assert.deepEqual(client.calls.map((c) => [c.options.max_tokens, c.options.timeout_ms, c.options.max_retries]), [[1000, 1000, 0], [2000, 2000, 0], [3000, 3000, 0]]);

    assert.equal(validation.runs, 1, "workspace validation only after all units");
    assert.equal((await loadManifest(runId)).status, "HUMAN_GATE_RELEASE");
    const ws = path.join(root, "workspace", runId);
    assert.equal(fs.readFileSync(path.join(ws, "src/lib.ts"), "utf-8"), LIB);
    assert.equal(fs.readFileSync(path.join(ws, "src/types.ts"), "utf-8"), TYPES, "reused file saved");
    for (const u of ["lib", "view", "tests"]) {
      assert.ok(fs.existsSync(path.join(runDir(runId), "units", `${u}-response.json`)));
      assert.ok(fs.existsSync(path.join(runDir(runId), "units", `${u}-passed.json`)));
    }
  });

  it("truncated middle unit: no later call, earlier checkpoint kept, no validation, no release gate", async () => {
    const client = scriptedClient([
      { content: reply({ "src/lib.ts": LIB }) },
      { content: "### File: src/App.tsx\n```tsx\nexport default function App() { return (", stop_reason: "max_tokens" },
    ]);
    const validation = new CountingValidation([]);
    const runner = new WorkflowRunner(new AgentOrchestrator(), new DeveloperAgent({ client }), validation, { maxRepairAttempts: 3 });
    const runId = await startApproved(runner);
    await assert.rejects(runner.resumeRun(runId), /incomplete response/);

    assert.equal(client.calls.length, 2, "tests unit never called");
    assert.equal(validation.runs, 0);
    assert.equal((await loadManifest(runId)).status, "NEEDS_HUMAN_REVIEW");
    const units = path.join(runDir(runId), "units");
    assert.ok(fs.existsSync(path.join(units, "lib-passed.json")), "completed unit preserved");
    const failed = JSON.parse(fs.readFileSync(path.join(units, "view-failed.json"), "utf-8"));
    assert.equal(failed.record.raw.stop_reason, "max_tokens");
    assert.ok(failed.record.raw.text.includes("export default function App()"), "raw text preserved");
    assert.ok(!fs.existsSync(path.join(units, "view-passed.json")));
    assert.ok(!fs.existsSync(path.join(root, "workspace", runId)), "nothing saved to the workspace");
  });

  it("only designated files: an extra file stops the run", async () => {
    const client = scriptedClient([{ content: reply({ "src/lib.ts": LIB, "src/extra.ts": "export const x = 1;\n" }) }]);
    const runner = new WorkflowRunner(new AgentOrchestrator(), new DeveloperAgent({ client }), new CountingValidation([]), { maxRepairAttempts: 3 });
    const runId = await startApproved(runner);
    await assert.rejects(runner.resumeRun(runId), /unexpected files .*src\/extra\.ts/);
    assert.equal(client.calls.length, 1);
    assert.ok(fs.existsSync(path.join(runDir(runId), "units", "lib-response.json")), "raw saved before parsing");
  });

  it("import to a later unit is pending, import to an unplanned file or package is an error, syntax errors stop", async () => {
    const pendingOk = scriptedClient([
      { content: reply({ "src/lib.ts": 'import type {} from "./App";\n' + LIB }) },
      { content: reply({ "src/App.tsx": APP }) },
      { content: reply({ "tests/App.test.tsx": TEST }) },
    ]);
    const r1 = new WorkflowRunner(new AgentOrchestrator(), new DeveloperAgent({ client: pendingOk }), new CountingValidation([{ checkId: "build", status: "passed" }]), { maxRepairAttempts: 0 });
    const id1 = await startApproved(r1);
    await r1.resumeRun(id1);
    const passed = JSON.parse(fs.readFileSync(path.join(runDir(id1), "units", "lib-passed.json"), "utf-8"));
    assert.deepEqual(passed.checks[0].pending_imports, ["src/App.tsx"]);

    for (const [bad, pattern] of [
      ['import { x } from "./nowhere";\n' + LIB, /not a planned file/],
      ['import axios from "axios";\n' + LIB, /package not provided/],
      ["export function makeItems( {\n", /syntax/],
    ] as const) {
      const client = scriptedClient([{ content: reply({ "src/lib.ts": bad }) }]);
      const r = new WorkflowRunner(new AgentOrchestrator(), new DeveloperAgent({ client }), new CountingValidation([]), { maxRepairAttempts: 0 });
      const id = await startApproved(r);
      await assert.rejects(r.resumeRun(id), pattern);
      assert.equal(client.calls.length, 1);
    }
  });

  it("reused file must match its declared checksum in the source run", async () => {
    const bad = JSON.parse(genPlan());
    bad.reused_files[0].sha256 = "sha256:" + "0".repeat(64);
    const runner = new WorkflowRunner(new AgentOrchestrator(), new DeveloperAgent({ client: scriptedClient([]) }), new CountingValidation([]));
    await assert.rejects(
      runner.startRun({ requestSpec: spec, architectureContract: contract, executionLimits: limits, generationPlan: JSON.stringify(bad) }),
      /checksum mismatch/
    );
  });

  it("generation plan and reused files are part of the approval target", async () => {
    const runner = new WorkflowRunner(new AgentOrchestrator(), new DeveloperAgent({ client: scriptedClient([]) }), new CountingValidation([]));
    const runId = await runner.startRun({ requestSpec: spec, architectureContract: contract, executionLimits: limits, generationPlan: genPlan() });
    const comps = (await loadManifest(runId)).approval_targets!.spec!.components;
    assert.ok(comps.generation_plan && comps.reused_files);
  });

  it("plan validation catches uncovered requirements, foreign context files and missing unit limits", () => {
    const plan = parseGenerationPlan(genPlan());
    plan.units[0].requirements = [];
    plan.units[1].context_files.push("src/unknown.ts");
    const errs = validateGenerationPlan(plan, ["src/types.ts", "src/lib.ts", "src/App.tsx", "tests/App.test.tsx"], ["REQ-A", "REQ-B"], {
      model: "m", app_max_retries: 0, sdk_max_retries: 0, max_repair_attempts: 0, max_logical_calls: 2, stop_on_first_error: true, units: { lib: { max_tokens: 1, timeout_ms: 1 } },
    });
    assert.ok(errs.some((e) => e.includes("REQ-A is not assigned to any source unit")));
    assert.ok(errs.some((e) => e.includes("src/unknown.ts")));
    assert.ok(errs.some((e) => e.includes("no limit for unit view")));
    assert.ok(errs.some((e) => e.includes("max_logical_calls")));
  });
});
