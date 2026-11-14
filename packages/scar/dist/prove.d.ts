import type { ScarRule, Severity } from './types.js';
/** Where `new` writes fixtures and `prove` reads them, unless told otherwise. */
export declare const DEFAULT_FIXTURE_ROOT = "scar-fixtures";
export declare class ProveError extends Error {
    constructor(message: string);
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
/**
 * Run every selected rule against the fixture pair.
 * `ids` limits the run to particular rules, which is what `--id` uses after
 * `new` so a person sees one verdict instead of nineteen.
 */
export declare function proveRules(rules: readonly ScarRule[], fixtureRoot: string, ids?: readonly string[]): ProofResult;
/**
 * The table the proof has printed since v0.1, plus one addition: when a rule
 * has a detector but no fixture made it fire, the scope is printed. Without it
 * the person has to guess which directory the fixture belongs in, and puts it
 * somewhere the rule never looks.
 */
export declare function formatProof(result: ProofResult, ruleSet: string, total: number, fixtureRoot?: string): string;
