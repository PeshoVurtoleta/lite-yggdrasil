// test/Capacity.test.mjs -- part 1: constructor / cap / pool rows (0005 C-11, C-14, C-15, C-16, C-37 RV-7).
//
// Expected values come from the 0005 CURRENT text, never from running the engine:
//   cap(B, k)  = 2^28 - m*k, m = B/4                      (C-14)
//   Lmax       = ceil(C/m) + k; leaf pool Lmax; internal pool Lmax - 1; _fpath length H(Lmax)  (C-15)
//   H          = test/spec-counts.mjs H (the independent C-30 module, DP-checked there)
// The ctor surface is `new SumSequence(C, o)` and `SumSequence.arena(C, o, k)`.
// Part 2 (the A2 / 0004 assertion-1 streams) needs ops and lands later. ASCII only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SumSequence } from '../Yggdrasil.js';
import { H } from './spec-counts.mjs';
import { buildMutant } from './mutant-build.mjs';
import { fileURLToPath } from 'node:url';

const SRC = fileURLToPath(new URL('../Yggdrasil.js', import.meta.url));

const MIB = 1024 * 1024;
const TWO28 = 2 ** 28;
const TWO30 = 2 ** 30;
const TWO32 = 2 ** 32;
const BS = [4, 8, 16, 32];
const KS_CAP = [1, 3, 6, 4096];

// ---- independent arithmetic (C-14 / C-15) ------------------------------------

function capOf(B, k) { return TWO28 - (B / 4) * k; }
function lmaxOf(C, B, k) { return Math.ceil(C / (B / 4)) + k; }

// ---- helpers -------------------------------------------------------------------

function ab() {
  if (typeof globalThis.gc === 'function') globalThis.gc();
  return process.memoryUsage().arrayBuffers;
}

// Run fn; it must throw a RangeError; the arrayBuffers delta stays under 1 MiB.
function rejects(label, fn) {
  const before = ab();
  let err = null;
  try { fn(); } catch (e) { err = e; }
  const delta = process.memoryUsage().arrayBuffers - before;
  assert.ok(err instanceof RangeError, label + ': expected RangeError, got ' + String(err));
  assert.ok(delta < MIB, label + ': arrayBuffers delta ' + delta + ' >= 1 MiB');
  return err;
}

// arena() returns exactly one shape: an Array of views.
function arenaOf(r) {
  assert.ok(Array.isArray(r), 'arena() must return an Array');
  return r;
}

// RA-1 / C-44 layout: hoisted column refs on each view as '_' + column name.
function col(v, name) {
  const c = v['_' + name];
  assert.ok(c && typeof c.length === 'number', 'column _' + name + ' not found on the view');
  return c;
}

// ---- C-14 rows: the cap formula itself ------------------------------------------

test('C-14: cap literals for k = 1 (268435456 / 268435455 / 268435453 / 268435449 are cap + 1)', () => {
  // C = 2^28 - m*k + 1 at k = 1 for B = 4, 8, 16, 32 (m = 1, 2, 4, 8).
  const want = [268435456, 268435455, 268435453, 268435449];
  BS.forEach((B, i) => assert.equal(capOf(B, 1) + 1, want[i], 'B=' + B));
});

test('C-14 arithmetic: Lmax(cap)*B == 2^30 and Lmax(cap+1)*B == 2^30 + 4m for all 16 cells', () => {
  let n = 0;
  for (const B of BS) {
    for (const k of KS_CAP) {
      const m = B / 4;
      const cap = capOf(B, k);
      assert.equal(lmaxOf(cap, B, k) * B, TWO30, 'cap B=' + B + ' k=' + k);
      assert.equal(lmaxOf(cap + 1, B, k) * B, TWO30 + 4 * m, 'cap+1 B=' + B + ' k=' + k);
      n++;
    }
  }
  assert.equal(n, 16);
});

test('control (arithmetic): a cap without the k term (2^28 - m) passes k=1 and fails k=3', () => {
  for (const B of BS) {
    const m = B / 4;
    const sloppy = TWO28 - m;
    assert.equal(sloppy, capOf(B, 1), 'k=1 rows cannot tell the two caps apart, B=' + B);
    assert.notEqual(sloppy, capOf(B, 3), 'k=3 rows must tell them apart, B=' + B);
    // C = true cap + 1 at k=3 is rejected by the real cap but accepted by the sloppy one.
    assert.ok(capOf(B, 3) + 1 <= sloppy, 'B=' + B);
  }
});

// ---- ASSERTION 1: rejected ctor rows ----------------------------------------------

test('A1: count 4097 at C = 2^20 is a RangeError with no allocation (arena)', () => {
  rejects('count 4097', () => SumSequence.arena(2 ** 20, undefined, 4097));
});

test('A1: count 4 at C = 3 is a RangeError (count <= C)', () => {
  rejects('count 4 C=3', () => SumSequence.arena(3, undefined, 4));
});

test('A1: count 0, 1.5, NaN, a string are RangeErrors (count is an integer in 1..min(C,4096))', () => {
  for (const c of [0, -1, 1.5, NaN, '2']) {
    rejects('count ' + String(c), () => SumSequence.arena(8, undefined, c));
  }
});

test('A1: C = 2^28 - m*k + 1 is a RangeError for B 4..32 x k {1,3,6,4096} (arena)', () => {
  for (const B of BS) {
    for (const k of KS_CAP) {
      const C = capOf(B, k) + 1;
      rejects('B=' + B + ' k=' + k, () => SumSequence.arena(C, { leafSize: B }, k));
    }
  }
});

test('A1: C = 2^28 - m + 1 at k = 1 is a RangeError through the plain ctor too (= arena(C, o, 1))', () => {
  for (const B of BS) {
    const C = capOf(B, 1) + 1;
    rejects('new B=' + B, () => new SumSequence(C, { leafSize: B }));
  }
});

test('A1: C = 2^30 is a RangeError', () => {
  rejects('2^30 new', () => new SumSequence(TWO30));
  rejects('2^30 arena', () => SumSequence.arena(TWO30, undefined, 3));
});

test('A1: C = 0, 1.5, NaN, "8" (and -1, Infinity, null) are RangeErrors', () => {
  for (const C of [0, 1.5, NaN, '8', -1, Infinity, null]) {
    rejects('C=' + String(C), () => new SumSequence(C));
  }
});

test('A1: dims 0 and 5 (and 1.5, "2") are RangeErrors', () => {
  for (const d of [0, 5, 1.5, '2', -1, NaN]) {
    rejects('dims ' + String(d), () => new SumSequence(8, { dims: d }));
  }
});

test('A1: leafSize 12 and "16" (and 0, 2, 64) are RangeErrors; 4, 8, 16, 32 are accepted', () => {
  for (const L of [12, '16', 0, 2, 64, NaN, 16.5]) {
    rejects('leafSize ' + String(L), () => new SumSequence(8, { leafSize: L }));
  }
  for (const L of BS) assert.doesNotThrow(() => new SumSequence(8, { leafSize: L }), 'leafSize ' + L);
});

// ---- C-11 option rows -----------------------------------------------------------

test('C-11: [], null, Object.create({dims:5}), {dims:undefined}, {[Symbol()]:1} are RangeErrors', () => {
  const rows = [
    ['[]', () => []],
    ['null', () => null],
    ['Object.create({dims:5})', () => Object.create({ dims: 5 })],
    ['{dims:undefined}', () => ({ dims: undefined })],
    ['{leafSize:undefined}', () => ({ leafSize: undefined })],
    ['{[Symbol()]:1}', () => ({ [Symbol('s')]: 1 })],
    ['unknown key', () => ({ finger: true })],
  ];
  for (const [label, mk] of rows) {
    rejects(label, () => new SumSequence(8, mk()));
    rejects(label + ' (arena)', () => SumSequence.arena(8, mk(), 2));
  }
});

test('C-11: an accessor options key is a RangeError and its getter is called 0 times', () => {
  for (const key of ['dims', 'leafSize']) {
    let calls = 0;
    const o = {};
    Object.defineProperty(o, key, { enumerable: true, configurable: true, get() { calls++; return 2; } });
    rejects('accessor ' + key, () => new SumSequence(8, o));
    assert.equal(calls, 0, 'getter for ' + key + ' was called');
  }
});

test('C-11: {dim: 2} is a RangeError whose message contains "dims"; the typo is not echoed (RV-4)', () => {
  const err = rejects('{dim:2}', () => new SumSequence(8, { dim: 2 }));
  assert.ok(String(err.message).includes('dims'), 'message: ' + err.message);
  const err2 = rejects('{xyzzy:2}', () => new SumSequence(8, { xyzzy: 2 }));
  assert.ok(!String(err2.message).includes('xyzzy'), 'the user key must not be echoed: ' + err2.message);
});

test('C-11: Object.create(null) with {dims: 2} is accepted and gives dims 2', () => {
  const o = Object.create(null);
  o.dims = 2;
  const s = new SumSequence(8, o);
  assert.equal(s._ar.dims, 2);
});

test('C-11 RV-3: an inherited Object.prototype.dims is ignored (dims stays 1)', () => {
  assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, 'dims'), false);
  Object.prototype.dims = 3;
  try {
    const a = new SumSequence(8);
    const b = new SumSequence(8, {});
    const c = new SumSequence(8, { leafSize: 8 });
    for (const s of [a, b, c]) assert.equal(s._ar.dims, 1);
  } finally {
    delete Object.prototype.dims;
  }
  assert.equal(Object.prototype.hasOwnProperty.call(Object.prototype, 'dims'), false);
});

// ---- C-14 RV-6 / R-C1: the byte cap binds below the C cap; no real allocation -------------

// Independent byte oracle (R-C1), from the arena allocation list, not from the engine's formula.
// Int32 = 4 B, Float64 = 8 B. Lmax = ceil(C/m) + k; LB = Lmax*B; NI = Lmax - 1; HL = H(Lmax).
//   arena: ent Int32(LB); meas dims x F64(LB); llen, lnext Int32(Lmax); lsum dims x F64(Lmax);
//          left, right, weight, count, inext Int32(NI); sums dims x F64(NI); hdr Int32(5); sx F64(4);
//          jstack, sstack Int32(HL)
//   per view (x k): _fpath Int32(HL), _n Int32(12), _st Int32(4), _stk Int32(HL), _off F64(dims)
function oracleBytes(C, B, k, dims) {
  const Lmax = Math.ceil(C / (B / 4)) + k;
  const LB = Lmax * B;
  const NI = Lmax - 1;
  const HLm = H(Lmax);
  const arenaB = 4 * LB + 8 * dims * LB + 4 * 2 * Lmax + 8 * dims * Lmax +
    4 * 5 * NI + 8 * dims * NI + 4 * 5 + 8 * 4 + 4 * 2 * HLm;
  const viewB = 4 * HLm + 4 * 12 + 4 * 4 + 4 * HLm + 8 * dims;
  return arenaB + k * viewB;
}

// Largest C with oracleBytes(C) <= 2^32 (oracleBytes is non-decreasing in C), searched in [k, cap].
function bigC(B, k, dims) {
  let lo = k;
  let hi = capOf(B, k);
  assert.ok(oracleBytes(lo, B, k, dims) <= TWO32, 'smallest C already over the byte cap');
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (oracleBytes(mid, B, k, dims) <= TWO32) lo = mid; else hi = mid - 1;
  }
  return lo;
}

// Recording sentinel: replaces the global typed-array constructors, records (bytes) per call and
// returns a zero-length REAL array, so construction completes with no allocation. Every OTHER typed-array
// constructor is pointed at a throwing sentinel while installed (an allocation of a kind the engine must
// not use here is loud), and restore() puts all of them back.
const OTHER_TA = ['Int8Array', 'Uint8Array', 'Uint8ClampedArray', 'Int16Array', 'Uint16Array', 'Uint32Array',
  'Float32Array', 'BigInt64Array', 'BigUint64Array'];
function installRecorder() {
  const RealI = globalThis.Int32Array;
  const RealF = globalThis.Float64Array;
  const rec = { calls: 0, bytes: 0, firstLen: -1, RealI, RealF };
  const saved = [];
  function note(len, size) { if (rec.calls === 0) rec.firstLen = len; rec.calls++; rec.bytes += len * size; }
  rec.restore = () => {
    globalThis.Int32Array = RealI; globalThis.Float64Array = RealF;
    for (let k = 0; k < saved.length; k++) globalThis[saved[k][0]] = saved[k][1];
  };
  try {
    globalThis.Int32Array = function (len) { note(len, 4); return new RealI(0); };
    globalThis.Float64Array = function (len) { note(len, 8); return new RealF(0); };
    for (const name of OTHER_TA) {
      saved.push([name, globalThis[name]]);
      globalThis[name] = function () { throw new Error('recorder sentinel: unexpected ' + name + ' allocation'); };
    }
  } catch (e) { rec.restore(); throw e; }
  return rec;
}

// Run fn(rec) with the recorder installed; always restores.
function withRecorder(fn) {
  const rec = installRecorder();
  try { return fn(rec); } finally { rec.restore(); }
}

function tryCall(fn) {
  try { return { v: fn(), err: null }; } catch (e) { return { v: null, err: e }; }
}

const DIMS_ALL = [1, 2, 3, 4];

test('R-C1: oracle sanity (hand-computed): C = 1, B = 4, dims = 1, k = 1', () => {
  // Lmax = 1 + 1 = 2, LB = 8, NI = 1, H(2) = 1 (floor(3*2/4) = 1).
  // arena: 4*8 + 8*8 + 4*4 + 8*2 + 4*5*1 + 8*1 + 20 + 32 + 4*2*1 = 32+64+16+16+20+8+20+32+8 = 216
  // view : 4*1 + 48 + 16 + 4*1 + 8 = 80. Total 296.
  assert.equal(oracleBytes(1, 4, 1, 1), 296);
});

test('R-C1: byte cap binds below the C cap in all 64 cells (C* < 2^28 - m*k)', () => {
  let n = 0;
  for (const B of BS) for (const d of DIMS_ALL) for (const k of KS_CAP) {
    const Cs = bigC(B, k, d);
    assert.ok(Cs < capOf(B, k), 'B=' + B + ' d=' + d + ' k=' + k + ' C*=' + Cs);
    assert.ok(oracleBytes(Cs, B, k, d) <= TWO32);
    assert.ok(oracleBytes(Cs + 1, B, k, d) > TWO32);
    n++;
  }
  assert.equal(n, 64);
});

test('R-C1: at C* the ctor requests exactly oracleBytes (<= 2^32); C*+1 is a RangeError, 0 calls', () => {
  const RealI = globalThis.Int32Array;
  const RealF = globalThis.Float64Array;
  let cells = 0;
  for (const B of BS) for (const d of DIMS_ALL) for (const k of KS_CAP) {
    const Cs = bigC(B, k, d);
    const tag = 'B=' + B + ' d=' + d + ' k=' + k + ' C*=' + Cs;
    withRecorder((rec) => {
      const r = tryCall(() => SumSequence.arena(Cs, { leafSize: B, dims: d }, k));
      assert.equal(r.err, null, tag + ' at C*: ' + String(r.err));
      assert.equal(r.v.length, k, tag);
      assert.equal(rec.firstLen, (Math.ceil(Cs / (B / 4)) + k) * B, tag + ' first length is Lmax*B');
      assert.equal(rec.bytes, oracleBytes(Cs, B, k, d), tag + ' total bytes');
      assert.ok(rec.bytes <= TWO32, tag);
    });
    withRecorder((rec) => {
      const r = tryCall(() => SumSequence.arena(Cs + 1, { leafSize: B, dims: d }, k));
      assert.ok(r.err instanceof RangeError, tag + ' C*+1: ' + String(r.err));
      assert.ok(String(r.err.message).includes('2^32 bytes'), tag + ' message: ' + r.err.message);
      assert.equal(rec.calls, 0, tag + ' C*+1 reached the allocator');
    });
    cells++;
  }
  assert.equal(cells, 64);
  assert.equal(globalThis.Int32Array, RealI);
  assert.equal(globalThis.Float64Array, RealF);
});

test('R-C1: the plain ctor (= arena(C, o, 1)) at C* and C*+1, B x dims (16 cells)', () => {
  let cells = 0;
  for (const B of BS) for (const d of DIMS_ALL) {
    const Cs = bigC(B, 1, d);
    const tag = 'new B=' + B + ' d=' + d + ' C*=' + Cs;
    withRecorder((rec) => {
      const r = tryCall(() => new SumSequence(Cs, { leafSize: B, dims: d }));
      assert.equal(r.err, null, tag + ': ' + String(r.err));
      assert.equal(rec.bytes, oracleBytes(Cs, B, 1, d), tag + ' total bytes');
      assert.ok(rec.bytes <= TWO32, tag);
    });
    withRecorder((rec) => {
      const r = tryCall(() => new SumSequence(Cs + 1, { leafSize: B, dims: d }));
      assert.ok(r.err instanceof RangeError, tag + ' C*+1: ' + String(r.err));
      assert.ok(String(r.err.message).includes('2^32 bytes'), tag + ' message: ' + r.err.message);
      assert.equal(rec.calls, 0, tag + ' C*+1 reached the allocator');
    });
    cells++;
  }
  assert.equal(cells, 16);
});

test('R-C1: check order -- C = 2^28 - m*k + 1 (both caps fail) reports the C cap, not the byte cap', () => {
  let cells = 0;
  for (const B of BS) for (const k of KS_CAP) {
    withRecorder((rec) => {
      const r = tryCall(() => SumSequence.arena(capOf(B, k) + 1, { leafSize: B, dims: 4 }, k));
      assert.ok(r.err instanceof RangeError, 'B=' + B + ' k=' + k);
      assert.ok(String(r.err.message).includes('2^28'), 'message: ' + r.err.message);
      assert.ok(!String(r.err.message).includes('2^32'), 'message: ' + r.err.message);
      assert.equal(rec.calls, 0);
    });
    cells++;
  }
  assert.equal(cells, 16);
});

test('C-14 RV-6: C = cap now hits the byte cap (2^32 bytes), cap + 1 the C cap (2^28); sentinel never called', () => {
  const RealF = globalThis.Float64Array;
  const RealI = globalThis.Int32Array;
  let cells = 0;
  try {
    for (const B of BS) {
      for (const k of KS_CAP) {
        const cap = capOf(B, k);
        const rec = installRecorder();
        const a = tryCall(() => SumSequence.arena(cap, { leafSize: B }, k));
        const callsAtCap = rec.calls;
        const b = tryCall(() => SumSequence.arena(cap + 1, { leafSize: B }, k));
        const callsTotal = rec.calls;
        rec.restore();
        const tag = 'B=' + B + ' k=' + k;
        assert.ok(a.err instanceof RangeError, tag + ' at cap: ' + String(a.err));
        assert.ok(String(a.err.message).includes('2^32 bytes'), tag + ' at cap message: ' + a.err.message);
        assert.equal(callsAtCap, 0, tag + ' at cap reached the allocator');
        assert.ok(b.err instanceof RangeError, tag + ' cap+1: ' + String(b.err));
        assert.ok(String(b.err.message).includes('2^28'), tag + ' cap+1 message: ' + b.err.message);
        assert.equal(callsTotal, 0, tag + ' cap+1 reached the allocator');
        cells++;
      }
    }
  } finally {
    globalThis.Float64Array = RealF;
    globalThis.Int32Array = RealI;
  }
  assert.equal(cells, 16);
  assert.equal(globalThis.Float64Array, RealF);
  assert.equal(globalThis.Int32Array, RealI);
});

// ---- ASSERTION 2: pools ---------------------------------------------------------

test('A2: (C=4096, B=16, k=6) -> leaf pool 1030, internal pool 1029', () => {
  const vs = arenaOf(SumSequence.arena(4096, { leafSize: 16 }, 6));
  assert.equal(vs.length, 6);
  const v = vs[0];
  assert.equal(col(v, 'llen').length, 1030);
  assert.equal(col(v, 'left').length, 1029);
  assert.equal(v._fpath.length, H(1030));
});

test('A2: pool grid C {1,3,17,4096,1e5} x B {4,8,16,32} x k {1,3,6} (k <= C)', () => {
  let cells = 0;
  for (const C of [1, 3, 17, 4096, 1e5]) {
    for (const B of BS) {
      for (const k of [1, 3, 6]) {
        if (k > C) continue; // count must be <= C (C-14)
        const Lm = lmaxOf(C, B, k);
        const tag = 'C=' + C + ' B=' + B + ' k=' + k;
        const vs = arenaOf(SumSequence.arena(C, { leafSize: B }, k));
        assert.equal(vs.length, k, tag);
        const v = vs[0];
        assert.equal(col(v, 'llen').length, Lm, 'leaf pool ' + tag);
        assert.equal(col(v, 'lnext').length, Lm, 'lnext ' + tag);
        assert.equal(col(v, 'ent').length, Lm * B, 'ent ' + tag);
        assert.equal(col(v, 'left').length, Lm - 1, 'internal pool ' + tag);
        assert.equal(col(v, 'inext').length, Lm - 1, 'inext ' + tag);
        assert.equal(v._fpath.length, H(Lm), '_fpath ' + tag);
        assert.equal(v._ar.Lmax, Lm, '_ar.Lmax ' + tag);
        for (const w of vs) {
          assert.equal(w.capacity, C, 'capacity ' + tag);
          assert.equal(w.available, C, 'available (fresh) ' + tag);
        }
        cells++;
      }
    }
  }
  // 5 C values x 4 B x 3 k = 60, minus C=1 (k=3,6: 8 cells) and C=3 (k=6: 4 cells) = 48.
  assert.equal(cells, 48);
});

test('A2: the plain ctor sizes its pools for k = 1 (= arena(C, o, 1))', () => {
  for (const B of BS) {
    const v = new SumSequence(17, { leafSize: B });
    const Lm = lmaxOf(17, B, 1);
    assert.equal(col(v, 'llen').length, Lm);
    assert.equal(col(v, 'left').length, Lm - 1);
    assert.equal(v.capacity, 17);
    assert.equal(v.available, 17);
  }
});

test('control (arithmetic): Lmax + 1 and ceil(C/m) both fail the (4096, 16, 6) pool row', () => {
  const Lm = lmaxOf(4096, 16, 6);
  assert.equal(Lm, 1030);
  assert.notEqual(Lm + 1, 1030);
  assert.notEqual(Math.ceil(4096 / 4), 1030); // no k term: 1024
  assert.notEqual(Math.ceil(4096 / 4) + 6 - 1, 1030); // one k short
  // and at k = 1 the two formulas agree off by exactly k - 1, so k > 1 rows are the teeth
  assert.equal(lmaxOf(4096, 16, 1), 1025);
});

// ---- source mutants (C-46 M-8, buildMutant) ------------------------------------------

const A_CAP = 'if (!(C <= YG_SLOT_CAP - m * k))';
const A_ALLOC = 'const ent = new Int32Array(LB);';
const A_BYTE = "if (!(ygBytes(C, B, k, dims) <= YG_BYTE_CAP)) " +
  "ygFail('capacity', 'arena typed arrays must total <= 2^32 bytes');";
const A_CAPLINE = A_CAP + " ygFail('capacity', 'C must be <= 2^28 - (leafSize/4) * count');";

// Same row through the same path: real build (no patches beyond a no-op identical replacement) vs mutant.
async function withBuild(patches, fn) {
  const b = await buildMutant(SRC, patches);
  try { return await fn(b); } finally { b.cleanup(); }
}

// Count-4097 row at C = 2^20: validate-after-allocate (count check moved below the first allocation).
// The anchor is the count check; the mutant re-checks it after `ent` is allocated.
const A_COUNT = "if (typeof k !== 'number' || !Number.isInteger(k) || k < 1 || !(k <= YG_MAX_VIEWS) || !(k <= C)) {";

function row4097(ns) {
  const before = ab();
  let err = null;
  try { ns.SumSequence.arena(2 ** 20, undefined, 4097); } catch (e) { err = e; }
  return { err, delta: process.memoryUsage().arrayBuffers - before };
}

test('mutant control: real build passes the count-4097 row (delta < 1 MiB) through buildMutant', async () => {
  await withBuild([[A_ALLOC, A_ALLOC, 1]], (ns) => {
    const r = row4097(ns);
    assert.ok(r.err instanceof RangeError);
    assert.ok(r.delta < MIB, 'delta ' + r.delta);
  });
});

test('mutant control MUST fail: validate-after-allocate on count 4097 shows delta >= 1 MiB', async () => {
  const patches = [
    [A_COUNT, 'if (false) {', 1],
    [A_ALLOC, A_ALLOC + " if (typeof k !== 'number' || !Number.isInteger(k) || k < 1 || k > YG_MAX_VIEWS || k > C) " +
      "ygFail('count', 'late');", 1],
  ];
  await withBuild(patches, (ns) => {
    const r = row4097(ns);
    assert.ok(r.err instanceof RangeError, 'mutant still rejects, just late');
    assert.ok(r.delta >= MIB,
      'mutant delta ' + r.delta + ' should be >= 1 MiB (an unchecked build allocates >= 32 MiB)');
  });
});

test('mutant control MUST fail: validate-after-allocate on a cap+1 row reaches the allocator (sentinel)', async () => {
  const patches = [
    [A_CAPLINE, 'if (false) {}', 1],
    [A_BYTE, '', 1], // else the byte cap masks the moved C cap
    [A_ALLOC, A_ALLOC + " if (C > YG_SLOT_CAP - m * k) ygFail('capacity', 'late');", 1],
  ];
  await withBuild(patches, (ns) => {
    const RealI = globalThis.Int32Array;
    class Hit extends Error {}
    try {
      globalThis.Int32Array = function (len) { throw new Hit('sentinel'); };
      let e = null;
      try { ns.SumSequence.arena(capOf(16, 3) + 1, { leafSize: 16 }, 3); } catch (x) { e = x; }
      globalThis.Int32Array = RealI;
      assert.ok(e instanceof Hit, 'mutant must reach the allocator, got ' + String(e));
    } finally { globalThis.Int32Array = RealI; }
  });
});

test('mutant control MUST fail: a cap without the k term (- m * k -> - m): k=3 cap+1 hits the byte cap', async () => {
  await withBuild([[A_CAP, 'if (C > YG_SLOT_CAP - m)', 1]], (ns) => {
    // k = 1: indistinguishable (cap - m*1 == cap - m): still rejected.
    for (const B of BS) {
      assert.throws(() => ns.SumSequence.arena(capOf(B, 1) + 1, { leafSize: B }, 1), RangeError);
    }
    // k = 3: the real build rejects cap+1 with the C-cap message ('2^28'); the k-less mutant passes the
    // C cap and the byte cap (which is below it everywhere) rejects with '2^32 bytes' instead.
    // Recording sentinel installed for safety: nothing is allocated.
    for (const B of BS) {
      withRecorder((rec) => {
        const r = tryCall(() => ns.SumSequence.arena(capOf(B, 3) + 1, { leafSize: B }, 3));
        assert.ok(r.err instanceof RangeError, 'B=' + B);
        assert.ok(String(r.err.message).includes('2^32 bytes'), 'B=' + B + ' message: ' + r.err.message);
        assert.ok(!String(r.err.message).includes('2^28'), 'B=' + B + ' message: ' + r.err.message);
        assert.equal(rec.calls, 0);
      });
    }
  });
});

const A_PERVIEW = 't += k * (8 * HL + 4 * YG_NC + 16 + 8 * dims);';

test('mutant control: real build (no-op patch) passes the C*+1 byte-cap row through buildMutant', async () => {
  await withBuild([[A_BYTE, A_BYTE, 1]], (ns) => {
    const Cs = bigC(16, 1, 1);
    withRecorder((rec) => {
      const r = tryCall(() => ns.SumSequence.arena(Cs + 1, { leafSize: 16, dims: 1 }, 1));
      assert.ok(r.err instanceof RangeError);
      assert.ok(String(r.err.message).includes('2^32 bytes'));
      assert.equal(rec.calls, 0);
    });
  });
});

test('mutant control MUST fail: M1 dropping the byte line lets C*+1 reach the allocator', async () => {
  await withBuild([[A_BYTE, '', 1]], (ns) => {
    const Cs = bigC(16, 1, 1);
    withRecorder((rec) => {
      const r = tryCall(() => ns.SumSequence.arena(Cs + 1, { leafSize: 16, dims: 1 }, 1));
      assert.ok(r.err === null, 'M1 must not throw at C*+1 (the real build throws)');
      assert.ok(rec.calls > 0, 'M1 reaches the allocator');
    });
  });
});

test('mutant control MUST fail: M2 byte line moved below the first allocation reaches the sentinel', async () => {
  const patches = [
    [A_BYTE, '', 1],
    [A_ALLOC, A_ALLOC + ' ' + A_BYTE, 1],
  ];
  await withBuild(patches, (ns) => {
    const Cs = bigC(16, 1, 1);
    withRecorder((rec) => {
      const r = tryCall(() => ns.SumSequence.arena(Cs + 1, { leafSize: 16, dims: 1 }, 1));
      assert.ok(r.err instanceof RangeError, 'M2 still rejects, just late');
      assert.ok(rec.calls >= 1, 'M2 allocates before rejecting (real build: 0 calls)');
    });
  });
});

test('mutant control MUST fail: M3 dropping the per-view term moves the count-4096 boundary up', async () => {
  await withBuild([[A_PERVIEW, '', 1]], (ns) => {
    let moved = 0;
    for (const d of DIMS_ALL) {
      const Cs = bigC(16, 4096, d);
      withRecorder((rec) => {
        const r = tryCall(() => ns.SumSequence.arena(Cs + 1, { leafSize: 16, dims: d }, 4096));
        // the real build throws '2^32 bytes' at C*+1; the mutant under-counts and does not
        if (r.err === null && rec.calls > 0) moved++;
      });
    }
    assert.equal(moved, 4, 'M3 must accept C*+1 at count 4096 for every dims');
  });
});

// ---- NaN fails closed (K-R2 TASK 4): `!(bytes <= cap)`, never `bytes > cap` ---------------------------
// Anchor: the end of ygBytes (`  return t;` + newline + `}`, exactly once). The mutant makes ygBytes return NaN, a
// byte total that is no number. Spec (zero-box law): "NaN fails closed by construction: write !(x < bound), never
// x >= bound", so the constructor must throw RangeError 'capacity' ('2^32 bytes') before any typed-array call.
// Must FAIL on the pre-K-R2 build, where the check reads `ygBytes(...) > YG_BYTE_CAP` (NaN > cap is false).
const A_YGBYTES_END = '  return t;\n}';

test('R-C1 NaN row: a ygBytes that returns NaN makes the constructor throw RangeError capacity with 0 typed-array calls', async () => {
  await withBuild([[A_YGBYTES_END, '  return NaN;\n}', 1]], (ns) => {
    for (const B of BS) {
      withRecorder((rec) => {
        const r = tryCall(() => ns.SumSequence.arena(64, { leafSize: B, dims: 1 }, 1));
        assert.ok(r.err instanceof RangeError, 'B=' + B + ' NaN bytes must throw, got ' + String(r.err));
        assert.ok(String(r.err.message).includes('2^32 bytes'), 'B=' + B + ' message: ' + r.err.message);
        assert.equal(rec.calls, 0, 'B=' + B + ' reached the allocator');
      });
    }
  });
});

test('NaN row control: ygBytes unpatched (identity through buildMutant) builds a small arena', async () => {
  await withBuild([[A_YGBYTES_END, A_YGBYTES_END, 1]], (ns) => {
    withRecorder((rec) => {
      const r = tryCall(() => ns.SumSequence.arena(64, { leafSize: 16, dims: 1 }, 1));
      assert.equal(r.err, null);
      assert.ok(rec.calls > 0);
    });
  });
});
