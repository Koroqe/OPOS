---
name: propose-to-core
description: Turn a locally-observed defect in a framework (CORE) file into a fully anonymized pull request on the upstream OPOS repo — classify, draft, redact (fail-closed), then fork-or-branch and open the PR
version: 0.1.0
tags: [meta, framework, upstream, contribution]
owner_agent: chief-of-staff
tools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash", "Task"]
---

# propose-to-core

## When to use

- Invoked by `review-history`'s triage when an `open` delta targets an upstreamable (CORE) file — the scheduled path.
- Manually: `/propose-to-core <history-entry-path>` or `/propose-to-core --delta-target <path> --problem "<generic defect description>"`.
- `--dry_run` runs everything up to and including the adversarial redaction review, prints the would-be PR (title, body, diff, both gate verdicts), and touches nothing remote.

## The outbound-write invariant (named, load-bearing)

**No `git push`, `gh repo fork`, `gh pr create`, or any other write that leaves this machine occurs before BOTH redaction gates have passed: the deterministic pre-gate (step 4b) AND the literal `REDACTION: PASS` line from the `redaction-reviewer` agent (step 5).** Any future edit to this skill that reorders an outbound write ahead of the gates is a defect by definition.

## Run records (sub-invocation rule)

Manual invocations write a run record to `./history/` (root-CLAUDE.md schema). **When invoked as a sub-step of a scheduled `review-history` run** (the prelude string belongs to the parent), this skill writes **no separate run record** — the parent's scheduled-run entry plus this skill's `proposals/LEDGER.md` line ARE the record. The prelude routing convention applies to direct invocations only.

## Inputs — validated before ANY use (they feed shell commands, `gh api` paths, branch names, and PR titles)

- `entry_path` (optional): must resolve to a file inside the repo root — reject `..`, absolute paths outside the root, symlinks escaping the root.
- `delta_target` (optional; inferable from the entry's `delta_target:` field or its `proposed_delta` text): repo-relative, no leading `/`, no `..`, charset `[A-Za-z0-9._/-]` only.
- `dry_run` (optional bool; default false).
- Slugs are ALWAYS re-derived by sanitizing the **upstream file path** to `[a-z0-9-]` — never taken from delta free text.

## Steps

### 1. Resolve the delta

Read the entry (or the inline `--problem`). Extract the defect description and the `delta_target`. No inferable target → stop with guidance to supply `--delta-target`.

### 2. Classify the target (two-part runtime test; never guess)

Read `.copier-answers.yml` → `_src_path` (parse to `<owner>/<repo>` exactly as `check-for-updates` does) and `_commit` (the consumer's pin).

- **STARTER/local test** — fetch the upstream `copier.yml` **at the consumer's pin**: `gh api "repos/<owner>/<repo>/contents/copier.yml?ref=<_commit>" -H "Accept: application/vnd.github.raw"`. Match `delta_target` against `_skip_if_exists` patterns using **gitwildmatch semantics** (`**` crosses directories; shell fnmatch does not — do not use it) against the rendered destination path. Match → **abort**: print `this path is consumer-owned (STARTER) — apply it locally via /review-history`, ledger line `aborted-starter`, stop. *Special case named for the operator:* root `CLAUDE.md`, `company/CLAUDE.md`, and `departments/*/CLAUDE.md` are consumer-owned **but have upstream `.jinja` templates** — a framework-level improvement to those templates IS upstreamable; the abort message says so and points at `--delta-target <path>.jinja`.
- **Upstreamable test** — probe upstream existence at default-branch HEAD: `gh api repos/<owner>/<repo>/contents/<delta_target>` — trying, in order: the literal path, `<path>.jinja`, and known relocations (framework readme → `.github/README.md`). First hit wins and becomes the PR's target path.
- **Fetch failure or disagreement** (e.g. classified STARTER at the pin but the pattern is absent at HEAD): take the **human-draft path** (step 7) with the reason recorded. Fetch `copier.yml` once per run; memoize existence probes.

### 3. Dedupe (ledger first, then upstream)

- `proposals/LEDGER.md` (v0.11): a line with the same `delta_target` AND the same `defect_slug` whose outcome is `pr-opened` or `draft` → skip with a note. A row for the same file with a DIFFERENT defect slug never suppresses — that was the v0.9 fix-loss shape; `merged`/`closed-unmerged`/`rejected-local` rows never suppress either (and if the source entry lacks the `upstream_pr:` annotation, add it from the ledger).
- Upstream (v0.11 — fixed from the v0.9 fix-loss shape): `gh pr list --repo <owner>/<repo> --state open --json title,url --limit 100` plus, when 100 rows return, further pages — match the FULL `[opos-core] <file-slug>/<defect-slug>` prefix **locally** (server-side `in:title` search tokenizes on `/` and `.` — unreliable). Matching OPEN PR → skip, ledger line `skipped-duplicate`. Closed/merged PRs no longer suppress: a once-fixed file must not swallow every future DIFFERENT fix to it — the defect-slug (derived from the `mistake_class` when present, else a 2-4 word kebab summary of the defect, sanitized `[a-z0-9-]`) is what distinguishes fixes; merged sameness is the maintainer's call at triage, not the sender's.

### 4. Draft + canonical redaction checklist + deterministic pre-gate

**4a. Draft.** Fetch the upstream file content at HEAD (`gh api ... -H "Accept: application/vnd.github.raw"`). Draft the fix as a diff against THAT content — never against the consumer's local copy. For `.jinja` targets: any literal `{{` or `{%` the diff introduces MUST be wrapped in `{% raw %}…{% endraw %}` or the render breaks. Compose the PR body from `shared/templates/core-proposal-pr.md.tmpl` (Problem / Observed failure mode / Proposed change / How verified — all generic), the title `[opos-core] <file-slug>/<defect-slug>: <short title>`, the branch name `propose/<file-slug>-<YYYYMMDD>`, and the commit message.

**4b. Canonical redaction checklist (self-pass over the FULL bundle — diff, title, body, branch name, commit message, diff file paths).** This section is the policy artifact; the `redaction-reviewer` agent mirrors it. Remove or generalize, with zero exceptions:

1. Company/product names — including the `COMPANY_NAME` answer value from `.copier-answers.yml`.
2. Person names, e-mail addresses, social handles.
3. Business-tied numbers — prices, revenue, customer/user counts, dates of company events.
4. Customers, partners, vendors — any third party in a business relationship.
5. Industry specifics not needed by the fix.
6. Internal references — private repo names/URLs, internal issue/PR numbers, hostnames, consumer-only file paths.
7. **Secrets and credentials** — API keys, tokens, passwords, connection strings, private URLs/IPs, `.env`-style values, private key material.
8. **Consumer paths in attribution fields (v0.11)** — `root_cause_target:`/`mistake_class:` values quoted in the PR body must name GENERATOR (CORE) paths and generic class slugs only; a consumer-artifact path in a public PR body leaks the company's org structure.

**Deterministic pre-gate (hard-fails before any agent judgement):** assemble the identifier **blocklist** — the `COMPANY_NAME` value, department/agent/product names unique to the instance, the consumer repo's `nameWithOwner` (`gh repo view --json nameWithOwner`), and git author names/e-mails from recent log (`git log -20 --format='%an %ae' | sort -u`). Then:
- `grep -F -i -f <blocklist-file>` across the full bundle — any hit → FAIL.
- Secret-shaped regex sweep, independent of the blocklist: `gh[pousr]_[A-Za-z0-9]{36}`, `AKIA[0-9A-Z]{16}`, `xox[baprs]-`, `-----BEGIN [A-Z ]*PRIVATE KEY-----`, `postgres(ql)?://[^ ]*:[^ @]*@`, `[?&](api_?key|token|password)=` — any hit → FAIL.

A pre-gate FAIL goes straight to the human-draft path (step 7) — it cannot be argued with.

### 5. Adversarial review

Spawn the `redaction-reviewer` agent (consult-agent pattern — Task subagent adopting `.claude/agents/company/redaction-reviewer.md`; note RISKS Risks 14/28: this is a simulated consultation, one honest layer among three, not a sandbox). Hand it ONLY the bundle + blocklist. Anything other than the literal `REDACTION: PASS` line — including uncertainty — is a FAIL → step 7.

**`--dry_run` stops here**, printing the full would-be PR and both gate verdicts.

### 6. Outbound write (only after BOTH gates passed — see the invariant above)

All git work happens in an **ephemeral scratch clone** under the session scratchpad/temp dir — never in the consumer working tree, and never by adding an upstream remote to the consumer repo (that would leave a push target pointing at the framework repo inside a company repo).

- **Choose the write path** by `gh api repos/<owner>/<repo> --jq .permissions.push`:
  - `true` (maintainer-consumer — e.g. the framework maintainer dogfooding via their own company): shallow-clone the **upstream** repo, branch `propose/<file-slug>-<YYYYMMDD>` directly on it, PR from the same repo. (Forking your own repo is impossible on GitHub.)
  - `false` (third-party consumer): `gh repo fork <owner>/<repo> --clone=false --default-branch-only` — the fork lands in the **user account, never a company org** (an org fork would publish the company name, the exact thing anonymization forbids). Then shallow-clone the fork and branch there.
- **Commit with a neutral identity:** `git -c user.name="opos-consumer" -c user.email="opos-consumer@users.noreply.github.com" commit ...` — the commit message was part of the redaction bundle. (GitHub *account* attribution — PR author, fork owner — is inherent to GitHub and out of scope; the consumer README discloses it and suggests a neutral account where that matters.)
- Push the branch, then `gh pr create --repo <owner>/<repo> --title "[opos-core] <file-slug>/<defect-slug>: <short title>" --body-file <rendered core-proposal-pr body>`.
- **Record:** append the `proposals/LEDGER.md` row (`pr-opened`, per the schema in `./proposals/README.md` — this skill APPENDS rows only) and commit it in the consumer repo; best-effort `upstream_pr:` annotation + note on the source entry (durable only for committed `history/` entries — for gitignored scheduled-run entries the ledger IS the record; the entry stays `status: open` either way — `review-history` transitions it when the PR merges).
- Delete the scratch clone.

### 7. Fallback path (pre-gate FAIL, reviewer FAIL, uncertainty, no write access, fork failure)

- Write the draft to `proposals/<YYYY-MM-DD>-<slug>.md`: the would-be diff, PR body, and — on redaction failures — the reviewer's findings list verbatim, so a human can fix exactly what failed.
- File the consumer-repo issue `[propose-to-core] draft needs human review — <slug>` (repo via `gh repo view --json nameWithOwner`; local open-issue title match for dedupe, same rule as `auto-sync`).
- Append the ledger row with outcome `draft`; note on the source entry (stays `open`).
- Commit the draft + ledger together in the consumer repo.

## Outputs

- On success (step 6): an upstream PR whose content carries no company-identifying data and no secrets; a `proposals/LEDGER.md` line; a best-effort `upstream_pr:` annotation on the source entry.
- On any fallback (step 7): a committed anonymized-as-far-as-possible draft under `proposals/`, a consumer-repo issue, a ledger line.
- A run record for manual invocations (see the sub-invocation rule above).

## Failure modes

- **No inferable `delta_target`** — stop with guidance (step 1).
- **STARTER target** — documented abort with the `.jinja`-template special case named (step 2).
- **`copier.yml`/content fetch failure, non-GitHub `_src_path`, classification disagreement** — human-draft path, reason recorded (step 2).
- **Duplicate** — skip with ledger line (step 3).
- **Pre-gate or reviewer FAIL** — human-draft path (steps 4b/5 → 7).
- **`gh` unauthenticated / absent** — human-draft path (outbound is impossible; drafting is not).

## Related

- Process definition: `./PROCESS.md`
- Proposals + ledger: `./proposals/` (see `./proposals/README.md` for the LEDGER schema and writer constraints)
- The gate agent: [`redaction-reviewer`](../../agents/company/redaction-reviewer.md)
- PR body template: [`core-proposal-pr.md.tmpl`](../../../shared/templates/core-proposal-pr.md.tmpl)
- Invoking triage: [`review-history`](../review-history/)
- Red-team fixtures (framework repo only, copier-excluded): `docs/qa/fixtures/redaction-{laden,clean}-bundle.md`
