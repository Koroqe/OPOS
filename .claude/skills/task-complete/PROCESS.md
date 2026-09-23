---
process_name: task-complete
owner: chief-of-staff
collaborators: [eng-lead]
inputs: [summary, since_sha, issue, deliverables]
success_criteria: [update_check_attempted, active_task_resolved, final_comment_posted, lease_gate_passed_or_not_configured, status_done_label_applied, issue_closed_with_reason_completed, lease_released_or_not_configured, task_file_archived, current_task_cache_updated, missing_ref_warning_surfaced_if_applicable, history_entry_written]
slo: "30 seconds"
version: 0.2.0
---

# task-complete

## Narrative

Closes out a tracked task: posts a final report (agent summary + auto-generated changelog from
`git log` + linked PRs + deliverables), applies the `status:done` label, closes the GitHub issue
with reason `completed`, archives the task file, and removes the issue from the local active-task
cache. The last of the task-tracking lifecycle skills.

**`.claude/.current-task` is a local convenience cache (v0.17.0)**; the lease acquired and released
at steps 9b/12b is what actually governs whether this session is allowed to close the task —
closing someone else's task from another machine is exactly the collision leases exist to stop.

## Pre-conditions

- An active task is resolvable: either `.claude/.current-task` holds exactly one entry, or `--issue`
  is passed explicitly (required when the cache holds more than one entry).
- The current working directory is inside a git repository with at least one commit.
- `gh` CLI is authenticated.
- This session holds, or can acquire, the lease on the issue — enforced at step 9b.

## Steps

Mirrors the procedure in SKILL.md:

1. Check for upstream updates (best-effort).
2. Resolve repo root.
3. Read `.claude/.current-task` as an array and resolve the target issue (`--issue` override,
   single-entry auto-pick, or abort with the active list when ambiguous or empty).
4. Read and validate config.
5. Resolve `since_sha` via the documented fallback chain.
6. Build the changelog via `git log <since_sha>..HEAD --oneline --no-merges`.
7. Discover PR links via `gh issue view --json closedByPullRequestsReferences`.
8. Scan commits in range for the `Refs: #<issue>` trailer; collect commits lacking it.
9. Render the final comment (summary, changelog, PR links, deliverables, missing-ref warning).
9b. **Lease gate.** lease.mjs acquire --key "issue:<repo>#<number>"`. `0` proceed · `9` not
    configured, print `lease: not configured, gate skipped` and proceed exactly as before ·
    anything else, stop.
10. Post the final comment.
11. Ensure `status:done` label exists (color from `_label_palette` in the config, defaulting to
    `0E8A16`); apply it.
12. Close the issue with reason `completed`.
12b. **Release the lease**: `lease.mjs release --key "issue:<repo>#<number>" --reason "completed"`
    (this also removes the index label). Exit `9` is fine; any other non-zero is reported but does
    not reopen the issue — the lease lapses on its TTL regardless.
13. Archive the task file: `git mv "tasks/<number>.md" "tasks/closed/<number>.md"` (skip silently if
    the file was never created; fall back to a plain move if it exists untracked).
14. Remove the issue from the local active cache: `node shared/scripts/task-state.mjs remove-active --issue "$ISSUE_NUM"` (a concurrent `task-complete` finding it already absent exits 0).
15. Print one-line confirmation.
16. Write the history entry.

## Done when

- `update_check_attempted` — the upstream-update check ran.
- `active_task_resolved` — the target issue was determined via `--issue` or a single-entry cache,
  or the run aborted with the documented disambiguation/absence message.
- `final_comment_posted` — a new comment exists on the issue containing the agent summary.
- `lease_gate_passed_or_not_configured` — `lease.mjs acquire` at step 9b (v0.17.2) returned `0`, or returned `9`
  and the gate was skipped.
- `status_done_label_applied` — `gh issue view --json labels` includes `status:done`.
- `issue_closed_with_reason_completed` — `gh issue view --json state,stateReason` returns `CLOSED` /
  `COMPLETED`.
- `lease_released_or_not_configured` — `lease.mjs release` at step 12b returned `0` or `9`.
- `task_file_archived` — `tasks/<number>.md` no longer exists at its original path and, if it
  existed at all, is now under `tasks/closed/`.
- `current_task_cache_updated` — the completed issue no longer appears in `.claude/.current-task`;
  other active entries are untouched.
- `missing_ref_warning_surfaced_if_applicable` — if any commits in range lacked
  `Refs: #<issue>`, the warning block is present in the final comment AND printed to stdout;
  vacuously true otherwise.
- `history_entry_written` — a new file exists under `./history/` with schema-conformant
  frontmatter.

## Rollback

If the final report was posted but a downstream step failed:

1. `gh issue reopen <number>` to revert the close.
2. Add a comment noting the rollback: `gh issue comment <number> --body "Auto-rolled-back by task-complete due to <reason>."`
3. Restore the local cache entry: `node shared/scripts/task-state.mjs add-active --issue <number>`
   (the task is still in flight).
4. Write a history entry with `outcome: failure`.

A step-12b lease-release failure on its own does NOT trigger this rollback: the issue stays closed,
and per SKILL.md the lease is left to lapse on its TTL rather than reopening completed work.

## History

Each invocation appends an entry to `./history/` per the schema in `.claude/CLAUDE.md`.
