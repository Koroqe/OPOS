"""Template-render tests for the OPOS console.

These tests render Jinja templates directly via ui.render.render() without
booting a server, asserting the v0.4.0 ergonomics hints are present and
auto-escaped correctly.
"""

import unittest

from ui.data import Agent
from ui.render import render


class TestAgentDetailConsultHint(unittest.TestCase):
    def test_consult_hint_renders_with_agent_name(self):
        agent = Agent(
            name="test-agent",
            description="a test agent",
            department="company",
            tools=["Read"],
            owns_processes=[],
            body="## Role\n\nTest.\n",
            path="/tmp/fake.md",  # type: ignore[arg-type]
        )
        html = render("agent.html", agent=agent, called_by=[])
        self.assertIn('class="cli-hint"', html)
        self.assertIn("consult-agent --agent test-agent", html)

    def test_consult_hint_autoescapes_dangerous_names(self):
        # Kebab-case names are no-ops under autoescape, but if a malformed
        # agent slipped past safe_slug, Jinja2 autoescape should still
        # prevent HTML injection in the rendered hint.
        agent = Agent(
            name="evil<script>alert(1)</script>",
            description="injection test",
            department="company",
            tools=["Read"],
            owns_processes=[],
            body="",
            path="/tmp/evil.md",  # type: ignore[arg-type]
        )
        html = render("agent.html", agent=agent, called_by=[])
        # The raw <script> tag must NOT appear in the rendered output.
        self.assertNotIn("<script>alert(1)</script>", html)
        # The escaped form should appear instead.
        self.assertIn("&lt;script&gt;", html)


class TestAgentsListDesignAgentHint(unittest.TestCase):
    def test_design_agent_hint_renders(self):
        html = render("agents.html", depts=[], total=0)
        self.assertIn('class="cli-hint"', html)
        self.assertIn("/design-agent", html)


if __name__ == "__main__":
    unittest.main()
