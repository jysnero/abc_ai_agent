/**
 * Validation Runner Integration Tests
 *
 * Tests ProcessValidationRunner with real child processes
 * and fixture workspaces
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import path from "path";
import fs from "fs/promises";
import {
  ProcessValidationRunner,
  resolveNpmExecutable,
  validateWorkspacePath,
} from "../../src/validation/process-validation-runner.js";

const fixturesDir = path.resolve("tests/fixtures/validation");

describe("ProcessValidationRunner Integration Tests", () => {
  test("resolveNpmExecutable: Windows", () => {
    assert.strictEqual(resolveNpmExecutable("win32"), "npm.cmd");
  });

  test("resolveNpmExecutable: POSIX", () => {
    assert.strictEqual(resolveNpmExecutable("linux"), "npm");
    assert.strictEqual(resolveNpmExecutable("darwin"), "npm");
  });

  test("validateWorkspacePath: accepts relative paths", async () => {
    const result = await validateWorkspacePath("src", process.cwd());
    assert(result.valid);
  });

  test("validateWorkspacePath: rejects absolute paths", async () => {
    const result = await validateWorkspacePath("/absolute/path", process.cwd());
    assert(!result.valid);
    assert(result.error?.includes("relative"));
  });

  test("validateWorkspacePath: rejects path traversal", async () => {
    const result = await validateWorkspacePath("../../../etc", process.cwd());
    assert(!result.valid);
    assert(result.error?.includes("traversal"));
  });

  test("validateWorkspacePath: rejects Windows drives", async () => {
    const result = await validateWorkspacePath("C:/Windows", ".");
    assert(!result.valid);
    assert(result.error?.includes("relative"));
  });

  test("validateWorkspacePath: rejects UNC paths", async () => {
    const result = await validateWorkspacePath("//server/share", ".");
    assert(!result.valid);
    assert(result.error?.includes("relative"));
  });

  test("valid-workspace: build and test pass", async () => {
    const validDir = path.join(fixturesDir, "valid-workspace");
    const runner = new ProcessValidationRunner(validDir);
    const checksum = "sha256:1111111111111111111111111111111111111111111111111111111111111111";

    // Run build check
    const buildResult = await runner.runCheck("build", checksum);
    assert.strictEqual(buildResult.check_id, "build");
    assert.strictEqual(
      buildResult.status,
      "passed",
      `Build failed: ${buildResult.stderr_summary}`
    );
    assert.strictEqual(buildResult.exit_code, 0);

    // Run test check
    const testResult = await runner.runCheck("test", checksum);
    assert.strictEqual(testResult.check_id, "test");
    assert.strictEqual(
      testResult.status,
      "passed",
      `Test failed: ${testResult.stderr_summary}`
    );
    assert.strictEqual(testResult.exit_code, 0);

    // Run suite
    const suite = await runner.runSuite(["build", "test"], checksum);
    assert.strictEqual(suite.total_checks, 2);
    assert.strictEqual(suite.passed_checks, 2);
    assert.strictEqual(suite.failed_checks, 0);
  });

  test("build-fail-workspace: build fails", async () => {
    const buildFailDir = path.join(fixturesDir, "build-fail-workspace");
    const runner = new ProcessValidationRunner(buildFailDir);

    const result = await runner.runCheck("build");
    assert.strictEqual(result.status, "failed");
    assert(result.exit_code !== 0);
    assert(result.stderr_summary.length > 0);
  });

  test("test-fail-workspace: test fails", async () => {
    const testFailDir = path.join(fixturesDir, "test-fail-workspace");
    const runner = new ProcessValidationRunner(testFailDir);

    // Build should pass
    const buildResult = await runner.runCheck("build");
    assert.strictEqual(buildResult.status, "passed");

    // Test should fail
    const testResult = await runner.runCheck("test");
    assert.strictEqual(testResult.status, "failed");
    assert(testResult.exit_code !== 0);
  });

  test("unknown check rejection", async () => {
    const runner = new ProcessValidationRunner(fixturesDir);
    const report = await runner.runSuite(["unknown-check-id"]);

    assert.strictEqual(report.failed_checks, 1);
    assert(report.checks[0].status === "error");
    assert(report.checks[0].stderr_summary.includes("not found"));
  });

  test("workspace path escape prevention", async () => {
    // Test that relative path with ".." is rejected at validation level
    const result = await validateWorkspacePath("../../../etc/passwd", process.cwd());
    assert(!result.valid);
    assert(result.error?.includes("traversal"));
  });

  test("checksum preservation in results", async () => {
    const runner = new ProcessValidationRunner(fixturesDir);
    const checksum = "sha256:2222222222222222222222222222222222222222222222222222222222222222";

    const result = await runner.runCheck("typecheck", checksum);
    assert.strictEqual(result.artifact_checksum, checksum);

    const suite = await runner.runSuite(["typecheck"], checksum);
    for (const check of suite.checks) {
      assert.strictEqual(check.artifact_checksum, checksum);
    }
  });

  test("timeout-workspace: timeout handling", async () => {
    const timeoutDir = path.join(fixturesDir, "timeout-workspace");
    const markerFile = path.join(timeoutDir, "marker.txt");

    // Clean marker file if it exists
    try {
      await fs.unlink(markerFile);
    } catch {
      // File doesn't exist, that's fine
    }

    // Use short timeout for test (normally 60s, here 1s)
    const runner = new ProcessValidationRunner(timeoutDir, {
      test: { timeout_ms: 1000 },
    });

    // Run test check with short timeout (1s from check-registry)
    // The timeout-workspace test hangs indefinitely
    const result = await runner.runCheck("test");

    // Should timeout with structured status
    assert.strictEqual(
      result.status,
      "timed_out",
      `Expected timed_out status, got: ${result.status}`
    );
    assert.strictEqual(
      result.errorCode,
      "PROCESS_TIMEOUT",
      `Expected PROCESS_TIMEOUT errorCode, got: ${result.errorCode}`
    );
    assert.strictEqual(
      result.timedOut,
      true,
      "Expected timedOut flag to be true"
    );
    assert.strictEqual(
      result.timeoutMs,
      1000,
      `Expected 1000ms timeout, got: ${result.timeoutMs}`
    );
    assert(
      result.terminationMethod,
      "Expected terminationMethod to be set"
    );
    assert.strictEqual(
      result.processTreeTerminationSucceeded,
      true,
      "Expected processTreeTerminationSucceeded to be true"
    );

    // Wait a bit to ensure child process would have created marker file if it continued
    await new Promise(resolve => setTimeout(resolve, 500));

    // Marker file should NOT exist because process was killed before completion
    let markerExists = false;
    try {
      await fs.stat(markerFile);
      markerExists = true;
    } catch {
      // File doesn't exist - process was properly terminated
    }

    assert(
      !markerExists,
      "Marker file should not exist (process terminated by timeout)"
    );
  });

  test("security: injection attack rejection", async () => {
    const runner = new ProcessValidationRunner(fixturesDir);

    // Try various injection patterns
    const injectionAttempts = [
      "build; echo hacked",
      "build && echo hacked",
      "npm test",
      "../build",
      "build | cat",
    ];

    for (const attempt of injectionAttempts) {
      const result = await runner.runCheck(attempt);
      assert.strictEqual(
        result.status,
        "error",
        `Injection "${attempt}" should be rejected`
      );
      assert(
        result.stderr_summary.includes("not found") ||
          result.stderr_summary.includes("error"),
        `No error message for injection: ${attempt}`
      );
    }
  });

  test("environment variable allowlist", async () => {
    const runner = new ProcessValidationRunner(fixturesDir);

    // Set a secret that should be filtered
    const originalEnv = process.env.ANTHROPIC_API_KEY;
    try {
      process.env.ANTHROPIC_API_KEY = "secret-key-12345";
      const result = await runner.runCheck("typecheck");

      // Secret should not appear in results
      assert(!result.stdout_summary.includes("secret-key"));
      assert(!result.stderr_summary.includes("secret-key"));
    } finally {
      if (originalEnv) {
        process.env.ANTHROPIC_API_KEY = originalEnv;
      } else {
        delete process.env.ANTHROPIC_API_KEY;
      }
    }
  });

  test("output size limiting", async () => {
    const runner = new ProcessValidationRunner(fixturesDir);
    const result = await runner.runCheck("typecheck");

    // Verify outputs are summarized (limited to 500 chars)
    assert(result.stdout_summary.length <= 500);
    assert(result.stderr_summary.length <= 500);
  });

  test("check result structure", async () => {
    const runner = new ProcessValidationRunner(fixturesDir);
    const result = await runner.runCheck("build");

    // Verify all required fields
    assert(typeof result.check_id === "string");
    assert(["passed", "failed", "error"].includes(result.status));
    assert(typeof result.duration_ms === "number");
    assert(result.duration_ms >= 0);
    assert(typeof result.stdout_summary === "string");
    assert(typeof result.stderr_summary === "string");
    assert(typeof result.started_at === "string");
    assert(typeof result.finished_at === "string");

    if (result.status !== "passed") {
      assert(typeof result.exit_code === "number");
    }
  });

  test("suite aggregation", async () => {
    const runner = new ProcessValidationRunner(fixturesDir);
    const checksum = "sha256:3333333333333333333333333333333333333333333333333333333333333333";

    const suite = await runner.runSuite(["typecheck", "build"], checksum);

    // Verify suite structure
    assert.strictEqual(suite.total_checks, 2);
    assert(suite.passed_checks + suite.failed_checks > 0);
    assert(Array.isArray(suite.checks));
    assert.strictEqual(suite.checks.length, 2);

    // Each check should have the checksum
    for (const check of suite.checks) {
      assert.strictEqual(check.artifact_checksum, checksum);
    }
  });
});
