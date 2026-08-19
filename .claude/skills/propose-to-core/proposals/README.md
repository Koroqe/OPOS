# proposals/ — drafts and the proposal ledger

This folder holds two kinds of **committed** artifacts (deliberately committed — they are the durable, cross-machine record of the upstream-contribution loop):

1. **`LEDGER.md`** — the authoritative dedupe ledger. One row per `propose-to-core` terminal state.
2. **Draft files** `YYYY-MM-DD-<slug>.md` — proposals that could NOT be sent (redaction FAIL, no write access, classification ambiguity), kept for human review. **A draft exists precisely because redaction failed or was skipped, so by construction it may contain company-identifying content — drafts are copier-`_exclude`d (`**/proposals/202[0-9]-*.md`) and must never ship to another consumer.** This README and `LEDGER.md` do ship (LEDGER under `_skip_if_exists`: shipped once, consumer-owned after).

## LEDGER.md schema (defined here and only here)

A markdown table, one row per proposal event, append-order = chronological:

```
| date | delta_target | slug | source_entry | pr_url | outcome |
```

- `date` — YYYY-MM-DD of the event.
- `delta_target` — repo-relative upstream path the proposal concerns.
- `slug` — the sanitized `[a-z0-9-]` file-slug used in the PR title/branch.
- `source_entry` — repo-relative path of the history/scheduled-run entry that sourced the delta, or `manual`.
- `pr_url` — the upstream PR URL, or `-`.
- `outcome` — one of: `pr-opened`, `draft`, `skipped-duplicate`, `aborted-starter`, `rejected-local`, `withdrawn`, `merged`, `closed-unmerged`.

## Writer constraints (two writers, strictly bounded)

- **`propose-to-core` APPENDS rows only.** It never edits or reorders existing rows.
- **`review-history` mutates ONLY the `outcome` column of existing rows** (its weekly PR-state reconciliation: `pr-opened` → `merged` / `closed-unmerged`) and adds `rejected-local` rows for deltas it rejects that were sourced from gitignored scheduled-run entries (whose in-place `status:` flip is not durable). It never appends proposal rows and never reorders.

Any other writer, or any other mutation shape, is a defect. Both SKILL.md files reference this README rather than restating the schema.
