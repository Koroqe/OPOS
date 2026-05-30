---
process_name: schedule-process
owner: ops-manager
collaborators: []
inputs: [process_name]
success_criteria: [process_located, frontmatter_validated, idempotency_checked, cron_registered, cache_written, history_entry_written]
slo: "30 seconds non-interactive; <2 min if user iterates on the diff confirmation at step 7"
version: 0.1.0
state_schema:
  - locating: glob + parse PROCESS.md candidates; validate single match (steps 1-2)
  - validating: ui.scheduling.validate_frontmatter run; abort on errors (step 3)
  - composing: read schedule + authority; ensure scheduled-runs/ exists; build routine prompt with prelude (steps 4-6)
  - reconciling: CronList for idempotency; confirm-on-diff (step 7)
  - committing: CronCreate; cache append; conditional CronDelete of old; history entry (steps 8-11)
---

# schedule-process

## Narrative

Wraps Claude Code's built-in `CronCreate` tool to register a PROCESS.md-declared schedule as a live cron routine. The skill is the OPOS-side counterpart of the cron runtime: intent lives in `PROCESS.md` frontmatter (in repo, source of truth); live registration lives in the user's Claude Code account (per-machine). The local cache `.claude/scheduled-processes.json` is a hint (NOT authoritative) — `list-scheduled-processes` reconciles against `CronList` directly.

Owned by `ops-manager` because scheduling is a meta-process (a process about how other processes run). Same family as `design-process` / `design-agent` / `design-department`. No external collaborators in the design-time sense — the skill calls Claude Code tools, not other agents.

## Pre-conditions

- The user is logged into Claude Code (`claude login`); the built-in cron tools authenticate against the user's subscription.
- A target `PROCESS.md` exists with the 4 scheduling frontmatter fields set and passing `ui.scheduling.validate_frontmatter`.
- The skill folder containing that PROCESS.md is writable (for the lazy-creation of `scheduled-runs/.gitkeep`).
- `.claude/scheduled-processes.json` is writable or absent (will be created on first scheduled process).

## Steps

Mirrors the 11-step procedure in SKILL.md:

1. Resolve repo root.
2. Locate target PROCESS.md via glob + frontmatter match.
3. Validate frontmatter (`ui.scheduling.validate_frontmatter`).
4. Read resolved scheduling fields.
5. Ensure `<skill-folder>/scheduled-runs/` exists.
6. Compose the routine prompt with authority prelude.
7. Idempotency check via `CronList`.
8. Create the routine via `CronCreate`.
9. Persist locally (cache) + conditionally delete the old routine via `CronDelete`.
10. Write history entry.
11. Print summary.

## State transitions

Strict forward order. The `reconciling` state can short-circuit to `committing` with "no change" (step 7 idempotency match) — that bypasses steps 8 + 9 entirely, writes no history, and exits 0. The `committing` state's step 9b (conditional delete) only fires on the update path; the create path goes straight from CronCreate to cache write.

## Done when

- `process_located` — step 2 produced exactly one match (or user disambiguated multiple).
- `frontmatter_validated` — step 3 returned `(True, [])`.
- `idempotency_checked` — step 7 returned no-change OR user confirmed the update.
- `cron_registered` — step 8 succeeded; routine id captured.
- `cache_written` — step 9a appended to `.claude/scheduled-processes.json`.
- `history_entry_written` — `./history/<date>-<run-id>.md` exists.

A partial-failure run (step 9a fails after step 8 succeeds) still writes a `partial`-outcome history entry naming the orphan routine id; `cache_written` is NOT satisfied in that case.

## Rollback

- **Live routine only (cache write failed):** the partial-failure rollback in SKILL.md attempts `CronDelete` automatically. If that also fails, the user runs `/unschedule-process <name>` OR manually deletes via Claude Code's native UI using the routine id printed in the history entry.
- **Local cache only (no live registration):** edit `.claude/scheduled-processes.json` to remove the row. The next `/list-scheduled-processes` run will reclassify as ORPHAN if a live routine exists.
- **Both:** call `/unschedule-process <name>` (handles both halves).

## History

Every invocation writes an entry except the no-change idempotency path at step 7. Bodies should capture: target process name + path, routine id (if created), cron, authority list, idempotency outcome (no-change | created-new | updated-via-recreate), and any rollback events (auth-failure, cache-write-failure, etc.).
