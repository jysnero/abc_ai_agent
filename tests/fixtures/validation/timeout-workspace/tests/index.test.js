const test = require("node:test");
const { neverReturns } = require("../src/index.js");

test("this test will timeout", () => {
  neverReturns(); // This hangs indefinitely
});
