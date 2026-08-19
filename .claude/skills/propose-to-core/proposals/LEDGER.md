# Proposal ledger

Schema and writer constraints: see [`README.md`](./README.md) in this folder. Rows are append-only (chronological); `review-history` may update the `outcome` column only.

| date | delta_target | slug | source_entry | pr_url | outcome |
|---|---|---|---|---|---|
