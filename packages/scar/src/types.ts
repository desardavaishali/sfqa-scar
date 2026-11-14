// packages/scar/src/types.ts
// -----------------------------------------------------------------------------
// The rule-set contract. A rule is data, not code: the detector is a small,
// declarative object so a team can regenerate the rule set from their own git
// history without touching this package.
//
// Nothing in here names an org, a user, a label or a project. The shipped
// `rules/generic.json` is a template: its example value lists are meant to be
// replaced with the org's own canonical labels.
// -----------------------------------------------------------------------------

export type Severity = 'high' | 'med' | 'low';

export interface RuleOrigin {
  /** Optional commit or PR in the adopting repository. */
  commit?: string | null;
  pr?: string | null;
  /** What class of incident produced the rule. Never client data. */
  summary: string;
}

export interface FileNameRule {
  /** Regex tested against the file's base name (e.g. `^\.env$`). */
  pattern: string;
}

export interface NumericRule {
  pattern: string;
  flags?: string;
  /** Capture group 1 must fall in [min, max] for the rule to fire. */
  min: number;
  max: number;
}

export interface LabelRule {
  /**
   * Canonical display labels, exactly as the org renders them. A quoted
   * literal that matches one of these case-insensitively, or after removing
   * spaces and hyphens, is drift and fires the rule.
   */
  canonical: string[];
}

export interface RuleMatch {
  pathInclude?: string[];
  pathExclude?: string[];
  /**
   * Matched against the line plus the next three lines, and reported only when
   * the match starts on that line. A guard written on the following line -
   * `.isVisible({ timeout: 5000 })` then `.catch(() => false)` - therefore reads
   * as a deliberate probe, not a finding.
   */
  linePatterns?: string[];
  numericRules?: NumericRule[];
  fileNameRules?: FileNameRule[];
  /** Fire when NONE of these are present anywhere in the file. */
  fileRequiredSignals?: string[];
  /** Clear the whole file when ANY of these are present. */
  fileExemptSignals?: string[];
  /** Clear a single line when ANY of these match it. */
  fileExemptLines?: string[];
  labelRules?: LabelRule[];
}

export interface ScarRule {
  id: string;
  rule: string;
  context: string;
  origin: RuleOrigin;
  severity: Severity;
  detection_pattern: string;
  match: RuleMatch;
  recommendation: string;
  severity_note?: string;
}

export interface RuleSet {
  version: number;
  description?: string;
  generated_from_repo?: string;
  rules: ScarRule[];
}

export interface Finding {
  rule: ScarRule;
  relPath: string;
  /** 1-based; 0 means the finding is about the file itself. */
  line: number;
  snippet: string;
  meta?: string;
}

export interface SeverityCounts {
  high: number;
  med: number;
  low: number;
}
