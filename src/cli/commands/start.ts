import * as fs from "fs";
import * as path from "path";
import { WorkflowRunner } from "../../workflow/workflow-runner.js";
import { HumanFormatter, JsonFormatter, derivePendingAction } from "../output/formatter.js";
import { CliError, InputFileError, WorkflowError, ExitCode } from "../cli-errors.js";
import { loadManifest } from "../../storage/run-storage.js";
import { parseExecutionLimits } from "../../workflow/execution-limits.js";

export interface StartOptions {
  spec: string;
  contract: string;
  json?: boolean;
  agentMode: string;
  executionLimits?: string;
  generationPlan?: string;
}

export async function startCommand(
  runner: WorkflowRunner,
  options: StartOptions
): Promise<{ output: string; exitCode: number }> {
  if (!options.spec || !options.contract) {
    throw new CliError("Required options: --spec <file> --contract <file>", ExitCode.CLI_ARGS_ERROR);
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

  let limitsContent: string | undefined;
  if (options.executionLimits) {
    const limitsPath = path.resolve(options.executionLimits);
    if (!fs.existsSync(limitsPath)) {
      throw new InputFileError(`Execution limits file not found: ${limitsPath}`);
    }
    limitsContent = fs.readFileSync(limitsPath, "utf-8");
    try {
      parseExecutionLimits(limitsContent);
    } catch (err) {
      throw new InputFileError(`Invalid execution limits: ${(err as Error).message}`);
    }
  }

  let generationPlanContent: string | undefined;
  if (options.generationPlan) {
    const planPath = path.resolve(options.generationPlan);
    if (!fs.existsSync(planPath)) {
      throw new InputFileError(`Generation plan file not found: ${planPath}`);
    }
    generationPlanContent = fs.readFileSync(planPath, "utf-8");
  }

  let runId: string;
  try {
    runId = await runner.startRun({
      requestSpec: specContent,
      architectureContract: contractContent,
      executionLimits: limitsContent,
      generationPlan: generationPlanContent,
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
    ? JsonFormatter.formatStart(runId, manifest, pendingAction, options.agentMode)
    : HumanFormatter.formatStartMessage(runId);

  return { output, exitCode: 0 };
}
