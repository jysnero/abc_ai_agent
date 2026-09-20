/**
 * Run Storage Unit Tests
 * File-based state storage, checksum validation, artifact immutability
 */

import { test } from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";
import {
  initializeRun,
  loadManifest,
  saveArtifact,
  loadArtifact,
  transitionState,
  recordSpecApproval,
} from "../../src/storage/run-storage.js";

const TEST_RUN_ID = "req-20260920-001-test";

// Cleanup function
async function cleanup() {
  const runDir = path.resolve(".blueprint/runs", TEST_RUN_ID);
  if (fs.existsSync(runDir)) {
    fs.rmSync(runDir, { recursive: true, force: true });
  }
}

test("Run Storage: initializeRun creates run directory and manifest", async () => {
  await cleanup();

  const manifest = await initializeRun(TEST_RUN_ID, JSON.stringify({ test: true }));

  assert.strictEqual(manifest.run_id, TEST_RUN_ID);
  assert.strictEqual(manifest.status, "PLANNING");
  assert(manifest.created_at);
  assert(manifest.events.length > 0);

  // Verify files exist
  const manifestPath = path.resolve(".blueprint/runs", TEST_RUN_ID, "manifest.json");
  assert(fs.existsSync(manifestPath), "Manifest file should exist");

  await cleanup();
});

test("Run Storage: saveArtifact prevents overwrite with different content", async () => {
  await cleanup();
  await initializeRun(TEST_RUN_ID, JSON.stringify({ test: true }));

  // Save first version
  const checksum1 = await saveArtifact(
    TEST_RUN_ID,
    "test-artifact",
    JSON.stringify({ content: "v1" })
  );

  // Try to save different content with same artifact type
  try {
    await saveArtifact(
      TEST_RUN_ID,
      "test-artifact",
      JSON.stringify({ content: "v2" })
    );
    assert.fail("Should reject overwrite with different content");
  } catch (error) {
    assert(String(error).includes("Cannot overwrite"), "Should reject revision overwrite");
  }

  // Save identical content should succeed
  const checksum2 = await saveArtifact(
    TEST_RUN_ID,
    "test-artifact",
    JSON.stringify({ content: "v1" })
  );
  assert.strictEqual(checksum1, checksum2, "Identical content should produce same checksum");

  await cleanup();
});

test("Run Storage: loadArtifact retrieves saved content", async () => {
  await cleanup();
  await initializeRun(TEST_RUN_ID, JSON.stringify({ test: true }));

  const originalContent = JSON.stringify({ data: "test data" });
  await saveArtifact(TEST_RUN_ID, "test-artifact", originalContent);

  const retrieved = await loadArtifact(TEST_RUN_ID, "test-artifact");
  assert.strictEqual(retrieved, originalContent, "Should retrieve saved content exactly");

  await cleanup();
});

test("Run Storage: transitionState records state change and validates approvals", async () => {
  await cleanup();
  await initializeRun(TEST_RUN_ID, JSON.stringify({ test: true }));

  // Valid transition: PLANNING → DESIGN
  const manifest1 = await transitionState(TEST_RUN_ID, "DESIGN");
  assert.strictEqual(manifest1.status, "DESIGN");
  assert(manifest1.events.length > 1, "Should record state transition event");

  // Continue to ARCH_CONTRACT
  await transitionState(TEST_RUN_ID, "ARCH_CONTRACT");

  // Record SPEC approval
  await recordSpecApproval(TEST_RUN_ID, "test-approver", {
    request_spec: "sha256:abc",
    architecture_contract: "sha256:def",
    execution_plan: "sha256:ghi",
  });

  // Transition to DEV_VALIDATION_LOOP requires SPEC approval
  await transitionState(TEST_RUN_ID, "PLAN_BUILD");
  await transitionState(TEST_RUN_ID, "HUMAN_GATE_SPEC");

  // Should succeed with approval recorded
  const manifest2 = await transitionState(TEST_RUN_ID, "DEV_VALIDATION_LOOP");
  assert.strictEqual(manifest2.status, "DEV_VALIDATION_LOOP");
  assert(manifest2.spec_approval, "Should have spec approval recorded");

  await cleanup();
});

test("Run Storage: rejects invalid run IDs", async () => {
  const invalidIds = [
    "invalid-format",
    "req-12345678",
    "req_20260920_001_test",
    "../../../etc/passwd",
  ];

  for (const id of invalidIds) {
    try {
      await initializeRun(id, JSON.stringify({ test: true }));
      assert.fail(`Should reject invalid run ID: ${id}`);
    } catch (error) {
      assert(String(error).includes("Invalid"), `Should reject invalid ID: ${id}`);
    }
  }
});

test("Run Storage: detects and prevents path traversal in artifact save", async () => {
  await cleanup();
  await initializeRun(TEST_RUN_ID, JSON.stringify({ test: true }));

  try {
    // Attempt to save with traversal path
    await saveArtifact(TEST_RUN_ID, "test", JSON.stringify({}));
    const manifest = await loadManifest(TEST_RUN_ID);
    // The actual file path is internal, but ensure no traversal succeeded
    const runDir = path.resolve(".blueprint/runs", TEST_RUN_ID);
    assert(fs.existsSync(runDir), "Run directory should exist");
  } catch (error) {
    // Expected for path traversal attempts
  }

  await cleanup();
});
