/**
 * lease / lib/identity.mjs — who is asking, from where, in which runtime, and how wrong is its clock.
 *
 * Two ids, not one. The brief for this skill said "session id"; that is not sufficient:
 *   - clone_id identifies the WORKING TREE. For path: and branch: keys the protected resource
 *     IS the working tree, and two Claude sessions in one clone share it. clone_id is also the
 *     thing that goes stale (backlog lesson stale-clone-serves-production, 7 occurrences) and
 *     it survives across days, which a session id does not.
 *   - session discriminates two sessions on one host+login. Without it, "some session on that
 *     box edited the shared log mid-run" is unattributable.
 * Both are recorded. Conflict resolution keys on clone_id (see SKILL.md "Residual risk": two
 * sessions inside one clone are deliberately NOT separated for issue: keys).
 *
 * Nothing here trusts Date.now() for expiry — see serverNow().
 */
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { gh, shq, run } from './sh.mjs';

export const BACKSLASH = String.fromCharCode(92);
export const toPosix = (s) => String(s).split(BACKSLASH).join('/');

export function repoRoot() {
  const r = shq('git rev-parse --show-toplevel');
  return toPosix(r || process.cwd());
}

const stateDir = (root) => path.join(root, '.claude', 'skills', 'lease', '.state');

function readJson(p, fallback = null) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return fallback; }
}
function writeJson(p, v) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(v, null, 2) + '\n');
}

/** Persistent per-clone id. Minted once, never rotated — its whole value is that it outlives sessions. */
export function cloneId(root) {
  if (process.env.OPOS_CLONE_ID) return process.env.OPOS_CLONE_ID;
  const f = path.join(root, '.claude', '.clone-id');
  try {
    const v = fs.readFileSync(f, 'utf8').trim();
    if (v) return v;
  } catch { /* mint below */ }
  const v = 'c-' + randomUUID().replace(/-/g, '').slice(0, 8);
  try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, v + '\n'); } catch { /* read-only fs: ephemeral id is fine */ }
  return v;
}

function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

/** Newest session file whose pid is still alive; else null. */
function sessionFromFiles(root) {
  const dir = path.join(root, '.claude', '.sessions');
  let entries;
  try { entries = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return null; }
  const recs = entries
    .map((f) => ({ f, rec: readJson(path.join(dir, f)) }))
    .filter((x) => x.rec && x.rec.session)
    .sort((a, b) => String(b.rec.started ?? '').localeCompare(String(a.rec.started ?? '')));
  const live = recs.find((x) => pidAlive(x.rec.pid));
  return (live ?? recs[0])?.rec?.session ?? null;
}

function detectRuntime() {
  if (process.env.OPOS_RUNTIME) return process.env.OPOS_RUNTIME;
  if (process.env.GITHUB_ACTIONS === 'true') return 'gha';
  if (process.env.OPOS_BOT === '1') return 'bot';
  if (process.env.CLAUDE_SCHEDULED === '1' || process.env.OPOS_SCHEDULED === '1') return 'scheduler';
  return process.stdout.isTTY || process.env.CLAUDECODE ? 'interactive' : 'scheduler';
}

/** gh login, cached 24h — one API call per day per clone, not one per acquire. */
function ghLogin(root) {
  if (process.env.OPOS_LOGIN) return { login: process.env.OPOS_LOGIN, ok: true };
  /*
   * GitHub Actions: take the login from the environment, never from `gh api user`.
   * GITHUB_TOKEN is an App installation token and CANNOT read /user — it returns
   * 403 'Resource not accessible by integration'. Calling it there made every
   * scheduled maintenance run fail identity resolution and exit 6 while the job,
   * wrapped in continue-on-error, still reported success: a green check that did
   * nothing at all, which is the exact failure class this skill exists to prevent.
   */
  if (process.env.GITHUB_ACTIONS === 'true') {
    const actor = process.env.GITHUB_TRIGGERING_ACTOR || process.env.GITHUB_ACTOR;
    if (actor) return { login: actor, ok: true, source: 'gha-env' };
  }
  const cacheFile = path.join(stateDir(root), 'identity.json');
  const cached = readJson(cacheFile);
  if (cached?.login && cached.at && (Date.now() - Date.parse(cached.at)) < 24 * 3600 * 1000) {
    return { login: cached.login, ok: true, cached: true };
  }
  const r = gh(['api', 'user', '--jq', '.login']);
  if (!r.ok) return { login: cached?.login ?? null, ok: false, err: r.err };
  const login = r.out.trim();
  writeJson(cacheFile, { login, at: new Date().toISOString() });
  return { login, ok: true };
}

/**
 * Authoritative clock. Expiry is ALWAYS computed against GitHub's Date header, never the
 * local clock: a drifted Windows box would otherwise write expires ten minutes in the past
 * (losing every lease instantly) or ten minutes ahead (holding everything too long), and
 * neither is diagnosable from the record afterwards.
 *
 * /rate_limit does not consume quota, which is why it is the probe.
 */
export function serverNow() {
  const r = run('gh', ['api', '-i', '/rate_limit']);
  const blob = (r.out || '') + '\n' + (r.err || '');
  const m = /^date:\s*(.+)$/im.exec(blob);
  const localMs = Date.now();
  if (m) {
    const t = Date.parse(m[1].trim());
    if (!Number.isNaN(t)) return { ms: t, source: 'github', skew_s: Math.round((t - localMs) / 1000) };
  }
  return { ms: localMs, source: 'local', skew_s: 0, degraded: true };
}

export function identity({ root = null, withClock = true } = {}) {
  const r = root ?? repoRoot();
  const runtime = detectRuntime();
  const gha = process.env.GITHUB_ACTIONS === 'true';

  let clone_id, session, host;
  if (gha) {
    // Ephemeral checkout: never read or write .claude/.clone-id — there is nothing to persist to.
    clone_id = process.env.OPOS_CLONE_ID ?? `gha:${process.env.GITHUB_REPOSITORY ?? '?'}:${process.env.GITHUB_WORKFLOW ?? '?'}`;
    session = process.env.OPOS_SESSION_ID ?? `gha-${process.env.GITHUB_RUN_ID ?? '0'}.${process.env.GITHUB_RUN_ATTEMPT ?? '1'}-${process.env.GITHUB_JOB ?? 'job'}`;
    host = `runner:${process.env.RUNNER_NAME ?? 'github'}`;
  } else {
    clone_id = cloneId(r);
    session = process.env.OPOS_SESSION_ID ?? sessionFromFiles(r) ?? clone_id;
    host = process.env.OPOS_HOST ?? os.hostname();
  }

  const { login, ok: loginOk, err: loginErr } = ghLogin(r);
  const clock = withClock ? serverNow() : { ms: Date.now(), source: 'local', skew_s: 0 };

  return {
    root: r,
    holder: {
      login: login ?? 'unknown',
      host,
      user: (() => { try { return os.userInfo().username; } catch { return 'unknown'; } })(),
      clone_id,
      session,
      runtime,
      agent: process.env.OPOS_AGENT ?? 'chief-of-staff',
    },
    loginOk,
    loginErr: loginErr ?? null,
    clock,
  };
}

export { readJson, writeJson, stateDir };
