---
name: serve-console
description: Start the OPOS Console — a local-host read-only web UI over the company OS files
version: 0.1.0
tags: [meta, framework, ui, console]
owner_agent: chief-of-staff
---

# serve-console

## When to use

When a human wants a CRM-style read-only view over the company OS — tasks, agents, skills, departments, history — without going through Claude Code or the `gh` CLI for each lookup. The console is a long-running foreground command; the user stops it with Ctrl-C.

## Inputs

- `port` — TCP port to bind. Default: `8765` (memorable; outside common-conflict ranges).
- `host` — bind address. Default: `127.0.0.1` (loopback only). Pass `0.0.0.0` to expose on the LAN — **WARNING:** anyone on your LAN can then read every markdown file in this repo, including restricted folders (`company/strategy/`). Only do this on a trusted network.
- `open_browser` — bool, default `true`. When true, auto-opens the URL in the default browser after the server starts.

## Steps

1. **Resolve repo root.** `REPO_ROOT=$(git rev-parse --show-toplevel)`.

2. **Verify `ui/console.py` exists.** If absent, ABORT with: "ui/console.py not found — run `copier update` to pull v0.3.0+ files, or scaffold a fresh consumer with `copier copy gh:Koroqe/OPOS`."

3. **Verify Python ≥3.10.** `python3 --version` parsed as `Python 3.X.Y`; abort if X<3 or (X==3 and Y<10) with the install hint for your platform.

4. **Verify dependencies importable.** `python3 -c "import jinja2, markdown"`. If `markdown` is missing, ABORT with: "`markdown` library required: `pip install markdown` (or `pipx inject copier markdown` if Copier is your only Python tool)." Do NOT auto-install — touching the user's Python env is a Rule 4 architectural decision per `.claude/rules/error-recovery.md`.

5. **Announce + open browser.** Print: `OPOS Console serving at http://<host>:<port>/  (Ctrl-C to stop)`. If `open_browser=true`, run `python3 -m webbrowser "http://<host>:<port>/"` (non-blocking; failure to open the browser is non-fatal).

6. **Exec the server.** `python3 ui/console.py --port <port> --host <host>` (add `--no-browser` if `open_browser=false`). Foreground process; KeyboardInterrupt (Ctrl-C) shuts it down cleanly.

## Outputs

- A running HTTP server until Ctrl-C.
- One-line stdout on startup with the URL.
- A history entry **only on abnormal exit** (port-conflict, dependency-missing, traceback) — successful long-running invocations would clutter the folder otherwise.

## Failure modes

- **`ui/console.py` missing** — step 2 fail. Recovery: `copier update`.
- **Python too old** — step 3 fail. Recovery: install Python 3.10+; macOS users `brew install python@3.12`.
- **`markdown` missing** — step 4 fail. Recovery per the printed hint. `jinja2` is a Copier transitive dep so will almost always be present.
- **Port in use** — step 6 fail with `OSError: [Errno 48] Address already in use`. Recovery: pick another port via `--port`. Common conflicts: 8000 (Python `http.server`), 8080 (proxies), 3000 (Node dev servers).
- **`--host 0.0.0.0` chosen** — not a failure, but emit a one-line LAN-exposure warning to stdout before exec.

## Related

- Process definition: `./PROCESS.md`
- Run history: `./history/` (only abnormal exits recorded)
- UI entry point: `ui/console.py`
- UI README: `ui/README.md`
- Risk note: `RISKS.md` Risk 16 (localhost binding rationale + restricted-folder caveat).
