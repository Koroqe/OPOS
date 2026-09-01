---
name: consult-agent
description: Consult another agent by spawning its definition as a subagent via the Task tool; returns the simulated agent's response to the caller
version: 0.1.0
tags: [meta, framework, consultation]
owner_agent: chief-of-staff
---

# consult-agent

## When to use

Any time a skill or agent needs the perspective / judgment of another agent without invoking the full agent runtime. This canonicalizes the "spawn `general-purpose` and frame it as `<agent>` reading its own definition" pattern used ad-hoc in `design-process` and the R&D survey.

Use this when:
- A skill needs cross-functional input (e.g. `design-process` step 4 — consulting dept leads).
- An agent needs another agent's view on a tradeoff before deciding.
- A multi-agent design session benefits from a "second opinion."

Do NOT use this when:
- The caller IS the agent in question (no self-consultation; that's just thinking).
- The information being asked is in the agent's `.md` file verbatim and can be read directly (no need to spawn a subagent for that).

## Inputs

- `agent_name` — the kebab-case `name:` of the agent to consult (e.g. `eng-lead`). Required.
- `question` — the consultation prompt as free text. Required.
- `context` — optional extra background to include in the subagent's system prompt (e.g. the relevant code excerpts, the user's framing). Defaults to empty.

## Steps

1. **Locate the agent definition.** Glob `.claude/agents/**/*.md` for a file whose frontmatter contains `name: <agent_name>`. If zero matches → error ("agent not found"). If multiple matches → error ("ambiguous agent name; specify path"). The recursive glob handles both flat `.claude/agents/*.md` and nested `.claude/agents/<dept>/<role>.md` layouts.

2. **Read the agent's full definition file.** Capture both frontmatter and body.

3. **Read the agent's department charter for context.** **Special-case `department: company`**: read `company/CLAUDE.md.jinja` (or `company/CLAUDE.md` if rendered in a consumer scaffold) — there is NO `departments/company/` folder. The 4 company-tier agents (`ceo`, `coo`, `chief-of-staff`, `ops-manager`) all use the company-scope charter. For all other departments: read `departments/<name>/CLAUDE.md`. If the charter file is missing for a dept-scoped agent: soft-fail (proceed without charter content; log a warning in the history-entry body).

4. **Spawn an Explore (or `general-purpose`) subagent via the `Task` tool.** Frame the subagent's system prompt to include:
   - "You are SIMULATING the `<agent_name>` agent. Read your own definition first to ground yourself, then answer this question."
   - The agent's full definition (from step 2).
   - The department charter (from step 3, if available).
   - The optional `context` input (if provided).
   - The `question` itself.
   - Output-format guidance: "Reply as the agent would, citing your definition's role / responsibilities. Keep response under N words" (N is caller-configurable; default 500).

5. **Capture the subagent's response.** This is the consultation result.

6. **Return the response to the caller** as the skill's primary output. Caller integrates as needed.

7. **Write history entry** to `.claude/skills/consult-agent/history/<YYYY-MM-DD>-<short-run-id>.md`. Include: agent_name, question (one-line summary), one-line response summary, outcome (`success` / `failure`), any soft-fail warnings (e.g. missing charter).

## Caller requirements

The calling agent's `tools:` frontmatter MUST include `Task`. Most company-tier agents (chief-of-staff, ceo, coo, ops-manager) already do; dept agents typically do NOT — they would need it added before calling `consult-agent`. Failure shows up as a Task-tool-unavailable error in step 4.

## Outputs

- The consulted agent's response (text), returned to the caller.
- A history entry under `./history/` per the `.claude/CLAUDE.md` schema.

## Failure modes

- **Agent not found** — `agent_name` doesn't match any frontmatter `name:` in `.claude/agents/**`. Recovery: check spelling; list available agents via `grep -rh "^name: " .claude/agents/`.
- **Ambiguous match** — two agents share the same `name:`. Recovery: rename one (framework rules say names should be unique); short-term, the skill errors clearly.
- **Department charter missing** — soft-fail (proceed without; warning in history). For `department: company`, this means `company/CLAUDE.md` is missing — a deeper framework problem.
- **Task tool unavailable** — caller's `tools:` doesn't include `Task`. Recovery: add `Task` to the caller's frontmatter.
- **Subagent timeout / network failure** — the underlying Task invocation can fail. Recovery: surface the error; let caller retry.

## Honest limitation

The spawned subagent is simulating the named agent — it reads the agent's definition as system-prompt context, but it is NOT actually the registered agent (Claude Code doesn't currently support invoking project-level agents by name via the Task tool's `subagent_type` field; see `RISKS.md` Risk 14). The fidelity is "the subagent stays in character" rather than "the actual agent ran." For most consultation use cases this is sufficient. For cases that need real agent runtime (e.g. an agent's full tool allow-list, its persistent state), this skill is not the right tool.

## Related

- Process definition: `./PROCESS.md`
- Run history: `./history/`
- Used by: `design-process` (step 4) and likely future cross-functional skills.
- Risk: `RISKS.md` Risk 14 (simulation fidelity).
