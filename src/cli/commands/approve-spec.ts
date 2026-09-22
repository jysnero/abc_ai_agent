import { WorkflowRunner } from "../../workflow/workflow-runner.js";
import { HumanFormatter, JsonFormatter } from "../output/formatter.js";
import { CliError, ExitCode } from "../cli-errors.js";

export interface ApproveSpecOptions {
  "run-id": string;
  approver: string;
  "expected-checksum"?: string;
  comment?: string;
  json?: boolean;
}

export async function approveSpecCommand(
  runner: WorkflowRunner,
  options: ApproveSpecOptions
): Promise<{ output: string; exitCode: number }> {
  if (!options["run-id"]) {
    throw new CliError("Required option: --run-id <id>", ExitCode.CLI_ARGS_ERROR);
  }
  if (!options.approver) {
    throw new CliError("Required option: --approver <name>", ExitCode.CLI_ARGS_ERROR);
  }

  try {
    const targetChecksum = await runner.submitSpecApproval(options["run-id"], {
      approver: options.approver,
      comment: options.comment,
    });

    const output = options.json
      ? JsonFormatter.formatApproval(targetChecksum)
      : HumanFormatter.formatApprovalMessage(targetChecksum);
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
