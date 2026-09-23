#!/usr/bin/env node
/**
 * verify-sync.mjs — judge a `copier update` by its RESULT, including what it silently undid.
 *
 *   node shared/scripts/verify-sync.mjs --from <old-tag> [--to <new-tag>] [--json]
 *
 * Run it in the working tree right after `copier update`, BEFORE committing. It checks:
 *   1. the pin in .copier-answers.yml equals the target tag;
 *   2. there are no .rej files;
 *   3. every file the update changed is a file UPSTREAM changed between the two tags.
 *
 * Check 3 is the point. A file that changed locally although upstream did not touch it is a
 * local customisation being thrown away. That is not hypothetical: on Windows, copier
 * re-applies local edits with one `git apply --exclude` argument per consumer file under a
 * `_skip_if_exists` pattern, a consumer with ~1,300 such files overruns the 32K command-line
 * limit, CreateProcess fails with WinError 206, and every local edit to a CORE file is
 * silently reset to the template — including, in one real run, a department lead's list of
 * adopted processes committed that same day.
 *
 * Exit: 0 clean · 1 pin wrong / rejects present · 2 local customisations reverted · 3 cannot
 * determine (network, bad tags) — treat 3 as a failure, never as a pass.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf('--' + n); return i === -1 ? null : argv[i + 1]; };
const asJson = argv.includes('--json');

const sh = (file, args) => execFileSync(file, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const root = sh('git', ['rev-parse', '--show-toplevel']).trim();
const answers = fs.readFileSync(path.join(root, '.copier-answers.yml'), 'utf8');
const pin = /_commit:\s*['"]?([^,'"}\s]+)/.exec(answers)?.[1] ?? null;
const src = /_src_path:\s*['"]?([^,'"}\s]+)/.exec(answers)?.[1] ?? null;

const from = flag('from');
const to = flag('to') ?? pin;
const report = { from, to, pin, src, rejects: [], upstreamChanged: 0, reverted: [], verdict: 'unknown' };

function finish(code) {
  if (asJson) process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  else {
    process.stdout.write(`pin ${pin} (target ${to}) · rejects ${report.rejects.length} · upstream changed ${report.upstreamChanged} file(s) · local edits reverted ${report.reverted.length}\n`);
    for (const f of report.reverted) process.stdout.write(`  REVERTED (upstream did not touch it): ${f}\n`);
    process.stdout.write(`verdict: ${report.verdict}\n`);
  }
  process.exit(code);
}

if (!from) { report.verdict = 'usage: --from <old-tag> is required'; finish(3); }

// 1. pin
if (pin !== to) { report.verdict = `pin is ${pin}, expected ${to}`; finish(1); }

// 2. rejects
report.rejects = sh('git', ['status', '--porcelain', '--untracked-files=all'])
  .split(/\r?\n/).map((l) => l.slice(3).trim()).filter((f) => f.endsWith('.rej'));
if (report.rejects.length) { report.verdict = 'conflicts left as .rej files'; finish(1); }

// 3. what did upstream change between the two tags?
const m = /^(?:gh:|https:\/\/github\.com\/|git@github\.com:)([^/]+\/[^/.]+)/.exec(src ?? '');
if (!m) { report.verdict = `cannot parse _src_path '${src}'`; finish(3); }
let upstream;
try {
  upstream = sh('gh', ['api', `repos/${m[1]}/compare/${from}...${to}`, '--jq', '.files[].filename'])
    .split(/\r?\n/).filter(Boolean)
    .map((f) => f.replace(/\.jinja$/, ''));   // templated files render without the suffix
} catch (e) {
  report.verdict = `cannot read upstream diff ${from}...${to}: ${String(e.stderr ?? e.message).split('\n')[0]}`;
  finish(3);
}
const upstreamSet = new Set(upstream);
report.upstreamChanged = upstreamSet.size;

// Files the update touched in the working tree (modified, deleted, or newly added).
const touched = sh('git', ['status', '--porcelain', '--untracked-files=all'])
  .split(/\r?\n/).filter(Boolean)
  .map((l) => l.slice(3).trim().replace(/^"|"$/g, ''))
  .map((f) => (f.includes(' -> ') ? f.split(' -> ')[1] : f));

// Content-identical files (line endings only) are not a change worth reporting.
const realChange = (f) => {
  try { return sh('git', ['diff', '--ignore-all-space', '--ignore-cr-at-eol', '--', f]).trim().length > 0; }
  catch { return true; }
};

report.reverted = touched.filter((f) =>
  f !== '.copier-answers.yml' && !upstreamSet.has(f) && realChange(f));

if (report.reverted.length) {
  report.verdict = 'LOCAL CUSTOMISATIONS REVERTED — do not commit; reset this branch and re-run the update where it can complete (Linux, WSL, or the sync-opos Action)';
  finish(2);
}
report.verdict = 'clean';
finish(0);
