// test/Counters.test.mjs -- C-24 COUNTERS / readCounters / resetCounters, C-8 clear(), and the getter surface.
// Expectations from 0003 (counters table), 0004 (A-6 clear, signatures) and 0005 (C-8, C-24, C-44); the engine
// state is forced directly (no ops exist in rung A-R1a). A fresh arena per test. ASCII only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SumSequence } from '../Yggdrasil.js';
import { COUNTERS } from './stubs.mjs';

const EMPTY_ROOT = 0x3FFFFFFF;

test('COUNTERS equals the 0003 table (stub copy) and is frozen', () => {
  assert.deepEqual({ ...SumSequence.COUNTERS }, { ...COUNTERS });
  assert.ok(Object.isFrozen(SumSequence.COUNTERS));
  assert.equal(Object.keys(SumSequence.COUNTERS).length, 12);
});

test('readCounters copies exactly 12 slots and leaves the rest of out alone', () => {
  const v = new SumSequence(8);
  for (let i = 0; i < 12; i++) v._n[i] = 101 + i;
  const out = new Int32Array(13).fill(-7);
  v.readCounters(out);
  for (let i = 0; i < 12; i++) assert.equal(out[i], 101 + i, 'slot ' + i);
  assert.equal(out[12], -7);
});

test('readCounters rejects a short / wrong-type out with RangeError', () => {
  const v = new SumSequence(8);
  for (const bad of [new Int32Array(11), new Uint32Array(12), new Array(12).fill(0), undefined]) {
    assert.throws(() => v.readCounters(bad), RangeError);
  }
  // A short out must be refused by an explicit length check (message names the required 12), not by the
  // native TypedArray.set bounds error that an 11-slot out would also hit.
  for (const n of [0, 5, 11]) {
    assert.throws(() => v.readCounters(new Int32Array(n)),
      (e) => e instanceof RangeError && e.message.includes('12'), 'length ' + n);
  }
  assert.doesNotThrow(() => v.readCounters(new Int32Array(12)));
});

test('resetCounters zeroes all 12 slots; clear() keeps the counters (C-8)', () => {
  const v = new SumSequence(8);
  for (let i = 0; i < 12; i++) v._n[i] = 5 + i;
  v.clear();
  for (let i = 0; i < 12; i++) assert.equal(v._n[i], 5 + i, 'clear kept slot ' + i);
  v.resetCounters();
  for (let i = 0; i < 12; i++) assert.equal(v._n[i], 0, 'reset slot ' + i);
});

test('clear() on k=1 returns this and resets hdr / root / finger state (C-8, 0004 A-6)', () => {
  const v = new SumSequence(8);
  v._hdr.set([0, 3, -1, 2, -1]);
  v._root = 17; v._fl = 9; v._fb = 4; v._fdepth = 3; v._cv = true;
  assert.equal(v.clear(), v);
  assert.deepEqual(Array.from(v._hdr), [0, 0, -1, 0, -1]);
  assert.equal(v._root, EMPTY_ROOT);
  assert.equal(v._fl, 0);
  assert.equal(v._fb, 0);
  assert.equal(v._fdepth, 0);
  assert.equal(v._cv, false);
  assert.equal(v._len, 0);
});

test('S-R1 placeholder: clear() of a non-empty view beside another holder throws and writes nothing', () => {
  const vs = SumSequence.arena(8, undefined, 3);
  vs[0]._hdr[0] = 2;
  vs[0]._len = 1;
  const snap = () => vs.map((v) => JSON.stringify([v._root, v._len, v._fl, v._fb, v._fdepth, v._cv,
    Array.from(v._n), Array.from(v._fpath)])).join('|') + Array.from(vs[0]._hdr).join(',');
  const before = snap();
  assert.throws(() => vs[0].clear());
  assert.equal(snap(), before);
});

test('getters: available === C - live (whole arena); length === _len', () => {
  const vs = SumSequence.arena(20, undefined, 3);
  vs[0]._hdr[0] = 5;
  vs[1]._len = 4;
  for (const v of vs) {
    assert.equal(v.available, 15);
    assert.equal(v.capacity, 20);
    assert.equal(v.length, v._len);
  }
  assert.equal(vs[1].length, 4);
});

test('total(d): 0 on an empty view for every d < dims, -0 ok; RangeError otherwise', () => {
  for (const dims of [1, 2, 3, 4]) {
    const v = new SumSequence(8, { dims });
    for (let d = 0; d < dims; d++) assert.equal(v.total(d), 0);
    assert.equal(v.total(-0), 0);
    for (const bad of [dims, -1, 1.5, NaN, '0', 2 ** 32, undefined]) {
      assert.throws(() => v.total(bad), RangeError, 'dims ' + dims + ' d ' + String(bad));
    }
  }
});
