# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).
In `0.x.y` releases breaking changes are allowed.

## [0.5.2] - 2026-05-30

### Added

- **`chief-of-staff` promoted to the explicit OPOS steward** — single conversational entry point for any session opened at the repo root. Five new body sections in `.claude/agents/company/chief-of-staff.md`:
  - **Steward role** — codifies the user → chief-of-staff → everything mental model. Steward never asks user to invoke `/some-skill`; user describes intent, steward maps to capability.
  - **Framework expertise** — what the steward knows by heart (15 skills, 13 agents, 9 templates, 6 depts, the `allocate-resource` AI-first kernel, the CLAUDE.md cascade, the release pipeline). Knowledge stays current by reading `.claude/skills/*/history/` on demand; in doubt, the steward consults via `consult-agent` rather than guesses.
  - **Goal decomposition pattern** — 5-step procedure when user states a goal-shaped intent: read state autonomously → parse intent → 1-3 line plan → execute → concise report.
  - **Permission tiers** — 5 levels (Auto / Notice / Confirm / Explicit approval / Hard refuse) with concrete examples for each. Includes the **heuristic for tier selection** (if the undo path requires more than `git checkout` of a file or `gh release create` to recreate, escalate at least one tier). Documents the convention-vs-enforcement distinction (these tiers are convention; Claude Code's `.claude/settings.json` handles hard enforcement).
  - **First-touch behavior** — greeting protocol at session start. Step 0 is the ad-hoc-skip heuristic ("what is…", "show me…" first-message patterns skip the greeting entirely). Steps 1-5 handle missing `.current-task` / `.paused-tasks` / empty history / unauthenticated `gh` gracefully (no errors on fresh scaffold). Greeting template: ≤3 lines, status + open question, no setup prompts, no menus.
- **Root `CLAUDE.md.jinja` "Default posture for sessions opened at this repo root"** section — activates the steward UX automatically. Placed between Values and Operating principles. Instructs Claude to read `chief-of-staff.md` in full, read `.current-task` + recent history + GitHub state, and greet per First-touch behavior — all before responding to the user's first message. Explicit dept-folder fallback (e.g. `cd departments/finance && claude` → act as `finance-lead`).
- **README "How to use OPOS day-to-day"** section — placed immediately after "First steps after scaffold". Shows 4 example user prompts and how the steward decomposes each ("Let's ship a feature for X" → slice plan + task-register + commits + release-from-changelog + close; "We need a marketing analyst" → people-lead → allocate-resource → AI/human route; etc.). Closing line: "You don't memorize skill names. You state intent — the steward maps it to capability."

### Changed

- `chief-of-staff.md` `description:` rewritten from `"Coordinates between CEO/COO and departments, manages company-level backlog and task tracking"` to `"The OPOS steward — single conversational entry point. Knows the entire framework; decomposes user goals into primitives; executes autonomously by default; asks permission only for commits / releases / agent creation / destructive ops."`
- `chief-of-staff.md` `## Delegation pattern` Calls section expanded — explicit mention of `consult-agent` as the dispatch mechanism + "can consult ANY of the 13 framework agents" framing.
- `chief-of-staff.md` `## Inputs` section adds **natural-language goals** as the most common input type.
- `chief-of-staff.md` `## Outputs` section adds **concise status reports** (1 line per executed step; full detail in history entries).

### Migration

The root `CLAUDE.md` "Default posture" section will NOT auto-propagate to existing v0.5.0 / v0.5.1 consumers via `copier update`. Reason: root `CLAUDE.md` is in `copier.yml _skip_if_exists` (v0.5.0 introduced this so founder-written Mission/Values survive updates). The trade-off: framework changes to root `CLAUDE.md` (rare; previous changes were v0.3.1's `time:` schema field and v0.5.1's engineering→rnd cascade example) require manual application by existing consumers.

**For existing consumers** (those who scaffolded from v0.5.0 or v0.5.1 before this release):

```bash
# 1. Pull v0.5.2 framework changes
copier update --vcs-ref v0.5.2

# 2. Manually copy the "Default posture" section from the framework's CLAUDE.md
#    at the v0.5.2 tag into your root CLAUDE.md between Values and Operating
#    principles:
gh api repos/Koroqe/OPOS/contents/CLAUDE.md.jinja?ref=v0.5.2 \
  --jq '.content' | base64 -d | \
  awk '/^## Default posture/{p=1} /^## Operating principles/{exit} p'

# Paste the printed section into your local CLAUDE.md between Values and
# Operating principles. Save.

# 3. Verify the steward UX activates: open Claude Code at your repo root,
#    type "hi", expect the chief-of-staff greeting (≤3 lines, status + "What
#    can I do?", no setup prompts).
```

`chief-of-staff.md` and `README.md` updates DO auto-propagate (those files are not in `_skip_if_exists`). New consumers scaffolding directly from v0.5.2 get the Default posture section on initial scaffold — no manual step needed.

### Notes

- Closes [#11](https://github.com/Koroqe/OPOS/issues/11) — "v0.5.2 — chief-of-staff as explicit steward."
- **The framework now has a single conversational entry point.** Users state goals; the steward executes. The OPOS UX shifts from "user learns 15 skill names and routes manually" to "user states intent, steward routes." This is the natural conclusion of v0.5.1's opinionated-framework direction.
- **Plan critic step now load-bearing for 4 consecutive releases** (v0.4.0 → v0.5.0 → v0.5.1 → v0.5.2). Each release surfaced findings the original plan would have left broken. This release: 9 findings (5 MAJOR + 4 MINOR), all CRITICAL/MAJOR addressed in-plan.
- **Smallest v0.5.x release** by design: 7 slices, 4 files updated, 0 new framework files. Promoting an existing agent rather than adding new primitives.
- **The chief-of-staff agent is now formalizing itself.** Meta-step in the framework's evolution: the agent who orchestrates every release is the deliverable.

## [0.5.1] - 2026-05-30

### Added

- **5 new starter departments** — `finance`, `people`, `legal`, `commercial`, `pr`. Each with a `CLAUDE.md.jinja` charter (Mission/Roles/Escalation/Data scopes/Processes-as-skills/Pointers sections) rendered from the new `shared/templates/DEPARTMENT.md.tmpl`. Each dept also gets its own lead agent (see below). Total starter depts: 2 → 6 (`rnd` umbrella + the 5 new).
- **5 new dept-lead agents** — `finance-lead`, `people-lead`, `legal-lead`, `commercial-lead`, `pr-lead`. All `model: opus`. Tools sized for AI-first execution per the v0.4.0 design-agent ladder. `people-lead` owns the NEW `allocate-resource` skill.
- **`allocate-resource` skill** (owner: `people-lead`) — **the AI-first kernel**. 9-step interactive procedure that runs the 4-question decision tree (text-based work? avoids physical action? avoids legal accountability? avoids needing lived experience?) → AI route EMITS `/design-agent` recommendation (does NOT auto-invoke; honest about the Task-tool semantic gap per the v0.5.1 plan critic finding); human route writes a job spec to `company/hiring/<slug>.md` using the new `HIRING-SPEC.md.tmpl`. Explicit slug-derivation algorithm (stop-word list + first 3-5 tokens + `safe_slug` regex + `-2`/`-3` collision-check). Glob-based coverage check against existing agents/skills. PROCESS.md state_schema commented per template convention.
- **2 new templates** — `shared/templates/DEPARTMENT.md.tmpl` (6 tokens: DEPT_NAME, DEPT_TITLE, MISSION, LEAD_NAME, ESCALATION, DATA_SCOPES) used by Slice 2's 5 charters and (eventually) `design-department` skill; `shared/templates/HIRING-SPEC.md.tmpl` (9 tokens) used by `allocate-resource` step 6 human route. Both follow the v0.5.0 POLICY.md.tmpl comment-header-stripping convention (rendered files don't show token instructions).
- **`company/hiring/` folder convention** — `.gitkeep` + README documenting the `pending → approved → posted → filled` lifecycle. First explicit application of the kb-curator dogfood `proposed_delta` finding from v0.4.0 ("ship `.gitkeep` + README when an agent introduces a new folder convention").
- **AI-first kernel** section in `README.md` documenting the philosophy + the 4-question decision tree + how the 6 default depts are designed around it.
- **RISKS Risk 17** — v0.5.1 dept restructure migration steps for theoretical v0.5.0 consumers.

### Changed

- **Engineering folds into R&D as the building branch.** `departments/engineering/` removed entirely; `.claude/agents/engineering/` removed entirely. `eng-lead.md` and `eng-reviewer.md` moved to `.claude/agents/rnd/`. The `deploy` dept-nested skill moved to `departments/rnd/.claude/skills/deploy/`. The `example-add-rollback-step.md` backlog item moved to `departments/rnd/backlog/`. Engineering's `backlog/README.md` and `data/README.md` content was MERGED into R&D's existing READMEs (rather than overwriting). `eng-lead.md` frontmatter: `department: engineering → rnd`; Escalation rules body: `coo → rnd-lead`. `eng-reviewer.md` frontmatter: `department: engineering → rnd`.
- **`rnd-lead.md` scope expansion** — description + body rewritten for the umbrella role (research + engineering execution + production + product/service delivery). `Calls:` adds `eng-reviewer` as sub-lead. `owns_processes: [] → [deploy]` (binding-of-record stays with `eng-lead` who executes; rnd-lead owns at the umbrella level).
- **`departments/rnd/CLAUDE.md.jinja`** Roles section: adds `eng-lead` + `eng-reviewer` bullets. Mission expanded. Data scope covers both research AND engineering flavors.
- **`company-setup` SKILL.md** restructured from 10 → 9 steps. Old step 6 (engineering decision) + old step 7 (rnd decision) merged into a single richer step 6: 6-dept loop covering all v0.5.1 default depts (rnd umbrella + finance + people + legal + commercial + pr) with `keep` or `customize` per dept. Old step 8 (policies) → 7; old step 9 (smoke) → 8; old step 10 (history) → 9. PROCESS.md `success_criteria.dept_decisions_applied` wording updated.
- **`copier.yml _skip_if_exists`** adds `company/hiring/**` (founder-owned per the new folder convention).
- **12 downstream files updated** to remove orphaned references to `departments/engineering/` and `.claude/agents/engineering/`: `design-process/SKILL.md` (reference example path), `design-agent/SKILL.md` (dept-tier reference agent path), 3 PROCESS.md files with "engineering's domain" body framing (`sync-from-core`, `task-register`, `release-from-changelog`), 4 company-tier agents' `Calls:` example lists (`ceo.md`, `coo.md`, `chief-of-staff.md`, `ops-manager.md`) — replaced `(e.g. eng-lead)` with the enumerated 6 dept leads; root `CLAUDE.md.jinja` cascade example; `RISKS.md.jinja` Risk 4 verification recipe (subagent count baseline 6 → 13; `cd departments/engineering` → `cd departments/rnd`); `shared/templates/BACKLOG-ITEM.md.tmpl` example INTENDED_TARGET.
- **`README.md.jinja`** swept for the 5 specific hardcoded engineering references (per plan critic MAJOR #8): "First steps" dept-mission list, "Quickstart" worked example, cascade-model session example (3 lines), backlog-item link, Subscopes ship-with note. New "AI-first kernel" section added.
- **Test count stable at 37** — 2 existing tests updated (`test_includes_dept_nested` deploy.dept assertion engineering → rnd; `test_includes_company_synthetic` now asserts the 6 v0.5.1 starter depts and explicitly NOT engineering).

### Removed

- **`departments/engineering/`** (entire folder; content moved to `departments/rnd/` per the merge).
- **`.claude/agents/engineering/`** (entire folder; eng-lead + eng-reviewer moved to `.claude/agents/rnd/`).

### Migration

For theoretical v0.5.0 consumers updating to v0.5.1, `copier update` does NOT auto-apply the restructure (the `_skip_if_exists` pattern protects `departments/**` and `.claude/agents/**` from overwrite, but the framework-side REMOVAL of `engineering/` leaves stale content in the consumer). Manual cleanup steps:

```bash
# 1. Move agents under rnd
git mv .claude/agents/engineering/eng-lead.md .claude/agents/rnd/eng-lead.md
git mv .claude/agents/engineering/eng-reviewer.md .claude/agents/rnd/eng-reviewer.md
rm -rf .claude/agents/engineering/

# 2. Move dept-nested skill + example backlog item
git mv departments/engineering/.claude/skills/deploy departments/rnd/.claude/skills/deploy
git mv departments/engineering/backlog/example-add-rollback-step.md departments/rnd/backlog/

# 3. Either merge engineering's READMEs into rnd's, or accept rnd's + delete
rm departments/engineering/backlog/README.md departments/engineering/data/README.md

# 4. Remove the now-empty engineering folder
rm -rf departments/engineering/

# 5. Update eng-lead.md frontmatter: department: engineering → rnd
#    Update eng-lead.md body Escalation rules: coo → rnd-lead
#    Update eng-reviewer.md frontmatter: department: engineering → rnd

# 6. Verify
bash ui/smoke.sh                                # 16/16 should pass
python3 -m unittest discover ui.tests           # 37/37 should pass
```

See RISKS Risk 17 for the longer-form discussion of the trade-off.

### Notes

- Closes [#10](https://github.com/Koroqe/OPOS/issues/10) — "v0.5.1 — 7-dept AI-first org chart + allocate-resource skill".
- **The most opinionated release yet.** v0.5.1 ships a SPECIFIC organizational philosophy as starter content, not just primitives. Founders adopting OPOS now START with the 6-dept structure (rnd umbrella + finance + people + legal + commercial + pr) and the AI-first kernel codified as `allocate-resource`. The framework was previously domain-agnostic (engineering + rnd were generic examples); v0.5.1 makes the AI-first-company philosophy load-bearing.
- The `allocate-resource` step 5 AI-route design is the FIRST explicit framing of the "skills can RECOMMEND next-turn slash commands but cannot AUTO-INVOKE them via Task" convention. Surfaced as a CHANGELOG-worthy framework constraint.
- Plan critic pass surfaced 22 findings (5 CRITICAL + 11 MAJOR + 6 MINOR); all addressed in-plan. Two consecutive releases (v0.5.0 + v0.5.1) saved from broken state by the critic step. The plan-critic loop is now load-bearing framework infrastructure.
- First explicit application of the kb-curator-dogfood `proposed_delta` finding from v0.4.0: shipping `.gitkeep` + README for new folder conventions (here: `company/hiring/`).
- Total starter content: 6 depts (was 2), 13 agents (was 8), 15 skills (was 14).

## [0.5.0] - 2026-05-29

### Added

- `company-setup` skill (owner: `coo`) — first-run conversational founder onboarding. 10-step procedure that prompts for Mission, Values, top 3-5 strategic priorities, engineering + R&D dept missions (keep/customize), and 0-3 initial policies. Writes the answers to `CLAUDE.md` (Mission + Values), `company/strategy/priorities.md`, optionally-customized `departments/<dept>/CLAUDE.md`, and `company/policies/<slug>.md` files. Tools: `[Read, Edit, Write, Bash, Grep, Glob]` (least-privilege per the v0.4.0 design-agent ladder; explicit exclusions). Anchored abort check on the unique `<one short sentence>` placeholder token. Refuses naming conflicts with a hand-maintained 11-entry framework-reserved list (`secrets, restricted, risks, framework, audit, history, mission, values, charter, strategy, policies`) — exact whole-string match. Step 9 runs the greppable subset of the RISKS verification recipe inline; conversational steps (`List available subagents`) deferred to founder verification post-setup. History entry naming: `setup-<COMPANY_NAME_lowercased>`.
- `shared/templates/POLICY.md.tmpl` — 7 substitution tokens (`TITLE`, `SLUG`, `OWNER`, `EFFECTIVE_DATE`, `SCOPE`, `RULE`, `REVIEW_CADENCE`). No `version:` field (no policy-versioning convention exists yet — would create an unsourced obligation). Comment-header-stripping convention: unlike other templates, the HTML comment block is REMOVED at render time by `company-setup` step 8 so the founder reads their own policy without seeing token instructions.
- README "First steps after scaffold" section — 3-step founder workflow inserted between the scaffold code block and "Updating from upstream". Makes the post-scaffold flow obvious (`copier copy → /company-setup → /serve-console`).

### Changed

- `copier.yml`: root `CLAUDE.md` moved to `_skip_if_exists` (was: CORE / auto-updated). **Rationale:** v0.5.0 introduces the convention that founders own root `CLAUDE.md` after scaffold (Mission and Values are founder-content written by `/company-setup`). Without this change, every `copier update` would attempt to overwrite founder-written content, generating `.rej` files (the exact friction Risk 9 warns against). **Trade-off:** future framework changes to root `CLAUDE.md` (rare — last was v0.3.1's `time:` schema field) no longer auto-propagate to consumers; consumers must manually pull such changes. Documented inline in the YAML comment.
- `coo` agent: `owns_processes: [] → [company-setup]`; `tools:` adds `Bash` (needed for step 9's `grep`/`find`/`git status`); `description:` updated to mention company-setup ownership (discoverability via consult-agent / design-agent). Body Role section gains a v0.5.0 narrative sentence; Owned processes section replaces the `(none directly)` placeholder with a bullet for company-setup.
- README scaffold example: `--vcs-ref v0.1.0 → v0.5.0`; added a brief note that root `CLAUDE.md` is now consumer-owned post-scaffold.

### Notes

- Closes [#9](https://github.com/Koroqe/OPOS/issues/9) — "v0.5.0 — company-setup skill (founder onboarding)".
- No breaking changes for v0.4.x consumers. The `copier.yml _skip_if_exists` addition for root `CLAUDE.md` is BACKWARD-COMPATIBLE for existing consumers (they already have a CLAUDE.md, so the skip rule just preserves it — same behavior as if they had hand-edited it before).
- **First consumer-facing skill** (vs prior framework-internal additions like `design-agent`). The user's own `zipread` company is the inaugural founder use. The `proposed_delta` from that run will be the v0.5.1 signal source — mirror the v0.4.0 → kb-curator-dogfood → v0.4.1-candidates pattern.
- Plan critic pass surfaced 28 findings (3 CRITICAL, 19 MAJOR, 6 MINOR) — all CRITICAL/MAJOR addressed in-plan. The CRITICAL fixes: rendered `.md` paths (not `.jinja`), `<one short sentence>` literal token anchor for abort check, and the `copier.yml` `_skip_if_exists` addition (the most important — would otherwise have caused every `copier update` to conflict).
- kb-curator first-dogfood `proposed_delta` follow-ups (logged in `.claude/skills/design-agent/history/2026-05-29-kb-curator.md`) — "document conflict-resolution heuristic in design-agent" and "ship `.gitkeep` + README for new folder conventions" — deferred to v0.5.1 (not blocking founder onboarding).

## [0.4.0] - 2026-05-29

### Added

- `design-agent` skill (owner: `ops-manager`) — mirrors `design-process` for creating new agent files. 12-step interactive procedure with `consult-agent`-based dept-lead/escalation-target/delegation-target consultations, least-privilege tools allow-list ladder, AGENT.md.tmpl token validation, delegation-cycle check, slug-regex validation (`^[a-z][a-z0-9-]{1,62}$` — same as `ui/validate.py:safe_slug`), TOCTOU re-check at file-write time, and history-entry-with-skipped-consultations record. PROCESS.md retrofits `state_schema:` from start (LangGraph pattern from v0.2.0): `discovering → consulting → drafting → presenting → iterating → committing`.
- Console agent ergonomics: `/agents` page footer hint pointing at `/design-agent` invocation; `/agents/<dept>/<name>` detail page prepends a `/consult-agent` callout with the agent's name substituted (Jinja2 autoescape protects against HTML injection in malformed names).
- `.cli-hint` CSS class in `ui/static/console.css` (matches `.warn` / `.panel` aesthetic).
- 3 new template-render tests in `ui/tests/test_templates.py` (consult-hint substitution, autoescape defense, agents-list hint). Test count: 34 → 37.

### Changed

- `design-process` SKILL.md Failure modes "New agent role required" — now invokes `design-agent` inline (both owned by ops-manager) instead of escalating to `coo` as the first action. `coo` escalation preserved as fallback when the user explicitly rejects the agent design. The new-DEPARTMENT-charter case still escalates to `coo` (no `design-department` skill yet — likely v0.5.0+).
- `ops-manager` agent: `owns_processes:` grows from `[design-process]` to `[design-process, design-agent]`. Role + Delegation + Escalation sections updated to reflect the v0.4.0 hand-off pattern.
- RISKS.md Risk 8 status: `LOW impact; documented escalation` → `CLOSED in v0.4.0` (with pointer to `.claude/skills/design-agent/` + the remaining new-department-charter gap noted).

### Notes

- Closes [#8](https://github.com/Koroqe/OPOS/issues/8) — "v0.4.0 — design-agent skill + agent ergonomics".
- No breaking changes for v0.3.x consumers. `copier update` flows cleanly: the new `design-agent/` directory is a CORE addition; `ui/templates/agents.html` + `ui/templates/agent.html` are CORE updates (consumers who hand-edited them will see `.rej` per Risk 9, same as any CORE update).
- `release-from-changelog` SKILL.md was NOT modified in this release — its v0.3.1 8-step procedure (with the pre-release scaffold check at step 5) is exercised cleanly on this release.
- All 8 GitHub issues to date (#1–#8) will be CLOSED after this release ships.

## [0.3.1] - 2026-05-29

### Fixed

- `parse_skills()` in `ui/data.py` now discovers dept-nested skills under `departments/<dept>/.claude/skills/<name>/` in addition to root-level `.claude/skills/<name>/`. Surfaced during the v0.3.0 console UX walkthrough: `/skills/deploy` returned 404 even though the example `deploy` skill ships nested under `engineering/`. The `Skill` dataclass gains a `dept` field (empty for root, dept name for nested); on name collisions, root-level wins (matching the cascade convention).

### Changed

- `release-from-changelog` SKILL.md gains a new step 5 (`prerelease_scaffold_check_passed`) — runs `copier copy . /tmp/X --vcs-ref=HEAD` and asserts exit 0 BEFORE tagging. Catches Copier-side template-rendering breakage before the release is cut. Surfaced from v0.3.0's `.html.jinja` → `.html` rename incident which required a destructive delete-and-re-cut. The skill's `PROCESS.md` bumps to v0.2.0.
- History entry schema (root `CLAUDE.md` Self-improvement log section) gains an optional `time: HH:MM` field. The console activity feed uses it as the secondary sort key (within a date) so multiple runs on the same day order chronologically. Backwards-compat: older entries without `time` continue to sort by `run_id` alphabetic.
- Console dashboard: "Departments" tile renamed to "Scopes" with a "N depts + 1 company" breakdown sub-line; zero-count task tiles render as dimmed plain text (no link) so users don't click into empty filtered lists.
- Dept detail page (`/departments/<name>`) now includes physically-nested skills (`skill.dept == name`) in addition to skills owned by dept members. Skill detail page surfaces a "Scope" row showing the dept badge or "root".
- `task-register` SKILL.md step 9 (v0.3.0 fix exercised again): now `URL=$(gh issue create ...)` + `basename` — the bogus `--json` flag is gone.

### Notes

- Closes [#7](https://github.com/Koroqe/OPOS/issues/7) — "v0.3.1 patch — console UX fixes + v0.3.0 carryover".
- No breaking changes. Pure patch — `copier update` flows cleanly for any v0.3.0 consumer; the new `time:` field is optional and existing history entries continue to render correctly.
- Test coverage grows 30 → 34 unittest cases (test_includes_dept_nested, test_root_wins_on_name_collision, test_time_field_used_as_secondary_sort, test_missing_time_falls_back_to_run_id).

## [0.3.0] - 2026-05-28

### Added

- `ui/` directory — a local-host **read-only console** that renders the framework's markdown + JSON as a CRM-style web UI. Boot with `python3 ui/console.py` (or via the new `serve-console` skill). Five pages plus four detail variants: dashboard, tasks (with state/dept/owner filters), agents (grouped by dept), skills (grouped by owner agent), departments, activity feed (chronological history-entry stream). Reads files on every request — always fresh. Defaults to `127.0.0.1:8765`; `--host 0.0.0.0` exposes on the LAN (warned in `serve-console` SKILL.md).
- `serve-console` skill (owner: `chief-of-staff`) — one-command launch of the console with dependency checks (Python 3.10+, `jinja2`, `markdown`) and a clear install hint when `markdown` is missing. Long-running foreground process; abnormal-exit history entries only.
- `ui/handlers/` package — per-resource handler modules (`dashboard`, `activity`, `agents`, `skills`, `tasks`) that register themselves via `install(pattern, handler)` at import time, populating a master `ROUTES` list consumed by the dispatcher in `ui/console.py`.
- `ui/data.py` — pure-Python markdown frontmatter parsers (`parse_agents`, `parse_skills`, `parse_tasks`, `parse_history`, `parse_departments`, `paused_task_numbers`). `parse_departments` synthesizes a `company` department from `company/CLAUDE.md[.jinja]`, literal-substituting `{{ COMPANY_NAME }}` (no full Jinja engine in the data layer).
- `ui/validate.py` — `safe_slug` / `safe_int` / `safe_date` / `safe_choice` + `BadRequest` exception. Path-traversal defense at the validator (slug regex rules out `..`, `/`, NUL, capitals; length capped at 64). Dispatcher maps `BadRequest` to 400.
- `ui/render.py` — Jinja2 environment + markdown filter for rendering body panels.
- `ui/smoke.sh` — scripted integration smoke test (boots server on a free port, curls 12 routes + 3 validation-rejection URLs, asserts statuses + no leftover stub markers).
- `ui/tests/test_data.py`, `ui/tests/test_validate.py`, `ui/tests/test_title_heuristic.sh` — unittest + bash test coverage. 30 unittest cases all pass; the title-heuristic test PRE-validates the v0.3.0 `release-from-changelog` fix before the live release uses it.
- `markdown` library — new optional Python dep used for body rendering. Pure-Python, ~150KB installed. Required-but-missing produces an install hint from `serve-console` step 4; no auto-install.
- RISKS.md Risk 16 — localhost-binding rationale + restricted-folder caveat for the console.

### Changed

- `release-from-changelog` SKILL.md step 5 — title-derivation heuristic now skips the 8 reserved Keep-a-Changelog section names (`Added`, `Changed`, `Removed`, `Deprecated`, `Fixed`, `Security`, `Notes`, `Migration`) when picking the first `### ` subheading. Falls back to bare `$VERSION` when only reserved names exist. Fixes the v0.2.0 `v0.2.0 — Added` bug surfaced as a `proposed_delta`.
- `task-register` SKILL.md step 9 — replace the bogus `gh issue create --json url,number --jq '.url'` snippet (the flag is not supported by `gh issue create`) with the working pattern `URL=$(gh issue create ...); ISSUE_NUM=$(basename "$URL")`. Bug surfaced when running `task-register` for issue #6.
- `chief-of-staff` agent — `owns_processes:` grows from 9 to 10 (adds `serve-console`); body's "Owned processes" section gains one bullet.
- `copier.yml _exclude` adds `ui/tests/` and `ui/smoke.sh` — framework-dogfooded test fixtures + smoke script that assert on the framework's specific agent/skill counts; not applicable to consumer scaffolds. The runnable console (`ui/console.py`, `ui/data.py`, `ui/handlers/`, `ui/templates/`, `ui/static/`, `ui/render.py`, `ui/validate.py`, `ui/README.md`) ships to consumers as CORE.
- `.gitignore` adds `__pycache__/` and `*.pyc`.
- `README.md` adds a "Console (read-only browser)" section after the task-tracking loop; adds `ui/` to the Subscopes list.

### Notes

- Closes [#6](https://github.com/Koroqe/OPOS/issues/6) — "Ship v0.3.0 — local-host read-only console UI".
- No breaking changes for v0.2.x consumers. `copier update` flows cleanly: the new `ui/` directory is a CORE addition; `serve-console` skill is a new file; `chief-of-staff.md` is a CORE file (consumers who hand-edited it will see a `.rej` per Risk 9 — same as any CORE update).
- **One new optional Python dep:** `markdown` (~150KB installed, pure-Python). Install with `pip install markdown` or `pipx inject copier markdown`. Required by the console; not by any other skill.
- `release-from-changelog` self-tested by being used to cut this very release — the title heuristic is PRE-validated by `ui/tests/test_title_heuristic.sh` and known-good against three synthetic fixtures (Added-only, Notes-only, Notes-then-arbitrary) before the live invocation.

## [0.2.0] - 2026-05-28

### Added

- `consult-agent` skill (owner: `chief-of-staff`) — consult another agent by spawning its definition as a subagent via the Task tool; canonicalizes the eng-lead/rnd-lead simulation pattern previously hand-crafted in `design-process` step 4 and the R&D framework survey.
- `release-from-changelog` skill (owner: `chief-of-staff`) — cut a GitHub release from a CHANGELOG.md version entry; extracts notes via the canonical awk pattern from MAINTAINER.md and handles the inverted-exit-code `gh release view` check correctly.
- `task-pause` + `task-resume` skills (owner: `chief-of-staff`) — multi-task support. `task-pause` moves the active task from `.claude/.current-task` to a new `.claude/.paused-tasks` list (gitignored); `task-resume <issue>` brings it back. Closes the manual-override pattern that fired 4× across prior releases.
- `shared/templates/TASK.md.tmpl` — first-class task abstraction (research recommendation #1 from the R&D framework survey, CrewAI pattern). Frontmatter: issue_number, title, owner, depts, state, created, completed, success_criteria, deadline, related_skills. Body: Goal, Acceptance criteria, Progress log, Final outcome.
- `tasks/` folder convention — `task-register` creates `tasks/<issue-number>.md` on each invocation; `task-complete` moves it to `tasks/closed/<issue-number>.md`. The framework dogfoods its own task tracking against `Koroqe/OPOS#5` and beyond; consumer scaffolds get an empty `tasks/.gitkeep` (per-task files are excluded from the Copier template via `tasks/[0-9]*.md` + `tasks/closed/**` patterns).
- Optional `state_schema:` frontmatter in `shared/templates/PROCESS.md.tmpl` + optional `## State transitions` body section (research recommendation #2, LangGraph pattern). Documentation-only in v0.2.0; no runtime enforcement.
- `company/knowledge-base/claude-code-mapping.md` — explains OPOS-as-convention-layer ↔ Claude-Code-as-runtime-layer stack (research recommendation #3). 7-row file mapping table; "what OPOS does NOT replace" + "what Claude Code does NOT provide" sections to nail the positioning.

### Changed

- `design-process` SKILL.md step 4 — invokes `consult-agent --agent <dept-lead> --question "..."` instead of hand-crafting a Task call. Reduces boilerplate; concentrates the simulation pattern in one skill.
- `design-process/PROCESS.md` — retrofitted with `state_schema:` (6 named states: `discovering → consulting → drafting → presenting → iterating → committing`) and a `## State transitions` body section explaining the loop/termination conventions.
- `task-register` SKILL.md — refuse-message in step 4 now recommends `task-pause` as the canonical alternative to `task-complete` (or manual `rm`). New step 11 creates `tasks/<issue-number>.md` from TASK.md.tmpl; total step count 12 → 13.
- `task-complete` SKILL.md — new step 13 archives `tasks/<n>.md` to `tasks/closed/` via `mkdir -p` + `mv` (with backwards-compat skip for pre-v0.2.0 task files); subsequent steps renumbered.
- `chief-of-staff` agent — `owns_processes:` grows from 5 to 9 (adds 4 new skills); body's "Owned processes" section adds 4 new bullets.
- `copier.yml` `_exclude` adds `.claude/.paused-tasks`, `tasks/[0-9]*.md`, `tasks/closed/**` (prevents framework dogfooding from leaking to consumer scaffolds).
- `.gitignore` adds `.claude/.paused-tasks`.
- `README.md` adds "Key reference docs" section linking the two `company/knowledge-base/` research artifacts; adds `tasks/` to the Subscopes list.

### Notes

- Closes [#5](https://github.com/Koroqe/OPOS/issues/5) — "Ship v0.2.0 — new skills + research-derived improvements."
- No breaking changes for v0.1.x consumers. `copier update` flows cleanly: the new skills are CORE additions (auto-synced); the new `tasks/.gitkeep` is added; `.claude/task-tracking.config.json`'s `_label_palette` from v0.1.1 persists unchanged.
- All 5 v0.1.0 deferred items (consult-agent, release-from-changelog, task-pause, since_sha-fallback-exercise, privacy-warning-path) are addressed — the latter two by being NOT-actionable-without-real-world-usage and graduating from "deferred" to "validated in v0.3.0 if real-world runs surface them."
- All 3 research recommendations from the AI-OS framework survey (CrewAI, LangGraph, Claude Code positioning) are landed.
- `release-from-changelog` self-tested by being used to cut this very release.

## [0.1.1] - 2026-05-28

### Changed

- `design-process` SKILL.md polish: step 7 explicitly enumerates trigger-mechanism options (manual / hook-driven / hybrid); step 11 documents the history-write timing (after user approval); new `## Multi-skill design sessions` subsection acknowledging that one invocation can produce multiple sibling skills (the task-tracking session as worked example); "New agent role required" failure mode mentions the parallel "new dept charter" case.
- `task-register` SKILL.md polish: `--json url,number --jq '.url'` for explicit URL capture (stable across `gh` versions); new `quiet_label_creation` input (optional bool, default false) consolidates per-label warnings into a single summary line; "When to use" section notes that inputs may be gathered conversationally over multiple AskUserQuestion turns. PROCESS.md adds `label_warnings_consolidated_if_quiet` to success_criteria.
- `task-update` SKILL.md: step 9 (body-status-line patch) now includes a concrete shell pipeline using Python regex via `os.environ` for parametrization. The Python helper exits non-zero on regex no-match, short-circuiting the pipeline. `sed`/`perl` listed as alternatives.
- `task-complete` SKILL.md: step 9 (final-comment render) wraps the missing-Refs warning block in a `<details>` when there are 5 or more commits; step 11 documents that the `status:done` color comes from `.claude/task-tracking.config.json`'s `_label_palette`.
- `.claude/task-tracking.config.json`: new optional `_label_palette` key documenting label colors (`task`, `status:done`, and a 6-entry `dept_cycle` array). Additive — STARTER file, won't break v0.1.0 consumers on update.

### Fixed

- `MAINTAINER.md` CHANGELOG-extraction awk snippet: previous pattern `awk '/^## \[X.Y.Z\]/,/^## \[/' | sed '$d'` produced empty output when X.Y.Z was the only entry in the file. New pattern uses an explicit `p` flag with three stop conditions, also excluding the bottom-of-file `[X.Y.Z]:` link-reference lines.

### Notes

- Closes [#4](https://github.com/Koroqe/OPOS/issues/4) — "Harden v0.1.0 — close known gaps (v0.1.1 patch release)".
- 13 `proposed_delta` items from v0.1.0 history addressed; 5 deferred to v0.2.0 (`consult-agent`, `release-from-changelog`, `task-pause`, plus two validation-runs that need real-world test data).
- Self-bootstrap idempotency was confirmed during v0.1.0's release — still holds for v0.1.1 (verified by Slice 6 of this work).
- No breaking changes. v0.1.0 consumers can `copier update` cleanly.

## [0.1.0] - 2026-05-25

### Added

- Core framework skeleton: root `CLAUDE.md`, `RISKS.md`, `README.md`, 7 templates in `shared/templates/`.
- 4 company-level agents: `ceo`, `coo`, `chief-of-staff`, `ops-manager`.
- 6 framework skills: `design-process`, `task-register`, `task-update`, `task-complete`, `check-for-updates`, `sync-from-core`.
- 2 starter departments: `engineering` (with `deploy` skill), `rnd`.
- **Copier-based distribution**: `copier.yml` with `_templates_suffix: ".jinja"` (the default — only `.jinja`-suffixed files are processed), `_exclude` (runtime state), `_skip_if_exists` (starter content), and a single `COMPANY_NAME` question. The 5 files needing variable substitution (`CLAUDE.md`, `README.md`, `RISKS.md`, `company/CLAUDE.md`, `departments/*/CLAUDE.md`) are stored as `*.jinja` source files; Copier strips the suffix on render.
- **Agent-driven auto-update**: `check-for-updates` skill invoked as step 1 of `task-register`/`task-update`/`task-complete`; cached 6h; silent unless an update exists.
- **Opt-in GitHub Actions auto-update workflow**: `.github/workflows/sync-opos.yml`, `workflow_dispatch` only by default; uncomment `schedule:` block to enable weekly background PRs.
- `CHANGELOG.md` (this file) and semantic-versioning policy.
- `MAINTAINER.md` framework-developer guide.

### Notes

- Initial public release.
- `0.x.y` releases may contain breaking changes per semver. Each breaking-change release will include a `### Migration` subsection in its CHANGELOG entry.
- Future breaking changes after v1.0 will bump the major version.

[0.5.2]: https://github.com/Koroqe/OPOS/releases/tag/v0.5.2
[0.5.1]: https://github.com/Koroqe/OPOS/releases/tag/v0.5.1
[0.5.0]: https://github.com/Koroqe/OPOS/releases/tag/v0.5.0
[0.4.0]: https://github.com/Koroqe/OPOS/releases/tag/v0.4.0
[0.3.1]: https://github.com/Koroqe/OPOS/releases/tag/v0.3.1
[0.3.0]: https://github.com/Koroqe/OPOS/releases/tag/v0.3.0
[0.2.0]: https://github.com/Koroqe/OPOS/releases/tag/v0.2.0
[0.1.1]: https://github.com/Koroqe/OPOS/releases/tag/v0.1.1
[0.1.0]: https://github.com/Koroqe/OPOS/releases/tag/v0.1.0
