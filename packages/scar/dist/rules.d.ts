import type { FileNameRule, LabelRule, NumericRule, RuleSet, ScarRule, Severity } from './types.js';
export declare const SEVERITIES: readonly Severity[];
export declare class RuleSetError extends Error {
    constructor(message: string);
}
/**
 * Convert a small glob (`**`, `*`, `?`) to an anchored RegExp. Deliberately
 * tiny: a rule set should not need a dependency just to scope a file path.
 */
export declare function globToRegex(glob: string): RegExp;
/**
 * JS RegExp has no inline `(?i)`. Convention: a leading `(?i)` in a rule
 * pattern becomes the case-insensitive flag, keeping the JSON readable and
 * portable across engines.
 */
export declare function jsRegex(pattern: string, extraFlags?: string): RegExp;
export interface CompiledRule extends ScarRule {
    _include: RegExp[];
    _exclude: RegExp[];
    _line: RegExp[];
    _numeric: Array<NumericRule & {
        re: RegExp;
    }>;
    _fileName: Array<FileNameRule & {
        re: RegExp;
    }>;
    _labels: LabelRule[];
    _required: RegExp[];
    _exempt: RegExp[];
    _exemptLines: RegExp[];
}
export declare function compileRule(rule: ScarRule): CompiledRule;
/** True when the rule has at least one machine detector. */
export declare function isExecutable(rule: ScarRule): boolean;
/** Validate a rule set before any file is scanned. */
export declare function validateRuleSet(raw: unknown): RuleSet;
export declare function loadRuleSet(path: string): RuleSet;
export declare function compileRuleSet(ruleSet: RuleSet): CompiledRule[];
