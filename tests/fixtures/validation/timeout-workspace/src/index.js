/**
 * Timeout workspace - test hangs
 */

function neverReturns() {
  // Intentional infinite loop
  while (true) {
    // This will timeout
  }
}

module.exports = { neverReturns };
