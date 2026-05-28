---
process_name: serve-console
owner: chief-of-staff
collaborators: [eng-lead]
inputs: [port, host, open_browser]
success_criteria: [console_py_present, python_version_ok, deps_importable, server_announced, server_running]
slo: "5 seconds to startup; runtime is until user Ctrl-C"
version: 0.1.0
---

# serve-console

## Narrative

Launches the local-host read-only console UI shipped under `ui/`. The console reads markdown + JSON from the repo on every request and renders pages with Jinja2 + the `markdown` library. Long-running foreground process — successful runs are not logged to `history/` (only abnormal exits are, to keep the audit folder useful).

## Pre-conditions

- Python 3.10+ on PATH as `python3`.
- `jinja2` and `markdown` installed in the Python env (`jinja2` is a Copier transitive dep; `markdown` is the one new dep introduced in v0.3.0).
- `ui/console.py` and its sibling modules present (ships as CORE; arrives via `copier copy` or `copier update`).
- Port not already in use (default 8765).

## Steps

Mirrors the 6-step procedure in SKILL.md:

1. Resolve repo root.
2. Verify `ui/console.py` exists.
3. Verify Python ≥3.10.
4. Verify `jinja2` and `markdown` importable.
5. Print URL + (optionally) open browser.
6. Exec the server in the foreground.

## Done when

- `console_py_present` — step 2 passed.
- `python_version_ok` — step 3 passed.
- `deps_importable` — step 4 passed.
- `server_announced` — step 5 printed the URL.
- `server_running` — step 6 server bound and is serving requests (verified by Ctrl-C exiting cleanly).

## Rollback

Stop the server with Ctrl-C. No state is mutated by serving (read-only). If a port is leaked (rare — only if Ctrl-C is suppressed), find the PID with `lsof -nP -iTCP:<port> | grep LISTEN` and kill it.

## History

- Successful runs: NO history entry (long-running interactive command; per-invocation entries would clutter).
- Abnormal exits (port-in-use, dep-missing, traceback): write an entry capturing the exception class + message + duration before crash. This keeps the audit log focused on the events worth auditing.
