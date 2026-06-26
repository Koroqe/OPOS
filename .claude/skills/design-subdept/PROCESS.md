---
process_name: design-subdept
owner: ops-manager
collaborators: [coo]
inputs: [parent_dept, subdept_description, backlog_item_path, design_lead_agent]
success_criteria: [framework_understood, parent_validated, name_validated, cross_collision_checked, consultations_completed, proposal_presented, user_approved, files_written, history_entry_written]
slo: "interactive — 10-20 minutes per session depending on user iteration"
version: 0.1.0
state_schema:
  - discovering: framework + parent + sub-dept-intent read; 5 name validations (steps 1-3)
  - placing: top-level vs sub-sub-dept decision; lead-agent decision (steps 4-5)
  - consulting: parent-lead + coo + optional peer queried via consult-agent (step 6)
  - drafting: SUBDEPT.md.tmpl filled with 7 tokens; data-scopes captured (steps 7-8)
  - presenting: proposal + open questions + charter target path surfaced to user (step 9)
  - iterating: revising based on user feedback until explicit approval (step 10)
  - committing: mkdir; charter written; optional .claude/agents/<parent>/ mkdir; /design-agent recommendation; history entry (steps 11-12)
---

# design-subdept

## Narrative

The 4th and final org-chart-shape primitive under `ops-manager`. Closes RISKS Risk 8 fully-fully (third + final tier — v0.4.0 closed agents via `design-agent`; v0.5.3 closed top-level depts via `design-department`; v0.8.0 closes sub-depts via this skill).

Owned by `ops-manager` because all 4 design-* skills are framework-design skills owned by the operations function. The dynamic collaborator (parent-lead) is consulted at runtime — `collaborators:` lists `coo` as the static collaborator; the parent-lead is determined by the `parent_dept` input.

**Plan-critic resolved 2 CRITICAL findings in this skill's design**: (1) DEPARTMENT.md.tmpl's depth-2 hardcoded paths produce broken links from a depth-3 sub-dept charter, addressed by forking the template to SUBDEPT.md.tmpl with depth-3 paths; (2) `<<DEPT_NAME>> = <parent>/<sub>` substitution semantics conflicted with the flat sub-lead agent placement, addressed by splitting into two pure-slug tokens (`<<PARENT_DEPT>>` + `<<SUB_NAME>>`).

## Pre-conditions

- `shared/templates/SUBDEPT.md.tmpl` exists and contains all 7 expected substitution tokens.
- The proposed sub-dept name matches the slug regex `^[a-z][a-z0-9-]{0,63}$`.
- The proposed sub-name is NOT in the framework-reserved 8-name list (shared with `design-department`).
- The parent dept exists at `departments/<parent_dept>/CLAUDE.md[.jinja]`.
- `departments/<parent_dept>/<subdept_name>/` does NOT already exist.
- No existing agent under `.claude/agents/<parent_dept>/` matches the to-be-written sub-lead name (`<subdept_name>-lead`).
- The user does NOT request a sub-sub-dept (depth > 2) — top-level → sub-dept (depth 1 → depth 2) only.

## Steps

Mirrors the 12-step procedure in SKILL.md:

1. Understand the framework (read root CLAUDE.md + SUBDEPT.md.tmpl + 2 reference charters + glossary).
2. Understand the parent + sub-dept (function, scope, authority, interface, expected sub-roles).
3. Identify sub-dept name + validate (5 conditions: slug regex, framework-reserved, parent exists, sub-folder collision, sibling-agent collision).
4. Decide org-chart placement (always depth-2; sub-sub-depts ABORT with 2 recovery paths).
5. Decide on a sub-lead agent (ASK yes/no; emit /design-agent recommendation, NOT auto-invoke).
6. Consult parent-lead + coo + optional peer via consult-agent.
7. Capture future sub-dept-internal artifact types (fills DATA_SCOPES token).
8. Draft the charter from SUBDEPT.md.tmpl (verify 7 tokens; substitute; document two-token semantics divergence from design-department).
9. Present to user (charter inline + summary + charter target path + open question on restricted-data).
10. Iterate to unambiguous approval.
11. Write the files (TOCTOU re-check; context-detect path; mkdir sub-dept folder; write charter ONLY; if lead-agent recommendation: mkdir .claude/agents/<parent>/ first; flip backlog item state if supplied).
12. Write design-subdept's own history entry (`subdept-<parent>-<sub>` short-run-id; capture parent context, consultations, lead-agent decision, path-convention decision, charter path).

## State transitions

Strict forward order. `iterating ↔ presenting` loop allowed until approval. A session can terminate at `presenting` (user rejects) or `iterating` (user abandons) — those cases write a `partial` outcome to history.

## Done when

- `framework_understood` — step 1 completed.
- `parent_validated` — step 3 confirmed parent dept exists.
- `name_validated` — step 3 slug-regex + reserved-list + sub-folder collision passed.
- `cross_collision_checked` — step 3 sibling-agent check passed (checked `<subdept_name>-lead`, NOT bare `<subdept_name>`).
- `consultations_completed` — step 6 finished (consultations skipped via self-consultation guard or no-clear-collaborator skip count as completed).
- `proposal_presented` — step 9 output in chat including the charter target path.
- `user_approved` — step 10 unambiguous approval received (OR `partial` if not).
- `files_written` — step 11 wrote EXACTLY one file (the charter) at the context-detected path; skipped if `partial`.
- `history_entry_written` — file exists under `./history/`.

## Rollback

Removing a freshly-created sub-dept charter is `rm departments/<parent>/<sub>/CLAUDE.md` (or `.jinja`) followed by `rmdir departments/<parent>/<sub>/` if empty. No advisory backlinks are added at creation (sub-dept owns nothing yet — no skills nested, no data/backlog subdirs), so no cleanup elsewhere. If the user invoked the step-11 `/design-agent` recommendation in a subsequent turn, the agent file is independent — undoing the sub-dept charter does NOT auto-remove the lead agent (user must `rm .claude/agents/<parent>/<sub-name>-lead.md` manually if desired).

If `mkdir -p .claude/agents/<parent>/` was created by step 11 (parent had no agents previously), it remains; rolling back is `rmdir .claude/agents/<parent>/` if still empty. Harmless either way.

## History

Every invocation writes an entry. Body captures: parent-dept context, each consultation + 1-line response, name validation result, lead-agent decision (designed-same-session-recommended vs deferred), path-convention decision (framework vs consumer), the charter file path written, and any TOCTOU/mkdir notes.
