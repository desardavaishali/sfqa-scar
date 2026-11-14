# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project aims to follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-05

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