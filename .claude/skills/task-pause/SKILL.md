---
name: task-pause
description: Pause an active task (append to .paused-tasks; remove from .current-task array); post pause notice to the GitHub issue via task-update first
version: 0.1.0
tags: [meta, framework, task-tracking]
owner_agent: chief-of-staff
---

# task-pause

## When to use

When you want to set the current task aside to work on something else, without closing the GitHub issue. The paused issue is recorded in `.claude/.paused-tasks` for later resumption via `task-resume`. Replaces the "manually `rm .current-task` and remember the issue number" workaround that's been used 4× across prior releases.

## Inputs

- `issue` — optional override. **As of v0.7.0** `.current-task` is a newline-delimited array; this skill auto-picks when exactly 1 is active and REQUIRES `--issue` when 2+ are active (see step 2).

## Steps

**ORDER MATTERS** — `task-update` (step 3) must run BEFORE the issue is removed from `.current-task` (step 5), because `task-update` reads `.current-task` to know which issue to comment on. Reversed order = task-update may pick the wrong target (or fail if this was the only active task).

1. **Resolve repo root.** `REPO_ROOT=$(git rev-parse --show-toplevel)`.

2. **Read `.current-task` as a newline-delimited array** (v0.7.0 array semantics; v0.6.x single-task content parses as 1-element array — fully backwards-compatible). Apply defensive read-side filtering (drop non-digit lines per Risk 30). Then determine the target issue:
   - If `--issue <N>` was provided → use it directly. (Must be present in the array; if absent, ABORT with `Issue #N not in active list. Active: #<list>`.)
   - Else if the array has **EXACTLY 1 entry** → use it (v0.6.x single-task workflow preserved).
   - Else if the array has **>1 entries** → ABORT with `Multiple active tasks: #<comma-list>. Pass --issue <N> to specify which one to pause.`
   - Else (empty/absent) → ABORT with "No active task to pause."
   Capture as `$ISSUE`. **Do not modify `.current-task` here** — the removal happens at step 5 AFTER step 3's task-update has run.

3. **Post pause notice via `task-update`** (while `.current-task` still exists so task-update can read it):
   ```bash
   task-update \
     --message "Task paused by user; will resume via /task-resume $ISSUE." \
     --key "paused-$(date -u +%Y%m%dT%H%M%SZ)" \
     --status blocked
   ```
   Why `--status blocked` not `--status paused`: `task-update`'s allowed-status set is `in_progress | blocked | review`. "Paused" is a framework-internal state tracked via `.paused-tasks` membership; on GitHub the issue shows `**Status:** blocked` (the closest existing semantic — blocked-by-other-priorities, awaiting resume).

3b. **Yield the lease and mark the issue paused (v0.17.0).** A paused task is by definition not occupied, so another session may pick it up:
   ```bash
   node .claude/skills/lease/lease.mjs release --key "issue:<repo>#$ISSUE" --state yielded --reason "paused"
   gh label create paused --repo <repo> --color C5DEF5 --description "Live task, not being worked on right now" 2>/dev/null
   gh issue edit "$ISSUE" --repo <repo> --add-label paused
   ```
   Exit `9` from the release is fine. The `paused` label is what other machines see; `.paused-tasks` below is only this clone's memory.

4. **Record it in the local paused list.** `node shared/scripts/task-state.mjs add-paused --issue "$ISSUE"`.

5. **Remove it from the local active cache.** `node shared/scripts/task-state.mjs remove-active --issue "$ISSUE"`. Other active tasks are untouched; the file is removed when its last entry goes.

6. **Print confirmation** to stdout: `Paused: #<ISSUE>. Resume with /task-resume <ISSUE>.`

7. **Write history entry** to `.claude/skills/task-pause/history/<YYYY-MM-DD>-<short-run-id>.md`. Include: issue number, the paused-key from step 3, current state of `.paused-tasks` (line count after append).

   Note: a SECOND history entry is created in `.claude/skills/task-update/history/` by the step-3 call. That's INTENTIONAL — both events are auditable independently (the pause event itself, and the GitHub comment).

## Outputs

- `.paused-tasks` updated (new line appended).
- The paused issue **removed from `.current-task`** (v0.7.0 array semantics). If the array becomes empty, the file is optionally `rm`'d; other active tasks (in the multi-active workflow) are untouched.
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
