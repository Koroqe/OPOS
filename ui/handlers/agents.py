"""Agents + Departments handlers.

Owns four routes:
    /agents
    /agents/<dept>/<name>
    /departments
    /departments/<name>

Path traversal is defended at two layers: safe_slug regex on the URL
component, and Path.resolve() containment check before reading any file.
"""

from __future__ import annotations

import re
from pathlib import Path

from ui.data import REPO_ROOT, parse_agents, parse_departments, parse_skills
from ui.handlers import install
from ui.render import render
from ui.validate import BadRequest, safe_slug

_AGENTS_ROOT = (REPO_ROOT / ".claude" / "agents").resolve()
_CALLS_RE = re.compile(r"^Calls:\s*(.+)$", re.MULTILINE)


def _called_by(agent_name: str, all_agents) -> list:
    """Reverse lookup: which agents list `<agent_name>` in their Calls: line."""
    out = []
    for other in all_agents:
        if other.name == agent_name:
            continue
        for m in _CALLS_RE.finditer(other.body):
            tokens = re.split(r"[,\s]+", m.group(1).strip())
            if agent_name in tokens or f"`{agent_name}`" in tokens:
                out.append(other)
                break
    return out


def route_agents(request) -> tuple[int, str, str]:
    agents = parse_agents()
    by_dept: dict[str, list] = {}
    for a in agents:
        by_dept.setdefault(a.department or "(unscoped)", []).append(a)
    # Sort: company first, then alpha; agents inside dept alpha by name.
    def _dept_key(name: str) -> tuple[int, str]:
        return (0 if name == "company" else 1, name)
    depts_sorted = sorted(
        ((d, sorted(members, key=lambda a: a.name)) for d, members in by_dept.items()),
        key=lambda kv: _dept_key(kv[0]),
    )
    body = render(
        "agents.html",
        page_title="Agents",
        depts=depts_sorted,
        total=len(agents),
    )
    return (200, "text/html; charset=utf-8", body)


def route_agent(request) -> tuple[int, str, str]:
    dept = safe_slug(request.path_params["dept"])
    name = safe_slug(request.path_params["name"])
    all_agents = parse_agents()
    match = next((a for a in all_agents if a.department == dept and a.name == name), None)
    if not match:
        return (404, "text/html; charset=utf-8", f"<h1>404</h1><p>No agent {name!r} in dept {dept!r}.</p>")
    # Defense-in-depth: ensure the resolved path is under .claude/agents/.
    resolved = match.path.resolve()
    if _AGENTS_ROOT not in resolved.parents:
        raise BadRequest("path traversal blocked")
    body = render(
        "agent.html",
        page_title=name,
        agent=match,
        called_by=_called_by(name, all_agents),
    )
    return (200, "text/html; charset=utf-8", body)


def route_departments(request) -> tuple[int, str, str]:
    depts = parse_departments()
    body = render("departments.html", page_title="Departments", depts=depts)
    return (200, "text/html; charset=utf-8", body)


def route_department(request) -> tuple[int, str, str]:
    name = safe_slug(request.path_params["name"])
    depts = parse_departments()
    match = next((d for d in depts if d.name == name), None)
    if not match:
        return (404, "text/html; charset=utf-8", f"<h1>404</h1><p>No department {name!r}.</p>")
    members = set(match.member_agents)
    dept_skills = [s for s in parse_skills() if s.owner_agent in members]
    body = render(
        "department.html",
        page_title=name,
        dept=match,
        dept_skills=dept_skills,
    )
    return (200, "text/html; charset=utf-8", body)


install(r"^/agents$", route_agents)
install(r"^/agents/(?P<dept>[^/]+)/(?P<name>[^/]+)$", route_agent)
install(r"^/departments$", route_departments)
install(r"^/departments/(?P<name>[^/]+)$", route_department)
