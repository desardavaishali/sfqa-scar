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
/**
 * Read one or more report paths (file or directory) and merge duplicate
 * failures. Duplicates are the signal: the same test failing in four runs is a
 * stronger candidate than a one-off.
 */
export declare function readLocalReports(paths: readonly string[], format?: ReportFormat, cwd?: string): LocalFailure[];
