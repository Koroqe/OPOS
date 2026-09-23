---
process_name: task-pause
owner: chief-of-staff
collaborators: []
inputs: [issue]
success_criteria: [active_task_resolved, task_update_posted_pause_notice, lease_released_or_not_configured, paused_label_applied, paused_tasks_appended, current_task_cache_updated, history_entry_written]
slo: "10 seconds"
version: 0.2.0
---

# task-pause

## Narrative

Sets aside an active task without closing the GitHub issue: posts a pause notice, yields the
lease so another session may pick the task up, labels the issue `paused`, and records the issue
in `.claude/.paused-tasks` so `task-resume` can pick it back up later. Replaces the manual
`rm .current-task` workaround (fired 4x across prior releases — strong signal for this skill).

**As of v0.7.0** `.claude/.current-task` is a newline-delimited array; this skill auto-picks the
target when exactly one entry is active and requires `--issue` to disambiguate when several are.
**As of v0.17.0**, releasing the lease with state `yielded` — not the local cache edit — is what
makes the task visible to other sessions as available to resume.

## Pre-conditions

- An active task is resolvable: either `.claude/.current-task` holds exactly one entry, or `--issue`
  is passed explicitly and present in that array (required when the array holds more than one
  entry).
- `gh` CLI authenticated (needed by the nested `task-update` call and the label edit).
- The GitHub issue is OPEN (so `task-update` can post a comment).

## Steps

Mirrors the procedure in SKILL.md. **Order matters**: `task-update` (step 3) must run before the
issue is removed from the local active cache (step 5), because `task-update` reads that cache to
know which issue to comment on.

1. Resolve repo root.
2. Read `.claude/.current-task` as an array and resolve the target issue (`--issue` override,
   single-entry auto-pick, or abort with the active list when ambiguous, absent, or the named issue
   is not in it). Do not modify the cache yet.
3. Post the pause notice via `task-update --status blocked` (while the cache still lists the issue,
   so `task-update` can read it).
3b. **Yield the lease and label the issue paused.** `lease.mjs release --key "issue:<repo>#<issue>" --state yielded --reason "paused"`; exit `9` (not configured) is fine. Then
   `gh label create paused ...` (idempotent) and `gh issue edit <issue> --add-label paused`. The
   `paused` label is what other machines see; `.paused-tasks` is only this clone's memory.
4. Record the issue in the local paused list: `node shared/scripts/task-state.mjs add-paused --issue "$ISSUE"`.
5. Remove it from the local active cache: `node shared/scripts/task-state.mjs remove-active --issue "$ISSUE"`.
6. Print one-line confirmation.
7. Write the history entry (and note that `task-update`'s step 3 call writes its own, separate
   history entry — both are intentional).

## Done when

- `active_task_resolved` — the target issue was determined via `--issue` or a single-entry cache,
  or the run aborted with the documented disambiguation/absence message.
- `task_update_posted_pause_notice` — the nested `task-update` call returned successfully (its own
  history entry lives in `task-update/history/`).
- `lease_released_or_not_configured` — `lease.mjs release --state yielded` returned `0` or `9`.
- `paused_label_applied` — the issue carries the `paused` GitHub label.
- `paused_tasks_appended` — `.claude/.paused-tasks` now contains the issue number.
- `current_task_cache_updated` — the issue no longer appears in `.claude/.current-task`; other
  active entries are untouched.
- `history_entry_written` — a file exists under `./history/` for this run.

## Rollback

If the run failed mid-flow:

- If `task-update` succeeded (step 3) but later steps failed: the issue has a pause comment but is
  still listed in the local active cache. Re-running `task-pause` is safe — the duplicate
  `task-update` call is idempotent via its key (each key includes a timestamp, so the resulting
  double comment is cosmetic, not a correctness issue).
- If the local paused list was appended (step 4) but the active cache was not yet updated (step 5):
  finish by running `node shared/scripts/task-state.mjs remove-active --issue <N>` to restore
  consistency.
- A step-3b lease-release failure other than `0`/`9` stops the run before steps 4-5 run (per the
  lease skill's general calling convention); nothing local has been changed yet in that case.

## History

Every invocation writes an entry. A second entry is written to `task-update/history/` by the
nested call — this is intentional dual logging (both events are independently auditable).
