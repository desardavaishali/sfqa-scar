// packages/scar/src/local.ts
// -----------------------------------------------------------------------------
// Local-run harvesting. Git history shows the failures a team already fixed;
// a test report shows the failures it is currently living with. This reads the
// two formats most runners emit - Playwright JSON and JUnit XML - and turns
// repeated failures into briefs, not rules: a runtime error is not yet a
// source pattern.
// -----------------------------------------------------------------------------

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

import { fingerprint } from './hash.js';
import { redactText } from './redact.js';

export type ReportFormat = 'auto' | 'playwright' | 'junit';

export interface LocalFailure {
  test: string;
  file: string | null;
  status: string;
  message: string;
  occurrences: number;
  fingerprint: string;
  ignoredAt?: string;
  ignoreReason?: string;
}

interface RawFailure {
  test: string;
  file: string | null;
  status: string;
  message: string;
}

const FAILED_STATUSES = new Set(['failed', 'timedOut', 'interrupted', 'error']);

function readReportFiles(path: string, output: string[] = []): string[] {
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return output;
  }
  if (stat.isDirectory()) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      readReportFiles(join(path, entry.name), output);
    }
  } else if (/\.(json|xml)$/i.test(path)) {
    output.push(path);
  }
  return output;
}

/** Very small XML entity decoder - enough for JUnit attributes and text. */
function decodeXml(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#10;/g, '\n')
    .replace(/&amp;/g, '&');
}

function attr(attrs: string, name: string): string | null {
  const match = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*("([^"]*)"|'([^']*)')`,
  ).exec(attrs);
  return match ? decodeXml(match[2] ?? match[3] ?? '') : null;
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, '').trim();
}

function parseJUnit(xml: string): RawFailure[] {
  const failures: RawFailure[] = [];
  const testcase = /<testcase\b([^>]*)>([\s\S]*?)<\/testcase>|<testcase\b([^>]*)\/>/g;
  let match: RegExpExecArray | null;

  while ((match = testcase.exec(xml)) !== null) {
    const attrs = match[1] ?? match[3] ?? '';
    const body = match[2] ?? '';
    if (!/<(failure|error)\b/.test(body)) continue;

    const blocking = /<(failure|error)\b([^>]*)>([\s\S]*?)<\/\1>/.exec(body);
    const selfClosing = /<(failure|error)\b([^>]*)\/>/.exec(body);
    const failureAttrs = blocking?.[2] ?? selfClosing?.[2] ?? '';
    const failureBody = blocking?.[3] ?? '';

    const name = attr(attrs, 'name') ?? 'unnamed test';
    const classname = attr(attrs, 'classname') ?? '';
    const test = classname && classname !== name ? `${classname} > ${name}` : name;
    const message =
      attr(failureAttrs, 'message') ?? (stripTags(failureBody) || 'failed without a message');

    failures.push({
      test,
      file: attr(attrs, 'file'),
      status: 'failed',
      message: redactText(message).trim().slice(0, 500),
    });
  }

  return failures;
}

interface PlaywrightResult {
  status?: string;
  error?: { message?: string };
}

interface PlaywrightTest {
  title?: string;
  results?: PlaywrightResult[];
}

interface PlaywrightSpec {
  title?: string;
  file?: string;
  tests?: PlaywrightTest[];
}

interface PlaywrightSuite {
  title?: string;
  file?: string;
  suites?: PlaywrightSuite[];
  specs?: PlaywrightSpec[];
}

function walkPlaywright(suite: PlaywrightSuite, output: RawFailure[]): void {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      for (const result of test.results ?? []) {
        if (!result.status || !FAILED_STATUSES.has(result.status)) continue;
        output.push({
          test: [suite.title, spec.title, test.title].filter(Boolean).join(' > ') || 'unnamed test',
          file: spec.file ?? suite.file ?? null,
          status: result.status,
          message: redactText(result.error?.message ?? 'failed without a message')
            .trim()
            .slice(0, 500),
        });
      }
    }
  }
  for (const child of suite.suites ?? []) walkPlaywright(child, output);
}

function parsePlaywright(data: unknown): RawFailure[] {
  if (!data || typeof data !== 'object') return [];
  const suites = (data as { suites?: PlaywrightSuite[] }).suites;
  if (!Array.isArray(suites)) return [];
  const failures: RawFailure[] = [];
  for (const suite of suites) walkPlaywright(suite, failures);
  return failures;
}

function parseReport(path: string, format: ReportFormat): RawFailure[] {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return [];
  }

  const trimmed = text.trimStart();
  const detected: ReportFormat | null =
    format !== 'auto'
      ? format
      : trimmed.startsWith('<')
        ? 'junit'
        : trimmed.startsWith('{')
          ? 'playwright'
          : null;

  if (detected === 'junit') return parseJUnit(text);
  if (detected === 'playwright') {
    try {
      return parsePlaywright(JSON.parse(text));
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Read one or more report paths (file or directory) and merge duplicate
 * failures. Duplicates are the signal: the same test failing in four runs is a
 * stronger candidate than a one-off.
 */
export function readLocalReports(
  paths: readonly string[],
  format: ReportFormat = 'auto',
  cwd = process.cwd(),
): LocalFailure[] {
  const raw: RawFailure[] = [];
  for (const path of paths) {
    for (const file of readReportFiles(resolve(cwd, path))) {
      raw.push(...parseReport(file, format));
    }
  }

  const merged = new Map<string, LocalFailure>();
  for (const failure of raw) {
    const key = `${failure.test}\n${failure.file ?? ''}\n${failure.message}`;
    const existing = merged.get(key);
    if (existing) {
      existing.occurrences += 1;
      continue;
    }
    merged.set(key, {
      ...failure,
      occurrences: 1,
      fingerprint: `test:${fingerprint([failure.test, failure.file ?? '', failure.message])}`,
    });
  }

  return [...merged.values()];
}
