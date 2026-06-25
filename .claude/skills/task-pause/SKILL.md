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

4. **Append the issue number to `.paused-tasks`.** Create the file if absent. One issue number per line:
   ```bash
   echo "$ISSUE" >> "$REPO_ROOT/.claude/.paused-tasks"
   ```

5. **Remove the paused issue from `.current-task`** (v0.7.0 array semantics; v0.7.2 Python one-liner rewrite — same pattern as `task-complete` step 14):
   ```bash
   ISSUE="$ISSUE" TARGET="$REPO_ROOT/.claude/.current-task" python3 -c '
   import os, sys
   target = os.environ["TARGET"]
   issue = os.environ["ISSUE"]
   if not os.path.exists(target):
       sys.exit(0)  # File already absent — desired end state achieved.
   with open(target) as f:
       lines = [l for l in f.read().splitlines() if l.strip() and l.strip() != issue]
   if lines:
       with open(target, "w") as f:
           f.write("\n".join(lines) + "\n")
   else:
       os.remove(target)
   '
   ```
   
   **Why Python (v0.7.2 rewrite):** replaces the v0.7.0 shell-chain pattern that was reproducibly flaky (same root-cause-unknown anomaly that surfaced in `task-complete` step 14 across v0.7.0 + v0.7.1 — see CHANGELOG v0.7.2 Fixed section for the historical pattern and bug class). The Python one-liner eliminates the failure class by construction: single process, env-passed variable values, atomic write semantics, defensive `os.path.exists` short-circuit. Identical semantics to the v0.7.0 pattern — only the execution mechanism is more robust. **Backwards-compat preserved:** when the array had exactly 1 element going in, the Python script's `lines = []` branch fires and `os.remove(target)` is called → file-absent state matches v0.6.x semantics. Other active tasks in the multi-active workflow are untouched.

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
