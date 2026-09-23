#!/usr/bin/env node
/**
 * opos-session-update.mjs — the daily, in-session OPOS updater. Runs from the SessionStart hook.
 *
 *   node shared/scripts/opos-session-update.mjs                 # hook mode: returns at once
 *   node shared/scripts/opos-session-update.mjs --worker        # the background job itself
 *   node shared/scripts/opos-session-update.mjs --status        # what happened last
 *   ... --worker --force [--min-age <hours>]                    # ignore today's flag (testing)
 *
 * Once a day per clone, the first session that opens starts this in the background and moves on.
 * The background job:
 *   1. claims the day (its own flag `.claude/.opos-update-check` + a lock, so two sessions never both run);
 *   2. asks whether upstream OPOS has a release newer than the one this repo is pinned to on
 *      the remote, and at least `min_release_age_hours` old (default 24: a broken release can be
 *      withdrawn before it spreads);
 *   3. if so, gets it applied to the repo:
 *        - where the repo has the `sync-opos` job switched on, by starting that job and waiting
 *          for it. That is the ONLY safe place on Windows: a native `copier update` there
 *          silently discards local customisations (WinError 206, RISKS 42). It is still this
 *          in-session check that decides and triggers; GitHub only lends a Linux machine;
 *        - otherwise, on Linux/macOS with copier installed, by running the same updater locally
 *          in a throw-away clone, never in the live working tree other sessions are using;
 *        - otherwise it records that a human must run `sync-from-core` (on Windows: under WSL);
 *   4. fast-forwards THIS clone to the remote, so every machine ends up on the latest version
 *      without anyone pulling. Fast-forward only, only on the default branch; git refuses if it
 *      would touch a file someone is editing, and then the job simply leaves the clone alone;
 *   5. writes one small state file. The next session start prints ONE line if something
 *      happened (updated, or needs a human) and nothing otherwise.
 *
 * It never forces, never stashes, never touches uncommitted work, and never pushes a release
 * that changes a workflow file (the updater escalates those — invariant 3).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ------------------------------------------------------------------ pure (unit-tested)

/** Is a daily check due? `flag` is the flag file's text ("<ISO> <tag>"), or null. */
export function isDue(flag, now = new Date()) {
  const iso = String(flag ?? '').trim().split(/\s+/)[0];
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return true;
  return new Date(t).toISOString().slice(0, 10) !== now.toISOString().slice(0, 10);
}

/** Should the hook print a line for this state? Only news, only once. */
export function noticeFor(state) {
  if (!state || state.reported) return null;
  if (state.result === 'updated') return `[opos-update] OPOS ${state.from} -> ${state.to} applied to the repo${state.localFastForward === 'ok' ? ' and this clone' : ''}.`;
  if (state.result === 'needs-human') return `[opos-update] OPOS ${state.to} is available but needs a human: ${state.reason}`;
  if (state.result === 'failed') return `[opos-update] daily update check failed: ${state.reason}`;
  return null;
}

// ------------------------------------------------------------------ helpers

const here = path.dirname(fileURLToPath(import.meta.url));
const run = (file, args, opts = {}) => {
  const r = spawnSync(file, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true, ...opts });
  return { code: r.status ?? 1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
};
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const pinOf = (t) => /_commit:\s*['"]?([^,'"}\s]+)/.exec(String(t))?.[1] ?? null;
const srcOf = (t) => /^(?:gh:|https:\/\/github\.com\/|git@github\.com:)([^/]+\/[^/.]+)/.exec(/_src_path:\s*['"]?([^,'"}\s]+)/.exec(String(t))?.[1] ?? '')?.[1] ?? null;

function paths(root) {
  const c = path.join(root, '.claude');
  return { flag: path.join(c, '.opos-update-check'), lock: path.join(c, '.opos-update.lock'), state: path.join(c, '.opos-update-state.json') };
}
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

// ------------------------------------------------------------------ hook mode

function hook(root) {
  const p = paths(root);
  // 1. report last result once
  const state = readJson(p.state);
  const line = noticeFor(state);
  if (line) {
    process.stdout.write(line + '\n');
    try { fs.writeFileSync(p.state, JSON.stringify({ ...state, reported: true }, null, 2)); } catch { /* fine */ }
  }
  // 2. start today's job in the background, if due
  let flag = null;
  try { flag = fs.readFileSync(p.flag, 'utf8'); } catch { /* never checked */ }
  if (!isDue(flag)) return;
  if (!fs.existsSync(path.join(root, '.copier-answers.yml'))) return;   // not an OPOS consumer
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--worker'], {
    cwd: root, detached: true, stdio: 'ignore', windowsHide: true,
  });
  child.unref();
}

// ------------------------------------------------------------------ worker

function worker(root, { force = false, minAge = null } = {}) {
  const p = paths(root);
  const now = new Date();

  // claim the lock (exclusive create); a lock older than 30 min is a crashed run and is taken over
  try {
    const st = fs.statSync(p.lock);
    if (Date.now() - st.mtimeMs < 30 * 60 * 1000) return;
    fs.rmSync(p.lock, { force: true });
  } catch { /* no lock */ }
  let fd;
  try { fd = fs.openSync(p.lock, 'wx'); } catch { return; }

  const state = { date: now.toISOString(), result: 'up-to-date', reported: false, host: os.hostname() };
  let ran = false;   // only a run that did work may replace the last state (and its unshown notice)
  try {
    if (!force) {
      let flag = null;
      try { flag = fs.readFileSync(p.flag, 'utf8'); } catch { /* none */ }
      if (!isDue(flag, now)) return;
    }
    ran = true;

    const answersLocal = fs.readFileSync(path.join(root, '.copier-answers.yml'), 'utf8');
    const upstream = srcOf(answersLocal);
    if (!upstream) throw new Error('_src_path is not a GitHub repo');

    const view = run('gh', ['repo', 'view', '--json', 'nameWithOwner,defaultBranchRef', '--jq', '.nameWithOwner + " " + .defaultBranchRef.name'], { cwd: root });
    if (view.code !== 0) throw new Error('gh unavailable or not authenticated');
    const [repo, branch] = view.out.split(' ');

    const fetched = run('git', ['fetch', '--quiet', 'origin', branch], { cwd: root });
    if (fetched.code !== 0) throw new Error('git fetch failed');
    const remoteAnswers = run('git', ['show', `origin/${branch}:.copier-answers.yml`], { cwd: root });
    const remotePin = pinOf(remoteAnswers.out) ?? pinOf(answersLocal);

    const rel = run('gh', ['api', `repos/${upstream}/releases`, '--jq', '[.[] | select(.draft == false and .prerelease == false)][0] | .tag_name + " " + .published_at']);
    const [latest, published] = rel.out.split(' ');
    if (rel.code !== 0 || !latest || Number.isNaN(Date.parse(published))) throw new Error(`could not read the latest release of ${upstream}`);
    fs.writeFileSync(p.flag, `${now.toISOString()} ${latest ?? ''}\n`);   // the day is claimed
    state.from = remotePin; state.to = latest;

    if (latest && latest !== remotePin) {
      const ageH = (Date.now() - Date.parse(published)) / 3600000;
      const needAge = minAge ?? 24;
      if (ageH < needAge) {
        state.result = 'waiting';
        state.reason = `${latest} is ${ageH.toFixed(1)}h old; applied once it is ${needAge}h old`;
      } else {
        const hasJob = run('git', ['cat-file', '-e', `origin/${branch}:.github/workflows/sync-opos.yml`], { cwd: root }).code === 0;
        const jobOn = hasJob && run('gh', ['variable', 'get', 'OPOS_AUTO_SYNC', '--repo', repo]).out === 'on';
        if (jobOn) {
          state.via = 'sync-opos job';
          const done = runJobAndWait(repo, needAge);
          Object.assign(state, done);
        } else if (process.platform !== 'win32' && run('copier', ['--version']).code === 0) {
          state.via = 'local updater (throw-away clone)';
          Object.assign(state, runLocally(root, repo, branch, needAge));
        } else {
          state.result = 'needs-human';
          state.reason = process.platform === 'win32'
            ? 'on Windows the update must run on Linux: switch on the sync-opos job (gh variable set OPOS_AUTO_SYNC --body on) or run sync-from-core under WSL'
            : 'copier is not installed here (pip install copier), and the sync-opos job is not switched on';
        }
        run('git', ['fetch', '--quiet', 'origin', branch], { cwd: root });
        const pinAfter = pinOf(run('git', ['show', `origin/${branch}:.copier-answers.yml`], { cwd: root }).out);
        if (state.result === 'up-to-date' && pinAfter !== latest) {
          state.result = 'waiting';
          state.reason = 'the update job deferred it (someone holds an editing lease); it retries on its next run';
        }
      }
    }

    // bring THIS clone to the remote: fast-forward only, default branch only
    const cur = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root }).out;
    const behind = Number(run('git', ['rev-list', '--count', `HEAD..origin/${branch}`], { cwd: root }).out || 0);
    if (cur !== branch) state.localFastForward = `skipped (clone is on ${cur})`;
    else if (!behind) state.localFastForward = 'already current';
    else {
      const ff = run('git', ['merge', '--ff-only', '--quiet', `origin/${branch}`], { cwd: root });
      state.localFastForward = ff.code === 0 ? 'ok' : 'skipped (would touch files being edited here; next day retries)';
    }
    const pinNow = pinOf(fs.readFileSync(path.join(root, '.copier-answers.yml'), 'utf8'));
    if (state.result === 'up-to-date' && pinNow && pinNow !== pinOf(answersLocal)) {
      state.result = 'updated'; state.from = pinOf(answersLocal); state.to = pinNow;   // someone else updated the repo; this clone caught up
    }
  } catch (e) {
    state.result = 'failed';
    state.reason = String(e.message ?? e).split('\n')[0];
    // A failed check still uses up the day: an offline laptop must not retry at every session
    // start. The nightly sync-opos job and tomorrow's check cover the gap.
    try { fs.writeFileSync(p.flag, `${now.toISOString()} failed\n`); } catch { /* fine */ }
  } finally {
    if (ran) { try { fs.writeFileSync(p.state, JSON.stringify(state, null, 2)); } catch { /* fine */ } }
    try { fs.closeSync(fd); fs.rmSync(p.lock, { force: true }); } catch { /* fine */ }
  }
}

/** Start the repo's sync-opos job (or join one already running) and wait for its outcome. */
function runJobAndWait(repo, minAge) {
  const busy = run('gh', ['run', 'list', '--repo', repo, '--workflow', 'sync-opos.yml', '--limit', '5', '--json', 'databaseId,status', '--jq', '[.[] | select(.status != "completed")][0].databaseId']).out;
  let id = busy;
  if (!id) {
    const before = run('gh', ['run', 'list', '--repo', repo, '--workflow', 'sync-opos.yml', '--limit', '1', '--json', 'databaseId', '--jq', '.[0].databaseId']).out;
    const d = run('gh', ['workflow', 'run', 'sync-opos.yml', '--repo', repo, '-f', `min_release_age_hours=${minAge}`]);
    if (d.code !== 0) return { result: 'failed', reason: `could not start the sync-opos job: ${d.err.split('\n')[0]}` };
    for (let i = 0; i < 20 && (!id || id === before); i++) {
      sleep(3000);
      id = run('gh', ['run', 'list', '--repo', repo, '--workflow', 'sync-opos.yml', '--limit', '1', '--json', 'databaseId', '--jq', '.[0].databaseId']).out;
    }
  }
  if (!id) return { result: 'failed', reason: 'the sync-opos job did not start' };
  for (let i = 0; i < 90; i++) {   // up to 15 minutes
    const s = run('gh', ['run', 'view', id, '--repo', repo, '--json', 'status,conclusion', '--jq', '.status + " " + .conclusion']).out;
    const [status, conclusion] = s.split(' ');
    if (status === 'completed') {
      if (conclusion === 'success') return { result: 'up-to-date', job: id };   // applied, deferred or already current — the pin decides below
      return { result: 'needs-human', reason: `the sync-opos job escalated (run ${id}); see the [opos-auto-sync] issue`, job: id };
    }
    sleep(10000);
  }
  return { result: 'failed', reason: `sync-opos run ${id} did not finish within 15 minutes`, job: id };
}

/** Linux/macOS: run the same updater locally, in a throw-away clone — never in the live tree. */
function runLocally(root, repo, branch, minAge) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'opos-update-'));
  try {
    const url = run('git', ['remote', 'get-url', 'origin'], { cwd: root }).out;
    if (run('git', ['clone', '--quiet', '--branch', branch, url, dir]).code !== 0) return { result: 'failed', reason: 'could not clone the repo for the update' };
    const u = run(process.execPath, [path.join(dir, 'shared/scripts/opos-auto-update.mjs')], {
      cwd: dir, env: { ...process.env, GITHUB_REPOSITORY: repo, OPOS_DEFAULT_BRANCH: branch, OPOS_MIN_RELEASE_AGE_HOURS: String(minAge) },
    });
    return u.code === 0 ? { result: 'up-to-date' } : { result: 'needs-human', reason: 'the updater escalated; see the [opos-auto-sync] issue' };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* fine */ }
  }
}

// ------------------------------------------------------------------ entry

const isDirect = (() => { try { return !!process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href; } catch { return false; } })();
if (isDirect) {
  const args = process.argv.slice(2);
  const root = run('git', ['rev-parse', '--show-toplevel']).out || process.cwd();
  try {
    if (args.includes('--worker')) {
      const i = args.indexOf('--min-age');
      worker(root, { force: args.includes('--force'), minAge: i === -1 ? null : Number(args[i + 1]) });
    } else if (args.includes('--status')) {
      process.stdout.write(JSON.stringify(readJson(paths(root).state), null, 2) + '\n');
    } else {
      hook(root);
    }
  } catch { /* a session-start hook must never fail loudly */ }
  process.exit(0);
}
