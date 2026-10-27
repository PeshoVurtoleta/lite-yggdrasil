// test/CursorLane.test.mjs -- the cursor sweep (sweepLane option `cursor`) on the engine adapter at B = 4 / 8, and
// its four wrapper controls (ADR 0005 C-31 RK-6, C-27, C-26, C-46 M-8; PLAN-E0-K ASSERTION 3). K-R2.
//
// The cursor sweep: per BFS state with n <= nSweep, replay the witness once, then for each i in 0..n
// seekIndex(i) and next() until false, then seekSum(0, sumBefore(0, i)) and next() until false, comparing
// (ret, valid, index, entity, offset(0), measure(0)) with Object.is against test/oracle.mjs after every call.
//
// Expected values come from the spec and the oracle, never from engine output. A family costs, per state with n
// elements: n + 1 seeks (i = 0..n); the seek at i < n is followed by n - i next() calls (the last answers false),
// the end seek at i = n by 1 next(); so (n + 1) + n(n + 1)/2 + 1 calls. The sweep runs two families per state
// (seekIndex(i), then seekSum(0, sumBefore(0, i)); every measure is >= 1, so y = sumBefore(0, i) lands on i and
// y = total at i = n is the end). applied = those calls + the witness lengths replayed (a replay op is an
// application in the harness).
// The wrappers patch the view / cursor OBJECTS of the adapter output; no source is patched.
//
// ASCII-only. MIT (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { SumSequence } from '../Yggdrasil.js';
import { engineFactory } from './adapter.mjs';
import { bfsLane, sweepLane, CAPS } from './exhaustive.mjs';

const MISS = SumSequence.COUNTERS.fingerMisses;
const NSWEEP = { 4: CAPS.nSweep[4], 8: CAPS.nSweep[8] - 1 }; // C-31 A12-1: B = 8 runs at nSweep - 1

const memo = new Map();
const bfs = (B) => { if (!memo.has(B)) memo.set(B, bfsLane(engineFactory, { B, nMax: CAPS.nMax[B], cap: CAPS.cap })); return memo.get(B); };
const sweep = (f, B, extra) => sweepLane(f, { B, states: bfs(B).states, nSweep: NSWEEP[B], cap: CAPS.cap, ...extra });

// Wrap every view's cursor() as an OWN property returning a forwarding object; `patch` edits the forwarding object.
function wrapCursor(patch) {
  return (C, o, n, cfg) => {
    const r = engineFactory(C, o, n, cfg);
    for (const v of r.views) {
      const real = v.cursor();
      const w = {
        get valid() { return real.valid; },
        get index() { return real.index; },
        get entity() { return real.entity; },
        offset: (d) => real.offset(d),
        measure: (d) => real.measure(d),
        seekIndex: (i) => real.seekIndex(i),
        seekSum: (d, y) => real.seekSum(d, y),
        next: () => real.next(),
      };
      patch(w, real, v);
      v.cursor = () => w;
    }
    return r;
  };
}

// Spec formula for the call count of the cursor sweep over the states with n <= nSweep (see the header).
function expected(states, nSweep) {
  let ops = 0;
  let replay = 0;
  for (const s of states) {
    if (s.n > nSweep) continue;
    ops += 2 * ((s.n + 1) + (s.n * (s.n + 1)) / 2 + 1);
    replay += s.witness.length;
  }
  return { ops, applied: ops + replay };
}

describe('cursor sweep on the engine (CAPS)', () => {
  for (const B of [4, 8]) {
    test(`B=${B} nSweep ${NSWEEP[B]}: ok, 0 divergences, call count = the spec formula, own counter within 2^18`, () => {
      const r = sweep(engineFactory, B, { cursor: true });
      assert.equal(r.ok, true, JSON.stringify(r.first));
      assert.equal(r.divergences, 0);
      const e = expected(bfs(B).states, NSWEEP[B]);
      assert.equal(r.cursor.ops, e.ops);
      assert.equal(r.cursor.applied, e.applied);
      assert.ok(r.cursor.applied > 0 && r.cursor.applied <= CAPS.cap, 'cursor applied ' + r.cursor.applied);
      console.log(`# cursor sweep B=${B} nSweep=${NSWEEP[B]}: cursor ops ${r.cursor.ops} applied ${r.cursor.applied} (sweep applied ${r.applied})`);
    });
    test(`B=${B}: the cursor option off (default and explicit false) reports no cursor field and the same applied`, () => {
      const a = sweep(engineFactory, B, {});
      const b = sweep(engineFactory, B, { cursor: false });
      assert.equal(a.cursor, undefined);
      assert.equal(b.cursor, undefined);
      assert.equal(a.applied, b.applied);
      assert.equal(a.ok, true);
    });
  }
  test('cursor option: a non-boolean is a RangeError', () => {
    assert.throws(() => sweep(engineFactory, 4, { cursor: 1 }), RangeError);
  });
});

describe('cursor sweep wrapper controls (each must FAIL with its code)', () => {
  test('control: forwarding wrappers with no patch pass (the wrapper itself adds no failure)', () => {
    const r = sweep(wrapCursor(() => {}), 4, { cursor: true });
    assert.equal(r.ok, true, JSON.stringify(r.first));
  });
  for (const B of [4, 8]) {
    test(`B=${B} ORACLE: offset(d) + 1`, () => {
      const r = sweep(wrapCursor((w, real) => { w.offset = (d) => real.offset(d) + 1; }), B, { cursor: true });
      assert.equal(r.ok, false);
      assert.equal(r.first.code, 'ORACLE', JSON.stringify(r.first));
    });
    test(`B=${B} ORACLE: seekSum off by one (y + 1; every measure >= 1 so the landing moves)`, () => {
      const r = sweep(wrapCursor((w, real) => { w.seekSum = (d, y) => real.seekSum(d, y + 1); }), B, { cursor: true });
      assert.equal(r.ok, false);
      assert.equal(r.first.code, 'ORACLE', JSON.stringify(r.first));
      assert.equal(r.first.op, 'seekSum');
    });
    test(`B=${B} C-27: a seek writes the finger (_fl set to the root leaf of a one-leaf view)`, () => {
      const r = sweep(wrapCursor((w, real, v) => {
        w.seekIndex = (i) => {
          const q = real.seekIndex(i);
          if (v._root < 0) { v._fl = v._root; v._fb = 0; v._fdepth = 0; } // a legal finger, so only C-27 can fire
          return q;
        };
      }), B, { cursor: true });
      assert.equal(r.ok, false);
      assert.equal(r.first.code, 'C-27', JSON.stringify(r.first));
      assert.equal(r.first.op, 'seekIndex');
    });
    test(`B=${B} C-26: a seek adds a finger miss`, () => {
      const r = sweep(wrapCursor((w, real, v) => {
        w.seekIndex = (i) => { const q = real.seekIndex(i); v._n[MISS]++; return q; };
      }), B, { cursor: true });
      assert.equal(r.ok, false);
      assert.equal(r.first.code, 'C-26', JSON.stringify(r.first));
      assert.equal(r.first.op, 'seekIndex');
    });
  }
});
