---
restricted: true
audience: [ceo, coo, chief-of-staff]
enforcement: convention-only
---

# Strategy (restricted scope)

> **WARNING: convention-only restriction.**
>
> This folder is marked `restricted: true` so that agents loading it into context can choose to honor the restriction. **Markdown is not access-controlled** — there is no technical mechanism in v0 preventing any agent in a session from reading these files. The restriction is honored by:
>
> 1. Subagents whose system prompts say "do not load `company/strategy/` unless your `name:` is in the `audience:` list above."
> 2. Reviewers who reject PRs that surface strategy content in the wrong scope.
>
> Real enforcement options are documented in `../strategy/README.md` and `../../RISKS.md`.

## Inherits from

`../CLAUDE.md`.

## Contents

Annual plans, multi-quarter roadmap, M&A material, compensation philosophy, board reports, anything else that should not be widely loaded into Claude Code sessions.

## Local rules

- Agents not in `audience:` MUST refuse to read files in this directory and instead respond "this scope is restricted to ceo/coo/chief-of-staff."
- New files added here MUST have a one-line `why-restricted:` note at the top so reviewers can challenge over-classification.
