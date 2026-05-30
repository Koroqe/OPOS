---
process_name: design-department
owner: ops-manager
collaborators: [ceo, coo]
inputs: [dept_description, backlog_item_path, design_lead_agent]
success_criteria: [framework_understood, name_validated, consultations_completed, proposal_presented, user_approved, files_written, history_entry_written]
slo: "interactive — 10-20 minutes per session including user iteration"
version: 0.1.0
state_schema:
  - discovering: framework + dept + name read; slug/reserved/collision check (steps 1-4)
  - consulting: ceo + coo + optional dept-lead queried via consult-agent (steps 5-6)
  - drafting: DEPARTMENT.md.tmpl filled; lead-agent decision captured (steps 7-8)
  - presenting: proposal + open questions surfaced to user (step 9)
  - iterating: revising based on user feedback until explicit approval (step 10)
  - committing: charter written; optional /design-agent recommendation printed; history entry recorded (steps 11-12)
---

# design-department

## Narrative

Fully closes the "expanding the org chart" gap previously documented as RISKS Risk 8. v0.4.0's `design-agent` closed the new-agent case; v0.5.3's `design-department` closes the new-dept case. `ops-manager` now owns the FULL design-* family — skills (via `design-process`), agents (via `design-agent`), depts (via `design-department`) — and can generate any framework primitive from natural-language input.

Owned by `ops-manager` (same as `design-process` and `design-agent`) because all three are framework-design skills owned by the operations function. `ceo` and `coo` listed as collaborators since dept-creation decisions affect strategic posture (ceo) and operational fit (coo) at the org-chart level.

## Pre-conditions

- `shared/templates/DEPARTMENT.md.tmpl` exists and contains all 6 expected substitution tokens.
- The proposed dept name matches the slug regex `^[a-z][a-z0-9-]{0,63}$` (verbatim `ui/validate.py:_SLUG_RE`).
- The proposed name is NOT in the framework-reserved exact-match list (`{rnd, finance, people, legal, commercial, pr, engineering, company}`).
- `departments/<name>/` does NOT already exist.
- The user does NOT request a sub-dept (`A` under `B`) — top-level only in v0.5.3.

## Steps

Mirrors the 12-step procedure in SKILL.md:

1. Understand the framework.
2. Understand the dept (function, scope, authority, interface).
3. Identify name + validate (slug + reserved + collision).
4. Decide org-chart placement (top-level only).
5. Decide on a lead agent (yes/no — yes emits /design-agent recommendation at step 11).
6. Consult relevant agents (ceo + coo always; one specific collaborator optional).
7. Capture future dept-internal artifact types (fills `<<DATA_SCOPES>>`).
8. Draft the charter (verify DEPARTMENT.md.tmpl + render 6 tokens).
9. Present to the user (proposal + charter target path + open question on `restricted:`).
10. Iterate to approval.
11. Write the charter (context-detected suffix; ONLY the charter — no `data/`, `backlog/`, `.claude/skills/` subdirs).
12. Write design-department's own history entry (`dept-<name>` short-run-id convention).

## State transitions

Strict forward order. `iterating ↔ presenting` loop allowed until approval. A session can terminate at `presenting` (user rejects) or `iterating` (user abandons) — those cases write a `partial` outcome to history; the design session is "complete" in the sense that further work would start over.

## Done when

- `framework_understood` — step 1 completed (root CLAUDE.md + template + 2 reference charters read).
- `name_validated` — step 3 slug-regex + reserved-list + collision check passed.
- `consultations_completed` — step 6 finished (consultations skipped via self-consultation guard count as completed).
- `proposal_presented` — step 9 output in chat including the charter target path.
- `user_approved` — step 10 unambiguous approval phrase received (OR `partial` if not).
- `files_written` — step 11 succeeded — exactly ONE file (the charter) written at the context-detected path; skipped if `partial` outcome.
- `history_entry_written` — file exists under `./history/`.

## Rollback

Removing a freshly-created dept charter is just `rm departments/<name>/CLAUDE.md` (or `.jinja`) followed by `rmdir departments/<name>/` if the dir is empty. No advisory backlinks are added at creation (the dept owns nothing yet — no skills nested under it, no `data/` or `backlog/` subdirs), so no cleanup elsewhere. If the user invoked the step-11 `/design-agent` recommendation in a subsequent turn, the agent file is independent — undoing the dept charter does NOT auto-remove the lead agent (the user must manually `rm .claude/agents/<dept>/<lead>.md` if desired).

## History

Every invocation writes an entry (interactive design sessions are meaningful events). Body should capture: which agents were consulted (and which were skipped with reason), what each said, placement rationale (top-level), the path-convention decision (framework vs consumer context), the lead-agent decision (designed-same-session-recommended vs deferred), and the charter file path written.
