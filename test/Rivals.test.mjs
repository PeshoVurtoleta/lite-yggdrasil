// test/Rivals.test.mjs -- the benchmark rivals against the independent oracle (Bench-ADOPT group 2a TASK 5;
// .handoff/PLAN-bench-adopt-g2a.md assertions A1, A3, A4, A5; SPEC bench-adopt BA-13, BA-13a, BA-14).
//
// Subjects: benchmark/rivals/BlockedArray.js as written ('unrolled') and its 'plain' variant
// (benchmark/rivals/variant.mjs), benchmark/rivals/FenwickRebuild.js in mode 'full', mode 'suffix' and the default
// mode. DETERMINISTIC: pinned seeds, xorshift streams (separate op / key / value / query streams), no timing.
//
// What it gates:
// - A1 / R1 differential vs test/oracle.mjs: after EVERY op of a seeded stream (insertAt / removeAt / setMeasure /
//   splitAt / append / clear over 2 or 3 views, dims 1..4) every entityAt / getMeasure at every d < dims, total(d),
//   sumBefore and the strict indexAtSum at every prefix boundary (y = S_i, S_i +- 0.5) vs a brute prefix of the
//   oracle's own arrays, plus direct oracle reads; the cursor (seekIndex / seekSum, then a walk of next() across
//   chunk ends, offset / measure / entity / index at every step); cursor invalidation (every successful mutator
//   invalidates its views' cursors, an untouched view keeps its cursor). FenwickRebuild also checks EVERY tree node
//   against the TRUE definition (node k = sum of the measures over 0-based [k - lsb(k), k)) and the per-op counter
//   model (R2). BlockedArray also checks the pool invariant (R6: every chunk in [B/4, B) when dirLen > 1, chunk
//   conservation freeTop + sum(dirLen) = maxChunks, liveElements). Coverage floors are asserted; the op count per
//   rival is pinned (OPS_PIN).
// - throw rows: >= 1 rejected op per token (index, entity, dim, measure, extra, headroom, seek, operand, capacity),
//   the token equal to the oracle's where the oracle models it, every rival view byte-identical after the throw
//   (cursor included). FenwickRebuild options / mode rows (R4), default mode (R3).
// - R5 BlockedArray split points (BA-14) at B = 8 / 12 / 16 / 32 / 64; A5 space numbers; A4 chunk retention.
// - mutants (count-checked text replacement, imported from a data: URL): each must FAIL its named battery; a
//   survivor fails this file.
// - one child process (--expose-gc + the meter flags): the A4 lite-leak row (+ its must-fail control) and the R7
//   rival meter lanes kernel-lane's laneSet does not run (getMeasure, entityAt, total, seekSum + 50 next) with two
//   must-fail controls (a .subarray() inside _locate; one box per op); and the EDIT lanes (interleaved
//   insertAt(length) / removeAt(0) on view 1 of a 3-view arena, unrolled + plain, dims 1 / 4, after a 60-window
//   warm-up: < 16 B per 2000-op call and < 1 B/op, split / merge / equalize counted) with two must-fail controls
//   (a .subarray() inside _merge; inside _equalize).
//
// Test harness only, never shipped. ASCII only. MIT (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Oracle, MAX } from './oracle.mjs';
import { SumSequence } from '../Yggdrasil.js';
import { meter, METER_REASON } from './meter-gate.mjs';
import { BlockedArray } from '../benchmark/rivals/BlockedArray.js';
import { FenwickRebuild } from '../benchmark/rivals/FenwickRebuild.js';
import { loadVariant } from '../benchmark/rivals/variant.mjs';

const FW_URL = new URL('../benchmark/rivals/FenwickRebuild.js', import.meta.url);
const BA_URL = new URL('../benchmark/rivals/BlockedArray.js', import.meta.url);
const FW_SRC = readFileSync(FW_URL, 'utf8');
const PKG = fileURLToPath(new URL('..', import.meta.url));

// ---- helpers ------------------------------------------------------------------------------------------------------

function xs(seed) {
  let s = (seed | 0) || 1;
  return (k) => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) % k;
  };
}

const lsb = (j) => j & -j;

function hunkApply(src, hunks, label) {
  let out = src;
  for (const [a, b] of hunks) {
    const n = out.split(a).length - 1;
    if (n !== 1) throw new Error('mutant ' + label + ': anchor matched ' + n + ' times, expected exactly 1');
    const at = out.indexOf(a);
    out = out.slice(0, at) + b + out.slice(at + a.length);
  }
  return out;
}

async function fwLoad(hunks, label) {
  const src = hunkApply(FW_SRC, hunks, label);
  return (await import('data:text/javascript;base64,' + Buffer.from(src, 'utf8').toString('base64'))).FenwickRebuild;
}

function prefixOf(dump, d) {
  const col = dump.measures[d];
  const p = [0];
  for (let i = 0; i < col.length; i++) p.push(p[i] + col[i]);
  return p;
}

// M-7 by its definition: smallest i with S_i + m_i > y, i.e. smallest k in [1, n] with p[k] > y, answer k - 1; else n.
function seekRef(p, y) {
  let lo = 1;
  let hi = p.length - 1;
  let ans = p.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (p[mid] > y) {
      ans = mid - 1;
      hi = mid - 1;
    } else lo = mid + 1;
  }
  return ans;
}

function tokenOf(fn) {
  try {
    fn();
    return 'NOTHROW';
  } catch (e) {
    return e instanceof RangeError ? String(e.message).split(' ')[0] : 'TYPE:' + (e && e.constructor && e.constructor.name);
  }
}

// ---- the differential (A1 / R1 / R2 / R6) ---------------------------------------------------------------------

const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8];
const OPS_PER_SEED = 2400;

function newCov() {
  return { ins: 0, rem: 0, set: 0, ins0: 0, insN: 0, rem0: 0, remLast: 0, remLastSfx: 0, toEmpty: 0, n1: 0, pow2big: 0, atCap: 0,
    splitIns: 0, mixedModes: 0, seedBreak: 0, appendSfx: 0, splits: 0, appends: 0, clears: 0, walkSteps: 0,
    baSplits: 0, baMerges: 0, baEqualizes: 0, baSeams: 0 };
}

function compareView(v, o, ctx, tag) {
  const D = o.dims;
  const dump = o.dump();
  const n = dump.entities.length;
  if (v.length !== n) return ctx.fail(tag + ' length ' + v.length + ' want ' + n);
  for (let i = 0; i < n; i++) {
    if (v.entityAt(i) !== dump.entities[i]) return ctx.fail(tag + ' entityAt(' + i + ')');
    for (let d = 0; d < D; d++) {
      if (!Object.is(v.getMeasure(i, d), dump.measures[d][i])) return ctx.fail(tag + ' getMeasure(' + i + ', ' + d + ')');
    }
  }
  const step = n <= 64 ? 1 : 1 + ((n / 48) | 0);
  for (let d = 0; d < D; d++) {
    const p = prefixOf(dump, d);
    if (v.total(d) !== p[n]) return ctx.fail(tag + ' total(' + d + ')');
    for (let i = 0; i <= n + step; i += step) {
      const j = i > n ? n : i;
      if (v.sumBefore(d, j) !== p[j]) return ctx.fail(tag + ' sumBefore(' + d + ', ' + j + ')');
      const y = p[j];
      if (v.indexAtSum(d, y) !== seekRef(p, y)) return ctx.fail(tag + ' indexAtSum(' + d + ', ' + y + ') boundary');
      if (v.indexAtSum(d, y + 0.5) !== seekRef(p, y + 0.5)) return ctx.fail(tag + ' indexAtSum(' + d + ', ' + y + '+0.5)');
      if (y > 0 && v.indexAtSum(d, y - 0.5) !== seekRef(p, y - 0.5)) return ctx.fail(tag + ' indexAtSum(' + d + ', ' + y + '-0.5)');
    }
    if (v.indexAtSum(d, p[n] + 1) !== n) return ctx.fail(tag + ' indexAtSum past total');
    const i0 = ctx.rq(n + 1);
    if (v.sumBefore(d, i0) !== o.sumBefore(d, i0)) return ctx.fail(tag + ' sumBefore vs oracle');
    const y0 = ctx.rq(p[n] + 2);
    if (v.indexAtSum(d, y0) !== o.indexAtSum(d, y0)) return ctx.fail(tag + ' indexAtSum vs oracle');
  }
  return true;
}

function walk(vc, oc, dump, P, D, ctx, tag, steps) {
  for (let s = 0; s <= steps; s++) {
    const ok = oc.valid;
    const idx = oc.index;
    if (vc.valid !== ok || vc.index !== idx || vc.entity !== oc.entity) {
      return ctx.fail(tag + ' step ' + s + ' valid/index/entity ' + vc.valid + '/' + vc.index + ' want ' + ok + '/' + idx);
    }
    for (let d = 0; d < D; d++) {
      const wo = ok ? P[d][idx] : NaN;
      const wm = ok ? dump.measures[d][idx] : NaN;
      if (!Object.is(vc.offset(d), wo)) return ctx.fail(tag + ' step ' + s + ' offset(' + d + ')');
      if (!Object.is(vc.measure(d), wm)) return ctx.fail(tag + ' step ' + s + ' measure(' + d + ')');
    }
    ctx.res.cov.walkSteps++;
    if (vc.next() !== oc.next()) return ctx.fail(tag + ' step ' + s + ' next()');
    if (!ok) break; // next() on an invalid cursor was checked once
  }
  return true;
}

function cursorCheck(v, o, ctx, tag) {
  const dump = o.dump();
  const n = dump.entities.length;
  const D = o.dims;
  const P = [];
  for (let d = 0; d < D; d++) P.push(prefixOf(dump, d));
  const vc = v.cursor();
  const oc = o.cursor();
  if (v.cursor() !== vc) return ctx.fail(tag + ' cursor() identity');
  const i = [0, n, Math.max(0, n - 1), ctx.rq(n + 1)][ctx.rq(4)];
  if (vc.seekIndex(i) !== oc.seekIndex(i)) return ctx.fail(tag + ' seekIndex(' + i + ') result');
  if (walk(vc, oc, dump, P, D, ctx, tag + ' seekIndex(' + i + ')', 50) !== true) return false;
  const d = ctx.rq(D);
  const p = P[d];
  const j = ctx.rq(n + 1);
  const y = [p[j], p[j] + 0.5, Math.max(0, p[j] - 0.5), p[n], p[n] + 1, 0][ctx.rq(6)];
  if (vc.seekSum(d, y) !== oc.seekSum(d, y)) return ctx.fail(tag + ' seekSum(' + d + ', ' + y + ') result');
  return walk(vc, oc, dump, P, D, ctx, tag + ' seekSum(' + d + ', ' + y + ')', 20);
}

// One op of the stream on view w (and o for splitAt / append), mirrored on the oracles. Returns the op info.
function stepOnce(ctx, t) {
  const { views, ors, kind, dims, rOp, rKey, rVal, res } = ctx;
  const cov = res.cov;
  const V = views.length;
  const w = rOp(10) < 7 ? 0 : 1 + rOp(V - 1);
  const o = (w + 1 + rOp(V - 1)) % V;
  const v = views[w];
  const ov = ors[w];
  const n = ov.length;
  const phase = ((t / 150) | 0) % 4;
  // phases of 150 ops: 0 grow (85% insertAt), 1 mixed point edits, 2 shrink (85% removeAt), 3 bulk (splitAt /
  // append / clear as drawn); phases 0-2 never split, append or clear, so n reaches C and the powers of two.
  let p = rOp(100);
  if (phase === 0) p = p < 85 ? 0 : 50 + (p % 36);
  else if (phase === 1) p %= 86;
  else if (phase === 2) p = p < 85 ? 50 : p % 86;
  for (let z = 0; z < V; z++) {
    if (ors[z].length > 0) {
      views[z].cursor().seekIndex(0);
      ors[z].cursor().seekIndex(0);
    }
  }
  const pre = kind.pre ? kind.pre(views) : null;
  let info;
  if (p < 45 && kind.canInsert(ctx, w)) {
    const i = [0, n, Math.max(0, n - 1), n >> 1, rKey(n + 1)][rKey(5)];
    const e = rKey(0x40000000);
    const ms = [];
    for (let d = 0; d < dims; d++) ms.push(rVal(6) === 0 ? 0 : rVal(1000));
    v.insertAt(i, e, ...ms);
    ov.insertAt(i, e, ...ms);
    info = { op: 'insertAt', w, o: -1, i, n, k: 0 };
    cov.ins++;
    if (i === 0) cov.ins0++;
    if (i === n) cov.insN++;
    if (ctx.lastSplit[w]) cov.splitIns++;
  } else if (p < 80 && n > 0) {
    const i = [0, n - 1, n >> 1, rKey(n)][rKey(4)];
    const a = v.removeAt(i);
    const b = ov.removeAt(i);
    if (a !== b) ctx.fail('removeAt(' + i + ') returned ' + a + ' want ' + b);
    info = { op: 'removeAt', w, o: -1, i, n, k: 0 };
    cov.rem++;
    if (i === 0) cov.rem0++;
    if (i === n - 1) {
      cov.remLast++;
      if (kind.sfx && kind.sfx[w]) cov.remLastSfx++;
    }
    if (n === 1) cov.toEmpty++;
  } else if (p < 86 && n > 0) {
    const i = rKey(n);
    const d = rKey(dims);
    const m = rVal(1000);
    v.setMeasure(i, d, m);
    ov.setMeasure(i, d, m);
    info = { op: 'setMeasure', w, o: -1, i, n, k: 0 };
    cov.set++;
  } else if (p < 92) {
    if (ors[o].length > 0) {
      views[o].clear();
      ors[o].clear();
    }
    const i = kind.splitFix(ctx, rKey(n + 1), n, o);
    if (v.splitAt(i, views[o]) !== v) ctx.fail('splitAt did not return this');
    if (ov.splitAt(i, ors[o]) !== ov) ctx.fail('oracle splitAt did not return this');
    info = { op: 'splitAt', w, o, i, n, k: n - i };
    cov.splits++;
    if (kind.sfx && kind.sfx[w] !== kind.sfx[o]) cov.mixedModes++;
  } else if (p < 98 && kind.appendOk(ctx, w, o)) {
    const k = ors[o].length;
    if (v.append(views[o]) !== v) ctx.fail('append did not return this');
    if (ov.append(ors[o]) !== ov) ctx.fail('oracle append did not return this');
    info = { op: 'append', w, o, i: n, n, k };
    cov.appends++;
    if (kind.sfx && kind.sfx[w] !== kind.sfx[o]) cov.mixedModes++;
    if (kind.sfx && kind.sfx[w] && n > 0 && k > 0) cov.appendSfx++;
  } else {
    v.clear();
    ov.clear();
    info = { op: 'clear', w, o: -1, i: 0, n, k: 0 };
    cov.clears++;
  }
  res.ops++;
  ctx.lastSplit[w] = info.op === 'splitAt';
  if (info.op === 'splitAt') ctx.lastSplit[o] = true;
  const tag = ctx.tag + ' op ' + t + ' ' + info.op + '(' + info.i + ') view ' + w;
  for (let z = 0; z < V; z++) {
    if (views[z].cursor().valid !== ors[z].cursor().valid) {
      ctx.fail(tag + ' cursor valid on view ' + z + ': ' + views[z].cursor().valid + ' want ' + ors[z].cursor().valid);
    }
  }
  compareView(v, ov, ctx, tag);
  if (info.o >= 0) compareView(views[o], ors[o], ctx, tag + ' (other)');
  if (kind.extra) kind.extra(ctx, tag, info, pre);
  cursorCheck(v, ov, ctx, tag);
  const m = ov.length;
  if (m === 1) cov.n1++;
  if (m >= 64 && (m & (m - 1)) === 0) cov.pow2big++;
  if (kind.atCap(ctx, w)) cov.atCap++;
  return info;
}

function runDiff(kind, K, seeds, stopAt) {
  const res = { ops: 0, bad: 0, first: [], cov: newCov() };
  for (const seed of seeds) {
    if (res.bad >= stopAt) break;
    const rOp = xs(seed * 0x9E3779B1);
    const rKey = xs(seed * 0x85EBCA77 + 1);
    const rVal = xs(seed * 0xC2B2AE3D + 2);
    const rq = xs(seed * 0x27D4EB2F + 3);
    const dims = 1 + ((seed - 1) & 3);
    const C = [64, 100, 160][rKey(3)];
    const aux = rKey(4);
    const views = kind.views(K, C, dims, aux);
    const ors = views.map(() => new Oracle(dims));
    const ctx = {
      res, kind, dims, C, views, ors, rOp, rKey, rVal, rq, lastSplit: views.map(() => false),
      tag: kind.name + ' seed ' + seed + ' dims ' + dims + ' C ' + C,
      fail(msg) {
        res.bad++;
        if (res.first.length < 8) res.first.push(msg);
        return false;
      },
    };
    try {
      for (let t = 0; t < OPS_PER_SEED && res.bad < stopAt; t++) stepOnce(ctx, t);
    } catch (e) {
      ctx.fail(ctx.tag + ' threw ' + (e && e.message));
    }
    if (kind.endSeed) kind.endSeed(ctx);
  }
  return res;
}

// -- BlockedArray kind: 3 views of one arena (shared capacity C), chunkCap 8 / 12 / 16 / default ----------------

const BA_NC = new Int32Array(8);

function baPool(ctx, tag) {
  const views = ctx.views;
  const a = views[0]._arena;
  const B = views[0].chunkCap;
  const q = B >>> 2;
  let dirs = 0;
  let live = 0;
  for (let z = 0; z < views.length; z++) {
    const v = views[z];
    const L = v.dirLen;
    dirs += L;
    live += v.length;
    if ((L === 0) !== (v.length === 0)) return ctx.fail(tag + ' view ' + z + ' dirLen ' + L + ' with length ' + v.length);
    let tot = 0;
    for (let j = 0; j < L; j++) {
      const s = v.dirSize[j];
      tot += s;
      if (!(s < B) || s < 1 || (L > 1 && s < q)) return ctx.fail(tag + ' view ' + z + ' chunk ' + j + ' size ' + s + ' (B ' + B + ', dirLen ' + L + ')');
    }
    if (tot !== v.length) return ctx.fail(tag + ' view ' + z + ' sum(dirSize) ' + tot + ' != length ' + v.length);
  }
  if (a.freeTop + dirs !== a.maxChunks) return ctx.fail(tag + ' chunk conservation: freeTop ' + a.freeTop + ' + dirs ' + dirs + ' != ' + a.maxChunks);
  if (a.liveElements !== live) return ctx.fail(tag + ' liveElements ' + a.liveElements + ' != ' + live);
  return true;
}

function baKind(name) {
  return {
    name,
    views: (K, C, dims, aux) => K.arena(C, { dims, chunkCap: [8, 12, 16, 0][aux] }, 3),
    canInsert: (ctx) => {
      let live = 0;
      for (const o of ctx.ors) live += o.length;
      return live < ctx.C;
    },
    atCap: (ctx) => {
      let live = 0;
      for (const o of ctx.ors) live += o.length;
      return live === ctx.C;
    },
    splitFix: (ctx, i) => i,
    appendOk: () => true,
    extra: (ctx, tag) => baPool(ctx, tag),
    endSeed: (ctx) => {
      const cov = ctx.res.cov;
      for (const v of ctx.views) {
        v.readCounters(BA_NC);
        cov.baSplits += BA_NC[BlockedArray.COUNTERS.splits];
        cov.baMerges += BA_NC[BlockedArray.COUNTERS.merges];
        cov.baEqualizes += BA_NC[BlockedArray.COUNTERS.equalizes];
        cov.baSeams += BA_NC[BlockedArray.COUNTERS.seamRepairs];
      }
    },
    floors: { ins0: 300, insN: 300, rem0: 250, remLast: 250, toEmpty: 20, n1: 30, pow2big: 50, atCap: 50, splitIns: 30,
      splits: 200, appends: 200, walkSteps: 100000, baSplits: 500, baMerges: 100, baEqualizes: 100, baSeams: 50 },
  };
}

// -- FenwickRebuild kind: 2 instances, UNEQUAL capacities (C, C + 5), the second of the other mode -----------------

const FW_KEYS = ['elemMoves', 'rebuilds', 'treeCopies', 'seedAdds', 'cascadeAdds'];
const FW_SLOT = FenwickRebuild.COUNTERS;

function chainSeeds(i, m) {
  let s = 0;
  for (let j = i; j > 0; j &= j - 1) if (j + lsb(j) <= m) s++;
  return s;
}

function chainBreaks(i, m) {
  for (let j = i; j > 0; j &= j - 1) if (j + lsb(j) > m) return true;
  return false;
}

function casc(lo, m) {
  let c = 0;
  for (let j = lo; j <= m; j++) if (j + lsb(j) <= m) c++;
  return c;
}

// R2: the counter deltas one op must add to view z (nodeVisits excluded).
function fwExpect(info, z, sfx) {
  const e = { elemMoves: 0, rebuilds: 0, treeCopies: 0, seedAdds: 0, cascadeAdds: 0 };
  const full = (m) => { e.rebuilds += 1; e.treeCopies += m; e.cascadeAdds += casc(1, m); };
  const suffix = (i, m) => { e.rebuilds += 1; e.treeCopies += m - i; e.seedAdds += chainSeeds(i, m); e.cascadeAdds += casc(i + 1, m); };
  const { op, i, n, k } = info;
  if (z === info.w) {
    if (op === 'insertAt') {
      e.elemMoves += n - i;
      if (sfx) suffix(i, n + 1);
      else full(n + 1);
    } else if (op === 'removeAt') {
      e.elemMoves += n - 1 - i;
      if (!sfx) full(n - 1);
      else if (i < n - 1) suffix(i, n - 1);
    } else if (op === 'splitAt') {
      e.elemMoves += k;
    } else if (op === 'append') {
      e.elemMoves += k;
      if (k > 0) {
        if (sfx) suffix(n, n + k);
        else full(n + k);
      }
    }
  } else if (z === info.o && op === 'splitAt' && k > 0) {
    full(k); // out's tree is all new: the same full pass in both modes
  }
  return e;
}

const FW_CB = new Float64Array(6);

function fwTree(v, o, ctx, tag) {
  const dump = o.dump();
  const n = dump.entities.length;
  const C = v.capacity;
  for (let d = 0; d < o.dims; d++) {
    const P = prefixOf(dump, d);
    for (let k = 1; k <= n; k++) {
      const want = P[k] - P[k - lsb(k)];
      const got = v._tree[d * (C + 1) + k];
      if (got !== want) return ctx.fail(tag + ' tree d' + d + ' node ' + k + ' of ' + n + ' got ' + got + ' want ' + want);
    }
  }
  return true;
}

function fwKind(name, modes) {
  const sfx = modes.map((m) => m === 'suffix');
  const make = (K, C, dims, mode) => (mode === undefined ? (dims === 1 ? new K(C) : new K(C, { dims })) : new K(C, { dims, mode }));
  const caps = (ctx) => [ctx.C, ctx.C + 5];
  return {
    name,
    sfx,
    views: (K, C, dims) => [make(K, C, dims, modes[0]), make(K, C + 5, dims, modes[1])],
    canInsert: (ctx, w) => ctx.ors[w].length < caps(ctx)[w],
    atCap: (ctx, w) => ctx.ors[w].length === caps(ctx)[w],
    splitFix: (ctx, i, n, o) => (n - i > caps(ctx)[o] ? n - caps(ctx)[o] : i),
    appendOk: (ctx, w, o) => ctx.ors[w].length + ctx.ors[o].length <= caps(ctx)[w],
    pre: (views) => views.map((v) => {
      v.readCounters(FW_CB);
      return Float64Array.from(FW_CB);
    }),
    extra: (ctx, tag, info, pre) => {
      const cov = ctx.res.cov;
      if (info.op === 'insertAt' && sfx[info.w] && chainBreaks(info.i, info.n + 1)) cov.seedBreak++;
      for (let z = 0; z < ctx.views.length; z++) {
        const want = fwExpect(info, z, sfx[z]);
        ctx.views[z].readCounters(FW_CB);
        for (const key of FW_KEYS) {
          const got = FW_CB[FW_SLOT[key]] - pre[z][FW_SLOT[key]];
          if (got !== want[key]) ctx.fail(tag + ' counters view ' + z + ' ' + key + ' +' + got + ' want +' + want[key]);
        }
        fwTree(ctx.views[z], ctx.ors[z], ctx, tag + ' view ' + z);
      }
    },
    floors: { ins0: 300, insN: 300, rem0: 250, remLast: 250, remLastSfx: 30, toEmpty: 20, n1: 30, pow2big: 50, atCap: 50,
      splitIns: 30, mixedModes: 100, seedBreak: 100, appendSfx: 20, splits: 200, appends: 200, walkSteps: 100000 },
  };
}

const KINDS = [
  ['BlockedArray.unrolled', baKind('BlockedArray.unrolled'), async () => BlockedArray],
  ['BlockedArray.plain', baKind('BlockedArray.plain'), async () => (await loadVariant('plain')).BlockedArray],
  ['FenwickRebuild.full', fwKind('FenwickRebuild.full', ['full', 'suffix']), async () => FenwickRebuild],
  ['FenwickRebuild.suffix', fwKind('FenwickRebuild.suffix', ['suffix', 'full']), async () => FenwickRebuild],
  ['FenwickRebuild.default', fwKind('FenwickRebuild.default', [undefined, 'suffix']), async () => FenwickRebuild],
];

// The exact op count and op mix each rival ran over SEEDS x OPS_PER_SEED (pinned: a drifted stream fails here).
// The mix differs by family only through the capacity rules (one shared arena C vs two instances C and C + 5).
const PIN_KEYS = ['ins', 'rem', 'set', 'splits', 'appends', 'clears'];
const MIX_BA = [9141, 6771, 514, 2343, 338, 93];
const MIX_FW = [9531, 7329, 548, 1361, 338, 93];
const OPS_PIN = {
  'BlockedArray.unrolled': MIX_BA,
  'BlockedArray.plain': MIX_BA,
  'FenwickRebuild.full': MIX_FW,
  'FenwickRebuild.suffix': MIX_FW,
  'FenwickRebuild.default': MIX_FW,
};

// ---- throw rows (token + state unchanged) --------------------------------------------------------------------

function fillItems(v, items) {
  for (const it of items) v.insertAt(v.length, ...it);
}

function snap(v, dims) {
  try {
    const s = { n: v.length, e: [], m: [], t: [] };
    for (let i = 0; i < v.length; i++) {
      s.e.push(v.entityAt(i));
      for (let d = 0; d < dims; d++) s.m.push(v.getMeasure(i, d));
    }
    const c = v.cursor();
    s.c = [c.valid, c.index, c.entity];
    for (let d = 0; d < dims; d++) {
      s.t.push(v.total(d));
      s.c.push(String(c.offset(d)), String(c.measure(d)));
    }
    return JSON.stringify(s);
  } catch (e) {
    return 'snap threw ' + (e && e.message);
  }
}

const ITEMS2 = [[10, 1, 3], [11, 2, 5], [12, 3, 7], [13, 4, 9], [14, 5, 11]];

// [token, label, setup, fn(s), flags]; s = { A, B, Cv, F } (rival views or oracles).
const THROW_ROWS = [
  ['index', 'insertAt(n+1)', 'main', (s) => s.A.insertAt(6, 1, 1, 1)],
  ['index', 'insertAt(-1)', 'main', (s) => s.A.insertAt(-1, 1, 1, 1)],
  ['index', 'insertAt(1.5)', 'main', (s) => s.A.insertAt(1.5, 1, 1, 1)],
  ['index', "insertAt('1')", 'main', (s) => s.A.insertAt('1', 1, 1, 1)],
  ['index', 'insertAt(n+1) with a bad entity (index first)', 'main', (s) => s.A.insertAt(6, 2 ** 30, 1, 1)],
  ['index', 'removeAt(n)', 'main', (s) => s.A.removeAt(5)],
  ['index', 'setMeasure(n) with a bad dim and measure (index first)', 'main', (s) => s.A.setMeasure(5, 9, -1)],
  ['index', 'getMeasure(n) with a bad dim (index first)', 'main', (s) => s.A.getMeasure(5, 9)],
  ['index', 'entityAt(-1)', 'main', (s) => s.A.entityAt(-1)],
  ['index', 'sumBefore(0, n+1)', 'main', (s) => s.A.sumBefore(0, 6)],
  ['index', 'splitAt(n+1, this) (index before operand)', 'main', (s) => s.A.splitAt(6, s.A)],
  ['index', 'cursor.seekIndex(n+1)', 'main', (s) => s.A.cursor().seekIndex(6)],
  ['entity', 'insertAt entity 2^30', 'main', (s) => s.A.insertAt(0, 2 ** 30, 1, 1)],
  ['entity', 'insertAt entity -1 with a bad measure (entity first)', 'main', (s) => s.A.insertAt(0, -1, -1, 1)],
  ['entity', "insertAt entity '1'", 'main', (s) => s.A.insertAt(0, '1', 1, 1)],
  ['dim', 'getMeasure(0, 2)', 'main', (s) => s.A.getMeasure(0, 2)],
  ['dim', 'setMeasure(0, 2, -1) (dim before measure)', 'main', (s) => s.A.setMeasure(0, 2, -1)],
  ['dim', 'sumBefore(2, 0)', 'main', (s) => s.A.sumBefore(2, 0)],
  ['dim', 'sumBefore(-1, 0)', 'main', (s) => s.A.sumBefore(-1, 0)],
  ['dim', 'indexAtSum(2, -1) (dim before seek)', 'main', (s) => s.A.indexAtSum(2, -1)],
  ['dim', 'total(2)', 'main', (s) => s.A.total(2)],
  ['dim', 'cursor.offset(2)', 'main', (s) => s.A.cursor().offset(2)],
  ['dim', 'cursor.measure(-1)', 'main', (s) => s.A.cursor().measure(-1)],
  ['dim', 'cursor.seekSum(2, 0)', 'main', (s) => s.A.cursor().seekSum(2, 0)],
  ['measure', 'insertAt m0 -1', 'main', (s) => s.A.insertAt(0, 1, -1, 1)],
  ['measure', 'insertAt m1 1.5', 'main', (s) => s.A.insertAt(0, 1, 1, 1.5)],
  ['measure', 'insertAt m0 NaN', 'main', (s) => s.A.insertAt(0, 1, NaN, 1)],
  ['measure', 'insertAt m0 2^53', 'main', (s) => s.A.insertAt(0, 1, 2 ** 53, 1)],
  ['measure', "insertAt m1 '1'", 'main', (s) => s.A.insertAt(0, 1, 1, '1')],
  ['measure', 'insertAt m0 -1 with an extra slot (measure before extra)', 'main', (s) => s.A.insertAt(0, 1, -1, 1, 1)],
  ['measure', 'setMeasure(0, 0, -1)', 'main', (s) => s.A.setMeasure(0, 0, -1)],
  ['measure', 'setMeasure(0, 1, 0.5)', 'main', (s) => s.A.setMeasure(0, 1, 0.5)],
  ['extra', 'insertAt m2 defined at dims 2', 'main', (s) => s.A.insertAt(0, 1, 1, 1, 1)],
  ['extra', 'insertAt m3 defined at dims 2', 'main', (s) => s.A.insertAt(0, 1, 1, 1, undefined, 1)],
  ['extra', 'insertAt m1 defined at dims 1', 'dims1', (s) => s.A.insertAt(0, 1, 1, 1)],
  ['seek', 'indexAtSum(0, -1)', 'main', (s) => s.A.indexAtSum(0, -1)],
  ['seek', 'indexAtSum(0, NaN)', 'main', (s) => s.A.indexAtSum(0, NaN)],
  ['seek', 'indexAtSum(0, Infinity)', 'main', (s) => s.A.indexAtSum(0, Infinity)],
  ['seek', 'cursor.seekSum(0, -0.5)', 'main', (s) => s.A.cursor().seekSum(0, -0.5)],
  ['operand', 'splitAt(0, this)', 'main', (s) => s.A.splitAt(0, s.A)],
  ['operand', 'splitAt(0, a non-empty view)', 'main', (s) => s.A.splitAt(0, s.Cv)],
  ['operand', 'splitAt(0, {})', 'main', (s) => s.A.splitAt(0, {})],
  ['operand', 'append(this)', 'main', (s) => s.A.append(s.A)],
  ['operand', 'append(null)', 'main', (s) => s.A.append(null)],
  ['operand', 'append({})', 'main', (s) => s.A.append({})],
  ['operand', 'append(foreign: another arena / other dims)', 'main', (s) => s.A.append(s.F)],
  ['headroom', 'insertAt past 2^53-1', 'headroom', (s) => s.A.insertAt(2, 9, 3, 0)],
  ['headroom', 'setMeasure past 2^53-1', 'headroom', (s) => s.A.setMeasure(1, 0, 4)],
  ['headroom', 'append past 2^53-1', 'headroom', (s) => s.A.append(s.B)],
  ['capacity', 'insertAt at capacity', 'full', (s) => s.A.insertAt(0, 1, 1), 'noOracle'],
];

const FW_CAP_ROWS = [
  ['capacity', 'splitAt into an out that cannot hold the tail', 'fwSplitCap', (s) => s.A.splitAt(0, s.B), 'noOracle'],
  ['capacity', 'append past this capacity', 'fwAppendCap', (s) => s.A.append(s.B), 'noOracle'],
];

// A throw family: views(C, dims, count) of one arena / same-dims instances; foreign(C, dims) an illegal operand.
function throwSetup(fam, name) {
  const mk = (C, dims, count, fills) => {
    const r = fam.views(C, dims, count);
    const o = r.map(() => new Oracle(dims));
    for (let z = 0; z < count; z++) {
      fillItems(r[z], fills[z] || []);
      fillItems(o[z], fills[z] || []);
    }
    return { r, o, dims };
  };
  let m;
  if (name === 'main') m = mk(16, 2, 3, [ITEMS2, [], [[20, 1, 1]]]);
  else if (name === 'dims1') m = mk(16, 1, 2, [[[1, 1], [2, 2]]]);
  else if (name === 'headroom') m = mk(16, 2, 2, [[[1, MAX - 3, 0], [2, 1, 0]], [[3, 3, 0]]]);
  else if (name === 'full') m = mk(4, 1, 2, [[[1, 1], [2, 1], [3, 1], [4, 1]]]);
  else if (name === 'fwSplitCap') m = { r: [fam.make(16, 2), fam.make(2, 2)], o: null, dims: 2 };
  else if (name === 'fwAppendCap') m = { r: [fam.make(6, 2), fam.make(6, 2)], o: null, dims: 2 };
  if (name === 'fwSplitCap') fillItems(m.r[0], ITEMS2);
  if (name === 'fwAppendCap') {
    fillItems(m.r[0], ITEMS2);
    fillItems(m.r[1], [[7, 1, 1], [8, 1, 1]]);
  }
  const R = { A: m.r[0], B: m.r[1], Cv: m.r[2], F: fam.foreign(16, m.dims) };
  const O = m.o ? { A: m.o[0], B: m.o[1], Cv: m.o[2], F: new Oracle(m.dims === 4 ? 1 : m.dims + 1) } : null;
  return { R, O, dims: m.dims };
}

function throwRows(fam) {
  const bad = [];
  const seen = new Set();
  const rows = fam.capRows ? THROW_ROWS.concat(fam.capRows) : THROW_ROWS;
  for (const [token, label, setup, fn, flags] of rows) {
    const { R, O, dims } = throwSetup(fam, setup);
    if (R.A.length > 2) R.A.cursor().seekIndex(2);
    if (O && O.A.length > 2) O.A.cursor().seekIndex(2);
    const live = [R.A, R.B, R.Cv].filter((x) => x !== undefined);
    const before = live.map((x) => snap(x, dims));
    const got = tokenOf(() => fn(R));
    if (got !== token) bad.push(label + ': token ' + got + ' want ' + token);
    if (flags !== 'noOracle' && O) {
      const og = tokenOf(() => fn(O));
      if (og !== token) bad.push(label + ': ORACLE token ' + og + ' want ' + token + ' (row expectation is wrong)');
    }
    const after = live.map((x) => snap(x, dims));
    for (let z = 0; z < live.length; z++) if (after[z] !== before[z]) bad.push(label + ': view ' + z + ' changed by a rejected op');
    seen.add(got);
  }
  return { bad, seen, count: rows.length };
}

const BA_FAM = (K) => ({
  views: (C, dims, count) => K.arena(C, { dims, chunkCap: 8 }, count),
  foreign: (C, dims) => new K(C, { dims }),
});

const FW_FAM = (K) => ({
  views: (C, dims, count) => {
    const r = [];
    for (let z = 0; z < count; z++) r.push(new K(C, { dims, mode: z === 0 ? 'suffix' : 'full' }));
    return r;
  },
  make: (C, dims) => new K(C, { dims, mode: 'suffix' }),
  foreign: (C, dims) => new K(C, { dims: dims === 4 ? 1 : dims + 1 }),
  capRows: FW_CAP_ROWS,
});

// ---- R4 FenwickRebuild options / counters rows, R3 default mode --------------------------------------------------

function optionRows(F) {
  const bad = [];
  const tok = (fn) => {
    try {
      fn();
      return 'NOTHROW';
    } catch (e) {
      const m = String(e && e.message);
      return (e instanceof RangeError ? '' : 'TYPE:') + m.split(' ')[0] + (/'mode'/.test(m) ? '+mode' : /'dims'/.test(m) ? '+dims' : '');
    }
  };
  const rows = [
    ["mode 'Suffix'", () => new F(8, { mode: 'Suffix' }), 'options'],
    ["mode 'partial'", () => new F(8, { mode: 'partial' }), 'options'],
    ['mode undefined (present)', () => new F(8, { mode: undefined }), 'options'],
    ['mode null', () => new F(8, { mode: null }), 'options'],
    ['mode 1', () => new F(8, { mode: 1 }), 'options'],
    ["mode new String('suffix')", () => new F(8, { mode: new String('suffix') }), 'options'],
    ['mode getter', () => new F(8, Object.defineProperty({}, 'mode', { get: () => 'suffix', enumerable: true })), 'options'],
    ['mode non-enumerable bad value', () => new F(8, Object.defineProperty({}, 'mode', { value: 'bogus' })), 'options'],
    ['mode inherited', () => new F(8, Object.create({ mode: 'suffix' })), 'options'],
    ['options array', () => new F(8, []), 'options'],
    ['options null', () => new F(8, null), 'options'],
    ['options symbol key', () => new F(8, { [Symbol('mode')]: 'suffix' }), 'options'],
    ["'modee' suggests 'mode'", () => new F(8, { modee: 'suffix' }), 'options+mode'],
    ["'dim' suggests 'dims'", () => new F(8, { dim: 1 }), 'options+dims'],
    ['order: C before options', () => new F(0, { modee: 'x' }), 'capacity'],
    ['order: options before dims', () => new F(8, { modee: 'x', dims: 9 }), 'options+mode'],
    ['order: dims before mode', () => new F(8, { dims: 9, mode: 'x' }), 'dims'],
    ['order: mode before cap', () => new F(2 ** 29, { mode: 'x' }), 'options'],
    ['cap alone', () => new F(2 ** 29), 'capacity'],
    ["mode 'suffix' builds", () => new F(8, { mode: 'suffix' }), 'NOTHROW'],
    ["mode 'full' + dims 2 builds", () => new F(8, { mode: 'full', dims: 2 }), 'NOTHROW'],
    ['readCounters(Float64Array(5))', () => new F(8).readCounters(new Float64Array(5)), 'counters'],
    ['readCounters(Uint32Array(6))', () => new F(8).readCounters(new Uint32Array(6)), 'counters'],
    ['readCounters([])', () => new F(8).readCounters([0, 0, 0, 0, 0, 0]), 'counters'],
    ['readCounters(Int32Array(6))', () => new F(8).readCounters(new Int32Array(6)), 'NOTHROW'],
    ['readCounters(Float64Array(6))', () => new F(8).readCounters(new Float64Array(6)), 'NOTHROW'],
  ];
  for (const [label, fn, want] of rows) {
    const got = tok(fn);
    if (got !== want) bad.push(label + ': ' + got + ' want ' + want);
  }
  return bad;
}

function defaultRows(F) {
  const bad = [];
  const c = new Float64Array(6);
  for (const [label, mk] of [['new F(C)', () => new F(32)], ['new F(C, { dims: 2 })', () => new F(32, { dims: 2 })]]) {
    const v = mk();
    const dims = label.includes('dims') ? 2 : 1;
    for (let i = 0; i < 6; i++) v.insertAt(i, i, 1, ...(dims === 2 ? [2] : []));
    v.resetCounters();
    v.insertAt(2, 9, 1, ...(dims === 2 ? [2] : []));
    v.readCounters(c);
    if (c[FW_SLOT.treeCopies] !== 7 || c[FW_SLOT.seedAdds] !== 0 || c[FW_SLOT.rebuilds] !== 1) {
      bad.push(label + ': insertAt(2) at n 6 added treeCopies ' + c[FW_SLOT.treeCopies] + ' seedAdds ' + c[FW_SLOT.seedAdds] + ', want 7 / 0 (mode full)');
    }
  }
  return bad;
}

// ---- R5 split points (BA-14), A4 chunk retention ---------------------------------------------------------------

function splitRows(K) {
  const bad = [];
  for (const B of [8, 12, 16, 32, 64]) {
    const q = B >>> 2;
    const h = B >>> 1;
    const mk = () => new K(4096, { dims: 2, chunkCap: B });
    const ins = (v, i) => v.insertAt(i, i & 1023, 1, 2);
    const sizes = (v) => Array.from(v.dirSize.subarray(0, v.dirLen));
    const appendTo = (v, n) => { while (v.length < n) ins(v, v.length); };
    const expectSplit = (label, v, i, want) => {
      const s0 = sizes(v);
      ins(v, i);
      const s1 = sizes(v);
      if (s1.length !== s0.length + 1) return bad.push(label + ' B ' + B + ': no split (' + s0.join(',') + ' -> ' + s1.join(',') + ')');
      let k = 0;
      while (k < s0.length && s0[k] === s1[k]) k++;
      if (s0[k] !== B - 1 || s1[k] !== want || s1[k + 1] !== B - want) {
        bad.push(label + ' B ' + B + ': chunk ' + k + ' ' + s0[k] + ' -> ' + s1[k] + '|' + s1[k + 1] + ' want ' + want + '|' + (B - want));
      }
      for (let j = k + 1; j < s0.length; j++) if (s1[j + 1] !== s0[j]) bad.push(label + ' B ' + B + ': neighbour chunk ' + j + ' changed');
      return 0;
    };
    // single-chunk view (dirLen 1, B - 1 elements)
    let v = mk(); appendTo(v, B - 1); expectSplit('single insertAt(length)', v, B - 1, B - q);
    v = mk(); appendTo(v, B - 1); expectSplit('single insertAt(0)', v, 0, q);
    v = mk(); appendTo(v, B - 1); expectSplit('single insertAt(length-1)', v, B - 2, h);
    v = mk(); appendTo(v, B - 1); expectSplit('single insertAt(1)', v, 1, h);
    v = mk(); appendTo(v, B - 1); expectSplit('single middle', v, (B - 1) >> 1, h);
    // multi-chunk views: fill the target chunk to B - 1, then the insert that fills it
    v = mk(); appendTo(v, 3 * B);
    while (v.dirSize[v.dirLen - 1] < B - 1) ins(v, v.length);
    expectSplit('multi insertAt(length)', v, v.length, B - q);
    v = mk(); appendTo(v, 3 * B);
    while (v.dirSize[0] < B - 1) ins(v, 0);
    expectSplit('multi insertAt(0)', v, 0, q);
    v = mk(); appendTo(v, 3 * B);
    while (v.dirSize[0] < B - 1) ins(v, 0);
    expectSplit('multi insertAt(1) into the first chunk', v, 1, h);
    v = mk(); appendTo(v, 3 * B);
    while (v.dirSize[v.dirLen - 1] < B - 1) ins(v, v.length);
    expectSplit('multi insertAt(length-1)', v, v.length - 1, h);
    v = mk(); appendTo(v, 3 * B);
    if (v.dirLen < 3) bad.push('multi middle B ' + B + ': dirLen ' + v.dirLen + ' < 3');
    const start = v.dirSize[0];
    while (v.dirSize[1] < B - 1) ins(v, start + 1);
    expectSplit('multi middle (chunk 1)', v, start + 1, h);
  }
  return bad;
}

function retentionRows(K) {
  const bad = [];
  const views = K.arena(2000, { dims: 2, chunkCap: 16 }, 3);
  const a = views[0]._arena;
  const r = xs(0xA4A4);
  for (let c = 0; c < 10; c++) {
    for (let t = 0; t < 10000; t++) {
      const w = r(3);
      const v = views[w];
      const o = views[(w + 1 + r(2)) % 3];
      const p = r(100);
      if (p < 55 && a.liveElements < a.capacity) v.insertAt(r(v.length + 1), t & 1023, r(100), r(100));
      else if (p < 90 && v.length > 0) v.removeAt(r(v.length));
      else if (p < 95) {
        o.clear();
        v.splitAt(r(v.length + 1), o);
      } else v.append(o);
    }
    for (const v of views) v.clear();
    if (a.freeTop !== a.maxChunks || a.liveElements !== 0) {
      bad.push('cycle ' + c + ': freeTop ' + a.freeTop + ' / ' + a.maxChunks + ' liveElements ' + a.liveElements);
    }
    for (let z = 0; z < 3; z++) {
      const v = views[z];
      if (v.length !== 0 || v.dirLen !== 0 || v.cursor().valid !== false) bad.push('cycle ' + c + ': view ' + z + ' not reset');
    }
  }
  return bad;
}

// ---- mutants ------------------------------------------------------------------------------------------------------

const BA_SPLIT = 'this._split(dirIdx, globalIndex === this._len - 1 ? B - q : (globalIndex === 0 ? q : B >>> 1));';
const BA_IDX = "    if (typeof globalIndex !== 'number' || (globalIndex | 0) !== globalIndex || globalIndex < 0 || globalIndex > this._len) {\n      baFail('index', 'out of range');\n    }\n";
const BA_ENT = "    if (typeof entity !== 'number' || (entity & MAX_ENTITY) !== entity) {\n      baFail('entity', 'must be an integer in [0, 2^30 - 1]');\n    }\n";
const BA_GETM = '    return this._arena.poolMeasures[(dim * this.maxChunks + cIdx) * this.chunkCap + this._locLocal];';

// [id, what, battery, hunks, expectThrow?]; batteries: diff (the differential), throws, split, retention.
// expectThrow (RegExp) names the ONE throw that may ESCAPE a battery and count as a kill; any other escaping throw
// fails the test. optionRows catches every row, runDiff its op loop, throwRows its op call (a mutant throw there is a
// bad row); a throw while building / filling / reading counters in diff / throws escapes here, as does any throw in
// split / retention / default.
const BA_MUTANTS = [
  ['P1', 'getMeasure(i, 1) reads the dim-0 column', 'diff', [[BA_GETM, BA_GETM.replace('(dim * this', '((dim === 1 ? 0 : dim) * this')]]],
  ['P2', 'next() does not reset local at a chunk end', 'diff', [['      st[CU_LOCAL] = 0;\n', '']]],
  ['P3', 'insertAt checks entity before index', 'throws', [[BA_IDX + BA_ENT, BA_ENT + BA_IDX]]],
  ['BM1', 'append split keyed on length - 2', 'split', [[BA_SPLIT, BA_SPLIT.replace('this._len - 1', 'this._len - 2')]]],
  ['BM2', 'append / prepend cuts swapped', 'split', [[BA_SPLIT, 'this._split(dirIdx, globalIndex === this._len - 1 ? q : (globalIndex === 0 ? B - q : B >>> 1));']]],
  ['BM3', 'always 1/2 (the HEAD rule)', 'split', [[BA_SPLIT, 'this._split(dirIdx, B >>> 1);']]],
  ['BM4', '_split copies entities from keep, not cut', 'diff', [['    a.poolEntities.copyWithin(newCIdx * B, oldCIdx * B + cut, oldCIdx * B + sz);', '    a.poolEntities.copyWithin(newCIdx * B, oldCIdx * B + keep, oldCIdx * B + sz);']]],
  ['BM5', 'prepend split keyed on index 1', 'split', [[BA_SPLIT, BA_SPLIT.replace('globalIndex === 0', 'globalIndex === 1')]]],
  ['BM6', 'clear() keeps its chunks', 'retention', [['      a.freeList[a.freeTop++] = this.dir[i];\n', '']], /pool exhausted/],
  // BM6 expectThrow: leaked chunks make a later fill throw baFail('pool', ...) = 'chunk pool exhausted' (measured: the only throwing row).
];

const FW_SUFFIX_APPEND = '      if (this._sfx) fwSuffix(this, n);';
const FW_REM = '    else if (at < n - 1) fwSuffix(this, at);';
const FW_IE = "    if (((i >>> 0) !== i) | !(i <= n)) fwFail('index', 'must be an integer in [0, length]');\n    const at = i >>> 0;\n";
const FW_E = "    if (typeof e !== 'number' || (e & 0x3FFFFFFF) !== e) fwFail('entity', 'must be an integer in [0, 2^30-1]');\n";

// batteries: diff (mode 'suffix' kind: a suffix and a full instance, unequal capacities), throws, options, default.
const FW_MUTANTS = [
  ['P1fw', 'getMeasure(i, 1) reads the dim-0 column', 'diff', [['    return this._meas[(d >>> 0) * this._C + (i >>> 0)];', '    return this._meas[(d === 1 ? 0 : d >>> 0) * this._C + (i >>> 0)];']]],
  ['P3fw', 'insertAt checks entity before index', 'throws', [[FW_IE + FW_E, FW_E + FW_IE]]],
  ['P4', "find compares t < rem where it must compare t <= rem", 'diff', [['      if (t <= rem) {', '      if (t < rem) {']]],
  ['FM1', 'seed chain starts at i - 1', 'diff', [['    for (let j = i; j > 0; j &= j - 1) {', '    for (let j = i - 1; j > 0; j &= j - 1) {']]],
  ['FM2', 'seed stops at parent == n', 'diff', [['      if (p > n) break;', '      if (p >= n) break;']]],
  ['FM3', "default mode 'suffix'", 'default', [["  let mode = 'full';", "  let mode = 'suffix';"]]],
  ['FM4', 'suffix removeAt rebuilds at the last index too', 'diff', [[FW_REM, '    else fwSuffix(this, at);']]],
  ['FM5', 'suffix removeAt skips index n - 2', 'diff', [[FW_REM, '    else if (at < n - 2) fwSuffix(this, at);']]],
  ['FM6', 'suffix append rebuilds from n + 1', 'diff', [[FW_SUFFIX_APPEND, '      if (this._sfx) fwSuffix(this, n + 1);']]],
  ['FM7', 'cascade starts at i + 2', 'diff', [['    for (let j = i + 1; j <= n; j++) {', '    for (let j = i + 2; j <= n; j++) {']]],
  ['FM8', 'treeCopies counts n, not n - i', 'diff', [['  cn[FW_COPIES] += n - i;', '  cn[FW_COPIES] += n;']]],
  ['FM9', 'seed / cascade counts not reset per dim', 'diff', [['    s = 0;\n    c = 0;\n', '']]],
  ['FM10', 'mode value not validated', 'options', [["  if (mode !== 'full' && mode !== 'suffix') fwFail", '  if (false) fwFail']]],
  ['FM11', 'suffix insertAt rebuilds from at + 1', 'diff', [['    if (this._sfx) fwSuffix(this, at);', '    if (this._sfx) fwSuffix(this, at + 1);']]],
  ['FM12', 'suffix copy starts at i + 1', 'diff', [['    for (let k = i; k < n; k++) tree[b + k + 1] = meas[mb + k];', '    for (let k = i + 1; k < n; k++) tree[b + k + 1] = meas[mb + k];']]],
  ['FM13', 'suffix append rebuilds from n - 1 (correct tree, wrong counts)', 'diff', [[FW_SUFFIX_APPEND, '      if (this._sfx) fwSuffix(this, n - 1);']]],
  ['FM14', "splitAt writes out's measures at d * C (needs unequal capacities)", 'diff', [['      const mb = d * C + at;\n      const ob = d * oC;', '      const mb = d * C + at;\n      const ob = d * C;']]],
  ['FM15', "append reads other's measures at d * C (needs unequal capacities)", 'diff', [['      const mb = d * C + n;\n      const ob = d * oC;', '      const mb = d * C + n;\n      const ob = d * C;']]],
  ['FM16', "splitAt 'capacity' check dropped", 'throws', [["    if (!(k <= out._C)) fwFail('capacity', 'out cannot hold the moved elements');\n", '']]],
];

const MUT_KIND_BA = baKind('BlockedArray.mutant');
const MUT_KIND_FW = fwKind('FenwickRebuild.mutant', ['suffix', 'full']);

// A throw that escapes the battery counts as a kill ONLY when the row names an expected throw and the message matches
// it; any other escaping throw is rethrown so the test fails instead of reading "killed". optionRows (every row),
// runDiff (its op loop) and throwRows (its op call) catch inside and count a throw as a bad row (a broken diff-row
// splice that throws in the op loop still reads killed); a throw building or filling their views escapes here.
function batteryFailures(family, battery, K, expectThrow) {
  try {
    return batteryRun(family, battery, K);
  } catch (e) {
    if (expectThrow instanceof RegExp && e instanceof Error && expectThrow.test(e.message)) return 1;
    throw e;
  }
}

function batteryRun(family, battery, K) {
  if (battery === 'diff') return runDiff(family === 'BA' ? MUT_KIND_BA : MUT_KIND_FW, K, SEEDS, 1).bad;
  if (battery === 'throws') return throwRows(family === 'BA' ? BA_FAM(K) : FW_FAM(K)).bad.length;
  if (battery === 'split') return splitRows(K).length;
  if (battery === 'retention') return retentionRows(K).length;
  if (battery === 'options') return optionRows(K).length;
  if (battery === 'default') return defaultRows(K).length;
  throw new Error('unknown battery ' + battery);
}

// ---- the child: A4 lite-leak row + R7 meter lanes (needs --expose-gc and the meter flags) -------------------------

async function childMain(u) {
  const { BlockedArray: BA } = await import(u.ba);
  const { FenwickRebuild: FW } = await import(u.fw);
  const { loadVariant: load } = await import(u.variant);
  const L = await import(u.leak);
  const G = await import(u.prof);
  const M = await import(u.meter);
  const out = { semi: M.semiSpaceOk(), leak: null, ctlRetain: null, lanes: [], controls: [], gc: null };
  if (!out.semi) return out;
  const tick = (ms) => new Promise((r) => setTimeout(r, ms));
  const settle = async () => { globalThis.gc(); await tick(20); globalThis.gc(); await tick(20); };
  const K = new Int32Array(2);
  const onFin = () => { K[0]++; }; // closes over K only, never over a view
  const cycle = (tracker, retain, refs, kept) => {
    for (let a = 0; a < 100; a++) {
      const views = BA.arena(256, { dims: 2, chunkCap: 16 }, 3);
      const all = [views[0], views[1], views[2], new FW(64, { dims: 2, mode: (a & 1) === 1 ? 'suffix' : 'full' })];
      for (const v of all) {
        const hv = tracker.track(v, onFin, 'rival-view');
        const hc = tracker.track(v.cursor(), onFin, 'rival-cursor');
        refs.push(new WeakRef(v));
        refs.push(new WeakRef(v.cursor()));
        for (let j = 0; j < 40; j++) v.insertAt(j, j, j & 7, 1);
        v.cursor().seekIndex(5);
        if (!retain) v.clear();
        if (v.length === 0 && v.cursor().valid === false) {
          tracker.untrack(hv);
          tracker.untrack(hc);
        } else if (!retain) K[1]++;
        if (retain) kept.push(v);
      }
    }
  };
  const leakRun = async (retain) => {
    K[0] = 0;
    K[1] = 0;
    const leaks = [];
    const warns = [];
    const tracker = L.createLeakTracker({
      name: retain ? 'rivals-ctl' : 'rivals',
      onLeak: (r) => leaks.push(r.kind + ':' + String(r.tag)),
      onWarning: (w) => warns.push(w.kind + ':' + w.reason),
    });
    const unreg = [];
    for (const k of [L.createOwnerCascadeOrphanKernel(), L.createListenerOrphanKernel(), L.createObserverOrphanKernel(),
      L.createAsyncRetentionKernel()]) unreg.push(tracker.registerKernel(k));
    const refs = [];
    const kept = [];
    for (let c = 0; c < 10; c++) cycle(tracker, retain, refs, kept);
    await settle();
    const size = tracker.size();
    let alive = 0;
    for (const r of refs) if (r.deref() !== undefined) alive++;
    const findings = tracker.audit().length;
    const held = kept.length;
    kept.length = 0;
    for (const f of unreg) f();
    return { size, alive, fin: K[0], notReset: K[1], leaks: leaks.length, warns: warns.length, findings, held, tracked: refs.length };
  };
  out.leak = await leakRun(false);
  out.ctlRetain = await leakRun(true);
  await settle();

  const WIN = 6;
  const MASK = 4095;
  const bases = new Map();
  const base = (ops) => { if (!bases.has(ops)) bases.set(ops, M.baseline(ops, WIN)); return bases.get(ops); };
  const IOUT = new Int32Array(4);
  const P = new Int32Array(MASK + 1);
  const Y = new Int32Array(MASK + 1);
  const prof = new G.GcProfiler();
  prof.start();
  const gate = { enter: () => { prof.enter('lanes'); }, exit: () => { prof.exit(); } };
  const run = (list, name, step, ops, g) => {
    const b = base(ops);
    const r = M.lane(name, step, ops, WIN, undefined, g);
    list.push({ name, bop: M.bop(r, b), wins: M.winText(r, b) });
  };
  const lanesFor = (label, v, n, dims, list, g) => {
    for (let j = 0; j < n; j++) {
      if (dims === 1) v.insertAt(j, j & 0xFFFF, (j * 7) & 255);
      else v.insertAt(j, j & 0xFFFF, (j * 7) & 255, 1, 1, 1);
    }
    let s = 0x2545F491;
    for (let k = 0; k <= MASK; k++) {
      s = (Math.imul(s, 1664525) + 1013904223) | 0;
      P[k] = (s >>> 8) % n;
      s = (Math.imul(s, 1664525) + 1013904223) | 0;
      Y[k] = (s >>> 8) % (n * 128);
    }
    const c = v.cursor();
    const dl = dims - 1;
    run(list, label + '.getMeasure', (k) => { IOUT[0] = v.getMeasure(P[k & MASK], dl); }, 100000, g);
    run(list, label + '.entityAt', (k) => { IOUT[1] = v.entityAt(P[k & MASK]); }, 100000, g);
    run(list, label + '.total', (k) => { IOUT[2] = v.total(k & dl); }, 100000, g);
    run(list, label + '.seekSum+50next', (k) => {
      c.seekSum(0, Y[k & MASK]);
      let j = 0;
      while (j < 50 && c.next()) j++;
      IOUT[3] = c.index + j;
    }, 20000, g);
  };
  for (const dims of [1, 4]) lanesFor('BlockedArray.d' + dims, new BA(8192, { dims }), 4096, dims, out.lanes, gate);
  for (const mode of ['full', 'suffix']) {
    for (const dims of [1, 4]) lanesFor('FenwickRebuild.' + mode + '.d' + dims, new FW(2048, { dims, mode }), 1024, dims, out.lanes, gate);
  }
  // EDIT lanes (coder4): interleaved insertAt(length) / removeAt(0) on view 1 of a 3-view arena (views 0 and 2 hold
  // 4 rows each, so view 1's chunks interleave with theirs in the pool), 2000 ops per window = per call; every
  // window runs _split, _repairUnderflow -> _merge AND _equalize (counters read over the measured windows, each
  // must be > 0). EDIT_WARM windows run first, OUTSIDE the region: a 2000-op window invokes _merge only ~20 times,
  // so _merge runs interpreted (one HeapNumber per double load / add, ~912 B per call at dims 1) and removeAt in
  // Maglev until ~40,000 ops (measured 2026-11-01, node v26.8.2: window 20 at dims 1, 11 at dims 4); kernel-lane's
  // 1e5-op removeAt windows absorb the same tier-up inside window 0. Gate: per-call floor < 16 B AND < 1 B/op.
  const EDIT_N = 4096;
  const EDIT_OPS = 2000;
  const EDIT_WARM = 60;
  const ECNT = new Int32Array(8);
  const editLane = (list, label, Klass, dims, g) => {
    const vs = Klass.arena(EDIT_N + 16, { dims }, 3);
    const h = vs[1];
    for (let j = 0; j < 4; j++) {
      if (dims === 1) { vs[0].insertAt(j, j, 1); vs[2].insertAt(j, j, 1); } else { vs[0].insertAt(j, j, 1, 1, 1, 1); vs[2].insertAt(j, j, 1, 1, 1, 1); }
    }
    for (let j = 0; j < EDIT_N; j++) {
      if (dims === 1) h.insertAt(j, j & 0xFFFF, (j * 7) & 255);
      else h.insertAt(j, j & 0xFFFF, (j * 7) & 255, 1, 1, 1);
    }
    const step = dims === 1
      ? (k) => { if ((k & 1) === 0) h.insertAt(h.length, k & 0xFFFF, k & 255); else IOUT[0] = h.removeAt(0); }
      : (k) => { if ((k & 1) === 0) h.insertAt(h.length, k & 0xFFFF, k & 255, 1, 2, 3); else IOUT[0] = h.removeAt(0); };
    const b = base(EDIT_OPS);
    M.lane(label + '.warm', step, EDIT_OPS, EDIT_WARM);
    h.resetCounters();
    const r = M.lane(label, step, EDIT_OPS, WIN, undefined, g);
    h.readCounters(ECNT);
    const C = Klass.COUNTERS;
    list.push({ name: label, perCall: r.min - b.min, bop: M.bop(r, b), wins: M.winText(r, b), len: h.length,
      splits: ECNT[C.splits], merges: ECNT[C.merges], equalizes: ECNT[C.equalizes] });
  };
  // One FRESH module instance per lane (a tag comment makes each data: URL distinct): the class used by the A4
  // cycles and the R7 lanes above carries their JIT history (TurboFan code of a repair path deoptimized when a dead
  // arena's map is cleared, then slow to re-tier), which would make this floor depend on the earlier phases.
  const KEY_ANCHOR = "const BA_KEY = Symbol('BlockedArray key');";
  const fresh = async (vn, tag, hunks) => (await load(vn, [[KEY_ANCHOR, KEY_ANCHOR + ' // ' + tag]].concat(hunks))).BlockedArray;
  out.edit = [];
  for (const vn of ['unrolled', 'plain']) {
    for (const dims of [1, 4]) {
      const label = 'BlockedArray.' + vn + '.d' + dims + '.edit.view1';
      editLane(out.edit, label, await fresh(vn, label, []), dims, gate);
    }
  }
  await prof.settle();
  const s = prof.summary();
  prof.stop();
  const rep = G.checkNoGc(s, { perRegion: { lanes: { maxMajor: 0 } } });
  const lg = s.byRegion && s.byRegion.lanes ? s.byRegion.lanes.gc : null;
  out.gc = { ok: rep.ok === true && lg !== null, major: lg ? lg.major : -1, minor: lg ? lg.minor : -1 };
  // controls (outside the region): a .subarray() inside _locate, and one box per op; each MUST fail bop < 1
  const SubBA = (await load('unrolled', [['    const dirSize = this.dirSize;\n    const n = this.dirLen;',
    '    const dirSize = this.dirSize.subarray(0, this.dirLen);\n    const n = this.dirLen;']])).BlockedArray;
  const cl = [];
  const sv = new SubBA(8192, { dims: 1 });
  for (let j = 0; j < 4096; j++) sv.insertAt(j, j, (j * 7) & 255);
  // 1e4 ops per window: a subarray view is ~100 B, so 1e5 ops would overflow the 4 MB semi-space in every window
  run(cl, 'ctl.rival.subarray.entityAt', (k) => { IOUT[1] = sv.entityAt(P[k & MASK]); }, 10000);
  const HOLD = [null, null];
  const FR = new Float64Array(MASK + 1);
  for (let k = 0; k <= MASK; k++) FR[k] = k + 0.5;
  run(cl, 'ctl.oneBox', (k) => { HOLD[k & 1] = FR[k & MASK]; }, 25000);
  out.controls = cl;
  // EDIT controls: the same lane on a mutant with a .subarray() view in _merge / in _equalize (one per call of it);
  // each MUST fail the edit gate, so the lane provably meters those two repair paths after the warm-up
  out.editCtl = [];
  const MergeBA = await fresh('unrolled', 'ctl.merge', [['    const dirTail = this.dirLen - (rightDir + 1);',
    '    const dirTail = this.dir.subarray(0, this.dirLen).length - (rightDir + 1);']]);
  const EqBA = await fresh('unrolled', 'ctl.equalize', [['    this.dirSize[leftDir] = targetLeft;',
    '    this.dirSize[leftDir] = this.dir.subarray(0, 1).length * targetLeft;']]);
  editLane(out.editCtl, 'ctl.edit.subarray._merge', MergeBA, 1);
  editLane(out.editCtl, 'ctl.edit.subarray._equalize', EqBA, 1);
  return out;
}

let childResult = null;
function runChild() {
  if (childResult) return childResult;
  const u = {
    ba: BA_URL.href, fw: FW_URL.href, variant: new URL('../benchmark/rivals/variant.mjs', import.meta.url).href,
    meter: new URL('./torture-meter.mjs', import.meta.url).href,
    leak: import.meta.resolve('@zakkster/lite-leak'), prof: import.meta.resolve('@zakkster/lite-gc-profiler'),
  };
  const code = '(' + childMain.toString() + ')(' + JSON.stringify(u) + ').then((r) => { process.stdout.write("RESULT " + JSON.stringify(r) + "\\n"); },' +
    ' (e) => { process.stderr.write(String(e && e.stack || e)); process.exit(1); });';
  const r = spawnSync(process.execPath, ['--expose-gc', '--no-concurrent-recompilation', '--min-semi-space-size=4',
    '--max-semi-space-size=4', '--input-type=module', '-e', code], { cwd: PKG, encoding: 'utf8', timeout: 180000 });
  assert.equal(r.status, 0, 'child failed: ' + r.stderr + r.stdout.slice(-800));
  const line = r.stdout.split('\n').find((l) => l.startsWith('RESULT '));
  assert.ok(line, 'child printed no RESULT line: ' + r.stdout);
  childResult = JSON.parse(line.slice(7));
  return childResult;
}

// ==================================================================================================================

describe('A1 / R1 / R2 / R6: differential vs test/oracle.mjs', () => {
  for (const [name, kind, getK] of KINDS) {
    test(name + ': 0 mismatches, coverage floors, pinned op count', async () => {
      const K = await getK();
      const res = runDiff(kind, K, SEEDS, Infinity);
      console.log('# ' + name + ' ops=' + res.ops + ' mismatches=' + res.bad + ' cov=' + JSON.stringify(res.cov));
      assert.equal(res.bad, 0, res.first.join('\n'));
      for (const [k, f] of Object.entries(kind.floors)) assert.ok(res.cov[k] >= f, 'coverage ' + k + ' = ' + res.cov[k] + ' < ' + f);
      assert.equal(res.ops, SEEDS.length * OPS_PER_SEED, 'op count');
      assert.deepEqual(PIN_KEYS.map((k) => res.cov[k]), OPS_PIN[name], 'op mix drifted');
    });
  }
});

describe('throw rows: token + state unchanged', () => {
  const TOKENS = ['index', 'entity', 'dim', 'measure', 'extra', 'headroom', 'seek', 'operand', 'capacity'];
  for (const [name, fam] of [['BlockedArray', BA_FAM(BlockedArray)], ['FenwickRebuild', FW_FAM(FenwickRebuild)]]) {
    test(name + ': every row throws its token, the oracle agrees, no view changes', () => {
      const r = throwRows(fam);
      assert.deepEqual(r.bad, []);
      for (const t of TOKENS) assert.ok(r.seen.has(t), 'no rejected op for token ' + t);
    });
  }
  test('BlockedArray.plain: the same rows', async () => {
    const r = throwRows(BA_FAM((await loadVariant('plain')).BlockedArray));
    assert.deepEqual(r.bad, []);
  });
});

describe('FenwickRebuild options, counters, default mode (R3, R4)', () => {
  test('R4: option / mode / check-order / readCounters rows', () => {
    assert.deepEqual(optionRows(FenwickRebuild), []);
  });
  test("R3: the default mode is 'full' for new F(C) and new F(C, { dims })", () => {
    assert.deepEqual(defaultRows(FenwickRebuild), []);
  });
  test('COUNTER_MAP key sets equal SumSequence.COUNTERS; every value a native counter or n/a', () => {
    const engine = Object.keys(SumSequence.COUNTERS).sort();
    for (const K of [BlockedArray, FenwickRebuild]) {
      assert.deepEqual(Object.keys(K.COUNTER_MAP).sort(), engine, K.name);
      for (const v of Object.values(K.COUNTER_MAP)) assert.ok(v === 'n/a' || Object.hasOwn(K.COUNTERS, v), K.name + ' ' + v);
    }
    assert.equal(BlockedArray.COUNTER_MAP.touches, 'dirScans');
    assert.equal(BlockedArray.COUNTER_MAP.moves, 'elemMoves');
    assert.equal(FenwickRebuild.COUNTER_MAP.moves, 'elemMoves');
    assert.equal(Object.values(FenwickRebuild.COUNTER_MAP).filter((v) => v !== 'n/a').length, 1, 'BA-8: only moves pairs');
  });
});

describe('BlockedArray split points (R5, BA-14), retention (A4), space (A5)', () => {
  test('R5: cut ratios at B = 8 / 12 / 16 / 32 / 64, neighbours unchanged', async () => {
    assert.deepEqual(splitRows(BlockedArray), []);
    assert.deepEqual(splitRows((await loadVariant('plain')).BlockedArray), []);
  });
  test('A4: 10 cycles of 1e4 ops then clear() on every view: freeTop === maxChunks, liveElements === 0', () => {
    assert.deepEqual(retentionRows(BlockedArray), []);
  });
  test('A5: spaceSlots and the C = 1e6 default', () => {
    assert.equal(BlockedArray.spaceSlots(32, 32, 1), 320);
    assert.equal(BlockedArray.spaceSlots(32, 32, 3), 448);
    assert.equal(BlockedArray.spaceSlots(1e6, 0, 1), 4006000);
    const v = new BlockedArray(1e6);
    assert.equal(v.chunkCap, 1000);
    assert.equal(v.maxChunks, 4006);
    assert.equal(v.maxChunks * v.chunkCap, 4006000);
  });
});

describe('mutants: each fails its battery (a survivor fails this file)', () => {
  for (const [id, what, battery, hunks, thr] of BA_MUTANTS) {
    test('BlockedArray ' + id + ' ' + what + ' -> ' + battery, async () => {
      const K = (await loadVariant('unrolled', hunks)).BlockedArray;
      assert.ok(batteryFailures('BA', battery, K, thr) >= 1, id + ' SURVIVED battery ' + battery);
    });
  }
  for (const [id, what, battery, hunks, thr] of FW_MUTANTS) {
    test('FenwickRebuild ' + id + ' ' + what + ' -> ' + battery, async () => {
      const K = await fwLoad(hunks, id);
      assert.ok(batteryFailures('FW', battery, K, thr) >= 1, id + ' SURVIVED battery ' + battery);
    });
  }
  test('teeth (a): BM6 is killed by the /pool exhausted/ throw itself, not by some other crash', async () => {
    const row = BA_MUTANTS.find((r) => r[0] === 'BM6');
    assert.ok(row[4] instanceof RegExp, 'BM6 must name its expected throw');
    const K = (await loadVariant('unrolled', row[3])).BlockedArray;
    let err = null;
    try { retentionRows(K); } catch (e) { err = e; }
    assert.ok(err !== null, 'BM6 retention battery did not throw');
    assert.match(err.message, /pool exhausted/);
    assert.ok(row[4].test(err.message), 'the row regex does not match the real throw: ' + err.message);
    assert.equal(batteryFailures('BA', 'retention', K, row[4]), 1);
  });
  test('teeth (b): an unexpected throw is rethrown, never counted as a kill', () => {
    const boom = { arena() { throw new TypeError('harness crash'); } }; // retentionRows calls K.arena first
    assert.throws(() => batteryFailures('BA', 'retention', boom), TypeError);
    assert.throws(() => batteryFailures('BA', 'retention', boom, /pool exhausted/), TypeError); // regex mismatch
    assert.throws(() => batteryFailures('BA', 'no-such-battery', BlockedArray), /unknown battery/);
    assert.equal(batteryFailures('BA', 'retention', boom, /harness crash/), 1); // a matching expectation is the only kill
  });
  test('every battery reads 0 on the real classes (the mutant rows are not vacuous)', () => {
    for (const b of ['throws', 'split', 'retention']) assert.equal(batteryFailures('BA', b, BlockedArray), 0, 'BA ' + b);
    for (const b of ['throws', 'options', 'default']) assert.equal(batteryFailures('FW', b, FenwickRebuild), 0, 'FW ' + b);
  });
});

describe('child (--expose-gc): A4 lite-leak, R7 rival meter lanes + must-fail controls', () => {
  test('A4: tracker.size() returns to 0 after 10 cycles of 100 arenas (3 views + cursors) + Fenwick', () => {
    const r = runChild();
    assert.equal(r.semi, true, 'semi-space flags not pinned in the child');
    const k = r.leak;
    console.log('# leak ' + JSON.stringify(k) + ' ctl.retain ' + JSON.stringify(r.ctlRetain));
    assert.equal(k.tracked, 8000);
    assert.deepEqual([k.size, k.alive, k.fin, k.notReset, k.leaks, k.findings, k.warns], [0, 0, 0, 0, 0, 0, 0]);
    assert.ok(r.ctlRetain.size >= 1, 'ctl.retain (clear() skipped, views kept) must leave size() >= 1');
  });
  // Y-CI-6a (burst 44): every lane B/op row and every must-fail control row goes through test/meter-gate.mjs
  // (asserted on node >= 24, REPORTED on < 24); counts, field presence, split / merge / equalize / len and gc stay
  // asserted on every version. Prints live in the test bodies, so the replay below prints nothing per lane.
  // meter rows: 24 lanes + 2 controls = 26
  function r7Gate(r, ver = process.versions.node, log = console.log) {
    const m = meter(ver, log);
    assert.equal(r.lanes.length, 24);
    for (const l of r.lanes) {
      // JSON carries NaN (every window discarded) as null: a non-number reading fails closed, lane or control
      assert.ok(Object.hasOwn(l, 'bop'), l.name + ' has no bop field');
      m.ok(typeof l.bop === 'number' && l.bop < 1, l.name + ' bop ' + l.bop);
    }
    assert.equal(r.gc.ok, true, 'gc region: ' + JSON.stringify(r.gc));
    assert.equal(r.gc.major, 0, 'lanes-region gc major');
    assert.equal(r.controls.length, 2);
    for (const l of r.controls) {
      assert.ok(Object.hasOwn(l, 'bop'), l.name + ' has no bop field');
      m.ok(typeof l.bop === 'number' && !(l.bop < 1), l.name + ' must FAIL bop < 1, read ' + l.bop);
    }
    const rep = m.report();
    assert.equal(rep.asserted + rep.reported, 26, 'meter rows');
    assert.equal(rep.gated ? rep.reported : rep.asserted, 0, 'every meter row on one tier');
    return rep;
  }
  // meter rows: 4 edit lanes x (perCall + bop) + 2 edit controls = 10
  function editGate(r, ver = process.versions.node, log = console.log) {
    const m = meter(ver, log);
    assert.equal(r.edit.length, 4);
    for (const l of r.edit) {
      // JSON carries NaN as null: a non-number reading fails closed
      assert.ok(Object.hasOwn(l, 'perCall') && Object.hasOwn(l, 'bop'), l.name + ' has no perCall / bop field');
      m.ok(typeof l.perCall === 'number' && l.perCall < 16, l.name + ' perCall ' + l.perCall);
      m.ok(typeof l.bop === 'number' && l.bop < 1, l.name + ' bop ' + l.bop);
      assert.ok(l.splits > 0 && l.merges > 0 && l.equalizes > 0, l.name + ' did not reach split / merge / equalize');
      assert.equal(l.len, 4096, l.name + ' length');
    }
    assert.equal(r.editCtl.length, 2);
    for (const l of r.editCtl) {
      assert.ok(l.merges > 0 && l.equalizes > 0, l.name + ' did not reach merge / equalize');
      assert.ok(Object.hasOwn(l, 'perCall'), l.name + ' has no perCall field');
      m.ok(typeof l.perCall === 'number' && !(l.perCall < 16), l.name + ' must FAIL perCall < 16, read ' + l.perCall);
    }
    const rep = m.report();
    assert.equal(rep.asserted + rep.reported, 10, 'meter rows');
    assert.equal(rep.gated ? rep.reported : rep.asserted, 0, 'every meter row on one tier');
    return rep;
  }
  test('R7 / A3: every rival lane < 1 B/op, maxMajor 0; both controls read >= 1 B/op', () => {
    const r = runChild();
    for (const l of r.lanes) console.log('# lane ' + l.name + ' bop=' + String(l.bop) + ' [' + l.wins + ']');
    for (const l of r.controls) console.log('# control ' + l.name + ' bop=' + String(l.bop) + ' [' + l.wins + ']');
    r7Gate(r);
  });
  const shown = (l) => l.name + ' perCall=' + String(l.perCall) + ' bop=' + String(l.bop) + ' splits=' + l.splits +
    ' merges=' + l.merges + ' equalizes=' + l.equalizes + ' len=' + l.len + ' [' + l.wins + ']';
  test('EDIT: interleaved insertAt / removeAt on arena view 1, both variants, dims 1 / 4: < 16 B per 2000-op call and < 1 B/op; both controls fail', () => {
    const r = runChild();
    for (const l of r.edit) console.log('# edit ' + shown(l));
    for (const l of r.editCtl) console.log('# edit control ' + shown(l));
    editGate(r);
  });
  // Y-CI-6a replay: the census b43 node 22.23.4 readings written into a clone of the real child. On HEAD's gates (no
  // meter) every one of them fails; here they are REPORTED on 22.23.4 and still fail on 26.8.2, and the always-gated
  // rows (gc major, field presence, lane count) still fail on 22.23.4.
  test('Y-CI-6a replay: census readings in a clone of the child are REPORTED on 22.23.4 (each named outside), fail on 26.8.2; gc major 1 / a deleted perCall / a popped lane fail on 22.23.4', () => {
    const real = runChild();
    const injected = [];
    const inject = () => {
      const c = structuredClone(real);
      injected.length = 0;
      const e = c.edit.find((x) => x.name === 'BlockedArray.unrolled.d1.edit.view1');
      assert.ok(e, 'no edit lane BlockedArray.unrolled.d1.edit.view1');
      e.perCall = 11904; injected.push(e.name);
      const l = c.lanes.find((x) => x.name === 'BlockedArray.d1.seekSum+50next');
      assert.ok(l, 'no lane BlockedArray.d1.seekSum+50next');
      l.bop = 1.5; injected.push(l.name);
      c.editCtl[0].perCall = -648; injected.push(c.editCtl[0].name);
      return c;
    };
    const lines = [];
    const log = (x) => lines.push(x);
    const c = inject();
    const r7 = r7Gate(c, '22.23.4', log);
    const ed = editGate(c, '22.23.4', log);
    console.log('# replay 22.23.4 ' + JSON.stringify({ r7: r7.outside, edit: ed.outside }));
    assert.deepEqual([r7.gated, r7.reported, ed.gated, ed.reported], [false, 26, false, 10]);
    const outside = [...r7.outside, ...ed.outside];
    for (const name of injected) assert.ok(outside.some((o) => o.startsWith(name + ' ')), name + ' is not an outside row: ' + JSON.stringify(outside));
    assert.equal(lines.filter((x) => x.startsWith('# REPORTED ' + METER_REASON + ' [node 22.23.4: ')).length, 2, lines.join('\n'));
    const quiet = () => {};
    const named = (err) => err instanceof assert.AssertionError && injected.some((name) => err.message.startsWith(name + ' '));
    assert.throws(() => r7Gate(inject(), '26.8.2', quiet), named);
    assert.throws(() => editGate(inject(), '26.8.2', quiet), named);
    const g = inject(); g.gc.major = 1;
    assert.throws(() => r7Gate(g, '22.23.4', quiet), (err) => err instanceof assert.AssertionError && /lanes-region gc major/.test(err.message));
    const d = inject(); delete d.edit[0].perCall;
    assert.throws(() => editGate(d, '22.23.4', quiet), (err) => err instanceof assert.AssertionError && /has no perCall \/ bop field/.test(err.message));
    const p = inject(); p.lanes.pop();
    assert.throws(() => r7Gate(p, '22.23.4', quiet), assert.AssertionError);
    const q = inject(); q.edit.pop();
    assert.throws(() => editGate(q, '22.23.4', quiet), assert.AssertionError);
  });
});
