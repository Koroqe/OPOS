"""Tests for ui.scheduling.validate_frontmatter."""

from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from ui.scheduling import validate_frontmatter

REPO = Path(__file__).resolve().parents[2]


def _write_process_md(tmp: Path, frontmatter: str) -> Path:
    """Write a minimal PROCESS.md with the given YAML frontmatter."""
    path = tmp / "PROCESS.md"
    path.write_text(f"---\n{frontmatter}\n---\n\n# fixture\n", encoding="utf-8")
    return path


class TestValidateFrontmatter(unittest.TestCase):
    def setUp(self) -> None:
        self._tmpdir = tempfile.TemporaryDirectory()
        self.tmp = Path(self._tmpdir.name)

    def tearDown(self) -> None:
        self._tmpdir.cleanup()

    # Fixture 1: manual-only (no scheduling fields) → valid
    def test_manual_only_process_is_valid(self) -> None:
        path = _write_process_md(self.tmp, "process_name: foo\nowner: bar")
        ok, errors = validate_frontmatter(path)
        self.assertTrue(ok)
        self.assertEqual(errors, [])

    # Fixture 2: valid all-four
    def test_valid_all_four_fields(self) -> None:
        path = _write_process_md(
            self.tmp,
            'process_name: foo\nowner: bar\n'
            'schedule: "0 9 * * 1"\n'
            'runtime: claude-schedule\n'
            'non_interactive: true\n'
            'authority:\n  - write_proposal',
        )
        ok, errors = validate_frontmatter(path)
        self.assertTrue(ok, msg=f"unexpected errors: {errors}")
        self.assertEqual(errors, [])

    # Fixture 3: missing schedule (other 3 present) → all-or-nothing error
    def test_missing_schedule_field(self) -> None:
        path = _write_process_md(
            self.tmp,
            'process_name: foo\nowner: bar\n'
            'runtime: claude-schedule\n'
            'non_interactive: true\n'
            'authority:\n  - write_proposal',
        )
        ok, errors = validate_frontmatter(path)
        self.assertFalse(ok)
        self.assertTrue(any("all-or-nothing" in e and "schedule" in e for e in errors))

    # Fixture 4: missing runtime → all-or-nothing error
    def test_missing_runtime_field(self) -> None:
        path = _write_process_md(
            self.tmp,
            'process_name: foo\nowner: bar\n'
            'schedule: "0 9 * * 1"\n'
            'non_interactive: true\n'
            'authority:\n  - write_proposal',
        )
        ok, errors = validate_frontmatter(path)
        self.assertFalse(ok)
        self.assertTrue(any("all-or-nothing" in e and "runtime" in e for e in errors))

    # Fixture 5: missing non_interactive → all-or-nothing error
    def test_missing_non_interactive_field(self) -> None:
        path = _write_process_md(
            self.tmp,
            'process_name: foo\nowner: bar\n'
            'schedule: "0 9 * * 1"\n'
            'runtime: claude-schedule\n'
            'authority:\n  - write_proposal',
        )
        ok, errors = validate_frontmatter(path)
        self.assertFalse(ok)
        self.assertTrue(any("all-or-nothing" in e and "non_interactive" in e for e in errors))

    # Fixture 6: missing authority → all-or-nothing error
    def test_missing_authority_field(self) -> None:
        path = _write_process_md(
            self.tmp,
            'process_name: foo\nowner: bar\n'
            'schedule: "0 9 * * 1"\n'
            'runtime: claude-schedule\n'
            'non_interactive: true',
        )
        ok, errors = validate_frontmatter(path)
        self.assertFalse(ok)
        self.assertTrue(any("all-or-nothing" in e and "authority" in e for e in errors))

    # Fixture 7: malformed cron
    def test_malformed_cron_rejected(self) -> None:
        path = _write_process_md(
            self.tmp,
            'process_name: foo\nowner: bar\n'
            'schedule: "every monday"\n'
            'runtime: claude-schedule\n'
            'non_interactive: true\n'
            'authority:\n  - write_proposal',
        )
        ok, errors = validate_frontmatter(path)
        self.assertFalse(ok)
        self.assertTrue(any("schedule:" in e and "5-field POSIX cron" in e for e in errors))

    # Fixture 8: unknown runtime (gha became allowed in v0.10)
    def test_unknown_runtime_rejected(self) -> None:
        path = _write_process_md(
            self.tmp,
            'process_name: foo\nowner: bar\n'
            'schedule: "0 9 * * 1"\n'
            'runtime: launchd\n'
            'non_interactive: true\n'
            'authority:\n  - write_proposal',
        )
        ok, errors = validate_frontmatter(path)
        self.assertFalse(ok)
        self.assertTrue(any("runtime:" in e and "not allowed" in e for e in errors))

    # Fixture 8c: runtime=cloud accepted (v0.14 durable runtime, subscription-billed)
    def test_cloud_runtime_accepted(self) -> None:
        path = _write_process_md(
            self.tmp,
            'process_name: foo\nowner: bar\n'
            'schedule: "0 9 * * 1"\n'
            'runtime: cloud\n'
            'non_interactive: true\n'
            'authority:\n  - write_proposal',
        )
        ok, errors = validate_frontmatter(path)
        self.assertTrue(ok, msg=str(errors))

    # Fixture 8b: runtime=gha accepted (v0.10 durable runtime)
    def test_gha_runtime_accepted(self) -> None:
        path = _write_process_md(
            self.tmp,
            'process_name: foo\nowner: bar\n'
            'schedule: "0 9 * * 1"\n'
            'runtime: gha\n'
            'non_interactive: true\n'
            'authority:\n  - write_proposal',
        )
        ok, errors = validate_frontmatter(path)
        self.assertTrue(ok, msg=str(errors))

    # Fixture 9: non_interactive as string "true"
    def test_non_interactive_string_rejected(self) -> None:
        path = _write_process_md(
            self.tmp,
            'process_name: foo\nowner: bar\n'
            'schedule: "0 9 * * 1"\n'
            'runtime: claude-schedule\n'
            'non_interactive: "true"\n'
            'authority:\n  - write_proposal',
        )
        ok, errors = validate_frontmatter(path)
        self.assertFalse(ok)
        self.assertTrue(any("non_interactive:" in e and "literal boolean" in e for e in errors))

    # Fixture 10: authority with read_only + other values (mutual-exclusion violation)
    def test_authority_read_only_mutex_rejected(self) -> None:
        path = _write_process_md(
            self.tmp,
            'process_name: foo\nowner: bar\n'
            'schedule: "0 9 * * 1"\n'
            'runtime: claude-schedule\n'
            'non_interactive: true\n'
            'authority:\n  - read_only\n  - commit',
        )
        ok, errors = validate_frontmatter(path)
        self.assertFalse(ok)
        self.assertTrue(any("authority:" in e and "mutually exclusive" in e for e in errors))

    # Fixture 11: every-minute cron rejected
    def test_every_minute_cron_rejected(self) -> None:
        path = _write_process_md(
            self.tmp,
            'process_name: foo\nowner: bar\n'
            'schedule: "* * * * *"\n'
            'runtime: claude-schedule\n'
            'non_interactive: true\n'
            'authority:\n  - write_proposal',
        )
        ok, errors = validate_frontmatter(path)
        self.assertFalse(ok)
        self.assertTrue(any("every-minute" in e for e in errors))


class TestCloudIntegrationPath(unittest.TestCase):
    """The cloud push-restriction fallback (shared/cloud-integration.md) must stay wired."""

    DOC = REPO / "shared" / "cloud-integration.md"
    SKILLS = REPO / ".claude" / "skills"

    def test_doc_exists_and_states_the_untested_part(self) -> None:
        text = self.DOC.read_text(encoding="utf-8")
        self.assertIn("gh api -X POST repos/<owner>/<repo>/pulls", text)
        self.assertIn("merge_method=merge", text)
        self.assertIn("pr-open", text)
        self.assertIn("have not been exercised in the cloud runtime", text)

    def test_default_branch_pushers_reference_it_and_allow_rest_writes(self) -> None:
        for name in ("review-history", "auto-sync"):
            skill = (self.SKILLS / name / "SKILL.md").read_text(encoding="utf-8")
            process = (self.SKILLS / name / "PROCESS.md").read_text(encoding="utf-8")
            self.assertIn("shared/cloud-integration.md", skill, name)
            self.assertIn('"Bash(gh api -X POST repos/*/pulls *)"', process, name)
            self.assertIn('"Bash(gh api -X POST repos/*/issues *)"', process, name)
            self.assertIn('"Bash(gh api -X PUT repos/*/pulls/*/merge *)"', process, name)
            # Never the bare write patterns: they would admit collaborator/webhook/settings writes.
            self.assertNotIn('"Bash(gh api -X POST repos/*)"', process, name)
            self.assertNotIn('"Bash(gh api -X PUT repos/*)"', process, name)

    def test_schedule_process_documents_the_restriction(self) -> None:
        text = (self.SKILLS / "schedule-process" / "SKILL.md").read_text(encoding="utf-8")
        self.assertIn("Cloud push restriction", text)
        self.assertIn("shared/cloud-integration.md", text)
        self.assertIn("untested in the cloud runtime", text)

if __name__ == "__main__":
    unittest.main()
