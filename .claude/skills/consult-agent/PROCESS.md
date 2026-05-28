---
process_name: consult-agent
owner: chief-of-staff
collaborators: []
inputs: [agent_name, question, context]
success_criteria: [agent_definition_loaded, charter_loaded_or_soft_failed, subagent_spawned, response_captured, history_entry_written]
slo: "30 seconds (one Task subagent call + filesystem reads)"
version: 0.1.0
---

# consult-agent

## Narrative

Canonicalizes the agent-consultation pattern used ad-hoc in `design-process` step 4 and the R&D framework survey. Replaces "spawn `general-purpose` with a hand-crafted prompt that references the target agent's definition" — now it's one skill invocation.

## Pre-conditions

- Caller's `tools:` frontmatter includes `Task`.
- The agent named in `agent_name` exists at some path under `.claude/agents/**`.
- For company agents: `company/CLAUDE.md` (or `.jinja` source) exists.
- For dept agents: ideally `departments/<name>/CLAUDE.md` exists; soft-fail otherwise.

## Steps

Mirrors the 7-step procedure in SKILL.md:

1. Glob for the agent file by `name:` frontmatter.
2. Read full definition.
3. Read charter (special-cased for `department: company`).
4. Spawn Task subagent with framed system prompt.
5. Capture response.
6. Return response to caller.
7. Write history entry.

## Done when

- `agent_definition_loaded` — step 2 completed (file read into memory).
- `charter_loaded_or_soft_failed` — step 3 either succeeded OR explicitly logged a missing-charter warning in the history entry.
- `subagent_spawned` — step 4 completed (Task tool returned without error).
- `response_captured` — step 5 has a non-empty response string.
- `history_entry_written` — file exists under `./history/`.

## Rollback

No mutation of framework state — read-only against agent/charter files; writes only to `./history/`. No rollback needed beyond deleting the history entry if a run was botched.

## History

Every invocation writes an entry (unlike `check-for-updates` which is conditional). Consultations are meaningful events worth logging.
