#!/usr/bin/env node
/**
 * worktree-finish.mjs — remove a session's git worktree (and its merged branch) once the work is
 * merged and the worktree is no longer needed. Zero dependencies.
 *
 *   node shared/scripts/worktree-finish.mjs                      dry run for the current worktree
 *   node shared/scripts/worktree-finish.mjs --path <dir>         dry run for another linked worktree
 *   node shared/scripts/worktree-finish.mjs --all-merged         dry run over every linked worktree
 *   ... --apply                                                  actually remove
 *   ... --no-fetch                                               do not `git fetch origin` first (offline)
 *
 * The gate is the exit code, not a convention. A target is removed only when ALL hold:
 *   10  it is a linked worktree, not the main checkout
 *   15  it is not locked (`git worktree lock`)
 *   11  it has no uncommitted or untracked changes
 *   12  it has no ignored files other than known OPOS local state (they would be lost)
 *   14  it holds no leases (.claude/skills/lease/.state/held/ is empty)
 *   13  its HEAD is an ancestor of origin/<default branch>, after a fetch (merge proven, not assumed)
 *   16  (--apply only) the process is not running inside it
 * Other codes: 0 ok / removed, 2 usage, 3 not a git repo, 17 removal failed,
 * 18 default branch or fetch unavailable (merge cannot be proven), 19 --path is not a worktree of this repo.
 *
 * Removal: `git worktree remove` on git >= 2.17, else rm -rf + `git worktree prune`. Then the branch is
 * deleted with `git branch -d` (never -D). If git refuses only because the main checkout sits on another
 * branch, while this script has already proven the merge into origin/<default>, the ref is dropped with
 * `git update-ref -d <ref> <sha>` (same safety: it fails if the branch moved). Remote branches are never touched.
 * With --all-merged a worktree that fails a check is skipped and reported; the run still exits 0.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const CODES = {
  OK: 0, USAGE: 2, NOT_REPO: 3, MAIN: 10, DIRTY: 11, IGNORED: 12, NOT_MERGED: 13,
  LEASES: 14, LOCKED: 15, CWD: 16, REMOVE_FAILED: 17, NO_BASE: 18, NOT_WORKTREE: 19,
};

/** Ignored paths that are known OPOS local state and safe to lose with the worktree. */
export const ALLOWED_IGNORED = [
  '.claude/.clone-id', '.claude/.current-task', '.claude/.paused-tasks', '.claude/skills/lease/.state',
];
export const ALLOWED_IGNORED_ANYWHERE = ['.DS_Store', 'node_modules'];

export function isAllowedIgnored(rel) {
  const p = rel.replace(/\/+$/, '');
  if (ALLOWED_IGNORED.some((a) => p === a || p.startsWith(a + '/'))) return true;
  const segs = p.split('/');
  return segs.some((s) => ALLOWED_IGNORED_ANYWHERE.includes(s));
}

function git(args, cwd) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  return { status: r.status ?? 1, out: (r.stdout || '').trim(), err: (r.stderr || '').trim(), raw: r.stdout || '' };
}

const real = (p) => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } };

export function parseWorktrees(porcelain) {
  const list = [];
  for (const block of porcelain.split(/\n\n+/)) {
    if (!block.trim()) continue;
    const w = { path: null, head: null, branch: null, locked: false, bare: false };
    for (const line of block.split('\n')) {
      if (line.startsWith('worktree ')) w.path = line.slice(9);
      else if (line.startsWith('HEAD ')) w.head = line.slice(5);
      else if (line.startsWith('branch ')) w.branch = line.slice(7).replace(/^refs\/heads\//, '');
      else if (line === 'bare') w.bare = true;
      else if (line === 'locked' || line.startsWith('locked ')) w.locked = true;
    }
    if (w.path) list.push(w);
  }
  return list;
}

export function gitAtLeast(versionText, major, minor) {
  const m = /(\d+)\.(\d+)/.exec(versionText);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a > major || (a === major && b >= minor);
}

function defaultBranch(main) {
  const r = git(['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], main);
  if (r.status === 0 && r.out.startsWith('origin/')) return r.out.slice(7);
  for (const c of ['main', 'master']) {
    if (git(['rev-parse', '--verify', '-q', `refs/remotes/origin/${c}`], main).status === 0) return c;
  }
  return null;
}

/** Ignored paths in a worktree that are NOT known OPOS local state. A collapsed ignored directory
 * (`!! .claude/`) is expanded to its files so allowed state inside it does not hide, or get blamed for, the rest. */
function ignoredFiles(dir) {
  const entries = git(['status', '--porcelain', '--ignored'], dir).raw.split('\n')
    .filter((l) => l.startsWith('!! ')).map((l) => l.slice(3));
  const out = [];
  for (const e of entries) {
    if (isAllowedIgnored(e)) continue;
    if (e.endsWith('/')) {
      const files = git(['ls-files', '--others', '--ignored', '--exclude-standard', '--', e], dir).raw.split('\n').filter(Boolean);
      out.push(...files.filter((f) => !isAllowedIgnored(f)));
    } else out.push(e);
  }
  return out;
}

/** Older git (< 2.31) omits `locked` from `worktree list --porcelain`; the lock is a file in the admin dir. */
function isLockedOnDisk(dir) {
  try {
    const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(path.join(dir, '.git'), 'utf8'));
    return !!m && fs.existsSync(path.join(m[1].trim(), 'locked'));
  } catch { return false; }
}

/** Run every check on one worktree entry. Returns { code, message, files? }; code 0 = removable. */
export function check(wt, ctx) {
  const { main, base, applying, cwd } = ctx;
  if (real(wt.path) === real(main)) return { code: CODES.MAIN, message: 'is the main checkout, not a linked worktree' };
  if (wt.locked || isLockedOnDisk(wt.path)) return { code: CODES.LOCKED, message: 'is locked (git worktree lock); unlock it deliberately first' };
  const exists = fs.existsSync(wt.path);
  if (exists) {
    const st = git(['status', '--porcelain'], wt.path);
    if (st.status !== 0) return { code: CODES.NOT_REPO, message: `git status failed: ${st.err}` };
    if (st.raw.trim()) return { code: CODES.DIRTY, message: `has uncommitted or untracked changes (${st.raw.trim().split('\n').length} paths)` };
    const ig = ignoredFiles(wt.path);
    if (ig.length) return { code: CODES.IGNORED, message: `has ignored files that would be lost: ${ig.slice(0, 8).join(', ')}${ig.length > 8 ? ', ...' : ''}`, files: ig };
    const held = path.join(wt.path, '.claude', 'skills', 'lease', '.state', 'held');
    if (fs.existsSync(held) && fs.readdirSync(held).some((f) => f.endsWith('.json'))) {
      return { code: CODES.LEASES, message: 'holds leases (.claude/skills/lease/.state/held/); release them with lease.mjs release first' };
    }
  }
  if (!wt.head) return { code: CODES.NOT_MERGED, message: 'has no HEAD commit' };
  const anc = git(['merge-base', '--is-ancestor', wt.head, `origin/${base}`], main);
  if (anc.status !== 0) return { code: CODES.NOT_MERGED, message: `HEAD ${wt.head.slice(0, 8)} is not an ancestor of origin/${base}; merge it first` };
  if (exists && real(cwd) !== null && (real(cwd) + path.sep).startsWith(real(wt.path) + path.sep)) {
    if (applying) {
      return { code: CODES.CWD, message: `is this process's own cwd; run from elsewhere: cd ${main} && node shared/scripts/worktree-finish.mjs --path ${wt.path} --apply` };
    }
    return { code: CODES.OK, message: `removable (to apply, run from outside it: cd ${main} && node shared/scripts/worktree-finish.mjs --path ${wt.path} --apply)` };
  }
  return { code: CODES.OK, message: 'removable' };
}

function remove(wt, ctx) {
  const { main, gitVersion, base } = ctx;
  const linkFile = path.join(wt.path, '.git');
  if (fs.existsSync(wt.path)) {
    if (real(wt.path) === real(main) || !fs.existsSync(linkFile) || !fs.statSync(linkFile).isFile()) {
      return { code: CODES.REMOVE_FAILED, message: 'refusing to delete: not a linked worktree directory' };
    }
    if (gitAtLeast(gitVersion, 2, 17)) {
      const r = git(['worktree', 'remove', wt.path], main);
      if (r.status !== 0) return { code: CODES.REMOVE_FAILED, message: `git worktree remove failed: ${r.err}` };
    } else {
      try { fs.rmSync(wt.path, { recursive: true, force: true }); } catch (e) {
        return { code: CODES.REMOVE_FAILED, message: `rm failed: ${e.message}` };
      }
    }
  }
  git(['worktree', 'prune'], main);
  let note = 'worktree removed';
  if (wt.branch) {
    const d = git(['branch', '-d', wt.branch], main);
    if (d.status === 0) note += `, branch ${wt.branch} deleted`;
    else {
      // -d judges "merged" against the main checkout's HEAD; we already proved merge into origin/<base>.
      const u = git(['update-ref', '-d', `refs/heads/${wt.branch}`, wt.head], main);
      if (u.status === 0) {
        git(['config', '--remove-section', `branch.${wt.branch}`], main);
        note += `, branch ${wt.branch} deleted (merged into origin/${base})`;
      } else return { code: CODES.REMOVE_FAILED, message: `worktree removed but branch ${wt.branch} kept: ${d.err || u.err}` };
    }
  }
  return { code: CODES.OK, message: note };
}

export function run(argv, cwd = process.cwd(), log = console.log) {
  const opt = { apply: false, all: false, fetch: true, path: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') opt.apply = true;
    else if (a === '--all-merged') opt.all = true;
    else if (a === '--no-fetch') opt.fetch = false;
    else if (a === '--path') opt.path = argv[++i];
    else { log(`usage: worktree-finish.mjs [--path <dir> | --all-merged] [--apply] [--no-fetch]  (unknown: ${a})`); return CODES.USAGE; }
  }
  if (opt.all && opt.path) { log('usage: --path and --all-merged are mutually exclusive'); return CODES.USAGE; }
  if (opt.path !== null && !opt.path) { log('usage: --path needs a directory'); return CODES.USAGE; }

  const top = git(['rev-parse', '--show-toplevel'], cwd);
  if (top.status !== 0) { log('not inside a git repository'); return CODES.NOT_REPO; }
  const gitVersion = git(['--version'], cwd).out;
  const all = parseWorktrees(git(['worktree', 'list', '--porcelain'], top.out).raw);
  if (!all.length) { log('git worktree list returned nothing'); return CODES.NOT_REPO; }
  const main = all[0].path;

  const base = defaultBranch(main);
  if (!base) { log('cannot detect the default branch (no origin/HEAD, origin/main or origin/master)'); return CODES.NO_BASE; }
  if (opt.fetch) {
    const f = git(['fetch', 'origin'], main);
    if (f.status !== 0) { log(`git fetch origin failed, merge cannot be proven: ${f.err}`); return CODES.NO_BASE; }
  }
  const ctx = { main, base, gitVersion, applying: opt.apply, cwd };

  let targets;
  if (opt.all) targets = all.slice(1).filter((w) => !w.bare);
  else {
    const want = real(opt.path || top.out);
    const hit = all.find((w) => real(w.path) === want);
    if (!hit) { log(`${want} is not a worktree of this repository`); return CODES.NOT_WORKTREE; }
    targets = [hit];
  }
  if (opt.all && !targets.length) { log('no linked worktrees'); return CODES.OK; }

  let failed = false;
  let lastCode = CODES.OK;
  for (const wt of targets) {
    const tag = `${wt.path}${wt.branch ? ` [${wt.branch}]` : ''}`;
    const v = check(wt, ctx);
    lastCode = v.code;
    if (v.code !== CODES.OK) { log(`${opt.all ? 'SKIP' : 'REFUSED'} ${tag}: ${v.message}`); continue; }
    if (!opt.apply) { log(`OK ${tag}: ${v.message}`); continue; }
    const r = remove(wt, ctx);
    lastCode = r.code;
    if (r.code !== CODES.OK) { failed = true; log(`FAILED ${tag}: ${r.message}`); } else log(`REMOVED ${tag}: ${r.message}`);
  }
  if (opt.all) return failed ? CODES.REMOVE_FAILED : CODES.OK;
  return lastCode;
}

if (process.argv[1] && real(process.argv[1]) === real(new URL(import.meta.url).pathname)) {
  process.exit(run(process.argv.slice(2)));
}
