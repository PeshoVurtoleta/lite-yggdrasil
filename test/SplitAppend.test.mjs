// test/SplitAppend.test.mjs -- rung 5 (S-R1). Section 1: clear() free-walk. ADR 0004 A-6 (clear: O(1) reset only
// when no other view holds a node, else a free-walk of this view's nodes), 0005 C-8 (clear keeps _n; the cleared view
// is the constructed state), C-15 (pools sized for count), C-25 (clear writes no counter), C-28 (walker I-7 census,
// I-9 finger). Section 2 (rung 6 S-R2, append: join + seam repair) is appended below the section-1 rows; section 3
// (splitAt) comes in a later rung.
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
