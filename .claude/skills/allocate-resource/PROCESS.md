---
process_name: allocate-resource
owner: people-lead
collaborators: [ops-manager, ceo, finance-lead]
inputs: [capability_gap, urgency, requested_by]
success_criteria: [gap_parsed, coverage_checked, decision_tree_run, route_determined, route_executed, history_entry_written]
slo: "5-15 minutes interactive (depending on decision-tree clarity + human-route follow-up detail)"
version: 0.1.0
# state_schema (commented per PROCESS.md.tmpl convention — documentation-only,
# no v0 runtime consumer):
#   - parsing: gap-text validation (≥20 chars) + tokenization (step 1)
#   - checking: glob-based coverage check against existing agents + skills (step 2)
#   - deciding: 4-question AI-first decision tree (steps 3-4)
#   - routing: AI route emits design-agent recommendation OR human route writes job spec (steps 5-7)
#   - recording: final summary + history entry (steps 8-9)
---

# allocate-resource

## Narrative

The AI-first kernel of OPOS. Introduced in v0.5.1 as a formal skill (was previously an unspoken convention). When any dept surfaces a capability gap, `allocate-resource` codifies the decision: design an AI agent first, hire a human only when the work genuinely requires lived experience / legal accountability / physical action.

Owned by `people-lead` (the v0.5.1 modern-framed name for HR's resource-allocation function). `ops-manager` is a collaborator (the AI route hands off to design-agent which ops-manager owns). `ceo` is the approval target for the human route. `finance-lead` is consulted for operating-cost projections (AI route — Opus tokens, MCP fees) and budget approval (human route — salary, benefits).

## Pre-conditions

- `shared/templates/HIRING-SPEC.md.tmpl` exists (for the human route).
- `company/hiring/` folder exists (created by Slice 1 of v0.5.1; consumer-owned post-scaffold via copier.yml `_skip_if_exists`).
- `ui/validate.py:safe_slug` regex (`^[a-z][a-z0-9-]{1,62}$`) is the canonical slug rule (shared with `design-agent` and `company-setup`).
- The 4 AI-first decision-tree questions are stable in the SKILL.md body; changes there require a release note.

## Steps

Mirrors the 9-step procedure in SKILL.md:

1. Parse capability_gap (≥20 chars).
2. Coverage check (glob-based; tokenize, ≥2-token match → STOP).
3. Present 4-question decision tree.
4. Compute route (all-yes → AI; any-no → human).
5. AI route → emit `/design-agent` recommendation (do NOT auto-invoke).
6. Human route → derive slug + write `company/hiring/<slug>.md`.
7. Escalate to ceo (human route only).
8. Print final summary.
9. Write history entry.

## Done when

- `gap_parsed` — step 1 passed (≥20 chars).
- `coverage_checked` — step 2 ran (either STOPped or proceeded).
- `decision_tree_run` — step 3 produced 4 yes/no answers.
- `route_determined` — step 4 computed AI or human.
- `route_executed` — step 5 OR step 6 completed.
- `history_entry_written` — file exists under `./history/`.

## Rollback

- AI route: nothing was created (just a recommendation printed). No rollback needed.
- Human route: `rm company/hiring/<slug>.md` to undo the job-spec write. History entry can be manually deleted from `.claude/skills/allocate-resource/history/` if the run was a mistake.

## History

Every invocation writes a history entry — these are auditable resource-allocation decisions. Body captures: capability_gap verbatim, all 4 decision-tree answers (with reasons), route taken, output path or recommendation, and any coverage-by-existing match. `proposed_delta:` records UX friction or decision-tree-ambiguity surfaced during the run (the AI-first kernel is opinionated; edge cases inform future v0.5.x patches).
