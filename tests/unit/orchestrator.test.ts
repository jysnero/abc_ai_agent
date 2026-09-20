/**
 * Orchestrator Unit Tests
 * Node.js test runner (node --test)
 */

import { test } from "node:test";
import assert from "node:assert";
import { createOrchestrator, AgentOrchestrator } from "../../src/orchestrator.js";

test("Orchestrator: createOrchestrator returns instance", () => {
  const orchestrator = createOrchestrator();
  assert(orchestrator instanceof AgentOrchestrator, "Should return AgentOrchestrator instance");
});

test("Orchestrator: createRequest generates valid run ID", () => {
  const orchestrator = createOrchestrator();
  const runId = orchestrator.createRequest({
    topic: "Test",
    target: "test",
    requirements: "Test requirements",
  });

  assert(runId.startsWith("req-"), "Run ID should start with 'req-'");
  assert(runId.match(/req-\d{8}-\d{3}-/), "Run ID should match format: req-YYYYMMDD-NNN-*");
});

test("Orchestrator: getRequest returns created request", () => {
  const orchestrator = createOrchestrator();
  const runId = orchestrator.createRequest({
    topic: "Test",
    target: "test",
    requirements: "Test requirements",
  });

  const request = orchestrator.getRequest(runId);
  assert(request, "Request should exist");
  assert.strictEqual(request.id, runId, "Request ID should match");
  assert.strictEqual(request.status, "PLANNING", "Initial status should be PLANNING");
});

test("Orchestrator: transitionState validates transitions", async () => {
  const orchestrator = createOrchestrator();
  const runId = orchestrator.createRequest({
    topic: "Test",
    target: "test",
    requirements: "Test requirements",
  });

  // Valid transition: PLANNING → DESIGN
  await orchestrator.transitionState(runId, "DESIGN", {});
  const request = orchestrator.getRequest(runId);
  assert.strictEqual(request?.status, "DESIGN", "Should transition to DESIGN");

  // Invalid transition: DESIGN → PLANNING (backwards)
  try {
    await orchestrator.transitionState(runId, "PLANNING", {});
    assert.fail("Should reject invalid backward transition");
  } catch (error) {
    assert(String(error).includes("Invalid state transition"), "Should throw transition error");
  }
});

test("Orchestrator: retry count tracking", () => {
  const orchestrator = createOrchestrator();
  const runId = orchestrator.createRequest({
    topic: "Test",
    target: "test",
    requirements: "Test requirements",
  });

  assert(orchestrator.canRetry(runId, "arch"), "Should allow arch retry initially");
  orchestrator.incrementRetryCount(runId, "arch");

  const request = orchestrator.getRequest(runId);
  assert.strictEqual(request?.retryCount.arch, 1, "Retry count should increment");
});

test("Orchestrator: agent registration", () => {
  const orchestrator = createOrchestrator();
  const agents = orchestrator.getAgents("developer");

  assert(agents.length > 0, "Should have developer agents registered");
  assert.strictEqual(agents[0].role, "developer", "Agent role should be developer");
});
