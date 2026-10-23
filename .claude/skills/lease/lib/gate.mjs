/**
 * gate.mjs — the pure decision behind `commit-gate`'s post-heartbeat re-check.
 *
 * The gate's heartbeat (`renew --all`) can yield a lease (clone fell behind) or find it
 * revoked, and removes the cached held file when it does. The scope computed BEFORE the
 * heartbeat is then stale: a commit authorized by it would rest on a lease already released.
 * This function re-derives coverage from the leases still held AFTER the heartbeat.
 *
 * Exit codes mirror lease.mjs EXIT (STALE 3, NO_LEASE 4, REVOKED 5); kept local so this
 * module stays import-free and unit-testable.
 */
import { matchesAny } from './keys.mjs';

export const GATE_EXIT = { OK: 0, STALE: 3, NO_LEASE: 4, REVOKED: 5 };

/**
 * @param {object} p
 * @param {string[]} p.staged        staged paths
 * @param {object[]} p.before        held records (with .key, .scope) before the heartbeat
 * @param {object[]} p.after         held records still cached and unexpired after it
 * @param {number|null} p.renewCode  the heartbeat's return code; null when it threw or did not run
 * @returns {{ok: true} | {ok: false, code: number, lostKeys: string[], uncovered: string[]}}
 */
export function postRenewVerdict({ staged, before, after, renewCode }) {
  const scope = after.flatMap((c) => c.scope ?? []);
  const uncovered = staged.filter((f) => !matchesAny(f, scope));
  if (!uncovered.length) return { ok: true };
  const afterKeys = new Set(after.map((c) => c.key));
  const lostKeys = before.map((c) => c.key).filter((k) => !afterKeys.has(k));
  const code = renewCode === GATE_EXIT.STALE || renewCode === GATE_EXIT.REVOKED ? renewCode : GATE_EXIT.NO_LEASE;
  return { ok: false, code, lostKeys, uncovered };
}
