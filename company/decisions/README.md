# Company decisions

This folder holds **APPROVE'd decision artifacts** written by the `deliberate-decision` skill (added v0.6.1, owned by `coo`). One markdown file per decision, named `YYYY-MM-DD-<decision_id>.md` where `decision_id` includes a 6-char UUID suffix to prevent collisions across machines or rapid-succession deliberations on the same date (e.g., `2026-05-31-berlin-sales-office-a3f9c2.md`).

## What lives here

- **Strategic decisions** that went through the multi-round propose → critique → revise loop.
- The artifact captures: original proposal, each round's critique summary + proposer revision + responses to critics, arbiter verdict (APPROVE / REJECT / DEFER), rationale, follow-up actions with proposed owners, and an audit-trail section.

## What does NOT live here

- **REJECT'd or DEFER'd decisions** — the deliberation IS recorded (in the `deliberate-decision/history/` entry) but the artifact is NOT written. The artifact is reserved for decisions the human explicitly approved at step 12.
- **Routine tactical choices** — those go through the chief-of-staff dispatcher or a single `consult-agent` call. Reserved for decisions whose stakes justify the deliberation cost (~15 subagent invocations per default 2-round run).

## Workflow

1. User invokes `/deliberate-decision` with a proposal + proposer agent.
2. Skill orchestrates 2 rounds of parallel critique (all 6 dept-leads + escalation-target) and proposer revision.
3. Arbiter renders APPROVE / REJECT / DEFER from the full deliberation log.
4. Human reviews at step 12: APPROVE → artifact written HERE; REJECT/DEFER → no artifact.

## Distribution

Founder-owned post-scaffold. The README + `.gitkeep` ship as framework CORE (so the folder convention propagates to existing consumers via `copier update`); per-decision dated files are runtime-only and excluded from `copier copy`. See `copier.yml` `_exclude` entry `company/decisions/202[0-9]-*.md`.

## Related

- Skill: `.claude/skills/deliberate-decision/`
- Template: `shared/templates/decision.md.tmpl`
- Owner agent: `.claude/agents/company/coo.md`
- Cost note: README's "How to use OPOS day-to-day" section + RISKS Risk 27.
