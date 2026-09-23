#!/usr/bin/env node
/**
 * opos-auto-update.mjs — the unattended OPOS update driver, run by .github/workflows/sync-opos.yml.
 *
 * Every day it checks whether a newer OPOS release exists and, if so, applies it and pushes it
 * — with no human involved — but only when that is provably safe. Otherwise it stops and files
 * one `[opos-auto-sync]` issue that says exactly what a human has to do.
 *
 * Why this exists: until v0.18.0 no consumer had a working automatic update path. The shipped
 * Action was manual-only and one real consumer deleted it on day one; the `auto-sync` skill
 * needed a cloud permission that was never granted; the probe was silent. That consumer fell 14
 * releases behind over 81 days and every update it ever received was applied by hand.
 *
 * Design rules, each learned the hard way:
 *   - A plain script, not an LLM run: no API key, no cloud app, nothing to register but a switch.
 *   - Linux runner only. On Windows `copier update` silently drops local customisations
 *     (WinError 206 — RISKS 42).
 *   - A non-zero copier exit is a failure, and `verify-sync.mjs` must report clean.
 *   - A release that changes `.github/workflows/**` is NEVER pushed automatically. GITHUB_TOKEN
 *     cannot (GitHub rejects it: "refusing to allow a GitHub App to create or update workflow …
 *     without `workflows` permission" — verified 2026-09-23), and never-automate invariant 3
 *     forbids a scheduled run from writing workflow files in any case. That release goes to a
 *     human; every other release is applied automatically.
 *   - Leases: take `process:auto-sync` so two drivers never run at once, and stand down while
 *     anyone holds a path lease on a file THIS release changes. (Before v0.19.1 it took `path:**`,
 *     which conflicts with every path lease in the repo: a company that always has someone
 *     editing somewhere, which is the normal state of a busy one, never got an update at all.)
 *   - Escalations turn the run red AND file (or refresh) one issue per tag. A green run that did
 *     nothing is the failure mode this framework keeps paying for.
 *
 * Exit: 0 up to date / applied / deferred (someone editing, release too young) · 1 escalated.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { matchesAny } from '../../.claude/skills/lease/lib/keys.mjs';   // CORE since v0.16.0

// ------------------------------------------------------------------ pure logic (unit-tested)

/** Decide what may be done with the files an update touched. */
export function classifyTouched(files) {
  const norm = files.map((f) => String(f).replace(/\\/g, '/'));
  return {
    workflowFiles: norm.filter((f) => f.startsWith('.github/workflows/')),
    rejects: norm.filter((f) => f.endsWith('.rej')),
    other: norm.filter((f) => !f.startsWith('.github/workflows/') && !f.endsWith('.rej')),
  };
}

/**
 * Is this one of the updater's own issues? Exact title prefix only. GitHub search is fuzzy (it
 * tokenises and ignores brackets), and a human issue that merely mentions OPOS and auto-sync must
 * never be commented on — let alone closed — by an unattended job.
 */
export const PREFIX = '[opos-auto-sync]';
export function isOwnIssue(title, tag = null) {
  const t = String(title ?? '');
  if (!t.startsWith(PREFIX)) return false;
  return tag === null ? true : t.startsWith(`${PREFIX} ${tag}:`);
}

/**
 * Which live path leases cover a file this update changes? `claims` are lease records
 * (`lease.mjs list --json`); a claim blocks when any changed file matches its key glob or any
 * of its scope globs. Leases on files the release does not touch never block it.
 */
export function blockingLeases(claims, files, matchesAny) {
  return (claims ?? []).filter((c) => {
    const key = String(c?.key ?? '');
    if (!key.startsWith('path:')) return false;
    const globs = [key.slice(5), ...(c.scope ?? [])];
    return files.some((f) => matchesAny(f, globs));
  });
}

/** Latest stable release, or null. */
export function pickLatest(releases) {
  return (releases ?? []).find((r) => !r.draft && !r.prerelease) ?? null;
}

export const pinOf = (text) => /_commit:\s*['"]?([^,'"}\s]+)/.exec(String(text))?.[1] ?? null;
export const srcRepoOf = (text) => {
  const src = /_src_path:\s*['"]?([^,'"}\s]+)/.exec(String(text))?.[1] ?? '';
  return /^(?:gh:|https:\/\/github\.com\/|git@github\.com:)([^/]+\/[^/.]+)/.exec(src)?.[1] ?? null;
};

// ------------------------------------------------------------------ side effects

const env = process.env;
const summaryLines = [];
const say = (s = '') => { process.stdout.write(s + '\n'); summaryLines.push(s); };
function flushSummary() {
  if (env.GITHUB_STEP_SUMMARY) { try { fs.appendFileSync(env.GITHUB_STEP_SUMMARY, summaryLines.join('\n') + '\n'); } catch { /* optional */ } }
}
function run(file, args, opts = {}) {
  const r = spawnSync(file, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  return { code: r.status ?? 1, out: r.stdout ?? '', err: r.stderr ?? '' };
}
const sh = (file, args, opts) => execFileSync(file, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts }).trim();

function main() {
  const root = sh('git', ['rev-parse', '--show-toplevel']);
  process.chdir(root);
  const repo = env.GITHUB_REPOSITORY ?? sh('gh', ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']);
  const branch = env.OPOS_DEFAULT_BRANCH || sh('git', ['rev-parse', '--abbrev-ref', 'HEAD']);
  const minAgeH = Number(env.OPOS_MIN_RELEASE_AGE_HOURS ?? 24);

  const answers = fs.readFileSync('.copier-answers.yml', 'utf8');
  const pin = pinOf(answers);
  const upstream = srcRepoOf(answers);
  say(`## OPOS auto-update — ${repo}`);
  if (!upstream) return escalate('config', `cannot parse _src_path in .copier-answers.yml`, `Point \`_src_path\` at \`gh:<owner>/<repo>\` (only that field; never \`_commit\`).`);

  const rel = pickLatest(JSON.parse(sh('gh', ['api', `repos/${upstream}/releases`, '--jq', '[.[] | {tag: .tag_name, draft, prerelease, published: .published_at}]'])));
  if (!rel) { say(`No stable release upstream. Nothing to do.`); return 0; }
  say(`Pinned: **${pin}** · latest upstream: **${rel.tag}** (published ${rel.published})`);
  if (rel.tag === pin) {
    say('Up to date.');
    // A release escalated earlier and then applied by a human leaves its issue open; close it now
    // that the pin shows it landed. Without this an already-resolved escalation lingers forever.
    closeOpenIssues(repo, pin);
    return 0;
  }

  const ageH = (Date.now() - Date.parse(rel.published)) / 3600000;
  if (ageH < minAgeH) {
    say(`Deferred: ${rel.tag} is ${ageH.toFixed(1)}h old; this driver waits ${minAgeH}h so a broken release can be pulled before it spreads. The next run will apply it.`);
    return 0;
  }

  // ---- leases (exit 9 = the company has not opted in: proceed exactly as before)
  const LEASE = '.claude/skills/lease/lease.mjs';
  const leasesHeld = [];
  const lease = (args) => (fs.existsSync(LEASE) ? run(process.execPath, [LEASE, ...args]) : { code: 9, out: '', err: '' });
  const releaseAll = () => { for (const k of leasesHeld) lease(['release', '--key', k, '--reason', 'auto-update run finished']); };
  for (const [key, extra] of [['process:auto-sync', ['--paranoid']]]) {
    const r = lease(['acquire', '--key', key, '--ttl', '30m', '--intent', `automatic OPOS update ${pin} -> ${rel.tag}`, ...extra]);
    if (r.code === 0) { leasesHeld.push(key); continue; }
    if (r.code === 9) break;
    releaseAll();
    if (r.code === 2) { say(`Deferred: \`${key}\` is held — someone is editing or another driver is running. Retrying on the next run.\n\n\`\`\`\n${r.err.trim()}\n\`\`\``); return 0; }
    return escalate(rel.tag, `could not take the \`${key}\` lease (exit ${r.code})`, `\`\`\`\n${(r.err || r.out).trim()}\n\`\`\``);
  }

  try {
    // ---- apply
    const cp = run('copier', ['update', '--vcs-ref', rel.tag, '--conflict', 'rej', '--defaults']);
    if (cp.code !== 0) {
      return escalate(rel.tag, `\`copier update\` exited ${cp.code}`, `A non-zero exit is a failure (it is the step that re-applies local customisations). Nothing was committed.\n\n\`\`\`\n${(cp.err || cp.out).trim().split('\n').slice(-15).join('\n')}\n\`\`\``);
    }
    // Untrimmed on purpose: porcelain lines start with a status column that may be a space
    // (" M file"); trimming the whole output would shift the first line and cut its filename.
    const touched = run('git', ['status', '--porcelain', '--untracked-files=all']).out.split('\n').filter(Boolean)
      .map((l) => l.slice(3).trim().replace(/^"|"$/g, '')).map((f) => (f.includes(' -> ') ? f.split(' -> ')[1] : f));
    const cls = classifyTouched(touched);
    say(`Touched ${touched.length} file(s): ${cls.other.length} ordinary, ${cls.workflowFiles.length} workflow, ${cls.rejects.length} conflict (.rej).`);

    // ---- verify by result
    const vs = run(process.execPath, ['shared/scripts/verify-sync.mjs', '--from', pin]);
    say(`verify-sync: exit ${vs.code} — ${vs.out.trim().split('\n').pop()}`);
    if (vs.code === 2 || vs.code === 3) return escalate(rel.tag, 'verify-sync did not pass', `\`\`\`\n${vs.out.trim()}\n\`\`\`\nNothing was committed.`);
    if (cls.rejects.length) {
      return escalate(rel.tag, `${cls.rejects.length} conflict(s) need a human`, `Upstream and local edits collide in:\n\n${cls.rejects.map((f) => `- \`${f}\``).join('\n')}\n\nNothing was committed. Resolve with the \`sync-from-core\` skill (on Windows: under WSL).`);
    }
    if (cls.workflowFiles.length) {
      return escalate(rel.tag, 'this release changes workflow files, which the automatic driver may not push', [
        'Files:',
        ...cls.workflowFiles.map((f) => `- \`${f}\``),
        '',
        'GitHub refuses workflow-file changes pushed with the Actions token, and never-automate invariant 3 forbids a scheduled run from writing them anyway. Everything else in this release is fine (`verify-sync` clean).',
        '',
        '**One-time human step:** apply this release with the `sync-from-core` skill (on Windows: under WSL), review, commit, push with your own credentials. The next automatic run finds it up to date and carries on by itself.',
      ].join('\n'));
    }

    // ---- reconcile consumer-owned settings (the _skip_if_exists delivery hole)
    // `.claude/settings.json` is consumer-owned, so copier never updates it: a release that adds a
    // hook or a settings key reaches a company only through this merge. sync-from-core and
    // auto-sync have always run it; this driver did not, so since v0.19 no settings change reached
    // any company unattended (measured on the canary: v0.21.0 applied, its new UserPromptSubmit hook
    // and autoCompactWindow absent). The script adds missing non-permission keys, never overwrites a
    // value the company set, and never writes permissions (never-automate invariant 1). Its only
    // refusal (an unparseable settings file) is reported, not escalated: the release itself is
    // still worth applying.
    if (fs.existsSync('shared/scripts/reconcile-settings.py')) {
      const rc = run('python3', ['shared/scripts/reconcile-settings.py', '--apply']);
      const last = (rc.out || rc.err || '').trim().split('\n').filter(Boolean).slice(-3).join(' / ');
      say(`reconcile-settings: exit ${rc.code}${last ? ` — ${last}` : ''}`);
    }

    // ---- stand down while someone is editing a file this release changes
    if (fs.existsSync(LEASE)) {
      const ls = lease(['list', '--json', '--key-prefix', 'path:']);
      if (ls.code === 0) {
        const blockers = blockingLeases(JSON.parse(ls.out || '[]'), cls.other, matchesAny);
        if (blockers.length) {
          say(`Deferred: ${blockers.length} live lease(s) cover files this release changes — someone is editing them. Retrying on the next run.\n\n${blockers.map((c) => `- \`${c.key}\` (${c.intent || 'no intent'})`).join('\n')}`);
          return 0;
        }
        say(`Leases: none of the ${cls.other.length} changed file(s) is being edited.`);
      } else if (ls.code !== 9) {
        return escalate(rel.tag, `could not read the live leases (exit ${ls.code})`, `\`\`\`\n${(ls.err || ls.out).trim()}\n\`\`\``);
      }
    }

    // ---- commit and push
    run('git', ['config', 'user.name', 'github-actions[bot]']);
    run('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
    run('git', ['add', '-A']);
    const msg = `chore(sync): apply OPOS ${rel.tag} (automatic)\n\nApplied by the unattended update driver (.github/workflows/sync-opos.yml).\nPin ${pin} -> ${rel.tag}. copier exit 0, zero conflicts, no workflow files touched,\nverify-sync clean: ${vs.out.trim().split('\n')[0]}`;
    const c = run('git', ['commit', '-q', '-m', msg]);
    if (c.code !== 0) return escalate(rel.tag, 'commit failed', `\`\`\`\n${(c.err || c.out).trim()}\n\`\`\``);
    let p = run('git', ['push', 'origin', `HEAD:${branch}`]);
    if (p.code !== 0) {
      // someone pushed meanwhile: rebase once and retry, never force
      const rb = run('git', ['pull', '--rebase', 'origin', branch]);
      if (rb.code !== 0) { run('git', ['rebase', '--abort']); return escalate(rel.tag, 'could not rebase onto the moving default branch', `\`\`\`\n${(rb.err || rb.out).trim()}\n\`\`\``); }
      p = run('git', ['push', 'origin', `HEAD:${branch}`]);
      if (p.code !== 0) return escalate(rel.tag, 'push rejected', `\`\`\`\n${(p.err || p.out).trim()}\n\`\`\``);
    }
    say(`**Applied ${rel.tag}** and pushed to \`${branch}\` (${sh('git', ['rev-parse', '--short', 'HEAD'])}).`);
    closeOpenIssues(repo, rel.tag);
    return 0;
  } finally {
    releaseAll();
  }

  function escalate(tag, what, details) {
    say(`**Escalated:** ${what}`);
    const title = `[opos-auto-sync] ${tag}: ${what}`;
    const body = `The automatic OPOS update driver stopped and needs a human.\n\n**What:** ${what}\n\n${details}\n\nRun: ${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${env.GITHUB_REPOSITORY ?? repo}/actions/runs/${env.GITHUB_RUN_ID ?? '?'}\n\nThis issue is updated, not duplicated, on every run until the release is applied; it is closed automatically once it is.`;
    const existing = String(ownOpenIssues(repo).find((i) => isOwnIssue(i.title, tag))?.number ?? '');
    if (existing) run('gh', ['issue', 'comment', existing, '--repo', repo, '--body', `Still blocked on this run: ${what}. ${env.GITHUB_SERVER_URL ?? ''}/${repo}/actions/runs/${env.GITHUB_RUN_ID ?? ''}`]);
    else run('gh', ['issue', 'create', '--repo', repo, '--title', title, '--body', body]);
    return 1;
  }
}

function ownOpenIssues(repo) {
  const r = run('gh', ['issue', 'list', '--repo', repo, '--state', 'open', '--limit', '200', '--json', 'number,title']);
  try { return JSON.parse(r.out || '[]').filter((i) => isOwnIssue(i.title)); } catch { return []; }
}

function closeOpenIssues(repo, uptoTag) {
  for (const i of ownOpenIssues(repo)) {
    run('gh', ['issue', 'close', String(i.number), '--repo', repo, '--reason', 'completed', '--comment', `Resolved: this repository is now on OPOS ${uptoTag} (confirmed by the automatic update run).`]);
  }
}

const isDirect = (() => { try { return !!process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href; } catch { return false; } })();
if (isDirect) {
  let code = 1;
  try { code = main(); } catch (e) { say(`**Failed unexpectedly:** ${e.message}`); code = 1; }
  flushSummary();
  process.exit(code);
}
