# Ground truth — self-improvement-loop (Slice U0)

Verified directly against this repo (`Koroqe/OPOS`, branch `feat/self-improvement-loop`, forked from main at v0.8.1 tip `bc369c1`) on 2026-08-19. Each finding names the slice it feeds. This file is SDLC working documentation — excluded from consumer scaffolds in Slice U10b.

## 1. CORE / STARTER classification (feeds U4, U9, U10c, R3)

`copier.yml _skip_if_exists` (exhaustive): root `CLAUDE.md`, `.mcp.json`, `.claude/settings.json`, `.claude/task-tracking.config.json`, `.claude/agents/engineering/**`, `.claude/agents/rnd/**`, `company/CLAUDE.md`, `company/strategy/**`, `company/policies/**`, `company/knowledge-base/**`, `company/backlog/**`, `company/hiring/**`, `departments/**`.

- **Company-tier agents are CORE.** Only `engineering/**` and `rnd/**` agent folders are consumer-owned. Consequences:
  - U9's chief-of-staff/coo charter edits **propagate to existing consumers on sync** — the Migration note (U10c) drops the "hand-edit your charters" item entirely.
  - U4's `redaction-reviewer.md` ships as plain CORE (no `_skip_if_exists` nuance needed).
  - R3 skips manual charter edits.
  - The consumer CHANGELOG's v0.5.x claim that `.claude/agents/**` is protected is wrong; its v0.8.0 claim (charter edits DO propagate) is right.
- `.claude/settings.json` **is** `_skip_if_exists` (STARTER) — consistent with U10b's decision to leave the template's empty allow-list untouched regardless.
- `company/knowledge-base/**` is STARTER → the **glossary** additions (U8) reach new consumers only; the Migration note keeps its glossary item.
- Root `CLAUDE.md` is STARTER → U3's "Self-improving" correction reaches new consumers via `CLAUDE.md.jinja`; Migration note keeps that item.

## 2. The two READMEs + RISKS form (feeds U3, U8, U9)

- Consumer-facing readme: **`README.md.jinja`** (CORE, propagates). Framework's own readme: **`.github/README.md`** (excluded, with `.github/images`). copier.yml carries an explicit CAUTION comment documenting the v0.7.2 collision regression — never add a bare root README.md.
- RISKS ships as **`RISKS.md.jinja`** (11 `.jinja` files total: root CLAUDE/README/RISKS/.copier-answers, company/CLAUDE, 6 dept CLAUDEs). RISKS numbering ends at **Risk 30** → 31–34 are free.

## 3. Test surface (feeds U10a)

- **`ui/tests/test_scheduled_run_schema.py` is the only test the feature breaks**: it substitutes `<<TOKEN>>` fixtures into `scheduled-run.md.tmpl` and asserts **set equality** of frontmatter keys against an 11-field `EXPECTED_FIELDS`. U3's two new fields make it 13 — update `EXPECTED_FIELDS`, `SUBSTITUTIONS`, and add type assertions for the new optional fields.
- `ui/tests/test_data.py` uses tolerant `assertGreaterEqual(len(agents), 7)` / `(len(skills), 10)` — unaffected by +3 skills/+1 agent.
- `ui/smoke.sh` asserts routes/status only, no counts — unaffected.
- No test asserts the literal 21/13/14 narrative counts (those live only in `chief-of-staff.md` prose — U9).

## 4. Counts at HEAD (feeds U9)

- Skills: **20** in `.claude/skills/` (+1 dept-scoped `deploy` = the "21" narrative) → 23 + 1 = **24** after the feature.
- Agents: **13** files under `.claude/agents/` → **14**.
- Templates: **14** files in `shared/templates/` (the charter's "All 9 v0.5.1 templates" line is stale today) → **15** with `core-proposal-pr.md.tmpl`.

## 5. Everything else

- **No `docs/` upstream** → U10b may exclude `docs/**` wholesale; nothing consumer-facing is dropped.
- `gh` identity on this machine has `{"admin":true,"push":true}` on `Koroqe/OPOS` → the direct-branch write path is the dogfood path (R5), as planned.
- `.github/workflows/sync-opos.yml` ships with the `schedule:` block commented out → auto-sync's mutual-exclusion preflight passes by default.
- MAINTAINER.md sections: Adding a CORE file / Adding a STARTER file / Adding runtime state / v0.6.0 additions / tool-name dependency / Releasing / Testing locally → the U8 incoming-PR triage guidance lands as a new `## Reviewing incoming [opos-core] PRs` section.
- `claude-code-sdlc` plugin is user-scoped and resolves on this machine; since the interactive session's cwd is the Restaba consumer repo, the documentation phase is produced by invoking the pipeline's agent roles directly against this clone (the plan's documented fallback) rather than `/bootstrap-feature`, which would target the wrong repo.
- Pre-existing untracked leftovers in this clone (left untouched, not ours): `.vscode/`, `company/backlog/scheduled-processes.md` (a stale v0.6.0 design backlog item whose feature already shipped).
