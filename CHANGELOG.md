# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).
In `0.x.y` releases breaking changes are allowed.

## [0.9.1] - 2026-08-20

### Fixed

- **`company-setup` resume-from-step-N** (#22 — the first consumer-proposed fix via the v0.9.0 loop). The step-1 guard is now step-aware: Mission set + the step-9 history entry present → populated repo, ABORT unchanged; Mission set + no history entry → PARTIAL run, detect per-step completion from each step's artifact and resume at the first incomplete step. Also fixes a stale "step 10" reference (the history entry is step 9).
- **Scoped canonical commit messages** (#23 — also consumer-proposed). `chore: auto-sync OPOS core <tag>` → `chore(core): auto-sync OPOS core <tag>`; the partial-sync and review-history triage messages likewise move to the `core` scope. Consumers whose tooling enforces `type(scope):` with a scope allow-list no longer fail the scheduled runs' commit steps.
- **`schedule-process` persistence contract surfaced** (from a consumer-recorded delta). `CronCreate`'s persistence varies by Claude Code build; current builds are session-scoped (in-memory, gone on session exit, 7-day auto-expiry on recurring jobs). New "Persistence contract" section + mandatory step 8a: print the tool's persistence markers to the user verbatim at registration; document the idempotent per-session re-arm rule and a `SessionStart` reminder-hook pattern for self-healing re-registration. Durable runtime (`runtime: gha` / account-level cloud routines) remains the tracked v2 path (Risks 20/23).

### Notes

All three changes originated from a consumer instance within hours of v0.9.0 shipping — two arrived as anonymized `[opos-core]` PRs through `propose-to-core`, the third as an open delta consumed directly by the maintainer. Patch bump; no template-structure changes; no Migration steps.

## [0.9.0] - 2026-08-19

### Added

- **The bidirectional self-improvement loop** — OPOS consumers now pull framework updates autonomously AND push anonymized fixes back upstream, closing the loop across every company running the framework. Three new CORE skills + one new company-tier agent, all pure Claude Code (no side software):
  - **`auto-sync`** (owner: `chief-of-staff`; scheduled daily `17 6 * * *`, `authority: [commit, push, file_issue]`) — the autonomous sibling of `sync-from-core`: probes the upstream release directly (bypasses the 6h cache, refreshes it after), applies clean updates via `copier update` on an `opos-auto-sync-<tag>` work branch, auto-commits + ff-merges + pushes, and escalates anything needing a human (conflicts, divergence, push failures) to a `[opos-auto-sync]`-titled issue in the consumer's own repo. Guards: clean-tree (no issue — dirty trees aren't incidents), `--ff-only` divergence check before any update, stale-branch self-heal, sync-driver mutual exclusion vs. the `sync-opos.yml` Action, and a mechanical predicate for the ONE auto-resolvable conflict class (a purely-additive `CHANGELOG.md.rej` carrying a new version section — inserted above older versions, verified with the canonical awk plus a day-heading position assertion). Every run writes a record, including "no update" runs — the liveness signal for Risk 20.
  - **`review-history`** (owner: `coo`; scheduled weekly `23 7 * * 1`, `authority: [commit, push, write_proposal, file_issue, open_pr]`) — the missing CONSUMER of the `proposed_delta` signal. Weekly triage of every `status: open` delta across all `history/` + `scheduled-runs/` folders: STARTER-file fixes within an objective threshold (≤2 files, ≤20 lines, no sensitive path) are applied + committed; larger ones become dept-backlog proposals; CORE-file defects route to `propose-to-core` (≤3 PR creations/run). Also reconciles previously-opened upstream PRs: merged → `applied`, closed-unmerged → issue for human decision. CORE files are never edited locally.
  - **`propose-to-core`** (owner: `chief-of-staff`; not scheduled — invoked by `review-history` or manually) — turns a CORE-file defect into a **fully anonymized** upstream PR. Runtime classification (fetches upstream `copier.yml` at the consumer's pinned `_commit` for `_skip_if_exists`; probes upstream existence at HEAD incl. `.jinja` variants); two-layer dedupe (committed `proposals/LEDGER.md` + local `[opos-core]` title-slug match); three-layer redaction gate — deterministic blocklist-grep + secret-regex pre-gate, adversarial `redaction-reviewer` pass (fail-closed on anything but the literal `REDACTION: PASS`), human-draft fallback; write path = direct branch (maintainer-consumers with push rights) or user-account fork (never a company org), neutral commit identity, ephemeral scratch clone. The named invariant: no outbound write before both gates pass.
  - **`redaction-reviewer` agent** (`.claude/agents/company/redaction-reviewer.md`, CORE) — the adversarial gate: judges only the bundle it is handed (diff, PR title/body, branch, commit message, orchestrator-supplied identifier blocklist); seven scan classes including secrets/credentials (automatic FAIL); uncertainty = FAIL.
  - **`shared/templates/core-proposal-pr.md.tmpl`** — the generic PR-body template (Problem / Observed failure mode / Proposed change / How verified + consumer-instance footer).
  - **`proposals/` convention** — committed drafts + `LEDGER.md` (the authoritative cross-machine dedupe ledger; schema + writer constraints in `proposals/README.md`: `propose-to-core` appends rows only, `review-history` mutates the `outcome` column only). Dated draft files are copier-excluded (they exist BECAUSE redaction failed); README + LEDGER ship, LEDGER under `_skip_if_exists`.
- **Schema fields `delta_target` + `upstream_pr`** (both OPTIONAL) on history/scheduled-run entries — mechanical-triage hint and upstream-PR tracking; added to `scheduled-run.md.tmpl`, `PROCESS.md.tmpl` schema lists, the consumer README, and root `CLAUDE.md.jinja`.
- **`/schedule-process` step 5b** — at registration, proposes the minimal narrowly-scoped `.claude/settings.json` allow entries the process's declared authority needs (never blanket `gh api` or bare `git push`), added only on the user's confirmation. Registration is the human authorization moment; scaffold defaults stay empty.
- **Scheduled-run authority exception** (governance) — documented canonically in the consumer README, referenced in the chief-of-staff Permission-tiers section and the coo charter: actions inside a scheduled process's declared `authority:` list are pre-authorized once at registration, including branch-then-ff-merge integration to the default branch.
- **MAINTAINER.md "Reviewing incoming [opos-core] PRs"** — genericity / leak-scan / `.jinja`-correctness / smoke-test checklist; never quote leaked content in review comments.
- **Six glossary terms** — Upstream, Consumer, CORE, STARTER, Delta, Redaction review.
- **RISKS 31–34** (outbound leak; fleet-wide bad-release propagation; upstream PR spam; fork/auth unavailability) + v0.9.0 extensions to Risks 22 (auto-sync × review-history overlap) and 23 (single-scheduler convention).

### Changed

- Root `CLAUDE.md.jinja` "Self-improving" principle, `README.md.jinja` self-improvement section, and `coo.md` delegation line — all three copies of "owner agents propose deltas to their own PROCESS.md" now route through `review-history` triage (CORE targets go upstream, never edited locally).
- `README.md.jinja` "Updating from upstream" — now three ways (auto-sync / check-for-updates+sync-from-core / GH Action) with the one-driver-per-repo rule; new "The self-improvement loop" section (anonymization guarantees + GitHub account-attribution disclosure + authority exception + non-interactive permissions).
- `chief-of-staff.md` — `owns_processes` 10 → 12 (adds `auto-sync`, `propose-to-core`); Framework-expertise counts 21 → 24 skills (12 owned + 11 framework-wide + 1 dept-scoped), 13 → 14 agents, templates corrected to 15 (the "9" was stale — 14 files pre-v0.9.0); Permission tiers gain the scheduled-run authority exception.
- `coo.md` — `owns_processes` adds `review-history`; process-improvement mandate now names its mechanism.
- `sync-from-core/SKILL.md` — the `--trust` note names all THREE sync drivers; `.github/workflows/sync-opos.yml` header carries the mutual-exclusion note.
- `copier.yml` — `_exclude` adds `docs/**` (framework SDLC docs) and `**/proposals/202[0-9]-*.md` (redaction-failed drafts must never ship); `_skip_if_exists` adds the proposal LEDGER.
- `ui/tests/test_scheduled_run_schema.py` — 11 → 13 expected fields + type assertions for the new optional pair.

### Migration

For existing consumers (STARTER/consumer-owned files the sync will NOT touch — apply by hand after `copier update`):

1. **Glossary** — add the six new terms to your `company/knowledge-base/glossary.md` (copy from a fresh scaffold or the upstream file).
2. **Root `CLAUDE.md`** — add the two schema lines (`delta_target`, `upstream_pr`) to your "Self-improvement log schema" section, and reword your "Self-improving" operating principle to route through `review-history` (see `CLAUDE.md.jinja` upstream for the exact text).
3. **Settings** — nothing to pre-add: `/schedule-process` proposes the narrowly-scoped allow entries at registration time; confirm them there.
4. **Charters propagate automatically** — `.claude/agents/company/**` is CORE (only `engineering/**` and `rnd/**` agents are consumer-owned), so the chief-of-staff/coo updates arrive via `copier update`. If you have LOCAL edits to those two charters, expect `.rej` files on this sync and merge by hand.
5. **Activate the loop** — `/schedule-process auto-sync` and `/schedule-process review-history`, on exactly ONE machine per company (Risk 23).

### Notes

The loop was dogfooded end-to-end before release: the framework's own first consumer ran `review-history` against a real `status: open` delta and produced the first genuine `[opos-core]` PR via `propose-to-core`. Minor bump: new capability, no breaking changes; v0.8.x consumers receive everything via `copier update` (plus the Migration steps above for their consumer-owned copies).

## [0.8.1] - 2026-08-19

### Fixed

- **Framework README no longer leaks into consumer scaffolds** (#20). The template root carried both `README.md` (the framework's own GitHub readme) and `README.md.jinja` (the consumer readme); both rendered to the same destination and the winner was filesystem-walk-order dependent — consumers scaffolded since v0.7.2 could receive the framework marketing readme verbatim (observed in practice on a fresh v0.8.0 scaffold). Adding `README.md` to `_exclude` is NOT a viable fix: Copier matches `_exclude` against the **rendered destination path**, so it would drop the `.jinja` output too (verified empirically). Instead the framework readme moved to `.github/README.md` — which GitHub prefers for repo display, so the repo homepage is unchanged — and the hero image to `.github/images/`; both are excluded in `copier.yml`, whose header now documents the collision hazard so a future bare-root file cannot reintroduce it. `.github/workflows/sync-opos.yml` still ships to consumers. Render-verified: `copier copy` on this commit produces the correct consumer README, no leaked framework files, no empty directories, Jinja substitution intact.

### Notes

No template content changes for consumers beyond the fix — existing consumers who already received a wrong `README.md` should re-render it from `README.md.jinja` (or take it via `copier update`). Patch bump; no breaking changes.

## [0.8.0] - 2026-06-26

### Added

- **`design-subdept` skill** — the 4th and final org-chart-shape primitive after `design-process` (v0.1.0), `design-agent` (v0.4.0), and `design-department` (v0.5.3). Owned by `ops-manager`. Creates a sub-dept under an existing top-level dept (e.g., `compliance` under `legal`, `data` under `rnd`) with REAL folder nesting at `departments/<parent>/<sub>/`. Charter cascade-inherits from parent + root. 12-step procedure mirroring `design-department`: parent-dept validation + name validation (5 conditions including cross-collision against the to-be-written `<sub-name>-lead` agent file); consult parent-lead + coo + optional peer; draft charter; present + iterate to approval; write the single charter file + emit `/design-agent` recommendation for the sub-lead (NOT auto-invoke; v0.5.1 anti-pattern). Sub-sub-depts (depth > 2) intentionally NOT supported — step 4 ABORT offers two recovery paths (promote-to-top-level OR use sub-role agent). Closes RISKS Risk 8 fully-fully (third + final tier).
- **`shared/templates/SUBDEPT.md.tmpl`** — forked from `DEPARTMENT.md.tmpl`. Same 6 substitution tokens from the parent template PLUS a new `<<PARENT_DEPT>>` token (7 tokens total). The fork was REQUIRED per plan-critic CRITICAL finding: `DEPARTMENT.md.tmpl`'s depth-2 relative paths (`../../company/CLAUDE.md`, `../../.claude/agents/<<DEPT_NAME>>/...`) would produce BROKEN LINKS from a sub-dept charter at depth-3 — every relative reference needed `../../../`. The fork keeps both templates simple at the cost of duplication; rejected alternative was brittle post-render path surgery. Ships as CORE (NOT in `copier.yml _skip_if_exists`).

### Changed

- `.claude/agents/company/ops-manager.md` — `owns_processes:` 6 → 7 (adds `design-subdept`). Role narrative gains a v0.8.0 paragraph: "ops-manager owns the COMPLETE org-chart-shape design family: design-process + design-agent + design-department + design-subdept. The quartet covers every primitive a founder might need to grow the org chart from natural-language input." Delegation pattern + Owned-processes sections updated.
- `.claude/skills/design-department/SKILL.md` — 4 places updated (per plan-critic count, not 3): line 21 paragraph rewritten (sub-depts are first-class as of v0.8.0; sub-role-agent vs. sub-dept decision tree); step 4 ABORT message rewritten (directs to `/design-subdept` with concrete `--parent` invocation); failure-modes "Sub-dept requested" entry rewritten (recovery is now `/design-subdept`); Related section gains a `design-subdept` cross-reference + Closes line updated to note v0.8.0 fully-fully closure.
- `.claude/agents/company/chief-of-staff.md` Framework expertise — "All 20 v0.6.1 skills" → "All 21 v0.8.0 skills" with `design-subdept (NEW v0.8.0)` marker. Skill-count math: 10 owned + 10 framework-wide + 1 dept-scoped (deploy) = 21.
- `README.md.jinja` — 8th "How to use OPOS day-to-day" example added: "We need a compliance sub-dept under legal" routes through `ops-manager` → `/design-subdept` → consultations with `legal-lead` + `coo` → charter from `SUBDEPT.md.tmpl` with sub-dept escalation chain → `/design-agent` recommendation for `compliance-lead` → files written under `departments/legal/compliance/`. Notes the org-chart-shape family is now COMPLETE.
- `RISKS.md.jinja` Risk 8 — title appended "or sub-dept structure" (now 3-class); status "FULLY CLOSED in v0.5.3" → "FULLY CLOSED in v0.8.0 (third + final tier)"; cross-references all 3 closing skills. New v0.8.0 resolution paragraph: full `design-subdept` overview; SUBDEPT.md.tmpl fork rationale; escalation chain detail; sub-sub-dept non-support with recovery; plan-critic re-discipline note. Closes with "the org-chart-shape design family is now COMPLETE" + quartet enumeration.

### Notes

Closes Koroqe/OPOS#18. **The org-chart-shape design family is COMPLETE.** ops-manager owns all 4 primitives (skills via `design-process` v0.1.0; agents via `design-agent` v0.4.0; top-level depts via `design-department` v0.5.3; sub-depts via `design-subdept` v0.8.0). RISKS Risk 8 fully-fully closed across all 3 tiers. The framework can now generate every org-chart-shape primitive a founder might need from natural-language input.

**Plan-critic discipline RE-ESTABLISHED for v0.8.0** after a 3-release skip (v0.7.0 + v0.7.1 + v0.7.2 all skipped because of small surface area / hygiene-only work). The critic round caught **2 CRITICAL findings** that would have shipped broken charters: (1) `DEPARTMENT.md.tmpl` has depth-2 hardcoded paths that render BROKEN LINKS from a depth-3 sub-dept charter — resolved by forking the template to `SUBDEPT.md.tmpl` with depth-3 paths; (2) the original draft used `<<DEPT_NAME>> = <parent>/<sub>` substitution which produced a Roles bullet pointing at `.claude/agents/legal/compliance/compliance-lead.md` while the actual lead lives FLAT at `.claude/agents/legal/compliance-lead.md` — resolved by splitting into two pure-slug tokens (`<<PARENT_DEPT>>` + `<<SUB_NAME>>`). Plus 5 MAJOR findings (collision-check missed `-lead` suffix; `.claude/agents/<parent>/` may not exist; sub-sub-dept ABORT wording; design-department line 137 not enumerated; slash semantics divergence) and 5 MINOR — all addressed before execution. **The critic round paid for itself.** Worth maintaining for v0.8.x+ substantive work.

No breaking changes; minor bump for the new capability (new skill + new template + sub-dept folder convention). Backwards-compatible: existing v0.7.x consumers receive `design-subdept` + `SUBDEPT.md.tmpl` via `copier update`.

## [0.7.2] - 2026-06-25

### Added

- **`requirements-dev.txt`** — pinned Python dev-deps required for `ui/tests/`, `ui/smoke.sh`, and `release-from-changelog`'s pre-release scaffold check. Range pins (`>=X.Y,<X+1.0`) cover `markdown` (used by `ui/render.py`), `copier` (used by `release-from-changelog` step 5), `pyyaml` (used by `ui/data.py` + `ui/scheduling.py` + multiple tests), `jinja2` (used by `ui/render.py`; Copier transitive but explicit-pinned for safety). Ships as CORE (NOT in `copier.yml` `_skip_if_exists`); existing v0.7.x consumers receive it via `copier update`.
- **`MAINTAINER.md` "Testing locally" section** gains a "Dev-deps prerequisite (v0.7.2+)" subsection documenting `pip install -r requirements-dev.txt` workflow, which deps go where, and why the prereq exists (catches the v0.7.0 + v0.7.1 fresh-machine failures at root).

### Fixed

- **`task-complete` step 14 + `task-pause` step 5 rewritten with Python one-liner.** The v0.7.0 shell pattern was:
  ```bash
  grep -v "^${VAR}$" .current-task > .current-task.tmp && mv .current-task.tmp .current-task
  ```
  This was reproducibly flaky — surfaced in v0.7.0 Slice 10 task-complete (closing #15) AND v0.7.1 Slice 4 task-complete (closing #16). Same failure pattern in both: first invocation leaves the file unchanged; manual standalone re-execution of `grep -v` works. Root cause unknown (possibly Bash variable expansion in the `"^${VAR}$"` pattern, redirect timing inside `&&`, or filesystem-cache hiccup). Both SKILL.md steps now use a Python one-liner: single process (no `&&` chain), env-passed variable values (no shell-quoting issues with `${VAR}$`), atomic write semantics (`open(target, "w")` truncates+writes in one syscall), defensive `os.path.exists` short-circuit. Identical semantics to v0.7.0 — only the execution mechanism is more robust. v0.7.0 + v0.7.1 history entries remain as immutable audit trail; the fix only affects v0.7.2+ invocations. **Slice 7 of this release is the validating exercise** — first task-complete under the new logic must work on first invocation; if retry needed, v0.7.3 candidate.

### Changed

- **`release-from-changelog` step 5 auto-installs `requirements-dev.txt`** before the scaffold check. Wraps with `|| warn-and-continue` so a broken pip doesn't hold the release pipeline hostage. New failure mode entry documents the cascade (`pip install` failed → scaffold check likely also fails → operator fixes env post-release).
- **`ui/smoke.sh` gains 8 dept-badge CSS rule assertions** — 7 starter depts (`company`, `rnd`, `finance`, `people`, `legal`, `commercial`, `pr`) checked for `data-dept="${dept}".*background` rules, plus 1 fallback assertion verifying `.dept[data-dept] { ... background: ... }` exists on the base rule. Catches the v0.7.1 white-on-white bug class: CSS structure regressions that pass the `/static/console.css` 200-status check but break visual rendering. Smoke count: 16/16 → **24/24 PASS**.

### Notes

Closes Koroqe/OPOS#17. **Pipeline-quality hygiene release.** 3 sub-items each addressed at root rather than mitigated: the `task-complete` step-14 reproducible anomaly that surfaced TWICE in v0.7.x is now eliminated at root via the Python one-liner; fresh machines can `pip install -r requirements-dev.txt && bash ui/smoke.sh && python3 -m unittest discover ui.tests && python3 ui/console.py` without per-package debugging; visual regression for CSS rule presence is now smoke-asserted (catches the v0.7.1 white-on-white bug class pre-release). No breaking changes. **Smallest substantive update in v0.7.x** — 1 new file + 7 updated, narrow edits per file.

## [0.7.1] - 2026-06-12

### Fixed

- **Console dept-badge rendered white-on-white for v0.5.1+ starter depts.** `ui/static/console.css` set `color: white` for all `.dept[data-dept]` badges, but the per-dept background-color rules only covered the stale pre-v0.5.1 dept names (`company`, `engineering`, `rnd`, `sales`, `marketing`, `ops`). The 5 v0.5.1+ starter depts NOT in that stale set (`finance`, `people`, `legal`, `commercial`, `pr`) fell through → white text on white page background → invisible. Visible on every v0.5.1+ consumer's `/agents` page and anywhere else the dept badge renders.
  - **Fix part 1:** added `background: var(--fg-dim)` as a default fallback on the base `.dept[data-dept]` rule. Any unmapped dept (e.g., one created via `/design-department`) now renders with a neutral grey background instead of invisible.
  - **Fix part 2:** mapped the 5 v0.5.1+ starter depts to the 6-color `dept_cycle` from `.claude/task-tracking.config.json` — `finance` → dept-2 (yellow + dark text for contrast); `people` → dept-4; `legal` → dept-5; `commercial` → dept-6; `pr` → dept-1 (cycles back since `pr` + `company` rarely appear adjacent).
  - **Fix part 3:** retained legacy `engineering`/`sales`/`marketing`/`ops` rules so consumers who haven't run `copier update` since pre-v0.5.1 still render correctly.

### Notes

Closes Koroqe/OPOS#16. **Bug-class observation:** CSS rendering quality isn't asserted by the unittest + smoke suite — this bug was discovered by user eyeball during live browser review of the v0.7.0 console. Worth noting as a v0.7.x candidate: visual regression test or `curl`-grep on rendered HTML asserting specific CSS classes work end-to-end. Single-file fix; no breaking changes; no schema changes. Demonstrates the release pipeline scales down to trivial patches as well as up to architectural beats.

## [0.7.0] - 2026-06-10

### Changed

- **`.current-task` is now a newline-delimited array of active issue numbers** (was: single-value file). Matches the existing `.paused-tasks` array pattern. **Backwards-compatible:** v0.6.x single-line content parses correctly as a 1-element array — no migration step required. Multi-active tasks are first-class as of this release; parallel Claude Code sessions can each open + close their own task without colliding.
- `.claude/skills/task-register/SKILL.md` — Step 4 was "refuse-on-exists" (the v0.6.x guard blocking parallel sessions); now "Parse current active-task array" with defensive read-side filtering. Continue regardless of count. Step 10 was `echo $ISSUE_NUM > .current-task`; now `echo $ISSUE_NUM >> .current-task` with duplicate-check. Failure modes section's "`.current-task` already exists" entry REPLACED with "Duplicate issue in active list" (skip + partial outcome, not refuse). History entry now records pre/post `.current-task` array contents for audit.
- `.claude/skills/task-update/SKILL.md` — Step 3 array-aware: auto-picks when exactly 1 entry; aborts with `Multiple active tasks: #<comma-list>. Pass --issue <N>` when 2+ entries and no `--issue` override. v0.6.x single-task behavior preserved as a special case.
- `.claude/skills/task-complete/SKILL.md` — Step 3 array-aware (same pattern as task-update). Step 14 was unconditional delete; now removes the specific completed issue from the array via `grep -v "^${ISSUE_NUM}$"` + optional `rm` if the file becomes empty. v0.6.1 `git mv` for `tasks/<n>.md` archival preserved unchanged.
- `.claude/skills/task-pause/SKILL.md` — Step 2 array-aware (Inputs gains optional `--issue`). Step 5 was unconditional delete; now removes the specific paused issue from the array via the same `grep -v` pattern. Other active tasks in the multi-active workflow are untouched.
- `.claude/skills/task-resume/SKILL.md` — Step 2's pre-v0.7.0 "verify `.current-task` absent" guard REMOVED — multi-active tasks are first-class. Step 5 was `echo $ISSUE > .current-task` (overwrite); now `echo $ISSUE >> .current-task` (append). Step 6's task-update call now passes `--issue $ISSUE_NUMBER` explicitly to avoid the new multi-active disambiguation guard.
- `.claude/agents/company/chief-of-staff.md` — Goal decomposition pattern + First-touch behavior + Owned-processes descriptions all updated for v0.7.0 array semantics. First-touch greeting template gains pluralization variant: `Active tasks: #N₁ — <title₁>, #N₂ — <title₂>, ...` for multi-active workflow (vs `Active task: #N — <title>` for single-task v0.6.x-compatible workflow). Step 4 now iterates `gh issue view` per task (was: ONE task); performance note added for future batch-fetching candidate.
- `README.md.jinja` "How to use OPOS day-to-day" — 7th example bullet added (parallel terminal workflow demonstrating both `/task-register` calls succeeding + each session's First-touch greeting seeing both tasks).
- `RISKS.md.jinja` — **Risk 15 updated** (the actual state-file per-machine risk; Risk 23 is about scheduled-process per-machine state, which is a different concern): "Single-machine parallel-session collision CLOSED in v0.7.0 via the `.current-task` array conversion. Cross-machine state sharing remains the v0.8.x+ work item." **New Risk 30 added** (Intra-machine concurrent-register race; LOW impact; defensive read-side filtering mitigates; future `flock`-based locking is v0.8.x candidate).

### Notes

Closes Koroqe/OPOS#15. **Multi-active-task support landed** — the architectural concern surfaced in this session (parallel Claude Code sessions colliding on `.current-task`) is resolved. Backwards-compatible: existing v0.6.x consumers' single-line `.current-task` content parses as a 1-element array; no migration step. Claude Code provides no session identifier so cross-session race on concurrent `task-register` IS possible but window is small and defensive read-side filtering (drop non-digit lines, dedupe issues at read time) mitigates. **Survey-confirmed isolation:** scheduled-vs-manual architecture untouched (scheduled processes write to `scheduled-runs/`, never touch `.current-task`, use `--issue` overrides for GitHub issue work). Console UI also unaffected (zero `current-task` references in `ui/`). Cross-machine coordination still deferred (Risk 23 unchanged for that dimension). Why minor-bump (0.7.0): semantic contract of `.current-task` changes from "single value, second register refuses" to "array, second register appends" — consumers scripting against the file should be aware. No new files; no new skills.

## [0.6.1] - 2026-05-31

### Added

- **`deliberate-decision` skill** — the framework's missing agent-to-agent critique loop, owned by `coo`. Multi-round propose → critique → revise pattern for high-level company decisions (strategic direction, hiring, market entry, major policy changes). 12-step procedure:
  - **Direct parallel Task calls** for round-N critiques (one per critic — all 6 dept-leads + escalation-target), executed in a SINGLE executor message so they run concurrently. **NOT** through `consult-agent` middleware: `consult-agent` is a skill, not an agent — `Task → skill` doesn't work. The simulation prompt template is reproduced INLINE.
  - **Round-N critic-memory:** each round-N critic receives, as part of the prompt, their own round-(N-1) stance + the proposer's specific response to them. Prevents re-raising already-addressed concerns across rounds.
  - **STANCE parser** (`re.compile(r"^STANCE:\s*(AGREE|CONCERNS|BLOCKER)\s*$", re.MULTILINE)`) with PARSE_FAILED → CONCERNS (critic-side) / DEFER (arbiter-side); UNAVAILABLE classification for failed Task calls (silence is NOT endorsement).
  - **All-AGREE early-exit** at round 1 short-circuits to arbiter.
  - **`/tmp/deliberation-<decision_id>.md` persistence** between rounds — executor reads from disk for the arbiter prompt + artifact render rather than holding the full log in working memory.
  - **Verbatim ESCALATION dict** (verified against agent files): eng-lead → rnd-lead; rnd-lead + finance-lead → coo; people/legal/commercial/pr-lead → ceo; coo → ceo; ceo → None (self-arbitrates with a prepended warning).
  - **UUID-suffixed decision_id** (`<slug>-<6char-uuid>` via Bash `uuidgen`) — collision-free across machines / rapid succession.
  - **Human-in-the-loop at step 12:** user APPROVE → artifact written + tmp cleaned; REJECT → tmp cleaned, partial outcome history; REQUEST_ANOTHER_ROUND → loop (absolute cap 5 rounds total).
  - **mkdir -p company/decisions/** before write — handles old consumers who scaffolded pre-v0.6.1.
- **`shared/templates/decision.md.tmpl`** — 10-field frontmatter (date, time, decision_id, proposer, critics, arbiter, rounds_run, verdict, tags, early_exit_at_round) + body sections (Proposal, Round N × M, Arbiter verdict, Rationale, Follow-ups, Audit). Audit section explicitly notes deliberation-induced Task calls do NOT write to `consult-agent/history/`.
- **`company/decisions/` folder convention** — sibling to backlog/strategy/policies/knowledge-base/hiring. Ships with README + `.gitkeep` as framework CORE (propagates to existing v0.6.0 consumers via `copier update`); per-decision dated files (`202[0-9]-*.md`) are runtime-only and excluded.

### Changed

- `.claude/agents/company/coo.md` — `owns_processes:` `[company-setup]` → `[company-setup, deliberate-decision]`. Role narrative gains v0.6.1 paragraph; Outputs gains 4th bullet on decision artifacts; Owned processes gains `deliberate-decision` entry.
- `README.md.jinja` — "How to use OPOS day-to-day" gains a 6th example (Berlin sales-office hypothetical → coo → deliberate-decision → arbiter → artifact). Inline cost note: "~15 consult-agent-pattern Task calls per deliberation; trigger only for decisions whose stakes justify the cost."
- `.claude/agents/company/chief-of-staff.md` Framework expertise bullet — `"All 16 v0.5.3 skills"` → `"All 20 v0.6.1 skills"`. Backfills the v0.6.0 omission (3 scheduling skills) AND adds `deliberate-decision (NEW v0.6.1)`. Skill-count math explicitly: 10 owned + 9 framework-wide + 1 dept-scoped (deploy) = 20. owns_processes UNCHANGED (Framework expertise is a knowledge claim, not ownership).
- `copier.yml` — `_exclude` adds `company/decisions/202[0-9]-*.md` (per-adopter decision artifacts).
- **`.claude/skills/task-complete/SKILL.md` step 13 — `mv` → `git mv`** (bonus fix). Closes the v0.5.3 / v0.6.0 dual-tracking bug at root: plain `mv` left `tasks/<n>.md` tracked alongside `tasks/closed/<n>.md` in HEAD, requiring retroactive cleanup commit `b775b0f`. `git mv` stages the deletion atomically; backwards-compat fallback to `mv` semantics if file is untracked.
- `RISKS.md.jinja` — new Risk 27 (deliberation cost burn).

### Notes

Closes Koroqe/OPOS#14. **The framework gains agent-to-agent deliberation** — the propose→critique→revise loop that's been load-bearing on 6 consecutive releases via plan-critic is now a first-class company process for high-level decisions. Cost: ~15 subagent invocations per default 2-round deliberation (Risk 27). Plan-critic + post-ExitPlanMode pressure-test load-bearing for 7 consecutive releases (v0.4.0 through v0.6.1) — this release's plan went through both layers: plan-critic surfaced 27 findings (including a CRITICAL ESCALATION-dict-wrong: people/legal/commercial/pr-lead escalate to CEO, not COO); pressure-test surfaced 8 architectural issues (direct-Task-vs-consult-agent ambiguity, tmp-file persistence, round-N critic-memory, etc.). **New convention candidate this release:** post-ExitPlanMode pressure-test for any skill that orchestrates multi-step subagent work — plan-critic catches paper-level issues, pressure-test catches execution-mechanics issues. No breaking changes.

## [0.6.0] - 2026-05-30

### Added

- **Scheduling mechanism** — three new `ops-manager`-owned skills that turn OPOS from request-driven to autonomous-capable. Any process with the 4 optional scheduling frontmatter fields (`schedule`, `runtime`, `non_interactive`, `authority`) can fire on a cron schedule via Claude Code's built-in cron tools:
  - `/schedule-process <name>` — wraps `CronCreate`. Validates frontmatter, composes a routine prompt with an authority prelude (declared-contract enforcement via prompt injection + in-band self-check), registers the routine, caches the routine id locally. Idempotent (no-op on re-run with no diff; confirm-on-diff for updates). Partial-failure rollback: if local cache write fails after live `CronCreate` succeeds, attempts `CronDelete` automatically; if that fails, prints orphan routine id for manual cleanup.
  - `/unschedule-process <name>` — wraps `CronDelete`. Cache fast-path with `CronList` fallback for fresh-machine bootstrap. Leaves source PROCESS.md frontmatter untouched (re-activate via `/schedule-process` without re-editing). Idempotent (no-op if not scheduled).
  - `/list-scheduled-processes` — wraps `CronList`. Read-only drift detection: classifies each row as OK / MISSING / ORPHAN / DRIFT / INVALID_INTENT. CronList is authoritative — fresh-machine safe. Warns on overlapping cron times (file-conflict risk).
- **`ui/scheduling.py`** — new Python module (sibling to `ui/validate.py`). Exposes `validate_frontmatter(process_md_path) -> (ok, errors)` enforcing 5 rules: all-or-nothing (4 fields must move together), 5-field POSIX cron format + reject every-minute, runtime allow-list (`claude-schedule` only in v1), `non_interactive` literal boolean (not string), `authority` non-empty list with allow-list members and `read_only` mutex.
- **`shared/templates/scheduled-run.md.tmpl`** — new per-run record template. 11-field schema (superset of history): `date`, `run_id`, `skill`, `triggered_by: schedule`, `outcome`, `duration_min`, `authority_declared`, `authority_used`, `verification_state` (unverified | verified — human marks verified after first review), `proposed_delta`, `status`.
- **`scheduled-runs/` folder convention** — sibling to `history/`, never mixed. Scheduled invocations write to `scheduled-runs/`; manual invocations continue writing to `history/`. Split keeps daily-cron noise from drowning out rare manual process-improvement signal.
- **Design-time integration** — `/design-process` step 7 now enumerates 4 trigger-mechanism options (was 3): manual / hook-driven / hybrid / **scheduled (cron-driven)**. Picking "scheduled" populates the 4 frontmatter fields and eager-creates `scheduled-runs/.gitkeep`.
- **`ui/tests/test_scheduling.py`** — 11 unittest fixtures (manual-only valid + 10 validation cases).
- **`ui/tests/test_scheduled_run_schema.py`** — 5 unittest fixtures asserting template schema parses + all 11 fields present + `triggered_by` literal `schedule`.

### Changed

- `shared/templates/PROCESS.md.tmpl` — 4 commented-out scheduling frontmatter fields added under `state_schema`; new "Scheduled runs" body section documenting the 11-field per-run schema and the prelude-string convention for distinguishing scheduled vs manual at run time.
- `.claude/agents/company/ops-manager.md` — `owns_processes:` extended from 3 (`[design-process, design-agent, design-department]`) to 6 (adds `schedule-process`, `unschedule-process`, `list-scheduled-processes`). Role narrative + delegation pattern + Owned processes section all updated. ops-manager now owns BOTH meta-design family AND meta-scheduling family.
- `.claude/skills/design-process/SKILL.md` — steps 6 + 7 + 9 updated for the new "scheduled" trigger option (populate 4 fields; eager-create `scheduled-runs/.gitkeep`). PROCESS.md step summary mirrors.
- `CLAUDE.md.jinja` — addendum to "Self-improvement log schema" documenting `scheduled-runs/` folder convention.
- `copier.yml` — `_exclude` adds `**/scheduled-runs/202[0-9]-*.md` (runtime entries, never shipped) + `.claude/scheduled-processes.json` (per-machine cache).
- `.gitignore` — same patterns.
- `MAINTAINER.md` — "Adding runtime state" section gains v0.6.0 subsection documenting the new paths + the Claude Code internal-tool-name dependency.
- `README.md.jinja` — new "Scheduling processes" section between "How to use OPOS day-to-day" and "Updating from upstream"; documents the 4 frontmatter fields with copy-paste example, the 3 skills, the design-time integration, the declared-contract semantics of `authority:`, the `scheduled-runs/` vs `history/` split, and a 10-use-case condensed narrative.
- `RISKS.md.jinja` — 9 new risks (18-26): Authority is declared contract (HIGH, documented limitation); Subscription quota burn; Silent cloud failures; Manual-vs-scheduled behavior divergence; Concurrent-run collisions; Live registrations per-machine; Drift between PROCESS.md and live; Partial-failure during schedule-process; Tool-name dependency on Claude Code internals.

### Notes

Closes Koroqe/OPOS#13. **OPOS becomes autonomous-capable.** This is the first release where the framework can run unattended — weekly metrics reports, monthly summaries, scheduled audits all fire without an open Claude Code session. Architecturally significant: ops-manager now owns 6 skills (3 meta-design + 3 meta-scheduling) and is the single owner of the framework's two self-extension axes (what processes exist; when they run). Plan critic load-bearing for 6 consecutive releases (v0.4.0 + v0.5.0 + v0.5.1 + v0.5.2 + v0.5.3 + v0.6.0); pre-execution tool-name validation (new convention this release) caught a critical brainstorm-plan naming error (`create_scheduled_task` → `CronCreate`) before any wrapper SKILL.md was written — saving 3 wrapper files from being wrong. `authority:` v1 enforcement is a declared contract (prompt injection + in-band self-check), NOT a runtime sandbox; post-run guard deferred to v2. No breaking changes (all 4 scheduling frontmatter fields are optional collectively); existing v0.5.x consumers receive the new skills + template + ui/scheduling.py + design-process update automatically via `copier update` (`.claude/skills/`, `shared/templates/`, `ui/` are NOT in `_skip_if_exists`).

## [0.5.3] - 2026-05-30

### Added

- **`design-department` skill** — third member of the `design-*` family (after `design-process` v0.1.0 and `design-agent` v0.4.0). Closes the final org-chart-expansion gap; RISKS Risk 8 is now **FULLY CLOSED**. Owned by `ops-manager`. Top-level depts only; sub-depts deferred to a future `design-subdept` skill.
  - **12-step procedure** mirroring `design-agent`'s structure: framework read → dept-intent parse → name + slug + reserved-list validate → top-level placement → lead-agent decision → `consult-agent` calls (ceo + coo always; one optional dept-lead/sub-lead) → artifact-type capture → draft from `DEPARTMENT.md.tmpl` → present → iterate → approval gate → write the charter (ONLY the charter — no auto-scaffold of `data/` or `backlog/` subdirs, matching 5 of 6 v0.5.1 starters) → history entry.
  - **Context-detected charter suffix.** 2-stat check: `copier.yml` at repo root AND root `CLAUDE.md.jinja` present → framework context (write `.md.jinja`); otherwise consumer context (write `.md`).
  - **Verbatim slug regex** `^[a-z][a-z0-9-]{0,63}$` (matches `ui/validate.py:_SLUG_RE` line 15 exactly). Earlier design-* skills' `{1,62}` documentation drift acknowledged but not retroactively corrected (out of v0.5.3 scope).
  - **Framework-reserved dept-name list** `{rnd, finance, people, legal, commercial, pr, engineering, company}` blocks adding a parallel `engineering/` dept (the v0.5.1 merge folded engineering under `rnd`). Exact whole-string equality; sub-tokens like `customer-success` are allowed.
  - **Lead-agent step 5** asks the user (default yes); the skill EMITS a `/design-agent` recommendation at step 11 for the user to invoke in the next turn — does NOT auto-invoke per the v0.5.1 `allocate-resource` anti-pattern (the `Task` tool spawns subagents but cannot execute slash commands).
  - **Sub-dept ABORT** at step 4 with a pointer to `/design-agent` for sub-lead patterns under existing depts.

### Changed

- `ops-manager.md` `owns_processes:` extended `[design-process, design-agent]` → `[design-process, design-agent, design-department]`. Body Role narrative adds the "As of v0.5.3, ops-manager owns the FULL design family" sentence. New delegation-pattern bullet for new-department gaps. Escalation rules case (a) reworded from "department creation out of scope" to "user rejects a `design-department` proposal" — the tooling gap is gone; escalation now fires only on user rejection.
- `RISKS.md` Risk 8 — status flipped from `**CLOSED in v0.4.0**` to `**FULLY CLOSED in v0.5.3**`. Risk title widened from "cannot create new agent roles" to "cannot create new agent roles or new dept charters". New v0.5.3 Resolution paragraph mirrors the v0.4.0 one with full implementation detail (12 steps, context-detection, reserved list, emit-not-invoke pattern). Sub-dept gap explicitly noted as the future `design-subdept` candidate.
- `design-process/SKILL.md` Failure modes — "new agent role required" branch's dept-charter sub-clause now invokes `design-department` inline instead of escalating to `coo`. `coo` escalation preserved as fallback when the user rejects the dept design.
- `README.md.jinja` "How to use OPOS day-to-day" — added a 5th example user prompt ("We need a customer-success department" → ops-manager → design-department → consultations → charter + lead-agent same-session) between the marketing-analyst and deploy-status examples.
- `chief-of-staff.md` Framework expertise bullet — skill count `15 v0.5.1` → `16 v0.5.3`; `design-department (NEW v0.5.3)` highlighted in the listing.

### Notes

Closes Koroqe/OPOS#12. **The full design family is now operational** — `ops-manager` can generate any framework primitive (skill via `design-process`, agent via `design-agent`, dept via `design-department`) from natural-language input. The framework's self-extension loop is fully closed at the org-chart level. Plan critic load-bearing for 5 consecutive releases (v0.4.0 + v0.5.0 + v0.5.1 + v0.5.2 + v0.5.3): 13 findings this round (0 critical, 5 major, 8 minor); all CRITICAL/MAJOR addressed in-plan before execution. No breaking changes (patch); `.claude/skills/` is NOT in `_skip_if_exists` so existing v0.5.0/v0.5.1/v0.5.2 consumers receive `design-department` automatically via `copier update`.

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

[0.9.1]: https://github.com/Koroqe/OPOS/releases/tag/v0.9.1
[0.9.0]: https://github.com/Koroqe/OPOS/releases/tag/v0.9.0
[0.8.1]: https://github.com/Koroqe/OPOS/releases/tag/v0.8.1
[0.8.0]: https://github.com/Koroqe/OPOS/releases/tag/v0.8.0
[0.7.2]: https://github.com/Koroqe/OPOS/releases/tag/v0.7.2
[0.7.1]: https://github.com/Koroqe/OPOS/releases/tag/v0.7.1
[0.7.0]: https://github.com/Koroqe/OPOS/releases/tag/v0.7.0
[0.6.1]: https://github.com/Koroqe/OPOS/releases/tag/v0.6.1
[0.6.0]: https://github.com/Koroqe/OPOS/releases/tag/v0.6.0
[0.5.3]: https://github.com/Koroqe/OPOS/releases/tag/v0.5.3
[0.5.2]: https://github.com/Koroqe/OPOS/releases/tag/v0.5.2
[0.5.1]: https://github.com/Koroqe/OPOS/releases/tag/v0.5.1
[0.5.0]: https://github.com/Koroqe/OPOS/releases/tag/v0.5.0
[0.4.0]: https://github.com/Koroqe/OPOS/releases/tag/v0.4.0
[0.3.1]: https://github.com/Koroqe/OPOS/releases/tag/v0.3.1
[0.3.0]: https://github.com/Koroqe/OPOS/releases/tag/v0.3.0
[0.2.0]: https://github.com/Koroqe/OPOS/releases/tag/v0.2.0
[0.1.1]: https://github.com/Koroqe/OPOS/releases/tag/v0.1.1
[0.1.0]: https://github.com/Koroqe/OPOS/releases/tag/v0.1.0
