import { WorkflowRunner } from "../../workflow/workflow-runner.js";
import { CliError, ExitCode } from "../cli-errors.js";
import { JsonFormatter, toExternalAgentMode } from "../output/formatter.js";

export interface ResumeOptions {
  "run-id": string;
  json?: boolean;
  agentMode: string;
}

export async function resumeCommand(
  runner: WorkflowRunner,
  options: ResumeOptions
): Promise<{ output: string; exitCode: number }> {
  if (!options["run-id"]) {
    throw new CliError("Required option: --run-id <id>", ExitCode.CLI_ARGS_ERROR);
  }

  try {
    await runner.resumeRun(options["run-id"]);
    const state = (await runner.getRunStatus(options["run-id"])).status;
    const output = options.json
      ? JsonFormatter.formatResume(options["run-id"], state, options.agentMode)
      : `✓ Workflow resumed\nState: ${state}\nAgent Mode: ${toExternalAgentMode(options.agentMode)}`;
    return { output, exitCode: 0 };
  } catch (err) {
    if ((err as Error).message.includes("not found")) {
      throw new CliError("Run not found", ExitCode.RUN_NOT_FOUND_ERROR);
    }
    if ((err as Error).message.includes("Cannot resume")) {
      throw new CliError((err as Error).message, ExitCode.INVALID_STATE_ERROR);
    }
    throw err;
  }
}
