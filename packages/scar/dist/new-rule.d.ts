import type { Severity } from './types.js';
export declare class ScaffoldError extends Error {
    constructor(message: string);
}
export interface ScaffoldOptions {
    /** The rule in one imperative sentence: what must not happen again. */
    title: string;
    /** Glob(s) the rule is allowed to fire in. The fixture is placed to match. */
    scope: readonly string[];
    severity?: Severity;
    id?: string;
    rulesPath: string;
    fixtureRoot: string;
    cwd: string;
}
export interface ScaffoldResult {
    id: string;
    rulesPath: string;
    positivePath: string;
    negativePath: string;
    /** Fixture paths when --scope was given more than once. */
    otherFixtures: string[];
    createdRuleFile: boolean;
    nextSteps: string[];
}
/**
 * Where the fixture has to live: the literal directory in front of the first
 * wildcard, plus the scope's own extension. A fixture outside this path is never
 * scanned, which is the failure mode people hit when they place it by hand.
 */
export declare function fixtureRelativePath(rawScope: string, id: string): string;
/**
 * People write `--scope test-pages/` when they mean "everything under it". A
 * literal path with no wildcard would scope the rule to one file that does not
 * exist yet, so a trailing slash or an existing directory becomes a subtree.
 */
export declare function normaliseScope(entry: string): string;
export declare function scaffoldRule(options: ScaffoldOptions): ScaffoldResult;
export declare function formatScaffold(result: ScaffoldResult): string;
