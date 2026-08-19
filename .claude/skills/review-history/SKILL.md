---
name: review-history
description: Weekly scheduled triage of open proposed_delta entries across all history/ and scheduled-runs/ folders — apply small local (STARTER) fixes, route CORE defects upstream via propose-to-core, reconcile upstream PR states
version: 0.1.0
tags: [meta, framework, self-improvement, scheduling]
owner_agent: coo
tools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash", "Task"]
---

# review-history

## When to use

As a **scheduled routine** (registered via `/schedule-process review-history`, weekly cron `23 7 * * 1` — offset from `auto-sync`'s daily 06:17). Also manually as `/review-history`, or `/review-history --dry_run` to print the full triage table without acting on anything.

This skill mechanizes the coo's process-improvement mandate: it is the missing **consumer** of the `proposed_delta` signal every process already produces. Before it existed, deltas sat at `status: open` forever.

## Authority mapping

Declared list `[commit, push, write_proposal, file_issue, open_pr]`:

- **commit** — triage edits to STARTER/consumer files within the objective threshold, in-place status/annotation edits to history entries, `proposals/LEDGER.md` `outcome`-column updates and `rejected-local` rows, work-branch create/delete, ff-merge to the default branch, run records.
- **push** — pushing the ff-merged default branch, and the proposal branch pushed by an invoked `propose-to-core` (its outbound write runs inside this run's authority).
- **write_proposal** — drafts into the owning agent's dept backlog for above-threshold local deltas.
- **file_issue** — consumer-repo issues (closed-unmerged PR reconciliation; propose-to-core fallback issues raised within this run).
- **open_pr** — `gh pr create` performed by an invoked `propose-to-core`.

Anything outside this mapping — refuse and record the refusal.

## Input validation (this skill ingests the least-trusted input in the framework)

- `delta_target:` hints read from arbitrary history entries are re-validated before ANY use: repo-relative, no leading `/`, no `..`, charset `[A-Za-z0-9._/-]`. A failing hint is treated as absent (fall back to inference, then to classification); a hint that looks like traversal (`../../etc/x`) is rejected with a triage note.
- `proposed_delta` free text is NEVER interpolated into commands, branch names, or PR titles — slugs are always re-derived by sanitizing file paths to `[a-z0-9-]`.
- Entry paths must resolve inside the repo root.

## Steps

Work happens on branch `review-history/<YYYY-MM-DD>`; at the end it is ff-merged to the default branch and pushed (per the Scheduled-run authority exception — the ff-merge is the sanctioned integration step of the `commit` authority).

1. **Collect:** glob `**/history/*.md` and `**/scheduled-runs/*.md` from the repo root.
2. **PR-state reconciliation FIRST** — for every entry carrying `upstream_pr:` AND every `proposals/LEDGER.md` row with outcome `pr-opened`: `gh pr view <url> --json state,mergedAt`:
   - merged → set the entry `status: applied` (durable entries), ledger `outcome` → `merged`, dated note.
   - closed un-merged → file consumer-repo issue `[review-history] upstream PR closed unmerged — <slug>` (human decides: rework and re-propose, or reject); entry stays `open` with a note; ledger `outcome` → `closed-unmerged`.
   - still open → skip.
   Ledger writes here follow the writer constraints in `../propose-to-core/proposals/README.md`: this skill mutates the `outcome` column only, plus `rejected-local` rows — never appends proposal rows.
3. **Select work:** all entries with `status: open` and `proposed_delta` ≠ `none`, minus every entry step 2 already handled (any `upstream_pr:` carrier — including closed-unmerged ones, whose next move is the human's via the step-2 issue, never re-triage here).
4. **Classify each delta:** FIRST apply the stale/moot check — it runs before, and independent of, target classification (a delta whose text is self-evidently obsolete goes straight to step 5's `rejected` bucket even with no target at all). Otherwise classify: by the validated `delta_target:` hint; else infer the target path from the `proposed_delta` text; else run the two-part runtime classification test (identical to `propose-to-core` step 2 — pinned-`_commit` `copier.yml` fetch for `_skip_if_exists`, HEAD existence probe; fetch once per run, memoize). Unclassifiable (and not stale) → triage note, leave `open`, move on.
5. **Triage table** (every touched entry gets a dated triage note):
   - **Upstreamable (CORE) target** → invoke `/propose-to-core` for it. **Cap: at most 3 actual PR creations per run** (dedupe skips and drafts don't count) — bounds upstream-maintainer load (RISKS Risk 33). Beyond the cap: note `deferred to next run`, leave `open`.
   - **STARTER/consumer target, within the objective threshold** — the delta touches **≤ 2 files AND ≤ 20 changed lines AND no sensitive path** (any path containing `auth`, `payment`, `billing`, `secret`, `migration`; `.claude/settings.json`; anything under `.github/workflows/`) → apply the fix and commit `chore(core): review-history — apply delta from <entry-path>`; set `status: applied`.
   - **STARTER/consumer target, above threshold** → write a proposal draft into the owning agent's dept backlog (`write_proposal`); set a note, leave `open` until the owner acts.
   - **Nonsensical, stale, or already-moot** → `status: rejected` + one-line reason. If the source entry is a gitignored scheduled-run record (the flip is not durable), also add a `rejected-local` row to the ledger so other machines/clones don't re-triage it.
6. **Zero open deltas** (normal on a fresh consumer): write a `success` run record with the note `no open deltas` — every run records (RISKS Risk 20 liveness).
7. **Integrate:** commit any remaining record/annotation changes, ff-merge the work branch to the default branch, delete it, push (degraded no-remote mode: local only, noted). Write the run record — prelude present → `./scheduled-runs/`, absent → `./history/`.

`--dry_run`: run steps 1–5 read-only, print the full triage table (entry → classification → intended action), act on nothing, write nothing.

## Outputs

- Local STARTER fixes applied as `chore(core): review-history — ...` commits; upstream proposals via `propose-to-core`; backlog drafts for oversized deltas; reconciled PR states; every touched entry transitioned or annotated with a dated note.
- A run record on every run, including zero-delta runs.

## Failure modes

- **`gh` unavailable** — steps 2 and 5's upstream routing degrade: reconciliation and propose-to-core are skipped with notes; local triage still runs.
- **Classification fetch failure** — the affected deltas stay `open` with a note; never guessed.
- **propose-to-core fails mid-invocation** — its own fallback path handles it (draft + issue + ledger); this skill records the outcome and moves on.
- **Concurrent run collision** (RISKS Risk 22) — the work branch is dated; a second same-day run finding the branch present stops with a `partial` record.

## Related

- Process definition: `./PROCESS.md`
- Run records: `./history/` (manual) and `./scheduled-runs/` (scheduled)
- Downstream skill: [`propose-to-core`](../propose-to-core/) (upstream routing) and its ledger (`../propose-to-core/proposals/README.md` — writer constraints)
- Schema source: root `CLAUDE.md` "Self-improvement log schema" (`delta_target`, `upstream_pr` fields)
- Owner agent: [`coo`](../../agents/company/coo.md)
