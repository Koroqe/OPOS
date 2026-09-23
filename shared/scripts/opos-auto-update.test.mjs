/** node --test shared/scripts/opos-auto-update.test.mjs — the decision logic of the unattended updater. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTouched, pickLatest, pinOf, srcRepoOf, isOwnIssue, blockingLeases } from './opos-auto-update.mjs';
import { matchesAny } from '../../.claude/skills/lease/lib/keys.mjs';

test('a release touching a workflow file is separated out — it must never be auto-pushed', () => {
  const c = classifyTouched(['.claude/skills/lease/lease.mjs', '.github/workflows/sync-opos.yml', 'RISKS.md']);
  assert.deepEqual(c.workflowFiles, ['.github/workflows/sync-opos.yml']);
  assert.deepEqual(c.other, ['.claude/skills/lease/lease.mjs', 'RISKS.md']);
  assert.deepEqual(c.rejects, []);
});

test('Windows separators are normalised, so a workflow file cannot slip through as "ordinary"', () => {
  const bs = String.fromCharCode(92);
  const c = classifyTouched([['.github', 'workflows', 'x.yml'].join(bs)]);
  assert.deepEqual(c.workflowFiles, ['.github/workflows/x.yml']);
});

test('conflict files are recognised', () => {
  assert.deepEqual(classifyTouched(['README.md.rej', 'a.md']).rejects, ['README.md.rej']);
});

test('only non-workflow, non-conflict files count as ordinary', () => {
  assert.equal(classifyTouched(['.github/ISSUE_TEMPLATE/task.md']).other.length, 1, 'an issue template is not a workflow');
});

test('the latest STABLE release is chosen; drafts and pre-releases are skipped', () => {
  const r = pickLatest([
    { tag: 'v0.19.0-rc1', draft: false, prerelease: true },
    { tag: 'v0.18.9', draft: true, prerelease: false },
    { tag: 'v0.18.1', draft: false, prerelease: false },
    { tag: 'v0.18.0', draft: false, prerelease: false },
  ]);
  assert.equal(r.tag, 'v0.18.1');
  assert.equal(pickLatest([]), null);
});

test('pin and upstream are read from every _src_path shape copier writes', () => {
  assert.equal(pinOf("{COMPANY_NAME: X, _commit: v0.17.4, _src_path: 'gh:Koroqe/OPOS'}"), 'v0.17.4');
  assert.equal(srcRepoOf("{_src_path: 'gh:Koroqe/OPOS'}"), 'Koroqe/OPOS');
  assert.equal(srcRepoOf('_src_path: https://github.com/Koroqe/OPOS.git'), 'Koroqe/OPOS');
  assert.equal(srcRepoOf('_src_path: git@github.com:Koroqe/OPOS.git'), 'Koroqe/OPOS');
  assert.equal(srcRepoOf('_src_path: /home/agent/workspace/OPOS'), null, 'a local path cannot be updated from CI');
});

test('only the updater\'s own issues are ever touched — never a human issue that merely mentions it', () => {
  assert.equal(isOwnIssue('[opos-auto-sync] v0.18.2: this release changes workflow files'), true);
  assert.equal(isOwnIssue('Включить петлю самообновления OPOS: зарегистрировать auto-sync и review-history'), false, 'real human issue #364 must never match');
  assert.equal(isOwnIssue('opos-auto-sync is broken'), false, 'no bracket prefix, no match');
  assert.equal(isOwnIssue('Re: [opos-auto-sync] v0.18.2: x'), false, 'prefix must be at the start');
  assert.equal(isOwnIssue(null), false);
});

test('dedupe is per tag', () => {
  assert.equal(isOwnIssue('[opos-auto-sync] v0.18.2: workflow files', 'v0.18.2'), true);
  assert.equal(isOwnIssue('[opos-auto-sync] v0.18.2: workflow files', 'v0.18.20'), false, 'v0.18.20 is not v0.18.2');
  assert.equal(isOwnIssue('[opos-auto-sync] v0.18.20: x', 'v0.18.2'), false);
});

test('only leases on files the release changes block it', () => {
  const claims = [
    { key: 'path:departments/commercial/**', scope: ['departments/commercial/**'], intent: 'sales' },
    { key: 'path:company/journal/ACTION-LOG.md', scope: [], intent: 'log' },
    { key: 'process:auto-sync', scope: [], intent: 'driver' },
  ];
  const release = ['.claude/skills/lease/lease.mjs', 'shared/scripts/verify-sync.mjs', 'CHANGELOG.md'];
  assert.deepEqual(blockingLeases(claims, release, matchesAny), [], 'busy folders the release does not touch must not block it');
  const hit = blockingLeases(claims, [...release, 'departments/commercial/CLAUDE.md'], matchesAny);
  assert.deepEqual(hit.map((c) => c.intent), ['sales']);
  assert.equal(blockingLeases([{ key: 'path:**', scope: ['**'] }], release, matchesAny).length, 1, 'a whole-tree lease still blocks');
  assert.equal(blockingLeases([{ key: 'path:x/y.md', scope: ['shared/scripts/**'] }], release, matchesAny).length, 1, 'scope counts, not just the key');
});
