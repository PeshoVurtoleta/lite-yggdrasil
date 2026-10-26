// test/Oracle.test.mjs -- independent checks of the plain-array model test/oracle.mjs.
//
// Every expectation is derived from the SPEC (ADR 0005 C-9 / C-10 / C-29, ADR 0002
// M-1..M-8 and the DB-7 R / S rows, RESEARCH I-3 / I-4, ADR 0004 A-4, ROADMAP
// metamorphic laws), never from running the oracle. Hand-computed values carry their
// derivation in a comment. Brute-force references below (brute, prefix sums) are
// separate loops over dump(), not calls into the oracle's own seek.
//
// Rows are data: { name, run(mk) } where mk(dims) builds a model. The same rows run
// (a) on the real Oracle (must pass) and (b) on subclass mutants defined here (the
// controls: each mutant must fail the rows it targets, asserted positively).
// ASCII-only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Oracle } from './oracle.mjs';

const MAX = 9007199254740991; // 2^53 - 1 (M-1), spelled out so it is not imported
const TWO53 = 2 ** 53;

const realMk = (dims) => new Oracle(dims);

// ---------------------------------------------------------------- helpers

function snap(o) {
  const tot = [];
  const sb = [];
  for (let d = 0; d < o.dims; d++) {
    tot.push(o.total(d));
    const row = [];
    for (let i = 0; i <= o.length; i++) row.push(o.sumBefore(d, i));
    sb.push(row);
  }
  return { len: o.length, dump: o.dump(), tot, sb };
}

// U row: RangeError (never TypeError), message starts with `token + ' '`, and every
// listed model is bit-for-bit unchanged afterwards.
function rej(token, models, fn) {
  const before = models.map(snap);
  let err;
  try {
    fn();
  } catch (e) {
    err = e;
  }
  assert.ok(err !== undefined, 'expected a ' + token + ' RangeError, nothing thrown');
  assert.ok(err instanceof RangeError, 'expected RangeError, got ' + String(err));
  assert.ok(
    String(err.message).startsWith(token + ' '),
    'expected token "' + token + '", message was "' + err.message + '"'
  );
  assert.deepStrictEqual(models.map(snap), before, 'state changed by a rejected op');
}

// items[k] = array of per-dim measures (or a bare number at dims 1). Entity = 10 + k.
function build(mk, dims, items) {
  const o = mk(dims);
  for (let k = 0; k < items.length; k++) {
    const ms = Array.isArray(items[k]) ? items[k] : [items[k]];
    o.insertAt(k, 10 + k, ...ms);
  }
  return o;
}

// Independent reference seek (M-7): smallest i with S_i + m_i > y, else length.
function brute(ms, y) {
  let s = 0;
  for (let i = 0; i < ms.length; i++) {
    if (s + ms[i] > y) return i;
    s += ms[i];
  }
  return ms.length;
}

// mulberry32, 32-bit exact (Math.imul); one independent instance per stream.
function prng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const R = (name, run) => ({ name, run });

// Apply a measure `m` at dim `d` through insertAt or setMeasure.
function applyM(kind, o, d, m, pos) {
  if (kind === 'insert') {
    const a = [];
    for (let k = 0; k < o.dims; k++) a.push(k === d ? m : 0);
    return o.insertAt(pos, 1, ...a);
  }
  return o.setMeasure(pos, d, m);
}

function baseFor(mk, dims) {
  // two items, every dim = 3, so an unchanged-state check has content.
  const items = [];
  for (let k = 0; k < 2; k++) items.push(new Array(dims).fill(3));
  return build(mk, dims, items);
}

const TABLES = [];
function table(name, rows) {
  TABLES.push({ name, rows });
  for (const r of rows) test(name + ': ' + r.name, () => r.run(realMk));
  return rows;
}
function runRows(rows, mk) {
  const failed = [];
  for (const r of rows) {
    try {
      r.run(mk);
    } catch {
      failed.push(r.name);
    }
  }
  return failed;
}

// ------------------------------------------------- 1. C-9 entity rows E-1..E-7

const ENT_BAD = [
  ['E-4 2^30', 2 ** 30],
  ['E-4 2^31', 2 ** 31],
  ['E-4 2^32', 2 ** 32],
  ['E-4 2^53', 2 ** 53],
  ['E-5 -1', -1],
  ['E-5 -2^31', -(2 ** 31)],
  ['E-6 1.5', 1.5],
  ['E-6 -0.5', -0.5],
  ['E-6 NaN', NaN],
  ['E-6 +Infinity', Infinity],
  ['E-6 -Infinity', -Infinity],
  ['E-7 string', '5'],
  ['E-7 null', null],
  ['E-7 undefined', undefined],
  ['E-7 true', true],
  ['E-7 5n', 5n],
  ['E-7 new Number(5)', new Number(5)],
];

const ENTITY_ROWS = table('C-9 entity', [
  R('E-1 0 ok', (mk) => {
    const o = mk(1);
    o.insertAt(0, 0, 1);
    assert.equal(o.entityAt(0), 0);
    assert.equal(o.length, 1);
  }),
  R('E-1 small ints ok', (mk) => {
    const o = mk(1);
    o.insertAt(0, 7, 1);
    o.insertAt(1, 12345, 1);
    assert.equal(o.entityAt(0), 7);
    assert.equal(o.entityAt(1), 12345);
  }),
  R('E-2 -0 ok, stored as +0', (mk) => {
    const o = mk(1);
    o.insertAt(0, -0, 1);
    assert.ok(Object.is(o.entityAt(0), 0));
    assert.ok(Object.is(o.dump().entities[0], 0));
  }),
  R('E-3 2^30-1 ok', (mk) => {
    const o = mk(1);
    o.insertAt(0, 2 ** 30 - 1, 1);
    assert.equal(o.entityAt(0), 1073741823);
  }),
  ...ENT_BAD.map(([name, bad]) =>
    R(name, (mk) => {
      for (const dims of [1, 2]) {
        const o = build(mk, dims, [new Array(dims).fill(1), new Array(dims).fill(2)]);
        const ms = new Array(dims).fill(5);
        rej('entity', [o], () => o.insertAt(1, bad, ...ms));
      }
    })
  ),
  R('E-7 valueOf / toString / toPrimitive spy: rejected, 0 calls', (mk) => {
    let calls = 0;
    const spy = {
      valueOf() {
        calls++;
        return 5;
      },
      toString() {
        calls++;
        return '5';
      },
      [Symbol.toPrimitive]() {
        calls++;
        return 5;
      },
    };
    const o = build(mk, 1, [1, 2]);
    rej('entity', [o], () => o.insertAt(1, spy, 5));
    assert.equal(calls, 0);
  }),
]);

// ------------------------------------------------- 2. C-10 index rule + order

const IDX_METHODS = [
  ['insertAt', true, (o, i) => o.insertAt(i, 1, 1), (o, i) => {
    assert.equal(o.length, 4);
    assert.equal(o.entityAt(i), 1);
  }],
  ['sumBefore', true, (o, i) => o.sumBefore(0, i), (o, i, r) => {
    // items [1],[2],[3]: prefix sums 0,1,3,6
    assert.equal(r, [0, 1, 3, 6][i]);
  }],
  ['splitAt', true, (o, i, out) => o.splitAt(i, out), (o, i, r, out) => {
    assert.equal(o.length, i);
    assert.equal(out.length, 3 - i);
  }],
  ['removeAt', false, (o, i) => o.removeAt(i), (o, i, r) => {
    assert.equal(r, 10 + i);
    assert.equal(o.length, 2);
  }],
  ['setMeasure', false, (o, i) => o.setMeasure(i, 0, 9), (o, i) => {
    assert.equal(o.getMeasure(i, 0), 9);
  }],
  ['getMeasure', false, (o, i) => o.getMeasure(i, 0), (o, i, r) => {
    assert.equal(r, i + 1);
  }],
  ['entityAt', false, (o, i) => o.entityAt(i), (o, i, r) => {
    assert.equal(r, 10 + i);
  }],
];

const IDX_ROWS = [];
for (const [name, incl, call, check] of IDX_METHODS) {
  const len = 3;
  const hi = incl ? len : len - 1;
  IDX_ROWS.push(
    R('C-10 ' + name + ' in range 0..' + hi, (mk) => {
      for (let i = 0; i <= hi; i++) {
        const o = build(mk, 1, [1, 2, 3]);
        const out = mk(1);
        const r = call(o, i, out);
        check(o, i, r, out);
      }
    })
  );
  const bad = [-1, hi + 1, 0.5, NaN, '1', '0', null, undefined, Infinity, -Infinity, 2 ** 32, 2 ** 53, -0.5];
  IDX_ROWS.push(
    R('C-10 ' + name + ' rejects bad index', (mk) => {
      for (const b of bad) {
        const o = build(mk, 1, [1, 2, 3]);
        const out = mk(1);
        rej('index', [o, out], () => call(o, b, out));
      }
    })
  );
  if (name !== 'insertAt' && name !== 'sumBefore' && name !== 'splitAt') {
    IDX_ROWS.push(
      R('C-10 ' + name + ' on empty: index 0 rejected', (mk) => {
        const o = mk(1);
        rej('index', [o], () => call(o, 0, mk(1)));
      })
    );
  }
}
IDX_ROWS.push(
  R('C-10 empty model: insertAt(0), sumBefore(0,0), splitAt(0) ok; sumBefore(0,1) rejected', (mk) => {
    const o = mk(1);
    assert.equal(o.sumBefore(0, 0), 0);
    rej('index', [o], () => o.sumBefore(0, 1));
    const out = mk(1);
    assert.equal(o.splitAt(0, out), o);
    assert.equal(o.length + out.length, 0);
    o.insertAt(0, 1, 1);
    assert.equal(o.length, 1);
  }),
  R('C-10 index with valueOf spy: rejected, 0 calls', (mk) => {
    let calls = 0;
    const spy = { valueOf() { calls++; return 1; } };
    const o = build(mk, 1, [1, 2, 3]);
    rej('index', [o], () => o.entityAt(spy));
    rej('index', [o], () => o.insertAt(spy, 1, 1));
    assert.equal(calls, 0);
  })
);
table('C-10 index', IDX_ROWS);

const ORDER_ROWS = table('C-10 order', [
  R('index + entity -> index', (mk) => {
    const o = build(mk, 1, [1, 2]);
    rej('index', [o], () => o.insertAt(9, -1, 5));
  }),
  R('index + measure -> index', (mk) => {
    const o = build(mk, 1, [1, 2]);
    rej('index', [o], () => o.insertAt(-1, 1, -5));
  }),
  R('entity + measure -> entity', (mk) => {
    const o = build(mk, 1, [1, 2]);
    rej('entity', [o], () => o.insertAt(1, -1, -5));
    rej('entity', [o], () => o.insertAt(1, 2 ** 30, 'x'));
  }),
  R('entity + extra slot -> entity', (mk) => {
    const o = build(mk, 1, [1, 2]);
    rej('entity', [o], () => o.insertAt(1, -1, 5, 0));
  }),
  R('measure + extra slot -> measure', (mk) => {
    const o = build(mk, 1, [1, 2]);
    rej('measure', [o], () => o.insertAt(1, 1, -5, 0));
    rej('measure', [o], () => o.insertAt(1, 1, NaN, 0));
  }),
  R('extra slot + headroom overflow -> extra', (mk) => {
    const o = build(mk, 1, [MAX]);
    rej('extra', [o], () => o.insertAt(0, 1, 1, 0));
    rej('headroom', [o], () => o.insertAt(0, 1, 1));
  }),
  R('measure (dim 1) + headroom (dim 0) -> measure', (mk) => {
    const o = build(mk, 2, [[MAX, 0]]);
    rej('measure', [o], () => o.insertAt(0, 1, 1, -1));
    rej('measure', [o], () => o.insertAt(0, 1, 1, 'x'));
    rej('headroom', [o], () => o.insertAt(0, 1, 1, 0));
  }),
  R('missing measure -> measure', (mk) => {
    const o = build(mk, 1, [1]);
    rej('measure', [o], () => o.insertAt(0, 1));
    const p = build(mk, 2, [[1, 1]]);
    rej('measure', [p], () => p.insertAt(0, 1, 5));
  }),
  R('setMeasure: index + dim -> index; dim + measure -> dim; index + measure -> index', (mk) => {
    const o = build(mk, 1, [1, 2]);
    rej('index', [o], () => o.setMeasure(9, 7, 1));
    rej('dim', [o], () => o.setMeasure(0, 7, -1));
    rej('index', [o], () => o.setMeasure(9, 0, -1));
    rej('measure', [o], () => o.setMeasure(0, 0, -1));
  }),
  R('getMeasure / sumBefore: index before dim', (mk) => {
    const o = build(mk, 1, [1, 2]);
    rej('index', [o], () => o.getMeasure(9, 7));
    rej('dim', [o], () => o.getMeasure(0, 7));
    rej('index', [o], () => o.sumBefore(7, 9));
    rej('dim', [o], () => o.sumBefore(7, 0));
    // dim before seek (bad d and bad y) -> dim
    rej('dim', [o], () => o.indexAtSum(7, -1));
    // -0 acts as 0 for index and dim
    assert.equal(o.entityAt(-0), 10);
    assert.equal(o.getMeasure(0, -0), 1);
    assert.equal(o.sumBefore(-0, 1), 1);
  }),
]);

// ------------------------------------------------- 3. extra slots

const EXTRA_ROWS = table('C-10 extra', [
  R('dims 1: insertAt(0,7,5,undefined) ok; insertAt(0,7,5,0) rejected', (mk) => {
    const o = mk(1);
    o.insertAt(0, 7, 5, undefined);
    assert.equal(o.length, 1);
    assert.equal(o.getMeasure(0, 0), 5);
    rej('extra', [o], () => o.insertAt(0, 7, 5, 0));
  }),
  R('dims 1..3: every slot >= dims rejects any non-undefined; undefined is legal', (mk) => {
    for (let dims = 1; dims <= 3; dims++) {
      for (let s = dims; s < 4; s++) {
        for (const bad of [0, 1, null, '', false, NaN, 5n]) {
          const o = build(mk, dims, [new Array(dims).fill(1)]);
          const args = [];
          for (let k = 0; k < 4; k++) args.push(k < dims ? 2 : undefined);
          args[s] = bad;
          rej('extra', [o], () => o.insertAt(0, 3, ...args));
        }
        const o = mk(dims);
        const args = [];
        for (let k = 0; k < 4; k++) args.push(k < dims ? 2 : undefined);
        o.insertAt(0, 3, ...args);
        assert.equal(o.length, 1);
      }
    }
  }),
  R('dims 4: all four slots are measures, none is extra', (mk) => {
    const o = mk(4);
    o.insertAt(0, 3, 1, 2, 3, 4);
    for (let d = 0; d < 4; d++) assert.equal(o.getMeasure(0, d), d + 1);
    rej('measure', [o], () => o.insertAt(0, 3, 1, 2, 3, undefined));
  }),
]);

// ------------------------------------------------- 4. measures M-1..M-4, M-8

const KINDS = ['insert', 'set'];
const ACCEPT = [
  ['R-1 0', 0, 0],
  ['R-2 -0 stored as +0', -0, 0],
  ['R-1 1', 1, 1],
  ['R-7 2^31-1', 2 ** 31 - 1, 2 ** 31 - 1],
  ['R-7 2^31', 2 ** 31, 2147483648],
  ['R-7 2^32', 2 ** 32, 4294967296],
  ['R-7 2^32+1', 2 ** 32 + 1, 4294967297],
  ['M-1 2^40+1', 2 ** 40 + 1, 1099511627777],
  ['R-10 2^52', 2 ** 52, 4503599627370496],
  ['R-10 MAX', MAX, 9007199254740991],
];
const REJECT = [
  ['R-3 NaN', NaN],
  ['R-4 +Infinity', Infinity],
  ['R-5 -Infinity', -Infinity],
  ['R-6 0.5', 0.5],
  ['R-6 2^52-0.5', 2 ** 52 - 0.5],
  ['R-6 1.5', 1.5],
  ['R-8 -1', -1],
  ['R-8 -0.5', -0.5],
  ['R-9 string 5', '5'],
  ['R-9 empty string', ''],
  ['R-9 null', null],
  ['R-9 undefined', undefined],
  ['R-9 true', true],
  ['R-9 5n', 5n],
  ['R-9 new Number(5)', new Number(5)],
  ['R-9 array', [5]],
  ['R-11 2^53', TWO53],
  ['R-11 2^53+2', TWO53 + 2],
  ['R-11 1e300', 1e300],
];

const MEASURE_ROWS = table('M measures', [
  ...ACCEPT.map(([name, m, exp]) =>
    R(name + ' accepted (insert + set, dims 1 and 3, every dim)', (mk) => {
      for (const kind of KINDS) {
        for (const dims of [1, 3]) {
          for (let d = 0; d < dims; d++) {
            const o = kind === 'insert' ? mk(dims) : build(mk, dims, [new Array(dims).fill(0)]);
            applyM(kind, o, d, m, 0);
            assert.ok(Object.is(o.getMeasure(0, d), exp), kind + ' ' + dims + ' ' + d);
            assert.ok(Object.is(o.total(d), exp));
            for (let e = 0; e < dims; e++) if (e !== d) assert.ok(Object.is(o.total(e), 0));
          }
        }
      }
    })
  ),
  R('R-2 [-0,-0]: getMeasure and total are +0 (Object.is)', (mk) => {
    for (const kind of KINDS) {
      const o = mk(1);
      o.insertAt(0, 1, 0);
      o.insertAt(1, 2, 0);
      if (kind === 'insert') {
        const p = mk(1);
        p.insertAt(0, 1, -0);
        p.insertAt(1, 2, -0);
        assert.ok(Object.is(p.getMeasure(0, 0), 0));
        assert.ok(Object.is(p.getMeasure(1, 0), 0));
        assert.ok(Object.is(p.total(0), 0));
        assert.ok(Object.is(p.sumBefore(0, 2), 0));
      } else {
        o.setMeasure(0, 0, -0);
        o.setMeasure(1, 0, -0);
        assert.ok(Object.is(o.getMeasure(0, 0), 0));
        assert.ok(Object.is(o.getMeasure(1, 0), 0));
        assert.ok(Object.is(o.total(0), 0));
      }
    }
  }),
  ...REJECT.map(([name, bad]) =>
    R(name + ' rejected (insert + set, dims 1 and 2, every dim)', (mk) => {
      for (const kind of KINDS) {
        for (const dims of [1, 2]) {
          for (let d = 0; d < dims; d++) {
            const o = baseFor(mk, dims);
            rej('measure', [o], () => applyM(kind, o, d, bad, 1));
          }
        }
      }
    })
  ),
  R('R-9 valueOf spy measure: rejected, 0 calls', (mk) => {
    let calls = 0;
    const spy = { valueOf() { calls++; return 5; } };
    for (const kind of KINDS) {
      const o = baseFor(mk, 1);
      rej('measure', [o], () => applyM(kind, o, 0, spy, 1));
    }
    assert.equal(calls, 0);
  }),
  R('R-12 2^52 then 2^52-1 ok, total = MAX (insert); set variant', (mk) => {
    const o = mk(1);
    o.insertAt(0, 1, 2 ** 52);
    o.insertAt(1, 2, 2 ** 52 - 1);
    assert.equal(o.total(0), MAX);
    const p = build(mk, 1, [2 ** 52, 0]);
    p.setMeasure(1, 0, 2 ** 52 - 1);
    assert.equal(p.total(0), MAX);
  }),
  R('R-13 total MAX: insert 1 / grow by 1 -> headroom; insert 0 ok', (mk) => {
    const o = build(mk, 1, [MAX]);
    rej('headroom', [o], () => o.insertAt(0, 1, 1));
    rej('headroom', [o], () => o.insertAt(1, 1, 1));
    o.insertAt(1, 1, 0);
    assert.equal(o.total(0), MAX);
    const p = build(mk, 1, [MAX - 1, 1]);
    rej('headroom', [p], () => p.setMeasure(1, 0, 2));
    rej('headroom', [p], () => p.setMeasure(0, 0, MAX));
  }),
  R('R-14 total 2^53-2: insert 3 and 2 -> headroom (true sum rounds); insert 1 ok', (mk) => {
    // 2^53-2 + 3 = 2^53+1 (rounds to 2^53 in floats); 2^53-2 + 2 = 2^53 > MAX.
    const o = build(mk, 1, [TWO53 - 2]);
    rej('headroom', [o], () => o.insertAt(0, 1, 3));
    rej('headroom', [o], () => o.insertAt(0, 1, 2));
    o.insertAt(0, 1, 1);
    assert.equal(o.total(0), MAX);
    // set variant: [2^53-5, 3], set(1,5) -> exactly 2^53 > MAX; set(1,4) -> MAX ok.
    const p = build(mk, 1, [TWO53 - 5, 3]);
    rej('headroom', [p], () => p.setMeasure(1, 0, 5));
    p.setMeasure(1, 0, 4);
    assert.equal(p.total(0), MAX);
  }),
  R('R-15 [2^52, 2^52-1]: set(1,0) ok; set(1,2^52-1) ok; set(1,2^52) rejected, stays 2^52-1', (mk) => {
    const o = build(mk, 1, [2 ** 52, 2 ** 52 - 1]);
    o.setMeasure(1, 0, 0);
    assert.equal(o.total(0), 2 ** 52);
    o.setMeasure(1, 0, 2 ** 52 - 1);
    assert.equal(o.total(0), MAX);
    rej('headroom', [o], () => o.setMeasure(1, 0, 2 ** 52));
    assert.equal(o.getMeasure(1, 0), 2 ** 52 - 1);
  }),
  R('R-16 total MAX: setMeasure(i,d,m_old) ok (no-op); m_old+1 rejected; smaller ok', (mk) => {
    const o = build(mk, 1, [MAX - 3, 3]);
    o.setMeasure(1, 0, 3);
    o.setMeasure(0, 0, MAX - 3);
    assert.equal(o.total(0), MAX);
    rej('headroom', [o], () => o.setMeasure(1, 0, 4));
    rej('headroom', [o], () => o.setMeasure(0, 0, MAX - 2));
    o.setMeasure(1, 0, 0);
    assert.equal(o.total(0), MAX - 3);
    const q = build(mk, 1, [MAX]);
    q.setMeasure(0, 0, MAX);
    assert.equal(q.total(0), MAX);
  }),
  R('R-17 dims 2, dim-1 total MAX: insert (5,1) -> headroom; (5,-1) -> measure; dim 0 unchanged', (mk) => {
    const o = build(mk, 2, [[5, MAX]]);
    rej('headroom', [o], () => o.insertAt(0, 1, 5, 1));
    rej('measure', [o], () => o.insertAt(0, 1, 5, -1));
    assert.equal(o.total(0), 5);
    o.insertAt(0, 1, 5, 0);
    assert.equal(o.total(0), 10);
    // dim 0 growth is independent of the dim-1 total
    o.setMeasure(0, 0, 6);
    assert.equal(o.total(0), 11);
    rej('headroom', [o], () => o.setMeasure(0, 1, 1)); // item 0 dim 1 is 0; dim-1 total MAX
  }),
  R('R-19 removeAt at total MAX ok', (mk) => {
    const o = build(mk, 1, [MAX - 3, 3]);
    assert.equal(o.removeAt(1), 11);
    assert.equal(o.total(0), MAX - 3);
    const p = build(mk, 1, [MAX]);
    assert.equal(p.removeAt(0), 10);
    assert.equal(p.total(0), 0);
  }),
  R('R-20 bad d rejected for setMeasure / getMeasure / total / sumBefore / indexAtSum', (mk) => {
    for (const dims of [1, 2]) {
      const bad = [dims, -1, 0.5, '0', NaN, null, undefined, Infinity, true];
      for (const b of bad) {
        const o = build(mk, dims, [new Array(dims).fill(1), new Array(dims).fill(2)]);
        rej('dim', [o], () => o.setMeasure(0, b, 1));
        rej('dim', [o], () => o.getMeasure(0, b));
        rej('dim', [o], () => o.total(b));
        rej('dim', [o], () => o.sumBefore(b, 0));
        rej('dim', [o], () => o.indexAtSum(b, 1));
      }
    }
  }),
  R('R-21 sumBefore(d, length) = total; i in {length+1, -1, 0.5} rejected', (mk) => {
    for (const dims of [1, 2]) {
      const o = build(mk, dims, [new Array(dims).fill(4), new Array(dims).fill(0), new Array(dims).fill(9)]);
      for (let d = 0; d < dims; d++) {
        assert.equal(o.sumBefore(d, o.length), o.total(d));
        assert.equal(o.total(d), 13);
        rej('index', [o], () => o.sumBefore(d, o.length + 1));
        rej('index', [o], () => o.sumBefore(d, -1));
        rej('index', [o], () => o.sumBefore(d, 0.5));
      }
    }
  }),
]);

// ------------------------------------------------- 4b/5. seek rows S-1..S-9, I-4

const SEEK_BAD = [
  ['S-5 -1', -1],
  ['S-5 -0.5', -0.5],
  ['S-5 -Infinity', -Infinity],
  ['S-5 +Infinity', Infinity],
  ['S-5 NaN', NaN],
  ['S-5 string 1', '1'],
  ['S-5 null', null],
  ['S-5 undefined', undefined],
  ['S-5 true', true],
  ['S-5 1n', 1n],
  ['S-5 new Number(1)', new Number(1)],
];

// Coverage-counted randomized I-4 / M-7 law. Three independent PRNG streams:
// shape (K), value (V), seek target (Y).
function randomSeek(mk) {
  const rngK = prng(0x9e3779b1);
  const rngV = prng(0x85ebca6b);
  const rngY = prng(0xc2b2ae35);
  const cov = { models: 0, zeros: 0, adjZero: 0, skips: 0, trailing: 0, big: 0, ys: 0, ysEnd: 0, ysInner: 0 };
  const zeroPs = [0.2, 0.5, 0.8, 0.95];
  for (let trial = 0; trial < 200; trial++) {
    const dims = 1 + (trial % 3);
    const n = Math.floor(rngK() * 40);
    const zeroP = zeroPs[trial % 4];
    const o = mk(dims);
    const val = () => {
      const u = rngV();
      if (u < zeroP) return 0;
      if (rngV() < 0.03) { cov.big++; return 2 ** 40 + Math.floor(rngV() * 1000); }
      return 1 + Math.floor(rngV() * 6);
    };
    for (let k = 0; k < n; k++) {
      const ms = [];
      for (let d = 0; d < dims; d++) ms.push(val());
      o.insertAt(Math.floor(rngK() * (o.length + 1)), k + 1, ...ms);
    }
    for (let k = 0; k < 6 && o.length > 0; k++) {
      if (rngK() < 0.5) o.setMeasure(Math.floor(rngK() * o.length), Math.floor(rngK() * dims), val());
      else o.removeAt(Math.floor(rngK() * o.length));
    }
    cov.models++;
    const dump = o.dump();
    for (let d = 0; d < dims; d++) {
      const ms = dump.measures[d];
      const len = ms.length;
      const pre = [0];
      for (let i = 0; i < len; i++) pre.push(pre[i] + ms[i]);
      assert.equal(o.total(d), pre[len]);
      for (let i = 0; i < len; i++) {
        if (ms[i] === 0) cov.zeros++;
        if (i > 0 && ms[i] === 0 && ms[i - 1] === 0) cov.adjZero++;
      }
      for (let i = 0; i <= len; i++) {
        assert.equal(o.sumBefore(d, i), pre[i]);
        let exp = len;
        for (let j = i; j < len; j++) if (ms[j] > 0) { exp = j; break; }
        assert.equal(o.indexAtSum(d, pre[i]), exp, 'metamorphic i=' + i);
        if (i < len && exp > i) cov.skips++;
        if (i < len && exp === len) cov.trailing++;
      }
      for (let q = 0; q < 20; q++) {
        const y = Math.floor(rngY() * (pre[len] + 3)) + (rngY() < 0.3 ? 0.5 : 0);
        const r = o.indexAtSum(d, y);
        assert.equal(r, brute(ms, y), 'brute y=' + y);
        if (r < len) assert.ok(ms[r] > 0, 'corollary: m_r > 0');
        cov.ys++;
        if (r === len) cov.ysEnd++;
        else cov.ysInner++;
      }
    }
  }
  return cov;
}

const SEEK_ROWS = table('S seek', [
  R('S-1 empty: y=0 and y=7 -> 0', (mk) => {
    const o = mk(1);
    assert.equal(o.indexAtSum(0, 0), 0);
    assert.equal(o.indexAtSum(0, 7), 0);
  }),
  R('S-2 [0,0,0]: y=0 -> 3', (mk) => {
    assert.equal(build(mk, 1, [0, 0, 0]).indexAtSum(0, 0), 3);
  }),
  R('S-3 [0,0,2]: y=0 -> 2; [2,0,0,3]: y=1,2,4.9 -> 0,3,3', (mk) => {
    // [0,0,2]: ends 0,0,2; first end > 0 is index 2.
    assert.equal(build(mk, 1, [0, 0, 2]).indexAtSum(0, 0), 2);
    // [2,0,0,3]: ends 2,2,2,5: y=1 -> 0; y=2 -> 3 (2>2 false x3); y=4.9 -> 3.
    const o = build(mk, 1, [2, 0, 0, 3]);
    assert.equal(o.indexAtSum(0, 1), 0);
    assert.equal(o.indexAtSum(0, 2), 3);
    assert.equal(o.indexAtSum(0, 4.9), 3);
  }),
  R('S-4 [1 x12, 0 x8, 1 x12]: y=12 -> 20', (mk) => {
    // ends 1..12 then 12 x8 then 13..24: first end > 12 is index 20.
    const items = [];
    for (let i = 0; i < 12; i++) items.push(1);
    for (let i = 0; i < 8; i++) items.push(0);
    for (let i = 0; i < 12; i++) items.push(1);
    const o = build(mk, 1, items);
    assert.equal(o.indexAtSum(0, 12), 20);
    assert.equal(o.indexAtSum(0, 11), 11);
    assert.equal(o.indexAtSum(0, 24), 32);
  }),
  ...SEEK_BAD.map(([name, y]) =>
    R(name + ' rejected', (mk) => {
      for (const dims of [1, 2]) {
        const o = build(mk, dims, [new Array(dims).fill(1), new Array(dims).fill(2)]);
        for (let d = 0; d < dims; d++) rej('seek', [o], () => o.indexAtSum(d, y));
      }
    })
  ),
  R('S-5 valueOf spy y: rejected, 0 calls', (mk) => {
    let calls = 0;
    const spy = { valueOf() { calls++; return 1; } };
    const o = build(mk, 1, [1, 2]);
    rej('seek', [o], () => o.indexAtSum(0, spy));
    assert.equal(calls, 0);
  }),
  R('S-6 y=-0 acts as 0 on [0,0,2] -> 2', (mk) => {
    assert.equal(build(mk, 1, [0, 0, 2]).indexAtSum(0, -0), 2);
  }),
  R('S-7 [2,2]: 1.999,2.5,3.999 -> 0,1,1; [2^52,1]: 2^52-0.5 -> 0', (mk) => {
    const o = build(mk, 1, [2, 2]);
    assert.equal(o.indexAtSum(0, 1.999), 0);
    assert.equal(o.indexAtSum(0, 2.5), 1);
    assert.equal(o.indexAtSum(0, 3.999), 1);
    const p = build(mk, 1, [2 ** 52, 1]);
    assert.equal(p.indexAtSum(0, 2 ** 52 - 0.5), 0);
    assert.equal(p.indexAtSum(0, 2 ** 52), 1);
  }),
  R('S-8 y = total -> length; y = total-1 with last m=1 -> length-1', (mk) => {
    const o = build(mk, 1, [3, 1]); // total 4
    assert.equal(o.indexAtSum(0, 4), 2);
    assert.equal(o.indexAtSum(0, 3), 1);
  }),
  R('S-9 finite y > total -> length', (mk) => {
    const o = build(mk, 1, [3, 1]);
    assert.equal(o.indexAtSum(0, 5), 2);
    assert.equal(o.indexAtSum(0, 1e300), 2);
    assert.equal(o.indexAtSum(0, TWO53), 2);
    assert.equal(o.indexAtSum(0, Number.MAX_VALUE), 2);
  }),
  R('I-4 randomized: metamorphic + brute-force seek over a seeded model (200 models)', (mk) => {
    randomSeek(mk);
  }),
]);

test('I-4 randomized coverage floor (seeded, 200 models)', () => {
  const cov = randomSeek(realMk);
  assert.equal(cov.models, 200);
  assert.ok(cov.zeros >= 300, 'zero items ' + cov.zeros);
  assert.ok(cov.adjZero >= 150, 'adjacent zeros ' + cov.adjZero);
  assert.ok(cov.skips >= 300, 'zero-skipping seeks ' + cov.skips);
  assert.ok(cov.trailing >= 50, 'trailing-zero seeks ' + cov.trailing);
  assert.ok(cov.big >= 5, 'big measures ' + cov.big);
  assert.ok(cov.ys >= 4000, 'ys ' + cov.ys);
  assert.ok(cov.ysEnd >= 200 && cov.ysInner >= 1000, 'ys end ' + cov.ysEnd + ' inner ' + cov.ysInner);
  // determinism: the same seeds give the same coverage
  assert.deepStrictEqual(randomSeek(realMk), cov);
});

// ------------------------------------------------- 6. split / append / clear / ctor

const SPLIT_ITEMS = [[1, 0], [0, 4], [3, 3], [0, 0], [5, 1], [2, 0], [0, 7]];

function dumpEq(a, b) {
  assert.deepStrictEqual(a.dump(), b.dump());
}

const SPLIT_ROWS = table('split/append', [
  R('splitAt(i) then append == identity at every i (dims 2); append empties other', (mk) => {
    const ref = build(mk, 2, SPLIT_ITEMS);
    for (let i = 0; i <= SPLIT_ITEMS.length; i++) {
      const a = build(mk, 2, SPLIT_ITEMS);
      const out = mk(2);
      assert.equal(a.splitAt(i, out), a);
      assert.equal(a.length, i);
      assert.equal(out.length, SPLIT_ITEMS.length - i);
      const d0 = ref.dump();
      assert.deepStrictEqual(a.dump().entities, d0.entities.slice(0, i));
      assert.deepStrictEqual(out.dump().entities, d0.entities.slice(i));
      for (let d = 0; d < 2; d++) {
        assert.deepStrictEqual(a.dump().measures[d], d0.measures[d].slice(0, i));
        assert.deepStrictEqual(out.dump().measures[d], d0.measures[d].slice(i));
        assert.equal(a.total(d) + out.total(d), ref.total(d));
      }
      assert.equal(a.append(out), a);
      dumpEq(a, ref);
      assert.equal(out.length, 0);
      assert.equal(out.total(0), 0);
      assert.equal(out.total(1), 0);
      assert.deepStrictEqual(out.dump(), { entities: [], measures: [[], []] });
      for (let d = 0; d < 2; d++) assert.equal(a.total(d), ref.total(d));
    }
  }),
  R('insertAt(i) then removeAt(i) == identity', (mk) => {
    const ref = build(mk, 2, SPLIT_ITEMS);
    for (let i = 0; i <= SPLIT_ITEMS.length; i++) {
      const a = build(mk, 2, SPLIT_ITEMS);
      a.insertAt(i, 99, 5, 6);
      assert.equal(a.entityAt(i), 99);
      assert.equal(a.removeAt(i), 99);
      dumpEq(a, ref);
    }
  }),
  R('append to / from empty', (mk) => {
    const a = build(mk, 1, [1, 2]);
    const e = mk(1);
    assert.equal(a.append(e), a);
    assert.equal(a.length, 2);
    assert.equal(e.append(a), e);
    assert.equal(e.length, 2);
    assert.equal(a.length, 0);
    assert.equal(e.total(0), 3);
  }),
  R('splitAt operand rows: self, non-empty out, dims mismatch, non-Oracle', (mk) => {
    const a = build(mk, 1, [1, 2]);
    rej('operand', [a], () => a.splitAt(1, a));
    // empty self: only the self check can fire (the non-empty-out check would mask it above)
    const z = mk(1);
    rej('operand', [z], () => z.splitAt(0, z));
    // index out of range AND bad operand -> index first
    rej('index', [a], () => a.splitAt(9, mk(2)));
    const full = build(mk, 1, [5]);
    rej('operand', [a, full], () => a.splitAt(1, full));
    const wide = mk(2);
    rej('operand', [a, wide], () => a.splitAt(1, wide));
    for (const bad of [{}, null, undefined, [], 5, 'x', { dims: 1, length: 0, insertAt() {} }]) {
      rej('operand', [a], () => a.splitAt(1, bad));
    }
  }),
  R('append operand rows: self, dims mismatch, non-Oracle', (mk) => {
    const a = build(mk, 1, [1, 2]);
    rej('operand', [a], () => a.append(a));
    const wide = build(mk, 2, [[1, 1]]);
    rej('operand', [a, wide], () => a.append(wide));
    rej('operand', [wide, a], () => wide.append(a));
    for (const bad of [{}, null, undefined, [], 5, 'x', { dims: 1, length: 0 }]) {
      rej('operand', [a], () => a.append(bad));
    }
  }),
  R('R-18 append: tL+tR = 2^53 -> headroom, both unchanged; = MAX ok (dims 1)', (mk) => {
    const a = build(mk, 1, [2 ** 52]);
    const b = build(mk, 1, [2 ** 52]);
    rej('headroom', [a, b], () => a.append(b));
    const c = build(mk, 1, [2 ** 52]);
    const e = build(mk, 1, [2 ** 52 - 1]);
    c.append(e);
    assert.equal(c.total(0), MAX);
    assert.equal(c.length, 2);
    assert.equal(e.length, 0);
  }),
  R('append headroom per dim (dims 2): dim 0 fine, dim 1 overflows -> headroom, both unchanged', (mk) => {
    const a = build(mk, 2, [[1, MAX], [2, 0]]);
    const b = build(mk, 2, [[1, 1]]);
    rej('headroom', [a, b], () => a.append(b));
    const c = build(mk, 2, [[2 ** 52, 5]]);
    const e = build(mk, 2, [[2 ** 52 - 1, 1]]);
    c.append(e);
    assert.equal(c.total(0), MAX);
    assert.equal(c.total(1), 6);
  }),
  R('clear() empties and leaves a reusable model; other models untouched', (mk) => {
    const a = build(mk, 2, SPLIT_ITEMS);
    const other = build(mk, 2, SPLIT_ITEMS);
    a.clear();
    assert.equal(a.length, 0);
    assert.equal(a.total(0), 0);
    assert.equal(a.total(1), 0);
    assert.equal(a.sumBefore(0, 0), 0);
    assert.equal(a.indexAtSum(1, 0), 0);
    assert.deepStrictEqual(a.dump(), { entities: [], measures: [[], []] });
    assert.equal(other.length, SPLIT_ITEMS.length);
    a.insertAt(0, 3, 4, 5);
    assert.equal(a.total(1), 5);
    assert.equal(a.dims, 2);
  }),
  R('dump() returns fresh copies', (mk) => {
    const a = build(mk, 1, [1, 2]);
    const d = a.dump();
    d.entities[0] = 999;
    d.measures[0][0] = 999;
    d.measures.push([1]);
    assert.equal(a.entityAt(0), 10);
    assert.equal(a.getMeasure(0, 0), 1);
    assert.deepStrictEqual(a.dump(), { entities: [10, 11], measures: [[1, 2]] });
    assert.notEqual(a.dump().entities, a.dump().entities);
  }),
]);

test('constructor: dims 1..4 ok, default 1; others RangeError "dims"', () => {
  assert.equal(new Oracle().dims, 1);
  assert.equal(new Oracle(undefined).dims, 1);
  for (let d = 1; d <= 4; d++) assert.equal(new Oracle(d).dims, d);
  assert.equal(new Oracle(3).length, 0);
  for (const bad of [0, 5, -1, 1.5, '2', NaN, null, Infinity, true, 2n]) {
    let err;
    try { new Oracle(bad); } catch (e) { err = e; }
    assert.ok(err instanceof RangeError, 'dims ' + String(bad));
    assert.ok(err.message.startsWith('dims '), err.message);
  }
});

// ------------------------------------------------- 7. multi-dim

const MULTI_ROWS = table('multi-dim', [
  R('dims 2..4: totals, getMeasure, sumBefore, indexAtSum per dim', (mk) => {
    for (let dims = 2; dims <= 4; dims++) {
      const n = 9;
      const items = [];
      for (let k = 0; k < n; k++) {
        const row = [];
        // spec-free deterministic pattern with zeros in every dim
        for (let d = 0; d < dims; d++) row.push((k * (d + 2) + d) % 5 === 0 ? 0 : ((k + 1) * (d + 1)) % 7);
        items.push(row);
      }
      const o = build(mk, dims, items);
      assert.equal(o.length, n);
      for (let d = 0; d < dims; d++) {
        const ms = items.map((r) => r[d]);
        let s = 0;
        for (let i = 0; i < n; i++) {
          assert.equal(o.getMeasure(i, d), ms[i]);
          assert.equal(o.sumBefore(d, i), s);
          s += ms[i];
        }
        assert.equal(o.total(d), s);
        assert.equal(o.sumBefore(d, n), s);
        for (const y of [0, 1, 2, 3.5, 7, s - 1, s, s + 1]) {
          if (y >= 0) assert.equal(o.indexAtSum(d, y), brute(ms, y), 'dims ' + dims + ' d ' + d + ' y ' + y);
        }
      }
      // setMeasure touches one dim only
      const before = [];
      for (let d = 0; d < dims; d++) before.push(o.total(d));
      const old = o.getMeasure(2, dims - 1);
      o.setMeasure(2, dims - 1, old + 10);
      for (let d = 0; d < dims; d++) assert.equal(o.total(d), before[d] + (d === dims - 1 ? 10 : 0));
    }
  }),
  R('insertAt(i) places at i and shifts later items (entity order)', (mk) => {
    const o = mk(2);
    o.insertAt(0, 3, 1, 1);
    o.insertAt(0, 2, 1, 1);
    o.insertAt(0, 1, 1, 1);
    o.insertAt(3, 4, 1, 1);
    o.insertAt(2, 9, 7, 8);
    assert.deepStrictEqual(o.dump().entities, [1, 2, 9, 3, 4]);
    assert.deepStrictEqual(o.dump().measures, [[1, 1, 7, 1, 1], [1, 1, 8, 1, 1]]);
  }),
]);

// ------------------------------------------------- 8. controls (gate teeth)

// Each mutant subclass is run against every row table; the rows it targets must fail.
class NonStrictSeek extends Oracle {
  indexAtSum(d, y) {
    super.indexAtSum(d, y); // keep the arg validation
    const ms = this.dump().measures[d];
    let s = 0;
    for (let i = 0; i < ms.length; i++) {
      if (s + ms[i] >= y) return i; // MUTANT: >= instead of >
      s += ms[i];
    }
    return ms.length;
  }
}

class IntOrZero extends Oracle {
  static chk(m) {
    if (typeof m === 'number' && m >= 0 && m <= MAX && Number.isInteger(m) && (m | 0) !== m) {
      throw new RangeError('measure mutant: |0 integer test');
    }
  }
  insertAt(i, e, m0, m1, m2, m3) {
    IntOrZero.chk(m0); IntOrZero.chk(m1); IntOrZero.chk(m2); IntOrZero.chk(m3);
    return super.insertAt(i, e, m0, m1, m2, m3);
  }
  setMeasure(i, d, m) {
    IntOrZero.chk(m);
    return super.setMeasure(i, d, m);
  }
}

class NoCanonZero extends Oracle {
  constructor(dims) {
    super(dims);
    this._neg = [[], [], [], []];
  }
  insertAt(i, e, m0, m1, m2, m3) {
    const r = super.insertAt(i, e, m0, m1, m2, m3);
    const a = [m0, m1, m2, m3];
    for (let d = 0; d < this.dims; d++) this._neg[d].splice(i, 0, Object.is(a[d], -0));
    return r;
  }
  removeAt(i) {
    const r = super.removeAt(i);
    for (let d = 0; d < this.dims; d++) this._neg[d].splice(i, 1);
    return r;
  }
  setMeasure(i, d, m) {
    const r = super.setMeasure(i, d, m);
    this._neg[d][i] = Object.is(m, -0);
    return r;
  }
  getMeasure(i, d) {
    const v = super.getMeasure(i, d);
    return v === 0 && this._neg[d][i] ? -0 : v; // MUTANT: stores m as given
  }
}

class EntityInt32 extends Oracle {
  insertAt(i, e, m0, m1, m2, m3) {
    // MUTANT: `e === (e | 0)` as the entity test; int32 values pass, stored as 0 here.
    if (typeof e === 'number' && e === (e | 0)) e = 0;
    return super.insertAt(i, e, m0, m1, m2, m3);
  }
}

class EntityOffByOne extends Oracle {
  insertAt(i, e, m0, m1, m2, m3) {
    if (typeof e === 'number' && e === 2 ** 30 - 1) e = 2 ** 30; // MUTANT: top of domain rejected
    return super.insertAt(i, e, m0, m1, m2, m3);
  }
}

const ALL_ROWS = TABLES.flatMap((t) => t.rows);

function mutantMk(Cls) {
  return (dims) => new Cls(dims);
}

test('controls: the real Oracle passes every row table (positive control)', () => {
  assert.deepStrictEqual(runRows(ALL_ROWS, realMk), []);
  assert.ok(ALL_ROWS.length >= 60, 'row count ' + ALL_ROWS.length);
});

const CONTROLS = [
  ['non-strict seek (>=) fails the I-4 / S rows', NonStrictSeek, ['S-2', 'S-3', 'S-4', 'I-4 randomized:']],
  ['|0 integer test fails the 2^31 accept row', IntOrZero, ['R-7 2^31', 'R-7 2^32', 'R-10 MAX']],
  ['no -0 canonicalization fails the -0 rows', NoCanonZero, ['R-2']],
  ['int32 entity test fails E-4', EntityInt32, ['E-4 2^30']],
  ['off-by-one entity bound fails E-3', EntityOffByOne, ['E-3']],
];
for (const [name, Cls, targets] of CONTROLS) {
  test('control: ' + name, () => {
    const failed = runRows(ALL_ROWS, mutantMk(Cls));
    assert.ok(failed.length > 0, 'mutant survived every row');
    for (const t of targets) {
      assert.ok(
        failed.some((f) => f === t || f.startsWith(t + ' ')),
        'mutant not killed by a row starting "' + t + '"; failed: ' + failed.join(' | ')
      );
    }
  });
}

test('controls: every mutant leaves the rows it does not target mostly passing (teeth are narrow)', () => {
  // A mutant that fails everything would "pass" the control above trivially.
  for (const [, Cls] of CONTROLS) {
    const failed = runRows(ALL_ROWS, mutantMk(Cls));
    assert.ok(failed.length < ALL_ROWS.length / 4, Cls.name + ' failed ' + failed.length + ' rows');
  }
});
