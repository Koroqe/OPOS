---
name: task-register
description: Open a GitHub issue tracking a newly initiated task; record the issue number locally so updates can reference it
version: 0.1.0
tags: [meta, framework, task-tracking, github]
owner_agent: chief-of-staff
---

# task-register

## When to use

At the start of a NEW task — NOT a fix or continuation of in-flight work.

**The steward invokes this itself; it is not a command the user is expected to type.** When `chief-of-staff` goal-decomposition classifies an opening message as a NEW task, it runs this skill at Notice tier (do it, mention it) — see the steward's "Goal decomposition pattern" step 2. A user MAY still invoke `/task-register "<title>" --depts <comma-list> [--plan-file <path>] [--goal "<text>"]` directly, but nothing depends on them doing so.

**Multi-active tasks are first-class (v0.7.0).** An existing `.claude/.current-task` does NOT block a new registration — the pre-v0.7.0 refuse-guard was removed (see step 4); parallel sessions each open their own task without colliding.

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
4. **Parse current active-task array.** Read `$REPO_ROOT/.claude/.current-task` as a **newline-delimited array of integers** (v0.7.0 array semantics; v0.6.x single-task content parses as 1-element array — fully backwards-compatible). If file is absent or empty → `CURRENT_TASKS = []`. Apply defensive read-side filtering: drop any line that isn't pure digits (handles partial-write garbage from the rare intra-machine concurrent-register race documented in RISKS Risk 30; v0.8.x candidate is proper `flock`). Continue regardless of count — **multi-active tasks are first-class as of v0.7.0**; parallel Claude sessions can each open a fresh task without colliding. The pre-v0.7.0 "refuse if .current-task already exists" guard is REMOVED; the new duplicate check happens at step 10 against the candidate issue number after `gh issue create`.
5. `gh repo view <repo> --json visibility` — if visibility is `public`, print a WARNING to stdout (do not block).
6. Normalize each `--depts` value: trim whitespace and `tr A-Z a-z` (lowercase). For each normalized dept name, ensure label `dept:<name>` exists; create with `gh label create dept:<name> --description "Auto-created by task-register"` if missing. **Warning behavior depends on `quiet_label_creation`**: when false (default), print one warning line per created label AND record each in the history-entry body. When true, accumulate the created labels in a list and defer the announcement to step 11's summary; still record in the history-entry body.
7. Ensure flat label `task` exists; create if missing (same warning behavior — per `quiet_label_creation`).
8. Render the issue body from `shared/templates/task-issue.md.tmpl`, substituting `{{TITLE}}`, `{{DEPARTMENTS}}` (joined human-friendly list), `{{INITIATED_BY}}` (= `chief-of-staff` + ISO date), `{{PLAN_LINK}}`, `{{GOAL}}`. Leave the `<!-- progress-log -->` marker intact (it serves as an anchor for the optional v1 body-insertion approach; v0 uses comments).
9. Create the issue and capture the URL from stdout. **`gh issue create` does NOT support `--json`** (only `gh issue view` / `gh issue list` do — this was a documented-but-wrong pattern in v0.1.x–v0.2.0 fixed in v0.3.0 after issue #6's task-register run hit the bug). The working pattern:
   ```bash
   URL=$(gh issue create --repo "$REPO" --title "$TITLE" --body-file /tmp/body.md \
          --label task $(printf -- '--label dept:%s ' "${DEPTS[@]}"))
   ISSUE_NUM=$(basename "$URL")
   ```
   Prefer `--body-file` over `--body "$RENDERED"` to avoid shell-quoting hell with multi-line bodies. The `URL` capture is the bare `gh issue create` stdout (one line, just the URL — stable across recent gh versions); `basename` parses the trailing `/N` segment.
10. **Append the new issue number to `$REPO_ROOT/.claude/.current-task`** (array semantics as of v0.7.0). Use `echo $ISSUE_NUM >> "$REPO_ROOT/.claude/.current-task"`. **Defensive duplicate check** (uses the array parsed at step 4): if `$ISSUE_NUM` is already in `CURRENT_TASKS`, skip the append silently and note in the history-entry body. This protects against re-runs invoked with an explicit `--issue` referencing an already-tracked issue, and against the rare intra-machine race where another session's step 9 completed and appended between this run's step 4 and step 10. The append is best-effort — partial writes (a half-written digit, a missing newline) are silently filtered at every subsequent read via step 4's defensive parser.
11. **Create the task file from the TASK.md.tmpl template.** Render `shared/templates/TASK.md.tmpl` into `$REPO_ROOT/tasks/<issue-number>.md`, substituting: `<<ISSUE_NUMBER>>` (digits), `<<TITLE>>` (the issue title), `<<OWNER_AGENT>>` (= `chief-of-staff`), `<<DEPARTMENTS>>` (joined comma list), `<<STATE>>` (= `active`), `<<CREATED_DATE>>` (today's ISO date), `<<COMPLETED_DATE>>` (blank), `<<SUCCESS_CRITERIA>>` (parsed from issue body's "## Acceptance criteria" section if structured; empty list `[]` otherwise), `<<DEADLINE>>` (blank), `<<RELATED_SKILLS>>` (blank `[]` unless caller specifies). Skip silently if `tasks/<issue-number>.md` already exists (idempotency for retried invocations — don't overwrite). Create the `tasks/` directory first via `mkdir -p` if absent (consumer-side first task creates it; framework repo already has it).
12. Print a one-line summary: `Tracked: #<number> (<url>) — depts: <list>`. **If `quiet_label_creation` was true and labels were created**, append: ` — auto-created N labels: <comma-separated list>`.
13. **Write history entry** to `$REPO_ROOT/.claude/skills/task-register/history/<YYYY-MM-DD>-<short-run-id>.md` per the root `CLAUDE.md` schema. Include in body: the issue URL, depts, plan_file, the path to the task file created in step 11, the full list of label-creation events from steps 6-7 (regardless of `quiet_label_creation` — the history-entry body always records them for audit), AND the **pre-register + post-register `.current-task` array contents** (v0.7.0 addition — audit trail for parallel workflows: knowing whether the run added to an empty array or appended to N existing tasks is the signal future history reviewers need to reconstruct what was in flight).

## Outputs

- A new GitHub issue on the configured repo.
- The new issue number **appended** to `$REPO_ROOT/.claude/.current-task` (v0.7.0 array semantics; newline-delimited list of active issues — file may have multiple entries from prior `task-register` invocations).
- A one-line confirmation in chat.
- A history entry under `./history/`.

## Failure modes

- **`gh` not authenticated** → exit with `gh auth login` remediation; write `outcome: failure` history entry.
- **Repo without issues enabled or without write perms** → exit with the gh error verbatim; `failure` entry.
- **Config missing or `repo` empty** → exit with the path to the config and example contents; `failure` entry.
- **Network or rate-limit** → retry once with 2-second backoff; if still failing, surface; `partial` entry.
- **Duplicate issue in active list** → the candidate issue number is already in `.current-task` (v0.7.0 array semantics). Likely a re-run via `--issue` on an already-tracked issue, OR a tight race where another session's step 9 finished and appended between this run's step 4 parse and step 10 append. Recovery: skip the append silently; the existing entry is correct. The run produces NO new GitHub artifact (since the issue was already registered) and writes a `partial` history entry naming the duplicate. (The pre-v0.7.0 "`.current-task` already exists" refuse-all-runs failure mode is GONE — multi-active tasks are first-class.)
- **Label-creation race** (two concurrent invocations creating the same label) — `gh label create` will fail with "already exists" on the loser; treat as success.

## Related

- Process definition: `./PROCESS.md`
- Run history: `./history/`
- Sibling skills: `task-update`, `task-complete`
- Config: `.claude/task-tracking.config.json`
- Template: `shared/templates/task-issue.md.tmpl`
