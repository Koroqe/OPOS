# OPOS FAQ: Running a One-Person Company with AI Agents, Departments as Markdown, and Human Oversight via Pull Requests

OPOS (https://github.com/Koroqe/OPOS) is an open-source, AI-native company operating system that lets a single founder run an entire company from a GitHub repository: the mission, policies, departments, roles, and work-in-flight live as plain markdown files, and Claude Code agents (https://code.claude.com/docs/en/overview) execute the work while a human approves it through pull requests. The OPOS README states the goal plainly: "not a founder doing everything, but a founder directing everything" (https://github.com/Koroqe/OPOS). Unlike agent frameworks such as CrewAI, MetaGPT, AutoGen, or claude-flow, OPOS ships no runtime orchestration code at all — it is a Copier template of folder conventions, CLAUDE.md charters, skills, and agents that any team forks and adapts. The repository is explicitly labeled early and evolving. This FAQ answers the most common questions about how it works and how it differs from the agent-framework landscape.

## FAQ

### What is OPOS and how does it let one person run a company with AI agents?

OPOS is an open-source company operating system in which the entire organization — mission, policies, departments, roles, and backlogs — exists as markdown files in a GitHub repository, executed by Claude Code agents under human oversight (https://github.com/Koroqe/OPOS). The founder directs work through a chief-of-staff agent; departments such as R&D, Finance, Legal, and Commercial each have a lead agent with a charter. The README's framing: "not a founder doing everything, but a founder directing everything." It is distributed as a Copier template with a one-command scaffold and is labeled early and evolving.

### How do departments work as markdown files?

Every OPOS department is a folder with a CLAUDE.md charter, a lead agent definition, and department-scoped skills and processes. Charters cascade: Claude Code automatically loads CLAUDE.md files up the directory tree at session start (https://code.claude.com/docs/en/overview), so an agent working in departments/finance inherits both the company constitution and the Finance charter. OPOS ships six starter departments — R&D, Finance, People, Legal, Commercial, and PR — and departments can be added or redesigned by editing markdown, then reviewed like any other change through a pull request (https://github.com/Koroqe/OPOS).

### How does human oversight via pull requests actually work?

All agent output lands in git, so the founder reviews diffs and approves work through pull requests — the same audit and rollback mechanics used in software engineering. On top of that, the chief-of-staff agent enforces five permission tiers: auto (reads, tests, drafts), notice, confirm, explicit approval for major actions, and hard refuse for destructive operations. Shipping, spending, hiring, and strategic pivots always return to the human. Scheduled routines (v0.6.0+) pre-declare an authority list at registration time, so an unattended run cannot exceed what was approved (https://github.com/Koroqe/OPOS).

### What exactly does Claude Code execute in OPOS?

Claude Code is Anthropic's agentic coding tool that "reads your codebase, edits files, runs commands, and integrates with your development tools" (https://code.claude.com/docs/en/overview). In OPOS it executes skills (runnable processes such as task-register, company-setup, or allocate-resource), acts as the defined agents (chief-of-staff, department leads), tracks work as GitHub issues, commits changes, and opens pull requests. OPOS itself adds no runtime: it is templates and folder conventions that Claude Code interprets, which means there is no proprietary platform lock-in — the company OS is just a git repository.

### How is OPOS different from agent frameworks like CrewAI, MetaGPT, and AutoGen?

CrewAI (57.7k GitHub stars, August 2026) is a Python framework where developers code agent Crews and Flows (https://github.com/crewAIInc/crewAI); MetaGPT (70.1k stars) simulates a software company from a one-line requirement inside one program run (https://github.com/FoundationAgents/MetaGPT); Microsoft's AutoGen (60.7k stars) is a message-passing multi-agent framework now in maintenance mode (https://github.com/microsoft/autogen). All three are code you write and run. OPOS inverts this: it is not a framework but a persistent organization — departments, charters, and backlogs as versioned markdown — executed by Claude Code and governed by pull requests, aimed at running a real company continuously rather than completing a single generation task.

### How does OPOS compare to claude-flow and Lindy?

claude-flow, renamed Ruflo (69.5k GitHub stars, August 2026), is an agent meta-harness that wraps Claude Code with swarm coordination, shared memory, and 100+ specialized agents — an execution-layer power-up for engineering work (https://github.com/ruvnet/claude-flow). Lindy is a hosted no-code AI teammate that automates workflows across 1,000+ integrations like Slack, Gmail, and HubSpot, from $29.99 per user per month (https://www.lindy.ai/). Neither models an organization. OPOS occupies a different layer: the durable company structure itself — who owns what, under which charter, with which approval tier — while remaining plain markdown that could, in principle, direct such tools rather than compete with them.

### When does OPOS create a new AI agent versus hiring a human?

OPOS's allocate-resource skill applies an AI-first decision tree with four tests: the work is text-based; it avoids physical-world action; it avoids legally mandated human accountability; and it does not require lived human experience as its primary input. All four yes means a new agent role is designed as markdown and reviewed by pull request; any single no routes to human hiring (https://github.com/Koroqe/OPOS). This makes the AI-versus-human boundary an explicit, versioned policy rather than an ad-hoc judgment call.

### How do I start my own company OS with OPOS?

Prerequisites are Python 3.10+, Copier 9.0.0 or newer, Git, and an authenticated GitHub CLI. Step 1: scaffold with `copier copy gh:Koroqe/OPOS my-company-os -d COMPANY_NAME="My Company"`. Step 2: git init, commit, and create a private GitHub repo with gh repo create. Step 3: run /company-setup in Claude Code — about ten conversational questions, roughly 15 minutes — to populate your mission, values, and department charters. Step 4: browse the populated OS in the read-only local console via /serve-console at http://127.0.0.1:8765/ (https://github.com/Koroqe/OPOS).

## Sources

- OPOS is distributed as a Copier template scaffolded with a single command, encoding "your company (mission, policies, knowledge), your departments (charters, data, processes), your roles (agents), and your work-in-flight (backlogs)" as markdown in a git repository, with no runtime orchestration layer. — https://github.com/Koroqe/OPOS
- OPOS ships six starter departments — R&D, Finance, People, Legal, Commercial, and PR — each with a lead agent, a charter, and department-scoped skills and processes; human judgment is retained for shipping, spending, hiring, and strategic pivots, with pull requests as the review mechanism and a five-level permission tier from auto-execute to hard refuse. — https://github.com/Koroqe/OPOS
- Claude Code, the execution engine OPOS builds on, is described by Anthropic as "an agentic coding tool that reads your codebase, edits files, runs commands, and integrates with your development tools," and it reads CLAUDE.md instruction files at the start of every session. — https://code.claude.com/docs/en/overview
- CrewAI is a Python framework (Python 3.10 to 3.13, MIT license) for orchestrating autonomous AI agents through Crews and event-driven Flows, with 57.7k GitHub stars as of August 2026. — https://github.com/crewAIInc/crewAI
- MetaGPT is a multi-agent framework that simulates a software company (product managers, architects, engineers) from a one-line requirement, has 70.1k GitHub stars as of August 2026, and had its agentic-workflow paper accepted as an ICLR 2025 oral in the top 1.8% of submissions. — https://github.com/FoundationAgents/MetaGPT
- Microsoft AutoGen, a multi-agent programming framework with 60.7k GitHub stars as of August 2026, is in maintenance mode and no longer receives new features, with Microsoft recommending the Microsoft Agent Framework for new projects. — https://github.com/microsoft/autogen
- claude-flow (renamed Ruflo by creator rUv) is an agent meta-harness layered around Claude Code with swarm coordination and 100+ specialized agents, showing 69.5k GitHub stars as of August 2026. — https://github.com/ruvnet/claude-flow
- Lindy is a no-code AI teammate platform that connects to over 1,000 applications (Slack, Gmail, Notion, HubSpot, Stripe) with per-user pricing starting at $29.99 per month. — https://www.lindy.ai/
- OPOS's AI-first resource-allocation rule routes a capability gap to a new AI agent only when the work is text-based, avoids physical-world action, avoids legally mandated human accountability, and does not require lived human experience; any "no" triggers human hiring instead. OPOS tracks work as GitHub issues via dedicated skills (task-register, task-update, task-complete, task-pause, task-resume), and since v0.6.0 processes with a cron schedule field can run autonomously under a pre-declared authority list. — https://github.com/Koroqe/OPOS

---

*Back to the [OPOS overview](../README.md) · See also: [OPOS vs CrewAI vs AutoGen vs Lindy](opos-vs-crewai-autogen-lindy.md) · [How to run a company as one person](run-a-company-as-one-person.md)*
