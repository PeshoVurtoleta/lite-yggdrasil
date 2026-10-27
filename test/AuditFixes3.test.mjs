// test/AuditFixes3.test.mjs -- UNIT AF3 rows (0.1.1 patch): R-A7 SumCursor is not constructible, R-A8/R-A11 readCounters
// brand + true length, R-A9 NaN-closed index / dim upper-bound throw guards (census). Written FROM THE RULINGS and the
// planner ASSERTIONS (pass 3 audit shapes 1c, 3a..3d), not from engine output.
// Row kinds: every row not tagged [PASS-both] FAILS on the v0.1.0 build (Yggdrasil.js sha 73de8dca); [PASS-both] rows pass
// on both builds (regression pins / fixtures).
// YG_ENGINE=<abs path> overrides the engine under test (revert-check on .handoff/af3-before/Yggdrasil.js).
// YG_CENSUS_PRINT=1 prints the census of the engine file as JSON on stdout (evidence aid).
// ASCII only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ENGINE_PATH = process.env.YG_ENGINE
  ? path.resolve(process.env.YG_ENGINE)
  : path.resolve(new URL('../Yggdrasil.js', import.meta.url).pathname);
const { SumSequence } = await import(pathToFileURL(ENGINE_PATH).href);

const BEFORE_PATH = '/Users/zakkster/Work/Portfolio/LiteLibrariesSuite/LiteYggdrasil/.handoff/af3-before/Yggdrasil.js';
const SENT = 0x5a5a5a5a | 0;

// ---------------------------------------------------------------------------------------------------------------
// R-A7: SumCursor is not constructible
// ---------------------------------------------------------------------------------------------------------------

const NOT_CONSTRUCTIBLE = 'lite-yggdrasil: SumCursor is not constructible';

// entity(i) = 100 + i, measure(i) = i + 1  =>  offset(0) at index i = i(i+1)/2 (sum of 1..i), by hand.
function fill(v, n, base) {
  for (let i = 0; i < n; i++) v.insertAt(i, base + i, i + 1);
}
function snap(c) {
  return { valid: c.valid, index: c.index, entity: c.entity, m: c.measure(0), off: c.offset(0) };
}
function refuses(Ctor, args) {
  assert.throws(() => new Ctor(...args), (e) => {
    assert.ok(e instanceof TypeError, 'TypeError, got ' + e);
    assert.equal(e.message, NOT_CONSTRUCTIBLE);
    return true;
  });
}

test('R-A7: the cursor constructor refuses every argument shape with the exact message', () => {
  const v = new SumSequence(64, { leafSize: 4, dims: 1 });
  fill(v, 24, 100);
  const Ctor = v.cursor().constructor;
  refuses(Ctor, [v, { HL: 4, dims: 1 }]);
  refuses(Ctor, [v, { HL: 4, dims: 1 }, {}]);
  refuses(Ctor, [v, { HL: 4, dims: 1 }, undefined]);
  refuses(Ctor, []); // old build throws a different TypeError (reads ar.HL of undefined)
});

test('R-A7: a refused attempt leaves the real cursor and its identity untouched (>= 20 elements, SumSequence)', () => {
  const v = new SumSequence(64, { leafSize: 4, dims: 1 });
  fill(v, 24, 100);
  const c = v.cursor();
  assert.equal(c.seekIndex(7), true);
  const before = snap(c);
  assert.deepEqual(before, { valid: true, index: 7, entity: 107, m: 8, off: 28 });
  refuses(c.constructor, [v, { HL: 4, dims: 1 }]);
  assert.deepEqual(snap(c), before);
  assert.equal(v.cursor(), v.cursor());
  assert.equal(v.cursor(), c);
  assert.equal(c.next(), true);
  assert.deepEqual(snap(c), { valid: true, index: 8, entity: 108, m: 9, off: 36 });
  assert.equal(c.seekIndex(15), true);
  assert.deepEqual(snap(c), { valid: true, index: 15, entity: 115, m: 16, off: 120 });
});

test('R-A7: a refused attempt leaves an arena sibling view and its cursor valid (pass 3 shape 1c)', () => {
  const [a, b] = SumSequence.arena(256, { leafSize: 4, dims: 1 }, 2);
  fill(a, 24, 700000);
  fill(b, 24, 100);
  const ca = a.cursor();
  const cb = b.cursor();
  assert.equal(ca.seekIndex(2), true);
  assert.equal(cb.seekIndex(7), true);
  const sa = snap(ca);
  const sb = snap(cb);
  assert.deepEqual(sb, { valid: true, index: 7, entity: 107, m: 8, off: 28 });
  // forged cursors on either view are refused; then a would-be forged next() has nothing to run on
  refuses(cb.constructor, [b, { HL: 4, dims: 1 }]);
  refuses(ca.constructor, [a, { HL: 4, dims: 1 }]);
  refuses(ca.constructor, [b, { HL: 4, dims: 1 }, {}]);
  assert.deepEqual(snap(ca), sa);
  assert.deepEqual(snap(cb), sb);
  assert.equal(a.cursor(), ca);
  assert.equal(b.cursor(), cb);
  assert.equal(ca.next(), true); // the sibling's own next() must not invalidate b's cursor
  assert.equal(cb.valid, true);
  assert.deepEqual(snap(cb), sb);
  assert.equal(cb.next(), true);
  assert.deepEqual(snap(cb), { valid: true, index: 8, entity: 108, m: 9, off: 36 });
  assert.equal(ca.valid, true);
});

test('R-A7: the key is stored nowhere reachable; the cursor keeps its 4 fields', () => {
  const v = new SumSequence(64, { leafSize: 4, dims: 1 });
  fill(v, 24, 100);
  const c = v.cursor();
  assert.deepEqual(Reflect.ownKeys(c), ['_st', '_stk', '_off', '_v']);
  for (const o of [c, v]) for (const k of Reflect.ownKeys(o)) refuses(c.constructor, [v, { HL: 4, dims: 1 }, o[k]]);
});

// ---------------------------------------------------------------------------------------------------------------
// R-A8 + R-A11: readCounters brand + true length
// ---------------------------------------------------------------------------------------------------------------

function nonzeroView() {
  const v = new SumSequence(64, { leafSize: 4, dims: 1 });
  fill(v, 24, 100);
  for (let i = 0; i < 24; i++) v.entityAt(i);
  v.indexAtSum(0, 10);
  const ref = new Int32Array(12);
  v.readCounters(ref);
  assert.ok(ref.some((x) => x !== 0), 'counters nonzero (precondition)');
  return v;
}
function counterError(fn) {
  assert.throws(fn, (e) => {
    assert.ok(e instanceof RangeError, 'RangeError, got ' + (e && e.constructor && e.constructor.name) + ': ' + e);
    assert.ok(e.message.startsWith('counters '), 'message starts with "counters ", got "' + e.message + '"');
    return true;
  });
}

test('R-A8 3a: Object.create(Int32Array.prototype) -> RangeError counters', () => {
  const v = nonzeroView();
  counterError(() => v.readCounters(Object.create(Int32Array.prototype)));
});

test('R-A8 3b: Object.create(Int32Array.prototype, {length: 12}) -> RangeError counters', () => {
  const v = nonzeroView();
  counterError(() => v.readCounters(Object.create(Int32Array.prototype, { length: { value: 12 } })));
});

test('R-A8 3c: Int32Array(4) with an own length of 12 -> RangeError counters, out untouched', () => {
  const v = nonzeroView();
  const out = new Int32Array(4).fill(SENT);
  Object.defineProperty(out, 'length', { value: 12 });
  counterError(() => v.readCounters(out));
  for (let i = 0; i < 4; i++) assert.equal(out[i], SENT, 'element ' + i + ' still the sentinel');
});

test('R-A8 3d: Int32Array(12) with an own valueOf-spy length reads without running user code', () => {
  const v = nonzeroView();
  let calls = 0;
  const out = new Int32Array(12).fill(SENT);
  Object.defineProperty(out, 'length', { value: { valueOf() { calls++; return 12; } } });
  v.readCounters(out);
  assert.equal(calls, 0, 'user valueOf never ran');
  const ref = new Int32Array(12);
  v.readCounters(ref);
  assert.deepEqual(Array.from(out), Array.from(ref));
  assert.ok(ref.some((x) => x !== 0));
});

test('R-A8: a Proxy around a genuine Int32Array(12) -> RangeError counters, zero trap calls', () => {
  const v = nonzeroView();
  let traps = 0;
  const target = new Int32Array(12).fill(SENT);
  const px = new Proxy(target, {
    get(t, k, r) { traps++; return Reflect.get(t, k, t); },
    has(t, k) { traps++; return Reflect.has(t, k); },
    getOwnPropertyDescriptor(t, k) { traps++; return Reflect.getOwnPropertyDescriptor(t, k); },
    getPrototypeOf(t) { traps++; return Reflect.getPrototypeOf(t); },
  });
  counterError(() => v.readCounters(px));
  assert.equal(traps, 0, 'no trap ran before the throw');
  for (let i = 0; i < 12; i++) assert.equal(target[i], SENT);
});

test('R-A8: cached getters; post-load patches of Function.prototype.call and the tag / length getters run no user code', () => {
  const v = nonzeroView();
  const T = Object.getPrototypeOf(Int32Array.prototype);
  const tagD = Object.getOwnPropertyDescriptor(T, Symbol.toStringTag);
  const lenD = Object.getOwnPropertyDescriptor(T, 'length');
  const oc = Function.prototype.call;
  const forged = Object.create(Int32Array.prototype);
  let user = 0;
  let ok = false;
  let err = null;
  try {
    Object.defineProperty(T, Symbol.toStringTag, { get() { user++; return 'Int32Array'; }, configurable: true });
    Object.defineProperty(T, 'length', { get() { user++; return 12; }, configurable: true });
    Function.prototype.call = function (self, ...a) { user++; return Reflect.apply(this, self, a); };
    v.readCounters(new Int32Array(12));
    ok = true;
    try { v.readCounters(forged); } catch (e) { err = e; }
  } finally {
    Function.prototype.call = oc;
    Object.defineProperty(T, Symbol.toStringTag, tagD);
    Object.defineProperty(T, 'length', lenD);
  }
  assert.equal(user, 0, 'user code ran');
  assert.ok(ok, 'genuine out read');
  assert.ok(err instanceof RangeError, 'RangeError, got ' + err);
  assert.equal(err.message, 'counters out must be an Int32Array');
});

test('R-A8 [PASS-both]: genuine Int32Array(12), Int32Array(16) and a subclass instance read the counters', () => {
  const v = nonzeroView();
  class X extends Int32Array {}
  const ref = new Int32Array(12);
  v.readCounters(ref);
  for (const out of [new Int32Array(12), new Int32Array(16).fill(SENT), new X(12)]) {
    v.readCounters(out);
    for (let i = 0; i < 12; i++) assert.equal(out[i], ref[i], 'counter ' + i);
  }
  const big = new Int32Array(16).fill(SENT);
  v.readCounters(big);
  for (let i = 12; i < 16; i++) assert.equal(big[i], SENT, 'tail untouched');
});

test('R-A8 [PASS-both]: null / undefined / 12 / a plain array of 12 -> RangeError counters', () => {
  const v = nonzeroView();
  for (const bad of [null, undefined, 12, new Array(12).fill(0), new Int32Array(11)]) {
    counterError(() => v.readCounters(bad));
  }
});

test('R-A8 [PASS-both]: an Int32Array(12) with a detached buffer -> RangeError counters', () => {
  const v = nonzeroView();
  const out = new Int32Array(12);
  structuredClone(out.buffer, { transfer: [out.buffer] });
  assert.equal(out.byteLength, 0, 'precondition: detached');
  counterError(() => v.readCounters(out));
});

// ---------------------------------------------------------------------------------------------------------------
// R-A9: census -- every `>` / `>=` in a throw guard's condition lies inside a `!( ... )` group
// ---------------------------------------------------------------------------------------------------------------

// strip comments and string / template literals (newlines kept, so line numbers survive); same as CounterCensus.
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

// matching paren: s[i] === '('; returns the index of its ')' or -1
function closeParen(s, i) {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    if (s[j] === '(') depth++;
    else if (s[j] === ')' && --depth === 0) return j;
  }
  return -1;
}

// returns { guards: [{line, cond}], violations: [{line, cond}] }; line = the line of the `if` keyword.
function census(source) {
  const s = strip(source);
  const lineOf = (p) => { let l = 1; for (let i = 0; i < p; i++) if (s[i] === '\n') l++; return l; };
  const guards = [];
  const violations = [];
  const re = /\bif\s*\(/g;
  let m;
  while ((m = re.exec(s)) !== null) {
    const open = m.index + m[0].length - 1;
    const cl = closeParen(s, open);
    if (cl < 0) continue;
    let p = cl + 1;
    while (p < s.length && /\s/.test(s[p])) p++;
    if (s[p] === '{') { p++; while (p < s.length && /\s/.test(s[p])) p++; }
    const rest = s.slice(p, p + 12);
    if (!(/^(ygFail\s*\(|ygCorrupt\s*\(|throw\b)/.test(rest))) continue;
    const cond = s.slice(open + 1, cl);
    const line = lineOf(m.index);
    guards.push({ line, cond: cond.replace(/\s+/g, ' ').trim() });
    // scan comparison operators in cond; each must have an enclosing `!(` group
    const stack = []; // true when the open paren is a `!(`
    let bad = false;
    for (let j = 0; j < cond.length; j++) {
      const ch = cond[j];
      if (ch === '(') {
        let k = j - 1;
        while (k >= 0 && /\s/.test(cond[k])) k--;
        stack.push(k >= 0 && cond[k] === '!');
      } else if (ch === ')') {
        stack.pop();
      } else if (ch === '>') {
        const prev = cond[j - 1];
        const next = cond[j + 1];
        if (prev === '=' || prev === '>' || next === '>') continue; // =>, >>, >>>, >>=, >>>=
        // exempt: the closed-over constant `dims` against a numeric literal (arity switch, line 1289 on 73de8dca);
        // it is not a user index / dim bound, so there is no NaN to close. Anything else must be inside `!(`.
        if (/\bdims\s*$/.test(cond.slice(0, j)) && /^=?\s*\d\s*\)\s*&\s*\(typeof m\d/.test(cond.slice(j + 1))) continue;
        if (!stack.some((x) => x)) bad = true;
      } else if (ch === '<') {
        // reversed bound: `n <= i` / `ar.dims <= d` (left operand n or ending in dims) outside a `!(` group
        if (cond[j - 1] === '<' || cond[j + 1] === '<') continue; // <<, <<=
        if (/^=?\s*\d/.test(cond.slice(j + 1))) continue; // lower bound against a literal (`dims < 1`), not an upper bound
        if (/(^|[^\w$.])n\s*$/.test(cond.slice(0, j)) || /\bdims\s*$/.test(cond.slice(0, j))) {
          if (!stack.some((x) => x)) bad = true;
        }
      }
    }
    if (bad) violations.push({ line, cond: cond.replace(/\s+/g, ' ').trim() });
  }
  return { guards, violations };
}

if (process.env.YG_CENSUS_PRINT) {
  console.log('CENSUS ' + JSON.stringify(census(fs.readFileSync(ENGINE_PATH, 'utf8'))));
}

const OLD_LINES = [1241, 1278, 1392, 1482, 1485, 1557, 1560, 1606, 1655, 1704, 1706, 1816, 1941, 1951, 1966, 2029];

test('R-A9: the engine has 0 non-NaN-closed throw-guard comparisons', () => {
  const r = census(fs.readFileSync(ENGINE_PATH, 'utf8'));
  assert.ok(r.guards.length > 50, 'census found the guards (fail closed): ' + r.guards.length);
  assert.deepEqual(r.violations.map((x) => x.line + ': ' + x.cond), []);
});

test('R-A9: exactly 16 throw guards carry the new NaN-closed bound text', () => {
  const r = census(fs.readFileSync(ENGINE_PATH, 'utf8'));
  const hit = r.guards.filter((g) => g.cond.includes('!(i <= n)') || g.cond.includes('!(i < n)') || g.cond.includes('!(d < '));
  assert.equal(hit.length, 16, 'lines: ' + hit.map((g) => g.line).join(','));
});

test('R-A9 [PASS-both]: on the frozen 73de8dca source the census reports exactly the 16 known lines', { skip: !fs.existsSync(BEFORE_PATH) && 'frozen before build absent' }, () => {
  const r = census(fs.readFileSync(BEFORE_PATH, 'utf8'));
  assert.deepEqual(r.violations.map((x) => x.line), OLD_LINES);
});

test('R-A9 [PASS-both]: census fixtures the census must flag', () => {
  const bad = [
    "if (i > n) ygFail('index', 'x');",
    "if (((i >>> 0) !== i) | (i >= n)) ygFail('index', 'x');",
    "if (typeof d !== 'number' || (((d >>> 0) !== d) | (d >= ar.dims))) {\n      ygFail('dim', 'x');\n    }",
    "if (x > y) throw new RangeError('x');",
    "if (((i >>> 0) !== i) | (n <= i)) ygFail('index', 'x');",
    "if (ar.dims <= d) ygFail('dim', 'x');",
  ];
  for (const f of bad) assert.equal(census(f).violations.length, 1, f);
});

test('R-A9 [PASS-both]: census fixtures the census must pass', () => {
  const good = [
    "if (!((m >= 0) & (m <= YG_MAX))) ygFail('measure', 'x');",
    "if (((i >>> 0) !== i) | !(i <= n)) ygFail('index', 'x');",
    'while (w > 1) w >>>= 1;',
    'if (acc + m > y) break;',
    'const f = (a) => a >>> 0;',
    "// if (x > y) throw new Error('x');",
    "const s = \"if (x > y) throw new Error('x');\";",
  ];
  for (const f of good) assert.equal(census(f).violations.length, 0, f);
  // the pass fixtures that are throw guards are seen as guards (the scan is live, not blind)
  assert.equal(census(good[0]).guards.length, 1);
  assert.equal(census(good[1]).guards.length, 1);
});
