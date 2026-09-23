/**
 * node --test .claude/skills/lease/lib/keys.test.mjs
 * Follows the precedent of .claude/skills/ops-board/lib/hotp-format.test.mjs — plain node:test,
 * no dependencies, runnable offline.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseKey, conflicts, literalPrefix, globToRegExp, matchesAny, keyHash, claimTarget, KeyError } from './keys.mjs';

test('issue keys keep repo in the identity (os#211 must not equal mono#211)', () => {
  const a = parseKey('issue:acme/company-os#211');
  const b = parseKey('issue:acme/platform-monorepo#211');
  assert.equal(a.norm, 'issue:acme/company-os#211');
  assert.equal(a.number, 211);
  assert.equal(conflicts(a, b), false, 'cross-repo number collision must not be treated as one resource');
  assert.equal(conflicts(a, parseKey('issue:acme/company-os#211')), true);
});

test('malformed keys throw rather than silently becoming keys that collide with nothing', () => {
  for (const bad of ['', 'nocolon', 'weird:thing', 'issue:notanissue', 'issue:owner/repo#abc', 'path:']) {
    assert.throws(() => parseKey(bad), KeyError, `expected throw for: ${bad}`);
  }
});

test('issue key leading zeros and whitespace normalize', () => {
  assert.equal(parseKey('  issue:acme/company-os#0042  ').norm, 'issue:acme/company-os#42');
});

test('literalPrefix finds the directory before the first wildcard', () => {
  assert.equal(literalPrefix('departments/commercial/**'), 'departments/commercial/');
  assert.equal(literalPrefix('departments/commercial/data/sourcing/**'), 'departments/commercial/data/sourcing/');
  assert.equal(literalPrefix('company/ops/*.md'), 'company/ops/');
  assert.equal(literalPrefix('**'), '');
  assert.equal(literalPrefix('CLAUDE.md'), '');
});

test('path keys conflict on OVERLAP in either direction — the two-agents-one-folder case', () => {
  const broad = parseKey('path:departments/example/**');
  const narrow = parseKey('path:departments/example/data/sourcing/**');
  const other = parseKey('path:departments/other/**');
  assert.equal(conflicts(broad, narrow), true, 'parent must block child');
  assert.equal(conflicts(narrow, broad), true, 'child must block parent');
  assert.equal(conflicts(broad, other), false, 'siblings must not block');
  assert.equal(conflicts(narrow, narrow), true);
});

test('literal path leases: siblings do not conflict, even when they share a directory', () => {
  const a = parseKey('path:company/policies/autonomy-and-decision-rights.md');
  const b = parseKey('path:company/policies/telegram-report-tags.md');
  assert.equal(conflicts(a, b), false, 'two different literal files must not collide just because literalPrefix(a literal) is its parent dir');
  assert.equal(conflicts(b, a), false);
});

test('a root-level literal file does not conflict with an unrelated subtree glob', () => {
  // Regression: literalPrefix('CLAUDE.md') === '' (no directory component), and '' startsWith
  // ANY prefix — so under the old rule a root literal collided with every other path lease.
  assert.equal(conflicts(parseKey('path:CLAUDE.md'), parseKey('path:company/**')), false);
  assert.equal(conflicts(parseKey('path:company/**'), parseKey('path:CLAUDE.md')), false);
});

test('the same literal path conflicts with itself', () => {
  assert.equal(conflicts(parseKey('path:CLAUDE.md'), parseKey('path:CLAUDE.md')), true);
});

test('a literal file conflicts with a glob that covers it', () => {
  assert.equal(conflicts(parseKey('path:company/ops/x.md'), parseKey('path:company/ops/**')), true);
  assert.equal(conflicts(parseKey('path:company/ops/**'), parseKey('path:company/ops/x.md')), true);
});

test('a literal file against a single-star glob: conflicts only when the glob actually matches it', () => {
  assert.equal(conflicts(parseKey('path:company/ops.md'), parseKey('path:company/*.md')), true);
  assert.equal(conflicts(parseKey('path:company/sub/ops.md'), parseKey('path:company/*.md')), false, '* does not cross a separator, so this literal is outside the glob');
});

test('path:** conflicts with a literal path too', () => {
  assert.equal(conflicts(parseKey('path:**'), parseKey('path:CLAUDE.md')), true);
  assert.equal(conflicts(parseKey('path:CLAUDE.md'), parseKey('path:**')), true);
});

test('path:** contends with everything — it is the whole-tree lock auto-sync takes', () => {
  const all = parseKey('path:**');
  assert.equal(conflicts(all, parseKey('path:company/ops/**')), true);
  assert.equal(conflicts(all, parseKey('path:anything/at/all.md')), true);
  assert.equal(conflicts(all, parseKey('process:auto-sync')), false, 'different key TYPES never contend');
});

test('process and branch keys are exact-match only', () => {
  assert.equal(conflicts(parseKey('process:auto-sync'), parseKey('process:auto-sync')), true);
  assert.equal(conflicts(parseKey('process:auto-sync'), parseKey('process:review-history')), false);
  assert.equal(conflicts(parseKey('branch:main'), parseKey('branch:main')), true);
  assert.equal(conflicts(parseKey('branch:main'), parseKey('branch:ops/cloud-state')), false);
});

test('globToRegExp: ** crosses separators, * does not', () => {
  assert.equal(globToRegExp('a/**').test('a/b/c.md'), true);
  assert.equal(globToRegExp('a/**').test('a'), true, 'a/** must also match the directory itself');
  assert.equal(globToRegExp('a/*.md').test('a/b.md'), true);
  assert.equal(globToRegExp('a/*.md').test('a/b/c.md'), false, 'single star must not cross a separator');
  assert.equal(globToRegExp('**/x.md').test('x.md'), true);
  assert.equal(globToRegExp('**/x.md').test('deep/nested/x.md'), true);
});

test('globToRegExp escapes regex metacharacters in literal path segments', () => {
  assert.equal(globToRegExp('company/ops/2026-09-22_kit/a.md').test('company/ops/2026-09-22_kit/a.md'), true);
  assert.equal(globToRegExp('a+b/c.md').test('a+b/c.md'), true);
  assert.equal(globToRegExp('a.b/c.md').test('aXb/c.md'), false, 'dot must be literal, not any-char');
});

test('matchesAny treats a bare directory as everything beneath it', () => {
  assert.equal(matchesAny('company/ops/x.md', ['company/ops']), true);
  assert.equal(matchesAny('company/opsx/x.md', ['company/ops']), false, 'prefix must respect the separator');
  assert.equal(matchesAny('company/ops/x.md', ['company/ops/**']), true);
  assert.equal(matchesAny('departments/legal/a.md', ['company/ops/**']), false);
  assert.equal(matchesAny('anything', ['**']), true);
  assert.equal(matchesAny('anything', []), false, 'empty scope authorizes nothing');
});

test('matchesAny normalizes Windows separators — the same file must not read as out-of-scope on Windows', () => {
  const bs = String.fromCharCode(92);
  assert.equal(matchesAny(['company', 'ops', 'x.md'].join(bs), ['company/ops/**']), true);
});

test('keyHash is stable and distinct per normalized key', () => {
  assert.equal(keyHash('issue:getdeal-ai/getdeal-os#42'), keyHash(parseKey('issue:getdeal-ai/getdeal-os#0042')));
  assert.notEqual(keyHash('process:a'), keyHash('process:b'));
  assert.match(keyHash('path:**'), /^[0-9a-f]{16}$/);
});

test('claimTarget: own-repo issues claim on the issue, everything else on the ledger', () => {
  const cfg = { ledger: { repo: 'acme/company-os', issue: 440 } };
  const own = claimTarget('issue:acme/company-os#42', cfg);
  assert.deepEqual(own, { repo: 'acme/company-os', issue: 42, kind: 'issue' });

  // A repo where we hold comment rights only must keep its leases in our own ledger.
  const mono = claimTarget('issue:acme/platform-monorepo#42', cfg);
  assert.equal(mono.kind, 'ledger');
  assert.equal(mono.issue, 440);

  assert.equal(claimTarget('path:company/ops/**', cfg).kind, 'ledger');
  assert.equal(claimTarget('process:auto-sync', cfg).kind, 'ledger');
});
