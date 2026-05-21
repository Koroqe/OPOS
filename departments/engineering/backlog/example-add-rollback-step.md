---
title: Add rollback verification step to deploy
owner: eng-lead
created: 2026-05-21
state: active
runs: 0
intended_target: departments/engineering/.claude/skills/deploy/
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

## Intended target

This item's `intended_target` points back at the existing `deploy` skill rather than a new skill — i.e. when this work is formalized, it should result in an update to `deploy/SKILL.md` and `deploy/PROCESS.md` adding the rollback step, rather than creating a new skill. `design-process`'s default behavior is to create a new folder; designing changes INTO an existing skill is a manual variant the `eng-lead` would handle explicitly in conversation with `ops-manager`.

## Runs log

An audit trail of manual executions; informational only. When `eng-lead` decides this item is ready to formalize, they invoke the `design-process` skill (owned by `ops-manager`) and pass this file's path as input — `design-process` is the path to formalization.

| date | actor | outcome | notes |
|------|-------|---------|-------|
