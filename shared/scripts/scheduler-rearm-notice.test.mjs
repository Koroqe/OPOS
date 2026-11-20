/** node --test shared/scripts/scheduler-rearm-notice.test.mjs
 *
 * End-to-end spawns of the SessionStart hook against synthetic repos (each a temp git repo, so
 * `git rev-parse --show-toplevel` resolves to the fixture and never to a surrounding checkout).
 * Dates are relative to today, so the fixtures never age out.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = path.resolve(import.meta.dirname, 'scheduler-rearm-notice.mjs');

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rearm-notice-'));
  spawnSync('git', ['init', '-q'], { cwd: root });
  const put = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  };
  const record = (rel, { status = 'open', delta = '"tighten step 3"', upstream = null } = {}) =>
    put(rel, `---\ndate: x\nskill: x\nproposed_delta: ${delta}\nstatus: ${status}\n${upstream ? `upstream_pr: ${upstream}\n` : ''}---\n\nbody\n`);
  const run = () => spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: 'utf8' });
  return { root, put, record, run };
}

const loopLine = (out) => out.split('\n').find((l) => l.startsWith('[opos-loop]'));

test('a fresh scaffold prints nothing and exits 0', () => {
  const r = repo().run();
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('an old open delta and a review-history that never ran produce one [opos-loop] line', () => {
  const s = repo();
  s.record(`.claude/skills/task-update/history/${daysAgo(40)}-a.md`);
  const r = s.run();
  assert.equal(r.status, 0);
  assert.match(loopLine(r.stdout), new RegExp(`review-history has never run; 1 open proposed_delta entry waits for it \\(oldest ${daysAgo(40)}\\)`));
});

test('a review-history record within 14 days silences the notice', () => {
  const s = repo();
  s.record(`.claude/skills/task-update/history/${daysAgo(40)}-a.md`);
  s.put(`.claude/skills/review-history/history/${daysAgo(3)}-run.md`, '---\nstatus: n/a\n---\n');
  assert.equal(loopLine(s.run().stdout), undefined);
});

test('a stale review-history record is reported with its age; scheduled-runs and department skills count', () => {
  const s = repo();
  s.record(`.claude/skills/task-update/history/${daysAgo(40)}-a.md`);
  s.record(`.claude/skills/auto-sync/scheduled-runs/${daysAgo(20)}-b.md`);
  s.record(`departments/rnd/.claude/skills/sample-skill/history/${daysAgo(18)}-c.md`);
  s.put(`.claude/skills/review-history/scheduled-runs/${daysAgo(30)}-run.md`, '---\nstatus: n/a\n---\n');
  assert.match(loopLine(s.run().stdout), /review-history has not run in 30 days; 3 open proposed_delta entries wait/);
});

test('deltas younger than 14 days are not yet late', () => {
  const s = repo();
  s.record(`.claude/skills/task-update/history/${daysAgo(5)}-a.md`);
  assert.equal(loopLine(s.run().stdout), undefined);
});

test('only what review-history would select is counted', () => {
  const s = repo();
  const old = daysAgo(40);
  s.record(`.claude/skills/a/history/${old}-applied.md`, { status: 'applied' });
  s.record(`.claude/skills/a/history/${old}-nodelta.md`, { delta: 'none', status: 'open' });
  s.record(`.claude/skills/a/history/${old}-quoted-none.md`, { delta: '"none"', status: 'open' });
  s.record(`.claude/skills/a/history/${old}-upstream.md`, { upstream: 'https://example.invalid/pr/1' });
  s.record(`company/backlog/${old}-item.md`);
  s.record(`node_modules/pkg/history/${old}-vendored.md`);
  s.put(`.claude/skills/a/history/${old}-nofm.md`, 'status: open\nproposed_delta: x\n');
  s.put(`.claude/skills/a/history/README.md`, '---\nstatus: open\nproposed_delta: x\n---\n');
  assert.equal(loopLine(s.run().stdout), undefined);
  s.record(`.claude/skills/a/history/${old}-counted.md`, { status: '"open"  # still waiting' });
  assert.match(loopLine(s.run().stdout), /1 open proposed_delta entry waits/);
});

test('the scheduler re-arm notice is unchanged and independent of the loop notice', () => {
  const s = repo();
  s.put('.claude/scheduled-processes.json', JSON.stringify([
    { process_name: 'review-history', routine_id: 'cron-1' },
    { process_name: 'auto-sync', routine_id: 'gha:opos-auto-sync.yml' },
  ]));
  const r = s.run();
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^\[opos-scheduler\] 1 session-scoped registration\(s\) \(review-history\) need re-arming/);
  assert.equal(loopLine(r.stdout), undefined);
});
