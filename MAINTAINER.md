# MAINTAINER.md

Guide for framework developers (people maintaining `Koroqe/OPOS` itself, not consumer instances).

If you're a consumer scaffolding a new company instance, see [`README.md`](README.md) instead.

## Adding a CORE file

CORE files are synced from upstream to every consumer on `copier update`. They define the framework's mechanics — agents, skills, templates.

To add a CORE file:

1. Create the file at its destination path (e.g. `.claude/skills/new-thing/SKILL.md`).
2. Variable substitution happens ONLY in `*.jinja` files (the default `_templates_suffix`) using standard `{{ COMPANY_NAME }}` delimiters — there is NO `_envops` in `copier.yml`, so `<<TOKEN>>` placeholders do NOT substitute via Copier. The `<<TOKEN>>` convention in `shared/templates/*.tmpl` is a separate, runtime substitution performed by skills, copied verbatim by Copier. A plain CORE `.md` file gets no substitution at all; if it needs the company name, it must become a `.jinja` file (mind the bare-file/`.jinja` collision CAUTION in `copier.yml`).
3. In `.jinja` files, wrap literal `{{`/`{%` sequences (e.g. GitHub Actions `${{ ... }}` examples, regex docs) in `{% raw %}...{% endraw %}` blocks or the render breaks silently.
4. Do NOT add the file to `_skip_if_exists` in `copier.yml` — CORE files are the default for everything not in `_skip_if_exists` or `_exclude`.
5. Add an entry to `CHANGELOG.md` under `### Added` for the next release.

## Adding a STARTER file

STARTER files ship to consumers on initial scaffold only. `copier update` never overwrites them. Use STARTER for example departments, starter agents, default configs that consumers customize.

To add a STARTER file:

1. Create the file at its destination path (e.g. `departments/sales/CLAUDE.md`).
2. Add the file's path (or a glob) to `_skip_if_exists` in `copier.yml`.
3. If the file uses `<<COMPANY_NAME>>` or other tokens, they substitute on the initial scaffold; they will NOT be re-substituted on update.
4. Add a CHANGELOG entry under `### Added`.

## Adding runtime state

Runtime state is consumer-local: never in the template, never tracked in git. Examples: `.claude/.current-task`, `.claude/.last-update-check`, `.claude/scratchpad.md`, skill `history/*.md` files, and (v0.6.0+) `**/scheduled-runs/202[0-9]-*.md` + `.claude/scheduled-processes.json`.

To add a new runtime-state path:

1. Add the path (or glob) to `_exclude` in `copier.yml` — prevents Copier from copying it to consumers.
2. Add the path to `.gitignore` — prevents accidental tracking in the framework repo.
3. Document the path in the relevant skill's SKILL.md (which skill writes it and when).
4. Mention in CHANGELOG if the path convention is new.

### v0.6.0 additions

Two new runtime-state paths shipped with the scheduling family:

- `**/scheduled-runs/202[0-9]-*.md` — per-scheduled-run records, one file per cron-fired invocation. Sibling to `history/`; never mixed. Written by the scheduled process body when it detects the prelude string `"You are running as a scheduled routine"` (injected by `/schedule-process`). The `scheduled-runs/.gitkeep` marker files (one per scheduling-capable skill folder) DO ship via Copier — they preserve the folder convention so consumers see the structure. Only the dated entries are excluded.
- `.claude/scheduled-processes.json` — per-machine cache mapping `process_name` → `routine_id` (the id returned by `CronCreate`). NOT authoritative — `/list-scheduled-processes` reconciles against `CronList` directly so a missing cache row on a fresh machine doesn't falsely classify live routines as ORPHAN.

### Dependency on Claude Code internal tool names

The three v0.6.0 wrappers reference `CronCreate` / `CronList` / `CronDelete` by exact name (in skill `tools:` allow-lists and in SKILL.md step bodies). These names were verified against https://code.claude.com/docs/en/routines.md at v0.6.0 release. If Anthropic renames these tools, the rename is a coordinated 3-file sed across `.claude/skills/schedule-process/SKILL.md`, `.claude/skills/unschedule-process/SKILL.md`, `.claude/skills/list-scheduled-processes/SKILL.md` (plus their `tools:` frontmatter). See RISKS Risk 26.

## Reviewing incoming [opos-core] PRs (v0.9.0+)

Consumer instances running the self-improvement loop open PRs titled `[opos-core] <file-slug>: <short title>` via their `propose-to-core` skill. Review checklist:

1. **Genericity** — the Problem / Observed failure mode / Proposed change must make sense for EVERY consumer, not one company's workflow. Reject (politely, with the reason) proposals that encode one instance's conventions.
2. **No leaked data or secrets** — the sender's redaction gate should have caught company names, person data, business numbers, customers, internal references, and credentials, but you are the last line: scan the diff, body, branch name, and commit message yourself. If you find a leak, do NOT merge and do NOT quote the leaked content in review comments — close with a generic note asking the sender to re-run their redaction pass.
3. **`.jinja` correctness** — if the target is a `.jinja` file: literal `{{`/`{%` introduced by the diff must be wrapped in `{% raw %}`; render a scratch scaffold to confirm.
4. **Scaffold smoke test** — run the "Testing locally" smoke test on the PR branch before merging; for template/schema changes also run `python3 -m unittest discover ui.tests`.
5. **Three sync drivers** — if the PR touches update mechanics, remember they exist in three places that must stay consistent: `sync-from-core`, `auto-sync`, and `.github/workflows/sync-opos.yml`.

Merged proposals ship to the whole fleet at the next release — the sender's consumer instance picks it up via its own `auto-sync`, which closes the loop (their `review-history` marks the source delta `applied` when it sees the PR merged).

## Releasing a new version

1. Ensure `feat/<branch>` is up to date with the work for the release.
2. Update `CHANGELOG.md` with a new `## [vX.Y.Z] - YYYY-MM-DD` entry. Sections: `### Added`, `### Changed`, `### Removed`, `### Fixed`, `### Security`, and `### Migration` if breaking.
3. Run the local smoke test (see "Testing locally" below). It MUST pass before tagging.
4. Push the branch (or merge to `main`, depending on your release strategy).
5. Cut the release:
   ```bash
   gh release create vX.Y.Z --repo Koroqe/OPOS \
     --title "vX.Y.Z — short summary" \
     --notes "$(awk '/^## \[X.Y.Z\]/{p=1;print;next} /^## \[/{p=0} /^\[[0-9]/{p=0} p' CHANGELOG.md)"
   ```
   The `awk` extract pulls just the relevant CHANGELOG section as release notes (avoids dumping the whole file). The pattern uses an explicit `p` flag with three stop conditions: the next `## [` heading (next version's entry), AND a `[X.Y.Z]:` link-reference line (the link-references at the bottom of CHANGELOG). This handles both the single-entry case (where the version is the only `## [` entry) and the link-reference-leak case. **Fix history:** previously used `awk '/^## \[X.Y.Z\]/,/^## \[/' | sed '$d'` which silently produced empty output for single-entry files (the range pattern matched the same line for start and end).
6. Verify the release appears at `https://github.com/Koroqe/OPOS/releases/tag/vX.Y.Z`.
7. Run the post-release sanity check: `copier copy --vcs-ref vX.Y.Z gh:Koroqe/OPOS /tmp/postrelease -d COMPANY_NAME=Sanity --defaults`.

## Testing locally

### Dev-deps prerequisite (v0.7.2+)

Before running `python3 -m unittest discover ui.tests`, `bash ui/smoke.sh`, or `release-from-changelog`'s pre-release scaffold check, install pinned Python dev-deps:

```bash
pip install -r requirements-dev.txt
```

Required deps: `markdown` (used by `ui/render.py` to render markdown content in console templates), `copier` (used by `release-from-changelog` step 5's scaffold check and the smoke test below), `pyyaml` (used by `ui/data.py` + `ui/scheduling.py` + multiple tests to parse frontmatter and config), `jinja2` (used by `ui/render.py` for template rendering — technically a Copier transitive dep but explicit-pinned for safety against Copier deps churn). Skipping this step on a fresh machine causes the failures documented in v0.7.0 + v0.7.1 release histories (scaffold check skipped because copier was missing/broken; `markdown` import error blocking `ui/tests`). Use range pins; switch to a `pip freeze` lockfile in a future v0.7.x if the range proves too loose.

### Smoke test

Before any release, run the local smoke test from the OPOS working directory:

```bash
rm -rf /tmp/opos-smoketest
copier copy . /tmp/opos-smoketest -d COMPANY_NAME=SmokeCo --defaults
```

Verify:
- `head -3 /tmp/opos-smoketest/CLAUDE.md` shows `SmokeCo` substituted.
- `find /tmp/opos-smoketest/.claude/skills -name "2026-*.md"` returns nothing (runtime history files excluded).
- `grep -F "{{TITLE}}" /tmp/opos-smoketest/shared/templates/task-issue.md.tmpl` matches (runtime tokens preserved).
- `ls /tmp/opos-smoketest` shows all expected top-level entries.

Clean up: `rm -rf /tmp/opos-smoketest`.

For deeper validation of the update flow, scaffold a dummy at one tag, then `copier update` to a newer tag and inspect the resulting diff. The `--check_only` mode of `sync-from-core` is also useful for previewing.
