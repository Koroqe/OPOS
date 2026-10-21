#!/usr/bin/env node
/**
 * human-prompt-gate.mjs — `Stop` hook that stops a turn from ending with a decision or action
 * for the human written as prose.
 *
 * Why this exists: the steward used to close turns with "reply `1` or `2`" or a "What I need
 * from you:" list. Prose scrolls away; a law firm waited a month for a reply that sat in a
 * paragraph nobody re-read. The steward rule "Human prompts go through AskUserQuestion"
 * (`.claude/agents/company/chief-of-staff.md`) says every human-owed decision or action is asked
 * through the `AskUserQuestion` tool before the turn ends. This hook is the mechanical check.
 *
 * Contract (verified against https://code.claude.com/docs/en/hooks, "Stop"):
 *   - stdin JSON carries `transcript_path`, `stop_hook_active`, `last_assistant_message`, `cwd`,
 *     `permission_mode`. `stop_hook_active` is true when Claude is already continuing because of a
 *     stop hook; we exit 0 then, so the hook can never loop.
 *   - Blocking = print `{"decision":"block","reason":"..."}` on stdout, exit 0. `reason` is handed
 *     to the model as its next instruction. Claude Code additionally caps consecutive stop-hook
 *     continuations at 8.
 *   - The transcript is written asynchronously and may lag, so the final message is taken from
 *     `last_assistant_message`, and from the transcript only when that is absent.
 *   - There is NO documented non-interactive signal in the Stop input, and Stop does not fire in
 *     subagents (they use SubagentStop). In a headless `claude -p` run the worst case is one extra
 *     turn; the block reason tells the model to fall back to a `founder-action` issue there.
 *
 * Decision: analyse only the FINAL assistant message of the turn (`last_assistant_message` from the
 * Stop input, else the text blocks of the last assistant message in the transcript). Earlier
 * messages are not re-checked, so a request from an earlier stop is not re-flagged after a
 * background-task wake-up. Paired fenced code blocks are stripped first (paste-prompts and
 * commands are legitimate); inline code is NOT stripped, because the token in "Reply `1`" is
 * exactly inline code. Imperatives count only at the start of a sentence, line or clause; see
 * CTA_PATTERNS.
 *
 * Opt out: OPOS_HUMAN_PROMPT_GATE=off. Fail-open: every step is wrapped; any error exits 0 with
 * no output. Never writes to stderr and never exits non-zero.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };

// ------------------------------------------------------------------ CTA patterns (tune here)

// Unicode-aware word edges (JS \b is ASCII-only and useless for Cyrillic).
const L = '(?<![\\p{L}\\p{N}_])';
const R = '(?![\\p{L}\\p{N}_])';
const OPEN = '[`\'"“‘«„]';
const CLOSE = '[`\'"”’»“]';
const NOQ = '[^\\s`\'"“”‘’«»„]';
const WRAP = '[*_`\'"“‘«„(]*';
// A quoted answer token: 1-3 short words, e.g. `1`, 'approve', «да», "go ahead".
const TOKEN = `${OPEN}\\s*${NOQ}{1,24}(?:\\s{1,2}${NOQ}{1,24}){0,2}\\s*${CLOSE}`;
// Short answer words a human is asked to give.
const ANS = '(?:yes|no|y\\/n|ok|okay|go|go\\s+ahead|approve[d]?|confirm|proceed|done|\\d+)';
// For "type"/"say" only an approval-like token counts: `type "string"` is documentation.
const LEX = '(?:yes|no|ok|okay|go|go\\s+ahead|approve[d]?|confirm(?:ed)?|proceed|push|ship|merge|send|done|lgtm|skip|stop|да|нет|ок|давай|одобряю|\\d+)';
const RU_ANS = '(?:да|нет|ок|\\d+)';
// "What I need from you: nothing" is a negation, not a request.
const NONE = `(?!\\s*[:\\-—–]?\\s*(?:nothing|none|nil|n\\/a|ничего|нет|никаких|no\\s+(?:action|decision)s?)${R})`;
// "does not / doesn't / never need your approval", "Nothing here needs you".
const NOT_BEFORE = "(?<!n['’]t\\s)(?<!\\b(?:not|never)\\s)";
// "Nothing / nobody / no action ..." neutralises a request only inside the same clause.
const CLAUSE_BOUNDARY = /[;.!?\n]|\s(?:but|however|so)\s|,\s*(?:а|но)\s|\s[—–]\s/giu;
const NEGATION_TAIL = /(?<![\p{L}\p{N}_])(?:nothing|nobody|no\s+one|no\s+action|никто|никому|ничего|никаких)(?![\p{L}\p{N}_])[\s\S]{0,40}$/iu;
export function negatedInClause(text, index) {
  const seg = text.slice(Math.max(0, index - 120), index);
  let cut = 0;
  for (const m of seg.matchAll(CLAUSE_BOUNDARY)) cut = m.index + m[0].length;
  return NEGATION_TAIL.test(seg.slice(cut));
}

/**
 * Each entry: { id, scope, re }. Patterns run case-insensitively with the `u` flag on text with
 * paired fenced code blocks already removed. `scope` says WHERE in the text the pattern is tried:
 *   sentence  at the start of a sentence / line / list item (after a filler like "please")
 *   clause    at the start of a later clause (after a comma, dash, "and", "then") - strong forms only
 *   anywhere  anywhere in the text (only for phrases that are unambiguous)
 *   question  a sentence ending in "?" in the closing paragraph(s)
 *   question-any  the strong user-addressed forms (Should I, Want me to, Can you ...) in any paragraph
 *   both      sentence start and clause start (strong imperatives only)
 * Imperatives are matched at a clause start, never mid-sentence: "should respond with 200",
 * "picked answer 3" and "the column is of type `numeric`" are reporting, not requests.
 */
export const CTA_PATTERNS = [
  // (a) EN imperatives
  { id: 'en-reply', scope: 'sentence', re: new RegExp(`^(?:reply|answer|respond)${R}\\s+(?:to\\s+(?:me|this)\\s+)?(?:with\\s+|just\\s+|simply\\s+)?(?:one\\s+word\\s*:?\\s*)?(?:${TOKEN}|${WRAP}${ANS}${R})`, 'iu') },
  { id: 'en-reply-open', scope: 'sentence', re: new RegExp(`^(?:reply|answer|respond)${R}\\s+(?:me\\b|us\\b|here\\b|below\\b|in\\s+chat\\b|with\\b|e\\.g\\.|to\\s+(?:me|this)\\b)`, 'iu') },
  { id: 'en-reply-clause', scope: 'clause', re: new RegExp(`^(?:reply|answer|respond)${R}\\s+(?:just\\s+|simply\\s+)?(?:${TOKEN}|${WRAP}${ANS}${R})`, 'iu') },
  // case-sensitive letters: "Reply A or B", never "answer a question"
  { id: 'en-reply-letter', scope: 'sentence', re: new RegExp(`^(?:[Rr]eply|[Aa]nswer|[Rr]espond|[Cc]hoose|[Pp]ick|[Ss]elect)${R}\\s+(?:with\\s+)?${WRAP}[A-D](?:\\s*(?:\\/|,|or${R}|and${R}|\\.|:|\\?|!|\\)|\\*|\`|$))`, 'u') },
  { id: 'en-choose', scope: 'sentence', re: new RegExp(`^(?:choose|pick|select)${R}\\s+(?:(?:one|any)${R}|an?\\s+option${R}|option${R}|between${R}|either${R}|from${R}|which${R}|whether${R}|\\d+${R}|the\\s+(?:option|variant|approach|one|path|plan)${R})`, 'iu') },
  { id: 'en-confirm', scope: 'sentence', re: new RegExp(`^(?:confirm|approve|authori[sz]e|decide(?=\\s+(?:whether|which|what|if|on|between|how|now)${R}|\\s*:))${R}`, 'iu') },
  { id: 'en-let-me-know', scope: 'both', re: new RegExp(`^(?:let\\s+me\\s+know${R}|tell\\s+me\\s+(?:which|what|whether|if|when|how|your|the\\s+answer)${R})`, 'iu') },
  { id: 'en-say-the-word', scope: 'both', re: new RegExp(`^say\\s+the\\s+word${R}`, 'iu') },
  { id: 'en-send-me', scope: 'sentence', re: new RegExp(`^(?:send\\s+me${R}|give\\s+me\\s+(?:a\\s+|the\\s+)?(?:go|go-ahead|answer|approval|decision|your)${R})`, 'iu') },
  { id: 'en-sign', scope: 'sentence', re: new RegExp(`^sign${R}\\s+(?:the|this|here|it|off|and|them|these)${R}`, 'iu') },
  { id: 'en-type-say', scope: 'both', re: new RegExp(`^(?:type|say)${R}\\s+(?:(?:with|just|simply)\\s+)?(?:one\\s+word\\s*:?\\s*)?(?:${OPEN}\\s*${LEX}\\s*${CLOSE}|${WRAP}${LEX}${R})`, 'iu') },
  // (a) RU imperatives
  { id: 'ru-reply', scope: 'both', re: new RegExp(`^(?:ответь|ответьте|напиши|напишите|скажи|скажите)${R}\\s+(?:мне\\s+)?(?:просто\\s+)?(?:${TOKEN}|${WRAP}${RU_ANS}${R})`, 'iu') },
  { id: 'ru-reply-open', scope: 'sentence', re: new RegExp(`^(?:ответь|ответьте|напиши|напишите|скажи|скажите)${R}`, 'iu') },
  { id: 'ru-confirm', scope: 'both', re: new RegExp(`^(?:подтверди|подтвердите|одобри|одобрите|дай(?:те)?\\s+знать)${R}`, 'iu') },
  { id: 'ru-choose', scope: 'sentence', re: new RegExp(`^(?:выбери|выберите|реши|решите)${R}`, 'iu') },
  // «пришли» is also past tense ("arrived"): the imperative "send" only with an addressee or object.
  // «пришлите» is never past tense: always a request.
  { id: 'ru-send', scope: 'both', re: new RegExp(`^(?:пришли${R}\\s+(?:мне|нам|сюда|в\\s+чат|агенту|вывод|результат|скрин\\p{L}*|лог\\p{L}*|ответ|текст|файл|ссылку)|пришлите)${R}`, 'iu') },
  // sentence-initial "Please <action verb>" (not "Please note / be aware")
  { id: 'en-please', scope: 'polite', re: new RegExp(`^(?:sign|log|check|click|run|paste|reply|respond|answer|confirm|approve|authori[sz]e|send|open|go\\s+to|copy|press|enter|type|tell|review|verify|grant|share|forward|restart|install|select|choose|pick|upload|accept|decline|complete|fill|try|visit|reconnect|re-?authenticate|retry)${R}`, 'iu') },
  // (b) headers and phrases addressed to the human
  { id: 'en-what-i-need', scope: 'anywhere', re: new RegExp(`${L}what\\s+(?:i|we)\\s+(?:'d\\s+|would\\s+)?need\\s+from\\s+you${R}${NONE}|${L}what(?:'s|\\s+is)\\s+needed\\s+from\\s+you${R}${NONE}`, 'iu') },
  { id: 'en-header', scope: 'sentence', re: new RegExp(`^(?:next\\s+steps?\\s+for\\s+you|your\\s+next\\s+step|action\\s+(?:required|needed)|actions\\s+(?:required|needed)|your\\s+(?:move|turn)|(?:still\\s+)?waiting\\s+on\\s+you|decisions?\\s+for\\s+you|(?:need|needed)\\s+from\\s+you)${R}${NONE}`, 'iu') },
  { id: 'en-lead-in', scope: 'sentence', re: new RegExp(`^(?:what(?:'s|\\s+is)\\s+left\\s+for\\s+you|\\p{L}+\\s+(?:things?|steps?|choices?|decisions?|items?|questions?)\\s+(?:for\\s+you|needing\\s+you|that\\s+need\\s+you)|your\\s+steps?(?=\\s*:))\\s*(?::|$)`, 'iu') },
  { id: 'ru-what-i-need', scope: 'anywhere', re: new RegExp(`${L}(?:что|чего)\\s+(?:мне\\s+|нам\\s+)?(?:нужно|надо|жду)\\s+от\\s+(?:тебя|вас)${R}|${L}от\\s+(?:тебя|вас)\\s+(?:нужн\\p{L}*|требуется)${R}${NONE}`, 'iu') },
  { id: 'ru-header', scope: 'sentence', re: new RegExp(`^(?:твой\\s+ход|ваш\\s+ход|следующий\\s+шаг\\s+(?:за\\s+тобой|за\\s+вами|для\\s+тебя|для\\s+вас)|нужно\\s+от\\s+(?:тебя|вас)|требуется\\s+действие)${R}${NONE}`, 'iu') },
  { id: 'ru-lead-in', scope: 'sentence', re: new RegExp(`^(?:тебе\\s+осталось|вам\\s+осталось|твой\\s+шаг|ваш\\s+шаг|твои\\s+шаги|ваши\\s+шаги)\\s*(?::|$)`, 'iu') },
  // (d) "needs your decision / approval ..." (not "input": that is a form label)
  { id: 'en-needs-your', scope: 'anywhere', negatable: true, re: new RegExp(`${NOT_BEFORE}${L}(?:needs?|awaiting|waiting\\s+(?:on|for))\\s+your\\s+(?:decision|approval|go(?:-|\\s)?ahead|go|ok(?:ay)?|sign-?off|confirmation|answer|reply)${R}`, 'iu') },
  { id: 'en-needs-you', scope: 'anywhere', negatable: true, re: new RegExp(`${NOT_BEFORE}${L}needs?\\s+you${R}`, 'iu') },
  { id: 'ru-needs-your', scope: 'anywhere', negatable: true, re: new RegExp(`${L}нужн\\p{L}*\\s+(?:твоё|твое|ваше)\\s+(?:решение|одобрение|подтверждение|согласие|добро)${R}|${L}жду\\s+(?:твоего|вашего)\\s+(?:решения|ответа|одобрения|подтверждения|добро)${R}`, 'iu') },
  // (e) "your call" only as a standalone phrase
  { id: 'en-want-your-call', scope: 'anywhere', re: new RegExp(`${L}(?:want|wants|need|needs|would\\s+like)\\s+your\\s+call${R}`, 'iu') },
  { id: 'en-your-call', scope: 'sentence', re: new RegExp(`^(?:it'?s\\s+|that'?s\\s+)?(?:your\\s+call|up\\s+to\\s+you)\\s*[.!:]*$`, 'iu') },
  { id: 'ru-your-call', scope: 'sentence', re: new RegExp(`^(?:тебе|вам)\\s+решать\\s*[.!:]*$`, 'iu') },
  // (c) a closing direct question to the user
  { id: 'en-question-strong', scope: 'question-any', re: new RegExp(`^(?:(?:should|shall|may)\\s+(?:i|we)${R}|(?:do|would)\\s+you\\s+(?:want|like|prefer|approve|agree)${R}|want\\s+me\\s+to${R}|(?:can|could|will|would)\\s+you${R})`, 'iu') },
  { id: 'en-question', scope: 'question', re: new RegExp(`^(?:(?:should|shall|may|can|could|would|will|do|did|are)\\s+(?:i|we|you)${R}|want\\s+me\\s+to${R}|which${R}|what\\s+(?:should|shall|do\\s+you|would\\s+you)${R}|is\\s+that\\s+(?:ok|okay|fine|good|right|correct)${R}|does\\s+(?:that|this)\\s+(?:work|sound|look)${R}|(?:proceed|continue|go\\s+ahead)\\s*\\?|ready\\b|ok(?:ay)?\\s+to\\s+\\p{L}+|\\p{L}+\\s+or\\s+(?:hold|wait|skip|not|stop|pause|cancel|later)\\s*\\?)`, 'iu') },
  { id: 'en-need-your-ok', scope: 'anywhere', negatable: true, re: new RegExp(`${NOT_BEFORE}${L}i\\s+need\\s+your\\s+(?:ok(?:ay)?|go|go-ahead|approval|confirmation|decision|answer)${R}`, 'iu') },
  { id: 'ru-question', scope: 'question', re: new RegExp(`^(?:хочешь|хотите|продолжа(?:ть|ем)|продолжить|что\\s+выбира(?:ешь|ете)|как\\s+поступ\\p{L}+|какой|какую|какое|какие|какого|согласен|согласна|согласны|можно\\s+ли|могу\\s+ли|стоит\\s+ли|нужно\\s+ли|делать\\s+ли|делаем|подтвержда\\p{L}+|отправля(?:ем|ть)|публику\\p{L}+|запускаем)${R}`, 'iu') },
  // a "Y/n" prompt
  { id: 'yn-prompt', scope: 'anywhere', re: /\?\s*\(?y\/n\)?(?=[\s.?!]|$)|\(y\/n\)/iu },
  // (f) a founder-action addressed to the reader ("your remaining founder-action items" is a report)
  { id: 'founder-action-addressed', scope: 'anywhere', re: new RegExp(`founder-action[^\\n.]{0,60}(?:${L}(?:for|to)\\s+you${R}|(?:waiting|waits|pending)\\s+(?:on|for)\\s+you${R}|${L}(?:тебе|вам|для\\s+тебя|для\\s+вас)${R})|${L}you\\s+(?:have|owe|still\\s+owe)${R}[^\\n.]{0,40}founder-action`, 'iu') },
];

// ------------------------------------------------------------------ pure logic (unit-tested)

/**
 * Remove PAIRED fenced code blocks only. A fence is a line that starts with ``` or ~~~ (up to 3
 * spaces indent); it closes at the next line starting with the same marker. An unpaired fence is
 * left alone (everything after a stray ``` stays visible), as is a ``` in the middle of a line.
 * Single-line ```inline``` spans are removed too.
 */
export function stripFences(text) {
  return String(text ?? '')
    .replace(/^[ \t]{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]{0,3}\1[ \t]*$/gm, ' ')
    .replace(/```[^`\n]*```/g, ' ');
}

const QUOTE_LEAD = /(?:reply|answer|respond|type|say|write|ответь\p{L}*|напиши\p{L}*|скажи\p{L}*)(?:\s+(?:with|just|simply|me|to\s+me|мне|просто|one\s+word\s*:?))*\s*$/iu;
const wordCount = (s) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length;
/**
 * Remove quoted third-party text before any rule runs: «…», "…", “…”, '…'/‘…’ (3+ words only, so
 * contractions are safe), '>' blockquote lines, and the rest of the sentence after "error:",
 * "error was:", "message:", "says:", "said:", "responded:", "replied:". A SHORT quote (1-3 words)
 * right after reply/answer/type/say/ответь/... is an answer token the human is asked to give
 * (Reply "go ahead"), so it stays.
 */
export function stripQuoted(text) {
  const keepToken = (m, off, str) => wordCount(m) <= 3 && QUOTE_LEAD.test(str.slice(Math.max(0, off - 40), off));
  let out = String(text ?? '').replace(/^[ \t]*>.*$/gm, ' ');
  out = out.replace(/(?<![\p{L}\p{N}_])(?:error(?:\s+was)?|message|says|said|responded|replied)\s*:\s*[^\n]*?(?:[.!?](?=\s|$)|$)/gimu, ' ');
  out = out.replace(/«[^»\n]*»|“[^”\n]*”|"[^"\n]*"/gu, (m, off, str) => (keepToken(m, off, str) ? m : ' '));
  out = out.replace(/(?<![\p{L}\p{N}])['‘][^'’\n]*['’](?![\p{L}\p{N}])/gu, (m, off, str) => (wordCount(m) >= 3 ? ' ' : m));
  return out;
}

const FILLER = /^(?:(?:please|pls|kindly|just|now|so|then|also|and|but|ok(?:ay)?(?=,)|пожалуйста|теперь|тогда|и|но|а|так)[,\s]+)+/iu;
const SENTENCE_SPLIT = /(?<=[.!?…:;][*_`"'”’»)\]]*)\s+|\s+[—–]\s+|\s+-\s+/u;
const CLAUSE_SPLIT = /,\s+|\s+[—–]\s+|\s+-\s+|\s+(?:then|and|и|то)\s+/iu;

function tidy(s) {
  let out = s.trim();
  for (let i = 0; i < 3; i++) {
    const before = out;
    out = out.replace(/^[\s>#*_\-•+]+/u, '').replace(/^(?:\d{1,2}|[a-z])[.)]\s+/iu, '').replace(FILLER, '').replace(/^[*_]+/, '');
    if (out === before) break;
  }
  return out.trim();
}

// tidy() strips the filler "please": remember that the unit was a polite request.
const isPolite = (s) => /^[\s>#*_\-•+]*(?:(?:\d{1,2}|[a-z])[.)]\s+)?(?:(?:and|but|ok(?:ay)?|so|then|also|now|just)[,\s]+)*(?:please|pls|kindly)[,\s]/i.test(s);

/** Break text into units: sentences (kind 'sentence') and later clauses of a sentence (kind 'clause'). */
export function toUnits(text) {
  const clean = stripQuoted(stripFences(text));
  const paragraphs = clean.split(/\n[ \t]*\n/).filter((p) => p.trim());
  const units = [];
  paragraphs.forEach((para, p) => {
    for (const line of para.split('\n')) {
      if (!line.trim()) continue;
      for (const raw of line.split(SENTENCE_SPLIT)) {
        const sentence = tidy(raw);
        if (!sentence) continue;
        units.push({ text: sentence, kind: 'sentence', para: p, polite: isPolite(raw) });
        raw.split(CLAUSE_SPLIT).slice(1).forEach((c) => {
          const clause = tidy(c);
          if (clause) units.push({ text: clause, kind: 'clause', para: p, polite: isPolite(c) });
        });
      }
    }
  });
  return { clean, units, paragraphs: paragraphs.length };
}

const endsWithQuestion = (s) => /\?[*_`"'”’»)\]\s]*$/u.test(s);

function snip(clean, text) {
  return String(text).replace(/\s+/g, ' ').trim().slice(0, 120);
}

/** First CTA match in `text` as { id, snippet } (snippet <= 120 chars), or null. */
export function findCta(text) {
  const { clean, units, paragraphs } = toUnits(text);
  const byScope = (...scopes) => CTA_PATTERNS.filter((p) => scopes.includes(p.scope));

  // "Action required: none." - the colon split puts the negation in the next unit.
  const NONE_NEXT = /^(?:nothing|none|nil|n\/a|ничего|нет|никаких|no\s+(?:action|decision)s?)(?![\p{L}\p{N}_])/iu;
  const sentenceAfter = (i) => units.slice(i + 1).find((x) => x.kind === 'sentence');
  for (const [i, u] of units.entries()) {
    if (u.kind === 'sentence' && /:$/.test(u.text) && NONE_NEXT.test(sentenceAfter(i)?.text ?? '')) continue;
    const scopes = u.kind === 'sentence' ? ['sentence', 'both'] : ['clause', 'both'];
    if (u.polite) scopes.push('polite');
    for (const pat of byScope(...scopes)) {
      // 'both' patterns are the strong forms: they apply at a sentence start AND at a clause start.
      if (pat.re.test(u.text)) return { id: pat.id, snippet: snip(clean, u.text) };
    }
  }
  for (const pat of byScope('anywhere')) {
    const re = new RegExp(pat.re.source, pat.re.flags.includes('g') ? pat.re.flags : pat.re.flags + 'g');
    let m;
    while ((m = re.exec(clean)) && pat.negatable && negatedInClause(clean, m.index)) { if (m[0] === '') re.lastIndex++; }
    if (m) {
      const lineEnd = clean.indexOf('\n', m.index);
      const end = lineEnd === -1 ? clean.length : lineEnd;
      return { id: pat.id, snippet: snip(clean, clean.slice(m.index, Math.min(end, m.index + 120))) };
    }
  }

  // Closing question: the last paragraph, plus the one before it when the last is only a
  // short reference line ("Issue: <link>") that the issue-link-last convention puts after it.
  const last = paragraphs - 1;
  const inPara = (p) => units.filter((u) => u.kind === 'sentence' && u.para === p);
  let candidates = inPara(last);
  if (!candidates.some((u) => endsWithQuestion(u.text)) && last > 0) {
    const joined = candidates.map((u) => u.text).join(' ');
    if (joined.length <= 240 && /https?:\/\/|#\d|issue|ссылк/i.test(joined)) candidates = candidates.concat(inPara(last - 1));
  }
  // Strong, unmistakably user-addressed question forms count anywhere in the message.
  for (const u of units) {
    if (u.kind !== 'sentence' || !endsWithQuestion(u.text)) continue;
    for (const pat of byScope('question-any')) {
      if (pat.re.test(u.text)) return { id: pat.id, snippet: snip(clean, u.text) };
    }
  }
  const sentences = units.filter((u) => u.kind === 'sentence');
  for (const u of candidates) {
    if (!endsWithQuestion(u.text)) continue;
    // "How do we handle X: pay now or wait?" - the colon split must not let the question escape.
    const i = sentences.indexOf(u);
    const prev = i > 0 && sentences[i - 1].para === u.para && /:$/.test(sentences[i - 1].text) ? sentences[i - 1].text : '';
    for (const pat of byScope('question')) {
      if (pat.re.test(u.text)) return { id: pat.id, snippet: snip(clean, u.text) };
      if (prev && pat.re.test(prev)) return { id: pat.id, snippet: snip(clean, `${prev} ${u.text}`) };
    }
  }
  return null;
}

function contentParts(entry) {
  const c = entry?.message?.content;
  if (typeof c === 'string') return [{ type: 'text', text: c }];
  return Array.isArray(c) ? c.filter((p) => p && typeof p === 'object') : [];
}

// Prefixes of system-injected "user" messages that do not start a turn.
const INJECTED_PREFIXES = ['<system-reminder>', '<local-command-', '<task-notification>', 'Stop hook feedback', '[Request interrupted'];

/** A real human prompt: user record, not meta/sidechain/tool_result/compaction/hook-injected. */
export function isGenuineUser(entry) {
  if (!entry || entry.type !== 'user' || entry.isMeta === true || entry.isSidechain === true || entry.isCompactSummary === true) return false;
  const parts = contentParts(entry);
  if (parts.some((p) => p.type === 'tool_result')) return false;
  const text = parts.filter((p) => p.type === 'text').map((p) => String(p.text ?? '')).join('\n').trim();
  if (!text) return false;
  return !INJECTED_PREFIXES.some((pre) => text.startsWith(pre));
}

const textOf = (entry) => contentParts(entry).filter((p) => p.type === 'text' && typeof p.text === 'string' && p.text.trim()).map((p) => p.text);

/**
 * The text blocks of the LAST assistant message in the records (the final message of the turn).
 * One API message can be split over several consecutive records sharing `message.id`; those are
 * joined. Returns '' when there is none.
 */
export function finalAssistantText(entries) {
  const list = (Array.isArray(entries) ? entries : []).filter((e) => e && e.type === 'assistant' && e.isSidechain !== true);
  let i = list.length - 1;
  while (i >= 0 && textOf(list[i]).length === 0) i--;
  if (i < 0) return '';
  const id = list[i].message?.id;
  const blocks = textOf(list[i]);
  for (let j = i - 1; id && j >= 0 && list[j].message?.id === id; j--) blocks.unshift(...textOf(list[j]));
  return blocks.join('\n\n');
}

/**
 * Decide on the FINAL assistant message of the turn only: `last_assistant_message` from the Stop
 * input when present (the transcript can lag), otherwise the text blocks of the last assistant
 * message in the transcript. Earlier messages of the turn, and requests from earlier stops that a
 * background-task wake-up re-enters, are not analysed. A final message that follows an
 * AskUserQuestion call is still analysed: a leftover prose request after the prompt blocks.
 * Returns { block: false } or { block: true, id, snippet }.
 */
export function analyzeTurn(entries, lastAssistantMessage = '') {
  const lam = String(lastAssistantMessage ?? '').trim();
  const text = lam || finalAssistantText(entries);
  if (!text) return { block: false };
  const hit = findCta(text);
  return hit ? { block: true, ...hit } : { block: false };
}

/** The block reason handed to the model. */
export function buildReason(snippet) {
  const quoted = String(snippet ?? '').slice(0, 120);
  return (
    `This turn leaves the human an action or decision in prose ("${quoted}"). ` +
    `Per the steward rule 'Human prompts go through AskUserQuestion', ask it now with AskUserQuestion ` +
    `(<=4 questions per call, recommended option first, steps/draft in preview, issue link last). ` +
    `If AskUserQuestion is not available in this session (subagent, scheduled or headless run), ` +
    `make sure each item exists as a founder-action issue and end the turn.`
  );
}

// ------------------------------------------------------------------ side effects

const CHUNK = 1024 * 1024;
const MAX_SCAN = 64 * 1024 * 1024;

/**
 * Read the transcript from the END, in chunks, until the last genuine user message is found.
 * Returns the records after it (chronological). Transcripts reach 50+ MB; a full read is out.
 */
export function readTurnEntries(transcriptPath, chunk = CHUNK, maxScan = MAX_SCAN) {
  const fd = fs.openSync(transcriptPath, 'r');
  try {
    let pos = fs.fstatSync(fd).size;
    const floor = Math.max(0, pos - maxScan);
    let carry = Buffer.alloc(0);
    const reversed = []; // newest first
    while (pos > floor) {
      const len = Math.min(chunk, pos - floor);
      pos -= len;
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, pos);
      const data = Buffer.concat([buf, carry]);
      let complete;
      if (pos > floor) {
        const nl = data.indexOf(0x0a);
        if (nl === -1) { carry = data; continue; }
        carry = data.subarray(0, nl);
        complete = data.subarray(nl + 1);
      } else {
        carry = Buffer.alloc(0);
        complete = data;
      }
      const lines = complete.toString('utf8').split('\n');
      for (let i = lines.length - 1; i >= 0; i--) {
        const s = lines[i].trim();
        if (!s) continue;
        let rec;
        try { rec = JSON.parse(s); } catch { continue; }
        if (isGenuineUser(rec)) return reversed.reverse();
        reversed.push(rec);
      }
    }
    return reversed.reverse();
  } finally {
    fs.closeSync(fd);
  }
}

function isOff(v) {
  return ['off', '0', 'false', 'no'].includes(String(v ?? '').trim().toLowerCase());
}

function main() {
  if (isOff(process.env.OPOS_HUMAN_PROMPT_GATE)) return;
  let stdin = '';
  safe(() => { stdin = fs.readFileSync(0, 'utf8'); });
  const payload = safe(() => JSON.parse(stdin || '{}'), {}) ?? {};
  if (!payload || typeof payload !== 'object' || payload.stop_hook_active === true) return;

  const tp = payload.transcript_path;
  const lam = String(payload.last_assistant_message ?? '').trim();
  // The transcript is only needed when the input carries no final message.
  const entries = !lam && tp && safe(() => fs.existsSync(tp), false) ? (safe(() => readTurnEntries(tp), []) ?? []) : [];
  const verdict = analyzeTurn(entries, lam);
  if (!verdict.block) return;
  process.stdout.write(JSON.stringify({ decision: 'block', reason: buildReason(verdict.snippet) }) + '\n');
}

const isDirect = (() => { try { return !!process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href; } catch { return false; } })();
if (isDirect) {
  safe(main);
  process.exit(0);
}
