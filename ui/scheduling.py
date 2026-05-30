"""Frontmatter validator for scheduled-process fields in PROCESS.md files.

Sibling to `ui/validate.py` (which handles console URL params). This module
operates on disk-resident PROCESS.md frontmatter and returns `(ok, errors)`
tuples rather than raising — different shape, different concern.

The 4 scheduling fields are OPTIONAL collectively. A PROCESS.md without any
of them is a manual-only process — `validate_frontmatter` returns `(True, [])`.

If ANY of the 4 fields is present, ALL 4 must be present and valid per the
rules in `.claude/skills/schedule-process/SKILL.md`.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

import yaml

SCHEDULING_FIELDS = ("schedule", "runtime", "non_interactive", "authority")
ALLOWED_RUNTIMES = ("claude-schedule",)
ALLOWED_AUTHORITY = (
    "commit",
    "push",
    "open_pr",
    "file_issue",
    "comment_issue",
    "write_proposal",
    "read_only",
)

# 5-field POSIX cron: minute hour day-of-month month day-of-week.
# Each field permits: digit, range, comma-list, step, asterisk, asterisk-step.
# Permissive — not full cron grammar; meant to catch obvious malformation.
_CRON_FIELD = r"(\*|[0-9]+|\*/[0-9]+|[0-9]+-[0-9]+|[0-9]+(?:,[0-9]+)+|[0-9]+/[0-9]+)"
_CRON_RE = re.compile(
    rf"^{_CRON_FIELD}\s+{_CRON_FIELD}\s+{_CRON_FIELD}\s+{_CRON_FIELD}\s+{_CRON_FIELD}$"
)


def _parse_frontmatter(path: Path) -> dict[str, Any] | None:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---"):
        return None
    parts = text.split("---", 2)
    if len(parts) < 3:
        return None
    try:
        loaded = yaml.safe_load(parts[1])
    except yaml.YAMLError:
        return None
    return loaded if isinstance(loaded, dict) else {}


def validate_frontmatter(process_md_path: Path) -> tuple[bool, list[str]]:
    """Validate scheduling frontmatter in a PROCESS.md file.

    Returns `(ok, errors)`:

    - `(True, [])` when no scheduling fields are present (manual-only process —
      valid by definition) OR when all 4 fields are present and pass all rules.
    - `(False, [<messages>])` when any rule fails. The error list is the full
      set of failures from a single pass — the caller sees everything at once.
    """
    fm = _parse_frontmatter(process_md_path)
    if fm is None:
        return False, [f"could not parse frontmatter from {process_md_path}"]

    present = [f for f in SCHEDULING_FIELDS if f in fm]
    if not present:
        return True, []  # manual-only — valid

    errors: list[str] = []

    # Rule 1: all-or-nothing
    missing = [f for f in SCHEDULING_FIELDS if f not in fm]
    if missing:
        errors.append(
            f"all-or-nothing: scheduling field(s) {present} present but "
            f"required field(s) {missing} missing"
        )

    # Rule 2: schedule is a 5-field POSIX cron; reject `* * * * *`
    if "schedule" in fm:
        sched = fm["schedule"]
        if not isinstance(sched, str):
            errors.append(
                f"schedule: must be a string (POSIX 5-field cron); got {type(sched).__name__}"
            )
        else:
            sched_s = sched.strip()
            if not _CRON_RE.match(sched_s):
                errors.append(
                    f"schedule: {sched!r} is not a valid 5-field POSIX cron "
                    "(format: 'minute hour day-of-month month day-of-week')"
                )
            elif sched_s == "* * * * *":
                errors.append(
                    "schedule: every-minute cron '* * * * *' is rejected "
                    "(almost always a mistake; exceeds documented minimum cadence)"
                )

    # Rule 3: runtime ∈ ALLOWED_RUNTIMES
    if "runtime" in fm:
        rt = fm["runtime"]
        if rt not in ALLOWED_RUNTIMES:
            errors.append(
                f"runtime: {rt!r} not allowed; supported: {list(ALLOWED_RUNTIMES)}"
            )

    # Rule 4: non_interactive is the literal boolean True (not "true" string)
    if "non_interactive" in fm:
        ni = fm["non_interactive"]
        if ni is not True:
            errors.append(
                f"non_interactive: must be literal boolean true (no quotes); "
                f"got {ni!r} ({type(ni).__name__})"
            )

    # Rule 5: authority is non-empty list, elements in ALLOWED_AUTHORITY,
    #         read_only is mutually exclusive with all other values.
    if "authority" in fm:
        auth = fm["authority"]
        if not isinstance(auth, list) or not auth:
            errors.append(f"authority: must be a non-empty list; got {auth!r}")
        else:
            bad = [a for a in auth if a not in ALLOWED_AUTHORITY]
            if bad:
                errors.append(
                    f"authority: unknown value(s) {bad}; allowed: {list(ALLOWED_AUTHORITY)}"
                )
            if "read_only" in auth and len(auth) > 1:
                errors.append(
                    "authority: read_only is mutually exclusive with all other values; "
                    f"got {auth}"
                )

    return (len(errors) == 0, errors)
