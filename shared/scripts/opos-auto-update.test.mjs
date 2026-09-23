/** node --test shared/scripts/opos-auto-update.test.mjs — the decision logic of the unattended updater. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTouched, pickLatest, pinOf, srcRepoOf } from './opos-auto-update.mjs';

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
