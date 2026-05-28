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

**Inputs may be gathered conversationally** over multiple AskUserQuestion turns before the GitHub call — the skill doesn't require them all in one CLI invocation. In practice, the calling agent (chief-of-staff) often clarifies title, depts, and goal interactively before making the actual `gh issue create` call.

## Inputs

- `title` — short title for the GitHub issue (required).
- `depts` — comma-separated department names; lowercased for label normalization (required).
- `plan_file` — optional path to a plan file (e.g. under `~/.claude/plans/`).
- `goal` — optional one-paragraph goal. Default: prompt user inline.
- `quiet_label_creation` — optional bool, default false. When true, suppress per-label warnings from steps 6-7 and emit a single summary line at the end instead ("Auto-created N labels: dept:engineering, dept:company, task").

## Steps

1. **Check for upstream updates.** Invoke `check-for-updates` (silent unless an update is available; cached 6h). Best-effort — failures do not block this skill's run. If the user sees an update notice, they may want to invoke `/sync-from-core` after this skill completes.
2. Resolve repo root: `REPO_ROOT=$(git rev-parse --show-toplevel)`. All file paths in this skill are anchored to `$REPO_ROOT`.
3. Read `$REPO_ROOT/.claude/task-tracking.config.json`. Validate `repo` is non-empty.
4. Refuse if `$REPO_ROOT/.claude/.current-task` already exists; print the existing issue number and instructions: **complete via `task-complete`**, **pause via `task-pause`** (recommended — preserves the issue for later resume), or (rarely) manually clear via `rm $REPO_ROOT/.claude/.current-task`. The `task-pause` option is new in v0.2.0 — it's the canonical fix for the multi-task-in-flight pattern that previously required manual file deletion.
5. `gh repo view <repo> --json visibility` — if visibility is `public`, print a WARNING to stdout (do not block).
6. Normalize each `--depts` value: trim whitespace and `tr A-Z a-z` (lowercase). For each normalized dept name, ensure label `dept:<name>` exists; create with `gh label create dept:<name> --description "Auto-created by task-register"` if missing. **Warning behavior depends on `quiet_label_creation`**: when false (default), print one warning line per created label AND record each in the history-entry body. When true, accumulate the created labels in a list and defer the announcement to step 11's summary; still record in the history-entry body.
7. Ensure flat label `task` exists; create if missing (same warning behavior — per `quiet_label_creation`).
8. Render the issue body from `shared/templates/task-issue.md.tmpl`, substituting `{{TITLE}}`, `{{DEPARTMENTS}}` (joined human-friendly list), `{{INITIATED_BY}}` (= `chief-of-staff` + ISO date), `{{PLAN_LINK}}`, `{{GOAL}}`. Leave the `<!-- progress-log -->` marker intact (it serves as an anchor for the optional v1 body-insertion approach; v0 uses comments).
9. Create the issue and capture its URL/number explicitly from JSON output: `gh issue create --repo <repo> --title "<title>" --body "<rendered>" --label task --label dept:<each> --json url,number --jq '.url'`. The `--jq '.url'` extracts just the URL to stdout (issue number is parseable from the URL's last path segment, e.g. `/issues/4` → `4`); alternatively call again with `--jq '.number'` if a separate capture is desired. Do NOT rely on the bare `gh issue create` stdout-URL format — different gh versions print slightly different formats, but `--json` output is stable.
10. Write the issue number (digits only) to `$REPO_ROOT/.claude/.current-task`.
11. **Create the task file from the TASK.md.tmpl template.** Render `shared/templates/TASK.md.tmpl` into `$REPO_ROOT/tasks/<issue-number>.md`, substituting: `<<ISSUE_NUMBER>>` (digits), `<<TITLE>>` (the issue title), `<<OWNER_AGENT>>` (= `chief-of-staff`), `<<DEPARTMENTS>>` (joined comma list), `<<STATE>>` (= `active`), `<<CREATED_DATE>>` (today's ISO date), `<<COMPLETED_DATE>>` (blank), `<<SUCCESS_CRITERIA>>` (parsed from issue body's "## Acceptance criteria" section if structured; empty list `[]` otherwise), `<<DEADLINE>>` (blank), `<<RELATED_SKILLS>>` (blank `[]` unless caller specifies). Skip silently if `tasks/<issue-number>.md` already exists (idempotency for retried invocations — don't overwrite). Create the `tasks/` directory first via `mkdir -p` if absent (consumer-side first task creates it; framework repo already has it).
12. Print a one-line summary: `Tracked: #<number> (<url>) — depts: <list>`. **If `quiet_label_creation` was true and labels were created**, append: ` — auto-created N labels: <comma-separated list>`.
13. **Write history entry** to `$REPO_ROOT/.claude/skills/task-register/history/<YYYY-MM-DD>-<short-run-id>.md` per the root `CLAUDE.md` schema. Include in body: the issue URL, depts, plan_file, the path to the task file created in step 11, and the full list of label-creation events from steps 6-7 (regardless of `quiet_label_creation` — the history-entry body always records them for audit).

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
