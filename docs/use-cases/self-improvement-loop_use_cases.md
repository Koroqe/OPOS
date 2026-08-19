# Use Cases: Bidirectional Self-Improvement Loop (v0.9.0)

> Based on [PRD](../PRD.md) §1, and the approved plan `since-we-are-working-tranquil-sunrise.md` (wins on any conflict) and `docs/architecture/self-improvement-loop_ground-truth.md`.

---

## UC-1: `auto-sync` — clean scheduled sync (happy path)

**Actor**: `auto-sync` CORE skill (owner: chief-of-staff), invoked by the scheduler (`runtime: claude-schedule`)
**Preconditions**: repo is a scaffolded consumer (`.copier-answers.yml` present); working tree clean; no competing sync driver active; `auto-sync` scheduled with `authority: [commit, push, file_issue]`
**Trigger**: cron fires `/auto-sync` non-interactively

### Primary Flow (Happy Path)
1. Clean-tree guard passes.
2. Preflight: grep `.github/workflows/sync-opos.yml` for an uncommented `schedule:` block — absent, continue.
3. Probe upstream directly via `gh api repos/<upstream>/releases`, bypassing the 6h `check-for-updates` cache; refresh `.claude/.last-update-check` after the probe.
4. Release tag validated against `^v?[0-9]+\.[0-9]+\.[0-9]+$`.
5. New release found. `git fetch origin && git merge --ff-only origin/<default-branch>` succeeds.
6. Branch `opos-auto-sync-<tag>` created.
7. `copier update --vcs-ref <tag> --conflict rej --defaults` runs; zero `.rej` files produced.
8. Commit `chore: auto-sync OPOS core <tag>`; sha recorded in the run entry.
9. ff-merge branch to main; push; delete the branch.
10. Write a `success` run record.

**Postconditions**: main is at the new tag, pushed; `.claude/.last-update-check` refreshed; a `success` record exists with the commit sha; the sync branch no longer exists.

### Alternative Flows
- **UC-1-A: manual invocation** — a human runs `/auto-sync` interactively; behavior is otherwise identical, but the run record is written to `history/` (not `scheduled-runs/`) per the CORE prelude routing convention (FR-A15).
- **UC-1-B: dry run** — `/auto-sync --dry_run` performs steps 1-5 (probe only) and prints the would-be action (update available / not, target tag) with zero mutations: no branch, no commit, no push, no record write.

### Error Flows
(see UC-2 through UC-10 for the non-happy branches of this same skill)

### Edge Cases
- **UC-1-EC1**: release tag from `gh api` fails the `^v?[0-9]+\.[0-9]+\.[0-9]+$` validation (malformed/pre-release tag) — the tag MUST NOT be used in `--vcs-ref` or a branch name; treat as no valid update this run.

### Data Requirements
- **Input**: upstream release list (`gh api`), current pin (`.copier-answers.yml`), local git state
- **Output**: updated working tree, new commit on main, `success` record (with sha)
- **Side Effects**: local commit, remote push, `.claude/.last-update-check` file write, temporary branch created and deleted

---

## UC-2: `auto-sync` — no update available

**Actor**: `auto-sync`
**Preconditions**: same as UC-1; upstream's latest release ≤ current pin
**Trigger**: scheduled or manual invocation

### Primary Flow (Happy Path)
1. Steps 1-4 of UC-1 (guard, preflight, probe, tag validation).
2. Probe determines no newer release exists.
3. `auto-sync` still writes a `success` run record with a one-line note (e.g. "no update available, pinned at v0.8.1").
4. Run stops — no branch, no commit.

**Postconditions**: a `success` record exists for this run (satisfies NFR-2 liveness / Risk 20); no repo mutation.

### Data Requirements
- **Input**: upstream release list, current pin
- **Output**: `success` record with note
- **Side Effects**: none beyond the run record and (per UC-1 step 3) the last-update-check refresh

---

## UC-3: `auto-sync` — dirty working tree

**Actor**: `auto-sync`
**Preconditions**: uncommitted changes exist in the working tree at run time
**Trigger**: scheduled or manual invocation

### Error Flows
- **UC-3-E1: dirty-tree guard blocks the run** — the clean-tree guard (UC-1 step 1) fails before any probe or mutation; `auto-sync` records the run (not `success`) and stops without touching the tree.

### Data Requirements
- **Output**: a run record reflecting the guard failure (not `success`)
- **Side Effects**: none — no probe, no branch, no commit

---

## UC-4: `auto-sync` — pending-conflict idempotency and stale-branch self-heal

**Actor**: `auto-sync`
**Preconditions**: a branch named `opos-auto-sync-<tag>` already exists from a prior run
**Trigger**: scheduled or manual invocation, where an update is available

### Alternative Flows
- **UC-4-A: stale-branch self-heal** — the pre-existing branch's `<tag>` is ≤ the current pin (i.e. already applied/superseded). `auto-sync` deletes the stale branch and proceeds with the normal UC-1 flow for the current probe result.
- **UC-4-B: pending-conflict idempotency** — the pre-existing branch's `<tag>` is still newer than the current pin (a genuine unresolved conflict from a prior run). `auto-sync` verifies the corresponding GitHub issue is still open, records `partial`, and stops without creating a second branch or a duplicate issue.

**Postconditions (UC-4-A)**: stale branch removed; run proceeds to either UC-1 or another applicable flow for the current tag.
**Postconditions (UC-4-B)**: branch untouched, issue untouched, `partial` record written; the run is idempotent — no duplicate branches or issues accumulate across repeated cron fires.

### Data Requirements
- **Input**: existing branch name/tag, `gh issue` state
- **Side Effects**: branch deletion (UC-4-A only); no side effects in UC-4-B beyond the record

---

## UC-5: `auto-sync` — diverged main (ff-only guard)

**Actor**: `auto-sync`
**Preconditions**: main has diverged from `origin/<default-branch>` such that a fast-forward merge is impossible
**Trigger**: scheduled or manual invocation, after the clean-tree guard passes and an update is available

### Error Flows
- **UC-5-E1: ff-only merge fails** — `git merge --ff-only origin/<default-branch>` fails before branching. `auto-sync` MUST escalate (never proceed with the sync): open a consumer-repo GitHub issue and record `partial`.

**Postconditions**: no `opos-auto-sync-<tag>` branch is created; main is left in its diverged state for human resolution; `partial` record written; issue opened in the consumer's own repo (resolved via `gh repo view --json nameWithOwner`).

### Data Requirements
- **Side Effects**: `gh issue create`; `partial` run record

---

## UC-6: `auto-sync` — CHANGELOG-only `.rej` auto-resolution

**Actor**: `auto-sync`
**Preconditions**: `copier update` produces exactly one `.rej` file, `CHANGELOG.md.rej`, whose hunk is purely additive (a new `## [x.y.z]` version section)
**Trigger**: step 7 of UC-1 produces this specific `.rej` shape

### Primary Flow (Happy Path)
1. `copier update` completes; the only `.rej` present is `CHANGELOG.md.rej`.
2. `auto-sync` inspects the hunk: purely additive new version section — no other content.
3. Insert the new `## [x.y.z]` section into `CHANGELOG.md`, positioned below consumer day-blocks and above older version sections.
4. Delete `CHANGELOG.md.rej`.
5. Verify the resulting `CHANGELOG.md` with the canonical awk-extraction pattern.
6. Re-evaluate "zero remaining `.rej`" — true — proceed with UC-1 steps 8-10 (commit, merge, push, `success`).

**Postconditions**: `CHANGELOG.md` contains the new version section in the correct position, day-blocks preserved above it; no `.rej` file remains; run completes as `success`, indistinguishable in outcome from UC-1.

### Error Flows
- **UC-6-E1: hunk is not purely additive, or other `.rej` content exists** — auto-resolution does not apply; falls through to UC-7 (multi-`.rej`/non-additive conflict escalation).

### Data Requirements
- **Side Effects**: `CHANGELOG.md` edit, `CHANGELOG.md.rej` deletion, then identical side effects to UC-1

---

## UC-7: `auto-sync` — multi-`.rej` conflict escalation

**Actor**: `auto-sync`
**Preconditions**: `copier update` produces one or more `.rej` files that are NOT the single purely-additive `CHANGELOG.md.rej` case (UC-6)
**Trigger**: step 7 of UC-1 produces this `.rej` shape

### Primary Flow (Happy Path — escalation is the correct terminal state)
1. `copier update` completes with remaining `.rej` file(s).
2. `auto-sync` commits the partial state, including the remaining `.rej` files, on branch `opos-auto-sync-<tag>`.
3. Returns to main (branch left in place, not deleted, not merged).
4. Opens a GitHub issue in the consumer's own repo (`gh repo view --json nameWithOwner` for target, never `task-tracking.config.json`), instructing the human to resolve conflicts on that branch, merge, and delete it.
5. Records `partial` (never `success`).

**Postconditions**: `opos-auto-sync-<tag>` branch exists with committed `.rej` files awaiting human resolution; issue open in consumer repo; `partial` record written; main untouched.

### Data Requirements
- **Side Effects**: local commit on the sync branch, `gh issue create`, `partial` run record

---

## UC-8: `auto-sync` — push failure after successful commit

**Actor**: `auto-sync`
**Preconditions**: UC-1 steps 1-8 succeed (commit created locally) but the subsequent push fails (network, auth, permissions)
**Trigger**: push step of the happy path fails

### Error Flows
- **UC-8-E1: push fails post-commit** — MUST be recorded as `partial` with a consumer-repo issue opened, never reported as `success`, even though the local commit succeeded.

**Postconditions**: local commit exists (on the ff-merged main or the branch, depending on where the push failed); `partial` record; issue opened describing the push failure and required manual push/merge.

### Data Requirements
- **Side Effects**: local commit, `gh issue create`, `partial` run record; no successful remote state change

---

## UC-9: `auto-sync` — degraded environment (no `gh` / no remote)

**Actor**: `auto-sync`
**Preconditions**: `gh` CLI is unavailable, or the repo has no GitHub remote configured
**Trigger**: scheduled or manual invocation where an update is available

### Alternative Flows
- **UC-9-A: no `gh` / no remote** — `auto-sync` commits locally only: no push, no issue (both require `gh`/remote). Records `partial` with an explicit note explaining the degradation.

### Error Flows
- **UC-9-E1: `copier update` fails mid-branch** — regardless of `gh`/remote availability, if `copier update` itself fails partway through, `auto-sync` checks out main, deletes the partially-created branch, and records `failure`.

### Data Requirements
- **Side Effects (UC-9-A)**: local commit only, `partial` record
- **Side Effects (UC-9-E1)**: branch cleanup, `failure` record, no commit

---

## UC-10: `auto-sync` — non-scaffolded repo (the framework repo itself)

**Actor**: `auto-sync`
**Preconditions**: the repo has no `.copier-answers.yml` (i.e. this is the OPOS framework repo itself, not a scaffolded consumer)
**Trigger**: `/auto-sync` invoked (scheduled or manual) in this repo

### Alternative Flows
- **UC-10-A: non-scaffolded posture** — `auto-sync` detects the absence of `.copier-answers.yml`, warns, and exits 0 — mirroring `check-for-updates`'s existing posture. No probe, no mutation, no run record beyond the warning.

### Data Requirements
- **Side Effects**: none; exit 0

---

## UC-11: `auto-sync` — GH-Action mutual-exclusion refusal

**Actor**: `auto-sync`
**Preconditions**: `.github/workflows/sync-opos.yml` contains an uncommented `schedule:` block (the opt-in GitHub Action sync driver is active)
**Trigger**: scheduled or manual invocation, preflight step (UC-1 step 2)

### Error Flows
- **UC-11-E1: competing driver detected** — `auto-sync` refuses to proceed. Records the refusal (not `success`) and files a one-time GitHub issue noting the mutual-exclusion conflict (only once — subsequent runs do not re-file if already open).

**Postconditions**: no probe, no branch, no commit; issue exists (once) documenting the two-driver conflict; documented limitation: a renamed/copied workflow file evades this specific grep-based check (operator responsibility, per README).

### Data Requirements
- **Side Effects**: `gh issue create` (first occurrence only), non-`success` run record

---

## UC-12: `auto-sync` — manual invocation vs scheduled invocation (routing)

**Actor**: chief-of-staff (scheduled) or a human operator (manual)
**Preconditions**: `auto-sync` is invoked either via cron (`runtime: claude-schedule`, non-interactive prelude present) or directly by a human in an interactive session
**Trigger**: either invocation path

### Primary Flow (Happy Path)
1. `auto-sync` runs identically regardless of invocation source (same probe/update/commit logic).
2. Run-record routing follows the CORE prelude convention: if the non-interactive scheduled prelude is present, the record is written to `scheduled-runs/` (gitignored); if absent (manual/interactive), it is written to `history/` (committed).

**Postconditions**: exactly one run record exists, in the correct location for the invocation type; no record is ever written to both locations for the same run.

### Data Requirements
- **Output**: one run record in `scheduled-runs/*.md` (scheduled) or `history/*.md` (manual)

---

## UC-13: `review-history` — weekly triage of open deltas

**Actor**: `review-history` CORE skill (owner: coo), invoked by the scheduler (`schedule: "23 7 * * 1"`)
**Preconditions**: repo has one or more `history/*.md` / `scheduled-runs/*.md` entries with `status: open` and `proposed_delta` ≠ `none`; `authority: [commit, push, write_proposal, file_issue, open_pr]`
**Trigger**: weekly cron fires `/review-history`

### Primary Flow (Happy Path)
1. Work happens on branch `review-history/<date>`.
2. Glob `**/history/*.md` and `**/scheduled-runs/*.md`.
3. PR-state reconciliation runs first (see UC-14) for any entry/ledger line carrying `upstream_pr:`.
4. Collect all `status: open` entries whose `proposed_delta` ≠ `none`.
5. Classify each via `delta_target` hint (re-validated), else inference, else the two-part runtime test (FR-E).
6. Triage each entry:
   - CORE-targeted → route to `propose-to-core`, capped at 3 actual upstream PR creations this run (see UC-16, UC-25).
   - STARTER/local within threshold (≤2 files, ≤20 changed lines, no sensitive path) → apply and commit directly (see UC-13-A).
   - STARTER/local above threshold → `write_proposal` to the owning department's backlog (see UC-13-B).
   - Nonsensical/stale → mark `rejected` with a reason, not silently dropped.
7. Every touched entry receives a dated triage note.
8. ff-merge `review-history/<date>` to main.

**Postconditions**: each open delta has moved to a new state (applied, drafted, PR-routed, or rejected) with a dated note; branch ff-merged and cleaned up.

### Alternative Flows
- **UC-13-A: small STARTER delta applied directly** — delta touches ≤2 files, ≤20 changed lines, and no sensitive path (any segment containing `auth`, `payment`, `billing`, `secret`, `migration`; `.claude/settings.json`; `.github/workflows/`) → `review-history` edits and commits the change directly on `review-history/<date>`, then ff-merges.
- **UC-13-B: oversized STARTER delta → `write_proposal`** — delta exceeds the threshold (file count, line count, or touches a sensitive path) → `review-history` MUST NOT edit directly; instead calls `write_proposal` against the owning agent's department backlog.
- **UC-13-C: stale delta → rejected** — a delta judged nonsensical or no longer applicable is marked `rejected` with an explicit reason in the triage note (never silently dropped).

### Error Flows
- **UC-13-E1: malicious `delta_target` rejected by validation** — a `delta_target` hint like `../../etc/passwd` fails re-validation (must be repo-relative, no `..`, no leading `/`, charset `[A-Za-z0-9._/-]`, must resolve inside the repo root). The entry is rejected/flagged rather than used to drive classification or any downstream command.

### Edge Cases
- **UC-13-EC1: zero open deltas** — `review-history` MUST still write a `success` run record with a one-line note (e.g. "no open deltas this run") — never a silent no-op.

### Data Requirements
- **Input**: all `history/*.md` and `scheduled-runs/*.md` entries with `status: open`
- **Output**: updated entry statuses/notes, `success`/`partial` run record, possibly commits, backlog proposals, and up to 3 PRs
- **Side Effects**: local commits on `review-history/<date>`, ff-merge to main, `write_proposal` calls, `propose-to-core` invocations, GitHub issues (reconciliation), the 3-PR cap enforcement

---

## UC-14: `review-history` — PR-state reconciliation

**Actor**: `review-history`
**Preconditions**: one or more entries or ledger lines carry an `upstream_pr:` URL from a prior `propose-to-core` run
**Trigger**: step 3 of UC-13, runs first in every `review-history` invocation

### Primary Flow (Happy Path)
1. For each `upstream_pr:` value, call `gh pr view --json state,merged`.
2. **Merged** → set the corresponding entry's `status: applied`.
3. **Closed, unmerged** → open a consumer-repo issue for human decision; entry stays `status: open` with a note.
4. **Still open** → skip (no state change).

**Postconditions**: every tracked PR's local state accurately reflects its upstream state; no entry with a merged PR remains `open`.

### Alternative Flows
- **UC-14-A: closed-unmerged** — see step 3; distinct terminal state from merged/open.

### Data Requirements
- **Input**: `gh pr view --json state,merged` per tracked PR
- **Output**: updated `status` fields, issue for closed-unmerged case
- **Side Effects**: `gh issue create` (closed-unmerged only)

---

## UC-15: `review-history` — dry run

**Actor**: `review-history`
**Preconditions**: same as UC-13
**Trigger**: `/review-history --dry_run` (manual)

### Primary Flow (Happy Path)
1. Steps 1-6 of UC-13 are computed (glob, reconcile-state lookups, classify, triage decisions) but no entry is modified, no commit is made, no `write_proposal`/`propose-to-core`/issue call executes.
2. Prints the full triage table (entry, classification, decision, target).

**Postconditions**: zero mutations; repo state identical before and after.

### Data Requirements
- **Output**: printed triage table only

---

## UC-16: `propose-to-core` — full happy path, direct-branch write (maintainer-consumer)

**Actor**: `propose-to-core` CORE skill (owner: chief-of-staff), invoked by `review-history` or manually
**Preconditions**: input is a valid history/scheduled-run entry path (resolves inside repo root) or an inline defect description + explicit `delta_target`; the consumer's `gh` identity has push rights on the upstream repo (e.g. Restaba/koroqe on `Koroqe/OPOS`)
**Trigger**: `review-history` routes a CORE-targeted delta, or a human invokes `/propose-to-core` directly

### Primary Flow (Happy Path)
1. **Input validation**: entry path resolves inside repo root, or `delta_target` validated (repo-relative, no `..`/leading `/`, charset `[A-Za-z0-9._/-]`).
2. **Classify**: two-part runtime test confirms the target is upstreamable (not STARTER/local, and exists in the upstream repo — `.jinja` variant checked first).
3. **Dedupe**: check `proposals/LEDGER.md` and `gh pr list --repo <upstream> --state all --json title,url,state --limit 200`, matching locally by the `[opos-core] <file-slug>: <title>` slug — no match found.
4. **Draft**: against actual upstream file content; runs the canonical redaction checklist as a self-pass.
5. **Adversarial review**: assemble identifier blocklist (COMPANY_NAME, dept/agent names, repo `nameWithOwner`, git author names/emails) + candidate diff/PR body/branch name/commit message; spawn `redaction-reviewer` (UC-22). Verdict: `REDACTION: PASS`.
6. **Write path**: `gh api repos/<upstream> --jq .permissions.push` returns true → branch directly on the upstream repo, forced neutral identity `git -c user.name="opos-consumer" -c user.email="opos-consumer@users.noreply.github.com"`.
7. Branch named `propose/<file-slug>-<YYYYMMDD>`; `gh pr create --repo <upstream>` with title `[opos-core] <file-slug>: <title>`, body from `core-proposal-pr.md.tmpl`.
8. Append + commit a `proposals/LEDGER.md` line (date, delta_target, slug, source-entry path, PR URL, outcome `pr`).
9. Best-effort-annotate the source entry with `upstream_pr: <url>`; `status` stays `open` (not `applied`).

**Postconditions**: a real PR open on the upstream repo, content-free of company-identifying data and secrets; ledger line committed; source entry annotated and still `open`.

### Data Requirements
- **Input**: source entry or inline defect + `delta_target`, upstream file content, `gh` identity permissions
- **Output**: upstream PR, ledger line, annotated source entry
- **Side Effects**: branch/commit/push on the upstream repo, `gh pr create`, local ledger commit, best-effort entry annotation

---

## UC-17: `propose-to-core` — fork path (third-party consumer, no push rights)

**Actor**: `propose-to-core`
**Preconditions**: same as UC-16 through the adversarial review PASS, but `gh api repos/<upstream> --jq .permissions.push` returns false
**Trigger**: write-path decision step (UC-16 step 6) evaluates false

### Alternative Flows
- **UC-17-A: fork-and-PR** — `gh repo fork --clone=false --default-branch-only` into the invoking **user account only** (never a company org); shallow-clone to scratch; branch there with the same forced neutral identity; push; `gh pr create --repo <upstream>` from the fork. Ledger and annotation steps proceed identically to UC-16 steps 8-9.

**Postconditions**: PR open on the upstream repo, sourced from a personal-account fork, never an org fork; identical content-safety guarantees as UC-16; ledger line and annotation recorded.

### Data Requirements
- **Side Effects**: `gh repo fork` (user account), shallow clone, branch/commit/push on the fork, `gh pr create`, ledger commit, entry annotation

---

## UC-18: `propose-to-core` — redaction FAIL → local draft + issue

**Actor**: `propose-to-core`
**Preconditions**: draft assembled (UC-16 steps 1-4 complete); adversarial review returns anything other than the literal `REDACTION: PASS` (including an uncertain verdict)
**Trigger**: step 5 of UC-16 (adversarial review) returns FAIL/uncertain

### Error Flows
- **UC-18-E1: FAIL/uncertain verdict** — `propose-to-core` MUST NOT write anything upstream. Falls back to: commit a local draft at `proposals/<date>-<slug>.md` including the reviewer's findings; open a consumer-repo issue; leave the source entry `open` with a note; append a ledger line with outcome `draft`.

**Postconditions**: no upstream write of any kind occurred; local draft committed with findings; issue open in consumer repo; ledger reflects the `draft` outcome.

### Data Requirements
- **Side Effects**: local commit (`proposals/<date>-<slug>.md`), `gh issue create`, ledger line (outcome `draft`), entry note

---

## UC-19: `propose-to-core` — dedupe skip (ledger hit or PR-title slug hit)

**Actor**: `propose-to-core`
**Preconditions**: a prior proposal for the same `delta_target`/slug already exists, either as a `proposals/LEDGER.md` line or as an existing upstream PR whose title matches the `[opos-core] <file-slug>: <title>` convention
**Trigger**: dedupe step (UC-16 step 3)

### Alternative Flows
- **UC-19-A: dedupe skip** — the run stops with a note recorded against the source entry (and/or run record); no draft, no redaction review, no PR, no new ledger line for this attempt beyond the skip note.

**Postconditions**: no duplicate PR created; source entry annotated with the dedupe reason.

### Data Requirements
- **Input**: `proposals/LEDGER.md`, `gh pr list --repo <upstream> --state all --json title,url,state --limit 200`
- **Side Effects**: entry note only (no ledger append, no PR)

---

## UC-20: `propose-to-core` — STARTER-target abort

**Actor**: `propose-to-core`
**Preconditions**: classification (UC-16 step 2) determines the target is STARTER/local, not upstreamable
**Trigger**: classification step

### Error Flows
- **UC-20-E1: STARTER classification** — `propose-to-core` MUST abort with guidance directing the caller to apply the change via `review-history` instead (never drafts a PR for a STARTER/local target).

**Postconditions**: no draft, no review, no PR; caller informed to use `review-history`'s local-apply/backlog path instead.

### Data Requirements
- **Side Effects**: none beyond the abort message/note

---

## UC-21: `propose-to-core` — copier.yml fetch failure → human-draft path

**Actor**: `propose-to-core`
**Preconditions**: classification step attempts `gh api repos/<owner>/<repo>/contents/copier.yml` (or the upstream file-existence probe) and the call fails (network, auth, rate limit)
**Trigger**: classification step (UC-16 step 2)

### Error Flows
- **UC-21-E1: classification-fetch failure** — `propose-to-core` MUST NEVER guess a classification. Aborts to the human-draft path (equivalent terminal shape to UC-18: local draft, issue, entry left `open` with note, ledger line with an appropriate outcome).

**Postconditions**: no classification decision was guessed; human-draft fallback state as in UC-18.

### Data Requirements
- **Side Effects**: same fallback side effects as UC-18

---

## UC-22: `propose-to-core` — no-write-access fallback

**Actor**: `propose-to-core`
**Preconditions**: adversarial review PASSes, but neither the direct-branch path (no push rights) nor the fork path succeeds (e.g. fork creation fails)
**Trigger**: write-path step (UC-16 step 6 / UC-17-A) fails

### Error Flows
- **UC-22-E1: fork/write failure** — falls back to the same human-draft path as UC-18 (local draft with findings — here noting the write/fork failure rather than a redaction FAIL — issue, entry stays `open`, ledger line outcome `draft`).

**Postconditions**: identical fallback shape to UC-18, distinguished only by the recorded reason (write/fork failure vs redaction FAIL).

### Data Requirements
- **Side Effects**: same as UC-18

---

## UC-23: `propose-to-core` — dry run stopping after the adversarial review

**Actor**: `propose-to-core`
**Preconditions**: input valid, classification succeeds as upstreamable, no dedupe hit
**Trigger**: `/propose-to-core --dry_run` (manual, or `review-history`'s rehearsal use)

### Primary Flow (Happy Path)
1. Steps 1-5 of UC-16 execute (validate, classify, dedupe check, draft, self-pass, adversarial review).
2. Run stops immediately after the adversarial review — no write path is evaluated, no branch/fork/PR/ledger/annotation happens.
3. Prints the complete redacted PR preview (title, body, diff) together with both the self-pass and adversarial-review verdicts.

**Postconditions**: zero mutations to the repo, upstream, or ledger; verdicts and preview surfaced for human inspection.

### Data Requirements
- **Output**: printed PR preview + both verdicts only

---

## UC-24: `redaction-reviewer` — PASS on clean generic draft

**Actor**: `redaction-reviewer` company-tier agent, invoked by `propose-to-core` via the consult-agent pattern
**Preconditions**: `propose-to-core` supplies the candidate diff, PR body, branch name, commit message, and an identifier blocklist (COMPANY_NAME value, dept/agent names, repo `nameWithOwner`, git author names/emails); the agent does NOT read the source history entry or the wider repo
**Trigger**: `propose-to-core`'s adversarial review step

### Primary Flow (Happy Path)
1. Agent scans the supplied bundle against all classes: company/product names, person names/emails/handles, business-tied numbers, customer/partner references, industry specifics not required by the fix, internal repo names/URLs/issue numbers, and secrets/credentials (keys, tokens, passwords, connection strings, private URLs/IPs, `.env` values).
2. No matches found against the blocklist or scan classes.
3. Output: empty findings list + the literal verdict line `REDACTION: PASS`.

**Postconditions**: `propose-to-core` proceeds to the write path (UC-16/UC-17).

### Data Requirements
- **Input**: diff, PR body, branch name, commit message, identifier blocklist
- **Output**: findings list (empty), verdict `REDACTION: PASS`

---

## UC-25: `redaction-reviewer` — FAIL on company-identifying data

**Actor**: `redaction-reviewer`
**Preconditions**: the candidate bundle contains a company/product name, person name/email/handle, or another blocklisted/company-identifying element
**Trigger**: same as UC-24

### Error Flows
- **UC-25-E1: company-identifying data found** — agent output is a non-empty findings list naming the specific class(es) matched, and any verdict string other than the exact literal `REDACTION: PASS` counts as FAIL.

**Postconditions**: `propose-to-core` MUST take the fallback path (UC-18) — no upstream write occurs.

### Data Requirements
- **Output**: findings list naming the company-identifying matches, FAIL verdict

---

## UC-26: `redaction-reviewer` — FAIL on secrets/credentials

**Actor**: `redaction-reviewer`
**Preconditions**: the candidate bundle contains an API key, token, password, connection string, private URL/IP, or `.env`-style value
**Trigger**: same as UC-24

### Error Flows
- **UC-26-E1: secret/credential material found** — findings list names the secrets/credentials class specifically (distinct from the company-identifying classes); FAIL verdict.

**Postconditions**: `propose-to-core` MUST take the fallback path (UC-18) — no upstream write occurs, regardless of how clean the rest of the bundle is.

### Data Requirements
- **Output**: findings list naming the secret/credential matches, FAIL verdict

---

## UC-27: `redaction-reviewer` — FAIL on uncertainty

**Actor**: `redaction-reviewer`
**Preconditions**: the bundle contains ambiguous content the agent cannot confidently classify as clean or as a leak
**Trigger**: same as UC-24

### Error Flows
- **UC-27-E1: uncertain verdict is FAIL** — any expression of uncertainty (hedged language, "possibly", "unclear if...") is NOT `REDACTION: PASS` and MUST be treated as FAIL by `propose-to-core` — the fail-closed contract admits no third state.

**Postconditions**: `propose-to-core` MUST take the fallback path (UC-18); the exact literal string `REDACTION: PASS` is the only value that authorizes a write.

### Data Requirements
- **Output**: findings/notes describing the uncertainty, non-PASS verdict string

---

## UC-28: End-to-end — the closing loop

**Actor**: the OPOS ecosystem (a consumer instance running `auto-sync` + `review-history`, plus the upstream maintainer)
**Preconditions**: a consumer's agent records a `proposed_delta` targeting a CORE file in a `history/`/`scheduled-runs/` entry, with `status: open`; both `auto-sync` and `review-history` are scheduled on the consumer
**Trigger**: the weekly `review-history` cron fires and eventually the upstream maintainer merges the resulting PR and cuts a release

### Primary Flow (Happy Path)
1. `review-history` triages the open delta (UC-13), classifies it as CORE-targeted, and routes it to `propose-to-core` (within the 3-PR-per-run cap).
2. `propose-to-core` drafts, self-passes, and passes adversarial review (`REDACTION: PASS`) — UC-16 or UC-17 depending on push rights.
3. An anonymized PR opens on the upstream repo (`[opos-core] <file-slug>: <title>`); ledger line committed; source entry annotated `upstream_pr: <url>`, stays `open`.
4. The upstream maintainer reviews the PR per `MAINTAINER.md`'s incoming-PR triage guidance (genericity check, no leaked data/secrets, `.jinja`-form correctness, scaffold smoke test) and merges it.
5. The maintainer cuts a new release (e.g. via `/release-from-changelog`).
6. On its next scheduled run, `auto-sync` (on this consumer, and on every other consumer with `auto-sync` scheduled) probes, finds the new release, and pulls it via UC-1 (or UC-6 if the only diff is an additive CHANGELOG section).
7. On its next weekly run, `review-history`'s PR-state reconciliation step (UC-14) detects the PR is now merged and sets the original source entry's `status: applied`.

**Postconditions**: the operational lesson that originated as a local `proposed_delta` is now upstream, released, and pulled by every consumer running the two scheduled processes with zero further human action beyond the one-time maintainer merge; the originating entry's lifecycle is fully closed (`open` → PR opened → `applied`).

### Data Requirements
- **Input**: the originating `proposed_delta` entry
- **Output**: upstream PR → merged → release → pulled by fleet; originating entry `status: applied`
- **Side Effects**: spans both repos — consumer-side commits/branches/PR, upstream merge/release, and every scheduled consumer's subsequent `auto-sync` commit
