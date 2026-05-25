---
name: sync-from-core
description: Apply upstream changes via `copier update`; open a branch, show the diff, let user review before commit
version: 0.1.0
tags: [meta, framework, sync]
owner_agent: chief-of-staff
---

# sync-from-core

## When to use

Manually, after `check-for-updates` reports a new version is available. Or unconditionally to pull the latest upstream changes.

## Inputs

- `target_version` (optional; default: latest non-prerelease release tag from upstream).
- `branch` (optional; default: `opos-update-<tag>`).
- `check_only` (optional bool; default false): if true, runs `copier update --dry-run` and prints the diff without creating a branch or modifying files. Useful for previewing changes.

## Steps

1. Resolve repo root via `git rev-parse --show-toplevel`. Ensure the working tree is clean (`git status --porcelain` returns empty). If not: ABORT with instruction to commit or stash first. Do NOT proceed with a dirty tree — `copier update` would mix consumer's in-progress edits with upstream changes.
2. Read `<repo-root>/.copier-answers.yml`. Extract `_src_path` (upstream URL). Parse to `<owner>/<repo>` using the same logic as `check-for-updates`. If `.copier-answers.yml` is missing: ABORT with instruction to scaffold via `copier copy` first (this skill cannot bootstrap a repo).
3. Resolve `target_version`:
   - If `--target_version` passed: use it.
   - Else: `gh api /repos/<owner>/<repo>/releases --jq '[.[] | select(.prerelease == false)] | first | .tag_name'`.
4. **If `--check_only` is true**: run `copier update --vcs-ref <tag> --dry-run --defaults --conflict rej`. Print the would-be changes. Skip steps 5–9 (no branch, no commit, no history-write).
5. Create the update branch: `git checkout -b <branch>` (default `opos-update-<tag>`).
6. Run `copier update --vcs-ref <tag> --conflict rej --defaults`. The `--defaults` flag is safe because `copier.yml`'s only question (`COMPANY_NAME`) was answered at initial scaffold and persists in `.copier-answers.yml`; updates reuse the stored answer without re-prompting. `--trust` is NOT used today because `copier.yml` has no `_tasks` or `_migrations`. If future versions add tasks, add `--trust` here and to the Actions workflow.
7. `git status --porcelain` — list changed files. Count `.rej` files (conflicts).
8. Surface to the user in chat:
   - The list of changed files.
   - Count of `.rej` files (conflicts) — if non-zero, prominently warn that consumer-side edits to CORE files were lost and need manual resolution.
   - `git diff --stat` summary.
   - Instruction: "Review changes. To commit: `git add . && git commit -m 'chore: sync OPOS core <tag>'`. To abort: `git checkout main && git branch -D <branch>`."
9. **Wait** for user to commit or abort — DO NOT auto-commit. The plan is explicit: user reviews before commit.
10. Write history entry to `<repo-root>/.claude/skills/sync-from-core/history/<YYYY-MM-DD>-<short-run-id>.md`. Outcome reflects whether the user committed (`success`), aborted (`partial`), or the run errored (`failure`).

## Outputs

- A new local branch with the update applied (or aborted; or just the dry-run printout if `--check_only`).
- A history entry on every invocation (this skill is meaningful — the user wanted the run).

## Failure modes

- **Dirty working tree** — Abort at step 1.
- **`.copier-answers.yml` missing** — Abort at step 2.
- **`copier update` fails** — Surface the error; leave the branch in place so the user can investigate.
- **`.rej` files present after update** — NOT a hard failure but prominently warned. Indicates consumer edited a CORE file and the patch couldn't apply cleanly. User resolves manually.
- **`gh auth` not configured** — `gh api` returns non-zero in step 3; surface the `gh auth login` remediation.
- **Network unreachable** — Same as above; surface the gh error.
- **User aborts** — Not a failure; documented as `partial` in the history entry.

## Related

- Process definition: `./PROCESS.md`
- Run history: `./history/`
- Sibling skill: `check-for-updates` (the cheap-probe that surfaces when this skill should be invoked).
- Upstream answers: `.copier-answers.yml` at repo root.
