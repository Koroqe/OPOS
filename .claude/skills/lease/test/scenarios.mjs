#!/usr/bin/env node
/**
 * scenarios.mjs — the behavioural acceptance tests that the collision suite does not cover.
 *
 *   node .claude/skills/lease/test/scenarios.mjs [--only D,E,F,G,H] [--clone <path>]
 *
 *   D  stale-clone refusal + mid-run yield   (the 7-occurrence class)
 *   E  scope violation + staged-file guard   (the git-add-all class, #387)
 *   F  crash recovery with NO reaper         (expiry is authoritative)
 *   G  steal, and the half-TTL silence floor that stops a casual one
 *   H  cross-machine visibility              (the thing .current-task structurally cannot do)
 *
 * D and H need a SECOND clone. One is created automatically if the skill is already pushed;
 * otherwise they skip loudly rather than passing vacuously — a test that cannot run must never
 * read as a test that passed.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf('--' + n); return i === -1 ? d : (argv[i + 1] ?? true); };
const ONLY = String(flag('only', 'D,E,F,G,H')).split(',').map((s) => s.trim().toUpperCase());

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const LEASE = path.join(ROOT, '.claude', 'skills', 'lease', 'lease.mjs');
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'lease.config.json'), 'utf8'));
const REPO = CFG.ledger.repo;

const results = [];
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function lease(args, { cwd = ROOT, env = {}, enforce = 'on' } = {}) {
  const r = spawnSync(process.execPath, [cwd === ROOT ? LEASE : path.join(cwd, '.claude/skills/lease/lease.mjs'), ...args], {
    cwd, encoding: 'utf8',
    env: { ...process.env, OPOS_LEASE_ENFORCE: enforce, ...env },
  });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond, detail });
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? '\n        ' + detail : ''}`);
}

function cleanupKey(key) {
  lease(['release', '--key', key, '--reason', 'scenario cleanup'], { enforce: 'off' });
}

// Only ever clears keys this suite owns. An earlier version wiped the whole held/ directory
// and took a live, unrelated lease's cache with it: a test harness must not be able to disturb
// work it is not testing.
const TEST_KEY_PREFIXES = ['path:company/ops/', 'process:lease-scenario-'];
function clearCache(root = ROOT) {
  const d = path.join(root, '.claude', 'skills', 'lease', '.state', 'held');
  try {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      try {
        const k = JSON.parse(fs.readFileSync(p, 'utf8')).key ?? '';
        if (TEST_KEY_PREFIXES.some((x) => k.startsWith(x))) fs.rmSync(p, { force: true });
      } catch { /* skip */ }
    }
  } catch { /* fine */ }
}

/**
 * The oldest commit that still contains lease.mjs. Resetting a test clone further back than
 * this deletes the tool under test, and the run then measures "module not found" while
 * reporting it as a stale-clone refusal — a test that passes for the wrong reason is worse
 * than no test.
 */
function firstLeaseCommit(cwd) {
  const log = execFileSync('git', ['log', '--format=%H', '--reverse', '--', '.claude/skills/lease/lease.mjs'], { cwd, encoding: 'utf8' }).trim();
  return log.split('\n').filter(Boolean)[0] ?? null;
}

/** Clear a key regardless of who holds it, so one scenario cannot poison the next. */
function forceFree(key) {
  const held = lease(['list', '--key', key, '--json'], { enforce: 'off' });
  let live = [];
  try { live = JSON.parse(held.out); } catch { /* none */ }
  if (!live.length) return;
  lease(['steal', '--key', key, '--reason', 'scenario cleanup', '--force'], { enforce: 'off' });
}

// ---------------------------------------------------------------- second clone

let CLONE = flag('clone', null);
let cloneMade = false;
function ensureClone() {
  if (CLONE) return CLONE;
  const url = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: ROOT, encoding: 'utf8' }).trim();
  const dir = path.join(os.tmpdir(), 'opos-lease-clone-' + Date.now().toString(36));
  console.log(`  (cloning ${url} -> ${dir})`);
  const r = spawnSync('git', ['clone', '--quiet', url, dir], { encoding: 'utf8' });
  if (r.status !== 0) return null;
  if (!fs.existsSync(path.join(dir, '.claude/skills/lease/lease.mjs'))) {
    console.log('  (clone has no lease skill — push it first)');
    fs.rmSync(dir, { recursive: true, force: true });
    return null;
  }
  CLONE = dir; cloneMade = true;
  return dir;
}

// ---------------------------------------------------------------- D

if (ONLY.includes('D')) {
  console.log('\nD — stale clone is refused before work starts, and yields if it falls behind mid-run');
  const c = ensureClone();
  if (!c) {
    check('D skipped — no second clone available (push the skill, then re-run)', false, 'SKIPPED, not passed');
  } else {
    const base = firstLeaseCommit(c);
    if (!base) { check('D skipped — cannot locate a skill-bearing commit', false, 'SKIPPED'); throw new Error('no base');  }
    execFileSync('git', ['reset', '--hard', '--quiet', base], { cwd: c });
    const behind = execFileSync('git', ['rev-list', '--count', 'HEAD..origin/main'], { cwd: c, encoding: 'utf8' }).trim();
    check('the test clone is genuinely behind but still has the tool', Number(behind) > 0, 'behind=' + behind);
    const r1 = lease(['acquire', '--key', 'path:company/ops/**', '--scope', 'company/ops/**', '--intent', 'stale test'], { cwd: c });
    check('acquire from a behind clone exits 3', r1.code === 3, `exit=${r1.code} ${r1.err.split('\n')[0]}`);
    check('the refusal names the behind-count', r1.err.includes(behind), r1.err.split('\n')[0]);
    check('the refusal prescribes git pull --ff-only', /git pull --ff-only/.test(r1.err), r1.err.split('\n')[1] ?? '');

    execFileSync('git', ['pull', '--quiet', '--ff-only'], { cwd: c });
    const r2 = lease(['acquire', '--key', 'path:company/ops/**', '--scope', 'company/ops/**', '--intent', 'stale test after pull'], { cwd: c });
    check('after git pull --ff-only the same acquire exits 0', r2.code === 0, `exit=${r2.code} ${r2.err.split('\n')[0]}`);

    if (r2.code === 0) {
      execFileSync('git', ['reset', '--hard', '--quiet', base], { cwd: c });
      const r3 = lease(['renew', '--key', 'path:company/ops/**'], { cwd: c });
      check('renew from a clone that fell behind MID-RUN yields (exit 3)', r3.code === 3, `exit=${r3.code} ${r3.err.split('\n')[0]}`);
      check('the yield says so rather than continuing silently', /STALE MID-RUN|yield/i.test(r3.err), r3.err.split('\n')[0]);
    }
    forceFree('path:company/ops/**');
    // Leave the clone at origin/main so the next scenario starts from a sane tree.
    try { execFileSync('git', ['pull', '--quiet', '--ff-only'], { cwd: c }); } catch { /* best effort */ }
  }
}

// ---------------------------------------------------------------- E

if (ONLY.includes('E')) {
  console.log('\nE — commit-gate refuses staged paths outside the lease scope');
  clearCache();
  forceFree('path:company/ops/drafts/**');
  const probe = path.join(ROOT, 'company', 'ops', 'drafts', '.lease-scenario-probe.md');
  const outsideRel = 'company/knowledge-base/.lease-scenario-outside.md';
  const outside = path.join(ROOT, outsideRel);
  fs.mkdirSync(path.dirname(probe), { recursive: true });
  fs.writeFileSync(probe, 'scenario probe\n');
  fs.writeFileSync(outside, 'scenario probe — deliberately outside scope\n');

  const acq = lease(['acquire', '--key', 'path:company/ops/drafts/**', '--scope', 'company/ops/drafts/**',
    '--intent', 'scenario E', '--ttl', '5m', '--force-dirty']);
  check('acquired a scoped path lease', acq.code === 0, `exit=${acq.code} ${acq.err.split('\n')[0]}`);

  execFileSync('git', ['add', '-f', 'company/ops/drafts/.lease-scenario-probe.md'], { cwd: ROOT });
  const g1 = lease(['commit-gate', '--no-renew']);
  check('in-scope staging passes the gate', g1.code === 0, `exit=${g1.code} ${g1.err.split('\n')[0]}`);

  execFileSync('git', ['add', '-f', outsideRel], { cwd: ROOT });
  const g2 = lease(['commit-gate', '--no-renew']);
  check('out-of-scope staging exits 7', g2.code === 7, `exit=${g2.code} ${g2.err.split('\n')[0]}`);
  check('the refusal names the offending file', g2.err.includes(outsideRel), g2.err);

  const g3 = lease(['commit-gate', '--no-renew'], { enforce: 'warn' });
  check('the same violation under enforce=warn exits 0 but is recorded', g3.code === 0 && /would have exited 7/.test(g3.err), `exit=${g3.code}`);

  execFileSync('git', ['restore', '--staged', 'company/ops/drafts/.lease-scenario-probe.md', outsideRel], { cwd: ROOT });
  fs.rmSync(probe, { force: true });
  fs.rmSync(outside, { force: true });
  cleanupKey('path:company/ops/drafts/**');
  forceFree('path:company/ops/drafts/**');
}

// ---------------------------------------------------------------- F

if (ONLY.includes('F')) {
  console.log('\nF — a crashed holder is overtaken by EXPIRY alone, with no reaper run');
  const KEY = 'process:lease-scenario-crash';
  clearCache();
  const a = lease(['acquire', '--key', KEY, '--ttl', '20s', '--intent', 'crash test'], { env: { OPOS_CLONE_ID: 'clone-crash', OPOS_SESSION_ID: 'crash' } });
  check('holder acquired with a 20s TTL', a.code === 0, `exit=${a.code} ${a.err.split('\n')[0]}`);

  const immediate = lease(['acquire', '--key', KEY, '--ttl', '1m', '--intent', 'should be refused'], { env: { OPOS_CLONE_ID: 'clone-other', OPOS_SESSION_ID: 'other' } });
  check('a second identity is refused while the lease is live', immediate.code === 2, `exit=${immediate.code}`);

  // Simulate the crash: drop the local cache, never release, never reap.
  clearCache();
  console.log('  (waiting 25s for the TTL to lapse — no reaper is run)');
  sleep(25000);

  const after = lease(['acquire', '--key', KEY, '--ttl', '2m', '--intent', 'took over the corpse'], { env: { OPOS_CLONE_ID: 'clone-other', OPOS_SESSION_ID: 'other' } });
  check('after expiry the second identity acquires cleanly, reap never having run', after.code === 0, `exit=${after.code} ${after.err.split('\n')[0]}`);

  const dry = lease(['reap', '--dry', '--grace', '0s']);
  check('reap --dry would tidy the record (cosmetic, not load-bearing)', dry.code === 0, `exit=${dry.code}`);
  lease(['release', '--key', KEY, '--reason', 'scenario cleanup'], { env: { OPOS_CLONE_ID: 'clone-other', OPOS_SESSION_ID: 'other' }, enforce: 'off' });
}

// ---------------------------------------------------------------- G

if (ONLY.includes('G')) {
  console.log('\nG — steal is refused below the half-TTL silence floor, and legible when it happens');
  const KEY = 'process:lease-scenario-steal';
  clearCache();
  const a = lease(['acquire', '--key', KEY, '--ttl', '10m', '--intent', 'victim'], { env: { OPOS_CLONE_ID: 'clone-victim', OPOS_SESSION_ID: 'victim' } });
  check('victim holds the lease', a.code === 0, `exit=${a.code} ${a.err.split('\n')[0]}`);

  const early = lease(['steal', '--key', KEY, '--reason', 'impatience'], { env: { OPOS_CLONE_ID: 'clone-thief', OPOS_SESSION_ID: 'thief' } });
  check('an early steal is refused (exit 2) with the floor explained', early.code === 2 && /floor|half the TTL/i.test(early.err), `exit=${early.code} ${early.err.split('\n')[0]}`);

  const noReason = lease(['steal', '--key', KEY], { env: { OPOS_CLONE_ID: 'clone-thief' } });
  check('steal without --reason is refused outright', noReason.code === 1, `exit=${noReason.code}`);

  // The victim is deliberately still LIVE here (10m TTL): this is the case the floor is for,
  // and the case the old 2xTTL floor could never reach. --force stands in for the human
  // decision that the holder is gone, which is what Confirm tier means in practice.
  const ok = lease(['steal', '--key', KEY, '--reason', 'clone is not responding', '--force'], { env: { OPOS_CLONE_ID: 'clone-thief', OPOS_SESSION_ID: 'thief' } });
  check('a forced steal of a LIVE lease succeeds', ok.code === 0, `exit=${ok.code} ${ok.err.split('\n')[0]}`);

  const victimRenew = lease(['renew', '--key', KEY], { env: { OPOS_CLONE_ID: 'clone-victim', OPOS_SESSION_ID: 'victim' } });
  check('the victim’s next renew reports REVOKED (exit 5) — stop writing', victimRenew.code === 5, `exit=${victimRenew.code} ${victimRenew.err.split('\n')[0]}`);

  const audit = lease(['audit', '--json']);
  check('the steal is visible to audit/projection', audit.code === 0, `exit=${audit.code}`);
}

// ---------------------------------------------------------------- H

if (ONLY.includes('H')) {
  console.log('\nH — cross-machine visibility: the thing .current-task structurally cannot do');
  const c = ensureClone();
  const KEY = 'process:lease-scenario-crossmachine';
  if (!c) {
    check('H skipped — no second clone available (push the skill, then re-run)', false, 'SKIPPED, not passed');
  } else {
    clearCache(); clearCache(c);
    const a = lease(['acquire', '--key', KEY, '--ttl', '3m', '--intent', 'held on machine A']);
    check('machine A holds the lease', a.code === 0, `exit=${a.code} ${a.err.split('\n')[0]}`);

    const bCheck = lease(['check', '--key', KEY], { cwd: c });
    check('machine B check exits 4 (no lease of its own)', bCheck.code === 4, `exit=${bCheck.code} ${bCheck.err.split('\n')[0]}`);

    const bAcquire = lease(['acquire', '--key', KEY, '--ttl', '1m', '--intent', 'B tries'], { cwd: c });
    check('machine B acquire exits 2 (A holds it)', bAcquire.code === 2, `exit=${bAcquire.code}`);
    check('B is told WHO holds it and why', /DESKTOP|clone c-|intent|«/.test(bAcquire.err), bAcquire.err.split('\n')[1] ?? bAcquire.err);

    const bList = lease(['list', '--key', KEY, '--json'], { cwd: c });
    let sawHost = false;
    try { sawHost = JSON.parse(bList.out).some((x) => x.holder?.host && x.intent === 'held on machine A'); } catch { /* fall through */ }
    check('machine B can enumerate A’s lease with host + intent', sawHost, bList.out.slice(0, 200));

    cleanupKey(KEY);
  }
}

if (cloneMade && CLONE) { try { fs.rmSync(CLONE, { recursive: true, force: true }); } catch { /* windows lock */ } }

const pass = results.filter((r) => r.pass).length;
console.log(`\n${pass}/${results.length} checks passed`);
process.exit(pass === results.length ? 0 : 1);
