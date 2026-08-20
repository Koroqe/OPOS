# company/resources/ — the tooling registry

**The answer to "what can this company's agents actually reach?"** One file per resource (rendered from `shared/templates/RESOURCE.md.tmpl` — kinds: `cli`, `mcp`, `browser-cdp`, `account`, `api`), indexed in [`REGISTRY.md`](./REGISTRY.md). Consumer-owned (STARTER); steward: `people-lead`; every entry names its `owner_human`.

Three rules carry the whole leg:

1. **Pointers only.** No credential material anywhere in this folder — entries record that a capability exists and how to reach it, never the secret that opens it.
2. **Tools first, humans last.** Before delegating any task to a human, an agent checks this registry and TRIES the matching resource (the founder's browser via CDP counts — that is what it is declared for). Escalation to a human requires the tried-and-failed contract: what was attempted, the exact failure, the smallest unblocking action requested. The full doctrine lives in the chief-of-staff charter.
3. **Redaction-sensitive.** The registry is a map of the company's vendors, accounts, and hostnames. `propose-to-core` assembles its outbound blocklist FROM these entries; nothing under `company/resources/` is ever quoted in an outbound artifact. `requests/` (access requests awaiting a human grant, written by `acquire-resource`) is copier-excluded and doubly so.

Missing capability? That's a `kind: resource-gap` backlog item; at threshold the sweep routes it to `/acquire-resource`, which specs the request and waits at the human grant gate — the one decision that stays human forever (never-automate invariant 1).
