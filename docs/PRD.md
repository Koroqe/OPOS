# Product Requirements

This `docs/` tree is framework-development documentation for building OPOS itself (PRDs, use cases, QA test cases, architecture reviews produced by the `claude-code-sdlc` pipeline). It is **excluded from consumer scaffolds** (Copier `_exclude`, Slice U10b) — no consumer instance ever receives this folder. Consumer-facing documentation lives in `README.md.jinja`, `RISKS.md.jinja`, `MAINTAINER.md`, and `company/knowledge-base/glossary.md`, all of which are separate CORE/STARTER artifacts.

<!-- Sections appended per feature by prd-writer -->

## 1. Bidirectional Self-Improvement Loop (v0.9.0)

**Status:** Approved. Source of truth: implementation plan `since-we-are-working-tranquil-sunrise.md` (survived 3 adversarial `plan-critic` loops) and `docs/architecture/self-improvement-loop_ground-truth.md` (Slice U0 findings). **The plan wins on any conflict with this document.**

### 1.1 Feature description

OPOS is distributed as a Copier template (`gh:Koroqe/OPOS`) that downstream company repos scaffold from. Today the update flow is one-way and half-manual: `check-for-updates` detects new releases but a human must run `/sync-from-core` and commit, and there is no path for a consumer's operational learnings to flow back upstream. Every process run already records a `proposed_delta` in its `history/` entry, but nothing consumes those deltas.

This feature makes the OPOS ecosystem bidirectionally self-improving, purely through Claude Code agentic mechanisms (no side software, no external CI service):

1. **PULL** — a new scheduled CORE skill `auto-sync` autonomously pulls upstream releases: clean syncs auto-commit; conflicts escalate via a GitHub issue opened in the consumer's own repo.
2. **PUSH** — a new scheduled CORE skill `review-history` (owner: coo) triages `status: open` proposed-delta entries from process history. STARTER/local targets are applied directly (within an objective size/sensitivity threshold) or drafted to the owning department's backlog. CORE-file targets are routed to a new skill `propose-to-core` (owner: chief-of-staff), which drafts a generic, fully anonymized fix, passes it through a fail-closed adversarial redaction review performed by a new agent `redaction-reviewer` (scanning for both company-identifying data and secrets/credentials), and opens a PR against the upstream repo — direct-branch when the consumer's `gh` identity has push rights, otherwise a user-account fork (never a company org), always under a neutral commit identity.
3. **CLOSE THE LOOP** — the maintainer merges and releases upstream; every consumer with `auto-sync` scheduled picks it up on its next run.

Why: without this loop, every operational lesson a consumer's agents learn (a broken framework instruction, a missing validation, a stale claim in a CORE doc) is either lost or requires a human to notice, generalize, anonymize, and manually PR it upstream — which in practice does not happen, evidenced by Restaba's one real open delta sitting untouched at `status: open` against a CORE file it cannot legally edit locally.

### 1.2 Goals

- G1. A consumer with both processes scheduled requires zero human action to pull a clean upstream release.
- G2. A consumer whose sync hits a conflict is notified via an issue in its own repo, with a self-healing path once resolved.
- G3. An operational lesson recorded as a `proposed_delta` against a CORE file becomes, without further human drafting effort, a genuinely anonymized PR against the upstream repo — gated by a fail-closed second-agent redaction review.
- G4. The loop is demonstrated once end-to-end for real: Restaba's pre-existing open delta becomes a real PR on `Koroqe/OPOS`.
- G5. No company-identifying data or secret/credential material ever leaves a consumer machine as part of an automated PR's diff, body, branch name, or commit message.

### 1.3 Non-goals (explicitly deferred)

- NG1. **Founder console rendering of the new fields.** `ui/data.py` does not read `scheduled-runs/` or the two new schema fields (`delta_target`, `upstream_pr`) in this release. Recorded as a company-backlog item; not a v0.9.0 deliverable.
- NG2. **Sandbox-grade enforcement of redaction and authority boundaries.** Both the redaction reviewer's scan and the scheduled-run authority allow-list are prompt-convention enforcement, not a technical sandbox — the same accepted posture as the framework's existing Risk 18. Mitigated by fail-closed contracts, dry-run modes, and human fallback paths, not by a sandbox.

### 1.4 User stories

- **As the framework maintainer**, I want incoming `[opos-core]` PRs to arrive already anonymized and redaction-reviewed, so that I can triage and merge community-sourced fixes without doing the anonymization work myself or risking a leak.
- **As a consumer-repo founder** (e.g. Restaba), I want my company's instance to pull framework updates automatically when they're safe, and to flag a GitHub issue in my own repo when they're not, so that I don't have to remember to run a manual sync.
- **As a consumer-repo founder**, I want a mistake my agents made that traces back to a framework bug to become an anonymized upstream contribution automatically, so that the fix benefits every other company running OPOS without me writing a PR myself or leaking my company's identity or secrets in the process.
- **As a third-party consumer with no push rights on the upstream repo**, I want `propose-to-core` to still be able to open a PR (via a personal-account fork), so that the loop works identically regardless of my relationship to the maintainer.

### 1.5 Functional requirements

Requirement IDs mirror the plan's "Design decisions (resolved)" table and slices U1–U10c; each FR names the plan slice(s) it formalizes.

#### A. Skill: `auto-sync` (PULL) — owner: chief-of-staff (Slices U1, U2)

- FR-A1. `auto-sync` MUST run as a scheduled CORE skill (`process_name: auto-sync`, `runtime: claude-schedule`, `non_interactive: true`, `authority: [commit, push, file_issue]`).
- FR-A2. On each run, `auto-sync` MUST probe the upstream repo's releases directly via `gh api` — bypassing the 6-hour `check-for-updates` cache — and MUST refresh `.claude/.last-update-check` afterwards. This bypass is scoped to `auto-sync` only and does not alter `check-for-updates`'s own documented probe-skip exception.
- FR-A3. Every release tag consumed by `auto-sync` (used in `--vcs-ref` and in branch names) MUST be validated against `^v?[0-9]+\.[0-9]+\.[0-9]+$` before use.
- FR-A4. If no update is available, `auto-sync` MUST still write a `success` run record with a one-line note before stopping (no silent no-op).
- FR-A5. If an update is available, `auto-sync` MUST: guard on a clean tree; verify no other sync driver is active (grep `.github/workflows/sync-opos.yml` for an uncommented `schedule:` block — if present, refuse and record, filing a one-time issue); `git fetch` and `git merge --ff-only` the default branch before branching (ff impossible → escalate as a conflict, never proceed); branch as `opos-auto-sync-<tag>`; run `copier update --vcs-ref <tag> --conflict rej --defaults`.
- FR-A6. **Zero `.rej` files** after `copier update` → commit `chore: auto-sync OPOS core <tag>` (recording the commit sha in the run entry), ff-merge to main, push, delete the branch, write a `success` record.
- FR-A7. **CHANGELOG-only auto-resolution rule:** if the *only* `.rej` produced is `CHANGELOG.md.rej` and the hunk is purely additive (a new `## [x.y.z]` version section), `auto-sync` MUST insert it below consumer day-blocks and above older version sections, delete `CHANGELOG.md.rej`, and verify with the canonical awk pattern before evaluating the "zero remaining `.rej`" condition. Any other `.rej` content or any additional `.rej` file MUST escalate instead.
- FR-A8. **Conflict escalation:** commit the partial state including any remaining `.rej` files on the `opos-auto-sync-<tag>` branch, return to main, and open a GitHub issue in the consumer's own repo (resolved via `gh repo view --json nameWithOwner`, never `task-tracking.config.json`) instructing the human to resolve on that branch, merge, and delete it. Record `partial`, never `success`.
- FR-A9. **Push failure after a successful commit** MUST be recorded as `partial` with a consumer-repo issue, never reported as `success`.
- FR-A10. **Stale-branch self-heal:** a pre-existing `opos-auto-sync-<tag>` branch whose tag is ≤ the current pin MUST be deleted and the run proceeds normally. A branch for a still-newer tag is a pending conflict: verify the issue is still open, record `partial`, and stop.
- FR-A11. **Degraded environments:** no `gh` CLI or no GitHub remote → commit locally only, no push, no issue, record `partial` with an explicit note. `copier update` failing mid-branch → checkout main, delete the branch, record `failure`.
- FR-A12. A non-scaffolded repo (no `.copier-answers.yml` — i.e. the framework repo itself) → warn and exit 0, mirroring `check-for-updates`'s existing posture.
- FR-A13. `auto-sync` MUST support `--dry_run`, performing the probe and printing the would-be action with zero mutations.
- FR-A14. `auto-sync`'s SKILL.md MUST document an explicit Authority mapping: `commit` covers branch create/delete, `copier update` file writes, `.rej` handling, cache refresh, and in-place history-entry annotation; `push` covers pushing the sync branch and the ff-merged default branch; `file_issue` covers the conflict-escalation `gh issue create` call.
- FR-A15. Run records route per the CORE prelude convention: a scheduled invocation writes to `scheduled-runs/` (gitignored); a manual invocation writes to `history/`.

#### B. Skill: `review-history` (PUSH triage) — owner: coo (Slice U7)

- FR-B1. `review-history` MUST run as a scheduled CORE skill (`process_name: review-history`, `authority: [commit, push, write_proposal, file_issue, open_pr]` — `push` is required because invoking `propose-to-core` pushes).
- FR-B2. Work happens on branch `review-history/<date>`, ff-merged to main at the end, per the Scheduled-run authority exception (FR-G below).
- FR-B3. On each run, `review-history` MUST glob `**/history/*.md` and `**/scheduled-runs/*.md` and, **first**, reconcile the state of every entry (and every ledger line) carrying an `upstream_pr:` value: `gh pr view --json state,merged` → merged sets `status: applied`; closed-unmerged opens a consumer-repo issue and the entry stays `open` with a note; still open is skipped.
- FR-B4. `review-history` MUST then collect all `status: open` entries whose `proposed_delta` is not `none`, and classify each as STARTER/local vs. upstreamable per the two-part runtime test (FR-E below), using the entry's `delta_target` hint if present, else inference, else the runtime test.
- FR-B5. **STARTER/local deltas within the objective threshold** (≤ 2 files AND ≤ 20 changed lines AND touches no sensitive path — any path segment containing `auth`, `payment`, `billing`, `secret`, `migration`; `.claude/settings.json`; `.github/workflows/`) MAY be applied and committed directly by `review-history`.
- FR-B6. **STARTER/local deltas above the threshold** MUST be routed to `write_proposal` against the owning agent's department backlog, never edited directly.
- FR-B7. **CORE-targeted deltas** MUST be routed to `propose-to-core`, capped at a maximum of **3** actual upstream PR creations per `review-history` run.
- FR-B8. **CORE files are never edited locally** by `review-history` under any circumstance.
- FR-B9. Nonsensical or stale deltas MUST be marked `rejected` with a reason, not silently dropped.
- FR-B10. A run with zero open deltas MUST still write a `success` run record with a one-line note.
- FR-B11. Every entry touched in a run MUST receive a dated triage note recording what happened to it.
- FR-B12. All externally-sourced input MUST be re-validated before use: a `delta_target` hint is re-validated per FR-F1's rules regardless of source; free-text `proposed_delta` content is never interpolated into shell commands, branch names, or PR titles; slugs are always re-derived by sanitizing to `[a-z0-9-]`; entry paths must resolve inside the repo root.
- FR-B13. `review-history` MUST support `--dry_run`, printing the full triage table without acting on any entry.

#### C. Skill: `propose-to-core` — owner: chief-of-staff (Slices U5, U6)

- FR-C1. `propose-to-core` accepts as input either a `history`/`scheduled-runs` entry path (validated to resolve inside the repo root) or an inline defect description plus an explicit `delta_target`.
- FR-C2. `propose-to-core` MUST classify the target per the two-part runtime test (FR-E). A STARTER/local classification MUST abort with guidance to apply the change via `review-history` instead. A classification-fetch failure (querying upstream repo state) MUST abort to the human-draft path — the skill MUST NEVER guess a classification.
- FR-C3. **Dedupe**, before drafting: check the committed ledger `proposals/LEDGER.md` and `gh pr list --repo <upstream> --state all --json title,url,state --limit 200`, matching locally by the slug embedded in the `[opos-core] <file-slug>: <title>` PR-title convention (server-side `in:title` search is not used — it tokenizes unreliably on `/` and `.`). A match skips with a note.
- FR-C4. **Draft**, against the actual upstream file content (checking the `.jinja` variant first): the skill runs the canonical redaction checklist documented in its own SKILL.md (including the secrets/credentials class) as a self-pass before any second-agent review.
- FR-C5. **Adversarial review**: the orchestrating skill assembles an identifier blocklist (the `COMPANY_NAME` answer value, department/agent names unique to the instance, the consumer repo's `nameWithOwner`, git author names/emails from recent log) plus the candidate diff, PR body, branch name, and commit message, and spawns the `redaction-reviewer` agent (FR-D) against that bundle.
- FR-C6. `--dry_run` MUST stop after the review step, printing the complete redacted PR preview (title, body, diff) together with both the self-pass and adversarial-review verdicts, performing no writes.
- FR-C7. **On `REDACTION: PASS`**, `propose-to-core` MUST determine the write path via `gh api repos/<upstream> --jq .permissions.push`: push rights → branch directly on the upstream repo; no push rights → `gh repo fork --clone=false --default-branch-only` into the invoking **user account only, never a company org**, shallow-cloned to scratch, then branch there.
- FR-C8. All upstream writes MUST use a forced neutral git identity: `git -c user.name="opos-consumer" -c user.email="opos-consumer@users.noreply.github.com"`.
- FR-C9. The branch MUST be named `propose/<file-slug>-<YYYYMMDD>`; the PR MUST be opened via `gh pr create --repo <upstream>` with title `[opos-core] <file-slug>: <title>`.
- FR-C10. On successful PR creation, `propose-to-core` MUST append and commit a line to `proposals/LEDGER.md` (date, delta_target, slug, source-entry path, PR URL, outcome) and best-effort-annotate the source entry with `upstream_pr: <url>`; the source entry's `status` stays `open` (a created PR is not yet `applied`).
- FR-C11. **On `REDACTION: FAIL`, an uncertain verdict, no write access, or a fork failure**, `propose-to-core` MUST fall back to: a committed local draft at `proposals/<date>-<slug>.md` including the reviewer's findings, a consumer-repo issue, the source entry left `open` with a note, and a ledger line recording outcome `draft`.
- FR-C12. Every terminal state of `propose-to-core` (PASS-and-PR, dedupe-skip, STARTER-abort, fetch-failure, FAIL/fallback) MUST write a ledger line, distinct from the run record (which follows the standard prelude routing convention).
- FR-C13. All externally-sourced or agent-derived values interpolated into shell commands, `gh api` paths, branch names, or PR titles MUST be validated first: `delta_target` is repo-relative, contains no `..` or leading `/`, and is restricted to charset `[A-Za-z0-9._/-]`; slugs are sanitized to `[a-z0-9-]`.
- FR-C14. `propose-to-core`'s PROCESS.md carries no scheduling fields — it is invoked by `review-history` or manually, never scheduled directly.

#### D. Agent: `redaction-reviewer` — company-tier (Slice U4)

- FR-D1. `redaction-reviewer` is a new company-tier agent (`.claude/agents/company/redaction-reviewer.md`), CORE, ships to existing consumers as a new file regardless of `_skip_if_exists` semantics.
- FR-D2. Inputs, assembled entirely by the orchestrating `propose-to-core` skill: the candidate diff, PR body, branch name, commit message, and an identifier blocklist. The agent MUST NOT read the source history entry or the wider repo itself.
- FR-D3. Scan classes MUST include: company/product names; person names, emails, and handles; business-tied numbers; customer/partner references; industry specifics not required by the fix; internal repo names/URLs/issue numbers; and a **secrets/credentials class** — API keys, tokens, passwords, connection strings, private URLs/IPs, and `.env`-style values.
- FR-D4. Output MUST be a findings list plus an exact verdict line. The literal string `REDACTION: PASS` is the only passing verdict; anything else — including any expression of uncertainty — is a FAIL.
- FR-D5. The redaction boundary is documented explicitly as a prompt-convention control, not a sandbox guarantee (consistent with the framework's existing Risk 18 posture), mitigated by the fail-closed verdict contract, `propose-to-core`'s own self-pass checklist, `--dry_run`, and the human-fallback path.
- FR-D6. A PR-body template (`shared/templates/core-proposal-pr.md.tmpl`) ships alongside the agent, with sections Problem (generic) / Observed failure mode (anonymized) / Proposed change / How verified, and a footer identifying the PR as submitted via OPOS `propose-to-core`.

#### E. Classification: STARTER/local vs. upstreamable (feeds B, C)

- FR-E1. A path is **STARTER/local** when it matches the upstream repo's `_skip_if_exists` list, fetched at runtime via `gh api repos/<owner>/<repo>/contents/copier.yml` — never hardcoded, since a consumer's local `copier.yml` may be stale relative to upstream.
- FR-E2. A path is **upstreamable** when it is not STARTER/local AND the file exists in the upstream repo, checked by probing `gh api .../contents/<path>` (including the `.jinja` variant and known relocations such as `.github/README.md`).
- FR-E3. `_exclude` alone does NOT mean "not upstreamable" — an `_exclude`d file (e.g. `MAINTAINER.md`, `copier.yml`, `.github/README.md`) that exists upstream is still upstream repo content and classifies as upstreamable; only files matching `_exclude` AND absent from the upstream repo are pure runtime state.
- FR-E4. Any fetch failure at any classification step MUST abort classification and take the human-draft/abort path — the classifier never guesses.

#### F. Schema extensions (Slice U3)

- FR-F1. Two new **optional** fields are added to the history/scheduled-run entry schema: `delta_target:` (a repo-relative file path pointing at the file a `proposed_delta` concerns) and `upstream_pr:` (the URL of an upstream PR opened for that delta). Both are appended after existing fields; existing field ordering, and the existing optional `time:` field, are left unchanged.
- FR-F2. Authoritative documentation of the two fields lives in CORE artifacts only: `shared/templates/scheduled-run.md.tmpl`, `shared/templates/PROCESS.md.tmpl` (both the `## History` and `## Scheduled runs` body lists, not only the frontmatter comment block), the three new SKILL.md files, and the `README.md.jinja` self-improvement section — all of which propagate to consumers on sync.
- FR-F3. STARTER copies (the glossary, root `CLAUDE.md.jinja`'s schema section) receive Migration-note guidance only for existing consumers, since STARTER files do not propagate on sync.
- FR-F4. Root `CLAUDE.md.jinja`'s "Self-improving" principle — which currently claims owner agents "review history and propose deltas to their own PROCESS.md" — MUST be corrected to state that deltas route through `review-history` triage; CORE targets never get edited locally. The equivalent claim in `README.md.jinja` (Slice U8) and in `coo.md` (Slice U9) MUST be corrected identically; all three copies of this incorrect claim are retired together.
- FR-F5. Backward compatibility: an existing consumer's pre-feature history entry (concretely, Restaba's `2026-08-19-setup-restaba.md`) MUST still render unchanged by the console when the new optional fields are absent.

#### G. Governance: the Scheduled-run authority exception (Slice U9, README section)

- FR-G1. A new "Scheduled-run authority exception" is documented once canonically in the consumer `README.md.jinja` self-improvement section, and referenced with a short pointer note in both the chief-of-staff agent's Permission-tiers section and the coo charter (which has no tiers section, so the note stands alone): actions inside a scheduled process's declared `authority:` list are pre-authorized by the human a single time, at `/schedule-process` registration (itself a Confirm-tier action).
- FR-G2. This exception explicitly covers a scheduled process integrating to the default branch: both `auto-sync` and `review-history` do their mutating work on a dedicated branch and ff-merge to main as the sanctioned integration step of the `commit` authority, reconciling with the general "feature branches, never work on main" git rule. Interactive sessions remain governed by the unchanged interactive permission tiers.
- FR-G3. No active `.claude/settings.json` allow-list ships as a template default. Instead, `schedule-process`'s SKILL.md gains a registration step that surfaces the minimal, narrowly-scoped allow entries the process's declared authority requires (e.g. `Bash(copier update:*)`, `Bash(git push origin:*)`, `Bash(gh pr create:*)`, `Bash(gh issue create:*)`, specific read-only `gh api repos/*` patterns) and adds them only with the human's confirmation at registration time. Blanket patterns (`Bash(gh api:*)`, bare `Bash(git push:*)`) MUST NOT be proposed. The template's `.claude/settings.json` stays `{"allow":[],"deny":[]}`.

#### H. Ownership, docs, and test-surface consistency (Slices U8–U10c)

- FR-H1. `auto-sync` and `propose-to-core` are owned by chief-of-staff; `review-history` is owned by coo, mechanizing the coo charter's existing process-improvement mandate. Both charters MUST list all three skills in `owns_processes:`/process bullets as applicable, and all hardcoded narrative counts (skills, agents, templates) MUST be corrected to the actual post-feature counts.
- FR-H2. `README.md.jinja` MUST gain a "The self-improvement loop / Contributing back" section covering: the pull → push → release → pull cycle; the distinction and mutual exclusion between `auto-sync`, `sync-from-core`, and the opt-in GitHub Action sync driver (only one driver per repo); the Scheduled-run authority exception (FR-G1); GitHub account-attribution disclosure (PR author / fork owner is inherent to GitHub, explicitly out of scope for anonymization, with neutral-account guidance); the settings allow-list requirement for non-interactive runs.
- FR-H3. `MAINTAINER.md` MUST gain incoming-PR triage guidance for `[opos-core]`-titled PRs: genericity check, no leaked company data or secrets, `.jinja`-form correctness, scaffold smoke test before merge.
- FR-H4. RISKS entries MUST be added: outbound data/secret leak via upstream PRs; auto-commit propagating a bad release fleet-wide; upstream PR spam; fork/auth unavailability. Existing concurrency and double-firing risk entries MUST be extended to cover the two new scheduled processes.
- FR-H5. `ui/tests/` and `ui/smoke.sh` assertions on skill/agent/template counts and on the scheduled-run schema's expected field set MUST be updated to match the post-feature counts and 13-field schema (11 existing + `delta_target` + `upstream_pr`).
- FR-H6. `copier.yml` MUST exclude the feature's SDLC documentation paths from consumer scaffolds, and MUST add `.claude/skills/propose-to-core/proposals/LEDGER.md` to `_skip_if_exists` (the ledger ships once, then is consumer-mutated — without this, the first upstream edit to the ledger's own header produces an unresolvable `.rej` in every active consumer).
- FR-H7. The upstream `CHANGELOG.md` MUST gain an awk-extractable `## [0.9.0]` section including a `### Migration` note enumerating, for existing consumers: adding the three skills to charter process lists and the authority-exception note (only if charters do not propagate automatically), the two schema field lines and the "Self-improving" principle correction to STARTER copies (glossary, root `CLAUDE.md`), and accepting the narrowly-scoped settings entries `schedule-process` proposes at registration time.

### 1.6 Non-functional requirements

- NFR-1. **Security / data-safety.** No PR content (diff, body, branch name, commit message, commit author identity) produced by `propose-to-core` may contain company-identifying data or secret/credential material, enforced by two independent passes (self-pass checklist + adversarial `redaction-reviewer` agent) before any write leaves the machine. Fail-closed: any FAIL or uncertain verdict blocks the upstream write.
- NFR-2. **Reliability / liveness.** Every scheduled run of `auto-sync` and `review-history` — including no-op runs (no update available, zero open deltas) — MUST write a run record, per the root-CLAUDE.md global rule and as the sole liveness signal for Risk 20.
- NFR-3. **Idempotency / self-healing.** A prior partial or conflicted `auto-sync` run must never permanently block subsequent runs: stale branches for already-applied tags self-delete; branches for genuinely pending conflicts are detected and left alone pending human resolution.
- NFR-4. **Bounded blast radius.** `propose-to-core`/`review-history` cap upstream PR creation at 3 per `review-history` run, to bound maintainer review load (Risk 33).
- NFR-5. **Input validation.** Every externally-sourced value that is interpolated into a shell command, `gh api` path, git branch name, or PR title (release tags, `delta_target` paths, slugs, entry paths) MUST be validated against an explicit allow-pattern before use, across all three skills.
- NFR-6. **Least privilege.** No active `.claude/settings.json` allow-list ships by default; permissions are granted narrowly, per-process, and only with human confirmation at `/schedule-process` registration time.
- NFR-7. **Degradation, not failure.** Missing `gh` CLI, no GitHub remote, or no fork/push rights are documented failure *modes* with defined fallback behavior (local-only commit, local draft + issue), not unhandled errors.
- NFR-8. **Test-surface consistency.** `ui/tests/` and `ui/smoke.sh` must pass with counts and schema assertions updated to match the shipped feature; the copier scaffold smoke test must confirm SDLC documentation paths are absent from a fresh consumer scaffold.

### 1.7 Acceptance criteria (verbatim from the approved plan)

- A consumer with the two processes scheduled pulls a new upstream release with zero human action when the sync is clean, and gets a GitHub issue in its own repo when it is not. Every scheduled run — including "no update" and "no open deltas" runs — writes a run record (root-CLAUDE.md global rule; also RISKS Risk 20's only liveness signal). `check-for-updates` keeps its own documented probe-skip exception — that rule is scoped to that skill and is not inherited by `auto-sync`.
- `review-history` triages all `status: open` deltas: STARTER/local targets get applied or drafted locally; CORE targets are routed to `propose-to-core`; every touched entry's tracking fields are transitioned with a dated note.
- `propose-to-core` produces an upstream PR whose **content** — diff, PR body, branch name, commit message, commit author identity — contains no company-identifying data **and no secrets or credentials** (API keys, tokens, passwords, connection strings, private URLs/IPs, `.env` values), only after a second-agent redaction review returns the literal `REDACTION: PASS`; any FAIL/uncertain/no-write-access outcome falls back to a committed local draft + consumer-repo issue. (GitHub *account* attribution — PR author, fork owner when a fork is used — is inherent to GitHub and explicitly out of scope; documented in Risk 31 and the consumer README, with guidance to use a neutral account/fork owner if that matters.)
- The end-to-end loop is demonstrated once for real: Restaba's existing open delta (company-setup resume-from-step-N) becomes a genuine anonymized PR on `Koroqe/OPOS`.
- Both new scheduled PROCESS.md files pass `ui/scheduling.py` validation; `ui/tests/` + `ui/smoke.sh` pass with updated counts; the release passes the copier scaffold smoke test; the SDLC docs added for this feature do **not** leak into consumer scaffolds.

### 1.8 Affected endpoints

Not applicable — OPOS is a Copier template and agentic-skill framework with no HTTP API surface. The equivalent "endpoints" are CLI/skill invocation surfaces:

- New skill invocations: `/auto-sync` (manual + scheduled), `/review-history` (manual + scheduled), `/propose-to-core` (manual, and invoked programmatically by `review-history`).
- New external calls made by these skills: `gh api repos/<upstream>/releases`, `gh api repos/<owner>/<repo>/contents/copier.yml`, `gh api repos/<upstream>/contents/<path>`, `gh api repos/<upstream> --jq .permissions.push`, `gh repo fork`, `gh pr create`, `gh pr list`, `gh pr view`, `gh issue create`, `gh repo view --json nameWithOwner`.
- No consumer-facing REST/GraphQL API is introduced or modified.

### 1.9 Schema changes

No relational/SQL database is involved. "Schema" here means the frontmatter contract for process run-record files (`history/*.md`, `scheduled-runs/*.md`):

- New optional field `delta_target: <repo-relative path>` — the file a `proposed_delta` concerns.
- New optional field `upstream_pr: <url>` — the URL of an upstream PR opened for that delta, once one exists.
- Both fields are additive and optional; existing entries without them remain valid and render unchanged (FR-F5).
- New committed artifact, not a schema change but a new persistent store: `.claude/skills/propose-to-core/proposals/LEDGER.md` — one line per proposal (date, delta_target, slug, source-entry path, PR URL, outcome) — the authoritative dedupe ledger, `_skip_if_exists`-protected after initial delivery.

### 1.10 UI changes

- **Founder console:** none in this release (see Non-goal NG1 — `ui/data.py` does not read `scheduled-runs/` or the two new fields; tracked as a company-backlog item, not delivered here).
- **Consumer-facing documentation surfaces** (treated as the framework's "UI" for this feature): a new "The self-improvement loop / Contributing back" section in `README.md.jinja` (FR-H2); a new "Reviewing incoming `[opos-core]` PRs" section in `MAINTAINER.md` (FR-H3); new glossary entries for CORE, STARTER, upstream, consumer, delta, and redaction review in `company/knowledge-base/glossary.md`; RISKS entries 31–34 plus extensions to Risks 22–23 in the RISKS artifact.
- **`/schedule-process` interactive flow:** gains a new registration-time step that surfaces and confirms narrowly-scoped `.claude/settings.json` allow entries for the process being scheduled (FR-G3) — the one interactive-flow change in this feature.

### 1.11 Cross-references

- Reuses, unchanged: `ui/scheduling.py` validation gate, `schedule-process`/`unschedule-process`/`list-scheduled-processes`, `check-for-updates`'s release-probe logic, `sync-from-core`'s branch/copier/`.rej` mechanics (mirrored here with an inverted, auto-commit posture), `consult-agent` (used to invoke `redaction-reviewer`), `release-from-changelog`.
- Depends on the CORE/STARTER classification ground truth recorded in `docs/architecture/self-improvement-loop_ground-truth.md` (Slice U0) — company-tier agents and `.claude/settings.json` classify as CORE and STARTER respectively, gating FR-D1, FR-H1, and FR-F3/FR-F4's propagation behavior.
- Superseded claims: the existing "owner agents propose deltas to their own PROCESS.md" language in `README.md.jinja`, root `CLAUDE.md.jinja`, and `coo.md` is corrected by FR-F4/FR-H1 to route through `review-history` triage instead of direct local edits.
