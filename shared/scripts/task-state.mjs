#!/usr/bin/env node
/**
 * task-state.mjs — the small local-state mutations the task-lifecycle skills need.
 *
 *   node shared/scripts/task-state.mjs add-active    --issue <N>
 *   node shared/scripts/task-state.mjs remove-active --issue <N>
 *   node shared/scripts/task-state.mjs list-active
 *   node shared/scripts/task-state.mjs add-paused    --issue <N>
 *   node shared/scripts/task-state.mjs remove-paused --issue <N>     (exit 3 if not paused)
 *   node shared/scripts/task-state.mjs list-paused
 *   node shared/scripts/task-state.mjs patch-status  --status <s>    (body on stdin, patched body on stdout)
 *
 * These two files are a LOCAL CONVENIENCE CACHE, not the source of truth for occupancy. Since
 * v0.17.0 the authority is the lease (a claim comment on GitHub, visible from every machine);
 * these files only remember "which issues did this clone work on", so a session need not pass
 * --issue every time.
 *
 * Why a script and not an inline interpreter one-liner: these steps used `python3 -c '...'`,
 * and on a stock Windows machine python3 is the Microsoft Store alias stub that exits 49 — the
 * steps were silently dead there while the skills read as working. Before that they were shell
 * `grep -v … > tmp && mv` chains that failed reproducibly on first invocation. Two interpreter
 * choices failing the same way is a pattern: logic inside an escaped string is logic nothing
 * can test. A file can be tested.
 *
 * Writes go through a temp file + rename, so a concurrent reader never sees a half-written
 * list, and two writers can at worst lose one update to a cache — never corrupt it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (n) => { const i = argv.indexOf('--' + n); return i === -1 ? null : argv[i + 1]; };

function repoRoot() {
  try { return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim(); }
  catch { return process.cwd(); }
}

const ROOT = flag('root') ?? repoRoot();
const ACTIVE = path.join(ROOT, '.claude', '.current-task');
const PAUSED = path.join(ROOT, '.claude', '.paused-tasks');

/** Newline-delimited integers. Non-numeric lines are dropped, duplicates collapsed. */
function readList(file) {
  let raw = '';
  try { raw = fs.readFileSync(file, 'utf8'); } catch { return []; }
  const nums = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[0-9]+$/.test(l));
  return Array.from(new Set(nums));
}

function writeList(file, list, { keepEmpty = false } = {}) {
  if (!list.length && !keepEmpty) {
    try { fs.rmSync(file, { force: true }); } catch { /* already gone */ }
    return;
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, list.length ? list.join('\n') + '\n' : '');
  fs.renameSync(tmp, file);
}

// .paused-tasks is kept even when empty, as before: task-resume distinguishes
// "this clone never paused anything" from "the paused list is now empty".
const readActive = () => readList(ACTIVE);
const writeActive = (l) => writeList(ACTIVE, l);
const readPaused = () => readList(PAUSED);
const writePaused = (l) => writeList(PAUSED, l, { keepEmpty: true });

function requireIssue() {
  const n = String(flag('issue') ?? '').trim();
  if (!/^[0-9]+$/.test(n)) { process.stderr.write('--issue <N> is required\n'); process.exit(2); }
  return String(Number(n));
}

const print = (list) => process.stdout.write(list.length ? list.join(',') + '\n' : '(empty)\n');

switch (cmd) {
  case 'add-active': {
    const n = requireIssue();
    const cur = readActive();
    if (!cur.includes(n)) cur.push(n);
    writeActive(cur);
    print(cur);
    break;
  }
  case 'remove-active': {
    // An absent file is the desired end state, not an error — another session may have got
    // there first, and task-complete must stay idempotent.
    const n = requireIssue();
    const next = readActive().filter((x) => x !== n);
    writeActive(next);
    print(next);
    break;
  }
  case 'list-active':
    process.stdout.write(readActive().map((x) => x + '\n').join(''));
    break;
  case 'add-paused': {
    const n = requireIssue();
    const cur = readPaused();
    if (!cur.includes(n)) cur.push(n);
    writePaused(cur);
    print(cur);
    break;
  }
  case 'remove-paused': {
    const n = requireIssue();
    const cur = readPaused();
    if (!cur.includes(n)) {
      process.stderr.write(`issue #${n} is not in the paused list\n`);
      process.exit(3);
    }
    writePaused(cur.filter((x) => x !== n));
    process.stdout.write('ok\n');
    break;
  }
  case 'list-paused':
    process.stdout.write(readPaused().map((x) => x + '\n').join(''));
    break;
  case 'patch-status': {
    const status = String(flag('status') ?? '').trim();
    if (!status) { process.stderr.write('--status <value> is required\n'); process.exit(2); }
    const body = fs.readFileSync(0, 'utf8');
    const patched = body.replace(/^\*\*Status:\*\* .+$/m, `**Status:** ${status}`);
    if (patched === body) {
      process.stderr.write('the canonical "**Status:** <value>" line is not present in the issue body — restore it or skip --status\n');
      process.exit(1);
    }
    process.stdout.write(patched);
    break;
  }
  default:
    process.stderr.write('usage: task-state.mjs <add-active|remove-active|list-active|add-paused|remove-paused|list-paused|patch-status> [--issue N] [--status s] [--root dir]\n');
    process.exit(2);
}
