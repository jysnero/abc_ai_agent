import { WorkflowRunner } from "../../workflow/workflow-runner.js";
import { HumanFormatter, JsonFormatter } from "../output/formatter.js";
import { CliError, ExitCode } from "../cli-errors.js";

export interface ApproveReleaseOptions {
  "run-id": string;
  approver: string;
  "artifact-checksum"?: string;
  comment?: string;
  json?: boolean;
}

export async function approveReleaseCommand(
  runner: WorkflowRunner,
  options: ApproveReleaseOptions
): Promise<{ output: string; exitCode: number }> {
  if (!options["run-id"]) {
    throw new CliError("Required option: --run-id <id>", ExitCode.CLI_ARGS_ERROR);
  }
  if (!options.approver) {
    throw new CliError("Required option: --approver <name>", ExitCode.CLI_ARGS_ERROR);
  }

  try {
    const releaseId = await runner.submitReleaseApproval(options["run-id"], {
      approver: options.approver,
      comment: options.comment,
    });

    const output = options.json
      ? JsonFormatter.formatStart(releaseId)
      : `✓ Release approved: ${releaseId}`;
    return { output, exitCode: 0 };
  } catch (err) {
    if ((err as Error).message.includes("not found")) {
      throw new CliError("Run not found", ExitCode.RUN_NOT_FOUND_ERROR);
    }
    if ((err as Error).message.includes("Cannot approve")) {
      throw new CliError((err as Error).message, ExitCode.INVALID_STATE_ERROR);
    }
    throw err;
  }
}
