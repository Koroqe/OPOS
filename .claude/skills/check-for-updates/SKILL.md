---
name: check-for-updates
description: On-demand probe — is there an upstream OPOS release NEWER than the pinned one? One script call; the daily SessionStart updater owns routine checks
version: 0.3.0
tags: [meta, framework, sync]
owner_agent: chief-of-staff
---

# check-for-updates

> **Since v0.19.0 this skill is not what keeps a company current.** A SessionStart hook runs `shared/scripts/opos-session-update.mjs` once a day per clone, in the background, and that job *applies* updates and fast-forwards the clone. It exists because this skill only ever printed a notice, and only when the model chose to run it: at the reference consumer it left no run record at all while the company fell 14 releases behind, and every update was applied by hand. This skill remains the cheap on-demand probe.

## When to use

Only on explicit request — "is there a newer OPOS?", or before a deliberate manual `sync-from-core`. **No other skill invokes it** (v0.19.1): `task-register`, `task-update`, `task-complete` and the steward's First-touch used to run it on every call. Executed step by step by the model, each run cost about five requests, every one re-reading the whole session context — measured as a visible share of a consumer's weekly limit (up to 16% on its usage dashboard) for a job a script does for free.

## Steps

1. Run, as ONE Bash call, and relay its output verbatim (it prints nothing when there is nothing to say):

   ```bash
   node .claude/skills/check-for-updates/check.mjs [--force] [--include-prerelease]
   ```

   - `--force` — ignore the 6 h probe cache and ask upstream now.
   - `--include-prerelease` — consider pre-release tags.

2. If it printed an update notice and the user wants it applied now, run `sync-from-core` **in a subagent**, never in the main thread (steward "Context economy" rule 3). Otherwise the daily session updater applies it on its own.

Do not re-implement the script's steps by hand. The whole point of the script is that the check costs one tool call.

## What the script does

- Reads `_commit` and `_src_path` from `.copier-answers.yml`; missing file → one-line warning, exit 0.
- Resolves the latest release: `gh api repos/<owner>/<repo>/releases` for `gh:owner/repo` and GitHub URLs (no leading slash on the endpoint — MSYS rewrites it to a Windows path); `git tag` of a local clone for a local `_src_path`, with a portability warning.
- **Compares semver and reports only a NEWER release.** Until v0.19.1 the procedure reported any *different* tag, so a consumer pinned ahead of upstream's latest release would have been told to "update" — to an older version.
- Keeps its own 6 h cache in `.claude/.update-probe`. It never writes `.claude/.last-update-check`, which is the daily flag of the session updater.
- Always exits 0.

## Outputs

- At most one line: the update notice, or a configuration warning.
- `.claude/.update-probe` refreshed after a successful upstream read.

## Failure modes

- **`.copier-answers.yml` missing** — one-line warning, exit 0. Normal in the framework repo itself.
- **`gh` unauthenticated, rate-limited or offline** — silent exit 0; the next call retries.
- **`_src_path` is a local path** — works on the machine with the clone, prints the portability warning every run. Remediation: point `_src_path` at `gh:<owner>/<repo>` (the one field in that file safe to hand-edit) and commit.
- **`_src_path` unparseable or a missing directory** — loud one-line warning, exit 0. A permanent configuration defect, deliberately not silent.

## Related

- Script: `./check.mjs` (tests: `./check.test.mjs`)
- The updater that applies releases: `shared/scripts/opos-session-update.mjs`
- Process definition: `./PROCESS.md` · Run history: `./history/`
- Sibling skill: `sync-from-core` (applies updates by hand; run it in a subagent).
