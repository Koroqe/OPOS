# Test Cases: Bidirectional Self-Improvement Loop (v0.9.0)

> Based on [PRD](../PRD.md) §1 (FR-A1–FR-H7, NFR-1–NFR-8) and [Use Cases](../use-cases/self-improvement-loop_use_cases.md) (UC-1 through UC-28). Source of truth on any conflict: the approved plan `since-we-are-working-tranquil-sunrise.md`.

---

## Overview

This document maps every use-case scenario (UC-1 through UC-28, including all alternative, error, and edge-case flows) to specific, executable test case specifications for the self-improvement loop feature: three new CORE skills (`auto-sync`, `review-history`, `propose-to-core`), one new company-tier agent (`redaction-reviewer`), schema extensions, and the Restaba dogfood.

This is a markdown-skill framework, not an application — there is no conventional application test runner. "Tests" here are mechanical checks across six kinds:

- **unit** — the Python unittest suite in `ui/tests/` (only `test_scheduled_run_schema.py` changes: `EXPECTED_FIELDS` 11 → 13 fields)
- **validator** — `ui/scheduling.py`'s `validate_frontmatter`, invoked as `python3 -c 'from pathlib import Path; from ui.scheduling import validate_frontmatter as v; print(v(Path("<PROCESS.md>")))'`, expecting the literal `(True, [])`
- **scaffold** — `copier copy` to a temp dir; assert file presence/absence
- **dry-run fixture** — `/auto-sync --dry_run`, `/review-history --dry_run`, `/propose-to-core --dry_run` against a fixture-pinned scratch scaffold or fixture entry set
- **red-team** — adversarial fixture drafts fed to `redaction-reviewer`, asserting `REDACTION: PASS`/FAIL and finding classes
- **e2e** — the real Restaba dogfood (Phase R), executed once, against real GitHub state

**Priority Legend:**
- **P0** — release-gating; appears in the plan's U11 verification gate list, or is a hard mechanical precondition for a later P0 (e.g. classification before triage). Must pass before `/release-from-changelog` v0.9.0.
- **P1** — Phase R rehearsal (R1–R6) or a specified fallback/degradation path exercised only in the dogfood or via fixture; important but not blocking the upstream release itself.
- **P2** — nice-to-have; documentation-consistency checks, INFO-tier hardening, or low-probability edge combinations.

**Test Type Legend:** unit / validator / scaffold / dry-run fixture / red-team / e2e (see Overview above).

---

## 1. `auto-sync` — Core Pull Flow (UC-1, UC-2)

### 1.1 Happy Path

| TC ID | UC Ref | FR Ref | Title | Type | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-1.1 | UC-1 | FR-A5, FR-A6 | Clean scheduled sync end-to-end | dry-run fixture / scaffold | Scratch `copier copy` scaffold, `.copier-answers.yml` fixture-pinned to `_commit: v0.8.0`, `_src_path: gh:Koroqe/OPOS`; clean tree | Run `/auto-sync` (non-dry) inside the scaffold when a newer tag exists | Zero `.rej` files; branch `opos-auto-sync-<tag>` created then deleted after ff-merge; commit `chore: auto-sync OPOS core <tag>` on main with sha recorded in the run entry; main pushed; `success` record written | P0 |
| TC-1.2 | UC-1 step 2-3 | FR-A2 | Cache bypass + last-check refresh | dry-run fixture | `.claude/.last-update-check` timestamp < 6h old | Run `/auto-sync` | Probe still hits `gh api repos/<upstream>/releases` directly (not skipped by the 6h cache); `.claude/.last-update-check` is refreshed after the probe | P0 |
| TC-1.3 | UC-1 step 4, UC-1-EC1 | FR-A3 | Release tag validated before use | dry-run fixture | Fixture-mock `gh api` to return a malformed tag (e.g. `v1.2` or `1.2.3-rc1` — adjust per the exact regex `^v?[0-9]+\.[0-9]+\.[0-9]+$`) | Run `/auto-sync` | Malformed tag is never used in `--vcs-ref` or a branch name; run treats this as no valid update; `success` record with a note, no branch/commit | P0 |
| TC-1.4 | UC-1-A | FR-A15 | Manual invocation routes to `history/` | dry-run fixture | Interactive session, no scheduled prelude present | Run `/auto-sync` manually | Run record written to `history/*.md`, NOT `scheduled-runs/` | P0 |
| TC-1.5 | UC-1-B | FR-A13 | `--dry_run` performs zero mutations | dry-run fixture | Update available in fixture scaffold | Run `/auto-sync --dry_run` | Prints would-be action (update available/not, target tag); no branch, no commit, no push, no record write; repo state identical before/after | P0 |
| TC-1.6 | UC-2 | FR-A4 | No update available still writes success record | dry-run fixture | `.copier-answers.yml` pinned to the latest available tag | Run `/auto-sync` (non-dry) | `success` record written with a one-line note (e.g. "no update available, pinned at v0.8.1"); no branch, no commit; `.last-update-check` still refreshed | P0 |

### 1.2 Guard / Preflight Checks

| TC ID | UC Ref | FR Ref | Title | Type | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-1.7 | UC-3-E1 | FR-A5 | Dirty working tree blocks the run | dry-run fixture | Scaffold with an uncommitted modified file | Run `/auto-sync` | Clean-tree guard fails before any probe/mutation; a run record is written (NOT `success`); tree untouched | P0 |
| TC-1.8 | UC-11-E1 | FR-A5 | GH-Action mutual-exclusion refusal | dry-run fixture | `.github/workflows/sync-opos.yml` present with an uncommented `schedule:` block | Run `/auto-sync` | Run refuses to proceed (no probe, no branch, no commit); non-`success` record written; a GitHub issue is filed noting the mutual-exclusion conflict | P0 |
| TC-1.9 | UC-11-E1 | FR-A5 | Mutual-exclusion issue filed only once | dry-run fixture | Same as TC-1.8, plus the mutual-exclusion issue already open from a prior run | Run `/auto-sync` again | No duplicate issue filed; run still refuses and records non-`success` | P1 |
| TC-1.10 | UC-11 postcondition | — | Commented-out `schedule:` block does not trigger refusal | dry-run fixture | `.github/workflows/sync-opos.yml` present but `schedule:` block fully commented out | Run `/auto-sync` | Preflight passes; run proceeds normally (documented limitation: only this exact grep shape is checked) | P2 |

### 1.3 Divergence / Merge Guard (UC-5)

| TC ID | UC Ref | FR Ref | Title | Type | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-1.11 | UC-5-E1 | FR-A5, NFR-3 | ff-only merge failure escalates, never proceeds | dry-run fixture | Local main diverged from `origin/<default-branch>` such that ff-merge is impossible | Run `/auto-sync` with an update available | `git merge --ff-only` fails before branching; no `opos-auto-sync-<tag>` branch created; main left in diverged state; `partial` record written; consumer-repo issue opened via `gh repo view --json nameWithOwner` (never `task-tracking.config.json`) | P0 |

### 1.4 `.rej` Handling (UC-6, UC-7)

| TC ID | UC Ref | FR Ref | Title | Type | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-1.12 | UC-6 | FR-A7 | CHANGELOG-only additive `.rej` auto-resolves | dry-run fixture | `copier update` fixture produces exactly one `.rej`: `CHANGELOG.md.rej`, hunk purely a new `## [x.y.z]` section | Run `/auto-sync` | New version section inserted below consumer day-blocks, above older version sections; `CHANGELOG.md.rej` deleted; canonical awk-extraction verifies the result; zero remaining `.rej` → run proceeds through commit/merge/push; `success` record, outcome indistinguishable from UC-1 | P0 |
| TC-1.13 | UC-6-E1 | FR-A7 | Non-additive CHANGELOG hunk falls through to conflict escalation | dry-run fixture | `copier update` fixture produces `CHANGELOG.md.rej` whose hunk also modifies/removes existing content (not purely additive) | Run `/auto-sync` | Auto-resolution does NOT apply; falls through to the UC-7 multi-`.rej` escalation flow | P0 |
| TC-1.14 | UC-7 | FR-A8 | Multi-`.rej` conflict escalation | dry-run fixture | `copier update` fixture produces 2+ `.rej` files, or one `.rej` that is not the CHANGELOG-additive case | Run `/auto-sync` | Partial state (including remaining `.rej` files) committed on `opos-auto-sync-<tag>`; branch left in place, not deleted, not merged; main untouched; GitHub issue opened in consumer's own repo instructing resolve/merge/delete; `partial` record (never `success`) | P0 |

### 1.5 Push Failure / Idempotency / Self-Heal (UC-4, UC-8)

| TC ID | UC Ref | FR Ref | Title | Type | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-1.15 | UC-8-E1 | FR-A9 | Push failure after successful commit records `partial`, never `success` | dry-run fixture | Fixture: commit succeeds locally (steps 1-8 of UC-1), subsequent push simulated to fail | Run `/auto-sync` | Local commit exists (on ff-merged main or the branch); `partial` record written; issue opened describing the push failure and required manual push/merge; run is NEVER reported `success` | P0 |
| TC-1.16 | UC-4-A | FR-A10, NFR-3 | Stale-branch self-heal | dry-run fixture | A pre-existing `opos-auto-sync-<tag>` branch exists whose `<tag>` ≤ current pin | Run `/auto-sync` | Stale branch deleted; run proceeds normally through UC-1/other applicable flow for the current probe result | P0 |
| TC-1.17 | UC-4-B | FR-A10, NFR-3 | Pending-conflict idempotency — no duplicate branch/issue | dry-run fixture | A pre-existing `opos-auto-sync-<tag>` branch exists whose `<tag>` is still newer than the current pin; corresponding GitHub issue still open | Run `/auto-sync` twice in a row (simulating repeated cron fires) | Branch untouched across both runs; issue untouched (no duplicate); `partial` record written each run; no duplicate branches or issues accumulate | P0 |

### 1.6 Degraded Environments (UC-9)

| TC ID | UC Ref | FR Ref | Title | Type | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-1.18 | UC-9-A | FR-A11, NFR-7 | No `gh` CLI / no remote → local-commit-only `partial` | dry-run fixture | `gh` CLI unavailable or repo has no GitHub remote; update available | Run `/auto-sync` | Local commit only; no push attempted; no issue filed (both require `gh`/remote); `partial` record with an explicit note explaining the degradation | P0 |
| TC-1.19 | UC-9-E1 | FR-A11 | `copier update` fails mid-branch → clean rollback | dry-run fixture | Fixture forces `copier update` to fail partway through, regardless of `gh`/remote availability | Run `/auto-sync` | Checkout main; the partially-created branch is deleted; `failure` record written; no commit created | P0 |

### 1.7 Non-Scaffolded Repo (UC-10)

| TC ID | UC Ref | FR Ref | Title | Type | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-1.20 | UC-10-A | FR-A12 | Non-scaffolded repo posture | dry-run fixture | Run inside the OPOS framework clone itself (no `.copier-answers.yml`) | Run `/auto-sync` | Detects absence of `.copier-answers.yml`; warns; exits 0; no probe, no mutation, no run record beyond the warning (mirrors `check-for-updates`) | P0 |

### 1.8 Routing (UC-12)

| TC ID | UC Ref | FR Ref | Title | Type | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-1.21 | UC-12 | FR-A15 | Scheduled invocation routes to `scheduled-runs/`, never both | dry-run fixture | Non-interactive scheduled prelude present (simulated cron invocation) | Run `/auto-sync` | Exactly one run record, written to `scheduled-runs/*.md` (gitignored); no record written to `history/` for the same run | P0 |
| TC-1.22 | UC-12 | FR-A15 | Manual invocation routes to `history/`, never both | dry-run fixture | Interactive session, no scheduled prelude | Run `/auto-sync` | Exactly one run record, written to `history/*.md`; no record written to `scheduled-runs/` for the same run | P0 |

### 1.9 Authority Mapping / Validator

| TC ID | UC Ref | FR Ref | Title | Type | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-1.23 | — | FR-A1, FR-A14 | `auto-sync` PROCESS.md passes the scheduling validator | validator | `.claude/skills/auto-sync/PROCESS.md` committed with scheduling fields | Run `python3 -c '...validate_frontmatter(Path("auto-sync/PROCESS.md"))'` | Returns literal `(True, [])` | P0 |
| TC-1.24 | — | FR-A14 | Authority mapping documented in SKILL.md | scaffold | `auto-sync/SKILL.md` present | Grep SKILL.md for an explicit Authority mapping note covering `commit`, `push`, `file_issue` | Note exists and enumerates the actions each authority token covers | P1 |

---

## 2. `review-history` — Weekly Triage (UC-13, UC-14, UC-15)

### 2.1 Happy Path

| TC ID | UC Ref | FR Ref | Title | Type | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-2.1 | UC-13 | FR-B1–FR-B4 | Full weekly triage over a mixed fixture set | dry-run fixture | Fixture set of `history/`/`scheduled-runs/` entries: one CORE-target delta, one small STARTER delta (≤2 files, ≤20 lines, no sensitive path), one oversized STARTER delta, one stale/nonsensical delta, one entry with an open `upstream_pr:`, one with a malicious `delta_target` (`../../etc/x`) | Run `/review-history` (non-dry) | Work happens on branch `review-history/<date>`; CORE delta routed to `propose-to-core`; small STARTER delta applied+committed directly; oversized STARTER delta routed to `write_proposal`; stale delta marked `rejected` with a reason; malicious `delta_target` entry rejected/flagged, not used for classification; open-PR entry reconciled first (UC-14); every touched entry gets a dated triage note; branch ff-merged to main at the end | P0 |
| TC-2.2 | UC-13-EC1 | FR-B10, NFR-2 | Zero open deltas still writes success record | dry-run fixture | Fixture set with no `status: open` entries (or none with `proposed_delta` ≠ `none`) | Run `/review-history` | `success` run record with a one-line note (e.g. "no open deltas this run"); never a silent no-op | P0 |
| TC-2.3 | UC-15 | FR-B13 | `--dry_run` computes triage table with zero mutations | dry-run fixture | Same mixed fixture set as TC-2.1 | Run `/review-history --dry_run` | Full triage table printed (entry, classification, decision, target); zero entries modified; no commit; no `write_proposal`/`propose-to-core`/issue call executes; repo state identical before/after | P0 |

### 2.2 Alternative Flows — Triage Routing (UC-13-A, UC-13-B, UC-13-C)

| TC ID | UC Ref | FR Ref | Title | Type | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-2.4 | UC-13-A | FR-B5 | Small STARTER delta applied directly | dry-run fixture | Delta touches exactly 2 files, exactly 20 changed lines, no sensitive path | Run `/review-history` | Applied and committed directly on `review-history/<date>`, then ff-merged (boundary values inclusive per "≤") | P0 |
| TC-2.5 | UC-13-B | FR-B6 | Oversized STARTER delta routed to `write_proposal`, never edited directly | dry-run fixture | Delta touches 3 files (exceeds file threshold) | Run `/review-history` | `review-history` does NOT edit the file directly; `write_proposal` called against the owning agent's department backlog | P0 |
| TC-2.6 | UC-13-B | FR-B5, FR-B6 | Sensitive-path delta routed to `write_proposal` even under size threshold | dry-run fixture | Delta touches 1 file, 5 changed lines, but the path contains `auth` (or `payment`/`billing`/`secret`/`migration`, `.claude/settings.json`, `.github/workflows/`) | Run `/review-history` | Routed to `write_proposal`, NOT applied directly, despite being within size threshold — sensitive-path check overrides size | P0 |
| TC-2.7 | UC-13-C | FR-B9 | Stale delta marked rejected with explicit reason | dry-run fixture | Delta references a file/change no longer applicable | Run `/review-history` | Entry marked `rejected` with an explicit reason in the triage note — never silently dropped | P0 |
| TC-2.8 | UC-13 step 6 | FR-B8 | CORE files are never edited locally under any triage path | dry-run fixture | CORE-targeted delta within the size/line/path threshold that would otherwise qualify for direct-apply | Run `/review-history` | Delta is routed to `propose-to-core`, NOT applied directly, regardless of size — CORE-vs-STARTER classification takes precedence over the size threshold | P0 |

### 2.3 PR-State Reconciliation (UC-14)

| TC ID | UC Ref | FR Ref | Title | Type | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-2.9 | UC-14 step 2 | FR-B3 | Merged upstream PR → entry status applied | dry-run fixture | Entry carries `upstream_pr:` pointing to a PR; `gh pr view --json state,merged` fixture returns merged=true | Run `/review-history` | Entry's `status` set to `applied`; no issue filed | P0 |
| TC-2.10 | UC-14-A | FR-B3 | Closed-unmerged PR opens issue, entry stays open | dry-run fixture | `gh pr view` fixture returns state=CLOSED, merged=false | Run `/review-history` | Consumer-repo issue opened for human decision; entry `status` stays `open` with a note | P0 |
| TC-2.11 | UC-14 step 4 | FR-B3 | Still-open PR is skipped, no state change | dry-run fixture | `gh pr view` fixture returns state=OPEN | Run `/review-history` | No state change to the entry; no issue filed | P1 |
| TC-2.12 | UC-13 step 3 | FR-B3 | Reconciliation runs before triage collection | dry-run fixture | Fixture set with both an `upstream_pr:`-carrying entry (merged) and fresh open deltas | Run `/review-history` | Reconciliation (UC-14) executes first; the merged entry is excluded from the fresh-open-delta triage collection in the same run | P1 |

### 2.4 3-PR Cap and Input Validation

| TC ID | UC Ref | FR Ref | Title | Type | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-2.13 | UC-13 step 6 | FR-B7, NFR-4 | CORE-routing capped at 3 PR creations per run | dry-run fixture | Fixture set with 4+ distinct CORE-targeted open deltas | Run `/review-history` | At most 3 actual upstream PR creations occur this run; the 4th+ CORE delta is left for a subsequent run (not silently dropped, not force-created) | P0 |
| TC-2.14 | UC-13-E1 | FR-B12, NFR-5 | Malicious `delta_target` rejected by re-validation | dry-run fixture | Entry's `delta_target` is `../../etc/passwd` | Run `/review-history --dry_run` | Re-validation fails (must be repo-relative, no `..`, no leading `/`, charset `[A-Za-z0-9._/-]`, must resolve inside repo root); entry rejected/flagged rather than used to drive classification or any downstream command | P0 |
| TC-2.15 | UC-13-E1 | FR-B12 | `delta_target` with leading slash rejected | dry-run fixture | `delta_target: /etc/passwd` | Run `/review-history --dry_run` | Rejected — leading `/` fails validation | P0 |
| TC-2.16 | UC-13-E1 | FR-B12 | `delta_target` with disallowed characters rejected | dry-run fixture | `delta_target: shared/templates/$(rm -rf).md` | Run `/review-history --dry_run` | Rejected — charset outside `[A-Za-z0-9._/-]` fails validation; value never interpolated into a shell command | P0 |
| TC-2.17 | UC-13 note (FR-B12) | FR-B12 | `proposed_delta` free text never interpolated into shell/branch/PR title | dry-run fixture | `proposed_delta` free text contains shell metacharacters (e.g. `` `whoami` `` or `; rm -rf /`) | Run `/review-history` on the routed delta | Slug used in any branch name/PR title is always re-derived by sanitizing to `[a-z0-9-]`; raw free text is never passed to a shell command | P0 |
| TC-2.18 | UC-13 note (FR-B12) | FR-B12 | Entry path outside repo root rejected | dry-run fixture | A crafted entry reference resolves outside the repo root | Run `/review-history --dry_run` | Entry is rejected before use; no downstream classification/command executes against it | P1 |

### 2.5 Authority / Validator

| TC ID | UC Ref | FR Ref | Title | Type | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-2.19 | — | FR-B1 | `review-history` PROCESS.md passes the scheduling validator | validator | `.claude/skills/review-history/PROCESS.md` committed | Run the validator one-liner against the PROCESS.md path | Returns literal `(True, [])` | P0 |

---

## 3. `propose-to-core` — Local Half: Classify, Draft, Gate (UC-16 steps 1-5, UC-19, UC-20, UC-21, UC-23)

### 3.1 Input Validation and Classification

| TC ID | UC Ref | FR Ref | Title | Type | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-3.1 | UC-16 step 1 | FR-C1, FR-C13 | Valid entry-path input accepted | dry-run fixture | Valid `history/*.md` entry path resolving inside repo root | Run `/propose-to-core --dry_run` with the entry path | Input accepted; proceeds to classification | P0 |
| TC-3.2 | UC-16 step 1 | FR-C1, FR-C13 | Inline defect + explicit valid `delta_target` accepted | dry-run fixture | Inline defect description + `delta_target: shared/templates/PROCESS.md.tmpl` | Run `/propose-to-core --dry_run` | Input accepted; `delta_target` validated (repo-relative, no `..`/leading `/`, charset `[A-Za-z0-9._/-]`) | P0 |
| TC-3.3 | UC-16 step 1 (negative) | FR-C13, NFR-5 | Malicious `delta_target` rejected at input validation | dry-run fixture | Inline defect + `delta_target: ../../etc/passwd` | Run `/propose-to-core --dry_run` | Input validation fails; run aborts before classification; no shell/`gh api` interpolation of the raw value occurs | P0 |
| TC-3.4 | UC-16 step 1 (negative) | FR-C1 | Entry path outside repo root rejected | dry-run fixture | Entry path argument resolving outside repo root (e.g. via `..`) | Run `/propose-to-core --dry_run` | Input rejected before classification | P0 |
| TC-3.5 | UC-20-E1 | FR-C2 | STARTER classification aborts with guidance | dry-run fixture | Target classifies as STARTER/local (matches `_skip_if_exists`) | Run `/propose-to-core --dry_run` | Aborts with guidance directing the caller to apply the change via `review-history` instead; no draft, no review, no PR | P0 |
| TC-3.6 | UC-21-E1 | FR-C2 | Classification-fetch failure aborts to human-draft path, never guesses | dry-run fixture | `gh api repos/<owner>/<repo>/contents/copier.yml` (or the upstream file probe) fixture-forced to fail | Run `/propose-to-core` (non-dry) | No classification decision guessed; falls back to the human-draft path (local draft, issue, entry left `open` with note, ledger line with an appropriate outcome) — equivalent terminal shape to UC-18 | P0 |
| TC-3.7 | FR-E3 | FR-E1–FR-E3 | `_exclude`d-but-upstream-existing file classifies as upstreamable | dry-run fixture | Target is `MAINTAINER.md` (or `copier.yml`/`.github/README.md`) — `_exclude`d locally but present in the upstream repo | Run `/propose-to-core --dry_run` | Classifies as upstreamable (not STARTER/local); `_exclude` alone does not short-circuit to "not upstreamable" | P0 |

### 3.2 Dedupe (UC-19)

| TC ID | UC Ref | FR Ref | Title | Type | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-3.8 | UC-19-A | FR-C3 | Ledger hit skips with note, no duplicate draft/PR | dry-run fixture | `proposals/LEDGER.md` fixture already contains a line for this `delta_target`/slug | Run `/propose-to-core` (non-dry) | Run stops with a note recorded against the source entry/run record; no draft, no redaction review, no PR, no new ledger line beyond the skip note | P0 |
| TC-3.9 | UC-19-A | FR-C3 | Existing upstream PR title-slug match skips with note | dry-run fixture | No ledger line, but `gh pr list --repo <upstream> --state all --json title,url,state --limit 200` fixture contains a PR titled `[opos-core] <same-file-slug>: <title>` | Run `/propose-to-core` (non-dry) | Dedupe detects the local slug match; run stops with a note; no duplicate PR created | P0 |
| TC-3.10 | UC-19 note (design table) | FR-C3 | Slug matching is local, not server-side `in:title` search | dry-run fixture | PR list fixture contains a title with `/` and `.` characters in the slug | Run dedupe step | Match performed via local slug parsing against the fetched JSON list, not via a `gh pr list --search "in:title"` server-side query | P1 |

### 3.3 Draft, Self-Pass, and Adversarial Review Gate

| TC ID | UC Ref | FR Ref | Title | Type | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-3.11 | UC-16 step 4 | FR-C4 | Draft built against actual upstream file content, `.jinja` checked first | dry-run fixture | Target file has both a `.jinja` and non-`.jinja` form upstream | Run `/propose-to-core --dry_run` | Draft is built against the `.jinja` variant when it exists; self-pass redaction checklist run before adversarial review | P0 |
| TC-3.12 | UC-16 step 5 | FR-C5 | Adversarial review bundle assembled correctly | dry-run fixture | Fixture entry with known COMPANY_NAME, dept/agent names, repo `nameWithOwner`, git author identity | Run `/propose-to-core --dry_run` | Orchestrator assembles an identifier blocklist (COMPANY_NAME, dept/agent names, repo `nameWithOwner`, git author names/emails) plus diff/PR body/branch name/commit message and spawns `redaction-reviewer` with exactly that bundle (no source entry or wider repo access granted to the agent) | P0 |
| TC-3.13 | UC-23 | FR-C6 | `--dry_run` stops after adversarial review with full preview | dry-run fixture | Valid input, upstreamable classification, no dedupe hit | Run `/propose-to-core --dry_run` | Steps 1-5 execute (validate, classify, dedupe check, draft, self-pass, adversarial review); run stops immediately after — no write path evaluated, no branch/fork/PR/ledger/annotation; complete redacted PR preview (title, body, diff) printed with both self-pass and adversarial-review verdicts; zero mutations to repo/upstream/ledger | P0 |

### 3.4 Authority / Validator

| TC ID | UC Ref | FR Ref | Title | Type | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-3.14 | — | FR-C14 | `propose-to-core` PROCESS.md carries no scheduling fields | scaffold | `propose-to-core/PROCESS.md` committed | Inspect PROCESS.md frontmatter | No `schedule`/`runtime`/`non_interactive` scheduling fields present — invoked only by `review-history` or manually | P1 |

---

## 4. `propose-to-core` — Remote Half: Write Paths, Ledger, Fallbacks (UC-16 steps 6-9, UC-17, UC-18, UC-22)

### 4.1 Direct-Branch Write Path (UC-16)

| TC ID | UC Ref | FR Ref | Title | Type | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-4.1 | UC-16 step 6-9 | FR-C7–FR-C10 | Direct-branch write on `REDACTION: PASS` with push rights | e2e (Phase R R5) / dry-run rehearsal (U11) | Adversarial review returned exact `REDACTION: PASS`; `gh api repos/<upstream> --jq .permissions.push` returns true | Execute the write path | Branch created directly on the upstream repo under forced neutral identity `git -c user.name="opos-consumer" -c user.email="opos-consumer@users.noreply.github.com"`; branch named `propose/<file-slug>-<YYYYMMDD>`; `gh pr create --repo <upstream>` with title `[opos-core] <file-slug>: <title>` and body from `core-proposal-pr.md.tmpl`; `proposals/LEDGER.md` line appended+committed (date, delta_target, slug, source-entry path, PR URL, outcome `pr`); source entry best-effort annotated `upstream_pr: <url>`, `status` stays `open` | P0 |
| TC-4.2 | UC-16 postcondition | FR-C10 | Ledger commit happens even if entry annotation is best-effort/unavailable | dry-run rehearsal | Source entry file is gitignored (in `scheduled-runs/`) at PR-creation time | Execute write path | Ledger line still committed; entry annotation attempted best-effort and does not block ledger commit if it fails/is unavailable | P1 |

### 4.2 Fork Path (UC-17)

| TC ID | UC Ref | FR Ref | Title | Type | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-4.3 | UC-17-A | FR-C7 | Fork-and-PR path for no-push-rights consumer | dry-run rehearsal (U11 mechanical sequence, minus literal `gh repo fork`) | `REDACTION: PASS`; `gh api repos/<upstream> --jq .permissions.push` returns false | Execute the write path against a scratch repo | `gh repo fork --clone=false --default-branch-only` targets the invoking user account (never a company org); shallow-clone to scratch; branch there with the same forced neutral identity; push; `gh pr create --repo <upstream>` from the fork; ledger and annotation steps proceed identically to UC-16 | P0 |
| TC-4.4 | UC-17-A (negative) | FR-C7 | Org fork explicitly prohibited | dry-run rehearsal / code review | Same as TC-4.3 | Inspect the fork invocation and any org-selection logic | `gh repo fork` targets only the user's personal account — there is no code path, flag, or fallback that can target a company/org account | P0 |

### 4.3 Redaction FAIL / Fallback (UC-18)

| TC ID | UC Ref | FR Ref | Title | Type | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-4.5 | UC-18-E1 | FR-C11 | `REDACTION: FAIL` → local draft + issue, no upstream write | dry-run fixture / red-team | Draft assembled (UC-16 steps 1-4 complete); adversarial review returns non-PASS (findings present) | Run `/propose-to-core` (non-dry) against the red-team fixture (see §5) | No upstream write of any kind (no branch/fork/PR); local draft committed at `proposals/<date>-<slug>.md` including the reviewer's findings; consumer-repo issue opened; source entry left `open` with a note; ledger line appended with outcome `draft` | P0 |

### 4.4 STARTER-Target Abort, Fetch Failure, No-Write-Access (UC-20, UC-21, UC-22)

| TC ID | UC Ref | FR Ref | Title | Type | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-4.6 | UC-22-E1 | FR-C11 | Fork/write failure falls back to human-draft path | dry-run fixture (simulated fork failure) | Adversarial review PASSes; direct-branch path unavailable (no push rights) AND fork creation fails | Run `/propose-to-core` (non-dry) | Falls back to the same human-draft path as UC-18 (local draft with findings noting the write/fork failure, issue, entry stays `open`, ledger line outcome `draft`) | P0 |
| TC-4.7 | UC-16/UC-18/UC-22 | FR-C12 | Every terminal state writes a ledger line distinct from the run record | dry-run fixture | Run each terminal state at least once: PASS-and-PR, dedupe-skip, STARTER-abort, fetch-failure, FAIL/fallback | Inspect `proposals/LEDGER.md` and the run record after each | Every terminal state produces a `proposals/LEDGER.md` line; the run record (following standard prelude routing) is written separately and is never the ledger | P0 |

### 4.5 Neutral Identity and Input Validation (Remote Half)

| TC ID | UC Ref | FR Ref | Title | Type | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-4.8 | UC-16 step 6 | FR-C8 | All upstream writes use the forced neutral git identity | dry-run rehearsal | Any write-path execution (direct or fork) | Inspect the git commit author on the resulting branch commit | Author is exactly `opos-consumer <opos-consumer@users.noreply.github.com>` — never the invoking human's own configured identity | P0 |
| TC-4.9 | UC-16 step 7 | FR-C9 | Branch and PR-title naming convention enforced | dry-run rehearsal | Any successful write path | Inspect branch name and PR title | Branch matches `propose/<file-slug>-<YYYYMMDD>`; PR title matches `[opos-core] <file-slug>: <title>` | P0 |
| TC-4.10 | UC-16/UC-17 (negative) | FR-C13 | Slug interpolated into branch/PR title is sanitized | dry-run fixture | Source file-slug candidate contains characters outside `[a-z0-9-]` before sanitization | Run write path | Slug used in the branch name and PR title is sanitized to `[a-z0-9-]` before interpolation; no raw special characters reach the shell/`gh` invocation | P0 |

---

## 5. `redaction-reviewer` Agent (UC-24 through UC-27)

### 5.1 PASS Case

| TC ID | UC Ref | FR Ref | Title | Type | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-5.1 | UC-24 | FR-D2–FR-D4 | Clean generic draft yields literal PASS | red-team | Fixture bundle: generic diff/PR body/branch name/commit message with no company names, person identifiers, secrets, or internal references; identifier blocklist supplied | Invoke `redaction-reviewer` with the bundle | Findings list is empty; output verdict is the exact literal string `REDACTION: PASS` | P0 |
| TC-5.2 | UC-24 (design table) | FR-D2 | Agent does not read the source entry or wider repo | red-team | Same fixture bundle as TC-5.1 | Inspect the agent's tool access / prompt inputs during invocation | Agent receives only the diff, PR body, branch name, commit message, and blocklist supplied by the orchestrator — no filesystem read of the source history entry or repo | P1 |

### 5.2 FAIL Cases

| TC ID | UC Ref | FR Ref | Title | Type | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-5.3 | UC-25-E1 | FR-D3, FR-D4 | Company-and-secret-laden fixture yields FAIL naming both classes | red-team | Fixture bundle deliberately contains a company/product name AND a secret/credential (API key or token) — the U4-mandated fixture | Invoke `redaction-reviewer` with the bundle | Non-empty findings list naming BOTH the company-identifying class and the secrets/credentials class; verdict is anything other than the exact literal `REDACTION: PASS` (counts as FAIL) | P0 |
| TC-5.4 | UC-25-E1 | FR-D3 | Company name alone triggers FAIL | red-team | Fixture bundle contains only a company/product name (blocklisted), otherwise clean | Invoke `redaction-reviewer` | Findings list names the company-identifying class; FAIL verdict | P0 |
| TC-5.5 | UC-25-E1 | FR-D3 | Person name/email/handle triggers FAIL | red-team | Fixture bundle contains a person's name, email, or handle from the blocklist | Invoke `redaction-reviewer` | Findings list names the person-identifier class; FAIL verdict | P0 |
| TC-5.6 | UC-26-E1 | FR-D3, FR-D4 | Secret/credential material triggers FAIL, distinct class from company-identifying | red-team | Fixture bundle contains an API key/token/password/connection string/private URL-IP/`.env` value, otherwise clean of company-identifying data | Invoke `redaction-reviewer` | Findings list names the secrets/credentials class specifically (distinct from company-identifying classes); FAIL verdict regardless of how clean the rest of the bundle is | P0 |
| TC-5.7 | UC-27-E1 | FR-D4 | Ambiguous/hedged content is treated as FAIL, not a third state | red-team | Fixture bundle contains ambiguous content the agent cannot confidently classify (e.g. a string that could be a real internal URL or a generic placeholder) | Invoke `redaction-reviewer` | Any hedged/uncertain output ("possibly", "unclear if...") is NOT the literal `REDACTION: PASS`; `propose-to-core` MUST treat it as FAIL — there is no accepted third state | P0 |
| TC-5.8 | UC-27-E1 (negative gate check) | FR-D4 | Only the exact literal string authorizes a write | unit / code review | Any FAIL/uncertain verdict fixture | Inspect `propose-to-core`'s gate logic for the verdict check | Gate logic performs an exact string match against `REDACTION: PASS`; no prefix/substring/fuzzy match is accepted as authorization | P0 |

---

## 6. Schema Extensions (UC relates to FR-F1–FR-F5)

| TC ID | UC Ref | FR Ref | Title | Type | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-6.1 | FR-F1 | FR-F1, FR-F2 | New optional fields documented in CORE templates | scaffold | `shared/templates/scheduled-run.md.tmpl`, `shared/templates/PROCESS.md.tmpl` | Inspect both files | `delta_target:` and `upstream_pr:` appear as optional fields with one-line comments, appended after existing fields; existing field ordering and the optional `time:` field unchanged | P0 |
| TC-6.2 | FR-F1, FR-F2 | FR-F2 | Both PROCESS.md.tmpl body lists document the fields | scaffold | `PROCESS.md.tmpl` | Inspect both the `## History` and `## Scheduled runs` sections | Both body-list sections (not only the frontmatter comment block) document `delta_target:` and `upstream_pr:` | P1 |
| TC-6.3 | FR-F4 | FR-F4 | "Self-improving" principle corrected in all three copies | scaffold | `README.md.jinja`, root `CLAUDE.md.jinja`, `coo.md` | Grep all three for "their own PROCESS.md" / "propose deltas to their PROCESS.md" | Zero matches for the offending phrasing; all three state that deltas route through `review-history` triage and CORE targets never get edited locally | P0 |
| TC-6.4 | FR-F5 | FR-F5 | Backward compatibility — pre-feature entry renders unchanged | unit | Restaba's `2026-08-19-setup-restaba.md` (or an equivalent pre-feature entry lacking the two new fields) copied into the console's data path | Run the console's entry-rendering path against the file | Entry renders unchanged; absence of `delta_target`/`upstream_pr` causes no error and no rendering difference | P0 |
| TC-6.5 | FR-F3 | FR-F3 | STARTER copies receive Migration-note guidance, not live schema docs | scaffold | Glossary, root `CLAUDE.md.jinja` | Inspect for schema documentation vs. migration guidance | STARTER files carry migration-note guidance only for existing consumers (since STARTER files do not propagate on sync); authoritative field docs live only in CORE artifacts | P2 |

---

## 7. Scheduled-Run Schema Test Suite (Slice U10a — FR-H5)

| TC ID | UC Ref | FR Ref | Title | Type | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-7.1 | FR-H5 | FR-H5, NFR-8 | `test_scheduled_run_schema.py` updated to 13 expected fields | unit | `ui/tests/test_scheduled_run_schema.py` updated: `EXPECTED_FIELDS` 11 → 13 | Run `python3 -m pytest ui/tests/test_scheduled_run_schema.py` (or project's declared test runner) | Test passes; `EXPECTED_FIELDS` set contains all 11 original fields plus `delta_target` and `upstream_pr` | P0 |
| TC-7.2 | FR-H1, FR-H5 | FR-H5, NFR-8 | Skill/agent/template count assertions updated | unit | `ui/tests/*` count-assertion tests, `ui/smoke.sh` | Run the full `ui/tests/` suite and `ui/smoke.sh` | All count assertions (skills +3, agents +1, templates +1) pass against the actual post-feature file counts | P0 |
| TC-7.3 | FR-H5 | NFR-8 | Full `ui/tests/` suite passes end-to-end | unit | All U1-U10 changes committed | Run the project's declared test command for `ui/tests/` | Exit code 0; no failing test | P0 |

---

## 8. Config Surfaces (Slice U10b — FR-H6, FR-G3, sensitive)

| TC ID | UC Ref | FR Ref | Title | Type | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-8.1 | FR-H6 | FR-H6 | SDLC documentation paths excluded from consumer scaffolds | scaffold | `copier.yml` updated with `_exclude` for the feature's SDLC doc paths | `copier copy` the working tree to a temp dir with a test `COMPANY_NAME` | No `docs/PRD.md`, `docs/use-cases/`, `docs/qa/`, or `docs/architecture/` self-improvement-loop content present in the scaffold output | P0 |
| TC-8.2 | FR-H6 | FR-H6 | LEDGER.md protected via `_skip_if_exists` | scaffold | `copier.yml` includes `.claude/skills/propose-to-core/proposals/LEDGER.md` in `_skip_if_exists` | Scaffold a consumer at v0.9.0, mutate `LEDGER.md` locally (simulate a real proposal appended), then `copier update` to a hypothetical later tag that also edits the ledger header upstream | No `.rej` file produced for `LEDGER.md`; the consumer's locally-mutated ledger is preserved, not overwritten | P0 |
| TC-8.3 | FR-G3, NFR-6 | FR-G3 | Template settings allow-list ships empty | scaffold | Fresh `copier copy` scaffold | Inspect `.claude/settings.json` in the scaffold | `{"allow":[],"deny":[]}` — no active allow-list ships as a template default | P0 |
| TC-8.4 | FR-G3, NFR-6 | FR-G3 | `schedule-process` registration proposes narrow, non-blanket allow entries | scaffold / dry-run fixture | Run `/schedule-process auto-sync` in a scratch scaffold | Inspect the proposed `.claude/settings.json` additions before confirmation | Proposed entries are narrowly scoped (e.g. `Bash(copier update:*)`, `Bash(git push origin:*)`, `Bash(gh pr create:*)`, `Bash(gh issue create:*)`, specific read-only `gh api repos/*` patterns); NO blanket `Bash(gh api:*)` or bare `Bash(git push:*)` is ever proposed; entries are added only after human confirmation | P0 |
| TC-8.5 | FR-H6 | FR-H6 | `.github/workflows/sync-opos.yml` carries a mutual-exclusion cross-reference comment | scaffold | File present in scaffold | Inspect comment content | Comment references `auto-sync` mutual exclusion | P2 |

---

## 9. Copier Scaffold Smoke Test (Slice U11 — release gate)

| TC ID | UC Ref | FR Ref | Title | Type | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-9.1 | U11 done-when | AC (PRD §1.7) | Fresh scaffold contains the three skill folders and the agent | scaffold | `copier copy` the working tree (or `--vcs-ref v0.9.0` post-release) to a temp dir with a test `COMPANY_NAME` | Inspect scaffold output | `.claude/skills/auto-sync/`, `.claude/skills/review-history/`, `.claude/skills/propose-to-core/` folders present with rendered `SKILL.md`/`PROCESS.md`; `.claude/agents/company/redaction-reviewer.md` present | P0 |
| TC-9.2 | U11 done-when | AC | Templates and ledger scaffolding render with `.gitkeep`s intact | scaffold | Same scaffold as TC-9.1 | Inspect `shared/templates/core-proposal-pr.md.tmpl`, `proposals/README.md`, `proposals/LEDGER.md`, and all `.gitkeep` placeholders | All present and rendered (no unresolved Jinja placeholders); `.gitkeep`s intact in `history/`, `scheduled-runs/`, `proposals/` folders | P0 |
| TC-9.3 | U11 done-when | AC | SDLC doc paths absent from scaffold | scaffold | Same scaffold | Inspect for `docs/PRD.md`, `docs/use-cases/`, `docs/qa/`, `docs/architecture/self-improvement-loop*` | Absent | P0 |
| TC-9.4 | U11 done-when | AC | Settings allow-list empty in fresh scaffold | scaffold | Same scaffold | Inspect `.claude/settings.json` | `{"allow":[],"deny":[]}` | P0 |
| TC-9.5 | U11 done-when | AC | Re-scaffold at `--vcs-ref v0.9.0` after release | scaffold | v0.9.0 GitHub release exists | `copier copy --vcs-ref v0.9.0 gh:Koroqe/OPOS <temp-dir>` | Scaffold succeeds and contains the three skills, the agent, and the ledger scaffolding, matching TC-9.1/9.2/9.3 | P0 |

---

## 10. Validator Gate — Both Scheduled PROCESS.md Files (Release-Gating)

| TC ID | UC Ref | FR Ref | Title | Type | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-10.1 | U11 done-when | AC | `auto-sync/PROCESS.md` validates | validator | Committed PROCESS.md | `python3 -c '...validate_frontmatter(Path(".claude/skills/auto-sync/PROCESS.md"))'` | `(True, [])` | P0 |
| TC-10.2 | U11 done-when | AC | `review-history/PROCESS.md` validates | validator | Committed PROCESS.md | `python3 -c '...validate_frontmatter(Path(".claude/skills/review-history/PROCESS.md"))'` | `(True, [])` | P0 |

---

## 11. Fork-Path Mechanical Rehearsal (Slice U11)

| TC ID | UC Ref | FR Ref | Title | Type | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-11.1 | UC-17-A (rehearsal) | FR-C7 | Fork-path mechanics rehearsed end-to-end minus the literal fork call | dry-run rehearsal | Throwaway scratch repo available | Execute shallow-clone, branch, neutral-identity commit, push, `gh pr create` against the scratch repo (skipping the literal `gh repo fork` call, documented as untestable same-account per Risk 34) | Every step except `gh repo fork` itself completes correctly; branch naming, neutral identity, and PR creation shape match TC-4.1/TC-4.9/TC-4.8 | P1 |

---

## 12. Charter, Docs, and Risk Consistency (Slices U8, U9 — FR-H1 through FR-H4)

| TC ID | UC Ref | FR Ref | Title | Type | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-12.1 | FR-H1 | FR-H1 | chief-of-staff `owns_processes:` and narrative counts corrected | scaffold | `chief-of-staff.md` updated | Grep for `auto-sync`, `propose-to-core` in `owns_processes:`; grep for stale skill/agent/template counts | Both new skills listed; "All 21 v0.8.0 skills" → 24, "All 13 agents" → 14, math corrected to "12 + 11 + 1 = 24"; template count matches actual `ls shared/templates | wc -l` | P0 |
| TC-12.2 | FR-H1 | FR-H1 | coo charter gains `review-history` and corrected principle line | scaffold | `coo.md` updated | Grep `coo.md` for `review-history` in both locations; grep for "propose deltas to their PROCESS.md" | `review-history` present in both locations; offending phrasing at `coo.md:23` corrected to route via `review-history` | P0 |
| TC-12.3 | FR-G1 | FR-G1, FR-G2 | Scheduled-run authority exception documented once canonically, referenced twice | scaffold | `README.md.jinja`, `chief-of-staff.md` Permission-tiers section, `coo.md` | Inspect all three | Canonical text lives in `README.md.jinja`; chief-of-staff Permission-tiers section and coo charter each carry a short pointer note (not a duplicate of the full text) | P1 |
| TC-12.4 | FR-H4 | FR-H4 | RISKS entries 31-34 exist; 22/23 extended | scaffold | RISKS artifact updated | Inspect RISKS file | Risk 31 (outbound leak), 32 (bad-release propagation), 33 (PR spam), 34 (fork/auth unavailability) present; Risk 22 (schedule overlap) and Risk 23 (double-firing) carry extensions covering the two new scheduled processes | P1 |
| TC-12.5 | FR-H3 | FR-H3 | MAINTAINER.md gains incoming-PR triage guidance | scaffold | `MAINTAINER.md` updated | Inspect for `[opos-core]` triage section | Section covers genericity check, no leaked data/secrets, `.jinja`-form correctness, scaffold smoke test before merge | P1 |
| TC-12.6 | FR-H2 | FR-H2 | README self-improvement-loop section covers all required subtopics | scaffold | `README.md.jinja` updated | Inspect the new section | Covers: pull→push→release→pull cycle; `auto-sync` vs `sync-from-core` vs opt-in GH Action mutual exclusion; Scheduled-run authority exception; GitHub account-attribution disclosure; settings allow-list requirement for non-interactive runs | P1 |
| TC-12.7 | FR-H7 | FR-H7 | Upstream CHANGELOG `## [0.9.0]` section is awk-extractable with Migration note | scaffold | `CHANGELOG.md` updated | Run the canonical awk extraction against `## [0.9.0]` | Section extracts cleanly; `### Migration` note enumerates all five items (charter process lists + authority note, schema field lines + principle correction, settings acceptance guidance) | P0 |

---

## 13. Phase R — Restaba Dogfood End-to-End (R1-R6)

### 13.1 Setup and Sync

| TC ID | UC Ref | FR Ref | Title | Type | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-13.1 | R1 | — | Task-tracking config repo fixed | e2e | Restaba repo, `.claude/task-tracking.config.json` has the pre-existing bug | Fix `repo` → `Restaba/restaba-os`; commit | `gh issue list --repo Restaba/restaba-os` targets correctly | P1 |
| TC-13.2 | R2, UC-1/UC-6 | — | Sync to v0.9.0 in Restaba | e2e | v0.9.0 release exists upstream | Run `/sync-from-core` interactively in Restaba | `.copier-answers.yml` pins v0.9.0; `CHANGELOG.md.rej` (day-blocks) resolved manually; tree clean and committed | P1 |
| TC-13.3 | R3 | FR-F4, FR-H1 | Migration items applied per U10c Migration note | e2e | Sync complete | Apply charter/glossary/root-CLAUDE.md migration items per U0's ground-truth findings on what did NOT auto-propagate | Charters, glossary, root-CLAUDE.md schema lines and principle correction all present in Restaba's own copies | P1 |
| TC-13.4 | R3 | — | SDLC-hook compatibility verified for scheduled runs | e2e | Scheduled processes not yet registered | Verify: isolation guard denies only subagent writes (cron routine = main session, so CHANGELOG/scratchpad writes permitted); read-before-edit guard satisfied (both skills read before editing) | Compatibility confirmed and recorded; any further permission entries noted for R6 | P1 |

### 13.2 Rehearsal (UC-1/UC-2/UC-5 in Restaba, UC-13/UC-15/UC-23 in Restaba)

| TC ID | UC Ref | FR Ref | Title | Type | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-13.5 | R4, UC-2 | FR-A4 | `auto-sync --dry_run` no-update path in Restaba | e2e | Restaba pinned at latest tag | Run `/auto-sync --dry_run` | No-update path confirmed; a `success` "no update" record verified in the dry-run output/simulation | P1 |
| TC-13.6 | R4, UC-5/UC-4 | FR-A10 | Forced-conflict path + self-heal in Restaba | e2e | Scratch branch re-pinned via `--target_version` to force a conflict | Trigger conflict path, verify branch + issue created, then run again to verify self-heal on the next cycle | Conflict escalation matches UC-5/UC-7 shape; a subsequent run self-heals per UC-4-A once resolved/superseded | P1 |
| TC-13.7 | R4, UC-13 | FR-B4, FR-B7 | `review-history --dry_run` surfaces Restaba's real open delta | e2e | Restaba's `.claude/skills/company-setup/history/2026-08-19-setup-restaba.md` has `status: open`, `proposed_delta` ≠ none, targeting a CORE file | Run `/review-history --dry_run` | Real open delta surfaced in the triage table; classified CORE-targeted; routed to `propose-to-core` | P0 |
| TC-13.8 | R4, UC-23 | FR-C6 | `propose-to-core --dry_run` on the real Restaba delta | e2e | Delta from TC-13.7 | Run `/propose-to-core --dry_run` on the entry | Redacted PR preview produced with both self-pass and adversarial-review verdicts; PASS expected for this specific delta content | P0 |

### 13.3 The Real Upstream PR (Irreversible)

| TC ID | UC Ref | FR Ref | Title | Type | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-13.9 | R5, UC-16/UC-28 | FR-C7, FR-C10 | Real upstream PR opened for the company-setup delta | e2e | TC-13.8 passed dry-run rehearsal; user watching | Run `/propose-to-core` for real on the company-setup delta | PR opens on `Koroqe/OPOS` via the direct-branch path (koroqe has push rights); `proposals/LEDGER.md` line committed; source entry carries `upstream_pr:`; content contains no company-identifying data or secrets (manual human spot-check alongside the automated redaction gate) | P0 |

### 13.4 Scheduling and Closing the Loop

| TC ID | UC Ref | FR Ref | Title | Type | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-13.10 | R6 | FR-G1, FR-G3 | Both routines scheduled with narrow settings entries confirmed | e2e | TC-13.9 complete | Run `/schedule-process auto-sync` and `/schedule-process review-history` on this machine only | Both report OK; `.claude/settings.json` edit shown before commit, confirmed by the user, then committed; `/list-scheduled-processes` shows 2 entries, no overlap warning | P1 |
| TC-13.11 | R6 | — | Restaba CHANGELOG day-block entry written | e2e | Scheduling complete | Inspect `CHANGELOG.md` | Day-block entry for this completed unit exists above the first `## [` heading (dual-section rule) | P1 |
| TC-13.12 | UC-28 (full loop closure) | FR-B3, FR-C10 | Loop closes: merged PR reflects `applied` on next `review-history` run | e2e (post-merge, best-effort — depends on maintainer timing) | Upstream maintainer merges the PR from TC-13.9 and cuts a release | On Restaba's next scheduled `review-history` run, PR-state reconciliation (UC-14) runs | Original source entry's `status` transitions from `open` to `applied`; Restaba's next `auto-sync` run pulls the new release per UC-1/UC-6 | P2 |

---

## 14. Cross-Cutting: Idempotency, Concurrency, Data Integrity

| TC ID | UC Ref | FR Ref | Title | Type | Preconditions | Steps | Expected Result | Priority |
|---|---|---|---|---|---|---|---|---|
| TC-14.1 | NFR-2 | NFR-2 | Every scheduled run writes a record, including all no-op shapes | dry-run fixture | Run `auto-sync` (no update) and `review-history` (zero open deltas) repeatedly | Inspect `scheduled-runs/`/`history/` after each run | A run record exists for every single invocation, with no exceptions, satisfying Risk 20's sole liveness signal | P0 |
| TC-14.2 | NFR-3 | FR-A10 | Repeated cron fires never accumulate duplicate branches or issues | dry-run fixture | Simulate 3 consecutive scheduled fires of `auto-sync` against the same pending-conflict state | Run `/auto-sync` 3 times | Exactly one branch and one issue exist across all 3 runs; each run after the first records `partial` and takes no further action | P0 |
| TC-14.3 | NFR-4 | FR-B7 | 3-PR cap holds across a single run even with more CORE candidates queued | dry-run fixture | 5 CORE-targeted open deltas in one `review-history` run | Run `/review-history` | Exactly 3 PR-creation attempts occur; the remaining 2 deltas are left `open` for a future run, not force-processed | P0 |
| TC-14.4 | Risk 22/23 | — | Overlapping schedules degrade to a visible `partial`, not silent corruption | dry-run fixture (simulated) | `auto-sync` and `review-history` triggered concurrently against the same working tree | Simulate near-simultaneous invocation | The clean-tree guard causes the second-starting process to see a dirty/locked tree and record a non-`success`/`partial` outcome rather than corrupting state or double-committing | P1 |
| TC-14.5 | NFR-5 | FR-C13, FR-B12 | Cross-skill: every externally-sourced value validated before shell/`gh api`/branch/PR-title interpolation | code review / dry-run fixture | Enumerate all interpolation points across `auto-sync`, `review-history`, `propose-to-core` (release tags, `delta_target`, slugs, entry paths) | Trace each interpolation point back to its validation step | Every one of: release tag (`^v?[0-9]+\.[0-9]+\.[0-9]+$`), `delta_target` (repo-relative, no `..`/leading `/`, `[A-Za-z0-9._/-]`), slug (`[a-z0-9-]`), entry path (resolves inside repo root) is validated immediately before its first use, in all three skills | P0 |

---

## 15. Traceability Matrix (Use Case → Test Case Coverage)

| UC | Covered by |
|---|---|
| UC-1, UC-1-A, UC-1-B, UC-1-EC1 | TC-1.1–TC-1.6 |
| UC-2 | TC-1.6 |
| UC-3-E1 | TC-1.7 |
| UC-4-A, UC-4-B | TC-1.16, TC-1.17 |
| UC-5-E1 | TC-1.11 |
| UC-6, UC-6-E1 | TC-1.12, TC-1.13 |
| UC-7 | TC-1.14 |
| UC-8-E1 | TC-1.15 |
| UC-9-A, UC-9-E1 | TC-1.18, TC-1.19 |
| UC-10-A | TC-1.20 |
| UC-11-E1 | TC-1.8, TC-1.9, TC-1.10 |
| UC-12 | TC-1.21, TC-1.22 |
| UC-13, UC-13-A, UC-13-B, UC-13-C, UC-13-E1, UC-13-EC1 | TC-2.1–TC-2.8, TC-2.13–TC-2.17 |
| UC-14, UC-14-A | TC-2.9–TC-2.12 |
| UC-15 | TC-2.3 |
| UC-16 | TC-3.1–TC-3.13, TC-4.1, TC-4.2, TC-4.8, TC-4.9 |
| UC-17, UC-17-A | TC-4.3, TC-4.4, TC-11.1 |
| UC-18-E1 | TC-4.5 |
| UC-19-A | TC-3.8, TC-3.9, TC-3.10 |
| UC-20-E1 | TC-3.5 |
| UC-21-E1 | TC-3.6 |
| UC-22-E1 | TC-4.6 |
| UC-23 | TC-3.13 |
| UC-24 | TC-5.1, TC-5.2 |
| UC-25-E1 | TC-5.3, TC-5.4, TC-5.5 |
| UC-26-E1 | TC-5.6 |
| UC-27-E1 | TC-5.7, TC-5.8 |
| UC-28 | TC-13.7–TC-13.12 |

All 28 use cases (and their alternative/error/edge-case sub-flows) have at least one mapped test case.

---

## 16. Negative / Malicious Input Cases (Consolidated Reference)

For quick audit, every negative/adversarial test case across this document:

| TC ID | Attack/Defect Class | Skill | Result |
|---|---|---|---|
| TC-1.3 | Malformed release tag | `auto-sync` | Rejected, never reaches `--vcs-ref`/branch name |
| TC-2.14 | Path traversal `delta_target` (`../../etc/passwd`) | `review-history` | Rejected, never drives classification or downstream command |
| TC-2.15 | Leading-slash `delta_target` | `review-history` | Rejected |
| TC-2.16 | Shell-metacharacter `delta_target` | `review-history` | Rejected, never interpolated |
| TC-2.17 | Shell-metacharacter `proposed_delta` free text | `review-history` | Never interpolated; slug always re-derived/sanitized |
| TC-3.3 | Path traversal `delta_target` at input | `propose-to-core` | Rejected before classification |
| TC-3.4 | Entry path outside repo root | `propose-to-core` | Rejected |
| TC-4.4 | Org-fork attempt | `propose-to-core` | Structurally impossible — user-account-only fork target |
| TC-4.10 | Unsanitized slug into branch/PR title | `propose-to-core` | Sanitized to `[a-z0-9-]` before interpolation |
| TC-5.3–TC-5.6 | Company data / secrets in PR bundle | `redaction-reviewer` | FAIL, findings naming the specific class(es) |
| TC-5.7, TC-5.8 | Uncertain/hedged redaction verdict | `redaction-reviewer` / `propose-to-core` | Treated as FAIL; only the exact literal `REDACTION: PASS` authorizes a write |
