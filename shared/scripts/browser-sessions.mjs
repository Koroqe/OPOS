#!/usr/bin/env node
// browser-sessions.mjs - list every Chrome/Edge/Chromium instance on this machine, which of them are
// reachable over CDP, which registered resource (company/resources, kind browser-cdp) owns each port,
// and which sites are open in them. Agents run this BEFORE asking a human to log in anywhere.
//
// Read-only: process list + GET /json/version + GET /json/list (tab URLs and titles only). It never
// opens a tab, never reads cookies, storage or credentials.
//
// Usage:
//   node shared/scripts/browser-sessions.mjs                 human table
//   node shared/scripts/browser-sessions.mjs --json          machine output
//   node shared/scripts/browser-sessions.mjs --site <host>   only instances with a tab on <host>; every
//                                                            matching tab is listed with its URL path, so
//                                                            client variants of one site (separate sessions
//                                                            under different paths) are not mistaken for one
//   node shared/scripts/browser-sessions.mjs --ports 9222-9230   CDP port range to probe (this is the default)
// Exit: 0 ok (with --site: at least one instance has the site), 5 --site and none has it, 1 error, 64 usage.

import { execFile } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostname as osHostname, platform as osPlatform, userInfo } from 'node:os';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
export const DEFAULT_PORT_RANGE = Array.from({ length: 9 }, (_, i) => 9222 + i); // 9222..9230
export const PROBE_TIMEOUT_MS = 1500;
export const NO_CDP_NOTE =
  'not reachable over CDP (no --remote-debugging-port; Chrome 136+ refuses it on the default profile) - ' +
  'use the Claude in Chrome extension (mcp__claude-in-chrome__*) or computer-use if the session has them, ' +
  'otherwise ask the human to open the site in a profile started with a debugging port';

// ---------- 1. process enumeration ----------

/** Executable part of a raw command line. */
export function exeOf(cmd) {
  const s = String(cmd || '').trim();
  if (s.startsWith('"')) {
    const end = s.indexOf('"', 1);
    return end > 0 ? s.slice(1, end) : s.slice(1);
  }
  // unquoted, may contain spaces (macOS "Google Chrome", "C:\Program Files\..."): ends at the first " --x" or the end
  const m = s.search(/\s--?[a-zA-Z]/);
  return m === -1 ? s : s.slice(0, m);
}

export function browserName(cmd) {
  const exe = basename(exeOf(cmd).replace(/\\/g, '/')).toLowerCase();
  if (/crashpad|helper|updater|notification/.test(exe)) return null;
  if (/^msedge(\.exe)?$|^microsoft edge$/.test(exe)) return 'edge';
  if (/^(google )?chrome(\.exe)?$|^google-chrome(-stable)?$/.test(exe)) return 'chrome';
  if (/^chromium(-browser)?(\.exe)?$/.test(exe)) return 'chromium';
  return null;
}

function flagValue(cmd, flag) {
  // --flag=value where value is "quoted", 'quoted' or runs (spaces allowed) up to the next " --x" or the end
  const re = new RegExp(`${flag}=(?:"([^"]*)"|'([^']*)'|(.*?))(?=\\s--?[a-zA-Z]|\\s*$)`);
  const m = String(cmd).match(re);
  if (!m) return null;
  let v = m[1] ?? m[2] ?? m[3] ?? '';
  v = v.trim().replace(/"$/, ''); // whole-arg quoting: "--user-data-dir=C:\a b"
  return v === '' ? null : v;
}

/** Parse one command line. profileDir null = default profile. */
export function parseCommandLine(cmd) {
  const c = String(cmd || '');
  const pm = c.match(/--remote-debugging-port=(\d+)/);
  const port = pm ? Number(pm[1]) : null;
  return {
    browser: browserName(c),
    topLevel: !/(^|\s)--type=/.test(c),
    port: port && port > 0 ? port : null, // port 0 = "pick a random port": not knowable from argv
    profileDir: flagValue(c, '--user-data-dir'),
  };
}

/** rows: [{pid, command}] -> top-level browser instances only. */
export function instancesFromRows(rows) {
  const out = [];
  for (const r of rows) {
    if (!r || !r.command) continue;
    const p = parseCommandLine(r.command);
    if (!p.browser || !p.topLevel) continue;
    out.push({ pid: Number(r.pid), browser: p.browser, profileDir: p.profileDir, port: p.port });
  }
  return out;
}

export function parseWindowsJson(text) {
  const t = String(text || '').trim();
  if (!t) return [];
  const j = JSON.parse(t);
  const arr = Array.isArray(j) ? j : [j]; // ConvertTo-Json yields a bare object for one process
  return arr.map((o) => ({ pid: o.ProcessId, command: o.CommandLine || '' }));
}

export function parsePs(text) {
  const rows = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^\s*(\d+)\s+(.*)$/);
    if (m) rows.push({ pid: Number(m[1]), command: m[2] });
  }
  return rows;
}

function sh(file, args) {
  return new Promise((res, rej) =>
    execFile(file, args, { maxBuffer: 32 * 1024 * 1024, windowsHide: true }, (e, so) => (e ? rej(e) : res(so))),
  );
}

export async function listProcessRows(platform = osPlatform(), run = sh) {
  if (platform === 'win32') {
    const ps =
      `Get-CimInstance Win32_Process -Filter "name='chrome.exe' or name='msedge.exe'" | Select ProcessId,CommandLine | ConvertTo-Json`;
    return parseWindowsJson(await run('powershell', ['-NoProfile', '-Command', ps]));
  }
  return parsePs(await run('ps', ['-axo', 'pid=,command=']));
}

// ---------- 2. registry ----------

/** files: [{name, text}] (company/resources/*.md). Returns [{resource, machines, ports:[n]}] for kind browser-cdp. */
export function parseRegistry(files) {
  const out = [];
  for (const f of files) {
    const fm = String(f.text).match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm || !/^kind:\s*browser-cdp\s*$/m.test(fm[1])) continue;
    const name = (fm[1].match(/^resource:\s*(.+)$/m) || [])[1]?.trim() || f.name.replace(/\.md$/, '');
    const machines = (fm[1].match(/^machines:\s*(.+)$/m) || [])[1] || '';
    const ports = new Set();
    const body = String(f.text);
    const pats = [
      /--remote-debugging-port=(\d{4,5})/g,
      /127\.0\.0\.1:(\d{4,5})/g,
      /(?:port|:)\s*\**\s*(\d{4,5})\b/gi,
      /^\|\s*`?(\d{4,5})\b/gm,
    ];
    for (const re of pats) for (const m of body.matchAll(re)) {
      const n = Number(m[1]);
      if (n >= 9000 && n < 10000) ports.add(n); // CDP ports live in 9xxx; avoids years and ids
    }
    out.push({ resource: name, machines, ports: [...ports] });
  }
  return out;
}

/** port -> [resource names]. If some candidates list this machine in `machines`, only those are kept. */
export function mapPortToResources(registry, port, host = '') {
  const cands = registry.filter((r) => r.ports.includes(port));
  // `host` may be one name or a list (hostname + OS user name: a registry may name the machine by either)
  const names = (Array.isArray(host) ? host : [host]).map((x) => String(x || '').toLowerCase()).filter(Boolean);
  if (names.length) {
    const mine = cands.filter((r) => names.some((h) => r.machines.toLowerCase().includes(h)));
    if (mine.length) return mine.map((r) => r.resource);
  }
  return cands.map((r) => r.resource);
}

export function readRegistryFiles(dir = resolve(REPO, 'company', 'resources')) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((n) => n.endsWith('.md') && !/^(README|REGISTRY)\.md$/.test(n))
    .map((n) => ({ name: n, text: readFileSync(resolve(dir, n), 'utf8') }));
}

// ---------- 3. CDP probing ----------

export function filterPages(list) {
  return (Array.isArray(list) ? list : []).filter(
    (t) => t && t.type === 'page' && !/^(chrome-extension|devtools):\/\//.test(t.url || ''),
  );
}

export function hostOf(url) {
  try {
    const u = new URL(url);
    return u.host || '(' + u.protocol.replace(':', '') + ')';
  } catch {
    return '(unknown)';
  }
}

export function groupHosts(pages) {
  const m = new Map();
  for (const p of pages) {
    const h = hostOf(p.url);
    if (!m.has(h)) m.set(h, []);
    m.get(h).push(p.title || '');
  }
  return [...m].map(([host, titles]) => ({ host, titles }));
}

async function getJson(port, path, fetchFn, timeoutMs = PROBE_TIMEOUT_MS) {
  const r = await fetchFn(`http://127.0.0.1:${port}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** Returns {reachable, browserVersion, pages} for a port; never throws. */
export async function probePort(port, fetchFn = fetch) {
  try {
    const v = await getJson(port, '/json/version', fetchFn);
    let pages = [];
    try {
      pages = filterPages(await getJson(port, '/json/list', fetchFn));
    } catch { /* version ok, list failed: still reachable */ }
    return { reachable: true, browserVersion: v.Browser || '', pages };
  } catch {
    return { reachable: false, browserVersion: '', pages: [] };
  }
}

// ---------- 4. --site hints (from tab URL only) ----------

export function hostMatches(tabHost, wanted) {
  const a = tabHost.toLowerCase(), b = wanted.toLowerCase();
  return a === b || a.endsWith('.' + b);
}

/** One tab -> {status: probably-logged-out|unknown, reason}. Generic: only a login-looking URL is decisive. */
export function tabHint(url) {
  let u;
  try { u = new URL(url); } catch { return { status: 'unknown', reason: 'unparseable URL' }; }
  if (/(^|\/)(log-?in|sign-?in|auth|sso)(\/|$)/i.test(u.pathname) || /^(accounts|login|auth|sso)\./i.test(u.host)) {
    return { status: 'probably-logged-out', reason: 'URL looks like a sign-in page' };
  }
  return { status: 'unknown', reason: 'open on a non-login page; confirm in the page itself (extension or computer-use)' };
}

const RANK = { 'probably-logged-out': 0, unknown: 1 };

/** All tabs of an instance on `site` -> {tabs, status, reason, variants:[{path,title,status,reason}]}, or null if no tab on the site. */
export function siteHint(pages, site) {
  const tabs = pages.filter((p) => hostMatches(hostOf(p.url), site));
  if (!tabs.length) return null;
  const variants = tabs.map((p) => {
    let path = '/';
    try { path = new URL(p.url).pathname || '/'; } catch { /* keep default */ }
    return { path, title: p.title || '', ...tabHint(p.url) };
  });
  const best = [...variants].sort((a, b) => RANK[b.status] - RANK[a.status])[0];
  return { tabs: tabs.length, status: best.status, reason: best.reason, variants };
}

// ---------- 5. orchestration ----------

export function parsePorts(spec) {
  const m = String(spec || '').match(/^(\d{2,5})(?:-(\d{2,5}))?$/);
  if (!m) return null;
  const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
  if (a > b || b > 65535 || b - a > 200) return null;
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

export function parseArgs(argv) {
  const o = { json: false, site: null, ports: null, help: false, bad: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (a === '--site') { o.site = argv[++i]; if (!o.site || o.site.startsWith('--')) o.bad = '--site needs a host'; }
    else if (a === '--ports') { o.ports = parsePorts(argv[++i]); if (!o.ports) o.bad = '--ports needs N or N-M (at most 200 ports)'; }
    else o.bad = `unknown argument: ${a}`;
  }
  return o;
}

export async function collect(deps = {}) {
  const d = { platform: osPlatform(), hostname: [osHostname(), userInfo().username], fetchFn: fetch, ...deps };
  const rows = d.rows ?? (await listProcessRows(d.platform, d.run));
  const registry = parseRegistry(d.registryFiles ?? readRegistryFiles());
  const procs = instancesFromRows(rows);
  const ports = new Set(d.ports ?? DEFAULT_PORT_RANGE);
  for (const p of procs) if (p.port) ports.add(p.port);
  for (const r of registry) for (const p of r.ports) ports.add(p);
  const probes = new Map();
  await Promise.all([...ports].map(async (p) => probes.set(p, await probePort(p, d.fetchFn))));

  const instances = procs.map((p) => {
    const pr = p.port ? probes.get(p.port) : null;
    return {
      pid: p.pid, browser: p.browser, profileDir: p.profileDir || 'default profile',
      port: p.port, reachable: !!pr?.reachable,
      resource: p.port ? mapPortToResources(registry, p.port, d.hostname) : [],
      pageCount: pr?.reachable ? pr.pages.length : null,
      hosts: pr?.reachable ? groupHosts(pr.pages) : [],
      pages: pr?.reachable ? pr.pages.map((t) => ({ url: t.url, title: t.title })) : [],
      note: p.port ? (pr?.reachable ? '' : `port ${p.port} in command line but /json/version did not answer`) : NO_CDP_NOTE,
    };
  });
  // Reachable ports with no matching process row (port 0 / hand-offs): still worth showing.
  const known = new Set(procs.map((p) => p.port).filter(Boolean));
  for (const [port, pr] of probes) {
    if (!pr.reachable || known.has(port)) continue;
    instances.push({
      pid: null, browser: 'unknown', profileDir: 'unknown (no matching process row)', port, reachable: true,
      resource: mapPortToResources(registry, port, d.hostname), pageCount: pr.pages.length,
      hosts: groupHosts(pr.pages), pages: pr.pages.map((t) => ({ url: t.url, title: t.title })), note: '',
    });
  }
  return instances;
}

export async function run(argv, deps = {}) {
  const o = parseArgs(argv);
  if (o.help) return { code: 0, out: 'usage: browser-sessions.mjs [--json] [--site <host>] [--ports N-M]\n' };
  if (o.bad) return { code: 64, out: `error: ${o.bad}\n` };
  let instances;
  try { instances = await collect({ ...deps, ports: o.ports ?? deps.ports }); } catch (e) { return { code: 1, out: `error: ${e.message}\n` }; }

  let code = 0;
  let blind = [];
  if (o.site) {
    for (const i of instances) i.site = siteHint(i.pages, o.site);
    blind = instances.filter((i) => !i.reachable);
    instances = instances.filter((i) => i.site);
    if (!instances.length) code = 5;
  }
  if (o.json) {
    const payload = { instances, ...(o.site ? { site: o.site, unreachableInstances: blind.map((b) => ({ pid: b.pid, profileDir: b.profileDir })) } : {}) };
    return { code, out: JSON.stringify(payload, null, 2) + '\n' };
  }
  return { code, out: renderTable(instances, o, blind) };
}

export function renderTable(instances, o = {}, blind = []) {
  const L = [];
  if (o.site) L.push(`site: ${o.site} - ${instances.length} instance(s) with a tab on it${instances.length ? '' : ' (exit 5)'}`);
  if (!instances.length && !o.site) L.push('no Chrome/Edge instances found');
  for (const i of instances) {
    L.push(`pid ${i.pid ?? '?'}  ${i.browser}  profile: ${i.profileDir}`);
    L.push(`  debug port: ${i.port ?? 'none'}   reachable: ${i.reachable ? 'yes' : 'no'}   resource: ${i.resource.length ? i.resource.join(' | ') : '-'}`);
    if (i.reachable) {
      L.push(`  pages: ${i.pageCount}`);
      for (const h of i.hosts) L.push(`    ${h.host}: ${h.titles.map((t) => JSON.stringify(t)).join(', ')}`);
    }
    if (i.note) L.push(`  ${i.note}`);
    if (i.site) {
      L.push(`  ${o.site}: ${i.site.tabs} tab(s)`);
      for (const v of i.site.variants) L.push(`    ${v.path} [${JSON.stringify(v.title)}]: ${v.status} (${v.reason})`);
    }
  }
  if (o.site && blind.length) {
    L.push('');
    L.push(`${blind.length} instance(s) cannot be inspected over CDP, so the site may be open there: ` +
      blind.map((b) => `pid ${b.pid ?? '?'} (${b.profileDir})`).join('; '));
    L.push(`  ${NO_CDP_NOTE}`);
  }
  return L.join('\n') + '\n';
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const r = await run(process.argv.slice(2));
  process.stdout.write(r.out);
  process.exitCode = r.code;
}
