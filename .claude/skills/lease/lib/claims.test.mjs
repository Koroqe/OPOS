/** node --test .claude/skills/lease/lib/claims.test.mjs — offline: no gh, no network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderRecord, parseRecord, isLive, isExpired, sameHolder, MARKER } from './claims.mjs';

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
