---
name: deliberate-decision
description: Multi-round propose → critique → revise loop for high-level company decisions. Orchestrates parallel direct Task calls against all 6 dept-leads + escalation-target as critics; proposer revises between rounds with critic-memory threading; arbiter renders final verdict; human approves and the decision artifact is written to company/decisions/.
version: 0.1.0
tags: [meta, framework, decision-making, deliberation]
owner_agent: coo
tools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash", "Task"]
---

# deliberate-decision

## When to use

When a high-level company decision needs systematic pressure-testing: strategic direction, hiring, market entry, major policy changes, cross-functional tradeoffs. NOT for routine tactical choices (use the chief-of-staff dispatcher or a single `consult-agent` instead — those are cheaper). The plan-critic pattern that's been load-bearing on 7 OPOS releases (v0.4.0 through v0.6.1) is now a first-class company process.

This is the framework's most expensive single skill — **~15 subagent invocations per default 2-round deliberation** (per RISKS Risk 27). Use deliberately for decisions whose stakes justify the cost.

## Inputs

- `proposal_text` (or `proposal_path` to a file containing the proposal). Required. Non-empty after trim; **soft cap 15,000 chars** (most 1-2-page strategic memos fit).
- `proposer_agent` — kebab-case agent name; required; must match an existing `name:` in `.claude/agents/**/*.md`.
- `decision_arbiter` — OPTIONAL; default = computed from escalation rule (see below).
- `critics` — OPTIONAL override; default = all dept-leads + escalation-target minus proposer.
- `rounds` — OPTIONAL; default `2`; allowed input range `[1, 5]`.

## Task-call pattern (direct, NOT through consult-agent middleware)

This skill spawns Task calls DIRECTLY — it does NOT invoke the `consult-agent` skill. Reasons:

- `consult-agent` is a SKILL (a body of instructions), not an agent. You can't `Task → consult-agent`; you'd execute consult-agent's body which itself uses Task. 6 sequential consult-agent invocations would block parallelism.
- The simulation prompt template `consult-agent` produces is reproduced INLINE in this skill's Task calls (load critic agent definition + format the "You are SIMULATING `<name>`..." framing).
- **Audit-trail consequence:** these Task calls do NOT generate `consult-agent/history/` entries. The audit lives in (a) `.claude/skills/deliberate-decision/history/` (one consolidated entry per deliberation), and (b) the decision artifact's `Audit` section (one line per Task-call summarizing each round). The framework's `consult-agent/history/` folder stays focused on user-invoked single-shot consultations.

## ESCALATION dict (verbatim — verified 2026-05-31 against agent files)

```python
ALL_DEPT_LEADS = ["rnd-lead", "finance-lead", "people-lead", "legal-lead", "commercial-lead", "pr-lead"]
ESCALATION = {
    "eng-lead": "rnd-lead",       # sub-role under rnd umbrella (v0.5.1)
    "eng-reviewer": "rnd-lead",   # sub-role under rnd umbrella
    "rnd-lead": "coo",            # explicit in rnd-lead.md
    "finance-lead": "coo",        # default; material-spend → ceo via user override
    "people-lead": "ceo",         # org-chart/hiring (strategic by nature)
    "legal-lead": "ceo",          # risk-tolerance (strategic)
    "commercial-lead": "ceo",     # pricing/deals (strategic)
    "pr-lead": "ceo",             # brand/crisis (strategic)
    "ops-manager": "coo",
    "chief-of-staff": "coo",
    "kb-curator": "coo",
    "coo": "ceo",
    "ceo": None,                  # top-of-tree
}
```

**Computed critics + arbiter:**

```python
def compute_critics_and_arbiter(proposer_agent, explicit_critics=None, explicit_arbiter=None):
    escalation_target = ESCALATION.get(proposer_agent, "coo")  # unknown → safe-default to coo
    if explicit_critics is None:
        critics = [d for d in ALL_DEPT_LEADS if d != proposer_agent]
        if escalation_target and escalation_target not in critics and escalation_target != proposer_agent:
            critics.append(escalation_target)
    else:
        critics = explicit_critics
    if explicit_arbiter is not None:
        arbiter = explicit_arbiter
    elif escalation_target is not None:
        arbiter = escalation_target
    else:
        # CEO-proposer case: no escalation target → CEO self-arbitrates (step 10 prepends warning).
        arbiter = proposer_agent  # = "ceo"
    return critics, arbiter
```

## Steps

1. **Resolve repo root** via Bash: `REPO_ROOT=$(git rev-parse --show-toplevel)`.

2. **Read inputs.** `proposal_text` (read `proposal_path` if provided), `proposer_agent`, `decision_arbiter` (optional), `critics` (optional), `rounds` (default 2, max 5).

3. **Validate.**
   - Glob `.claude/agents/**/*.md`; build a set of existing agent names from frontmatter `name:`.
   - Assert `proposer_agent` exists. Assert each `critics` member exists. Assert `decision_arbiter` exists (or compute via the rule above).
   - Assert proposal is non-empty after strip; `len(proposal_text) <= 15_000`.
   - Assert `rounds ∈ [1, 5]`.
   - Any failure → ABORT with specific reason; NO consultations spawned.
   - Initialize the deliberation tmp file: compute `decision_id` (see step 11), then `touch /tmp/deliberation-<decision_id>.md` and write the proposal as the opening section.

4. **Round N — critique.** (N starts at 1; loops up to `rounds`.) Spawn **parallel direct Task calls — one per critic — in a SINGLE executor message** so they run concurrently. For each critic the executor constructs a Task call with:
   - `description`: `"<critic_name> round-N critique"`
   - `subagent_type`: `"general-purpose"`
   - `prompt`:
     > You are SIMULATING the `<critic_name>` agent. Read your own definition first to ground yourself, then critique the following proposal.
     >
     > **Your definition (verbatim):**
     >
     > `<contents of .claude/agents/<dept>/<critic_name>.md>`
     >
     > **Department charter (if applicable):**
     >
     > `<contents of departments/<critic_dept>/CLAUDE.md or .jinja source>`
     >
     > **The proposer is `<proposer_agent>`** — their abbreviated definition:
     >
     > `<proposer agent file, Role + Inputs + Outputs sections>`
     >
     > **Proposal (round N of M):**
     >
     > `<proposal_text>`
     >
     > **(Round N > 1 ONLY — include this block; omit for Round 1):**
     >
     > > **Your prior critique was (round N-1):**
     > > `<your-stance-and-points-from-/tmp/deliberation-<id>.md>`
     > >
     > > **The proposer responded to you specifically:**
     > > `<proposer-response-to-you-from-/tmp/deliberation-<id>.md>`
     > >
     > > Re-evaluate the revised proposal considering whether your concerns were addressed. If yes → AGREE. If partly → CONCERNS with NEW points (don't re-raise the addressed ones). If you have new blockers → BLOCKER.
     >
     > Critique from your role's perspective. **Your response MUST start with exactly one of:**
     >
     > ```
     > STANCE: AGREE
     > STANCE: CONCERNS
     > STANCE: BLOCKER
     > ```
     >
     > Then provide 1-5 concrete bullet points (one per line, starting with `- `).

   **Per-critic partial-failure handling:** if a Task call fails → classify that critic as `STANCE: UNAVAILABLE` (NOT AGREE — silence is not endorsement); continue with remaining critics. If ALL critics fail → ABORT round with `outcome: failure` history entry.

5. **Parse + aggregate critique.** Apply this parser:

   ```python
   import re
   STANCE_RE = re.compile(r"^STANCE:\s*(AGREE|CONCERNS|BLOCKER)\s*$", re.MULTILINE)

   def parse_stance(response: str) -> tuple[str, list[str]]:
       m = STANCE_RE.search(response)
       if m is None:
           # PARSE_FAILED → conservative default-CONCERNS (middle option).
           return ("PARSE_FAILED", [response.strip()[:500]])
       stance = m.group(1)
       points = [line[2:].strip() for line in response.splitlines() if line.startswith("- ")]
       return (stance, points)
   ```

   Append the round-N critique block to `/tmp/deliberation-<decision_id>.md` so subsequent steps read from disk (not from executor working memory):

   ```
   ## Round N critique
   - finance-lead: CONCERNS — <points>
   - legal-lead: BLOCKER — <points>
   - people-lead: PARSE_FAILED — raw response: <truncated 500 chars>
   - commercial-lead: UNAVAILABLE — Task error
   ```

6. **Early-exit check.** If ALL critics returned `AGREE` (no PARSE_FAILED, no UNAVAILABLE, no CONCERNS, no BLOCKER) → skip to step 10. Record `early_exit_at_round: N` in the tmp file.

7. **Round N — proposer revision.** Spawn a SINGLE direct Task call (same direct-Task pattern as step 4 — NOT through consult-agent). Prompt:

   > You are SIMULATING the `<proposer_agent>` agent. Read your own definition, then revise your proposal.
   >
   > **Your definition (verbatim):** `<proposer agent file>`
   >
   > **Original proposal (round N of M):** `<proposal_text>`
   >
   > **Critics returned in round N:** `<critique_summary read from /tmp/deliberation-<id>.md>`
   >
   > Revise to address every BLOCKER and the CONCERNS you find compelling. For declined concerns, one-line reason. For PARSE_FAILED/UNAVAILABLE critics, note the gap and continue. **Respond exactly:**
   >
   > ```
   > REVISED:
   > <revised text>
   >
   > RESPONSES:
   > - <critic-name>: <how addressed, or why declined>
   > ```

   Parse the response: capture `REVISED:` block as new `proposal_text` for round N+1; capture each `RESPONSES` line into `proposer_responses[critic_name]` for round-(N+1) critics' memory blocks.

   Append to `/tmp/deliberation-<decision_id>.md`:
   ```
   ## Round N proposer revision

   <revised text>

   ## Round N proposer responses
   - <critic-name>: <response>
   ```

   **Context-size guard:** if `len(proposal_text) + len(critique_summary)` > ~25,000 chars (rare), pass only BLOCKER-stance points (omit CONCERNS — proposer can see them in the persisted log if needed in follow-up). Soft cap; default 1-page proposals never trigger it.

8. **Loop check.** If `N < rounds`: increment N and loop back to step 4 with the new `proposal_text` and `proposer_responses` available for the round-N critic-memory block.

9. **(Step 9 removed.)** Earlier draft had Levenshtein-ratio convergence detection; cut because the executor model cannot compute O(n²) similarity in-head and shouldn't shell out for a soft signal. Arbiter at step 10 qualitatively judges convergence from the persisted log.

10. **Arbiter verdict.** Read `/tmp/deliberation-<decision_id>.md` from disk (executor's working context doesn't need to hold the full log). Spawn a SINGLE direct Task call against `decision_arbiter`. Prompt:

    > You are SIMULATING the `<decision_arbiter>` agent. Read your definition, then render the final verdict.
    >
    > **Your definition (verbatim):** `<arbiter agent file>`
    >
    > **(Self-arbitration NOTE — include ONLY if `decision_arbiter == proposer_agent`, e.g. CEO-proposer case):** "You are arbitrating your own proposal. Consider whether your critics raised compelling counter-arguments before defaulting to APPROVE."
    >
    > **Full deliberation log:**
    >
    > `<contents of /tmp/deliberation-<decision_id>.md>`
    >
    > **(Context-size hint — include if log > 25,000 chars):** "The log is long; focus on the FINAL revision and the LATEST critique round when forming your verdict."
    >
    > Render the verdict. **Your response MUST start with exactly one of:**
    >
    > ```
    > VERDICT: APPROVE
    > VERDICT: REJECT
    > VERDICT: DEFER
    > ```
    >
    > Then 2-4 sentence Rationale. If APPROVE, list Follow-ups (bullets with proposed owners). If DEFER, name the specific information needed.

    **Arbiter PARSE_FAILED handling:** parse via `re.search(r"^VERDICT:\s*(APPROVE|REJECT|DEFER)", response, re.MULTILINE)`. If no match → **default to DEFER** (NOT CONCERNS or APPROVE — safety convention; kick to human). Log "arbiter PARSE_FAILED → defaulted to DEFER" prominently. Critic PARSE_FAILED defaults to CONCERNS (middle); arbiter PARSE_FAILED defaults to DEFER (safer).

11. **Render decision artifact (in memory only).** Compute `decision_id` with UUID suffix to prevent collisions:

    ```bash
    SLUG=$(echo "<proposal first 7 words>" | tr 'A-Z' 'a-z' | sed 's/[^a-z0-9-]/-/g; s/--*/-/g; s/^-//; s/-$//' | head -c 40)
    UUID6=$(uuidgen | tr -d - | head -c 6 | tr 'A-Z' 'a-z')
    DECISION_ID="${SLUG}-${UUID6}"  # e.g. "berlin-sales-office-a3f9c2"
    ```

    Load `shared/templates/decision.md.tmpl`. Substitute the 10 frontmatter tokens. Body sections (Proposal, Round N × M, Arbiter verdict, Rationale, Follow-ups, Audit) populated from `/tmp/deliberation-<decision_id>.md`. **Do NOT write to disk yet** — present to the user at step 12. The render is a string in memory.

12. **Present to user + record outcome.** Output the rendered artifact as an inline code block in chat. Follow with 3-line summary: "Proposed by X, critiqued by N agents over M rounds (early-exit: yes/no). Arbiter verdict: <APPROVE/REJECT/DEFER>." Ask the user:
    - `APPROVE` — write the file
    - `REJECT` — don't write; partial outcome
    - `REQUEST_ANOTHER_ROUND` — loop back to step 4; **absolute cap of 5 rounds total** including user-requested extensions

    **On APPROVE:**
    - `mkdir -p company/decisions/` (handles old consumers who scaffolded pre-v0.6.1 and never ran `copier update`).
    - Write the artifact to `company/decisions/$(date +%Y-%m-%d)-<decision_id>.md`.
    - Delete `/tmp/deliberation-<decision_id>.md`.
    - Write `outcome: success` history entry to `.claude/skills/deliberate-decision/history/`. Body includes: critic list, arbiter verdict, # of rounds, artifact path, all PARSE_FAILED/UNAVAILABLE incidents. This IS the consolidated audit trail.

    **On REJECT:** delete tmp file; write `outcome: partial` history entry capturing the deliberation but NOT the artifact (the human override IS the decision).

    **On REQUEST_ANOTHER_ROUND:** if `N < 5`, set `rounds := N + 1`, loop back to step 4. If `N == 5`, refuse: "Round cap reached (5 total). Please APPROVE or REJECT."

## Outputs

- Decision artifact at `company/decisions/YYYY-MM-DD-<decision_id>.md` (only on APPROVE).
- Consolidated history entry at `.claude/skills/deliberate-decision/history/YYYY-MM-DD-<run-id>.md`.
- One-line summary in chat.
- **Deliberation-induced Task calls do NOT write to `.claude/skills/consult-agent/history/`** — they're audited via the artifact + this history entry. Documented divergence from per-skill audit convention.

## Failure modes

- **Proposal too large** — step 3 fail. Recovery: summarize or split.
- **Proposer/critic/arbiter agent not found** — step 3 fail. Recovery: check spelling; `grep -r 'name:' .claude/agents/` to list.
- **All critics fail in one round** — step 4 fail. `outcome: failure`. Recovery: re-run when transient issues resolve.
- **Arbiter PARSE_FAILED** — step 10 fall back to DEFER + flag. Recovery: user reviews at step 12.
- **User REJECTs** — step 12; `outcome: partial`; deliberation recorded but artifact not written.
- **Round cap hit at 5** — step 12 forces APPROVE/REJECT.

## Related

- Process definition: `./PROCESS.md`
- Run history: `./history/`
- Sibling skill: [`consult-agent`](../consult-agent/) — single-shot consultation; this skill replicates its simulation prompt pattern but spawns Task calls directly for parallelism.
- Template: [`shared/templates/decision.md.tmpl`](../../../shared/templates/decision.md.tmpl)
- Folder: [`company/decisions/`](../../../company/decisions/) — where APPROVE'd decision artifacts land.
- Owner agent: [`.claude/agents/company/coo.md`](../../agents/company/coo.md)
- Closes: the framework's missing agent-to-agent critique loop (had only `design-process` step 8's human-side iteration prior).
