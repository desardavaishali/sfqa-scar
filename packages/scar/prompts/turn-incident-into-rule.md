# Turn one incident into one rule

A fill-in-the-blanks prompt for writing a single `@sfqa/scar` rule from an
incident that already happened. Use this after a postmortem or a hotfix, when the
details are still fresh. If `sfqa-scar harvest` already produced a candidate,
paste that candidate as the incident block. For a bulk pass over your whole
history, use [`extract-rules.md`](extract-rules.md) instead.

The output is one JSON rule, plus a positive fixture and a clean fixture, so the
rule is proven before it merges.

---

PROMPT (copy everything below this line, then fill in the incident block):

You are turning one real incident into one executable review rule for
`@sfqa/scar`. You are not writing a style guide. If the incident block does not
contain enough evidence for a detector, stop and say what is missing.

Incident block:

- What broke:
- When (date or sprint, commit or PR if known):
- The bad line or shape that caused it:
- The fix that worked:
- How much it cost (time, duplicate records, leaked secret, false green):
- Which files, folders or frameworks it applies to:

Produce exactly three things.

1. One rule object with exactly these keys:

   - `"id"`: your next free `ST-###` id.
   - `"rule"`: one imperative sentence. What future code must or must not do.
   - `"context"`: the objects, files or helpers this applies to, in plain words.
   - `"origin"`: `{ "commit": "<hash or null>", "summary": "<1-2 sentences on
     what went wrong and what it cost>" }`. Never invent a hash. If you do not
     have one, use `null` and say the incident is a postmortem rather than a
     commit.
   - `"severity"`: `"high"` for data loss, leaked secrets, wrong records or false
     green; `"med"` for flaky but recoverable; `"low"` for readability.
   - `"detection_pattern"`: what a human reviewer should look for, in concrete
     syntax.
   - `"match"`: a detector using only these keys -
     `pathInclude`, `pathExclude`, `fileNameRules`, `linePatterns`,
     `numericRules`, `labelRules`, `fileRequiredSignals`, `fileExemptSignals`,
     `fileExemptLines`. Regexes are JavaScript `RegExp` source. Scope the rule
     with `pathInclude` so it cannot fire outside where the failure class lives.
     Prefer one precise pattern over several loose ones.
   - `"recommendation"`: the fix that worked, concrete enough to paste.

2. A positive fixture: a minimal file, in the scoped path, containing the bad
   line. The rule must fire on it exactly once.

3. A clean fixture: a minimal file using the recommended fix. The rule must fire
   zero times.

Then self-check and report each answer:

- Does every regex compile as a JavaScript `RegExp`?
- Does the positive fixture fire, and only once?
- Does the clean fixture stay silent?
- Is the rule scoped narrowly enough that unrelated files cannot trip it?
- Does the rule describe a repeat of *this* incident, rather than a generic best
  practice you happen to like?
- Is any real secret, customer value, person's name or client label present? If
  yes, remove it. Labels belong in `labelRules.canonical`, never in a
  hardcoded bad-value list.

If the positive fixture cannot be made to fire, say so and mark the rule a
documented gap. A rule that can never fire is coverage theatre, and shipping one
is worse than shipping none.

---

## After the prompt

- Add the rule to `scar-tissue.json`, then run the two scans the README shows.
- Commit the rule, both fixtures and the incident summary in one commit.
- If the rule turns out noisy in the first week, tighten the regex or narrow
  `pathInclude` before you delete it. A false positive teaches you where the
  failure class actually lives.
