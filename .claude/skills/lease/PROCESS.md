---
process_name: lease
owner: coo
collaborators: [chief-of-staff, ops-manager]
inputs: [key, scope, intent, ttl]
success_criteria: [identity_resolved, clock_checked_against_server, clone_freshness_checked, conflict_detected_before_any_write, tiebreak_deterministic, loser_withdrew_own_claim, index_label_reconcilable, expiry_recoverable_without_reaper, history_entry_written]
slo: "6 seconds for acquire (one settle window plus three API calls); under a second for a cache-hit check"
version: 0.1.0
---

# lease

## Narrative

Gives OPOS one primitive for mutual exclusion across machines and runtimes: a **lease over a
key**, stored as a claim comment on GitHub — the only coordination plane every writer class can
reach. It replaces a situation in which occupancy was inferred from three signals that each meant
something else (local task state is per-machine, an assignee is ownership, a board column is
manual) and therefore could not be relied on by anyone.

The protocol's only ordering primitive is GitHub's server-assigned, monotonic comment id. That
gives a deterministic tiebreak; it does **not** give atomicity, and the skill says so rather than
implying a guarantee it cannot make.

## Pre-conditions

- `gh` authenticated with `repo` scope on the ledger repo.
- `.claude/lease.config.json` present, with a registered `ledger.issue`
  (`lease.mjs init-ledger --create`). `ledger.repo` may be null; it then falls back to `repo` in
  `.claude/task-tracking.config.json`.
- The registry issue is OPEN and carries the `lease-ledger` label.
- `node` >= 18. Deliberately not Python: the skill must run identically on every machine a
  company uses, and `python3` is not reliably present or executable on all of them.

## Steps

Mirrors the procedure in SKILL.md:

1. Resolve repo root and load config.
2. Resolve identity: login (24h cached), host, clone_id, session, runtime.
3. Fetch server time from the `Date` header of `gh api -i /rate_limit` (does not consume quota);
   compute skew. Refuse above the fail threshold.
4. Compute clone freshness: branch, HEAD, behind-count, fetch age, files modified outside scope
   in the last dirty window. Refuse on any.
5. Read live claims for the key. If contended, exit 2 **having written nothing**.
6. Post the claim comment.
7. Settle.
8. Re-read; lowest live comment id among conflicting claims wins.
9. If not the winner: delete own comment, jittered backoff, retry or exit 2.
10. If the winner: apply the index label (own-repo issues), PATCH the record with its ledger
    back-pointer, cache locally, cross-post to configured repos if applicable.
11. Write a history entry.

## Post-conditions

- Exactly one live claim exists for the key, or the caller received a non-zero exit.
- The local cache at `.state/held/<keyhash>.json` points at the claim comment.
- Losing a race leaves **no** residue: the loser deletes its own comment.

## Failure modes

| Mode | Behaviour |
|---|---|
| Registry issue closed by a human | `acquire` exits 1 naming the repair command. A ledger closed *with* a `-next` pointer is rotation and is followed. |
| Secondary rate limit (403) | Classified as back-off, never as a hard error. Honour `Retry-After`. |
| Crash between POST and label | The index lies; `reap` reconciles in both directions. **The label is an index, never a source of truth.** |
| Crash while holding | The lease expires on TTL; `acquire` beats the corpse with no reaper involved. |
| Clock skew | Expiry always uses server time. Warn above 120s, refuse above 600s. |
| `gh` offline or unauthenticated | Exit 6, fail closed. `--offline-ok` requires an unexpired cached lease. |
| GitHub unreachable mid-`renew` | **Not** treated as revocation: the cache is kept and exit 6 returned. Only a true 404 means the claim is gone. |
| A paused task that still holds a live lease | `reap` **flags and does not auto-fix** — auto-fixing would let a pause issued on one machine kill live work on another. |

## Scheduling

Not scheduled itself. `reap` and `render` should **piggyback an existing schedule** rather than
adding cron of their own:

- **reap** — attach to whichever scheduled job in your company demonstrably fires unattended.
  Prefer one that already serialises itself (a GitHub Actions `concurrency` group), so two reaps
  cannot race. Mark the step `continue-on-error`: protocol correctness does not depend on it.
- **render** — attach to whichever job regenerates your other `company/ops/` projections, and use
  `render --out <path>` rather than a shell redirect. `--out` leaves the file untouched when
  occupancy has not changed, so the bot does not commit a fresh timestamp every day.
- **observation** — a read-only detector can call `lease.mjs audit --json` and report leases held
  over four hours, holders on a clone with `behind > 0`, paused-but-leased issues, and index
  drift. Reporting only; it must not fix anything by itself.

## Success criteria, verified

Run `node .claude/skills/lease/test/collision.mjs --rounds 20` and
`node .claude/skills/lease/test/scenarios.mjs`. The collision suite must be 20/20 with exactly one
surviving claim per round; its measured double-claim rate is the documented bound for residual
risk 1 and belongs in the history entry as a number, not an adjective.
