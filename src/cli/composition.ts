import { createOrchestrator } from "../orchestrator.js";
import { DeveloperAgent, type DeveloperAgentConfig } from "../agents/developer.js";
import { WorkflowRunner } from "../workflow/workflow-runner.js";
import { ProcessValidationRunner } from "../validation/process-validation-runner.js";
import { FakeAgentClient } from "../runtime/fake-agent-client.js";

export interface CliDependencies {
  workflowRunner: WorkflowRunner;
  agentMode: string;
}

export function createCliDependencies(testMode: boolean): CliDependencies {
  const orchestrator = createOrchestrator();

  // Create DeveloperAgent with appropriate client based on mode
  const devConfig: DeveloperAgentConfig = testMode
    ? { client: new FakeAgentClient() }
    : { apiKey: process.env.ANTHROPIC_API_KEY };

  const developerAgent = new DeveloperAgent(devConfig);
  const validationRunner = new ProcessValidationRunner();
  const runner = new WorkflowRunner(orchestrator, developerAgent, validationRunner);

  return {
    workflowRunner: runner,
    agentMode: testMode ? "test" : "production",
  };
}
