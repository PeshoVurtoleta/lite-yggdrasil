// test/Entity.test.mjs -- per-op entity / index / measure / extra-slot / order rows
// (ADR 0005 C-9, C-10, C-12, C-37 ownership RV-7; PLAN-E0-V ASSERTION 3).
//
// Written FROM THE SPEC. Expected tokens come from the spec rows (and are cross-checked against
// test/oracle.mjs, the independent answer model); nothing is copied from the engine's output.
// All rows stay on one leaf (n < B): a full-leaf insert is a fail-closed split until the trunk rung.
// ASCII only.

import { test } from 'node:test';
import { buildMutant } from './mutant-build.mjs';
import { SumSequence as RealSeq } from '../Yggdrasil.js';
import assert from 'node:assert/strict';
import { engineFactory } from './adapter.mjs';
import { walk } from './walker.mjs';
import { Oracle, MAX } from './oracle.mjs';

const LIM = 1073741823; // 2^30 - 1

function spy() {
  const s = { calls: 0 };
  s.valueOf = function () { s.calls++; return 5; };
  s.toString = function () { s.calls++; return '5'; };
  return s;
}

// A paired engine / oracle with identical contents. rows: array of [e, m0, m1?, ...].
function make(dims, rows, C, leafSize) {
  const B = leafSize === undefined ? 8 : leafSize;
  const f = engineFactory(C === undefined ? 32 : C, { dims: dims, leafSize: B }, 1);
  const s = f.views[0];
  const o = new Oracle(dims);
  for (let k = 0; k < rows.length; k++) {
    const r = rows[k];
    s.insertAt(k, r[0], r[1], r[2], r[3], r[4]);
    o.insertAt(k, r[0], r[1], r[2], r[3], r[4]);
  }
  return { s: s, o: o, snap: f.snapshot, dims: dims, B: B };
}

const BASE1 = [[10, 5], [11, 0], [12, 7]];
const BASE2 = [[10, 5, 1], [11, 0, 2], [12, 7, 3]];

function first(e) { return String(e.message).split(' ')[0]; }

// One rejected row: RangeError + the expected first token, snapshot unchanged (the snapshot holds no
// _n), walker ok, spy untouched, and (unless noOracle) the oracle names the same token.
function rej(ctx, fn, token, sp, noOracle) {
  const before = ctx.snap();
  const len = ctx.s.length;
  let err = null;
  try { fn(ctx.s); } catch (e) { err = e; }
  assert.ok(err instanceof RangeError, 'RangeError expected for token ' + token + ', got ' + err);
  assert.equal(first(err), token, 'first token, message: ' + err.message);
  if (sp !== undefined) assert.equal(sp.calls, 0, 'spy called');
  assert.equal(ctx.s.length, len);
  const after = ctx.snap();
  assert.deepStrictEqual(after, before);
  assert.equal(walk(after, { B: ctx.B, dims: ctx.dims }), null);
  if (noOracle !== true) {
    let oe = null;
    try { fn(ctx.o); } catch (e) { oe = e; }
    assert.ok(oe instanceof RangeError, 'oracle rejects too');
    assert.equal(first(oe), token, 'oracle token');
  }
}

function dumpOf(s, dims) {
  const ent = [];
  const meas = [];
  for (let d = 0; d < dims; d++) meas.push([]);
  for (let k = 0; k < s.length; k++) {
    ent.push(s.entityAt(k));
    for (let d = 0; d < dims; d++) meas[d].push(s.getMeasure(k, d));
  }
  return { entities: ent, measures: meas };
}

function same(ctx) {
  assert.deepStrictEqual(dumpOf(ctx.s, ctx.dims), ctx.o.dump());
  assert.equal(walk(ctx.snap(), { B: ctx.B, dims: ctx.dims }), null);
}

// ---------------------------------------------------------------- E rows (C-9)

test('E-1 / E-2 / E-3: 0, -0 and 2^30-1 are stored and read back', () => {
  const c = make(1, []);
  c.s.insertAt(0, 0, 1);
  c.s.insertAt(1, -0, 1);
  c.s.insertAt(2, LIM, 1);
  assert.equal(c.s.entityAt(0), 0);
  assert.ok(Object.is(c.s.entityAt(1), 0), 'E-2: -0 stored as +0');
  assert.equal(c.s.entityAt(2), 1073741823);
  assert.equal(walk(c.snap(), { B: c.B, dims: 1 }), null);
});

test('E-4..E-7: bad entities -> entity, nothing written, 0 spy calls', () => {
  const bad = [
    ['E-4 2^30', 2 ** 30], ['E-4 2^31', 2 ** 31], ['E-4 2^32', 2 ** 32],
    ['E-5 -1', -1], ['E-6 1.5', 1.5], ['E-6 NaN', NaN], ['E-6 Infinity', Infinity],
    ['E-6 -Infinity', -Infinity], ['E-7 str', '5'], ['E-7 null', null], ['E-7 undefined', undefined],
    ['E-7 true', true], ['E-7 5n', 5n], ['E-7 Number obj', new Number(5)],
  ];
  const c = make(1, BASE1);
  for (const [name, e] of bad) {
    rej(c, (x) => x.insertAt(1, e, 3), 'entity');
    void name;
  }
  const sp = spy();
  rej(c, (x) => x.insertAt(1, sp, 3), 'entity', sp);
  same(c);
});

// ------------------------------------------------------------- index rows (C-10)

test('index rows: insertAt accepts [0, n], rejects n+1, 2^32, -1, 1.5, NaN, non-numbers', () => {
  const c = make(1, BASE1);
  const n = 3;
  const bad = [n + 1, 2 ** 32, 2 ** 32 + 1, -1, 1.5, NaN, Infinity, -Infinity, '0', null, undefined,
    true, 0n, new Number(0)];
  for (const i of bad) rej(c, (x) => x.insertAt(i, 4, 1), 'index');
  const sp = spy();
  rej(c, (x) => x.insertAt(sp, 4, 1), 'index', sp);
  c.s.insertAt(n, 4, 1); c.o.insertAt(n, 4, 1); // i = n is legal
  same(c);
});

test('index rows: removeAt / setMeasure / getMeasure / entityAt reject i = n and the non-numbers', () => {
  const c = make(1, BASE1);
  const n = 3;
  const bad = [n, n + 1, 2 ** 32, -1, 1.5, NaN, Infinity, '0', null, undefined, true, 0n, new Number(0)];
  const ops = [
    (i) => (x) => x.removeAt(i),
    (i) => (x) => x.setMeasure(i, 0, 1),
    (i) => (x) => x.getMeasure(i, 0),
    (i) => (x) => x.entityAt(i),
  ];
  for (const op of ops) {
    for (const i of bad) rej(c, op(i), 'index');
    const sp = spy();
    rej(c, op(sp), 'index', sp);
  }
  same(c);
});

test('index rows: sumBefore accepts [0, n], rejects n+1 / 2^32 / non-numbers', () => {
  const c = make(1, BASE1);
  for (const i of [4, 2 ** 32, -1, 1.5, NaN, '0', null, undefined, 0n]) {
    rej(c, (x) => x.sumBefore(0, i), 'index');
  }
  const sp = spy();
  rej(c, (x) => x.sumBefore(0, sp), 'index', sp);
  assert.equal(c.s.sumBefore(0, 3), 12); // 5 + 0 + 7 (hand sum)
  assert.equal(c.s.sumBefore(0, 0), 0);
});

test('i = -0 acts as 0 on every index-taking op', () => {
  const c = make(1, BASE1);
  c.s.insertAt(-0, 99, 4); c.o.insertAt(-0, 99, 4);
  assert.equal(c.s.entityAt(0), 99);
  assert.equal(c.s.entityAt(-0), 99);
  assert.equal(c.s.getMeasure(-0, 0), 4);
  assert.equal(c.s.sumBefore(0, -0), 0);
  c.s.setMeasure(-0, 0, 9); c.o.setMeasure(-0, 0, 9);
  assert.equal(c.s.getMeasure(0, 0), 9);
  assert.equal(c.s.removeAt(-0), 99); c.o.removeAt(-0);
  assert.equal(c.s.total(-0), 12); // dim -0 acts as 0 as well (oracle rule)
  same(c);
});

test('i = 2^32 is an index error, not a wrapped 0 (insertAt and the others)', () => {
  const c = make(1, BASE1);
  rej(c, (x) => x.insertAt(2 ** 32, 4, 1), 'index');
  rej(c, (x) => x.removeAt(2 ** 32), 'index');
  rej(c, (x) => x.entityAt(2 ** 32), 'index');
  rej(c, (x) => x.sumBefore(0, 2 ** 32), 'index');
});

// ---------------------------------------------------------------- dim rows

test('dim rows: getMeasure / setMeasure / total / sumBefore / indexAtSum', () => {
  const c = make(2, BASE2);
  const badD = [-1, 2, 1.5, NaN, '0', null, undefined, 0n, 2 ** 32];
  for (const d of badD) {
    rej(c, (x) => x.getMeasure(0, d), 'dim');
    rej(c, (x) => x.setMeasure(0, d, 1), 'dim');
    rej(c, (x) => x.total(d), 'dim');
    rej(c, (x) => x.sumBefore(d, 0), 'dim');
    rej(c, (x) => x.indexAtSum(d, 1), 'dim');
  }
  const sp = spy();
  rej(c, (x) => x.getMeasure(0, sp), 'dim', sp);
  rej(c, (x) => x.total(sp), 'dim', sp);
  rej(c, (x) => x.indexAtSum(sp, 1), 'dim', sp);
});

// ---------------------------------------------------------------- measure rows (M-3)

test('measure rows: M-3 range, integer, type; spy never called', () => {
  const c = make(1, BASE1);
  const bad = [-1, NaN, 1.5, Infinity, -Infinity, MAX + 1, 2 ** 60, '5', null, undefined, true, 5n,
    new Number(5)];
  for (const m of bad) {
    rej(c, (x) => x.insertAt(1, 4, m), 'measure');
    rej(c, (x) => x.setMeasure(1, 0, m), 'measure');
  }
  const sp = spy();
  rej(c, (x) => x.insertAt(1, 4, sp), 'measure', sp);
  rej(c, (x) => x.setMeasure(1, 0, sp), 'measure', sp);
  same(c);
});

test('measure rows: 0, -0 (stored +0) and MAX accepted at the edge', () => {
  const c = make(1, []);
  c.s.insertAt(0, 1, -0);
  assert.ok(Object.is(c.s.getMeasure(0, 0), 0), 'M-2: -0 stored as +0');
  c.s.setMeasure(0, 0, MAX);
  assert.equal(c.s.getMeasure(0, 0), MAX);
  assert.equal(c.s.total(0), MAX);
  c.s.setMeasure(0, 0, -0);
  assert.ok(Object.is(c.s.getMeasure(0, 0), 0));
  assert.equal(walk(c.snap(), { B: c.B, dims: 1 }), null);
});

test('measure rows at dims=2: the second slot is checked too', () => {
  const c = make(2, BASE2);
  rej(c, (x) => x.insertAt(1, 4, 1, -1), 'measure');
  rej(c, (x) => x.insertAt(1, 4, 1), 'measure'); // m1 missing -> not a number
  rej(c, (x) => x.insertAt(1, 4, 1, '2'), 'measure');
  const sp = spy();
  rej(c, (x) => x.insertAt(1, 4, 1, sp), 'measure', sp);
});

// ---------------------------------------------------------------- extra slots

test('extra-slot rows: slots >= dims must be undefined (present-as-undefined legal)', () => {
  const c = make(1, BASE1);
  for (const v of [0, 5, null, '1', 0n, NaN, false]) {
    rej(c, (x) => x.insertAt(1, 4, 5, v), 'extra');
    rej(c, (x) => x.insertAt(1, 4, 5, undefined, v), 'extra');
    rej(c, (x) => x.insertAt(1, 4, 5, undefined, undefined, v), 'extra');
  }
  c.s.insertAt(1, 4, 5, undefined); c.o.insertAt(1, 4, 5, undefined);
  c.s.insertAt(1, 4, 5, undefined, undefined, undefined); c.o.insertAt(1, 4, 5);
  same(c);
  const d3 = make(3, [[1, 1, 1, 1]]);
  rej(d3, (x) => x.insertAt(0, 4, 1, 1, 1, 0), 'extra');
  d3.s.insertAt(0, 4, 1, 1, 1, undefined);
  const d2 = make(2, BASE2);
  rej(d2, (x) => x.insertAt(1, 4, 1, 1, 0), 'extra');
  rej(d2, (x) => x.insertAt(1, 4, 1, 1, undefined, 0), 'extra');
});

// ---------------------------------------------------------------- headroom

test('headroom: insertAt rejects m0 > MAX - t0, accepts the boundary', () => {
  const c = make(1, [[1, MAX - 5]]);
  rej(c, (x) => x.insertAt(1, 2, 6), 'headroom');
  rej(c, (x) => x.insertAt(0, 2, MAX), 'headroom');
  c.s.insertAt(1, 2, 5); c.o.insertAt(1, 2, 5);
  assert.equal(c.s.total(0), MAX);
  rej(c, (x) => x.insertAt(0, 2, 1), 'headroom');
  c.s.insertAt(0, 2, 0); c.o.insertAt(0, 2, 0); // adding zero at MAX is fine
  same(c);
});

test('headroom: setMeasure rejects m > MAX - (t - m_old), accepts the boundary', () => {
  // t = 30 by hand (10 + 20); old = 10; limit MAX - 20.
  const c = make(1, [[1, 10], [2, 20]]);
  rej(c, (x) => x.setMeasure(0, 0, MAX - 19), 'headroom');
  rej(c, (x) => x.setMeasure(1, 0, MAX - 9), 'headroom');
  c.s.setMeasure(0, 0, MAX - 20); c.o.setMeasure(0, 0, MAX - 20);
  assert.equal(c.s.total(0), MAX);
  c.s.setMeasure(0, 0, MAX - 20); c.o.setMeasure(0, 0, MAX - 20); // unchanged value at MAX total is fine
  same(c);
});

test('headroom is the LAST check: a bad measure / index / dim wins over a full total', () => {
  const c = make(1, [[1, MAX]]);
  rej(c, (x) => x.setMeasure(0, 0, NaN), 'measure');
  rej(c, (x) => x.setMeasure(5, 0, MAX), 'index');
  rej(c, (x) => x.setMeasure(0, 3, MAX), 'dim');
  rej(c, (x) => x.insertAt(0, -1, MAX), 'entity');
  rej(c, (x) => x.insertAt(0, 1, MAX, 0), 'extra');
});

test('headroom dims=2: the second column is checked', () => {
  const c = make(2, [[1, 0, MAX - 1]]);
  rej(c, (x) => x.insertAt(1, 2, 0, 2), 'headroom');
  c.s.insertAt(1, 2, 0, 1); c.o.insertAt(1, 2, 0, 1);
  same(c);
});

// ---------------------------------------------------------------- order rows

test('order: index, entity, measure, extra, (capacity), headroom', () => {
  const c = make(1, BASE1);
  rej(c, (x) => x.insertAt(-1, -1, NaN), 'index');
  rej(c, (x) => x.insertAt(0, -1, NaN), 'entity');
  rej(c, (x) => x.insertAt(0, 7, NaN, 0), 'measure'); // dims=1: measure before extra
  rej(c, (x) => x.insertAt(0, 7, 5, 0), 'extra');
  rej(c, (x) => x.insertAt(99, 2 ** 31, 'x', 0), 'index');
  rej(c, (x) => x.setMeasure(99, 9, NaN), 'index'); // index, then dim, then measure
  rej(c, (x) => x.setMeasure(0, 9, NaN), 'dim');
  rej(c, (x) => x.setMeasure(0, 0, NaN), 'measure');
  rej(c, (x) => x.getMeasure(99, 9), 'index');
  rej(c, (x) => x.sumBefore(9, 99), 'index'); // oracle.mjs: index before dim (see report: C-12 wording differs)
  rej(c, (x) => x.indexAtSum(9, NaN), 'dim'); // dim first, then y
  rej(c, (x) => x.indexAtSum(0, NaN), 'seek');
});

test('order at live == C: extra beats capacity; capacity beats headroom', () => {
  const full = make(1, [[1, 3]], 1, 4);
  rej(full, (x) => x.insertAt(0, 7, 5, 0), 'extra');
  rej(full, (x) => x.insertAt(0, 7, 5), 'capacity', undefined, true);
  rej(full, (x) => x.insertAt(0, 7, NaN), 'measure');
  rej(full, (x) => x.insertAt(0, -1, 5), 'entity');
  rej(full, (x) => x.insertAt(2, 7, 5), 'index');
  const max = make(1, [[1, MAX]], 1, 4);
  rej(max, (x) => x.insertAt(0, 7, 5), 'capacity', undefined, true); // even when t0 = MAX
  // not full: the same call is a headroom error
  const roomy = make(1, [[1, MAX]], 4, 4);
  rej(roomy, (x) => x.insertAt(0, 7, 5), 'headroom');
});

// ---------------------------------------------------------------- queries

test('indexAtSum: y rows (seek) and strict-greater answers', () => {
  const c = make(1, BASE1); // measures 5, 0, 7 -> prefix 0,5,5; total 12
  for (const y of [-1, NaN, Infinity, '1', null, undefined, true, 1n, new Number(1)]) {
    rej(c, (x) => x.indexAtSum(0, y), 'seek');
  }
  const sp = spy();
  rej(c, (x) => x.indexAtSum(0, sp), 'seek', sp);
  assert.equal(c.s.indexAtSum(0, 0), 0);
  assert.equal(c.s.indexAtSum(0, 4.5), 0);
  assert.equal(c.s.indexAtSum(0, 5), 2); // smallest i with S_i + m_i > 5: element 1 has m=0, so i = 2
  assert.equal(c.s.indexAtSum(0, 11), 2);
  assert.equal(c.s.indexAtSum(0, 12), 3); // y >= total -> length
  assert.equal(c.s.indexAtSum(0, 1e12), 3);
  assert.equal(c.s.indexAtSum(0, -0), 0);
});

test('total / sumBefore / getMeasure on dims=2 (hand sums)', () => {
  const c = make(2, BASE2);
  assert.equal(c.s.total(0), 12);
  assert.equal(c.s.total(1), 6);
  assert.equal(c.s.sumBefore(1, 2), 3);
  assert.equal(c.s.getMeasure(2, 1), 3);
  assert.equal(c.s.entityAt(2), 12);
});

test('removeAt returns the entity; insertAt / removeAt match the oracle', () => {
  const c = make(2, BASE2);
  assert.equal(c.s.removeAt(1), 11); c.o.removeAt(1);
  assert.equal(c.s.total(1), 4);
  same(c);
});

test('empty sequence: index 0 legal only for insertAt / sumBefore', () => {
  const c = make(1, []);
  rej(c, (x) => x.removeAt(0), 'index');
  rej(c, (x) => x.entityAt(0), 'index');
  rej(c, (x) => x.getMeasure(0, 0), 'index');
  rej(c, (x) => x.setMeasure(0, 0, 1), 'index');
  // B4 (C-3, C-5): a rejected insertAt on an EMPTY view re-homes nothing (snapshot holds _fl / _fb / _fdepth).
  rej(c, (x) => x.insertAt(1, 1, 1), 'index');
  rej(c, (x) => x.insertAt(0, -1, 1), 'entity');
  rej(c, (x) => x.insertAt(0, 1, NaN), 'measure');
  rej(c, (x) => x.insertAt(0, 1, 1, 0), 'extra');
  assert.equal(c.s.sumBefore(0, 0), 0);
  assert.equal(c.s.indexAtSum(0, 0), 0);
  assert.equal(c.s.total(0), 0);
});

// ---------------------------------------------------------------- seeded differential

// mulberry32: 32-bit exact, independent streams per concern.
function prng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('seeded differential vs the oracle on one leaf (valid + invalid ops)', () => {
  const rOp = prng(0xA11CE), rKey = prng(0xB0B), rBad = prng(0xC0FFEE);
  const c = make(2, [], 64, 16);
  let accepted = 0, rejected = 0, inserts = 0, removes = 0, sets = 0;
  const badIdx = [-1, 1.5, NaN, 2 ** 32, '1', null, 99];
  for (let step = 0; step < 3000; step++) {
    const n = c.s.length;
    const op = (rOp() * 4) | 0;
    const wantBad = rBad() < 0.25;
    const i = wantBad ? badIdx[(rBad() * badIdx.length) | 0] : Math.floor(rKey() * (n + 1));
    const e = Math.floor(rKey() * LIM);
    const m0 = Math.floor(rKey() * 1000), m1 = Math.floor(rKey() * 1000);
    let fn;
    if (op === 0) { if (n >= 12 && !wantBad) continue; fn = (x) => x.insertAt(i, e, m0, m1); }
    else if (op === 1) fn = (x) => x.removeAt(i);
    // The dim is drawn once so both sides see the same call.
    const d = (rKey() * 2) | 0;
    if (op === 2) fn = (x) => x.setMeasure(i, d, m0);
    else if (op === 3) fn = (x) => x.sumBefore(d, i);
    let a, ea = null, b, eb = null;
    try { a = fn(c.s); } catch (x) { ea = x; }
    try { b = fn(c.o); } catch (x) { eb = x; }
    assert.equal(ea === null, eb === null, 'accept / reject agree at step ' + step);
    if (ea !== null) {
      assert.ok(ea instanceof RangeError);
      assert.equal(first(ea), first(eb));
      rejected++;
    } else {
      assert.equal(a, b);
      accepted++;
      if (op === 0) inserts++; else if (op === 1) removes++; else if (op === 2) sets++;
    }
  }
  same(c);
  // coverage floor ~80% of the observed counts for these fixed seeds (3000 steps):
  // observed accepted 2035, rejected 939, inserts 491, removes 489, sets 464.
  assert.ok(accepted >= 1628 && rejected >= 751, 'accepted ' + accepted + ' rejected ' + rejected);
  assert.ok(inserts >= 392 && removes >= 391 && sets >= 371, inserts + '/' + removes + '/' + sets);
});

// ---------------------------------------------------------------- in-test controls (pure JS)

test('control: Number.isInteger models accept 2^31 (the real check must reject it)', () => {
  const bad = (e) => typeof e === 'number' && Number.isInteger(e);
  const good = (e) => typeof e === 'number' && (e & 0x3FFFFFFF) === e;
  assert.equal(bad(2 ** 31), true);
  assert.equal(good(2 ** 31), false);
  assert.equal(good(LIM), true);
  assert.equal(good(2 ** 30), false);
});

test('control: e|0 turns 1.5 into 1 (a store of e|0 would accept 1.5)', () => {
  assert.equal(1.5 | 0, 1);
  const good = (e) => typeof e === 'number' && (e & 0x3FFFFFFF) === e;
  assert.equal(good(1.5), false);
  assert.equal(good(1.5 | 0), true);
});

test('control: a check without typeof calls the spy once', () => {
  const sp = spy();
  const noTypeof = (e) => (e & 0x3FFFFFFF) === e;
  noTypeof(sp);
  assert.equal(sp.calls, 1);
  const sp2 = spy();
  const good = (e) => typeof e === 'number' && (e & 0x3FFFFFFF) === e;
  good(sp2);
  assert.equal(sp2.calls, 0);
});

// ---------------------------------------------------------------- engine mutants

const SRC = new URL('../Yggdrasil.js', import.meta.url).pathname;
const ENT = "if (typeof e !== 'number' || (e & 0x3FFFFFFF) !== e) ygFail('entity', 'must be an integer in [0, 2^30-1]');";
const IDX = "insertAt(i, e, m0, m1, m2, m3) {\n    const n = this._len;\n    if (typeof i !== 'number') ygFail('index', 'must be a number');";
const LIVE = '    hdr[YG_LIVE] += 1;\n    this._len = n + 1;';
const CAP = "    if (!(hdr[YG_LIVE] < ar.C)) ygFail('capacity', 'live + 1 > C');";
const HEAD = '    if (m > YG_MAX - t) {\n      ar.sx[0] = m;';

function throwsRange(fn) {
  try { fn(); } catch (e) { return e instanceof RangeError; }
  return false;
}

// Named Entity rows, each a function of a SumSequence class; they throw when the row fails.
const ROWS = {
  'E-4 2^31 rejected': (S) => {
    const s = new S(8, { leafSize: 8 });
    assert.ok(throwsRange(() => s.insertAt(0, 2 ** 31, 1)));
    assert.equal(s.length, 0);
  },
  'E-6 1.5 rejected': (S) => {
    const s = new S(8, { leafSize: 8 });
    assert.ok(throwsRange(() => s.insertAt(0, 1.5, 1)));
    assert.equal(s.length, 0);
  },
  'E-7 entity spy: 0 valueOf calls': (S) => {
    const s = new S(8, { leafSize: 8 }); const sp = spy();
    assert.ok(throwsRange(() => s.insertAt(0, sp, 1)));
    assert.equal(sp.calls, 0);
  },
  'index spy: 0 valueOf calls': (S) => {
    const s = new S(8, { leafSize: 8 }); const sp = spy();
    assert.ok(throwsRange(() => s.insertAt(sp, 1, 1)));
    assert.equal(sp.calls, 0);
  },
  'capacity row: nothing written': (S) => {
    const s = new S(1, { leafSize: 4 });
    s.insertAt(0, 1, 3);
    assert.ok(throwsRange(() => s.insertAt(0, 7, 5)));
    assert.equal(s.length, 1);
    assert.equal(s.available, 0);
  },
  'setMeasure headroom row: nothing written': (S) => {
    const s = new S(8, { leafSize: 8 });
    s.insertAt(0, 1, 10); s.insertAt(1, 2, 20);
    assert.ok(throwsRange(() => s.setMeasure(0, 0, MAX - 19)));
    assert.equal(s.getMeasure(0, 0), 10);
    assert.equal(s.total(0), 30);
  },
};

const MUTANTS = [
  ['M-a Number.isInteger', [[ENT, "if (!Number.isInteger(e)) ygFail('entity', 'must be an integer in [0, 2^30-1]');", 1]], 'E-4 2^31 rejected'],
  ['M-b e|0 coerce', [[ENT, "if (typeof e !== 'number' || ((e | 0) & 0x3FFFFFFF) !== (e | 0)) ygFail('entity', 'must be an integer in [0, 2^30-1]');", 1]], 'E-6 1.5 rejected'],
  ['M-c dropped typeof e', [[ENT, ENT.replace("typeof e !== 'number' || ", ''), 1]], 'E-7 entity spy: 0 valueOf calls'],
  ['M-c2 dropped typeof i', [[IDX, "insertAt(i, e, m0, m1, m2, m3) {\n    const n = this._len;", 1]], 'index spy: 0 valueOf calls'],
  ['M-d store-before-validate', [[LIVE, '', 1], [CAP, LIVE + '\n' + CAP, 1]], 'capacity row: nothing written'],
  ['M-e setMeasure write before headroom', [[HEAD, '    this._meas[dd][(~r << ar.shift) + at] = m + 0;\n' + HEAD, 1]], 'setMeasure headroom row: nothing written'],
];

for (const [name, patches, row] of MUTANTS) {
  test('engine mutant ' + name + ' is killed by row: ' + row, async () => {
    ROWS[row](RealSeq); // the unmutated build passes the row
    const M = await buildMutant(SRC, patches);
    try {
      assert.throws(() => ROWS[row](M.SumSequence), undefined, 'mutant survived');
    } finally {
      M.cleanup();
    }
  });
}
