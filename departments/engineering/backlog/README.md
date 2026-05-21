# Engineering backlog

One-off engineering work that isn't yet a recurring process. Items live here as markdown files following [`shared/templates/BACKLOG-ITEM.md.tmpl`](../../../shared/templates/BACKLOG-ITEM.md.tmpl).

## Structure

Filename: short kebab-case slug matching the item title.

Required frontmatter:

- `title`
- `owner` — an engineering agent (`eng-lead` or `eng-reviewer`)
- `created` — YYYY-MM-DD
- `state` — `proposed` | `active` | `promoted` | `dropped`
- `runs` — integer counter
- `promotion_target` — intended path for the promoted skill (typically under `departments/engineering/.claude/skills/`)

## Promotion path

After 3+ successful runs, invoke the global skill [`promote-backlog-item`](../../../.claude/skills/promote-backlog-item/) — owned by `coo` — to convert this item into a recurring process. The skill drafts the new SKILL.md + PROCESS.md, seeds the history folder, and flips the source item's `state:` to `promoted`.

## Dept labels

Suggested labels for the `labels:` array:

- `ops` — production operations
- `infra` — infrastructure / platform
- `release` — deploy and release process
- `quality` — testing, review process, code quality
- `tools` — engineering tooling, developer experience

## Example

See [`example-add-rollback-step.md`](./example-add-rollback-step.md) for a worked example of a backlog item in `state: active, runs: 0` — i.e. the starting state of the promotion loop.
