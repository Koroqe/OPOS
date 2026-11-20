/**
 * lease / lib/claims.mjs — the claim record and its GitHub CRUD.
 *
 * ONE comment per lease for its whole lifetime. Heartbeats PATCH that comment; they never
 * append a second one. That is what keeps an issue thread readable and keeps notification
 * volume at one-per-lease (edits do not notify).
 *
 * Ordering primitive: GitHub's comment id is server-assigned and monotonic, giving a total
 * order over concurrent claimants. Note honestly what that is and is not — it orders, it does
 * not serialize. See SKILL.md "Residual risk 1".
 */
import { gh, ghJson, isRateLimited, retryAfterSeconds } from './sh.mjs';

export const MARKER = 'opos-lease:v1';
const OPEN = '<!-- ' + MARKER;
const CLOSE = '-->';

export const LIVE_STATES = new Set(['held']);
export const TERMINAL_STATES = new Set(['released', 'yielded', 'expired', 'stolen']);

const fmtClock = (iso) => (iso ? String(iso).slice(11, 16) : '??:??');

/** Human line first (a person reading the thread must not have to parse JSON), machine block second. */
export function renderRecord(rec) {
  const h = rec.holder ?? {};
  const c = rec.clone ?? {};
  const t = rec.t ?? {};
  const TICK = String.fromCharCode(96);
  const icon = rec.state === 'held' ? '\u{1F512}' : '\u{1F513}';
  const word = {
    held: 'LEASE', released: 'LEASE RELEASED', yielded: 'LEASE YIELDED',
    expired: 'LEASE EXPIRED', stolen: 'LEASE STOLEN',
  }[rec.state] ?? 'LEASE';
  const code = (v) => TICK + String(v) + TICK;

  const clonePart = c.head ? `HEAD ${code(c.head)} (behind ${c.behind ?? '?'}, ${c.branch ?? '?'})` : '';
  const first = `${icon} **${word}** ${code(rec.key)} — **${h.login ?? '?'}** (${code(h.host ?? '?')} · clone ${code(h.clone_id ?? '?')} · ${h.runtime ?? '?'})`;
  const second = rec.state === 'held'
    ? `holds until **${fmtClock(t.expires)} UTC** · heartbeat ${fmtClock(t.heartbeat)} · ${clonePart}`
    : `${fmtClock(t.heartbeat)} UTC · ${rec.reason ? 'reason: ' + rec.reason : 'no reason given'} · ${clonePart}`;

  return [first, second, rec.intent ? '"' + rec.intent + '"' : '', '', OPEN, JSON.stringify(rec), CLOSE].join('\n');
}

/** Tolerates a human editing prose around the block; returns null if there is no block at all. */
export function parseRecord(body) {
  if (typeof body !== 'string') return null;
  const i = body.indexOf(OPEN);
  if (i === -1) return null;
  const j = body.indexOf(CLOSE, i + OPEN.length);
  if (j === -1) return null;
  const raw = body.slice(i + OPEN.length, j).trim();
  try {
    const rec = JSON.parse(raw);
    return rec && typeof rec === 'object' && rec.key ? rec : null;
  } catch { return null; }
}

export function isExpired(rec, nowMs) {
  const exp = Date.parse(rec?.t?.expires ?? '');
  if (Number.isNaN(exp)) return true;
  return exp <= nowMs;
}

/** Live == state held AND not past expiry. Expiry is authoritative; the reaper is cosmetic. */
export function isLive(rec, nowMs) {
  return !!rec && LIVE_STATES.has(rec.state) && !isExpired(rec, nowMs);
}

export function sameHolder(a, b) {
  return !!(a && b && a.clone_id === b.clone_id && a.login === b.login);
}

const PAGE = 100;
const MAX_PAGES = 1000; // 100k comments; a registry rotates long before this — it is a runaway guard only

/**
 * Explicit page loop. NEVER `gh api --paginate`: past the first page gh follows GitHub's
 * `Link: rel="next"` URL, which is in `repositories/<numeric-id>/...` form, and some
 * proxied runtimes (hosted cloud sessions) reject numeric-ID paths with HTTP 403. Walking
 * `?page=N` on the `repos/<owner>/<repo>/...` path keeps every request in the supported form.
 * Stops on the first page shorter than a full page. `ghFn` is injectable for offline tests.
 */
function ghPages(basePath, jq, ghFn) {
  const lines = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const sep = basePath.includes('?') ? '&' : '?';
    const r = ghFn(['api', `${basePath}${sep}per_page=${PAGE}&page=${page}`, '--jq', jq]);
    if (!r.ok) return { ok: false, err: r.err };
    const rows = r.out.split('\n').map((l) => l.trim()).filter(Boolean);
    lines.push(...rows);
    if (rows.length < PAGE) return { ok: true, lines };
  }
  return { ok: false, err: `more than ${MAX_PAGES} pages at ${basePath} — refusing to continue` };
}

/**
 * All lease comments on a target. Returns { ok, claims:[{id, login, created_at, updated_at, body, rec}] }.
 * Sorted by comment id ascending — the tiebreak order.
 */
export function listClaims(target, { ghFn = gh } = {}) {
  if (!target?.repo) return { ok: false, claims: [], err: 'no ledger repo configured' };
  if (!target?.issue) return { ok: false, claims: [], err: 'no ledger issue configured (run: lease.mjs init-ledger)' };
  const r = ghPages(`repos/${target.repo}/issues/${target.issue}/comments`,
    '.[] | {id: .id, login: .user.login, created_at: .created_at, updated_at: .updated_at, body: .body}', ghFn);
  if (!r.ok) return { ok: false, claims: [], err: r.err, rateLimited: isRateLimited(r.err) };
  const claims = [];
  for (const line of r.lines) {
    let o; try { o = JSON.parse(line); } catch { continue; }
    const rec = parseRecord(o.body ?? '');
    if (rec) claims.push({ id: o.id, login: o.login, created_at: o.created_at, updated_at: o.updated_at, body: o.body, rec });
  }
  claims.sort((a, b) => a.id - b.id);
  return { ok: true, claims };
}

/**
 * Open issues carrying a label, via REST (`gh issue list` is GraphQL, which hosted cloud
 * proxies block). Returns { ok, data:[{number, title, body}] } like `gh issue list --json`.
 * The REST issues endpoint also returns pull requests; they are filtered out.
 */
export function listIssuesByLabel(repo, label, { limit = 100, ghFn = gh } = {}) {
  const per = Math.min(PAGE, Math.max(1, limit));
  const data = [];
  for (let page = 1; data.length < limit && page <= MAX_PAGES; page += 1) {
    const q = `repos/${repo}/issues?labels=${encodeURIComponent(label)}&state=open&per_page=${per}&page=${page}`;
    const r = ghFn(['api', q, '--jq', '.[] | {number: .number, title: .title, body: .body, pr: (.pull_request != null)}']);
    if (!r.ok) return { ok: false, data: [], err: r.err };
    const rows = r.out.split('\n').map((l) => l.trim()).filter(Boolean);
    for (const line of rows) {
      let o; try { o = JSON.parse(line); } catch { continue; }
      if (!o.pr) data.push({ number: o.number, title: o.title, body: o.body });
    }
    if (rows.length < per) break;
  }
  return { ok: true, data: data.slice(0, limit) };
}

/** One comment by id — the cache-confirm path for `check`, 1 API call. */
export function getClaim(repo, commentId) {
  const r = ghJson(['api', `/repos/${repo}/issues/comments/${commentId}`,
    '--jq', '{id: .id, login: .user.login, created_at: .created_at, updated_at: .updated_at, body: .body}']);
  if (!r.ok) return { ok: false, err: r.err, missing: /not found|404/i.test(r.err) };
  const rec = parseRecord(r.data?.body ?? '');
  return { ok: true, claim: rec ? { ...r.data, rec } : null };
}

/** Body always travels as JSON on stdin — never a shell string. Records contain braces, quotes and Cyrillic. */
export function postClaim(target, body) {
  const r = ghJson(['api', '--method', 'POST', `/repos/${target.repo}/issues/${target.issue}/comments`,
    '--input', '-', '--jq', '{id: .id, created_at: .created_at, url: .html_url}'],
    { input: JSON.stringify({ body }) });
  if (!r.ok) return { ok: false, err: r.err, rateLimited: isRateLimited(r.err), retryAfter: retryAfterSeconds(r.err) };
  return { ok: true, id: r.data.id, url: r.data.url, created_at: r.data.created_at };
}

export function patchClaim(repo, commentId, body) {
  const r = ghJson(['api', '--method', 'PATCH', `/repos/${repo}/issues/comments/${commentId}`,
    '--input', '-', '--jq', '{id: .id}'], { input: JSON.stringify({ body }) });
  if (!r.ok) return { ok: false, err: r.err, missing: /not found|404/i.test(r.err), rateLimited: isRateLimited(r.err) };
  return { ok: true, id: r.data.id };
}

export function deleteClaim(repo, commentId) {
  const r = gh(['api', '--method', 'DELETE', `/repos/${repo}/issues/comments/${commentId}`]);
  if (!r.ok && !/not found|404/i.test(r.err)) return { ok: false, err: r.err };
  return { ok: true };
}

export function addLabel(repo, issue, label) {
  const r = gh(['issue', 'edit', String(issue), '--repo', repo, '--add-label', label]);
  return { ok: r.ok, err: r.err };
}
export function removeLabel(repo, issue, label) {
  const r = gh(['issue', 'edit', String(issue), '--repo', repo, '--remove-label', label]);
  return { ok: r.ok, err: r.err };
}
