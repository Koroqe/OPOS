---
name: task-complete
description: Post the final report (summary + auto-generated changelog + deliverables) to the active task issue and close it
version: 0.1.0
tags: [meta, framework, task-tracking, github]
owner_agent: chief-of-staff
---

# task-complete

## When to use

At task completion: after the final slice is committed and the work is merge-ready. NOT for partial completion (use `task-update --status blocked` instead).

## Inputs

- `summary` — 2-4 sentence agent-written summary of what shipped and why (required).
- `since_sha` — git SHA where the task started. If omitted, resolve via the fallback chain below.
- `issue` — optional override; default: read from `<repo-root>/.claude/.current-task`.
- `deliverables` — optional markdown checklist of final deliverables state.

## `since_sha` fallback chain

When `--since_sha` is not passed, resolve in this order:

1. `git rev-parse origin/HEAD 2>/dev/null` — the default branch on the remote (e.g. `origin/main`).
2. If (1) fails: `git rev-parse main 2>/dev/null` — a local `main` branch if it exists.
3. If (2) fails: `git rev-list --max-parents=0 HEAD | head -1` — the first commit reachable on the current branch (works in any single-branch repo).
4. If (3) equals `HEAD` (single-commit branch): empty changelog; post the summary and proceed.

## Steps

1. **Check for upstream updates.** Invoke `check-for-updates` (silent unless an update is available; cached 6h). Best-effort — failures do not block this skill's run.
2. Resolve repo root via `git rev-parse --show-toplevel`.
3. Read `$REPO_ROOT/.claude/.current-task` (or `--issue`). Exit clearly if neither is set.
4. Read and validate config.
5. Resolve `since_sha` via the fallback chain above (if not passed).
6. Compute the changelog: `git log <since_sha>..HEAD --oneline --no-merges`. Capture as a bulleted list.
7. Find PR links via `gh issue view <number> --json closedByPullRequestsReferences` — extract URLs and titles from GitHub's native link references (PRs that say "Closes #N" or are otherwise GitHub-linked to the issue). More reliable than title or body search.
8. Scan commits in the range for the `Refs: #<issue>` trailer. Collect commits LACKING the ref. If any are found, prepare a warning block for the final comment AND print to stdout.
9. Render the final comment: agent summary (verbatim from `--summary`), then changelog bullets (or "_no commits in range_" line), then PR-link section (skip if empty), then deliverables (if provided), then the warning block (if commits missed the ref). **When the warning block has 5 or more missing-ref commits**, wrap the list in a markdown `<details><summary>N commits missing Refs: #<issue></summary>...</details>` block so it doesn't visually dominate the final comment. Threshold (>=5) is intentional — under 5, the inline list is short enough to stay flat for quick scanning.
10. `gh issue comment <number> --repo <repo> --body "<final>"`.
11. Ensure label `status:done` exists; create with `gh label create status:done --color <hex>` if missing (warn on creation). The color SHOULD come from `.claude/task-tracking.config.json`'s `_label_palette["status:done"]` field (defaults to green `0E8A16` in the shipped config); v0.1.1 documents the palette as the source of truth, but the config-read mechanic is currently still manual (the skill body picks the color; future v0.2.0 work will wire the read into the skill itself). Apply it: `gh issue edit <number> --add-label status:done`.
12. `gh issue close <number> --repo <repo> --reason completed`.
13. **Archive the task file to `tasks/closed/`** (new in v0.2.0; uses `git mv` since v0.6.1). Ensure the directory exists via `mkdir -p "$REPO_ROOT/tasks/closed/"` (idempotent — first task-complete after v0.2.0 creates it; subsequent calls no-op). Then move the task file via `git mv` so the deletion is staged automatically: `git mv "$REPO_ROOT/tasks/<number>.md" "$REPO_ROOT/tasks/closed/<number>.md"`. **Why `git mv` (v0.6.1 fix):** plain `mv` leaves the original `tasks/<number>.md` tracked in git's index (since the original was added in `task-register`'s step 11 — see task-register/SKILL.md), causing both paths to exist in HEAD. The v0.5.3 + v0.6.0 task-complete runs hit this bug and required a retroactive cleanup commit (`b775b0f`). `git mv` stages the deletion atomically with the add, fixing it at root. **Backwards-compat**: if `tasks/<number>.md` doesn't exist (e.g. task was opened pre-v0.2.0 before the `tasks/` convention), skip silently. If `tasks/<number>.md` exists but is NOT tracked (rare; only the first task ever opened on a brand-new consumer repo), `git mv` falls back to `mv` semantics — no error.
14. Delete `$REPO_ROOT/.claude/.current-task`.
15. Print one-line confirmation: `Completed: #<number> — closed; <N> commits, <M> PRs`.
16. **Write history entry** to `$REPO_ROOT/.claude/skills/task-complete/history/<YYYY-MM-DD>-<short-run-id>.md`. Outcome: `success` if all steps succeeded; `partial` if there were no commits in range; `failure` if any required step failed.

## Outputs

- A final comment on the issue.
- The issue is closed with reason `completed` and has the `status:done` label.
- `.current-task` is cleared.
- A history entry.

## Failure modes

- **`.current-task` absent and no `--issue`** → exit; `failure` entry.
- **Issue already CLOSED** → warn but proceed: post the final comment for the record; do not re-close; `partial` entry.
- **No commits in range** → still post the summary; `partial` entry; flag in the history body.
- **PR-link discovery returns nothing** → not a failure; just an empty PR section in the final comment.
- **Network or rate-limit** → retry once with 2-second backoff; surface on second failure; `partial` entry.

## Related

- Process definition: `./PROCESS.md`
- Run history: `./history/`
- Sibling skills: `task-register`, `task-update`
