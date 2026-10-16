"""Parse test for shared/templates/PROCESS.md.tmpl.

Every designed process starts as a copy of this template, so a template whose
frontmatter is not YAML produces PROCESS.md files that `ui.scheduling`
rejects ("could not parse frontmatter") — and the break only shows up when a
design or adopt step validates a draft. This test renders the template the way
a design skill does (substitute the `<<TOKEN>>` markers, drop the leading
instruction comment) and asserts that:

- the frontmatter parses and carries the required keys,
- `ui.scheduling.validate_frontmatter` accepts the rendered file,
- body sections stay in the body: `## Verification` sits between
  `## Steps` and `## Done when`, and no `## ` heading leaks into frontmatter.
"""

from __future__ import annotations

import re
import tempfile
import unittest
from pathlib import Path

import yaml

from ui.scheduling import validate_frontmatter

TEMPLATE_PATH = Path(__file__).resolve().parents[2] / "shared" / "templates" / "PROCESS.md.tmpl"

SUBSTITUTIONS = (
    ("<<PROCESS_NAME>>", "sample-process"),
    ("<<OWNER_AGENT>>", "ops-manager"),
    ("<<COLLABORATORS>>", "[coo]"),
    ("<<SLO>>", '"1 working day"'),
    ("<<TEMPLATE_PATH_AT_VERSION>>", "shared/templates/PROCESS.md.tmpl@v0.0.0"),
    ("<<DESIGN_SKILL_AT_VERSION>>", "design-process@0.0.0"),
)


def _render() -> str:
    text = TEMPLATE_PATH.read_text(encoding="utf-8")
    for token, value in SUBSTITUTIONS:
        text = text.replace(token, value)
    # A designed PROCESS.md starts at the frontmatter; the instruction comment is not copied.
    return re.sub(r"\A<!--.*?-->\s*", "", text, flags=re.S)


def _split(rendered: str) -> tuple[str, str]:
    parts = rendered.split("---\n", 2)
    assert len(parts) == 3 and parts[0] == "", "rendered template must open with a --- frontmatter block"
    return parts[1], parts[2]


class TestProcessTemplate(unittest.TestCase):
    def test_no_unsubstituted_tokens_remain(self) -> None:
        self.assertNotRegex(_render(), r"<<[A-Z_]+>>")

    def test_frontmatter_parses_with_required_keys(self) -> None:
        frontmatter, _ = _split(_render())
        fm = yaml.safe_load(frontmatter)
        self.assertIsInstance(fm, dict)
        for key in ("process_name", "owner", "collaborators", "inputs", "success_criteria", "slo", "version"):
            self.assertIn(key, fm)

    def test_no_markdown_heading_inside_frontmatter(self) -> None:
        frontmatter, _ = _split(_render())
        self.assertNotRegex(frontmatter, r"(?m)^#{2,} ")

    def test_scheduling_validator_accepts_rendered_copy(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "PROCESS.md"
            path.write_text(_render(), encoding="utf-8")
            ok, errors = validate_frontmatter(path)
        self.assertTrue(ok, msg=errors)

    def test_verification_section_sits_between_steps_and_done_when(self) -> None:
        _, body = _split(_render())
        headings = re.findall(r"(?m)^## (.+)$", body)
        self.assertIn("Verification", headings)
        self.assertLess(headings.index("Steps"), headings.index("Verification"))
        self.assertLess(headings.index("Verification"), headings.index("Done when"))


if __name__ == "__main__":
    unittest.main()
