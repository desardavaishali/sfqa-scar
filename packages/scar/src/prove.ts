// packages/scar/src/prove.ts
// -----------------------------------------------------------------------------
// The proof. One fixture that must fire per rule, one clean set that must stay
// silent. A rule with no detector is reported as a gap, never counted as
// coverage - a rule that cannot fire is worse than a missing rule, because it
// buys trust it has not earned.
//
// This lives in the package, not only in this repository's harness, so someone
// who installed @sfqa/scar can prove the rules they write without cloning
// anything. `sfqa-scar prove` is the command; `npm run validate:scar` is the
// same code path.
// -----------------------------------------------------------------------------

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { compileRule, isExecutable } from './rules.js';
import { lintContent, relPosix, walk } from './scan.js';
import type { ScarRule, Severity } from './types.js';

/** Where `new` writes fixtures and `prove` reads them, unless told otherwise. */
export const DEFAULT_FIXTURE_ROOT = 'scar-fixtures';

export class ProveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProveError';
  }
}

export interface RuleProof {
  id: string;
  severity: Severity;
  /** False when the rule has no machine detector: it cannot fire by design. */
  executable: boolean;
  positive: 'fires' | 'missing' | 'n/a';
  clean: 'clean' | 'leak' | 'n/a';
  pathInclude: string[];
}

export interface ProofResult {
  fixtureRoot: string;
  executable: number;
  gaps: number;
  covered: number;
  proofs: RuleProof[];
  /** True only when every executable rule fires and the clean set leaks nothing. */
  passed: boolean;
}

interface Fixture {
  /** Path relative to the positive/ directory, so rule scopes match. */
  rel: string;
  content: string;
}

function readFixtures(dir: string): Fixture[] {
  if (!existsSync(dir)) return [];
  return walk(dir).map((file) => ({
    rel: relPosix(dir, file),
    content: readFileSync(file, 'utf8'),
  }));
}

/**
 * Run every selected rule against the fixture pair.
 * `ids` limits the run to particular rules, which is what `--id` uses after
 * `new` so a person sees one verdict instead of nineteen.
 */
export function proveRules(
  rules: readonly ScarRule[],
  fixtureRoot: string,
  ids: readonly string[] = [],
): ProofResult {
  const root = resolve(fixtureRoot);
  const positiveDir = join(root, 'positive');
  const negativeDir = join(root, 'negative');
  const positive = readFixtures(positiveDir);
  const negative = readFixtures(negativeDir);

  if (positive.length === 0 && negative.length === 0) {
    throw new ProveError(
      `no fixtures under ${fixtureRoot}. Expected ${fixtureRoot}/positive/ and ${fixtureRoot}/negative/. Create the first pair with: sfqa-scar new --rule "what must not happen again"`,
    );
  }

  const selected = ids.length > 0 ? rules.filter((rule) => ids.includes(rule.id)) : [...rules];
  if (ids.length > 0) {
    const known = new Set(rules.map((rule) => rule.id));
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new ProveError(`no rule with id ${unknown.join(', ')} in this rule set`);
    }
  }

  const proofs: RuleProof[] = selected.map((rule) => {
    const executable = isExecutable(rule);
    const pathInclude = rule.match?.pathInclude ?? [];
    if (!executable) {
      return {
        id: rule.id,
        severity: rule.severity,
        executable,
        positive: 'n/a',
        clean: 'n/a',
        pathInclude,
      };
    }

    const compiled = compileRule(rule);
    const fires = positive.some(
      (fixture) => lintContent(fixture.rel, fixture.content, [compiled]).length > 0,
    );
    const leaks = negative.some(
      (fixture) => lintContent(fixture.rel, fixture.content, [compiled]).length > 0,
    );

    return {
      id: rule.id,
      severity: rule.severity,
      executable,
      positive: fires ? 'fires' : 'missing',
      clean: leaks ? 'leak' : 'clean',
      pathInclude,
    };
  });

  const executable = proofs.filter((proof) => proof.executable).length;
  const covered = proofs.filter((proof) => proof.positive === 'fires').length;
  const gaps = selected.length - executable;
  // A gap is reported, never counted as a pass. But a rule set where nothing
  // can fire is not "0 failures" - it is a rule set that proves nothing, and
  // saying PROOF over it would be the exact false confidence this tool exists to
  // remove. So passing requires no missing, no leak, and at least one fire.
  const passed =
    covered > 0 &&
    proofs.every(
      (proof) => !proof.executable || (proof.positive === 'fires' && proof.clean === 'clean'),
    );

  return { fixtureRoot, executable, gaps, covered, proofs, passed };
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

/**
 * The table the proof has printed since v0.1, plus one addition: when a rule
 * has a detector but no fixture made it fire, the scope is printed. Without it
 * the person has to guess which directory the fixture belongs in, and puts it
 * somewhere the rule never looks.
 */
export function formatProof(
  result: ProofResult,
  ruleSet: string,
  total: number,
  fixtureRoot: string = result.fixtureRoot,
): string {
  const lines: string[] = [];
  lines.push(`sfqa-scar prove - ${total} rule(s), ${result.executable} executable`);
  lines.push(`rule set: ${ruleSet}`);
  lines.push(`fixtures: ${fixtureRoot}`);
  lines.push('');
  lines.push('rule    severity  detector   positive   clean');
  lines.push('------  --------  ---------  ---------  -------');

  for (const proof of result.proofs) {
    const id = pad(proof.id, 6);
    const severity = pad(proof.severity, 8);
    const detector = pad(proof.executable ? 'yes' : 'NO', 9);
    const positive = pad(proof.positive, 9);
    lines.push(`${id}  ${severity}  ${detector}  ${positive}  ${proof.clean}`);
  }
  lines.push('');

  const missing = result.proofs.filter((proof) => proof.positive === 'missing');
  const leaks = result.proofs.filter((proof) => proof.clean === 'leak');
  const gaps = result.proofs.filter((proof) => !proof.executable);

  if (gaps.length > 0) {
    lines.push(`GAPS (no machine detector, cannot fire): ${gaps.map((p) => p.id).join(', ')}`);
    lines.push('  These rules are documentation until a detector is added.');
    for (const gap of gaps) {
      const where = gap.pathInclude.length > 0 ? gap.pathInclude.join(', ') : 'no path scope';
      lines.push(`  ${gap.id} is scoped to: ${where}`);
    }
    lines.push('');
  }

  if (missing.length > 0) {
    lines.push(`MISSING (detector exists but no fixture made it fire): ${missing.map((p) => p.id).join(', ')}`);
    for (const proof of missing) {
      const where = proof.pathInclude.length > 0 ? proof.pathInclude.join(', ') : 'any file';
      lines.push(`  ${proof.id} is scoped to: ${where}`);
      lines.push(`  put a file containing the bad line under ${result.fixtureRoot}/positive/ so it matches that scope`);
    }
    lines.push('  A fixture outside the scope is never scanned by the rule.');
    lines.push('');
  }

  if (leaks.length > 0) {
    lines.push(`FALSE POSITIVES on the clean set: ${leaks.map((p) => p.id).join(', ')}`);
    for (const proof of leaks.filter((p) => p.clean === 'leak')) {
      lines.push(`  ${proof.id} matched a file under ${result.fixtureRoot}/negative/ - either the clean fixture still contains the bad shape, or the pattern is too wide`);
    }
    lines.push('');
  }

  if (result.passed) {
    lines.push(
      `PROOF: ${result.covered}/${result.executable} executable rules fire on a positive fixture and stay silent on the clean set.`,
    );
    lines.push(
      `Coverage: ${result.covered}/${total} rules enforced today; ${result.gaps} rule(s) have no detector.`,
    );
  } else if (result.covered === 0) {
    lines.push('FAIL: no rule fired on a positive fixture, so nothing is proven.');
    lines.push(
      '  The usual cause is an empty detector: a scaffolded rule keeps `linePatterns: []` until you fill it.',
    );
    lines.push(
      '  Add a pattern under match.linePatterns, or delete the rule - an unproved rule is a comment.',
    );
  } else {
    lines.push(`FAIL: ${missing.length} missing, ${leaks.length} false positive(s).`);
  }

  return lines.join('\n');
}
