---
process_name: task-update
owner: chief-of-staff
collaborators: [eng-lead]
inputs: [message, key, status, issue]
success_criteria: [update_check_attempted, active_task_resolved, comment_posted_or_skipped_idempotently, lease_gate_passed_or_not_configured, lease_renewed_after_post, status_line_patched_if_provided_or_failed_clearly, issue_still_open_at_start, history_entry_written]
slo: "10 seconds"
version: 0.2.0
---

# task-update

## Narrative

Records mid-task progress by posting a comment on the active task's GitHub issue and optionally
patching the issue body's status line. Idempotent via a caller-provided `--key`. The second of the
task-tracking lifecycle skills.

**`.claude/.current-task` is a local convenience cache (v0.17.0)**, not the source of truth for who
is working on the task — that is the lease checked at step 5b. Since v0.7.0 the cache is a
newline-delimited array of active issue numbers; this skill auto-picks the target when exactly one
entry is active and requires `--issue` to disambiguate when several are.

## Pre-conditions

- An active task is resolvable: either `.claude/.current-task` holds exactly one entry, or `--issue`
  is passed explicitly (required when the cache holds more than one entry).
- That issue is OPEN on the configured repo.
- `gh` CLI is authenticated.
- This session holds, or can acquire, the lease on the issue — enforced at step 5b, not assumed in
  advance.

## Steps

Mirrors the procedure in SKILL.md:

1. Check for upstream updates (best-effort).
2. Resolve repo root.
3. Read `.claude/.current-task` as an array and resolve the target issue (`--issue` override,
   single-entry auto-pick, or abort with the active list when ambiguous or empty).
4. Read and validate `task-tracking.config.json`.
5. Fetch the issue; abort if its state is `CLOSED`.
5b. **Lease gate.** `lease.mjs check --key "issue:<repo>#<number>"`. `0` proceed · `9` not configured, print `lease: not configured, gate skipped` and proceed exactly as before · `4` this session holds no lease, take one with `lease.mjs acquire`, stopping if that exits `2` (another holder) · `5` lease stolen or lapsed, stop writing immediately · anything else, stop.
6. Idempotency check: scan the last 50 comments for `<!-- update-key: <key> -->`; no-op with
   `outcome: partial` on a match.
7. Render the comment from `shared/templates/task-update.md.tmpl`.
8. Post the comment.
8b. **Renew the lease** (heartbeat): `lease.mjs renew --key "issue:<repo>#<number>" --quiet`. A
    non-zero exit here does not undo the posted comment, but exit `5` (revoked) must be reported.
9. If `--status` was provided, patch the canonical `**Status:** ...` body line via
   `shared/scripts/task-state.mjs patch-status`, piped into `gh issue edit --body-file -`; abort
   cleanly if the canonical line is missing.
10. Print one-line confirmation.
11. Write the history entry.

## Done when

- `update_check_attempted` — the upstream-update check ran.
- `active_task_resolved` — the target issue was determined via `--issue` or a single-entry cache,
  or the run aborted with the documented disambiguation/absence message.
- `comment_posted_or_skipped_idempotently` — either a new comment exists carrying the matching
  `update-key` marker, or the run was a no-op because that key was already present.
- `lease_gate_passed_or_not_configured` — `lease.mjs check` (and, if needed, `acquire`) returned
  `0`, or returned `9` and the gate was skipped.
- `lease_renewed_after_post` — `lease.mjs renew` ran after the comment was posted (its exit code is
  reported, not silently dropped, on `5`).
- `status_line_patched_if_provided_or_failed_clearly` — if `--status` was passed, the body's
  `**Status:**` line was patched or the run aborted with the documented error; vacuously true
  otherwise.
- `issue_still_open_at_start` — the issue's state was OPEN at step 4.
- `history_entry_written` — a new file exists under `./history/` with schema-conformant
  frontmatter.

## Rollback

If the comment was posted but a downstream step failed:

1. Delete the most-recent comment with `gh issue comment delete --comment-id <id>` (captured from
   `gh issue comment create --json id` at step 8).
2. The status-line patch is harder to undo — left as a documented limitation; a human can manually
   revert via `gh issue edit --body`.
3. The step-8b lease renewal is not rolled back; if it reported exit `5`, another session now holds
   the task and no further writes should be attempted regardless of this rollback.
4. Write a history entry with `outcome: failure`.

## History

Each invocation appends an entry to `./history/` per the schema in `.claude/CLAUDE.md`.
