# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] - 2026-11-15

### Security
- Scan output no longer prints secret values. Lines that carry a credential-shaped name (password, secret, token, api key and similar) are shown with the value replaced by `<redacted>`, in text, markdown and JSON output. Detection is unchanged; only what is displayed changed. Before this release the matched line was printed as written, so a finding could put a credential into a CI log.

### Changed
- License changed from MIT to Apache-2.0 (adds an explicit patent grant). Versions 0.1.0 and 0.1.1 remain available under MIT. A `NOTICE` file now ships in the package.
- The README links to the blog post.

## [0.1.1] - 2026-11-15

### Changed
- ST-004 wording now says what Playwright does: the `timeout` option on `isVisible()` is ignored and the call returns instantly (it previously said the method takes no options).
- The shipped ST-008 example identifier shape and the fixtures that use it are now a neutral `SKU-A12-0042` shape instead of an organisation-specific one; replace it with your own.
- Page-object names in the ST-013 example pattern are generic (`OrderPage`, `ItemPage`).

## [0.1.0] - 2026-11-14

### Added
- Dependency-free CLI (`sfqa-scar`) for Node >= 20: `scan`, `new`, `prove`, and `harvest`.
- Template rule set (`rules/generic.json`): 19 rules mined from real postmortems - 18 with machine detectors, proven to fire on a bad fixture and stay silent on a clean one; 1 documented gap (ST-018).
- Rule scaffolding: `sfqa-scar new` writes a rule entry and positive/negative fixtures in the paths the rule scans; rules start as a tracked gap until a detector is supplied.
- Proof harness: `sfqa-scar prove` verifies each rule both ways and fails on gaps/false positives (the same command consumers run on their own rules).
- Harvest: surfaces incident-shaped commits and local report artifacts no existing rule claims yet, with draft detectors and a review/capture/ignore flow.
- Extraction prompts: `prompts/extract-rules.md` and `prompts/turn-incident-into-rule.md`.
- Output formats: terminal text, `--json`, and `--markdown` (relative paths, safe to paste).
- Proof report and fixture set under `scar-validation/` (`npm run validate:scar`).

### Notes
- The shipped rules are a worked example/template; mine your own history to build a rule set that describes your repository.
- The public proof runs on synthetic fixtures, not a field trial. Quote the method, not a number, for your own repo.