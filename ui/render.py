"""Jinja2 + markdown rendering helpers for the console."""

from __future__ import annotations

from pathlib import Path

import jinja2
import markdown as md

from ui.data import REPO_ROOT, _company_name
from ui.repair_tasks import decide

TEMPLATES_DIR = Path(__file__).resolve().parent / "templates"

_env = jinja2.Environment(
    loader=jinja2.FileSystemLoader(str(TEMPLATES_DIR)),
    autoescape=jinja2.select_autoescape(["html", "jinja"]),
    auto_reload=True,  # re-read templates on each render — dev convenience
    trim_blocks=True,
    lstrip_blocks=True,
)


def md_to_html(text: str) -> str:
    if not text:
        return ""
    return md.markdown(text, extensions=["fenced_code", "tables", "toc", "sane_lists"])


_env.filters["md"] = md_to_html


def task_repair(task) -> tuple[str, list[str]]:
    """(advice, leftover) for a task page, from ONE `decide` call. The advice is "repair" or "hand" for a
    task with warnings, "" for one without; the verdict is exactly the repair command's own: `decide`
    reads the file's raw bytes from disk exactly as `--apply` does (line endings, symlinks and all), so the
    page and `--apply` always agree. The leftover is the page's warnings the repair will not clear (the
    page's own "issue_number is not a usable number"): the task's warnings that are not among the
    warnings `decide` says it clears, shown as a separate note, never by changing the advice. If `decide`
    fails for any reason the page still renders, with "hand"."""
    if not task.warnings:
        return "", []
    try:
        verdict, _, cleared = decide(task.path)
    except Exception:  # noqa: BLE001 (a page must render whatever happens to one file)
        return "hand", []
    if verdict != "repair":
        return "hand", []
    return "repair", [w for w in task.warnings if w not in cleared]


def task_advice(task) -> str:
    """"repair", "hand" or "" (see `task_repair`)."""
    return task_repair(task)[0]


def task_leftover(task) -> list[str]:
    """The warnings left after the repair, for a task whose advice is "repair" (see `task_repair`)."""
    return task_repair(task)[1]


_env.globals["task_repair"] = task_repair


def render(template_name: str, **context) -> str:
    context.setdefault("company_name", _company_name(REPO_ROOT))
    context.setdefault("repo_root", str(REPO_ROOT))
    context.setdefault("page_title", "")
    context.setdefault("auto_refresh", None)
    return _env.get_template(template_name).render(**context)
