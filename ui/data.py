"""Filesystem readers for the OPOS console.

Each `parse_*` returns plain dataclasses derived from markdown files in the
repo. No caching beyond the request scope — a small framework reads in <100ms
without it; optimize when measured.
"""

from __future__ import annotations

import os
import re
import stat
from copy import deepcopy
from dataclasses import dataclass, field
from datetime import date
from functools import lru_cache
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
    warnings: list[str]  # frontmatter problems the reader recovered from; empty when well-formed
    body: str
    path: Path


@dataclass
class HistoryEntry:
    date: str  # YYYY-MM-DD string (sortable as-is)
    time: str  # HH:MM string (optional; empty if missing). Sort key after date.
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


_KEY_LINE_RE = re.compile(r"^([A-Za-z_][A-Za-z0-9_]*):(.*)$")
_COMMENT_BLOCK_RE = re.compile(r"<!--.*?-->", re.DOTALL)
# The comment the old TASK.md.tmpl opened with (git history of shared/templates/TASK.md.tmpl). A file written
# from that template carries it before the opening fence, with each <<TOKEN>> either left as it is or replaced by
# one line of text, so each token matches the rest of one line. This comment, blank space and a BOM are the only
# text the repair removes before the fence.
_OLD_TEMPLATE_COMMENT = (
    '<!--\n'
    'TEMPLATE: substitute the tokens listed below.\n'
    '\n'
    'Substitution tokens:\n'
    '  <<ISSUE_NUMBER>>      — GitHub issue number (e.g. "5")\n'
    '  <<TITLE>>             — issue title (matches the GitHub issue title)\n'
    '  <<OWNER_AGENT>>       — agent name owning this task (e.g. "chief-of-staff")\n'
    '  <<DEPARTMENTS>>       — comma-separated dept list (e.g. "engineering, company")\n'
    '  <<STATE>>             — one of: active | paused | completed | dropped\n'
    '  <<CREATED_DATE>>      — ISO date task was opened (YYYY-MM-DD)\n'
    '  <<COMPLETED_DATE>>    — ISO date task was closed, or blank if still active\n'
    '  <<SUCCESS_CRITERIA>>  — bulleted list of acceptance criteria (parsed from issue body if structured)\n'
    '  <<DEADLINE>>          — optional ISO date, or blank\n'
    '  <<RELATED_SKILLS>>    — bracketed list of skill names this task exercises (e.g. "[design-process, task-register]")\n'
    '-->'
)
# One regex per line of that comment: the line's fixed text, with each <<TOKEN>> as a captured slot that matches
# the rest of one line. A slot is accepted only when it holds the literal token, nothing, or words that appear, in order,
# on one line of the file after the opening fence (see `_template_problem`).
_TOKEN_RE = re.compile(r"<<[A-Z_]+>>")
_TEMPLATE_LINES = _OLD_TEMPLATE_COMMENT.split("\n")
_TEMPLATE_LINE_RES = tuple(
    re.compile("([^\\n]*)".join(re.escape(part) for part in _TOKEN_RE.split(line)))
    for line in _TEMPLATE_LINES
)
_TEMPLATE_LINE_TOKENS = tuple(tuple(_TOKEN_RE.findall(line)) for line in _TEMPLATE_LINES)
_WORD_RE = re.compile(r"[^\s,\[\]{}()\"'`:;]+")


def _quote_line(line: str) -> str:
    line = " ".join(line.split())
    return (line[:80] + " ...") if len(line) > 80 else (line or "(blank line)")


def _template_problem(comment: str, later_lines: _LaterLines) -> str | None:
    """None when `comment` is the old template comment with each slot holding its token, nothing, or only words
    that appear, in order, on one line of the file from the opening fence on (`later_lines`: each line's words).
    Otherwise the first line that differs, for the refusal message."""
    if not comment.startswith(_OLD_TEMPLATE_COMMENT[:_OLD_TEMPLATE_COMMENT.index("\n", 6)]):
        return _foreign_words(comment)
    lines = comment.split("\n")
    # The comment ends at its first "-->", and the template's last line is "-->", so a comment that matches every
    # line has exactly the template's lines: a truncated or a longer one fails to match at some line.
    for i, line in enumerate(lines):
        m = _TEMPLATE_LINE_RES[i].fullmatch(line) if i < len(_TEMPLATE_LINE_RES) else None
        if m is None:
            return _quote_line(line)
        for token, slot in zip(_TEMPLATE_LINE_TOKENS[i], m.groups()):
            slot = slot.strip()
            if slot and slot != token and not later_lines.in_one_line(_WORD_RE.findall(slot)):
                return _quote_line(line)
    return None


class _LaterLines:
    """The text from the opening fence on. `in_one_line(words)`: the words appear, in order, on one line of it.
    Only the lines that contain the first word are tokenized, each once, and an answer is kept per word tuple,
    so a big file costs a few passes however many slots ask."""

    def __init__(self, text: str) -> None:
        self._text = text
        self._line_words: dict[int, tuple[str, ...]] = {}
        self._answers: dict[tuple[str, ...], bool] = {}

    def in_one_line(self, words: list[str]) -> bool:
        key = tuple(words)
        if key not in self._answers:
            self._answers[key] = self._search(key)
        return self._answers[key]

    def _search(self, words: tuple[str, ...]) -> bool:
        if not words:
            return True
        text, first = self._text, words[0]
        at = text.find(first)
        while at != -1:
            start = text.rfind("\n", 0, at) + 1
            if start not in self._line_words:
                end = text.find("\n", at)
                self._line_words[start] = tuple(_WORD_RE.findall(text[start:] if end == -1 else text[start:end]))
            it = iter(self._line_words[start])
            if all(w in it for w in words):
                return True
            end = text.find("\n", at)
            if end == -1:
                return False
            at = text.find(first, end)
        return False


def _foreign_words(comment: str) -> str:
    inner = comment[4:-3].split()
    if not inner:
        return "(empty comment)"
    return " ".join(inner[:8]) + (" ..." if len(inner) > 8 else "")


_COMMENT_START_RE = re.compile(r"[ \t]#")

# Every key a task file may carry; the repair uses the same list to check that it never adds or loses one.
_TASK_KEYS = (
    "issue_number", "title", "owner", "depts", "state", "created", "completed",
    "success_criteria", "deadline", "related_skills",
)
_TASK_KEY_PREFIX_RE = re.compile(r"^(" + "|".join(_TASK_KEYS) + r"):")
# YAML ends a line at these as well as at "\n"; the reader splits on "\n" only.
_YAML_BREAKS = "\x85\u2028\u2029"

# Only these keys are lists; every other key is a scalar.
_LIST_KEYS = frozenset({"depts", "success_criteria", "related_skills"})
# Keys whose value must come back as a string (or be blank).
_STR_KEYS = frozenset({"title", "owner", "state", "created", "completed", "deadline"})
# Free-text keys, where " #" in an unquoted value is a comment that cut the text short.
_FREE_TEXT_KEYS = frozenset({"title", "success_criteria", "related_skills"})


class _TaskLoader(yaml.SafeLoader):
    """SafeLoader that leaves dates as text, so an invalid date cannot raise."""


_TaskLoader.yaml_implicit_resolvers = {
    k: [(tag, rx) for tag, rx in v if tag != "tag:yaml.org,2002:timestamp"]
    for k, v in yaml.SafeLoader.yaml_implicit_resolvers.items()
}


class _Untrusted(Exception):
    """The node marks of a frontmatter block cannot be used to find a key's lines."""


def _last_node_end(node: "yaml.Node", seen: "set[int] | None" = None) -> "yaml.Mark":
    """End mark of the last scalar, or of the last flow collection, inside `node`. A node reached
    a second time (an alias, possibly of an ancestor) is not entered again."""
    seen = set() if seen is None else seen
    if id(node) in seen or isinstance(node, yaml.ScalarNode) or getattr(node, "flow_style", False) or not node.value:
        return node.end_mark
    seen.add(id(node))
    kids = node.value if isinstance(node, yaml.SequenceNode) else [n for pair in node.value for n in pair]
    ends = [_last_node_end(k, seen) for k in kids]
    return max(ends, key=lambda m: m.index)


def _yaml_spans(block: list[str]) -> dict[str, tuple[int, int]]:
    """For a frontmatter block that parses strictly: top-level key -> (first line, end line
    exclusive), taken from PyYAML's own node marks, so exactly the lines YAML assigns to the value.
    Blank and comment-only lines at the end of a span belong to no key. Raises _Untrusted when the
    marks cannot be used (not a mapping, duplicate or non-text key, a line break the reader does
    not split on, or a key line that does not start with the key)."""
    if any(c in line for line in block for c in _YAML_BREAKS):
        raise _Untrusted("a line-break character (U+0085, U+2028 or U+2029) makes YAML count lines differently from the reader")
    try:
        node = yaml.compose("\n".join(block), Loader=_TaskLoader)
    except Exception:
        raise _Untrusted("the frontmatter cannot be composed")
    if node is None:
        return {}
    if not isinstance(node, yaml.MappingNode):
        raise _Untrusted("the frontmatter is not a mapping")
    out: dict[str, tuple[int, int]] = {}
    for knode, vnode in node.value:
        if not isinstance(knode, yaml.ScalarNode) or knode.value in out:
            raise _Untrusted("a key is not plain text or appears twice")
        a = knode.start_mark.line
        end = vnode.end_mark.line + (0 if vnode.end_mark.column == 0 else 1)
        end = min(max(end, a + 1), len(block))
        # Only lines after the last scalar or flow node of the value may be trimmed: a line that
        # starts with `#` inside a quoted scalar is text, not a comment.
        last = _last_node_end(vnode)
        floor = max(a + 1, last.line + (0 if last.column == 0 else 1))
        while end > floor and (not block[end - 1].strip() or block[end - 1].lstrip().startswith("#")):
            end -= 1
        if not block[a].startswith(knode.value + ":"):
            raise _Untrusted(f'the line YAML gives "{knode.value}" does not start with it')
        out[knode.value] = (a, end)
    return out


def _node_lines(block: list[str]) -> dict[str, list[str]]:
    """Top-level text key -> the lines YAML's node marks give its key and value, however the key is
    written. Empty when the block cannot be composed."""
    try:
        node = yaml.compose("\n".join(block), Loader=_TaskLoader)
    except Exception:
        return {}
    out: dict[str, list[str]] = {}
    if isinstance(node, yaml.MappingNode):
        for knode, vnode in node.value:
            if isinstance(knode, yaml.ScalarNode):
                end = vnode.end_mark.line + (0 if vnode.end_mark.column == 0 else 1)
                out.setdefault(knode.value, block[knode.start_mark.line : max(end, knode.start_mark.line + 1)])
    return out


@dataclass
class TaskRead:
    """Result of reading a task file, with what the repair command needs to rewrite it."""

    fm: dict[str, Any]
    body: str
    warnings: list[str]
    text: str = ""  # normalized text (BOM dropped, LF newlines)
    fence_at: int = -1  # offset in `text` of the opening `---` fence; -1 when there is none
    bad_keys: set[str] = field(default_factory=set)  # top-level keys that need rewriting
    recovered: dict[str, Any] = field(default_factory=dict)  # values recovered for bad_keys
    orig_tokens: dict[str, list[str]] = field(default_factory=dict)  # \w+ tokens of each bad key's original text
    lossy: set[str] = field(default_factory=set)  # bad keys whose recovery may not keep every word
    heading: bool = False  # the title was empty or missing and was taken from the body's "# " heading
    foreign: str = ""  # first words of the first comment before the opening fence that is not the old template's ("" when none)


@dataclass
class _Group:
    key: str
    a: int  # first line of the key in the block
    b: int  # end line, exclusive
    rest: str  # text after `key:` on the key's own line
    cont: list[str] = field(default_factory=list)  # stripped continuation lines
    flow: "_Flow | None" = None  # scanner of a `[` list value; its `closed` says if the `]` was seen
    raw: list[str] = field(default_factory=list)  # every line of the span, comments and skipped text included
    hidden: int = -1  # block index of an indented continuation line that starts with `<task key>:`; -1 when none


def _split_fence(text: str) -> tuple[list[str], str] | None:
    """`text` starts at the opening fence. Return (block_lines, body) or None."""
    lines = text.split("\n")
    if not lines or lines[0].rstrip() != "---":
        return None
    for i in range(1, len(lines)):
        if lines[i].rstrip() == "---":
            return lines[1:i], "\n".join(lines[i + 1 :])
    return None


class _Flow:
    """Incremental scanner for a `[a, b, ...]` list: splits on commas outside quotes, feeding one
    chunk at a time. Chunks are joined by a space, so no lookahead ever crosses a chunk boundary."""

    def __init__(self) -> None:
        self.items: list[str] = []
        self.buf: list[str] = []
        self.quote = ""
        self.depth = 0
        self.closed = False
        self.hit = False  # saw " #" outside quotes
        self.seen = False  # the current item holds a non-space character
        self.after = ""  # text after the closing `]`
        self._esc = False

    def feed(self, text: str) -> None:
        if self.closed:
            return
        buf, quote = self.buf, self.quote
        seen = self.seen
        i, n = 0, len(text)
        while i < n:
            ch = text[i]
            if self._esc:
                buf.append(ch)
                self._esc = False
                i += 1
                continue
            if quote:
                buf.append(ch)
                if quote == '"' and ch == "\\":
                    if i + 1 < n:
                        buf.append(text[i + 1])
                        i += 2
                        continue
                    self._esc = True
                elif ch == quote:
                    if quote == "'" and i + 1 < n and text[i + 1] == "'":
                        buf.append("'")
                        i += 2
                        continue
                    quote = ""
            elif ch in "\"'" and not seen:
                quote = ch
                buf.append(ch)
                seen = True
            elif ch == "#" and (not buf or buf[-1] in " \t"):
                self.hit = True
                buf.append(ch)
                seen = True
            elif ch == "[":
                self.depth += 1
                buf.append(ch)
                seen = True
            elif ch == "]" and self.depth:
                self.depth -= 1
                buf.append(ch)
                seen = True
            elif ch == "]":
                self.closed = True
                self.items.append("".join(buf))
                self.after = text[i + 1 :]
                break
            elif ch == "," and self.depth == 0:
                self.items.append("".join(buf))
                buf.clear()
                seen = False
            else:
                buf.append(ch)
                if not ch.isspace():
                    seen = True
            i += 1
        self.quote = quote
        self.seen = seen

    def result(self) -> tuple[list[str], bool, str, bool]:
        items = list(self.items)
        if not self.closed:
            items.append("".join(self.buf))
        return [x.strip() for x in items if x.strip()], self.closed, self.after, self.hit


def _scan_flow(text: str) -> tuple[list[str], bool, str, bool]:
    """Split a `[a, b, ...]` list (text starts at the `[`) on commas outside quotes.
    Returns (raw items, closed, text after the closing `]`, saw " #" outside quotes)."""
    f = _Flow()
    f.feed(text[1:])
    return f.result()


def _foreign_key_line(line: str) -> bool:
    """A column-0 line that starts a mapping key the key-line pattern does not know (`x-y: 1`,
    `"k": 1`, `? k`): it holds a `:` followed by a space or the end of the line. It ends the group
    above it, so its indented children never join that group."""
    if line == "?" or line.startswith("? "):
        return True
    if line == "-" or line.startswith("- ") or line[:1] in (" ", "\t", "#", ""):
        return False
    i = line.find(":")
    while i >= 0:
        if i + 1 == len(line) or line[i + 1] in " \t":
            return True
        i = line.find(":", i + 1)
    return False


def _key_groups(block: list[str]) -> list[_Group]:
    """Top-level keys with the lines that belong to them. A line is a continuation when it is
    indented, when it starts with `- ` under a list key, or when it follows an unclosed `[` list.
    Comment and blank lines are skipped for the value but stay inside the span `raw`; so does any
    unindented text line that sits between two continuation lines."""
    groups: list[_Group] = []

    def add(cur: _Group, s: str, i: int, indented: bool) -> None:
        cur.cont.append(s)
        cur.b = i + 1
        if indented and cur.hidden < 0 and _TASK_KEY_PREFIX_RE.match(s):
            cur.hidden = i
        if cur.flow is None and cur.key in _LIST_KEYS and not cur.rest.strip() and len(cur.cont) == 1 and s.startswith("["):
            cur.flow = _Flow()  # the list opens on the line after its key
            cur.flow.feed(s[1:])
            return
        if cur.flow is not None and not cur.flow.closed:
            cur.flow.feed(" " + s)

    fenced = False  # a column-0 `<anything>:` line that is not a key line ends the key above it
    for i, line in enumerate(block):
        s = line.strip()
        if not s or s.startswith("#"):
            continue
        cur = groups[-1] if groups else None
        m = _KEY_LINE_RE.match(line)
        indented = line[:1] in (" ", "\t")
        # Inside an open `[` list an unindented `word:` line is still part of the list, unless
        # `word` is a task key (then the list never closed and the key is lossy).
        if cur is not None and cur.flow is not None and not cur.flow.closed and (
            indented or not m or m.group(1) not in _TASK_KEYS
        ):
            add(cur, s, i, indented)
        elif m:
            fenced = False
            g = _Group(m.group(1), i, i + 1, m.group(2))
            rest = _PROPS_RE.sub("", g.rest.strip())  # an anchor or tag may come before the `[`
            if g.key in _LIST_KEYS and rest.startswith("["):
                g.flow = _Flow()
                g.flow.feed(rest[1:])
            groups.append(g)
        elif not indented and _foreign_key_line(line):
            fenced = True  # `x-y:`, `"k":`, `? k`: a key of its own, whose children are not the key above's
        elif cur is not None and not fenced and (indented or (cur.key in _LIST_KEYS and (s == "-" or s.startswith("- ")))):
            add(cur, s, i, indented)
    for k, g in enumerate(groups):
        # Indented comment lines right after a key's last line sit under it visually; they belong
        # to its span (a column-0 comment, or any other text, ends the run).
        end = groups[k + 1].a if k + 1 < len(groups) else len(block)
        for j in range(g.b, end):
            if _is_comment(block[j]) and block[j][:1] in (" ", "\t"):
                g.b = j + 1
            elif block[j].strip():
                break
        g.raw = block[g.a : g.b]
    return groups


def _load(text: str) -> Any:
    return yaml.load(text, Loader=_TaskLoader)  # noqa: S506 (SafeLoader subclass)


@lru_cache(maxsize=16)
def _load_dict_cached(block_text: str) -> dict[str, Any] | None:
    try:
        data = _load(block_text)
    except Exception:  # PyYAML constructors raise ValueError etc., not only YAMLError
        return None
    if data is None:
        return {}
    return data if isinstance(data, dict) else None


def _load_dict(block_text: str) -> dict[str, Any] | None:
    """Strict parse of a frontmatter block, or None. The same block is parsed several times by the
    reader and the repair, so the result is cached (and copied, so no caller can change it)."""
    return deepcopy(_load_dict_cached(block_text))


def _std_loads(text: str) -> bool:
    """True when PyYAML's standard `safe_load` constructs `text`. `_TaskLoader` differs from it only
    in leaving dates as text, so a date that is not a real one loads there and raises here."""
    try:
        yaml.safe_load(text)
    except Exception:
        return False
    return True


_TIMESTAMP_TAG = "tag:yaml.org,2002:timestamp"


def _impossible_timestamps(node: "yaml.Node", loader: "yaml.SafeLoader", seen: "set[int]") -> bool:
    """True when `node` or anything under it is a scalar that PyYAML's own resolver tags as a
    timestamp (or that carries the explicit tag) and its own constructor then rejects, such as
    `2026-02-30` or `2026-2-30 10:00:00`. The resolver and the constructor are PyYAML's, not a
    second pattern of ours. An alias is the node it names, entered once."""
    if id(node) in seen:
        return False
    seen.add(id(node))
    if isinstance(node, yaml.ScalarNode):
        if node.tag == _TIMESTAMP_TAG:
            try:
                loader.construct_yaml_timestamp(node)
            except Exception:
                return True
        return False
    kids = node.value if isinstance(node, yaml.SequenceNode) else [n for pair in node.value for n in pair]
    return any(_impossible_timestamps(k, loader, seen) for k in kids)


def _date_blame(text: str) -> "tuple[set[str], bool] | None":
    """Which top-level keys of the frontmatter `text` hold an impossible timestamp. Returns
    (keys, unattributed) or None when the text cannot be composed. `unattributed` is True when an
    impossible timestamp is in no plain key's value: in a key itself, or under a key that is not text."""
    try:
        root = yaml.compose(text, Loader=yaml.SafeLoader)
    except Exception:
        return None
    if not isinstance(root, yaml.MappingNode):
        return set(), False
    loader = yaml.SafeLoader("")
    keys: set[str] = set()
    unattributed = False
    for knode, vnode in root.value:
        if _impossible_timestamps(knode, loader, set()):
            unattributed = True
        if _impossible_timestamps(vnode, loader, set()):
            if isinstance(knode, yaml.ScalarNode):
                keys.add(knode.value)
            else:
                unattributed = True
    return keys, unattributed


def _has_props(block: list[str], groups: "list[_Group]") -> bool:
    """True when an anchor, an alias or an explicit tag appears in the frontmatter: scanned as one
    text, and, because the scan stops at the first YAML error, once more key by key."""
    def scan(text: str) -> bool:
        try:
            for tok in yaml.scan(text, Loader=yaml.SafeLoader):
                if isinstance(tok, (yaml.AnchorToken, yaml.AliasToken, yaml.TagToken)):
                    return True
        except Exception:
            pass
        return False

    return scan("\n".join(block)) or any(scan("\n".join(block[g.a : g.b])) for g in groups)


def _unquote(v: str) -> str:
    """Drop the quotes only when `v` on its own is exactly one quoted YAML scalar."""
    v = v.strip()
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
        try:
            s = _load(v)
        except Exception:
            return v
        if isinstance(s, str):
            return s
    return v


def _parts(g: _Group) -> list[str]:
    return [p for p in [g.rest.strip(), *g.cont] if p]


def _value_text(g: _Group) -> str:
    return " ".join(_parts(g))


def _block_items(g: _Group) -> list[str]:
    """The items of a block list; a wrapped item's lines are collected and joined once, so a long
    item costs time in proportion to its length."""
    items: list[list[str]] = []
    for p in _parts(g):
        if p == "-" or p.startswith("- "):
            items.append([p[2:].strip()])
        elif items:
            items[-1].append(p)
        else:
            items.append([p])
    return [" ".join(parts).strip() for parts in items]


def _is_block_list(g: _Group) -> bool:
    return any(p == "-" or p.startswith("- ") for p in _parts(g))


def _recover(g: _Group) -> Any:
    """Best value for a key whose YAML did not load, taken from its raw lines."""
    if g.key in _LIST_KEYS:
        rest = g.rest.strip()
        if _value_text(g).startswith("["):
            items = _scan_flow(_value_text(g))[0]
            return [i for i in (_unquote(x) for x in items) if i]
        if _is_block_list(g):
            return [i for i in (_unquote(x) for x in _block_items(g)) if i]
        if not _parts(g):
            return []
    text = _unquote(_value_text(g))
    if g.key == "issue_number" and re.fullmatch(r"\d+", text):
        return int(text)
    return text


def _is_comment(line: str) -> bool:
    return line.strip().startswith("#")


def _raw_tokens(g: _Group) -> list[str]:
    """Words of every line of the key's span (the text after `key:` on its own line, then the
    other lines as written), so a skipped comment or text line still counts."""
    return _tokens("\n".join([g.rest, *g.raw[1:]]))


def _tokens(v: Any) -> list[str]:
    if isinstance(v, (list, tuple)):
        v = " ".join(str(x) for x in v)
    return re.findall(r"\w+", "" if v is None else str(v))


def _is_subsequence(want: list[str], have: list[str]) -> bool:
    it = iter(have)
    return all(w in it for w in want)


def _after_quote(text: str) -> str | None:
    """When `text` starts with one quoted scalar, the text after its closing quote; else None."""
    t = text.lstrip()
    if t[:1] not in ("'", '"'):
        return None
    q, i = t[0], 1
    while i < len(t):
        c = t[i]
        if q == '"' and c == "\\":
            i += 2
            continue
        if c == q:
            if q == "'" and t[i + 1 : i + 2] == "'":
                i += 2
                continue
            return t[i + 1 :]
        i += 1
    return None


# Anchors and tags that may sit in front of a value: `&name`, `!tag`, `!!str`.
_PROPS_RE = re.compile(r"^(?:(?:&\S+|!\S*)[ \t]+)+")


def _open_quote(value: Any) -> bool:
    """True when a recovered value, or one of its list items, starts with a quote the reader could
    not close (after any anchor or tag): the quote then holds text that YAML may read across lines."""
    items = value if isinstance(value, (list, tuple)) else [value]
    items = [_PROPS_RE.sub("", x) if isinstance(x, str) else x for x in items]
    return any(isinstance(x, str) and x[:1] in ("'", '"') and _after_quote(x) is None for x in items)


def _comment_with_words(rest: str | None) -> bool:
    return rest is not None and re.match(r"[ \t]+#", rest) is not None and re.search(r"\w", rest) is not None


def _break_outside_quotes(text: str) -> bool:
    """True when `text` holds U+0085, U+2028 or U+2029 outside a quoted scalar. YAML ends a line
    there; the reader splits on "\\n" only, so its idea of which line holds what would be wrong."""
    quote, prev, i, n = "", "", 0, len(text)
    while i < n:
        c = text[i]
        if quote:
            if quote == '"' and c == "\\":
                i += 2
                continue
            if c == quote:
                if quote == "'" and text[i + 1 : i + 2] == "'":
                    i += 2
                    continue
                quote = ""
        elif c in "\"'" and prev in ("", "[", ",", "-", ":", "{"):
            quote = c
            prev = c
        elif c in _YAML_BREAKS:
            return True
        if not c.isspace():
            prev = c
        i += 1
    return False


def _unclosed(rest: str) -> bool:
    """True when a value (after any anchor or tag) that starts a quote, `[` or `{` on its key line
    does not close it there."""
    rest = _PROPS_RE.sub("", rest)
    if rest[:1] in ('"', "'"):
        return _after_quote(rest) is None
    if rest[:1] in ("[", "{"):
        flat = "[" + rest[1:].replace("{", "[").replace("}", "]")
        return not _scan_flow(flat)[1]
    return False


def _suspect(g: _Group, value: Any) -> str | None:
    """After a successful load: why the value cannot be trusted, or None."""
    key = g.key
    rest = g.rest.strip()
    if any(_is_comment(x) and re.search(r"\w", x) for x in g.raw[1:]):
        return "comment line with words inside the value"
    if rest.startswith("#") and re.search(r"\w", rest) and g.cont:
        return "comment with words on the key line"
    if key in _LIST_KEYS:
        if isinstance(value, list) and not all(isinstance(x, str) for x in value):
            return "item that is not text"
        if isinstance(value, (dict, bool, int, float)):
            return "value that is not a list"
        if _value_text(g).startswith("["):
            if _scan_flow(_value_text(g))[3]:
                return 'comment cut at " #"'
        elif _is_block_list(g):
            for item in _block_items(g):
                if item[:1] not in ("'", '"') and (_COMMENT_START_RE.search(item) or item.startswith("#")):
                    return 'comment cut at " #"'
                if item[:1] in ("'", '"') and _comment_with_words(_after_quote(item)):
                    return "comment after a closing quote"
        elif isinstance(value, str):
            # A list key written as one plain string (`success_criteria: Ship it #12`): a ` #` cut it short.
            if rest[:1] not in ("'", '"', "|", ">", "#") and any(_COMMENT_START_RE.search(p) for p in _parts(g)):
                return 'comment cut at " #"'
            if rest[:1] in ("'", '"') and _comment_with_words(_after_quote(_value_text(g))):
                return "comment after a closing quote"
        return None
    if key in _STR_KEYS:
        if value is None and key == "title" and rest.startswith("#") and re.search(r"\w", rest) and not g.cont:
            return "the whole value is a comment"  # YAML reads it as empty; the text is the human's title
        if value is None or (isinstance(value, list) and not value):
            return None  # `~`, `null`, `[]` and a blank value all read as the empty string
        if isinstance(value, date):
            return None  # a valid timestamp (explicit `!!timestamp`): the console shows its text
        if not isinstance(value, str):
            return "value that is not text"
        if key in _FREE_TEXT_KEYS and rest[:1] not in ("'", '"', "|", ">", "#"):
            if any(_COMMENT_START_RE.search(p) for p in _parts(g)):
                return 'comment cut at " #"'
        if key in _FREE_TEXT_KEYS and rest[:1] in ("'", '"') and _comment_with_words(_after_quote(_value_text(g))):
            return "comment after a closing quote"
    return None


def analyze_task_text(raw: str) -> TaskRead:
    """Read task-file text leniently. Never raises. See `_read_task_frontmatter`."""
    try:
        return _analyze(raw)
    except Exception:
        return TaskRead({}, raw, ["unreadable file"], raw, -1)


def _analyze(raw: str) -> TaskRead:
    text = raw[1:] if raw.startswith("\ufeff") else raw
    text = text.replace("\r\n", "\n")
    warnings: list[str] = []

    fence_at = 0
    foreign = ""
    split = _split_fence(text) if text.startswith(_FRONT_FENCE) else None
    if split is None:
        # Recover: skip leading blank space and comments before the fence. Only the old template's comment is
        # template text; any other comment is somebody's words, so it is flagged and the repair refuses it.
        pos = 0
        comments: list[str] = []
        if text[:1].isspace():
            warnings.append("blank lines before frontmatter")
        while True:
            while pos < len(text) and text[pos].isspace():
                pos += 1
            m = _COMMENT_BLOCK_RE.match(text, pos)
            if not m:
                break
            comments.append(m.group(0))
            pos = m.end()
        later_lines = _LaterLines(text[pos:])
        saw_comment = False
        # Examination stops at the first foreign comment, and a second comment of any kind is already a refusal, so
        # at most two comments are examined however many the file holds.
        for c in comments[:2]:
            problem = _template_problem(c, later_lines)
            if problem is not None:
                foreign = problem
                break
            saw_comment = True
        if not foreign and len(comments) > 1:
            foreign = "more than one template comment"
        if foreign:
            warnings.insert(0, f'comment before frontmatter that is not the old template\'s: "{foreign}"')
        if saw_comment:
            warnings.insert(0, "template comment before frontmatter")
        fence_at = pos
        split = _split_fence(text[pos:])
        if split is None:
            return TaskRead({}, text, ["no frontmatter"], text, -1)

    block, body = split
    fm: dict[str, Any] = {}
    bad: set[str] = set()
    recovered: dict[str, Any] = {}
    orig_tokens: dict[str, list[str]] = {}
    lossy: set[str] = set()

    def recover(g: _Group, why: str) -> None:
        value = _recover(g)
        prior = fm.get(g.key)
        fm[g.key] = value
        if g.key == "depts" and why == 'comment cut at " #"' and prior is not None:
            # A department is an identifier: the console shows what YAML read (`ops` for `ops #core`), because
            # the comment text is not a name the department filter accepts. The warning stays.
            fm[g.key] = prior
        bad.add(g.key)
        recovered[g.key] = value
        orig_tokens[g.key] = _raw_tokens(g)
        # In a file that does not parse the repair rewrites a value only when all of it sits on its key line.
        stuck = loaded is None and bool(g.cont or _unclosed(g.rest.strip()) or _break_outside_quotes(g.rest))
        warnings.append(
            f'unquoted value in "{g.key}"' + (f" ({why})" if why else "") + (", which goes past its key line" if stuck else "")
        )
        if not _is_subsequence(orig_tokens[g.key], _tokens(value)):
            lossy.add(g.key)
            warnings.append(f'recovered "{g.key}" may not keep every word')
        elif _open_quote(value):
            lossy.add(g.key)
            warnings.append(f'recovered "{g.key}" starts with a quote that is never closed')

    groups: list[_Group] = []
    seen: set[str] = set()
    every = _key_groups(block)
    for g in every:
        if g.key not in seen:
            seen.add(g.key)
            groups.append(g)
        elif g.key not in lossy:
            lossy.add(g.key)
            warnings.append(f'duplicate key "{g.key}"')

    loaded = _load_dict("\n".join(block))
    if loaded is not None:
        # In a file that parses, comment and blank lines after the last node of a value belong to
        # no key: they are not part of its span, so they neither warn nor count as its words.
        try:
            marks = _yaml_spans(block)
        except _Untrusted:
            marks = {}
        for g in every:
            if g.key in marks and marks[g.key][0] == g.a and marks[g.key][1] < g.b:
                g.raw = block[g.a : max(marks[g.key][1], g.a + 1)]
    covered = {i for g in every for i in range(g.a, g.b)}
    if loaded is None:
        for i, line in enumerate(block):
            if line.strip() and not _is_comment(line) and i not in covered:
                lossy.add("")
                warnings.append(f"frontmatter line {i + 1} belongs to no key and the file does not parse")
    # Facts about the lines themselves, whether or not the file parses.
    for g in every:
        if g.flow is not None and not g.flow.closed:
            lossy.add(g.key)
            warnings.append(f'"{g.key}" starts a [ list that is never closed (frontmatter line {g.a + 1})')
        if g.hidden >= 0:
            lossy.add(g.key)
            warnings.append(f'frontmatter line {g.hidden + 1} starts with a key name but is indented under "{g.key}"')
    owner_of: dict[int, _Group] = {i: g for g in every for i in range(g.a, g.b)}  # one pass, not one scan per line
    for i, line in enumerate(block):
        if any(c in line for c in _YAML_BREAKS):
            owner = owner_of.get(i)
            first = line[line.find(":") + 1 :] if owner is not None and i == owner.a else line
            if _break_outside_quotes(first):
                warnings.append(f"frontmatter line {i + 1} has a line-break character (U+0085, U+2028 or U+2029) outside quotes")
    # Keys whose value `_TaskLoader` takes but the standard `safe_load` cannot construct (a date
    # that is not a real one, such as 2026-02-30), found per scalar node by PyYAML's own resolver.
    # They are rewritten as text with the same words.
    std_bad: set[str] = set()
    if loaded is not None:
        fm.update(loaded)
        blame = _date_blame("\n".join(block))
        if blame is not None and (blame[0] or blame[1]):
            std_bad = blame[0] & seen
            if blame[1] or blame[0] - seen:
                lossy.add("")
                warnings.append("the frontmatter does not load with a standard YAML loader and no single key explains it")
    if loaded is not None and any(str(k) in _TASK_KEYS and str(k) not in seen for k in loaded):
        # A task key the reader has no key line for (`? title` / `: value`, or a quoted key) cannot be
        # checked for a ` #` comment that cut its value short: refuse it if words went missing.
        for k, lines in _node_lines(block).items():
            if k in _TASK_KEYS and k not in seen and any(_COMMENT_START_RE.search(x) for x in lines):
                if not _is_subsequence(_tokens("\n".join(lines)), _tokens(k) + _tokens(loaded.get(k))):
                    lossy.add(k)
                    warnings.append(f'"{k}" is written as a quoted or "? " key and words after a " #" are not in its value')
    for g in groups:
        if loaded is None:
            one = _load_dict("\n".join(block[g.a : g.b]))
            if one is None or g.key not in one:
                recover(g, "")
                continue
            fm[g.key] = one[g.key]
            one_blame = _date_blame("\n".join(block[g.a : g.b]))
            if one_blame is not None and (one_blame[0] or one_blame[1]):
                std_bad.add(g.key)
        elif g.key not in fm:
            # The file parses but YAML does not see this line as a key: it sits inside another value.
            lossy.add(g.key)
            warnings.append(f'frontmatter line {g.a + 1} looks like the key "{g.key}" but YAML reads it as part of another value')
            continue
        why = _suspect(g, fm[g.key])
        if not why and g.key in std_bad:
            why = "a date or time that is not real"
        if why:
            recover(g, why)
            if g.key in std_bad and (g.key not in _TASK_KEYS or _COMMENT_START_RE.search(_value_text(g))):
                # Not a task key (its structure would flatten to text), or a comment after the date
                # (the console value would change): leave the line for hand editing.
                lossy.add(g.key)
                warnings.append(f'"{g.key}" holds a date or time that is not real and cannot be rewritten safely')

    heading = False
    if not str(fm.get("title") or "").strip():
        for line in body.split("\n"):
            if line.startswith("# ") and line[2:].strip():
                fm["title"] = line[2:].strip()
                bad.add("title")
                recovered["title"] = fm["title"]
                orig_tokens["title"] = _tokens(fm["title"])
                warnings.append('title taken from the "# " heading')
                heading = True
                break

    if warnings:
        # Facts the repair refuses on that no other warning names; only said for a file that has
        # something to repair, so a file needing no repair stays warning-free.
        crlf = raw.count("\r\n")
        if raw.count("\r") != crlf or (crlf and crlf != raw.count("\n")):
            warnings.append("the file mixes CRLF and LF line endings")
        if loaded is None:
            other = next((g.key for g in groups if g.key not in _TASK_KEYS), None)
            if other is not None:
                warnings.append(f'"{other}" is not a task key and the file does not parse, so the repair leaves the file alone')
        if loaded is not None and any(c in line for line in block for c in _YAML_BREAKS):
            warnings.append("the frontmatter holds a line-break character (U+0085, U+2028 or U+2029) in a file that parses, so line positions cannot be trusted")

    return TaskRead(fm, body, warnings, text, fence_at, bad, recovered, orig_tokens, lossy, heading, foreign)


def read_regular_bytes(path: "Path | str", follow: bool = True, limit: "int | None" = None) -> "tuple[bytes, os.stat_result]":
    """Read a regular file's bytes without being able to hang: the file is opened non-blocking (a
    FIFO opens at once) and must be a regular file once opened (a FIFO, a device such as /dev/zero
    or a directory raises OSError). With follow=False a symlink raises too. `limit` raises OSError for a
    larger file, before anything is read. Returns (bytes, fstat of the opened file)."""
    flags = os.O_RDONLY | getattr(os, "O_NONBLOCK", 0) | (0 if follow else getattr(os, "O_NOFOLLOW", 0))
    fd = os.open(path, flags)
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode):
            raise OSError(0, "not a regular file")
        if limit is not None and st.st_size > limit:
            raise OSError(0, f"file too large ({st.st_size} bytes)")
        chunks = []
        while True:
            chunk = os.read(fd, 1 << 20)
            if not chunk:
                break
            chunks.append(chunk)
        return b"".join(chunks), st
    finally:
        os.close(fd)


def _read_task_frontmatter(md: Path) -> tuple[dict[str, Any], str, list[str]]:
    """Lenient frontmatter reader for task files; returns (frontmatter, body, warnings).

    `parse_frontmatter` stays strict for agents, skills and history, where Claude Code itself
    needs the frontmatter at the top. Task files are written by a skill and read only by this
    console, so a defect there should still show the row, and say so. Never raises.
    """
    try:
        raw = read_regular_bytes(md)[0].decode("utf-8")
    except (OSError, UnicodeDecodeError):
        return {}, "", ["unreadable file"]
    r = analyze_task_text(raw)
    return r.fm, r.body, r.warnings


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
    fm, body, warnings = _read_task_frontmatter(md)
    try:
        n = int(fm.get("issue_number") or md.stem)
    except (TypeError, ValueError, OverflowError):  # .inf, .nan, a list...
        try:
            n = int(md.stem)  # a garbled issue_number must not hide the row
        except ValueError:
            return None
        warnings = [*warnings, "issue_number is not a usable number; the file name is used"]
    # Location wins over frontmatter; paused membership overrides 'active'.
    state = state_from_location
    if state == "active" and n in paused:
        state = "paused"
    return Task(
        issue_number=n,
        title=_s(fm.get("title")),
        owner=_s(fm.get("owner")),
        depts=_as_list(fm.get("depts")),
        state=state,
        created=_s(fm.get("created")),
        completed=_s(fm.get("completed")),
        success_criteria=_as_list(fm.get("success_criteria")),
        related_skills=_as_list(fm.get("related_skills")),
        warnings=list(warnings),
        body=body,
        path=md,
    )


def _s(v: Any) -> str:
    """str() that renders an empty YAML value (None, or an empty list) as an empty string."""
    return "" if v is None or (isinstance(v, list) and not v) else str(v)


def _as_list(v: Any) -> list[Any]:
    if not v:
        return []
    return list(v) if isinstance(v, (list, tuple)) else [v]


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
                    time=str(fm.get("time", "")),
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
    # Sort newest first: (date, time, run_id) descending. Missing time
    # ("") sorts before any "HH:MM" lexically, which on a desc sort puts
    # timed entries above untimed ones for the same date — backwards-compat
    # for older entries while letting timed entries take priority.
    out.sort(key=lambda e: (e.date, e.time, e.run_id), reverse=True)
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
