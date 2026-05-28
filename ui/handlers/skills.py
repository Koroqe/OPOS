"""Skills handlers — list + detail."""

from __future__ import annotations

from ui.data import parse_history, parse_skills
from ui.handlers import install
from ui.render import render
from ui.validate import safe_slug


def route_skills(request) -> tuple[int, str, str]:
    skills = parse_skills()

    filters = {"owner": None, "tag": None}
    raw_owner = request.query.get("owner", "").strip()
    if raw_owner:
        filters["owner"] = safe_slug(raw_owner)
        skills = [s for s in skills if s.owner_agent == filters["owner"]]
    raw_tag = request.query.get("tag", "").strip()
    if raw_tag:
        filters["tag"] = safe_slug(raw_tag)
        skills = [s for s in skills if filters["tag"] in s.tags]

    all_skills = parse_skills()
    owners = sorted({s.owner_agent for s in all_skills if s.owner_agent})
    tag_set: set[str] = set()
    for s in all_skills:
        for t in s.tags:
            tag_set.add(t)
    tags = sorted(tag_set)

    by_owner: dict[str, list] = {}
    for s in skills:
        by_owner.setdefault(s.owner_agent, []).append(s)
    groups = sorted(
        ((owner, sorted(members, key=lambda x: x.name)) for owner, members in by_owner.items()),
        key=lambda kv: kv[0] or "",
    )

    body = render(
        "skills.html.jinja",
        page_title="Skills",
        groups=groups,
        total=len(skills),
        filters=filters,
        owners=owners,
        tags=tags,
    )
    return (200, "text/html; charset=utf-8", body)


def route_skill(request) -> tuple[int, str, str]:
    name = safe_slug(request.path_params["name"])
    skills = parse_skills()
    match = next((s for s in skills if s.name == name), None)
    if not match:
        return (404, "text/html; charset=utf-8", f"<h1>404</h1><p>No skill {name!r}.</p>")
    history = [e for e in parse_history() if e.skill == name][:10]
    body = render("skill.html.jinja", page_title=name, skill=match, history=history)
    return (200, "text/html; charset=utf-8", body)


install(r"^/skills$", route_skills)
install(r"^/skills/(?P<name>[^/]+)$", route_skill)
