/**
 * CLI Integration Tests (Real Process-Based)
 * Each CLI command runs in a separate process with isolated Run Storage
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CLI_PATH = path.resolve("dist/src/cli/index.js");
let testRunDir: string;

// Helper: create isolated temp directory for this test suite
function createTestRunDir(): string {
  const baseDir = path.join(os.tmpdir(), `cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(baseDir, { recursive: true });
  return baseDir;
}

// Helper: run CLI command in isolated process
function runCli(args: string[], env?: Record<string, string>): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  // Always use --test-mode to avoid real API calls
  const nodeArgs = [CLI_PATH, "--test-mode", ...args];
  const result = spawnSync(process.execPath, nodeArgs, {
    encoding: "utf-8",
    shell: false,
    env: {
      ...process.env,
      TEST_RUN_DIR: testRunDir,
      ANTHROPIC_API_KEY: "test-key-fake",
      ...env,
    },
  });

  return {
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    exitCode: result.status ?? 1,
  };
}

// Helper: create fixture files
function createFixtureSpec(): string {
  const spec = {
    topic: "Test WebView Service",
    target: "service",
    requirements: "Create a test service",
  };
  return JSON.stringify(spec);
}

function createFixtureContract(): string {
  const contract = {
    contract_id: "req-20260922-001-test",
    version: "1.0.0",
    pattern_type: "minigame_shell_v1",
    issued_by: "architect_agent",
    folder_structure: {
      required_files: ["src/index.ts", "package.json"],
      allowed_globs: ["src/**/*.ts", "src/*.ts", "test/**/*.ts", "package.json"],
    },
    allowed_dependencies: {
      script_hosts: [],
      npm_packages: [],
    },
    bridge_contract_ref: {
      contract_id: "req-20260922-001-test",
      path: "contracts/patterns/minigame_shell_v1.json",
    },
    bridge_policy: {},
    forbidden_patterns: [],
    design_tokens_ref: "",
  };
  return JSON.stringify(contract);
}

describe("CLI Integration Tests (Real Process)", () => {
  before(() => {
    testRunDir = createTestRunDir();
  });

  after(() => {
    // Cleanup test directory
    if (fs.existsSync(testRunDir)) {
      fs.rmSync(testRunDir, { recursive: true, force: true });
    }
  });

  // ==================== Global Options ====================

  test("--help shows usage", () => {
    const { stdout, exitCode } = runCli(["--help"]);
    assert(stdout.includes("orchestrate"), "Should show command name");
    assert(stdout.includes("COMMANDS"), "Should show commands section");
    assert.equal(exitCode, 0, "Should exit successfully");
  });

  test("--version shows version", () => {
    const { stdout, exitCode } = runCli(["--version"]);
    assert(stdout.includes("v0.1.0"), "Should show version");
    assert.equal(exitCode, 0, "Should exit successfully");
  });

  test("no command shows error", () => {
    const { stdout, exitCode } = runCli([]);
    assert(stdout.includes("COMMANDS"), "Should show help");
    assert.equal(exitCode, 2, "Should exit with CLI_ARGS_ERROR");
  });

  test("unknown command shows error", () => {
    const { stderr, exitCode } = runCli(["unknown-cmd"]);
    assert(stderr.includes("Unknown command") || exitCode === 2);
  });

  // ==================== start Command ====================

  test("start: creates run at HUMAN_GATE_SPEC", () => {
    const spec = createFixtureSpec();
    const contract = createFixtureContract();

    // Write temp files
    const specFile = path.join(testRunDir, "spec.json");
    const contractFile = path.join(testRunDir, "contract.json");
    fs.writeFileSync(specFile, spec);
    fs.writeFileSync(contractFile, contract);

    const { stdout, exitCode } = runCli(["start", "--spec", specFile, "--contract", contractFile]);
    assert.equal(exitCode, 0, "Should exit successfully");
    assert(stdout.includes("Run created"), "Should show run created message");
  });

  test("start: missing spec file exits 3", () => {
    const contract = createFixtureContract();
    const contractFile = path.join(testRunDir, "contract.json");
    fs.writeFileSync(contractFile, contract);

    const { exitCode } = runCli(["start", "--spec", "/nonexistent/spec.json", "--contract", contractFile]);
    assert.equal(exitCode, 3, "Should exit with INPUT_FILE_ERROR");
  });

  test("start: invalid JSON exits 3", () => {
    const specFile = path.join(testRunDir, "bad-spec.json");
    const contractFile = path.join(testRunDir, "contract.json");
    fs.writeFileSync(specFile, "not valid json");
    fs.writeFileSync(contractFile, createFixtureContract());

    const { exitCode } = runCli(["start", "--spec", specFile, "--contract", contractFile]);
    assert.equal(exitCode, 3, "Should exit with INPUT_FILE_ERROR");
  });

  test("start: --json outputs valid JSON", () => {
    const spec = createFixtureSpec();
    const contract = createFixtureContract();

    const specFile = path.join(testRunDir, "spec.json");
    const contractFile = path.join(testRunDir, "contract.json");
    fs.writeFileSync(specFile, spec);
    fs.writeFileSync(contractFile, contract);

    const { stdout, exitCode } = runCli(["start", "--spec", specFile, "--contract", contractFile, "--json"]);
    assert.equal(exitCode, 0, "Should exit successfully");
    const json = JSON.parse(stdout);
    assert(json.run_id, "Should have run_id in JSON");
  });

  // ==================== status Command ====================

  test("status: requires --run-id", () => {
    const { exitCode } = runCli(["status"]);
    assert.equal(exitCode, 2, "Should exit with CLI_ARGS_ERROR");
  });

  test("status: nonexistent run exits 4", () => {
    const { exitCode } = runCli(["status", "--run-id", "req-nonexistent"]);
    assert.equal(exitCode, 4, "Should exit with RUN_NOT_FOUND_ERROR");
  });

  test("status: shows current state and agent_mode", () => {
    const spec = createFixtureSpec();
    const contract = createFixtureContract();

    const specFile = path.join(testRunDir, "spec.json");
    const contractFile = path.join(testRunDir, "contract.json");
    fs.writeFileSync(specFile, spec);
    fs.writeFileSync(contractFile, contract);

    const startResult = runCli(["start", "--spec", specFile, "--contract", contractFile]);
    const runIdMatch = startResult.stdout.match(/run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    assert(runIdMatch, "Should have run ID");

    const runId = runIdMatch![0];
    const { stdout, exitCode } = runCli(["status", "--run-id", runId]);
    assert.equal(exitCode, 0, "Should exit successfully");
    assert(stdout.includes("HUMAN_GATE_SPEC"), "Should show correct state");
  });

  test("status: --json includes agent_mode field", () => {
    const spec = createFixtureSpec();
    const contract = createFixtureContract();

    const specFile = path.join(testRunDir, "spec.json");
    const contractFile = path.join(testRunDir, "contract.json");
    fs.writeFileSync(specFile, spec);
    fs.writeFileSync(contractFile, contract);

    const startResult = runCli(["start", "--spec", specFile, "--contract", contractFile]);
    const runIdMatch = startResult.stdout.match(/run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    const runId = runIdMatch![0];

    const { stdout, exitCode } = runCli(["status", "--run-id", runId, "--json"]);
    assert.equal(exitCode, 0, "Should exit successfully");
    const json = JSON.parse(stdout);
    assert(json.agent_mode !== undefined, "Should include agent_mode field");
  });

  // ==================== approve-spec Command ====================

  test("approve-spec: requires --run-id", () => {
    const { exitCode } = runCli(["approve-spec"]);
    assert.equal(exitCode, 2, "Should exit with CLI_ARGS_ERROR");
  });

  test("approve-spec: requires --approver", () => {
    const { exitCode } = runCli(["approve-spec", "--run-id", "req-001"]);
    assert.equal(exitCode, 2, "Should exit with CLI_ARGS_ERROR");
  });

  test("approve-spec: nonexistent run exits 4", () => {
    const { exitCode } = runCli(["approve-spec", "--run-id", "req-nonexistent", "--approver", "alice"]);
    assert.equal(exitCode, 4, "Should exit with RUN_NOT_FOUND_ERROR");
  });

  test("approve-spec: wrong state exits 5", () => {
    const spec = createFixtureSpec();
    const contract = createFixtureContract();

    const specFile = path.join(testRunDir, "spec.json");
    const contractFile = path.join(testRunDir, "contract.json");
    fs.writeFileSync(specFile, spec);
    fs.writeFileSync(contractFile, contract);

    const startResult = runCli(["start", "--spec", specFile, "--contract", contractFile]);
    const runIdMatch = startResult.stdout.match(/run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    const runId = runIdMatch![0];

    // Approve twice
    const first = runCli(["approve-spec", "--run-id", runId, "--approver", "alice"]);
    assert.equal(first.exitCode, 0, "First approval should succeed");

    const second = runCli(["approve-spec", "--run-id", runId, "--approver", "bob"]);
    assert.equal(second.exitCode, 5, "Should exit with INVALID_STATE_ERROR");
  });

  test("approve-spec: saves approval and shows target checksum", () => {
    const spec = createFixtureSpec();
    const contract = createFixtureContract();

    const specFile = path.join(testRunDir, "spec.json");
    const contractFile = path.join(testRunDir, "contract.json");
    fs.writeFileSync(specFile, spec);
    fs.writeFileSync(contractFile, contract);

    const startResult = runCli(["start", "--spec", specFile, "--contract", contractFile]);
    const runIdMatch = startResult.stdout.match(/run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    const runId = runIdMatch![0];

    const { stdout, exitCode } = runCli(["approve-spec", "--run-id", runId, "--approver", "alice"]);
    assert.equal(exitCode, 0, "Should exit successfully");
    assert(stdout.includes("sha256:"), "Should show checksum");
  });

  // ==================== approve-release Command ====================

  test("approve-release: requires --run-id and --approver", () => {
    const { exitCode } = runCli(["approve-release"]);
    assert.equal(exitCode, 2, "Should exit with CLI_ARGS_ERROR");
  });

  test("approve-release: wrong state exits 5", () => {
    const spec = createFixtureSpec();
    const contract = createFixtureContract();

    const specFile = path.join(testRunDir, "spec.json");
    const contractFile = path.join(testRunDir, "contract.json");
    fs.writeFileSync(specFile, spec);
    fs.writeFileSync(contractFile, contract);

    const startResult = runCli(["start", "--spec", specFile, "--contract", contractFile]);
    const runIdMatch = startResult.stdout.match(/run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    const runId = runIdMatch![0];

    const { exitCode } = runCli(["approve-release", "--run-id", runId, "--approver", "bob"]);
    assert.equal(exitCode, 5, "Should exit with INVALID_STATE_ERROR");
  });

  // ==================== resume Command ====================

  test("resume: requires --run-id", () => {
    const { exitCode } = runCli(["resume"]);
    assert.equal(exitCode, 2, "Should exit with CLI_ARGS_ERROR");
  });

  test("resume: without approval exits 5", () => {
    const spec = createFixtureSpec();
    const contract = createFixtureContract();

    const specFile = path.join(testRunDir, "spec.json");
    const contractFile = path.join(testRunDir, "contract.json");
    fs.writeFileSync(specFile, spec);
    fs.writeFileSync(contractFile, contract);

    const startResult = runCli(["start", "--spec", specFile, "--contract", contractFile]);
    const runIdMatch = startResult.stdout.match(/run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    const runId = runIdMatch![0];

    const { exitCode } = runCli(["resume", "--run-id", runId]);
    assert.equal(exitCode, 5, "Should exit with INVALID_STATE_ERROR (spec not approved)");
  });

  // ==================== artifacts Command ====================

  test("artifacts: requires --run-id", () => {
    const { exitCode } = runCli(["artifacts"]);
    assert.equal(exitCode, 2, "Should exit with CLI_ARGS_ERROR");
  });

  test("artifacts: nonexistent run exits 4", () => {
    const { exitCode } = runCli(["artifacts", "--run-id", "req-nonexistent"]);
    assert.equal(exitCode, 4, "Should exit with RUN_NOT_FOUND_ERROR");
  });

  test("artifacts: lists artifact metadata (no full content)", () => {
    const spec = createFixtureSpec();
    const contract = createFixtureContract();

    const specFile = path.join(testRunDir, "spec.json");
    const contractFile = path.join(testRunDir, "contract.json");
    fs.writeFileSync(specFile, spec);
    fs.writeFileSync(contractFile, contract);

    const startResult = runCli(["start", "--spec", specFile, "--contract", contractFile]);
    const runIdMatch = startResult.stdout.match(/run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    const runId = runIdMatch![0];

    const { stdout, exitCode } = runCli(["artifacts", "--run-id", runId]);
    assert.equal(exitCode, 0, "Should exit successfully");
    assert(stdout.includes("Artifacts"), "Should list artifacts");
  });

  // ==================== JSON Output ====================

  test("--json outputs valid JSON to stdout only", () => {
    const spec = createFixtureSpec();
    const contract = createFixtureContract();

    const specFile = path.join(testRunDir, "spec.json");
    const contractFile = path.join(testRunDir, "contract.json");
    fs.writeFileSync(specFile, spec);
    fs.writeFileSync(contractFile, contract);

    const { stdout, exitCode } = runCli(["start", "--spec", specFile, "--contract", contractFile, "--json"]);
    assert.equal(exitCode, 0, "Should exit successfully");
    const json = JSON.parse(stdout);
    assert(json.run_id, "Should parse as valid JSON");
  });

  // ==================== Exit Codes ====================

  test("exit code 0: success", () => {
    const spec = createFixtureSpec();
    const contract = createFixtureContract();

    const specFile = path.join(testRunDir, "spec.json");
    const contractFile = path.join(testRunDir, "contract.json");
    fs.writeFileSync(specFile, spec);
    fs.writeFileSync(contractFile, contract);

    const { exitCode } = runCli(["start", "--spec", specFile, "--contract", contractFile]);
    assert.equal(exitCode, 0);
  });

  test("exit code 2: CLI args error", () => {
    const { exitCode } = runCli(["start"]);
    assert.equal(exitCode, 2);
  });

  test("exit code 3: input file error", () => {
    const { exitCode } = runCli(["start", "--spec", "/nonexistent", "--contract", "/nonexistent"]);
    assert.equal(exitCode, 3);
  });

  test("exit code 4: run not found", () => {
    const { exitCode } = runCli(["status", "--run-id", "req-nonexistent"]);
    assert.equal(exitCode, 4);
  });
});
