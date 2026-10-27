// test/Cursor.test.mjs -- the cursor rung K-R1: cursor(), seekIndex / seekSum, valid / index / entity, offset / measure
// (ADR 0005 C-6, C-7, C-10, C-13, C-25, C-26, C-27, C-40, ruling R-E3; brief .handoff/k1-briefs/helpers.md H1).
//
// Every expected value comes from the SPEC and the plain-array model test/oracle.mjs (Oracle.cursor(): one linear model
// cursor per Oracle), never from the engine. The touches expectation is a walker-style depth recount of the PRE
// snapshot (test/adapter.mjs snapshot, leaf depth = internal nodes above the leaf, 0003 G-10); no engine value is read
// to derive an expectation. next() is not here (K-R2).
//
// Rows (each is a named row; the mutant table at the bottom kills the cv anchors by NAME):
//   1 C-40 mutate    per mutator class (insertAt, removeAt, setMeasure, splitAt, append(this), append(other), clear):
//                    seek -> mutate -> valid false, index -1, entity -1, offset / measure NaN for every d
//   2 C-6 RangeError per class: a rejected call leaves valid, index, entity, offset(d), measure(d) Object.is-equal
//   3 reads / cross-view / out view
//   4 seek walk      B {4, 8, 16} x dims {1, 4} x n 0..40, plus a 1000-append stream, against Oracle.cursor()
//   5 end / empty    R-E3: i = length, y >= total, an empty view -> false, index -1, entity -1, NaN
//   6 validation     tokens 'index' / 'dim' / 'seek', -0, throw leaves the cursor and _cv unchanged
//   7 counts         per seek: touches === d(t), every other counter 0 (C-26), finger and all other state
//                    byte-identical (C-27), other views unchanged
//   8 shape          one cursor per view, prototype getters, exports
//   9 teeth          buildMutant drops of each `// cv:` store, the validation-order mutant, the pre-rung build
// Randomized rows use a seeded 32-bit xorshift with independent op / measure / probe streams and a coverage floor.
// ASCII-only.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import * as YLive from '../Yggdrasil.js';
import { engineFactory } from './adapter.mjs';
import { buildMutant } from './mutant-build.mjs';
import { Oracle } from './oracle.mjs';

const HERE = (p) => fileURLToPath(new URL(p, import.meta.url));
const YPATH = HERE('../Yggdrasil.js');

// ------------------------------------------------------------------ helpers

// 32-bit xorshift; one stream per concern, derived from distinct seeds.
function rng(seed) {
  let x = (seed >>> 0) || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x; };
}

const mkArena = (Y, B, dims, count, C) => Y.SumSequence.arena(C, { leafSize: B, dims }, count);

// insert (e, measures) at i on a view or an Oracle (the two share the call shape)
function ins(w, dims, i, e, ms) {
  if (dims === 1) w.insertAt(i, e, ms[0]);
  else if (dims === 2) w.insertAt(i, e, ms[0], ms[1]);
  else w.insertAt(i, e, ms[0], ms[1], ms[2], ms[3]);
}

// Fill view w and oracle o with n elements; positions from ropr, measures from rm (5% zeros), entities counted.
function fill(w, o, dims, n, ropr, rm, mode) {
  for (let k = 0; k < n; k++) {
    const i = mode === 'append' ? k : ropr() % (k + 1);
    const ms = [];
    for (let d = 0; d < dims; d++) ms.push(rm() % 20 === 0 ? 0 : 1 + (rm() % 9));
    ins(w, dims, i, k + 1, ms);
    ins(o, dims, i, k + 1, ms);
  }
}

// Every observable cursor field as a flat array; deepStrictEqual compares with Object.is (NaN equals NaN, -0 != 0).
function fields(c, dims) {
  const out = [c.valid, c.index, c.entity];
  for (let d = 0; d < dims; d++) out.push(c.offset(d));
  for (let d = 0; d < dims; d++) out.push(c.measure(d));
  return out;
}

const tokenErr = (tok) => (e) => e instanceof RangeError && e.message.startsWith(tok + ' ');

// the cursor equals the model cursor in every field (and the model says what the spec says)
function sameAsModel(c, oc, dims, msg) {
  assert.deepEqual(fields(c, dims), fields(oc, dims), msg);
}

function assertDead(c, dims, msg) {
  assert.equal(c.valid, false, msg + ' valid');
  assert.equal(c.index, -1, msg + ' index');
  assert.equal(c.entity, -1, msg + ' entity');
  for (let d = 0; d < dims; d++) {
    assert.ok(Number.isNaN(c.offset(d)), msg + ' offset ' + d);
    assert.ok(Number.isNaN(c.measure(d)), msg + ' measure ' + d);
  }
}

// ------------------------------------------------------------ rows 1 / 2 / 3
// Rows take Y (a module namespace: live or mutant) so the mutant table runs the very same row functions.

const DIMS = 2;
// a: 20 elements, b: 6, c: 4 (view 2 stays out of every operation); all three get a seeked cursor unless noted.
function scene(Y, withB) {
  const views = mkArena(Y, 4, DIMS, 3, 64);
  const orc = [new Oracle(DIMS), new Oracle(DIMS), new Oracle(DIMS)];
  const rp = rng(11), rm = rng(23);
  fill(views[0], orc[0], DIMS, 20, rp, rm, 'rand');
  if (withB) fill(views[1], orc[1], DIMS, 6, rp, rm, 'rand');
  fill(views[2], orc[2], DIMS, 4, rp, rm, 'rand');
  return { views, orc };
}

// [name, (x, y) => mutate (x = this view or oracle, y = the other / out)]; row 1 drops the cursor of the TARGET only
const MUT = [
  ['insertAt', (x) => x.insertAt(3, 77, 5, 6)],
  ['removeAt', (x) => x.removeAt(3)],
  ['setMeasure', (x) => x.setMeasure(3, 1, 9)],
  ['splitAt', (x, y) => x.splitAt(7, y)],
  ['append', (x, y) => x.append(y)],
  ['appendOther', (x, y) => x.append(y)],
  ['clear', (x) => x.clear()],
];

function row1(Y, name) {
  const fn = MUT.find((m) => m[0] === name)[1];
  const withB = name === 'append' || name === 'appendOther';
  const { views, orc } = scene(Y, withB);
  const [a, b, c] = views;
  // splitAt's out is view 1 and empty; append(this) kills this; appendOther seeks only the OTHER and it dies
  const target = name === 'appendOther' ? b : a;
  const ot = name === 'appendOther' ? orc[1] : orc[0];
  assert.equal(target.cursor().seekIndex(0), true);
  assert.equal(ot.cursor().seekIndex(0), true);
  assert.equal(c.cursor().seekIndex(1), true);
  orc[2].cursor().seekIndex(1);
  assert.equal(target.cursor().valid, true, name + ' valid before');
  assert.equal(target.cursor().index, 0);
  fn(a, b);
  fn(orc[0], orc[1]);
  assertDead(target.cursor(), DIMS, name + ' after mutate');
  sameAsModel(target.cursor(), ot.cursor(), DIMS, name + ' model');
  // view 2 never took part: its cursor is untouched
  sameAsModel(c.cursor(), orc[2].cursor(), DIMS, name + ' bystander view');
  assert.equal(c.cursor().valid, true);
  if (name === 'append') { assertDead(b.cursor(), DIMS, 'append other after'); }
  if (name === 'splitAt') assertDead(b.cursor(), DIMS, 'splitAt out after');
  if (name === 'removeAt') {
    // the n === 1 drain exit (ygDrain) is removeAt's second exit: its cursor dies too
    const [s1] = mkArena(Y, 4, 1, 1, 16);
    s1.insertAt(0, 7, 5);
    assert.equal(s1.cursor().seekIndex(0), true);
    s1.removeAt(0);
    assertDead(s1.cursor(), 1, 'removeAt drain exit');
  }
}

// [name, kind, thunk(x, y, z, len) -> throws]: bad index / operand / measure, each class
const BAD = [
  ['insertAt', 'index', (x, y, z, n) => x.insertAt(n + 1, 1, 1, 1)],
  ['insertAt', 'index', (x) => x.insertAt(-1, 1, 1, 1)],
  ['insertAt', 'entity', (x) => x.insertAt(0, -1, 1, 1)],
  ['insertAt', 'measure', (x) => x.insertAt(0, 1, -1, 1)],
  ['removeAt', 'index', (x, y, z, n) => x.removeAt(n)],
  ['removeAt', 'index', (x) => x.removeAt(1.5)],
  ['setMeasure', 'index', (x, y, z, n) => x.setMeasure(n, 0, 1)],
  ['setMeasure', 'dim', (x) => x.setMeasure(0, 2, 1)],
  ['setMeasure', 'measure', (x) => x.setMeasure(0, 0, -1)],
  ['splitAt', 'index', (x, y, z, n) => x.splitAt(n + 1, y)],
  ['splitAt', 'operand', (x) => x.splitAt(3, x)],
  ['splitAt', 'operand', (x, y, z) => x.splitAt(3, z)], // z is non-empty
  ['splitAt', 'operand', (x) => x.splitAt(3, null)],
  ['append', 'operand', (x) => x.append(x)],
  ['append', 'operand', (x) => x.append(null)],
  ['append', 'operand', (x) => x.append({})],
];

function row2(Y, name) {
  let cases = 0;
  for (const [cls, tok, thunk] of BAD) {
    if (cls !== name) continue;
    for (const state of ['valid', 'end']) {
      const { views, orc } = scene(Y, true);
      const [a, b, c] = views;
      const n = a.length;
      for (const w of [a, b, c]) w.cursor().seekIndex(2);
      for (const o of orc) o.cursor().seekIndex(2);
      if (state === 'end') { a.cursor().seekIndex(n); orc[0].cursor().seekIndex(n); }
      const pre = [a, b, c].map((w) => fields(w.cursor(), DIMS));
      assert.equal(a.cursor().valid, state === 'valid', 'precondition ' + state);
      assert.throws(() => thunk(a, b, c, n), tokenErr(tok), `${name} ${tok}`);
      assert.throws(() => thunk(orc[0], orc[1], orc[2], n), tokenErr(tok), `model ${name} ${tok}`);
      // a rejected call leaves every cursor, on every view, Object.is-equal
      [a, b, c].forEach((w, k) => assert.deepEqual(fields(w.cursor(), DIMS), pre[k], `${name} ${tok} ${state} view ${k}`));
      [a, b, c].forEach((w, k) => sameAsModel(w.cursor(), orc[k].cursor(), DIMS, `${name} ${tok} ${state} model ${k}`));
      assert.equal(a._cv, state === 'valid', 'view _cv unchanged');
      cases++;
    }
  }
  assert.ok(cases >= 2, 'no RangeError case for ' + name);
}

// C-6: clear() has no RangeError of its own (only the corrupt-view plain Error), so it has no row 2; the
// 9 reads and another view's insertAt leave every field equal, for a valid AND an invalid cursor.
const READS = [
  ['getMeasure', (a) => a.getMeasure(0, 0)],
  ['entityAt', (a) => a.entityAt(0)],
  ['indexAtSum', (a) => a.indexAtSum(0, 3)],
  ['sumBefore', (a) => a.sumBefore(0, 2)],
  ['total', (a) => a.total(1)],
  ['length', (a) => a.length],
  ['available', (a) => a.available],
  ['cursor()', (a) => a.cursor()],
  ['another view insertAt', (a, b) => b.insertAt(0, 5, 1, 1)],
  ['capacity', (a) => a.capacity],
];

function rowReads(Y) {
  for (const state of ['valid', 'end']) {
    for (const [nm, fn] of READS) {
      const { views, orc } = scene(Y, true);
      const [a, b] = views;
      a.cursor().seekIndex(4); orc[0].cursor().seekIndex(4);
      b.cursor().seekIndex(2); orc[1].cursor().seekIndex(2);
      if (state === 'end') { a.cursor().seekIndex(a.length); orc[0].cursor().seekIndex(orc[0].length); }
      const pre = fields(a.cursor(), DIMS);
      const preB = fields(b.cursor(), DIMS);
      fn(a, b);
      assert.deepEqual(fields(a.cursor(), DIMS), pre, `read ${nm} (${state}) changed a cursor field`);
      // another view's insertAt (an element in b) does not change a's cursor; b's own cursor dies by C-40
      if (nm === 'another view insertAt') assertDead(b.cursor(), DIMS, 'b after its own insertAt');
      else assert.deepEqual(fields(b.cursor(), DIMS), preB, `read ${nm} changed b's cursor`);
    }
  }
}

// out view: splitAt's out cursor is invalid before AND after; cross-view: a seek or mutation on view 1 never changes
// view 0's cursor (except append, where both die); view 2 never moves.
function rowOutCross(Y) {
  const { views, orc } = scene(Y, false);
  const [a, b, c] = views;
  assertDead(b.cursor(), DIMS, 'out before');
  a.cursor().seekIndex(5);
  a.splitAt(9, b);
  assertDead(b.cursor(), DIMS, 'out after');
  assertDead(a.cursor(), DIMS, 'this after');
  // b now holds 11 elements; a seek on b leaves a (dead) and c (valid) unchanged
  const a0 = fields(a.cursor(), DIMS);
  c.cursor().seekIndex(1);
  const c0 = fields(c.cursor(), DIMS);
  assert.equal(b.cursor().seekIndex(3), true);
  assert.deepEqual(fields(a.cursor(), DIMS), a0);
  assert.deepEqual(fields(c.cursor(), DIMS), c0);
  // a is re-seeked; every mutator on b leaves a's and c's cursor alone
  a.cursor().seekIndex(2);
  const a1 = fields(a.cursor(), DIMS);
  const muts = [(w) => w.insertAt(0, 9, 1, 1), (w) => w.removeAt(0), (w) => w.setMeasure(1, 0, 4), (w) => w.clear()];
  for (const m of muts) {
    b.cursor().seekIndex(0);
    m(b);
    assertDead(b.cursor(), DIMS, 'b mutated');
    assert.deepEqual(fields(a.cursor(), DIMS), a1, 'view 0 cursor moved by a view 1 mutation');
    assert.deepEqual(fields(c.cursor(), DIMS), c0, 'view 2 cursor moved by a view 1 mutation');
  }
  // append: both die, the bystander lives
  fill(b, new Oracle(DIMS), DIMS, 3, rng(5), rng(6), 'rand');
  a.cursor().seekIndex(1); b.cursor().seekIndex(1);
  a.append(b);
  assertDead(a.cursor(), DIMS, 'append this');
  assertDead(b.cursor(), DIMS, 'append other');
  assert.deepEqual(fields(c.cursor(), DIMS), c0);
  void orc;
}

const ROWS = [];
for (const [name] of MUT) ROWS.push({ name: `row 1 C-40 mutate ${name}: cursor dies after the store`, run: (Y) => row1(Y, name) });
for (const name of ['insertAt', 'removeAt', 'setMeasure', 'splitAt', 'append']) {
  ROWS.push({ name: `row 2 C-6 RangeError ${name}: cursor unchanged`, run: (Y) => row2(Y, name) });
}
ROWS.push({ name: 'row 3 reads leave every cursor field equal', run: rowReads });
ROWS.push({ name: 'row 3 out view and cross-view isolation', run: rowOutCross });

for (const r of ROWS) test(r.name, () => r.run(YLive));

// ------------------------------------------------------------------ row 4 walk

// Compare the cursor to the model in every field, plus the spec'd return value.
function walkCell(Y, B, dims, n, st, cover) {
  const C = 1200;
  const [v] = mkArena(Y, B, dims, 1, C);
  const o = new Oracle(dims);
  fill(v, o, dims, n, st.rp, st.rm, 'rand');
  walkProbe(v, o, dims, n, true, st, cover);
}

function walkProbe(v, o, dims, n, full, st, cover) {
  const c = v.cursor(), oc = o.cursor();
  const idxs = [];
  if (full) for (let i = 0; i <= n; i++) idxs.push(i);
  else { idxs.push(0, n); for (let k = 0; k < 6; k++) idxs.push(st.rq() % (n + 1)); }
  for (const i of idxs) {
    const ret = c.seekIndex(i);
    oc.seekIndex(i);
    assert.equal(ret, i < n, `seekIndex(${i}) return, n=${n}`);
    assert.equal(ret, c.valid);
    sameAsModel(c, oc, dims, `seekIndex(${i}) n=${n}`);
    cover.seeks++;
    if (!ret) cover.ends++;
    // seekSum never lands on a zero measure (strict >, M-7); seekIndex does
    for (let d = 0; d < dims; d++) if (ret && o.getMeasure(i, d) === 0) cover.zeros++;
    for (let d = 0; d < dims; d++) {
      const S = o.sumBefore(d, i);
      for (const y of [S, S + 0.5]) {
        const tot = o.total(d);
        const r2 = c.seekSum(d, y);
        oc.seekSum(d, y);
        assert.equal(r2, y < tot, `seekSum(${d}, ${y}) return, n=${n}`);
        assert.equal(r2, c.valid);
        sameAsModel(c, oc, dims, `seekSum(${d}, ${y}) n=${n}`);
        if (y < tot) assert.equal(c.index, v.indexAtSum(d, y), 'seekSum index === indexAtSum');
        cover.seeks++;
        if (!r2) cover.ends++;
      }
    }
  }
}

test('row 4 seek walk: B {4,8,16} x dims {1,4} x n 0..40 against Oracle.cursor()', () => {
  const cover = { seeks: 0, ends: 0, zeros: 0, cells: 0 };
  for (const B of [4, 8, 16]) {
    for (const dims of [1, 4]) {
      const st = { rp: rng(1000 + B * 10 + dims), rm: rng(2000 + B * 10 + dims), rq: rng(3000 + B) };
      for (let n = 0; n <= 40; n++) { walkCell(YLive, B, dims, n, st, cover); cover.cells++; }
    }
  }
  assert.equal(cover.cells, 3 * 2 * 41);
  assert.ok(cover.seeks > 20000, 'coverage floor: seeks ' + cover.seeks);
  assert.ok(cover.ends > 500, 'coverage floor: end seeks ' + cover.ends);
  assert.ok(cover.zeros > 200, 'coverage floor: zero-measure landings ' + cover.zeros);
});

test('row 4 seek walk: 1000-append stream, checkpoints every 100 and a full walk at the end', () => {
  const cover = { seeks: 0, ends: 0, zeros: 0 };
  for (const B of [4, 8, 16]) {
    for (const dims of [1, 4]) {
      const st = { rp: rng(1), rm: rng(7000 + B + dims), rq: rng(9000 + B + dims) };
      const [v] = mkArena(YLive, B, dims, 1, 1100);
      const o = new Oracle(dims);
      for (let k = 0; k < 1000; k++) {
        fill1(v, o, dims, k, st.rm);
        if ((k + 1) % 100 === 0 && k + 1 < 1000) walkProbe(v, o, dims, k + 1, false, st, cover);
      }
      walkProbe(v, o, dims, 1000, true, st, cover);
    }
  }
  assert.ok(cover.seeks > 35000, 'coverage floor: seeks ' + cover.seeks);
  assert.ok(cover.zeros > 500, 'coverage floor: zero-measure landings ' + cover.zeros);
  assert.ok(cover.ends >= 6 * 9, 'coverage floor: end seeks ' + cover.ends);
});

function fill1(v, o, dims, k, rm) {
  const ms = [];
  for (let d = 0; d < dims; d++) ms.push(rm() % 20 === 0 ? 0 : 1 + (rm() % 9));
  ins(v, dims, k, k + 1, ms);
  ins(o, dims, k, k + 1, ms);
}

// ---------------------------------------------------------------- row 5 end / empty

test('row 5 end state (R-E3): i = length, y >= total, y = total + 7, empty view -> false, index -1, entity -1, NaN', () => {
  let tried = 0;
  for (const B of [4, 8, 16]) {
    for (const dims of [1, 4]) {
      for (const n of [0, 1, 5, 17, 40]) {
        const [v] = mkArena(YLive, B, dims, 1, 64);
        const o = new Oracle(dims);
        fill(v, o, dims, n, rng(n + 1), rng(n + 5), 'rand');
        const c = v.cursor();
        assert.equal(c.seekIndex(n), false, 'seekIndex(length)');
        assertDead(c, dims, `seekIndex(length) B=${B} dims=${dims} n=${n}`);
        for (let d = 0; d < dims; d++) {
          const t = o.total(d);
          for (const y of [t, t + 0.5, t + 7]) {
            c.seekIndex(0);
            assert.equal(c.seekSum(d, y), false, `seekSum(${d}, ${y}) n=${n}`);
            assertDead(c, dims, `seekSum end d=${d} y=${y} n=${n}`);
            tried++;
          }
        }
        if (n > 0) {
          // a valid seek after an end seek works
          assert.equal(c.seekIndex(0), true);
          sameAsModel(c, (() => { o.cursor().seekIndex(0); return o.cursor(); })(), dims, 'valid after end');
          c.seekIndex(n);
          assert.equal(c.seekSum(0, 0), o.total(0) > 0, 'seekSum(0, 0) after end');
        } else {
          assert.equal(c.seekIndex(0), false, 'empty view seekIndex(0)');
          assertDead(c, dims, 'empty seekIndex(0)');
          assert.equal(c.seekSum(0, 0), false, 'empty view seekSum');
          assertDead(c, dims, 'empty seekSum');
        }
      }
    }
  }
  // all-zero measures: total 0, so seekSum(d, 0) is the end (y >= total) while seekIndex(0) is valid
  const [z] = mkArena(YLive, 4, 1, 1, 64);
  for (let k = 0; k < 6; k++) z.insertAt(k, k + 1, 0);
  assert.equal(z.cursor().seekSum(0, 0), false);
  assertDead(z.cursor(), 1, 'zero-total seekSum(0)');
  assert.equal(z.cursor().seekIndex(0), true);
  assert.equal(z.cursor().measure(0), 0);
  assert.ok(tried >= 6 * 5 * 2);
});

// ---------------------------------------------------------------- row 6 validation

test('row 6 validation: seekIndex tokens, -0, seekSum dim before seek, offset / measure dim', () => {
  const dims = 2;
  for (const state of ['valid', 'end', 'empty']) {
    const [v] = mkArena(YLive, 4, dims, 1, 64);
    const o = new Oracle(dims);
    if (state !== 'empty') fill(v, o, dims, 9, rng(3), rng(4), 'rand');
    const n = v.length;
    const c = v.cursor();
    if (state === 'valid') c.seekIndex(3); else if (state === 'end') c.seekIndex(n);
    const pre = fields(c, dims);
    const preCv = v._cv;
    const still = (m) => { assert.deepEqual(fields(c, dims), pre, m); assert.equal(v._cv, preCv, m + ' _cv'); };
    for (const bad of ['1', null, undefined, {}, true, [], -1, 1.5, n + 1, NaN, Infinity, -Infinity, 2 ** 31, 2 ** 53]) {
      assert.throws(() => c.seekIndex(bad), tokenErr('index'), `seekIndex(${String(bad)}) ${state}`);
      still('seekIndex throw');
    }
    for (const badD of ['0', null, undefined, -1, 1.5, 2, NaN, Infinity, {}]) {
      for (const y of [0, 'x', NaN, -1]) {
        assert.throws(() => c.seekSum(badD, y), tokenErr('dim'), `seekSum bad dim ${String(badD)} y ${String(y)}`);
        still('seekSum dim throw');
      }
      assert.throws(() => c.offset(badD), tokenErr('dim'), 'offset bad dim ' + state);
      assert.throws(() => c.measure(badD), tokenErr('dim'), 'measure bad dim ' + state);
      still('offset / measure dim throw');
    }
    for (const badY of [NaN, -1, Infinity, -Infinity, '3', null, undefined, {}, true, -0.5]) {
      for (const d of [0, 1]) {
        assert.throws(() => c.seekSum(d, badY), tokenErr('seek'), `seekSum(${d}, ${String(badY)}) ${state}`);
        still('seekSum y throw');
      }
    }
    // -0: index acts as 0 (empty view: i = 0 = length -> end), dim acts as 0, y = -0 is 0
    if (n > 0) {
      assert.equal(c.seekIndex(-0), true);
      assert.ok(Object.is(c.index, 0), 'seekIndex(-0).index is +0');
      o.cursor().seekIndex(0);
      sameAsModel(c, o.cursor(), dims, 'seekIndex(-0)');
      assert.equal(c.seekSum(-0, 0), true);
      o.cursor().seekSum(0, 0);
      sameAsModel(c, o.cursor(), dims, 'seekSum(-0, 0)');
      assert.equal(c.seekSum(0, -0), true);
      assert.ok(Number.isFinite(c.offset(-0)) && Number.isFinite(c.measure(-0)));
    } else {
      assert.equal(c.seekIndex(-0), false);
      assert.equal(c.seekSum(-0, -0), false);
    }
  }
});

// ---------------------------------------------------------------- row 7 counts

// Leaves in order of view vi of snapshot s: {fb, len, depth}. Written here from the snapshot contract (C-27 header of
// test/walker.mjs): a child ref >= 0 is an internal id, < 0 is ~leafId; depth = internal nodes above the leaf.
function leaves(s, vi) {
  const out = [];
  const vw = s.views[vi];
  if (vw._len === 0) return out;
  const st = [[vw._root, 0]];
  while (st.length) {
    const [r, dep] = st.pop();
    if (r < 0) out.push({ len: s.leaf.len[~r], depth: dep });
    else { st.push([s.int.right[r], dep + 1]); st.push([s.int.left[r], dep + 1]); }
  }
  let fb = 0;
  for (const l of out) { l.fb = fb; fb += l.len; }
  return out;
}

// d(t): the depth of the leaf holding element k, the LAST leaf when k = length, 0 when empty (C-25 table)
function expectedTouches(L, k, n) {
  if (n === 0) return 0;
  if (k >= n) return L[L.length - 1].depth;
  for (const l of L) if (l.fb <= k && k < l.fb + l.len) return l.depth;
  throw new Error('no leaf for ' + k);
}

const json = (x) => JSON.stringify(x, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v));

test('row 7 counts: touches === d(t) per seek, every other counter 0, finger and every other view byte-identical', () => {
  const K = YLive.SumSequence.COUNTERS;
  const names = Object.keys(K);
  const cover = { seeks: 0, deep: 0, end: 0, empty: 0, throws: 0, maxDepth: 0 };
  const buf = new Int32Array(12);
  const readAll = (views) => views.map((w) => { w.readCounters(buf); return Array.from(buf); });
  for (const B of [4, 8, 16]) {
    for (const dims of [1, 2]) {
      for (const n of [0, 1, 2, B, B + 1, 3 * B, 70, 150]) {
        const C = 200;
        const f = engineFactory(C, { leafSize: B, dims }, 2, {});
        const [v, w] = f.views;
        const o = new Oracle(dims);
        const o2 = new Oracle(dims);
        const rp = rng(40 + B + n), rm = rng(50 + dims + n), rq = rng(60 + B * n + 1);
        fill(v, o, dims, n, rp, rm, 'rand');
        fill(w, o2, dims, 5, rp, rm, 'rand');
        for (const x of [v, w]) x.cursor().seekIndex(0);
        for (let step = 0; step < 40; step++) {
          // a position-moving read first, so the finger is somewhere other than where the previous seek left it
          if (n > 0 && step % 3 === 0) v.getMeasure(rq() % n, 0);
          const kind = rq() % 3;
          const pre = f.snapshot();
          const cPre = readAll(f.views);
          let ret, k;
          const L = leaves(pre, 0);
          let thrown = false;
          if (kind === 0) {
            const i = rq() % (n + 1);
            ret = v.cursor().seekIndex(i); k = i;
          } else if (kind === 1) {
            const d = rq() % dims;
            const y = o.sumBefore(d, rq() % (n + 1)) + (rq() % 2) * 0.5;
            k = o.indexAtSum(d, y);
            ret = v.cursor().seekSum(d, y);
          } else {
            thrown = true;
            assert.throws(() => (rq() % 2 ? v.cursor().seekIndex(n + 1) : v.cursor().seekSum(0, NaN)), RangeError);
            cover.throws++;
          }
          const post = f.snapshot();
          const cPost = readAll(f.views);
          const delta = cPost[0].map((x, j) => x - cPre[0][j]);
          const tag = `B=${B} dims=${dims} n=${n} step=${step}`;
          if (!thrown) {
            const want = expectedTouches(L, k, n);
            assert.equal(delta[K.touches], want, `touches ${tag} k=${k}`);
            assert.equal(ret, k < n, `ret ${tag}`);
            cover.seeks++;
            if (want >= 2) cover.deep++;
            if (want > cover.maxDepth) cover.maxDepth = want;
            if (k >= n && n > 0) cover.end++;
            if (n === 0) cover.empty++;
          } else assert.equal(delta[K.touches], 0, 'a throwing seek adds 0 touches ' + tag);
          for (const nm of names) {
            if (nm !== 'touches') assert.equal(delta[K[nm]], 0, `counter ${nm} moved ${tag}`);
          }
          assert.equal(delta[K.fingerHits], 0);
          assert.equal(delta[K.fingerMisses], 0);
          assert.deepEqual(cPost[1], cPre[1], 'other view counters ' + tag);
          // the snapshot minus view 0's _cv is byte-identical: finger (_fl, _fb, _fdepth, _fpath), pools, every other view
          pre.views[0]._cv = post.views[0]._cv = null;
          assert.equal(json(post), json(pre), 'snapshot changed ' + tag);
        }
      }
    }
  }
  assert.ok(cover.seeks > 700, 'coverage floor: seeks ' + cover.seeks);
  assert.ok(cover.deep > 100, 'coverage floor: seeks with d(t) >= 2: ' + cover.deep);
  assert.ok(cover.maxDepth >= 3, 'coverage floor: deepest leaf ' + cover.maxDepth);
  assert.ok(cover.end > 20 && cover.empty > 20 && cover.throws > 20, JSON.stringify(cover));
});

// ---------------------------------------------------------------- row 8 shape

test('row 8 shape: one cursor per view, prototype getters, exports exactly SumSequence and VERSION', () => {
  const views = mkArena(YLive, 8, 1, 2, 16);
  assert.equal(views[0].cursor(), views[0].cursor());
  assert.equal(views[1].cursor(), views[1].cursor());
  assert.notEqual(views[0].cursor(), views[1].cursor());
  const c = views[0].cursor();
  for (const f of ['valid', 'index', 'entity']) {
    assert.equal(Object.hasOwn(c, f), false, f + ' is not an own property');
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(c), f);
    assert.ok(desc && typeof desc.get === 'function', f + ' is a prototype getter');
    assert.equal(desc.set, undefined, f + ' has no setter');
    assert.throws(() => { c[f] = 1; }, TypeError);
  }
  for (const m of ['seekIndex', 'seekSum', 'offset', 'measure']) assert.equal(typeof c[m], 'function', m);
  assert.deepEqual(Object.keys(YLive).sort(), ['SumSequence', 'VERSION']);
  const sq = new YLive.SumSequence(8, { dims: 1 });
  assert.equal(sq.cursor(), sq.cursor());
});

// ---------------------------------------------------------------- row 9 teeth

const built = [];
after(() => { for (const b of built) b.cleanup(); });

// Rows that run on a bare namespace Y (no snapshot adapter): the mutant table runs exactly these.
const YROWS = [...ROWS, ...[
  { name: 'row 4 seek walk (small cell)', run: (Y) => { const cv = { seeks: 0, ends: 0, zeros: 0 }; walkCell(Y, 4, 2, 17, { rp: rng(1), rm: rng(2), rq: rng(3) }, cv); } },
]];

// The coder's anchors: each `// cv:<site>` is a line holding one `..._cv = false;` store; the mutant drops the store.
// MUTANTS: [name, patches, the row that must fail].
const drop = (site, line) => [[line + ' // cv:' + site, '// cv:' + site, 1]];
// `cv:splitAtOut` (out._cv) is NOT a mutant row (C-40: out is empty, its cursor is never valid).
const MUTANTS = [
  ['cv:insertAt', drop('insertAt', 'this._cv = false;'), 'row 1 C-40 mutate insertAt'],
  ['cv:removeAt', drop('removeAt', 'this._cv = false;'), 'row 1 C-40 mutate removeAt'],
  ['cv:setMeasure', drop('setMeasure', 'this._cv = false;'), 'row 1 C-40 mutate setMeasure'],
  ['cv:splitAt', drop('splitAt', 'this._cv = false;'), 'row 1 C-40 mutate splitAt'],
  ['cv:append', drop('append', 'this._cv = false;'), 'row 1 C-40 mutate append'],
  ['cv:appendOther', drop('appendOther', 'other._cv = false;'), 'row 1 C-40 mutate appendOther'],
  ['cv:clear', drop('clear', 'this._cv = false;'), 'row 1 C-40 mutate clear'],
  // validation order: insertAt's store moved above its first check -> a RangeError call kills the cursor
  ['insertAt store above first check', [
    ['    this._cv = false; // cv:insertAt\n', '', 1],
    ['  insertAt(i, e, m0, m1, m2, m3) {\n    const n = this._len;\n',
      '  insertAt(i, e, m0, m1, m2, m3) {\n    this._cv = false;\n    const n = this._len;\n', 1],
  ], 'row 2 C-6 RangeError insertAt'],
  ['removeAt store below the drain exit', [
    ['    this._cv = false; // cv:removeAt\n', '', 1],
    ['      return e1;\n    }\n', '      return e1;\n    }\n    this._cv = false;\n', 1],
  ], 'row 1 C-40 mutate removeAt'],
];

function failing(Y) {
  const out = [];
  for (const r of YROWS) {
    try { r.run(Y); } catch (e) { out.push(r.name + ' :: ' + String(e.message).split('\n')[0].slice(0, 80)); }
  }
  return out;
}

test('teeth: the unpatched build through the buildMutant path passes every Y-row', async () => {
  const Y = await buildMutant(YPATH, []);
  built.push(Y);
  assert.deepEqual(failing(Y), []);
});

for (const [name, patches, row] of MUTANTS) {
  test(`teeth: mutant ${name} fails row "${row}"`, async () => {
    const Y = await buildMutant(YPATH, patches);
    built.push(Y);
    const fails = failing(Y);
    const hit = fails.filter((f) => f.startsWith(row));
    console.log(`# mutant ${name}: killed by ${fails.map((f) => f.split(' :: ')[0]).join(' | ')}`);
    assert.ok(hit.length > 0, `${name}: row "${row}" did not fail; failing: ${JSON.stringify(fails)}`);
  });
}

