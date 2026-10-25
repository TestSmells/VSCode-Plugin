'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Only compiled, ignored files belong in this directory. Removing it before
// compilation prevents files produced on another branch from entering a VSIX.
const outputDirectory = path.resolve(__dirname, '..', 'out');

if (path.basename(outputDirectory) !== 'out') {
  throw new Error(`Refusing to clean an unexpected directory: ${outputDirectory}`);
}

fs.rmSync(outputDirectory, { force: true, recursive: true });
