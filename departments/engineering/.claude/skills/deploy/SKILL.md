---
name: deploy
description: Deploy the engineering service to production
version: 0.1.0
tags: [engineering, ops, release]
owner_agent: eng-lead
---

# deploy

## When to use

A commit on `main` is ready for production: tests pass on CI, the change has been reviewed (by `eng-reviewer`), and the on-call engineer is available to monitor.

## Inputs

- `commit_sha` — the commit to deploy.
- `target_env` — production environment identifier (e.g. `prod-us-east`, `prod-eu-west`).

## Steps

1. **Pre-flight checks** — verify CI is green for `commit_sha`, the change has an approving review from `eng-reviewer`, no incidents are active in `target_env`.
2. **Run pipeline** — invoke the deploy pipeline (placeholder: adopters wire in their actual CI/CD here; could be a `gh workflow run`, a `kubectl apply`, etc.).
3. **Verify health** — after rollout completes, hit the service's health endpoint and confirm 200 OK, then run smoke tests against `target_env`.
4. **Record history entry** — write `departments/engineering/.claude/skills/deploy/history/YYYY-MM-DD-<run-id>.md` with the schema-conformant frontmatter and a body summarizing what was deployed, any anomalies, and the proposed delta (or "none").

## Outputs

- Deployed version visible at `target_env`'s health endpoint.
- A history entry recording the run.
- (On failure) An incident reference and a rollback record.

## Failure modes

- **Build fail** — pipeline step 2 fails before rollout. Recovery: do not proceed to step 3; record `outcome: failure` with the failing job's log link. No production change occurred.
- **Smoke-test fail** — step 3 detects bad behavior after rollout. Recovery: trigger the rollback procedure from `PROCESS.md`. Record `outcome: failure` and `proposed_delta` describing what the smoke tests caught.
- **Rollback path** — if the deploy must be reversed, follow the rollback procedure in `./PROCESS.md`. The rollback itself is a deploy of the prior version; record it as a separate history entry with `actor: eng-lead`, `proposed_delta: <root cause if known>`.

## Related

- Process definition: `./PROCESS.md`
- Run history: `./history/`
