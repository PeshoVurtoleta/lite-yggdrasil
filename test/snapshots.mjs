// test/snapshots.mjs -- hand-built SumSequence snapshots for the invariant walk
// (test harness; not a hot path).
//
// Role: decisions/0005 C-28 per-code fixtures and C-41 ASSERTION 3. The
// snapshot shape is the contract stated in the header of the walk module
// (C-27 / C-28); this file never imports that module, so a fixture cannot
// borrow its geometry. The only import is H from ./spec-counts.mjs.
//
// API
//   fixtures() -> a FRESH array (new objects on every call) of
//     name    unique string
//     opts    B, dims (equal to snap.B / snap.dims)
//     expect  null (clean) or the code the walk must report
//     token   the detail token of a failing fixture (null when clean)
//     snap    the snapshot
//   Each failing fixture is one minimal corruption of a clean build that
//   violates only its target check as far as the check order allows (I-7 and
//   I-8 run before I-1 / I-5, so every leaf-size fixture keeps
//   L_s <= max(1, floor(n_s/m))).
//
// Conventions
//   NIL = 0 (legal: leaf refs are < 0) and EMPTY_ROOT = 0x7fffffff (neither 0
//   nor a valid ref at these pool sizes), as an engine adapter would read them
//   from a fresh empty view (C-1, C-8, C-27).
//   A tree spec is a number (a leaf of that many elements) or a pair
//   [left, right] (an internal node). Ids are given in build order: internal
//   ids in pre-order across views (or through an explicit permutation), leaf
//   ids in sequence order across views. Spare ids appended after the live ones
//   form each pool's free list in ascending order.
//   Element i of view v has entity v*100 + i and dim-d measure (i % 9) + 1 +
//   10*d unless a fixture overrides it. Unused slots, spare nodes and _fpath
//   entries past the depth hold poison values that the walk must never read.
//
// MIT (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>

import { H } from './spec-counts.mjs';

const SB_NIL = 0;
const SB_EMPTY_ROOT = 0x7fffffff;
const SB_POISON_M = -0.5;    // unused measure slots / spare sums
const SB_POISON_E = -1;      // unused entity slots
const SB_POISON_N = -7;      // spare weights / counts
const SB_POISON_PATH = -9;   // _fpath entries past the depth
const SB_2_52 = 4503599627370496;

// ---- builder ---------------------------------------------------------------

function sbMeasure(i, d) {
  return (i % 9) + 1 + 10 * d;
}

function sbLeafSum(leaf, B, id, d) {
  const col = leaf.meas[d];
  let s = 0;
  for (let j = 0; j < leaf.len[id]; j++) s += col[id * B + j];
  return s;
}

function sbW(int, ref) {
  return ref >= 0 ? int.weight[ref] : 1;
}

function sbN(int, leaf, ref) {
  return ref >= 0 ? int.count[ref] : leaf.len[~ref];
}

function sbS(int, leaf, B, ref, d) {
  return ref >= 0 ? int.sum[d][ref] : sbLeafSum(leaf, B, ~ref, d);
}

// o: B, dims, C, views (spec or null per view), fingers (in-order leaf index
// or null per view; default all null), spareLeaf, spareInt, intPerm,
// measure(v, i, d). Returns the snapshot and the build meta (ids per view).
function sbBuild(o) {
  const B = o.B;
  const dims = o.dims;
  const C = o.C;
  const specs = o.views;
  const k = specs.length;
  const m = B / 4;
  const Lmax = Math.ceil(C / m) + k;
  const HL = H(Lmax);
  const ls = Lmax;
  const is = Lmax - 1;
  const leaf = {
    size: ls, bump: 0, free: -1,
    next: new Int32Array(ls).fill(-1),
    len: new Int32Array(ls),
    ent: new Int32Array(ls * B).fill(SB_POISON_E),
    meas: [],
  };
  const int = {
    size: is, bump: 0, free: -1,
    next: new Int32Array(is).fill(-1),
    left: new Int32Array(is),
    right: new Int32Array(is),
    weight: new Int32Array(is).fill(SB_POISON_N),
    count: new Int32Array(is).fill(SB_POISON_N),
    sum: [],
  };
  for (let d = 0; d < dims; d++) {
    leaf.meas.push(new Float64Array(ls * B).fill(SB_POISON_M));
    int.sum.push(new Float64Array(is).fill(SB_POISON_M));
  }
  const views = [];
  const meta = [];
  let nextLeaf = 0;
  let pre = 0;
  let live = 0;
  for (let v = 0; v < k; v++) {
    const mv = { ints: [], leaves: [], depth: [], paths: [], first: [] };
    meta.push(mv);
    const view = {
      _root: SB_EMPTY_ROOT, _len: 0, _fl: SB_NIL, _fb: 0, _fdepth: 0,
      _fpath: new Int32Array(HL).fill(SB_POISON_PATH), _cv: false,
    };
    views.push(view);
    if (specs[v] === null) continue;
    const st = [{ s: specs[v], parent: -1, side: 0, depth: 0, path: [] }];
    let elem = 0;
    while (st.length > 0) {
      const it = st.pop();
      let ref;
      if (Array.isArray(it.s)) {
        const id = o.intPerm ? o.intPerm[pre] : pre;
        pre++;
        ref = id;
        mv.ints.push(id);
        const path = it.path.concat([id]);
        st.push({ s: it.s[1], parent: id, side: 1, depth: it.depth + 1, path: path });
        st.push({ s: it.s[0], parent: id, side: 0, depth: it.depth + 1, path: path });
      } else {
        const id = nextLeaf++;
        const n = it.s;
        ref = ~id;
        leaf.len[id] = n;
        for (let j = 0; j < n; j++) {
          const i = elem++;
          leaf.ent[id * B + j] = v * 100 + i;
          for (let d = 0; d < dims; d++) {
            leaf.meas[d][id * B + j] = o.measure ? o.measure(v, i, d) : sbMeasure(i, d);
          }
        }
        mv.leaves.push(id);
        mv.depth.push(it.depth);
        mv.paths.push(it.path);
        mv.first.push(elem - n);
      }
      if (it.parent === -1) view._root = ref;
      else if (it.side === 0) int.left[it.parent] = ref;
      else int.right[it.parent] = ref;
    }
    view._len = elem;
    live += elem;
    for (let i = mv.ints.length - 1; i >= 0; i--) {
      const u = mv.ints[i];
      const l = int.left[u];
      const r = int.right[u];
      int.weight[u] = sbW(int, l) + sbW(int, r);
      int.count[u] = sbN(int, leaf, l) + sbN(int, leaf, r);
      for (let d = 0; d < dims; d++) {
        int.sum[d][u] = sbS(int, leaf, B, l, d) + sbS(int, leaf, B, r, d);
      }
    }
    const f = o.fingers ? o.fingers[v] : null;
    if (f !== null && f !== undefined) {
      view._fl = ~mv.leaves[f];
      view._fb = mv.first[f];
      view._fdepth = mv.depth[f];
      for (let j = 0; j < mv.paths[f].length; j++) view._fpath[j] = mv.paths[f][j];
    }
  }
  const spareLeaf = o.spareLeaf || 0;
  const spareInt = o.spareInt || 0;
  for (let s = 0; s < spareLeaf; s++) {
    leaf.next[nextLeaf + s] = s + 1 < spareLeaf ? nextLeaf + s + 1 : -1;
  }
  for (let s = 0; s < spareInt; s++) {
    int.next[pre + s] = s + 1 < spareInt ? pre + s + 1 : -1;
  }
  leaf.free = spareLeaf > 0 ? nextLeaf : -1;
  int.free = spareInt > 0 ? pre : -1;
  leaf.bump = nextLeaf + spareLeaf;
  int.bump = pre + spareInt;
  const snap = {
    C: C, B: B, dims: dims, NIL: SB_NIL, EMPTY_ROOT: SB_EMPTY_ROOT, live: live,
    int: int, leaf: leaf, views: views,
  };
  return { snap: snap, meta: meta, spareLeaf0: nextLeaf, spareInt0: pre };
}

// ---- bases (each call builds fresh objects) -----------------------------------

// B=4 (m=1), 8 leaves 2,3,1,4,2,1,2,3 (ids 0..7), internal pre-order ids
// 0 root, 1 [2,[3,1]], 2 [3,1], 3 right, 4 [4,2], 5 [1,[2,3]], 6 [2,3];
// finger on leaf 6 at depth 4, fb 13, path 0,3,5,6. C=18 -> Lmax 19, H 7.
function sbMulti() {
  return sbBuild({
    B: 4, dims: 1, C: 18,
    views: [[[2, [3, 1]], [[4, 2], [1, [2, 3]]]]],
    fingers: [6],
  });
}

// B=4, leaves 2,3,1,4 (ids 0..3) + `spares` free leaves from id 4 (4 -> 5 for
// 2); internal 0..2 + `spares` free internals from id 3. C=10 -> Lmax 11.
function sbFree(spares) {
  return sbBuild({
    B: 4, dims: 1, C: 10,
    views: [[[2, 3], [1, 4]]],
    fingers: [1],
    spareLeaf: spares, spareInt: spares,
  });
}

// B=16 (m=4), two leaves 8|8: 17 appends (13|4) then removeAt(16) -> 13|3
// underflows -> equalize 8|8 (C-22, C-28). C=17 -> Lmax 6.
function sb88() {
  return sbBuild({
    B: 16, dims: 1, C: 17,
    views: [[8, 8]],
    fingers: [1],
  });
}

// B=4, a tree after ONE single rotation (pointer swap) at the root.
// Before: u=(a, r), r=(s, t), s=(b1, b2), t=(c1, c2), ids u0 r1 s2 t3; two
// splits made r heavy (1 vs 4 leaves), gamma=2 picks a single rotation
// (w(s)=2 < 2*w(t)=4). After: r=(u, t), u=(a, s): root id 1, its left child
// id 0. Leaves a=2, b1=2, b2=1, c1=3, c2=2 (ids 0..4). Finger on b1 (id 1):
// depth 3 and fb 2 both before and after; true path 1,0,2; stale path 0,1,2.
function sbRotated() {
  return sbBuild({
    B: 4, dims: 1, C: 10,
    views: [[[2, [2, 1]], [3, 2]]],
    fingers: [1],
    intPerm: [1, 0, 2, 3],
  });
}

// k=2, B=4: view 0 [[2,3],1] (leaves 0..2, internals 0..1), view 1 as given.
function sbTwo(second, fingers, C) {
  return sbBuild({
    B: 4, dims: 1, C: C,
    views: [[[2, 3], 1], second],
    fingers: fingers,
  });
}

// ---- fixtures -------------------------------------------------------------------

function sbFx(out, name, expect, token, snap) {
  out.push({
    name: name,
    opts: { B: snap.B, dims: snap.dims },
    expect: expect,
    token: token,
    snap: snap,
  });
}

export function fixtures() {
  const out = [];
  let b;
  let s;

  // ---- clean ----
  sbFx(out, 'clean-b4-single-leaf', null, null, sbBuild({
    B: 4, dims: 1, C: 4, views: [3], fingers: [0],
  }).snap);
  sbFx(out, 'clean-b4-multi-level', null, null, sbMulti().snap);
  // B=8 (m=2), dims=2, leaves 5,3,8,2,4; finger on the 8 (depth 2, fb 8).
  sbFx(out, 'clean-b8-dims2', null, null, sbBuild({
    B: 8, dims: 2, C: 24, views: [[[5, 3], [8, [2, 4]]]], fingers: [2],
  }).snap);
  sbFx(out, 'clean-b16-8-8-finger-fb8', null, null, sb88().snap);
  // k=3, B=8: empty view, single-leaf view, multi-leaf view (finger on the
  // leaf of 2 at depth 3, fb 15); 2 spare leaves and 1 spare internal free.
  sbFx(out, 'clean-k3-empty-single-multi', null, null, sbBuild({
    B: 8, dims: 1, C: 27,
    views: [null, 3, [[4, 6], [5, [2, 7]]]],
    fingers: [null, 0, 3],
    spareLeaf: 2, spareInt: 1,
  }).snap);
  // Non-empty view, finger off (_fl === NIL) with garbage _fb / _fdepth /
  // _fpath: NIL checks nothing else (C-28 I-9 (a)).
  b = sbBuild({ B: 4, dims: 1, C: 6, views: [[[2, 3], 1]] });
  b.snap.views[0]._fb = 12345;
  b.snap.views[0]._fdepth = 9;
  b.snap.views[0]._fpath.fill(-3);
  sbFx(out, 'clean-fl-nil-nonempty', null, null, b.snap);
  sbFx(out, 'clean-all-empty', null, null, sbBuild({
    B: 16, dims: 1, C: 16, views: [null, null],
  }).snap);
  sbFx(out, 'clean-b4-free-lists', null, null, sbFree(2).snap);
  sbFx(out, 'clean-b4-after-rotation', null, null, sbRotated().snap);

  // ---- I-7 ----
  // Double free of the head of a one-entry free list: free(x) twice in a row
  // writes next[x] = x (sbFree(1): leaf list 4 -> END, internal 3 -> END).
  b = sbFree(1);
  b.snap.leaf.next[4] = 4;
  sbFx(out, 'i7-dup-leaf', 'I-7', 'dup', b.snap);
  b = sbFree(1);
  b.snap.int.next[3] = 3;
  sbFx(out, 'i7-dup-int', 'I-7', 'dup', b.snap);
  // Free lists of sbFree(2): leaf 4 -> 5 -> END, internal 3 -> 4 -> END.
  b = sbFree(2);
  b.snap.leaf.next[5] = 0; // live leaf 0 on the free list
  sbFx(out, 'i7-live-free-leaf', 'I-7', 'live-free', b.snap);
  b = sbFree(2);
  b.snap.int.next[4] = 1; // live internal 1 on the free list
  sbFx(out, 'i7-live-free-int', 'I-7', 'live-free', b.snap);
  b = sbFree(2);
  b.snap.leaf.next[4] = -1; // leaf 5 < bump, neither live nor free
  sbFx(out, 'i7-leak-leaf', 'I-7', 'leak', b.snap);
  b = sbFree(2);
  b.snap.int.next[3] = -1;
  sbFx(out, 'i7-leak-int', 'I-7', 'leak', b.snap);
  b = sbFree(2);
  b.snap.leaf.next[5] = 4; // 4 -> 5 -> 4 ...
  sbFx(out, 'i7-cycle-leaf', 'I-7', 'cycle', b.snap);
  b = sbFree(2);
  b.snap.int.next[4] = 3;
  sbFx(out, 'i7-cycle-int', 'I-7', 'cycle', b.snap);
  b = sbMulti();
  b.snap.int.right[6] = 0; // child graph cycle: node 6 points at the root
  sbFx(out, 'i7-shared-child-cycle', 'I-7', 'shared', b.snap);
  b = sbMulti();
  b.snap.live += 1;
  sbFx(out, 'i7-hdr-live', 'I-7', 'hdr', b.snap);

  // ---- I-8 ----
  // C-23: a stack of H(Lmax) - 1 must FAIL (depth 4 still fits in it).
  b = sbMulti();
  s = b.snap.views[0];
  s._fpath = s._fpath.slice(0, s._fpath.length - 1);
  sbFx(out, 'i8-stack-short', 'I-8', 'stack', b.snap);

  // ---- I-1 ----
  // M-1 (0001 DB-8): root = (leaf of 4, subtree of 4 one-element leaves);
  // internal ids 0 root, 1 subtree, 2 and 3 pairs. Element-count mutant
  // weights (count + 1): root children 5 | 5, balanced; recounted leaf counts
  // 1 vs 4 fail (3*1 < 4).
  b = sbBuild({ B: 4, dims: 1, C: 8, views: [[4, [[1, 1], [1, 1]]]], fingers: [0] });
  b.snap.int.weight[0] = 9;
  b.snap.int.weight[1] = 5;
  b.snap.int.weight[2] = 3;
  b.snap.int.weight[3] = 3;
  sbFx(out, 'i1-balance-m1', 'I-1', 'balance', b.snap);
  b = sbMulti();
  b.snap.int.weight[4] += 1; // balance holds; one stored weight off
  sbFx(out, 'i1-weight-off', 'I-1', 'weight', b.snap);

  // ---- I-2 ----
  b = sbMulti();
  b.snap.int.count[2] += 1;
  sbFx(out, 'i2-count-off', 'I-2', 'count', b.snap);
  b = sbBuild({ B: 8, dims: 2, C: 24, views: [[[5, 3], [8, [2, 4]]]], fingers: [2] });
  b.snap.int.sum[1][2] += 1;
  sbFx(out, 'i2-sum-off', 'I-2', 'sum', b.snap);

  // ---- I-3 ----
  // Element 5 (leaf 2, a one-element leaf) has dim-0 measure -0; the stored
  // sums are built from it, so I-2 passes.
  sbFx(out, 'i3-measure-neg0', 'I-3', 'measure', sbBuild({
    B: 4, dims: 1, C: 18,
    views: [[[2, [3, 1]], [[4, 2], [1, [2, 3]]]]],
    fingers: [6],
    measure: (v, i, d) => (i === 5 ? -0 : sbMeasure(i, d)),
  }).snap);
  // B=16 single leaf, two elements 2^52 each: total 2^53 > 2^53 - 1.
  sbFx(out, 'i3-total-2p53', 'I-3', 'total', sbBuild({
    B: 16, dims: 1, C: 2, views: [2], fingers: [0],
    measure: () => SB_2_52,
  }).snap);
  b = sbMulti();
  b.snap.leaf.ent[0] = 1073741824; // 2^30, one past the C-9 domain
  sbFx(out, 'i3-entity-2p30', 'I-3', 'entity', b.snap);

  // ---- I-5 ----
  // B=8 (m=2), leaves 1 | 8: 1 < m. n=9 keeps I-8 passing: floor(9/2)=4 >= 2.
  sbFx(out, 'i5-leaf-under-m', 'I-5', 'leaf', sbBuild({
    B: 8, dims: 1, C: 9, views: [[1, 8]], fingers: [1],
  }).snap);

  // ---- finger ----
  // k=2: view 1 empty with _fl = ~0 (a live leaf of view 0).
  b = sbTwo(null, [0, null], 6);
  b.snap.views[1]._fl = ~0;
  sbFx(out, 'i9a-empty-fl', 'I-9a', 'empty-fl', b.snap);
  b = sbMulti();
  b.snap.views[0]._fl = ~b.snap.leaf.size; // id = leaf.size: outside the pool
  sbFx(out, 'xg1-range', 'XG-1', 'range', b.snap);
  b = sbFree(2);
  b.snap.views[0]._fl = ~4; // leaf 4 is the free-list head
  sbFx(out, 'xg1-freed', 'XG-1', 'freed', b.snap);
  // k=2: view 1 [2,2] (leaves 3, 4); its _fl names leaf 0 of view 0.
  b = sbTwo([2, 2], [0, 0], 10);
  b.snap.views[1]._fl = ~0;
  sbFx(out, 'xg1-foreign', 'XG-1', 'foreign', b.snap);
  // C-28 stale fb: 8|8 after 17 appends + removeAt(16); fb 13 (the 13|4
  // split's value) vs truth 8.
  b = sb88();
  b.snap.views[0]._fb = 13;
  sbFx(out, 'i9c-fb-stale', 'I-9c', 'fb', b.snap);
  b = sbMulti();
  b.snap.views[0]._fdepth += 1;
  sbFx(out, 'i9d-depth-plus1', 'I-9d', 'depth', b.snap);
  // Pre-rotation path 0,1,2 left in _fpath after the rotation (truth 1,0,2);
  // depth 3 and fb 2 are correct.
  b = sbRotated();
  b.snap.views[0]._fpath[0] = 0;
  b.snap.views[0]._fpath[1] = 1;
  sbFx(out, 'i9e-path-pre-rotation', 'I-9e', 'path', b.snap);

  return out;
}
