"""Jinja2 + markdown rendering helpers for the console."""

from __future__ import annotations

from pathlib import Path

import jinja2
import markdown as md

from ui.data import REPO_ROOT, _company_name

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


def render(template_name: str, **context) -> str:
    context.setdefault("company_name", _company_name(REPO_ROOT))
    context.setdefault("repo_root", str(REPO_ROOT))
    context.setdefault("page_title", "")
    context.setdefault("auto_refresh", None)
    return _env.get_template(template_name).render(**context)
