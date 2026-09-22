#!/usr/bin/env node
/**
 * task-state.mjs — the small mutations the task-lifecycle skills need, as a script.
 *
 *   node shared/scripts/task-state.mjs remove-active --issue <N>
 *   node shared/scripts/task-state.mjs add-active    --issue <N>
 *   node shared/scripts/task-state.mjs patch-status  --status <s>   (body on stdin, patched body on stdout)
 *
 * Why a script and not an inline interpreter one-liner:
 *
 * These steps used `python3 -c '...'`. On a stock Windows machine `python3` resolves to the
 * Microsoft Store app-execution alias, which prints "Python was not found" and exits 49 — so
 * `task-update`'s status-line patch, `task-complete`'s active-list prune and `task-pause`'s
 * were silently dead there, while the skills read as working. Before that they were shell
 * `grep -v … > tmp && mv` chains, which failed reproducibly on first invocation.
 *
 * Two interpreter choices in a row failed the same way, so the fix is not a third one-liner: a
 * file can be tested, and `node` is already required by other shipped skills. Logic that lives
 * in a JSON- or shell-escaped string is logic nothing can check.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (n) => { const i = argv.indexOf('--' + n); return i === -1 ? null : argv[i + 1]; };

function repoRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch { return process.cwd(); }
}

const ROOT = flag('root') ?? repoRoot();
const ACTIVE = path.join(ROOT, '.claude', '.current-task');

/** Newline-delimited integers. Non-numeric lines are dropped, duplicates collapsed. */
function readActive() {
  let raw = '';
  try { raw = fs.readFileSync(ACTIVE, 'utf8'); } catch { return []; }
  const nums = raw.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^[0-9]+$/.test(l));
  return Array.from(new Set(nums));
}

function writeActive(list) {
  if (!list.length) { try { fs.rmSync(ACTIVE, { force: true }); } catch { /* already gone */ } return; }
  fs.mkdirSync(path.dirname(ACTIVE), { recursive: true });
  fs.writeFileSync(ACTIVE, list.join('\n') + '\n');
}

function requireIssue() {
  const n = String(flag('issue') ?? '').trim();
  if (!/^[0-9]+$/.test(n)) { process.stderr.write('--issue <N> is required\n'); process.exit(2); }
  return n;
}

switch (cmd) {
  case 'remove-active': {
    const n = requireIssue();
    // Absent file is the desired end state, not an error — another session may have got there
    // first, and task-complete must stay idempotent.
    const next = readActive().filter((x) => x !== n);
    writeActive(next);
    process.stdout.write(next.length ? next.join(',') + '\n' : '(empty)\n');
    break;
  }
  case 'add-active': {
    const n = requireIssue();
    const cur = readActive();
    if (!cur.includes(n)) cur.push(n);
    writeActive(cur);
    process.stdout.write(cur.join(',') + '\n');
    break;
  }
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
  case 'list-active':
    process.stdout.write(readActive().join('\n') + (readActive().length ? '\n' : ''));
    break;
  default:
    process.stderr.write('usage: task-state.mjs <remove-active|add-active|list-active|patch-status> [--issue N] [--status s]\n');
    process.exit(2);
}
