// packages/scar/src/scan.ts
// -----------------------------------------------------------------------------
// File discovery and detection. The scanner is intentionally boring: it reads
// text, applies declarative detectors, and reports where each one fired.
//
// Two exemption scopes, both deliberate:
//   - fileExemptSignals: a mitigation anywhere in the file clears the file
//     (e.g. a Promise.race guarding a toast wait)
//   - fileExemptLines: one line is individually safe (e.g. an empty env
//     fallback); sibling hardcoded literals in the same file still fire
// -----------------------------------------------------------------------------

import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, extname, join, relative, resolve, sep } from 'node:path';

import type { CompiledRule } from './rules.js';
import type { Finding } from './types.js';

export const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.features-gen',
  'test-results',
  'test-results1',
  'test-artifacts',
  'allure-results',
  'playwright-report',
  'html-report',
  '.local',
]);

const MAX_BYTES = 1_000_000;
const BINARY_EXT = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.zip',
  '.xlsx',
  '.pdf',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.mp4',
  '.webm',
]);

/** Normalise to forward slashes so globs behave the same on every platform. */
export function toPosix(path: string): string {
  return path.split(sep).join('/');
}

export function relPosix(root: string, path: string): string {
  return toPosix(relative(root, path));
}

export function walk(dir: string, output: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(join(dir, entry.name), output);
    } else if (entry.isFile()) {
      output.push(join(dir, entry.name));
    }
  }
  return output;
}

/** Expand CLI path arguments into absolute file paths. */
export function collectFiles(targets: readonly string[], cwd: string): string[] {
  const files: string[] = [];
  for (const target of targets) {
    const absolute = resolve(cwd, target);
    let stat;
    try {
      stat = statSync(absolute);
    } catch {
      continue;
    }
    if (stat.isDirectory()) files.push(...walk(absolute));
    else if (stat.isFile()) files.push(absolute);
  }
  return files;
}

export function gitChangedFiles(cwd: string, baseRef?: string | null, staged = false): string[] {
  const args = ['diff', '--name-only', '--relative'];
  if (staged) args.push('--cached');
  else if (baseRef) args.push(baseRef);
  const output = execFileSync('git', args, { cwd, encoding: 'utf8' });
  return output
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

/** True when the path is covered by .gitignore (exit 0 from git check-ignore). */
export function isGitIgnored(cwd: string, relPath: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', relPath], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * The same answer for many paths in one process.
 *
 * `isGitIgnored` spawns git per path. On a 1,400-file repository that is the
 * entire runtime of a scan; batching takes it from ~30s to well under a second.
 * Paths are fed NUL-separated so a space or a newline in a filename cannot
 * split the input.
 */
export function gitIgnoredSet(cwd: string, relPaths: readonly string[]): Set<string> {
  const result = new Set<string>();
  if (relPaths.length === 0) return result;
  let stdout: string;
  try {
    stdout = execFileSync('git', ['check-ignore', '--stdin', '-z'], {
      cwd,
      input: `${relPaths.join('\0')}\0`,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
    });
  } catch (error) {
    // Exit 1 means "none of these are ignored", which is not an error.
    const output = (error as { stdout?: string }).stdout ?? '';
    if (!output) return result;
    stdout = output;
  }
  for (const entry of stdout.split('\0')) if (entry) result.add(entry);
  return result;
}

function isComment(line: string): boolean {
  const trimmed = line.trimStart();
  return (
    trimmed.startsWith('//') ||
    trimmed.startsWith('/*') ||
    trimmed.startsWith('*') ||
    (trimmed.startsWith('#') && !trimmed.startsWith('#!'))
  );
}

function lineOf(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

/**
 * A line pattern is matched against the line plus the next three lines, but a
 * finding is only reported when the match starts on this line. That is how a
 * guard written on the following line - `.isVisible({ timeout: 5000 })` then
 * `.catch(() => false)` - reads as a deliberate probe instead of a silent
 * assertion, without teaching the rule about JavaScript.
 */
function matchesOnLine(re: RegExp, lines: string[], index: number): boolean {
  const line = lines[index];
  const match = re.exec(lines.slice(index, index + 4).join('\n'));
  return match !== null && match.index < line.length;
}

function isExemptLine(rule: CompiledRule, line: string): boolean {
  return rule._exemptLines.length > 0 && rule._exemptLines.some((re) => re.test(line));
}

function spansLines(re: RegExp): boolean {
  return /\[\\s\\S\]|\\n/.test(re.source);
}

/** Quoted string literals with their 1-based line number. */
interface QuotedLiteral {
  value: string;
  line: number;
  /** The character just before the opening quote. */
  before: string;
  /** Up to four characters just before the opening quote. */
  prefix: string;
  /** The character just after the closing quote. */
  after: string;
}

function quotedLiterals(content: string): QuotedLiteral[] {
  const literals: QuotedLiteral[] = [];
  const pattern = /(['"])([^'"\n]{2,})\1/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    literals.push({
      value: match[2],
      line: lineOf(content, start),
      before: content.slice(Math.max(0, start - 1), start),
      prefix: content.slice(Math.max(0, start - 4), start),
      after: content.slice(end, end + 1),
    });
  }
  return literals;
}

/**
 * Not every quoted string is a picklist label. Three shapes produced false
 * positives in the repository this rule was mined from, and all three are code,
 * not labels:
 *
 *   'input[name="FirstName"]'  - a value inside an attribute selector
 *   'Email': 'email'           - an object key, and its value
 *   cond ? 'email' : 'name'    - the branches of a ternary
 *   'First Name': 'firstName'  - a camelCase identifier
 *
 * A lowercase single word is kept: `['web']` where the canonical value is `Web`
 * is exactly the drift this rule exists to catch, and there is no way to tell it
 * from a lowercase value without the surrounding type information.
 */
function looksLikeLabel(literal: QuotedLiteral): boolean {
  if (literal.after === ':') return false;
  // `[` is an array, so only the attribute-operator characters count here.
  if (/[=~|^$*]/.test(literal.before)) return false;
  // A value after a colon or a question mark is a map value or a ternary
  // branch, not a label. `['web', 'Event']` is untouched - an array element is
  // exactly where a drifted picklist value lives.
  if (/[?:]\s*$/.test(literal.prefix)) return false;
  if (/^[a-z][A-Za-z0-9]*[A-Z]/.test(literal.value)) return false;
  return true;
}

function normaliseLabel(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, '');
}

/**
 * Label drift: a quoted literal that is the same label as a canonical one but
 * differs in case, spacing or hyphenation. This is the generic form of "copy
 * the picklist label verbatim" - the canonical list is supplied by the org.
 */
function labelFindings(
  rule: CompiledRule,
  content: string,
  lines: string[],
  relPath: string,
  severity: Finding['rule']['severity'],
  maxPerRule: number,
  ignored: boolean,
): Finding[] {
  const findings: Finding[] = [];
  if (rule._labels.length === 0) return findings;

  const flush = (value: string, line: number, canonical: string, kind: string) => {
    const lineText = lines[line - 1] ?? '';
    if (isComment(lineText) || isExemptLine(rule, lineText)) return;
    findings.push({
      rule: { ...rule, severity },
      relPath,
      line,
      snippet: `${lineText.trim().slice(0, 140)}${ignored ? ' [gitignored - informational]' : ''}`,
      meta: `${kind}: "${value}" should be "${canonical}"`,
    });
  };

  const literals = quotedLiterals(content);
  outer: for (const labelRule of rule._labels) {
    for (const canonical of labelRule.canonical) {
      for (const literal of literals) {
        if (findings.length >= maxPerRule) break outer;
        if (!looksLikeLabel(literal)) continue;
        if (literal.value === canonical) continue;
        if (literal.value.toLowerCase() === canonical.toLowerCase()) {
          flush(literal.value, literal.line, canonical, 'case drift');
          break;
        }
        if (normaliseLabel(literal.value) === normaliseLabel(canonical)) {
          flush(literal.value, literal.line, canonical, 'spacing/hyphen drift');
          break;
        }
      }
    }
  }
  return findings;
}

export interface LintOptions {
  maxPerRule?: number;
  /** Findings in gitignored files are informational (downgraded to low). */
  ignored?: boolean;
}

export function lintContent(
  relPath: string,
  content: string,
  rules: readonly CompiledRule[],
  options: LintOptions = {},
): Finding[] {
  const maxPerRule = options.maxPerRule ?? 5;
  const ignored = options.ignored ?? false;
  const findings: Finding[] = [];
  const file = basename(relPath);
  const lines = content.split('\n');

  for (const rule of rules) {
    const gated = rule._include.length > 0 && !rule._include.some((re) => re.test(relPath));
    if (gated || rule._exclude.some((re) => re.test(relPath))) continue;
    const severity = ignored ? 'low' : rule.severity;

    // Filename-based rules (e.g. a tracked .env file).
    for (const fileNameRule of rule._fileName) {
      if (fileNameRule.re.test(file)) {
        findings.push({
          rule: { ...rule, severity },
          relPath,
          line: 0,
          snippet: `(file name "${file}" matched /${fileNameRule.re.source}/)${
            ignored ? ' [gitignored - informational]' : ''
          }`,
        });
      }
    }

    const fileExempt = rule._exempt.length > 0 && rule._exempt.some((re) => re.test(content));

    // Per-line patterns. A pattern containing [\s\S] or \n is written to span
    // lines, so it can never match inside one line; split those out and scan
    // them against the whole content, mapping each match back to its line.
    if (rule._line.length > 0 && !fileExempt) {
      const singleLine = rule._line.filter((re) => !spansLines(re));
      const multiLine = rule._line.filter(spansLines);

      let hits = 0;
      for (let i = 0; i < lines.length && hits < maxPerRule; i++) {
        if (isComment(lines[i]) || isExemptLine(rule, lines[i])) continue;
        if (singleLine.some((re) => matchesOnLine(re, lines, i))) {
          findings.push({
            rule: { ...rule, severity },
            relPath,
            line: i + 1,
            snippet: `${lines[i].trim().slice(0, 160)}${ignored ? ' [gitignored - informational]' : ''}`,
          });
          hits++;
        }
      }

      for (const re of multiLine) {
        if (hits >= maxPerRule) break;
        const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
        let match: RegExpExecArray | null;
        while ((match = global.exec(content)) !== null && hits < maxPerRule) {
          const line = lineOf(content, match.index);
          const lineText = lines[line - 1] ?? '';
          if (!isComment(lineText) && !isExemptLine(rule, lineText)) {
            findings.push({
              rule: { ...rule, severity },
              relPath,
              line,
              snippet: `${match[0].trim().slice(0, 160)}${
                ignored ? ' [gitignored - informational]' : ''
              }`,
            });
            hits++;
          }
          if (match.index === global.lastIndex) global.lastIndex++;
        }
      }
    }

    // Numeric-range rules: capture group 1 must fall in [min, max].
    if (!fileExempt) {
      for (const numeric of rule._numeric) {
        numeric.re.lastIndex = 0;
        let hits = findings.filter((finding) => finding.rule.id === rule.id).length;
        let match: RegExpExecArray | null;
        while ((match = numeric.re.exec(content)) !== null && hits < maxPerRule) {
          const value = Number(match[1]);
          if (Number.isFinite(value) && value >= numeric.min && value <= numeric.max) {
            const lineStart = content.lastIndexOf('\n', match.index) + 1;
            const lineText = content.slice(lineStart, match.index + match[0].length + 40);
            if (isComment(lineText) || isExemptLine(rule, lineText)) continue;
            findings.push({
              rule: { ...rule, severity },
              relPath,
              line: lineOf(content, match.index),
              snippet: match[0].trim().slice(0, 160),
              meta: `value ${value} outside safe range (${numeric.min}-${numeric.max})`,
            });
            hits++;
          }
        }
      }
    }

    // Label drift: exact display labels supplied by the org.
    if (!fileExempt) {
      findings.push(
        ...labelFindings(rule, content, lines, relPath, severity, maxPerRule, ignored),
      );
    }

    // Required-signal rules: fire once when NO required signal exists.
    if (
      !fileExempt &&
      rule._required.length > 0 &&
      !rule._required.some((re) => re.test(content))
    ) {
      findings.push({
        rule: { ...rule, severity },
        relPath,
        line: 0,
        snippet: `(file passed rule scope but contains none of: ${(
          rule.match.fileRequiredSignals ?? []
        ).join(', ')})`,
      });
    }
  }

  return findings;
}

export interface ScanResult {
  filesScanned: number;
  findings: Finding[];
}

export interface ScanOptions {
  maxPerRule?: number;
  /** Injectable for tests; defaults to `git check-ignore`. */
  isIgnored?: (relPath: string) => boolean;
}

/** Read and lint every file, skipping binaries, huge files and ignored dirs. */
export function scanFiles(
  cwd: string,
  files: readonly string[],
  rules: readonly CompiledRule[],
  options: ScanOptions = {},
): ScanResult {
  const findings: Finding[] = [];
  let filesScanned = 0;

  // Lint first, ask git only about files that actually matched something. The
  // ignore ledger is cosmetic (it downgrades a finding and marks it), so paying
  // for it on 1,400 clean files was pure waste.
  const matched: Array<{ rel: string; content: string }> = [];

  for (const absolute of files) {
    const rel = relPosix(cwd, absolute);
    if (SKIP_DIRS.has(rel.split('/')[0])) continue;
    if (BINARY_EXT.has(extname(absolute))) continue;

    let stat;
    try {
      stat = statSync(absolute);
    } catch {
      continue;
    }
    if (stat.size > MAX_BYTES) continue;

    const content = readFileSync(absolute, 'utf8');
    filesScanned++;
    if (lintContent(rel, content, rules, { maxPerRule: options.maxPerRule }).length > 0) {
      matched.push({ rel, content });
    }
  }

  const ignored = options.isIgnored
    ? new Set(matched.filter((entry) => options.isIgnored?.(entry.rel)).map((entry) => entry.rel))
    : gitIgnoredSet(cwd, matched.map((entry) => entry.rel));

  for (const entry of matched) {
    findings.push(
      ...lintContent(entry.rel, entry.content, rules, {
        maxPerRule: options.maxPerRule,
        ignored: ignored.has(entry.rel),
      }),
    );
  }

  return { filesScanned, findings };
}
