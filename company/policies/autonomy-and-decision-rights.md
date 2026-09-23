---
title: Autonomy and decision rights
slug: autonomy-and-decision-rights
owner: coo
effective_date: <set on adoption, YYYY-MM-DD>
version: 0.1.0
---

# Autonomy and decision rights

The rule in one line: **a decision is made by whoever holds the right for that class of risk, not by
whoever sits higher in the chain. Agents do everything that is reversible; a human decides what is
irreversible or visible outside the company; an independent check stands between the two.**

This policy ships with the OPOS framework as a starting point. It is company-owned from the moment it
is scaffolded: adjust the examples, fill in the holders (§3) and thresholds (§10), and record the
adoption switches (§11). Where an agent definition and this policy disagree, this policy wins.

## 0. Why

The first shape of an agent company copies a human one: `eng-lead → rnd-lead → coo → ceo → human`,
"design a sub-role when load justifies it", "agent calls are expensive, save them". Every hop in that
chain is a wait, and the wait is paid in human attention, which is the one resource that does not
scale. An agent instance costs cents; the scarce things are **access** (credentials a human must grant
once), **verification** (knowing that a claimed result is true), and **human attention** itself.

Symptoms that a company is still running the old shape:

- The `founder-action` queue grows faster than it shrinks, and a large share of it is errands an agent
  could have done with one-time access (a secret, a DNS record, an account setting).
- Finished work sits waiting on a single "click" step for days.
- Agent definitions carry thresholds nobody ever set ("> $X"). An agent that does not know what it may
  decide escalates everything.
- Whole departments have zero processes, so every request to them is ad-hoc.

The opposite risk is why autonomy cannot simply be switched on: the costliest agent mistakes are not
slow decisions but **confident false claims** — "fixed" read from code while the live system still
fails; "not signed" inferred from a missing local copy. A swarm of agents multiplies output and
unverified claims at the same rate. The scale of autonomy is therefore bounded not by the number of
agents but by **verification** (§4).

## 1. Four decision classes

The class belongs to the **action**, not to the agent and not to the task. One task usually contains
actions of several classes.

| Class | What it is | Who decides | What the agent does | Examples |
|---|---|---|---|---|
| **R0** | reversible and inside the repository / the agents | the agent | does it, writes history | analysis, a draft, a file in its own area, an issue or comment, labels, a branch, a read-only run |
| **R1** | reversible but visible to the team | the agent | does it **and reports** in one line (the task issue or the team channel) | a commit to the default branch in its own area, closing an issue **with evidence**, a message to the internal team channel, a deploy to a dev/staging environment, regenerating a dashboard |
| **R2** | costly to undo, or touches production / shared infrastructure | the agent — **only after a checker PASS** (§4) | does it after an independent check and reports it with the verdict | a production deploy through its gates, a DNS record on a company domain, a CI secret or variable (with access already granted), a data migration, deleting data under the company's own retention rule, editing a schedule or workflow file on a human's instruction |
| **R3** | money; anything a customer or counterparty sees; access and credentials; contracts and legal commitments; hiring; putting a new agent into service; company priorities | **a human** (§3) | prepares everything to one click — draft, recommendation, options — and asks **one question** | sending a message to a counterparty, a price, a signature, granting a token, a payment, a strategic choice |

**Choosing a class when it is not obvious:**

1. Undoing it costs more than a `git revert` or restoring one file → one class higher.
2. Unsure between two classes → the higher one.
3. It touches money, a counterparty, access or a contract, even indirectly → R3, whatever its
   reversibility. These are the five OPOS never-automate invariants (credential and access grants,
   adopting an agent, registering schedules, outbound writes, money). **This policy never lowers them**,
   and neither does the ladder in §5.
4. A claim that something "does not exist / was not signed / was not done" about documents, money or
   obligations is not an action, but actions will rest on it: verify it from several independent
   sources before any class applies (§4.4).

## 2. Rights by risk, not by rank

- **Escalation goes straight to the holder of the right** (§3), skipping intermediate levels. Chains
  such as `eng-lead → rnd-lead → coo → ceo` are a map of zones, not an approval path.
- A department lead **does not approve** each action in its zone. A lead owns the zone's *process
  portfolio*, its metrics, and the design of the processes it is missing.
- An agent **does not wait** where an action is R0/R1: it acts and reports. Asking permission for R0/R1
  is a violation of this policy, not caution — it turns humans back into a queue.
- An R3 escalation follows the steward's tried-and-failed contract: what was tried, what exactly failed,
  and **the smallest action a human can take**. It is always a GitHub issue labelled `founder-action`,
  with one owner. One decision, one issue.

## 3. Who holds R3 rights

By default, **the human CEO** holds every R3 right. Delegation is a row in this table, with a date and
the delegating person's name; without a row there is no delegation.

| R3 action class | Holder | Basis (date, who delegated, reference) |
|---|---|---|
| Everything not listed below | the human CEO | role |
| _(example)_ publishing an internal digest after a draft | _(a named person)_ | _(date, issue link)_ |

Only a human adds rows. **An agent never writes to this table.**

## 4. Maker/checker: whoever made it does not check it

1. Every **R2** action, and every "done" claim on a task above R0, passes through a checker — the
   `result-checker` agent via the `check-result` process.
2. The checker is **a different instance** and, wherever possible, **a different method**: a UI is
   checked in the UI; DNS with a public resolver; a deploy with a live request; a number by recomputing
   it from the primary source; "sent" in the sent folder or the recipient's system, not the sender's log.
3. The checker cannot write to what it checks. It returns `PASS | FAIL | UNVERIFIABLE` and names its
   method and evidence. `UNVERIFIABLE` is never `PASS`.
4. Higher risk = **more independent methods**, not one more careful one. R2: at least two. Negative
   claims about documents, money or obligations: search every system the fact could live in, including
   the counterparty-facing ones, and ask whether the company ever *behaved* as if the fact were true.
   External facts: sources of different types (primary source, independent reference, practice). Each
   process states its own number in the `checker:` field of its `PROCESS.md`.
5. **The human who set the task remains accountable.** The checker removes the routine of re-checking,
   not the responsibility: the human sees the verdict and the method and can ask for more.

## 5. The earned-autonomy ladder

An action is not sentenced to R3 forever. A specific **narrow class** of actions inside a specific
process can move down a rung — on evidence, not on confidence.

| Rung | What happens | Moving on |
|---|---|---|
| `off` | the agent prepares; the human does it | the holder of the right switches to `shadow` |
| `shadow` | the agent decides and **records** what it would have done; the human does it and compares | **N** consecutive matches with no human correction (N set by the holder of the right) |
| `on` + cap | the agent acts by itself within the narrow class and a daily cap; every action is reported | any human correction or checker FAIL → back to `shadow` automatically |

Every new process with R3 actions **must** declare its rung in `PROCESS.md` (`autonomy_ladder:`).
Moving a rung is always the holder's decision (§3), never the agent's. Actions covered by a
never-automate invariant can reach `shadow` at most; this policy gives no route past that.

## 6. Role and worker: how many agents a company needs

- A **role** is a definition in `.claude/agents/`: a zone of responsibility, processes, tools. A
  **worker** is a running instance of a role. A company may have dozens of roles; it runs as many
  workers at once as its queue needs.
- Scale by **instances**, not by hiring. "Design a sub-role when load justifies it" is no longer a
  criterion. A new role is justified by **a separate zone** — its own lease key, its own labels, its own
  processes — not by volume.
- Every role has: a zone (what its lease covers), at least one process, and a named checker. A role
  without a process is not staff; it is a file that will drift.
- Parallel workers of one role do not collide because **each takes a lease** (the `lease` skill) — a
  non-zero exit is a stop.
- Putting a new role into service is R3 (never-automate invariant 2): an agent designs it, a human
  adopts it.

## 7. C-level agents: governance, not an approval chain

| Agent | Role under this policy |
|---|---|
| `ceo` | keeps `company/strategy/` priorities and metrics; weekly, checks whether the work in flight moves the priorities; arbitrates zone conflicts between agents. **R3 decisions stay with the human CEO** — the agent prepares them |
| `coo` | operator of the agent fleet: queue and dispatch health, stuck work, leases, runtime, process SLAs |
| department leads | owners of a zone: its process portfolio, its metrics, designing the missing processes (`design-process --draft`), R0–R2 inside the zone |
| `chief-of-staff` | the human's entry point, plus dispatch (§8) |

## 8. Dispatch and runtime

- **The queue is GitHub issues.** For every open task, dispatch decides the zone → the owning agent, the
  executor (agent / human / agent after an access grant), the decision class, and occupancy (the lease).
  The steward does this when it picks up work; a company may also run it as a scheduled projection of
  "what an agent can take right now".
- **The runtime is not one laptop.** A schedule bound to one workstation stops when that machine sleeps,
  runs on battery, or has its folders moved. New scheduled processes default to a durable runtime
  (`cloud` or `gha`); moving existing ones is ordinary R&D work.

## 9. Autonomous R&D

R&D does infrastructure itself once access exists: DNS, secrets, environment variables, account
settings (through a registered API token or the operator's browser session registered as a resource),
deploys through their gates. A human grants access **once per class of task** (`acquire-resource`);
from then on that class is agent work at R1/R2.

If the company develops its product code in a separate repository under its own delivery pipeline, R&D
agents in the OPOS repository **orchestrate** that pipeline (frame the task, verify the result where it
lives) rather than editing the product code from here.

## 10. Models, spend and thresholds

- Coding and execution roles may run on a faster model (`sonnet`); leads, architecture and the checker
  stay on the strongest reasoning model (`opus`). Heavy research may use whatever model the company
  designates for it.
- The budget rule is not "save calls" but **"spend with purpose"**: every autonomous run is filtered by
  what it changes for the company.
- Thresholds. Agent definitions point here instead of carrying their own "$X". **While a value is
  unset, the matching decision is R3.**

  | Threshold | Value | Set by |
  |---|---|---|
  | Monthly cost of a new process or agent above which a human decides | _unset_ | the human CEO |
  | Monthly ceiling for all autonomous agent work | _unset_ | the human CEO |
  | Deal or contract size above which commercial work needs a human, beyond what is already R3 | _none by default_ — anything a counterparty sees is already R3; internal analysis is R0 at any size | the human CEO |

- Any payment is always R3 (never-automate invariant 5). It has no threshold.

## 11. Adoption switches

Some parts of this policy are safe to apply on day one; others need a human's word first. Record the
state here; an agent reads this table, never writes it.

| Part | Default until a human changes it |
|---|---|
| §1 R0/R1 and "do not ask permission for R0/R1" | **in effect** |
| §2 escalation straight to the holder | **in effect** |
| §4 maker/checker | **in effect** |
| §6 role vs worker, §7 C-level roles | **in effect** as design rules |
| §1 R2 "agent acts after a checker PASS" (production, DNS, secrets) | **off — R2 is handled as R3** until the human CEO switches it on |
| §3 delegated holders, §5 ladder N, §10 thresholds | **unset** — the conservative reading applies |

## Review cadence

Monthly (`coo`), and on any incident: a checker FAIL on an R2 action, or an agent's own action being
rolled back, is a reason to revisit that action's class.
