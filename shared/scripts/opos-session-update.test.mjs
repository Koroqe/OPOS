/** node --test shared/scripts/opos-session-update.test.mjs */
import test from 'node:test';
import assert from 'node:assert/strict';
import { isDue, noticeFor, withExcludes, RUNTIME_FILES } from './opos-session-update.mjs';

test('runtime files are excluded per clone, once, without touching existing lines', () => {
  const first = withExcludes('# git ls-files --others --exclude-from=.git/info/exclude\n*.swp');
  assert.ok(first.startsWith('# git ls-files --others --exclude-from=.git/info/exclude\n*.swp\n'), 'existing content kept');
  for (const f of RUNTIME_FILES) assert.ok(first.includes(`\n${f}\n`), f);
  assert.equal(withExcludes(first), null, 'idempotent: nothing to add the second time');
  assert.ok(withExcludes('').includes(RUNTIME_FILES[0]), 'works on an empty exclude file');
});

const at = (s) => new Date(s);

test('never checked -> due', () => {
  assert.equal(isDue(null, at('2026-09-23T10:00:00Z')), true);
  assert.equal(isDue('', at('2026-09-23T10:00:00Z')), true);
  assert.equal(isDue('garbage', at('2026-09-23T10:00:00Z')), true);
});

test('checked earlier today -> not due (the once-a-day flag)', () => {
  assert.equal(isDue('2026-09-23T01:00:00Z v0.18.3', at('2026-09-23T23:59:00Z')), false);
});

test('checked yesterday -> due', () => {
  assert.equal(isDue('2026-09-22T23:59:00Z v0.18.2', at('2026-09-23T00:01:00Z')), true);
});

test('the flag written by an earlier check the same evening is honoured', () => {
  assert.equal(isDue('2026-09-22T22:56:12Z v0.16.0', at('2026-09-22T23:30:00Z')), false);
});

test('the hook stays silent unless there is news, and says it only once', () => {
  assert.equal(noticeFor(null), null);
  assert.equal(noticeFor({ result: 'up-to-date' }), null);
  assert.equal(noticeFor({ result: 'waiting', to: 'v1' }), null, 'waiting for the cooldown is not news');
  assert.match(noticeFor({ result: 'updated', from: 'v1', to: 'v2', localFastForward: 'ok' }), /v1 -> v2 applied to the repo and this clone/);
  assert.match(noticeFor({ result: 'needs-human', to: 'v2', reason: 'x' }), /needs a human: x/);
  assert.equal(noticeFor({ result: 'updated', from: 'v1', to: 'v2', reported: true }), null, 'already reported');
});
