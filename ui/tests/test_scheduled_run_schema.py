"""Schema-parse test for shared/templates/scheduled-run.md.tmpl.

The .tmpl file holds substitution markers (`<<TOKEN>>`) that aren't valid
YAML on their own. This test substitutes representative values, then parses
the resulting frontmatter through PyYAML and asserts the 16 expected schema
fields (11 original + the optional v0.9.0 pair delta_target/upstream_pr +
the optional v0.10 cost_estimate + the optional v0.11 pair
root_cause_target/mistake_class) are present with the expected types.

Mirrors `ui.scheduling.SCHEDULING_FIELDS` validation in spirit: catches
template drift (renamed/dropped fields) before a release ships.
"""

from __future__ import annotations

import unittest
from pathlib import Path

import yaml

TEMPLATE_PATH = Path(__file__).resolve().parents[2] / "shared" / "templates" / "scheduled-run.md.tmpl"

# (token, sample-value) pairs that produce a valid YAML body when substituted.
SUBSTITUTIONS = (
    ("<<DATE>>", "2026-05-30"),
    ("<<RUN_ID>>", "test-run-abc123"),
    ("<<SKILL>>", "weekly-metrics-rollup"),
    ("<<OUTCOME>>", "success"),
    ("<<DURATION_MIN>>", "3"),
    ("<<AUTHORITY_DECLARED>>", "[write_proposal]"),
    ("<<AUTHORITY_USED>>", "[write_proposal]"),
    ("<<VERIFICATION_STATE>>", "unverified"),
    ("<<PROPOSED_DELTA>>", '"none"'),
    ("<<STATUS>>", "open"),
    ("<<DELTA_TARGET>>", '"none"'),
    ("<<UPSTREAM_PR>>", '"none"'),
    ("<<COST_ESTIMATE>>", '"none"'),
    ("<<ROOT_CAUSE_TARGET>>", '"none"'),
    ("<<MISTAKE_CLASS>>", '"none"'),
)

EXPECTED_FIELDS = {
    "date",
    "run_id",
    "skill",
    "triggered_by",
    "outcome",
    "duration_min",
    "authority_declared",
    "authority_used",
    "verification_state",
    "proposed_delta",
    "status",
    # v0.9.0 self-improvement-loop fields (optional in real entries; present in the template)
    "delta_target",
    "upstream_pr",
    # v0.10 (optional): unattended-spend visibility
    "cost_estimate",
    # v0.11 (optional): derivation-level attribution
    "root_cause_target",
    "mistake_class",
}


def _render_fixture() -> str:
    text = TEMPLATE_PATH.read_text(encoding="utf-8")
    for token, value in SUBSTITUTIONS:
        text = text.replace(token, value)
    return text


def _extract_frontmatter(text: str) -> dict:
    # The template has a leading HTML <!-- ... --> block; the YAML frontmatter
    # is delimited by the FIRST and SECOND `---` lines that appear on their own.
    # Split and grab the slice between them.
    parts = text.split("\n---\n")
    # Layout: [HTML-comment block + intro], [yaml frontmatter], [body...]
    assert len(parts) >= 3, f"expected at least 3 sections separated by '---', got {len(parts)}"
    yaml_body = parts[1]
    return yaml.safe_load(yaml_body) or {}


class TestScheduledRunSchema(unittest.TestCase):
    def test_template_file_exists(self) -> None:
        self.assertTrue(
            TEMPLATE_PATH.exists(),
            msg=f"expected template at {TEMPLATE_PATH}; missing",
        )

    def test_substituted_template_parses(self) -> None:
        rendered = _render_fixture()
        fm = _extract_frontmatter(rendered)
        self.assertIsInstance(fm, dict)
        self.assertGreater(len(fm), 0)

    def test_all_expected_fields_present(self) -> None:
        rendered = _render_fixture()
        fm = _extract_frontmatter(rendered)
        self.assertEqual(
            set(fm.keys()),
            EXPECTED_FIELDS,
            msg=(
                f"schema drift detected. "
                f"missing: {EXPECTED_FIELDS - set(fm.keys())}; "
                f"unexpected: {set(fm.keys()) - EXPECTED_FIELDS}"
            ),
        )

    def test_triggered_by_is_schedule_literal(self) -> None:
        # The `triggered_by:` field is hardcoded `schedule` in the template
        # — that's what distinguishes scheduled-runs/ entries from history/
        # entries. Drift on this value would silently break the distinguishing
        # convention.
        rendered = _render_fixture()
        fm = _extract_frontmatter(rendered)
        self.assertEqual(fm["triggered_by"], "schedule")

    def test_authority_fields_are_lists(self) -> None:
        rendered = _render_fixture()
        fm = _extract_frontmatter(rendered)
        self.assertIsInstance(fm["authority_declared"], list)
        self.assertIsInstance(fm["authority_used"], list)

    def test_v090_optional_fields_are_strings(self) -> None:
        # delta_target / upstream_pr (v0.9.0): string-typed in the template
        # fixture; optional in real entries (writers omit the lines when
        # not applicable), so only presence-in-template and type are asserted.
        rendered = _render_fixture()
        fm = _extract_frontmatter(rendered)
        self.assertIsInstance(fm["delta_target"], str)
        self.assertIsInstance(fm["upstream_pr"], str)


if __name__ == "__main__":
    unittest.main()
