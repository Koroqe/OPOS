# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).
In `0.x.y` releases breaking changes are allowed.

## [0.2.0] - 2026-05-28

### Added

- `consult-agent` skill (owner: `chief-of-staff`) — consult another agent by spawning its definition as a subagent via the Task tool; canonicalizes the eng-lead/rnd-lead simulation pattern previously hand-crafted in `design-process` step 4 and the R&D framework survey.
- `release-from-changelog` skill (owner: `chief-of-staff`) — cut a GitHub release from a CHANGELOG.md version entry; extracts notes via the canonical awk pattern from MAINTAINER.md and handles the inverted-exit-code `gh release view` check correctly.
- `task-pause` + `task-resume` skills (owner: `chief-of-staff`) — multi-task support. `task-pause` moves the active task from `.claude/.current-task` to a new `.claude/.paused-tasks` list (gitignored); `task-resume <issue>` brings it back. Closes the manual-override pattern that fired 4× across prior releases.
- `shared/templates/TASK.md.tmpl` — first-class task abstraction (research recommendation #1 from the R&D framework survey, CrewAI pattern). Frontmatter: issue_number, title, owner, depts, state, created, completed, success_criteria, deadline, related_skills. Body: Goal, Acceptance criteria, Progress log, Final outcome.
- `tasks/` folder convention — `task-register` creates `tasks/<issue-number>.md` on each invocation; `task-complete` moves it to `tasks/closed/<issue-number>.md`. The framework dogfoods its own task tracking against `Koroqe/OPOS#5` and beyond; consumer scaffolds get an empty `tasks/.gitkeep` (per-task files are excluded from the Copier template via `tasks/[0-9]*.md` + `tasks/closed/**` patterns).
- Optional `state_schema:` frontmatter in `shared/templates/PROCESS.md.tmpl` + optional `## State transitions` body section (research recommendation #2, LangGraph pattern). Documentation-only in v0.2.0; no runtime enforcement.
- `company/knowledge-base/claude-code-mapping.md` — explains OPOS-as-convention-layer ↔ Claude-Code-as-runtime-layer stack (research recommendation #3). 7-row file mapping table; "what OPOS does NOT replace" + "what Claude Code does NOT provide" sections to nail the positioning.

### Changed

- `design-process` SKILL.md step 4 — invokes `consult-agent --agent <dept-lead> --question "..."` instead of hand-crafting a Task call. Reduces boilerplate; concentrates the simulation pattern in one skill.
- `design-process/PROCESS.md` — retrofitted with `state_schema:` (6 named states: `discovering → consulting → drafting → presenting → iterating → committing`) and a `## State transitions` body section explaining the loop/termination conventions.
- `task-register` SKILL.md — refuse-message in step 4 now recommends `task-pause` as the canonical alternative to `task-complete` (or manual `rm`). New step 11 creates `tasks/<issue-number>.md` from TASK.md.tmpl; total step count 12 → 13.
- `task-complete` SKILL.md — new step 13 archives `tasks/<n>.md` to `tasks/closed/` via `mkdir -p` + `mv` (with backwards-compat skip for pre-v0.2.0 task files); subsequent steps renumbered.
- `chief-of-staff` agent — `owns_processes:` grows from 5 to 9 (adds 4 new skills); body's "Owned processes" section adds 4 new bullets.
- `copier.yml` `_exclude` adds `.claude/.paused-tasks`, `tasks/[0-9]*.md`, `tasks/closed/**` (prevents framework dogfooding from leaking to consumer scaffolds).
- `.gitignore` adds `.claude/.paused-tasks`.
- `README.md` adds "Key reference docs" section linking the two `company/knowledge-base/` research artifacts; adds `tasks/` to the Subscopes list.

### Notes

- Closes [#5](https://github.com/Koroqe/OPOS/issues/5) — "Ship v0.2.0 — new skills + research-derived improvements."
- No breaking changes for v0.1.x consumers. `copier update` flows cleanly: the new skills are CORE additions (auto-synced); the new `tasks/.gitkeep` is added; `.claude/task-tracking.config.json`'s `_label_palette` from v0.1.1 persists unchanged.
- All 5 v0.1.0 deferred items (consult-agent, release-from-changelog, task-pause, since_sha-fallback-exercise, privacy-warning-path) are addressed — the latter two by being NOT-actionable-without-real-world-usage and graduating from "deferred" to "validated in v0.3.0 if real-world runs surface them."
- All 3 research recommendations from the AI-OS framework survey (CrewAI, LangGraph, Claude Code positioning) are landed.
- `release-from-changelog` self-tested by being used to cut this very release.

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

[0.2.0]: https://github.com/Koroqe/OPOS/releases/tag/v0.2.0
[0.1.1]: https://github.com/Koroqe/OPOS/releases/tag/v0.1.1
[0.1.0]: https://github.com/Koroqe/OPOS/releases/tag/v0.1.0
