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
 *       --ignore-submodules=none, so user config cannot hide anything), and no edit hidden from status
 *       by `git update-index --skip-worktree` / `--assume-unchanged`: `git ls-files -v` lists those
 *       files and each one is compared to the index (`git hash-object` vs the index blob); a differing
 *       or deleted one refuses. A skip-worktree file that is simply absent (sparse checkout) is fine.
 *   12  it has no ignored files other than known OPOS local state (they would be lost), the ignored
 *       files could be enumerated (fail closed), and it holds no nested git repository (any `.git`
 *       below its own root `.git` file, ignored or not). The `.git` walk never skips a subtree, not
 *       even the allow-listed ones. The allow-list is narrow: `.DS_Store` files, `*.pyc` files directly in a
 *       `__pycache__`, and a `node_modules` that git itself reports as an ignored directory; everything
 *       else inside those is still refused.
 *   14  it holds no leases (.claude/skills/lease/.state/held/ is empty)
 *   21  .claude/.current-task is empty: a non-empty one means another live task remains in that
 *       worktree (task-complete step 14 removes only the completed issue)
 *   13  its HEAD is an ancestor of refs/remotes/origin/<default branch>, after a fetch (merge proven, not assumed)
 *   16  (--apply only) the process is not running inside it
 * Other codes: 0 ok / removed, 2 usage, 3 not a git repo, 17 removal failed or could not be verified,
 * 18 default branch or fetch unavailable (merge cannot be proven), 19 --path is not a worktree of this repo.
 * 15 locked is read from <git-common-dir>/worktrees/<name>/locked, so it works when the directory is missing.
 *
 * Removal: `git worktree remove` on git >= 2.17, else rm -rf. Never a global `git worktree prune` (it would
 * also drop the admin dir of any other worktree whose directory is temporarily missing, orphaning its
 * commits): only the target's own `<common-dir>/worktrees/<id>` (matched by its `gitdir` file) is deleted.
 * Afterwards the target must be gone from `git worktree list --porcelain` AND every other worktree listed
 * before must still be listed, else exit 17 (never a false "removed"). Then the branch is deleted with `git branch -d` (never -D). Only when git says the
 * branch is "not fully merged" (it judges against the main checkout's HEAD, while this script has already
 * proven the merge into origin/<default>) the ref is dropped with `git update-ref -d <ref> <sha>` (it fails if
 * the branch moved). Any other branch-delete error (e.g. checked out elsewhere) keeps the branch and exits 17.
 * Remote branches are never touched. A detached worktree has no branch to delete.
 * Not covered (same as git's own `worktree remove`): commits reachable only from the target's HEAD reflog,
 * e.g. detached work later abandoned. A detached HEAD that is not an ancestor of origin/<default> is
 * already refused by 13, so only work abandoned before the final HEAD is at risk.
 * Time-of-check/time-of-use: the status, hidden-edit, ignored and nested checks are re-run right before the
 * delete. On git >= 2.17 `worktree remove` additionally refuses tracked or untracked changes itself; on
 * git < 2.17 (rm -rf) a file created in the few milliseconds between the re-check and the delete is still lost.
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
/** Allowed anywhere, deliberately narrow: `.DS_Store` files, `*.pyc` files directly inside a `__pycache__`. */
function allowedByName(p, isDir) {
  const segs = p.split('/');
  const name = segs[segs.length - 1];
  if (isDir) return false;
  if (name === '.DS_Store') return true;
  return name.endsWith('.pyc') && segs[segs.length - 2] === '__pycache__';
}

/** Allowed while enumerating INSIDE an ignored directory: OPOS state, .DS_Store, __pycache__/*.pyc. Not node_modules. */
function allowedInside(rel, isDir) {
  const p = rel.replace(/\/+$/, '');
  return ALLOWED_IGNORED.some((a) => p === a || p.startsWith(a + '/')) || allowedByName(p, isDir);
}

/** For an entry git status reports as ignored: `rel` ends with '/' when git reports a whole directory.
 * A `node_modules` is allowed only as such an entry (git itself ignores the directory); it is still walked for `.git`. */
export function isAllowedIgnored(rel, isDir = rel.endsWith('/')) {
  const p = rel.replace(/\/+$/, '');
  if (allowedInside(p, isDir)) return true;
  return isDir && p.split('/').pop() === 'node_modules';
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
  // `normal`, not `all`: git then reports a wholly ignored directory as one `dir/` entry, which is what lets a
  // `node_modules` that git itself ignores as a directory be told apart from ignored files inside other dirs.
  // (Untracked files were already ruled out by the --untracked-files=all status in contentChecks.)
  const st = git(['status', '--porcelain', '-z', '--ignored', '--untracked-files=normal', '--ignore-submodules=none'], dir);
  if (st.status !== 0) return { error: `git status --ignored failed: ${st.err || `exit ${st.status}`}`, files: [], nested: [] };
  const entries = st.raw.split('\0').filter((l) => l.startsWith('!! ')).map((l) => l.slice(3));
  const files = [];
  const nested = [];
  try {
    for (const e of entries) {
      const p = e.replace(/\/+$/, '');
      if (isAllowedIgnored(e)) continue;
      if (!e.endsWith('/')) { files.push(p); continue; }
      // an ignored directory is only trusted when fully enumerated here
      walk(path.join(dir, p), p, (r, d) => {
        if (d.name === '.git') return false;
        const dir_ = d.isDirectory();
        if (allowedInside(r, dir_)) return dir_ ? false : undefined;
        if (!dir_) files.push(r);
      });
    }
    walk(dir, '', (r, d) => {
      if (r === '.git') return false;
      if (d.name === '.git') { nested.push(r); return false; }
      // no subtree is ever skipped here: a nested repo can hide anywhere, allow-listed paths included
    });
  } catch (e) { return { error: `could not enumerate the worktree: ${e.message}`, files, nested }; }
  return { error: null, files: [...new Set(files)], nested };
}

/** Edits that `git status` cannot see: files flagged skip-worktree (`S`) or assume-unchanged (lowercase tag) in
 * the index. Each is compared to the index blob; a differing or (for assume-unchanged) missing file is reported.
 * A skip-worktree file absent from disk is a sparse checkout, not an edit. Fails closed via `error`. */
export function hiddenEdits(dir) {
  const lv = git(['ls-files', '-v', '-z'], dir);
  if (lv.status !== 0) return { error: `git ls-files -v failed: ${lv.err || `exit ${lv.status}`}`, paths: [] };
  const cand = [];
  for (const rec of lv.raw.split('\0')) {
    if (rec.length < 3) continue;
    const tag = rec[0];
    if (tag === 'S' || (tag >= 'a' && tag <= 'z')) cand.push({ p: rec.slice(2), skip: tag === 'S' || tag === 's' });
  }
  if (!cand.length) return { error: null, paths: [] };
  const ls = git(['ls-files', '-s', '-z'], dir);
  if (ls.status !== 0) return { error: `git ls-files -s failed: ${ls.err || `exit ${ls.status}`}`, paths: [] };
  const sha = new Map();
  for (const rec of ls.raw.split('\0')) {
    const m = /^\d+ ([0-9a-f]{40,64}) (\d)\t(.*)$/s.exec(rec);
    if (m && (m[2] === '0' || !sha.has(m[3]))) sha.set(m[3], m[1]);
  }
  const differ = [];
  const batch = [];
  for (const { p, skip } of cand) {
    let st;
    try { st = fs.lstatSync(path.join(dir, p)); } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'ENOTDIR') { if (!skip) differ.push(p); continue; }
      return { error: `cannot stat ${p}: ${e.code || e.message}`, paths: [] };
    }
    if (st.isSymbolicLink()) {
      const h = spawnSync('git', ['hash-object', '--stdin'], { cwd: dir, input: fs.readlinkSync(path.join(dir, p)), encoding: 'utf8' });
      if (h.status !== 0 || h.stdout.trim() !== sha.get(p)) differ.push(p);
    } else if (!st.isFile()) differ.push(p);
    else if (/[\n\r]/.test(p)) {
      const h = git(['hash-object', '--', p], dir);
      if (h.status !== 0 || h.out !== sha.get(p)) differ.push(p);
    } else batch.push(p);
  }
  if (batch.length) {
    const h = spawnSync('git', ['hash-object', '--stdin-paths'], { cwd: dir, input: batch.join('\n') + '\n', encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    const out = (h.stdout || '').split('\n').filter(Boolean);
    if (h.status !== 0 || out.length !== batch.length) return { error: `git hash-object failed: ${(h.stderr || '').trim() || `exit ${h.status}`}`, paths: [] };
    batch.forEach((p, i) => { if (out[i] !== sha.get(p)) differ.push(p); });
  }
  return { error: null, paths: differ };
}

function commonDirOf(cwd) {
  const r = git(['rev-parse', '--git-common-dir'], cwd);
  return r.status === 0 && r.out ? real(path.resolve(cwd, r.out)) : null;
}

/** Admin dirs (`<common>/worktrees/<id>`) whose `gitdir` file points at this worktree. Matched through the
 * file, so it works when the directory is missing; a relative gitdir is relative to the admin dir. */
function adminDirsOf(wt, common) {
  if (!common) return [];
  const base = path.join(common, 'worktrees');
  let names;
  try { names = fs.readdirSync(base); } catch { return []; }
  const want = new Set([path.resolve(wt.path), real(wt.path)]);
  const hits = [];
  for (const n of names) {
    const adm = path.join(base, n);
    let g;
    try { g = fs.readFileSync(path.join(adm, 'gitdir'), 'utf8').trim(); } catch { continue; }
    const dir = path.dirname(path.resolve(adm, g));
    if (want.has(dir) || want.has(real(dir))) hits.push(adm);
  }
  return hits;
}

/** The lock is a file in the admin dir; older git (< 2.31) omits `locked` from `worktree list --porcelain`. */
function isLockedOnDisk(wt, common) {
  return adminDirsOf(wt, common).some((adm) => fs.existsSync(path.join(adm, 'locked')));
}

const inside = (child, parent) => (child + path.sep).startsWith(parent + path.sep);

/** Everything that would be lost with the directory: tracked/untracked changes, edits hidden by skip-worktree or
 * assume-unchanged, ignored files, nested repos. Returns a refusal or null. Run again right before the delete. */
function contentChecks(wt) {
  const st = git(['status', '--porcelain', '-z', '--untracked-files=all', '--ignore-submodules=none'], wt.path);
  if (st.status !== 0) return { code: CODES.NOT_REPO, message: `git status failed: ${st.err}` };
  if (st.raw.replace(/\0/g, '').trim()) return { code: CODES.DIRTY, message: `has uncommitted or untracked changes (${st.raw.split('\0').filter(Boolean).length} paths)` };
  const hid = hiddenEdits(wt.path);
  if (hid.error) return { code: CODES.DIRTY, message: `cannot prove there are no hidden edits: ${hid.error}` };
  if (hid.paths.length) return { code: CODES.DIRTY, message: `has edits hidden from git status by skip-worktree/assume-unchanged: ${hid.paths.slice(0, 8).join(', ')}${hid.paths.length > 8 ? ', ...' : ''}` };
  const ig = ignoredFiles(wt.path);
  if (ig.error) return { code: CODES.IGNORED, message: `cannot prove nothing would be lost: ${ig.error}` };
  if (ig.nested.length) return { code: CODES.IGNORED, message: `contains nested git repositories or worktrees (their commits would be lost): ${ig.nested.slice(0, 8).join(', ')}` };
  if (ig.files.length) return { code: CODES.IGNORED, message: `has ignored files that would be lost: ${ig.files.slice(0, 8).join(', ')}${ig.files.length > 8 ? ', ...' : ''}`, files: ig.files };
  return null;
}

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
    {
      const ct = path.join(wt.path, '.claude', '.current-task');
      if (fs.existsSync(ct) && fs.readFileSync(ct, 'utf8').trim()) {
        return { code: CODES.ACTIVE_TASK, message: 'has a non-empty .claude/.current-task (another live task remains in this worktree); run task-complete for it first' };
      }
    }
    const bad = contentChecks(wt);
    if (bad) return bad;
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

function remove(wt, ctx) {
  const { main, gitVersion, base, common } = ctx;
  const linkFile = path.join(wt.path, '.git');
  const pre = git(['worktree', 'list', '--porcelain'], main);
  if (pre.status !== 0) return { code: CODES.REMOVE_FAILED, message: 'cannot snapshot git worktree list before removal; left untouched' };
  const beforePaths = parseWorktrees(pre.raw).map((w) => path.resolve(w.path));
  if (fs.existsSync(wt.path)) {
    if (real(wt.path) === real(main) || !fs.existsSync(linkFile) || !fs.statSync(linkFile).isFile()) {
      return { code: CODES.REMOVE_FAILED, message: 'refusing to delete: not a linked worktree directory' };
    }
    // the .git file must point into THIS repo's admin area (a relative gitdir is relative to the worktree)
    const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(linkFile, 'utf8'));
    if (!m || !common || !inside(real(path.resolve(wt.path, m[1].trim())), path.join(common, 'worktrees'))) {
      return { code: CODES.FOREIGN, message: 'refusing to delete: its .git file does not point into this repository' };
    }
    if (isLockedOnDisk(wt, common)) return { code: CODES.LOCKED, message: 'became locked; left untouched' };
    // shrink the check-then-delete window: re-run the content checks immediately before deleting
    const again = contentChecks(wt);
    if (again) return { code: again.code, message: `changed since the check, left untouched: ${again.message}` };
    if (gitAtLeast(gitVersion, 2, 17)) {
      const r = git(['worktree', 'remove', wt.path], main);
      if (r.status !== 0) return { code: CODES.REMOVE_FAILED, message: `git worktree remove failed: ${r.err}` };
    } else {
      try { fs.rmSync(wt.path, { recursive: true, force: true }); } catch (e) {
        return { code: CODES.REMOVE_FAILED, message: `rm failed: ${e.message}` };
      }
    }
  }
  // Drop only this worktree's own admin dir. Never a global `git worktree prune`: that would also delete the
  // admin dir of any other worktree whose directory is temporarily missing and orphan its commits.
  if (fs.existsSync(wt.path)) return { code: CODES.REMOVE_FAILED, message: 'worktree directory still exists after removal' };
  for (const adm of adminDirsOf(wt, common)) {
    if (!inside(real(adm), path.join(common, 'worktrees')) || real(adm) === path.join(common, 'worktrees')) continue;
    try { fs.rmSync(adm, { recursive: true, force: true }); } catch (e) {
      return { code: CODES.REMOVE_FAILED, message: `could not delete the worktree's admin dir ${adm}: ${e.message}` };
    }
  }
  const after = git(['worktree', 'list', '--porcelain'], main);
  if (after.status !== 0) return { code: CODES.REMOVE_FAILED, message: 'cannot verify removal: git worktree list failed' };
  const afterPaths = parseWorktrees(after.raw).map((w) => path.resolve(w.path));
  const want = new Set([path.resolve(wt.path), real(wt.path)]);
  if (afterPaths.some((q) => want.has(q) || want.has(real(q)))) {
    return { code: CODES.REMOVE_FAILED, message: 'worktree is still registered in git worktree list after removal' };
  }
  const lost = beforePaths.filter((q) => !want.has(q) && !want.has(real(q)) && !afterPaths.includes(q));
  if (lost.length) {
    return { code: CODES.REMOVE_FAILED, message: `another worktree disappeared from git worktree list during removal: ${lost.join(', ')}` };
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
  const ctx = { main, base, gitVersion, applying: opt.apply, cwd, common: commonDirOf(main), all };

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
