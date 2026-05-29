# R&D data (research + engineering)

Research outputs and engineering-internal artifacts. **As of v0.5.1**, R&D is the umbrella covering both research/landscape work AND engineering execution; this folder holds artifacts in BOTH flavors. Loaded into sessions opened inside this department; not surfaced into company-wide scopes by default.

## What lives here

**Research-flavored artifacts** (`rnd-lead` owns):
- **Landscapes** — competitive / technology landscape scans. Filename: `landscape-<topic>-YYYY-MM-DD.md`.
- **Surveys** — framework or product surveys with structured entries. Filename: `survey-<topic>-YYYY-MM-DD.md`.
- **Prior-art reviews** — focused deep-dives on a specific tool or pattern. Filename: `prior-art-<name>.md`.
- **Notes** — working notes from research sessions; promoted to one of the above when consolidated. Filename: `notes-<topic>-YYYY-MM-DD.md`.

**Engineering-flavored artifacts** (`eng-lead` / `eng-reviewer` own; merged in from `departments/engineering/data/` at v0.5.1):
- **Runbooks** — step-by-step procedures for on-call and incident response. Filename: `runbook-<topic>.md`.
- **Postmortems** — incident reviews. Filename: `postmortem-YYYY-MM-DD-<short-slug>.md`.
- **ADRs** (Architecture Decision Records) — `adr-NNN-<title>.md`. Sequentially numbered. Each ADR captures context, decision, status, consequences.
- **Standards** — coding conventions, review checklists, deploy contracts. Filename: `standard-<topic>.md`.

## Scope rules

See [`../CLAUDE.md`](../CLAUDE.md). Artifacts that other departments will rely on should be PROMOTED to `company/knowledge-base/` (linked from here, not duplicated). Working notes and dept-internal runbooks stay here.

## Citation + provenance conventions

**Research artifacts** MUST cite their sources inline. Format: `[Name of source](URL)` for web sources; `(file: <repo-relative path>)` for internal sources. No claims without sources.

**Engineering artifacts** follow standard formats: ADRs use the canonical context/decision/status/consequences structure; postmortems include timeline, root cause, action items; runbooks include preconditions, steps, validation, rollback.
