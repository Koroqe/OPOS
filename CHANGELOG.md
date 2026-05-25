# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).
In `0.x.y` releases breaking changes are allowed.

## [0.1.0] - 2026-05-25

### Added

- Core framework skeleton: root `CLAUDE.md`, `RISKS.md`, `README.md`, 7 templates in `shared/templates/`.
- 4 company-level agents: `ceo`, `coo`, `chief-of-staff`, `ops-manager`.
- 6 framework skills: `design-process`, `task-register`, `task-update`, `task-complete`, `check-for-updates`, `sync-from-core`.
- 2 starter departments: `engineering` (with `deploy` skill), `rnd`.
- **Copier-based distribution**: `copier.yml` with `_envops` (custom Jinja delimiters `<<` `>>`), `_exclude` (runtime state), `_skip_if_exists` (starter content), and a single `COMPANY_NAME` question.
- **Agent-driven auto-update**: `check-for-updates` skill invoked as step 1 of `task-register`/`task-update`/`task-complete`; cached 6h; silent unless an update exists.
- **Opt-in GitHub Actions auto-update workflow**: `.github/workflows/sync-opos.yml`, `workflow_dispatch` only by default; uncomment `schedule:` block to enable weekly background PRs.
- `CHANGELOG.md` (this file) and semantic-versioning policy.
- `MAINTAINER.md` framework-developer guide.

### Notes

- Initial public release.
- `0.x.y` releases may contain breaking changes per semver. Each breaking-change release will include a `### Migration` subsection in its CHANGELOG entry.
- Future breaking changes after v1.0 will bump the major version.

[0.1.0]: https://github.com/Koroqe/OPOS/releases/tag/v0.1.0
