#!/usr/bin/env node
// scar-validation/run.mjs
// -----------------------------------------------------------------------------
// This repository's proof entry point. The proof itself lives in the package -
// `sfqa-scar prove` - so someone who installed @sfqa/scar can prove the rules
// they write without cloning anything. This wrapper exists so `npm run
// validate:scar` and CI keep working, and so the repo's fixtures are named in
// one place.
//
// Run from anywhere: node scar-validation/run.mjs
// Exit 1 when a covered rule fails or the clean set leaks a finding.
// -----------------------------------------------------------------------------

import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const cli = join(root, 'packages', 'scar', 'dist', 'cli.js');

if (!existsSync(cli)) {
  console.error('sfqa-scar is not built: no packages/scar/dist/cli.js.');
  console.error('run `npm run build` first (or `npm run check`, which builds before proving).');
  process.exit(2);
}

const result = spawnSync(
  process.execPath,
  [cli, 'prove', '--fixtures', 'scar-validation/fixtures'],
  { cwd: root, stdio: 'inherit' },
);

process.exit(result.status ?? 1);
