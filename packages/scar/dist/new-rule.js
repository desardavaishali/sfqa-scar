// packages/scar/src/new-rule.ts
// -----------------------------------------------------------------------------
// Scaffolding one rule. The two steps people get wrong are mechanical, not
// thoughtful: picking an id, and putting the fixture where the rule actually
// looks. This does both, then prints the three things left to a person.
//
// It writes a skeleton, never an enforced rule: the pattern starts empty, so the
// proof reports the rule as a gap until someone supplies a detector.
// -----------------------------------------------------------------------------
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { globToRegex } from './rules.js';
import { relPosix, walk } from './scan.js';
const ID_SHAPE = /^[A-Z]+-\d+$/;
export class ScaffoldError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ScaffoldError';
    }
}
function readRuleSet(path) {
    if (!existsSync(path)) {
        return { ruleSet: { version: 1, description: 'Scar tissue this repository has paid for.', rules: [] }, created: true };
    }
    let raw;
    try {
        raw = JSON.parse(readFileSync(path, 'utf8'));
    }
    catch (error) {
        throw new ScaffoldError(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    }
    const candidate = raw;
    if (!candidate || typeof candidate !== 'object' || !Array.isArray(candidate.rules)) {
        throw new ScaffoldError(`${path} has no "rules" array`);
    }
    return { ruleSet: candidate, created: false };
}
/** Next free id for the prefix already used in this rule set (ST by default). */
function nextId(rules, requested) {
    if (requested) {
        if (!ID_SHAPE.test(requested))
            throw new ScaffoldError(`--id must look like "ST-020", got "${requested}"`);
        if (rules.some((rule) => rule.id === requested))
            throw new ScaffoldError(`${requested} already exists in this rule set`);
        return requested;
    }
    const used = rules.map((rule) => /^([A-Z]+)-(\d+)$/.exec(rule.id)).filter(Boolean);
    const prefix = used.length > 0 ? used[0][1] : 'ST';
    const highest = used
        .filter((match) => match[1] === prefix)
        .reduce((max, match) => Math.max(max, Number(match[2])), 0);
    return `${prefix}-${String(highest + 1).padStart(3, '0')}`;
}
/**
 * Where the fixture has to live: the literal directory in front of the first
 * wildcard, plus the scope's own extension. A fixture outside this path is never
 * scanned, which is the failure mode people hit when they place it by hand.
 */
export function fixtureRelativePath(rawScope, id) {
    const scope = rawScope.replace(/^\.\//, '');
    const wildcard = scope.search(/[*?[{]/);
    if (wildcard === -1)
        return scope.replace(/^\/+/, '');
    const literal = scope.slice(0, wildcard);
    const directory = literal.endsWith('/') ? literal.slice(0, -1) : dirname(literal);
    // Prefer the extension the scope names (`features/**/*.feature`), then the
    // one on a literal suffix (`playwright.config.ts`), then TypeScript.
    const extension = /\*\.([a-z0-9]{1,8})(?![a-z0-9])/i.exec(scope)?.[1] ??
        /\.([a-z0-9]{1,8})$/.exec(scope)?.[1] ??
        // `features/**` names no extension, and a .ts file there is never run.
        (/\bfeatures\b/.test(directory) ? 'feature' : 'ts');
    const file = `${id.toLowerCase()}.${extension}`;
    return directory && directory !== '.' ? `${directory}/${file}` : file;
}
/** `#` for features and markdown, `//` for code. Keep the fixture valid in its language. */
function commentFor(path) {
    return /\.(feature|md|ya?ml|sh|py|rb)$/.test(path) ? '#' : '//';
}
/**
 * People write `--scope test-pages/` when they mean "everything under it". A
 * literal path with no wildcard would scope the rule to one file that does not
 * exist yet, so a trailing slash or an existing directory becomes a subtree.
 */
export function normaliseScope(entry) {
    const trimmed = entry.replace(/^\.\//, '').replace(/\/+$/, '');
    if (!trimmed)
        throw new ScaffoldError('--scope cannot be the repository root; name a directory');
    const wildcard = /[*?[{]/.test(trimmed);
    const looksLikeFile = /\.[a-z0-9]{1,8}$/i.test(trimmed);
    if (wildcard || looksLikeFile)
        return trimmed;
    return `${trimmed}/**`;
}
/**
 * A scope that matches nothing today is usually a typo (`test-page/`), and the
 * proof cannot catch it: the fixture is placed to match the same wrong scope, so
 * it fires while the rule never sees a real file. Count what is really there and
 * say so.
 */
function filesInScope(cwd, scope, fixtureRoot) {
    const matchers = scope.map(globToRegex);
    const root = resolve(cwd);
    const skipFixture = resolve(cwd, fixtureRoot);
    let count = 0;
    for (const file of walk(root)) {
        if (file.startsWith(skipFixture))
            continue;
        const rel = relPosix(root, file);
        if (matchers.some((matcher) => matcher.test(rel)))
            count++;
    }
    return count;
}
export function scaffoldRule(options) {
    const title = options.title.trim();
    if (!title)
        throw new ScaffoldError('--rule needs the rule in one sentence');
    if (options.scope.length === 0) {
        throw new ScaffoldError('--scope is required: the rule needs a place it can fire, and the fixture is placed to match it. Try: --scope "test-pages/"');
    }
    const rulesPath = resolve(options.cwd, options.rulesPath);
    const { ruleSet, created } = readRuleSet(rulesPath);
    const id = nextId(ruleSet.rules, options.id);
    // Running `new` twice with the same sentence is a duplicate, not a second rule.
    const sameSentence = ruleSet.rules.find((rule) => rule.rule.trim().toLowerCase() === title.toLowerCase());
    if (sameSentence) {
        throw new ScaffoldError(`${sameSentence.id} already says that: "${sameSentence.rule}". Edit it with --id ${sameSentence.id}, or write a different rule.`);
    }
    const scope = options.scope.map(normaliseScope);
    const positiveRels = scope.map((entry) => fixtureRelativePath(entry, id));
    const negativeRels = positiveRels.map((rel) => rel);
    const fixtureRoot = resolve(options.cwd, options.fixtureRoot);
    const positivePaths = positiveRels.map((rel) => join(fixtureRoot, 'positive', rel));
    const negativePaths = negativeRels.map((rel) => join(fixtureRoot, 'negative', rel));
    for (const target of [...positivePaths, ...negativePaths]) {
        if (existsSync(target))
            throw new ScaffoldError(`${relPosix(options.cwd, target)} already exists - refusing to overwrite it`);
    }
    const rule = {
        id,
        rule: title,
        context: `Files matching ${scope.join(', ')}. TODO: name the objects or helpers this applies to.`,
        origin: {
            commit: null,
            pr: null,
            summary: 'TODO: what broke, and what it cost. Keep the detail that makes the rule defensible.',
        },
        severity: options.severity ?? 'med',
        detection_pattern: 'TODO: what a reviewer should look for, in concrete syntax.',
        match: { pathInclude: scope, linePatterns: [] },
        recommendation: 'TODO: the fix that worked, specific enough to paste.',
    };
    ruleSet.rules.push(rule);
    mkdirSync(dirname(rulesPath), { recursive: true });
    writeFileSync(rulesPath, `${JSON.stringify(ruleSet, null, 2)}\n`, 'utf8');
    positivePaths.forEach((positivePath, index) => {
        const negativePath = negativePaths[index];
        const marker = commentFor(positiveRels[index]);
        mkdirSync(dirname(positivePath), { recursive: true });
        mkdirSync(dirname(negativePath), { recursive: true });
        writeFileSync(positivePath, `${marker} ${id} positive fixture: the bad line goes here.\n${marker} The rule must fire on it. Delete these comments once it does.\n`, 'utf8');
        writeFileSync(negativePath, `${marker} ${id} clean fixture: the same code with the fix applied.\n${marker} The rule must fire zero times here. Delete these comments once it stays silent.\n`, 'utf8');
    });
    const inScope = filesInScope(options.cwd, scope, options.fixtureRoot);
    const shownRules = relPosix(options.cwd, rulesPath);
    const shownPositive = relPosix(options.cwd, positivePaths[0]);
    const shownNegative = relPosix(options.cwd, negativePaths[0]);
    const scopeHint = scope.join(', ');
    return {
        id,
        rulesPath: shownRules,
        positivePath: shownPositive,
        negativePath: shownNegative,
        otherFixtures: positivePaths
            .slice(1)
            .flatMap((positivePath, index) => [
            relPosix(options.cwd, positivePath),
            relPosix(options.cwd, negativePaths[index + 1]),
        ]),
        createdRuleFile: created,
        nextSteps: [
            `open ${shownRules}, replace the TODOs, and put the pattern in match.linePatterns`,
            `not sure of the pattern? prompts/turn-incident-into-rule.md (in the package) drafts it from the incident`,
            `paste the bad line into ${shownPositive}`,
            `paste the same code with the fix into ${shownNegative}`,
            `prove just this rule: sfqa-scar prove --id ${id}`,
            `it is scoped to ${scopeHint}; a fixture outside that path is never scanned`,
            ...(inScope === 0
                ? [
                    `warning: nothing in this repo matches ${scopeHint} yet. If that is a typo, the rule will never fire - delete it with --id ${id} and start again`,
                ]
                : []),
        ],
    };
}
export function formatScaffold(result) {
    const lines = [];
    lines.push(`created ${result.id}${result.createdRuleFile ? ` (new rule file)` : ''}`);
    lines.push('');
    lines.push(`  rule      ${result.rulesPath}`);
    lines.push(`  positive  ${result.positivePath}`);
    lines.push(`  clean     ${result.negativePath}`);
    for (const other of result.otherFixtures)
        lines.push(`  also      ${other}`);
    lines.push('');
    lines.push('what to do next');
    result.nextSteps.forEach((step, index) => lines.push(`  ${index + 1}. ${step}`));
    return lines.join('\n');
}
