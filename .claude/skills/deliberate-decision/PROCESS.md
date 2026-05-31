---
process_name: deliberate-decision
owner: coo
collaborators: [ceo, rnd-lead, finance-lead, people-lead, legal-lead, commercial-lead, pr-lead]
inputs: [proposal_text, proposer_agent, decision_arbiter, critics, rounds]
success_criteria: [inputs_validated, critics_selected, rounds_completed, arbiter_verdict_rendered, artifact_drafted, user_approved, artifact_written, history_entry_written]
slo: "interactive — 5-15 minutes per session depending on round count and consultation latency"
version: 0.1.0
state_schema:
  - validating: inputs read; agent-existence + slug/length/range checks; tmp file initialized (steps 1-3)
  - round-critiquing: parallel Task calls per critic; STANCE parsing + UNAVAILABLE/PARSE_FAILED handling; persist to tmp (steps 4-5)
  - round-revising: single Task call against proposer; capture REVISED + RESPONSES; persist (step 7)
  - loop-checking: increment round; early-exit on all-AGREE; absolute cap of 5 (steps 6 + 8)
  - arbitrating: Task call against decision_arbiter; PARSE_FAILED → DEFER fallback; self-arbitration warning for CEO-proposer (step 10)
  - presenting: render artifact in memory; user APPROVE/REJECT/REQUEST_ANOTHER_ROUND (step 12 — first half)
  - committing: mkdir -p; write artifact; cleanup tmp; consolidated history entry (step 12 — second half)
---

# deliberate-decision

## Narrative

Formalizes the propose → critique → revise pattern that's been load-bearing on 7 consecutive OPOS releases (v0.4.0 through v0.6.1 via plan-critic) as a first-class company process. The framework had NO agent-to-agent critique loop before v0.6.1 — `design-process` step 8 iterates between agent and *human user*; `consult-agent` is single-shot. This skill closes the gap for high-level (CEO + dept-lead) decisions.

Owned by `coo` because COO already arbitrates cross-functional design decisions and owns `company-setup`. Second owned skill fits the meta-coordination scope without changing CEO's "owns nothing" pattern. Collaborators list includes all 6 dept-leads + CEO (the default critic-set per the ESCALATION-driven rule).

## Pre-conditions

- A human user is present (step 12 requires conversational APPROVE/REJECT/REQUEST_ANOTHER_ROUND).
- The proposer agent file exists with a parseable frontmatter `name:` field.
- Each critic agent file + the arbiter agent file exists.
- `/tmp` is writable (used for `/tmp/deliberation-<decision_id>.md` persistence between rounds).
- `uuidgen` available on PATH (used for decision_id UUID suffix).
- `git rev-parse --show-toplevel` works (step 1 resolves repo root via Bash).

## Steps

Mirrors the 12-step procedure in SKILL.md:

1. Resolve repo root via Bash.
2. Read inputs (proposal_text, proposer_agent, optional decision_arbiter / critics / rounds).
3. Validate (agent existence; proposal length; round range); initialize `/tmp/deliberation-<decision_id>.md`.
4. Round N — parallel direct Task calls per critic (NOT through consult-agent); round-N>1 includes prior-critique + proposer-response memory block.
5. Parse + aggregate stances via STANCE_RE; UNAVAILABLE + PARSE_FAILED handling; persist to tmp.
6. Early-exit if all-AGREE → skip to step 10.
7. Round N — single Task call to proposer; capture REVISED + RESPONSES; persist to tmp.
8. Loop back to step 4 if N < rounds.
9. (Removed — convergence detection cut.)
10. Read tmp file from disk; single Task call to arbiter; PARSE_FAILED → DEFER fallback; self-arbitration warning for CEO-proposer.
11. Render artifact in memory; compute UUID-suffixed decision_id via Bash uuidgen.
12. Present to user; APPROVE → mkdir -p + write artifact + cleanup tmp + history; REJECT → cleanup tmp + partial history; REQUEST_ANOTHER_ROUND → loop (cap 5).

## State transitions

Strict forward order with loop-back from `loop-checking` to `round-critiquing` until either rounds exhausted or all-AGREE early-exit. The `presenting` state can loop back to `round-critiquing` via REQUEST_ANOTHER_ROUND (capped at absolute 5). The `committing` state is the only one that writes the artifact to disk.

## Done when

- `inputs_validated` — step 3 passed; tmp file initialized.
- `critics_selected` — step 3 either accepted explicit critics or computed defaults from ESCALATION.
- `rounds_completed` — all rounds (up to user-final-cap) executed; persisted in tmp file.
- `arbiter_verdict_rendered` — step 10 returned APPROVE / REJECT / DEFER (DEFER may be PARSE_FAILED-default).
- `artifact_drafted` — step 11 rendered the artifact string in memory.
- `user_approved` — step 12 received unambiguous APPROVE (OR `partial` outcome if REJECT).
- `artifact_written` — step 12 wrote to disk (skipped if `partial` outcome).
- `history_entry_written` — file exists under `./history/`.

## Rollback

- **Mid-deliberation interruption (lost session):** `/tmp/deliberation-<decision_id>.md` may persist. v2 candidate: `list-deliberations-in-flight` skill to clean orphans.
- **Post-APPROVE undo:** the user can `git rm` the decision artifact + commit. The history entry stays (the decision-event was real even if reverted).
- **Post-REJECT undo:** no rollback needed (nothing was written; the history entry IS the record).

## History

Every invocation writes ONE consolidated history entry (success / partial / failure). Body captures: critic list, arbiter verdict, # of rounds, artifact path (or "not written" for partial), all PARSE_FAILED / UNAVAILABLE incidents during the run, any user REQUEST_ANOTHER_ROUND escalations. **Deliberation-induced Task calls do NOT write to `.claude/skills/consult-agent/history/`** — the audit is consolidated at this skill's level + in the decision artifact's Audit section. Documented divergence from the framework's per-skill audit convention; trade-off rationale in SKILL.md.
