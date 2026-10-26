// test/Core.test.mjs -- rung 2 (A-R1b) one-leaf core: ADR 0005 C-3 / C-5 (re-home, NIL), C-8 (clear keeps _n),
// C-18 (moves), C-24 (COUNTERS), C-26 (hit / miss), C-43 M-1 (every positional op a miss), C-44 (layout), I-4
// (strict seek). Expected values come from the spec formulas and from test/oracle.mjs (an independent plain-array
// model), never from engine output. PLAN-E0-A ASSERTIONS 1-3 + RA-4. ASCII only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SumSequence } from '../Yggdrasil.js';
import { bfsLane } from './exhaustive.mjs';
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

// ---- fail-closed split ----
// Until the split lands (rung 3, A-R2) a full-leaf insert is a cold RangeError that writes nothing. When rung 3
// lands this row is replaced by the split rows (it then asserts the opposite).
test('fail closed: B=4, 4 elements, insertAt throws RangeError; snapshot and _n unchanged', () => {
  const { views, snapshot } = engineFactory(16, { leafSize: 4, dims: 1 }, 1);
  const v = views[0];
  for (let j = 0; j < 4; j++) v.insertAt(j, j, 1);
  const before = snapshot();
  const n0 = Array.from(counters(v));
  assert.throws(() => v.insertAt(2, 77, 1), RangeError);
  assert.deepEqual(snapshot(), before);
  // C-3: a throwing op re-homes nothing. Counters are bumped after the loops (0003 G-5 / G-7), so a rejected op
  // adds nothing (read from PLAN-E0-A SPEC: "validate ... then descent ... counters bumped after").
  assert.deepEqual(Array.from(counters(v)), n0);
});

// ---- source mutants (C-46 M-8): each control proves its gate has teeth ----
// Each check runs on the real build (must pass) and on a patched temp copy (must fail).
const SRC = new URL('../Yggdrasil.js', import.meta.url).pathname;
import { buildMutant } from './mutant-build.mjs';

function seekCheck(Seq) { // hand anchors from the I-4 block above (strict rule)
  const v = new Seq(8, { leafSize: 8, dims: 2 });
  for (let i = 0; i < 8; i++) v.insertAt(i, 10 + i, M0[i], M1[i]);
  return v.indexAtSum(0, 3) === 2 && v.indexAtSum(0, 0) === 0 && v.indexAtSum(0, 10) === 6 &&
    v.indexAtSum(0, 14) === 7 && v.indexAtSum(0, 15) === 8 && v.indexAtSum(1, 0) === 1;
}

function splitCheck(Seq) { // snapshot unchanged by the rejected full-leaf insert
  const v = new Seq(16, { leafSize: 4 });
  for (let j = 0; j < 4; j++) v.insertAt(j, j, 1);
  const st = () => JSON.stringify([v._root, v._len, v._fl, v._fb, v._fdepth, Array.from(v._hdr),
    Array.from(v._llen), Array.from(v._ent), Array.from(v._meas[0]), Array.from(v._lsum[0]), Array.from(v._n)]);
  const before = st();
  let threw = false;
  try { v.insertAt(2, 77, 1); } catch (e) { threw = e instanceof RangeError; }
  return threw && st() === before;
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

test('mutant: split writes before throwing is killed by the fail-closed row', async () => {
  assert.equal(await mutantRow(splitCheck,
    [['if (len === ar.B) ygSplit();', 'if (len === ar.B) { llen[id] = len + 1; ygSplit(); }', 1]]), false);
});

test('mutant: drain without the pool reset is killed by RA-4', async () => {
  assert.equal(await mutantRow(drainCheck,
    [['if (hdr[YG_LIVE] === 0) ygReset(hdr);', 'if (hdr[YG_LIVE] === 0) { }', 1]]), false);
});

// Equivalent until A-R2: a root leaf has no internal node, so the internal compare is unreachable.
test('mutant: internal compare y <= acc + sl is equivalent on a root leaf (pin)', async () => {
  const m = await buildMutant(SRC, [['if (y < acc + sl) {', 'if (y <= acc + sl) {', 1]]);
  try { assert.equal(seekCheck(m.SumSequence), true, 'survives on a root leaf'); } finally { m.cleanup(); }
});
test.todo('mutant: internal compare y <= acc + sl (equivalent-until-A-R2: needs an internal node)');
