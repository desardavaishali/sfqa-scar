# Extract your own scar tissue

A reusable prompt for any capable LLM agent that can read your repository's git
history. It produces a rule set compatible with `@sfqa/scar`.

Run it once per repository, review the output (every rule should cite a commit
you can verify), keep the JSON next to your code, and re-run it after every
postmortem or hotfix so the rule set grows with the team.

---

PROMPT (copy everything below this line):

You are mining a git repository for "scar tissue": hard-won rules derived from
real past failures - bugs, flaky tests, reverts, hotfixes, leaked secrets, data
corruption incidents.

1. Explore history exhaustively:
   - `git log --oneline --all`, then read every commit whose message contains
     fix, revert, hotfix, flaky, race, timeout, workaround, credentials,
     rollback.
   - For each candidate, read the diff (`git show <hash>`) and any linked PR
     description, ADR or postmortem doc.
2. Extract only lessons with DIRECT evidence in a specific commit or incident
   doc. Do not invent generic best practices; if you cannot cite a hash, drop
   the lesson.
3. For each lesson emit ONE JSON object with exactly these keys:

   - `"id"`: stable slug matching `^[A-Z]+-\d+$`, e.g. `"ST-013"`.
   - `"rule"`: one-line guardrail (what future automation must or must not do).
   - `"context"`: which objects, flows, files or classes it applies to.
   - `"origin"`: `{ "commit": "<hash>", "pr": "<id or null>",
     "summary": "1-2 sentences on what went wrong and the cost" }`.
   - `"severity"`: `"high" | "med" | "low"` - how bad is violating it today
     (data corruption / leaked secrets / wrong records = high;
     flaky-but-recovers = med; cosmetic = low).
   - `"detection_pattern"`: what a reviewer should look for in new code to
     catch a repeat - be concrete about syntax, not vibes.
   - `"match"`: the machine-executable detector:
     {
       "pathInclude": ["glob", ...],        // optional scope gate
       "pathExclude": ["glob", ...],        // optional
       "fileNameRules": [{ "pattern": "regex" }],        // optional
       "linePatterns": ["regex", ...],      // per-line (use [\s\S] to span lines)
       "numericRules": [{ "pattern": "regex-with-(group)", "min": n, "max": m, "flags": "gm" }],
       "labelRules": [{ "canonical": ["Exact Label", ...] }], // exact-label drift
       "fileRequiredSignals": ["regex", ...], // fire if NONE present
       "fileExemptSignals": ["regex", ...],   // suppress the file if ANY present
       "fileExemptLines": ["regex", ...]      // suppress a single line if ANY present
     }
     Regexes are JavaScript RegExp source. A leading `(?i)` means
     case-insensitive. Prefer few high-precision patterns over many noisy ones;
     use `pathInclude` to scope rules to where the failure class lives.
   - `"recommendation"`: a concrete fix, ideally describing how the origin
     commit solved it.

4. Output: a single JSON document
   `{ "version": 1, "generated_from_repo": "<name>", "rules": [ ... ] }`.
5. Self-check before finishing:
   - Every rule's origin commit exists (`git cat-file -e <hash>^{commit}`).
   - Each regex compiles against JavaScript `RegExp`.
   - No regex or prose contains a real secret, customer value, person's name or
     client-specific label. Labels belong in `labelRules.canonical`, not in a
     hardcoded "known-bad" blocklist.
   - Every `labelRules.canonical` list contains the org's exact rendered labels.
   - At least one rule is a documented gap if you cannot write a detector; do
     not invent one that can never fire.
   - Rules that scope paths use globs the scanner supports (`**`, `*`, `?`).

---

## Reviewing the output

- Run the packaged proof harness shape against your own rule set: a fixture per
  executable rule must make it fire, and a clean fixture set must produce zero
  findings. If a rule has a detector it cannot fire, the proof failed.
- Delete any rule whose origin you cannot defend. A rule set is a claim about
  your history, not a style guide.
- Re-run extraction after a major incident. Rules that stop mattering should be
  removed, not left as noise.
