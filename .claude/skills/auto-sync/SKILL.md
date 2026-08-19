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

- **commit** — the full local mutation set needed to produce the sync commit: creating/deleting `opos-auto-sync-<tag>` work branches, the file writes performed by `copier update`, the CHANGELOG-only `.rej` auto-resolution (including deleting `CHANGELOG.md.rej`), refreshing `.claude/.last-update-check`, ff-merging the work branch to the default branch, and writing the run record.
- **push** — `git push` of the ff-merged default branch, and of the work branch on the conflict path.
- **file_issue** — `gh issue create` in the consumer's **own** repo (conflict, divergence, push-failure, and Action-mutual-exclusion escalations).

Anything outside this mapping (e.g. hand-editing files beyond the CHANGELOG rule, force-pushing, touching unrelated branches, writing to any other repo) is outside the declaration — refuse and record the refusal.

## Inputs

- `dry_run` (optional bool; default false): probe and print what would happen; mutate nothing (no branch, no cache write, no run record).
- `target_version` (optional; default: latest non-prerelease release tag from upstream). Must match `^v?[0-9]+\.[0-9]+\.[0-9]+$` — reject anything else before use (the value is interpolated into `--vcs-ref` and a branch name).

## Steps

1. **Resolve repo root** via `git rev-parse --show-toplevel`.
2. **Non-scaffolded-repo posture:** read `<root>/.copier-answers.yml`. If missing (common when this repo IS the framework itself, not a consumer scaffold): print a one-line warning and exit 0 — same posture as `check-for-updates`. No run record.
3. **Mutual-exclusion preflight:** if `.github/workflows/sync-opos.yml` exists and its `schedule:` block is **uncommented** (a line matching `^\s*schedule:`, not commented with `#`), the GitHub Action is the active sync driver. Refuse: file the one-time issue `[opos-auto-sync] disabled — sync-opos.yml scheduled Action is enabled (one sync driver per repo)` (issue dedupe below), write a `partial` record, stop. *Documented limitation: a renamed or copied workflow evades this check — the one-driver-per-repo rule is ultimately the operator's responsibility (see the consumer README).*
4. **Clean-tree guard:** if `git status --porcelain` is non-empty, write a `partial` run record noting the dirty tree and stop. Do **not** stash, and do **not** file an issue — a developer's in-progress work is not an incident, and a daily issue per dirty tree would be pure noise. The next scheduled run retries naturally.
5. **Stale-branch self-heal / pending-conflict idempotency:** for each local branch matching `opos-auto-sync-*`, extract its `<tag>` and compare to the current `.copier-answers.yml` `_commit` pin:
   - tag **≤** pin → the conflict was resolved by other means (e.g. `/sync-from-core`): delete the stale branch and continue.
   - tag **>** pin → a conflict is still pending: verify the matching `[opos-auto-sync] conflict` issue is still open (file it if missing), write a `partial` record, stop. A stale branch must never disable autonomy permanently.
6. **Divergence guard:** `git fetch origin`. If the fetch fails because there is no remote or no network, note **degraded mode** (push and issue steps below become local-only notes) and continue. Otherwise `git merge --ff-only origin/<default-branch>`; if fast-forward is impossible (local default branch has diverged), file `[opos-auto-sync] diverged from origin — manual reconcile needed`, write a `partial` record, stop. Never run `copier update` on a diverged default branch — that is how the pin and the remote silently desync.
7. **Probe the upstream release directly** (this skill deliberately bypasses the 6h `.last-update-check` cache — a scheduled run must not no-op because an interactive session probed recently): parse `_src_path` to `<owner>/<repo>` exactly as `check-for-updates` does (`gh:`, `git@github.com:`, and full `https://` forms), then
   `gh api /repos/<owner>/<repo>/releases --jq '[.[] | select(.prerelease == false)] | first | .tag_name'`.
   Validate the returned tag against `^v?[0-9]+\.[0-9]+\.[0-9]+$`; a non-matching value is treated as a probe failure (silent stop, no record, retry next run). Refresh `<root>/.claude/.last-update-check` (`YYYY-MM-DDTHH:MM:SSZ <tag>`) so interactive sessions don't re-nag right after this run.
8. **No update** (latest tag equals `_commit`): write a `success` run record with the one-line note `no update — pinned <tag> is current` and stop. (Unlike `check-for-updates`, whose documented conditional-history rule is scoped to that probe skill, every `auto-sync` run records — the run records are the only liveness signal for scheduled execution; see RISKS Risk 20.)
9. **If `--dry_run`:** print what would happen (current pin, available tag, the branch/copier/commit sequence that would run) and stop. In dry-run mode skip step 7's cache refresh too — a dry run must be a pure read.
10. **Apply the update on a work branch:** `git checkout -b opos-auto-sync-<tag>`, then `copier update --vcs-ref <tag> --conflict rej --defaults` (`--defaults` is safe: the sole question `COMPANY_NAME` persists in `.copier-answers.yml`; `--trust` is not used because `copier.yml` has no `_tasks`/`_migrations` — if upstream ever adds them, this is one of THREE sync drivers to update: `sync-from-core`, this skill, and `.github/workflows/sync-opos.yml`).
11. **CHANGELOG-only auto-resolution (mechanical predicate — apply exactly, else treat as an ordinary conflict):** applies **iff** exactly one `.rej` exists and it is `CHANGELOG.md.rej`, AND every hunk in it has zero `-` lines, AND the union of its `+` lines consists solely of (i) at most one contiguous block whose first line matches `^## \[[0-9]+\.[0-9]+\.[0-9]+\]` and/or (ii) link-reference lines matching `^\[[0-9]+\.[0-9]+\.[0-9]+\]: https://`. When the predicate holds: insert the version block immediately **before the first line matching `^## \[`** in `CHANGELOG.md` (no such line exists → predicate fails); append link-ref lines to the end of the existing link-ref block (or file end); delete `CHANGELOG.md.rej`. **Then verify both assertions:** (a) the canonical awk from `release-from-changelog` — `awk '/^## \['"$V"'\]/{p=1;print;next} /^## \[/{p=0} /^\[[0-9]/{p=0} p'` — extracts the inserted section non-empty; (b) no `^## [0-9]{4}-` day heading appears below the first `^## \[` line (day blocks must stay on top; the awk does not stop at day headings, which is exactly why). Either assertion failing → `git checkout -- CHANGELOG.md` to restore the copier-written state, keep the `.rej`, and fall through to step 12's conflict path.
12. **Evaluate remaining `.rej` count:**
    - **Zero** → `git add -A && git commit -m "chore(core): auto-sync OPOS core <tag>"`. Record the commit sha (it goes in the run record — it is the rollback handle). `git checkout <default-branch> && git merge --ff-only opos-auto-sync-<tag> && git branch -d opos-auto-sync-<tag>`, then `git push` (per the Scheduled-run authority exception, the ff-merge to the default branch is the sanctioned integration step of the `commit` authority; work always happens on the branch first). **Push failure** → the commit stays local: file `[opos-auto-sync] push failed after clean sync <tag>` with reconcile instructions, write a `partial` record naming the sha, stop. In degraded mode (no remote): skip push and issue, `partial` record with an explicit local-only note.
    - **Non-zero** → commit the partial state **including the `.rej` files** on the work branch (`git add -A && git commit -m "chore(core): auto-sync partial sync <tag> — conflicts pending"`), `git checkout <default-branch>`, file `[opos-auto-sync] conflict — <tag> needs manual resolution` listing the `.rej` files with instructions (*resolve on branch `opos-auto-sync-<tag>`, merge it to the default branch, then delete the branch; or discard the branch and run `/sync-from-core --target_version <tag>` interactively — delete the branch either way*), write a `partial` record, stop. The default branch stays clean for tomorrow's run, which will find the branch via step 5 and hold.
13. **Write the run record** — routing rule: if the invoking prompt contains the prelude string `"You are running as a scheduled routine"`, write to `./scheduled-runs/<YYYY-MM-DD>-<run-id>.md` (schema: `shared/templates/scheduled-run.md.tmpl`); otherwise write to `./history/<YYYY-MM-DD>-<run-id>.md` (root-CLAUDE.md history schema). Include the outcome, the tag involved, and (on success) the sync-commit sha.

**Issue dedupe (all `file_issue` paths):** issues use the canonical title prefix `[opos-auto-sync]`. Before creating one, fetch `gh issue list --state open --json title,number` and match the intended title **locally** (server-side search tokenization is unreliable). An open match → reference it in the run record instead of creating a duplicate. The target repo is resolved via `gh repo view --json nameWithOwner` — never from `.claude/task-tracking.config.json`.

## Terminal paths

| Path | Trigger | Terminal state | Record |
|---|---|---|---|
| non-scaffold | no `.copier-answers.yml` | warn, exit 0 | none |
| action-enabled | uncommented `schedule:` in sync-opos.yml | one-time issue, stop | `partial` |
| dirty | non-empty `git status --porcelain` | stop, no issue | `partial` |
| pending-conflict | `opos-auto-sync-*` branch with tag > pin | issue verified/filed, stop | `partial` |
| diverged | ff-merge from origin impossible | issue, stop | `partial` |
| no-update | latest tag == pin | stop | `success` (note) |
| dry-run | `--dry_run` | printout, no mutation | none |
| clean | 0 `.rej` (after step 11) | commit + ff-merge + push | `success` (sha) |
| changelog-only | step-11 predicate holds | resolved, then clean path | `success` (sha + note) |
| push-fail | `git push` non-zero after clean sync | issue, commit stays local | `partial` (sha) |
| conflict | remaining `.rej` > 0 | partial commit on branch + issue | `partial` |
| degraded | no remote / no network | local commit only, no push/issue | `partial` (note) |
| mid-failure | `copier update` errors on the branch | checkout default, delete branch | `failure` |
| probe-failure | network / auth / malformed tag | silent stop | none |

## Failure modes

- **Not a copier scaffold** (`.copier-answers.yml` missing) — warn, exit 0 (step 2). The framework repo itself hits this path.
- **Probe failure** (network, rate limit, `gh` auth, malformed tag) — silent stop, no record; the next scheduled run retries. Manual remediation guidance lives in `sync-from-core`'s failure modes.
- **`copier update` fails mid-branch** — checkout the default branch, delete the work branch, `failure` record.
- **Self-update hazard** — a run may update THIS skill's own SKILL.md. Finish the current run on the already-loaded instructions; the new logic applies from the next run. Never re-read and switch instructions mid-run.
- All other failure shapes are enumerated terminal paths in the table above.

## Related

- Process definition: `./PROCESS.md`
- Run records: `./history/` (manual) and `./scheduled-runs/` (scheduled)
- Sibling skills: [`sync-from-core`](../sync-from-core/) (interactive, human-reviewed variant), [`check-for-updates`](../check-for-updates/) (cheap cached probe), [`schedule-process`](../schedule-process/) (registration)
- Opt-in alternative: `.github/workflows/sync-opos.yml` — **mutually exclusive with this skill** (one sync driver per repo; step 3 enforces the default case)
- Upstream answers: `.copier-answers.yml` at repo root
