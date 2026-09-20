const test = require("node:test");
const assert = require("node:assert");
const { divide } = require("../src/index.js");

test("divide function works correctly", () => {
  assert.strictEqual(divide(10, 2), 5);
  // This assertion will fail
  assert.strictEqual(divide(10, 0), Infinity, "Division by zero should be handled");
});
