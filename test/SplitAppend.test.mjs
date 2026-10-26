// test/SplitAppend.test.mjs -- rung 5 (S-R1). Section 1: clear() free-walk. ADR 0004 A-6 (clear: O(1) reset only
// when no other view holds a node, else a free-walk of this view's nodes), 0005 C-8 (clear keeps _n; the cleared view
// is the constructed state), C-15 (pools sized for count), C-25 (clear writes no counter), C-28 (walker I-7 census,
// I-9 finger). Sections 2 / 3 (append, splitAt) come in later rungs.
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
