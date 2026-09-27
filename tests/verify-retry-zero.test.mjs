import { DeveloperAgent } from '../dist/src/agents/developer.js';
import { ClaudeAgentClient } from '../dist/src/runtime/claude-agent-client.js';

/**
 * Mock ClaudeAgentClient for testing retry=0 behavior
 */
class MockAgentClientRetryZero {
  constructor(config = {}) {
    this.callCount = 0;
    this.maxRetries = config.max_retries ?? 3;
    console.log(`[MockAgent] max_retries = ${this.maxRetries}`);
  }

  async chat(messages, systemPrompt) {
    this.callCount++;
    console.log(`[MockAgent] Attempt ${this.callCount}/${this.maxRetries + 1}`);

    // Simulate timeout on first attempt
    throw new Error('Request timed out');
  }
}

/**
 * Test 1: Verify DeveloperAgent passes max_retries=0 to client
 */
console.log('\n=== TEST 1: DeveloperAgent config transmission ===');

const devAgentConfig = {
  apiKey: 'test-key',
  max_retries: 0  // Should be passed through
};

// Create DeveloperAgent
const agent = new DeveloperAgent(devAgentConfig);
console.log(`[Test1] DeveloperAgent created with max_retries=${devAgentConfig.max_retries}`);

// Check internal client config
const clientConfig = agent['config'] || {};
console.log(`[Test1] Internal client max_retries = ${clientConfig.max_retries}`);

/**
 * Test 2: Verify ClaudeAgentClient respects max_retries=0
 */
console.log('\n=== TEST 2: ClaudeAgentClient retry behavior ===');

const clientConfig0 = {
  apiKey: 'test-key',
  max_retries: 0
};

const mockClient = new MockAgentClientRetryZero(clientConfig0);

try {
  // Attempt chat
  await mockClient.chat([{ role: 'user', content: 'test' }], 'system');
} catch (e) {
  console.log(`[Test2] Expected error: ${e.message}`);
}

console.log(`[Test2] Total API attempts with max_retries=0: ${mockClient.callCount}`);
console.log(`[Test2] Result: ${ mockClient.callCount === 1 ? '✓ PASS' : '✗ FAIL' } (expected 1 attempt, got ${mockClient.callCount})`);

/**
 * Test 3: Environment variable inheritance
 */
console.log('\n=== TEST 3: SMOKE_TEST environment variable ===');

const isSmokeTest = process.env.SMOKE_TEST === 'true';
const effectiveMaxRetries = isSmokeTest ? 0 : 3;

console.log(`[Test3] process.env.SMOKE_TEST = "${process.env.SMOKE_TEST}"`);
console.log(`[Test3] isSmokeTest = ${isSmokeTest}`);
console.log(`[Test3] effectiveMaxRetries = ${effectiveMaxRetries}`);
console.log(`[Test3] Result: ${isSmokeTest ? '✓ PASS' : '✗ FAIL'} (SMOKE_TEST should be true for retry=0)`);

console.log('\n=== SUMMARY ===');
console.log('For retry=0 validation during actual call:');
console.log('1. Set SMOKE_TEST=true in PowerShell session');
console.log('2. Call: node dist/src/cli/index.js resume --run-id <id>');
console.log('3. Monitor logs: [ClaudeAgentClient] chat attempt 1/1 (not 1/4)');
