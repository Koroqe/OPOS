/** node --test shared/scripts/worktree-finish.test.mjs
 *
 * End-to-end: each test builds a throwaway origin + clone + linked worktrees with real git and
 * spawns the script. Works on git 2.15 (no `worktree remove`, no `branch --show-current`).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as WF from './worktree-finish.mjs';
const { isAllowedIgnored, parseWorktrees, gitAtLeast, CODES } = WF;

const SCRIPT = path.resolve(import.meta.dirname, 'worktree-finish.mjs');
const ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };

const g = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: ENV });
  assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
};
const commit = (cwd, file, text = 'x') => { fs.writeFileSync(path.join(cwd, file), text); g(cwd, 'add', file); g(cwd, 'commit', '-q', '-m', file); };

/** origin (bare, default branch main) + main checkout `repo`. */
function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'wtf-')));
  const origin = path.join(root, 'origin.git');
  const seed = path.join(root, 'seed');
  const repo = path.join(root, 'repo');
  fs.mkdirSync(origin); g(origin, 'init', '-q', '--bare');
  fs.mkdirSync(seed); g(seed, 'init', '-q'); g(seed, 'checkout', '-q', '-b', 'main');
  commit(seed, 'a.txt'); g(seed, 'remote', 'add', 'origin', origin); g(seed, 'push', '-q', 'origin', 'main');
  g(origin, 'symbolic-ref', 'HEAD', 'refs/heads/main');
  g(root, 'clone', '-q', origin, repo);
  const addWt = (name, { merged = false } = {}) => {
    const dir = path.join(root, name);
    g(repo, 'worktree', 'add', '-b', name, dir, 'origin/main');
    commit(dir, `${name}.txt`);
    if (merged) g(dir, 'push', '-q', 'origin', `${name}:main`);
    return dir;
  };
  const finish = (args, cwd = repo) => spawnSync('node', [SCRIPT, ...args], { cwd, encoding: 'utf8', env: ENV });
  return { root, origin, repo, addWt, finish, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}
const branchExists = (repo, b) => spawnSync('git', ['rev-parse', '--verify', '-q', `refs/heads/${b}`], { cwd: repo }).status === 0;

test('pure helpers', () => {
  assert.ok(isAllowedIgnored('.claude/.clone-id'));
  assert.ok(isAllowedIgnored('.claude/skills/lease/.state/'));
  assert.ok(isAllowedIgnored('sub/.DS_Store'));
  assert.ok(isAllowedIgnored('web/node_modules/'));
  for (const f of ['.claude/.sessions/abc.ctx', '.claude/.opos-update-check', '.claude/.opos-update-state.json',
    '.claude/.opos-update.lock', '.claude/.last-update-check', '.claude/.update-probe', 'x/__pycache__/a.pyc']) {
    assert.ok(isAllowedIgnored(f), f);
  }
  assert.ok(!isAllowedIgnored('.claude/scratchpad.md'));
  assert.ok(!isAllowedIgnored('.claude/settings.local.json'));
  assert.ok(!isAllowedIgnored('.env'));
  assert.ok(!isAllowedIgnored('out/report.pdf'));
  assert.ok(gitAtLeast('git version 2.17.0', 2, 17));
  assert.ok(!gitAtLeast('git version 2.15.0', 2, 17));
  assert.ok(gitAtLeast('git version 2.39.1', 2, 17));
  const w = parseWorktrees('worktree /a\nHEAD abc\nbranch refs/heads/main\n\nworktree /b\nHEAD def\nbranch refs/heads/x\nlocked reason\n');
  assert.equal(w.length, 2);
  assert.equal(w[1].branch, 'x');
  assert.equal(w[1].locked, true);
});

test('dry run reports OK and removes nothing; --apply removes worktree and branch', () => {
  const f = fixture();
  try {
    const wt = f.addWt('feat-a', { merged: true });
    const dry = f.finish(['--path', wt]);
    assert.equal(dry.status, 0, dry.stdout + dry.stderr);
    assert.match(dry.stdout, /^OK /);
    assert.ok(fs.existsSync(wt));
    const ap = f.finish(['--path', wt, '--apply']);
    assert.equal(ap.status, 0, ap.stdout + ap.stderr);
    assert.match(ap.stdout, /REMOVED/);
    assert.ok(!fs.existsSync(wt));
    assert.ok(!branchExists(f.repo, 'feat-a'));
    assert.ok(!g(f.repo, 'worktree', 'list').includes('feat-a'));
  } finally { f.cleanup(); }
});

test('removal works when the main checkout sits on another branch (branch -d would refuse)', () => {
  const f = fixture();
  try {
    g(f.repo, 'checkout', '-q', '-b', 'other');
    commit(f.repo, 'other.txt');
    const wt = f.addWt('feat-b', { merged: true });
    const ap = f.finish(['--path', wt, '--apply']);
    assert.equal(ap.status, 0, ap.stdout + ap.stderr);
    assert.ok(!branchExists(f.repo, 'feat-b'));
    assert.ok(branchExists(f.repo, 'other'), 'unrelated branch untouched');
  } finally { f.cleanup(); }
});

test('refuses the main checkout (10)', () => {
  const f = fixture();
  try {
    const r = f.finish(['--path', f.repo, '--apply']);
    assert.equal(r.status, CODES.MAIN);
    assert.ok(fs.existsSync(f.repo));
  } finally { f.cleanup(); }
});

test('refuses unmerged HEAD (13) and keeps worktree and branch', () => {
  const f = fixture();
  try {
    const wt = f.addWt('feat-c');
    const r = f.finish(['--path', wt, '--apply']);
    assert.equal(r.status, CODES.NOT_MERGED, r.stdout);
    assert.ok(fs.existsSync(wt));
    assert.ok(branchExists(f.repo, 'feat-c'));
  } finally { f.cleanup(); }
});

test('refuses uncommitted (11) and untracked changes', () => {
  const f = fixture();
  try {
    const wt = f.addWt('feat-d', { merged: true });
    fs.writeFileSync(path.join(wt, 'new.txt'), 'untracked');
    assert.equal(f.finish(['--path', wt, '--apply']).status, CODES.DIRTY);
    fs.unlinkSync(path.join(wt, 'new.txt'));
    fs.appendFileSync(path.join(wt, 'feat-d.txt'), 'more');
    assert.equal(f.finish(['--path', wt, '--apply']).status, CODES.DIRTY);
    assert.ok(fs.existsSync(wt));
  } finally { f.cleanup(); }
});

test('refuses unknown ignored files (12), lists them; allows OPOS local state', () => {
  const f = fixture();
  try {
    const wt = f.addWt('feat-e', { merged: true });
    fs.writeFileSync(path.join(wt, '.gitignore'), '.env\n.claude/.clone-id\n.DS_Store\nnode_modules/\n');
    g(wt, 'add', '.gitignore'); g(wt, 'commit', '-q', '-m', 'ignore'); g(wt, 'push', '-q', 'origin', 'feat-e:main');
    fs.mkdirSync(path.join(wt, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(wt, '.claude', '.clone-id'), 'id');
    fs.writeFileSync(path.join(wt, '.DS_Store'), '');
    fs.mkdirSync(path.join(wt, 'node_modules'));
    fs.writeFileSync(path.join(wt, 'node_modules', 'x.js'), '');
    assert.equal(f.finish(['--path', wt]).status, 0, 'allowed ignored state does not block');
    fs.writeFileSync(path.join(wt, '.env'), 'SECRET=1');
    const r = f.finish(['--path', wt, '--apply']);
    assert.equal(r.status, CODES.IGNORED);
    assert.match(r.stdout, /\.env/);
    assert.ok(fs.existsSync(path.join(wt, '.env')));
  } finally { f.cleanup(); }
});

test('refuses when leases are held (14)', () => {
  const f = fixture();
  try {
    const wt = f.addWt('feat-f', { merged: true });
    fs.writeFileSync(path.join(wt, '.gitignore'), '.claude/skills/lease/.state/\n');
    g(wt, 'add', '.gitignore'); g(wt, 'commit', '-q', '-m', 'ignore'); g(wt, 'push', '-q', 'origin', 'feat-f:main');
    const held = path.join(wt, '.claude', 'skills', 'lease', '.state', 'held');
    fs.mkdirSync(held, { recursive: true });
    fs.writeFileSync(path.join(held, 'abc.json'), '{}');
    assert.equal(f.finish(['--path', wt, '--apply']).status, CODES.LEASES);
    fs.unlinkSync(path.join(held, 'abc.json'));
    assert.equal(f.finish(['--path', wt]).status, 0);
  } finally { f.cleanup(); }
});

test('refuses a locked worktree (15)', () => {
  const f = fixture();
  try {
    const wt = f.addWt('feat-g', { merged: true });
    g(f.repo, 'worktree', 'lock', wt);
    assert.equal(f.finish(['--path', wt, '--apply']).status, CODES.LOCKED);
    assert.ok(fs.existsSync(wt));
  } finally { f.cleanup(); }
});

test('--apply from inside the worktree refuses (16); dry run is OK and prints the command', () => {
  const f = fixture();
  try {
    const wt = f.addWt('feat-h', { merged: true });
    const dry = f.finish([], wt);
    assert.equal(dry.status, 0, dry.stdout + dry.stderr);
    assert.match(dry.stdout, /run from outside it/);
    const ap = f.finish(['--apply'], wt);
    assert.equal(ap.status, CODES.CWD, ap.stdout);
    assert.match(ap.stdout, /cd .* && node/);
    assert.ok(fs.existsSync(wt));
    const sub = path.join(wt, 'deep'); fs.mkdirSync(sub);
    assert.equal(f.finish(['--apply'], sub).status, CODES.CWD);
  } finally { f.cleanup(); }
});

test('--path pointing outside the repo (19) and outside git (3)', () => {
  const f = fixture();
  try {
    assert.equal(f.finish(['--path', os.tmpdir()]).status, CODES.NOT_WORKTREE);
    assert.equal(f.finish([], os.tmpdir()).status, CODES.NOT_REPO);
    assert.equal(f.finish(['--bogus']).status, CODES.USAGE);
    assert.equal(f.finish(['--all-merged', '--path', f.repo]).status, CODES.USAGE);
  } finally { f.cleanup(); }
});

test('--all-merged: dry run lists, --apply removes only the eligible, skips the rest, never touches remote branches', () => {
  const f = fixture();
  try {
    const a = f.addWt('m-one', { merged: true });
    const b = f.addWt('m-two', { merged: true });
    const c = f.addWt('unmerged');
    const d = f.addWt('dirty', { merged: true });
    fs.writeFileSync(path.join(d, 'junk.txt'), 'x');
    g(a, 'push', '-q', 'origin', 'm-one'); // a remote branch of the same name
    const dry = f.finish(['--all-merged']);
    assert.equal(dry.status, 0, dry.stdout);
    assert.equal((dry.stdout.match(/^OK /gm) || []).length, 2);
    assert.equal((dry.stdout.match(/^SKIP /gm) || []).length, 2);
    assert.ok(fs.existsSync(a) && fs.existsSync(b));
    const ap = f.finish(['--all-merged', '--apply']);
    assert.equal(ap.status, 0, ap.stdout);
    assert.ok(!fs.existsSync(a) && !fs.existsSync(b));
    assert.ok(fs.existsSync(c) && fs.existsSync(d));
    assert.ok(!branchExists(f.repo, 'm-one') && branchExists(f.repo, 'unmerged') && branchExists(f.repo, 'dirty'));
    assert.match(g(f.origin, 'branch', '--list', 'm-one'), /m-one/, 'remote branch kept');
  } finally { f.cleanup(); }
});

test('default branch is detected, not hardcoded', () => {
  const f = fixture();
  try {
    g(f.origin, 'branch', '-m', 'main', 'trunk');
    g(f.origin, 'symbolic-ref', 'HEAD', 'refs/heads/trunk');
    g(f.repo, 'fetch', '-q', 'origin');
    g(f.repo, 'remote', 'set-head', 'origin', '-a');
    const wt = path.join(f.root, 'feat-t');
    g(f.repo, 'worktree', 'add', '-b', 'feat-t', wt, 'origin/trunk');
    commit(wt, 't.txt'); g(wt, 'push', '-q', 'origin', 'feat-t:trunk');
    const r = f.finish(['--path', wt, '--apply']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(!fs.existsSync(wt));
  } finally { f.cleanup(); }
});

// ---- regression tests for the PR #68 review (each reproduces a data loss of the first version) ----

/** a merged worktree whose committed .gitignore ignores `rules`. */
function ignoringWt(f, name, rules) {
  const wt = f.addWt(name, { merged: true });
  fs.writeFileSync(path.join(wt, '.gitignore'), rules.join('\n') + '\n');
  g(wt, 'add', '.gitignore'); g(wt, 'commit', '-q', '-m', 'ignore'); g(wt, 'push', '-q', 'origin', `${name}:main`);
  return wt;
}

test('BLOCKER 1: status.showUntrackedFiles=no cannot hide an untracked file (11)', () => {
  const f = fixture();
  try {
    const wt = f.addWt('feat-u', { merged: true });
    g(f.repo, 'config', 'status.showUntrackedFiles', 'no');
    fs.writeFileSync(path.join(wt, 'precious.txt'), 'only copy');
    const r = f.finish(['--path', wt, '--apply']);
    assert.equal(r.status, CODES.DIRTY, r.stdout);
    assert.ok(fs.existsSync(path.join(wt, 'precious.txt')));
  } finally { f.cleanup(); }
});

test('BLOCKER 2A: an ignored nested repo with a local-only commit is not deleted (12)', () => {
  const f = fixture();
  try {
    const wt = ignoringWt(f, 'feat-v', ['vendor/']);
    const lib = path.join(wt, 'vendor', 'lib');
    fs.mkdirSync(lib, { recursive: true }); g(lib, 'init', '-q'); commit(lib, 'secret.txt', 'local only');
    const r = f.finish(['--path', wt, '--apply']);
    assert.equal(r.status, CODES.IGNORED, r.stdout);
    assert.ok(fs.existsSync(path.join(lib, 'secret.txt')));
    assert.ok(fs.existsSync(wt));
  } finally { f.cleanup(); }
});

test('BLOCKER 2B: another worktree inside an ignored dir of the target blocks removal (22)', () => {
  const f = fixture();
  try {
    const wt = ignoringWt(f, 'feat-w', ['.claude/worktrees/']);
    const inner = path.join(wt, '.claude', 'worktrees', 'inner');
    fs.mkdirSync(path.dirname(inner), { recursive: true });
    g(f.repo, 'worktree', 'add', '-b', 'inner', inner, 'origin/main');
    fs.writeFileSync(path.join(inner, 'wip.txt'), 'uncommitted work');
    const r = f.finish(['--path', wt, '--apply']);
    assert.equal(r.status, CODES.NESTED_WORKTREE, r.stdout);
    assert.ok(fs.existsSync(path.join(inner, 'wip.txt')));
    assert.ok(fs.existsSync(wt));
  } finally { f.cleanup(); }
});

test('BLOCKER 2: an unlisted ignored directory is refused and listed, not assumed empty (12)', () => {
  const f = fixture();
  try {
    const wt = ignoringWt(f, 'feat-x', ['out/']);
    fs.mkdirSync(path.join(wt, 'out')); fs.writeFileSync(path.join(wt, 'out', 'report.pdf'), 'x');
    const r = f.finish(['--path', wt, '--apply']);
    assert.equal(r.status, CODES.IGNORED, r.stdout);
    assert.match(r.stdout, /out\/report\.pdf/);
  } finally { f.cleanup(); }
});

test('WARNING 3: update-ref fallback only for "not fully merged"; a branch checked out elsewhere is kept (17)', () => {
  const f = fixture();
  try {
    const wt = f.addWt('feat-y', { merged: true });
    const twin = path.join(f.root, 'twin');
    g(f.repo, 'worktree', 'add', '-f', twin, 'feat-y'); // same branch checked out in a second worktree
    g(f.repo, 'checkout', '-q', '-b', 'other');
    const r = f.finish(['--path', wt, '--apply']);
    assert.equal(r.status, CODES.REMOVE_FAILED, r.stdout);
    assert.match(r.stdout, /branch feat-y kept/);
    assert.ok(branchExists(f.repo, 'feat-y'), 'branch still checked out in the twin must survive');
  } finally { f.cleanup(); }
});

test('WARNING 3: a lock is found on disk even when the worktree directory is missing (15)', () => {
  const f = fixture();
  try {
    const wt = f.addWt('feat-z', { merged: true });
    g(f.repo, 'worktree', 'lock', wt);
    fs.rmSync(wt, { recursive: true, force: true });
    const r = f.finish(['--path', wt, '--apply']);
    assert.equal(r.status, CODES.LOCKED, r.stdout);
    assert.ok(branchExists(f.repo, 'feat-z'));
    assert.match(g(f.repo, 'worktree', 'list'), /feat-z/, 'registration kept');
  } finally { f.cleanup(); }
});

test('WARNING 3: a worktree whose directory is gone is pruned and its branch deleted; verified, not assumed', () => {
  const f = fixture();
  try {
    const wt = f.addWt('feat-m', { merged: true });
    fs.rmSync(wt, { recursive: true, force: true });
    const r = f.finish(['--path', wt, '--apply']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /REMOVED/);
    assert.ok(!g(f.repo, 'worktree', 'list').includes('feat-m'));
    assert.ok(!branchExists(f.repo, 'feat-m'));
  } finally { f.cleanup(); }
});

test('WARNING 4: a directory that is a worktree of ANOTHER repo is never deleted (20)', () => {
  const f = fixture();
  try {
    const wt = f.addWt('feat-o', { merged: true });
    const repo2 = path.join(f.root, 'repo2');
    g(f.root, 'clone', '-q', f.origin, repo2);
    const other = path.join(f.root, 'other-wt');
    g(repo2, 'worktree', 'add', '-b', 'theirs', other, 'origin/main');
    fs.rmSync(wt, { recursive: true, force: true });
    fs.renameSync(other, wt); // same path, different repo
    const r = f.finish(['--path', wt, '--apply']);
    assert.equal(r.status, CODES.FOREIGN, r.stdout);
    assert.ok(fs.existsSync(path.join(wt, 'a.txt')));
  } finally { f.cleanup(); }
});

test('WARNING 5: ignoredFiles fails closed when git cannot enumerate', () => {
  const r = WF.ignoredFiles(os.tmpdir());
  assert.ok(r.error, 'a non-zero git exit must be an error, never an empty list');
});

test('WARNING 6: real OPOS session state does not block; scratchpad and settings.local.json do (12)', () => {
  const f = fixture();
  try {
    const wt = ignoringWt(f, 'feat-s', ['.claude/.sessions/', '.claude/.opos-update-check', '.claude/.opos-update-state.json',
      '.claude/.opos-update.lock', '.claude/.last-update-check', '.claude/.update-probe', '.claude/scratchpad.md', '.claude/settings.local.json']);
    const c = path.join(wt, '.claude');
    fs.mkdirSync(path.join(c, '.sessions'), { recursive: true });
    for (const n of ['.sessions/s1.ctx', '.opos-update-check', '.opos-update-state.json', '.opos-update.lock', '.last-update-check', '.update-probe']) {
      fs.writeFileSync(path.join(c, n), 'x');
    }
    assert.equal(f.finish(['--path', wt]).status, 0, 'framework state is safe to lose');
    fs.writeFileSync(path.join(c, 'scratchpad.md'), 'notes');
    const r = f.finish(['--path', wt, '--apply']);
    assert.equal(r.status, CODES.IGNORED);
    assert.match(r.stdout, /scratchpad\.md/);
    fs.unlinkSync(path.join(c, 'scratchpad.md'));
    fs.writeFileSync(path.join(c, 'settings.local.json'), '{}');
    assert.equal(f.finish(['--path', wt, '--apply']).status, CODES.IGNORED);
  } finally { f.cleanup(); }
});

test('INFO 9: a local branch named origin/main cannot fake the merge proof (13)', () => {
  const f = fixture();
  try {
    const wt = f.addWt('feat-q'); // not merged
    g(f.repo, 'branch', 'origin/main', 'feat-q');
    const r = f.finish(['--path', wt, '--apply']);
    assert.equal(r.status, CODES.NOT_MERGED, r.stdout);
    assert.ok(fs.existsSync(wt));
  } finally { f.cleanup(); }
});

test('INFO 10: a relative gitdir in the worktree is resolved against the worktree, not the cwd (lock found, 15)', () => {
  const f = fixture();
  try {
    const wt = f.addWt('feat-r', { merged: true });
    g(f.repo, 'worktree', 'lock', wt);
    const admin = fs.readFileSync(path.join(wt, '.git'), 'utf8').replace(/^gitdir:\s*/, '').trim();
    fs.writeFileSync(path.join(wt, '.git'), `gitdir: ${path.relative(wt, admin)}\n`);
    const sub = path.join(f.repo, 'sub'); fs.mkdirSync(sub);
    const r = f.finish(['--path', wt, '--apply'], sub);
    assert.equal(r.status, CODES.LOCKED, r.stdout);
    assert.ok(fs.existsSync(wt));
    // and removal accepts a relative gitdir once unlocked
    g(f.repo, 'worktree', 'unlock', wt);
    const ok = f.finish(['--path', wt, '--apply'], sub);
    assert.equal(ok.status, 0, ok.stdout);
    assert.ok(!fs.existsSync(wt));
  } finally { f.cleanup(); }
});

test('INFO 11: --all-merged skips a worktree with a non-empty .current-task (21); a single --path does not', () => {
  const f = fixture();
  try {
    const live = ignoringWt(f, 'live', ['.claude/.current-task']);
    fs.mkdirSync(path.join(live, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(live, '.claude', '.current-task'), '123\n');
    const r = f.finish(['--all-merged', '--apply']);
    assert.equal(r.status, 0, r.stdout);
    assert.match(r.stdout, /SKIP .*live.*current-task/);
    assert.ok(fs.existsSync(live));
    // emptied (what task-complete step 14 leaves behind) -> removable
    fs.writeFileSync(path.join(live, '.claude', '.current-task'), '');
    assert.equal(f.finish(['--all-merged', '--apply']).status, 0);
    assert.ok(!fs.existsSync(live));
    // the single-target own-worktree path does not apply the check
    const own = ignoringWt(f, 'own', ['.claude/.current-task', '# own']);
    fs.mkdirSync(path.join(own, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(own, '.claude', '.current-task'), '456\n');
    assert.equal(f.finish(['--path', own]).status, 0);
  } finally { f.cleanup(); }
});

test('INFO 8: one target that throws is reported as SKIP and --all-merged carries on', () => {
  const f = fixture();
  try {
    const bad = ignoringWt(f, 'a-bad', ['.claude/.current-task']);
    fs.mkdirSync(path.join(bad, '.claude', '.current-task'), { recursive: true }); // reading it as a file throws EISDIR
    const good = f.addWt('z-good', { merged: true });
    const r = f.finish(['--all-merged', '--apply']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /SKIP .*a-bad.*unexpected error/);
    assert.ok(fs.existsSync(bad));
    assert.ok(!fs.existsSync(good), 'the run continued past the bad target');
  } finally { f.cleanup(); }
});

test('INFO 12: fetch failure is exit 18 and removes nothing; --no-fetch skips the fetch', () => {
  const f = fixture();
  try {
    const wt = f.addWt('feat-n', { merged: true });
    g(f.repo, 'remote', 'set-url', 'origin', path.join(f.root, 'does-not-exist.git'));
    const r = f.finish(['--path', wt, '--apply']);
    assert.equal(r.status, CODES.NO_BASE, r.stdout);
    assert.ok(fs.existsSync(wt));
    assert.equal(f.finish(['--path', wt, '--no-fetch']).status, 0);
  } finally { f.cleanup(); }
});

test('INFO 12: a detached-HEAD worktree is removed without touching any branch', () => {
  const f = fixture();
  try {
    const wt = f.addWt('feat-d2', { merged: true });
    g(wt, 'checkout', '-q', '--detach');
    const r = f.finish(['--path', wt, '--apply']);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(!fs.existsSync(wt));
    assert.ok(branchExists(f.repo, 'feat-d2'), 'no branch is associated with a detached worktree, so none is deleted');
  } finally { f.cleanup(); }
});
