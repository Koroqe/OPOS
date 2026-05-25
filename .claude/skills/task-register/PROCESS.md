---
process_name: task-register
owner: chief-of-staff
collaborators: [eng-lead]
inputs: [title, depts, plan_file, goal]
success_criteria: [update_check_attempted, issue_created, labels_applied_normalized, current_task_file_written_at_repo_root, config_validated, gh_auth_confirmed, history_entry_written]
slo: "30 seconds"
version: 0.1.0
---

# task-register

## Narrative

Opens a GitHub issue for a newly initiated task. The first of three sibling skills in the task-tracking lifecycle (`task-register` → `task-update` → `task-complete`). Owned by `chief-of-staff`, with `eng-lead` listed as collaborator since the GitHub integration is engineering's domain (gh CLI conventions, label hygiene, the `Refs: #` linking convention used downstream by `task-complete`).

## Pre-conditions

- `gh` CLI installed and authenticated (`gh auth status` exits 0).
- `<repo-root>/.claude/.current-task` does NOT exist (no other task in flight).
- `<repo-root>/.claude/task-tracking.config.json` exists and `repo` is non-empty.
- The target repo (per config) exists, has issues enabled, and the authenticated user can create issues.

## Steps

Mirrors the 11-step procedure in SKILL.md:

1. Resolve repo root.
2. Read and validate config.
3. Check `.current-task` is absent.
4. Privacy check via `gh repo view`.
5. Normalize and ensure department labels.
6. Ensure the flat `task` label.
7. Render the issue body from the template.
8. Create the issue via `gh issue create`.
9. Persist the issue number to `.current-task`.
10. Print confirmation.
11. Write history entry.

## Done when

- `issue_created` — `gh issue create` returned a number; the issue is visible at the URL.
- `labels_applied_normalized` — the issue has the flat `task` label AND a `dept:<name>` label for each (lowercased) input department.
- `current_task_file_written_at_repo_root` — `<repo-root>/.claude/.current-task` exists and contains just the issue number (no whitespace).
- `config_validated` — the config file parsed and `repo` was non-empty.
- `gh_auth_confirmed` — `gh auth status` succeeded.
- `history_entry_written` — a new file exists under `./history/` for this run with schema-conformant frontmatter.

## Rollback

If the issue was created but a later step failed:

1. Close the issue: `gh issue close <number> --reason not_planned`.
2. Add a comment explaining the rollback: `gh issue comment <number> --body "Auto-rolled-back by task-register due to <reason>."`
3. Delete `.current-task` if it was written.
4. Write a history entry with `outcome: failure`, `proposed_delta:` describing what failed and what to fix.

## History

Each invocation appends an entry to `./history/` per the schema in root `CLAUDE.md`.
