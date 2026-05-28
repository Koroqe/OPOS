---
name: release-from-changelog
description: Cut a GitHub release from a CHANGELOG.md version entry; extracts notes via the canonical awk pattern and runs `gh release create`
version: 0.1.0
tags: [meta, framework, release, github]
owner_agent: chief-of-staff
---

# release-from-changelog

## When to use

When cutting a new version release. Replaces the multi-step manual workflow (extract section via awk → check no-existing-release → `gh release create --notes-file`) with one skill invocation. Canonicalizes the same awk pattern documented in `MAINTAINER.md`.

## Inputs

- `version` — the release tag, e.g. `v0.2.0`. Required.
- `target_branch` — git ref to tag the release against. Default: current branch (`$(git rev-parse --abbrev-ref HEAD)`).
- `repo` — `owner/name`. Default: read from `.claude/task-tracking.config.json` `repo` field.

## Steps

1. **Verify CHANGELOG.md has the version entry.** `grep -F "## [<version-without-v>]" CHANGELOG.md` must return a match. If not, ABORT with message: "no `## [<version>]` heading found in CHANGELOG.md".

2. **Extract the section to a temp file** via the canonical awk pattern from `MAINTAINER.md`:
   ```bash
   awk '/^## \['"$VERSION_NO_V"'\]/{p=1;print;next} /^## \[/{p=0} /^\[[0-9]/{p=0} p' CHANGELOG.md > /tmp/release-notes-"$VERSION".md
   ```
   The `p=1;print;next` clause starts capturing; the `/^## \[/{p=0}` clause stops at the next version heading; the `/^\[[0-9]/{p=0}` clause stops at the link-reference block at file bottom.

3. **Verify extract non-empty:** `test -s /tmp/release-notes-"$VERSION".md`. If empty (the awk pattern didn't find content), ABORT with "extracted notes empty — check CHANGELOG format".

4. **Verify no existing release with this version** (INVERTED exit-code logic — `gh release view` returns 0 when release EXISTS, which we don't want):
   ```bash
   if gh release view "$VERSION" --repo "$REPO" > /dev/null 2>&1; then
     echo "ERROR: release $VERSION already exists" >&2
     exit 1
   fi
   ```

5. **Cut the release.** Auto-derive the title from the CHANGELOG section's first **non-reserved** `### ` subheading. Reserved names are the Keep-a-Changelog section labels (`Added`, `Changed`, `Removed`, `Deprecated`, `Fixed`, `Security`, `Notes`, `Migration`) — these are structural headers, not titles, and were the cause of the v0.2.0 title bug surfaced as a `proposed_delta` (auto-derivation produced `v0.2.0 — Added`). If no non-reserved subheading exists, fall back to the bare `$VERSION` as the title:
   ```bash
   TITLE=$(awk '
     /^### / {
       name = substr($0, 5)
       if (name !~ /^(Added|Changed|Removed|Deprecated|Fixed|Security|Notes|Migration)$/) {
         print name
         exit
       }
     }' /tmp/release-notes-"$VERSION".md)
   if [ -n "$TITLE" ]; then
     FULL_TITLE="$VERSION — $TITLE"
   else
     FULL_TITLE="$VERSION"
   fi
   gh release create "$VERSION" --repo "$REPO" \
     --title "$FULL_TITLE" \
     --notes-file /tmp/release-notes-"$VERSION".md \
     --target "$TARGET_BRANCH"
   ```
   Note: tag creation is a side-effect of `gh release create` against the target branch; no separate `git tag` needed. The heuristic is unit-tested in `ui/tests/test_title_heuristic.sh` against three fixtures (Added-only, Notes-only, Notes-then-arbitrary).

6. **Verify creation.** `gh release view "$VERSION" --repo "$REPO" --json tagName --jq '.tagName'` must return `"$VERSION"`. Else ABORT (release creation silently failed — unusual).

7. **Write history entry** to `./history/<YYYY-MM-DD>-<version>.md`. Include: version, target branch, repo, extracted-notes line count, derived title, release URL.

## Outputs

- New GitHub release at `https://github.com/<repo>/releases/tag/<version>`.
- A history entry under `./history/`.
- One-line stdout confirmation: `Released: <version> at <url>`.

## Failure modes

- **CHANGELOG entry missing** — step 1 fail. Recovery: add the `## [<version>]` entry to CHANGELOG.md first.
- **Empty extract** — step 3 fail. Recovery: check the section's actual content; the awk pattern stops at the next `## [` or `[X.Y.Z]:` line, so a malformed CHANGELOG could produce empty output.
- **Release already exists** — step 4 fail. Recovery: pick a higher version (or delete the existing release manually if it was a mistake — destructive, ask the user).
- **`gh release create` fails** — step 5 fail. Surface the error (auth, network, permissions, target-branch missing on remote).
- **Auto-title derivation finds wrong heading** — title is cosmetic; if it looks wrong, the user can edit via `gh release edit <version> --title <new>` post-facto.

## Related

- Process definition: `./PROCESS.md`
- Run history: `./history/`
- Convention source: `MAINTAINER.md` (the awk pattern's authoritative documentation).
- Sibling skills: `check-for-updates`, `sync-from-core` (the consumer side of release flows).
