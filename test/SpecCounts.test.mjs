// test/SpecCounts.test.mjs -- gates for test/spec-counts.mjs (ADR 0005 C-30, C-41).
//
// Every expectation here is derived from the SPEC (ADR 0001 Table 3 / I-1,
// ADR 0003 G-9 / G-11, ADR 0005 C-18..C-25, C-30) or from an independent
// reference written in this file (a leaf-list simulation, a DP over I-1
// splits, a source scanner). Nothing is copied from spec-counts.mjs output.
// Controls are asserted as POSITIVE expectations: each one must FAIL the
// gate it targets. ASCII-only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as SC from './spec-counts.mjs';

const SPEC_PATH = fileURLToPath(new URL('./spec-counts.mjs', import.meta.url));
const SPEC_URL = pathToFileURL(SPEC_PATH).href;
const PROF_URL = new URL('../node_modules/@zakkster/lite-gc-profiler/Gc.js', import.meta.url).href;

// ---------------------------------------------------------------------------
// 1. Independent leaf-list simulation (ASSERTION 1)
// ---------------------------------------------------------------------------
// State: array of leaf sizes + finger leaf index. Hit = insert into the
// finger's leaf with no split. First insert into empty, and every split, is a
// miss. After a split the finger re-homes to the leaf holding the new element.
// moves (C-18): the new element is not counted; a split keeps the left part
// in place; an element counts when it lands in a new slot (fresh leaf, or
// shifted inside its leaf).
function makeSim(B, mode, leftKeep) {
  const leaves = [];
  const st = { splits: 0, hits: 0, misses: 0, moves: 0, leaves };
  let f = -1;
  st.step = function step() {
    if (leaves.length === 0) { leaves.push(1); f = 0; st.misses++; return; }
    const s = leaves[f];
    if (mode === 'append') {
      if (s < B) { leaves[f] = s + 1; st.hits++; return; }           // p = s: 0 moves
      // full leaf, new element at p = B (end): left keeps old [0..left-1]
      // in place; the right part is old[left..B-1] plus the new element.
      const right = B + 1 - leftKeep;
      st.moves += right - 1;                                          // old ones in the right part
      leaves[f] = leftKeep;
      leaves.splice(f + 1, 0, right);
      f = f + 1;                                                      // new element lives in right
    } else {
      // prepend: new element at p = 0 of the first leaf (finger is always there)
      if (s < B) { st.moves += s; leaves[f] = s + 1; st.hits++; return; } // every element shifts
      // full: left = new + (leftKeep-1) old, all shifted by one; right = the
      // other B+1-leftKeep old, all moved to fresh slots -> B moves in total.
      st.moves += (leftKeep - 1) + (B + 1 - leftKeep);
      leaves[f] = leftKeep;
      leaves.splice(f + 1, 0, B + 1 - leftKeep);
      // new element lives in left: f unchanged (0)
    }
    st.splits++; st.misses++;
  };
  return st;
}

function newOut() { return new Int32Array(8); }

test('ASSERTION 1: fixed spec values (C-30, C-19)', () => {
  const o = newOut();
  const r = SC.appendStream(16, 4, 1e4, o);
  assert.equal(r, o, 'appendStream returns its out array');
  assert.deepEqual([o[0], o[1], o[2], o[3], o[4]], [768, 9231, 769, 2304, 769]);
  SC.prependStream(16, 4, 200, o);
  assert.equal(o[3], 1960);
  assert.equal(o[0], 15);
  assert.equal(o[1], 184);
  assert.equal(o[2], 200 - 184);
});

test('ASSERTION 1: Table 3 closed form S(N) and hits(N)', () => {
  // S(N) = 0 if N <= B else floor((N-B-1)/(B-m+1)) + 1 (0001 Table 3).
  for (const B of [4, 8, 16]) {
    const m = B / 4;
    for (let N = 1; N <= 2000; N++) {
      const exp = N <= B ? 0 : Math.floor((N - B - 1) / (B - m + 1)) + 1;
      assert.equal(SC.S(B, m, N), exp, 'S B=' + B + ' N=' + N);
    }
  }
  assert.equal(SC.S(16, 4, 1e4), 768);
});

for (const mode of ['append', 'prepend']) {
  test('ASSERTION 1: simulation == closed form, ' + mode + ', N 1..2000, B in {4,8,16}', () => {
    let checked = 0;
    const o = newOut();
    const fn = mode === 'append' ? SC.appendStream : SC.prependStream;
    for (const B of [4, 8, 16]) {
      const m = B / 4;
      const sim = makeSim(B, mode, mode === 'append' ? B + 1 - m : m);
      for (let N = 1; N <= 2000; N++) {
        sim.step();
        fn(B, m, N, o);
        const got = [o[0], o[1], o[2], o[3], o[4]];
        const exp = [sim.splits, sim.hits, sim.misses, sim.moves, sim.leaves.length];
        assert.deepEqual(got, exp, mode + ' B=' + B + ' N=' + N);
        checked++;
      }
    }
    assert.equal(checked, 6000, 'coverage floor: 6000/6000');
  });
}

test('ASSERTION 1: simulation reproduces the spec constants (oracle sanity)', () => {
  const a = makeSim(16, 'append', 13);
  for (let i = 0; i < 1e4; i++) a.step();
  assert.deepEqual([a.splits, a.hits, a.misses, a.moves, a.leaves.length], [768, 9231, 769, 2304, 769]);
  const p = makeSim(16, 'prepend', 4);
  for (let i = 0; i < 200; i++) p.step();
  assert.deepEqual([p.moves, p.splits, p.hits], [1960, 15, 184]);
});

test('ASSERTION 1 control: old prepend formula (m-1)*S disagrees with simulation', () => {
  const p = makeSim(16, 'prepend', 4);
  for (let i = 0; i < 200; i++) p.step();
  const old = (4 - 1) * SC.S(16, 4, 200);
  assert.equal(old, 45);
  assert.notEqual(old, p.moves);
  const o = newOut();
  SC.prependStream(16, 4, 200, o);
  assert.notEqual(old, o[3]);
});

test('ASSERTION 1 control: MC-3 8|8 split shape gives a different split count than S(N)', () => {
  // Left keeps B/2, right gets B+1-B/2 (new element joins the right half).
  const sim = makeSim(16, 'append', 8);
  for (let i = 0; i < 1e4; i++) sim.step();
  assert.notEqual(sim.splits, SC.S(16, 4, 1e4));
  assert.notEqual(sim.splits, 768);
  assert.ok(sim.splits > 768);
});

// ---------------------------------------------------------------------------
// 2. ASSERTION 2 (C-23): H(L) == DP over all I-1 splits
// ---------------------------------------------------------------------------
const DPMAX = 2048;
function buildDP(n) {
  const dp = new Int32Array(n + 1);
  for (let L = 2; L <= n; L++) {
    let best = 0;
    for (let l = 1; l < L; l++) {
      const r = L - l;
      if (3 * l >= r && 3 * r >= l) { // I-1
        const h = dp[l] > dp[r] ? dp[l] : dp[r];
        if (h > best) best = h;
      }
    }
    dp[L] = 1 + best;
  }
  return dp;
}
const DP = buildDP(DPMAX);
function hb(w) { return w <= 1 ? 0 : 1 + hb(Math.floor(3 * w / 4)); } // 0003 G-11 recurrence
function floor23(w) { return w <= 1 ? 0 : 1 + floor23(Math.floor(2 * w / 3)); }

test('ASSERTION 2: H(L) == DP max height for L in 1..2048', () => {
  let n = 0;
  for (let L = 1; L <= DPMAX; L++) {
    assert.equal(SC.H(L), DP[L], 'L=' + L);
    n++;
  }
  assert.equal(n, 2048);
  assert.equal(DP[1], 0);
});

test('ASSERTION 2: H(1024) = 21, H(65536) = 36, HB === H, reference recurrence', () => {
  assert.equal(SC.H(1024), 21);
  assert.equal(SC.H(65536), 36);
  assert.equal(SC.H(1), 0);
  assert.equal(hb(65536), 36);
  assert.equal(hb(1024), 21);
  assert.equal(SC.HB, SC.H);
  for (const L of [1, 2, 3, 7, 100, 4096, 100000]) assert.equal(SC.H(L), hb(L));
});

test('ASSERTION 2: bound log_{4/3} L - 1.4 holds for L >= 2 only', () => {
  const bound = (L) => Math.log(L) / Math.log(4 / 3) - 1.4;
  for (let L = 2; L <= DPMAX; L++) assert.ok(SC.H(L) <= bound(L) + 1e-9, 'L=' + L);
});

test('ASSERTION 2 control: floor(2w/3) mutant FAILS the DP at L = 4 (2 vs 3)', () => {
  assert.equal(floor23(4), 2);
  assert.equal(DP[4], 3);
  assert.notEqual(floor23(4), DP[4]);
  assert.equal(SC.H(4), 3);
});

test('ASSERTION 2 control: old bound FAILS at L = 1', () => {
  const old = Math.log(1) / Math.log(4 / 3) - 1.4;
  assert.ok(old < SC.H(1), 'bound ' + old + ' < H(1) = 0');
});

// ---------------------------------------------------------------------------
// 3. C-18 / C-21 rows and helpers
// ---------------------------------------------------------------------------
test('C-18 insertMoves rows (B=16, m=4)', () => {
  const im = (s, p, last) => SC.insertMoves(16, 4, s, p, last);
  assert.equal(im(10, 3, 0), 7);       // s < B: s-p
  assert.equal(im(10, 10, 1), 0);      // in-leaf append at the end: 0 moves
  assert.equal(im(15, 0, 0), 15);
  assert.equal(im(16, 1, 0), 15);      // interior p <= B/2: B-p, max 15
  assert.equal(im(16, 5, 0), 11);
  assert.equal(im(16, 8, 0), 8);       // p = B/2: B-p = 8
  assert.equal(im(16, 9, 0), 8);       // p > B/2: B/2
  assert.equal(im(16, 16, 0), 8);
  assert.equal(im(16, 16, 1), 3);      // append split: m-1
  assert.equal(im(16, 0, 0), 16);      // prepend split: B
  assert.equal(im(16, 5, 1), 11);      // last leaf but p < B: interior row
  assert.equal(SC.insertMoves(8, 2, 8, 8, 1), 1);
  assert.equal(SC.insertMoves(8, 2, 8, 0, 0), 8);
});

test('C-18 removeMoves rows (m=4)', () => {
  assert.equal(SC.removeMoves(4, 10, 3, 0, 99), 6);  // s > m: s-1-p, rep ignored
  assert.equal(SC.removeMoves(4, 5, 0, 0, 99), 4);
  assert.equal(SC.removeMoves(4, 4, 1, 1, 99), 2);   // only leaf: s-1-p, no rep
  assert.equal(SC.removeMoves(4, 3, 0, 1, 7), 2);
  assert.equal(SC.removeMoves(4, 4, 1, 0, 5), 7);    // underflow: (m-1-p) + rep
  assert.equal(SC.removeMoves(4, 4, 3, 0, 0), 0);
});

test('C-18 repMoves rows (B=16): merge and equalize', () => {
  const rm = (sL, sR, u) => SC.repMoves(16, sL, sR, u);
  // merge (t <= B/2)
  assert.equal(rm(3, 5, 1), 8);        // uLeft, sL > 0: t
  assert.equal(rm(0, 5, 1), 0);        // uLeft, sL = 0: 0
  assert.equal(rm(5, 3, 0), 3);        // u right: sR
  assert.equal(rm(5, 3, 1), 8);
  assert.equal(rm(4, 4, 0), 4);        // t = B/2 boundary still merges
  // equalize (t > B/2)
  assert.equal(rm(3, 10, 1), 10);      // uLeft: sR
  assert.equal(rm(3, 10, 0), 7);       // u right: ceil(13/2)
  assert.equal(rm(8, 8, 0), 8);        // t = 16: ceil(16/2)
  assert.equal(rm(4, 5, 0), 5);        // t = 9: ceil
});

test('C-18 cutMoves rows', () => {
  assert.equal(SC.cutMoves(10, 0), 0);
  assert.equal(SC.cutMoves(10, 10), 0);
  assert.equal(SC.cutMoves(10, 4), 6);
  assert.equal(SC.cutMoves(16, 1), 15);
  assert.equal(SC.cutMoves(16, 15), 1);
});

test('C-21 seamSplit 0 / 1 / 2', () => {
  assert.equal(SC.seamSplit(4, 3, 9, 5, 9), 0);
  assert.equal(SC.seamSplit(4, 3, 2, 5, 9), 1);
  assert.equal(SC.seamSplit(4, 3, 9, 5, 3), 1);
  assert.equal(SC.seamSplit(4, 3, 2, 5, 3), 2);
  assert.equal(SC.seamSplit(4, 1, 2, 5, 9), 0);    // single leaf: rX = 0
  assert.equal(SC.seamSplit(4, 1, 1, 1, 1), 0);
  assert.equal(SC.seamSplit(4, 2, 4, 2, 4), 0);    // seam == m is not short
  assert.equal(SC.seamSplit(4, 2, 3, 1, 1), 1);
});

test('C-21 seamAppend: examples and empty operands (m=4, B=16)', () => {
  assert.equal(SC.seamAppend(4, 3, 5), 1);         // 3+5 -> merge to 8
  assert.equal(SC.seamAppend(4, 10, 10), 0);       // two leaves, 0 repairs
  assert.equal(SC.seamAppend(4, 3, 10), 1);        // 6|7 equalize
  assert.equal(SC.seamAppend(4, 4, 4), 0);
  assert.equal(SC.seamAppend(4, 10, 3), 1);
  assert.equal(SC.seamAppend(4, 0, 3), 0);         // empty operand
  assert.equal(SC.seamAppend(4, 3, 0), 0);
  assert.equal(SC.seamAppend(4, 0, 0), 0);
});

test('C-15 / C-30 Lmax and C-20 pullsHot', () => {
  assert.equal(SC.Lmax(100, 4, 3), 28);
  assert.equal(SC.Lmax(100, 4, 3, 2), 30);
  assert.equal(SC.Lmax(101, 4, 0), 26);
  assert.equal(SC.Lmax(0, 4, 0), 0);
  assert.equal(SC.Lmax(16, 4, 1), 5);
  assert.equal(SC.pullsHot(0), 0);
  assert.equal(SC.pullsHot(7), 7);
  assert.equal(SC.pullsHot(21), 21);
});

// ---------------------------------------------------------------------------
// 4. C-25 touches table
// ---------------------------------------------------------------------------
const ROWS = {
  HIT: 0, FIRST_LEAF: 1, TOTAL_CLEAR: 2, MISS: 3, SEEK: 4, NEXT: 5,
  INSERT_SPLIT: 6, REMOVE_UNDERFLOW: 7, APPEND: 8, SPLITAT: 9, SPLITAT_REPAIRS: 10,
};
const P = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3];

test('C-25 row constants', () => {
  assert.equal(SC.TOUCH_HIT, 0);
  assert.equal(SC.TOUCH_FIRST_LEAF, 1);
  assert.equal(SC.TOUCH_TOTAL_CLEAR, 2);
  assert.equal(SC.TOUCH_MISS, 3);
  assert.equal(SC.TOUCH_SEEK, 4);
  assert.equal(SC.TOUCH_NEXT, 5);
  assert.equal(SC.TOUCH_INSERT_SPLIT, 6);
  assert.equal(SC.TOUCH_REMOVE_UNDERFLOW, 7);
  assert.equal(SC.TOUCH_APPEND, 8);
  assert.equal(SC.TOUCH_SPLITAT, 9);
  assert.equal(SC.TOUCH_SPLITAT_REPAIRS, 10);
});

// Hand-written expectations: one case per table row (C-25). [row, a, b, c, expected]
const TOUCH_CASES = [
  [ROWS.HIT, 5, 5, 5, 0],
  [ROWS.FIRST_LEAF, 5, 5, 5, 0],
  [ROWS.TOTAL_CLEAR, 5, 5, 5, 0],
  [ROWS.MISS, 6, 0, 0, 6],                 // d(t)
  [ROWS.SEEK, 9, 0, 0, 9],                 // d(t)
  [ROWS.NEXT, -1, 0, 0, 0],                // inside a leaf: 0
  [ROWS.NEXT, 7, 3, 0, 3],                 // d(t') - depth(lca) - 1
  [ROWS.NEXT, 4, 3, 0, 0],
  [ROWS.INSERT_SPLIT, 5, 6, 0, 11],        // d(t) + d'(t')
  [ROWS.REMOVE_UNDERFLOW, 4, 7, 0, 11],    // d(v) + d'(t')
  [ROWS.APPEND, 4, 5, 0, 9],               // d_a(last) + d_b(first)
  [ROWS.APPEND, -1, 5, 0, 0],              // empty operand
  [ROWS.APPEND, 5, -1, 0, 0],
  [ROWS.SPLITAT, 8, 0, 0, 8],              // 0 repairs: d(c)
  [ROWS.SPLITAT_REPAIRS, 8, 2, 1024, 8 + 2 * 21], // d(c) + (rL+rR)*H(Lmax); H(1024) = 21
  [ROWS.SPLITAT_REPAIRS, 8, 1, 1, 8],      // H(1) = 0
];

function touchesGate(fn) {
  const bad = [];
  for (const [row, a, b, c, exp] of TOUCH_CASES) {
    const got = fn(row, a, b, c);
    if (got !== exp) bad.push('row ' + row + ' (' + a + ',' + b + ',' + c + '): expected ' + exp + ' got ' + got);
  }
  return bad;
}

test('C-25 touchesExact: one case per table row (11 rows) plus edges', () => {
  const covered = new Set(TOUCH_CASES.map((t) => t[0]));
  assert.equal(covered.size, 11, 'every table row has a case');
  assert.deepEqual(touchesGate(SC.touchesExact), []);
});

test('C-25 touchesMax = p * H(L)', () => {
  for (let row = 0; row <= 10; row++) {
    assert.equal(SC.touchesMax(row, 1024), P[row] * 21, 'row ' + row + ' L=1024');
    assert.equal(SC.touchesMax(row, 1), 0, 'row ' + row + ' L=1');
    assert.equal(SC.touchesMax(row, 65536), P[row] * 36, 'row ' + row + ' L=65536');
    assert.equal(SC.touchesMax(row, 100), P[row] * hb(100));
  }
});

test('C-25 exact never exceeds the bound at depth <= H(L)', () => {
  const L = 1024, H = 21;
  assert.ok(SC.touchesExact(ROWS.MISS, H, 0, 0) <= SC.touchesMax(ROWS.MISS, L));
  assert.ok(SC.touchesExact(ROWS.INSERT_SPLIT, H, H, 0) <= SC.touchesMax(ROWS.INSERT_SPLIT, L));
  assert.ok(SC.touchesExact(ROWS.APPEND, H, H, 0) <= SC.touchesMax(ROWS.APPEND, L));
});

test('C-25 control: stub adding 2 touches per level FAILS touchesExact', () => {
  const stub = (row, a, b, c) => {
    // a stub engine counter: 2 per level on every row that descends
    switch (row) {
      case ROWS.MISS: case ROWS.SEEK: case ROWS.SPLITAT: return 2 * a;
      case ROWS.NEXT: return a < 0 ? 0 : 2 * (a - b - 1);
      case ROWS.INSERT_SPLIT: case ROWS.REMOVE_UNDERFLOW: return 2 * (a + b);
      case ROWS.APPEND: return (a < 0 || b < 0) ? 0 : 2 * (a + b);
      case ROWS.SPLITAT_REPAIRS: return 2 * a + b * SC.H(c);
      default: return 0;
    }
  };
  const bad = touchesGate(stub);
  assert.ok(bad.length > 0);
  assert.ok(bad.some((s) => s.startsWith('row 3 ')), 'fails on the MISS row (d = 6 > 0)');
  assert.ok(bad.some((s) => s.startsWith('row 5 ')), 'fails on the NEXT crossing row');
});

// ---------------------------------------------------------------------------
// 5. G-9 import-graph gate (0003 G-9 / MC-1)
// ---------------------------------------------------------------------------
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\'"`])\/\/[^\n]*/g, '$1');
}
// Returns the list of violations: any import statement, dynamic import(,
// require(, re-export-from, or the engine counter token _n.
function g9Gate(src) {
  const code = stripComments(src);
  const bad = [];
  if (/(^|[\s;{}])import\s*(['"{*]|[A-Za-z_$][\w$]*\s*(,|from\b))/.test(code)) bad.push('import statement');
  if (/\bimport\s*\(/.test(code)) bad.push('dynamic import(');
  if (/\brequire\s*\(/.test(code)) bad.push('require(');
  if (/\bexport\s*(\*(\s*as\s+[\w$]+)?|\{[^}]*\})\s*from\b/.test(code)) bad.push('export-from');
  if (/\bfrom\s*['"]/.test(code)) bad.push('from-clause');
  if (/(^|[^\w$])_n(?![\w$])/.test(code)) bad.push('_n token');
  return bad;
}

test('G-9 gate passes on the real spec-counts.mjs source', () => {
  const src = readFileSync(SPEC_PATH, 'utf8');
  assert.deepEqual(g9Gate(src), []);
});

test('G-9 control: injected import line FAILS the gate (MC-1)', () => {
  const src = readFileSync(SPEC_PATH, 'utf8');
  const bad = g9Gate(src + "\nimport x from '../Yggdrasil.js';\n");
  assert.ok(bad.includes('import statement'));
  assert.ok(g9Gate("import { SumSequence } from '../Yggdrasil.js';\n").length > 0);
  assert.ok(g9Gate("import '../Yggdrasil.js';\n").length > 0);
  assert.ok(g9Gate("import * as Y from '../Yggdrasil.js';\n").length > 0);
});

test('G-9 controls: dynamic import, require, re-export, _n token each FAIL', () => {
  const src = readFileSync(SPEC_PATH, 'utf8');
  assert.ok(g9Gate(src + "\nconst y = await import('../Yggdrasil.js');\n").includes('dynamic import('));
  assert.ok(g9Gate(src + "\nconst y = require('../Yggdrasil.js');\n").includes('require('));
  assert.ok(g9Gate(src + "\nexport { SumSequence } from '../Yggdrasil.js';\n").includes('export-from'));
  assert.ok(g9Gate(src + '\nconst v = seq._n[0];\n').includes('_n token'));
  assert.ok(g9Gate(src + "\nexport * as Y from '../Yggdrasil.js';\n").includes('export-from'));
  assert.ok(g9Gate(src + "\nexport * from '../Yggdrasil.js';\n").length > 0);
});

test('G-9 gate is not fooled by comments or longer identifiers', () => {
  assert.deepEqual(g9Gate('// import x from "y"; require(z); _n\n/* import("a") */\nconst important = 1, my_n = 2, _name = 3;\n'), []);
});

// ---------------------------------------------------------------------------
// 6. ASSERTION 5 (C-30): 0 B/op over 1e5 calls, maxMajor 0
// ---------------------------------------------------------------------------
// lite-gc-profiler needs --expose-gc; plain `npm test` has no such flag, so
// the measurement runs in a CHILD `node --expose-gc`. childMain is serialised
// with toString() and runs there only.
async function childMain(specUrl, profUrl) {
  const S = await import(specUrl);
  const Pf = await import(profUrl);
  const N = 100000;
  const out = new Int32Array(8);
  const sink = new Float64Array(2);
  const calls = {
    H: (i) => { sink[0] += S.H((i & 4095) + 1); },
    HB: (i) => { sink[0] += S.HB((i & 4095) + 1); },
    Lmax: (i) => { sink[0] += S.Lmax(i & 1023, 4, i & 7, i & 3); },
    S: (i) => { sink[0] += S.S(16, 4, (i & 2047) + 1); },
    appendStream: (i) => { S.appendStream(16, 4, (i & 255) + 1, out); sink[0] += out[0]; },
    prependStream: (i) => { S.prependStream(16, 4, (i & 255) + 1, out); sink[0] += out[3]; },
    insertMoves: (i) => { const s = (i & 15) + 1; sink[0] += S.insertMoves(16, 4, s, i & 1 ? 0 : s, (i >> 1) & 1); },
    removeMoves: (i) => { sink[0] += S.removeMoves(4, 4 + (i & 7), i & 3, (i >> 3) & 1, i & 7); },
    repMoves: (i) => { sink[0] += S.repMoves(16, i & 7, 3 + (i & 7), i & 1); },
    cutMoves: (i) => { sink[0] += S.cutMoves(16, i & 15); },
    seamSplit: (i) => { sink[0] += S.seamSplit(4, 1 + (i & 3), i & 7, 1 + ((i >> 2) & 3), (i >> 1) & 7); },
    seamAppend: (i) => { sink[0] += S.seamAppend(4, i & 15, (i >> 2) & 15); },
    pullsHot: (i) => { sink[0] += S.pullsHot(i & 63); },
    touchesMax: (i) => { sink[0] += S.touchesMax(i % 11, 1 + (i & 1023)); },
    touchesExact: (i) => { sink[0] += S.touchesExact(i % 11, 8 + (i & 31), i % 3, 1 + (i & 1023)); },
  };
  // Object-returning mutant of appendStream, same harness. Results go into a
  // retained ring so escape analysis cannot remove the allocation.
  const ring = new Array(256);
  const mutant = (i) => {
    ring[i & 255] = { splits: i, hits: i + 1, misses: i + 2, moves: i + 3, leaves: i + 4 };
  };
  function bpo(fn) {
    for (let i = 0; i < 30000; i++) fn(i); // warm, tier up
    globalThis.gc();
    const before = process.memoryUsage().heapUsed;
    for (let i = 0; i < N; i++) fn(i);
    const after = process.memoryUsage().heapUsed;
    const w1 = (after - before) / N;
    globalThis.gc();
    const before2 = process.memoryUsage().heapUsed;
    for (let i = 0; i < N; i++) fn(i);
    const w2 = (process.memoryUsage().heapUsed - before2) / N;
    return w1 < w2 ? w1 : w2; // minimum of two windows
  }
  const res = { bpo: {}, mutant: 0, major: -1, ok: false, violations: [] };
  for (const k of Object.keys(calls)) res.bpo[k] = bpo(calls[k]);
  res.mutant = bpo(mutant);
  // profiler pass over every export, 1e5 calls each
  const gcp = new Pf.GcProfiler().start();
  for (const k of Object.keys(calls)) { const f = calls[k]; for (let i = 0; i < N; i++) f(i); }
  await new Promise((r) => setTimeout(r, 80));
  const sum = gcp.summary();
  const rep = Pf.checkNoGc(sum, { maxMajor: 0 });
  gcp.stop();
  res.major = sum.gc.major;
  res.ok = rep.ok;
  res.violations = rep.violations || [];
  res.minor = sum.gc.minor;
  // must-fail control for the profiler lane: one forced gc() in a fresh window
  const gc2 = new Pf.GcProfiler().start();
  globalThis.gc();
  await new Promise((r) => setTimeout(r, 80));
  const sum2 = gc2.summary();
  const rep2 = Pf.checkNoGc(sum2, { maxMajor: 0 });
  gc2.stop();
  res.ctlOk = rep2.ok;
  res.ctlMajor = sum2.gc.major;
  res.exports = Object.keys(S).filter((k) => typeof S[k] === 'function');
  res.sink = sink[0];
  return res;
}

let gcResult = null;
function runGcChild() {
  if (gcResult) return gcResult;
  const code = '(' + childMain.toString() + ')(' + JSON.stringify(SPEC_URL) + ',' + JSON.stringify(PROF_URL) +
    ').then((r) => { process.stdout.write("RESULT " + JSON.stringify(r) + "\\n"); },' +
    ' (e) => { process.stderr.write(String(e && e.stack || e)); process.exit(1); });';
  const r = spawnSync(process.execPath, [
    '--expose-gc', '--min-semi-space-size=64', '--max-semi-space-size=64', // no scavenge inside a 1e5 window: heapUsed deltas are exact
    '--input-type=module', '-e', code,
  ], {
    encoding: 'utf8', timeout: 120000,
  });
  assert.equal(r.status, 0, 'child failed: ' + r.stderr);
  const line = r.stdout.split('\n').find((l) => l.startsWith('RESULT '));
  assert.ok(line, 'child printed no RESULT line: ' + r.stdout);
  gcResult = JSON.parse(line.slice(7));
  return gcResult;
}

test('ASSERTION 5: every export is 0 B/op over 1e5 calls, maxMajor 0 (child --expose-gc)', () => {
  const r = runGcChild();
  const names = Object.keys(r.bpo);
  assert.deepEqual(names.slice().sort(), Object.keys(SC).filter((k) => typeof SC[k] === 'function').sort(),
    'GC lane covers every function export');
  assert.deepEqual(r.exports.slice().sort(), names.slice().sort(), 'child saw the same export set');
  for (const k of names) assert.ok(r.bpo[k] < 0.5, k + ' allocated ' + r.bpo[k] + ' B/op');
  assert.equal(r.major, 0, 'maxMajor 0');
  assert.equal(r.minor, 0, 'no scavenge in the asserted profiler window');
  assert.deepEqual(r.violations, []);
  assert.equal(r.ok, true, 'checkNoGc not ok (inert or violation)');
});

test('ASSERTION 5 control: a window containing one forced gc() FAILS checkNoGc', () => {
  const r = runGcChild();
  assert.equal(r.ctlOk, false);
  assert.ok(r.ctlMajor >= 1, 'major seen: ' + r.ctlMajor);
});

test('ASSERTION 5 control: object-returning mutant shows > 0 B/op under the same measurement', () => {
  const r = runGcChild();
  // 5 Smi fields + header is >= 40 B per object; a 0.5 B/op line sits far below.
  assert.ok(r.mutant > 16, 'mutant measured ' + r.mutant + ' B/op');
  for (const k of Object.keys(r.bpo)) assert.ok(r.mutant > r.bpo[k] + 16, 'mutant beats ' + k);
});

// ---------------------------------------------------------------------------
// 7. RangeError rows
// ---------------------------------------------------------------------------
test('RangeError on bad arguments (non-integer, negative, unknown touch row)', () => {
  const o = newOut();
  const bad = {
    'H(-1)': () => SC.H(-1),
    'H(1.5)': () => SC.H(1.5),
    'H(NaN)': () => SC.H(NaN),
    'touchesMax unknown row 99': () => SC.touchesMax(99, 10),
    'touchesMax row -1': () => SC.touchesMax(-1, 10),
    'touchesMax row 1.5': () => SC.touchesMax(1.5, 10),
    'touchesMax negative L': () => SC.touchesMax(3, -3),
    'touchesMax non-integer L': () => SC.touchesMax(3, 2.5),
    'touchesExact unknown row': () => SC.touchesExact(99, 0, 0, 0),
    'touchesExact row 11': () => SC.touchesExact(11, 0, 0, 0),
    'touchesExact row 1.5': () => SC.touchesExact(1.5, 0, 0, 0),
    'appendStream N -1': () => SC.appendStream(16, 4, -1, o),
    'appendStream N 2.5': () => SC.appendStream(16, 4, 2.5, o),
    'prependStream N -1': () => SC.prependStream(16, 4, -1, o),
    'prependStream N 2.5': () => SC.prependStream(16, 4, 2.5, o),
    'S N 2.5': () => SC.S(16, 4, 2.5),
    'Lmax C 10.5': () => SC.Lmax(10.5, 4, 0),
    'Lmax C -1': () => SC.Lmax(-1, 4, 0),
    'pullsHot -1': () => SC.pullsHot(-1),
    'pullsHot 1.5': () => SC.pullsHot(1.5),
    'touchesExact NEXT -2': () => SC.touchesExact(SC.TOUCH_NEXT, -2, 0, 0),
    'touchesExact NEXT -99 NaN': () => SC.touchesExact(SC.TOUCH_NEXT, -99, NaN, 0),
    'removeMoves s < m, not only': () => SC.removeMoves(4, 3, 0, 0, 0),
    'insertMoves non-integer s': () => SC.insertMoves(16, 4, 1.5, 0, 0),
    'insertMoves negative p': () => SC.insertMoves(16, 4, 10, -1, 0),
    'removeMoves non-integer p': () => SC.removeMoves(4, 6, 0.5, 0, 0),
    'removeMoves p >= s': () => SC.removeMoves(4, 6, 6, 0, 0),
    'repMoves non-integer sL': () => SC.repMoves(16, 2.5, 5, 1),
    'repMoves negative sR': () => SC.repMoves(16, 3, -5, 1),
    'cutMoves p > s': () => SC.cutMoves(10, 11),
    'cutMoves negative s': () => SC.cutMoves(-1, 0),
    'seamSplit non-integer leaves': () => SC.seamSplit(4, 1.5, 2, 3, 4),
    'seamSplit negative seam': () => SC.seamSplit(4, 3, -2, 3, 4),
    'seamAppend non-integer a': () => SC.seamAppend(4, 2.5, 3),
    'seamAppend negative b': () => SC.seamAppend(4, 3, -1),
  };
  for (const [name, fn] of Object.entries(bad)) assert.throws(fn, RangeError, name);
  assert.equal(Object.keys(bad).length, 35);
});

test('meta: every gate keeps its must-fail control (deleting one is a failure)', () => {
  const me = readFileSync(fileURLToPath(import.meta.url), 'utf8');
  for (const tag of [
    'ASSERTION 1 control: old prepend formula',
    'ASSERTION 1 control: MC-3',
    'ASSERTION 2 control: floor(2w/3)',
    'ASSERTION 2 control: old bound',
    'C-25 control: stub',
    'G-9 control: injected import',
    'ASSERTION 5 control: object-returning mutant',
    'ASSERTION 5 control: a window containing one forced gc()',
  ]) assert.ok(me.includes("test(" + "'" + tag), tag);
});
