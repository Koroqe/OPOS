---
process_name: promote-backlog-item
owner: coo
collaborators: [chief-of-staff]
inputs: [backlog_item_path, target_scope]
success_criteria: [skill_folder_exists, process_md_has_owner, history_seeded, backlog_item_state==promoted]
slo: "1 working day"
version: 0.1.0
---

# promote-backlog-item

## Narrative

The framework's self-improvement primitive. Converts a successful backlog item into a formalized process by drafting a SKILL.md + PROCESS.md pair, seeding the history folder, and updating the source item's state. Owned by `coo`.

## Pre-conditions

- The backlog item has been executed manually at least 3 times.
- Every row in the item's runs log has `outcome: success`.
- The item's `owner:` matches a `name:` declared somewhere in `.claude/agents/`.
- No skill folder already exists at the target `promotion_target` path.

## Steps

1. **Read and validate the backlog item** — `coo` reads the item from `backlog_item_path`, asserts `runs >= 3` and all rows successful.
2. **Verify owner agent exists** — grep `.claude/agents/` for a `name:` matching the item's `owner:`.
3. **Verify no name conflict** — assert the target skill folder does not yet exist.
4. **Draft SKILL.md** — copy `shared/templates/SKILL.md.tmpl` to `<promotion_target>/SKILL.md`, substituting `<<SKILL_NAME>>`, `<<SKILL_DESCRIPTION>>`, `<<OWNER_AGENT>>`, `<<TAGS>>`.
5. **Draft PROCESS.md** — copy `shared/templates/PROCESS.md.tmpl` to `<promotion_target>/PROCESS.md`, substituting `<<PROCESS_NAME>>`, `<<OWNER_AGENT>>` (this is the binding-of-record), `<<COLLABORATORS>>`, `<<SLO>>`.
6. **Seed history** — create `<promotion_target>/history/` and write the first entry recording the promotion event.
7. **Update the backlog item** — flip `state:` to `promoted`. Keep the `runs` log intact for audit.
8. **Update owner agent (advisory)** — append the new process name to the owner agent's `owns_processes:` frontmatter list.

## Done when

- `skill_folder_exists` — `<promotion_target>/` contains both SKILL.md and PROCESS.md.
- `process_md_has_owner` — the new PROCESS.md's `owner:` field is populated and matches a declared agent.
- `history_seeded` — `<promotion_target>/history/<date>-promotion.md` exists with the schema-conformant entry.
- `backlog_item_state==promoted` — the source `BACKLOG-ITEM.md`'s `state:` field is now `promoted`.

## Rollback

If promotion fails midway:

1. Delete the partial `<promotion_target>/` folder.
2. Revert the backlog item's `state:` field to its prior value (`active`).
3. Revert any change to the owner agent's `owns_processes:` field.
4. Write a `history/` entry recording the failed attempt (`outcome: failure`, `proposed_delta`: what blocked, `status: applied`).

## History

Run records live in `./history/` — one file per run, named `YYYY-MM-DD-<run-id>.md`. The first entry in any newly-promoted skill's history MUST be the promotion event itself.
