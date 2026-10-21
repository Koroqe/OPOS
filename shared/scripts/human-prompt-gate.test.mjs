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
import { analyzeTurn, findCta, finalAssistantText, stripFences, readTurnEntries, buildReason, CTA_PATTERNS } from './human-prompt-gate.mjs';

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
  assert.equal(findCta('Done.\n```\nReply `1`\n```'), null);
});

test('only the final message of the turn is analysed (a request from an earlier stop is not re-flagged)', () => {
  // A background-task wake-up re-enters the turn: the request from the earlier stop is not repeated.
  const r = analyzeTurn([user('go'), say('Reply `1` or `2`.'), bash(), toolResult(), say('Ran the check.')]);
  assert.equal(r.block, false);
  const r2 = analyzeTurn([user('go'), say('Working.'), bash(), toolResult(), say('Reply `1` or `2`.')]);
  assert.equal(r2.block, true);
});

test('text from before the genuine user message is ignored', () => {
  const r = analyzeTurn([say('Reply `1` or `2`.'), user('ok, next thing'), say('Finished. All tests pass.')]);
  assert.equal(r.block, false);
});

test('meta and system-injected user entries are not turn boundaries', () => {
  const meta = { type: 'user', isMeta: true, message: { role: 'user', content: 'caveat' } };
  const reminder = user('<system-reminder>hooks ran</system-reminder>');
  const r = analyzeTurn([user('go'), say('Working.'), meta, reminder, say('Reply `1` or `2`.')]);
  assert.equal(r.block, true);
  assert.equal(analyzeTurn([user('go'), say('Reply `1` or `2`.'), meta, reminder, say('Working.')]).block, false);
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

test('last_assistant_message wins over a lagging transcript', () => {
  assert.equal(analyzeTurn([user('go')], 'Reply `1` or `2`').block, true);
  assert.equal(analyzeTurn([user('go'), say('Reply `1` or `2`.')], 'All done.').block, false);
});

test('finalAssistantText joins the records of one message and skips sidechains and tool-only records', () => {
  const rec = (id, text) => ({ type: 'assistant', message: { id, role: 'assistant', content: [{ type: 'text', text }] } });
  const side = { type: 'assistant', isSidechain: true, message: { id: 'm9', content: [{ type: 'text', text: 'Reply `1`' }] } };
  assert.equal(finalAssistantText([rec('m1', 'first'), rec('m2', 'A'), rec('m2', 'B'), side, bash()]), 'A\n\nB');
  assert.equal(finalAssistantText([user('x')]), '');
});

test('an unpaired fence does not hide the rest of the text; paired ones are still stripped', () => {
  assert.equal(findCta('Stray ``` fence here.\nReply `1` or `2`.')?.id, 'en-reply');
  assert.equal(findCta('```\nopen block never closed\nReply `1` or `2`.')?.id, 'en-reply');
  assert.equal(findCta('Intro.\n```\nReply `1`\n```\nDone.'), null);
  assert.equal(findCta('Intro.\n~~~\nReply `1`\n~~~\nDone.'), null);
  assert.ok(!stripFences('a ```x``` b').includes('x'));
});

test('a prose request after an AskUserQuestion call still blocks (the final message is analysed)', () => {
  assert.equal(analyzeTurn([user('go'), ask(), toolResult(), say('Thanks. Reply `1` or `2` for the rest.')]).block, true);
});

test('false-positive corpus passes (reporting text that merely contains the words)', () => {
  const pass = [
    'The column is now of type `numeric`.',
    'The handler should respond with 200 on success.',
    'I traced your call to the billing API.',
    'The user picked answer 3.',
    'Got reply 200 from Stripe.',
    "Set the param type 'string' in the schema.",
    "type 'string'",
    'Earlier you asked me to reply `go`.',
    'The form field needs your input.',
    'needs your input',
    'Logged your call with Ihor.',
    'All four hosts answer 200.',
    'The proxy routes answer "unauthorised" for expired tokens.',
    'routes answer "unauthorised"',
    'The defaults still say "escalate above $X".',
    'still say "escalate above $X"',
    'When you type "work autonomously" the steward skips the greeting.',
    'Your remaining founder-action items are listed in the issue.',
    'your remaining founder-action items',
    'Answer: the column is numeric.',
    'Reply sent to Ihor.',
    'Merged the branch. 12 tests pass.\n\nThe renewal is filed as a founder-action for the vendor review.',
    'Why does this matter? Because the hook fires once per turn.',
  ];
  for (const t of pass) assert.equal(analyzeTurn([user('go'), say(t)]).block, false, t);
});

test('false-negative corpus blocks (prose requests in common forms)', () => {
  const block = [
    'Please approve the draft.',
    'Can you sign the NDA?',
    'Can you sign…?',
    'Let me know which one you prefer.',
    'Let me know which…',
    'Should I proceed?',
    'Choose 1 or 2',
    'Reply A or B',
    'Reply **yes**',
    'Reply `1` or `2`:',
    'What I need from you',
    'Here is what I need from you: the invoice.',
    'Type "approve" and I\'ll push',
    'Next step for you:',
    'Action required:',
    '**Action required**',
    'Your call.',
    'This needs your decision.',
    'This needs your sign-off.',
    'Подтверди',
    'Дай знать',
    'Дайте знать, как поступаем.',
    'Что выбираешь?',
    'Ответь «да»',
    'Ответь `1` или `2`:',
    'Если согласен, ответь «да».',
    'Хочешь, чтобы я отправил?',
    'От тебя нужно решение.',
    'Твой ход.',
    'Done. If that works, reply yes.',
    '- Reply `1` or `2`\n- something else',
    '1. Approve the PR\n2. Merge it',
    'Pushed the fix and opened the PR.\n\nWant me to merge it now?\n\nIssue: https://github.com/o/r/issues/5',
    'I filed a founder-action for you.',
  ];
  for (const t of block) assert.equal(analyzeTurn([user('go'), say(t)]).block, true, t);
});

test('a generic question outside the closing paragraph does not block; a strong one does', () => {
  const t = 'Which one broke? The cache.\n\nAll 12 tests pass.\n\nMerged.';
  assert.equal(analyzeTurn([user('go'), say(t)]).block, false);
  const strong = 'The fix is in.\n\nShould I rewrite the history?\n\nI can also turn this into a page.';
  assert.equal(analyzeTurn([user('go'), say(strong)]).block, true);
});

test('real-transcript forms: "Y/n", "Reply e.g.", "Decision for you:", "want your call", "say the word"', () => {
  for (const t of [
    'I am about to commit the draft. Commit? Y/n.',
    '- Reply e.g. **`1a 2a 3b 4b`**.',
    '**Decision for you:** shipping means pushing to main.',
    '**Still waiting on you:**\n1. Grant access.',
    "Two things I'd want your call on before I touch anything:",
    "Both are Notice-tier — say the word and I'll open them.",
    'What should this session work on?',
    'Fill it in. Then pick one:\n- a\n- b',
    'Your next step is an SDLC session on the issue.',
    "There is one item that needs you, about the daily jobs.",
  ])assert.equal(analyzeTurn([user('go'), say(t)]).block, true, t);
  for (const t of ['Decide by risk, not rank.', 'Nothing is waiting on you.', 'Nothing needs you right now.', 'The regex accepts y/n flags.']) {
    assert.equal(analyzeTurn([user('go'), say(t)]).block, false, t);
  }
});

test('round 3: Russian past tense "пришли" passes, the imperative "send" still blocks', () => {
  for (const t of ['Пришли ответы от юристов: HLC и DLA.', 'Пришли деньги от клиента, 12 000 €.', 'Вчера пришли два письма.']) {
    assert.equal(analyzeTurn([user('go'), say(t)]).block, false, t);
  }
  for (const t of ['Пришли мне вывод команды.', 'Пришли сюда скриншот.', 'Пришли вывод агенту.', 'Скопируй и пришли результат.']) {
    assert.equal(analyzeTurn([user('go'), say(t)]).block, true, t);
  }
});

test('round 3: "Please <action>" blocks, "Please note / be aware" passes', () => {
  for (const t of [
    'Please sign in to the dashboard.', 'Please log out in that window and back in.', 'Please check two things in Telegram:',
    'Please click "Yes"', 'Please run the migration.', 'Please paste the token here.', 'Please reply when done.',
    'Done with the draft. Please confirm the amount.', 'Please approve the PR.', 'Fixed it, and please run the tests.',
  ]) assert.equal(analyzeTurn([user('go'), say(t)]).block, true, t);
  for (const t of ['Please note the cache is cold.', 'Please be aware this is slow.', 'Note: please see the issue for details.']) {
    assert.equal(analyzeTurn([user('go'), say(t)]).block, false, t);
  }
});

test('round 3: lead-ins addressed to the human block', () => {
  for (const t of [
    "What's left for you:", 'Two things for you:', 'One choice for you:', 'Your step:', 'Your steps:', '## Two things needing you',
    'Тебе осталось:', 'От тебя нужно:', 'Твой шаг:',
  ]) assert.equal(analyzeTurn([user('go'), say(t)]).block, true, t);
});

test('round 3: short closing questions asking for a go block', () => {
  for (const t of [
    'Merged to the branch.\n\nMerge or hold?', 'Draft is ready.\n\nOK to send?', 'I need your OK before the push.',
    'Waiting for your go to publish.', 'Готово.\n\nОтправляем?', 'Подтверждаешь?',
    'Как поступим с инвойсом: платим сейчас или ждём?',
  ]) assert.equal(analyzeTurn([user('go'), say(t)]).block, true, t);
});

test('round 3: negations pass', () => {
  for (const t of [
    "It's R1, so it doesn't need your approval.", 'This is R1, so it does not need your approval.', 'Nothing here needs you.',
    'What I need from you: nothing — all done.', 'Action required: none.', 'Нужно от тебя: ничего.',
  ]) assert.equal(analyzeTurn([user('go'), say(t)]).block, false, t);
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

test('round 4: quoted third-party text does not trigger any rule', () => {
  const quoted = [
    'LinkedIn said *«…invitations. Please try again next week»*.',
    'The build output was "Deployment failed. Please check the build logs."',
    'The error was: "Please run `npm install` first."',
    'The page showed “Session expired. Please sign in again.”',
    '> Too many attempts. Please try again later.',
    'The error was: Please run npm install first.',
    "The log has 'Please reconnect to the server now' in it.",
  ];
  for (const t of quoted) assert.equal(findCta(t), null, t);
});

test('round 4: unquoted direct requests and requests with a quoted draft still block', () => {
  const asks = [
    'Please approve the PR.',
    'Please check the build logs and tell me if it is green.',
    'Пожалуйста, подтверди.',
    'Please send this reply: «Thanks, see you Monday».',
    'Reply "go ahead" to continue.',
    'Ответь «да» или «нет».',
  ];
  for (const t of asks) assert.equal(analyzeTurn([user('go'), say(t)]).block, true, t);
});

test('round 4: a contraction between apostrophes is not a quoted span', () => {
  assert.equal(analyzeTurn([user('go'), say("It's fine and I don't mind. Please approve the PR, it's ready.")]).block, true);
});

test('round 4: a negation neutralises a request only inside its own clause', () => {
  const asks = [
    'Nothing else is blocked; the merge needs your approval.',
    'Nobody objected, so the contract now needs your sign-off.',
    'Action required: nothing from you, but the DNS change needs your approval.',
    'No action on the invoice. However the filing needs your decision.',
    'Ничего не горит, но нужно твоё решение.',
  ];
  for (const t of asks) assert.equal(analyzeTurn([user('go'), say(t)]).block, true, t);
  const passes = [
    "It's R1, so it doesn't need your approval.", 'This is R1, so it does not need your approval.', 'Nothing here needs you.',
    'What I need from you: nothing — all done.', 'Action required: none.', 'Нужно от тебя: ничего.', 'Nothing is waiting on you.', 'Nobody needs your approval here.',
  ];
  for (const t of passes) assert.equal(findCta(t), null, t);
});

test('round 4: Russian plural/formal imperative «пришлите» always blocks, «пришли» past tense still passes', () => {
  assert.equal(analyzeTurn([user('go'), say('Пришлите, пожалуйста, ссылку на документ.')]).block, true);
  assert.equal(analyzeTurn([user('go'), say('Пришлите код из SMS.')]).block, true);
  assert.equal(analyzeTurn([user('go'), say('Пришли ответы от юристов.')]).block, false);
});

test('round 5: stripping a quoted span keeps the sentence terminator (the next sentence still starts a sentence)', () => {
  const asks = [
    'The lawyer replied: they need the signed copy. Please upload it to Drive.',
    'The deploy failed with error: missing secret. Please paste STRIPE_KEY into the repo settings.',
    'CI failed, error: lint. Want me to fix it now?',
    'Commit message: fix gate. Should I push it to main?',
    'Vercel says "Build succeeded." Please approve the promotion to production.',
    'The client wrote back "Looks good." Can you sign the SOW today?',
    'The bot replied "Done." Should I merge the PR now?',
  ];
  for (const t of asks) assert.equal(analyzeTurn([user('go'), say(t)]).block, true, t);
});

test('round 5: reported speech is not stripped; error/message strip stops at a dash', () => {
  for (const t of ['Dima said: please sign the NDA today.', 'Error: build failed — please paste STRIPE_KEY into the settings.']) {
    assert.equal(analyzeTurn([user('go'), say(t)]).block, true, t);
  }
  for (const t of ['The error was: Please run npm install first.', 'Error: "Please approve the request" was shown by the CLI.']) {
    assert.equal(findCta(t), null, t);
  }
});

test('round 5: reported speech after replied/says blocks (conservative side, was a round-4 pass)', () => {
  for (const t of ['The service replied: Please confirm your email. Then all is fine.', 'The modal says: Please approve the cookies. Deploy finished.']) assert.equal(findCta(t) !== null, true, t);
});

test('round 5: a blockquote with an action-required callout is not stripped', () => {
  assert.equal(analyzeTurn([user('go'), say('> **Action required:** approve the DNS change.')]).block, true);
  assert.equal(findCta('> Please approve the request, said the bot.'), null);
});

test('round 5: inch marks and decade apostrophes are not quote openers; a 6-word answer token stays', () => {
  const asks = [
    'The banner is 5" tall. Please approve the PR "fix: gate" today.',
    'Width is 5". Should I merge "fix: gate" now?',
    "Since the '90s, please approve the merge before the partners' review.",
    'Type "yes, merge it now" to proceed.',
  ];
  for (const t of asks) assert.equal(analyzeTurn([user('go'), say(t)]).block, true, t);
});

test('round 5: a comma, colon, " - " or ", and" ends the negation clause', () => {
  const asks = [
    'No action needed on DNS, the merge needs your approval.',
    'Ничего не отправлено клиенту: нужно твоё одобрение на текст письма.',
    'Никаких изменений в коде, нужно ваше подтверждение на деплой.',
    'Никто не возражал, жду твоего решения по договору.',
    'Nothing else is blocked, the merge needs your approval.',
    'No one has reviewed it yet, and it needs your sign-off.',
    'Nothing is blocked - the merge needs your approval.',
  ];
  for (const t of asks) assert.equal(analyzeTurn([user('go'), say(t)]).block, true, t);
  assert.equal(findCta("There's nothing so urgent that it needs your approval."), null);
});
