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

test('patch-status exits 1 and writes nothing when the canonical line is missing (callers gate on the exit code; a pipe would not)', () => {
  const s = sandbox();
  const r = s.run(['patch-status', '--status', 'review'], 'no status line here\n');
  assert.equal(r.status, 1);
  assert.equal(r.stdout, '');
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

// ---- write-task ----

const TMPL = fs.readFileSync(path.join(path.dirname(SCRIPT), '..', 'templates', 'TASK.md.tmpl'), 'utf8');

function taskSandbox({ template = TMPL } = {}) {
  const s = sandbox();
  if (template !== null) {
    fs.mkdirSync(path.join(s.root, 'shared', 'templates'), { recursive: true });
    fs.writeFileSync(path.join(s.root, 'shared', 'templates', 'TASK.md.tmpl'), template);
  }
  s.task = (n) => { try { return fs.readFileSync(path.join(s.root, 'tasks', `${n}.md`), 'utf8'); } catch { return null; } };
  return s;
}

test('write-task renders a quoted, fence-first file', () => {
  const s = taskSandbox();
  const title = 'Docs: fix the widget #12';
  const r = s.run(['write-task', '--issue', '12', '--title', title, '--depts', 'Company, rnd', '--criterion', 'a #b, c']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'wrote tasks/12.md\n');
  const out = s.task(12);
  assert.ok(out.startsWith('---\n'));
  assert.ok(!out.includes('# Render with:'));
  assert.ok(!out.includes('<<'));
  const line = out.split('\n').find((l) => l.startsWith('title:'));
  assert.equal(JSON.parse(line.slice(6).trim()), title);
  assert.match(out, /^depts: \["company", "rnd"\]$/m);
  assert.match(out, /^success_criteria: \["a #b, c"\]$/m);
  assert.match(out, /^related_skills: \["task-register"\]$/m);
  assert.match(out, /^completed:$/m);
  assert.match(out, /^# Docs: fix the widget #12$/m);
});

test('write-task leaves an existing file unchanged', () => {
  const s = taskSandbox();
  fs.mkdirSync(path.join(s.root, 'tasks'));
  fs.writeFileSync(path.join(s.root, 'tasks', '3.md'), 'keep me\n');
  const r = s.run(['write-task', '--issue', '3', '--title', 'X', '--depts', 'rnd']);
  assert.equal(r.status, 0);
  assert.equal(r.stdout, 'exists, left unchanged: tasks/3.md\n');
  assert.equal(s.task(3), 'keep me\n');
});

test('write-task rejects bad input with exit 2 and writes nothing', () => {
  const base = ['write-task', '--issue', '4', '--title', 'T', '--depts', 'rnd'];
  const swap = (flag, value) => { const a = [...base]; const i = a.indexOf(flag); if (i === -1) a.push(flag, value); else a[i + 1] = value; return a; };
  const cases = [
    swap('--issue', 'abc'),
    swap('--title', '   '),
    swap('--depts', 'ok,Bad Dept!'),
    swap('--related-skills', 'good,bad skill'),
    swap('--owner', 'Not A Slug'),
    swap('--state', 'maybe'),
    swap('--created', '23-10-2026'),
    swap('--completed', 'yesterday'),
    swap('--deadline', '2026/10/01'),
    [...base, '--criterion', '   '],
    swap('--created', '2026-02-30'),
    swap('--completed', '2026-13-01'),
    swap('--deadline', '2026-04-31'),
    swap('--created', '0000-01-01'),                 // year 0 does not exist for YAML readers
    [...base, '--title', 'again'],                   // a single-valued flag given twice
    [...base, '--owner', 'a', '--owner', 'b'],
    swap('--title', 'two\nlines'),
    swap('--title', 'carriage\rreturn'),
    [...base, '--criterion'],                       // trailing flag with no value
    ['write-task', '--issue', '4', '--title', 'T'], // --depts missing
    ['write-task', '--issue', '4', '--depts', 'rnd'], // --title missing
    ['write-task', '--issue', '4', '--title', 'T', '--depts', ''], // no department at all
    ['write-task', '--issue', '4', '--title', 'T', '--depts', 'rnd', 'stray'],
  ];
  for (const args of cases) {
    const s = taskSandbox();
    const r = s.run(args);
    assert.equal(r.status, 2, args.join(' ') + ' -> ' + r.stderr);
    assert.ok(r.stderr.trim().length > 0 && !r.stderr.trim().includes('\n'));
    assert.equal(fs.existsSync(path.join(s.root, 'tasks')), false, args.join(' '));
  }
});

test('write-task writes owner and state as quoted scalars, so no owner turns into a boolean or a number', () => {
  for (const owner of ['no', 'on', 'true', 'null', '123', '0777', '0x1f']) {
    const s = taskSandbox();
    const r = s.run(['write-task', '--issue', '8', '--title', 'T', '--depts', 'rnd', '--owner', owner, '--state', 'paused']);
    assert.equal(r.status, 0, owner + ': ' + r.stderr);
    const out = s.task(8);
    assert.ok(out.split('\n').includes(`owner: ${JSON.stringify(owner)}`), owner);
    assert.ok(out.split('\n').includes('state: "paused"'));
  }
});

test('write-task blanks unknown template tokens and says so', () => {
  const s = taskSandbox({ template: TMPL.replace('deadline: <<DEADLINE>>', 'deadline: <<DEADLINE>>\nextra: <<NEW_THING>>') });
  const r = s.run(['write-task', '--issue', '6', '--title', 'T', '--depts', 'rnd']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /left blank: NEW_THING/);
  assert.ok(!s.task(6).includes('<<'));
  assert.match(s.task(6), /^extra:$/m);
});

test('write-task exits 4 without the template', () => {
  const s = taskSandbox({ template: null });
  const r = s.run(['write-task', '--issue', '7', '--title', 'T', '--depts', 'rnd']);
  assert.equal(r.status, 4);
  assert.equal(s.task(7), null);
});

test('write-task keeps << in a title and in a criterion', () => {
  const s = taskSandbox();
  const title = 'Use the << operator and <<TITLE>> literally';
  const r = s.run(['write-task', '--issue', '8', '--title', title, '--depts', 'rnd', '--criterion', 'a << b']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, '');
  const out = s.task(8);
  const line = out.split('\n').find((l) => l.startsWith('title:'));
  assert.equal(JSON.parse(line.slice(6).trim()), title);
  assert.match(out, /^success_criteria: \["a << b"\]$/m);
});

test('write-task accepts leap days and rejects other impossible dates', () => {
  const ok = taskSandbox();
  assert.equal(ok.run(['write-task', '--issue', '9', '--title', 'T', '--depts', 'rnd', '--created', '2028-02-29']).status, 0);
  const bad = taskSandbox();
  assert.equal(bad.run(['write-task', '--issue', '9', '--title', 'T', '--depts', 'rnd', '--created', '2027-02-29']).status, 2);
});

test('write-task takes the next argument as the value, even when it looks like a flag', () => {
  const s = taskSandbox();
  const r = s.run(['write-task', '--issue', '10', '--criterion', '--title', '--title', 'Real title', '--depts', 'rnd']);
  assert.equal(r.status, 0, r.stderr);
  const out = s.task(10);
  assert.match(out, /^title: "Real title"$/m);
  assert.match(out, /^success_criteria: \["--title"\]$/m);
});

test('write-task leaves a closed task alone instead of creating a duplicate', () => {
  const s = taskSandbox();
  fs.mkdirSync(path.join(s.root, 'tasks', 'closed'), { recursive: true });
  fs.writeFileSync(path.join(s.root, 'tasks', 'closed', '11.md'), 'closed\n');
  const r = s.run(['write-task', '--issue', '11', '--title', 'T', '--depts', 'rnd']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /^exists \(closed\), left unchanged/);
  assert.equal(s.task(11), null);
});

test('write-task never overwrites and leaves no temp file behind', () => {
  const s = taskSandbox();
  assert.equal(s.run(['write-task', '--issue', '12', '--title', 'First', '--depts', 'rnd']).status, 0);
  const first = s.task(12);
  const r = s.run(['write-task', '--issue', '12', '--title', 'Second', '--depts', 'rnd']);
  assert.equal(r.status, 0);
  assert.equal(s.task(12), first);
  assert.deepEqual(fs.readdirSync(path.join(s.root, 'tasks')), ['12.md']);
});

test('write-task rejects an unknown flag name with exit 2 and writes nothing', () => {
  const s = taskSandbox();
  const r = s.run(['write-task', '--issue', '13', '--title', 'T', '--depts', 'rnd', '--critrion', 'x']);
  assert.equal(r.status, 2);
  assert.equal(r.stderr, 'unknown flag --critrion\n');
  assert.equal(s.task(13), null);
});

// ---- write failures: a preload module makes chosen fs calls fail ----

function faulty(mode) {
  const s = taskSandbox();
  const pre = path.join(s.root, 'fault.mjs');
  fs.writeFileSync(pre, `
import fs from 'node:fs';
const mode = ${JSON.stringify(mode)};
const err = (code, msg) => Object.assign(new Error(code + ': ' + msg), { code });
const write = fs.writeFileSync;
fs.writeFileSync = (p, d, o) => {
  if (mode === 'enospc' && typeof p === 'string' && p.endsWith('.tmp')) { write(p, 'part'); throw err('ENOSPC', 'no space left on device, write'); }
  return write(p, d, o);
};
const link = fs.linkSync;
fs.linkSync = (a, b) => {
  if (mode === 'nolink') throw err('EPERM', 'operation not permitted, link');
  if (mode === 'nolink-raced') { write(b, 'keep me\\n'); throw err('EPERM', 'operation not permitted, link'); }
  return link(a, b);
};
`);
  s.runFaulty = (args) => spawnSync(process.execPath, ['--import', pre, SCRIPT, 'write-task', ...args, '--root', s.root], { encoding: 'utf8' });
  s.leftovers = () => { try { return fs.readdirSync(path.join(s.root, 'tasks')); } catch { return []; } };
  return s;
}
const ARGS = ['--issue', '14', '--title', 'Docs: set up a sample page', '--depts', 'rnd'];

test('write-task: a failed temp write exits 1 with one line and leaves no partial file', () => {
  const s = faulty('enospc');
  const r = s.runFaulty(ARGS);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /^cannot write tasks\/14\.md: ENOSPC [^\n]*\n$/);
  assert.ok(!/\n\s+at /.test(r.stderr));
  assert.deepEqual(s.leftovers(), []);
});

test('write-task: on a filesystem without hard links it creates the file exclusively and still checks it', () => {
  const s = faulty('nolink');
  const r = s.runFaulty(ARGS);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'wrote tasks/14.md\n');
  assert.deepEqual(s.leftovers(), ['14.md']);
  const plain = taskSandbox();
  plain.run(['write-task', ...ARGS]);
  assert.equal(s.task(14), plain.task(14));
});

test('write-task: without hard links, a file that appeared meanwhile is kept', () => {
  const s = faulty('nolink-raced');
  const r = s.runFaulty(ARGS);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'exists, left unchanged: tasks/14.md\n');
  assert.equal(s.task(14), 'keep me\n');
  assert.deepEqual(s.leftovers(), ['14.md']);
});

test('write-task: an unwritable tasks directory is a one-line error, not a stack trace', { skip: process.getuid && process.getuid() === 0 }, () => {
  const s = taskSandbox();
  fs.mkdirSync(path.join(s.root, 'tasks'));
  fs.chmodSync(path.join(s.root, 'tasks'), 0o555);
  try {
    const r = s.run(['write-task', ...ARGS]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /^cannot write tasks\/14\.md: EACCES [^\n]*\n$/);
    assert.deepEqual(fs.readdirSync(path.join(s.root, 'tasks')), []);
  } finally {
    fs.chmodSync(path.join(s.root, 'tasks'), 0o755);
  }
});

test('write-task: a template that cannot round-trip the title exits 5 and removes the file it created', () => {
  // No title line in the template: the self-check cannot find the title in what it wrote.
  const s = taskSandbox({ template: TMPL.replace(/^title: .*\n/m, '') });
  const r = s.run(['write-task', ...ARGS]);
  assert.equal(r.status, 5);
  assert.equal(r.stderr, 'self-check failed for tasks/14.md; the file was removed\n');
  assert.equal(s.task(14), null);
  assert.deepEqual(fs.readdirSync(path.join(s.root, 'tasks')), []);
});
