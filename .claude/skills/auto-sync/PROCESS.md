---
process_name: auto-sync
owner: chief-of-staff
collaborators: [eng-lead]
inputs: [dry_run, target_version]
success_criteria: [probe_completed_or_guarded_stop, clean_sync_committed_and_pushed_or_escalated, run_record_written, pin_matches_default_branch_state]
slo: "5 minutes (scheduled, non-interactive)"
version: 0.2.0
schedule: "17 6 * * *"
runtime: cloud
non_interactive: true
authority:
  - commit
  - push
  - file_issue
# min_release_age_hours (OPTIONAL, v0.10): soak window — skip releases younger than this. Default 24.
min_release_age_hours: 24
# commands (OPTIONAL, v0.10): authoritative shell-command manifest; /schedule-process derives the
# settings allow-list and the GHA --allowedTools value from it verbatim.
commands:
  - "Bash(git fetch origin:*)"
  - "Bash(git push origin:*)"
  - "Bash(git checkout:*)"
  - "Bash(git merge --ff-only:*)"
  - "Bash(git branch:*)"
  - "Bash(git add:*)"
  - "Bash(git commit:*)"
  - "Bash(git status:*)"
  - "Bash(git rev-parse:*)"
  - "Bash(copier update:*)"
  - "Bash(python3 -m copier update:*)"
  - "Bash(gh api repos/*)"
  - "Bash(gh api /repos/*)"
  - "Bash(gh issue create:*)"
  - "Bash(gh issue list:*)"
  - "Bash(gh repo view:*)"
  - "Bash(awk:*)"
  - "Bash(grep:*)"
  - "Bash(date:*)"
  - "Read"
  - "Edit"
  - "Write"
  - "Glob"
  - "Grep"
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

Mirrors the 13-step procedure in SKILL.md:

1. Resolve repo root.
2. Non-scaffolded posture: no `.copier-answers.yml` → warn, exit 0.
3. Mutual-exclusion preflight: sync-opos.yml Action schedule enabled → one-time issue, `partial`, stop.
4. Clean-tree guard: dirty → `partial` record, no issue, stop.
5. Stale-branch self-heal (tag ≤ pin → delete, continue) / pending-conflict hold (tag > pin → verify issue, `partial`, stop).
6. Divergence guard: `git fetch` + `--ff-only` merge from origin; diverged → issue, `partial`, stop; unreachable remote → degraded mode.
7. Direct release probe (bypasses the 6h cache; refreshes it after); tag validated `^v?[0-9]+\.[0-9]+\.[0-9]+$`.
8. No update → `success` record with note, stop.
9. `--dry_run` → print, mutate nothing, stop.
10. Branch `opos-auto-sync-<tag>`; `copier update --vcs-ref <tag> --conflict rej --defaults`.
11. CHANGELOG-only `.rej` auto-resolution under the mechanical predicate (all-additive hunks, version-block/link-ref lines only; insert before first `^## \[`; verify canonical awk extraction + no day heading below the first `^## \[`).
12. Zero remaining `.rej` → commit (sha recorded), ff-merge to default branch, delete branch, push (push failure → issue + `partial`). Non-zero → commit partial state incl. `.rej` on the branch, checkout default, issue with resolution instructions, `partial`.
13. Run record — scheduled invocations to `./scheduled-runs/`, manual to `./history/` (prelude-string routing). Issues use the `[opos-auto-sync]` title prefix with local open-issue title matching for dedupe.

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
