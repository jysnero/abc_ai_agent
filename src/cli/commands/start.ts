import * as fs from "fs";
import * as path from "path";
import { WorkflowRunner } from "../../workflow/workflow-runner.js";
import { HumanFormatter, JsonFormatter, derivePendingAction } from "../output/formatter.js";
import { InputFileError, WorkflowError } from "../cli-errors.js";
import { loadManifest } from "../../storage/run-storage.js";

export interface StartOptions {
  spec: string;
  contract: string;
  json?: boolean;
}

export async function startCommand(
  runner: WorkflowRunner,
  options: StartOptions
): Promise<{ output: string; exitCode: number }> {
  if (!options.spec || !options.contract) {
    throw new InputFileError("Required options: --spec <file> --contract <file>");
  }

  const specPath = path.resolve(options.spec);
  const contractPath = path.resolve(options.contract);

  if (!fs.existsSync(specPath)) {
    throw new InputFileError(`Spec file not found: ${specPath}`);
  }
  if (!fs.existsSync(contractPath)) {
    throw new InputFileError(`Contract file not found: ${contractPath}`);
  }

  let specContent: string;
  let contractContent: string;

  try {
    specContent = fs.readFileSync(specPath, "utf-8");
    JSON.parse(specContent);
  } catch (err) {
    throw new InputFileError(`Invalid JSON in spec file: ${(err as Error).message}`);
  }

  try {
    contractContent = fs.readFileSync(contractPath, "utf-8");
    JSON.parse(contractContent);
  } catch (err) {
    throw new InputFileError(`Invalid JSON in contract file: ${(err as Error).message}`);
  }

  let runId: string;
  try {
    runId = await runner.startRun({
      requestSpec: specContent,
      architectureContract: contractContent,
    });
  } catch (err) {
    throw new WorkflowError(`Failed to create run: ${(err as Error).message}`);
  }

  // Load final manifest for complete status
  let manifest;
  try {
    manifest = await loadManifest(runId);
  } catch (err) {
    throw new WorkflowError(`Failed to load manifest: ${(err as Error).message}`);
  }
  const pendingAction = derivePendingAction(manifest.status);

  const output = options.json
    ? JsonFormatter.formatStart(runId, manifest, pendingAction)
    : HumanFormatter.formatStartMessage(runId);

  return { output, exitCode: 0 };
}
