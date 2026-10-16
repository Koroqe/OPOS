/** node --test .claude/skills/lease/lib/claims.test.mjs — offline: no gh, no network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderRecord, parseRecord, isLive, isExpired, sameHolder, listClaims, listIssuesByLabel, MARKER } from './claims.mjs';

const T0 = Date.parse('2026-09-22T12:00:00.000Z');

const rec = (over = {}) => ({
  v: 1,
  key: 'path:departments/example/data/sourcing/**',
  state: 'held',
  nonce: 'ABCDEF0123456789',
  holder: { login: 'octocat', host: 'build-01', user: 'dev', clone_id: 'c-8f21ab', session: 's-4f9c', runtime: 'interactive', agent: 'chief-of-staff' },
  clone: { root: '/srv/work/repo', branch: 'main', head: 'a40794a5c1', upstream: 'origin/main', upstream_head: 'a40794a5c1', behind: 0, ahead: 0, dirty_outside_scope: 0, fetched_at: '2026-09-22T11:50:00.000Z' },
  scope: ['departments/example/data/sourcing/**'],
  intent: 'rewrite the sourcing pipeline',
  t: { acquired: '2026-09-22T11:40:00.000Z', heartbeat: '2026-09-22T11:52:00.000Z', expires: '2026-09-22T12:40:00.000Z', ttl_s: 2700, local_clock: '2026-09-22T11:52:00.000Z', skew_s: -3 },
  ledger: { repo: 'acme/company-os', issue: 440, comment_id: 1 },
  index: { label: 'leased', applied: true },
  ...over,
});

test('record survives a render -> parse round trip byte-exactly', () => {
  const r = rec();
  const parsed = parseRecord(renderRecord(r));
  assert.deepEqual(parsed, r);
});

test('render puts a human line FIRST — a person reading the thread must not have to parse JSON', () => {
  const body = renderRecord(rec());
  const firstLine = body.split('\n')[0];
  assert.match(firstLine, /LEASE/);
  assert.match(firstLine, /octocat/);
  assert.match(firstLine, /c-8f21ab/);
  assert.ok(body.indexOf('LEASE') < body.indexOf(MARKER), 'prose must precede the machine block');
  assert.match(body, /sourcing pipeline/, 'intent must be visible to a human deciding whether to steal');
});

test('render surfaces the behind-count — the field the whole stale-clone class turns on', () => {
  assert.match(renderRecord(rec({ clone: { ...rec().clone, behind: 132 } })), /behind 132/);
});

test('parse tolerates a human editing prose around the block', () => {
  const body = 'I picked this up, leave it alone\n\n' + renderRecord(rec()) + '\n\n/cc @someone';
  assert.equal(parseRecord(body)?.key, rec().key);
});

test('parse returns null rather than guessing', () => {
  assert.equal(parseRecord('just a normal comment'), null);
  assert.equal(parseRecord(''), null);
  assert.equal(parseRecord(null), null);
  assert.equal(parseRecord('<!-- opos-lease:v1\n{bad json}\n-->'), null, 'corrupt JSON must not throw');
  assert.equal(parseRecord('<!-- opos-lease:v1\n{"no":"key"}\n-->'), null, 'a block without a key is not a lease');
  assert.equal(parseRecord('<!-- opos-lease:v1\n{"key":"x"}'), null, 'unterminated block is not a lease');
});

test('expiry is computed from the record, never from process time', () => {
  assert.equal(isExpired(rec(), T0), false);
  assert.equal(isExpired(rec(), Date.parse('2026-09-22T12:40:00.001Z')), true);
  assert.equal(isExpired(rec(), Date.parse('2026-09-22T12:40:00.000Z')), true, 'expiry is inclusive');
  assert.equal(isExpired(rec({ t: { expires: 'garbage' } }), T0), true, 'unparseable expiry is treated as expired, never as held');
});

test('live == held AND unexpired; terminal states are never live even before expiry', () => {
  assert.equal(isLive(rec(), T0), true);
  for (const state of ['released', 'yielded', 'expired', 'stolen']) {
    assert.equal(isLive(rec({ state }), T0), false, `${state} must not be live`);
  }
  assert.equal(isLive(rec(), Date.parse('2026-09-22T13:00:00Z')), false, 'held but past TTL is not live');
  assert.equal(isLive(null, T0), false);
});

test('a crashed holder is overtaken by expiry alone — reap is cosmetic, not load-bearing', () => {
  const dead = rec({ t: { ...rec().t, expires: '2026-09-22T11:59:59.000Z' } });
  assert.equal(dead.state, 'held', 'the corpse still claims to be held');
  assert.equal(isLive(dead, T0), false, 'and yet it must not block anyone, with no reaper having run');
});

test('sameHolder keys on clone_id + login, not on session', () => {
  const h = rec().holder;
  assert.equal(sameHolder(h, { ...h, session: 'different-session' }), true,
    'a restarted session in the same clone is the same holder — that is what lets it re-attach');
  assert.equal(sameHolder(h, { ...h, clone_id: 'c-other' }), false);
  assert.equal(sameHolder(h, { ...h, login: 'someone-else' }), false);
  assert.equal(sameHolder(h, null), false);
  assert.equal(sameHolder(null, h), false);
});

test('terminal records render their reason so a human can see what died and why', () => {
  const body = renderRecord(rec({ state: 'stolen', reason: 'clone silent for 40 minutes' }));
  assert.match(body, /STOLEN/);
  assert.match(body, /clone silent for 40 minutes/);
});

test('render output is deterministic — identical input must not produce a changing body', () => {
  const r = rec();
  assert.equal(renderRecord(r), renderRecord(r));
});

// ---- listClaims pagination: explicit repos/<owner>/<repo> page loop, never `gh api --paginate` ----

/** A stub gh serving `total` comments, 100 per page. Records every argv it was called with. */
function stubComments(total, { failOnPage = null } = {}) {
  const calls = [];
  const fn = (args) => {
    calls.push(args);
    const path = args[1];
    const page = Number(/[?&]page=(\d+)/.exec(path)?.[1] ?? 1);
    if (failOnPage === page) return { ok: false, out: '', err: 'HTTP 502' };
    const from = (page - 1) * 100;
    const n = Math.max(0, Math.min(100, total - from));
    const rows = [];
    for (let i = 0; i < n; i += 1) {
      const id = 1000 + from + i;
      const body = i % 2 === 0 ? renderRecord(rec({ key: `path:k${id}/**` })) : 'plain comment';
      rows.push(JSON.stringify({ id, login: 'octocat', created_at: 'c', updated_at: 'u', body }));
    }
    return { ok: true, out: rows.join('\n'), err: '' };
  };
  return { fn, calls };
}

const target = { repo: 'acme/company-os', issue: 7 };

test('listClaims never uses --paginate and never leaves the repos/<owner>/<repo> path form', () => {
  const { fn, calls } = stubComments(250);
  listClaims(target, { ghFn: fn });
  assert.equal(calls.length, 3, '250 comments = pages of 100,100,50');
  for (const a of calls) {
    assert.ok(!a.includes('--paginate'), 'gh --paginate follows repositories/<id>/ Link URLs that cloud proxies reject');
    assert.match(a[1], /^repos\/acme\/company-os\/issues\/7\/comments\?per_page=100&page=\d+$/);
    assert.doesNotMatch(a[1], /repositories\//);
  }
});

test('listClaims walks every page and stops at the first short page', () => {
  const { fn, calls } = stubComments(250);
  const r = listClaims(target, { ghFn: fn });
  assert.equal(r.ok, true);
  assert.equal(r.claims.length, 125, 'every second comment carries a lease record');
  assert.deepEqual(calls.map((a) => /&page=(\d+)/.exec(a[1])[1]), ['1', '2', '3']);
});

test('listClaims: exactly 100 comments needs one extra (empty) page to be sure', () => {
  const { fn, calls } = stubComments(100);
  const r = listClaims(target, { ghFn: fn });
  assert.equal(r.ok, true);
  assert.equal(calls.length, 2);
});

test('listClaims: a single short page costs a single call', () => {
  const { fn, calls } = stubComments(7);
  assert.equal(listClaims(target, { ghFn: fn }).claims.length, 4);
  assert.equal(calls.length, 1);
});

test('listClaims output is sorted by comment id ascending, whatever order pages arrive in', () => {
  const { fn } = stubComments(150);
  const ids = listClaims(target, { ghFn: fn }).claims.map((c) => c.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
  assert.deepEqual(Object.keys(listClaims(target, { ghFn: fn }).claims[0]).sort(),
    ['body', 'created_at', 'id', 'login', 'rec', 'updated_at']);
});

test('listClaims: a failure on ANY page is a failure, never a silently shortened list', () => {
  const { fn } = stubComments(250, { failOnPage: 2 });
  const r = listClaims(target, { ghFn: fn });
  assert.equal(r.ok, false);
  assert.deepEqual(r.claims, []);
  assert.match(r.err, /502/);
});

test('listClaims classifies a rate limit so the caller can back off', () => {
  const fn = () => ({ ok: false, out: '', err: 'You have exceeded a secondary rate limit' });
  assert.equal(listClaims(target, { ghFn: fn }).rateLimited, true);
});

// ---- listIssuesByLabel: REST replacement for `gh issue list` (GraphQL) ----

test('listIssuesByLabel uses REST, encodes the label, and drops pull requests', () => {
  const calls = [];
  const fn = (args) => {
    calls.push(args);
    return { ok: true, err: '', out: [
      JSON.stringify({ number: 5, title: 'a', body: 'x', pr: false }),
      JSON.stringify({ number: 6, title: 'a PR', body: '', pr: true }),
      JSON.stringify({ number: 7, title: 'b', body: 'y', pr: false }),
    ].join('\n') };
  };
  const r = listIssuesByLabel('acme/company-os', 'lease ledger', { limit: 100, ghFn: fn });
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.map((i) => i.number), [5, 7]);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'api');
  assert.match(calls[0][1], /^repos\/acme\/company-os\/issues\?labels=lease%20ledger&state=open&per_page=100&page=1$/);
  assert.ok(!calls[0].includes('issue') && !calls[0].includes('graphql'));
});

test('listIssuesByLabel honours the limit and surfaces failures', () => {
  const full = () => ({ ok: true, err: '', out: Array.from({ length: 20 }, (_, i) => JSON.stringify({ number: i + 1, title: 't', body: '', pr: false })).join('\n') });
  assert.equal(listIssuesByLabel('a/b', 'l', { limit: 5, ghFn: full }).data.length, 5);
  const bad = () => ({ ok: false, out: '', err: 'HTTP 403' });
  const r = listIssuesByLabel('a/b', 'l', { ghFn: bad });
  assert.equal(r.ok, false);
  assert.match(r.err, /403/);
});
