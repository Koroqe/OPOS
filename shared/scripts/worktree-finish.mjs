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
 *   20  the directory belongs to this repository (its git common dir equals the main checkout's)
 *   22  no other worktree (or the main checkout) lies inside it
 *   11  it has no uncommitted or untracked changes (status is read with --untracked-files=all
 *       --ignore-submodules=none, so user config cannot hide anything)
 *   12  it has no ignored files other than known OPOS local state (they would be lost), the ignored
 *       files could be enumerated (fail closed), and it holds no nested git repository (any `.git`
 *       below its own root `.git` file, ignored or not)
 *   14  it holds no leases (.claude/skills/lease/.state/held/ is empty)
 *   21  (--all-merged only) .claude/.current-task is empty: a non-empty one is a live session's worktree
 *   13  its HEAD is an ancestor of refs/remotes/origin/<default branch>, after a fetch (merge proven, not assumed)
 *   16  (--apply only) the process is not running inside it
 * Other codes: 0 ok / removed, 2 usage, 3 not a git repo, 17 removal failed or could not be verified,
 * 18 default branch or fetch unavailable (merge cannot be proven), 19 --path is not a worktree of this repo.
 * 15 locked is read from <git-common-dir>/worktrees/<name>/locked, so it works when the directory is missing.
 *
 * Removal: `git worktree remove` on git >= 2.17, else rm -rf + `git worktree prune`; the prune exit is
 * checked and the worktree must be gone from `git worktree list --porcelain`, else exit 17 (never a
 * false "removed"). Then the branch is deleted with `git branch -d` (never -D). Only when git says the
 * branch is "not fully merged" (it judges against the main checkout's HEAD, while this script has already
 * proven the merge into origin/<default>) the ref is dropped with `git update-ref -d <ref> <sha>` (it fails if
 * the branch moved). Any other branch-delete error (e.g. checked out elsewhere) keeps the branch and exits 17.
 * Remote branches are never touched. A detached worktree has no branch to delete.
 * With --all-merged a worktree that fails a check (or throws) is skipped and reported; the run never aborts
 * mid-way and exits 0 unless a removal itself failed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const CODES = {
  OK: 0, USAGE: 2, NOT_REPO: 3, MAIN: 10, DIRTY: 11, IGNORED: 12, NOT_MERGED: 13,
  LEASES: 14, LOCKED: 15, CWD: 16, REMOVE_FAILED: 17, NO_BASE: 18, NOT_WORKTREE: 19,
  FOREIGN: 20, ACTIVE_TASK: 21, NESTED_WORKTREE: 22,
};

/** Ignored paths that are known OPOS local state and safe to lose with the worktree. */
export const ALLOWED_IGNORED = [
  '.claude/.clone-id', '.claude/.current-task', '.claude/.paused-tasks', '.claude/skills/lease/.state',
  // framework-generated per-clone/per-session state (.gitignore, shared/templates/gitignore.core,
  // opos-session-update.mjs RUNTIME_FILES). NOT listed on purpose: .claude/scratchpad.md and
  // .claude/settings.local.json (user content), .claude/debug/, .claude/tmp/, scheduled-processes.json.
  '.claude/.sessions', '.claude/.opos-update-check', '.claude/.opos-update-state.json',
  '.claude/.opos-update.lock', '.claude/.last-update-check', '.claude/.update-probe',
];
export const ALLOWED_IGNORED_ANYWHERE = ['.DS_Store', 'node_modules', '__pycache__'];

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
  const r = git(['symbolic-ref', 'refs/remotes/origin/HEAD'], main);
  if (r.status === 0 && r.out.startsWith('refs/remotes/origin/')) return r.out.slice('refs/remotes/origin/'.length);
  for (const c of ['main', 'master']) {
    if (git(['rev-parse', '--verify', '-q', `refs/remotes/origin/${c}`], main).status === 0) return c;
  }
  return null;
}

/** Recursive walk that never follows symlinks. visit(rel, dirent) returns false to not descend. Throws on unreadable dirs. */
function walk(abs, rel, visit) {
  let ents;
  try { ents = fs.readdirSync(abs, { withFileTypes: true }); } catch (e) { throw new Error(`cannot read ${rel || '.'}: ${e.code || e.message}`); }
  for (const d of ents) {
    const r = rel ? `${rel}/${d.name}` : d.name;
    if (visit(r, d) === false) continue;
    if (d.isDirectory()) walk(path.join(abs, d.name), r, visit);
  }
}

/** What would be lost with the worktree directory besides tracked, committed content. Fails closed:
 * `error` is set when anything could not be enumerated. `files`: ignored paths that are not known OPOS
 * local state. `nested`: every `.git` below the worktree's own root `.git` (nested repos, other worktrees,
 * submodules), found by walking the tree because git does not descend into them. */
export function ignoredFiles(dir) {
  const st = git(['status', '--porcelain', '-z', '--ignored', '--untracked-files=all', '--ignore-submodules=none'], dir);
  if (st.status !== 0) return { error: `git status --ignored failed: ${st.err || `exit ${st.status}`}`, files: [], nested: [] };
  const entries = st.raw.split('\0').filter((l) => l.startsWith('!! ')).map((l) => l.slice(3));
  const files = [];
  const nested = [];
  try {
    for (const e of entries) {
      const p = e.replace(/\/+$/, '');
      if (isAllowedIgnored(p)) continue;
      if (!e.endsWith('/')) { files.push(p); continue; }
      // an ignored directory is only trusted when fully enumerated here
      walk(path.join(dir, p), p, (r, d) => {
        if (d.name === '.git') return false;
        if (isAllowedIgnored(r)) return false;
        if (!d.isDirectory()) files.push(r);
      });
    }
    walk(dir, '', (r, d) => {
      if (r === '.git') return false;
      if (d.name === '.git') { nested.push(r); return false; }
      if (isAllowedIgnored(r)) return false;
    });
  } catch (e) { return { error: `could not enumerate the worktree: ${e.message}`, files, nested }; }
  return { error: null, files: [...new Set(files)], nested };
}

function commonDirOf(cwd) {
  const r = git(['rev-parse', '--git-common-dir'], cwd);
  return r.status === 0 && r.out ? real(path.resolve(cwd, r.out)) : null;
}

/** The lock is a file in the admin dir; older git (< 2.31) omits `locked` from `worktree list --porcelain`.
 * Matched to the worktree through the admin dir's `gitdir` file, so it works when the directory is missing. */
function isLockedOnDisk(wt, common) {
  if (!common) return false;
  const base = path.join(common, 'worktrees');
  let names;
  try { names = fs.readdirSync(base); } catch { return false; }
  const want = new Set([path.resolve(wt.path), real(wt.path)]);
  for (const n of names) {
    const adm = path.join(base, n);
    let g;
    try { g = fs.readFileSync(path.join(adm, 'gitdir'), 'utf8').trim(); } catch { continue; }
    const dir = path.dirname(path.resolve(adm, g)); // a relative gitdir is relative to the admin dir
    if ((want.has(dir) || want.has(real(dir))) && fs.existsSync(path.join(adm, 'locked'))) return true;
  }
  return false;
}

const inside = (child, parent) => (child + path.sep).startsWith(parent + path.sep);

/** Run every check on one worktree entry. Returns { code, message, files? }; code 0 = removable. */
export function check(wt, ctx) {
  const { main, base, applying, cwd, common, all } = ctx;
  if (real(wt.path) === real(main)) return { code: CODES.MAIN, message: 'is the main checkout, not a linked worktree' };
  if (wt.locked || isLockedOnDisk(wt, common)) return { code: CODES.LOCKED, message: 'is locked (git worktree lock); unlock it deliberately first' };
  const exists = fs.existsSync(wt.path);
  if (exists) {
    if (commonDirOf(wt.path) !== common) {
      return { code: CODES.FOREIGN, message: 'does not belong to this repository (its git common dir differs); refusing to touch it' };
    }
    const me = real(wt.path);
    const inner = (all || []).filter((o) => o !== wt && o.path && inside(real(o.path), me) && real(o.path) !== me);
    if (inner.length) return { code: CODES.NESTED_WORKTREE, message: `contains other worktrees that would be deleted with it: ${inner.map((o) => o.path).join(', ')}` };
    if (ctx.checkTask) {
      const ct = path.join(wt.path, '.claude', '.current-task');
      if (fs.existsSync(ct) && fs.readFileSync(ct, 'utf8').trim()) {
        return { code: CODES.ACTIVE_TASK, message: 'has a non-empty .claude/.current-task (a live session\'s worktree); run task-complete there first' };
      }
    }
    const st = git(['status', '--porcelain', '-z', '--untracked-files=all', '--ignore-submodules=none'], wt.path);
    if (st.status !== 0) return { code: CODES.NOT_REPO, message: `git status failed: ${st.err}` };
    if (st.raw.replace(/\0/g, '').trim()) return { code: CODES.DIRTY, message: `has uncommitted or untracked changes (${st.raw.split('\0').filter(Boolean).length} paths)` };
    const ig = ignoredFiles(wt.path);
    if (ig.error) return { code: CODES.IGNORED, message: `cannot prove nothing would be lost: ${ig.error}` };
    if (ig.nested.length) return { code: CODES.IGNORED, message: `contains nested git repositories or worktrees (their commits would be lost): ${ig.nested.slice(0, 8).join(', ')}` };
    if (ig.files.length) return { code: CODES.IGNORED, message: `has ignored files that would be lost: ${ig.files.slice(0, 8).join(', ')}${ig.files.length > 8 ? ', ...' : ''}`, files: ig.files };
    const held = path.join(wt.path, '.claude', 'skills', 'lease', '.state', 'held');
    if (fs.existsSync(held) && fs.readdirSync(held).some((f) => f.endsWith('.json'))) {
      return { code: CODES.LEASES, message: 'holds leases (.claude/skills/lease/.state/held/); release them with lease.mjs release first' };
    }
  }
  if (!wt.head) return { code: CODES.NOT_MERGED, message: 'has no HEAD commit' };
  const anc = git(['merge-base', '--is-ancestor', wt.head, `refs/remotes/origin/${base}`], main);
  if (anc.status !== 0) return { code: CODES.NOT_MERGED, message: `HEAD ${wt.head.slice(0, 8)} is not an ancestor of origin/${base}; merge it first` };
  if (exists && (real(cwd) + path.sep).startsWith(real(wt.path) + path.sep)) {
    if (applying) {
      return { code: CODES.CWD, message: `is this process's own cwd; run from elsewhere: cd ${main} && node shared/scripts/worktree-finish.mjs --path ${wt.path} --apply` };
    }
    return { code: CODES.OK, message: `removable (to apply, run from outside it: cd ${main} && node shared/scripts/worktree-finish.mjs --path ${wt.path} --apply)` };
  }
  return { code: CODES.OK, message: 'removable' };
}

function stillListed(wt, main) {
  const l = git(['worktree', 'list', '--porcelain'], main);
  if (l.status !== 0) return null;
  const want = new Set([path.resolve(wt.path), real(wt.path)]);
  return parseWorktrees(l.raw).some((w) => want.has(path.resolve(w.path)) || want.has(real(w.path)));
}

function remove(wt, ctx) {
  const { main, gitVersion, base, common } = ctx;
  const linkFile = path.join(wt.path, '.git');
  if (fs.existsSync(wt.path)) {
    if (real(wt.path) === real(main) || !fs.existsSync(linkFile) || !fs.statSync(linkFile).isFile()) {
      return { code: CODES.REMOVE_FAILED, message: 'refusing to delete: not a linked worktree directory' };
    }
    // the .git file must point into THIS repo's admin area (a relative gitdir is relative to the worktree)
    const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(linkFile, 'utf8'));
    if (!m || !common || !inside(real(path.resolve(wt.path, m[1].trim())), path.join(common, 'worktrees'))) {
      return { code: CODES.FOREIGN, message: 'refusing to delete: its .git file does not point into this repository' };
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
  const pr = git(['worktree', 'prune'], main);
  if (pr.status !== 0) return { code: CODES.REMOVE_FAILED, message: `git worktree prune failed (exit ${pr.status}): ${pr.err}` };
  const listed = stillListed(wt, main);
  if (listed !== false) {
    return { code: CODES.REMOVE_FAILED, message: listed === null ? 'cannot verify removal: git worktree list failed' : 'worktree is still registered in git worktree list after removal' };
  }
  let note = 'worktree removed';
  if (wt.branch) {
    const d = git(['branch', '-d', wt.branch], main);
    if (d.status === 0) note += `, branch ${wt.branch} deleted`;
    else if (/not fully merged/i.test(d.err)) {
      // -d judges "merged" against the main checkout's HEAD; we already proved merge into origin/<base>.
      const u = git(['update-ref', '-d', `refs/heads/${wt.branch}`, wt.head], main);
      if (u.status === 0) {
        git(['config', '--remove-section', `branch.${wt.branch}`], main);
        note += `, branch ${wt.branch} deleted (merged into origin/${base})`;
      } else return { code: CODES.REMOVE_FAILED, message: `worktree removed but branch ${wt.branch} kept: ${u.err}` };
    } else return { code: CODES.REMOVE_FAILED, message: `worktree removed but branch ${wt.branch} kept: ${d.err}` };
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
  const ctx = { main, base, gitVersion, applying: opt.apply, cwd, common: commonDirOf(main), all, checkTask: opt.all };

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
    let v;
    try { v = check(wt, ctx); } catch (e) { v = { code: CODES.REMOVE_FAILED, message: `unexpected error while checking, left untouched: ${e.message}` }; }
    lastCode = v.code;
    if (v.code !== CODES.OK) { log(`${opt.all ? 'SKIP' : 'REFUSED'} ${tag}: ${v.message}`); continue; }
    if (!opt.apply) { log(`OK ${tag}: ${v.message}`); continue; }
    let r;
    try { r = remove(wt, ctx); } catch (e) { r = { code: CODES.REMOVE_FAILED, message: `unexpected error while removing: ${e.message}` }; }
    lastCode = r.code;
    if (r.code !== CODES.OK) { failed = true; log(`FAILED ${tag}: ${r.message}`); } else log(`REMOVED ${tag}: ${r.message}`);
  }
  if (opt.all) return failed ? CODES.REMOVE_FAILED : CODES.OK;
  return lastCode;
}

if (process.argv[1] && real(process.argv[1]) === real(new URL(import.meta.url).pathname)) {
  process.exit(run(process.argv.slice(2)));
}
