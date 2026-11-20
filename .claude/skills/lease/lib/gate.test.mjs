/** node --test .claude/skills/lease/lib/gate.test.mjs — offline, pure. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { postRenewVerdict, GATE_EXIT } from './gate.mjs';

const lease = (key, scope) => ({ key, scope });
const A = lease('path:docs/**', ['docs/**']);
const B = lease('path:notes/**', ['notes/**']);
const staged = ['docs/a.md', 'docs/b.md'];

test('renew OK and still held -> OK', () => {
  assert.deepEqual(postRenewVerdict({ staged, before: [A], after: [A], outcomes: { [A.key]: 0 } }), { ok: true, scope: ['docs/**'] });
});

test('stale yield of the covering lease -> STALE with the lost key', () => {
  const v = postRenewVerdict({ staged, before: [A], after: [], outcomes: { [A.key]: GATE_EXIT.STALE } });
  assert.equal(v.ok, false);
  assert.equal(v.code, GATE_EXIT.STALE);
  assert.deepEqual(v.lostKeys, ['path:docs/**']);
  assert.deepEqual(v.uncovered, staged);
});

test('revocation of the covering lease -> REVOKED', () => {
  const v = postRenewVerdict({ staged, before: [A], after: [], outcomes: { [A.key]: GATE_EXIT.REVOKED } });
  assert.equal(v.code, GATE_EXIT.REVOKED);
  assert.deepEqual(v.lostKeys, ['path:docs/**']);
});

test('yield of an unrelated lease while staged paths stay covered -> OK', () => {
  assert.deepEqual(postRenewVerdict({ staged, before: [A, B], after: [A], outcomes: { [B.key]: GATE_EXIT.STALE } }), { ok: true, scope: ['docs/**'] });
});

test('other renew error code but the lease is gone -> NO_LEASE', () => {
  const v = postRenewVerdict({ staged, before: [A], after: [], outcomes: { [A.key]: 6 } });
  assert.equal(v.code, GATE_EXIT.NO_LEASE);
});

test('renew threw (no outcomes) and the lease is gone -> NO_LEASE', () => {
  const v = postRenewVerdict({ staged, before: [A], after: [] });
  assert.equal(v.code, GATE_EXIT.NO_LEASE);
});

test('only the uncovered paths are reported when scope partly survives', () => {
  const v = postRenewVerdict({ staged: ['docs/a.md', 'notes/n.md'], before: [A, B], after: [A], outcomes: { [B.key]: GATE_EXIT.STALE } });
  assert.equal(v.ok, false);
  assert.deepEqual(v.uncovered, ['notes/n.md']);
  assert.deepEqual(v.lostKeys, ['path:notes/**']);
});

test('a lease absent from before is never counted, even if cached after the heartbeat', () => {
  const v = postRenewVerdict({ staged, before: [B], after: [A, B], outcomes: {} });
  assert.equal(v.ok, false);
  assert.deepEqual(v.uncovered, staged);
  assert.deepEqual(v.lostKeys, []);
});

test('code comes from the lost covering lease, not from an unrelated renew error', () => {
  const v = postRenewVerdict({ staged, before: [A, B], after: [B], outcomes: { [A.key]: GATE_EXIT.STALE, [B.key]: 6 } });
  assert.equal(v.code, GATE_EXIT.STALE);
  const w = postRenewVerdict({ staged, before: [A, B], after: [A], outcomes: { [A.key]: GATE_EXIT.STALE, [B.key]: GATE_EXIT.REVOKED } });
  assert.deepEqual(w, { ok: true, scope: ['docs/**'] });
});

test('several covering leases lost: revoked beats yielded beats the rest', () => {
  const A2 = lease('path:docs/a/**', ['docs/**']);
  const mix = (a, b) => postRenewVerdict({ staged, before: [A, A2], after: [], outcomes: { [A.key]: a, [A2.key]: b } }).code;
  assert.equal(mix(GATE_EXIT.STALE, GATE_EXIT.REVOKED), GATE_EXIT.REVOKED);
  assert.equal(mix(6, GATE_EXIT.STALE), GATE_EXIT.STALE);
  assert.equal(mix(6, 6), GATE_EXIT.NO_LEASE);
});

test('lostKeys omits lost leases that covered none of the uncovered paths', () => {
  const v = postRenewVerdict({ staged: ['docs/a.md'], before: [A, B], after: [], outcomes: { [A.key]: GATE_EXIT.STALE, [B.key]: GATE_EXIT.REVOKED } });
  assert.deepEqual(v.lostKeys, [A.key]);
  assert.equal(v.code, GATE_EXIT.STALE);
});

test('a kept key whose scope widened after the heartbeat does not cover the extra path', () => {
  const wide = lease(A.key, ['docs/**', 'notes/**']);
  const v = postRenewVerdict({ staged: ['docs/a.md', 'notes/n.md'], before: [A], after: [wide], outcomes: { [A.key]: 0 } });
  assert.equal(v.ok, false);
  assert.deepEqual(v.uncovered, ['notes/n.md']);
});

test('success returns the pre-heartbeat scope of kept leases only', () => {
  const wide = lease(A.key, ['docs/**', 'notes/**']);
  const v = postRenewVerdict({ staged: ['docs/a.md'], before: [A, B], after: [wide], outcomes: { [B.key]: GATE_EXIT.STALE } });
  assert.deepEqual(v, { ok: true, scope: ['docs/**'] });
});
