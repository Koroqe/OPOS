"""Repair task files whose frontmatter the console had to recover.

    python3 -m ui.repair_tasks            # dry run: list what would change
    python3 -m ui.repair_tasks --apply    # rewrite the broken files

Run from the repository root (or pass --root). When the company uses leases, take a
`path:tasks/**` lease before --apply. Only files the lenient reader reports warnings for are
touched, and only the broken parts:

- a BOM, blank space and the old template's instruction comment before the opening `---` fence are
  removed (a slot of that comment may hold its token, nothing, or only words that appear, in order, on one line of the file after the opening fence);
  any other text before the fence makes the file "edit by hand", with the first line that differs named (for any other comment, its first words);
- each key the reader could not take as written becomes ONE line, a quoted scalar or a quoted
  flow list; the lines that key spanned are replaced, and a comment line with no words in it
  that sat inside the span goes with them;
- every frontmatter line outside the rewritten keys, the fence lines and the whole body stay
  byte-identical, and the file keeps its line endings (LF or CRLF; a file that mixes the two is
  not repaired).

The repair makes exactly these changes: it removes a BOM, blank space and the old template's instruction comment before the opening fence (a slot of that comment may hold its token, nothing, or only words that appear, in order, on one line of the file after the opening fence; any other text there makes the file "edit by hand"); it puts back a ` #` comment YAML cut off a value; it gives an empty, `null` or all-comment title the text of the body's heading (or of the comment); and it writes a number or boolean of a rewritten key as its text.
ACLs and Linux file attributes (`chattr +a`, `+i`) are only found when the file is written, so the page can say "repair" where `--apply` then reports "cannot repair"; a temp file the run cannot remove is reported as `left temp file <path>: <reason>` and the run exits 1.

One grammar, the same for a file that parses and one that does not. The repair reads a flagged key's
own lines, never a value YAML made of them, and rewrites a key only when its lines are (a) a plain
one-line value, (b) for `depts`, `success_criteria` and `related_skills`, a one-line `[a, b]` list
of plain items, or (c) for those three keys, a block list whose every line is a plain `- item`
(blank lines and comment lines without words may sit inside it and go with it). A value is plain
when its first character is none of `! & * " ' [ { | > % @`, a backtick or a backslash, it does not
start with `- `, `? `, `: `, `,` or `#`, its line holds no U+0085, U+2028 or U+2029 and no tab before
the value; a list item must also not read as a mapping (`a: b`). Anything else in a flagged key (a
wrapped or quoted title, a flow list that goes on over lines, a block scalar, an item that is a
mapping) is "edit by hand", and the message names the check, the key, the line and the reason. Three
additions: the first item of a block list may sit on the key's own line (`key: - first`); in a file
that does not parse, a one-line value of a scalar key that starts with an indicator character
(`[Bug] login fails`, `@home`) is kept as its literal text when that key's own line does not parse on its
own; and a `title` whose whole value is a `#` comment is the comment's text (YAML reads it as empty). An item of `depts`, which the console
takes as a name (`safe_slug`), that holds a ` #` comment is refused rather than restored, because the
restored text would be a name the console rejects; `title`, `success_criteria` and `related_skills` keep the restore. A key that is
not a task key and needs a change is for hand editing too, and so is any frontmatter that holds an
anchor, an alias or an explicit tag: for those YAML's value is not the text of the line.

Before writing, every top-level key is compared with what YAML read in the original (when the original
parses): the new value must be the same. The repair changes a value in exactly these ways, each checked exactly: (1) a value YAML cut at a ` #` regains exactly the comment text it cut; (2) a title that was empty (blank, `~`, `null`, or all comment) takes the body's heading, or, when the comment holds words, the comment's own text; (3) a number or boolean of a rewritten key is written as the text of its line (`true`, `yes`, `1_000`, `0x1F`), accepted only when YAML reads that text as the same value and type. An impossible date such as `2026-02-30` needs no change: it is text under the console's loader before and after. Null, `""` and `[]` are one empty value. Any other change is refused with `check "backstop": the value of "<key>" would change; edit by hand`.
A task file that is a symlink is never replaced (message: "cannot repair <file>: symlink (a link is
never replaced by a regular file)"); neither is a hard-linked file (a repair would split its names),
a file with a BSD immutable or append-only flag, a file in a directory the user cannot write to or
that carries those flags or is sticky and holds a file of another user while the user is neither the directory's owner nor root (checked again just before the
temp file is made), or anything that is not a regular file (a FIFO, a device); the file is looked at with lstat before it
is opened, never read through a link beyond a bounded size, and never blocks. A rewritten file keeps
the permission bits of the file it replaces, a read-only (0444) file included. A `tasks/` directory
that cannot be listed prints `cannot list tasks/: <reason>` and the run exits 1.

The repair never drops a word (a run of letters, digits and underscores), removes no key, and adds
only a missing `title`, taken from the body's `# ` heading. A rewrite is checked before it is
written: the new frontmatter must parse strictly and with PyYAML's standard `safe_load`, it must
have no key that is not a task key unless the original's strict parse had it, and no task key that
an original line starts with (indentation ignored) may be missing; the reader must have no warnings
left, every value the console shows must be unchanged, every word of the original lines of each
rewritten key must survive, and every word of the original file from the opening fence onward must
survive, in order, in the new file (a backslash-u escape is decoded only on the lines the repair
wrote). A comment line that carries a word, a text line no key owns, a duplicate key, or a list that
never closes makes the file "cannot repair": it is reported, exit 1, and left untouched. The new text
goes to a temp file made with `mkstemp` in the file's own directory; just before `os.replace` the
target is looked at again (same file, not a link, unchanged bytes), and if it changed since it was
first read, it is skipped with a message. The file read for the decision stays open until the replace is
done or refused, so its inode cannot be freed and given to another file, and "same file" is sound. A full disk or an I/O error while writing removes this
run's temp file (and reports one it cannot remove), counts the file as "cannot repair" with a one-line reason, and the run goes on and
still prints its summary; so does any other error on one file ("cannot repair <file>: internal
error: <one line>").

A key line whose first colon is not followed by a space or tab (`state::`, `title:x`) is refused with
`check "keys"`: YAML does not split such a line at the first colon, so the repair would be guessing the key
set. A `title` of `null`, `~` or a blank is replaced by the body's heading; the spelling `null` is the only
text of the original frontmatter or body (from the opening fence on) that goes, every other word, comment
lines before the closing fence included, stays.

The task page's advice ("repair" or "edit by hand") is exactly `decide(path)`'s verdict, the same function
`--apply` calls for each file. A warning the repair will not clear (the page's own "issue_number is not a
usable number") is shown as a separate note beside the advice, never by changing it. It looks at the path and the bytes, plans the repair, and refuses a
symlink, a hard link, an immutable file and an unwritable directory, so the page and `--apply`
follow one code path and agree on mixed line endings, a lone CR and all of those as well. What neither
can know beforehand is a full disk, an I/O error, an ACL or a Linux file attribute, which `--apply`
then reports file by file.

Exit codes: 0 nothing to repair (or --apply repaired everything), 3 dry run found repairs
pending, 1 at least one file cannot be repaired or was skipped.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import stat
import sys
import tempfile
from pathlib import Path
from typing import Any, NamedTuple

from ui.data import (
    REPO_ROOT,
    _COMMENT_START_RE,
    _TASK_KEY_PREFIX_RE,
    _TASK_KEYS,
    _LIST_KEYS,
    TaskRead,
    _Group,
    _has_props,
    _is_subsequence,
    _key_groups,
    _load,
    _std_loads,
    _load_dict,
    _split_fence,
    _tokens,
    _unclosed,
    analyze_task_text,
    read_regular_bytes,
)

# Characters a YAML double-quoted scalar cannot carry safely: DEL, the C1 controls (U+0085 is a
# line break to YAML), the Unicode line/paragraph separators and the non-characters.
_UNSAFE = {0xFEFF, 0xFFFE, 0xFFFF, 0x2028, 0x2029} | set(range(0x7F, 0xA0))


def _quote(value: str) -> str:
    out = []
    for ch in json.dumps(value, ensure_ascii=False):
        out.append("\\u%04x" % ord(ch) if ord(ch) in _UNSAFE else ch)
    return "".join(out)


def _encode(value: Any) -> str:
    if isinstance(value, (list, tuple)):
        return "[" + ", ".join(_quote(str(v)) for v in value) + "]"
    return _quote("" if value is None else str(value))


def _norm(v: Any) -> Any:
    if v is None:
        return ""
    if isinstance(v, (list, tuple)):
        return [str(x) for x in v]
    return str(v)


def _eol(raw: str) -> str | None:
    """The file's line ending ("\n" or "\r\n"), or None when it mixes styles."""
    crlf, lf = raw.count("\r\n"), raw.count("\n")
    if raw.count("\r") != crlf or (crlf and crlf != lf):
        return None
    return "\r\n" if crlf else "\n"


_ESCAPE_RE = re.compile(r"\\(?:u([0-9a-f]{4})|([\"\\/bfnrt]))")
_SIMPLE_ESCAPES = {'"': '"', "\\": "\\", "/": "/", "b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t"}


def _file_tokens(text: str) -> list[str]:
    """Words of `text`, with the JSON escapes this module writes (`\\uXXXX`, `\\t`, `\\n`, `\\"`, `\\\\` ...)
    turned back into the character, so an escaped tab or control character does not glue its
    neighbours into a new word."""
    def back(m: "re.Match[str]") -> str:
        if m.group(2):
            return _SIMPLE_ESCAPES[m.group(2)]
        ch = chr(int(m.group(1), 16))
        return m.group(0) if re.match(r"\w", ch) else ch

    return _tokens(_ESCAPE_RE.sub(back, text))


def _strict(lines: list[str]) -> dict[str, Any] | None:
    """The frontmatter lines parsed strictly (None when they do not parse as a mapping)."""
    return _load_dict("\n".join(lines))


_BREAK_CHARS = "\x85\u2028\u2029"
# YAML spellings of null: for a title they mean "no title", so the heading takes over and they are not words lost.
_NULL_SPELLINGS = frozenset({"null", "Null", "NULL", "~"})
# First characters that make a value something other than plain text: an anchor, tag, alias,
# quote, flow or block opener, directive, reserved indicator, or an escape.
_NOT_PLAIN_START = "!&*\"'[{|>%@`\\"


def _plain(value: str) -> bool:
    """True when `value` (the text after `key:` and its spaces) reads as one plain scalar whatever
    comes after it: no leading indicator, and no `- `, `? `, `: ` (or a lone `-`, `?`, `:`), `,`, `#`."""
    if not value:
        return True
    c = value[0]
    if c in _NOT_PLAIN_START or c in ",#":
        return False
    return not (c in "-?:" and (len(value) == 1 or value[1] in " \t"))


def _flow_list_items(value: str) -> list[str] | None:
    """The items of a `[a, b]` list that opens and closes on one line (a trailing ` #` comment
    after the `]` is ignored; one before it swallows the `]` and is list content), or None when the
    value is not such a list: no closing `]`, text after it, a bracket or brace inside, or a quote that
    does not follow a word character (`it's` is plain text; `'a'` and `, "b"` open a quoted scalar)."""
    if not value.startswith("["):
        return None
    end = value.rfind("]")
    if end < 0:
        return None
    after = value[end + 1 :]
    if after.strip() and not re.match(r"[ \t]+#", after):
        return None
    inner = value[1:end]
    if any(c in inner for c in "[]{}"):
        return None
    if re.search(r"(?<!\w)['\"]", inner):  # a quote is plain text only right after a word character
        return None
    return [x.strip() for x in inner.split(",") if x.strip()]


class _Fit(NamedTuple):
    end: int  # the key's lines are block[g.a:end]
    value: Any  # the new value: text, or a list of text
    raw: Any  # the same value as the lines hold it: text with any ` #` comment, or the list of such items


def _no_fit(why: str) -> str:
    return (
        f"{why}; the repair rewrites only a plain one-line value, a one-line [a, b] list of plain items, "
        'or a block list of plain "- item" lines'
    )


def _item_ok(item: str) -> bool:
    """A list item the repair writes back as text: plain, and not something YAML reads as a
    mapping (`a: b`, `a:`)."""
    return bool(item) and _plain(item) and ": " not in item and ":\t" not in item and not item.endswith(":")


# List keys whose items the console uses as identifiers (the Tasks dropdown and `?dept=` take them through
# `safe_slug`): a ` #` comment YAML cut from such an item is not restored into it, the file is refused instead.
_IDENTIFIER_KEYS = frozenset({"depts"})


def _fit(g: _Group, block: list[str], line_of: int) -> "_Fit | str":
    """`_fit_lines`, plus one refusal: an item of an identifier key (`depts`) that holds a ` #` comment would be
    written with the comment in the department's name, which the console then rejects. Free-text keys
    (`success_criteria`, `title`) keep the restore."""
    fit = _fit_lines(g, block, line_of)
    if isinstance(fit, str) or g.key not in _IDENTIFIER_KEYS:
        return fit
    items = fit.value if isinstance(fit.value, list) else [fit.value]
    bad = next((x for x in items if isinstance(x, str) and (x.startswith("#") or _COMMENT_START_RE.search(x))), None)
    if bad is not None:
        return f'"{g.key}" holds "{bad[:40]}": its " #" comment would become part of a name the console rejects'
    return fit


def _fit_lines(g: _Group, block: list[str], line_of: int) -> "_Fit | str":
    """The one grammar of the repair, the same for a file that parses and one that does not: the
    key's lines are either (a) a plain one-line value, (b) for a list key, a one-line `[a, b]` list
    of plain items, or (c) for a list key, a block list whose every line is a plain `- item` (the
    first item may sit on the key's own line: `key: - first`). Blank lines and comment lines with no
    words in them may sit inside (c) and go with it. A `title` whose whole value is a `#` comment
    (YAML reads it as empty) fits as the comment's text. Returns the lines and the new value, or the
    reason the key does not fit. It reads the lines themselves, never a value YAML made of them."""
    here = line_of + g.a
    key_line = f"{g.key}:{g.rest}"
    if any(c in key_line for c in _BREAK_CHARS):
        return _no_fit(f'"{g.key}" on line {here} holds a line-break character (U+0085, U+2028 or U+2029)')
    lead = g.rest[: len(g.rest) - len(g.rest.lstrip(" \t"))]
    if "\t" in lead:
        return _no_fit(f'"{g.key}" on line {here} has a tab before its value')
    value = g.rest.strip()  # the same whitespace the reader strips
    content = [j for j in range(g.a + 1, g.b) if block[j].strip() and not block[j].strip().startswith("#")]
    head: list[str] = []
    if g.key in _LIST_KEYS and value.startswith("- "):  # `key: - first`, then `- second` lines
        head = [value[2:].strip()]
        if not _item_ok(head[0]):
            return _no_fit(f'"{g.key}" has a line (line {here}) that is not a plain "- item"')
        value = ""
    if not content and not head:
        if _plain(value):
            text: Any = [] if g.key in _LIST_KEYS and not value else value
            return _Fit(g.a + 1, text, text)
        if g.key in _LIST_KEYS:
            items = _flow_list_items(value)
            if items is not None and all(_item_ok(x) for x in items):
                return _Fit(g.a + 1, items, items)
        if g.key == "title" and lead and value.startswith("#"):
            return _Fit(g.a + 1, value, value)  # the whole value is a comment: YAML reads it as empty
        return _no_fit(f'"{g.key}" on line {here} has a value that starts with "{value[:1]}" or is not a plain one-line value')
    if g.key not in _LIST_KEYS or value:
        return _no_fit(f'"{g.key}" goes on past line {here} (see line {line_of + content[0]})')
    items = list(head)
    for j in content:
        line = block[j]
        if any(c in line for c in _BREAK_CHARS):
            return _no_fit(f'"{g.key}" on line {line_of + j} holds a line-break character (U+0085, U+2028 or U+2029)')
        m = re.match(r"^ *- +(\S.*)$", line)
        item = m.group(1).strip() if m else ""
        if not _item_ok(item):
            return _no_fit(f'"{g.key}" has a line (line {line_of + j}) that is not a plain "- item"')
        items.append(item)
    return _Fit(content[-1] + 1 if content else g.a + 1, items, items)


def _literal(g: _Group, block: list[str], line_of: int) -> "_Fit | None":
    """For a file that does not parse: a one-line value of a scalar key that starts with an indicator
    character (`[Bug] login fails`, a backtick, a quote, `@`, `*`, `%`, `{`, `- `, `? `, `: `, `,`,
    `|`, `>`) fits as its literal text when that key's own lines do not parse on their own, so YAML
    holds no other reading of them. A key whose lines do parse (`&a b`) does not fit here."""
    if g.key in _LIST_KEYS or g.b != g.a + 1:
        return None
    key_line = f"{g.key}:{g.rest}"
    lead = g.rest[: len(g.rest) - len(g.rest.lstrip(" \t"))]
    if any(c in key_line for c in _BREAK_CHARS) or "\t" in lead:
        return None
    value = g.rest.strip()
    if not value or _unclosed(value):  # an opener the line never closes may go on over the lines after it
        return None
    one = _load_dict(key_line)
    if one is not None and g.key in one:
        return None
    return _Fit(g.a + 1, value, value)


def _span_tokens(key: str, block: list[str], a: int, end: int) -> list[str]:
    """Words of the lines of a key's span, without the key name itself."""
    first = block[a][len(key) + 1 :]
    return _tokens("\n".join([first, *block[a + 1 : end]]))


# ---- guards: each one alone must be able to refuse a rewrite (tests switch the others off) ----


def _is_lossy(r: TaskRead) -> bool:
    return bool(r.lossy)


def _strict_ok(new_block: list[str]) -> bool:
    """The new frontmatter loads with the console's loader and with PyYAML's standard `safe_load`."""
    return _strict(new_block) is not None and _std_loads("\n".join(new_block))


def _clean_ok(check: TaskRead) -> bool:
    """The reader finds nothing left to warn about in the new file."""
    return not check.warnings


def _keys_ok(r: TaskRead, block: list[str], new_block: list[str]) -> bool:
    """The rewritten frontmatter has exactly the top-level keys it should: no key that is neither a
    task key nor already in the original's strict parse, and no task key that an original line
    starts with (indentation ignored) missing."""
    new = _strict(new_block)
    if new is None:
        return False
    orig = _strict(block)
    allowed = set(_TASK_KEYS) | ({str(k) for k in orig} if orig is not None else set())
    if any(str(k) not in allowed for k in new):
        return False
    have = {str(k) for k in new}
    for line in block:
        m = _TASK_KEY_PREFIX_RE.match(line.lstrip())
        if m and m.group(1) not in have:
            return False
    return True


def _values_ok(r: TaskRead, check: TaskRead, new_block: list[str]) -> bool:
    """Every value the console showed before is what it shows now, and what a strict parse of the
    new frontmatter holds."""
    for k in _TASK_KEYS:
        if _norm(r.fm.get(k)) != _norm(check.fm.get(k)):
            return False
    new = _strict(new_block)
    if new is None:
        return False
    return all(str(k) in r.fm and _norm(r.fm[str(k)]) == _norm(v) for k, v in new.items())


_MISSING = object()


def _empty(v: Any) -> bool:
    """The three spellings of "nothing" for a task key: null (`~`, `null`, a blank value), "" and []."""
    return v is None or v == "" or v == []


def _same(a: Any, b: Any) -> bool:
    """Two values of a task key are the same when both are empty, or when they are the same type and
    value (the integer 5 and the text "5" are NOT the same here: see `_as_text`)."""
    return (_empty(a) and _empty(b)) or (type(a) is type(b) and repr(a) == repr(b))


def _resolves(text: str, old: Any) -> bool:
    """YAML (the console's loader) reads `text` as exactly `old`: the same type and the same value.
    True and `true`, `yes`, `1_000`, `0x1F` and `1.0` all go through this one test."""
    try:
        v = _load(text)
    except Exception:  # noqa: BLE001 (the loader raises ValueError and friends, not only YAMLError)
        return False
    return type(v) is type(old) and repr(v) == repr(old)


def _scalar(old: Any) -> bool:
    """A number or a boolean: the non-text values YAML makes of a plain scalar."""
    return isinstance(old, (bool, int, float))


def _cut(old: Any, written: str, raw: str) -> bool:
    """YAML ended a plain scalar at a ` #` comment (`old` is the value it kept: text, or a number or
    boolean made of the text before the comment); `written` is that text with exactly the comment text
    put back: `raw`, the line's own text."""
    if written != raw:
        return False
    if isinstance(old, str):
        return written.startswith(old) and re.fullmatch(r"[ \t]+#.*", written[len(old):]) is not None
    m = re.search(r"[ \t]+#", written)
    return _scalar(old) and m is not None and _resolves(written[: m.start()], old)


def _as_text(old: Any, new: Any, raw: Any) -> bool:
    """A number or boolean YAML read, written as the text of its line (`true` -> "true", `0x1F` -> "0x1F"):
    the one type change the repair makes, and only to a value YAML resolves from exactly that text."""
    return _scalar(old) and isinstance(new, str) and new == raw and _resolves(raw, old)


def _restored(old: Any, new: Any, raw: Any) -> bool:
    """The changes the repair may make to a value YAML read: each scalar, or each item of a list, is
    the same, or has the comment YAML cut off back in it, or is a number or boolean written as its text."""
    def one(o: Any, n: Any, r: Any) -> bool:
        return _same(o, n) or _cut(o, n, r) or _as_text(o, n, r)

    if isinstance(raw, list):
        if not (isinstance(old, list) and isinstance(new, list) and len(old) == len(new) == len(raw)):
            return False
        return all(one(o, n, r) for o, n, r in zip(old, new, raw) if isinstance(n, str))
    return isinstance(new, str) and not isinstance(old, (list, dict)) and one(old, new, raw)


def _title_from_text(ov: Any, nv: Any, raws: dict[str, Any]) -> bool:
    """An empty title (blank, `~`, `null`, or a value that is all `#` comment) taken from the text the
    human wrote after the `#`; the heading case is handled by the caller."""
    raw = raws.get("title")
    return _empty(ov) and isinstance(raw, str) and raw.startswith("#") and nv == raw


def _value_backstop(r: TaskRead, block: list[str], new_block: list[str], raws: dict[str, Any]) -> str | None:
    """When the original frontmatter loads as YAML: the key whose value would change, or None.
    Every top-level key of the new frontmatter must hold the value YAML read in the original (None, ""
    and [] are one value for a task key; a date stays text under the console's loader), except
    (i) a rewritten key whose ` #` comment YAML had cut off gets exactly that comment text back,
    (ii) a title that was empty or missing takes the body's heading, or the comment text it was written
    as, and (iii) a number or boolean of a rewritten key is written as the text of its line. An impossible
    date needs no exception: it is text under the console's loader before and after. A file that does not
    load has no YAML values to compare, and gets only the console-value check. Linear in the keys: both
    sides are indexed once."""
    old = _strict(block)
    if old is None:
        return None
    new = _strict(new_block)
    if new is None:
        return "?"
    had: dict[str, Any] = {}
    for k, v in old.items():
        had.setdefault(str(k), v)
    now: dict[str, Any] = {}
    for k, v in new.items():
        now.setdefault(str(k), v)
    for k, nv in now.items():
        if k not in had:
            if not (k == "title" and r.heading and nv == r.recovered.get("title")):
                return k
    for sk, ov in had.items():
        nv = now.get(sk, _MISSING)
        if nv is _MISSING:
            return sk
        if sk not in _TASK_KEYS:
            if ov != nv:
                return sk
            continue
        if _same(ov, nv):
            continue
        if sk == "title" and _empty(ov) and ((r.heading and nv == r.recovered.get("title")) or _title_from_text(ov, nv, raws)):
            continue
        if sk in raws and _restored(ov, nv, raws[sk]):
            continue
        return sk
    return None


def _words_per_key_ok(r: TaskRead, check: TaskRead, span_tokens: dict[str, list[str]]) -> bool:
    """Against the ORIGINAL words of each rewritten key, not only the reader's own recovery."""
    for k in r.bad_keys:
        if not (_is_subsequence(r.orig_tokens.get(k, []), _tokens(check.fm.get(k)))
                and _is_subsequence(span_tokens.get(k, []), _tokens(check.fm.get(k)))):
            return False
    return True


def _words_whole_ok(lines: list[str], new_pieces: list[tuple[str, bool]]) -> bool:
    """The whole file, from the opening fence on: no word may be lost, whatever the reader said.
    `new_pieces` is the new file as (line, written by the repair) pairs; only the lines the repair
    wrote are decoded, because `\\u00a0` on any other line is text, not a character."""
    have: list[str] = []
    for text, written in new_pieces:
        have.extend(_file_tokens(text) if written else _tokens(text))
    return _is_subsequence(_tokens("\n".join(lines)), have)


def _refusal(check: str, what: str) -> str:
    """The one message every refusal by a guard uses: the check, then what would go wrong to which key."""
    return f'check "{check}": {what}; edit by hand'


def _key_culprit(block: list[str], new_block: list[str]) -> str:
    new = _strict(new_block) or {}
    orig = _strict(block)
    allowed = set(_TASK_KEYS) | ({str(k) for k in orig} if orig is not None else set())
    extra = next((str(k) for k in new if str(k) not in allowed), None)
    if extra is not None:
        return f'"{extra}"'
    have = {str(k) for k in new}
    for line in block:
        m = _TASK_KEY_PREFIX_RE.match(line.lstrip())
        if m and m.group(1) not in have:
            return f'"{m.group(1)}"'
    return "a key"


def _value_culprit(r: TaskRead, check: TaskRead, new_block: list[str]) -> str:
    for k in _TASK_KEYS:
        if _norm(r.fm.get(k)) != _norm(check.fm.get(k)):
            return f'"{k}"'
    new = _strict(new_block) or {}
    for k, v in new.items():
        if not (str(k) in r.fm and _norm(r.fm[str(k)]) == _norm(v)):
            return f'"{k}"'
    return "a key"


def _word_culprit(r: TaskRead, check: TaskRead, span_tokens: dict[str, list[str]]) -> str:
    for k in sorted(r.bad_keys):
        have = _tokens(check.fm.get(k))
        if not (_is_subsequence(r.orig_tokens.get(k, []), have) and _is_subsequence(span_tokens.get(k, []), have)):
            return f'"{k}"'
    return "a key"


def _file_word_culprit(spans: dict[str, tuple[int, int]], new_block: list[str], block: list[str]) -> str:
    """The rewritten key whose own words are not in the line written for it; else the file as a whole."""
    new = _strict(new_block) or {}
    for k, (a, end) in spans.items():
        if not _is_subsequence(_span_tokens(k, block, a, end), _tokens(new.get(k))):
            return f'"{k}"'
    return "the file"


def plan_repair(raw: str) -> tuple[str, str | None, list[str]]:
    """Return (status, new_text, warnings); status is 'ok', 'repair' or 'cannot'.
    `new_text` keeps the original line endings. Never raises: an unexpected error is 'cannot'
    with an "internal error" message."""
    try:
        return _plan(raw)
    except Exception as e:  # noqa: BLE001 (a repair tool must not die on one odd file)
        why = (f"{type(e).__name__}: {e}").splitlines()[0][:200]
        return "cannot", None, [f"internal error: {why}"]


class _Decision(NamedTuple):
    verdict: str  # "ok" (nothing to do), "repair" (--apply rewrites it) or "cannot"
    reason: str  # the warnings, plus why a file cannot be repaired; "" for "ok"
    data: bytes  # the file's bytes as read
    new_text: str | None  # the file's new text when the verdict is "repair"
    ident: "tuple[int, int] | None" = None  # (st_dev, st_ino) of the file the decision was made on
    cleared: tuple = ()  # the warnings a "repair" verdict clears (the reader's warnings of the file as read)
    fd: "int | None" = None  # read-only descriptor of that file, held open for `--apply` (the caller closes it)


# BSD/macOS file flags that make a file unreplaceable or append-only (0 where the platform has none).
_LOCKED_FLAGS = sum(getattr(stat, n, 0) for n in ("UF_IMMUTABLE", "SF_IMMUTABLE", "UF_APPEND", "SF_APPEND"))
# A symlinked task file is read only to find out whether it needs anything; a larger target is not read.
_LINK_READ_LIMIT = 8 << 20


def _cannot_write(md: Path, st: os.stat_result) -> str | None:
    """Why `--apply` could not replace this regular file, known before writing, or None. What cannot be
    known beforehand is a full disk, an I/O error, an ACL or a Linux file attribute."""
    if st.st_nlink > 1:
        return f"hard-linked ({st.st_nlink} names share this file and a repair would split them); edit by hand"
    if getattr(st, "st_flags", 0) & _LOCKED_FLAGS:
        return "the file is immutable or append-only (file flags)"
    parent = md.parent
    name = parent.name or str(parent)
    if not os.access(parent, os.W_OK | os.X_OK):
        return f"the directory {name}/ is not writable"
    try:
        pst = os.stat(parent)
    except OSError:
        return f"the directory {name}/ cannot be examined"
    if getattr(pst, "st_flags", 0) & _LOCKED_FLAGS:
        return f"the directory {name}/ is immutable or append-only (file flags): a file in it cannot be replaced"
    euid = os.geteuid()
    # In a sticky directory only the file's owner, the directory's owner and root may rename over a file.
    if pst.st_mode & stat.S_ISVTX and st.st_uid != euid and pst.st_uid != euid and euid != 0:
        return f"the directory {name}/ is sticky and the file belongs to another user: it cannot be replaced"
    return None


def _read_held(md: Path, lst: os.stat_result) -> "tuple[int, bytes]":
    """Open the regular file `lst` was taken of (no link followed, never blocking), read its bytes from
    that descriptor and return (fd, bytes). The descriptor stays open: while it is, the file's inode
    cannot be freed, so (st_dev, st_ino) cannot be reused by another file and names this file for good.
    The caller closes it. Raises OSError (descriptor already closed) if the path no longer names `lst`'s file."""
    fd = os.open(md, os.O_RDONLY | getattr(os, "O_NONBLOCK", 0) | getattr(os, "O_NOFOLLOW", 0))
    try:
        st = os.fstat(fd)
        if not stat.S_ISREG(st.st_mode) or (st.st_dev, st.st_ino) != (lst.st_dev, lst.st_ino):
            raise OSError(0, "the file changed while it was opened")
        chunks = []
        while True:
            chunk = os.read(fd, 1 << 20)
            if not chunk:
                break
            chunks.append(chunk)
        return fd, b"".join(chunks)
    except BaseException:
        os.close(fd)
        raise


def _decide(md: Path, hold: bool = False) -> _Decision:
    """The one decision about a task file on disk, shared by `--apply` and the task page: look at the
    path first (lstat), read the raw bytes of a regular file only, plan the repair on them, and refuse
    what `--apply` could not replace: a symlink, a hard link, an immutable file, an unwritable
    directory. Never raises and never blocks. With `hold` (only `--apply` writes) a "repair" verdict
    carries the open descriptor of the file it was made on (`fd`) and the caller must close it; every
    other verdict closes it before returning."""
    d = _decide_on(md, hold)
    if d.fd is not None and d.verdict != "repair":
        os.close(d.fd)
        d = d._replace(fd=None)
    return d


def _decide_on(md: Path, hold: bool) -> _Decision:
    fd: "int | None" = None
    try:
        lst = os.lstat(md)
        link = stat.S_ISLNK(lst.st_mode)
        if not link and not stat.S_ISREG(lst.st_mode):
            return _Decision("cannot", "not a regular file", b"", None)
        if hold and not link:
            fd, data = _read_held(md, lst)
        else:
            data = read_regular_bytes(md, follow=link, limit=_LINK_READ_LIMIT if link else None)[0]
        raw = data.decode("utf-8")
    except (OSError, UnicodeDecodeError):
        if fd is not None:
            os.close(fd)
        return _Decision("cannot", "unreadable file", b"", None)
    try:
        return _decide_rest(md, lst, link, data, raw, fd)
    except BaseException:
        if fd is not None:
            os.close(fd)
        raise


def _decide_rest(md: Path, lst: os.stat_result, link: bool, data: bytes, raw: str, fd: "int | None") -> _Decision:
    status, new_text, warnings = plan_repair(raw)
    reason = "; ".join(warnings)
    if status == "ok":
        return _Decision("ok", "", data, None, fd=fd)
    if status == "cannot":
        return _Decision("cannot", reason, data, None, fd=fd)
    if link:
        return _Decision("cannot", "symlink (a link is never replaced by a regular file)", data, None, fd=fd)
    blocked = _cannot_write(md, lst)
    if blocked:
        return _Decision("cannot", f"{reason}; {blocked}" if reason else blocked, data, None, fd=fd)
    return _Decision("repair", reason, data, new_text, (lst.st_dev, lst.st_ino), tuple(warnings), fd)


def decide(path: "Path | str") -> tuple[str, str, list[str]]:
    """(verdict, reason, cleared) for the task file at `path`: "ok", "repair" or "cannot", why, and for
    "repair" the list of warnings the repair clears ([] otherwise). `--apply` and the task page both call
    this, so what the page advises is what `--apply` does with the file, bar a write error found only at
    write time (a full disk, an I/O error, an ACL or a Linux file attribute). Never raises."""
    d = _decide(Path(path))
    return d.verdict, d.reason, list(d.cleared)


def _plan(raw: str) -> tuple[str, str | None, list[str]]:
    r = analyze_task_text(raw)
    if not r.warnings:
        return "ok", None, []
    if "no frontmatter" in r.warnings or "unreadable file" in r.warnings or _is_lossy(r):
        return "cannot", None, r.warnings
    if r.foreign:
        # Only the old template's comment, blank space and a BOM may be dropped before the fence: this is somebody's text.
        return "cannot", None, [*r.warnings, _refusal(
            "preamble", f'text before the opening fence would be dropped: "{r.foreign}"')]
    eol = _eol(raw)
    if eol is None:
        return "cannot", None, [*r.warnings, "mixed line endings"]

    lines = r.text[r.fence_at :].split("\n")
    split = _split_fence("\n".join(lines))
    if split is None:
        return "cannot", None, r.warnings
    block, _ = split
    close = 1 + len(block)  # index of the closing fence line
    line_of = r.text[: r.fence_at].count("\n") + 2  # file line number of block[0]

    # One grammar for every file, whether it parses or not (see `_fit`): the repair reads the key's
    # own lines, never a value YAML made of them. A key that does not fit is for hand editing.
    groups = _key_groups(block)
    flagged = [g for g in groups if g.key in r.bad_keys and g.key in r.recovered]
    replace: dict[int, tuple[int, str]] = {}  # first line of a key -> (end exclusive, new line)
    raws: dict[str, Any] = {}
    spans: dict[str, tuple[int, int]] = {}
    nullish: set[str] = set()  # an empty title (`null`, `~`) that the heading replaces: its spelling is no word
    words_lines = list(lines)  # the original lines the whole-file word check compares against
    for g in flagged:
        if g.key in spans:
            continue
        if g.key not in _TASK_KEYS:
            return "cannot", None, [*r.warnings, f'"{g.key}" on line {line_of + g.a} is not a task key; edit by hand']
        if g.rest and g.rest[0] not in " \t":
            # `state::` is the key `state:` to YAML, `title:x` is no key: the first colon is not a separator
            # YAML sees, so splitting there would guess a key set. Never guess a key set.
            return "cannot", None, [*r.warnings, _refusal(
                "keys", f'the line {line_of + g.a} ("{block[g.a][:40]}") is not a key line YAML would split at the first '
                f'colon, so the key "{g.key}" cannot be told from the text')]
        fit = _fit(g, block, line_of)
        if isinstance(fit, str) and _strict(block) is None:
            fit = _literal(g, block, line_of) or fit
        if isinstance(fit, str):
            return "cannot", None, [*r.warnings, f'check "grammar": {fit}']
        value = r.recovered[g.key] if g.key == "title" and r.heading else fit.value
        replace[g.a] = (fit.end, f"{g.key}: {_encode(value)}")
        raws[g.key] = fit.raw
        spans[g.key] = (g.a, fit.end)
        if g.key == "title" and r.heading and isinstance(fit.raw, str) and fit.raw in _NULL_SPELLINGS:
            nullish.add("title")
            words_lines[1 + g.a] = "title:"
    if _has_props(block, groups):
        # An anchor, an alias or a tag makes a key's YAML value something other than its text.
        where = next((g.key for g in groups if _has_props(block[g.a : g.b], [])), None)
        at = f' (in "{where}")' if where else ""
        return "cannot", None, [*r.warnings, f'check "props": the frontmatter has an anchor, an alias or an explicit tag{at}; edit by hand']
    placed = set(spans)

    new_block: list[str] = []
    wrote: list[bool] = []  # parallel to new_block: the repair wrote this line
    i = 0
    while i < len(block):
        if i in replace:
            end, line = replace[i]
            new_block.append(line)
            wrote.append(True)
            i = end
        else:
            new_block.append(block[i])
            wrote.append(False)
            i += 1
    for key in sorted(r.bad_keys - placed):  # e.g. a title taken from the "# " heading
        if key in r.recovered:
            new_block.insert(0, f"{key}: {_encode(r.recovered[key])}")
            wrote.insert(0, True)

    new_text = "\n".join([lines[0], *new_block, *lines[close:]])  # the fence line keeps its bytes
    pieces = [(lines[0], False), *zip(new_block, wrote), *((x, False) for x in lines[close:])]

    check = analyze_task_text(new_text)
    span_tokens = {k: ([] if k in nullish else _span_tokens(k, block, a, end)) for k, (a, end) in spans.items()}
    changed_key = _value_backstop(r, block, new_block, raws)
    rewritten = ", ".join(f'"{k}"' for k in spans) or "the frontmatter"
    # Each guard in order; the first that fails refuses the file, and the message names the guard and the key.
    steps = [
        (lambda: _strict_ok(new_block), lambda: _refusal(
            "strict", f"the new frontmatter after rewriting {rewritten} would not load with a standard YAML loader")),
        (lambda: _clean_ok(check), lambda: _refusal(
            "clean", f"the reader would still warn after rewriting {rewritten}: {check.warnings[0]}")),
        (lambda: _keys_ok(r, block, new_block), lambda: _refusal(
            "keys", f"the key {_key_culprit(block, new_block)} would be added or lost")),
        (lambda: _values_ok(r, check, new_block), lambda: _refusal(
            "values", f"the value of {_value_culprit(r, check, new_block)} the console shows would change")),
        (lambda: not changed_key, lambda: _refusal(
            "backstop", f'the value of "{changed_key}" would change')),
        (lambda: _words_per_key_ok(r, check, span_tokens), lambda: _refusal(
            "words", f"a word of {_word_culprit(r, check, span_tokens)}'s own lines would be lost")),
        (lambda: _words_whole_ok(words_lines, pieces), lambda: _refusal(
            "file-words", f"a word of the original file would be lost ({_file_word_culprit(spans, new_block, block)})")),
    ]
    refused = next((why() for ok, why in steps if not ok()), None)
    if refused:
        return "cannot", None, [*r.warnings, refused]
    return "repair", new_text.replace("\n", eol), r.warnings


def _task_files(root: Path) -> tuple[list[Path], list[str]]:
    """The task files under tasks/ and tasks/closed/, and a message for each directory that exists but
    cannot be listed (a directory that does not exist is not an error)."""
    tasks = root / "tasks"
    out: list[Path] = []
    errors: list[str] = []
    for d in (tasks, tasks / "closed"):
        rel = d.relative_to(root).as_posix()
        try:
            st = os.stat(d)
        except (FileNotFoundError, NotADirectoryError):
            continue
        except OSError as e:
            errors.append(f"cannot list {rel}/: {e.strerror or type(e).__name__}")
            continue
        if not stat.S_ISDIR(st.st_mode):
            continue
        try:
            names = sorted(os.listdir(d))
        except OSError as e:
            errors.append(f"cannot list {rel}/: {e.strerror or type(e).__name__}")
            continue
        out.extend(d / n for n in names if n[:1] in tuple("0123456789") and n.endswith(".md"))
    return out, errors


def _drop(tmp: Path) -> bool:
    """Remove this run's own temp file. Never raises. A failure is not swallowed: it is printed with the
    temp file's path, and False is returned so the caller counts the file as one that cannot be repaired."""
    try:
        tmp.unlink()
    except FileNotFoundError:
        return True
    except OSError as e:
        print(f"left temp file {tmp}: {e.strerror or type(e).__name__}")
        return False
    return True


def _unchanged(md: Path, d: _Decision) -> bool:
    """The file at `md` is still the regular, unlinked file the decision was made on, with the same bytes."""
    if read_regular_bytes(md, follow=False)[0] != d.data:
        return False
    cur = os.lstat(md)  # last look before the replace
    if d.fd is not None:  # the descriptor held since the decision names the decided file; the path must still name it
        held = os.fstat(d.fd)
        if (held.st_dev, held.st_ino) != d.ident:
            return False
    return stat.S_ISREG(cur.st_mode) and cur.st_nlink == 1 and (cur.st_dev, cur.st_ino) == d.ident


def _one_file(md: Path, rel: str, apply: bool) -> str:
    """Handle one task file; returns the counter it belongs to: "repaired", "pending", "cannot",
    "skipped", or "ok" when the file needs nothing."""
    d = _decide(md, hold=apply)
    if d.verdict == "ok":
        return "ok"
    if d.verdict == "cannot":
        print(f"cannot repair {rel}: {d.reason}")
        return "cannot"
    print(f"repair {rel}: {d.reason}")
    if d.fd is None:  # a dry run holds nothing
        return "pending"
    try:  # the decided file stays open until here: its inode cannot be freed and handed to another file
        return _write_one(md, rel, d)
    finally:
        os.close(d.fd)


def _write_one(md: Path, rel: str, d: _Decision) -> str:
    tmp: Path | None = None
    try:
        blocked = _cannot_write(md, os.lstat(md))  # the directory may have changed since `_decide`: no temp file then
        if blocked:
            print(f"cannot repair {rel}: {blocked}")
            return "cannot"
        fd, name = tempfile.mkstemp(dir=md.parent, prefix=md.name + ".", suffix=".tmp")  # O_EXCL: never an existing path
        tmp = Path(name)
        with os.fdopen(fd, "wb") as fh:
            fh.write((d.new_text or "").encode("utf-8"))
        mode = stat.S_IMODE(os.lstat(md).st_mode)
        try:
            same = _unchanged(md, d)  # someone edited, linked or replaced it since we read it
        except OSError:
            same = False
        if same:
            os.chmod(tmp, mode)  # keep the file's mode (0444 stays 0444)
            os.replace(tmp, md)
            tmp = None
    except OSError as e:
        print(f"cannot repair {rel}: could not write it ({e.strerror or type(e).__name__})")
        if tmp is not None:
            _drop(tmp)
        return "cannot"
    if tmp is not None:
        print(f"skipped {rel}: changed while repairing; run again")
        return "skipped" if _drop(tmp) else "cannot"
    return "repaired"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python3 -m ui.repair_tasks", description=__doc__.split("\n")[0])
    ap.add_argument("--apply", action="store_true", help="write the repairs (default is a dry run)")
    ap.add_argument("--root", type=Path, default=REPO_ROOT, help="repository root (default: this checkout)")
    args = ap.parse_args(argv)
    root: Path = args.root

    counts = {"ok": 0, "repaired": 0, "pending": 0, "cannot": 0, "skipped": 0}
    files, listing_errors = _task_files(root)
    for msg in listing_errors:
        print(msg)
        counts["cannot"] += 1
    for md in files:
        rel = md.relative_to(root).as_posix()
        try:
            counts[_one_file(md, rel, args.apply)] += 1
        except Exception as e:  # noqa: BLE001 (one odd file must not stop the run or its summary)
            why = (f"{type(e).__name__}: {e}").splitlines()[0][:200]
            print(f"cannot repair {rel}: internal error: {why}")
            counts["cannot"] += 1
    repaired, pending, cannot, skipped = counts["repaired"], counts["pending"], counts["cannot"], counts["skipped"]

    if args.apply:
        print(f"{repaired} repaired, {cannot} cannot repair, {skipped} skipped")
    else:
        print(f"{pending} to repair, {cannot} cannot repair (dry run; add --apply to write)")
    if cannot or skipped:
        return 1
    return 3 if pending else 0


if __name__ == "__main__":
    sys.exit(main())
