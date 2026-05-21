---
name: design-process
description: Design a new process (SKILL.md + PROCESS.md) by reading the OS, consulting involved departments, and proposing the design to the human for approval
version: 0.1.0
tags: [meta, framework, process-design]
owner_agent: ops-manager
---

# design-process

## When to use

Invoke when a new repeatable job needs to be formalized as a process. Two entry points:

1. **Fresh job description** — the user says "we need a process for X." No prior backlog item.
2. **Formalize a backlog item** — the user points at a `BACKLOG-ITEM.md` and says "design a process from this."

The skill is INTERACTIVE: it produces proposals, iterates with the user, and only writes files on explicit user approval. The human user is the approval gate; there is no draft staging or formal review queue.

## Inputs

- `job_description` — free-text description of the work to be formalized. Required if no `backlog_item_path` is supplied.
- `backlog_item_path` — optional path to a `BACKLOG-ITEM.md` to use as additional input. When supplied, the item's frontmatter (`title`, `owner`, `intended_target`, labels) seeds the design; the item itself is converted to `state: designed` and gains a `designed_as: <new-skill-path>` field at the end.

## Steps

1. **Understand the framework.** Read root `CLAUDE.md`, `shared/templates/SKILL.md.tmpl`, `shared/templates/PROCESS.md.tmpl`, and one existing skill (`departments/engineering/.claude/skills/deploy/`) as a reference example. Read `company/knowledge-base/glossary.md` for vocabulary.

2. **Understand the job.** Read `job_description` (and `backlog_item_path` if supplied). Identify: domain, repeatability rationale, frequency estimate, criticality, who consumes the output.

3. **Identify involved departments.** Enumerate `departments/*/CLAUDE.md` via filesystem glob. Read each charter; identify which departments the job touches based on their stated mission and scope. Default to ALL departments whose charters mention the job's domain. If only one department exists in the repo (the v0 skeleton ships with just `engineering`), this loop has one entry — that's expected, not a failure.

4. **Consult involved dept leads.** For each involved department, spawn the dept lead (e.g. `eng-lead`) as a subagent via the `Task` tool. Question template:

   > "We're designing a new process for [job description]. What is your department's role in this work? What inputs does your team need from upstream? What outputs do you produce? What are your success criteria for this kind of work? What failure modes have you seen for similar work?"

   Capture each response and record which dept lead said what — both go into the proposal summary.

5. **Decide placement.** If one department is the clear primary owner, place the new skill at `departments/<dept>/.claude/skills/<name>/`. Otherwise (multi-dept or company-level scope), place it at `.claude/skills/<name>/`. The PROCESS.md `owner:` is the primary department's lead (or `coo` for company-level processes).

6. **Draft the design.** Fill in the SKILL.md and PROCESS.md templates with:
   - `name` — derived from the job; kebab-case; unique within the chosen scope.
   - `description` — one line summarizing what the skill does.
   - `owner_agent` (SKILL.md) / `owner` (PROCESS.md) — the primary dept lead's name. These two fields MUST match.
   - `collaborators` — every other dept lead consulted, in the order they appeared in step 4.
   - `inputs` — merged input list from all dept consultations.
   - `success_criteria` — merged from dept consultations; deduplicate semantically.
   - `slo` — primary dept lead's stated estimate (or "TBD" if unclear).
   - Body sections (When to use, Steps, Outputs, Failure modes) — synthesized from the consultations.

7. **Present to the user.** Output the proposed SKILL.md and PROCESS.md as inline code blocks in chat. Follow with a summary paragraph: which departments were consulted, what each said (one sentence each), why the placement was chosen, and a bulleted list of open questions or trade-offs the user should review.

8. **Iterate.** The user proposes edits. Revise the proposal and re-present. Loop until the user gives an unambiguous approval phrase ("write it," "approve," "ship it," "ok do it"). Phrases like "I'd like to approve this but…" do NOT count — those are still iteration requests.

9. **Write the files.** On unambiguous approval:
   - Create the skill folder at the chosen path.
   - Write `SKILL.md` and `PROCESS.md` to it.
   - Create `history/.gitkeep` (empty).
   - Do NOT seed a history entry for the new skill — the new skill has not yet been RUN, so it has no run history (the root `CLAUDE.md` rule applies to runs, not creations). Git history is the audit trail for the creation event itself.

10. **Update advisory backlinks.**
    - If the new process's owner agent has an `owns_processes:` list, append the new process name. Edit `.claude/agents/<dept>/<owner>.md`.
    - If a `backlog_item_path` was supplied, edit the backlog item: flip `state:` from `active` to `designed`, and add a frontmatter line `designed_as: <new-skill-path>` (this field is added retrospectively — it is not in the default template). The item's `runs` log stays intact for audit.

11. **Write a run entry to design-process's OWN history.** Append a new file under `.claude/skills/design-process/history/YYYY-MM-DD-<short-run-id>.md` per the root `CLAUDE.md` schema:

    - `actor: ops-manager`
    - `outcome: success` (files written) OR `outcome: partial` (user did not approve; no files written)
    - `proposed_delta:` — note any tension surfaced during consultation that future iterations might address; "none" if smooth.
    - `status: applied` (the design session itself is complete in either case)

    Body: which depts were consulted, what was decided, where the new skill landed, and which backlog item (if any) was tied off.

## Outputs

- New skill folder at the chosen path with `SKILL.md`, `PROCESS.md`, and an empty `history/.gitkeep`.
- Updated owner-agent file with the new process name in `owns_processes:` (advisory).
- Updated backlog item (if one was an input): `state: designed`, plus `designed_as:` pointer.
- One run entry in `.claude/skills/design-process/history/`.
- A one-line summary in chat.

## Failure modes

- **Conflicting skill name** — a folder already exists at the target path. Recovery: ask the user for a different name; if they don't have one, suggest a variant based on the dept name + verb. Do not overwrite.
- **No primary owner identifiable** — consultation surfaces equal primary ownership across multiple departments. Recovery: escalate to `coo` via the `Task` tool with the consultation transcript; `coo` arbitrates.
- **New agent role required** — the design needs an agent role that doesn't exist. Recovery: escalate to `coo` — the ops-manager cannot create agents; expanding the org chart is its own design problem (potentially a future `design-agent` skill).
- **Department charter missing or malformed** — `departments/<dept>/CLAUDE.md` is absent or has no readable mission/scope. Recovery: report the gap to the user in step 3's output; no consultation possible for that department; offer to proceed with the others.
- **User does not approve** — files are NOT written. Step 11 still runs (a `partial` history entry is recorded so the session is auditable).

## Related

- Process definition: `./PROCESS.md`
- Run history: `./history/`
- Owner agent: `.claude/agents/company/ops-manager.md`
