# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).
In `0.x.y` releases breaking changes are allowed.

## [0.1.1] - 2026-05-28

### Changed

- `design-process` SKILL.md polish: step 7 explicitly enumerates trigger-mechanism options (manual / hook-driven / hybrid); step 11 documents the history-write timing (after user approval); new `## Multi-skill design sessions` subsection acknowledging that one invocation can produce multiple sibling skills (the task-tracking session as worked example); "New agent role required" failure mode mentions the parallel "new dept charter" case.
- `task-register` SKILL.md polish: `--json url,number --jq '.url'` for explicit URL capture (stable across `gh` versions); new `quiet_label_creation` input (optional bool, default false) consolidates per-label warnings into a single summary line; "When to use" section notes that inputs may be gathered conversationally over multiple AskUserQuestion turns. PROCESS.md adds `label_warnings_consolidated_if_quiet` to success_criteria.
- `task-update` SKILL.md: step 9 (body-status-line patch) now includes a concrete shell pipeline using Python regex via `os.environ` for parametrization. The Python helper exits non-zero on regex no-match, short-circuiting the pipeline. `sed`/`perl` listed as alternatives.
- `task-complete` SKILL.md: step 9 (final-comment render) wraps the missing-Refs warning block in a `<details>` when there are 5 or more commits; step 11 documents that the `status:done` color comes from `.claude/task-tracking.config.json`'s `_label_palette`.
- `.claude/task-tracking.config.json`: new optional `_label_palette` key documenting label colors (`task`, `status:done`, and a 6-entry `dept_cycle` array). Additive — STARTER file, won't break v0.1.0 consumers on update.

### Fixed

- `MAINTAINER.md` CHANGELOG-extraction awk snippet: previous pattern `awk '/^## \[X.Y.Z\]/,/^## \[/' | sed '$d'` produced empty output when X.Y.Z was the only entry in the file. New pattern uses an explicit `p` flag with three stop conditions, also excluding the bottom-of-file `[X.Y.Z]:` link-reference lines.

### Notes

- Closes [#4](https://github.com/Koroqe/OPOS/issues/4) — "Harden v0.1.0 — close known gaps (v0.1.1 patch release)".
- 13 `proposed_delta` items from v0.1.0 history addressed; 5 deferred to v0.2.0 (`consult-agent`, `release-from-changelog`, `task-pause`, plus two validation-runs that need real-world test data).
- Self-bootstrap idempotency was confirmed during v0.1.0's release — still holds for v0.1.1 (verified by Slice 6 of this work).
- No breaking changes. v0.1.0 consumers can `copier update` cleanly.

## [0.1.0] - 2026-05-25

### Added

- Core framework skeleton: root `CLAUDE.md`, `RISKS.md`, `README.md`, 7 templates in `shared/templates/`.
- 4 company-level agents: `ceo`, `coo`, `chief-of-staff`, `ops-manager`.
- 6 framework skills: `design-process`, `task-register`, `task-update`, `task-complete`, `check-for-updates`, `sync-from-core`.
- 2 starter departments: `engineering` (with `deploy` skill), `rnd`.
- **Copier-based distribution**: `copier.yml` with `_templates_suffix: ".jinja"` (the default — only `.jinja`-suffixed files are processed), `_exclude` (runtime state), `_skip_if_exists` (starter content), and a single `COMPANY_NAME` question. The 5 files needing variable substitution (`CLAUDE.md`, `README.md`, `RISKS.md`, `company/CLAUDE.md`, `departments/*/CLAUDE.md`) are stored as `*.jinja` source files; Copier strips the suffix on render.
- **Agent-driven auto-update**: `check-for-updates` skill invoked as step 1 of `task-register`/`task-update`/`task-complete`; cached 6h; silent unless an update exists.
- **Opt-in GitHub Actions auto-update workflow**: `.github/workflows/sync-opos.yml`, `workflow_dispatch` only by default; uncomment `schedule:` block to enable weekly background PRs.
- `CHANGELOG.md` (this file) and semantic-versioning policy.
- `MAINTAINER.md` framework-developer guide.

### Notes

- Initial public release.
- `0.x.y` releases may contain breaking changes per semver. Each breaking-change release will include a `### Migration` subsection in its CHANGELOG entry.
- Future breaking changes after v1.0 will bump the major version.

[0.1.1]: https://github.com/Koroqe/OPOS/releases/tag/v0.1.1
[0.1.0]: https://github.com/Koroqe/OPOS/releases/tag/v0.1.0
