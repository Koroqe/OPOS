#!/usr/bin/env node
/**
 * scheduler-rearm-notice.mjs — SessionStart notices about the scheduled loop.
 *
 * Two notices, each printed only when there is something to say:
 *
 * 1. `[opos-scheduler]` — routines registered on the `claude-schedule` runtime die with the
 *    session that created them, so a new session needs to re-arm them.
 * 2. `[opos-loop]` — `proposed_delta` entries are waiting for `review-history`, and
 *    `review-history` has not run within LOOP_STALE_DAYS (or never has). Every other loop signal
 *    the steward reads is keyed on `.claude/scheduled-processes.json`, so a company that never
 *    registered the sweep looks exactly like a fresh scaffold: no Loop line, nothing reaches local
 *    files or upstream, and nobody is told. This notice reads the records themselves. It lives in
 *    this script, the SessionStart entry shared/templates/required-settings.json already declares,
 *    rather than in a new hook entry: a new entry would not reach consumers that already have a
 *    SessionStart array (the additive class never extends an existing value).
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

// ---- [opos-loop]: deltas waiting on a review-history that is not running ----

// Two missed runs of the weekly sweep. A delta younger than this is not yet late.
const LOOP_STALE_DAYS = 14;
const DAY_MS = 86_400_000;
const SKIP_DIRS = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__']);
const RECORD_DIRS = new Set(['history', 'scheduled-runs']);

const scalar = (fm, key) => {
  const m = fm.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'));
  if (!m) return null;
  return m[1].replace(/\s+#.*$/, '').trim().replace(/^(["'])(.*)\1$/, '$2').trim();
};
const isNone = (v) => v === null || v === '' || /^(none|null|~)$/i.test(v);

/** Every `<dir>/{history,scheduled-runs}/YYYY-MM-DD-*.md`, as review-history's own glob sees them. */
function records(dir, depth = 0, out = []) {
  if (depth > 8) return out;
  for (const e of safe(() => fs.readdirSync(dir, { withFileTypes: true }), []) ?? []) {
    if (!e.isDirectory() || SKIP_DIRS.has(e.name)) continue;
    const sub = path.join(dir, e.name);
    if (RECORD_DIRS.has(e.name)) {
      for (const f of safe(() => fs.readdirSync(sub), []) ?? []) {
        const date = /^(\d{4}-\d{2}-\d{2})-.*\.md$/.exec(f)?.[1];
        if (date) out.push({ file: path.join(sub, f), date, skill: path.basename(dir) });
      }
    } else {
      records(sub, depth + 1, out);
    }
  }
  return out;
}

safe(() => {
  const all = records(root);
  const now = Date.now();
  const ageDays = (d) => Math.floor((now - Date.parse(`${d}T00:00:00Z`)) / DAY_MS);

  const lastSweep = all.filter((r) => r.skill === 'review-history').map((r) => r.date).sort().pop() ?? null;
  if (lastSweep && ageDays(lastSweep) <= LOOP_STALE_DAYS) return;

  // Waiting = what review-history step 3 selects: status open, a real delta, no upstream PR yet.
  const waiting = all.filter((r) => {
    const text = safe(() => fs.readFileSync(r.file, 'utf8'), '') ?? '';
    if (!text.startsWith('---')) return false;
    const end = text.indexOf('\n---', 3);
    if (end === -1) return false;
    const fm = text.slice(3, end);
    return scalar(fm, 'status') === 'open' && !isNone(scalar(fm, 'proposed_delta')) && isNone(scalar(fm, 'upstream_pr'));
  });
  if (!waiting.length) return;

  const oldest = waiting.map((r) => r.date).sort()[0];
  if (ageDays(oldest) <= LOOP_STALE_DAYS) return;

  const since = lastSweep ? `has not run in ${ageDays(lastSweep)} days` : 'has never run';
  process.stdout.write(
    `[opos-loop] review-history ${since}; ${waiting.length} open proposed_delta entr${waiting.length === 1 ? 'y waits' : 'ies wait'} ` +
    `for it (oldest ${oldest}). Until it runs, no recorded fix reaches local files or upstream: ` +
    'run review-history, or register it with /schedule-process.\n',
  );
});

process.exit(0);
