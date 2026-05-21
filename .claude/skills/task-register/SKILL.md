---
name: task-register
description: Open a GitHub issue tracking a newly initiated task; record the issue number locally so updates can reference it
version: 0.1.0
tags: [meta, framework, task-tracking, github]
owner_agent: chief-of-staff
---

# task-register

## When to use

At the start of a NEW task — NOT a fix or continuation of in-flight work. The user explicitly invokes `/task-register "<title>" --depts <comma-list> [--plan-file <path>] [--goal "<text>"]`. If a task is already in flight (the repo-root `.claude/.current-task` exists), this skill refuses to start and asks the user to complete or abandon first.

## Inputs

- `title` — short title for the GitHub issue (required).
- `depts` — comma-separated department names; lowercased for label normalization (required).
- `plan_file` — optional path to a plan file (e.g. under `~/.claude/plans/`).
- `goal` — optional one-paragraph goal. Default: prompt user inline.

## Steps

1. Resolve repo root: `REPO_ROOT=$(git rev-parse --show-toplevel)`. All file paths in this skill are anchored to `$REPO_ROOT`.
2. Read `$REPO_ROOT/.claude/task-tracking.config.json`. Validate `repo` is non-empty.
3. Refuse if `$REPO_ROOT/.claude/.current-task` already exists; print the existing issue number and instructions to `task-complete` or manually clear the file (no `task-abandon` skill in v0).
4. `gh repo view <repo> --json visibility` — if visibility is `public`, print a WARNING to stdout (do not block).
5. Normalize each `--depts` value: trim whitespace and `tr A-Z a-z` (lowercase). For each normalized dept name, ensure label `dept:<name>` exists; create with `gh label create dept:<name> --description "Auto-created by task-register"` if missing — print a warning to stdout naming the created label AND record the label-creation event in the history-entry body.
6. Ensure flat label `task` exists; create if missing (same warning convention).
7. Render the issue body from `shared/templates/task-issue.md.tmpl`, substituting `{{TITLE}}`, `{{DEPARTMENTS}}` (joined human-friendly list), `{{INITIATED_BY}}` (= `chief-of-staff` + ISO date), `{{PLAN_LINK}}`, `{{GOAL}}`. Leave the `<!-- progress-log -->` marker intact (it serves as an anchor for the optional v1 body-insertion approach; v0 uses comments).
8. `gh issue create --repo <repo> --title "<title>" --body "<rendered>" --label task --label dept:<each> --json url,number` — capture the returned issue number and URL.
9. Write the issue number (digits only) to `$REPO_ROOT/.claude/.current-task`.
10. Print a one-line summary: `Tracked: #<number> (<url>) — depts: <list>`.
11. **Write history entry** to `$REPO_ROOT/.claude/skills/task-register/history/<YYYY-MM-DD>-<short-run-id>.md` per the root `CLAUDE.md` schema. Include in body: the issue URL, depts, plan_file, and any label-creation warnings from steps 5-6.

## Outputs

- A new GitHub issue on the configured repo.
- A `.current-task` file at the repo root holding the issue number.
- A one-line confirmation in chat.
- A history entry under `./history/`.

## Failure modes

- **`gh` not authenticated** → exit with `gh auth login` remediation; write `outcome: failure` history entry.
- **Repo without issues enabled or without write perms** → exit with the gh error verbatim; `failure` entry.
- **Config missing or `repo` empty** → exit with the path to the config and example contents; `failure` entry.
- **Network or rate-limit** → retry once with 2-second backoff; if still failing, surface; `partial` entry.
- **`.current-task` already exists** → see step 3; `failure` entry (the run produced no GitHub artifact).
- **Label-creation race** (two concurrent invocations creating the same label) — `gh label create` will fail with "already exists" on the loser; treat as success.

## Related

- Process definition: `./PROCESS.md`
- Run history: `./history/`
- Sibling skills: `task-update`, `task-complete`
- Config: `.claude/task-tracking.config.json`
- Template: `shared/templates/task-issue.md.tmpl`
