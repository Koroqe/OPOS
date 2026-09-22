#!/usr/bin/env node
/**
 * collision.mjs — the acceptance test for the whole protocol.
 *
 *   node .claude/skills/lease/test/collision.mjs --rounds 20 [--issue N] [--settle-ms 1500] [--keep]
 *
 * Two processes with forced, DIFFERENT identities race for the same key, barrier-synced so both
 * POST in the same instant. For each round we assert:
 *   - exactly one exit 0 and one exit 2
 *   - exactly ONE surviving lease comment (the loser must have deleted its own)
 *   - the survivor's clone_id is the one that exited 0
 *
 * Twenty rounds is the floor, not a flourish: high-risk behaviour deserves several independent
 * runs, not one careful one. The measured double-claim rate printed at the end is the number that
 * turns "eventual consistency is a residual risk" from a guess into a bound.
 */
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).flatMap((a, i, arr) => {
  if (!a.startsWith('--')) return [];
  const n = arr[i + 1];
  return [[a.slice(2), n && !n.startsWith('--') ? n : true]];
}));

const ROUNDS = Number(args.rounds ?? 20);
const SETTLE = String(args['settle-ms'] ?? 1500);
const ROOT = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const CFG = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude', 'lease.config.json'), 'utf8'));
const REPO = CFG.ledger.repo;
const LEASE = path.join(ROOT, '.claude', 'skills', 'lease', 'lease.mjs');
const MARKER = 'opos-lease:v1';

const gh = (a, input) => execFileSync('gh', a, { encoding: 'utf8', input, maxBuffer: 32 * 1024 * 1024 });
const ghq = (a, input) => { try { return { ok: true, out: gh(a, input) }; } catch (e) { return { ok: false, out: e.stdout?.toString() ?? '', err: e.stderr?.toString() ?? '' }; } };

function leaseComments(issue) {
  const out = gh(['api', '--paginate', `repos/${REPO}/issues/${issue}/comments?per_page=100`,
    '--jq', '.[] | {id: .id, body: .body}']);
  return out.split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((c) => c.body.includes(MARKER));
}

function recOf(c) {
  const i = c.body.indexOf('<!-- ' + MARKER);
  const j = c.body.indexOf('-->', i);
  try { return JSON.parse(c.body.slice(i + 5 + MARKER.length, j).trim()); } catch { return null; }
}

function runAcquire(cloneId, key, at) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [LEASE, 'acquire', '--key', key, '--ttl', '3m',
      '--intent', `collision ${cloneId}`, '--at', at, '--settle-ms', SETTLE, '--retries', '0', '--no-fetch'], {
      cwd: ROOT,
      env: { ...process.env, OPOS_CLONE_ID: cloneId, OPOS_SESSION_ID: `test-${cloneId}` },
    });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.stdout.on('data', () => {});
    p.on('close', (code) => resolve({ cloneId, code, err }));
  });
}

// Clear ONLY this suite's own key. An earlier version wiped the whole held/ directory and
// took an unrelated live lease's cache down with it — a test harness must not be able to
// disturb work it is not testing.
function clearCache() {
  const d = path.join(ROOT, '.claude', 'skills', 'lease', '.state', 'held');
  try {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f);
      try { if (JSON.parse(fs.readFileSync(p, 'utf8')).key === KEY) fs.rmSync(p, { force: true }); } catch { /* skip */ }
    }
  } catch { /* fine */ }
}

// ---------------------------------------------------------------- setup

let ISSUE = Number(args.issue ?? 0);
let created = false;
if (!ISSUE) {
  const url = gh(['issue', 'create', '--repo', REPO,
    '--title', '[lease-test] DO NOT TOUCH — automated lease-protocol check',
    '--body', 'Throwaway issue for the lease-protocol collision test. The script closes it when the run ends. If it is still open after an hour the run crashed and it can be closed by hand.']).trim();
  ISSUE = Number(path.basename(url));
  created = true;
  console.log(`created throwaway issue #${ISSUE}`);
}

const KEY = `issue:${REPO}#${ISSUE}`;
console.log(`collision suite: ${ROUNDS} rounds on ${KEY}, settle=${SETTLE}ms\n`);

const results = [];
let doubleClaims = 0;

for (let r = 1; r <= ROUNDS; r++) {
  clearCache();
  for (const c of leaseComments(ISSUE)) ghq(['api', '--method', 'DELETE', `repos/${REPO}/issues/comments/${c.id}`]);
  ghq(['issue', 'edit', String(ISSUE), '--repo', REPO, '--remove-label', CFG.index_label]);

  const at = new Date(Date.now() + 6000).toISOString();
  const [a, b] = await Promise.all([runAcquire('clone-A', KEY, at), runAcquire('clone-B', KEY, at)]);

  const codes = [a.code, b.code].sort((x, y) => x - y);
  const survivors = leaseComments(ISSUE);
  const liveSurvivors = survivors.map(recOf).filter((x) => x && x.state === 'held');
  const winner = [a, b].find((x) => x.code === 0);

  const okCodes = codes[0] === 0 && codes[1] === 2;
  const okOne = liveSurvivors.length === 1;
  const okWinner = okOne && winner && liveSurvivors[0].holder.clone_id === winner.cloneId;
  if (liveSurvivors.length > 1) doubleClaims++;

  const pass = okCodes && okOne && okWinner;
  results.push({ round: r, codes, survivors: liveSurvivors.length, winner: winner?.cloneId ?? null, pass });
  console.log(`  round ${String(r).padStart(2)}: exits [${codes.join(',')}] survivors=${liveSurvivors.length} winner=${winner?.cloneId ?? '—'} ${pass ? 'PASS' : 'FAIL'}`);
  if (!pass) {
    console.log(`     A(${a.code}): ${a.err.trim().split('\n')[0] ?? ''}`);
    console.log(`     B(${b.code}): ${b.err.trim().split('\n')[0] ?? ''}`);
  }
}

// label assertion on the final round: the index must have been applied exactly once
const labels = JSON.parse(gh(['issue', 'view', String(ISSUE), '--repo', REPO, '--json', 'labels']))
  .labels.map((l) => l.name);
const labelOk = labels.filter((l) => l === CFG.index_label).length === 1;

// ---------------------------------------------------------------- teardown
clearCache();
if (!args.keep) {
  for (const c of leaseComments(ISSUE)) ghq(['api', '--method', 'DELETE', `repos/${REPO}/issues/comments/${c.id}`]);
  ghq(['issue', 'edit', String(ISSUE), '--repo', REPO, '--remove-label', CFG.index_label]);
  if (created) ghq(['issue', 'close', String(ISSUE), '--repo', REPO, '--reason', 'completed',
    '--comment', 'Lease-protocol collision test finished; issue closed by the script.']);
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${ROUNDS} rounds passed`);
console.log(`index label applied exactly once on the final round: ${labelOk ? 'yes' : 'NO'}`);
console.log(`measured double-claim rate: ${doubleClaims}/${ROUNDS} (${(100 * doubleClaims / ROUNDS).toFixed(1)}%) at settle=${SETTLE}ms`);
console.log(`\nThis rate is the documented bound for RISKS "lease-protocol residual double-claim".`);
process.exit(passed === ROUNDS && labelOk ? 0 : 1);
