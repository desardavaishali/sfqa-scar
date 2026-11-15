#!/usr/bin/env node
// packages/scar/scripts/verify.mjs
// -----------------------------------------------------------------------------
// Release gate for @sfqa/scar alone.
//
// scripts/verify-packages.mjs in the workspace checks four packages. This is
// the subset that applies to the one package that publishes: identity, exported
// files, tarball contents, the published entry point, and the product claim
// (ST-001 fires on a known-bad secret).
//
// It resolves the package relative to itself, so it runs unchanged from a
// standalone checkout and from inside the multi-package workspace.
//
// Usage: npm run verify   (after npm run build)
// -----------------------------------------------------------------------------

import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, '..');

const checks = [];

async function check(name, fn) {
  try {
    checks.push({ name, ok: true, detail: await fn() });
  } catch (error) {
    checks.push({
      name,
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const pkgPath = join(packageRoot, 'package.json');
assert(existsSync(pkgPath), `${pkgPath} is missing; is this the @sfqa/scar package directory?`);
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

await check('identity', () => {
  assert(pkg.name === '@sfqa/scar', `unexpected name ${pkg.name}`);
  assert(typeof pkg.version === 'string' && pkg.version.length > 0, 'missing version');
  assert(pkg.license === 'MIT', 'license must be MIT for publish');
  assert(pkg.publishConfig?.access === 'public', 'scoped packages must publish with access=public');
  assert(pkg.bin?.['sfqa-scar'], 'missing the sfqa-scar bin entry');
  return `${pkg.name}@${pkg.version}`;
});

await check('files exist', () => {
  for (const file of pkg.files ?? []) {
    assert(
      existsSync(join(packageRoot, file)),
      `files entry "${file}" does not exist (run npm run build)`,
    );
  }
  return (pkg.files ?? []).join(', ');
});

await check('export targets exist', () => {
  const targets = [];
  for (const [key, value] of Object.entries(pkg.exports ?? {})) {
    const target = typeof value === 'string' ? value : value.types ?? value.import;
    assert(target, `export "${key}" has no types/import target`);
    targets.push(target);
    assert(existsSync(join(packageRoot, target)), `export "${key}" points to missing ${target}`);
  }
  assert(targets.length > 0, 'package.json has no exports');
  return targets.join(', ');
});

await check('docs ship', () => {
  for (const file of ['README.md', 'LICENSE']) {
    assert(existsSync(join(packageRoot, file)), `${file} is missing`);
  }
  return 'README.md, LICENSE';
});

await check('bin paths are normalised (no leading ./)', () => {
  // npm 12 drops a "./dist/cli.js" bin on publish ("invalid and removed"), which
  // would publish a package with no command. Keep the plain form.
  const bins = typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin ?? {});
  assert(bins.length > 0, 'package.json has no bin');
  for (const target of bins) {
    assert(!String(target).startsWith('./'), `bin "${target}" must not start with ./ (use "dist/cli.js")`);
  }
  return bins.join(', ');
});

await check('tarball contains exactly the publishable set', () => {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: packageRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    throw new Error(`npm pack --dry-run failed: ${(result.stderr || result.stdout || '').trim()}`);
  }

  // npm 11 and older print an array; npm 12 prints an object keyed by package name.
  const parsed = JSON.parse(result.stdout);
  const meta = Array.isArray(parsed) ? parsed[0] : Object.values(parsed ?? {})[0];
  assert(meta, 'npm pack produced no metadata');
  const paths = (meta.files ?? []).map((file) => file.path);
  const files = new Set(paths);

  for (const required of [
    'package.json',
    'README.md',
    'LICENSE',
    'dist/index.js',
    'dist/index.d.ts',
    'dist/cli.js',
    'rules/generic.json',
    'prompts/extract-rules.md',
  ]) {
    assert(files.has(required), `tarball is missing ${required}`);
  }

  // Anything outside these prefixes is a leak: tests, fixtures, a local build
  // cache, or a source map that carries a developer's absolute path.
  const allowed = [
    'package.json',
    'README.md',
    'LICENSE',
    'CHANGELOG.md',
    'dist/',
    'rules/',
    'prompts/',
  ];
  const unexpected = paths.filter(
    (path) => !allowed.some((prefix) => (prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix)),
  );
  assert(unexpected.length === 0, `unexpected tarball file(s): ${unexpected.join(', ')}`);

  const maps = paths.filter((path) => path.endsWith('.map'));
  assert(maps.length === 0, `source/declaration maps must not ship: ${maps.join(', ')}`);

  const relativePaths = paths.filter((path) => {
    const full = resolve(packageRoot, path);
    const rel = relative(packageRoot, full);
    return rel.startsWith('..') || rel.includes(`${sep}..${sep}`) || full !== join(packageRoot, path);
  });
  assert(relativePaths.length === 0, `tarball entry escapes the package: ${relativePaths.join(', ')}`);

  return `${paths.length} files, ${meta.size ?? '?'} bytes`;
});

await check('imports from the published entry', async () => {
  const entry = pkg.exports?.['.']?.import;
  assert(entry, 'package.json has no root import export');
  const distEntry = join(packageRoot, entry);
  assert(existsSync(distEntry), `built entry is missing: ${entry} (run npm run build)`);
  const mod = await import(pathToFileURL(distEntry).href);
  for (const name of ['loadRuleSet', 'compileRuleSet', 'lintContent']) {
    assert(name in mod, `${name} is missing from the published entry`);
  }
  return `${Object.keys(mod).length} exports`;
});

// npm installs the bin as a symlink. Comparing argv[1] to import.meta.url is
// then false, and the CLI exits 0 with no output - indistinguishable from a
// clean scan. This check runs the bin exactly the way npx does.
await check('the bin runs when invoked through a symlink', () => {
  const cli = join(packageRoot, 'dist', 'cli.js');
  const dir = mkdtempSync(join(tmpdir(), 'scar-bin-'));
  try {
    const link = join(dir, 'sfqa-scar');
    symlinkSync(cli, link);
    const result = spawnSync(link, ['--help'], { encoding: 'utf8' });
    assert(!result.error, `could not execute the bin: ${result.error?.message}`);
    assert(result.status === 0, `bin exited ${result.status}: ${(result.stderr || '').trim()}`);
    assert(
      (result.stdout || '').includes('sfqa-scar - review code'),
      'bin produced no usage output; it probably exited before main() ran',
    );
    return 'symlinked bin prints usage';
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

await check('packaged rule set fires on a known-bad secret', async () => {
  const { compileRuleSet, lintContent, loadRuleSet } = await import(
    pathToFileURL(join(packageRoot, pkg.exports['.'].import)).href
  );
  const rulesPath = join(packageRoot, 'rules/generic.json');
  const set = loadRuleSet(rulesPath);
  const findings = lintContent(
    'test-lib/setup/env.ts',
    "export const password = 'SuperSecret123';",
    compileRuleSet(set),
  );
  assert(
    findings.some((finding) => finding.rule.id === 'ST-001'),
    'ST-001 did not fire on a hardcoded secret',
  );
  return `ST-001 fired; ${set.rules.length} rules loaded`;
});

for (const c of checks) {
  console.log(`${c.ok ? 'ok  ' : 'FAIL'}  ${c.name}${c.detail ? ` - ${c.detail}` : ''}`);
}

const failures = checks.filter((c) => !c.ok);
console.log('');
if (failures.length > 0) {
  console.error(`@sfqa/scar release gate failed: ${failures.length} check(s)`);
  process.exit(1);
}
console.log(`@sfqa/scar release gate passed: ${checks.length} checks`);
