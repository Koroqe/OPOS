---
process_name: sync-from-core
owner: chief-of-staff
collaborators: [eng-lead]
inputs: [target_version, branch, check_only]
success_criteria: [working_tree_clean_at_start, copier_update_completed, diff_surfaced_to_user, history_entry_written]
slo: "2 minutes (interactive)"
version: 0.1.0
---

# sync-from-core

## Narrative

Applies upstream framework changes to the consumer's repo using `copier update`. Operates on a fresh branch so the user can review the diff (and any `.rej` files indicating conflicts) before committing. Owned by `chief-of-staff`; `eng-lead` is a collaborator since the git mechanics are the R&D dept's engineering-branch domain (as of v0.5.1; engineering folded into the R&D umbrella).

## Pre-conditions

- Working tree is clean (`git status --porcelain` empty).
- `.copier-answers.yml` exists at repo root (this repo was scaffolded via Copier).
- `gh` CLI is authenticated.
- Python + Copier installed locally (`copier --version` succeeds).

## Steps

Mirrors the 10-step procedure in SKILL.md:

1. Clean-tree check; abort if dirty.
2. Read `.copier-answers.yml`; parse `_src_path`.
3. Resolve target version (input or latest non-prerelease).
4. If `--check_only`: dry-run + print + return.
5. Create update branch.
6. Run `copier update`.
7. Inspect changes (changed files, `.rej` count, diff stat).
8. Surface to user with explicit commit/abort instructions.
9. Wait — do NOT auto-commit.
10. Write history entry.

## Done when

- `working_tree_clean_at_start` — `git status --porcelain` was empty at step 1.
- `copier_update_completed` — `copier update` exit code was 0 at step 6 (or step 4 for dry-run).
- `diff_surfaced_to_user` — the user saw the list of changed files, `.rej` count, and instructions at step 8.
- `history_entry_written` — a file exists under `./history/` for this invocation, regardless of whether the user committed or aborted.

## Rollback

- **If user wants to discard a sync that was already committed**: `git revert <sync-commit-sha>` or branch-discard if not yet merged.
- **If user aborts mid-flow**: `git checkout main && git branch -D <branch>` discards the local branch and any uncommitted update.
- **For `.rej` files that the user wants to ignore**: `rm **/*.rej` (consumer accepts the upstream version as-is for those files).
- **To pin to an older version**: edit `.copier-answers.yml` `_commit:` field to the desired older tag, then re-run `sync-from-core --target_version <old-tag>`. No automated rollback skill in v0 (see RISKS.md Risk 12).

## History

Run records live in `./history/` — one entry per invocation (success, partial, or failure). Unlike `check-for-updates` (conditional history), this skill ALWAYS writes an entry because every invocation is a meaningful event the user explicitly triggered.
