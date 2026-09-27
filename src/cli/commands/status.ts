import { WorkflowRunner } from "../../workflow/workflow-runner.js";
import { HumanFormatter, JsonFormatter } from "../output/formatter.js";
import { CliError, ExitCode, RunNotFoundError } from "../cli-errors.js";
import { InvalidRunIdFormatError, RunNotFoundError as StorageRunNotFoundError } from "../../storage/run-storage.js";

export interface StatusOptions {
  "run-id": string;
  json?: boolean;
  agentMode: string;
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
      ? JsonFormatter.formatStatus(workflowStatus, options.agentMode)
      : HumanFormatter.formatStatusMessage(workflowStatus, options.agentMode);
    return { output, exitCode: 0 };
  } catch (err) {
    if (err instanceof InvalidRunIdFormatError) {
      throw new CliError((err as Error).message, ExitCode.CLI_ARGS_ERROR);
    }
    if (err instanceof StorageRunNotFoundError) {
      throw new RunNotFoundError((err as Error).message);
    }
    throw err;
  }
}
