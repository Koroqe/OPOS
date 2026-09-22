/**
 * lease / lib/sh.mjs — process helpers.
 *
 * Deliberately NOT modelled on ops-board/lib/board.mjs's sh(), which swallows stderr and
 * returns '' on failure. That is right for a read-only fetch and catastrophic for a write
 * protocol: a POST that failed would look identical to a POST that returned nothing, and
 * the caller would conclude it holds a lease it does not hold.
 *
 * Every gh body goes over stdin as JSON (--input -). Never a shell string: task-register
 * step 9 and task-update step 9 both record shell-quoting as a known trap, and lease
 * records contain braces, quotes and Cyrillic.
 */
import { execFileSync, execSync } from 'node:child_process';

const MAXBUF = 64 * 1024 * 1024;

/** Run a program. Returns {ok, code, out, err}. Never throws. */
export function run(file, args, { input = null, cwd = undefined } = {}) {
  try {
    const out = execFileSync(file, args, {
      encoding: 'utf8', maxBuffer: MAXBUF, cwd,
      input: input === null ? undefined : input,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { ok: true, code: 0, out: out ?? '', err: '' };
  } catch (e) {
    return {
      ok: false,
      code: typeof e.status === 'number' ? e.status : 1,
      out: e.stdout?.toString?.() ?? '',
      err: (e.stderr?.toString?.() ?? '') || e.message || '',
    };
  }
}

/** Shell out (git plumbing where argv arrays are noise). Returns trimmed stdout, '' on failure. */
export function shq(cmd, { cwd = undefined } = {}) {
  try {
    return execSync(cmd, { encoding: 'utf8', maxBuffer: MAXBUF, cwd, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return ''; }
}

/** gh with argv array. */
export function gh(args, opts = {}) { return run('gh', args, opts); }

/**
 * gh api returning parsed JSON. { ok, data, code, err }.
 * A non-zero exit is NEVER silently turned into empty data — callers branch on ok.
 */
export function ghJson(args, opts = {}) {
  const r = gh(args, opts);
  if (!r.ok) return { ok: false, data: null, code: r.code, err: r.err };
  try { return { ok: true, data: JSON.parse(r.out || 'null'), code: 0, err: '' }; }
  catch (e) { return { ok: false, data: null, code: 1, err: `unparseable gh output: ${e.message}\n${r.out.slice(0, 400)}` }; }
}

/**
 * GitHub secondary (content-creation) rate limiting returns 403 + Retry-After and is the
 * real ceiling of a comment-based protocol — it bites long before the 5000/h primary limit.
 * Classified as "back off", never as a hard error, so a caller retries instead of aborting.
 */
export function isRateLimited(err = '') {
  const s = String(err).toLowerCase();
  return s.includes('rate limit') || s.includes('secondary rate') || s.includes('abuse detection')
      || s.includes('retry-after') || s.includes('was submitted too quickly');
}

export function retryAfterSeconds(err = '') {
  const m = /retry-after:\s*(\d+)/i.exec(String(err));
  return m ? Number(m[1]) : null;
}

export const sleep = (ms) => { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
