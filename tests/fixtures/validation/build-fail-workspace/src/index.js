/**
 * Build fail workspace - has syntax error
 */

function broken(a, b {
  // Missing closing parenthesis - syntax error
  return a + b;
}

module.exports = { broken };
