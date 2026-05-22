# R&D — <<COMPANY_NAME>>

The research and analytics department: scans the external landscape, evaluates competing/adjacent frameworks, and brings back patterns and recommendations that inform <<COMPANY_NAME>>'s direction.

## Inherits from

`../../CLAUDE.md` (root constitution). When a Claude Code session opens here, the cascade also pulls in `../../company/CLAUDE.md` if present in the directory chain.

## Mission

Reduce uncertainty about external state. R&D produces written, citable artifacts that other departments can act on — competitive landscapes, technology surveys, framework comparisons, prior-art reviews. R&D does NOT make product decisions (those belong to `coo` / `ceo`); R&D makes evidence available.

## Roles

- `rnd-lead` — owns research execution. Defined at [`.claude/agents/rnd/rnd-lead.md`](../../.claude/agents/rnd/rnd-lead.md).

## Escalation

`rnd-lead` → `coo` → `ceo`. Escalates when a research finding has strategic implications worth surfacing immediately (e.g. a competitor shipped something that materially changes our positioning).

## Data scopes

- `data/` — dept-internal: research outputs (catalogs, surveys, prior-art reviews), raw notes, source archives. Citable.
- Cross-dept references live under `company/knowledge-base/`.

## Processes-as-skills convention

Dept processes live as skills in `.claude/skills/<process-name>/` (nested inside this dept folder). **There is no separate `processes/` folder** — same convention as `departments/engineering/`.

## Pointers

- Dept skills: [`.claude/skills/`](./.claude/skills/) (empty in v0 — the first research process will be designed via `design-process` when one emerges)
- Dept backlog: [`backlog/`](./backlog/)
- Dept data: [`data/`](./data/)
