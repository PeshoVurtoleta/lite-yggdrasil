// benchmark/kernel-lane.mjs -- the adapter op-kernel B/op + GC + retention gate (Bench-ADOPT group 1 TASK 5;
// SPEC-bench-adopt BA-7, A1-1; PLAN-bench-adopt-g1 assertion A5). Repo-only, never shipped. Run:
//   node --expose-gc --no-concurrent-recompilation --min-semi-space-size=4 --max-semi-space-size=4
//     benchmark/kernel-lane.mjs
// DETERMINISTIC (byte and GC COUNTS, never a timing): no quiet-lock needed.
//
// What it gates, per lane set (one adapter):
// - lanes: one per op kernel of the adapter HANDLE (benchmark/Adapters.mjs) -- insertAt, removeAt, setMeasure,
//   indexAtSum, sumBefore, cursorWalk16 (cursor seekIndex + 15 next()), cursorWalkSum16 (cursor seekSum + 15 next(),
//   summing measure(0); R-BA15) -- at n = 2^16 over 1e5 ops per window, 6
//   windows, measured by test/torture-meter.mjs (new-space used delta, MIN over windows 1..5, empty-loop baseline
//   subtracted, a window with a GC discarded; R-G2). A lane is ok iff B/op < 1 (0 B/op). Every measured window is
//   inside the lite-gc-profiler region 'lanes'; checkNoGc gates maxMajor 0 on it. insertAt / removeAt keep n in
//   [2^16, 2^16 + 1e5] with an untimed prep (trim / refill at the end) before each window, outside the measurement.
//   One predicate laneOk (B/op < 1) decides every lane AND ctl.alloc. A lane must also prove work: counters reset
//   before it and read after it (outside the windows), sum of mapped counters + extras > 0; insertAt must end at
//   length n + ops and removeAt at n.
// - retention: 1000 cycles of create -> fill 1024 -> clear() -> refill -> clear(), plus createViews(3 x 1024, 1, 3) with
//   the same steps on each of its 3 views (R-BA15); each SumSequence view is tracked by
//   @zakkster/lite-leak and untracked only when it is back to the constructed state (length 0, cursor invalid).
//   Gate: tracker.size() === 0 after gc + settle, every view COLLECTED (a WeakRef per view, deref() undefined), no view
//   finalized while still tracked, no leak / finding / warning.
// - controls (must FAIL their gate, else this file exits 1): ctl.alloc (one fresh object per op) must read > 8 B/op
//   and so fail the lane gate; ctl.retain (10 cycles whose clear() is skipped, the views kept) must leave size() >= 1.
// Exit 0 only if every lane is ok, the GC region holds maxMajor 0, retention is clean AND both controls FAIL.
//
// Rival lanes (BA-7, A1-1): group 2a B3 appends entries to RIVAL_LANES below -- { adapter, n, ops }, the adapter
// one of the registered rivals of benchmark/Adapters.mjs (BlockedArrayAdapter, FenwickSuffixAdapter,
// FenwickFullAdapter; g2b-1 TASK 3 imports them instead of building local copies). Each entry gets the same
// kernel set through laneSet(); an O(n)-per-op rival takes a smaller ops (the B/op reading is per op, so the bound
// is unchanged). A rival that allocates fails this file and so `npm run verify`.
//
// Flags (fail closed): process.execArgv must hold --expose-gc, --no-concurrent-recompilation (R-G5: optimised code
// installs synchronously, so every lane reads the same tier), --min-semi-space-size=4 and --max-semi-space-size=4,
// else exit 1 naming the missing flag. Driver law: indices / measures in Int32Array tables, results into IOUT.
// ASCII-only. MIT (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>

import {
  createLeakTracker,
  createOwnerCascadeOrphanKernel,
  createListenerOrphanKernel,
  createObserverOrphanKernel,
  createAsyncRetentionKernel,
} from '@zakkster/lite-leak';
import { GcProfiler, checkNoGc } from '@zakkster/lite-gc-profiler';
import {
  SumSequenceAdapter, BlockedArrayAdapter, FenwickSuffixAdapter, FenwickFullAdapter, validateAdapter,
} from './Adapters.mjs';

const FLAGS = ['--expose-gc', '--no-concurrent-recompilation', '--min-semi-space-size=4', '--max-semi-space-size=4'];
for (const f of FLAGS) {
  if (!process.execArgv.includes(f)) {
    console.log('GATE kernel-lane FAIL: missing node flag ' + f);
    process.exit(1);
  }
}
// imported after the flag check: the meter warms itself at module init
const { lane, baseline, bop, winText, semiSpaceOk } = await import('../test/torture-meter.mjs');
if (!semiSpaceOk()) {
  console.log('GATE kernel-lane FAIL: semi-space flags not pinned');
  process.exit(1);
}

const N = 1 << 16;
const OPS = 100000;
const WIN = 6;
const MASK = 4095;
const CYCLES = 1000;
const CTL_CYCLES = 10;
const FILL = 1024;
const ALLOC_MIN = 8; // ctl.alloc must read above this
// ctl.alloc runs 2.5e4 ops per window: at 1e5 ops its ~3.2 MB per window overflows the 4 MB semi-space in most
// windows (each then discarded), and an all-discarded control reads NaN (a fail-closed FAIL with no reading).
const CTL_OPS = 25000;

const IOUT = new Int32Array(4);

// The ONE lane pass rule (R-G2: 0 B/op): every lane uses it, and ctl.alloc must FAIL this same predicate.
const laneOk = (b) => b < 1;

// ---- rival lane sets (group 2a B3, BA-7; PLAN-bench-adopt-g2a A3) -----------------------------------------------
// Every entry runs the SAME laneSet as the subject (laneOk, work > 0, the insertAt / removeAt length checks).
// BlockedArray: 3 split patterns at dims 1 (BA-14): 'mid' = the laneSet positions (random, 1/2 splits, default
// chunkCap), 'tail' = every insertAt at length (3/4 : 1/4 splits), 'head' = every insertAt at 0 (1/4 : 3/4 splits);
// the pattern rewrites only the handle's insertAt index (removeAt and the reads keep the laneSet positions), plus
// 'mid' at dims 4. 'tail' / 'head' run at tune { chunkCap: 16 }: one split per 12 inserts (each split leaves a
// B/4 = 4 chunk that the next 12 inserts fill), so a 32 B box on the _split path reads 32 / 12 = 2.7 B/op here
// (at the default chunkCap 408 it read 32 / 306 = 0.1 B/op, under the gate). They run at n = 2^14 with 2^13 ops per
// window: at chunkCap 16 a scan is O(n / 12) directory entries, so n = 2^16 x 1e5 ops took ~95 s and wrapped the
// rival's Int32 dirScans counter (the work check read < 0). FenwickRebuild: modes 'full' and
// 'suffix', two instances (no arena), dims 1 and 4, at live 1024
// with 2^13 ops per window (insertAt / removeAt rebuild O(n) per op; the reading is per op, the bound unchanged).
// The '.d4' wrapper builds the instance at dims 4 whatever dims laneSet asks for (laneSet passes 4 measures).
// create() ends with gc() (cold: laneSet calls it before its first window): a rival set holds up to ~25 MB of
// typed arrays, and the dead instances of the previous sets would otherwise trigger a major GC inside a window.
const RIVAL_N_FW = 1024;
const RIVAL_OPS_FW = 1 << 13;
const BA_SPLIT_TUNE = Object.freeze({ chunkCap: 16 });
const RIVAL_N_BA16 = 1 << 14;
const RIVAL_OPS_BA16 = 1 << 13;

function rivalPattern(a, pattern, dims, tune) {
  const sfx = (pattern === 'mid' ? '' : '.' + pattern) + (dims === 4 ? '.d4' : '');
  return Object.assign({}, a, {
    name: a.name + sfx,
    create: (C, d) => {
      const h = a.create(C, dims === 4 ? 4 : d, tune);
      globalThis.gc();
      const ins = h.insertAt;
      if (pattern === 'tail') h.insertAt = (i, e, m0, m1, m2, m3) => { ins(h.length(), e, m0, m1, m2, m3); };
      else if (pattern === 'head') h.insertAt = (i, e, m0, m1, m2, m3) => { ins(0, e, m0, m1, m2, m3); };
      return h;
    },
  });
}

/** Rival lane sets (BA-7): { adapter, n, ops }, each run through laneSet after the subject's. */
export const RIVAL_LANES = [
  { adapter: rivalPattern(BlockedArrayAdapter, 'mid', 4), n: N, ops: OPS },
  { adapter: rivalPattern(BlockedArrayAdapter, 'mid', 1), n: N, ops: OPS },
  { adapter: rivalPattern(BlockedArrayAdapter, 'tail', 1, BA_SPLIT_TUNE), n: RIVAL_N_BA16, ops: RIVAL_OPS_BA16 },
  { adapter: rivalPattern(BlockedArrayAdapter, 'head', 1, BA_SPLIT_TUNE), n: RIVAL_N_BA16, ops: RIVAL_OPS_BA16 },
  { adapter: rivalPattern(FenwickFullAdapter, 'mid', 1), n: RIVAL_N_FW, ops: RIVAL_OPS_FW },
  { adapter: rivalPattern(FenwickSuffixAdapter, 'mid', 1), n: RIVAL_N_FW, ops: RIVAL_OPS_FW },
  { adapter: rivalPattern(FenwickFullAdapter, 'mid', 4), n: RIVAL_N_FW, ops: RIVAL_OPS_FW },
  { adapter: rivalPattern(FenwickSuffixAdapter, 'mid', 4), n: RIVAL_N_FW, ops: RIVAL_OPS_FW },
];
for (const r of RIVAL_LANES) validateAdapter(r.adapter);
// Meter warm-up for the longer run (cold, module init, before any gated window): measured 2026-11-01, node v26.8.2,
// the meter's fixed cost per window steps from 1832 B to 1816 B at meter window 255 of a process (0-based, counting
// test/torture-meter.mjs's own 48 warm windows; 3/3 runs, .handoff/evidence/bench-adopt/g2b/meter-step.log), so the
// lane set measured across that step read -0.00016 B/op
// against its earlier baseline (printed '-0.000'). 60 empty lanes of 1000 ops (360 windows) put the step before
// the first baseline; every lane then reads its baseline at the same meter cost.
const RIVAL_WARM = 60;
for (let r = 0; r < RIVAL_WARM; r++) lane('rival-warm', () => {}, 1000, WIN);

// ---- tables (cold, built once) ------------------------------------------------------------------------------------
const RS = new Int32Array([0x2545F491]);
function rnd(mod) {
  RS[0] = (Math.imul(RS[0], 1664525) + 1013904223) | 0;
  return (RS[0] >>> 8) % mod;
}

function tables(n) {
  const P = new Int32Array(MASK + 1);
  const V = new Int32Array(MASK + 1);
  const Y = new Int32Array(MASK + 1);
  for (let k = 0; k <= MASK; k++) {
    P[k] = rnd(n);
    V[k] = rnd(256);
    Y[k] = rnd(n * 128);
  }
  return { P, V, Y };
}

function fillTo(h, n) {
  for (let j = h.length(); j < n; j++) h.insertAt(j, j & 0xFFFF, (j * 7) & 255, 1, 1, 1);
}

// ---- lanes --------------------------------------------------------------------------------------------------------
function laneSet(rows, adapter, n, ops, gate) {
  const base = baseline(ops, WIN);
  const h = adapter.create(n + ops + 64, 1);
  fillTo(h, n);
  const { P, V, Y } = tables(n);
  const name = adapter.name;
  const cnt = new Int32Array(12);
  const ex = new Float64Array(adapter.extraCounts.length);
  // A lane must prove it did work: counters reset before lane(), read after it (outside every window); the sum of
  // the mapped counters + extras must be > 0, and insertAt / removeAt must leave the expected length.
  const run = (op, step, prep, wantLen) => {
    h.resetCounts();
    const res = lane(name + '.' + op, step, ops, WIN, prep, gate);
    const b = bop(res, base);
    h.readCounts(cnt);
    if (ex.length > 0) h.readExtras(ex);
    let work = 0;
    for (let j = 0; j < 12; j++) if (adapter.counterMap[j]) work += cnt[j];
    for (let j = 0; j < ex.length; j++) work += ex[j];
    const len = h.length();
    const lenOk = wantLen === undefined || len === wantLen;
    rows.push({ kind: 'lane', name: name + '.' + op, bop: b, ok: laneOk(b) && work > 0 && lenOk, work, len, lenOk,
      wins: winText(res, base), windows: WIN });
  };
  run('insertAt', (k) => { h.insertAt(P[k & MASK], k & 0xFFFF, V[k & MASK], 1, 1, 1); }, () => {
    while (h.length() > n) h.removeAt(h.length() - 1);
  }, n + ops);
  run('removeAt', (k) => { h.removeAt(P[k & MASK]); }, () => { fillTo(h, n + ops); }, n);
  while (h.length() > n) h.removeAt(h.length() - 1);
  run('setMeasure', (k) => { h.setMeasure(P[k & MASK], 0, V[k & MASK]); });
  run('indexAtSum', (k) => { IOUT[0] = h.indexAtSum(0, Y[k & MASK]); });
  run('sumBefore', (k) => { IOUT[1] = h.sumBefore(0, P[k & MASK]); });
  if (typeof h.cursorWalk === 'function') {
    run('cursorWalk16', (k) => { IOUT[2] = h.cursorWalk(P[k & MASK], 16); });
  } else {
    rows.push({ kind: 'na', name: name + '.cursorWalk16', reason: adapter.na.cursorWalk, ok: true });
  }
  if (typeof h.cursorWalkSum === 'function') {
    run('cursorWalkSum16', (k) => { IOUT[3] = h.cursorWalkSum(0, Y[k & MASK], 16); });
  } else {
    rows.push({ kind: 'na', name: name + '.cursorWalkSum16', reason: adapter.na.cursorWalkSum, ok: true });
  }
}

// The allocating control: one fresh object per op, kept in a ring so escape analysis cannot drop it.
const HOLD = new Array(8);
function ctlAlloc(rows) {
  const base = baseline(CTL_OPS, WIN);
  const res = lane('ctl.alloc', (k) => { HOLD[k & 7] = { k }; }, CTL_OPS, WIN);
  const b = bop(res, base);
  rows.push({ kind: 'control', name: 'ctl.alloc', bop: b, ok: !laneOk(b) && b > ALLOC_MIN, wins: winText(res, base),
    expect: 'FAIL (> ' + ALLOC_MIN + ' B/op)' });
}

// ---- retention ----------------------------------------------------------------------------------------------------
const tick = (ms) => new Promise((r) => setTimeout(r, ms));
async function gcSettle() {
  globalThis.gc();
  await tick(20);
  globalThis.gc();
  await tick(20);
}

const K_FIN = 0;   // views finalized while still tracked
const K_STATE = 1; // views not back to the constructed state after clear()

function constructed(h) {
  return h.length() === 0 && h.instance.cursor().valid === false;
}

// One view's steps: track -> fill -> seek -> (clear -> refill -> seek -> clear) -> untrack when constructed.
function viewSteps(tracker, onFin, K, h, retain, tag, refs, kept) {
  const handle = tracker.track(h.instance, onFin, tag);
  refs.push(new WeakRef(h.instance));
  fillTo(h, FILL);
  h.instance.cursor().seekIndex(FILL >>> 1);
  if (!retain) {
    h.clear();
    fillTo(h, FILL);
    h.instance.cursor().seekIndex(0);
    h.clear();
  }
  if (constructed(h)) tracker.untrack(handle);
  else K[K_STATE]++;
  if (retain) kept.push(h);
}

// Returns nothing: no frame of the caller may hold the last view (a retained view goes into kept only).
// create() gives one view; createViews(3 x FILL, 1, 3) gives 3 views of one arena (R-BA15), each filled to FILL.
function cycle(tracker, onFin, K, adapter, retain, tag, refs, kept) {
  viewSteps(tracker, onFin, K, adapter.create(FILL, 1), retain, tag, refs, kept);
  const vs = adapter.createViews(3 * FILL, 1, 3);
  for (let j = 0; j < vs.length; j++) viewSteps(tracker, onFin, K, vs[j], retain, tag + '.v' + j, refs, kept);
  vs.length = 0;
}

async function retention(adapter, cycles, retain) {
  const K = new Int32Array(2);
  const leaks = [];
  const warns = [];
  const tracker = createLeakTracker({
    name: retain ? 'yg-kernel-lane-ctl' : 'yg-kernel-lane',
    onLeak: (rep) => leaks.push(rep.kind + ':' + String(rep.tag)),
    onWarning: (w) => warns.push(w.kind + ':' + w.reason),
  });
  // No timer-orphan kernel (as test/torture.mjs): the engine arms no timer; that kernel flags this file's settle ticks.
  const unreg = [];
  for (const k of [createOwnerCascadeOrphanKernel(), createListenerOrphanKernel(), createObserverOrphanKernel(),
    createAsyncRetentionKernel()]) unreg.push(tracker.registerKernel(k));
  const onFin = () => { K[K_FIN]++; }; // closes over K only, never over a view
  const kept = [];
  const refs = [];
  for (let i = 0; i < cycles; i++) {
    cycle(tracker, onFin, K, adapter, retain, retain ? 'ctl-view' : 'view', refs, kept);
  }
  await gcSettle();
  const size = tracker.size();
  // every view must be COLLECTED, not only untracked (a module-level holder would keep them all)
  let alive = 0;
  for (const r of refs) if (r.deref() !== undefined) alive++;
  const findings = tracker.audit();
  const held = kept.length;
  kept.length = 0;
  for (const u of unreg) u();
  return { size, alive, fin: K[K_FIN], state: K[K_STATE], leaks, warns, findings, held, views: refs.length };
}

// ---- main ---------------------------------------------------------------------------------------------------------
const rows = [];

const ret = await retention(SumSequenceAdapter, CYCLES, false);
// views: 1 create() view + 3 createViews views per cycle must all have been tracked (the createViews path ran)
const retOk = ret.views === 4 * CYCLES && ret.size === 0 && ret.alive === 0 && ret.fin === 0 && ret.state === 0 &&
  ret.leaks.length === 0 && ret.findings.length === 0 && ret.warns.length === 0;
console.log('retention: cycles=' + CYCLES + ' views=' + ret.views + ' size=' + ret.size + '/0 alive=' + ret.alive + '/0 finalized-tracked=' + ret.fin + '/0 notReset=' +
  ret.state + '/0 leaks=' + ret.leaks.length + ' findings=' + ret.findings.length + ' warnings=' + ret.warns.length +
  ' | ' + (retOk ? 'ok' : 'FAIL'));
const ctlR = await retention(SumSequenceAdapter, CTL_CYCLES, true);
const ctlROk = ctlR.size >= 1;
console.log('control ctl.retain: cycles=' + CTL_CYCLES + ' size=' + ctlR.size + ' (must be >= 1) alive=' + ctlR.alive +
  ' held=' + ctlR.held +
  ' | ' + (ctlROk ? 'FAILS as required' : 'DID NOT FAIL'));

await gcSettle();
await tick(20);
const prof = new GcProfiler();
prof.start();
const G = new Int32Array(2);
const gate = {
  enter: () => { G[0]++; prof.enter('lanes'); },
  exit: () => { G[1]++; prof.exit(); },
};
let err = null;
try {
  laneSet(rows, SumSequenceAdapter, N, OPS, gate);
  for (const r of RIVAL_LANES) laneSet(rows, r.adapter, r.n, r.ops, gate);
} catch (e) {
  err = e;
}
await prof.settle();
const s = prof.summary();
prof.stop();
const rep = checkNoGc(s, { perRegion: { lanes: { maxMajor: 0 } } });
const lg = s.byRegion && s.byRegion.lanes ? s.byRegion.lanes.gc : null;
ctlAlloc(rows);

let lanesOk = err === null && rows.some((r) => r.kind === 'lane');
let ctlAOk = false;
let worst = -Infinity;
let laneWindows = 0;
for (const r of rows) {
  if (r.kind === 'lane') {
    laneWindows += r.windows;
    if (!r.ok) lanesOk = false;
    worst = Number.isNaN(r.bop) || Number.isNaN(worst) ? NaN : Math.max(worst, r.bop);
    console.log('  lane ' + r.name + ' bop=' + r.bop.toFixed(3) + ' [' + r.wins + '] work=' + r.work + ' len=' + r.len +
      (r.lenOk ? '' : '(WRONG)') + ' ' + (r.ok ? 'ok' : 'FAIL'));
  } else if (r.kind === 'na') {
    console.log('  lane ' + r.name + ' n/a (' + r.reason + ')');
  } else {
    ctlAOk = r.ok;
    console.log('  control ' + r.name + ' bop=' + r.bop.toFixed(3) + ' [' + r.wins + '] expect ' + r.expect + ' | ' +
      (r.ok ? 'FAILS as required' : 'DID NOT FAIL'));
  }
}
const coverOk = G[0] === laneWindows && G[1] === laneWindows;
const gcOk = rep.ok === true && lg !== null;
if (err !== null) console.log('  error ' + String(err && err.stack || err));
// Fail closed on the lane count: 9 laneSet calls (SumSequence + 8 RIVAL_LANES) x 7 kernels; a kernel that went n/a
// or a dropped lane set must fail, never shrink the gate.
const LANES_WANT = 63;
const laneCount = rows.filter((r) => r.kind === 'lane').length;
const countOk = laneCount === LANES_WANT;
const ok = lanesOk && gcOk && coverOk && retOk && ctlAOk && ctlROk && countOk;
console.log('GATE kernel-lane lanes=' + laneCount + ' worst=' +
  (Number.isFinite(worst) ? worst.toFixed(3) : String(worst)) + ' B/op | pin lanes=' + LANES_WANT + ' ' +
  (countOk ? 'ok' : 'FAIL') + ' | gc major=' + (lg ? lg.major : 'n/a') +
  ' minor=' + (lg ? lg.minor : 'n/a') + ' maxMs=' + (lg ? lg.maxMs.toFixed(2) : 'n/a') + ' windows=' + G[0] + '/' +
  laneWindows + ' | leak=size ' + ret.size + '/0 alive=' + ret.alive + '/0 | ctl.alloc ' + (ctlAOk ? 'FAIL(required)' : 'PASSED(bad)') +
  ' ctl.retain ' + (ctlROk ? 'FAIL(required)' : 'PASSED(bad)') + ' | ' + (ok ? 'ok' : 'FAIL'));
if (!gcOk) for (const v of rep.violations || []) console.log('  violation ' + v.metric + ' limit=' + v.limit + ' actual=' + v.actual);
process.exitCode = ok ? 0 : 1;
