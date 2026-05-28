"""Filesystem readers for the OPOS console.

Each `parse_*` returns plain dataclasses derived from markdown files in the
repo. No caching beyond the request scope — a small framework reads in <100ms
without it; optimize when measured.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

import yaml

# Repo root: the parent of the `ui/` directory that holds this file.
REPO_ROOT = Path(__file__).resolve().parent.parent


# ---------- dataclasses ----------


@dataclass
class Agent:
    name: str
    description: str
    department: str
    tools: list[str]
    owns_processes: list[str]
    body: str
    path: Path


@dataclass
class Skill:
    name: str
    description: str
    owner_agent: str
    tags: list[str]
    version: str
    skill_body: str
    process_owner: str
    process_body: str
    history_count: int
    path: Path  # SKILL.md path
    dept: str = ""  # empty for root-level skills; dept name for departments/<dept>/.claude/skills/<name>/


@dataclass
class Task:
    issue_number: int
    title: str
    owner: str
    depts: list[str]
    state: str  # active | paused | completed | dropped
    created: str
    completed: str
    success_criteria: list[str]
    related_skills: list[str]
    body: str
    path: Path


@dataclass
class HistoryEntry:
    date: str  # YYYY-MM-DD string (sortable as-is)
    run_id: str
    skill: str
    actor: str
    outcome: str
    duration_min: int | None
    proposed_delta: str
    status: str
    body: str
    path: Path


@dataclass
class Department:
    name: str
    charter_body: str
    member_agents: list[str] = field(default_factory=list)
    path: Path | None = None


# ---------- frontmatter ----------


_FRONT_FENCE = "---\n"


def parse_frontmatter(path: Path) -> tuple[dict[str, Any], str]:
    """Return (frontmatter_dict, body_str). Empty dict if no fence or unparseable."""
    try:
        text = path.read_text(encoding="utf-8")
    except OSError:
        return {}, ""
    if not text.startswith(_FRONT_FENCE):
        return {}, text
    # Find closing fence.
    end = text.find(_FRONT_FENCE, len(_FRONT_FENCE))
    if end == -1:
        return {}, text
    yaml_block = text[len(_FRONT_FENCE) : end]
    body = text[end + len(_FRONT_FENCE) :]
    try:
        data = yaml.safe_load(yaml_block) or {}
        if not isinstance(data, dict):
            return {}, body
    except yaml.YAMLError:
        return {}, body
    return data, body


# ---------- entity parsers ----------


def parse_agents(repo_root: Path = REPO_ROOT) -> list[Agent]:
    out: list[Agent] = []
    agents_dir = repo_root / ".claude" / "agents"
    if not agents_dir.is_dir():
        return out
    for md in sorted(agents_dir.glob("**/*.md")):
        fm, body = parse_frontmatter(md)
        if not fm.get("name"):
            continue
        out.append(
            Agent(
                name=str(fm.get("name", "")),
                description=str(fm.get("description", "")),
                department=str(fm.get("department", "")),
                tools=list(fm.get("tools") or []),
                owns_processes=list(fm.get("owns_processes") or []),
                body=body,
                path=md,
            )
        )
    return out


def _read_skill_dir(skill_dir: Path, dept: str) -> Skill | None:
    skill_md = skill_dir / "SKILL.md"
    if not skill_md.is_file():
        return None
    skill_fm, skill_body = parse_frontmatter(skill_md)
    process_md = skill_dir / "PROCESS.md"
    if process_md.is_file():
        process_fm, process_body = parse_frontmatter(process_md)
    else:
        process_fm, process_body = {}, ""
    history_dir = skill_dir / "history"
    history_count = sum(1 for _ in history_dir.glob("[0-9]*.md")) if history_dir.is_dir() else 0
    return Skill(
        name=str(skill_fm.get("name", skill_dir.name)),
        description=str(skill_fm.get("description", "")),
        owner_agent=str(skill_fm.get("owner_agent", "")),
        tags=list(skill_fm.get("tags") or []),
        version=str(skill_fm.get("version", "")),
        skill_body=skill_body,
        process_owner=str(process_fm.get("owner", "")),
        process_body=process_body,
        history_count=history_count,
        path=skill_md,
        dept=dept,
    )


def parse_skills(repo_root: Path = REPO_ROOT) -> list[Skill]:
    """Returns root-level (.claude/skills/*) plus dept-nested
    (departments/<dept>/.claude/skills/*) skills.

    Root-level skills are returned first; dept-nested next. On name
    collisions between scopes the root-level entry wins (first match),
    matching the cascade convention where outer scope takes precedence.
    """
    out: list[Skill] = []
    seen: set[str] = set()

    # Root-level skills.
    root_dir = repo_root / ".claude" / "skills"
    if root_dir.is_dir():
        for skill_dir in sorted(p for p in root_dir.iterdir() if p.is_dir()):
            s = _read_skill_dir(skill_dir, dept="")
            if s is not None and s.name not in seen:
                out.append(s)
                seen.add(s.name)

    # Dept-nested skills.
    departments_dir = repo_root / "departments"
    if departments_dir.is_dir():
        for dept_dir in sorted(p for p in departments_dir.iterdir() if p.is_dir()):
            nested_dir = dept_dir / ".claude" / "skills"
            if not nested_dir.is_dir():
                continue
            for skill_dir in sorted(p for p in nested_dir.iterdir() if p.is_dir()):
                s = _read_skill_dir(skill_dir, dept=dept_dir.name)
                if s is not None and s.name not in seen:
                    out.append(s)
                    seen.add(s.name)
    return out


def paused_task_numbers(repo_root: Path = REPO_ROOT) -> set[int]:
    f = repo_root / ".claude" / ".paused-tasks"
    if not f.is_file():
        return set()
    out: set[int] = set()
    for line in f.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.isdigit():
            out.add(int(line))
    return out


def _parse_task_file(md: Path, state_from_location: str, paused: set[int]) -> Task | None:
    fm, body = parse_frontmatter(md)
    try:
        n = int(fm.get("issue_number") or md.stem)
    except (TypeError, ValueError):
        return None
    # Location wins over frontmatter; paused membership overrides 'active'.
    state = state_from_location
    if state == "active" and n in paused:
        state = "paused"
    return Task(
        issue_number=n,
        title=str(fm.get("title", "")),
        owner=str(fm.get("owner", "")),
        depts=list(fm.get("depts") or []),
        state=state,
        created=str(fm.get("created", "")),
        completed=str(fm.get("completed", "")),
        success_criteria=list(fm.get("success_criteria") or []),
        related_skills=list(fm.get("related_skills") or []),
        body=body,
        path=md,
    )


def parse_tasks(repo_root: Path = REPO_ROOT) -> list[Task]:
    out: list[Task] = []
    paused = paused_task_numbers(repo_root)
    active_dir = repo_root / "tasks"
    closed_dir = active_dir / "closed"
    if active_dir.is_dir():
        for md in sorted(active_dir.glob("[0-9]*.md")):
            t = _parse_task_file(md, "active", paused)
            if t is not None:
                out.append(t)
    if closed_dir.is_dir():
        for md in sorted(closed_dir.glob("[0-9]*.md")):
            t = _parse_task_file(md, "completed", paused)
            if t is not None:
                out.append(t)
    return out


_HISTORY_FILE_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})-.+\.md$")


def parse_history(repo_root: Path = REPO_ROOT) -> list[HistoryEntry]:
    out: list[HistoryEntry] = []
    skills_dir = repo_root / ".claude" / "skills"
    if not skills_dir.is_dir():
        return out
    for skill_dir in skills_dir.iterdir():
        history_dir = skill_dir / "history"
        if not history_dir.is_dir():
            continue
        for md in history_dir.iterdir():
            if not md.is_file() or not _HISTORY_FILE_RE.match(md.name):
                continue
            fm, body = parse_frontmatter(md)
            d = str(fm.get("date", ""))
            if not d:
                continue
            dur = fm.get("duration_min")
            try:
                dur_int = int(dur) if dur is not None else None
            except (TypeError, ValueError):
                dur_int = None
            out.append(
                HistoryEntry(
                    date=d,
                    run_id=str(fm.get("run_id", "")),
                    skill=str(fm.get("skill", skill_dir.name)),
                    actor=str(fm.get("actor", "")),
                    outcome=str(fm.get("outcome", "")),
                    duration_min=dur_int,
                    proposed_delta=str(fm.get("proposed_delta", "")),
                    status=str(fm.get("status", "")),
                    body=body,
                    path=md,
                )
            )
    out.sort(key=lambda e: (e.date, e.run_id), reverse=True)
    return out


def _company_name(repo_root: Path) -> str:
    answers = repo_root / ".copier-answers.yml"
    if answers.is_file():
        try:
            data = yaml.safe_load(answers.read_text(encoding="utf-8")) or {}
            v = data.get("COMPANY_NAME")
            if isinstance(v, str) and v:
                return v
        except yaml.YAMLError:
            pass
    return "OPOS"


def parse_departments(repo_root: Path = REPO_ROOT) -> list[Department]:
    out: list[Department] = []
    agents = parse_agents(repo_root)
    dept_to_members: dict[str, list[str]] = {}
    for a in agents:
        dept_to_members.setdefault(a.department, []).append(a.name)

    # Synthetic `company` department: charter from company/CLAUDE.md[.jinja].
    company_md = repo_root / "company" / "CLAUDE.md"
    company_jinja = repo_root / "company" / "CLAUDE.md.jinja"
    if company_md.is_file():
        charter = company_md.read_text(encoding="utf-8")
        path: Path | None = company_md
    elif company_jinja.is_file():
        raw = company_jinja.read_text(encoding="utf-8")
        charter = raw.replace("{{ COMPANY_NAME }}", _company_name(repo_root))
        path = company_jinja
    else:
        charter = ""
        path = None
    out.append(
        Department(
            name="company",
            charter_body=charter,
            member_agents=sorted(dept_to_members.get("company", [])),
            path=path,
        )
    )

    # Dept-scoped charters under departments/*/CLAUDE.md or .jinja source.
    departments_dir = repo_root / "departments"
    company_name = _company_name(repo_root)
    if departments_dir.is_dir():
        for dept_dir in sorted(p for p in departments_dir.iterdir() if p.is_dir()):
            charter_md = dept_dir / "CLAUDE.md"
            charter_jinja = dept_dir / "CLAUDE.md.jinja"
            if charter_md.is_file():
                charter = charter_md.read_text(encoding="utf-8")
                path = charter_md
            elif charter_jinja.is_file():
                charter = charter_jinja.read_text(encoding="utf-8").replace(
                    "{{ COMPANY_NAME }}", company_name
                )
                path = charter_jinja
            else:
                continue
            out.append(
                Department(
                    name=dept_dir.name,
                    charter_body=charter,
                    member_agents=sorted(dept_to_members.get(dept_dir.name, [])),
                    path=path,
                )
            )
    return out
