#!/usr/bin/env node
'use strict';

// This package is an alias. It holds no logic of its own: it finds the installed
// @sfqa/scar and runs its CLI with the same arguments, stdio and exit code.

const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { dirname, join } = require('node:path');

let cli;
try {
  const manifest = createRequire(__filename).resolve('@sfqa/scar/package.json');
  cli = join(dirname(manifest), 'dist', 'cli.js');
} catch {
  console.error('sfqa-scar: could not find @sfqa/scar. Reinstall with: npm install -D @sfqa/scar');
  process.exit(2);
}

const result = spawnSync(process.execPath, [cli, ...process.argv.slice(2)], { stdio: 'inherit' });
if (result.error) {
  console.error(`sfqa-scar: ${result.error.message}`);
  process.exit(2);
}
process.exit(result.status === null ? 1 : result.status);
