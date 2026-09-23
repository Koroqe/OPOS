/**
 * lease / lib/keys.mjs — key taxonomy, normalization, conflict detection.
 *
 * Four key types, one protocol:
 *   issue:<owner>/<repo>#<N>   exact match. Keyed by ${repo}#${number} because issue numbers
 *                              collide across repos: #211 in one repo is not #211 in another.
 *   path:<glob>                conflicts on OVERLAP, not equality. This is the type that stops
 *                              two agents writing into the same folder at the same time.
 *   process:<name>             exact match. auto-sync, review-history, ops-board, propose-to-core.
 *   branch:<name>              exact match. ops/cloud-state, review-history's dated work branches.
 *
 * No literal backslashes in this file: regex escaping is built from String.fromCharCode(92).
 */
const BS = String.fromCharCode(92);
const RX_SPECIAL = new Set(['.', '+', '^', '$', '{', '}', '(', ')', '|', '[', ']']);

function escRx(s) {
  let out = '';
  for (const ch of s) out += RX_SPECIAL.has(ch) ? BS + ch : ch;
  return out;
}

export const KEY_TYPES = ['issue', 'path', 'process', 'branch'];

export class KeyError extends Error {}

/** Parse and normalize. Throws KeyError on anything malformed — a typo'd key must never silently become a key that collides with nothing. */
export function parseKey(raw) {
  if (typeof raw !== 'string' || !raw.includes(':')) throw new KeyError(`malformed key (expected <type>:<value>): ${raw}`);
  const idx = raw.indexOf(':');
  const type = raw.slice(0, idx).trim().toLowerCase();
  let value = raw.slice(idx + 1).trim();
  if (!KEY_TYPES.includes(type)) throw new KeyError(`unknown key type '${type}' (expected one of ${KEY_TYPES.join(', ')})`);
  if (!value) throw new KeyError(`empty value in key: ${raw}`);

  if (type === 'issue') {
    const m = /^([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)#([0-9]+)$/.exec(value);
    if (!m) throw new KeyError(`issue key must be issue:<owner>/<repo>#<number>, got: ${value}`);
    const [, owner, repo, num] = m;
    return { type, raw, norm: `issue:${owner}/${repo}#${Number(num)}`, owner, repo, full: `${owner}/${repo}`, number: Number(num) };
  }
  if (type === 'path') {
    value = value.split(BS).join('/').replace(/^[.][/]/, '').replace(/[/]+/g, '/');
    if (value !== '**' && value.startsWith('/')) value = value.slice(1);
    return { type, raw, norm: `path:${value}`, glob: value, prefix: literalPrefix(value) };
  }
  return { type, raw, norm: `${type}:${value}`, name: value };
}

/** The literal directory prefix before the first wildcard. 'a/b/**' -> 'a/b/', 'a/b*.md' -> 'a/', '**' -> ''. */
export function literalPrefix(glob) {
  const star = glob.search(/[*?]/);
  const head = star === -1 ? glob : glob.slice(0, star);
  const cut = head.lastIndexOf('/');
  return cut === -1 ? '' : head.slice(0, cut + 1);
}

/** Glob -> RegExp. ** crosses separators, * does not, ? is one non-separator char. */
export function globToRegExp(glob) {
  let out = '^';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    // Trailing '/**' must also match the directory itself: a lease on 'a/**' covers 'a'.
    if (ch === '/' && glob.slice(i, i + 3) === '/**' && i + 3 === glob.length) { out += '(?:/.*)?'; i += 2; continue; }
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        // 'a/**' must also match 'a' itself, and '**/x' must match 'x'
        if (glob[i + 2] === '/') { out += '(?:.*/)?'; i += 2; } else { out += '.*'; i += 1; }
      } else out += '[^/]*';
    } else if (ch === '?') out += '[^/]';
    else if (ch === '/') out += '/';
    else out += escRx(ch);
  }
  return new RegExp(out + '$');
}

/** Does a repo-relative file path fall inside any of these globs? */
export function matchesAny(file, globs) {
  const f = String(file).split(BS).join('/').replace(/^[.][/]/, '');
  return (globs ?? []).some((g) => {
    const norm = String(g).split(BS).join('/');
    if (norm === '**' || norm === '.') return true;
    if (globToRegExp(norm).test(f)) return true;
    // a bare directory ('company/ops') is shorthand for everything under it
    if (!/[*?]/.test(norm) && (f === norm || f.startsWith(norm.endsWith('/') ? norm : norm + '/'))) return true;
    return false;
  });
}

/**
 * Do two keys contend for the same resource?
 * Exact for issue/process/branch. For path: overlap — does some file path exist that both
 * globs would match?
 *   - two wildcard-free (literal) paths: conflict only when equal. 'a/x.md' and 'a/y.md' name
 *     different files and must not block each other, however deep the shared directory.
 *   - a literal against a real glob: conflict iff the glob's own RegExp matches the literal.
 *     ('x/**' already matches the bare 'x' itself — see globToRegExp — so a literal that names
 *     the glob's own root directory is covered without extra logic.)
 *   - two real globs: the previous conservative prefix-overlap rule, so
 *     path:departments/commercial/** still blocks path:departments/commercial/data/sourcing/**
 *     and vice versa, while path:departments/legal/** is free. This may still false-positive on
 *     two globs that merely share a literal prefix before their first wildcard — acceptable;
 *     it is not the false-positive this function used to have for fully-literal paths (a literal
 *     file's "prefix" is its parent directory, which made siblings — and, at the repo root, every
 *     other path lease — collide).
 */
export function conflicts(a, b) {
  const ka = typeof a === 'string' ? parseKey(a) : a;
  const kb = typeof b === 'string' ? parseKey(b) : b;
  if (ka.type !== kb.type) return false;
  if (ka.type !== 'path') return ka.norm === kb.norm;
  if (ka.norm === kb.norm) return true;

  const aIsGlob = /[*?]/.test(ka.glob);
  const bIsGlob = /[*?]/.test(kb.glob);

  if (!aIsGlob && !bIsGlob) return false; // two literals: only equality conflicts, checked above

  if (aIsGlob !== bIsGlob) {
    const lit = aIsGlob ? kb : ka;
    const glob = aIsGlob ? ka : kb;
    return globToRegExp(glob.glob).test(lit.glob);
  }

  const pa = ka.prefix ?? literalPrefix(ka.glob);
  const pb = kb.prefix ?? literalPrefix(kb.glob);
  return pa.startsWith(pb) || pb.startsWith(pa);
}

/** Stable filesystem-safe id for a key (state cache filenames, future ref names, ledger sharding). */
export function keyHash(key) {
  const norm = (typeof key === 'string' ? parseKey(key) : key).norm;
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < norm.length; i++) {
    h1 = Math.imul(h1 ^ norm.charCodeAt(i), 0x01000193) >>> 0;
    h2 = Math.imul(h2 + norm.charCodeAt(i) + i, 0x85ebca6b) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0'));
}

/** Where does a key's claim live: on its own issue, or on the ledger? */
export function claimTarget(key, config) {
  const k = typeof key === 'string' ? parseKey(key) : key;
  const ledgerRepo = config?.ledger?.repo;
  if (k.type === 'issue' && k.full === ledgerRepo) return { repo: k.full, issue: k.number, kind: 'issue' };
  return { repo: ledgerRepo, issue: config?.ledger?.issue, kind: 'ledger' };
}
