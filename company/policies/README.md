# Policies

Source of truth for company-wide policy. Readable by all agents.

## How to add a policy

1. Create a new file `<short-slug>.md` in this folder.
2. Frontmatter: `title`, `owner` (agent name), `effective_date` (YYYY-MM-DD), `version`.
3. Body: scope, rule, examples, exceptions, review cadence.
4. Open a PR with the file. The CEO or COO reviews and merges; merge is the act of adoption.
5. Subsequent revisions bump `version` and add a "Change log" section at the bottom.

## Example placeholder

A starter policy file (`example-no-secrets-in-repo.md`) can be added by adopters as their first concrete policy — it should restate the root-CLAUDE.md global rule "no hardcoded secrets in this repo" with the company's specific incident-response procedure if one is leaked.
