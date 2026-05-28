---
process_name: task-resume
owner: chief-of-staff
collaborators: []
inputs: [issue_number]
success_criteria: [no_active_task_at_start, issue_was_in_paused_list, paused_tasks_line_removed, current_task_written, task_update_posted_resume_notice, history_entry_written]
slo: "10 seconds"
version: 0.1.0
---

# task-resume

## Narrative

Activates a previously-paused task. Reads the issue number from `.paused-tasks`, moves it to `.current-task`, posts a "Task resumed" GitHub comment via `task-update`. Sibling to `task-pause`.

## Pre-conditions

- `.claude/.current-task` is absent (no active task in flight).
- `.claude/.paused-tasks` contains the target issue number on its own line.
- `gh` CLI authenticated.
- The GitHub issue is OPEN (so task-update can post).

## Steps

Mirrors the 8-step procedure in SKILL.md, with the key ordering invariant:

1. Resolve repo root.
2. Verify no active task (`.current-task` absent).
3. Verify issue is in `.paused-tasks`.
4. Remove the issue's line from `.paused-tasks`.
5. Write `.current-task` (BEFORE task-update is called).
6. Post resume notice via `task-update --status in_progress`.
7. Print confirmation.
8. Write history entry.

## Done when

- `no_active_task_at_start` — `.current-task` was absent when the skill started.
- `issue_was_in_paused_list` — `grep -qx <issue> .paused-tasks` succeeded at step 3.
- `paused_tasks_line_removed` — `.paused-tasks` no longer contains the issue number.
- `current_task_written` — `.current-task` exists and contains the issue number.
- `task_update_posted_resume_notice` — the nested task-update call returned successfully.
- `history_entry_written` — file exists under `./history/`.

## Rollback

If a step after `.current-task` write fails: framework state is consistent (active task set, paused list updated). Only the GitHub comment may not have posted. Re-run task-update manually, OR re-run task-resume (paused-list removal is effectively idempotent via grep -vx).

## History

Every invocation writes an entry. Dual-logging with task-update/history/ same as task-pause.
