#!/usr/bin/env node
/**
 * check.mjs — the manual, on-demand version of the `check-for-updates` skill.
 *
 * `SKILL.md`'s 8 steps are written for a session to execute turn-by-turn — useful when the
 * skill is a sub-step of another skill's flow, but wasteful when the steward runs it because a
 * human asked "are we behind?": at full session context each of those steps is its own model
 * request. This script does the whole probe in ONE Bash call: `node .claude/skills/check-for-updates/check.mjs`.
 *
 * Reuses `pinOf`, `srcRepoOf`, `pickLatest` from `shared/scripts/opos-auto-update.mjs` rather
 * than re-deriving the same `.copier-answers.yml` parsing and release-picking logic a second
 * time with its own bugs.
 *
 * Bug fix vs. the original SKILL.md step 6 ("if they differ, print a notice"): that phrasing
 * prints a notice whenever latest != pinned, so an upstream release OLDER than the pin (a
 * consumer pinned ahead of a `gh:` mirror that has not caught up, or a re-tagged/rolled-back
 * release) would be reported as "an update is available" and invite a downgrade. This script
 * does a real semver comparison and only notices when latest > pinned.
 *
 * Cache: this script's own `.claude/.update-probe` (NOT `.claude/.last-update-check`, which is
 * the daily session updater's own flag file — writing to it here in a way that looks like "we
 * already checked today" would make that updater silently skip its scheduled run). 6h
 * freshness; `--force` bypasses. The cache stores the last OBSERVED latest tag, not the notice
 * decision, so a fresh cache still compares against whatever `_commit` currently says (which
 * may have moved since the cache was written, e.g. after a sync).
 *
 * Always exits 0 — this is a status probe, never a gate.
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { pinOf, srcRepoOf, pickLatest } from '../../../shared/scripts/opos-auto-update.mjs';

const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };

// ------------------------------------------------------------------ pure logic (unit-tested)

const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** Parse a `vX.Y.Z` or `X.Y.Z` tag, with an optional `-prerelease` suffix. Null if unparseable. */
export function parseSemver(tag) {
  const m = SEMVER_RE.exec(String(tag ?? '').trim());
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), prerelease: m[4] ?? null };
}

/**
 * -1 / 0 / 1 (a < b / a == b / a > b), or `null` if either side does not parse as semver.
 * Same major.minor.patch: a release (no prerelease suffix) is newer than any prerelease of it.
 */
export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return null;
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
  if (pa.prerelease === pb.prerelease) return 0;
  if (pa.prerelease === null) return 1; // release beats prerelease
  if (pb.prerelease === null) return -1;
  return pa.prerelease < pb.prerelease ? -1 : pa.prerelease > pb.prerelease ? 1 : 0;
}

/** True only when `latest` is a STRICTLY newer semver than `pinned` — the newer-only bug fix. */
export function isNewer(latest, pinned) {
  const c = compareSemver(latest, pinned);
  return c !== null && c > 0;
}

/** Extract the raw `_src_path` value verbatim (before shape classification), or null if absent. */
export function rawSrcPath(text) {
  return /_src_path:\s*['"]?([^,'"}\s]+)/.exec(String(text ?? ''))?.[1] ?? null;
}

/**
 * Classify `.copier-answers.yml`'s `_src_path` into one of the shapes `check-for-updates`
 * recognises. `remote` is resolved via the shared `srcRepoOf` (gh:, git@, https:// GitHub
 * forms). Anything else with a non-empty raw value is `maybe-local` — a candidate filesystem
 * path that `main()` still has to check for existence (a pure function cannot touch the disk).
 */
export function classifySrcPath(text) {
  const raw = rawSrcPath(text);
  if (!raw) return { kind: 'missing', raw: null };
  const repo = srcRepoOf(text);
  if (repo) return { kind: 'remote', repo, raw };
  return { kind: 'maybe-local', raw };
}

/** Newest tag from a `releases` array shaped like the GitHub API response. */
export function pickLatestRelease(releases, includePrerelease) {
  if (includePrerelease) return (releases ?? []).find((r) => !r.draft) ?? null;
  return pickLatest(releases);
}

/** Is `cache` (the parsed `.claude/.update-probe` JSON) still within `freshnessMs` of `nowMs`? */
export function cacheIsFresh(cache, nowMs, freshnessMs) {
  if (!cache || typeof cache !== 'object' || !cache.checked_at) return false;
  const t = Date.parse(cache.checked_at);
  if (Number.isNaN(t)) return false;
  return nowMs - t < freshnessMs;
}

// ------------------------------------------------------------------ side effects

const CACHE_REL = path.join('.claude', '.update-probe');
const FRESHNESS_MS = 6 * 60 * 60 * 1000;
const GH_TIMEOUT_MS = 8000;

function readCache(root) {
  return safe(() => JSON.parse(fs.readFileSync(path.join(root, CACHE_REL), 'utf8')), null);
}
function writeCache(root, data) {
  safe(() => {
    const p = path.join(root, CACHE_REL);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(data) + '\n');
  });
}

function main() {
  const argv = process.argv.slice(2);
  const force = argv.includes('--force');
  const includePrerelease = argv.includes('--include-prerelease');
  const verbose = argv.includes('--verbose');

  const root = safe(
    () => execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(),
    null,
  ) ?? process.cwd();

  const answersText = safe(() => fs.readFileSync(path.join(root, '.copier-answers.yml'), 'utf8'), null);
  if (answersText === null) {
    console.log('[check-for-updates] .copier-answers.yml not found — was this repo scaffolded with copier?');
    return 0;
  }

  const pin = pinOf(answersText);
  if (!pin) {
    console.log('[check-for-updates] cannot read _commit from .copier-answers.yml');
    return 0;
  }

  const cls = classifySrcPath(answersText);
  const cacheKey = cls.repo ?? cls.raw ?? null;
  const cache = force ? null : readCache(root);
  const fresh = !force
    && cacheIsFresh(cache, Date.now(), FRESHNESS_MS)
    && cache?.kind === cls.kind
    && cache?.key === cacheKey
    && cache?.include_prerelease === includePrerelease;

  let latest = null;

  if (cls.kind === 'missing') {
    console.log(`[check-for-updates] cannot parse _src_path in .copier-answers.yml.`);
    return 0;
  }

  if (cls.kind === 'remote') {
    if (fresh) {
      latest = cache.latest;
    } else {
      const r = safe(() => spawnSync('gh', ['api', `repos/${cls.repo}/releases`], {
        encoding: 'utf8', timeout: GH_TIMEOUT_MS,
      }), null);
      if (!r || r.status !== 0 || !r.stdout) return 0; // network/auth/rate-limit: silent, transient
      const releases = safe(() => JSON.parse(r.stdout), null);
      const rel = releases ? pickLatestRelease(releases, includePrerelease) : null;
      if (!rel) return 0;
      latest = rel.tag_name;
      writeCache(root, { checked_at: new Date().toISOString(), kind: 'remote', key: cls.repo, include_prerelease: includePrerelease, latest });
    }
  } else {
    // maybe-local
    const exists = safe(() => fs.existsSync(cls.raw) && fs.statSync(path.join(cls.raw, '.git')).isDirectory(), false);
    if (!exists) {
      console.log(`[check-for-updates] _src_path (${cls.raw}) does not exist on this machine (or is not a local git clone) — update loop is broken here; re-point _src_path to gh:<owner>/<repo> or ensure the clone is present.`);
      return 0;
    }
    if (fresh) {
      latest = cache.latest;
    } else {
      const r = safe(() => spawnSync('git', ['-C', cls.raw, 'tag', '--sort=-v:refname'], {
        encoding: 'utf8', timeout: GH_TIMEOUT_MS,
      }), null);
      if (!r || r.status !== 0) return 0;
      const tags = String(r.stdout ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
      const rel = tags.find((t) => includePrerelease || parseSemver(t)?.prerelease == null);
      if (!rel) return 0;
      latest = rel;
      writeCache(root, { checked_at: new Date().toISOString(), kind: 'maybe-local', key: cls.raw, include_prerelease: includePrerelease, latest });
    }
    console.log(`[check-for-updates] _src_path is a local path (${cls.raw}) — updates only work on this machine. Consider re-pointing it to gh:<owner>/<repo>.`);
  }

  if (!latest) return 0;

  if (isNewer(latest, pin)) {
    console.log(`[check-for-updates] OPOS-core ${latest} is available (you're on ${pin}). The daily session updater applies it automatically; to apply now, ask the steward to run sync-from-core (it runs in a subagent).`);
  } else if (verbose) {
    console.log(`[check-for-updates] pinned (${pin}) is current or ahead of upstream (${latest}) — nothing to do.`);
  }
  return 0;
}

const isDirect = (() => { try { return !!process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href; } catch { return false; } })();
if (isDirect) {
  let code = 0;
  try { code = main(); } catch { code = 0; }
  process.exit(code ?? 0);
}
