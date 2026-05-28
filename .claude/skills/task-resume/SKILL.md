---
name: task-resume
description: Resume a previously-paused task (remove from .paused-tasks; write .current-task); post resume notice to the GitHub issue via task-update
version: 0.1.0
tags: [meta, framework, task-tracking]
owner_agent: chief-of-staff
---

# task-resume

## When to use

After `task-pause` has set a task aside, to bring it back as the active task. Requires no current active task (you must `task-complete` or `task-pause` the current one first; the framework doesn't support multiple simultaneous active tasks).

## Inputs

- `issue_number` — the issue number of the paused task to resume. Required.

## Steps

**ORDER MATTERS** — `.current-task` must be written BEFORE `task-update` is called (step 6 reads it).

1. **Resolve repo root.** `REPO_ROOT=$(git rev-parse --show-toplevel)`.

2. **Verify `.current-task` is absent.** `[ ! -f "$REPO_ROOT/.claude/.current-task" ]` else abort: "Active task already in flight (#$(cat .claude/.current-task)). Pause or complete it first."

3. **Verify `issue_number` appears in `.paused-tasks`.** `grep -qx "$ISSUE_NUMBER" "$REPO_ROOT/.claude/.paused-tasks"` else abort: "Issue #$ISSUE_NUMBER not found in paused list."

4. **Remove the matching line from `.paused-tasks`.** Use `grep -v` to a temp file then move into place to avoid in-place-edit portability concerns:
   ```bash
   grep -vx "$ISSUE_NUMBER" "$REPO_ROOT/.claude/.paused-tasks" > /tmp/paused.tmp && \
   mv /tmp/paused.tmp "$REPO_ROOT/.claude/.paused-tasks"
   ```
   If `.paused-tasks` is empty after removal, leave it as an empty file (don't delete — keeps the convention discoverable).

5. **Write `issue_number` to `.current-task`.** `echo -n "$ISSUE_NUMBER" > "$REPO_ROOT/.claude/.current-task"`. The `-n` matters — no trailing newline, matching the existing convention.

6. **Post resume notice via `task-update`** (now valid: `.current-task` is set + `in_progress` is an accepted status):
   ```bash
   task-update \
     --message "Task resumed." \
     --key "resumed-$(date -u +%Y%m%dT%H%M%SZ)" \
     --status in_progress
   ```

7. **Print confirmation** to stdout: `Resumed: #<ISSUE_NUMBER>.`

8. **Write history entry** to `.claude/skills/task-resume/history/<YYYY-MM-DD>-<short-run-id>.md`. Include: issue number, resumed-key from step 6.

## Outputs

- `.paused-tasks` updated (line removed).
- `.current-task` written.
- GitHub issue gets a "Task resumed" comment via task-update, with body status flipped to `in_progress`.
- One-line confirmation in chat.
- Two history entries (one in task-resume/, one in task-update/ — same dual-logging convention as task-pause).

## Failure modes

- **Active task already in flight** — `.current-task` exists. Recovery: pause or complete the current one first.
- **Issue not in paused list** — `issue_number` doesn't appear in `.paused-tasks`. Recovery: verify with `cat .claude/.paused-tasks`; check spelling.
- **task-update fails** — propagates (gh auth, network, issue closed). Recovery: by step 6 the framework state is consistent (`.current-task` set, `.paused-tasks` updated); only the GitHub comment failed. Re-run task-update manually or re-run task-resume (the remove-from-paused-list is idempotent in practice — grep -vx on a not-present line is a no-op).
- **Empty paused list** — `.paused-tasks` either absent or empty after removal. The skill leaves the file in place (not deletes); future task-pause runs will work.

## Related

- Sibling skill: `task-pause`
- Sibling skills: `task-register`, `task-update`, `task-complete`
- State files: `.claude/.current-task` (gitignored), `.claude/.paused-tasks` (gitignored)
- Risk: `RISKS.md` Risk 15 (per-machine state)
