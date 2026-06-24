# OPOS

### Run a whole company as one person.

**OPOS is an AI-native operating system for your company — a plain GitHub repo where your mission, your departments, your roles, and your work all live as readable files, run by AI agents.**

> **Why now:** AI agents have made the org chart software. The work a department used to do can now be described, delegated, and executed by an agent. OPOS is the bet that the next great company is one founder, a git repo, and an organization that runs itself.

![Built on Claude Code](https://img.shields.io/badge/built%20on-Claude%20Code-d97706)
![Status: early](https://img.shields.io/badge/status-early%20%26%20evolving-blue)

---

## The big idea

A company is really just a set of decisions, roles, and repeatable work. OPOS encodes all of it as markdown in a single repository: who you are, what you're building, how the work gets done. There's no platform to log into and no runtime to operate — your company *is* the repo. You lead in plain language; an AI organization turns your intent into execution.

Because it's all files in git, your company is auditable, forkable, versioned, and entirely yours. Nothing is locked inside someone else's SaaS.

## The shift

For most of history, ambition was capped by headcount. To do more, you hired more — and hiring is slow, expensive, and hard to undo. OPOS removes that ceiling. When the org chart is software, a single person can hold the leverage of an entire company: a strategy function, a finance function, an engineering function, all staffed by agents that draft, analyze, and execute while you decide what matters.

This is what the "one-person company" actually looks like in practice — not a founder doing everything, but a founder *directing* everything.

## How it feels

You open your repo and talk to your company in ordinary language:

> **You:** Let's ship the new pricing page this week.
>
> **OPOS:** Spinning that up — opening a tracked task, drafting the plan, pulling in engineering. I'll check in before anything ships.

> **You:** Should we expand into the EU next quarter?
>
> **OPOS:** That's a strategic call — let me run it past the relevant leads, weigh the tradeoffs, and bring you a recommendation to approve or reject.

You state the goal. The organization decomposes it, does the work, and comes back when it needs your judgment.

## What makes it different

- **Your company is markdown, not a platform.** No runtime, no lock-in. Open the repo, read everything, own everything.
- **An organization that grows itself.** The org chart isn't hardcoded. As needs emerge, OPOS can design new roles, new departments, and new processes — so it keeps pace with your company instead of going stale.
- **AI-first by principle.** New capabilities default to AI. Humans are brought in deliberately — where lived experience, legal accountability, or physical presence genuinely require a person.
- **Autonomy with a human in the loop.** Routine work can run on its own schedule, but the decisions that count — shipping, spending, going public, hiring — always come back to you.
- **Everything in git.** Every decision, every change, every piece of work is tracked, reviewable, and reversible.

This isn't an agent framework for engineers to wire together pipelines. It's an operating system for *running a company* — built for founders, not just builders.

## Where it's headed

OPOS is early and moving fast. Today it gives a single founder a credible, self-organizing company in a repo; the trajectory is a platform that covers ever more of what a real organization does — more of the company describable in files, more of the work the organization can carry on its own. The surface area keeps growing. This README stays deliberately high-level because the capabilities won't stop expanding.

## Get started

OPOS is distributed as a template you scaffold in one command, then bring to life in conversation:

```bash
copier copy gh:Koroqe/OPOS my-company-os -d COMPANY_NAME="My Company"
```

Open the new repo in your editor, start a Claude Code session, and **talk to your company** — it'll walk you through setting up your mission, departments, and first goals.

## Learn more

- **Founder's guide** — the full, hands-on walkthrough of running your OPOS company ships inside every scaffold as its `README.md` (source: [`README.md.jinja`](README.md.jinja)).
- **Known limitations & roadmap** — [`RISKS.md`](RISKS.md.jinja) lays out, honestly, what's solid today and what's still ahead.

---

*Built on [Claude Code](https://claude.com/claude-code). Early-stage and evolving — feedback and forks welcome.*
