"""Route registry for the OPOS console.

Each per-resource module under `ui.handlers.*` exports route callables and
calls `install(pattern, handler)` at import time to register them. This
package assembles a master `ROUTES` list consumed by the dispatcher in
`ui.console`.

Wave-2 slices each own a distinct module and uncomment exactly one
registration line below — disjoint, contiguous edits.
"""

from __future__ import annotations

from ui.render import render
from ui.validate import safe_int, safe_slug


def _stub_handler(request) -> tuple[int, str, str]:
    """Placeholder until a Wave-2 slice replaces this route's mapping.

    Validates path params via the same helpers real handlers will use, so
    path-traversal and bad-int URLs return 400 even at Slice 2 stage.
    """
    pp = request.path_params
    if "n" in pp:
        safe_int(pp["n"])
    if "dept" in pp:
        safe_slug(pp["dept"])
    if "name" in pp:
        safe_slug(pp["name"])
    body = render(
        "base.html.jinja",
        page_title="Stub",
        # Inline content block via a tiny ad-hoc template extension:
        # base.html.jinja's {% block content %} default renders nothing,
        # so we wrap a minimal stub HTML through the base by using a
        # one-off inline render.
    )
    # The base template's content block is empty by default — embed the stub
    # marker directly so the smoke test can detect it.
    stub_html = f"<h1>Stub: {request.path}</h1>"
    body = body.replace("<main>\n", f"<main>\n{stub_html}\n", 1)
    return (200, "text/html; charset=utf-8", body)


# Routes are tried in order; first regex match wins. Each route maps the URL
# path (not query string) to a callable taking a Request object and returning
# (status_int, content_type, body_str).
ROUTES: list[tuple[str, object]] = [
    (r"^/$", _stub_handler),
    (r"^/tasks$", _stub_handler),
    (r"^/tasks/(?P<n>[^/]+)$", _stub_handler),
    (r"^/agents$", _stub_handler),
    (r"^/agents/(?P<dept>[^/]+)/(?P<name>[^/]+)$", _stub_handler),
    (r"^/skills$", _stub_handler),
    (r"^/skills/(?P<name>[^/]+)$", _stub_handler),
    (r"^/departments$", _stub_handler),
    (r"^/departments/(?P<name>[^/]+)$", _stub_handler),
    (r"^/activity$", _stub_handler),
]


def install(path_pattern: str, handler) -> None:
    """Replace a route's handler. Called by Wave-2 slice modules at import time."""
    for i, (pattern, _) in enumerate(ROUTES):
        if pattern == path_pattern:
            ROUTES[i] = (pattern, handler)
            return
    ROUTES.append((path_pattern, handler))


# --- Wave-2 slice registrations (each slice uncomments its own line) ---
# Slice 3 (dashboard + activity):
# from . import dashboard as _dashboard, activity as _activity  # noqa: F401
# Slice 4 (agents + departments):
# from . import agents as _agents  # noqa: F401
# Slice 5 (skills + tasks):
# from . import skills as _skills, tasks as _tasks  # noqa: F401
