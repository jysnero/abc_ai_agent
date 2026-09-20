const test = require("node:test");
const assert = require("node:assert");
const { divide } = require("../src/index.js");

test("divide function works correctly", () => {
  assert.strictEqual(divide(10, 2), 5);
  // This assertion will fail because divide doesn't handle edge cases
  assert.strictEqual(divide(10, 0), 0, "Division by zero should return 0");
});
