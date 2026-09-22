#!/usr/bin/env node
/**
 * lease / session-init.mjs — the SessionStart hook entry point.
 *
 * Three jobs, none of which may ever fail loudly: a hook that errors on a fresh clone is worse
 * than no hook at all. Every step is wrapped; the process always exits 0.
 *
 *   1. mint/refresh this session's id at .claude/.sessions/<id>.json (and the clone id)
 *   2. print ONE line of occupancy, read from the committed projection — zero API calls
 *   3. re-attach: renew any lease this clone already holds that is close to expiring
 *
 * Step 3 is the cheapest possible recovery after a session restart: the work is still going
 * on, the session id changed, and without it the lease would lapse mid-task.
 *
 * Deliberately a .mjs file rather than an inline one-liner in settings.json. Logic in a file is
 * testable and reviewable; logic in a JSON-escaped shell string is neither, and fails silently
 * when the interpreter it names is missing on a given machine.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execSync, execFileSync } from 'node:child_process';

function safe(fn, fallback = null) { try { return fn(); } catch { return fallback; } }

const root = safe(() => execSync('git rev-parse --show-toplevel', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(), null)
  ?? process.cwd();

// ---- 1. identity ------------------------------------------------------------
let stdin = '';
safe(() => { stdin = fs.readFileSync(0, 'utf8'); });
const payload = safe(() => JSON.parse(stdin || '{}'), {}) ?? {};

const sessionsDir = path.join(root, '.claude', '.sessions');
const sessionId = String(payload.session_id ?? `s-${process.pid}-${Date.now().toString(36)}`).slice(0, 64);

safe(() => {
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.writeFileSync(path.join(sessionsDir, `${sessionId.replace(/[^A-Za-z0-9._-]/g, '_')}.json`), JSON.stringify({
    session: sessionId,
    pid: process.pid,
    started: new Date().toISOString(),
    cwd: process.cwd(),
    transcript: payload.transcript_path ?? null,
  }, null, 2) + '\n');
});

// Prune session files older than a week so the folder does not grow without bound.
safe(() => {
  const cutoff = Date.now() - 7 * 86400 * 1000;
  for (const f of fs.readdirSync(sessionsDir)) {
    const p = path.join(sessionsDir, f);
    if (safe(() => fs.statSync(p).mtimeMs, Infinity) < cutoff) safe(() => fs.rmSync(p, { force: true }));
  }
});

const cloneIdFile = path.join(root, '.claude', '.clone-id');
let cloneId = safe(() => fs.readFileSync(cloneIdFile, 'utf8').trim(), '') || '';
if (!cloneId) {
  cloneId = 'c-' + safe(() => execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().slice(0, 4), 'xxxx')
    + Date.now().toString(36).slice(-4);
  safe(() => fs.writeFileSync(cloneIdFile, cloneId + '\n'));
}

// ---- 2. occupancy line, zero API calls --------------------------------------
const cfg = safe(() => JSON.parse(fs.readFileSync(path.join(root, '.claude', 'lease.config.json'), 'utf8')), null);
const projPath = path.join(root, (cfg?.projection_path ?? 'company/ops/ops-leases.md'));
const proj = safe(() => fs.readFileSync(projPath, 'utf8'), null);

let summary = null;
safe(() => {
  const i = proj?.indexOf('<!-- opos-leases:v1 ') ?? -1;
  if (i === -1) return;
  const j = proj.indexOf(' -->', i);
  if (j === -1) return;
  const p = JSON.parse(proj.slice(i + '<!-- opos-leases:v1 '.length, j));
  const leases = p.leases ?? [];
  summary = {
    at: String(p.generated_at ?? '').slice(11, 16),
    mine: leases.filter((l) => l.holder?.clone_id === cloneId),
    others: leases.filter((l) => l.holder?.clone_id !== cloneId),
  };
});

const cached = safe(() => {
  const d = path.join(root, '.claude', 'skills', 'lease', '.state', 'held');
  return fs.readdirSync(d).map((f) => JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')))
    .filter((r) => Date.parse(r.expires) > Date.now());
}, []) ?? [];

const parts = [`clone ${cloneId}`];
parts.push(cached.length ? `my leases: ${cached.length} (${cached.map((c) => c.key).join(', ')})` : 'no leases of mine');
if (summary) parts.push(`others live: ${summary.others.length} · snapshot ${summary.at}`);
else parts.push('no occupancy snapshot yet (the projection has not been generated)');
process.stdout.write('[opos-lease] ' + parts.join(' · ') + '\n');

// ---- 3. re-attach: renew anything about to lapse ----------------------------
safe(() => {
  const soon = cached.filter((c) => Date.parse(c.expires) - Date.now() < 15 * 60 * 1000);
  if (!soon.length) return;
  execFileSync(process.execPath, [path.join(root, '.claude', 'skills', 'lease', 'lease.mjs'), 'renew', '--all', '--no-fetch', '--quiet'], {
    cwd: root, encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'ignore', 'ignore'],
  });
});

process.exit(0);
