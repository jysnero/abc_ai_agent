/**
 * Plan Builder Unit Tests
 * Path validation, glob matching, execution plan validation
 */

import { test } from "node:test";
import assert from "node:assert";
import { validateExecutionPlan, buildExecutionPlan } from "../../src/builders/plan-builder.js";
import type { ExecutionPlan, ArchitectureContract } from "../../src/builders/plan-builder.js";

// Mock contracts and plans
const mockContract: ArchitectureContract = {
  contract_id: "test-contract",
  version: "1.0.0",
  pattern_type: "webview-service",
  issued_by: "test",
  folder_structure: {
    required_files: ["src/main.ts", "src/utils.ts"],
    allowed_globs: ["src/**/*.ts", "tests/**/*.ts"],
  },
  allowed_dependencies: {
    script_hosts: ["localhost:3000"],
    npm_packages: ["@anthropic-ai/sdk"],
  },
  bridge_contract_ref: { contract_id: "bridge", path: "./bridge.json" },
  bridge_policy: { method_a: { max_calls_per_session: 10 } },
  forbidden_patterns: [],
  design_tokens_ref: "tokens.json",
};

const mockExecutionPlan: ExecutionPlan = {
  contract_id: "test-contract",
  version: "1.0.0",
  request_spec_revision: "sha256:abc123",
  target_files: ["src/main.ts", "src/utils.ts"],
  bridge_usage: { method_a: 5 },
  validation_commands: [
    { check_id: "typecheck", command: "npx tsc --noEmit" },
  ],
  completion_criteria: {
    required_files_created: ["src/main.ts", "src/utils.ts"],
    all_validation_pass: true,
    forbidden_patterns: "block_free",
  },
  generated_at: new Date().toISOString(),
};

test("Plan Builder: buildExecutionPlan creates plan from contract", () => {
  const plan = buildExecutionPlan(mockContract);

  assert.strictEqual(plan.contract_id, mockContract.contract_id);
  assert.deepStrictEqual(plan.target_files, mockContract.folder_structure.required_files);
  assert(Object.keys(plan.bridge_usage).length > 0);
});

test("Plan Builder: validateExecutionPlan passes valid plan", () => {
  const result = validateExecutionPlan(mockExecutionPlan, mockContract);

  assert.strictEqual(result.valid, true, "Valid plan should pass validation");
  assert.strictEqual(result.errors.length, 0, "Should have no errors");
});

test("Plan Builder: validateExecutionPlan rejects absolute paths", () => {
  const invalidPlan = {
    ...mockExecutionPlan,
    target_files: ["/etc/passwd", "src/main.ts"],
  };

  const result = validateExecutionPlan(invalidPlan, mockContract);

  assert.strictEqual(result.valid, false, "Plan with absolute path should fail");
  assert(result.errors.some((e) => e.includes("Absolute path")), "Should reject absolute paths");
});

test("Plan Builder: validateExecutionPlan rejects traversal paths", () => {
  const invalidPlan = {
    ...mockExecutionPlan,
    target_files: ["../../../etc/passwd", "src/main.ts"],
  };

  const result = validateExecutionPlan(invalidPlan, mockContract);

  assert.strictEqual(result.valid, false, "Plan with traversal path should fail");
  assert(
    result.errors.some((e) => e.includes("traversal") || e.includes("Parent")),
    "Should reject parent directory traversal"
  );
});

test("Plan Builder: validateExecutionPlan rejects Windows drive paths", () => {
  const invalidPlan = {
    ...mockExecutionPlan,
    target_files: ["C:\\Windows\\System32", "src/main.ts"],
  };

  const result = validateExecutionPlan(invalidPlan, mockContract);

  assert.strictEqual(result.valid, false, "Plan with Windows drive path should fail");
  assert(result.errors.some((e) => e.includes("drive")), "Should reject Windows drive paths");
});

test("Plan Builder: validateExecutionPlan rejects UNC paths", () => {
  const invalidPlan = {
    ...mockExecutionPlan,
    target_files: ["\\\\server\\share\\file.txt", "src/main.ts"],
  };

  const result = validateExecutionPlan(invalidPlan, mockContract);

  assert.strictEqual(result.valid, false, "Plan with UNC path should fail");
  assert(result.errors.some((e) => e.includes("UNC")), "Should reject UNC paths");
});

test("Plan Builder: validateExecutionPlan validates bridge usage", () => {
  const invalidPlan = {
    ...mockExecutionPlan,
    bridge_usage: { method_a: 100, undefined_method: 5 },
  };

  const result = validateExecutionPlan(invalidPlan, mockContract);

  assert.strictEqual(result.valid, false, "Plan with excessive bridge usage should fail");
  assert(
    result.errors.some((e) => e.includes("exceeds max_calls") || e.includes("not in bridge_policy")),
    "Should validate bridge constraints"
  );
});

test("Plan Builder: validateExecutionPlan checks glob pattern matching", () => {
  const invalidPlan = {
    ...mockExecutionPlan,
    target_files: ["forbidden/file.txt"],
  };

  const result = validateExecutionPlan(invalidPlan, mockContract);

  assert.strictEqual(result.valid, false, "File not matching allowed_globs should fail");
  assert(
    result.errors.some((e) => e.includes("does not match any allowed_glob")),
    "Should report glob mismatch"
  );
});
