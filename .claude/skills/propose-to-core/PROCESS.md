---
process_name: propose-to-core
owner: chief-of-staff
collaborators: [coo]
inputs: [entry_path, delta_target, dry_run]
success_criteria: [classification_resolved_or_human_drafted, redaction_gates_passed_before_any_outbound_write, ledger_line_written_for_every_terminal_state, source_entry_annotated_best_effort]
slo: "15 minutes per proposal"
version: 0.1.0
---

# propose-to-core

## Narrative

Turns a locally-observed defect in a framework (CORE) file into a **fully anonymized** pull request on the upstream OPOS repository. Invoked by `review-history`'s triage (the scheduled path) or manually (`/propose-to-core <entry-path|--delta-target <path>>`). The skill classifies the target (STARTER targets are refused — they are applied locally by `review-history`), drafts a generic fix against upstream file content, passes it through a three-layer redaction gate (deterministic pre-gate → adversarial `redaction-reviewer` agent → human fallback), and only then touches the network. Owned by `chief-of-staff` (the upstream-facing steward); `coo` collaborates as the owner of the triage that feeds it.

This process is deliberately NOT scheduled itself — it has no scheduling frontmatter. It runs inside `review-history`'s scheduled authority (`open_pr`, `push` are declared there) or interactively.

## Pre-conditions

- `gh` CLI authenticated; upstream `copier.yml` reachable via `gh api`.
- `.copier-answers.yml` exists (consumer scaffold) with a parseable `_src_path` and `_commit`.
- The input delta names or implies a `delta_target` path (or one is inferable from the entry's `proposed_delta` text).

## Steps

Mirrors the SKILL.md procedure:

1. Validate inputs (entry path inside repo root; `delta_target` repo-relative, no `..`, charset-restricted).
2. Classify the target: `_skip_if_exists` fetched at the consumer's pinned `_commit`; upstream existence probed at HEAD (`.jinja` variants + known relocations). Disagreement or any fetch failure → human-draft path, never guess.
3. Dedupe against `proposals/LEDGER.md`, then against upstream PR titles (local slug match).
4. Draft the diff + PR body from upstream file content; run the canonical redaction checklist as a self-pass; run the deterministic pre-gate (blocklist grep + secret-regex sweep) — any hit hard-fails to the draft path.
5. Adversarial review by `redaction-reviewer` (bundle: diff, title, body, branch, commit message, blocklist). Anything but the literal `REDACTION: PASS` → draft path. `--dry_run` stops here.
6. Outbound write: direct branch on upstream (push rights) or user-account fork (never an org); neutral commit identity; `gh pr create`; ledger line; best-effort source-entry annotation.
7. Fallbacks (redaction FAIL, no write access, fork failure): committed draft in `proposals/`, consumer-repo issue, ledger line with outcome `draft`.

## Done when

- `classification_resolved_or_human_drafted` — the target was mechanically classified, or the run ended on the human-draft path with the reason recorded.
- `redaction_gates_passed_before_any_outbound_write` — no `git push`, `gh repo fork`, or `gh pr create` occurred before the pre-gate passed AND the literal `REDACTION: PASS` was observed (named invariant in SKILL.md).
- `ledger_line_written_for_every_terminal_state` — `proposals/LEDGER.md` gained exactly one line for this run (`pr-opened`, `draft`, `skipped-duplicate`, `rejected-local`, or `aborted-starter`).
- `source_entry_annotated_best_effort` — committed source entries carry `upstream_pr:`/notes; gitignored (scheduled-run) sources are noted as non-durable, with the ledger as the authoritative record.

## Rollback

- **Withdraw a submitted proposal:** close the upstream PR (`gh pr close <url>`), append a `withdrawn` ledger line, and note it on the source entry. Delete the proposal branch on the fork/upstream if desired.
- **Retract a local draft:** delete the `proposals/<date>-<slug>.md` file and its ledger line in one commit, or mark the ledger line `rejected-local`.
- The scratch clone is ephemeral — nothing to roll back locally; the consumer working tree is never the write surface.

## History

Run records: manual invocations write to `./history/` (root-CLAUDE.md schema). **Sub-invocations from a scheduled `review-history` run write NO separate run record** — the parent's scheduled-run entry plus this skill's `proposals/LEDGER.md` line ARE the record; the prelude routing check applies to direct invocations only. A `scheduled-runs/` folder ships for the (unscheduled-today) case of a future direct scheduling.

## Scheduled runs

Not scheduled in v0.9.0 (no scheduling frontmatter). If a future version schedules it directly, records follow the standard prelude routing into `./scheduled-runs/`.
