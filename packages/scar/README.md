# @sfqa/scar

Your test suite already knows what went wrong. This turns those failures into
rules a reviewer can run.

A rule is one past incident: the line not to repeat, how bad recurrence would be,
and a pattern a machine can match. A finding is that scar firing again - with the
origin and the fix that already worked once. No model at review time. Same input,
same findings, every time.

```bash
npm install -D @sfqa/scar
npx sfqa-scar .                 # scan with the shipped template (or your scar-tissue.json)
```

```text
[HIGH] ST-004 - Never pass a timeout to isVisible() - the option is ignored and the call returns instantly. Use waitFor({ state: 'visible', timeout }) when render timing matters.
  where  : test-pages/web/LeadPage.ts:212
  matched: const visible = await label.isVisible({ timeout: 5000 });
  context: All Playwright page objects (test-pages/web/**), field readers and verification helpers reading Lightning labels.
  origin : incident
           A field reader called isVisible({ timeout: 5000 }); Playwright ignores options there and returns immediately, so a Lightning label still rendering read as absent and the value was silently reported as empty.
  do this: Replace with `await locator.waitFor({ state: 'visible', timeout: N }).then(() => true).catch(() => false)` - a visible wait that cannot silently report a stale DOM.
```

Exit `0` when nothing at or above `--fail-on` matches, `1` otherwise. Put it in a
hook or a CI job and it runs without anyone remembering.

## Two files, two jobs

| File | What it is | When it appears |
| --- | --- | --- |
| `packages/scar/rules/generic.json` (packaged) | The **template** - 19 worked-example rules shipped with the tool. Used automatically when a repo has no local rule file. | Ships with the package. |
| `scar-tissue.json` (in your repo root) | **Your** rule set - the rules you wrote, tuned, or accepted-until-later. Picked up automatically, no `--rules` flag. | Created the first time you run `sfqa-scar new …`, or by copying the template to adopt and tune it. |

Plain scan never writes a rule file. Copying the template is how you take
ownership of the rules (and demote an accepted finding with a reason, instead of
turning it off):

```bash
cp node_modules/@sfqa/scar/rules/generic.json ./scar-tissue.json   # adopt + tune (optional)
npx sfqa-scar .                                                     # reads scar-tissue.json automatically
```

## Why this, and not a linter or an AI reviewer

- **A linter** knows syntax and style. It does not know that `isVisible({timeout})`
  silently lied to you in March. A scar rule cites the incident and the fix.
- **An AI reviewer** is non-deterministic and forgets. This is plain matching over
  local files - no network, no keys - so the same input gives the same findings
  every time, which is the only way a merge gate earns the right to fail a build.
- **AI has one, bounded job:** drafting. `harvest` surfaces candidates from
  history, and the shipped prompts (`prompts/extract-rules.md`,
  `prompts/turn-incident-into-rule.md`) help turn an incident into a rule. The
  result is still just data you review and commit.
- **Every rule is proved, not believed.** A fixture must make it fire and a clean
  fixture must keep it silent (`sfqa-scar prove`). A rule with no detector is
  reported as a gap, never counted as coverage. The proof caught a rule in this
  very set whose detector could never fire - and, on a real run, caught the
  detectors themselves misreading clean code (see [Proof and honesty](#proof-and-honesty)).

## Adding a rule is a prompt, not a regex

Most rules tools ask you to write a detector. This one asks you to describe the
incident, because the incident is the part you already know:

> "In March a field reader called `isVisible({ timeout: 5000 })`. Playwright
> ignores options there and returns immediately, so a label that was still
> rendering read as absent and the test passed with an empty field. Never pass
> options to `isVisible()`."

That paragraph is the whole job. It becomes a rule like this:

```bash
npx sfqa-scar new --rule "Never pass a timeout to isVisible() - it is ignored" --scope "test-pages/**"
```

which writes three files: the rule entry, one fixture that must match, and one
that must not. You fill in the sentence and one line of pattern; `sfqa-scar
prove` tells you whether the rule fires where it should and stays silent where
it should not. If you have no idea what the pattern should be, hand the
paragraph to an assistant with
[`prompts/turn-incident-into-rule.md`](prompts/turn-incident-into-rule.md) - it
asks for exactly the rule, the detector and the two fixtures, and refuses to
accept a rule that cites no incident.

There is a full worked example, from incident to committed rule, in
[Add a rule after an incident](#add-a-rule-after-an-incident). The rest of this
README is detail you can read when you need it.

## Why this exists

A Salesforce suite accumulates scar tissue: the toast that vanishes on the
slower sandbox, the `isVisible` call that ignores its own timeout, the picklist
label that drifted one capital letter, the credential that reached git history.
Each one cost a day. Each one is written down in a retro and then forgotten.

`@sfqa/scar` keeps them as data. The rule set is JSON; the detectors are
declarative; the scanner is dependency-free Node. A new team member can read
the history without reading the commit log.

## Not just Salesforce

The scanner is a text-file engine: scoped globs, regex detectors, no Salesforce
API and no browser. It will run over Cypress, Selenium, Appium, API tests, or
plain application code.

The shipped rules are the part that is Salesforce/Playwright-shaped, because that
is the history they were mined from. A rule like `.isVisible({` is inert in a
Cypress repo. That is not a limitation of the engine; it is the point. Regenerate
the rule set from your own history with `prompts/extract-rules.md`, and the same
binary reviews your stack. The 19 rules are a worked example of the format, not a
universal pack.

## What it does not do

- It does not learn on its own. A new incident becomes a rule only when you add
  one, or re-run extraction. The runtime is deterministic.
- It does not read live runs or server-side logs. It reads source files, diffs,
  and the local report artifacts you point at with `--report`.
- It cannot name the offending source line from a runtime failure. A failing test
  gives you the test, the file and the error - that is a brief, not a draft. Turning
  a brief into a rule is the step that needs a person (or a model working for one).
- It does not run itself. Wire it into a pre-commit hook, a commit-msg hook, or a
  CI job; then it runs without anyone remembering.

## Run it on every commit

Three places, all short.

**Pre-commit** (husky v9):

```bash
npm install -D husky
npx husky init
echo "npx sfqa-scar --staged --fail-on high" > .husky/pre-commit
```

Older husky: `npx husky add .husky/pre-commit "npx sfqa-scar --staged --fail-on high"`.

**Commit-msg** (optional, for incident capture):

```bash
echo 'npx sfqa-scar harvest --staged --message-file "$1" --ask' > .husky/commit-msg
```

This one asks a single question when the commit message looks like a fix, and
records a "no" so it is not asked again. See
[Ask at commit time](#ask-at-commit-time-remember-the-no).

**CI** (GitHub Actions):

```yaml
name: scar
on: [pull_request]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0          # --base needs the history
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npx sfqa-scar --base origin/${{ github.base_ref }} --fail-on high
```

**CI** (Azure DevOps, advisory - reports, never gates the build):

```yaml
- job: ScarReview
  displayName: 'Scar Tissue Review (advisory)'
  steps:
    - task: NodeTool@0
      inputs: { versionSpec: '20.x' }
    - script: |
        out=scar-review.md
        npx --yes @sfqa/scar --markdown --fail-on high . > "$out" || true
        cat "$out"
        echo "##vso[task.complete result=SucceededWithIssues;]Scar review written (advisory)."
      continueOnError: true
    - task: PublishBuildArtifacts@1
      inputs: { PathtoPublish: 'scar-review.md', ArtifactName: 'scar-review' }
      condition: always()
```

To make it a gate, drop `|| true` and `continueOnError` and let the exit code
fail the job. Advisory is a good first step: the findings are real, but you
decide when a red build is earned.

That is the whole "automatic" story. No daemon, no network, no API key. Findings mask secret-shaped values (shown as `<redacted>`), so the output is safe to paste into a CI log or a pull request. Once
those hooks exist, nobody has to remember to run it.

## Day one: the hook does not add rules

The pre-commit hook and the CI job are **enforcement**. They apply rules that
already exist. They never write one.

The commit-msg hook is adjacent: it never blocks either. It only asks whether a
fix-shaped change still owes a rule, and a "no" records itself.

That is deliberate. A scanner that invented a rule from a failed commit would be
guessing about intent, and a rule you cannot defend from history is a style
opinion. Writing the rule is the one step that needs a person - or a model
working for one - who knows what actually broke.

So on day one the rule file comes from one of three places:

1. **Copy the template.** Use this if your stack is close to Salesforce +
   Playwright. If you just want to evaluate the shipped set, skip the copy
   entirely: the packaged `rules/generic.json` is the default.
2. **Extract from history.** One pass with
   [`prompts/extract-rules.md`](prompts/extract-rules.md) before you wire the
   hook. This is the right start for any other stack.
3. **An empty rule file.** Valid, and it enforces nothing. The hook runs, finds
   zero findings, exits 0. Honest, but useless.

The order that actually works:

```bash
# 1. seed a rule file you own (skip if you want the packaged default)
cp node_modules/@sfqa/scar/rules/generic.json ./scar-tissue.json

# 2. see what it says before it can fail a commit
npx sfqa-scar .

# 3. wire it in once you trust the output (see "Run it on every commit")
npx husky init
echo "npx sfqa-scar --staged --fail-on high" > .husky/pre-commit
```

A `scar-tissue.json` in the working directory is picked up automatically, so no
`--rules` flag is needed. Pass `--rules` only to point somewhere else.

After that, the loop is:

```text
a test fails for a real reason
      -> the postmortem names the bad line
      -> one rule + two fixtures (prompts/turn-incident-into-rule.md)
      -> commit the rule
      -> the hook enforces it on every future commit
```

The hook did not add the rule. **The incident did.** The postmortem is the
teacher; the hook is the memory. If a team installs the hook with an empty rule
file and never runs the retro step, it will correctly do nothing forever - and
that is the boundary of the product, not a bug in it.

## The standing loop

Adoption is one loop, and it repeats:

1. **A failure happens.** Someone fixes it, or a test fails for a real reason and
   the retro names the bad line.
2. **A rule appears.** Hand-written, or harvested from history and drafted.
3. **The rule gets proved.** Positive fixture fires, clean fixture stays quiet.
4. **The rule gets committed.** With the incident, in the same commit.
5. **The hook enforces.** Pre-commit and CI, on every commit after that.
6. **Harvest keeps watch.** Weekly sweep for unclaimed incidents; CI goes red if
   any remain.

Nothing in this loop depends on anyone remembering to do anything. The only
remembering left is the one decision the tool cannot make for you: whether a
draft is worth turning into a rule. Everything else is wired.

## Find the rules you never wrote

The gap in every "write a rule after an incident" workflow is the incident
nobody wrote a rule for. `harvest` closes that gap from three sources:

| Source | What it shows | Command |
|---|---|---|
| Git history | fix-shaped commits no rule accounts for | `harvest` |
| The staged change | the incident you are committing right now | `harvest --staged --message ...` |
| Local test reports | failures you are living with, repeated across runs | `harvest --report test-results/` |

```bash
npx sfqa-scar harvest                     # last 300 commits
npx sfqa-scar harvest --since 2026-01-01  # a date range
npx sfqa-scar harvest --all               # also show incidents a rule covers
npx sfqa-scar harvest --write scar-candidates.json --json
npx sfqa-scar harvest --strict            # exit 1 if any incident has no rule

npx sfqa-scar harvest --staged --message "fix: replace the fixed sleep"
npx sfqa-scar harvest --report test-results/ --report-format auto
```

What it does:

- reads commits whose message says fix, revert, hotfix, flaky, race, timeout,
  workaround, credential, secret, rollback, regression, bug, defect or patch;
- ignores an incident already claimed by a rule's `origin.commit`, or whose
  removed lines match an existing detector;
- for each unclaimed incident, shows the commit, the removed bad line, the added
  fix, a proposed `pathInclude`, a proposed `linePatterns` regex, and a
  confidence;
- writes nothing. You review the draft, then add it.

```text
CANDIDATE 1/1
  commit : 402ef2d  2026-11-09
  subject: fix: replace fixed sleep with an element wait
  files  : tests/orders.ts
  removed: await page.waitForTimeout(2000);
  added  : await locator.waitFor({ state: 'visible', timeout: 5000 });
  detect : page\.waitForTimeout\(  [confidence high]
  scope  : tests/**
  id     : commit:402ef2d9c1...
```

From there it is the loop from the previous section: prove the draft with a
positive fixture and a clean fixture, then commit. `--strict` in CI turns "we
forgot to write a rule for last month's hotfix" into a red build, which is the
only way the gap becomes visible. Run the history pass on a schedule, not on every
push, so the gate stays fast:

```yaml
name: scar-harvest
on:
  schedule:
    - cron: '0 6 * * 1'   # Mondays
  workflow_dispatch:

jobs:
  gaps:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - run: npm ci
      - run: npx sfqa-scar harvest --since 2026-01-01 --strict
```

## Ask at commit time, remember the no

The best moment to capture an incident is while the person still remembers it:
the commit that fixes it. A `commit-msg` hook has the staged diff *and* the
message, so it can ask a single question and then get out of the way.

```bash
# .husky/pre-commit - fast, no prompts, no writes
npx sfqa-scar --staged --fail-on high

# .husky/commit-msg - one question, only when the message looks like an incident
npx sfqa-scar harvest --staged --message-file "$1" --ask
```

Why two hooks instead of one:

- **Pre-commit scans.** It only reads the staged files and the existing rules.
  No `git log` walk, no network, no prompt. It stays fast enough to run on every
  commit.
- **Commit-msg harvests.** Git has no commit message until this hook, so
  message-based incident detection cannot happen earlier. It uses the staged
  diff plus `COMMIT_EDITMSG`, asks once, and exits `0` either way - a `commit-msg`
  hook must not block a commit because someone declined to write a rule.

When the message matches the incident keywords, `--ask` shows the candidate and
offers three answers:

```text
capture a draft for staged "fix: replace the fixed sleep with an element wait"? [y]es / [i]gnore / [s]kip:
```

| Answer | What happens | Next run |
|---|---|---|
| `y` | the draft is saved to `scar-tissue.candidates.json` | **not asked again**; still shown as `captured: yes`, because no rule exists yet |
| `i` | the decision is written to `scar-tissue.ignore.json` | **not asked again**; listed with `--all` |
| `s` | nothing is written | asked again next time |

So a "yes" is not a vibe. It is a queued draft with the incident, the scope and
the proposed detector, waiting for someone to move it into the rule set. A "no"
is a recorded decision. Both are files you can review in a PR.

```json
// scar-tissue.candidates.json - yes
{
  "version": 1,
  "candidates": [
    {
      "fingerprint": "staged:9f2c...",
      "capturedAt": "2026-11-09T09:12:00.000Z",
      "subject": "fix: replace the fixed sleep with an element wait",
      "files": ["tests/orders.ts"],
      "draft": { "id": "ST-020", "match": { "linePatterns": ["page\\.waitForTimeout\\("] } }
    }
  ]
}
```

```json
// scar-tissue.ignore.json - no
{
  "version": 1,
  "ignored": [
    {
      "fingerprint": "staged:9f2c...",
      "reason": "the fix is already covered by the code review",
      "at": "2026-11-09T09:12:00.000Z",
      "subject": "fix: replace the fixed sleep with an element wait"
    }
  ]
}
```

That means you can audit a decision, diff it in a PR, and reverse it by deleting
the entry. `--ignore <id>` and `--capture <id>` record the same decisions
non-interactively, which is useful from a CI job or when someone dismisses a
candidate they saw in a report. `--all` brings dismissed candidates back, with
`ignoredAt` and `ignoreReason`.

A captured candidate disappears on its own once a rule covers it: the coverage
check runs first, so adding the rule with the right `origin.commit` or detector
closes the loop without hand-editing the queue.

`--ask` only prompts for `--staged`. History is reviewed in bulk with `--write`;
a hundred interactive questions about last year's commits is not a workflow.

## Local test runs are the third source

A test report shows the failures a team is currently living with. Point
`--report` at a file or a directory and harvest the two formats runners emit
most: Playwright JSON and JUnit XML. Format is sniffed from the file unless you
pass `--report-format playwright|junit`.

```bash
npx playwright test --reporter=json
npx sfqa-scar harvest --report test-results/ --json --write local-failures.json
```

The same failure across several runs is merged and counted, because repetition
is the signal:

```text
LOCAL FAILURE 1/1
  test   : orders.spec.ts > creates an order > creates an order
  file   : tests/orders.spec.ts
  status : failed  [4 occurrence(s)]
  error  : Error: expect(locator).toBeVisible() failed
           Locator: getByText('Order created')
  next   : find the source line behind this failure, then write one rule with two fixtures
  id     : test:3a91...
```

These are **briefs, not drafts**. A runtime error tells you that something
broke; it does not tell you which source line caused it, so the tool will not
invent a regex for it. The brief gives you the test, the file, the error and a
stable id, which is exactly the input the
[incident-to-rule prompt](prompts/turn-incident-into-rule.md) expects. Local
failures are also filtered by the same ignore ledger, so `--ignore <id>` works
on them too.

Two limits, stated plainly:

- History and staged mode read a **diff**. A failure that was never fixed and
  never staged is invisible there; the local-report source is how you see it.
- The proposed regex is a **draft**. A low-confidence draft deliberately has no
  detector; the tool will not guess a pattern it cannot defend.

Credential-shaped lines are redacted before they reach stdout, the JSON or a
draft. The harvester will not write the secret it found into a rule file.

## The rule set is a template, not a product

The shipped set (`rules/generic.json`) has 19 rules. Their **detectors** are
generic. Where a detector needs to know a value, the value list is an example
that you replace:

| Detector input | Shipped example | Replace with |
|---|---|---|
| `labelRules.canonical` | `Web`, `Event`, `Referral`, `Phone`, `Email`, `SMS` | the exact labels your org renders |
| inventory-code shape | `SKU-A12-0042` | the identifier shape your product uses |
| local-only file patterns | `local-notes-*.md`, `*.zip` | the paths your team keeps local |
| timeout ceiling | `< 360000` ms | your measured longest journey, minus headroom |

That is deliberate. A generic rule set that pretended to know your org would be
worse than no rule set. Extract once from your own history, keep the examples
only as documentation.

## Where the rules come from

Three sources, in increasing order of value:

1. **The shipped template.** Eighteen rules mined from one team's
   Salesforce/Playwright history. Treat it as a worked example of the format,
   and as a usable starting point only if your stack is close to that one.
2. **History harvest.** Run `npx sfqa-scar harvest` first. It reads your git
   log, finds fix-shaped commits that no rule covers, and prints a draft rule for
   each one. Deterministic, no LLM. For lessons that need judgement across a
   whole diff, the deeper pass is
   [`prompts/extract-rules.md`](prompts/extract-rules.md): it reads `git log`,
   opens commits whose messages say fix, revert, hotfix, flaky, race, timeout,
   workaround or credentials, and emits rules that cite a commit hash. A lesson
   without a hash is dropped.
3. **One rule per incident.** This is the loop that keeps the rule set alive.
   After a postmortem, write one rule before the memory fades. Ten minutes, and
   it is the only ongoing maintenance the tool needs.

So how do you know which rules to add? You do not pick them from a catalogue.
You take them from incidents that already cost you a day. If you cannot name the
bad line and the day it burned you, it is a lint opinion, not scar tissue. That
is the whole selection criterion.

`harvest` exists because that criterion still requires someone to remember the
incident. The tool reads the history for you and puts the unclaimed ones on
screen. You still approve each rule; you no longer have to notice the gap
yourself.

## Add a rule after an incident

One worked example, end to end, using a failure every automation suite has seen:
a test that waited on a fixed sleep instead of the element, passed locally, and
failed in CI when the environment was slower.

**1. Start from the incident, not from the regex.** Write the sentence a reviewer
would need, then let the tool scaffold the rest. Seed a rule file you own first,
so the 19 shipped rules stay and your new one becomes ST-020:

```bash
cp node_modules/@sfqa/scar/rules/generic.json scar-tissue.json

npx sfqa-scar new \
  --rule "Never wait on a fixed sleep for a UI element; poll the element with a real timeout." \
  --scope "tests/" \
  --severity med
```

```text
created ST-020

  rule      scar-tissue.json
  positive  scar-fixtures/positive/tests/st-020.ts
  clean     scar-fixtures/negative/tests/st-020.ts

what to do next
  1. open scar-tissue.json, replace the TODOs, and put the pattern in match.linePatterns
  2. not sure of the pattern? prompts/turn-incident-into-rule.md (in the package) drafts it from the incident
  3. paste the bad line into scar-fixtures/positive/tests/st-020.ts
  4. paste the same code with the fix into scar-fixtures/negative/tests/st-020.ts
  5. prove just this rule: sfqa-scar prove --id ST-020
  6. it is scoped to tests/**; a fixture outside that path is never scanned
```

`--scope` takes a plain directory (`tests/` means everything under it) or a glob
(`tests/**/*.ts`). Repeat it if the rule belongs in more than one place; a
fixture pair is written for each.

Three files exist, the id is free, and the fixtures are already in a path the
rule scans - which is the mistake people make when they place them by hand. The
rule starts with an empty detector on purpose, so nothing can claim it is
enforced before it is.

**2. Fill in the two TODOs.** The scaffold gives you the shape; the incident
gives you the words:

```json
{
  "id": "ST-020",
  "rule": "Never wait on a fixed sleep for a UI element; poll the element with a real timeout.",
  "context": "Playwright page objects and helpers under tests/**",
  "origin": {
    "commit": "9f2c41d",
    "summary": "waitForTimeout(2000) passed locally and failed in CI on a slower environment; a fixed sleep is a bet on machine speed."
  },
  "severity": "med",
  "detection_pattern": "page.waitForTimeout(...) used to wait for UI state",
  "match": {
    "pathInclude": ["tests/**"],
    "pathExclude": ["**/node_modules/**"],
    "linePatterns": ["\\.waitForTimeout\\(\\s*\\d+\\s*\\)"]
  },
  "recommendation": "Replace with await locator.waitFor({ state: 'visible', timeout: N })."
}
```

**3. Prove it both ways.** Put the bad line in the positive fixture, the same
code with the fix in the clean one, then ask for a verdict on one rule:

```bash
npx sfqa-scar prove --id ST-020
```

```text
sfqa-scar prove - 1 rule(s), 1 executable
rule set: scar-tissue.json
fixtures: scar-fixtures

rule    severity  detector   positive   clean
------  --------  ---------  ---------  -------
ST-020  med       yes        fires      clean

PROOF: 1/1 executable rules fire on a positive fixture and stay silent on the clean set.
Coverage: 1/1 rules enforced today; 0 rule(s) have no detector.
```

Read it as a sentence:

- `fires` - the bad line was found. If this says `missing`, the detector is wrong
  or the fixture is outside the rule's scope; the message prints that scope.
- `clean` - the fixed line was not found. If this says `leak`, the pattern is too
  broad and would fail good code.
- `detector: NO` - the rule is prose. `prove` reports it as a gap and exits 1 if
  nothing else fires, because a rule that cannot fire is a comment with a
  version number.

**4. Scan for real.**

```bash
npx sfqa-scar --fail-on med tests/
```

If the rule set fails to load, the error names the rule and the field; detectors
are validated before any file is read.

**5. Commit the rule, the fixtures, and the incident summary together.** The
commit message is the postmortem. Reviewers can see what changed and why, and
the next person inherits the lesson without reading the incident channel.

That is the loop: incident, retro, one rule, two fixtures, commit. It runs once
per incident, not once per commit.

### If you do not want the scaffold

The format is plain JSON and nothing depends on `new`. Append the object above
to the `rules` array in `scar-tissue.json` by hand, put the two fixtures wherever
your rule's `pathInclude` points, and run `sfqa-scar prove`. The scaffold only
removes the two mechanical decisions - which id is free, and where the fixture
belongs.

[`prompts/turn-incident-into-rule.md`](prompts/turn-incident-into-rule.md) is a
fill-in-the-blanks prompt for step 1 if you want an assistant to draft the rule
from an incident write-up.

## Choosing a starter set

The engine does not change between stacks; the rule set does. What survives
depends on what your repo actually contains:

| Your repo | Start with | Then extract your own |
|---|---|---|
| Salesforce + Playwright | Most of the shipped set (ST-001 to ST-017, ST-019). Re-check `labelRules.canonical` against your org first. | Auth and session reuse, record navigation, picklist drift, toast races |
| Playwright, non-Salesforce | ST-004, ST-009, ST-017, ST-018. Drop every `labelRules` and record/Lightning rule. | Waits, fixture reuse, your real timeout ceiling, selector drift |
| Cypress, Selenium or Appium | ST-009, ST-017, ST-018 only. `.isVisible({` is inert here. | Framework-specific waits, session reuse, selector strategy |
| API or integration tests | ST-001, ST-002, ST-007, ST-008, ST-018. Nothing DOM-shaped survives. | Retry and idempotency, environment config bleed, hardcoded fixture ids |
| Application code | ST-001, ST-002, ST-018. The engine handles it; the rules must too. | Error swallowing, silent fallbacks, config precedence |

The pattern behind the table: keep the rules that describe **process and safety**
(secrets, config bleed, hardcoded mutable ids, fixed sleeps, duplicated helpers),
drop the rules that name **another team's product** (Lightning, lead conversion,
Salesforce picklists). Then grow the set from your own incidents, one at a time.

What not to do: copy all 19 into a Cypress repo and treat a silent scan as
passing. A rule that can never fire is coverage theatre. If a rule is inert in
your stack, delete it rather than leave it in the file.

## The 19 rules

| ID | Severity | Rule |
|---|---|---|
| ST-001 | high | Never hardcode credentials, tokens or secrets in code, config fallbacks or committed `.env` files. |
| ST-002 | high | Each environment config reads its own environment's variables, never a sibling's. |
| ST-003 | high | Picklist values match the Salesforce label exactly: case, spaces, hyphens. |
| ST-004 | high | `isVisible()` ignores any `timeout`; use `waitFor({ state: 'visible' })`. |
| ST-005 | med | Never treat a success toast as the only success signal. |
| ST-006 | med | Record navigation tolerates Lightning URL variants; no single strict `waitForURL`. |
| ST-007 | med | Server-side integration fields need periodic reload, not just a deadline poll. |
| ST-008 | high | Never hardcode mutable inventory, accounts or orders; use a sentinel. |
| ST-009 | high | Timeout must exceed the measured journey, or retries write duplicate records. |
| ST-010 | med | Keep teardown out of the reporter-finalization window; no broad `pkill`. |
| ST-011 | high | Auth goes through the shared login flow; no hardcoded standard-login selectors. |
| ST-012 | med | Human-in-the-loop logins need race tolerance: adopt an existing session. |
| ST-013 | med | After impersonation or a tab switch, rebuild page objects on the active page. |
| ST-014 | high | Lead conversion has two outcomes; branch on duplicate detection and read identity from the record. |
| ST-015 | med | Field-dependency maps and picklist constants need live-org provenance. |
| ST-016 | low | Correlated generated fields must be co-constrained. |
| ST-017 | med | Search for an existing helper before adding a duplicate. |
| ST-018 | low | Local-only artifacts are gitignored from birth. *(no detector yet)* |
| ST-019 | med | Read a record header from a scoped container, never a bare comma-list that mixes a container with a value element plus `.first()`. |

18 of 19 have a machine detector and are proven both ways: a fixture makes each
one fire, and a clean fixture set makes none of them fire. ST-018 is reported as
a gap rather than counted as coverage. The source repo keeps the fixture set the packaged rules are proven against in
`scar-validation/`, and runs it in CI with the same `prove` command a consumer
uses on their own rules. The fixtures are not shipped in the tarball, because
they only make sense next to a rule set you are editing - `sfqa-scar new` creates
the first pair for you.

## Rule format

```json
{
  "id": "ST-004",
  "rule": "Never pass options to isVisible() ...",
  "context": "All Playwright page objects ...",
  "origin": { "commit": null, "summary": "what went wrong, as a class of incident" },
  "severity": "high",
  "detection_pattern": ".isVisible({ ... }) - any argument passed to isVisible, unless the call is .catch()-guarded.",
  "match": {
    "pathInclude": ["**/*.ts"],
    "pathExclude": ["**/node_modules/**"],
    "linePatterns": ["\\.isVisible\\(\\s*\\{[^{}]{0,200}?\\}\\)(?!\\s*\\.catch)"],
    "fileExemptSignals": ["Promise\\.race"]
  },
  "recommendation": "Replace with waitFor({ state: 'visible', timeout: N })."
}
```

Detectors available in `match`:

| Key | Fires when |
|---|---|
| `linePatterns` | a non-comment line matches (a pattern containing `[\s\S]` may span lines) |
| `numericRules` | capture group 1 falls inside `[min, max]`, e.g. a too-short timeout |
| `fileNameRules` | the file's base name matches, e.g. a tracked `.env` |
| `labelRules` | a quoted literal is a near-miss of a canonical label (case, spacing, hyphen) |
| `fileRequiredSignals` | **none** of the signals exist in a file that is in scope |

A `linePatterns` entry sees the line plus the next three lines, and the finding
is reported only when the match *starts* on that line. That is how a guard
written underneath -

```ts
const there = await label.isVisible({ timeout: 5000 })
  .catch(() => false);
```

- is read as a deliberate probe rather than a silent assertion. The template's
  ST-004 expresses exactly that with a trailing `(?!\s*\.catch)`.

Two exemption scopes exist on purpose:

- `fileExemptSignals` clears the whole file when a mitigation is present
  (a `Promise.race` guarding a toast wait).
- `fileExemptLines` clears one line (an empty `process.env` fallback) while a
  sibling hardcoded literal in the same file still fires.

## Extracting your own rule set

The shipped set is a starting point. To mine your own history, give a capable
model the prompt in
[`prompts/extract-rules.md`](prompts/extract-rules.md). It asks for a commit
reference per rule, JavaScript regexes, exact canonical labels, and a documented
gap instead of an invented detector. Review the output; a rule you cannot defend
from history is a style opinion, not scar tissue.

After that first pass, do not re-run extraction for every small bug. Use
[`prompts/turn-incident-into-rule.md`](prompts/turn-incident-into-rule.md) to
turn one incident into one rule plus its two fixtures, and save the bulk
extraction for a quarterly cleanup or a new repository.

## Usage

```bash
# scan paths
npx sfqa-scar test-pages/ features/

# review only what changed
npx sfqa-scar --base origin/main
npx sfqa-scar --staged

# machine-readable, for CI or a PR comment
npx sfqa-scar --json --fail-on med .

# markdown, for a PR comment or a write-up (relative paths, one row per finding)
npx sfqa-scar --markdown --fail-on med .

# start a rule: writes the rule and both fixtures at a path the rule scans
npx sfqa-scar new --rule "Never pass options to isVisible()" --scope "test-pages/**"

# prove every rule against its fixtures (exit 1 if one does not)
npx sfqa-scar prove
npx sfqa-scar prove --id ST-020          # one rule, the one you just wrote

# a different rule set - one in the working directory is used automatically
npx sfqa-scar --rules ../shared/scar-tissue.json src/

# find incidents that never became rules
npx sfqa-scar harvest --since 2026-01-01
npx sfqa-scar harvest --write scar-candidates.json --json
npx sfqa-scar harvest --staged --message "fix: replace the fixed sleep" --ask
npx sfqa-scar harvest --report test-results/ --report-format auto
npx sfqa-scar harvest --all                # include dismissed candidates

# dismiss one candidate, permanently, in committed data
npx sfqa-scar harvest --ignore staged:9f2c...

# keep one candidate as a queued draft
npx sfqa-scar harvest --capture staged:9f2c...
```

Exit codes: `0` clean at the threshold, `1` at least one finding at or above
`--fail-on` (default `high`), `2` bad usage or an invalid rule set.

`harvest` is advisory: it exits `0` even when it finds an unclaimed incident.
Add `--strict` to make a gap exit `1`, for a CI job that refuses to let last
month's hotfix go unrecorded.

Findings inside gitignored files are downgraded to `low` and marked
`[gitignored - informational]`. A properly ignored `.env` is not a leak; a
tracked one is.

## Design rules

- **The rule set is data.** Regenerate it, version it, review it in a PR. No
  detector logic hides in the scanner.
- **Nothing is silently dropped.** A rule with no detector is listed as a gap.
  A finding in an ignored file is shown, not hidden.
- **Fail at load, not at scan.** Every regex compiles and every rule is
  validated (unique id, known severity, required prose) before a file is read.
- **Comments are not recurrences.** A comment that mentions a bad pattern is a
  warning to the reader, not a hit.
- **Discovery never writes rules.** `harvest` proposes; a person approves. The
  scanner has no side effects. The only file harvest writes is the ignore
  ledger, and only when a person says "do not ask again".
- **A decision is data.** `scar-tissue.candidates.json` (captured) and
  `scar-tissue.ignore.json` (dismissed) are reviewed and committed like code,
  so a decision can be audited and reversed.
- **No org vocabulary in the package.** The shipped rule set is client-free.

## Tune, do not turn off

A finding you choose to live with is still information. Demote it in **your**
`scar-tissue.json`, not in the template: set its `severity` to `low` and record
the reason in `context` (for example, "accepted until test-data setup exists").
The scan keeps reporting it, the history stays honest, and you can reverse it the
day the reason stops being true. A rule lowered in the template protects nobody.

## Proof and honesty

The build fails on proof, not just on tests. `npm run validate:scar` (the same
`sfqa-scar prove` a consumer runs on their own rules) proves every executable rule
fires on a positive fixture and stays silent on a clean set; a rule with no
detector is reported as a gap, never counted as coverage. The first run of that
harness caught a rule whose cross-line detector could never fire - it sat in the
report looking thorough and could flag nothing. The fix and a regression fixture
landed before anything shipped.

Fixtures prove a detector *can* fire. They do not prove it fires on the right
thing, so the set was run against the repository it was mined from. 150 findings,
37 `high` - and about eight were real. The rest were the detectors misreading
code (a guarded `.isVisible(...).catch(...)` probe read as a silent assertion, a
field-map value read as label drift, a `map.get("password")` read as a secret).
Each misread became a **detector fix plus a regression test**, never a lower
severity in the template. Re-run: 113 findings, 11 `high`. A tool that opens with
false alarms gets switched off in a week; the point is to be wrong in a way you
can read, fix, and prove.

Read the numbers as method, not a promise: `scar-validation/REPORT.md` records the
breakdown, and [the blog post](https://www.vaishalidesarda.com/blog/so-i-made-our-postmortems-run-in-ci/) tells the story of the three catches (the scar that
spread, the rule that could never fire, the detectors that were the problem).

## Status

`0.1.1`. Dependency-free, Node >= 20, TypeScript types included. 18 of 19 rules
have a machine detector and are proven both ways; the 19th is a documented gap.
The public proof runs on synthetic fixtures, not a field trial. Apache-2.0 licensed.
