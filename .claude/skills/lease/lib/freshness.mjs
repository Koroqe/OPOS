/**
 * lease / lib/freshness.mjs — is this clone fit to hold a lease?
 *
 * This is the highest-value module in the skill. A clone that has fallen behind and does not
 * know it will happily serve scheduled jobs and report success. A stale clone that reports
 * success is worse than a crash: a crash gets investigated.
 *
 * So acquire() REFUSES (exit 3) before any work starts, rather than discovering the problem
 * at push time. renew() re-checks and YIELDS if the clone fell behind mid-run.
 */
import fs from 'node:fs';
import path from 'node:path';
import { shq, run } from './sh.mjs';
import { matchesAny } from './keys.mjs';

/** Age of the last fetch, in seconds. A behind-count computed from a week-old fetch is fiction. */
export function fetchAgeSeconds(root) {
  const gitDir = shq('git rev-parse --git-dir', { cwd: root }) || '.git';
  const abs = path.isAbsolute(gitDir) ? gitDir : path.join(root, gitDir);
  for (const f of ['FETCH_HEAD', 'refs/remotes/origin/HEAD']) {
    try { return Math.round((Date.now() - fs.statSync(path.join(abs, f)).mtimeMs) / 1000); } catch { /* try next */ }
  }
  return Number.POSITIVE_INFINITY;
}

export function fetchNow(root) {
  const r = run('git', ['fetch', '--quiet', 'origin'], { cwd: root });
  return r.ok;
}

function upstreamRef(root) {
  const u = shq('git rev-parse --abbrev-ref --symbolic-full-name "@{u}"', { cwd: root });
  if (u && !u.includes('fatal')) return u;
  for (const cand of ['origin/main', 'origin/master', 'origin/HEAD']) {
    if (shq(`git rev-parse --verify --quiet ${cand}`, { cwd: root })) return cand;
  }
  return null;
}

/**
 * @param {string[]} scope  globs the caller intends to write. Files modified OUTSIDE scope in
 *   the last dirty_mtime_window_s seconds are the machine form of the usual human heuristic:
 *   a file you did not touch, modified minutes ago, means another session is live in this tree.
 */
export function freshness(root, { scope = [], dirtyWindowS = 1800, maxAgeS = 600, autoFetch = true } = {}) {
  const branch = shq('git rev-parse --abbrev-ref HEAD', { cwd: root }) || '(detached)';
  const head = shq('git rev-parse HEAD', { cwd: root });

  let age = fetchAgeSeconds(root);
  let fetched = false;
  if (autoFetch && age > maxAgeS) { fetched = fetchNow(root); age = fetchAgeSeconds(root); }

  const up = upstreamRef(root);
  const counts = up ? shq(`git rev-list --left-right --count ${up}...HEAD`, { cwd: root }) : '';
  const [behindStr, aheadStr] = counts ? counts.split(/[ \t]+/) : ['0', '0'];

  const porcelain = shq('git status --porcelain --untracked-files=no', { cwd: root });
  const changed = porcelain ? porcelain.split(/\r?\n/).filter(Boolean).map((l) => l.slice(3).trim()) : [];
  const outside = changed.filter((f) => !matchesAny(f, scope));
  const now = Date.now();
  const outsideRecent = outside.filter((f) => {
    try { return (now - fs.statSync(path.join(root, f)).mtimeMs) / 1000 < dirtyWindowS; } catch { return false; }
  });

  return {
    root,
    branch,
    head: head ? head.slice(0, 10) : '',
    upstream: up,
    upstream_head: up ? (shq(`git rev-parse ${up}`, { cwd: root }) || '').slice(0, 10) : '',
    behind: Number(behindStr) || 0,
    ahead: Number(aheadStr) || 0,
    dirty_total: changed.length,
    dirty_outside_scope: outsideRecent.length,
    dirty_outside_files: outsideRecent.slice(0, 20),
    fetch_age_s: Number.isFinite(age) ? age : null,
    fetched_now: fetched,
    fetched_at: new Date(Date.now() - (Number.isFinite(age) ? age * 1000 : 0)).toISOString(),
  };
}

/** Repo-relative staged paths, for commit-gate. */
export function stagedFiles(root) {
  const out = shq('git diff --cached --name-only', { cwd: root });
  return out ? out.split(/\r?\n/).filter(Boolean) : [];
}
