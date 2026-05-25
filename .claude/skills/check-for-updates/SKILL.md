---
name: check-for-updates
description: Check whether upstream has a newer release than the consumer is pinned to; 6h cache; silent unless an update exists
version: 0.1.0
tags: [meta, framework, sync]
owner_agent: chief-of-staff
---

# check-for-updates

## When to use

Invoked automatically as step 1 of `task-register`, `task-update`, `task-complete`. Adopters can invoke manually via `/check-for-updates --force` to force a fresh check, or `/check-for-updates --include-prerelease` to consider pre-release tags.

The skill is cheap (one `gh api` call cached 6h) and silent unless an update is available — it does not block or interfere with the parent skill's normal flow.

## Inputs

- `force` (optional bool; default false): bypass the 6h cache and check upstream now.
- `include_prerelease` (optional bool; default false): include pre-release tags in the latest-check.

## Steps

1. Resolve repo root via `git rev-parse --show-toplevel`.
2. Read `<repo-root>/.copier-answers.yml`. Extract `_commit` (current pinned tag) and `_src_path` (upstream URL). If missing: print one-line warning (`.copier-answers.yml not found — was this repo scaffolded with copier?`) and exit 0. Do NOT fail the parent skill.
3. Read `<repo-root>/.claude/.last-update-check`. If timestamp < 6h old AND `--force` is false, exit 0 silently. **Skip history write** in this fast path (no value, just bloat — see step 8).
4. Parse `_src_path` to extract `<owner>/<repo>` (e.g. `gh:Koroqe/OPOS` → `Koroqe/OPOS`). Handle these `_src_path` prefixes: `gh:`, `git@github.com:` (strip and split), full `https://github.com/owner/repo` URLs.
5. Fetch the latest tag:
   - Default (no `--include-prerelease`): `gh api /repos/<owner>/<repo>/releases --jq '[.[] | select(.prerelease == false)] | first | .tag_name'` — fetches the full list, filters out prereleases, takes the first (newest).
   - With `--include-prerelease`: `gh api /repos/<owner>/<repo>/releases/latest --jq '.tag_name'`.
   - On network/rate-limit/auth failure: silent exit 0 (no history entry — silent skips are not meaningful events).
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
- **Cache fresh** — Silent exit 0. The fast path that runs on every meaningful skill invocation.

## Related

- Process definition: `./PROCESS.md`
- Run history: `./history/`
- Sibling skill: `sync-from-core` (the one that actually applies updates).
- Cache file: `.claude/.last-update-check` (gitignored; per-machine).
