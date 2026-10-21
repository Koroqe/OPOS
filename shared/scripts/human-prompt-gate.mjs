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
 *     `last_assistant_message` as well as from the transcript.
 *   - There is NO documented non-interactive signal in the Stop input, and Stop does not fire in
 *     subagents (they use SubagentStop). In a headless `claude -p` run the worst case is one extra
 *     turn; the block reason tells the model to fall back to a `founder-action` issue there.
 *
 * Decision: look only at assistant text of THIS turn (after the last genuine user message). If
 * `AskUserQuestion` was called, only text after the last call counts. Fenced code blocks are
 * stripped first (paste-prompts and commands are legitimate); inline code is NOT stripped,
 * because the token in "reply `1`" is exactly inline code.
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
// A quoted answer token: 1-3 short words, e.g. `1`, 'approve', «да», "go ahead".
const TOKEN = `${OPEN}\\s*${NOQ}{1,24}(?:\\s{1,2}${NOQ}{1,24}){0,2}\\s*${CLOSE}`;
const YOU = '(?:you|your|тебе|тебя|твой|твоя|ваш\\p{L}*)';

/**
 * Each entry: { id, re }. Patterns run case-insensitively with the `u` flag on text with fenced
 * code blocks already removed. Keep them narrow: they must not fire on ordinary reporting text.
 */
export const CTA_PATTERNS = [
  // EN: "reply `1`", "type 'approve'", "answer \"yes\"", "say «go»"
  { id: 'en-reply-quoted', re: new RegExp(`${L}(?:reply|answer|respond|type|say)${R}\\s+(?:with\\s+|just\\s+|simply\\s+)?(?:one word\\s*:?\\s*)?${TOKEN}`, 'iu') },
  // EN: "reply yes", "answer 1 or 2", "respond with no"
  { id: 'en-reply-bare', re: new RegExp(`${L}(?:reply|answer|respond)${R}\\s+(?:with\\s+)?(?:yes|no|y\\/n|ok|\\d+)${R}`, 'iu') },
  // EN: "What I need from you", "what's needed from you"
  { id: 'en-what-i-need', re: new RegExp(`${L}what\\s+(?:i|we)\\s+(?:'d\\s+|would\\s+)?need\\s+from\\s+you${R}|${L}what(?:'s|\\s+is)\\s+needed\\s+from\\s+you${R}`, 'iu') },
  // EN: "needs your decision / approval / go-ahead / sign-off / confirmation / input"
  { id: 'en-needs-your', re: new RegExp(`${L}needs?\\s+your\\s+(?:decision|approval|go(?:-|\\s)?ahead|go|sign-?off|confirmation|input)${R}`, 'iu') },
  // EN: "your call"
  { id: 'en-your-call', re: new RegExp(`${L}your\\s+call${R}`, 'iu') },
  // RU: "ответь `1`", "напиши «да»", "скажи 'ок'"
  { id: 'ru-reply-quoted', re: new RegExp(`${L}(?:ответь|ответьте|напиши|напишите|скажи|скажите)${R}\\s+(?:мне\\s+)?(?:просто\\s+)?${TOKEN}`, 'iu') },
  // RU: "ответь да", "напиши 1 или 2"
  { id: 'ru-reply-bare', re: new RegExp(`${L}(?:ответь|ответьте|напиши|напишите|скажи|скажите)${R}\\s+(?:мне\\s+)?(?:да|нет|ок|\\d+)${R}`, 'iu') },
  // RU: "что мне нужно от тебя", "чего жду от вас", "от тебя нужно ..."
  { id: 'ru-what-i-need', re: new RegExp(`${L}(?:что|чего)\\s+(?:мне\\s+|нам\\s+)?(?:нужно|надо|жду)\\s+от\\s+(?:тебя|вас)${R}|${L}от\\s+(?:тебя|вас)\\s+(?:нужн\\p{L}*|требуется)${R}`, 'iu') },
  // RU: "нужно твоё решение", "нужно ваше одобрение", "жду твоего ответа"
  { id: 'ru-needs-your', re: new RegExp(`${L}нужн\\p{L}*\\s+(?:твоё|твое|ваше)\\s+(?:решение|одобрение|подтверждение|согласие|добро)${R}|${L}жду\\s+(?:твоего|вашего)\\s+(?:решения|ответа|одобрения|подтверждения|добро)${R}`, 'iu') },
  // RU: "тебе решать"
  { id: 'ru-your-call', re: new RegExp(`${L}(?:тебе|вам)\\s+решать${R}`, 'iu') },
  // "founder-action" only when the same sentence addresses the human (plain reporting of a filed
  // issue is not a prompt).
  { id: 'founder-action-addressed', re: new RegExp(`founder-action[^\\n.]{0,80}${L}${YOU}${R}|${L}${YOU}${R}[^\\n.]{0,80}founder-action`, 'iu') },
];

// ------------------------------------------------------------------ pure logic (unit-tested)

/** Remove fenced code blocks (``` or ~~~), including an unterminated trailing fence. */
export function stripFences(text) {
  return String(text ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/```[\s\S]*$/, ' ')
    .replace(/~~~[\s\S]*$/, ' ');
}

/** First CTA match in `text` as { id, snippet } (snippet <= 120 chars), or null. */
export function findCta(text) {
  const clean = stripFences(text);
  for (const { id, re } of CTA_PATTERNS) {
    const m = re.exec(clean);
    if (m) {
      const lineEnd = clean.indexOf('\n', m.index);
      const end = lineEnd === -1 ? clean.length : lineEnd;
      const snippet = clean.slice(m.index, Math.min(end, m.index + 120)).replace(/\s+/g, ' ').trim();
      return { id, snippet };
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

/**
 * Analyse parsed transcript records and decide. The turn boundary (last genuine user message) is
 * applied here, so the caller may pass the whole file or just a tail.
 *   entries              parsed transcript records, chronological
 *   lastAssistantMessage `last_assistant_message` from the hook input (the transcript may lag)
 * Returns { block: false } or { block: true, id, snippet }.
 */
export function analyzeTurn(entries, lastAssistantMessage = '') {
  const list = Array.isArray(entries) ? entries : [];
  let start = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    if (isGenuineUser(list[i])) { start = i + 1; break; }
  }
  const texts = []; // { text, afterAsk }
  for (const entry of list.slice(start)) {
    if (!entry || entry.type !== 'assistant' || entry.isSidechain === true) continue;
    for (const part of contentParts(entry)) {
      if (part.type === 'tool_use' && part.name === 'AskUserQuestion') {
        for (const t of texts) t.afterAsk = false;
      } else if (part.type === 'text' && typeof part.text === 'string' && part.text.trim()) {
        texts.push({ text: part.text, afterAsk: true });
      }
    }
  }
  const relevant = texts.filter((t) => t.afterAsk).map((t) => t.text);
  const lam = String(lastAssistantMessage ?? '').trim();
  // Count the hook's final message only when the (lagging) transcript has not got it yet; if the
  // transcript has it, the afterAsk filter above already decided whether it counts.
  if (lam && !texts.some((t) => t.text.includes(lam))) relevant.push(lam);
  for (const text of relevant) {
    const hit = findCta(text);
    if (hit) return { block: true, ...hit };
  }
  return { block: false };
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
  const entries = tp && safe(() => fs.existsSync(tp), false) ? (safe(() => readTurnEntries(tp), []) ?? []) : [];
  const verdict = analyzeTurn(entries, payload.last_assistant_message);
  if (!verdict.block) return;
  process.stdout.write(JSON.stringify({ decision: 'block', reason: buildReason(verdict.snippet) }) + '\n');
}

const isDirect = (() => { try { return !!process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href; } catch { return false; } })();
if (isDirect) {
  safe(main);
  process.exit(0);
}
