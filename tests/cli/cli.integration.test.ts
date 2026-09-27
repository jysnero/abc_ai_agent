/**
 * CLI Integration Tests (Real Process-Based)
 * Each CLI command runs in a separate process with isolated Run Storage
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const CLI_PATH = path.resolve("dist/src/cli/index.js");

// Helper: create isolated temp directory for this test
function createTestRunDir(): string {
  const baseDir = path.join(os.tmpdir(), `cli-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  fs.mkdirSync(baseDir, { recursive: true });
  return baseDir;
}

// Helper: run CLI command in isolated process
function runCli(args: string[], testRunDir: string): {
  stdout: string;
  stderr: string;
  exitCode: number;
} {
  const nodeArgs = [CLI_PATH, "--test-mode", ...args];
  const result = spawnSync(process.execPath, nodeArgs, {
    encoding: "utf-8",
    shell: false,
    env: {
      ...process.env,
      TEST_RUN_DIR: testRunDir,
      ANTHROPIC_API_KEY: "test-key-fake",
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
  // ==================== Global Options ====================

  test("--help shows usage", () => {
    const testRunDir = createTestRunDir();
    try {
      const { stdout, exitCode } = runCli(["--help"], testRunDir);
      assert(stdout.includes("orchestrate"), "Should show command name");
      assert(stdout.includes("COMMANDS"), "Should show commands section");
      assert.equal(exitCode, 0, "Should exit successfully");
    } finally {
      if (fs.existsSync(testRunDir)) fs.rmSync(testRunDir, { recursive: true, force: true });
    }
  });

  test("--version shows version", () => {
    const testRunDir = createTestRunDir();
    try {
      const { stdout, exitCode } = runCli(["--version"], testRunDir);
      assert(stdout.includes("v0.1.0"), "Should show version");
      assert.equal(exitCode, 0, "Should exit successfully");
    } finally {
      if (fs.existsSync(testRunDir)) fs.rmSync(testRunDir, { recursive: true, force: true });
    }
  });

  test("no command shows error", () => {
    const testRunDir = createTestRunDir();
    try {
      const { stdout, exitCode } = runCli([], testRunDir);
      assert(stdout.includes("COMMANDS"), "Should show help");
      assert.equal(exitCode, 2, "Should exit with CLI_ARGS_ERROR");
    } finally {
      if (fs.existsSync(testRunDir)) fs.rmSync(testRunDir, { recursive: true, force: true });
    }
  });

  test("unknown command shows error", () => {
    const testRunDir = createTestRunDir();
    try {
      const { stderr, exitCode } = runCli(["unknown-cmd"], testRunDir);
      assert(stderr.includes("Unknown command") || exitCode === 2);
    } finally {
      if (fs.existsSync(testRunDir)) fs.rmSync(testRunDir, { recursive: true, force: true });
    }
  });

  // ==================== start Command ====================

  test("start: creates run at HUMAN_GATE_SPEC", () => {
    const testRunDir = createTestRunDir();
    try {
      const spec = createFixtureSpec();
      const contract = createFixtureContract();

      const specFile = path.join(testRunDir, "spec.json");
      const contractFile = path.join(testRunDir, "contract.json");
      fs.writeFileSync(specFile, spec);
      fs.writeFileSync(contractFile, contract);

      const { stdout, exitCode } = runCli(["start", "--spec", specFile, "--contract", contractFile], testRunDir);
      assert.equal(exitCode, 0, "Should exit successfully");
      assert(stdout.includes("Run created"), "Should show run created message");
    } finally {
      if (fs.existsSync(testRunDir)) fs.rmSync(testRunDir, { recursive: true, force: true });
    }
  });

  test("start: missing spec file exits 3", () => {
    const testRunDir = createTestRunDir();
    try {
      const contract = createFixtureContract();
      const contractFile = path.join(testRunDir, "contract.json");
      fs.writeFileSync(contractFile, contract);

      const { exitCode } = runCli(["start", "--spec", "/nonexistent/spec.json", "--contract", contractFile], testRunDir);
      assert.equal(exitCode, 3, "Should exit with INPUT_FILE_ERROR");
    } finally {
      if (fs.existsSync(testRunDir)) fs.rmSync(testRunDir, { recursive: true, force: true });
    }
  });

  test("start: invalid JSON exits 3", () => {
    const testRunDir = createTestRunDir();
    try {
      const specFile = path.join(testRunDir, "bad-spec.json");
      const contractFile = path.join(testRunDir, "contract.json");
      fs.writeFileSync(specFile, "not valid json");
      fs.writeFileSync(contractFile, createFixtureContract());

      const { exitCode } = runCli(["start", "--spec", specFile, "--contract", contractFile], testRunDir);
      assert.equal(exitCode, 3, "Should exit with INPUT_FILE_ERROR");
    } finally {
      if (fs.existsSync(testRunDir)) fs.rmSync(testRunDir, { recursive: true, force: true });
    }
  });

  test("start: --json outputs valid JSON", () => {
    const testRunDir = createTestRunDir();
    try {
      const spec = createFixtureSpec();
      const contract = createFixtureContract();

      const specFile = path.join(testRunDir, "spec.json");
      const contractFile = path.join(testRunDir, "contract.json");
      fs.writeFileSync(specFile, spec);
      fs.writeFileSync(contractFile, contract);

      const { stdout, exitCode } = runCli(["start", "--spec", specFile, "--contract", contractFile, "--json"], testRunDir);
      assert.equal(exitCode, 0);
      const json = JSON.parse(stdout);
      assert(json.run_id, "Should include run_id");
    } finally {
      if (fs.existsSync(testRunDir)) fs.rmSync(testRunDir, { recursive: true, force: true });
    }
  });

  // ==================== status Command ====================

  test("status: requires --run-id", () => {
    const testRunDir = createTestRunDir();
    try {
      const { exitCode } = runCli(["status"], testRunDir);
      assert.equal(exitCode, 2, "Should exit with CLI_ARGS_ERROR");
    } finally {
      if (fs.existsSync(testRunDir)) fs.rmSync(testRunDir, { recursive: true, force: true });
    }
  });

  test("status: nonexistent run exits 4", () => {
    const testRunDir = createTestRunDir();
    try {
      const { exitCode } = runCli(["status", "--run-id", "run-00000000-0000-0000-0000-000000000000"], testRunDir);
      assert.equal(exitCode, 4, "Should exit with RUN_NOT_FOUND_ERROR");
    } finally {
      if (fs.existsSync(testRunDir)) fs.rmSync(testRunDir, { recursive: true, force: true });
    }
  });

  test("status: shows current state and agent_mode", () => {
    const testRunDir = createTestRunDir();
    try {
      const spec = createFixtureSpec();
      const contract = createFixtureContract();

      const specFile = path.join(testRunDir, "spec.json");
      const contractFile = path.join(testRunDir, "contract.json");
      fs.writeFileSync(specFile, spec);
      fs.writeFileSync(contractFile, contract);

      const startResult = runCli(["start", "--spec", specFile, "--contract", contractFile], testRunDir);
      const runIdMatch = startResult.stdout.match(/run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
      assert(runIdMatch, "Should have run ID");

      const runId = runIdMatch![0];
      const { stdout, exitCode } = runCli(["status", "--run-id", runId], testRunDir);
      assert.equal(exitCode, 0, "Should exit successfully");
      assert(stdout.includes("HUMAN_GATE_SPEC"), "Should show correct state");
    } finally {
      if (fs.existsSync(testRunDir)) fs.rmSync(testRunDir, { recursive: true, force: true });
    }
  });

  test("status: --json includes agent_mode field", () => {
    const testRunDir = createTestRunDir();
    try {
      const spec = createFixtureSpec();
      const contract = createFixtureContract();

      const specFile = path.join(testRunDir, "spec.json");
      const contractFile = path.join(testRunDir, "contract.json");
      fs.writeFileSync(specFile, spec);
      fs.writeFileSync(contractFile, contract);

      const startResult = runCli(["start", "--spec", specFile, "--contract", contractFile], testRunDir);
      const runIdMatch = startResult.stdout.match(/run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
      const runId = runIdMatch![0];

      const { stdout, exitCode } = runCli(["status", "--run-id", runId, "--json"], testRunDir);
      assert.equal(exitCode, 0, "Should exit successfully");
      const json = JSON.parse(stdout);
      assert(json.agent_mode !== undefined, "Should include agent_mode field");
    } finally {
      if (fs.existsSync(testRunDir)) fs.rmSync(testRunDir, { recursive: true, force: true });
    }
  });

  // ==================== approve-spec Command ====================

  test("approve-spec: requires --run-id", () => {
    const testRunDir = createTestRunDir();
    try {
      const { exitCode } = runCli(["approve-spec"], testRunDir);
      assert.equal(exitCode, 2, "Should exit with CLI_ARGS_ERROR");
    } finally {
      if (fs.existsSync(testRunDir)) fs.rmSync(testRunDir, { recursive: true, force: true });
    }
  });

  test("approve-spec: requires --approver", () => {
    const testRunDir = createTestRunDir();
    try {
      const { exitCode } = runCli(["approve-spec", "--run-id", "run-00000000-0000-0000-0000-000000000001"], testRunDir);
      assert.equal(exitCode, 2, "Should exit with CLI_ARGS_ERROR");
    } finally {
      if (fs.existsSync(testRunDir)) fs.rmSync(testRunDir, { recursive: true, force: true });
    }
  });

  test("approve-spec: nonexistent run exits 4", () => {
    const testRunDir = createTestRunDir();
    try {
      const { exitCode } = runCli(["approve-spec", "--run-id", "run-00000000-0000-0000-0000-000000000001", "--approver", "alice"], testRunDir);
      assert.equal(exitCode, 4, "Should exit with RUN_NOT_FOUND_ERROR");
    } finally {
      if (fs.existsSync(testRunDir)) fs.rmSync(testRunDir, { recursive: true, force: true });
    }
  });

  test("approve-spec: wrong state exits 5", () => {
    const testRunDir = createTestRunDir();
    try {
      const spec = createFixtureSpec();
      const contract = createFixtureContract();

      const specFile = path.join(testRunDir, "spec.json");
      const contractFile = path.join(testRunDir, "contract.json");
      fs.writeFileSync(specFile, spec);
      fs.writeFileSync(contractFile, contract);

      const startResult = runCli(["start", "--spec", specFile, "--contract", contractFile], testRunDir);
      const runIdMatch = startResult.stdout.match(/run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
      const runId = runIdMatch![0];

      // Approve once
      const first = runCli(["approve-spec", "--run-id", runId, "--approver", "alice"], testRunDir);
      assert.equal(first.exitCode, 0, "First approval should succeed");

      // Try to approve again (should fail)
      const second = runCli(["approve-spec", "--run-id", runId, "--approver", "bob"], testRunDir);
      assert.equal(second.exitCode, 5, "Should exit with INVALID_STATE_ERROR");
    } finally {
      if (fs.existsSync(testRunDir)) fs.rmSync(testRunDir, { recursive: true, force: true });
    }
  });

  test("approve-spec: saves approval and shows target checksum", () => {
    const testRunDir = createTestRunDir();
    try {
      const spec = createFixtureSpec();
      const contract = createFixtureContract();

      const specFile = path.join(testRunDir, "spec.json");
      const contractFile = path.join(testRunDir, "contract.json");
      fs.writeFileSync(specFile, spec);
      fs.writeFileSync(contractFile, contract);

      const startResult = runCli(["start", "--spec", specFile, "--contract", contractFile], testRunDir);
      const runIdMatch = startResult.stdout.match(/run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
      const runId = runIdMatch![0];

      const { stdout, exitCode } = runCli(["approve-spec", "--run-id", runId, "--approver", "alice"], testRunDir);
      assert.equal(exitCode, 0, "Should exit successfully");
      assert(stdout.includes("sha256:"), "Should show checksum");
    } finally {
      if (fs.existsSync(testRunDir)) fs.rmSync(testRunDir, { recursive: true, force: true });
    }
  });

  // ==================== approve-release Command ====================

  test("approve-release: requires --run-id and --approver", () => {
    const testRunDir = createTestRunDir();
    try {
      const { exitCode } = runCli(["approve-release"], testRunDir);
      assert.equal(exitCode, 2, "Should exit with CLI_ARGS_ERROR");
    } finally {
      if (fs.existsSync(testRunDir)) fs.rmSync(testRunDir, { recursive: true, force: true });
    }
  });

  test("approve-release: wrong state exits 5", () => {
    const testRunDir = createTestRunDir();
    try {
      const spec = createFixtureSpec();
      const contract = createFixtureContract();

      const specFile = path.join(testRunDir, "spec.json");
      const contractFile = path.join(testRunDir, "contract.json");
      fs.writeFileSync(specFile, spec);
      fs.writeFileSync(contractFile, contract);

      const startResult = runCli(["start", "--spec", specFile, "--contract", contractFile], testRunDir);
      const runIdMatch = startResult.stdout.match(/run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
      const runId = runIdMatch![0];

      const { exitCode } = runCli(["approve-release", "--run-id", runId, "--approver", "alice"], testRunDir);
      assert.equal(exitCode, 5, "Should exit with INVALID_STATE_ERROR (not in HUMAN_GATE_RELEASE)");
    } finally {
      if (fs.existsSync(testRunDir)) fs.rmSync(testRunDir, { recursive: true, force: true });
    }
  });

  // ==================== resume Command ====================

  test("resume: requires --run-id", () => {
    const testRunDir = createTestRunDir();
    try {
      const { exitCode } = runCli(["resume"], testRunDir);
      assert.equal(exitCode, 2, "Should exit with CLI_ARGS_ERROR");
    } finally {
      if (fs.existsSync(testRunDir)) fs.rmSync(testRunDir, { recursive: true, force: true });
    }
  });

  test("resume: without approval exits 5", () => {
    const testRunDir = createTestRunDir();
    try {
      const spec = createFixtureSpec();
      const contract = createFixtureContract();

      const specFile = path.join(testRunDir, "spec.json");
      const contractFile = path.join(testRunDir, "contract.json");
      fs.writeFileSync(specFile, spec);
      fs.writeFileSync(contractFile, contract);

      const startResult = runCli(["start", "--spec", specFile, "--contract", contractFile], testRunDir);
      const runIdMatch = startResult.stdout.match(/run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
      const runId = runIdMatch![0];

      const { exitCode } = runCli(["resume", "--run-id", runId], testRunDir);
      assert.equal(exitCode, 5, "Should exit with INVALID_STATE_ERROR (no approval)");
    } finally {
      if (fs.existsSync(testRunDir)) fs.rmSync(testRunDir, { recursive: true, force: true });
    }
  });

  // ==================== artifacts Command ====================

  test("artifacts: requires --run-id", () => {
    const testRunDir = createTestRunDir();
    try {
      const { exitCode } = runCli(["artifacts"], testRunDir);
      assert.equal(exitCode, 2, "Should exit with CLI_ARGS_ERROR");
    } finally {
      if (fs.existsSync(testRunDir)) fs.rmSync(testRunDir, { recursive: true, force: true });
    }
  });

  test("artifacts: nonexistent run exits 4", () => {
    const testRunDir = createTestRunDir();
    try {
      const { exitCode } = runCli(["artifacts", "--run-id", "run-00000000-0000-0000-0000-000000000002"], testRunDir);
      assert.equal(exitCode, 4, "Should exit with RUN_NOT_FOUND_ERROR");
    } finally {
      if (fs.existsSync(testRunDir)) fs.rmSync(testRunDir, { recursive: true, force: true });
    }
  });

  test("artifacts: lists artifact metadata (no full content)", () => {
    const testRunDir = createTestRunDir();
    try {
      const spec = createFixtureSpec();
      const contract = createFixtureContract();

      const specFile = path.join(testRunDir, "spec.json");
      const contractFile = path.join(testRunDir, "contract.json");
      fs.writeFileSync(specFile, spec);
      fs.writeFileSync(contractFile, contract);

      const startResult = runCli(["start", "--spec", specFile, "--contract", contractFile], testRunDir);
      const runIdMatch = startResult.stdout.match(/run-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
      const runId = runIdMatch![0];

      const { stdout, exitCode } = runCli(["artifacts", "--run-id", runId], testRunDir);
      assert.equal(exitCode, 0, "Should exit successfully");
      assert(stdout.includes("request-spec"), "Should list request-spec artifact");
    } finally {
      if (fs.existsSync(testRunDir)) fs.rmSync(testRunDir, { recursive: true, force: true });
    }
  });

  // ==================== JSON Output ====================

  test("--json outputs valid JSON to stdout only", () => {
    const testRunDir = createTestRunDir();
    try {
      const spec = createFixtureSpec();
      const contract = createFixtureContract();

      const specFile = path.join(testRunDir, "spec.json");
      const contractFile = path.join(testRunDir, "contract.json");
      fs.writeFileSync(specFile, spec);
      fs.writeFileSync(contractFile, contract);

      const { stdout, exitCode } = runCli(["start", "--spec", specFile, "--contract", contractFile, "--json"], testRunDir);
      assert.equal(exitCode, 0);
      // Should be valid JSON
      const json = JSON.parse(stdout);
      assert(json.run_id, "JSON should contain run_id");
    } finally {
      if (fs.existsSync(testRunDir)) fs.rmSync(testRunDir, { recursive: true, force: true });
    }
  });

  // ==================== Exit Code Verification ====================

  test("exit code 0: success", () => {
    const testRunDir = createTestRunDir();
    try {
      const spec = createFixtureSpec();
      const contract = createFixtureContract();

      const specFile = path.join(testRunDir, "spec.json");
      const contractFile = path.join(testRunDir, "contract.json");
      fs.writeFileSync(specFile, spec);
      fs.writeFileSync(contractFile, contract);

      const { exitCode } = runCli(["start", "--spec", specFile, "--contract", contractFile], testRunDir);
      assert.equal(exitCode, 0);
    } finally {
      if (fs.existsSync(testRunDir)) fs.rmSync(testRunDir, { recursive: true, force: true });
    }
  });

  test("exit code 2: CLI args error", () => {
    const testRunDir = createTestRunDir();
    try {
      const { exitCode } = runCli(["start"], testRunDir);
      assert.equal(exitCode, 2);
    } finally {
      if (fs.existsSync(testRunDir)) fs.rmSync(testRunDir, { recursive: true, force: true });
    }
  });

  test("exit code 3: input file error", () => {
    const testRunDir = createTestRunDir();
    try {
      const { exitCode } = runCli(["start", "--spec", "/nonexistent", "--contract", "/nonexistent"], testRunDir);
      assert.equal(exitCode, 3);
    } finally {
      if (fs.existsSync(testRunDir)) fs.rmSync(testRunDir, { recursive: true, force: true });
    }
  });

  test("exit code 4: run not found", () => {
    const testRunDir = createTestRunDir();
    try {
      const { exitCode } = runCli(["status", "--run-id", "run-00000000-0000-0000-0000-000000000003"], testRunDir);
      assert.equal(exitCode, 4);
    } finally {
      if (fs.existsSync(testRunDir)) fs.rmSync(testRunDir, { recursive: true, force: true });
    }
  });
});
