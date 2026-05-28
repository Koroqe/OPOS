---
process_name: task-pause
owner: chief-of-staff
collaborators: []
inputs: []
success_criteria: [active_task_existed_at_start, task_update_posted_pause_notice, paused_tasks_appended, current_task_deleted, history_entry_written]
slo: "10 seconds"
version: 0.1.0
---

# task-pause

## Narrative

Sets aside the currently-active task without closing the GitHub issue. Records the issue number in `.claude/.paused-tasks` so `task-resume` can pick it back up later. Replaces the manual `rm .current-task` workaround (fired 4× across prior releases — strong signal for this skill).

## Pre-conditions

- `.claude/.current-task` exists with a valid issue number.
- `gh` CLI authenticated (needed by the nested task-update call).
- The GitHub issue is OPEN (so task-update can post a comment).

## Steps

Mirrors the 7-step procedure in SKILL.md, with the key ordering invariant:

1. Resolve repo root.
2. Read `.current-task`; capture issue number.
3. Post pause notice via `task-update --status blocked` (BEFORE `.current-task` is deleted).
4. Append issue number to `.paused-tasks`.
5. Delete `.current-task`.
6. Print confirmation.
7. Write history entry.

## Done when

- `active_task_existed_at_start` — `.current-task` was present and contained a valid issue number when the skill started.
- `task_update_posted_pause_notice` — the nested `task-update` call returned successfully (its own history entry will be in task-update/history/).
- `paused_tasks_appended` — `.paused-tasks` now contains the issue number on a line.
- `current_task_deleted` — `.current-task` is no longer present.
- `history_entry_written` — file exists under `./history/`.

## Rollback

If the run failed mid-flow:

- If task-update succeeded (step 3) but later steps failed: the issue has a "Task paused" comment but `.current-task` is still set. Re-run task-pause — the duplicate task-update will no-op via idempotency-key (the key includes a timestamp so it won't actually match, but the resulting double-comment is cosmetic and acceptable).
- If `.paused-tasks` was appended but `.current-task` not deleted: manually delete `.current-task` (consistent state restored).

## History

Every invocation writes an entry. A SECOND entry is written to `task-update/history/` by the nested call — this is intentional dual logging (both events are independently auditable).
