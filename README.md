# OPOS — Company OS Framework

OPOS is an AI-native company operating system expressed as a GitHub repo of markdown and JSON. It encodes your company (mission, policies, knowledge), your departments (charters, data, processes), your roles (agents), and your work-in-flight (backlogs) using Claude Code's native cascading primitives. No runtime, no orchestration code — just templates and folder conventions you fork and adapt.

## Quickstart

1. Clone this repo (or fork it).
2. Substitute the framework tokens for your company. List every remaining token with:
   ```bash
   grep -rn "<<[A-Z_]*>>" . --include="*.md"
   ```
   The primary token is `<<COMPANY_NAME>>`. Once substituted, this command should return zero matches.
3. Pick one department to start with. The `departments/engineering/` folder is a worked example — copy it to your first real department and rename.
4. Add real MCP servers in `.mcp.json` and configure per-agent access via each agent's `tools:` allow-list.
5. Open Claude Code at the repo root and verify the smoke test (see [`RISKS.md`](RISKS.md) for the recipe).

## The cascade model

Claude Code automatically walks the directory tree from your session's working directory upward, loading every `CLAUDE.md` it finds. A session opened in `departments/engineering/` sees:

```
departments/engineering/
        ↑ (closer files load last, highest priority)
departments/engineering/CLAUDE.md   ← dept charter
        ↑
company/CLAUDE.md                   ← if cascade passes through it
        ↑
CLAUDE.md                           ← root constitution
```

Skills (`.claude/skills/<name>/`) nest similarly. Subagents (`.claude/agents/**/*.md`) are scanned recursively from the repo root.

## Where things live

| Primitive | Nests by folder? | Location | Notes |
|-----------|------------------|----------|-------|
| `CLAUDE.md` | YES — auto-cascades up the directory tree | any folder | Use for constitution + dept charters |
| Skills (`.claude/skills/<name>/SKILL.md`) | YES — nested `.claude/skills/` work | repo root or any dept folder | Each dept can host its own skills |
| Subagents (`.claude/agents/**/*.md`) | YES — recursive scan; subdir is purely organizational; identity = `name` frontmatter | `.claude/agents/<dept>/<role>.md` | Subfolders for visual grouping |
| Slash commands | Merged into skills per docs; prefer skills | n/a | `.claude/commands/X.md` and `.claude/skills/X/SKILL.md` are equivalent |
| Settings (`.claude/settings.json`) | NO — project root only | `.claude/settings.json` | Per-dept settings are not supported |
| MCP (`.mcp.json`) | Root-only | repo root | Per-agent access via `tools:` allow-list |

## Templates

Every artifact in the repo is a copy-with-substitution of one of these:

- [`shared/templates/CLAUDE.md.tmpl`](shared/templates/CLAUDE.md.tmpl) — scope-level constitution / charter
- [`shared/templates/AGENT.md.tmpl`](shared/templates/AGENT.md.tmpl) — role definition with delegation pattern
- [`shared/templates/SKILL.md.tmpl`](shared/templates/SKILL.md.tmpl) — runnable form of a process
- [`shared/templates/PROCESS.md.tmpl`](shared/templates/PROCESS.md.tmpl) — process-as-data (owner, inputs, success criteria)
- [`shared/templates/BACKLOG-ITEM.md.tmpl`](shared/templates/BACKLOG-ITEM.md.tmpl) — one-off task with runs log

Each template's header lists its substitution tokens. The convention is **copy-then-substitute**, not symlink or runtime reference — templates are scaffolding, the copies are the artifacts.

## The promotion loop

The framework's self-improvement primitive is itself a skill: [`promote-backlog-item`](.claude/skills/promote-backlog-item/).

1. New work starts as a `BACKLOG-ITEM.md` in a `backlog/` folder (company-level or dept-level), `state: proposed` or `state: active`.
2. After each manual run, the owner appends a row to the item's runs log.
3. Once the item reaches the threshold (default 3 successful runs) and the owner approves, they invoke `promote-backlog-item`.
4. The skill drafts a new `SKILL.md` + `PROCESS.md` pair at the item's `promotion_target` path, seeds the `history/` folder with the promotion event, and flips the source item's `state:` to `promoted`.

Walk through the included example: [`departments/engineering/backlog/example-add-rollback-step.md`](departments/engineering/backlog/example-add-rollback-step.md) is in `state: active, runs: 0` — the starting state of the loop, before any runs have occurred.

## Self-improvement log schema

Every process records each run in its own `history/` folder. Files are named `YYYY-MM-DD-<run-id>.md` with frontmatter:

- `date`: YYYY-MM-DD
- `run_id`: short id unique within the skill
- `skill`: skill name
- `actor`: agent name or "human"
- `outcome`: `success` | `partial` | `failure`
- `duration_min`: integer
- `proposed_delta`: free text describing a proposed SKILL.md/PROCESS.md change, or "none"
- `status`: `open` | `applied` | `rejected`

Owner agents review their history folders periodically and convert `open` deltas into updates to their own PROCESS.md (which itself can be promoted into a `history/` entry of its own — the loop closes).

## Conventions

- **Agent → process binding** lives in `PROCESS.md` `owner:` (single source of truth). Agent `owns_processes:` is advisory — keep it in sync but trust the PROCESS.md.
- **JSON config files** carry no inline comments. `.mcp.json` and `.claude/settings.json` are strict JSON; commentary about them lives in root `CLAUDE.md` and this README.
- **Restricted folders** (e.g. `company/strategy/`) are honored by convention only. See [`RISKS.md`](RISKS.md) for hardening paths.

## Known limitations

- Restricted-data enforcement is convention-only — see [`RISKS.md`](RISKS.md) Risk 1.
- Per-department `.claude/settings.json` is not supported by Claude Code — see [`RISKS.md`](RISKS.md) Risk 3.

## Verification

The smoke-test recipe (run after substituting tokens for your company) lives in [`RISKS.md`](RISKS.md) under "Verification recipe."

## Subscopes

- [`company/`](company/) — strategy, policies, knowledge-base, cross-cutting backlog
- [`departments/`](departments/) — one folder per department; ship with `engineering/` as a worked example
- [`shared/`](shared/) — templates and cross-company resources
- [`.claude/`](.claude/) — agents (by dept subfolder), global skills, settings
