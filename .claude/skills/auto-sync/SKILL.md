---
name: auto-sync
description: Scheduled, non-interactive upstream sync — probe for a new OPOS release, apply it via `copier update`, auto-commit clean syncs, escalate conflicts to a consumer-repo issue
version: 0.1.0
tags: [meta, framework, sync, scheduling]
owner_agent: chief-of-staff
tools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash"]
---

# auto-sync

## When to use

As a **scheduled routine** (registered via `/schedule-process auto-sync`, daily cron `17 6 * * *`) — the autonomous counterpart of `sync-from-core`. Also manually invokable as `/auto-sync` (e.g. to test the flow, or to pull an update immediately without the interactive review `sync-from-core` provides), or as `/auto-sync --dry_run` to see what a run would do without mutating anything.

The contract difference from `sync-from-core` is deliberate and absolute: `sync-from-core` **waits** for a human to review and commit; `auto-sync` **commits clean syncs itself** and escalates only when something needs a human. One skill cannot carry both postures — do not merge them.

## Authority mapping

The scheduled-run prelude instructs: refuse any action not in the declared authority list. For this skill the declared list `[commit, push, file_issue]` maps to concrete actions as follows — every action below is *inside* the declaration:

- **commit** — the full local mutation set needed to produce the sync commit: creating/deleting the `opos-auto-sync-<tag>` work branch, the file writes performed by `copier update`, `.rej` handling (v0.1.0: none are auto-resolved — any `.rej` is a failure; the CHANGELOG-only auto-resolution rule arrives with the hardening pass), refreshing `.claude/.last-update-check`, ff-merging the work branch to the default branch, and writing the run record.
- **push** — `git push` of the ff-merged default branch (and of the work branch when the conflict path lands).
- **file_issue** — `gh issue create` in the consumer's own repo (conflict/divergence escalation paths; hardening pass).

Anything outside this mapping (e.g. editing files by hand, force-pushing, touching other branches) is outside the declaration — refuse and record the refusal.

## Inputs

- `dry_run` (optional bool; default false): probe and print what would happen; mutate nothing (no branch, no cache write, no run record).
- `target_version` (optional; default: latest non-prerelease release tag from upstream). Must match `^v?[0-9]+\.[0-9]+\.[0-9]+$` — reject anything else before use (the value is interpolated into `--vcs-ref` and a branch name).

## Steps (v0.1.0 — happy path; the hardening pass adds conflict, divergence, and degradation branches)

1. **Resolve repo root** via `git rev-parse --show-toplevel`.
2. **Non-scaffolded-repo posture:** read `<root>/.copier-answers.yml`. If missing (common when this repo IS the framework itself, not a consumer scaffold): print a one-line warning and exit 0 — same posture as `check-for-updates`. No run record.
3. **Clean-tree guard:** if `git status --porcelain` is non-empty, write a `partial` run record noting the dirty tree and stop. Do **not** stash, and do **not** file an issue — a developer's in-progress work is not an incident, and a daily issue per dirty tree would be pure noise. The next scheduled run retries naturally.
4. **Probe the upstream release directly** (this skill deliberately bypasses the 6h `.last-update-check` cache — a scheduled run must not no-op because an interactive session probed recently): parse `_src_path` to `<owner>/<repo>` exactly as `check-for-updates` does (`gh:`, `git@github.com:`, and full `https://` forms), then
   `gh api /repos/<owner>/<repo>/releases --jq '[.[] | select(.prerelease == false)] | first | .tag_name'`.
   Validate the returned tag against `^v?[0-9]+\.[0-9]+\.[0-9]+$`; a non-matching value is treated as a probe failure (silent stop, no record, retry next run). Refresh `<root>/.claude/.last-update-check` (`YYYY-MM-DDTHH:MM:SSZ <tag>`) so interactive sessions don't re-nag right after this run.
5. **No update** (latest tag equals `_commit` in `.copier-answers.yml`): write a `success` run record with the one-line note `no update — pinned <tag> is current` and stop. (Unlike `check-for-updates`, whose documented conditional-history rule is scoped to that probe skill, every `auto-sync` run records — the run records are the only liveness signal for scheduled execution; see RISKS Risk 20.)
6. **If `--dry_run`:** print what would happen (current pin, available tag, the branch/copier/commit sequence that would run) and stop. No branch, no cache write beyond step 4's refresh — in dry-run mode skip the cache refresh too; a dry run must be a pure read.
7. **Apply the update on a work branch:** `git checkout -b opos-auto-sync-<tag>`, then `copier update --vcs-ref <tag> --conflict rej --defaults` (`--defaults` is safe: the sole question `COMPANY_NAME` persists in `.copier-answers.yml`; `--trust` is not used because `copier.yml` has no `_tasks`/`_migrations` — if upstream ever adds them, this is one of THREE sync drivers to update: `sync-from-core`, this skill, and `.github/workflows/sync-opos.yml`).
8. **Count `.rej` files.** v0.1.0 rule: **zero `.rej` required.** Any `.rej` → `git checkout <default-branch> && git branch -D opos-auto-sync-<tag>`, write a `failure` run record naming the `.rej` files, stop. (The hardening pass replaces this with the CHANGELOG-only auto-resolution rule and the commit-partial-state-plus-issue conflict path.)
9. **Commit and integrate:** `git add -A && git commit -m "chore: auto-sync OPOS core <tag>"`. Record the commit sha (it goes in the run record — it is the rollback handle). `git checkout <default-branch> && git merge --ff-only opos-auto-sync-<tag> && git branch -d opos-auto-sync-<tag>`, then `git push` (per the Scheduled-run authority exception, the ff-merge to the default branch is the sanctioned integration step of the `commit` authority; work always happens on the branch first).
10. **Write the run record** — routing rule: if the invoking prompt contains the prelude string `"You are running as a scheduled routine"`, write to `./scheduled-runs/<YYYY-MM-DD>-<run-id>.md` (schema: `shared/templates/scheduled-run.md.tmpl`); otherwise write to `./history/<YYYY-MM-DD>-<run-id>.md` (root-CLAUDE.md history schema). Outcome `success`; body names the tag applied and the sync-commit sha.

## Outputs

- On a clean update: one commit on the default branch (`chore: auto-sync OPOS core <tag>`), pushed; the `.copier-answers.yml` pin advanced to `<tag>`.
- A run record on every run past step 2 — including "no update" runs (step 5) and guarded stops (step 3).
- A refreshed `.claude/.last-update-check` (except in dry-run).

## Failure modes

- **Not a copier scaffold** (`.copier-answers.yml` missing) — warn, exit 0 (step 2). The framework repo itself hits this path.
- **Dirty working tree** — `partial` record, no issue, stop (step 3).
- **Probe failure** (network, rate limit, `gh` auth, malformed tag) — silent stop, no record; the next scheduled run retries. Manual remediation guidance lives in `sync-from-core`'s failure modes.
- **`.rej` conflicts** — v0.1.0: `failure` record, branch deleted, stop (step 8).
- **`copier update` itself fails mid-branch** — checkout the default branch, delete the work branch, `failure` record.
- **Self-update hazard** — a run may update THIS skill's own SKILL.md. Finish the current run on the already-loaded instructions; the new logic applies from the next run. Never re-read and switch instructions mid-run.

## Related

- Process definition: `./PROCESS.md`
- Run records: `./history/` (manual) and `./scheduled-runs/` (scheduled)
- Sibling skills: [`sync-from-core`](../sync-from-core/) (interactive, human-reviewed variant), [`check-for-updates`](../check-for-updates/) (cheap cached probe), [`schedule-process`](../schedule-process/) (registration)
- Opt-in alternative: `.github/workflows/sync-opos.yml` — **mutually exclusive with this skill** (one sync driver per repo; the hardening pass adds the preflight check)
- Upstream answers: `.copier-answers.yml` at repo root
