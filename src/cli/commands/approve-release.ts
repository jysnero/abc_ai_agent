import { WorkflowRunner } from "../../workflow/workflow-runner.js";
import { HumanFormatter, JsonFormatter } from "../output/formatter.js";
import { CliError, ExitCode, RunNotFoundError, InvalidStateError, InvalidWorkflowStateError } from "../cli-errors.js";
import { InvalidRunIdFormatError, RunNotFoundError as StorageRunNotFoundError } from "../../storage/run-storage.js";

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
      ? JSON.stringify({ ok: true, run_id: releaseId }, null, 2)
      : `✓ Release approved: ${releaseId}`;
    return { output, exitCode: 0 };
  } catch (err) {
    if (err instanceof InvalidRunIdFormatError) {
      throw new CliError((err as Error).message, ExitCode.CLI_ARGS_ERROR);
    }
    if (err instanceof StorageRunNotFoundError) {
      throw new RunNotFoundError((err as Error).message);
    }
    if (err instanceof InvalidWorkflowStateError) {
      throw new InvalidStateError((err as Error).message);
    }
    throw err;
  }
}
