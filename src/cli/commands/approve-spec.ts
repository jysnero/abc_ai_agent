import { WorkflowRunner } from "../../workflow/workflow-runner.js";
import { HumanFormatter, JsonFormatter } from "../output/formatter.js";
import { CliError, ExitCode, RunNotFoundError, InvalidStateError } from "../cli-errors.js";

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
    const errMsg = (err as Error).message;
    if (errMsg.includes("Run not found")) {
      throw new RunNotFoundError(errMsg);
    }
    if (errMsg.includes("Invalid run ID format")) {
      throw new RunNotFoundError("Invalid run ID format");
    }
    if (errMsg.includes("Cannot approve") || errMsg.includes("already been approved")) {
      throw new InvalidStateError(errMsg);
    }
    throw err;
  }
}
