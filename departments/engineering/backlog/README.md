# Engineering backlog

One-off engineering work that isn't yet a recurring process. Items live here as markdown files following [`shared/templates/BACKLOG-ITEM.md.tmpl`](../../../shared/templates/BACKLOG-ITEM.md.tmpl).

## Structure

Filename: short kebab-case slug matching the item title.

Required frontmatter:

- `title`
- `owner` — an engineering agent (`eng-lead` or `eng-reviewer`)
- `created` — YYYY-MM-DD
- `state` — `proposed` | `active` | `designed` | `dropped`
- `runs` — integer counter (informational; updated after each manual execution)
- `intended_target` — intended path for the skill that would be designed from this item (typically under `departments/engineering/.claude/skills/`)

Optional frontmatter (added retrospectively by `design-process`):

- `designed_as` — path to the new skill that was designed from this item

## From idea to process

When an item is ready to formalize, invoke the global skill [`design-process`](../../../.claude/skills/design-process/) — owned by `ops-manager` — and pass the item's path as `backlog_item_path`. `ops-manager` reads the framework, consults involved department leads (in this scope, `eng-lead`), drafts a SKILL.md + PROCESS.md pair, iterates with the user, and on approval writes the files. The source item's `state:` is flipped to `designed`.

## Dept labels

Suggested labels for the `labels:` array:

- `ops` — production operations
- `infra` — infrastructure / platform
- `release` — deploy and release process
- `quality` — testing, review process, code quality
- `tools` — engineering tooling, developer experience

## Example

See [`example-add-rollback-step.md`](./example-add-rollback-step.md) for a worked example of a backlog item in `state: active, runs: 0` — an idea waiting to be either manually executed a few times or fed directly to `design-process`.
