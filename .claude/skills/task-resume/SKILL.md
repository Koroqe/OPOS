---
name: task-resume
description: Resume a previously-paused task (remove from .paused-tasks; write .current-task); post resume notice to the GitHub issue via task-update
version: 0.1.0
tags: [meta, framework, task-tracking]
owner_agent: chief-of-staff
---

# task-resume

## When to use

After `task-pause` has set a task aside, to bring it back as an active task. **As of v0.7.0**, `.current-task` is a newline-delimited array — **multi-active tasks are first-class**. You can resume a paused task while other tasks are still active; the resumed issue is appended to the existing `.current-task` array. (Pre-v0.7.0 the framework required `.current-task` to be absent; that guard is removed.)

## Inputs

- `issue_number` — the issue number of the paused task to resume. Required.

## Steps

**ORDER MATTERS** — `.current-task` must be updated BEFORE `task-update` is called (step 6 reads it to determine the active task list).

1. **Resolve repo root.** `REPO_ROOT=$(git rev-parse --show-toplevel)`.

2. **Read `.current-task` as a newline-delimited array** (v0.7.0). Apply defensive read-side filtering. **Multi-active tasks are first-class as of v0.7.0** — the pre-v0.7.0 "verify absent" guard is REMOVED. The only check here is: is `$ISSUE_NUMBER` already in the array? If yes → abort with "Issue #$ISSUE_NUMBER already active." If no → proceed. (Defensive against re-running task-resume on an already-resumed issue.)

3. **Verify the issue is paused in this clone.** `node shared/scripts/task-state.mjs list-paused | grep -qx "$ISSUE_NUMBER"`, else abort: "Issue #$ISSUE_NUMBER not found in paused list."

3b. **Take the lease BEFORE touching any local state (v0.17.0).** This is the cross-machine check `.current-task` could never make — the task may have been resumed on another machine in the meantime:
   ```bash
   node .claude/skills/lease/lease.mjs acquire --key "issue:<repo>#$ISSUE_NUMBER" --intent "resumed"
   ```
   Handle the exit code exactly as in the lease skill's "Calling the lease from another skill" table: `0` proceed · `9` the company has not opted in to leases — print `lease: not configured, gate skipped` and proceed exactly as before · anything else STOP. Exit `2` means another session holds it: abort with its message ("#N is held by <holder> until <time> — it was resumed elsewhere") and change nothing locally.

4. **Remove it from the local paused list.** `node shared/scripts/task-state.mjs remove-paused --issue "$ISSUE_NUMBER"` (the file is kept even when empty), then `gh issue edit "$ISSUE_NUMBER" --repo <repo> --remove-label paused`.

5. **Add it to the local active cache.** `node shared/scripts/task-state.mjs add-active --issue "$ISSUE_NUMBER"`. Other active tasks are untouched.

6. **Post resume notice via `task-update`** (now valid: the resumed issue is in `.current-task`). **As of v0.7.0**, if `.current-task` has multiple active entries, pass `--issue $ISSUE_NUMBER` explicitly so `task-update` doesn't abort on the multi-active disambiguation guard (see task-update step 3):
   ```bash
   task-update \
     --issue "$ISSUE_NUMBER" \
     --message "Task resumed." \
     --key "resumed-$(date -u +%Y%m%dT%H%M%SZ)" \
     --status in_progress
   ```

7. **Print confirmation** to stdout: `Resumed: #<ISSUE_NUMBER>.`

8. **Write history entry** to `.claude/skills/task-resume/history/<YYYY-MM-DD>-<short-run-id>.md`. Include: issue number, resumed-key from step 6.

## Outputs

- `.paused-tasks` updated (line removed).
- The resumed issue **appended to `.current-task`** (v0.7.0 array semantics; multi-active workflow). Other active tasks untouched.
- GitHub issue gets a "Task resumed" comment via task-update, with body status flipped to `in_progress`.
- One-line confirmation in chat.
- Two history entries (one in task-resume/, one in task-update/ — same dual-logging convention as task-pause).

## Failure modes

- **Issue already active** — `$ISSUE_NUMBER` is already in `.current-task`. Recovery: it's already resumed; nothing to do. (Pre-v0.7.0 the framework REFUSED any task-resume when `.current-task` existed AT ALL; that guard is REMOVED. Multi-active tasks are first-class.)
- **Issue not in paused list** — `issue_number` doesn't appear in `.paused-tasks`. Recovery: verify with `cat .claude/.paused-tasks`; check spelling.
- **task-update fails** — propagates (gh auth, network, issue closed). Recovery: by step 6 the framework state is consistent (`.current-task` set, `.paused-tasks` updated); only the GitHub comment failed. Re-run task-update manually or re-run task-resume (the remove-from-paused-list is idempotent in practice — grep -vx on a not-present line is a no-op).
- **Empty paused list** — `.paused-tasks` either absent or empty after removal. The skill leaves the file in place (not deletes); future task-pause runs will work.

## Related

- Sibling skill: `task-pause`
- Sibling skills: `task-register`, `task-update`, `task-complete`
- State files: `.claude/.current-task` (gitignored), `.claude/.paused-tasks` (gitignored)
- Risk: `RISKS.md` Risk 15 (per-machine state)
