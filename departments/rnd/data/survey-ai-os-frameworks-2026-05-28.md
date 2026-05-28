# AI-agent OS frameworks — landscape survey (2026-05-28)

**Author:** `rnd-lead` (simulated via Explore agent, per the documented limitation in `RISKS.md` Risk 6 — subagent-type registration gap)
**Scope:** Focused — AI-agent OS frameworks only, excluding workflow automation (n8n, Zapier) and traditional ops (Notion, ERPs).
**Method:** WebSearch + WebFetch across 8+ candidates; 6 frameworks selected for full entries based on maturity, conceptual distinctiveness, and relevance to OPOS positioning.
**Issue:** [Koroqe/OPOS#2](https://github.com/Koroqe/OPOS/issues/2)

## Method notes

Searched for frameworks spanning four categories: orchestration (CrewAI, LangGraph, AutoGen), software-company-as-agent (MetaGPT), AI-native IDE/agent (Claude Code primitives), and autonomous SWE agents (OpenHands, Devin). Excluded candidates and rationale:

- **BabyAGI** — archived 2024; not actively maintained.
- **AutoGPT** — less actively maintained than peer frameworks; OpenHands chosen as the active open-source autonomous-SWE representative.
- **Aider** — too narrow (AI pair programmer; no team / company-OS features).
- **Cognition Devin** — proprietary / closed-source; OpenHands selected as open-source parity.
- **Microsoft Agent Framework** — new product (2025/2026) absorbing AutoGen; noted but not deeply researched due to nascent documentation. Worth a follow-up review when GA.
- **OpenAI Agents SDK** — discovered during research; limited public documentation. Noted for future review.

Selected 6 frameworks with active commits in 2026 and sufficient architectural documentation to compare against OPOS.

## Frameworks

### 1. CrewAI

- **URL:** https://github.com/crewaiinc/crewai | https://crewai.com/
- **Maturity:** Active. Latest release v1.12 (May 2026). 50.9k GitHub stars. Adopted by 63% of Fortune 500 (per their marketing; internal-use figure, not deployments).
- **Primary use case:** Multi-agent orchestration with role-playing specialization. Teams of agents collaborate on complex tasks without predefined rigid workflows.
- **Conceptual model:** Two-tier. *Crews* are teams of agents with roles, goals, and tools; they execute within *Flows* — an orchestration layer managing state, control flow, and event-driven triggers. Flows delegate work to Crews; Crews collaborate autonomously. Agents operate via role-playing (e.g., "financial analyst," "code reviewer") rather than explicit prompts.
- **Notable patterns:**
  - **Role-based agent specialization.** Agents inherit capabilities via roles, reducing the need to hard-code agent instructions. OPOS agents are markdown templates without explicit role abstractions — they have a `name`, `description`, `tools`, but no role-hierarchy.
  - **Flows as first-class orchestration.** Separating workflow logic (Flows) from agent logic (Crews) mirrors OPOS's separation of `PROCESS.md` (spec) from agent markdown (behavior), but CrewAI formalizes this at runtime.
  - **Task as unit of work.** CrewAI v1.12 formalized tasks as first-class objects with explicit success criteria; OPOS currently treats tasks implicitly via the `task-register` + `task-update` + `task-complete` skill triple.
- **Gaps vs OPOS:**
  - CrewAI is a runtime library; OPOS is a company-as-repo convention. CrewAI requires a Python execution environment; OPOS operates via markdown + git + GitHub Issues.
  - No emphasis on audit trail via version control as source of truth. Crew state lives in memory / API; OPOS leverages git commits.
  - OPOS's cascading CLAUDE.md for context inheritance is not a CrewAI pattern.

### 2. LangGraph

- **URL:** https://github.com/langchain-ai/langgraph | https://www.langchain.com/langgraph
- **Maturity:** Active. v1.2 released May 2026; v0.3.19 in April 2026. 50k+ GitHub stars. Production use by Klarna, Replit, Elastic.
- **Primary use case:** Low-level stateful agent orchestration for long-running, persistent workflows. Production focus: agents that survive failures, resume from checkpoints, and support human-in-the-loop oversight.
- **Conceptual model:** Graph-based. Agents are directed graphs with *State* (data model), *Nodes* (compute units), *Edges* (control flow). State flows through nodes; each node is a Python function receiving state and returning updates. Checkpointing for durability/resumability. Edges can be deterministic or conditional (LLM-driven routing).
- **Notable patterns:**
  - **State as explicit data model.** LangGraph requires declaring state schema upfront (e.g., `messages: list[Message]`), forcing clear interface design. OPOS uses implicit context (CLAUDE.md, agent descriptions) rather than explicit state schemas.
  - **Checkpointing for durability.** Built-in persistence for long-running workflows. OPOS relies on git as immutable log but has no explicit checkpoint mechanism for in-flight state.
  - **Human-in-the-loop as first-class.** LangGraph supports inspecting and modifying state at any node. OPOS has human approval points (e.g., `design-process` step 8, `task-complete` step 8) but less structured introspection.
- **Gaps vs OPOS:**
  - LangGraph is low-level orchestration; OPOS is high-level company convention. LangGraph requires coding graphs in Python; OPOS uses markdown conventions.
  - No multi-agent *collaboration* model (agents don't communicate; only state flows). CrewAI and OPOS emphasize agent-to-agent delegation and conversation.
  - No notion of agent identity, roles, or organizational hierarchy. All nodes are computational units; OPOS binds agents to departments and specific responsibilities.

### 3. AutoGen (Microsoft)

- **URL:** https://github.com/microsoft/autogen | https://microsoft.github.io/autogen
- **Maturity:** Active, transitioning. AutoGen v0.4+ actively maintained with 50.4k GitHub stars. **Note:** Microsoft now recommends new projects use the Microsoft Agent Framework (which absorbs AutoGen patterns + Semantic Kernel).
- **Primary use case:** Conversation-driven multi-agent systems where agents delegate to each other via natural language. Agents decide dynamically when to invoke peers based on message content.
- **Conceptual model:** Agents as `ConversableAgent` base class with subclasses (`AssistantAgent` — LLM-driven; `UserProxyAgent` — human proxy with tool execution). Agents exchange messages; each registers auto-reply functions deciding whether to respond or invoke peers. Conversation history is the state. Topology emerges dynamically from agent decisions.
- **Notable patterns:**
  - **Conversation-as-state.** Unlike LangGraph's explicit state schema, AutoGen treats message history as implicit state. Natural language flow guides agent behavior. Closer to OPOS's delegation pattern (agents "talking" to each other via skill invocations).
  - **Dynamic topology.** Agent relationships form at runtime based on message content. OPOS agents have static bindings (department membership, `owner_agent` field) but could benefit from dynamic delegation patterns.
  - **Auto-reply functions for control.** Registered functions decide when/how agents respond. OPOS uses explicit skill ownership and delegation; AutoGen is more implicit.
- **Gaps vs OPOS:**
  - AutoGen models are lightweight software-only agents (no persistent identity / department affiliation). OPOS agents are organizational units with bounded responsibilities.
  - No filesystem or git integration. AutoGen state lives in memory; OPOS state lives in git + GitHub Issues.
  - The shift to Microsoft Agent Framework suggests the original AutoGen pattern (pure conversation) is being replaced by more structured orchestration — worth re-evaluating in 12 months.

### 4. MetaGPT

- **URL:** https://github.com/FoundationAgents/MetaGPT
- **Maturity:** Active. Core paper accepted for ICLR 2025 (oral, top 1.2%). Latest releases throughout 2025-2026. 50k GitHub stars. Commercial spin-off MGX (MetaGPT X) launched Feb 2025 as "AI agent development team."
- **Primary use case:** Software-company simulation. One-line requirement flows through specialized agent roles (Product Manager, Architect, Engineer, etc.) executing defined SOPs, producing complete software artifacts (PRD, design docs, code, tests).
- **Conceptual model:** *"Code = SOP(Team)"* — agents are roles executing standard operating procedures. Input: one-line requirement. Output: complete software project. Agents operate in sequence following SOP workflows (not arbitrary collaboration). Materialized organizational structure as multi-agent orchestration.
- **Notable patterns:**
  - **Organizational structure as first-class.** MetaGPT explicitly models "PM, Architect, Engineer" roles, mirroring a software-company org chart. OPOS has departments and agents but treats organizational roles as conventions, not explicit Python classes.
  - **SOP as workflow definition.** Standard Operating Procedures codify how agents collaborate. OPOS has `PROCESS.md` files that define processes; MetaGPT explicitly executes SOPs as control flow.
  - **Document-centric artifact flow.** Workflows produce documents (PRD, design specs, code) as intermediate state passed between agents. OPOS uses CLAUDE.md and markdown files but doesn't explicitly model artifact flow between agents.
- **Gaps vs OPOS:**
  - MetaGPT is a Python-based runtime; OPOS is repo convention. MetaGPT requires execution environment; OPOS is git + markdown.
  - OPOS's strength is scalability to arbitrary departments / agents; MetaGPT is optimized for software-company simulation (may not generalize to ops, sales, etc.).
  - OPOS emphasizes git history as audit trail; MetaGPT state lives in workflow execution (less transparent to non-technical stakeholders).

### 5. Claude Code (Anthropic)

- **URL:** https://code.claude.com/docs/en/sub-agents | https://code.claude.com/docs/en/skills | https://www.anthropic.com/product/claude-code
- **Maturity:** Active. Sub-agents, agent teams, and MCP integration released 2025-2026. Skills framework formalized as open standard. Part of core Anthropic product line.
- **Primary use case:** AI-native code execution and agentic workflows within Claude's IDE / CLI. Sub-agents handle specialized tasks (code review, testing, security) in parallel with context isolation. Agent teams coordinate multiple sub-agents; MCP provides tool integrations.
- **Conceptual model:** *Sub-agents* are specialized AI assistants with isolated context windows, custom system prompts, tool access, and permission boundaries. *Agent teams* coordinate multiple sub-agents. *Skills* are reusable task instructions (YAML + markdown) defining what an agent can do. *MCP* (Model Context Protocol) connects agents to external tools with standardized authentication.
- **Notable patterns:**
  - **Context isolation as first-class.** Sub-agents reduce context bloat by running side tasks in separate windows and returning summaries. OPOS doesn't have explicit context isolation — every agent shares the cascading CLAUDE.md context.
  - **Skills as portable unit.** Anthropic published Agent Skills as an open standard. Skills define capability + documentation. OPOS's `skills/` folder follows a similar pattern but lacks Anthropic's formal frontmatter spec — though OPOS's `SKILL.md` + `PROCESS.md` pair is actually MORE structured.
  - **MCP for tool integration.** Model Context Protocol standardizes how agents connect to external APIs (Slack, GitHub, Google Drive). OPOS agents invoke skills (internal) but lack a standard integration layer for external tools.
- **Gaps vs OPOS:**
  - Claude Code is an IDE / chat interface; OPOS is a repo convention. Claude Code is synchronous (you wait for results); OPOS is git-based (asynchronous, audit trail).
  - Sub-agents are runtime constructs within one session; OPOS agents are persistent entities in the repo with ongoing responsibilities.
  - Claude Code doesn't model organizational structure (departments, roles, reporting) explicitly. OPOS does.
  - OPOS's markdown + git approach is more visible to humans; Claude Code's session-based state is opaque to non-technical stakeholders.

### 6. OpenHands

- **URL:** https://github.com/OpenHands/OpenHands | https://www.openhands.dev/
- **Maturity:** Active. Latest v1.7.0 (May 1, 2026). 74.4k GitHub stars; 204 commits in past year. Rebranded from OpenDevin in 2025.
- **Primary use case:** Autonomous software-engineering agent that can execute end-to-end engineering work: understand requirements, modify code, run tests, fix bugs, deploy. Open-source alternative to Cognition's Devin.
- **Conceptual model:** Single primary agent (or agent team via SDK) with an agentic loop: think → decide → act. Agent has persistent memory, uses browser / terminal / code-editor tools, can modify codebases autonomously. Supports UI-driven mode (OpenHands sandbox) and SDK mode (Python library) for programmatic agent deployment.
- **Notable patterns:**
  - **End-to-end task autonomy.** Unlike CrewAI / AutoGen where agents are narrowly scoped, OpenHands agents are generalist problem-solvers. Closest to OPOS agents' scope (broad responsibility within department).
  - **Persistent agent memory.** Agents maintain state across interactions. OPOS agents have persistent identity (markdown files) + context (CLAUDE.md). Similar conceptual model, different mechanism.
  - **Composable agent SDK.** Allows defining agents programmatically and scaling to thousands. OPOS uses markdown; OpenHands uses Python. Different modality, same goal.
- **Gaps vs OPOS:**
  - OpenHands focuses on code / engineering; OPOS is company-wide. OpenHands agents specialize in SWE; OPOS supports arbitrary departments (ops, sales, R&D, etc.).
  - OpenHands is tool-heavy (browser, terminal, git); OPOS is file-based (markdown, git issues). Different integration layers.
  - No explicit organizational structure. OpenHands can run multiple agents but doesn't model hierarchy / departments. OPOS emphasizes org structure.

## Implications for OPOS (3 concrete recommendations)

### 1. Formalize Tasks and Flows as distinct abstractions

CrewAI's distinction between *Crews* (agents) and *Flows* (orchestration) reveals a gap in OPOS. Currently, "task" is implicit (via `task-register` skill outputs). OPOS should:

- Introduce a first-class `Task` abstraction (e.g., `tasks/<issue-number>.md` with owner, success criteria, deadline, current state).
- Separate task routing logic (Flow) from agent execution (Crew). Example: a Flow could dispatch "code review" tasks to `eng-reviewer`, while `eng-lead` handles architecture decisions.
- Reference: CrewAI v1.12 formalized tasks; this is worth replicating at the markdown level. The existing `BACKLOG-ITEM.md.tmpl` is a precursor — could be extended to be a full Task abstraction.

### 2. Add explicit State and Checkpoint patterns for long-running workflows

LangGraph's *State* schema and checkpointing reveal that OPOS needs clearer patterns for durable multi-step work. Currently, context is scattered across CLAUDE.md, agent descriptions, and issue comments. OPOS should:

- Define state schemas for processes (e.g., `design-process` might track `requirements → design → code → review` states explicitly in `PROCESS.md`).
- Use git commits as checkpoints (already implicit; make it explicit in each `PROCESS.md`'s "History" section).
- Document human-in-the-loop introspection points (where a human can inspect state, modify, and resume).
- Reference: LangGraph shows production teams expect explicit state visibility; OPOS's implicit approach is a strength for simplicity but a weakness for visibility on long-running work.

### 3. Document OPOS's positioning vs Claude Code / MCP as a complementary, not competing, abstraction

Claude Code (Sub-agents, Skills, MCP) and OPOS serve **different layers**:

- **Claude Code**: Runtime / IDE layer. Sub-agents isolate context; Skills are task instructions; MCP connects to external tools.
- **OPOS**: Convention / governance layer. Agents are organizational units; Processes define responsibilities; Git is the audit trail.

These should be **stacked**: an OPOS agent (markdown file) could map to a Claude Code sub-agent (runtime), invoked via MCP. OPOS should:

- Publish a reference implementation showing how to scaffold a Claude Code sub-agent from an OPOS agent markdown file.
- Document the mapping in the README:
  - `.claude/agents/<dept>/<role>.md` → Claude Code sub-agent prompt
  - `.claude/skills/<name>/SKILL.md` → Anthropic Agent Skill (already aligned)
  - `PROCESS.md` → MCP tool spec (or process documentation)
- Emphasize OPOS's uniqueness: company-as-repo + cascading CLAUDE.md for context inheritance. CrewAI, LangGraph, MetaGPT, and AutoGen all require runtime code; OPOS is convention-first.

## Sources

All URLs fetched during research, in order of appearance:

- CrewAI: https://github.com/crewaiinc/crewai
- CrewAI Documentation: https://docs.crewai.com/en/introduction
- CrewAI Official: https://crewai.com/
- LangGraph GitHub: https://github.com/langchain-ai/langgraph
- LangGraph Documentation: https://www.langchain.com/langgraph
- LangGraph Overview: https://docs.langchain.com/oss/javascript/langgraph/overview
- Microsoft AutoGen GitHub: https://github.com/microsoft/autogen
- AutoGen Documentation: https://microsoft.github.io/autogen
- MetaGPT GitHub: https://github.com/FoundationAgents/MetaGPT
- Claude Code Sub-agents: https://code.claude.com/docs/en/sub-agents
- Claude Code Skills: https://code.claude.com/docs/en/skills
- Anthropic Agent Skills API: https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview
- OpenHands GitHub: https://github.com/OpenHands/OpenHands
- OpenHands Official: https://www.openhands.dev/
- AI Agent Frameworks Compared 2026: https://pecollective.com/blog/ai-agent-frameworks-compared/
- 10 AI Agent Frameworks 2026: https://medium.com/@atnoforgenai/10-ai-agent-frameworks-you-should-know-in-2026-langgraph-crewai-autogen-more-2e0be4055556
- Microsoft Agent Framework: https://cloudsummit.eu/blog/microsoft-agent-framework-production-ready-convergence-autogen-semantic-kernel
- AutoGPT GitHub: https://github.com/Significant-Gravitas/AutoGPT
- BabyAGI: https://github.com/yoheinakajima/babyagi
- Cognition Devin: https://cognition.ai/blog/introducing-devin
- Claude Code Features: https://code.claude.com/
- Building Agents with Claude Agent SDK: https://www.anthropic.com/engineering/building-agents-with-the-claude-agent-sdk
