---
name: unschedule-process
description: Cancel a live cron routine via Claude Code's CronDelete tool. Reads routine id from the local cache (or falls back to CronList prompt-prefix search). Leaves PROCESS.md frontmatter untouched.
version: 0.1.0
tags: [meta, framework, scheduling, cron]
owner_agent: ops-manager
tools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash", "CronList", "CronDelete"]
---

# unschedule-process

## When to use

When the user wants to stop a previously-scheduled process from firing. Invoke as `/unschedule-process <process-name>`.

The skill wraps Claude Code's built-in `CronDelete` tool. It does NOT edit the source `PROCESS.md`'s scheduling frontmatter — the declaration remains in place so the user can re-schedule later by re-running `/schedule-process`. To permanently retire the schedule, the user manually removes the 4 scheduling fields from PROCESS.md after unscheduling.

**`runtime: cloud` branch (v0.14):** cloud routines **cannot be deleted via the API** — unscheduling disables them: `RemoteTrigger {action: "update", trigger_id: <from the cache row's `cloud:` prefix, or matched by name `opos-<process-name>` via `{action: "list"}`>, body: {"enabled": false}}`. Remove the cache row and tell the user that permanent deletion is done by them at https://claude.ai/code/routines. Re-scheduling later re-enables in place (`/schedule-process` step 4b's idempotency path).

**`runtime: gha` branch (v0.10):** for a process whose cache row (or workflow-file presence) shows the GHA runtime, unscheduling = delete `.github/workflows/opos-<process-name>.yml` and commit the deletion (`chore(core): unregister opos-<name> gha workflow`) — a sensitive-path change, confirmed with the user. `CronDelete` is not involved. Mixed states (both a workflow file and a live CronCreate routine) → remove both, noting the one-driver rule was violated.

**Prerequisite:** same as `schedule-process` — the user must be logged into Claude Code (`claude login`).

## Inputs

- `process-name` — kebab-case name of the previously-scheduled process. The skill first looks up the routine id in the local cache `.claude/scheduled-processes.json`; if not found (e.g., on a fresh machine where the cache hasn't been seeded), it falls back to `CronList` and matches by prompt prefix `/<process-name>`.

## Steps

1. **Resolve repo root** via `git rev-parse --show-toplevel`.

2. **Look up routine id (cache fast-path).** Read `.claude/scheduled-processes.json`. Find the row where `process_name == <input>`. If found: take `routine_id` and proceed to step 4.

3. **Look up routine id (fallback path).** If the cache row was absent (fresh machine, deleted cache, or unscheduled outside this skill): call `CronList`. Find a routine whose prompt body starts with `/<process-name>` (the slash invocation injected by `schedule-process` step 6). On zero matches: print `Not scheduled: no live routine matching /<process-name> found in CronList. Nothing to do.` Exit 0 (idempotent — unscheduling an already-unscheduled process is a no-op, not an error). On multiple matches: list each (id + cron + prompt-first-line); ask the user to pick by id.

4. **Delete the routine.** Invoke `CronDelete` with the routine id. On auth failure: print `CronDelete failed with auth error. Run \`claude login\` and retry /unschedule-process <name>. No state changed.` Exit non-zero. No history entry written.

5. **Remove the cache row** (if present). Edit `.claude/scheduled-processes.json`: drop the row where `routine_id` matches. The cache write is best-effort — a failure here leaves a stale row but doesn't affect the canonical state (`CronList` is authoritative). On cache-write failure: print the routine id + a "stale cache row remains — clear manually if desired" warning, but still write a `success` history entry (the user's intent — kill the routine — was achieved).

6. **Write history entry** to `./history/YYYY-MM-DD-<run-id>.md`. Include: `time:`, the process name, the deleted routine id, the cron that was deleted, the lookup path used (cache | CronList fallback), and any cache-write warnings.

7. **Print summary:** `Unscheduled <process-name>. Frontmatter `schedule:` field unchanged; re-run /schedule-process to reactivate.`

## Outputs

- One fewer entry in `CronList`.
- One fewer row in `.claude/scheduled-processes.json` (best-effort).
- One history entry under `./history/`.
- One-line stdout confirmation.
- **NOT modified:** the source `PROCESS.md` frontmatter.

## Failure modes

- **Not scheduled** — step 3 returns zero `CronList` matches. Recovery: nothing to do; idempotent no-op (exit 0, no history entry).
- **Multiple `CronList` matches in fallback** — step 3 ambiguity. Recovery: user picks by id.
- **Auth error** — step 4 fail. Recovery: `claude login`. No state changed; safe to retry.
- **Cache-write failure** — step 5 partial. Recovery: edit the JSON manually OR run `/list-scheduled-processes` which classifies the stale row as ORPHAN.

## Related

- Process definition: `./PROCESS.md`
- Run history: `./history/`
- Sibling skills: [`schedule-process`](../schedule-process/) (register), [`list-scheduled-processes`](../list-scheduled-processes/) (drift detection / inventory).
- Owner agent: [`.claude/agents/company/ops-manager.md`](../../agents/company/ops-manager.md).
- External tool: Claude Code's `CronDelete` (per https://code.claude.com/docs/en/routines.md — wrapper depends on this tool name).
