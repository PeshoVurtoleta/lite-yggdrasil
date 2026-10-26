// test/EngineLanes.test.mjs -- the exhaustive lanes on the real engine at CAPS sizes, the C-32 coverage
// cells and drop control, the B-1a source mutant and its unpatched buildMutant control (B-1b runs in test/engine-lanes.mjs at nMax 9), and the interleaved finger-off mix (ADR 0005 C-31,
// C-32, C-26, C-27, C-46; PLAN G-B2 tasks 4 and FO, A11-6). ENGINE-size lanes live in test/engine-lanes.mjs
// (npm run test:lanes, R-E1).
//
// Every expected value is derived from the spec (C-31 caps, C-32 cell list, C-26 hit / miss partition) or
// from test/oracle.mjs (an independent plain-array model), never from engine output, except two values MEASURED and labelled at their site (the B = 8 sweep's nSweep - 1
// and the drop control's rotDouble@insertAt).
//
// HARNESS READING (orchestrator reading, PROPOSED addendum, not a maintainer ruling): the engine's clear()
// returns this (0004:120), Oracle.clear returns undefined, and exhaustive.mjs compares returns by kind, so
// sweepLane's clear suffix reports ORACLE on the real engine. The lane factory here wraps clear as an OWN
// property on each view (never the prototype): it calls the real clear, throws if the result is not the
// view, and returns undefined. Fix owner: the K cursor batch's M-6 re-pin of exhaustive.mjs / oracle.mjs.
// The sweep at B = 8 lowers nSweep by 1 (C-31 binding rule, PROPOSED addendum): CAPS.nSweep[8] = 9 applies
// 262145 > 2^18, so nSweep 8 is used; CAPS itself is not edited and the cap is never raised.
//
// ASCII-only. MIT (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SumSequence } from '../Yggdrasil.js';
import { engineFactory } from './adapter.mjs';
import { buildMutant } from './mutant-build.mjs';
import {
  bfsLane, sweepLane, deepLane, coverageMissing, assertCoverage, mergeTally, CAPS, CELLS,
} from './exhaustive.mjs';
import { Oracle } from './oracle.mjs';
import { walk } from './walker.mjs';

const HERE = (p) => fileURLToPath(new URL(p, import.meta.url));
const YPATH = HERE('../Yggdrasil.js');
const APATH = HERE('./adapter.mjs');

// Own-property clear wrapper (see the header). Generic over the view's prototype so mutant engines work too.
function wrapClear(f) {
  return (C, o, n, cfg) => {
    const r = f(C, o, n, cfg);
    for (const v of r.views) {
      v.clear = function () {
        const q = Object.getPrototypeOf(this).clear.call(this);
        if (q !== this) throw new Error('engine-lanes: clear() must return this');
        return undefined;
      };
    }
    return r;
  };
}
const factory = wrapClear(engineFactory);

const memo = new Map();
const once = (k, fn) => { if (!memo.has(k)) memo.set(k, fn()); return memo.get(k); };
const bfs = (B) => once('bfs' + B, () => bfsLane(factory, { B, nMax: CAPS.nMax[B], cap: CAPS.cap }));
// C-31: B = 8 sweeps at nSweep 8 (CAPS.nSweep[8] = 9 exceeds 2^18 by one apply). PROPOSED addendum.
const SWEEP_N = { 4: CAPS.nSweep[4], 8: CAPS.nSweep[8] - 1 };
const sweep = (B) => once('sweep' + B, () =>
  sweepLane(factory, { B, states: bfs(B).states, nSweep: SWEEP_N[B], cap: CAPS.cap }));
const deepOpts = (B, extra) => ({
  B, ops: CAPS.deepOps, seed: 1, nLo: CAPS.deepN[B][0], nHi: CAPS.deepN[B][1], cap: CAPS.cap, ...extra,
});
const deep = (B) => once('deep' + B, () => deepLane(factory, deepOpts(B)));

// ------------------------------------------------------------------ lanes at CAPS
describe('EngineLanes CAPS', () => {
  for (const B of [4, 8]) {
    test(`bfsLane B=${B} nMax ${CAPS.nMax[B]}: ok, 0 divergences, within 2^18, every n seen`, () => {
      const r = bfs(B);
      assert.equal(r.ok, true, JSON.stringify(r.first));
      assert.equal(r.divergences, 0);
      assert.ok(r.applied > 0 && r.applied <= CAPS.cap, 'applied ' + r.applied);
      const seen = new Set(r.states.map((s) => s.n));
      for (let n = 0; n <= CAPS.nMax[B]; n++) assert.ok(seen.has(n), 'n ' + n);
    });
    test(`sweepLane B=${B} nSweep ${SWEEP_N[B]} over the bfs states: ok, 0 divergences, within 2^18`, () => {
      const r = sweep(B);
      assert.equal(r.ok, true, JSON.stringify(r.first));
      assert.equal(r.divergences, 0);
      assert.ok(r.applied > 0 && r.applied <= CAPS.cap, 'applied ' + r.applied);
    });
    test(`deepLane B=${B} ${CAPS.deepOps} ops: ok, 0 divergences, within 2^18`, () => {
      const r = deep(B);
      assert.equal(r.ok, true, JSON.stringify(r.first));
      assert.equal(r.divergences, 0);
      assert.ok(r.applied > 0 && r.applied <= CAPS.cap, 'applied ' + r.applied);
    });
    test(`C-32 coverage B=${B}: assertCoverage(merge(bfs, deep)) passes, all ${CELLS(B).length} cells`, () => {
      assert.equal(CELLS(B).length, B === 4 ? 4 : 13); // C-32 cell counts
      assertCoverage(mergeTally(bfs(B).tally, deep(B).tally), B);
    });
  }

  test('C-32 drop control: B=8 bfs + deep with drop [removeAt] lose exactly the removeAt-attributed cells and the measured rotDouble@insertAt', () => {
    const b = bfsLane(factory, { B: 8, nMax: CAPS.nMax[8], cap: CAPS.cap, drop: ['removeAt'] });
    const d = deepLane(factory, deepOpts(8, { drop: ['removeAt'] }));
    assert.equal(b.ok, true, JSON.stringify(b.first));
    assert.equal(d.ok, true, JSON.stringify(d.first));
    const full = coverageMissing(mergeTally(bfs(8).tally, deep(8).tally), 8);
    const lost = coverageMissing(mergeTally(b.tally, d.tally), 8).filter((c) => !full.includes(c));
    // C-32's six (spec) + rotSingle@removeAt / rotDouble@removeAt (attributed to the dropped op) + rotDouble@insertAt
    // (MEASURED 2026-10-27 on Yggdrasil.js 43276f1e: no insert-side double rotation is reachable at CAPS without removeAt;
    // re-measure on a balance change). PROPOSED addendum to C-32's "minus" sentence (D12 fold), not ruled.
    assert.deepEqual(full, []);
    assert.deepEqual(lost, ['rotSingle@removeAt', 'rotDouble@insertAt', 'rotDouble@removeAt', 'mergeMoves',
      'equalize4', 'equalize5', 'equalize6', 'equalize7', 'equalize8']);
  });
});

// ------------------------------------------------------------------ mutants
const built = [];
after(() => { for (const b of built) b.cleanup(); });
async function buildEngineFactory(patches) {
  const Y = await buildMutant(YPATH, patches);
  const A = await buildMutant(APATH, [["'../Yggdrasil.js'", "'" + pathToFileURL(Y.file).href + "'", 1]]);
  built.push(Y, A);
  return wrapClear(A.engineFactory);
}

// B-1a: stored internal weight = ELEMENT count instead of leaf count (leaf children add llen, not 1).
// Anchor (exactly 1, in ygPullW): `weight[x] = (l < 0 ? 1 : weight[l]) + (r < 0 ? 1 : weight[r]);`
const B1A = [['weight[x] = (l < 0 ? 1 : weight[l]) + (r < 0 ? 1 : weight[r]);',
  'weight[x] = (l < 0 ? llen[~l] : weight[l]) + (r < 0 ? llen[~r] : weight[r]);', 1]];

describe('EngineLanes controls', () => {
  test('control: the unpatched engine through buildMutant (zero patches) passes the CAPS bfsLane B=4', async () => {
    const f = await buildEngineFactory([]);
    const r = bfsLane(f, { B: 4, nMax: CAPS.nMax[4], cap: CAPS.cap });
    assert.equal(r.ok, true, JSON.stringify(r.first));
  });
  test('B-1a mutant (weight = element count): CAPS bfsLane B=4 fails with code I-1', async () => {
    const f = await buildEngineFactory(B1A);
    const r = bfsLane(f, { B: 4, nMax: CAPS.nMax[4], cap: CAPS.cap });
    assert.equal(r.ok, false);
    assert.equal(r.first.code, 'I-1', JSON.stringify(r.first));
  });
  test('clear wrapper fails closed: an underlying clear() that returns undefined throws', () => {
    const fake = () => ({ views: [Object.create({ clear() { return undefined; } })], snapshot() {} });
    const w = wrapClear(fake)(1, {}, 1);
    assert.throws(() => w.views[0].clear(), /clear\(\) must return this/);
    const fake2 = () => ({ views: [Object.create({ clear() { return {}; } })], snapshot() {} });
    assert.throws(() => wrapClear(fake2)(1, {}, 1).views[0].clear(), /clear\(\) must return this/);
    assert.ok(Object.hasOwn(w.views[0], 'clear'));
  });
});

// ------------------------------------------------------------------ FO: finger-off mix (A11-6)
// Seeded 32-bit xorshift; independent streams for ops, indices, measures and the drop draw.
function xs(s) { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; return s >>> 0; }
const POSITIONAL = ['insertAt', 'removeAt', 'setMeasure', 'getMeasure', 'entityAt'];
const NAMES = ['insertAt', 'removeAt', 'setMeasure', 'getMeasure', 'entityAt', 'indexAtSum', 'sumBefore',
  'total', 'splitAt', 'append', 'clear'];
const W_GROW = [40, 12, 8, 8, 8, 5, 5, 3, 4, 4, 3];
const W_DRAIN = [12, 40, 8, 8, 8, 5, 5, 3, 4, 4, 3];
const HIT = SumSequence.COUNTERS.fingerHits;
const MISS = SumSequence.COUNTERS.fingerMisses;
const DIMS = 2;
const CAP_LIVE = 100; // C = 120; insertAt stops at 100 live elements over both views

function call(v, o, x) {
  try {
    let r;
    switch (x.op) {
      case 'insertAt': r = v.insertAt(x.i, x.e, x.m0, x.m1); break;
      case 'removeAt': r = v.removeAt(x.i); break;
      case 'setMeasure': r = v.setMeasure(x.i, x.d, x.m0); break;
      case 'getMeasure': r = v.getMeasure(x.i, x.d); break;
      case 'entityAt': r = v.entityAt(x.i); break;
      case 'indexAtSum': r = v.indexAtSum(x.d, x.y); break;
      case 'sumBefore': r = v.sumBefore(x.d, x.i); break;
      case 'total': r = v.total(x.d); break;
      case 'splitAt': r = v.splitAt(x.i, o); break;
      case 'append': r = v.append(o); break;
      default: r = x.i === 0 ? v.clear() : o.clear(); break;
    }
    if (r !== null && typeof r === 'object') return { k: 'self' };
    return { k: 'val', v: r };
  } catch (e) {
    if (e instanceof RangeError) return { k: 'throw', cls: e.name, msg: e.message };
    return { k: 'err', msg: String(e && e.message) };
  }
}
function norm(r, x) { return x.op === 'clear' && r.k === 'self' ? { k: 'val', v: undefined } : r; }
const same = (a, b) => a.k === b.k && Object.is(a.v, b.v);

// One cell: B, seed, ops; drop(view0, NIL) is the finger-off hook (a no-op for the control).
// Returns { fail: {name, detail, at} | null, teeth, kinds, structural }.
function runCell(B, seed, ops, dropFn) {
  const make = () => engineFactory(120, { leafSize: B, dims: DIMS }, 2);
  const on = make();
  const off = make();
  const NIL = make().views[0]._fl; // read from a fresh view
  const or = [new Oracle(DIMS), new Oracle(DIMS)];
  const bufs = [0, 1, 2, 3].map(() => new Int32Array(12)); // pre: on0 on1 off0 off1 ; post below
  const post = [0, 1, 2, 3].map(() => new Int32Array(12));
  const arenas = [on.views[0], on.views[1], off.views[0], off.views[1]];
  let so = (0x9E3779B9 ^ seed) >>> 0;
  let si = (0x85EBCA6B ^ seed) >>> 0;
  let sm = (0xC2B2AE35 ^ seed) >>> 0;
  let sd = (0x27D4EB2F ^ seed) >>> 0;
  let sx = (0x165667B1 ^ seed) >>> 0; // invalid-call stream
  const res = { cov: {}, fail: null, teeth: 0, kinds: {}, invalid: 0, splits: 0, merges: 0, walks: 0 };
  const bad = (name, detail, at) => { res.fail = { name, detail, at }; return res; };
  for (let o = 0; o < ops; o++) {
    const w = (Math.floor(o / 300) & 1) === 0 ? W_GROW : W_DRAIN;
    const n0 = or[0].length;
    const n1 = or[1].length;
    so = xs(so);
    let r = so % 100;
    let c = 0;
    while (r >= w[c]) { r -= w[c]; c++; }
    let op = NAMES[c];
    if (op === 'insertAt' && n0 + n1 >= CAP_LIVE) op = 'total';
    if ((op === 'setMeasure' || op === 'getMeasure' || op === 'entityAt') && n0 === 0) op = 'insertAt';
    if (op === 'splitAt' && n1 > 0) op = 'append';
    else if (op === 'append' && n1 === 0) op = 'splitAt';
    si = xs(si);
    sm = xs(sm);
    const x = { op, i: 0, d: (sm >>> 8) % DIMS, e: o & 0x3FFFFFFF, m0: sm % 1000, m1: (sm >>> 10) % 1000, y: 0 };
    const range = op === 'insertAt' || op === 'sumBefore' || op === 'splitAt' ? n0 + 1 : n0;
    x.i = range > 0 ? (si >>> 1) % range : 0;
    if (op === 'indexAtSum') x.y = (sm >>> 3) % (or[0].total(x.d) + 1);
    if (op === 'clear') x.i = (si & 7) === 0 ? 0 : 1; // view 1 mostly, view 0 rare
    sx = xs(sx);
    let invalid = false;
    if (sx % 50 === 0) { // one INVALID positional call per ~50 ops
      x.op = POSITIONAL[(sx >>> 8) % 5];
      x.i = x.op === 'insertAt' ? n0 + 1 + ((sx >>> 12) & 3) : n0 + ((sx >>> 12) & 3);
      invalid = true;
      res.invalid++;
    }
    sd = xs(sd);
    const drop = (sd % 4) === 0;
    const positional = POSITIONAL.includes(x.op);
    res.kinds[x.op] = (res.kinds[x.op] || 0) + 1;
    if (positional && drop) dropFn(off.views[0], NIL);
    for (let k = 0; k < 4; k++) arenas[k].readCounters(bufs[k]);
    const rOn = norm(call(on.views[0], on.views[1], x), x);
    const rOff = norm(call(off.views[0], off.views[1], x), x);
    for (let k = 0; k < 4; k++) arenas[k].readCounters(post[k]);
    const rOr = call(or[0], or[1], x);
    const ok = rOn.k !== 'throw' && rOn.k !== 'err';
    if (positional) { const s = x.op + (ok ? ':ok' : ':thr') + (drop ? 'D' : 'N'); res.cov[s] = (res.cov[s] || 0) + 1; }
    // answers: ON vs OFF exact (class + message for throws), vs the oracle (kind / first token for throws)
    if (rOn.k === 'err' || rOff.k === 'err') return bad('error', rOn.msg + ' | ' + rOff.msg, o);
    if (rOn.k !== rOff.k || !Object.is(rOn.v, rOff.v) || rOn.cls !== rOff.cls || rOn.msg !== rOff.msg) {
      return bad('on-off-answer', x.op + ' on ' + JSON.stringify(rOn) + ' off ' + JSON.stringify(rOff), o);
    }
    if (invalid && rOn.k !== 'throw') return bad('invalid-no-throw', x.op + ' ' + x.i, o);
    const orN = x.op === 'clear' ? { k: 'val', v: undefined } : rOr.k === 'self' ? { k: 'self' } : rOr;
    const okAns = rOn.k === 'throw' ? rOr.k === 'throw' && rOr.msg.split(' ')[0] === rOn.msg.split(' ')[0]
      : rOn.k === 'self' ? orN.k === 'self' : same(rOn, orN);
    if (!okAns) return bad('oracle', x.op + ' engine ' + JSON.stringify(rOn) + ' oracle ' + JSON.stringify(orN), o);
    for (let v = 0; v < 2; v++) {
      if (on.views[v].length !== or[v].length || off.views[v].length !== or[v].length) {
        return bad('length', 'view ' + v + ' after ' + x.op, o);
      }
    }
    // counters: deltas of hits / misses on every view of both arenas
    const dh = [0, 1, 2, 3].map((k) => post[k][HIT] - bufs[k][HIT]);
    const dm = [0, 1, 2, 3].map((k) => post[k][MISS] - bufs[k][MISS]);
    const succPos = positional && ok;
    for (let k = 0; k < 4; k++) {
      const own = k === 0 || k === 2;
      if (own && succPos) continue;
      if (dh[k] !== 0 || dm[k] !== 0) {
        return bad(own ? (positional ? 'throw-or-nonpositional-delta' : 'nonpositional-delta') : 'other-view-delta',
          x.op + ' arena ' + (k < 2 ? 'on' : 'off') + ' view ' + (k & 1) + ' hits +' + dh[k] + ' misses +' + dm[k], o);
      }
    }
    if (succPos) {
      if (drop) {
        if (dh[2] !== 0) return bad('dropped-op-adds-0-hits', x.op + ' off hits +' + dh[2], o);
        if (dm[2] !== 1) return bad('dropped-op-adds-1-miss', x.op + ' off misses +' + dm[2], o);
        if (dh[0] === 1) res.teeth++;
      } else if (dh[2] + dm[2] !== 1) {
        return bad('off-partition', x.op + ' off hits +' + dh[2] + ' misses +' + dm[2], o);
      }
      if (dh[0] + dm[0] !== 1) return bad('on-partition', x.op + ' on hits +' + dh[0] + ' misses +' + dm[0], o);
    }
    res.splits += post[0][SumSequence.COUNTERS.splits] - bufs[0][SumSequence.COUNTERS.splits];
    res.merges += post[0][SumSequence.COUNTERS.merges] - bufs[0][SumSequence.COUNTERS.merges];
    if ((o & 63) === 63) {
      for (const a of [on, off]) {
        const wk = walk(a.snapshot(), { B, dims: DIMS });
        if (wk !== null) return bad('walker', JSON.stringify(wk), o);
      }
      res.walks++;
    }
  }
  for (const a of [on, off]) {
    const wk = walk(a.snapshot(), { B, dims: DIMS });
    if (wk !== null) return bad('walker', JSON.stringify(wk), ops);
  }
  return res;
}

const FO_OPS = 3000;
const FO_TEETH_FLOOR = 50;
const realDrop = (v, NIL) => { v._fl = NIL; v._fb = 0; v._fdepth = 0; };
const foTeeth = [];
const foCov = { 4: {}, 8: {}, 16: {} };

describe('FO finger-off mix (A11-6)', () => {
  for (const B of [4, 8, 16]) {
    for (const seed of [1, 2, 3]) {
      test(`B=${B} seed=${seed}: ${FO_OPS} ops, dropped ops add 0 hits and 1 miss, answers = oracle, walker clean`, () => {
        const r = runCell(B, seed, FO_OPS, realDrop);
        assert.equal(r.fail, null, JSON.stringify(r.fail));
        for (const k in r.cov) foCov[B][k] = (foCov[B][k] || 0) + r.cov[k];
        for (const op of POSITIONAL) for (const s of [':okD', ':okN']) assert.ok((r.cov[op + s] || 0) >= 1, op + s);
        foTeeth.push(`B=${B} seed=${seed}: teeth ${r.teeth}`);
        console.log(`# FO B=${B} seed=${seed}: teeth ${r.teeth} splits ${r.splits} merges ${r.merges} invalid ${r.invalid} kinds ${JSON.stringify(r.kinds)}`);
        assert.ok(r.teeth >= FO_TEETH_FLOOR, `teeth ${r.teeth} < ${FO_TEETH_FLOOR}`);
        assert.ok(r.splits >= 1 && r.merges >= 1, `splits ${r.splits} merges ${r.merges}`);
        assert.ok(r.invalid >= FO_OPS / 100, 'invalid calls ' + r.invalid);
        for (const k of NAMES) assert.ok((r.kinds[k] || 0) >= 1, 'op kind never drawn: ' + k);
      });
    }
    test(`FO coverage B=${B}: every positional op x {okD, okN, thrD, thrN} reached over seeds 1..3`, () => {
      for (const op of POSITIONAL) for (const s of [':okD', ':okN', ':thrD', ':thrN']) assert.ok((foCov[B][op + s] || 0) >= 1, op + s);
    });
  }
  test('must-fail control: the drop replaced by a no-op fails "dropped-op-adds-0-hits"', () => {
    const r = runCell(8, 1, FO_OPS, () => {});
    assert.ok(r.fail !== null, 'driver did not fail with the drop disabled');
    assert.equal(r.fail.name, 'dropped-op-adds-0-hits', JSON.stringify(r.fail));
  });
});
