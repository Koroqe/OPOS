"""`python3 -m ui.repair_tasks`: dry run, apply, idempotence, and refusing what it cannot fix."""

import contextlib
import io
import json
import os
import re
import stat
import sys
import tempfile
import threading
import types
import unittest
from pathlib import Path
from unittest import mock

from ui.data import _key_groups, analyze_task_text, parse_tasks
import ui.data as data_mod
import ui.repair_tasks as repair_mod
from ui.repair_tasks import decide, main

# The comment the old shared/templates/TASK.md.tmpl opened with (verbatim from its git history, 8be2f3e).
OLD_COMMENT = (
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

TAIL = (
    "owner: chief-of-staff\n"
    "depts: [company, rnd]\n"
    "state: active\n"
    "created: 2026-10-01\n"
    "completed:\n"
    "success_criteria: [one, two]\n"
    "deadline:\n"
    "related_skills: [task-register]\n"
)
BODY = "\n# Heading text\n\n## Goal\n\nSome goal: with a colon and a #hash.\n\ttabbed line\n"


def doc(title_line, tail=TAIL, lead=""):
    return f"{lead}---\nissue_number: {{n}}\n{title_line}\n{tail}---\n{BODY}"


FIXTURES = {
    1: (doc('title: "Plain title"', lead=OLD_COMMENT + "\n\n"), "Plain title"),
    2: (doc('title: "Plain title"', lead="\n"), "Plain title"),
    3: (doc("title: Docs: set up a sample page"), "Docs: set up a sample page"),
    4: (doc("title: Plain title", tail=TAIL.replace("[one, two]", "[one, two in the #12 format, three]")),
        "Plain title"),
    5: (doc("title: Fix the widget #12"), "Fix the widget #12"),
    6: (f"---\nissue_number: {{n}}\n{TAIL}---\n{BODY}", "Heading text"),
}
GOOD = doc('title: "Already: fine #1"')
UNFIXABLE = "Just text, no frontmatter.\n"


def run(root, *args):
    out = io.StringIO()
    with contextlib.redirect_stdout(out):
        code = main(["--root", str(root), *args])
    return code, out.getvalue()


class TestRepairTasks(unittest.TestCase):
    def setUp(self):
        self._td = tempfile.TemporaryDirectory()
        self.addCleanup(self._td.cleanup)
        self.root = Path(self._td.name)
        (self.root / "tasks" / "closed").mkdir(parents=True)

    def put(self, name, text, closed=False):
        p = self.root / "tasks" / ("closed" if closed else "") / name
        p.write_bytes(text.encode("utf-8"))
        return p

    def put_broken(self):
        paths = {}
        for n, (text, _) in FIXTURES.items():
            paths[n] = self.put(f"{n}.md", text.replace("{n}", str(n)), closed=(n == 2))
        return paths

    def test_dry_run_changes_nothing_and_exits_3(self):
        paths = self.put_broken()
        before = {n: p.read_bytes() for n, p in paths.items()}
        code, out = run(self.root)
        self.assertEqual(code, 3)
        self.assertIn("repair tasks/3.md", out)
        self.assertIn("dry run", out)
        self.assertEqual({n: p.read_bytes() for n, p in paths.items()}, before)

    def test_apply_repairs_everything_and_keeps_the_body(self):
        paths = self.put_broken()
        code, _ = run(self.root, "--apply")
        self.assertEqual(code, 0)
        got = {t.issue_number: t for t in parse_tasks(repo_root=self.root)}
        # Written by hand, not taken from the reader.
        want_title = {
            1: "Plain title", 2: "Plain title", 3: "Docs: set up a sample page",
            4: "Plain title", 5: "Fix the widget #12", 6: "Heading text",
        }
        for n in FIXTURES:
            t = got[n]
            self.assertEqual(t.warnings, [], f"fixture {n}")
            self.assertEqual(t.title, want_title[n])
            self.assertEqual(t.owner, "chief-of-staff")
            self.assertEqual(t.depts, ["company", "rnd"])
            self.assertEqual(t.state, "completed" if n == 2 else "active")
            self.assertEqual(t.created, "2026-10-01")
            self.assertEqual(t.completed, "")
            self.assertEqual(t.related_skills, ["task-register"])
            raw = paths[n].read_bytes().decode("utf-8")
            self.assertTrue(raw.startswith("---\n"))
            self.assertTrue(raw.endswith(BODY), f"fixture {n} body changed")
        self.assertEqual(got[4].success_criteria, ["one", "two in the #12 format", "three"])
        for n in (1, 2, 3, 5, 6):
            self.assertEqual(got[n].success_criteria, ["one", "two"])

    def test_second_apply_has_nothing_to_do(self):
        self.put_broken()
        run(self.root, "--apply")
        code, out = run(self.root, "--apply")
        self.assertEqual(code, 0)
        self.assertNotIn("repair tasks", out)
        code, _ = run(self.root)
        self.assertEqual(code, 0)

    def test_well_formed_file_is_byte_identical(self):
        p = self.put("9.md", GOOD.replace("{n}", "9"))
        self.put_broken()
        before = p.read_bytes()
        run(self.root, "--apply")
        self.assertEqual(p.read_bytes(), before)

    def test_unrepairable_file_is_untouched_and_exit_is_1(self):
        p = self.put("8.md", UNFIXABLE)
        self.put_broken()
        code, out = run(self.root, "--apply")
        self.assertEqual(code, 1)
        self.assertIn("cannot repair tasks/8.md", out)
        self.assertEqual(p.read_bytes(), UNFIXABLE.encode("utf-8"))
        # The repairable files were still fixed.
        self.assertEqual(analyze_task_text((self.root / "tasks" / "3.md").read_text(encoding="utf-8")).warnings, [])


def wrap_tail(**over):
    out = []
    for line in TAIL.splitlines(keepends=True):
        out.append(over.get(line.split(":", 1)[0], line))
    return "".join(out)


EXTRA = "# a comment kept as is\n"

# (name, frontmatter text after issue_number, expected title, expected success_criteria)
# Every one of these is repaired. One grammar covers files that parse and files that do not: a plain
# one-line value, a one-line `[a, b]` list of plain items, or a block list of plain `- item` lines.
LOSSLESS = [
    ("plain title with a bracket inside", "title: Fix [Bug]: login\n" + TAIL, "Fix [Bug]: login", ["one", "two"]),
    ("plain list items", "title: Plain\n" + wrap_tail(success_criteria="success_criteria: [Ship A or B, C in #12]\n"),
     "Plain", ["Ship A or B", "C in #12"]),
    ("block item cut at hash (parses)", "title: Plain\n" + wrap_tail(success_criteria="success_criteria:\n  - Track #12\n  - Ship it (phase 2)\n"),
     "Plain", ["Track #12", "Ship it (phase 2)"]),
    ("block items at column 0 cut at hash (parses)", "title: Plain\n" + wrap_tail(success_criteria="success_criteria:\n- Track #12\n- Ship it\n"),
     "Plain", ["Track #12", "Ship it"]),
]

# Shapes that are NOT rewritten, with the words the message must hold: they do not fit the grammar, or YAML's
# own value for them would change.
HAND_EDIT = [
    ("comment on the key line, value on the next", "title: #77\n  follow-up on the widget\n" + TAIL, '"title" goes on past line'),
    ("comment after a closing quote", 'title: "Foo" #12 renamed\n' + TAIL, 'starts with """'),
    ("block item that YAML reads as a mapping", "title: Plain\n" + wrap_tail(success_criteria="success_criteria:\n  - Track #12\n  - Ship it (phase: 2)\n"),
     'not a plain "- item"'),
]


class TestRepairKeepsEveryWord(unittest.TestCase):
    def setUp(self):
        self._td = tempfile.TemporaryDirectory()
        self.addCleanup(self._td.cleanup)
        self.root = Path(self._td.name)
        (self.root / "tasks").mkdir()

    def path(self, n=5):
        return self.root / "tasks" / f"{n}.md"

    def test_every_shape_keeps_its_words_and_untouched_lines(self):
        for eol in ("\n", "\r\n"):
            for name, front, title, criteria in LOSSLESS:
                with self.subTest(shape=name, eol=eol):
                    text = f"---\nissue_number: 5\n{EXTRA}{front}---\n{BODY}".replace("\n", eol)
                    self.path().write_bytes(text.encode("utf-8"))
                    code, out = run(self.root, "--apply")
                    self.assertEqual(code, 0, out)
                    new = self.path().read_bytes().decode("utf-8")
                    t = parse_tasks(repo_root=self.root)[0]
                    self.assertEqual((t.warnings, t.title, t.success_criteria), ([], title, criteria))
                    # Line endings kept: no bare LF in a CRLF file, no CR in an LF file.
                    self.assertEqual(new.count("\r\n"), new.count("\n") if eol == "\r\n" else 0)
                    self.assertTrue(new.endswith(BODY.replace("\n", eol)))
                    # Lines of keys that were not rewritten are byte-identical.
                    for keep in ("issue_number: 5", "# a comment kept as is",
                                 "owner: chief-of-staff", "depts: [company, rnd]", "created: 2026-10-01"):
                        self.assertIn(keep + eol, new)

    def test_a_shape_outside_the_grammar_is_left_for_hand_editing_and_untouched(self):
        for name, front, words in HAND_EDIT:
            with self.subTest(shape=name):
                text = f"---\nissue_number: 5\n{EXTRA}{front}---\n{BODY}"
                self.path().write_bytes(text.encode("utf-8"))
                code, out = run(self.root, "--apply")
                self.assertEqual(code, 1, out)
                self.assertIn("cannot repair tasks/5.md", out)
                self.assertIn(words, out)
                self.assertEqual(self.path().read_bytes(), text.encode("utf-8"))

    def test_lossy_recovery_is_refused_and_the_file_is_untouched(self):
        text = f"---\nissue_number: 5\ntitle: Plain\n{wrap_tail(success_criteria='success_criteria: [alpha, beta] gamma' + chr(10))}---\n{BODY}"
        self.path().write_bytes(text.encode("utf-8"))
        code, out = run(self.root, "--apply")
        self.assertEqual(code, 1)
        self.assertIn("cannot repair tasks/5.md", out)
        self.assertIn("may not keep every word", out)
        self.assertEqual(self.path().read_bytes(), text.encode("utf-8"))
        # The reader still shows its best value, with the warning.
        t = parse_tasks(repo_root=self.root)[0]
        self.assertEqual(t.success_criteria, ["alpha", "beta"])

    def test_mixed_line_endings_are_refused(self):
        text = f"---\r\nissue_number: 5\ntitle: Docs: x\n{TAIL}---\n{BODY}"
        self.path().write_bytes(text.encode("utf-8"))
        code, out = run(self.root, "--apply")
        self.assertEqual(code, 1)
        self.assertEqual(self.path().read_bytes(), text.encode("utf-8"))

    def test_bom_is_removed_from_a_rewritten_file(self):
        self.path().write_bytes(b"\xef\xbb\xbf" + f"---\nissue_number: 5\ntitle: A: b\n{TAIL}---\n{BODY}".encode("utf-8"))
        run(self.root, "--apply")
        self.assertTrue(self.path().read_bytes().startswith(b"---\n"))

    def test_a_file_edited_between_read_and_replace_is_skipped(self):
        text = f"---\nissue_number: 5\ntitle: Docs: x\n{TAIL}---\n{BODY}"
        self.path().write_bytes(text.encode("utf-8"))
        real = repair_mod.plan_repair
        edited = (text + "\nEdited meanwhile.\n").encode("utf-8")

        def plan_then_edit(raw):
            result = real(raw)
            self.path().write_bytes(edited)
            return result

        with mock.patch.object(repair_mod, "plan_repair", plan_then_edit):
            code, out = run(self.root, "--apply")
        self.assertEqual(code, 1)
        self.assertIn("skipped tasks/5.md", out)
        self.assertEqual(self.path().read_bytes(), edited)
        self.assertEqual([p.name for p in (self.root / "tasks").iterdir()], ["5.md"])


def sc(value):
    return wrap_tail(success_criteria=value)


class TestRepairNeverDropsAWord(unittest.TestCase):
    """A repair that would lose a word, or write a file that does not parse, is refused."""

    def setUp(self):
        self._td = tempfile.TemporaryDirectory()
        self.addCleanup(self._td.cleanup)
        self.root = Path(self._td.name)
        (self.root / "tasks").mkdir()
        self.path = self.root / "tasks" / "5.md"

    def refused(self, front, why=None):
        text = f"---\nissue_number: 5\n{front}---\n{BODY}"
        self.path.write_bytes(text.encode("utf-8"))
        code, out = run(self.root, "--apply")
        self.assertEqual(code, 1, out)
        self.assertIn("cannot repair tasks/5.md", out)
        if why:
            self.assertIn(why, out)
        self.assertEqual(self.path.read_bytes(), text.encode("utf-8"))
        return out

    def test_bullet_list_with_an_unindented_text_line_is_refused(self):
        self.refused("title: Plain\n" + sc("success_criteria:\n- Alpha step and\nbeta continued\n- Track #12\n"),
                     "may not keep every word")

    def test_a_comment_line_with_words_inside_a_wrapped_title_is_refused(self):
        self.refused("title: Fix the widget\n  #12 regression\n  in parser\n" + TAIL, "may not keep every word")

    def test_a_trailing_indented_comment_with_words_in_a_file_that_parses_is_no_problem(self):
        text = f"---\nissue_number: 5\ntitle: Fix the widget\n  #12 regression\n{TAIL}---\n{BODY}"
        self.path.write_bytes(text.encode("utf-8"))
        code, out = run(self.root, "--apply")
        self.assertEqual((code, self.path.read_bytes()), (0, text.encode("utf-8")), out)

    def test_a_trailing_comment_with_words_stays_when_the_key_is_rewritten_for_another_reason(self):
        text = f"---\nissue_number: 5\ntitle: Fix the widget #12\n  # note words\n{TAIL}---\n{BODY}"
        self.path.write_bytes(text.encode("utf-8"))
        code, out = run(self.root, "--apply")
        self.assertEqual(code, 0, out)
        self.assertIn('title: "Fix the widget #12"\n  # note words\n', self.path.read_text(encoding="utf-8"))

    def test_a_comment_line_with_words_inside_a_flow_list_is_refused(self):
        self.refused("title: Plain\n" + sc("success_criteria: [alpha,\n  #12 beta,\n  gamma]\n"), "may not keep every word")

    def test_a_comment_line_with_words_between_block_items_is_refused(self):
        self.refused("title: Plain\n" + sc("success_criteria:\n  - alpha\n  # note: beta pending\n  - gamma #12\n"))

    def test_the_whole_file_word_check_catches_what_the_per_key_check_misses(self):
        # Simulate the old per-key blind spot: the reader claims no words were skipped.
        front = "title: Plain\n" + sc("success_criteria:\n- Alpha step and\nbeta continued\n- Track #12\n")
        text = f"---\nissue_number: 5\n{front}---\n{BODY}"
        with mock.patch("ui.data._raw_tokens", lambda g: []), mock.patch.object(repair_mod, "_words_per_key_ok", lambda *a: True):
            status, new, _ = repair_mod.plan_repair(text)
        self.assertEqual((status, new), ("cannot", None))

    def test_a_valid_empty_title_followed_by_bullets_is_refused_not_broken(self):
        # `title:` plus unindented bullets parses (title is a list); a rewritten title line would not.
        self.refused("title:\n- alpha\n- beta\n" + TAIL)

    def test_an_unindented_line_no_key_owns_is_refused(self):
        self.refused("title: Fix\nthe widget\n" + TAIL, "belongs to no key")

    def test_a_duplicate_key_is_refused(self):
        self.refused("title: A\ntitle: B: c\n" + TAIL, 'duplicate key "title"')

    def test_the_fence_line_keeps_its_bytes(self):
        text = f"---  \nissue_number: 5\ntitle: Docs: x\n{TAIL}---\n{BODY}"
        self.path.write_bytes(text.encode("utf-8"))
        code, out = run(self.root, "--apply")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.path.read_text(encoding="utf-8"),
                         f'---  \nissue_number: 5\ntitle: "Docs: x"\n{TAIL}---\n{BODY}')

    def test_an_escaped_control_character_does_not_glue_words_together(self):
        text = f"---\nissue_number: 5\ntitle: Docs: a\x7fb\n{TAIL}---\n{BODY}"
        self.path.write_bytes(text.encode("utf-8"))
        code, out = run(self.root, "--apply")
        self.assertEqual(code, 0, out)
        self.assertIn('title: "Docs: a\\u007fb"\n', self.path.read_text(encoding="utf-8"))

    def test_an_escape_written_in_an_untouched_line_is_not_decoded(self):
        # The text `\u00a0beta` on a line the repair does not write is the word `u00a0beta`; only the
        # lines the repair wrote are decoded when words are compared.
        text = front_text('title: foo: bar\nowner: "alpha\\u00a0beta"\n' + wrap_tail(owner=""))
        status, new, _ = repair_mod.plan_repair(text)
        self.assertEqual(status, "repair")
        self.assertIn('owner: "alpha\\u00a0beta"\n', new)


def front_text(front):
    return f"---\nissue_number: 5\n{front}---\n{BODY}"


class TestRepairWritesOnlySingleLineValuesInUnparseableFiles(unittest.TestCase):
    """In a file YAML cannot parse, the line-to-key mapping is a guess, so a flagged key is only
    rewritten when its whole value is on its key line. Any other shape is "cannot repair"."""

    def setUp(self):
        self._td = tempfile.TemporaryDirectory()
        self.addCleanup(self._td.cleanup)
        self.root = Path(self._td.name)
        (self.root / "tasks").mkdir()
        self.path = self.root / "tasks" / "5.md"

    def refused(self, front, *needles):
        text = front_text(front)
        self.path.write_bytes(text.encode("utf-8"))
        code, out = run(self.root, "--apply")
        self.assertEqual(code, 1, out)
        self.assertIn("cannot repair tasks/5.md", out)
        for n in needles:
            self.assertIn(n, out)
        self.assertEqual(self.path.read_bytes(), text.encode("utf-8"))

    def test_a_wrapped_title_is_refused_and_the_message_names_the_key_and_the_line(self):
        self.refused("title: Docs: set up\n  a sample page\n" + TAIL, '"title" goes on past line 3 (see line 4)')

    def test_a_wrapped_flow_list_is_refused(self):
        self.refused("title: Plain\n" + sc("success_criteria: [alpha,\n  beta in the #12 format, gamma]\n"),
                     '"success_criteria" goes on past line')

    def test_bullets_that_start_on_the_key_line_are_a_block_list(self):
        # `success_criteria: - first` then `- second`: the TASK.md template's "bulleted list" typed
        # after the key. The key line holds item 1.
        self.path.write_bytes(front_text("title: Plain\n" + sc("success_criteria: - alpha\n- beta #12\n")).encode("utf-8"))
        code, out = run(self.root, "--apply")
        self.assertEqual(code, 0, out)
        want = front_text("title: Plain\n" + sc('success_criteria: ["alpha", "beta #12"]\n'))
        self.assertEqual(self.path.read_text(encoding="utf-8"), want)

    def test_a_single_bullet_on_the_key_line_is_a_one_item_list(self):
        self.path.write_bytes(front_text("title: Plain\n" + sc("success_criteria: - alpha\n")).encode("utf-8"))
        code, out = run(self.root, "--apply")
        self.assertEqual(code, 0, out)
        self.assertIn('success_criteria: ["alpha"]\n', self.path.read_text(encoding="utf-8"))

    def test_bullets_on_the_key_line_still_need_every_item_plain(self):
        self.refused("title: Plain\n" + sc("success_criteria: - alpha\n- beta: gamma\n"), 'not a plain "- item"')
        self.refused("title: Plain\n" + sc("success_criteria: - alpha: x\n- beta\n"), 'not a plain "- item"')
        self.refused("title: Plain\n" + sc("success_criteria: - alpha\n  continued\n- beta\n"), 'not a plain "- item"')

    def test_an_unindented_continuation_is_refused(self):
        self.refused("title: Docs: set up\nanother line\n" + TAIL)

    def test_a_flow_list_that_is_never_closed_is_refused(self):
        self.refused("title: Docs: x\n" + sc("success_criteria: [alpha,\nstate: paused\n"), "never closed")

    def test_an_unindented_word_line_in_a_wrapped_list_is_refused(self):
        self.refused("title: Docs: x\n" + sc("success_criteria: [alpha,\nfoo: beta]\n"), '"success_criteria" goes on past line')

    def test_an_indented_task_key_under_a_title_is_refused(self):
        self.refused("title: Docs: x\n  depts: [rnd, ops]\n" + wrap_tail(depts=""), 'indented under "title"')

    def test_a_tab_indented_task_key_under_an_owner_is_refused(self):
        self.refused("title: Docs: x\nowner: chief-of-staff\n\tstate: paused\n" + wrap_tail(owner="", state=""),
                     'indented under "owner"')

    def test_a_fence_inside_an_open_list_is_refused(self):
        text = "---\nissue_number: 5\ntitle: Docs: x\nsuccess_criteria: [alpha,\n---\n beta]\n"
        self.path.write_bytes(text.encode("utf-8"))
        code, out = run(self.root, "--apply")
        self.assertEqual(code, 1, out)
        self.assertEqual(self.path.read_bytes(), text.encode("utf-8"))

    def test_a_non_task_key_in_a_file_that_does_not_parse_is_refused(self):
        # The strict parse of the original is not there to vouch for it.
        self.refused("title: Docs: x\nextra_key: {a: 1}\n" + TAIL, "unquoted value in")

    def test_a_non_task_key_in_a_file_that_parses_is_kept(self):
        front = "title: Fix the widget #12\nextra_key: {a: 1}\n" + TAIL
        self.path.write_bytes(front_text(front).encode("utf-8"))
        code, out = run(self.root, "--apply")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.path.read_text(encoding="utf-8"),
                         front_text('title: "Fix the widget #12"\nextra_key: {a: 1}\n' + TAIL))

    def test_a_flow_list_wrapped_in_a_file_that_parses_is_left_for_hand_editing(self):
        # Valid YAML: the second item is a one-pair mapping, and the list is on two lines. Neither fits.
        self.refused("title: Plain\n" + sc("success_criteria: [alpha,\nfoo: beta]\n"), '"success_criteria" goes on past line')

    def test_a_block_list_in_a_file_that_parses_gets_its_lines_and_leaves_a_trailing_comment_alone(self):
        front = ("title: Plain\n"
                 + sc("success_criteria:\n  - Track #12\n  - Ship it (phase 2)\n# column-0 note\n"))
        self.path.write_bytes(front_text(front).encode("utf-8"))
        code, out = run(self.root, "--apply")
        self.assertEqual(code, 0, out)
        want = "title: Plain\n" + sc('success_criteria: ["Track #12", "Ship it (phase 2)"]\n# column-0 note\n')
        self.assertEqual(self.path.read_text(encoding="utf-8"), front_text(want))

    def test_node_marks_leave_an_indented_comment_after_the_value_alone(self):
        front = "title: Fix the widget #12\n  #\n" + TAIL
        self.path.write_bytes(front_text(front).encode("utf-8"))
        code, out = run(self.root, "--apply")
        self.assertEqual(code, 0, out)
        self.assertEqual(self.path.read_text(encoding="utf-8"),
                         front_text('title: "Fix the widget #12"\n  #\n' + TAIL))

    def test_a_value_on_the_line_after_a_key_line_comment_is_left_for_hand_editing(self):
        self.refused("title: #77\n  follow-up on the widget\n" + TAIL, '"title" goes on past line')

    def test_a_line_break_character_in_a_quoted_title_is_left_for_hand_editing(self):
        self.refused('title: "a\u2028b" #12 renamed\n' + TAIL, "holds a line-break character")

    # The allow-list. The file does not parse (`created: x: y`), so the lines after a key line
    # could be part of its value as YAML reads it; a value is rewritten only when it is plain text
    # on its key line (or, for a list key, a one-line list of plain items).
    def broken(self, first, **over):
        return first + wrap_tail(created="created: x: y\n", **over)

    def test_a_double_quote_that_is_not_closed_on_its_line_is_refused(self):
        self.refused(self.broken('title: "alpha: beta\n', owner='owner: gamma"\n'))

    def test_a_single_quote_that_is_not_closed_on_its_line_is_refused(self):
        self.refused(self.broken("title: 'alpha: beta\n", owner="owner: gamma'\n"))

    def test_a_square_bracket_that_is_not_closed_on_a_title_line_is_refused(self):
        self.refused(self.broken("title: [alpha,\n", owner="owner: beta]\n"), '"title" on line 3 has a value that starts with "["')

    def test_a_curly_bracket_that_is_not_closed_on_a_title_line_is_refused(self):
        self.refused(self.broken("title: {alpha,\n", owner="owner: beta}\n"), '"title" on line 3 has a value that starts with "{"')

    def test_an_anchor_or_tag_in_front_of_an_unclosed_quote_or_bracket_is_refused(self):
        for first, over in (
            ('title: !!str "alpha: beta\n', {"owner": 'owner: gamma"\n'}),
            ("title: &t 'alpha: beta\n", {"owner": "owner: gamma'\n"}),
            ("title: !x [alpha,\n", {"owner": "owner: beta]\n"}),
            ("title: T\n", {"depts": "depts: &d [alpha,\n", "owner": "owner: beta]\n"}),
        ):
            with self.subTest(first=first):
                self.refused(self.broken(first, **over))

    def test_an_anchor_or_tag_before_any_value_is_refused(self):
        for first in ("title: &a foo: bar\n", "title: !!str foo: bar\n", "title: *a foo: bar\n"):
            with self.subTest(first=first):
                self.refused(self.broken(first), 'check "props"', "(in \"title\")")

    def test_a_u2028_in_the_key_line_is_refused(self):
        self.refused(self.broken("title: foo: bar owner: baz\n"), "line-break character")

    def test_a_u0085_in_the_key_line_is_refused(self):
        self.refused(self.broken("title: foo: bar\x85state: paused\n"), "line-break character")

    def test_a_u2029_in_a_quoted_part_of_the_key_line_is_refused(self):
        self.refused(self.broken('title: foo: "bar baz"\n'), "line-break character")

    def test_a_tab_before_the_value_is_refused(self):
        self.refused(self.broken("title:\tfoo: bar\n"), "tab before its value")
        self.refused(self.broken("title: \tfoo: bar\n"), "tab before its value")

    def test_a_value_that_starts_with_an_indicator_is_taken_literally_when_its_own_line_does_not_parse(self):
        # The file does not parse. `title: <indicator>... : ...` does not parse on its own either, so YAML
        # holds no other reading of the line than its text, and the repair keeps that text.
        for start in ('"', "'", "|", ">", "%", "@", "`", "\\", "- a", "? a", ": a", ",a", "#a", "-", "?", ":"):
            with self.subTest(start=start):
                if start in "\"'":
                    value = f'{start}alpha{start} beta: gamma'
                elif len(start) == 1 and start not in "-?:":
                    value = f"{start}alpha: beta"
                else:
                    value = f"{start} beta: gamma"
                status, new, _ = repair_mod.plan_repair(front_text(self.broken(f"title: {value}\n")))
                self.assertEqual(status, "repair", value)
                self.assertIn(f"\ntitle: {json.dumps(value, ensure_ascii=False)}\n", new)

    def test_ordinary_github_titles_that_start_with_an_indicator_are_repaired_in_a_file_that_does_not_parse(self):
        for value in ("[Bug] login fails", "[RFC] new importer", "`code` span in a title", "@alice asks for a fix",
                      "*Draft* plan", "&co notes", "%done report", "{x} y", "- dashed title", "? why does this fail"):
            with self.subTest(value=value):
                status, new, warnings = repair_mod.plan_repair(front_text(self.broken(f"title: {value}\n")))
                if value.startswith("&"):  # an anchor token: YAML reads a different value; hand editing
                    self.assertEqual(status, "cannot", value)
                    continue
                self.assertEqual(status, "repair", (value, warnings))
                self.assertIn(f"\ntitle: {json.dumps(value, ensure_ascii=False)}\n", new)

    def test_a_value_that_starts_with_an_indicator_is_refused_where_yaml_has_another_reading(self):
        # An opener the line never closes, an anchor, an alias or a tag: YAML does read these.
        for start in ("[", "{"):
            with self.subTest(start=start):
                self.refused(self.broken(f"title: {start}alpha: beta\n"), '"title" on line 3 has a value that starts with')
        for start in ("!", "&", "*"):
            with self.subTest(start=start):
                self.refused(self.broken(f"title: {start}alpha: beta\n"), 'check "props"')

    def test_a_key_line_that_parses_on_its_own_is_not_taken_literally(self):
        # `&a b #c` parses as an anchored scalar: its YAML value is "b", not the line's text. It is left
        # for hand editing by the grammar itself, before any later check can be asked about it.
        self.refused(self.broken("title: &a b #c\n"), 'check "grammar"', 'starts with "&"')
        # A list key never takes the literal rule: its value is a list or a plain string.
        self.refused(self.broken("title: T\n", depts="depts: @core\n"), 'check "grammar"')

    def test_a_dash_or_question_mark_that_is_part_of_a_word_is_plain(self):
        for first in ("title: -alpha: beta\n", "title: ?alpha: beta\n", "title: :alpha: beta\n", "title: a-b: c? d\n"):
            with self.subTest(first=first):
                self.assertEqual(repair_mod.plan_repair(front_text(self.broken(first)))[0], "repair")

    def test_a_bracket_value_that_closes_on_its_line_is_refused_for_a_title(self):
        self.refused(self.broken("title: [alpha] #12\n"), '"title" on line 3 has a value that starts with "["')

    def list_raw(self, value, key="depts"):
        return front_text("title: T\n" + wrap_tail(created="created: x: y\n", **{key: f"{key}: {value}\n"}))

    def test_a_one_line_list_of_plain_items_is_repaired_for_a_list_key(self):
        for value, want in (
            ("[alpha, beta: gamma]", None),
            ("[alpha, beta # note]", '["alpha", "beta # note"]'),
            ("[alpha, beta #1, gamma] # kept", None),
        ):
            with self.subTest(value=value):
                raw = self.list_raw(value, "related_skills")
                self.assertIn("related_skills", analyze_task_text(raw).bad_keys)
                status, new, _ = repair_mod.plan_repair(raw)
                if want is None:
                    self.assertEqual(status, "cannot")  # the trailing comment's words would be lost
                else:
                    self.assertEqual(status, "repair")
                    self.assertIn(f"related_skills: {want}\n", new)

    def test_a_list_that_is_not_a_plain_one_line_list_is_refused_for_a_list_key(self):
        for value in ('["a", b # c]', "['a', b # c]", "[a, [b] # c]", "[a, {b: 1} # c]", "[a, b: c] d", "[a, b: c",
                      "[a, - b # c]", "[a, #b]", "[a: 1, b] # c]", "[&x a # c]", "[!t a # c]", "[a, *b # c]",
                      "{a, b: c}", "[a: 1, b]]", "[a: 1, b\u2028c]"):
            with self.subTest(value=value):
                raw = self.list_raw(value)
                self.assertEqual(repair_mod.plan_repair(raw)[0], "cannot", value)

    def test_a_flow_list_is_not_allowed_for_a_key_that_is_not_a_list_key(self):
        self.refused(self.broken("title: T\n", owner="owner: [alpha, beta]\n"), '"owner" on line 4')

    def test_the_message_names_the_real_continuation_line(self):
        self.refused("title: Docs: set up\n#\n  a sample page\n" + TAIL, '"title" goes on past line 3 (see line 5)')

    def test_the_symlink_message_is_the_one_the_docstring_quotes(self):
        self.assertIn("cannot repair <file>: symlink (a link is never replaced by a regular file)", " ".join(repair_mod.__doc__.split()))

    def test_a_break_outside_quotes_in_a_file_that_parses_is_refused(self):
        raw = front_text("title: foo\n \n" + TAIL)
        self.assertIsNotNone(repair_mod._strict(["issue_number: 5", "title: foo", " ", *TAIL.split("\n")[:-1]]))
        w = analyze_task_text(raw).warnings
        self.assertTrue(any("outside quotes" in x for x in w), w)
        self.assertEqual(repair_mod.plan_repair(raw)[0], "cannot")

    def test_a_break_on_a_comment_line_of_a_file_that_does_not_parse_is_refused(self):
        raw = front_text(self.broken("title: foo: bar\n# alpha beta\n"))
        self.assertEqual(repair_mod.plan_repair(raw)[0], "cannot")

    def test_a_value_on_one_line_in_a_file_that_does_not_parse_is_repaired(self):
        raw = front_text(self.broken("title: foo: bar\n"))
        self.assertIn('unquoted value in "title"', analyze_task_text(raw).warnings)
        self.assertEqual(repair_mod.plan_repair(raw)[0], "repair")

    def test_a_recovered_value_that_starts_with_a_quote_it_cannot_close_is_lossy(self):
        r = analyze_task_text(front_text(self.broken('title: "alpha: beta\n', owner='owner: gamma"\n')))
        self.assertIn("title", r.lossy)
        r = analyze_task_text(front_text("title: T\n" + wrap_tail(depts='depts:\n  - 1\n  - "alpha\n  #"\n')))
        self.assertIn("depts", r.lossy)

    def test_the_reader_sees_through_an_anchor_or_tag_before_an_unclosed_quote(self):
        for first, over in (
            ('title: !!str "alpha: beta\n', {"owner": 'owner: gamma"\n'}),
            ("title: &t 'alpha: beta\n", {"owner": "owner: gamma'\n"}),
        ):
            with self.subTest(first=first):
                r = analyze_task_text(front_text(self.broken(first, **over)))
                self.assertIn("title", r.lossy)
                self.assertTrue(any("never closed" in w for w in r.warnings), r.warnings)
        r = analyze_task_text(front_text("title: T\n" + wrap_tail(depts='depts:\n  - &a "alpha\n  #"\n  - beta #c\n')))
        self.assertIn("depts", r.lossy)

    def test_a_hash_line_inside_a_quoted_item_is_not_trimmed_as_a_comment(self):
        block = ["issue_number: 5", "title: T", "depts:", "  - 1", '  - "alpha', '  #"', "owner: x"]
        self.assertEqual(data_mod._yaml_spans(block)["depts"], (2, 6))
        block = ["issue_number: 5", "title: T", "depts:", "  - 1", "  - alpha", "  #", "owner: x"]
        self.assertEqual(data_mod._yaml_spans(block)["depts"], (2, 5))  # a real trailing comment still goes

    def test_a_quoted_item_whose_last_line_starts_with_a_hash_is_refused_not_split(self):
        self.refused("title: T\n" + wrap_tail(depts='depts:\n  - 1\n  - "alpha\n  #"\n'))

    def test_an_anchored_quoted_item_whose_last_line_starts_with_a_hash_is_refused_not_split(self):
        self.refused("title: T\n" + wrap_tail(depts='depts:\n  - &a "alpha\n  #"\n  - beta #c\n'))

    def test_a_flow_list_whose_quoted_item_ends_on_a_hash_line_is_refused(self):
        self.refused("title: T\n" + wrap_tail(depts='depts: [1, "alpha\n  #"]\n'))


class TestRecursiveAliasAndInternalErrors(unittest.TestCase):
    def setUp(self):
        self._td = tempfile.TemporaryDirectory()
        self.addCleanup(self._td.cleanup)
        self.root = Path(self._td.name)
        (self.root / "tasks").mkdir()

    def put(self, n, text):
        (self.root / "tasks" / f"{n}.md").write_bytes(text.encode("utf-8"))

    def test_a_recursive_alias_is_left_for_hand_editing_and_does_not_hang_or_raise(self):
        raw = front_text("title: alpha #c\nmeta: &x\n  b: *x\n" + TAIL)
        status, new, warnings = repair_mod.plan_repair(raw)
        self.assertEqual((status, new), ("cannot", None))
        self.assertTrue(any("anchor, an alias" in w for w in warnings), warnings)

    def test_a_file_after_a_bad_one_is_still_processed_and_the_summary_prints(self):
        self.put(1, front_text("title: Docs: x\n" + TAIL))
        self.put(5, front_text("title: Docs: y\n" + TAIL))
        self.put(7, front_text("title: Docs: z\n" + TAIL))
        real = repair_mod.analyze_task_text

        def boom(raw):
            if "Docs: y" in raw:
                raise RuntimeError("sample failure\nsecond line")
            return real(raw)

        with mock.patch.object(repair_mod, "analyze_task_text", boom):
            code, out = run(self.root, "--apply")
        self.assertEqual(code, 1, out)
        self.assertIn("cannot repair tasks/5.md: internal error: RuntimeError: sample failure", out)
        self.assertNotIn("second line", out)
        self.assertIn("2 repaired, 1 cannot repair, 0 skipped", out)
        for n in (1, 7):
            self.assertEqual(analyze_task_text((self.root / "tasks" / f"{n}.md").read_text(encoding="utf-8")).warnings, [])

    def test_an_exception_outside_the_plan_is_counted_too(self):
        self.put(1, front_text("title: Docs: x\n" + TAIL))
        self.put(2, front_text("title: Docs: y\n" + TAIL))
        calls = []
        real = repair_mod._one_file

        def flaky(md, rel, apply):
            calls.append(rel)
            if len(calls) == 1:
                raise ValueError("odd")
            return real(md, rel, apply)

        with mock.patch.object(repair_mod, "_one_file", flaky):
            code, out = run(self.root, "--apply")
        self.assertEqual(code, 1, out)
        self.assertIn("cannot repair tasks/1.md: internal error: ValueError: odd", out)
        self.assertIn("1 repaired, 1 cannot repair, 0 skipped", out)


class TestCleanFilesStayClean(unittest.TestCase):
    def test_a_comment_with_words_after_the_end_of_a_value_in_a_file_that_parses_is_no_warning(self):
        for front in ('title: T\nowner: "x"\n  # note words\n', 'title: T\nowner: x\n# note words\n',
                      'title: T\ndepts:\n  - alpha\n  # note words\n', 'title: T\ndepts: [alpha]\n  # note words\n'):
            with self.subTest(front=front):
                raw = front_text(front + wrap_tail(owner="", depts=""))
                self.assertEqual(analyze_task_text(raw).warnings, [])
                self.assertEqual(repair_mod.plan_repair(raw)[0], "ok")

    def test_a_comment_with_words_between_items_still_warns(self):
        raw = front_text("title: T\n" + wrap_tail(depts="depts:\n  - alpha\n  # note words\n  - beta\n"))
        self.assertTrue(analyze_task_text(raw).warnings)


class TestRepairKeepsModeAndLinks(unittest.TestCase):
    def setUp(self):
        self._td = tempfile.TemporaryDirectory()
        self.addCleanup(self._td.cleanup)
        self.root = Path(self._td.name)
        (self.root / "tasks").mkdir()
        self.path = self.root / "tasks" / "5.md"
        self.text = front_text("title: Docs: x\n" + TAIL).encode("utf-8")

    @unittest.skipIf(sys.platform == "win32", "POSIX permission bits")
    def test_a_read_only_file_is_repaired_and_stays_read_only(self):
        self.path.write_bytes(self.text)
        self.path.chmod(0o444)
        code, out = run(self.root, "--apply")
        self.assertEqual(code, 0, out)
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode), 0o444)
        self.assertEqual(analyze_task_text(self.path.read_text(encoding="utf-8")).warnings, [])

    @unittest.skipIf(sys.platform == "win32", "POSIX permission bits")
    def test_an_executable_file_keeps_its_mode(self):
        self.path.write_bytes(self.text)
        self.path.chmod(0o750)
        run(self.root, "--apply")
        self.assertEqual(stat.S_IMODE(self.path.stat().st_mode), 0o750)

    @unittest.skipIf(sys.platform == "win32", "symlinks")
    def test_a_symlinked_task_file_is_reported_and_left_alone(self):
        real = self.root / "real.md"
        real.write_bytes(self.text)
        self.path.symlink_to(real)
        for args in ((), ("--apply",)):
            code, out = run(self.root, *args)
            self.assertEqual(code, 1, out)
            self.assertIn("cannot repair tasks/5.md: symlink (a link is never replaced by a regular file)", out)
            self.assertTrue(self.path.is_symlink())
            self.assertEqual(real.read_bytes(), self.text)


# Every guard in plan_repair, switched off by name. `only(...)` keeps just the named ones on.
OFF = {
    "_is_lossy": lambda r: False,
    "_has_props": lambda *a: False,
    "_value_backstop": lambda *a: None,
    "_strict_ok": lambda nb: True,
    "_clean_ok": lambda c: True,
    "_keys_ok": lambda *a: True,
    "_values_ok": lambda *a: True,
    "_words_per_key_ok": lambda *a: True,
    "_words_whole_ok": lambda *a: True,
}


def plan_with(text, live=(), patches=()):
    with contextlib.ExitStack() as st:
        for name, off in OFF.items():
            if name not in live:
                st.enter_context(mock.patch.object(repair_mod, name, off))
        for name, repl in patches:
            st.enter_context(mock.patch.object(repair_mod, name, repl))
        return repair_mod.plan_repair(text)


def eats_the_next_line(g, block, line_of):
    """A grammar that lets a key's span swallow the line after it."""
    value = g.rest.strip(" \t")
    return repair_mod._Fit(g.a + 2, value, value)


def drops_a_tail(g, block, line_of):
    """A grammar that rewrites `[a, b] tail` as the list and loses the tail."""
    value = g.rest.strip(" \t")
    if g.key in repair_mod._LIST_KEYS and value.startswith("["):
        items = [x.strip() for x in value[1 : value.rindex("]")].split(",")]
        return repair_mod._Fit(g.a + 1, items, items)
    return repair_mod._Fit(g.a + 1, value, value)


class TestEveryGuardIsTestedAlone(unittest.TestCase):
    """For each guard: with every other guard switched off it must still refuse (so a test fails if
    the guard is deleted), and with it switched off too the same input must be written (so the
    input really reaches that guard)."""

    def check(self, guard, text, patches=(), message=None):
        status, new, warnings = plan_with(text, live=(guard,), patches=patches)
        self.assertEqual((status, new), ("cannot", None), guard)
        if message:
            self.assertTrue(any(message in w for w in warnings), warnings)
        status, new, _ = plan_with(text, live=(), patches=patches)
        self.assertEqual(status, "repair", f"{guard}: the input never reached the guard")

    def test_the_lossy_file_refusal(self):
        self.check("_is_lossy", front_text("title: Plain\n" + sc("success_criteria: [alpha, beta] gamma\n")),
                   patches=[("_fit", drops_a_tail)])

    def test_the_grammar_refuses_a_value_that_goes_on_past_its_line(self):
        status, new, warnings = repair_mod.plan_repair(front_text("title: Docs: set up\n  a sample page\n" + TAIL))
        self.assertEqual((status, new), ("cannot", None))
        self.assertTrue(any('"title" goes on past line' in w for w in warnings), warnings)

    def test_the_strict_parse_check(self):
        self.check("_strict_ok", front_text("title: Docs: x\n" + TAIL), patches=[("_encode", lambda v: '"unterminated')])

    def test_the_no_warnings_left_check(self):
        self.check("_clean_ok", front_text("title: Docs: x\n" + TAIL), patches=[("_encode", lambda v: "a b #c")])

    def test_the_key_set_backstop_refuses_a_phantom_key(self):
        self.check("_keys_ok", front_text("title: Docs: x\n" + TAIL),
                   patches=[("_encode", lambda v: '"x"\nphantom: 1')])

    def test_the_key_set_backstop_refuses_a_missing_key(self):
        text = front_text("title: Docs: x\n  depts: [rnd, ops]\n" + wrap_tail(depts=""))
        self.check("_keys_ok", text, patches=[("_fit", eats_the_next_line)])

    def test_the_value_check(self):
        self.check("_values_ok", front_text("title: Docs: x\n" + TAIL), patches=[("_encode", lambda v: '"other"')])

    def test_the_value_check_refuses_a_task_key_that_went_missing(self):
        # A key dropped from the new block: only the first clause (task keys against the console's
        # view) sees it, because the second one walks the keys the new block still has.
        text = front_text("title: Docs: x\n" + TAIL)
        self.check("_values_ok", text, patches=[("_fit", eats_the_next_line)])

    def test_the_per_key_check_counts_the_words_of_the_rewritten_lines(self):
        # The span swallows the line after the key; those words are not in the new value.
        text = front_text("title: Docs: x\n" + TAIL)
        self.check("_words_per_key_ok", text, patches=[("_fit", eats_the_next_line)])

    def test_the_value_check_refuses_a_key_the_reader_never_showed(self):
        # The task keys match, so only the second clause (what a strict parse of the new block holds
        # against what the console showed) can refuse this.
        self.check("_values_ok", front_text("title: Docs: x\n" + TAIL),
                   patches=[("_encode", lambda v: '"Docs: x"\nzzz: 1')])

    def test_the_grammar(self):
        for first, over in (
            ("title: {alpha,\n", {"owner": "owner: beta}\n"}),
            ("title: !!str foo: bar\n", {}),
            ("title: &a foo: bar\n", {}),
            ("title: &a b #c\n", {}),
            ("title: foo: bar\u2028baz\n", {}),
            ("title:\tfoo: bar\n", {}),
            ("title: T\n", {"depts": 'depts: ["a", b # c]\n'}),
        ):
            with self.subTest(first=first, over=over):
                status, new, _ = repair_mod.plan_repair(front_text(first + wrap_tail(created="created: x: y\n", **over)))
                self.assertEqual((status, new), ("cannot", None))

    def test_the_value_backstop(self):
        # The original parses; the encoder writes a value that is not the one YAML read.
        text = front_text("title: alpha #c\n" + TAIL)
        self.check("_value_backstop", text, patches=[("_encode", lambda v: '"other"')],
                   message='the value of "title" would change')

    def test_the_anchor_alias_tag_refusal(self):
        text = front_text("title: alpha #c\nmeta: &x\n  b: 1\n" + TAIL)
        self.check("_has_props", text, message="anchor, an alias or an explicit tag")

    def test_the_per_key_word_check(self):
        self.check("_words_per_key_ok", front_text("title: Plain\n" + sc("success_criteria: [alpha, beta] gamma\n")),
                   patches=[("_fit", drops_a_tail)])

    def test_the_whole_file_word_check(self):
        self.check("_words_whole_ok", front_text("title: Docs: x\n" + TAIL), patches=[("_fit", eats_the_next_line)])


class TestRepairWriteErrors(unittest.TestCase):
    def setUp(self):
        self._td = tempfile.TemporaryDirectory()
        self.addCleanup(self._td.cleanup)
        self.root = Path(self._td.name)
        (self.root / "tasks").mkdir()
        for n in (5, 6):
            (self.root / "tasks" / f"{n}.md").write_bytes(front_text(f"title: Docs: x{n}\n" + TAIL).encode("utf-8"))

    def tmp_files(self):
        return sorted(p.name for p in (self.root / "tasks").iterdir() if p.name.endswith(".tmp"))

    def test_a_failed_replace_leaves_no_temp_file_and_the_run_goes_on(self):
        real = os.replace
        calls = []

        def flaky(src, dst):
            calls.append(dst)
            if len(calls) == 1:
                raise OSError(28, "No space left on device")
            return real(src, dst)

        before = (self.root / "tasks" / "5.md").read_bytes()
        with mock.patch.object(repair_mod.os, "replace", flaky):
            code, out = run(self.root, "--apply")
        self.assertEqual(code, 1, out)
        self.assertIn("cannot repair tasks/5.md: could not write it (No space left on device)", out)
        self.assertIn("1 repaired, 1 cannot repair, 0 skipped", out)
        self.assertEqual((self.root / "tasks" / "5.md").read_bytes(), before)
        self.assertEqual(self.tmp_files(), [])
        self.assertEqual(analyze_task_text((self.root / "tasks" / "6.md").read_text(encoding="utf-8")).warnings, [])

    @unittest.skipIf(sys.platform == "win32" or (hasattr(os, "geteuid") and os.geteuid() == 0), "needs a non-root POSIX user")
    def test_a_read_only_directory_is_reported_for_every_file_with_a_summary(self):
        d = self.root / "tasks"
        before = {p.name: p.read_bytes() for p in d.iterdir()}
        d.chmod(stat.S_IRUSR | stat.S_IXUSR)
        self.addCleanup(d.chmod, stat.S_IRWXU)
        code, out = run(self.root, "--apply")
        self.assertEqual(code, 1, out)
        self.assertEqual(out.count("is not writable"), 2, out)  # known before writing, so no write is tried
        self.assertIn("0 repaired, 2 cannot repair, 0 skipped", out)
        self.assertEqual({p.name: p.read_bytes() for p in d.iterdir()}, before)


def disk_outcomes(testcase, files, modes=None, links=()):
    """Write `files` ({name: bytes}) under tasks/ of a fresh root, plus `links` ({name: bytes}) as
    symlinks to files outside tasks/, and return {name: (page advice, changed by --apply)}.
    The page's advice is read before --apply, from the task the console builds, and the outcome after,
    from the bytes on disk."""
    from ui.render import task_advice

    td = tempfile.TemporaryDirectory()
    testcase.addCleanup(td.cleanup)
    root = Path(td.name)
    (root / "tasks").mkdir()
    (root / "elsewhere").mkdir()
    paths = {}
    for name, data in files.items():
        paths[name] = root / "tasks" / name
        paths[name].write_bytes(data)
        if modes and name in modes:
            paths[name].chmod(modes[name])
    targets = {}
    for name, data in dict(links).items():
        targets[name] = root / "elsewhere" / name
        targets[name].write_bytes(data)
        paths[name] = root / "tasks" / name
        paths[name].symlink_to(targets[name])
    before = {n: p.read_bytes() for n, p in paths.items()}
    advice = {t.path.name: task_advice(t) for t in parse_tasks(root)}
    run(root, "--apply")
    out = {}
    for name, p in paths.items():
        changed = p.read_bytes() != before[name]
        if name in targets:
            testcase.assertTrue(p.is_symlink(), name)  # still a link
            testcase.assertEqual(targets[name].read_bytes(), before[name], name)
        out[name] = (advice.get(name, ""), changed)
    return out


class TestDecide(unittest.TestCase):
    def setUp(self):
        self._td = tempfile.TemporaryDirectory()
        self.addCleanup(self._td.cleanup)
        self.dir = Path(self._td.name)

    def put(self, name, text):
        p = self.dir / name
        p.write_bytes(text.encode("utf-8") if isinstance(text, str) else text)
        return p

    def test_the_three_verdicts(self):
        self.assertEqual(decide(self.put("a.md", front_text("title: foo: bar\n" + TAIL)))[0], "repair")
        self.assertEqual(decide(self.put("b.md", front_text("title: foo: bar\nnote: alpha\n" + TAIL)))[0], "cannot")
        self.assertEqual(decide(self.put("c.md", front_text('title: "foo"\n' + TAIL))), ("ok", "", []))

    def test_the_reason_is_the_warnings_and_the_refusal(self):
        verdict, reason, _ = decide(self.put("a.md", front_text("title: foo: bar\n" + TAIL)))
        self.assertEqual((verdict, reason), ("repair", 'unquoted value in "title"'))
        verdict, reason, _ = decide(self.put("b.md", front_text("title: foo: bar\nnote: alpha\n" + TAIL)))
        self.assertEqual(verdict, "cannot")
        self.assertIn("is not a task key", reason)

    def test_unreadable_files_never_raise(self):
        self.assertEqual(decide(self.dir / "missing.md"), ("cannot", "unreadable file", []))
        self.assertEqual(decide(self.put("bad.md", b"\xff\xfe---\n")), ("cannot", "unreadable file", []))

    def test_a_symlink_is_never_repaired(self):
        real = self.put("real.md", front_text("title: foo: bar\n" + TAIL))
        link = self.dir / "link.md"
        link.symlink_to(real)
        self.assertEqual(decide(link)[0], "cannot")
        self.assertIn("symlink", decide(link)[1])
        self.assertEqual(decide(real)[0], "repair")

    def test_mixed_and_lone_line_endings_are_refused_on_the_raw_bytes(self):
        base = front_text("title: foo: bar\n" + TAIL)
        self.assertEqual(decide(self.put("lf.md", base))[0], "repair")
        self.assertEqual(decide(self.put("crlf.md", base.replace("\n", "\r\n")))[0], "repair")
        self.assertEqual(decide(self.put("mixed.md", base.replace("\n", "\r\n", 1)))[0], "cannot")
        self.assertEqual(decide(self.put("cr.md", base + "tail\rmore\n"))[0], "cannot")

    def test_apply_and_the_page_call_the_same_function(self):
        calls = []
        real = repair_mod._decide

        def spy(md):
            calls.append(md.name)
            return real(md)

        from ui.render import task_advice
        p = self.put("5.md", front_text("title: foo: bar\n" + TAIL))
        (self.dir / "tasks").mkdir()
        (self.dir / "tasks" / "5.md").write_bytes(p.read_bytes())
        with mock.patch.object(repair_mod, "_decide", spy):
            task_advice(mock.Mock(warnings=["x"], path=self.dir / "tasks" / "5.md"))
            run(self.dir, "--apply")
        self.assertEqual(calls, ["5.md", "5.md"])


class TestAdviceFollowsTheRepair(unittest.TestCase):
    """The task page's advice is `decide`'s verdict on the file's raw bytes, and `--apply` acts on
    the same verdict: the page says "repair" exactly when `--apply` changes the file on disk."""

    def test_the_page_uses_the_repairs_decision(self):
        from ui.render import task_advice
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "5.md"
            t = mock.Mock(warnings=['unquoted value in "title"'], path=p)
            p.write_text(front_text("title: foo: bar\n" + TAIL), encoding="utf-8")
            self.assertEqual(task_advice(t), "repair")
            p.write_text(front_text("title: foo: bar\nnote: alpha\n" + TAIL), encoding="utf-8")
            self.assertEqual(task_advice(t), "hand")
            self.assertEqual(task_advice(mock.Mock(warnings=[], path=p)), "")
            self.assertEqual(task_advice(mock.Mock(warnings=["x"], path=Path(td) / "missing.md")), "hand")

    def test_a_warning_the_repair_does_not_clear_is_a_separate_note(self):
        """The advice is exactly `decide`'s verdict ("repair" here, as `--apply` repairs the file); the
        page's own warning (invalid issue_number), which the repair never names, is a separate note."""
        from ui.render import render, task_advice, task_leftover
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "tasks").mkdir()
            p = root / "tasks" / "5.md"
            p.write_text("---\nissue_number: abc\ntitle: foo: bar\n" + TAIL + "---\n" + BODY, encoding="utf-8")
            t = parse_tasks(root)[0]
            self.assertTrue(any("issue_number" in w for w in t.warnings), t.warnings)
            self.assertEqual(decide(t.path)[0], "repair")
            self.assertEqual(task_advice(t), "repair")
            left = task_leftover(t)
            self.assertEqual(left, [w for w in t.warnings if "issue_number" in w])
            html = render("task.html", task=t, history=[], page_title="t")
            self.assertIn("ui.repair_tasks --apply", html)
            self.assertIn("After the repair, still fix by hand: issue_number", html)
            run(root, "--apply")  # the advice was right: --apply changes the file
            self.assertNotEqual(p.read_text(encoding="utf-8").splitlines()[2], "title: foo: bar")
            # no leftover when every warning is one the repair names, or when the advice is "hand"
            p.write_text(front_text("title: foo: bar\n" + TAIL), encoding="utf-8")
            t = parse_tasks(root)[0]
            self.assertEqual(task_leftover(t), [])
            self.assertNotIn("still fix by hand", render("task.html", task=t, history=[], page_title="t"))
            p.write_text(front_text("title: foo: bar\nnote: alpha\n" + TAIL), encoding="utf-8")
            self.assertEqual(task_leftover(parse_tasks(root)[0]), [])
            self.assertEqual(task_leftover(mock.Mock(warnings=[], path=p)), [])
            with mock.patch("ui.render.decide", side_effect=RuntimeError("x")):
                self.assertEqual(task_leftover(mock.Mock(warnings=["w"], path=p)), [])

    def test_the_page_still_renders_when_the_decision_raises(self):
        from ui.render import render, task_advice
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "tasks").mkdir()
            (root / "tasks" / "5.md").write_text(front_text("title: foo: bar\n" + TAIL), encoding="utf-8")
            t = parse_tasks(root)[0]
            with mock.patch("ui.render.decide", side_effect=RuntimeError("sample")):
                self.assertEqual(task_advice(t), "hand")
                html = render("task.html", task=t, history=[], page_title="t")
            self.assertIn("Edit the file by hand", html)
            self.assertNotIn("ui.repair_tasks --apply", html)
            html = render("task.html", task=t, history=[], page_title="t")
            self.assertIn("ui.repair_tasks --apply", html)

    def test_advice_hand_when_plan_repair_raises_inside(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "5.md"
            p.write_text(front_text("title: foo: bar\n" + TAIL), encoding="utf-8")
            with mock.patch.object(repair_mod, "analyze_task_text", side_effect=RuntimeError("sample")):
                self.assertEqual(decide(p)[0], "cannot")

    def test_the_advice_does_not_use_the_warning_text(self):
        import ui.data as data_mod
        self.assertFalse(hasattr(data_mod, "_HAND_WARNINGS"))
        self.assertFalse(hasattr(data_mod, "repair_advice"))
        self.assertFalse(hasattr(repair_mod, "repair_advice"))

    def test_mixed_line_endings_in_a_clean_file_stay_warning_free(self):
        raw = front_text('title: "foo"\n' + TAIL).replace("\n", "\r\n", 3)
        self.assertEqual(analyze_task_text(raw).warnings, [])

    def test_a_line_break_inside_quotes_of_a_clean_file_stays_warning_free(self):
        self.assertEqual(analyze_task_text(front_text('title: "foo bar"\n' + TAIL)).warnings, [])

    def test_advice_equals_the_outcome_on_real_files(self):
        base = front_text("title: foo: bar\n" + TAIL).encode()
        bom = b"\xef\xbb\xbf" + base
        lone_cr_body = front_text("title: foo: bar\n" + TAIL).replace("tabbed line", "tabbed\rline").encode()
        lone_cr_key = front_text("title: foo: bar\rowner: alpha\n" + TAIL).encode()
        files = {
            "1.md": base,
            "2.md": base.replace(b"\n", b"\r\n"),
            "3.md": base.replace(b"\n", b"\r\n", 1),  # mixed: CRLF fence, LF elsewhere
            "4.md": lone_cr_body,
            "5.md": lone_cr_key,
            "6.md": bom,
            "7.md": base,  # read-only
            "8.md": base.replace(b"\n", b"\r\n")[:-2] + b"\n",  # CRLF with an LF as the last line ending
            "9.md": front_text("title: foo: bar\nnote: alpha\n" + TAIL).encode(),  # cannot repair
        }
        out = disk_outcomes(self, files, modes={"7.md": 0o444}, links={"10.md": base})
        self.assertEqual({n: v[0] == "repair" for n, v in out.items()}, {n: v[1] for n, v in out.items()}, out)
        self.assertEqual(
            {n: v[1] for n, v in out.items()},
            {"1.md": True, "2.md": True, "3.md": False, "4.md": False, "5.md": False, "6.md": True,
             "7.md": True, "8.md": False, "9.md": False, "10.md": False},
        )
        self.assertEqual(out["10.md"][0], "hand")

    def shapes(self):
        """(label, frontmatter) pairs: the reviewers' reproducers plus a generated grid."""
        T = TAIL
        base = [
            ("quoted key", 'title: alpha #c\n"note": x\n' + T),
            ("spaced key", "title: alpha #c\nnote : x\n" + T),
            ("complex key", "title: alpha #c\n? note\n: x\n" + T),
            ("indented block", "title: alpha #c\nnote:\n  x: y\n" + T),
            ("escape on an untouched line", 'title: foo: bar\nowner: "alpha\\u00a0beta"\n' + wrap_tail(owner="")),
            ("empty key then bullet", "title: foo: bar\n" + wrap_tail(owner="owner:\n- alpha\n")),
            ("list split over two lines", "title: foo: bar\n" + wrap_tail(created="created: [alpha,\nbeta]\n")),
            ("block scalar value", "title: foo: bar\n" + wrap_tail(owner="owner: |\n  alpha\n")),
            ("same anchor twice", "title: foo: bar\n" + wrap_tail(owner="owner: &a alpha\n", state="state: &a beta\n")),
            ("quoted u2028", 'title: foo: bar\n' + wrap_tail(owner='owner: "alpha beta"\n')),
            ("raw u2028 on the key line", "title: foo: bar baz\n" + T),
            ("recursive alias", "title: alpha #c\nmeta: &x\n  b: *x\n" + T),
            ("trailing comment with words", 'title: alpha #c\n  # note words\n' + T),
            ("tab before value", "title:\tfoo: bar\n" + T),
            ("anchor before quote", 'title: !!str "alpha: beta\n' + wrap_tail(owner='owner: gamma"\n', created="created: x: y\n")),
        ]
        starts = ['"', "'", "[", "{", "|", ">", "!", "&", "*", "%", "@", "`", "\\", "- ", "? ", ": ", ",", "#", "-", ""]
        grid = []
        lines = ("title: T\n" + T).splitlines(keepends=True)
        for key in ("title", "owner", "state", "created"):
            for st in starts:
                grid.append((f"{key} starts {st!r}",
                             "".join(f"{key}: {st}alpha: beta\n" if x.startswith(key + ":") else x for x in lines)))
        for st in starts + ["[a, b]", "[a, b] # c", "[a, b # c]", "[a, [b]]", "[a, 'b']", "[a, b] c"]:
            grid.append((f"depts value {st!r}", "title: foo: bar\n" + wrap_tail(depts=f"depts: {st}\n")))
        for extra in ("", "note: alpha\n", "# alpha beta\n", "owner: dup\n"):
            for title in ("title: foo: bar\n", "title: foo\n", "title: foo #12\n", "title:\n"):
                grid.append((f"{title!r}+{extra!r}", title + T + extra))
        return base + grid

    def test_advice_matches_the_repair_over_many_shapes(self):
        """Every shape, in four line-ending styles, is written to disk; the page's advice is compared
        with what `--apply` really did to the bytes."""
        files = {}
        for n, (label, front) in enumerate(self.shapes()):
            base = front_text(front)
            variants = {"lf": base, "crlf": base.replace("\n", "\r\n"),
                        "mixed-first": base.replace("\n", "\r\n", 1),
                        "mixed-last": base[: -len(BODY)] + BODY.replace("\n", "\r\n")}
            for style, raw in variants.items():
                files[f"{n}{len(files)}.md"] = raw.encode("utf-8")
        out = disk_outcomes(self, files)
        seen = {"repair": 0, "same": 0}
        for name, (advice, changed) in out.items():
            self.assertEqual(advice == "repair", changed, (name, files[name]))
            seen["repair" if changed else "same"] += 1
        self.assertGreater(seen["repair"], 50)
        self.assertGreater(seen["same"], 400)


class TestRepairedFilesParseWithTheStandardLoader(unittest.TestCase):
    """The result must load with PyYAML's own `safe_load`, which (unlike the console) turns a date
    into a date object and raises on one that is not real."""

    def setUp(self):
        self._td = tempfile.TemporaryDirectory()
        self.addCleanup(self._td.cleanup)
        self.root = Path(self._td.name)
        (self.root / "tasks").mkdir()
        self.path = self.root / "tasks" / "5.md"

    def applied(self, front):
        text = front_text(front)
        self.path.write_bytes(text.encode("utf-8"))
        code, out = run(self.root, "--apply")
        return code, out, self.path.read_text(encoding="utf-8"), text

    def safe_load_front(self, text):
        import yaml
        return yaml.safe_load(text.split("---\n")[1])

    def test_an_impossible_date_is_written_as_text_in_a_file_that_does_not_parse(self):
        import yaml
        text = front_text("title: Docs: x\n" + wrap_tail(created="created: 2026-02-30\n"))
        with self.assertRaises(ValueError):
            yaml.safe_load(text.split("---\n")[1].replace("title: Docs: x", "title: x"))
        code, out, new, _ = self.applied("title: Docs: x\n" + wrap_tail(created="created: 2026-02-30\n"))
        self.assertEqual(code, 0, out)
        self.assertIn('created: "2026-02-30"\n', new)
        self.assertEqual(self.safe_load_front(new)["created"], "2026-02-30")
        self.assertEqual(self.safe_load_front(new)["title"], "Docs: x")
        self.assertEqual(analyze_task_text(new).warnings, [])

    def test_an_impossible_date_alone_is_found_and_repaired_in_a_file_that_parses(self):
        for key, value in (("created", "2026-02-30"), ("completed", "2026-10-01 25:00:00"), ("deadline", "2026-04-31")):
            with self.subTest(key=key):
                code, out, new, _ = self.applied("title: Plain\n" + wrap_tail(**{key: f"{key}: {value}\n"}))
                self.assertEqual(code, 0, out)
                self.assertIn(f'{key}: "{value}"\n', new)
                self.assertEqual(self.safe_load_front(new)[key], value)

    def test_an_impossible_date_in_a_list_is_quoted_with_its_neighbours(self):
        code, out, new, _ = self.applied("title: Plain\n" + wrap_tail(depts="depts: [alpha, 2026-02-30]\n"))
        self.assertEqual(code, 0, out)
        self.assertIn('depts: ["alpha", "2026-02-30"]\n', new)
        self.assertEqual(self.safe_load_front(new)["depts"], ["alpha", "2026-02-30"])

    def test_a_real_date_is_left_alone(self):
        text = front_text("title: Plain\n" + TAIL)
        self.assertEqual(repair_mod.plan_repair(text)[0], "ok")

    def test_a_date_with_a_comment_after_it_is_left_for_hand_editing(self):
        # The comment would become part of the value, and the console's value would change.
        code, out, new, text = self.applied("title: Docs: x\n" + wrap_tail(created="created: 2026-02-30 # sample note\n"))
        self.assertEqual(code, 1, out)
        self.assertEqual(new, text)

    def test_a_non_task_key_with_an_impossible_date_is_left_for_hand_editing(self):
        code, out, new, text = self.applied("title: Plain\nnote: 2026-02-30\n" + TAIL)
        self.assertEqual(code, 1, out)
        self.assertEqual(new, text)

    def test_the_strict_parse_backstop_refuses_what_safe_load_cannot_construct(self):
        self.assertTrue(repair_mod._strict_ok(["title: Plain", "created: 2026-10-01"]))
        self.assertFalse(repair_mod._strict_ok(["title: Plain", "created: 2026-02-30"]))
        # With the reader's flag out of the way (the date written unquoted), only this check refuses.
        real = repair_mod._encode
        text = front_text("title: Docs: x\n" + wrap_tail(created="created: 2026-02-30\n"))
        bare = [("_encode", lambda v: v if v == "2026-02-30" else real(v))]
        self.assertEqual(plan_with(text, live=("_strict_ok",), patches=bare)[:2], ("cannot", None))
        self.assertEqual(plan_with(text, live=(), patches=bare)[0], "repair")


class TestApostrophesInFlowLists(unittest.TestCase):
    """In a file that does not parse, an apostrophe or quote right after a word character is plain
    text (`it's`); any other quote could open a quoted scalar and stays refused."""

    def plan(self, items, key="success_criteria"):
        return repair_mod.plan_repair(front_text("title: Plain\n" + wrap_tail(created="created: x: y\n", **{key: f"{key}: {items}\n"})))

    def test_an_apostrophe_after_a_word_character_is_repaired(self):
        for items in ("[alpha, 5, it's beta]", "[5, don't, O'x]", "[5, say\"hi]", "[5, it's, a]", "[5, \u00e9'x, b]"):
            with self.subTest(items=items):
                status, new, _ = self.plan(items)
                self.assertEqual(status, "repair")
                self.assertTrue(new.count("success_criteria: [") == 1)

    def test_the_repaired_list_has_the_items_the_comma_split_gives(self):
        status, new, _ = self.plan("[alpha, 5, it's beta]")
        self.assertIn('success_criteria: ["alpha", "5", "it\'s beta"]\n', new)
        import yaml
        self.assertEqual(yaml.safe_load(new.split("---\n")[1])["success_criteria"], ["alpha", "5", "it's beta"])

    def test_any_other_quote_is_refused(self):
        for items in ("[5, alpha, 'b']", "[alpha, 5, 'it's']", "[5, a, \"b\"]", "[5, a,'b']", "[a, 5, b: 'c, d']", "[5, a, x 'b']",
                      "[5, alpha, [b]]", "[5, alpha, {b}]", "[5, 'a', b]", "[5, \"a\", b]"):
            with self.subTest(items=items):
                self.assertEqual(self.plan(items)[0], "cannot")

    def test_the_rule_is_only_for_list_keys_and_plain_items(self):
        self.assertEqual(self.plan("[5, it's]", key="depts")[0], "repair")
        self.assertEqual(self.plan("[5, it's]", key="related_skills")[0], "repair")
        text = front_text("title: it's [a, b]\n" + wrap_tail(created="created: x: y\n"))
        self.assertEqual(repair_mod.plan_repair(text)[0], "repair")  # a title is a plain scalar here


class TestAllowListClauses(unittest.TestCase):
    """Each clause of the allow-list has an input that only it refuses (found by mutation runs)."""

    def plan(self, first, **over):
        return repair_mod.plan_repair(front_text(first + wrap_tail(created="created: x: y\n", **over)))

    def test_a_lone_indicator_is_not_a_plain_value(self):
        # Not plain, but in a file that does not parse the line cannot be read any other way: it is
        # taken literally, as the text it is (and a list key never takes the literal rule).
        for value in ("-", "?", ":"):
            with self.subTest(value=value):
                status, new, _ = self.plan("title: Plain\n", owner=f"owner: {value}\n")
                self.assertEqual(status, "repair", value)
                self.assertIn(f'\nowner: "{value}"\n', new)
                self.assertEqual(self.plan("title: Plain\n", depts=f"depts: {value}\n")[0], "cannot", value)
        self.assertEqual(self.plan("title: Plain\n", owner="owner: a-b\n")[0], "repair")
        self.assertTrue(repair_mod._plain("-a"))
        self.assertFalse(repair_mod._plain("-"))
        self.assertFalse(repair_mod._plain("- a"))
        self.assertFalse(repair_mod._plain("-\ta"))

    def test_text_after_the_closing_bracket_refuses_even_without_a_word_in_it(self):
        # A word after the bracket is "lossy" and refused earlier; punctuation has no word, so only
        # this check keeps it from being dropped.
        for after in (" ;", " !", " ,", ".", " -"):
            with self.subTest(after=after):
                self.assertEqual(self.plan("title: Plain\n", depts=f"depts: [alpha, beta]{after}\n")[0], "cannot")
        self.assertEqual(repair_mod._flow_list_items("[a, b] ;"), None)

    def test_a_comment_after_the_closing_bracket_needs_a_space_before_the_hash(self):
        self.assertEqual(self.plan("title: Plain\n", depts="depts: [5, beta] #\n")[0], "repair")
        self.assertEqual(self.plan("title: Plain\n", depts="depts: [5, beta]#\n")[0], "cannot")
        self.assertEqual(repair_mod._flow_list_items("[a]#"), None)
        self.assertEqual(repair_mod._flow_list_items("[a] #"), ["a"])
        self.assertEqual(repair_mod._flow_list_items("[a]\t#"), ["a"])

    def test_the_last_closing_bracket_ends_the_list(self):
        self.assertIsNone(repair_mod._flow_list_items("[a] b]"))
        self.assertIsNone(repair_mod._flow_list_items("[a, b] ]"))

    def test_a_bracket_inside_an_item_refuses_even_when_the_item_looks_plain(self):
        # "a[b" is a plain-looking item; only the inner-bracket check sees the "[" in it.
        self.assertIsNone(repair_mod._flow_list_items("[a[b, c]"))
        self.assertEqual(self.plan("[5, a[b, c]")[0], "cannot")
        self.assertEqual(repair_mod._flow_list_items("[a, b]"), ["a", "b"])

    def test_a_double_quote_after_a_space_or_comma_refuses_like_a_single_one(self):
        for value in ('[a, x "b"]', "[a, x 'b']", '[a, "b]', '[a,"b"]'):
            with self.subTest(value=value):
                self.assertIsNone(repair_mod._flow_list_items(value))
        self.assertEqual(repair_mod._flow_list_items('[a, y"b]'), ["a", 'y"b'])
        self.assertEqual(repair_mod._flow_list_items("[a, y'b]"), ["a", "y'b"])

    def test_a_closing_bracket_inside_the_trailing_comment_refuses(self):
        # rfind: the "]" in the comment is the last one, so "a] # c" is inner text with a bracket.
        self.assertIsNone(repair_mod._flow_list_items("[a, b] # note]"))
        self.assertEqual(repair_mod._flow_list_items("[a, b] # note"), ["a", "b"])


class TestOneGrammarAndTheValueBackstop(unittest.TestCase):
    """The repair writes a value only where the key's own lines are a plain value (see `_fit`), and
    never changes what YAML reads for another key."""

    def safe(self, text):
        import yaml
        return yaml.safe_load(text.split("---\n")[1])

    def test_a_neighbour_key_with_a_hyphen_or_a_nested_mapping_keeps_its_value(self):
        for neighbour in ("x-y:\n  a: beta\n", "note-1:\n  - alpha\n  - beta\n", "x-y: z\nlinks:\n  - a\n"):
            with self.subTest(neighbour=neighbour):
                text = front_text("title: T\n" + neighbour + "created: 2026-04-31\n")
                status, new, _ = repair_mod.plan_repair(text)
                self.assertEqual(status, "repair")
                want = self.safe(text.replace("2026-04-31", '"2026-04-31"'))
                self.assertEqual(self.safe(new), want)

    def test_an_anchor_alias_or_tag_in_a_file_that_needs_a_change_is_left_for_hand_editing(self):
        for front in (
            "title: T\nowner: &o bob\ndepts: [*o]\ndeadline: 2026-02-30\n",
            "title: T\nstate: &p [O, alpha]\ndeadline: 2026-02-30\n",
            "title: T\ncreated: &d 2026-02-30\n",
            "title: T\ncreated: !!timestamp 2026-02-30\n",
            "title: alpha #c\nmeta: &x\n  b: *x\n",
            "title: alpha #c\nrelated_skills:\n  - &q a\n  - *q\n",
        ):
            with self.subTest(front=front):
                text = front_text(front)
                status, new, warnings = repair_mod.plan_repair(text)
                self.assertEqual((status, new), ("cannot", None))

    def test_an_anchor_in_a_clean_file_is_nothing_to_repair(self):
        self.assertEqual(repair_mod.plan_repair(front_text("title: T\nowner: &o bob\ndepts: [*o]\n"))[0], "ok")

    def test_none_empty_and_empty_list_are_one_value_for_a_task_key(self):
        for empty in ("~", "null", "", '""', "[]"):
            with self.subTest(empty=empty):
                text = front_text(f"title: alpha #c\ncompleted: {empty}\ndepts: {empty}\n")
                status, new, _ = repair_mod.plan_repair(text)
                self.assertEqual(status, "repair")
                got = self.safe(new)
                self.assertEqual(got["title"], "alpha #c")
                self.assertTrue(all(got[k] in (None, "", []) for k in ("completed", "depts")), got)

    def test_the_comment_yaml_cut_off_is_the_one_value_change_allowed(self):
        text = front_text("title: fix #12\nrelated_skills: [a, b #c]\n")
        status, new, _ = repair_mod.plan_repair(text)
        self.assertEqual(status, "repair")
        got = self.safe(new)
        self.assertEqual((got["title"], got["related_skills"]), ("fix #12", ["a", "b #c"]))

    def test_the_backstop_names_the_key_it_would_change(self):
        text = front_text("title: alpha #c\n")
        status, _, warnings = plan_with(text, live=("_value_backstop",), patches=[("_encode", lambda v: '"other"')])
        self.assertEqual(status, "cannot")
        self.assertIn('check "backstop": the value of "title" would change; edit by hand', warnings)

    def test_a_key_that_is_not_a_task_key_and_needs_a_change_is_named(self):
        status, _, warnings = repair_mod.plan_repair(front_text("title: T\nnote: x: y\n" + TAIL))
        self.assertEqual(status, "cannot")
        self.assertTrue(any('"note"' in w for w in warnings), warnings)


class TestDateDetectorIsPyYamlsResolver(unittest.TestCase):
    def blame(self, front):
        return data_mod._date_blame(front)

    def test_the_forms_the_resolver_accepts_are_found_when_impossible(self):
        for value in ("2026-02-30", "2026-2-30 10:00:00", "2026-2-30 1:02:03", "2026-13-01", "2026-10-01 25:00:00",
                      "2026-02-30T10:00:00Z", "2026-02-30 10:00:00 +5"):
            with self.subTest(value=value):
                self.assertEqual(self.blame(f"created: {value}\n"), ({"created"}, False))

    def test_real_dates_and_other_text_are_not_found(self):
        for value in ("2026-02-28", "2026-2-3", "2026-10-01 10:00:00", "2026-02-3x", "20260230", "2026/02/30"):
            with self.subTest(value=value):
                self.assertEqual(self.blame(f"created: {value}\n"), (set(), False))

    def test_every_single_digit_form_agrees_with_pyyaml_itself(self):
        import itertools
        import yaml
        for m, d, h in itertools.product(("1", "2", "02", "13"), ("30", "31", "3", "00"), ("1", "24", "10")):
            value = f"2026-{m}-{d} {h}:00:00"
            try:
                yaml.safe_load(f"created: {value}\n")
                fails = False
            except ValueError:
                fails = True
            with self.subTest(value=value):
                self.assertEqual(bool(self.blame(f"created: {value}\n")[0]), fails)

    def test_a_timestamp_that_belongs_to_no_plain_key_is_not_attributed(self):
        for front in ('"created": 2026-02-30\n', "? created\n: 2026-02-30\n", "2026-02-30: v\n", "? 2026-02-30\n: v\n"):
            with self.subTest(front=front):
                keys, unattributed = self.blame("title: T\n" + front)
                self.assertEqual(keys if unattributed else None, keys if unattributed else None)
                self.assertTrue(unattributed or keys == {"created"})

    def test_the_reader_and_the_repair_refuse_when_no_single_key_explains_it(self):
        for front in ("2026-02-30: v\n", "? 2026-02-30\n: v\n", "? created\n: 2026-02-30\n", "'x y': 2026-02-30\n"):
            with self.subTest(front=front):
                text = front_text("title: T\n" + front)
                r = analyze_task_text(text)
                self.assertTrue(any("no single key explains it" in w for w in r.warnings), r.warnings)
                self.assertEqual(repair_mod.plan_repair(text)[0], "cannot")

    def test_a_single_digit_impossible_date_in_a_file_that_parses_is_repaired_as_text(self):
        status, new, _ = repair_mod.plan_repair(front_text("title: T\ncreated: 2026-2-30 10:00:00\n"))
        self.assertEqual(status, "repair")
        self.assertIn('created: "2026-2-30 10:00:00"\n', new)


class TestTheFileSystemDecision(unittest.TestCase):
    def setUp(self):
        self._td = tempfile.TemporaryDirectory()
        self.addCleanup(self._td.cleanup)
        self.root = Path(self._td.name)
        (self.root / "tasks").mkdir()
        self.raw = b"---\nissue_number: 5\ntitle: a: b\ncreated: 2026-01-01\n---\nbody\n"

    def put(self, name="5.md", sub=""):
        d = self.root / "tasks" / sub
        d.mkdir(exist_ok=True)
        p = d / name
        p.write_bytes(self.raw)
        return p

    def outcome(self, p):
        """(page advice, whether --apply changed the file), the two that must agree."""
        from ui.render import task_advice
        t = [t for t in parse_tasks(self.root) if t.path == p][0]
        advice = task_advice(t)
        run(self.root, "--apply")
        return advice, p.read_bytes() != self.raw

    @unittest.skipIf(sys.platform == "win32" or (hasattr(os, "geteuid") and os.geteuid() == 0), "needs a non-root POSIX user")
    def test_advice_equals_the_outcome_for_an_unwritable_directory(self):
        self.assertEqual(self.outcome(self.put("6.md")), ("repair", True))
        for sub in ("closed", ""):  # the tasks directory itself last, so the first one can still be made
            with self.subTest(sub=sub):
                p = self.put("7.md" if not sub else "5.md", sub)
                d = p.parent
                d.chmod(0o555)
                self.addCleanup(d.chmod, 0o755)
                self.assertEqual(self.outcome(p), ("hand", False))
                verdict, reason, _ = decide(p)
                self.assertEqual(verdict, "cannot")
                self.assertIn("is not writable", reason)

    @unittest.skipUnless(hasattr(os, "chflags") and hasattr(stat, "UF_IMMUTABLE") and sys.platform == "darwin", "needs BSD file flags")
    def test_advice_equals_the_outcome_for_an_immutable_file(self):
        p = self.put("8.md")
        os.chflags(p, stat.UF_IMMUTABLE)
        self.addCleanup(os.chflags, p, 0)
        self.assertEqual(self.outcome(p), ("hand", False))
        self.assertIn("immutable", decide(p)[1])

    def test_a_hard_linked_file_is_refused_by_the_same_decision(self):
        p = self.put("5.md")
        os.link(p, self.root / "twin.md")
        self.assertEqual(self.outcome(p), ("hand", False))
        verdict, reason, _ = decide(p)
        self.assertEqual(verdict, "cannot")
        self.assertIn("hard-linked", reason)
        self.assertEqual((self.root / "twin.md").read_bytes(), self.raw)

    @unittest.skipUnless(hasattr(os, "mkfifo"), "needs mkfifo")
    def test_a_fifo_named_like_a_task_does_not_hang(self):
        os.mkfifo(self.root / "tasks" / "9.md")
        self.put("5.md")
        self.assertEqual(decide(self.root / "tasks" / "9.md")[0], "cannot")
        code, out = run(self.root, "--apply")
        self.assertIn("tasks/9.md", out)
        self.assertEqual(code, 1, out)

    @unittest.skipUnless(os.path.exists("/dev/zero"), "needs /dev/zero")
    def test_a_symlink_to_a_device_is_never_read_to_the_end(self):
        (self.root / "tasks" / "9.md").symlink_to("/dev/zero")
        real = os.read
        reads = []

        def counted(fd, n):
            reads.append(n)
            if len(reads) > 4:
                raise AssertionError("a device was read without end")
            return real(fd, n)

        with mock.patch.object(data_mod.os, "read", counted):
            self.assertEqual(decide(self.root / "tasks" / "9.md")[0], "cannot")

    @unittest.skipIf(sys.platform == "win32" or (hasattr(os, "geteuid") and os.geteuid() == 0), "needs a non-root POSIX user")
    def test_a_tasks_directory_that_cannot_be_listed_is_said_and_exits_1(self):
        self.put("5.md")
        d = self.root / "tasks"
        self.addCleanup(d.chmod, 0o755)
        for mode in (0o300, 0o000):
            with self.subTest(mode=oct(mode)):
                d.chmod(mode)
                code, out = run(self.root, "--apply")
                self.assertEqual(code, 1, out)
                self.assertIn("cannot list tasks/:", out)
                self.assertNotIn("0 to repair", out)
                self.assertNotIn("Traceback", out)

    def test_a_target_swapped_for_a_symlink_after_the_decision_is_refused(self):
        p = self.put("5.md")
        other = self.root / "other.md"
        other.write_bytes(b"keep me\n")
        real = repair_mod.tempfile.mkstemp

        def swap_after_the_temp_file_exists(*a, **k):
            made = real(*a, **k)
            os.unlink(p)
            os.symlink(other, p)
            return made

        with mock.patch.object(repair_mod.tempfile, "mkstemp", swap_after_the_temp_file_exists):
            code, out = run(self.root, "--apply")
        self.assertEqual(other.read_bytes(), b"keep me\n")
        self.assertTrue(p.is_symlink())
        self.assertIn("skipped tasks/5.md", out)
        self.assertEqual(sorted(x.name for x in p.parent.iterdir()), ["5.md"])

    def test_a_target_replaced_by_another_file_after_the_decision_is_refused(self):
        p = self.put("5.md")
        real = repair_mod.tempfile.mkstemp

        def replace_after_the_temp_file_exists(*a, **k):
            made = real(*a, **k)
            os.unlink(p)
            p.write_bytes(self.raw)  # same bytes, new file
            return made

        with mock.patch.object(repair_mod.tempfile, "mkstemp", replace_after_the_temp_file_exists):
            code, out = run(self.root, "--apply")
        self.assertIn("skipped tasks/5.md", out)
        self.assertEqual(p.read_bytes(), self.raw)

    def test_the_temp_file_is_made_with_mkstemp_in_the_task_directory_and_removed_after(self):
        p = self.put("5.md")
        seen = []
        real = repair_mod.tempfile.mkstemp

        def spy(*a, **k):
            seen.append(k.get("dir"))
            return real(*a, **k)

        with mock.patch.object(repair_mod.tempfile, "mkstemp", spy):
            code, out = run(self.root, "--apply")
        self.assertEqual(code, 0, out)
        self.assertEqual([str(x) for x in seen], [str(p.parent)])
        self.assertEqual(sorted(x.name for x in p.parent.iterdir()), ["5.md"])


def bounded(testcase, fn, unblock=None, seconds=10):
    """Run fn() in a thread; fail the test (instead of hanging it) if it has not returned in time.
    `unblock` frees a thread stuck in an open() on a FIFO so it can end."""
    box = []

    def go():
        try:
            box.append(("value", fn()))
        except BaseException as e:  # noqa: BLE001
            box.append(("error", e))

    t = threading.Thread(target=go, daemon=True)
    t.start()
    t.join(seconds)
    if t.is_alive():
        if unblock:
            unblock()
            t.join(5)
        testcase.fail("the call did not return in time")
    kind, got = box[0]
    if kind == "error":
        raise got
    return got


def groups_of(*lines):
    block = list(lines)
    return block, _key_groups(block)


class TestTheGrammarPartsOneByOne(unittest.TestCase):
    """`_fit` and its helpers called on the key's own lines, so no later guard can hide a missing clause."""

    def fit(self, *lines):
        block, groups = groups_of(*lines)
        return repair_mod._fit(groups[0], block, 2)

    def test_an_empty_value_is_plain_and_an_empty_list_key_is_an_empty_list(self):
        self.assertTrue(repair_mod._plain(""))
        self.assertEqual(self.fit("title:")[1:], ("", ""))
        self.assertEqual(self.fit("depts:")[1:], ([], []))

    def test_a_block_list_is_only_for_a_list_key(self):
        self.assertEqual(self.fit("depts:", "  - a", "  - b")[1], ["a", "b"])
        self.assertIsInstance(self.fit("owner:", "  - a"), str)

    def test_a_block_list_ends_at_its_last_item_not_at_the_comment_lines_after_it(self):
        block, groups = groups_of("depts:", "  - a", "", "  # x")
        self.assertEqual(groups[0].b, 4)
        self.assertEqual(repair_mod._fit(groups[0], block, 2).end, 2)

    def test_a_block_item_is_one_dash_and_spaces_only(self):
        for bad in ("  -- b", "\t- b", "  - ", "  -b"):
            with self.subTest(bad=bad):
                self.assertIsInstance(self.fit("depts:", bad), str)

    def test_a_line_break_character_in_a_block_item_is_refused(self):
        for ch in ("\x85", "\u2028", "\u2029"):
            with self.subTest(ch=hex(ord(ch))):
                self.assertIsInstance(self.fit("depts:", "  - a" + ch + "b"), str)

    def test_a_list_item_is_not_a_mapping(self):
        for bad in ("", "a: b", "a:\tb", "a:", "[x", "- y", "a #"[:0] + "#c"):
            with self.subTest(bad=bad):
                self.assertFalse(repair_mod._item_ok(bad))
        for good in ("a", "a b", "a:b", "it's"):
            self.assertTrue(repair_mod._item_ok(good))

    def test_empty_items_of_a_flow_list_are_dropped(self):
        self.assertEqual(repair_mod._flow_list_items("[a, , b,]"), ["a", "b"])

    def test_the_comment_yaml_cut_is_put_back_only_when_it_is_exactly_that_text(self):
        cut = repair_mod._cut
        self.assertTrue(cut("a", "a #c", "a #c"))
        self.assertFalse(cut("a", "zzz", "zzz"))  # not the YAML text plus a comment
        self.assertFalse(cut("a", "a #c", "a #d"))  # not the line's own text
        self.assertFalse(cut("a", "b #c", "b #c"))  # does not start with what YAML kept
        self.assertFalse(cut("a", "a#c", "a#c"))  # a comment needs a space before the hash

    def test_a_restored_value_compares_every_item_and_needs_a_text_original(self):
        restored = repair_mod._restored
        self.assertTrue(restored(["a", "b"], ["a", "b #c"], ["a", "b #c"]))
        self.assertFalse(restored(["a", "b"], ["a", "zzz"], ["a", "zzz"]))
        self.assertFalse(restored(["a"], ["a", "b"], ["a", "b"]))
        self.assertTrue(restored(5, "5 #c", "5 #c"))  # a number whose text had a comment: the comment comes back
        self.assertFalse(restored(5, "6 #c", "6 #c"))
        self.assertFalse(restored([1], "x", "x"))  # a list is not a scalar

    def test_none_empty_text_and_empty_list_are_each_empty_and_equal(self):
        for v in (None, "", []):
            with self.subTest(v=v):
                self.assertTrue(repair_mod._empty(v))
                self.assertTrue(repair_mod._same(v, None) and repair_mod._same(v, "") and repair_mod._same(v, []))
        self.assertFalse(repair_mod._empty("x"))
        self.assertFalse(repair_mod._same("x", ""))


class TestTheBackstopAndPlanWiring(unittest.TestCase):
    def only(self, guard, text, patches):
        status, new, warnings = plan_with(text, live=(guard,), patches=patches)
        self.assertEqual((status, new), ("cannot", None), guard)
        return warnings

    def test_a_new_block_that_does_not_load_is_a_value_change(self):
        text = front_text("title: alpha #c\n" + TAIL)
        self.only("_value_backstop", text, [("_encode", lambda v: '"unterminated')])

    def test_a_key_that_went_missing_is_a_value_change(self):
        text = front_text("title: alpha #c\n" + TAIL)
        w = self.only("_value_backstop", text, [("_fit", eats_the_next_line)])
        self.assertTrue(any("would change" in x for x in w), w)

    def test_a_key_that_is_not_a_task_key_is_compared_too(self):
        text = front_text("note: orig\ntitle: alpha #c\n")
        w = self.only("_value_backstop", text, [("_encode", lambda v: '"alpha #c"\nnote: changed')])
        self.assertTrue(any('"note"' in x for x in w), w)

    def test_a_key_the_original_never_had_is_a_value_change(self):
        text = front_text("title: alpha #c\n" + TAIL)
        w = self.only("_value_backstop", text, [("_encode", lambda v: '"alpha #c"\nzzz: 1')])
        self.assertTrue(any('"zzz"' in x for x in w), w)

    def test_a_new_title_is_allowed_only_when_it_came_from_the_heading(self):
        r = types.SimpleNamespace(heading=False, recovered={"title": "H"})
        self.assertEqual(repair_mod._value_backstop(r, ["owner: x"], ['title: "H"', "owner: x"], {}), "title")
        r = types.SimpleNamespace(heading=True, recovered={"title": "H"})
        self.assertIsNone(repair_mod._value_backstop(r, ["owner: x"], ['title: "H"', "owner: x"], {}))

    def test_the_heading_exception_needs_an_empty_title(self):
        r = types.SimpleNamespace(heading=True, recovered={"title": "H"})
        got = repair_mod._value_backstop(r, ["title: real"], ['title: "H"'], {})
        self.assertEqual(got, "title")

    def test_a_key_that_is_not_a_task_key_is_refused_by_name(self):
        status, _, warnings = repair_mod.plan_repair(front_text("title: T\nnote: x: y\n" + TAIL))
        self.assertEqual(status, "cannot")
        self.assertTrue(any('"note" on line' in w and "is not a task key" in w for w in warnings), warnings)

    def test_a_duplicate_flagged_key_is_rewritten_once(self):
        text = front_text("title: alpha #c\ntitle: beta #d\n")
        status, new, _ = plan_with(text, live=())
        self.assertEqual(status, "repair")
        self.assertIn("\ntitle: beta #d\n", new)

    def test_a_title_flagged_while_the_heading_supplies_it_is_written_from_the_heading(self):
        status, new, _ = plan_with(front_text("title: ~ #c\n"), live=())
        self.assertEqual(status, "repair")
        self.assertIn('title: "Heading text"', new)


class TestTheReaderPartsOneByOne(unittest.TestCase):
    def test_an_unindented_line_that_is_a_key_of_its_own_ends_the_key_above(self):
        for foreign in ("? k", "x-y:", '"k": v', "x-y: v"):
            with self.subTest(foreign=foreign):
                block, groups = groups_of("title: T", foreign, "  child: 1")
                self.assertEqual(groups[0].cont, [])

    def test_the_next_task_key_takes_its_continuation_again(self):
        block, groups = groups_of("title: T", "x-y: z", "created: 2026-01-01", "  more")
        self.assertEqual([g.key for g in groups], ["title", "created"])
        self.assertEqual(groups[1].cont, ["more"])

    def test_a_valid_explicit_timestamp_is_not_a_warning(self):
        r = analyze_task_text(front_text("title: T\ncreated: !!timestamp 2026-02-01\n"))
        self.assertEqual(r.warnings, [])

    def test_anchors_aliases_and_tags_are_each_found(self):
        for line in ("owner: &o bob", "owner: *o", "owner: !!str bob"):
            with self.subTest(line=line):
                block, groups = groups_of("title: T", line)
                self.assertTrue(data_mod._has_props(block, groups))
        block, groups = groups_of("title: T", "? &k a", ": b")  # in no key's own lines
        self.assertTrue(data_mod._has_props(block, groups))
        block, groups = groups_of("title: T", "# &k", "owner: x")
        self.assertFalse(data_mod._has_props(block, groups))
        # the whole-text scan stops at the first YAML error; the per-key scan still finds the anchor after it
        block, groups = groups_of("title: @bad", "owner: &o bob")
        self.assertTrue(data_mod._has_props(block, groups))


class TestTheDateBlameParts(unittest.TestCase):
    def test_text_that_does_not_compose_gives_none_and_a_non_mapping_blames_nothing(self):
        self.assertIsNone(data_mod._date_blame("a: [\n"))
        self.assertEqual(data_mod._date_blame("- 2026-02-30\n"), (set(), False))

    def test_an_impossible_date_under_a_key_that_is_not_text_is_unattributed(self):
        self.assertEqual(data_mod._date_blame("? [a]\n: 2026-02-30\n"), (set(), True))

    def test_an_impossible_date_inside_a_list_or_a_mapping_belongs_to_its_key(self):
        self.assertEqual(data_mod._date_blame("a: [2026-02-30]\n"), ({"a"}, False))
        self.assertEqual(data_mod._date_blame("a: {b: 2026-02-30}\n"), ({"a"}, False))
        self.assertEqual(data_mod._date_blame("a:\n  - b: [2026-02-30]\n"), ({"a"}, False))


class TestReadRegularBytes(unittest.TestCase):
    def setUp(self):
        self._td = tempfile.TemporaryDirectory()
        self.addCleanup(self._td.cleanup)
        self.dir = Path(self._td.name)

    def test_a_directory_a_big_file_and_a_followed_link_are_handled(self):
        f = self.dir / "f"
        f.write_bytes(b"x" * 100)
        self.assertEqual(data_mod.read_regular_bytes(f)[0], b"x" * 100)
        with self.assertRaises(OSError):
            data_mod.read_regular_bytes(f, limit=10)
        self.assertEqual(len(data_mod.read_regular_bytes(f, limit=100)[0]), 100)
        link = self.dir / "l"
        link.symlink_to(f)
        self.assertEqual(data_mod.read_regular_bytes(link)[0], b"x" * 100)
        if hasattr(os, "O_NOFOLLOW"):
            with self.assertRaises(OSError):
                data_mod.read_regular_bytes(link, follow=False)
        with self.assertRaises(OSError):
            data_mod.read_regular_bytes(self.dir)

    @unittest.skipUnless(hasattr(os, "mkfifo"), "needs mkfifo")
    def test_a_fifo_with_no_writer_is_refused_at_once(self):
        fifo = self.dir / "p"
        os.mkfifo(fifo)

        def attempt():
            try:
                data_mod.read_regular_bytes(fifo)
                return "read"
            except OSError:
                return "refused"

        self.assertEqual(bounded(self, attempt, lambda: os.close(os.open(fifo, os.O_WRONLY))), "refused")

    @unittest.skipUnless(hasattr(os, "mkfifo"), "needs mkfifo")
    def test_a_symlink_to_a_fifo_is_unreadable_not_empty(self):
        fifo = self.dir / "p"
        os.mkfifo(fifo)
        (self.dir / "l.md").symlink_to(fifo)
        free = lambda: os.close(os.open(fifo, os.O_WRONLY))  # noqa: E731
        self.assertEqual(bounded(self, lambda: decide(self.dir / "l.md"), free), ("cannot", "unreadable file", []))
        self.assertEqual(bounded(self, lambda: decide(fifo), free), ("cannot", "not a regular file", []))

    @unittest.skipUnless(os.path.exists("/dev/zero"), "needs /dev/zero")
    def test_a_device_is_refused_before_a_byte_is_read(self):
        reads = []
        real = os.read

        def counted(fd, n):
            reads.append(n)
            if len(reads) > 4:
                raise AssertionError("a device was read without end")
            return real(fd, n)

        with mock.patch.object(data_mod.os, "read", counted):
            with self.assertRaises(OSError):
                data_mod.read_regular_bytes("/dev/zero")
        self.assertEqual(reads, [])

    def test_a_symlink_to_a_large_file_is_not_read(self):
        big = self.dir / "big"
        big.write_bytes(b"a" * ((8 << 20) + 1))
        (self.dir / "l.md").symlink_to(big)
        self.assertEqual(decide(self.dir / "l.md"), ("cannot", "unreadable file", []))

    def test_every_file_flag_that_blocks_a_replace_is_in_the_locked_set(self):
        for n in ("UF_IMMUTABLE", "SF_IMMUTABLE", "UF_APPEND", "SF_APPEND"):
            bit = getattr(stat, n, 0)
            self.assertEqual(repair_mod._LOCKED_FLAGS & bit, bit, n)

    def test_a_directory_without_write_or_without_search_permission_is_refused(self):
        f = self.dir / "5.md"
        f.write_bytes(b"x")
        st = os.lstat(f)
        for allowed in (os.W_OK, os.X_OK):
            with self.subTest(allowed=allowed):
                with mock.patch.object(repair_mod.os, "access", lambda p, m, a=allowed: m == a):
                    self.assertIn("not writable", repair_mod._cannot_write(f, st) or "")
        with mock.patch.object(repair_mod.os, "access", lambda p, m: True):
            self.assertIsNone(repair_mod._cannot_write(f, st))


if __name__ == "__main__":
    unittest.main()


# ---------------------------------------------------------------------------------------------
# Round 9: scaling, the append-only directory, the title that is all comment, list keys cut at
# " #", typed scalars, and the cases that kill the mutants the round-8 review found alive.
# ---------------------------------------------------------------------------------------------

def plan_text(front, tail=TAIL, body=BODY):
    return repair_mod.plan_repair(f"---\nissue_number: 5\n{front}{tail}---\n{body}")


def after(front, tail=TAIL, body=BODY):
    """(status, repaired text, warnings, what the reader makes of the repaired text)."""
    status, new, warns = plan_text(front, tail, body)
    return status, new, warns, (analyze_task_text(new) if new else None)


class TestRepairScalesLinearly(unittest.TestCase):
    """MINOR-1: the value backstop, the plan and the decision grow linearly in the number of keys."""

    def test_plan_repair_is_linear(self):
        from ui.tests.test_task_files import scales_linearly
        scales_linearly(self, lambda n: "---\nissue_number: 5\ntitle: foo: bar\n" + TAIL
                        + "".join(f"extra{i}: a\n" for i in range(n)) + "---\n" + BODY,
                        n=2000, fn=repair_mod.plan_repair)

    def test_decide_is_linear(self):
        from ui.tests.test_task_files import scales_linearly
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "5.md"

            def run_decide(raw):
                p.write_text(raw, encoding="utf-8")
                decide(p)

            scales_linearly(self, lambda n: "---\nissue_number: 5\ntitle: foo: bar\n" + TAIL
                            + "".join(f"extra{i}: a\n" for i in range(n)) + "---\n" + BODY,
                            n=2000, fn=run_decide)

    def test_the_backstop_comparison_alone_is_linear(self):
        """With the YAML loads replaced by dicts, only the comparison loops run. Counted, not timed: the
        number of times the comparison converts a key to text grows by exactly 4 when the keys grow by 4
        (linear); a quadratic search of the old keys for every new key makes it 16."""
        r = mock.Mock(heading="", recovered={})

        class Key(str):
            calls = 0
            __hash__ = str.__hash__

            def __str__(self):
                Key.calls += 1
                return str.__str__(self)

        def count(n):
            d = {Key(f"k{i}"): "a" for i in range(n)}
            Key.calls = 0
            with mock.patch.object(repair_mod, "_strict", side_effect=[d, dict(d)]):
                self.assertIsNone(repair_mod._value_backstop(r, [], [], {}))
            return Key.calls

        small, big = count(2000), count(8000)
        self.assertGreater(small, 0)
        self.assertLess(big / small, 6.0, f"{small} conversions for 2000 keys, {big} for 8000")


class TestAnAppendOnlyDirectory(unittest.TestCase):
    """MINOR-2: a directory a file cannot be replaced in is a verdict of `decide`, not an error
    after the temp file was made."""

    def fake_dir(self, flags=0, mode=0o755):
        return types.SimpleNamespace(st_flags=flags, st_mode=stat.S_IFDIR | mode, st_uid=0)

    def file_st(self, uid=None, nlink=1):
        return types.SimpleNamespace(st_nlink=nlink, st_flags=0, st_uid=os.geteuid() if uid is None else uid,
                                     st_mode=stat.S_IFREG | 0o644)

    def check(self, dir_st, file_st):
        with mock.patch.object(repair_mod.os, "access", return_value=True), \
                mock.patch.object(repair_mod.os, "stat", return_value=dir_st):
            return repair_mod._cannot_write(Path("/x/tasks/5.md"), file_st)

    def test_directory_flags_refuse(self):
        for name in ("UF_APPEND", "UF_IMMUTABLE", "SF_APPEND", "SF_IMMUTABLE"):
            flag = getattr(stat, name, None) or {"UF_APPEND": 4, "UF_IMMUTABLE": 2, "SF_APPEND": 0x40000,
                                                 "SF_IMMUTABLE": 0x20000}[name]
            with mock.patch.object(repair_mod, "_LOCKED_FLAGS", flag):
                why = self.check(self.fake_dir(flags=flag), self.file_st())
            self.assertIsNotNone(why, name)
            self.assertIn("tasks/", why)
            self.assertIn("append-only", why)

    def test_a_directory_without_flags_is_fine(self):
        self.assertIsNone(self.check(self.fake_dir(), self.file_st()))

    def test_sticky_directory_and_foreign_file_refuse(self):
        self.assertIn("sticky", self.check(self.fake_dir(mode=0o1777), self.file_st(uid=os.geteuid() + 1)))

    def test_sticky_directory_and_own_file_is_fine(self):
        self.assertIsNone(self.check(self.fake_dir(mode=0o1777), self.file_st()))

    def test_a_directory_that_cannot_be_examined_refuses(self):
        with mock.patch.object(repair_mod.os, "access", return_value=True), \
                mock.patch.object(repair_mod.os, "stat", side_effect=OSError("x")):
            self.assertIn("cannot be examined", repair_mod._cannot_write(Path("/x/tasks/5.md"), self.file_st()))

    def test_the_verdict_is_cannot_with_the_reason(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "5.md"
            p.write_text(front_text("title: foo: bar\n" + TAIL), encoding="utf-8")
            with mock.patch.object(repair_mod, "_cannot_write", return_value="the directory x/ is immutable"):
                verdict, reason, _ = decide(p)
            self.assertEqual(verdict, "cannot")
            self.assertIn("immutable", reason)

    @unittest.skipUnless(sys.platform == "darwin" and hasattr(os, "chflags") and hasattr(stat, "UF_APPEND"),
                         "needs BSD file flags")
    def test_a_real_append_only_directory_leaves_no_temp_file(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            d = root / "tasks"
            d.mkdir()
            p = d / "5.md"
            p.write_text(front_text("title: foo: bar\n" + TAIL), encoding="utf-8")
            before = p.read_bytes()
            try:
                os.chflags(d, stat.UF_APPEND)
            except OSError:
                self.skipTest("the file system refuses directory flags")
            try:
                code, out = run(root, "--apply")
                names = sorted(os.listdir(d))
            finally:
                os.chflags(d, 0)  # always: otherwise the temp dir cannot be removed
            self.assertEqual(code, 1)
            self.assertIn("cannot repair tasks/5.md", out)
            self.assertEqual(names, ["5.md"])
            self.assertEqual(p.read_bytes(), before)

    def test_the_parent_is_checked_again_before_the_temp_file(self):
        """The directory may change between the decision and the write: no `mkstemp` then."""
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "5.md"
            p.write_text(front_text("title: foo: bar\n" + TAIL), encoding="utf-8")
            real = repair_mod._cannot_write
            seen = []

            def blocked_second(md, st):
                seen.append(1)
                return real(md, st) if len(seen) == 1 else "the directory x/ is immutable"

            with mock.patch.object(repair_mod, "_cannot_write", blocked_second), \
                    mock.patch.object(repair_mod.tempfile, "mkstemp") as mk, contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(repair_mod._one_file(p, "tasks/5.md", True), "cannot")
            mk.assert_not_called()
            self.assertEqual(len(seen), 2)

    def test_a_failed_replace_leaves_no_temp_file(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "5.md"
            p.write_text(front_text("title: foo: bar\n" + TAIL), encoding="utf-8")
            before = p.read_bytes()
            with mock.patch.object(repair_mod.os, "replace", side_effect=OSError(28, "No space")), \
                    contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(repair_mod._one_file(p, "tasks/5.md", True), "cannot")
            self.assertEqual(sorted(os.listdir(td)), ["5.md"])
            self.assertEqual(p.read_bytes(), before)

    def test_a_failed_write_leaves_no_temp_file(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "5.md"
            p.write_text(front_text("title: foo: bar\n" + TAIL), encoding="utf-8")
            with mock.patch.object(repair_mod.os, "fdopen", side_effect=OSError(5, "I/O error")), \
                    contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(repair_mod._one_file(p, "tasks/5.md", True), "cannot")
            self.assertEqual(sorted(os.listdir(td)), ["5.md"])


class TestATitleThatIsAllComment(unittest.TestCase):
    """MINOR-3a: `title: #42 fix` is a title with words in it, and YAML reads it as nothing."""

    def test_the_comment_text_is_the_title_even_when_it_differs_from_the_heading(self):
        status, new, warns, a = after("title: #42 something else\n")
        self.assertEqual(status, "repair")
        self.assertIn('title: "#42 something else"', new)
        self.assertEqual(a.fm["title"], "#42 something else")
        self.assertEqual(a.warnings, [])

    def test_the_comment_text_equal_to_the_heading(self):
        status, new, warns, a = after("title: #Heading text\n")
        self.assertEqual(status, "repair")
        self.assertEqual(a.fm["title"], "#Heading text")
        self.assertEqual(a.warnings, [])

    def test_empty_spellings_take_the_heading(self):
        for spelling in ("title: null\n", "title: ~\n", "title:\n", "title: Null\n", "title: NULL\n"):
            status, new, warns, a = after(spelling)
            self.assertEqual(status, "repair", spelling)
            self.assertEqual(a.fm["title"], "Heading text", spelling)
            self.assertEqual(a.warnings, [], spelling)

    def test_a_comment_with_no_words_takes_the_heading(self):
        for spelling in ("title: # --\n", "title: #\n", "title: # ...\n"):
            status, new, warns, a = after(spelling)
            self.assertEqual(status, "repair", spelling)
            self.assertEqual(a.fm["title"], "Heading text", spelling)

    def test_it_is_idempotent(self):
        status, new, _, _ = after("title: #42 something else\n")
        self.assertEqual(repair_mod.plan_repair(new)[0], "ok")

    def test_without_a_heading_a_blank_title_is_left_alone(self):
        status, new, warns, a = after("title:\n", body="\nno heading here\n")
        self.assertNotEqual(status, "repair")


class TestListKeysCutAtAHash(unittest.TestCase):
    """MINOR-4: a plain string under a list key is cut at ` #`; the reader says so and the repair
    puts the text back."""

    def warns(self, tail):
        return analyze_task_text(f"---\nissue_number: 5\ntitle: T\n{tail}---\n{BODY}").warnings

    def test_the_reader_warns_for_success_criteria(self):
        w = self.warns(TAIL.replace("[one, two]", "Ship the importer fix #12"))
        self.assertTrue(any("success_criteria" in x for x in w), w)

    def test_the_reader_warns_for_depts(self):
        w = self.warns(TAIL.replace("[company, rnd]", "ops #core"))
        self.assertTrue(any("depts" in x for x in w), w)

    def test_the_reader_warns_for_a_quoted_value_with_a_comment(self):
        w = self.warns(TAIL.replace("[company, rnd]", '"ops" #core'))
        self.assertTrue(any("depts" in x for x in w), w)

    def test_a_clean_plain_string_does_not_warn(self):
        self.assertEqual(self.warns(TAIL.replace("[one, two]", "Ship the importer fix")), [])

    def test_a_hash_without_a_space_does_not_warn(self):
        self.assertEqual(self.warns(TAIL.replace("[one, two]", "Ship fix#12")), [])

    def test_the_repair_keeps_the_comment_text(self):
        status, new, warns, a = after("title: T\n", tail=TAIL.replace("[one, two]", "Ship the importer fix #12"))
        self.assertEqual(status, "repair")
        self.assertIn("Ship the importer fix #12", new)
        self.assertEqual(a.warnings, [])
        self.assertEqual(a.fm["success_criteria"], "Ship the importer fix #12")

    def test_the_repair_keeps_related_skills_text(self):
        status, new, warns, a = after("title: T\n", tail=TAIL.replace("[task-register]", "ops #core"))
        self.assertEqual(status, "repair")
        self.assertEqual(a.fm["related_skills"], "ops #core")

    def test_a_quoted_value_with_a_comment_is_refused_not_guessed(self):
        status, new, warns, a = after("title: T\n", tail=TAIL.replace("[company, rnd]", '"ops" #core'))
        self.assertEqual(status, "cannot")
        self.assertIsNone(new)

    def test_every_word_survives(self):
        status, new, _, _ = after("title: T\n", tail=TAIL.replace("[one, two]", "Ship the importer fix #12"))
        for word in ("Ship", "the", "importer", "fix", "#12"):
            self.assertIn(word, new)


class TestTypedScalars(unittest.TestCase):
    """NIT-3: a number or boolean of a rewritten key is written as its line text, and only when YAML
    reads that text as the same value."""

    def completed(self, spelling):
        tail = TAIL.replace("completed:\n", f"completed: {spelling}\n")
        status, new, warns, a = after("title: foo: bar\n", tail=tail)
        return status, new, a

    def test_each_spelling_is_written_as_its_text(self):
        for spelling in ("true", "True", "yes", "Yes", "on", "1_000", "0x1F", "017", "1.5", "12"):
            status, new, a = self.completed(spelling + " # note")
            self.assertEqual(status, "repair", spelling)
            self.assertIn(f"completed: \"{spelling} # note\"", new, spelling)
            self.assertEqual(a.fm["completed"], f"{spelling} # note", spelling)
            self.assertEqual(a.warnings, [], spelling)

    def test_a_plain_number_without_a_comment_is_unchanged(self):
        status, new, a = self.completed("12")
        self.assertEqual(status, "repair")
        self.assertIn('completed: "12"\n', new)
        self.assertEqual(a.fm["completed"], "12")

    def test_true_and_yes_behave_alike(self):
        a = self.completed("true")[0]
        b = self.completed("yes")[0]
        self.assertEqual(a, b)

    def test_the_rule_cannot_turn_a_number_into_another_one(self):
        r = mock.Mock()
        self.assertFalse(repair_mod._as_text(1, "2", "2"))
        self.assertFalse(repair_mod._as_text(True, "false", "false"))
        self.assertFalse(repair_mod._as_text("a", "a", "a"))
        self.assertTrue(repair_mod._as_text(True, "yes", "yes"))
        self.assertTrue(repair_mod._as_text(1000, "1_000", "1_000"))
        self.assertTrue(repair_mod._as_text(31, "0x1F", "0x1F"))
        self.assertFalse(repair_mod._as_text(31, "0x1F", "0x1f"))
        self.assertFalse(repair_mod._as_text(1, 1, "1"))

    def test_the_rule_needs_the_same_type(self):
        self.assertFalse(repair_mod._resolves("1", True))
        self.assertFalse(repair_mod._resolves("1.0", 1))
        self.assertTrue(repair_mod._resolves("1.0", 1.0))
        self.assertFalse(repair_mod._resolves("{[", 1))


class TestRefusalMessagesNameTheCheckAndTheKey(unittest.TestCase):
    """NIT-2."""

    def test_tab_before_the_value(self):
        status, new, warns = plan_text("title:\tfoo: bar\n")
        self.assertEqual(status, "cannot")
        text = "; ".join(warns)
        self.assertIn('check "grammar"', text)
        self.assertIn('"title"', text)
        self.assertIn("tab", text)

    def test_props_are_named(self):
        status, new, warns = plan_text("title: &co notes: x\n")
        self.assertEqual(status, "cannot")
        text = "; ".join(warns)
        self.assertIn('check "props"', text)

    def test_a_refusal_names_the_check_and_ends_with_edit_by_hand(self):
        self.assertEqual(repair_mod._refusal("values", 'the value of "title" would change'),
                         'check "values": the value of "title" would change; edit by hand')

    def test_the_backstop_names_the_key(self):
        r = mock.Mock(heading="", recovered={})
        with mock.patch.object(repair_mod, "_strict", side_effect=[{"title": "a", "owner": "x"}, {"title": "a", "owner": "y"}]):
            self.assertEqual(repair_mod._value_backstop(r, [], [], {}), "owner")

    def test_whitespace_around_a_value_is_stripped_the_same_way(self):
        for pad in (" ", "　", " "):
            status, new, warns, a = after(f"title: foo: bar{pad}\n")
            self.assertEqual(status, "repair", repr(pad))
            self.assertEqual(a.fm["title"], "foo: bar", repr(pad))

    def test_leading_wide_space_is_stripped(self):
        status, new, warns, a = after("title: 　foo: bar\n")
        self.assertEqual(a.fm["title"], "foo: bar")

    def test_title_null_is_empty(self):
        status, new, warns, a = after("title: null\n", body="\nno heading\n")
        self.assertNotEqual(status, "repair")


class TestARepairNeverGuessesTheKeySet(unittest.TestCase):
    """`state::` is the key `state:` to YAML. Splitting at the first colon would write `state: ":"` and
    so change the key set by guessing: the file is refused, naming the check and the key."""

    def test_a_doubled_colon_is_refused(self):
        for line in ("state::\n", "state:: x\n", "state:::\n", "owner::bob\n"):
            key = line.split(":")[0]
            tail = "".join(l for l in TAIL.splitlines(True) if not l.startswith(key + ":"))
            status, new, warns = plan_text("title: Foo: bar\n" + line, tail)
            self.assertEqual(status, "cannot", line)
            self.assertIsNone(new, line)
            text = "; ".join(warns)
            self.assertIn('check "keys"', text, line)
            self.assertIn(f'"{line.split(":")[0]}"', text, line)
            self.assertIn("edit by hand", text, line)

    def test_decide_agrees_with_the_plan(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "5.md"
            p.write_text(f"---\nissue_number: 5\ntitle: Foo: bar\nstate::\n{TAIL.replace('state: active', 'x_: 1')}---\n{BODY}", encoding="utf-8")
            verdict, reason, _ = decide(p)
            self.assertEqual(verdict, "cannot")
            self.assertIn('check "keys"', reason)

    def test_an_ordinary_colon_space_key_line_is_still_repaired(self):
        status, new, warns = plan_text("title: Foo: bar\n")
        self.assertEqual(status, "repair")


class TestATitleOfNullLosesOnlyItsSpelling(unittest.TestCase):
    """`title: null` becomes the heading: the spelling `null` is no word. Every other word from the
    opening fence on survives, comment lines inside the frontmatter included; only the text before the
    opening fence (the old template's instruction comment) goes, as it always did."""

    def test_comment_words_before_the_closing_fence_are_kept(self):
        raw = (OLD_COMMENT + "\n---\nissue_number: 5\ntitle: null\nowner: bob\n"
               "# note kept before the closing fence\n---\n\n# Head\n\nbody words\n")
        status, new, warns = repair_mod.plan_repair(raw)
        self.assertEqual(status, "repair")
        self.assertIn("# note kept before the closing fence\n---\n", new)
        self.assertIn('title: "Head"', new)
        self.assertTrue(new.startswith("---\n"))
        left = [w for w in re.findall(r"\w+", raw[raw.index("---"):]) if w not in re.findall(r"\w+", new)]
        self.assertEqual(left, ["null"])

    def test_comment_words_after_the_title_line_are_kept_or_the_file_is_refused(self):
        for after_title in ("# col0 words\n", "  # indented words\n", "\n  # blank then words\n"):
            raw = f"---\nissue_number: 5\ntitle: null\n{after_title}owner: bob\n---\n\n# Head\n"
            status, new, warns = repair_mod.plan_repair(raw)
            if status == "repair":
                self.assertIn("words", new, after_title)
            else:
                self.assertEqual(status, "cannot", after_title)


class TestMutantKillers(unittest.TestCase):
    """MINOR-5: one input for each mutant the review found alive."""

    def test_v12_a_numeric_title_becomes_text(self):
        status, new, warns, a = after("title: 123\n")
        # An integer title reads as a number: the reader says so and the repair writes the text.
        if status == "repair":
            self.assertIn('title: "123"', new)
            self.assertEqual(a.fm["title"], "123")
        else:
            self.assertEqual(status, "ok")

    def test_v15_a_bare_hash_is_an_empty_title(self):
        status, new, warns, a = after("title: #\n")
        self.assertEqual(status, "repair")
        self.assertEqual(a.fm["title"], "Heading text")

    def test_v20_a_hard_link_made_after_the_decision_stops_the_write(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "5.md"
            p.write_text(front_text("title: foo: bar\n" + TAIL), encoding="utf-8")
            before = p.read_bytes()
            real = tempfile.mkstemp
            link = Path(td) / "other.md"

            def mkstemp_then_link(*a, **kw):
                made = real(*a, **kw)
                os.link(p, link)  # after every earlier check, before the replace
                return made

            with mock.patch.object(repair_mod.tempfile, "mkstemp", mkstemp_then_link), \
                    contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(repair_mod._one_file(p, "tasks/5.md", True), "skipped")
            self.assertEqual(p.read_bytes(), before)
            self.assertEqual(link.read_bytes(), before)
            self.assertEqual(sorted(os.listdir(td)), ["5.md", "other.md"])

    def test_v23_only_task_file_names_are_listed(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "tasks").mkdir()
            for n in ("5.md", "README.md", "٣.md", "12.md", "7.txt", "x5.md"):
                (root / "tasks" / n).write_text("x", encoding="utf-8")
            files, errors = repair_mod._task_files(root)
            self.assertEqual(sorted(f.name for f in files), ["12.md", "5.md"])
            self.assertEqual(errors, [])

    def test_v26_v27_unsafe_characters_in_a_heading_or_title(self):
        for ch in ("\u2028", "\u0086", "\u2029", "\x85"):
            status, new, warns = plan_text("title: ~\n", body=f"\n# Head{ch}ing\n")
            self.assertEqual(status, "repair", repr(ch))
            front = new.split("\n---\n", 1)[0]
            self.assertNotIn(ch, front, repr(ch))  # written as an escape, never raw
            self.assertEqual(analyze_task_text(new).warnings, [], repr(ch))
            self.assertEqual(analyze_task_text(new).fm["title"], f"Head{ch}ing", repr(ch))
            status, new, warns = plan_text(f"title: foo{ch}bar: baz\n")
            if ch == "\u0086":  # not a line break: written as an escape
                self.assertEqual(status, "repair")
                self.assertNotIn(ch, new)
            else:  # a line break outside quotes: YAML and the reader disagree on the lines, so by hand
                self.assertEqual(status, "cannot", repr(ch))
                self.assertIsNone(new)

    def test_v08_whitespace_is_stripped_once_for_every_key_shape(self):
        for pad in (" ", "　"):
            status, new, warns, a = after("title: T\n", tail=TAIL.replace("[company, rnd]", f"a, b: c{pad}"))
            self.assertEqual(status, "repair", repr(pad))
            self.assertEqual(a.fm["depts"], "a, b: c", repr(pad))


class TestRound9MutantSurvivors(unittest.TestCase):
    """One input for each round-9 mutant that stayed alive and is not equivalent."""

    def _grammar(self, front, tail):
        status, new, warns = plan_text(front, tail)
        return status, "; ".join(warns)

    def test_an_indicator_at_the_start_of_a_list_item_is_refused_by_the_grammar(self):
        tail = "".join(l for l in TAIL.splitlines(True) if not l.startswith(("depts:", "owner:")))
        for c in "!&*{|>%@`":
            for name, front in (("block item", f"title: Foo: bar\ndepts:\n  - {c}foo\n  - bar\nowner: bob\n"),
                                ("flow item", f"title: Foo: bar\ndepts: [a, {c}x]\nowner: bob\n")):
                status, text = self._grammar(front, tail)
                self.assertEqual(status, "cannot", (c, name))
                self.assertIn('check "grammar"', text, (c, name))

    def test_an_anchor_alias_or_tag_at_the_start_of_a_scalar_is_refused_by_the_props_check(self):
        tail = "".join(l for l in TAIL.splitlines(True) if not l.startswith(("depts:", "owner:")))
        for c in "!&*":
            status, text = self._grammar(f"title: Foo: bar\nowner: {c}foo\ndepts: [a]\n", tail)
            self.assertEqual(status, "cannot", c)
            self.assertIn('check "props"', text, c)

    def test_an_empty_single_quoted_title_is_not_a_plain_value(self):
        tail = "".join(l for l in TAIL.splitlines(True) if not l.startswith("related_skills:"))
        status, new, warns = plan_text('related_skills: ["dq",a "b"]\ntitle: \'\'\n', tail, "\n# Head\n")
        self.assertEqual(status, "cannot")
        self.assertIsNone(new)
        self.assertIn('check "grammar"', "; ".join(warns))

    def test_a_block_list_item_with_a_bare_hash_comment_is_repaired(self):
        tail = "".join(l for l in TAIL.splitlines(True) if not l.startswith(("depts:", "created:")))
        tail = tail.replace("related_skills: [task-register]\n", "")
        status, new, warns, a = after('title: "t"\ncreated: 2026-1-32 1:00:00 x\nrelated_skills:\n  - alpha #\n  - gamma delta\n', tail)
        self.assertEqual(status, "repair")
        self.assertIn('comment cut at " #"', "; ".join(warns))
        self.assertEqual(a.warnings, [])

    def test_a_nan_in_an_untouched_task_key_does_not_stop_the_repair(self):
        raw = ("---\nissue_number: .nan\ncreated: 2026-02-30\n"
               + "".join(l for l in TAIL.splitlines(True) if not l.startswith("created")) + f"title: ok\n---\n{BODY}")
        status, new, warns = repair_mod.plan_repair(raw)
        self.assertEqual(status, "repair")
        self.assertIn("issue_number: .nan\n", new)

    def test_a_number_or_boolean_before_a_comment_is_written_as_its_text(self):
        for v in ("1.5 # note", "true # note", "5 # note"):
            status, new, warns, a = after(f"title: {v}\n")
            self.assertEqual(status, "repair", v)
            self.assertEqual(a.fm["title"], v, v)

    def test_file_tokens_decode_simple_escapes_and_keep_word_character_escapes(self):
        bs = chr(92)
        self.assertEqual(repair_mod._file_tokens("a" + bs + "tb"), ["a", "b"])
        self.assertEqual(repair_mod._file_tokens("a" + bs + "u0041b"), ["a", "u0041b"])
        self.assertEqual(repair_mod._file_tokens("a" + bs + "u0009b"), ["a", "b"])

    def test_a_hand_verdict_shows_no_leftover_note(self):
        from ui.render import render, task_advice, task_leftover
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "tasks").mkdir()
            p = root / "tasks" / "5.md"
            p.write_text("---\nissue_number: abc\ntitle: foo: bar\nnote: alpha\n" + TAIL + "---\n" + BODY, encoding="utf-8")
            t = parse_tasks(root)[0]
            self.assertEqual(task_advice(t), "hand")
            self.assertTrue(t.warnings)
            self.assertEqual(task_leftover(t), [])
            self.assertNotIn("still fix by hand", render("task.html", task=t, history=[], page_title="t"))


class TestOnlyTheOldTemplateCommentGoesBeforeTheFence(unittest.TestCase):
    """MINOR-1: before the opening fence the repair drops a BOM, blank space and the comment the old
    template put there (each <<TOKEN>> as it was, or replaced by one line of text). Anything else is a
    person's words: the file is refused, naming the check and the first words."""

    GOOD = "---\nissue_number: 5\ntitle: Foo: bar\n" + TAIL + "---\n" + BODY

    def test_a_person_s_comment_before_the_fence_is_refused_with_its_words(self):
        for comment in ("<!-- Sam: keep open until legal signs off the docs -->",
                        "<!--\nSam: keep open until legal signs off the docs\n-->",
                        "<!-- TEMPLATE: substitute the tokens listed below. -->"):
            with self.subTest(comment=comment):
                status, new, warns = repair_mod.plan_repair(comment + "\n" + self.GOOD)
                text = "; ".join(warns)
                self.assertEqual(status, "cannot")
                self.assertIsNone(new)
                self.assertIn('check "preamble"', text)
                self.assertIn("text before the opening fence", text)
                self.assertIn(comment.strip("<!->\n ").split()[0], text)
                self.assertIn("edit by hand", text)

    def test_the_refusal_also_holds_for_a_file_with_no_other_defect(self):
        clean = "<!-- Sam: keep open until legal signs off the docs -->\n---\nissue_number: 5\ntitle: Fine\n" + TAIL + "---\n" + BODY
        status, new, warns = repair_mod.plan_repair(clean)
        self.assertEqual(status, "cannot")
        self.assertIn("Sam: keep open until legal signs", "; ".join(warns))

    def test_the_old_template_comment_blank_space_and_a_bom_are_dropped(self):
        filled = OLD_COMMENT.replace("<<TITLE>>", "Foo: bar").replace("<<STATE>>", "active")
        for lead in (OLD_COMMENT + "\n\n", filled + "\n", "\n\n", "﻿", "﻿" + OLD_COMMENT + "\n", " \t\n" + OLD_COMMENT + "\n\n"):
            with self.subTest(lead=lead[:12]):
                status, new, warns = repair_mod.plan_repair(lead + self.GOOD)
                self.assertEqual(status, "repair", warns)
                self.assertTrue(new.startswith("---\n"))

    def test_a_template_comment_followed_by_a_person_s_comment_is_refused(self):
        status, new, warns = repair_mod.plan_repair(OLD_COMMENT + "\n<!-- Sam: keep this -->\n" + self.GOOD)
        self.assertEqual(status, "cannot")
        self.assertIn("Sam: keep this", "; ".join(warns))

    def test_a_template_comment_with_a_token_replaced_by_two_lines_is_not_the_template(self):
        two_lines = OLD_COMMENT.replace("<<TITLE>>", "one\ntwo")
        self.assertEqual(repair_mod.plan_repair(two_lines + "\n" + self.GOOD)[0], "cannot")

    def test_the_old_comment_is_the_one_in_the_template_history(self):
        self.assertTrue(OLD_COMMENT.startswith("<!--\nTEMPLATE: substitute the tokens listed below."))
        self.assertTrue(OLD_COMMENT.endswith("(e.g. \"[design-process, task-register]\")\n-->"))
        self.assertEqual(OLD_COMMENT.count("<<"), 10)

    def test_decide_and_apply_agree_on_the_refusal(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "tasks").mkdir()
            p = root / "tasks" / "5.md"
            text = "<!-- Sam: keep open until legal signs off the docs -->\n" + self.GOOD
            p.write_text(text, encoding="utf-8")
            verdict, reason, _ = decide(p)
            self.assertEqual(verdict, "cannot")
            self.assertIn('check "preamble"', reason)
            code, out = run(root, "--apply")
            self.assertEqual(code, 1)
            self.assertIn("Sam: keep open", out)
            self.assertEqual(p.read_text(encoding="utf-8"), text)


class TestAnAclOrATempFileThatCannotBeRemoved(unittest.TestCase):
    """MINOR-2: a temp file the run cannot remove is reported with its path and the run exits non-zero;
    ACLs and Linux file attributes are found only when the file is written."""

    def make(self, td):
        root = Path(td)
        (root / "tasks").mkdir()
        p = root / "tasks" / "5.md"
        p.write_text(front_text("title: Foo: bar\n" + TAIL), encoding="utf-8")
        return root, p

    def test_a_failed_replace_and_a_failed_unlink_report_the_temp_file(self):
        with tempfile.TemporaryDirectory() as td:
            root, p = self.make(td)
            with mock.patch.object(repair_mod.os, "replace", side_effect=PermissionError(13, "Permission denied")), \
                    mock.patch.object(Path, "unlink", side_effect=PermissionError(13, "Permission denied")):
                code, out = run(root, "--apply")
            left = sorted(x.name for x in (root / "tasks").iterdir())
            self.assertEqual(len(left), 2, left)
            tmp = next(x for x in left if x != "5.md")
            self.assertEqual(code, 1)
            self.assertIn("cannot repair tasks/5.md: could not write it (Permission denied)", out)
            self.assertIn(f"left temp file {root / 'tasks' / tmp}: Permission denied", out)
            self.assertIn("1 cannot repair", out)

    def test_a_removable_temp_file_is_removed_and_nothing_is_reported_left(self):
        with tempfile.TemporaryDirectory() as td:
            root, p = self.make(td)
            with mock.patch.object(repair_mod.os, "replace", side_effect=PermissionError(13, "Permission denied")):
                code, out = run(root, "--apply")
            self.assertEqual(code, 1)
            self.assertNotIn("left temp file", out)
            self.assertEqual([x.name for x in (root / "tasks").iterdir()], ["5.md"])

    def test_a_file_changed_while_repairing_with_an_unremovable_temp_exits_non_zero(self):
        with tempfile.TemporaryDirectory() as td:
            root, p = self.make(td)
            with mock.patch.object(repair_mod, "_unchanged", return_value=False), \
                    mock.patch.object(Path, "unlink", side_effect=PermissionError(13, "Permission denied")):
                code, out = run(root, "--apply")
            self.assertEqual(code, 1)
            self.assertIn("left temp file", out)
            self.assertIn("1 cannot repair, 0 skipped", out)

    @unittest.skipUnless(sys.platform == "darwin" and os.access("/bin/chmod", os.X_OK), "macOS ACLs only")
    def test_a_deny_delete_child_acl_leaves_the_page_saying_repair_and_apply_reporting_it(self):
        import subprocess
        with tempfile.TemporaryDirectory() as td:
            root, p = self.make(td)
            d = root / "tasks"
            r = subprocess.run(["chmod", "+a", "everyone deny delete_child", str(d)], capture_output=True)
            if r.returncode != 0:
                self.skipTest("ACLs are not available on this volume")
            try:
                self.assertEqual(decide(p)[0], "repair")  # an ACL is only found by writing
                code, out = run(root, "--apply")
                self.assertEqual(code, 1)
                self.assertIn("cannot repair tasks/5.md: could not write it", out)
                leftover = [x.name for x in d.iterdir() if x.name != "5.md"]
                if leftover:  # mkstemp was allowed and the unlink was not: it is reported, with its path
                    self.assertIn("left temp file", out)
                    self.assertIn(leftover[0], out)
            finally:
                subprocess.run(["chmod", "-N", str(d)], capture_output=True)

    def test_the_docs_name_acls_and_attributes_as_found_at_write_time(self):
        doc = repair_mod.__doc__
        self.assertIn("ACLs and Linux file attributes", doc)
        self.assertIn("left temp file", doc)


class TestStickyDirectoryRefusesOnlyWhoCannotReplace(unittest.TestCase):
    """NIT-2: in a sticky directory the file's owner, the directory's owner and root may replace a file."""

    def check(self, file_uid, dir_uid, euid):
        dir_st = types.SimpleNamespace(st_flags=0, st_mode=stat.S_IFDIR | stat.S_ISVTX | 0o777, st_uid=dir_uid)
        file_st = types.SimpleNamespace(st_nlink=1, st_flags=0, st_uid=file_uid, st_mode=stat.S_IFREG | 0o644)
        with mock.patch.object(repair_mod.os, "access", return_value=True), \
                mock.patch.object(repair_mod.os, "stat", return_value=dir_st), \
                mock.patch.object(repair_mod.os, "geteuid", return_value=euid):
            return repair_mod._cannot_write(Path("/x/tasks/5.md"), file_st)

    def test_refused_only_when_neither_owner_nor_root(self):
        self.assertIsNotNone(self.check(file_uid=1000, dir_uid=0, euid=2000))
        self.assertIn("sticky", self.check(file_uid=1000, dir_uid=0, euid=2000))
        self.assertIsNone(self.check(file_uid=2000, dir_uid=0, euid=2000))  # my own file
        self.assertIsNone(self.check(file_uid=1000, dir_uid=2000, euid=2000))  # my directory
        self.assertIsNone(self.check(file_uid=1000, dir_uid=3000, euid=0))  # root


class TestRound10Survivors(unittest.TestCase):
    """MINOR-4: one test for each reachable survivor of the round-9 review's table."""

    def test_a_list_item_starting_with_a_comma_or_a_backslash_is_refused(self):
        for item in (",ops", "\\ops"):
            for shape in ("block", "flow"):
                if item == ",ops" and shape == "flow":
                    continue  # in a flow list a comma separates items: `[,ops]` is the item `ops`
                front = ("title: Foo: bar\nrelated_skills:\n  - %s\n  - x #y\n" % item if shape == "block"
                         else "title: Foo: bar\nrelated_skills: [%s, x #y]\n" % item)
                tail = "".join(l for l in TAIL.splitlines(True) if not l.startswith("related_skills:"))
                status, new, warns = plan_text(front, tail)
                self.assertEqual(status, "cannot", (item, shape))
                self.assertIn('check "grammar"', "; ".join(warns), (item, shape))

    def test_a_key_line_without_a_space_after_the_first_colon_is_refused_for_any_key(self):
        for key, value in (("owner", "bob"), ("title", "Fix login"), ("state", "active"), ("owner", "a b")):
            tail = "".join(l for l in TAIL.splitlines(True) if not l.startswith(key + ":"))
            front = f"{key}:{value}\n" + ("title: x\n" if key != "title" else "")
            status, new, warns = plan_text(front, tail)
            text = "; ".join(warns)
            self.assertEqual(status, "cannot", (key, value))
            self.assertIsNone(new)
            self.assertIn('check "keys"', text, (key, value))
            self.assertIn(f'"{key}"', text)

    def test_the_reader_flags_a_comment_cut_from_a_continuation_line_of_a_list_key(self):
        warns = analyze_task_text(f"---\nissue_number: 5\ntitle: T\ndepts: ops\n  core #x\n{TAIL.replace('depts: [company, rnd]', '')}---\n{BODY}").warnings
        self.assertTrue(any('"depts"' in w and 'comment cut at " #"' in w for w in warns), warns)
        # and the repair then refuses it (a department name cannot carry a comment), so nothing is lost silently
        status, new, w2 = repair_mod.plan_repair(f"---\nissue_number: 5\ntitle: T\ndepts: ops\n  core #x\n{TAIL.replace('depts: [company, rnd]', '')}---\n{BODY}")
        self.assertEqual(status, "cannot")

    def test_a_number_as_a_list_item_is_written_as_its_text_and_a_comment_is_restored(self):
        tail = "".join(l for l in TAIL.splitlines(True) if not l.startswith("success_criteria:"))
        status, new, warns, a = after("title: T\nsuccess_criteria:\n  - 123\n  - b #x\n", tail)
        self.assertEqual(status, "repair", warns)
        self.assertEqual(a.fm["success_criteria"], ["123", "b #x"])
        self.assertEqual(a.warnings, [])

    def test_a_null_list_item_with_a_comment_is_refused_not_turned_into_text(self):
        """`- Null #x` is a null item with a comment. Writing it back as the text "Null #x" would change the value the
        console shows (None to text); the value backstop refuses. A number or a boolean with a comment is different:
        the console already shows those as their text, so the value does not change."""
        tail = "".join(l for l in TAIL.splitlines(True) if not l.startswith("success_criteria:"))
        for item in ("Null #~", "null #x", "~ #c"):
            status, new, warns = plan_text("title: T\nsuccess_criteria:\n  - ok\n  - %s\n" % item, tail)
            self.assertEqual(status, "cannot", item)
            self.assertIsNone(new)
            self.assertIn('check "backstop"', "; ".join(warns), item)
        for item in ("true #c", "123 #c"):
            status, new, warns, a = after("title: T\nsuccess_criteria:\n  - ok\n  - %s\n" % item, tail)
            self.assertEqual(status, "repair", (item, warns))
            self.assertEqual(a.fm["success_criteria"], ["ok", item])

    def test_the_note_is_empty_when_the_repair_clears_every_warning(self):
        from ui.render import task_repair
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "tasks").mkdir()
            (root / "tasks" / "5.md").write_text(
                "---\nissue_number: 5\ntitle: Fix: login\n" + TAIL.replace("owner: chief-of-staff", "owner: a: b") + "---\n" + BODY,
                encoding="utf-8")
            t = parse_tasks(root)[0]
            self.assertGreaterEqual(len([w for w in t.warnings if "unquoted value" in w]), 2, t.warnings)
            self.assertEqual(task_repair(t), ("repair", []))


class TestOneDecisionPerPage(unittest.TestCase):
    """NIT-1/NIT-3: a page render calls `decide` once; the note is the page's warnings that are not in the
    list of warnings `decide` says it clears."""

    def test_one_call_per_render_and_the_note_comes_from_it(self):
        from ui.render import render
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "tasks").mkdir()
            p = root / "tasks" / "5.md"
            p.write_text("---\nissue_number: abc\ntitle: foo: bar\n" + TAIL + "---\n" + BODY, encoding="utf-8")
            t = parse_tasks(root)[0]
            calls = []
            real = repair_mod.decide

            def counting(path):
                calls.append(path)
                return real(path)

            with mock.patch("ui.render.decide", side_effect=counting):
                html = render("task.html", task=t, history=[], page_title="t")
            self.assertEqual(len(calls), 1)
            self.assertIn("After the repair, still fix by hand: issue_number", html)

    def test_the_note_does_not_use_a_substring_test(self):
        from ui.render import task_repair
        t = mock.Mock(warnings=["unquoted value", "unquoted value in \"title\""], path=Path("x"))
        with mock.patch("ui.render.decide", return_value=("repair", "unquoted value in \"title\"", ['unquoted value in "title"'])):
            self.assertEqual(task_repair(t), ("repair", ["unquoted value"]))

    def test_decide_returns_the_cleared_warnings_for_a_repair_only(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "5.md"
            p.write_text(front_text("title: foo: bar\n" + TAIL), encoding="utf-8")
            verdict, reason, cleared = decide(p)
            self.assertEqual((verdict, cleared), ("repair", ['unquoted value in "title"']))
            p.write_text(front_text("title: foo: bar\nnote: alpha\n" + TAIL), encoding="utf-8")
            self.assertEqual(decide(p)[2], [])
            p.write_text(front_text('title: "foo"\n' + TAIL), encoding="utf-8")
            self.assertEqual(decide(p), ("ok", "", []))


class TestAnIdentifierKeyIsNotRepairedIntoAnInvalidName(unittest.TestCase):
    """NIT-4: `depts: ops #core` would become the department `ops #core`, which the console's own filter
    (`safe_slug`) rejects. It is refused; free-text keys keep the comment."""

    def test_a_comment_cut_from_a_department_is_refused_in_every_shape(self):
        tail = "".join(l for l in TAIL.splitlines(True) if not l.startswith("depts:"))
        for line in ("depts: ops #core\n", "depts: [ops, core #x]\n", "depts:\n  - ops\n  - core #x\n"):
            status, new, warns = plan_text("title: T\n" + line, tail)
            text = "; ".join(warns)
            self.assertEqual(status, "cannot", line)
            self.assertIsNone(new)
            self.assertIn('check "grammar"', text)
            self.assertIn('"depts"', text)
            self.assertIn("name the console rejects", text)

    def test_free_text_keys_keep_the_restore(self):
        tail = "".join(l for l in TAIL.splitlines(True) if not l.startswith("success_criteria:"))
        status, new, warns, a = after("title: T\nsuccess_criteria: Ship the importer fix #12\n", tail)
        self.assertEqual(status, "repair")
        self.assertEqual(a.fm["success_criteria"], "Ship the importer fix #12")
        status, new, warns, a = after("title: fix #12\n")
        self.assertEqual(a.fm["title"], "fix #12")

    def test_a_department_without_a_comment_is_still_repaired(self):
        status, new, warns, a = after("title: foo: bar\n")
        self.assertEqual(status, "repair")
        self.assertEqual(a.fm["depts"], ["company", "rnd"])


def _filled(**slots):
    """The old template comment with some tokens replaced by text (`TITLE="x"`), the rest left as they were."""
    out = OLD_COMMENT
    for k, v in slots.items():
        out = out.replace(f"<<{k}>>", v)
    return out


class TestTheTemplateCommentSlotsHoldNoForeignWords(unittest.TestCase):
    """MINOR-1 / NIT-3 (round 10): a token line of the old template comment is template text only when its slot
    holds the literal token, nothing, or words that appear, in order, on one line of the file after the opening fence.
    Otherwise the preamble is foreign and the refusal quotes the first line that differs from the template."""

    FRONT = "---\nissue_number: 5\ntitle: Close Docs\n" + TAIL.replace("deadline:\n", "deadline:\n") + "---\n" + BODY
    NOTE = "2026-12-01 hard deadline, Sam promised the editor"

    def refused(self, comment, front=None):
        status, new, warns = repair_mod.plan_repair(comment + "\n" + (front or self.FRONT))
        self.assertEqual(status, "cannot", warns)
        self.assertIsNone(new)
        text = "; ".join(warns)
        self.assertIn('check "preamble"', text)
        return text

    def test_a_person_s_words_in_a_slot_are_refused_and_quoted(self):
        for slots in ({"DEADLINE": self.NOTE}, {"OWNER_AGENT": "Sam: keep open until Docs signed"},
                      {"TITLE": "whole note on one slot"}):
            with self.subTest(slots=slots):
                comment = _filled(**slots)
                if " " in comment:
                    comment = comment.replace(" ", " ")
                text = self.refused(comment)
                first = next(iter(slots.values())).split()[0]
                self.assertIn(first, text)

    def test_the_refusal_quotes_the_line_that_differs_not_the_template_s_first_words(self):
        text = self.refused(OLD_COMMENT[:-3] + "  Sam: keep open until legal signs\n-->")
        self.assertIn("Sam: keep open until legal signs", text)
        self.assertNotIn("TEMPLATE: substitute", text)

    def test_a_fully_substituted_template_whose_values_are_in_the_frontmatter_repairs(self):
        comment = _filled(ISSUE_NUMBER="5", TITLE="Close Docs", OWNER_AGENT="chief-of-staff",
                          DEPARTMENTS="company, rnd", STATE="active", CREATED_DATE="2026-10-01",
                          COMPLETED_DATE="", SUCCESS_CRITERIA="[one, two]", DEADLINE="",
                          RELATED_SKILLS="[task-register]")
        status, new, warns = repair_mod.plan_repair(comment + "\n" + self.FRONT)
        self.assertEqual(status, "repair", warns)
        self.assertTrue(new.startswith("---\n"))

    def test_a_template_with_blank_slots_repairs(self):
        blank = re.sub(r"<<[A-Z_]+>>", "", OLD_COMMENT)
        status, new, warns = repair_mod.plan_repair(blank + "\n" + self.FRONT)
        self.assertEqual(status, "repair", warns)
        self.assertTrue(new.startswith("---\n"))

    def test_the_slot_words_must_be_in_the_file_after_the_fence_not_in_the_comment_itself(self):
        # "promised" is in the comment only; it is not among the words from the fence on.
        self.refused(_filled(DEADLINE="Close Docs promised"))
        status, new, warns = repair_mod.plan_repair(_filled(DEADLINE="Close Docs") + "\n" + self.FRONT)
        self.assertEqual(status, "repair", warns)

    def test_an_empty_comment_before_the_fence_is_refused_like_any_other(self):
        text = self.refused("<!-- -->")
        self.assertIn("empty comment", text)
        self.refused("<!---->")

    def test_the_refusal_names_the_first_foreign_comment_and_marks_a_long_one(self):
        words = " ".join(f"w{i}" for i in range(12))
        text = self.refused(f"<!-- first foreign {words} -->\n<!-- second foreign -->")
        self.assertIn("first foreign", text)
        self.assertNotIn("second foreign", text)
        self.assertIn("w5 ...", text)  # eight words (two are "first foreign"), then an ellipsis
        self.assertNotIn("w6", text)
        self.assertNotIn(" ...", self.refused("<!-- a b c -->"))

    def test_a_long_or_blank_differing_line_is_shortened_or_named(self):
        long_line = "x" * 200
        text = self.refused(_filled(DEADLINE="") .replace("Substitution tokens:", long_line))
        self.assertIn("x" * 80 + " ...", text)
        self.assertNotIn("x" * 81, text)
        text = self.refused(OLD_COMMENT.replace("Substitution tokens:", ""))
        self.assertIn("(blank line)", text)

    def test_a_token_replaced_by_another_token_is_not_the_template(self):
        self.refused(_filled(TITLE="<<OWNER_AGENT>>"))

    def test_a_comment_cut_short_or_with_a_line_added_is_refused(self):
        self.refused("<!--\nTEMPLATE: substitute the tokens listed below.\n-->")
        self.refused(OLD_COMMENT.replace("\n-->", "\n  extra line\n-->"))

    def test_the_foreign_preamble_is_refused_whatever_the_line_endings_are(self):
        raw = "<!-- Sam: keep this -->\r\n" + self.FRONT.replace("\n", "\r\n", 3)
        status, new, warns = repair_mod.plan_repair(raw)
        self.assertEqual(status, "cannot")
        self.assertIn('check "preamble"', "; ".join(warns))

    def test_slot_words_are_compared_as_words_not_as_substrings_or_pieces(self):
        # words found only in the body count (the file from the fence on); the token padded with spaces is the token;
        # a hyphenated word is one word; commas and brackets separate words
        status, new, warns = repair_mod.plan_repair(_filled(DEADLINE="Goal") + "\n" + self.FRONT)
        self.assertEqual(status, "repair", warns)
        status, new, warns = repair_mod.plan_repair(OLD_COMMENT.replace("<<TITLE>>", "  <<TITLE>>  ") + "\n" + self.FRONT)
        self.assertEqual(status, "repair", warns)
        self.refused(_filled(DEADLINE="Close-Docs"))
        status, new, warns = repair_mod.plan_repair(_filled(DEPARTMENTS="company,rnd") + "\n" + self.FRONT)
        self.assertEqual(status, "repair", warns)

    LOSS_FRONT = ("---\nissue_number: 5\ntitle: Close Docs with the editor\n"
                  + TAIL.replace("chief-of-staff", "legal-lead") + "---\n" + BODY)

    def test_slot_words_that_are_scattered_over_several_lines_of_the_file_are_refused(self):
        # NIT-1 (round 11): every word is somewhere after the fence, but not in order on one line.
        for slots in ({"OWNER_AGENT": "legal-lead with the editor"}, {"STATE": "Docs Close"},
                      {"TITLE": "deadline state title"}):
            with self.subTest(slots=slots):
                self.refused(_filled(**slots), self.LOSS_FRONT)

    def test_slot_words_in_file_order_but_spread_over_several_lines_are_refused(self):
        # NIT-B (round 12): the words follow file order (title, owner, state lines) yet no one line holds them all.
        front = "---\nissue_number: 5\ntitle: Close Docs\nowner_agent: legal-lead\nstate: active\n---\n" + BODY
        self.refused(_filled(TITLE="Close Docs legal-lead active"), front)

    def test_a_second_template_comment_before_the_fence_is_refused(self):
        text = self.refused(OLD_COMMENT + "\n" + OLD_COMMENT)
        self.assertIn("more than one template comment", text)
        text = self.refused(_filled(TITLE="Close Docs") + "\n" + OLD_COMMENT)
        self.assertIn("more than one template comment", text)

    def test_a_foreign_comment_first_is_quoted_even_when_more_comments_follow(self):
        text = self.refused("<!-- Sam: keep open -->\n" + OLD_COMMENT)
        self.assertIn("Sam: keep open", text)

    def test_slot_words_in_order_on_one_line_repair(self):
        for slots in ({"TITLE": "Close Docs"}, {"TITLE": "Docs with the editor"}, {"OWNER_AGENT": "legal-lead"},
                      {"TITLE": "Close the editor"}):
            with self.subTest(slots=slots):
                status, new, warns = repair_mod.plan_repair(_filled(**slots) + "\n" + self.LOSS_FRONT)
                self.assertEqual(status, "repair", warns)

    def test_slot_words_are_case_sensitive(self):
        self.refused(_filled(TITLE="close Docs"), self.LOSS_FRONT)
        self.refused(_filled(TITLE="Keep"), self.FRONT.replace("Close Docs", "keep it"))
        status, new, warns = repair_mod.plan_repair(_filled(TITLE="keep") + "\n" + self.FRONT.replace("Close Docs", "keep it"))
        self.assertEqual(status, "repair", warns)

    def test_a_trailing_dot_makes_a_different_word(self):
        front = self.FRONT.replace("Close Docs", "Close Docs now")
        self.refused(_filled(TITLE="Close Docs now."), front)
        status, new, warns = repair_mod.plan_repair(_filled(TITLE="Close Docs now") + "\n" + front)
        self.assertEqual(status, "repair", warns)
        self.refused(_filled(TITLE="Close Docs"), self.FRONT.replace("Close Docs", "Close Docs."))

    def test_a_nested_comment_start_before_the_template_is_refused(self):
        # The comment runs from the first "<!--" to the first "-->": the person's words are inside it.
        text = self.refused("<!-- Sam: keep open until legal signs " + OLD_COMMENT)
        self.assertIn("Sam: keep open until legal signs", text)


class TestADepartmentCommentWithATab(unittest.TestCase):
    """MINOR-2: a TAB before `#` also starts a YAML comment, so `depts` with one is refused, in flow and block form."""

    def test_a_tab_before_the_hash_in_a_department_is_refused(self):
        tail = "".join(l for l in TAIL.splitlines(True) if not l.startswith("depts:"))
        for line in ("depts: [ops\t#core, x]\n", "depts:\n  - ops\t#core\n  - x\n", "depts: ops\t#core\n"):
            with self.subTest(line=line):
                status, new, warns = plan_text("title: T\n" + line, tail)
                self.assertEqual(status, "cannot", warns)
                self.assertIsNone(new)
                self.assertIn('"depts"', "; ".join(warns))
                self.assertIn("name the console rejects", "; ".join(warns))


class TestTheConsoleReadsADepartmentAsYamlDoes(unittest.TestCase):
    """NIT-4 (round 10): `depts: ops #core` is the department `ops` with a warning, not `ops #core`."""

    def test_the_department_filter_value_is_ops(self):
        t = analyze_task_text("---\nissue_number: 5\ntitle: T\n"
                              + TAIL.replace("[company, rnd]", "ops #core") + "---\n" + BODY)
        self.assertEqual(t.fm["depts"], "ops")
        self.assertTrue(any("depts" in w for w in t.warnings), t.warnings)
        from ui.validate import safe_slug
        safe_slug("ops")
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "tasks").mkdir()
            (root / "tasks" / "5.md").write_text(
                "---\nissue_number: 5\ntitle: T\n" + TAIL.replace("[company, rnd]", "ops #core") + "---\n" + BODY,
                encoding="utf-8")
            task = parse_tasks(root)[0]
            self.assertEqual(task.depts, ["ops"])
            for d in task.depts:
                safe_slug(d)


class TestADepartmentWithANonTextItemIsReadAsRecovered(unittest.TestCase):
    """Only a ` #` comment leaves YAML's department; any other recovery shows the recovered items."""

    def test_a_number_in_a_department_list_is_shown_as_its_text(self):
        t = analyze_task_text("---\nissue_number: 5\ntitle: T\n" + TAIL.replace("[company, rnd]", "[ops, 5]") + "---\n" + BODY)
        self.assertEqual(t.fm["depts"], ["ops", "5"])


class TestDropOfAMissingTempFile(unittest.TestCase):
    """MINOR-2: a temp file that is already gone is not a leftover: True, and nothing printed."""

    def test_drop_on_a_missing_path_returns_true_with_no_message(self):
        with tempfile.TemporaryDirectory() as td:
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                ok = repair_mod._drop(Path(td) / "gone.tmp")
            self.assertIs(ok, True)
            self.assertEqual(out.getvalue(), "")
