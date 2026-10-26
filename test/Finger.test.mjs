// test/Finger.test.mjs -- part 1 (rung 3 / A-R2): the ENGINE per-op finger lane. ADR 0005 C-1 (finger fields),
// C-2 (seeks are neutral), C-3 (re-home after every positional op; structural op = cold descent to i by the element
// rule `k < count[left]`; a throwing op re-homes nothing), C-5 (NIL / 0 / 0 on a drain), C-25/C-26 (hit / miss
// partition), C-27/C-28 (walker I-9), C-34 (xorshift32 constants), C-35 (MF-1..MF-5, wrappers per RF-3 / A5-18),
// C-43 M-1 (every positional op is a miss until F-R2; the core writes the finger and never reads it). Rung A-R3: the
// lane covers underflowing removes too (merge / equalize = structural: cold descent to min(i, length-1) over the post
// state; drain = NIL / 0 / 0 with _fpath kept).
//
// Oracle independence: the model is two plain arrays per view; the expected finger (leaf ref, fb, depth, path) is
// computed by this file's own root-to-leaf descent over a deep-copied snapshot, never by the engine's descent.
// Row numbers (13|4, 8|8, 5 vs 7, 14 vs 13) are quoted from C-35. Controls are state-restore wrappers that rewrite
// the view's own finger fields around the correct build (no source patch, RF-3). ASCII only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SumSequence } from '../Yggdrasil.js';
import { engineFactory } from './adapter.mjs';
import { walk } from './walker.mjs';
import { buildMutant } from './mutant-build.mjs';

const CN = SumSequence.COUNTERS;

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

// One configured run: arena of 2 views, B, wrapper. Every op goes through R.op().
function newRun(B, wrap, C, factory) {
  const f = (factory || engineFactory)(C || 256, { leafSize: B, dims: 1 }, 2);
  const NIL = f.snapshot().NIL; // read from a fresh view, never hardcoded
  const R = {
    f, B, m: B >> 2, NIL, wrap, C: C || 256,
    ent: [[], []], mea: [[], []], cE: 1,
    stats: { ins: 0, rem: 0, rd: 0, seek: 0, skip: 0, splits: 0, rstruct: 0, drains: 0, multi: 0, nilSeen: 0 },
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
    R.chk(dh === 0, 'hit', tag + 'fingerHits delta ' + dh + ' (M-1: every op a miss)');
    R.chk(dm === (kind === 'seek' ? 0 : 1), 'miss', tag + 'fingerMisses delta ' + dm);
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

test('Finger lane: B 4 / 8 / 16 x seeds 1..3, 2000 ops each, every op checked (C-1, C-2, C-3, C-5, C-26, M-1)', () => {
  const rep = runLane(null, CFGS, 2000);
  assert.equal(rep.fail, null, rep.fail && ('B=' + rep.B + ' seed=' + rep.seed + ' [' + rep.fail.cls + '] ' + rep.fail.msg));
  for (const s of rep.stats) {
    const tag = 'B=' + s.B + ' seed=' + s.seed;
    // coverage floors (conservative; ~770 inserts per stream, leaves of >= B/4 -> many splits)
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
