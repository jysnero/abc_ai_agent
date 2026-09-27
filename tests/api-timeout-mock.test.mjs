/**
 * Test: ClaudeAgentClient Timeout with Network Layer Mock
 *
 * Verify that timeout is handled correctly without making actual API requests.
 * - Mock fetch at transport layer
 * - Inject timeout error
 * - Count HTTP attempts
 * - Verify max_retries=0 respected
 */

import { ClaudeAgentClient } from '../dist/src/runtime/claude-agent-client.js';

console.log('\n=== TEST A: API Timeout with Network Mock ===\n');

// Mock network layer before SDK initialization
const originalFetch = global.fetch;
let httpAttempts = 0;

global.fetch = async (url, options) => {
  httpAttempts++;
  console.log(`  [HTTP] Attempt ${httpAttempts}`);

  // Simulate timeout from network
  const timeoutError = new Error('RequestTimeoutError: The operation timed out.');
  timeoutError.code = 'RequestTimeoutError';
  throw timeoutError;
};

console.log('Setup: Network layer mocked to fail with timeout\n');

const clientConfig = {
  apiKey: 'dummy-key-not-used',
  timeout_ms: 100,
  max_retries: 0
};

const client = new ClaudeAgentClient(clientConfig);

(async () => {
  try {
    console.log('Calling client.chat()...\n');
    await client.chat(
      [{ role: 'user', content: 'test' }],
      'system'
    );

    console.log('✗ FAIL: Expected timeout error');
    global.fetch = originalFetch;
    process.exit(1);
  } catch (error) {
    const msg = error.message || String(error);

    console.log(`Error: ${msg}\n`);

    // Check conditions
    const hasTimeout = msg.includes('timed out');
    const hasRetryZero = msg.includes('after 0 retries');
    const exactlyOneAttempt = httpAttempts === 1;

    console.log(`✓ Timeout detected: ${hasTimeout}`);
    console.log(`✓ max_retries=0 respected: ${hasRetryZero}`);
    console.log(`✓ HTTP attempts: ${httpAttempts} (expected: 1) = ${exactlyOneAttempt}\n`);

    if (!hasTimeout || !hasRetryZero || !exactlyOneAttempt) {
      console.log('✗ TEST FAILED\n');
      global.fetch = originalFetch;
      process.exit(1);
    }

    console.log('=== RESULT: PASS ===\n');
    console.log(`Assertions:`);
    console.log(`  - Timeout error raised: ✓`);
    console.log(`  - max_retries=0 enforced: ✓`);
    console.log(`  - Transport attempts: 1 ✓`);
    console.log(`  - Real API calls: 0 (mocked) ✓\n`);

    global.fetch = originalFetch;
    process.exit(0);
  }
})();
