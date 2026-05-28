---
process_name: design-process
owner: ops-manager
collaborators: [coo]
inputs: [job_description, backlog_item_path]
success_criteria: [skill_folder_exists, process_md_has_owner, files_written_only_on_user_approval, advisory_backlinks_updated, design_process_run_recorded_in_own_history]
slo: "1 working session (interactive)"
version: 0.1.0
state_schema:
  - discovering: framework + job + departments read (SKILL.md steps 1-3)
  - consulting: dept leads queried via consult-agent (step 4)
  - drafting: SKILL.md + PROCESS.md filled from templates (steps 5-6)
  - presenting: proposal surfaced to user with summary + open questions (step 7)
  - iterating: revising based on user feedback until explicit approval (step 8)
  - committing: files written, advisory backlinks updated, own-history entry recorded (steps 9-11)
---

# design-process

## Narrative

The framework's process-design primitive. Given a new repeatable-job description (or a backlog item ready to formalize), `ops-manager` reads the framework, consults the involved department leads, drafts a SKILL.md + PROCESS.md pair, iterates with the human user, and on explicit approval writes the files to their final location.

Designs are interactive and approved in-session. Git history is the audit trail for creation events; `design-process`'s own `history/` folder is the audit trail for design sessions themselves (one entry per invocation, success or partial).

## Pre-conditions

- A human user is present (the design loop requires conversational approval).
- The framework files are intact: root `CLAUDE.md`, both relevant templates (`shared/templates/SKILL.md.tmpl`, `shared/templates/PROCESS.md.tmpl`), the glossary, and at least one department charter (`departments/<dept>/CLAUDE.md`).
- If `backlog_item_path` is supplied: the file exists and parses as a valid `BACKLOG-ITEM.md`.

## Steps

The skill's SKILL.md body documents the full 11-step flow. Summary here:

1. Read the framework (templates, glossary, an existing skill as reference).
2. Understand the job (domain, repeatability, frequency, criticality).
3. Identify involved departments by enumerating `departments/*/CLAUDE.md`.
4. Consult each involved dept lead via the `Task` tool with a focused question.
5. Decide placement (global vs dept-scoped) based on primary ownership.
6. Draft the SKILL.md + PROCESS.md filling in template tokens.
7. Present the proposal in chat with a summary of consultations and open questions.
8. Iterate with the user until explicit approval.
9. Write files to the final location on approval. Do NOT seed the new skill's history.
10. Update advisory backlinks: owner agent's `owns_processes:` and (if applicable) the backlog item's `state` + new `designed_as:` field.
11. Write a run entry to `./history/` recording this design session.

## Done when

- `skill_folder_exists` — the new skill folder is present at the chosen path with SKILL.md, PROCESS.md, and history/.gitkeep.
- `process_md_has_owner` — the new PROCESS.md frontmatter has a non-empty `owner:` field matching a `name:` declared in some `.claude/agents/**/*.md`.
- `files_written_only_on_user_approval` — files were created ONLY after an unambiguous approval phrase from the user. Iteration requests are not approval.
- `advisory_backlinks_updated` — the owner agent's `owns_processes:` includes the new process; if a backlog item was input, its `state:` is `designed` and `designed_as:` points at the new skill.
- `design_process_run_recorded_in_own_history` — a new file exists under `./history/` for this invocation, with schema-conformant frontmatter.

All five criteria must hold for a `success` run. If the user did NOT approve, criteria 1, 2, 4 cannot be satisfied — the run is recorded as `partial` instead.

## State transitions

Strict forward order: `discovering → consulting → drafting → presenting → iterating → committing`, with `iterating ↔ presenting` allowed to loop until the user gives explicit approval. A session can terminate at `presenting` (user rejects outright) or `iterating` (user abandons mid-revision); both cases write a `partial` outcome to history with the session's last completed state recorded. The terminal `committing` state is the only one that writes the new skill's SKILL.md + PROCESS.md to disk — everything before is in-memory proposal work.

## Rollback

If files were written and the user wants to revert: `git revert` the commit, or manually delete the new skill folder and revert the agent/backlog updates. Because nothing is written without explicit user approval, mid-session rollback should be rare.

If a `partial` history entry was written for a non-approved session, no rollback is needed — the partial entry is the correct audit record and stays.

## History

Run records live in `./history/` — one file per design session, named `YYYY-MM-DD-<short-run-id>.md`. The first entry will be the first real invocation of `design-process`, not the creation of the skill itself (the skill was bootstrapped manually as part of the framework build-out, not via a self-application).
