---
name: task-pause
description: Pause the current task (append to .paused-tasks; clear .current-task); post pause notice to the GitHub issue via task-update first
version: 0.1.0
tags: [meta, framework, task-tracking]
owner_agent: chief-of-staff
---

# task-pause

## When to use

When you want to set the current task aside to work on something else, without closing the GitHub issue. The paused issue is recorded in `.claude/.paused-tasks` for later resumption via `task-resume`. Replaces the "manually `rm .current-task` and remember the issue number" workaround that's been used 4× across prior releases.

## Inputs

None. Operates on the currently-active task (`.claude/.current-task`).

## Steps

**ORDER MATTERS** — `task-update` (step 3) must run BEFORE `.current-task` is deleted (step 5), because `task-update` reads `.current-task` to know which issue to comment on. Reversed order = task-update fails with "no active task."

1. **Resolve repo root.** `REPO_ROOT=$(git rev-parse --show-toplevel)`.

2. **Read `.current-task`; error if absent.** `[ -f "$REPO_ROOT/.claude/.current-task" ]` else abort with "No active task to pause." Capture as `$ISSUE`.

3. **Post pause notice via `task-update`** (while `.current-task` still exists so task-update can read it):
   ```bash
   task-update \
     --message "Task paused by user; will resume via /task-resume $ISSUE." \
     --key "paused-$(date -u +%Y%m%dT%H%M%SZ)" \
     --status blocked
   ```
   Why `--status blocked` not `--status paused`: `task-update`'s allowed-status set is `in_progress | blocked | review`. "Paused" is a framework-internal state tracked via `.paused-tasks` membership; on GitHub the issue shows `**Status:** blocked` (the closest existing semantic — blocked-by-other-priorities, awaiting resume).

4. **Append the issue number to `.paused-tasks`.** Create the file if absent. One issue number per line:
   ```bash
   echo "$ISSUE" >> "$REPO_ROOT/.claude/.paused-tasks"
   ```

5. **Delete `.current-task`.** `rm "$REPO_ROOT/.claude/.current-task"`.

6. **Print confirmation** to stdout: `Paused: #<ISSUE>. Resume with /task-resume <ISSUE>.`

7. **Write history entry** to `.claude/skills/task-pause/history/<YYYY-MM-DD>-<short-run-id>.md`. Include: issue number, the paused-key from step 3, current state of `.paused-tasks` (line count after append).

   Note: a SECOND history entry is created in `.claude/skills/task-update/history/` by the step-3 call. That's INTENTIONAL — both events are auditable independently (the pause event itself, and the GitHub comment).

## Outputs

- `.paused-tasks` updated (new line appended).
- `.current-task` deleted.
- GitHub issue gets a "Task paused" comment via task-update, with body status flipped to `blocked`.
- One-line confirmation in chat.
- Two history entries (one in task-pause/, one in task-update/ — see step 7 note).

## Failure modes

- **No active task** — `.current-task` absent. Recovery: nothing to pause; user can list paused tasks via `cat .claude/.paused-tasks`.
- **task-update fails** — propagates (e.g. gh auth, network, issue closed). Recovery: fix the root cause and re-run task-pause. The pause is NOT half-applied — task-update runs FIRST, so failures abort before `.paused-tasks` and `.current-task` are touched.
- **`.paused-tasks` already contains this issue** — defensive: skip the append (don't duplicate). Issue may have been paused before via an aborted run; the `rm .current-task` and confirmation still proceed.

## Related

- Sibling skill: `task-resume`
- Sibling skills: `task-register`, `task-update`, `task-complete`
- State files: `.claude/.current-task` (gitignored), `.claude/.paused-tasks` (gitignored — new in v0.2.0)
- Risk: `RISKS.md` Risk 15 (per-machine state)
