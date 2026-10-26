// test/engine-lanes.mjs -- ENGINE-size exhaustive lanes on the real engine (`npm run test:lanes`; ADR 0005 C-31,
// C-32, R-E1). Untimed (wall is printed as REPORTED only, nothing asserts on time), chained into `npm run verify`;
// the CAPS-size lanes stay in npm test (test/EngineLanes.test.mjs). NOT a *.test file, so `node --test test/*.test.mjs`
// does not load it.
//
// Sections: (1) bfs / sweep / deep at ENGINE sizes for B = 4 and 8, each within 2^22 applies, each B with >= 1 clear
// on a NON-EMPTY view (counted by the own-property clear wrapper, A4-14); (2) the B-1b row at bfsLane B = 4 nMax 9
// plus its unpatched control. A later section (the C-34 A1 run, rung 10 / K-R2) is added after "SECTION 3" below.
//
// Orchestrator readings (PROPOSED addendum, NOT maintainer rulings):
// - clear: the engine's clear() returns this, Oracle.clear returns undefined (exhaustive.mjs compares by kind), so the
//   lane factory wraps clear as an OWN property that calls the real clear, throws if it did not return the view, and
//   returns undefined. Fix owner: the K cursor batch's M-6 re-pin of exhaustive.mjs / oracle.mjs.
// - sweep cap rule (C-31: lower that lane's nSweep by 1, never raise 2^22): B = 8 at ENGINE.nSweep 12 applies
//   4194305 > 2^22 (measured 2026-10-27), so nSweep 11 is used for B = 8 (EXPECTED to be re-measured on a code change).
// - B-1b moves to test:lanes at nMax 9: at nMax 6 the mutant finds nothing. Mutant = rotate only when the weight
//   imbalance is also an element-count imbalance (an element-count-only trigger fails I-7, not I-1).
//
// Exit code: 0 all green, 1 on any failure. ASCII-only. MIT (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>

import { fileURLToPath, pathToFileURL } from 'node:url';
import { engineFactory } from './adapter.mjs';
import { buildMutant } from './mutant-build.mjs';
import { bfsLane, sweepLane, deepLane, ENGINE } from './exhaustive.mjs';

const HERE = (p) => fileURLToPath(new URL(p, import.meta.url));
const NSWEEP = { 4: ENGINE.nSweep[4], 8: ENGINE.nSweep[8] - 1 };
const clears = { 4: 0, 8: 0 }; // clear() calls on a view with length > 0, per B
let failures = 0;
const lines = [];

function wrapClear(f, B) {
  return (C, o, n, cfg) => {
    const r = f(C, o, n, cfg);
    for (const v of r.views) {
      v.clear = function () {
        const nonEmpty = this.length > 0;
        const q = Object.getPrototypeOf(this).clear.call(this);
        if (q !== this) throw new Error('engine-lanes: clear() must return this');
        if (nonEmpty && B !== 0) clears[B]++;
        return undefined;
      };
    }
    return r;
  };
}

function report(name, B, rep, extra) {
  const ok = rep.ok === true && rep.divergences === 0 && rep.applied <= ENGINE.cap;
  if (!ok) failures++;
  lines.push(`${name} B=${B} applied=${rep.applied} ${extra} ok=${ok}` + (ok ? '' : ' first=' + JSON.stringify(rep.first)));
}

// ---- SECTION 1: ENGINE-size lanes
const t0 = Date.now();
for (const B of [4, 8]) {
  const f = wrapClear(engineFactory, B);
  const b = bfsLane(f, { B, nMax: ENGINE.nMax[B], cap: ENGINE.cap });
  report('bfs', B, b, `states=${b.states.length}`);
  const s = sweepLane(f, { B, states: b.states, nSweep: NSWEEP[B], cap: ENGINE.cap });
  report('sweep', B, s, `nSweep=${NSWEEP[B]}`);
  const d = deepLane(f, { B, ops: ENGINE.deepOps, seed: 1, nLo: ENGINE.deepN[B][0], nHi: ENGINE.deepN[B][1], cap: ENGINE.cap });
  report('deep', B, d, `maxLeaves=${d.maxLeaves}`);
  const okClear = clears[B] >= 1;
  if (!okClear) failures++;
  lines.push(`clear-on-non-empty B=${B} count=${clears[B]} ok=${okClear}`);
}

// ---- SECTION 2: B-1b row (bfsLane B = 4, nMax 9) and its unpatched control
// Anchors (each exactly 1; split-side and delete-side rotate triggers):
//   `if ((3 * wl < wr) | (3 * wr < wl))`  and  `if ((3 * lw < rw) | (3 * rw < lw))`
const EC = 'const ecl = xl < 0 ? v._llen[~xl] : v._count[xl]; const ecr = xr < 0 ? v._llen[~xr] : v._count[xr]; ';
const B1B = [
  ['if ((3 * wl < wr) | (3 * wr < wl))', EC + 'if (((3 * wl < wr) | (3 * wr < wl)) & ((3 * ecl < ecr) | (3 * ecr < ecl)))', 1],
  ['if ((3 * lw < rw) | (3 * rw < lw))', EC + 'if (((3 * lw < rw) | (3 * rw < lw)) & ((3 * ecl < ecr) | (3 * ecr < ecl)))', 1],
];
const built = [];
async function mutantFactory(patches) {
  const Y = await buildMutant(HERE('../Yggdrasil.js'), patches);
  const A = await buildMutant(HERE('./adapter.mjs'), [["'../Yggdrasil.js'", "'" + pathToFileURL(Y.file).href + "'", 1]]);
  built.push(Y, A);
  return wrapClear(A.engineFactory, 0);
}
try {
  const ctl = bfsLane(await mutantFactory([]), { B: 4, nMax: 9, cap: ENGINE.cap });
  const okCtl = ctl.ok === true;
  if (!okCtl) failures++;
  lines.push(`B-1b control (unpatched via buildMutant) bfs B=4 nMax=9 applied=${ctl.applied} ok=${okCtl}`);
  const mut = bfsLane(await mutantFactory(B1B), { B: 4, nMax: 9, cap: ENGINE.cap });
  const okMut = mut.ok === false && mut.first.code === 'I-1' && /^balance/.test(mut.first.detail);
  if (!okMut) failures++;
  lines.push(`B-1b mutant bfs B=4 nMax=9 first=${JSON.stringify(mut.first)} ok=${okMut}`);
} finally {
  for (const b of built) b.cleanup();
}

// ---- SECTION 3: reserved for the C-34 A1 run (rung 10, K-R2).

for (const l of lines) console.log(l);
console.log(`wall ${Date.now() - t0} ms (REPORTED only)`);
console.log(failures === 0 ? 'test:lanes OK' : `test:lanes FAILED (${failures})`);
process.exitCode = failures === 0 ? 0 : 1;
