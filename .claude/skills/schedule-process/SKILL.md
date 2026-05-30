---
name: schedule-process
description: Register a PROCESS.md's declared schedule as a live cron routine via Claude Code's CronCreate tool. Validates frontmatter, injects an authority prelude, caches the routine id, handles partial-failure rollback.
version: 0.1.0
tags: [meta, framework, scheduling, cron]
owner_agent: ops-manager
tools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash", "CronCreate", "CronList", "CronDelete"]
---

# schedule-process

## When to use

When a `PROCESS.md` has the 4 scheduling frontmatter fields set (`schedule`, `runtime`, `non_interactive`, `authority` — see `ui/scheduling.py`) and the user wants to activate the schedule. Invoke as `/schedule-process <process-name>`.

This skill is a **wrapper around Claude Code's built-in `CronCreate` tool**. It does not implement cron itself; it composes a routine prompt + authority prelude, validates the intent against the in-repo declaration, calls `CronCreate`, and caches the resulting routine id locally for fast lookup by sibling skills (`unschedule-process`, `list-scheduled-processes`).

**Prerequisite:** the user must be logged into Claude Code (`claude login`). The built-in cron tools authenticate against the user's Claude Code subscription. No additional OPOS setup is required.

## Inputs

- `process-name` — kebab-case name of the target process. The skill globs `**/PROCESS.md` for a match against frontmatter `process_name:`. On zero matches: hard-fail. On multiple matches (same-named processes across departments): list each full path; ask the user to pick by full path.

## Steps

1. **Resolve repo root** via `git rev-parse --show-toplevel`.

2. **Locate target PROCESS.md.** Glob `**/PROCESS.md` rooted at repo root; parse each frontmatter; find the one(s) whose `process_name:` equals the input argument. Zero → ABORT with: "no PROCESS.md found with process_name: `<name>`". Multiple → list each match's full path and ask the user to pick by full path (handles same-named processes across departments).

3. **Validate frontmatter.** Call `ui.scheduling.validate_frontmatter(<path>)`. Hard-fail on any error and print the error list verbatim. Do not proceed; do not modify any state.

4. **Read resolved scheduling fields** from frontmatter: `schedule`, `runtime`, `non_interactive`, `authority`.

5. **Ensure `<skill-folder>/scheduled-runs/` exists.** The skill folder is the directory containing the PROCESS.md (e.g., `.claude/skills/<name>/`). If `scheduled-runs/.gitkeep` is absent, create the directory and add a `.gitkeep`. This is the lazy-creation path for existing skills that became scheduled after their initial design.

6. **Compose the routine prompt.** The prompt body sent to `CronCreate` is:
   ```
   <prelude>

   /<process-name>
   ```
   Where `<prelude>` is the verbatim text:
   > You are running as a scheduled routine. Your declared authority is [<comma-list of authority entries>]. Before taking any action, verify it is in this list; refuse and write the refusal to the `scheduled-runs/` entry if not. Record this run in the matching skill's `scheduled-runs/` folder (NOT `history/`).

   This is v1's authority-enforcement mechanism (declared contract via prompt injection + in-band self-check). v1 has no post-run sandbox guard; that's a v2 work item recorded in RISKS.md.

7. **Idempotency check (BEFORE any state change).** Call `CronList`. Look for a routine whose prompt body starts with the same `/<process-name>` slash invocation. If found:
   - **Same cron + same prompt:** print `No change — routine for /<process-name> is already registered (cron: <cron>, id: <id>).` Exit 0. Do NOT write history.
   - **Different cron OR prompt:** surface the diff (declared cron vs live cron, declared authority vs live authority via the prelude string match) and require explicit confirmation before proceeding. On confirm → continue to step 8 (which will create a NEW routine; cleanup of the old happens at step 9b below).

8. **Create the routine.** Invoke `CronCreate` with the cron expression from `schedule:` and the composed prompt from step 6. Capture the returned routine id.

9. **Persist locally + commit:**
   - **9a (always):** append a row to `.claude/scheduled-processes.json` (per-machine cache; gitignored + excluded from copier). Schema: `{"process_name": "...", "routine_id": "...", "cron": "...", "registered_at": "<ISO timestamp>"}`. Create the file with `[]` if absent.
   - **9b (conditional — only if step 7 found a differing existing routine):** call `CronDelete` against the OLD routine id. Remove the OLD row from the local cache. This is the "update" path; OPOS doesn't have an in-place mutation primitive, so update = create-new + delete-old.

10. **Write history entry** to `.claude/skills/schedule-process/history/YYYY-MM-DD-<run-id>.md`. Include: `time: HH:MM`, the target process name + path, the routine id, the cron, the authority list, the idempotency outcome (no-change | created-new | updated-via-recreate), and any rollback events.

11. **Print summary:** `Scheduled: <process-name> on <cron>. Routine id: <id>. Authority: <list>.`

## Order-of-operations + rollback (partial-failure handling)

External state (the live `CronCreate` routine) is modified in step 8 BEFORE local state (the cache write in step 9a). This ordering means a step-9a failure can leave a routine registered with no local cache row. Recovery:

- **If step 9a fails** (disk full, permissions): attempt to delete the just-created routine via `CronDelete`. If THAT also fails, print the routine id prominently with a "manual cleanup needed" warning and write a `partial`-outcome history entry naming the orphan routine id. The user must then either re-run `/schedule-process` (which will detect the orphan via step 7's idempotency check) OR `/unschedule-process <name>` with the orphan id passed explicitly.
- **If step 8 fails with an auth error** (user not logged into Claude Code, expired subscription): print: *"`CronCreate` failed with auth error. Run `claude login` and retry `/schedule-process <name>`. No state has been changed."* Exit non-zero. Do NOT write cache. Do NOT write history.
- **If step 8 fails with any other error** (cron rejection by the runtime, network): print the error verbatim. Write a `failure`-outcome history entry. Exit non-zero. Do NOT write cache.

## Outputs

- One new entry in `CronList` (the live registration; lives in the user's Claude Code account, not in the repo).
- One row appended to `.claude/scheduled-processes.json` (per-machine local cache).
- One history entry under `./history/`.
- One-line stdout confirmation.

## Failure modes

- **Target PROCESS.md not found** — step 2 fail. Recovery: check the process name spelling; use `grep -r 'process_name:' .claude/skills/` to list candidates.
- **Frontmatter validation fail** — step 3 fail. Recovery: fix the frontmatter per the error message; re-run.
- **Auth error** — step 8 fail. Recovery: `claude login`. No state changed; safe to retry.
- **Cache write fail after live routine created** — step 9a partial failure. See rollback above.
- **Idempotency confirmation rejected by user** — step 7 user declines. Recovery: no-op; nothing changed.

## Related

- Process definition: `./PROCESS.md`
- Run history: `./history/`
- Sibling skills: [`unschedule-process`](../unschedule-process/) (cancel), [`list-scheduled-processes`](../list-scheduled-processes/) (drift detection).
- Validator: [`ui/scheduling.py`](../../../ui/scheduling.py).
- Per-run record schema: [`shared/templates/scheduled-run.md.tmpl`](../../../shared/templates/scheduled-run.md.tmpl).
- Owner agent: [`.claude/agents/company/ops-manager.md`](../../agents/company/ops-manager.md).
- External tool: Claude Code's `CronCreate` (documented at https://code.claude.com/docs/en/routines.md — wrapper depends on this tool name; rename would break this skill).
