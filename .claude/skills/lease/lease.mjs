#!/usr/bin/env node
/**
 * lease.mjs — OPOS lease protocol CLI.
 *
 *   acquire | renew | release | steal | list | check | commit-gate | reap | render | doctor | init-ledger
 *
 * The contract is the EXIT CODE, not the text. Callers branch on it:
 *   0 ok · 1 error · 2 conflict · 3 stale clone · 4 no lease · 5 expired/revoked
 *   6 no auth/network · 7 scope violation · 8 clock skew
 *
 * Why a script and not agent judgement: lease arithmetic is mechanics. A number that either is
 * or is not zero cannot drift the way a convention does, and cannot quietly stop being applied.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { identity, repoRoot, readJson, writeJson, stateDir } from './lib/identity.mjs';
import { parseKey, conflicts, keyHash, claimTarget, matchesAny, KeyError } from './lib/keys.mjs';
import { freshness, stagedFiles } from './lib/freshness.mjs';
import {
  renderRecord, listClaims, getClaim, postClaim, patchClaim, deleteClaim,
  addLabel, removeLabel, isLive, isExpired, sameHolder,
} from './lib/claims.mjs';
import { sleep, gh, ghJson } from './lib/sh.mjs';
import { renderProjection } from './lib/render.mjs';

export const EXIT = {
  OK: 0, ERROR: 1, CONFLICT: 2, STALE: 3, NO_LEASE: 4,
  REVOKED: 5, NO_AUTH: 6, SCOPE: 7, SKEW: 8, NOT_CONFIGURED: 9,
};

/*
 * 9 NOT_CONFIGURED is deliberately distinct from every failure code. A consumer that has
 * not run `init-ledger` has not opted in to the protocol, and the task-lifecycle skills
 * must then behave exactly as they did before leases existed — skip the gate with a one-line
 * notice, never block. Upgrading a company must not change its behaviour until it chooses to.
 */
const OFFLINE_OK_COMMANDS = new Set(['check', 'commit-gate', 'list']);

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      if (eq !== -1) { out[a.slice(2, eq)] = a.slice(eq + 1); continue; }
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[a.slice(2)] = true;
      else { out[a.slice(2)] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

function configPath(root) {
  // OPOS_LEASE_CONFIG lets the test suite point at a throwaway registry without touching
  // the company's real one.
  return process.env.OPOS_LEASE_CONFIG ?? path.join(root, '.claude', 'lease.config.json');
}

function loadConfig(root) {
  const p = configPath(root);
  const cfg = readJson(p);
  if (!cfg) die(EXIT.NOT_CONFIGURED, `lease protocol not configured: no ${p}. Opt in with: lease.mjs init-ledger --create`);
  cfg.ledger = cfg.ledger ?? {};
  // One source of truth for "which repo is our task store". A null here means: reuse the value
  // the task-lifecycle skills already read, so a consumer configures the repo in exactly one file.
  if (!cfg.ledger.repo) {
    cfg.ledger.repo = readJson(path.join(root, '.claude', 'task-tracking.config.json'))?.repo ?? null;
  }
  if (!cfg.ledger.repo) {
    die(EXIT.NOT_CONFIGURED, 'lease protocol not configured: no ledger repo (set ledger.repo in .claude/lease.config.json, or repo in .claude/task-tracking.config.json)');
  }
  return cfg;
}
function saveConfig(root, cfg, { keepRepo = false } = {}) {
  const onDisk = readJson(configPath(root)) ?? {};
  const next = { ...cfg, ledger: { ...cfg.ledger } };
  // Do not bake the resolved fallback into the file: if it was null on disk it stays null, so
  // the repo keeps living in exactly one place.
  if (!keepRepo && !(onDisk.ledger?.repo)) next.ledger.repo = null;
  delete next.ledger.prev;
  writeJson(configPath(root), next);
}

function parseDuration(v, fallbackS) {
  if (v === undefined || v === true || v === null || v === '') return fallbackS;
  const m = /^([0-9]+)\s*([smhd]?)$/i.exec(String(v).trim());
  if (!m) return fallbackS;
  return Number(m[1]) * ({ s: 1, m: 60, h: 3600, d: 86400 }[(m[2] || 's').toLowerCase()]);
}

const heldDir = (root) => path.join(stateDir(root), 'held');
const heldFile = (root, key) => path.join(heldDir(root), keyHash(key) + '.json');

function out(s = '') { process.stdout.write(s + '\n'); }
function warn(s) { process.stderr.write(s + '\n'); }
function die(code, msg) { if (msg) warn(msg); process.exit(code); }

function enforceModeFor(cfg, type) {
  // Env override: lets the test suite exercise enforce=on without flipping the repo config,
  // and lets one scheduled runtime be strict while interactive sessions are still in warn.
  if (process.env.OPOS_LEASE_ENFORCE) return process.env.OPOS_LEASE_ENFORCE;
  const e = cfg.enforce;
  if (typeof e === 'string') return e;
  if (e && typeof e === 'object') return e[type] ?? e.default ?? 'warn';
  return 'warn';
}

function context(args, { needClock = true, scope = [] } = {}) {
  const root = repoRoot();
  const cfg = loadConfig(root);
  if (!cfg.ledger?.issue) {
    die(EXIT.NOT_CONFIGURED, 'lease protocol not configured (no registry issue). Opt in with: lease.mjs init-ledger --create');
  }
  const id = identity({ root, withClock: needClock });
  let offline = false;
  if (!id.loginOk) {
    // --offline-ok is honoured only for commands that can be answered from the local cache,
    // and only a cached lease that has not expired can then open a gate. Anything that would
    // have to WRITE a claim cannot be done offline, by construction.
    if (args['offline-ok'] && OFFLINE_OK_COMMANDS.has(args._cmd)) {
      offline = true;
      warn(`[lease] OFFLINE: gh unavailable (${String(id.loginErr ?? '').split('\n')[0]}). Answering from the local cache only; nothing is verified against GitHub.`);
    } else {
      die(EXIT.NO_AUTH, `gh unavailable or unauthenticated: ${id.loginErr ?? 'unknown'}\n` +
        `  no provable lease -> no shared-area write. Re-auth with: gh auth login`);
    }
  }
  const skew = Math.abs(id.clock.skew_s ?? 0);
  if (needClock && skew > (cfg.clock_skew_fail_s ?? 600)) {
    die(EXIT.SKEW, `clock skew ${id.clock.skew_s}s vs GitHub (limit ${cfg.clock_skew_fail_s}s). Fix the clock; refusing to participate.`);
  }
  if (needClock && skew > (cfg.clock_skew_warn_s ?? 120)) {
    warn(`[lease] WARN clock skew ${id.clock.skew_s}s vs GitHub — expiry still uses server time, but records will look odd.`);
  }
  const ctx = { root, cfg, id, nowMs: id.clock.ms, scope, args, offline };
  if (!offline) {
    // A cached login can make identity look healthy while the network is down; the registry
    // read is then the first call that fails. For commands that may run offline, that failure
    // degrades to offline mode instead of exit 6 — otherwise --offline-ok could never apply
    // in the one situation it exists for.
    const soft = !!args['offline-ok'] && OFFLINE_OK_COMMANDS.has(args._cmd);
    if (!resolveLedger(ctx, { soft })) {
      ctx.offline = true;
      warn('[lease] OFFLINE: the registry is unreachable. Answering from the local cache only; nothing is verified against GitHub.');
    }
  }
  return ctx;
}

/**
 * Find the live registry. A registry closed WITH a `opos-lease-ledger-next: N` marker was
 * rotated by `reap` and is followed; one closed WITHOUT it was closed by a human, which is a
 * stop (exit 1) with the repair command — GitHub still accepts comments on a closed issue, so
 * silently carrying on would keep the protocol "working" against a registry nobody watches.
 *
 * Also records the predecessor (`opos-lease-ledger-prev: N`) so claims written before a
 * rotation stay visible until they lapse. Comment ids are repo-global and monotonic, so the
 * lowest-id tiebreak remains valid across the two issues.
 *
 * Cached for ten minutes: one extra call per ten minutes, not one per command.
 */
function resolveLedger(ctx, { soft = false } = {}) {
  const cacheFile = path.join(stateDir(ctx.root), 'ledger.json');
  const cached = readJson(cacheFile);
  if (cached && cached.repo === ctx.cfg.ledger.repo && cached.start === ctx.cfg.ledger.issue
      && Date.now() - Date.parse(cached.at) < 10 * 60 * 1000) {
    ctx.cfg.ledger.issue = cached.issue;
    ctx.cfg.ledger.prev = cached.prev ?? null;
    return true;
  }
  const start = ctx.cfg.ledger.issue;
  let issue = start;
  for (let hop = 0; hop < 5; hop++) {
    const r = ghJson(['api', `repos/${ctx.cfg.ledger.repo}/issues/${issue}`, '--jq', '{state: .state, body: .body}']);
    if (!r.ok) {
      if (/not found|404/i.test(r.err)) die(EXIT.ERROR, `lease registry ${ctx.cfg.ledger.repo}#${issue} does not exist. Repair: lease.mjs init-ledger --create --force`);
      if (soft) return false;
      die(EXIT.NO_AUTH, `cannot read the lease registry: ${r.err}`);
    }
    const body = r.data?.body ?? '';
    if (r.data?.state === 'closed') {
      const next = /opos-lease-ledger-next:\s*([0-9]+)/.exec(body);
      if (!next) {
        die(EXIT.ERROR, `the lease registry ${ctx.cfg.ledger.repo}#${issue} was closed by hand (no rotation pointer).\n` +
          `  Nothing is watching it any more. Reopen it, or: lease.mjs init-ledger --create --force`);
      }
      issue = Number(next[1]);
      continue;
    }
    const prev = /opos-lease-ledger-prev:\s*([0-9]+)/.exec(body);
    ctx.cfg.ledger.issue = issue;
    ctx.cfg.ledger.prev = prev ? Number(prev[1]) : null;
    try { writeJson(cacheFile, { repo: ctx.cfg.ledger.repo, start, issue, prev: ctx.cfg.ledger.prev, at: new Date().toISOString() }); } catch { /* cache is optional */ }
    if (issue !== start) warn(`[lease] registry rotated: ${start} -> ${issue}. Update ledger.issue in lease.config.json when convenient.`);
    return true;
  }
  die(EXIT.ERROR, 'lease registry rotation chain is longer than 5 hops — refusing to follow it');
}

/** Claims for a target. For the registry that means the live issue AND its predecessor. */
function listTarget(ctx, target) {
  if (target.kind !== 'ledger' || !ctx.cfg.ledger.prev) return listClaims(target);
  const cur = listClaims(target);
  if (!cur.ok) return cur;
  const old = listClaims({ repo: target.repo, issue: ctx.cfg.ledger.prev });
  const claims = [...cur.claims, ...(old.ok ? old.claims : [])].sort((a, b) => a.id - b.id);
  return { ok: true, claims };
}

function buildRecord(ctx, k, { ttlS, scope, intent, fresh, state = 'held', nonce = null }) {
  const now = ctx.nowMs;
  return {
    v: 1, key: k.norm, state,
    nonce: nonce ?? randomUUID().replace(/-/g, '').slice(0, 16).toUpperCase(),
    holder: ctx.id.holder,
    clone: {
      root: fresh.root, branch: fresh.branch, head: fresh.head,
      upstream: fresh.upstream, upstream_head: fresh.upstream_head,
      behind: fresh.behind, ahead: fresh.ahead,
      dirty_outside_scope: fresh.dirty_outside_scope, fetched_at: fresh.fetched_at,
    },
    scope, intent: intent ?? '',
    t: {
      acquired: new Date(now).toISOString(),
      heartbeat: new Date(now).toISOString(),
      expires: new Date(now + ttlS * 1000).toISOString(),
      ttl_s: ttlS,
      local_clock: new Date().toISOString(),
      skew_s: ctx.id.clock.skew_s ?? 0,
    },
    ledger: null,
    index: { label: null, applied: false },
  };
}

function describeHolder(rec) {
  const h = rec.holder ?? {};
  const until = rec.t?.expires ? rec.t.expires.slice(11, 16) + ' UTC' : '?';
  return `${h.login ?? '?'} @ ${h.host ?? '?'} (clone ${h.clone_id ?? '?'}, ${h.runtime ?? '?'}) until ${until}` +
    (rec.intent ? ` — "${rec.intent}"` : '');
}

/**
 * The highest-value gate in the skill. Refuses BEFORE work starts rather than discovering the
 * problem at push time, when the work is already done and the temptation to force it is highest.
 */
function freshnessGate(ctx, k, scope, args) {
  const cfg = ctx.cfg;
  const f = freshness(ctx.root, {
    scope,
    dirtyWindowS: cfg.dirty_mtime_window_s ?? 1800,
    maxAgeS: cfg.fetch_max_age_s ?? 600,
    autoFetch: !args['no-fetch'],
  });
  const limit = args['max-behind'] !== undefined ? Number(args['max-behind']) : (cfg.max_behind?.[k.type] ?? 0);

  if (f.behind > limit) {
    die(EXIT.STALE,
      `STALE CLONE: ${f.behind} commits behind ${f.upstream ?? 'upstream'} (limit ${limit} for ${k.type}: keys).\n` +
      `  Fix, do not work around:  git pull --ff-only\n` +
      `  This refuses rather than warns on purpose: a stale clone that reports success is worse than a crash.`);
  }
  if (!Number.isFinite(f.fetch_age_s) && !args['no-fetch']) {
    die(EXIT.STALE, 'STALE CLONE: could not establish fetch freshness (no FETCH_HEAD, fetch failed). Run: git fetch origin');
  }
  if ((k.type === 'path' || k.type === 'branch') && f.dirty_outside_scope > 0 && !args['force-dirty']) {
    die(EXIT.STALE,
      `DIRTY OUTSIDE SCOPE: ${f.dirty_outside_scope} recently-modified tracked file(s) outside your scope:\n` +
      f.dirty_outside_files.map((x) => `    ${x}`).join('\n') +
      '\n  Another session is probably live in this tree (a file you did not touch, modified minutes ago).' +
      '\n  Override with --force-dirty only if you know whose those files are.');
  }
  return f;
}

function cacheHeld(ctx, k, target, claim) {
  fs.mkdirSync(heldDir(ctx.root), { recursive: true });
  writeJson(heldFile(ctx.root, k), {
    key: k.norm, type: k.type, repo: target.repo, issue: target.issue, kind: target.kind,
    comment_id: claim.id, expires: claim.rec.t.expires, nonce: claim.rec.nonce,
    scope: claim.rec.scope ?? [], holder: claim.rec.holder, cached_at: new Date().toISOString(),
  });
}

/**
 * Cross-post: for repos listed in `cross_post_repos` we may only have comment rights (no labels,
 * no assignees). The authoritative lease still lives in our own ledger; this is a visible pointer.
 * It ADVERTISES intent, it does not exclude — a session in that repo that does not run this
 * protocol takes no lease and is not stopped by one.
 */
function crossPost(ctx, k, rec) {
  if (ctx.args?.['no-cross-post']) return;
  if (k.type !== 'issue') return;
  if (!(ctx.cfg.cross_post_repos ?? []).includes(k.full)) return;
  const body = `\u{1F512} An OPOS lease was taken on this issue by **${rec.holder.login}** (${rec.holder.host}, ${rec.holder.runtime}), until ${rec.t.expires.slice(11, 16)} UTC.\n\n` +
    `The authoritative record lives in the lease registry at ${rec.ledger.repo}#${rec.ledger.issue}. This comment is informational: we may not hold label rights in this repository, so a lease here ADVERTISES intent — it does not exclude parallel work.`;
  gh(['api', '--method', 'POST', `/repos/${k.full}/issues/${k.number}/comments`, '--input', '-'], { input: JSON.stringify({ body }) });
}

function cmdAcquire(args) {
  const scope = String(args.scope ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const ctx = context(args, { scope });
  const k = parseKey(String(args.key));
  const cfg = ctx.cfg;

  if (k.type === 'path' && k.glob === '**' && !args.intent) {
    die(EXIT.ERROR, 'path:** locks the whole tree. Refusing without --intent.');
  }
  const ttlDefault = cfg.ttl_s?.[ctx.id.holder.runtime] ?? 2700;
  const ttlS = parseDuration(args.ttl, ttlDefault);
  const cap = cfg.hard_cap_ttl_s ?? 14400;
  if (ttlS > cap && !args.long) die(EXIT.ERROR, `ttl ${ttlS}s exceeds hard cap ${cap}s — pass --long with --intent if genuinely needed.`);

  const effScope = scope.length ? scope : (k.type === 'path' ? [k.glob] : []);
  const fresh = freshnessGate(ctx, k, effScope, args);

  // Barrier for the deliberate-collision test: both processes POST in the same instant.
  if (args.at) {
    const t = Date.parse(String(args.at));
    if (!Number.isNaN(t)) { const d = t - Date.now(); if (d > 0) sleep(d); }
  }

  const target = claimTarget(k, cfg);
  const settle = Number(args['settle-ms'] ?? cfg.settle_ms ?? 1500) * (args.paranoid ? 2 : 1);
  const retries = Number(args.retries ?? cfg.acquire_retries ?? 2);

  for (let attempt = 0; attempt <= retries; attempt++) {
    // READ — fast path. The common case (already held) costs one GET and writes NOTHING,
    // which is what stops a polling fleet from generating comment churn.
    const pre = listTarget(ctx, target);
    if (!pre.ok) {
      if (pre.rateLimited) { sleep(2000 * (attempt + 1)); continue; }
      die(EXIT.NO_AUTH, `cannot read claims: ${pre.err}`);
    }
    const live = pre.claims.filter((c) => isLive(c.rec, ctx.nowMs) && conflicts(c.rec.key, k));
    const mine = live.find((c) => sameHolder(c.rec.holder, ctx.id.holder) && c.rec.key === k.norm);
    if (mine) {
      /*
       * Re-acquiring my own lease with a WIDER --scope must widen it. The first cut silently
       * kept the original scope, so a holder who legitimately needed one more path got a
       * commit-gate refusal (exit 7) for a lease it already held, with no way to fix it short
       * of release-then-reacquire. A gate that cannot be satisfied by doing the right thing
       * teaches people to bypass the gate.
       *
       * Widening only: paths are added, never dropped, so this can never quietly shrink the
       * scope another step is relying on.
       */
      const merged = Array.from(new Set([...(mine.rec.scope ?? []), ...effScope]));
      const widened = merged.length !== (mine.rec.scope ?? []).length;
      if (widened) {
        mine.rec.scope = merged;
        mine.rec.t.heartbeat = new Date(ctx.nowMs).toISOString();
        if (args.intent) mine.rec.intent = String(args.intent);
        patchClaim(target.repo, mine.id, renderRecord(mine.rec));
      }
      cacheHeld(ctx, k, target, mine);
      out(args.json ? JSON.stringify({ ok: true, key: k.norm, already: true, widened, scope: mine.rec.scope, comment_id: mine.id, expires: mine.rec.t.expires }, null, 2)
                    : `ALREADY HELD ${k.norm} until ${mine.rec.t.expires.slice(11, 16)} UTC${widened ? ` (scope widened to ${merged.length} path(s))` : ''}`);
      return EXIT.OK;
    }
    if (live.length) {
      const b = live[0];
      warn(`CONFLICT: ${k.norm} contended by ${b.rec.key}\n  held by ${describeHolder(b.rec)}\n  claim: ${target.repo}#${target.issue} comment ${b.id}`);
      if (args.json) out(JSON.stringify({ ok: false, code: EXIT.CONFLICT, key: k.norm, holder: b.rec.holder, expires: b.rec.t.expires, intent: b.rec.intent }));
      return EXIT.CONFLICT;
    }

    const rec = buildRecord(ctx, k, { ttlS, scope: effScope, intent: args.intent ? String(args.intent) : '', fresh });
    const posted = postClaim(target, renderRecord(rec));
    if (!posted.ok) {
      if (posted.rateLimited) {
        const wait = (posted.retryAfter ?? 5 * (attempt + 1)) * 1000;
        warn(`[lease] secondary rate limit; backing off ${wait}ms`);
        sleep(wait); continue;
      }
      die(EXIT.NO_AUTH, `cannot post claim: ${posted.err}`);
    }
    rec.ledger = { repo: target.repo, issue: target.issue, comment_id: posted.id };

    // SETTLE — GitHub's comment list is replica-served; a POST is not guaranteed visible to an
    // immediately following GET. This wait is empirical, not contractual (SKILL.md Residual 1).
    sleep(settle);

    const after = listTarget(ctx, target);
    if (!after.ok) {
      deleteClaim(target.repo, posted.id);
      die(EXIT.NO_AUTH, `cannot re-read after posting (claim withdrawn): ${after.err}`);
    }
    const contenders = after.claims.filter((c) => isLive(c.rec, ctx.nowMs) && conflicts(c.rec.key, k));
    const winner = contenders[0];
    if (!winner) { deleteClaim(target.repo, posted.id); continue; }

    if (winner.id !== posted.id) {
      deleteClaim(target.repo, posted.id);
      if (attempt < retries) { sleep(300 + Math.floor(Math.random() * 1200) * Math.pow(2, attempt)); continue; }
      warn(`CONFLICT: lost the tiebreak on ${k.norm}\n  winner ${describeHolder(winner.rec)} (comment ${winner.id} < ${posted.id})`);
      if (args.json) out(JSON.stringify({ ok: false, code: EXIT.CONFLICT, key: k.norm, holder: winner.rec.holder, lost_tiebreak: true }));
      return EXIT.CONFLICT;
    }

    rec.index.label = cfg.index_label ?? null;
    if (target.kind === 'issue' && cfg.index_label) {
      rec.index.applied = addLabel(target.repo, target.issue, cfg.index_label).ok;
    }
    patchClaim(target.repo, posted.id, renderRecord(rec));
    cacheHeld(ctx, k, target, { id: posted.id, rec });
    crossPost(ctx, k, rec);

    out(args.json ? JSON.stringify({ ok: true, key: k.norm, comment_id: posted.id, expires: rec.t.expires, url: posted.url }, null, 2)
                  : `ACQUIRED ${k.norm} until ${rec.t.expires.slice(11, 16)} UTC (clone ${ctx.id.holder.clone_id}, comment ${posted.id})`);
    return EXIT.OK;
  }
  warn(`CONFLICT: could not acquire ${k.norm} after ${retries + 1} attempts`);
  return EXIT.CONFLICT;
}

function cachedKeys(root) {
  try {
    return fs.readdirSync(heldDir(root)).filter((f) => f.endsWith('.json'))
      .map((f) => readJson(path.join(heldDir(root), f))?.key).filter(Boolean);
  } catch { return []; }
}

function releaseIndex(ctx, k, cached) {
  if (k.type === 'issue' && cached.issue && ctx.cfg.index_label && cached.kind === 'issue') {
    removeLabel(cached.repo, cached.issue, ctx.cfg.index_label);
  }
}

function cmdRenew(args) {
  const ctx = context(args);
  const keys = args.all ? cachedKeys(ctx.root) : [String(args.key)];
  if (!keys.length) { out('renew: nothing cached'); return EXIT.OK; }
  if (keys[0] === 'undefined') die(EXIT.ERROR, 'renew needs --key <k> or --all');
  let worst = EXIT.OK;
  for (const rawKey of keys) {
    const k = parseKey(rawKey);
    const cached = readJson(heldFile(ctx.root, k));
    if (!cached) { warn(`NO LEASE cached for ${k.norm}`); worst = Math.max(worst, EXIT.NO_LEASE); continue; }
    const got = getClaim(cached.repo, cached.comment_id);
    /*
     * A transient failure must not be read as a revocation. Only a genuine 404 means the claim
     * is gone; a timeout, a 5xx or a rate-limit means we simply do not know right now. Dropping
     * the cache on "do not know" silently converts a held lease into no lease at all — the
     * holder keeps working, believing it is covered, while the key reads as free to everyone
     * else. That is the exact failure this skill exists to prevent, so it must not be the
     * skill's own behaviour.
     */
    if (!got.ok && !got.missing) {
      warn(`renew: cannot reach GitHub for ${k.norm} (${String(got.err).split('\n')[0]}). Lease KEPT; retry before writing.`);
      worst = Math.max(worst, EXIT.NO_AUTH); continue;
    }
    if (!got.claim) {
      warn(`REVOKED: claim comment for ${k.norm} is gone (stolen or pruned). Stop writing.`);
      fs.rmSync(heldFile(ctx.root, k), { force: true });
      worst = Math.max(worst, EXIT.REVOKED); continue;
    }
    const rec = got.claim.rec;
    if (!sameHolder(rec.holder, ctx.id.holder) || rec.state !== 'held') {
      warn(`REVOKED: ${k.norm} is now state=${rec.state}, holder ${describeHolder(rec)}. Stop writing.`);
      fs.rmSync(heldFile(ctx.root, k), { force: true });
      worst = Math.max(worst, EXIT.REVOKED); continue;
    }
    // Re-check freshness: a clone that fell behind mid-run must YIELD, not silently continue.
    const f = freshness(ctx.root, { scope: rec.scope ?? [], maxAgeS: ctx.cfg.fetch_max_age_s ?? 600, autoFetch: !args['no-fetch'] });
    const limit = ctx.cfg.max_behind?.[k.type] ?? 0;
    if (f.behind > limit) {
      rec.state = 'yielded';
      rec.reason = `clone fell ${f.behind} commits behind while the work was in flight`;
      rec.t.heartbeat = new Date(ctx.nowMs).toISOString();
      rec.t.expires = new Date(ctx.nowMs).toISOString();
      patchClaim(cached.repo, cached.comment_id, renderRecord(rec));
      releaseIndex(ctx, k, cached);
      fs.rmSync(heldFile(ctx.root, k), { force: true });
      warn(`STALE MID-RUN: yielded ${k.norm} — clone fell ${f.behind} behind. git pull --ff-only, then re-acquire.`);
      worst = Math.max(worst, EXIT.STALE); continue;
    }
    const ttlS = parseDuration(args.ttl, rec.t.ttl_s ?? 2700);
    rec.t.heartbeat = new Date(ctx.nowMs).toISOString();
    rec.t.expires = new Date(ctx.nowMs + ttlS * 1000).toISOString();
    rec.t.ttl_s = ttlS;
    rec.t.local_clock = new Date().toISOString();
    rec.t.skew_s = ctx.id.clock.skew_s ?? 0;
    rec.clone.head = f.head; rec.clone.behind = f.behind; rec.clone.branch = f.branch;
    const p = patchClaim(cached.repo, cached.comment_id, renderRecord(rec));
    if (!p.ok) { warn(`renew failed for ${k.norm}: ${p.err}`); worst = Math.max(worst, EXIT.ERROR); continue; }
    cacheHeld(ctx, k, { repo: cached.repo, issue: cached.issue, kind: cached.kind }, { id: cached.comment_id, rec });
    if (!args.quiet) out(`RENEWED ${k.norm} until ${rec.t.expires.slice(11, 16)} UTC`);
  }
  return worst;
}

function cmdRelease(args) {
  const ctx = context(args);
  const keys = args.all ? cachedKeys(ctx.root) : [String(args.key)];
  if (keys[0] === 'undefined') die(EXIT.ERROR, 'release needs --key <k> or --all');
  for (const rawKey of keys) {
    const k = parseKey(rawKey);
    const cached = readJson(heldFile(ctx.root, k));
    if (!cached) { warn(`no cached lease for ${k.norm} (already released?)`); continue; }
    const got = getClaim(cached.repo, cached.comment_id);
    if (got.ok && got.claim) {
      const rec = got.claim.rec;
      if (sameHolder(rec.holder, ctx.id.holder)) {
        rec.state = args.state && args.state !== true ? String(args.state) : 'released';
        rec.reason = args.reason ? String(args.reason) : '';
        rec.t.heartbeat = new Date(ctx.nowMs).toISOString();
        rec.t.expires = new Date(ctx.nowMs).toISOString();
        patchClaim(cached.repo, cached.comment_id, renderRecord(rec));
      } else warn(`not my lease any more (${describeHolder(rec)}) — leaving the record alone`);
    }
    releaseIndex(ctx, k, cached);
    fs.rmSync(heldFile(ctx.root, k), { force: true });
    out(`RELEASED ${k.norm}`);
  }
  return EXIT.OK;
}

function cmdSteal(args) {
  const ctx = context(args);
  const k = parseKey(String(args.key));
  if (!args.reason) die(EXIT.ERROR, 'steal requires --reason — taking over another holder\u2019s work is a human decision and must stay legible afterwards.');
  const target = claimTarget(k, ctx.cfg);
  const all = listTarget(ctx, target);
  if (!all.ok) die(EXIT.NO_AUTH, all.err);
  const victim = all.claims.filter((c) => isLive(c.rec, ctx.nowMs) && conflicts(c.rec.key, k))[0];
  if (!victim) { warn(`nothing live to steal on ${k.norm} — just acquire it.`); return EXIT.OK; }
  const ageS = (ctx.nowMs - Date.parse(victim.rec.t.heartbeat)) / 1000;
  const ttl = victim.rec.t.ttl_s ?? 2700;
  /*
   * Floor = HALF the TTL of silence, not a multiple of it.
   *
   * The first cut of this used 2xTTL and was unreachable by construction: a live lease has
   * expires = heartbeat + ttl, so its heartbeat is always younger than one TTL. A 2xTTL floor
   * could therefore only ever be cleared by a lease that had ALREADY expired — where stealing
   * is pointless, because anyone can simply acquire it. The guard looked strict and in fact
   * never guarded anything. Caught by scenario G on 22.09.2026.
   *
   * Half a TTL is the honest shortcut steal exists to provide: a holder that is alive renews
   * well inside that window, so clearing the floor really does mean "this one went quiet".
   */
  const floor = Math.max(60, Math.floor(ttl / 2));
  if (ageS < floor && !args.force) {
    die(EXIT.CONFLICT, `refusing to steal: last heartbeat ${Math.round(ageS)}s ago, floor is half the TTL = ${floor}s.\n` +
      `  held by ${describeHolder(victim.rec)}\n` +
      `  a live holder renews well inside this window. Wait, or pass --force with a reason you can defend.`);
  }
  const rec = victim.rec;
  rec.state = 'stolen';
  rec.reason = String(args.reason);
  rec.stolen_by = ctx.id.holder;
  rec.t.heartbeat = new Date(ctx.nowMs).toISOString();
  rec.t.expires = new Date(ctx.nowMs).toISOString();
  patchClaim(target.repo, victim.id, renderRecord(rec));
  out(`STOLEN ${k.norm} from ${rec.holder.login}@${rec.holder.host} — now free. Acquire it to hold it.`);
  return EXIT.OK;
}

/** Warn-only mode still COUNTS. Slice 5 flips enforcement only after a human reads these. */
function recordWouldBlock(ctx, keyNorm, code, msg) {
  const f = path.join(stateDir(ctx.root), 'would-block.jsonl');
  try {
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.appendFileSync(f, JSON.stringify({ at: new Date().toISOString(), key: keyNorm, code, msg, holder: ctx.id.holder }) + '\n');
  } catch { /* never fail a gate because bookkeeping failed */ }
}

function cmdCheck(args) {
  const ctx = context(args, { needClock: !args['no-net'] });
  const k = parseKey(String(args.key));
  const mode = enforceModeFor(ctx.cfg, k.type);
  const cached = readJson(heldFile(ctx.root, k));

  const fail = (code, msg) => {
    if (mode === 'on') { if (!args.quiet) warn(msg); return code; }
    if (mode === 'warn') { warn(`[lease] WARN (enforce=warn, would have exited ${code}) ${msg}`); recordWouldBlock(ctx, k.norm, code, msg); return EXIT.OK; }
    return EXIT.OK;
  };

  if (!cached) return fail(EXIT.NO_LEASE, `NO LEASE on ${k.norm} — run: lease.mjs acquire --key "${k.norm}"`);
  if (Date.parse(cached.expires) <= ctx.nowMs) {
    return fail(EXIT.REVOKED, `LEASE EXPIRED on ${k.norm} (expired ${cached.expires}) — re-acquire before writing.`);
  }
  if (!args['no-net'] && !args.fast && !ctx.offline) {
    const got = getClaim(cached.repo, cached.comment_id);
    // Same rule as renew: unreachable is not revoked. Fail closed on the gate (exit 6) but do
    // NOT destroy the cache, so a blip does not cost a lease that is still perfectly valid.
    if (!got.ok && !got.missing) {
      if (!args['offline-ok']) {
        return fail(EXIT.NO_AUTH, `cannot verify ${k.norm} against GitHub (${String(got.err).split('\n')[0]}). Lease kept; retry.`);
      }
      // --offline-ok: the unexpired cache (already checked above) is the verdict. Say so loudly.
      warn(`[lease] OFFLINE: could not verify ${k.norm} against GitHub; trusting the unexpired local cache (until ${cached.expires}).`);
    } else {
      if (!got.claim) return fail(EXIT.REVOKED, `LEASE GONE on ${k.norm} — the claim comment no longer exists.`);
      if (!sameHolder(got.claim.rec.holder, ctx.id.holder) || got.claim.rec.state !== 'held') {
        return fail(EXIT.REVOKED, `LEASE REVOKED on ${k.norm}: state=${got.claim.rec.state}, holder ${describeHolder(got.claim.rec)}`);
      }
    }
  }
  if (!args.quiet) out(`OK ${k.norm} held until ${cached.expires.slice(11, 16)} UTC`);
  return EXIT.OK;
}

function cmdCommitGate(args) {
  const ctx = context(args, { needClock: true });
  const staged = stagedFiles(ctx.root);
  if (!staged.length) { out('commit-gate: nothing staged'); return EXIT.OK; }

  const maxFiles = Number(args['max-files'] ?? ctx.cfg.max_staged_files ?? 40);
  const mode = enforceModeFor(ctx.cfg, 'path');
  const soft = (code, msg) => {
    if (mode === 'on') { warn(msg); return code; }
    warn(`[lease] WARN (enforce=warn, would have exited ${code})\n${msg}`);
    recordWouldBlock(ctx, 'commit-gate', code, msg);
    return EXIT.OK;
  };

  if (staged.length > maxFiles) {
    return soft(EXIT.SCOPE, `SCOPE: ${staged.length} staged files exceeds the guard of ${maxFiles}.\n` +
      '  Stage the paths you actually wrote; never `git add -A` / `git add .` / `git commit -a`.');
  }

  const held = cachedKeys(ctx.root).map((kk) => readJson(heldFile(ctx.root, parseKey(kk)))).filter(Boolean)
    .filter((c) => Date.parse(c.expires) > ctx.nowMs);
  const scope = held.flatMap((c) => c.scope ?? []);
  if (!scope.length) {
    return soft(EXIT.NO_LEASE, `NO LEASE with a scope — nothing authorizes these ${staged.length} staged path(s).\n` +
      '  lease.mjs acquire --key "path:<glob>" --scope "<glob>" --intent "<why>"');
  }
  const outside = staged.filter((f) => !matchesAny(f, scope));
  if (outside.length) {
    return soft(EXIT.SCOPE, `SCOPE VIOLATION: ${outside.length} staged path(s) outside your lease scope [${scope.join(', ')}]:\n` +
      outside.map((f) => `    ${f}`).join('\n') + '\n  Unstage them (git restore --staged <path>) — do not widen the commit.');
  }
  // A successful gate is also a heartbeat: work demonstrably happened, so the lease is alive.
  if (!args['no-renew'] && !ctx.offline) { try { cmdRenew({ all: true, 'no-fetch': true, quiet: true }); } catch { /* best effort */ } }
  out(`commit-gate OK: ${staged.length} staged path(s) within [${scope.join(', ')}]`);
  return EXIT.OK;
}

function cmdList(args) {
  const ctx = context(args, { needClock: !args['no-net'] });
  if (args['no-net'] || ctx.offline) {
    const rows = cachedKeys(ctx.root).map((kk) => readJson(heldFile(ctx.root, parseKey(kk)))).filter(Boolean);
    if (args.json) out(JSON.stringify(rows, null, 2));
    else if (!rows.length) out('(no cached leases)');
    else rows.forEach((r) => out(`${r.key}  (cached, until ${r.expires})`));
    return EXIT.OK;
  }
  const claims = gatherAllClaims(ctx);
  let rows = claims;
  if (args['key-prefix']) rows = rows.filter((c) => c.rec.key.startsWith(String(args['key-prefix'])));
  if (args.key) { const k = parseKey(String(args.key)); rows = rows.filter((c) => conflicts(c.rec.key, k)); }
  if (args.mine) rows = rows.filter((c) => sameHolder(c.rec.holder, ctx.id.holder));
  if (!args.all) rows = rows.filter((c) => isLive(c.rec, ctx.nowMs));

  if (args.json) { out(JSON.stringify(rows.map((c) => ({ comment_id: c.id, ...c.rec })), null, 2)); return EXIT.OK; }
  if (!rows.length) { out('(no live leases)'); return EXIT.OK; }
  for (const c of rows) out(`${String(c.rec.state).padEnd(9)} ${c.rec.key}  <-  ${describeHolder(c.rec)}`);
  return EXIT.OK;
}

/**
 * Every claim the fleet can see, in 1 + k calls: the ledger issue, plus one read per issue
 * carrying the index label. k is bounded by how many issues are genuinely in flight (a WIP
 * limit), not by the size of the backlog — which is what makes this scale.
 */
function gatherAllClaims(ctx) {
  const ledger = { repo: ctx.cfg.ledger.repo, issue: ctx.cfg.ledger.issue, kind: 'ledger' };
  const res = listTarget(ctx, ledger);
  if (!res.ok) die(EXIT.NO_AUTH, res.err);
  const all = [...res.claims];
  if (ctx.cfg.index_label) {
    const labelled = ghJson(['issue', 'list', '--repo', ledger.repo, '--label', ctx.cfg.index_label,
      '--state', 'open', '--limit', '100', '--json', 'number,title']);
    if (labelled.ok) {
      for (const it of labelled.data ?? []) {
        const own = listClaims({ repo: ledger.repo, issue: it.number });
        if (own.ok) all.push(...own.claims.map((c) => ({ ...c, issueTitle: it.title, issueNumber: it.number })));
      }
    }
  }
  const seen = new Set();
  return all.filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true))).sort((a, b) => a.id - b.id);
}

/**
 * Rotate the registry when it grows past `rotate_at_comments` records.
 *
 * Order is chosen so a crash at any point is recoverable by simply running reap again:
 *   1. find an already-created successor (an open registry whose body says prev: <old>) —
 *      so a crash after step 2 never produces a second successor;
 *   2. otherwise create it, carrying `opos-lease-ledger-prev: <old>`;
 *   3. point the old registry at it (`opos-lease-ledger-next: <new>`) and close it;
 *   4. record the new number locally.
 * Until step 3 lands, everyone keeps using the old registry, which is still open and valid.
 * After it, resolveLedger follows the pointer, and claims written to the old registry stay
 * visible through the predecessor link until they lapse — so no live lease is lost.
 */
function rotateLedger(ctx) {
  const repo = ctx.cfg.ledger.repo;
  const old = ctx.cfg.ledger.issue;
  const label = ctx.cfg.ledger_label ?? 'lease-ledger';
  const marker = `opos-lease-ledger-prev: ${old} `;

  let num = null;
  const open = ghJson(['issue', 'list', '--repo', repo, '--label', label, '--state', 'open', '--limit', '20', '--json', 'number,body']);
  if (open.ok) {
    const existing = (open.data ?? []).find((i) => i.number !== old && String(i.body ?? '').includes(marker));
    if (existing) num = existing.number;
  }
  if (!num) {
    const created = gh(['issue', 'create', '--repo', repo, '--label', label,
      '--title', 'OPOS lease registry — DO NOT CLOSE, DO NOT COMMENT BY HAND',
      '--body', LEDGER_BODY + '\n<!-- ' + marker + '-->']);
    if (!created.ok) return { ok: false, err: created.err };
    num = Number(path.basename(created.out.trim()));
  }

  // Pin the new registry, unpin the old one. Best-effort: GraphQL-only, and an unpinned
  // registry still works — it is just easier to lose.
  const pin = (n, op) => {
    const node = gh(['api', `repos/${repo}/issues/${n}`, '--jq', '.node_id']);
    if (node.ok) gh(['api', 'graphql', '-f', `query=mutation($id:ID!){${op}(input:{issueId:$id}){issue{number}}}`, '-F', `id=${node.out.trim()}`]);
  };
  pin(num, 'pinIssue');
  pin(old, 'unpinIssue');

  const ob = ghJson(['api', `repos/${repo}/issues/${old}`, '--jq', '{body: .body}']);
  if (!ob.ok) return { ok: false, err: ob.err };
  let body = String(ob.data?.body ?? '');
  body = /<!-- opos-lease-ledger-next:\s*[0-9]*\s*-->/.test(body)
    ? body.replace(/<!-- opos-lease-ledger-next:\s*[0-9]*\s*-->/, `<!-- opos-lease-ledger-next: ${num} -->`)
    : body + `\n\n<!-- opos-lease-ledger-next: ${num} -->`;
  const patched = gh(['api', '--method', 'PATCH', `repos/${repo}/issues/${old}`, '--input', '-'],
    { input: JSON.stringify({ body, state: 'closed', state_reason: 'completed' }) });
  if (!patched.ok) return { ok: false, err: patched.err };

  saveConfig(ctx.root, { ...ctx.cfg, ledger: { ...ctx.cfg.ledger, issue: num } });
  try { fs.rmSync(path.join(stateDir(ctx.root), 'ledger.json'), { force: true }); } catch { /* fine */ }
  return { ok: true, from: old, to: num };
}

function cmdReap(args) {
  const ctx = context(args);
  const ledger = { repo: ctx.cfg.ledger.repo, issue: ctx.cfg.ledger.issue };
  const claims = gatherAllClaims(ctx);
  const graceS = parseDuration(args.grace, 600);
  // Accepts both '7' (bare = days, matching prune_after_days in config) and '7d'/'168h'.
  // Number('7d') is NaN, and a NaN threshold compares false forever — the prune would have
  // silently never run while looking configured. Exactly the class this whole skill exists for.
  const pruneRaw = args['prune-after'] ?? ctx.cfg.prune_after_days ?? 7;
  const pruneMs = /^[0-9]+$/.test(String(pruneRaw))
    ? Number(pruneRaw) * 86400 * 1000
    : parseDuration(pruneRaw, 7 * 86400) * 1000;
  const dry = !!args.dry;
  const actions = [];

  for (const c of claims) {
    const rec = c.rec;
    const repo = rec.ledger?.repo ?? ledger.repo;
    if (rec.state === 'held' && isExpired(rec, ctx.nowMs - graceS * 1000)) {
      actions.push({ what: 'expire', comment_id: c.id, key: rec.key, holder: rec.holder?.clone_id });
      if (!dry) {
        rec.state = 'expired';
        rec.reason = 'TTL lapsed; holder stopped heart-beating';
        patchClaim(repo, c.id, renderRecord(rec));
      }
    }
    const terminalAge = ctx.nowMs - Date.parse(rec.t?.heartbeat ?? rec.t?.acquired ?? 0);
    if (['released', 'yielded', 'expired', 'stolen'].includes(rec.state) && terminalAge > pruneMs) {
      actions.push({ what: 'prune', comment_id: c.id, key: rec.key });
      if (!dry) deleteClaim(repo, c.id);
    }
  }

  // Index reconciliation, BOTH directions. The label is an index, never a source of truth:
  // a crash between POST and label call makes it lie in one direction or the other.
  if (ctx.cfg.index_label) {
    const labelled = ghJson(['issue', 'list', '--repo', ledger.repo, '--label', ctx.cfg.index_label,
      '--state', 'open', '--limit', '100', '--json', 'number']);
    if (labelled.ok) {
      for (const it of labelled.data ?? []) {
        const key = `issue:${ledger.repo}#${it.number}`;
        const liveHere = claims.some((c) => c.rec.key === key && isLive(c.rec, ctx.nowMs));
        if (!liveHere) {
          actions.push({ what: 'unlabel', issue: it.number });
          if (!dry) removeLabel(ledger.repo, it.number, ctx.cfg.index_label);
        }
      }
      const known = new Set((labelled.data ?? []).map((it) => it.number));
      for (const c of claims) {
        if (!isLive(c.rec, ctx.nowMs)) continue;
        const m = /^issue:([^#]+)#([0-9]+)$/.exec(c.rec.key);
        if (!m || m[1] !== ledger.repo) continue;
        const n = Number(m[2]);
        if (!known.has(n)) {
          actions.push({ what: 'relabel', issue: n });
          if (!dry) addLabel(ledger.repo, n, ctx.cfg.index_label);
        }
      }
    }
  }
  // Rotation: count lease records still on the live registry after pruning.
  const limit = Number(ctx.cfg.rotate_at_comments ?? 400);
  const liveIssue = listClaims({ repo: ctx.cfg.ledger.repo, issue: ctx.cfg.ledger.issue });
  const count = liveIssue.ok ? liveIssue.claims.length : 0;
  if (args['rotate-now'] || count > limit) {
    actions.push({ what: 'rotate', records: count, limit, forced: !!args['rotate-now'] });
    if (!dry) {
      const r = rotateLedger(ctx);
      actions.push(r.ok ? { what: 'rotated', from: r.from, to: r.to } : { what: 'rotate-failed', err: String(r.err).split('\n')[0] });
    }
  }
  out(JSON.stringify({ ok: true, dry, at: new Date(ctx.nowMs).toISOString(), actions }, null, 2));
  return EXIT.OK;
}

/**
 * Strip the one volatile line so two renders of the SAME lease set compare equal.
 * Without this the generated_at stamp changes on every run, the ops-board bot sees a diff
 * every weekday and commits noise over real history — which is exactly the kind of
 * always-moving artefact that trains people to stop reading a file.
 */
function renderIsIdempotent(a, b) {
  const strip = (t) => String(t)
    .replace(/\*\*Снимок на [^*]+\*\*/g, '**Снимок**')
    .replace(/"generated_at":"[^"]*"/g, '"generated_at":""');
  return strip(a) === strip(b);
}

function cmdRender(args) {
  const ctx = context(args, { needClock: true });
  const claims = gatherAllClaims(ctx);
  const text = renderProjection(claims, {
    nowMs: ctx.nowMs, cfg: ctx.cfg,
    ledger: { repo: ctx.cfg.ledger.repo, issue: ctx.cfg.ledger.issue },
  });

  const dest = args.out && args.out !== true ? String(args.out) : null;
  if (!dest) { process.stdout.write(text); return EXIT.OK; }

  const abs = path.isAbsolute(dest) ? dest : path.join(ctx.root, dest);
  let prev = null;
  try { prev = fs.readFileSync(abs, 'utf8'); } catch { /* first run */ }
  if (prev !== null && renderIsIdempotent(prev, text)) {
    out('render: occupancy unchanged, file left untouched (no bot commit)');
    return EXIT.OK;
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text);
  out(`render: wrote ${dest}`);
  return EXIT.OK;
}

function cmdDoctor(args) {
  const root = repoRoot();
  const cfg = loadConfig(root);
  const id = identity({ root, withClock: true });
  const f = freshness(root, { scope: [], maxAgeS: cfg.fetch_max_age_s ?? 600, autoFetch: !args['no-fetch'] });
  const auth = gh(['auth', 'status']);
  const ledgerOk = cfg.ledger?.issue
    ? ghJson(['api', `/repos/${cfg.ledger.repo}/issues/${cfg.ledger.issue}`, '--jq', '{state: .state, title: .title}'])
    : { ok: false, err: 'ledger issue not initialised (lease.mjs init-ledger --issue <N>)' };
  const skew = Math.abs(id.clock.skew_s ?? 0);

  const report = {
    identity: id.holder,
    login_ok: id.loginOk,
    clock: {
      source: id.clock.source, skew_s: id.clock.skew_s,
      verdict: skew > (cfg.clock_skew_fail_s ?? 600) ? 'FAIL' : skew > (cfg.clock_skew_warn_s ?? 120) ? 'WARN' : 'OK',
    },
    clone: {
      root: f.root, branch: f.branch, head: f.head, behind: f.behind, ahead: f.ahead,
      upstream: f.upstream, fetch_age_s: f.fetch_age_s, dirty_total: f.dirty_total,
    },
    ledger: {
      repo: cfg.ledger?.repo, issue: cfg.ledger?.issue, reachable: ledgerOk.ok,
      state: ledgerOk.data?.state ?? null, err: ledgerOk.ok ? null : ledgerOk.err,
    },
    enforce: cfg.enforce,
    index_label: cfg.index_label,
    gh_auth: ((auth.err || '') + (auth.out || '')).split('\n').map((l) => l.trim()).filter((l) => /Token scopes|Logged in/.test(l)),
    held_cached: cachedKeys(root),
    node: process.version,
  };
  out(JSON.stringify(report, null, 2));
  return (!id.loginOk || report.clock.verdict === 'FAIL' || !report.ledger.reachable) ? EXIT.ERROR : EXIT.OK;
}

const LEDGER_BODY = [
  '**This issue is the lease registry. Do not close it. Do not comment on it by hand.**',
  '',
  'Every comment here is one lease on one key, written and edited by',
  '`.claude/skills/lease/lease.mjs`. `reap` deletes terminal records older than a week and',
  'cannot tell a stray human comment from litter.',
  '',
  '<!-- opos-lease-ledger:v1 -->',
  '<!-- opos-lease-ledger-next: -->',
  '',
  '## Why this exists',
  '',
  'Multiple sessions, machines and runtimes write to this company at once: interactive',
  'sessions, scheduled jobs, CI bots, cloud routines. None of them can see the others.',
  'The signals that look like occupancy are not: local task state is per-machine, an',
  'assignee means ownership rather than occupancy, and a board column is moved by hand.',
  '',
  '## The protocol, in ten lines',
  '',
  '1. Keys: `issue:<owner>/<repo>#<N>`, `path:<glob>`, `process:<name>`, `branch:<name>`.',
  '2. `acquire` reads live claims; if the key is taken it exits 2 having written nothing.',
  '3. If free, it posts its claim as a comment.',
  '4. It waits a settle window: comment lists are replica-served, so a POST is not',
  '   guaranteed visible to the GET that follows it.',
  '5. It re-reads. The **lowest comment id** among live claims wins — ids are',
  '   server-assigned and monotonic.',
  '6. The loser **deletes its own comment** and backs off with jitter.',
  '7. The winner applies the index label and caches a back-pointer locally.',
  '8. `renew` edits the same comment (PATCH); edits do not notify.',
  '9. A lease **expires on its own**. `reap` only tidies records — correctness never',
  '   depends on it having run.',
  '10. `release` and `steal` move a record to a terminal state, with a reason.',
  '',
  '## What does not live here',
  '',
  'Leases on issues of THIS repository are held as a comment on the issue itself, so a',
  'human reading the task sees them. Everything else lives here: `path:`, `process:`,',
  '`branch:`, and issues of repositories where we lack label rights.',
  '',
  'Full documentation: `.claude/skills/lease/SKILL.md`.',
].join('\n');

function cmdInitLedger(args) {
  const root = repoRoot();
  const cfg = loadConfig(root);
  if (cfg.ledger.issue && !args.force) { out(`ledger already at ${cfg.ledger.repo}#${cfg.ledger.issue}`); return EXIT.OK; }

  let num = Number(args.issue);

  if (!num && args.create) {
    const label = cfg.ledger_label ?? 'lease-ledger';
    gh(['label', 'create', label, '--repo', cfg.ledger.repo, '--color', '5319E7',
      '--description', 'Lease registry. Exactly one open issue carries this label']);
    const existing = ghJson(['issue', 'list', '--repo', cfg.ledger.repo, '--label', label,
      '--state', 'open', '--limit', '5', '--json', 'number']);
    if (existing.ok && (existing.data ?? []).length) {
      num = existing.data[0].number;
      out(`found an existing open ledger: #${num}`);
    } else {
      const created = gh(['issue', 'create', '--repo', cfg.ledger.repo, '--label', label,
        '--title', 'OPOS lease registry — DO NOT CLOSE, DO NOT COMMENT BY HAND',
        '--body', LEDGER_BODY]);
      if (!created.ok) die(EXIT.ERROR, `could not create the ledger issue: ${created.err}`);
      num = Number(path.basename(created.out.trim()));
      out(`created ledger issue #${num}`);
      // Pin it so it stays findable. REST has no pin endpoint; this is GraphQL-only and is
      // best-effort — an unpinned ledger still works, it is just easier to lose.
      const nodeId = gh(['api', `repos/${cfg.ledger.repo}/issues/${num}`, '--jq', '.node_id']);
      if (nodeId.ok) {
        gh(['api', 'graphql', '-f',
          'query=mutation($id:ID!){pinIssue(input:{issueId:$id}){issue{number}}}',
          '-F', `id=${nodeId.out.trim()}`]);
      }
    }
  }

  if (!num) {
    die(EXIT.ERROR, 'init-ledger needs --create (opens and pins the registry) or --issue <N> (register an existing one)');
  }
  cfg.ledger.issue = num;
  saveConfig(root, cfg);
  out(`ledger registered: ${cfg.ledger.repo}#${num}`);

  // The index label is created lazily on first acquire, but making it now means a fresh
  // consumer never sees a confusing label-creation failure mid-protocol.
  if (cfg.index_label) {
    gh(['label', 'create', cfg.index_label, '--repo', cfg.ledger.repo, '--color', 'FBCA04',
      '--description', 'Held by a live session (lease comment). Set and cleared automatically']);
  }
  return EXIT.OK;
}


/**
 * audit — read-only anomaly report over live leases. Consumed by the ops-pulse Monday detector,
 * which reports to a human and changes nothing. Kept here rather than in ops-pulse so the rules
 * live with the data model they describe, and ops-pulse only has to render.
 */
function cmdAudit(args) {
  const ctx = context(args, { needClock: true });
  const claims = gatherAllClaims(ctx);
  const cfg = ctx.cfg;
  const hours = (iso) => (ctx.nowMs - Date.parse(iso ?? '')) / 3600000;
  const findings = [];

  const live = claims.filter((c) => isLive(c.rec, ctx.nowMs));

  for (const c of live) {
    const r = c.rec;
    if ((r.clone?.behind ?? 0) > 0) {
      findings.push({ kind: 'holder-on-stale-clone', key: r.key, holder: `${r.holder?.login}@${r.holder?.host}`, behind: r.clone.behind,
        note: 'holder would be writing from a stale clone' });
    }
    const age = hours(r.t?.acquired);
    if (age > 4) {
      findings.push({ kind: 'long-held', key: r.key, holder: `${r.holder?.login}@${r.holder?.host}`, hours: Number(age.toFixed(1)),
        note: 'live work, or a forgotten process?' });
    }
    if (Math.abs(r.t?.skew_s ?? 0) > (cfg.clock_skew_warn_s ?? 120)) {
      findings.push({ kind: 'clock-skew', key: r.key, holder: `${r.holder?.login}@${r.holder?.host}`, skew_s: r.t.skew_s });
    }
  }

  for (const c of claims) {
    if (c.rec.state === 'held' && isExpired(c.rec, ctx.nowMs)) {
      findings.push({ kind: 'expired-not-reaped', key: c.rec.key, expired: c.rec.t?.expires,
        note: 'free for anyone to take; reap has not tidied the record yet' });
    }
  }

  // paused + live lease: a pause issued on machine B while machine A is actually working.
  // Reported, never auto-fixed — auto-fixing would let the wrong machine kill live work.
  const paused = ghJson(['issue', 'list', '--repo', cfg.ledger.repo, '--label', 'paused', '--state', 'open', '--limit', '100', '--json', 'number']);
  if (paused.ok) {
    for (const it of paused.data ?? []) {
      const key = `issue:${cfg.ledger.repo}#${it.number}`;
      if (live.some((c) => c.rec.key === key)) {
        findings.push({ kind: 'paused-but-leased', key, note: 'task is paused but the lease is live — fix by hand, never automatically' });
      }
    }
  }

  // Index drift, both directions. The label is an index, never a source of truth.
  if (cfg.index_label) {
    const labelled = ghJson(['issue', 'list', '--repo', cfg.ledger.repo, '--label', cfg.index_label, '--state', 'open', '--limit', '100', '--json', 'number']);
    if (labelled.ok) {
      const have = new Set((labelled.data ?? []).map((i) => i.number));
      for (const n of have) {
        if (!live.some((c) => c.rec.key === `issue:${cfg.ledger.repo}#${n}`)) {
          findings.push({ kind: 'label-without-lease', issue: n, note: `label ${cfg.index_label} is set but no live lease exists` });
        }
      }
      for (const c of live) {
        const m = /^issue:([^#]+)#([0-9]+)$/.exec(c.rec.key);
        if (m && m[1] === cfg.ledger.repo && !have.has(Number(m[2]))) {
          findings.push({ kind: 'lease-without-label', issue: Number(m[2]), note: `lease is live but the ${cfg.index_label} label is missing` });
        }
      }
    }
  }

  const report = { at: new Date(ctx.nowMs).toISOString(), live: live.length, total: claims.length, findings };
  if (args.json) out(JSON.stringify(report, null, 2));
  else {
    out(`live leases: ${live.length} (records total: ${claims.length})`);
    if (!findings.length) out('no anomalies');
    for (const f of findings) out(`  - ${f.kind}: ${f.key ?? '#' + f.issue} — ${f.note ?? ''}`);
  }
  return EXIT.OK;
}

const COMMANDS = {
  acquire: cmdAcquire, renew: cmdRenew, release: cmdRelease, steal: cmdSteal,
  list: cmdList, check: cmdCheck, 'commit-gate': cmdCommitGate, reap: cmdReap,
  render: cmdRender, doctor: cmdDoctor, 'init-ledger': cmdInitLedger, audit: cmdAudit,
};

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  if (!cmd || cmd === '--help' || cmd === '-h') {
    out('lease.mjs <command> [flags]');
    out('');
    out(`  ${Object.keys(COMMANDS).join(' | ')}`);
    out('');
    out('Exit: 0 ok · 1 error · 2 conflict · 3 stale clone · 4 no lease · 5 revoked · 6 no auth · 7 scope · 8 skew · 9 not configured');
    return EXIT.OK;
  }
  const fn = COMMANDS[cmd];
  if (!fn) { warn(`unknown command: ${cmd}`); return EXIT.ERROR; }
  const args = parseArgs(argv.slice(1));
  args._cmd = cmd;
  try { return fn(args) ?? EXIT.OK; }
  catch (e) {
    if (e instanceof KeyError) { warn(`bad key: ${e.message}`); return EXIT.ERROR; }
    warn(`lease ${cmd} failed: ${e.stack ?? e.message}`);
    return EXIT.ERROR;
  }
}

process.exit(main());
