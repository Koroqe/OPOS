"""Input-validation helpers used by every console handler.

All helpers raise `BadRequest` on rejection; the HTTP dispatcher maps that
to a 400 response so malformed URLs never produce a 500 stacktrace.
"""

from __future__ import annotations

import re
from datetime import date, datetime


class BadRequest(Exception):
    """Raised when a path or query parameter fails validation."""


_SLUG_RE = re.compile(r"^[a-z][a-z0-9-]{0,63}$")


def safe_slug(value: str) -> str:
    if not isinstance(value, str) or not _SLUG_RE.match(value):
        raise BadRequest(f"invalid slug: {value!r}")
    return value


def safe_int(value: str, min_val: int = 1, max_val: int = 10_000_000) -> int:
    try:
        n = int(value)
    except (TypeError, ValueError):
        raise BadRequest(f"invalid int: {value!r}")
    if n < min_val or n > max_val:
        raise BadRequest(f"int out of range [{min_val}, {max_val}]: {n}")
    return n


def safe_date(value: str) -> date:
    if not isinstance(value, str) or not value:
        raise BadRequest("date required")
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError:
        raise BadRequest(f"invalid date (expected YYYY-MM-DD): {value!r}")


def safe_choice(value: str, allowed: tuple[str, ...]) -> str:
    if value not in allowed:
        raise BadRequest(f"invalid choice {value!r}; allowed: {allowed}")
    return value
