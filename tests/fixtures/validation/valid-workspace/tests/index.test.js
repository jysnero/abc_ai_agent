const test = require("node:test");
const assert = require("node:assert");
const { add, subtract } = require("../src/index.js");

test("add function works correctly", () => {
  assert.strictEqual(add(2, 3), 5);
  assert.strictEqual(add(-1, 1), 0);
});

test("subtract function works correctly", () => {
  assert.strictEqual(subtract(5, 3), 2);
  assert.strictEqual(subtract(0, 5), -5);
});
