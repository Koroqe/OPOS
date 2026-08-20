---
name: acquire-resource
description: Turn a missing-tool/access gap into a granted, registered company resource — spec the request, wait at the human grant gate, then register the resource so every agent can find and use it
version: 0.1.0
tags: [meta, framework, resources, self-building]
owner_agent: people-lead
tools: ["Read", "Grep", "Glob", "Edit", "Write", "Bash"]
---

# acquire-resource

## When to use

- Routed from `allocate-resource` Q0 (the gap is an INSTRUMENT, not an executor).
- Routed from `review-history`'s backlog sweep when a `kind: resource-gap` item hits threshold.
- Manually: `/acquire-resource "<what access is missing and for which task class>"`.

The instrument counterpart of `allocate-resource`: that skill answers "who should do this work?"; this one answers "what does the company need to REACH to do this work?".

## The grant gate (never-automate invariant 1 — the load-bearing constraint)

The `pending-grant → active` flip is ALWAYS a human action: only a human supplies credentials, logs an account in, sets a secret, or approves an MCP server registration. This skill specs, requests, waits, and registers — it never grants itself anything, and no scheduled run may carry authority over `.mcp.json`, settings permissions, or agent `tools:` writes.

## Steps

1. **Parse + dedupe + resume.** Validate the gap description (≥15 chars). Check `company/resources/REGISTRY.md`: an existing `active` resource covering the gap → stop with `outcome: covered` and print how to use it (the gap was discoverability, not absence; note that in the source backlog item). An existing `pending-grant` row → open its request spec: `granted: true` → **jump to step 5 and complete the registration** (this is the resume path — any later invocation finishes what the human's flip started); still `granted: false` → increment its urgency note, stop.
2. **Pick the kind + cheapest path.** In order of preference: an already-authed `cli` on some machine; an `api` with env/MCP auth the human can set once; **`browser-cdp` — when the operator's browser is declared, most account-bound tasks (DNS, domains, email, SaaS admin) need NO new grant at all**: register the task class against the existing browser resource instead of requesting new credentials; `mcp` for data stores; bare `account` as the fallback. Prefer the path with the smallest new-credential surface.
3. **Write the request spec AND the pending row.** Append a `status: pending-grant` placeholder row to `company/resources/REGISTRY.md` (so the registry, the ops panel, and `schedule-process`'s availability check all see the in-flight request). Then write the spec to `company/resources/requests/<YYYY-MM-DD>-<slug>.md` — frontmatter includes `granted: false` (THE resume signal: the human flips it to `true` when the grant is done, in the same sitting as the grant itself; the issue and the residual-duties card both say so): the gap, the chosen kind + path, exactly what the human must do (the smallest grant that unblocks — e.g. "run `gh secret set CLOUDFLARE_API_TOKEN`" or "confirm agents may use your Chrome for Cloudflare DNS edits"), which task classes it unlocks, and the draft RESOURCE.md entry ready to activate. File the consumer-repo issue `[acquire-resource] grant needed — <slug>` (local title dedupe, repo via `gh repo view`).
4. **WAIT.** The run ends here. No polling loop; the human acts on their own time.
5. **On grant (the human says so directly, or step 1's resume path found `granted: true`):** render the RESOURCE.md entry from `shared/templates/RESOURCE.md.tmpl` (status `active`, `owner_human` named, `machines:` filled for per-machine kinds), flip the placeholder REGISTRY row to `status: active` (filling machines), delete or archive the request spec, flip the source `resource-gap` backlog item to `state: designed` + `designed_as: company/resources/<name>.md`, close the issue. **`mcp` kind only — the register-mcp-server sub-step:** the human edits `.mcp.json` themselves (or watches the edit and confirms line-by-line); this skill may PRINT the exact JSON to add but never writes that file autonomously.
6. **History entry** per the prelude routing convention.

## Failure modes

- **Human declines the grant** — request spec → `declined/` with the reason; the placeholder REGISTRY row is removed; source item → `state: rejected`; the reason is a lesson (was the ask too broad? file a `kind: lesson` item if the spec itself was the problem).
- **Granted but unusable** (auth fails on first use) — reopen the request with the failure attached per the tried-and-failed contract.
- **No `gh`/remote** — the request spec still lands in `requests/`; the issue is skipped with a note; the human finds it via the ops panel (pending-grant count).

## Related

- Executor counterpart: [`allocate-resource`](../allocate-resource/) (its Q0 routes here)
- The registry: `company/resources/` (README = the rules; REGISTRY.md = the index)
- Entry template: [`RESOURCE.md.tmpl`](../../../shared/templates/RESOURCE.md.tmpl) (incl. the browser-cdp kind rules)
- Counting input: `kind: resource-gap` backlog items swept by [`review-history`](../review-history/)
