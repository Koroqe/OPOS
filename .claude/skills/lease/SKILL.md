---
name: lease
description: Take, renew, release and verify a lease on a shared resource (issue, path, process, branch) so that multiple OPOS sessions on multiple machines and runtimes do not collide. The gate is an exit code, not a convention.
version: 0.1.0
tags: [meta, framework, concurrency, github, multi-session]
owner_agent: coo
---

# lease

## When to use

**Before the first write to any shared area** — where "shared" means anything another session
could also be writing: a task issue, a folder, a scheduled process, a branch.

Read-only work needs no lease. A session that only reads takes nothing.

## Why this exists

An OPOS company is written to by several actors at once: interactive sessions on different
machines, scheduled jobs, CI bots, cloud routines. Before this skill, none of them could see what
the others were doing, and the three signals that *looked* like occupancy each meant something
else:

| Signal | What it actually means |
|---|---|
| `.claude/.current-task` | Per-machine and gitignored. Bare issue numbers, no holder, no timestamp. Another machine cannot see it at all. |
| `assignee` | **Ownership** — who is accountable for the outcome. Not "who is touching this right now". |
| `**Status:** in_progress` in the issue body | Only set if someone passes `task-update --status`, through an unguarded read-modify-write. |
| A project-board column | Moved by a human, on their own schedule. Nothing in OPOS writes it. |

The failure that follows is not exotic. Two agents write into the same folder and one commit
buries the other's half-finished file. A session appends to a shared log while another is
mid-run. A clone that has silently fallen behind serves scheduled jobs and reports success.

This skill makes occupancy a fact any actor can check, on any machine, in one call.

## Inputs

- `--key` — `issue:<owner>/<repo>#<N>` | `path:<glob>` | `process:<name>` | `branch:<name>`
- `--scope` — comma-separated globs this holder may write (defaults to the glob for `path:` keys)
- `--intent` — one line: what is being done. Mandatory for `path:**`.
- `--ttl` — `45m`, `2700s`, `1h`. Defaults per runtime; hard cap 4h without `--long`.

## Setup

```bash
node .claude/skills/lease/lease.mjs init-ledger --create   # opens + pins the registry issue
node .claude/skills/lease/lease.mjs doctor                 # identity, clock, clone, ledger
```

`ledger.repo` may stay `null` in `.claude/lease.config.json`, in which case the skill reuses
`repo` from `.claude/task-tracking.config.json` — the repo is configured in exactly one place.

## The contract is the exit code

| Code | Meaning | What the caller must do |
|---|---|---|
| 0 | held / gate open | proceed |
| 1 | bad args, unparseable record | stop, surface verbatim |
| 2 | **CONFLICT** — a live holder | stop; the message names holder, expiry and intent. Offer `steal` only at Confirm tier. |
| 3 | **STALE CLONE** | `git pull --ff-only`, then retry. **Never work around.** |
| 4 | **NO LEASE** — gate closed | `acquire` first |
| 5 | **REVOKED / EXPIRED** | stop writing immediately; re-acquire |
| 6 | **NO AUTH / NETWORK** | fail closed. `--offline-ok` is honoured only by `check`, `commit-gate` and `list`, and only an unexpired cached lease opens a gate; nothing that would write a claim works offline |
| 7 | **SCOPE VIOLATION** — staged paths outside your lease | unstage the named paths; do not widen the commit |
| 8 | **CLOCK SKEW** > 600s | fix the clock; the tool refuses to participate |
| 9 | **NOT CONFIGURED** — this company has not opted in (no registry) | skip the gate and behave exactly as before; opt in with `init-ledger --create` |

## Calling the lease from another skill

Since v0.17.0 the task-lifecycle skills and the scheduled drivers call this skill themselves:

| Skill | Lease step |
|---|---|
| `task-register` | `acquire issue:<repo>#<N>` right after the issue is created |
| `task-update` | `check` before writing, `renew` after posting |
| `task-complete` | `check` before closing, `release` after |
| `task-pause` | `release --state yielded`, plus the `paused` label |
| `task-resume` | `acquire` **before** touching local state — refuses if another machine resumed it |
| `auto-sync` | `acquire process:auto-sync` and `path:**` after the fast-forward, released on every exit |
| `review-history` | `acquire process:review-history`; `process:propose-to-core` around upstream PRs |

Every caller handles the exit code the same way:

| Exit | Caller does |
|---|---|
| `0` | proceed |
| `9` | print `lease: not configured, gate skipped` and proceed **exactly as before leases existed** |
| `2` | stop; report the holder, expiry and intent from the message. Scheduled drivers write a `partial` record — another run has it, the next fire retries |
| `3` | stop; `git pull --ff-only`, then retry |
| `4` | (on `check`) take the lease with `acquire`; if that exits `2`, stop |
| `5` | the lease lapsed or was taken: `acquire` it again — `0` means it merely lapsed and nobody took it, carry on; `2` means someone else holds it now, stop |
| `6`, `7`, `8`, `1` | stop and report verbatim |

Exit `9` is the upgrade guarantee. A company that has not run `init-ledger` has not opted in, and pulling a new OPOS release must not change how its task lifecycle behaves.

Under `enforce: warn`, `check` and `commit-gate` return `0` for what would have been a refusal, and log it to `.state/would-block.jsonl` instead. `acquire` always refuses a conflict with `2`, whatever the mode — the protocol cannot be half-applied to the act of claiming.
## Procedure

```
acquire --key <k> [--scope <globs>] [--intent "..."] [--ttl 45m]
 1. identity      login + host + clone_id + session + runtime; skew vs GitHub  → exit 8 if > 600s
 2. freshness     behind / fetch age / dirty-outside-scope                     → exit 3 on any
 3. READ          live claims for the key   — fast path: held → exit 2, ZERO writes
 4. POST          my claim comment
 5. SETTLE        1500ms (x2 with --paranoid)
 6. RE-READ       live claims
 7. TIEBREAK      lowest comment id wins; loser DELETEs its own comment and backs off
 8. INDEX         apply the index label (own-repo issues only), cache the back-pointer
```

Step 3 is what makes this cheap at fleet scale: the common case (someone already holds it) costs
one GET and writes nothing, so polling sessions generate no comment churn.

`renew` PATCHes the same comment — it never posts a second one. Edits do not notify, so a lease
costs exactly one notification for its whole lifetime.

## Where a claim lives

- `issue:` on **the ledger repo** → a comment on that issue, so a human reading the task sees it.
- everything else (`path:`, `process:`, `branch:`, and issues of other repos) → the pinned
  registry issue named in `.claude/lease.config.json`.

The split exists because permissions differ per repo: in a repo where you can comment but not
label, the lease must still be recorded somewhere you control.

## Commands

```bash
node .claude/skills/lease/lease.mjs acquire --key "path:company/ops/**" --scope "company/ops/**" --intent "regenerate projections"
node .claude/skills/lease/lease.mjs check   --key "issue:<owner>/<repo>#<N>"
node .claude/skills/lease/lease.mjs renew   --all
node .claude/skills/lease/lease.mjs commit-gate
node .claude/skills/lease/lease.mjs release --key "..." --reason "done"
node .claude/skills/lease/lease.mjs list [--mine] [--no-net] [--json]
node .claude/skills/lease/lease.mjs steal   --key "..." --reason "clone silent 40 minutes"   # Confirm tier
node .claude/skills/lease/lease.mjs reap [--dry]            # scheduled; cosmetic only
node .claude/skills/lease/lease.mjs render --out company/ops/ops-leases.md
node .claude/skills/lease/lease.mjs audit [--json]          # read-only anomaly report
node .claude/skills/lease/lease.mjs doctor
```

## The registry itself

- **Closed by hand → stop.** GitHub still accepts comments on a closed issue, so without this check the protocol would keep "working" against a registry nobody watches. A registry closed without a rotation pointer makes every command exit `1`, with the repair command in the message.
- **Rotation.** When the registry holds more than `rotate_at_comments` records after pruning, `reap` opens a successor carrying `opos-lease-ledger-prev: <old>`, points the old one at it with `opos-lease-ledger-next: <new>`, and closes it. Every command follows that pointer. Claims written to the old registry stay visible through the predecessor link until they lapse, so a live lease is never lost to a rotation. Comment ids are repo-global and monotonic, so the lowest-id tiebreak holds across the two issues. The steps are ordered so that a crash at any point is repaired by running `reap` again. `reap --rotate-now` forces one.
- **Resolution is cached** for ten minutes in `.state/ledger.json`: one extra call per ten minutes, not one per command.

## Crash recovery has no daemon

**Expiry is authoritative; reaping is cosmetic.** `acquire` beats a corpse whose `expires` has
passed even if no reaper has ever run. `reap` only tidies the record — flips `held`→`expired`,
reconciles the index label in both directions, prunes week-old terminal comments.

This is deliberate. A design whose correctness depends on a scheduled job firing inherits every
way that job can silently stop firing — which is the most common way automation dies.

## Enforcement staging

`.claude/lease.config.json` → `enforce`, either a string or a per-key-type map:

```json
"enforce": { "path": "on", "branch": "on", "issue": "warn", "process": "warn" }
```

In `warn` mode every would-be refusal returns 0 and is appended to `.state/would-block.jsonl`.
That file is the evidence a human reads before enforcement is switched on: a refusal rate that
would have blocked legitimate work is a design bug, and warn-mode is the only way to see it
before it costs a working day. `OPOS_LEASE_ENFORCE=on|warn|off` overrides per invocation.

## Residual risk — stated, not hidden

1. **Comment ids order, they do not serialize.** GitHub's comment list is replica-served; the
   1500ms settle is empirical, not contractual. Two acquirers can in principle each see only
   themselves. The window is seconds; the loser discovers it at the next `renew` and must yield.
   A git-ref CAS (`git push origin <sha>:refs/opos/leases/<hash>`) would remove the window
   entirely and layers in under the same record format — parked as a future hardening.
2. **Scale ceiling is roughly 50–100 concurrent acquires**, and the wall is GitHub's *secondary*
   (content-creation) limit, not the 5000/h primary. Use one token per runtime class, never one
   token for a whole fleet. Rotation bounds a registry's size; **sharding across several
   registries is not built**.
3. **Two sessions inside one clone** share `clone_id`: correctly treated as one holder for
   `path:` keys, **not separated** for `issue:` keys. Mitigated only by one-clone-per-repo.
4. **A lease in a repo you do not control advertises intent; it does not exclude.** A session
   there that does not run this protocol is not stopped by it.
5. **A live-but-not-renewing holder** (mid-`copier update`, mid-long-build) can keep writing after
   being stolen from. Mitigated by the interactive TTL and the half-TTL steal floor, not solved.

## Tests

```bash
node --test .claude/skills/lease/lib/keys.test.mjs .claude/skills/lease/lib/claims.test.mjs
node .claude/skills/lease/test/collision.mjs --rounds 20   # opens and closes a throwaway issue
node .claude/skills/lease/test/scenarios.mjs               # stale clone, scope, crash, steal, cross-machine
```

The collision suite prints a measured double-claim rate. That number, not an adjective, is the
bound on residual risk 1 — record it in a `history/` entry when you run it.
