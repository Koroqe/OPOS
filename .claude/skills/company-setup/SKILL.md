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

Re-running on a populated repo is REFUSED (step 1 abort). To re-do from scratch: manually restore the `<one short sentence>` placeholder in root `CLAUDE.md`'s Mission section.

## Inputs

None. All data is gathered conversationally.

## Path convention

The skill runs on the **consumer's repo AFTER `copier copy`**, where `.jinja` suffixes have already been stripped. All paths below are the rendered `.md` paths (e.g., `CLAUDE.md`, `departments/engineering/CLAUDE.md` — NOT `.jinja` sources).

## Steps

1. **Verify we are running on a fresh scaffold + git-initialized.**
   - Read root `CLAUDE.md`. If the Mission section does NOT contain the unique literal token `<one short sentence>`, ABORT with: "Mission already set — appears to be a populated repo. Re-running company-setup would overwrite. If you want to re-do, manually restore the placeholder `<one short sentence>` token in the Mission section first." (The token is narrow on purpose; `exists to` alone would falsely trigger on legitimate missions like "...whose purpose exists to...".)
   - Verify `.git/` exists. If not, ABORT with: "`/company-setup` requires a git repo. Run `git init && git add -A && git commit -m 'chore: initial OPOS scaffold'` first."

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

6. **Engineering dept decision (1 question).** Ask: "The starter `engineering` department mission is: `Ship reliable software. Keep production healthy. Improve the system every week.` Type **keep** or **customize**." Two sub-paths:
   - **keep:** no edit; print "engineering kept as-is."
   - **customize:** ask "Provide a new 1-3 sentence mission for engineering:" → use `Edit` to rewrite the Mission line(s) in `departments/engineering/CLAUDE.md` (rendered path).

   **"remove" is NOT supported in v0.5.0.** If the founder types "remove" or similar, print the dept-removal guidance from Failure modes and continue with "keep" by default. Removal is a manual post-setup operation.

7. **R&D dept decision (1 question).** Same two sub-paths as step 6 (**keep** or **customize**) for `departments/rnd/CLAUDE.md`. Starter mission: `Reduce uncertainty about external state. R&D produces written, citable artifacts that other departments can act on.`

8. **Initial policies (1 question per policy, 0-3 total).** Ask: "Do you want to seed any company-level policies right now? (yes/no) — if yes, I'll ask for up to 3." For each requested policy:
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

9. **Smoke check (greppable subset only).** Run only the GREPPABLE steps of the RISKS.md verification recipe inline (`Bash` tool):
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

10. **Write history entry** to `.claude/skills/company-setup/history/YYYY-MM-DD-<short-run-id>.md`. Convention: `<short-run-id>` = `setup-<COMPANY_NAME_lowercased>` (e.g., `setup-zipread`). Include `time: HH:MM` (v0.3.1 schema). Body captures every answer, every file written/modified, every policy-name conflict refusal (with which check fired), and every dept decision (keep/customize).

## Outputs

- Founder-populated root `CLAUDE.md` (Mission + Values).
- `company/strategy/priorities.md` (top 3-5 strategic priorities).
- 0-3 files under `company/policies/<slug>.md` (from POLICY.md.tmpl, comment header stripped).
- Optionally-modified `departments/engineering/CLAUDE.md` and `departments/rnd/CLAUDE.md` (Mission sections).
- A run entry in `.claude/skills/company-setup/history/`.
- A one-line summary in chat with next-step instructions.

## Failure modes

- **Already-populated repo** (step 1) — ABORT: "Mission already set; restore the `<one short sentence>` placeholder in root CLAUDE.md to re-run."
- **No git repo** (step 1) — ABORT: "`/company-setup` requires a git repo. Run `git init && git add -A && git commit -m 'chore: initial OPOS scaffold'` first."
- **Mission empty / too long** (step 3) — re-ask same question.
- **Values count out of range** (step 4) — re-ask with "I need between 3 and 5 values, inclusive."
- **Policy name conflict** (step 8) — print which check fired (slug-regex / existing-file / framework-reserved exact-match) + the relevant rule. Ask for a different name. Do NOT auto-coerce.
- **User Ctrl-C mid-session** — partial progress persists (files written so far stay). The history entry (step 10) is NOT written if Ctrl-C fires before step 10; the founder should re-run after restoring placeholders. There is NO automatic resume-from-step-N in v0.5.0 (documented as a v0.5.1 candidate).
- **Founder requests "remove" for a dept in step 6/7** — print: "Department removal is a manual operation post-setup, not handled by company-setup (removing a starter dept cascades into its `.claude/agents/<dept>/` folder, breaks the example dept-nested `deploy` skill, and may strand cross-agent delegation references). After setup completes, run `git rm -r departments/<dept>/ .claude/agents/<dept>/` manually with full awareness, then verify with `bash ui/smoke.sh`." Continue with "keep" as the default for this step.

## Related

- Process definition: `./PROCESS.md`
- Run history: `./history/`
- Policy template: [`shared/templates/POLICY.md.tmpl`](../../../shared/templates/POLICY.md.tmpl)
- Verification recipe (greppable subset): RISKS.md "Verification recipe" section
- Next step after setup: [`serve-console`](../serve-console/)
- Owner agent: [`.claude/agents/company/coo.md`](../../agents/company/coo.md)
