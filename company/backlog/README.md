# Company backlog

This is the cross-cutting backlog: experiments and one-offs that span multiple departments or sit above the department layer entirely. Department-specific backlog items live under `departments/<dept>/backlog/`.

## Item structure

Every backlog item is a markdown file following [`shared/templates/BACKLOG-ITEM.md.tmpl`](../../shared/templates/BACKLOG-ITEM.md.tmpl). Filename: short kebab-case slug matching the title.

Required frontmatter:

- `title`
- `owner` — agent name responsible for running and (eventually) promoting this item
- `created` — YYYY-MM-DD
- `state` — `proposed` | `active` | `promoted` | `dropped`
- `runs` — integer counter, incremented after each successful run
- `promotion_target` — where the promoted skill will live

## Promotion to a process

Items become processes via the [`promote-backlog-item`](../../.claude/skills/promote-backlog-item/) skill. The default criteria: at least 3 runs with `outcome: success`, owner approval, no naming conflicts. See that skill's `PROCESS.md` for the exact rule and to tune the threshold for your fork.

## Labels

Use a `labels:` array in the frontmatter for filtering. Suggested company-level labels:

- `cross-functional` — touches more than one department
- `operational` — affects how the company runs internally
- `strategic` — supports a strategy item from `company/strategy/`
