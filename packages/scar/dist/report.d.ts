import type { Finding, Severity, SeverityCounts } from './types.js';
export declare const SEVERITY_ORDER: Record<Severity, number>;
export interface Report {
    tool: 'sfqa-scar';
    ruleSet: string;
    filesScanned: number;
    summary: SeverityCounts;
    findings: Finding[];
}
export declare function summarise(findings: readonly Finding[]): SeverityCounts;
export declare function buildReport(ruleSet: string, filesScanned: number, findings: readonly Finding[]): Report;
/** Lowest severity that fails the run. `any` means even `low` fails. */
export type FailOn = Severity | 'any';
export declare function shouldFail(findings: readonly Finding[], failOn?: FailOn): boolean;
export declare function formatText(report: Report, cwd: string): string;
export declare function formatJson(report: Report): string;
/**
 * Markdown for a pull-request comment or a write-up. Paths are relative to the
 * directory the scan ran in, so the output can be pasted or screenshotted
 * without leaking a home directory. The table is the scan; the fix list is what
 * a reader acts on.
 */
export declare function formatMarkdown(report: Report): string;
