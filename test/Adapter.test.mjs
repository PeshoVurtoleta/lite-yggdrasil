// test/Adapter.test.mjs -- engine adapter + buildMutant (ADR 0005 C-44, C-27,
// C-28, C-42, C-46, C-15, C-23; PLAN-E0-G TASKS 1-3 + ASSERTION 1).
// Expected values come from the spec formulas below, not from engine output.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { engineFactory } from './adapter.mjs';
import { buildMutant } from './mutant-build.mjs';
import { walk } from './walker.mjs';

// C-15: Lmax = ceil(C/m) + k.  C-23: H(1) = 0, H(w) = 1 + H(floor(3w/4)).
const lmax = (C, m, k) => Math.ceil(C / m) + k;
function hOf(L) { let h = 0; for (let w = L; w > 1; w = Math.floor(3 * w / 4)) h++; return h; }

test('in-test H matches the C-23 fixed points', () => {
  assert.equal(hOf(1), 0);
  assert.equal(hOf(1024), 21);
  assert.equal(hOf(65536), 36);
});

const BS = [4, 8, 16, 32];
const C = 64;

test('shape: 32 fresh arenas walk clean, stack H(Lmax), NIL / EMPTY_ROOT, own fields', () => {
  let n = 0;
  for (const B of BS) for (let dims = 1; dims <= 4; dims++) for (const k of [1, 3]) {
    const tag = 'B' + B + ' dims' + dims + ' k' + k;
    const { views, snapshot } = engineFactory(C, { leafSize: B, dims }, k);
    assert.equal(views.length, k, tag);
    const s = snapshot();
    assert.equal(walk(s, { B, dims }), null, tag);
    const L = lmax(C, B / 4, k);
    assert.equal(s.leaf.size, L, tag);
    assert.equal(s.int.size, L - 1, tag);
    for (let v = 0; v < k; v++) {
      assert.equal(s.views[v]._fpath.length, hOf(L), tag + ' _fpath');
      for (const f of ['_fl', '_fb', '_fdepth', '_fpath']) {
        assert.ok(Object.hasOwn(views[v], f), tag + ' own ' + f);
      }
    }
    assert.notEqual(s.EMPTY_ROOT, 0, tag);
    assert.equal(s.EMPTY_ROOT, 0x3FFFFFFF, tag); // C-42 / RA-2
    assert.equal(s.NIL, views[0]._fl, tag);
    assert.equal(s.NIL, 0, tag); // C-42: NIL = 0
    n++;
  }
  assert.equal(n, 32);
});

function mutateAll(s) {
  const bump = (a) => { for (let i = 0; i < a.length; i++) a[i] = a[i] + 1; };
  for (const p of [s.int, s.leaf]) {
    for (const k of Object.keys(p)) {
      if (ArrayBuffer.isView(p[k])) bump(p[k]);
      else if (Array.isArray(p[k])) for (const a of p[k]) bump(a);
    }
  }
  for (const v of s.views) bump(v._fpath);
}

test('non-aliasing: mutating a snapshot does not change the next one', () => {
  const { snapshot } = engineFactory(C, { leafSize: 8, dims: 2 }, 2);
  const a = snapshot();
  const before = JSON.stringify(snapshot(), (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v));
  mutateAll(a);
  a.live += 5;
  const after = JSON.stringify(snapshot(), (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v));
  assert.equal(after, before);
  // every snapshot array is its own buffer
  const b = snapshot();
  const c2 = snapshot();
  assert.notEqual(b.int.left.buffer, c2.int.left.buffer);
  assert.notEqual(b.leaf.ent.buffer, c2.leaf.ent.buffer);
  assert.notEqual(b.views[0]._fpath.buffer, c2.views[0]._fpath.buffer);
});

// Must-fail controls: no ops exist in this rung, so corrupt the arena directly.
test('control: hdr live := 1 with no leaf is an I-7 hdr failure; restore is clean', () => {
  const { views, snapshot } = engineFactory(C, { leafSize: 8, dims: 1 }, 1);
  const hdr = views[0]._hdr;
  assert.ok(hdr instanceof Int32Array && hdr.length === 5, 'hdr is Int32Array(5) (C-44)');
  assert.deepEqual(Array.from(hdr), [0, 0, -1, 0, -1]); // C-44 fresh arena
  assert.equal(walk(snapshot(), { B: 8, dims: 1 }), null);
  hdr[0] = 1;
  const r = walk(snapshot(), { B: 8, dims: 1 });
  assert.ok(r !== null, 'corruption must be caught');
  assert.equal(r.code, 'I-7');
  assert.ok(r.detail.startsWith('hdr'), r.detail);
  hdr[0] = 0;
  assert.equal(walk(snapshot(), { B: 8, dims: 1 }), null);
});

test('control: a view _root := 1 on an empty arena fails; restore is clean', () => {
  const { views, snapshot } = engineFactory(C, { leafSize: 8, dims: 1 }, 1);
  const was = views[0]._root;
  views[0]._root = 1;
  const r = walk(snapshot(), { B: 8, dims: 1 });
  assert.ok(r !== null, 'corruption must be caught');
  assert.equal(r.code, 'I-7'); // a root ref >= its pool bump (0): 'range'
  assert.ok(r.detail.startsWith('range'), r.detail);
  views[0]._root = was;
  assert.equal(walk(snapshot(), { B: 8, dims: 1 }), null);
});

test('arena sharing: views of one arena share _hdr / columns by identity; another arena does not', () => {
  const a = engineFactory(C, { leafSize: 8, dims: 2 }, 3).views;
  const b = engineFactory(C, { leafSize: 8, dims: 2 }, 3).views;
  for (const f of ['_hdr', '_left', '_right', '_weight', '_count', '_inext', '_sums', '_llen', '_lnext', '_ent', '_meas', '_ar']) {
    for (let i = 1; i < a.length; i++) assert.strictEqual(a[i][f], a[0][f], f);
    assert.notStrictEqual(b[0][f], a[0][f], f);
  }
});

test.todo('control: 5 appends, then weight[root] += 1 fails I-1 weight (needs insertAt: rung 2 A-R1b)');

test('cfg row: any cfg key is a RangeError naming cfg', () => {
  assert.throws(() => engineFactory(64, {}, 1, { x: 1 }), (e) => e instanceof RangeError && /cfg/.test(e.message));
  assert.throws(() => engineFactory(64, {}, 1, []), (e) => e instanceof RangeError && /cfg/.test(e.message));
  assert.throws(() => engineFactory(64, {}, 1, null), (e) => e instanceof RangeError && /cfg/.test(e.message));
  const f = engineFactory(64, {}, 1, {});
  assert.equal(walk(f.snapshot(), { B: 16, dims: 1 }), null);
  const g = engineFactory(64, {}, 1);
  assert.equal(walk(g.snapshot(), { B: 16, dims: 1 }), null);
});

// ---- buildMutant self-tests on a temp fixture (not Yggdrasil.js) ----
function fixture(text) {
  const dir = mkdtempSync(join(tmpdir(), 'ygg-fixture-'));
  const file = join(dir, 'Fix.mjs');
  writeFileSync(file, text);
  return { dir, file };
}

test('buildMutant: anchor count 0 throws naming the anchor and found count', async () => {
  const f = fixture('export const a = 1;\n');
  try {
    await assert.rejects(() => buildMutant(f.file, [['nope', 'x', 1]]),
      (e) => /nope/.test(e.message) && /found 0/.test(e.message));
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('buildMutant: count 2 where 1 expected throws', async () => {
  const f = fixture('export const a = 1;\nexport const b = 1;\n');
  try {
    await assert.rejects(() => buildMutant(f.file, [['= 1;', '= 2;', 1]]),
      (e) => /= 1;/.test(e.message) && /found 2/.test(e.message));
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});

test('buildMutant: exact match imports the patch; source untouched; cleanup removes dir', async () => {
  const f = fixture('export const a = 1;\nexport const b = 1;\n');
  try {
    const m = await buildMutant(f.file, [['= 1;', '= 7;', 2], ['export const b', 'export const c', 1]]);
    assert.equal(m.a, 7);
    assert.equal(m.c, 7);
    assert.equal(m.b, undefined);
    assert.ok(existsSync(m.dir));
    m.cleanup();
    assert.ok(!existsSync(m.dir));
    const orig = await import(new URL('file://' + f.file).href);
    assert.equal(orig.a, 1);
  } finally { rmSync(f.dir, { recursive: true, force: true }); }
});
