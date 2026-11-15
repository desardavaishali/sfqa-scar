# @sfqa/scar validation report

Purpose: decide whether the reviewer is safe to publish. "Validated" should mean
a claim you can defend, not a demo that looked good once. This report is
reproducible from the repo.

Run from the repository root:

```bash
npm run check          # typecheck, tests, build, package gate, then the proof
npm run validate:scar  # just the proof
# or: node scar-validation/run.mjs
```

`npm run validate:scar` and `scar-validation/run.mjs` are one line of glue over
`sfqa-scar prove`. The proof itself is in the package, so a consumer can prove
the rules they write without cloning this repository.

## Method

- A **positive fixture set** recreates the path layout each rule scopes itself
  to (`test-lib/setup/env.ts`, `test-constants/*.ts`, `test-pages/**`,
  `features/**`, `playwright.config.ts`) and contains one known-bad construct
  per executable rule.
- A **negative fixture set** is the same layout with the correct construct. It
  must produce zero findings.
- The proof reads fixtures in place; findings in a gitignored path are downgraded
  to `low` and marked, so a fixture under an ignored directory still counts as
  firing (the detector matched) but never as a `high` failure.
- A `linePatterns` entry is matched against its line plus the next three lines,
  and reported only when the match starts on that line. A guard written
  underneath the call therefore counts, without the scanner parsing JavaScript.
- It runs the **built package CLI** against the **packaged rule set**
  (`packages/scar/rules/generic.json`), so the proof covers what ships, using the
  code path a consumer gets from `npm install`.
- A rule with a detector must fire on positive; a rule with no detector is
  reported as a **gap**, never counted as passing.
- A run in which **no rule fires at all** fails, even if it has no missing
  fixtures and no false positives. `0/0` is not a proof.

## Result

```
sfqa-scar prove - 19 rule(s), 18 executable
rule set: packages/scar/rules/generic.json
fixtures: scar-validation/fixtures

rule    severity  detector   positive   clean
ST-001  high      yes        fires      clean
ST-002  high      yes        fires      clean
ST-003  high      yes        fires      clean
ST-004  high      yes        fires      clean
ST-005  med       yes        fires      clean
ST-006  med       yes        fires      clean
ST-007  med       yes        fires      clean
ST-008  high      yes        fires      clean
ST-009  high      yes        fires      clean
ST-010  med       yes        fires      clean
ST-011  high      yes        fires      clean
ST-012  med       yes        fires      clean
ST-013  med       yes        fires      clean
ST-014  high      yes        fires      clean
ST-015  med       yes        fires      clean
ST-016  low       yes        fires      clean
ST-017  med       yes        fires      clean
ST-018  low       NO         n/a        n/a
ST-019  med       yes        fires      clean

GAPS (no machine detector, cannot fire): ST-018
  These rules are documentation until a detector is added.
  ST-018 is scoped to: local-notes-*.md, *.zip, test-results/**, untitled folder/**

PROOF: 18/18 executable rules fire on a positive fixture and stay silent on the clean set.
Coverage: 18/19 rules enforced today; 1 rule(s) have no detector.
```

### What "proof" means here

1. Every executable rule fires on a construct it claims to catch.
2. The clean set produces **zero false positives**.
3. The result is deterministic and runs offline in under a second.
4. Coverage is explicit: 18/19 enforced, 1 gap. No hand-waving.

## The defect the proof found

The first validation run failed, and not because of a fixture.

**ST-002 had a detector that could never fire.** Its pattern is written to span
lines (`sit2:` then up to 600 chars then `process.env.SIT_...`), but the scanner
evaluated every `linePatterns` entry against one line at a time. A cross-line
regex can never match a single line, so the rule was decorative: present in the
report, never able to flag anything.

Fix: patterns containing `[\s\S]` or `\n` are now scanned against the whole file
and each match is mapped back to its line. Single-line patterns keep the fast
per-line path. ST-002 now fires on the positive fixture, and ST-014 - which also
uses `[\s\S]` - matches across lines instead of only within one.

This is the strongest argument for publishing the tool at all: it can be
proven, and the proof can catch it lying.

## Template versus org-specific rule set

The shipped rule set is a **template**, not the internal rule set it grew from.
The detectors are the same families, but three values that used to encode one
org's vocabulary are now explicit inputs:

| Input | Shipped example |
|---|---|
| canonical picklist labels (`labelRules`) | `Web`, `Event`, `Referral`, `Phone`, `Email`, `SMS` |
| inventory-code shape (ST-008) | `SKU-A12-0042` |
| timeout ceiling (ST-009) | `< 360000` ms |
| local-only paths (ST-018, gap) | `local-notes-*.md`, `*.zip` |

The original internal rule set was run once against the source repository
(fixtures excluded) and produced 150 findings, 37 of them `high`. Most of those
`high`s were the detectors misreading code, and finding that out is the more
useful result:

| Shape | Count | What the detector saw | Now |
|---|---|---|---|
| `.isVisible({ timeout })` then `.catch(() => false)` on the next line | 20 | an unguarded assertion | silent - a guarded probe |
| `'Email': 'email'`, `cond ? 'email' : 'name'` | 6 | label drift | silent - a value, not a label |
| `map.get('password')` | 1 | a hardcoded secret | silent - a lookup |
| a literal password as a `process.env` fallback in a tracked file | 3 | a hardcoded secret | still `high`, and correctly so |
| unit inventory quoted in feature tables | 5 | org data in a test | demoted in the local set only |

Each misread became a **detector fix plus a regression test**, never a severity
demotion in the template - a rule that fires on clean code is a rule people turn
off. Re-run on the same tree: 113 findings across 44 files, 11 `high`. The local
rule set for the source repository demotes the two categories that were accepted
until later (ST-008 inventory, ST-014 shared account name) to `low` with the
reason written into the rule `context`, which leaves 4 `high`: the three real
credential fallbacks and one probe guarded by `try`/`catch` instead of `.catch`.

Those counts are evidence that the detectors find real debt, not a promised
result for another org. Quote the method, not the number.

## Limits 

- The fixtures are synthetic. They prove the detector works on a minimal
  construct, not that it catches every real-world variant.
- Regex rules are heuristics. They trade recall for explainability and CI speed.
  A finding is a prompt to look, not a verdict.
- ST-018 (`local-only artifacts gitignored from birth`) has no detector today.
  It is documentation until someone adds a path rule and a regression fixture.
- Label drift needs the org's canonical labels. Without that input, ST-003 can
  only catch the examples the rule set declares.
- The real-repo counts will move as debt is paid. Quote the method, not the
  number, or update the number with the date.

## Verdict

**Safe to publish as a v0.x tool, with the gap and limits stated.** The claim to
make is precise: "18 of 19 rules are machine-enforced, each proven to fire and
proven silent on clean code; the 19th (ST-018) is documentation." That is a
stronger claim than most linters make.
