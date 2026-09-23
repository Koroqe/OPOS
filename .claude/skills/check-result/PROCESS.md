---
process_name: check-result
owner: coo
collaborators: [result-checker, chief-of-staff]
executor: result-checker
checker: n/a (this process IS the checker)
decision_classes: [R0]
inputs: [claim, produced_by, risk, phase, pointers]
success_criteria:
  - "The verdict was produced by a result-checker instance separate from the maker"
  - "At least one method differs from how the maker produced the result; R2 uses at least two methods"
  - "Every R2 action has a plan-phase PASS before it and a result-phase verdict after it; a result FAIL triggered the rollback"
  - "Verdict, methods and evidence are recorded where the result is reported (issue comment or task report), as pointers — no client data, correspondence or personal data"
slo: 15 min
version: 0.2.0
---

# check-result

## Narrative

The operational form of §4 of `company/policies/autonomy-and-decision-rights.md`. Agents may take R2
actions and close work on their own only because an independent checker stands between the maker and
the world. The costliest agent mistakes are confident false claims — "fixed" established by reading code
while the live system still fails, "not signed" inferred from a missing local copy. This process is the
structural answer: the maker never certifies its own result.

## Pre-conditions

- The claim is one falsifiable sentence.
- The maker states how it produced the result (`produced_by`).
- The class of the dependent action is known (R0..R3), classified by the acting agent under the policy's
  §1 rules. A class projected by dispatch or written in a triage or plan is a hint, never a reason to go
  lower.
- For R2: a plan exists — what changes, how it is rolled back, how the result will be verified.

## Steps

1. **Maker — frame the claim.** Rewrite "done / works / fixed" into what an outsider could observe
   ("GET https://example.com/ returns 200 and contains 'Y'"). Name the dependent action and its class.
2. **Maker — spawn the checker.** `Task(subagent_type: result-checker)` with `claim`, `produced_by`,
   `risk`, `phase` (`plan` | `result`) and pointers. For R2 ask for at least two independent methods;
   honour a higher number from the calling process's `checker:` field.
3. **Checker — verify** per its agent definition. `phase: plan` — is the class right (a secret, an
   access change, a schedule or client-data deletion is R3, whatever the plan says), is the rollback
   real, would the planned verification catch a failure? `phase: result` — the live system / primary
   source / recomputation; different from the maker; looking for the failure; read-only.
4. **Maker — act on the verdict.**
   - `PASS` on the plan → the R2 action may proceed. `PASS` on the result → the result may be reported
     as done. The report names the method.
   - `FAIL` on the plan → do not proceed; fix the plan or re-classify. `FAIL` on the result of an action
     already taken → **roll back per the plan**, then fix and return to step 2, or report the true state
     the checker stated.
   - `UNVERIFIABLE` → treat the action one class higher (R2 → R3: a human decides). If the cause is
     missing access, file or increment a `kind: resource-gap` backlog item.
5. **Record.** The verdict block goes in the issue comment or task report; a history entry goes in this
   skill's `history/` (`outcome: success` means the check ran, whatever the verdict; the verdict goes in
   the body). Evidence is recorded as **pointers** — a path, a hash, a query, a URL, a command — never
   client figures, correspondence, personal data or confidential deal data.
6. **Hand to the human where it matters.** For client, money and document classes, the PASS is evidence
   for the human who set the task, not a replacement of their check: name that human in the report.

## Done when

- A verdict exists from a separate checker instance, with methods and evidence.
- The dependent action followed the verdict (it proceeded only on a plan PASS; it was rolled back on a
  result FAIL).

## Verification

This process is itself the verification step. Its own quality is checked by `review-history`: a PASS
later contradicted by reality is filed as a `kind: lesson` item with `mistake_class: checker-false-pass`,
and the method that missed it is added to the checker's method rules.

## Rollback

Nothing to roll back in this process — the checker never writes to the subject. An R2 action whose
result FAILs is rolled back by the maker per the plan checked in `phase: plan`, through that action's own
process. A one-shot access scope that was used and then revoked is confirmed revoked by a checker run
from another session.

## History

Run records live in `./history/` — one file per run, `YYYY-MM-DD-<run-id>.md`, schema per `.claude/CLAUDE.md`.
