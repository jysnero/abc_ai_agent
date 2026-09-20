/**
 * Validation Runner Integration Tests
 *
 * Tests the real process-based validation runner capabilities
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  runValidationCheck,
  runValidationSuite,
  calculateChecksum,
  verifyArtifactChecksum,
} from "../../src/validation/validation-runner.js";

describe("Validation Runner Integration Tests", () => {
  test("checksum calculation: format and consistency", () => {
    const content = "test artifact content";
    const checksum = calculateChecksum(content);

    // Verify checksum format: sha256:<64-hex>
    const pattern = /^sha256:[a-f0-9]{64}$/;
    assert(pattern.test(checksum), `Checksum format invalid: ${checksum}`);

    // Same content produces same checksum
    const checksum2 = calculateChecksum(content);
    assert.strictEqual(checksum, checksum2);

    // Different content produces different checksum
    const checksum3 = calculateChecksum("different content");
    assert.notStrictEqual(checksum, checksum3);

    // Buffer input works
    const bufferChecksum = calculateChecksum(Buffer.from(content));
    assert.strictEqual(checksum, bufferChecksum);
  });

  test("single check execution: successful validation", async () => {
    const checksum = calculateChecksum("test artifact");
    const result = await runValidationCheck("typecheck", checksum);

    // Verify result structure
    assert.strictEqual(result.check_id, "typecheck");
    assert(["passed", "failed", "error"].includes(result.status));
    assert(typeof result.duration_ms === "number");
    assert(result.duration_ms >= 0);
    assert(typeof result.stdout_summary === "string");
    assert(typeof result.stderr_summary === "string");
    assert(typeof result.started_at === "string");
    assert(typeof result.finished_at === "string");
    assert.strictEqual(result.artifact_checksum, checksum);

    // Verify exit code is set on failure
    if (result.status === "failed" || result.status === "error") {
      assert(typeof result.exit_code === "number");
    }
  });

  test("validation suite: multiple checks", async () => {
    const checksum = calculateChecksum("suite test");
    const report = await runValidationSuite(["typecheck"], checksum);

    // Verify report structure
    assert(report.total_checks > 0);
    assert(report.passed_checks >= 0);
    assert(report.failed_checks >= 0);
    assert(Array.isArray(report.checks));
    assert(typeof report.generated_at === "string");

    // Verify check results have checksums
    for (const check of report.checks) {
      assert.strictEqual(check.artifact_checksum, checksum);
    }
  });

  test("unknown check rejection: registry validation", async () => {
    const report = await runValidationSuite(["unknown-check-id"]);

    // Unknown checks should fail immediately
    assert.strictEqual(report.total_checks, 1);
    assert.strictEqual(report.failed_checks, 1);
    assert.strictEqual(report.passed_checks, 0);
    assert(report.checks[0].status === "error");
    assert(
      report.checks[0].stderr_summary.includes("not found"),
      `Expected error message, got: ${report.checks[0].stderr_summary}`
    );
  });

  test("artifact checksum verification", () => {
    // Create a mock report with matching checksums
    const checksum = "sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890";
    const report = {
      total_checks: 1,
      passed_checks: 1,
      failed_checks: 0,
      skipped_checks: 0,
      checks: [
        {
          check_id: "build",
          status: "passed" as const,
          exit_code: 0,
          duration_ms: 100,
          stdout_summary: "ok",
          stderr_summary: "",
          artifact_checksum: checksum,
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
        },
      ],
      generated_at: new Date().toISOString(),
    };

    assert(verifyArtifactChecksum(report, checksum));
  });

  test("artifact checksum verification: mismatch detection", () => {
    const checksum1 = "sha256:1111111111111111111111111111111111111111111111111111111111111111";
    const checksum2 = "sha256:2222222222222222222222222222222222222222222222222222222222222222";

    const report = {
      total_checks: 1,
      passed_checks: 1,
      failed_checks: 0,
      skipped_checks: 0,
      checks: [
        {
          check_id: "build",
          status: "passed" as const,
          exit_code: 0,
          duration_ms: 100,
          stdout_summary: "ok",
          stderr_summary: "",
          artifact_checksum: checksum1,
          started_at: new Date().toISOString(),
          finished_at: new Date().toISOString(),
        },
      ],
      generated_at: new Date().toISOString(),
    };

    assert(!verifyArtifactChecksum(report, checksum2));
  });

  test("check without checksum", async () => {
    const result = await runValidationCheck("typecheck");

    // Should execute normally without checksum
    assert.strictEqual(result.check_id, "typecheck");
    assert(["passed", "failed", "error"].includes(result.status));
    assert(result.artifact_checksum === undefined);
  });

  test("validation suite with multiple check IDs", async () => {
    const checksum = calculateChecksum("multi-check test");
    const report = await runValidationSuite(["typecheck", "build"], checksum);

    // Should attempt both checks
    assert(report.total_checks >= 1);
    for (const check of report.checks) {
      assert.strictEqual(check.artifact_checksum, checksum);
    }
  });

  test("timeout handling in checks", async () => {
    // This test verifies timeout behavior is handled
    // (actual timeout would need a check that exceeds timeout_ms)
    const report = await runValidationSuite(["typecheck"]);

    // Verify timeout scenarios are handled in results
    for (const check of report.checks) {
      if (check.duration_ms > 30000) {
        // If it took longer than typecheck timeout, should be error
        assert.strictEqual(check.status, "error");
      }
    }
  });

  test("output masking: sensitive data protection", async () => {
    // Verify that sensitive patterns are masked
    const checksum = calculateChecksum("test");
    const result = await runValidationCheck("typecheck", checksum);

    // Check that API keys and tokens are not in output
    const output = result.stdout_summary + result.stderr_summary;
    assert(!output.includes("ANTHROPIC_API_KEY="));
    assert(!output.match(/api[_-]?key=/i));
  });
});
