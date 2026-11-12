import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCommandLine, instancesFromRows, parseWindowsJson, parsePs, parseRegistry, mapPortToResources,
  filterPages, groupHosts, tabHint, siteHint, parseArgs, parsePorts, run, collect, NO_CDP_NOTE,
} from './browser-sessions.mjs';

const WIN_CHROME = 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';

// ---- command-line parsing ----

test('quoted user-data-dir with spaces (Windows) is parsed whole, port is read', () => {
  const p = parseCommandLine(`"${WIN_CHROME}" --user-data-dir="D:\\profiles\\a b\\one" --remote-debugging-port=9222 --no-first-run`);
  assert.equal(p.profileDir, 'D:\\profiles\\a b\\one');
  assert.equal(p.port, 9222);
  assert.equal(p.browser, 'chrome');
  assert.equal(p.topLevel, true);
});

test('whole-argument quoting "--user-data-dir=C:\\a b" strips the trailing quote', () => {
  const p = parseCommandLine(`"${WIN_CHROME}" "--user-data-dir=D:\\profiles\\one" --remote-debugging-port=9223`);
  assert.equal(p.profileDir, 'D:\\profiles\\one');
  assert.equal(p.port, 9223);
});

test('unquoted user-data-dir containing spaces (macOS ps output) runs to the next flag', () => {
  const p = parseCommandLine('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/tmp/Profile One --remote-debugging-port=9226 --no-first-run');
  assert.equal(p.profileDir, '/tmp/Profile One');
  assert.equal(p.port, 9226);
  assert.equal(p.browser, 'chrome');
});

test('user-data-dir as the last argument, unquoted, is captured to the end', () => {
  const p = parseCommandLine('/usr/bin/google-chrome --remote-debugging-port=9224 --user-data-dir=/home/u/p');
  assert.equal(p.profileDir, '/home/u/p');
  assert.equal(p.port, 9224);
});

test('no debug port and no user-data-dir: port null, default profile (null)', () => {
  const p = parseCommandLine(`"${WIN_CHROME}"`);
  assert.equal(p.port, null);
  assert.equal(p.profileDir, null);
  assert.equal(p.topLevel, true);
});

test('--remote-debugging-port=0 is not a usable port', () => {
  assert.equal(parseCommandLine(`"${WIN_CHROME}" --remote-debugging-port=0`).port, null);
});

test('empty/null command lines never throw', () => {
  assert.equal(parseCommandLine(null).browser, null);
  assert.equal(parseCommandLine('').port, null);
});

// ---- top-level filtering and browser detection ----

test('renderer/gpu/utility children (--type=) are dropped, only top-level kept', () => {
  const rows = [
    { pid: 1, command: `"${WIN_CHROME}" --user-data-dir=C:\\p --remote-debugging-port=9222` },
    { pid: 2, command: `"${WIN_CHROME}" --type=renderer --user-data-dir=C:\\p --remote-debugging-port=9222` },
    { pid: 3, command: `"${WIN_CHROME}" --type=gpu-process --user-data-dir=C:\\p` },
    { pid: 4, command: `"${WIN_CHROME}"` },
  ];
  assert.deepEqual(instancesFromRows(rows).map((i) => i.pid), [1, 4]);
});

test('Edge is recognised; crashpad handler and non-browsers are not instances', () => {
  const rows = [
    { pid: 10, command: '"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" --remote-debugging-port=9230' },
    { pid: 11, command: '"C:\\Program Files\\Google\\Chrome\\Application\\chrome_crashpad_handler.exe" --monitor-self' },
    { pid: 12, command: 'node browser-sessions.mjs --site chrome.exe' },
    { pid: 13, command: 'powershell -NoProfile -Command "Get-CimInstance ... chrome.exe"' },
  ];
  assert.deepEqual(instancesFromRows(rows).map((i) => [i.pid, i.browser]), [[10, 'edge']]);
});

test('Windows JSON: a single process arrives as a bare object, many as an array, null CommandLine is tolerated', () => {
  assert.equal(parseWindowsJson('{"ProcessId":5,"CommandLine":"x"}').length, 1);
  assert.equal(parseWindowsJson('[{"ProcessId":5,"CommandLine":null},{"ProcessId":6,"CommandLine":"y"}]').length, 2);
  assert.deepEqual(parseWindowsJson(''), []);
});

test('ps output "pid command" lines are split on the first whitespace run', () => {
  const rows = parsePs('  123 /usr/bin/google-chrome --remote-debugging-port=9222\n 45 /sbin/launchd\n');
  assert.deepEqual(rows.map((r) => r.pid), [123, 45]);
  assert.match(rows[0].command, /^\/usr\/bin\/google-chrome/);
});

// ---- registry mapping ----

const FIX = [
  { name: 'browser-a.md', text: '---\nresource: browser-a\nkind: browser-cdp\nmachines: ["host-a"]\n---\n| Port | Accounts |\n|---|---|\n| 9222 | one |\nSecond profile (port 9224). Year 2026 and #123 are not ports.\n' },
  { name: 'browser-b.md', text: '---\nresource: browser-b\nkind: browser-cdp\nmachines: ["HOST-B"]\n---\n| 9222 | one |\n| 9223 | two |\ncurl http://127.0.0.1:9222/json/version\n' },
  { name: 'browser-c.md', text: '---\nresource: browser-c\nkind: browser-cdp\nmachines: ["host-c"]\n---\nChrome with port 9226. curl http://127.0.0.1:9226/json/version\n' },
  { name: 'tok.md', text: '---\nresource: some-token\nkind: api-token\n---\nport 9222 mentioned but not a browser resource\n' },
];

test('registry: only kind browser-cdp files count; ports parsed loosely; years/ids are not ports', () => {
  const reg = parseRegistry(FIX);
  assert.deepEqual(reg.map((r) => r.resource).sort(), ['browser-a', 'browser-b', 'browser-c']);
  assert.deepEqual(reg.find((r) => r.resource === 'browser-a').ports.sort(), [9222, 9224]);
  assert.deepEqual(reg.find((r) => r.resource === 'browser-c').ports, [9226]);
});

test('registry: a port shared by two resources is narrowed by the machine name when one lists this machine', () => {
  const reg = parseRegistry(FIX);
  assert.deepEqual(mapPortToResources(reg, 9222, ['HOST-X', 'host-a']), ['browser-a']);
});

test('registry: ambiguous port with no machine match returns all candidates; unknown port returns none', () => {
  const reg = parseRegistry(FIX);
  assert.deepEqual(mapPortToResources(reg, 9222, 'unknown-box').sort(), ['browser-a', 'browser-b']);
  assert.deepEqual(mapPortToResources(reg, 9229, 'host-a'), []);
});

// ---- pages ----

test('only type=page tabs survive; extension, devtools and service worker targets are dropped', () => {
  const kept = filterPages([
    { type: 'page', url: 'https://a.example/', title: 'A' },
    { type: 'page', url: 'chrome-extension://abc/popup.html' },
    { type: 'page', url: 'devtools://devtools/x' },
    { type: 'service_worker', url: 'https://a.example/sw.js' },
    { type: 'background_page', url: 'https://b.example/' },
  ]);
  assert.deepEqual(kept.map((t) => t.title), ['A']);
});

test('groupHosts groups tab titles by host', () => {
  const g = groupHosts([{ url: 'https://a.example/1', title: 'x' }, { url: 'https://a.example/2', title: 'y' }, { url: 'https://b.example/', title: 'z' }]);
  assert.deepEqual(g, [{ host: 'a.example', titles: ['x', 'y'] }, { host: 'b.example', titles: ['z'] }]);
});

// ---- --site hints ----

test('tabHint: only a sign-in looking URL is decisive; anything else is unknown, never "logged in"', () => {
  for (const u of ['https://s.example/login', 'https://s.example/v1/signin/', 'https://s.example/sso/x', 'https://accounts.s.example/']) {
    assert.equal(tabHint(u).status, 'probably-logged-out', u);
  }
  for (const u of ['https://s.example/', 'https://s.example/v1/#123', 'https://s.example/dashboard']) {
    assert.equal(tabHint(u).status, 'unknown', u);
  }
  assert.equal(tabHint('not a url').status, 'unknown');
});

test('siteHint: null when no tab on the host; subdomain matches; client variants of one site are listed separately', () => {
  const pages = [
    { url: 'https://app.example/v1/', title: 'App' },
    { url: 'https://app.example/v2/login', title: 'App' },
    { url: 'https://other.example/', title: 'O' },
  ];
  assert.equal(siteHint(pages, 'missing.example'), null);
  const h = siteHint(pages, 'app.example');
  assert.equal(h.tabs, 2);
  assert.deepEqual(h.variants.map((v) => [v.path, v.status]), [['/v1/', 'unknown'], ['/v2/login', 'probably-logged-out']]);
  assert.equal(h.status, 'unknown'); // the best tab wins: the /v1/ variant is not a sign-in page
  assert.equal(siteHint([{ url: 'https://www.app.example/', title: '' }], 'app.example').tabs, 1);
  assert.equal(siteHint([{ url: 'https://notapp.example/', title: '' }], 'app.example'), null);
});

// ---- argument parsing and exit codes (offline: all I/O injected) ----

const rows = [
  { pid: 100, command: `"${WIN_CHROME}" --user-data-dir=C:\\prof\\one --remote-debugging-port=9222` },
  { pid: 101, command: `"${WIN_CHROME}" --type=renderer --remote-debugging-port=9222` },
  { pid: 200, command: `"${WIN_CHROME}"` },
];
const tabs = {
  9222: [
    { type: 'page', url: 'https://app.example/v1/', title: 'App' },
    { type: 'page', url: 'https://code.example/', title: 'Code' },
    { type: 'service_worker', url: 'https://app.example/sw.js', title: '' },
  ],
};
const fetchFn = async (url) => {
  const m = String(url).match(/:(\d+)\/json\/(version|list)/);
  if (!m || !tabs[m[1]]) throw new Error('ECONNREFUSED');
  return { ok: true, json: async () => (m[2] === 'version' ? { Browser: 'Chrome/150' } : tabs[m[1]]) };
};
const deps = (extra = {}) => ({ rows, registryFiles: FIX, fetchFn, hostname: ['host-a'], ...extra });

test('argument parsing: unknown flags, missing values and bad port specs are usage errors', () => {
  assert.ok(parseArgs(['--nope']).bad);
  assert.ok(parseArgs(['--site']).bad);
  assert.ok(parseArgs(['--site', '--json']).bad);
  assert.ok(parseArgs(['--ports', 'x']).bad);
  assert.ok(parseArgs(['--probe', 'https://x.example']).bad, 'the read-only script has no --probe');
  assert.equal(parseArgs(['--json', '--site', 'a.example']).bad, null);
});

test('parsePorts: single, range, and bounds', () => {
  assert.deepEqual(parsePorts('9300'), [9300]);
  assert.deepEqual(parsePorts('9300-9302'), [9300, 9301, 9302]);
  assert.equal(parsePorts('9302-9300'), null);
  assert.equal(parsePorts('9000-9999'), null);
  assert.equal(parsePorts('70000'), null);
});

test('exit 64 on usage error, 0 for the plain listing', async () => {
  assert.equal((await run(['--bogus'], deps())).code, 64);
  assert.equal((await run([], deps())).code, 0);
});

test('every top-level process is listed; ones without a port say CDP cannot reach them', async () => {
  const j = JSON.parse((await run(['--json'], deps())).out);
  assert.deepEqual(j.instances.map((i) => i.pid).sort(), [100, 200]);
  const noPort = j.instances.find((i) => i.pid === 200);
  assert.equal(noPort.port, null);
  assert.equal(noPort.reachable, false);
  assert.equal(noPort.note, NO_CDP_NOTE);
  const withPort = j.instances.find((i) => i.pid === 100);
  assert.equal(withPort.reachable, true);
  assert.deepEqual(withPort.resource, ['browser-a']);
  assert.equal(withPort.pageCount, 2); // service worker excluded
});

test('--site: exit 0 and only instances with that host; exit 5 when none has it; unreachable instances are reported', async () => {
  const yes = await run(['--json', '--site', 'app.example'], deps());
  assert.equal(yes.code, 0);
  const j = JSON.parse(yes.out);
  assert.deepEqual(j.instances.map((i) => i.pid), [100]);
  assert.equal(j.instances[0].site.variants[0].path, '/v1/');
  assert.deepEqual(j.unreachableInstances.map((i) => i.pid), [200]); // may hide the site: must be reported
  const no = await run(['--site', 'missing.example'], deps());
  assert.equal(no.code, 5);
  assert.match(no.out, /cannot be inspected over CDP/);
});

test('the human table lists each client variant path of the site', async () => {
  const r = await run(['--site', 'app.example'], deps());
  assert.match(r.out, /\/v1\//);
});

test('a reachable port with no matching process row is still reported', async () => {
  const j = JSON.parse((await run(['--json'], deps({ rows: [] }))).out);
  assert.equal(j.instances.length, 1);
  assert.equal(j.instances[0].port, 9222);
});

test('the script is read-only: only GET requests are ever issued', async () => {
  const methods = [];
  const f = async (url, init) => { methods.push(init?.method || 'GET'); return fetchFn(url, init); };
  await run(['--site', 'app.example'], deps({ fetchFn: f }));
  assert.ok(methods.length > 0);
  assert.ok(methods.every((m) => m === 'GET'));
});

test('collect probes the 9222-9230 default range plus ports named in the registry', async () => {
  const seen = new Set();
  const f = async (url) => { seen.add(Number(String(url).match(/:(\d+)\//)[1])); throw new Error('x'); };
  await collect({ rows: [], registryFiles: FIX, fetchFn: f });
  for (let p = 9222; p <= 9230; p++) assert.ok(seen.has(p), `port ${p}`);
});

test('--ports replaces the default range; a registry port outside it is still probed', async () => {
  const seen = new Set();
  const f = async (url) => { seen.add(Number(String(url).match(/:(\d+)\//)[1])); throw new Error('x'); };
  const far = [{ name: 'far.md', text: '---\nresource: far\nkind: browser-cdp\n---\nport 9301\n' }];
  await run(['--ports', '9400-9401'], { rows: [], registryFiles: far, fetchFn: f });
  assert.ok(seen.has(9400) && seen.has(9401) && seen.has(9301));
  assert.ok(!seen.has(9222));
});
