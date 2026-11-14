#!/usr/bin/env node
// packages/scar/scripts/build.mjs
// -----------------------------------------------------------------------------
// Build @sfqa/scar from a standalone checkout.
//
// tsc does not clean outDir, so a build that stops emitting source maps leaves
// yesterday's .map files in dist and they would ship. Remove dist first, then
// run the package's own build config. Typescript is resolved from wherever it
// was installed (repo root in a workspace, package root in a single-package
// repo), so this script makes no workspace assumption.
// -----------------------------------------------------------------------------

import { chmodSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const dist = join(packageRoot, 'dist');

rmSync(dist, { recursive: true, force: true });

const require = createRequire(import.meta.url);
let tsc;
try {
  tsc = require.resolve('typescript/bin/tsc');
} catch {
  console.error('scar: typescript is not installed. Run `npm install` first.');
  process.exit(2);
}

const result = spawnSync(process.execPath, [tsc, '-p', join(packageRoot, 'tsconfig.build.json')], {
  cwd: packageRoot,
  stdio: 'inherit',
});

if (result.error) {
  console.error(`scar: build failed: ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) process.exit(result.status ?? 1);

// npm installs a bin by symlinking it and trusting the file mode in the
// tarball. tsc emits 0644, which makes `npx sfqa-scar` a permission error on
// some platforms. Set the bit here so the packaged file is runnable.
chmodSync(join(dist, 'cli.js'), 0o755);
process.exit(0);
