// test/Finger.test.mjs -- part 1 (rung 3 / A-R2): the ENGINE per-op finger lane. ADR 0005 C-1 (finger fields),
// C-2 (seeks are neutral), C-3 (re-home after every positional op; structural op = cold descent to i by the element
// rule `k < count[left]`; a throwing op re-homes nothing), C-5 (NIL / 0 / 0 on a drain), C-25/C-26 (hit / miss
// partition), C-27/C-28 (walker I-9), C-34 (xorshift32 constants), C-35 (MF-1..MF-5, wrappers per RF-3 / A5-18),
// C-4 hits (landed in rung F-R: the core READS the finger for the hit test; C-43 M-1 is retired). Rung A-R3: the
// lane covers underflowing removes too (merge / equalize = structural: cold descent to min(i, length-1) over the post
// state; drain = NIL / 0 / 0 with _fpath kept).
//
// Oracle independence: the model is two plain arrays per view; the expected finger (leaf ref, fb, depth, path) is
// computed by this file's own root-to-leaf descent over a deep-copied snapshot, never by the engine's descent.
// Row numbers (13|4, 8|8, 5 vs 7, 14 vs 13) are quoted from C-35. Controls are state-restore wrappers that rewrite
// the view's own finger fields around the correct build (no source patch, RF-3). ASCII only.

import { test as nodeTest } from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { SumSequence } from '../Yggdrasil.js';
import { engineFactory } from './adapter.mjs';
import { walk } from './walker.mjs';
import { buildMutant } from './mutant-build.mjs';
import { a1Stream } from './a1-lane.mjs';

const CN = SumSequence.COUNTERS;

// Source-mutant plumbing (rung F-R Phase 2). In a mutant CHILD process (env YG_FINGER_CHILD = JSON spec) no test is
// registered; the module builds the patched engine, points FACT / SEQ at it and runs ONE named row (ROWS), then exits
// 0 = row passed, 3 = AssertionError (killed), 4 = anchor count mismatch, 5 = other throw, 6 = unknown row.
const CHILD = process.env.YG_FINGER_CHILD || '';
const test = CHILD ? () => {} : nodeTest;
const ROWS = {};
function rowTest(key, title, fn) { ROWS[key] = fn; test(title, fn); }
let FACT = engineFactory;
let SEQ = SumSequence;

class Fail {
  constructor(cls, msg) { this.cls = cls; this.msg = msg; }
}

// 32-bit xorshift (C-34): x^=x<<13; x^=x>>>17; x^=x<<5; x>>>0.
function xs(seed) {
  let x = seed >>> 0;
  if (x === 0) x = 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x; };
}

// Root-to-leaf descent by the element rule over snapshot s, view vi, element index k.
function descend(s, vi, k) {
  const vw = s.views[vi];
  let ref = vw._root;
  let fb = 0;
  const path = [];
  while (ref >= 0) {
    path.push(ref);
    const l = s.int.left[ref];
    const cl = l < 0 ? s.leaf.len[~l] : s.int.count[l];
    if (k < cl) ref = l;
    else { fb += cl; k -= cl; ref = s.int.right[ref]; }
  }
  return { fl: ref, fb, depth: path.length, path };
}

function fingerOf(vw) {
  return { fl: vw._fl, fb: vw._fb, depth: vw._fdepth, path: Array.from(vw._fpath) };
}

function setFinger(vw, f) {
  vw._fl = f.fl; vw._fb = f.fb; vw._fdepth = f.depth;
  for (let k = 0; k < f.depth; k++) vw._fpath[k] = f.path[k];
}

function leafLens(s, vi) {
  const out = [];
  const st = [s.views[vi]._root];
  while (st.length) {
    const r = st.pop();
    if (r < 0) out.push(s.leaf.len[~r]);
    else { st.push(s.int.right[r]); st.push(s.int.left[r]); }
  }
  return out;
}

const json = (x) => JSON.stringify(x, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v));

// The C-4 hit model (ADR 0005 C-4), written from the rule and never from the engine. F = the PRE-op finger, len = the
// finger leaf's length. fl === NIL is always a miss. insertAt: the range test lo < i <= fb+len with the first leaf
// (fb 0) opening at 0 (lo = -1) and every other leaf at fb (lo = fb), and len < B (a full leaf splits). removeAt:
// fb <= i < fb+len and len > (single-leaf view ? 1 : m). setMeasure / getMeasure / entityAt: fb <= i < fb+len.
function modelHit(name, i, F, len, NIL, B, m) {
  if (F.fl === NIL) return false;
  if (name === 'insertAt') {
    const lo = F.fb === 0 ? -1 : F.fb;
    return lo < i && i <= F.fb + len && len < B;
  }
  if (!(F.fb <= i && i < F.fb + len)) return false;
  if (name === 'removeAt') return len > (F.depth === 0 ? 1 : m);
  return true;
}

// One configured run: arena of 2 views, B, wrapper. Every op goes through R.op().
function newRun(B, wrap, C, factory) {
  const f = (factory || engineFactory)(C || 256, { leafSize: B, dims: 1 }, 2);
  const NIL = f.snapshot().NIL; // read from a fresh view, never hardcoded
  const R = {
    f, B, m: B >> 2, NIL, wrap, C: C || 256,
    ent: [[], []], mea: [[], []], cE: 1,
    stats: { hit: 0, miss: 0, ins: 0, rem: 0, rd: 0, seek: 0, skip: 0, splits: 0, rstruct: 0, drains: 0, multi: 0, nilSeen: 0 },
    cn: new Int32Array(12), cn2: new Int32Array(12),
  };
  R.chk = (cond, cls, msg) => { if (!cond) throw new Fail(cls, msg); };
  R.cmpFinger = (vi, exp, tag) => {
    const v = f.views[vi];
    const got = fingerOf(v);
    R.chk(got.fl === exp.fl, 're-home', tag + ' _fl ' + got.fl + ' exp ' + exp.fl);
    R.chk(got.fb === exp.fb, 're-home', tag + ' _fb ' + got.fb + ' exp ' + exp.fb);
    R.chk(got.depth === exp.depth, 're-home', tag + ' _fdepth ' + got.depth + ' exp ' + exp.depth);
    for (let k = 0; k < exp.depth; k++) {
      R.chk(got.path[k] === exp.path[k], 're-home', tag + ' _fpath[' + k + '] ' + got.path[k] + ' exp ' + exp.path[k]);
    }
  };
  // kind: 'ins' | 'rem' | 'rd' (getMeasure / entityAt / setMeasure) | 'seek' ; run(v) performs the engine call.
  R.op = (vi, kind, i, name, run, modelApply) => {
    const v = f.views[vi];
    const pre = f.snapshot();
    const preJ = json(pre);
    const preF = fingerOf(v);
    const n = v._len;
    v.readCounters(R.cn);
    const hits0 = R.cn[CN.fingerHits];
    const miss0 = R.cn[CN.fingerMisses];
    const spl0 = R.cn[CN.splits];
    const tou0 = R.cn[CN.touches];
    const pul0 = R.cn[CN.pulls];
    const eqm0 = R.cn[CN.merges] + R.cn[CN.equalizes] + R.cn[CN.splits];
    // C-4 model, from the PRE-op finger and the finger leaf's length (independent of the engine)
    const lenF = preF.fl === NIL ? 0 : pre.leaf.len[~preF.fl];
    const hit = kind !== 'seek' && modelHit(name, i, preF, lenF, NIL, B, R.m) ? 1 : 0;
    const mrg0 = R.cn[CN.merges] + R.cn[CN.equalizes];
    run(v);
    if (modelApply) modelApply();
    v.readCounters(R.cn2);
    const dh = R.cn2[CN.fingerHits] - hits0;
    const dm = R.cn2[CN.fingerMisses] - miss0;
    const drained = kind === 'rem' && n === 1;
    // structural: a split (insert) or a merge / equalize (remove, not the drain), read from the spec'd counters
    const structural = (kind === 'ins' && R.cn2[CN.splits] - spl0 > 0) ||
      (kind === 'rem' && !drained && R.cn2[CN.merges] + R.cn2[CN.equalizes] - mrg0 > 0);
    if (structural && kind === 'ins') R.stats.splits++;
    if (structural && kind === 'rem') R.stats.rstruct++;
    if (R.wrap) {
      R.wrap({ v, vi, kind, i, n, pre, preF, structural, drained, snap: f.snapshot, descend });
    }
    const post = f.snapshot();
    const tag = name + '(' + i + ') n=' + n + ': ';
    // counters: M-1 + C-26
    R.chk(dh === hit, 'hit', tag + 'fingerHits delta ' + dh + ' exp ' + hit + ' (C-4 model)');
    R.chk(dm === (kind === 'seek' ? 0 : 1 - hit), 'miss', tag + 'fingerMisses delta ' + dm + ' exp ' + (kind === 'seek' ? 0 : 1 - hit));
    if (hit) {
      // C-25: a hit adds 0 touches; C-20: a hit mutation is ONE pull pass (pulls == _fdepth), a read pulls 0;
      // a hit is never structural
      R.chk(R.cn2[CN.touches] - tou0 === 0, 'touches', tag + 'hit touches delta ' + (R.cn2[CN.touches] - tou0));
      const wantP = (name === 'getMeasure' || name === 'entityAt') ? 0 : preF.depth;
      R.chk(R.cn2[CN.pulls] - pul0 === wantP, 'pulls', tag + 'hit pulls delta ' + (R.cn2[CN.pulls] - pul0) + ' exp ' + wantP);
      R.chk(R.cn2[CN.merges] + R.cn2[CN.equalizes] + R.cn2[CN.splits] - eqm0 === 0, 'structural', tag + 'a hit changed the tree shape');
      R.stats.hit++;
    } else if (kind !== 'seek') R.stats.miss++;
    // other view untouched
    const o = 1 - vi;
    R.chk(json(pre.views[o]) === json(post.views[o]), 'other', tag + 'the other view changed');
    // finger
    if (kind === 'seek') {
      const after = fingerOf(v);
      R.chk(json(after) === json(preF), 'neutral', tag + 'seek moved the finger (C-2)');
    } else if (kind === 'rem' && drained) {
      R.chk(v._len === 0, 'nil', tag + 'length not 0');
      R.chk(v._fl === NIL && v._fb === 0 && v._fdepth === 0, 'nil',
        tag + 'drain finger ' + v._fl + '/' + v._fb + '/' + v._fdepth + ' exp ' + NIL + '/0/0 (C-5)');
      R.stats.nilSeen++;
    } else if (hit) {
      R.cmpFinger(vi, preF, tag + 'hit leaves the finger unchanged (C-3): ');
    } else if (kind === 'ins') {
      R.cmpFinger(vi, descend(post, vi, i), tag);
    } else if (kind === 'rem') {
      // C-3: structural remove (merge / equalize) = cold descent to min(i, length-1) over the post state;
      // non-structural = the touched leaf, tree shape unchanged
      if (structural) R.cmpFinger(vi, descend(post, vi, Math.min(i, n - 2)), tag);
      else R.cmpFinger(vi, descend(pre, vi, i), tag);
    } else {
      R.cmpFinger(vi, descend(post, vi, i), tag);
    }
    const wr = walk(post, { B, dims: 1 });
    R.chk(wr === null, 'walker', tag + 'walker ' + (wr && wr.code + ' ' + wr.detail));
    if (post.views[vi]._root >= 0 && post.views[vi]._root !== post.EMPTY_ROOT) R.stats.multi++;
  };
  return R;
}

const C = (R, vi) => R.f.views[vi];

function doIns(R, vi, i, e, mm) {
  R.op(vi, 'ins', i, 'insertAt', (v) => v.insertAt(i, e, mm), () => { R.ent[vi].splice(i, 0, e); R.mea[vi].splice(i, 0, mm); });
  R.stats.ins++;
}
function doRem(R, vi, i) {
  R.op(vi, 'rem', i, 'removeAt', (v) => R.chk(v.removeAt(i) === R.ent[vi][i], 'value', 'removeAt(' + i + ') entity'), () => { R.ent[vi].splice(i, 1); R.mea[vi].splice(i, 1); });
  R.stats.rem++;
}

function mixStream(R, seed, N) {
  const rOp = xs((0x9E3779B9 ^ seed) >>> 0);
  const rIdx = xs((0x85EBCA6B ^ seed) >>> 0);
  const rMea = xs((0xC2B2AE35 ^ seed) >>> 0);
  let last = 0;
  const grow = [61, 16, 4, 4, 4, 4, 4, 3]; // ins rem set get ent seekSum seekIdx -> 3 spare folded into ins
  const drain = [16, 61, 4, 4, 4, 4, 4, 3];
  for (let op = 0; op < N; op++) {
    const w = (Math.floor(op / 500) & 1) === 0 ? grow : drain;
    let cls;
    let vi;
    let n;
    for (;;) {
      const c100 = rOp() % 100;
      vi = rOp() & 1;
      let a = 0;
      cls = 0;
      let acc = w[0];
      while (c100 >= acc && cls < 7) { cls++; acc += w[cls]; }
      cls = cls === 7 ? 0 : cls; // the 3 spare points are insertAt
      n = C(R, vi)._len;
      const live = R.ent[0].length + R.ent[1].length;
      if (cls === 0) { if (live >= R.C) continue; } else if (cls <= 4 && n === 0) continue;
      break;
    }
    const range = cls === 0 || cls === 6 ? n + 1 : n;
    const r = rIdx();
    const i = range === 0 ? 0 : ((r & 1) ? Math.max(0, Math.min(range - 1, last + (((r >>> 1) % 3) - 1))) : ((r >>> 1) % range));
    const rm = rMea();
    const mm = ((rm >>> 16) % 20) === 0 ? 0 : rm % 1000;
    last = i;
    if (cls === 0) doIns(R, vi, i, R.cE++, mm);
    else if (cls === 1) {
      doRem(R, vi, i);
    } else if (cls === 2) {
      R.op(vi, 'rd', i, 'setMeasure', (v) => v.setMeasure(i, 0, mm), () => { R.mea[vi][i] = mm; });
      R.stats.rd++;
    } else if (cls === 3) {
      R.op(vi, 'rd', i, 'getMeasure', (v) => R.chk(v.getMeasure(i, 0) === R.mea[vi][i], 'value', 'getMeasure(' + i + ')'));
      R.stats.rd++;
    } else if (cls === 4) {
      R.op(vi, 'rd', i, 'entityAt', (v) => R.chk(v.entityAt(i) === R.ent[vi][i], 'value', 'entityAt(' + i + ')'));
      R.stats.rd++;
    } else if (cls === 5) {
      const tot = R.mea[vi].reduce((a, b) => a + b, 0);
      const y = rm % (tot + 1);
      let exp = R.mea[vi].length; // smallest k with prefix(k) + m_k > y, else length (M-7)
      let acc = 0;
      for (let k = 0; k < R.mea[vi].length; k++) { if (acc + R.mea[vi][k] > y) { exp = k; break; } acc += R.mea[vi][k]; }
      R.op(vi, 'seek', y, 'indexAtSum', (v) => R.chk(v.indexAtSum(0, y) === exp, 'value', 'indexAtSum(' + y + ') exp ' + exp));
      R.stats.seek++;
    } else {
      let exp = 0;
      for (let k = 0; k < i; k++) exp += R.mea[vi][k];
      R.op(vi, 'seek', i, 'sumBefore', (v) => R.chk(v.sumBefore(0, i) === exp, 'value', 'sumBefore(' + i + ') exp ' + exp));
      R.stats.seek++;
    }
  }
}

// Drain row: fill B elements (one leaf, no split), remove every one; the last remove writes NIL / 0 / 0 (C-5).
function drainRow(R, vi) {
  for (let k = 0; k < R.B; k++) doIns(R, vi, k, R.cE++, k + 1);
  while (C(R, vi)._len > 0) doRem(R, vi, C(R, vi)._len >> 1);
  R.stats.drains++;
}

const RSTRUCT_FLOOR = 5;
const CFGS = [];
for (const B of [4, 8, 16]) for (const seed of [1, 2, 3]) CFGS.push({ B, seed });

// Runs the whole lane under a wrapper; returns null or the FIRST Fail, plus stats.
function runLane(wrap, cfgs, N, factory) {
  const stats = [];
  for (const { B, seed } of cfgs) {
    const R = newRun(B, wrap, 0, factory);
    try {
      mixStream(R, seed, N);
      const D = newRun(B, wrap, 0, factory); // drain rows need fresh, empty views
      drainRow(D, 0);
      drainRow(D, 1);
      R.stats.nilSeen += D.stats.nilSeen;
      R.stats.drains += D.stats.drains;
    } catch (e) {
      if (e instanceof Fail) return { fail: e, B, seed, stats };
      throw e;
    }
    stats.push({ B, seed, ...R.stats });
  }
  return { fail: null, stats };
}

// ---------------------------------------------------------------------------------------------------------------
// The lane

test('Finger lane: B 4 / 8 / 16 x seeds 1..3, 2000 ops each, every op checked (C-1, C-2, C-3, C-4, C-5, C-26)', () => {
  const rep = runLane(null, CFGS, 2000);
  assert.equal(rep.fail, null, rep.fail && ('B=' + rep.B + ' seed=' + rep.seed + ' [' + rep.fail.cls + '] ' + rep.fail.msg));
  for (const s of rep.stats) {
    const tag = 'B=' + s.B + ' seed=' + s.seed;
    // coverage floors (conservative; ~770 inserts per stream, leaves of >= B/4 -> many splits)
    assert.ok(s.hit >= 150, tag + ' hits ' + s.hit); // coverage floors for the C-4 model rows of the lane
    assert.ok(s.miss >= 150, tag + ' misses ' + s.miss);
    assert.ok(s.ins >= 300, tag + ' inserts ' + s.ins);
    assert.ok(s.splits >= 10, tag + ' structural inserts ' + s.splits);
    assert.ok(s.rem >= 30, tag + ' removes ' + s.rem);
    assert.ok(s.rstruct >= RSTRUCT_FLOOR, tag + ' structural removes (merge / equalize) ' + s.rstruct);
    assert.equal(s.skip, 0, tag + ' no op is skipped any more');
    assert.ok(s.rd >= 60, tag + ' reads/sets ' + s.rd);
    assert.ok(s.seek >= 60, tag + ' seeks ' + s.seek);
    assert.ok(s.multi >= 500, tag + ' multi-leaf post-op states ' + s.multi);
    assert.ok(s.nilSeen >= 2, tag + ' drain NIL checks ' + s.nilSeen); // the 2 drain rows each end in one NIL
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Rows

test('Finger row: the first insert on a fresh view homes (leaf, 0, depth 0); NIL read from a fresh view', () => {
  const f = engineFactory(64, { leafSize: 4, dims: 1 }, 1);
  const v = f.views[0];
  const NIL = f.snapshot().NIL;
  assert.equal(v._fl, NIL);
  v.insertAt(0, 5, 3);
  const s = f.snapshot();
  assert.equal(v._root < 0, true);
  assert.equal(v._fl, v._root);
  assert.equal(v._fb, 0);
  assert.equal(v._fdepth, 0);
  assert.equal(walk(s, { B: 4, dims: 1 }), null);
});

test('Finger row: C-35 MF-2 row, B=16, 17 appends -> 13|4, finger at the new leaf (fb 13); removeAt(0) re-homes to leaf 0; entityAt(13) = 14', () => {
  const f = engineFactory(64, { leafSize: 16, dims: 1 }, 1);
  const v = f.views[0];
  for (let k = 0; k < 17; k++) v.insertAt(k, k, k + 1);
  let s = f.snapshot();
  assert.deepEqual(leafLens(s, 0), [13, 4]); // C-35: 13|4
  assert.equal(v._fb, 13);
  const d16 = descend(s, 0, 16);
  assert.equal(v._fl, d16.fl);
  assert.equal(v._fdepth, 1);
  assert.equal(v._fpath[0], d16.path[0]);
  v.removeAt(0);
  s = f.snapshot();
  const d0 = descend(s, 0, 0);
  assert.equal(v._fl, d0.fl);
  assert.equal(v._fb, 0);
  assert.equal(v._fdepth, 1);
  assert.equal(v.entityAt(13), 14); // entity i at index i; after removeAt(0) index 13 holds entity 14
  assert.equal(walk(f.snapshot(), { B: 16, dims: 1 }), null);
});

test('Finger row: C-35 MF-1 row, B=8, 9 appends of measure 10 (7|2): indexAtSum(0,75) = 7; setMeasure(0,0,30) -> 5; seeks are neutral', () => {
  const f = engineFactory(64, { leafSize: 8, dims: 1 }, 1);
  const v = f.views[0];
  for (let k = 0; k < 9; k++) v.insertAt(k, k, 10);
  assert.deepEqual(leafLens(f.snapshot(), 0), [7, 2]);
  assert.equal(v.indexAtSum(0, 75), 7);
  v.setMeasure(0, 0, 30);
  const before = fingerOf(v);
  const d0 = descend(f.snapshot(), 0, 0);
  assert.equal(before.fl, d0.fl);
  assert.equal(before.fb, 0);
  assert.equal(v.indexAtSum(0, 75), 5); // 30,40,50,60,70 reach 70 <= 75; the 6th passes 75
  assert.deepEqual(fingerOf(v), before);
  assert.equal(v.sumBefore(0, 9), 110);
  assert.deepEqual(fingerOf(v), before);
});

for (const B of [4, 8, 16]) {
  test('Finger row (RF-1, C-3, C-10): a headroom RangeError from setMeasure leaves all 4 finger fields unchanged, B=' + B, () => {
    const f = engineFactory(256, { leafSize: B, dims: 1 }, 1);
    const v = f.views[0];
    const MAXV = 9007199254740991;
    const n = 3 * B;
    v.insertAt(0, 0, MAXV - 100);
    for (let k = 1; k < n; k++) v.insertAt(k, k, 1); // total MAX - 100 + (n - 1) < MAX
    assert.ok(v._root >= 0, 'multi-leaf view');
    v.getMeasure(n - 1, 0); // home the finger far from index 0
    const before = fingerOf(v);
    const bj = json(before);
    const cnt = new Int32Array(12);
    v.readCounters(cnt);
    const c0 = cnt.slice();
    // total - m_old + new = MAX - 100 + (n-1) - 1 + (MAX - 5) > MAX
    assert.throws(() => v.setMeasure(1, 0, MAXV - 5), (e) => e instanceof RangeError && /headroom/.test(e.message));
    assert.equal(json(fingerOf(v)), bj);
    v.readCounters(cnt);
    assert.deepEqual(Array.from(cnt), Array.from(c0)); // a throwing op counts nothing
    assert.equal(walk(f.snapshot(), { B, dims: 1 }), null);
  });
}

// C-3 throwing-op row (A-R3 form): the underflow throw is gone, so the teeth move to the throws that remain: a bad index
// or measure on a multi-leaf view with the finger in the OTHER root subtree. _fl, _fb, _fdepth and the whole _fpath
// (every slot) are byte-identical, and no counter moves. The pool throw is exempt (R-P1 / R-P2) and has its row in
// Core.test.
function expectThrowIdentical(v, fn, tag) {
  const before = json(fingerOf(v)) + json(Array.from(v._fpath));
  const cnt = new Int32Array(12);
  v.readCounters(cnt);
  const c0 = cnt.slice();
  let threw = false;
  try { fn(); } catch (e) { threw = e instanceof RangeError; if (!threw) throw e; }
  assert.ok(threw, tag + ': must throw RangeError');
  assert.equal(json(fingerOf(v)) + json(Array.from(v._fpath)), before, tag + ': finger fields / _fpath changed on a throw');
  v.readCounters(cnt);
  assert.deepEqual(Array.from(cnt), Array.from(c0), tag + ': a throwing op counts nothing');
}

for (const B of [4, 8, 16]) {
  test('Finger row (C-3): throwing removeAt / insertAt / setMeasure on a multi-leaf view re-home nothing, B=' + B, () => {
    const f = engineFactory(256, { leafSize: B, dims: 1 }, 1);
    const v = f.views[0];
    const n = 3 * B;
    for (let k = 0; k < n; k++) v.insertAt(k, k, k + 1);
    assert.ok(v._root >= 0, 'multi-leaf view');
    const bad = [
      ['removeAt(n)', () => v.removeAt(n)],
      ['removeAt(-1)', () => v.removeAt(-1)],
      ['removeAt(1.5)', () => v.removeAt(1.5)],
      ['insertAt(n + 1)', () => v.insertAt(n + 1, 1, 1)],
      ['insertAt bad measure', () => v.insertAt(0, 1, -1)],
      ['setMeasure(n)', () => v.setMeasure(n, 0, 1)],
      ['setMeasure bad measure', () => v.setMeasure(0, 0, 1.5)],
    ];
    for (const [tag, fn] of bad) {
      // finger far from the touched side: home it at the last element, then at the first, then throw
      v.getMeasure(n - 1, 0);
      expectThrowIdentical(v, fn, tag + ' (finger last)');
      v.getMeasure(0, 0);
      expectThrowIdentical(v, fn, tag + ' (finger first)');
    }
    assert.equal(walk(f.snapshot(), { B, dims: 1 }), null);
  });
}

// Must-fail control: expectThrowIdentical must catch a throwing op that re-homes first. The faulty op rewrites one
// finger field, then throws; each of fl / fb / fdepth / fpath must be caught on its own (state-restore, no source patch).
test('Finger control: a throw that re-homes before throwing is caught on each of _fl, _fb, _fdepth, _fpath', () => {
  const f = engineFactory(256, { leafSize: 4, dims: 1 }, 1);
  const v = f.views[0];
  for (let k = 0; k < 12; k++) v.insertAt(k, k, 1);
  assert.ok(v._root >= 0 && v._fdepth >= 1);
  const faults = {
    fl: () => { v._fl = v._fl === 0 ? 1 : 0; },
    fb: () => { v._fb += 1; },
    fdepth: () => { v._fdepth -= 1; },
    fpath: () => { v._fpath[0] = v._fpath[0] + 1; },
  };
  for (const name of Object.keys(faults)) {
    v.getMeasure(11, 0);
    const keep = { ...fingerOf(v) };
    const keepPath = Int32Array.from(v._fpath);
    assert.throws(() => expectThrowIdentical(v, () => { faults[name](); throw new RangeError('index fault'); }, name),
      assert.AssertionError, name + ' fault must be caught');
    setFinger(v, keep);
    v._fpath.set(keepPath);
  }
  // the control is sound: a clean throw passes
  expectThrowIdentical(v, () => v.removeAt(99), 'clean');
});

test('Finger row: C-35 MF-4, B=16, 17 appends, removeAt(16) -> 8|8 (true fb 8); removeAt(14) returns 14; finger per C-3', () => {
  const f = engineFactory(64, { leafSize: 16, dims: 1 }, 1);
  const v = f.views[0];
  for (let k = 0; k < 17; k++) v.insertAt(k, k, k + 1);
  assert.equal(v.removeAt(16), 16); // entity i at index i
  let s = f.snapshot();
  assert.deepEqual(leafLens(s, 0), [8, 8]);
  // structural: cold descent to min(16, length - 1) = 15, which lives in the right leaf (fb 8, depth 1)
  const d15 = descend(s, 0, 15);
  assert.equal(d15.fb, 8);
  assert.equal(v._fl, d15.fl);
  assert.equal(v._fb, 8);
  assert.equal(v._fdepth, 1);
  assert.equal(v._fpath[0], d15.path[0]);
  assert.equal(v.removeAt(14), 14);
  s = f.snapshot();
  assert.deepEqual(leafLens(s, 0), [8, 7]); // 14 sits in the right leaf (8..15), len 8 > m: non-structural
  const d14 = descend(s, 0, 14); // non-structural: the touched leaf is the right leaf, which still holds index 14 of 15
  assert.equal(v._fb, 8);
  assert.equal(v._fl, d14.fl);
  assert.equal(walk(s, { B: 16, dims: 1 }), null);
});

// Drain of a multi-leaf view: remove the last element until empty. The final remove writes NIL / 0 / 0 and leaves
// _fpath contents exactly as they were before it (C-3 "_fpath kept").
test('Finger row: draining a multi-leaf view ends at _fl NIL, _fb 0, _fdepth 0, _fpath unchanged by the last remove', () => {
  for (const B of [4, 8, 16]) {
    const f = engineFactory(64, { leafSize: B, dims: 1 }, 1);
    const v = f.views[0];
    const NIL = f.snapshot().NIL;
    const n = 2 * B + 1;
    for (let k = 0; k < n; k++) v.insertAt(k, k, 1);
    assert.ok(v._root >= 0, 'multi-leaf start');
    while (v._len > 1) {
      const last = v._len - 1; // entity i sits at index i
      assert.equal(v.removeAt(last), last);
      assert.equal(walk(f.snapshot(), { B, dims: 1 }), null);
    }
    const pathBefore = Int32Array.from(v._fpath);
    assert.equal(v.removeAt(0), 0);
    assert.equal(v._len, 0);
    assert.equal(v._fl, NIL);
    assert.equal(v._fb, 0);
    assert.equal(v._fdepth, 0);
    assert.deepEqual(Array.from(v._fpath), Array.from(pathBefore));
    assert.equal(walk(f.snapshot(), { B, dims: 1 }), null);
  }
});

// Merge row: B=16, 17 appends (13|4); nine removeAt(0) leave 4|4... (13 -> 4 in leaf 0, total 8); the tenth removeAt(0)
// underflows leaf 0 (3 < m = 4) with total 7 <= B, a merge that deletes one of the two leaves (spec: merge frees one).
// The finger is homed on leaf 0 (variant A) or on leaf 1 (variant B) first; whichever leaf the merge frees, the finger
// ends on a live leaf (walker I-9) and equals the cold descent to index 0 of the post state. Across both variants the
// old finger leaf must be the freed one at least once, or the row would not test the deleted-finger case.
test('Finger row: a merge that deletes the finger\'s old leaf re-homes onto a live leaf (I-9, descent to min(i, length-1))', () => {
  let deletedSeen = 0;
  for (const variant of ['leaf0', 'leaf1']) {
    const f = engineFactory(64, { leafSize: 16, dims: 1 }, 1);
    const v = f.views[0];
    const cnt = new Int32Array(12);
    for (let k = 0; k < 17; k++) v.insertAt(k, k, 1);
    for (let k = 0; k < 9; k++) assert.equal(v.removeAt(0), k);
    assert.deepEqual(leafLens(f.snapshot(), 0), [4, 4]);
    if (variant === 'leaf1') v.getMeasure(7, 0); else v.getMeasure(0, 0);
    const preFl = v._fl;
    v.readCounters(cnt);
    const m0 = cnt[CN.merges];
    assert.equal(v.removeAt(0), 9);
    v.readCounters(cnt);
    assert.equal(cnt[CN.merges] - m0, 1, variant + ': the tenth remove is a merge');
    const s = f.snapshot();
    assert.equal(v._len, 7);
    assert.deepEqual(leafLens(s, 0), [7]);
    const d = descend(s, 0, 0);
    assert.equal(v._fl, d.fl);
    assert.equal(v._fb, 0);
    assert.equal(v._fdepth, d.depth);
    assert.equal(walk(s, { B: 16, dims: 1 }), null, variant + ': walker I-9');
    if (preFl !== v._fl) deletedSeen++;
  }
  assert.ok(deletedSeen >= 1, 'the freed leaf was the old finger leaf in at least one variant');
});

// ---------------------------------------------------------------------------------------------------------------
// Controls: each wraps the CORRECT build, rewriting the view's own finger fields after the op (RF-3), and must make
// the lane FAIL with its own class.

function control(name, wrap, cls, N) {
  test('Finger control: ' + name + ' -> lane FAILS with class "' + cls + '"', () => {
    const clean = runLane(null, [{ B: 4, seed: 1 }], N);
    assert.equal(clean.fail, null, 'the unwrapped build must pass (a control is meaningless otherwise)');
    const rep = runLane(wrap, CFGS, N);
    assert.ok(rep.fail, 'the wrapped build must be caught');
    assert.equal(rep.fail.cls, cls, rep.fail.msg);
  });
}

// rule-1 re-home (MF-4's reading, C-35): after a structural insert, re-home to the touched leaf with its pre-op fb / path.
control('rule-1 re-home (structural op re-homes to the touched leaf, pre-op fb and path)', (c) => {
  if (c.kind !== 'ins' || !c.structural) return;
  const d = c.descend(c.pre, c.vi, Math.min(c.i, c.n - 1));
  setFinger(c.v, { fl: d.fl, fb: d.fb, depth: d.depth, path: d.path });
}, 're-home', 600);

// a seek writes the finger (C-2): re-home to the leaf holding the answer index
control('seek writes the finger (re-home to the sought element)', (c) => {
  if (c.kind !== 'seek' || c.n === 0) return;
  const d = c.descend(c.snap(), c.vi, c.n - 1);
  setFinger(c.v, { fl: d.fl, fb: d.fb, depth: d.depth, path: d.path });
}, 'neutral', 600);

// MF-4 (remove side): a structural remove (merge / equalize) without re-home keeps the pre-op finger
control('MF-4 a structural remove keeps the pre-op finger', (c) => {
  if (c.kind !== 'rem' || !c.structural) return;
  setFinger(c.v, c.preF);
}, 're-home', 2000);

// MF-3: a drain keeps the finger (C-35, C-28 a/b)
control('MF-3 a drain keeps the finger', (c) => {
  if (!c.drained) return;
  setFinger(c.v, c.preF);
}, 'nil', 600);

// MF-2: a miss keeps the finger (restore the pre-op finger after every positional op)
control('MF-2 a miss keeps the finger', (c) => {
  if (c.kind === 'seek') return;
  setFinger(c.v, c.preF);
}, 're-home', 600);

// ---------------------------------------------------------------------------------------------------------------
// Boundary rows: after a SPLIT the C-3 structural re-home is the element rule (0005 A4-10 (a)): the finger leaf
// must HOLD element i (a boundary insert is where `<` vs `<=` differ).

// B=4, 5 appends: the 5th splits [0,1,2,3] + element 4. By the 13|4 pattern (right leaf = m = B/4 elements, here 1)
// the leaves are 4|1; element 4 is the only element of leaf 1, so fb must be 4, depth 1.
function appendRow(Y) {
  const f = (Y ? mutantFactory(Y) : engineFactory)(64, { leafSize: 4, dims: 1 }, 1);
  const v = f.views[0];
  for (let k = 0; k < 5; k++) v.insertAt(k, k, 1);
  const s = f.snapshot();
  assert.deepEqual(leafLens(s, 0), [4, 1]);
  const d = descend(s, 0, 4);
  assert.equal(d.fb, 4);
  assert.equal(v._fl, d.fl, 'finger leaf holds element 4');
  assert.equal(v._fb, 4);
  assert.equal(v._fdepth, 1);
  assert.equal(v._fpath[0], d.path[0]);
}
test('Finger row: B=4, 5 appends -> 4|1, finger on the leaf holding element 4 with _fb 4 (element rule after a split)', () => appendRow(null));

// Second boundary row: B=4, [0..3] then insertAt(4) split, then insertAt(5) fills leaf 1 (len 2), ... fill leaf 1 to
// B (elements 4..7, no split), the next append (index 8) splits leaf 1 = 4 + 1 in the same way: leaves [4,3,2]?
// Spec-only claim used here: the finger leaf holds the inserted LAST element and _fb = n - (its leaf length).
test('Finger row: B=4, 12 appends, after every append the finger leaf holds the last element', () => {
  const f = engineFactory(64, { leafSize: 4, dims: 1 }, 1);
  const v = f.views[0];
  for (let k = 0; k < 12; k++) {
    v.insertAt(k, k, 1);
    const s = f.snapshot();
    const d = descend(s, 0, k);
    assert.equal(v._fl, d.fl, 'append ' + k);
    assert.equal(v._fb, d.fb);
    assert.equal(v._fdepth, d.depth);
    for (let q = 0; q < d.depth; q++) assert.equal(v._fpath[q], d.path[q]);
    assert.equal(d.fb + s.leaf.len[~d.fl], k + 1, 'the holding leaf ends at the last element');
  }
});

// Source mutant (RF-3 allows wrappers; this one is a source patch via buildMutant): the structural re-home compare
// `if (q < c) {` -> `if (q <= c) {` sends a boundary index to the left child. The anchor is unique in Yggdrasil.js.
function mutantFactory(M) {
  return (Cc, o, count) => {
    const views = M.SumSequence.arena(Cc, o, count);
    const v0 = views[0];
    const NIL = v0._fl;
    const EMPTY_ROOT = v0._root;
    const ar = v0._ar;
    function snapshot() {
      const hdr = v0._hdr;
      const leaf = { size: ar.Lmax, bump: hdr[1], free: hdr[2], next: v0._lnext.slice(), len: v0._llen.slice(), ent: v0._ent.slice(), meas: [] };
      const int = { size: ar.Lmax - 1, bump: hdr[3], free: hdr[4], next: v0._inext.slice(), left: v0._left.slice(), right: v0._right.slice(), weight: v0._weight.slice(), count: v0._count.slice(), sum: [] };
      for (let d = 0; d < ar.dims; d++) { leaf.meas.push(v0._meas[d].slice()); int.sum.push(v0._sums[d].slice()); }
      const vs = views.map((w) => ({ _root: w._root, _len: w._len, _fl: w._fl, _fb: w._fb, _fdepth: w._fdepth, _fpath: new Int32Array(w._fpath), _cv: w._cv }));
      return { C: ar.C, B: ar.B, dims: ar.dims, NIL, EMPTY_ROOT, live: hdr[0], int, leaf, views: vs };
    }
    return { views, snapshot };
  };
}

test('Finger mutant: `if (q < c) {` -> `if (q <= c) {` is killed by the lane and by the 5-append row', async () => {
  const M = await buildMutant(new URL('../Yggdrasil.js', import.meta.url).pathname, [['if (q < c) {', 'if (q <= c) {', 1]]);
  try {
    // the unpatched source through the same factory passes (the mutant factory itself is sound)
    const ok = await buildMutant(new URL('../Yggdrasil.js', import.meta.url).pathname, [['if (q < c) {', 'if (q < c) {', 1]]);
    try {
      assert.equal(runLane(null, [{ B: 4, seed: 1 }], 600, mutantFactory(ok)).fail, null);
      appendRow(ok);
    } finally { ok.cleanup(); }
    const rep = runLane(null, CFGS, 2000, mutantFactory(M));
    assert.ok(rep.fail, 'the lane kills the <= mutant');
    assert.equal(rep.fail.cls, 're-home');
    assert.throws(() => appendRow(M), /finger leaf holds element 4|Expected values/);
  } finally { M.cleanup(); }
});

// ---------------------------------------------------------------------------------------------------------------
// Rung F-R full surface (C-4 hit rows, C-3, C-20, C-25, C-26). One cell = a fresh view with the finger homed on a chosen
// leaf of a chosen length; one positional op at an index relative to (fb, len); the expected hit is a LITERAL per cell
// (the C-4 clause under test), cross-checked against modelHit. Each row asserts the answer, the counter deltas
// (fingerHits / fingerMisses / touches / pulls / moves / splits / merges / equalizes), the post finger against the C-3
// reading (hit: byte-identical to the pre-op finger; miss: re-home) and the walker.

const NC = 12;
function readC(v) { const a = new Int32Array(NC); v.readCounters(a); return a; }
function delta(a, b, k) { return b[CN[k]] - a[CN[k]]; }

// Model-tracked view: arena of 2 views, B, element e carries entity e and measure e + 1.
function mkView(B, n) {
  const f = FACT(256, { leafSize: B, dims: 1 }, 2);
  const M = { f, v: f.views[0], B, m: B >> 2, ent: [], mea: [], nextE: 1, NIL: f.snapshot().NIL };
  for (let k = 0; k < n; k++) mIns(M, k);
  return M;
}
function mIns(M, i, mm) {
  const e = M.nextE++;
  const me = mm === undefined ? e + 1 : mm;
  M.v.insertAt(i, e, me);
  M.ent.splice(i, 0, e); M.mea.splice(i, 0, me);
}
function mRem(M, i) {
  assert.equal(M.v.removeAt(i), M.ent[i]);
  M.ent.splice(i, 1); M.mea.splice(i, 1);
}
function leafInfo(M, ord) {
  const lens = leafLens(M.f.snapshot(), 0);
  let start = 0;
  for (let q = 0; q < ord; q++) start += lens[q];
  return { lens, start, len: lens[ord] };
}
// grow / shrink leaf `ord` to `target` elements by interior non-structural ops (len < B on the way up, len > m down)
function shapeLeaf(M, ord, target) {
  for (let guard = 0; guard < 64; guard++) {
    const { start, len } = leafInfo(M, ord);
    if (len === target) return;
    if (len < target) mIns(M, start + 1);
    else mRem(M, start);
  }
  throw new Error('shapeLeaf did not converge');
}
// home the finger on leaf `ord` (getMeasure at its first element) and return the pre-op finger + leaf facts
function homeOn(M, ord) {
  const { start, len, lens } = leafInfo(M, ord);
  M.v.getMeasure(start, 0);
  const s = M.f.snapshot();
  const d = descend(s, 0, start);
  const F = fingerOf(M.v);
  assert.equal(F.fl, d.fl, 'finger homed on leaf ' + ord);
  assert.equal(F.fb, start);
  assert.equal(len, s.leaf.len[~F.fl]);
  return { F, fb: start, len, last: ord === lens.length - 1 };
}

// Runs ONE op and checks the whole row. op in insertAt / removeAt / setMeasure / getMeasure / entityAt.
function runCellOp(M, op, i, wantHit, tag) {
  const v = M.v;
  const pre = M.f.snapshot();
  const F = fingerOf(v);
  const lenF = F.fl === M.NIL ? 0 : pre.leaf.len[~F.fl];
  assert.equal(modelHit(op, i, F, lenF, M.NIL, M.B, M.m), wantHit, tag + ': the literal and the C-4 model agree');
  const n = v._len;
  const c0 = readC(v);
  let ans;
  const newMea = 7777;
  const nextE = M.nextE;
  if (op === 'insertAt') v.insertAt(i, nextE, newMea);
  else if (op === 'removeAt') ans = v.removeAt(i);
  else if (op === 'setMeasure') v.setMeasure(i, 0, newMea);
  else if (op === 'getMeasure') ans = v.getMeasure(i, 0);
  else ans = v.entityAt(i);
  const c1 = readC(v);
  const post = M.f.snapshot();
  // answers (model: ent / mea arrays)
  if (op === 'removeAt') { assert.equal(ans, M.ent[i], tag + ' removeAt answer'); M.ent.splice(i, 1); M.mea.splice(i, 1); }
  else if (op === 'insertAt') { M.nextE++; M.ent.splice(i, 0, nextE); M.mea.splice(i, 0, newMea); }
  else if (op === 'setMeasure') M.mea[i] = newMea;
  else if (op === 'getMeasure') assert.equal(ans, M.mea[i], tag + ' getMeasure answer');
  else assert.equal(ans, M.ent[i], tag + ' entityAt answer');
  // partition (C-26)
  assert.equal(delta(c0, c1, 'fingerHits'), wantHit ? 1 : 0, tag + ' fingerHits');
  assert.equal(delta(c0, c1, 'fingerMisses'), wantHit ? 0 : 1, tag + ' fingerMisses');
  const dSplit = delta(c0, c1, 'splits');
  const dStruct = dSplit + delta(c0, c1, 'merges') + delta(c0, c1, 'equalizes');
  const mutating = op === 'insertAt' || op === 'removeAt' || op === 'setMeasure';
  const G = F.fl === M.NIL ? null : { fb: F.fb, len: lenF };
  if (wantHit) {
    assert.equal(delta(c0, c1, 'touches'), 0, tag + ' hit touches 0 (C-25)');
    assert.equal(delta(c0, c1, 'pulls'), mutating ? F.depth : 0, tag + ' hit pulls == _fdepth on a mutation, 0 on a read (C-20)');
    assert.equal(dStruct, 0, tag + ' hit is never structural');
    // moves of a hit (C-18): insert s-p, remove s-1-p, others 0 (p = offset in the leaf)
    const p = i - G.fb;
    const wantMoves = op === 'insertAt' ? G.len - p : op === 'removeAt' ? G.len - 1 - p : 0;
    assert.equal(delta(c0, c1, 'moves'), wantMoves, tag + ' hit moves (C-18)');
    // C-3: a hit leaves the finger byte-identical, _fpath[0.._fdepth) included
    assert.equal(json(fingerOf(v)), json(F), tag + ' finger unchanged by a hit');
    assert.equal(json(Array.from(v._fpath).slice(0, F.depth)), json(F.path.slice(0, F.depth)), tag + ' _fpath unchanged by a hit');
  } else {
    if (pre.views[0]._root !== pre.EMPTY_ROOT && pre.views[0]._root >= 0) {
      // a multi-leaf miss descends: touches > 0 (exact depth for a non-structural read / set / remove)
      assert.ok(delta(c0, c1, 'touches') > 0, tag + ' miss touches > 0');
      if (op !== 'insertAt' && dStruct === 0) {
        assert.equal(delta(c0, c1, 'touches'), descend(pre, 0, i).depth, tag + ' non-structural miss touches == walker depth (C-25)');
      }
    }
    if (mutating) assert.ok(delta(c0, c1, 'pulls') >= 1 || dStruct > 0 || op === 'removeAt', tag + ' miss mutation pulls');
    // C-3 re-home after a miss: the same reading as the per-op lane
    if (op === 'insertAt') {
      const exp = descend(post, 0, i);
      assert.equal(v._fl, exp.fl, tag + ' re-home _fl'); assert.equal(v._fb, exp.fb, tag + ' re-home _fb');
      assert.equal(v._fdepth, exp.depth, tag + ' re-home _fdepth');
      for (let q = 0; q < exp.depth; q++) assert.equal(v._fpath[q], exp.path[q], tag + ' re-home _fpath');
    } else if (op === 'removeAt' && n === 1) {
      assert.equal(v._fl, M.NIL); assert.equal(v._fb, 0); assert.equal(v._fdepth, 0);
    } else {
      const exp = op === 'removeAt' ? (dStruct > 0 ? descend(post, 0, Math.min(i, n - 2)) : descend(pre, 0, i)) : descend(post, 0, i);
      assert.equal(v._fl, exp.fl, tag + ' re-home _fl'); assert.equal(v._fb, exp.fb, tag + ' re-home _fb');
      assert.equal(v._fdepth, exp.depth, tag + ' re-home _fdepth');
      for (let q = 0; q < exp.depth; q++) assert.equal(v._fpath[q], exp.path[q], tag + ' re-home _fpath');
    }
  }
  if (op === 'insertAt' && !wantHit && lenF === M.B && G && i > G.fb && i <= G.fb + lenF) {
    assert.equal(dSplit, 1, tag + ' a full-leaf insert splits (C-4: the split-triggering insert is a miss)');
  }
  assert.equal(walk(post, { B: M.B, dims: 1 }), null, tag + ' walker');
  // content: whole-view check through the (neutral) seeks
  let acc = 0;
  for (let k = 0; k <= M.mea.length; k++) {
    assert.equal(v.sumBefore(0, k), acc, tag + ' sumBefore(' + k + ')');
    if (k < M.mea.length) acc += M.mea[k];
  }
  assert.equal(json(fingerOf(v)), json(fingerOf(v)));
  assert.equal(v._len, M.mea.length);
}

// multi-leaf cells: B in {8, 16}, leaf ordinal in {first, middle, last} x len in {B-1, B, m+1, m}
for (const B of [8, 16]) {
  const m = B >> 2;
  for (const ordKey of ['first', 'middle', 'last']) {
    for (const [lname, Lf] of [['B-1', (b) => b - 1], ['B', (b) => b], ['m+1', (b, mm) => mm + 1], ['m', (b, mm) => mm]]) {
      rowTest('multi-' + B + '-' + ordKey + '-' + lname, 'Finger hit row (C-4): multi-leaf B=' + B + ', ' + ordKey + ' leaf, len ' + lname + ': every guard side, 5 ops x {hit, miss}', () => {
        const L = Lf(B, m);
        const probe = mkView(B, 4 * B);
        const nLeaves = leafLens(probe.f.snapshot(), 0).length;
        assert.ok(nLeaves >= 3, 'multi-leaf (>= 3 leaves)');
        const ord = ordKey === 'first' ? 0 : ordKey === 'middle' ? 1 : nLeaves - 1;
        // case list: [op, offset kind, literal hit]
        const cases = [];
        const mk = (op, name, idxFn, hitFn) => cases.push({ op, name, idxFn, hitFn });
        // insertAt (lo / hi / len clauses)
        mk('insertAt', 'i=fb-1', (c) => c.fb - 1, () => false);
        mk('insertAt', 'i=fb', (c) => c.fb, (c) => c.fb === 0 && L < B);
        mk('insertAt', 'i=fb+1', (c) => c.fb + 1, () => L < B);
        mk('insertAt', 'i=fb+len', (c) => c.fb + c.len, () => L < B);
        mk('insertAt', 'i=fb+len+1', (c) => c.fb + c.len + 1, () => false);
        for (const op of ['setMeasure', 'getMeasure', 'entityAt', 'removeAt']) {
          const need = op === 'removeAt' ? L > m : true;
          mk(op, 'i=fb-1', (c) => c.fb - 1, () => false);
          mk(op, 'i=fb', (c) => c.fb, () => need);
          mk(op, 'i=fb+len-1', (c) => c.fb + c.len - 1, () => need);
          mk(op, 'i=fb+len', (c) => c.fb + c.len, () => false);
        }
        let ran = 0;
        for (const cs of cases) {
          const M = mkView(B, 4 * B);
          shapeLeaf(M, ord, L);
          const h = homeOn(M, ord);
          assert.equal(h.len, L);
          const i = cs.idxFn(h);
          const n = M.mea.length;
          // skip indexes that are out of the op's valid range (those are the throwing rows)
          const maxI = cs.op === 'insertAt' ? n : n - 1;
          if (i < 0 || i > maxI) continue;
          // fb-1 only exists for fb >= 1; i=fb+len+1 on the last leaf is out of range (skipped above)
          runCellOp(M, cs.op, i, cs.hitFn(h), cs.op + ' ' + cs.name + ' (fb ' + h.fb + ', len ' + h.len + ')');
          ran++;
        }
        assert.ok(ran >= (ordKey === 'last' ? 12 : ordKey === 'first' ? 13 : 17), 'cells run ' + ran);
      });
    }
  }
}

// single-leaf cells (_fdepth 0): insert lo / hi / len; removeAt len 2 hit, len 1 drain (miss, NIL); reads hit
for (const B of [8, 16]) {
  rowTest('single-' + B, 'Finger hit row (C-4): single-leaf view B=' + B + ' (_fdepth 0): insert lo / hi / len, removeAt len > 1, reads', () => {
    for (const L of [1, 2, B - 1, B]) {
      const base = mkView(B, L);
      assert.ok(base.v._root < 0, 'single leaf');
      base.v.getMeasure(0, 0);
      assert.equal(base.v._fdepth, 0);
      for (let i = 0; i <= L; i++) {
        const M = mkView(B, L); M.v.getMeasure(0, 0);
        // insertAt: first leaf (fb 0) opens at 0; hit iff len < B
        runCellOp(M, 'insertAt', i, L < B, 'single insertAt(' + i + ') len ' + L);
      }
      for (let i = 0; i < L; i++) {
        for (const op of ['setMeasure', 'getMeasure', 'entityAt']) {
          const M = mkView(B, L); M.v.getMeasure(0, 0);
          runCellOp(M, op, i, true, 'single ' + op + '(' + i + ') len ' + L);
        }
        const M = mkView(B, L); M.v.getMeasure(0, 0);
        // removeAt: single-leaf rule len > 1 (NOT len > m)
        runCellOp(M, 'removeAt', i, L > 1, 'single removeAt(' + i + ') len ' + L);
      }
    }
    // a single-leaf len m + 1 .. 1 must still hit down to 2 even when 2 <= m (B=16: m = 4)
    const M = mkView(B, B >> 2);
    M.v.getMeasure(0, 0);
    runCellOp(M, 'removeAt', 0, true, 'single removeAt len m');
  });
}

// (regression pin: also a miss on the miss-only build; the NIL guard's teeth are the Phase 2 source mutant)
// fl === NIL is a miss on both view shapes: fresh, after clear, after splitAt (both views), after append (both
// views) and after a drain
rowTest('nil', 'Finger hit row (C-4/C-5): fl === NIL is a miss on a fresh view, after clear / splitAt / append / a drain, B=8', () => {
  const B = 8;
  const nilMiss = (M, v, tag) => {
    assert.equal(v._fl, M.NIL, tag + ': finger is NIL');
    const c0 = readC(v);
    const e = M.nextE++;
    v.insertAt(0, e, 5);
    const c1 = readC(v);
    assert.equal(delta(c0, c1, 'fingerHits'), 0, tag + ' hits'); assert.equal(delta(c0, c1, 'fingerMisses'), 1, tag + ' misses');
  };
  { // fresh
    const M = mkView(B, 0); nilMiss(M, M.v, 'fresh');
  }
  { // clear (multi-leaf and single-leaf)
    for (const n of [4 * B, 3]) {
      const M = mkView(B, n); M.v.clear(); nilMiss(M, M.v, 'clear n=' + n);
    }
  }
  { // splitAt: both views, on a multi-leaf and a single-leaf source
    for (const n of [4 * B, 5]) {
      const M = mkView(B, n);
      const out = M.f.views[1];
      M.v.getMeasure(0, 0);
      M.v.splitAt(Math.floor(n / 2), out);
      assert.equal(M.v._fl, M.NIL); assert.equal(out._fl, M.NIL);
      nilMiss(M, M.v, 'splitAt left n=' + n);
      const M2 = mkView(B, n); const out2 = M2.f.views[1];
      M2.v.splitAt(Math.floor(n / 2), out2);
      nilMiss(M2, out2, 'splitAt out n=' + n);
    }
  }
  { // append: both operands (multi-leaf and single-leaf)
    for (const n of [4 * B, 5]) {
      const M = mkView(B, n); const b = M.f.views[1];
      for (let k = 0; k < n; k++) b.insertAt(k, 1000 + k, 1);
      M.v.getMeasure(0, 0); b.getMeasure(0, 0);
      M.v.append(b);
      assert.equal(M.v._fl, M.NIL); assert.equal(b._fl, M.NIL);
      nilMiss(M, M.v, 'append dest n=' + n);
      nilMiss(M, b, 'append source n=' + n);
    }
  }
  { // a drain (multi-leaf then single)
    const M = mkView(B, 2 * B + 1);
    while (M.mea.length > 0) mRem(M, M.mea.length - 1);
    nilMiss(M, M.v, 'drain');
  }
});

// removeAt underflow (T-6): multi-leaf len m+1 hits and len m misses (covered cell-wise above); here the structural
// consequence, once per B: the m-leaf remove is a merge or an equalize, the m+1 remove is neither.
for (const B of [8, 16]) {
  rowTest('t6-' + B, 'Finger hit row (C-4, T-6): removeAt on a len m leaf is a miss that merges / equalizes; on len m+1 a hit with 0 structural, B=' + B, () => {
    const m = B >> 2;
    const A = mkView(B, 4 * B); shapeLeaf(A, 1, m + 1);
    const hA = homeOn(A, 1);
    runCellOp(A, 'removeAt', hA.fb, true, 'len m+1 hit');
    const Z = mkView(B, 4 * B); shapeLeaf(Z, 1, m);
    const c0 = readC(Z.v);
    const hZ = homeOn(Z, 1);
    const c1 = readC(Z.v);
    void c0; void c1;
    const c2 = readC(Z.v);
    runCellOp(Z, 'removeAt', hZ.fb, false, 'len m miss');
    const c3 = readC(Z.v);
    assert.equal(delta(c2, c3, 'merges') + delta(c2, c3, 'equalizes'), 1, 'the len m remove underflows: exactly one merge or equalize');
  });
}

// (regression pins: a throw re-homes nothing on the miss-only build too; they guard the hit path against a write before the check)
// Throwing ops on a HITTABLE finger: the index is inside the finger leaf, so a bad value is the only failure (C-3, C-10)
for (const B of [8, 16]) {
  test('Finger hit row (C-3): throwing ops with the index inside the finger leaf change no finger field and no counter, B=' + B, () => {
    const M = mkView(B, 4 * B);
    const v = M.v;
    const n = M.mea.length;
    const h = homeOn(M, 1);
    const i = h.fb + 1;
    const bad = [
      ['insertAt bad measure (-1)', () => v.insertAt(i, 99, -1)],
      ['insertAt bad measure (1.5)', () => v.insertAt(i, 99, 1.5)],
      ['insertAt index n+1', () => v.insertAt(n + 1, 99, 1)],
      ['setMeasure bad measure', () => v.setMeasure(i, 0, -1)],
      ['setMeasure bad dim', () => v.setMeasure(i, 5, 1)],
      ['setMeasure index n', () => v.setMeasure(n, 0, 1)],
      ['getMeasure index n', () => v.getMeasure(n, 0)],
      ['getMeasure index -1', () => v.getMeasure(-1, 0)],
      ['entityAt index n', () => v.entityAt(n)],
      ['removeAt index n', () => v.removeAt(n)],
      ['removeAt index 1.5', () => v.removeAt(1.5)],
    ];
    for (const [tag, fn] of bad) {
      v.getMeasure(h.fb, 0); // re-home onto the leaf
      expectThrowIdentical(v, fn, tag);
    }
    assert.equal(walk(M.f.snapshot(), { B, dims: 1 }), null);
  });
  test('Finger hit row (C-3, RF-1): headroom RangeError with the index inside the finger leaf leaves finger and counters unchanged, B=' + B, () => {
    const f = engineFactory(256, { leafSize: B, dims: 1 }, 1);
    const v = f.views[0];
    const MAXV = 9007199254740991;
    const n = 3 * B;
    v.insertAt(0, 0, MAXV - 100);
    for (let k = 1; k < n; k++) v.insertAt(k, k, 1);
    v.getMeasure(1, 0); // finger on the first leaf, index 1 inside it
    expectThrowIdentical(v, () => v.setMeasure(1, 0, MAXV - 5), 'setMeasure headroom');
    expectThrowIdentical(v, () => v.insertAt(1, 7, MAXV - 5), 'insertAt headroom');
  });
}

// Seeks between ops: 0 hits, 0 misses, finger unchanged (C-2, C-26), on a hittable finger
test('Finger hit row (C-2, C-26): indexAtSum / sumBefore / total add no hit and no miss and keep a hittable finger', () => {
  const M = mkView(8, 32);
  const v = M.v;
  const h = homeOn(M, 1);
  const before = json(fingerOf(v)) + json(Array.from(v._fpath));
  const c0 = readC(v);
  v.indexAtSum(0, 100); v.sumBefore(0, 20); v.total(0);
  const c1 = readC(v);
  assert.equal(delta(c0, c1, 'fingerHits'), 0); assert.equal(delta(c0, c1, 'fingerMisses'), 0);
  assert.equal(json(fingerOf(v)) + json(Array.from(v._fpath)), before);
  // and the next positional op in the finger leaf still hits
  runCellOp(M, 'getMeasure', h.fb, true, 'hit after seeks');
});

// Streams (C-34 / PLAN-E0-F ASSERTION 1, C-19): exact counts, derived in the ADR (closed form == simulation)
rowTest('append', 'Finger stream (C-34): 1e4 appends at B=16 -> fingerHits 9231, fingerMisses 769, splits 768', () => {
  const v = new SEQ(1e4, { leafSize: 16 });
  for (let k = 0; k < 1e4; k++) v.insertAt(k, k, 1);
  const c = readC(v);
  assert.equal(c[CN.fingerHits], 9231);
  assert.equal(c[CN.fingerMisses], 769);
  assert.equal(c[CN.splits], 768);
});
rowTest('prepend', 'Finger stream (C-19): B=16, 200 insertAt(0) -> fingerHits 184, splits 15, moves 1960', () => {
  const v = new SEQ(256, { leafSize: 16 });
  for (let k = 0; k < 200; k++) v.insertAt(0, k, 1);
  const c = readC(v);
  assert.equal(c[CN.fingerHits], 184);
  assert.equal(c[CN.splits], 15);
  assert.equal(c[CN.moves], 1960);
});

// (regression pin: passes on the miss-only build) MF-5 (C-35, C-39): a clear() that keeps the finger. clear sets the finger NIL (C-5); the next op is a miss.
test('Finger row: MF-5 clear() resets the finger to NIL / 0 / 0 (a wrapper that kept it would hit a freed leaf)', () => {
  const M = mkView(8, 32);
  M.v.getMeasure(5, 0);
  assert.ok(M.v._fl !== M.NIL);
  M.v.clear();
  assert.equal(M.v._fl, M.NIL); assert.equal(M.v._fb, 0); assert.equal(M.v._fdepth, 0);
  assert.equal(M.v._len, 0);
});

// ---------------------------------------------------------------------------------------------------------------
// Rung F-R source mutants (anchors from the coder's hit test; each count is asserted by buildMutant, a mismatch FAILS).
// Every mutant runs in a child process (spawnSync, timeout, SIGKILL): the named row(s) must FAIL on the patched engine
// and PASS on the same path with an identity patch (anchor -> anchor). A timeout counts as killed only for a mutant
// flagged mayHang, and only if the identity run finished in under a third of the timeout.
const SELF = fileURLToPath(import.meta.url);
const CHILD_TIMEOUT = 90000;
function runChildRow(patch, row) {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, [SELF], {
    env: { ...process.env, YG_FINGER_CHILD: JSON.stringify({ anchor: patch[0], repl: patch[1], count: patch[2], row }) },
    timeout: CHILD_TIMEOUT, killSignal: 'SIGKILL', encoding: 'utf8',
  });
  return { status: r.status, signal: r.signal, out: (r.stdout || '') + (r.stderr || ''), ms: Date.now() - t0 };
}
const MUTS = [
  { name: 'loNoWiden', anchor: 'fb - ((fb - 1) >>> 31) < at', repl: 'fb < at', count: 1, rows: ['prepend', 'multi-8-first-B-1'] },
  { name: 'hiStrict', anchor: 'at <= fb + (len = llen[~ref]) && len < ar.B', repl: 'at < fb + (len = llen[~ref]) && len < ar.B', count: 1, rows: ['append', 'multi-8-middle-B-1'] },
  { name: 'removeGeM', anchor: 'len > (this._fdepth === 0 ? 1 : ar.m)', repl: 'len >= (this._fdepth === 0 ? 1 : ar.m)', count: 1, rows: ['t6-8', 'multi-8-middle-m'] },
  { name: 'nilDropped', anchor: 'ref !== YG_NIL && ', repl: '', count: 5, rows: ['nil'], equivalent: true },
  // R6 (reviewer): `_fdepth === 0 ? 1` -> `? 0` is EQUIVALENT: a single-leaf view with len 1 is the n === 1 drain, which
  // returns before this test, so the changed arm (len > 0 vs len > 1 on a single leaf) is never reached with len 1.
  { name: 'singleLeafGt0', anchor: 'len > (this._fdepth === 0 ? 1 : ar.m)', repl: 'len > (this._fdepth === 0 ? 0 : ar.m)', count: 1, rows: ['single-8'], equivalent: true },
  { name: 'hitTouchesDepth', anchor: 'cn[YG_TOUCHES] = (cn[YG_TOUCHES] + (depth & (h - 1))) | 0;', repl: 'cn[YG_TOUCHES] = (cn[YG_TOUCHES] + depth) | 0;', count: 5, rows: ['multi-8-middle-B-1'] },
  { name: 'loWiden', anchor: 'fb - ((fb - 1) >>> 31) < at', repl: 'fb - 1 < at', count: 1, rows: ['multi-8-middle-B-1'] },
  { name: 'elemHiWiden', anchor: 'at < fb + llen[~ref]', repl: 'at <= fb + llen[~ref]', count: 3, rows: ['multi-8-first-B-1', 'multi-8-middle-B-1'] },
];
// nilDropped is an EQUIVALENT mutant: YG_NIL is 0 and a live leaf ref is ~leaf < 0, so with the guard dropped a NIL
// finger evaluates llen[~0] = llen[-1] = undefined, every range comparison is false, and the op still misses. The row
// below pins that (survives on every NIL path of the nil row, exit 0, anchor count 5 asserted by buildMutant); it
// cannot be killed by any behavioral row, and says so rather than hiding it.
for (const mu of MUTS) {
  for (const row of mu.rows) {
    test('Finger source mutant ' + mu.name + (mu.equivalent ? ' is EQUIVALENT on row ' : ' is killed by row ') + row + ' (identity patch passes it)', (t) => {
      const ok = runChildRow([mu.anchor, mu.anchor, mu.count], row);
      assert.equal(ok.status, 0, 'identity patch must pass ' + row + ': ' + ok.out);
      const bad = runChildRow([mu.anchor, mu.repl, mu.count], row);
      assert.notEqual(bad.status, 4, 'anchor count mismatch (expected ' + mu.count + '): ' + bad.out);
      if (mu.equivalent) {
        assert.equal(bad.status, 0, 'equivalent mutant (llen[-1] is undefined, comparisons false) must behave as the original: ' + bad.out);
        t.diagnostic(mu.name + '/' + row + ': EQUIVALENT: identity ' + ok.ms + ' ms, mutant ' + bad.ms + ' ms, both exit 0');
        return;
      }
      const timedOut = bad.status === null && bad.signal === 'SIGKILL';
      if (timedOut) {
        assert.ok(mu.mayHang && ok.ms * 3 < CHILD_TIMEOUT, 'a timeout counts as killed only for a mayHang mutant with a fast identity run');
      } else {
        assert.ok(bad.status === 3 || bad.status === 5, 'killed (exit 3 assertion / 5 crash), got ' + bad.status + ': ' + bad.out);
      }
      t.diagnostic(mu.name + '/' + row + ': identity ' + ok.ms + ' ms exit 0; mutant ' + bad.ms + ' ms exit ' + bad.status + ' ' + bad.out.split('\n')[0].slice(0, 160));
    });
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Part 3 (K-R2 helper C). (a) fl === NIL is a miss for every positional op, after splitAt and append (the nil row
// above only inserts). Expected from C-4 / C-5 / C-26: hits +0, misses +1; answers from the build order (element k
// carries entity k + 1 and measure k + 2; the append source carries 1000 + k and measure 1). Regression pin: passes
// on the pre-K-R2 build too.
test('Finger row (C-4/C-5/C-26): getMeasure / entityAt / setMeasure / removeAt at index 0 are misses on a NIL finger after splitAt / append, B=8', () => {
  const B = 8;
  const n = 4 * B;
  const shapes = ['splitAt left', 'splitAt out', 'append dest', 'append source'];
  for (const sh of shapes) {
    for (const op of ['getMeasure', 'entityAt', 'setMeasure', 'removeAt']) {
      const M = mkView(B, n);
      const b = M.f.views[1];
      let v, wantE, wantM;
      if (sh === 'splitAt left') { M.v.splitAt(n >> 1, b); v = M.v; wantE = 1; wantM = 2; }
      else if (sh === 'splitAt out') { M.v.splitAt(n >> 1, b); v = b; wantE = (n >> 1) + 1; wantM = (n >> 1) + 2; }
      else {
        for (let k = 0; k < n; k++) b.insertAt(k, 1000 + k, 1);
        M.v.append(b);
        v = sh === 'append dest' ? M.v : b;
        wantE = sh === 'append dest' ? 1 : -1; wantM = sh === 'append dest' ? 2 : -1;
      }
      if (sh === 'append source') { // the source is emptied by append (length 0): a NIL, empty view, nothing to read
        assert.equal(b._len, 0); assert.equal(b._fl, M.NIL); continue;
      }
      assert.equal(v._fl, M.NIL, sh + ': finger is NIL');
      const c0 = readC(v);
      let got;
      if (op === 'getMeasure') { got = v.getMeasure(0, 0); assert.equal(got, wantM, sh + ' ' + op); }
      else if (op === 'entityAt') { got = v.entityAt(0); assert.equal(got, wantE, sh + ' ' + op); }
      else if (op === 'setMeasure') { v.setMeasure(0, 0, 7); assert.equal(v.getMeasure(0, 0), 7, sh + ' ' + op); }
      else { got = v.removeAt(0); assert.equal(got, wantE, sh + ' ' + op); }
      const c1 = readC(v);
      const extra = op === 'setMeasure' ? 1 : 0; // the verifying getMeasure after setMeasure is a hit on the re-homed finger
      assert.equal(delta(c0, c1, 'fingerMisses'), 1, sh + ' ' + op + ' misses');
      assert.equal(delta(c0, c1, 'fingerHits'), extra, sh + ' ' + op + ' hits');
    }
  }
});

// (b) the A1 driver on a short stream: B=8, seed 1, 1500 executed ops (the full 1e4-op x 6 A1 run is test:lanes, R-E1).
// 0 divergences, hits + misses == positional ops, off-run fingerHits 0; the MF-2 wrapper (C-35) diverges. Floors are NOT
// asserted at this length (they are a 1e4-op property); test:lanes asserts them.
test('Finger part 3: A1 driver, B=8 s=1, 1500 ops: 0 divergences; the MF-2 wrapper diverges', () => {
  const r = a1Stream({ B: 8, seed: 1, ops: 1500 });
  assert.equal(r.divergences, 0, JSON.stringify(r.first));
  assert.equal(r.ops, 1500);
  assert.equal(r.fingerHits + r.fingerMisses, r.positional);
  assert.equal(r.offHits, 0);
  assert.ok(r.positional > 1000 && r.fingerHits > 0, 'the stream exercises hits: ' + r.fingerHits + ' of ' + r.positional);
  assert.ok(r.splits > 0 && r.merges > 0, 'the short stream splits and merges');
  const bad = a1Stream({ B: 8, seed: 1, ops: 1500, mode: 'mf2', stopAtFirst: true });
  assert.ok(bad.divergences >= 1, 'MF-2 (a miss keeps the finger) must diverge from finger-off');
});

if (CHILD) {
  const spec = JSON.parse(CHILD);
  let M;
  try {
    M = await buildMutant(new URL('../Yggdrasil.js', import.meta.url).pathname, [[spec.anchor, spec.repl, spec.count]]);
  } catch (e) { console.log('COUNT ' + e.message); process.exit(4); }
  FACT = mutantFactory(M);
  SEQ = M.SumSequence;
  let code = 0;
  try {
    if (!ROWS[spec.row]) { console.log('UNKNOWN ROW ' + spec.row); code = 6; } else { ROWS[spec.row](); console.log('ROWPASS'); }
  } catch (e) {
    console.log('ROWFAIL ' + String((e && e.message) || e).split('\n')[0]);
    code = e instanceof assert.AssertionError ? 3 : 5;
  }
  M.cleanup();
  process.exit(code);
}
