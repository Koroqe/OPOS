"""Tests for shared/scripts/reconcile-settings.py hook reconciliation.

A framework hook (e.g. the Stop hook `human-prompt-gate.mjs`) reaches a consumer only through
this script, because `.claude/settings.json` is consumer-owned. The cases below pin the delivery
contract: a new hook EVENT is added, a new hook ENTRY is appended to an existing event array,
nothing is duplicated, nothing the consumer wrote is edited, and permissions are never touched.
"""

from __future__ import annotations

import copy
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
SCRIPT = REPO / "shared" / "scripts" / "reconcile-settings.py"
MANIFEST = REPO / "shared" / "templates" / "required-settings.json"

STOP_CMD = "node shared/scripts/human-prompt-gate.mjs"


def hook(command):
    return {"hooks": [{"type": "command", "command": command}]}


# Shape of a real consumer settings file: SessionStart + UserPromptSubmit, no Stop.
CONSUMER = {
    "permissions": {"allow": ["Bash(git status)"], "deny": ["Bash(rm -rf *)"]},
    "agent": "chief-of-staff",
    "enabledPlugins": {"claude-code-sdlc@claude-code-sdlc": False},
    "autoCompactWindow": 250000,
    "hooks": {
        "SessionStart": [
            hook("node shared/scripts/scheduler-rearm-notice.mjs"),
            hook("node .claude/skills/lease/session-init.mjs"),
            hook("node shared/scripts/opos-session-update.mjs"),
        ],
        "UserPromptSubmit": [hook("node shared/scripts/context-budget-notice.mjs")],
    },
}


class ReconcileHooksTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="reconcile-"))
        self.addCleanup(shutil.rmtree, self.tmp, ignore_errors=True)
        (self.tmp / "shared" / "templates").mkdir(parents=True)
        (self.tmp / ".claude").mkdir()
        shutil.copy(MANIFEST, self.tmp / "shared" / "templates" / "required-settings.json")

    def write(self, settings):
        (self.tmp / ".claude" / "settings.json").write_text(json.dumps(settings, indent=2) + "\n")

    def read(self):
        return json.loads((self.tmp / ".claude" / "settings.json").read_text())

    def run_script(self, mode):
        return subprocess.run(
            [sys.executable, str(SCRIPT), mode, "--root", str(self.tmp)],
            capture_output=True, text=True,
        )

    def test_manifest_declares_stop_hook(self):
        manifest = json.loads(MANIFEST.read_text())
        self.assertEqual(manifest["additive"]["hooks.Stop"], [hook(STOP_CMD)])

    def test_new_event_key_is_added_to_existing_hooks_object(self):
        self.write(CONSUMER)
        self.assertEqual(self.run_script("--check").returncode, 2)  # drift reported, nothing written
        self.assertNotIn("Stop", self.read()["hooks"])
        r = self.run_script("--apply")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        got = self.read()
        self.assertEqual(got["hooks"]["Stop"], [hook(STOP_CMD)])
        # Other events untouched, permissions untouched.
        self.assertEqual(got["hooks"]["SessionStart"], CONSUMER["hooks"]["SessionStart"])
        self.assertEqual(got["hooks"]["UserPromptSubmit"], CONSUMER["hooks"]["UserPromptSubmit"])
        self.assertEqual(got["permissions"], CONSUMER["permissions"])

    def test_idempotent_second_run_changes_nothing(self):
        self.write(CONSUMER)
        self.run_script("--apply")
        first = self.read()
        r = self.run_script("--apply")
        self.assertEqual(r.returncode, 0)
        self.assertEqual(self.read(), first)
        self.assertEqual(self.run_script("--check").returncode, 0)

    def test_entry_is_appended_to_an_existing_event_array_without_touching_the_rest(self):
        settings = copy.deepcopy(CONSUMER)
        own = hook("node my-own-stop-hook.mjs")
        settings["hooks"]["Stop"] = [own]
        self.write(settings)
        r = self.run_script("--apply")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        self.assertEqual(self.read()["hooks"]["Stop"], [own, hook(STOP_CMD)])

    def test_existing_command_is_not_duplicated_even_with_a_different_path_spelling(self):
        settings = copy.deepcopy(CONSUMER)
        settings["hooks"]["Stop"] = [hook("node ./shared/scripts/human-prompt-gate.mjs")]
        self.write(settings)
        self.run_script("--apply")
        self.assertEqual(self.read()["hooks"]["Stop"], [hook("node ./shared/scripts/human-prompt-gate.mjs")])

    def test_missing_entry_in_session_start_is_appended_too(self):
        settings = copy.deepcopy(CONSUMER)
        settings["hooks"]["SessionStart"] = settings["hooks"]["SessionStart"][:1]
        self.write(settings)
        self.run_script("--apply")
        cmds = [h["hooks"][0]["command"] for h in self.read()["hooks"]["SessionStart"]]
        self.assertEqual(cmds, [
            "node shared/scripts/scheduler-rearm-notice.mjs",
            "node .claude/skills/lease/session-init.mjs",
            "node shared/scripts/opos-session-update.mjs",
        ])

    def test_legacy_inline_rearm_entry_counts_as_the_mjs_entry(self):
        """A settings file with the old inline `python3 -c` re-arm reminder must not get
        scheduler-rearm-notice.mjs appended on top (two reminders per session)."""
        legacy = hook(
            "python3 -c \"import json,os; p='.claude/scheduled-processes.json'; "
            "rows=[r for r in (json.load(open(p)) if os.path.exists(p) else []) "
            "if not str(r.get('routine_id','')).startswith('gha:')]; "
            "print('[opos-scheduler] ' + str(len(rows)) + ' registration(s)') if rows else None\""
        )
        settings = copy.deepcopy(CONSUMER)
        settings["hooks"]["SessionStart"][0] = legacy
        self.write(settings)
        r = self.run_script("--apply")
        self.assertEqual(r.returncode, 0, r.stdout + r.stderr)
        start = self.read()["hooks"]["SessionStart"]
        self.assertEqual(start[0], legacy)  # untouched
        cmds = [h["hooks"][0]["command"] for h in start]
        self.assertFalse(any("scheduler-rearm-notice.mjs" in c for c in cmds), cmds)
        self.assertEqual(len(start), 3)

    def test_legacy_alias_does_not_swallow_an_unrelated_python_hook(self):
        settings = copy.deepcopy(CONSUMER)
        own = hook("python3 -c \"print('my own hook')\"")
        settings["hooks"]["SessionStart"] = [own]
        self.write(settings)
        self.run_script("--apply")
        cmds = [h["hooks"][0]["command"] for h in self.read()["hooks"]["SessionStart"]]
        self.assertIn("node shared/scripts/scheduler-rearm-notice.mjs", cmds)
        self.assertEqual(cmds[0], own["hooks"][0]["command"])

    def test_shipped_scaffold_settings_use_the_mjs_rearm_entry(self):
        """.claude/settings.json is what copier ships to new scaffolds; it must not carry the
        legacy inline command that reconciliation would otherwise duplicate."""
        shipped = json.loads((REPO / ".claude" / "settings.json").read_text(encoding="utf-8"))
        cmds = [h["command"] for e in shipped["hooks"]["SessionStart"] for h in e["hooks"]]
        self.assertIn("node shared/scripts/scheduler-rearm-notice.mjs", cmds)
        self.assertFalse(any(c.startswith("python3 -c") for c in cmds), cmds)

    def test_real_getdeal_style_copy_gets_stop_and_nothing_else_changes(self):
        """The shape of a production consumer file (copied, never edited in place)."""
        self.write(CONSUMER)
        before = self.read()
        self.run_script("--apply")
        after = self.read()
        before["hooks"]["Stop"] = [hook(STOP_CMD)]
        self.assertEqual(after, before)


if __name__ == "__main__":
    unittest.main()
