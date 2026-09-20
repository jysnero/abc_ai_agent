/**
 * Test fail workspace - build succeeds but test fails
 */

function divide(a, b) {
  // Does not handle division by zero properly
  return a / b;
}

module.exports = { divide };
