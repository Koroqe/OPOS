# RISKS.md — known limitations of the v0 skeleton

Honest documentation of the v0 skeleton's unsolved areas. Each risk has a status, an impact, and either a mitigation or workaround. Adopters should read this before depending on the skeleton for sensitive work.

## Risk 1 — Restricted-data enforcement is convention-only

**Status:** HIGH impact for real adopters; ACCEPTABLE for v0 skeleton.

Markdown is not access-controlled. The `restricted: true` frontmatter on `company/strategy/CLAUDE.md` (and any other CLAUDE.md that adds it) is a convention agents are asked to honor in their system prompts. There is no technical mechanism in v0 preventing any agent in any session from reading these files.

**Mitigations in v0:**

- Agent system prompts instruct agents not in `audience:` to refuse to read restricted folders.
- Human PR review catches strategy content that leaks into the wrong scope.

**Hardening paths (NOT implemented):**

1. **MCP filesystem server with path allow-lists.** Wire `company/strategy/` behind a custom MCP filesystem server. Grant access only to the three audience agents via their frontmatter `tools:` allow-list (e.g. `tools: ["Read", "mcp__strategy-fs__*"]`). Remove direct filesystem access via `Read`/`Grep` by omitting them from the agent's `tools:` field when working in the strategy context.
2. **Separate private repo.** Move `company/strategy/` into a sibling repo that is privately permissioned at the git/GitHub level. Reference it by absolute path or via an MCP `git` server. Loses CLAUDE.md cascade but gains real ACLs.

## Risk 2 — JSON config files carry no inline commentary

**Status:** LOW impact; documented convention.

`.mcp.json` and `.claude/settings.json` are strict JSON. The skeleton ships with no `_comment` keys in either file, and no sibling `.README.md` files alongside them. Reason: two conflicting comment conventions in one repo is worse than no convention; and some MCP loaders reject unknown root keys.

**Mitigation:**

Adopters who want explanatory notes alongside config should put them in:

- Root `CLAUDE.md` (in the "Config files" subsection), or
- `README.md` (in the per-primitive table).

**NOT inline as `_comment` keys.**

## Risk 3 — Dept-nested `.claude/settings.json` is unsupported

**Status:** LOW impact; workaround available.

Claude Code only loads `.claude/settings.json` from the project root and from `~/.claude/settings.json`. There is no per-department settings file. All permission policy is repo-root only.

**Workaround:**

Per-agent tool restrictions are the available mechanism. Each agent's `tools:` frontmatter limits what it can call:

```yaml
---
name: eng-reviewer
tools: ["Read", "Grep", "Glob", "Bash"]
---
```

Agents whose `tools:` omits `Edit` and `Write` cannot mutate files; agents whose `tools:` omits `mcp__sales__*` cannot reach the sales MCP server. This is finer-grained than settings.json would be but requires updating each agent's frontmatter rather than a single dept-level file.

## Risk 4 — Template tokens are not enforced

**Status:** LOW impact; greppable guard available.

Adopters can forget to substitute `<<COMPANY_NAME>>` and the other tokens. The skeleton ships with tokens present everywhere they belong, which is correct for a template — but a fork that's been partially customized may have inconsistencies.

**Suggested guard (not auto-installed):**

Add a pre-commit hook running:

```bash
! grep -rn "<<[A-Z_]*>>" . --include="*.md"
```

After full substitution, this command should exit 0 (zero matches). Any match is the substitute-me signal.

## Risk 5 — Agent → process binding is mirrored in two places

**Status:** LOW impact; single greppable source of truth.

Each process has its owner declared in two places: the agent's `owns_processes:` frontmatter (advisory) and the PROCESS.md's `owner:` frontmatter (binding-of-record). These can drift if the agent is renamed but PROCESS.md isn't updated, or vice versa.

**Mitigation:**

The binding-of-record is always the PROCESS.md `owner:` field — discoverable in one grep:

```bash
grep -rn "^owner:" .
```

When renaming an agent, update every PROCESS.md `owner:` for processes that agent owns, then update the agent's own file's `name:`, then update any advisory `owns_processes:` references in other agent files. The PROCESS.md change is the only mandatory one.

## Risk 6 — Backlog `runs: 3` threshold is arbitrary

**Status:** LOW impact; adopter-tunable.

The default "promote after 3 successful runs" threshold is a v0 default chosen for simplicity, not derived from any empirical data. Some processes warrant more rigor before promotion (deploys, customer-facing changes); some can promote after a single run if the work is mechanical and well-understood.

**Mitigation:**

Adopters tune the threshold in their fork's [`.claude/skills/promote-backlog-item/PROCESS.md`](.claude/skills/promote-backlog-item/PROCESS.md). The threshold appears in both the `SKILL.md` body and the `PROCESS.md` pre-conditions — update both. The change itself is a backlog item worth recording in `company/backlog/`.

## Verification recipe (smoke test)

Run this after substituting tokens for your company. All six steps should pass cleanly on a freshly-cloned, fully-substituted skeleton.

1. **Cascade check.** From repo root, open `claude`. Ask: *"What CLAUDE.md files are in scope?"* Confirm the root constitution is loaded.
2. **Subagent discovery.** Ask: *"List available subagents."* Expect at least 5: `ceo`, `coo`, `chief-of-staff`, `eng-lead`, `eng-reviewer`. More if you've added agents.
3. **Global skills discovery.** Ask: *"List available skills."* Expect at least `promote-backlog-item`.
4. **Dept-nested cascade.** Run `cd departments/engineering && claude`. Ask: *"What CLAUDE.md files are in scope?"* Expect root + dept charter. Then ask: *"List skills available here."* Expect both `promote-backlog-item` (global) AND `deploy` (dept-nested).
5. **Token substitution check.** From repo root:
   ```bash
   grep -rn "<<[A-Z_]*>>" . --include="*.md"
   ```
   Non-zero matches on initial clone is the substitute-me signal. After full substitution: should return zero.
6. **Owner binding-of-record check.** From repo root:
   ```bash
   find . -name "PROCESS.md" -exec grep -l "^owner:" {} \;
   ```
   Should list every `PROCESS.md` in the repo, confirming the owner-binding-of-record convention is honored everywhere.
