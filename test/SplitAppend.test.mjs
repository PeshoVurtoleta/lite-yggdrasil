// test/SplitAppend.test.mjs -- rung 5 (S-R1). Section 1: clear() free-walk. ADR 0004 A-6 (clear: O(1) reset only
// when no other view holds a node, else a free-walk of this view's nodes), 0005 C-8 (clear keeps _n; the cleared view
// is the constructed state), C-15 (pools sized for count), C-25 (clear writes no counter), C-28 (walker I-7 census,
// I-9 finger). Section 2 (rung 6 S-R2, append: join + seam repair) is appended below the section-1 rows; section 3
// (rung 7 S-R3, splitAt: cut + joins + repair) follows section 2.
//
// Oracle independence: expected values come from the spec text, never from the engine's clear. The model is
// test/oracle.mjs (plain arrays); the pool census is this file's own traversal of an adapter snapshot (leaf count L_s,
// internal count L_s - 1, free-list lengths by walking the stored chain). The fresh header / NIL / EMPTY_ROOT are read
// from a FRESH arena of the same shape, never hardcoded. Seeded xorshift32 (C-34), independent key / value / op
// streams.
//
// MIT (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>. ASCII only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SumSequence } from '../Yggdrasil.js';
import { engineFactory } from './adapter.mjs';
import { walk } from './walker.mjs';
import { Oracle } from './oracle.mjs';
import { buildMutant } from './mutant-build.mjs';
import { synthStub } from './stubs.mjs';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'Yggdrasil.js');
const NC = 12;

// 32-bit xorshift (C-34): x^=x<<13; x^=x>>>17; x^=x<<5; x>>>0.
function xs(seed) {
  let x = seed >>> 0;
  if (x === 0) x = 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x; };
}

// ---- ANCHORS (mutant rows). Filled by the orchestrator after the coder lands; a null anchor FAILS its row. ----
// ms1: [[anchor, replacement, 1], ...] for buildMutant -- clear() does the O(1) pool reset while another view is live.
// ms2: [[anchor, replacement, 1], ...] -- the ctor path and the arena path build different hidden classes.
const ANCHORS = {
  ms1: [['    else if (this._len !== 0) ygClearWalk(this);', '    else if (this._len !== 0) ygReset(hdr);', 1]],
  ms2: [['    const fpath = new Int32Array(ar.HL);', '    if (ygPend === null) this._len = 0;\n    const fpath = new Int32Array(ar.HL);', 1]],
  msg: [['function ygClearRef(ref, lb, ib, what) {', 'function ygClearRef(ref, lb, ib, what) {\n  return;', 1]], // MS-G: root + child range checks removed
};

// ---- snapshot traversal (own code, not the engine's) ----

function freeLen(next, head) {
  let c = 0;
  for (let f = head; f !== -1 && c < 100000; f = next[f]) c++;
  return c;
}

// {leaves, ints, height} of view vi in snapshot s; height counts nodes on the longest root-to-leaf path.
function shapeOf(s, vi) {
  const vw = s.views[vi];
  if (vw._len === 0) return { leaves: 0, ints: 0, height: 0 };
  let leaves = 0;
  let ints = 0;
  let height = 0;
  const st = [[vw._root, 1]];
  while (st.length) {
    const [r, h] = st.pop();
    if (r < 0) { leaves++; if (h > height) height = h; } else {
      ints++;
      st.push([s.int.left[r], h + 1]);
      st.push([s.int.right[r], h + 1]);
    }
  }
  return { leaves, ints, height };
}

function answers(v, dims) {
  const out = [];
  for (let i = 0; i < v.length; i++) {
    out.push(v.entityAt(i));
    for (let d = 0; d < dims; d++) out.push(v.getMeasure(i, d));
  }
  for (let d = 0; d < dims; d++) out.push(v.total(d));
  return out;
}

function oracleAnswers(o, dims) {
  const out = [];
  for (let i = 0; i < o.length; i++) {
    out.push(o.entityAt(i));
    for (let d = 0; d < dims; d++) out.push(o.getMeasure(i, d));
  }
  for (let d = 0; d < dims; d++) out.push(o.total(d));
  return out;
}

const json = (x) => JSON.stringify(x, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v));

// ---- arena builder ----
// shapes[v] in 'E' (empty), 'O' (one leaf), 'M' (multi leaf, >= 3 levels). Fill is round-robin, one element per view
// per round at a random position, so the views' node ids interleave in the pools.
function sizeOf(shape, B) {
  return shape === 'E' ? 0 : shape === 'O' ? (B >> 1) + 1 : 8 * B;
}

function build(B, dims, shapes, seed) {
  const k = shapes.length;
  let tot = 0;
  for (let j = 0; j < k; j++) tot += sizeOf(shapes[j], B);
  const C = tot + 8;
  const o = { leafSize: B, dims };
  const f = engineFactory(C, o, k);
  const fresh = engineFactory(C, o, k);
  const fs = fresh.snapshot();
  const ctx = {
    B, dims, k, C, f, views: f.views, orc: [],
    NIL: fs.NIL, ER: fs.EMPTY_ROOT, freshHdr: Array.from(fresh.views[0]._hdr),
    walkOpts: { B, dims },
  };
  for (let j = 0; j < k; j++) ctx.orc.push(new Oracle(dims));
  const key = xs(0x9E3779B9 ^ (seed * 2654435761));
  const val = xs(0x85EBCA6B ^ (seed * 40503 + 7));
  const want = shapes.map((s) => sizeOf(s, B));
  let left = tot;
  while (left > 0) {
    for (let j = 0; j < k; j++) {
      if (want[j] === 0) continue;
      want[j]--;
      left--;
      const v = ctx.views[j];
      const at = key() % (v.length + 1);
      const e = val() & 0xFFFF;
      const m0 = val() % 1000;
      const m1 = val() % 1000;
      if (dims === 1) { v.insertAt(at, e, m0); ctx.orc[j].insertAt(at, e, m0); } else { v.insertAt(at, e, m0, m1); ctx.orc[j].insertAt(at, e, m0, m1); }
    }
  }
  const s = f.snapshot();
  for (let j = 0; j < k; j++) {
    const sh = shapeOf(s, j);
    if (shapes[j] === 'E') assert.equal(v_len(ctx, j), 0, 'build E');
    if (shapes[j] === 'O') assert.ok(s.views[j]._root < 0 && sh.leaves === 1, 'build O: root must be a leaf ref');
    if (shapes[j] === 'M') assert.ok(sh.height >= 3 && sh.leaves >= 3, 'build M: >= 3 levels, got ' + json(sh));
  }
  return ctx;
}
function v_len(ctx, j) { return ctx.views[j].length; }

function walkOk(ctx, tag) {
  const r = walk(ctx.f.snapshot(), ctx.walkOpts);
  assert.equal(r, null, tag + ': walker ' + (r && r.code + ' ' + r.detail));
}

function checkAgainstOracle(ctx, j, tag) {
  assert.deepEqual(answers(ctx.views[j], ctx.dims), oracleAnswers(ctx.orc[j], ctx.dims), tag + ': view ' + j + ' vs oracle');
}

// Clear view t and assert the whole C-8 / C-25 / A-6 surface. Returns 'G1' | 'G2' | 'G3'.
function clearAndCheck(ctx, t, tag) {
  const { views, k, dims } = ctx;
  const v = views[t];
  const n = v.length;
  let others = 0;
  for (let j = 0; j < k; j++) if (j !== t) others += views[j].length;
  const guard = n === 0 ? 'G1' : others === 0 ? 'G2' : 'G3';
  // finger: a positional op on a non-empty target so the NIL after the clear is a real write
  if (n > 0) {
    v.getMeasure(n >> 1, 0);
    assert.notEqual(v._fl, ctx.NIL, tag + ': precondition, finger set');
  }
  const ansPre = views.map((w) => json(answers(w, dims))); // reads move fingers: take them BEFORE the snapshot
  const pre = ctx.f.snapshot();
  const sh = shapeOf(pre, t);
  const cn = views.map((w) => { const a = new Int32Array(NC); w.readCounters(a); return Array.from(a); });
  const preHdr = Array.from(views[0]._hdr);
  views[t].clear();
  const post = ctx.f.snapshot();
  const where = tag + ' [' + guard + ' t=' + t + ' n=' + n + ']';
  // the cleared view is the constructed state
  assert.equal(v._len, 0, where + ' _len');
  assert.equal(v._root, ctx.ER, where + ' _root');
  assert.equal(v._fl, ctx.NIL, where + ' _fl');
  assert.equal(v._fb, 0, where + ' _fb');
  assert.equal(v._fdepth, 0, where + ' _fdepth');
  assert.equal(v._cv, false, where + ' _cv');
  assert.equal(v.length, 0, where + ' length');
  // all 12 counters: delta 0 on every view (C-25 clear 0; C-8 keeps _n)
  for (let j = 0; j < k; j++) {
    const a = new Int32Array(NC);
    views[j].readCounters(a);
    assert.deepEqual(Array.from(a), cn[j], where + ' counters of view ' + j);
  }
  // other views: answers, snapshot fields, oracle
  ctx.orc[t].clear();
  for (let j = 0; j < k; j++) {
    assert.equal(json(answers(views[j], dims)), j === t ? json(answers(v, dims)) : ansPre[j], where + ' answers view ' + j);
    checkAgainstOracle(ctx, j, where);
    if (j !== t) assert.equal(json(post.views[j]), json(pre.views[j]), where + ' view ' + j + ' fields');
  }
  // pool census
  const hdr = Array.from(views[0]._hdr);
  assert.equal(hdr[0], preHdr[0] - n, where + ' live');
  if (guard !== 'G2') {
    assert.equal(hdr[1], preHdr[1], where + ' leaf bump unchanged');
    assert.equal(hdr[3], preHdr[3], where + ' int bump unchanged');
  }
  if (guard === 'G1') {
    assert.deepEqual(hdr, preHdr, where + ' G1 hdr unchanged');
    assert.equal(json(post.int) + json(post.leaf), json(pre.int) + json(pre.leaf), where + ' G1 no pool write');
  } else if (guard === 'G2') {
    assert.deepEqual(hdr, ctx.freshHdr, where + ' G2 hdr == fresh hdr');
  } else {
    assert.equal(freeLen(post.leaf.next, post.leaf.free), freeLen(pre.leaf.next, pre.leaf.free) + sh.leaves, where + ' leaf free list grows by L_s');
    assert.equal(freeLen(post.int.next, post.int.free), freeLen(pre.int.next, pre.int.free) + sh.leaves - 1, where + ' int free list grows by L_s - 1');
    assert.equal(sh.ints, sh.leaves - 1, where + ' census: a tree of L leaves has L - 1 internals');
  }
  const r = walk(post, ctx.walkOpts);
  assert.equal(r, null, where + ': walker ' + (r && r.code + ' ' + r.detail));
  return guard;
}

// ---- the grid: every guard side x shape x k x leafSize x dims ----

const SH = ['E', 'O', 'M'];

function tuples(k) {
  const out = [];
  const rec = (acc) => {
    if (acc.length === k) { out.push(acc.slice()); return; }
    for (const s of SH) { acc.push(s); rec(acc); acc.pop(); }
  };
  rec([]);
  return out;
}

for (const B of [4, 16]) {
  for (const dims of [1, 2]) {
    for (const k of [1, 2, 3]) {
      test('S-R1 clear grid: B=' + B + ' dims=' + dims + ' k=' + k + ' (every shape tuple x every target)', () => {
        const seen = { G1: 0, G2: 0, G3: 0 };
        let seed = 1;
        for (const shapes of tuples(k)) {
          for (let t = 0; t < k; t++) {
            const ctx = build(B, dims, shapes, seed++);
            const g = clearAndCheck(ctx, t, shapes.join('') + '/' + t);
            seen[g]++;
            // a second clear of the now-empty view is a G1 no-op
            assert.equal(clearAndCheck(ctx, t, shapes.join('') + '/' + t + ' again'), 'G1');
          }
        }
        assert.ok(seen.G1 >= 1 && seen.G2 >= 1, 'coverage: G1 / G2 reached');
        if (k >= 2) assert.ok(seen.G3 >= 3, 'coverage floor: G3 reached ' + seen.G3);
        else assert.equal(seen.G3, 0, 'k = 1: only G1 / G2 are reachable');
      });
    }
  }
}

// A G3 clear of one leaf / multi-leaf target with the OTHER view being one leaf / multi, named explicitly (the grid
// covers them; this row pins that the census numbers are the expected L_s / L_s - 1 for a hand-countable shape).
test('S-R1 census by hand: B=4, a 3-leaf view frees 3 leaves and 2 internals; the other view stays', () => {
  const f = engineFactory(32, { leafSize: 4, dims: 1 }, 2);
  const [a, b] = f.views;
  for (let j = 0; j < 4; j++) a.insertAt(j, j, 1); // 4 elements fit one leaf (B = 4), no split
  // b: 9 elements, split rule at B + 1 = 5: leaves are <= 4, so >= 3 leaves
  for (let j = 0; j < 9; j++) b.insertAt(j, 100 + j, 2);
  const pre = f.snapshot();
  const sh = shapeOf(pre, 1);
  assert.ok(sh.leaves >= 3, 'b has >= 3 leaves (9 elements, leaf cap 4)');
  const lf = freeLen(pre.leaf.next, pre.leaf.free);
  const inf = freeLen(pre.int.next, pre.int.free);
  b.clear();
  const post = f.snapshot();
  assert.equal(freeLen(post.leaf.next, post.leaf.free) - lf, sh.leaves);
  assert.equal(freeLen(post.int.next, post.int.free) - inf, sh.leaves - 1);
  assert.equal(post.live, 4);
  assert.equal(a.length, 4);
  assert.deepEqual(answers(a, 1), [0, 1, 1, 1, 2, 1, 3, 1, 4]);
});

// ---- last view clears: every clear order -> hdr == fresh ----

function perms(n) {
  const out = [];
  const rec = (acc, rest) => {
    if (rest.length === 0) { out.push(acc.slice()); return; }
    for (let j = 0; j < rest.length; j++) {
      acc.push(rest[j]);
      rec(acc, rest.slice(0, j).concat(rest.slice(j + 1)));
      acc.pop();
    }
  };
  rec([], Array.from({ length: n }, (_, i) => i));
  return out;
}

for (const B of [4, 16]) {
  for (const dims of [1, 2]) {
    test('S-R1 every clear order, k=3 (6 permutations) and k=2: B=' + B + ' dims=' + dims + ', last clear leaves hdr == fresh', () => {
      let orders = 0;
      for (const shapes of [['M', 'M', 'M'], ['M', 'O', 'M'], ['O', 'M', 'E'], ['M', 'E', 'O']]) {
        for (const order of perms(3)) {
          const ctx = build(B, dims, shapes, 77 + orders);
          for (let s = 0; s < 3; s++) clearAndCheck(ctx, order[s], shapes.join('') + ' order ' + order.join(''));
          assert.deepEqual(Array.from(ctx.views[0]._hdr), ctx.freshHdr, 'hdr == fresh after the last clear');
          for (let j = 0; j < 3; j++) assert.equal(ctx.views[j].length, 0);
          orders++;
        }
      }
      for (const order of [[0, 1], [1, 0]]) {
        const ctx = build(B, dims, ['M', 'M'], 5);
        for (const t of order) clearAndCheck(ctx, t, 'k2 order ' + order.join(''));
        assert.deepEqual(Array.from(ctx.views[0]._hdr), ctx.freshHdr, 'k = 2 hdr == fresh');
      }
      assert.equal(orders, 24, 'coverage: 4 shapes x 6 orders');
    });
  }
}

// ---- L2: refill after a G3 clear; freed ids are reusable ----

for (const B of [4, 16]) {
  for (const dims of [1, 2]) {
    test('S-R1 L2 refill after a G3 clear: B=' + B + ' dims=' + dims, () => {
      let cleared = 0;
      for (const k of [2, 3]) {
        for (let t = 0; t < k; t++) {
          const shapes = new Array(k).fill('M');
          const ctx = build(B, dims, shapes, 300 + k * 10 + t);
          const old = ctx.views[t].length;
          const liveBefore = ctx.views[0]._hdr[0];
          assert.equal(clearAndCheck(ctx, t, 'L2 clear'), 'G3');
          cleared++;
          const others = ctx.views.map((w) => json(answers(w, dims)));
          const key = xs(4242 + t);
          const val = xs(9191 + t);
          const v = ctx.views[t];
          for (let j = 0; j < old; j++) {
            const at = key() % (v.length + 1);
            const e = val() & 0xFFFF;
            const m0 = val() % 1000;
            const m1 = val() % 1000;
            if (dims === 1) { v.insertAt(at, e, m0); ctx.orc[t].insertAt(at, e, m0); } else { v.insertAt(at, e, m0, m1); ctx.orc[t].insertAt(at, e, m0, m1); }
          }
          walkOk(ctx, 'L2 refilled');
          assert.equal(v.length, old);
          assert.equal(ctx.views[0]._hdr[0], liveBefore, 'live back to the pre-clear value');
          for (let j = 0; j < k; j++) {
            checkAgainstOracle(ctx, j, 'L2 refill');
            if (j !== t) assert.equal(json(answers(ctx.views[j], dims)), others[j], 'other view unchanged by refill');
          }
        }
      }
      assert.equal(cleared, 5, 'coverage');
    });
  }
}

// ---- L1: 100 seeded cycles, arena(256, {leafSize: 4}, 3) ----

test('S-R1 L1 100 cycles: seeded fill (insertAt / removeAt), seeded clear order, walker after every op, hdr == fresh', () => {
  const C = 256;
  const o = { leafSize: 4 };
  const freshHdr = Array.from(engineFactory(C, o, 3).views[0]._hdr);
  const keyR = xs(0xC0FFEE11);   // positions
  const valR = xs(0x0BADF00D);   // entity / measure values
  const opR = xs(0x1234ABCD);    // op kind, view pick, clear order
  let g3 = 0;
  let multi = 0;
  let walks = 0;
  for (let cyc = 0; cyc < 100; cyc++) {
    const f = engineFactory(C, o, 3);
    const NIL = f.snapshot().NIL;
    const orc = [new Oracle(1), new Oracle(1), new Oracle(1)];
    const ctx = { B: 4, dims: 1, k: 3, C, f, views: f.views, orc, NIL, ER: f.snapshot().EMPTY_ROOT, freshHdr, walkOpts: { B: 4, dims: 1 } };
    const nOps = 150 + (opR() % 60);
    for (let s = 0; s < nOps; s++) {
      const j = opR() % 3;
      const v = f.views[j];
      const live = v._hdr[0];
      if (v.length > 0 && (opR() % 100 >= 72 || live >= C)) {
        const at = keyR() % v.length;
        assert.equal(v.removeAt(at), orc[j].removeAt(at));
      } else if (live < C) {
        const at = keyR() % (v.length + 1);
        const e = valR() & 0xFFFF;
        const m = valR() % 1000;
        v.insertAt(at, e, m);
        orc[j].insertAt(at, e, m);
      }
      walkOk(ctx, 'L1 cycle ' + cyc + ' op ' + s);
      walks++;
    }
    // seeded clear order (Fisher-Yates over the op stream)
    const order = [0, 1, 2];
    for (let j = 2; j > 0; j--) { const r = opR() % (j + 1); const x = order[j]; order[j] = order[r]; order[r] = x; }
    for (const t of order) {
      const sh = shapeOf(f.snapshot(), t);
      if (sh.height >= 3) multi++;
      if (clearAndCheck(ctx, t, 'L1 cycle ' + cyc) === 'G3') g3++;
      walks++;
    }
    assert.deepEqual(Array.from(f.views[0]._hdr), freshHdr, 'cycle ' + cyc + ': hdr == fresh');
  }
  assert.ok(g3 >= 150, 'coverage floor: G3 clears ' + g3 + ' >= 150');
  assert.ok(multi >= 150, 'coverage floor: multi-level targets ' + multi + ' >= 150');
  assert.ok(walks >= 15000, 'coverage floor: walks ' + walks);
});

// ---- mutant rows ----

const MS1 = (Seq) => {
  // A is one leaf and gets leaf id 0; B is multi-leaf. B.clear() with A live, then B grows again.
  const vs = Seq.arena(64, { leafSize: 4 }, 2);
  const [A, B] = vs;
  for (let j = 0; j < 3; j++) A.insertAt(j, j, 1);
  for (let j = 0; j < 20; j++) B.insertAt(j, 100 + j, 1);
  B.clear();
  for (let j = 0; j < 6; j++) B.insertAt(0, 200 + j, 1);
  return vs;
};

function snapOfViews(views, NIL, ER) {
  const v0 = views[0];
  const ar = v0._ar;
  const hdr = v0._hdr;
  const dims = ar.dims;
  const leaf = { size: ar.Lmax, bump: hdr[1], free: hdr[2], next: v0._lnext.slice(), len: v0._llen.slice(), ent: v0._ent.slice(), meas: [] };
  const int = { size: ar.Lmax - 1, bump: hdr[3], free: hdr[4], next: v0._inext.slice(), left: v0._left.slice(), right: v0._right.slice(), weight: v0._weight.slice(), count: v0._count.slice(), sum: [] };
  for (let d = 0; d < dims; d++) { leaf.meas.push(v0._meas[d].slice()); int.sum.push(v0._sums[d].slice()); }
  return {
    C: ar.C, B: ar.B, dims, NIL, EMPTY_ROOT: ER, live: hdr[0], int, leaf,
    views: views.map((w) => ({ _root: w._root, _len: w._len, _fl: w._fl, _fb: w._fb, _fdepth: w._fdepth, _fpath: new Int32Array(w._fpath), _cv: w._cv })),
  };
}

function ms1Walk(Seq) {
  const fresh = Seq.arena(64, { leafSize: 4 }, 2);
  const vs = MS1(Seq);
  return walk(snapOfViews(vs, fresh[0]._fl, fresh[0]._root), { B: 4, dims: 1 });
}

test('S-R1 MS-1 real build: clear of B while A is live keeps the pools consistent (walker clean)', () => {
  assert.equal(ms1Walk(SumSequence), null);
});

test('S-R1 MS-1 mutant: an O(1) pool reset while another view is live is killed (I-7, token shared)', async () => {
  assert.notEqual(ANCHORS.ms1, null, 'anchor ms1 not yet filled (a null anchor fails, never skips)');
  const m = await buildMutant(SRC, ANCHORS.ms1);
  try {
    const r = ms1Walk(m.SumSequence);
    assert.notEqual(r, null, 'mutant must be detected');
    assert.equal(r.code, 'I-7');
    assert.ok(r.detail.startsWith('shared'), 'token shared, got: ' + r.detail);
  } finally { m.cleanup(); }
});

// MS-2: hidden-class identity across the two ctor paths (also closes the rung-1 nit). Child process with natives.
const CHILD = [
  "const Seq = (await import(process.argv[2])).SumSequence;",
  "const out = [];",
  "const one = (o) => {",
  "  const c = new Seq(64, o);",
  "  const a = Seq.arena(64, o, 2);",
  "  out.push(%HaveSameMap(c, a[0]));",
  "  out.push(%HaveSameMap(a[0], a[1]));",
  "};",
  "one(undefined);",
  "one({ leafSize: 4, dims: 2 });",
  "console.log(JSON.stringify(out));",
].join('\n');

function sameMaps(modPath) {
  const dir = mkdtempSync(join(tmpdir(), 'ygg-ms2-'));
  try {
    const child = join(dir, 'child.mjs');
    writeFileSync(child, CHILD);
    const r = spawnSync(process.execPath, ['--allow-natives-syntax', child, modPath], { encoding: 'utf8' });
    assert.equal(r.status, 0, 'child failed: ' + r.stderr);
    return JSON.parse(r.stdout.trim());
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('S-R1 MS-2 real build: ctor vs arena, arena[0] vs arena[1], default and {leafSize:4, dims:2} share one hidden class', () => {
  assert.deepEqual(sameMaps(SRC), [true, true, true, true]);
});

test('S-R1 MS-2 mutant: a hidden class that differs between the ctor and arena paths is killed', async () => {
  assert.notEqual(ANCHORS.ms2, null, 'anchor ms2 not yet filled (a null anchor fails, never skips)');
  const m = await buildMutant(SRC, ANCHORS.ms2);
  try {
    const r = sameMaps(m.file);
    assert.equal(r[0], false, 'ctor-vs-arena must differ in the mutant');
    assert.equal(r[2], false);
  } finally { m.cleanup(); }
});

// ---- R-S1: clear() of a corrupt view fails closed (cold guard, plain Error, no write before the root check) ----
// Maintainer ruling R-S1: "Cold guard, throw Error (Recommended)". Message starts exactly
// 'lite-yggdrasil: clear() corrupt view: ' and the class is Error, not RangeError. k = 2 and the other view holds
// elements, so the free-walk path runs.
const CORRUPT = 'lite-yggdrasil: clear() corrupt view: ';
const TMO = { timeout: 30000 };

function corruptArena(Seq) {
  const vs = Seq.arena(64, { leafSize: 4, dims: 1 }, 2);
  for (let j = 0; j < 4; j++) vs[0].insertAt(j, j, 1);
  for (let j = 0; j < 20; j++) vs[1].insertAt(j, 100 + j, 1);
  return vs;
}

// Whole observable state as one string: hdr, every pool column, every view's fields.
function stateOf(vs) {
  const v0 = vs[0];
  return json([Array.from(v0._hdr), v0._left, v0._right, v0._weight, v0._count, v0._inext, v0._llen, v0._lnext, v0._ent,
    v0._meas, v0._sums, vs.map((w) => [w._root, w._len, w._fl, w._fb, w._fdepth, w._cv, Array.from(w._n)])]);
}

function isCorrupt(e) {
  return e instanceof Error && e.constructor === Error && !(e instanceof RangeError) && e.message.startsWith(CORRUPT);
}

// forge(vs) corrupts vs[1]; returns true when the forged clear() must leave state byte-identical.
function corruptRow(Seq, forge) {
  const vs = corruptArena(Seq);
  const v = vs[1];
  const sameWanted = forge(vs, v);
  const before = stateOf(vs);
  let err = null;
  try { v.clear(); } catch (e) { err = e; }
  return { err, same: stateOf(vs) === before, sameWanted };
}

const FORGE = {
  g1: (vs, v) => { v._root = engineFactory(64, { leafSize: 4, dims: 1 }, 2).snapshot().EMPTY_ROOT; v._len = 2; return true; },
  g2: (vs, v) => { v._root = ~vs[0]._hdr[1]; v._len = 2; return true; },
  g3: (vs, v) => { v._root = vs[0]._hdr[3]; v._len = 2; return true; },
  g4: (vs, v) => { v._left[v._root] = v._root; return false; },
  g5: (vs, v) => { v._left[v._root] = ~vs[0]._hdr[1]; return false; },
  g6: (vs, v) => { v._len = vs[0]._hdr[0] + 1; return true; },
  g7: (vs, v) => { v._left[v._root] = v._root; v._right[v._root] = -1; vs[0]._hdr[1] = 1; return false; },
};

for (const [key, title] of [
  ['g1', 'G-1 _root = EMPTY_ROOT with _len 2'],
  ['g2', 'G-2 _root = ~(leaf bump), leaf ref out of range'],
  ['g3', 'G-3 _root = internal bump, internal id out of range'],
  ['g4', 'G-4 cycle: an internal child set to its own root id (bounded walk)'],
  ['g5', 'G-5 child leaf ref out of range under a valid root'],
  ['g6', 'G-6 _len = live + 1 (_len > live)'], ['g7', 'G-7 cycle over a leaf child, leaf bump 1 (leaf bound)'],
]) {
  test('R-S1 ' + title + ': throws plain Error' + (FORGE[key] && (key < 'g4' || key === 'g6') ? ', state byte-identical' : ''), TMO, () => {
    const r = corruptRow(SumSequence, FORGE[key]);
    assert.ok(r.err !== null, 'clear() must throw');
    assert.ok(isCorrupt(r.err), 'plain Error with the exact prefix, got ' + r.err.constructor.name + ': ' + r.err.message);
    if (key === 'g4') assert.match(r.err.message, /more than \d+ internals/);
    if (key === 'g5') assert.match(r.err.message, /child ref/);
    if (key === 'g6') assert.match(r.err.message, /_len \d+ > live/);
    if (key === 'g7') assert.match(r.err.message, /more than 1 leaves/);
    if (r.sameWanted) assert.ok(r.same, 'no write before the root check: state must be byte-identical');
  });
}

test('R-S1 MS-G mutant: the corrupt-view guard removed is killed (G-2 scenario no longer throws cleanly)', TMO, async () => {
  assert.notEqual(ANCHORS.msg, null, 'anchor msg not yet filled (a null anchor fails, never skips)');
  const m = await buildMutant(SRC, ANCHORS.msg);
  try {
    // The real build guarantees, on G-1 and G-2: a throw with the 'root ref' detail AND byte-identical state.
    let killed = false;
    for (const key of ['g1', 'g2']) {
      let r;
      try { r = corruptRow(m.SumSequence, FORGE[key]); } catch (e) { killed = true; continue; }
      if (r.err === null || !isCorrupt(r.err) || !/root ref/.test(r.err.message) || !r.same) killed = true;
    }
    assert.ok(killed, 'mutant must differ from the real guard');
  } finally { m.cleanup(); }
});

// ---- section 2: S-R2 append (join + seam repair) ----
// Spec: 0004 A-3 / A-4 (operand rules; append: this := this ++ other, other := empty, returns this), 0005 C-10 (operand
// check order: not a view, self, another arena, then headroom; RangeError; tokens 'operand' / 'headroom' / 'pool'),
// C-3 (the 'pool' pre-check changes nothing, finger not invalidated), C-5 (both fingers NIL), C-6 (both _cv false after
// a success, a RangeError leaves both), C-18 (rep moves), C-21 (seam repair: u = the short seam leaf, the right one if
// both are short; merge iff 2t <= B), C-24 (counters into this._n, other._n delta 0, joinSteps <= HB(Lmax)),
// C-25 (touches 0 if an operand is empty else d_a(last) + d_b(first)), C-28 (walker). Every expected value below is
// computed from the PRE snapshot by this file's own traversal (seamOf / shapeOf) and the spec formulas; the oracle
// (test/oracle.mjs) answers every query. READING R2-1: a multi-leaf view holds only leaves >= m (I-1), so a short seam
// leaf (< m) exists only in a ONE-leaf operand; "seam leaf at its minimum" for multi-leaf shapes means seam leaf == m.
// READING R2-2: joinSteps > 0 is asserted only when 3 * min(leaves) < max(leaves) (T-3: the heavier root is then not
// balanced against the other tree, so it is pushed; a balanced pair may push 0);
// <= HB(Lmax) = view._ar.HL always; == 0 when an operand is empty or the repair merged a one-leaf operand away.

const MAXM = 9007199254740991;

function mkCtx(B, dims, k, seed, Cover) {
  const C = Cover || (k * 6 * B + 16);
  const o = { leafSize: B, dims };
  const f = engineFactory(C, o, k);
  const fs = engineFactory(C, o, k).snapshot();
  const ctx = {
    B, dims, k, C, f, views: f.views, orc: [], NIL: fs.NIL, ER: fs.EMPTY_ROOT, walkOpts: { B, dims },
    key: xs(0x2545F491 ^ (seed * 2654435761)), val: xs(0x9E3779B1 ^ (seed * 40503 + 11)),
  };
  for (let j = 0; j < k; j++) ctx.orc.push(new Oracle(dims));
  return ctx;
}

function ins(ctx, j, at, e, m0, m1) {
  const v = ctx.views[j];
  if (ctx.dims === 1) { v.insertAt(at, e, m0); ctx.orc[j].insertAt(at, e, m0); } else { v.insertAt(at, e, m0, m1); ctx.orc[j].insertAt(at, e, m0, m1); }
}

function insRand(ctx, j) {
  const v = ctx.views[j];
  ins(ctx, j, ctx.key() % (v.length + 1), ctx.val() & 0xFFFF, ctx.val() % 1000, ctx.val() % 1000);
}

// seam leaf of view vi in snapshot s: {len, depth} (depth = internal nodes on the path), null when empty.
function seamOf(s, vi, last) {
  const vw = s.views[vi];
  if (vw._len === 0) return null;
  let ref = vw._root;
  let depth = 0;
  while (ref >= 0) { depth++; ref = last ? s.int.right[ref] : s.int.left[ref]; }
  return { len: s.leaf.len[~ref], depth };
}

function leafLens(s, vi) {
  const out = [];
  const vw = s.views[vi];
  if (vw._len === 0) return out;
  const st = [vw._root];
  while (st.length) {
    const r = st.pop();
    if (r < 0) out.push(s.leaf.len[~r]); else { st.push(s.int.right[r]); st.push(s.int.left[r]); }
  }
  return out;
}

// shape in 'E' empty, 'S' one leaf < m (needs m >= 2), 'O' one leaf >= m, 'M' multi-leaf, 'T' multi-leaf with the seam
// leaf shrunk to its minimum m; role 'this' -> the seam is the LAST leaf, 'other' -> the FIRST.
function fillShape(ctx, j, shape, role) {
  const { B } = ctx;
  const m = B >> 2;
  const v = ctx.views[j];
  if (shape === 'E') return;
  if (shape === 'S') { for (let i = 0; i < m - 1; i++) insRand(ctx, j); return; }
  if (shape === 'O') { const n = Math.max(m, B >> 1); for (let i = 0; i < n; i++) insRand(ctx, j); return; }
  for (let i = 0; i < 5 * B; i++) insRand(ctx, j);
  if (shape === 'T') {
    const last = role === 'this';
    for (let g = 0; g < 4 * B; g++) {
      const sm = seamOf(ctx.f.snapshot(), j, last);
      if (sm.len <= m) break;
      const at = last ? v.length - 1 : 0;
      assert.equal(v.removeAt(at), ctx.orc[j].removeAt(at));
    }
  }
}

function countersOf(views) {
  return views.map((w) => { const a = new Int32Array(NC); w.readCounters(a); return Array.from(a); });
}

// Whole observable state: every view's fields (incl. _fpath contents, _cv, _n) and every pool column + hdr of each
// view's arena. A RangeError must leave it byte-identical.
function stateAll(vs) {
  return json(vs.map((w) => [w._root, w._len, w._fl, w._fb, w._fdepth, Array.from(w._fpath), w._cv, Array.from(w._n),
    Array.from(w._hdr), w._left, w._right, w._weight, w._count, w._inext, w._llen, w._lnext, w._ent, w._meas, w._sums]));
}

function primeFinger(ctx, j) {
  const v = ctx.views[j];
  if (v.length === 0) return;
  v.getMeasure(v.length >> 1, 0);
  assert.notEqual(v._fl, ctx.NIL, 'precondition: finger of view ' + j + ' set');
}

// One successful a.append(b) with the whole C-3 .. C-28 surface. Returns what happened for coverage / exact rows.
function checkAppend(ctx, a, b, tag) {
  const { views, k, dims, B, orc, f } = ctx;
  const m = B >> 2;
  const A = views[a];
  const O = views[b];
  primeFinger(ctx, a);
  primeFinger(ctx, b);
  for (const w of views) w._cv = true; // poke: "false afterwards" has teeth
  const cn = countersOf(views);
  const pre = f.snapshot();
  const hdrPre = Array.from(A._hdr);
  const nA = A.length;
  const nB = O.length;
  const shA = shapeOf(pre, a);
  const shB = shapeOf(pre, b);
  const sa = seamOf(pre, a, true);
  const sb = seamOf(pre, b, false);
  const both = nA > 0 && nB > 0;
  const rep = both && Math.min(sa.len, sb.len) < m;
  let merges = 0;
  let eqs = 0;
  let moves = 0;
  if (rep) {
    const uLeft = !(sb.len < m); // u = the right leaf if it is short (also when both are), else the left
    const t = sa.len + sb.len;
    if (2 * t <= B) { merges = 1; moves = uLeft ? t : sb.len; } else { eqs = 1; moves = uLeft ? sb.len : Math.ceil(t / 2); }
  }
  const touches = both ? sa.depth + sb.depth : 0;
  const usedL = pre.leaf.bump - freeLen(pre.leaf.next, pre.leaf.free);
  const usedI = pre.int.bump - freeLen(pre.int.next, pre.int.free);
  orc[a].append(orc[b]);
  const r = A.append(O);
  const where = tag + ' [' + a + '<-' + b + ' nA=' + nA + ' nB=' + nB + ']';
  assert.equal(r, A, where + ' returns this');
  const post = f.snapshot();
  // views: this / other
  assert.equal(A._len, nA + nB, where + ' this._len');
  assert.equal(A.length, nA + nB, where + ' length');
  assert.equal(O._len, 0, where + ' other._len');
  assert.equal(O._root, ctx.ER, where + ' other._root is EMPTY_ROOT');
  for (const w of [A, O]) {
    assert.equal(w._fl, ctx.NIL, where + ' _fl');
    assert.equal(w._fb, 0, where + ' _fb');
    assert.equal(w._fdepth, 0, where + ' _fdepth');
    assert.equal(w._cv, false, where + ' _cv');
  }
  assert.equal(post.live, hdrPre[0], where + ' live unchanged');
  // counters
  const cnPost = countersOf(views);
  const C_ = SumSequence.COUNTERS;
  const dA = cnPost[a].map((x, i) => x - cn[a][i]);
  assert.deepEqual(cnPost[b], cn[b], where + ' other._n delta 0');
  for (let j = 0; j < k; j++) if (j !== a) assert.deepEqual(cnPost[j], cn[j], where + ' counters of view ' + j);
  assert.equal(dA[C_.touches], touches, where + ' touches');
  assert.equal(dA[C_.seamRepairs], rep ? 1 : 0, where + ' seamRepairs');
  assert.equal(dA[C_.merges], merges, where + ' merges');
  assert.equal(dA[C_.equalizes], eqs, where + ' equalizes');
  assert.equal(dA[C_.moves], moves, where + ' moves');
  assert.equal(dA[C_.splits], 0, where + ' splits');
  assert.equal(dA[C_.fingerHits], 0, where + ' fingerHits');
  assert.equal(dA[C_.fingerMisses], 0, where + ' fingerMisses');
  const js = dA[C_.joinSteps];
  // R-J1 (maintainer ruling, split convention): pulls = the seam repair's C-20 pulls + (join ran ? 1 for the fresh
  // internal node + 1 per popped join-spine node + 2 per single / 3 per double rotation : 0). Repair pulls: a short
  // seam leaf lives in a ONE-leaf operand (R2-1), so it has no ancestors; both a merge (u freed, v's ancestors recount)
  // and an equalize (|anc(u) U anc(v)|, disjoint trees) pull exactly the other seam path = d_a + d_b.
  const joinRan = both && !merges;
  const wantPulls = (rep ? sa.depth + sb.depth : 0) +
    (joinRan ? 1 + js + 2 * dA[C_.rotSingle] + 3 * dA[C_.rotDouble] : 0);
  assert.equal(dA[C_.pulls], wantPulls, where + ' pulls (R-J1)');
  const HL = A._ar.HL;
  assert.ok(js >= 0 && js <= HL, where + ' joinSteps ' + js + ' in [0, HL=' + HL + ']');
  if (!both || merges) assert.equal(js, 0, where + ' joinSteps 0 (operand empty or merged away)');
  else if (3 * Math.min(shA.leaves, shB.leaves) < Math.max(shA.leaves, shB.leaves)) assert.ok(js > 0, where + ' joinSteps > 0: the heavier root is unbalanced against the lighter tree (T-3 pushes it)');
  // the other views: untouched
  for (let j = 0; j < k; j++) {
    if (j === a || j === b) continue;
    assert.equal(json(post.views[j]), json(pre.views[j]), where + ' view ' + j + ' fields untouched');
    assert.equal(views[j]._cv, true, where + ' view ' + j + ' _cv untouched');
  }
  // pool census
  const shP = shapeOf(post, a);
  assert.equal(shP.leaves, shA.leaves + shB.leaves - merges, where + ' leaves conserved (-1 per merge)');
  assert.equal(shP.ints, shP.leaves > 0 ? shP.leaves - 1 : 0, where + ' internals == leaves - 1');
  assert.equal(post.leaf.bump - freeLen(post.leaf.next, post.leaf.free), usedL - merges, where + ' used leaf ids');
  assert.equal(post.int.bump - freeLen(post.int.next, post.int.free), usedI - shA.ints - shB.ints + shP.ints, where + ' used internal ids');
  const wk = walk(post, ctx.walkOpts);
  assert.equal(wk, null, where + ': walker ' + (wk && wk.code + ' ' + wk.detail));
  for (let j = 0; j < k; j++) checkAgainstOracle(ctx, j, where);
  return { rep, merges, eqs, moves, js, both, pulls: dA[C_.pulls], rotS: dA[C_.rotSingle], rotD: dA[C_.rotDouble], touches, leaves: shP.leaves, lens: leafLens(post, a), dA, dims };
}

// ---- success grid: shape x shape x leafSize x dims x k ----

for (const B of [4, 16]) {
  for (const dims of [1, 2]) {
    for (const k of [2, 3]) {
      test('S-R2 append grid: B=' + B + ' dims=' + dims + ' k=' + k + ' (every shape pair, whole counter / finger / cursor / census surface)', () => {
        const m = B >> 2;
        const shapes = m >= 2 ? ['E', 'S', 'O', 'M', 'T'] : ['E', 'O', 'M', 'T'];
        const cov = { rows: 0, rep: 0, merge: 0, eq: 0, join: 0, empty: 0, both: 0 };
        let seed = 1;
        for (const sa of shapes) {
          for (const sb of shapes) {
            const ctx = mkCtx(B, dims, k, seed++);
            const a = k === 2 ? 0 : 2;
            const b = k === 2 ? 1 : 0;
            if (k === 3) fillShape(ctx, 1, 'M', 'this');
            fillShape(ctx, a, sa, 'this');
            fillShape(ctx, b, sb, 'other');
            const x = checkAppend(ctx, a, b, sa + '+' + sb);
            // other is a live empty view, reusable: it can take new elements and be appended onto
            ctx.views[b].insertAt(0, 7, 1, dims === 1 ? undefined : 1);
            ctx.orc[b].insertAt(0, 7, 1, dims === 1 ? undefined : 1);
            assert.equal(walk(ctx.f.snapshot(), ctx.walkOpts), null);
            cov.rows++;
            if (x.rep) cov.rep++;
            if (x.merges) cov.merge++;
            if (x.eqs) cov.eq++;
            if (x.js > 0) cov.join++;
            if (x.both) cov.both++; else cov.empty++;
          }
        }
        assert.equal(cov.rows, shapes.length * shapes.length);
        assert.equal(cov.empty, 2 * shapes.length - 1, 'coverage: every pair with an empty operand');
        assert.ok(cov.join >= 4, 'coverage: joins that descend ' + cov.join);
        if (m >= 2) assert.ok(cov.rep >= 6 && cov.merge >= 2 && cov.eq >= 2, 'coverage: repairs ' + json(cov));
        else assert.equal(cov.rep, 0, 'B = 4 (m = 1): no leaf is short, no repair');
      });
    }
  }
}

// ---- ASSERTION 1 exact rows: arena(64, {leafSize: 16}, 2), one-leaf operands ----

for (const [na, nb, leaves, rep, merges, eqs, moves, lens, label] of [
  [3, 5, 1, 1, 1, 0, 8, [8], '3+5 merges into one leaf of 8'],
  [10, 10, 2, 0, 0, 0, 0, [10, 10], '10+10 stays two leaves, no repair'],
  [3, 10, 2, 1, 0, 1, 10, [6, 7], '3+10 equalizes to 6|7'],
  [3, 2, 1, 1, 1, 0, 2, [5], '3+2 (both short; u = the right one) merges to 5'],
]) {
  test('S-R2 ASSERTION 1 exact: ' + label, () => {
    const ctx = mkCtx(16, 1, 2, 9, 64);
    for (let i = 0; i < na; i++) insRand(ctx, 0);
    for (let i = 0; i < nb; i++) insRand(ctx, 1);
    const x = checkAppend(ctx, 0, 1, label);
    assert.equal(x.leaves, leaves, 'leaves');
    assert.equal(x.dA[SumSequence.COUNTERS.seamRepairs], rep);
    assert.equal(x.dA[SumSequence.COUNTERS.merges], merges);
    assert.equal(x.dA[SumSequence.COUNTERS.equalizes], eqs);
    assert.equal(x.dA[SumSequence.COUNTERS.moves], moves);
    assert.equal(x.dA[SumSequence.COUNTERS.touches], 0, 'one-leaf operands: depth 0 + 0');
    assert.deepEqual(x.lens, lens, 'leaf sizes left to right');
  });
}

// ---- error rows (ASSERTION 3): both views (and a third at k = 3) byte-identical, RangeError, token ----

function errCtx(B, dims, k, seed) {
  const ctx = mkCtx(B, dims, k, seed);
  for (let j = 0; j < k; j++) fillShape(ctx, j, 'M', 'this');
  for (let j = 0; j < k; j++) primeFinger(ctx, j);
  for (const w of ctx.views) w._cv = true;
  return ctx;
}

function expectRange(v, arg, re, all, label) {
  const before = stateAll(all);
  let err = null;
  try { v.append(arg); } catch (e) { err = e; }
  assert.ok(err !== null, label + ': must throw');
  assert.ok(err instanceof RangeError, label + ': RangeError, got ' + (err && err.constructor.name));
  assert.match(err.message, re, label + ': token');
  assert.equal(stateAll(all), before, label + ': both views, all columns, hdr, fingers, _cv, counters byte-identical');
  return err;
}

for (const dims of [1, 2]) {
  for (const k of [2, 3]) {
    test('S-R2 append errors: operand (not a view / self), dims=' + dims + ' k=' + k, TMO, () => {
      const ctx = errCtx(4, dims, k, 31);
      const [v, w] = ctx.views;
      const all = ctx.views;
      const forgedPlain = Object.assign({}, w); // every own field of a real view, incl. the SAME _hdr
      const forgedProto = Object.assign(Object.create(SumSequence.prototype), w);
      const stub = synthStub(64, { leafSize: 4, dims }, 1).views[0];
      const orcl = new Oracle(dims);
      let n = 0;
      for (const bad of [undefined, null, 5, 'x', {}, [], () => 0, forgedPlain, forgedProto, orcl, stub]) {
        expectRange(v, bad, /operand/, all, 'not a view #' + n++);
      }
      expectRange(v, v, /operand/, all, 'self');
      expectRange(w, w, /operand/, all, 'self (other direction)');
      // an empty receiver: self and not-a-view still fail first
      const e = mkCtx(4, dims, k, 5);
      const ev = e.views[0];
      expectRange(ev, ev, /operand/, e.views, 'self, empty view');
      expectRange(ev, Object.assign({}, e.views[1]), /operand/, e.views, 'forged, empty view');
      assert.equal(n, 11);
    });

    test('S-R2 append errors: another arena names SumSequence.arena, dims=' + dims + ' k=' + k, TMO, () => {
      const o = { leafSize: 4, dims };
      const X = errCtx(4, dims, k, 41);
      const Y = errCtx(4, dims, k, 42);
      const all = X.views.concat(Y.views);
      expectRange(X.views[0], Y.views[0], /operand/, all, 'arena vs arena');
      expectRange(X.views[0], Y.views[0], /SumSequence\.arena/, all, 'arena vs arena names SumSequence.arena');
      expectRange(Y.views[1], X.views[1], /SumSequence\.arena/, all, 'arena vs arena, other direction');
      // k = 1 ctor view vs an arena view (both directions), two ctor views, empty and non-empty
      const c1 = new SumSequence(64, o);
      const c2 = new SumSequence(64, o);
      for (let i = 0; i < 6; i++) { c1.insertAt(i, i, 1, dims === 1 ? undefined : 1); }
      const pair = [c1, c2, X.views[0]];
      expectRange(c1, X.views[0], /operand/, pair, 'ctor vs arena');
      expectRange(c1, X.views[0], /SumSequence\.arena/, pair, 'ctor vs arena names SumSequence.arena');
      expectRange(X.views[0], c1, /SumSequence\.arena/, pair, 'arena vs ctor');
      expectRange(c1, c2, /operand/, pair, 'ctor vs ctor');
      expectRange(c1, c2, /SumSequence\.arena/, pair, 'ctor vs ctor names SumSequence.arena');
      expectRange(c2, c1, /SumSequence\.arena/, pair, 'empty ctor vs non-empty ctor');
      expectRange(c2, new SumSequence(64, o), /SumSequence\.arena/, pair, 'two empty ctor views');
    });

    test('S-R2 append errors: check order, the EARLIER token wins (RS-6), dims=' + dims + ' k=' + k, TMO, () => {
      const m0 = dims === 1 ? undefined : 1;
      // self with headroom overflow: total MAX, v ++ v would overflow -> operand, never headroom
      const ctx = mkCtx(4, dims, k, 51);
      ins(ctx, 0, 0, 1, MAXM - 1, 1);
      ins(ctx, 0, 1, 2, 1, 1);
      ctx.views[0].setMeasure(0, 0, MAXM - 1);
      primeFinger(ctx, 0);
      const e1 = expectRange(ctx.views[0], ctx.views[0], /operand/, ctx.views, 'self + headroom overflow');
      assert.doesNotMatch(e1.message, /headroom/);
      // forged copy of the same over-full view (a non-view that is also this-like): operand
      const e2 = expectRange(ctx.views[0], Object.assign({}, ctx.views[0]), /operand/, ctx.views, 'forged this-like');
      assert.doesNotMatch(e2.message, /headroom/);
      // cross-arena with headroom overflow on both sides: operand + SumSequence.arena, never headroom
      const X = mkCtx(4, dims, k, 52);
      const Y = mkCtx(4, dims, k, 53);
      ins(X, 0, 0, 1, MAXM - 1, 1);
      ins(Y, 0, 0, 1, 5, 1);
      primeFinger(X, 0);
      primeFinger(Y, 0);
      const all = X.views.concat(Y.views);
      const e3 = expectRange(X.views[0], Y.views[0], /SumSequence\.arena/, all, 'cross-arena + headroom overflow');
      assert.match(e3.message, /operand/);
      assert.doesNotMatch(e3.message, /headroom/);
      const e4 = expectRange(Y.views[0], X.views[0], /operand/, all, 'cross-arena, small receiver');
      assert.doesNotMatch(e4.message, /headroom/);
      // not a view with a sane receiver: operand (not 'pool', not 'headroom')
      const e5 = expectRange(X.views[0], undefined, /operand/, all, 'not a view');
      assert.doesNotMatch(e5.message, /headroom|pool/);
      assert.equal(m0 === undefined || m0 === 1, true);
    });
  }
}

// headroom per dim: overflow, boundary, dim-1-only, one operand empty, fingers survive
for (const B of [4, 16]) {
  for (const dims of [1, 2]) {
    for (const k of [2, 3]) {
      test('S-R2 append headroom: B=' + B + ' dims=' + dims + ' k=' + k + ' (every dim; 2^53-2 ++ 2 fails, 2^53-3 ++ 2 = 2^53-1 succeeds)', TMO, () => {
        let fails = 0;
        let oks = 0;
        for (let t = 0; t < dims; t++) {
          const mk = (x, y) => { // one element each; measure x on dim t, 1 on the other dim
            const ctx = errCtx(B, dims, k, 60 + t);
            for (const w of ctx.views) { w.clear(); }
            for (let j = 0; j < k; j++) ctx.orc[j].clear();
            const row = (val) => { const r = []; for (let d = 0; d < dims; d++) r.push(d === t ? val : 1); return r; };
            const ra = row(x);
            const rb = row(y);
            ins(ctx, 0, 0, 3, ra[0], ra[1]);
            ins(ctx, 1, 0, 4, rb[0], rb[1]);
            if (k === 3) { for (let i = 0; i < 3 * B; i++) insRand(ctx, 2); }
            return ctx;
          };
          // (2^53-2) ++ 2 -> headroom; make the receivers multi-element so the fingers are real
          const f1 = mk(MAXM - 1, 2);
          for (let i = 0; i < 2; i++) { ins(f1, 0, 1, 5, 0, 0); ins(f1, 1, 1, 6, 0, 0); }
          primeFinger(f1, 0);
          primeFinger(f1, 1);
          for (const w of f1.views) w._cv = true;
          expectRange(f1.views[0], f1.views[1], /headroom/, f1.views, 'dim ' + t + ' overflow');
          assert.notEqual(f1.views[0]._fl, f1.NIL, 'headroom throw leaves the finger non-NIL');
          assert.notEqual(f1.views[1]._fl, f1.NIL);
          assert.equal(walk(f1.f.snapshot(), f1.walkOpts), null);
          fails++;
          // the other direction overflows too (sum is symmetric)
          expectRange(f1.views[1], f1.views[0], /headroom/, f1.views, 'dim ' + t + ' overflow, reversed');
          fails++;
          // boundary (2^53-3) ++ 2 = 2^53-1 succeeds
          const s1 = mk(MAXM - 2, 2);
          const x = checkAppend(s1, 0, 1, 'boundary dim ' + t);
          assert.equal(s1.views[0].total(t), MAXM, 'total == 2^53-1');
          assert.ok(x.both);
          oks++;
          // one operand empty: 0 + x never overflows
          const s2 = mk(MAXM, 2);
          s2.views[1].clear(); s2.orc[1].clear();
          checkAppend(s2, 0, 1, 'x ++ empty, dim ' + t);
          const s3 = mk(MAXM, 2);
          s3.views[0].clear(); s3.orc[0].clear();
          checkAppend(s3, 0, 1, 'empty ++ x, dim ' + t);
          oks += 2;
        }
        assert.equal(fails, 2 * dims);
        assert.equal(oks, 3 * dims);
      });
    }
  }
}

// pool pre-check (C-3 last bullets): ygFail 'pool', changes nothing, the finger is NOT invalidated
for (const B of [4, 16]) {
  for (const dims of [1, 2]) {
    for (const k of [2, 3]) {
      test('S-R2 append pool pre-check: B=' + B + ' dims=' + dims + ' k=' + k + ' (internal pool forced exhausted; nothing changes, finger stays)', TMO, () => {
        const ctx = errCtx(B, dims, k, 70);
        const [v, w] = ctx.views;
        const hdr = v._hdr;
        const NI = v._ar.Lmax - 1;
        const saveB = hdr[3];
        const saveF = hdr[4];
        // control: with the real header the same call would succeed on a twin; here we only poke and restore
        hdr[3] = NI; // YG_IBUMP at its max
        hdr[4] = -1; // YG_IFREE = END
        const fl = v._fl;
        const fb = v._fb;
        const fd = v._fdepth;
        const flw = w._fl;
        try {
          expectRange(v, w, /pool/, ctx.views, 'internal pool exhausted');
          assert.equal(v._fl, fl, 'finger NOT invalidated (this)');
          assert.equal(v._fb, fb);
          assert.equal(v._fdepth, fd);
          assert.equal(w._fl, flw, 'finger NOT invalidated (other)');
          assert.notEqual(v._fl, ctx.NIL);
          assert.equal(v._cv, true);
          assert.equal(w._cv, true);
        } finally { hdr[3] = saveB; hdr[4] = saveF; }
        // restored: the same operands now succeed (the throw was the pool poke, nothing else)
        checkAppend(ctx, 0, 1, 'after restore');
      });
    }
  }
}

// ---- lane (ASSERTION 2, append part): 200 seeded cycles, B = 4 and 8, arena(C, {leafSize: B}, 3) ----

for (const B of [4, 8]) {
  test('S-R2 lane: B=' + B + ', 200 seeded cycles of insertAt / removeAt / append (both directions, random pairs incl. empty), walker + oracle after EVERY op', () => {
    const dims = B === 4 ? 1 : 2;
    const C = 48;
    const keyR = xs(0xA5A5A5A5 ^ B);     // positions
    const valR = xs(0x5EED0001 + B);     // entity / measure values
    const opR = xs(0xC0DE0000 + B);      // op kind, view picks
    const cov = { ops: 0, appends: 0, both: 0, empty: 0, rep: 0, merges: 0, eq: 0, join: 0, rev: 0 };
    for (let cyc = 0; cyc < 200; cyc++) {
      const ctx = mkCtx(B, dims, 3, 1000 + cyc, C);
      ctx.key = keyR; ctx.val = valR; // the lane owns the three independent streams
      const nOps = 30 + (opR() % 20);
      for (let s = 0; s < nOps; s++) {
        const j = opR() % 3;
        const v = ctx.views[j];
        const kind = opR() % 100;
        const live = v._hdr[0];
        if (kind < 28) {
          const a = opR() % 3;
          const b = (a + 1 + (opR() % 2)) % 3;
          const liveBefore = ctx.views[0]._hdr[0];
          const x = checkAppend(ctx, a, b, 'lane B=' + B + ' cyc ' + cyc + ' op ' + s);
          assert.equal(ctx.views[0]._hdr[0], liveBefore, 'live constant across an append');
          cov.appends++;
          if (x.both) cov.both++; else cov.empty++;
          if (x.rep) cov.rep++;
          if (x.merges) cov.merges++;
          if (x.eqs) cov.eq++;
          if (x.js > 0) cov.join++;
          if (b < a) cov.rev++;
        } else if (kind < 45 && v.length > 0) {
          const at = keyR() % v.length;
          assert.equal(v.removeAt(at), ctx.orc[j].removeAt(at));
        } else if (live < C) {
          insRand(ctx, j);
        }
        cov.ops++;
        walkOk(ctx, 'lane B=' + B + ' cyc ' + cyc + ' op ' + s);
        for (let q = 0; q < 3; q++) checkAgainstOracle(ctx, q, 'lane B=' + B + ' cyc ' + cyc + ' op ' + s);
      }
    }
    assert.ok(cov.appends >= 1500, 'coverage floor: appends ' + cov.appends);
    assert.ok(cov.both >= 700, 'coverage floor: both operands non-empty ' + cov.both);
    assert.ok(cov.empty >= 100, 'coverage floor: an operand empty ' + cov.empty);
    assert.ok(cov.rev >= 500, 'coverage floor: appends with b < a ' + cov.rev);
    assert.ok(cov.join >= 50, 'coverage floor: joins that descended ' + cov.join);
    if (B === 8) assert.ok(cov.rep >= 20 && cov.merges >= 5 && cov.eq >= 5, 'coverage floor: repairs ' + json(cov));
  });
}

// ---- R-J1 pulls, fully hand-predicted rows (T-3 join by hand on a stated pre-shape) ----
// shape printer: leaf = L<len>, internal = (left right)w<weight>.
function shapeStr(v) {
  const f = (r) => (r < 0 ? 'L' + v._llen[~r] : '(' + f(v._left[r]) + ' ' + f(v._right[r]) + ')w' + v._weight[r]);
  return f(v._root);
}

for (const [B, na, nb, preA, preB, pulls, js, rs, rd, label] of [
  // two leaves 10 + 10: no repair, join of two leaves = fresh node only: pulls 1, joinSteps 0, no rotation.
  [16, 10, 10, 'L10', 'L10', 1, 0, 0, 0, '10+10 at B=16'],
  // 3 + 10: equalize on two single leaves (depth 0 + 0 -> 0 pulls), then the fresh node: 1.
  [16, 3, 10, 'L3', 'L10', 1, 0, 0, 0, '3+10 at B=16 (equalize then join)'],
  // 3 + 5: merge into one leaf, join is the identity, no depth: 0 pulls.
  [16, 3, 5, 'L3', 'L5', 0, 0, 0, 0, '3+5 at B=16 (merge, join identity)'],
  // A weight 3, B one leaf: 3*1 < 3 is false, so b is "heavy": c = b is balanced against 3 (3*1>=3): no push. 1 pull.
  [4, 12, 2, '(L4 (L4 L4)w2)w3', 'L2', 1, 0, 0, 0, 'weight-3 tree ++ leaf (balanced at once)'],
  // A weight 5 = (P(w2) Q(w3)): 3*1 < 5 -> push root (5 vs 1 unbalanced); c = Q (w3) balanced vs 1 (3*3>=1, 3*1>=3): top 1.
  // fresh u = (Q b) w4: 1 pull; pop root: wl = 2, wr = 4: 3*2>=4 and 3*4>=2 balanced -> 1 pull, no rotation: total 2.
  [4, 20, 2, '((L4 L4)w2 (L4 (L4 L4)w2)w3)w5', 'L2', 2, 1, 0, 0, 'weight-5 tree ++ leaf (one spine step, no rotation)'],
  // A weight 4 = (L (Q w3)): push root (4 vs 1), c = (L4 (L4 L4)w2)w3. u = (c b) w4: 1 pull. pop root: wl = 1,
  // wr = 4: 3*1 >= 4 fails -> rotate left: a = w(yl) = 3, b = 1, s = wl + a = 4; single needs 3*b >= s: 3 >= 4 fails -> DOUBLE
  // (3 pulls). Total 1 + 1 + 3 = 5; joinSteps 1.
  [4, 16, 4, '(L4 (L4 (L4 L4)w2)w3)w4', 'L4', 5, 1, 0, 1, 'weight-4 tree ++ leaf (one spine step, double rotation)'],
  [4, 29, 1, '((L4 L4)w2 ((L4 L4)w2 (L4 (L4 (L4 L1)w2)w3)w4)w6)w8', 'L1', 9, 3, 1, 1, 'weight-8 tree ++ leaf (double then single left rotation)'],
]) {
  test('S-R2 R-J1 hand-predicted pulls: ' + label, () => {
    const ctx = mkCtx(B, 1, 2, 77, 80);
    for (let i = 0; i < na; i++) ins(ctx, 0, ctx.views[0].length, i, 1);
    for (let i = 0; i < nb; i++) ins(ctx, 1, ctx.views[1].length, i, 1);
    assert.equal(shapeStr(ctx.views[0]), preA, 'pre-shape of this');
    assert.equal(shapeStr(ctx.views[1]), preB, 'pre-shape of other');
    const x = checkAppend(ctx, 0, 1, label);
    assert.equal(x.pulls, pulls, 'pulls');
    assert.equal(x.js, js, 'joinSteps');
    assert.equal(x.rotS, rs, 'rotSingle');
    assert.equal(x.rotD, rd, 'rotDouble');
  });
}

// ---- pool pre-check with ONE operand empty: the pool is poked exhausted and the append still succeeds ----
for (const B of [4, 16]) {
  for (const dims of [1, 2]) {
    for (const dir of ['nonempty ++ empty', 'empty ++ nonempty']) {
      test('S-R2 append pool poked exhausted, one operand empty: ' + dir + ' succeeds, B=' + B + ' dims=' + dims, TMO, () => {
        const ctx = mkCtx(B, dims, 2, 90);
        const full = dir === 'nonempty ++ empty' ? 0 : 1;
        const a = 0;
        const b = 1;
        fillShape(ctx, full, 'M', 'this');
        const A = ctx.views[a];
        const O = ctx.views[b];
        const hdr = A._hdr;
        const saveB = hdr[3];
        const saveF = hdr[4];
        const n = A.length + O.length;
        hdr[3] = A._ar.Lmax - 1;
        hdr[4] = -1;
        let r;
        try { r = A.append(O); } finally { hdr[3] = saveB; hdr[4] = saveF; }
        assert.equal(r, A);
        assert.equal(A.length, n);
        assert.equal(O.length, 0);
        ctx.orc[a].append(ctx.orc[b]);
        assert.equal(walk(ctx.f.snapshot(), ctx.walkOpts), null);
        for (let j = 0; j < 2; j++) checkAgainstOracle(ctx, j, dir);
      });
    }
  }
}

// ---- section 3: S-R3 splitAt (cut + T-3 joins + C-21 repair) ----
// Spec: 0004 A-3 / A-4 (this := [0, i), out := [i, length), returns this; validation precedes all mutation), 0001 T-3
// (join: push the heavier spine to the first node balanced against the other tree, one fresh node, pop with a single
// rotation iff both new nodes pass I-1 else double) and T-4 (BFS split: bottom-up joins of the path siblings; a mid-leaf
// cut allocates one leaf; an empty operand is the identity), 0005 C-3 / C-5 / C-6 (finger NIL on both views, _cv), C-10
// (order: index, then operand: not a view, self, another arena, non-empty out; then the 'pool' pre-check, 1 leaf, only
// when the cut is mid-leaf), C-18 (cut s-p moves, a boundary cut 0; repair moves), C-20 + R-J1 (join pulls: 1 + 1 per
// popped spine node + 2 / 3 per single / double rotation), C-21 (rX = [result X has >= 2 leaves and its seam leaf < m];
// the joins do no repair; a boundary cut never repairs), C-24 (counters into this._n, out._n delta 0), C-25 (touches:
// 0 at i in {0, length} or an empty view; d(c) with 0 repairs; <= d(c) + (rL+rR)*HB(Lmax) with repairs), C-26 (hit /
// miss delta 0), C-28 (walker). Every expected value is computed from the PRE snapshot by this file's own model
// (modelOfSnap / refSplit / rjoin / repairExpect, a weight-only transcription of T-3 / T-4 / T-6, NOT the engine), by
// hand traces (comments), or from test/stubs.mjs where it models the counter (moves / merges / equalizes / seamRepairs;
// the stub never rotates, so touches / pulls / joinSteps / rotations come from the model).
// READING S3-1: the T-4 joins run bottom-up along the cut path, nearest sibling first: the left result is built as
// X := join(left sibling, X), the right one as R := join(R, right sibling). Pulls / joinSteps / rotations assume it.
// READING S3-2: a repair's own pulls and touches are not fixed by a hand rule here (C-20 gives |anc(u) U anc(v)| for an
// equalize only), so with seamRepairs > 0 pulls is asserted >= the joins' pulls and touches in [d(c), d(c) + reps*HL];
// with 0 repairs both are exact.
// READING S3-4: with merges > 0 the rotation counters are asserted >= the joins' (a merge's T-6 rebalance may rotate).
// READING S3-3: touches for a boundary cut with 0 < i < length is d(c) of the leaf that STARTS at i (the stub's
// descent lands on the leaf holding element i).

const leafN = (len) => ({ len, w: 1, c: len });
const isLeafN = (x) => x.l === undefined;
const mkN = (l, r) => ({ l, r, w: l.w + r.w, c: l.c + r.c });
const balN = (x, y) => 3 * x >= y && 3 * y >= x;

function rjoin(a, b, acc) {
  const heavyA = 3 * b.w < a.w;
  let c = heavyA ? a : b;
  const wo = heavyA ? b.w : a.w;
  const stack = [];
  while (!balN(c.w, wo) && !isLeafN(c)) { stack.push(c); c = heavyA ? c.r : c.l; }
  let cur = heavyA ? mkN(c, b) : mkN(a, c);
  let pulls = 1;
  for (let q = stack.length - 1; q >= 0; q--) {
    const p = stack[q];
    const np = heavyA ? mkN(p.l, cur) : mkN(cur, p.r);
    pulls++;
    if (!balN(np.l.w, np.r.w)) {
      if (heavyA) {
        const x = np.l;
        const y = np.r;
        const nl = mkN(x, y.l);
        if (isLeafN(y.l) || (balN(x.w, y.l.w) && balN(nl.w, y.r.w))) { cur = mkN(nl, y.r); acc.rs++; pulls += 2; } else { cur = mkN(mkN(x, y.l.l), mkN(y.l.r, y.r)); acc.rd++; pulls += 3; }
      } else {
        const x = np.l;
        const z = np.r;
        const nr = mkN(x.r, z);
        if (isLeafN(x.r) || (balN(x.r.w, z.w) && balN(x.l.w, nr.w))) { cur = mkN(x.l, nr); acc.rs++; pulls += 2; } else { cur = mkN(mkN(x.l, x.r.l), mkN(x.r.r, z)); acc.rd++; pulls += 3; }
      }
    } else cur = np;
  }
  acc.js += stack.length;
  acc.pulls += pulls;
  acc.joins++;
  return cur;
}

function modelOfSnap(s, vi) {
  const vw = s.views[vi];
  if (vw._len === 0) return null;
  const f = (r) => (r < 0 ? leafN(s.leaf.len[~r]) : mkN(f(s.int.left[r]), f(s.int.right[r])));
  return f(vw._root);
}

function lensOfModel(t) {
  const out = [];
  const st = [t];
  while (st.length) {
    const x = st.pop();
    if (isLeafN(x)) out.push(x.len); else { st.push(x.r); st.push(x.l); }
  }
  return out;
}

// descent to the leaf holding element i (0 < i < n), then the bottom-up joins (READING S3-1)
function refSplit(root, i) {
  const path = [];
  let t = root;
  let off = i;
  while (!isLeafN(t)) {
    if (off < t.l.c) { path.push({ t, right: false }); t = t.l; } else { off -= t.l.c; path.push({ t, right: true }); t = t.r; }
  }
  const acc = { js: 0, rs: 0, rd: 0, pulls: 0, joins: 0 };
  const p = off;
  let X = p > 0 ? leafN(p) : null;
  let R = p > 0 ? leafN(t.len - p) : t;
  for (let q = path.length - 1; q >= 0; q--) {
    const nd = path[q];
    if (nd.right) X = X ? rjoin(nd.t.l, X, acc) : nd.t.l; else R = rjoin(R, nd.t.r, acc);
  }
  return { X, R, dc: path.length, p, len: t.len, acc };
}

// C-21 / C-18 / T-6: the repair of one result's seam leaf. side 'L': seam = last leaf (u right, v = its left
// neighbour); side 'R': seam = first leaf (u left). merge iff t <= B/2; moves per C-18.
function repairExpect(lens, side, B) {
  const m = B >> 2;
  const out = { lens, rep: 0, merges: 0, eqs: 0, moves: 0 };
  if (lens.length < 2) return out;
  const L = lens.length;
  const su = side === 'L' ? lens[L - 1] : lens[0];
  if (!(su < m)) return out;
  const sv = side === 'L' ? lens[L - 2] : lens[1];
  const t = su + sv;
  out.rep = 1;
  if (2 * t <= B) {
    out.merges = 1;
    out.moves = side === 'L' ? su : t;
    out.lens = side === 'L' ? lens.slice(0, L - 2).concat([t]) : [t].concat(lens.slice(2));
  } else {
    out.eqs = 1;
    out.moves = side === 'L' ? Math.ceil(t / 2) : sv;
    const pair = [Math.floor(t / 2), Math.ceil(t / 2)];
    out.lens = side === 'L' ? lens.slice(0, L - 2).concat(pair) : pair.concat(lens.slice(2));
  }
  return out;
}

function expectSplit(pre, a, i, B) {
  const n = pre.views[a]._len;
  const lens = leafLens(pre, a);
  const z = { kind: 'cut', mid: false, dc: 0, joins: 0, reps: 0, merges: 0, eqs: 0, moves: 0, js: 0, rs: 0, rd: 0, pulls: 0 };
  if (n === 0 || i === 0 || i === n) {
    return Object.assign(z, { kind: n === 0 ? 'empty' : i === 0 ? 'all' : 'none', leftLens: i === 0 ? [] : lens, rightLens: i === 0 ? lens : [] });
  }
  const r = refSplit(modelOfSnap(pre, a), i);
  const rl = repairExpect(lensOfModel(r.X), 'L', B);
  const rr = repairExpect(lensOfModel(r.R), 'R', B);
  return Object.assign(z, {
    mid: r.p > 0, dc: r.dc, joins: r.acc.joins, reps: rl.rep + rr.rep, merges: rl.merges + rr.merges, eqs: rl.eqs + rr.eqs,
    moves: (r.p > 0 ? r.len - r.p : 0) + rl.moves + rr.moves, js: r.acc.js, rs: r.acc.rs, rd: r.acc.rd, pulls: r.acc.pulls,
    leftLens: rl.lens, rightLens: rr.lens,
  });
}

// One successful a.splitAt(i, b) (b empty) with the whole C-3 .. C-28 surface.
function checkSplit(ctx, a, b, i, tag) {
  const { views, k, dims, B, orc, f } = ctx;
  const T = views[a];
  const O = views[b];
  assert.equal(O.length, 0, tag + ': precondition, out empty');
  const n = T.length;
  const ansPre = json(answers(T, dims)); // reads move the finger: before the finger prime + snapshot
  primeFinger(ctx, a);
  for (let j = 0; j < k; j++) if (j !== b) views[j]._cv = true; // poke: "false afterwards" has teeth (out stays as is)
  const cn = countersOf(views);
  const pre = f.snapshot();
  const hdrPre = Array.from(T._hdr);
  const ihdr = [T._hdr[3], T._hdr[4]]; // ibump, ifree
  // own traversal: the lowest path node reached from its RIGHT child (the one a boundary cut frees, T-4)
  let freedId = -1;
  if (n > 0 && i > 0 && i < n) {
    const cnt = (r) => (r < 0 ? pre.leaf.len[~r] : cnt(pre.int.left[r]) + cnt(pre.int.right[r]));
    let r = pre.views[a]._root;
    let off = i;
    while (r >= 0) {
      const cl = cnt(pre.int.left[r]);
      if (off < cl) r = pre.int.left[r]; else { off -= cl; freedId = r; r = pre.int.right[r]; }
    }
  }
  const shT = shapeOf(pre, a);
  const usedL = pre.leaf.bump - freeLen(pre.leaf.next, pre.leaf.free);
  const usedI = pre.int.bump - freeLen(pre.int.next, pre.int.free);
  const x = expectSplit(pre, a, i, B);
  orc[a].splitAt(i, orc[b]);
  const r = T.splitAt(i, O);
  const where = tag + ' [' + a + '->' + b + ' n=' + n + ' i=' + i + ' ' + x.kind + (x.mid ? ' mid' : '') + ']';
  assert.equal(r, T, where + ' returns this');
  const post = f.snapshot();
  assert.equal(T._len, i, where + ' this._len');
  assert.equal(O._len, n - i, where + ' out._len');
  assert.equal(T.length, i, where + ' this.length');
  assert.equal(O.length, n - i, where + ' out.length');
  if (i === 0) assert.equal(T._root, ctx.ER, where + ' this._root is EMPTY_ROOT');
  if (n - i === 0) assert.equal(O._root, ctx.ER, where + ' out._root is EMPTY_ROOT');
  for (const w of [T, O]) {
    assert.equal(w._fl, ctx.NIL, where + ' _fl');
    assert.equal(w._fb, 0, where + ' _fb');
    assert.equal(w._fdepth, 0, where + ' _fdepth');
    assert.equal(w._cv, false, where + ' _cv');
  }
  assert.equal(post.live, hdrPre[0], where + ' live unchanged');
  // counters: all 12 on this, 0 on out and on every other view
  const cnPost = countersOf(views);
  const C_ = SumSequence.COUNTERS;
  const dA = cnPost[a].map((v, q) => v - cn[a][q]);
  assert.deepEqual(cnPost[b], cn[b], where + ' out._n delta 0 (all 12)');
  for (let j = 0; j < k; j++) if (j !== a) assert.deepEqual(cnPost[j], cn[j], where + ' counters of view ' + j);
  assert.equal(dA[C_.splits], 0, where + ' splits (a cut is not a Table-3 split)');
  assert.equal(dA[C_.fingerHits], 0, where + ' fingerHits');
  assert.equal(dA[C_.fingerMisses], 0, where + ' fingerMisses');
  assert.equal(dA[C_.seamRepairs], x.reps, where + ' seamRepairs');
  assert.equal(dA[C_.merges], x.merges, where + ' merges');
  assert.equal(dA[C_.equalizes], x.eqs, where + ' equalizes');
  assert.equal(dA[C_.moves], x.moves, where + ' moves (C-18)');
  if (x.merges === 0) {
    assert.equal(dA[C_.rotSingle], x.rs, where + ' rotSingle');
    assert.equal(dA[C_.rotDouble], x.rd, where + ' rotDouble');
  } else {
    // READING S3-4: a repair MERGE splices parent(u) and runs the cold rebalance (C-20), which may rotate; an
    // equalize changes no weight. So with merges > 0 the joins' rotations are a lower bound.
    assert.ok(dA[C_.rotSingle] >= x.rs && dA[C_.rotDouble] >= x.rd, where + ' rotations >= the joins\' (merge may rebalance)');
  }
  assert.equal(dA[C_.joinSteps], x.js, where + ' joinSteps');
  const HL = T._ar.HL;
  if (x.kind !== 'cut') {
    assert.equal(dA[C_.touches], 0, where + ' touches 0 (RS-3: no descent)');
    assert.equal(dA[C_.pulls], 0, where + ' pulls 0');
  } else if (x.reps === 0) {
    assert.equal(dA[C_.touches], x.dc, where + ' touches == d(c)');
    assert.equal(dA[C_.pulls], x.pulls, where + ' pulls (R-J1 joins)');
  } else {
    assert.ok(dA[C_.touches] >= x.dc && dA[C_.touches] <= x.dc + x.reps * HL, where + ' touches in [d(c), d(c) + reps*HB]: ' + dA[C_.touches] + ' d(c)=' + x.dc);
    assert.ok(dA[C_.pulls] >= x.pulls, where + ' pulls >= the joins\' pulls: ' + dA[C_.pulls] + ' vs ' + x.pulls);
  }
  // the other views: untouched
  for (let j = 0; j < k; j++) {
    if (j === a || j === b) continue;
    assert.equal(json(post.views[j]), json(pre.views[j]), where + ' view ' + j + ' fields untouched');
    assert.equal(views[j]._cv, true, where + ' view ' + j + ' _cv untouched');
  }
  // leaf sizes left to right and the pool census
  assert.deepEqual(leafLens(post, a), x.leftLens, where + ' this leaf sizes');
  assert.deepEqual(leafLens(post, b), x.rightLens, where + ' out leaf sizes');
  const shL = shapeOf(post, a);
  const shR = shapeOf(post, b);
  assert.equal(shL.leaves + shR.leaves, shT.leaves + (x.mid ? 1 : 0) - x.merges, where + ' leaves: +1 for a mid-leaf cut, -1 per merge');
  assert.equal(shL.ints, Math.max(shL.leaves - 1, 0), where + ' this internals == leaves - 1');
  assert.equal(shR.ints, Math.max(shR.leaves - 1, 0), where + ' out internals == leaves - 1');
  assert.equal(post.leaf.bump - freeLen(post.leaf.next, post.leaf.free), usedL + (x.mid ? 1 : 0) - x.merges, where + ' used leaf ids');
  assert.equal(post.int.bump - freeLen(post.int.next, post.int.free), usedI - shT.ints + shL.ints + shR.ints, where + ' used internal ids');
  if (x.kind === 'cut' && x.mid && x.merges === 0) {
    assert.deepEqual([T._hdr[3], T._hdr[4]], ihdr, where + ' T-4: split joins reuse path nodes, no internal alloc / free');
  }
  if (x.kind === 'cut' && !x.mid) {
    assert.equal(T._hdr[3], ihdr[0], where + ' boundary cut: ibump unchanged');
    assert.equal(T._hdr[4], freedId, where + ' boundary cut: the internal free head is the freed path node');
    assert.equal(shL.ints + shR.ints, shT.ints - 1, where + ' boundary cut: exactly one path node freed');
    assert.equal(dA[C_.moves], 0, where + ' boundary cut: 0 moves');
    assert.equal(dA[C_.seamRepairs], 0, where + ' boundary cut: 0 repairs');
  }
  if (x.kind === 'cut' && x.mid && x.merges === 0) assert.equal(post.leaf.bump - freeLen(post.leaf.next, post.leaf.free), usedL + 1, where + ' mid-leaf cut: exactly one leaf allocated');
  const wk = walk(post, ctx.walkOpts);
  assert.equal(wk, null, where + ': walker ' + (wk && wk.code + ' ' + wk.detail));
  for (let j = 0; j < k; j++) checkAgainstOracle(ctx, j, where);
  if (i === n) assert.equal(json(answers(T, dims)), ansPre, where + ' i = length: this unchanged');
  return { x, dA, leftLens: leafLens(post, a), rightLens: leafLens(post, b), n };
}

// leaves of the given sizes (each >= m, <= B) left to right in view vi, built by appending one-leaf operands from tmp.
function buildLens(ctx, vi, tmp, lens) {
  const v = ctx.views[vi];
  for (let q = 0; q < lens.length; q++) {
    const dst = q === 0 ? vi : tmp;
    for (let e = 0; e < lens[q]; e++) ins(ctx, dst, ctx.views[dst].length, ctx.val() & 0xFFFF, ctx.val() % 1000, ctx.val() % 1000);
    if (q > 0) { ctx.orc[vi].append(ctx.orc[tmp]); v.append(ctx.views[tmp]); }
  }
  assert.deepEqual(leafLens(ctx.f.snapshot(), vi), lens, 'build: leaf sizes');
}

// ---- model self-check: the weight-only join model vs the committed append engine (append rows are hand-pinned) ----

test('S-R3 model self-check: rjoin == the engine append join (pulls, joinSteps, rotSingle, rotDouble) on 510 sequential pairs, B=4', () => {
  const C_ = SumSequence.COUNTERS;
  let cases = 0;
  let rot = 0;
  for (let na = 1; na <= 100; na += 3) {
    for (let nb = 1; nb <= 100; nb += 7) {
      const ctx = mkCtx(4, 1, 2, 5, 500);
      for (let q = 0; q < na; q++) ins(ctx, 0, ctx.views[0].length, q, 1);
      for (let q = 0; q < nb; q++) ins(ctx, 1, ctx.views[1].length, q, 1);
      const s = ctx.f.snapshot();
      const acc = { js: 0, rs: 0, rd: 0, pulls: 0, joins: 0 };
      rjoin(modelOfSnap(s, 0), modelOfSnap(s, 1), acc);
      const x = checkAppend(ctx, 0, 1, 'self-check ' + na + '+' + nb);
      assert.equal(x.pulls, acc.pulls, 'pulls ' + na + '+' + nb);
      assert.equal(x.js, acc.js, 'joinSteps');
      assert.equal(x.rotS, acc.rs, 'rotSingle');
      assert.equal(x.rotD, acc.rd, 'rotDouble');
      if (acc.rs + acc.rd > 0) rot++;
      cases++;
    }
  }
  assert.equal(cases, 510);
  assert.ok(rot >= 20, 'coverage: pairs that rotate ' + rot);
});

// ---- ASSERTION 1 tail, hand trace ----
// B = 16, m = 4, arena(64, {leafSize: 16}, 2). 17 sequential appends: the 17th lands in the full leaf (16): append split
// (B+1-m | m) = 13|4. Tree: one internal node (L13 L4), d(c) = 1 for the leaf holding element 14.
// splitAt(14, out): descent: 14 >= 13 -> right leaf (fb = 13), p = 1 (mid-leaf). Cut: s - p = 4 - 1 = 3 moves; this's
// leaf keeps 1, out gets a fresh leaf with 3. Path: the root went right, so the left result is join(L13, L1) = one
// fresh node (pulls 1, joinSteps 0, no rotation); the right result is the single leaf [3]. rL: 2 leaves and the seam
// (last) leaf 1 < m = 4 -> repair: u = 1, v = 13, t = 14, 2t = 28 > B = 16 -> equalize: moves ceil(14/2) = 7, sizes
// floor | ceil = 7|7. rR: one leaf -> no repair. Totals: moves 3 + 7 = 10, seamRepairs 1, equalizes 1, merges 0,
// splits 0, fingerHits / fingerMisses delta 0, both _fl NIL, out._n delta 0, _cv false.

test('S-R3 ASSERTION 1 tail: 17 appends (13|4), splitAt(14, out) -> 7|7 and [3], moves 10, 1 repair, 1 equalize', () => {
  const ctx = mkCtx(16, 1, 2, 3, 64);
  for (let q = 0; q < 17; q++) ins(ctx, 0, ctx.views[0].length, ctx.val() & 0xFFFF, ctx.val() % 1000, 0);
  assert.deepEqual(leafLens(ctx.f.snapshot(), 0), [13, 4], 'pre: 13|4');
  const y = checkSplit(ctx, 0, 1, 14, 'ASSERTION 1');
  const C_ = SumSequence.COUNTERS;
  assert.deepEqual(y.leftLens, [7, 7]);
  assert.deepEqual(y.rightLens, [3]);
  assert.equal(y.dA[C_.moves], 10);
  assert.equal(y.dA[C_.seamRepairs], 1);
  assert.equal(y.dA[C_.equalizes], 1);
  assert.equal(y.dA[C_.merges], 0);
  assert.equal(y.dA[C_.splits], 0);
  assert.equal(y.dA[C_.fingerHits], 0);
  assert.equal(y.dA[C_.fingerMisses], 0);
  assert.equal(ctx.views[0]._cv, false);
  assert.equal(ctx.views[1]._cv, false);
  // (_fl is asserted NIL inside checkSplit before its oracle reads move the finger.)
});

// ---- hand rows, B = 16 (m = 4), arena(64, ..., 2): every rL / rR combination, merge vs equalize, boundary, one-leaf ----
// moves = (mid-leaf ? s - p : 0) + repair moves; repair moves per C-18: left result u = last leaf: merge su, equalize
// ceil(t/2); right result u = first leaf: merge t, equalize sv. Merge iff 2t <= 16.
for (const [lens, i, wantL, wantR, moves, reps, merges, eqs, label] of [
  // boundary cut at the start of leaf 1 of [10, 10, 10]: no cut, no repair
  [[10, 10, 10], 10, [10], [10, 10], 0, 0, 0, 0, 'rL=0 rR=0 boundary cut: 0 moves, 0 repairs'],
  // mid-leaf cut of [10, 10] at 15 (p = 5): left [10, 5] (5 >= m), right [5]: moves s - p = 5
  [[10, 10], 15, [10, 5], [5], 5, 0, 0, 0, 'rL=0 rR=0 mid-leaf cut: s - p = 5 moves'],
  // rL only: [10, 8] cut at 11 (p = 1): left [10, 1] t = 11 -> equalize 6 -> [5, 6]; right [7]; moves 7 + 6
  [[10, 8], 11, [5, 6], [7], 13, 1, 0, 1, 'rL=1 rR=0 equalize'],
  // rR only: [8, 10, 7] cut at 17 (p = 9 of 10): left [8, 9]; right [1, 7] t = 8 -> merge, moves t = 8 -> [8]; 1 + 8
  [[8, 10, 7], 17, [8, 9], [8], 9, 1, 1, 0, 'rL=0 rR=1 merge (t = 8 <= B/2)'],
  // both, equalize + equalize: [8, 6, 8] cut at 11 (p = 3): left [8, 3] -> [5, 6] (6); right [3, 8] -> [5, 6] (8); cut 3
  [[8, 6, 8], 11, [5, 6], [5, 6], 17, 2, 0, 2, 'rL=1 rR=1 both equalize'],
  // both, merge + merge: [4, 6, 4] cut at 7 (p = 3): left [4, 3] t = 7 -> merge su = 3; right [3, 4] merge t = 7; cut 3
  [[4, 6, 4], 7, [7], [7], 13, 2, 2, 0, 'rL=1 rR=1 both merge'],
  // both, merge left + equalize right: [4, 6, 12] cut at 7: left [4, 3] merge 3 -> [7]; right [3, 12] t = 15 -> eq sv = 12 -> [7, 8]; cut 3
  [[4, 6, 12], 7, [7], [7, 8], 18, 2, 1, 1, 'rL=1 rR=1 merge left, equalize right'],
  // one-leaf result never repairs: [10] cut at 2: [2] (short, ONE leaf) and [8]; moves 10 - 2 = 8
  [[10], 2, [2], [8], 8, 0, 0, 0, 'one-leaf view cut mid-leaf: a short one-leaf result is never repaired'],
  // [10, 6] cut at 15 (p = 5 of 6): left [10, 5]; right [1] one leaf, short, no repair; moves 1
  [[10, 6], 15, [10, 5], [1], 1, 0, 0, 0, 'a short ONE-leaf right result is never repaired'],
  // boundary at the last leaf of [10, 10]: left [10], right [10]
  [[10, 10], 10, [10], [10], 0, 0, 0, 0, 'boundary cut of two leaves: two one-leaf results'],
]) {
  test('S-R3 hand row B=16: ' + label, () => {
    const ctx = mkCtx(16, 1, 3, 11, 96);
    buildLens(ctx, 0, 2, lens);
    const y = checkSplit(ctx, 0, 1, i, label);
    const C_ = SumSequence.COUNTERS;
    assert.deepEqual(y.leftLens, wantL, 'this leaf sizes');
    assert.deepEqual(y.rightLens, wantR, 'out leaf sizes');
    assert.equal(y.dA[C_.moves], moves, 'moves');
    assert.equal(y.dA[C_.seamRepairs], reps, 'seamRepairs');
    assert.equal(y.dA[C_.merges], merges, 'merges');
    assert.equal(y.dA[C_.equalizes], eqs, 'equalizes');
    assert.equal(y.dA[C_.splits], 0);
  });
}

// touches by hand (0 repairs): [10, 10, 10] is ((L10 L10)w2 L10)w3 (join of two leaves, then a leaf: balanced, no spine).
// splitAt(10): root: 10 < 20 -> left; (L10 L10): 10 >= 10 -> right, p = 0. d(c) = 2 (root + inner). Boundary: R = L10#2,
// X = L10#1. Root went left: R := join(L10#2, L10#3) = fresh node, pulls 1, js 0. Inner went right: X = sibling L10#1.
// touches 2, pulls 1, joinSteps 0, no rotation, 0 moves; one internal freed (2 -> 1).
test('S-R3 hand trace: boundary cut of ((L10 L10) L10): touches 2, pulls 1, one path node freed', () => {
  const ctx = mkCtx(16, 1, 3, 12, 96);
  buildLens(ctx, 0, 2, [10, 10, 10]);
  assert.equal(shapeStr(ctx.views[0]), '((L10 L10)w2 L10)w3');
  const y = checkSplit(ctx, 0, 1, 10, 'boundary hand');
  const C_ = SumSequence.COUNTERS;
  assert.equal(y.dA[C_.touches], 2);
  assert.equal(y.dA[C_.pulls], 1);
  assert.equal(y.dA[C_.joinSteps], 0);
  assert.equal(y.dA[C_.rotSingle] + y.dA[C_.rotDouble], 0);
  assert.equal(y.dA[C_.moves], 0);
});

// mid-leaf cut of [10, 10] at 15: one internal (L10 L10), d(c) = 1. Root went right: X = join(L10, L5) = fresh node,
// pulls 1. R = [5]. touches 1, pulls 1, moves 5, one leaf allocated, internals 1 -> 1 + 0.
test('S-R3 hand trace: mid-leaf cut of (L10 L10) at 15: touches 1, pulls 1, moves 5, one leaf allocated', () => {
  const ctx = mkCtx(16, 1, 2, 13, 64);
  buildLens(ctx, 0, 1, [10, 10]);
  ctx.views[1].clear(); ctx.orc[1].clear();
  const y = checkSplit(ctx, 0, 1, 15, 'mid hand');
  const C_ = SumSequence.COUNTERS;
  assert.equal(y.dA[C_.touches], 1);
  assert.equal(y.dA[C_.pulls], 1);
  assert.equal(y.dA[C_.moves], 5);
});

// ---- R-J1 pulls inside splitAt: hand-traced rotation rows, B = 4 (m = 1: no repair can fire) ----
// DOUBLE: view 0 = 16 sequential inserts = (L4 (L4 (L4 L4)w2)w3)w4 =: S (leaves 4|4|4|4); view 2 = 5 sequential inserts
// = (L4 L1)w2 =: Q. S.append(Q): join(S w4, Q w2): 3*2 < 4 false -> c = Q, balanced against 4 (6 >= 4, 12 >= 2): no
// spine, fresh node (S Q) w6: T = ((L4 (L4 (L4 L4)w2)w3)w4 (L4 L1)w2)w6.
// splitAt(18): elements 0..15 are S, 16..19 are Q's first leaf: 18 is inside it, p = 2 (mid-leaf, s - p = 2 moves).
// Path: root -> right (off 2), Q node -> left (off 2): d(c) = 2 = touches. Cut: X = L2 (left part), R = L2 (right part).
// Bottom-up: Q node went left -> R := join(R = L2, sibling L1) = fresh node: pulls 1, js 0. Root went right -> X := join(S, X):
// a = S w4, b = L2 w1: 3*1 < 4 -> heavy a, c = S; unbalanced (3*1 >= 4 fails) -> push S, c = (L4 (L4 L4)w2)w3: w 3 vs 1:
// 9 >= 1 and 3 >= 3 -> stop. js = 1. Fresh u = (c, X) w4: 1 pull. Pop S: p = (L4, u): wl 1, wr 4: 3*1 >= 4 fails ->
// rotate left; single would give nl = (L4 c) w4, top = (nl, X): bal(4, 1) fails -> DOUBLE: 3 pulls. Join pulls =
// 1 + 1 + 3 = 5. Totals: touches 2, pulls 5 + 1 = 6, moves 2, joinSteps 1, rotSingle 0, rotDouble 1, repairs 0.
// Results: this = 5 leaves [4, 4, 4, 4, 2], out = [2, 1].
test('S-R3 R-J1 hand trace: splitAt(18) of ((S)(Q)) with an inner join that does one DOUBLE rotation', () => {
  const ctx = mkCtx(4, 1, 3, 21, 200);
  for (let q = 0; q < 16; q++) ins(ctx, 0, ctx.views[0].length, q, 1);
  for (let q = 0; q < 5; q++) ins(ctx, 1, ctx.views[1].length, q, 1);
  assert.equal(shapeStr(ctx.views[0]), '(L4 (L4 (L4 L4)w2)w3)w4');
  assert.equal(shapeStr(ctx.views[1]), '(L4 L1)w2');
  ctx.orc[0].append(ctx.orc[1]);
  ctx.views[0].append(ctx.views[1]);
  assert.equal(shapeStr(ctx.views[0]), '((L4 (L4 (L4 L4)w2)w3)w4 (L4 L1)w2)w6');
  const y = checkSplit(ctx, 0, 2, 18, 'double rotation');
  const C_ = SumSequence.COUNTERS;
  assert.equal(y.dA[C_.touches], 2);
  assert.equal(y.dA[C_.pulls], 6);
  assert.equal(y.dA[C_.moves], 2);
  assert.equal(y.dA[C_.joinSteps], 1);
  assert.equal(y.dA[C_.rotSingle], 0);
  assert.equal(y.dA[C_.rotDouble], 1);
  assert.equal(y.dA[C_.seamRepairs], 0);
  assert.deepEqual(y.leftLens, [4, 4, 4, 4, 2]);
  assert.deepEqual(y.rightLens, [2, 1]);
});

// SINGLE: views a (1 element), b (29 sequential), c (5 sequential), out = view 3. a.append(b) then a.append(c). Shapes
// (sequential inserts at B = 4, m = 1: append splits are 4|1): b = ((L4 L4)w2 ((L4 L4)w2... ; the joined tree, pinned
// below as a string and traced by hand:
//   T = ((L1 (L4 L4)w2)w3 (((L4 L4)w2 (L4 (L4 (L4 L1)w2)w3)w4)w6 (L4 L1)w2)w8)w11   (11 leaves, 35 elements)
// splitAt(5): element 5 is the first element of the second L4 (L1 = idx 0, L4 = 1..4, L4 = 5..8): a BOUNDARY cut, p = 0.
// Path: root -> left (5 < 9), (L1, (L4 L4)) -> right (off 4), (L4 L4) -> right (off 0): d(c) = 3 = touches.
// R = that whole L4 (#2), X = null. Bottom-up: inner went right -> X = sibling L4#1. Middle went right -> X := join(L1, L4#1) =
// fresh node, pulls 1, js 0 (balanced pair). Root went left -> R := join(L4#2, W8) with W8 = (W6 (L4 L1)w2): a = leaf w1,
// b = W8: 3*8 < 1 false -> c = b, wo = 1; 8 vs 1 unbalanced -> push W8, c = W6 (6 vs 1 unbalanced) -> push W6,
// c = (L4 L4)w2 (2 vs 1: 6 >= 1 and 3 >= 2 balanced) -> stop: js = 2. Fresh u = (L4#2, (L4 L4)w2) w3: pull 1. Pop W6:
// (u w3, (L4 (L4 (L4 L1)w2)w3)w4): wl 3, wr 4 balanced: pull 2. Pop W8: (that w7, (L4 L1)w2): wl 7, wr 2: 3*2 >= 7
// fails -> rotate right: x = (u w3, V w4), z = (L4 L1) w2: single gives nr = (V w4, z w2) w6 and top = (u w3, nr w6): bal(4,2)
// ok (6 >= 4), bal(3,6) ok (9 >= 6) -> SINGLE rotation: pulls 3 + 2 = 5. Join pulls: 1 + 1 + 1 ... counted as: fresh 1,
// pop W6 1, pop W8 1, rotation 2 = 5. Left join 1. Totals: touches 3, pulls 6, moves 0, joinSteps 2, rotSingle 1,
// rotDouble 0, repairs 0. Results: this [1, 4]; out [4, 4, 4, 4, 4, 4, 1, 4, 1] (30 elements).
test('S-R3 R-J1 hand trace: splitAt(5) boundary cut whose right-side join does one SINGLE rotation', () => {
  const ctx = mkCtx(4, 1, 4, 22, 200);
  ins(ctx, 0, 0, 0, 1);
  for (let q = 0; q < 29; q++) ins(ctx, 1, ctx.views[1].length, q, 1);
  for (let q = 0; q < 5; q++) ins(ctx, 2, ctx.views[2].length, q, 1);
  ctx.orc[0].append(ctx.orc[1]); ctx.views[0].append(ctx.views[1]);
  ctx.orc[0].append(ctx.orc[2]); ctx.views[0].append(ctx.views[2]);
  assert.equal(shapeStr(ctx.views[0]), '((L1 (L4 L4)w2)w3 (((L4 L4)w2 (L4 (L4 (L4 L1)w2)w3)w4)w6 (L4 L1)w2)w8)w11');
  const y = checkSplit(ctx, 0, 3, 5, 'single rotation');
  const C_ = SumSequence.COUNTERS;
  assert.equal(y.dA[C_.touches], 3);
  assert.equal(y.dA[C_.pulls], 6);
  assert.equal(y.dA[C_.moves], 0);
  assert.equal(y.dA[C_.joinSteps], 2);
  assert.equal(y.dA[C_.rotSingle], 1);
  assert.equal(y.dA[C_.rotDouble], 0);
  assert.equal(y.dA[C_.seamRepairs], 0);
  assert.deepEqual(y.leftLens, [1, 4]);
  assert.deepEqual(y.rightLens, [4, 4, 4, 4, 4, 4, 1, 4, 1]);
});

// ---- RS-3 guard sides: i = 0, i = length, empty this ----
for (const B of [4, 16]) {
  for (const dims of [1, 2]) {
    for (const k of [2, 3]) {
      test('S-R3 guard sides i = 0 / i = length / empty this: B=' + B + ' dims=' + dims + ' k=' + k + ' (touches 0, no node allocated or freed)', () => {
        let rows = 0;
        for (const shape of ['E', 'S', 'O', 'M']) {
          if (shape === 'S' && (B >> 2) < 2) continue;
          for (const at of ['zero', 'end']) {
            const ctx = mkCtx(B, dims, k, 31 + rows);
            if (k === 3) fillShape(ctx, 2, 'M', 'this');
            fillShape(ctx, 0, shape, 'this');
            const n = ctx.views[0].length;
            const i = at === 'zero' ? 0 : n;
            const hdrPre = Array.from(ctx.views[0]._hdr);
            const poolPre = ctx.f.snapshot();
            const y = checkSplit(ctx, 0, 1, i, shape + '/' + at);
            const C_ = SumSequence.COUNTERS;
            assert.deepEqual(y.dA, new Array(NC).fill(0), 'all 12 counters 0');
            assert.deepEqual(Array.from(ctx.views[0]._hdr), hdrPre, 'hdr (live, bumps, free heads) unchanged: no node allocated or freed');
            const poolPost = ctx.f.snapshot();
            assert.equal(json(poolPost.int) + json(poolPost.leaf), json(poolPre.int) + json(poolPre.leaf), 'no pool write');
            assert.equal(C_.touches, 0);
            // the finished split leaves both views usable and reversible
            checkAppend(ctx, 0, 1, shape + '/' + at + ' re-append');
            rows++;
          }
        }
        assert.ok(rows >= 6, 'coverage ' + rows);
      });
    }
  }
}

test('S-R3 index -0 acts as 0 (C-10): splitAt(-0, out) moves the whole view', () => {
  const ctx = mkCtx(4, 1, 2, 41);
  fillShape(ctx, 0, 'M', 'this');
  const n = ctx.views[0].length;
  ctx.orc[0].splitAt(0, ctx.orc[1]);
  const r = ctx.views[0].splitAt(-0, ctx.views[1]);
  assert.equal(r, ctx.views[0]);
  assert.equal(ctx.views[0].length, 0);
  assert.equal(ctx.views[1].length, n);
  assert.equal(walk(ctx.f.snapshot(), ctx.walkOpts), null);
  for (let j = 0; j < 2; j++) checkAgainstOracle(ctx, j, '-0');
});

// ---- the grid: every cut position of seeded shapes, B = 4 / 8 / 16, dims 1 / 2: the whole surface ----
for (const [B, dims] of [[4, 1], [8, 2], [16, 1]]) {
  test('S-R3 every cut position: B=' + B + ' dims=' + dims + ' (all i in [0, n] on seeded multi-level shapes, whole surface, round trip)', () => {
    const cov = { cuts: 0, mid: 0, boundary: 0, ends: 0, reps: 0, rot: 0, merges: 0, eqs: 0 };
    for (let seed = 0; seed < 3; seed++) {
      const ctx = mkCtx(B, dims, 3, 500 + seed * 7 + B, 6 * 10 * B);
      fillShape(ctx, 0, 'M', 'this');
      for (let q = 0; q < 4 * B; q++) insRand(ctx, 0);
      fillShape(ctx, 2, 'M', 'this');
      const n = ctx.views[0].length;
      const ansWhole = json(answers(ctx.views[0], dims));
      for (let i = 0; i <= n; i++) {
        const y = checkSplit(ctx, 0, 1, i, 'seed ' + seed);
        cov.cuts++;
        if (y.x.kind === 'cut') { if (y.x.mid) cov.mid++; else cov.boundary++; } else cov.ends++;
        cov.reps += y.x.reps;
        cov.merges += y.x.merges;
        cov.eqs += y.x.eqs;
        if (y.x.rs + y.x.rd > 0) cov.rot++;
        // round trip: append(out) restores the sequence; the full append surface runs too
        checkAppend(ctx, 0, 1, 'seed ' + seed + ' i=' + i + ' re-append');
        assert.equal(ctx.views[0].length, n);
        assert.equal(json(answers(ctx.views[0], dims)), ansWhole, 'round trip restores the sequence at i=' + i);
        assert.equal(json(oracleAnswers(ctx.orc[0], dims)), ansWhole, 'oracle agrees');
      }
    }
    assert.ok(cov.mid >= 40 && cov.boundary >= (B === 4 ? 4 : 0) && cov.ends >= 6, 'coverage floor: ' + json(cov));
    assert.ok(cov.rot >= (B === 4 ? 4 : 0), 'coverage floor: cuts whose joins rotate ' + cov.rot);
    if (B >= 8) assert.ok(cov.reps >= 6 && cov.merges >= 1 && cov.eqs >= 1, 'coverage floor: repairs ' + json(cov));
    else assert.equal(cov.reps, 0, 'B = 4 (m = 1): no leaf is short');
  });
}

// ---- errors (ASSERTION 3): both views (and a third at k = 3) byte-identical, RangeError, token ----

function expectSplitErr(v, i, out, re, all, label) {
  const before = stateAll(all);
  let err = null;
  try { v.splitAt(i, out); } catch (e) { err = e; }
  assert.ok(err !== null, label + ': must throw');
  assert.ok(err instanceof RangeError, label + ': RangeError, got ' + (err && err.constructor.name));
  assert.match(err.message, re, label + ': token');
  assert.equal(stateAll(all), before, label + ': both views, all columns, hdr, fingers (_fl/_fb/_fdepth/_fpath), _cv, counters byte-identical');
  return err;
}

for (const B of [4, 16]) {
  for (const dims of [1, 2]) {
    for (const k of [2, 3]) {
      test('S-R3 splitAt errors: index, operand, order, B=' + B + ' dims=' + dims + ' k=' + k, TMO, () => {
        const ctx = errCtx(B, dims, k, 81);
        const [v, w] = ctx.views;
        const all = ctx.views;
        const n = v.length;
        const Y = errCtx(B, dims, 2, 82);
        const allXY = ctx.views.concat(Y.views);
        // non-empty out (same arena), a valid index: operand
        expectSplitErr(v, 1, w, /operand/, all, 'non-empty out');
        expectSplitErr(v, 0, w, /operand/, all, 'non-empty out, i = 0');
        expectSplitErr(v, n, w, /operand/, all, 'non-empty out, i = length');
        // an empty out: the last view, cleared (k = 2: w itself)
        const e = ctx.views[k - 1];
        if (k === 2) { w.clear(); ctx.orc[1].clear(); }
        else { e.clear(); ctx.orc[2].clear(); }
        for (const w2 of ctx.views) { primeFinger(ctx, ctx.views.indexOf(w2)); w2._cv = true; }
        // index errors with a VALID empty out
        const forgedPlain = Object.assign({}, e);
        const stub = synthStub(64, { leafSize: B, dims }, 1).views[0];
        const bads = [-1, n + 1, n + 1000, 1.5, NaN, Infinity, -Infinity, '1', null, undefined, {}, [], true, 2 ** 53, 2 ** 31, -(2 ** 31)];
        for (const bad of bads) {
          expectSplitErr(v, bad, e, /index/, allXY, 'bad index ' + String(bad));
          // index BEFORE operand (C-10): a bad index with a bad / foreign / self / non-empty operand still says index
          expectSplitErr(v, bad, Y.views[0], /index/, allXY, 'bad index ' + String(bad) + ' + foreign out');
          expectSplitErr(v, bad, undefined, /index/, allXY, 'bad index ' + String(bad) + ' + not a view');
          expectSplitErr(v, bad, v, /index/, allXY, 'bad index ' + String(bad) + ' + self');
        }
        expectSplitErr(v, -1, Y.views[0], /index/, allXY, 'splitAt(-1, foreign): index first');
        assert.doesNotMatch(String(expectSplitErr(v, -1, Y.views[0], /index/, allXY, 'msg').message), /operand/);
        // operand errors with a valid index
        let cnt = 0;
        for (const bad of [undefined, null, 5, 'x', {}, [], () => 0, forgedPlain, Object.assign(Object.create(SumSequence.prototype), e), new Oracle(dims), stub]) {
          expectSplitErr(v, 1, bad, /operand/, allXY, 'not a view #' + cnt++);
        }
        expectSplitErr(v, 1, v, /operand/, allXY, 'out === this');
        expectSplitErr(v, 0, v, /operand/, allXY, 'out === this, i = 0');
        expectSplitErr(v, n, v, /operand/, allXY, 'out === this, i = length');
        // cross-arena, incl. non-empty foreign (arena check before non-empty)
        expectSplitErr(v, 1, Y.views[0], /operand/, allXY, 'cross-arena non-empty out');
        expectSplitErr(v, 1, Y.views[0], /SumSequence\.arena/, allXY, 'cross-arena names SumSequence.arena');
        Y.views[1].clear(); Y.orc[1].clear();
        expectSplitErr(v, 1, Y.views[1], /SumSequence\.arena/, allXY, 'cross-arena empty out names SumSequence.arena');
        // an empty this: index 1 is length + 1
        expectSplitErr(e, 1, Y.views[1], /index/, allXY, 'empty this, i = 1: index');
        expectSplitErr(e, 0, Y.views[1], /SumSequence\.arena/, allXY, 'empty this, cross-arena');
        expectSplitErr(e, 0, e, /operand/, allXY, 'empty this, out === this');
        // k = 1 ctor views (each its own arena)
        const o = { leafSize: B, dims };
        const c1 = new SumSequence(64, o);
        const c2 = new SumSequence(64, o);
        for (let q = 0; q < 6; q++) c1.insertAt(q, q, 1, dims === 1 ? undefined : 1);
        const trio = [c1, c2, e, v];
        expectSplitErr(c1, 1, c2, /SumSequence\.arena/, trio, 'ctor vs ctor');
        expectSplitErr(c1, 1, e, /SumSequence\.arena/, trio, 'ctor this, arena out');
        expectSplitErr(e, 0, c2, /SumSequence\.arena/, trio, 'arena this, ctor out');
        expectSplitErr(c2, 0, c1, /operand/, trio, 'empty ctor this, non-empty ctor out');
        expectSplitErr(c2, 1, c1, /index/, trio, 'empty ctor this, i = 1');
        assert.equal(cnt, 11);
      });
    }
  }
}

// the 'pool' pre-check (C-3, C-10, R-E4): the LEAF pool poked exhausted. A MID-leaf cut needs one leaf -> RangeError 'pool',
// nothing changed (the finger is NOT invalidated); a BOUNDARY cut, i = 0, i = length need none -> succeed.
for (const B of [4, 16]) {
  for (const dims of [1, 2]) {
    for (const k of [2, 3]) {
      test('S-R3 splitAt pool pre-check: B=' + B + ' dims=' + dims + ' k=' + k + ' (leaf pool exhausted: mid-leaf cut fails clean, boundary / ends succeed)', TMO, () => {
        const ctx = errCtx(B, dims, k, 91);
        const [v, w] = ctx.views;
        w.clear(); ctx.orc[1].clear(); // out empty
        primeFinger(ctx, 0);
        for (const x of ctx.views) x._cv = true;
        const pre = ctx.f.snapshot();
        const n = v.length;
        const mt = modelOfSnap(pre, 0);
        let mid = -1;
        let bnd = -1;
        for (let i = 1; i < n; i++) {
          const p = refSplit(mt, i).p;
          if (p > 0 && mid < 0) mid = i;
          if (p === 0 && bnd < 0) bnd = i;
        }
        assert.ok(mid > 0 && bnd > 0, 'precondition: a mid-leaf and a boundary position exist');
        const hdr = v._hdr;
        const saveB = hdr[1];
        const saveF = hdr[2];
        const fl = v._fl;
        const fb = v._fb;
        const fd = v._fdepth;
        hdr[1] = v._ar.Lmax; // YG_LBUMP at its max
        hdr[2] = -1;         // YG_LFREE = END
        try {
          expectSplitErr(v, mid, w, /pool/, ctx.views, 'leaf pool exhausted, mid-leaf cut at ' + mid);
          assert.equal(v._fl, fl, 'finger NOT invalidated by the pre-check');
          assert.equal(v._fb, fb);
          assert.equal(v._fdepth, fd);
          assert.notEqual(v._fl, ctx.NIL);
          assert.equal(v._cv, true);
          // a boundary cut needs no leaf
          ctx.orc[0].splitAt(bnd, ctx.orc[1]);
          const r = v.splitAt(bnd, w);
          assert.equal(r, v);
          assert.equal(v.length, bnd);
          assert.equal(w.length, n - bnd);
          assert.equal(hdr[1], v._ar.Lmax, 'no leaf allocated');
          assert.equal(hdr[2], -1, 'no leaf freed (a boundary cut never repairs)');
        } finally { hdr[1] = saveB; hdr[2] = saveF; }
        assert.equal(walk(ctx.f.snapshot(), ctx.walkOpts), null);
        for (let j = 0; j < k; j++) checkAgainstOracle(ctx, j, 'after the boundary cut under a poked pool');
        // restored: re-append, then the same mid cut now succeeds
        checkAppend(ctx, 0, 1, 'restore');
        checkSplit(ctx, 0, 1, mid, 'mid cut after restore');
        checkAppend(ctx, 0, 1, 'before the free-list-only row');
        // the free-list term alone: bump exhausted, free list NON-empty (w.clear() put w's leaves there) -> a mid cut succeeds.
        // (checkSplit's walker would flag the poked bump as a leak, so the split runs inline and the bump is restored first.)
        {
          const fHead = hdr[2];
          assert.notEqual(fHead, -1, 'precondition: the leaf free list is non-empty');
          const bumpReal = hdr[1];
          const mt2 = modelOfSnap(ctx.f.snapshot(), 0); // the re-append may have reshaped the tree: pick a mid-leaf cut again
          let mid2 = -1;
          for (let q = 1; q < v.length && mid2 < 0; q++) if (refSplit(mt2, q).p > 0) mid2 = q;
          assert.ok(mid2 > 0, 'precondition: a mid-leaf position');
          ctx.orc[0].splitAt(mid2, ctx.orc[1]);
          hdr[1] = v._ar.Lmax;
          let r2;
          try { r2 = v.splitAt(mid2, w); } finally { const bumped = hdr[1]; hdr[1] = bumpReal; assert.equal(bumped, v._ar.Lmax, 'bump still at Lmax (bump not used)'); }
          assert.equal(r2, v);
          assert.notEqual(hdr[2], fHead, 'bump exhausted, free list non-empty: the free head was used');
          assert.equal(hdr[1], bumpReal);
          assert.equal(v.length, mid2);
          assert.equal(walk(ctx.f.snapshot(), ctx.walkOpts), null);
          for (let j = 0; j < k; j++) checkAgainstOracle(ctx, j, 'free-list-only row');
        }
        // i = 0 and i = length under a poked pool
        for (const at of ['zero', 'end']) {
          checkAppend(ctx, 0, 1, 'again');
          const len = v.length;
          const sB = hdr[1];
          const sF = hdr[2];
          hdr[1] = v._ar.Lmax; hdr[2] = -1;
          try {
            ctx.orc[0].splitAt(at === 'zero' ? 0 : len, ctx.orc[1]);
            v.splitAt(at === 'zero' ? 0 : len, w);
          } finally { hdr[1] = sB; hdr[2] = sF; }
          assert.equal(v.length, at === 'zero' ? 0 : len);
          assert.equal(walk(ctx.f.snapshot(), ctx.walkOpts), null);
          for (let j = 0; j < k; j++) checkAgainstOracle(ctx, j, 'poked pool, ' + at);
        }
      });
    }
  }
}

// ---- lane: seeded cycles of insertAt / removeAt / splitAt (+ append back), walker + oracle after EVERY op ----
for (const B of [4, 8, 16]) {
  test('S-R3 lane: B=' + B + ', 120 seeded cycles of insertAt / removeAt / splitAt / append (random cut positions, ends, leaf boundaries), whole surface after every split', () => {
    const dims = B === 8 ? 2 : 1;
    const C = B === 16 ? 600 : B === 8 ? 300 : 150;
    const keyR = xs(0x51A1C0DE ^ B);     // positions
    const valR = xs(0x7E57DA7A + B);     // entity / measure values
    const opR = xs(0xFACE0000 + B);      // op kind, view picks
    const cov = { ops: 0, splits: 0, mid: 0, boundary: 0, ends: 0, reps: 0, merges: 0, eqs: 0, both: 0, rot: 0, back: 0 };
    for (let cyc = 0; cyc < 120; cyc++) {
      const ctx = mkCtx(B, dims, 3, 2000 + cyc, C);
      ctx.key = keyR; ctx.val = valR;
      const nOps = 80 + (opR() % 30);
      for (let s = 0; s < nOps; s++) {
        const j = opR() % 3;
        const v = ctx.views[j];
        const kind = opR() % 100;
        const live = v._hdr[0];
        if (kind < 16 && v.length >= 2) {
          let b = -1;
          for (let q = 1; q < 3; q++) if (ctx.views[(j + q) % 3].length === 0) { b = (j + q) % 3; break; }
          if (b < 0) { b = (j + 1 + (opR() % 2)) % 3; ctx.views[b].clear(); ctx.orc[b].clear(); }
          const n = v.length;
          const pick = opR() % 16;
          let i;
          if (pick === 0) i = 0;
          else if (pick === 1) i = n;
          else if (pick < 6 && n > 0) { // a leaf boundary
            const lens = leafLens(ctx.f.snapshot(), j);
            let acc = 0;
            const starts = [];
            for (const l of lens) { starts.push(acc); acc += l; }
            i = starts.length > 1 ? starts[1 + (opR() % (starts.length - 1))] : starts[0];
          } else if (pick < 10 && n > 0) { // one element off a leaf edge: the cut leaves a short part (repair candidates)
            const lens = leafLens(ctx.f.snapshot(), j);
            const q = opR() % lens.length;
            let acc = 0;
            for (let r = 0; r < q; r++) acc += lens[r];
            i = acc + (opR() % 2 === 0 ? 1 : Math.max(lens[q] - 1, 1));
            if (i > n) i = n;
          } else i = keyR() % (n + 1);
          const y = checkSplit(ctx, j, b, i, 'lane B=' + B + ' cyc ' + cyc + ' op ' + s);
          cov.splits++;
          if (y.x.kind === 'cut') { if (y.x.mid) cov.mid++; else cov.boundary++; } else cov.ends++;
          cov.reps += y.x.reps; cov.merges += y.x.merges; cov.eqs += y.x.eqs;
          if (y.x.reps === 2) cov.both++;
          if (y.x.rs + y.x.rd > 0) cov.rot++;
          if (opR() % 2 === 0) { checkAppend(ctx, j, b, 'lane back'); cov.back++; }
        } else if (kind < 26 && v.length > 0) {
          const at = keyR() % v.length;
          assert.equal(v.removeAt(at), ctx.orc[j].removeAt(at));
        } else if (live < C) {
          insRand(ctx, j);
        }
        cov.ops++;
        walkOk(ctx, 'lane B=' + B + ' cyc ' + cyc + ' op ' + s);
        for (let q = 0; q < 3; q++) checkAgainstOracle(ctx, q, 'lane B=' + B + ' cyc ' + cyc + ' op ' + s);
      }
    }
    assert.ok(cov.splits >= 1000, 'coverage floor: splits ' + json(cov));
    assert.ok(cov.mid >= 400, 'coverage floor: mid-leaf cuts ' + json(cov));
    assert.ok(cov.ends >= 60, 'coverage floor: i in {0, length} / empty ' + json(cov));
    assert.ok(cov.boundary >= (B === 4 ? 30 : 5), 'coverage floor: boundary cuts ' + json(cov));
    assert.ok(cov.back >= 300, 'coverage floor: split + append back ' + json(cov));
    if (B >= 8) assert.ok(cov.reps >= 8 && cov.merges >= 2 && cov.eqs >= 2, 'coverage floor: repairs (m = 2: a short leaf is 1) ' + json(cov));
    else assert.equal(cov.reps, 0, 'B = 4 (m = 1): no repair');
  });
}
