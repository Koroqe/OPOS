/** node --test shared/scripts/scheduler-rearm-durable.test.mjs
 *
 * End-to-end spawns of the SessionStart re-arm notice against synthetic repos (each a temp git
 * repo, so `git rev-parse --show-toplevel` resolves to the fixture, never to a surrounding checkout).
 * Only durable-vs-session-scoped classification of `.claude/scheduled-processes.json` rows is
 * covered here.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const SCRIPT = path.resolve(import.meta.dirname, 'scheduler-rearm-notice.mjs');

function run(rows) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rearm-durable-'));
  spawnSync('git', ['init', '-q'], { cwd: root });
  fs.mkdirSync(path.join(root, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude', 'scheduled-processes.json'), JSON.stringify(rows));
  return spawnSync(process.execPath, [SCRIPT], { cwd: root, encoding: 'utf8' });
}

const row = (name, routine_id) => ({ process_name: name, routine_id, cron: '0 9 * * 1', registered_at: '2026-01-01T00:00:00Z' });

test('a cloud: registration is durable and prints nothing', () => {
  const r = run([row('weekly-sweep', 'cloud:trig_0123456789')]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('a gha: registration is still durable and prints nothing', () => {
  const r = run([row('weekly-sweep', 'gha:.github/workflows/opos-weekly-sweep.yml')]);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, '');
});

test('a session-scoped registration is still flagged, and only it', () => {
  const r = run([row('durable-cloud', 'cloud:trig_1'), row('durable-gha', 'gha:.github/workflows/x.yml'), row('dies-with-session', 'cron-abc123')]);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /1 session-scoped registration\(s\) \(dies-with-session\) need re-arming/);
  assert.doesNotMatch(r.stdout, /durable-cloud|durable-gha/);
  assert.match(r.stdout, /gha and cloud registrations are durable and need nothing\./);
});

test('a prefix is not a substring: "mycloud:" and "xgha:" are not durable', () => {
  const r = run([row('a', 'mycloud:1'), row('b', 'xgha:1')]);
  assert.match(r.stdout, /2 session-scoped registration\(s\)/);
});
