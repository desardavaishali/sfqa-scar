# Security policy

## Reporting a vulnerability

Please do not open a public issue for a security problem.

Report it privately through GitHub: **Security tab → Report a vulnerability** on
this repository. If that is not available to you, email
vaishali@vaishalidesarda.com with "sfqa-scar security" in the subject.

Include what you ran, what you expected and what happened. A minimal rule file or
fixture that reproduces it is the fastest route to a fix. You will get a reply
within a week. This is a single-maintainer project, so please allow time for a
fix before disclosing publicly.

## What is in scope

`sfqa-scar` is an offline scanner: it reads local files, optionally calls `git`,
and makes no network requests. The issues that matter most here are:

- a rule or input that makes the scanner hang or exhaust memory (for example a
  pathological regular expression),
- the `new`, `harvest --write` or `capture` commands writing outside the
  directory they are meant to write to,
- scan, harvest or report output that exposes a secret it should have redacted,
- anything that makes the CLI execute input it should only read.

## Supported versions

Only the latest published `0.x` release receives fixes.

## A note for everyone filing issues

Findings quote the matched line of your code. If a finding contains a real
credential, redact it before pasting it into an issue, a pull request or a
discussion.
