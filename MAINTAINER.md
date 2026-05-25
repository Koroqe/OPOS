# MAINTAINER.md

Guide for framework developers (people maintaining `Koroqe/OPOS` itself, not consumer instances).

If you're a consumer scaffolding a new company instance, see [`README.md`](README.md) instead.

## Adding a CORE file

CORE files are synced from upstream to every consumer on `copier update`. They define the framework's mechanics — agents, skills, templates.

To add a CORE file:

1. Create the file at its destination path (e.g. `.claude/skills/new-thing/SKILL.md`).
2. Use `<<COMPANY_NAME>>` (or other `<<TOKEN>>` placeholders) anywhere you need variable substitution. Copier's `_envops` in `copier.yml` swaps Jinja delimiters to `<< >>`, so these tokens substitute natively.
3. If the file contains literal `<<...>>` patterns NOT meant as Jinja variables (e.g. regex documentation), wrap them in `<%raw%>...<%endraw%>` blocks.
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

Runtime state is consumer-local: never in the template, never tracked in git. Examples: `.claude/.current-task`, `.claude/.last-update-check`, `.claude/scratchpad.md`, skill `history/*.md` files.

To add a new runtime-state path:

1. Add the path (or glob) to `_exclude` in `copier.yml` — prevents Copier from copying it to consumers.
2. Add the path to `.gitignore` — prevents accidental tracking in the framework repo.
3. Document the path in the relevant skill's SKILL.md (which skill writes it and when).
4. Mention in CHANGELOG if the path convention is new.

## Releasing a new version

1. Ensure `feat/<branch>` is up to date with the work for the release.
2. Update `CHANGELOG.md` with a new `## [vX.Y.Z] - YYYY-MM-DD` entry. Sections: `### Added`, `### Changed`, `### Removed`, `### Fixed`, `### Security`, and `### Migration` if breaking.
3. Run the local smoke test (see "Testing locally" below). It MUST pass before tagging.
4. Push the branch (or merge to `main`, depending on your release strategy).
5. Cut the release:
   ```bash
   gh release create vX.Y.Z --repo Koroqe/OPOS \
     --title "vX.Y.Z — short summary" \
     --notes "$(awk '/^## \[X.Y.Z\]/,/^## \[/' CHANGELOG.md | sed '$d')"
   ```
   The `awk` extract pulls just the relevant CHANGELOG section as release notes (avoids dumping the whole file).
6. Verify the release appears at `https://github.com/Koroqe/OPOS/releases/tag/vX.Y.Z`.
7. Run the post-release sanity check: `copier copy --vcs-ref vX.Y.Z gh:Koroqe/OPOS /tmp/postrelease -d COMPANY_NAME=Sanity --defaults`.

## Testing locally

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
