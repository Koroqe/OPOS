from __future__ import annotations

from ui.data import parse_history, parse_skills
from ui.handlers import install
from ui.render import render
from ui.validate import safe_choice, safe_date, safe_slug

_PAGE_SIZE = 50


def route_activity(request) -> tuple[int, str, str]:
    entries = parse_history()
    total = len(entries)

    filters = {"skill": None, "outcome": None, "since": None}

    raw_skill = request.query.get("skill", "").strip()
    if raw_skill:
        filters["skill"] = safe_slug(raw_skill)
        entries = [e for e in entries if e.skill == filters["skill"]]

    raw_outcome = request.query.get("outcome", "").strip()
    if raw_outcome:
        filters["outcome"] = safe_choice(raw_outcome, ("success", "partial", "failure"))
        entries = [e for e in entries if e.outcome == filters["outcome"]]

    raw_since = request.query.get("since", "").strip()
    if raw_since:
        since = safe_date(raw_since)
        filters["since"] = since.isoformat()
        entries = [e for e in entries if e.date >= filters["since"]]

    entries = entries[:_PAGE_SIZE]
    all_skills = sorted({s.name for s in parse_skills()})

    body = render(
        "activity.html.jinja",
        page_title="Activity",
        entries=entries,
        total=total,
        filters=filters,
        all_skills=all_skills,
    )
    return (200, "text/html; charset=utf-8", body)


install(r"^/activity$", route_activity)
