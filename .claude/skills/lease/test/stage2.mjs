#!/usr/bin/env node
/**
 * stage2.mjs — acceptance tests for the v0.17.0 wiring and the registry features.
 *
 *   node .claude/skills/lease/test/stage2.mjs [--only N,O,R,C,L,W,A] [--clone <path>]
 *
 *   N  not configured → exit 9 everywhere, so a company that never opted in is unaffected
 *   O  offline: --offline-ok opens a gate only for an unexpired cached lease; writes refuse
 *   R  rotation: a live lease survives the registry being rotated under it
 *   C  a registry closed by hand stops every command instead of being silently used
 *   L  the task lifecycle, as the skills now run it, across TWO clones
 *   W  the task gate under enforce=warn: acquire still refuses a second session
 *   A  the scheduled-run guards (process: and path:** leases)
 *
 * Runs against real GitHub on the repo in .claude/lease.config.json. Creates and removes its
 * own throwaway issues and a throwaway registry label; never touches the real registry's
 * existing records. L and A need a second clone and so need this skill already pushed; they
 * SKIP LOUDLY otherwise — a test that cannot run must never read as a test that passed.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const argv = process.argv.slice(2);
const flag = (n, d = null) => { const i = argv.indexOf('--' + n); return i === -1 ? d : (argv[i + 1] ?? true); };
const ONLY = String(flag('only', 'N,O,R,C,L,W,A')).split(',').map((x) => x.trim().toUpperCase());

const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const LEASE_REL = path.join('.claude', 'skills', 'lease', 'lease.mjs');
const STATE_REL = path.join('shared', 'scripts', 'task-state.mjs');
const REAL_CFG_PATH = path.join(ROOT, '.claude', 'lease.config.json');
const REAL_CFG = JSON.parse(fs.readFileSync(REAL_CFG_PATH, 'utf8'));
const REPO = REAL_CFG.ledger.repo
  ?? JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'task-tracking.config.json'), 'utf8')).repo;

const results = [];
const cleanups = [];
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const tmp = (name) => path.join(os.tmpdir(), `opos-stage2-${name}-${Date.now().toString(36)}`);

function run(file, args, { cwd = ROOT, env = {}, input } = {}) {
  const r = spawnSync(file, args, { cwd, encoding: 'utf8', input, env: { ...process.env, ...env } });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}
function lease(args, { cwd = ROOT, env = {}, enforce = 'on' } = {}) {
  return run(process.execPath, [path.join(cwd, LEASE_REL), ...args], { cwd, env: { OPOS_LEASE_ENFORCE: enforce, ...env } });
}
function state(args, { cwd = ROOT, input } = {}) {
  return run(process.execPath, [path.join(cwd, STATE_REL), ...args], { cwd, input });
}
const gh = (args, opts) => run('gh', args, opts);
const ghOut = (args) => { const r = gh(args); return r.code === 0 ? r.out.trim() : null; };

function check(name, cond, detail = '') {
  results.push({ name, pass: !!cond });
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${!cond && detail ? '\n        ' + String(detail).split('\n')[0] : ''}`);
}

function writeTempConfig(overrides) {
  const p = tmp('cfg') + '.json';
  const cfg = JSON.parse(JSON.stringify(REAL_CFG));
  Object.assign(cfg, overrides.top ?? {});
  cfg.ledger = { ...cfg.ledger, ...(overrides.ledger ?? {}) };
  fs.writeFileSync(p, JSON.stringify(cfg, null, 2));
  cleanups.push(() => fs.rmSync(p, { force: true }));
  return p;
}

function newIssue(title, body) {
  const url = ghOut(['issue', 'create', '--repo', REPO, '--title', title, '--body', body]);
  const n = Number(path.basename(url ?? ''));
  if (n) cleanups.push(() => gh(['issue', 'close', String(n), '--repo', REPO, '--reason', 'completed', '--comment', 'Lease stage-2 test finished; closed by the script.']));
  return n;
}

let CLONE = flag('clone', null);
function ensureClone() {
  if (CLONE) return CLONE;
  const url = ghOut(['repo', 'view', REPO, '--json', 'url', '--jq', '.url']);
  const dir = tmp('clone');
  if (run('git', ['clone', '--quiet', url + '.git', dir]).code !== 0) return null;
  if (!fs.existsSync(path.join(dir, LEASE_REL)) || !fs.existsSync(path.join(dir, STATE_REL))) {
    console.log('  (second clone lacks the skill or task-state.mjs — push first)');
    return null;
  }
  CLONE = dir;
  cleanups.push(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* windows lock */ } });
  return dir;
}

// ============================================================ N — not configured
if (ONLY.includes('N')) {
  console.log('\nN — a company that never opted in gets exit 9 everywhere, never a block');
  const cfg = writeTempConfig({ ledger: { issue: null } });
  const env = { OPOS_LEASE_CONFIG: cfg };
  for (const cmd of [['acquire', '--key', 'process:stage2-n'], ['check', '--key', 'process:stage2-n'], ['commit-gate'], ['renew', '--all'], ['list']]) {
    const r = lease(cmd, { env });
    check(`${cmd[0]} exits 9 when not configured`, r.code === 9, `exit=${r.code} ${r.err}`);
  }
  const missing = lease(['acquire', '--key', 'process:stage2-n'], { env: { OPOS_LEASE_CONFIG: tmp('absent') + '.json' } });
  check('a missing config file is also exit 9, not an error', missing.code === 9, `exit=${missing.code}`);
}

// ============================================================ O — offline
if (ONLY.includes('O')) {
  console.log('\nO — --offline-ok opens a gate only for an unexpired cached lease');
  const KEY = 'process:stage2-offline';
  const a = lease(['acquire', '--key', KEY, '--ttl', '5m', '--intent', 'offline test']);
  check('lease taken while online', a.code === 0, a.err);
  // Deliberately NOT shaped like a real token: the framework's redaction lint rejects anything
  // matching gh[pousr]_ + 36 characters, and a test should not ship something that looks like a leak.
  const BAD = { GH_TOKEN: 'offline-test-not-a-real-token' };

  for (const coldCache of [false, true]) {
    if (coldCache) fs.rmSync(path.join(ROOT, '.claude', 'skills', 'lease', '.state', 'ledger.json'), { force: true });
    const tag = coldCache ? '(registry cache cold)' : '(registry cache warm)';
    const on = lease(['check', '--key', KEY, '--offline-ok'], { env: BAD });
    check(`check --offline-ok with GitHub unreachable exits 0 ${tag}`, on.code === 0, `exit=${on.code} ${on.err}`);
    check(`...and says loudly that it is offline ${tag}`, /OFFLINE/.test(on.err), on.err);
    const off = lease(['check', '--key', KEY], { env: BAD });
    check(`check WITHOUT --offline-ok fails closed (exit 6) ${tag}`, off.code === 6, `exit=${off.code}`);
  }
  const w = lease(['acquire', '--key', 'process:stage2-offline-2', '--offline-ok'], { env: BAD });
  check('acquire --offline-ok still refuses: nothing that writes a claim works offline', w.code === 6, `exit=${w.code}`);
  const none = lease(['check', '--key', 'process:stage2-never-held', '--offline-ok'], { env: BAD });
  check('offline check of a key never held stays closed (exit 4)', none.code === 4, `exit=${none.code}`);
  lease(['release', '--key', KEY, '--reason', 'test cleanup'], { enforce: 'off' });
}

// ============================================================ R + C — rotation and closed registry
let testLabel = null;
if (ONLY.includes('R') || ONLY.includes('C')) {
  testLabel = 'lease-ledger-test-' + Date.now().toString(36);
  cleanups.push(() => gh(['label', 'delete', testLabel, '--repo', REPO, '--yes']));
}
if (ONLY.includes('R')) {
  console.log('\nR — rotation: a live lease survives the registry being rotated under it');
  const cfg = writeTempConfig({ top: { ledger_label: testLabel }, ledger: { issue: null } });
  const env = { OPOS_LEASE_CONFIG: cfg };
  const init = lease(['init-ledger', '--create'], { env });
  const t1 = JSON.parse(fs.readFileSync(cfg, 'utf8')).ledger.issue;
  check('a throwaway registry was created', init.code === 0 && t1, init.err);
  if (t1) cleanups.push(() => gh(['issue', 'close', String(t1), '--repo', REPO]));

  const KEY = 'process:stage2-rotation';
  const a = lease(['acquire', '--key', KEY, '--ttl', '10m', '--intent', 'held across a rotation'], { env });
  check('lease taken on the original registry', a.code === 0, a.err);

  const r = lease(['reap', '--rotate-now'], { env });
  let actions = [];
  try { actions = JSON.parse(r.out).actions; } catch { /* fall through */ }
  const rotated = actions.find((x) => x.what === 'rotated');
  check('reap --rotate-now rotated the registry', !!rotated, r.out + r.err);
  const t2 = rotated?.to;
  if (t2) cleanups.push(() => gh(['issue', 'close', String(t2), '--repo', REPO]));

  const old = JSON.parse(ghOut(['api', `repos/${REPO}/issues/${t1}`, '--jq', '{state: .state, body: .body}']) ?? '{}');
  const neu = JSON.parse(ghOut(['api', `repos/${REPO}/issues/${t2}`, '--jq', '{state: .state, body: .body}']) ?? '{}');
  check('the old registry is closed and points at the new one', old.state === 'closed' && new RegExp(`opos-lease-ledger-next:\\s*${t2}`).test(old.body ?? ''), old.state);
  check('the new registry is open and points back at the old one', neu.state === 'open' && new RegExp(`opos-lease-ledger-prev:\\s*${t1}`).test(neu.body ?? ''), neu.state);
  check('the local config now records the new registry', JSON.parse(fs.readFileSync(cfg, 'utf8')).ledger.issue === t2);

  const seen = lease(['list', '--key', KEY, '--json'], { env });
  let live = [];
  try { live = JSON.parse(seen.out); } catch { /* fall through */ }
  check('the pre-rotation lease is still visible (through the predecessor link)', live.length === 1, seen.out + seen.err);
  check('...and its holder can still renew it', lease(['renew', '--key', KEY], { env }).code === 0);
  const other = lease(['acquire', '--key', KEY, '--ttl', '2m'], { env: { ...env, OPOS_CLONE_ID: 'clone-rot-other', OPOS_SESSION_ID: 'rot-other' } });
  check('...and it still excludes a second holder (exit 2)', other.code === 2, `exit=${other.code}`);

  const fresh = lease(['acquire', '--key', 'process:stage2-after-rotation', '--ttl', '2m', '--json'], { env });
  let url = '';
  try { url = JSON.parse(fresh.out).url ?? ''; } catch { /* fall through */ }
  check('a new claim lands on the NEW registry', fresh.code === 0 && url.includes(`/issues/${t2}`), url || fresh.err);

  // follow the pointer from a config that still names the old registry
  const stale = writeTempConfig({ top: { ledger_label: testLabel }, ledger: { issue: t1 } });
  const follow = lease(['list', '--key', KEY, '--json'], { env: { OPOS_LEASE_CONFIG: stale } });
  check('a config still naming the old registry follows the rotation pointer', follow.code === 0 && /rotated/.test(follow.err), `exit=${follow.code} ${follow.err}`);

  lease(['release', '--key', KEY, '--reason', 'test cleanup'], { env, enforce: 'off' });
  lease(['release', '--key', 'process:stage2-after-rotation', '--reason', 'test cleanup'], { env, enforce: 'off' });
  fs.rmSync(path.join(ROOT, '.claude', 'skills', 'lease', '.state', 'ledger.json'), { force: true });
}

if (ONLY.includes('C')) {
  console.log('\nC — a registry closed by hand stops every command');
  const cfg = writeTempConfig({ top: { ledger_label: testLabel }, ledger: { issue: null } });
  const env = { OPOS_LEASE_CONFIG: cfg };
  lease(['init-ledger', '--create', '--force'], { env });
  const t = JSON.parse(fs.readFileSync(cfg, 'utf8')).ledger.issue;
  if (t) cleanups.push(() => gh(['issue', 'close', String(t), '--repo', REPO]));
  gh(['issue', 'close', String(t), '--repo', REPO]);
  fs.rmSync(path.join(ROOT, '.claude', 'skills', 'lease', '.state', 'ledger.json'), { force: true });
  const r = lease(['acquire', '--key', 'process:stage2-closed'], { env });
  check('acquire against a registry closed by hand exits 1', r.code === 1, `exit=${r.code} ${r.err}`);
  check('...and names the repair', /closed by hand/.test(r.err) && /init-ledger/.test(r.err), r.err);
  fs.rmSync(path.join(ROOT, '.claude', 'skills', 'lease', '.state', 'ledger.json'), { force: true });
}

// ============================================================ L — lifecycle across two clones
if (ONLY.includes('L')) {
  console.log('\nL — the task lifecycle as the skills now run it, across TWO clones');
  const B = ensureClone();
  if (!B) check('L skipped — no second clone (push first)', false, 'SKIPPED, not passed');
  else {
    const N = newIssue('[lease-test] DO NOT TOUCH — lifecycle test', 'Throwaway issue for the lease lifecycle test.\n\n## Status\n\n**Status:** open\n');
    const KEY = `issue:${REPO}#${N}`;
    const labels = () => JSON.parse(ghOut(['issue', 'view', String(N), '--repo', REPO, '--json', 'labels']) ?? '{"labels":[]}').labels.map((l) => l.name);
    const idx = REAL_CFG.index_label ?? 'leased';

    // register (A)
    const reg = lease(['acquire', '--key', KEY, '--intent', 'lifecycle test']);
    check('register: A takes the lease on the new issue', reg.code === 0, reg.err);
    check('register: the index label is on the issue', labels().includes(idx), labels().join(','));
    state(['add-active', '--issue', String(N)]);

    // the other machine cannot touch it
    check('B cannot take the task while A holds it (exit 2)', lease(['acquire', '--key', KEY, '--ttl', '2m'], { cwd: B }).code === 2);
    check('B fails the task-update gate (exit 4)', lease(['check', '--key', KEY], { cwd: B }).code === 4);

    // update (A)
    check('update: A passes the gate', lease(['check', '--key', KEY]).code === 0);
    gh(['issue', 'comment', String(N), '--repo', REPO, '--body', 'progress (lifecycle test)']);
    check('update: A renews after posting', lease(['renew', '--key', KEY, '--quiet']).code === 0);
    const body = ghOut(['issue', 'view', String(N), '--repo', REPO, '--json', 'body', '--jq', '.body']);
    const patched = state(['patch-status', '--status', 'in_progress'], { input: body });
    check('update: the status line patches', patched.code === 0 && /\*\*Status:\*\* in_progress/.test(patched.out));
    gh(['issue', 'edit', String(N), '--repo', REPO, '--body-file', '-'], { input: patched.out });

    // pause (A)
    check('pause: A yields the lease', lease(['release', '--key', KEY, '--state', 'yielded', '--reason', 'paused']).code === 0);
    gh(['issue', 'edit', String(N), '--repo', REPO, '--add-label', 'paused']);
    state(['add-paused', '--issue', String(N)]);
    state(['remove-active', '--issue', String(N)]);
    sleep(1500);
    const lp = labels();
    check('pause: the index label is gone and `paused` is set', !lp.includes(idx) && lp.includes('paused'), lp.join(','));

    // resume on the OTHER machine (B) — possible now, because A yielded
    check('resume on B: B takes the lease A yielded', lease(['acquire', '--key', KEY, '--intent', 'resumed on B'], { cwd: B }).code === 0);
    gh(['issue', 'edit', String(N), '--repo', REPO, '--remove-label', 'paused']);
    const back = lease(['acquire', '--key', KEY, '--intent', 'resume on A'], {});
    check('resume on A now refuses (exit 2) and names B', back.code === 2 && /held by/.test(back.err), back.err);

    // complete (B)
    check('complete: B passes the gate', lease(['check', '--key', KEY], { cwd: B }).code === 0);
    gh(['issue', 'close', String(N), '--repo', REPO, '--reason', 'completed']);
    check('complete: B releases', lease(['release', '--key', KEY, '--reason', 'completed'], { cwd: B }).code === 0);
    sleep(1500);
    check('complete: the index label is gone', !labels().includes(idx), labels().join(','));
    const late = lease(['check', '--key', KEY]);
    check('A, which no longer holds it, fails the gate (exit 4 or 5)', late.code === 4 || late.code === 5, `exit=${late.code}`);
    state(['remove-paused', '--issue', String(N)]);
  }
}

// ============================================================ W — the task gate under enforce=warn
if (ONLY.includes('W')) {
  console.log('\nW — under enforce=warn the task gate (acquire) still refuses a second session and still leaves the claim');
  const B = ensureClone();
  if (!B) check('W skipped — no second clone (push first)', false, 'SKIPPED, not passed');
  else {
    const N = newIssue('[lease-test] DO NOT TOUCH — warn-mode gate test', 'An existing task nobody has leased yet.\n\n## Status\n\n**Status:** open\n');
    const KEY = `issue:${REPO}#${N}`;
    const claims = () => (ghOut(['api', `repos/${REPO}/issues/${N}/comments`, '--jq', '[.[] | select(.body | contains("opos-lease:v1"))] | length']) ?? '0').trim();

    const first = lease(['acquire', '--key', KEY, '--intent', 'working on an existing task'], { enforce: 'warn' });
    check('an existing, unleased task: the gate takes the lease (exit 0)', first.code === 0, first.err);
    check('...and the claim comment is now on the issue, visible to everyone', claims() === '1', `claims=${claims()}`);

    const again = lease(['acquire', '--key', KEY, '--intent', 'second update, same session'], { enforce: 'warn' });
    check('the holder passing the gate again is a no-op (exit 0, no second claim)', again.code === 0 && claims() === '1', `exit=${again.code} claims=${claims()}`);

    const other = lease(['acquire', '--key', KEY, '--intent', 'another session'], { cwd: B, enforce: 'warn' });
    check('a second session is refused (exit 2) even though enforcement is only warn', other.code === 2, `exit=${other.code}`);
    check('...and is told who holds it', /held by/.test(other.err), other.err);

    const rel = lease(['release', '--key', KEY, '--reason', 'completed'], { enforce: 'warn' });
    const body = ghOut(['api', `repos/${REPO}/issues/${N}/comments`, '--jq', '[.[] | select(.body | contains("opos-lease:v1"))][0].body']) ?? '';
    check('release leaves the 🔓 record on the issue', rel.code === 0 && /RELEASED/.test(body), body.split('\n')[0]);
  }
}

// ============================================================ A — scheduled-run guards
if (ONLY.includes('A')) {
  console.log('\nA — scheduled runs: process: serialises schedulers, path:** yields to live editors');
  const B = ensureClone();
  if (!B) check('A skipped — no second clone (push first)', false, 'SKIPPED, not passed');
  else {
    check('B holds process:auto-sync', lease(['acquire', '--key', 'process:auto-sync', '--ttl', '3m', '--intent', 'test run'], { cwd: B }).code === 0);
    check('a second scheduler (A) is refused (exit 2)', lease(['acquire', '--key', 'process:auto-sync', '--ttl', '3m']).code === 2);
    lease(['release', '--key', 'process:auto-sync', '--reason', 'test'], { cwd: B, enforce: 'off' });

    check('B holds a live editor lease on a folder', lease(['acquire', '--key', 'path:company/ops/**', '--scope', 'company/ops/**', '--ttl', '3m', '--force-dirty', '--intent', 'editing'], { cwd: B }).code === 0);
    const whole = lease(['acquire', '--key', 'path:**', '--scope', '**', '--ttl', '3m', '--intent', 'copier update', '--paranoid', '--force-dirty']);
    check('auto-sync\'s whole-tree lease stands down while someone edits (exit 2)', whole.code === 2, `exit=${whole.code}`);
    lease(['release', '--key', 'path:company/ops/**', '--reason', 'test'], { cwd: B, enforce: 'off' });
    // In a live repository another, REAL session may be editing somewhere right now. Then the
    // whole-tree lease must still stand down — that is correct behaviour, not a failure. What
    // must not happen is being blocked by the test's OWN, already-released editor lease.
    const after = lease(['acquire', '--key', 'path:**', '--scope', '**', '--ttl', '3m', '--intent', 'copier update', '--force-dirty']);
    const blockedByUs = after.code === 2 && after.err.includes('contended by path:company/ops/**');
    check('...and is no longer blocked by the released editor (a real live editor elsewhere may still, correctly, block it)',
      after.code === 0 || (after.code === 2 && !blockedByUs), after.err);
    if (after.code === 2) console.log('        (blocked by a real live editor: ' + (after.err.split(String.fromCharCode(10))[0] ?? '') + ')');
    lease(['release', '--key', 'path:**', '--reason', 'test'], { enforce: 'off' });
  }
}

// ============================================================ teardown
for (const c of cleanups.reverse()) { try { c(); } catch { /* best effort */ } }
const pass = results.filter((r) => r.pass).length;
console.log(`\n${pass}/${results.length} checks passed`);
process.exit(pass === results.length ? 0 : 1);
