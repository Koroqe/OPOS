# OPOS ↔ Claude Code mapping

**Last updated:** 2026-05-28 (v0.2.0)
**Owner:** `ops-manager`
**Source:** Research recommendation #3 in [`competitive-landscape.md`](./competitive-landscape.md)

This page explains how OPOS conventions map onto Claude Code primitives. The TL;DR: **OPOS and Claude Code are stacked, not competing**. OPOS provides the convention/governance layer (organizational structure, audit trail) that Claude Code's runtime doesn't model. Claude Code provides the execution mechanics that OPOS markdown files plug into.

## Two layers, one stack

| Layer | Role | Examples |
|---|---|---|
| **OPOS** — convention / governance | What does the company look like? Who owns what? What's the audit trail? | `.claude/agents/<dept>/<role>.md` defines roles; `tasks/<n>.md` tracks work; git history audits everything |
| **Claude Code** — runtime / IDE | How does AI actually do the work? What tools does it have? How is context managed? | Sub-agents isolate context; Skills define capabilities; MCP connects to external tools |

Most other AI-agent frameworks (CrewAI, LangGraph, AutoGen, MetaGPT — see [`competitive-landscape.md`](./competitive-landscape.md)) are runtime libraries. They DON'T model organizational structure or treat git history as a first-class audit log. OPOS fills that gap and stacks ON TOP of Claude Code's runtime.

## File mapping

| OPOS artifact | Claude Code primitive | Notes |
|---|---|---|
| `.claude/agents/<dept>/<role>.md` | Claude Code sub-agent prompt | The OPOS agent's body (Role, Delegation pattern, Inputs, Outputs, Escalation rules) becomes the sub-agent's system prompt. `tools:` frontmatter maps directly to the sub-agent's tool allow-list. |
| `.claude/skills/<name>/SKILL.md` | Anthropic Agent Skill | OPOS's SKILL.md frontmatter format is already aligned with Anthropic's published Agent Skills spec — both use `name`, `description`, `version`, `tags`. OPOS adds `owner_agent` (binding to an OPOS agent) which is an OPOS-specific extension. |
| `.claude/skills/<name>/PROCESS.md` | (no direct Claude Code equivalent — pure OPOS) | Process spec referenced BY the skill. Captures owner, inputs, success criteria, SLO, optional `state_schema`. Claude Code's Skills don't ship a structured spec; OPOS adds it. |
| `.mcp.json` | MCP tool registry | Direct mapping — `.mcp.json` IS the MCP config. OPOS adds the convention that per-agent access is controlled via `tools:` allow-list in agent frontmatter (e.g. `mcp__github__*`). |
| `tasks/<issue-number>.md` | (no Claude Code equivalent — pure OPOS) | Per-task markdown source of truth. Pairs with GitHub Issue. |
| Cascading `CLAUDE.md` files | (no Claude Code equivalent — pure OPOS) | OPOS's distinctive context-inheritance pattern. Claude Code reads the nearest `CLAUDE.md` but doesn't formalize the cascade as a convention. |
| `history/<date>-<run-id>.md` | (no Claude Code equivalent — pure OPOS) | Per-run audit log per skill. Claude Code's session state is opaque; OPOS makes it git-visible. |

## Why stacked, not competing

When you run a skill in a project that uses OPOS:

1. The user invokes `/some-skill` (or the skill fires via a hook).
2. Claude Code loads `.claude/skills/some-skill/SKILL.md` — runtime layer.
3. The skill's `owner_agent: <agent-name>` field points to `.claude/agents/<dept>/<agent-name>.md` — OPOS convention layer.
4. The skill executes, possibly delegating to other agents via the Task tool (Claude Code runtime), with framing informed by the agent definitions (OPOS).
5. Side effects (commits, GitHub issues, history entries) are persisted in git — OPOS audit layer.
6. External tools used by the skill are configured in `.mcp.json` (Claude Code) with per-agent gating via `tools:` allow-list (OPOS convention).

The runtime and the convention layer cooperate: Claude Code provides the execution surface; OPOS provides the org-chart, audit trail, and per-task structure that production company use requires.

## What OPOS does NOT replace

- **Claude Code itself** — OPOS REQUIRES Claude Code (or compatible runtime) to actually execute. OPOS is markdown + conventions; without a runtime nothing runs.
- **MCP** — OPOS uses MCP for external-tool integration. No separate tool-protocol.
- **Sub-agents** — OPOS agents are persistent organizational identities; Claude Code sub-agents are runtime instances of (potentially the same) agent. One agent definition → many sub-agent invocations.

## What Claude Code does NOT provide

- **Organizational structure** — no concept of departments, roles, reporting chains, ownership of skills.
- **Process specification format** — no equivalent to PROCESS.md (success criteria, SLO, state schemas).
- **Task tracking integration** — Claude Code doesn't formalize "this session is working on issue #N." OPOS's `.claude/.current-task` + `tasks/<n>.md` add that.
- **Audit trail via git** — Claude Code's session state lives in memory; OPOS commits run history to git.
- **Cascading context inheritance** — Claude Code loads one CLAUDE.md per CWD; OPOS treats the cascade as an architecturally-significant feature (root constitution → company scope → dept charter → individual agent).
- **Automatic upstream updates** — Claude Code skills are local files; OPOS adds `check-for-updates` + `sync-from-core` + the opt-in GitHub Actions workflow for managed framework distribution.

## Implementation hint (not yet implemented; documentation only)

A future enhancement could publish a "scaffold OPOS agents as Claude Code sub-agents" helper:

```bash
# Hypothetical future tool — NOT YET implemented
opos sync-agents-to-subagents
```

This would generate Claude Code sub-agent prompts from OPOS agent markdown, allowing a single `agent.md` file to drive both organizational documentation AND runtime sub-agent behavior. Until that tool exists, the mapping is conceptual: humans (or AI assistants) read the OPOS agent file when crafting a sub-agent invocation.

## Sources

- [Anthropic Agent Skills spec](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- [Claude Code sub-agents](https://code.claude.com/docs/en/sub-agents)
- [Claude Code skills](https://code.claude.com/docs/en/skills)
- [`competitive-landscape.md`](./competitive-landscape.md) (this folder; the framework-survey source recommendation #3)
- [`survey-ai-os-frameworks-2026-05-28.md`](../../departments/rnd/data/survey-ai-os-frameworks-2026-05-28.md) (R&D dept; raw survey data)
