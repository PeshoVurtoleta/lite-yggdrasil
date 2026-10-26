// test/stubs.mjs -- synthetic SumSequence stubs for the exhaustive lanes (test
// harness; not a hot path: clarity beats speed, allocation is fine).
//
// Binding rules: decisions/0005 C-1 / C-3 / C-4 / C-5 (finger state, re-home,
// hit rule, ownership), C-6 (_cv), C-8 (clear, EMPTY_ROOT), C-10 (check order,
// index rule), C-12 (signatures), C-15 (pools, T = 0), C-18 (moves), C-19 (no
// front gap), C-21 (seam repairs), C-24 (COUNTERS), C-26 (hit / miss
// partition), C-27 / C-28 (snapshot contract, finger fields), C-33 (stubs).
// Leaf policy: decisions/0001 T-5 (routing), T-6 (underflow), T-7 (seams), T-8
// and Table 3 (splits); 0005 C-18 / C-21 win where they differ. Counter
// indexes: decisions/0003 "Counters / gates". Plan: .handoff/PLAN-HB4.md TASKS
// 1-2 as amended by ADDENDUM R1 (R1-3 mutant behaviour, R1-5 API pin).
//
// API (R1-5)
//   synthStub, flatStub, seekStub, staleFingerStub, nolandStub, countStub,
//   homeStub: (C, {leafSize, dims}, count, cfg) -> {views, snapshot()}.
//     C        capacity: total elements over all views (integer 1..2^20; the
//              2^20 cap is a stub cap, not the engine's C-14 cap)
//     leafSize B in 4 / 8 / 16 / 32 (default 16); dims 1..4 (default 1)
//     count    views in the arena, integer 1..min(C, 4096)
//     cfg      undefined or {NIL, EMPTY_ROOT, protoField}: NIL (default 0) and
//              EMPTY_ROOT (default 0x7fffffff) as the harness reads them from a
//              fresh empty view (C-1, C-8, C-27); protoField = one of _fl, _fb,
//              _fdepth, _fpath, held by a prototype accessor instead of an own
//              field (the R1-3 C-27 hasOwn control). Unknown keys throw.
//   snapshot() -> a fresh copy in the walker.mjs header contract.
//   COUNTERS   frozen {name: idx} per 0003 (idx 0..11); counters live in
//              view._n (Int32Array(12)); clear() keeps them (C-8).
//   View ops (C-12, no cursor): insertAt(i, e, m0, m1, m2, m3), removeAt(i),
//   setMeasure(i, d, m), getMeasure(i, d), entityAt(i), indexAtSum(d, y),
//   sumBefore(d, i) (argument order of test/oracle.mjs), total(d),
//   splitAt(i, out), append(other), clear(), length. Own view fields, in
//   order: _root, _len, _fl, _fb, _fdepth, _fpath (Int32Array(H(Lmax))), _cv,
//   _n. A RangeError fires before the first write, with the oracle's token
//   (index, entity, dim, measure, extra, headroom, seek, operand) or
//   'capacity' (live + 1 > C, checked between extra and headroom, C-10).
//
// Model. Each view holds an ordered leaf list; leaves obey Table 3 (append side
// (B+1-m | m), prepend side (m | B+1-m), interior B/2 | B/2 with the new
// element in its own half), T-5 routing (left iff i <= count[left]), T-6
// underflow (s = m-1: neighbour v = the in-order leaf on u's sibling side in
// the CURRENT tree; s + k <= B/2 merges into v and frees u, else equalize
// floor | ceil), C-21 seams. After every structural op the view's internal
// tree is rebuilt canonically (left subtree = floor(L/2) leaves), so it
// satisfies I-1 and H(L) and NEVER rotates: touches, pulls, rotSingle,
// rotDouble and joinSteps stay 0. Pools: internal Lmax-1, leaf Lmax with
// Lmax = Lmax(C, m, count) (C-15), linked free lists, -1 = END, leaf refs ~id;
// both pools reset to bump 0 when the header live reaches 0. Leaf slot data is
// held per leaf (overlap-free at any length, so flatStub's oversized leaves
// alias nothing); snapshot() writes min(len, B) slots per leaf.
// moves = existing elements whose (leaf, slot) changed, counted per phase (the
// remove, then the repair), which is C-18 term by term.
//
// Finger (C-1..C-5, C-26). Positional ops (insertAt, removeAt, setMeasure,
// getMeasure, entityAt) add exactly one fingerHit or fingerMiss. Hit iff fl !==
// NIL, the index is in range (insert: lo < i <= fb+len with lo = fb -
// ((fb-1)>>>31); others: fb <= i < fb+len) and no split / merge / equalize /
// free is needed; the split-triggering insert is a miss. A hit leaves the
// finger as is (it is the touched leaf); a non-structural miss re-homes to the
// touched leaf; a structural miss re-homes by a cold descent (element rule, i <
// count[left] goes left) to i, removeAt to min(i, length-1); an emptied view,
// splitAt (both views), append (both views) and clear write NIL / 0 / 0 into
// _fl / _fb / _fdepth. indexAtSum, sumBefore and total never read or write it.
// seamRepairs counts C-21 repairs; each repair also counts one merge or one
// equalize. A splitAt mid-leaf cut is not a split.
//
// Mutants (C-33, R1-3), each exactly ONE deviation from synthStub:
//   flatStub        never splits (a full leaf takes element B+1 in place).
//   seekStub        indexAtSum's internal-node comparator is `>=`, not `>`.
//   staleFingerStub a miss re-home writes _fl / _fdepth / _fpath, keeps _fb.
//   nolandStub      getMeasure skips its miss re-home.
//   countStub       indexAtSum adds 1 to fingerMisses.
//   homeStub        indexAtSum re-homes the finger to its answer's leaf.
//
// ITERATIVE: no function in this file calls itself (0001 DB-8 M-3 (b)). The
// only import is H and Lmax from ./spec-counts.mjs. ASCII only.
//
// MIT (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>

import { H, Lmax } from './spec-counts.mjs';

export const COUNTERS = Object.freeze({
  touches: 0, pulls: 1, moves: 2, splits: 3, merges: 4, equalizes: 5,
  rotSingle: 6, rotDouble: 7, fingerHits: 8, fingerMisses: 9, joinSteps: 10,
  seamRepairs: 11,
});

const ST_MAX = 9007199254740991; // 2^53 - 1 (M-1)
const ST_END = -1;               // free-list END
const ST_C_CAP = 1048576;        // 2^20: the stub's own allocation cap
const ST_N_MOVES = 2;
const ST_N_SPLITS = 3;
const ST_N_MERGES = 4;
const ST_N_EQUALIZES = 5;
const ST_N_HITS = 8;
const ST_N_MISSES = 9;
const ST_N_SEAMS = 11;
const ST_OPT_KEYS = Object.freeze(['leafSize', 'dims']);
const ST_CFG_KEYS = Object.freeze(['NIL', 'EMPTY_ROOT', 'protoField']);
const ST_PROTO_FIELDS = Object.freeze(['_fl', '_fb', '_fdepth', '_fpath']);

// ---- cold helpers -----------------------------------------------------------

function stFail(token, detail) {
  throw new RangeError(token + ' ' + detail);
}

function stBug(detail) {
  throw new Error('stubs: ' + detail);
}

function stIsInt(x) {
  return typeof x === 'number' && Number.isInteger(x);
}

function stPlain(o) {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return false;
  const p = Object.getPrototypeOf(o);
  return p === Object.prototype || p === null;
}

function stKeys(o, legal, what) {
  if (Object.getOwnPropertySymbols(o).length !== 0) stFail(what, 'symbol key');
  const keys = Object.keys(o);
  for (let k = 0; k < keys.length; k++) {
    if (!legal.includes(keys[k])) stFail(what, 'unknown key ' + keys[k] + ' (legal: ' + legal.join(', ') + ')');
    const d = Object.getOwnPropertyDescriptor(o, keys[k]);
    if (!('value' in d)) stFail(what, 'accessor key ' + keys[k]);
  }
}

// ---- validation (read-only; the oracle's checks and order) -------------------

function stIndex(i, n, closed) {
  if (!stIsInt(i)) stFail('index', 'must be an integer');
  if (i < 0 || (closed ? i > n : i >= n)) stFail('index', 'out of range');
  return i + 0;
}

function stDim(a, d) {
  if (!stIsInt(d) || d < 0 || d >= a.dims) stFail('dim', 'must be an integer in [0, dims)');
  return d + 0;
}

function stMeasure(m) {
  if (typeof m !== 'number') stFail('measure', 'must be a number');
  if (!(m >= 0 && m <= ST_MAX)) stFail('measure', 'must be in [0, 2^53-1]');
  if (!Number.isInteger(m)) stFail('measure', 'must be an integer');
}

function stSeek(y) {
  if (!(typeof y === 'number' && y >= 0 && y !== Infinity)) {
    stFail('seek', 'must be a number in [0, Infinity)');
  }
}

// ---- pools ------------------------------------------------------------------

function stAlloc(p, what) {
  const id = p.free;
  if (id !== ST_END) {
    p.free = p.next[id];
    p.next[id] = ST_END;
    return id;
  }
  if (p.bump >= p.size) stBug(what + ' pool exhausted (a stub bug or a C-15 slack violation)');
  const fresh = p.bump;
  p.bump = fresh + 1;
  return fresh;
}

function stFree(p, id) {
  p.next[id] = p.free;
  p.free = id;
}

function stNewLeaf(a) {
  const id = stAlloc(a.leaf, 'leaf');
  a.leaf.len[id] = 0;
  a.le[id] = [];
  for (let d = 0; d < a.dims; d++) {
    a.lm[d][id] = [];
    a.ls[d][id] = 0;
  }
  return id;
}

function stFreeLeaf(a, id) {
  a.leaf.len[id] = 0;
  a.le[id] = [];
  for (let d = 0; d < a.dims; d++) {
    a.lm[d][id] = [];
    a.ls[d][id] = 0;
  }
  a.lp[id] = -1;
  stFree(a.leaf, id);
}

function stFreeInts(a, ints) {
  for (let k = 0; k < ints.length; k++) stFree(a.int, ints[k]);
}

// live === 0: no view holds a node, so both pools restart at bump 0 (C-8).
function stReset(a) {
  a.int.bump = 0;
  a.int.free = ST_END;
  a.int.next.fill(ST_END);
  a.leaf.bump = 0;
  a.leaf.free = ST_END;
  a.leaf.next.fill(ST_END);
  a.leaf.len.fill(0);
}

// ---- summaries ----------------------------------------------------------------

function stLeafSum(a, id) {
  for (let d = 0; d < a.dims; d++) {
    const col = a.lm[d][id];
    let s = 0;
    for (let j = 0; j < col.length; j++) s += col[j];
    a.ls[d][id] = s;
  }
}

function stCount(a, ref) {
  return ref >= 0 ? a.int.count[ref] : a.leaf.len[~ref];
}

function stW(a, ref) {
  return ref >= 0 ? a.int.weight[ref] : 1;
}

function stS(a, ref, d) {
  return ref >= 0 ? a.int.sum[d][ref] : a.ls[d][~ref];
}

function stPull(a, id) {
  const l = a.int.left[id];
  const r = a.int.right[id];
  a.int.weight[id] = stW(a, l) + stW(a, r);
  a.int.count[id] = stCount(a, l) + stCount(a, r);
  for (let d = 0; d < a.dims; d++) a.int.sum[d][id] = stS(a, l, d) + stS(a, r, d);
}

// A non-structural change in leaf id: recount it, then pull every ancestor.
function stUp(a, id) {
  stLeafSum(a, id);
  let p = a.lp[id];
  while (p !== -1) {
    stPull(a, p);
    p = a.ip[p];
  }
}

function stTotal(a, view, d) {
  return view._len === 0 ? 0 : stS(a, view._root, d);
}

// Canonical tree over `leaves` (left subtree = floor(L/2) leaves), internal ids
// allocated in pre-order into `ints` (emptied first). The caller has freed the
// view's old internal ids. Returns the root ref (EMPTY_ROOT when L = 0).
function stBuild(a, leaves, ints) {
  ints.length = 0;
  const L = leaves.length;
  if (L === 0) return a.ER;
  let root = 0;
  const work = [[0, L, -1, 0]]; // lo, hi, parent, side (0 left, 1 right)
  while (work.length > 0) {
    const it = work.pop();
    const lo = it[0];
    const hi = it[1];
    const par = it[2];
    let ref;
    if (hi - lo === 1) {
      ref = ~leaves[lo];
      a.lp[leaves[lo]] = par;
    } else {
      const id = stAlloc(a.int, 'internal');
      ints.push(id);
      a.ip[id] = par;
      const mid = lo + Math.floor((hi - lo) / 2);
      work.push([mid, hi, id, 1]);
      work.push([lo, mid, id, 0]);
      ref = id;
    }
    if (par === -1) root = ref;
    else if (it[3] === 0) a.int.left[par] = ref;
    else a.int.right[par] = ref;
  }
  for (let k = ints.length - 1; k >= 0; k--) stPull(a, ints[k]); // children first
  return root;
}

function stRebuild(a, view, vs) {
  stFreeInts(a, vs.ints);
  view._root = stBuild(a, vs.leaves, vs.ints);
}

// ---- element relayout (moves = existing elements whose leaf / slot changed) ----

function stGather(a, ids) {
  const g = { e: [], m: [], sl: [], ss: [] };
  for (let d = 0; d < a.dims; d++) g.m.push([]);
  for (let k = 0; k < ids.length; k++) {
    const id = ids[k];
    const n = a.leaf.len[id];
    for (let j = 0; j < n; j++) {
      g.e.push(a.le[id][j]);
      for (let d = 0; d < a.dims; d++) g.m[d].push(a.lm[d][id][j]);
      g.sl.push(id);
      g.ss.push(j);
    }
  }
  return g;
}

// Insert a NEW element (no source slot) at gather position c.
function stGatherInsert(a, g, c, ent, slots) {
  g.e.splice(c, 0, ent);
  for (let d = 0; d < a.dims; d++) g.m[d].splice(c, 0, slots[d] + 0);
  g.sl.splice(c, 0, -1);
  g.ss.splice(c, 0, -1);
}

function stGatherRemove(a, g, c) {
  g.e.splice(c, 1);
  for (let d = 0; d < a.dims; d++) g.m[d].splice(c, 1);
  g.sl.splice(c, 1);
  g.ss.splice(c, 1);
}

function stScatter(a, g, ids, sizes) {
  let c = 0;
  let moves = 0;
  for (let k = 0; k < ids.length; k++) {
    const id = ids[k];
    const n = sizes[k];
    const e = [];
    const ms = [];
    for (let d = 0; d < a.dims; d++) ms.push([]);
    for (let j = 0; j < n; j++) {
      e.push(g.e[c]);
      for (let d = 0; d < a.dims; d++) ms[d].push(g.m[d][c]);
      if (g.sl[c] >= 0 && (g.sl[c] !== id || g.ss[c] !== j)) moves++;
      c++;
    }
    a.le[id] = e;
    for (let d = 0; d < a.dims; d++) a.lm[d][id] = ms[d];
    a.leaf.len[id] = n;
    stLeafSum(a, id);
  }
  if (c !== g.e.length) stBug('scatter size mismatch');
  return moves;
}

function stInsertInLeaf(a, id, p, ent, slots) {
  const g = stGather(a, [id]);
  stGatherInsert(a, g, p, ent, slots);
  return stScatter(a, g, [id], [g.e.length]);
}

function stRemoveInLeaf(a, id, p) {
  const g = stGather(a, [id]);
  stGatherRemove(a, g, p);
  return stScatter(a, g, [id], [g.e.length]);
}

// T-6 / T-7 repair of u = list[ju] with its neighbour v = list[jv] (adjacent).
// Merge (s + k <= B/2) frees u and splices it out of `list`; else equalize.
function stRepair(a, n, list, ju, jv, seam) {
  const u = list[ju];
  const v = list[jv];
  const uLeft = ju < jv;
  const t = a.leaf.len[u] + a.leaf.len[v];
  const lid = uLeft ? u : v;
  const rid = uLeft ? v : u;
  const g = stGather(a, [lid, rid]);
  if (seam) n[ST_N_SEAMS]++;
  if (2 * t <= a.B) {
    n[ST_N_MERGES]++;
    n[ST_N_MOVES] += stScatter(a, g, [v], [t]);
    stFreeLeaf(a, u);
    list.splice(ju, 1);
  } else {
    n[ST_N_EQUALIZES]++;
    const h = Math.floor(t / 2);
    n[ST_N_MOVES] += stScatter(a, g, [lid, rid], [h, t - h]);
  }
}

// ---- descent and finger --------------------------------------------------------

// rule 0 (element): i < count[left] goes left; rule 1 (insert, T-5): i <=
// count[left] goes left. Writes the arena scratch dLeaf / dFb / dDepth / dSide
// / dPath. The view must be non-empty.
function stDescend(a, root, i, rule) {
  let ref = root;
  let base = 0;
  let depth = 0;
  let side = -1;
  while (ref >= 0) {
    a.dPath[depth] = ref;
    depth++;
    const l = a.int.left[ref];
    const cl = stCount(a, l);
    const left = rule === 1 ? i - base <= cl : i - base < cl;
    if (left) {
      ref = l;
      side = 0;
    } else {
      base += cl;
      ref = a.int.right[ref];
      side = 1;
    }
  }
  a.dLeaf = ~ref;
  a.dFb = base;
  a.dDepth = depth;
  a.dSide = side;
}

// Miss re-home from the scratch descent (staleFingerStub keeps the pre-op _fb).
function stHome(a, view) {
  view._fl = ~a.dLeaf;
  if (a.mut !== 'stale') view._fb = a.dFb;
  view._fdepth = a.dDepth;
  const fp = view._fpath;
  for (let k = 0; k < a.dDepth; k++) fp[k] = a.dPath[k];
}

function stNil(a, view) {
  view._fl = a.NIL;
  view._fb = 0;
  view._fdepth = 0;
}

// ---- views ---------------------------------------------------------------------

const ST_PROTO_STORE = new WeakMap();

class StubView {
  #s;

  constructor(a) {
    this.#s = { a: a, leaves: [], ints: [] };
    this._root = a.ER;
    this._len = 0;
    this._fl = a.NIL;
    this._fb = 0;
    this._fdepth = 0;
    this._fpath = new Int32Array(a.HL);
    this._cv = false;
    this._n = new Int32Array(12);
  }

  get length() {
    return this._len;
  }

  #operand(o, needEmpty) {
    if (o === null || typeof o !== 'object' || !(#s in o)) stFail('operand', 'must be a view');
    if (o === this) stFail('operand', 'must not be this');
    if (o.#s.a !== this.#s.a) stFail('operand', 'from another arena');
    if (needEmpty && o._len !== 0) stFail('operand', 'out must be empty');
  }

  // ---- mutation -----------------------------------------------------------------

  insertAt(i, e, m0, m1, m2, m3) {
    const s = this.#s;
    const a = s.a;
    const n = this._len;
    const at = stIndex(i, n, true);
    if (!(typeof e === 'number' && (e & 0x3FFFFFFF) === e)) {
      stFail('entity', 'must be an integer in [0, 2^30-1]');
    }
    const slots = [m0, m1, m2, m3];
    for (let d = 0; d < a.dims; d++) stMeasure(slots[d]);
    for (let d = a.dims; d < 4; d++) {
      if (slots[d] !== undefined) stFail('extra', 'slot beyond dims must be undefined');
    }
    if (a.live + 1 > a.C) stFail('capacity', 'live + 1 > C');
    for (let d = 0; d < a.dims; d++) {
      if (slots[d] > ST_MAX - stTotal(a, this, d)) stFail('headroom', 'total would exceed 2^53-1');
    }
    // first write
    this._cv = false;
    const ent = e + 0;
    const cn = this._n;
    a.live++;
    this._len = n + 1;
    if (n === 0) { // first-leaf creation: a miss (fl is NIL on an empty view)
      cn[ST_N_MISSES]++;
      const id = stNewLeaf(a);
      stInsertInLeaf(a, id, 0, ent, slots);
      s.leaves.push(id);
      stRebuild(a, this, s);
      stDescend(a, this._root, 0, 0);
      stHome(a, this);
      return undefined;
    }
    const B = a.B;
    const flat = a.mut === 'flat';
    const fl = this._fl;
    if (fl !== a.NIL) {
      const fb = this._fb;
      const id = ~fl;
      const len = a.leaf.len[id];
      const lo = fb - ((fb - 1) >>> 31); // C-4
      if (lo < at && at <= fb + len && (flat || len < B)) {
        cn[ST_N_HITS]++;
        cn[ST_N_MOVES] += stInsertInLeaf(a, id, at - fb, ent, slots);
        stUp(a, id);
        return undefined;
      }
    }
    cn[ST_N_MISSES]++;
    stDescend(a, this._root, at, 1);
    const id = a.dLeaf;
    const p = at - a.dFb;
    const len = a.leaf.len[id];
    if (flat || len < B) {
      cn[ST_N_MOVES] += stInsertInLeaf(a, id, p, ent, slots);
      stUp(a, id);
      stHome(a, this);
      return undefined;
    }
    // Table 3 split: the left part stays in place, the fresh leaf is the right part.
    cn[ST_N_SPLITS]++;
    const j = s.leaves.indexOf(id);
    let leftSize;
    if (j === s.leaves.length - 1 && p === B) leftSize = B + 1 - a.m;
    else if (j === 0 && p === 0) leftSize = a.m;
    else leftSize = 2 * p <= B ? B / 2 + 1 : B / 2;
    const fresh = stNewLeaf(a);
    const g = stGather(a, [id]);
    stGatherInsert(a, g, p, ent, slots);
    cn[ST_N_MOVES] += stScatter(a, g, [id, fresh], [leftSize, B + 1 - leftSize]);
    s.leaves.splice(j + 1, 0, fresh);
    stRebuild(a, this, s);
    stDescend(a, this._root, at, 0);
    stHome(a, this);
    return undefined;
  }

  removeAt(i) {
    const s = this.#s;
    const a = s.a;
    const n = this._len;
    const at = stIndex(i, n, false);
    // first write
    this._cv = false;
    const cn = this._n;
    const L = s.leaves.length;
    const fl = this._fl;
    if (fl !== a.NIL) {
      const fb = this._fb;
      const id = ~fl;
      const len = a.leaf.len[id];
      if (fb <= at && at < fb + len && (L === 1 ? len > 1 : len > a.m)) {
        cn[ST_N_HITS]++;
        const e = a.le[id][at - fb];
        cn[ST_N_MOVES] += stRemoveInLeaf(a, id, at - fb);
        stUp(a, id);
        a.live--;
        this._len = n - 1;
        return e;
      }
    }
    cn[ST_N_MISSES]++;
    stDescend(a, this._root, at, 0);
    const id = a.dLeaf;
    const p = at - a.dFb;
    const len = a.leaf.len[id];
    const e = a.le[id][p];
    a.live--;
    this._len = n - 1;
    if (L === 1 && len === 1) { // the view drains: free the leaf, finger NIL
      stFreeLeaf(a, id);
      s.leaves.length = 0;
      stRebuild(a, this, s);
      stNil(a, this);
      if (a.live === 0) stReset(a);
      return e;
    }
    cn[ST_N_MOVES] += stRemoveInLeaf(a, id, p);
    if (L === 1 || len > a.m) { // non-structural: re-home to the touched leaf
      stUp(a, id);
      stHome(a, this);
      return e;
    }
    // T-6 underflow: v = the in-order leaf on u's sibling side.
    const ju = s.leaves.indexOf(id);
    const jv = a.dSide === 0 ? ju + 1 : ju - 1;
    stRepair(a, cn, s.leaves, ju, jv, false);
    stRebuild(a, this, s);
    stDescend(a, this._root, Math.min(at, this._len - 1), 0);
    stHome(a, this);
    return e;
  }

  setMeasure(i, d, m) {
    const s = this.#s;
    const a = s.a;
    const at = stIndex(i, this._len, false);
    const dd = stDim(a, d);
    stMeasure(m);
    stDescend(a, this._root, at, 0); // read-only locate (arena scratch only)
    const old = a.lm[dd][a.dLeaf][at - a.dFb];
    if (m > ST_MAX - (stTotal(a, this, dd) - old)) stFail('headroom', 'total would exceed 2^53-1');
    // first write
    this._cv = false;
    const fl = this._fl;
    let id;
    let fb;
    if (fl !== a.NIL && this._fb <= at && at < this._fb + a.leaf.len[~fl]) {
      this._n[ST_N_HITS]++;
      id = ~fl;
      fb = this._fb;
    } else {
      this._n[ST_N_MISSES]++;
      id = a.dLeaf;
      fb = a.dFb;
      stHome(a, this);
    }
    a.lm[dd][id][at - fb] = m + 0;
    stUp(a, id);
    return undefined;
  }

  clear() {
    const s = this.#s;
    const a = s.a;
    this._cv = false;
    for (let k = 0; k < s.leaves.length; k++) stFreeLeaf(a, s.leaves[k]);
    s.leaves.length = 0;
    stRebuild(a, this, s);
    a.live -= this._len;
    this._len = 0;
    stNil(a, this);
    if (a.live === 0) stReset(a);
    return undefined;
  }

  splitAt(i, out) {
    const s = this.#s;
    const a = s.a;
    const n = this._len;
    const at = stIndex(i, n, true);
    this.#operand(out, true);
    // first write
    this._cv = false;
    const os = out.#s;
    stNil(a, this);
    stNil(a, out);
    if (at === n) return this;
    if (at === 0) { // the whole tree moves to out
      os.leaves = s.leaves;
      os.ints = s.ints;
      out._root = this._root;
      out._len = n;
      s.leaves = [];
      s.ints = [];
      this._root = a.ER;
      this._len = 0;
      return this;
    }
    const cn = this._n;
    stDescend(a, this._root, at, 0);
    const id = a.dLeaf;
    const p = at - a.dFb;
    const j = s.leaves.indexOf(id);
    let left;
    let right;
    if (p === 0) { // a leaf-boundary cut moves nothing
      left = s.leaves.slice(0, j);
      right = s.leaves.slice(j);
    } else { // mid-leaf cut: the left part stays, [p, s) goes to a fresh leaf
      const fresh = stNewLeaf(a);
      const len = a.leaf.len[id];
      const g = stGather(a, [id]);
      cn[ST_N_MOVES] += stScatter(a, g, [id, fresh], [p, len - p]);
      left = s.leaves.slice(0, j + 1);
      right = [fresh].concat(s.leaves.slice(j + 1));
    }
    // C-21: rX = [result X has >= 2 leaves and its seam leaf < m]
    if (left.length >= 2 && a.leaf.len[left[left.length - 1]] < a.m) {
      stRepair(a, cn, left, left.length - 1, left.length - 2, true);
    }
    if (right.length >= 2 && a.leaf.len[right[0]] < a.m) {
      stRepair(a, cn, right, 0, 1, true);
    }
    stFreeInts(a, s.ints);
    s.ints = [];
    s.leaves = left;
    os.leaves = right;
    this._root = stBuild(a, left, s.ints);
    out._root = stBuild(a, right, os.ints);
    this._len = at;
    out._len = n - at;
    return this;
  }

  append(other) {
    const s = this.#s;
    const a = s.a;
    this.#operand(other, false);
    for (let d = 0; d < a.dims; d++) {
      if (stTotal(a, other, d) > ST_MAX - stTotal(a, this, d)) {
        stFail('headroom', 'total would exceed 2^53-1');
      }
    }
    // first write
    this._cv = false;
    other._cv = false;
    const os = other.#s;
    stNil(a, this);
    stNil(a, other);
    if (other._len === 0) return this;
    if (this._len === 0) { // this takes other's tree
      s.leaves = os.leaves;
      s.ints = os.ints;
      this._root = other._root;
      this._len = other._len;
      os.leaves = [];
      os.ints = [];
      other._root = a.ER;
      other._len = 0;
      return this;
    }
    const cn = this._n;
    const list = s.leaves.concat(os.leaves);
    const ja = s.leaves.length - 1;
    const jb = ja + 1;
    // C-21: repair u = the short seam leaf (the right one if both are short)
    if (a.leaf.len[list[jb]] < a.m) stRepair(a, cn, list, jb, ja, true);
    else if (a.leaf.len[list[ja]] < a.m) stRepair(a, cn, list, ja, jb, true);
    stFreeInts(a, s.ints);
    stFreeInts(a, os.ints);
    s.ints = [];
    os.ints = [];
    s.leaves = list;
    os.leaves = [];
    this._root = stBuild(a, list, s.ints);
    this._len += other._len;
    other._root = a.ER;
    other._len = 0;
    return this;
  }

  // ---- positional reads ---------------------------------------------------------

  getMeasure(i, d) {
    const a = this.#s.a;
    const at = stIndex(i, this._len, false);
    const dd = stDim(a, d);
    const fl = this._fl;
    if (fl !== a.NIL && this._fb <= at && at < this._fb + a.leaf.len[~fl]) {
      this._n[ST_N_HITS]++;
      return a.lm[dd][~fl][at - this._fb];
    }
    this._n[ST_N_MISSES]++;
    stDescend(a, this._root, at, 0);
    const v = a.lm[dd][a.dLeaf][at - a.dFb];
    if (a.mut !== 'noland') stHome(a, this);
    return v;
  }

  entityAt(i) {
    const a = this.#s.a;
    const at = stIndex(i, this._len, false);
    const fl = this._fl;
    if (fl !== a.NIL && this._fb <= at && at < this._fb + a.leaf.len[~fl]) {
      this._n[ST_N_HITS]++;
      return a.le[~fl][at - this._fb];
    }
    this._n[ST_N_MISSES]++;
    stDescend(a, this._root, at, 0);
    const v = a.le[a.dLeaf][at - a.dFb];
    stHome(a, this);
    return v;
  }

  // ---- seeks (finger-neutral, C-2) ---------------------------------------------

  // M-7: the smallest i with S_i + m_i > y (strict), else length.
  indexAtSum(d, y) {
    const a = this.#s.a;
    const dd = stDim(a, d);
    stSeek(y);
    if (a.mut === 'count') this._n[ST_N_MISSES]++;
    const n = this._len;
    if (!(y < stTotal(a, this, dd))) return n;
    let ref = this._root;
    let base = 0;
    let acc = 0;
    while (ref >= 0) {
      const l = a.int.left[ref];
      const sl = stS(a, l, dd);
      const left = a.mut === 'seek' ? acc + sl >= y : acc + sl > y;
      if (left) {
        ref = l;
      } else {
        acc += sl;
        base += stCount(a, l);
        ref = a.int.right[ref];
      }
    }
    const id = ~ref;
    const col = a.lm[dd][id];
    const len = a.leaf.len[id];
    let j = 0;
    while (j < len - 1 && !(acc + col[j] > y)) {
      acc += col[j];
      j++;
    }
    const ans = base + j;
    if (a.mut === 'home') {
      stDescend(a, this._root, ans, 0);
      stHome(a, this);
    }
    return ans;
  }

  sumBefore(d, i) {
    const a = this.#s.a;
    const n = this._len;
    const at = stIndex(i, n, true);
    const dd = stDim(a, d);
    if (at === n) return stTotal(a, this, dd);
    let ref = this._root;
    let acc = 0;
    let k = at;
    while (ref >= 0) {
      const l = a.int.left[ref];
      const cl = stCount(a, l);
      if (k < cl) {
        ref = l;
      } else {
        acc += stS(a, l, dd);
        k -= cl;
        ref = a.int.right[ref];
      }
    }
    const col = a.lm[dd][~ref];
    for (let j = 0; j < k; j++) acc += col[j];
    return acc;
  }

  total(d) {
    const a = this.#s.a;
    return stTotal(a, this, stDim(a, d));
  }
}

// ---- arena -----------------------------------------------------------------------

function stSnapshot(a) {
  const B = a.B;
  const dims = a.dims;
  const ls = a.leaf.size;
  const leaf = {
    size: ls, bump: a.leaf.bump, free: a.leaf.free,
    next: a.leaf.next.slice(), len: a.leaf.len.slice(),
    ent: new Int32Array(ls * B), meas: [],
  };
  for (let d = 0; d < dims; d++) leaf.meas.push(new Float64Array(ls * B));
  for (let id = 0; id < a.leaf.bump; id++) {
    const w = Math.min(a.leaf.len[id], B);
    for (let j = 0; j < w; j++) {
      leaf.ent[id * B + j] = a.le[id][j];
      for (let d = 0; d < dims; d++) leaf.meas[d][id * B + j] = a.lm[d][id][j];
    }
  }
  const ip = a.int;
  const int = {
    size: ip.size, bump: ip.bump, free: ip.free, next: ip.next.slice(),
    left: ip.left.slice(), right: ip.right.slice(), weight: ip.weight.slice(),
    count: ip.count.slice(), sum: [],
  };
  for (let d = 0; d < dims; d++) int.sum.push(ip.sum[d].slice());
  const views = [];
  for (let v = 0; v < a.views.length; v++) {
    const w = a.views[v];
    views.push({
      _root: w._root, _len: w._len, _fl: w._fl, _fb: w._fb, _fdepth: w._fdepth,
      _fpath: new Int32Array(w._fpath), _cv: w._cv,
    });
  }
  return {
    C: a.C, B: B, dims: dims, NIL: a.NIL, EMPTY_ROOT: a.ER, live: a.live,
    int: int, leaf: leaf, views: views,
  };
}

function stMake(mut, C, opts, count, cfg) {
  if (!stIsInt(C) || C < 1 || C > ST_C_CAP) stFail('capacity', 'C must be an integer in 1..2^20');
  if (opts === undefined) opts = {};
  if (!stPlain(opts)) stFail('options', 'must be a plain object');
  stKeys(opts, ST_OPT_KEYS, 'options');
  const B = opts.leafSize === undefined ? 16 : opts.leafSize;
  if (!(B === 4 || B === 8 || B === 16 || B === 32)) stFail('options', 'leafSize must be 4, 8, 16 or 32');
  const dims = opts.dims === undefined ? 1 : opts.dims;
  if (!stIsInt(dims) || dims < 1 || dims > 4) stFail('dims', 'must be an integer in 1..4');
  if (!stIsInt(count) || count < 1 || count > Math.min(C, 4096)) {
    stFail('count', 'must be an integer in 1..min(C, 4096)');
  }
  if (cfg === undefined || cfg === null) cfg = {};
  if (!stPlain(cfg)) stFail('cfg', 'must be a plain object');
  stKeys(cfg, ST_CFG_KEYS, 'cfg');
  const m = B / 4;
  const L = Lmax(C, m, count);
  const NIL = cfg.NIL === undefined ? 0 : cfg.NIL;
  const ER = cfg.EMPTY_ROOT === undefined ? 0x7fffffff : cfg.EMPTY_ROOT;
  if (!Number.isSafeInteger(NIL) || (NIL < 0 && -NIL - 1 < L)) stFail('cfg', 'NIL is a leaf ref of a pool id');
  if (!Number.isSafeInteger(ER) || ER === 0 || (ER >= 0 && ER < L - 1) || (ER < 0 && -ER - 1 < L)) {
    stFail('cfg', 'EMPTY_ROOT is 0 or a valid ref');
  }
  const pf = cfg.protoField;
  if (pf !== undefined && !ST_PROTO_FIELDS.includes(pf)) {
    stFail('cfg', 'protoField must be one of ' + ST_PROTO_FIELDS.join(', '));
  }
  const is = L - 1;
  const a = {
    C: C, B: B, m: m, dims: dims, L: L, HL: H(L), NIL: NIL, ER: ER, mut: mut, live: 0,
    int: {
      size: is, bump: 0, free: ST_END,
      next: new Int32Array(is).fill(ST_END),
      left: new Int32Array(is), right: new Int32Array(is),
      weight: new Int32Array(is), count: new Int32Array(is), sum: [],
    },
    leaf: {
      size: L, bump: 0, free: ST_END,
      next: new Int32Array(L).fill(ST_END), len: new Int32Array(L),
    },
    ip: new Int32Array(is).fill(-1), // parent of each internal node (-1 = root)
    lp: new Int32Array(L).fill(-1),  // parent of each leaf (-1 = root leaf)
    le: [],                          // per-leaf entity slots
    lm: [],                          // dims x per-leaf measure slots
    ls: [],                          // dims x Float64Array(L) leaf sums
    dPath: new Int32Array(H(L)), dLeaf: 0, dFb: 0, dDepth: 0, dSide: -1,
    views: [],
  };
  for (let d = 0; d < dims; d++) {
    a.int.sum.push(new Float64Array(is));
    a.lm.push([]);
    a.ls.push(new Float64Array(L));
  }
  let K = StubView;
  if (pf !== undefined) {
    K = class extends StubView {};
    Object.defineProperty(K.prototype, pf, {
      configurable: true,
      get() { return ST_PROTO_STORE.get(this); },
      set(x) { ST_PROTO_STORE.set(this, x); },
    });
  }
  for (let v = 0; v < count; v++) a.views.push(new K(a));
  const views = a.views.slice();
  return { views: views, snapshot: () => stSnapshot(a) };
}

// ---- factories (R1-5) ------------------------------------------------------------

export function synthStub(C, opts, count, cfg) {
  return stMake(null, C, opts, count, cfg);
}

export function flatStub(C, opts, count, cfg) {
  return stMake('flat', C, opts, count, cfg);
}

export function seekStub(C, opts, count, cfg) {
  return stMake('seek', C, opts, count, cfg);
}

export function staleFingerStub(C, opts, count, cfg) {
  return stMake('stale', C, opts, count, cfg);
}

export function nolandStub(C, opts, count, cfg) {
  return stMake('noland', C, opts, count, cfg);
}

export function countStub(C, opts, count, cfg) {
  return stMake('count', C, opts, count, cfg);
}

export function homeStub(C, opts, count, cfg) {
  return stMake('home', C, opts, count, cfg);
}
