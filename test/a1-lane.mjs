// test/a1-lane.mjs -- the C-34 A1 run: finger on == finger off, six xorshift32 streams (ADR 0005 C-34, C-27, C-35,
// R-E1). Wired into `npm run test:lanes` SECTION 3 of test/engine-lanes.mjs (exports runA1); `node test/a1-lane.mjs`
// runs it standalone (exit 1 on any failure). test/Finger.test.mjs part 3 reuses a1Stream() with a short stream.
//
// Written from C-34 / C-27 / C-35, never from the engine's output:
// - streams: op 0x9E3779B9^s, index 0x85EBCA6B^s, measure 0xC2B2AE35^s, xorshift32 (x^=x<<13; x^=x>>>17; x^=x<<5;
//   x>>>0); seeds s 1..3 x B 8 / 16, arena(4096, {dims:1}, 3); 1e4 executed ops; floor(o/2500) even = grow, odd =
//   drain. Weights insertAt / removeAt / setMeasure / getMeasure / entityAt / indexAtSum / sumBefore / splitAt+append:
//   grow 61/16/4/4/4/4/4/3, drain 16/61/4/4/4/4/4/3. class = op draw % 100, then view = the NEXT op draw & 1. A
//   removeAt / setMeasure / getMeasure / entityAt on an empty view, or insertAt at live == C: class AND view redrawn,
//   the redraw is not counted. Fixed clears after op o with o % 5000 == 4999: clear(view 0), clear(view 1), no draws.
//   Index draw r: r&1 -> clamp(last + (r>>>1)%3 - 1, 0, range-1), else (r>>>1) % range; range = n+1 for insertAt /
//   sumBefore / splitAt, else n; `last` shared across views; indexAtSum and clear draw no index. Measure r % 1000 with
//   5% zeros ((r>>>16) % 20 == 0 -> 0, the B2 reading of C-32); indexAtSum y = r % (total + 1). splitAt+append =
//   splitAt(i, view 2); append(view 2), ONE stream op. Entity = the executed-op number.
// - comparison and the finger-off write follow C-27: off run writes NIL / 0 / 0 into _fl / _fb / _fdepth of every view
//   before each op; answers compared with Object.is; walker verdicts must be null on both runs; walker state (the
//   snapshot minus the four finger fields) equal; finger fields compared after a successful positional op, splitAt,
//   append and clear on the op's own view(s) (both NIL is equal; _fpath on [0, _fdepth)); a finger-neutral op
//   (indexAtSum / sumBefore) leaves the on finger byte-identical and the off finger NIL. A throw is compared by kind
//   and message token and skips the finger compare.
// - floors per stream (on run): splits >= 100, merges >= 25, equalizes >= 25 (COUNTERS deltas across insertAt /
//   removeAt only), hit-after-structural >= 25 (the next stream op is a positional op on the same view and a finger
//   hit, after a split / merge / equalize of insertAt / removeAt), fingerHits >= 2000, splitAt+append >= 100, >= 1
//   fixed clear on a non-empty view with fl !== NIL. Standing: hits + misses == positional ops, off-run fingerHits 0.
// - controls (PLAN-E0-F ASSERTION 5): the MF-2 and MF-4 wrappers (C-35: test wrappers that rewrite the on view's own
//   finger fields around the correct build, no source patch) each give >= 1 divergence; an all-off on run fails the
//   fingerHits floor.
//
// A missed floor: STOP (C-34: the weights change only with an addendum, never the floors or the seeds).
// ASCII-only. MIT (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>

import { pathToFileURL } from 'node:url';
import { SumSequence } from '../Yggdrasil.js';
import { engineFactory } from './adapter.mjs';
import { walk } from './walker.mjs';

const CN = SumSequence.COUNTERS;
const A1_C = 4096;
const FLOORS = Object.freeze({
  splits: 100, merges: 25, equalizes: 25, hitAfterStructural: 25, fingerHits: 2000, splitAppend: 100, clearsLive: 1,
});
const CLASSES = ['insertAt', 'removeAt', 'setMeasure', 'getMeasure', 'entityAt', 'indexAtSum', 'sumBefore', 'splitAt'];
const W_GROW = [61, 16, 4, 4, 4, 4, 4, 3];
const W_DRAIN = [16, 61, 4, 4, 4, 4, 4, 3];
const POSITIONAL = ['insertAt', 'removeAt', 'setMeasure', 'getMeasure', 'entityAt'];
const NEUTRAL = ['indexAtSum', 'sumBefore'];
const FINGER_KEYS = ['_fl', '_fb', '_fdepth', '_fpath'];

function xs(x) {
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}

// ---- independent helpers (this file's own; nothing is shared with the engine) ----------------

function stateOf(snap) {
  const out = {};
  for (const k of Object.keys(snap)) if (k !== 'views') out[k] = snap[k];
  out.views = snap.views.map((w) => {
    const c = {};
    for (const k of Object.keys(w)) if (!FINGER_KEYS.includes(k)) c[k] = w[k];
    return c;
  });
  return out;
}

// Iterative deep equality; null or the path of the first difference.
function diff(x, y) {
  const st = [x, y, ''];
  while (st.length) {
    const path = st.pop();
    const b = st.pop();
    const a = st.pop();
    if (Object.is(a, b)) continue;
    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return path || '.';
    if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
      if (!ArrayBuffer.isView(a) || !ArrayBuffer.isView(b) || a.length !== b.length) return path + ' (typed array)';
      for (let k = 0; k < a.length; k++) if (!Object.is(a[k], b[k])) return path + '[' + k + ']';
      continue;
    }
    if (Array.isArray(a) !== Array.isArray(b)) return path + ' (array)';
    const ka = Object.keys(a);
    if (ka.length !== Object.keys(b).length) return path + ' (keys)';
    for (const k of ka) {
      if (!Object.hasOwn(b, k)) return path + '.' + k + ' (missing)';
      st.push(a[k], b[k], path + '.' + k);
    }
  }
  return null;
}

function fingerSame(f, g, NIL) {
  if (f._fl === NIL && g._fl === NIL) return true;
  if (f._fl !== g._fl || f._fb !== g._fb || f._fdepth !== g._fdepth) return false;
  for (let k = 0; k < f._fdepth; k++) if (f._fpath[k] !== g._fpath[k]) return false;
  return true;
}

function copyFinger(w) {
  return { fl: w._fl, fb: w._fb, depth: w._fdepth, path: Array.from(w._fpath) };
}

function putFinger(w, f) {
  w._fl = f.fl; w._fb = f.fb; w._fdepth = f.depth;
  for (let k = 0; k < f.depth; k++) w._fpath[k] = f.path[k];
}

// Root-to-leaf descent by the element rule `k < count[left]` over snapshot s, view vi, element k.
function descend(s, vi, k) {
  let ref = s.views[vi]._root;
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

function call(views, x) {
  const a = views[x.vi];
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
      case 'splitAt': v = a.splitAt(x.i, views[2]); break;
      case 'append': v = a.append(views[2]); break;
      default: v = a.clear(); break; // 'clear'
    }
    if (v !== null && typeof v === 'object') return { kind: 'view', v: views.indexOf(v) };
    return { kind: 'value', v: v };
  } catch (err) {
    if (err instanceof RangeError) return { kind: 'throw', v: String(err.message).split(' ', 1)[0] };
    return { kind: 'error', v: String(err && err.message) };
  }
}

const same = (r, s) => r.kind === s.kind && Object.is(r.v, s.v);
const show = (r) => r.kind + ' ' + String(r.v);

// ---- one stream -------------------------------------------------------------------------------
// opts: B, seed, ops (executed ops), mode 'real' | 'mf2' | 'mf4' | 'off', stopAtFirst (stop at the first divergence).
// Returns { B, seed, mode, ops, divergences, first, splits, merges, equalizes, hitAfterStructural, fingerHits,
//   fingerMisses, positional, splitAppend, clearsLive, offHits, walkerFails, missed (floor names) }.

export function a1Stream(opts) {
  const B = opts.B;
  const seed = opts.seed;
  const nOps = opts.ops === undefined ? 10000 : opts.ops;
  const mode = opts.mode === undefined ? 'real' : opts.mode;
  const on = engineFactory(A1_C, { leafSize: B, dims: 1 }, 3);
  const off = engineFactory(A1_C, { leafSize: B, dims: 1 }, 3);
  const NIL = on.views[0]._fl; // read from a fresh view, never a literal
  for (const r of [on, off]) {
    for (const w of r.views) {
      for (const f of FINGER_KEYS) if (!Object.hasOwn(w, f)) throw new Error('a1: view lacks own ' + f + ' (C-27)');
    }
  }
  const rep = {
    B, seed, mode, ops: 0, divergences: 0, first: null, splits: 0, merges: 0, equalizes: 0, hitAfterStructural: 0,
    fingerHits: 0, fingerMisses: 0, positional: 0, splitAppend: 0, clearsLive: 0, offHits: 0, walkerFails: 0,
    missed: [],
  };
  const cO = new Int32Array(12);
  const cF = new Int32Array(12);
  function sums(r, key) {
    let t = 0;
    for (const w of r.views) { w.readCounters(cO); t += cO[CN[key]]; }
    return t;
  }
  let pending = -1; // view of the last structural insertAt / removeAt, for the next stream op
  let so = (0x9E3779B9 ^ seed) >>> 0;
  let si = (0x85EBCA6B ^ seed) >>> 0;
  let sm = (0xC2B2AE35 ^ seed) >>> 0;
  let last = 0;
  let stop = false;

  function diverge(code, detail, x) {
    rep.divergences++;
    if (rep.first === null) rep.first = { code, detail, op: x.op, view: x.vi, n: rep.ops };
    if (opts.stopAtFirst) stop = true;
  }

  // One compared step (op x on both runs). Returns the on-run hit delta (0/1) for the positional case.
  function step(x) {
    const positional = POSITIONAL.includes(x.op);
    const neutral = NEUTRAL.includes(x.op);
    for (const w of off.views) { w._fl = NIL; w._fb = 0; w._fdepth = 0; }
    if (mode === 'off') for (const w of on.views) { w._fl = NIL; w._fb = 0; w._fdepth = 0; }
    const preFingers = on.views.map(copyFinger);
    const preSnap = mode === 'mf4' ? on.snapshot() : null;
    const nPre = x.vi < 2 ? on.views[x.vi]._len : 0;
    const liveFl = x.op === 'clear' ? on.views[x.vi]._fl !== NIL && nPre > 0 : false;
    const h0 = sums(on, 'fingerHits');
    const m0 = sums(on, 'fingerMisses');
    const sp0 = sums(on, 'splits');
    const mg0 = sums(on, 'merges');
    const eq0 = sums(on, 'equalizes');
    const oh0 = sums(off, 'fingerHits');
    const rOn = call(on.views, x);
    const rOff = call(off.views, x);
    const ok = rOn.kind !== 'throw' && rOn.kind !== 'error';
    const dSp = sums(on, 'splits') - sp0;
    const dMg = sums(on, 'merges') - mg0;
    const dEq = sums(on, 'equalizes') - eq0;
    const structural = (x.op === 'insertAt' || x.op === 'removeAt') && ok && dSp + dMg + dEq > 0;
    // C-35 wrappers on the ON run only: rewrite the view's own finger fields around the correct build
    if (ok && positional) {
      const w = on.views[x.vi];
      if (mode === 'mf2') putFinger(w, preFingers[x.vi]); // MF-2: a miss keeps the finger
      else if (mode === 'mf4' && structural && nPre > 0) {
        // MF-4: a structural op re-homes to the touched leaf with its pre-op fb and path (C-35 / RF-3)
        const d = descend(preSnap, x.vi, Math.min(x.i, nPre - 1));
        putFinger(w, { fl: d.fl, fb: d.fb, depth: d.depth, path: d.path });
      }
    }
    const sOn = on.snapshot();
    const sOff = off.snapshot();
    const wOn = walk(sOn, { B, dims: 1 });
    const wOff = walk(sOff, { B, dims: 1 });
    if (wOn !== null) { rep.walkerFails++; diverge('walker-on', wOn.code + ' ' + wOn.detail, x); }
    if (wOff !== null) { rep.walkerFails++; diverge('walker-off', wOff.code + ' ' + wOff.detail, x); }
    if (!same(rOn, rOff)) diverge('answer', 'on ' + show(rOn) + ', off ' + show(rOff), x);
    const d = diff(stateOf(sOn), stateOf(sOff));
    if (d !== null) diverge('state', d, x);
    if (ok && (positional || x.op === 'splitAt' || x.op === 'append' || x.op === 'clear')) {
      const own = positional || x.op === 'clear' ? [x.vi] : [x.vi, 2];
      for (const v of own) {
        if (!fingerSame(sOn.views[v], sOff.views[v], NIL)) {
          diverge('finger', 'view ' + v + ' on fl ' + sOn.views[v]._fl + ' fb ' + sOn.views[v]._fb + ' depth ' +
            sOn.views[v]._fdepth + ', off fl ' + sOff.views[v]._fl + ' fb ' + sOff.views[v]._fb + ' depth ' +
            sOff.views[v]._fdepth, x);
        }
      }
    }
    if (neutral) {
      for (let v = 0; v < 3; v++) {
        const f = preFingers[v];
        let eq = on.views[v]._fl === f.fl;
        if (eq && f.fl !== NIL) {
          eq = on.views[v]._fb === f.fb && on.views[v]._fdepth === f.depth;
          for (let k = 0; eq && k < f.depth; k++) eq = on.views[v]._fpath[k] === f.path[k];
        }
        if (!eq) diverge('neutral-on', x.op + ' moved the on finger of view ' + v, x);
        if (off.views[v]._fl !== NIL) diverge('neutral-off', x.op + ' wrote the off finger of view ' + v, x);
      }
    }
    // tallies on the on run
    const dH = sums(on, 'fingerHits') - h0;
    const dM = sums(on, 'fingerMisses') - m0;
    rep.offHits += sums(off, 'fingerHits') - oh0;
    if (ok && positional) {
      rep.positional++;
      rep.fingerHits += dH;
      rep.fingerMisses += dM;
      if (dH + dM !== 1) diverge('partition', x.op + ' hits +' + dH + ' misses +' + dM, x);
    } else if (dH !== 0 || dM !== 0) diverge('partition', x.op + ' moved hits +' + dH + ' misses +' + dM, x);
    if (x.op === 'insertAt' || x.op === 'removeAt') { rep.splits += dSp; rep.merges += dMg; rep.equalizes += dEq; }
    if (x.op === 'clear' && liveFl) rep.clearsLive++;
    return { hit: dH, structural, ok };
  }

  for (let o = 0; o < nOps && !stop; o++) {
    const w = (Math.floor(o / 2500) & 1) === 0 ? W_GROW : W_DRAIN;
    let cls = -1;
    let vi = 0;
    for (let redraw = 0; cls < 0; redraw++) {
      if (redraw > 100000) throw new Error('a1: no drawable class');
      so = xs(so);
      let r = so % 100;
      let c = 0;
      while (r >= w[c]) { r -= w[c]; c++; }
      so = xs(so);
      const v = so & 1;
      const name = CLASSES[c];
      const n = on.views[v]._len;
      if ((name === 'removeAt' || name === 'setMeasure' || name === 'getMeasure' || name === 'entityAt') && n === 0) continue;
      if (name === 'insertAt' && on.views[0]._len + on.views[1]._len >= A1_C) continue;
      cls = c;
      vi = v;
    }
    const name = CLASSES[cls];
    const n = on.views[vi]._len;
    const x = { op: name, vi, i: 0, e: o & 0x3FFFFFFF, m: 0, y: 0 };
    if (name !== 'indexAtSum') {
      const range = name === 'insertAt' || name === 'sumBefore' || name === 'splitAt' ? n + 1 : n;
      si = xs(si);
      if ((si & 1) === 1) x.i = Math.min(Math.max(last + ((si >>> 1) % 3) - 1, 0), range - 1);
      else x.i = (si >>> 1) % range;
      last = x.i;
    }
    if (name === 'insertAt' || name === 'setMeasure' || name === 'indexAtSum') {
      sm = xs(sm);
      if (name === 'indexAtSum') x.y = sm % (on.views[vi].total(0) + 1);
      else x.m = ((sm >>> 16) % 20) === 0 ? 0 : sm % 1000;
    }
    const wasPending = pending;
    pending = -1;
    const res = step(x);
    rep.ops++;
    if (POSITIONAL.includes(name) && wasPending === vi && res.ok && res.hit === 1) rep.hitAfterStructural++;
    if (res.structural) pending = vi;
    if (name === 'splitAt' && !stop) {
      const y = { op: 'append', vi, i: 0, e: 0, m: 0, y: 0 };
      step(y);
      rep.splitAppend++;
    }
    if (o % 5000 === 4999 && !stop) {
      pending = -1;
      for (let v = 0; v < 2; v++) step({ op: 'clear', vi: v, i: 0, e: 0, m: 0, y: 0 });
    }
  }
  if (mode === 'real' || mode === 'off') {
    for (const k of Object.keys(FLOORS)) if (!(rep[k] >= FLOORS[k])) rep.missed.push(k + ' ' + rep[k] + ' < ' + FLOORS[k]);
  }
  return rep;
}

export function streamOk(rep) {
  return rep.divergences === 0 && rep.missed.length === 0 && rep.offHits === 0 &&
    rep.fingerHits + rep.fingerMisses === rep.positional;
}

export async function runA1() {
  let failures = 0;
  const lines = [];
  const t0 = Date.now();
  const rows = [];
  for (const B of [8, 16]) {
    for (const s of [1, 2, 3]) {
      const r = a1Stream({ B, seed: s });
      rows.push(r);
      const ok = streamOk(r);
      if (!ok) failures++;
      lines.push(`A1 B=${B} s=${s} ops=${r.ops} div=${r.divergences} splits=${r.splits} merges=${r.merges} ` +
        `equalizes=${r.equalizes} hitAfterStructural=${r.hitAfterStructural} fingerHits=${r.fingerHits} ` +
        `misses=${r.fingerMisses} positional=${r.positional} splitAt+append=${r.splitAppend} ` +
        `clearsLive=${r.clearsLive} offHits=${r.offHits} ok=${ok}` +
        (ok ? '' : ' first=' + JSON.stringify(r.first) + ' MISSED=[' + r.missed.join('; ') + '] (C-34: STOP, an addendum changes weights, never floors or seeds)'));
    }
  }
  const b8s1 = rows[0];
  lines.push(`A1 B=8 s=1 fingerHits ${b8s1.fingerHits} (leaf model 2069, golden stream 2062; floor ${FLOORS.fingerHits})`);
  // controls (PLAN-E0-F ASSERTION 5)
  for (const mode of ['mf2', 'mf4']) {
    const r = a1Stream({ B: 8, seed: 1, mode, stopAtFirst: true });
    const ok = r.divergences >= 1;
    if (!ok) failures++;
    lines.push(`A1 control ${mode.toUpperCase()} (C-35 wrapper) B=8 s=1 divergences=${r.divergences} at op ${r.ops} ` +
      `first=${JSON.stringify(r.first)} ok=${ok}`);
  }
  {
    const r = a1Stream({ B: 8, seed: 1, mode: 'off' });
    const ok = r.missed.some((m) => m.startsWith('fingerHits')) && r.fingerHits === 0;
    if (!ok) failures++;
    lines.push(`A1 control all-off B=8 s=1 fingerHits=${r.fingerHits} divergences=${r.divergences} ` +
      `missed=[${r.missed.join('; ')}] ok=${ok} (must miss the fingerHits floor)`);
  }
  lines.push(`A1 wall ${Date.now() - t0} ms (REPORTED only)`);
  return { failures, lines };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const r = await runA1();
  for (const l of r.lines) console.log(l);
  console.log(r.failures === 0 ? 'a1-lane OK' : `a1-lane FAILED (${r.failures})`);
  process.exitCode = r.failures === 0 ? 0 : 1;
}
