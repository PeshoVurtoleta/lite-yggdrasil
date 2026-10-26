// test/EngineCounts.test.mjs -- the count lane in ENGINE mode (ADR 0005 C-20, C-25,
// C-26, C-33, C-46 M-6..M-8; PLAN-E0-G tasks 6 and 7).
//
// The lane (test/count-lane.mjs) runs the same op stream as StubCounts against
// the real SumSequence through test/adapter.mjs. Every expected value comes from
// spec-counts formulas and walker-style depth recounts of the PRE / POST
// snapshots, never from the engine. Until the hit test lands (F) every positional
// op is a miss. Checks per op: see the count-lane.mjs header.
//
// Controls (each must FAIL the lane with its expected class): a C-25 touches
// "+2 per level" mutant of the engine, and the structural re-home `<=` mutant (the
// only gate for A4-10 a). Mutants are exact-count source patches of a temp copy
// (buildMutant, C-46 M-8); the adapter is rebuilt over the mutant. The anchors come
// from the coder: ANCHORS values are 'TODO' until the orchestrator supplies literal
// [anchor, replacement, count] lists, and a row with a 'TODO' anchor is marked todo.
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
  touchesPlus2: [['cn[YG_TOUCHES] += depth;', 'cn[YG_TOUCHES] += depth * 2;', 5]],
  // ygHome's element-rule compare (the only `if (q < c) {` in the file)
  rehomeLe: [['    if (q < c) {', '    if (q <= c) {', 1]],
};

// B 4 / 8 / 16 x count 2 / 3 (the lane grid) x dims 1 and 2 (one lane per dims).
// 500/600 ops x seeds 1, 2: the same sizes as StubCounts, whose measured tallies
// (stub run, 2026-10-26) show merge, equalize, split and structural-remove cases at
// every B. The floor is a tripwire for a lane that checks nothing.
const LANE = (dims) => ({ ops: (B) => (B === 16 ? 600 : 500), seeds: [1, 2], early: false, mode: 'engine', dims });
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
      // clear on a non-empty view with other views live is skipped until S-R1 (count-lane.mjs limit):
      // required only where it is seen (checked per B below)
      if (B !== 16) kinds.push('clear', 'reset'); // B=16 reaches live 0 only via clear
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
];

for (const [name, key, cls, hint] of MUTANTS) {
  const todo = ANCHORS[key] === 'TODO' ? 'G-B3: literal anchor from the coder' : false;
  test(`control: engine mutant ${name} fails the lane with class "${cls}"`, { todo }, async () => {
    const E = await buildEngine(ANCHORS[key]);
    const res = runLane({ COUNTERS: E.COUNTERS }, { ...MUT_LANE(2), factory: E.factory, hint });
    assert.equal(res.fails.length, 1, `${name}: lane did not fail (checks ${res.checks})`);
    assert.equal(res.fails[0].cls, cls, `${name}: caught by "${res.fails[0].cls}" (${res.fails[0].msg}), expected "${cls}"`);
    console.log(`# engine mutant ${name}: class ${res.fails[0].cls} first fail op#${res.fails[0].o}: ${res.fails[0].msg}`);
  });
}
