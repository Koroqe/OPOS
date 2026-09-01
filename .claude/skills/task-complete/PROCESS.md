---
process_name: task-complete
owner: chief-of-staff
collaborators: [eng-lead]
inputs: [summary, since_sha, issue, deliverables]
success_criteria: [update_check_attempted, final_comment_posted, status_done_label_applied, issue_closed_with_reason_completed, current_task_cleared, missing_ref_warning_surfaced_if_applicable, history_entry_written]
slo: "30 seconds"
version: 0.1.0
---

# task-complete

## Narrative

Closes out a tracked task: posts a final report (agent summary + auto-generated changelog from `git log` + linked PRs + deliverables), applies the `status:done` label, closes the GitHub issue with reason `completed`, and clears the local `.current-task` state file. The third and final skill in the task-tracking lifecycle.

## Pre-conditions

- An active task exists: either `<repo-root>/.claude/.current-task` contains an issue number, or `--issue` is passed.
- The current working directory is inside a git repository with at least one commit.
- `gh` CLI is authenticated.

## Steps

Mirrors the 14-step procedure in SKILL.md:

1. Resolve repo root.
2. Read `.current-task` (or `--issue`).
3. Read and validate config.
4. Resolve `since_sha` via the documented fallback chain.
5. Build the changelog via `git log`.
6. Discover PR links via `gh issue view --json closedByPullRequestsReferences`.
7. Scan commits for `Refs: #` trailers; collect commits lacking the ref.
8. Render the final comment.
9. Post the final comment.
10. Ensure `status:done` label exists; apply it.
11. Close the issue with reason `completed`.
12. Delete `.current-task`.
13. Print confirmation.
14. Write history entry.

## Done when

- `final_comment_posted` — a new comment exists on the issue containing the agent summary.
- `status_done_label_applied` — `gh issue view --json labels` includes `status:done`.
- `issue_closed_with_reason_completed` — `gh issue view --json state,stateReason` returns `CLOSED` / `COMPLETED`.
- `current_task_cleared` — `<repo-root>/.claude/.current-task` no longer exists.
- `missing_ref_warning_surfaced_if_applicable` — if any commits in the range lacked `Refs: #<issue>`, the warning block is present in the final comment AND printed to stdout. If all commits had the ref, this criterion is vacuously true.
- `history_entry_written` — a new file exists under `./history/` for this run with schema-conformant frontmatter.

## Rollback

If the final report was posted but a downstream step failed:

1. `gh issue reopen <number>` to revert the close.
2. Add a comment noting the rollback: `gh issue comment <number> --body "Auto-rolled-back by task-complete due to <reason>."`
3. Recreate `.current-task` with the issue number (so the task is still in flight).
4. Write a history entry with `outcome: failure`.

## History

Each invocation appends an entry to `./history/` per the schema in `.claude/CLAUDE.md`.
