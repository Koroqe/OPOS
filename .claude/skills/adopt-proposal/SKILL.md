---
name: adopt-proposal
description: Review a draft-mode design-process proposal bundle and, on human approval, move its SKILL.md + PROCESS.md into place — the single human decision that turns an overnight draft into a live process
version: 0.1.0
tags: [meta, framework, self-building]
owner_agent: ops-manager
tools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash"]
---

# adopt-proposal

## When to use

When a proposal bundle exists under some `*/backlog/proposals/<date>-<slug>/` (written by `design-process --draft`, typically overnight from a twice-run `process-gap` backlog item) and a human is ready to decide. Invoke as `/adopt-proposal <bundle-path>` or bare `/adopt-proposal` to list pending bundles. **Interactive only** — adoption IS the human gate; this skill refuses to run under the scheduled-run prelude.

## Steps

1. **List or resolve.** Bare invocation → glob `**/backlog/proposals/*/PROPOSAL.md`, print each cover sheet's one-line summary + age, stop. With a path → validate it is a bundle (PROPOSAL.md + SKILL.md + PROCESS.md present; path inside repo root).
2. **Present the cover sheet** (source item, consultations run/skipped, lessons applied, open questions) and the full SKILL.md + PROCESS.md diff-style. Surface loudly: any scheduling frontmatter (adoption does NOT register it — that is a separate `/schedule-process` human gate), any `tools:` beyond Read/Grep/Glob in referenced agents, any sensitive paths the process would touch.
3. **Decide** (Confirm tier — one decision, per the v0.12 definition-of-done): `adopt` / `adopt with edits` (apply the human's edits to the bundle first) / `reject` (bundle stays, source item → `state: rejected` + reason) / `defer` (nothing changes).
4. **On adopt:** `git mv` the SKILL.md + PROCESS.md into the bundle's declared `intended_placement:` (read from PROPOSAL.md's cover sheet — dept-scoped `departments/<dept>/.claude/skills/<name>/` or company-wide `.claude/skills/<name>/`; missing/invalid placement → treat as an open question, require the human to supply it before adopting); create `history/.gitkeep` (+ `scheduled-runs/.gitkeep` when scheduling fields are declared); run `ui.scheduling.validate_frontmatter` on the PROCESS.md (scheduling fields present → must return ok); update the owner agent's advisory `owns_processes:`; flip the source backlog item to `state: designed` + `designed_as: <path>`; delete the bundle folder; commit `feat(core): adopt <name> process from draft proposal`.
5. **History entry** for this run (adopted/rejected/deferred, bundle path, any edits).

## Failure modes

- **Scheduled/non-interactive invocation** — refuse (the whole point is the human).
- **Name collision** with an existing skill folder → present both, require rename or explicit overwrite decision.
- **Validator failure on a scheduling-declared PROCESS.md** → adoption proceeds only after the human fixes or strips the scheduling fields (a live-but-invalid declaration would fail registration later anyway).
- **Bundle references an agent that doesn't exist** → adopt still allowed; print the `/design-agent` recommendation (agent creation stays its own interactive flow — never-automate invariant 2).

## Related

- Producer: [`design-process`](../design-process/) draft mode
- The counting input: `BACKLOG-ITEM.md.tmpl` `kind: process-gap` items swept by [`review-history`](../review-history/)
- Registration (separate human gate): [`schedule-process`](../schedule-process/)
