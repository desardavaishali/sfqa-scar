// packages/scar/test/scar.test.ts
// -----------------------------------------------------------------------------
// Proves the scar reviewer is a rule engine, not a pile of regexes:
//   - the packaged rule set is valid and 18 of 19 rules have a detector
//   - each detector family fires and stays silent where it should
//   - exemptions are scoped: a file-level mitigation clears the file, a
//     line-level exemption clears one line
//   - a comment that mentions a bad pattern is not a recurrence
//   - the CLI reports JSON and returns the documented exit codes
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CliError,
  DEFAULT_RULES,
  compileRuleSet,
  compileRule,
  fixtureRelativePath,
  formatMarkdown,
  formatProof,
  formatScaffold,
  gitIgnoredSet,
  globToRegex,
  isExecutable,
  lintContent,
  loadRuleSet,
  normaliseScope,
  parseArgs,
  parseNewArgs,
  parseProveArgs,
  proveRules,
  run,
  runNew,
  runProve,
  scaffoldRule,
  scanFiles,
  validateRuleSet,
  walk,
  type ScarRule,
} from '../src/index.js';

const RULES_PATH = fileURLToPath(new URL('../rules/generic.json', import.meta.url));
const ruleSet = loadRuleSet(RULES_PATH);
const rules = compileRuleSet(ruleSet);

function lint(relPath: string, content: string): ReturnType<typeof lintContent> {
  return lintContent(relPath, content, rules);
}

function idsFor(relPath: string, content: string): string[] {
  return lint(relPath, content).map((finding) => finding.rule.id);
}

test('the packaged rule set is valid and keeps 18 executable rules', () => {
  assert.equal(ruleSet.rules.length, 19);

  const ids = ruleSet.rules.map((rule) => rule.id);
  assert.equal(new Set(ids).size, ids.length, 'rule ids must be unique');

  const executable = ruleSet.rules.filter(isExecutable).map((rule) => rule.id);
  const gaps = ruleSet.rules.filter((rule) => !isExecutable(rule)).map((rule) => rule.id);

  assert.equal(executable.length, 18);
  assert.deepEqual(gaps, ['ST-018']);
  assert.equal(ruleSet.generated_from_repo, 'template (client-free)');
});

test('globToRegex anchors and supports **, * and ?', () => {
  assert.ok(globToRegex('features/**').test('features/sales/order.feature'));
  assert.ok(globToRegex('**/env*.ts').test('test-lib/setup/env.ts'));
  assert.ok(globToRegex('*.config.*').test('playwright.config.ts'));
  assert.ok(globToRegex('test-constants/?.ts').test('test-constants/a.ts'));
  assert.equal(globToRegex('test-constants/?.ts').test('test-constants/ab.ts'), false);
  assert.equal(globToRegex('features/**').test('test-pages/web/Page.ts'), false);
});

test('ST-001 fires on a hardcoded secret and clears an empty env fallback', () => {
  assert.deepEqual(idsFor('test-lib/setup/env.ts', "export const password = 'SuperSecret123';"), [
    'ST-001',
  ]);
  assert.deepEqual(
    idsFor('test-lib/setup/env.ts', "export const password = process.env.ADMIN_PASSWORD || '';"),
    [],
  );
  // A key handed to a lookup is not a hardcoded secret.
  assert.deepEqual(idsFor('scripts/deploy.mts', 'const password = map.get("password");'), []);
});

test('ST-003 ignores map values and ternary branches, and flags array elements', () => {
  // A field-name map: the canonical label on the left, the API name on the right.
  assert.deepEqual(
    idsFor('test-lib/bdd/fieldMap.ts', "export const fields = {\n  'Email': 'email',\n};"),
    [],
  );
  // A ternary choosing between two values is not label drift.
  assert.deepEqual(
    idsFor('test-lib/setup/validate.ts', "const field = isEmail ? 'email' : 'name';"),
    [],
  );
  // An array element is exactly where a drifted picklist value lives.
  assert.deepEqual(idsFor('test-constants/Leads.ts', "export const contact = ['email'];"), [
    'ST-003',
    'ST-015',
  ]);
});

test('ST-003 catches case and spacing drift without flagging exact labels', () => {
  const drift = idsFor(
    'test-constants/Leads.ts',
    // No provenance marker, so ST-015 is expected too.
    "export const source = ['web', 'Event'];\nexport const contact = 'PreferredContact';",
  );
  assert.ok(drift.includes('ST-003'));

  const labelFindings = lint(
    'test-constants/Leads.ts',
    "export const source = ['web', 'Event'];\nexport const contact = 'PreferredContact';",
  ).filter((finding) => finding.rule.id === 'ST-003');
  assert.equal(labelFindings.length, 2);
  assert.match(labelFindings[0].meta ?? '', /case drift/);
  assert.match(labelFindings[1].meta ?? '', /spacing\/hyphen drift/);

  assert.deepEqual(
    idsFor(
      'test-constants/Leads.ts',
      "// verified against the org describe\nexport const source = ['Web', 'Event'];\nexport const contact = 'Preferred Contact';",
    ),
    [],
  );
});

test('ST-004 fires on isVisible with options and stays silent on waitFor', () => {
  assert.deepEqual(
    idsFor('test-pages/web/Page.ts', 'const v = await label.isVisible({ timeout: 5000 });'),
    ['ST-004'],
  );
  assert.deepEqual(
    idsFor(
      'test-pages/web/Page.ts',
      "const v = await label.waitFor({ state: 'visible', timeout: 5000 });",
    ),
    [],
  );
  // A guarded call is an explicit "is it there right now?" probe, not an assertion.
  assert.deepEqual(
    idsFor(
      'test-pages/web/Page.ts',
      'if (await label.isVisible({ timeout: 5000 }).catch(() => false)) {',
    ),
    [],
  );
});

test('ST-009 uses the numeric range, not the presence of a timeout', () => {
  assert.deepEqual(
    idsFor('playwright.config.ts', 'export default {\n  timeout: 180000,\n};'),
    ['ST-009'],
  );
  assert.deepEqual(
    idsFor('playwright.config.ts', 'export default {\n  timeout: 360000,\n};'),
    [],
  );
});

test('ST-013 clears the whole file when page objects use the active page', () => {
  assert.deepEqual(
    idsFor('test-lib/bdd/steps/conv.steps.ts', 'const lead = new LeadPage(page, ctx);'),
    ['ST-013'],
  );
  assert.deepEqual(
    idsFor('test-lib/bdd/steps/conv.steps.ts', 'const lead = new LeadPage(activePage, ctx);'),
    [],
  );
});

test('ST-016 is a required-signal rule: no coupling map, one finding', () => {
  const generator = 'test-lib/utils/TestDataGenerator.ts';
  assert.deepEqual(idsFor(generator, "export const generate = () => ({ salutation: 'Mr' });"), [
    'ST-016',
  ]);
  assert.deepEqual(
    idsFor(
      generator,
      "export const SALUTATION_GENDER = { Mr: 'Male' };\nexport const generate = () => ({});",
    ),
    [],
  );
});

test('a comment that mentions a bad pattern is not a recurrence', () => {
  assert.deepEqual(
    idsFor('test-pages/web/Page.ts', '// never call .isVisible({ timeout: 1 }) here'),
    [],
  );
});

test('the ignore ledger is asked once for all matched files', () => {
  const root = mkdtempSync(join(tmpdir(), 'scar-batch-'));
  const asked: string[][] = [];
  try {
    for (let i = 0; i < 5; i++) {
      writeFileSync(join(root, `env${i}.ts`), "export const password = 'SuperSecret123';\n");
    }
    writeFileSync(join(root, 'clean.ts'), 'export const ok = 1;\n');

    const result = scanFiles(root, walk(root), rules, {
      isIgnored: (relPath) => {
        asked.push([relPath]);
        return relPath === 'env0.ts';
      },
    });

    assert.equal(result.findings.length >= 5, true);
    // One call per file that matched, never for the clean file.
    assert.equal(asked.length, 5);
    assert.equal(asked.some((entry) => entry[0] === 'clean.ts'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('gitIgnoredSet returns the same answer as isGitIgnored, in one call', () => {
  const root = mkdtempSync(join(tmpdir(), 'scar-gitignore-'));
  try {
    writeFileSync(join(root, '.gitignore'), 'ignored/\n');
    mkdirSync(join(root, 'ignored'));
    writeFileSync(join(root, 'ignored', 'a.ts'), 'x\n');
    writeFileSync(join(root, 'kept.ts'), 'x\n');
    spawnSync('git', ['init', '-q'], { cwd: root });

    const set = gitIgnoredSet(root, ['ignored/a.ts', 'kept.ts']);
    assert.equal(set.has('ignored/a.ts'), true);
    assert.equal(set.has('kept.ts'), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('findings in gitignored files are downgraded to low, not hidden', () => {
  const findings = lintContent(
    'test-lib/setup/env.ts',
    "export const password = 'SuperSecret123';",
    rules,
    { ignored: true },
  );
  assert.equal(findings.length, 1);
  assert.equal(findings[0].rule.id, 'ST-001');
  assert.equal(findings[0].rule.severity, 'low');
  assert.match(findings[0].snippet, /gitignored - informational/);
});

test('scanFiles walks a tree, skips binary extensions and reports findings', () => {
  const root = mkdtempSync(join(tmpdir(), 'scar-test-'));
  try {
    mkdirSync(join(root, 'test-pages/web'), { recursive: true });
    mkdirSync(join(root, 'test-constants'), { recursive: true });
    writeFileSync(
      join(root, 'test-pages/web/Page.ts'),
      'const v = await label.isVisible({ timeout: 5000 });',
    );
    writeFileSync(join(root, 'test-constants/Leads.ts'), "export const source = ['web'];");
    writeFileSync(join(root, 'logo.png'), 'not really a png');

    const result = scanFiles(root, walk(root), rules, { isIgnored: () => false });
    const ids = result.findings.map((finding) => finding.rule.id);

    assert.equal(result.filesScanned, 2);
    assert.ok(ids.includes('ST-004'));
    assert.ok(ids.includes('ST-003'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the CLI emits JSON and returns exit 1 at the default threshold', () => {
  const root = mkdtempSync(join(tmpdir(), 'scar-cli-'));
  const original = console.log;
  try {
    writeFileSync(join(root, 'env.ts'), "export const password = 'SuperSecret123';");

    let output = '';
    console.log = (message?: unknown) => {
      output += String(message);
    };
    const code = run(
      parseArgs(['--json', '--rules', RULES_PATH, '--fail-on', 'high', root]),
      root,
    );
    console.log = original;

    assert.equal(code, 1);
    const report = JSON.parse(output) as {
      tool: string;
      filesScanned: number;
      summary: { high: number };
      findings: Array<{ id: string; file: string }>;
    };
    assert.equal(report.tool, 'sfqa-scar');
    assert.equal(report.filesScanned, 1);
    assert.ok(report.summary.high >= 1);
    assert.equal(report.findings[0].id, 'ST-001');
    assert.equal(report.findings[0].file, 'env.ts');
  } finally {
    console.log = original;
    rmSync(root, { recursive: true, force: true });
  }
});

test('markdown output is relative, one line per row, and dedupes the fix list', () => {
  const root = mkdtempSync(join(tmpdir(), 'scar-md-'));
  const original = console.log;
  try {
    mkdirSync(join(root, 'nested'));
    writeFileSync(join(root, 'env.ts'), "export const password = 'SuperSecret123';\n");
    writeFileSync(join(root, 'nested', 'env2.ts'), "export const token = 'SuperSecret123';\n");

    let output = '';
    console.log = (message?: unknown) => {
      output += String(message);
    };
    const code = run(
      parseArgs(['--markdown', '--rules', RULES_PATH, '--fail-on', 'high', root]),
      root,
    );
    console.log = original;

    assert.equal(code, 1);
    // A pasted or screenshotted block must not carry the scan directory.
    assert.equal(output.includes(root), false);
    const rows = output.split('\n').filter((line) => line.startsWith('| ST-'));
    assert.ok(rows.length >= 2);
    for (const row of rows) assert.equal(row.trimEnd().endsWith('|'), true);
    // One fix block per rule, however many findings it produced.
    assert.equal(output.split('**ST-001**').length - 1, 1);
    assert.ok(output.includes('### Fixes'));
  } finally {
    console.log = original;
    rmSync(root, { recursive: true, force: true });
  }
});

test('a clean scan says so instead of printing an empty table', () => {
  const report = {
    tool: 'sfqa-scar' as const,
    ruleSet: '/tmp/rules.json',
    filesScanned: 4,
    summary: { high: 0, med: 0, low: 0 },
    findings: [],
  };
  const markdown = formatMarkdown(report);
  assert.ok(markdown.includes('**Clean**'));
  assert.equal(markdown.includes('| Rule |'), false);
});

test('a pipe in a matched line cannot split the table row', () => {
  const report = {
    tool: 'sfqa-scar' as const,
    ruleSet: '/tmp/rules.json',
    filesScanned: 1,
    summary: { high: 1, med: 0, low: 0 },
    findings: [
      {
        rule: rule({ id: 'ST-900', severity: 'high', recommendation: 'Fix it.' }),
        relPath: 'a.ts',
        line: 3,
        snippet: 'const x = a || b;',
      },
    ],
  };
  const row = formatMarkdown(report).split('\n').find((line) => line.startsWith('| ST-900 |'));
  assert.ok(row);
  assert.equal(row.includes('a \\|\\| b'), true);
});

test('parseArgs rejects asking for two output formats at once', () => {
  const root = mkdtempSync(join(tmpdir(), 'scar-both-'));
  const original = console.error;
  try {
    writeFileSync(join(root, 'env.ts'), "export const password = 'SuperSecret123';\n");
    let errors = '';
    console.error = (message?: unknown) => {
      errors += String(message);
    };
    const code = run(parseArgs(['--json', '--markdown', '--rules', RULES_PATH, root]), root);
    console.error = original;
    assert.equal(code, 2);
    assert.ok(errors.includes('mutually exclusive'));
  } finally {
    console.error = original;
    rmSync(root, { recursive: true, force: true });
  }
});

test('parseArgs validates options and the default rules file exists', () => {
  assert.ok(DEFAULT_RULES.endsWith('rules/generic.json'));
  assert.throws(() => parseArgs(['--fail-on', 'sometimes']), CliError);
  assert.throws(() => parseArgs(['--max-per-rule', '0']), CliError);
  assert.throws(() => parseArgs(['--rules']), CliError);
  assert.throws(() => parseArgs(['--nope']), CliError);

  const options = parseArgs(['--staged', '--json', '--fail-on', 'med', 'src/']);
  assert.equal(options.staged, true);
  assert.equal(options.json, true);
  assert.equal(options.failOn, 'med');
  assert.deepEqual(options.paths, ['src/']);
});

// ---------------------------------------------------------------------------
// `new` - the scaffold. The two things people get wrong are mechanical: which id
// is free, and where the fixture has to live. Both are decisions, not typing.
// ---------------------------------------------------------------------------

test('fixtureRelativePath turns a scope into a directory the rule actually scans', () => {
  assert.equal(fixtureRelativePath('test-pages/**', 'ST-020'), 'test-pages/st-020.ts');
  assert.equal(fixtureRelativePath('test-pages/web/*.ts', 'ST-020'), 'test-pages/web/st-020.ts');
  assert.equal(fixtureRelativePath('features/**', 'ST-020'), 'features/st-020.feature');
  assert.equal(fixtureRelativePath('playwright.config.ts', 'ST-020'), 'playwright.config.ts');
  assert.equal(fixtureRelativePath('./src/**/*.js', 'ST-020'), 'src/st-020.js');
});

test('new writes one rule and both fixtures, and advances the id', () => {
  const root = mkdtempSync(join(tmpdir(), 'scar-new-'));
  try {
    writeFileSync(
      join(root, 'scar-tissue.json'),
      JSON.stringify({ version: 1, rules: [rule({ id: 'ST-007' })] }, null, 2),
    );

    const first = scaffoldRule({
      title: 'Never pass options to isVisible().',
      scope: ['test-pages/**'],
      rulesPath: 'scar-tissue.json',
      fixtureRoot: 'scar-fixtures',
      cwd: root,
    });
    assert.equal(first.id, 'ST-008');
    assert.equal(first.positivePath, 'scar-fixtures/positive/test-pages/st-008.ts');
    assert.equal(first.negativePath, 'scar-fixtures/negative/test-pages/st-008.ts');
    assert.equal(first.createdRuleFile, false);

    const written = JSON.parse(readFileSync(join(root, 'scar-tissue.json'), 'utf8')) as {
      rules: ScarRule[];
    };
    assert.equal(written.rules.length, 2);
    const created = written.rules[1];
    assert.equal(created.id, 'ST-008');
    // A scaffold must not pretend to enforce anything.
    assert.deepEqual(created.match?.linePatterns, []);
    assert.equal(isExecutable(created), false);

    // The hint text is the difference between a person finding the fixture and guessing.
    assert.ok(first.nextSteps.join('\n').includes('test-pages/**'));
    assert.ok(formatScaffold(first).includes('prove --id ST-008'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a plain directory is a scope anyone can write', () => {
  assert.equal(normaliseScope('test-pages/'), 'test-pages/**');
  assert.equal(normaliseScope('test-pages'), 'test-pages/**');
  assert.equal(normaliseScope('./test-pages'), 'test-pages/**');
  assert.equal(normaliseScope('test-pages/**'), 'test-pages/**');
  assert.equal(normaliseScope('playwright.config.ts'), 'playwright.config.ts');
  // A scope of "/" would silently match the whole repository.
  assert.throws(() => normaliseScope('/'), /name a directory/);
});

test('new writes a fixture pair for every scope and refuses the same sentence twice', () => {
  const root = mkdtempSync(join(tmpdir(), 'scar-new-multi-'));
  try {
    const result = scaffoldRule({
      title: 'Never pass options to isVisible().',
      scope: ['test-pages/', 'test-lib/helpers'],
      rulesPath: 'scar-tissue.json',
      fixtureRoot: 'scar-fixtures',
      cwd: root,
    });
    assert.equal(result.positivePath, 'scar-fixtures/positive/test-pages/st-001.ts');
    assert.deepEqual(result.otherFixtures, [
      'scar-fixtures/positive/test-lib/helpers/st-001.ts',
      'scar-fixtures/negative/test-lib/helpers/st-001.ts',
    ]);
    assert.ok(formatScaffold(result).includes('also'));

    const written = JSON.parse(readFileSync(join(root, 'scar-tissue.json'), 'utf8')) as {
      rules: ScarRule[];
    };
    assert.deepEqual(written.rules[0].match?.pathInclude, ['test-pages/**', 'test-lib/helpers/**']);

    // Same sentence, different spelling of case, is still the same rule.
    assert.throws(
      () =>
        scaffoldRule({
          title: 'never pass options to ISVISIBLE().',
          scope: ['test-pages/'],
          rulesPath: 'scar-tissue.json',
          fixtureRoot: 'scar-fixtures',
          cwd: root,
        }),
      /already says that/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('new warns when the scope matches nothing in this repo', () => {
  const root = mkdtempSync(join(tmpdir(), 'scar-new-typo-'));
  try {
    mkdirSync(join(root, 'test-pages'));
    writeFileSync(join(root, 'test-pages', 'a.ts'), 'export {};\n');

    const typo = scaffoldRule({
      title: 'A rule.',
      scope: ['test-page/'],
      rulesPath: 'scar-tissue.json',
      fixtureRoot: 'scar-fixtures',
      cwd: root,
    });
    const hint = typo.nextSteps.find((step) => step.startsWith('warning:'));
    assert.ok(hint, 'a scope matching no real file must warn');
    assert.ok(hint.includes('test-page/**'));

    const real = scaffoldRule({
      title: 'Another rule.',
      scope: ['test-pages/'],
      rulesPath: 'scar-tissue.json',
      fixtureRoot: 'scar-fixtures',
      cwd: root,
    });
    assert.equal(real.nextSteps.some((step) => step.startsWith('warning:')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('new starts a rule file when the repo has none', () => {
  const root = mkdtempSync(join(tmpdir(), 'scar-new-file-'));
  try {
    const result = scaffoldRule({
      title: 'Never commit a fixed sleep.',
      scope: ['test-lib/**'],
      rulesPath: 'scar-tissue.json',
      fixtureRoot: 'scar-fixtures',
      cwd: root,
    });
    assert.equal(result.createdRuleFile, true);
    assert.equal(result.id, 'ST-001');
    assert.ok(readFileSync(join(root, 'scar-tissue.json'), 'utf8').includes('ST-001'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('new refuses a duplicate id, a missing scope and an existing fixture', () => {
  const root = mkdtempSync(join(tmpdir(), 'scar-new-bad-'));
  try {
    writeFileSync(
      join(root, 'scar-tissue.json'),
      JSON.stringify({ version: 1, rules: [rule({ id: 'ST-007' })] }),
    );
    const base = {
      title: 'A rule.',
      scope: ['test-pages/**'],
      rulesPath: 'scar-tissue.json',
      fixtureRoot: 'scar-fixtures',
      cwd: root,
    };
    assert.throws(() => scaffoldRule({ ...base, id: 'ST-007' }), /already exists/);
    assert.throws(() => scaffoldRule({ ...base, id: 'nope' }), /must look like/);
    assert.throws(() => scaffoldRule({ ...base, scope: [] }), /--scope is required/);
    assert.throws(() => scaffoldRule({ ...base, title: '  ' }), /one sentence/);

    // A fresh id whose fixture path is already taken must not be clobbered.
    const taken = join(root, 'scar-fixtures', 'positive', 'test-pages', 'st-008.ts');
    mkdirSync(dirname(taken), { recursive: true });
    writeFileSync(taken, 'someone else\'s fixture\n');
    assert.throws(
      () => scaffoldRule({ ...base, id: 'ST-008', title: 'A different rule.' }),
      /refusing to overwrite/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('runNew defaults to a local rule file, never the packaged template', () => {
  const root = mkdtempSync(join(tmpdir(), 'scar-new-cli-'));
  const original = console.log;
  try {
    let output = '';
    console.log = (message?: unknown) => {
      output += String(message);
    };
    const code = runNew(
      parseNewArgs(['--rule', 'Never pass options to isVisible().', '--scope', 'test-pages/**']),
      root,
    );
    console.log = original;

    assert.equal(code, 0);
    assert.ok(output.includes('scar-tissue.json'));
    assert.equal(output.includes(root), false);
    // The packaged template must be untouched: it ships in the tarball.
    const packaged = JSON.parse(readFileSync(RULES_PATH, 'utf8')) as { rules: ScarRule[] };
    assert.equal(packaged.rules.some((entry) => entry.id === 'ST-020'), false);
    assert.ok(readFileSync(join(root, 'scar-tissue.json'), 'utf8').includes('ST-001'));
  } finally {
    console.log = original;
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// `prove` - the fixture proof, shipped to consumers. A rule that cannot fire is
// a gap, never coverage.
// ---------------------------------------------------------------------------

function fixtures(root: string, positive: string, negative: string): string {
  const dir = join(root, 'scar-fixtures');
  for (const [side, body] of [
    ['positive', positive],
    ['negative', negative],
  ] as const) {
    const target = join(dir, side, 'test-pages', 'sample.ts');
    mkdirSync(join(dir, side, 'test-pages'), { recursive: true });
    writeFileSync(target, body);
  }
  return dir;
}

test('prove reports fires/clean, and a failing pattern is not a pass', () => {
  const root = mkdtempSync(join(tmpdir(), 'scar-prove-'));
  try {
    const dir = fixtures(
      root,
      'const shown = await row.isVisible({ timeout: 5000 });\n',
      'const shown = await row.isVisible();\n',
    );
    const good = rule({
      id: 'ST-900',
      match: { pathInclude: ['test-pages/**'], linePatterns: ['isVisible\\(\\s*\\{'] },
    });

    const pass = proveRules([good], dir);
    assert.equal(pass.proofs[0].positive, 'fires');
    assert.equal(pass.proofs[0].clean, 'clean');
    assert.equal(pass.passed, true);

    const leak = proveRules([{ ...good, match: { pathInclude: ['test-pages/**'], linePatterns: ['isVisible\\('] } }], dir);
    assert.equal(leak.proofs[0].clean, 'leak');
    assert.equal(leak.passed, false);

    const missing = proveRules([{ ...good, match: { pathInclude: ['features/**'], linePatterns: ['isVisible\\('] } }], dir);
    assert.equal(missing.proofs[0].positive, 'missing');
    assert.equal(missing.passed, false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prove counts a rule with no detector as a gap, and proves nothing over an all-gap set', () => {
  const root = mkdtempSync(join(tmpdir(), 'scar-prove-gap-'));
  try {
    const dir = fixtures(root, 'nothing to see\n', 'nothing to see\n');
    const gap = rule({ id: 'ST-901', match: { pathInclude: ['test-pages/**'] } });

    const result = proveRules([gap], dir);
    assert.equal(result.executable, 0);
    assert.equal(result.gaps, 1);
    assert.equal(result.proofs[0].positive, 'n/a');
    // 0/0 must never read as success.
    assert.equal(result.passed, false);

    const text = formatProof(result, 'scar-tissue.json', 1, 'scar-fixtures');
    assert.ok(text.includes('GAPS'));
    assert.ok(text.includes('FAIL: no rule fired'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prove tells you the scope when a fixture never made the rule fire', () => {
  const root = mkdtempSync(join(tmpdir(), 'scar-prove-scope-'));
  try {
    const dir = fixtures(root, 'nothing to see\n', 'nothing to see\n');
    const ruleWithScope = rule({
      id: 'ST-902',
      match: { pathInclude: ['features/**'], linePatterns: ['bad'] },
    });
    const text = formatProof(proveRules([ruleWithScope], dir), 'scar-tissue.json', 1, 'scar-fixtures');

    assert.ok(text.includes('MISSING'));
    assert.ok(text.includes('scoped to: features/**'));
    assert.ok(text.includes('positive/'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prove --id narrows the run and rejects an unknown id', () => {
  const root = mkdtempSync(join(tmpdir(), 'scar-prove-id-'));
  try {
    const dir = fixtures(root, 'bad\n', 'good\n');
    const set = [rule({ id: 'ST-903' }), rule({ id: 'ST-904' })];
    const one = proveRules(set, dir, ['ST-904']);
    assert.deepEqual(one.proofs.map((proof) => proof.id), ['ST-904']);
    assert.throws(() => proveRules(set, dir, ['ST-999']), /no rule with id ST-999/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prove without fixtures explains how to make the first pair', () => {
  const root = mkdtempSync(join(tmpdir(), 'scar-prove-none-'));
  try {
    assert.throws(() => proveRules([rule()], join(root, 'scar-fixtures')), /sfqa-scar new/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('prove returns 1 when a proof fails, and the scan reads the same rule file', () => {
  const root = mkdtempSync(join(tmpdir(), 'scar-prove-cli-'));
  const original = console.log;
  try {
    fixtures(root, 'const shown = await row.isVisible({ timeout: 5000 });\n', 'await row.isVisible();\n');
    writeFileSync(
      join(root, 'scar-tissue.json'),
      JSON.stringify(
        {
          version: 1,
          rules: [
            rule({
              id: 'ST-905',
              match: { pathInclude: ['test-pages/**'], linePatterns: ['isVisible\\(\\s*\\{'] },
            }),
          ],
        },
        null,
        2,
      ),
    );
    mkdirSync(join(root, 'test-pages'));
    writeFileSync(join(root, 'test-pages', 'Page.ts'), 'const shown = await row.isVisible({ timeout: 5000 });\n');

    let output = '';
    console.log = (message?: unknown) => {
      output += `${String(message)}\n`;
    };
    assert.equal(runProve(parseProveArgs([]), root), 0);
    // A local rule set wins over the packaged template, or the rule you just
    // wrote appears to do nothing.
    assert.equal(run(parseArgs(['--fail-on', 'med', root]), root), 1);
    console.log = original;

    assert.ok(output.includes('rule set: scar-tissue.json'));
    assert.ok(output.includes('[MED] ST-905'));
  } finally {
    console.log = original;
    rmSync(root, { recursive: true, force: true });
  }
});

function rule(overrides: Partial<ScarRule> = {}): ScarRule {
  return {
    id: 'XX-001',
    rule: 'A rule.',
    context: 'Somewhere.',
    origin: { summary: 'An incident.' },
    severity: 'med',
    detection_pattern: 'A pattern.',
    match: { linePatterns: ['bad'] },
    recommendation: 'Do better.',
    ...overrides,
  };
}

test('rule-set validation rejects duplicate ids and uncompilable regexes', () => {
  assert.throws(
    () => validateRuleSet({ version: 1, rules: [rule(), rule()] }),
    /duplicate rule id/,
  );
  assert.throws(
    () => validateRuleSet({ version: 1, rules: [rule({ match: { linePatterns: ['[unclosed'] } })] }),
    /invalid pattern/,
  );
  assert.throws(
    () => validateRuleSet({ version: 1, rules: [rule({ severity: 'critical' as ScarRule['severity'] })] }),
    /severity/,
  );
  assert.equal(compileRule(rule())._line[0].source, 'bad');
});
