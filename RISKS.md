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
<%raw%>! grep -rn "<<[A-Z_]*>>" . --include="*.md"<%endraw%>
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

## Risk 6 — Consultation cost

**Status:** LOW impact; cost-aware mitigation in v0.

`design-process` spawns each involved department lead as a subagent via the `Task` tool. Each subagent invocation uses Opus tokens. A design session that touches three departments will run three subagent consultations, plus the main `ops-manager` thread.

**Mitigation:**

The skill's step 3 ("Identify involved departments") consults only departments the job clearly touches based on their charters — not every department in the repo. Adopters with many departments should keep dept `CLAUDE.md` charters tight so the relevance check stays accurate.

## Risk 7 — No formal review before file-write

**Status:** MEDIUM impact; human-as-gate mitigation.

`design-process` writes files on the user's in-session approval. There is no peer-review queue, no architecture-review board, no second pair of eyes other than the user. If the user approves a flawed design, the flawed design ships.

**Mitigation:**

- `ops-manager` is instructed (in `.claude/agents/company/ops-manager.md`) to surface trade-offs and open questions explicitly in every proposal — the user sees what they're signing off on.
- Git revert is the recovery path: every design session lands as a single commit, easy to back out.
- Adopters who want a formal review queue can fork `design-process` to write to a `proposals/` staging folder first.

## Risk 8 — `design-process` cannot create new agent roles

**Status:** LOW impact; documented escalation.

If a designed process needs an agent role that doesn't exist (e.g. a "release-coordinator" with no matching `name:` in `.claude/agents/`), `design-process` escalates to `coo` and stops. The skill does not create new agents.

**Forward path:**

Creating agents is its own design problem and could be addressed by a future `design-agent` skill. For v0, expanding the org chart is a conversation between the user, `coo`, and (where applicable) `ceo`.

## Risk 9 — Copier conflict resolution is manual

**Status:** MEDIUM impact; behavior is expected.

When a consumer has edited a CORE file (one synced from upstream), `copier update` produces a `.rej` file recording the upstream change that couldn't apply cleanly. The consumer must resolve manually: open the original file, apply the upstream change, delete the `.rej` file.

**Mitigation:**

- Never edit CORE files. Anything you'd want to customize lives in STARTER files (with `_skip_if_exists` in `copier.yml`) — those are never overwritten on update.
- If a CORE file's behavior genuinely needs customization, fork it INTO a sibling skill/agent (with a different name) and reference your fork instead.
- The `sync-from-core` skill surfaces the `.rej` count prominently after every update so you can't miss conflicts.

## Risk 10 — Private upstream + GitHub Actions requires a PAT

**Status:** LOW impact; documented setup step.

If you keep the upstream OPOS repo PRIVATE and want the opt-in `.github/workflows/sync-opos.yml` to run, the default `GITHUB_TOKEN` doesn't have access to the upstream. You need a `GH_PAT_OPOS_READ` secret (a PAT with read access to the upstream repo) added to your consumer repo's Actions secrets.

**Mitigation:** Reference the secret in the workflow's `copier update` step via `env: GH_TOKEN: ${{ secrets.GH_PAT_OPOS_READ }}`. If the upstream is PUBLIC, this is unnecessary.

## Risk 11 — Third-party Actions may be policy-blocked

**Status:** LOW impact; alternate path documented.

The opt-in workflow uses `peter-evans/create-pull-request@v6` for PR creation. Many GitHub organizations block third-party actions by default. If your org has this policy:

- Replace the PR-creation step with a script using `gh pr create` directly (see https://cli.github.com/manual/gh_pr_create).
- Or get the third-party action allowlisted by your org admins.

## Risk 12 — No automated rollback

**Status:** MEDIUM impact; manual procedure documented.

If you sync to a new upstream version and want to roll back, there is no `rollback-from-core` skill in v0. The manual procedure:

1. Edit `.copier-answers.yml` and change the `_commit:` field to the older tag (e.g. `v0.1.0`).
2. Re-run `sync-from-core --target_version v0.1.0`.
3. Resolve any `.rej` files (rollbacks behave the same as forward updates — only the direction differs).

A future `rollback-from-core` skill could automate this.

## Risk 13 — Breaking changes in 0.x releases require manual migration

**Status:** MEDIUM impact; mitigated by CHANGELOG convention.

Per semver, 0.x releases may contain breaking changes. When upgrading across a breaking-change release, you'll see `.rej` files indicating lost edits — these need manual resolution. Convention: every breaking-change release MUST include a `### Migration` subsection in its CHANGELOG entry describing the required manual steps.

**Mitigation:**

- Read the CHANGELOG before running `sync-from-core` to a new version.
- Test the sync on a branch (which is how `sync-from-core` works by default) before merging to main.
- Once v1.0 is cut, breaking changes are restricted to major-version bumps per semver.

## Advisory note — upstream naming

The upstream repository is `Koroqe/OPOS` (not renamed to something like `opos-template` or `opos-core`). Naming mirrors the consumer's experience: they scaffold from `Koroqe/OPOS` and receive updates from the same upstream. No renaming planned.

## Verification recipe (smoke test)

Run this after substituting tokens for your company. All six steps should pass cleanly on a freshly-cloned, fully-substituted skeleton.

1. **Cascade check.** From repo root, open `claude`. Ask: *"What CLAUDE.md files are in scope?"* Confirm the root constitution is loaded.
2. **Subagent discovery.** Ask: *"List available subagents."* Expect at least 6: `ceo`, `coo`, `chief-of-staff`, `ops-manager`, `eng-lead`, `eng-reviewer`. More if you've added agents.
3. **Global skills discovery.** Ask: *"List available skills."* Expect at least `design-process`.
4. **Dept-nested cascade.** Run `cd departments/engineering && claude`. Ask: *"What CLAUDE.md files are in scope?"* Expect root + dept charter. Then ask: *"List skills available here."* Expect both `design-process` (global) AND `deploy` (dept-nested).
5. **Token substitution check.** From repo root:
   ```bash
   <%raw%>grep -rn "<<[A-Z_]*>>" . --include="*.md"<%endraw%>
   ```
   Non-zero matches on initial clone is the substitute-me signal. After full substitution: should return zero.
6. **Owner binding-of-record check.** From repo root:
   ```bash
   find . -name "PROCESS.md" -exec grep -l "^owner:" {} \;
   ```
   Should list every `PROCESS.md` in the repo, confirming the owner-binding-of-record convention is honored everywhere.
