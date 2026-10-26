// test/Walker.test.mjs -- independent checks of the invariant walker (HB3 brief,
// ASSERTIONS W-1..W-12 + controls; ADR 0005 C-27 / C-28 / C-41 ASSERTION 3).
//
// Every expectation comes from the brief's snapshot shape and check order, never from
// running walker.mjs. The snapshot builder below is this file's OWN (it does not use
// snapshots.mjs), so W-2 / W-3 / W-4 / W-5 / W-6 / W-8 / W-10 stand on their own.
// Hand-derived numbers carry their derivation in a comment. ASCII-only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { walk, CODES } from './walker.mjs';
import { fixtures } from './snapshots.mjs';
import { H } from './spec-counts.mjs';

// ---------------------------------------------------------------- own builder
//
// Trees are specs: L(elems) is a leaf, N(l, r) an internal node. An element is
// [entity, measure_0, ... measure_{dims-1}]. Leaf ids are handed out in left-to-right
// order over all views, internal ids in pre-order over all views. Dead slots (>= len)
// hold garbage the walker must never read. Free ids sit right above the live ids.

const L = (elems) => ({ leaf: elems });
const N = (l, r) => ({ l, r });
const lc = (t) => (t === null ? 0 : t.leaf ? 1 : lc(t.l) + lc(t.r));
const ec = (t) => (t === null ? 0 : t.leaf ? t.leaf.length : ec(t.l) + ec(t.r));

// n elements starting at global index `start`; measures are small non-negative ints,
// element 0 has measure_0 = 0 (so a -0 can replace it without changing any sum).
function E(start, n, dims) {
  const out = [];
  for (let i = start; i < start + n; i++) {
    const e = [(i * 37 + 5) % 1000];
    for (let d = 0; d < dims; d++) e.push((i * 3 + d * 5) % 7);
    out.push(e);
  }
  return out;
}

function build(o) {
  const B = o.B, dims = o.dims, m = B / 4, k = o.views.length;
  const nil = o.nil === undefined ? 0 : o.nil;
  const emptyRoot = o.emptyRoot === undefined ? 0x7fffffff : o.emptyRoot;
  const freeLeaf = o.freeLeaf || 0, freeInt = o.freeInt || 0;
  let TL = 0, TI = 0, live = 0;
  for (const t of o.views) {
    TL += lc(t);
    TI += t === null ? 0 : lc(t) - 1;
    live += ec(t);
  }
  const C = o.C !== undefined ? o.C : Math.max(live, m * (TL + freeLeaf + 1));
  const Lmax = Math.ceil(C / m) + k;
  const lsz = Lmax, isz = Lmax - 1;
  const garbageMeas = () => new Float64Array(lsz * B).fill(-0.5);
  const leaf = {
    size: lsz, bump: TL + freeLeaf, free: freeLeaf > 0 ? TL : -1,
    next: new Int32Array(lsz).fill(-1), len: new Int32Array(lsz),
    ent: new Int32Array(lsz * B).fill(-7), meas: [],
  };
  for (let d = 0; d < dims; d++) leaf.meas.push(garbageMeas());
  const int = {
    size: isz, bump: TI + freeInt, free: freeInt > 0 ? TI : -1,
    next: new Int32Array(isz).fill(-1), left: new Int32Array(isz), right: new Int32Array(isz),
    weight: new Int32Array(isz), count: new Int32Array(isz), sum: [],
  };
  for (let d = 0; d < dims; d++) int.sum.push(new Float64Array(isz));
  const freeL = [], freeI = [];
  for (let i = 0; i < freeLeaf; i++) {
    freeL.push(TL + i);
    leaf.next[TL + i] = i + 1 < freeLeaf ? TL + i + 1 : -1;
  }
  for (let i = 0; i < freeInt; i++) {
    freeI.push(TI + i);
    int.next[TI + i] = i + 1 < freeInt ? TI + i + 1 : -1;
  }
  let nl = 0, ni = 0;
  function emit(t, path, start, vm) {
    if (t.leaf) {
      const id = nl++, els = t.leaf;
      leaf.len[id] = els.length;
      const s = new Array(dims).fill(0);
      for (let j = 0; j < els.length; j++) {
        leaf.ent[id * B + j] = els[j][0];
        for (let d = 0; d < dims; d++) {
          leaf.meas[d][id * B + j] = els[j][1 + d];
          s[d] += els[j][1 + d];
        }
      }
      vm.leaves.push({ id, path: path.slice(), fb: start });
      return { ref: ~id, c: els.length, w: 1, s };
    }
    const id = ni++;
    vm.ints.push(id);
    path.push(id);
    const a = emit(t.l, path, start, vm);
    const b = emit(t.r, path, start + a.c, vm);
    path.pop();
    int.left[id] = a.ref; int.right[id] = b.ref;
    int.weight[id] = a.w + b.w; int.count[id] = a.c + b.c;
    const s = [];
    for (let d = 0; d < dims; d++) { int.sum[d][id] = a.s[d] + b.s[d]; s.push(a.s[d] + b.s[d]); }
    return { ref: id, c: a.c + b.c, w: a.w + b.w, s };
  }
  const views = [], vms = [];
  const hl = H(Lmax);
  for (let i = 0; i < k; i++) {
    const t = o.views[i];
    const vm = { root: emptyRoot, leaves: [], ints: [] };
    let root = emptyRoot;
    if (t !== null) root = emit(t, [], 0, vm).ref;
    vm.root = root;
    const fp = new Int32Array(hl).fill(0x55);
    const fi = o.finger ? o.finger[i] : null;
    const v = {
      _root: root, _len: ec(t), _fl: nil, _fb: 0, _fdepth: 0, _fpath: fp, _cv: false,
    };
    if (fi !== null && fi !== undefined) {
      const lf = vm.leaves[fi];
      v._fl = ~lf.id; v._fb = lf.fb; v._fdepth = lf.path.length;
      for (let q = 0; q < lf.path.length; q++) fp[q] = lf.path[q];
    }
    views.push(v); vms.push(vm);
  }
  const snap = { C, B, dims, NIL: nil, EMPTY_ROOT: emptyRoot, live, int, leaf, views };
  return { snap, meta: { v: vms, freeL, freeI, m, Lmax } };
}

const optsOf = (s) => ({ B: s.B, dims: s.dims });

// Base: B=8 (m=2), dims=2, k=3. v0 empty (NIL finger); v1 one leaf of 3 (finger at it);
// v2 five leaves, lens 3,2,4,8,2 (n=19), tree ((a,b),((c,d),e)), finger on d.
// Hand check for d: path = root, root.right, N(c,d) = 3 internal nodes (depth 3);
// first index fb = 3 + 2 + 4 = 9. Leaves 6 live + 3 free (bump 9); internals 4 live + 2 free.
function base(C) {
  const D = 2;
  const t2 = N(N(L(E(10, 3, D)), L(E(20, 2, D))),
    N(N(L(E(30, 4, D)), L(E(40, 8, D))), L(E(50, 2, D))));
  return build({
    B: 8, dims: D, views: [null, L(E(0, 3, D)), t2], finger: [null, 0, 3],
    freeLeaf: 3, freeInt: 2, C,
  });
}

// ---------------------------------------------------------------- helpers

function tokOk(r, token) {
  const toks = Array.isArray(token) ? token : [token];
  return typeof r.detail === 'string' && toks.some((t) => r.detail.startsWith(t));
}

// true when `walker` gives exactly the expected result on (snap, opts)
function agrees(walker, snap, opts, code, token) {
  let r;
  try { r = walker(snap, opts); } catch (e) { return false; }
  if (code === null) return r === null;
  return r !== null && typeof r === 'object' && r.code === code && tokOk(r, token);
}

function expectFail(snap, code, token, label) {
  const r = walk(snap, optsOf(snap));
  assert.notEqual(r, null, label + ': walker accepted a corrupt snapshot');
  assert.equal(r.code, code, label + ': code (detail ' + r.detail + ')');
  assert.ok(tokOk(r, token), label + ': detail token ' + JSON.stringify(token) + ' vs ' + r.detail);
}

function seeded(seed) { // mulberry32, 32-bit exact
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------- W-2 clean matrix

function balancedTree(leaves) { // halves, left gets the ceil: counts stay within 3:1
  if (leaves.length === 1) return leaves[0];
  const h = (leaves.length + 1) >> 1;
  return N(balancedTree(leaves.slice(0, h)), balancedTree(leaves.slice(h)));
}

const cleanMatrix = [];
{
  const rnd = seeded(0xC0FFEE);
  for (const B of [4, 8, 16]) {
    for (const dims of [1, 2]) {
      for (const k of [1, 3]) {
        for (const nL of [1, 2, 5, 9]) {
          const m = B / 4;
          let gi = 0;
          const mkLeaf = () => {
            const len = m + Math.floor(rnd() * (B - m + 1));
            const l = L(E(gi, len, dims)); gi += len; return l;
          };
          let multi;
          if (nL === 1) {
            const len = 1 + Math.floor(rnd() * B);
            multi = L(E(gi, len, dims)); gi += len;
          } else {
            const ls = [];
            for (let i = 0; i < nL; i++) ls.push(mkLeaf());
            multi = balancedTree(ls);
          }
          const views = k === 1 ? [multi] : [null, L(E(900, 1 + Math.floor(rnd() * B), dims)), multi];
          const finger = views.map((t) => {
            if (t === null) return null;
            const n = lc(t);
            return rnd() < 0.25 ? null : Math.floor(rnd() * n);
          });
          cleanMatrix.push({
            name: 'B' + B + ' d' + dims + ' k' + k + ' L' + nL,
            o: { B, dims, views, finger, freeLeaf: k === 3 ? 2 : 0, freeInt: k === 3 ? 1 : 0 },
          });
        }
      }
    }
  }
}

test('W-2: own builder snapshots across B x dims x k x single/multi all pass', () => {
  assert.ok(cleanMatrix.length >= 48, 'coverage floor: ' + cleanMatrix.length);
  let fingered = 0, nilFinger = 0;
  for (const row of cleanMatrix) {
    const { snap } = build(row.o);
    for (const v of snap.views) if (v._len > 0) (v._fl === snap.NIL ? nilFinger++ : fingered++);
    assert.equal(walk(snap, optsOf(snap)), null, row.name);
  }
  assert.ok(fingered >= 40 && nilFinger >= 5, 'finger coverage ' + fingered + '/' + nilFinger);
});

test('W-2: dead-slot garbage and fpath entries at k >= depth are never read', () => {
  const { snap, meta } = base();
  const v2 = snap.views[2];
  assert.equal(v2._fdepth, 3, 'hand-derived depth');
  assert.equal(v2._fb, 9, 'hand-derived fb');
  for (let k = v2._fdepth; k < v2._fpath.length; k++) v2._fpath[k] = 123456;
  snap.leaf.ent[meta.v[1].leaves[0].id * 8 + 5] = -999; // dead slot of the 3-element leaf
  snap.leaf.meas[0][meta.v[1].leaves[0].id * 8 + 5] = NaN;
  assert.equal(walk(snap, optsOf(snap)), null);
});

// ---------------------------------------------------------------- W-3 corruption table

function totalSnap() { // B=16 single leaf, two elements 2^52 each: total 2^53 > 2^53 - 1
  return build({ B: 16, dims: 1, views: [L([[1, 2 ** 52], [2, 2 ** 52]])], finger: [null] });
}
function sparseLeafSnap(lens) { // B=8, two leaves of the given lens, n kept so I-8 'leaves' passes
  let gi = 0;
  const ls = lens.map((n) => { const l = L(E(gi, n, 1)); gi += n; return l; });
  return build({ B: 8, dims: 1, views: [N(ls[0], ls[1])], finger: [null] });
}
function fiveLeaves(shape, lens) { // lens: 5 leaf lengths; shape builds the tree from the 5 leaves
  let gi = 0;
  const ls = lens.map((n) => { const l = L(E(gi, n, 1)); gi += n; return l; });
  return build({ B: 8, dims: 1, views: [shape(ls)], finger: [null] });
}

const rows = [
  // ---- SNAP
  { name: 'snap: leaf.len wrong length', code: 'SNAP', tok: 'snap', mut: (s) => { s.leaf.len = new Int32Array(s.leaf.size + 1); } },
  { name: 'snap: _cv not boolean', code: 'SNAP', tok: 'snap', mut: (s) => { s.views[1]._cv = 1; } },
  { name: 'snap: EMPTY_ROOT is 0', code: 'SNAP', tok: 'snap', mut: (s) => { s.EMPTY_ROOT = 0; s.views[0]._root = 0; } },
  { name: 'snap: bump above size', code: 'SNAP', tok: 'snap', mut: (s) => { s.int.bump = s.int.size + 1; } },
  // ---- I-7
  { name: 'I-7 poolsize: C moves Lmax', code: 'I-7', tok: 'poolsize', mut: (s) => { s.C += 2; } },
  { name: 'I-7 range: internal child id == bump', code: 'I-7', tok: 'range', mut: (s, mt) => { s.int.right[mt.v[2].root] = s.int.bump; } },
  { name: 'I-7 range: leaf ref id == bump', code: 'I-7', tok: 'range', mut: (s, mt) => { s.int.left[mt.v[2].ints[1]] = ~s.leaf.bump; } },
  { name: 'I-7 shared: two parents one leaf', code: 'I-7', tok: 'shared', mut: (s, mt) => { const n = mt.v[2].ints[1]; s.int.right[n] = s.int.left[n]; } },
  { name: 'I-7 shared: leaf rooted in two views', code: 'I-7', tok: 'shared', mut: (s, mt) => { s.views[1]._root = ~mt.v[2].leaves[0].id; } },
  { name: 'I-7 cycle: leaf free list loops', code: 'I-7', tok: 'cycle', mut: (s, mt) => { s.leaf.next[mt.freeL[2]] = mt.freeL[0]; } },
  { name: 'I-7 cycle: int free list loops', code: 'I-7', tok: 'cycle', mut: (s, mt) => { s.int.next[mt.freeI[1]] = mt.freeI[0]; } },
  { name: 'I-7 dup: leaf free list self-loop', code: 'I-7', tok: 'dup', mut: (s, mt) => { s.leaf.next[mt.freeL[0]] = mt.freeL[0]; } },
  { name: 'I-7 dup: int free list self-loop', code: 'I-7', tok: 'dup', mut: (s, mt) => { s.int.next[mt.freeI[0]] = mt.freeI[0]; } },
  { name: 'I-7 range: free entry >= bump', code: 'I-7', tok: 'range', mut: (s, mt) => { s.leaf.next[mt.freeL[2]] = s.leaf.bump + 1; } },
  { name: 'I-7 live-free: live leaf on free list', code: 'I-7', tok: 'live-free', mut: (s, mt) => { const e = mt.v[2].leaves[4].id; s.leaf.next[e] = s.leaf.free; s.leaf.free = e; } },
  { name: 'I-7 live-free: live internal on free list', code: 'I-7', tok: 'live-free', mut: (s, mt) => { const e = mt.v[2].ints[3]; s.int.next[e] = s.int.free; s.int.free = e; } },
  { name: 'I-7 leak: leaf dropped from free list', code: 'I-7', tok: 'leak', mut: (s, mt) => { s.leaf.free = mt.freeL[1]; } },
  { name: 'I-7 leak: internal dropped from free list', code: 'I-7', tok: 'leak', mut: (s, mt) => { s.int.free = mt.freeI[1]; } },
  { name: 'I-7 leak: leaf bump raised', code: 'I-7', tok: 'leak', mut: (s) => { s.leaf.bump += 1; } },
  { name: 'I-7 hdr: live off by one', code: 'I-7', tok: 'hdr', mut: (s) => { s.live += 1; } },
  { name: 'I-7 hdr: live > C (sum of _len agrees)', code: 'I-7', tok: 'hdr', make: () => build({ B: 4, dims: 1, C: 4, views: [N(L(E(0, 4, 1)), L(E(4, 1, 1)))], finger: [null] }) },
  // ---- I-8
  { name: 'I-8 stack: fpath one short of H(Lmax)', code: 'I-8', tok: 'stack', mut: (s) => { s.views[0]._fpath = new Int32Array(s.views[0]._fpath.length - 1); } },
  { name: 'I-8 stack: fpath one long', code: 'I-8', tok: 'stack', mut: (s) => { s.views[0]._fpath = new Int32Array(s.views[0]._fpath.length + 1); } },
  { name: 'I-8 height: left chain of 5 leaves (4 > H(5) = 3)', code: 'I-8', tok: 'height', make: () => fiveLeaves((l) => N(N(N(N(l[0], l[1]), l[2]), l[3]), l[4]), [8, 8, 8, 8, 8]) },
  { name: 'I-8 leaves: 2 leaves, n = 2 (floor(2/2) = 1 < 2)', code: 'I-8', tok: 'leaves', make: () => sparseLeafSnap([1, 1]) },
  // ---- I-1
  { name: 'I-1 balance: 1 leaf vs 4 leaves (3 < 4)', code: 'I-1', tok: 'balance', make: () => fiveLeaves((l) => N(l[0], N(N(l[1], l[2]), N(l[3], l[4]))), [8, 8, 8, 8, 8]) },
  { name: 'I-1 weight: one stored weight + 1', code: 'I-1', tok: 'weight', mut: (s, mt) => { s.int.weight[mt.v[2].ints[3]] += 1; } },
  // ---- I-2
  { name: 'I-2 count: one count + 1', code: 'I-2', tok: 'count', mut: (s, mt) => { s.int.count[mt.v[2].ints[3]] += 1; } },
  { name: 'I-2 sum: one dim-1 sum + 1', code: 'I-2', tok: 'sum', mut: (s, mt) => { s.int.sum[1][mt.v[2].ints[3]] += 1; } },
  { name: 'I-2 len: view _len and header live both + 1', code: 'I-2', tok: 'len', make: () => base(24), mut: (s) => { s.views[1]._len += 1; s.live += 1; } },
  { name: 'I-2 empty: empty view claims _len 1', code: 'I-2', tok: 'empty', make: () => base(24), mut: (s) => { s.views[0]._len = 1; s.live += 1; } },
  // ---- I-3
  { name: 'I-3 measure: -0 at a live slot', code: 'I-3', tok: 'measure', mut: (s, mt) => { s.leaf.meas[0][mt.v[1].leaves[0].id * 8] = -0; } },
  { name: 'I-3 total: two 2^52 in one B=16 leaf', code: 'I-3', tok: 'total', make: totalSnap },
  { name: 'I-3 entity: 2^30 (> 2^30 - 1)', code: 'I-3', tok: 'entity', mut: (s, mt) => { s.leaf.ent[mt.v[1].leaves[0].id * 8] = 2 ** 30; } },
  // ---- I-5
  { name: 'I-5 leaf: leaves 1 | 8 at m = 2', code: 'I-5', tok: 'leaf', make: () => sparseLeafSnap([1, 8]) },
  { name: 'I-5 leaf: leaves 0 | 8', code: 'I-5', tok: 'leaf', make: () => sparseLeafSnap([0, 8]) },
  // ---- finger
  { name: 'I-9a empty-fl: empty view with a leaf ref', code: 'I-9a', tok: 'empty-fl', mut: (s, mt) => { s.views[0]._fl = ~mt.v[1].leaves[0].id; } },
  { name: 'XG-1 range: _fl beyond pool', code: 'XG-1', tok: 'range', mut: (s) => { s.views[1]._fl = ~s.leaf.size; } },
  { name: 'XG-1 range: _fl positive non-NIL', code: 'XG-1', tok: 'range', mut: (s) => { s.views[1]._fl = 5; } },
  { name: 'XG-1 freed: _fl on the free list', code: 'XG-1', tok: 'freed', mut: (s, mt) => { s.views[1]._fl = ~mt.freeL[1]; } },
  { name: 'XG-1 freed: _fl id above bump', code: 'XG-1', tok: 'freed', mut: (s) => { s.views[1]._fl = ~s.leaf.bump; } },
  { name: 'XG-1 foreign: _fl live in another view', code: 'XG-1', tok: 'foreign', mut: (s, mt) => { s.views[1]._fl = ~mt.v[2].leaves[3].id; } },
  { name: 'I-9c fb: off by one', code: 'I-9c', tok: 'fb', mut: (s) => { s.views[2]._fb += 1; } },
  { name: 'I-9d depth: truth + 1', code: 'I-9d', tok: 'depth', mut: (s) => { s.views[2]._fdepth += 1; } },
  { name: 'I-9e path: middle entry is another live node', code: 'I-9e', tok: 'path', mut: (s, mt) => { s.views[2]._fpath[1] = mt.v[2].ints[1]; } },
  { name: 'I-9e path: last entry is another live node', code: 'I-9e', tok: 'path', mut: (s, mt) => { s.views[2]._fpath[2] = mt.v[2].ints[2]; } },
];

function makeRow(row) {
  const { snap, meta } = row.make ? row.make() : base();
  if (row.mut) row.mut(snap, meta);
  return snap;
}

function runRows(walker) {
  const bad = [];
  for (const row of rows) {
    const s = makeRow(row);
    if (!agrees(walker, s, optsOf(s), row.code, row.tok)) bad.push(row.name);
  }
  return bad;
}

test('W-3: single-field corruption table gives the exact code and token', () => {
  assert.ok(rows.length >= 40, 'coverage floor ' + rows.length);
  const names = new Set(rows.map((r) => r.name));
  assert.equal(names.size, rows.length, 'row names unique');
  const { snap } = base();
  assert.equal(walk(snap, optsOf(snap)), null, 'the uncorrupted base is clean');
  for (const row of rows) {
    const s = makeRow(row);
    expectFail(s, row.code, row.tok, row.name);
  }
  // every non-SNAP code in CODES is hit by at least one row
  const hit = new Set(rows.map((r) => r.code));
  for (const c of CODES) assert.ok(hit.has(c), 'no row for ' + c);
});

// ---------------------------------------------------------------- W-4 SNAP fail-closed

test('W-4: SNAP fail-closed, never throws', () => {
  const cases = [
    ['null', () => [null, { B: 8, dims: 2 }]],
    ['undefined', () => [undefined, { B: 8, dims: 2 }]],
    ['{}', () => [{}, { B: 8, dims: 2 }]],
    ['array', () => [[], { B: 8, dims: 2 }]],
    ['missing views', () => { const s = base().snap; delete s.views; return [s, optsOf(s)]; }],
    ['empty views', () => { const s = base().snap; s.views = []; return [s, optsOf(s)]; }],
    ['sum wrong class', () => { const s = base().snap; s.int.sum[0] = new Float32Array(s.int.size); return [s, optsOf(s)]; }],
    ['sum wrong length', () => { const s = base().snap; s.int.sum[1] = new Float64Array(s.int.size + 1); return [s, optsOf(s)]; }],
    ['sum has dims+1 entries', () => { const s = base().snap; s.int.sum.push(new Float64Array(s.int.size)); return [s, optsOf(s)]; }],
    ['meas has dims-1 entries', () => { const s = base().snap; s.leaf.meas.pop(); return [s, optsOf(s)]; }],
    ['opts.B mismatch', () => { const s = base().snap; return [s, { B: 16, dims: s.dims }]; }],
    ['opts.dims mismatch', () => { const s = base().snap; return [s, { B: s.B, dims: 1 }]; }],
    ['opts null', () => { const s = base().snap; return [s, null]; }],
    ['_cv = 1', () => { const s = base().snap; s.views[0]._cv = 1; return [s, optsOf(s)]; }],
    ['EMPTY_ROOT = 0', () => { const s = base().snap; s.EMPTY_ROOT = 0; return [s, optsOf(s)]; }],
    ['_fpath plain array', () => { const s = base().snap; s.views[2]._fpath = Array.from(s.views[2]._fpath); return [s, optsOf(s)]; }],
    ['B = 5', () => { const s = base().snap; s.B = 5; return [s, { B: 5, dims: s.dims }]; }],
    ['dims = 5', () => { const s = base().snap; s.dims = 5; return [s, { B: s.B, dims: 5 }]; }],
    ['dims = 0', () => { const s = base().snap; s.dims = 0; return [s, { B: s.B, dims: 0 }]; }],
    ['int.size is a string', () => { const s = base().snap; s.int.size = String(s.int.size); return [s, optsOf(s)]; }],
    ['live NaN', () => { const s = base().snap; s.live = NaN; return [s, optsOf(s)]; }],
    ['NIL is a valid leaf ref (~0)', () => { const s = base().snap; s.NIL = ~0; return [s, optsOf(s)]; }],
    ['EMPTY_ROOT is a valid internal id', () => { const s = base().snap; s.EMPTY_ROOT = 1; return [s, optsOf(s)]; }],
    ['EMPTY_ROOT is a valid leaf ref', () => { const s = base().snap; s.EMPTY_ROOT = ~1; return [s, optsOf(s)]; }],
  ];
  for (const [name, mk] of cases) {
    const [s, o] = mk();
    let r;
    assert.doesNotThrow(() => { r = walk(s, o); }, name + ' threw');
    assert.ok(r !== null && typeof r === 'object', name + ': expected a failure object');
    assert.equal(r.code, 'SNAP', name + ': ' + (r && r.detail));
    assert.ok(tokOk(r, 'snap'), name + ': detail ' + r.detail);
    assert.ok(!r.detail.includes('exception'), name + ': SNAP came from an exception, not a contract check: ' + r.detail);
  }
});

// ---------------------------------------------------------------- W-5 order

test('W-5: first failure wins -- I-1 over I-5, I-7 over I-9c, I-8 over I-1', () => {
  // 5 leaves, root = (a, ((b,c),(d,e))): a has 1 leaf vs 4 (I-1), a has len 1 < m = 2 (I-5).
  // n = 1 + 4*8 = 33, L = 5 <= floor(33/2) so I-8 passes.
  let r = (() => {
    const { snap } = fiveLeaves((l) => N(l[0], N(N(l[1], l[2]), N(l[3], l[4]))), [1, 8, 8, 8, 8]);
    return walk(snap, optsOf(snap));
  })();
  assert.equal(r.code, 'I-1'); assert.ok(tokOk(r, 'balance'));
  // I-7 (header live off) AND I-9c (fb wrong)
  const { snap: s2 } = base();
  s2.live += 1; s2.views[2]._fb += 1;
  r = walk(s2, optsOf(s2));
  assert.equal(r.code, 'I-7'); assert.ok(tokOk(r, 'hdr'));
  // I-8 (height of the chain) AND I-1 (the chain is unbalanced)
  const { snap: s3 } = fiveLeaves((l) => N(N(N(N(l[0], l[1]), l[2]), l[3]), l[4]), [8, 8, 8, 8, 8]);
  r = walk(s3, optsOf(s3));
  assert.equal(r.code, 'I-8');
  // I-2 AND I-9d: the earlier I-2 wins
  const { snap: s4, meta: m4 } = base();
  s4.int.count[m4.v[2].ints[1]] += 1; s4.views[2]._fdepth += 1;
  r = walk(s4, optsOf(s4));
  assert.equal(r.code, 'I-2');
  // I-9c AND I-9e in one view: I-9c first
  const { snap: s5, meta: m5 } = base();
  s5.views[2]._fb += 1; s5.views[2]._fpath[1] = m5.v[2].ints[1];
  r = walk(s5, optsOf(s5));
  assert.equal(r.code, 'I-9c');
  // two views broken: view order. v1 gets 'foreign', v2 gets 'fb' -> v1 first
  const { snap: s6, meta: m6 } = base();
  s6.views[1]._fl = ~m6.v[2].leaves[3].id; s6.views[2]._fb += 1;
  r = walk(s6, optsOf(s6));
  assert.equal(r.code, 'XG-1');
});

// ---------------------------------------------------------------- W-6 M-1 separation

function m1Snap() {
  // B=4 (m=1): root = (leaf of 4 elements, subtree of 4 one-element leaves); n = 8, L = 5.
  const D = 1;
  return build({
    B: 4, dims: D,
    views: [N(L(E(0, 4, D)), N(N(L(E(4, 1, D)), L(E(5, 1, D))), N(L(E(6, 1, D)), L(E(7, 1, D)))))],
    finger: [null],
  });
}

test('W-6: M-1 shape reports balance (recount) before weight; stored-weight off reports weight', () => {
  const { snap, meta } = m1Snap();
  assert.equal(walk(snap, optsOf(snap)) && walk(snap, optsOf(snap)).code, 'I-1');
  assert.ok(tokOk(walk(snap, optsOf(snap)), 'balance'), 'recounted leaf counts 1 vs 4');
  // element-count mutant: stored weights replaced by element counts (root 8 = 4 | 4)
  for (const id of meta.v[0].ints) snap.int.weight[id] = snap.int.count[id];
  const r = walk(snap, optsOf(snap));
  assert.equal(r.code, 'I-1');
  assert.ok(tokOk(r, 'balance'), 'detail ' + r.detail);
  // balanced shape, correct recount, one stored weight off -> 'weight'
  const { snap: s2, meta: m2 } = base();
  s2.int.weight[m2.v[2].root] += 1;
  const r2 = walk(s2, optsOf(s2));
  assert.equal(r2.code, 'I-1');
  assert.ok(tokOk(r2, 'weight'), 'detail ' + r2.detail);
  // and a stored weight that equals the element count on a balanced tree is also 'weight'
  const { snap: s3, meta: m3 } = base();
  s3.int.weight[m3.v[2].root] = s3.int.count[m3.v[2].root]; // 19 vs leaf count 5
  assert.ok(tokOk(walk(s3, optsOf(s3)), 'weight'));
  const ones = []; for (let i = 0; i < 8; i++) ones.push(L(E(8 + i, 1, 1)));
  const { snap: s4, meta: m4 } = build({ B: 4, dims: 1, views: [N(N(L(E(0, 4, 1)), L(E(4, 4, 1))), balancedTree(ones))], finger: [null] });
  for (const id of m4.v[0].ints) s4.int.weight[id] = s4.int.count[id] + 1;
  assert.ok(tokOk(walk(s4, optsOf(s4)), 'balance'), 'balance must use the recount, not stored weights');
});

// ---------------------------------------------------------------- W-7 purity

test('W-7: walk does not mutate the snapshot and is deterministic', () => {
  const subjects = [];
  subjects.push(base().snap, m1Snap().snap, ...rows.slice(0, 12).map(makeRow));
  for (const s of fixtures()) subjects.push(s.snap);
  for (const s of subjects) {
    const before = structuredClone(s);
    const a = walk(s, optsOf(s));
    const b = walk(s, optsOf(s));
    assert.deepEqual(s, before, 'snapshot mutated');
    assert.deepEqual(a, b, 'two calls differ');
  }
});

// ---------------------------------------------------------------- W-8 cyclic child graph

test('W-8: a child edge to an ancestor terminates and reports I-7', () => {
  for (const pick of [
    (mt) => [mt.v[2].ints[1], mt.v[2].root],            // child of the root points at the root
    (mt) => [mt.v[2].ints[3], mt.v[2].ints[2]],         // grandchild points at its parent
    (mt) => [mt.v[2].ints[3], mt.v[2].ints[3]],         // self edge
  ]) {
    const { snap, meta } = base();
    const [node, target] = pick(meta);
    snap.int.left[node] = target;
    const r = walk(snap, optsOf(snap));
    assert.ok(r !== null, 'accepted a cyclic graph');
    assert.equal(r.code, 'I-7', r.detail);
  }
});

// ---------------------------------------------------------------- W-9 CODES

test('W-9: CODES is frozen, ordered, and excludes I-4 / I-6 / I-9b', () => {
  assert.ok(Object.isFrozen(CODES));
  assert.deepEqual([...CODES], ['SNAP', 'I-7', 'I-8', 'I-1', 'I-2', 'I-3', 'I-5', 'I-9a', 'XG-1', 'I-9c', 'I-9d', 'I-9e']);
  assert.equal(CODES.length, 12);
  for (const x of ['I-4', 'I-6', 'I-9b']) assert.ok(!CODES.includes(x), x);
  assert.throws(() => { 'use strict'; CODES.push('X'); });
});

// ---------------------------------------------------------------- W-10 NIL tolerance

test('W-10: _fl === NIL on a non-empty view ignores _fb / _fdepth / _fpath; NIL value does not matter', () => {
  for (const nil of [0, 0x7fffffff]) {
    const { snap } = build({
      B: 8, dims: 2, nil,
      views: [null, L(E(0, 3, 2)), N(L(E(10, 3, 2)), L(E(20, 4, 2)))], finger: [null, null, null],
      freeLeaf: 1,
    });
    assert.equal(snap.views[1]._fl, nil);
    assert.equal(walk(snap, optsOf(snap)), null, 'clean, NIL ' + nil);
    for (const v of snap.views) { v._fb = 777; v._fdepth = -3; v._fpath.fill(-99); }
    assert.equal(walk(snap, optsOf(snap)), null, 'garbage finger fields, NIL ' + nil);
    // an I-9c failure is identical for either NIL: finger set on v2, fb wrong
    const { snap: s2 } = build({
      B: 8, dims: 2, nil,
      views: [null, L(E(0, 3, 2)), N(L(E(10, 3, 2)), L(E(20, 4, 2)))], finger: [null, null, 1],
      freeLeaf: 1,
    });
    assert.equal(walk(s2, optsOf(s2)), null);
    s2.views[2]._fb += 1;
    const r = walk(s2, optsOf(s2));
    assert.equal(r.code, 'I-9c'); assert.ok(tokOk(r, 'fb'));
    // and an unrelated I-2 failure is identical too
    s2.views[2]._fb -= 1;
    s2.int.count[0] += 1;
    assert.equal(walk(s2, optsOf(s2)).code, 'I-2');
  }
  // NIL = 0 as a view's _fl on an EMPTY view is also fine (I-9a needs _fl !== NIL to fire)
  const { snap } = base();
  assert.equal(snap.views[0]._fl, snap.NIL);
  assert.equal(walk(snap, optsOf(snap)), null);
});

// ---------------------------------------------------------------- W-1 fixtures

const REQUIRED = [
  ['I-1', 'balance'], ['I-2', 'count'], ['I-2', 'sum'], ['I-3', 'measure'], ['I-3', 'total'],
  ['I-5', 'leaf'], ['I-7', 'dup'], ['I-7', 'live-free'], ['I-7', 'leak'], ['I-7', 'cycle'],
  ['I-8', 'stack'], ['I-9a', 'empty-fl'], ['XG-1', 'freed'], ['XG-1', 'foreign'],
  ['I-9c', 'fb'], ['I-9d', 'depth'], ['I-9e', 'path'],
];

function runFixtures(walker, fx) {
  const bad = [];
  for (const f of fx) if (!agrees(walker, f.snap, f.opts, f.expect, f.token)) bad.push(f.name);
  return bad;
}

test('W-1: every snapshots.mjs fixture gives its expected result; required set present', () => {
  const fx = fixtures();
  assert.ok(Array.isArray(fx) && fx.length >= 24, 'fixture count ' + fx.length);
  assert.equal(new Set(fx.map((f) => f.name)).size, fx.length, 'names unique');
  for (const f of fx) {
    assert.equal(typeof f.name, 'string');
    assert.ok(f.expect === null || CODES.includes(f.expect), f.name + ': expect');
    assert.ok(f.expect === null ? f.token === null : typeof f.token === 'string', f.name + ': token');
    assert.equal(f.opts.B, f.snap.B, f.name); assert.equal(f.opts.dims, f.snap.dims, f.name);
    const r = walk(f.snap, f.opts);
    if (f.expect === null) {
      assert.equal(r, null, f.name + ': ' + (r && r.detail));
    } else {
      assert.ok(r !== null, f.name + ': accepted');
      assert.equal(r.code, f.expect, f.name + ': ' + r.detail);
      assert.ok(typeof r.detail === 'string' && r.detail.startsWith(f.token), f.name + ': ' + r.detail);
    }
  }
  assert.ok(fx.filter((f) => f.expect === null).length >= 7, 'at least 7 clean fixtures');
  for (const [code, tok] of REQUIRED) {
    assert.ok(fx.some((f) => f.expect === code && f.token === tok), 'missing fixture ' + code + ' ' + tok);
  }
  // I-7 cases on both pools: at least two fixtures each for leak / live-free (leaf + internal)
  for (const tok of ['dup', 'live-free', 'leak', 'cycle']) {
    assert.ok(fx.filter((f) => f.expect === 'I-7' && f.token === tok).length >= 2, 'both pools for ' + tok);
  }
});

test('W-1: fixtures() returns fresh objects each call', () => {
  const a = fixtures(), b = fixtures();
  assert.notEqual(a, b);
  assert.equal(a.length, b.length);
  for (let i = 0; i < a.length; i++) {
    assert.notEqual(a[i], b[i]); assert.notEqual(a[i].snap, b[i].snap);
    assert.notEqual(a[i].snap.int, b[i].snap.int); assert.notEqual(a[i].snap.leaf.ent, b[i].snap.leaf.ent);
    assert.equal(a[i].name, b[i].name);
  }
  a[0].snap.live += 5; a[0].name = 'x';
  assert.notEqual(b[0].snap.live, a[0].snap.live);
});

// ---------------------------------------------------------------- W-11 retention identity

// Own traversal over a fixture snapshot (iterative), own free-list walk.
function census(s) {
  const liveLeaf = new Set(), liveInt = new Set();
  let sumLm1 = 0;
  for (const v of s.views) {
    if (v._len === 0) continue;
    const st = [v._root];
    let leaves = 0;
    while (st.length) {
      const r = st.pop();
      if (r < 0) { liveLeaf.add(~r); leaves++; } else { liveInt.add(r); st.push(s.int.left[r], s.int.right[r]); }
    }
    sumLm1 += leaves - 1;
  }
  const freeOf = (p) => { const out = []; for (let i = p.free, n = 0; i >= 0 && n <= p.size; i = p.next[i], n++) out.push(i); return out; };
  return { liveLeaf, liveInt, freeLeaf: freeOf(s.leaf), freeInt: freeOf(s.int), sumLm1 };
}

test('W-11: retention identity holds on every clean fixture (recomputed here)', () => {
  let clean = 0;
  for (const f of fixtures()) {
    if (f.expect !== null) continue;
    clean++;
    const s = f.snap, c = census(s);
    assert.equal(c.liveLeaf.size + c.freeLeaf.length + (s.leaf.size - s.leaf.bump), s.leaf.size, f.name + ' leaf pool');
    assert.equal(c.liveInt.size + c.freeInt.length + (s.int.size - s.int.bump), s.int.size, f.name + ' int pool');
    assert.equal(c.liveInt.size, c.sumLm1, f.name + ' internal live == sum (L_s - 1)');
  }
  assert.ok(clean >= 7, 'clean fixtures seen: ' + clean);
  // same identity on this file's own builder output
  for (const row of cleanMatrix) {
    const { snap: s } = build(row.o), c = census(s);
    assert.equal(c.liveLeaf.size + c.freeLeaf.length + (s.leaf.size - s.leaf.bump), s.leaf.size, row.name);
    assert.equal(c.liveInt.size, c.sumLm1, row.name);
  }
});

// ---------------------------------------------------------------- W-12 static gates

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:'"\\])\/\/[^\n]*/g, '$1');
}
function importSpecifiers(src) {
  const code = stripComments(src);
  const out = [];
  const re = /\bimport\s*(?:[^'";()]*?\bfrom\s*)?['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(code))) out.push(m[1]);
  if (/\bimport\s*\(/.test(code) || /\brequire\s*\(/.test(code)) out.push('<dynamic>');
  return out;
}
// names of `function name(` declarations whose own body calls `name(`
function selfRecursive(src) {
  const code = stripComments(src).replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, '""');
  const hits = [];
  const re = /\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g;
  let m;
  while ((m = re.exec(code))) {
    const name = m[1];
    let i = m.index + m[0].length, depth = 1;
    while (i < code.length && depth > 0) { if (code[i] === '(') depth++; else if (code[i] === ')') depth--; i++; }
    const open = code.indexOf('{', i);
    if (open < 0) continue;
    let j = open + 1, d = 1;
    while (j < code.length && d > 0) { if (code[j] === '{') d++; else if (code[j] === '}') d--; j++; }
    const body = code.slice(open, j);
    if (new RegExp('(^|[^\\w$.])' + name.replace(/\$/g, '\\$') + '\\s*\\(').test(body)) hits.push(name);
  }
  return hits;
}

const read = (f) => readFileSync(new URL(f, import.meta.url), 'utf8');

test('W-12: walker.mjs imports only ./spec-counts.mjs, has no self-recursion, is ASCII', () => {
  const src = read('./walker.mjs');
  assert.deepEqual(importSpecifiers(src), ['./spec-counts.mjs']);
  assert.deepEqual(selfRecursive(src), [], 'self-recursive function(s)');
  assert.ok(/^[\x00-\x7F]*$/.test(src), 'non-ASCII byte in walker.mjs');
  assert.ok(/function\s+walk\s*\(/.test(src), 'sanity: the scan sees walk()');
  assert.ok(!/=>/.test(stripComments(src)), 'walker.mjs has an arrow function (the self-call scan only sees function declarations)');
});

test('W-12: snapshots.mjs imports only ./spec-counts.mjs (never walker) and is ASCII', () => {
  const src = read('./snapshots.mjs');
  const specs = importSpecifiers(src);
  assert.ok(!specs.some((x) => x.includes('walker')), 'imports walker');
  assert.deepEqual(specs.filter((x) => x !== './spec-counts.mjs'), []);
  assert.ok(/^[\x00-\x7F]*$/.test(src), 'non-ASCII byte in snapshots.mjs');
});

test('W-12 control: the scanners catch recursion and stray imports in synthetic sources', () => {
  assert.deepEqual(selfRecursive('function f(x) { return x ? f(x - 1) : 0; }'), ['f']);
  assert.deepEqual(selfRecursive('function g(x) { while (x) x--; return h(x); }\nfunction h(y) { return y; }'), []);
  assert.deepEqual(selfRecursive('function g(x) { return o.g(x); }'), [], 'method call is not recursion');
  assert.deepEqual(importSpecifiers("import { H } from './spec-counts.mjs';\nimport x from './walker.mjs';"), ['./spec-counts.mjs', './walker.mjs']);
  assert.deepEqual(importSpecifiers("import 'node:fs';"), ['node:fs']);
  assert.deepEqual(importSpecifiers("// import a from 'b'\nconst z = 1;"), []);
  assert.deepEqual(importSpecifiers("const q = await import('x');"), ['<dynamic>']);
});

// ---------------------------------------------------------------- controls (teeth)

const alwaysNull = () => null;
// stands in for a walker that skips the I-1 recount: hides every I-1 result
const skipI1 = (s, o) => { const r = walk(s, o); return r !== null && r.code === 'I-1' ? null : r; };
// stands in for a walker that swallows the finger checks
const skipFinger = (s, o) => { const r = walk(s, o); return r !== null && /^(I-9|XG)/.test(r.code) ? null : r; };

test('controls: the W-3 table has teeth (stub walkers produce mismatches, the real one none)', () => {
  assert.deepEqual(runRows(walk), []);
  const n = runRows(alwaysNull);
  assert.equal(n.length, rows.length, 'always-null walker must miss every row');
  const i1 = runRows(skipI1);
  assert.ok(i1.length >= 2 && i1.every((nm) => nm.startsWith('I-1')), 'skip-I-1 stub misses the I-1 rows: ' + i1.join('; '));
  assert.ok(runRows(skipFinger).length >= 8, 'skip-finger stub caught by the finger rows');
  // a walker that always reports a fixed failure also mismatches
  assert.ok(runRows(() => ({ code: 'I-7', detail: 'leak' })).length >= rows.length - 8);
});

test('controls: the W-1 fixture table has teeth', () => {
  const fx = fixtures();
  assert.deepEqual(runFixtures(walk, fx), []);
  const nulls = runFixtures(alwaysNull, fx);
  assert.equal(nulls.length, fx.filter((f) => f.expect !== null).length, 'always-null misses every failing fixture');
  assert.ok(runFixtures(skipI1, fx).length >= 1, 'skip-I-1 stub misses the balance fixture');
  // and a walker that rejects everything mismatches every clean fixture
  const rej = runFixtures(() => ({ code: 'SNAP', detail: 'snap' }), fx);
  assert.ok(rej.length >= fx.filter((f) => f.expect === null).length);
});
