// packages/scar/test/harvest.test.ts
// -----------------------------------------------------------------------------
// Proves harvest finds incidents that never became rules, and stays quiet when
// an existing rule already accounts for them. Synthetic git repos only - never
// a real project's history.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_CAPTURE_FILE,
  DEFAULT_IGNORE_FILE,
  compileRule,
  compileRuleSet,
  formatHarvestJson,
  formatHarvestText,
  harvest,
  loadCaptureQueue,
  loadIgnoreLedger,
  loadRuleSet,
  parseHarvestArgs,
  readLocalReports,
  runHarvest,
  validateRuleSet,
  type ScarRule,
} from '../src/index.js';

const RULES_PATH = fileURLToPath(new URL('../rules/generic.json', import.meta.url));

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), 'scar-harvest-'));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir });
  return dir;
}

function commit(dir: string, message: string, file: string, content: string): string {
  const target = join(dir, file);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, content);
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['commit', '-q', '-m', message], { cwd: dir });
  return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: dir,
    encoding: 'utf8',
  }).trim();
}

/** Change a file and stage it, without committing. */
function stage(dir: string, file: string, content: string): void {
  const target = join(dir, file);
  mkdirSync(join(target, '..'), { recursive: true });
  writeFileSync(target, content);
  execFileSync('git', ['add', file], { cwd: dir });
}

function rule(overrides: Partial<ScarRule> = {}): ScarRule {
  return {
    id: 'ST-001',
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

test('harvest proposes a rule for a fix-shaped commit with no rule', () => {
  const dir = initRepo();
  try {
    commit(dir, 'add the order page', 'tests/orders.ts', 'await page.waitForTimeout(2000);\n');
    const shortHash = commit(
      dir,
      'fix: wait for the element instead of sleeping',
      'tests/orders.ts',
      "await locator.waitFor({ state: 'visible', timeout: 5000 });\n",
    );

    const result = harvest([], { cwd: dir });

    assert.equal(result.commits, 2);
    assert.equal(result.incidents, 1);
    assert.equal(result.candidates.length, 1);

    const candidate = result.candidates[0];
    assert.equal(candidate.shortHash, shortHash);
    assert.match(candidate.subject, /fix/i);
    assert.equal(candidate.confidence, 'high');
    assert.equal(candidate.executable, true);
    assert.ok(candidate.pathInclude.includes('tests/**'));
    assert.ok(
      candidate.linePatterns.some((pattern) => pattern.includes('waitForTimeout')),
      `expected a waitForTimeout pattern, got ${candidate.linePatterns.join(', ')}`,
    );
    assert.equal(candidate.draft.origin.commit, shortHash);
    assert.equal(candidate.draft.id, 'ST-001');
    assert.equal(candidate.draft.match.pathInclude?.[0], 'tests/**');

    // The draft is a rule a person can review, not a rule the scanner invented.
    assert.doesNotThrow(() =>
      validateRuleSet({ version: 1, rules: [{ ...candidate.draft, id: 'ST-900' }] }),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('harvest skips incidents an existing rule already covers', () => {
  const dir = initRepo();
  try {
    commit(dir, 'add the order page', 'tests/orders.ts', 'await page.waitForTimeout(2000);\n');
    const shortHash = commit(
      dir,
      'fix: wait for the element instead of sleeping',
      'tests/orders.ts',
      "await locator.waitFor({ state: 'visible', timeout: 5000 });\n",
    );

    const compiled = [compileRule(rule({ id: 'ST-050', origin: { commit: shortHash, summary: 'same incident' } }))];

    const quiet = harvest(compiled, { cwd: dir });
    assert.equal(quiet.candidates.length, 0);
    assert.equal(quiet.covered.length, 0, 'covered incidents are hidden by default');

    const shown = harvest(compiled, { cwd: dir, includeCovered: true });
    assert.equal(shown.candidates.length, 0);
    assert.equal(shown.covered.length, 1);
    assert.deepEqual(shown.covered[0].coveredBy, ['ST-050']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('harvest also recognises coverage from a detector, not just a commit id', () => {
  const dir = initRepo();
  try {
    commit(dir, 'add the order page', 'tests/orders.ts', 'await page.waitForTimeout(2000);\n');
    commit(
      dir,
      'fix: wait for the element instead of sleeping',
      'tests/orders.ts',
      "await locator.waitFor({ state: 'visible', timeout: 5000 });\n",
    );

    const compiled = [
      compileRule(
        rule({
          id: 'ST-051',
          origin: { summary: 'a rule with no commit reference' },
          match: { linePatterns: ['page\\.waitForTimeout\\('] },
        }),
      ),
    ];

    const result = harvest(compiled, { cwd: dir, includeCovered: true });
    assert.equal(result.candidates.length, 0);
    assert.equal(result.covered.length, 1);
    assert.deepEqual(result.covered[0].coveredBy, ['ST-051']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('harvest ignores commits that do not look like incidents', () => {
  const dir = initRepo();
  try {
    commit(dir, 'add a new page object', 'tests/orders.ts', 'export const page = 1;\n');
    commit(dir, 'rename a helper', 'tests/orders.ts', 'export const orderPage = 1;\n');

    const result = harvest([], { cwd: dir });
    assert.equal(result.incidents, 0);
    assert.equal(result.candidates.length, 0);
    assert.match(formatHarvestText(result), /Nothing unclaimed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('harvest output is valid JSON and the CLI is advisory by default', async () => {
  const dir = initRepo();
  const original = console.log;
  try {
    commit(dir, 'add the order page', 'tests/orders.ts', 'await page.waitForTimeout(2000);\n');
    commit(
      dir,
      'fix: wait for the element instead of sleeping',
      'tests/orders.ts',
      "await locator.waitFor({ state: 'visible', timeout: 5000 });\n",
    );

    const loaded = loadRuleSet(RULES_PATH);
    assert.ok(loaded.rules.length > 0);
    assert.doesNotThrow(() => compileRuleSet(loaded));

    let output = '';
    console.log = (message?: unknown) => {
      output += String(message);
    };

    const advisory = await runHarvest(
      parseHarvestArgs(['--json', '--rules', RULES_PATH]),
      dir,
    );
    console.log = original;

    assert.equal(advisory, 0, 'a gap is information, not a failed scan');
    const report = JSON.parse(output) as {
      command: string;
      candidates: Array<{ confidence: string; draft: { id: string } }>;
    };
    assert.equal(report.command, 'harvest');
    assert.equal(report.candidates.length, 1);

    console.log = () => {};
    const strict = await runHarvest(
      parseHarvestArgs(['--strict', '--rules', RULES_PATH]),
      dir,
    );
    console.log = original;
    assert.equal(strict, 1, '--strict turns an unclaimed incident into a red build');

    assert.match(
      formatHarvestJson({
        commits: 0,
        incidents: 0,
        candidates: [],
        covered: [],
        localFailures: [],
        ignored: 0,
        captured: 0,
        staged: false,
      }),
      /"command": "harvest"/,
    );
  } finally {
    console.log = original;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('harvest reads a Playwright JSON report and merges duplicate failures', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scar-report-'));
  try {
    const failure = {
      status: 'failed',
      error: {
        message:
          "Error: expect(locator).toBeVisible() failed\nLocator: getByText('Order created')",
      },
    };
    const report = {
      suites: [
        {
          title: 'orders.spec.ts',
          file: 'tests/orders.spec.ts',
          specs: [
            {
              title: 'creates an order',
              file: 'tests/orders.spec.ts',
              tests: [{ title: 'creates an order', results: [failure, failure] }],
            },
          ],
        },
      ],
    };
    writeFileSync(join(dir, 'report.json'), JSON.stringify(report));

    const failures = readLocalReports(['report.json'], 'auto', dir);
    assert.equal(failures.length, 1, 'the same failure in two runs is one row');
    assert.equal(failures[0].occurrences, 2);
    assert.match(failures[0].test, /creates an order/);
    assert.equal(failures[0].file, 'tests/orders.spec.ts');
    assert.match(failures[0].message, /Order created/);
    assert.match(failures[0].fingerprint, /^test:/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('harvest reads JUnit XML, ignores passes, and redacts credentials', () => {
  const dir = mkdtempSync(join(tmpdir(), 'scar-junit-'));
  try {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<testsuites>
  <testsuite name="orders">
    <testcase classname="OrderTests" name="creates an order" file="tests/orders.spec.ts">
      <failure message="Timeout 5000ms exceeded for password=hunter2">stack trace</failure>
    </testcase>
    <testcase classname="OrderTests" name="passes" />
  </testsuite>
</testsuites>`;
    writeFileSync(join(dir, 'junit.xml'), xml);

    const failures = readLocalReports(['junit.xml'], 'junit', dir);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].test, 'OrderTests > creates an order');
    assert.equal(failures[0].file, 'tests/orders.spec.ts');
    assert.match(failures[0].message, /Timeout 5000ms exceeded/);
    assert.match(failures[0].message, /password=<redacted>/);
    assert.doesNotMatch(failures[0].message, /hunter2/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('harvest can inspect the staged change at commit time', async () => {
  const dir = initRepo();
  const original = console.log;
  try {
    commit(dir, 'add the order page', 'tests/orders.ts', 'await page.waitForTimeout(2000);\n');
    stage(dir, 'tests/orders.ts', "await locator.waitFor({ state: 'visible', timeout: 5000 });\n");

    console.log = () => {};
    const code = await runHarvest(
      parseHarvestArgs([
        '--staged',
        '--message',
        'fix: replace the fixed sleep with an element wait',
        '--rules',
        RULES_PATH,
      ]),
      dir,
    );
    console.log = original;

    assert.equal(code, 0);

    const result = harvest([], {
      cwd: dir,
      staged: true,
      message: 'fix: replace the fixed sleep with an element wait',
    });
    assert.equal(result.staged, true);
    assert.equal(result.candidates.length, 1);
    assert.equal(result.candidates[0].shortHash, 'staged');
    assert.equal(result.candidates[0].draft.origin.commit, null);
    assert.match(result.candidates[0].fingerprint, /^staged:/);
  } finally {
    console.log = original;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a staged change with a non-incident message is not a candidate unless forced', () => {
  const dir = initRepo();
  try {
    commit(dir, 'add the order page', 'tests/orders.ts', 'await page.waitForTimeout(2000);\n');
    stage(dir, 'tests/orders.ts', "await locator.waitFor({ state: 'visible', timeout: 5000 });\n");

    const quiet = harvest([], { cwd: dir, staged: true, message: 'chore: tidy docs' });
    assert.equal(quiet.candidates.length, 0);

    const forced = harvest([], {
      cwd: dir,
      staged: true,
      message: 'chore: tidy docs',
      force: true,
    });
    assert.equal(forced.candidates.length, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('an ignored candidate stays out of the next run and is shown with --all', async () => {
  const dir = initRepo();
  const original = console.log;
  try {
    commit(dir, 'add the order page', 'tests/orders.ts', 'await page.waitForTimeout(2000);\n');
    stage(dir, 'tests/orders.ts', "await locator.waitFor({ state: 'visible', timeout: 5000 });\n");

    const result = harvest([], {
      cwd: dir,
      staged: true,
      message: 'fix: replace the fixed sleep with an element wait',
    });
    const id = result.candidates[0].fingerprint;

    console.log = () => {};
    await runHarvest(
      parseHarvestArgs([
        '--staged',
        '--message',
        'fix: replace the fixed sleep with an element wait',
        '--rules',
        RULES_PATH,
        '--ignore',
        id,
      ]),
      dir,
    );

    const second = await runHarvest(
      parseHarvestArgs([
        '--staged',
        '--message',
        'fix: replace the fixed sleep with an element wait',
        '--rules',
        RULES_PATH,
        '--json',
      ]),
      dir,
    );
    console.log = original;

    assert.equal(second, 0);
    const quiet = harvest([], {
      cwd: dir,
      staged: true,
      message: 'fix: replace the fixed sleep with an element wait',
      ignoreLedger: loadIgnoreLedger(join(dir, DEFAULT_IGNORE_FILE)),
    });
    assert.equal(quiet.candidates.length, 0);
    assert.equal(quiet.ignored, 1);

    const all = harvest([], {
      cwd: dir,
      staged: true,
      message: 'fix: replace the fixed sleep with an element wait',
      includeIgnored: true,
      ignoreLedger: loadIgnoreLedger(join(dir, DEFAULT_IGNORE_FILE)),
    });
    assert.equal(all.candidates.length, 1);
    assert.ok(all.candidates[0].ignoredAt, 'the ledger shows when it was dismissed');

    console.log = () => {};
    const text = await runHarvest(
      parseHarvestArgs([
        '--staged',
        '--message',
        'fix: replace the fixed sleep with an element wait',
        '--rules',
        RULES_PATH,
        '--all',
      ]),
      dir,
    );
    console.log = original;
    assert.equal(text, 0);

    const ledger = loadIgnoreLedger(join(dir, DEFAULT_IGNORE_FILE));
    assert.equal(ledger.ignored.length, 1);
    assert.equal(ledger.ignored[0].fingerprint, id);
  } finally {
    console.log = original;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--ask yes captures the draft and does not ask again', async () => {
  const dir = initRepo();
  const original = console.log;
  try {
    commit(dir, 'add the order page', 'tests/orders.ts', 'await page.waitForTimeout(2000);\n');
    stage(dir, 'tests/orders.ts', "await locator.waitFor({ state: 'visible', timeout: 5000 });\n");

    console.log = () => {};

    const statements = [
      '--staged',
      '--message',
      'fix: replace the fixed sleep with an element wait',
      '--rules',
      RULES_PATH,
      '--ask',
    ];

    const prompts: string[] = [];
    const accept = await runHarvest(
      parseHarvestArgs(statements),
      dir,
      async (question) => {
        prompts.push(question);
        return 'y';
      },
    );
    assert.equal(accept, 0);
    assert.equal(prompts.length, 1, 'one question for one candidate');
    assert.match(prompts[0] ?? '', /capture a draft/);

    const queue = loadCaptureQueue(join(dir, DEFAULT_CAPTURE_FILE));
    assert.equal(queue.candidates.length, 1);
    assert.match(queue.candidates[0].fingerprint, /^staged:/);
    assert.ok(queue.candidates[0].draft, 'the draft is stored, not just the id');
    assert.equal(queue.candidates[0].draft?.match.pathInclude?.[0], 'tests/**');

    const prompts2: string[] = [];
    await runHarvest(
      parseHarvestArgs(statements),
      dir,
      async (question) => {
        prompts2.push(question);
        return 'i';
      },
    );
    assert.equal(prompts2.length, 0, 'a captured candidate is not asked again');

    const again = harvest([], {
      cwd: dir,
      staged: true,
      message: 'fix: replace the fixed sleep with an element wait',
      captureQueue: loadCaptureQueue(join(dir, DEFAULT_CAPTURE_FILE)),
    });
    assert.equal(again.captured, 1);
    assert.ok(again.candidates[0].capturedAt);

    assert.equal(
      loadIgnoreLedger(join(dir, DEFAULT_IGNORE_FILE)).ignored.length,
      0,
      'yes writes no ignore decision',
    );
  } finally {
    console.log = original;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--capture records a candidate without a prompt', async () => {
  const dir = initRepo();
  const original = console.log;
  try {
    commit(dir, 'add the order page', 'tests/orders.ts', 'await page.waitForTimeout(2000);\n');
    stage(dir, 'tests/orders.ts', "await locator.waitFor({ state: 'visible', timeout: 5000 });\n");

    const statements = [
      '--staged',
      '--message',
      'fix: replace the fixed sleep with an element wait',
      '--rules',
      RULES_PATH,
    ];

    const first = harvest([], {
      cwd: dir,
      staged: true,
      message: 'fix: replace the fixed sleep with an element wait',
    });
    const id = first.candidates[0].fingerprint;

    console.log = () => {};
    const code = await runHarvest(parseHarvestArgs([...statements, '--capture', id]), dir);
    console.log = original;
    assert.equal(code, 0);

    const queue = loadCaptureQueue(join(dir, DEFAULT_CAPTURE_FILE));
    assert.equal(queue.candidates.length, 1);
    assert.equal(queue.candidates[0].fingerprint, id);
    assert.equal(queue.candidates[0].subject, 'fix: replace the fixed sleep with an element wait');
    assert.ok(queue.candidates[0].draft);
  } finally {
    console.log = original;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('--ask no records the ignore and does not ask again', async () => {
  const dir = initRepo();
  const original = console.log;
  try {
    commit(dir, 'add the order page', 'tests/orders.ts', 'await page.waitForTimeout(2000);\n');
    stage(dir, 'tests/orders.ts', "await locator.waitFor({ state: 'visible', timeout: 5000 });\n");

    console.log = () => {};

    const statements = [
      '--staged',
      '--message',
      'fix: replace the fixed sleep with an element wait',
      '--rules',
      RULES_PATH,
      '--ask',
    ];

    const answers = ['i', 'because the fix is already covered by the code review'];
    await runHarvest(parseHarvestArgs(statements), dir, async () => answers.shift() ?? '');

    const ledger = loadIgnoreLedger(join(dir, DEFAULT_IGNORE_FILE));
    assert.equal(ledger.ignored.length, 1);
    assert.match(ledger.ignored[0].reason, /code review/);
    assert.ok(ledger.ignored[0].at);

    const prompts: string[] = [];
    await runHarvest(parseHarvestArgs(statements), dir, async (question) => {
      prompts.push(question);
      return 'y';
    });
    assert.equal(prompts.length, 0, 'an ignored candidate is not asked again');

    const again = harvest([], {
      cwd: dir,
      staged: true,
      message: 'fix: replace the fixed sleep with an element wait',
      ignoreLedger: loadIgnoreLedger(join(dir, DEFAULT_IGNORE_FILE)),
    });
    assert.equal(again.ignored, 1);
    assert.equal(again.candidates.length, 0);

    const shown = harvest([], {
      cwd: dir,
      staged: true,
      message: 'fix: replace the fixed sleep with an element wait',
      includeIgnored: true,
      ignoreLedger: loadIgnoreLedger(join(dir, DEFAULT_IGNORE_FILE)),
    });
    assert.equal(shown.candidates.length, 1);
    assert.ok(shown.candidates[0].ignoredAt);
    assert.match(shown.candidates[0].ignoreReason ?? '', /code review/);
  } finally {
    console.log = original;
    rmSync(dir, { recursive: true, force: true });
  }
});
