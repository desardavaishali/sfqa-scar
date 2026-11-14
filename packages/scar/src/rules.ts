// packages/scar/src/rules.ts
// -----------------------------------------------------------------------------
// Rule-set loading and compilation. Every detector is compiled once, up front,
// so a malformed regex fails loudly at load time instead of silently never
// matching a file.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';

import type {
  FileNameRule,
  LabelRule,
  NumericRule,
  RuleMatch,
  RuleSet,
  ScarRule,
  Severity,
} from './types.js';

export const SEVERITIES: readonly Severity[] = ['high', 'med', 'low'];

export class RuleSetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RuleSetError';
  }
}

/**
 * Convert a small glob (`**`, `*`, `?`) to an anchored RegExp. Deliberately
 * tiny: a rule set should not need a dependency just to scope a file path.
 */
export function globToRegex(glob: string): RegExp {
  let source = '';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          source += '(?:[^/]*/)*';
          i += 2;
        } else {
          source += '.*';
          i += 1;
        }
      } else {
        source += '[^/]*';
      }
    } else if (char === '?') {
      source += '[^/]';
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${source}$`);
}

/**
 * JS RegExp has no inline `(?i)`. Convention: a leading `(?i)` in a rule
 * pattern becomes the case-insensitive flag, keeping the JSON readable and
 * portable across engines.
 */
export function jsRegex(pattern: string, extraFlags = ''): RegExp {
  let flags = extraFlags;
  let source = pattern;
  if (source.startsWith('(?i)')) {
    flags += 'i';
    source = source.slice(4);
  }
  return new RegExp(source, flags);
}

export interface CompiledRule extends ScarRule {
  _include: RegExp[];
  _exclude: RegExp[];
  _line: RegExp[];
  _numeric: Array<NumericRule & { re: RegExp }>;
  _fileName: Array<FileNameRule & { re: RegExp }>;
  _labels: LabelRule[];
  _required: RegExp[];
  _exempt: RegExp[];
  _exemptLines: RegExp[];
}

function compilePatterns(patterns: readonly string[] = [], flags = ''): RegExp[] {
  return patterns.map((pattern) => {
    try {
      return jsRegex(pattern, flags);
    } catch (error) {
      throw new RuleSetError(
        `invalid pattern ${JSON.stringify(pattern)}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  });
}

export function compileRule(rule: ScarRule): CompiledRule {
  const match: RuleMatch = rule.match ?? {};
  return {
    ...rule,
    _include: (match.pathInclude ?? []).map(globToRegex),
    _exclude: (match.pathExclude ?? []).map(globToRegex),
    _line: compilePatterns(match.linePatterns),
    _numeric: (match.numericRules ?? []).map((numeric) => ({
      ...numeric,
      re: jsRegex(numeric.pattern, numeric.flags ?? 'gm'),
    })),
    _fileName: (match.fileNameRules ?? []).map((file) => ({
      ...file,
      re: jsRegex(file.pattern),
    })),
    _labels: match.labelRules ?? [],
    _required: compilePatterns(match.fileRequiredSignals, 'm'),
    _exempt: compilePatterns(match.fileExemptSignals, 'm'),
    _exemptLines: compilePatterns(match.fileExemptLines, 'm'),
  };
}

/** True when the rule has at least one machine detector. */
export function isExecutable(rule: ScarRule): boolean {
  const match = rule.match ?? {};
  return (
    (match.linePatterns ?? []).length > 0 ||
    (match.numericRules ?? []).length > 0 ||
    (match.fileNameRules ?? []).length > 0 ||
    (match.fileRequiredSignals ?? []).length > 0 ||
    (match.labelRules ?? []).length > 0
  );
}

/** Validate a rule set before any file is scanned. */
export function validateRuleSet(raw: unknown): RuleSet {
  if (!raw || typeof raw !== 'object') {
    throw new RuleSetError('rule set must be a JSON object');
  }
  const candidate = raw as RuleSet;
  if (!Array.isArray(candidate.rules) || candidate.rules.length === 0) {
    throw new RuleSetError('rule set has no rules');
  }

  const ids = new Set<string>();
  for (const rule of candidate.rules) {
    const where = rule.id ? `rule ${rule.id}` : 'rule without an id';
    if (!rule.id || !/^[A-Z]+-\d+$/.test(rule.id)) {
      throw new RuleSetError(`${where}: id must look like "XX-001"`);
    }
    if (ids.has(rule.id)) {
      throw new RuleSetError(`duplicate rule id ${rule.id}`);
    }
    ids.add(rule.id);

    if (!rule.rule?.trim()) throw new RuleSetError(`${where}: missing rule text`);
    if (!rule.context?.trim()) throw new RuleSetError(`${where}: missing context`);
    if (!rule.recommendation?.trim()) throw new RuleSetError(`${where}: missing recommendation`);
    if (!SEVERITIES.includes(rule.severity)) {
      throw new RuleSetError(`${where}: severity must be one of ${SEVERITIES.join(', ')}`);
    }
    if (!rule.origin?.summary?.trim()) {
      throw new RuleSetError(`${where}: origin.summary is required`);
    }

    const match = rule.match ?? {};
    const hasScope = (match.pathInclude ?? []).length > 0;
    for (const labelRule of match.labelRules ?? []) {
      if (!Array.isArray(labelRule.canonical) || labelRule.canonical.length === 0) {
        throw new RuleSetError(`${where}: labelRules.canonical must be a non-empty array`);
      }
    }
    if (!isExecutable(rule) && !hasScope) {
      throw new RuleSetError(`${where}: rule has neither a detector nor a path scope`);
    }
    // Compile now: a bad regex must fail at load, not at scan time.
    compileRule(rule);
  }

  return candidate;
}

export function loadRuleSet(path: string): RuleSet {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (error) {
    throw new RuleSetError(
      `cannot read rule set ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    throw new RuleSetError(
      `rule set ${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return validateRuleSet(raw);
}

export function compileRuleSet(ruleSet: RuleSet): CompiledRule[] {
  return ruleSet.rules.map(compileRule);
}
