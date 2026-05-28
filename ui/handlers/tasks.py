"""Tasks handlers — CRM-style list + detail with gh issue shellout (30s TTL)."""

from __future__ import annotations

import json
import re
import subprocess
import time

from ui.data import REPO_ROOT, parse_tasks
from ui.handlers import install
from ui.render import render
from ui.validate import BadRequest, safe_choice, safe_int, safe_slug

_GH_CACHE: dict[int, tuple[dict, float]] = {}
_GH_TTL = 30.0  # seconds

_TASK_TRACKING_CFG = REPO_ROOT / ".claude" / "task-tracking.config.json"
_REFS_RE = re.compile(r"(?:Refs|Ref|Closes|Fixes):\s*#(\d+)", re.IGNORECASE)


def _gh_repo() -> str | None:
    if not _TASK_TRACKING_CFG.is_file():
        return None
    try:
        data = json.loads(_TASK_TRACKING_CFG.read_text(encoding="utf-8"))
        repo = data.get("repo")
        return repo if isinstance(repo, str) and repo else None
    except (OSError, json.JSONDecodeError):
        return None


def _gh_issue_view(n: int) -> tuple[dict | None, str | None]:
    """Return (data, warning). warning is non-None on failure."""
    now = time.time()
    cached = _GH_CACHE.get(n)
    if cached and cached[1] > now:
        return (cached[0], None)
    repo = _gh_repo()
    if not repo:
        return (None, "task-tracking.config.json missing 'repo' field")
    try:
        proc = subprocess.run(
            ["gh", "issue", "view", str(n), "--repo", repo, "--json", "body,comments,labels,state,title"],
            capture_output=True,
            text=True,
            check=True,
            timeout=10,
        )
    except FileNotFoundError:
        return (None, "gh CLI not installed")
    except subprocess.TimeoutExpired:
        return (None, "gh issue view timed out (10s)")
    except subprocess.CalledProcessError as e:
        first = (e.stderr or "").strip().splitlines()
        msg = first[0] if first else f"exit {e.returncode}"
        return (None, msg)
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return (None, "gh returned non-JSON output")
    # Normalize labels to list of name strings.
    if isinstance(data.get("labels"), list):
        data["labels"] = [(lbl.get("name") if isinstance(lbl, dict) else str(lbl)) for lbl in data["labels"]]
    _GH_CACHE[n] = (data, now + _GH_TTL)
    return (data, None)


def route_tasks(request) -> tuple[int, str, str]:
    tasks = parse_tasks()
    all_tasks = list(tasks)

    filters = {"state": None, "dept": None, "owner": None}
    raw_state = request.query.get("state", "").strip()
    if raw_state:
        filters["state"] = safe_choice(raw_state, ("active", "paused", "completed", "dropped"))
        tasks = [t for t in tasks if t.state == filters["state"]]
    raw_dept = request.query.get("dept", "").strip()
    if raw_dept:
        filters["dept"] = safe_slug(raw_dept)
        tasks = [t for t in tasks if filters["dept"] in t.depts]
    raw_owner = request.query.get("owner", "").strip()
    if raw_owner:
        filters["owner"] = safe_slug(raw_owner)
        tasks = [t for t in tasks if t.owner == filters["owner"]]

    all_depts = sorted({d for t in all_tasks for d in t.depts})
    all_owners = sorted({t.owner for t in all_tasks if t.owner})

    body = render(
        "tasks.html",
        page_title="Tasks",
        tasks=tasks,
        total=len(all_tasks),
        filters=filters,
        all_depts=all_depts,
        all_owners=all_owners,
    )
    return (200, "text/html; charset=utf-8", body)


def route_task(request) -> tuple[int, str, str]:
    n = safe_int(request.path_params["n"])
    tasks = parse_tasks()
    match = next((t for t in tasks if t.issue_number == n), None)
    if not match:
        return (404, "text/html; charset=utf-8", f"<h1>404</h1><p>No task #{n}.</p>")
    gh_data, gh_warning = _gh_issue_view(n)
    refs_to: set[int] = set()
    if gh_data:
        for src in [gh_data.get("body", "")] + [c.get("body", "") for c in gh_data.get("comments", [])]:
            for m in _REFS_RE.finditer(src or ""):
                ref_n = int(m.group(1))
                if ref_n != n:
                    refs_to.add(ref_n)
    body = render(
        "task.html",
        page_title=f"#{n}",
        task=match,
        gh_data=gh_data,
        gh_warning=gh_warning,
        refs_to=sorted(refs_to),
    )
    return (200, "text/html; charset=utf-8", body)


install(r"^/tasks$", route_tasks)
install(r"^/tasks/(?P<n>[^/]+)$", route_task)
