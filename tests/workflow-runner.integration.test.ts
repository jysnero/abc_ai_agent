/**
 * Workflow Runner Integration Tests (A~F)
 *
 * FakeValidationRunner를 사용한 workflow 통합 테스트
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { WorkflowRunner } from "../src/workflow/workflow-runner.js";
import { AgentOrchestrator } from "../src/orchestrator.js";
import { DeveloperAgent } from "../src/agents/developer.js";
import { FakeAgentClient, FakeScenario } from "../src/runtime/fake-agent-client.js";
import { FakeValidationRunner } from "../src/validation/fake-validation-runner.js";

let testIndex = 0;

const mockArchitectureContract = JSON.stringify({
  contract_id: "test-contract-v1",
  version: "1.0.0",
  pattern_type: "minigame-shell",
  issued_by: "test",
  folder_structure: {
    required_files: ["src/main.ts"],
    allowed_globs: ["src/**/*.ts", "tests/**/*.ts"],
  },
  allowed_dependencies: { script_hosts: [], npm_packages: [] },
  bridge_contract_ref: { contract_id: "bridge", path: "./bridge.json" },
  bridge_policy: {},
  forbidden_patterns: [],
  design_tokens_ref: "tokens.json",
});

function createRequestSpec(scenario: string) {
  return JSON.stringify({
    topic: "Test Service",
    target: `scenario-${scenario}`,
    requirements: `Scenario ${scenario}`,
  });
}

beforeEach(async () => {
  testIndex++;
  const tempDir = path.join(process.cwd(), `.test-workflow-${testIndex}-tmp`);
  process.env.TEST_RUN_DIR = tempDir;

  try {
    await fs.rm(tempDir, { recursive: true, force: true });
  } catch {}
  await fs.mkdir(tempDir, { recursive: true });
});

afterEach(async () => {
  const tempDir = process.env.TEST_RUN_DIR;
  delete process.env.TEST_RUN_DIR;

  if (tempDir) {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {}
  }
});

describe("Workflow Runner Integration Tests (with FakeValidationRunner)", () => {
  describe("Scenario A: Normal Success - validation passes", () => {
    it("should complete PLANNING → RELEASE_READY with passing validation", async () => {
      const orchestrator = new AgentOrchestrator();
      const devClient = new FakeAgentClient(FakeScenario.SUCCESS);
      const developerAgent = new DeveloperAgent({ client: devClient });

      // Validation: passed (첫 시도)
      const validationRunner = new FakeValidationRunner([
        { checkId: "typecheck", status: "passed" },
        { checkId: "build", status: "passed" },
      ]);

      const runner = new WorkflowRunner(orchestrator, developerAgent, validationRunner);

      const runId = await runner.startRun({
        requestSpec: createRequestSpec("a"),
        architectureContract: mockArchitectureContract,
      });

      let status = await runner.getRunStatus(runId);
      assert.equal(status.status, "HUMAN_GATE_SPEC");

      await runner.resumeAfterSpecApproval(runId, { approver: "architect" });

      status = await runner.getRunStatus(runId);
      assert.equal(status.status, "HUMAN_GATE_RELEASE");

      await runner.resumeAfterReleaseApproval(runId, { approver: "lead" });

      status = await runner.getRunStatus(runId);
      assert.equal(status.status, "RELEASE_READY");
    });
  });

  describe("Scenario B: Repair Success - 1 failure then pass", () => {
    it("should auto-repair after initial validation failure", async () => {
      const orchestrator = new AgentOrchestrator();
      const devClient = new FakeAgentClient(FakeScenario.SUCCESS);
      const developerAgent = new DeveloperAgent({ client: devClient });

      // Validation: fail, then pass (repair succeeds)
      const validationRunner = new FakeValidationRunner([
        { checkId: "typecheck", status: "failed", stderr: "Type error" },
        { checkId: "build", status: "failed" },
        // After repair attempt 1: pass
        { checkId: "typecheck", status: "passed" },
        { checkId: "build", status: "passed" },
      ]);

      const runner = new WorkflowRunner(orchestrator, developerAgent, validationRunner);

      const runId = await runner.startRun({
        requestSpec: createRequestSpec("b"),
        architectureContract: mockArchitectureContract,
      });

      // Spec approval triggers dev + validation + repair
      await runner.resumeAfterSpecApproval(runId, { approver: "architect" });

      const status = await runner.getRunStatus(runId);
      // Should be at HUMAN_GATE_RELEASE (repair succeeded)
      assert.equal(status.status, "HUMAN_GATE_RELEASE");
    });
  });

  describe("Scenario C: Repair Exhaustion - 3 failures", () => {
    it("should transition to NEEDS_HUMAN_REVIEW after max repair attempts", async () => {
      const orchestrator = new AgentOrchestrator();
      const devClient = new FakeAgentClient(FakeScenario.SUCCESS);
      const developerAgent = new DeveloperAgent({ client: devClient });

      // Validation: initial + 3 repairs all fail
      const validationRunner = new FakeValidationRunner([
        { checkId: "typecheck", status: "failed" },
        { checkId: "build", status: "failed" },
        // Repair 1: fail
        { checkId: "typecheck", status: "failed" },
        { checkId: "build", status: "failed" },
        // Repair 2: fail
        { checkId: "typecheck", status: "failed" },
        { checkId: "build", status: "failed" },
        // Repair 3: fail
        { checkId: "typecheck", status: "failed" },
        { checkId: "build", status: "failed" },
      ]);

      const runner = new WorkflowRunner(orchestrator, developerAgent, validationRunner);

      const runId = await runner.startRun({
        requestSpec: createRequestSpec("c"),
        architectureContract: mockArchitectureContract,
      });

      let error;
      try {
        await runner.resumeAfterSpecApproval(runId, { approver: "architect" });
      } catch (e) {
        error = e;
      }

      assert.ok(error, "Should throw after max repairs");
      assert.ok((error as Error).message.includes("3 repair attempts"));

      const status = await runner.getRunStatus(runId);
      assert.equal(status.status, "NEEDS_HUMAN_REVIEW");
    });
  });

  describe("Scenario D: Artifact Coverage", () => {
    it("should save all required artifacts", async () => {
      const orchestrator = new AgentOrchestrator();
      const devClient = new FakeAgentClient(FakeScenario.SUCCESS);
      const developerAgent = new DeveloperAgent({ client: devClient });
      const validationRunner = new FakeValidationRunner([
        { checkId: "typecheck", status: "passed" },
        { checkId: "build", status: "passed" },
      ]);

      const runner = new WorkflowRunner(orchestrator, developerAgent, validationRunner);

      const runId = await runner.startRun({
        requestSpec: createRequestSpec("d"),
        architectureContract: mockArchitectureContract,
      });

      let status = await runner.getRunStatus(runId);
      assert.ok(status.artifacts.requestSpec);
      assert.ok(status.artifacts.architectureContract);
      assert.ok(status.artifacts.executionPlan);

      // Capture resumeAfterSpecApproval execution details
      let resumeResolved = false;
      let resumeError: Error | undefined;

      try {
        await runner.resumeAfterSpecApproval(runId, { approver: "architect" });
        resumeResolved = true;
      } catch (error) {
        resumeError = error as Error;
        // Output exception details to stderr for debugging
        process.stderr.write(
          "=== SCENARIO D: resumeAfterSpecApproval EXCEPTION ===\n" +
          JSON.stringify(
            {
              type: error instanceof Error ? error.constructor.name : typeof error,
              message: error instanceof Error ? error.message : String(error),
              stack: error instanceof Error ? error.stack : undefined,
            },
            null,
            2
          ) +
          "\n"
        );
      }

      status = await runner.getRunStatus(runId);

      // Debug: Log actual artifact state
      process.stderr.write(
        "=== SCENARIO D: POST-RESUME STATUS ===\n" +
        JSON.stringify(
          {
            resumeResolved,
            resumeError: resumeError ? resumeError.message : null,
            status: status.status,
            artifacts: {
              developerResult: status.artifacts.developerResult ? "✓" : "✗",
              validationReport: status.artifacts.validationReport ? "✓" : "✗",
            },
          },
          null,
          2
        ) +
        "\n"
      );

      assert.ok(status.artifacts.developerResult);
      assert.ok(status.artifacts.validationReport);
    });
  });

  describe("Scenario E: Checkpoint Recovery", () => {
    it("should restore state from persisted artifacts", async () => {
      const orchestrator = new AgentOrchestrator();
      const devClient = new FakeAgentClient(FakeScenario.SUCCESS);
      const developerAgent = new DeveloperAgent({ client: devClient });
      const validationRunner = new FakeValidationRunner([
        { checkId: "typecheck", status: "passed" },
        { checkId: "build", status: "passed" },
      ]);

      const runner = new WorkflowRunner(orchestrator, developerAgent, validationRunner);

      const runId = await runner.startRun({
        requestSpec: createRequestSpec("e"),
        architectureContract: mockArchitectureContract,
      });

      const plan1 = (await runner.getRunStatus(runId)).artifacts.executionPlan;
      const plan2 = (await runner.getRunStatus(runId)).artifacts.executionPlan;

      assert.equal(plan1, plan2, "Artifacts should be immutable");
    });
  });

  describe("Scenario F: State Transitions", () => {
    it("should follow correct state machine path", async () => {
      const orchestrator = new AgentOrchestrator();
      const devClient = new FakeAgentClient(FakeScenario.SUCCESS);
      const developerAgent = new DeveloperAgent({ client: devClient });
      const validationRunner = new FakeValidationRunner([
        { checkId: "typecheck", status: "passed" },
        { checkId: "build", status: "passed" },
      ]);

      const runner = new WorkflowRunner(orchestrator, developerAgent, validationRunner);

      const runId = await runner.startRun({
        requestSpec: createRequestSpec("f"),
        architectureContract: mockArchitectureContract,
      });

      let status = await runner.getRunStatus(runId);
      assert.equal(status.status, "HUMAN_GATE_SPEC");
      assert.equal(status.blocked, true);

      await runner.resumeAfterSpecApproval(runId, { approver: "architect" });

      status = await runner.getRunStatus(runId);
      assert.equal(status.status, "HUMAN_GATE_RELEASE");
      assert.equal(status.blocked, true);

      await runner.resumeAfterReleaseApproval(runId, { approver: "lead" });

      status = await runner.getRunStatus(runId);
      assert.equal(status.status, "RELEASE_READY");
      assert.equal(status.blocked, false);
    });
  });
});
