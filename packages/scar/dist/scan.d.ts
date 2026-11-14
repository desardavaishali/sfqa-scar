import type { CompiledRule } from './rules.js';
import type { Finding } from './types.js';
export declare const SKIP_DIRS: Set<string>;
/** Normalise to forward slashes so globs behave the same on every platform. */
export declare function toPosix(path: string): string;
export declare function relPosix(root: string, path: string): string;
export declare function walk(dir: string, output?: string[]): string[];
/** Expand CLI path arguments into absolute file paths. */
export declare function collectFiles(targets: readonly string[], cwd: string): string[];
export declare function gitChangedFiles(cwd: string, baseRef?: string | null, staged?: boolean): string[];
/** True when the path is covered by .gitignore (exit 0 from git check-ignore). */
export declare function isGitIgnored(cwd: string, relPath: string): boolean;
/**
 * The same answer for many paths in one process.
 *
 * `isGitIgnored` spawns git per path. On a 1,400-file repository that is the
 * entire runtime of a scan; batching takes it from ~30s to well under a second.
 * Paths are fed NUL-separated so a space or a newline in a filename cannot
 * split the input.
 */
export declare function gitIgnoredSet(cwd: string, relPaths: readonly string[]): Set<string>;
export interface LintOptions {
    maxPerRule?: number;
    /** Findings in gitignored files are informational (downgraded to low). */
    ignored?: boolean;
}
export declare function lintContent(relPath: string, content: string, rules: readonly CompiledRule[], options?: LintOptions): Finding[];
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
export declare function scanFiles(cwd: string, files: readonly string[], rules: readonly CompiledRule[], options?: ScanOptions): ScanResult;
