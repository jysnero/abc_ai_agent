import { WorkflowRunner } from "../../workflow/workflow-runner.js";
import { HumanFormatter, JsonFormatter } from "../output/formatter.js";
import { CliError, ExitCode } from "../cli-errors.js";

export interface StatusOptions {
  "run-id": string;
  json?: boolean;
  agentMode?: string;
}

export async function statusCommand(
  runner: WorkflowRunner,
  options: StatusOptions
): Promise<{ output: string; exitCode: number }> {
  if (!options["run-id"]) {
    throw new CliError("Required option: --run-id <id>", ExitCode.CLI_ARGS_ERROR);
  }

  try {
    const workflowStatus = await runner.getRunStatus(options["run-id"]);
    const output = options.json
      ? JsonFormatter.formatStatus(workflowStatus, options.agentMode || "production")
      : HumanFormatter.formatStatusMessage(workflowStatus, options.agentMode || "production");
    return { output, exitCode: 0 };
  } catch (err) {
    if ((err as Error).message.includes("not found")) {
      throw new CliError("Run not found", ExitCode.RUN_NOT_FOUND_ERROR);
    }
    throw err;
  }
}
