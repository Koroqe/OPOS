/** node --test .claude/skills/check-for-updates/check.test.mjs
 *
 * Pure-logic unit tests for the manual on-demand update probe, plus end-to-end spawns against a
 * real local git "upstream" clone (no network mocking needed — `_src_path` pointed at a local
 * path is one of the shapes the skill itself documents) and, on non-Windows only, a shimmed `gh`
 * for the remote-classification path (Windows cannot spawn an extensionless PATH shim without a
 * shell, so that one variant is skipped there and covered instead by the pure
 * `classifySrcPath`/`pickLatestRelease` tests, which exercise the exact same logic).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  parseSemver,
  compareSemver,
  isNewer,
  rawSrcPath,
  classifySrcPath,
  pickLatestRelease,
  cacheIsFresh,
} from './check.mjs';

const SCRIPT = path.resolve(import.meta.dirname, 'check.mjs');

// ------------------------------------------------------------------ semver

test('parseSemver: v-prefix is optional, prerelease is captured', () => {
  assert.deepEqual(parseSemver('v1.2.3'), { major: 1, minor: 2, patch: 3, prerelease: null });
  assert.deepEqual(parseSemver('1.2.3'), { major: 1, minor: 2, patch: 3, prerelease: null });
  assert.deepEqual(parseSemver('v1.2.3-rc1'), { major: 1, minor: 2, patch: 3, prerelease: 'rc1' });
  assert.equal(parseSemver('not-a-version'), null);
  assert.equal(parseSemver(''), null);
  assert.equal(parseSemver(undefined), null);
});

test('compareSemver: numeric compare, not lexical — 0.18.10 > 0.18.9', () => {
  assert.equal(compareSemver('v0.18.10', 'v0.18.9'), 1);
  assert.equal(compareSemver('0.18.9', '0.18.10'), -1);
});

test('compareSemver: v-prefix does not affect ordering', () => {
  assert.equal(compareSemver('v1.0.0', '1.0.0'), 0);
});

test('compareSemver: a release beats any prerelease of the same core version', () => {
  assert.equal(compareSemver('v0.19.0', 'v0.19.0-rc1'), 1);
  assert.equal(compareSemver('v0.19.0-rc1', 'v0.19.0'), -1);
});

test('compareSemver: unparseable input on either side is incomparable (null)', () => {
  assert.equal(compareSemver('garbage', 'v1.0.0'), null);
  assert.equal(compareSemver('v1.0.0', 'garbage'), null);
});

test('isNewer: only true when latest is a strictly higher semver — the newer-only bug fix', () => {
  assert.equal(isNewer('v0.19.0', 'v0.18.0'), true, 'newer upstream -> notice');
  assert.equal(isNewer('v0.18.0', 'v0.19.0'), false, 'older upstream -> silence (was the bug: notice ==>downgrade)');
  assert.equal(isNewer('v0.18.0', 'v0.18.0'), false, 'equal -> no notice');
  assert.equal(isNewer('garbage', 'v0.18.0'), false, 'unparseable latest is never treated as newer');
});

// ------------------------------------------------------------------ src-path classification

test('rawSrcPath extracts the value verbatim; null when the key is absent', () => {
  assert.equal(rawSrcPath("_commit: v1.0.0\n_src_path: 'gh:Koroqe/OPOS'\n"), 'gh:Koroqe/OPOS');
  assert.equal(rawSrcPath('_commit: v1.0.0\n'), null);
});

test('classifySrcPath: the three gh: / https:// / git@ remote shapes', () => {
  assert.deepEqual(classifySrcPath("_src_path: 'gh:Koroqe/OPOS'"), { kind: 'remote', repo: 'Koroqe/OPOS', raw: 'gh:Koroqe/OPOS' });
  assert.equal(classifySrcPath('_src_path: https://github.com/Koroqe/OPOS.git').kind, 'remote');
  assert.equal(classifySrcPath('_src_path: git@github.com:Koroqe/OPOS.git').kind, 'remote');
});

test('classifySrcPath: anything that is not a recognised remote shape is maybe-local', () => {
  const c = classifySrcPath('_src_path: /home/agent/workspace/OPOS');
  assert.equal(c.kind, 'maybe-local');
  assert.equal(c.raw, '/home/agent/workspace/OPOS');
});

test('classifySrcPath: missing _src_path key', () => {
  assert.deepEqual(classifySrcPath('_commit: v1.0.0\n'), { kind: 'missing', raw: null });
});

// ------------------------------------------------------------------ release picking

test('pickLatestRelease: drafts are always excluded; prereleases excluded unless requested', () => {
  const releases = [
    { tag_name: 'v0.19.0-rc1', draft: false, prerelease: true },
    { tag_name: 'v0.18.9', draft: true, prerelease: false },
    { tag_name: 'v0.18.1', draft: false, prerelease: false },
  ];
  assert.equal(pickLatestRelease(releases, false).tag_name, 'v0.18.1');
  assert.equal(pickLatestRelease(releases, true).tag_name, 'v0.19.0-rc1');
  assert.equal(pickLatestRelease([], false), null);
});

// ------------------------------------------------------------------ cache freshness

test('cacheIsFresh: within the window is fresh, at/after the window is not', () => {
  const now = Date.parse('2026-09-23T12:00:00Z');
  const sixH = 6 * 60 * 60 * 1000;
  assert.equal(cacheIsFresh({ checked_at: '2026-09-23T06:00:01Z' }, now, sixH), true);
  assert.equal(cacheIsFresh({ checked_at: '2026-09-23T06:00:00Z' }, now, sixH), false, 'exactly at the window edge is stale');
  assert.equal(cacheIsFresh({ checked_at: '2026-09-23T00:00:00Z' }, now, sixH), false);
});

test('cacheIsFresh: missing / malformed cache is never fresh', () => {
  const now = Date.now();
  assert.equal(cacheIsFresh(null, now, 1000), false);
  assert.equal(cacheIsFresh({}, now, 1000), false);
  assert.equal(cacheIsFresh({ checked_at: 'not-a-date' }, now, 1000), false);
});

// ------------------------------------------------------------------ end-to-end (local-path _src_path, real git, no network)

function sh(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout;
}

function makeUpstream(tags) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opos-upstream-'));
  sh('git', ['init', '-q'], dir);
  sh('git', ['config', 'user.email', 'test@example.com'], dir);
  sh('git', ['config', 'user.name', 'test'], dir);
  sh('git', ['commit', '-q', '--allow-empty', '-m', 'init'], dir);
  for (const t of tags) sh('git', ['tag', t], dir);
  return dir;
}

function makeConsumer(pin, srcPath) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opos-consumer-'));
  fs.writeFileSync(path.join(dir, '.copier-answers.yml'), `_commit: ${pin}\n_src_path: ${srcPath}\nCOMPANY_NAME: Test\n`);
  return dir;
}

function run(consumerDir, args = []) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { cwd: consumerDir, encoding: 'utf8' });
}

test('end-to-end (local path): pinned BEHIND upstream prints the newer-only notice', () => {
  const upstream = makeUpstream(['v0.1.0', 'v0.1.1', 'v0.2.0']);
  const consumer = makeConsumer('v0.1.0', upstream);
  const r = run(consumer);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /OPOS-core v0\.2\.0 is available \(you're on v0\.1\.0\)\. The daily session updater applies it automatically; to apply now, ask the steward to run sync-from-core \(it runs in a subagent\)\./);
  assert.match(r.stdout, /_src_path is a local path/, 'portability warning is printed every time this branch is taken');
  fs.rmSync(upstream, { recursive: true, force: true });
  fs.rmSync(consumer, { recursive: true, force: true });
});

test('end-to-end (local path): pinned AHEAD of upstream is silent (older-upstream silence — the bug this replaces would have notified)', () => {
  const upstream = makeUpstream(['v0.1.0', 'v0.1.1']);
  const consumer = makeConsumer('v0.9.0', upstream);
  const r = run(consumer);
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout, /is available/);
  assert.match(r.stdout, /_src_path is a local path/);

  const rv = run(consumer, ['--force', '--verbose']);
  assert.match(rv.stdout, /pinned \(v0\.9\.0\) is current or ahead of upstream \(v0\.1\.1\)/);
  fs.rmSync(upstream, { recursive: true, force: true });
  fs.rmSync(consumer, { recursive: true, force: true });
});

test('end-to-end (local path): --include-prerelease picks a true-latest prerelease', () => {
  const upstream = makeUpstream(['v0.1.0', 'v0.2.0-rc1']);
  const consumer = makeConsumer('v0.1.0', upstream);
  const withoutFlag = run(consumer);
  assert.doesNotMatch(withoutFlag.stdout, /is available/, 'default run ignores the prerelease tag entirely');

  const withFlag = run(consumer, ['--include-prerelease']);
  assert.match(withFlag.stdout, /OPOS-core v0\.2\.0-rc1 is available/);
  fs.rmSync(upstream, { recursive: true, force: true });
  fs.rmSync(consumer, { recursive: true, force: true });
});

test('end-to-end: missing .copier-answers.yml warns and exits 0', () => {
  const consumer = fs.mkdtempSync(path.join(os.tmpdir(), 'opos-consumer-noanswers-'));
  const r = run(consumer);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /\.copier-answers\.yml not found/);
  fs.rmSync(consumer, { recursive: true, force: true });
});

test('end-to-end: non-existent local _src_path is a loud one-line warning, exit 0', () => {
  const consumer = makeConsumer('v0.1.0', path.join(os.tmpdir(), 'opos-definitely-does-not-exist-xyz'));
  const r = run(consumer);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /does not exist on this machine/);
  fs.rmSync(consumer, { recursive: true, force: true });
});

test('end-to-end: cache freshness — a second run within 6h does not re-read new upstream tags; --force does', () => {
  const upstream = makeUpstream(['v0.1.0']);
  const consumer = makeConsumer('v0.0.1', upstream);

  const first = run(consumer);
  assert.match(first.stdout, /v0\.1\.0 is available/);
  assert.ok(fs.existsSync(path.join(consumer, '.claude', '.update-probe')), 'cache file written');

  sh('git', ['tag', 'v0.2.0'], upstream);
  const second = run(consumer);
  assert.match(second.stdout, /v0\.1\.0 is available/, 'cache is fresh — the new v0.2.0 tag is not seen yet');
  assert.doesNotMatch(second.stdout, /v0\.2\.0 is available/);

  const forced = run(consumer, ['--force']);
  assert.match(forced.stdout, /v0\.2\.0 is available/, '--force bypasses the cache');
  fs.rmSync(upstream, { recursive: true, force: true });
  fs.rmSync(consumer, { recursive: true, force: true });
});

test('end-to-end: the daily session updater\'s own cache file is never touched', () => {
  const upstream = makeUpstream(['v0.1.0', 'v0.2.0']);
  const consumer = makeConsumer('v0.1.0', upstream);
  fs.mkdirSync(path.join(consumer, '.claude'), { recursive: true });
  const flagPath = path.join(consumer, '.claude', '.last-update-check');
  fs.writeFileSync(flagPath, '2020-01-01T00:00:00Z v0.0.1\n');
  const before = fs.readFileSync(flagPath, 'utf8');

  run(consumer);

  const after = fs.readFileSync(flagPath, 'utf8');
  assert.equal(after, before, '.last-update-check (the session updater\'s daily flag) must be byte-for-byte untouched');
  fs.rmSync(upstream, { recursive: true, force: true });
  fs.rmSync(consumer, { recursive: true, force: true });
});

// ------------------------------------------------------------------ end-to-end (remote _src_path via a shimmed `gh`) — POSIX only
// Windows cannot spawn an extensionless PATH entry (`gh`) resolving to a `.bat`/`.cmd` shim
// without `shell: true` (CreateProcess needs cmd.exe as the interpreter for those, and Node
// refuses to do that implicitly since the 2024 shell-injection fix), so this variant only runs
// on POSIX runners (which is what `.github/workflows/ci.yml` uses). The remote-path LOGIC this
// would exercise (shape classification, gh api endpoint string, release picking) is already
// covered by the pure `classifySrcPath` / `pickLatestRelease` tests above.
test('end-to-end (remote, POSIX only): gh api releases feed the same newer-only comparison', { skip: process.platform === 'win32' ? 'cannot shim an extensionless PATH command without a shell on Windows' : false }, () => {
  const shimDir = fs.mkdtempSync(path.join(os.tmpdir(), 'opos-ghshim-'));
  const shimPath = path.join(shimDir, 'gh');
  fs.writeFileSync(shimPath, '#!/bin/sh\ncat <<\'EOF\'\n[{"tag_name":"v0.9.0","draft":false,"prerelease":false},{"tag_name":"v0.8.0","draft":false,"prerelease":false}]\nEOF\n');
  fs.chmodSync(shimPath, 0o755);

  const consumer = makeConsumer('v0.8.0', 'gh:Koroqe/OPOS');
  const r = spawnSync(process.execPath, [SCRIPT], {
    cwd: consumer,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${shimDir}:${process.env.PATH}` },
  });
  assert.equal(r.status, 0);
  assert.match(r.stdout, /OPOS-core v0\.9\.0 is available \(you're on v0\.8\.0\)/);

  fs.rmSync(shimDir, { recursive: true, force: true });
  fs.rmSync(consumer, { recursive: true, force: true });
});
