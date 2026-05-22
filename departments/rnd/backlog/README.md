# R&D backlog

One-off research and analytics work that isn't yet a recurring process. Items live here as markdown files following [`shared/templates/BACKLOG-ITEM.md.tmpl`](../../../shared/templates/BACKLOG-ITEM.md.tmpl).

## Structure

Filename: short kebab-case slug matching the item title.

Required frontmatter:

- `title`
- `owner` — an R&D agent (`rnd-lead`)
- `created` — YYYY-MM-DD
- `state` — `proposed` | `active` | `designed` | `dropped`
- `runs` — integer counter (informational)
- `intended_target` — intended path for the skill that would be designed from this item (typically under `departments/rnd/.claude/skills/`)

Optional frontmatter (added retrospectively by `design-process`):

- `designed_as` — path to the new skill that was designed from this item

## From idea to process

When a recurring research method emerges from one-off work, invoke the global skill [`design-process`](../../../.claude/skills/design-process/) — owned by `ops-manager` — to formalize it. `ops-manager` consults `rnd-lead` and (when relevant) other dept leads, drafts a SKILL.md + PROCESS.md pair, and writes them on approval.

## Dept labels

Suggested labels for the `labels:` array:

- `landscape` — competitive or technology landscape scans
- `survey` — structured framework/product surveys
- `prior-art` — focused deep-dives
- `methodology` — research method itself (e.g. how to structure a survey)
