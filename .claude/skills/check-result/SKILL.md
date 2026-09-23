---
name: check-result
description: Maker/checker gate. Before any R2 action and before any "done" above R0, hand the claimed result to the result-checker agent, which re-establishes it by a different method (live system, primary source, recomputation) and returns PASS / FAIL / UNVERIFIABLE with evidence. The verdict, not the maker's word, is what gets reported and what unlocks the R2 action.
version: 0.1.0
tags: [operations, verification, maker-checker, autonomy]
owner_agent: coo
tools: ["Read", "Grep", "Glob", "Bash", "Task", "Write"]
---

# check-result

Follow [`PROCESS.md`](PROCESS.md) (authoritative). Quick facts:

- **Caller** = the maker (any agent, or the steward). **Checker** = a fresh `result-checker` subagent via
  `Task` (`subagent_type: result-checker`), never the maker's own context.
- **Write the claim as one falsifiable sentence** and say how you produced it, so the checker can pick a
  different method. Vague claims ("it works") are rejected — rewrite them first.
- **Independent methods by risk**: R0 — none required; R1 "done" — 1; R2 — at least 2; negative claims
  about documents, money or obligations — every system the fact could live in, plus a behavioural check;
  external facts — sources of different types. A process may raise these numbers in its `checker:` field.
- **Only PASS unlocks.** FAIL → fix and re-check, or report the true state. UNVERIFIABLE → the action
  stays one class higher (R2 is handled as R3) and missing access is filed as a `kind: resource-gap`.
- **Report the verdict with its method** in the issue comment or task report ("verified: <method>, PASS").
- Every run writes `history/YYYY-MM-DD-<run-id>.md`.

Policy: [`company/policies/autonomy-and-decision-rights.md`](../../../company/policies/autonomy-and-decision-rights.md) §4.
