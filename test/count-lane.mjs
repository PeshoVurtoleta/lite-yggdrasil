// test/count-lane.mjs -- the per-op count lane, shared by StubCounts.test.mjs
// (mode 'stub') and EngineCounts.test.mjs (mode 'engine'). ADR 0005 C-46 M-7.
//
//   runLane(S, opts) -> {checks, fails: [{cls, msg, o}], seen, seenB}
//     S     has COUNTERS (name -> idx). In 'stub' mode S also has synthStub.
//     opts  ops(B) -> op count, seeds, early (stop at the first fail), hint
//           (optional first cell [B, count, seed]); mode 'stub' (default) or
//           'engine'; factory(C, {leafSize, dims}, count, cfg) -> {views,
//           snapshot()} (default S.synthStub); dims (default 2, 1..4 not
//           needed beyond 1..2); tally (stub mode: also record the engine
//           tallies, for sizing only).
//
// 'stub' mode is the HB4b lane unchanged (its report is byte-identical to the
// golden cut before the move). 'engine' mode runs the SAME op stream and the
// same spec-derived expectations (hits/misses/splits/merges/equalizes/seams/
// moves, re-home, NIL, neutral seeks, reset, walker, oracle) with these
// differences: no finger hit exists yet (C-26: every positional op is a miss);
// the zero-counter check is replaced by per-op engine checks, every expected
// value computed from the PRE/POST snapshots (leaf depths recounted from the
// child arrays, 0003 G-10) and spec-counts formulas, never from the engine:
//   touches  === touchesExact(C-25 row)  (insert split: d(t)+d'(t'); remove
//            underflow: d(v)+d'(t'); miss/seek: d(t); append: d_a+d_b; splitAt:
//            d(c) exact with 0 repairs, else <= d(c)+(rL+rR)*HB(Lmax); clear 0)
//   pulls    === depth on non-structural insertAt / removeAt / setMeasure, 0 on
//            reads, [1, 4(H+1)] on a split insert, [0, 4(H+1)] on a merge
//            (C-20: a merge may pull 0), === |anc(u) U anc(v)| on an equalize
//   rotSingle / rotDouble delta 0 on every non-structural op
//   joinSteps delta 0 on every positional / seek / clear op
// append (S-R2) runs for real in engine mode, checked from the PRE / POST snapshots and the
// spec only: touches 0 when an operand is empty else d_a(last) + d_b(first) (C-25), seamRepairs
// === [both non-empty and min(seam leaf lens) < m] (C-21), splits 0, fingerHits / fingerMisses 0,
// joinSteps 0 when an operand is empty else <= HB(Lmax) (C-24), the operand's counters all delta 0
// (RS-1 / C-8), both fingers NIL / 0 / 0 (C-5), both _cv false (C-6), the walker clean on the whole
// arena and both views against the oracle.
// splitAt (S-R3) runs for real in engine mode too, with an empty operand view (without one the lane's own
// fallback is a plain clear() op, as in stub mode): touches === d(c) exact with 0 repairs (C-25; either side's
// leaf on a boundary cut), <= d(c) + (rL+rR)*HB(Lmax) with repairs; seamRepairs === rL + rR (C-21); moves ===
// cutMoves + the repair moves (C-18); splits 0 and fingerHits / fingerMisses 0 (C-26); out's counters all delta 0
// (RS-1); both fingers NIL (C-5); both _cv false (C-6).
// ASCII-only.

import { walk } from './walker.mjs';
import { Oracle } from './oracle.mjs';
import * as SC from './spec-counts.mjs';

// 32-bit xorshift; independent streams are derived from seed, B (op stream).
function rng(seed) {
  let x = seed >>> 0 || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x; };
}

// In-order leaves of view v in snapshot s: {id, len, fb (first index), side,
// depth (internal nodes above), anc (internal ids root-down)}.
// side = 0 when the leaf is a left child, 1 right, -1 for a root leaf.
function leavesOf(s, v) {
  const vw = s.views[v];
  const out = [];
  if (vw._len === 0) return out;
  const st = [[vw._root, -1, []]];
  while (st.length) {
    const [r, sd, an] = st.pop();
    if (r < 0) out.push({ id: ~r, len: s.leaf.len[~r], side: sd, depth: an.length, anc: an });
    else {
      const an2 = an.concat([r]);
      st.push([s.int.right[r], 1, an2]);
      st.push([s.int.left[r], 0, an2]);
    }
  }
  let fb = 0;
  for (const l of out) { l.fb = fb; fb += l.len; }
  return out;
}

const json = (x) => JSON.stringify(x, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v));

// Run the lane on a factory. Returns {checks, fails: [{cls, msg, o}], seen,
// seenB}. early: stop at the first fail.
export function runLane(S, opts) {
  const K = S.COUNTERS;
  const ctr = Object.keys(K);
  const res = { checks: 0, fails: [], seen: {}, seenB: {} };
  const E = opts.mode === 'engine';
  const mk = opts.factory || ((C, o, count, cfg) => S.synthStub(C, o, count, cfg));
  const D = opts.dims || 2;
  const T = E || opts.tally === true;
  let stop = false;
  const chk = (c, cls, msg, o) => {
    res.checks++;
    if (!c) {
      if (opts.early) { if (!stop) res.fails.push({ cls, msg, o }); stop = true; }
      else if (res.fails.length < 8) res.fails.push({ cls, msg, o });
    }
  };
  // cell order: an optional hint cell first (controls), then the full grid.
  const cells = [];
  if (opts.hint) cells.push(opts.hint);
  for (const B of [4, 8, 16]) for (const count of [2, 3]) for (const seed of opts.seeds) cells.push([B, count, seed]);
  for (const [B, count, seed] of cells) {
    if (stop) return res;
    runOne(mk, E, T, D, K, ctr, B, count, seed, opts.ops(B), chk, res, () => stop);
  }
  return res;
}

function runOne(mk, E, T, D, K, ctr, B, count, seed, ops, chk, res, stopped) {
  const m = B / 4;
  const C = B === 16 ? 120 : 40;
  const f = mk(C, { leafSize: B, dims: D }, count, {});
  const views = f.views;
  const or = [];
  for (let k = 0; k < count; k++) or.push(new Oracle(D));
  const NIL = views[0]._fl;
  const r = rng(seed * 7919 + B);
  const seenB = (k) => { const key = B + ':' + k; res.seenB[key] = (res.seenB[key] || 0) + 1; };
  const seenK = (k) => { res.seen[k] = (res.seen[k] || 0) + 1; };
  const Lm = SC.Lmax(C, m, count); // C-15: ceil(C/m) + k leaves
  const HB = SC.H(Lm);
  // dims-aware calls (an extra slot beyond dims must be undefined, C-10)
  const ins = (w, i, e, a0, a1) => (D === 1 ? w.insertAt(i, e, a0) : w.insertAt(i, e, a0, a1));

  for (let o = 0; o < ops && !stopped(); o++) {
    const tag = (op, what) => `${op} B=${B} count=${count} seed=${seed} op#${o} ${what}`;
    const pre = f.snapshot();
    const preJ = json(pre);
    // prologue: B+1 inserts at index 0 of view 0 overfill its first leaf (a split insert
    // at every B, deterministically); the draws are still consumed.
    const fill = o <= B;
    const vi = fill ? (r(), 0) : r() % count;
    const v = views[vi];
    const n = v._len;
    const live = pre.live;
    const grow = Math.floor(o / 300) % 2 === 0;
    const c = r() % 100;
    let op;
    if (c < (grow ? 45 : 15)) op = 'insertAt';
    else if (c < 62) op = 'removeAt';
    else if (c < 68) op = 'setMeasure';
    else if (c < 74) op = 'getMeasure';
    else if (c < 80) op = 'entityAt';
    else if (c < 84) op = 'indexAtSum';
    else if (c < 88) op = 'sumBefore';
    else if (c < 95) op = 'splitAt';
    else if (c < 99) op = 'append';
    else op = 'clear';
    if (fill) op = 'insertAt';
    if (op === 'insertAt' && live >= C) op = 'removeAt';
    if (n === 0 && op !== 'insertAt' && op !== 'append' && op !== 'clear' && op !== 'indexAtSum') {
      op = live < C ? 'insertAt' : 'clear';
    }
    // S-R3: splitAt, append and clear all run for real in engine mode (no substitution).
    // finger-off mix: one op in four runs with the finger dropped first (C-4).
    const off = (r() % 4) === 0;
    if (!E && off && (op === 'insertAt' || op === 'removeAt' || op === 'setMeasure' ||
        op === 'getMeasure' || op === 'entityAt')) {
      v._fl = NIL; v._fb = 0; v._fdepth = 0;
    }
    const L = leavesOf(pre, vi);
    const fl = v._fl;
    const fb0 = v._fb;
    const n0 = v._n.slice();
    const exp = { hits: 0, misses: 0, splits: 0, merges: 0, equalizes: 0, seamRepairs: 0, moves: 0 };
    // engine expectations: x.row (C-25 row or -1), x.a / x.b depths, x.post (index whose
    // post-op leaf depth is d'), x.pLo / x.pHi pulls bounds, x.rot0 / x.join0 delta-0 flags.
    const x = { row: -1, a: 0, b: 0, post: -1, pLo: 0, pHi: 0, rot0: true, join0: true, bound: -1, alt: -1 };
    // finger leaf position in the pre-op leaf list (-1 = no finger)
    const fj = fl === NIL ? -1 : L.findIndex((l) => ~l.id === fl);
    const findR = (i) => { for (let j = 0; j < L.length; j++) if (i <= L[j].fb + L[j].len) return j; return -1; };
    const findE = (i) => { for (let j = 0; j < L.length; j++) if (L[j].fb <= i && i < L[j].fb + L[j].len) return j; return -1; };
    // one seam repair of (sL, sR): merge when 2*(sL+sR) <= B else equalize (C-21).
    const rep = (sL, sR, uLeft) => {
      if (2 * (sL + sR) <= B) exp.merges++; else exp.equalizes++;
      return SC.repMoves(B, sL, sR, uLeft);
    };
    let expLeaf; // leaf id | 'post:<index>' | 'nil' | 'same'
    let oi = -1;

    if (op === 'insertAt') {
      const i0 = r() % (n + 1);
      const i = fill ? 0 : i0;
      if (n === 0) { exp.misses = 1; expLeaf = 'post:' + i; x.row = SC.TOUCH_MISS; } // first entity: a miss (C-26)
      else {
        const j = findR(i);
        const s = L[j].len;
        const p = i - L[j].fb;
        const lo = fb0 - ((fb0 - 1) >>> 31); // finger window is (lo, fb + len] (C-4)
        const inR = fj >= 0 && lo < i && i <= fb0 + L[fj].len;
        x.a = L[j].depth;
        if (s === B) {
          exp.splits = 1; exp.misses = 1; expLeaf = 'post:' + i; // full leaf: split, miss
          x.row = SC.TOUCH_INSERT_SPLIT; x.post = i; x.pLo = 1; x.pHi = 4 * (HB + 1); x.rot0 = false;
        } else {
          if (inR) exp.hits = 1; else exp.misses = 1;
          expLeaf = L[j].id;
          x.row = SC.TOUCH_MISS; x.pLo = x.pHi = SC.pullsHot(L[j].depth);
        }
        if (inR && s < B) chk(fj === j, 'hit-leaf', tag(op, 'finger hit leaf != routing leaf'), o);
        exp.moves = SC.insertMoves(B, m, s, p, j === L.length - 1 ? 1 : 0);
      }
      const e0 = r() % 1000, a0 = r() % 7, a1 = r() % 5;
      ins(v, i, e0, a0, a1); ins(or[vi], i, e0, a0, a1);
    } else if (op === 'removeAt') {
      const i = r() % n;
      const j = findE(i);
      const s = L[j].len;
      const p = i - L[j].fb;
      const only = L.length === 1 ? 1 : 0;
      const inR = fj >= 0 && fb0 <= i && i < fb0 + L[fj].len;
      let rp = 0;
      let struct = false;
      x.a = L[j].depth;
      if (only && s === 1) { // last entity: NIL (C-5)
        struct = true; expLeaf = 'nil'; seenB('removeLast');
        x.row = SC.TOUCH_MISS; // drain: d(t) = 0
      } else if (!only && s === m) { // structural underflow: repair with the sibling-side leaf (T-6)
        struct = true;
        const uL = L[j].side === 0;
        const jv = uL ? j + 1 : j - 1;
        const vv = L[jv].len;
        rp = uL ? rep(s - 1, vv, 1) : rep(vv, s - 1, 0);
        // C-3 / A4-10 a: re-home descends by `i < count[left]` goes left
        expLeaf = 'post:' + Math.min(i, n - 2);
        seenB('structRemove');
        // C-25: d(v) is the PRE-op depth of the neighbour leaf v (main descent d(u) plus the
        // neighbour walk from sibling(u) to v), not u's depth
        x.a = L[jv].depth;
        x.row = SC.TOUCH_REMOVE_UNDERFLOW; x.post = Math.min(i, n - 2); x.rot0 = false;
        if (exp.merges) { x.pLo = 0; x.pHi = 4 * (HB + 1); } // C-20: a merge may pull 0
        else { // equalize: pulls == |anc(u) U anc(v)|
          const un = new Set(L[j].anc);
          for (const a of L[jv].anc) un.add(a);
          x.pLo = x.pHi = un.size;
        }
      } else {
        expLeaf = L[j].id;
        x.row = SC.TOUCH_MISS; x.pLo = x.pHi = SC.pullsHot(L[j].depth);
      }
      if (inR && !struct) exp.hits = 1; else exp.misses = 1;
      exp.moves = SC.removeMoves(m, s, p, only, rp);
      v.removeAt(i); or[vi].removeAt(i);
    } else if (op === 'setMeasure' || op === 'getMeasure' || op === 'entityAt') {
      const i = r() % n;
      const j = findE(i);
      const inR = fj >= 0 && fb0 <= i && i < fb0 + L[fj].len;
      if (inR) exp.hits = 1; else exp.misses = 1;
      expLeaf = L[j].id;
      x.row = SC.TOUCH_MISS; x.a = L[j].depth;
      if (op === 'setMeasure') x.pLo = x.pHi = SC.pullsHot(L[j].depth);
      if (inR) chk(fj === j, 'hit-leaf', tag(op, 'finger hit leaf mismatch'), o);
      if (op === 'setMeasure') { const mm = r() % 9; v.setMeasure(i, D - 1, mm); or[vi].setMeasure(i, D - 1, mm); }
      else if (op === 'getMeasure') chk(v.getMeasure(i, D - 1) === or[vi].getMeasure(i, D - 1), 'value', tag(op, 'getMeasure vs oracle'), o);
      else chk(v.entityAt(i) === or[vi].entityAt(i), 'value', tag(op, 'entityAt vs oracle'), o);
    } else if (op === 'indexAtSum') { // C-2: neutral seek
      const y = r() % (or[vi].total(0) + 2);
      chk(v.indexAtSum(0, y) === or[vi].indexAtSum(0, y), 'value', tag(op, 'indexAtSum vs oracle'), o);
      expLeaf = 'same';
      // seek: d(t), t = last leaf when y >= total (answer index == length); empty view: 0
      x.row = SC.TOUCH_SEEK;
      if (n > 0) { const ix = or[vi].indexAtSum(0, y); x.a = L[ix < n ? findE(ix) : L.length - 1].depth; }
    } else if (op === 'sumBefore') { // C-2: neutral seek
      const i = r() % (n + 1);
      chk(v.sumBefore(D - 1, i) === or[vi].sumBefore(D - 1, i), 'value', tag(op, 'sumBefore vs oracle'), o);
      expLeaf = 'same';
      x.row = SC.TOUCH_SEEK;
      if (n > 0) x.a = L[i < n ? findE(i) : L.length - 1].depth;
    } else if (op === 'splitAt') {
      for (let k = 1; k < count; k++) { const q = (vi + k) % count; if (views[q]._len === 0) { oi = q; break; } }
      if (oi < 0) { v.clear(); or[vi].clear(); expLeaf = 'nil'; op = 'clear'; x.row = SC.TOUCH_TOTAL_CLEAR; }
      else {
        const i = r() % (n + 1);
        x.row = SC.TOUCH_SPLITAT; x.join0 = false; x.rot0 = false;
        if (i > 0 && i < n) {
          const j = findE(i);
          const s = L[j].len;
          const p = i - L[j].fb;
          let lc, ls, rc, rs, lp = 0, rn = 0;
          if (p === 0) { lc = j; ls = L[j - 1].len; rc = L.length - j; rs = s; lp = L[j - 1].len; rn = L.length > j + 1 ? L[j + 1].len : 0; }
          else { lc = j + 1; ls = p; rc = L.length - j; rs = s - p; lp = j > 0 ? L[j - 1].len : 0; rn = L.length > j + 1 ? L[j + 1].len : 0; }
          const sr = SC.seamSplit(m, lc, ls, rc, rs); // C-21
          exp.seamRepairs = sr;
          exp.moves = SC.cutMoves(s, p);
          if (lc >= 2 && ls < m) { exp.moves += rep(lp, ls, 0); seenB('splitSeamL'); }
          if (rc >= 2 && rs < m) { exp.moves += rep(rs, rn, 1); seenB('splitSeamR'); }
          seenB('splitCut');
          if (p !== 0) seenB('splitMid');
          // C-25: d(c); on a boundary cut (p == 0) c is the leaf on either side of the cut
          x.a = L[j].depth; x.alt = p === 0 ? L[j - 1].depth : -1; x.b = sr;
          if (sr > 0) x.row = SC.TOUCH_SPLITAT_REPAIRS;
        }
        const onPre = E ? views[oi]._n.slice() : null;
        v.splitAt(i, views[oi]); or[vi].splitAt(i, or[oi]);
        expLeaf = 'nil';
        if (E) { // out's counters: delta 0 on every counter (RS-1); both cursors invalid (C-6)
          for (const nm of ctr) chk(views[oi]._n[K[nm]] === onPre[K[nm]], 'operand-counter', tag(op, `out ${nm} moved`), o);
          chk(v._cv === false && views[oi]._cv === false, 'cv', tag(op, 'splitAt left a cursor valid'), o);
        }
      }
    } else if (op === 'append') {
      oi = (vi + 1 + (r() % (count - 1))) % count;
      const Lo = leavesOf(pre, oi);
      x.row = SC.TOUCH_APPEND; x.join0 = false; x.rot0 = false;
      x.a = -1; x.b = -1;
      const onPre = E ? views[oi]._n.slice() : null;
      if (n > 0 && Lo.length > 0) {
        const a = L[L.length - 1].len;
        const b = Lo[0].len;
        exp.seamRepairs = SC.seamAppend(m, a, b); // C-21
        if (exp.seamRepairs) { exp.moves = b < m ? rep(a, b, 0) : rep(a, b, 1); seenB('appendSeam'); }
        x.a = L[L.length - 1].depth; x.b = Lo[0].depth;
        x.joinMax = HB;
        if (E) seenB('appendBoth');
      } else x.joinMax = 0; // an empty operand: the identity, no join
      v.append(views[oi]); or[vi].append(or[oi]);
      expLeaf = 'nil';
      if (E) { // operand counters: delta 0 on every counter; both cursors invalid (C-6)
        for (const nm of ctr) chk(views[oi]._n[K[nm]] === onPre[K[nm]], 'operand-counter', tag(op, `operand ${nm} moved`), o);
        chk(v._cv === false && views[oi]._cv === false, 'cv', tag(op, 'append left a cursor valid'), o);
      }
    } else { v.clear(); or[vi].clear(); expLeaf = 'nil'; x.row = SC.TOUCH_TOTAL_CLEAR; }

    seenK(op); seenB(op);
    // engine report only: clear of a non-empty view, split by path (S-R1). clearFree = another
    // view holds elements (free-walk); clearReset = _len === live (O(1) reset).
    if (E && op === 'clear' && n > 0) seenB(live === n ? 'clearReset' : 'clearFree');
    if (op === 'insertAt' && exp.splits) seenB('splitInsert');
    if (T && op === 'removeAt') {
      if (exp.merges) seenB('removeMerge');
      if (exp.equalizes) seenB('removeEqualize');
    }
    // engine: no finger hit exists yet (C-26), every positional op is a miss
    if (E) { exp.misses += exp.hits; exp.hits = 0; }
    const post = f.snapshot();

    // snapshot is a deep copy: the op did not change the pre snapshot (e.g. _fpath)
    chk(json(pre) === preJ, 'alias', tag(op, 'pre snapshot changed after op (aliased)'), o);
    const d = {};
    for (const nm of ctr) d[nm] = v._n[K[nm]] - n0[K[nm]];
    chk(d.fingerHits === exp.hits, 'hit', tag(op, `fingerHits ${d.fingerHits} exp ${exp.hits}`), o);
    chk(d.fingerMisses === exp.misses, 'miss', tag(op, `fingerMisses ${d.fingerMisses} exp ${exp.misses}`), o);
    for (const [cls, nm] of [['splits', 'splits'], ['merges', 'merges'], ['equalizes', 'equalizes'],
      ['seams', 'seamRepairs'], ['moves', 'moves']]) {
      chk(d[nm] === exp[nm], cls, tag(op, `${nm} ${d[nm]} exp ${exp[nm]}`), o);
    }
    if (!E) {
      for (const nm of ['touches', 'pulls', 'rotSingle', 'rotDouble', 'joinSteps']) {
        chk(d[nm] === 0, 'zero-counter', tag(op, `${nm} moved by ${d[nm]}`), o);
      }
    } else {
      // C-25 touches: exact from walker-recounted depths (post depth d' from the post snapshot)
      if (x.row === SC.TOUCH_INSERT_SPLIT || x.row === SC.TOUCH_REMOVE_UNDERFLOW) {
        const PL = leavesOf(post, vi);
        const jj = PL.findIndex((l) => l.fb <= x.post && x.post < l.fb + l.len);
        x.b = jj >= 0 ? PL[jj].depth : -1;
      }
      let tOk;
      if (x.row === SC.TOUCH_SPLITAT_REPAIRS) { // the one UPPER BOUND row
        const hi = Math.max(x.a, x.alt);
        tOk = d.touches >= Math.min(x.a, x.alt < 0 ? x.a : x.alt) && d.touches <= SC.touchesExact(x.row, hi, x.b, Lm);
      } else if (x.row === SC.TOUCH_SPLITAT) {
        tOk = d.touches === x.a || (x.alt >= 0 && d.touches === x.alt);
      } else if (x.b < 0 && (x.row === SC.TOUCH_INSERT_SPLIT || x.row === SC.TOUCH_REMOVE_UNDERFLOW)) {
        tOk = false; // no post leaf at the re-home index
      } else {
        tOk = d.touches === SC.touchesExact(x.row, x.a, x.b, 0);
      }
      chk(tOk, 'touches', tag(op, `touches ${d.touches} exp row ${x.row} a ${x.a} b ${x.b}`), o);
      if (op === 'insertAt' || op === 'removeAt' || op === 'setMeasure' || op === 'getMeasure' ||
          op === 'entityAt' || op === 'indexAtSum' || op === 'sumBefore' || op === 'clear') {
        chk(d.pulls >= x.pLo && d.pulls <= x.pHi, 'pulls', tag(op, `pulls ${d.pulls} exp [${x.pLo}, ${x.pHi}]`), o);
      }
      if (x.rot0) {
        chk(d.rotSingle === 0 && d.rotDouble === 0, 'rot', tag(op, `rot ${d.rotSingle}/${d.rotDouble} on a non-structural op`), o);
      }
      if (x.join0) chk(d.joinSteps === 0, 'join', tag(op, `joinSteps moved by ${d.joinSteps}`), o);
      if (op === 'append') chk(d.joinSteps >= 0 && d.joinSteps <= x.joinMax, 'join', tag(op, `joinSteps ${d.joinSteps} exp [0, ${x.joinMax}]`), o);
    }
    if (off) chk(d.fingerHits === 0, 'hit', tag(op, 'finger-off op counted a hit'), o);

    // C-3 / C-5 / C-2: where the finger went
    if (expLeaf === 'same') {
      chk(v._fl === fl && v._fb === fb0, 'neutral', tag(op, 'neutral seek moved the finger'), o);
    } else if (typeof expLeaf === 'string' && expLeaf.startsWith('post:')) {
      const ii = +expLeaf.slice(5);
      const PL = leavesOf(post, vi);
      const jj = PL.findIndex((l) => l.fb <= ii && ii < l.fb + l.len);
      chk(jj >= 0 && v._fl === ~PL[jj].id, 're-home', tag(op, `structural re-home leaf ${v._fl} exp ${jj >= 0 ? ~PL[jj].id : '?'}`), o);
    } else if (expLeaf === 'nil') {
      chk(v._fl === NIL && v._fb === 0 && v._fdepth === 0, 'nil', tag(op, 'finger not NIL'), o);
      if (oi >= 0) chk(views[oi]._fl === NIL && views[oi]._fb === 0 && views[oi]._fdepth === 0, 'nil', tag(op, 'operand finger not NIL'), o);
    } else {
      chk(v._fl === ~expLeaf, 're-home', tag(op, `re-home leaf ${v._fl} exp ${~expLeaf}`), o);
    }
    if (post.live === 0) {
      seenB('reset');
      chk(post.int.bump === 0 && post.leaf.bump === 0 && post.int.free === -1 && post.leaf.free === -1,
        'reset', tag(op, 'pool not reset at live 0'), o);
    }
    const w = walk(post, { B, dims: D });
    chk(w === null, 'walk', tag(op, 'walker: ' + json(w)), o);
    for (let q = 0; q < count; q++) {
      const dm = or[q].dump();
      const PL = leavesOf(post, q);
      const ee = [], mm = [];
      for (let k = 0; k < D; k++) mm.push([]);
      for (const l of PL) {
        for (let k = 0; k < l.len; k++) {
          ee.push(post.leaf.ent[l.id * B + k]);
          for (let dd = 0; dd < D; dd++) mm[dd].push(post.leaf.meas[dd][l.id * B + k]);
        }
      }
      chk(json([ee, mm]) === json([dm.entities, dm.measures]), 'oracle', tag(op, 'view ' + q + ' diverged from oracle'), o);
    }
  }
}
