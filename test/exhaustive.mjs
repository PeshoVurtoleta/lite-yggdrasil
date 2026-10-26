// test/exhaustive.mjs -- the SumSequence exhaustive lanes: BFS, sweep and deep
// (test harness; not a hot path: clarity beats speed, allocation is fine).
//
// Binding rules: decisions/0005 C-26 (hit / miss partition), C-27 (snapshot,
// finger off, walker state, neutral ops, hasOwn), C-31 (BFS + sweep), C-32
// (deep lane, coverage cells), C-34 (xorshift32 streams, seeds, weights,
// index / measure draws), C-41 ASSERTIONS 4 / 6. Plan: .handoff/PLAN-HB4.md
// SPEC 2, "Driver check order", TASKS 3-5, as amended by ADDENDUM R1 (R1-1
// cells, R1-2 sizes, R1-3 mutant reports, R1-5 API, R1-6 closers).
//
// API (R1-5)
//   bfsLane(f, {B, nMax, walker = true, cap, drop, cfg})
//       -> {ok, first, applied, divergences, tally, states}
//   sweepLane(f, {B, states, nSweep, suffixes = true, cap, cfg})
//       -> {ok, first, applied, divergences, tally}
//   deepLane(f, {B, ops, seed, nLo, nHi, drop, cap, cfg})
//       -> {ok, first, applied, divergences, tally, maxLeaves}
//   f            a factory (C, {leafSize, dims}, count, cfg) -> {views,
//                snapshot()} (test/stubs.mjs, later the engine adapter);
//                every lane calls f(C, {leafSize: B, dims: 1}, 2, cfg ?? {}),
//                C = nMax (bfs), nHi (deep), the largest live count a witness
//                reaches or nSweep + 1, whichever is larger (sweep).
//   B            4 or 8. cap defaults to CAPS.cap (2^18); cap is an addition
//                to the R1-5 pin so an engine run can pass ENGINE.cap.
//   drop         op names a lane never applies (bfs: transitions; deep: the
//                class is redrawn): insertAt, removeAt, setMeasure, getMeasure,
//                entityAt, indexAtSum, sumBefore, splitAt / append (either
//                name drops the splitAt + append pair).
//   first        null, or {lane 'bfs'|'sweep'|'deep', run 'on'|'off', code,
//                detail, op, n (view a's pre-op length), witnessLength (ops
//                from empty through the failing op, inclusive)}. The lane
//                stops at its first failure, so divergences (oracle-class
//                failures: I-4 and ORACLE) is 0 or 1.
//   states       [{key, n, witness}] in discovery order; key = the shape of
//                every view's tree (structure + leaf lengths, no ids), so
//                states that differ only in ids / free-list order merge.
//   witness      [{op, i}], replayable on any factory. Arguments are derived
//                from the op's 0-based position k in its witness: entity k,
//                measure 1 + k % 3 (insertAt, setMeasure), dim 0; indexAtSum
//                seeks y = sumBefore(0, i) (the i-th boundary); splitAt cuts
//                into view b; append is a.append(b); clear clears view i.
//   tally        a plain object with every CELLS(B) key (bfs + deep; the sweep
//                adds none, R1-1).
//   CELLS(B)     frozen cell names in A3 order (B = 4: the 4 rot cells).
//   coverageMissing(tally, B) -> names in CELLS order with !(tally[c] >= 1).
//   assertCoverage(tally, B)  throws RangeError 'coverage: missing a, b'.
//   mergeTally(a, b)          -> a new plain object, key-wise sum.
//   CODES        the walker CODES, then the harness codes below.
//   ENGINE, CAPS deep-frozen lane sizes (engine group, npm test).
//
// Lane start (R1-6, C-27, C-8): a fresh arena's view 0 gives NIL (_fl) and
// EMPTY_ROOT (_root); EMPTY_ROOT === 0 fails C-27; every view of a fresh on
// and off arena must own _fl, _fb, _fdepth, _fpath (else C-27, op null,
// witnessLength 0) and an Int32Array(12) _n (else C-26). Finger off = before
// EVERY op of the off run (replays included) write NIL / 0 / 0 into _fl / _fb
// / _fdepth of each off view (_fpath is left as is).
//
// Check order per op (first failure wins)
//   walker(on)  walk(on snapshot) -> the walker code, run 'on'
//   SWEEP       landing: after getMeasure(firstIndex(j), 0) on the on run,
//               view a's _fl !== the ref of in-order leaf j
//   walker(off) walk(off snapshot) -> the walker code, run 'off'
//   I-4         the on run's indexAtSum answer !== the oracle's
//   ORACLE      any other on-run answer / throw mismatch (Object.is; a throw
//               matches a RangeError whose first word is the oracle's token;
//               insertAt at live + 1 > C expects 'capacity' and the oracle is
//               not called); any throw during a replay
//   ONOFF       off answer !== on answer; walker state (the snapshot minus
//               _fl / _fb / _fdepth / _fpath) on !== off; after a successful
//               positional op, splitAt, append or clear: the own view(s)'
//               finger on !== off (both NIL is equal; else fl, fb, depth and
//               _fpath[0..depth))
//   C-26        a successful positional op adds exactly 1 to fingerHits +
//               fingerMisses of its view and 0 elsewhere; every other op and
//               every throw adds 0; the off run adds 0 to fingerHits
//   C-27        after indexAtSum / sumBefore / total: every on-run finger is
//               equal to a pre-op COPY of its value (fl; unless fl is NIL,
//               also fb, depth and _fpath[0..depth); C-28 I-9 (a)) and
//               every off-run _fl is still NIL
//   BUDGET      applied > cap (one application = one op on one on / off pair,
//               replays and sweep landings included)
//   lane closers (R1-6): LANE 'applied 0'; LANE 'unseen n=k' (bfs, k in
//   0..nMax); SWEEP 'no states' (no state with n <= nSweep).
// The sweep landing runs on the on run only and is checked by walker(on),
// SWEEP, ORACLE and C-26; replays are unchecked except throw -> ORACLE.
//
// Cells (C-32, R1-1), from the on run's per-op COUNTERS delta summed over the
// views (0003 idx: moves 2, merges 4, equalizes 5, rotSingle 6, rotDouble 7,
// seamRepairs 11): rotSingle / rotDouble @insertAt / @removeAt add the delta;
// at B = 8 only, a removeAt with merges > 0 adds 1 to mergeMoves when moves -
// removeMoves(m, m, p, 0, 0) > 0 (p = i - fb of the pre-op leaf u, which has
// size m), a removeAt with equalizes > 0 adds 1 to 'equalize' + k (k = the
// pre-op size of T-6's neighbour v: the next leaf when u is a left child,
// else the previous one), splitAt with seamRepairs 1 / 2 adds to splitAt1 /
// splitAt2, append with seamRepairs 1 adds to append1.
//
// Deep lane (C-32 / C-34): op 0x9E3779B9^s, index 0x85EBCA6B^s, measure
// 0xC2B2AE35^s, xorshift32 (x^=x<<13; x^=x>>>17; x^=x<<5; x>>>0). class =
// op draw % 100 over grow 61/16/4/4/4/4/4/3 or drain 16/61/4/4/4/4/4/3
// (insertAt / removeAt / setMeasure / getMeasure / entityAt / indexAtSum /
// sumBefore / splitAt+append), floor(o/2500) even = grow. Redrawn (not
// counted): a dropped class, insertAt at n >= nHi, removeAt at n <= nLo,
// setMeasure / getMeasure / entityAt at n === 0. Index r: r&1 ->
// clamp(last + (r>>>1)%3 - 1, 0, range-1), else (r>>>1) % range; range = n+1
// for insertAt / sumBefore / splitAt, else n; indexAtSum draws no index.
// Measure r: 0 when (r>>>16) % 20 === 0 (5%), else r % 1000; indexAtSum y =
// r % (total + 1). Entity o. Fixed clears (C-34): after op o with o % 5000 ===
// 4999, clear(view a) then clear(view b). The lane starts empty, single view
// pair (view b is the splitAt scratch), C = nHi.
//
// ITERATIVE: no function in this file calls itself (0001 DB-8 M-3 (b)).
// Imports: walk / CODES from ./walker.mjs, Oracle from ./oracle.mjs,
// removeMoves from ./spec-counts.mjs; factories come in as the f argument.
// ASCII only.
//
// MIT (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>

import { walk, CODES as WALK_CODES } from './walker.mjs';
import { Oracle } from './oracle.mjs';
import { removeMoves } from './spec-counts.mjs';

export const CODES = Object.freeze(WALK_CODES.concat([
  'I-4', 'ORACLE', 'SWEEP', 'ONOFF', 'C-26', 'C-27', 'BUDGET', 'LANE',
]));

export const ENGINE = Object.freeze({
  cap: 4194304, // 2^22
  nMax: Object.freeze({ 4: 9, 8: 15 }),
  nSweep: Object.freeze({ 4: 7, 8: 12 }),
  deepOps: 20000,
  deepN: Object.freeze({ 4: Object.freeze([8, 48]), 8: Object.freeze([16, 96]) }),
});

export const CAPS = Object.freeze({
  cap: 262144, // 2^18
  nMax: Object.freeze({ 4: 6, 8: 10 }),
  nSweep: Object.freeze({ 4: 5, 8: 9 }),
  deepOps: 4000,
  deepN: Object.freeze({ 4: Object.freeze([8, 48]), 8: Object.freeze([16, 96]) }),
});

const EX_CELLS4 = Object.freeze([
  'rotSingle@insertAt', 'rotSingle@removeAt', 'rotDouble@insertAt', 'rotDouble@removeAt',
]);
const EX_CELLS8 = Object.freeze(EX_CELLS4.concat([
  'mergeMoves', 'equalize4', 'equalize5', 'equalize6', 'equalize7', 'equalize8',
  'splitAt1', 'splitAt2', 'append1',
]));

const EX_N_MOVES = 2;
const EX_N_MERGES = 4;
const EX_N_EQUALIZES = 5;
const EX_N_ROT_SINGLE = 6;
const EX_N_ROT_DOUBLE = 7;
const EX_N_HITS = 8;
const EX_N_MISSES = 9;
const EX_N_SEAMS = 11;

const EX_OPS = Object.freeze([
  'insertAt', 'removeAt', 'setMeasure', 'getMeasure', 'entityAt',
  'indexAtSum', 'sumBefore', 'total', 'splitAt', 'append', 'clear',
]);
const EX_POSITIONAL = Object.freeze(['insertAt', 'removeAt', 'setMeasure', 'getMeasure', 'entityAt']);
const EX_NEUTRAL = Object.freeze(['indexAtSum', 'sumBefore', 'total']);
const EX_DROPPABLE = Object.freeze([
  'insertAt', 'removeAt', 'setMeasure', 'getMeasure', 'entityAt',
  'indexAtSum', 'sumBefore', 'splitAt', 'append',
]);
const EX_FINGER = Object.freeze(['_fl', '_fb', '_fdepth', '_fpath']);

// C-34 deep classes and weights (sum 100 each).
const EX_CLASSES = Object.freeze([
  'insertAt', 'removeAt', 'setMeasure', 'getMeasure', 'entityAt', 'indexAtSum', 'sumBefore', 'splitAt',
]);
const EX_W_GROW = Object.freeze([61, 16, 4, 4, 4, 4, 4, 3]);
const EX_W_DRAIN = Object.freeze([16, 61, 4, 4, 4, 4, 4, 3]);
const EX_SEED_OP = 0x9E3779B9;
const EX_SEED_INDEX = 0x85EBCA6B;
const EX_SEED_MEASURE = 0xC2B2AE35;
const EX_REDRAW_MAX = 100000;

const EX_BFS_KEYS = Object.freeze(['B', 'nMax', 'walker', 'cap', 'drop', 'cfg']);
const EX_SWEEP_KEYS = Object.freeze(['B', 'states', 'nSweep', 'suffixes', 'cap', 'cfg']);
const EX_DEEP_KEYS = Object.freeze(['B', 'ops', 'seed', 'nLo', 'nHi', 'drop', 'cap', 'cfg']);

// ---- cold helpers -------------------------------------------------------------

function exBad(what, detail) {
  throw new RangeError(what + ': ' + detail);
}

function exOpts(o, legal, what) {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) exBad(what, 'options must be a plain object');
  const p = Object.getPrototypeOf(o);
  if (p !== Object.prototype && p !== null) exBad(what, 'options must be a plain object');
  const keys = Object.keys(o);
  for (let k = 0; k < keys.length; k++) {
    if (!legal.includes(keys[k])) {
      exBad(what, 'unknown option ' + keys[k] + ' (legal: ' + legal.join(', ') + ')');
    }
  }
}

function exInt(x) {
  return typeof x === 'number' && Number.isInteger(x);
}

function exB(B, what) {
  if (B !== 4 && B !== 8) exBad(what, 'B must be 4 or 8');
}

function exCap(cap, what) {
  if (cap === undefined) return CAPS.cap;
  if (!exInt(cap) || cap < 1) exBad(what, 'cap must be an integer >= 1');
  return cap;
}

function exDrop(drop, what) {
  if (drop === undefined) return [];
  if (!Array.isArray(drop)) exBad(what, 'drop must be an array of op names');
  for (let k = 0; k < drop.length; k++) {
    if (!EX_DROPPABLE.includes(drop[k])) {
      exBad(what, 'drop: unknown op (legal: ' + EX_DROPPABLE.join(', ') + ')');
    }
  }
  return drop.slice();
}

function exDropped(drop, op) {
  if (op === 'splitAt' || op === 'append') return drop.includes('splitAt') || drop.includes('append');
  return drop.includes(op);
}

function exXs(x) {
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}

function exM(k) {
  return 1 + (k % 3);
}

// ---- tallies and cells ----------------------------------------------------------

export function CELLS(B) {
  if (B === 4) return EX_CELLS4;
  if (B === 8) return EX_CELLS8;
  throw new RangeError('CELLS: B must be 4 or 8');
}

function exTallyNew(B) {
  const t = {};
  const cells = CELLS(B);
  for (let k = 0; k < cells.length; k++) t[cells[k]] = 0;
  return t;
}

export function coverageMissing(tally, B) {
  if (tally === null || typeof tally !== 'object') throw new TypeError('coverageMissing: tally must be an object');
  const cells = CELLS(B);
  const out = [];
  for (let k = 0; k < cells.length; k++) {
    if (!(tally[cells[k]] >= 1)) out.push(cells[k]);
  }
  return out;
}

export function assertCoverage(tally, B) {
  const names = coverageMissing(tally, B);
  if (names.length !== 0) throw new RangeError('coverage: missing ' + names.join(', '));
}

export function mergeTally(a, b) {
  if (a === null || typeof a !== 'object' || b === null || typeof b !== 'object') {
    throw new TypeError('mergeTally: tallies must be objects');
  }
  const out = {};
  const ka = Object.keys(a);
  for (let k = 0; k < ka.length; k++) out[ka[k]] = a[ka[k]];
  const kb = Object.keys(b);
  for (let k = 0; k < kb.length; k++) {
    const c = kb[k];
    out[c] = (c in out ? out[c] : 0) + b[c];
  }
  return out;
}

// ---- snapshot readers (iterative) -------------------------------------------------

// In-order leaves of one view: refs, first indexes, and the side (0 = left
// child, 1 = right child, -1 = root leaf). ok false on a malformed tree.
function exLeaves(snap, v) {
  const root = snap.views[v]._root;
  const out = { ok: true, refs: [], first: [], side: [] };
  if (root === snap.EMPTY_ROOT) return out;
  const int = snap.int;
  const leaf = snap.leaf;
  const stack = [root, -1];
  let steps = 0;
  let fb = 0;
  const limit = 2 * (int.size + leaf.size) + 4;
  while (stack.length !== 0) {
    const side = stack.pop();
    const ref = stack.pop();
    if (++steps > limit) { out.ok = false; return out; }
    if (exInt(ref) && ref >= 0 && ref < int.size) {
      stack.push(int.right[ref], 1, int.left[ref], 0);
    } else if (exInt(ref) && ref < 0 && ~ref < leaf.size) {
      out.refs.push(ref);
      out.first.push(fb);
      out.side.push(side);
      fb += leaf.len[~ref];
    } else {
      out.ok = false;
      return out;
    }
  }
  return out;
}

// Shape key: per view, the tree structure with leaf lengths, no ids.
function exKey(snap) {
  const int = snap.int;
  const leaf = snap.leaf;
  const limit = 2 * (int.size + leaf.size) + 4;
  const parts = [];
  for (let v = 0; v < snap.views.length; v++) {
    const root = snap.views[v]._root;
    if (root === snap.EMPTY_ROOT) { parts.push('E'); continue; }
    const out = [];
    const stack = [root];
    let steps = 0;
    while (stack.length !== 0) {
      const x = stack.pop();
      if (++steps > limit) { out.push('#'); break; }
      if (x === ')') { out.push(')'); continue; }
      if (exInt(x) && x >= 0 && x < int.size) {
        out.push('(');
        stack.push(')', int.right[x], int.left[x]);
      } else if (exInt(x) && x < 0 && ~x < leaf.size) {
        out.push(leaf.len[~x] + ',');
      } else {
        out.push('?');
      }
    }
    parts.push(out.join(''));
  }
  return parts.join('|');
}

// Walker state (C-27): the snapshot minus the four finger fields of each view.
function exState(snap) {
  const out = {};
  const keys = Object.keys(snap);
  for (let k = 0; k < keys.length; k++) {
    if (keys[k] !== 'views') out[keys[k]] = snap[keys[k]];
  }
  out.views = [];
  for (let v = 0; v < snap.views.length; v++) {
    const w = snap.views[v];
    const c = {};
    const wk = Object.keys(w);
    for (let k = 0; k < wk.length; k++) {
      if (!EX_FINGER.includes(wk[k])) c[wk[k]] = w[wk[k]];
    }
    out.views.push(c);
  }
  return out;
}

// Iterative deep equality; returns null or the path of the first difference.
function exDiff(x, y) {
  const stack = [x, y, ''];
  while (stack.length !== 0) {
    const path = stack.pop();
    const b = stack.pop();
    const a = stack.pop();
    if (Object.is(a, b)) continue;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return path || '.';
    if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
      if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b) || a.constructor !== b.constructor ||
          a.length !== b.length) return path + ' (typed array)';
      for (let k = 0; k < a.length; k++) {
        if (!Object.is(a[k], b[k])) return path + '[' + k + ']';
      }
      continue;
    }
    if (Array.isArray(a) !== Array.isArray(b)) return path + ' (array)';
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return path + ' (keys)';
    for (let k = 0; k < ka.length; k++) {
      if (!Object.hasOwn(b, ka[k])) return path + '.' + ka[k] + ' (missing)';
      stack.push(a[ka[k]], b[ka[k]], path + '.' + ka[k]);
    }
  }
  return null;
}

// ---- runs and pairs ----------------------------------------------------------------

function exRun(ctx) {
  const r = ctx.f(ctx.C, { leafSize: ctx.B, dims: 1 }, 2, ctx.cfg);
  if (r === null || typeof r !== 'object' || !Array.isArray(r.views) || r.views.length !== 2 ||
      typeof r.snapshot !== 'function') {
    throw new TypeError('exhaustive: the factory must return {views (2), snapshot()}');
  }
  return { views: r.views, snapshot: r.snapshot };
}

function exPair(ctx) {
  return { on: exRun(ctx), off: exRun(ctx), or: [new Oracle(1), new Oracle(1)] };
}

function exNil(ctx, views) {
  for (let v = 0; v < views.length; v++) {
    views[v]._fl = ctx.NIL;
    views[v]._fb = 0;
    views[v]._fdepth = 0;
  }
}

function exFingers(views) {
  const out = [];
  for (let v = 0; v < views.length; v++) {
    const w = views[v];
    out.push({ fl: w._fl, fb: w._fb, depth: w._fdepth, path: new Int32Array(w._fpath) });
  }
  return out;
}

function exCounts(views) {
  const out = [];
  for (let v = 0; v < views.length; v++) out.push(views[v]._n.slice());
  return out;
}

function exInvoke(views, x) {
  const a = views[0];
  const b = views[1];
  try {
    let v;
    switch (x.op) {
      case 'insertAt': v = a.insertAt(x.i, x.e, x.m); break;
      case 'removeAt': v = a.removeAt(x.i); break;
      case 'setMeasure': v = a.setMeasure(x.i, 0, x.m); break;
      case 'getMeasure': v = a.getMeasure(x.i, 0); break;
      case 'entityAt': v = a.entityAt(x.i); break;
      case 'indexAtSum': v = a.indexAtSum(0, x.y); break;
      case 'sumBefore': v = a.sumBefore(0, x.i); break;
      case 'total': v = a.total(0); break;
      case 'splitAt': v = a.splitAt(x.i, b); break;
      case 'append': v = a.append(b); break;
      default: v = views[x.i].clear(); break; // 'clear' (EX_OPS checked by the caller)
    }
    if (v !== null && typeof v === 'object') {
      const k = views.indexOf(v);
      return { kind: k >= 0 ? 'view' : 'object', v: k };
    }
    return { kind: 'value', v: v };
  } catch (err) {
    if (err instanceof RangeError) return { kind: 'throw', v: String(err.message).split(' ', 1)[0] };
    return { kind: 'error', v: String(err && err.message) };
  }
}

function exSameResult(r, s) {
  return r.kind === s.kind && Object.is(r.v, s.v);
}

function exShow(r) {
  return r.kind + ' ' + String(r.v);
}

// The oracle's answer; C-10 capacity is the driver's (the oracle is not called).
function exExpect(ctx, P, x) {
  const oa = P.or[0];
  if (x.op === 'insertAt' && exInt(x.i) && x.i >= 0 && x.i <= oa.length &&
      oa.length + P.or[1].length + 1 > ctx.C) {
    return { kind: 'throw', v: 'capacity' };
  }
  return exInvoke(P.or, x);
}

function exArgs(P, entry, k) {
  if (entry === null || typeof entry !== 'object' || !EX_OPS.includes(entry.op)) {
    throw new TypeError('exhaustive: witness entry ' + k + ' is not an {op, i} with a known op');
  }
  const x = { op: entry.op, i: entry.i, e: k & 0x3FFFFFFF, m: exM(k), y: 0 };
  if (x.op === 'indexAtSum') x.y = P.or[0].sumBefore(0, x.i);
  return x;
}

function exFail(ctx, run, code, detail, op, n, wl) {
  ctx.first = { lane: ctx.lane, run: run, code: code, detail: detail, op: op, n: n, witnessLength: wl };
  if (code === 'I-4' || code === 'ORACLE') ctx.divergences++;
  return true;
}

function exBudget(ctx, x, n, wl) {
  if (ctx.applied > ctx.cap) {
    return exFail(ctx, 'on', 'BUDGET', 'applied ' + ctx.applied + ' > cap ' + ctx.cap, x.op, n, wl);
  }
  return false;
}

// Lane start: NIL / EMPTY_ROOT from a fresh view, hasOwn (C-27), _n (C-26).
function exStart(ctx) {
  const on = exRun(ctx);
  const off = exRun(ctx);
  const v0 = on.views[0];
  ctx.NIL = v0._fl;
  ctx.ER = v0._root;
  if (ctx.ER === 0) return exFail(ctx, 'on', 'C-27', 'empty-root: EMPTY_ROOT is 0', null, 0, 0);
  const runs = [on, off];
  const names = ['on', 'off'];
  for (let r = 0; r < 2; r++) {
    for (let v = 0; v < 2; v++) {
      const w = runs[r].views[v];
      for (let k = 0; k < EX_FINGER.length; k++) {
        if (!Object.hasOwn(w, EX_FINGER[k])) {
          return exFail(ctx, 'off', 'C-27', 'hasOwn: view ' + v + ' (' + names[r] + ') has no own ' +
            EX_FINGER[k], null, 0, 0);
        }
      }
      if (!(w._n instanceof Int32Array) || w._n.length !== 12) {
        return exFail(ctx, names[r], 'C-26', 'counters: view ' + v + ' has no Int32Array(12) _n', null, 0, 0);
      }
    }
  }
  return false;
}

// Replay a witness on a fresh pair: unchecked except throw -> ORACLE; BUDGET.
function exReplay(ctx, P, witness) {
  for (let k = 0; k < witness.length; k++) {
    const x = exArgs(P, witness[k], k);
    const n = P.or[0].length;
    exNil(ctx, P.off.views);
    const rOn = exInvoke(P.on.views, x);
    const rOff = exInvoke(P.off.views, x);
    const rEx = exExpect(ctx, P, x);
    ctx.applied++;
    const bad = rOn.kind === 'throw' || rOn.kind === 'error' ? ['on', rOn]
      : rOff.kind === 'throw' || rOff.kind === 'error' ? ['off', rOff]
        : rEx.kind === 'throw' || rEx.kind === 'error' ? ['on', rEx] : null;
    if (bad !== null) {
      return exFail(ctx, bad[0], 'ORACLE', 'replay: ' + x.op + '(' + x.i + ') threw ' + exShow(bad[1]),
        x.op, n, k + 1);
    }
    if (exBudget(ctx, x, n, k + 1)) return true;
  }
  return false;
}

function exFingerSame(ctx, f, g) {
  if (f._fl === ctx.NIL && g._fl === ctx.NIL) return true;
  if (f._fl !== g._fl || f._fb !== g._fb || f._fdepth !== g._fdepth) return false;
  for (let k = 0; k < f._fdepth; k++) {
    if (f._fpath[k] !== g._fpath[k]) return false;
  }
  return true;
}

function exCells(ctx, x, pre, c0, c1) {
  const t = ctx.tally;
  let dMoves = 0;
  let dMerges = 0;
  let dEq = 0;
  let dRs = 0;
  let dRd = 0;
  let dSeams = 0;
  for (let v = 0; v < c0.length; v++) {
    dMoves += c1[v][EX_N_MOVES] - c0[v][EX_N_MOVES];
    dMerges += c1[v][EX_N_MERGES] - c0[v][EX_N_MERGES];
    dEq += c1[v][EX_N_EQUALIZES] - c0[v][EX_N_EQUALIZES];
    dRs += c1[v][EX_N_ROT_SINGLE] - c0[v][EX_N_ROT_SINGLE];
    dRd += c1[v][EX_N_ROT_DOUBLE] - c0[v][EX_N_ROT_DOUBLE];
    dSeams += c1[v][EX_N_SEAMS] - c0[v][EX_N_SEAMS];
  }
  if (x.op === 'insertAt') {
    t['rotSingle@insertAt'] += dRs;
    t['rotDouble@insertAt'] += dRd;
    return;
  }
  if (x.op === 'removeAt') {
    t['rotSingle@removeAt'] += dRs;
    t['rotDouble@removeAt'] += dRd;
    if (ctx.B !== 8 || pre === null || (dMerges <= 0 && dEq <= 0)) return;
    const lv = exLeaves(pre, 0);
    if (!lv.ok) return;
    let u = -1;
    for (let k = 0; k < lv.refs.length; k++) {
      const len = pre.leaf.len[~lv.refs[k]];
      if (lv.first[k] <= x.i && x.i < lv.first[k] + len) { u = k; break; }
    }
    if (u < 0 || lv.side[u] < 0) return;
    const m = ctx.B / 4;
    const s = pre.leaf.len[~lv.refs[u]];
    const p = x.i - lv.first[u];
    if (dMerges > 0 && s === m && dMoves - removeMoves(m, m, p, 0, 0) > 0) t.mergeMoves++;
    if (dEq > 0) {
      const jv = lv.side[u] === 0 ? u + 1 : u - 1;
      if (jv >= 0 && jv < lv.refs.length) {
        const k = pre.leaf.len[~lv.refs[jv]];
        const name = 'equalize' + k;
        if (Object.hasOwn(t, name)) t[name]++;
      }
    }
    return;
  }
  if (ctx.B !== 8) return;
  if (x.op === 'splitAt') {
    if (dSeams === 1) t.splitAt1++;
    else if (dSeams === 2) t.splitAt2++;
  } else if (x.op === 'append' && dSeams === 1) {
    t.append1++;
  }
}

// One checked op on the pair (landing = null) or a sweep landing on the on run
// only (landing = the in-order leaf index j and its ref). Returns true on a failure.
function exStep(ctx, P, x, wl, landing) {
  const hasOff = landing === null;
  const n = P.or[0].length;
  const neutral = EX_NEUTRAL.includes(x.op);
  const positional = EX_POSITIONAL.includes(x.op);
  if (hasOff) exNil(ctx, P.off.views);
  const preOn = neutral ? exFingers(P.on.views) : null;
  const pre = ctx.tally !== null && ctx.B === 8 && x.op === 'removeAt' ? P.on.snapshot() : null;
  const c0on = exCounts(P.on.views);
  const c0off = hasOff ? exCounts(P.off.views) : null;
  const rOn = exInvoke(P.on.views, x);
  const rOff = hasOff ? exInvoke(P.off.views, x) : null;
  const rEx = exExpect(ctx, P, x);
  ctx.applied++;
  const op = x.op;
  // walker(on)
  const sOn = P.on.snapshot();
  if (ctx.walker) {
    const w = walk(sOn, { B: ctx.B, dims: 1 });
    if (w !== null) return exFail(ctx, 'on', w.code, w.detail, op, n, wl);
  }
  // sweep landing
  if (!hasOff && sOn.views[0]._fl !== landing.ref) {
    return exFail(ctx, 'on', 'SWEEP', 'landing: getMeasure(' + x.i + ', 0) left fl ' + sOn.views[0]._fl +
      ', leaf ' + landing.j + ' is ' + landing.ref, op, n, wl);
  }
  // walker(off)
  const sOff = hasOff ? P.off.snapshot() : null;
  if (hasOff && ctx.walker) {
    const w = walk(sOff, { B: ctx.B, dims: 1 });
    if (w !== null) return exFail(ctx, 'off', w.code, w.detail, op, n, wl);
  }
  // oracle
  if (!exSameResult(rOn, rEx)) {
    const code = op === 'indexAtSum' && rOn.kind === 'value' && rEx.kind === 'value' ? 'I-4' : 'ORACLE';
    return exFail(ctx, 'on', code, 'answer: ' + op + '(' + x.i + ') gave ' + exShow(rOn) + ', oracle ' +
      exShow(rEx), op, n, wl);
  }
  const ok = rOn.kind !== 'throw' && rOn.kind !== 'error';
  // ONOFF
  if (hasOff) {
    if (!exSameResult(rOff, rOn)) {
      return exFail(ctx, 'off', 'ONOFF', 'answer: off ' + exShow(rOff) + ', on ' + exShow(rOn), op, n, wl);
    }
    const d = exDiff(exState(sOn), exState(sOff));
    if (d !== null) return exFail(ctx, 'off', 'ONOFF', 'state: ' + d, op, n, wl);
    if (ok && (positional || op === 'splitAt' || op === 'append' || op === 'clear')) {
      const own = positional ? [0] : op === 'clear' ? [x.i] : [0, 1];
      for (let k = 0; k < own.length; k++) {
        const v = own[k];
        if (!exFingerSame(ctx, sOn.views[v], sOff.views[v])) {
          return exFail(ctx, 'off', 'ONOFF', 'finger: view ' + v + ' on fl ' + sOn.views[v]._fl + ' fb ' +
            sOn.views[v]._fb + ' depth ' + sOn.views[v]._fdepth + ', off fl ' + sOff.views[v]._fl + ' fb ' +
            sOff.views[v]._fb + ' depth ' + sOff.views[v]._fdepth, op, n, wl);
        }
      }
    }
  }
  // C-26
  const c1on = exCounts(P.on.views);
  const runs = hasOff ? [[c0on, c1on, 'on'], [c0off, exCounts(P.off.views), 'off']] : [[c0on, c1on, 'on']];
  for (let r = 0; r < runs.length; r++) {
    const c0 = runs[r][0];
    const c1 = runs[r][1];
    for (let v = 0; v < c0.length; v++) {
      const dh = c1[v][EX_N_HITS] - c0[v][EX_N_HITS];
      const dm = c1[v][EX_N_MISSES] - c0[v][EX_N_MISSES];
      const want = ok && positional && v === 0 ? 1 : 0;
      const bad = want === 1 ? !((dh === 1 && dm === 0) || (dh === 0 && dm === 1)) : (dh !== 0 || dm !== 0);
      if (bad || (runs[r][2] === 'off' && dh !== 0)) {
        return exFail(ctx, runs[r][2], 'C-26', 'partition: ' + op + ' view ' + v + ' hits +' + dh +
          ' misses +' + dm, op, n, wl);
      }
    }
  }
  // C-27 (finger-neutral ops)
  if (neutral) {
    for (let v = 0; v < P.on.views.length; v++) {
      const w = P.on.views[v];
      const f = preOn[v];
      let same = w._fl === f.fl;
      if (same && f.fl !== ctx.NIL) {
        same = w._fb === f.fb && w._fdepth === f.depth;
        for (let k = 0; same && k < f.depth; k++) same = w._fpath[k] === f.path[k];
      }
      if (!same) return exFail(ctx, 'on', 'C-27', 'neutral: ' + op + ' moved the on finger of view ' + v, op, n, wl);
    }
    if (hasOff) {
      for (let v = 0; v < P.off.views.length; v++) {
        const w = P.off.views[v];
        if (w._fl !== ctx.NIL) {
          return exFail(ctx, 'off', 'C-27', 'neutral: ' + op + ' wrote the off finger of view ' + v, op, n, wl);
        }
      }
    }
  }
  // BUDGET
  if (exBudget(ctx, x, n, wl)) return true;
  if (ok && hasOff && ctx.tally !== null) exCells(ctx, x, pre, c0on, c1on);
  if (ctx.trackLeaves) {
    let L = 0;
    for (let v = 0; v < sOn.views.length; v++) L += exLeaves(sOn, v).refs.length;
    if (L > ctx.maxLeaves) ctx.maxLeaves = L;
  }
  return false;
}

function exCtx(lane, f, B, C, cap, cfg, walker, drop, tally) {
  if (typeof f !== 'function') throw new TypeError(lane + 'Lane: f must be a factory function');
  return {
    lane: lane, f: f, B: B, C: C, cap: cap, cfg: cfg === undefined || cfg === null ? {} : cfg,
    walker: walker, drop: drop, tally: tally ? exTallyNew(B) : null, NIL: 0, ER: 0,
    applied: 0, divergences: 0, first: null, trackLeaves: false, maxLeaves: 0,
  };
}

function exReport(ctx) {
  return {
    ok: ctx.first === null, first: ctx.first, applied: ctx.applied, divergences: ctx.divergences,
    tally: ctx.tally === null ? exTallyNew(ctx.B) : ctx.tally,
  };
}

// ---- lanes -----------------------------------------------------------------------

export function bfsLane(f, opts) {
  exOpts(opts, EX_BFS_KEYS, 'bfsLane');
  const B = opts.B;
  exB(B, 'bfsLane');
  const nMax = opts.nMax;
  if (!exInt(nMax) || nMax < 0) exBad('bfsLane', 'nMax must be an integer >= 0');
  const walker = opts.walker === undefined ? true : opts.walker;
  if (typeof walker !== 'boolean') exBad('bfsLane', 'walker must be a boolean');
  const ctx = exCtx('bfs', f, B, Math.max(nMax, 1), exCap(opts.cap, 'bfsLane'), opts.cfg, walker,
    exDrop(opts.drop, 'bfsLane'), true);
  const states = [];
  const rep = exReport(ctx);
  rep.states = states;
  if (exStart(ctx)) return Object.assign(rep, exReport(ctx));
  const seen = new Map();
  const empty = exPair(ctx);
  const k0 = exKey(empty.on.snapshot());
  seen.set(k0, true);
  states.push({ key: k0, n: 0, witness: [] });
  const trans = [];
  for (let q = 0; q < states.length; q++) {
    const st = states[q];
    const n = st.n;
    trans.length = 0;
    if (n < nMax && !exDropped(ctx.drop, 'insertAt')) {
      for (let i = 0; i <= n; i++) trans.push([{ op: 'insertAt', i: i }]);
    }
    if (!exDropped(ctx.drop, 'removeAt')) {
      for (let i = 0; i < n; i++) trans.push([{ op: 'removeAt', i: i }]);
    }
    if (!exDropped(ctx.drop, 'splitAt')) {
      for (let i = 0; i <= n; i++) trans.push([{ op: 'splitAt', i: i }, { op: 'append', i: 0 }]);
    }
    for (let t = 0; t < trans.length; t++) {
      const P = exPair(ctx);
      if (exReplay(ctx, P, st.witness)) return Object.assign(rep, exReport(ctx));
      const tr = trans[t];
      for (let s = 0; s < tr.length; s++) {
        const k = st.witness.length + s;
        if (exStep(ctx, P, exArgs(P, tr[s], k), k + 1, null)) return Object.assign(rep, exReport(ctx));
      }
      const key = exKey(P.on.snapshot());
      if (!seen.has(key)) {
        seen.set(key, true);
        states.push({ key: key, n: P.or[0].length, witness: st.witness.concat(tr) });
      }
    }
  }
  if (ctx.applied === 0) exFail(ctx, 'on', 'LANE', 'closer: applied 0', null, 0, 0);
  else {
    const have = new Set();
    for (let k = 0; k < states.length; k++) have.add(states[k].n);
    for (let n = 0; n <= nMax; n++) {
      if (!have.has(n)) { exFail(ctx, 'on', 'LANE', 'closer: unseen n=' + n, null, 0, 0); break; }
    }
  }
  return Object.assign(rep, exReport(ctx));
}

function exSuffixes(n) {
  const out = [];
  for (let i = 0; i <= n; i++) out.push({ op: 'insertAt', i: i });
  for (let p = 1; p < EX_POSITIONAL.length; p++) {
    for (let i = 0; i < n; i++) out.push({ op: EX_POSITIONAL[p], i: i });
  }
  for (let i = 0; i <= n; i++) out.push({ op: 'indexAtSum', i: i });
  for (let i = 0; i <= n; i++) out.push({ op: 'sumBefore', i: i });
  out.push({ op: 'total', i: 0 });
  for (let i = 0; i <= n; i++) out.push({ op: 'splitAt', i: i });
  out.push({ op: 'clear', i: 1 });
  out.push({ op: 'append', i: 0 });
  return out;
}

// The largest live count a witness reaches (views a and b).
function exWitnessLive(w) {
  let na = 0;
  let nb = 0;
  let top = 0;
  for (let k = 0; k < w.length; k++) {
    const e = w[k];
    if (e === null || typeof e !== 'object') continue;
    if (e.op === 'insertAt') na++;
    else if (e.op === 'removeAt') na--;
    else if (e.op === 'splitAt') { nb += na - e.i; na = e.i; }
    else if (e.op === 'append') { na += nb; nb = 0; }
    else if (e.op === 'clear') { if (e.i === 1) nb = 0; else na = 0; }
    if (na + nb > top) top = na + nb;
  }
  return top;
}

export function sweepLane(f, opts) {
  exOpts(opts, EX_SWEEP_KEYS, 'sweepLane');
  const B = opts.B;
  exB(B, 'sweepLane');
  const nSweep = opts.nSweep;
  if (!exInt(nSweep) || nSweep < 0) exBad('sweepLane', 'nSweep must be an integer >= 0');
  if (!Array.isArray(opts.states)) exBad('sweepLane', 'states must be an array');
  const suffixes = opts.suffixes === undefined ? true : opts.suffixes;
  if (typeof suffixes !== 'boolean') exBad('sweepLane', 'suffixes must be a boolean');
  const use = [];
  let C = nSweep + 1;
  for (let k = 0; k < opts.states.length; k++) {
    const s = opts.states[k];
    if (s === null || typeof s !== 'object' || !exInt(s.n) || !Array.isArray(s.witness)) {
      exBad('sweepLane', 'states[' + k + '] must be {n, witness}');
    }
    if (s.n <= nSweep) {
      use.push(s);
      C = Math.max(C, exWitnessLive(s.witness));
    }
  }
  const ctx = exCtx('sweep', f, B, C, exCap(opts.cap, 'sweepLane'), opts.cfg, true, [], false);
  if (use.length === 0) {
    exFail(ctx, 'on', 'SWEEP', 'closer: no states with n <= nSweep', null, 0, 0);
    return exReport(ctx);
  }
  if (exStart(ctx)) return exReport(ctx);
  for (let q = 0; q < use.length; q++) {
    const st = use[q];
    const w = st.witness;
    const list = suffixes ? exSuffixes(st.n) : [null];
    let L = -1;
    for (let j = -1; L < 0 || j < L; j++) {
      for (let s = 0; s < list.length; s++) {
        const P = exPair(ctx);
        if (exReplay(ctx, P, w)) return exReport(ctx);
        let wl = w.length;
        if (L < 0 || j >= 0) {
          const lv = exLeaves(P.on.snapshot(), 0);
          if (!lv.ok) return exFail(ctx, 'on', 'SWEEP', 'leaves: malformed tree after replay', null, st.n, wl) && exReport(ctx);
          if (L < 0) L = lv.refs.length;
          if (j >= 0) {
            wl++;
            const x = exArgs(P, { op: 'getMeasure', i: lv.first[j] }, wl - 1);
            if (exStep(ctx, P, x, wl, { j: j, ref: lv.refs[j] })) return exReport(ctx);
          }
        }
        if (j < 0) exNil(ctx, P.on.views);
        if (list[s] !== null) {
          wl++;
          if (exStep(ctx, P, exArgs(P, list[s], wl - 1), wl, null)) return exReport(ctx);
        }
      }
    }
  }
  if (ctx.applied === 0) exFail(ctx, 'on', 'LANE', 'closer: applied 0', null, 0, 0);
  return exReport(ctx);
}

export function deepLane(f, opts) {
  exOpts(opts, EX_DEEP_KEYS, 'deepLane');
  const B = opts.B;
  exB(B, 'deepLane');
  const ops = opts.ops;
  const seed = opts.seed;
  const nLo = opts.nLo;
  const nHi = opts.nHi;
  if (!exInt(ops) || ops < 0) exBad('deepLane', 'ops must be an integer >= 0');
  if (!exInt(seed)) exBad('deepLane', 'seed must be an integer');
  if (!exInt(nLo) || !exInt(nHi) || nLo < 0 || !(nLo < nHi)) {
    exBad('deepLane', 'nLo, nHi must be integers with 0 <= nLo < nHi');
  }
  const ctx = exCtx('deep', f, B, nHi, exCap(opts.cap, 'deepLane'), opts.cfg, true,
    exDrop(opts.drop, 'deepLane'), true);
  ctx.trackLeaves = true;
  const fin = () => Object.assign(exReport(ctx), { maxLeaves: ctx.maxLeaves });
  if (exStart(ctx)) return fin();
  const P = exPair(ctx);
  let so = (EX_SEED_OP ^ seed) >>> 0;
  let si = (EX_SEED_INDEX ^ seed) >>> 0;
  let sm = (EX_SEED_MEASURE ^ seed) >>> 0;
  let last = 0;
  for (let o = 0; o < ops; o++) {
    const w = ((Math.floor(o / 2500)) & 1) === 0 ? EX_W_GROW : EX_W_DRAIN;
    const n = P.or[0].length;
    let cls = -1;
    for (let redraw = 0; cls < 0; redraw++) {
      if (redraw > EX_REDRAW_MAX) {
        exFail(ctx, 'on', 'LANE', 'redraw: no drawable class at n=' + n, null, n, ctx.applied);
        return fin();
      }
      so = exXs(so);
      let r = so % 100;
      let c = 0;
      while (r >= w[c]) { r -= w[c]; c++; }
      const name = EX_CLASSES[c];
      if (exDropped(ctx.drop, name)) continue;
      if (name === 'insertAt' && n >= nHi) continue;
      if (name === 'removeAt' && n <= nLo) continue;
      if ((name === 'setMeasure' || name === 'getMeasure' || name === 'entityAt') && n === 0) continue;
      cls = c;
    }
    const name = EX_CLASSES[cls];
    const x = { op: name, i: 0, e: o & 0x3FFFFFFF, m: 0, y: 0 };
    if (name !== 'indexAtSum') {
      const range = name === 'insertAt' || name === 'sumBefore' || name === 'splitAt' ? n + 1 : n;
      si = exXs(si);
      if ((si & 1) === 1) x.i = Math.min(Math.max(last + ((si >>> 1) % 3) - 1, 0), range - 1);
      else x.i = (si >>> 1) % range;
      last = x.i;
    }
    if (name === 'insertAt' || name === 'setMeasure' || name === 'indexAtSum') {
      sm = exXs(sm);
      if (name === 'indexAtSum') x.y = sm % (P.or[0].total(0) + 1);
      else x.m = ((sm >>> 16) % 20) === 0 ? 0 : sm % 1000;
    }
    if (exStep(ctx, P, x, ctx.applied + 1, null)) return fin();
    if (name === 'splitAt') {
      const y = { op: 'append', i: 0, e: 0, m: 0, y: 0 };
      if (exStep(ctx, P, y, ctx.applied + 1, null)) return fin();
    }
    if ((o % 5000) === 4999) {
      for (let v = 0; v < 2; v++) {
        if (exStep(ctx, P, { op: 'clear', i: v, e: 0, m: 0, y: 0 }, ctx.applied + 1, null)) return fin();
      }
    }
  }
  if (ctx.applied === 0) exFail(ctx, 'on', 'LANE', 'closer: applied 0', null, 0, 0);
  return fin();
}
