---
name: list-scheduled-processes
description: Read-only inventory and drift detection. Cross-references PROCESS.md scheduling declarations against the live Claude Code CronList; classifies each row as OK / MISSING / ORPHAN / DRIFT / INVALID_INTENT; warns on overlapping cron times.
version: 0.1.0
tags: [meta, framework, scheduling, cron, drift-detection]
owner_agent: ops-manager
tools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash", "CronList"]
---

# list-scheduled-processes

## When to use

To inventory the current scheduling state of the company OR to detect drift between PROCESS.md declarations and Claude Code's live cron registrations. Invoke as `/list-scheduled-processes` (no arguments).

Read-only. Does NOT modify cron registrations, the local cache, or any PROCESS.md. Safe to run on a fresh machine — `CronList` is the authoritative source of live registrations for `runtime: claude-schedule`, NOT the local `.claude/scheduled-processes.json` cache. **For `runtime: gha` (v0.10) the authoritative source is the workflow file**: a declared-gha process is LIVE when `.github/workflows/opos-<process-name>.yml` exists (cross-check its cron against the declaration for DRIFT); best-effort, also surface the last run's conclusion via `gh run list --workflow opos-<name>.yml --limit 1` and warn when the `ANTHROPIC_API_KEY` secret is absent (`gh secret list`).

**Prerequisite:** the user must be logged into Claude Code (`claude login`). `CronList` authenticates against the user's subscription.

## Inputs

None.

## Steps

1. **Glob and parse PROCESS.md candidates.** Glob `**/PROCESS.md` rooted at repo root. For each, parse frontmatter and categorize:
   - **Declared (valid):** all 4 scheduling fields present AND `ui.scheduling.validate_frontmatter` returns `(True, [])`. Record `process_name`, `schedule`, `authority`, `path`.
   - **Declared (invalid):** at least 1 scheduling field present but `validate_frontmatter` returned errors. Record `process_name`, `path`, and the error list.
   - **Undeclared:** none of the 4 scheduling fields present. Skip (manual-only process — not relevant to this inventory).

2. **Fetch live registrations.** Call `CronList`. This is the **authoritative** source for what's currently scheduled — the local cache `.claude/scheduled-processes.json` is read only as a hint (e.g., to confirm a process_name ↔ routine_id pairing when prompt prefixes are ambiguous). An empty cache on a fresh machine MUST NOT cause every live routine to be classified as ORPHAN. If `CronList` fails with auth error: print `claude login` hint and exit non-zero with NO history entry.

3. **Cross-reference declarations vs live registrations.** For each live routine in `CronList`, parse the prompt body's first slash-invocation line (`/<process-name>`) to extract its target process name. For each declared (valid) PROCESS.md, check whether a matching live routine exists. Classify each entry into one of 5 statuses:

   | Status | Meaning | Recovery action for user |
   |---|---|---|
   | **OK** | Declared (valid) AND in CronList AND declared cron == live cron | None — happy path. |
   | **MISSING** | Declared (valid) but NOT in CronList | Run `/schedule-process <name>` to register. |
   | **ORPHAN** | In CronList but no declared (valid) PROCESS.md backs it | Run `/unschedule-process <name>` OR re-add the 4 scheduling frontmatter fields to a PROCESS.md. |
   | **DRIFT** | Declared (valid) AND in CronList BUT declared cron ≠ live cron | Re-run `/schedule-process <name>` — the skill detects the diff and confirms before overwriting. |
   | **INVALID_INTENT** | PROCESS.md has SOME scheduling fields but `validate_frontmatter` failed | Fix the frontmatter per the validator's error list (printed beneath the row); do NOT run any scheduling skill until fixed. |

4. **Print the table.** Columns: `process | cron (declared) | cron (live) | authority | status`. Use `—` for empty cells (e.g., the live-cron cell for MISSING rows; the declared-cron cell for ORPHAN rows). For INVALID_INTENT rows, print the validator's error list as indented continuation lines beneath the table row.

5. **Warn on overlapping cron times.** After the table, scan the OK rows. If two or more share the same declared cron expression (e.g., two processes both at `0 9 * * 1`), print:
   > ⚠️ Overlap warning: <N> processes declared at `<cron>`: <comma-separated names>. If they mutate shared files, they will conflict. Stagger the crons or coordinate via explicit dependencies.

6. **Write history entry only if any non-OK rows found.** Outcome `partial` (the drift IS the signal). Body lists each non-OK row + status + the recovery action printed in step 3. On a clean repo (all OK, no overlaps): no history entry — this is a read-only no-op and recording every clean run would drown the actual signal.

## Outputs

- One table on stdout (always).
- Zero or more warning lines after the table.
- Zero or one history entry under `./history/` (only if non-OK rows found).
- Exit 0 always (drift is a signal, not a failure).

## Failure modes

- **CronList auth error** — step 2 fail. Recovery: `claude login`. Exit non-zero. No history entry.
- **Glob produces no PROCESS.md** — step 1 returns empty. Print `No PROCESS.md files found in repo. Nothing to inventory.` Exit 0.
- **Mixed valid + invalid declarations** — step 3 handles via INVALID_INTENT category; both are surfaced in the same table.

## Related

- Process definition: `./PROCESS.md`
- Run history: `./history/`
- Sibling skills: [`schedule-process`](../schedule-process/) (register), [`unschedule-process`](../unschedule-process/) (cancel).
- Validator: [`ui/scheduling.py`](../../../ui/scheduling.py).
- Owner agent: [`.claude/agents/company/ops-manager.md`](../../agents/company/ops-manager.md).
- External tool: Claude Code's `CronList` (per https://code.claude.com/docs/en/routines.md — wrapper depends on this tool name).
