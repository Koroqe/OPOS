#!/usr/bin/env node
/**
 * scheduler-rearm-notice.mjs — SessionStart notice about session-scoped cron registrations.
 *
 * Routines registered on the `claude-schedule` runtime die with the session that created them,
 * so a new session needs to re-arm them. This prints that reminder, and nothing when there is
 * nothing to say.
 *
 * Previously an inline `python3 -c "..."` inside settings.json. Two problems with that: on a
 * stock Windows machine `python3` is a Microsoft Store alias stub that exits 49, so the hook had
 * been silently dead there since it shipped; and a JSON-escaped shell string containing a Python
 * one-liner is not something any test or reviewer can meaningfully check. Never fails loudly — a
 * hook that errors on a fresh clone is worse than no hook.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };

const root = safe(
  () => execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(),
  null,
) ?? process.cwd();

const rows = safe(() => {
  const p = path.join(root, '.claude', 'scheduled-processes.json');
  const all = JSON.parse(fs.readFileSync(p, 'utf8'));
  // `gha:` registrations are durable — they live in a workflow file, not in a session.
  return (Array.isArray(all) ? all : []).filter((r) => !String(r?.routine_id ?? '').startsWith('gha:'));
}, []) ?? [];

if (rows.length) {
  const names = rows.map((r) => r.process_name).filter(Boolean).join(', ');
  process.stdout.write(
    `[opos-scheduler] ${rows.length} session-scoped registration(s) (${names}) need re-arming: ` +
    're-run /schedule-process for each (idempotent; previously authorized). ' +
    'gha registrations are durable and need nothing.\n',
  );
}

process.exit(0);
