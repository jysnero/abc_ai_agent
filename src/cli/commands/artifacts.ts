import { WorkflowRunner } from "../../workflow/workflow-runner.js";
import { HumanFormatter, JsonFormatter } from "../output/formatter.js";
import { CliError, ExitCode, RunNotFoundError } from "../cli-errors.js";

export interface ArtifactsOptions {
  "run-id": string;
  json?: boolean;
}

export async function artifactsCommand(
  runner: WorkflowRunner,
  options: ArtifactsOptions
): Promise<{ output: string; exitCode: number }> {
  if (!options["run-id"]) {
    throw new CliError("Required option: --run-id <id>", ExitCode.CLI_ARGS_ERROR);
  }

  try {
    const artifacts = await runner.listArtifacts(options["run-id"]);
    const output = options.json
      ? JsonFormatter.formatArtifacts(artifacts)
      : HumanFormatter.formatArtifacts(artifacts);
    return { output, exitCode: 0 };
  } catch (err) {
    const errMsg = (err as Error).message;
    if (errMsg.includes("Run not found")) {
      throw new RunNotFoundError(errMsg);
    }
    if (errMsg.includes("Invalid run ID format")) {
      throw new RunNotFoundError("Invalid run ID format");
    }
    throw err;
  }
}
