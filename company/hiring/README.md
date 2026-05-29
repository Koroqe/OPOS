# company/hiring/

Job specs for **human-route resource allocations** — what the framework writes when [`allocate-resource`](../../.claude/skills/allocate-resource/) (owned by `people-lead`) decides a capability gap requires a human hire rather than a new AI agent.

## Lifecycle

Each file under this folder follows the state machine:

```
pending → approved → posted → filled
```

| State | Set by | Meaning |
|---|---|---|
| `pending` | allocate-resource (default at write time) | Job spec drafted; awaiting ceo approval |
| `approved` | ceo (manual frontmatter edit) | Approved by ceo; ready to publish |
| `posted` | people-lead (after job board / ATS publish) | Live on the job market |
| `filled` | people-lead (after the hire closes) | Role filled; spec archived for audit |

## Convention

- Filename: `<slug>.md` (slug derived by allocate-resource using `safe_slug` regex `^[a-z][a-z0-9-]{1,62}$`; collisions get `-2`, `-3` suffix).
- Frontmatter REQUIRED fields: `title`, `slug`, `owner` (always `people-lead`), `created`, `state`, `why_not_ai`.
- The `why_not_ai:` field records WHICH of the 4 AI-first decision-tree questions failed at allocate-resource step 4. This is the audit trail for "why did we hire a human instead of designing an AI agent?"

## Templates

- [`shared/templates/HIRING-SPEC.md.tmpl`](../../shared/templates/HIRING-SPEC.md.tmpl) — the source template (`allocate-resource` step 6 strips the comment header at render time).

## See also

- [`allocate-resource`](../../.claude/skills/allocate-resource/) — the skill that writes here.
- [`people-lead`](../../.claude/agents/people/people-lead.md) — the agent that owns this folder.
