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
import { isAllowedIgnored, parseWorktrees, gitAtLeast, CODES } from './worktree-finish.mjs';

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
