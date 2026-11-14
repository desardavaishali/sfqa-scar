import { type CaptureQueue } from './capture.js';
import { type IgnoreLedger } from './ignore.js';
import { type LocalFailure, type ReportFormat } from './local.js';
import type { CompiledRule } from './rules.js';
import type { ScarRule } from './types.js';
/** Commit messages that usually mean "something broke and was repaired". */
export declare const INCIDENT_KEYWORDS: RegExp;
export declare class HarvestError extends Error {
    constructor(message: string);
}
export interface HarvestOptions {
    cwd?: string;
    /** Passed to `git log --since`. */
    since?: string;
    /** Max commits inspected. Defaults to 300. */
    limit?: number;
    keywords?: RegExp;
    /** Include incidents already covered by an existing rule. */
    includeCovered?: boolean;
    /** Also return candidates the ignore ledger dismissed. */
    includeIgnored?: boolean;
    /** Inspect the staged diff instead of git history. */
    staged?: boolean;
    /** Commit message, required for staged mode unless `force` is set. */
    message?: string;
    /** Treat a staged change as incident-shaped even without a keyword message. */
    force?: boolean;
    /** Local test report files or directories (Playwright JSON / JUnit XML). */
    reports?: readonly string[];
    reportFormat?: ReportFormat;
    ignoreLedger?: IgnoreLedger;
    captureQueue?: CaptureQueue;
}
export interface HarvestCandidate {
    commit: string;
    shortHash: string;
    date: string;
    subject: string;
    files: string[];
    removed: string[];
    added: string[];
    pathInclude: string[];
    linePatterns: string[];
    confidence: 'high' | 'medium' | 'low';
    executable: boolean;
    coveredBy: string[];
    fingerprint: string;
    ignoredAt?: string;
    ignoreReason?: string;
    capturedAt?: string;
    draft: ScarRule;
}
export interface HarvestResult {
    commits: number;
    incidents: number;
    candidates: HarvestCandidate[];
    covered: HarvestCandidate[];
    localFailures: LocalFailure[];
    ignored: number;
    captured: number;
    staged: boolean;
}
/**
 * Find incident-shaped changes that no existing rule accounts for: fixed
 * commits in history, the change staged right now, or repeated failures in a
 * local test report. Reads only. Writes nothing.
 */
export declare function harvest(rules: readonly CompiledRule[], options?: HarvestOptions): HarvestResult;
export declare function formatHarvestText(result: HarvestResult): string;
export interface HarvestReport {
    tool: 'sfqa-scar';
    command: 'harvest';
    staged: boolean;
    commits: number;
    incidents: number;
    candidates: HarvestCandidate[];
    covered: HarvestCandidate[];
    localFailures: LocalFailure[];
    ignored: number;
    captured: number;
}
export declare function formatHarvestJson(result: HarvestResult): string;
