---
name: design-department
description: Design a new top-level department by reading the framework, consulting ceo + coo + (optionally) a related dept lead, drafting a charter from DEPARTMENT.md.tmpl, and writing the dept folder. Optionally emits a /design-agent recommendation for the dept's lead.
version: 0.1.0
tags: [meta, framework, dept-design]
owner_agent: ops-manager
tools: ["Read", "Grep", "Glob", "Edit", "Write", "Task"]
---

# design-department

## When to use

Invoke when a new top-level department needs to exist. Two entry points:

1. **Fresh dept description** — the user says "we need a department for X" (e.g., "customer-success", "data engineering", "product research").
2. **Formalize a backlog item** — the user points at a `BACKLOG-ITEM.md` whose `intended_target` is a dept.

The skill is INTERACTIVE: it produces a proposal, iterates with the user, and only writes the dept charter on explicit user approval. The human is the approval gate. This is the third member of the `design-*` family — after `design-process` (v0.1.0) and `design-agent` (v0.4.0). All three are owned by `ops-manager`; together they close the org-chart-expansion loop end-to-end (skills, agents, depts).

**Top-level only.** Sub-depts (`A` under `B`) are NOT supported in v0.5.3 — they require a sub-lead delegation pattern that's better modeled via `design-agent`'s sub-role creation (see v0.5.1's eng-lead-under-rnd pattern). A future `design-subdept` skill would close that gap. For now, if a founder wants `compliance` under `legal`, recommend `/design-agent` for a `compliance-lead` agent placed at `.claude/agents/legal/`.

## Inputs

- `dept_description` — free-text description of what the new dept owns, its function, authority, interface, and (optionally) a suggested name. Required if no `backlog_item_path`.
- `backlog_item_path` — OPTIONAL. Path to a `BACKLOG-ITEM.md` whose `intended_target` is a dept. When supplied, the item's frontmatter seeds the proposal; the item is flipped to `state: designed` with a `designed_as: departments/<name>/` field at step 11.
- `design_lead_agent` — OPTIONAL bool (default: ASK the user during step 5). When `yes`, the skill captures the proposed lead-agent name + a brief role description and emits a `/design-agent` recommendation at step 11 (NOT auto-invoked — see step 5 rationale). When `no`, the charter ships with `<dept-name>-lead` as the placeholder Roles entry; the user designs the lead later.

## Path convention (context-detected)

The skill detects whether it's running on the framework itself (dogfood) vs a consumer's already-rendered repo via a 2-stat check:

- **Framework context** (`copier.yml` exists at repo root AND root `CLAUDE.md.jinja` exists): write the charter as `departments/<name>/CLAUDE.md.jinja`. Matches the 6 v0.5.1 starter depts' `.jinja` suffix; future `copier copy` scaffolds substitute `{{ COMPANY_NAME }}` in the new charter.
- **Consumer context** (no `copier.yml`, OR root has `CLAUDE.md` not `CLAUDE.md.jinja`): write as `departments/<name>/CLAUDE.md` (no `.jinja` suffix — Copier substitutions already done; the file is consumer-owned; future `copier update` skips `departments/**` per `_skip_if_exists` in upstream `copier.yml`).

The 2-stat check is the WHOLE detection — no heuristics, no probabilities. False classification is unlikely (the framework's `copier.yml` won't appear in a consumer's already-rendered repo, and the framework's root will always have `CLAUDE.md.jinja` until a future redesign moves it).

## On `data/` and `backlog/` folders

The BACKLOG-AS-NOTEBOOK + dept-internal-data conventions are documented at the framework level (root `CLAUDE.md`), but they are CREATED ON DEMAND, not pre-scaffolded by this skill. A founder running `/design-department` does NOT automatically get `data/` or `backlog/` subdirs — they create those when actual artifacts (a draft, a SQL query, a backlog item) need to land. This matches the v0.5.1 starter pattern: 5 of 6 starter depts (`finance`, `people`, `legal`, `commercial`, `pr`) ship only `CLAUDE.md.jinja`; only `rnd` has the richer `data/` + `backlog/` + `.claude/skills/` scaffolding (a historical artifact of the v0.5.1 engineering-into-rnd merge). The minimal-scaffolding default keeps blast radius small and consistent.

A future v0.5.x release MAY backfill `data/` + `backlog/` on all 6 starters, at which point this skill should be updated to match.

## Steps

1. **Understand the framework.** Read root `CLAUDE.md` (or `.jinja` source if in framework context), `shared/templates/DEPARTMENT.md.tmpl`, AND two reference dept charters: `departments/rnd/CLAUDE.md` (the umbrella case with sub-leads) AND `departments/finance/CLAUDE.md` (the simple single-lead case). **For each charter, try `.md` first, then `.md.jinja` if `.md` does not exist** — mirrors design-agent step 3's `(or .jinja source)` convention; the framework dogfood reads `.md.jinja` while consumers read `.md`. Read `company/knowledge-base/glossary.md` for vocabulary.

2. **Understand the dept.** Parse `dept_description` (and `backlog_item_path` if supplied). Identify:
   - **Function** — what work does this dept own?
   - **Scope** — single-purpose vs cross-functional vs umbrella.
   - **Authority** — what decisions does the dept lead make alone? what escalates to `coo`/`ceo`?
   - **Interface** — what artifacts does the dept produce? what does it consume from other depts?
   - **Expected sub-roles** — none initially; future via `design-agent`. Capture any hints in the description for future reference.

3. **Identify name + validate.** Parse the proposed dept name. If not provided, derive from `dept_description` (first 1-2 meaningful nouns, kebab-case). Validate ALL conditions; ANY fail → ABORT and ask user for a different name (do NOT auto-coerce):
   - **Slug regex** `^[a-z][a-z0-9-]{0,63}$` (VERBATIM `_SLUG_RE` from [`ui/validate.py`](../../../ui/validate.py) line 15 — min 1 char, max 64 chars). The canonical source is `ui/validate.py:_SLUG_RE`. Earlier design-* skills may state the bounds incorrectly as `{1,62}` — when in doubt, treat `ui/validate.py` as authoritative.
   - **Framework-reserved exact-match** against this hand-maintained list:
     ```
     rnd, finance, people, legal, commercial, pr, engineering, company
     ```
     The 6 v0.5.1 starter depts + the historical `engineering` (pre-v0.5.1, now merged under `rnd`) + the synthetic `company` scope (non-departmental). **Match semantics: exact whole-string equality, NOT prefix.** So `customer-success` is allowed; `engineering` alone is not (instead: add a role to `departments/rnd/` via `/design-agent`).
     - Rationale for the `engineering` reservation: v0.5.1 explicitly merged engineering into the R&D umbrella as the AI-first kernel's opinion. Allowing a parallel `departments/engineering/` would re-fragment the structure. Founders who want a distinct engineering identity should rename `rnd` to taste or add sub-leads under it.
   - **Existing-folder collision**: `departments/<name>/` already exists.

4. **Decide org-chart placement.** All v0.5.3 dept creations are TOP-LEVEL (peer to the 6 starter depts). If the user requests a sub-dept ("compliance under legal", "data under rnd"), ABORT with: "Sub-depts (`A` under `B`) are not yet supported by `design-department` (v0.5.3 ships top-level only). For sub-roles under an existing dept, use `/design-agent` instead — the v0.5.1 eng-lead-under-rnd pattern shows how sub-leads work without dedicated sub-dept folders. A future `design-subdept` skill would close this gap."

5. **Decide on a lead agent.** Ask the user: "Do you want me to also design a lead agent for this dept in the same session? (yes/no)" — default: yes. The skill DOES NOT auto-invoke `/design-agent` (the v0.5.1 anti-pattern documented in `allocate-resource` step 5 — the `Task` tool spawns sub-AGENTS but cannot execute slash commands). Instead:
   - If **yes**: capture the proposed lead-agent name (default: `<dept-name>-lead`) and a brief role description. At step 11, the skill prints a prominent `/design-agent` RECOMMENDATION for the user to invoke in the NEXT turn. The new charter ships with the proposed lead name as the placeholder in the Roles section.
   - If **no**: ship the charter with `<dept-name>-lead` as the placeholder Roles entry; the user designs the lead later (or never — the charter still functions; the broken Roles-section link surfaces via the console's `/departments/<name>` page).

6. **Consult relevant agents via `consult-agent`.** Up to 3 consultations (cost-aware mitigation per RISKS Risk 6):
   - **`ceo`** (always) —
     > "We're adding a new dept: `<dept-name>` — `<dept_description summary>`. What strategic context should this dept know? What does it NOT touch (where does its remit end)? Any blocking concerns from your perspective?"
   - **`coo`** (always) —
     > "We're adding a new dept: `<dept-name>` — `<dept_description summary>`. What's the right escalation path (default `<dept-name>-lead → coo → ceo`)? Any process-health considerations — does this dept's work cross any existing dept's authority?"
   - **One existing dept lead OR sub-lead** that the new dept will collaborate with (optional; if obvious from the description). Pick the MOST-SPECIFIC consult, not the dept-folder owner:
     - A new `data` dept consults `eng-lead` (engineering sub-lead under rnd owns infra), NOT `rnd-lead` (the umbrella).
     - A new `customer-success` dept consults `commercial-lead`.
     - A new `research` dept might consult `rnd-lead` (the umbrella's other sub-discipline beyond engineering).
     - A new `compliance`-ish dept consults `legal-lead`.
     Use the dept's specific operational fit, not the folder hierarchy. Skip entirely if no clear collaborator surfaces.

   **Self-consultation guard:** if the new dept's lead-name equals one of the consultation targets (unlikely for dept creation but defensive), skip and note in step 12's history-entry body.

7. **Capture future dept-internal artifact types.** Identify what `data/` artifacts the dept WILL eventually hold (these fill the `<<DATA_SCOPES>>` template token at step 8 — they're DOCUMENTED in the charter, not pre-scaffolded as directories):
   - For a hypothetical `data` dept: SQL queries, ETL specs, data-quality reports, schema migrations.
   - For `customer-success`: NPS surveys, churn analyses, onboarding playbooks, escalation logs.
   - For `research`: market reports, user-interview notes, prototype evaluations.
   Capture from `dept_description` and the step-6 consultations.

8. **Draft the charter.** First, **verify `shared/templates/DEPARTMENT.md.tmpl` exists AND contains all 6 expected substitution tokens** (`<<DEPT_NAME>>`, `<<DEPT_TITLE>>`, `<<MISSION>>`, `<<LEAD_NAME>>`, `<<ESCALATION>>`, `<<DATA_SCOPES>>`). If missing or any token absent, ABORT with: "DEPARTMENT.md.tmpl missing or modified — restore from `Koroqe/OPOS` upstream via `copier update`."

   Render the template:
   - `<<DEPT_NAME>>` = the validated kebab-case name (e.g., `customer-success`).
   - `<<DEPT_TITLE>>` = title-case display version (e.g., `Customer Success`).
   - `<<MISSION>>` = 1-3 sentence mission synthesized from `dept_description` + ceo/coo consultations. State both what the dept owns AND what it doesn't (interface boundary).
   - `<<LEAD_NAME>>` = the lead-agent name from step 5 (default `<dept-name>-lead`).
   - `<<ESCALATION>>` = escalation pattern. Default: `<<LEAD_NAME>> → coo → ceo`. Adjust per `coo` consultation if a non-standard escalation surfaces.
   - `<<DATA_SCOPES>>` = bullet list of dept-internal data types from step 7. State whether data should be `restricted: true` per RISKS Risk 1 (default: not restricted; surface as an open question at step 9).

9. **Present to the user.** Output the proposed charter contents as an inline code block in chat. Follow with a summary:
   - Which agents were consulted + 1-line summary of each consultation (including which were SKIPPED with reason).
   - Placement rationale (top-level peer; not a sub-dept).
   - Lead-agent decision from step 5 + the exact `/design-agent` invocation that will be RECOMMENDED at step 11 if applicable.
   - **Charter target path** — `departments/<name>/CLAUDE.md.jinja` (framework context) OR `departments/<name>/CLAUDE.md` (consumer context). State which one and why (per the Path convention check at the top of this file).
   - Open questions. **Always surface as an explicit open question:** should the dept's `data/` content (when created later) be `restricted: true` per the RISKS Risk 1 convention? Some depts (compliance, executive-ops, a future security dept) typically need it; most don't. Default: not restricted. This is documented in the charter's data-scopes section as a directive; no `data/` dir is pre-created.

10. **Iterate.** The user proposes edits. Revise the proposal and re-present. Loop until the user gives an unambiguous approval phrase ("write it", "approve", "ship it", "ok do it"). Phrases like "I'd like to approve this but…" do NOT count — those are still iteration requests.

11. **Write the files.** On unambiguous approval:
    - **Re-check name collision** (same checks as step 3 — TOCTOU close; single-machine only; cross-machine per Risk 15).
    - **Detect context** (per Path convention at top of file): `copier.yml` at repo root AND root `CLAUDE.md.jinja` present → framework context (write `.md.jinja`); otherwise consumer context (write `.md`).
    - Write the charter to the context-detected path: `departments/<name>/CLAUDE.md.jinja` (framework) OR `departments/<name>/CLAUDE.md` (consumer). **This is the ONLY file the skill writes**; no `data/`, `backlog/`, or `.claude/skills/` subdirs are created (per the on-demand convention documented above).
    - If `design_lead_agent` was `yes` in step 5: print the `/design-agent` recommendation prominently — e.g., `**Next step (recommended):** /design-agent "<<LEAD_NAME>> — <role_description from step 5>"`. The user invokes it in the next turn; step 12's history captures the deferred agent creation.
    - If a `backlog_item_path` was supplied: edit it — flip `state:` from `active` to `designed`, add `designed_as: departments/<name>/`.

12. **Write design-department's own history entry.** Append to `.claude/skills/design-department/history/YYYY-MM-DD-<short-run-id>.md` per the root `CLAUDE.md` schema (including the optional `time: HH:MM` from v0.3.1). Convention: `<short-run-id>` = `dept-<dept-name>` (e.g., `dept-customer-success` — the `dept-` prefix disambiguates when both `design-agent` and `design-department` histories are browsed via `find .claude/skills/*/history/`).
    - `actor: ops-manager`
    - `outcome: success` (charter written) OR `partial` (user did not approve)
    - `proposed_delta:` — note any tension surfaced during consultation, mismatches between consulted recommendations and the final proposal, or template/tooling friction. Use "none" only when the session was smooth.
    - `status: applied`
    - Body: which agents consulted (and which were skipped with reason), what each said, placement rationale (top-level), path-convention decision (framework vs consumer), lead-agent decision (designed-same-session-recommended vs deferred), the charter file path written, link to the new dept folder.

## Outputs

- New dept charter at `departments/<name>/CLAUDE.md` OR `departments/<name>/CLAUDE.md.jinja` (context-detected; see Path convention).
- **Recommendation** to run `/design-agent` in the next turn (if step 5's `design_lead_agent` was `yes`) — the skill does NOT auto-invoke per the v0.5.1 anti-pattern.
- Updated backlog item (if input): `state: designed`, `designed_as: departments/<name>/`.
- One run entry in `.claude/skills/design-department/history/`.
- A one-line summary in chat.

## Failure modes

- **Conflicting dept name** — step 3 fail. Recovery: ask user for a different name.
- **Slug-regex fail** — step 3 fail. Recovery: print the regex `^[a-z][a-z0-9-]{0,63}$` + offer concrete suggestions (lowercase, replace spaces with `-`, etc.). Do NOT auto-coerce.
- **Framework-reserved name** — step 3 fail. Print the reserved-list rationale (e.g., "`engineering` is historical; add a role to `departments/rnd/` via `/design-agent` instead").
- **Sub-dept requested** — step 4 ABORT (see the v0.5.3 scope statement above).
- **`DEPARTMENT.md.tmpl` missing or modified** — step 8 fail. Recovery: `copier update` to restore upstream; or hand-fix the template against the upstream tokens.
- **Consultation timeout** — `consult-agent` returns no response. Recovery: skip that consultation, note in proposal AND in step 12's history-entry body, proceed.
- **User does not approve** — files NOT written. Step 12 still runs with `outcome: partial`.
- **TOCTOU collision** (step 3 → step 11) — single-machine: step 11 re-check catches it. Cross-machine: not addressed in v0.5.3 per Risk 15 (state files are per-machine).

## Related

- Process definition: `./PROCESS.md`
- Run history: `./history/`
- Sibling skills: [`design-process`](../design-process/) — new skills; [`design-agent`](../design-agent/) — new agent roles. All three owned by `ops-manager`.
- Used by: [`consult-agent`](../consult-agent/) — invoked in step 6 for each consultation.
- Template: [`shared/templates/DEPARTMENT.md.tmpl`](../../../shared/templates/DEPARTMENT.md.tmpl)
- Owner agent: [`.claude/agents/company/ops-manager.md`](../../agents/company/ops-manager.md)
- Closes: RISKS.md Risk 8 fully (was partially-closed in v0.4.0 by `design-agent`).
