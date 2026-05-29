# R&D backlog (research + engineering)

One-off R&D work that isn't yet a recurring process. **As of v0.5.1**, R&D is the umbrella covering both research/landscape work AND engineering execution (engineering was merged in as the building branch). Backlog items in BOTH flavors live here.

Items live as markdown files following [`shared/templates/BACKLOG-ITEM.md.tmpl`](../../../shared/templates/BACKLOG-ITEM.md.tmpl).

## Structure

Filename: short kebab-case slug matching the item title.

Required frontmatter:

- `title`
- `owner` — an R&D agent: `rnd-lead` for research/landscape items; `eng-lead` or `eng-reviewer` for engineering items.
- `created` — YYYY-MM-DD
- `state` — `proposed` | `active` | `designed` | `dropped`
- `runs` — integer counter (informational; updated after each manual execution)
- `intended_target` — intended path for the skill that would be designed from this item (typically under `departments/rnd/.claude/skills/<name>/`)

Optional frontmatter (added retrospectively by `design-process`):

- `designed_as` — path to the new skill that was designed from this item

## From idea to process

When a recurring R&D method emerges from one-off work (research-flavored or engineering-flavored), invoke the global skill [`design-process`](../../../.claude/skills/design-process/) — owned by `ops-manager` — and pass the item's path as `backlog_item_path`. `ops-manager` consults the relevant lead (`rnd-lead` for research; `eng-lead`/`eng-reviewer` for engineering), drafts a SKILL.md + PROCESS.md pair, iterates with the user, and on approval writes the files. The source item's `state:` is flipped to `designed`.

## Dept labels

Suggested labels for the `labels:` array, organized by flavor:

**Research / landscape work** (`rnd-lead` owns):
- `landscape` — competitive or technology landscape scans
- `survey` — structured framework / product surveys
- `prior-art` — focused deep-dives on a specific tool or pattern
- `methodology` — research method itself (e.g. how to structure a survey)

**Engineering execution** (`eng-lead` / `eng-reviewer` own; merged in from `departments/engineering/backlog/` at v0.5.1):
- `ops` — deploy / runbook / on-call work
- `infra` — infrastructure changes, dependency upgrades
- `release` — release-process tooling
- `quality` — review checklists, code standards
- `tools` — internal tooling

## Example items

- [`example-add-rollback-step.md`](example-add-rollback-step.md) — engineering-flavored example moved from `departments/engineering/backlog/` at v0.5.1. Shows the standard structure.
