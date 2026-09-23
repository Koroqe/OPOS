#!/usr/bin/env node
/**
 * context-budget-notice.mjs — `UserPromptSubmit` hook that warns once a session's context has
 * grown large enough that every subsequent request re-reads all of it.
 *
 * Why this exists: token usage is dominated by oversized interactive sessions, not by task
 * size — one measured session ran 28 hours across five unrelated topics, reached 925k tokens of
 * context with zero compactions, and alone was 80% of a week's usage. At that size a single
 * `git status` re-read ~0.9M tokens. This hook is the mechanical trigger the steward's "Context
 * economy" rule reacts to (`.claude/agents/company/chief-of-staff.md`): it cannot fix an
 * oversized session by itself, it can only make the session's own next turn aware of the cost.
 *
 * Mechanics:
 *   - Reads the hook JSON payload from stdin (`session_id`, `transcript_path`, `cwd`).
 *   - Reads the LAST ~4 MB of the transcript JSONL file (a full read of a many-hundred-MB
 *     transcript would itself blow the <200ms budget) and finds the last MAIN-THREAD assistant
 *     record (`type === 'assistant'`, `isSidechain !== true`) that carries a `usage` block.
 *     Subagent turns (`isSidechain: true`) are a different context budget and must not count
 *     against the main thread's notice.
 *   - context = input_tokens + cache_read_input_tokens + cache_creation_input_tokens — the same
 *     three fields that sum to "how much the next turn re-reads".
 *   - Notifies once per BAND: the first band starts at `OPOS_CONTEXT_NOTICE_AT` (default
 *     150000), and a new band opens every additional `OPOS_CONTEXT_NOTICE_STEP` tokens (default
 *     100000) beyond it. The last-notified band is remembered per session in
 *     `<repo-root>/.claude/.sessions/<sanitized-session>.ctx` (that directory already exists for
 *     the lease protocol's SessionStart hook and is gitignored / copier-excluded there).
 *
 * Every step is wrapped — a hook that errors on a fresh clone, a missing transcript, or a
 * malformed payload is worse than no hook at all. Always exits 0. Silent unless a new band was
 * just crossed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };

// ------------------------------------------------------------------ pure logic (unit-tested)

/**
 * Scan a chunk of transcript JSONL text (typically the tail of the file) and return the
 * context-token count of the LAST main-thread assistant record that carries a `usage` block, or
 * `null` if no such record is present in this chunk.
 *
 * Main-thread = `type === 'assistant'` AND `isSidechain !== true`. Lines that fail to parse as
 * JSON (including a truncated first line when the chunk started mid-file) are skipped, not
 * treated as an error.
 */
export function contextFromTranscriptTail(text) {
  const lines = String(text ?? '').split('\n');
  let context = null;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec;
    try { rec = JSON.parse(trimmed); } catch { continue; }
    if (!rec || typeof rec !== 'object') continue;
    if (rec.type !== 'assistant' || rec.isSidechain === true) continue;
    const usage = rec.message && typeof rec.message === 'object' ? rec.message.usage : null;
    if (!usage || typeof usage !== 'object') continue;
    context = num(usage.input_tokens) + num(usage.cache_read_input_tokens) + num(usage.cache_creation_input_tokens);
  }
  return context;
}

/**
 * Which notice band `tokens` falls in.
 *   0                         → below `at`, no notice yet.
 *   1 + floor((tokens-at)/step) → `at` itself is band 1; every further `step` opens the next band.
 */
export function bandFor(tokens, at, step) {
  const t = Number(tokens);
  const a = Number(at);
  const s = Number(step);
  if (!(t >= a) || !(s > 0)) return 0;
  return 1 + Math.floor((t - a) / s);
}

/** A band is notified exactly once: only when it is strictly higher than the last one notified. */
export function shouldNotify(lastBand, band) {
  return band > 0 && band > Number(lastBand ?? 0);
}

// ------------------------------------------------------------------ side effects

const DEFAULT_CAP_BYTES = 4 * 1024 * 1024;

/** Read up to `capBytes` from the END of `transcriptPath`, dropping a possibly-truncated first line. */
export function readTranscriptTail(transcriptPath, capBytes = DEFAULT_CAP_BYTES) {
  const size = fs.statSync(transcriptPath).size;
  const start = Math.max(0, size - capBytes);
  const len = size - start;
  const fd = fs.openSync(transcriptPath, 'r');
  try {
    const buf = Buffer.alloc(len);
    if (len > 0) fs.readSync(fd, buf, 0, len, start);
    let text = buf.toString('utf8');
    if (start > 0) {
      const nl = text.indexOf('\n');
      text = nl === -1 ? '' : text.slice(nl + 1);
    }
    return text;
  } finally {
    fs.closeSync(fd);
  }
}

function sessionStateFile(root, sessionId) {
  const sanitized = String(sessionId ?? 'unknown').slice(0, 64).replace(/[^A-Za-z0-9._-]/g, '_');
  return path.join(root, '.claude', '.sessions', `${sanitized}.ctx`);
}

function readLastBand(file) {
  const raw = safe(() => fs.readFileSync(file, 'utf8'), null);
  const n = Number(String(raw ?? '').trim());
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function writeBand(file, band) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, String(band) + '\n');
}

function formatK(tokens) {
  return Math.round(Number(tokens) / 1000);
}

/** The two human-/model-facing strings this hook can emit. Exported so tests assert on the
 *  exact wording rather than re-deriving it. */
export function buildNotice(tokens) {
  const n = formatK(tokens);
  const systemMessage =
    `[opos-context] This session is at ~${n}k tokens of context — every request now re-reads all of it. ` +
    `If the next goal is a new topic, start a fresh session (/clear) after the steward writes a handoff to ` +
    `the task issue; otherwise /compact.`;
  const additionalContext =
    `[opos-context] This session's context is now ~${n}k tokens. Apply the "Context economy" rule: if the ` +
    `next goal is a new topic, write a handoff to the open task issue via task-update, then propose /clear; ` +
    `if the topic continues, propose /compact instead; delegate multi-step work (an investigation, a sweep, ` +
    `a long Bash sequence) to a subagent so it does not grow this context further.`;
  return {
    systemMessage,
    hookSpecificOutput: {
      hookEventName: 'UserPromptSubmit',
      additionalContext,
    },
  };
}

function main() {
  let stdin = '';
  safe(() => { stdin = fs.readFileSync(0, 'utf8'); });
  const payload = safe(() => JSON.parse(stdin || '{}'), {}) ?? {};
  if (!payload || typeof payload !== 'object') return;

  const transcriptPath = payload.transcript_path;
  if (!transcriptPath || !safe(() => fs.existsSync(transcriptPath), false)) return;

  const root = safe(
    () => execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(),
    null,
  ) || payload.cwd || process.cwd();

  const tail = safe(() => readTranscriptTail(transcriptPath, DEFAULT_CAP_BYTES), '') ?? '';
  const tokens = contextFromTranscriptTail(tail);
  if (tokens === null) return;

  const at = Number(process.env.OPOS_CONTEXT_NOTICE_AT ?? 150000);
  const step = Number(process.env.OPOS_CONTEXT_NOTICE_STEP ?? 100000);
  const band = bandFor(tokens, at, step);
  if (band === 0) return;

  const stateFile = sessionStateFile(root, payload.session_id);
  const lastBand = readLastBand(stateFile);
  if (!shouldNotify(lastBand, band)) return;

  safe(() => writeBand(stateFile, band));
  process.stdout.write(JSON.stringify(buildNotice(tokens)) + '\n');
}

const isDirect = (() => { try { return !!process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href; } catch { return false; } })();
if (isDirect) {
  safe(main);
  process.exit(0);
}
