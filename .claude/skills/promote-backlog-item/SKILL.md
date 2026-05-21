---
name: promote-backlog-item
description: Promote a successful backlog item into a recurring process (SKILL.md + PROCESS.md)
version: 0.1.0
tags: [meta, framework, self-improvement]
owner_agent: coo
---

# promote-backlog-item

## When to use

Invoke this skill when a backlog item — anywhere in the repo (`company/backlog/`, `departments/<dept>/backlog/`) — has reached the promotion threshold: at least 3 manual runs with `outcome: success` recorded in its runs log, and the item's `owner` agent agrees the work is stable enough to formalize.

This is the framework's self-improvement primitive. It is itself a skill operating on its own input data (backlog items), so the loop is closed: backlog → process → history → proposed deltas → updated process.

## Inputs

- `backlog_item_path` — path to the `BACKLOG-ITEM.md` to promote.
- `target_scope` — `global` (skill placed in `.claude/skills/<name>/`) or `dept:<dept-name>` (skill placed in `departments/<dept>/.claude/skills/<name>/`). When omitted, infer from the item's `promotion_target` field.

## Steps

1. Read the backlog item. Verify `runs` is at least 3, and every row in the runs log has `outcome: success`. If not, fail with "insufficient runs" or "non-success runs in log".
2. Verify the item's `owner` agent exists (matches a `name:` in some `.claude/agents/**/*.md`). If not, fail with "missing owner".
3. Confirm the target skill name is unique within the target scope. If a skill folder already exists at that path, fail with "conflicting skill name".
4. Copy `shared/templates/SKILL.md.tmpl` to `<promotion_target>/SKILL.md` and substitute `<<SKILL_NAME>>`, `<<SKILL_DESCRIPTION>>`, `<<OWNER_AGENT>>` (from the item's `owner:`), and `<<TAGS>>` (from the item's labels if present).
5. Copy `shared/templates/PROCESS.md.tmpl` to `<promotion_target>/PROCESS.md` and substitute `<<PROCESS_NAME>>`, `<<OWNER_AGENT>>` (BINDING OF RECORD — must match the agent's `name:`), `<<COLLABORATORS>>`, `<<SLO>>`.
6. Create `<promotion_target>/history/` and write the first entry `YYYY-MM-DD-promotion.md` recording the promotion event (`actor: coo`, `outcome: success`, `proposed_delta: none`, `status: applied`).
7. Edit the backlog item: flip `state:` from `active` to `promoted`. Do not modify its `runs` log.
8. The owner agent's `owns_processes:` frontmatter SHOULD be updated to include the new process name. This is advisory (the binding-of-record is the PROCESS.md `owner:` field), but keeping it in sync aids discoverability.

## Outputs

- New skill folder at the target path containing `SKILL.md`, `PROCESS.md`, and `history/<date>-promotion.md`.
- Updated backlog item with `state: promoted`.
- Updated owner-agent file with the new process in `owns_processes:` (advisory).

## Failure modes

- **Insufficient runs** — `runs` is fewer than 3, or runs log has any row with `outcome: failure` or `partial`. Recovery: complete more successful runs first.
- **Missing owner** — the item's `owner:` does not correspond to any `name:` in `.claude/agents/`. Recovery: assign a valid owner first.
- **Conflicting skill name** — a folder already exists at the target path. Recovery: rename in the `promotion_target` field, or merge with the existing skill manually.

## Related

- Process definition: `./PROCESS.md`
- Run history: `./history/`
