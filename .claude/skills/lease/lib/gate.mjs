/**
 * gate.mjs — the pure decision behind `commit-gate`'s post-heartbeat re-check.
 *
 * The gate's heartbeat (`renew --all`) can yield a lease (clone fell behind) or find it
 * revoked, and removes the cached held file when it does. The scope computed BEFORE the
 * heartbeat is then stale: a commit authorized by it would rest on a lease already released.
 * This function re-derives coverage from the leases still held AFTER the heartbeat, and only
 * from leases that were already held BEFORE it: a heartbeat may shrink authorization, never grow it.
 *
 * Exit codes mirror lease.mjs EXIT (STALE 3, NO_LEASE 4, REVOKED 5); kept local so this
 * module needs nothing from lease.mjs and stays unit-testable (it imports only keys.mjs).
 */
import { matchesAny } from './keys.mjs';

export const GATE_EXIT = { OK: 0, STALE: 3, NO_LEASE: 4, REVOKED: 5 };

/**
 * @param {object} p
 * @param {string[]} p.staged        staged paths
 * @param {object[]} p.before        held records (with .key, .scope) before the heartbeat
 * @param {object[]} p.after         held records still cached and unexpired after it
 * @param {Object<string, number>} [p.outcomes]  renew's per-key result code, by lease key; absent when renew threw or did not run
 * @returns {{ok: true} | {ok: false, code: number, lostKeys: string[], uncovered: string[]}}
 *   code is the lost covering lease's own outcome: 5 if any was revoked, else 3 if any yielded, else 4.
 *   lostKeys are only the lost leases whose scope covered an uncovered staged path.
 */
export function postRenewVerdict({ staged, before, after, outcomes = {} }) {
  const beforeKeys = new Set(before.map((c) => c.key));
  const kept = after.filter((c) => beforeKeys.has(c.key));
  const scope = kept.flatMap((c) => c.scope ?? []);
  const uncovered = staged.filter((f) => !matchesAny(f, scope));
  if (!uncovered.length) return { ok: true };
  const keptKeys = new Set(kept.map((c) => c.key));
  const lost = before.filter((c) => !keptKeys.has(c.key) && uncovered.some((f) => matchesAny(f, c.scope ?? [])));
  const lostKeys = lost.map((c) => c.key);
  const codes = lost.map((c) => outcomes[c.key]);
  const code = codes.includes(GATE_EXIT.REVOKED) ? GATE_EXIT.REVOKED
    : codes.includes(GATE_EXIT.STALE) ? GATE_EXIT.STALE : GATE_EXIT.NO_LEASE;
  return { ok: false, code, lostKeys, uncovered };
}
