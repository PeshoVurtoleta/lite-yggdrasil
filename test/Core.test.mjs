// test/Core.test.mjs -- rung 2 (A-R1b) one-leaf core + rung 3 (A-R2, part 2: ASSERTION 4, split / rotation / seek
// mutants): ADR 0005 C-3 / C-5 (re-home, NIL), C-8 (clear keeps _n),
// C-18 (moves), C-24 (COUNTERS), C-4 / C-26 (hit / miss), C-44 (layout), I-4
// (strict seek). Expected values come from the spec formulas and from test/oracle.mjs (an independent plain-array
// model), never from engine output. PLAN-E0-A ASSERTIONS 1-3 + RA-4 (rung 2) and ASSERTION 4 (rung 3, A-R2: split,
// pull, rotations; C-18 / C-19 / C-20 / C-23 / C-25 / C-34). ASCII only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SumSequence } from '../Yggdrasil.js';
import { bfsLane, deepLane, coverageMissing, mergeTally } from './exhaustive.mjs';
import {
  appendStream, prependStream, insertMoves, removeMoves, repMoves, touchesExact, TOUCH_REMOVE_UNDERFLOW,
  H, pullsHot,
} from './spec-counts.mjs';
import { engineFactory } from './adapter.mjs';
import { Oracle } from './oracle.mjs';
import { walk } from './walker.mjs';

const CN = SumSequence.COUNTERS;
const EMPTY_ROOT = 0x3FFFFFFF;

function counters(v) {
  const out = new Int32Array(12);
  v.readCounters(out);
  return out;
}

// ---- ASSERTION 1: bfs lane on the adapter ----
for (const B of [4, 8]) {
  test(`A1: bfsLane(engine adapter, B=${B}, nMax=${B}, all ops) ok, 0 divergences, every n seen`, () => {
    const rep = bfsLane(engineFactory, { B, nMax: B });
    assert.equal(rep.ok, true, JSON.stringify(rep.first));
    assert.equal(rep.divergences, 0);
    const seen = new Set(rep.states.map((s) => s.n));
    for (let n = 0; n <= B; n++) assert.ok(seen.has(n), 'n ' + n + ' seen');
    assert.ok(rep.applied > 0);
  });
}

test('A1: fresh snapshot NIL === 0, EMPTY_ROOT === 0x3FFFFFFF; a view owns _fl _fb _fdepth _fpath', () => {
  const { views, snapshot } = engineFactory(16, { leafSize: 4, dims: 1 }, 2);
  const s = snapshot();
  assert.equal(s.NIL, 0);
  assert.equal(s.EMPTY_ROOT, EMPTY_ROOT);
  assert.equal(walk(s, { B: 4, dims: 1 }), null);
  for (const v of views) for (const f of ['_fl', '_fb', '_fdepth', '_fpath']) assert.ok(Object.hasOwn(v, f), f);
});

// ---- ASSERTION 2: one-leaf moves + hit / miss + re-home ----
for (const B of [4, 8, 16]) {
  test(`A2: B=${B} one leaf: insert moves s-p, remove moves s-p (C-18); hit / miss per C-4, touches / pulls 0; re-home`, () => {
    let rows = 0;
    for (let s = 0; s <= B - 1; s++) for (let p = 0; p <= s; p++) {
      const tag = `B${B} s${s} p${p}`;
      // insert into an s-element leaf at p
      let v = new SumSequence(B, { leafSize: B });
      for (let j = 0; j < s; j++) v.insertAt(j, j + 1, 1);
      v.resetCounters();
      v.insertAt(p, 100, 1);
      let c = counters(v);
      assert.equal(c[CN.moves], s - p, tag + ' insert moves');
      // C-4 hand trace: the fill left the finger on the root leaf (fb 0, len s, depth 0). s = 0: view empty, fl NIL
      // -> miss. s >= 1: lo = 0 - ((0-1)>>>31) = -1, so hit iff -1 < p <= 0 + s and s < B: true for every p in [0, s].
      // C-25: a hit adds 0 touches; C-20: pulls = _fdepth = 0.
      assert.equal(c[CN.fingerMisses], s === 0 ? 1 : 0, tag + ' insert misses');
      assert.equal(c[CN.fingerHits], s === 0 ? 0 : 1, tag + ' insert hits');
      assert.equal(c[CN.touches], 0, tag + ' insert touches');
      assert.equal(c[CN.pulls], 0, tag + ' insert pulls');
      assert.equal(v.length, s + 1);
      // C-3: finger re-homed to the root leaf, fb = 0, depth 0
      assert.notEqual(v._fl, 0, tag + ' fl is not NIL');
      assert.equal(v._fl, v._root, tag + ' fl is the root leaf');
      assert.equal(v._fb, 0, tag + ' fb');
      assert.equal(v._fdepth, 0, tag + ' fdepth');
      // remove from an (s+1)-element leaf at p (p <= s)
      v = new SumSequence(B, { leafSize: B });
      for (let j = 0; j <= s; j++) v.insertAt(j, j + 1, 1);
      v.resetCounters();
      v.removeAt(p);
      c = counters(v);
      assert.equal(c[CN.moves], (s + 1) - 1 - p, tag + ' remove moves');
      // C-4 hand trace: single leaf (_fdepth 0), len s + 1, fb 0, p <= s: in range; hit iff len > 1, i.e. s >= 1.
      // s = 0 empties the view (drain, NIL): a miss.
      assert.equal(c[CN.fingerMisses], s === 0 ? 1 : 0, tag + ' remove misses');
      assert.equal(c[CN.fingerHits], s === 0 ? 0 : 1, tag + ' remove hits');
      assert.equal(c[CN.touches], 0, tag + ' remove touches');
      assert.equal(c[CN.pulls], 0, tag + ' remove pulls');
      assert.equal(v.length, s);
      if (s === 0) {
        // C-5 / C-3: a drained view writes NIL / 0 / 0 and its root is EMPTY_ROOT
        assert.equal(v._fl, 0, tag + ' drained fl NIL');
        assert.equal(v._fb, 0);
        assert.equal(v._fdepth, 0);
        assert.equal(v._root, EMPTY_ROOT);
      } else {
        assert.equal(v._fl, v._root, tag + ' remove fl is the root leaf');
        assert.equal(v._fb, 0, tag + ' remove fb');
        assert.equal(v._fdepth, 0, tag + ' remove fdepth');
      }
      rows++;
    }
    assert.equal(rows, (B * (B + 1)) / 2);
  });
}

// ---- B1: a positional op in the finger leaf is one hit (C-4, C-26) ----
test('B1: setMeasure / getMeasure / entityAt at 1 on a 3-element B=8 leaf: hit 1, miss 0, touches / moves / pulls 0, finger kept', () => {
  const calls = [(v) => v.setMeasure(1, 0, 2), (v) => v.getMeasure(1, 0), (v) => v.entityAt(1)];
  calls.forEach((call, ix) => {
    const v = new SumSequence(8, { leafSize: 8 });
    for (let j = 0; j < 3; j++) v.insertAt(j, j + 1, 1);
    v.resetCounters();
    call(v);
    const c = counters(v);
    // C-4: after 3 inserts the finger is the root leaf (fb 0, len 3); i = 1 lies in [0, 3): a hit. C-25: touches 0.
    // C-20: setMeasure pulls _fdepth = 0 on a root leaf; getMeasure / entityAt pull 0.
    assert.equal(c[CN.fingerMisses], 0, 'call ' + ix + ' misses');
    assert.equal(c[CN.fingerHits], 1, 'call ' + ix + ' hits');
    assert.equal(c[CN.touches], 0, 'call ' + ix + ' touches');
    assert.equal(c[CN.moves], 0, 'call ' + ix + ' moves');
    assert.equal(c[CN.pulls], 0, 'call ' + ix + ' pulls');
    assert.equal(v._fl, v._root, 'call ' + ix + ' fl');
    assert.equal(v._fb, 0);
    assert.equal(v._fdepth, 0);
  });
});

// ---- B2: seeks add 0 to hits / misses and touch nothing on a root leaf (RA-5, C-25, C-26, C-2) ----
test('B2: seeks on an empty view and on a 3-element leaf leave all 12 counters 0 and the finger alone', () => {
  const zero = Array.from({ length: 12 }, () => 0);
  const e = new SumSequence(8, { leafSize: 8 });
  e.indexAtSum(0, 0);
  e.sumBefore(0, 0);
  assert.deepEqual(Array.from(counters(e)), zero, 'empty view');
  const v = new SumSequence(8, { leafSize: 8 });
  for (let j = 0; j < 3; j++) v.insertAt(j, j + 1, 1);
  v.resetCounters();
  const f = [v._fl, v._fb, v._fdepth];
  const total = 3; // three measures of 1
  for (const y of [0, total - 1, total, total + 7]) v.indexAtSum(0, y);
  for (let k = 0; k <= 3; k++) v.sumBefore(0, k);
  assert.deepEqual(Array.from(counters(v)), zero, '3-element leaf');
  assert.deepEqual([v._fl, v._fb, v._fdepth], f);
});

// ---- B3: RA-4 guard teeth: no reset while another view is live ----
test('B3: a drain of view 0 beside live view 1 does not reset the pools', () => {
  const { views: v, snapshot } = engineFactory(8, { leafSize: 4, dims: 1 }, 3);
  v[0].insertAt(0, 1, 1);
  v[1].insertAt(0, 2, 1);
  v[0].removeAt(0);
  assert.equal(v[0]._hdr[0], 1, 'live');
  assert.equal(v[0]._hdr[1], 2, 'leaf bump');
  v[2].insertAt(0, 3, 1);
  v[0].insertAt(0, 4, 1);
  assert.equal(walk(snapshot(), { B: 4, dims: 1 }), null);
  assert.equal(v[1].entityAt(0), 2);
});

// ---- ASSERTION 3 + RA-4: hdr reset ----
test('A3: 100 cycles fill-to-B then clear(): hdr deep-equals a fresh arena [0,0,-1,0,-1]; _n kept (C-8)', () => {
  const B = 8;
  const v = new SumSequence(B, { leafSize: B });
  for (let cyc = 0; cyc < 100; cyc++) {
    for (let j = 0; j < B; j++) v.insertAt(j, j, 1);
    assert.equal(v.length, B);
    const before = counters(v);
    v.clear();
    assert.deepEqual(Array.from(v._hdr), [0, 0, -1, 0, -1], 'cycle ' + cyc);
    assert.deepEqual(Array.from(counters(v)), Array.from(before), 'cycle ' + cyc + ' _n kept');
    assert.equal(v.length, 0);
    assert.equal(v._root, EMPTY_ROOT);
    assert.equal(v._fl, 0);
  }
  // C-4 / C-5 hand trace: clear() leaves the finger NIL, so each cycle's first insert is a miss (fl NIL); inserts
  // j = 1..B-1 append at i = j into the root leaf (fb 0, len j < B): lo = -1 < j <= j, a hit. 100 cycles, _n kept:
  // misses 100, hits 100 * (B - 1).
  assert.equal(counters(v)[CN.fingerMisses], 100);
  assert.equal(counters(v)[CN.fingerHits], 100 * (B - 1));
});

test('RA-4: a removeAt drain to live 0 resets hdr to the fresh state', () => {
  const v = new SumSequence(8, { leafSize: 8 });
  for (let j = 0; j < 5; j++) v.insertAt(j, j, 1);
  assert.equal(v._hdr[0], 5);
  for (let j = 0; j < 5; j++) v.removeAt(0);
  assert.equal(v.length, 0);
  assert.deepEqual(Array.from(v._hdr), [0, 0, -1, 0, -1]);
  assert.equal(v._root, EMPTY_ROOT);
  assert.equal(v._fl, 0);
});

test('C-8: clear() returns this on the engine (0004:120) and the view is reusable', () => {
  const v = new SumSequence(8, { leafSize: 8 });
  v.insertAt(0, 1, 2);
  assert.equal(v.clear(), v);
  v.insertAt(0, 9, 4);
  assert.equal(v.entityAt(0), 9);
  assert.equal(v.total(0), 4);
});

// ---- I-4 seek boundary rows vs the Oracle ----
// Hand-checked anchors (strict rule, M-7: smallest i with S_i + m_i > y, else length):
//   dim 0 = [3,0,2,5,0,0,1,4]: S = 0,3,3,5,10,10,10,11,15
//   indexAtSum(0,3) = 2 (3+0 > 3 false, 3+2 > 3 true; a `>=` scan gives 0), (0,0) = 0, (0,10) = 6, (0,14) = 7, (0,15) = 8
//   dim 1 = [0,2,2,0,7,1,0,3]: indexAtSum(1,0) = 1 (zero-measure element 0 skipped; a `>=` scan gives 0)
const M0 = [3, 0, 2, 5, 0, 0, 1, 4];
const M1 = [0, 2, 2, 0, 7, 1, 0, 3];

function build(dims, m0s, m1s) {
  const v = new SumSequence(8, { leafSize: 8, dims });
  const o = new Oracle(dims);
  for (let i = 0; i < m0s.length; i++) {
    if (dims === 1) { v.insertAt(i, 10 + i, m0s[i]); o.insertAt(i, 10 + i, m0s[i]); }
    else { v.insertAt(i, 10 + i, m0s[i], m1s[i]); o.insertAt(i, 10 + i, m0s[i], m1s[i]); }
  }
  return { v, o };
}

test('I-4: hand-computed strict-seek anchors (dim 0 and dim 1)', () => {
  const { v } = build(2, M0, M1);
  assert.equal(v.indexAtSum(0, 3), 2);
  assert.equal(v.indexAtSum(0, 0), 0);
  assert.equal(v.indexAtSum(0, 10), 6);
  assert.equal(v.indexAtSum(0, 14), 7);
  assert.equal(v.indexAtSum(0, 15), 8);
  assert.equal(v.indexAtSum(1, 0), 1);
  assert.equal(v.total(0), 15);
  assert.equal(v.total(1), 15);
});

for (const dims of [1, 2]) {
  test(`I-4: B=8 one leaf, dims ${dims}: seek / sumBefore / total / getMeasure / entityAt rows equal the Oracle`, () => {
    const sets = [[M0, M1], [[0, 0, 0, 0, 0, 0, 0, 0], [1, 1, 1, 1, 1, 1, 1, 1]],
      [[5, 5, 5, 5, 5, 5, 5, 5], [0, 3, 0, 3, 0, 3, 0, 3]], [[0, 0, 4, 0, 0, 0, 0, 0], M1], [[7], [2]]];
    let rows = 0;
    for (const [a, b] of sets) {
      const { v, o } = build(dims, a, b);
      const n = a.length;
      assert.equal(v.length, o.length);
      for (let d = 0; d < dims; d++) {
        assert.equal(v.total(d), o.total(d));
        const ys = new Set([0, 0.5, 2.5]);
        const tot = o.total(d);
        for (let k = 0; k <= n; k++) {
          const s = o.sumBefore(d, k);
          ys.add(s); ys.add(s + 1);
          if (s - 1 >= 0) ys.add(s - 1);
          assert.equal(v.sumBefore(d, k), s, `sumBefore d${d} i${k}`);
          rows++;
        }
        ys.add(tot - 1 >= 0 ? tot - 1 : 0); ys.add(tot); ys.add(tot + 7);
        for (const y of ys) {
          assert.equal(v.indexAtSum(d, y), o.indexAtSum(d, y), `indexAtSum d${d} y${y} set ${a.join()}`);
          rows++;
        }
        for (let i = 0; i < n; i++) {
          assert.equal(v.getMeasure(i, d), o.getMeasure(i, d));
          rows++;
        }
      }
      for (let i = 0; i < n; i++) { assert.equal(v.entityAt(i), o.entityAt(i)); rows++; }
    }
    assert.ok(rows > 150, 'coverage floor: ' + rows);
  });
}

// ---- A-R2: the split exists (C-18); A-R3: the remove underflow repairs (C-18 / C-20 / C-22), nothing fails closed ----
test('A4: B=4, the 5th insert succeeds: splits +1, walker null (replaces the rung-2 fail-closed row)', () => {
  const { views, snapshot } = engineFactory(16, { leafSize: 4, dims: 1 }, 1);
  const v = views[0];
  for (let j = 0; j < 4; j++) v.insertAt(j, j, 1);
  assert.equal(counters(v)[CN.splits], 0);
  v.insertAt(2, 77, 1);
  assert.equal(v.length, 5);
  assert.equal(counters(v)[CN.splits], 1);
  assert.equal(walk(snapshot(), { B: 4, dims: 1 }), null);
  // C-18: insert at p = 2 into a full leaf, B = 4: interior p <= B/2 -> B - p = 2 moves (insertMoves closed form)
  assert.equal(insertMoves(4, 1, 4, 2, 1), 2);
  assert.equal(counters(v)[CN.moves], 2);
});

// A-R3 (replaces the rung-3 fail-closed row): B=4, m=1, 5 appends -> 4 | 1. removeAt(4) takes the only element of the
// right leaf: it underflows (s == m, not the only leaf), so it is repaired, never thrown (C-18, T-6). Hand values:
// u = right leaf (sR = 0 after the remove), v = the left leaf (sL = 4), uLeft false, t = 4 > B/2 = 2 -> equalize,
// rep = ceil(t/2) = 2 moves, base m-1-p = 0; leaves 2 | 2. Then removeAt(3) (right leaf 2 -> 1, no underflow, 0 moves),
// removeAt(2): the right leaf (s = 1 == m) underflows again, sL = 2, sR = 0, t = 2 <= B/2 -> merge, uLeft false so
// rep = sR = 0 moves; the view is one leaf of 2.
test('A-R3: B=4, 4|1 view, the underflowing removeAt(4) succeeds: equalize 2|2, moves 2; then a merge, moves 0', () => {
  const { views, snapshot } = engineFactory(16, { leafSize: 4, dims: 1 }, 1);
  const v = views[0];
  const o = new Oracle(1);
  for (let j = 0; j < 5; j++) { v.insertAt(j, j, 1); o.insertAt(j, j, 1); }
  assert.deepEqual(leafLens(v), [4, 1]);
  let c0 = counters(v);
  v.removeAt(4); o.removeAt(4);
  let c1 = counters(v);
  assert.equal(v.length, 4);
  assert.deepEqual(leafLens(v), [2, 2]);
  assert.equal(c1[CN.equalizes] - c0[CN.equalizes], 1);
  assert.equal(c1[CN.merges] - c0[CN.merges], 0);
  const rep1 = repMoves(4, 4, 0, 0);
  assert.equal(rep1, 2);
  assert.equal(c1[CN.moves] - c0[CN.moves], 2);
  assert.equal(c1[CN.moves] - c0[CN.moves], removeMoves(1, 1, 0, 0, rep1));
  assert.equal(walk(snapshot(), { B: 4, dims: 1 }), null);
  v.removeAt(3); o.removeAt(3);
  assert.deepEqual(leafLens(v), [2, 1]);
  c0 = counters(v);
  v.removeAt(2); o.removeAt(2);
  c1 = counters(v);
  assert.deepEqual(leafLens(v), [2]);
  assert.equal(c1[CN.merges] - c0[CN.merges], 1);
  assert.equal(c1[CN.equalizes] - c0[CN.equalizes], 0);
  assert.equal(repMoves(4, 2, 0, 0), 0);
  assert.equal(c1[CN.moves] - c0[CN.moves], 0);
  assert.equal(walk(snapshot(), { B: 4, dims: 1 }), null);
  assert.equal(v.length, o.length);
  for (let i = 0; i < o.length; i++) assert.equal(v.entityAt(i), o.entityAt(i));
});

// ---- ASSERTION 4: streams, closed forms, random inserts, bfs ----
test('A4: appendStream(16, 4, 1e4): splits 768, moves 2304, fingerHits 9231, fingerMisses 769 (literals and spec-counts)', () => {
  const N = 10000;
  const v = new SumSequence(N, { leafSize: 16 });
  for (let j = 0; j < N; j++) v.insertAt(v.length, j & 0x3FFFFFFF, 1);
  const c = counters(v);
  const f = appendStream(16, 4, N, new Int32Array(5));
  assert.equal(f[0], 768);
  assert.equal(f[3], 2304);
  assert.equal(c[CN.splits], 768);
  assert.equal(c[CN.moves], 2304);
  // C-34 / PLAN-E0-F ASSERTION 1 literals: a miss is the first insert (NIL) plus each of the 768 splits (a full leaf
  // is a miss, C-4), so misses = 1 + 768 = 769 and hits = 1e4 - 769 = 9231.
  assert.equal(c[CN.fingerHits], 9231);
  assert.equal(c[CN.fingerMisses], 769);
  assert.equal(c[CN.splits], f[0]);
  assert.equal(c[CN.moves], f[3]);
  assert.equal(v.length, N);
});

test('A4: prependStream(16, 4, 200): moves 1960, splits 15, fingerHits 184 (literals and spec-counts)', () => {
  const N = 200;
  const v = new SumSequence(N, { leafSize: 16 });
  for (let j = 0; j < N; j++) v.insertAt(0, j & 0x3FFFFFFF, 1);
  const c = counters(v);
  const f = prependStream(16, 4, N, new Int32Array(5));
  assert.equal(f[0], 15);
  assert.equal(f[3], 1960);
  assert.equal(c[CN.splits], 15);
  assert.equal(c[CN.moves], 1960);
  // C-4: insert at 0 hits while the finger leaf (fb 0) has len < B. Misses = the first insert (NIL) + 15 splits = 16,
  // hits = 200 - 16 = 184 (PLAN-E0-F ASSERTION 1: B=16, 200 insertAt(0): fingerHits 184).
  assert.equal(c[CN.fingerHits], 184);
  assert.equal(c[CN.fingerMisses], 16);
  assert.equal(c[CN.splits], f[0]);
  assert.equal(c[CN.moves], f[3]);
});

// C-34 constants, insert-only: three independent xorshift32 streams (op 0x9E3779B9^s, index 0x85EBCA6B^s, measure
// 0xC2B2AE35^s). The op stream gives the entity, the index stream the position, the measure stream the measure.
function xs(x) {
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}

for (const B of [4, 8]) {
  test(`A4: B=${B}, seed 1, 2000 random inserts: walker null and 0 Oracle divergences after every op; rotations fire`, () => {
    const s = 1;
    let so = (0x9E3779B9 ^ s) >>> 0;
    let si = (0x85EBCA6B ^ s) >>> 0;
    let sm = (0xC2B2AE35 ^ s) >>> 0;
    const { views, snapshot } = engineFactory(4096, { leafSize: B, dims: 1 }, 3);
    const v = views[0];
    const o = new Oracle(1);
    const opts = { B, dims: 1 };
    let last = 0;
    let div = 0;
    let checks = 0;
    for (let k = 0; k < 2000; k++) {
      so = xs(so); si = xs(si); sm = xs(sm);
      const n = o.length;
      const range = n + 1;
      const idx = (si & 1) === 1 ? Math.min(Math.max(last + ((si >>> 1) % 3) - 1, 0), range - 1) : (si >>> 1) % range;
      last = idx;
      const e = so & 0x3FFFFFFF;
      const m = ((sm >>> 16) % 20) === 0 ? 0 : sm % 1000;
      v.insertAt(idx, e, m);
      o.insertAt(idx, e, m);
      const w = walk(snapshot(), opts);
      if (w !== null) assert.fail('walker op ' + k + ': ' + JSON.stringify(w));
      let bad = v.length !== o.length || v.total(0) !== o.total(0);
      for (let i = 0; i < o.length && !bad; i++) {
        const sb = o.sumBefore(0, i);
        bad = v.entityAt(i) !== o.entityAt(i) || v.sumBefore(0, i) !== sb || v.indexAtSum(0, sb) !== o.indexAtSum(0, sb);
      }
      if (bad) div++;
      checks++;
    }
    assert.equal(checks, 2000);
    assert.equal(div, 0, 'oracle divergences');
    const c = counters(v);
    assert.ok(c[CN.splits] >= 100, 'coverage floor splits: ' + c[CN.splits]);
    assert.ok(c[CN.rotSingle] > 0, 'rotSingle ' + c[CN.rotSingle]);
    assert.ok(c[CN.rotDouble] > 0, 'rotDouble ' + c[CN.rotDouble]);
  });
}

for (const [B, nMax] of [[4, 6], [8, 10]]) {
  // A4 is the insert-side lane: 'append' is only ever applied as the second half of the splitAt pair in bfsLane
  // (exhaustive.mjs exDropped), so the pair drops with 'splitAt'; drop ['removeAt', 'splitAt'] leaves insertAt only.
  // The row's intent is "insertAt only" (A5 runs removeAt and splitAt for real, S-R2 / S-R3 landed), so it stays.
  test(`A4: bfsLane(engine adapter, B=${B}, nMax=${nMax}, drop removeAt + splitAt) ok, 0 divergences`, () => {
    const rep = bfsLane(engineFactory, { B, nMax, drop: ['removeAt', 'splitAt'] });
    assert.equal(rep.ok, true, JSON.stringify(rep.first));
    assert.equal(rep.divergences, 0);
    assert.ok(rep.applied > 0);
    const seen = new Set(rep.states.map((st) => st.n));
    for (let n = 0; n <= nMax; n++) assert.ok(seen.has(n), 'n ' + n + ' seen');
  });
}

// ---- B2: interior split rows and the T-5 boundary at B=16 (C-18, Table 3 0001:147, T-5) ----
function leafLens(v) { // in-order leaf lengths by a tree walk
  const out = [];
  const st = [v._root];
  while (st.length > 0) {
    const r = st.pop();
    if (r < 0) out.push(v._llen[~r]); else st.push(v._right[r], v._left[r]);
  }
  return out;
}

function sixteen() { // 17 appends -> 13 | 4, then 3 prepends into the 13 leaf -> 16 | 4
  const v = new SumSequence(64, { leafSize: 16 });
  for (let j = 0; j < 17; j++) v.insertAt(j, j, 1);
  for (let j = 0; j < 3; j++) v.insertAt(0, 100 + j, 1);
  return v;
}

for (const [p, lens] of [[1, [9, 8, 4]], [8, [9, 8, 4]], [9, [8, 9, 4]]]) {
  test(`B2: B=16, leaves 16|4, insertAt(${p}) splits the full leaf to ${lens.join('|')}; moves = insertMoves(16, 4, 16, ${p}, 0)`, () => {
    const v = sixteen();
    assert.deepEqual(leafLens(v), [16, 4]);
    const m0 = counters(v)[CN.moves];
    const s0 = counters(v)[CN.splits];
    v.insertAt(p, 77, 1);
    assert.deepEqual(leafLens(v), lens);
    assert.equal(counters(v)[CN.splits] - s0, 1);
    // C-18 interior: p <= B/2 -> B-p (15, 8); p > B/2 -> B/2 (8)
    const want = insertMoves(16, 4, 16, p, 0);
    assert.equal(want, p === 1 ? 15 : 8);
    assert.equal(counters(v)[CN.moves] - m0, want);
  });
}

test('B2: T-5 boundary: 13 | 4 after 17 appends, insertAt(13) goes LEFT (k <= count[left]): lens [14, 4], moves +0, no split', () => {
  const v = new SumSequence(64, { leafSize: 16 });
  for (let j = 0; j < 17; j++) v.insertAt(j, j, 1);
  assert.deepEqual(leafLens(v), [13, 4]);
  const c0 = counters(v);
  v.insertAt(13, 77, 1);
  assert.deepEqual(leafLens(v), [14, 4]);
  assert.equal(counters(v)[CN.moves] - c0[CN.moves], 0); // s - p = 13 - 13
  assert.equal(counters(v)[CN.splits] - c0[CN.splits], 0);
});

// ---- B1: per-op touches / pulls lane on multi-leaf views (C-20, C-25) ----
// Own descent over _left / _right / _count / _llen: depth D, the landing leaf length and position. The insert rule
// is k <= count[left] (T-5), every other op the element rule k < count[left].
function descend(v, i, insertRule) {
  let r = v._root;
  if (r === 0x3FFFFFFF) return { d: 0, len: 0 }; // empty view: first-leaf creation, no descent
  let q = i;
  let d = 0;
  while (r >= 0) {
    d++;
    const l = v._left[r];
    const c = l < 0 ? v._llen[~l] : v._count[l];
    if (insertRule ? q <= c : q < c) r = l; else { q -= c; r = v._right[r]; }
  }
  return { d, len: v._llen[~r] };
}

// In-order leaves of a view (own walk over _left / _right / _llen): ref, length, side (0 = left child, 1 = right
// child, -1 = root leaf), depth and the ancestor internal ids.
function leavesOf(v) {
  const out = [];
  if (v._root === EMPTY_ROOT) return out;
  const st = [[v._root, -1, 0, []]];
  while (st.length > 0) {
    const [r, side, d, anc] = st.pop();
    if (r < 0) out.push({ ref: r, len: v._llen[~r], side, depth: d, anc });
    else {
      const a2 = anc.concat([r]);
      st.push([v._right[r], 1, d + 1, a2]);
      st.push([v._left[r], 0, d + 1, a2]);
    }
  }
  return out;
}

// The expected result of removeAt(i) from the PRE-op tree and the spec formulas only (C-18, T-6 neighbour v = the
// in-order leaf on u's sibling side, C-20, C-25). Returns { under, merge, moves, uni }.
function removePlan(v, i, B) {
  const m = B >> 2;
  const L = leavesOf(v);
  let li = 0;
  let q = i;
  while (q >= L[li].len) { q -= L[li].len; li++; }
  const len = L[li].len;
  const only = L.length === 1;
  if (only || len > m) return { under: false, merge: false, moves: removeMoves(m, len, q, only ? 1 : 0, 0), uni: 0, d: L[li].depth };
  const uLeft = L[li].side === 0;
  const vi = uLeft ? li + 1 : li - 1;
  const sv = L[vi].len;
  const sL = uLeft ? m - 1 : sv;
  const sR = uLeft ? sv : m - 1;
  const t = sL + sR;
  const rep = repMoves(B, sL, sR, uLeft ? 1 : 0);
  return {
    under: true, merge: 2 * t <= B, moves: removeMoves(m, len, q, 0, rep), d: L[li].depth, dv: L[vi].depth,
    uni: new Set(L[li].anc.concat(L[vi].anc)).size,
  };
}

// One mixed C-34 xorshift stream (separate op / index / measure states).
// Returns { bad, splits, merges, equalizes, ops }.
function touchLane(Seq, B, nOps) {
  const m = B >> 2;
  const v = new Seq(4096, { leafSize: B });
  const K = Seq.COUNTERS;
  let so = (0x9E3779B9 ^ 1) >>> 0;
  let si = (0x85EBCA6B ^ 1) >>> 0;
  let sm = (0xC2B2AE35 ^ 1) >>> 0;
  const c0 = new Int32Array(12);
  const c1 = new Int32Array(12);
  const Lmax = v._ar.Lmax;
  let bad = null;
  let ops = 0;
  let nHits = 0;
  let nMiss = 0;
  // B=16 never merges on the random stream: a deterministic prologue (17 appends -> 13|4,
  // removeAt(16) = equalize 8|8, 4 x removeAt(0) and 4 x removeAt(last) -> 4|4, removeAt(0) = merge: t = 3 + 4 <= B/2) runs under the same per-op asserts.
  const pro = [];
  if (B === 16) {
    for (let j = 0; j < 17; j++) pro.push([0, j]);
    pro.push([1, 16]); // equalize 13|3 -> 8|8 (C-22)
    for (let j = 0; j < 4; j++) pro.push([1, 0]); // 8|8 -> 4|8
    for (let j = 0; j < 4; j++) pro.push([1, -1]); // last element: 4|8 -> 4|4
    pro.push([1, 0]); // 4|4: removeAt(0) merges
  }
  for (let k = -pro.length; k < nOps && bad === null; k++) {
    so = xs(so); si = xs(si); sm = xs(sm);
    const n = v.length;
    const r = so % 100;
    let kind = r < 55 || n < 2 ? 0 : r < 75 ? 1 : r < 85 ? 2 : r < 93 ? 3 : 4;
    let i = kind === 0 ? (si >>> 1) % (n + 1) : (si >>> 1) % n;
    if (k < 0) { kind = pro[k + pro.length][0]; i = pro[k + pro.length][1]; if (i < 0) i = n - 1; }
    const D = descend(v, i, kind === 0);
    const plan = kind === 1 ? removePlan(v, i, B) : null;
    // C-4 hit model from the PRE-op finger (fl NIL = 0 -> miss), the finger leaf's position / length in the pre-op
    // leaf list, and B / m; written from the rule, not read from the engine's hit decision.
    let hit = false;
    let fdep = 0;
    if (v._fl !== 0) {
      const PL = leavesOf(v);
      let fb = 0;
      let fi = 0;
      while (fi < PL.length && PL[fi].ref !== v._fl) { fb += PL[fi].len; fi++; }
      const len = PL[fi].len;
      fdep = PL[fi].depth;
      if (kind === 0) hit = fb - ((fb - 1) >>> 31) < i && i <= fb + len && len < B; // lo = fb - ((fb-1)>>>31)
      else if (kind === 1) hit = fb <= i && i < fb + len && len > (PL.length === 1 ? 1 : m);
      else hit = fb <= i && i < fb + len;
    }
    v.readCounters(c0);
    if (kind === 0) v.insertAt(i, k & 0x3FFFFFFF, sm % 50);
    else if (kind === 1) v.removeAt(i);
    else if (kind === 2) v.setMeasure(i, 0, sm % 50);
    else if (kind === 3) v.getMeasure(i, 0);
    else v.entityAt(i);
    v.readCounters(c1);
    ops++;
    const dt = c1[K.touches] - c0[K.touches];
    const dp = c1[K.pulls] - c0[K.pulls];
    const split = kind === 0 && c1[K.splits] - c0[K.splits] === 1;
    let ok;
    const dh = c1[K.fingerHits] - c0[K.fingerHits];
    const dm = c1[K.fingerMisses] - c0[K.fingerMisses];
    if (hit) nHits++; else nMiss++;
    if (dh !== (hit ? 1 : 0) || dm !== (hit ? 0 : 1)) { // C-26: exactly one of the two counters moves by 1
      bad = { k, kind, dh, dm, hit };
      break;
    }
    if (hit) {
      // C-25: a hit adds 0 touches; C-20: a mutation still pulls _fdepth (the finger leaf's depth), a read pulls 0.
      ok = dt === 0 && dp === (kind <= 2 ? pullsHot(fdep) : 0) && c1[K.splits] === c0[K.splits] &&
        c1[K.merges] === c0[K.merges] && c1[K.equalizes] === c0[K.equalizes] &&
        (kind !== 1 || c1[K.moves] - c0[K.moves] === plan.moves);
    } else if (plan !== null && plan.under) {
      // A-R3: remove that underflows. exactly one of merges / equalizes +1; moves == removeMoves incl. repMoves;
      // touches == d(v) + d'(t') (C-25): d(v) = depth of the neighbour leaf v (main descent d(u) + the walk from
      // sibling(u), read from the PRE-op tree), d' = the re-home descent at min(i, n-1) in the post-op tree.
      const D2 = descend(v, Math.min(i, v.length - 1), false);
      const dM = c1[K.merges] - c0[K.merges];
      const dE = c1[K.equalizes] - c0[K.equalizes];
      ok = dM + dE === 1 && dM === (plan.merge ? 1 : 0) && dt === touchesExact(TOUCH_REMOVE_UNDERFLOW, plan.dv, D2.d) &&
        c1[K.moves] - c0[K.moves] === plan.moves && dp <= 4 * (H(Lmax) + 1) &&
        (plan.merge ? (D.d < 2 || dp >= 1) : dp === plan.uni);
    } else if (split) {
      const D2 = descend(v, i, false); // element-rule depth in the post-op state
      ok = dt === D.d + D2.d && dp >= 1 && dp <= 4 * (H(Lmax) + 1);
    } else if (kind === 1) {
      ok = dt === D.d && dp === pullsHot(D.d) && c1[K.moves] - c0[K.moves] === plan.moves &&
        c1[K.merges] === c0[K.merges] && c1[K.equalizes] === c0[K.equalizes];
    } else if (kind <= 2) {
      ok = dt === D.d && dp === pullsHot(D.d);
    } else {
      ok = dt === D.d && dp === 0;
    }
    if (!ok) bad = { k, kind, dt, dp, D: D.d, split, plan };
  }
  return { bad, splits: v._n[K.splits], merges: v._n[K.merges], equalizes: v._n[K.equalizes], ops, nHits, nMiss };
}

for (const B of [4, 8, 16]) {
  test(`B1: B=${B} 4000-op mixed stream: touches = D on a miss (D + D2 on a split / underflow), 0 on a hit (C-4 / C-25); pulls = depth (split <= 4(H+1); equalize |anc(u) U anc(v)|), 0 for reads`, () => {
    const r = touchLane(SumSequence, B, 4000);
    assert.equal(r.bad, null, JSON.stringify(r.bad));
    assert.ok(r.splits >= 100, 'coverage floor splits: ' + r.splits);
    assert.ok(r.merges >= 1, 'coverage floor merges: ' + r.merges);
    assert.ok(r.equalizes >= 1, 'coverage floor equalizes: ' + r.equalizes);
    assert.ok(r.ops > 3500, 'ops ' + r.ops);
    assert.ok(r.nHits >= 30, 'coverage floor hits (tripwire; random indexes hit rarely at small B): ' + r.nHits);
    assert.ok(r.nMiss >= 100, 'coverage floor misses: ' + r.nMiss);
    assert.equal(r.nHits + r.nMiss, r.ops, 'C-26: each positional op is one hit or one miss');
  });
}

// ---- B3: forged pool exhaustion fails closed (C-3, C-15, R-P2 / 0005 A6-4) ----
// R-P2: the pool throw leaves every field byte-identical EXCEPT the finger, which is invalidated before the throw:
// _fl NIL (0), _fb 0, _fdepth 0 (_fpath is not asserted beyond its length).
function fullState(v) { // everything except the finger
  return JSON.stringify([v._root, v._len, Array.from(v._hdr),
    Array.from(v._llen), Array.from(v._ent), Array.from(v._meas[0]), Array.from(v._lsum[0]), Array.from(v._left),
    Array.from(v._right), Array.from(v._weight), Array.from(v._count), Array.from(v._sums[0]), Array.from(v._n)]);
}

for (const [pool, sIx, bIx] of [['leaf', 2, 1], ['internal', 4, 3]]) {
  test(`B3: B=4 depth 0, ${pool} pool forged exhausted: insertAt(2) throws RangeError /pool/, state identical but the finger NIL / 0 / 0; restore and it succeeds`, () => {
    const v = new SumSequence(16, { leafSize: 4 });
    for (let j = 0; j < 4; j++) v.insertAt(j, j, 1);
    assert.notEqual(v._fl, 0, 'finger set before the throw');
    const saved = Array.from(v._hdr);
    v._hdr[sIx] = -1; // free list empty
    v._hdr[bIx] = pool === 'leaf' ? v._ar.Lmax : v._ar.Lmax - 1; // bump at the pool size
    const before = fullState(v);
    const plen = v._fpath.length;
    assert.throws(() => v.insertAt(2, 77, 1), (e) => e instanceof RangeError && /pool/.test(e.message));
    assert.equal(fullState(v), before);
    assert.equal(v._fl, 0, 'fl NIL');
    assert.equal(v._fb, 0);
    assert.equal(v._fdepth, 0);
    assert.equal(v._fpath.length, plen);
    for (let q = 0; q < 5; q++) v._hdr[q] = saved[q];
    v.insertAt(2, 77, 1);
    assert.equal(v.length, 5);
  });
}

// Depth >= 1: B=4, 5 appends -> 4 | 1 (a full left leaf). getMeasure(4) homes the finger on the RIGHT leaf; an insert
// into the full left leaf then needs a fresh leaf (and a fresh internal node) and finds the forged pool empty.
function forgedDeep(pool, sIx, bIx) {
  const { views, snapshot } = engineFactory(16, { leafSize: 4, dims: 1 }, 1);
  const v = views[0];
  for (let j = 0; j < 5; j++) v.insertAt(j, j, 1);
  v.getMeasure(4, 0);
  const saved = Array.from(v._hdr);
  const f0 = [v._fl, v._fb, v._fdepth];
  v._hdr[sIx] = -1;
  v._hdr[bIx] = pool === 'leaf' ? v._ar.Lmax : v._ar.Lmax - 1;
  const before = fullState(v);
  const plen = v._fpath.length;
  const threw = (() => { try { v.insertAt(2, 77, 1); } catch (e) { return e; } return null; })();
  return { v, snapshot, saved, f0, before, plen, threw };
}

for (const [pool, sIx, bIx] of [['leaf', 2, 1], ['internal', 4, 3]]) {
  test(`B3: B=4 depth 1 (4|1), finger on the other leaf, ${pool} pool forged exhausted: RangeError /pool/, finger NIL / 0 / 0, tree / pools / counters identical, walker null, next op a miss`, () => {
    const r = forgedDeep(pool, sIx, bIx);
    const v = r.v;
    assert.notEqual(r.f0[0], 0, 'finger was homed');
    assert.ok(r.f0[2] >= 1, 'finger depth >= 1');
    assert.ok(r.threw instanceof RangeError && /pool/.test(r.threw.message), 'RangeError pool');
    assert.equal(fullState(v), r.before);
    assert.equal(v._fl, 0, 'fl NIL');
    assert.equal(v._fb, 0);
    assert.equal(v._fdepth, 0);
    assert.equal(v._fpath.length, r.plen);
    for (let q = 0; q < 5; q++) v._hdr[q] = r.saved[q];
    assert.equal(walk(r.snapshot(), { B: 4, dims: 1 }), null);
    const c0 = counters(v);
    v.getMeasure(0, 0);
    const c1 = counters(v);
    assert.equal(c1[CN.fingerMisses] - c0[CN.fingerMisses], 1, 'next positional op is a miss');
    assert.equal(c1[CN.fingerHits] - c0[CN.fingerHits], 0);
    assert.equal(walk(r.snapshot(), { B: 4, dims: 1 }), null);
  });
}

// ---- ASSERTION 5 (A-R3): remove side lanes, coverage ----
// S-R2 / S-R3 landed: splitAt and append (its second half, exhaustive.mjs exDropped) run for real, nothing is dropped.
const LANES = { 4: { nMax: 6, nLo: 8, nHi: 48 }, 8: { nMax: 10, nLo: 16, nHi: 96 } };
for (const B of [4, 8]) {
  test(`A5: B=${B} bfsLane (nMax ${LANES[B].nMax}) + deepLane (4000 ops) no drop: ok, 0 divergences, maxLeaves >= 11, coverage`, () => {
    const bfs = bfsLane(engineFactory, { B, nMax: LANES[B].nMax });
    assert.equal(bfs.ok, true, JSON.stringify(bfs.first));
    assert.equal(bfs.divergences, 0);
    const deep = deepLane(engineFactory, { B, ops: 4000, seed: 1, nLo: LANES[B].nLo, nHi: LANES[B].nHi });
    assert.equal(deep.ok, true, JSON.stringify(deep.first));
    assert.equal(deep.divergences, 0);
    assert.ok(deep.maxLeaves >= 11, 'maxLeaves ' + deep.maxLeaves);
    const miss = coverageMissing(mergeTally(bfs.tally, deep.tally), B);
    assert.deepEqual(miss, []); // C-31: every cell at the fixed CAPS size, B = 4 and B = 8
  });
}

// ---- C-22 edge hysteresis: B=16 (m=4), 17 appends -> 13 | 4; ONE remove on the m side underflows ----
test('C-22: B=16, 17 appends (13|4), removeAt(16): equalizes +1, moves +8, leaves 8|8; prepend side 4|13: moves +13', () => {
  const B = 16;
  const m = 4;
  const a = new SumSequence(64, { leafSize: B });
  for (let j = 0; j < 17; j++) a.insertAt(j, j, 1);
  assert.deepEqual(leafLens(a), [13, 4]);
  let c0 = counters(a);
  a.removeAt(16);
  let c1 = counters(a);
  // literal: base m-1-p = 4-1-3 = 0, rep = ceil(16/2) = 8 (sL 13, sR 3, uLeft false, t = 16 > B/2)
  assert.equal(c1[CN.equalizes] - c0[CN.equalizes], 1);
  assert.equal(c1[CN.merges] - c0[CN.merges], 0);
  assert.equal(c1[CN.moves] - c0[CN.moves], 8);
  assert.equal(c1[CN.moves] - c0[CN.moves], removeMoves(m, 4, 3, 0, repMoves(B, 13, 3, 0)));
  assert.deepEqual(leafLens(a), [8, 8]);
  assert.equal(a.length, 16);
  const b = new SumSequence(64, { leafSize: B });
  for (let j = 0; j < 17; j++) b.insertAt(0, j, 1);
  assert.deepEqual(leafLens(b), [4, 13]);
  c0 = counters(b);
  b.removeAt(3); // the last element of the m-side (first) leaf: p = 3
  c1 = counters(b);
  // literal: base 0, rep = sR = 13 (sL 3, sR 13, uLeft true, t = 16 > B/2 -> equalize, uLeft ? sR)
  assert.equal(c1[CN.equalizes] - c0[CN.equalizes], 1);
  assert.equal(c1[CN.moves] - c0[CN.moves], 13);
  assert.equal(c1[CN.moves] - c0[CN.moves], removeMoves(m, 4, 3, 0, repMoves(B, 3, 13, 1)));
  assert.deepEqual(leafLens(b), [8, 8]);
});

// ---- delete-side gamma: mixed 50/50 xorshift stream against the Oracle (C-34 constants, s = 1) ----
for (const B of [4, 8]) {
  test(`A5: B=${B} 4000 mixed ops insert / remove 50/50: walker null + 0 Oracle divergences after every op; merges, equalizes, rotations during removes`, () => {
    let so = (0x9E3779B9 ^ 1) >>> 0;
    let si = (0x85EBCA6B ^ 1) >>> 0;
    let sm = (0xC2B2AE35 ^ 1) >>> 0;
    const { views, snapshot } = engineFactory(4096, { leafSize: B, dims: 1 }, 3);
    const v = views[0];
    const o = new Oracle(1);
    const opts = { B, dims: 1 };
    const c0 = new Int32Array(12);
    let rotRem = 0;
    let removes = 0;
    let div = 0;
    for (let k = 0; k < 4000; k++) {
      so = xs(so); si = xs(si); sm = xs(sm);
      const n = o.length;
      const ins = n === 0 || (so >>> 8) % 2 === 0;
      const idx = (si >>> 1) % (ins ? n + 1 : n);
      v.readCounters(c0);
      if (ins) {
        const m = ((sm >>> 16) % 20) === 0 ? 0 : sm % 1000;
        v.insertAt(idx, so & 0x3FFFFFFF, m);
        o.insertAt(idx, so & 0x3FFFFFFF, m);
      } else {
        v.removeAt(idx);
        o.removeAt(idx);
        removes++;
        const c1 = counters(v);
        rotRem += c1[CN.rotSingle] - c0[CN.rotSingle] + c1[CN.rotDouble] - c0[CN.rotDouble];
      }
      const w = walk(snapshot(), opts);
      if (w !== null) assert.fail('walker op ' + k + ': ' + JSON.stringify(w));
      let bad = v.length !== o.length || v.total(0) !== o.total(0);
      for (let i = 0; i < o.length && !bad; i++) {
        const sb = o.sumBefore(0, i);
        bad = v.entityAt(i) !== o.entityAt(i) || v.sumBefore(0, i) !== sb || v.indexAtSum(0, sb) !== o.indexAtSum(0, sb);
      }
      if (bad) div++;
    }
    assert.equal(div, 0, 'oracle divergences');
    const c = counters(v);
    assert.ok(removes > 1500, 'removes ' + removes);
    assert.ok(c[CN.merges] > 0, 'merges ' + c[CN.merges]);
    assert.ok(c[CN.equalizes] > 0, 'equalizes ' + c[CN.equalizes]);
    assert.ok(rotRem > 0, 'rotations during removes ' + rotRem);
  });

  test(`A5: B=${B} fill 300 then drain to 0 in a seeded random order: walker null each step, hdr deep-equals [0, 0, -1, 0, -1]`, () => {
    let si = (0x85EBCA6B ^ 1) >>> 0;
    const { views, snapshot } = engineFactory(1024, { leafSize: B, dims: 1 }, 1);
    const v = views[0];
    for (let j = 0; j < 300; j++) { si = xs(si); v.insertAt((si >>> 1) % (j + 1), j, 1); }
    assert.equal(v.length, 300);
    while (v.length > 0) {
      si = xs(si);
      v.removeAt((si >>> 1) % v.length);
      const w = walk(snapshot(), { B, dims: 1 });
      if (w !== null) assert.fail('walker at n=' + v.length + ': ' + JSON.stringify(w));
    }
    assert.deepEqual(Array.from(v._hdr), [0, 0, -1, 0, -1]);
    assert.equal(v._root, EMPTY_ROOT);
    assert.equal(v._fl, 0);
  });
}

// ---- R-Q1 (0005 A6-1, C-10, C-44): dims > 1 measures are typeof-checked inline, then staged in sx ----
// Measure domain (C-10 / 0002 M-1): integers 0 <= m <= 2^53-1, a total <= 2^53-1 (headroom). Values below are large
// non-Smi integers; totals are hand-summed.
for (const dims of [2, 3, 4]) {
  test(`R-Q1: dims ${dims}: big non-Smi measures in slots 1..${dims - 1}: total(d) and getMeasure exact, walker null`, () => {
    const { views, snapshot } = engineFactory(16, { leafSize: 4, dims }, 1);
    const v = views[0];
    const A = [5, 2 ** 40 + 1, 2 ** 45 + 3, 2 ** 50 + 7];
    const Bm = [9, 2 ** 41 + 5, 2 ** 46 + 11, 2 ** 51 + 13];
    const args = (a) => a.slice(0, dims);
    v.insertAt(0, 1, ...args(A));
    v.insertAt(1, 2, ...args(Bm));
    for (let d = 0; d < dims; d++) {
      assert.equal(v.total(d), A[d] + Bm[d], 'total ' + d); // sums stay below 2^53: exact
      assert.equal(v.getMeasure(0, d), A[d]);
      assert.equal(v.getMeasure(1, d), Bm[d]);
    }
    // the largest legal value in the last slot of an empty view: total == 2^53 - 1 exactly
    const w = engineFactory(16, { leafSize: 4, dims }, 1);
    const big = [0, 0, 0, 0];
    big[dims - 1] = 2 ** 53 - 1;
    w.views[0].insertAt(0, 3, ...args(big));
    assert.equal(w.views[0].total(dims - 1), 9007199254740991);
    assert.equal(w.views[0].getMeasure(0, dims - 1), 9007199254740991);
    assert.equal(walk(snapshot(), { B: 4, dims }), null);
    assert.equal(walk(w.snapshot(), { B: 4, dims }), null);
  });

  test(`R-Q1: dims ${dims}: a non-number ('5', null, {}) in any slot 1..${dims - 1} throws RangeError 'measure'; snapshot, counters and sx unchanged`, () => {
    const { views, snapshot } = engineFactory(16, { leafSize: 4, dims }, 1);
    const v = views[0];
    const base = [1, 2, 3, 4];
    v.insertAt(0, 1, ...base.slice(0, dims));
    v.insertAt(1, 2, ...base.slice(0, dims));
    let rows = 0;
    for (let slot = 1; slot < dims; slot++) {
      for (const bad of ['5', null, {}]) {
        const a = base.slice(0, dims);
        a[slot] = bad;
        const before = snapshot();
        const n0 = Array.from(counters(v));
        const sx0 = Array.from(v._ar.sx);
        assert.throws(() => v.insertAt(1, 9, ...a), (e) => e instanceof RangeError && /measure/.test(e.message));
        assert.deepEqual(snapshot(), before);
        assert.deepEqual(Array.from(counters(v)), n0);
        // typeof runs before sx is written: the staged slots 1..3 are as they were
        assert.deepEqual(Array.from(v._ar.sx).slice(1), sx0.slice(1));
        rows++;
      }
    }
    assert.equal(rows, 3 * (dims - 1));
  });
}

// ---- source mutants (C-46 M-8): each control proves its gate has teeth ----
// Each check runs on the real build (must pass) and on a patched temp copy (must fail).
const SRC = new URL('../Yggdrasil.js', import.meta.url).pathname;
import { buildMutant } from './mutant-build.mjs';

function seekCheck(Seq) { // hand anchors from the I-4 block above (strict rule); B = 4 so 8 elements span >= 2 leaves
  const v = new Seq(16, { leafSize: 4, dims: 2 });
  for (let i = 0; i < 8; i++) v.insertAt(i, 10 + i, M0[i], M1[i]);
  return v.indexAtSum(0, 3) === 2 && v.indexAtSum(0, 0) === 0 && v.indexAtSum(0, 10) === 6 &&
    v.indexAtSum(0, 14) === 7 && v.indexAtSum(0, 15) === 8 && v.indexAtSum(1, 0) === 1;
}

// Hand anchor for the strict INTERNAL compare (I-4): 12 appends at B = 4, measures [1, 0 x 10, 1]. Total 2.
// indexAtSum(0, 1) = 11: S_i + m_i > 1 first holds at i = 11 (S_11 = 1, m_11 = 1); indexAtSum(0, 0) = 0; (0, 2) = 12.
// 12 > B elements force >= 3 leaves; the root's left subtree holds element 0 but not element 11, so its sum is exactly
// 1 = y. Strict descent goes right and finds 11; a <= compare goes left and ends at an index < 11.
function zerosCheck(Seq) {
  const v = new Seq(16, { leafSize: 4, dims: 1 });
  for (let i = 0; i < 12; i++) v.insertAt(i, i, i === 0 || i === 11 ? 1 : 0);
  return v.indexAtSum(0, 0) === 0 && v.indexAtSum(0, 1) === 11 && v.indexAtSum(0, 2) === 12 && v.total(0) === 2;
}

// C-18 append split at B = 8 (m = 2): 9 appends -> one split (7 | 2), moves m - 1 = 1, two leaves.
function splitCheck(Seq) {
  const v = new Seq(64, { leafSize: 8, dims: 1 });
  for (let j = 0; j < 9; j++) v.insertAt(j, j, 1);
  const c = new Int32Array(12);
  v.readCounters(c);
  const sizes = [v._llen[0], v._llen[1]].sort((a, b) => a - b);
  return c[SumSequence.COUNTERS.splits] === 1 && c[SumSequence.COUNTERS.moves] === 1 && v._hdr[1] === 2 &&
    sizes[0] === 2 && sizes[1] === 7;
}

function drainCheck(Seq) { // RA-4
  const v = new Seq(8, { leafSize: 8 });
  for (let j = 0; j < 3; j++) v.insertAt(j, j, 1);
  for (let j = 0; j < 3; j++) v.removeAt(0);
  return JSON.stringify(Array.from(v._hdr)) === '[0,0,-1,0,-1]';
}

async function mutantRow(check, patches) {
  assert.equal(check(SumSequence), true, 'unmutated build passes the check');
  const m = await buildMutant(SRC, patches);
  try { return check(m.SumSequence); } finally { m.cleanup(); }
}

test('mutant: >= leaf seek is killed by the I-4 anchors', async () => {
  assert.equal(await mutantRow(seekCheck, [['if (acc + m > y) break;', 'if (acc + m >= y) break;', 1]]), false);
});

test('A4: splitCheck holds on the real build (C-18 append split 7 | 2, 1 move)', () => {
  assert.equal(splitCheck(SumSequence), true);
});
// (d) 'split writes before throwing': the pool RangeError is gated by the B3 forged-pool rows above (state identical).

test('mutant: drain without the pool reset is killed by RA-4', async () => {
  assert.equal(await mutantRow(drainCheck,
    [['if (hdr[YG_LIVE] === 0) ygReset(hdr);', 'if (hdr[YG_LIVE] === 0) { }', 1]]), false);
});

// The strict internal compare y < sum(left) -> <= (I-4): killed by the zero-run anchor on > B elements.
test('mutant: internal compare y <= acc + sl is killed by the zero-run seek anchor', async () => {
  assert.equal(await mutantRow(zerosCheck, [['if (y < acc + sl) {', 'if (y <= acc + sl) {', 1]]), false);
});
// (a) Balance: 400 appends at B=4; the deepest leaf must be within the C-23 height bound H(L) (L = leaf count,
// recounted from the tree). Without rotation appends build a right chain of depth ~L. Walker order is I-8 'height'
// before I-1, so this checks the same bound directly.
function balanceCheck(Seq) {
  const v = new Seq(400, { leafSize: 4, dims: 1 });
  for (let j = 0; j < 400; j++) v.insertAt(j, j, 1);
  let leaves = 0;
  let deep = 0;
  const st = [v._root, 0];
  while (st.length > 0) {
    const d = st.pop();
    const r = st.pop();
    if (r < 0) { leaves++; if (d > deep) deep = d; } else { st.push(v._left[r], d + 1, v._right[r], d + 1); }
  }
  return deep <= H(leaves);
}
test('mutant: no rotation is killed by the C-23 height bound over 400 appends', async () => {
  assert.equal(await mutantRow(balanceCheck,
    [['if ((3 * wl < wr) | (3 * wr < wl)) pulls += ygRotate(v, x, wl, wr);', 'if (false) pulls += ygRotate(v, x, wl, wr);', 1]]), false);
});

// (b) 8|8 append split (a = B >> 1 instead of B + 1 - m): killed by the C-18 append-split sizes / counts.
test('mutant: 8|8 append split is killed by splitCheck (7 | 2, 1 move)', async () => {
  assert.equal(await mutantRow(splitCheck,
    [['a = B + 1 - m; // append split (last leaf)', 'a = B >> 1; // append split (last leaf)', 1]]), false);
});
function streamCheck(Seq) { // appendStream(16, 4, 1e4): splits 768, moves 2304 (spec-counts, C-18)
  const v = new Seq(10000, { leafSize: 16 });
  for (let j = 0; j < 10000; j++) v.insertAt(j, j & 0x3FFFFFFF, 1);
  const c = new Int32Array(12);
  v.readCounters(c);
  return c[SumSequence.COUNTERS.splits] === 768 && c[SumSequence.COUNTERS.moves] === 2304;
}
test('mutant: 8|8 append split is killed by the appendStream counts', async () => {
  assert.equal(await mutantRow(streamCheck,
    [['a = B + 1 - m; // append split (last leaf)', 'a = B >> 1; // append split (last leaf)', 1]]), false);
});

// (c) 'pull by delta' (S[u] / sc[u] recomputed as old + delta instead of left + right): EQUIVALENT. Measures are
// integers 0 <= m <= 2^53-1 (0002 M-1, C-10) and every total stays <= MAX (M-4), so every sum is exact (M-6) and
// delta == recompute; no reachable non-integer measure exists.

// ---- touches / pulls mutants (B1 lane teeth): M7 pulls +1, M8 split touches without d', M9 hot touches 0 ----
function laneOk(Seq) {
  return touchLane(Seq, 4, 1500).bad === null && touchLane(Seq, 16, 1500).bad === null;
}
const HOT_INS = 'cn[YG_TOUCHES] = (cn[YG_TOUCHES] + (depth & (h - 1))) | 0;\n    cn[YG_PULLS] = (cn[YG_PULLS] + depth) | 0;\n    cn[YG_MISSES - h] = (cn[YG_MISSES - h] + 1) | 0;\n    cn[YG_MOVES] = (cn[YG_MOVES] + (len - k)) | 0;';
test('mutant: hot pull +1 (insertAt pulls = depth + 1) is killed by the B1 lane', async () => {
  assert.equal(await mutantRow(laneOk, [[HOT_INS,
    'cn[YG_TOUCHES] = (cn[YG_TOUCHES] + (depth & (h - 1))) | 0;\n    cn[YG_PULLS] = (cn[YG_PULLS] + (depth + 1)) | 0;\n    cn[YG_MISSES - h] = (cn[YG_MISSES - h] + 1) | 0;\n    cn[YG_MOVES] = (cn[YG_MOVES] + (len - k)) | 0;', 1]]), false);
});
test('mutant: split touches without d2 is killed by the B1 lane', async () => {
  assert.equal(await mutantRow(laneOk, [['cn[YG_TOUCHES] = (cn[YG_TOUCHES] + (depth + d2)) | 0;', 'cn[YG_TOUCHES] = (cn[YG_TOUCHES] + depth) | 0;', 1]]), false);
});
test('mutant: hot insert touches 0 is killed by the B1 lane', async () => {
  assert.equal(await mutantRow(laneOk, [[HOT_INS,
    'cn[YG_TOUCHES] = (cn[YG_TOUCHES] + 0) | 0;\n    cn[YG_PULLS] = (cn[YG_PULLS] + depth) | 0;\n    cn[YG_MISSES - h] = (cn[YG_MISSES - h] + 1) | 0;\n    cn[YG_MOVES] = (cn[YG_MOVES] + (len - k)) | 0;', 1]]), false);
});

// ---- A-R3 remove-side mutants (HA4). Every anchor lives here, one place, each must match exactly once. ----
// Each entry is the [anchor, replacement, 1] patch list for buildMutant.
const ANCHORS = {
  mergeNoFree: [['ygFreeInt(v, par); // merge frees parent(u)', '', 1]],
  repMovesPlus1: [['cn[YG_MOVES] = (cn[YG_MOVES] + (len - 1 - p + rep)) | 0;', 'cn[YG_MOVES] = (cn[YG_MOVES] + (len - 1 - p + rep + 1)) | 0;', 1]],
  rhomeFlStore: [['  v._fl = YG_NIL; // R-P2 (C-3)', '', 1]],
  gammaLeftLe: [['if ((yl < 0 ? 1 : weight[yl]) < 2 * (yr < 0 ? 1 : weight[yr])) {',
    'if ((yl < 0 ? 1 : weight[yl]) <= 2 * (yr < 0 ? 1 : weight[yr])) {', 1]],
  gammaRightLe: [['if ((yr < 0 ? 1 : weight[yr]) < 2 * (yl < 0 ? 1 : weight[yl])) {',
    'if ((yr < 0 ? 1 : weight[yr]) <= 2 * (yl < 0 ? 1 : weight[yl])) {', 1]],
  // the `typeof m1 !== 'number'` term of the ygSlots argument check replaced by `false` (the m1 typeof test dropped)
  typeofM1Dropped: [["if ((typeof m1 !== 'number') | ((dims > 2) & (typeof m2 !== 'number')) |",
    "if (false | ((dims > 2) & (typeof m2 !== 'number')) |", 1]],
};
// EQUIVALENT (no row): 'equalize that pulls weights' (an equalize changes no weight, C-20, so a weight pull writes
// the values already stored) and 're-home at i instead of min(i, n-1)' (the element-rule descent to i = length
// reaches the same last leaf, fb and path as min(i, n-1)). The drain reset anchor is the existing mutant row above.
// DEFERRED to G-B4 Witness.test W-TIE: the delta = 3 trigger `3 * lw < rw` -> `<=` survives every delete stream (only
// the rotation counts at an exact 3*lw == rw tie see it).

// Snapshot of views built by ANY build (the adapter is bound to the real module); same shape as test/adapter.mjs.
function snapOf(views) {
  const v0 = views[0];
  const ar = v0._ar;
  const hdr = v0._hdr;
  const dims = ar.dims;
  const leaf = { size: ar.Lmax, bump: hdr[1], free: hdr[2], next: v0._lnext.slice(), len: v0._llen.slice(), ent: v0._ent.slice(), meas: [] };
  const int = {
    size: ar.Lmax - 1, bump: hdr[3], free: hdr[4], next: v0._inext.slice(), left: v0._left.slice(), right: v0._right.slice(),
    weight: v0._weight.slice(), count: v0._count.slice(), sum: [],
  };
  for (let d = 0; d < dims; d++) { leaf.meas.push(v0._meas[d].slice()); int.sum.push(v0._sums[d].slice()); }
  return {
    C: ar.C, B: ar.B, dims, NIL: 0, EMPTY_ROOT, live: hdr[0], int, leaf,
    views: views.map((w) => ({ _root: w._root, _len: w._len, _fl: w._fl, _fb: w._fb, _fdepth: w._fdepth, _fpath: new Int32Array(w._fpath), _cv: w._cv })),
  };
}

function freeLen(next, head) {
  let c = 0;
  for (let f = head; f !== -1 && c < 100000; f = next[f]) c++;
  return c;
}

// Pool census after every op of a B=4 prepend-drain: live leaves == bump - free, live internals == leaves - 1.
function censusCheck(Seq) {
  const v = new Seq(128, { leafSize: 4 });
  for (let j = 0; j < 60; j++) v.insertAt(v.length, j, 1);
  for (let k = 0; k < 45; k++) {
    v.removeAt(0);
    const L = leavesOf(v).length;
    if (v._hdr[1] - freeLen(v._lnext, v._hdr[2]) !== L) return false;
    if (v._hdr[3] - freeLen(v._inext, v._hdr[4]) !== L - 1) return false;
  }
  return v._n[Seq.COUNTERS.merges] > 0;
}

function remLaneOk(Seq) {
  return touchLane(Seq, 4, 3000).bad === null && touchLane(Seq, 8, 3000).bad === null;
}

function c22Check(Seq) { // C-22 literals: 13|4 -> remove(16): 8 moves, 8|8; 4|13 -> remove(3): 13 moves
  const a = new Seq(64, { leafSize: 16 });
  for (let j = 0; j < 17; j++) a.insertAt(j, j, 1);
  a.removeAt(16);
  const b = new Seq(64, { leafSize: 16 });
  for (let j = 0; j < 17; j++) b.insertAt(0, j, 1);
  b.removeAt(3);
  const K = Seq.COUNTERS;
  const la = leavesOf(a).map((x) => x.len);
  const lb = leavesOf(b).map((x) => x.len);
  return la.join() === '8,8' && lb.join() === '8,8' &&
    a._n[K.equalizes] === 1 && b._n[K.equalizes] === 1 &&
    a._n[K.moves] - appendStream(16, 4, 17, new Int32Array(5))[3] === 8 &&
    b._n[K.moves] - prependStream(16, 4, 17, new Int32Array(5))[3] === 13;
}

function gammaCheck(Seq) { // delete-heavy seeded streams (random fill 400, drain), walker after every op (I-1, C-23)
  const opts = { B: 4, dims: 1 };
  for (const seed of [9, 19]) { // seed search at B=4: 9 kills the left compare mutant, 19 the right one
    const views = Seq.arena(1024, { leafSize: 4 }, 1);
    const v = views[0];
    let si = (0x85EBCA6B ^ seed) >>> 0;
    for (let j = 0; j < 400; j++) { si = xs(si); v.insertAt((si >>> 1) % (j + 1), j, 1); }
    while (v.length > 0) {
      si = xs(si);
      v.removeAt((si >>> 1) % v.length);
      if (walk(snapOf(views), opts) !== null) return false;
    }
  }
  return true;
}

function slotsCheck(Seq) { // R-Q1: a non-number slot throws before sx is written; valid staging is not stale
  const v = new Seq(16, { leafSize: 4, dims: 2 });
  v.insertAt(0, 1, 1, 7);
  let threw = false;
  try { v.insertAt(1, 2, 2, '5'); } catch (e) { threw = e instanceof RangeError && /measure/.test(e.message); }
  if (!threw || v.length !== 1 || v._ar.sx[1] !== 7) return false;
  v.insertAt(1, 3, 3, 9);
  return v.total(1) === 16 && v.getMeasure(1, 1) === 9;
}

function forgedFingerCheck(Seq) { // R-P2: 4|1 view, finger on the right leaf, leaf pool forged empty
  const v = new Seq(16, { leafSize: 4 });
  for (let j = 0; j < 5; j++) v.insertAt(j, j, 1);
  v.getMeasure(4, 0);
  v._hdr[2] = -1;
  v._hdr[1] = v._ar.Lmax;
  let threw = false;
  try { v.insertAt(2, 77, 1); } catch (e) { threw = e instanceof RangeError && /pool/.test(e.message); }
  return threw && v._fl === 0 && v._fb === 0 && v._fdepth === 0;
}

for (const [key, check, title] of [
  ['mergeNoFree', censusCheck, 'merge without freeing parent(u) is killed by the pool census'],
  ['repMovesPlus1', (S) => c22Check(S) && remLaneOk(S), 'rep moves off by one is killed by C-22 and the B1 moves lane'],
  ['gammaLeftLe', gammaCheck, 'ygRotate left compare < -> <= is killed by the delete-stream walker (I-1 / C-23)'],
  ['gammaRightLe', gammaCheck, 'ygRotate right compare < -> <= is killed by the delete-stream walker (I-1 / C-23)'],
  ['typeofM1Dropped', slotsCheck, 'ygSlots staging before the typeof check is killed by the R-Q1 row'],
  ['rhomeFlStore', forgedFingerCheck, 'the R-P2 _fl = NIL store deleted is killed by the forged-exhaustion finger row'],
]) {
  test('mutant: ' + title, async () => {
    assert.equal(await mutantRow(check, ANCHORS[key]), false);
  });
}
