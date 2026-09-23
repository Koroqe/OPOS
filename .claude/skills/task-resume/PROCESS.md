---
process_name: task-resume
owner: chief-of-staff
collaborators: []
inputs: [issue_number]
success_criteria: [issue_not_already_active, issue_was_in_paused_list, lease_acquired_or_not_configured, paused_tasks_line_removed, paused_label_removed, current_task_cache_updated, task_update_posted_resume_notice, history_entry_written]
slo: "10 seconds"
version: 0.2.0
---

# task-resume

## Narrative

Activates a previously-paused task: acquires the lease (the cross-machine check that the task
was not already resumed elsewhere), moves the issue from `.claude/.paused-tasks` to the local
active-task cache, removes the `paused` label, and posts a "Task resumed" comment via
`task-update`. Sibling to `task-pause`.

**As of v0.7.0**, `.claude/.current-task` is a newline-delimited array and multi-active tasks are
first-class — resuming a task while others are already active is normal; the resumed issue is
appended to the existing array. **As of v0.17.0**, the lease acquired at step 3b — before any local
state is touched — is what actually prevents resuming a task another machine already picked back
up; the local cache alone could never detect that.

## Pre-conditions

- `issue_number` is not already present in `.claude/.current-task` (other active entries are fine —
  only this specific issue must not already be listed).
- `.claude/.paused-tasks` contains the target issue number on its own line.
- `gh` CLI authenticated.
- The GitHub issue is OPEN (so `task-update` can post).

## Steps

Mirrors the procedure in SKILL.md. **Order matters**: the lease must be acquired, and the local
active cache updated, before `task-update` is called (step 6 reads the cache to determine the
active-task list).

1. Resolve repo root.
2. Read `.claude/.current-task` as an array; abort with "Issue #<N> already active." if
   `issue_number` is already in it.
3. Verify the issue is in the local paused list: `node shared/scripts/task-state.mjs list-paused` includes it; else abort.
3b. **Acquire the lease before touching any local state.** `lease.mjs acquire --key "issue:<repo>#<issue_number>" --intent "resumed"`. `0` proceed · `9` not configured, print `lease: not configured, gate skipped` and proceed exactly as before · `2` another session holds it — abort with its holder/expiry message ("resumed elsewhere") and change nothing locally · anything else, stop.
4. Remove it from the local paused list: `node shared/scripts/task-state.mjs remove-paused --issue "$ISSUE_NUMBER"` (the file is kept even when empty), then `gh issue edit <issue_number> --remove-label paused`.
5. Add it to the local active cache: `node shared/scripts/task-state.mjs add-active --issue "$ISSUE_NUMBER"`.
6. Post the resume notice via `task-update --issue "$ISSUE_NUMBER" --status in_progress` (passing
   `--issue` explicitly so `task-update` does not abort on its own multi-active disambiguation
   guard).
7. Print one-line confirmation.
8. Write the history entry.

## Done when

- `issue_not_already_active` — `issue_number` was absent from `.claude/.current-task` at step 2.
- `issue_was_in_paused_list` — the local paused list contained the issue at step 3.
- `lease_acquired_or_not_configured` — `lease.mjs acquire` at step 3b returned `0`, or returned `9`
  and the gate was skipped.
- `paused_tasks_line_removed` — `.claude/.paused-tasks` no longer contains the issue number.
- `paused_label_removed` — the GitHub issue no longer carries the `paused` label.
- `current_task_cache_updated` — `.claude/.current-task` now includes the issue; other active
  entries are untouched.
- `task_update_posted_resume_notice` — the nested `task-update` call returned successfully.
- `history_entry_written` — a file exists under `./history/`.

## Rollback

- If step 3b (lease acquire) fails with anything other than `0`/`9`, nothing local has been changed
  yet — the run stops cleanly before steps 4-6.
- If a step after the local cache write (step 5) fails: the paused list and active cache are
  already consistent; only the GitHub comment may not have posted. Re-run `task-update` manually
  with `--issue`, or re-run `task-resume` — the paused-list removal is idempotent in practice.

## History

Every invocation writes an entry. Dual logging with `task-update/history/`, same convention as
`task-pause`.
