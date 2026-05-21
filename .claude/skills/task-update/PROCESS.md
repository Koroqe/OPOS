---
process_name: task-update
owner: chief-of-staff
collaborators: [eng-lead]
inputs: [message, key, status, issue]
success_criteria: [comment_posted_or_skipped_idempotently, status_line_patched_if_provided_or_failed_clearly, issue_still_open_at_start, history_entry_written]
slo: "10 seconds"
version: 0.1.0
---

# task-update

## Narrative

Records mid-task progress by posting a comment on the active task's GitHub issue and optionally patching the issue body's status line. Idempotent via a caller-provided `--key`. The second of three sibling skills in the task-tracking lifecycle.

## Pre-conditions

- An active task exists: either `<repo-root>/.claude/.current-task` contains an issue number, or `--issue` is passed explicitly.
- That issue is OPEN on the configured repo.
- `gh` CLI is authenticated.

## Steps

Mirrors the 10-step procedure in SKILL.md:

1. Resolve repo root.
2. Read `.current-task` (or `--issue`).
3. Read and validate config.
4. Fetch the issue; abort if closed.
5. Idempotency check via the `<!-- update-key: <key> -->` HTML marker; silent no-op on duplicate.
6. Render the comment from the template.
7. Post the comment.
8. Optionally patch the `**Status:**` body line via the canonical regex; abort cleanly if the line is missing.
9. Print confirmation.
10. Write history entry.

## Done when

- `comment_posted_or_skipped_idempotently` — either a new comment exists carrying the matching `update-key` HTML marker, OR the run was a no-op because that key was already present.
- `status_line_patched_if_provided_or_failed_clearly` — if `--status` was passed, the issue body's `**Status:**` line was patched (or the run aborted with the documented error message); if `--status` was not passed, this criterion is vacuously true.
- `issue_still_open_at_start` — the issue's state was OPEN at the time of step 4.
- `history_entry_written` — a new file exists under `./history/` for this run with schema-conformant frontmatter.

## Rollback

If the comment was posted but a downstream step failed:

1. Delete the most-recent comment with `gh issue comment delete --comment-id <id>` (gh returns the new comment's id from `gh issue comment create --json id`; capture it during step 7).
2. The status-line patch is harder to undo — left as a documented limitation; the human can manually revert via `gh issue edit --body`.
3. Write a history entry with `outcome: failure`.

## History

Each invocation appends an entry to `./history/` per the schema in root `CLAUDE.md`.
