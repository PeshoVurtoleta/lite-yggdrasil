// test/torture-meter.mjs -- the steady-state allocation meter of the G2 torture family (PLAN-G2 TASK 1; ADR 0005
// C-13, C-38; maintainer ruling R-G2). Test harness only, never shipped. Imported by test/torture-alloc.mjs.
//
//   lane(name, step, ops, windows, prep?, gate?) -> { name, ops, windows, delta, gcs, min, gated }
//     Runs `windows` windows of `ops` calls step(k), k = 0..ops-1, through ONE shared driver loop (drive below), so
//     every lane pays the same loop and the same megamorphic call. Per window: the V8 new-space used-size delta
//     (bytes) and the GC event count of that window (v8.GCProfiler, synchronous, so no settle tick is needed).
//     A window with a GC event, or whose used size went DOWN (a collection the profiler missed), is discarded
//     (gcs[w] > 0). min = the MINIMUM delta over windows 1..n-1 that were not discarded, NaN when every one of them
//     was (R-G2: such a lane FAILs). Window 0 often runs Maglev / interpreter code, which does not inline and boxes;
//     it is recorded and printed, never gated. prep(w), when given, runs before window w OUTSIDE the measurement
//     (a cold refill), so its garbage is never counted. gate, when given, is { enter(name), exit() } (test/torture.mjs
//     passes a lite-gc-profiler region): enter() runs before the window's GCProfiler start and first heap read,
//     exit() after the last read and the stop, so the region interval strictly CONTAINS every measured window and
//     never covers prep or setup. The caller's maxMajor 0 rule on that region is the C-38 / C-13 GC gate.
//   setTrace(fn | null): diagnostic only; fn('win', name, w, t0, t1) per window (performance.now() times, cold).
//   bop(res, base) -> (res.min - base.min) / res.ops: the gated B/op, the empty-loop baseline subtracted (R-G2).
//     base must be an `empty` lane at the same ops (baseline below). NaN in either -> NaN (fail closed).
//   baseline(ops, windows) -> the `empty` lane: step does nothing, so its min is the meter's own fixed cost (the
//     heap-statistics objects of one read, the profiler start / stop). Run twice, keeping the LOWER min (the
//     conservative pick: a lower baseline reads a lane higher). See DRIVE_WARM for why drive is warmed first.
//   winText(res, base) -> the per-window B/op cells, 'gc' for a discarded window, window 0 bracketed.
//   semiSpaceOk() -> true iff process.execArgv pins BOTH --min-semi-space-size=4 and --max-semi-space-size=4
//     (without the min flag new space grows and the scale drifts; the callers fail closed on false).
//
// Harness rules (torture-harness law): the meter never calls gc() and never starts a lite-gc-profiler GcProfiler
// (test/torture.mjs wraps the alloc phase in one and gates maxMajor 0 over it). Per-window results live in
// typed-array slots; the driver loop holds only the Smi k. ASCII-only. MIT (c) 2026 Zahary Shinikchiev
// <shinikchiev@yahoo.com>

import v8 from 'node:v8';

const SPACES = v8.getHeapSpaceStatistics();
let NEW = -1;
for (let s = 0; s < SPACES.length; s++) if (SPACES[s].space_name === 'new_space') NEW = s;
if (NEW < 0) throw new Error('torture-meter: no new_space in v8.getHeapSpaceStatistics()');

// One read of the new-space used size. Allocates the statistics objects (a constant per read, which the empty
// baseline subtracts); the value itself is < 2^31 at a 4 MB semi-space, a Smi.
function newUsed() {
  return v8.getHeapSpaceStatistics()[NEW].space_used_size;
}

// The ONE driver loop every lane goes through (never specialised per lane).
function drive(step, ops) {
  for (let k = 0; k < ops; k++) step(k);
}

// DRIVE_WARM (cold, module init, run at the end of this file): six distinct function literals through drive, so its
// one call site is megamorphic before any lane runs and the empty baseline pays the same call as every lane, then
// 48 throwaway meter windows, so lane() / the heap read have tiered up. Measured 2026-10-27, node v26.8.2, without
// the meter windows: the first ~12 windows of a process cost 2872 B of meter overhead, every later one 1832 B, so a
// 0 B/op lane read -0.010 B/op at 1e5 ops. Distinct literals, not closures of one literal: closures sharing a
// SharedFunctionInfo keep the call site inlinable.
const WARM = new Int32Array(6);
const DRIVE_WARM = [
  (k) => { WARM[0] = k; }, (k) => { WARM[1] = k; }, (k) => { WARM[2] = k; },
  (k) => { WARM[3] = k; }, (k) => { WARM[4] = k; }, (k) => { WARM[5] = k; },
];

export function semiSpaceOk() {
  const a = process.execArgv;
  return a.includes('--min-semi-space-size=4') && a.includes('--max-semi-space-size=4');
}

let TRACE = null;

export function setTrace(fn) {
  TRACE = typeof fn === 'function' ? fn : null;
}

export function lane(name, step, ops, windows, prep, gate) {
  if (typeof step !== 'function') throw new TypeError('torture-meter: step must be a function');
  if (!Number.isInteger(ops) || ops < 1) throw new TypeError('torture-meter: ops must be an integer >= 1');
  if (!Number.isInteger(windows) || windows < 2) throw new TypeError('torture-meter: windows must be >= 2');
  if (gate !== undefined && (gate === null || typeof gate.enter !== 'function' || typeof gate.exit !== 'function')) {
    throw new TypeError('torture-meter: gate must be { enter(name), exit() }');
  }
  const delta = new Float64Array(windows);
  const gcs = new Int32Array(windows);
  for (let w = 0; w < windows; w++) {
    if (prep !== undefined) prep(w);
    const prof = new v8.GCProfiler();
    if (gate !== undefined) gate.enter(name);
    const t0 = TRACE === null ? 0 : performance.now();
    prof.start();
    const a = newUsed();
    drive(step, ops);
    const b = newUsed();
    const st = prof.stop();
    if (TRACE !== null) TRACE('win', name, w, t0, performance.now());
    if (gate !== undefined) gate.exit();
    delta[w] = b - a;
    gcs[w] = st.statistics.length + (b < a ? 1 : 0);
  }
  let min = NaN;
  for (let w = 1; w < windows; w++) {
    if (gcs[w] === 0 && !(delta[w] >= min)) min = delta[w];
  }
  return { name, ops, windows, delta, gcs, min, gated: gate !== undefined };
}

export function baseline(ops, windows) {
  const a = lane('empty', () => {}, ops, windows);
  const b = lane('empty', () => {}, ops, windows);
  return b.min < a.min || Number.isNaN(a.min) ? b : a;
}

export function bop(res, base) {
  return (res.min - base.min) / res.ops;
}

export function winText(res, base) {
  const out = [];
  for (let w = 0; w < res.windows; w++) {
    const c = res.gcs[w] > 0 ? 'gc' : ((res.delta[w] - base.min) / res.ops).toFixed(3);
    out.push(w === 0 ? '[' + c + ']' : c);
  }
  return out.join(' ');
}

for (let r = 0; r < 4; r++) for (let s = 0; s < DRIVE_WARM.length; s++) drive(DRIVE_WARM[s], 2000);
for (let r = 0; r < 8; r++) lane('warm', DRIVE_WARM[r % 6], 1000, 6);
