---
name: check-for-updates
description: Check whether upstream has a newer release than the consumer is pinned to; 6h cache; silent unless an update exists
version: 0.2.0
tags: [meta, framework, sync]
owner_agent: chief-of-staff
---

# check-for-updates

## When to use

Invoked automatically as step 1 of `task-register`, `task-update`, `task-complete`, **and (v0.8.1) as part of the chief-of-staff First-touch protocol** on session open — so consumers whose daily rhythm does not go through the task-lifecycle skills still get the notice. Adopters can invoke manually via `/check-for-updates --force` to force a fresh check, or `/check-for-updates --include-prerelease` to consider pre-release tags.

The skill is cheap (one `gh api` call cached 6h) and silent unless an update is available — it does not block or interfere with the parent skill's normal flow.

## Inputs

- `force` (optional bool; default false): bypass the 6h cache and check upstream now.
- `include_prerelease` (optional bool; default false): include pre-release tags in the latest-check.

## Steps

1. Resolve repo root via `git rev-parse --show-toplevel`.
2. Read `<repo-root>/.copier-answers.yml`. Extract `_commit` (current pinned tag) and `_src_path` (upstream URL). If missing: print one-line warning (`.copier-answers.yml not found — was this repo scaffolded with copier?`) and exit 0. Do NOT fail the parent skill.
3. Read `<repo-root>/.claude/.last-update-check`. If timestamp < 6h old AND `--force` is false, exit 0 silently. **Skip history write** in this fast path (no value, just bloat — see step 8).
4. Classify `_src_path` and resolve the upstream **source**. Four shapes are recognised:
   - **Remote GitHub** — `gh:owner/repo`, `git@github.com:owner/repo(.git)`, `https://github.com/owner/repo(.git)`. Extract `<owner>/<repo>` (strip prefix, strip trailing `.git`). This is the portable, recommended shape.
   - **Local path** (v0.8.1) — an absolute or relative filesystem path that exists and contains a `.git` directory (e.g. `/home/agent/workspace/OPOS`, produced when the consumer was scaffolded from a local clone via `copier copy <path> ...`). Resolve the latest tag directly from that clone: `git -C "<path>" tag --sort=-v:refname | grep -v -- '-' | head -1` (drop `grep -v -- '-'` when `--include-prerelease`). Print a one-line **portability warning** every time this branch is taken: `⚠️ .copier-answers.yml _src_path is a local path (<path>) — updates only work on this machine. Consider re-pointing it to gh:<owner>/<repo>.` (The warning is deliberately loud: a local `_src_path` silently breaks the update loop on every other machine, CI runner, or second consumer.)
   - **Local path that does NOT exist** — print `⚠️ .copier-answers.yml _src_path (<path>) does not exist on this machine — update loop is broken here; re-point _src_path to the upstream GitHub URL.` and exit 0. This IS a meaningful event: write the history entry (step 8) with `outcome: failure`.
   - **Anything else** (unparseable) — print `⚠️ check-for-updates: cannot parse _src_path '<value>' — expected gh:owner/repo, a GitHub URL, or a local clone path.` and exit 0; write the history entry with `outcome: failure`. **Never fail silently on a parse error** — a broken checker must be distinguishable from "you are up to date" (v0.8.1: this was the root cause of a consumer sitting two releases behind with no signal).
5. Fetch the latest tag (Remote GitHub shape only; the local-path shape already resolved it in step 4):
   - Default (no `--include-prerelease`): `gh api repos/<owner>/<repo>/releases --jq '[.[] | select(.prerelease == false)] | first | .tag_name'` — fetches the full list, filters out prereleases, takes the first (newest). **No leading slash** on the endpoint: under Git-Bash/MSYS on Windows a leading `/repos/...` is rewritten to a Windows path (`C:/Program Files/Git/repos/...`) and `gh api` fails with "invalid API endpoint".
   - With `--include-prerelease`: `gh api repos/<owner>/<repo>/releases/latest --jq '.tag_name'`.
   - On network/rate-limit/auth failure: silent exit 0 (no history entry — silent skips are not meaningful events). Note the distinction from step 4: **network** failures are transient and silent; **configuration** failures (unparseable / non-existent `_src_path`) are permanent and loud.
6. Compare the latest tag to `_commit`. If they differ, print to stdout: `ℹ️ OPOS-core <new-tag> is available (you're on <current>). Run /sync-from-core to apply.`
7. Write `<repo-root>/.claude/.last-update-check` with the current ISO timestamp + the latest tag observed. Format: `YYYY-MM-DDTHH:MM:SSZ <tag>` on one line.
8. **Write history entry ONLY IF** (a) an update was found in step 6, OR (b) `--force` was passed. Skip on silent "no update" runs to avoid filling `history/` with hundreds of empty entries per week. This is the conditional-history-write rule documented explicitly.

## Outputs

- Optional one-line stdout notice (no notice if up to date or cache is fresh).
- Updated `.last-update-check` file.
- History entry only on meaningful events (update-found or forced runs).

## Failure modes

- **`.copier-answers.yml` missing** — Print warning, exit 0 (silent skip). Common when this repo is NOT scaffolded via Copier (e.g. when developing the framework itself).
- **`gh api` rate-limited or network unreachable** — Silent exit 0. No history entry. Retry naturally on next invocation.
- **`gh auth` not configured** — Same as network failure: silent exit 0. The user-facing remediation lives in `sync-from-core`'s failure modes (where authentication is required), not here.
- **`_src_path` is a local path** (v0.8.1) — Works on the machine that has the clone (tags read via `git`), but prints the portability warning on every run. Remediation: edit `.copier-answers.yml` `_src_path` to `gh:<owner>/<repo>` (the only field in that file that is safe to hand-edit; `_commit` must stay untouched) and commit.
- **`_src_path` unparseable or points to a missing directory** (v0.8.1) — Loud one-line warning, exit 0, history entry with `outcome: failure`. NOT silent: this is a permanent configuration defect, not a transient network hiccup.
- **Cache fresh** — Silent exit 0. The fast path that runs on every meaningful skill invocation.

## Related

- Process definition: `./PROCESS.md`
- Run history: `./history/`
- Sibling skill: `sync-from-core` (the one that actually applies updates).
- Cache file: `.claude/.last-update-check` (gitignored; per-machine).
