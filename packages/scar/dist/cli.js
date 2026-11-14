#!/usr/bin/env node
// packages/scar/src/cli.ts
// -----------------------------------------------------------------------------
// sfqa-scar: review code against a rule set extracted from past failures.
//
// Usage:
//   sfqa-scar [options] [paths...]
//
// The default rule set ships with the package (`rules/generic.json`). Point
// `--rules` at your own rule set once you have extracted one from your repo's
// history; the detectors are data, so no code change is needed.
// -----------------------------------------------------------------------------
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { HarvestError, formatHarvestJson, formatHarvestText, harvest, } from './harvest.js';
import { DEFAULT_IGNORE_FILE, addIgnore, loadIgnoreLedger, saveIgnoreLedger, } from './ignore.js';
import { DEFAULT_CAPTURE_FILE, addCapture, loadCaptureQueue, saveCaptureQueue, } from './capture.js';
import { formatScaffold, ScaffoldError, scaffoldRule } from './new-rule.js';
import { DEFAULT_FIXTURE_ROOT, formatProof, ProveError, proveRules } from './prove.js';
import { buildReport, formatJson, formatMarkdown, formatText, shouldFail, } from './report.js';
import { RuleSetError, SEVERITIES, compileRuleSet, loadRuleSet } from './rules.js';
import { collectFiles, gitChangedFiles, scanFiles } from './scan.js';
export const DEFAULT_RULES = join(dirname(fileURLToPath(import.meta.url)), '..', 'rules', 'generic.json');
export class CliError extends Error {
    constructor(message) {
        super(message);
        this.name = 'CliError';
    }
}
const FAIL_ON_VALUES = ['high', 'med', 'low', 'any'];
export const USAGE = `sfqa-scar - review code against past-failure patterns

The four things you do
  sfqa-scar [options] [paths...]   scan files or directories
  sfqa-scar new --rule <sentence> --scope <dir-or-glob>
                                   start a rule: writes the rule and both fixtures
  sfqa-scar prove [--id ST-020]    prove rules against their fixtures
  sfqa-scar harvest --help         find incidents that never became rules

Scan options
  --base <ref>         Review files changed vs a git ref instead of paths
  --staged             Review only staged files
  --rules <file>       Rule set to load (default: scar-tissue.json if it exists,
                       otherwise the packaged template)
  --fail-on <sev>      Exit 1 at this severity or higher: high|med|low|any (default: high)
  --json               Machine-readable JSON on stdout
  --markdown           Markdown table with relative paths, for a PR or a write-up
  --max-per-rule <n>   Max lines reported per rule per file (default: 5)
  -h, --help           This message

New rule options (sfqa-scar new)
  --rule <sentence>    The rule, imperative: what must not happen again
  --scope <dir|glob>   Where the rule may fire; repeatable. A plain directory means
                       "everything under it". The fixture is placed to match it.
                       Required: a rule with no place cannot be proved
  --severity <sev>     high|med|low (default: med - high is for lost data, a
                       leaked secret, a wrong record or a false green)
  --id <id>            Rule id (default: the next free one, e.g. ST-020)
  --fixtures <dir>     Fixture root (default: scar-fixtures)

Prove options (sfqa-scar prove)
  --id <id>            Prove only this rule; repeatable
  --rules <file>       Rule set to prove (same default as scan)
  --fixtures <dir>     Fixture root (default: scar-fixtures)

Run sfqa-scar harvest --help for the history and report options.
`;
export const HARVEST_USAGE = `sfqa-scar harvest - propose rules for incidents no rule claims

  sfqa-scar harvest [options]      read git history for incident-shaped commits
  sfqa-scar harvest --staged       read one staged change instead

Options
  --since <date>       Only read commits after this date (git --since)
  --limit <n>          Max commits read (default: 300)
  --all                Also show covered and dismissed incidents
  --write <file>       Write candidates as JSON, for review or a PR comment
  --strict             Exit 1 when any incident-shaped change has no rule
  --staged             Inspect the staged change instead of history
  --message <text>     Commit message for --staged
  --message-file <f>   Read the commit message from a file (commit-msg hook)
  --force              Treat a staged change as an incident without a keyword
  --report <path>      Read a Playwright JSON / JUnit XML report (repeatable)
  --report-format <f>  auto|playwright|junit (default: auto)
  --ask                Prompt to capture or ignore each staged candidate
  --capture <id>       Record a captured candidate in the capture queue
  --ignore <id>        Record a dismissal in the ignore ledger
  --rules <file>       Rule set to check candidates against
  --ignore-file <f>    Ledger path (default: scar-tissue.ignore.json)
  --capture-file <f>   Queue path (default: scar-tissue.candidates.json)
  -h, --help           This message

A candidate is a commit whose message says fix, revert, hotfix, flaky, timeout,
race, regression or credential, and that no rule in your rule set mentions.
`;
export function parseArgs(argv, defaultRules = DEFAULT_RULES) {
    const options = {
        rules: defaultRules,
        rulesExplicit: false,
        paths: [],
        staged: false,
        json: false,
        markdown: false,
        failOn: 'high',
        maxPerRule: 5,
        help: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--rules') {
            options.rules = requireValue(argv, ++i, '--rules');
            options.rulesExplicit = true;
        }
        else if (arg === '--base') {
            options.base = requireValue(argv, ++i, '--base');
        }
        else if (arg === '--staged') {
            options.staged = true;
        }
        else if (arg === '--json') {
            options.json = true;
        }
        else if (arg === '--markdown') {
            options.markdown = true;
        }
        else if (arg === '--fail-on') {
            const value = requireValue(argv, ++i, '--fail-on');
            if (!FAIL_ON_VALUES.includes(value)) {
                throw new CliError(`--fail-on must be one of ${FAIL_ON_VALUES.join(', ')}`);
            }
            options.failOn = value;
        }
        else if (arg === '--max-per-rule') {
            const value = Number(requireValue(argv, ++i, '--max-per-rule'));
            if (!Number.isInteger(value) || value < 1) {
                throw new CliError('--max-per-rule must be a positive integer');
            }
            options.maxPerRule = value;
        }
        else if (arg === '-h' || arg === '--help') {
            options.help = true;
        }
        else if (arg.startsWith('-')) {
            throw new CliError(`unknown option ${arg}`);
        }
        else {
            options.paths.push(arg);
        }
    }
    return options;
}
function requireValue(argv, index, flag) {
    const value = argv[index];
    if (!value || value.startsWith('-')) {
        throw new CliError(`${flag} requires a value`);
    }
    return value;
}
export function parseHarvestArgs(argv, defaultRules = DEFAULT_RULES) {
    const options = {
        rules: defaultRules,
        rulesExplicit: false,
        limit: 300,
        json: false,
        all: false,
        strict: false,
        help: false,
        staged: false,
        force: false,
        reports: [],
        reportFormat: 'auto',
        ignoreFile: DEFAULT_IGNORE_FILE,
        ignore: [],
        captureFile: DEFAULT_CAPTURE_FILE,
        capture: [],
        ask: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--rules') {
            options.rules = requireValue(argv, ++i, '--rules');
        }
        else if (arg === '--since') {
            options.since = requireValue(argv, ++i, '--since');
        }
        else if (arg === '--limit') {
            const value = Number(requireValue(argv, ++i, '--limit'));
            if (!Number.isInteger(value) || value < 1) {
                throw new CliError('--limit must be a positive integer');
            }
            options.limit = value;
        }
        else if (arg === '--json') {
            options.json = true;
        }
        else if (arg === '--all') {
            options.all = true;
        }
        else if (arg === '--write') {
            options.write = requireValue(argv, ++i, '--write');
        }
        else if (arg === '--strict') {
            options.strict = true;
        }
        else if (arg === '--staged') {
            options.staged = true;
        }
        else if (arg === '--message') {
            options.message = requireValue(argv, ++i, '--message');
        }
        else if (arg === '--message-file') {
            options.messageFile = requireValue(argv, ++i, '--message-file');
        }
        else if (arg === '--force') {
            options.force = true;
        }
        else if (arg === '--report') {
            options.reports.push(requireValue(argv, ++i, '--report'));
        }
        else if (arg === '--report-format') {
            const value = requireValue(argv, ++i, '--report-format');
            if (!['auto', 'playwright', 'junit'].includes(value)) {
                throw new CliError('--report-format must be auto, playwright or junit');
            }
            options.reportFormat = value;
        }
        else if (arg === '--ignore-file') {
            options.ignoreFile = requireValue(argv, ++i, '--ignore-file');
        }
        else if (arg === '--ignore') {
            options.ignore.push(requireValue(argv, ++i, '--ignore'));
        }
        else if (arg === '--capture-file') {
            options.captureFile = requireValue(argv, ++i, '--capture-file');
        }
        else if (arg === '--capture') {
            options.capture.push(requireValue(argv, ++i, '--capture'));
        }
        else if (arg === '--ask') {
            options.ask = true;
        }
        else if (arg === '-h' || arg === '--help') {
            options.help = true;
        }
        else {
            throw new CliError(`unexpected argument ${arg} (harvest takes options only)`);
        }
    }
    return options;
}
async function defaultAsk(question) {
    const { createInterface } = await import('node:readline/promises');
    const reader = createInterface({ input: process.stdin, output: process.stdout });
    try {
        return (await reader.question(question)).trim().toLowerCase();
    }
    finally {
        reader.close();
    }
}
function readCommitMessage(cwd, file) {
    try {
        return readFileSync(resolve(cwd, file), 'utf8');
    }
    catch {
        return undefined;
    }
}
/** Strip the comment lines git puts in COMMIT_EDITMSG before it commits. */
function cleanMessage(message) {
    if (!message)
        return undefined;
    return message
        .split('\n')
        .filter((line) => !line.startsWith('#'))
        .join('\n')
        .trim();
}
/**
 * Advisory command. Exit 0 by default even when it finds gaps, because a gap is
 * information, not a failed scan. `--strict` makes a gap fail CI.
 *
 * `--ask` prompts only for a staged change, because that is the one moment the
 * person still remembers the incident. History is reviewed in bulk instead.
 */
export async function runHarvest(options, cwd = process.cwd(), ask) {
    if (options.help) {
        console.log(HARVEST_USAGE);
        return 0;
    }
    const rulesPath = options.rulesExplicit ? options.rules : defaultRulePath(cwd);
    let rules = [];
    try {
        rules = compileRuleSet(loadRuleSet(resolve(cwd, rulesPath)));
    }
    catch (error) {
        if (!(error instanceof RuleSetError))
            throw error;
        console.error(`sfqa-scar: ${error.message}`);
        console.error('harvest: continuing with no existing rules');
    }
    const ignorePath = resolve(cwd, options.ignoreFile);
    const ledger = loadIgnoreLedger(ignorePath);
    let ledgerChanged = false;
    const capturePath = resolve(cwd, options.captureFile);
    const captures = loadCaptureQueue(capturePath);
    let captureChanged = false;
    const now = new Date().toISOString();
    for (const entryFingerprint of options.ignore) {
        addIgnore(ledger, {
            fingerprint: entryFingerprint,
            reason: 'ignored from the command line',
            at: now,
        });
        ledgerChanged = true;
    }
    const message = cleanMessage(options.message ?? (options.messageFile ? readCommitMessage(cwd, options.messageFile) : undefined));
    const result = harvest(rules, {
        cwd,
        since: options.since,
        limit: options.limit,
        includeCovered: options.all,
        includeIgnored: options.all,
        staged: options.staged,
        message,
        force: options.force,
        reports: options.reports,
        reportFormat: options.reportFormat,
        ignoreLedger: ledger,
        captureQueue: captures,
    });
    console.log(options.json ? formatHarvestJson(result) : formatHarvestText(result));
    let accepted = [...result.candidates];
    for (const entryFingerprint of options.capture) {
        const candidate = result.candidates.find((item) => item.fingerprint === entryFingerprint);
        addCapture(captures, {
            fingerprint: entryFingerprint,
            capturedAt: now,
            ...(candidate?.subject ? { subject: candidate.subject } : {}),
            ...(candidate?.files ? { files: candidate.files } : {}),
            ...(candidate ? { draft: candidate.draft } : {}),
        });
        captureChanged = true;
        console.log(candidate
            ? `captured ${entryFingerprint} (${candidate.subject})`
            : `captured ${entryFingerprint} with no draft in this run - re-run the same source to attach one`);
    }
    if (options.ask && options.staged && result.candidates.length > 0) {
        const interactive = ask ?? (process.stdin.isTTY ? defaultAsk : undefined);
        if (!interactive) {
            console.log('\nnot a TTY; no prompt. Capture later with --capture <id>, dismiss with --ignore <id>.');
        }
        else {
            accepted = [];
            for (const candidate of result.candidates) {
                if (candidate.ignoredAt) {
                    accepted.push(candidate);
                    console.log(`\nalready dismissed ${candidate.fingerprint}; --all shows why.`);
                    continue;
                }
                if (candidate.capturedAt) {
                    accepted.push(candidate);
                    console.log(`\nalready captured ${candidate.fingerprint} on ${candidate.capturedAt}.`);
                    continue;
                }
                const answer = await interactive(`\ncapture a draft for ${candidate.shortHash} "${candidate.subject}"? [y]es / [i]gnore / [s]kip: `);
                if (answer.startsWith('y')) {
                    accepted.push(candidate);
                    addCapture(captures, {
                        fingerprint: candidate.fingerprint,
                        capturedAt: new Date().toISOString(),
                        subject: candidate.subject,
                        files: candidate.files,
                        draft: candidate.draft,
                    });
                    captureChanged = true;
                    console.log(`  captured ${candidate.fingerprint}`);
                }
                else if (answer.startsWith('i')) {
                    const reason = await interactive('  reason (optional): ');
                    addIgnore(ledger, {
                        fingerprint: candidate.fingerprint,
                        reason: reason || 'ignored at commit time',
                        at: new Date().toISOString(),
                        subject: candidate.subject,
                    });
                    ledgerChanged = true;
                    console.log(`  ignored ${candidate.fingerprint} - not asked again`);
                }
            }
        }
    }
    else if (options.ask && !options.staged) {
        console.log('\n--ask only prompts for --staged. Use --write for a history review.');
    }
    if (ledgerChanged)
        saveIgnoreLedger(ignorePath, ledger);
    if (captureChanged) {
        saveCaptureQueue(capturePath, captures);
        console.log(`\ncaptured decisions in ${capturePath}`);
    }
    if (options.write) {
        const target = resolve(cwd, options.write);
        writeFileSync(target, `${formatHarvestJson({ ...result, candidates: accepted })}\n`, 'utf8');
        console.log(`\nwrote ${target}`);
    }
    const gaps = [...accepted, ...result.localFailures];
    return options.strict && gaps.length > 0 ? 1 : 0;
}
/** Local rule set if the repository has one, otherwise the packaged template. */
function defaultRulePath(cwd) {
    return existsSync(resolve(cwd, 'scar-tissue.json')) ? 'scar-tissue.json' : DEFAULT_RULES;
}
/** A path as a person would type it: relative when it is under the working directory. */
function shownPath(cwd, absolute) {
    const rel = absolute.startsWith(cwd) ? absolute.slice(cwd.length).replace(/^[\\/]/, '') : absolute;
    return rel || absolute;
}
export function parseNewArgs(argv) {
    const options = { scope: [], fixtures: DEFAULT_FIXTURE_ROOT, help: false };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--rule') {
            options.rule = requireValue(argv, ++i, '--rule');
        }
        else if (arg === '--scope') {
            options.scope.push(requireValue(argv, ++i, '--scope'));
        }
        else if (arg === '--severity') {
            const value = requireValue(argv, ++i, '--severity');
            if (!SEVERITIES.includes(value)) {
                throw new CliError(`--severity must be one of ${SEVERITIES.join(', ')}`);
            }
            options.severity = value;
        }
        else if (arg === '--id') {
            options.id = requireValue(argv, ++i, '--id');
        }
        else if (arg === '--rules') {
            options.rules = requireValue(argv, ++i, '--rules');
        }
        else if (arg === '--fixtures') {
            options.fixtures = requireValue(argv, ++i, '--fixtures');
        }
        else if (arg === '-h' || arg === '--help') {
            options.help = true;
        }
        else {
            throw new CliError(`unexpected argument ${arg} (new takes options, e.g. --rule "..." --scope "src/**")`);
        }
    }
    return options;
}
/** Write one rule and its two fixtures. Returns 0; a bad request is a usage error. */
export function runNew(options, cwd = process.cwd()) {
    if (options.help) {
        console.log(USAGE);
        return 0;
    }
    if (!options.rule) {
        throw new CliError('new needs --rule: the rule in one sentence, e.g. --rule "Never pass options to isVisible()"');
    }
    const result = scaffoldRule({
        title: options.rule,
        scope: options.scope,
        severity: options.severity,
        id: options.id,
        // `new` always writes a rule set you own. The packaged template is a
        // read-only reference and, in an installed package, lives inside
        // node_modules - appending to it would be lost on the next install.
        rulesPath: options.rules ?? 'scar-tissue.json',
        fixtureRoot: options.fixtures,
        cwd,
    });
    console.log(formatScaffold(result));
    return 0;
}
export function parseProveArgs(argv) {
    const options = { ids: [], fixtures: DEFAULT_FIXTURE_ROOT, help: false };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--id') {
            options.ids.push(requireValue(argv, ++i, '--id'));
        }
        else if (arg === '--rules') {
            options.rules = requireValue(argv, ++i, '--rules');
        }
        else if (arg === '--fixtures') {
            options.fixtures = requireValue(argv, ++i, '--fixtures');
        }
        else if (arg === '-h' || arg === '--help') {
            options.help = true;
        }
        else if (arg.startsWith('-')) {
            throw new CliError(`unexpected option ${arg}`);
        }
        else {
            options.ids.push(arg);
        }
    }
    return options;
}
/** Prove rules against their fixtures. 0 all proven, 1 a proof failed, 2 bad input. */
export function runProve(options, cwd = process.cwd()) {
    if (options.help) {
        console.log(USAGE);
        return 0;
    }
    const rulesPath = options.rules ?? defaultRulePath(cwd);
    let ruleSet;
    try {
        ruleSet = loadRuleSet(resolve(cwd, rulesPath));
    }
    catch (error) {
        if (error instanceof RuleSetError) {
            console.error(`sfqa-scar: ${error.message}`);
            return 2;
        }
        throw error;
    }
    const result = proveRules(ruleSet.rules, resolve(cwd, options.fixtures), options.ids);
    console.log(formatProof(result, shownPath(cwd, resolve(cwd, rulesPath)), ruleSet.rules.length, shownPath(cwd, resolve(cwd, options.fixtures))));
    return result.passed ? 0 : 1;
}
/** Run the scanner. Returns a process exit code: 0 clean, 1 findings, 2 usage. */
export function run(options, cwd = process.cwd()) {
    if (options.help) {
        console.log(USAGE);
        return 0;
    }
    // A repository with its own scar-tissue.json is scanning its own rules.
    // Ignoring that file here but honouring it in `prove` is the single most
    // confusing thing this tool could do: you add a rule, run the scan, and see
    // nothing. So the same resolver is used by both verbs.
    const rulesPath = options.rulesExplicit ? options.rules : defaultRulePath(cwd);
    let ruleSet;
    try {
        ruleSet = loadRuleSet(resolve(cwd, rulesPath));
    }
    catch (error) {
        if (error instanceof RuleSetError) {
            console.error(`sfqa-scar: ${error.message}`);
            return 2;
        }
        throw error;
    }
    const rules = compileRuleSet(ruleSet);
    const targets = options.staged || options.base
        ? gitChangedFiles(cwd, options.base, options.staged)
        : options.paths;
    if (targets.length === 0)
        targets.push('.');
    const files = collectFiles(targets, cwd);
    const result = scanFiles(cwd, files, rules, { maxPerRule: options.maxPerRule });
    const report = buildReport(rulesPath, result.filesScanned, result.findings);
    if (options.json && options.markdown) {
        console.error('sfqa-scar: --json and --markdown are mutually exclusive');
        return 2;
    }
    const rendered = options.json
        ? formatJson(report)
        : options.markdown
            ? formatMarkdown(report)
            : formatText(report, cwd);
    console.log(rendered);
    return shouldFail(result.findings, options.failOn) ? 1 : 0;
}
export async function main(argv = process.argv.slice(2)) {
    try {
        if (argv[0] === 'harvest') {
            return await runHarvest(parseHarvestArgs(argv.slice(1)));
        }
        if (argv[0] === 'new') {
            return runNew(parseNewArgs(argv.slice(1)));
        }
        if (argv[0] === 'prove') {
            return runProve(parseProveArgs(argv.slice(1)));
        }
        return run(parseArgs(argv));
    }
    catch (error) {
        if (error instanceof CliError) {
            console.error(`sfqa-scar: ${error.message}\n`);
            console.error(USAGE);
            return 2;
        }
        if (error instanceof HarvestError || error instanceof ScaffoldError || error instanceof ProveError) {
            console.error(`sfqa-scar: ${error.message}`);
            return 2;
        }
        throw error;
    }
}
/**
 * True when this file is the process entry point.
 *
 * npm installs a bin as a symlink - `node_modules/.bin/sfqa-scar` pointing at
 * `@sfqa/scar/dist/cli.js` - so argv[1] is the symlink and import.meta.url is
 * the real file. Comparing them directly is false under `npx` and the CLI exits
 * silently with status 0, which looks exactly like "found nothing". Compare
 * real paths instead.
 */
function invokedDirectly() {
    const entry = process.argv[1];
    if (entry === undefined)
        return false;
    try {
        return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
    }
    catch {
        return import.meta.url === pathToFileURL(entry).href;
    }
}
if (invokedDirectly()) {
    void main().then((code) => {
        process.exitCode = code;
    }, (error) => {
        console.error(error instanceof Error ? (error.stack ?? error.message) : String(error));
        process.exitCode = 2;
    });
}
