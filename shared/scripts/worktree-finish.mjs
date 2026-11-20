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
 *   ... --path <dir> --unregister-missing                        unregister (only) a record whose directory is gone
 *
 * The gate is the exit code, not a convention. A target is removed only when ALL hold:
 *   10  it is a linked worktree, not the main checkout
 *   15  it is not locked (`git worktree lock`)
 *   20  the directory belongs to this repository (its git common dir equals the main checkout's)
 *   22  no other worktree (or the main checkout) lies inside it
 *   23  exactly one worktree record and exactly one admin dir (<common>/worktrees/<id>, matched by its
 *       `gitdir` file) must claim the target's directory. Git < 2.20 lets `worktree add` reuse a path that is
 *       still registered but whose directory is missing, leaving two records for one directory: which one is
 *       "the" worktree is undecidable, so every mode refuses (--path never picks one with find(); the answer
 *       would depend on list order). remove() independently deletes only the admin dir named by the target's
 *       own `.git` file, and only after confirming that dir is the only match and its HEAD is the checked HEAD.
 *   24  its directory exists. A record whose directory is missing is SKIPped by --all-merged and refused by
 *       --path (the content checks cannot run and the admin dir's index, i.e. staged state, would be lost).
 *       `--path <dir> --unregister-missing` unregisters only that record (rule 23 still applies), keeps its
 *       branch, and reports "unregistered (directory missing)", never "removed".
 *   25  (--all-merged only) it is not brand new: SKIPped when the branch reflog
 *       (<common>/logs/refs/heads/<branch>) holds only "branch: Created from" entries (for a detached HEAD: the
 *       worktree's own HEAD reflog <admin>/logs/HEAD has at most one entry), i.e. a live session may be about to use it (a fresh branch
 *       off origin/<default> is trivially "merged"). Chosen over a time window because it needs no clock and
 *       works on git 2.15; a missing reflog counts as not fresh. Explicit --path is unaffected.
 *   26  `git status` itself failed (e.g. a corrupt index); the first stderr line is shown. Still refuses.
 *   11  it has no uncommitted or untracked changes (status is read with --untracked-files=all
 *       --ignore-submodules=none, so user config cannot hide anything), and no edit hidden from status
 *       by `git update-index --skip-worktree` / `--assume-unchanged`: `git ls-files -v` lists those
 *       files and each one is compared to the index: the on-disk size (and, with core.fileMode, the exec bit)
 *       against the index stat data from `git ls-files --debug`, then `git hash-object` against the index
 *       blob. The size check matters because a lossy clean filter can make an edited file hash like the index
 *       blob. A differing or deleted one refuses. A skip-worktree file that is simply absent (sparse checkout)
 *       is fine.
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
 * Other codes: 0 ok / removed / unregistered, 2 usage, 3 not a git repo, 17 removal failed or could not be verified,
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
  FOREIGN: 20, ACTIVE_TASK: 21, NESTED_WORKTREE: 22, AMBIGUOUS: 23, MISSING_DIR: 24, FRESH: 25, STATUS_FAILED: 26,
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

const real = (p) => {
  try { return fs.realpathSync(p); } catch { /* missing: resolve through the parent so /tmp and /private/tmp compare equal */ }
  const abs = path.resolve(p);
  const parent = path.dirname(abs);
  if (parent === abs) return abs;
  return path.join(real(parent), path.basename(abs));
};

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
  // --debug adds the index stat data (size) after each record: "<mode> <sha> <stage>\t<path>\0  ctime..\n  mtime..\n  dev..\n  uid..\n  size: N\tflags: F\n"
  const ls = git(['ls-files', '-s', '--debug', '-z'], dir);
  if (ls.status !== 0) return { error: `git ls-files -s --debug failed: ${ls.err || `exit ${ls.status}`}`, paths: [] };
  const sha = new Map();
  const meta = new Map();
  const recRe = /(\d+) ([0-9a-f]{40,64}) (\d)\t([^\0]*)\0 +ctime:[^\n]*\n +mtime:[^\n]*\n +dev:[^\n]*\n +uid:[^\n]*\n +size: (\d+)\tflags: [0-9a-f]+\n/g;
  let rm;
  while ((rm = recRe.exec(ls.raw)) !== null) {
    if (rm[3] === '0' || !sha.has(rm[4])) { sha.set(rm[4], rm[2]); meta.set(rm[4], { mode: rm[1], size: Number(rm[5]) }); }
  }
  const fileMode = git(['config', '--bool', 'core.fileMode'], dir).out !== 'false';
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
    else if (!meta.has(p) || meta.get(p).mode === '120000') differ.push(p); // cannot compare, or a symlink replaced by a regular file: fail closed
    else if (st.size !== meta.get(p).size || (fileMode && /^100[67]/.test(meta.get(p).mode) && ((st.mode & 0o111) !== 0) !== (meta.get(p).mode === '100755'))) {
      // size or exec bit differs from the index stat data. Checked before the hash because a lossy clean filter
      // can make an edited file hash like the index blob while the edit is still on disk only.
      differ.push(p);
    } else if (/[\n\r]/.test(p)) {
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

/** The admin dir named by the target's own `.git` file, or the single gitdir-file match when the directory is
 * missing; verified to be a direct child of <common>/worktrees, the only match, and to have HEAD == the checked HEAD. */
function ownAdminDir(wt, common) {
  if (!common) return { error: 'git common dir unknown' };
  const root = path.join(common, 'worktrees');
  const matches = adminDirsOf(wt, common).map((a) => real(a));
  let adm;
  const linkFile = path.join(wt.path, '.git');
  if (fs.existsSync(wt.path)) {
    let m = null;
    try { m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(linkFile, 'utf8')); } catch { /* handled below */ }
    if (!m) return { error: 'its .git file does not name an admin dir' };
    adm = real(path.resolve(wt.path, m[1].trim()));
  } else {
    if (matches.length !== 1) return { error: `${matches.length} admin dirs claim this path, expected exactly 1` };
    adm = matches[0];
  }
  if (path.dirname(adm) !== root) return { error: 'its admin dir is not a direct child of this repository\'s worktrees/ dir' };
  if (matches.length !== 1 || matches[0] !== adm) return { error: `${matches.length} admin dirs claim this path (or not the one its .git file names), expected exactly 1` };
  let head;
  try { head = fs.readFileSync(path.join(adm, 'HEAD'), 'utf8').trim(); } catch (e) { return { error: `cannot read admin HEAD: ${e.code || e.message}` }; }
  const ref = /^ref:\s*(.+)$/.exec(head);
  if (ref) { const r = git(['rev-parse', '--verify', '-q', ref[1]], common); head = r.status === 0 ? r.out : null; }
  if (!head || !wt.head || head !== wt.head) return { error: `its admin dir's HEAD (${head ? head.slice(0, 8) : 'unresolved'}) is not the checked HEAD (${wt.head ? wt.head.slice(0, 8) : 'none'})` };
  return { adm };
}

/** A brand-new worktree of a live session has nothing but its creation in the reflog: for a branch, every entry of
 * <common>/logs/refs/heads/<branch> is "branch: Created from ..."; for a detached HEAD, the worktree's own reflog
 * (<admin>/logs/HEAD) has at most one entry. A missing reflog counts as not fresh (core.logAllRefUpdates=false). */
function isFreshWorktree(wt, common) {
  const lines = (f) => { try { return fs.readFileSync(f, 'utf8').split('\n').filter(Boolean); } catch { return null; } };
  const creation = (l) => /\tbranch: Created from/.test(l);
  if (wt.branch) {
    // the branch reflog is the reliable signal across git versions: every entry is a creation, no commit/checkout/reset
    const bl = lines(path.join(common, 'logs', 'refs', 'heads', ...wt.branch.split('/')));
    return !!bl && bl.length > 0 && bl.every(creation);
  }
  const adm = adminDirsOf(wt, common)[0];
  const hl = adm ? lines(path.join(adm, 'logs', 'HEAD')) : null;
  return !!hl && hl.length <= 1;
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
  if (st.status !== 0) return { code: CODES.STATUS_FAILED, message: `git status failed: ${(st.err.split('\n')[0] || `exit ${st.status}`)}` };
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
  {
    // Git < 2.20 lets `worktree add` reuse a registered path whose directory is gone, leaving two records (and two
    // admin dirs) for one directory. Which one is "the" worktree is then undecidable: refuse, in every mode.
    const me0 = real(wt.path);
    const dups = (all || []).filter((o) => o.path && real(o.path) === me0);
    if (dups.length > 1) return { code: CODES.AMBIGUOUS, message: `${dups.length} worktree records point at this directory (a stale registration was reused); resolve with \`git worktree prune\` after checking each one by hand` };
    const n = adminDirsOf(wt, common).length;
    if (n !== 1) return { code: CODES.AMBIGUOUS, message: `${n} worktree admin dirs claim this directory, expected exactly 1; refusing to guess` };
  }
  if (wt.locked || isLockedOnDisk(wt, common)) return { code: CODES.LOCKED, message: 'is locked (git worktree lock); unlock it deliberately first' };
  const exists = fs.existsSync(wt.path);
  if (!exists) {
    // Content checks cannot run, and the admin dir holds the index (staged state) that would be lost.
    if (ctx.allMode) return { code: CODES.MISSING_DIR, message: 'its directory is missing (staged state in its admin dir would be lost); not touched in --all-merged. Use --path <dir> --unregister-missing for a deliberate unregister' };
    if (!ctx.unregisterMissing) return { code: CODES.MISSING_DIR, message: 'its directory is missing; moving it back would restore it, unregistering loses its staged state. Pass --unregister-missing to unregister only this record' };
  }
  if (exists && ctx.allMode && isFreshWorktree(wt, common)) {
    return { code: CODES.FRESH, message: 'looks brand new (its reflog shows only its creation); a live session may be about to use it' };
  }
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
  if (!exists) return { code: CODES.OK, message: 'would unregister (directory missing); branch kept' };
  return { code: CODES.OK, message: 'removable' };
}

export function remove(wt, ctx) {
  const { main, gitVersion, base, common } = ctx;
  const linkFile = path.join(wt.path, '.git');
  const pre = git(['worktree', 'list', '--porcelain'], main);
  if (pre.status !== 0) return { code: CODES.REMOVE_FAILED, message: 'cannot snapshot git worktree list before removal; left untouched' };
  const beforePaths = parseWorktrees(pre.raw).map((w) => path.resolve(w.path));
  const existed = fs.existsSync(wt.path);
  if (existed) {
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
  } else if (!ctx.unregisterMissing) {
    return { code: CODES.MISSING_DIR, message: 'directory is missing; left untouched (pass --unregister-missing)' };
  }
  // Decide the one admin dir to delete BEFORE touching anything: the one the target's own .git file names, the only
  // match, whose HEAD is the checked HEAD. Never "every dir whose gitdir file matches the path".
  const own = ownAdminDir(wt, common);
  if (own.error) return { code: CODES.AMBIGUOUS, message: `refusing to delete, left untouched: ${own.error}` };
  if (existed) {
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
  if (fs.existsSync(own.adm)) {
    try { fs.rmSync(own.adm, { recursive: true, force: true }); } catch (e) {
      return { code: CODES.REMOVE_FAILED, message: `could not delete the worktree's admin dir ${own.adm}: ${e.message}` };
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
  if (!existed) {
    return { code: CODES.OK, verb: 'UNREGISTERED', message: `unregistered (directory missing)${wt.branch ? `; branch ${wt.branch} kept` : ''}` };
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
  const opt = { apply: false, all: false, fetch: true, path: null, unregisterMissing: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') opt.apply = true;
    else if (a === '--all-merged') opt.all = true;
    else if (a === '--no-fetch') opt.fetch = false;
    else if (a === '--unregister-missing') opt.unregisterMissing = true;
    else if (a === '--path') opt.path = argv[++i];
    else { log(`usage: worktree-finish.mjs [--path <dir> | --all-merged] [--apply] [--no-fetch] [--unregister-missing]  (unknown: ${a})`); return CODES.USAGE; }
  }
  if (opt.all && opt.unregisterMissing) { log('usage: --unregister-missing needs --path and cannot be combined with --all-merged'); return CODES.USAGE; }
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
  const ctx = { main, base, gitVersion, applying: opt.apply, cwd, common: commonDirOf(main), all, allMode: opt.all, unregisterMissing: opt.unregisterMissing };

  let targets;
  if (opt.all) targets = all.slice(1).filter((w) => !w.bare);
  else {
    const want = real(opt.path || top.out);
    const hits = all.filter((w) => real(w.path) === want);
    if (!hits.length) { log(`${want} is not a worktree of this repository`); return CODES.NOT_WORKTREE; }
    // never pick one of several records by position: the answer would depend on list order
    if (hits.length > 1) { log(`REFUSED ${want}: ${hits.length} worktree records point at this directory (a stale registration was reused); resolve by hand`); return CODES.AMBIGUOUS; }
    if (opt.unregisterMissing && fs.existsSync(hits[0].path)) { log('usage: directory exists; --unregister-missing only applies to a missing directory'); return CODES.USAGE; }
    targets = [hits[0]];
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
    if (r.code !== CODES.OK) { failed = true; log(`FAILED ${tag}: ${r.message}`); } else log(`${r.verb || 'REMOVED'} ${tag}: ${r.message}`);
  }
  if (opt.all) return failed ? CODES.REMOVE_FAILED : CODES.OK;
  return lastCode;
}

if (process.argv[1] && real(process.argv[1]) === real(new URL(import.meta.url).pathname)) {
  process.exit(run(process.argv.slice(2)));
}
