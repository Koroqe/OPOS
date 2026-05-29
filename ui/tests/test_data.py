import tempfile
import unittest
from pathlib import Path

from ui.data import (
    REPO_ROOT,
    parse_agents,
    parse_departments,
    parse_frontmatter,
    parse_history,
    parse_skills,
    parse_tasks,
    paused_task_numbers,
)


class TestParseFrontmatter(unittest.TestCase):
    def test_with_yaml(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "f.md"
            p.write_text("---\nname: foo\nvalue: 1\n---\nBody here.\n", encoding="utf-8")
            fm, body = parse_frontmatter(p)
            self.assertEqual(fm["name"], "foo")
            self.assertEqual(fm["value"], 1)
            self.assertEqual(body, "Body here.\n")

    def test_without_fence(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "f.md"
            p.write_text("Just body text, no frontmatter.\n", encoding="utf-8")
            fm, body = parse_frontmatter(p)
            self.assertEqual(fm, {})
            self.assertEqual(body, "Just body text, no frontmatter.\n")

    def test_malformed_yaml(self):
        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "f.md"
            p.write_text("---\n:: invalid : yaml :: ::\n---\nBody.\n", encoding="utf-8")
            fm, body = parse_frontmatter(p)
            self.assertEqual(fm, {})
            self.assertEqual(body, "Body.\n")


class TestParseAgents(unittest.TestCase):
    def test_finds_at_least_seven(self):
        agents = parse_agents()
        # 4 company + 2 engineering + 1 rnd at v0.3.0 start.
        self.assertGreaterEqual(len(agents), 7)
        names = {a.name for a in agents}
        self.assertIn("chief-of-staff", names)
        self.assertIn("eng-lead", names)


class TestParseSkills(unittest.TestCase):
    def test_finds_at_least_ten(self):
        skills = parse_skills()
        # >=10 root-level skills; v0.3.1 adds dept-nested discovery (deploy).
        self.assertGreaterEqual(len(skills), 10)
        names = {s.name for s in skills}
        self.assertIn("task-register", names)
        self.assertIn("design-process", names)

    def test_includes_dept_nested(self):
        # departments/rnd/.claude/skills/deploy/ should be discovered.
        # (deploy moved from engineering → rnd at v0.5.1; engineering folded into rnd umbrella.)
        skills = parse_skills()
        deploy = next((s for s in skills if s.name == "deploy"), None)
        self.assertIsNotNone(deploy, "dept-nested 'deploy' skill not found")
        self.assertEqual(deploy.dept, "rnd")
        # Root-level skills have an empty dept.
        task_register = next((s for s in skills if s.name == "task-register"), None)
        self.assertIsNotNone(task_register)
        self.assertEqual(task_register.dept, "")

    def test_root_wins_on_name_collision(self):
        import tempfile
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            # Root-level "foo" skill.
            (root / ".claude" / "skills" / "foo").mkdir(parents=True)
            (root / ".claude" / "skills" / "foo" / "SKILL.md").write_text(
                "---\nname: foo\ndescription: root-level\n---\nBody\n", encoding="utf-8"
            )
            # Dept-nested "foo" skill in engineering.
            (root / "departments" / "engineering" / ".claude" / "skills" / "foo").mkdir(parents=True)
            (root / "departments" / "engineering" / ".claude" / "skills" / "foo" / "SKILL.md").write_text(
                "---\nname: foo\ndescription: dept-nested\n---\nBody\n", encoding="utf-8"
            )
            skills = parse_skills(repo_root=root)
            foos = [s for s in skills if s.name == "foo"]
            self.assertEqual(len(foos), 1)
            self.assertEqual(foos[0].description, "root-level")
            self.assertEqual(foos[0].dept, "")


class TestParseTasksStateInference(unittest.TestCase):
    def test_closed_dir_location_wins(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "tasks" / "closed").mkdir(parents=True)
            (root / "tasks" / "closed" / "42.md").write_text(
                "---\nissue_number: 42\ntitle: Test\nstate: active\n---\nBody\n",
                encoding="utf-8",
            )
            tasks = parse_tasks(repo_root=root)
            self.assertEqual(len(tasks), 1)
            self.assertEqual(tasks[0].state, "completed")  # location overrides frontmatter

    def test_active_with_paused_membership_is_paused(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "tasks").mkdir()
            (root / ".claude").mkdir()
            (root / "tasks" / "7.md").write_text(
                "---\nissue_number: 7\ntitle: Paused\nstate: active\n---\nBody\n",
                encoding="utf-8",
            )
            (root / ".claude" / ".paused-tasks").write_text("7\n", encoding="utf-8")
            tasks = parse_tasks(repo_root=root)
            self.assertEqual(len(tasks), 1)
            self.assertEqual(tasks[0].state, "paused")


class TestParseTasksHandlesMissingClosedDir(unittest.TestCase):
    def test_no_closed_dir_returns_empty_closed(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / "tasks").mkdir()
            # no closed/ subdir
            tasks = parse_tasks(repo_root=root)
            self.assertEqual(tasks, [])


class TestPausedTaskNumbers(unittest.TestCase):
    def test_missing_file_returns_empty(self):
        with tempfile.TemporaryDirectory() as td:
            self.assertEqual(paused_task_numbers(repo_root=Path(td)), set())

    def test_parses_digits(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            (root / ".claude").mkdir()
            (root / ".claude" / ".paused-tasks").write_text("3\n5\nnotanumber\n7\n", encoding="utf-8")
            self.assertEqual(paused_task_numbers(repo_root=root), {3, 5, 7})


class TestParseHistory(unittest.TestCase):
    def test_finds_entries_and_sorts_desc(self):
        entries = parse_history()
        self.assertGreater(len(entries), 0)
        # Sorted by date descending.
        for i in range(len(entries) - 1):
            self.assertGreaterEqual(entries[i].date, entries[i + 1].date)

    def test_time_field_used_as_secondary_sort(self):
        import tempfile
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            hist = root / ".claude" / "skills" / "foo" / "history"
            hist.mkdir(parents=True)
            # Same date, different times — verify chronological desc.
            (hist / "2026-05-29-early.md").write_text(
                "---\ndate: 2026-05-29\ntime: \"09:00\"\nrun_id: early\nskill: foo\noutcome: success\n---\n",
                encoding="utf-8",
            )
            (hist / "2026-05-29-late.md").write_text(
                "---\ndate: 2026-05-29\ntime: \"17:30\"\nrun_id: late\nskill: foo\noutcome: success\n---\n",
                encoding="utf-8",
            )
            entries = parse_history(repo_root=root)
            self.assertEqual([e.run_id for e in entries], ["late", "early"])
            self.assertEqual(entries[0].time, "17:30")

    def test_missing_time_falls_back_to_run_id(self):
        import tempfile
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            hist = root / ".claude" / "skills" / "foo" / "history"
            hist.mkdir(parents=True)
            # Same date, no times — order falls back to run_id desc.
            (hist / "2026-05-29-aaaa.md").write_text(
                "---\ndate: 2026-05-29\nrun_id: aaaa\nskill: foo\noutcome: success\n---\n",
                encoding="utf-8",
            )
            (hist / "2026-05-29-zzzz.md").write_text(
                "---\ndate: 2026-05-29\nrun_id: zzzz\nskill: foo\noutcome: success\n---\n",
                encoding="utf-8",
            )
            entries = parse_history(repo_root=root)
            self.assertEqual([e.run_id for e in entries], ["zzzz", "aaaa"])
            self.assertEqual(entries[0].time, "")


class TestParseDepartments(unittest.TestCase):
    def test_includes_company_synthetic(self):
        depts = parse_departments()
        names = {d.name for d in depts}
        self.assertIn("company", names)
        # As of v0.5.1: engineering folded into rnd (umbrella); 5 new depts added.
        # Expected starter depts: company (synthetic), rnd, finance, people, legal, commercial, pr.
        self.assertIn("rnd", names)
        self.assertIn("finance", names)
        self.assertIn("people", names)
        self.assertIn("legal", names)
        self.assertIn("commercial", names)
        self.assertIn("pr", names)
        # Engineering removed from top-level (now inside rnd).
        self.assertNotIn("engineering", names)
        # Company dept's charter is rendered (no raw Jinja token left over).
        company = next(d for d in depts if d.name == "company")
        self.assertNotIn("{{ COMPANY_NAME }}", company.charter_body)


if __name__ == "__main__":
    unittest.main()
