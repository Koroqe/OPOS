---
name: task-update
description: Append a progress update comment to the active task's GitHub issue; patch the status line in the issue body
version: 0.1.0
tags: [meta, framework, task-tracking, github]
owner_agent: chief-of-staff
---

# task-update

## When to use

Mid-execution, to record meaningful progress: a slice committed, a blocker encountered, a status flip (in_progress → blocked). NOT for chatty updates. Each invocation requires an idempotency `--key` so re-running the same update is a no-op.

## Inputs

- `message` — the update body (required; markdown).
- `key` — idempotency key (required; e.g. a commit SHA or a slice number — anything stable).
- `status` — optional new status: `in_progress | blocked | review`. Default: leave the body status line unchanged.
- `issue` — optional override; default: read the active issue number from `<repo-root>/.claude/.current-task`. **As of v0.7.0** `.current-task` is a newline-delimited array of active issue numbers; this skill auto-picks when exactly 1 is active and REQUIRES `--issue` when 2+ are active (see step 3).

## Steps

1. **Check for upstream updates.** Invoke `check-for-updates` (silent unless an update is available; cached 6h). Best-effort — failures do not block this skill's run.
2. Resolve repo root via `git rev-parse --show-toplevel`.
3. **Read `$REPO_ROOT/.claude/.current-task` as a newline-delimited array** of active task issue numbers (v0.7.0 array semantics; v0.6.x single-task content parses as 1-element array — fully backwards-compatible). Apply defensive read-side filtering (drop non-digit lines per Risk 30). Then determine the target issue number:
   - If `--issue <N>` was provided → use it directly. (Works regardless of array size; lets a batch script or external caller target a specific issue without parsing the active list.)
   - Else if the array has **EXACTLY 1 entry** → use that entry. **This preserves v0.6.x single-task workflow behavior; users who only ever work on one task at a time see no change.**
   - Else if the array has **>1 entries** (multi-active parallel-session workflow as of v0.7.0) → ABORT with: `Multiple active tasks: #<comma-list>. Pass --issue <N> to specify which one to update.` Do not guess; the user must disambiguate.
   - Else (array empty / file absent) → ABORT with: `No active task. Open one with task-register, or pass --issue <N> explicitly.`
4. Read `$REPO_ROOT/.claude/task-tracking.config.json`. Validate `repo`.
5. `gh issue view <number> --repo <repo> --json comments,state` — abort if state is `CLOSED` (the user must reopen with `gh issue reopen` or invoke `task-complete` instead).
6. Scan the last 50 comments for the HTML marker `<!-- update-key: <key> -->`. If found, exit 0 silently with the message `duplicate key, no-op` (this is correct behavior, not an error). Still write a history entry with `outcome: partial` recording the skipped invocation.
7. Render the comment from `shared/templates/task-update.md.tmpl`, substituting `{{KEY}}`, `{{TIMESTAMP}}` (ISO 8601, UTC), `{{STATUS_LINE}}` (either `**Status:** <new>` or empty), `{{MESSAGE}}`.
8. `gh issue comment <number> --repo <repo> --body "<rendered>"`.
9. If `--status` was provided: fetch the issue body via `gh issue view <number> --json body`, run a regex substitution on the canonical `**Status:** ...` line, write back via `gh issue edit <number> --body-file -`. The regex (`/^\*\*Status:\*\* .+$/m` — single-line match, anchored at line start, multiline mode) is implemented in a portable Python one-liner, parameterized via shell env var to avoid quoting issues:

   ```bash
   NEW_STATUS=review
   gh issue view <number> --repo <repo> --json body --jq '.body' \
     | python3 -c "import re,sys,os; b=sys.stdin.read(); new=re.sub(r'^\*\*Status:\*\* .+$', f'**Status:** {os.environ[\"NEW_STATUS\"]}', b, count=1, flags=re.M); print(new, end=''); sys.exit(0 if new != b else 1)" \
     | gh issue edit <number> --repo <repo> --body-file -
   ```

   The Python helper exits non-zero if the regex didn't match (body was hand-edited and lost the canonical line) — the pipeline then short-circuits before the `gh issue edit` runs. Treat non-zero exit as ABORT with the message: `issue body no longer has the canonical Status line — restore the line or skip --status`.

   `sed` and `perl` work too (the regex is portable); Python is the most portable across macOS/Linux without flag quirks. The pipeline captures the new status via `os.environ['NEW_STATUS']` rather than f-string-interpolating the value into the shell command — this avoids any shell-quoting issues if the status string contains spaces or special characters.

   NOTE: this is a read-modify-write against the API; if a human edits the body between view and edit, their change is silently lost. Documented as a known v0 race.
10. Print one-line confirmation: `Updated: #<number> — key=<key>`.
11. **Write history entry** to `$REPO_ROOT/.claude/skills/task-update/history/<YYYY-MM-DD>-<short-run-id>.md`. Include in body: the issue number, the key, the status change (if any), and a one-line preview of the message.

## Outputs

- A new comment on the issue (OR no-op if the key is a duplicate).
- Optionally a patched body status line.
- A history entry.

## Failure modes

- **`.current-task` absent/empty and no `--issue`** → exit with instruction to run `task-register` first; `failure` entry.
- **Ambiguous active task** (v0.7.0) → `.current-task` array has >1 entries AND `--issue` was not supplied. Recovery: re-run with `--issue <N>` naming one of the active issues; the abort message lists them all. `failure` entry.
- **Issue is CLOSED** → exit; the user must reopen or run `task-complete`; `failure` entry.
- **Duplicate idempotency key** → silent no-op; `partial` entry for traceability.
- **Status-line regex no-match** → abort per step 8; `failure` entry.
- **Lost-update race** (human edits body between view and edit) → undetected in v0; documented as a known limitation.
- **Network or rate-limit** → retry once with 2-second backoff; surface on second failure; `partial` entry.

## Related

- Process definition: `./PROCESS.md`
- Run history: `./history/`
- Sibling skills: `task-register`, `task-complete`
- Template: `shared/templates/task-update.md.tmpl`
