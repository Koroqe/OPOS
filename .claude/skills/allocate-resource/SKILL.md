---
name: allocate-resource
description: Receives a capability gap, runs the AI-first decision tree (4 yes/no questions), and routes to either design-agent (AI route) or a human-hire job spec (human route). The AI-first kernel of OPOS — every gap is evaluated for AI suitability before human hire.
version: 0.1.0
tags: [meta, framework, hr, resource-allocation, ai-first]
owner_agent: people-lead
tools: ["Read", "Grep", "Glob", "Edit", "Write", "Task"]
---

# allocate-resource

## When to use

When ANY dept (or the founder) surfaces a capability gap and needs to decide: design an AI agent OR hire a human? Invoked as `/allocate-resource` with the gap description. Owner: `people-lead`. This is the AI-first kernel — the codified philosophy that EVERY gap is evaluated for AI suitability before human hire.

Typical invocation: a dept lead surfaces "we need to be able to do X" → people-lead runs `allocate-resource` → AI route emits a `/design-agent` recommendation OR human route writes a job spec to `company/hiring/<slug>.md`.

## Inputs

- `capability_gap` — free-text description of what the company needs to be able to do. Required. Minimum 20 chars (re-prompted if too vague).
- `urgency` — optional: `immediate` | `weeks` | `months`. Used in the history entry for prioritization signal.
- `requested_by` — optional: agent or dept name that surfaced the gap. Captured for the audit trail.

## Path convention

Runs on the consumer's repo. All paths are rendered `.md` (no `.jinja` suffixes at this stage — same convention as `company-setup` and `design-agent`).

## Steps

0. **Lessons pass + provenance duty (v0.11, applies to every run).** Before designing: read the company's `kind: lesson` backlog items (glob `**/backlog/*.md`, filter frontmatter `kind: lesson`) whose `mistake_class`/`root_cause_target` matches this skill or the artifact class it produces, plus this skill's own `history/` entries with open `proposed_delta`s; apply every matching constraint to the draft and LIST the applied lessons in the proposal so the human sees the loop working. When writing the artifact: stamp provenance — frontmatter `derived_from: <template>@<framework-version>` + `designed_by: <this-skill>@<its version>` (framework version = `.copier-answers.yml` `_commit`; in the framework repo itself use the current release tag); charter files get the equivalent HTML comment stamp at file end.

1. **Resolve repo root + parse capability_gap.** Validate ≥20 chars; if too vague, re-prompt with: "Please describe the capability gap more specifically — at least one sentence about what the company needs to be able to do."

2. **Coverage check (glob-based).** Use `Glob` to enumerate `.claude/agents/**/*.md` and `.claude/skills/*/SKILL.md`. For each file, use `Grep` to read the `description:` frontmatter line. Tokenize `capability_gap` (case-insensitive, whitespace split, drop stop-words). If ≥2 distinct tokens match an existing entity's description, STOP with `outcome: covered_by_existing` and print:
   ```
   Coverage check found existing capability: <agent_name> at <path>.
   Recommendation: invoke <agent_name> directly instead of designing a new agent.
   ```
   The skill exits here; people-lead reports back to the requester.

3. **Present the AI-first decision tree (4 yes/no questions).** Ask the user (or auto-compute if requester pre-answered):
   - **Q1**: Is the core work text-based (reading documents, writing content, analyzing data)?
   - **Q2**: Does the work AVOID requiring physical-world action (driving, on-site presence, hands-on physical work)?
   - **Q3**: Does the work AVOID requiring legally-mandated human accountability (signing as a licensed professional, sworn testimony)?
   - **Q4**: Does the work AVOID requiring lived human experience as a primary input (judging mood in a room, building trust face-to-face)?

   Accept `yes` / `y` / `Y` / `no` / `n` / `N` for each. Re-prompt on any other input.

4. **Compute the route.** **All 4 yes → AI route.** **Any no → Human route.** Capture which question(s) failed for the `why_not_ai:` field in the human route.

5. **AI route — EMIT a recommendation; do NOT auto-invoke.** The skill does NOT autonomously run `/design-agent` (the `Task` tool spawns subagents but doesn't execute slash commands; auto-invoke would be non-functional). Instead, print:
   ```
   ╔══════════════════════════════════════════════════════════════╗
   ║  ALLOCATE-RESOURCE: AI ROUTE                                  ║
   ╠══════════════════════════════════════════════════════════════╣
   ║  Capability gap is AI-suitable (all 4 decision-tree Q's pass).║
   ║                                                                ║
   ║  Next step: invoke /design-agent in this same Claude Code     ║
   ║  session with role_description = "<capability_gap>".          ║
   ║                                                                ║
   ║  ops-manager owns design-agent; this hand-off matches the     ║
   ║  v0.4.0 design-process → design-agent pattern documented in   ║
   ║  design-process/SKILL.md Failure modes.                       ║
   ╚══════════════════════════════════════════════════════════════╝
   ```
   The user (or people-lead in next turn) then runs `/design-agent`. `allocate-resource`'s history entry records the AI-route decision; `design-agent`'s eventual history entry records the agent creation. The two entries form an auditable pair.

6. **Human route — write a job spec to `company/hiring/<slug>.md`.** Derive the slug:
   - Tokenize `capability_gap` on whitespace; lowercase.
   - Strip stop-words: `the, a, an, of, for, to, and, or, in, on, with, by, as, our, we, need, want, who, can, that, this, is, are, will, would, should`.
   - Take the first 3–5 surviving meaningful tokens; join with `-`.
   - Truncate to 62 chars.
   - **Validate against `safe_slug` regex** `^[a-z][a-z0-9-]{1,62}$` (same pattern as `ui/validate.py:safe_slug`, `design-agent` step 4, `company-setup` step 8). If validation fails, ABORT and ask the user for an explicit slug.
   - **Collision check:** if `company/hiring/<slug>.md` already exists, append `-2`, `-3`, … until a free slot is found.

   Render `shared/templates/HIRING-SPEC.md.tmpl` (strip the HTML comment header — lines 1 through the closing `-->`) → substitute the 9 tokens → write to `company/hiring/<slug>.md`. Frontmatter: `state: pending`, `why_not_ai: <Q-N: <one-line reason>>`. Body sections (Scope, Responsibilities, Qualifications, Hours, Escalation) filled from the conversational follow-ups.

7. **Escalate to ceo (human route only).** Print:
   ```
   ╔══════════════════════════════════════════════════════════════╗
   ║  ALLOCATE-RESOURCE: HUMAN ROUTE                               ║
   ╠══════════════════════════════════════════════════════════════╣
   ║  Capability gap requires a human hire.                        ║
   ║  Why not AI: <why_not_ai>                                     ║
   ║                                                                ║
   ║  Job spec written to: company/hiring/<slug>.md                ║
   ║  State: pending                                                ║
   ║                                                                ║
   ║  Next step: ceo to review and flip frontmatter state:         ║
   ║  pending → approved if green-lit; then posted; then filled.   ║
   ╚══════════════════════════════════════════════════════════════╝
   ```

8. **Print final summary.** One line: `allocate-resource done. Route: <ai|human>. Output: <path-or-recommendation>.`

9. **Write history entry** to `.claude/skills/allocate-resource/history/YYYY-MM-DD-<short-run-id>.md`. Convention: `<short-run-id>` is a kebab-case slug from the first 3 meaningful words of `capability_gap` (same algorithm as step 6 but without the `safe_slug` validation — history file names are local). Include `time: HH:MM`. Body captures: the `capability_gap` verbatim, all 4 decision-tree answers (with reasons), route taken, output path or recommendation, and any coverage-by-existing match.

## Outputs

- AI route: a printed recommendation to invoke `/design-agent` (no autonomous file write).
- Human route: a new `company/hiring/<slug>.md` file with `state: pending`.
- Either route: a history entry under `.claude/skills/allocate-resource/history/`.

## Failure modes

- **capability_gap too vague (<20 chars)** — step 1 re-prompt loop.
- **Already covered by existing capability** — step 2 STOP with `outcome: covered_by_existing`; print pointer; not failure.
- **Slug-regex fail** (step 6) — ABORT and ask user for an explicit slug. Do NOT auto-coerce.
- **HIRING-SPEC.md.tmpl missing or modified** — ABORT with: "HIRING-SPEC.md.tmpl missing or modified — restore via `copier update`."
- **User Ctrl-C mid-session** — partial state is the user-typed answers in chat; no file written; no history entry. Re-run from scratch.

## Related

- Process definition: `./PROCESS.md`
- Run history: `./history/`
- Template (human route): [`shared/templates/HIRING-SPEC.md.tmpl`](../../../shared/templates/HIRING-SPEC.md.tmpl)
- Folder convention (human route output): [`company/hiring/`](../../../company/hiring/)
- AI route hand-off: [`design-agent`](../design-agent/) (owned by ops-manager)
- Owner agent: [`people-lead`](../../agents/people/people-lead.md)
- Philosophical kernel of: OPOS's AI-first organizational philosophy (introduced v0.5.1)
