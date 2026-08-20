---
process_name: acquire-resource
owner: people-lead
collaborators: [chief-of-staff, ops-manager]
inputs: [gap_description, source_item_path]
success_criteria: [dedupe_against_registry_and_pending, smallest_grant_specced, human_grant_gate_respected, granted_resource_registered_and_discoverable]
slo: "spec within 15 minutes; grant on the human's time"
version: 0.1.0
---

# acquire-resource

## Narrative

The resource leg of self-building. Gaps arrive as `kind: resource-gap` backlog items (filed by any agent under the standing rules, or by `allocate-resource` Q0); this process turns one into a granted, registered, discoverable company resource: pick the cheapest access kind (an already-declared browser-cdp resource often needs no new grant at all), spec the smallest unblocking human action, wait at the grant gate, then register the resource so no agent ever has to be told about it again. Owned by `people-lead` (its charter's resource-registry mandate, finally implemented); the grant itself is always human (never-automate invariant 1).

## Pre-conditions

- `company/resources/` exists (ships with v0.13; older consumers receive it on sync — new files under skip-listed paths propagate).
- A gap description or a threshold-crossing `resource-gap` item.

## Steps

Mirrors SKILL.md: parse + dedupe against REGISTRY and pending requests → pick kind/cheapest path (browser-cdp task-class registration preferred over new credentials) → write the request spec + `[acquire-resource]` issue → WAIT → on grant: render RESOURCE.md, index in REGISTRY.md, transition the source item, close the issue (mcp kind: the human performs/confirms the `.mcp.json` edit) → history entry.

## Done when

- `dedupe_against_registry_and_pending` — no duplicate resource entries or duplicate pending requests.
- `smallest_grant_specced` — the request names one concrete, minimal human action.
- `human_grant_gate_respected` — no credential, secret, `.mcp.json`, settings, or `tools:` write performed by the skill.
- `granted_resource_registered_and_discoverable` — the entry + REGISTRY row exist and first-touch/design flows can find them.

## Rollback

- **Revoke:** flip the entry's `status: revoked` (keep the file — history matters), remove live auth by hand, note in the REGISTRY row.
- **Wrong spec:** edit the request file before the grant; after the grant, revoke + re-run.

## History

Every run records (`./history/` manual, `./scheduled-runs/` if ever scheduled — not scheduled in v0.13; the sweep invokes it inline at threshold, interactive spec-writing being the point).
