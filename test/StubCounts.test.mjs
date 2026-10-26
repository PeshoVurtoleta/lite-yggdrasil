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
import { runLane } from './count-lane.mjs';

const HERE = (p) => fileURLToPath(new URL(p, import.meta.url));


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
