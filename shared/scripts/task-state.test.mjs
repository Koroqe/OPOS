/** node --test shared/scripts/task-state.test.mjs — offline; each test gets its own temp root. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'task-state.mjs');

function sandbox() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'task-state-'));
  fs.mkdirSync(path.join(root, '.claude'));
  const run = (args, input) => spawnSync(process.execPath, [SCRIPT, ...args, '--root', root], { encoding: 'utf8', input });
  const read = (f) => { try { return fs.readFileSync(path.join(root, '.claude', f), 'utf8'); } catch { return null; } };
  const write = (f, s) => fs.writeFileSync(path.join(root, '.claude', f), s);
  return { root, run, read, write };
}

test('add-active appends without duplicating', () => {
  const s = sandbox();
  s.run(['add-active', '--issue', '5']);
  s.run(['add-active', '--issue', '7']);
  s.run(['add-active', '--issue', '5']);
  assert.equal(s.read('.current-task'), '5\n7\n');
});

test('reading tolerates junk lines, CRLF and duplicates', () => {
  const s = sandbox();
  s.write('.current-task', '12\r\nnot-a-number\r\n12\r\n\r\n40\r\n');
  assert.equal(s.run(['list-active']).stdout, '12\n40\n');
});

test('remove-active deletes the file with its last entry', () => {
  const s = sandbox();
  s.write('.current-task', '9\n');
  s.run(['remove-active', '--issue', '9']);
  assert.equal(s.read('.current-task'), null);
});

test('remove-active on an absent file is a no-op success (idempotent against a concurrent session)', () => {
  const s = sandbox();
  const r = s.run(['remove-active', '--issue', '9']);
  assert.equal(r.status, 0);
});

test('the paused list survives being emptied, so "never paused" differs from "empty"', () => {
  const s = sandbox();
  s.run(['add-paused', '--issue', '3']);
  s.run(['remove-paused', '--issue', '3']);
  assert.equal(s.read('.paused-tasks'), '');
});

test('remove-paused of an issue that is not paused exits 3, distinct from failure', () => {
  const s = sandbox();
  assert.equal(s.run(['remove-paused', '--issue', '3']).status, 3);
});

test('patch-status rewrites only the canonical line', () => {
  const s = sandbox();
  const r = s.run(['patch-status', '--status', 'review'], 'intro\n**Status:** open\n**Status:** in the text, not first\n');
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'intro\n**Status:** review\n**Status:** in the text, not first\n');
});

test('patch-status exits 1 when the canonical line is missing, so the pipeline stops before gh issue edit', () => {
  const s = sandbox();
  assert.equal(s.run(['patch-status', '--status', 'review'], 'no status line here\n').status, 1);
});

test('a status value is never shell-interpreted', () => {
  const s = sandbox();
  const r = s.run(['patch-status', '--status', 'blocked; $(rm -rf /) `x`'], '**Status:** open\n');
  assert.equal(r.stdout, '**Status:** blocked; $(rm -rf /) `x`\n');
});

test('missing --issue is a usage error (2), not a silent success', () => {
  const s = sandbox();
  assert.equal(s.run(['add-active']).status, 2);
});
