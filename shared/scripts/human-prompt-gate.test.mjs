/** node --test shared/scripts/human-prompt-gate.test.mjs
 *
 * Pure-logic tests for analyzeTurn/findCta plus end-to-end spawns of the hook against synthetic
 * transcripts (stdin payload -> transcript tail -> stdout JSON), including the fail-open paths.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { analyzeTurn, findCta, readTurnEntries, buildReason, CTA_PATTERNS } from './human-prompt-gate.mjs';

const SCRIPT = path.resolve(import.meta.dirname, 'human-prompt-gate.mjs');

const user = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const toolResult = () => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } });
const say = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const ask = () => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'q1', name: 'AskUserQuestion', input: {} }] } });
const bash = () => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'b1', name: 'Bash', input: {} }] } });

test('prose CTA in the final text blocks', () => {
  const r = analyzeTurn([user('go'), say('Done with the draft. Reply `1` or `2` to choose.')]);
  assert.equal(r.block, true);
  assert.match(r.snippet, /Reply `1`/);
  assert.ok(r.snippet.length <= 120);
});

test('AskUserQuestion called and no CTA after it passes, even if CTA prose came before it', () => {
  const r = analyzeTurn([user('go'), say('Reply `1` or `2`.'), ask(), toolResult(), say('Recorded your choice.')]);
  assert.equal(r.block, false);
});

test('AskUserQuestion called then more CTA prose blocks', () => {
  const r = analyzeTurn([user('go'), ask(), toolResult(), say('Thanks. What I need from you next: the invoice.')]);
  assert.equal(r.block, true);
});

test('CTA only inside a fenced code block passes', () => {
  const text = 'Paste this to the lawyer:\n```\nPlease reply "approve" and confirm.\nReply `1` or `2`\n```\nSent.';
  assert.equal(analyzeTurn([user('go'), say(text)]).block, false);
  assert.equal(findCta('```\nunterminated: reply `1`'), null);
});

test('a tool_result user entry is not the turn boundary', () => {
  const r = analyzeTurn([user('go'), say('Reply `1` or `2`.'), bash(), toolResult(), say('Ran the check.')]);
  assert.equal(r.block, true);
});

test('text from before the genuine user message is ignored', () => {
  const r = analyzeTurn([say('Reply `1` or `2`.'), user('ok, next thing'), say('Finished. All tests pass.')]);
  assert.equal(r.block, false);
});

test('meta and system-injected user entries are not turn boundaries', () => {
  const meta = { type: 'user', isMeta: true, message: { role: 'user', content: 'caveat' } };
  const reminder = user('<system-reminder>hooks ran</system-reminder>');
  const r = analyzeTurn([user('go'), say('Your call: ship or hold?'), meta, reminder, say('Working.')]);
  assert.equal(r.block, true);
});

test('plain report text passes', () => {
  const text = 'Merged the branch, 12 tests pass. Opened PR 5. A founder-action issue was filed for the renewal. The vendor replied "ok" yesterday.';
  assert.equal(analyzeTurn([user('go'), say(text)]).block, false);
});

test('Russian CTAs block', () => {
  for (const t of ['Ответь «да», и я отправлю.', 'Что мне нужно от тебя: выбрать вариант.', 'Нужно твоё решение по договору.', 'Напиши 1 или 2.', 'Тебе решать.']) {
    assert.equal(analyzeTurn([user('go'), say(t)]).block, true, t);
  }
});

test('English CTA variants block', () => {
  for (const t of ["type 'approve' to go", 'Answer "yes" or "no"', 'This needs your approval.', "It's your call.", 'respond with yes', 'founder-action issue 12 is waiting on you']) {
    assert.equal(analyzeTurn([user('go'), say(t)]).block, true, t);
  }
});

test('last_assistant_message counts when the transcript lags, but not when it is pre-ask text', () => {
  assert.equal(analyzeTurn([user('go')], 'Reply `1` or `2`').block, true);
  const preAsk = 'Reply `1` or `2`.';
  assert.equal(analyzeTurn([user('go'), say(preAsk), ask()], preAsk).block, false);
});

test('pattern list is exported and well-formed', () => {
  assert.ok(CTA_PATTERNS.length >= 10);
  for (const p of CTA_PATTERNS) assert.ok(p.id && p.re instanceof RegExp);
  assert.match(buildReason('x'), /AskUserQuestion/);
  assert.match(buildReason('x'), /founder-action/);
});

// ------------------------------------------------------------------ end to end

function withTranscript(entries, fn, { raw } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hpg-'));
  const file = path.join(dir, 't.jsonl');
  fs.writeFileSync(file, raw ?? entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  try { return fn(file); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

function run(payload, env = {}) {
  return spawnSync(process.execPath, [SCRIPT], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, OPOS_HUMAN_PROMPT_GATE: '', ...env },
  });
}

test('e2e: CTA turn prints the block JSON and exits 0', () => {
  withTranscript([user('go'), say('Reply `1` or `2`.')], (file) => {
    const r = run({ transcript_path: file, stop_hook_active: false });
    assert.equal(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /AskUserQuestion/);
    assert.equal(r.stderr, '');
  });
});

test('e2e: stop_hook_active true passes silently', () => {
  withTranscript([user('go'), say('Reply `1` or `2`.')], (file) => {
    const r = run({ transcript_path: file, stop_hook_active: true });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  });
});

test('e2e: opt-out env passes silently', () => {
  withTranscript([user('go'), say('Reply `1` or `2`.')], (file) => {
    const r = run({ transcript_path: file }, { OPOS_HUMAN_PROMPT_GATE: 'off' });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  });
});

test('e2e: missing, malformed or empty input fails open', () => {
  for (const payload of [{ transcript_path: '/nonexistent/x.jsonl' }, {}, 'not json', '']) {
    const r = run(payload);
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  }
  withTranscript([], (file) => {
    const r = run({ transcript_path: file });
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
  }, { raw: '{"type":"assistant","message":{"content":[{"type":"te\nnot json at all\n' });
});

test('e2e: last_assistant_message alone triggers when the transcript has not caught up', () => {
  withTranscript([user('go')], (file) => {
    const r = run({ transcript_path: file, last_assistant_message: 'Нужно твоё решение.' });
    assert.equal(JSON.parse(r.stdout).decision, 'block');
  });
});

test('readTurnEntries walks back across chunk boundaries and stops at the genuine user message', () => {
  const entries = [say('old'), user('first prompt'), say('x'.repeat(300)), toolResult(), say('Reply `1` or `2`.')];
  withTranscript(entries, (file) => {
    const got = readTurnEntries(file, 64); // tiny chunks force many boundary splits
    assert.equal(got.length, 3);
    assert.equal(got[2].message.content[0].text, 'Reply `1` or `2`.');
    assert.equal(analyzeTurn(got).block, true);
  });
});
