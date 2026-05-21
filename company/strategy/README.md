# Strategy

This folder holds restricted-by-convention company-strategic material.

## What lives here

- Annual operating plans
- Multi-quarter roadmap and OKRs at the company level
- M&A material, fundraising decks, board reports
- Compensation philosophy and band tables
- Anything else that would harm the company if surfaced into the wrong Claude Code session

## Convention vs. enforcement

`CLAUDE.md` in this folder declares `restricted: true` and lists an `audience:`. **This is a convention, not enforcement.** Markdown is plain text. Any agent in any session can technically read these files. The skeleton honors the restriction through agent behavior (agents whose `name:` is not in the audience refuse to read these files) and human PR review.

## Hardening paths (NOT implemented in v0)

If real enforcement is needed:

1. **MCP filesystem server with path allow-lists.** Wire `company/strategy/` behind an MCP server (e.g. a custom `strategy-fs` server). Grant access only to the three audience agents via their frontmatter `tools:` allow-list (`tools: ["Read", "mcp__strategy-fs__*"]`). Remove direct filesystem access via the standard `Read`/`Grep` tools by scoping the agent's `tools:` field to omit them in the strategy context.
2. **Separate private repo.** Move `company/strategy/` into a sibling repo that is privately permissioned at the git/GitHub level. Reference it by absolute path or via an MCP `git` server. Loses CLAUDE.md cascade but gains real ACLs.

Both options are deferred to a follow-up.
