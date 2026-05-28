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

4. **Consult involved dept leads via `consult-agent`.** For each involved department, invoke `consult-agent --agent <dept-lead> --question "<consultation>"`. Question template:

   > "We're designing a new process for [job description]. What is your department's role in this work? What inputs does your team need from upstream? What outputs do you produce? What are your success criteria for this kind of work? What failure modes have you seen for similar work?"

   `consult-agent` handles the Task-tool subagent spawn, the agent-definition + charter loading, and the simulated-response capture. Record each dept lead's response and attribute it explicitly — both go into the proposal summary at step 7. (Pre-v0.2.0 sessions used a hand-crafted Task invocation here; `consult-agent` replaces the boilerplate.)

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

7. **Present to the user.** Output the proposed SKILL.md and PROCESS.md as inline code blocks in chat. Follow with a summary paragraph: which departments were consulted, what each said (one sentence each), why the placement was chosen, and a bulleted list of open questions or trade-offs the user should review. **Always explicitly enumerate the trigger-mechanism options as one of the open questions** — even if the job description seems to imply one. The three options to surface:
   - **Manual slash-command** (default): user explicitly invokes `/skill-name` when they want it to run. Predictable but relies on user remembering.
   - **Hook-driven**: Claude Code hook (e.g. UserPromptSubmit) auto-invokes on matching patterns. Truest to "every time X happens" framings, but requires `.claude/settings.json` editing.
   - **Hybrid**: ship as manual by default; document the hook recipe as an opt-in upgrade.

   Other open-question candidates: owner agent if unclear, multi-skill split if the job is unusually broad, retention policy for the new skill's `history/` if high-volume.

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

    **Timing:** this entry is written AFTER user approval — when the design session is truly complete (files written or user rejected). It is NOT written during the proposal phase (step 7) or during iteration (step 8). If a session ends without approval, write the entry with `outcome: partial` recording the design context for future reference; the design session is still "complete" in the sense that further work would start over.

## Outputs

- New skill folder at the chosen path with `SKILL.md`, `PROCESS.md`, and an empty `history/.gitkeep`.
- Updated owner-agent file with the new process name in `owns_processes:` (advisory).
- Updated backlog item (if one was an input): `state: designed`, plus `designed_as:` pointer.
- One run entry in `.claude/skills/design-process/history/`.
- A one-line summary in chat.

## Failure modes

- **Conflicting skill name** — a folder already exists at the target path. Recovery: ask the user for a different name; if they don't have one, suggest a variant based on the dept name + verb. Do not overwrite.
- **No primary owner identifiable** — consultation surfaces equal primary ownership across multiple departments. Recovery: escalate to `coo` via the `Task` tool with the consultation transcript; `coo` arbitrates.
- **New agent role required** — the design needs an agent role that doesn't exist. Recovery (v0.4.0+): invoke [`design-agent`](../design-agent/) (also owned by ops-manager) to create the missing role inline. Once the agent file exists with the proposed `name:`, resume `design-process` from step 6 with the new owner now available. **Escalate to `coo` only if the user explicitly rejects the agent design** (fallback path; preserved from pre-v0.4.0 behavior). **A new department charter is a separate matter** (e.g. the new role doesn't fit in any existing `departments/<dept>/`) — department creation is still out of scope for both `design-process` AND `design-agent`; escalate to `coo` for that case until a future `design-department` skill closes it.
- **Department charter missing or malformed** — `departments/<dept>/CLAUDE.md` is absent or has no readable mission/scope. Recovery: report the gap to the user in step 3's output; no consultation possible for that department; offer to proceed with the others.
- **User does not approve** — files are NOT written. Step 11 still runs (a `partial` history entry is recorded so the session is auditable).

## Multi-skill design sessions

One invocation of `design-process` can legitimately produce MULTIPLE sibling skills in a single session. The skill design isn't constrained to "one job → one skill" — when the user's framing implies a natural decomposition (e.g. a task-lifecycle that splits into register / update / complete), the consultation in step 4 surfaces it and step 5 + step 6 handle the bundle.

Worked example: the task-tracking design session (recorded in `./history/2026-05-22-test-task-tracking.md`) produced three sibling skills (`task-register`, `task-update`, `task-complete`) under a single owner (`chief-of-staff`), with shared templates and config. The placement decision (step 5) treats the bundle as a unit; the file-write step (step 9) iterates over all skills in the bundle on a single approval.

Indicators that a bundle is appropriate:
- The job has distinct phases that happen at different times (open, mid-execution, close).
- The phases share state (a config file, a `.current-task` marker, a templates folder).
- The owner agent is the same across all phases.

If a bundle is NOT appropriate (one job → one skill is cleaner), the session produces a single skill. The user's review at step 7 should make the bundle-or-single call obvious; if unclear, surface it as an explicit open question.

## Related

- Process definition: `./PROCESS.md`
- Run history: `./history/`
- Owner agent: `.claude/agents/company/ops-manager.md`
