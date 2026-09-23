---
process_name: check-result
owner: coo
collaborators: [result-checker, chief-of-staff]
executor: result-checker
checker: n/a (this process IS the checker)
decision_classes: [R0]
inputs: [claim, produced_by, risk, pointers]
success_criteria:
  - "The verdict was produced by a result-checker instance separate from the maker"
  - "At least one method differs from how the maker produced the result; R2 uses at least two methods"
  - "Verdict, methods and evidence are recorded where the result is reported (issue comment or task report)"
slo: 15 min
version: 0.1.0
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
- The class of the dependent action is known (R0..R3).

## Steps

1. **Maker — frame the claim.** Rewrite "done / works / fixed" into what an outsider could observe
   ("GET https://example.com/ returns 200 and contains 'Y'"). Name the dependent action and its class.
2. **Maker — spawn the checker.** `Task(subagent_type: result-checker)` with `claim`, `produced_by`,
   `risk` and pointers. For R2 ask for at least two independent methods; honour a higher number from the
   calling process's `checker:` field.
3. **Checker — verify** per its agent definition: the live system / primary source / recomputation;
   different from the maker; looking for the failure; read-only.
4. **Maker — act on the verdict.**
   - `PASS` → the R2 action may proceed, or the result may be reported as done. The report names the method.
   - `FAIL` → do not proceed. Fix and return to step 2, or report the true state the checker stated.
   - `UNVERIFIABLE` → treat the action one class higher (R2 → R3: a human decides). If the cause is
     missing access, file or increment a `kind: resource-gap` backlog item.
5. **Record.** The verdict block goes in the issue comment or task report; a history entry goes in this
   skill's `history/` (`outcome: success` means the check ran, whatever the verdict; the verdict goes in
   the body).

## Done when

- A verdict exists from a separate checker instance, with methods and evidence.
- The dependent action followed the verdict (it proceeded only on PASS).

## Verification

This process is itself the verification step. Its own quality is checked by `review-history`: a PASS
later contradicted by reality is filed as a `kind: lesson` item with `mistake_class: checker-false-pass`,
and the method that missed it is added to the checker's method rules.

## Rollback

Nothing to roll back — the checker never writes to the subject. An R2 action that proceeded wrongly is
rolled back by that action's own process.

## History

Run records live in `./history/` — one file per run, `YYYY-MM-DD-<run-id>.md`, schema per `.claude/CLAUDE.md`.
