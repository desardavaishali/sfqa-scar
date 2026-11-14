// packages/scar/src/report.ts
// -----------------------------------------------------------------------------
// Reporting. Every finding is explainable: the rule that fired, the matching
// line, the class of incident that produced the rule, and a concrete fix.
//
// Three formats, one source of truth: text for a human, JSON for CI or a PR
// comment, Markdown for a pull request or a write-up. None drops a finding, and
// none prints an absolute path except the text format - a screenshot or a pasted
// block should never carry someone's home directory.
// -----------------------------------------------------------------------------
export const SEVERITY_ORDER = { high: 3, med: 2, low: 1 };
export function summarise(findings) {
    const counts = { high: 0, med: 0, low: 0 };
    for (const finding of findings)
        counts[finding.rule.severity]++;
    return counts;
}
export function buildReport(ruleSet, filesScanned, findings) {
    return {
        tool: 'sfqa-scar',
        ruleSet,
        filesScanned,
        summary: summarise(findings),
        findings: [...findings],
    };
}
export function shouldFail(findings, failOn = 'high') {
    const threshold = failOn === 'any' ? 'low' : failOn;
    return findings.some((finding) => SEVERITY_ORDER[finding.rule.severity] >= SEVERITY_ORDER[threshold]);
}
function originText(finding) {
    const origin = finding.rule.origin;
    const reference = origin.commit
        ? `${origin.commit}${origin.pr ? ` (${origin.pr})` : ''}`
        : (origin.pr ?? 'incident');
    return `${reference}\n           ${origin.summary}`;
}
export function formatText(report, cwd) {
    const lines = [];
    lines.push(`sfqa-scar - ${report.filesScanned} file(s) reviewed`);
    lines.push(`rule set: ${report.ruleSet}`);
    const ordered = orderedFindings(report);
    for (const finding of ordered) {
        const rule = finding.rule;
        lines.push('');
        lines.push(`[${rule.severity.toUpperCase()}] ${rule.id} - ${rule.rule}`);
        if (rule.severity_note)
            lines.push(`note: ${rule.severity_note}`);
        lines.push(`  where  : ${cwd}/${finding.relPath}${finding.line ? `:${finding.line}` : ''}`);
        lines.push(`  matched: ${finding.snippet}${finding.meta ? `\n           (${finding.meta})` : ''}`);
        lines.push(`  context: ${rule.context}`);
        lines.push(`  origin : ${originText(finding)}`);
        lines.push(`  do this: ${rule.recommendation}`);
    }
    const { high, med, low } = report.summary;
    lines.push('');
    lines.push(`summary: ${report.findings.length} finding(s) - ${high} high, ${med} med, ${low} low across ${report.filesScanned} file(s)`);
    return lines.join('\n');
}
export function formatJson(report) {
    return JSON.stringify({
        tool: report.tool,
        ruleSet: report.ruleSet,
        filesScanned: report.filesScanned,
        summary: report.summary,
        findings: report.findings.map((finding) => ({
            id: finding.rule.id,
            severity: finding.rule.severity,
            rule: finding.rule.rule,
            file: finding.relPath,
            line: finding.line || null,
            matched: finding.snippet,
            detail: finding.meta ?? null,
            originCommit: finding.rule.origin.commit ?? null,
            why: finding.rule.origin.summary,
            recommendation: finding.rule.recommendation,
        })),
    }, null, 2);
}
/** Order findings worst-first, then by path and line. Shared by the formatters. */
function orderedFindings(report) {
    return [...report.findings].sort((a, b) => SEVERITY_ORDER[b.rule.severity] - SEVERITY_ORDER[a.rule.severity] ||
        a.relPath.localeCompare(b.relPath) ||
        a.line - b.line);
}
/**
 * One table cell has to stay one line: newlines would end the row, and an
 * unescaped pipe would split it into a new column.
 */
function cell(text, limit = 120) {
    const flat = text.replace(/\s+/g, ' ').replace(/\|/g, '\\|').trim();
    return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}
/**
 * Markdown for a pull-request comment or a write-up. Paths are relative to the
 * directory the scan ran in, so the output can be pasted or screenshotted
 * without leaking a home directory. The table is the scan; the fix list is what
 * a reader acts on.
 */
export function formatMarkdown(report) {
    const lines = [];
    const { high, med, low } = report.summary;
    const ordered = orderedFindings(report);
    lines.push('## sfqa-scar');
    lines.push('');
    if (ordered.length === 0) {
        lines.push(`**Clean** - 0 findings across ${report.filesScanned} file(s), at every severity.`);
        return lines.join('\n');
    }
    lines.push(`**${ordered.length} finding(s)** across ${report.filesScanned} file(s) - ${high} high, ${med} med, ${low} low.`);
    lines.push('');
    lines.push('| Rule | Severity | Where | Matched |');
    lines.push('| --- | --- | --- | --- |');
    for (const finding of ordered) {
        const where = `${finding.relPath}${finding.line ? `:${finding.line}` : ''}`;
        const matched = finding.meta ? `${finding.snippet} (${finding.meta})` : finding.snippet;
        lines.push(`| ${finding.rule.id} | ${finding.rule.severity} | \`${cell(where, 80)}\` | \`${cell(matched)}\` |`);
    }
    const seen = new Set();
    const fixes = ordered.filter((finding) => {
        if (seen.has(finding.rule.id))
            return false;
        seen.add(finding.rule.id);
        return true;
    });
    if (fixes.length > 0) {
        lines.push('');
        lines.push('### Fixes');
        for (const finding of fixes) {
            lines.push('');
            lines.push(`**${finding.rule.id}** - ${cell(finding.rule.rule, 400)}`);
            lines.push('');
            lines.push(`> ${finding.rule.recommendation.replace(/\s+/g, ' ').trim()}`);
        }
    }
    return lines.join('\n');
}
