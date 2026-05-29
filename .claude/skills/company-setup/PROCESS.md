---
process_name: company-setup
owner: coo
collaborators: [ceo, chief-of-staff]
inputs: []
success_criteria: [fresh_scaffold_verified, git_repo_verified, mission_written, values_written, priorities_written, dept_decisions_applied, policies_seeded, smoke_greppable_passed, history_entry_written]
slo: "interactive — 10-20 minutes per session including user typing"
version: 0.1.0
# state_schema (commented per PROCESS.md.tmpl convention — documentation-only,
# no v0 runtime consumer):
#   - verifying: fresh-scaffold + git-repo + Mission-placeholder checks (step 1)
#   - asking: 8 conversational prompts gathering mission/values/priorities/dept-decisions/policies (steps 2-8)
#   - writing: Edit/Write operations to CLAUDE.md, priorities.md, dept charters, policies (interleaved within steps 3-8)
#   - validating: greppable-smoke recipe runs (step 9)
#   - committing: history entry written; founder is reminded to git-commit (step 10)
---

# company-setup

## Narrative

The first-run founder-onboarding procedure. Closes the 6 founder-blank gaps that a fresh `copier copy gh:Koroqe/OPOS` arrives with: root Mission, root Values, `company/strategy/`, `company/policies/`, two dept missions. Conversational (not button-driven via AskUserQuestion — the founder's content is free-text).

Owned by `coo` because operational setup of a new instance is the cleanest example of coo's "process health" responsibility. `ceo` is a collaborator (validates strategic content via consult-agent if needed). `chief-of-staff` is a collaborator (task-tracks the bootstrap if the founder wants it formalized as an issue).

## Pre-conditions

- Fresh `copier copy gh:Koroqe/OPOS` produced this repo.
- `git init && git add -A && git commit` has been run (the skill checks for `.git/`).
- Root `CLAUDE.md` still contains the placeholder Mission line with the literal token `<one short sentence>`.
- `shared/templates/POLICY.md.tmpl` exists with all 7 substitution tokens.

## Steps

Mirrors the 10-step procedure in SKILL.md:

1. Verify fresh scaffold + git-initialized.
2. Greet + explain flow.
3. Mission (1 question → Edit CLAUDE.md Mission line).
4. Values (1 question, 3-5 lines → Edit CLAUDE.md Values placeholders, remove excess).
5. Strategic priorities (1 question, 1-5 lines → Write company/strategy/priorities.md).
6. Engineering dept decision (keep/customize).
7. R&D dept decision (keep/customize).
8. Initial policies (0-3, with slug-regex + existing-file + framework-reserved-exact-match validation).
9. Greppable smoke check (token/owner-binding/git-status).
10. Write history entry.

## Done when

- `fresh_scaffold_verified` — step 1 placeholder check passed.
- `git_repo_verified` — step 1 `.git/` existence confirmed.
- `mission_written` — root CLAUDE.md Mission line replaced.
- `values_written` — root CLAUDE.md Values placeholders replaced (with dangling lines removed if count < 5).
- `priorities_written` — `company/strategy/priorities.md` created.
- `dept_decisions_applied` — engineering + R&D charters either kept or customized; no removals.
- `policies_seeded` — 0-3 files written under `company/policies/<slug>.md`; comment header stripped from each.
- `smoke_greppable_passed` — token-substitution check returned 0 matches; owner-binding check listed every PROCESS.md.
- `history_entry_written` — file exists under `./history/`.

## Rollback

Each step writes a single file (or set of files for step 8). To undo:
- Mission/Values: restore from `git checkout HEAD -- CLAUDE.md` (founder committed the initial scaffold per pre-conditions).
- Strategic priorities: `rm company/strategy/priorities.md`.
- Policy files: `rm company/policies/<slug>.md`.
- Dept-charter Mission edits: `git checkout HEAD -- departments/<dept>/CLAUDE.md`.

If the founder Ctrl-Cs mid-session, partial state persists; the next invocation REFUSES (step 1 sees Mission already written). To re-run from scratch, the founder must manually restore the `<one short sentence>` placeholder in root CLAUDE.md.

## History

Every invocation writes an entry (this is a meaningful, one-shot bootstrap event). Body captures every founder answer, every file written/modified, every policy-name conflict refusal with the offending name + the check that fired, and every dept decision (keep/customize). The `proposed_delta:` field is where UX warts get logged for v0.5.x patches — first-real-founder runs are the highest-signal source.
