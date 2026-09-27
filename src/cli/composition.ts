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

export function createCliDependencies(testMode: boolean): CliDependencies {
  const orchestrator = createOrchestrator();

  // Create DeveloperAgent with appropriate client based on mode
  const isSmokeTest = process.env.SMOKE_TEST === "true";
  const devConfig: DeveloperAgentConfig = testMode
    ? { client: createFakeAgentClient() }
    : {
        apiKey: process.env.ANTHROPIC_API_KEY,
        // For smoke test: disable retries for first-failure-fast behavior
        // For production: use default 3 retries
        max_retries: isSmokeTest ? 0 : 3,
      };

  const developerAgent = new DeveloperAgent(devConfig);

  // ValidationRunner: instantiate with process.cwd() (platform root)
  // WorkflowRunner will pass generated workspace path for per-run validation
  const validationRunner = new ProcessValidationRunner();
  const runner = new WorkflowRunner(orchestrator, developerAgent, validationRunner);

  return {
    workflowRunner: runner,
    agentMode: testMode ? "test" : isSmokeTest ? "smoke" : "production",
  };
}
