# Glossary

Framework-level terms used throughout this repository. Adopters extend this with company-specific vocabulary.

**Process**: A repeatable task with a documented owner, inputs, steps, and success criteria. Lives as a skill (`.claude/skills/<process-name>/`) paired with a `PROCESS.md` definition and a `history/` folder of run records.

**Skill**: A Claude Code skill — the runnable form of a process. Stored at `.claude/skills/<name>/SKILL.md`. Skills are how agents invoke processes; they nest by folder and inherit cascade visibility from their location.

**Agent**: A role definition stored at `.claude/agents/<dept>/<role>.md`. Has a single responsibility, an allowed tool set, and a delegation pattern. Agents own zero or more processes; the binding-of-record is the `owner:` field in each `PROCESS.md`.

**Backlog item**: A one-off task documented in a `backlog/` folder. Items track `runs` and `state`; items that reach the promotion threshold (default: 3 successful runs) become processes via the `promote-backlog-item` skill.

**Promotion**: The act of converting a successful backlog item into a recurring process. Defined and executed by `.claude/skills/promote-backlog-item/`. Promotion creates a new `<skill>/SKILL.md` + `PROCESS.md` pair and flips the source backlog item's `state:` to `promoted`.

**Department**: A scope under `departments/<name>/` with its own `CLAUDE.md` charter, agents (in `.claude/agents/<dept>/`), nested skills (`.claude/skills/`), backlog, and data.

**Scope (CLAUDE.md)**: A folder whose CLAUDE.md scopes instructions to that subtree. Claude Code automatically cascades CLAUDE.md files from the session's working directory up to the repo root, with closer files taking priority.
