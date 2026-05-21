---
date: 2026-05-22
run_id: test-task-tracking
skill: design-process
actor: ops-manager
outcome: success
duration_min: 90
proposed_delta: |
  Four candidate deltas surfaced during this exercise:

  - **eng-lead is not a runnable subagent_type.** Claude Code's Task tool registers a fixed set of subagent types; the project-level `.claude/agents/engineering/eng-lead.md` is read-only context, not invokable by name. This session simulated the consultation by spawning `general-purpose` and framing it as eng-lead reading its own agent definition file. Future improvement: a `consult-agent` skill that wraps this pattern, OR a Claude Code feature that lets project-level agents be invoked by name via Task.

  - **Trigger mechanism should be explicit in design-process step 7.** The user's framing ("when I initiate any task") implied a hook-driven trigger, but the user chose manual invocation when asked. design-process step 7 (Present to user) should explicitly enumerate trigger-mechanism options as part of the proposal, not infer them silently from the job description.

  - **Step 11 (write own history entry) is hard to action while still in plan mode.** The entry is necessarily written in a separate slice post-approval. This is fine in practice but should be called out in the SKILL.md body so future ops-managers don't try to write the entry too early.

  - **A single design session can produce multiple sibling skills.** Several design-process step outlines reference "the skill" (singular), but this session legitimately produced THREE sibling skills (task-register, task-update, task-complete). SKILL.md should acknowledge this case so the placement decision (step 5) and the file-write step (step 9) both handle the multi-skill bundle scenario.
status: applied
---

# design-process run — test-task-tracking

## Summary

The first real exercise of the `design-process` skill, invoked by the user with the framing "design one core process — when I initiate any new task (not a fix/correction to an existing plan), file it as a GitHub issue, update during execution, post a final report on completion." After clarifying questions, this single session produced THREE sibling skills (`task-register`, `task-update`, `task-complete`) owned by `chief-of-staff`, with supporting shared infrastructure (config, two templates, agent and README updates).

## What shipped

- `.claude/skills/task-register/` (SKILL.md + PROCESS.md + history/.gitkeep)
- `.claude/skills/task-update/` (SKILL.md + PROCESS.md + history/.gitkeep)
- `.claude/skills/task-complete/` (SKILL.md + PROCESS.md + history/.gitkeep)
- `shared/templates/task-issue.md.tmpl`
- `shared/templates/task-update.md.tmpl`
- `.claude/task-tracking.config.json` (defaults `repo: "Koroqe/OPOS"`)
- `.claude/agents/company/chief-of-staff.md` — updated (`tools` now includes `Bash`; `owns_processes` now lists the three new skills; body updated to mention task-lifecycle ownership)
- `README.md` — updated (two new templates added to the Templates list; new "The task-tracking loop" section)

## Departments consulted

- **engineering** — consulted via the Task tool (simulated; see proposed_delta #1). `eng-lead` recommended: `gh` CLI via Bash over MCP/REST; JSON config separate from `settings.json`; file-based templates in `shared/templates/`; comment + status-line patch with HTML-marker idempotency keys; both agent summary AND `git log` changelog at completion; `dept:` colon-prefix labels with lowercase normalization, auto-created with warning; convention-only commit linking via `Refs: #N` trailer with warning (not enforcement) at completion. Surfaced five concerns the user's framing missed (state-across-sessions, "new task" vs "fix" ambiguity, multi-repo handling, privacy, stale-state cleanup) — all addressed in the design.

- **company** — represented by `chief-of-staff` itself (the owner of the three new skills). No separate consultation needed since `chief-of-staff` is the destination of the ownership transfer, not an upstream consumer.

## Placement decision

Global `.claude/skills/` (not dept-scoped). The skills are owned by a company-level agent (`chief-of-staff`) and are used by every department's workflow, so a global path is correct.

## Approval gate

Approved by the human user via ExitPlanMode in the same plan-mode session that produced this design. The plan file at `/Users/aleksei/.claude/plans/company-os-framework-jaunty-sonnet.md` served as the proposal artifact.

## Proposed deltas to design-process

(See the `proposed_delta:` field in the frontmatter for the full four-item list.)

## Notes

- The `Refs: #<issue>` trailer convention introduced by this design will NOT be retroactively applied to the slice commits produced in this session. The Slice 6 live test (the first invocation of `task-complete`) is expected to emit the documented warning that commits lacked the ref. This is acceptable for the bootstrap case.
