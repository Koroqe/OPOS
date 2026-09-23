---
title: Autonomy and decision rights
slug: autonomy-and-decision-rights
owner: coo
effective_date: <set on adoption, YYYY-MM-DD>
version: 0.2.0
---

# Autonomy and decision rights

The rule in one line: **a decision is made by whoever holds the right for that class of risk, not by
whoever sits higher in the chain. Agents do everything that is reversible and stays inside; a human
decides what is irreversible, visible outside the company, or touches money, access or commitments; an
independent check stands between the two.**

This policy ships with the OPOS framework as a starting point. It is company-owned from the moment it
is scaffolded: adjust the examples, fill in the holders (§3) and thresholds (§10), and record the
adoption switches (§11). Where an agent definition, a process, or any derived document (a triage, a
plan, a dispatch projection) and this policy disagree, this policy wins.

## 0. Why

The first shape of an agent company copies a human one: `eng-lead → rnd-lead → coo → ceo → human`,
"design a sub-role when load justifies it", "agent calls are expensive, save them". Every hop in that
chain is a wait, and the wait is paid in human attention, which is the one resource that does not
scale. An agent instance costs cents; the scarce things are **access** (credentials a human must grant
once), **verification** (knowing that a claimed result is true), and **human attention** itself.

Symptoms that a company is still running the old shape:

- The `founder-action` queue grows faster than it shrinks, and a large share of it is errands an agent
  could have done by *using* an access a human granted once (a DNS record through a registered token, a
  deploy through its gates).
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

| Class | What it is | Who decides | What the agent does |
|---|---|---|---|
| **R0** | reversible and stays inside the company — no client data outside the places it is kept | the agent | does it, writes history |
| **R1** | reversible but visible to the team | the agent | does it **and reports** in one line on the task issue |
| **R2** | costly to undo, or touches production / shared infrastructure — **using an access already granted** | the agent — after a checker PASS on the **plan** and a checker PASS on the **result** (§4) | checks the plan, acts, checks the result; **rolls back** on a result FAIL |
| **R3** | money; anything a customer or counterparty sees; **creating, changing or revoking access, credentials, secrets, aliases or memberships**; contracts and legal commitments; **deleting client data; moving client data to a new service or region**; hiring; putting a new agent into service; **new or changed scheduled workflows** and the `authority:` of a scheduled run; company priorities | **a human** (§3) | prepares everything to one click — draft, recommendation, options — and asks **one question** |

Examples. R0: analysis, a draft, a file in its own area, an issue or comment, labels, a branch, a
read-only run. R1: an operational record committed to the default branch in its own area, closing an
issue **with evidence**, a deploy to a dev/staging environment, regenerating a dashboard. R2: a DNS
record through a registered token, a production deploy through the project's gates, a migration of the
company's own technical data, deleting the company's own non-client data under its retention rule. R3:
a message to a counterparty, a price or terms, a signature, granting or revoking a token, **writing a
CI secret**, adding a mailbox alias or an org member, **a new cron or a changed workflow schedule**, a
payment, a strategic choice.

**Choosing a class:**

1. Undoing it costs more than a `git revert` or restoring one file → one class higher. **Choosing a
   higher class when unsure is never a violation.**
2. It touches money, a counterparty, access, a contract, or client data leaving the place it is kept,
   even indirectly → R3, whatever its reversibility.
3. The five OPOS never-automate invariants (credential and access grants, adopting an agent,
   registering schedules, outbound writes, money) are always R3. **This policy never lowers them, nor
   does a granted access, nor the ladder in §5** (§5 moves narrow outbound classes only, under its own
   hard limits).
4. **A granted access does not lower the class.** Once a human grants an access, *using* it inside its
   defined task class becomes agent work (R1/R2). Creating, changing, widening or revoking accesses,
   secrets, aliases and memberships stays R3 — including writing a secret with a token that technically
   permits it.
5. **A derived document cannot lower a class.** A triage, a plan or a report that records an action
   lower than these rules give is wrong; where they disagree, this policy applies.
6. **Any projected class is a hint.** A class shown by dispatch, a queue projection or a keyword match
   is a suggestion; the agent acting classifies each action itself under rules 1–5.
7. A claim that something "does not exist / was not signed / was not done" about documents, money or
   obligations is not an action, but actions will rest on it: verify it from several independent
   sources before any class applies (§4.4).

## 2. Rights by risk, not by rank

- **Escalation goes straight to the holder of the right** (§3), skipping intermediate levels. Chains
  such as `eng-lead → rnd-lead → coo → ceo` are a map of zones, not an approval path. A department lead
  owns the zone's *process portfolio* and its metrics; it does not approve each action.
- **Own area** = the scope of a live lease **and**, if the company labels tasks with an owner human, the
  task's owner label matches the human the session works for. Other humans' tasks: comments only.
- An agent **does not ask** where an action is R0/R1: it acts and reports. Asking permission for R0/R1
  turns humans back into a queue. A **process may set gates stricter than its class** for quality
  calibration (a human "ok" on each output while the process is new) — that is not a violation.
- **R3: one decision, one issue.** A GitHub issue labelled `founder-action`, owned by the holder, under
  the steward's tried-and-failed contract: what was tried, what exactly failed, and **the smallest
  action a human can take**. Exception: per-message send approvals that already have their own approval
  channel inside a process (an approval button, a per-client issue) and their own approval log stay in
  that channel — they are not re-filed one issue each.
- **Notifications do not multiply.** R1/R2 reports go as a comment on the task issue. Chat channels get
  a digest at the process's cadence, not a line per action. R3 questions to one human are batched once
  a day, except for what is urgent.

## 3. Who holds R3 rights

By default, **the human CEO** holds every R3 right. Delegation is a row in this table, with a date and
the delegating person's name; without a row there is no delegation.

| R3 action class | Holder | Basis (date, who delegated, reference) |
|---|---|---|
| Everything not listed below | the human CEO | role |
| _(example)_ publishing an internal digest after a draft | _(a named person)_ | _(date, issue link)_ |
| Break-glass for access (a second admin who can grant and revoke when the first is unavailable) | _(a named person — set it)_ | _(date, who delegated)_ |

Only a human adds rows. **An agent never writes to this table.** Worth deciding early: who holds R3
outside working hours, and the longest an R3 question may wait before it goes to them.

## 4. Maker/checker: whoever made it does not check it

1. **R2 = two checks.** Before the action, the checker reviews the **plan**: what changes, how it will
   be rolled back, how the result will be verified. After the action, the checker verifies the
   **result** where it lives. A result FAIL → roll back per the plan. Every "done" claim on a task above
   R0 also passes through the checker — the `result-checker` agent via the `check-result` process.
2. The checker is **a different instance** and, wherever possible, **a different method**: a UI is
   checked in the UI; DNS with a public resolver; a deploy with a live request; a number by recomputing
   it from the primary source; "sent" in the sent folder or the recipient's system, not the sender's log.
3. The checker cannot write to what it checks. It returns `PASS | FAIL | UNVERIFIABLE` and names its
   method and evidence. `UNVERIFIABLE` is never `PASS`: the action moves one class higher.
4. Higher risk = **more independent methods**, not one more careful one. R2: at least two. Negative
   claims about documents, money or obligations: search every system the fact could live in, including
   the counterparty-facing ones, and ask whether the company ever *behaved* as if the fact were true.
   External facts: sources of different types (primary source, independent reference, practice). Each
   process states its own number in the `checker:` field of its `PROCESS.md`.
5. **Evidence as pointers, not content.** A verdict records a path, a hash, a query, a URL, a command —
   never client figures, correspondence, personal data or confidential deal data copied into an issue
   or a chat.
6. **A checker PASS is evidence for the responsible human, not a replacement of their check** for the
   classes "client", "money" and "documents". "An agent checked it" is not a human check there. **The
   human who set the task remains accountable**; the checker removes routine re-checking, not
   responsibility.
7. A task with no human author (created by an agent or by dispatch) is not executed at R2/R3 until a
   human takes it as owner.

## 5. The earned-autonomy ladder

An outbound action is not sentenced to R3 forever. A specific **narrow class** of actions inside a
specific process can move down a rung — on evidence, not on confidence.

| Rung | What happens | Moving on |
|---|---|---|
| `off` | the agent prepares; the human does it | the holder of the right switches to `shadow` |
| `shadow` | the agent decides and **records** what it would have done; the human does it and compares; every draft passes the compliance checklist (rule 2) | **N** consecutive matches with no human correction **and no checklist failure** (N set by the holder of the right) |
| `on` + cap | the agent acts by itself within the narrow class and a daily cap; every action is logged; each output passes an independent checker call | spot checks by a human after the fact; demotion per rule 4 |

1. **The class is defined positively**: which recipients, which templates, which topics. Anything
   outside that definition (an unlisted recipient type, a named client or live mandate) → stop, R3.
2. **A compliance checklist on every draft in `shadow`** — a failure resets the streak even if the
   human did not edit the draft: no confidential identity (e.g. a seller or client) before an NDA; no
   prices, fees, exclusivity, terms, commitments or promised dates; no offer of securities; a working
   opt-out and a suppression-list check. Companies add their own lines.
3. **Never laddered:** outbound that a client contract bars; content that describes an offering of
   securities or solicits investment, **until counsel has given a written opinion** recorded by the
   company; accepting, agreeing to or changing terms.
4. **Anyone may demote; only the holder promotes.** Any agent or human may move a class down to
   `shadow` or `off` — a one-sided safety step. **Automatic demotion to `shadow`** on: any human edit, a
   checker FAIL, a complaint, an unsubscribe, a block, or a negative reply from the counterparty.
5. **`on` requires an independent checker call** (`result-checker`) on each output — the drafting
   model's self-check is not enough.
6. **A company-wide outbound pause flag** (e.g. `OUTBOUND_PAUSE`) that any human or the checker may set
   stops every `on` class until a human clears it.
7. Every process with an outbound step **must** declare its rung in `PROCESS.md` (`autonomy_ladder:`) —
   new and existing ones. An outbound class that already runs automatically without these conditions
   is recorded as an explicit exception and decided by the holder, not left implicit.

Moving up a rung is always the holder's decision (§3), never the agent's. Access, adopting an agent,
schedules and money have no ladder.

## 6. Role and worker: how many agents a company needs

- A **role** is a definition in `.claude/agents/`: a zone of responsibility, processes, tools. A
  **worker** is a running instance of a role. Scale by **instances**, not by hiring.
- **Capacity decision order** (complements `allocate-resource`):
  1. the work fits an existing zone (lease key, zone label) → **more workers** of that role;
  2. recurring work with no process → **a process** (`design-process`);
  3. a new zone — its own lease key, its own zone label, at least one process → **a new role**
     (`design-agent`; putting it into service is R3, never-automate invariant 2);
  4. it fails the AI-first questions → **a human**.
- A zone is a zone label and a lease key, not a human owner label.
- Every role has: a zone, at least one process, and a named checker. A role without a process is not
  staff; it is a file that will drift.
- **Bounded parallelism.** At most **3 concurrent workers per role** until a human sets the monthly
  spend ceiling (§10). Each worker takes its own lease (the `lease` skill); a non-zero exit is a stop.

## 7. C-level agents: governance, not an approval chain

| Agent | Role under this policy |
|---|---|
| `ceo` | keeps `company/strategy/` priorities and metrics; weekly, checks whether the work in flight moves the priorities; **recommends** on zone conflicts between agents — taking over another session's lease is a human decision. **R3 decisions stay with the human CEO** — the agent prepares them |
| `coo` | operator of the agent fleet: queue and dispatch health, stuck work, leases, runtime, process SLAs |
| department leads | owners of a zone: its process portfolio, its metrics, designing the missing processes (`design-process --draft`), R0–R2 inside the zone |
| `chief-of-staff` | the human's entry point, plus dispatch (§8) |

**Precedence until a consumer syncs.** Until the framework release carrying this model is synced, the
steward's permission tiers keep governing the actions they name in interactive sessions (Confirm on
`git commit`; Explicit on `git push`, releases and destructive operations). R0/R1 remove the questions
on everything else (issues, comments, labels, files in its own area, drafts, read-only runs).

## 8. Dispatch, commits and schedules

- **The queue is GitHub issues.** For every open task, dispatch decides the zone → the owning agent, the
  executor (agent / human / agent after an access grant), a **class hint** (§1 rule 6), and occupancy
  (the lease). The steward does this when it picks up work; a company may also run it as a scheduled
  projection.
- **Commits.** Operational records go to the default branch (R1). Code, skills, processes and workflow
  files go through a branch and a PR; the merge is R2 after review by `eng-reviewer` and a check. **A new
  or changed workflow with a schedule is R3** (never-automate invariant 3).
- **Scheduled runs act only within BOTH** their registered `authority:` list **and** their class.
  Registering or widening `authority:` is R3.
- **The runtime is not one laptop.** A schedule bound to one workstation stops when that machine sleeps,
  runs on battery, or has its folders moved. New scheduled processes default to a durable runtime
  (`cloud` or `gha`). Work that must run under live browser sessions needs an always-on machine holding
  those profiles and a signal to the owner when a session expires.

## 9. Autonomous R&D

R&D does infrastructure itself **by using accesses already granted**: DNS through a registered token,
deploys through their gates, environment configuration, account settings through a registered resource
(R1/R2). Granting, changing and revoking the accesses themselves — including writing secrets — is a
human's (R3, §1 rule 4).

- **Each access grant** in `company/resources/` has: an owner human, an expiry, a revoke command (the
  kill switch), and a defined task class — the listed tasks it covers; a new task is not silently
  covered.
- **Browser-CDP sessions: one profile per service**, never the owner's personal mail or messengers.
  Actions taken in a human's name are legally that human's: log each one with its run id.
- **Revocation of a one-shot scope is verified** by the checker from another session, not asserted by
  the agent that used it.
- If the company develops its product code in a separate repository under its own delivery pipeline,
  R&D agents in the OPOS repository **orchestrate** that pipeline (frame the task, verify the result
  where it lives) rather than editing the product code from here.

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
  | Monthly ceiling for all autonomous agent work | _unset_ — until set, §6's cap of 3 workers per role applies | the human CEO |
  | Deal or contract size above which commercial work needs a named human, beyond what is already R3 | _none by default_ — anything a counterparty sees is already R3; internal analysis is R0 at any size | the human CEO |

- Any payment is always R3 (never-automate invariant 5). It has no threshold.

## 11. What always stays human, and adoption switches

Always human: the five never-automate invariants (access, adopting an agent, registering schedules,
outbound outside the ladder, money), signing and terms of contracts, deleting client data, moving
client data to a new service or region, and company priorities. **The human who set a task answers for
its result.**

Some parts of this policy are safe to apply on day one; others need a human's word first. Record the
state here; an agent reads this table, never writes it.

| Part | Default until a human changes it |
|---|---|
| §1 R0/R1 and "do not ask permission for R0/R1" | **in effect** |
| §2 escalation straight to the holder | **in effect** |
| §4 maker/checker | **in effect** |
| §6 role vs worker, §7 C-level roles | **in effect** as design rules |
| §1 R2 "agent acts after plan and result checks" (production, DNS through a granted token) | **off — R2 is handled as R3** until the human CEO switches it on |
| §3 delegated holders, §5 ladder N, §10 thresholds | **unset** — the conservative reading applies |

Other company policies (confidentiality, verification, leases) are not overridden by this one — they
constrain *how* an agent acts within its class. Where two rules disagree, the stricter applies.

## Review cadence

Monthly (`coo`), and on any incident: a checker FAIL on an R2 action, an agent's own action being
rolled back, or a counterparty complaint about outbound, is a reason to revisit that action's class.
