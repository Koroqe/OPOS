#!/usr/bin/env python3
"""Reconcile a consumer's .claude/settings.json against the CORE manifest.

WHY THIS EXISTS
    `.claude/settings.json` is listed in copier.yml's `_skip_if_exists`, because
    it holds consumer-owned permissions that an update must never clobber. The
    side effect is that NO framework change to that file can ever reach an
    existing consumer — `copier update` deliberately skips it, forever. Before
    this script, every settings-level framework fix was undeliverable and had to
    be applied by hand in each consumer repo, which in practice meant it wasn't.

    This runs after `copier update` (sync-from-core step 6b, auto-sync step 10b)
    and delivers exactly the keys the manifest declares — and nothing else.

SAFETY CONTRACT
    Paths under the manifest's `never_write` list are NEVER written, in any mode,
    for any reason. That covers everything under `permissions`, per never-automate
    invariant 1 (credential/access grants are human-only). A permissions gap is
    REPORTED for a human to approve at Confirm tier; it is never applied here.

    `managed` keys are framework posture: the value is overwritten if it differs.
    `additive` keys are framework defaults: written only when absent, so a
    consumer's own value always wins. One exception, for hook registrations
    (`hooks.<Event>` arrays): when the consumer already has the event, hook
    entries whose command is not yet registered there are APPENDED (existing
    entries are never edited, reordered or removed, and a command that is
    already present - matched by script file name, else by exact string - is
    never duplicated). Without this, a new framework hook on an event the
    consumer already uses (e.g. a second SessionStart script) could never arrive.

USAGE
    reconcile-settings.py --check    exit 0 = in sync, exit 2 = drift (writes nothing)
    reconcile-settings.py --apply    write the changes, print what changed
"""

import argparse
import json
import pathlib
import re
import sys

MANIFEST_REL = "shared/templates/required-settings.json"
SETTINGS_REL = ".claude/settings.json"


def split_path(dotted):
    """Split a manifest key into (top_level, sub_key_or_None).

    Splits on the FIRST dot only: a plugin id such as
    'claude-code-sdlc@claude-code-sdlc' is a single key that may itself contain
    dots, so a greedy split would shred it. Manifest paths are 2 levels deep at
    most, which this covers exactly.
    """
    if "." not in dotted:
        return dotted, None
    top, sub = dotted.split(".", 1)
    return top, sub


def get_at(doc, top, sub):
    if top not in doc:
        return None, False
    if sub is None:
        return doc[top], True
    container = doc[top]
    if not isinstance(container, dict) or sub not in container:
        return None, False
    return container[sub], True


def set_at(doc, top, sub, value):
    if sub is None:
        doc[top] = value
        return
    if not isinstance(doc.get(top), dict):
        doc[top] = {}
    doc[top][sub] = value


_SCRIPT_RE = re.compile(r"[\w./\-]+\.(?:mjs|cjs|js|py|sh)(?![\w])")


# Legacy hook commands that are the SAME hook as a current manifest script, written differently.
# Each pair is (pattern that identifies the legacy command, identity of the current script).
# A settings file carrying the legacy form is treated as already having the current entry, so
# reconciliation does not append a second copy (two reminders per session). Extend this list when
# a manifest hook replaces an inline command; it is deliberately explicit, never heuristic.
LEGACY_COMMAND_ALIASES = [
    # Before v0.19.x the scheduler re-arm reminder was an inline `python3 -c "..."` reading
    # .claude/scheduled-processes.json; it is now shared/scripts/scheduler-rearm-notice.mjs.
    (re.compile(r"python3?\s+-c\b.*\.claude/scheduled-processes\.json", re.S), "scheduler-rearm-notice.mjs"),
]


def _command_key(command):
    """Identity of a hook command: its script file name when it names one, else the whole string."""
    for pattern, identity in LEGACY_COMMAND_ALIASES:
        if pattern.search(command or ""):
            return identity
    m = _SCRIPT_RE.search(command or "")
    return m.group(0).replace("\\", "/").rsplit("/", 1)[-1] if m else (command or "").strip()


def _commands(entries):
    for entry in entries:
        if isinstance(entry, dict):
            for hook in entry.get("hooks", []) or []:
                if isinstance(hook, dict) and hook.get("command"):
                    yield hook["command"]


def missing_hook_entries(current, wanted):
    """Entries of `wanted` (a hook-event array) with a command absent from `current`."""
    have = {_command_key(c) for c in _commands(current)}
    missing = []
    for entry in wanted:
        cmds = list(_commands([entry]))
        if cmds and all(_command_key(c) in have for c in cmds):
            continue
        missing.append(entry)
        have.update(_command_key(c) for c in cmds)
    return missing


def is_protected(dotted, never_write):
    """True if this path, or any ancestor of it, is on the never-write list."""
    top, _ = split_path(dotted)
    return dotted in never_write or top in never_write


def reconcile(root, apply_changes):
    manifest_path = root / MANIFEST_REL
    settings_path = root / SETTINGS_REL

    if not manifest_path.exists():
        print(f"[reconcile-settings] no manifest at {MANIFEST_REL} — nothing to do")
        return 0

    manifest = json.loads(manifest_path.read_text())
    never_write = set(manifest.get("never_write", []))

    if settings_path.exists():
        raw = settings_path.read_text()
        try:
            settings = json.loads(raw)
        except json.JSONDecodeError as exc:
            print(f"[reconcile-settings] {SETTINGS_REL} is not valid JSON ({exc}).")
            print("[reconcile-settings] REFUSING to touch it — a consumer's settings file")
            print("[reconcile-settings] is never rewritten from a state this script cannot parse.")
            return 1
    else:
        settings = {}
        raw = None

    changes = []
    skipped = []

    for dotted, wanted in manifest.get("managed", {}).items():
        if is_protected(dotted, never_write):
            skipped.append((dotted, "managed key is also on never_write — manifest bug"))
            continue
        top, sub = split_path(dotted)
        current, present = get_at(settings, top, sub)
        if not present:
            set_at(settings, top, sub, wanted)
            changes.append(f"added   {dotted} = {json.dumps(wanted)}")
        elif current != wanted:
            set_at(settings, top, sub, wanted)
            changes.append(
                f"updated {dotted}: {json.dumps(current)} -> {json.dumps(wanted)} (framework-managed)"
            )

    for dotted, default in manifest.get("additive", {}).items():
        if is_protected(dotted, never_write):
            skipped.append((dotted, "additive key is also on never_write — manifest bug"))
            continue
        top, sub = split_path(dotted)
        current, present = get_at(settings, top, sub)
        if not present:
            set_at(settings, top, sub, default)
            changes.append(f"added   {dotted} (framework default; consumer value would have won)")
        elif top == "hooks" and isinstance(current, list) and isinstance(default, list):
            extra = missing_hook_entries(current, default)
            if extra:
                current.extend(extra)
                names = ", ".join(sorted({_command_key(c) for c in _commands(extra)}))
                changes.append(f"appended {len(extra)} hook entr{'y' if len(extra) == 1 else 'ies'} to {dotted}: {names}")

    for path in sorted(never_write):
        skipped.append((path, "never written — human-approved at Confirm tier only"))

    if not changes:
        print("[reconcile-settings] settings.json already matches the framework manifest")
        for path, why in skipped:
            if "never written" not in why:
                print(f"[reconcile-settings] WARNING {path}: {why}")
        return 0

    print(f"[reconcile-settings] {len(changes)} change(s) {'applied' if apply_changes else 'needed'}:")
    for line in changes:
        print(f"[reconcile-settings]   {line}")
    print("[reconcile-settings] untouched (never-automate invariant 1): " + ", ".join(sorted(never_write)))

    if not apply_changes:
        return 2

    settings_path.parent.mkdir(parents=True, exist_ok=True)
    trailing = "\n" if raw is None or raw.endswith("\n") else ""
    settings_path.write_text(json.dumps(settings, indent=2) + trailing)
    print(f"[reconcile-settings] wrote {SETTINGS_REL}")
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    mode = ap.add_mutually_exclusive_group(required=True)
    mode.add_argument("--check", action="store_true", help="report drift, write nothing (exit 2 on drift)")
    mode.add_argument("--apply", action="store_true", help="apply the manifest to settings.json")
    ap.add_argument("--root", default=".", help="repo root (default: cwd)")
    args = ap.parse_args()
    sys.exit(reconcile(pathlib.Path(args.root).resolve(), args.apply))


if __name__ == "__main__":
    main()
