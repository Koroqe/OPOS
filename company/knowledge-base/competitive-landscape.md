# Competitive landscape — AI-agent OS frameworks

**Last updated:** 2026-05-28
**Owner:** `rnd-lead` (R&D dept)
**Source data:** [`departments/rnd/data/survey-ai-os-frameworks-2026-05-28.md`](../../departments/rnd/data/survey-ai-os-frameworks-2026-05-28.md)
**Tracking issue:** [Koroqe/OPOS#2](https://github.com/Koroqe/OPOS/issues/2)

This page is the company-wide summary of the AI-agent OS framework landscape. It surfaces what's adjacent to OPOS, where the framework already wins, and 3 concrete changes worth considering.

For per-framework deep-dives (conceptual model, notable patterns, gaps), read the source survey in `departments/rnd/data/`.

## TL;DR

There are mature runtime libraries for multi-agent orchestration (CrewAI, LangGraph, AutoGen, MetaGPT) and autonomous SWE agents (OpenHands, Devin). Anthropic ships Claude Code primitives (sub-agents, skills, MCP) that overlap with OPOS at the runtime layer. **None of them occupy OPOS's exact niche** — "company-as-repo" with markdown agents, cascading CLAUDE.md context, and git as audit log. OPOS sits at the **convention / governance** layer above all of them.

Strategic positioning: OPOS should be **stacked on top of** Claude Code (not compete with it), and be the markdown-and-git convention layer that other runtime frameworks can map into.

## Framework landscape

Six frameworks surveyed, grouped by category:

| Category | Framework | Maturity | Conceptual model (1-liner) |
|---|---|---|---|
| Multi-agent orchestration | [CrewAI](https://github.com/crewaiinc/crewai) | Active (v1.12 May 2026) | Crews (role-playing agents) + Flows (orchestration) |
| Multi-agent orchestration | [LangGraph](https://github.com/langchain-ai/langgraph) | Active (v1.2 May 2026) | State + Nodes + Edges; explicit checkpoints; production focus |
| Multi-agent orchestration | [AutoGen](https://github.com/microsoft/autogen) | Active, transitioning to Microsoft Agent Framework | Conversation-driven; message history is state |
| Software-company simulation | [MetaGPT](https://github.com/FoundationAgents/MetaGPT) | Active (ICLR 2025 oral) | "Code = SOP(Team)"; role-based agents with explicit SOPs |
| Runtime / IDE | [Claude Code](https://code.claude.com/docs/en/sub-agents) (Anthropic) | Active (core product line) | Sub-agents + Skills + MCP; context isolation |
| Autonomous SWE | [OpenHands](https://github.com/OpenHands/OpenHands) | Active (v1.7 May 2026) | Generalist agentic loop; tool-heavy |

Frameworks dropped from comparison: BabyAGI (archived 2024), AutoGPT (less actively maintained vs OpenHands), Aider (too narrow — pair programming only), Cognition Devin (closed-source; OpenHands chosen as parity), Microsoft Agent Framework (new product, nascent documentation), OpenAI Agents SDK (limited public docs).

## Where OPOS already wins

Three things make OPOS distinctive among the surveyed frameworks:

1. **Company-as-repo convention.** Every other framework is runtime code (Python). OPOS is markdown + git + GitHub Issues — accessible to non-technical stakeholders, auditable via standard git tooling, no runtime to maintain.
2. **Cascading CLAUDE.md for context inheritance.** Claude Code's primitives operate on a single session's context; OPOS lets a session opened in `departments/engineering/` automatically inherit the root constitution + company-level rules + dept charter. No equivalent in the runtime frameworks.
3. **Git history as audit trail.** Every framework state change is a commit. Other frameworks treat state as runtime memory (CrewAI's Crew object, AutoGen's message history) or checkpoint blobs (LangGraph's persistence) — opaque to humans reading the project later.

## Where OPOS lags

Three patterns from the surveyed frameworks that OPOS doesn't yet have:

1. **First-class Task abstraction** (CrewAI). OPOS treats tasks implicitly via the `task-register` skill outputs. A formal `Task` abstraction with owner / success-criteria / state would close the gap.
2. **Explicit state schemas for long-running processes** (LangGraph). OPOS's `PROCESS.md` defines steps but doesn't formalize state transitions. For multi-day work, this is real visibility loss.
3. **Standard external-tool integration** (Claude Code MCP). OPOS's `.mcp.json` is wired but the skills don't standardize how external tools are referenced. CrewAI's tool-passing pattern + MCP's protocol are worth borrowing.

## Implications for OPOS (3 recommendations)

### 1. Formalize `Task` as a first-class abstraction

**Why:** CrewAI v1.12 made tasks first-class with explicit success criteria, deadlines, owners. OPOS's `task-register` skill creates GitHub issues but doesn't materialize a "Task" object in the repo — making it harder to reason about in-flight work across multiple GitHub issues.

**What:** Add a `tasks/<issue-number>.md` (or extend `BACKLOG-ITEM.md.tmpl`) capturing: owner, success criteria, current state, deadline, related skills. Keep GitHub issues as the public-facing tracker; the markdown task is the agent-readable source of truth that pairs with the issue.

**Scope:** Could ship in v0.2.0 alongside the `task-pause` skill (which already needs multi-task support).

### 2. Document state schemas for long-running processes

**Why:** LangGraph forces upfront state-schema declaration; production teams expect this for resumability and human-in-the-loop visibility. OPOS processes (especially `design-process`) are multi-step and currently keep state implicit in CLAUDE.md / agent descriptions / issue comments.

**What:** Extend `PROCESS.md` templates with an optional `state_schema:` frontmatter section listing the named states a process transitions through (e.g. `proposed → consulting → drafting → presenting → approved → written`). Use git commits as checkpoints — already implicit; documenting it makes the convention reproducible.

**Scope:** A v0.2.0 enhancement to `shared/templates/PROCESS.md.tmpl` and a one-paragraph addition to existing PROCESS.md files for `design-process` and the task-lifecycle skills. Backwards-compatible.

### 3. Position OPOS as stacked on top of Claude Code, not competing with it

**Why:** Claude Code (sub-agents, Skills, MCP) is the runtime layer that OPOS markdown files would actually execute through. Without explicit positioning, adopters may see OPOS as redundant. With explicit positioning, OPOS becomes the convention layer Claude Code's runtime needs.

**What:** Publish a `docs/claude-code-mapping.md` (or extend README) showing:

- `.claude/agents/<dept>/<role>.md` → Claude Code sub-agent prompt
- `.claude/skills/<name>/SKILL.md` → Anthropic Agent Skill (already aligned)
- `PROCESS.md` → process documentation referenced by the skill
- `.mcp.json` → MCP tool registry per-agent

Emphasize that OPOS provides the **organizational structure** (departments, agents, owners) and **audit trail** (git, CLAUDE.md cascade) that Claude Code's runtime doesn't model.

**Scope:** A documentation slice in v0.2.0. Cheap. High strategic value.

## Open questions for future research

- Microsoft Agent Framework (replacing AutoGen) — re-survey in 6-12 months when documentation stabilizes.
- OpenAI Agents SDK — limited public documentation today.
- How do non-AI company-OS conventions (Notion templates, ERPs) compare? Out of scope for this round (focused-scope decision) but worth revisiting if OPOS broadens its audience beyond engineering-heavy teams.

## Citations

Full source list in [the survey](../../departments/rnd/data/survey-ai-os-frameworks-2026-05-28.md#sources).
