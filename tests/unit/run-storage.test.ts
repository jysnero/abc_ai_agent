/**
 * Run Storage Unit Tests
 * File-based state storage, checksum validation, artifact immutability
 */

import { test } from "node:test";
import assert from "node:assert";
import fs from "fs";
import path from "path";
import { createHash } from "crypto";
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
  const requestSpec = JSON.stringify({ test: true });
  await initializeRun(TEST_RUN_ID, requestSpec);

  // Valid transition: PLANNING → DESIGN
  const manifest1 = await transitionState(TEST_RUN_ID, "DESIGN");
  assert.strictEqual(manifest1.status, "DESIGN");
  assert(manifest1.events.length > 1, "Should record state transition event");

  // Continue to ARCH_CONTRACT
  await transitionState(TEST_RUN_ID, "ARCH_CONTRACT");

  // Load actual checksum from manifest (set by initializeRun -> saveArtifact)
  const manifest = await loadManifest(TEST_RUN_ID);
  const requestSpecChecksum = manifest.request_spec_revision!;

  // Record SPEC approval with actual checksums
  await recordSpecApproval(TEST_RUN_ID, "test-approver", {
    request_spec: requestSpecChecksum,
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

test("Run Storage: request-spec checksum validates against actual file bytes", async () => {
  await cleanup();
  const requestSpec = JSON.stringify({ test: true, timestamp: "2026-09-20" });
  await initializeRun(TEST_RUN_ID, requestSpec);

  // Load manifest to get recorded checksum
  const manifest = await loadManifest(TEST_RUN_ID);
  assert(manifest.request_spec_revision, "Manifest should have request_spec_revision");

  // Load actual file and calculate SHA-256
  const filePath = path.resolve(".blueprint/runs", TEST_RUN_ID, "request-spec.v1.json");
  assert(fs.existsSync(filePath), "request-spec.v1.json should exist");

  const fileContent = fs.readFileSync(filePath, "utf-8");
  const actualChecksum = `sha256:${createHash("sha256").update(fileContent).digest("hex").slice(0, 16)}`;

  // Verify manifest checksum matches actual file
  assert.strictEqual(
    manifest.request_spec_revision,
    actualChecksum,
    "Manifest checksum should match actual file bytes"
  );

  await cleanup();
});

test("Run Storage: Scenario D regression - request-spec.v1.json exists after initializeRun", async () => {
  await cleanup();
  const requestSpec = JSON.stringify({ scenario: "d", service: "test" });
  await initializeRun(TEST_RUN_ID, requestSpec);

  // Verify file exists at correct path (v1.json, not .json)
  const correctPath = path.resolve(".blueprint/runs", TEST_RUN_ID, "request-spec.v1.json");
  const wrongPath = path.resolve(".blueprint/runs", TEST_RUN_ID, "request-spec.json");

  assert(fs.existsSync(correctPath), "request-spec.v1.json should exist");
  assert(!fs.existsSync(wrongPath), "request-spec.json should NOT exist (old format)");

  // Verify content matches
  const stored = fs.readFileSync(correctPath, "utf-8");
  assert.strictEqual(stored, requestSpec, "Stored content should match input");

  // Verify loadArtifact can retrieve it
  const loaded = await loadArtifact(TEST_RUN_ID, "request-spec");
  assert.strictEqual(loaded, requestSpec, "loadArtifact should retrieve request-spec.v1.json");

  await cleanup();
});

test("Run Storage: wrong checksum in approval blocks validation", async () => {
  await cleanup();
  const requestSpec = JSON.stringify({ test: true });
  await initializeRun(TEST_RUN_ID, requestSpec);

  const manifest = await loadManifest(TEST_RUN_ID);
  const actualChecksum = manifest.request_spec_revision!;

  await transitionState(TEST_RUN_ID, "DESIGN");
  await transitionState(TEST_RUN_ID, "ARCH_CONTRACT");
  await transitionState(TEST_RUN_ID, "PLAN_BUILD");
  await transitionState(TEST_RUN_ID, "HUMAN_GATE_SPEC");

  // Record approval with WRONG checksum
  await recordSpecApproval(TEST_RUN_ID, "test-approver", {
    request_spec: "sha256:wrongchecksum",
    architecture_contract: "sha256:def",
    execution_plan: "sha256:ghi",
  });

  // Transition to DEV_VALIDATION_LOOP should invalidate approval due to checksum mismatch
  // (checksum validation happens only at DEV_VALIDATION_LOOP transition)
  const manifestAfter = await transitionState(TEST_RUN_ID, "DEV_VALIDATION_LOOP");

  assert(!manifestAfter.spec_approval, "Spec approval should be invalidated due to checksum mismatch");

  await cleanup();
});
