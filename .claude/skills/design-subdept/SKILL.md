---
name: design-subdept
description: Design a sub-dept under an existing top-level dept by reading parent + framework, consulting parent-lead + coo + (optionally) a related sub-lead, drafting a charter from SUBDEPT.md.tmpl with sub-dept escalation chain, and writing the nested folder. Optionally emits a /design-agent recommendation for the sub-lead.
version: 0.1.0
tags: [meta, framework, dept-design, sub-dept]
owner_agent: ops-manager
tools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash", "Task"]
---

# design-subdept

## When to use

Invoke when an existing top-level department needs to be sub-divided into a sub-dept with its own organizational scope (own backlog, own data, own skills folder, cascade-inherited charter). Three entry points:

1. **Fresh sub-dept description** — the user says "we need a compliance sub-dept under legal" or "data should be its own thing under rnd."
2. **Formalize a backlog item** — the user points at a `BACKLOG-ITEM.md` whose `intended_target` is a sub-dept.
3. **Escalation from `design-department`** — when the user asks for a top-level dept that's really a sub-organization of an existing one, `design-department` directs them here.

The skill is INTERACTIVE: it produces a proposal, iterates with the user, and only writes the sub-dept charter on explicit user approval. The human is the approval gate. This is the **4th and final member of the `design-*` family** — after `design-process` (v0.1.0), `design-agent` (v0.4.0), `design-department` (v0.5.3). All four are owned by `ops-manager`; together they close the org-chart-expansion loop end-to-end (skills, agents, top-level depts, sub-depts).

**Depth-2 only (sub-sub-depts NOT supported).** v0.8.0 ships top-level → sub-dept (depth 1 → depth 2). Depth-3 (`A` under `B` under `C`) is intentionally not supported — see step 4 for recovery paths.

## Inputs

- `parent_dept` — required; the existing top-level dept slug (e.g., `legal`, `rnd`). Must match an existing folder under `departments/`.
- `subdept_description` — required (unless `backlog_item_path` is supplied); free-text description of what the sub-dept owns + optionally a suggested name.
- `backlog_item_path` — OPTIONAL. Path to a `BACKLOG-ITEM.md` whose `intended_target` is a sub-dept. When supplied, the item's frontmatter seeds the proposal; the item is flipped to `state: designed` with a `designed_as: departments/<parent>/<sub>/` field at step 11.
- `design_lead_agent` — OPTIONAL bool (default: ASK the user during step 5). When `yes`, the skill emits a `/design-agent` recommendation at step 11 for the next turn. When `no`, the charter ships with `<sub-name>-lead` as the placeholder Roles entry; the user designs the lead later.

## Path convention (context-detected, mirrors design-department)

The skill detects framework vs. consumer context via a 2-stat check:

- **Framework context** (`copier.yml` exists at repo root AND root `CLAUDE.md.jinja` exists): write charter as `departments/<parent>/<sub>/CLAUDE.md.jinja`. Future scaffolds substitute `{{ COMPANY_NAME }}`.
- **Consumer context** (no `copier.yml`, OR root has `CLAUDE.md` not `CLAUDE.md.jinja`): write as `departments/<parent>/<sub>/CLAUDE.md` (no `.jinja` suffix; substitutions already done).

## On `data/`, `backlog/`, `.claude/skills/` folders

Same minimal-scaffolding default as `design-department`. Charter only; subdirs created on demand by the founder. Documented in the charter's "Pointers" section. The convention propagates from the 5-of-6 v0.5.1 starter depts' minimal pattern (only `rnd` has the rich scaffolding due to v0.5.1 engineering-merger history).

## Steps

1. **Understand the framework.** Read root `CLAUDE.md` (or `.jinja` source in framework context); `shared/templates/SUBDEPT.md.tmpl` (this skill's primary template — NEW in v0.8.0; forked from DEPARTMENT.md.tmpl with depth-3 paths); two reference top-level charters as cascade examples — `departments/rnd/CLAUDE.md` (umbrella case with sub-leads) AND `departments/finance/CLAUDE.md` (minimal single-lead case). For each charter, try `.md` first, then `.md.jinja` if `.md` does not exist. Read `company/knowledge-base/glossary.md` for vocabulary.

2. **Understand the parent + sub-dept.** Read `departments/<parent_dept>/CLAUDE.md[.jinja]` FIRST — the sub-dept inherits from the parent, so understanding the parent's mission, lead, escalation rules, and existing roles is required before scoping the sub-dept. Then parse `subdept_description` (and `backlog_item_path` if supplied). Identify:
   - **Function** — what work does this sub-dept own that the parent currently does, or that's a natural new specialization within the parent's scope?
   - **Scope** — narrow specialization within the parent's broader function vs. cross-cutting concern that touches multiple depts (latter usually means it should be a top-level peer, not a sub-dept).
   - **Authority** — what decisions does the sub-lead make alone? What escalates to the parent-lead? What escalates further to coo/ceo?
   - **Interface** — what artifacts does the sub-dept produce? What does it consume from the parent? What from siblings (other sub-depts or top-level depts)?
   - **Expected sub-roles** — none initially; future via `design-agent`.

3. **Identify sub-dept name + validate.** Parse the proposed sub-name. If not provided, derive from `subdept_description`. Validate ALL conditions; ANY fail → ABORT and ask user for a different name (do NOT auto-coerce):

   - **Slug regex** `^[a-z][a-z0-9-]{0,63}$` (VERBATIM `_SLUG_RE` from [`ui/validate.py`](../../../ui/validate.py) line 15). Same regex shared with `design-agent`, `company-setup`, and `design-department`.
   - **Framework-reserved exact-match** against this hand-maintained list (REUSED from `design-department` step 3):
     ```
     rnd, finance, people, legal, commercial, pr, engineering, company
     ```
     Sub-dept name CANNOT shadow a top-level dept name. So `legal/compliance` is allowed; `legal/finance` is rejected (would confuse the org with the top-level `finance` dept). **Match semantics: exact whole-string equality, NOT prefix.**
   - **Parent dept exists** — `departments/<parent_dept>/CLAUDE.md` OR `departments/<parent_dept>/CLAUDE.md.jinja` must exist. If absent → ABORT with: "Parent dept `<parent>` not found. Use `/design-department` to create it first, then re-run `/design-subdept`."
   - **Sub-dept folder collision** — `departments/<parent_dept>/<subdept_name>/` already exists → ABORT.
   - **Cross-collision with sibling agents** — glob `.claude/agents/<parent_dept>/*.md` and check that NO existing agent file matches the to-be-written sub-lead. Specifically: assert neither (a) any file is named `<subdept_name>-lead.md`, NOR (b) any file has `name: <subdept_name>-lead` in its frontmatter. (Note: the check is for `<subdept_name>-lead` — the target lead-agent name, NOT the bare `<subdept_name>` — because step 5 places the lead at that exact filename.) If `.claude/agents/<parent_dept>/` does not exist yet, the check is trivially satisfied (no collision possible).

4. **Decide org-chart placement.** All v0.8.0 sub-dept creations land at `departments/<parent>/<sub>/`. **Sub-sub-depts (depth > 2) intentionally NOT supported.** If the user requests one (e.g., "litigation under legal/compliance"), ABORT with the following message:

   > Sub-sub-depts are not supported in v0.8.0 (intentional — they add hierarchy complexity rarely justified by the use case). Two recovery paths:
   >
   > (a) **Promote** — make `<requested_name>` a TOP-LEVEL sub-dept under the SAME root parent (`<root-parent>`, the depth-1 dept). Example: instead of `legal/compliance/contracts`, make `legal/contracts`. Most "depth-3" needs collapse cleanly into depth-2 with renaming.
   >
   > (b) **Use sub-role agent** — keep the existing sub-dept and add a sub-role agent within it via `/design-agent`. The agent lives at `.claude/agents/<root-parent>/<role-name>.md` (flat under the root-parent's agents folder, same as eng-lead/eng-reviewer under rnd).

5. **Decide on a sub-lead agent.** Ask the user: "Do you want me to also design a lead agent for this sub-dept in the same session? (yes/no)" — default: yes. The skill DOES NOT auto-invoke `/design-agent` (v0.5.1 anti-pattern documented in `allocate-resource` step 5 — the `Task` tool spawns subagents but cannot execute slash commands). Instead:

   - If **yes**: capture the proposed lead-agent name (default: `<subdept-name>-lead`, e.g., `compliance-lead`) and a brief role description. At step 11, the skill prints a prominent `/design-agent` RECOMMENDATION for the user to invoke in the NEXT turn. The new charter ships with the proposed lead name as the placeholder in the Roles section.
   - If **no**: ship the charter with `<subdept-name>-lead` as the placeholder; the user designs the lead later (or never — the charter still functions; the broken Roles-section link surfaces via the console's `/departments/<parent>/<sub>` page).

   **Lead-agent placement is FLAT** under the parent's agents folder: `.claude/agents/<parent>/<subdept-name>-lead.md` (e.g., `.claude/agents/legal/compliance-lead.md`). NOT nested under a sub-dept-specific agents subfolder. This matches the v0.5.1 rnd precedent where sub-leads (`eng-lead`, `eng-reviewer`) live at `.claude/agents/rnd/<name>.md` directly, not under a `.claude/agents/rnd/engineering/` subdir.

   **Note:** `.claude/agents/<parent>/` may not exist yet (no agents currently in that dept). Step 11 handles `mkdir -p` before the recommendation lands.

6. **Consult relevant agents via `consult-agent`.** Up to 3 consultations (cost-aware per RISKS Risk 6):

   - **Parent dept's lead** (always — e.g., `legal-lead` for `legal/compliance`):
     > "We're adding a sub-dept `<sub-name>` under your dept `<parent>` — `<sub_description summary>`. What strategic context should this sub-dept inherit from you? What sub-set of your responsibilities transfers to the new sub-lead? Where do you want a hard boundary between you and the new sub-lead's authority?"
   - **`coo`** (always):
     > "We're sub-dividing `<parent>` with a new sub-dept `<sub>` — `<sub_description summary>`. What's the right escalation path (`<sub>-lead → <parent>-lead → coo → ceo` default)? Any cross-dept coordination concerns where this sub-dept might overlap with other depts?"
   - **One peer sub-lead or related top-level dept-lead** (optional; skip if no clear collaborator):
     - For `legal/compliance` → consult `finance-lead` (regulatory financial reporting touches both).
     - For `rnd/data` → consult `eng-lead` (engineering infra owner under rnd).
     - For `commercial/customer-success` → consult `pr-lead` (customer comms touch both).
     > "We're adding a sub-dept `<sub>` under `<parent>` that may overlap with your scope. Any interface concerns? What boundary should we draw?"

   **Self-consultation guard:** if the proposed `<sub-name>-lead` matches a consultation target's `name:` (unlikely for sub-dept creation but defensive), skip and note in step 12's history-entry body.

7. **Capture future sub-dept-internal artifact types.** Identify what `data/` artifacts the sub-dept WILL eventually hold (these fill the `<<DATA_SCOPES>>` template token at step 8 — they're DOCUMENTED in the charter, NOT pre-scaffolded as directories):
   - For `legal/compliance`: regulatory filings, policy attestation records, incident reports.
   - For `rnd/data`: SQL queries, ETL specs, data-quality reports, schema migrations.
   - For `commercial/customer-success`: NPS surveys, churn analyses, onboarding playbooks.
   Capture from `subdept_description` + the step-6 consultations. Note any restricted-data needs (per Risk 1; surface as open question at step 9).

8. **Draft the charter.** First, **verify `shared/templates/SUBDEPT.md.tmpl` exists AND contains all 7 expected substitution tokens** (`<<PARENT_DEPT>>`, `<<SUB_NAME>>`, `<<SUB_TITLE>>`, `<<MISSION>>`, `<<LEAD_NAME>>`, `<<ESCALATION>>`, `<<DATA_SCOPES>>`). If missing or any token absent, ABORT with: "SUBDEPT.md.tmpl missing or modified — restore from `Koroqe/OPOS` upstream via `copier update`."

   Render the template:
   - `<<PARENT_DEPT>>` = the validated parent slug (e.g., `legal`). **Pure slug, no slash.**
   - `<<SUB_NAME>>` = the validated sub-name (e.g., `compliance`). **Pure slug, no slash.**
   - `<<SUB_TITLE>>` = title-case display of `<<SUB_NAME>>` (e.g., `compliance` → `Compliance`).
   - `<<MISSION>>` = 1-3 sentence mission synthesized from `subdept_description` + parent-lead + coo consultations. State explicitly what the sub-dept owns AND what stays with the parent.
   - `<<LEAD_NAME>>` = the sub-lead name from step 5 (default `<<SUB_NAME>>-lead`).
   - `<<ESCALATION>>` = `<<LEAD_NAME>> → <<PARENT_DEPT>>-lead → coo → ceo`. The parent-lead is the FIRST escalation stop — this is the KEY escalation-chain difference from top-level depts (which escalate `<dept>-lead → coo → ceo` directly).
   - `<<DATA_SCOPES>>` = bullet list of sub-dept-internal data types from step 7. Note whether `restricted: true` per Risk 1 (surface as open question at step 9; default not restricted).

   **Token-substitution semantics note:** unlike `design-department` which uses one `<<DEPT_NAME>>` token, this skill uses TWO separate tokens (`<<PARENT_DEPT>>` and `<<SUB_NAME>>`). Each is a pure slug (no `/` separator). The full hierarchical path `<parent>/<sub>` only appears in user-facing strings (step 9 chat output, step 12 history filename slug-encoding), never as a template substitution. This avoids the slug-regex divergence and lead-agent path-rendering bugs that a single `<<DEPT_NAME>> = <parent>/<sub>` token would produce.

9. **Present to the user.** Output the proposed charter contents as an inline code block in chat. Follow with a summary:

   - Which agents were consulted + 1-line summary of each consultation (including any skipped via self-consultation guard or no-clear-collaborator skip).
   - Placement rationale (sub-dept under `<parent>`; NOT a top-level peer; NOT a sub-role agent under `<parent>`).
   - Lead-agent decision from step 5 + the EXACT `/design-agent` invocation recommended at step 11 if applicable — e.g., `/design-agent "<<LEAD_NAME>> — owns end-to-end <function> under <<PARENT_DEPT>>, reports to <<PARENT_DEPT>>-lead"`.
   - **Charter target path** — `departments/<<PARENT_DEPT>>/<<SUB_NAME>>/CLAUDE.md.jinja` (framework context) OR `departments/<<PARENT_DEPT>>/<<SUB_NAME>>/CLAUDE.md` (consumer context). State which one and why (per the Path convention check).
   - Open questions. **Always surface as explicit open question:** should the sub-dept's `data/` content (when created later) be `restricted: true` per RISKS Risk 1? Some sub-depts (e.g., `legal/compliance`, `legal/litigation`, a future `rnd/security`) typically need it; most don't. Default: not restricted.

10. **Iterate.** The user proposes edits. Revise the proposal and re-present. Loop until the user gives an unambiguous approval phrase ("write it", "approve", "ship it", "ok do it"). Phrases like "I'd like to approve this but…" do NOT count — those are iteration requests.

11. **Write the files.** On unambiguous approval:

    - **Re-check all 5 collision conditions** from step 3 (slug regex, reserved-list, parent exists, sub-folder collision, sibling-agent collision) — TOCTOU close; single-machine only (cross-machine per Risk 15).
    - **Detect context** (per Path convention): `copier.yml` at repo root AND root `CLAUDE.md.jinja` present → framework context (write `.md.jinja`); otherwise consumer context (write `.md`).
    - **`mkdir -p departments/<<PARENT_DEPT>>/<<SUB_NAME>>/`** — create the sub-dept folder.
    - **Write the charter** to the context-detected path: `departments/<<PARENT_DEPT>>/<<SUB_NAME>>/CLAUDE.md.jinja` (framework) OR `departments/<<PARENT_DEPT>>/<<SUB_NAME>>/CLAUDE.md` (consumer). **This is the ONLY file the skill writes**; no `data/`, `backlog/`, `.claude/skills/` subdirs are auto-created (per the minimal-scaffolding convention).
    - **If `design_lead_agent` was `yes` in step 5:** first ensure `.claude/agents/<<PARENT_DEPT>>/` exists (`mkdir -p` if absent — parent agents folder may not exist yet for parents with no agents today). Then print the `/design-agent` recommendation prominently — e.g., `**Next step (recommended):** /design-agent "<<LEAD_NAME>> — <role description from step 5>"`. The user invokes it in the next turn; step 12 history captures the deferred agent creation.
    - **If a `backlog_item_path` was supplied:** edit it — flip `state:` from `active` to `designed`, add `designed_as: departments/<<PARENT_DEPT>>/<<SUB_NAME>>/`.

12. **Write design-subdept's own history entry.** Append to `.claude/skills/design-subdept/history/YYYY-MM-DD-<short-run-id>.md` per the root `CLAUDE.md` schema (including the optional `time: HH:MM` from v0.3.1). Convention: `<short-run-id>` = `subdept-<parent>-<sub>` (the conceptual `/` separator in the path is encoded as `-` for filename safety; e.g., `subdept-legal-compliance` for `legal/compliance`).

    - `actor: ops-manager`
    - `outcome: success` (charter written) OR `partial` (user did not approve)
    - `proposed_delta:` — note any tension surfaced during consultation, mismatches between consulted recommendations and the final proposal, or template/tooling friction. Use "none" only when the session was smooth.
    - `status: applied`
    - Body: parent-dept context (read at step 2; 1-line summary of parent mission), each consultation (parent-lead, coo, optional peer) + 1-line response, name validation result, lead-agent decision (designed-same-session-recommended vs deferred), path-convention decision (framework vs consumer), the charter file path written, and any TOCTOU/agents-dir-mkdir notes.

## Outputs

- New sub-dept charter at `departments/<parent>/<sub>/CLAUDE.md` OR `.md.jinja` (context-detected).
- **Recommendation** to run `/design-agent` in the next turn (if step 5's `design_lead_agent` was `yes`) — the skill does NOT auto-invoke.
- `mkdir -p .claude/agents/<parent>/` performed at step 11 if the design-agent recommendation case applies and the folder didn't exist.
- Updated backlog item (if input): `state: designed`, `designed_as: departments/<parent>/<sub>/`.
- One run entry in `.claude/skills/design-subdept/history/`.
- A one-line summary in chat.

## Failure modes

- **Conflicting sub-dept folder** — step 3 fail. Recovery: ask user for a different name.
- **Slug-regex fail** — step 3 fail. Recovery: print the regex `^[a-z][a-z0-9-]{0,63}$` + offer concrete suggestions (lowercase, replace spaces with `-`).
- **Framework-reserved name (shadows top-level)** — step 3 fail. Print the reserved-list rationale ("`finance` would shadow the top-level finance dept; pick a name that's unique within the framework").
- **Sibling-agent name collision** — step 3 fail. Print the colliding agent file path; offer to use a different sub-name OR rename the existing agent.
- **Parent dept missing** — step 3 fail. Recovery: use `/design-department` first.
- **Sub-sub-dept requested** — step 4 fail. See the recovery message above (promote-to-top-level OR use sub-role agent).
- **`SUBDEPT.md.tmpl` missing/modified** — step 8 fail. Recovery: `copier update` to restore.
- **Consultation timeout** — `consult-agent` returns no response. Recovery: skip + note in proposal AND in step 12's history-entry body; proceed.
- **User does not approve** — files NOT written. Step 12 still runs with `outcome: partial`.
- **TOCTOU collision** (step 3 → step 11) — single-machine: step 11 re-check catches it. Cross-machine: not addressed in v0.8.0 per Risk 15.

## Related

- Process definition: `./PROCESS.md`
- Run history: `./history/`
- Sibling skills (the design-* family, all owned by `ops-manager`):
  - [`design-process`](../design-process/) — new skills (v0.1.0)
  - [`design-agent`](../design-agent/) — new agents/roles (v0.4.0)
  - [`design-department`](../design-department/) — new top-level depts (v0.5.3)
  - **`design-subdept`** — new sub-depts (v0.8.0; this skill — the LAST org-chart-shape primitive)
- Used by: [`consult-agent`](../consult-agent/) — invoked in step 6 for each consultation.
- Template: [`shared/templates/SUBDEPT.md.tmpl`](../../../shared/templates/SUBDEPT.md.tmpl) — NEW in v0.8.0; forked from `DEPARTMENT.md.tmpl` with depth-3 relative paths + new `<<PARENT_DEPT>>` token.
- Owner agent: [`.claude/agents/company/ops-manager.md`](../../agents/company/ops-manager.md)
- Closes: RISKS.md Risk 8 fully-fully (third + final tier — v0.4.0 closed agents, v0.5.3 closed top-level depts, v0.8.0 closes sub-depts).

## Sub-role vs. sub-dept — which to use?

Two patterns exist in v0.8.0+ for sub-organization under an existing dept:

- **`/design-agent`** → creates a **sub-role agent** under the parent's agents folder. Use when the sub-organization is just a person/role (lives at `.claude/agents/<parent>/<role-name>.md`). Example: `eng-lead` under `rnd` (v0.5.1 precedent).
- **`/design-subdept`** → creates a **sub-dept folder** with its own charter, cascade-inherited scope, optional own backlog/data/skills. Use when the sub-organization is a unit-of-work with its own scope. Example: `compliance` under `legal`.

When in doubt, start with `/design-agent` (lighter weight). Promote to sub-dept later via `/design-subdept` if the sub-organization grows scope that warrants its own folder.
