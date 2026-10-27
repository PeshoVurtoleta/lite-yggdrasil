// test/CounterCensus.test.mjs -- ADR 0003 G-6 census (AF-2): every counter (`_n`) write in Yggdrasil.js is the
// G-5 form `X[K] = (X[K] + x) | 0` (same X, same K text both sides), and nothing else touches `_n` except three
// named, method-pinned sites. Written FROM THE SPEC (0003 G-5 / G-6; triage UNIT AF), not from engine output.
// Row kinds: FAIL-ON-OLD (red on 287d10c1), PASS-both (fixtures), PIN (passes on both).
// ASCII only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SRC = new URL('../Yggdrasil.js', import.meta.url);

// ---- strip comments and string / template literals (newlines kept, so line numbers survive) ----
function strip(src) {
  let o = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') { while (i < n && src[i] !== '\n') { o += ' '; i++; } continue; }
    if (c === '/' && d === '*') {
      o += '  '; i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { o += src[i] === '\n' ? '\n' : ' '; i++; }
      o += '  '; i += 2; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      o += c; i++;
      while (i < n && src[i] !== c) {
        if (src[i] === '\\') { o += ' '; i++; }
        o += src[i] === '\n' ? '\n' : ' '; i++;
      }
      o += c; i++; continue;
    }
    o += c; i++;
  }
  return o;
}

function esc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function norm(s) { return s.replace(/\s+/g, ' ').trim(); }

// matching bracket: s[i] is the opener; returns the index of the closer, or -1
function close(s, i) {
  const o = s[i];
  const cl = o === '[' ? ']' : o === '(' ? ')' : '}';
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === o) depth++;
    else if (s[j] === cl && --depth === 0) return j;
  }
  return -1;
}

// ---- the census: returns { violations: [{line, code}], g5: number, aliases: string[] } ----
function census(source) {
  const s = strip(source);
  const lineOf = (p) => { let l = 1; for (let i = 0; i < p; i++) if (s[i] === '\n') l++; return l; };
  const lineText = (p) => { const a = s.lastIndexOf('\n', p - 1) + 1; let b = s.indexOf('\n', p); if (b < 0) b = s.length; return s.slice(a, b).trim(); };
  // brace blocks: [open, close, header]
  const blocks = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '{') {
      const e = close(s, i);
      let h = i - 1;
      while (h >= 0 && !';{}'.includes(s[h])) h--;
      blocks.push([i, e < 0 ? s.length : e, s.slice(h + 1, i)]);
    }
  }
  const enclosing = (p) => blocks.filter((b) => b[0] < p && p < b[1]);
  const methodOf = (p) => {
    for (const b of enclosing(p)) {
      const m = /(?:^|\s)(constructor|readCounters|resetCounters)\s*\([^)]*\)\s*$/.exec(b[2]);
      if (m) return { name: m[1], block: b };
    }
    return null;
  };

  const violations = [];
  const consumed = []; // [from, to) ranges already judged
  const isConsumed = (p) => consumed.some((r) => p >= r[0] && p < r[1]);
  const flag = (p) => violations.push({ line: lineOf(p), code: lineText(p) });
  let g5 = 0;

  // aliases: `const|let|var NAME = <expr>._n;` (scope = the innermost enclosing block, or the whole text)
  const aliases = [];
  const aliasRe = /\b(?:const|let|var)\s+(\w+)\s*=\s*[\w.]+\._n\s*;/g;
  let m;
  while ((m = aliasRe.exec(s)) !== null) {
    const encl = enclosing(m.index);
    const blk = encl.length ? encl[encl.length - 1] : [0, s.length];
    aliases.push({ name: m[1], from: m.index + m[0].length, to: blk[1], declAt: m.index });
    consumed.push([m.index, m.index + m[0].length]);
  }
  const aliasNames = Array.from(new Set(aliases.map((a) => a.name)));

  // candidate references: `X._n` (property) and alias identifiers inside their scope
  const refs = []; // {pos, end, text}
  const propRe = /[\w$.]*\._n\b(?!\w)/g;
  while ((m = propRe.exec(s)) !== null) refs.push({ pos: m.index, end: m.index + m[0].length, text: m[0] });
  for (const a of aliases) {
    const re = new RegExp('(?<![\\w$.])' + esc(a.name) + '(?![\\w$])', 'g');
    re.lastIndex = a.from;
    while ((m = re.exec(s)) !== null && m.index < a.to) refs.push({ pos: m.index, end: m.index + m[0].length, text: a.name });
  }
  refs.sort((x, y) => x.pos - y.pos);

  const stmtEnd = (from) => {
    let depth = 0;
    for (let j = from; j < s.length; j++) {
      const c = s[j];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') { if (depth === 0) return -1; depth--; }
      else if (c === ';' && depth === 0) return j;
    }
    return -1;
  };
  const prevOk = (p) => {
    let j = p - 1;
    while (j >= 0 && /\s/.test(s[j])) j--;
    if (j < 0) return true;
    if (';{})'.includes(s[j])) return true;
    return /\belse$/.test(s.slice(Math.max(0, j - 4), j + 1));
  };

  for (const r of refs) {
    if (isConsumed(r.pos)) continue;
    const R = r.text;
    const end = stmtEnd(r.pos);
    const stmt = end < 0 ? '' : norm(s.slice(r.pos, end + 1));
    const covered = () => consumed.push([r.pos, end + 1]);
    // G-5 write: R[K] = (R[K] + x) | 0;
    if (end >= 0 && prevOk(r.pos) && s[r.end] === '[') {
      const kc = close(s, r.end);
      if (kc > 0) {
        const K = norm(s.slice(r.end + 1, kc));
        const re = new RegExp('^' + esc(R) + ' ?\\[ ?' + esc(K) + ' ?\\] ?= ?\\( ?' + esc(R) + ' ?\\[ ?' + esc(K) + ' ?\\] ?\\+ (.+)\\) ?\\| ?0;$');
        const mm2 = re.exec(stmt);
        if (mm2) {
          const x = mm2[1];
          const bad = new RegExp('\\b_n\\b|(?<![\\w$])(?:' + (aliasNames.length ? aliasNames.map(esc).join('|') : '(?!)') + ')(?![\\w$])');
          if (!bad.test(x)) { g5++; covered(); continue; }
        }
      }
    }
    // named, method-pinned sites
    const meth = methodOf(r.pos);
    if (meth) {
      if (meth.name === 'constructor' && end >= 0) {
        const mm = /^this\._n = (\w+);$/.exec(stmt);
        if (R === 'this._n' && mm && new RegExp('\\b(?:const|let)\\s+' + esc(mm[1]) + '\\s*=\\s*new Int32Array\\(').test(s.slice(meth.block[0], r.pos))) { covered(); continue; }
        if (R === 'this._n' && /^this\._n = new Int32Array\(.*\);$/.test(stmt)) { covered(); continue; }
      } else if (meth.name === 'readCounters') {
        // the statement starts at `out.set(`, so look back to the call head
        let a = r.pos;
        while (a > 0 && !';{}'.includes(s[a - 1])) a--;
        const head = norm(s.slice(a, stmtEnd(a) + 1));
        if (R === 'this._n' && /^\w+\.set\(this\._n\);$/.test(head)) { consumed.push([a, stmtEnd(a) + 1]); continue; }
      } else if (meth.name === 'resetCounters' && end >= 0) {
        if (R === 'this._n' && stmt === 'this._n.fill(0);') { covered(); continue; }
      }
    }
    flag(r.pos);
  }
  // every `_n` token no rule judged (destructuring, aliases through other shapes) is a violation
  const judged = (p) => isConsumed(p) || refs.some((r) => p >= r.pos && p < r.end);
  const tokRe = /\b_n\b/g;
  while ((m = tokRe.exec(s)) !== null) if (!judged(m.index)) flag(m.index);
  // a quoted `_n` in the RAW source is computed access (this['_n'][k] += 1)
  const rawRe = /(['"`])_n\1/g;
  while ((m = rawRe.exec(source)) !== null) {
    let l = 1; for (let i = 0; i < m.index; i++) if (source[i] === '\n') l++;
    violations.push({ line: l, code: 'quoted _n: ' + source.slice(Math.max(0, m.index - 10), m.index + 12).replace(/\n/g, ' ') });
  }
  return { violations, g5, aliases: aliasNames, aliasBindings: aliases.length };
}

const fmt = (vs) => vs.map((v) => v.line + ': ' + v.code).join('\n');

// ---------------------------------------------------------------- 1. the census over Yggdrasil.js

const G5_FLOOR = 51; // exact count on the fixed build (51 `+=` sites on 287d10c1, each one G-5 write); asserted with >=

test('G-6 census [FAIL-ON-OLD]: every _n occurrence / alias use in Yggdrasil.js is G-5 or a named site; 0 violations', () => {
  const r = census(fs.readFileSync(SRC, 'utf8'));
  assert.equal(r.violations.length, 0, 'violations (line: code):\n' + fmt(r.violations));
});

test('G-6 census [FAIL-ON-OLD]: not vacuous -- at least ' + G5_FLOOR + ' G-5 writes, the cn alias is found', () => {
  const r = census(fs.readFileSync(SRC, 'utf8'));
  assert.ok(r.g5 >= G5_FLOOR, 'G-5 writes found: ' + r.g5);
  assert.ok(r.aliases.includes('cn'), 'aliases: ' + r.aliases.join(','));
  assert.ok(r.aliasBindings >= 14, 'alias bindings: ' + r.aliasBindings);
});

// ---------------------------------------------------------------- 2. must-fail fixtures (PASS both builds)

test('fixtures [PASS-both]: the census flags each non-G-5 use', () => {
  const bad = [
    'if (this._n[7] > 0) x();',
    'this._n[3] += 1;',
    'const n = this._n; n[2]++;',
    'return v._n[0];',
    'n[4] = (n[5] + 1) | 0;', // index mismatch (n is not an alias here, so use the property form too)
    'v._n[4] = (v._n[5] + 1) | 0;',
    'const cn = v._n; cn[4] = (cn[5] + 1) | 0;',
    'const cn = v._n; cn[1] -= 2;',
    'const cn = v._n; --cn[1];',
    'const cn = v._n; cn[1] = (cn[1] + cn[2]) | 0;', // x reads another counter
    'const cn = v._n; cn[1] = cn[1] + 1;', // no | 0
    'const cn = v._n; foo(cn);',
    'const cn = v._n; const q = cn[1];',
    'class A { other(out) { out.set(this._n); } }', // not inside readCounters
    'class A { other() { this._n.fill(0); } }', // not inside resetCounters
    'class A { other() { this._n = n; } }', // not inside constructor
    'class A { constructor() { this._n = other; } }', // other is not bound to a new Int32Array
    'const { _n } = this; _n[1] += 1;',
    'const { _n: q } = this; if (q[7] > 0) x();',
    "this['_n'][k] += 1;",
  ];
  for (const code of bad) {
    const r = census(code);
    if (code === 'n[4] = (n[5] + 1) | 0;') { assert.equal(r.violations.length, 0, 'bare n is not an _n alias'); continue; }
    assert.ok(r.violations.length >= 1, 'not flagged: ' + code);
  }
  // the bare-n index-mismatch statement, as an alias
  assert.ok(census('const n = this._n; n[4] = (n[5] + 1) | 0;').violations.length >= 1);
});

test('fixtures [PASS-both]: the census accepts G-5 writes and the three named sites', () => {
  const good = [
    'const n = this._n; n[2] = (n[2] + sp) | 0;',
    'const cn = v._n;\n cn[YG_MISSES - h] = (cn[YG_MISSES - h] + 1) | 0;',
    'this._n[YG_TOUCHES] = (this._n[YG_TOUCHES] + depth) | 0;',
    'if (a) cn2(); v._n[YG_MOVES] = (v._n[YG_MOVES] + len - 1 - k) | 0;',
    'class A { constructor() { const n = new Int32Array(YG_NC); this._n = n; } }',
    'class A { constructor() { this._n = new Int32Array(12); } }',
    'class A { readCounters(out) { if (!ok) ygFail("x"); out.set(this._n); return this; } }',
    'class A { resetCounters() { this._n.fill(0); return this; } }',
    '// this._n[1] += 1;\nconst s = "this._n[1] += 1;";',
  ];
  for (const code of good) {
    const r = census(code);
    assert.equal(r.violations.length, 0, code + '\n' + fmt(r.violations));
  }
  assert.equal(census('const n = this._n; n[2] = (n[2] + sp) | 0;').g5, 1);
});

// ---------------------------------------------------------------- 3. wrap row

// PIN: Int32Array storage already wraps 0x7FFFFFFF + 1 to -2**31 on both builds; the window delta is taken with | 0.
// getMeasure on a 3-element one-leaf view is a finger HIT: fingerHits += 1, touches 0 (Core.test.mjs B1, C-4 / C-25).
import { SumSequence } from '../Yggdrasil.js';

test('wrap [PIN]: fingerHits at 0x7FFFFFFF reads -2**31 after one hit; (after - before) | 0 === 1', () => {
  const s = new SumSequence(16, { leafSize: 8, dims: 1 });
  for (let i = 0; i < 3; i++) s.insertAt(i, i + 1, 1);
  s.getMeasure(1, 0); // warm: finger is on the root leaf
  const K = SumSequence.COUNTERS.fingerHits;
  s._n[K] = 0x7FFFFFFF;
  const out = new Int32Array(12);
  s.readCounters(out);
  const before = out[K];
  assert.equal(before, 2147483647);
  s.getMeasure(1, 0);
  s.readCounters(out);
  const after = out[K];
  assert.equal(after, -2147483648);
  assert.equal((after - before) | 0, 1);
});
