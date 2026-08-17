---
name: sync-from-core
description: Apply upstream changes via `copier update`; open a branch, show the diff, let user review before commit
version: 0.2.0
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
2. Read `<repo-root>/.copier-answers.yml`. Extract `_src_path`. Classify it with the same four-shape logic as `check-for-updates` step 4 (remote GitHub → `<owner>/<repo>`; existing local clone → warn "local path, non-portable" and resolve tags via `git -C <path> tag`; missing local path or unparseable → ABORT with: `_src_path '<value>' cannot be used for updates on this machine. Edit .copier-answers.yml and set _src_path to gh:<owner>/<repo> (leave _commit untouched), commit, and re-run.`). If `.copier-answers.yml` is missing: ABORT with instruction to scaffold via `copier copy` first (this skill cannot bootstrap a repo).
3. Resolve `target_version`:
   - If `--target_version` passed: use it.
   - Else (remote shape): `gh api repos/<owner>/<repo>/releases --jq '[.[] | select(.prerelease == false)] | first | .tag_name'` (no leading slash — MSYS/Git-Bash path-mangling on Windows). Local-clone shape: `git -C <path> tag --sort=-v:refname | grep -v -- '-' | head -1`.
4. **If `--check_only` is true** (v0.8.1 rewrite — Copier has no `--dry-run`, and `--pretend` is ignored by `copier update`'s patch-apply step, so a real preview needs a throw-away branch): `git checkout -b opos-preview-<tag>` → `copier update --vcs-ref <tag> --defaults --conflict rej` → print `git status --porcelain` (flag `.rej` files) and `git diff --stat` → `git reset --hard && git clean -fd` → `git checkout -` → `git branch -D opos-preview-<tag>`. Nothing is committed and the tree is left exactly as found. Skip steps 5–9.
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
- **`gh auth` not configured** — `gh api` returns non-zero in step 3; surface the `gh auth login` remediation — but FIRST re-check step 2's classification: an unparseable or local `_src_path` produces the same non-zero exit and the fix is `.copier-answers.yml`, not `gh auth`.
- **`_src_path` is a local path that does not exist on this machine / is unparseable** (v0.8.1) — Abort at step 2 with the `.copier-answers.yml` remediation. This is the single most common reason a consumer scaffolded from a local clone (`copier copy /path/to/OPOS ...`) never receives updates: `copier update` reads `_src_path` and there is no CLI override for it, so the file must be hand-edited once (only `_src_path`; never `_commit`).
- **Network unreachable** — Same as above; surface the gh error.
- **User aborts** — Not a failure; documented as `partial` in the history entry.

## Related

- Process definition: `./PROCESS.md`
- Run history: `./history/`
- Sibling skill: `check-for-updates` (the cheap-probe that surfaces when this skill should be invoked).
- Upstream answers: `.copier-answers.yml` at repo root.
