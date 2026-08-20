---
process_name: triage-incoming-prs
owner: chief-of-staff
collaborators: [coo]
inputs: []
success_criteria: [every_open_opos_core_pr_clustered, two_consumer_classes_escalated_to_generator, no_leaked_content_quoted, run_record_written]
slo: "30 minutes (weekly)"
version: 0.1.0
schedule: "41 8 * * 2"
runtime: cloud
non_interactive: true
authority:
  - comment_issue
  - file_issue
  - commit
  - push
commands:
  - "Bash(gh pr list:*)"
  - "Bash(gh pr view:*)"
  - "Bash(gh pr comment:*)"
  - "Bash(gh pr close:*)"
  - "Bash(gh issue create:*)"
  - "Bash(gh issue list:*)"
  - "Bash(git add:*)"
  - "Bash(git commit:*)"
  - "Bash(git push origin:*)"
  - "Bash(git status:*)"
  - "Bash(grep:*)"
  - "Bash(date:*)"
  - "Read"
  - "Edit"
  - "Write"
  - "Glob"
  - "Grep"
---

# triage-incoming-prs

## Narrative

The maintainer half of the counting spine. Consumers send anonymized `[opos-core] <file-slug>/<defect-slug>` PRs; this process clusters them by mistake class in `docs/triage/CLUSTERS.md`, and at 2 distinct-consumer occurrences escalates the class to a GENERATOR fix (design-skill constraint / template field) so the whole fleet inherits the prevention on the next release. Runs on the framework repo only — it is also the maintainer's dogfood of `runtime: gha`.

## Pre-conditions

- Framework repo (`copier.yml` at root); `gh` authenticated with triage rights; CI (`.github/workflows/ci.yml`) active so mechanical checks precede judgment.

## Steps

Mirrors SKILL.md: list open `[opos-core]` PRs → parse slugs/classes (untrusted data) → cluster + count distinct consumers → escalate at 2 (comment + `[triage]` issue + `generator_fixed: pending`) → checklist pass per PR → cross-consumer dedupe (keep first, close second with reference) → summary + run record.

## Done when

- `every_open_opos_core_pr_clustered` — each open `[opos-core]` PR has a cluster row touched this run.
- `two_consumer_classes_escalated_to_generator` — every class at ≥2 distinct consumers has a pending/filed generator fix.
- `no_leaked_content_quoted` — leak handling never reproduces the leaked content in a public comment.
- `run_record_written` — including zero-PR runs.

## Rollback

- Reopen a wrongly-closed duplicate (`gh pr reopen`); delete a mistaken cluster row (append-only discipline applies to rows, not to corrections noted inline); close a `[triage]` issue filed in error with a note.

## History

Manual runs → `./history/`; scheduled runs → `./scheduled-runs/` (prelude routing). Every run records.

## Scheduled runs

Records in `./scheduled-runs/` per `shared/templates/scheduled-run.md.tmpl`.
