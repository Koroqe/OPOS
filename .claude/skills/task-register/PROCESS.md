---
process_name: task-register
owner: chief-of-staff
collaborators: [eng-lead]
inputs: [title, depts, plan_file, goal]
success_criteria: [update_check_attempted, config_validated, gh_auth_confirmed, issue_created, labels_applied_normalized, lease_acquired_or_not_configured, current_task_cache_updated, task_file_created, history_entry_written, label_warnings_consolidated_if_quiet]
slo: "30 seconds"
version: 0.2.0
---

# task-register

## Narrative

Opens a GitHub issue for a newly initiated task. The first of the task-tracking lifecycle skills
(`task-register` → `task-update` → `task-complete`, with `task-pause`/`task-resume` alongside).
Owned by `chief-of-staff`, with `eng-lead` listed as collaborator since the GitHub integration is
the R&D dept's engineering-branch domain (gh CLI conventions, label hygiene, the `Refs: #` linking
convention used downstream by `task-complete`).

**Multi-active tasks are first-class (v0.7.0):** an existing `.claude/.current-task` array does not
block a new registration; parallel sessions each open their own task without colliding.

**Leases are the source of truth for occupancy (v0.17.0):** `.claude/.current-task` is a local
convenience cache — it lets later skill calls on this clone skip `--issue`. It is not, and has
never fully been, a record another machine can see. The lease taken in step 9b is what makes the
new task visible as occupied to every other session.

## Pre-conditions

- `gh` CLI installed and authenticated (`gh auth status` exits 0).
- `<repo-root>/.claude/task-tracking.config.json` exists and `repo` is non-empty.
- The target repo (per config) exists, has issues enabled, and the authenticated user can create
  issues.
- No pre-condition on the contents of `.claude/.current-task` — multi-active tasks are first-class;
  a populated array does not block this run.

## Steps

Mirrors the procedure in SKILL.md:

1. Check for upstream updates (best-effort; failures never block this run).
2. Resolve repo root.
3. Read and validate `task-tracking.config.json`.
4. Parse `.claude/.current-task` as a newline-delimited array with defensive filtering; the
   duplicate check against this array happens later, at step 10, against the new issue number.
5. Privacy check via `gh repo view` (warn on `public`, do not block).
6. Normalize `--depts` and ensure a `dept:<name>` label exists for each.
7. Ensure the flat `task` label exists.
8. Render the issue body from `shared/templates/task-issue.md.tmpl`.
9. Create the issue via `gh issue create` (using `--body-file`, never `--body`).
9b. **Acquire the lease** on the new issue: `lease.mjs acquire --key "issue:<repo>#<N>" --intent "<title>"`. `0` proceed · `9` not configured, print `lease: not configured, gate skipped` and proceed exactly as before · `3` stale clone, `git pull --ff-only` and re-acquire · anything else, the issue already exists, so report "issue #N created, but NOT leased: <reason>", finish the remaining steps, and record `outcome: partial`.
10. Record the issue in the local cache: `node shared/scripts/task-state.mjs add-active --issue "$ISSUE_NUM"`.
11. Create the task file from `shared/templates/TASK.md.tmpl` at `tasks/<issue-number>.md` (skip
    silently if it already exists).
12. Print a one-line confirmation summary.
13. Write the history entry.

## Done when

- `update_check_attempted` — the upstream-update check ran (its result does not gate this skill).
- `config_validated` — the config file parsed and `repo` was non-empty.
- `gh_auth_confirmed` — `gh auth status` succeeded.
- `issue_created` — `gh issue create` returned a number; the issue is visible at the URL.
- `labels_applied_normalized` — the issue has the flat `task` label AND a `dept:<name>` label for
  each (lowercased) input department.
- `lease_acquired_or_not_configured` — `lease.mjs acquire` returned `0`, OR returned `9` (company
  has not opted into leases) and the gate was skipped. Any other exit code is recorded as
  `outcome: partial`, per step 9b.
- `current_task_cache_updated` — `node shared/scripts/task-state.mjs add-active` ran for the new
  issue; `.claude/.current-task` reflects it as a local convenience cache, not as the record of
  occupancy.
- `task_file_created` — `tasks/<issue-number>.md` exists (or already existed and was left alone).
- `history_entry_written` — a new file exists under `./history/` for this run with
  schema-conformant frontmatter.

## Rollback

If the issue was created but a later step failed:

1. Close the issue: `gh issue close <number> --reason not_planned`.
2. Add a comment explaining the rollback: `gh issue comment <number> --body "Auto-rolled-back by task-register due to <reason>."`
3. Undo the local cache entry if it was written: `node shared/scripts/task-state.mjs remove-active --issue <number>`.
4. If a lease was acquired at step 9b, release it: `node .claude/skills/lease/lease.mjs release --key "issue:<repo>#<number>" --reason "rolled back"`.
5. Write a history entry with `outcome: failure`, `proposed_delta:` describing what failed and
   what to fix.

A lease-acquisition failure at step 9b on its own does NOT trigger this rollback — the issue stays
open and tracked, the run is marked `partial`, and the remaining steps still execute (per step 9b).

## History

Each invocation appends an entry to `./history/` per the schema in `.claude/CLAUDE.md`.
