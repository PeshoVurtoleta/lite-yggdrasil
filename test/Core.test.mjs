// test/Core.test.mjs -- rung 2 (A-R1b) one-leaf core + rung 3 (A-R2, part 2: ASSERTION 4, split / rotation / seek
// mutants): ADR 0005 C-3 / C-5 (re-home, NIL), C-8 (clear keeps _n),
// C-18 (moves), C-24 (COUNTERS), C-26 (hit / miss), C-43 M-1 (every positional op a miss), C-44 (layout), I-4
// (strict seek). Expected values come from the spec formulas and from test/oracle.mjs (an independent plain-array
// model), never from engine output. PLAN-E0-A ASSERTIONS 1-3 + RA-4 (rung 2) and ASSERTION 4 (rung 3, A-R2: split,
// pull, rotations; C-18 / C-19 / C-20 / C-23 / C-25 / C-34). ASCII only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SumSequence } from '../Yggdrasil.js';
import { bfsLane } from './exhaustive.mjs';
import { appendStream, prependStream, insertMoves, H, pullsHot } from './spec-counts.mjs';
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
  test(`A1: bfsLane(engine adapter, B=${B}, nMax=${B}, drop splitAt) ok, 0 divergences, every n seen`, () => {
    const rep = bfsLane(engineFactory, { B, nMax: B, drop: ['splitAt'] });
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
  test(`A2: B=${B} one leaf: insert moves s-p, remove moves s-p (C-18); miss +1, hits / touches / pulls 0; re-home`, () => {
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
      assert.equal(c[CN.fingerMisses], 1, tag + ' insert misses');
      assert.equal(c[CN.fingerHits], 0, tag + ' insert hits');
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
      assert.equal(c[CN.fingerMisses], 1, tag + ' remove misses');
      assert.equal(c[CN.fingerHits], 0, tag + ' remove hits');
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

// ---- B1: every positional op is one miss (C-26, C-43 M-1) ----
test('B1: setMeasure / getMeasure / entityAt on a 3-element B=8 leaf: miss 1, hit 0, touches / moves / pulls 0, re-homed', () => {
  const calls = [(v) => v.setMeasure(1, 0, 2), (v) => v.getMeasure(1, 0), (v) => v.entityAt(1)];
  calls.forEach((call, ix) => {
    const v = new SumSequence(8, { leafSize: 8 });
    for (let j = 0; j < 3; j++) v.insertAt(j, j + 1, 1);
    v.resetCounters();
    call(v);
    const c = counters(v);
    assert.equal(c[CN.fingerMisses], 1, 'call ' + ix + ' misses');
    assert.equal(c[CN.fingerHits], 0, 'call ' + ix + ' hits');
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
  // 100 cycles x 8 inserts, one miss each (C-26 / C-43 M-1), nothing reset in between
  assert.equal(counters(v)[CN.fingerMisses], 100 * B);
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

// ---- A-R2: the split exists (C-18); what still fails closed is the remove underflow (A-R3) ----
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

// C-3: a throwing op re-homes nothing. Counters are bumped after the loops (0003 G-5 / G-7), so a rejected op
// adds nothing. m = B/4 = 1 at B = 4: removing the only element of a non-only leaf drops it below m (C-18 / T-6).
// This row is replaced when the A-R3 remove repair lands (the throw disappears).
test('fail closed: B=4, two leaves, a remove that underflows throws RangeError; snapshot and counters unchanged', () => {
  const { views, snapshot } = engineFactory(16, { leafSize: 4, dims: 1 }, 1);
  const v = views[0];
  for (let j = 0; j < 5; j++) v.insertAt(j, j, 1); // 5 > B: two leaves (append split 4 | 1, C-18)
  let threw = 0;
  for (let k = 0; k < 5 && v.length > 0; k++) {
    const before = snapshot();
    const n0 = Array.from(counters(v));
    try { v.removeAt(v.length - 1); } catch (e) {
      assert.ok(e instanceof RangeError);
      assert.deepEqual(snapshot(), before);
      assert.deepEqual(Array.from(counters(v)), n0);
      threw++;
      break;
    }
  }
  assert.equal(threw, 1, 'the underflowing remove threw');
});

// ---- ASSERTION 4: streams, closed forms, random inserts, bfs ----
test('A4: appendStream(16, 4, 1e4): splits 768, moves 2304, fingerMisses 1e4 (literals and spec-counts)', () => {
  const N = 10000;
  const v = new SumSequence(N, { leafSize: 16 });
  for (let j = 0; j < N; j++) v.insertAt(v.length, j & 0x3FFFFFFF, 1);
  const c = counters(v);
  const f = appendStream(16, 4, N, new Int32Array(5));
  assert.equal(f[0], 768);
  assert.equal(f[3], 2304);
  assert.equal(c[CN.splits], 768);
  assert.equal(c[CN.moves], 2304);
  assert.equal(c[CN.fingerMisses], N);
  assert.equal(c[CN.splits], f[0]);
  assert.equal(c[CN.moves], f[3]);
  assert.equal(v.length, N);
});

test('A4: prependStream(16, 4, 200): moves 1960, splits 15 (literals and spec-counts)', () => {
  const N = 200;
  const v = new SumSequence(N, { leafSize: 16 });
  for (let j = 0; j < N; j++) v.insertAt(0, j & 0x3FFFFFFF, 1);
  const c = counters(v);
  const f = prependStream(16, 4, N, new Int32Array(5));
  assert.equal(f[0], 15);
  assert.equal(f[3], 1960);
  assert.equal(c[CN.splits], 15);
  assert.equal(c[CN.moves], 1960);
  assert.equal(c[CN.fingerMisses], N); // the core never reads the finger: every op a miss (C-43 M-1)
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
  // 'append' is only ever applied as the second half of the splitAt pair in bfsLane, and the pair drops with
  // 'splitAt' (exhaustive.mjs exDropped), so drop ['removeAt', 'splitAt'] leaves insertAt only.
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

// One mixed C-34 xorshift stream (separate op / index / measure states). Returns { bad, splits, ops }.
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
  for (let k = 0; k < nOps && bad === null; k++) {
    so = xs(so); si = xs(si); sm = xs(sm);
    const n = v.length;
    const r = so % 100;
    let kind = r < 55 || n < 2 ? 0 : r < 75 ? 1 : r < 85 ? 2 : r < 93 ? 3 : 4;
    const i = kind === 0 ? (si >>> 1) % (n + 1) : (si >>> 1) % n;
    const D = descend(v, i, kind === 0);
    if (kind === 1 && v._root >= 0 && D.len <= m) continue; // A-R2: an underflowing remove throws, skip it
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
    if (split) {
      const D2 = descend(v, i, false); // element-rule depth in the post-op state
      ok = dt === D.d + D2.d && dp >= 1 && dp <= 4 * (H(Lmax) + 1);
    } else if (kind <= 2) {
      ok = dt === D.d && dp === pullsHot(D.d);
    } else {
      ok = dt === D.d && dp === 0;
    }
    if (!ok) bad = { k, kind, dt, dp, D: D.d, split };
  }
  return { bad, splits: v._n[K.splits], ops };
}

for (const B of [4, 8, 16]) {
  test(`B1: B=${B} 4000-op mixed stream: touches = D (D + D2 on a split), pulls = depth (<= 4(H+1) on a split), 0 for reads`, () => {
    const r = touchLane(SumSequence, B, 4000);
    assert.equal(r.bad, null, JSON.stringify(r.bad));
    assert.ok(r.splits >= 100, 'coverage floor splits: ' + r.splits);
    assert.ok(r.ops > 3000, 'ops ' + r.ops);
  });
}

// ---- B3: forged pool exhaustion at depth 0 fails closed with a byte-identical state (C-3, C-15) ----
function fullState(v) {
  return JSON.stringify([v._root, v._len, v._fl, v._fb, v._fdepth, Array.from(v._fpath), Array.from(v._hdr),
    Array.from(v._llen), Array.from(v._ent), Array.from(v._meas[0]), Array.from(v._lsum[0]), Array.from(v._left),
    Array.from(v._right), Array.from(v._weight), Array.from(v._count), Array.from(v._sums[0]), Array.from(v._n)]);
}

for (const [pool, sIx, bIx] of [['leaf', 2, 1], ['internal', 4, 3]]) {
  test(`B3: B=4 depth 0, ${pool} pool forged exhausted: insertAt(2) throws RangeError /pool/, state identical; restore and it succeeds`, () => {
    const v = new SumSequence(16, { leafSize: 4 });
    for (let j = 0; j < 4; j++) v.insertAt(j, j, 1);
    const saved = Array.from(v._hdr);
    v._hdr[sIx] = -1; // free list empty
    v._hdr[bIx] = pool === 'leaf' ? v._ar.Lmax : v._ar.Lmax - 1; // bump at the pool size
    const before = fullState(v);
    assert.throws(() => v.insertAt(2, 77, 1), (e) => e instanceof RangeError && /pool/.test(e.message));
    assert.equal(fullState(v), before);
    for (let q = 0; q < 5; q++) v._hdr[q] = saved[q];
    v.insertAt(2, 77, 1);
    assert.equal(v.length, 5);
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
const HOT_INS = 'cn[YG_TOUCHES] += depth;\n    cn[YG_PULLS] += depth;\n    cn[YG_MISSES] += 1;\n    cn[YG_MOVES] += len - k;';
test('mutant: hot pull +1 (insertAt pulls = depth + 1) is killed by the B1 lane', async () => {
  assert.equal(await mutantRow(laneOk, [[HOT_INS,
    'cn[YG_TOUCHES] += depth;\n    cn[YG_PULLS] += depth + 1;\n    cn[YG_MISSES] += 1;\n    cn[YG_MOVES] += len - k;', 1]]), false);
});
test('mutant: split touches without d2 is killed by the B1 lane', async () => {
  assert.equal(await mutantRow(laneOk, [['cn[YG_TOUCHES] += depth + d2;', 'cn[YG_TOUCHES] += depth;', 1]]), false);
});
test('mutant: hot insert touches 0 is killed by the B1 lane', async () => {
  assert.equal(await mutantRow(laneOk, [[HOT_INS,
    'cn[YG_TOUCHES] += 0;\n    cn[YG_PULLS] += depth;\n    cn[YG_MISSES] += 1;\n    cn[YG_MOVES] += len - k;', 1]]), false);
});
