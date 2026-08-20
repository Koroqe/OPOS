---
title: Scheduled processes mechanism (v0.6.0)
owner: ops-manager
created: 2026-05-30
state: proposed
runs: 0
intended_target: .claude/skills/schedule-process/
labels: [cross-functional, operational]
---

# Scheduled processes mechanism (v0.6.0)

## Goal

Add a **scheduling mechanism** to OPOS core so any process can fire on a cron schedule, not only on a human-issued slash command. The mechanism (skills, frontmatter schema, validator, run-record convention, drift detection) is OPOS core and ships via copier. The specific scheduled processes that adopters define remain per-company.

Outcome: a founder or dept lead can add four frontmatter fields to any `PROCESS.md`, run `/schedule-process <name>`, and that process fires on the declared cron without further intervention — making the company "work 24/7."

## Acceptance

A single design run succeeds when:

- Plan from brainstorm session is reviewed by `ops-manager` (owner) and any updated decisions are folded in.
- Task is registered via `/task-register` against the framework repo.
- `/bootstrap-feature` produces PRD, use cases, architecture review, QA test cases.
- Implementation proceeds through the 8 slices defined in the plan (Waves 1–7).
- `/merge-ready` quality gates pass.
- v0.6.0 released via `/release-from-changelog`.

## Plan

The full approved plan from the brainstorm session lives at:

```
/Users/aleksei/.claude/plans/let-s-brainstorm-how-we-re-whimsical-tulip.md
```

Key decisions locked in by that plan (do not relitigate during design unless surfacing new information):

- **Backend:** wrap Claude Code's built-in `/schedule` skill in a thin OPOS layer (subscription-authenticated, cloud execution). Custom GitHub Actions and `launchd` are deferred to v2 via the `runtime:` field.
- **Source of truth split:** intent ships in `PROCESS.md` frontmatter (in repo); live registration lives in the user's Claude Code account (per-machine). Drift is detected by `/list-scheduled-processes`.
- **Authority:** declared contract enforced by prelude injection + in-band self-check. v1 has no post-run guard; that's a v2 work item.
- **Run records:** new `scheduled-runs/` folder, sibling to `history/`. Manual runs continue writing to `history/`; the two never mix.
- **Owner:** `ops-manager` owns `/schedule-process`, `/unschedule-process`, `/list-scheduled-processes`.
- **All-or-nothing frontmatter:** the four scheduling fields (`schedule`, `runtime`, `non_interactive`, `authority`) are optional collectively, but if any is set all four must be set.

When this item is ready to formalize: invoke `/design-process` with `backlog_item_path=company/backlog/scheduled-processes.md`. The plan file referenced above is the input; `ops-manager` consults dept leads and produces the SKILL.md + PROCESS.md pairs per the slice breakdown.

## Dependencies

- Task #10 (v0.5.1 7-dept org chart + allocate-resource) must ship first. This work targets v0.6.0.

## Runs log

| date | actor | outcome | notes |
|------|-------|---------|-------|
| 2026-05-30 | human (brainstorm) | proposed | Brainstorm session produced approved plan; item filed pending v0.5.1 ship. |
