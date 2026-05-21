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

1. Resolve repo root via `git rev-parse --show-toplevel`.
2. Read `$REPO_ROOT/.claude/.current-task` (or `--issue`). Exit clearly if neither is set.
3. Read and validate config.
4. Resolve `since_sha` via the fallback chain above (if not passed).
5. Compute the changelog: `git log <since_sha>..HEAD --oneline --no-merges`. Capture as a bulleted list.
6. Find PR links via `gh issue view <number> --json closedByPullRequestsReferences` — extract URLs and titles from GitHub's native link references (PRs that say "Closes #N" or are otherwise GitHub-linked to the issue). More reliable than title or body search.
7. Scan commits in the range for the `Refs: #<issue>` trailer. Collect commits LACKING the ref. If any are found, prepare a warning block for the final comment AND print to stdout.
8. Render the final comment: agent summary (verbatim from `--summary`), then changelog bullets (or "_no commits in range_" line), then PR-link section (skip if empty), then deliverables (if provided), then the warning block (if commits missed the ref).
9. `gh issue comment <number> --repo <repo> --body "<final>"`.
10. Ensure label `status:done` exists; create with `gh label create status:done` if missing (warn on creation). Apply it: `gh issue edit <number> --add-label status:done`.
11. `gh issue close <number> --repo <repo> --reason completed`.
12. Delete `$REPO_ROOT/.claude/.current-task`.
13. Print one-line confirmation: `Completed: #<number> — closed; <N> commits, <M> PRs`.
14. **Write history entry** to `$REPO_ROOT/.claude/skills/task-complete/history/<YYYY-MM-DD>-<short-run-id>.md`. Outcome: `success` if all steps succeeded; `partial` if there were no commits in range; `failure` if any required step failed.

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
