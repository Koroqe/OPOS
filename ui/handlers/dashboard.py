from __future__ import annotations

from ui.data import parse_agents, parse_departments, parse_history, parse_skills, parse_tasks
from ui.handlers import install
from ui.render import render


def route_dashboard(request) -> tuple[int, str, str]:
    tasks = parse_tasks()
    counts = {
        "tasks_active": sum(1 for t in tasks if t.state == "active"),
        "tasks_paused": sum(1 for t in tasks if t.state == "paused"),
        "tasks_completed": sum(1 for t in tasks if t.state == "completed"),
        "agents": len(parse_agents()),
        "skills": len(parse_skills()),
        "departments": len(parse_departments()),
    }
    recent_activity = parse_history()[:5]
    body = render(
        "dashboard.html.jinja",
        page_title="Dashboard",
        counts=counts,
        recent_activity=recent_activity,
    )
    return (200, "text/html; charset=utf-8", body)


install(r"^/$", route_dashboard)
