// test/AuditFixes.test.mjs -- UNIT AF rows (audit 2026-10-27): F-1 clear() corrupt-view guard, AF-4 NaN headroom
// guards, F-6 no `views` array on the shared arena record.
// Written FROM THE SPEC (.handoff/AUDIT-2026-10-27-TRIAGE.md UNIT AF; 0005 C-8 / C-44), not from engine output.
// Row kinds: FAIL-ON-OLD (must be red on 287d10c1), PASS-both (control), PIN (passes on both).
// ASCII only.

import { test } from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { SumSequence } from '../Yggdrasil.js';

const EMPTY_ROOT = 0x3FFFFFFF; // C-8 / C-44 constant (the fresh view's _root), written as a literal from the spec

// ---------------------------------------------------------------- full-state serializer
// Deep, order-stable text of every typed array / array / scalar reachable from the given roots (views, their
// columns, hdr, cursor, the arena record _ar). -0, NaN and types are distinguished. Cycles are cut by a visited set.
function ser(roots) {
  const seen = new Set();
  const out = [];
  const num = (x) => (Object.is(x, -0) ? '-0' : String(x));
  function go(x, path) {
    if (typeof x === 'function') return;
    if (x === null || typeof x !== 'object') { out.push(path + '=' + typeof x + ':' + (typeof x === 'number' ? num(x) : String(x))); return; }
    if (seen.has(x)) { out.push(path + '=@seen'); return; }
    seen.add(x);
    if (ArrayBuffer.isView(x)) {
      const parts = [];
      for (let i = 0; i < x.length; i++) parts.push(typeof x[i] === 'bigint' ? String(x[i]) : num(x[i]));
      out.push(path + '=' + x.constructor.name + '[' + parts.join(',') + ']');
      return;
    }
    const keys = Array.isArray(x) ? Array.from(x.keys()) : Reflect.ownKeys(x);
    out.push(path + '=obj' + (Array.isArray(x) ? 'A' : 'O') + keys.length);
    // _ar.sx is the staging scratch (C-44): insertAt / setMeasure stage the new measure there before the headroom
    // check, on the old build too, so it is not view state and is left out.
    for (const k of keys) if (!(k === 'sx' && (path === 'r1' || path.endsWith('._ar')))) go(x[k], path + '.' + String(k));
  }
  for (let i = 0; i < roots.length; i++) go(roots[i], 'r' + i);
  return out.join('\n');
}

function expectCorrupt(views, target, label) {
  const before = ser([views, views[0]._ar]);
  let err = null;
  try { target.clear(); } catch (e) { err = e; }
  assert.ok(err instanceof Error, label + ': must throw, got ' + err);
  assert.ok(!(err instanceof RangeError), label + ': must be a plain Error, not RangeError');
  assert.ok(err.message.startsWith('lite-yggdrasil: clear() corrupt view: '), label + ': message ' + err.message);
  assert.equal(ser([views, views[0]._ar]), before, label + ': hdr / columns / views changed by a refused clear()');
}

// insertAt with exactly `dims` measure slots (m0 then 1s)
function ins(v, dims, i, e, m0) {
  const a = [m0];
  for (let d = 1; d < dims; d++) a.push(1);
  return v.insertAt(i, e, ...a);
}

function fresh(o, C) { return new SumSequence(C === undefined ? 8 : C, o); }

// ---------------------------------------------------------------- 1. clear() guard (AF-1)

test('F-1a [FAIL-ON-OLD]: empty view with _len forged to live (sibling holds all) throws, nothing changes', () => {
  const vs = SumSequence.arena(64, { leafSize: 4, dims: 1 }, 2);
  const [a, b] = vs;
  for (let i = 0; i < 6; i++) a.insertAt(i, 100 + i, 10);
  assert.equal(a._hdr[0], 6);
  b._len = 6; // live === 6, _len === 6, _root still EMPTY_ROOT: (_len === 0) !== (_root === EMPTY_ROOT)
  expectCorrupt(vs, b, 'k=2 forged _len');
  assert.equal(a._hdr[0], 6);
  assert.equal(a.length, 6);
  assert.equal(a.entityAt(0), 100);
});

test('F-1a [FAIL-ON-OLD]: live 0, _len 0, _root 999 (out of range) throws at k=1 and k>=2', () => {
  for (const k of [1, 2, 3]) {
    const vs = SumSequence.arena(64, { leafSize: 4, dims: 1 }, k);
    vs[0]._root = 999; // internal bump is 0: no internal node 0..998 exists
    expectCorrupt(vs, vs[0], 'k=' + k + ' root 999');
  }
  const s = fresh({ leafSize: 4, dims: 1 });
  s._root = 999;
  expectCorrupt([s], s, 'new SumSequence root 999');
});

test('F-1a [FAIL-ON-OLD]: _len 0 with a leaf ref root, and _len > 0 with EMPTY_ROOT, both throw', () => {
  const vs = SumSequence.arena(64, { leafSize: 4, dims: 1 }, 2);
  vs[0].insertAt(0, 1, 1);
  vs[1].insertAt(0, 2, 1);
  const r0 = vs[0]._root;
  vs[0]._len = 0; // root is a live leaf ref but _len 0
  expectCorrupt(vs, vs[0], 'len 0 with leaf root');
  vs[0]._len = 1;
  vs[0]._root = EMPTY_ROOT; // _len 1 with EMPTY_ROOT
  expectCorrupt(vs, vs[0], 'len 1 with EMPTY_ROOT');
  vs[0]._root = r0;
});

test('F-1b [FAIL-ON-OLD]: non-Int32 / fractional negative _root (-Infinity, -2**32, -0.5, -(2**32)+1) throws', () => {
  for (const bad of [-Infinity, -(2 ** 32), -0.5, -(2 ** 32) + 1]) {
    // forged on an empty-with-_len-1 sibling that sits beside a freed leaf (the audit shape)
    const vs = SumSequence.arena(64, { leafSize: 4, dims: 1 }, 3);
    const [a, b, c] = vs;
    for (let i = 0; i < 4; i++) a.insertAt(i, i + 1, 1);
    for (let i = 0; i < 4; i++) b.insertAt(i, i + 10, 1);
    b.clear(); // a valid clear: leaf 1 goes on the free list
    c._root = bad;
    c._len = 1;
    expectCorrupt(vs, c, 'empty c root ' + String(bad));
    // forged on a real non-empty view
    const ws = SumSequence.arena(64, { leafSize: 4, dims: 1 }, 2);
    for (let i = 0; i < 6; i++) ws[0].insertAt(i, i + 1, 1);
    ws[0]._root = bad;
    expectCorrupt(ws, ws[0], 'non-empty root ' + String(bad));
  }
});

test('F-1c [FAIL-ON-OLD]: non-number _root (null, false, "", 0.5, "-1", [-1]) throws', () => {
  for (const bad of [null, false, '', 0.5, '-1', [-1]]) {
    const vs = SumSequence.arena(64, { leafSize: 4, dims: 1 }, 2);
    const [a, b] = vs;
    for (let i = 0; i < 8; i++) a.insertAt(i, i, 1); // 2 leaves + 1 internal: lb 2, ib 1, live 8
    b._root = bad;
    b._len = 3;
    expectCorrupt(vs, b, 'root ' + JSON.stringify(bad));
    assert.equal(a._hdr[0], 8, 'live untouched for ' + JSON.stringify(bad));
  }
  // "-1" with a leaf already allocated (lb >= 1): the old build freed the sibling leaf 0
  const vs = SumSequence.arena(64, { leafSize: 4, dims: 1 }, 2);
  for (let i = 0; i < 3; i++) vs[0].insertAt(i, i + 1, 1);
  vs[1]._root = '-1';
  vs[1]._len = 1;
  expectCorrupt(vs, vs[1], 'string -1 with lb 1');
});

test('F-1d [FAIL-ON-OLD]: _len = NaN and _len = -50 throw', () => {
  for (const bad of [NaN, -50]) {
    const vs = SumSequence.arena(16, { leafSize: 4, dims: 1 }, 2);
    const [a, b] = vs;
    for (let i = 0; i < 4; i++) a.insertAt(i, i, 1);
    for (let i = 0; i < 2; i++) b.insertAt(i, i, 1);
    b._len = bad;
    expectCorrupt(vs, b, '_len ' + String(bad));
    assert.equal(a._hdr[0], 6);
    assert.equal(a.available, 10);
  }
});

test('F-1d [FAIL-ON-OLD]: _len above live, fractional or string throws on a non-empty view', () => {
  for (const bad of [7, 1.5, '2', null]) {
    const vs = SumSequence.arena(16, { leafSize: 4, dims: 1 }, 2);
    for (let i = 0; i < 2; i++) vs[0].insertAt(i, i, 1);
    for (let i = 0; i < 4; i++) vs[1].insertAt(i, i, 1); // live 6
    vs[0]._len = bad;
    expectCorrupt(vs, vs[0], '_len ' + JSON.stringify(bad));
  }
});

test('control [PASS-both]: valid clear() at k=1 leaves the constructed state (C-8)', () => {
  for (const dims of [1, 2]) {
    const s = new SumSequence(32, { leafSize: 4, dims });
    const f = new SumSequence(32, { leafSize: 4, dims });
    assert.equal(s.clear(), s); // empty view, EMPTY_ROOT + _len 0 accepted
    for (let i = 0; i < 11; i++) { if (dims === 1) s.insertAt(i, i + 1, 3); else s.insertAt(i, i + 1, 3, 2); }
    s.removeAt(4); s.removeAt(0);
    assert.equal(s.clear(), s);
    assert.deepEqual(Array.from(s._hdr), [0, 0, -1, 0, -1]);
    assert.equal(s._root, EMPTY_ROOT);
    for (const k of ['_len', '_fl', '_fb', '_fdepth', '_cv']) assert.equal(s[k], f[k], k);
    assert.equal(s.available, 32);
    if (dims === 1) s.insertAt(0, 5, 7); else s.insertAt(0, 5, 7, 1); // reusable after clear
    assert.equal(s.entityAt(0), 5);
  }
});

test('control [PASS-both]: valid clear() at k>=2 (empty and non-empty views, after inserts / removes)', () => {
  for (const k of [2, 3]) {
    const vs = SumSequence.arena(48, { leafSize: 4, dims: 2 }, k);
    const fv = SumSequence.arena(48, { leafSize: 4, dims: 2 }, k);
    assert.equal(vs[k - 1].clear(), vs[k - 1]); // empty view among empty views: EMPTY_ROOT + _len 0 accepted
    for (let i = 0; i < 9; i++) vs[0].insertAt(i, i + 1, 2, 1);
    for (let i = 0; i < 5; i++) vs[1].insertAt(i, 50 + i, 1, 1);
    vs[0].removeAt(3); vs[1].removeAt(1);
    assert.equal(vs[0]._hdr[0], 8 + 4);
    vs[0].clear();
    assert.equal(vs[0]._len, 0);
    assert.equal(vs[0]._root, EMPTY_ROOT);
    assert.equal(vs[0]._hdr[0], 4); // only vs[1] still holds 4
    assert.equal(vs[1].length, 4);
    vs[1].clear();
    assert.deepEqual(Array.from(vs[0]._hdr), Array.from(fv[0]._hdr)); // last holder: hdr back to fresh
    assert.equal(vs[1]._root, EMPTY_ROOT);
    assert.equal(vs[1]._len, 0);
  }
});

test('control [FAIL-ON-OLD]: a refused-clear shape is cleared fine once the view is valid again', () => {
  const vs = SumSequence.arena(32, { leafSize: 4, dims: 1 }, 2);
  for (let i = 0; i < 5; i++) vs[0].insertAt(i, i, 1);
  const r = vs[0]._root;
  vs[0]._root = 'x';
  assert.throws(() => vs[0].clear(), /corrupt view/);
  vs[0]._root = r;
  assert.equal(vs[0].clear(), vs[0]);
  assert.equal(vs[0]._hdr[0], 0);
});

// ---------------------------------------------------------------- 2. NaN headroom guards (AF-4)

function headroom(fn, views, label) {
  const before = ser([views, views[0]._ar]);
  let err = null;
  try { fn(); } catch (e) { err = e; }
  assert.ok(err instanceof RangeError, label + ': RangeError expected, got ' + err);
  assert.ok(err.message.startsWith('headroom'), label + ': message ' + err.message);
  assert.equal(ser([views, views[0]._ar]), before, label + ': state changed by the refused call');
}

// A one-leaf view (root is a leaf ref) and a multi-leaf view (root is an internal node); NaN forged into the
// cached sum of dim d at the root.
function forgeNaN(v, d) {
  const r = v._root;
  if (r < 0) v._lsum[d][~r] = NaN; else v._sums[d][r] = NaN;
}

test('AF-4 insertAt dims=1 [FAIL-ON-OLD]: NaN cached total throws headroom (leaf root and internal root)', () => {
  for (const n of [3, 12]) {
    const vs = SumSequence.arena(32, { leafSize: 4, dims: 1 }, 2);
    for (let i = 0; i < n; i++) vs[0].insertAt(i, i + 1, 2);
    assert.equal(vs[0]._root < 0, n === 3);
    forgeNaN(vs[0], 0);
    headroom(() => vs[0].insertAt(1, 99, 1), vs, 'insertAt n=' + n);
  }
});

test('AF-4 insertAt dims>=2 [FAIL-ON-OLD]: NaN in any dim throws headroom', () => {
  for (const dims of [2, 3]) {
    for (const d of [0, dims - 1]) {
      for (const n of [3, 12]) {
        const vs = SumSequence.arena(32, { leafSize: 4, dims }, 2);
        for (let i = 0; i < n; i++) ins(vs[0], dims, i, i + 1, 2);
        forgeNaN(vs[0], d);
        headroom(() => ins(vs[0], dims, 0, 99, 1), vs, 'insertAt dims=' + dims + ' d=' + d + ' n=' + n);
      }
    }
  }
});

test('AF-4 setMeasure [FAIL-ON-OLD]: NaN cached total throws headroom (dims 1 and 2, leaf and internal root)', () => {
  for (const dims of [1, 2]) {
    for (const n of [3, 12]) {
      const vs = SumSequence.arena(32, { leafSize: 4, dims }, 2);
      for (let i = 0; i < n; i++) ins(vs[0], dims, i, i + 1, 2);
      const d = dims - 1;
      forgeNaN(vs[0], d);
      headroom(() => vs[0].setMeasure(1, d, 5), vs, 'setMeasure dims=' + dims + ' n=' + n);
    }
  }
});

test('AF-4 append [FAIL-ON-OLD]: NaN total on the left view or on the right view throws headroom', () => {
  for (const side of ['left', 'right']) {
    for (const dims of [1, 2]) {
      const vs = SumSequence.arena(48, { leafSize: 4, dims }, 2);
      for (let i = 0; i < 5; i++) ins(vs[0], dims, i, i + 1, 2);
      for (let i = 0; i < 5; i++) ins(vs[1], dims, i, 20 + i, 3);
      forgeNaN(side === 'left' ? vs[0] : vs[1], dims - 1);
      headroom(() => vs[0].append(vs[1]), vs, 'append ' + side + ' dims=' + dims);
    }
  }
});

test('AF-4 control [PIN]: finite totals still pass, and the boundary total 2^53-1 is accepted', () => {
  const MAX = 9007199254740991;
  const s = new SumSequence(8, { leafSize: 4, dims: 1 });
  s.insertAt(0, 1, MAX - 5);
  s.insertAt(1, 2, 5);
  assert.equal(s.total(0), MAX);
  assert.throws(() => s.insertAt(0, 3, 1), (e) => e instanceof RangeError && e.message.startsWith('headroom'));
  s.setMeasure(0, 0, MAX - 5); // unchanged value at a full total
  assert.equal(s.total(0), MAX);
});

// ---------------------------------------------------------------- 3. F-6 (AF-5): no `views` on the arena record

test('F-6 [FAIL-ON-OLD]: no views key on _ar for new SumSequence and for every SumSequence.arena view', () => {
  const s = new SumSequence(8);
  assert.ok(!('views' in s._ar));
  for (const count of [1, 2, 5]) {
    const vs = SumSequence.arena(16, undefined, count);
    for (const v of vs) assert.ok(!('views' in v._ar), 'count ' + count);
  }
});

test('F-6 [FAIL-ON-OLD]: arena() returns an Array of exactly count distinct views sharing one _ar', () => {
  for (const count of [1, 2, 3, 7]) {
    const vs = SumSequence.arena(16, { leafSize: 4, dims: 2 }, count);
    assert.ok(Array.isArray(vs));
    assert.equal(vs.length, count);
    assert.equal(new Set(vs).size, count);
    for (const v of vs) { assert.ok(v instanceof SumSequence); assert.equal(v._ar, vs[0]._ar); assert.equal(v._hdr, vs[0]._hdr); }
    // a returned array of exactly `count`: nothing can be reached by a stray 'views' key either
    assert.ok(!('views' in vs[0]._ar));
  }
});

test('F-6 [PASS-both]: two arena() calls give independent arrays, views and arenas; mutating the array changes nothing', () => {
  const x = SumSequence.arena(16, undefined, 3);
  const y = SumSequence.arena(16, undefined, 3);
  assert.notEqual(x, y);
  assert.notEqual(x[0]._ar, y[0]._ar);
  const all = new Set([...x, ...y]);
  assert.equal(all.size, 6);
  x.length = 0;
  x.push(1);
  const z = SumSequence.arena(16, undefined, 3);
  assert.equal(z.length, 3);
  assert.equal(y.length, 3);
  y[0].insertAt(0, 1, 1);
  assert.equal(y[1].length, 0);
  assert.equal(z[0].length, 0);
});

// ---------------------------------------------------------------- 4. AF-3: ygSlots checks sx[1..dims-1] inline

// PIN: the slot checks (range first, then integer) behave the same on both builds; only the call shape changed.
test('AF-3 (a) [PIN]: insertAt slots d >= 1: fractional -> integer form; out of range / NaN / Inf -> range form (range first)', () => {
  const INT = 'measure must be an integer';
  const RNG = 'measure must be in [0, 2^53-1]';
  const put = (dims, d, m) => {
    const a = [1];
    for (let j = 1; j < dims; j++) a.push(j === d ? m : 1);
    return a;
  };
  for (const dims of [2, 3, 4]) {
    for (let d = 1; d < dims; d++) {
      const bad = [[0.5, INT], [2 ** 51 + 0.5, INT], [-0.5, RNG], [NaN, RNG], [Infinity, RNG], [2 ** 53, RNG], [-1, RNG]];
      for (const [m, msg] of bad) {
        const vs = SumSequence.arena(16, { leafSize: 4, dims }, 2);
        vs[0].insertAt(0, 1, ...put(dims, 0, 1)); // one valid element so the throw is not an empty-view effect
        const before = ser([vs, vs[0]._ar]);
        let err = null;
        try { vs[0].insertAt(0, 2, ...put(dims, d, m)); } catch (e) { err = e; }
        const tag = 'dims ' + dims + ' d ' + d + ' m ' + String(m);
        assert.ok(err instanceof RangeError, tag + ': ' + err);
        assert.equal(err.message, msg, tag);
        assert.equal(ser([vs, vs[0]._ar]), before, tag + ': state changed');
      }
      for (const m of [-0, 2 ** 53 - 1]) {
        const v = new SumSequence(16, { leafSize: 4, dims });
        v.insertAt(0, 1, ...put(dims, d, m)); // empty view: total(d) is exactly m (+0 for -0)
        assert.equal(v.total(d), m === 0 ? 0 : 2 ** 53 - 1, 'dims ' + dims + ' d ' + d + ' m ' + String(m));
        assert.ok(Object.is(v.total(d), m === 0 ? 0 : 2 ** 53 - 1) || m === 0, 'exact');
      }
    }
  }
});

function stripSrc(src) { // comments and string literals blanked, newlines kept
  return src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g, (m) => m.replace(/[^\n]/g, ' '));
}

// FAIL-ON-OLD: 287d10c1 validated the slots by calling ygMeasure(sx[d]) (a Float64 crossing a call).
test('AF-3 (b) [FAIL-ON-OLD]: function ygSlots has no call carrying an sx element and no ygMeasure', () => {
  const t = stripSrc(fs.readFileSync(new URL('../Yggdrasil.js', import.meta.url), 'utf8'));
  const a = t.indexOf('function ygSlots');
  assert.ok(a >= 0, 'ygSlots not found');
  const o = t.indexOf('{', a);
  let depth = 0, e = o;
  for (; e < t.length; e++) { if (t[e] === '{') depth++; else if (t[e] === '}' && --depth === 0) break; }
  const body = t.slice(o, e + 1);
  assert.ok(body.length > 40, 'body sliced');
  assert.ok(!/\(\s*sx\s*\[/.test(body), 'a call carries sx[...]');
  assert.ok(!/\bygMeasure\b/.test(body), 'ygMeasure referenced');
});
