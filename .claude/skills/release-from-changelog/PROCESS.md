---
process_name: release-from-changelog
owner: chief-of-staff
collaborators: [eng-lead]
inputs: [version, target_branch, repo]
success_criteria: [changelog_entry_found, extract_non_empty, no_existing_release_for_version, release_created, release_verified, history_entry_written]
slo: "1 minute (interactive — gh API + git operations)"
version: 0.1.0
---

# release-from-changelog

## Narrative

Automates the release-cutting workflow that MAINTAINER.md previously prescribed as a manual sequence of awk + gh-create + verify steps. Reduces the cognitive cost (and silent-bug surface) of cutting each release. Owned by `chief-of-staff`; `eng-lead` listed as collaborator since the git/gh mechanics are engineering's domain.

## Pre-conditions

- `CHANGELOG.md` has a `## [<version-without-v>]` heading with non-empty content following.
- `gh` CLI authenticated.
- The target branch is pushed to the remote (otherwise `gh release create --target <branch>` will fail or create a tag against an unknown ref).
- No existing release with the same version tag.

## Steps

Mirrors the 7-step procedure in SKILL.md:

1. Verify CHANGELOG entry exists.
2. Extract section via awk.
3. Verify extract non-empty.
4. Verify no existing release (INVERTED exit-code).
5. Cut release via `gh release create`; auto-derive title from first `### ` subheading.
6. Verify creation.
7. Write history entry.

## Done when

- `changelog_entry_found` — step 1 grep succeeded.
- `extract_non_empty` — step 3 `test -s` succeeded.
- `no_existing_release_for_version` — step 4 confirmed absence (inverted `gh release view` exit).
- `release_created` — step 5 `gh release create` returned 0.
- `release_verified` — step 6 `gh release view --json tagName` returned the version.
- `history_entry_written` — file exists under `./history/`.

## Rollback

If `gh release create` succeeded but step 6 verification fails (race / transient), the release MAY still exist — verify manually via `gh release list`. If a release was created with wrong notes / title, edit via `gh release edit <version> --title ... --notes ...`. To DELETE: `gh release delete <version> --yes` (destructive; ask user). Local tag deletion: `git push origin :refs/tags/<version>` removes the remote tag.

## History

Every invocation writes an entry (releases are meaningful events). Body should capture: which version, which target branch, which repo, how many notes lines, derived title, and the final release URL.
