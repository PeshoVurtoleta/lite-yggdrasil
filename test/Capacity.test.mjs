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

// ---- C-14 RV-6: the at-cap sentinel (no 8 GiB allocation) -----------------------

test('C-14 RV-6: C = cap reaches the typed-array sentinel; C = cap + 1 throws RangeError before it', () => {
  const RealF = globalThis.Float64Array;
  const RealI = globalThis.Int32Array;
  const seen = [];
  const firstLen = [];
  class SentinelHit extends Error {}
  function sentinel(len) { seen.push(len); throw new SentinelHit('sentinel'); }
  let reached = 0;
  let cells = 0;
  try {
    for (const B of BS) {
      for (const k of KS_CAP) {
        const cap = capOf(B, k);
        // at the cap: every check passes, so the first typed-array allocation hits the sentinel.
        globalThis.Float64Array = sentinel;
        globalThis.Int32Array = sentinel;
        let atCap = null;
        const n0 = seen.length;
        try { SumSequence.arena(cap, { leafSize: B }, k); } catch (e) { atCap = e; }
        firstLen.push(seen[n0]);
        // cap + 1: a RangeError from the checks, the sentinel never called.
        const before = seen.length;
        let over = null;
        try { SumSequence.arena(cap + 1, { leafSize: B }, k); } catch (e) { over = e; }
        const overSeen = seen.length - before;
        globalThis.Float64Array = RealF;
        globalThis.Int32Array = RealI;
        assert.ok(atCap instanceof SentinelHit, 'B=' + B + ' k=' + k + ' at cap: expected the sentinel, got ' + String(atCap));
        assert.ok(over instanceof RangeError, 'B=' + B + ' k=' + k + ' cap+1: expected RangeError, got ' + String(over));
        assert.equal(overSeen, 0, 'B=' + B + ' k=' + k + ' cap+1 reached the allocator');
        reached++;
        cells++;
      }
    }
  } finally {
    globalThis.Float64Array = RealF;
    globalThis.Int32Array = RealI;
  }
  assert.equal(cells, 16);
  assert.equal(reached, 16);
  assert.equal(globalThis.Float64Array, RealF);
  // The FIRST requested length per cell is the leaf ent column: Lmax(cap) * B = 2^30 (C-14).
  assert.equal(firstLen.length, 16);
  for (const len of firstLen) assert.equal(len, TWO30);
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

const A_CAP = 'if (C > YG_SLOT_CAP - m * k)';
const A_ALLOC = 'const ent = new Int32Array(LB);';
const A_CAPLINE = A_CAP + " ygFail('capacity', 'C must be <= 2^28 - (leafSize/4) * count');";

// Same row through the same path: real build (no patches beyond a no-op identical replacement) vs mutant.
async function withBuild(patches, fn) {
  const b = await buildMutant(SRC, patches);
  try { return await fn(b); } finally { b.cleanup(); }
}

// Count-4097 row at C = 2^20: validate-after-allocate (count check moved below the first allocation).
// The anchor is the count check; the mutant re-checks it after `ent` is allocated.
const A_COUNT = "if (typeof k !== 'number' || !Number.isInteger(k) || k < 1 || k > YG_MAX_VIEWS || k > C) {";

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
    [A_ALLOC, A_ALLOC + " if (typeof k !== 'number' || !Number.isInteger(k) || k < 1 || k > YG_MAX_VIEWS || k > C) ygFail('count', 'late');", 1],
  ];
  await withBuild(patches, (ns) => {
    const r = row4097(ns);
    assert.ok(r.err instanceof RangeError, 'mutant still rejects, just late');
    assert.ok(r.delta >= MIB, 'mutant delta ' + r.delta + ' should be >= 1 MiB (an unchecked build allocates >= 32 MiB)');
  });
});

test('mutant control MUST fail: validate-after-allocate on a cap+1 row reaches the allocator (sentinel)', async () => {
  const patches = [
    [A_CAPLINE, 'if (false) {}', 1],
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

test('mutant control MUST fail: a cap without the k term (- m * k -> - m) accepts the k=3 cap+1 rows', async () => {
  await withBuild([[A_CAP, 'if (C > YG_SLOT_CAP - m)', 1]], (ns) => {
    // k = 1: indistinguishable (cap - m*1 == cap - m): still rejected.
    for (const B of BS) {
      assert.throws(() => ns.SumSequence.arena(capOf(B, 1) + 1, { leafSize: B }, 1), RangeError);
    }
    // k = 3: the real cap rejects cap+1; the mutant passes the cap check, so the real row would FAIL on it.
    const RealF = globalThis.Float64Array;
    const RealI = globalThis.Int32Array;
    class Hit extends Error {}
    let reached = 0;
    try {
      globalThis.Float64Array = function () { throw new Hit('s'); };
      globalThis.Int32Array = function () { throw new Hit('s'); };
      for (const B of BS) {
        try { ns.SumSequence.arena(capOf(B, 3) + 1, { leafSize: B }, 3); } catch (x) { if (x instanceof Hit) reached++; }
      }
    } finally { globalThis.Float64Array = RealF; globalThis.Int32Array = RealI; }
    assert.equal(reached, 4, 'the k-less cap lets cap+1 reach the allocator for every B at k=3');
  });
});
