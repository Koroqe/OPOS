---
title: Add rollback verification step to deploy
owner: eng-lead
created: 2026-05-21
state: active
runs: 0
promotion_target: departments/engineering/.claude/skills/deploy/
labels: [ops, release]
---

# Add rollback verification step to deploy

## Goal

Before declaring a deploy successful, run a rollback-dry-run against the previous version and record the result in the deploy's history entry. Today the `deploy` skill (see [`../.claude/skills/deploy/SKILL.md`](../.claude/skills/deploy/SKILL.md)) treats a green pipeline + passing smoke tests as success; this experiment adds explicit verification that a rollback would succeed if needed.

## Acceptance

A single run is successful when:

1. The rollback dry-run executes against the immediately-prior production version.
2. The dry-run output is captured in the deploy's history entry under a `rollback_dry_run:` field.
3. The dry-run exits clean (no errors); on dry-run failure the deploy itself is failed.

## Promotion target

This item's `promotion_target` points back at the existing `deploy` skill rather than a new skill — i.e. successful runs would result in an update to `deploy/SKILL.md` and `deploy/PROCESS.md` adding the rollback step, rather than creating a new skill. The `promote-backlog-item` skill's default behavior is to create new folders; promoting INTO an existing skill is a manual variant the `eng-lead` would handle explicitly.

## Runs log

After each run, append a row. Once `runs` reaches the promotion threshold (default 3, see [`../../../.claude/skills/promote-backlog-item/PROCESS.md`](../../../.claude/skills/promote-backlog-item/PROCESS.md)) AND every row's outcome is `success`, the owner may invoke the `promote-backlog-item` skill.

| date | actor | outcome | notes |
|------|-------|---------|-------|
