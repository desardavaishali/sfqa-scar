# Contributing to sfqa-scar

Thanks for looking. The project has one rule above the others: **a rule that
fires on clean code gets turned off, and then it protects nothing.** Most of what
follows is that rule applied.

## Set up

Node 20 or newer.

```bash
git clone https://github.com/desardavaishali/sfqa-scar.git
cd sfqa-scar
npm ci
npm run check   # typecheck, tests, build, package gate, then the proof
```

`npm run check` is the same sequence CI runs. It must be green before you open a
pull request.

`packages/scar/dist/` is committed so a clone runs without a build. If you change
anything in `packages/scar/src/`, run `npm run build` and commit the result; CI
fails when `dist/` is out of date.

## Adding or changing a rule

1. Describe the incident, not the regex: what broke, and what the fix was.
2. Scaffold it: `npx sfqa-scar new --rule "..." --scope "..."`.
3. Fill in a detector, a **positive** fixture (the bad construct) and a
   **negative** fixture (the fixed construct).
4. Run `npx sfqa-scar prove --id <ID>`. It must report `fires` and `clean`.
5. A rule that cites a real commit beats one that does not. A rule with no
   detector is a documented gap, never coverage.

Fixing a false positive means changing the **detector** and adding a regression
test. Do not lower a rule's severity in the shipped template to make noise go
away. Severity calls belong in a project's own `scar-tissue.json`, with the
reason in `context`.

## Ground rules for fixtures and examples

- Use synthetic code. Never paste code, names, hostnames, ticket numbers or
  credentials from a real client or employer repository, even "sanitised" ones.
- Keep the engine dependency-free and offline. No network calls, no telemetry.

## Pull requests

- Keep them small and say which rule or behaviour changed and why.
- New behaviour needs a test. Detector changes need a fixture.
- Add a line to `CHANGELOG.md` under an `Unreleased` heading.

By contributing you agree that your contribution is licensed under the MIT
licence in this repository.
