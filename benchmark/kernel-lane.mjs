// benchmark/kernel-lane.mjs -- the adapter op-kernel B/op + GC + retention gate (Bench-ADOPT group 1 TASK 5;
// SPEC-bench-adopt BA-7, A1-1; PLAN-bench-adopt-g1 assertion A5). Repo-only, never shipped. Run:
//   node --expose-gc --no-concurrent-recompilation --min-semi-space-size=4 --max-semi-space-size=4
//     benchmark/kernel-lane.mjs
// DETERMINISTIC (byte and GC COUNTS, never a timing): no quiet-lock needed.
//
// What it gates, per lane set (one adapter):
// - lanes: one per op kernel of the adapter HANDLE (benchmark/Adapters.mjs) -- insertAt, removeAt, setMeasure,
//   indexAtSum, sumBefore, cursorWalk16 (cursor seekIndex + 15 next()) -- at n = 2^16 over 1e5 ops per window, 6
//   windows, measured by test/torture-meter.mjs (new-space used delta, MIN over windows 1..5, empty-loop baseline
//   subtracted, a window with a GC discarded; R-G2). A lane is ok iff B/op < 1 (0 B/op). Every measured window is
//   inside the lite-gc-profiler region 'lanes'; checkNoGc gates maxMajor 0 on it. insertAt / removeAt keep n in
//   [2^16, 2^16 + 1e5] with an untimed prep (trim / refill at the end) before each window, outside the measurement.
//   One predicate laneOk (B/op < 1) decides every lane AND ctl.alloc. A lane must also prove work: counters reset
//   before it and read after it (outside the windows), sum of mapped counters + extras > 0; insertAt must end at
//   length n + ops and removeAt at n.
// - retention: 1000 cycles of create -> fill 1024 -> clear() -> refill -> clear(); each SumSequence view is tracked by
//   @zakkster/lite-leak and untracked only when it is back to the constructed state (length 0, cursor invalid).
//   Gate: tracker.size() === 0 after gc + settle, every view COLLECTED (a WeakRef per view, deref() undefined), no view
//   finalized while still tracked, no leak / finding / warning.
// - controls (must FAIL their gate, else this file exits 1): ctl.alloc (one fresh object per op) must read > 8 B/op
//   and so fail the lane gate; ctl.retain (10 cycles whose clear() is skipped, the views kept) must leave size() >= 1.
// Exit 0 only if every lane is ok, the GC region holds maxMajor 0, retention is clean AND both controls FAIL.
//
// Rival lanes (BA-7, A1-1): group 2a B3 appends entries to RIVAL_LANES below -- { adapter, n, ops }, the adapter
// built with rivalAdapter() from benchmark/Adapters.mjs (BlockedArray, FenwickRebuild). Each entry gets the same
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
import { SumSequenceAdapter } from './Adapters.mjs';

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

/** Rival lane sets, appended by group 2a B3 (BA-7): { adapter, n, ops }. Empty in group 1. */
export const RIVAL_LANES = [];

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

// Returns nothing: no frame of the caller may hold the last view (a retained view goes into kept only).
function cycle(tracker, onFin, K, adapter, retain, tag, refs, kept) {
  const h = adapter.create(FILL, 1);
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
  return { size, alive, fin: K[K_FIN], state: K[K_STATE], leaks, warns, findings, held };
}

// ---- main ---------------------------------------------------------------------------------------------------------
const rows = [];

const ret = await retention(SumSequenceAdapter, CYCLES, false);
const retOk = ret.size === 0 && ret.alive === 0 && ret.fin === 0 && ret.state === 0 && ret.leaks.length === 0 &&
  ret.findings.length === 0 && ret.warns.length === 0;
console.log('retention: cycles=' + CYCLES + ' size=' + ret.size + '/0 alive=' + ret.alive + '/0 finalized-tracked=' + ret.fin + '/0 notReset=' +
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
const ok = lanesOk && gcOk && coverOk && retOk && ctlAOk && ctlROk;
console.log('GATE kernel-lane lanes=' + rows.filter((r) => r.kind === 'lane').length + ' worst=' +
  (Number.isFinite(worst) ? worst.toFixed(3) : String(worst)) + ' B/op | gc major=' + (lg ? lg.major : 'n/a') +
  ' minor=' + (lg ? lg.minor : 'n/a') + ' maxMs=' + (lg ? lg.maxMs.toFixed(2) : 'n/a') + ' windows=' + G[0] + '/' +
  laneWindows + ' | leak=size ' + ret.size + '/0 alive=' + ret.alive + '/0 | ctl.alloc ' + (ctlAOk ? 'FAIL(required)' : 'PASSED(bad)') +
  ' ctl.retain ' + (ctlROk ? 'FAIL(required)' : 'PASSED(bad)') + ' | ' + (ok ? 'ok' : 'FAIL'));
if (!gcOk) for (const v of rep.violations || []) console.log('  violation ' + v.metric + ' limit=' + v.limit + ' actual=' + v.actual);
process.exitCode = ok ? 0 : 1;
