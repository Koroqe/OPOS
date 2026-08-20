---
name: design-agent
description: Design a new agent role file (.claude/agents/<dept>/<name>.md) by reading the framework, consulting relevant agents, and proposing the design to the human for approval
version: 0.1.0
tags: [meta, framework, agent-design]
owner_agent: ops-manager
---

# design-agent

## When to use

Invoke when a new agent role needs to exist. Two entry points:

1. **Fresh role description** — the user says "we need an agent for X" (e.g. "a release coordinator", "a marketing analyst").
2. **Formalize a backlog item** — the user points at a `BACKLOG-ITEM.md` whose `intended_target` is an agent.

Also invoked from `design-process` when a process design surfaces a need for an agent role that doesn't yet exist (see `design-process/SKILL.md` Failure modes).

The skill is INTERACTIVE: it produces a proposal, iterates with the user, and only writes the agent file on explicit user approval. The human is the approval gate.

## Inputs

- `role_description` — free-text description of the new agent's responsibilities + scope + decisions it should make + what it does NOT do. Required if no `backlog_item_path` is supplied.
- `backlog_item_path` — OPTIONAL. Path to a `BACKLOG-ITEM.md` whose `intended_target` is an agent. When supplied, the item's frontmatter seeds the proposal; the item is flipped to `state: designed` with a `designed_as: <new-agent-path>` field at the end.

## Registry pass (v0.13)

When drafting the `tools:` ladder AND the role's external-access needs: read `company/resources/REGISTRY.md`. Grants derive from DECLARED resources, never invention — a role needing an access no entry covers gets a "requires acquisition" line in the proposal (naming the `/acquire-resource` request to file) instead of a fabricated tool. If the role's core duty depends on a per-machine resource (`machines:` bound), say so in the proposal so the human knows where the agent can actually operate.

## Steps

0. **Lessons pass + provenance duty (v0.11, applies to every run).** Before designing: read the company's `kind: lesson` backlog items (glob `**/backlog/*.md`, filter frontmatter `kind: lesson`) whose `mistake_class`/`root_cause_target` matches this skill or the artifact class it produces, plus this skill's own `history/` entries with open `proposed_delta`s; apply every matching constraint to the draft and LIST the applied lessons in the proposal so the human sees the loop working. When writing the artifact: stamp provenance — frontmatter `derived_from: <template>@<framework-version>` + `designed_by: <this-skill>@<its version>` (framework version = `.copier-answers.yml` `_commit`; in the framework repo itself use the current release tag); charter files get the equivalent HTML comment stamp at file end.

1. **Understand the framework.** Read root `CLAUDE.md`, `shared/templates/AGENT.md.tmpl`, two reference agents to ground both placement conventions: a company-tier one (`.claude/agents/company/chief-of-staff.md`) AND a dept-tier one (`.claude/agents/rnd/eng-lead.md` — moved from `.claude/agents/engineering/` at v0.5.1 when engineering folded into the R&D umbrella). Read `company/knowledge-base/glossary.md` for vocabulary.

2. **Understand the role.** Parse `role_description` (and `backlog_item_path` if supplied). Identify: scope (single dept vs cross-dept), authority (what can this agent decide alone? what must it escalate?), interface (what artifacts does it produce/consume?), trigger (when does the user invoke it?).

3. **Identify target department + validate paths.** Parse `department` from the role description. If unambiguous (e.g. "marketing analyst" → marketing), use it. If unclear, ask the user. Validate two conditions, both must hold:
   - `departments/<dept>/CLAUDE.md` (or `.jinja` source) must exist UNLESS `department: company` (special-case scope sourced from `company/CLAUDE.md[.jinja]`).
   - `.claude/agents/<dept>/` directory must exist (this is the AGENT folder, distinct from the dept charter folder). If it doesn't but the charter folder does, create it via `mkdir -p .claude/agents/<dept>/` (idempotent; non-destructive).

   If the dept charter is missing (and not `company`), ABORT with: "department `<X>` does not exist. Create it manually first (or wait for the future `design-department` skill — out of scope for v0.4.0; see RISKS.md Risk 8 forward path)."

4. **Check for name collisions + slug-validate.** Glob ONLY `.claude/agents/**/*.md` and parse frontmatter `name:` across all files. Validate the proposed name against the slug regex `^[a-z][a-z0-9-]{1,62}$` (same pattern as `ui/validate.py:safe_slug`). Either condition fails → ABORT:
   - Name collision: print the colliding file path; ask user for a different name.
   - Slug-regex fail: print the regex; offer suggestions (lowercase the name, replace spaces with `-`, etc.).
   Do NOT overwrite. Do NOT silently coerce a bad name — surface to the user.

5. **Consult relevant agents via `consult-agent`.** Up to three consultations (each costs Opus tokens — adopt cost-aware mitigation per RISKS Risk 6: skip clearly-irrelevant consultations):
   - **Dept lead of the target department** — for dept-tier scopes, skip when the agent being designed IS the dept lead itself. For `department: company`, there is no single dept lead; use `chief-of-staff` as the cross-functional proxy unless the new agent IS chief-of-staff (then skip).
     > "We're designing a new agent in your scope: <role-description>. What gap should it fill relative to your existing team? What should it NOT do that you currently do? What inputs would you provide to it; what outputs would you expect back?"
   - **Proposed escalation-target agent** — for dept-tier: the dept lead (skip if same as above). For company-tier: `coo` for most agents, `ceo` for the topmost. **Skip entirely if the new agent IS the escalation-target candidate** (e.g., designing a new `coo` or `ceo` — top-of-tree agents have `escalates_to: none` per AGENT.md.tmpl convention).
     > "You'll be the escalation path for a new agent: <role-description>. What decisions should this agent NOT make on its own and instead bring to you?"
   - **One proposed delegation-target agent** (only if the role description specifies delegation; skip otherwise; skip if delegation target == new agent — see step 8 cycle check).
     > "You'll be receiving delegated work from a new agent: <role-description>. What input format do you need? What's your turnaround expectation?"

   **Self-consultation guard:** before each consultation, compare the target agent's `name:` against the proposed `name:` for the new agent. If equal, skip and note in the step-12 history-entry body.

6. **Decide placement.** Deterministic by department: `department == "company"` → `.claude/agents/company/<name>.md`. Otherwise → `.claude/agents/<dept>/<name>.md`.

7. **Decide tools allow-list.** Default to LEAST PRIVILEGE. Standard ladder:
   - **All agents:** `["Read", "Grep", "Glob"]` — read framework files.
   - **+ `Task`** if the agent delegates to other agents (cf. `chief-of-staff`, dept leads).
   - **+ `Edit`, `Write`** if the agent produces artifacts (proposals, docs, code).
   - **+ `Bash`** if the agent runs shell commands (`gh`, `git`, `npm`, etc.).
   - **+ `WebSearch`, `WebFetch`** if the agent does external research (cf. `rnd-lead`).
   - **+ `mcp__<server>__*`** if the agent uses an MCP server (cf. Risk 1 Hardening Path #1).
   - **EXCLUDE** any tool not justified by the role description. Document the rationale in step 9's proposal.

8. **Draft the design.** First, **verify `shared/templates/AGENT.md.tmpl` exists AND contains all 5 expected substitution tokens** (`<<AGENT_NAME>>`, `<<AGENT_DESCRIPTION>>`, `<<DEPARTMENT>>`, `<<DELEGATES_TO>>`, `<<ESCALATES_TO>>`). If missing or any token absent, ABORT with: "AGENT.md.tmpl missing or modified — restore from `Koroqe/OPOS` upstream via `copier update`."

   Then fill the template + the 6 body sections (Role, Delegation pattern, Inputs, Outputs, Escalation rules, Owned processes). The `owns_processes:` frontmatter starts as `[]` (the agent owns nothing yet; processes get added by later `design-process` runs when this agent is named as `owner_agent`).

   **Cycle check (delegation graph):** parse existing agents' `Calls:` lines (regex `^Calls:` then tokenize) to build the delegation graph. Add the proposed agent's delegation edges. If a cycle is detected (e.g. A → B → A; or A → A self-delegation), ABORT with: "delegation cycle detected: <node-path>. Agents should form a DAG. Revise the proposed Calls list."

9. **Present to the user.** Output the proposed agent file as an inline code block in chat. Follow with a summary:
   - Which agents were consulted (and which were SKIPPED with reason).
   - What each said (one sentence each).
   - Placement rationale.
   - **Tools rationale — justify EACH tool in the proposed list** (least-privilege check).
   - Open questions. **Always explicitly surface** as one open question: whether the agent's `model:` should be `opus` (default) or `sonnet`/`haiku` (cheaper but less capable). Default is `opus` per existing agents; for high-frequency narrow-scope agents `sonnet` may be appropriate.

10. **Iterate.** The user proposes edits. Revise the proposal and re-present. Loop until the user gives an unambiguous approval phrase ("write it," "approve," "ship it," "ok do it"). Phrases like "I'd like to approve this but…" do NOT count — those are still iteration requests.

11. **Write the file.** On unambiguous approval:
    - **Re-check name collision** (same glob as step 4) — closes the TOCTOU window for single-machine. Cross-machine concurrency is per Risk 15 (state files are per-machine; multi-machine setups risk races between this step and another concurrent design-agent run on a different machine — uncommon but possible).
    - **Re-check slug regex** (same pattern as step 4) — defensive.
    - Write `.claude/agents/<dept>/<name>.md`.
    - If a dept charter (`departments/<dept>/CLAUDE.md.jinja` for any of the 6 v0.5.1 starter depts: rnd, finance, people, legal, commercial, pr; `company/CLAUDE.md.jinja` for company-tier) has a "Members" section, append the new agent's name to it. Otherwise note the skip in the step-12 history-entry body (do NOT silently lose the signal — auditable).
    - If a `backlog_item_path` was supplied, edit it: flip `state:` from `active` to `designed`, add `designed_as: <new-agent-path>`.

12. **Write design-agent's own history entry.** Append to `.claude/skills/design-agent/history/YYYY-MM-DD-<short-run-id>.md` per the root `CLAUDE.md` schema (including the optional `time: HH:MM` from v0.3.1):
    - `actor: ops-manager`
    - `outcome: success` (file written) OR `partial` (user did not approve)
    - `proposed_delta:` — note any tension surfaced during consultation, mismatches between proposed and consulted recommendations, or template/tooling friction. Use "none" only when the session was smooth. Same convention as `design-process` step 11.
    - `status: applied`
    - Body: which agents consulted (and which were SKIPPED with reason — self-consultation, irrelevant scope, escalation-target identity), what each said, placement + tools rationale, whether step 11's Members-section update applied or was skipped, link to the new agent file.

## Outputs

- New agent file at `.claude/agents/<dept>/<name>.md`.
- Updated dept charter (if it has a "Members" section): new agent listed.
- Updated backlog item (if input): `state: designed`, `designed_as:` pointer.
- One run entry in `.claude/skills/design-agent/history/`.
- A one-line summary in chat.

## Failure modes

- **Conflicting agent name** — step 4 fail. Recovery: ask user for a different name; do NOT overwrite.
- **Slug-regex fail** — step 4 fail. Recovery: print the regex `^[a-z][a-z0-9-]{1,62}$` + offer concrete suggestions to the user. Do NOT auto-coerce.
- **Target department missing** — step 3 fail. Recovery: user must create the dept manually first (out of scope for design-agent; future `design-department` skill is the forward path — likely v0.5.0 or later).
- **AGENT.md.tmpl missing or modified** — step 8 fail. Recovery: `copier update` to restore upstream; or hand-fix the template against the upstream tokens.
- **Delegation cycle detected** — step 8 fail. Recovery: revise the proposed Calls list to break the cycle.
- **Consultation timeout** — `consult-agent` returns no response. Recovery: skip that consultation, note in proposal AND in step-12 history-entry body, proceed.
- **User does not approve** — file is NOT written. Step 12 still runs with `outcome: partial`.
- **TOCTOU collision** (step 4 → step 11) — single-machine: step 11 re-check catches it. Cross-machine: not addressed in v0.4.0 per Risk 15 (state files are per-machine). Document this in the proposal for users on multi-machine setups.

## Related

- Process definition: `./PROCESS.md`
- Run history: `./history/`
- Sibling skill: [`design-process`](../design-process/) — same owner, parallel design pattern for processes (closes the loop: design-process can now hand off to design-agent when a new role is needed)
- Used by: [`consult-agent`](../consult-agent/) — invoked in step 5 for each consultation
- Template: [`shared/templates/AGENT.md.tmpl`](../../../shared/templates/AGENT.md.tmpl)
- Owner agent: [`.claude/agents/company/ops-manager.md`](../../agents/company/ops-manager.md)
- Closes: RISKS.md Risk 8 ("design-process cannot create new agent roles")
