---
process_name: review-history
owner: coo
collaborators: [chief-of-staff, ops-manager]
inputs: [dry_run]
success_criteria: [all_open_deltas_triaged_or_noted, pr_states_reconciled, core_targets_never_edited_locally, run_record_written]
slo: "20 minutes (scheduled, weekly)"
version: 0.2.0
schedule: "23 7 * * 1"
runtime: gha
non_interactive: true
authority:
  - commit
  - push
  - write_proposal
  - file_issue
  - open_pr
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
  - "Bash(git log:*)"
  - "Bash(git clone:*)"
  - "Bash(gh api repos/*)"
  - "Bash(gh api /repos/*)"
  - "Bash(gh pr create:*)"
  - "Bash(gh pr list:*)"
  - "Bash(gh pr view:*)"
  - "Bash(gh issue create:*)"
  - "Bash(gh issue list:*)"
  - "Bash(gh repo view:*)"
  - "Bash(grep:*)"
  - "Bash(date:*)"
  - "Read"
  - "Edit"
  - "Write"
  - "Glob"
  - "Grep"
  - "Task"
---

# review-history

## Narrative

The consumer of the `proposed_delta` self-improvement signal. Every OPOS process records runs with optional improvement deltas; before this process existed, nothing read them — the framework's own docs promised "owner agents review history" with no mechanism. Weekly, this process triages every `status: open` delta: small fixes to consumer-owned (STARTER) files are applied directly, larger ones become backlog proposals for the owning agent, and defects in framework (CORE) files are routed to `propose-to-core`, which opens an anonymized upstream PR. It also reconciles previously-opened upstream PRs (merged → `applied`; closed-unmerged → human decision). Owned by `coo` (whose charter already carries the process-improvement mandate); `chief-of-staff` collaborates as owner of `propose-to-core`, `ops-manager` as owner of the process-design domain.

## Pre-conditions

- Repo is a consumer scaffold (`.copier-answers.yml` present) — classification needs `_src_path`/`_commit`.
- `gh` CLI authenticated for the reconciliation and upstream-routing steps (local triage degrades gracefully without it).
- Registered via `/schedule-process review-history` (registration is the human authorization moment for the declared authority, which includes the `push`/`open_pr` performed by invoked `propose-to-core` runs).

## Steps

Mirrors the 7-step procedure in SKILL.md:

1. Glob all `history/` + `scheduled-runs/` entries.
2. PR-state reconciliation first (entries with `upstream_pr:` + ledger `pr-opened` rows): merged → `applied`/`merged`; closed-unmerged → issue + note; open → skip. Ledger writes obey the writer constraints in `propose-to-core/proposals/README.md` (outcome column + `rejected-local` rows only).
3. Select `status: open` deltas.
4. Classify (validated `delta_target` hint → inference → runtime two-part test at the pinned `_commit`).
5. Triage: CORE → `propose-to-core` (≤3 PR creations/run); STARTER within threshold (≤2 files, ≤20 lines, no sensitive path) → apply + commit; above threshold → `write_proposal` to dept backlog; stale/nonsense → `rejected` (+ ledger `rejected-local` for gitignored sources). Dated triage note on every touched entry.
6. Zero open deltas → `success` record with note.
7. ff-merge the dated work branch, push, run record (prelude routing).

## Done when

- `all_open_deltas_triaged_or_noted` — every `status: open` delta either transitioned (`applied`/`rejected`), routed (PR, draft, backlog proposal), or annotated with an explicit hold reason (cap deferral, unclassifiable, fetch failure).
- `pr_states_reconciled` — every `upstream_pr:`/`pr-opened` item was checked against the live PR state this run.
- `core_targets_never_edited_locally` — no triage commit touches a CORE-classified path; CORE deltas exit only via `propose-to-core`.
- `run_record_written` — including zero-delta runs.

## Rollback

- **Undo a triage commit:** `git revert <sha>` (each applied delta is its own `chore(core): review-history — ...` commit).
- **Withdraw an upstream proposal made this run:** `propose-to-core`'s rollback (close PR, `withdrawn` ledger line).
- **Un-reject a delta:** edit the entry's `status:` back to `open` (and remove the `rejected-local` ledger row) — it re-enters triage next run.

## History

Manual runs record in `./history/`; scheduled runs in `./scheduled-runs/` (prelude routing). Every run records, including no-op runs — the records are the liveness signal for scheduled execution (RISKS Risk 20).

## Scheduled runs

Scheduled-run records live in `./scheduled-runs/` — sibling to `./history/`, never mixed. Schema: `shared/templates/scheduled-run.md.tmpl` (includes the v0.9.0 `delta_target`/`upstream_pr` fields).
