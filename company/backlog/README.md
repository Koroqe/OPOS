# Company backlog

This is the cross-cutting backlog: experiments and one-offs that span multiple departments or sit above the department layer entirely. Department-specific backlog items live under `departments/<dept>/backlog/`.

## Item structure

Every backlog item is a markdown file following [`shared/templates/BACKLOG-ITEM.md.tmpl`](../../shared/templates/BACKLOG-ITEM.md.tmpl). Filename: short kebab-case slug matching the title.

Required frontmatter:

- `title`
- `owner` — agent name responsible for running this item and (when ready) feeding it to `design-process`
- `created` — YYYY-MM-DD
- `state` — `proposed` | `active` | `designed` | `dropped`
- `runs` — integer counter, incremented after each manual execution (informational)
- `intended_target` — intended skill path if/when this item informs a process design

Optional frontmatter (added retrospectively by `design-process` when the item is used as an input):

- `designed_as` — path to the new skill that was designed from this item

## From idea to process

Backlog items don't auto-promote. When an item is ready to formalize as a recurring process, invoke the global skill [`design-process`](../../.claude/skills/design-process/) — owned by `ops-manager` — and pass the item path as `backlog_item_path`. `ops-manager` reads the framework, consults involved department leads, drafts a SKILL.md + PROCESS.md pair, iterates with the human user, and on approval writes the files. The source item's `state:` is flipped to `designed` and a `designed_as:` pointer is added.

Items can also be `dropped` if the work doesn't pan out — no formalization needed.

## Labels

Use a `labels:` array in the frontmatter for filtering. Suggested company-level labels:

- `cross-functional` — touches more than one department
- `operational` — affects how the company runs internally
- `strategic` — supports a strategy item from `company/strategy/`
