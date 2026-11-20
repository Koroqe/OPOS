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
 *   node shared/scripts/task-state.mjs write-task    --issue <N> --title <text> --depts <a,b>
 *        [--criterion <text>]... [--related-skills <a,b>] [--owner <slug>] [--state <s>]
 *        [--created YYYY-MM-DD] [--completed YYYY-MM-DD] [--deadline YYYY-MM-DD]
 *        (renders shared/templates/TASK.md.tmpl into tasks/<N>.md; exit 2 bad input, 4 no template, 1 write failed, 5 self-check failed;
 *         --title and --depts are required; each flag takes the next argument as its value and every flag
 *         except --criterion may be given once; an existing
 *         tasks/<N>.md or tasks/closed/<N>.md is left unchanged, exit 0)
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
 * Why write-task renders the task file instead of the skill substituting tokens by hand: a
 * hand-rendered file broke the console Tasks page in four ways, all from one generator. The
 * template's instruction comment was kept above the opening fence; a blank line was left before
 * it; a title containing ": " made the unquoted YAML value invalid; and " #" in a value either
 * swallowed the closing bracket of a flow list or silently cut an unquoted title short. Every
 * free-text value is therefore written as a YAML double-quoted scalar by code, and the result is
 * re-read before the command reports success.
 *
 * Writes go through a temp file + rename, so a concurrent reader never sees a half-written
 * list, and two writers can at worst lose one update to a cache — never corrupt it.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const cmd = argv[0];

/**
 * write-task reads its arguments as strict `--name value` pairs: each flag consumes the next argv
 * element as its value, whatever it looks like, so a value equal to a flag name is still a value.
 * A flag with no value, or text where a flag name belongs, is a usage error (exit 2).
 */
const WRITE_TASK_FLAGS = new Set(['issue', 'title', 'depts', 'related-skills', 'owner', 'state', 'created', 'completed', 'deadline', 'criterion', 'root']);
function parsePairs(args) {
  const m = new Map();
  for (let i = 0; i < args.length; i += 2) {
    if (!args[i].startsWith('--')) { process.stderr.write(`unexpected argument "${args[i]}"\n`); process.exit(2); }
    if (!WRITE_TASK_FLAGS.has(args[i].slice(2))) { process.stderr.write(`unknown flag ${args[i]}\n`); process.exit(2); }
    if (i + 1 >= args.length) { process.stderr.write(`${args[i]} needs a value\n`); process.exit(2); }
    const k = args[i].slice(2);
    if (k !== 'criterion' && m.has(k)) { process.stderr.write(`${args[i]} was given more than once\n`); process.exit(2); }
    m.set(k, [...(m.get(k) ?? []), args[i + 1]]);
  }
  return m;
}
const pairs = cmd === 'write-task' ? parsePairs(argv.slice(1)) : null;
const flag = (n) => {
  if (pairs) return pairs.has(n) ? pairs.get(n)[0] : null;
  const i = argv.indexOf('--' + n);
  return i === -1 ? null : argv[i + 1];
};
/** Every value of a repeatable flag, in order. */
const flags = (n) => (pairs ? pairs.get(n) ?? [] : argv.reduce((acc, a, i) => (a === '--' + n && i + 1 < argv.length ? [...acc, argv[i + 1]] : acc), []));

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

// ---- write-task ------------------------------------------------------------------------------

const TEMPLATE_NOTE = '# Render with: node shared/scripts/task-state.mjs write-task';
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// Characters outside PyYAML's printable set, plus NEL and the Unicode line/paragraph separators,
// which a YAML double-quoted scalar would otherwise fold as line breaks. JSON.stringify already
// escapes \x00-\x1F, quotes, backslashes and lone surrogates.
const YAML_UNSAFE = /[\u007F-\u009F\u2028\u2029\uFEFF\uFFFE\uFFFF]/g;

/** A string as a YAML double-quoted scalar (a JSON string with the extra escapes). */
function yq(value) {
  return JSON.stringify(value).replace(YAML_UNSAFE, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}
const yList = (items) => '[' + items.map(yq).join(', ') + ']';

function fail(code, msg) { process.stderr.write(msg + '\n'); process.exit(code); }

function slugList(label, raw, { lower = false } = {}) {
  if (raw === null || String(raw).trim() === '') return [];
  return String(raw).split(',').map((s) => {
    const v = lower ? s.trim().toLowerCase() : s.trim();
    if (!SLUG.test(v)) fail(2, `invalid ${label} "${s.trim()}": use lowercase letters, digits and hyphens`);
    return v;
  });
}

function localToday() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** True when YYYY-MM-DD names a day that exists (2026-02-30 does not). */
function isRealDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  if (y < 1) return false; // PyYAML rejects year 0
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCFullYear(y); // years 0-99 are otherwise mapped to 19xx
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

function dateFlag(name, dflt) {
  const v = flag(name);
  if (v === null) return dflt;
  const d = v.trim();
  if (!DATE.test(d) || !isRealDate(d)) fail(2, `--${name} must be a real calendar date, YYYY-MM-DD`);
  return d;
}

function writeTask() {
  const issue = requireIssue();
  const title = String(flag('title') ?? '').trim();
  if (!title) fail(2, '--title <text> is required and must not be empty');
  if (/[\r\n]/.test(title)) fail(2, '--title must be a single line (no CR or LF)');
  const depts = slugList('department', flag('depts'), { lower: true });
  if (!depts.length) fail(2, '--depts <a,b> is required');
  const relatedRaw = flag('related-skills');
  const related = relatedRaw === null ? ['task-register'] : slugList('related skill', relatedRaw);
  const owner = String(flag('owner') ?? 'chief-of-staff').trim();
  if (!SLUG.test(owner)) fail(2, `invalid owner "${owner}": use lowercase letters, digits and hyphens`);
  const state = String(flag('state') ?? 'active').trim();
  if (!['active', 'paused', 'completed', 'dropped'].includes(state)) fail(2, '--state must be one of active|paused|completed|dropped');
  const created = dateFlag('created', localToday());
  const completed = dateFlag('completed', '');
  const deadline = dateFlag('deadline', '');
  const criteria = flags('criterion').map((c) => {
    if (!c.trim()) fail(2, '--criterion must not be empty');
    return c.trim();
  });

  const tmplPath = path.join(ROOT, 'shared', 'templates', 'TASK.md.tmpl');
  let tmpl;
  try { tmpl = fs.readFileSync(tmplPath, 'utf8').replace(/\r\n/g, '\n'); }
  catch { fail(4, `template not found: ${tmplPath}`); }

  const rel = `tasks/${issue}.md`;
  const target = path.join(ROOT, 'tasks', `${issue}.md`);
  if (fs.existsSync(target)) { process.stdout.write(`exists, left unchanged: ${rel}\n`); return; }
  if (fs.existsSync(path.join(ROOT, 'tasks', 'closed', `${issue}.md`))) {
    process.stdout.write(`exists (closed), left unchanged: tasks/closed/${issue}.md\n`);
    return;
  }

  const values = {
    ISSUE_NUMBER: issue,
    TITLE: yq(title),
    OWNER_AGENT: yq(owner),
    DEPARTMENTS: yList(depts),
    STATE: yq(state),
    CREATED_DATE: created,
    COMPLETED_DATE: completed,
    SUCCESS_CRITERIA: yList(criteria),
    DEADLINE: deadline,
    RELATED_SKILLS: yList(related),
  };
  const unknown = new Set();
  const fill = (text, vals) => text.replace(/<<([A-Z0-9_]+)>>/g, (_, k) => {
    if (Object.prototype.hasOwnProperty.call(vals, k)) return vals[k];
    unknown.add(k);
    return '';
  });

  // Split at the closing fence so the body heading gets the raw title, not the quoted one.
  const close = tmpl.indexOf('\n---\n', 4);
  if (!tmpl.startsWith('---\n') || close === -1) fail(4, `template has no frontmatter fence: ${tmplPath}`);
  let front = tmpl.slice(0, close + 1);
  const body = tmpl.slice(close + 1);
  front = front.split('\n').filter((l) => !l.startsWith(TEMPLATE_NOTE)).join('\n');
  front = fill(front, values).replace(/^([A-Za-z_]\w*): +$/gm, '$1:');
  const out = front + fill(body, { ...values, TITLE: title });
  if (unknown.size) process.stderr.write(`left blank: ${[...unknown].join(', ')}\n`);

  // Create without overwriting: write a temp file, then hard-link it to the target. linkSync
  // fails with EEXIST when the file appeared since the check above, and never replaces it. On a
  // filesystem without hard links, fall back to an exclusive create (flag 'wx'), which also never
  // replaces. This run's own temp file is always removed, whatever happens.
  const tmp = `${target}.${process.pid}.tmp`;
  const cleanup = () => { try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ } };
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(tmp, out);
    try {
      fs.linkSync(tmp, target);
    } catch (e) {
      if (e && e.code === 'EEXIST') { process.stdout.write(`exists, left unchanged: ${rel}\n`); cleanup(); return; }
      if (e && ['EPERM', 'ENOTSUP', 'EXDEV'].includes(e.code)) {
        let fd;
        try { fd = fs.openSync(target, 'wx'); }
        catch (e2) {
          if (e2 && e2.code === 'EEXIST') { process.stdout.write(`exists, left unchanged: ${rel}\n`); cleanup(); return; }
          throw e2;
        }
        try { fs.writeFileSync(fd, out); }
        catch (e3) { fs.closeSync(fd); fs.rmSync(target, { force: true }); throw e3; } // the file is this run's own
        fs.closeSync(fd);
      } else { throw e; }
    }
  } catch (e) {
    cleanup();
    fail(1, `cannot write ${rel}: ${e && e.code ? e.code + ' ' : ''}${e && e.message ? String(e.message).split('\n')[0] : 'error'}`);
  }
  cleanup();

  // Self-check: re-read what landed on disk.
  const back = fs.readFileSync(target, 'utf8');
  const lineOf = (k) => back.split('\n').find((l) => l.startsWith(k + ':'));
  let ok = back.startsWith('---\n');
  for (const [k, want] of [['title', title], ['owner', owner], ['state', state]]) {
    const l = lineOf(k);
    if (!ok || !l) { ok = false; break; }
    try { ok = JSON.parse(l.slice(k.length + 1).trim()) === want; } catch { ok = false; }
  }
  if (!ok) {
    if (back === out) fs.rmSync(target, { force: true }); // only what this run created
    fail(5, `self-check failed for ${rel}; the file was removed`);
  }
  process.stdout.write(`wrote ${rel}\n`);
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
  case 'write-task':
    writeTask();
    break;
  default:
    process.stderr.write('usage: task-state.mjs <add-active|remove-active|list-active|add-paused|remove-paused|list-paused|patch-status|write-task> [--issue N] [--status s] [--root dir]\n');
    process.exit(2);
}
