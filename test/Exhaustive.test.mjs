// test/Exhaustive.test.mjs -- gates for test/stubs.mjs + test/exhaustive.mjs
// (HB4 ASSERTIONS A1..A5 as amended by ADDENDUM R1; ADR 0005 C-26, C-27, C-31,
// C-32, C-33, C-41 ASSERTIONS 4 / 6).
//
// Written blind from the plan, never from the stubs / lanes' output. Hand-derived
// numbers carry their source in a comment. Every control is asserted as a POSITIVE
// expectation (the gate it targets must FAIL). ASCII-only.
//
// 1e4 appends at B=16 (hits 9231, misses 769, splits 768) and 200 prepends
// (moves 1960, splits 15, hits 184) are the C-33 / C-34 / C-30 spec rows.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  synthStub, flatStub, seekStub, staleFingerStub, nolandStub, countStub, homeStub, COUNTERS,
} from './stubs.mjs';
import {
  bfsLane, sweepLane, deepLane, CELLS, coverageMissing, assertCoverage, mergeTally,
  CODES, ENGINE, CAPS,
} from './exhaustive.mjs';

const HERE = (p) => fileURLToPath(new URL(p, import.meta.url));

// ---------------------------------------------------------------- shared runs
// Memoised so A1 / A3 / A5 reuse one run per (lane, B); deterministic.
const memo = new Map();
function once(key, fn) {
  if (!memo.has(key)) memo.set(key, fn());
  return memo.get(key);
}
const bfs = (B) => once('bfs' + B, () => bfsLane(synthStub, { B, nMax: CAPS.nMax[B] }));
const sweep = (B) => once('sweep' + B, () =>
  sweepLane(synthStub, { B, states: bfs(B).states, nSweep: CAPS.nSweep[B] }));
const deep = (B) => once('deep' + B, () => deepLane(synthStub, {
  B, ops: CAPS.deepOps, seed: 1, nLo: CAPS.deepN[B][0], nHi: CAPS.deepN[B][1],
}));
const small4 = () => once('small4', () => bfsLane(synthStub, { B: 4, nMax: 6 }));

// ------------------------------------------------------------------ A1 synth

for (const B of [4, 8]) {
  test(`A1 (C-31) synthStub BFS passes at B=${B}, covers every n <= nMax`, () => {
    const r = bfs(B);
    assert.equal(r.ok, true);
    assert.equal(r.first, null);
    assert.ok(r.applied > 0);
    assert.equal(r.divergences, 0);
    const seen = new Set(r.states.map((s) => s.n));
    for (let n = 0; n <= CAPS.nMax[B]; n++) assert.ok(seen.has(n), 'state size ' + n);
    for (const s of r.states) assert.ok(Array.isArray(s.witness) && s.n <= CAPS.nMax[B]);
  });

  test(`A1 (C-31) synthStub sweep passes at B=${B}`, () => {
    const r = sweep(B);
    assert.equal(r.ok, true);
    assert.equal(r.first, null);
    assert.ok(r.applied > 0);
  });

  test(`A1 (C-32) synthStub deep lane passes at B=${B}, reaches >= 11 leaves`, () => {
    const r = deep(B);
    assert.equal(r.ok, true);
    assert.equal(r.first, null);
    assert.ok(r.applied > 0);
    assert.ok(r.maxLeaves >= 11, 'maxLeaves ' + r.maxLeaves);
  });
}

test('A1 (C-27) BFS B=4 also passes with NIL = 0x40000000', () => {
  const r = bfsLane(synthStub, { B: 4, nMax: CAPS.nMax[4], cfg: { NIL: 0x40000000 } });
  assert.equal(r.ok, true);
  assert.equal(r.first, null);
});

function counterRow(f, B, C, n, at) {
  const { views } = f(C, { leafSize: B, dims: 1 }, 1);
  const v = views[0];
  for (let k = 0; k < n; k++) v.insertAt(at(k), k % 1000, 1);
  return { n: v._n, len: v.length };
}

test('A1 (C-34) 1e4 appends at B=16 give splits 768, hits 9231, misses 769', () => {
  const { n, len } = counterRow(synthStub, 16, 1e4, 1e4, (k) => k);
  assert.equal(len, 1e4);
  assert.equal(n[COUNTERS.splits], 768);
  assert.equal(n[COUNTERS.fingerHits], 9231);
  assert.equal(n[COUNTERS.fingerMisses], 769);
});

test('A1 (C-30) 200 prepends give moves 1960, splits 15, hits 184', () => {
  const { n } = counterRow(synthStub, 16, 200, 200, () => 0);
  assert.equal(n[COUNTERS.moves], 1960);
  assert.equal(n[COUNTERS.splits], 15);
  assert.equal(n[COUNTERS.fingerHits], 184);
});

test('A1 control: flatStub never splits (splits 0 on both rows)', () => {
  assert.equal(counterRow(flatStub, 16, 1e4, 1e4, (k) => k).n[COUNTERS.splits], 0);
  assert.equal(counterRow(flatStub, 16, 200, 200, () => 0).n[COUNTERS.splits], 0);
});

test('A1 COUNTERS is frozen with the 0003 names at idx 0..11', () => {
  const names = ['touches', 'pulls', 'moves', 'splits', 'merges', 'equalizes', 'rotSingle',
    'rotDouble', 'fingerHits', 'fingerMisses', 'joinSteps', 'seamRepairs'];
  assert.ok(Object.isFrozen(COUNTERS));
  names.forEach((nm, i) => assert.equal(COUNTERS[nm], i, nm));
  assert.equal(Object.keys(COUNTERS).length, 12);
  const { views } = synthStub(8, { leafSize: 4, dims: 1 }, 1);
  assert.equal(views[0]._n.length, 12);
});

// ------------------------------------------------------------------ A2 named

test('A2 (C-33, R1-3) flatStub BFS B=4 fails I-5 at insertAt, witnessLength 5', () => {
  const r = bfsLane(flatStub, { B: 4, nMax: 6 });
  assert.equal(r.ok, false);
  assert.equal(r.first.lane, 'bfs');
  assert.equal(r.first.code, 'I-5');
  assert.ok(r.first.detail.startsWith('leaf:'), r.first.detail);
  assert.equal(r.first.op, 'insertAt');
  assert.equal(r.first.witnessLength, 5);
});

test('A2 (C-33) flatStub with walker: false has 0 oracle divergences', () => {
  const r = bfsLane(flatStub, { B: 4, nMax: 6, walker: false });
  assert.equal(r.ok, true);
  assert.equal(r.divergences, 0);
});

test('A2 (C-33) seekStub: BFS ok, sweep fails I-4 on indexAtSum', () => {
  assert.equal(bfsLane(seekStub, { B: 4, nMax: 6 }).ok, true);
  const r = sweepLane(seekStub, { B: 4, states: small4().states, nSweep: 5 });
  assert.equal(r.ok, false);
  assert.equal(r.first.lane, 'sweep');
  assert.equal(r.first.code, 'I-4');
  assert.equal(r.first.op, 'indexAtSum');
});

test('A2 (C-33) staleFingerStub fails I-9c in the sweep, finger on; synthStub passes', () => {
  const states = small4().states;
  const r = sweepLane(staleFingerStub, { B: 4, states, nSweep: 5 });
  assert.equal(r.ok, false);
  assert.equal(r.first.lane, 'sweep');
  assert.equal(r.first.code, 'I-9c');
  assert.equal(r.first.run, 'on');
  assert.equal(sweepLane(synthStub, { B: 4, states, nSweep: 5 }).ok, true);
});

test('A2 control (C-31) nolandStub: BFS ok, sweep ONOFF on getMeasure, no-suffix sweep SWEEP', () => {
  const states = small4().states;
  assert.equal(bfsLane(nolandStub, { B: 4, nMax: 6 }).ok, true);
  const r = sweepLane(nolandStub, { B: 4, states, nSweep: 5 });
  assert.equal(r.ok, false);
  assert.equal(r.first.code, 'ONOFF');
  assert.equal(r.first.op, 'getMeasure');
  const s = sweepLane(nolandStub, { B: 4, states, nSweep: 5, suffixes: false });
  assert.equal(s.ok, false);
  assert.equal(s.first.code, 'SWEEP');
});

test('A2 control (C-26) countStub (indexAtSum adds a miss) fails C-26 in the sweep', () => {
  const r = sweepLane(countStub, { B: 4, states: small4().states, nSweep: 5 });
  assert.equal(r.ok, false);
  assert.equal(r.first.code, 'C-26');
});

test('A2 control (C-27) homeStub (indexAtSum re-homes) fails C-27 in the sweep', () => {
  const r = sweepLane(homeStub, { B: 4, states: small4().states, nSweep: 5 });
  assert.equal(r.ok, false);
  assert.equal(r.first.code, 'C-27');
});

test('A2 control (C-27) a view without an own _fdepth fails C-27 before any off write', () => {
  const r = bfsLane(synthStub, { B: 4, nMax: 6, cfg: { protoField: '_fdepth' } });
  assert.equal(r.ok, false);
  assert.equal(r.first.code, 'C-27');
  assert.equal(r.first.op, null);
  assert.equal(r.first.witnessLength, 0);
});

test('A2 control (BUDGET) cap 10 fails BUDGET', () => {
  const r = bfsLane(synthStub, { B: 4, nMax: 6, cap: 10 });
  assert.equal(r.ok, false);
  assert.equal(r.first.code, 'BUDGET');
});

// ------------------------------------------------------- R1-6 fail-open closers

test('R1-6 sweepLane with no state at n <= nSweep fails SWEEP "no states"', () => {
  const big = small4().states.filter((s) => s.n > 2);
  const r = sweepLane(synthStub, { B: 4, states: big, nSweep: 2 });
  assert.equal(r.ok, false);
  assert.equal(r.first.code, 'SWEEP');
  assert.ok(r.first.detail.includes('no states'), r.first.detail);
});

test('R1-6 bfsLane that applies nothing fails LANE "closer: applied 0"', () => {
  const r = bfsLane(synthStub, { B: 4, nMax: 2, drop: ['insertAt', 'removeAt', 'splitAt'] });
  assert.equal(r.ok, false);
  assert.equal(r.first.code, 'LANE');
  assert.equal(r.first.detail, 'closer: applied 0');
});

test('R1-6 bfsLane that never sees n=1 fails LANE "closer: unseen n=1"', () => {
  const r = bfsLane(synthStub, { B: 4, nMax: 3, drop: ['insertAt'] });
  assert.equal(r.ok, false);
  assert.equal(r.first.code, 'LANE');
  assert.equal(r.first.detail, 'closer: unseen n=1');
});

test('R1-6 sweepLane that applies nothing fails LANE "closer: applied 0"', () => {
  const r = sweepLane(synthStub, { B: 4, nSweep: 1, suffixes: false, states: [{ n: 0, witness: [] }] });
  assert.equal(r.ok, false);
  assert.equal(r.first.code, 'LANE');
  assert.equal(r.first.detail, 'closer: applied 0');
});

test('R1-6 deepLane with ops 0 fails LANE "closer: applied 0"', () => {
  const r = deepLane(synthStub, { B: 4, ops: 0, seed: 1, nLo: 8, nHi: 48 });
  assert.equal(r.ok, false);
  assert.equal(r.first.code, 'LANE');
  assert.equal(r.first.detail, 'closer: applied 0');
});

test('R1-6 invalid options (nMax -1) throw RangeError', () => {
  assert.throws(() => bfsLane(synthStub, { B: 4, nMax: -1 }), RangeError);
});

test('A2 (BUDGET boundary) cap = applied passes, cap = applied - 1 fails BUDGET', () => {
  const n = small4().applied;
  assert.ok(n > 1);
  const okRun = bfsLane(synthStub, { B: 4, nMax: 6, cap: n });
  assert.equal(okRun.ok, true);
  const r = bfsLane(synthStub, { B: 4, nMax: 6, cap: n - 1 });
  assert.equal(r.ok, false);
  assert.equal(r.first.code, 'BUDGET');
});

// ------------------------------------------- driver-check controls (wrapper factory)
// The lanes build the finger-on arena first, then the off one (0005 Addendum 4), so
// the wrapper mutates by build parity: even = on, odd = off.

const MISS = COUNTERS.fingerMisses, HIT = COUNTERS.fingerHits;
function wrapFactory(mut) {
  let built = 0;
  return (C, o, count, cfg) => {
    const a = synthStub(C, o, count, cfg);
    mut(a, built++ % 2 === 1 ? 'off' : 'on');
    return a;
  };
}
function wrapMethod(a, name, wrapper) {
  for (const v of a.views) { const orig = v[name]; v[name] = function (...args) { return wrapper(v, orig, args); }; }
}
function rehome(v, orig) { // getMeasure(0,0) re-homes the finger; undo its counter delta
  const h = v._n[HIT], m = v._n[MISS];
  if (v.length > 0) orig.call(v, 0, 0);
  v._n[HIT] = h; v._n[MISS] = m;
}
const small = { bfs: () => ({ B: 4, nMax: 4 }), sw: () => ({ B: 4, states: small4().states, nSweep: 5 }) };

test('Driver control (C-27 ONOFF) off answers +1 -> ONOFF "answer:"', () => {
  const f = wrapFactory((a, run) => {
    if (run === 'off') wrapMethod(a, 'getMeasure', (v, o, args) => o.apply(v, args) + 1);
  });
  const r = sweepLane(f, small.sw());
  assert.equal(r.ok, false);
  assert.equal(r.first.code, 'ONOFF');
  assert.ok(r.first.detail.startsWith('answer:'), r.first.detail);
});

test('Driver control (C-27 ONOFF) off snapshot toggles _cv on view 0 -> ONOFF "state:"', () => {
  const f = wrapFactory((a, run) => {
    if (run !== 'off') return;
    const o = a.snapshot;
    a.snapshot = () => { const s = o(); s.views[0]._cv = !s.views[0]._cv; return s; };
  });
  const r = bfsLane(f, small.bfs());
  assert.equal(r.ok, false);
  assert.equal(r.first.code, 'ONOFF');
  assert.ok(r.first.detail.startsWith('state:'), r.first.detail);
});

test('Driver control (I-9c) off snapshot _fb + 1 where fl is set -> I-9c run off', () => {
  const f = wrapFactory((a, run) => {
    if (run !== 'off') return;
    const o = a.snapshot;
    a.snapshot = () => { const s = o(); for (const v of s.views) if (v._fl < 0) v._fb++; return s; };
  });
  const r = bfsLane(f, small.bfs());
  assert.equal(r.ok, false);
  assert.equal(r.first.code, 'I-9c');
  assert.equal(r.first.run, 'off');
});

test('Driver control (C-26) off insertAt moves a miss to a hit -> C-26 run off', () => {
  const f = wrapFactory((a, run) => {
    if (run !== 'off') return;
    wrapMethod(a, 'insertAt', (v, o, args) => {
      const m = v._n[MISS], r = o.apply(v, args);
      if (v._n[MISS] > m) { v._n[MISS]--; v._n[HIT]++; }
      return r;
    });
  });
  const r = bfsLane(f, small.bfs());
  assert.equal(r.ok, false);
  assert.equal(r.first.code, 'C-26');
  assert.equal(r.first.run, 'off');
});

test('Driver control (C-26) insertAt adds an extra miss on BOTH runs -> C-26', () => {
  const f = wrapFactory((a) => {
    wrapMethod(a, 'insertAt', (v, o, args) => { const r = o.apply(v, args); v._n[MISS]++; return r; });
  });
  const r = bfsLane(f, small.bfs());
  assert.equal(r.ok, false);
  assert.equal(r.first.code, 'C-26');
});

test('Driver control (C-27) indexAtSum re-homes the on finger when fl is set -> C-27 run on', () => {
  const f = wrapFactory((a, run) => {
    if (run !== 'on') return;
    wrapMethod(a, 'indexAtSum', (v, o, args) => {
      const r = o.apply(v, args);
      if (v._fl !== 0) rehome(v, v.getMeasure);
      return r;
    });
  });
  const r = sweepLane(f, small.sw());
  assert.equal(r.ok, false);
  assert.equal(r.first.code, 'C-27');
  assert.equal(r.first.run, 'on');
});

test('Driver control (C-27) indexAtSum re-homes the off finger from NIL -> C-27 run off', () => {
  const f = wrapFactory((a, run) => {
    if (run !== 'off') return;
    wrapMethod(a, 'indexAtSum', (v, o, args) => {
      const wasNil = v._fl === 0;
      const r = o.apply(v, args);
      if (wasNil) rehome(v, v.getMeasure);
      return r;
    });
  });
  const r = sweepLane(f, small.sw());
  assert.equal(r.ok, false);
  assert.equal(r.first.code, 'C-27');
  assert.equal(r.first.run, 'off');
});

test('Driver control (C-27) a view with _root = 0 at build fails C-27 "empty-root", op null', () => {
  const f = wrapFactory((a) => { a.views[0]._root = 0; });
  const r = bfsLane(f, small.bfs());
  assert.equal(r.ok, false);
  assert.equal(r.first.code, 'C-27');
  assert.ok(r.first.detail.includes('empty-root'), r.first.detail);
  assert.equal(r.first.op, null);
});

test('Driver control (ORACLE) a replay that the oracle rejects fails ORACLE "replay:"', () => {
  const r = sweepLane(synthStub, { B: 4, nSweep: 1, states: [{ n: 0, witness: [{ op: 'removeAt', i: 0 }] }] });
  assert.equal(r.ok, false);
  assert.equal(r.first.code, 'ORACLE');
  assert.ok(r.first.detail.startsWith('replay:'), r.first.detail);
});

// ------------------------------------------------------------------ A3 cells

const ROT = ['rotSingle@insertAt', 'rotSingle@removeAt', 'rotDouble@insertAt', 'rotDouble@removeAt'];
const ALL8 = ROT.concat(['mergeMoves', 'equalize4', 'equalize5', 'equalize6', 'equalize7',
  'equalize8', 'splitAt1', 'splitAt2', 'append1']);

test('A3 (C-32) CELLS sizes, order and frozenness', () => {
  assert.deepEqual([...CELLS(4)], ROT);
  assert.deepEqual([...CELLS(8)], ALL8);
  assert.equal(CELLS(4).length, 4);
  assert.equal(CELLS(8).length, 13);
  assert.ok(Object.isFrozen(CELLS(4)) && Object.isFrozen(CELLS(8)));
});

function tallyOf(B, v) {
  const t = {};
  for (const c of CELLS(B)) t[c] = v;
  return t;
}

for (const B of [4, 8]) {
  test(`A3 (C-41 A6) all-ones tally passes at B=${B}; each one-zero tally names exactly that cell`, () => {
    assert.deepEqual(coverageMissing(tallyOf(B, 1), B), []);
    assert.doesNotThrow(() => assertCoverage(tallyOf(B, 1), B));
    for (const c of CELLS(B)) {
      const t = tallyOf(B, 1);
      t[c] = 0;
      assert.deepEqual(coverageMissing(t, B), [c], c);
      assert.throws(() => assertCoverage(t, B), (e) =>
        e instanceof RangeError && e.message === 'coverage: missing ' + c, c);
    }
  });
}

test('A3 (R1-5) missing means !(t >= 1): NaN and absent keys are missing; names in CELLS order', () => {
  const t = tallyOf(8, 5);
  t.mergeMoves = NaN;
  delete t.append1;
  t['rotSingle@insertAt'] = 0;
  assert.deepEqual(coverageMissing(t, 8), ['rotSingle@insertAt', 'mergeMoves', 'append1']);
  assert.throws(() => assertCoverage(t, 8),
    { name: 'RangeError', message: 'coverage: missing rotSingle@insertAt, mergeMoves, append1' });
});

test('A3 mergeTally sums two tallies key-wise without mutating either', () => {
  const a = tallyOf(8, 0), b = tallyOf(8, 0);
  a.splitAt1 = 2; b.splitAt1 = 3; a.mergeMoves = 1; b.equalize5 = 4;
  const m = mergeTally(a, b);
  assert.equal(m.splitAt1, 5);
  assert.equal(m.mergeMoves, 1);
  assert.equal(m.equalize5, 4);
  assert.equal(m.append1, 0);
  assert.equal(a.splitAt1, 2);
  assert.equal(b.splitAt1, 3);
});

function fullTally(B, extra) {
  return mergeTally(
    bfsLane(synthStub, { B, nMax: CAPS.nMax[B], ...extra }).tally,
    deepLane(synthStub, {
      B, ops: CAPS.deepOps, seed: 1, nLo: CAPS.deepN[B][0], nHi: CAPS.deepN[B][1], ...extra,
    }).tally);
}

test('A3 (R1-1) tallies carry every CELLS key (plain object)', () => {
  for (const B of [4, 8]) {
    for (const t of [bfs(B).tally, deep(B).tally]) {
      assert.equal(Object.getPrototypeOf(t), Object.prototype);
      for (const c of CELLS(B)) assert.ok(c in t, c);
    }
  }
});

test('A3 (C-32) synthStub never rotates: its full run misses exactly the 4 rot cells per B', () => {
  for (const B of [4, 8]) {
    const t = mergeTally(bfs(B).tally, deep(B).tally);
    assert.deepEqual(coverageMissing(t, B), ROT, 'B=' + B);
    assert.throws(() => assertCoverage(t, B), RangeError);
  }
});

test('A3 (R1-1) B=8 drop [removeAt]: missing grows by exactly {mergeMoves, equalize4..8}', () => {
  const full = new Set(coverageMissing(mergeTally(bfs(8).tally, deep(8).tally), 8));
  const dropped = coverageMissing(fullTally(8, { drop: ['removeAt'] }), 8);
  const diff = dropped.filter((c) => !full.has(c)).sort();
  assert.deepEqual(diff, ['equalize4', 'equalize5', 'equalize6', 'equalize7', 'equalize8',
    'mergeMoves']);
});

// ------------------------------------------------------- A4 retention (R1-4)

test('A4 (R1-4) 100 fill / split / append / clear cycles each end with bump = live = 0', () => {
  const { views, snapshot } = synthStub(64, { leafSize: 8, dims: 1 }, 2);
  const [a, b] = views;
  let sawLive = 0;
  for (let cycle = 0; cycle < 100; cycle++) {
    for (let k = 0; k < 60; k++) a.insertAt(k, (cycle + k) % 1000, 1);
    let s = snapshot();
    assert.equal(s.live, 60);
    if (s.int.bump > 0 && s.leaf.bump > 0) sawLive++; // the check below has teeth
    a.splitAt(30, b);
    assert.equal(a.length + b.length, 60);
    a.append(b);
    assert.equal(a.length, 60);
    a.clear();
    b.clear();
    s = snapshot();
    assert.equal(s.live, 0, 'live cycle ' + cycle);
    assert.equal(s.int.bump, 0, 'int.bump cycle ' + cycle);
    assert.equal(s.leaf.bump, 0, 'leaf.bump cycle ' + cycle);
  }
  assert.equal(sawLive, 100);
});

// ------------------------------------------------------------------- A5 static

test('A5 (C-31/C-32) ENGINE is frozen (deeply) and holds the engine numbers', () => {
  assert.ok(Object.isFrozen(ENGINE));
  for (const k of ['nMax', 'nSweep', 'deepN']) assert.ok(Object.isFrozen(ENGINE[k]), k);
  for (const B of [4, 8]) assert.ok(Object.isFrozen(ENGINE.deepN[B]), 'deepN ' + B);
  assert.equal(ENGINE.cap, 2 ** 22);
  assert.equal(ENGINE.nMax[4], 9);
  assert.equal(ENGINE.nMax[8], 15);
  assert.equal(ENGINE.nSweep[4], 7);
  assert.equal(ENGINE.nSweep[8], 12);
  assert.equal(ENGINE.deepOps, 2e4);
  assert.deepEqual([...ENGINE.deepN[4]], [8, 48]);
  assert.deepEqual([...ENGINE.deepN[8]], [16, 96]);
});

test('A5 (R1-2) CAPS is frozen (deeply) and holds the npm-test sizes', () => {
  assert.ok(Object.isFrozen(CAPS));
  for (const k of ['nMax', 'nSweep', 'deepN']) assert.ok(Object.isFrozen(CAPS[k]), k);
  for (const B of [4, 8]) assert.ok(Object.isFrozen(CAPS.deepN[B]), 'deepN ' + B);
  assert.equal(CAPS.cap, 262144);
  assert.equal(CAPS.nMax[4], 6);
  assert.equal(CAPS.nMax[8], 10);
  assert.equal(CAPS.nSweep[4], 5);
  assert.equal(CAPS.nSweep[8], 9);
  assert.equal(CAPS.deepOps, 4000);
  assert.deepEqual([...CAPS.deepN[4]], [8, 48]);
  assert.deepEqual([...CAPS.deepN[8]], [16, 96]);
});

test('A5 (R1-2) every lane report has applied <= CAPS.cap', () => {
  for (const B of [4, 8]) {
    for (const r of [bfs(B), sweep(B), deep(B)]) {
      assert.ok(r.applied > 0 && r.applied <= CAPS.cap, 'B=' + B + ' applied ' + r.applied);
    }
  }
});

test('A5 CODES is a frozen list that includes the harness codes', () => {
  assert.ok(Object.isFrozen(CODES));
  for (const c of ['I-4', 'I-5', 'I-9c', 'ORACLE', 'ONOFF', 'C-26', 'C-27', 'BUDGET', 'SWEEP']) {
    assert.ok(CODES.includes(c), c);
  }
});

// ---- static text scan (we never read the implementation's behaviour, only its text)

const SRC = {
  stubs: readFileSync(HERE('./stubs.mjs'), 'utf8'),
  exhaustive: readFileSync(HERE('./exhaustive.mjs'), 'utf8'),
};

function stripNoise(src) { // comments, strings, template literals, regex-free enough for a scan
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, '""')
    .replace(/'(?:\\.|[^'\\\n])*'/g, '""')
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""');
}

function matchClose(s, open, oc, cc) { // index of the bracket closing s[open]
  let d = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === oc) d++;
    else if (s[i] === cc && --d === 0) return i;
  }
  return -1;
}

// Names of functions whose own body calls themselves (declarations and const arrows).
function selfCallers(src) {
  const s = stripNoise(src), out = [];
  const decl = /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g;
  const arrow = /\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function\b[^(]*)?\(/g;
  const jobs = [];
  let m;
  while ((m = decl.exec(s))) jobs.push({ name: m[1], at: m.index + m[0].length - 1 });
  while ((m = arrow.exec(s))) jobs.push({ name: m[1], at: m.index + m[0].length - 1 });
  for (const j of jobs) {
    const pc = matchClose(s, j.at, '(', ')');
    if (pc < 0) continue;
    let k = pc + 1;
    while (/\s/.test(s[k])) k++;
    if (s.startsWith('=>', k)) { k += 2; while (/\s/.test(s[k])) k++; }
    let body;
    if (s[k] === '{') body = s.slice(k, matchClose(s, k, '{', '}') + 1);
    else body = s.slice(k, s.indexOf(';', k));
    if (new RegExp('(^|[^\\w$.])' + j.name.replace(/\$/g, '\\$') + '\\s*\\(').test(body)) out.push(j.name);
  }
  // class / object methods that call themselves through this.name( or this.#name(
  const meth = /^[ \t]*(?:static\s+|async\s+|get\s+|set\s+)*(#?[A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/gm;
  const KW = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'with', 'return']);
  while ((m = meth.exec(s))) {
    if (KW.has(m[1])) continue;
    const open = m.index + m[0].length - 1;
    const body = s.slice(open, matchClose(s, open, '{', '}') + 1);
    const nm = m[1].replace(/[$#]/g, '\\$&');
    if (new RegExp('\\bthis\\s*\\.\\s*' + nm + '\\s*\\(').test(body)) out.push('this.' + m[1]);
  }
  return out;
}

function importSpecs(raw) {
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/[^\n]*/gm, ' ');
  const out = [];
  const re = /^\s*import\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/gm;
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  const reex = /\bexport\s*(?:\*(?:\s+as\s+[\w$]+)?|\{[^}]*\})\s*from\s*['"]([^'"]+)['"]/g;
  while ((m = reex.exec(src))) out.push(m[1]);
  const dyn = /\bimport\s*\(\s*(['"])?([^'")]*)/g;
  while ((m = dyn.exec(src))) out.push(m[1] ? m[2] : '<dynamic>');
  const bare = /^\s*import\s*['"]([^'"]+)['"]/gm;
  while ((m = bare.exec(src))) out.push(m[1]);
  return out.sort();
}

test('A5 (0001 DB-8 M-3 b) no self-calling function in stubs.mjs / exhaustive.mjs', () => {
  assert.deepEqual(selfCallers(SRC.stubs), []);
  assert.deepEqual(selfCallers(SRC.exhaustive), []);
});

test('A5 control: the self-call scanner catches decl, arrow and expression recursion', () => {
  assert.deepEqual(selfCallers('function f(x) { return x ? f(x - 1) : 0; }'), ['f']);
  assert.deepEqual(selfCallers('const g = (x) => { return g(x); };'), ['g']);
  assert.deepEqual(selfCallers('const h = (x) => x && h(x - 1);'), ['h']);
  assert.deepEqual(selfCallers('function k(x) { return j(x); }\nfunction j(x) { return x; }'), []);
  assert.deepEqual(selfCallers('function p(x) { return "p(" + x; } // p(1)'), []);
});

test('A5 control: the self-call scanner catches this.name( and this.#name( in methods', () => {
  assert.deepEqual(selfCallers('class StubView {\n  _rec(k) { return this._rec(k - 1); }\n}'), ['this._rec']);
  assert.deepEqual(selfCallers('class V {\n  #r(k) { return this.#r(k - 1); }\n}'), ['this.#r']);
  assert.deepEqual(selfCallers('class V {\n  a(k) { return this.b(k); }\n  b(k) { return k; }\n}'), []);
});

test('A5 (TASKS 1, 3) import lists: stubs -> spec-counts only; exhaustive -> walker, oracle, spec-counts', () => {
  assert.deepEqual(importSpecs(SRC.stubs), ['./spec-counts.mjs']);
  assert.deepEqual(importSpecs(SRC.exhaustive), ['./oracle.mjs', './spec-counts.mjs', './walker.mjs']);
  const named = /import\s*\{([^}]*)\}\s*from\s*['"]\.\/spec-counts\.mjs['"]/.exec(SRC.stubs);
  assert.ok(named, 'stubs.mjs imports names from spec-counts');
  const names = named[1].split(',').map((x) => x.trim()).filter(Boolean).sort();
  assert.deepEqual(names, ['H', 'Lmax']);
});

test('A5 control: the import scanner sees extra imports', () => {
  assert.deepEqual(importSpecs("import { a } from './x.mjs';\nimport fs from 'node:fs';\nimport './y.mjs';"),
    ['./x.mjs', './y.mjs', 'node:fs']);
  assert.deepEqual(importSpecs("export {walk as _w} from './walker.mjs';\nexport * from './o.mjs';"),
    ['./o.mjs', './walker.mjs']);
  assert.deepEqual(importSpecs("const m = await import('node:fs');"), ['node:fs']);
  assert.deepEqual(importSpecs('const m = await import(name);'), ['<dynamic>']);
  assert.deepEqual(importSpecs("// import('node:fs')\nexport const x = 1;"), []);
});

test('A5 ASCII-only (U+00D7 and U+00B5 excepted) in stubs.mjs, exhaustive.mjs and this file', () => {
  const bad = /[^\x00-\x7F\xD7\xB5]/;
  assert.ok(!bad.test(SRC.stubs), 'stubs.mjs');
  assert.ok(!bad.test(SRC.exhaustive), 'exhaustive.mjs');
  assert.ok(!bad.test(readFileSync(HERE('./Exhaustive.test.mjs'), 'utf8')), 'Exhaustive.test.mjs');
  assert.ok(bad.test('caf\xE9'), 'control: a non-ASCII letter is caught');
});

test('A5 Yggdrasil.js is untouched (sha256 06ad5a70)', () => {
  const h = createHash('sha256').update(readFileSync(HERE('../Yggdrasil.js'))).digest('hex');
  assert.equal(h.slice(0, 8), '06ad5a70');
});
