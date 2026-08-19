# Glossary

Framework-level terms used throughout this repository. Adopters extend this with company-specific vocabulary.

**Process**: A repeatable task with a documented owner, inputs, steps, and success criteria. Lives as a skill (`.claude/skills/<process-name>/`) paired with a `PROCESS.md` definition and a `history/` folder of run records.

**Skill**: A Claude Code skill — the runnable form of a process. Stored at `.claude/skills/<name>/SKILL.md`. Skills are how agents invoke processes; they nest by folder and inherit cascade visibility from their location.

**Agent**: A role definition stored at `.claude/agents/<dept>/<role>.md`. Has a single responsibility, an allowed tool set, and a delegation pattern. Agents own zero or more processes; the binding-of-record is the `owner:` field in each `PROCESS.md`.

**Backlog item**: A one-off task or idea documented in a `backlog/` folder. Items track `runs` and `state`; they may inform a future `design-process` invocation if the owner decides to formalize the work as a recurring process.

**Process design**: The act of defining a new process from scratch. Performed by `ops-manager` via the `.claude/skills/design-process/` skill, in conversation with a human user. The skill consults involved department leads, drafts a `SKILL.md` + `PROCESS.md` pair, and writes the files on explicit user approval.

**Department**: A scope under `departments/<name>/` with its own `CLAUDE.md` charter, agents (in `.claude/agents/<dept>/`), nested skills (`.claude/skills/`), backlog, and data.

**Scope (CLAUDE.md)**: A folder whose CLAUDE.md scopes instructions to that subtree. Claude Code automatically cascades CLAUDE.md files from the session's working directory up to the repo root, with closer files taking priority.

**Upstream**: The OPOS framework template repository this instance was scaffolded from (`_src_path` in `.copier-answers.yml`). Releases flow downstream from it via `copier update`; anonymized fix proposals flow back up to it via `propose-to-core`.

**Consumer**: A company instance scaffolded from the upstream template (also "adopter"). Owns its STARTER files and runtime state; receives CORE updates on sync.

**CORE**: A framework file synced from upstream on every `copier update` — the default for anything not in `copier.yml`'s `_skip_if_exists` or `_exclude`. Never edit CORE files locally (edits conflict on the next sync); propose fixes upstream via `propose-to-core` instead. Note: root/company/department `CLAUDE.md` files are consumer-owned but have upstream `.jinja` templates — improvements to the *template* are still upstreamable.

**STARTER**: A file shipped once at initial scaffold and never overwritten by updates (`_skip_if_exists`) — consumer-owned; edit freely. Fixes to STARTER files are applied locally by `review-history`, never sent upstream.

**Delta**: A `proposed_delta` recorded in a run's history/scheduled-run entry — the atomic unit of self-improvement. Optionally carries `delta_target` (the file it concerns) and, once proposed upstream, `upstream_pr`. Lifecycle: `open` → (`applied` | `rejected`), driven by the weekly `review-history` triage.

**Redaction review**: The fail-closed gate every upstream proposal passes before leaving the machine: a deterministic blocklist/secret pre-gate, then an adversarial `redaction-reviewer` agent pass that must return the literal `REDACTION: PASS`. Any finding or uncertainty blocks the send and produces a local draft for human review instead.
