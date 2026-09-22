"""Guards on copier.yml's own semantics.

These exist because a single unanchored pattern silently disabled the framework's whole
delivery mechanism for eighteen releases' worth of constitution changes, and nothing in the
test suite would have noticed.
"""
import unittest
from pathlib import Path

import pathspec
import yaml

ROOT = Path(__file__).resolve().parents[2]


def _skip_spec():
    cfg = yaml.safe_load((ROOT / "copier.yml").read_text(encoding="utf-8"))
    return pathspec.PathSpec.from_lines("gitwildmatch", cfg["_skip_if_exists"])


class TestSkipIfExistsAnchoring(unittest.TestCase):
    def test_framework_constitution_is_not_frozen_at_scaffold(self):
        """`.claude/CLAUDE.md` MUST keep updating.

        It exists precisely to carry framework posture to EXISTING consumers, because the root
        `CLAUDE.md` is `_skip_if_exists` and cannot. An unanchored `CLAUDE.md` entry in
        `_skip_if_exists` matches at any depth under gitwildmatch, so it also froze
        `.claude/CLAUDE.md` — every framework rule added there since v0.15.0 reached exactly
        nobody. Anchor root-only patterns with a leading slash.
        """
        self.assertFalse(
            _skip_spec().match_file(".claude/CLAUDE.md"),
            "`.claude/CLAUDE.md` is matched by _skip_if_exists — the framework constitution "
            "would never reach an existing consumer again. Anchor the root pattern as "
            "`/CLAUDE.md`.",
        )

    def test_root_constitution_is_still_consumer_owned(self):
        """The root file holds founder content (Mission, Values) and must NOT be overwritten."""
        self.assertTrue(_skip_spec().match_file("CLAUDE.md"))

    def test_other_deliberately_frozen_claude_files_stay_frozen(self):
        """Anchoring the root pattern must not accidentally unfreeze these."""
        spec = _skip_spec()
        for path in ("company/CLAUDE.md", "departments/rnd/CLAUDE.md"):
            with self.subTest(path=path):
                self.assertTrue(spec.match_file(path), f"{path} should stay consumer-owned")

    def test_core_skills_are_never_frozen(self):
        """A CORE skill frozen at scaffold time is a fork nobody asked for."""
        spec = _skip_spec()
        for path in (
            ".claude/skills/lease/lease.mjs",
            ".claude/skills/auto-sync/SKILL.md",
            ".claude/skills/sync-from-core/SKILL.md",
            "shared/templates/required-settings.json",
            "shared/templates/gitignore.core",
        ):
            with self.subTest(path=path):
                self.assertFalse(spec.match_file(path), f"{path} must keep updating")

    def test_consumer_owned_config_stays_owned(self):
        spec = _skip_spec()
        for path in (
            ".claude/settings.json",
            ".claude/lease.config.json",
            ".gitignore",
            ".mcp.json",
        ):
            with self.subTest(path=path):
                self.assertTrue(spec.match_file(path), f"{path} must stay consumer-owned")


if __name__ == "__main__":
    unittest.main()
