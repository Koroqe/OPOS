---
process_name: design-agent
owner: ops-manager
collaborators: [coo, ceo, chief-of-staff]
inputs: [role_description, backlog_item_path]
success_criteria: [framework_understood, dept_validated, name_unique, consultations_completed, proposal_presented, user_approved, agent_file_written, history_entry_written]
slo: "interactive — 5-15 minutes per session including user iteration"
version: 0.1.0
state_schema:
  - discovering: framework + role + dept read; name-collision + slug-regex check (steps 1-4)
  - consulting: dept-lead + escalation-target + delegation-target queried via consult-agent (step 5)
  - drafting: AGENT.md.tmpl filled; tools allow-list decided; cycle check (steps 6-8)
  - presenting: proposal + tools-rationale + open questions surfaced to user (step 9)
  - iterating: revising based on user feedback until explicit approval (step 10)
  - committing: file written; dept-charter Members section updated if present; history entry recorded (steps 11-12)
---

# design-agent

## Narrative

Closes the "expanding the org chart" gap previously documented as RISKS Risk 8. `design-process` would surface a need for an agent role that doesn't exist, then escalate to `coo` and stop. `design-agent` now lets ops-manager design the new role inline, mirroring `design-process`'s interactive structure (consult → propose → iterate → approval-gate → write).

Owned by `ops-manager` (same as `design-process`) because both are framework-design skills owned by the operations function. `coo` and `ceo` listed as collaborators since the agent-creation decision affects org-chart shape.

## Pre-conditions

- Target department exists (`departments/<dept>/CLAUDE.md[.jinja]`), OR `department: company` (special-case scope).
- `.claude/agents/<dept>/` directory exists, OR will be created by step 3's `mkdir -p` (idempotent).
- `shared/templates/AGENT.md.tmpl` exists and contains all 5 expected substitution tokens.
- The proposed agent name does not collide with an existing agent.
- The proposed agent name matches the slug regex `^[a-z][a-z0-9-]{1,62}$`.

## Steps

Mirrors the 12-step procedure in SKILL.md:

1. Understand the framework.
2. Understand the role.
3. Identify target department + validate paths.
4. Check for name collisions + slug-validate.
5. Consult relevant agents via `consult-agent` (up to 3; self-consultation guard).
6. Decide placement.
7. Decide tools allow-list (least-privilege ladder).
8. Draft the design (verify AGENT.md.tmpl + cycle check).
9. Present to the user.
10. Iterate to approval.
11. Write the agent file (re-check TOCTOU; update dept charter Members section if present).
12. Write design-agent's own history entry.

## State transitions

Strict forward order. `iterating ↔ presenting` loop allowed until approval. A session can terminate at `presenting` (user rejects) or `iterating` (user abandons) — those cases write a `partial` outcome to history; the design session is "complete" in the sense that further work would start over.

## Done when

- `framework_understood` — step 1 completed.
- `dept_validated` — step 3 path checks passed; `.claude/agents/<dept>/` exists.
- `name_unique` — step 4 collision check + slug-regex passed.
- `consultations_completed` — step 5 finished (consultations skipped via self-consultation guard count as completed).
- `proposal_presented` — step 9 output in chat.
- `user_approved` — step 10 unambiguous approval phrase received (OR `partial` if not).
- `agent_file_written` — step 11 succeeded (skipped if `partial` outcome).
- `history_entry_written` — file exists under `./history/`.

## Rollback

Removing a freshly-created agent file is just `rm .claude/agents/<dept>/<name>.md`. The dept charter's Members-section addition (if applied at step 11) can be reverted via a manual edit. No advisory backlinks are added at creation (the new agent owns nothing yet — `owns_processes: []`), so no cleanup elsewhere.

## History

Every invocation writes an entry (interactive design sessions are meaningful events). Body should capture: which agents were consulted (and which were skipped with reason), what each said, placement + tools rationale, whether the dept-charter Members-section update applied, and the new agent file path.
