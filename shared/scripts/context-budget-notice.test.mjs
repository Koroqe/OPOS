/** node --test shared/scripts/context-budget-notice.test.mjs
 *
 * Pure-logic unit tests plus one end-to-end spawn of the hook against a synthetic transcript
 * in a temp git repo — the closest we can get, without a real Claude Code session, to proving
 * the whole pipe (stdin payload -> transcript tail -> band -> stdout JSON -> state file) works.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  contextFromTranscriptTail,
  bandFor,
  shouldNotify,
  buildNotice,
} from './context-budget-notice.mjs';

const SCRIPT = path.resolve(import.meta.dirname, 'context-budget-notice.mjs');

function usageLine({ input = 0, cacheRead = 0, cacheCreate = 0, sidechain = false, type = 'assistant' } = {}) {
  return JSON.stringify({
    type,
    isSidechain: sidechain,
    message: { usage: { input_tokens: input, cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheCreate } },
  });
}

// ------------------------------------------------------------------ contextFromTranscriptTail

test('sums the three usage fields of the LAST main-thread assistant record', () => {
  const text = [
    usageLine({ input: 1000 }),
    usageLine({ input: 2000, cacheRead: 500, cacheCreate: 100 }),
  ].join('\n');
  assert.equal(contextFromTranscriptTail(text), 2600);
});

test('a sidechain (subagent) record is ignored even when it is last', () => {
  const text = [
    usageLine({ input: 5000 }),
    usageLine({ input: 999999, sidechain: true }),
  ].join('\n');
  assert.equal(contextFromTranscriptTail(text), 5000);
});

test('a non-assistant record is ignored', () => {
  const text = [usageLine({ input: 5000 }), JSON.stringify({ type: 'user', message: {} })].join('\n');
  assert.equal(contextFromTranscriptTail(text), 5000);
});

test('a truncated first line (mid-file tail read) is skipped, not treated as an error', () => {
  const text = '{"type":"assistant, garbage cut mid-lin' + '\n' + usageLine({ input: 4200 });
  assert.equal(contextFromTranscriptTail(text), 4200);
});

test('no usage anywhere -> null', () => {
  const text = [JSON.stringify({ type: 'assistant', isSidechain: false, message: {} }), JSON.stringify({ type: 'user' })].join('\n');
  assert.equal(contextFromTranscriptTail(text), null);
});

test('empty / blank input -> null', () => {
  assert.equal(contextFromTranscriptTail(''), null);
  assert.equal(contextFromTranscriptTail('\n\n  \n'), null);
});

test('missing usage sub-fields default to 0', () => {
  const text = JSON.stringify({ type: 'assistant', isSidechain: false, message: { usage: { input_tokens: 42 } } });
  assert.equal(contextFromTranscriptTail(text), 42);
});

// ------------------------------------------------------------------ bandFor / shouldNotify

test('bandFor: below the first threshold is band 0', () => {
  assert.equal(bandFor(149999, 150000, 100000), 0);
  assert.equal(bandFor(0, 150000, 100000), 0);
});

test('bandFor: at the threshold is band 1, then +1 every step beyond it', () => {
  assert.equal(bandFor(150000, 150000, 100000), 1);
  assert.equal(bandFor(160000, 150000, 100000), 1);
  assert.equal(bandFor(249999, 150000, 100000), 1);
  assert.equal(bandFor(250000, 150000, 100000), 2);
  assert.equal(bandFor(349999, 150000, 100000), 2);
  assert.equal(bandFor(350000, 150000, 100000), 3);
});

test('shouldNotify: only a strictly higher band than last time fires', () => {
  assert.equal(shouldNotify(0, 1), true);
  assert.equal(shouldNotify(1, 1), false);
  assert.equal(shouldNotify(1, 2), true);
  assert.equal(shouldNotify(2, 1), false, 'band regressed (compaction happened) — do not re-notify a lower band');
  assert.equal(shouldNotify(undefined, 1), true, 'no prior state defaults to band 0');
  assert.equal(shouldNotify(0, 0), false);
});

// ------------------------------------------------------------------ buildNotice wording

test('buildNotice: systemMessage and additionalContext carry the [opos-context] prefix and the rounded token count', () => {
  const notice = buildNotice(162345);
  assert.match(notice.systemMessage, /^\[opos-context\] This session is at ~162k tokens of context/);
  assert.match(notice.systemMessage, /\/clear/);
  assert.match(notice.systemMessage, /\/compact/);
  assert.equal(notice.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.match(notice.hookSpecificOutput.additionalContext, /~162k tokens/);
  assert.match(notice.hookSpecificOutput.additionalContext, /Context economy/);
  assert.match(notice.hookSpecificOutput.additionalContext, /task-update/);
  assert.match(notice.hookSpecificOutput.additionalContext, /subagent/);
});

// ------------------------------------------------------------------ end-to-end spawn

function makeTempRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opos-ctx-notice-'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
  spawnSync('git', ['config', 'user.name', 'test'], { cwd: dir });
  fs.mkdirSync(path.join(dir, '.claude'), { recursive: true });
  return dir;
}

function runHook(repoDir, transcriptPath, sessionId, env = {}) {
  const payload = JSON.stringify({ session_id: sessionId, transcript_path: transcriptPath, cwd: repoDir });
  const r = spawnSync(process.execPath, [SCRIPT], {
    cwd: repoDir,
    input: payload,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  return r;
}

test('end-to-end: notice at 160k, silent at 120k, silent on repeat at 170k, notice again at 260k', () => {
  const repo = makeTempRepo();
  const transcript = path.join(repo, 'transcript.jsonl');
  const sessionId = 'e2e-session-1';
  const append = (tokens) => fs.appendFileSync(transcript, usageLine({ input: tokens }) + '\n');

  append(120000);
  let r = runHook(repo, transcript, sessionId);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '', 'silent below the first threshold');

  append(160000);
  r = runHook(repo, transcript, sessionId);
  assert.equal(r.status, 0);
  const notice1 = JSON.parse(r.stdout);
  assert.match(notice1.systemMessage, /~160k/);

  append(170000);
  r = runHook(repo, transcript, sessionId);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '', 'same band as last notice — silent');

  append(260000);
  r = runHook(repo, transcript, sessionId);
  assert.equal(r.status, 0);
  const notice2 = JSON.parse(r.stdout);
  assert.match(notice2.systemMessage, /~260k/);

  fs.rmSync(repo, { recursive: true, force: true });
});

test('end-to-end: env overrides move the thresholds', () => {
  const repo = makeTempRepo();
  const transcript = path.join(repo, 'transcript.jsonl');
  fs.writeFileSync(transcript, usageLine({ input: 6000 }) + '\n');
  const r = runHook(repo, transcript, 'e2e-session-2', { OPOS_CONTEXT_NOTICE_AT: '5000', OPOS_CONTEXT_NOTICE_STEP: '1000' });
  assert.equal(r.status, 0);
  const notice = JSON.parse(r.stdout);
  assert.match(notice.systemMessage, /~6k/);
  fs.rmSync(repo, { recursive: true, force: true });
});

test('end-to-end: fail-open on garbage stdin', () => {
  const repo = makeTempRepo();
  const r = spawnSync(process.execPath, [SCRIPT], { cwd: repo, input: 'not json at all {{{', encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
  fs.rmSync(repo, { recursive: true, force: true });
});

test('end-to-end: missing transcript_path is silent, exit 0', () => {
  const repo = makeTempRepo();
  const r = spawnSync(process.execPath, [SCRIPT], {
    cwd: repo,
    input: JSON.stringify({ session_id: 'x', transcript_path: path.join(repo, 'nope.jsonl') }),
    encoding: 'utf8',
  });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), '');
  fs.rmSync(repo, { recursive: true, force: true });
});
