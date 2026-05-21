# Engineering data

Dept-internal engineering data. Loaded into Claude Code sessions opened inside this department; not surfaced into company-wide scopes by default.

## What lives here

- **Runbooks** — step-by-step procedures for on-call and incident response. Filename: `runbook-<topic>.md`.
- **Postmortems** — incident reviews. Filename: `postmortem-YYYY-MM-DD-<short-slug>.md`.
- **ADRs** (Architecture Decision Records) — `adr-NNN-<title>.md`. Sequentially numbered. Each ADR captures context, decision, status, and consequences.
- **Standards** — coding conventions, review checklists, deploy contracts. Filename: `standard-<topic>.md`.

## Scope rules

See [`../CLAUDE.md`](../CLAUDE.md). Engineering data does not leave this folder unless explicitly promoted to `company/knowledge-base/`. If a runbook becomes relevant to another department, link to it rather than duplicating.
