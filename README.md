# sfqa-scar

Your test suite already knows what went wrong. This turns those failures into
rules a reviewer can run on every commit.

A rule is one past incident: the line not to repeat, the commit that proved it,
how bad recurrence would be, and a pattern a machine can match. A finding is that
scar firing again - with the origin and the fix that already worked once. No
model at review time. Same input, same findings, every time.

```bash
npm install -D @sfqa/scar
npx sfqa-scar .
```

```text
[HIGH] ST-004 - Never pass a timeout to isVisible() - the option is ignored and the call returns instantly.
  where  : test-pages/web/LeadPage.ts:212
  matched: const visible = await label.isVisible({ timeout: 5000 });
  origin : a field reader reported a Lightning label as empty while it was still rendering
  do this: await locator.waitFor({ state: 'visible', timeout: N }).then(() => true).catch(() => false)
```

Exit `0` when nothing at or above `--fail-on` matches, `1` otherwise. That is the
whole integration story: put it in a hook or a CI job.

## Two files, two jobs

- **`packages/scar/rules/generic.json`** (packaged template, the default) - 19
  worked-example rules, shipped with the tool. A plain scan uses this when the
  repo has no local rule file.
- **`scar-tissue.json`** (your repo root) - your rules and your calls. Created by
  `sfqa-scar new …` or by copying the template to adopt and tune it; picked up
  automatically.

```bash
# adopt the template so you can tune it (optional)
cp node_modules/@sfqa/scar/rules/generic.json ./scar-tissue.json
```

A scan never writes rules. When you choose to live with a finding, demote it in
*your* `scar-tissue.json` with the reason in `context` - never in the template.

## Add a rule (a prompt, not a regex)

Describe the incident; the tool writes the scaffolding and *proves* the rule:

```bash
npx sfqa-scar new \
  --rule "Never pass a timeout to isVisible() - it is ignored" \
  --scope "test-pages/**"

# puts a rule entry in scar-tissue.json, plus:
#   scar-fixtures/positive/test-pages/st-020.ts   must fire
#   scar-fixtures/negative/test-pages/st-020.ts   must stay silent

npx sfqa-scar prove --id ST-020   # fires | clean, or the scope you missed
```

The rule starts with an empty detector (a gap, not enforced) until a fixture
makes it fire. Not sure of the pattern? `prompts/turn-incident-into-rule.md`
ships in the package - hand it the incident and an assistant drafts the detector
and both fixtures; `prove` is what you trust, not the draft.

## Find the rules you never wrote

```bash
npx sfqa-scar harvest
```

Reads incident-shaped commits and local report artifacts, proposes a draft for
every incident no rule claims yet, and hands the list back to you. Then
`packages/scar/prompts/extract-rules.md` helps turn history into defensible rules
(refuse anything that cannot cite a commit).

## Why this, and not a linter or an AI reviewer

- **Not a linter:** linters know style; a scar cites the incident and the fix that
  already worked once.
- **Not an AI reviewer:** review is deterministic, offline, no keys - same input,
  same findings. AI’s only job here is drafting (harvest/prompts), under your
  review.
- **Proved, not believed:** every executable rule fires on a bad fixture and stays
  silent on a clean one. A rule with no detector is a gap, never coverage.

## The proof (and the honesty)

`npm run validate:scar` runs the same `sfqa-scar prove` a consumer runs. 18 of 19
shipped rules are enforced and proven both ways; ST-018 is a documented gap. The
harness once caught a rule whose cross-line detector could never fire - and a real
run on the source repo showed 37 highs where ~8 were real, because the detectors
were misreading clean code. Each misread became a detector fix + a regression test
(not a lower severity); re-run: 113 findings, 11 highs. Read the breakdown in
[`scar-validation/REPORT.md`](scar-validation/REPORT.md).

## What is in here

```
packages/scar/        the package: scanner, rule format, CLI, harvest, prompts
  src/  dist/         TypeScript source and built output (committed - a clone runs)
  rules/generic.json  the template rule set (19 rules)
  prompts/            extraction prompts for turning history into rules
  README.md           the long version: format, detectors, harvest loop, every choice
scar-validation/      the proof: fixtures + REPORT.md (a thin wrapper over `prove`)
.github/workflows/    the gate this repo is held to
```

## Use it from a clone or in CI

```bash
node packages/scar/dist/cli.js --rules packages/scar/rules/generic.json .
npx sfqa-scar --base origin/main --fail-on high   # review only what changed
npx sfqa-scar --markdown --fail-on high .         # PR comment (relative paths)
npm run check                                      # typecheck, tests, build, verify, proof
```

Three output formats: text, `--json`, and `--markdown` (relative paths, safe to
paste). For CI, start advisory (publish the report, don’t fail the build) and
promote to a gate when the noise is gone - GitHub Actions and Azure DevOps
examples are in [`packages/scar/README.md`](packages/scar/README.md#run-it-on-every-commit).

## Scope

- The rule set is a template. It is not a claim that these are your nineteen
  problems - mine it from your history.
- The public proof runs on synthetic fixtures, not a field trial.
- A text-file engine: no Salesforce API, no browser, no network. Runs over
  Playwright, Cypress, Selenium, API tests, or plain application code.

## Licence

MIT. See [`packages/scar/README.md`](packages/scar/README.md) for the full
reference.