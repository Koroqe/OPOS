---
process_name: auto-sync
owner: chief-of-staff
collaborators: [eng-lead]
inputs: [dry_run, target_version]
success_criteria: [probe_completed_or_guarded_stop, clean_sync_committed_and_pushed_or_escalated, run_record_written, pin_matches_default_branch_state]
slo: "5 minutes (scheduled, non-interactive)"
version: 0.1.0
schedule: "17 6 * * *"
runtime: claude-schedule
non_interactive: true
authority:
  - commit
  - push
  - file_issue
---

# auto-sync

## Narrative

The autonomous half of the OPOS update loop. Where `sync-from-core` applies an upstream release under interactive human review, `auto-sync` runs on a daily cron, auto-commits syncs that apply cleanly, and escalates anything that needs a human (conflicts, divergence) to a GitHub issue in the consumer's own repo. Owned by `chief-of-staff` (steward of the sync family); `eng-lead` collaborates on the git mechanics. The off-minute cron (`17 6 * * *`) avoids herd effects across consumers.

## Pre-conditions

- `.copier-answers.yml` exists at repo root (consumer scaffold — the framework repo itself exits silently).
- Working tree is clean (guarded; a dirty tree produces a `partial` record and a natural retry next run).
- `gh` CLI authenticated; Python + Copier installed (`copier --version` succeeds).
- The `.github/workflows/sync-opos.yml` scheduled Action is NOT enabled (one sync driver per repo — checked by the hardening-pass preflight).
- Registered via `/schedule-process auto-sync` (registration is the human authorization moment for the declared authority).

## Steps

Mirrors SKILL.md v0.1.0 (happy path):

1. Resolve repo root.
2. Non-scaffolded posture: no `.copier-answers.yml` → warn, exit 0.
3. Clean-tree guard: dirty → `partial` record, no issue, stop.
4. Direct release probe (bypasses the 6h cache; refreshes it after); tag validated `^v?[0-9]+\.[0-9]+\.[0-9]+$`.
5. No update → `success` record with note, stop.
6. `--dry_run` → print, mutate nothing, stop.
7. Branch `opos-auto-sync-<tag>`; `copier update --vcs-ref <tag> --conflict rej --defaults`.
8. Any `.rej` → delete branch, `failure` record, stop (v0.1.0; hardening pass adds the CHANGELOG-only auto-resolution and the conflict-escalation path).
9. Commit (`chore: auto-sync OPOS core <tag>`, sha recorded), ff-merge to default branch, delete branch, push.
10. Run record — scheduled invocations to `./scheduled-runs/`, manual to `./history/` (prelude-string routing).

## Done when

- `probe_completed_or_guarded_stop` — the run either probed upstream (step 4) or stopped at a documented guard (steps 2–3).
- `clean_sync_committed_and_pushed_or_escalated` — a clean update ends as one pushed commit on the default branch; anything else ends in a documented terminal state with the matching record outcome.
- `run_record_written` — every run past step 2 leaves a record, including "no update" runs.
- `pin_matches_default_branch_state` — after a `success` sync, `.copier-answers.yml` `_commit` on the default branch equals the applied tag.

## Rollback

- **Undo an auto-committed sync:** `git revert <sync-commit-sha>` — the sha is recorded in the run record. This is the primary rollback and works after push.
- **Pin back to an older version:** after the revert, optionally `/sync-from-core --target_version <old-tag>` to realign `.copier-answers.yml` (see `sync-from-core` PROCESS.md rollback and RISKS Risk 12).
- **Abort mid-flow:** `git checkout <default-branch> && git branch -D opos-auto-sync-<tag>` discards the work branch and any uncommitted update.

## History

Manual runs record in `./history/` (root-CLAUDE.md schema). Scheduled runs record in `./scheduled-runs/` (schema: `shared/templates/scheduled-run.md.tmpl`). Every run past the non-scaffolded guard writes a record — including no-update runs — because these records are the only liveness signal for scheduled execution (RISKS Risk 20). This is deliberately stricter than `check-for-updates`' conditional-history rule, which is scoped to that probe skill only.

## Scheduled runs

Scheduled-run records live in `./scheduled-runs/` — sibling to `./history/`, never mixed. See `shared/templates/scheduled-run.md.tmpl` for the schema and the `PROCESS.md.tmpl` "Scheduled runs" section for the routing convention.
