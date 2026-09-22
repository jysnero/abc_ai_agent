#!/usr/bin/env node

/**
 * CLI: orchestrate command-line interface
 * Entry point for running workflows
 */

import { parseArgs } from "util";
import { startCommand } from "./commands/start.js";
import { statusCommand } from "./commands/status.js";
import { approveSpecCommand } from "./commands/approve-spec.js";
import { resumeCommand } from "./commands/resume.js";
import { approveReleaseCommand } from "./commands/approve-release.js";
import { artifactsCommand } from "./commands/artifacts.js";
import { createCliDependencies } from "./composition.js";
import { CliError, ExitCode } from "./cli-errors.js";
import { JsonFormatter } from "./output/formatter.js";

const VERSION = "0.1.0";

async function main() {
  try {
    const args = process.argv.slice(2);
    let argIndex = 0;
    let testMode = false;
    let helpFlag = false;
    let versionFlag = false;

    // Parse global flags (--test-mode, --help, --version)
    while (argIndex < args.length && args[argIndex].startsWith("-")) {
      if (args[argIndex] === "--test-mode") {
        testMode = true;
        argIndex++;
      } else if (args[argIndex] === "-h" || args[argIndex] === "--help") {
        helpFlag = true;
        argIndex++;
        break;
      } else if (args[argIndex] === "-v" || args[argIndex] === "--version") {
        versionFlag = true;
        argIndex++;
        break;
      } else {
        // Unknown global flag, stop parsing
        break;
      }
    }

    // Handle help
    if (helpFlag) {
      printHelp();
      process.exit(ExitCode.SUCCESS);
    }

    // Handle version
    if (versionFlag) {
      console.log(`orchestrate v${VERSION}`);
      process.exit(ExitCode.SUCCESS);
    }

    // Get command
    const command = args[argIndex];

    if (!command) {
      printHelp();
      process.exit(ExitCode.CLI_ARGS_ERROR);
    }

    // Create dependencies
    const deps = createCliDependencies(testMode);

    // Command arguments (everything after command name)
    const commandArgs = args.slice(argIndex + 1);

    // Route command
    let result: { output: string; exitCode: number };

    switch (command) {
      case "start": {
        const { values: opts } = parseArgs({
          args: commandArgs,
          options: {
            spec: { type: "string" },
            contract: { type: "string" },
            json: { type: "boolean" },
          },
          strict: true,
        });
        result = await startCommand(deps.workflowRunner, {
          spec: opts.spec as string,
          contract: opts.contract as string,
          json: opts.json as boolean | undefined,
        });
        break;
      }

      case "status": {
        const { values: opts } = parseArgs({
          args: commandArgs,
          options: {
            "run-id": { type: "string" },
            json: { type: "boolean" },
          },
          strict: true,
        });
        result = await statusCommand(deps.workflowRunner, {
          "run-id": opts["run-id"] as string,
          json: opts.json as boolean | undefined,
          agentMode: deps.agentMode,
        });
        break;
      }

      case "approve-spec": {
        const { values: opts } = parseArgs({
          args: commandArgs,
          options: {
            "run-id": { type: "string" },
            approver: { type: "string" },
            "expected-checksum": { type: "string" },
            comment: { type: "string" },
            json: { type: "boolean" },
          },
          strict: true,
        });
        result = await approveSpecCommand(deps.workflowRunner, {
          "run-id": opts["run-id"] as string,
          approver: opts.approver as string,
          "expected-checksum": opts["expected-checksum"] as string | undefined,
          comment: opts.comment as string | undefined,
          json: opts.json as boolean | undefined,
        });
        break;
      }

      case "resume": {
        const { values: opts } = parseArgs({
          args: commandArgs,
          options: {
            "run-id": { type: "string" },
            json: { type: "boolean" },
          },
          strict: true,
        });
        result = await resumeCommand(deps.workflowRunner, {
          "run-id": opts["run-id"] as string,
          json: opts.json as boolean | undefined,
        });
        break;
      }

      case "approve-release": {
        const { values: opts } = parseArgs({
          args: commandArgs,
          options: {
            "run-id": { type: "string" },
            approver: { type: "string" },
            "artifact-checksum": { type: "string" },
            comment: { type: "string" },
            json: { type: "boolean" },
          },
          strict: true,
        });
        result = await approveReleaseCommand(deps.workflowRunner, {
          "run-id": opts["run-id"] as string,
          approver: opts.approver as string,
          "artifact-checksum": opts["artifact-checksum"] as string | undefined,
          comment: opts.comment as string | undefined,
          json: opts.json as boolean | undefined,
        });
        break;
      }

      case "artifacts": {
        const { values: opts } = parseArgs({
          args: commandArgs,
          options: {
            "run-id": { type: "string" },
            json: { type: "boolean" },
          },
          strict: true,
        });
        result = await artifactsCommand(deps.workflowRunner, {
          "run-id": opts["run-id"] as string,
          json: opts.json as boolean | undefined,
        });
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        printHelp();
        process.exit(ExitCode.CLI_ARGS_ERROR);
    }

    // Output and exit
    console.log(result.output);
    process.exit(result.exitCode);
  } catch (err) {
    handleError(err);
  }
}

function handleError(err: unknown): void {
  const isCliError = err instanceof CliError;
  const exitCode = isCliError ? err.exitCode : ExitCode.WORKFLOW_ERROR;
  const message = (err as Error).message || "Unknown error";

  // Check if JSON output was requested
  const isJson = process.argv.includes("--json");

  if (isJson) {
    console.error(JsonFormatter.formatError(message, exitCode));
  } else {
    console.error(`Error: ${message}`);
  }

  process.exit(exitCode);
}

function printHelp(): void {
  console.log(`
orchestrate v${VERSION} - Workflow orchestration CLI

USAGE:
  orchestrate [OPTIONS] [COMMAND] [COMMAND OPTIONS]

GLOBAL OPTIONS:
  --test-mode        Use fake agent for testing (no real API calls)
  -h, --help         Show this help message
  -v, --version      Show version

COMMANDS:
  start              Create a new workflow run
  status             Show current run status
  approve-spec       Approve specification
  resume             Resume workflow execution
  approve-release    Approve release
  artifacts          List run artifacts

COMMAND OPTIONS:
  start:
    --spec FILE           Request spec JSON file (required)
    --contract FILE       Architecture contract JSON file (required)

  status:
    --run-id ID           Run ID (required)

  approve-spec:
    --run-id ID           Run ID (required)
    --approver NAME       Approver name (required)
    --expected-checksum   Optional checksum validation
    --comment TEXT        Optional approval comment

  resume:
    --run-id ID           Run ID (required)

  approve-release:
    --run-id ID           Run ID (required)
    --approver NAME       Approver name (required)
    --artifact-checksum   Optional checksum validation
    --comment TEXT        Optional approval comment

  artifacts:
    --run-id ID           Run ID (required)

  Global options: --json, --test-mode

EXAMPLES:
  orchestrate --test-mode start --spec spec.json --contract contract.json
  orchestrate status --run-id req-001
  orchestrate --test-mode approve-spec --run-id req-001 --approver alice
  orchestrate resume --run-id req-001
  orchestrate approve-release --run-id req-001 --approver bob
  orchestrate artifacts --run-id req-001
`);
}

// Run CLI
main().catch(() => {
  // Error already handled
});
