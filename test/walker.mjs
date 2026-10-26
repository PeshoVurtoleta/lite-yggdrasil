// test/walker.mjs -- the SumSequence invariant walker (test harness; not a hot
// path: clarity beats speed, allocation is fine).
//
// Binding rules: decisions/0005 C-27 (snapshot, finger fields), C-28 (I-9,
// XG-1, pool census, per-code fixtures), C-1 / C-5 (finger state, ownership),
// C-8 (EMPTY_ROOT), C-9 (entity domain), C-15 (pools), C-23 (H), C-41
// ASSERTION 3. Invariant text: RESEARCH.md section 5 (I-1..I-9), decisions/0001
// T-1..T-10 and "I-8 walker assertions", decisions/0004 A-1 / A-5.
//
// API
//   walk(snap, opts)  opts = B, dims. Returns null when every check passes,
//                     else ONE object (code, detail) for the FIRST failure in
//                     the order below; detail starts with the check token.
//   CODES             frozen list of the codes, in check order. I-4 (seek) is
//                     oracle-checked and I-6 (keyed routing) is n/a (no keys),
//                     so neither is a code; C-28 I-9 (b) is the C-5 ownership
//                     rule and reports as XG-1 (there is no I-9b).
// walk never throws (a malformed snapshot, or any exception while reading it,
// is SNAP), never mutates its input, is deterministic, and is ITERATIVE: no
// function in this file calls itself (0001 DB-8 M-3 (b)). Every traversal uses
// an explicit stack plus visited marks, so a cyclic child graph or a looping
// free list terminates. The only import is H from ./spec-counts.mjs; Lmax is
// computed inline.
//
// Snapshot contract (C-28: "Snapshot contract is in the walker file header").
// A plain object; every field is required.
//   C, B, dims       arena constants: C integer >= 1, B in 4 / 8 / 16 / 32,
//                    dims in 1..4; m = B/4.
//   NIL              the value a fresh empty view holds in _fl (C-1, C-27).
//   EMPTY_ROOT       the _root of a fresh empty view (C-8); never 0, never a
//                    valid ref.
//   live             header: total elements over all views (0004 A-5).
//   int              internal-node pool, ids [0, size):
//     size, bump, free   size = Lmax - 1 (C-15); ids >= bump never allocated;
//                        free = head id or -1 (END)
//     next               Int32Array(size): free-list link, next free id or -1
//     left, right        Int32Array(size): child ref; >= 0 internal id,
//                        < 0 leaf ref = ~leafId (I-7)
//     weight             Int32Array(size): stored balance weight = leaf count
//     count              Int32Array(size): stored element count (I-2)
//     sum                dims x Float64Array(size): stored per-dim sums (I-2)
//   leaf             leaf pool, ids [0, size):
//     size, bump, free   size = Lmax = ceil(C/m) + k, k = views.length (C-15)
//     next               Int32Array(size): free-list link, -1 = END
//     len                Int32Array(size): elements in the leaf
//     ent                Int32Array(size*B): slot j of leaf id at id*B + j
//     meas               dims x Float64Array(size*B)
//   views            array (k >= 1) of per-view objects (C-27):
//     _root    EMPTY_ROOT when empty, a leaf ref (single-leaf view, depth 0)
//              or an internal id
//     _len     element count of the view
//     _fl      NIL or a leaf ref (~id, negative); NIL = 0 is legal
//     _fb      index of fl's first element in the view
//     _fdepth  internal nodes from _root down to fl (root leaf -> 0)
//     _fpath   Int32Array of length exactly H(Lmax); [k] = internal node at
//              depth k, k in [0, _fdepth)
//     _cv      boolean (cursor bit, C-6)
//   Leaf summaries are NOT stored: the walk recounts leaf count and sums from
//   len + meas. Slots >= len are garbage and never read. Free-list ids are
//   plain ids (not ~). When _fl === NIL, _fb / _fdepth and the _fpath contents
//   are never read (finger off is legal; C-28 I-9 (a)).
//
// Check order (first failure wins) and detail tokens
//   SNAP  'snap'       contract: a field missing / of the wrong type (ids and
//                      counts are safe integers; typed arrays of the stated
//                      class and exact length; sum / meas hold exactly dims
//                      columns); opts.B / opts.dims differ; B or dims out of
//                      range; views empty; _cv not boolean; _fpath not an
//                      Int32Array; EMPTY_ROOT === 0 or a valid ref; NIL a leaf
//                      ref of a pool id; bump outside [0, size]; _fb / _fdepth
//                      not integers while _fl !== NIL.
//   I-7   'poolsize'   leaf.size !== ceil(C/m) + k or int.size !== leaf.size-1
//         'range'      a root / child ref >= its pool's bump
//         'shared'     a live node reached twice over ALL views (also a cycle)
//         free list, leaf pool then internal pool, per entry in walk order:
//         'cycle'      more than size steps, or the walk revisits an earlier id
//         'range'      an entry outside [0, bump)
//         'dup'        an id that links to itself (pushed twice in a row: the
//                      double-free signature of a linked free list)
//         'live-free'  a live id on the free list (after the walk's
//                      structural checks pass)
//         'leak'       an id in [0, bump) neither live nor free
//         'retention'  live + free + (size - bump) !== size, or live internal
//                      !== sum (L_s - 1) (defensive: unreachable after a
//                      passing census)
//         'hdr'        live !== sum of _len, or live > C
//   I-8   'stack'      _fpath.length !== H(Lmax)
//         'height'     height(s) > H(L_s)
//         'leaves'     L_s > max(1, floor(n_s/m)); sum of L_s > Lmax
//   I-1   'balance'    3*w(l) < w(r) or 3*w(r) < w(l) on the RECOUNTED leaf
//                      counts, every node of every view first, then
//         'weight'     stored weight !== recount (0001 Table 1, M-1)
//   I-2   'count'      stored count !== recount
//         'sum'        a stored dim sum !== recount
//         'empty'      (_len === 0) !== (_root === EMPTY_ROOT) (C-8)
//         'len'        _len !== the root's recount
//   I-3   'measure'    a live slot measure not an integer >= 0, or -0
//         'total'      a per-view per-dim total > 2^53 - 1
//         'entity'     a live slot entity outside [0, 2^30 - 1] (C-9)
//   I-5   'leaf'       a live leaf len outside [1, B]; in a view with >= 2
//                      leaves a leaf len < m (T-8 exempts the single leaf)
//   finger, view by view (C-28 I-9 (a)-(e), C-5):
//   I-9a  'empty-fl'   _len === 0 and _fl !== NIL
//   XG-1  'range'      _fl not a leaf ref of an id in [0, leaf.size)
//         'freed'      fl on the leaf free list, or id >= bump
//         'foreign'    fl live in ANOTHER view
//         'reach'      fl not reachable from this view's root (defensive)
//   I-9c  'fb'         _fb !== recounted first index of fl
//   I-9d  'depth'      _fdepth !== recounted depth of fl
//   I-9e  'path'       _fpath[k] !== recounted node at depth k, k < depth
//
// MIT (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>

import { H } from './spec-counts.mjs';

export const CODES = Object.freeze([
  'SNAP', 'I-7', 'I-8', 'I-1', 'I-2', 'I-3', 'I-5',
  'I-9a', 'XG-1', 'I-9c', 'I-9d', 'I-9e',
]);

const WK_MAX_TOTAL = 9007199254740991; // 2^53 - 1 (I-3)
const WK_MAX_ENT = 0x3FFFFFFF;         // 2^30 - 1 (C-9)
const WK_END = -1;                     // free-list END
const WK_VIEW_FIELDS = Object.freeze([
  '_root', '_len', '_fl', '_fb', '_fdepth', '_fpath', '_cv',
]);

// ---- small helpers -----------------------------------------------------------

function wkFail(code, detail) {
  return { code: code, detail: detail };
}

function wkSafe(x) {
  return Number.isSafeInteger(x);
}

function wkObj(x) {
  return x !== null && typeof x === 'object';
}

function wkI32(x, n) {
  return x instanceof Int32Array && x.length === n;
}

function wkCols(a, dims, n) {
  if (!Array.isArray(a) || a.length !== dims) return false;
  for (let d = 0; d < dims; d++) {
    if (!(a[d] instanceof Float64Array) || a[d].length !== n) return false;
  }
  return true;
}

// Leaf id of a leaf ref (ref < 0). Exact for any safe integer (no ToInt32).
function wkLeafId(ref) {
  return -ref - 1;
}

// Slots of a leaf that may be read: len clamped to [0, B].
function wkSlots(len, B) {
  if (len < 0) return 0;
  return len > B ? B : len;
}

// Equal, with NaN equal to NaN (so a NaN measure is reported by I-3, not I-2).
function wkSame(a, b) {
  return a === b || (a !== a && b !== b);
}

// ---- SNAP: the contract --------------------------------------------------------

function wkPool(p, name, isLeaf, B, dims) {
  if (!wkObj(p)) return name + ' pool missing or not an object';
  const size = p.size;
  if (!wkSafe(size) || size < 0) return name + '.size not an integer >= 0';
  if (!wkSafe(p.bump) || p.bump < 0 || p.bump > size) {
    return name + '.bump outside [0, size]';
  }
  if (!wkSafe(p.free)) return name + '.free not an integer';
  if (!wkI32(p.next, size)) return name + '.next not an Int32Array(size)';
  if (isLeaf) {
    if (!wkI32(p.len, size)) return name + '.len not an Int32Array(size)';
    if (!wkI32(p.ent, size * B)) return name + '.ent not an Int32Array(size*B)';
    if (!wkCols(p.meas, dims, size * B)) {
      return name + '.meas not dims x Float64Array(size*B)';
    }
  } else {
    if (!wkI32(p.left, size)) return name + '.left not an Int32Array(size)';
    if (!wkI32(p.right, size)) return name + '.right not an Int32Array(size)';
    if (!wkI32(p.weight, size)) return name + '.weight not an Int32Array(size)';
    if (!wkI32(p.count, size)) return name + '.count not an Int32Array(size)';
    if (!wkCols(p.sum, dims, size)) return name + '.sum not dims x Float64Array(size)';
  }
  return null;
}

function wkView(w, v, NIL) {
  const at = 'view ' + v;
  if (!wkObj(w)) return at + ' not an object';
  for (let f = 0; f < WK_VIEW_FIELDS.length; f++) {
    if (!Object.hasOwn(w, WK_VIEW_FIELDS[f])) return at + ' missing ' + WK_VIEW_FIELDS[f];
  }
  if (!wkSafe(w._root)) return at + ' _root not an integer';
  if (!wkSafe(w._len) || w._len < 0) return at + ' _len not an integer >= 0';
  if (!wkSafe(w._fl)) return at + ' _fl not an integer';
  if (typeof w._cv !== 'boolean') return at + ' _cv not a boolean';
  if (!(w._fpath instanceof Int32Array)) return at + ' _fpath not an Int32Array';
  if (w._fl !== NIL && (!wkSafe(w._fb) || !wkSafe(w._fdepth))) {
    return at + ' _fb / _fdepth not integers while _fl !== NIL';
  }
  return null;
}

// Returns a problem text, or null when the snapshot honours the contract.
function wkShape(snap, opts) {
  if (!wkObj(snap)) return 'snapshot is not an object';
  if (!wkObj(opts)) return 'opts is not an object';
  const B = snap.B;
  const dims = snap.dims;
  if (!(B === 4 || B === 8 || B === 16 || B === 32)) return 'B not one of 4 8 16 32';
  if (!(wkSafe(dims) && dims >= 1 && dims <= 4)) return 'dims not in 1..4';
  if (!(wkSafe(snap.C) && snap.C >= 1)) return 'C not an integer >= 1';
  if (opts.B !== B || opts.dims !== dims) return 'opts.B / opts.dims differ from snap.B / snap.dims';
  let t = wkPool(snap.int, 'int', false, B, dims);
  if (t !== null) return t;
  t = wkPool(snap.leaf, 'leaf', true, B, dims);
  if (t !== null) return t;
  const isz = snap.int.size;
  const lsz = snap.leaf.size;
  if (!wkSafe(snap.live) || snap.live < 0) return 'live not an integer >= 0';
  const NIL = snap.NIL;
  if (!wkSafe(NIL)) return 'NIL not an integer';
  if (NIL < 0 && wkLeafId(NIL) < lsz) return 'NIL ' + NIL + ' is the leaf ref of a pool id';
  const ER = snap.EMPTY_ROOT;
  if (!wkSafe(ER)) return 'EMPTY_ROOT not an integer';
  if (ER === 0) return 'EMPTY_ROOT === 0 (C-8)';
  if ((ER >= 0 && ER < isz) || (ER < 0 && wkLeafId(ER) < lsz)) {
    return 'EMPTY_ROOT ' + ER + ' is a valid ref';
  }
  const views = snap.views;
  if (!Array.isArray(views) || views.length === 0) return 'views empty or not an array';
  for (let v = 0; v < views.length; v++) {
    t = wkView(views[v], v, NIL);
    if (t !== null) return t;
  }
  return null;
}

// ---- walk state ------------------------------------------------------------------

function wkCtx(snap) {
  const ip = snap.int;
  const lp = snap.leaf;
  const views = snap.views;
  const k = views.length;
  const B = snap.B;
  const m = B / 4;
  const dims = snap.dims;
  const rcS = [];
  const leafS = [];
  for (let d = 0; d < dims; d++) {
    rcS.push(new Float64Array(ip.size));
    leafS.push(new Float64Array(lp.size));
  }
  return {
    ip: ip, lp: lp, views: views, k: k, B: B, m: m, dims: dims,
    C: snap.C, live: snap.live, NIL: snap.NIL, ER: snap.EMPTY_ROOT,
    // Lmax = ceil(C/m) + k (C-15); m is a power of 2, so C/m is exact.
    Lmax: Math.ceil(snap.C / m) + k,
    // census marks (I-7): owner view of each live node, -1 = not live
    intOwner: new Int32Array(ip.size).fill(-1),
    leafOwner: new Int32Array(lp.size).fill(-1),
    intFree: new Uint8Array(ip.size),
    leafFree: new Uint8Array(lp.size),
    // recount (wkRecount)
    rcW: new Float64Array(ip.size),
    rcN: new Float64Array(ip.size),
    rcS: rcS,
    leafS: leafS,
    intParent: new Int32Array(ip.size).fill(-1),
    leafParent: new Int32Array(lp.size).fill(-1),
    leafDepth: new Int32Array(lp.size),
    leafFirst: new Float64Array(lp.size),
    vInts: [],    // per view: internal ids in pre-order
    vLeaves: [],  // per view: leaf ids in order
    vN: new Float64Array(k),
    vL: new Int32Array(k),
    vHeight: new Int32Array(k),
    vTot: new Float64Array(k * dims),
  };
}

// Recounted weight / count / dim sum of a ref (after wkRecount).
function wkRW(cx, ref) {
  return ref >= 0 ? cx.rcW[ref] : 1;
}

function wkRN(cx, ref) {
  return ref >= 0 ? cx.rcN[ref] : cx.lp.len[wkLeafId(ref)];
}

function wkRS(cx, ref, d) {
  return ref >= 0 ? cx.rcS[d][ref] : cx.leafS[d][wkLeafId(ref)];
}

function wkSetParent(cx, child, parent) {
  if (child >= 0) cx.intParent[child] = parent;
  else cx.leafParent[wkLeafId(child)] = parent;
}

// ---- I-7: ids, pool census, header ---------------------------------------------

// One free-list walk. Returns a detail text or null.
function wkFreeWalk(p, owner, mark, name) {
  let cur = p.free;
  let prev = WK_END;
  let steps = 0;
  let liveFree = null;
  while (cur !== WK_END) {
    if (steps >= p.size) {
      return 'cycle: ' + name + ' free list takes more than size = ' + p.size + ' steps';
    }
    if (cur < 0 || cur >= p.bump) {
      return 'range: ' + name + ' free entry ' + cur + ' outside [0, bump = ' + p.bump + ')';
    }
    if (cur === prev) {
      return 'dup: ' + name + ' id ' + cur + ' links to itself on the free list (double free)';
    }
    if (mark[cur] !== 0) {
      return 'cycle: ' + name + ' free list revisits id ' + cur + ' after ' + steps + ' steps';
    }
    mark[cur] = 1;
    if (liveFree === null && owner[cur] !== -1) {
      liveFree = 'live-free: ' + name + ' id ' + cur + ' is on the free list and live in view ' +
        owner[cur];
    }
    prev = cur;
    cur = p.next[cur];
    steps++;
  }
  return liveFree;
}

function wkI7(cx) {
  const ip = cx.ip;
  const lp = cx.lp;
  const views = cx.views;
  if (lp.size !== cx.Lmax || ip.size !== lp.size - 1) {
    return wkFail('I-7', 'poolsize: leaf.size ' + lp.size + ', int.size ' + ip.size +
      '; expected Lmax = ' + cx.Lmax + ' and Lmax - 1');
  }
  // Reach every live node once over all views. Each internal node is expanded
  // at most once (marked before its children are pushed): terminates on cycles.
  let rangeMsg = null;
  let sharedMsg = null;
  const stack = [];
  for (let v = 0; v < cx.k; v++) {
    const root = views[v]._root;
    if (root === cx.ER) continue;
    stack.push(root);
    while (stack.length > 0) {
      const ref = stack.pop();
      if (ref >= 0) {
        if (ref >= ip.bump) {
          if (rangeMsg === null) {
            rangeMsg = 'range: view ' + v + ' reaches internal id ' + ref + ' >= int.bump ' + ip.bump;
          }
          continue;
        }
        if (cx.intOwner[ref] !== -1) {
          if (sharedMsg === null) {
            sharedMsg = 'shared: internal id ' + ref + ' reached again from view ' + v +
              ' (first owner view ' + cx.intOwner[ref] + '; shared node or cycle)';
          }
          continue;
        }
        cx.intOwner[ref] = v;
        stack.push(ip.right[ref]);
        stack.push(ip.left[ref]);
      } else {
        const id = wkLeafId(ref);
        if (id >= lp.bump) {
          if (rangeMsg === null) {
            rangeMsg = 'range: view ' + v + ' reaches leaf id ' + id + ' >= leaf.bump ' + lp.bump;
          }
          continue;
        }
        if (cx.leafOwner[id] !== -1) {
          if (sharedMsg === null) {
            sharedMsg = 'shared: leaf id ' + id + ' reached again from view ' + v +
              ' (first owner view ' + cx.leafOwner[id] + ')';
          }
          continue;
        }
        cx.leafOwner[id] = v;
      }
    }
  }
  if (rangeMsg !== null) return wkFail('I-7', rangeMsg);
  if (sharedMsg !== null) return wkFail('I-7', sharedMsg);
  let t = wkFreeWalk(lp, cx.leafOwner, cx.leafFree, 'leaf');
  if (t !== null) return wkFail('I-7', t);
  t = wkFreeWalk(ip, cx.intOwner, cx.intFree, 'int');
  if (t !== null) return wkFail('I-7', t);
  let liveLeaf = 0;
  let freeLeaf = 0;
  for (let id = 0; id < lp.bump; id++) {
    if (cx.leafOwner[id] !== -1) liveLeaf++;
    else if (cx.leafFree[id] !== 0) freeLeaf++;
    else return wkFail('I-7', 'leak: leaf id ' + id + ' < bump is neither live nor free');
  }
  let liveInt = 0;
  let freeInt = 0;
  for (let id = 0; id < ip.bump; id++) {
    if (cx.intOwner[id] !== -1) liveInt++;
    else if (cx.intFree[id] !== 0) freeInt++;
    else return wkFail('I-7', 'leak: internal id ' + id + ' < bump is neither live nor free');
  }
  if (liveLeaf + freeLeaf + (lp.size - lp.bump) !== lp.size) {
    return wkFail('I-7', 'retention: leaf live ' + liveLeaf + ' + free ' + freeLeaf +
      ' + unallocated ' + (lp.size - lp.bump) + ' !== size ' + lp.size);
  }
  if (liveInt + freeInt + (ip.size - ip.bump) !== ip.size) {
    return wkFail('I-7', 'retention: internal live ' + liveInt + ' + free ' + freeInt +
      ' + unallocated ' + (ip.size - ip.bump) + ' !== size ' + ip.size);
  }
  // live internal == sum over non-empty views of (L_s - 1)
  let want = 0;
  for (let id = 0; id < lp.bump; id++) if (cx.leafOwner[id] !== -1) want++;
  let nonEmpty = 0;
  for (let v = 0; v < cx.k; v++) if (views[v]._root !== cx.ER) nonEmpty++;
  want -= nonEmpty;
  if (liveInt !== want) {
    return wkFail('I-7', 'retention: live internal ' + liveInt + ' !== sum (L_s - 1) = ' + want);
  }
  let sumLen = 0;
  for (let v = 0; v < cx.k; v++) sumLen += views[v]._len;
  if (cx.live !== sumLen || cx.live > cx.C) {
    return wkFail('I-7', 'hdr: live ' + cx.live + ', sum of _len ' + sumLen + ', C ' + cx.C);
  }
  return null;
}

// ---- recount (after a passing I-7 census every non-empty view is a tree) --------

function wkRecount(cx) {
  const ip = cx.ip;
  const lp = cx.lp;
  const B = cx.B;
  const dims = cx.dims;
  for (let v = 0; v < cx.k; v++) {
    const ints = [];
    const leaves = [];
    cx.vInts.push(ints);
    cx.vLeaves.push(leaves);
    const root = cx.views[v]._root;
    if (root === cx.ER) continue;
    // pre-order; right pushed before left, so leaves pop in sequence order
    const st = [root];
    const sd = [0];
    let height = 0;
    while (st.length > 0) {
      const ref = st.pop();
      const dep = sd.pop();
      if (ref >= 0) {
        ints.push(ref);
        const l = ip.left[ref];
        const r = ip.right[ref];
        wkSetParent(cx, l, ref);
        wkSetParent(cx, r, ref);
        st.push(r);
        sd.push(dep + 1);
        st.push(l);
        sd.push(dep + 1);
      } else {
        const id = wkLeafId(ref);
        leaves.push(id);
        cx.leafDepth[id] = dep;
        if (dep > height) height = dep;
      }
    }
    let n = 0;
    for (let i = 0; i < leaves.length; i++) {
      const id = leaves[i];
      const len = lp.len[id];
      cx.leafFirst[id] = n;
      n += len;
      const slots = wkSlots(len, B);
      for (let d = 0; d < dims; d++) {
        const col = lp.meas[d];
        let s = 0;
        for (let j = 0; j < slots; j++) s += col[id * B + j];
        cx.leafS[d][id] = s;
      }
    }
    // bottom-up: reverse pre-order visits children before parents
    for (let i = ints.length - 1; i >= 0; i--) {
      const u = ints[i];
      const l = ip.left[u];
      const r = ip.right[u];
      cx.rcW[u] = wkRW(cx, l) + wkRW(cx, r);
      cx.rcN[u] = wkRN(cx, l) + wkRN(cx, r);
      for (let d = 0; d < dims; d++) cx.rcS[d][u] = wkRS(cx, l, d) + wkRS(cx, r, d);
    }
    cx.vN[v] = wkRN(cx, root);
    cx.vL[v] = leaves.length;
    cx.vHeight[v] = height;
    for (let d = 0; d < dims; d++) cx.vTot[v * dims + d] = wkRS(cx, root, d);
  }
}

// ---- I-8: height, stack, leaf-count bounds --------------------------------------

function wkI8(cx) {
  const HL = H(cx.Lmax);
  let sumL = 0;
  for (let v = 0; v < cx.k; v++) {
    const fp = cx.views[v]._fpath;
    if (fp.length !== HL) {
      return wkFail('I-8', 'stack: view ' + v + ' _fpath.length ' + fp.length +
        ' !== H(Lmax) = ' + HL);
    }
    const L = cx.vL[v];
    sumL += L;
    if (L === 0) continue;
    const HLs = H(L);
    if (cx.vHeight[v] > HLs) {
      return wkFail('I-8', 'height: view ' + v + ' height ' + cx.vHeight[v] + ' > H(' + L +
        ') = ' + HLs);
    }
    const cap = Math.max(1, Math.floor(cx.vN[v] / cx.m));
    if (L > cap) {
      return wkFail('I-8', 'leaves: view ' + v + ' L_s ' + L + ' > max(1, floor(' + cx.vN[v] +
        '/' + cx.m + ')) = ' + cap);
    }
  }
  if (sumL > cx.Lmax) {
    return wkFail('I-8', 'leaves: sum of L_s ' + sumL + ' > Lmax ' + cx.Lmax);
  }
  return null;
}

// ---- I-1: balance on the recount, then stored weight ----------------------------

function wkI1(cx) {
  const ip = cx.ip;
  for (let v = 0; v < cx.k; v++) {
    const ints = cx.vInts[v];
    for (let i = 0; i < ints.length; i++) {
      const u = ints[i];
      const wl = wkRW(cx, ip.left[u]);
      const wr = wkRW(cx, ip.right[u]);
      if (3 * wl < wr || 3 * wr < wl) {
        return wkFail('I-1', 'balance: view ' + v + ' node ' + u + ' recounted leaf counts ' +
          wl + ' | ' + wr + ' (3*w(l) >= w(r) and 3*w(r) >= w(l) required)');
      }
    }
  }
  for (let v = 0; v < cx.k; v++) {
    const ints = cx.vInts[v];
    for (let i = 0; i < ints.length; i++) {
      const u = ints[i];
      if (ip.weight[u] !== cx.rcW[u]) {
        return wkFail('I-1', 'weight: view ' + v + ' node ' + u + ' stored weight ' +
          ip.weight[u] + ' !== recounted leaf count ' + cx.rcW[u]);
      }
    }
  }
  return null;
}

// ---- I-2: summaries vs recount, empty / len ------------------------------------

function wkI2(cx) {
  const ip = cx.ip;
  for (let v = 0; v < cx.k; v++) {
    const ints = cx.vInts[v];
    for (let i = 0; i < ints.length; i++) {
      const u = ints[i];
      if (ip.count[u] !== cx.rcN[u]) {
        return wkFail('I-2', 'count: view ' + v + ' node ' + u + ' stored count ' + ip.count[u] +
          ' !== recount ' + cx.rcN[u]);
      }
      for (let d = 0; d < cx.dims; d++) {
        if (!wkSame(ip.sum[d][u], cx.rcS[d][u])) {
          return wkFail('I-2', 'sum: view ' + v + ' node ' + u + ' dim ' + d + ' stored sum ' +
            ip.sum[d][u] + ' !== recount ' + cx.rcS[d][u]);
        }
      }
    }
  }
  for (let v = 0; v < cx.k; v++) {
    const w = cx.views[v];
    const empty = w._root === cx.ER;
    if ((w._len === 0) !== empty) {
      return wkFail('I-2', 'empty: view ' + v + ' _len ' + w._len + ' but _root ' +
        (empty ? '===' : '!==') + ' EMPTY_ROOT (C-8)');
    }
    if (!empty && w._len !== cx.vN[v]) {
      return wkFail('I-2', 'len: view ' + v + ' _len ' + w._len + ' !== recount ' + cx.vN[v]);
    }
  }
  return null;
}

// ---- I-3: measures, totals, entities --------------------------------------------

function wkI3(cx) {
  const lp = cx.lp;
  const B = cx.B;
  for (let v = 0; v < cx.k; v++) {
    const leaves = cx.vLeaves[v];
    for (let i = 0; i < leaves.length; i++) {
      const id = leaves[i];
      const slots = wkSlots(lp.len[id], B);
      for (let j = 0; j < slots; j++) {
        for (let d = 0; d < cx.dims; d++) {
          const x = lp.meas[d][id * B + j];
          if (!(Number.isInteger(x) && x >= 0) || Object.is(x, -0)) {
            return wkFail('I-3', 'measure: view ' + v + ' leaf ' + id + ' slot ' + j + ' dim ' + d +
              ' measure ' + (Object.is(x, -0) ? '-0' : String(x)) + ' is not an integer >= 0 (not -0)');
          }
        }
      }
    }
  }
  for (let v = 0; v < cx.k; v++) {
    if (cx.vL[v] === 0) continue;
    for (let d = 0; d < cx.dims; d++) {
      const t = cx.vTot[v * cx.dims + d];
      if (!(t <= WK_MAX_TOTAL)) {
        return wkFail('I-3', 'total: view ' + v + ' dim ' + d + ' total ' + t + ' > 2^53 - 1');
      }
    }
  }
  for (let v = 0; v < cx.k; v++) {
    const leaves = cx.vLeaves[v];
    for (let i = 0; i < leaves.length; i++) {
      const id = leaves[i];
      const slots = wkSlots(lp.len[id], B);
      for (let j = 0; j < slots; j++) {
        const e = lp.ent[id * B + j];
        if (!(e >= 0 && e <= WK_MAX_ENT)) {
          return wkFail('I-3', 'entity: view ' + v + ' leaf ' + id + ' slot ' + j + ' entity ' + e +
            ' outside [0, 2^30 - 1] (C-9)');
        }
      }
    }
  }
  return null;
}

// ---- I-5: leaf sizes --------------------------------------------------------------

function wkI5(cx) {
  const lp = cx.lp;
  for (let v = 0; v < cx.k; v++) {
    const leaves = cx.vLeaves[v];
    const multi = leaves.length >= 2;
    for (let i = 0; i < leaves.length; i++) {
      const id = leaves[i];
      const len = lp.len[id];
      if (len < 1 || len > cx.B) {
        return wkFail('I-5', 'leaf: view ' + v + ' leaf ' + id + ' len ' + len + ' outside [1, ' +
          cx.B + ']');
      }
      if (multi && len < cx.m) {
        return wkFail('I-5', 'leaf: view ' + v + ' leaf ' + id + ' len ' + len + ' < m = ' + cx.m +
          ' in a view of ' + leaves.length + ' leaves');
      }
    }
  }
  return null;
}

// ---- finger: I-9a, XG-1, I-9c, I-9d, I-9e, view by view --------------------------

function wkFinger(cx) {
  const lp = cx.lp;
  for (let v = 0; v < cx.k; v++) {
    const w = cx.views[v];
    const fl = w._fl;
    if (w._len === 0) {
      if (fl !== cx.NIL) {
        return wkFail('I-9a', 'empty-fl: view ' + v + ' is empty but _fl ' + fl + ' !== NIL ' + cx.NIL);
      }
      continue;
    }
    if (fl === cx.NIL) continue; // finger off: nothing else is checked
    if (!(fl < 0 && wkLeafId(fl) < lp.size)) {
      return wkFail('XG-1', 'range: view ' + v + ' _fl ' + fl + ' is not the leaf ref of an id in [0, ' +
        lp.size + ')');
    }
    const id = wkLeafId(fl);
    if (id >= lp.bump || cx.leafFree[id] !== 0) {
      return wkFail('XG-1', 'freed: view ' + v + ' _fl leaf ' + id +
        (id >= lp.bump ? ' >= leaf.bump ' + lp.bump : ' is on the leaf free list'));
    }
    const owner = cx.leafOwner[id];
    if (owner !== v) {
      if (owner !== -1) {
        return wkFail('XG-1', 'foreign: view ' + v + ' _fl leaf ' + id + ' is live in view ' + owner);
      }
      return wkFail('XG-1', 'reach: view ' + v + ' _fl leaf ' + id + ' is not reachable from its root');
    }
    if (w._fb !== cx.leafFirst[id]) {
      return wkFail('I-9c', 'fb: view ' + v + ' _fb ' + w._fb + ' !== recounted first index ' +
        cx.leafFirst[id] + ' of leaf ' + id);
    }
    const depth = cx.leafDepth[id];
    if (w._fdepth !== depth) {
      return wkFail('I-9d', 'depth: view ' + v + ' _fdepth ' + w._fdepth + ' !== recounted depth ' +
        depth + ' of leaf ' + id);
    }
    const truth = new Int32Array(depth);
    let node = cx.leafParent[id];
    for (let k = depth - 1; k >= 0; k--) {
      truth[k] = node;
      node = cx.intParent[node];
    }
    for (let k = 0; k < depth; k++) {
      if (w._fpath[k] !== truth[k]) {
        return wkFail('I-9e', 'path: view ' + v + ' _fpath[' + k + '] ' + w._fpath[k] +
          ' !== recounted node ' + truth[k] + ' at depth ' + k);
      }
    }
  }
  return null;
}

// ---- entry ----------------------------------------------------------------------

function wkRun(snap, opts) {
  const bad = wkShape(snap, opts);
  if (bad !== null) return wkFail('SNAP', 'snap: ' + bad);
  const cx = wkCtx(snap);
  let r = wkI7(cx);
  if (r !== null) return r;
  wkRecount(cx);
  r = wkI8(cx);
  if (r !== null) return r;
  r = wkI1(cx);
  if (r !== null) return r;
  r = wkI2(cx);
  if (r !== null) return r;
  r = wkI3(cx);
  if (r !== null) return r;
  r = wkI5(cx);
  if (r !== null) return r;
  return wkFinger(cx);
}

// Never throws: an exception while reading a malformed snapshot is SNAP.
export function walk(snap, opts) {
  try {
    return wkRun(snap, opts);
  } catch (e) {
    let msg = '';
    try {
      msg = String(e && e.message);
    } catch (e2) {
      msg = 'unprintable exception';
    }
    return wkFail('SNAP', 'snap: exception while reading the snapshot: ' + msg);
  }
}
