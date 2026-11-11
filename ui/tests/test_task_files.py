"""Task files must always be readable: lenient reader, renderer round trip, template guard."""

import re
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from ui.data import REPO_ROOT, _Flow, _scan_flow, analyze_task_text, parse_tasks
from ui.render import render
from ui.tests.test_repair_tasks import OLD_COMMENT

SCRIPT = REPO_ROOT / "shared" / "scripts" / "task-state.mjs"
TEMPLATE = REPO_ROOT / "shared" / "templates" / "TASK.md.tmpl"

GOOD_TAIL = (
    "owner: chief-of-staff\n"
    "depts: [company, rnd]\n"
    "state: active\n"
    "created: 2026-10-01\n"
    "completed:\n"
    "success_criteria: [one, two]\n"
    "deadline:\n"
    "related_skills: [task-register]\n"
)
BODY = "\n# Heading text\n\n## Goal\n\nSome goal.\n"


_KEPT: list = []  # temp dirs of tasks whose file must still exist (the page reads it for its advice)


def _load(text: str, bom: bool = False, keep: bool = False):
    """Write `text` as tasks/5.md in a temp root and return the parsed Task."""
    td = tempfile.TemporaryDirectory()
    if keep:
        _KEPT.append(td)
    root = Path(td.name)
    (root / "tasks").mkdir()
    data = text.encode("utf-8")
    if bom:
        data = b"\xef\xbb\xbf" + data
    (root / "tasks" / "5.md").write_bytes(data)
    tasks = parse_tasks(repo_root=root)
    if not keep:
        td.cleanup()
    assert len(tasks) == 1
    return tasks[0]


def _doc(title_line: str, tail: str = GOOD_TAIL, lead: str = "") -> str:
    return f"{lead}---\nissue_number: 5\n{title_line}\n{tail}---\n{BODY}"


class TestLenientTaskReader(unittest.TestCase):
    def assert_recovered(self, t, title):
        self.assertEqual(t.issue_number, 5)
        self.assertEqual(t.title, title)
        self.assertEqual(t.depts, ["company", "rnd"])
        self.assertEqual(t.created, "2026-10-01")
        self.assertEqual(t.owner, "chief-of-staff")
        self.assertTrue(t.warnings)

    def test_well_formed_has_no_warnings(self):
        t = _load(_doc('title: "Set up: a thing #1"'))
        self.assertEqual(t.warnings, [])
        self.assertEqual(t.title, "Set up: a thing #1")
        self.assertEqual(t.completed, "")

    def test_class1_template_comment_before_fence(self):
        lead = OLD_COMMENT + "\n\n"
        t = _load(_doc('title: "Plain title"', lead=lead))
        self.assert_recovered(t, "Plain title")
        self.assertIn("template comment before frontmatter", t.warnings)

    def test_class2_leading_blank_line(self):
        t = _load(_doc('title: "Plain title"', lead="\n"))
        self.assert_recovered(t, "Plain title")
        self.assertIn("blank lines before frontmatter", t.warnings)

    def test_class3_unquoted_colon_title(self):
        t = _load(_doc("title: Docs: set up a sample page"))
        self.assert_recovered(t, "Docs: set up a sample page")
        self.assertIn('unquoted value in "title"', t.warnings)
        # The other keys parsed on their own and are not reported.
        self.assertEqual(len(t.warnings), 1)

    def test_class4_hash_eats_flow_list(self):
        tail = GOOD_TAIL.replace("[one, two]", "[one, two in the #12 format, three]")
        t = _load(_doc("title: Plain title", tail=tail))
        self.assert_recovered(t, "Plain title")
        self.assertEqual(t.success_criteria, ["one", "two in the #12 format", "three"])
        self.assertIn('unquoted value in "success_criteria"', t.warnings)

    def test_class4_hash_silently_truncates_title(self):
        t = _load(_doc("title: Fix the widget #12"))
        self.assert_recovered(t, "Fix the widget #12")
        self.assertIn('unquoted value in "title" (comment cut at " #")', t.warnings)

    def test_crlf_and_bom_with_a_broken_title(self):
        text = _doc("title: Docs: set up a sample page", lead="\n").replace("\n", "\r\n")
        t = _load(text, bom=True)
        self.assert_recovered(t, "Docs: set up a sample page")

    def test_crlf_and_bom_alone_are_not_a_defect(self):
        text = _doc('title: "Plain title"').replace("\n", "\r\n")
        t = _load(text, bom=True)
        self.assertEqual(t.title, "Plain title")
        self.assertEqual(t.warnings, [])

    def test_title_falls_back_to_heading(self):
        tail = GOOD_TAIL
        t = _load(f"---\nissue_number: 5\n{tail}---\n{BODY}")
        self.assertEqual(t.title, "Heading text")
        self.assertIn('title taken from the "# " heading', t.warnings)

    def test_no_frontmatter_is_reported(self):
        t = _load("Just text.\n")
        self.assertEqual(t.title, "")
        self.assertEqual(t.warnings, ["no frontmatter"])


def _tail(**over):
    """GOOD_TAIL with some keys' lines replaced."""
    out = []
    for line in GOOD_TAIL.splitlines(keepends=True):
        key = line.split(":", 1)[0]
        out.append(over.get(key, line))
    return "".join(out)


class TestRecoveryKeepsEveryWord(unittest.TestCase):
    """Hand-written expected values, never the reader's own output."""

    def test_wrapped_flow_list_joins_until_the_closing_bracket(self):
        tail = _tail(success_criteria="success_criteria: [alpha,\n  beta in the #12 format, gamma]\n")
        t = _load(_doc("title: Plain", tail=tail))
        self.assertEqual(t.success_criteria, ["alpha", "beta in the #12 format", "gamma"])
        self.assertEqual(t.related_skills, ["task-register"])
        self.assertTrue(t.warnings)

    def test_wrapped_plain_title_folds_with_single_spaces(self):
        t = _load(_doc("title: Docs: set up\n  a sample page"))
        self.assertEqual(t.title, "Docs: set up a sample page")

    def test_bullets_after_a_key_that_starts_on_its_own_line(self):
        tail = _tail(success_criteria="success_criteria: - alpha\n- beta\n")
        t = _load(_doc("title: Plain", tail=tail))
        self.assertEqual(t.success_criteria, ["alpha", "beta"])

    def test_title_that_starts_with_a_bracket_stays_a_string(self):
        t = _load(_doc("title: [Bug] Fix login"))
        self.assertEqual(t.title, "[Bug] Fix login")
        self.assertIsInstance(t.title, str)

    def test_quotes_are_dropped_only_from_one_quoted_scalar(self):
        t = _load(_doc('title: "Foo" renamed to "Bar"'))
        self.assertEqual(t.title, '"Foo" renamed to "Bar"')
        t = _load(_doc("title: 'It''s: fine'"))
        self.assertEqual(t.title, "It's: fine")

    def test_commas_inside_quotes_do_not_split_items(self):
        tail = _tail(success_criteria='success_criteria: ["Ship A, then B", C in #12]\n')
        t = _load(_doc("title: Plain", tail=tail))
        self.assertEqual(t.success_criteria, ["Ship A, then B", "C in #12"])

    def test_tab_before_hash_cuts_a_title_too(self):
        t = _load(_doc("title: Fix the widget\t#12"))
        self.assertEqual(t.title, "Fix the widget\t#12")
        self.assertTrue(t.warnings)

    def test_block_list_item_cut_at_hash(self):
        tail = _tail(success_criteria="success_criteria:\n  - Track #12\n  - Fine one\n")
        t = _load(_doc("title: Plain", tail=tail))
        self.assertEqual(t.success_criteria, ["Track #12", "Fine one"])
        self.assertTrue(t.warnings)

    def test_block_list_item_that_loads_as_a_mapping(self):
        tail = _tail(success_criteria="success_criteria:\n  - Ship it (phase: 2)\n")
        t = _load(_doc("title: Plain", tail=tail))
        self.assertEqual(t.success_criteria, ["Ship it (phase: 2)"])
        self.assertTrue(t.warnings)

    def test_non_text_titles_are_recovered_as_written(self):
        for raw in ("yes", "0x1F", "123"):
            t = _load(_doc(f"title: {raw}"))
            self.assertEqual(t.title, raw)
            self.assertIsInstance(t.title, str)
            self.assertTrue(t.warnings, raw)

    def test_none_empty_string_and_empty_list_are_one_empty_value_read_without_a_warning(self):
        for spelling in ("null", "~", "", '""', "''", "[]"):
            with self.subTest(title=spelling):
                t = _load(_doc(f"title: {spelling}"))
                # One empty value: the title falls back to the heading, and nothing else is said.
                self.assertEqual(t.warnings, ['title taken from the "# " heading'])
        for spelling in ("null", "~", "", "[]", '""'):
            with self.subTest(depts=spelling):
                t = _load(_doc("title: Plain", tail=_tail(depts=f"depts: {spelling}\n")))
                self.assertEqual((t.depts, t.warnings), ([], []))

    def test_a_date_looking_title_is_already_text(self):
        t = _load(_doc("title: 2026-01-01"))
        self.assertEqual(t.title, "2026-01-01")
        self.assertEqual(t.warnings, [])

    def test_only_three_keys_are_lists(self):
        t = _load(_doc("title: Plain", tail=_tail(owner="owner: [a, b]\n")))
        self.assertEqual(t.owner, "[a, b]")

    def test_dates_stay_text_and_cannot_raise(self):
        for bad in ("2026-02-30", "2026-13-01"):
            t = _load(_doc('title: "Plain"', tail=_tail(created=f"created: {bad}\n")))
            self.assertEqual(t.created, bad)
            self.assertEqual(t.warnings, ['unquoted value in "created" (a date or time that is not real)'])
        t = _load(_doc('title: "Plain"', tail=_tail(created="created: 2026-10-01\n")))
        self.assertEqual(t.created, "2026-10-01")

    def test_a_value_yaml_cannot_construct_does_not_raise(self):
        t = _load(_doc("title: Docs: x", tail=_tail(state="state: !!int x\n", created="created: 2026-13-01\n")))
        self.assertEqual(t.title, "Docs: x")
        self.assertEqual(t.created, "2026-13-01")

    def test_trailing_text_after_the_list_is_flagged_as_lossy(self):
        tail = _tail(success_criteria="success_criteria: [alpha, beta] gamma\n")
        t = _load(_doc("title: Plain", tail=tail))
        self.assertEqual(t.success_criteria, ["alpha", "beta"])
        self.assertTrue(any("may not keep every word" in w for w in t.warnings), t.warnings)

    def test_garbled_issue_number_falls_back_to_the_file_name(self):
        t = _load(_doc('title: "Plain"').replace("issue_number: 5", "issue_number: abc"))
        self.assertEqual(t.issue_number, 5)

    def test_unreadable_file_still_yields_a_row(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "tasks").mkdir()
            (root / "tasks" / "7.md").write_bytes(b"---\ntitle: \xff\xfe\n---\n")
            tasks = parse_tasks(repo_root=root)
        self.assertEqual([t.issue_number for t in tasks], [7])
        self.assertEqual(tasks[0].warnings, ["unreadable file"])


class TestWarningsRender(unittest.TestCase):
    def test_tasks_table_shows_the_marker(self):
        t = _load(_doc("title: Docs: <b>x</b>"))
        html = render("tasks.html", tasks=[t], total=1, filters={}, all_depts=[], all_owners=[])
        self.assertIn("frontmatter recovered", html)
        self.assertIn('class="warn"', html)
        self.assertNotIn("<b>x</b>", html)  # autoescaped

    def test_tasks_table_has_no_marker_for_a_good_file(self):
        t = _load(_doc('title: "Fine"'))
        html = render("tasks.html", tasks=[t], total=1, filters={}, all_depts=[], all_owners=[])
        self.assertNotIn("frontmatter recovered", html)

    def test_task_page_shows_the_warning_box(self):
        t = _load(_doc("title: Docs: set up"), keep=True)
        html = render("task.html", task=t, gh_data=None, gh_warning=None)
        self.assertIn("frontmatter is malformed", html)
        self.assertIn('unquoted value in &#34;title&#34;', html)
        self.assertIn("python3 -m ui.repair_tasks --apply", html)
        self.assertNotIn("by hand", html)

    def test_task_page_says_edit_by_hand_when_the_repair_cannot_act(self):
        shapes = {
            "duplicate key": _doc("title: A\ntitle: B"),
            "lossy value": _doc("title: Plain", tail=_tail(success_criteria="success_criteria:\n  - alpha\n  # note words\n  - beta\n")),
            "not repairable": _doc("title: Docs: x\nnote: alpha"),
            "list never closed": _raw_doc("title: Plain\nsuccess_criteria: [alpha,\nstate: paused\n"),
            "unusable issue_number": _doc("title: Plain").replace("issue_number: 5", "issue_number: .inf"),
        }
        for name, text in shapes.items():
            with self.subTest(shape=name):
                t = _load(text, keep=True)
                self.assertTrue(t.warnings)
                html = render("task.html", task=t, gh_data=None, gh_warning=None)
                self.assertIn("Edit the file by hand", html)
                self.assertNotIn("ui.repair_tasks --apply", html)

    def test_task_page_with_both_kinds_of_warning_does_not_promise_a_repair(self):
        t = _load(_doc("title: A\ntitle: B: c"), keep=True)
        html = render("task.html", task=t, gh_data=None, gh_warning=None)
        self.assertIn("Edit the file by hand", html)
        self.assertNotIn("ui.repair_tasks --apply", html)


class TestTemplateGuard(unittest.TestCase):
    def test_starts_with_fence_and_uses_only_known_tokens(self):
        text = TEMPLATE.read_text(encoding="utf-8")
        self.assertTrue(text.startswith("---\n"))
        known = {
            "ISSUE_NUMBER", "TITLE", "OWNER_AGENT", "DEPARTMENTS", "STATE", "CREATED_DATE",
            "COMPLETED_DATE", "SUCCESS_CRITERIA", "DEADLINE", "RELATED_SKILLS",
        }
        self.assertLessEqual(set(re.findall(r"<<([A-Z0-9_]+)>>", text)), known)
        self.assertNotIn("<!--", text)


NASTY = [
    "Docs: set up a sample page",
    "Fix the widget #12",
    '"Quoted" start',
    "it's \u2014 'mixed' \"quotes\"",
    "[bracket] start",
    "{brace} start",
    "- dash start",
    "* star",
    "& anchor",
    "! tag",
    "% percent",
    "@at",
    "`backtick`",
    "C:\\new\\table",
    "\u00dcn\u00efc\u00f8d\u00e9: \u6807\u9898 \u2713",
    "emoji \U0001F680 title",
    "tab\there",
    "line" + chr(0x2028) + "separator",
    "nel" + chr(0x85) + "char",
    "c1" + chr(0x90) + "control",
    "yes",
    "null",
    "123",
    "2026-01-01",
    "~",
    "Use the << operator",
    "<<TITLE>> stays literal",
    "a >> b << c",
]

# Owners that an unquoted YAML scalar would turn into a boolean, null or number.
NASTY_OWNERS = ["no", "on", "true", "null", "123", "0777", "0x1f"]


@unittest.skipUnless(shutil.which("node"), "node is not on PATH")
class TestRendererRoundTrip(unittest.TestCase):
    def test_every_nasty_value_survives_exactly(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "shared" / "templates").mkdir(parents=True)
            shutil.copy(TEMPLATE, root / "shared" / "templates" / "TASK.md.tmpl")
            for n, value in enumerate(NASTY, start=1):
                r = subprocess.run(
                    [
                        "node", str(SCRIPT), "write-task", "--root", str(root), "--issue", str(n),
                        "--title", value, "--depts", "company,rnd",
                        "--criterion", value, "--criterion", "plain criterion",
                    ],
                    capture_output=True, text=True,
                )
                self.assertEqual(r.returncode, 0, f"{value!r}: {r.stderr}")
            tasks = {t.issue_number: t for t in parse_tasks(repo_root=root)}
            self.assertEqual(len(tasks), len(NASTY))
            for n, value in enumerate(NASTY, start=1):
                t = tasks[n]
                self.assertEqual(t.warnings, [], f"{value!r}")
                self.assertEqual(t.title, value)
                self.assertIsInstance(t.title, str)
                self.assertEqual(t.success_criteria, [value, "plain criterion"])
                self.assertEqual(t.depts, ["company", "rnd"])
                self.assertEqual(t.owner, "chief-of-staff")
                self.assertEqual(t.completed, "")
                self.assertTrue((root / "tasks" / f"{n}.md").read_text(encoding="utf-8").startswith("---\n"))

    def test_every_nasty_owner_survives_exactly(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "shared" / "templates").mkdir(parents=True)
            shutil.copy(TEMPLATE, root / "shared" / "templates" / "TASK.md.tmpl")
            for n, owner in enumerate(NASTY_OWNERS, start=1):
                r = subprocess.run(
                    ["node", str(SCRIPT), "write-task", "--root", str(root), "--issue", str(n),
                     "--title", "Plain", "--depts", "rnd", "--owner", owner, "--state", "paused"],
                    capture_output=True, text=True,
                )
                self.assertEqual(r.returncode, 0, f"{owner!r}: {r.stderr}")
            tasks = {t.issue_number: t for t in parse_tasks(repo_root=root)}
            for n, owner in enumerate(NASTY_OWNERS, start=1):
                self.assertEqual((tasks[n].owner, tasks[n].warnings), (owner, []), owner)


class TestReaderWarnsAboutWhatItCannotKeep(unittest.TestCase):
    """Warnings for text the reader would otherwise drop silently. Values are written by hand."""

    def test_a_line_no_key_owns_is_reported_when_the_file_does_not_parse(self):
        t = _load(_doc("title: Fix\nthe widget"))
        self.assertEqual(t.title, "Fix")
        self.assertEqual(t.warnings, ["frontmatter line 3 belongs to no key and the file does not parse"])

    def test_duplicate_keys_are_reported_even_when_the_file_parses(self):
        t = _load(_doc("title: A\ntitle: B"))
        self.assertEqual(t.warnings, ['duplicate key "title"'])

    def test_duplicate_keys_in_a_file_that_does_not_parse(self):
        t = _load(_doc("title: A\ntitle: B: c"))
        self.assertIn('duplicate key "title"', t.warnings)

    def test_a_comment_line_with_words_inside_a_flow_list_is_reported(self):
        tail = _tail(success_criteria="success_criteria: [alpha,\n  #12 beta,\n  gamma]\n")
        t = _load(_doc("title: Plain", tail=tail))
        self.assertEqual(t.success_criteria, ["alpha", "gamma"])
        self.assertEqual(t.warnings, [
            'unquoted value in "success_criteria" (comment line with words inside the value)',
            'recovered "success_criteria" may not keep every word',
        ])

    def test_a_comment_line_after_the_end_of_a_value_belongs_to_no_key(self):
        for front in ("title: Fix the widget\n  #12 regression", 'title: "Fix the widget"\n  # note words'):
            t = _load(_doc(front))
            self.assertEqual((t.title, t.warnings), ("Fix the widget", []), front)
        t = _load(_doc('title: "Plain"', tail=_tail(owner='owner: "x"\n  # note words\n')))
        self.assertEqual((t.owner, t.warnings), ("x", []))

    def test_a_comment_line_between_the_lines_of_a_value_is_reported(self):
        t = _load(_doc('title: "Plain"', tail=_tail(success_criteria="success_criteria:\n  - alpha\n  # note words\n  - beta\n")))
        self.assertTrue(any("comment line with words" in w for w in t.warnings), t.warnings)

    def test_a_comment_line_without_words_is_not_a_problem(self):
        tail = _tail(success_criteria="success_criteria:\n  - alpha\n  #\n  - beta\n")
        t = _load(_doc("title: Plain", tail=tail))
        self.assertEqual((t.success_criteria, t.warnings), (["alpha", "beta"], []))

    def test_a_comment_line_between_keys_is_not_part_of_a_value(self):
        t = _load(_doc("title: Plain\n# note with words\n  # indented note after a comment"))
        self.assertEqual(t.warnings, [])

    def test_an_infinite_issue_number_does_not_raise(self):
        for value in (".inf", "-.inf", ".nan"):
            with self.subTest(value=value):
                t = _load(_doc("title: Plain").replace("issue_number: 5", f"issue_number: {value}"))
                self.assertEqual(t.issue_number, 5)
                self.assertEqual(t.warnings, ["issue_number is not a usable number; the file name is used"])

    def test_the_flow_scanner_gives_the_same_answer_fed_in_pieces(self):
        for pieces, items in (
            (['"alpha', 'beta", gamma', "delta]"], ['"alpha beta"', "gamma delta"]),
            (['"a\\', 'b", c]'], ['"a\\ b"', "c"]),  # a backslash at the end of a piece escapes the joining space
            (["'p'", "'q', r #1]"], ["'p' 'q'", "r #1"]),
        ):
            with self.subTest(pieces=pieces):
                f = _Flow()
                f.feed(pieces[0])
                for piece in pieces[1:]:
                    f.feed(" " + piece)
                self.assertEqual(f.result()[0], items)
                self.assertEqual(_scan_flow("[" + " ".join(pieces))[0], items)


def _raw_doc(front: str) -> str:
    return f"---\nissue_number: 5\n{front}---\n{BODY}"


def scales_linearly(testcase, make, n=10000, fn=analyze_task_text):
    """Read an input of n and of 4n units: quadrupling it must not take more than 8 times as long
    (linear is 4, quadratic is 16). Load-robust by construction: CPU time of this process
    (`time.process_time`), not wall time, so a busy machine does not stretch it; the two sizes are
    measured alternately, so a burst of load hits both; each size takes the best of five runs. The size
    is grown until one read takes at least 15 ms, so the clock is not what is being measured."""
    import time

    def one(raw):
        start = time.process_time()
        fn(raw)
        return time.process_time() - start

    while True:
        small = make(n)
        if min(one(small) for _ in range(5)) >= 0.015 or n >= 64 * 100000:
            break
        n *= 2
    big = make(4 * n)
    small_runs, big_runs = [], []
    for _ in range(5):
        small_runs.append(one(small))
        big_runs.append(one(big))
    ts, tb = min(small_runs), min(big_runs)
    testcase.assertLess(tb / max(ts, 1e-6), 8.0, f"t({n})={ts:.4f}s t({4 * n})={tb:.4f}s")


class TestReaderKeepsKeysApart(unittest.TestCase):
    """A line that looks like a key must never move a value into a phantom key or fold a real key
    into another value without a warning. Expected values are written by hand."""

    def test_an_unindented_word_line_inside_an_open_list_is_part_of_the_list(self):
        front = "title: Docs: set up\n" + _tail(success_criteria="success_criteria: [alpha,\nfoo: beta]\n")
        t = _load(_raw_doc(front))
        self.assertEqual(t.success_criteria, ["alpha", "foo: beta"])
        self.assertEqual(t.created, "2026-10-01")  # nothing after the list was swallowed

    def test_an_unclosed_list_followed_by_an_unindented_task_key_is_lossy(self):
        front = "title: Docs: set up\nsuccess_criteria: [alpha,\nstate: paused\n" + _tail(success_criteria="", state="")
        t = _load(_raw_doc(front))
        self.assertIn('"success_criteria" starts a [ list that is never closed (frontmatter line 3)', t.warnings)
        self.assertEqual(t.created, "2026-10-01")  # the keys after it are still read as keys

    def test_an_unclosed_list_followed_by_an_unindented_word_line_is_lossy(self):
        front = "title: Docs: set up\nsuccess_criteria: [alpha,\nfoo: beta\n" + _tail(success_criteria="")
        t = _load(_raw_doc(front))
        self.assertTrue(any("never closed" in w for w in t.warnings), t.warnings)

    def test_a_fence_inside_an_open_list_is_lossy(self):
        t = _load("---\nissue_number: 5\ntitle: Plain\nsuccess_criteria: [alpha,\n---\n beta]\n")
        self.assertTrue(any("never closed" in w for w in t.warnings), t.warnings)

    def test_an_indented_task_key_under_a_title_is_reported(self):
        front = "title: Docs: set up\n  depts: [rnd, ops]\n" + _tail(depts="")
        t = _load(_raw_doc(front))
        self.assertIn('frontmatter line 3 starts with a key name but is indented under "title"', t.warnings)

    def test_a_tab_indented_task_key_under_an_owner_is_reported(self):
        front = "title: Plain\nowner: chief-of-staff\n\tstate: paused\n" + _tail(owner="", state="")
        t = _load(_raw_doc(front))
        self.assertIn('frontmatter line 4 starts with a key name but is indented under "owner"', t.warnings)

    def test_a_key_that_yaml_reads_inside_another_value_is_reported_not_recovered(self):
        # Parses strictly: the title is a quoted scalar that runs over the next line.
        front = 'title: "alpha\nstate: paused"\n' + _tail(state="")
        t = _load(_raw_doc(front))
        self.assertEqual(t.title, "alpha state: paused")
        self.assertEqual(t.state, "active")  # the location decides, not a phantom key
        self.assertTrue(any('looks like the key "state"' in w for w in t.warnings), t.warnings)
        self.assertIn("state", analyze_task_text(_raw_doc(front)).lossy)

    def test_a_comment_with_words_on_the_key_line_before_a_continuation_is_reported(self):
        t = _load(_doc("title: #77\n  follow-up on the widget"))
        self.assertEqual(t.title, "#77 follow-up on the widget")
        self.assertEqual(t.warnings, ['unquoted value in "title" (comment with words on the key line)'])

    def test_a_comment_after_a_closing_quote_is_reported(self):
        t = _load(_doc('title: "Foo" #12 renamed'))
        self.assertEqual(t.warnings, ['unquoted value in "title" (comment after a closing quote)'])
        self.assertEqual(t.title, '"Foo" #12 renamed')
        tail = _tail(success_criteria="success_criteria:\n  - \"quoted\" #12\n  - plain\n")
        t = _load(_doc("title: Plain", tail=tail))
        self.assertEqual(t.warnings, ['unquoted value in "success_criteria" (comment after a closing quote)'])
        self.assertEqual(t.success_criteria, ['"quoted" #12', "plain"])

    def test_a_comment_after_a_closing_quote_with_no_words_is_not_a_problem(self):
        t = _load(_doc('title: "Foo" #'))
        self.assertEqual((t.title, t.warnings), ("Foo", []))

    def test_line_breaks_yaml_honours_are_reported_outside_quotes(self):
        for ch in ("\u2028", "\u2029", "\x85"):
            with self.subTest(char=hex(ord(ch))):
                t = _load(_doc(f"title: Fix login{ch}note: on mobile too"))
                self.assertTrue(any("line-break character" in w for w in t.warnings), t.warnings)

    def test_a_line_break_character_inside_quotes_is_not_reported(self):
        t = _load(_doc('title: "Fix login\\u2028note"'))
        self.assertEqual(t.warnings, [])
        t = _load(_doc("title: \"Fix login\u2028note\""))
        self.assertEqual(t.warnings, [])

    def test_a_long_line_of_quotes_is_scanned_in_linear_time(self):
        def feed(n):
            f = _Flow()
            f.feed("a'" * n)

        scales_linearly(self, lambda n: n, n=20000, fn=feed)


class TestReaderRoundSeven(unittest.TestCase):
    """The flow scanner's quote and comment rules, the hints about where a value goes on, the
    anchors before a bracket, the `? key` form, and the time limits."""

    def unparseable(self, front, **over):
        return analyze_task_text(f"---\nissue_number: 5\n{front}{_tail(created='created: x: y' + chr(10), **over)}---\n{BODY}")

    # -- the scanner: a quote opens only at the start of an item; `#` is a comment only after a space --
    def test_a_quote_opens_only_at_the_start_of_an_item(self):
        self.assertEqual(_scan_flow("[it's, a]")[0], ["it's", "a"])
        self.assertEqual(_scan_flow("[a, b'c, d']")[0], ["a", "b'c", "d'"])
        self.assertEqual(_scan_flow('[a, say"hi, x]')[0], ["a", 'say"hi', "x"])
        self.assertEqual(_scan_flow("[a, 'b, c']")[0], ["a", "'b, c'"])
        self.assertEqual(_scan_flow("[a,\t'b, c']")[0], ["a", "'b, c'"])

    def test_a_hash_is_a_comment_only_after_a_space(self):
        items, closed, after, hit = _scan_flow("[a, b#c]")
        self.assertEqual((items, closed, hit), (["a", "b#c"], True, False))
        self.assertTrue(_scan_flow("[a, b #c]")[3])
        self.assertTrue(_scan_flow("[a, #c]")[3])
        self.assertTrue(_scan_flow("[a,\t#c]")[3])

    def test_apostrophes_are_read_as_text_in_a_list_that_does_not_parse(self):
        t = analyze_task_text(
            "---\nissue_number: 5\ntitle: Plain\n"
            + _tail(success_criteria="success_criteria: [alpha, 5, it's beta, don't]\n", created="created: x: y\n")
            + "---\n" + BODY
        )
        self.assertEqual(t.fm["success_criteria"], ["alpha", "5", "it's beta", "don't"])
        self.assertEqual(t.lossy, set())

    # -- impossible dates --
    def test_an_impossible_date_is_a_warning_and_stays_text(self):
        t = analyze_task_text(_doc('title: "Plain"', tail=_tail(created="created: 2026-02-30\n")))
        self.assertEqual(t.fm["created"], "2026-02-30")
        self.assertEqual(t.bad_keys, {"created"})
        self.assertEqual(t.recovered["created"], "2026-02-30")
        self.assertEqual(t.warnings, ['unquoted value in "created" (a date or time that is not real)'])

    def test_a_date_in_a_list_item_and_a_real_date_in_one(self):
        t = analyze_task_text(_doc('title: "Plain"', tail=_tail(depts="depts: [alpha, 2026-02-30]\n")))
        self.assertEqual(t.fm["depts"], ["alpha", "2026-02-30"])
        self.assertEqual(t.bad_keys, {"depts"})
        t = analyze_task_text(_doc('title: "Plain"', tail=_tail(depts="depts: [alpha, 2026-02-28]\n")))
        self.assertEqual(t.warnings, [])

    def test_a_date_with_a_comment_or_in_a_non_task_key_is_lossy(self):
        t = analyze_task_text(_doc('title: "Plain"', tail=_tail(created="created: 2026-02-30 # sample\n")))
        self.assertEqual(t.lossy, {"created"})
        t = analyze_task_text(_doc('title: "Plain"\nnote: 2026-02-30'))
        self.assertEqual(t.lossy, {"note"})
        self.assertTrue(any("cannot be rewritten safely" in w for w in t.warnings))

    def test_a_date_that_fails_together_with_another_key_is_still_found_per_key(self):
        t = analyze_task_text(_doc("title: Docs: x", tail=_tail(created="created: 2026-02-30\n", completed="completed: 2026-13-01\n")))
        self.assertEqual(t.bad_keys, {"title", "created", "completed"})

    # -- hints about where a value goes on --
    def test_a_value_that_goes_past_its_key_line_says_so(self):
        for front in ("title: [alpha,\nowner: beta]\n", "title: {alpha,\nowner: beta}\n", "title: &a [alpha,\nowner: beta]\n",
                      'title: "alpha,\nowner: beta"\n', "title: Docs: x\n  more words\n"):
            with self.subTest(front=front):
                t = self.unparseable(front.replace("owner:", "note:") if "more" in front else front, owner="")
                self.assertIn('unquoted value in "title"', "".join(t.warnings))
                self.assertIn('unquoted value in "title", which goes past its key line', t.warnings, t.warnings)

    def test_a_value_that_sits_whole_on_its_key_line_does_not(self):
        t = self.unparseable("title: Docs: x\n")
        self.assertIn('unquoted value in "title"', t.warnings)
        self.assertFalse(any("past its key line" in w for w in t.warnings))
        t = self.unparseable("title: [alpha, beta]\nstate: a: b\n", state="")
        self.assertFalse(any("past its key line" in w for w in t.warnings))

    def test_a_file_that_parses_never_says_it(self):
        t = analyze_task_text(_doc("title: Fix the widget #12"))
        self.assertEqual(t.warnings, ['unquoted value in "title" (comment cut at " #")'])

    def test_an_anchor_or_tag_before_an_unclosed_bracket_is_never_closed_too(self):
        for prop in ("", "&a ", "!t ", "!!seq ", "&a !t "):
            with self.subTest(prop=prop):
                t = self.unparseable(f"depts: {prop}[rnd, ops\n  more: words\n", state="")
                self.assertTrue(any("starts a [ list that is never closed" in w for w in t.warnings), t.warnings)
                self.assertIn("depts", t.lossy)

    def test_an_anchor_or_tag_before_a_closed_bracket_is_fine(self):
        t = analyze_task_text(_doc('title: "Plain"', tail=_tail(depts="depts: &a [rnd, ops]\n")))
        self.assertEqual(t.warnings, [])

    def test_an_anchor_or_tag_before_an_unclosed_quote_is_never_closed(self):
        for prop in ("", "&a ", "!!str "):
            with self.subTest(prop=prop):
                t = self.unparseable(f'title: {prop}"alpha\n  more: words\n')
                self.assertTrue(any("starts with a quote that is never closed" in w for w in t.warnings), t.warnings)

    # -- a task key written as `? key` or as a quoted key --
    def test_a_complex_key_does_not_lose_its_comment_silently(self):
        t = analyze_task_text("---\nissue_number: 5\n? title\n: alpha #c beta\nstate: active\n---\nbody\n")
        self.assertEqual(t.fm["title"], "alpha")
        self.assertEqual(t.lossy, {"title"})
        self.assertTrue(any('"title" is written as a quoted or "? " key' in w for w in t.warnings), t.warnings)
        from ui.repair_tasks import plan_repair
        self.assertEqual(plan_repair("---\nissue_number: 5\n? title\n: alpha #c beta\nstate: active\n---\nbody\n")[0], "cannot")

    def test_a_quoted_key_with_a_comment_cut_is_refused_and_a_clean_one_is_not(self):
        t = analyze_task_text('---\nissue_number: 5\n"title": alpha #c beta\n---\nbody\n')
        self.assertEqual(t.lossy, {"title"})
        t = analyze_task_text('---\nissue_number: 5\n"title": "fix #12"\n? owner\n: beta\n---\nbody\n')
        self.assertEqual(t.warnings, [])

    # -- time: no step of the reader grows faster than the file --
    # Each test reads a file of n and of 4n units and asserts the ratio: quadrupling the input must not
    # take more than 8 times as long (linear is 4, quadratic is 16). It measures CPU time (process_time),
    # interleaves the two sizes and takes the best of five runs of each, which a loaded machine does not
    # push over the bound (4 runners at once, and with busy loops added: see the PR text).
    def test_twenty_thousand_keys_with_a_line_separator_are_read_in_linear_time(self):
        scales_linearly(self, lambda n: "---\nissue_number: 5\n" + "".join(f"k{i}: a\u2028b\n" for i in range(n)) + "---\n")

    def test_five_thousand_wrapped_block_items_are_read_in_linear_time(self):
        scales_linearly(self, lambda n: "---\nissue_number: 5\ntitle: T\nsuccess_criteria:\n"
                             + "".join(f"- item {i} alpha\n  beta gamma\n  delta #x\n" for i in range(n))
                             + "created: x: y\n---\n", n=2500)

    def test_one_block_item_wrapped_over_many_lines_is_read_in_linear_time(self):
        scales_linearly(self, lambda n: "---\nissue_number: 5\ntitle: T\nsuccess_criteria:\n- a\n" + "  word\n" * n
                             + "created: x: y\n---\n", n=20000)

    def test_a_long_line_of_spaces_before_a_colon_is_read_in_linear_time(self):
        scales_linearly(self, lambda n: "---\nissue_number: 5\ntitle: T\n" + " " * n + "x\n---\n", n=20000)

    def test_the_block_items_of_a_wrapped_item_are_joined_with_single_spaces(self):
        from ui.data import _block_items, _key_groups
        g = _key_groups(["success_criteria:", "- alpha", "  beta", "-", "  gamma", "- delta"])[0]
        self.assertEqual(_block_items(g), ["alpha beta", "gamma", "delta"])


if __name__ == "__main__":
    unittest.main()
