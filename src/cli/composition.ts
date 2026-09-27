import { createOrchestrator } from "../orchestrator.js";
import { DeveloperAgent, type DeveloperAgentConfig } from "../agents/developer.js";
import { WorkflowRunner } from "../workflow/workflow-runner.js";
import { ProcessValidationRunner } from "../validation/process-validation-runner.js";
import { FakeAgentClient, FakeScenario } from "../runtime/fake-agent-client.js";

export interface CliDependencies {
  workflowRunner: WorkflowRunner;
  agentMode: string;
}

/**
 * Create FakeAgentClient with scenario from environment variable
 * FAKE_SCENARIO: "success" (default) | "validation_failure"
 */
function createFakeAgentClient(): FakeAgentClient {
  const scenarioName = process.env.FAKE_SCENARIO?.toLowerCase() || "success";
  const scenarioMap: Record<string, FakeScenario> = {
    success: FakeScenario.SUCCESS,
    validation_failure: FakeScenario.VALIDATION_FAILURE,
    repair_failure: FakeScenario.REPAIR_FAILURE,
    range_exceeded: FakeScenario.RANGE_EXCEEDED,
  };
  const scenario = scenarioMap[scenarioName] || FakeScenario.SUCCESS;
  return new FakeAgentClient(scenario);
}

// 일반 실제 API 실행 정책 (기존과 동일)
export const PRODUCTION_POLICY = {
  agent: { model: "claude-opus-5-5", max_tokens: 8192, timeout_ms: 60000, max_retries: 3 },
  maxRepairAttempts: 3,
} as const;

// 단일 시험 정책 (--single-trial): 단계별 1회 요청, 재시도·repair 없음, 응답 대기 180초
export const SINGLE_TRIAL_POLICY = {
  agent: { model: "claude-opus-5-5", max_tokens: 8192, timeout_ms: 180000, max_retries: 0 },
  maxRepairAttempts: 0,
} as const;

export function createCliDependencies(
  testMode: boolean,
  options: { singleTrial?: boolean } = {}
): CliDependencies {
  const orchestrator = createOrchestrator();

  const isSmokeTest = process.env.SMOKE_TEST === "true";
  const policy = options.singleTrial ? SINGLE_TRIAL_POLICY : PRODUCTION_POLICY;
  const devConfig: DeveloperAgentConfig = testMode
    ? { client: createFakeAgentClient() }
    : {
        apiKey: process.env.ANTHROPIC_API_KEY,
        ...policy.agent,
        // smoke test: 첫 실패에서 종료 (기존 동작)
        ...(isSmokeTest ? { max_retries: 0 } : {}),
      };

  const developerAgent = new DeveloperAgent(devConfig);

  // ValidationRunner: instantiate with process.cwd() (platform root)
  // WorkflowRunner will pass generated workspace path for per-run validation
  const validationRunner = new ProcessValidationRunner();
  const runner = new WorkflowRunner(orchestrator, developerAgent, validationRunner, {
    maxRepairAttempts: testMode ? PRODUCTION_POLICY.maxRepairAttempts : policy.maxRepairAttempts,
  });

  return {
    workflowRunner: runner,
    agentMode: testMode ? "test" : isSmokeTest ? "smoke" : "production",
  };
}
