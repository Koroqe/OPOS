# OPOS Console — read-only browser

A tiny local-host web UI over your OPOS company files. Read-only: write actions stay in Claude Code.

## Prereqs

- Python 3.10 or newer
- `jinja2` (already a Copier transitive dep; `pip install copier` brings it in)
- `markdown` (new optional dep)

Install the new dep:

```bash
pip install markdown
# or, if Copier is your only Python tool:
pipx inject copier markdown
```

## Run

From the repo root:

```bash
python3 ui/console.py
```

Default URL: `http://127.0.0.1:8765/`. The console auto-opens in your default browser; pass `--no-browser` to suppress that. Ctrl-C stops the server cleanly.

Or invoke the [`serve-console`](.claude/skills/serve-console/) skill from Claude Code, which also runs dependency checks first.

### Flags

```
--port INT       TCP port to bind (default: 8765)
--host HOST      bind address (default: 127.0.0.1 — loopback only)
--no-browser     do not auto-open the URL in a browser
```

**Warning:** `--host 0.0.0.0` exposes the console on your LAN. Anyone on the network can then read every markdown file in this repo, including restricted folders. See [RISKS.md](../RISKS.md) Risk 16.

## Routes

| Path | Page |
|------|------|
| `/` | Dashboard (counts + recent activity) |
| `/tasks` | Tasks list (CRM-style, with state/dept/owner filters) |
| `/tasks/<n>` | Task detail (TASK.md body + GitHub issue + comments) |
| `/agents` | Agents grouped by dept |
| `/agents/<dept>/<name>` | Agent detail (frontmatter, body, owned skills, called-by) |
| `/skills` | Skills grouped by owner agent |
| `/skills/<name>` | Skill detail (SKILL.md + PROCESS.md + recent runs) |
| `/departments` | Departments list |
| `/departments/<name>` | Department detail (charter + members + dept-scoped skills) |
| `/activity` | Activity feed (chronological history-entry stream) |

## What it reads

Everything in your repo, on every request — there is no cache (except a 30s in-process cache for `gh issue view` calls on `/tasks/<n>` to avoid hitting the GitHub API rate limit on accidental refreshes):

- `.claude/agents/**/*.md` — agents
- `.claude/skills/*/SKILL.md` + `.claude/skills/*/PROCESS.md` — skills
- `.claude/skills/*/history/[0-9]*.md` — activity feed
- `tasks/[0-9]*.md` + `tasks/closed/[0-9]*.md` — tasks
- `departments/*/CLAUDE.md` (or `.jinja` source) — department charters
- `company/CLAUDE.md[.jinja]` — synthetic "company" department charter
- `.claude/.paused-tasks` — paused-state inference
- `.copier-answers.yml` — your company name (rendered in the page title)

## What it does NOT do

- **Write anything.** No editing, no posting comments, no closing issues. Use Claude Code (`task-update`, `task-complete`, etc.) for those.
- **Authenticate.** Anyone who can reach the bind address can read everything. Default is loopback only.
- **Tail live Claude Code sessions.** Deferred to a future release.

## Dev notes

- Templates auto-reload on every request (Jinja `auto_reload=True`) — edit `ui/templates/*.jinja` and refresh the browser; no restart needed.
- Input validation lives in `ui/validate.py`. All URL path/query components flow through `safe_slug` / `safe_int` / `safe_date` / `safe_choice`. Invalid input → 400, never a 500 stacktrace.
- Per-resource handler modules under `ui/handlers/` each register their routes at import time via `install(pattern, handler)`. See `ui/handlers/__init__.py` for the dispatch model.
