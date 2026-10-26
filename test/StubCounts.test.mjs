// test/StubCounts.test.mjs -- independent per-op count lane for test/stubs.mjs
// (ADR 0005 C-2, C-3, C-4, C-5, C-21, C-26, C-27, C-28, C-30, C-33; ADDENDUM 4
// A4-10 a), plus 9 must-FAIL count-mutant controls.
//
// Ported from the reviewer's independent lane (hb4-rv indep.mjs / indep2.mjs).
// Every per-op expectation is computed from the PRE-op snapshot with spec-counts
// formulas and a plain leaf list; no number is copied from a stub run. Cross-
// checked against the Oracle (values) and the walker (structure).
//
// Controls: each mutant is a ONE-LINE patch of stubs.mjs source, applied inside
// the test as an exact replacement that must match exactly once, written to a
// fresh mkdtemp dir (never into test/), imported, and run through the same lane
// with early exit. Each must fail with its EXPECTED check class; the unpatched
// source through the same build path must pass. ASCII-only.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as RealStubs from './stubs.mjs';
import { walk } from './walker.mjs';
import { Oracle } from './oracle.mjs';
import * as SC from './spec-counts.mjs';

const HERE = (p) => fileURLToPath(new URL(p, import.meta.url));

// 32-bit xorshift; independent streams are derived from seed, B (op stream).
function rng(seed) {
  let x = seed >>> 0 || 1;
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x; };
}

// In-order leaves of view v in snapshot s: {id, len, fb (first index), side}.
// side = 0 when the leaf is a left child, 1 right, -1 for a root leaf.
function leavesOf(s, v) {
  const vw = s.views[v];
  const out = [];
  if (vw._len === 0) return out;
  const st = [[vw._root, -1]];
  while (st.length) {
    const [r, sd] = st.pop();
    if (r < 0) out.push({ id: ~r, len: s.leaf.len[~r], side: sd });
    else { st.push([s.int.right[r], 1]); st.push([s.int.left[r], 0]); }
  }
  let fb = 0;
  for (const l of out) { l.fb = fb; fb += l.len; }
  return out;
}

const json = (x) => JSON.stringify(x, (k, v) => (ArrayBuffer.isView(v) ? Array.from(v) : v));

// Run the lane on a stub factory. opts: {ops, seeds, early}. Returns
// {checks, fails: [{cls, msg, o}], seen, seenB}. early: stop at the first fail.
function runLane(S, opts) {
  const K = S.COUNTERS;
  const ctr = Object.keys(K);
  const res = { checks: 0, fails: [], seen: {}, seenB: {} };
  let stop = false;
  const chk = (c, cls, msg, o) => {
    res.checks++;
    if (!c) {
      if (opts.early) { if (!stop) res.fails.push({ cls, msg, o }); stop = true; }
      else if (res.fails.length < 8) res.fails.push({ cls, msg, o });
    }
  };
  // cell order: an optional hint cell first (controls), then the full grid.
  const cells = [];
  if (opts.hint) cells.push(opts.hint);
  for (const B of [4, 8, 16]) for (const count of [2, 3]) for (const seed of opts.seeds) cells.push([B, count, seed]);
  for (const [B, count, seed] of cells) {
    if (stop) return res;
    runOne(S, K, ctr, B, count, seed, opts.ops(B), chk, res, () => stop);
  }
  return res;
}

function runOne(S, K, ctr, B, count, seed, ops, chk, res, stopped) {
  const m = B / 4;
  const C = B === 16 ? 120 : 40;
  const f = S.synthStub(C, { leafSize: B, dims: 2 }, count, {});
  const views = f.views;
  const or = [];
  for (let k = 0; k < count; k++) or.push(new Oracle(2));
  const NIL = views[0]._fl;
  const r = rng(seed * 7919 + B);
  const seenB = (k) => { const key = B + ':' + k; res.seenB[key] = (res.seenB[key] || 0) + 1; };
  const seenK = (k) => { res.seen[k] = (res.seen[k] || 0) + 1; };

  for (let o = 0; o < ops && !stopped(); o++) {
    const tag = (op, what) => `${op} B=${B} count=${count} seed=${seed} op#${o} ${what}`;
    const pre = f.snapshot();
    const preJ = json(pre);
    // prologue: B+1 inserts at index 0 of view 0 overfill its first leaf (a split insert
    // at every B, deterministically); the draws are still consumed.
    const fill = o <= B;
    const vi = fill ? (r(), 0) : r() % count;
    const v = views[vi];
    const n = v._len;
    const live = pre.live;
    const grow = Math.floor(o / 300) % 2 === 0;
    const c = r() % 100;
    let op;
    if (c < (grow ? 45 : 15)) op = 'insertAt';
    else if (c < 62) op = 'removeAt';
    else if (c < 68) op = 'setMeasure';
    else if (c < 74) op = 'getMeasure';
    else if (c < 80) op = 'entityAt';
    else if (c < 84) op = 'indexAtSum';
    else if (c < 88) op = 'sumBefore';
    else if (c < 95) op = 'splitAt';
    else if (c < 99) op = 'append';
    else op = 'clear';
    if (fill) op = 'insertAt';
    if (op === 'insertAt' && live >= C) op = 'removeAt';
    if (n === 0 && op !== 'insertAt' && op !== 'append' && op !== 'clear' && op !== 'indexAtSum') {
      op = live < C ? 'insertAt' : 'clear';
    }
    // finger-off mix: one op in four runs with the finger dropped first (C-4).
    const off = (r() % 4) === 0;
    if (off && (op === 'insertAt' || op === 'removeAt' || op === 'setMeasure' ||
        op === 'getMeasure' || op === 'entityAt')) {
      v._fl = NIL; v._fb = 0; v._fdepth = 0;
    }
    const L = leavesOf(pre, vi);
    const fl = v._fl;
    const fb0 = v._fb;
    const n0 = v._n.slice();
    const exp = { hits: 0, misses: 0, splits: 0, merges: 0, equalizes: 0, seamRepairs: 0, moves: 0 };
    // finger leaf position in the pre-op leaf list (-1 = no finger)
    const fj = fl === NIL ? -1 : L.findIndex((l) => ~l.id === fl);
    const findR = (i) => { for (let j = 0; j < L.length; j++) if (i <= L[j].fb + L[j].len) return j; return -1; };
    const findE = (i) => { for (let j = 0; j < L.length; j++) if (L[j].fb <= i && i < L[j].fb + L[j].len) return j; return -1; };
    // one seam repair of (sL, sR): merge when 2*(sL+sR) <= B else equalize (C-21).
    const rep = (sL, sR, uLeft) => {
      if (2 * (sL + sR) <= B) exp.merges++; else exp.equalizes++;
      return SC.repMoves(B, sL, sR, uLeft);
    };
    let expLeaf; // leaf id | 'post:<index>' | 'nil' | 'same'
    let oi = -1;

    if (op === 'insertAt') {
      const i0 = r() % (n + 1);
      const i = fill ? 0 : i0;
      if (n === 0) { exp.misses = 1; expLeaf = 'post:' + i; } // first entity: a miss (C-26)
      else {
        const j = findR(i);
        const s = L[j].len;
        const p = i - L[j].fb;
        const lo = fb0 - ((fb0 - 1) >>> 31); // finger window is (lo, fb + len] (C-4)
        const inR = fj >= 0 && lo < i && i <= fb0 + L[fj].len;
        if (s === B) { exp.splits = 1; exp.misses = 1; expLeaf = 'post:' + i; } // full leaf: split, miss
        else { if (inR) exp.hits = 1; else exp.misses = 1; expLeaf = L[j].id; }
        if (inR && s < B) chk(fj === j, 'hit-leaf', tag(op, 'finger hit leaf != routing leaf'), o);
        exp.moves = SC.insertMoves(B, m, s, p, j === L.length - 1 ? 1 : 0);
      }
      const e0 = r() % 1000, a0 = r() % 7, a1 = r() % 5;
      v.insertAt(i, e0, a0, a1); or[vi].insertAt(i, e0, a0, a1);
    } else if (op === 'removeAt') {
      const i = r() % n;
      const j = findE(i);
      const s = L[j].len;
      const p = i - L[j].fb;
      const only = L.length === 1 ? 1 : 0;
      const inR = fj >= 0 && fb0 <= i && i < fb0 + L[fj].len;
      let rp = 0;
      let struct = false;
      if (only && s === 1) { struct = true; expLeaf = 'nil'; seenB('removeLast'); } // last entity: NIL (C-5)
      else if (!only && s === m) { // structural underflow: repair with the sibling-side leaf (T-6)
        struct = true;
        const uL = L[j].side === 0;
        const vv = L[uL ? j + 1 : j - 1].len;
        rp = uL ? rep(s - 1, vv, 1) : rep(vv, s - 1, 0);
        // C-3 / A4-10 a: re-home descends by `i < count[left]` goes left
        expLeaf = 'post:' + Math.min(i, n - 2);
        seenB('structRemove');
      } else expLeaf = L[j].id;
      if (inR && !struct) exp.hits = 1; else exp.misses = 1;
      exp.moves = SC.removeMoves(m, s, p, only, rp);
      v.removeAt(i); or[vi].removeAt(i);
    } else if (op === 'setMeasure' || op === 'getMeasure' || op === 'entityAt') {
      const i = r() % n;
      const j = findE(i);
      const inR = fj >= 0 && fb0 <= i && i < fb0 + L[fj].len;
      if (inR) exp.hits = 1; else exp.misses = 1;
      expLeaf = L[j].id;
      if (inR) chk(fj === j, 'hit-leaf', tag(op, 'finger hit leaf mismatch'), o);
      if (op === 'setMeasure') { const mm = r() % 9; v.setMeasure(i, 1, mm); or[vi].setMeasure(i, 1, mm); }
      else if (op === 'getMeasure') chk(v.getMeasure(i, 1) === or[vi].getMeasure(i, 1), 'value', tag(op, 'getMeasure vs oracle'), o);
      else chk(v.entityAt(i) === or[vi].entityAt(i), 'value', tag(op, 'entityAt vs oracle'), o);
    } else if (op === 'indexAtSum') { // C-2: neutral seek
      const y = r() % (or[vi].total(0) + 2);
      chk(v.indexAtSum(0, y) === or[vi].indexAtSum(0, y), 'value', tag(op, 'indexAtSum vs oracle'), o);
      expLeaf = 'same';
    } else if (op === 'sumBefore') { // C-2: neutral seek
      const i = r() % (n + 1);
      chk(v.sumBefore(1, i) === or[vi].sumBefore(1, i), 'value', tag(op, 'sumBefore vs oracle'), o);
      expLeaf = 'same';
    } else if (op === 'splitAt') {
      for (let k = 1; k < count; k++) { const q = (vi + k) % count; if (views[q]._len === 0) { oi = q; break; } }
      if (oi < 0) { v.clear(); or[vi].clear(); expLeaf = 'nil'; op = 'clear'; }
      else {
        const i = r() % (n + 1);
        if (i > 0 && i < n) {
          const j = findE(i);
          const s = L[j].len;
          const p = i - L[j].fb;
          let lc, ls, rc, rs, lp = 0, rn = 0;
          if (p === 0) { lc = j; ls = L[j - 1].len; rc = L.length - j; rs = s; lp = L[j - 1].len; rn = L.length > j + 1 ? L[j + 1].len : 0; }
          else { lc = j + 1; ls = p; rc = L.length - j; rs = s - p; lp = j > 0 ? L[j - 1].len : 0; rn = L.length > j + 1 ? L[j + 1].len : 0; }
          const sr = SC.seamSplit(m, lc, ls, rc, rs); // C-21
          exp.seamRepairs = sr;
          exp.moves = SC.cutMoves(s, p);
          if (lc >= 2 && ls < m) { exp.moves += rep(lp, ls, 0); seenB('splitSeamL'); }
          if (rc >= 2 && rs < m) { exp.moves += rep(rs, rn, 1); seenB('splitSeamR'); }
          seenB('splitCut');
          if (p !== 0) seenB('splitMid');
        }
        v.splitAt(i, views[oi]); or[vi].splitAt(i, or[oi]);
        expLeaf = 'nil';
      }
    } else if (op === 'append') {
      oi = (vi + 1 + (r() % (count - 1))) % count;
      const Lo = leavesOf(pre, oi);
      if (n > 0 && Lo.length > 0) {
        const a = L[L.length - 1].len;
        const b = Lo[0].len;
        exp.seamRepairs = SC.seamAppend(m, a, b); // C-21
        if (exp.seamRepairs) { exp.moves = b < m ? rep(a, b, 0) : rep(a, b, 1); seenB('appendSeam'); }
      }
      v.append(views[oi]); or[vi].append(or[oi]);
      expLeaf = 'nil';
    } else { v.clear(); or[vi].clear(); expLeaf = 'nil'; }

    seenK(op); seenB(op);
    if (op === 'insertAt' && exp.splits) seenB('splitInsert');
    const post = f.snapshot();

    // snapshot is a deep copy: the op did not change the pre snapshot (e.g. _fpath)
    chk(json(pre) === preJ, 'alias', tag(op, 'pre snapshot changed after op (aliased)'), o);
    const d = {};
    for (const nm of ctr) d[nm] = v._n[K[nm]] - n0[K[nm]];
    chk(d.fingerHits === exp.hits, 'hit', tag(op, `fingerHits ${d.fingerHits} exp ${exp.hits}`), o);
    chk(d.fingerMisses === exp.misses, 'miss', tag(op, `fingerMisses ${d.fingerMisses} exp ${exp.misses}`), o);
    for (const [cls, nm] of [['splits', 'splits'], ['merges', 'merges'], ['equalizes', 'equalizes'],
      ['seams', 'seamRepairs'], ['moves', 'moves']]) {
      chk(d[nm] === exp[nm], cls, tag(op, `${nm} ${d[nm]} exp ${exp[nm]}`), o);
    }
    for (const nm of ['touches', 'pulls', 'rotSingle', 'rotDouble', 'joinSteps']) {
      chk(d[nm] === 0, 'zero-counter', tag(op, `${nm} moved by ${d[nm]}`), o);
    }
    if (off) chk(d.fingerHits === 0, 'hit', tag(op, 'finger-off op counted a hit'), o);

    // C-3 / C-5 / C-2: where the finger went
    if (expLeaf === 'same') {
      chk(v._fl === fl && v._fb === fb0, 'neutral', tag(op, 'neutral seek moved the finger'), o);
    } else if (typeof expLeaf === 'string' && expLeaf.startsWith('post:')) {
      const ii = +expLeaf.slice(5);
      const PL = leavesOf(post, vi);
      const jj = PL.findIndex((l) => l.fb <= ii && ii < l.fb + l.len);
      chk(jj >= 0 && v._fl === ~PL[jj].id, 're-home', tag(op, `structural re-home leaf ${v._fl} exp ${jj >= 0 ? ~PL[jj].id : '?'}`), o);
    } else if (expLeaf === 'nil') {
      chk(v._fl === NIL && v._fb === 0 && v._fdepth === 0, 'nil', tag(op, 'finger not NIL'), o);
      if (oi >= 0) chk(views[oi]._fl === NIL && views[oi]._fb === 0 && views[oi]._fdepth === 0, 'nil', tag(op, 'operand finger not NIL'), o);
    } else {
      chk(v._fl === ~expLeaf, 're-home', tag(op, `re-home leaf ${v._fl} exp ${~expLeaf}`), o);
    }
    if (post.live === 0) {
      seenB('reset');
      chk(post.int.bump === 0 && post.leaf.bump === 0 && post.int.free === -1 && post.leaf.free === -1,
        'reset', tag(op, 'pool not reset at live 0'), o);
    }
    const w = walk(post, { B, dims: 2 });
    chk(w === null, 'walk', tag(op, 'walker: ' + json(w)), o);
    for (let q = 0; q < count; q++) {
      const dm = or[q].dump();
      const PL = leavesOf(post, q);
      const ee = [], mm = [[], []];
      for (const l of PL) {
        for (let k = 0; k < l.len; k++) {
          ee.push(post.leaf.ent[l.id * B + k]);
          mm[0].push(post.leaf.meas[0][l.id * B + k]);
          mm[1].push(post.leaf.meas[1][l.id * B + k]);
        }
      }
      chk(json([ee, mm]) === json([dm.entities, dm.measures]), 'oracle', tag(op, 'view ' + q + ' diverged from oracle'), o);
    }
  }
}

// ---------------------------------------------------------------- lane config
// Check count: measured 2026-10-26, node v26.8.2: 116,744 checks, 0 fails (500/600 ops x
// seeds 1,2 x B 4/8/16 x count 2/3). The reviewer's deeper run (3000 ops x 3 seeds) was
// 1,008,699 checks, 0 fails. The floor below is a tripwire for a lane that checks nothing.
const LANE = { ops: (B) => (B === 16 ? 600 : 500), seeds: [1, 2], early: false };
// controls run deeper (early exit makes this cheap): leafModelNbr needs deep trees.
const MUT_LANE = { ops: () => 1000, seeds: [1, 2], early: true };
const CHECK_FLOOR = 100000;
const OPS = ['insertAt', 'removeAt', 'setMeasure', 'getMeasure', 'entityAt', 'indexAtSum',
  'sumBefore', 'splitAt', 'append', 'clear'];

let cleanRun;
const lane = () => (cleanRun ||= runLane(RealStubs, LANE));

test('count lane: synthStub per-op counts, re-home, NIL, neutral seeks, reset, snapshot', () => {
  const res = lane();
  assert.deepEqual(res.fails, [], 'lane failures: ' + JSON.stringify(res.fails));
  assert.ok(res.checks > CHECK_FLOOR, `lane checked ${res.checks}, floor ${CHECK_FLOOR}`);
});

test('count lane: every op kind and structural case exercised per B', () => {
  const res = lane();
  for (const B of [4, 8, 16]) {
    // appendSeam needs a leaf shorter than m: impossible at B=4 (m=1, C-21), so B=8/16 only.
    const kinds = [...OPS, 'splitInsert', 'structRemove', 'removeLast', 'splitCut', 'splitMid', 'reset'];
    if (B !== 4) kinds.push('appendSeam');
    for (const k of kinds) {
      assert.ok((res.seenB[B + ':' + k] || 0) > 0, `B=${B}: op/case "${k}" never exercised`);
    }
  }
  for (const k of ['splitSeamL', 'splitSeamR']) {
    assert.ok((res.seenB['8:' + k] || 0) + (res.seenB['16:' + k] || 0) > 0, 'C-21 split arm ' + k + ' never exercised');
  }
});

// ------------------------------------------------------------------- controls
const SRC = readFileSync(HERE('./stubs.mjs'), 'utf8');
const SC_URL = pathToFileURL(HERE('./spec-counts.mjs')).href;
const IMPORT_LINE = "import { H, Lmax } from './spec-counts.mjs';";
const tmpDirs = [];
after(() => { for (const d of tmpDirs) rmSync(d, { recursive: true, force: true }); });

function countOf(hay, needle) {
  let c = 0;
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + 1)) c++;
  return c;
}

async function buildStub(label, patch) {
  assert.equal(countOf(SRC, IMPORT_LINE), 1, 'spec-counts import anchor must match exactly once');
  let src = SRC.replace(IMPORT_LINE, IMPORT_LINE.replace('./spec-counts.mjs', SC_URL));
  if (patch) {
    assert.equal(countOf(src, patch[0]), 1, `${label}: patch anchor must match exactly once`);
    src = src.replace(patch[0], () => patch[1]);
  }
  const dir = mkdtempSync(join(tmpdir(), 'ygg-stubcounts-'));
  tmpDirs.push(dir);
  const file = join(dir, 'stubs.mjs');
  writeFileSync(file, src);
  return import(pathToFileURL(file).href); // an import throw fails the control
}

test('control: unpatched stubs through the mutant build path pass the lane', async () => {
  const S = await buildStub('unpatched', null);
  const res = runLane(S, { ops: () => 200, seeds: [1], early: true });
  assert.deepEqual(res.fails, [], 'build-path control failed: ' + JSON.stringify(res.fails));
  assert.ok(res.checks > 0);
});

// [name, anchor, replacement, expected first-failing check class, hint cell [B, count, seed]]
// (the hint only orders the search so the file stays fast; the full grid follows it.)
// Expected class = the first check (in lane order) a correct lane must trip.
const MUTANTS = [
  // C-21: a seam repair is no longer counted
  ['noSeamCount', "  if (seam) n[ST_N_SEAMS]++;\n", '', 'seams', [8, 2, 1]],
  // T-6: repair partner chosen by "not last leaf" instead of the sibling side; the wrong
  // partner size flips the merge-vs-equalize decision before any move count differs
  ['leafModelNbr', 'const jv = a.dSide === 0 ? ju + 1 : ju - 1;',
    'const jv = ju < s.leaves.length - 1 ? ju + 1 : ju - 1;', 'merges', [4, 3, 2]],
  // C-3: a non-structural removeAt no longer re-homes the finger
  ['noRemoveHome', "      stHome(a, this);\n      return e;\n    }\n    // T-6 underflow",
    "      return e;\n    }\n    // T-6 underflow", 're-home', [4, 2, 1]],
  // C-28: snapshot aliases the live _fpath
  ['fpathAlias', '_fpath: new Int32Array(w._fpath), _cv: w._cv,', '_fpath: w._fpath, _cv: w._cv,', 'alias', [4, 2, 1]],
  // pool reset at live 0 dropped
  ['noReset', "    a.live -= this._len;\n    this._len = 0;\n    stNil(a, this);\n    if (a.live === 0) stReset(a);\n",
    "    a.live -= this._len;\n    this._len = 0;\n    stNil(a, this);\n", 'reset', [4, 2, 1]],
  // a merge counted as an equalize
  ['eqForMerge', 'n[ST_N_MERGES]++;', 'n[ST_N_EQUALIZES]++;', 'merges', [4, 2, 1]],
  // A4-10 a: a split insert re-homes by the wrong rule (descends right on ties)
  ['splitHomeRule1', "stRebuild(a, this, s);\n    stDescend(a, this._root, at, 0);\n    stHome(a, this);\n    return undefined;",
    "stRebuild(a, this, s);\n    stDescend(a, this._root, at, 1);\n    stHome(a, this);\n    return undefined;", 're-home', [4, 2, 1]],
  // C-30: a mid-leaf cut is counted as a split
  ['cutIsSplit', "      cn[ST_N_MOVES] += stScatter(a, g, [id, fresh], [p, len - p]);\n",
    "      cn[ST_N_MOVES] += stScatter(a, g, [id, fresh], [p, len - p]);\n      cn[ST_N_SPLITS]++;\n", 'splits', [4, 2, 1]],
  // C-21: append repairs the left seam leaf first when both are short
  ['appendBothShortLeft',
    "    if (a.leaf.len[list[jb]] < a.m) stRepair(a, cn, list, jb, ja, true);\n    else if (a.leaf.len[list[ja]] < a.m) stRepair(a, cn, list, ja, jb, true);",
    "    if (a.leaf.len[list[ja]] < a.m) stRepair(a, cn, list, ja, jb, true);\n    else if (a.leaf.len[list[jb]] < a.m) stRepair(a, cn, list, ja, jb, true);", 'moves', [8, 2, 1]],
];

for (const [name, from, to, cls, hint] of MUTANTS) {
  test(`control: mutant ${name} fails the lane with class "${cls}"`, async () => {
    const S = await buildStub(name, [from, to]);
    const res = runLane(S, { ...MUT_LANE, hint });
    assert.equal(res.fails.length, 1, `${name}: lane did not fail (checks ${res.checks})`);
    assert.equal(res.fails[0].cls, cls, `${name}: caught by "${res.fails[0].cls}" (${res.fails[0].msg}), expected "${cls}"`);
    console.log(`# mutant ${name}: class ${res.fails[0].cls} first fail op#${res.fails[0].o}: ${res.fails[0].msg}`);
  });
}
