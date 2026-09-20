/**
 * Timeout workspace - test hangs
 */

const fs = require("fs");
const path = require("path");

function neverReturns() {
  // Schedule marker file creation in 2 seconds
  // If process is killed by timeout, this won't execute
  setTimeout(() => {
    const markerPath = path.join(__dirname, "../marker.txt");
    fs.writeFileSync(markerPath, "Process completed");
  }, 2000);

  // Intentional infinite loop
  while (true) {
    // This will timeout
  }
}

module.exports = { neverReturns };
