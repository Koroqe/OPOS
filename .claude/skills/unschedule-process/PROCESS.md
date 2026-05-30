---
process_name: unschedule-process
owner: ops-manager
collaborators: []
inputs: [process_name]
success_criteria: [routine_id_resolved, routine_deleted, cache_pruned, history_entry_written]
slo: "20 seconds non-interactive; <1 min if user disambiguates multiple CronList matches in step 3"
version: 0.1.0
state_schema:
  - looking_up: cache fast-path; fallback to CronList prompt-prefix search (steps 1-3)
  - deleting: CronDelete; handle auth failure (step 4)
  - cleaning_cache: prune the routine_id row from .claude/scheduled-processes.json (step 5)
  - logging: history entry + summary (steps 6-7)
---

# unschedule-process

## Narrative

Wraps Claude Code's built-in `CronDelete` tool to cancel a previously-scheduled routine. The skill is intentionally lighter than `schedule-process` — there's no idempotency check beyond "is the routine even registered" (handled by step 3's zero-match exit-0), no authority prelude (deletion doesn't run the routine), no rollback complexity (the live state change is atomic — the routine either exists in `CronList` or it doesn't).

`PROCESS.md` source-of-truth is intentionally NOT modified. The user re-schedules by re-running `/schedule-process <name>` without editing frontmatter. If they want to permanently retire the schedule, they manually remove the 4 fields after unscheduling.

Owned by `ops-manager` — sibling of `schedule-process` and `list-scheduled-processes`. Same family as the design-* trio.

## Pre-conditions

- The user is logged into Claude Code (`claude login`).
- A live routine exists in `CronList` matching the `process-name` (otherwise step 3 short-circuits as idempotent no-op).

## Steps

Mirrors the 7-step procedure in SKILL.md:

1. Resolve repo root.
2. Cache fast-path lookup in `.claude/scheduled-processes.json`.
3. CronList fallback if cache miss; handle multi-match.
4. CronDelete with auth-failure guard.
5. Remove cache row (best-effort).
6. Write history entry.
7. Print summary.

## State transitions

Strict forward order with one short-circuit: step 3 zero-match → exit 0 with no history entry (idempotent no-op). Otherwise: `looking_up → deleting → cleaning_cache → logging`.

## Done when

- `routine_id_resolved` — step 2 cache hit OR step 3 CronList match (or user disambiguation).
- `routine_deleted` — step 4 `CronDelete` succeeded.
- `cache_pruned` — step 5 wrote updated JSON OR printed a stale-row warning (the success criterion is satisfied even on cache-write failure since `CronList` is authoritative).
- `history_entry_written` — `./history/<date>-<run-id>.md` exists.

## Rollback

Re-running `/schedule-process <name>` after an unschedule restores the routine — the PROCESS.md frontmatter was never modified, so the declaration is intact and the schedule-process flow registers a fresh routine with a new id. There is no "undo unschedule" primitive beyond this re-run.

## History

Every invocation writes an entry EXCEPT the step-3 zero-match idempotent no-op. Bodies should capture: process name, deleted routine id (or "no routine found"), cron that was deleted, lookup path used (cache hit | CronList fallback), and any cache-write warnings.
