/** node --test .claude/skills/lease/lib/gate.test.mjs — offline, pure. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { postRenewVerdict, GATE_EXIT } from './gate.mjs';

const lease = (key, scope) => ({ key, scope });
const A = lease('path:docs/**', ['docs/**']);
const B = lease('path:notes/**', ['notes/**']);
const staged = ['docs/a.md', 'docs/b.md'];

test('renew OK and still held -> OK', () => {
  assert.deepEqual(postRenewVerdict({ staged, before: [A], after: [A], renewCode: 0 }), { ok: true });
});

test('stale yield of the covering lease -> STALE with the lost key', () => {
  const v = postRenewVerdict({ staged, before: [A], after: [], renewCode: GATE_EXIT.STALE });
  assert.equal(v.ok, false);
  assert.equal(v.code, GATE_EXIT.STALE);
  assert.deepEqual(v.lostKeys, ['path:docs/**']);
  assert.deepEqual(v.uncovered, staged);
});

test('revocation of the covering lease -> REVOKED', () => {
  const v = postRenewVerdict({ staged, before: [A], after: [], renewCode: GATE_EXIT.REVOKED });
  assert.equal(v.code, GATE_EXIT.REVOKED);
  assert.deepEqual(v.lostKeys, ['path:docs/**']);
});

test('yield of an unrelated lease while staged paths stay covered -> OK', () => {
  assert.deepEqual(postRenewVerdict({ staged, before: [A, B], after: [A], renewCode: GATE_EXIT.STALE }), { ok: true });
});

test('other renew error code but the lease is gone -> NO_LEASE', () => {
  const v = postRenewVerdict({ staged, before: [A], after: [], renewCode: 6 });
  assert.equal(v.code, GATE_EXIT.NO_LEASE);
});

test('renew threw (null code) and the lease is gone -> NO_LEASE', () => {
  const v = postRenewVerdict({ staged, before: [A], after: [], renewCode: null });
  assert.equal(v.code, GATE_EXIT.NO_LEASE);
});

test('only the uncovered paths are reported when scope partly survives', () => {
  const v = postRenewVerdict({ staged: ['docs/a.md', 'notes/n.md'], before: [A, B], after: [A], renewCode: GATE_EXIT.STALE });
  assert.equal(v.ok, false);
  assert.deepEqual(v.uncovered, ['notes/n.md']);
  assert.deepEqual(v.lostKeys, ['path:notes/**']);
});
