---
process_name: adopt-proposal
owner: ops-manager
collaborators: [coo]
inputs: [bundle_path]
success_criteria: [bundle_reviewed_with_cover_sheet, single_confirm_decision, adopted_files_validated_and_backlinked, source_item_state_transitioned]
slo: "10 minutes (interactive)"
version: 0.1.0
---

# adopt-proposal

## Narrative

The human half of the v0.12 self-building pair. `design-process --draft` produces complete, inert proposal bundles overnight; this process is the ONE decision that makes a draft real — review the cover sheet, adopt/edit/reject/defer, and on adoption the files move into place with validation, backlinks, and state transitions handled mechanically. Owned by `ops-manager` (owner of the design family); `coo` collaborates as process-health owner. Interactive only — refuses the scheduled-run prelude.

## Pre-conditions

- A bundle under `*/backlog/proposals/<date>-<slug>/` with PROPOSAL.md + SKILL.md + PROCESS.md.
- Clean-enough tree to `git mv` + commit.

## Steps

Mirrors SKILL.md: list/resolve bundle → present cover sheet + full pair (surfacing scheduling fields, tool grants, sensitive paths) → one Confirm decision → on adopt: move into declared placement, validate frontmatter, backlink `owns_processes:`, flip source item to `designed`, delete bundle, commit → history entry.

## Done when

- `bundle_reviewed_with_cover_sheet` — the human saw the provenance, consultations, lessons, and open questions before deciding.
- `single_confirm_decision` — exactly one adopt/reject/defer decision was required of the human.
- `adopted_files_validated_and_backlinked` — validator ok (when scheduling fields present); owner agent's advisory list updated.
- `source_item_state_transitioned` — `drafted → designed` (or `rejected` with reason).

## Rollback

- **Un-adopt:** `git revert` the adoption commit (bundle contents are recoverable from git history); flip the source item back to `drafted`.
- **Wrong placement:** revert + re-adopt with the corrected placement edited into the bundle.

## History

Every run records in `./history/` — adoption decisions are exactly the events the self-improvement log exists for.
