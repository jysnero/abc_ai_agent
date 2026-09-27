/**
 * SPEC 승인 대상: 디자인 스냅샷·실행 한도 결합, 기대 checksum 검증, 승인 후 변경 차단, run 한도 적용
 * (API 호출 없음)
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { WorkflowRunner } from "../../src/workflow/workflow-runner.js";
import { AgentOrchestrator } from "../../src/orchestrator.js";
import { DeveloperAgent } from "../../src/agents/developer.js";
import { FakeValidationRunner } from "../../src/validation/fake-validation-runner.js";
import { loadManifest, computeApprovalTargetChecksum } from "../../src/storage/run-storage.js";
import type { ChatOptions } from "../../src/runtime/agent-client.js";

const spec = fs.readFileSync("tests/fixtures/approval/request-spec.json", "utf-8");
const contract = fs.readFileSync("tests/fixtures/approval/contract.json", "utf-8");
const limits = fs.readFileSync("config/execution-limits/stock-prediction-trial.json", "utf-8");

let root: string;
let prev: string | undefined;

class CountingDeveloper {
  calls = 0;
  lastContext: any = null;
  async executeByPlan(_plan: unknown, _contract: string, context: unknown) {
    this.calls++;
    this.lastContext = context;
    throw new Error("stop here (test)");
  }
}

function runner(dev: unknown) {
  return new WorkflowRunner(new AgentOrchestrator(), dev as DeveloperAgent, new FakeValidationRunner([]), {
    maxRepairAttempts: 3,
  });
}

describe("SPEC approval target", () => {
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "approval-"));
    prev = process.env.TEST_RUN_DIR;
    process.env.TEST_RUN_DIR = path.join(root, "runs");
    fs.mkdirSync(process.env.TEST_RUN_DIR, { recursive: true });
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.TEST_RUN_DIR;
    else process.env.TEST_RUN_DIR = prev;
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("includes design snapshots and execution limits in the target checksum", async () => {
    const r = runner(new CountingDeveloper());
    const runId = await r.startRun({ requestSpec: spec, architectureContract: contract, executionLimits: limits });
    const m = await loadManifest(runId);
    const comps = m.approval_targets!.spec!.components;
    assert.deepEqual(Object.keys(comps).sort(), [
      "architecture_contract", "design_tokens", "execution_limits", "execution_plan", "request_spec", "ui_guide",
    ]);
    assert.equal(m.approval_targets!.spec!.checksum, computeApprovalTargetChecksum(comps));
    for (const f of ["design-tokens.v1.json", "ui-guide.v1.json", "execution-limits.v1.json"]) {
      assert.ok(fs.existsSync(path.join(process.env.TEST_RUN_DIR!, runId, f)), `${f} snapshot`);
    }
  });

  it("rejects approval when --expected-checksum does not match", async () => {
    const r = runner(new CountingDeveloper());
    const runId = await r.startRun({ requestSpec: spec, architectureContract: contract, executionLimits: limits });
    await assert.rejects(
      r.submitSpecApproval(runId, { approver: "t", expectedChecksum: "sha256:" + "0".repeat(64) }),
      /Expected checksum does not match/
    );
    assert.equal((await loadManifest(runId)).spec_approval, undefined);
  });

  it("changing a design snapshot after approval blocks resume before any generation", async () => {
    const dev = new CountingDeveloper();
    const r = runner(dev);
    const runId = await r.startRun({ requestSpec: spec, architectureContract: contract, executionLimits: limits });
    const target = (await loadManifest(runId)).approval_targets!.spec!.checksum;
    await r.submitSpecApproval(runId, { approver: "t", expectedChecksum: target });

    fs.appendFileSync(path.join(process.env.TEST_RUN_DIR!, runId, "ui-guide.v1.json"), "\n변경");
    await assert.rejects(r.resumeRun(runId), /checksum mismatch for ui_guide/);
    const m = await loadManifest(runId);
    assert.equal(m.status, "HUMAN_GATE_SPEC");
    assert.equal(m.spec_approval, undefined);
    assert.equal(dev.calls, 0, "developer must not be called");
  });

  it("resume passes the approved snapshots, spec and run limits to the developer", async () => {
    const dev = new CountingDeveloper();
    const r = runner(dev);
    const runId = await r.startRun({ requestSpec: spec, architectureContract: contract, executionLimits: limits });
    await r.submitSpecApproval(runId, { approver: "t" });
    await assert.rejects(r.resumeRun(runId));
    const dir = path.join(process.env.TEST_RUN_DIR!, runId);
    assert.equal(dev.lastContext.requestSpec, fs.readFileSync(path.join(dir, "request-spec.v1.json"), "utf-8"));
    assert.equal(dev.lastContext.uiGuide, fs.readFileSync(path.join(dir, "ui-guide.v1.json"), "utf-8"));
    assert.equal(dev.lastContext.designTokens, fs.readFileSync(path.join(dir, "design-tokens.v1.json"), "utf-8"));
    assert.equal(dev.lastContext.limits.steps.generateCode.max_tokens, 24000);
    const cfg = JSON.parse(fs.readFileSync(path.join(dir, "execution-config.v1.json"), "utf-8"));
    assert.equal(cfg.max_repair_attempts, 0, "run limits override the runner's repair policy");
  });

  it("developer applies per-step limits and the logical call cap", async () => {
    const seen: ChatOptions[] = [];
    const replies = [
      "### File: src/App.tsx\nexport {};\n### File: src/types.ts\nexport {};\n### File: src/data/sampleData.ts\nexport {};",
      "### Test: tests/App.test.tsx\nexport {};",
      "{}",
    ];
    const client = {
      async chat(_m: unknown, _s: unknown, options: ChatOptions) {
        seen.push(options);
        return { content: replies[seen.length - 1], stop_reason: "end_turn" as const, usage: { input_tokens: 1, output_tokens: 1 } };
      },
    };
    const dev = new DeveloperAgent({ client });
    const { buildExecutionPlan } = await import("../../src/builders/plan-builder.js");
    const { parseExecutionLimits } = await import("../../src/workflow/execution-limits.js");
    const result = await dev.executeByPlan(buildExecutionPlan(JSON.parse(contract)), contract, {
      requestSpec: spec,
      limits: parseExecutionLimits(limits),
    });
    assert.equal(result.status, "success");
    assert.deepEqual(
      seen.map((o) => [o.max_tokens, o.timeout_ms, o.max_retries, o.model]),
      [
        [24000, 360000, 0, "claude-opus-5-5"],
        [12000, 360000, 0, "claude-opus-5-5"],
        [4000, 180000, 0, "claude-opus-5-5"],
      ]
    );
  });

  it("rejects invalid execution limits (sdk retry must be 0)", async () => {
    const r = runner(new CountingDeveloper());
    const bad = JSON.stringify({ ...JSON.parse(limits), sdk_max_retries: 2 });
    await assert.rejects(r.startRun({ requestSpec: spec, architectureContract: contract, executionLimits: bad }), /sdk_max_retries/);
  });
});
