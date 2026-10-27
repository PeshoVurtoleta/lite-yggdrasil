// test/EngineCounts.test.mjs -- the count lane in ENGINE mode (ADR 0005 C-20, C-25,
// C-26, C-33, C-46 M-6..M-8; PLAN-E0-G tasks 6 and 7).
//
// The lane (test/count-lane.mjs) runs the same op stream as StubCounts against
// the real SumSequence through test/adapter.mjs. Every expected value comes from
// spec-counts formulas and walker-style depth recounts of the PRE / POST
// snapshots, never from the engine. Hits are counted per C-4 / C-26 (rung F-R): a hit
// adds 0 touches, a miss keeps d(t). Checks per op: see the count-lane.mjs header.
//
// Controls (each must FAIL the lane with its expected class): a C-25 touches
// "+2 per level" mutant of the engine, and the structural re-home `<=` mutant (the
// only gate for A4-10 a). Mutants are exact-count source patches of a temp copy
// (buildMutant, C-46 M-8); the adapter is rebuilt over the mutant. The anchors are
// literal [anchor, replacement, count] lists.
// S-R2: the lane runs append in engine mode (count-lane.mjs header).
// S-R3: the lane runs splitAt for real too (the read-instead substitution and the LANE LIMIT note are gone).
// ASCII-only.

import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SumSequence } from '../Yggdrasil.js';
import { engineFactory } from './adapter.mjs';
import { buildMutant } from './mutant-build.mjs';
import { runLane } from './count-lane.mjs';

const HERE = (p) => fileURLToPath(new URL(p, import.meta.url));
const YPATH = HERE('../Yggdrasil.js');
const APATH = HERE('./adapter.mjs');

// Literal mutant patches from the coder: [[anchor, replacement, count], ...] each.
// touchesPlus2: touches adds 2 per level (class 'touches').
// rehomeLe: the structural re-home descent goes left on `<=` (class 're-home').
const ANCHORS = {
  // all five `cn[YG_TOUCHES] += depth;` adds (main positional descents) -> 2 per level
  touchesPlus2: [['cn[YG_TOUCHES] = (cn[YG_TOUCHES] + (depth & (h - 1))) | 0;', 'cn[YG_TOUCHES] = (cn[YG_TOUCHES] + ((depth & (h - 1)) * 2)) | 0;', 5]],
  // C-25: a hit adds 0 touches; the hit mask `& (h - 1)` dropped makes a hit add its depth (class 'touches')
  hitTouchesDepth: [['cn[YG_TOUCHES] = (cn[YG_TOUCHES] + (depth & (h - 1))) | 0;', 'cn[YG_TOUCHES] = (cn[YG_TOUCHES] + depth) | 0;', 5]],
  // C-4 insert lo `fb - ((fb-1)>>>31)` widened to `fb - 1`: i = fb now counts as a hit (class 'hit')
  loWiden: [['fb - ((fb - 1) >>> 31) < at', 'fb - 1 < at', 1]],
  // C-4 element range `at < fb + len` widened to `<=` (all three sites): i = fb+len hits (class 'value': wrong-leaf answer)
  elemHiWiden: [['at < fb + llen[~ref]', 'at <= fb + llen[~ref]', 3]],
  // ygHome's element-rule compare (the only `if (q < c) {` in the file)
  rehomeLe: [['    if (q < c) {', '    if (q <= c) {', 1]],
};

// B 4 / 8 / 16 x count 2 / 3 (the lane grid) x dims 1 and 2 (one lane per dims).
// 500/600 ops x seeds 1, 2: the same sizes as StubCounts, whose measured tallies
// (stub run, 2026-10-26) show merge, equalize, split and structural-remove cases at
// every B. The floor is a tripwire for a lane that checks nothing.
// S-R2: append consumes one extra draw per append op, which shifted the stream; seeds 1..5 (was 1, 2) restore the
// clearReset floor at B = 8 (measured 2026-10-26: clearReset 2 / 3 / 3 at B 4 / 8 / 16). Engine lane only; StubCounts is unchanged.
const LANE = (dims) => ({ ops: (B) => (B === 16 ? 600 : 500), seeds: [1, 2, 3, 4, 5], early: false, mode: 'engine', dims });
const MUT_LANE = (dims) => ({ ops: () => 1000, seeds: [1, 2], early: true, mode: 'engine', dims });
const CHECK_FLOOR = 100000;
const S = { COUNTERS: SumSequence.COUNTERS };

const clean = {};
const lane = (dims) => (clean[dims] ||= runLane(S, { ...LANE(dims), factory: engineFactory }));

for (const dims of [1, 2]) {
  test(`engine count lane (dims ${dims}): touches, pulls, rotations, joins, hits, re-home, NIL, walker, oracle`, () => {
    const res = lane(dims);
    assert.deepEqual(res.fails, [], 'lane failures: ' + JSON.stringify(res.fails));
    assert.ok(res.checks > CHECK_FLOOR, `lane checked ${res.checks}, floor ${CHECK_FLOOR}`);
  });

  test(`engine count lane (dims ${dims}): merge AND equalize removes, splits and every op kind seen per B`, () => {
    const res = lane(dims);
    for (const B of [4, 8, 16]) {
      const kinds = ['insertAt', 'removeAt', 'setMeasure', 'getMeasure', 'entityAt', 'indexAtSum', 'sumBefore',
        'splitInsert', 'structRemove', 'removeLast', 'removeMerge', 'removeEqualize'];
      // S-R1: clear runs for real in engine mode, on both paths (free-walk and O(1) reset);
      // the lane checks every counter delta of each clear is 0 (C-25 row TOUCH_TOTAL_CLEAR,
      // pulls [0, 0], hits / misses / splits / merges / equalizes / seams / moves / rot / join 0).
      kinds.push('clear', 'clearFree', 'clearReset', 'reset');
      // S-R2: append runs for real; >= 1 with both operands non-empty at every B, and >= 1 with a
      // seam repair at B 8 / 16 (at B = 4, m = 1: a leaf shorter than m cannot exist, C-21).
      kinds.push('append', 'appendBoth');
      // S-R3: splitAt runs for real: >= 1 with an empty operand, and >= 1 mid-leaf cut, at every B (tripwire floors)
      kinds.push('splitAt', 'splitCut', 'splitMid');
      if (B !== 4) kinds.push('appendSeam');
      for (const k of kinds) {
        assert.ok((res.seenB[B + ':' + k] || 0) > 0, `B=${B} dims=${dims}: op/case "${k}" never exercised`);
      }
    }
  });
}

// ------------------------------------------------------------------- controls
const built = [];
after(() => { for (const b of built) b.cleanup(); });

// An engine + adapter pair built from a patched temp copy of Yggdrasil.js.
async function buildEngine(patches) {
  const Y = await buildMutant(YPATH, patches);
  const A = await buildMutant(APATH, [["'../Yggdrasil.js'", "'" + pathToFileURL(Y.file).href + "'", 1]]);
  built.push(Y, A);
  return { COUNTERS: Y.SumSequence.COUNTERS, factory: A.engineFactory };
}

test('control: the unpatched engine through the mutant build path passes the lane', async () => {
  const E = await buildEngine([]);
  const res = runLane({ COUNTERS: E.COUNTERS }, { ops: () => 200, seeds: [1], early: true, mode: 'engine', dims: 2, factory: E.factory });
  assert.deepEqual(res.fails, [], 'build-path control failed: ' + JSON.stringify(res.fails));
  assert.ok(res.checks > 0);
});

// [name, ANCHORS key, expected first-failing check class, hint cell [B, count, seed]]
const MUTANTS = [
  // C-25: touches adds 2 per level of every descent
  ['touchesPlus2', 'touchesPlus2', 'touches', [4, 2, 1]],
  // A4-10 a: the structural re-home descends right on ties (`<=`); only this gate sees it
  ['rehomeLe', 'rehomeLe', 're-home', [4, 2, 1]],
  // C-25: a hit adds 0 touches
  ['hitTouchesDepth', 'hitTouchesDepth', 'touches', [4, 2, 1]],
  // C-4: range widening (insert lo, element hi) turns misses into hits (lane class 'hit' = the fingerHits delta check)
  ['loWiden', 'loWiden', 'hit', [4, 2, 1]],
  // the widened element range answers from the WRONG leaf at i = fb+len, so the value check (checked before the counters) fires first
  ['elemHiWiden', 'elemHiWiden', 'value', [4, 2, 1]],
];

for (const [name, key, cls, hint] of MUTANTS) {
  test(`control: engine mutant ${name} fails the lane with class "${cls}"`, async () => {
    const E = await buildEngine(ANCHORS[key]);
    const res = runLane({ COUNTERS: E.COUNTERS }, { ...MUT_LANE(2), factory: E.factory, hint });
    assert.equal(res.fails.length, 1, `${name}: lane did not fail (checks ${res.checks})`);
    assert.equal(res.fails[0].cls, cls, `${name}: caught by "${res.fails[0].cls}" (${res.fails[0].msg}), expected "${cls}"`);
    console.log(`# engine mutant ${name}: class ${res.fails[0].cls} first fail op#${res.fails[0].o}: ${res.fails[0].msg}`);
  });
}
