---
name: company-setup
description: Interactive first-run founder onboarding — populates Mission, Values, strategic priorities, dept missions, and 0-3 initial policies from a fresh OPOS scaffold
version: 0.1.0
tags: [meta, framework, onboarding, founder]
owner_agent: coo
tools: ["Read", "Edit", "Write", "Bash", "Grep", "Glob"]
---

# company-setup

## When to use

ONCE per OPOS instance, immediately after `copier copy gh:Koroqe/OPOS`. The founder runs `/company-setup` as the FIRST command in their freshly-scaffolded Claude Code session. The skill is INTERACTIVE: it asks ~10 questions conversationally, writes the answers to the right files, and refuses to overwrite if the repo already has founder content.

Re-running on a COMPLETED repo is REFUSED (step 1 abort). Re-running after a PARTIAL run (interruption before the step-9 history entry) resumes at the first incomplete step. To re-do from scratch: manually restore the `<one short sentence>` placeholder in root `CLAUDE.md`'s Mission section.

## Inputs

None. All data is gathered conversationally.

## Path convention

The skill runs on the **consumer's repo AFTER `copier copy`**, where `.jinja` suffixes have already been stripped. All paths below are the rendered `.md` paths (e.g., `CLAUDE.md`, `departments/rnd/CLAUDE.md` — NOT `.jinja` sources).

## Steps

1. **Verify we are running on a fresh scaffold + git-initialized — or a resumable partial run.**
   - Verify `.git/` exists. If not, ABORT with: "`/company-setup` requires a git repo. Run `git init && git add -A && git commit -m 'chore: initial OPOS scaffold'` first."
   - Read root `CLAUDE.md`. If the Mission section still contains the unique literal token `<one short sentence>`, this is a fresh scaffold — continue at step 2. (The token is narrow on purpose; `exists to` alone would falsely trigger on legitimate missions like "...whose purpose exists to...".)
   - If the Mission token is gone, distinguish a COMPLETED setup from a PARTIAL one by the step-9 artifact: does any `.claude/skills/company-setup/history/*-setup-*.md` entry exist? A completed run always writes it; an interrupted run never reached it.
     - **History entry present** → ABORT with: "Mission already set — appears to be a populated repo. Re-running company-setup would overwrite. If you want to re-do, manually restore the placeholder `<one short sentence>` token in the Mission section first."
     - **History entry absent (partial run)** → detect per-step completion from each step's artifact, in order: step 4 (no `- Value N — one-line restatement.` placeholder lines remain in root `CLAUDE.md`), step 5 (`company/strategy/priorities.md` exists), step 6 (no dept-mission placeholder lines remain in `departments/*/CLAUDE.md`). Print the detected state ("steps 3–5 complete; resuming at step 6") and **resume at the first incomplete step**, skipping completed ones. Step 7 (policies) is optional (0–3) and never counts as incomplete; steps 8–9 always re-run at the end of a resumed session. Fresh-scaffold and fully-completed behavior are unchanged.

2. **Greet + explain the flow.** Print: "I'll ask ~10 questions about your company. Total time: ~15 minutes. Progress is written to files as we go; Ctrl-C exits and any sections already written stay. To re-run from scratch, restore the `<one short sentence>` placeholder in root CLAUDE.md. Let's begin."

3. **Mission (1 question).** Ask: "What is your company's mission, in one sentence? Complete the form: `<COMPANY_NAME> exists to ____.`" Capture the founder's answer. Validate: non-empty, ≤200 chars (re-ask if validation fails). Use the `Edit` tool to replace the placeholder Mission line in root `CLAUDE.md`.

4. **Values (1 question).** Ask: "What are 3-5 values that guide your company? List them one per line (a short title + one-line restatement, e.g. 'Honesty: we share bad news fast.'). Aim for actionable phrasing, not platitudes." Capture. Validate: inclusive 3 ≤ count ≤ 5 (re-prompt with "I need between 3 and 5 values, inclusive" on failure). Then replace the 5 placeholder `- Value N — one-line restatement.` lines in root `CLAUDE.md`:
   - If founder supplied 5: replace 1-for-1.
   - If 4: replace 4 lines + REMOVE the 5th placeholder line entirely.
   - If 3: replace 3 lines + REMOVE lines 4 and 5 entirely.
   Do NOT leave dangling "Value N — one-line restatement." placeholders.

5. **Strategic priorities (1 question).** Ask: "What are your top 3 strategic priorities for the next 6-12 months? One sentence each." Capture. Validate: inclusive 1 ≤ count ≤ 5 lines. Write to `company/strategy/priorities.md` with minimal frontmatter:
   ```yaml
   ---
   title: Strategic priorities — 6-12 month horizon
   owner: coo
   created: <today YYYY-MM-DD>
   ---

   # Strategic priorities

   <priorities as a numbered list>
   ```
   Do NOT invent a `restricted: true` field — the folder-level convention is enforced by `company/strategy/CLAUDE.md`'s frontmatter; individual files inherit by location.

6. **Department decisions (6-dept loop).** As of v0.5.1, the framework ships 6 default departments (`rnd` umbrella for engineering + 5 new). For EACH dept in this order, ask `keep` or `customize`:
   - **`rnd`** (R&D umbrella — building function; eng-lead + eng-reviewer report up to rnd-lead) — starter mission: `Reduce uncertainty about external state AND execute the company's building work — research, engineering, production, product/service delivery.`
   - **`finance`** — starter: `Owns cashflow, budgeting, expense categorization, revenue forecasting, pricing analysis. Drafts monthly reports, projects new-agent operating costs as design-agent input.`
   - **`people`** — starter: `Owns capability gap → resource allocation via allocate-resource (the AI-first kernel). Every gap is first evaluated for AI-agent suitability; human hire is the fallback only for tasks requiring lived experience, physical action, or legal accountability.`
   - **`legal`** — starter: `Owns contract review, compliance tracking (GDPR/SOC2/etc.), and IP protection. LLM-scale review for routine matters; external counsel for high-stakes signoff.`
   - **`commercial`** (marketing + sales unified at v0) — starter: `Owns revenue end-to-end — demand generation, marketing content, sales pipeline, customer success. LLM drafts content; human approves public-facing copy.`
   - **`pr`** — starter: `Owns external communications — press releases, brand voice, social presence, crisis comms. Drafts press materials; human signoff on all public-facing copy.`

   For each:
   - **keep:** no edit; print "<dept> kept as-is."
   - **customize:** ask "Provide a new 1-3 sentence mission for <dept>:" → use `Edit` to rewrite the Mission line(s) in `departments/<dept>/CLAUDE.md` (rendered path).

   **"remove" is NOT supported.** If the founder types "remove" or similar for any dept, print the dept-removal guidance from Failure modes and continue with "keep" by default. Removal cascades into agent and dept-nested-skill removals — it's a manual post-setup operation with full awareness.

7. **Initial policies (1 question per policy, 0-3 total).** Ask: "Do you want to seed any company-level policies right now? (yes/no) — if yes, I'll ask for up to 3." For each requested policy:
   - "Policy name (kebab-case slug, e.g. `client-data-handling`):" — validate per the rules below; REFUSE on conflict + ask for a different name (do NOT auto-coerce).
   - "Scope (one sentence — who/what this applies to):"
   - "Rule (one or two sentences — the actual policy):"
   - "Review cadence (e.g. `quarterly`, `annual`, `on-incident`):"
   - Read `shared/templates/POLICY.md.tmpl`, **strip the HTML comment header** (everything from `<!--` through the matching `-->` and any trailing blank line), substitute the 7 tokens, and write to `company/policies/<slug>.md`.

   **Policy name validation (REFUSE on ANY of these):**
   - **Slug-regex fail**: must match `^[a-z][a-z0-9-]{1,62}$`.
   - **Existing-file collision**: `company/policies/<slug>.md` already exists.
   - **Framework-reserved exact-match** against this hand-maintained list: `{secrets, restricted, risks, framework, audit, history, mission, values, charter, strategy, policies}`. **Match semantics: exact whole-string equality, NOT prefix.** So `secrets-management` is allowed; `secrets` alone is not.

   When refusing, print WHICH check fired + the relevant rule. Ask for a different name. Loop until valid or founder says "skip".

8. **Smoke check (greppable subset only).** Run only the GREPPABLE steps of the RISKS.md verification recipe inline (`Bash` tool):
   ```bash
   # Token-substitution check (must return 0 matches)
   grep -rn "<<[A-Z_]*>>" . --include="*.md"
   # Owner-binding check (must list every PROCESS.md)
   find . -name "PROCESS.md" -exec grep -l "^owner:" {} \;
   # New/modified files (informational)
   git status --short
   ```
   The **conversational steps** of the recipe (`List available subagents`, `List available skills`) are NOT run here — they require a fresh Claude Code session and are deferred to founder verification post-setup.

   Print a final summary: "Setup complete. Files written/modified: <list>. Next: run `/serve-console` to browse your new OS at http://127.0.0.1:8765/. Then ask Claude `List available subagents` in a fresh session to complete the framework smoke test. Commit when ready: `git add -A && git commit -m 'chore: initial company-setup'`."

8a2. **Seed each department's backlog (v0.12 — from empty to self-building).** For each kept/customized dept, ask ONE question: "What are the 1-3 jobs <dept> will do most often?" For each answer, file a `kind: process-gap` counted backlog item (`BACKLOG-ITEM.md.tmpl`) in `departments/<dept>/backlog/` with `occurrences: 1` and the job description as the Goal. These seeds are what the weekly sweep counts — the second time a job actually happens, a draft process proposal appears without anyone deciding to build it. "skip" is accepted per dept.

8b. **Activate the self-improvement loop (v0.10 — the step that makes the company autonomous).** Ask: "Your OS can update itself daily and review its own improvement signals weekly, unattended. Activate now? (yes/no — recommended yes)." On yes:
   - If the repo has a GitHub remote: run `/schedule-process auto-sync` and `/schedule-process review-history` (both declare `runtime: gha` by default — the durable path; the workflow files land in `.github/workflows/`, and the one manual prerequisite is `gh secret set ANTHROPIC_API_KEY`, which the registration reminds about).
   - No remote: register on `claude-schedule` with the session-scoped caveat printed, and offer the SessionStart re-arm hook.
   - Either way, print the **residual-duties card** — the complete list of what stays human: *review `[opos-*]` issues when they appear (conflicts, drafts needing review); skim `verification_state: unverified` run records weekly (the chief-of-staff greeting counts them for you); approve upstream-proposal drafts that failed redaction; grant credentials/tools when asked. Everything else runs itself.*
   On no: print the two commands to run later and note the OS is manual-update-only until then.

9. **Write history entry** to `.claude/skills/company-setup/history/YYYY-MM-DD-<short-run-id>.md`. Convention: `<short-run-id>` = `setup-<COMPANY_NAME_lowercased>` (e.g., `setup-zipread`). Include `time: HH:MM` (v0.3.1 schema). Body captures every answer, every file written/modified, every policy-name conflict refusal (with which check fired), and every dept decision (keep/customize) across all 6 default depts.

## Outputs

- Founder-populated root `CLAUDE.md` (Mission + Values).
- `company/strategy/priorities.md` (top 3-5 strategic priorities).
- 0-3 files under `company/policies/<slug>.md` (from POLICY.md.tmpl, comment header stripped).
- Optionally-modified `departments/{rnd,finance,people,legal,commercial,pr}/CLAUDE.md` (Mission sections per the 6-dept loop).
- A run entry in `.claude/skills/company-setup/history/`.
- A one-line summary in chat with next-step instructions.

## Failure modes

- **Already-populated repo** (step 1, history entry present) — ABORT: "Mission already set; restore the `<one short sentence>` placeholder in root CLAUDE.md to re-run." A Mission without the history entry is a PARTIAL run, not this case — step 1 resumes it instead.
- **No git repo** (step 1) — ABORT: "`/company-setup` requires a git repo. Run `git init && git add -A && git commit -m 'chore: initial OPOS scaffold'` first."
- **Mission empty / too long** (step 3) — re-ask same question.
- **Values count out of range** (step 4) — re-ask with "I need between 3 and 5 values, inclusive."
- **Policy name conflict** (step 8) — print which check fired (slug-regex / existing-file / framework-reserved exact-match) + the relevant rule. Ask for a different name. Do NOT auto-coerce.
- **User Ctrl-C mid-session** — partial progress persists (files written so far stay). The history entry (step 9) is NOT written if Ctrl-C fires before step 9 — which is exactly what lets step 1 recognize the partial run: simply re-invoke `/company-setup` and it resumes at the first incomplete step (resume-from-step-N).
- **Founder requests "remove" for a dept in step 6/7** — print: "Department removal is a manual operation post-setup, not handled by company-setup (removing a starter dept cascades into its `.claude/agents/<dept>/` folder, breaks the example dept-nested `deploy` skill, and may strand cross-agent delegation references). After setup completes, run `git rm -r departments/<dept>/ .claude/agents/<dept>/` manually with full awareness, then verify with `bash ui/smoke.sh`." Continue with "keep" as the default for this step.

## Related

- Process definition: `./PROCESS.md`
- Run history: `./history/`
- Policy template: [`shared/templates/POLICY.md.tmpl`](../../../shared/templates/POLICY.md.tmpl)
- Verification recipe (greppable subset): RISKS.md "Verification recipe" section
- Next step after setup: [`serve-console`](../serve-console/)
- Owner agent: [`.claude/agents/company/coo.md`](../../agents/company/coo.md)
