#!/usr/bin/env node
import type { ReportFormat } from './local.js';
import { type FailOn } from './report.js';
import type { Severity } from './types.js';
export declare const DEFAULT_RULES: string;
export declare class CliError extends Error {
    constructor(message: string);
}
export interface CliOptions {
    rules: string;
    /** True when --rules was passed. Without it, a local scar-tissue.json wins. */
    rulesExplicit: boolean;
    paths: string[];
    base?: string;
    staged: boolean;
    json: boolean;
    markdown: boolean;
    failOn: FailOn;
    maxPerRule: number;
    help: boolean;
}
export declare const USAGE = "sfqa-scar - review code against past-failure patterns\n\nThe four things you do\n  sfqa-scar [options] [paths...]   scan files or directories\n  sfqa-scar new --rule <sentence> --scope <dir-or-glob>\n                                   start a rule: writes the rule and both fixtures\n  sfqa-scar prove [--id ST-020]    prove rules against their fixtures\n  sfqa-scar harvest --help         find incidents that never became rules\n\nScan options\n  --base <ref>         Review files changed vs a git ref instead of paths\n  --staged             Review only staged files\n  --rules <file>       Rule set to load (default: scar-tissue.json if it exists,\n                       otherwise the packaged template)\n  --fail-on <sev>      Exit 1 at this severity or higher: high|med|low|any (default: high)\n  --json               Machine-readable JSON on stdout\n  --markdown           Markdown table with relative paths, for a PR or a write-up\n  --max-per-rule <n>   Max lines reported per rule per file (default: 5)\n  -h, --help           This message\n\nNew rule options (sfqa-scar new)\n  --rule <sentence>    The rule, imperative: what must not happen again\n  --scope <dir|glob>   Where the rule may fire; repeatable. A plain directory means\n                       \"everything under it\". The fixture is placed to match it.\n                       Required: a rule with no place cannot be proved\n  --severity <sev>     high|med|low (default: med - high is for lost data, a\n                       leaked secret, a wrong record or a false green)\n  --id <id>            Rule id (default: the next free one, e.g. ST-020)\n  --fixtures <dir>     Fixture root (default: scar-fixtures)\n\nProve options (sfqa-scar prove)\n  --id <id>            Prove only this rule; repeatable\n  --rules <file>       Rule set to prove (same default as scan)\n  --fixtures <dir>     Fixture root (default: scar-fixtures)\n\nRun sfqa-scar harvest --help for the history and report options.\n";
export declare const HARVEST_USAGE = "sfqa-scar harvest - propose rules for incidents no rule claims\n\n  sfqa-scar harvest [options]      read git history for incident-shaped commits\n  sfqa-scar harvest --staged       read one staged change instead\n\nOptions\n  --since <date>       Only read commits after this date (git --since)\n  --limit <n>          Max commits read (default: 300)\n  --all                Also show covered and dismissed incidents\n  --write <file>       Write candidates as JSON, for review or a PR comment\n  --strict             Exit 1 when any incident-shaped change has no rule\n  --staged             Inspect the staged change instead of history\n  --message <text>     Commit message for --staged\n  --message-file <f>   Read the commit message from a file (commit-msg hook)\n  --force              Treat a staged change as an incident without a keyword\n  --report <path>      Read a Playwright JSON / JUnit XML report (repeatable)\n  --report-format <f>  auto|playwright|junit (default: auto)\n  --ask                Prompt to capture or ignore each staged candidate\n  --capture <id>       Record a captured candidate in the capture queue\n  --ignore <id>        Record a dismissal in the ignore ledger\n  --rules <file>       Rule set to check candidates against\n  --ignore-file <f>    Ledger path (default: scar-tissue.ignore.json)\n  --capture-file <f>   Queue path (default: scar-tissue.candidates.json)\n  -h, --help           This message\n\nA candidate is a commit whose message says fix, revert, hotfix, flaky, timeout,\nrace, regression or credential, and that no rule in your rule set mentions.\n";
export declare function parseArgs(argv: readonly string[], defaultRules?: string): CliOptions;
export interface HarvestCliOptions {
    rules: string;
    rulesExplicit: boolean;
    since?: string;
    limit: number;
    json: boolean;
    all: boolean;
    write?: string;
    strict: boolean;
    help: boolean;
    staged: boolean;
    message?: string;
    messageFile?: string;
    force: boolean;
    reports: string[];
    reportFormat: ReportFormat;
    ignoreFile: string;
    ignore: string[];
    captureFile: string;
    capture: string[];
    ask: boolean;
}
export declare function parseHarvestArgs(argv: readonly string[], defaultRules?: string): HarvestCliOptions;
export type Ask = (question: string) => Promise<string>;
/**
 * Advisory command. Exit 0 by default even when it finds gaps, because a gap is
 * information, not a failed scan. `--strict` makes a gap fail CI.
 *
 * `--ask` prompts only for a staged change, because that is the one moment the
 * person still remembers the incident. History is reviewed in bulk instead.
 */
export declare function runHarvest(options: HarvestCliOptions, cwd?: string, ask?: Ask): Promise<number>;
export interface NewCliOptions {
    rule?: string;
    scope: string[];
    severity?: Severity;
    id?: string;
    rules?: string;
    fixtures: string;
    help: boolean;
}
export declare function parseNewArgs(argv: readonly string[]): NewCliOptions;
/** Write one rule and its two fixtures. Returns 0; a bad request is a usage error. */
export declare function runNew(options: NewCliOptions, cwd?: string): number;
export interface ProveCliOptions {
    ids: string[];
    rules?: string;
    fixtures: string;
    help: boolean;
}
export declare function parseProveArgs(argv: readonly string[]): ProveCliOptions;
/** Prove rules against their fixtures. 0 all proven, 1 a proof failed, 2 bad input. */
export declare function runProve(options: ProveCliOptions, cwd?: string): number;
/** Run the scanner. Returns a process exit code: 0 clean, 1 findings, 2 usage. */
export declare function run(options: CliOptions, cwd?: string): number;
export declare function main(argv?: readonly string[]): Promise<number>;
