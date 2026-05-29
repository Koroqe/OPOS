---
process_name: deploy
owner: eng-lead
collaborators: [eng-reviewer]
inputs: [commit_sha, target_env]
success_criteria: [pipeline_green, smoke_tests_pass, history_entry_written]
slo: "30 min"
version: 0.1.0
---

# deploy

## Narrative

The engineering deploy process. A successful deploy means: the pipeline ran cleanly, the service responded healthily in the target environment, smoke tests passed, and the run was recorded in the skill's history folder. Owned by `eng-lead`; `eng-reviewer` is a collaborator (their review is a prerequisite to deploy).

## Pre-conditions

- CI is green for `commit_sha`.
- `eng-reviewer` has approved the underlying PR or change.
- `target_env` is not currently in an active incident state.
- The deploying actor is `eng-lead` (or an explicit delegate documented in the runbook).

## Steps

1. **Pre-flight** — eng-lead verifies CI status, reviewer approval, and target-env health.
2. **Pipeline** — invoke the deploy pipeline against `commit_sha` → `target_env`.
3. **Verify** — hit the health endpoint; run smoke tests.
4. **Record** — write the history entry.

## Done when

- `pipeline_green` — the deploy pipeline completed with a success status.
- `smoke_tests_pass` — all smoke tests against `target_env` exit clean.
- `history_entry_written` — a new file exists under `./history/` for this run, with valid frontmatter and a body.

## Rollback

If smoke tests fail or production behavior degrades:

1. Identify the previous good `commit_sha` (typically the prior production deploy's history entry).
2. Invoke this same `deploy` process with the prior `commit_sha` as input. Mark the rollback's history entry with `actor: eng-lead` and `proposed_delta` describing the root cause if known.
3. After rollback succeeds, file a postmortem in `departments/engineering/data/postmortem-YYYY-MM-DD-<slug>.md`.
4. If the original deploy left partial state in the target environment, document the cleanup steps in the rollback's history entry.

## History

Run records live in `./history/` — one file per run, named `YYYY-MM-DD-<run-id>.md`.

Schema for each history entry (see root `CLAUDE.md` for the full description):

- `date`: YYYY-MM-DD
- `run_id`: short id unique within this skill
- `skill`: `deploy`
- `actor`: agent name (typically `eng-lead`) or human name
- `outcome`: `success` | `partial` | `failure`
- `duration_min`: integer
- `proposed_delta`: free text or "none"
- `status`: `open` | `applied` | `rejected`
