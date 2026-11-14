// packages/scar/src/harvest.ts
// -----------------------------------------------------------------------------
// Rule discovery. The scanner enforces rules that already exist; harvest finds
// the incidents that never became rules and hands back a draft for each one.
//
// Two sources: git history (failures the team already fixed) and local test
// reports (failures it is living with now). Deterministic on purpose: it never
// writes a rule at scan time. A person (or a model working for one) still
// approves the draft, because a rule that cannot cite an incident is a style
// opinion.
// -----------------------------------------------------------------------------
import { execFileSync } from 'node:child_process';
import { basename } from 'node:path';
import { fingerprint } from './hash.js';
import { findCapture } from './capture.js';
import { findIgnore } from './ignore.js';
import { readLocalReports } from './local.js';
import { isSecretShaped, redactLine } from './redact.js';
/** Commit messages that usually mean "something broke and was repaired". */
export const INCIDENT_KEYWORDS = /\b(fix|fixed|fixes|fixing|revert|reverted|hotfix|flaky|flake|race|timeout|workaround|credential|credentials|secret|secrets|rollback|regression|bug|defect|patch)\b/i;
const CODE_EXTENSIONS = new Set([
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.py',
    '.java',
    '.rb',
    '.go',
    '.cs',
    '.php',
    '.kt',
    '.swift',
    '.scala',
    '.feature',
    '.json',
    '.yml',
    '.yaml',
    '.sql',
    '.sh',
]);
const FIELD = '\x1f';
const RECORD = '\x1e';
export class HarvestError extends Error {
    constructor(message) {
        super(message);
        this.name = 'HarvestError';
    }
}
function git(cwd, args) {
    try {
        return execFileSync('git', args, {
            cwd,
            encoding: 'utf8',
            maxBuffer: 32 * 1024 * 1024,
        });
    }
    catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new HarvestError(`git ${args.join(' ')} failed: ${detail}`);
    }
}
function readCommits(cwd, options) {
    const limit = options.limit ?? 300;
    const format = `%H${FIELD}%h${FIELD}%ad${FIELD}%s${FIELD}%b${RECORD}`;
    const args = ['log', '--no-merges', '--date=short', `--format=${format}`, '-n', String(limit)];
    if (options.since)
        args.push(`--since=${options.since}`);
    return git(cwd, args)
        .split(RECORD)
        .map((record) => record.trim())
        .filter(Boolean)
        .map((record) => {
        const [hash, shortHash, date, subject, body] = record.split(FIELD);
        return {
            hash: hash ?? '',
            shortHash: shortHash ?? '',
            date: date ?? '',
            subject: subject ?? '',
            body: body ?? '',
        };
    })
        .filter((commit) => commit.hash.length > 0);
}
function parseDiff(out) {
    const files = new Set();
    const removed = [];
    const added = [];
    for (const line of out.split('\n')) {
        if (line.startsWith('+++ b/')) {
            files.add(line.slice(6).trim());
        }
        else if (line.startsWith('--- a/')) {
            continue;
        }
        else if (line.startsWith('+') && !line.startsWith('+++')) {
            added.push(line.slice(1));
        }
        else if (line.startsWith('-') && !line.startsWith('---')) {
            removed.push(line.slice(1));
        }
    }
    return { files: [...files], removed, added };
}
function readDiff(cwd, hash) {
    return parseDiff(git(cwd, ['show', '--format=', '--unified=0', '--no-color', '--no-ext-diff', hash]));
}
function readStagedDiff(cwd) {
    return parseDiff(git(cwd, ['diff', '--cached', '--unified=0', '--no-color', '--no-ext-diff']));
}
function isCodeFile(file) {
    const dot = file.lastIndexOf('.');
    return dot !== -1 && CODE_EXTENSIONS.has(file.slice(dot).toLowerCase());
}
function isComment(line) {
    const trimmed = line.trimStart();
    return (trimmed.startsWith('//') ||
        trimmed.startsWith('/*') ||
        trimmed.startsWith('*') ||
        (trimmed.startsWith('#') && !trimmed.startsWith('#!')));
}
function meaningful(lines) {
    return lines
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .filter((line) => !isComment(line))
        .filter((line) => !/^[{}()[\];,]+$/.test(line))
        .filter((line) => !/^(import|export\s+\{|export\s+default|from)\b/.test(line));
}
function escapeRegex(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
/** Turn a literal token into a regex, allowing flexible whitespace. */
function toRegex(token) {
    return token
        .trim()
        .split(/\s+/)
        .map(escapeRegex)
        .join('\\s*');
}
const CALL = /[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*\(/g;
const LITERAL = /(['"])([^'"\n]{2,})\1/g;
const GENERIC_CALLS = new Set([
    'expect(',
    'it(',
    'describe(',
    'test(',
    'console.log(',
    'console.error(',
    'require(',
    'import(',
    'assert(',
    'beforeEach(',
    'afterEach(',
    'beforeAll(',
    'afterAll(',
]);
function tokensIn(line) {
    const tokens = [];
    for (const match of line.matchAll(CALL)) {
        const raw = match[0].replace(/\s*\.\s*/g, '.').replace(/\s+/g, ' ');
        const value = raw.endsWith('(') ? raw : `${raw}(`;
        if (GENERIC_CALLS.has(value))
            continue;
        const score = value.length + (value.includes('.') ? 10 : 0) + 5;
        tokens.push({ value, score });
    }
    // A literal on a credential line is a value, not a pattern. Proposing it
    // would write the secret into the rule file, which is the opposite of the fix.
    if (!isSecretShaped(line)) {
        for (const match of line.matchAll(LITERAL)) {
            const value = `${match[1]}${match[2]}${match[1]}`;
            tokens.push({ value, score: value.length + 3 });
        }
    }
    return tokens;
}
function commonDir(files) {
    const dirs = files.map((file) => {
        const slash = file.lastIndexOf('/');
        return slash === -1 ? '' : file.slice(0, slash);
    });
    if (dirs.length === 0 || dirs.some((dir) => dir.length === 0))
        return null;
    const parts = dirs.map((dir) => dir.split('/'));
    const first = parts[0];
    let end = first.length;
    for (const part of parts.slice(1)) {
        let i = 0;
        while (i < end && i < part.length && part[i] === first[i])
            i++;
        end = i;
    }
    return end === 0 ? null : first.slice(0, end).join('/');
}
function propose(diff) {
    const dir = commonDir(diff.files);
    const pathInclude = dir
        ? [`${dir}/**`]
        : [...new Set(diff.files.map((file) => `**/${basename(file)}`))];
    const removed = meaningful(diff.removed);
    const addedText = diff.added.map(redactLine).join('\n');
    const ranked = removed
        .flatMap((line) => tokensIn(line))
        .filter((token) => !addedText.includes(token.value))
        .sort((a, b) => b.score - a.score);
    const seen = new Set();
    const linePatterns = [];
    for (const token of ranked) {
        if (linePatterns.length >= 2)
            break;
        if (seen.has(token.value))
            continue;
        seen.add(token.value);
        linePatterns.push(toRegex(token.value));
    }
    const best = ranked[0]?.score ?? 0;
    const confidence = best >= 20 ? 'high' : best >= 8 ? 'medium' : 'low';
    return {
        pathInclude: pathInclude.length > 0 ? pathInclude : ['**/*'],
        linePatterns,
        confidence,
        executable: linePatterns.length > 0,
    };
}
function nextRuleNumber(rules) {
    let highest = 0;
    for (const rule of rules) {
        const match = /^[A-Z]+-(\d+)$/.exec(rule.id);
        if (match)
            highest = Math.max(highest, Number(match[1]));
    }
    return highest + 1;
}
function draftRule(commit, diff, proposal, id, originCommit) {
    const firstAdded = meaningful(diff.added).map(redactLine)[0];
    const ref = commit.shortHash === 'staged' ? 'the staged change' : commit.shortHash;
    return {
        id,
        rule: `Prevent a repeat of: ${commit.subject}`,
        context: `Files changed in ${ref} (${diff.files.slice(0, 3).join(', ') || 'no files'})`,
        origin: { commit: originCommit, summary: commit.subject },
        severity: 'med',
        detection_pattern: proposal.executable
            ? `Lines matching the pattern removed in ${ref}`
            : `TODO: no detector inferred; read the diff for ${ref}`,
        match: {
            pathInclude: proposal.pathInclude,
            ...(proposal.linePatterns.length > 0 ? { linePatterns: proposal.linePatterns } : {}),
        },
        recommendation: firstAdded
            ? `Adopt the fix from ${ref}: ${firstAdded}`
            : `Review the change in ${ref} and write the guardrail.`,
    };
}
function coveredBy(commit, diff, rules) {
    const ids = new Set();
    for (const rule of rules) {
        const origin = rule.origin?.commit;
        if (origin &&
            (commit.hash === origin ||
                commit.hash.startsWith(origin) ||
                commit.shortHash === origin ||
                (origin.length >= 7 && commit.hash.startsWith(origin.slice(0, 7))))) {
            ids.add(rule.id);
        }
        for (const line of diff.removed) {
            for (const re of rule._line) {
                re.lastIndex = 0;
                if (re.test(line)) {
                    ids.add(rule.id);
                    break;
                }
            }
        }
        for (const file of diff.files) {
            const base = basename(file);
            for (const fileRule of rule._fileName) {
                fileRule.re.lastIndex = 0;
                if (fileRule.re.test(base))
                    ids.add(rule.id);
            }
        }
    }
    return [...ids];
}
function stagedCommit(options) {
    const message = (options.message ?? '').trim();
    if (!message && !options.force)
        return [];
    if (message && !(options.keywords ?? INCIDENT_KEYWORDS).test(message) && !options.force) {
        return [];
    }
    const [subject, ...rest] = message.split('\n');
    return [
        {
            hash: 'staged',
            shortHash: 'staged',
            date: new Date().toISOString().slice(0, 10),
            subject: subject || 'staged change',
            body: rest.join('\n'),
        },
    ];
}
function candidateFingerprint(commit, diff) {
    if (commit.shortHash !== 'staged')
        return `commit:${commit.hash}`;
    return `staged:${fingerprint([
        commit.subject,
        [...diff.files].sort().join(','),
        diff.removed.map(redactLine).join('\n'),
    ])}`;
}
/**
 * Find incident-shaped changes that no existing rule accounts for: fixed
 * commits in history, the change staged right now, or repeated failures in a
 * local test report. Reads only. Writes nothing.
 */
export function harvest(rules, options = {}) {
    const cwd = options.cwd ?? process.cwd();
    const keywords = options.keywords ?? INCIDENT_KEYWORDS;
    const ledger = options.ignoreLedger;
    const capture = options.captureQueue;
    const includeIgnored = options.includeIgnored ?? false;
    let commits = [];
    if (options.staged) {
        commits = stagedCommit(options);
    }
    else {
        try {
            commits = readCommits(cwd, options);
        }
        catch (error) {
            // A reports-only run outside a git checkout is still useful.
            if (!options.reports?.length)
                throw error;
        }
    }
    const stagedDiff = options.staged && commits.length > 0 ? readStagedDiff(cwd) : null;
    let incidents = 0;
    let ignored = 0;
    let captured = 0;
    let nextId = nextRuleNumber(rules);
    const candidates = [];
    const covered = [];
    for (const commit of commits) {
        if (!keywords.test(`${commit.subject}\n${commit.body}`) && !options.force)
            continue;
        incidents++;
        const diff = stagedDiff ?? readDiff(cwd, commit.hash);
        if (!diff.files.some(isCodeFile))
            continue;
        const matched = coveredBy(commit, diff, rules);
        if (matched.length > 0 && !options.includeCovered)
            continue;
        const dismissed = ledger ? findIgnore(ledger, candidateFingerprint(commit, diff)) : undefined;
        if (dismissed && !includeIgnored) {
            ignored++;
            continue;
        }
        const pending = capture ? findCapture(capture, candidateFingerprint(commit, diff)) : undefined;
        if (pending)
            captured++;
        const proposal = propose(diff);
        const candidate = {
            commit: commit.hash,
            shortHash: commit.shortHash,
            date: commit.date,
            subject: commit.subject,
            files: diff.files,
            removed: meaningful(diff.removed).map(redactLine).slice(0, 8),
            added: meaningful(diff.added).map(redactLine).slice(0, 8),
            pathInclude: proposal.pathInclude,
            linePatterns: proposal.linePatterns,
            confidence: proposal.confidence,
            executable: proposal.executable,
            coveredBy: matched,
            fingerprint: candidateFingerprint(commit, diff),
            ...(dismissed ? { ignoredAt: dismissed.at, ignoreReason: dismissed.reason } : {}),
            ...(pending ? { capturedAt: pending.capturedAt } : {}),
            draft: draftRule(commit, diff, proposal, `ST-${String(nextId++).padStart(3, '0')}`, options.staged ? null : commit.shortHash),
        };
        if (matched.length > 0)
            covered.push(candidate);
        else
            candidates.push(candidate);
    }
    let localFailures = [];
    if (options.reports && options.reports.length > 0) {
        localFailures = readLocalReports(options.reports, options.reportFormat ?? 'auto', cwd)
            .map((failure) => {
            const dismissed = ledger ? findIgnore(ledger, failure.fingerprint) : undefined;
            if (dismissed && !includeIgnored) {
                ignored++;
                return null;
            }
            return dismissed
                ? { ...failure, ignoredAt: dismissed.at, ignoreReason: dismissed.reason }
                : failure;
        })
            .filter((failure) => failure !== null);
    }
    return {
        commits: commits.length,
        incidents,
        candidates,
        covered,
        localFailures,
        ignored,
        captured,
        staged: options.staged ?? false,
    };
}
export function formatHarvestText(result) {
    const lines = [];
    const scope = result.staged
        ? 'staged change'
        : `${result.commits} commit(s) read`;
    const local = result.localFailures.length > 0 ? `, ${result.localFailures.length} local failure(s)` : '';
    const ignored = result.ignored > 0 ? ` (${result.ignored} ignored)` : '';
    const captured = result.captured > 0 ? ` (${result.captured} captured)` : '';
    lines.push(`sfqa-scar harvest - ${scope}, ${result.incidents} incident-shaped, ${result.candidates.length} without a rule${local}${ignored}${captured}`);
    result.candidates.forEach((candidate, index) => {
        lines.push('');
        lines.push(`CANDIDATE ${index + 1}/${result.candidates.length}`);
        lines.push(`  commit : ${candidate.shortHash}  ${candidate.date}`);
        lines.push(`  subject: ${candidate.subject}`);
        lines.push(`  files  : ${candidate.files.join(', ') || '(none)'}`);
        if (candidate.removed.length > 0) {
            lines.push(`  removed: ${candidate.removed.slice(0, 3).join('\n           ')}`);
        }
        if (candidate.added.length > 0) {
            lines.push(`  added  : ${candidate.added.slice(0, 3).join('\n           ')}`);
        }
        lines.push(`  detect : ${candidate.linePatterns.length > 0 ? candidate.linePatterns.join('  |  ') : '(none inferred - manual review)'}  [confidence ${candidate.confidence}]`);
        lines.push(`  scope  : ${candidate.pathInclude.join(', ')}`);
        lines.push(`  id     : ${candidate.fingerprint}`);
        if (candidate.ignoredAt) {
            lines.push(`  ignored: ${candidate.ignoreReason ?? 'dismissed'}  (${candidate.ignoredAt})`);
        }
        if (candidate.capturedAt) {
            lines.push(`  captured: yes, still waiting for a rule  (${candidate.capturedAt})`);
        }
        lines.push('  draft  :');
        for (const line of JSON.stringify(candidate.draft, null, 2).split('\n')) {
            lines.push(`    ${line}`);
        }
    });
    result.localFailures.forEach((failure, index) => {
        lines.push('');
        lines.push(`LOCAL FAILURE ${index + 1}/${result.localFailures.length}`);
        lines.push(`  test   : ${failure.test}`);
        if (failure.file)
            lines.push(`  file   : ${failure.file}`);
        lines.push(`  status : ${failure.status}  [${failure.occurrences} occurrence(s)]`);
        const message = failure.message.split('\n').slice(0, 3).join('\n           ');
        lines.push(`  error  : ${message}`);
        if (failure.ignoredAt) {
            lines.push(`  ignored: ${failure.ignoreReason ?? 'dismissed'}  (${failure.ignoredAt})`);
        }
        lines.push('  next   : find the source line behind this failure, then write one rule with two fixtures');
        lines.push(`  id     : ${failure.fingerprint}`);
    });
    if (result.covered.length > 0) {
        lines.push('');
        lines.push(`COVERED (already accounted for by an existing rule): ${result.covered.length}`);
        for (const candidate of result.covered) {
            lines.push(`  ${candidate.shortHash}  ${candidate.coveredBy.join(', ')}  ${candidate.subject}`);
        }
    }
    lines.push('');
    const hasGaps = result.candidates.length > 0 || result.localFailures.length > 0;
    if (!hasGaps) {
        lines.push('Nothing unclaimed. Every incident-shaped change has a rule.');
    }
    else {
        if (result.candidates.length > 0) {
            lines.push('Nothing was written. Review each draft, delete what you cannot defend,');
            lines.push('then prove it with a positive fixture (must fire) and a clean fixture (must not).');
        }
        if (result.localFailures.length > 0) {
            lines.push('Local failures are briefs, not drafts: a runtime error is not yet a source pattern.');
            lines.push('Dismiss one with: sfqa-scar harvest --ignore <id>   (recorded in scar-tissue.ignore.json)');
        }
        if (result.ignored > 0) {
            lines.push(`${result.ignored} candidate(s) dismissed in scar-tissue.ignore.json; use --all to see them.`);
        }
        if (result.captured > 0) {
            lines.push(`${result.captured} candidate(s) captured in scar-tissue.candidates.json and not asked again;`);
            lines.push('move each draft into the rule set to clear it.');
        }
    }
    return lines.join('\n');
}
export function formatHarvestJson(result) {
    const report = {
        tool: 'sfqa-scar',
        command: 'harvest',
        staged: result.staged,
        commits: result.commits,
        incidents: result.incidents,
        candidates: result.candidates,
        covered: result.covered,
        localFailures: result.localFailures,
        ignored: result.ignored,
        captured: result.captured,
    };
    return JSON.stringify(report, null, 2);
}
