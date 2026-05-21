# Engineering — <<COMPANY_NAME>>

The engineering department: builds and operates <<COMPANY_NAME>>'s software systems.

## Inherits from

`../../CLAUDE.md` (root constitution). When a Claude Code session opens here, the cascade also pulls in `../../company/CLAUDE.md` if present in the directory chain — this note documents the intent for human readers.

## Mission

Ship reliable software. Keep production healthy. Improve the system every week. Engineering does NOT set company strategy — that lives in `company/strategy/` and is owned by `ceo` + `coo`.

## Roles

- `eng-lead` — owns engineering execution, deploys, and technical decisions. Defined at [`.claude/agents/engineering/eng-lead.md`](../../.claude/agents/engineering/eng-lead.md).
- `eng-reviewer` — reviews PRs against engineering standards. Defined at [`.claude/agents/engineering/eng-reviewer.md`](../../.claude/agents/engineering/eng-reviewer.md).

## Escalation

`eng-lead` → `coo` → `ceo`. Anything below the eng-lead's authority (a single deploy decision, a code-review verdict) does not escalate.

## Data scopes

- `data/` — dept-internal: runbooks, postmortems, ADRs. Loaded into dept-scoped sessions only.
- Cross-department references live under `company/knowledge-base/`.

## Processes-as-skills convention

Dept processes live as skills in `.claude/skills/<process-name>/` (nested inside this dept folder). **There is no separate `processes/` folder** — Claude Code's nested-skills support gives us the discovery we need, and a `processes/` folder that only points elsewhere creates dual-location confusion.

## Pointers

- Dept skills: [`.claude/skills/`](./.claude/skills/)
- Dept backlog: [`backlog/`](./backlog/)
- Dept data: [`data/`](./data/)
