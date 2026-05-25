---
process_name: check-for-updates
owner: chief-of-staff
collaborators: []
inputs: [force, include_prerelease]
success_criteria: [check_completed_or_skipped_due_to_cache, history_entry_written_only_if_meaningful]
slo: "5 seconds (or instant if cached)"
version: 0.1.0
---

# check-for-updates

## Narrative

Cheap upstream-version probe that other framework skills invoke as their first step. Compares the consumer's pinned tag (`.copier-answers.yml` `_commit:`) against the latest non-prerelease release on the upstream repo (parsed from `_src_path`). Silent unless an update is available. 6h cache prevents API spam.

## Pre-conditions

- Repo has been scaffolded via Copier (`.copier-answers.yml` exists). If not, the skill silently warns and exits — it doesn't fail.
- `gh` CLI is installed and authenticated. If not, the skill silently exits (network-class failure handling).

## Steps

Mirrors the 8-step procedure in SKILL.md:

1. Resolve repo root.
2. Read `.copier-answers.yml`; warn-and-exit if missing.
3. Read `.last-update-check`; silent exit if cache fresh.
4. Parse `_src_path` to `<owner>/<repo>`.
5. Fetch latest non-prerelease tag (or latest including prereleases if `--include-prerelease`).
6. Compare to `_commit`; print notice if different.
7. Update `.last-update-check` cache.
8. Conditionally write history entry (only on update-found or `--force`).

## Done when

- `check_completed_or_skipped_due_to_cache` — the skill either ran to step 7 and updated the cache, OR exited at step 3 because the cache was fresh.
- `history_entry_written_only_if_meaningful` — IF an update was found OR `--force` was passed, a new file exists under `./history/` for this run. IF the cache was fresh OR the gh call failed, NO history entry was written. This conditional behavior is the criterion.

## Rollback

No rollback needed. The skill is read-only against the upstream and only writes the cache file + (conditionally) a history entry. To clear the cache, delete `<repo-root>/.claude/.last-update-check`.

## History

Run records live in `./history/` — one file per MEANINGFUL invocation (update-found or `--force`), named `YYYY-MM-DD-<short-run-id>.md`. The conditional-write rule is deliberate to prevent the history folder from filling with thousands of routine no-op entries.
