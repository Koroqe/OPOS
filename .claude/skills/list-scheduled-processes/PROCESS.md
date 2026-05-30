---
process_name: list-scheduled-processes
owner: ops-manager
collaborators: []
inputs: []
success_criteria: [process_md_inventory_complete, cronlist_fetched, rows_classified, table_printed, history_entry_conditional]
slo: "<10 seconds for repos with <100 PROCESS.md files; scales linearly with PROCESS.md count and CronList size"
version: 0.1.0
state_schema:
  - inventorying: glob + parse all PROCESS.md files; categorize declared-valid / declared-invalid / undeclared (step 1)
  - fetching: CronList for live registrations; cache as hint only (step 2)
  - classifying: cross-reference declarations vs registrations; assign OK / MISSING / ORPHAN / DRIFT / INVALID_INTENT (step 3)
  - reporting: print table + overlap warnings; conditional history entry (steps 4-6)
---

# list-scheduled-processes

## Narrative

The drift-detection skill of the v0.6.0 scheduling family. Wraps Claude Code's built-in `CronList` tool and cross-references it against in-repo PROCESS.md declarations.

The cardinal rule: **`CronList` is authoritative.** The local cache `.claude/scheduled-processes.json` is a hint (helps disambiguate process_name ↔ routine_id pairings when prompt prefixes are ambiguous), NEVER a source of truth. This prevents a fresh-machine bootstrap from falsely classifying every live routine as ORPHAN just because the cache hasn't been populated yet.

Read-only. Modifies nothing. Safe to run repeatedly; idempotent. Drift is a SIGNAL not a failure — the skill exits 0 in all non-auth-failure cases.

Owned by `ops-manager` — completes the scheduling-family trio (`schedule-process` + `unschedule-process` + `list-scheduled-processes`).

## Pre-conditions

- The user is logged into Claude Code (`claude login`).
- At least one PROCESS.md exists in the repo (otherwise the inventory is empty and the skill exits 0 with a "nothing to inventory" message).

## Steps

Mirrors the 6-step procedure in SKILL.md:

1. Glob + parse + categorize all PROCESS.md (declared-valid / declared-invalid / undeclared).
2. CronList for live registrations.
3. Cross-reference; assign one of 5 statuses (OK / MISSING / ORPHAN / DRIFT / INVALID_INTENT).
4. Print the table.
5. Warn on overlapping cron times.
6. Conditional history entry (only if non-OK rows found).

## State transitions

Strict forward order. The `classifying` state populates the rows in a single pass; the `reporting` state's history-entry decision is a function of whether any row's status is non-OK.

## Done when

- `process_md_inventory_complete` — step 1 walked all PROCESS.md files.
- `cronlist_fetched` — step 2 succeeded (or short-circuited on auth failure with no history).
- `rows_classified` — every row in the inventory has exactly one of 5 statuses.
- `table_printed` — step 4 produced the table on stdout.
- `history_entry_conditional` — entry exists iff any non-OK row was classified.

## Rollback

No rollback needed — read-only.

## History

Conditional. Only writes when at least one row was non-OK (MISSING / ORPHAN / DRIFT / INVALID_INTENT). On a clean repo (all OK, no overlaps), no entry. This prevents the noise of routine inventories drowning out actual drift events. Bodies should capture: total row count by status, the specific non-OK rows + recovery actions printed, and any overlap warnings emitted.
