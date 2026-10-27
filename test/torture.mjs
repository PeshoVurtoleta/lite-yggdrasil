// test/torture.mjs -- the G2 torture entry (ADR 0005 C-38, C-39; PLAN-G2 TASKS 5, 6). Run:
//   node --expose-gc --min-semi-space-size=4 --max-semi-space-size=4 --no-concurrent-recompilation test/torture.mjs
//     [retention|alloc|jit]
// No phase argument = retention, then alloc, then jit. DETERMINISTIC and untimed: wall time is never gated.
// NOT a *.test file, so `node --test test/*.test.mjs` does not load it.
//
// Phases:
// - retention (C-39): 1000 cycles of SumSequence.arena(1e3, {dims: 2}, 3). Per cycle 1e3 inserts with 100 caught
//   rejects (each checked for its RangeError token and as a no-op), a cursor walk on every view, splitAt / append,
//   a finger re-home and a cursor seek, then clear() on every view. Every view is tracked by @zakkster/lite-leak and
//   untracked ONLY when it is back to its constructed state (_root EMPTY_ROOT, length 0, finger NIL / 0 / 0,
//   cursor valid false). Gate: tracker.size() === 0 after gc + settle, no view finalized while still tracked, header
//   live / lbump / ibump 0 (lfree / ifree END) after every cycle, 100000 rejects caught with the expected token.
//   Must fail (MF-5, C-35 wrapper): a clear() that keeps the finger, 10 cycles -> size() >= 1.
//   F-6 (0005 A15-8): arena(64, {dims: 2}, 8), keep 1 view, the 7 others behind WeakRefs, gc() twice with a tick
//   between -> all 7 cleared. Control: a strong ref parked on the kept view's _ar keeps >= 1 alive.
// - alloc (C-38, C-13): test/torture-alloc.mjs runAlloc({ gate }) inside a GcProfiler window (no gc() inside it),
//   then settle(), summary(), checkNoGc({ perRegion: { engine: { maxMajor: 0 } } }). The gate opens the profiler
//   region 'engine' around EVERY measured window of every engine lane (the C-38 Smi and C-13 big lanes) and never
//   around setup (arena builds, prep refills, meter warm-up) or the controls that allocate on purpose (oneBox /
//   twoBox / child controls), PLAN-G2 TASK 5. Coverage is checked: gate enters === the summed windows of the gated
//   lane rows, and every lane row is gated. The whole-window major / minor are REPORTED: after the retention
//   phase V8's idle-time memory reducer (perf_hooks flags 64) may run one major during settle(), after runAlloc
//   returns (.handoff/evidence/g2/b1-r2/diag.log, 3 runs). A settle that did not drain, an inconclusive verdict,
//   a coverage mismatch or any row with ok !== true is a FAIL. maxPauseMs is REPORTED (R-E2) and gates nothing.
//   phaseAlloc({ teeth: true }) (exported) adds torture-alloc's teeth.major lane inside the gate: it forces a
//   major, so the gate MUST fail (.handoff/evidence/g2/b1-r2/teeth.mjs).
// - jit (C-4 A11-2): test/torture-jit.mjs runJit(), 5 rows, every row ok.
// torture-alloc.mjs / torture-jit.mjs are imported DYNAMICALLY inside their branches (OA-1), so `retention` runs on
// its own. No @zakkster/lite-signal import and no createRoot / effect wrapper (R-G1); lite-leak loads it as a peer.
//
// Flags (fail closed): process.execArgv must hold --expose-gc, --min-semi-space-size=4, --max-semi-space-size=4 and
// --no-concurrent-recompilation (R-G5: optimised code installs synchronously, so every alloc lane reads the same code
// tier on every run), else exit 1 naming the missing flag. Exit code: 0 all green, 1 on any FAIL. One GATE line per
// phase.
// The F-6 row is exported (f6Row) so the revert run on the 287d10c1 build (.handoff/evidence/g2/b2/) reuses it;
// importing this file runs nothing.
//
// ASCII-only. MIT (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  createLeakTracker,
  createOwnerCascadeOrphanKernel,
  createListenerOrphanKernel,
  createObserverOrphanKernel,
  createAsyncRetentionKernel,
} from '@zakkster/lite-leak';
import { SumSequence } from '../Yggdrasil.js';

// R-G5: --no-concurrent-recompilation (optimised code installs synchronously)
const FLAGS = ['--expose-gc', '--min-semi-space-size=4', '--max-semi-space-size=4', '--no-concurrent-recompilation'];
const PHASES = ['retention', 'alloc', 'jit'];
const CYCLES = 1000;     // C-39
const MF5_CYCLES = 10;   // the MF-5 control (C-35)
const CAP = 1000;        // arena C (C-39)
const NVIEW = 3;
const REJECTS = 100;     // per cycle: 99 rotating kinds + the capacity reject at full
const EMPTY_ROOT = 0x3FFFFFFF; // _root of an empty view (C-8)
const NIL = 0;           // empty finger (C-1)
const END = -1;          // free-list END (C-44)
const TAGS = ['view-0', 'view-1', 'view-2']; // primitive tags: none closes over a view

const tick = (ms) => new Promise((r) => setTimeout(r, ms));
async function gcSettle() {
  // A WeakRef / FinalizationRegistry target stays alive through the job that created it, and finalization callbacks
  // run as later tasks: two gc() calls with a tick after each.
  globalThis.gc();
  await tick(20);
  globalThis.gc();
  await tick(20);
}

// ---- retention (C-39) ------------------------------------------------------------------------------------------

// Counter slots of one retention run (an Int32Array; the lite-leak cleanup bumps K_FIN and closes over nothing else).
const K_FIN = 0;      // views finalized while still tracked (never returned to the constructed state)
const K_REJ = 1;      // rejects caught with the expected token, as a no-op
const K_REJBAD = 2;   // a reject that did not throw, threw the wrong token, or changed length / live
const K_WALK = 3;     // a cursor walk whose step count != length, or that ended valid
const K_PRE = 4;      // a non-empty view whose finger was NIL or cursor invalid right before clear() (MF-5 precondition)
const K_STATE = 5;    // a view not back to its constructed state after clear() (left tracked)
const K_HDR = 6;      // a cycle whose header was not [0, 0, END, 0, END] after every clear()
const K_LEN = 7;      // a cycle whose lengths after splitAt / append did not sum to live
const K_N = 8;

// xorshift32 in an Int32Array slot (deterministic insert positions).
const RS = new Int32Array(1);
function rnd(n) {
  let x = RS[0];
  x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
  RS[0] = x;
  return (x >>> 0) % n;
}

// The 9 rotating reject kinds: [token, call]. Each is a C-10 check of insertAt, fired before the first state write.
const REJ_KINDS = [
  ['index', (v) => v.insertAt(v.length + 1, 0, 1, 1)],
  ['index', (v) => v.insertAt(-1, 0, 1, 1)],
  ['index', (v) => v.insertAt('0', 0, 1, 1)],
  ['entity', (v) => v.insertAt(0, 0x40000000, 1, 1)],
  ['measure', (v) => v.insertAt(0, 0, -1, 1)],
  ['measure', (v) => v.insertAt(0, 0, 1.5, 1)],
  ['measure', (v) => v.insertAt(0, 0, 1, 'x')],
  ['extra', (v) => v.insertAt(0, 0, 1, 1, 0)],
  ['headroom', (v) => v.insertAt(0, 0, 9007199254740991, 1)], // total(0) > 0 at every reject slot
];

function reject(K, v, tok, call) {
  const n0 = v.length;
  const live0 = v._hdr[0];
  try {
    call(v);
  } catch (e) {
    if (e instanceof RangeError && e.message.startsWith(tok + ' ') && v.length === n0 && v._hdr[0] === live0) {
      K[K_REJ]++;
      return;
    }
  }
  K[K_REJBAD]++;
}

// The C-35 RF-3 wrapper MF-5: the real clear(), then the view's own finger fields restored (no source patch).
function clearKeepFinger(v) {
  const fl = v._fl;
  const fb = v._fb;
  const fd = v._fdepth;
  v.clear();
  v._fl = fl;
  v._fb = fb;
  v._fdepth = fd;
}

function constructed(v) {
  return v._root === EMPTY_ROOT && v._len === 0 && v.length === 0 && v._fl === NIL && v._fb === 0 &&
    v._fdepth === 0 && v.cursor().valid === false;
}

// One C-39 cycle. Returns the views so the caller can hold the LAST cycle's views across the final check: a view
// still reachable and never untracked is counted by size() (the MF-5 teeth), a dropped one by K_FIN.
function cycle(tracker, onFin, K, mf5) {
  const views = SumSequence.arena(CAP, { dims: 2 }, NVIEW);
  const handles = [null, null, null];
  for (let j = 0; j < NVIEW; j++) handles[j] = tracker.track(views[j], onFin, TAGS[j]);
  // 1e3 inserts, round robin over the views at a random position; a reject after every 10th insert (99 of them,
  // rotating kinds), then the 100th: the capacity reject on the full arena.
  let r = 0;
  for (let k = 0; k < CAP; k++) {
    const v = views[k % NVIEW];
    v.insertAt(rnd(v.length + 1), k, k + 1, (k * 7) & 1023);
    if (k % 10 === 9 && r < REJECTS - 1) {
      const kind = REJ_KINDS[r % REJ_KINDS.length];
      reject(K, views[r % NVIEW], kind[0], kind[1]);
      r++;
    }
  }
  reject(K, views[r % NVIEW], 'capacity', (v) => v.insertAt(0, 0, 1, 1));
  // cursor walk: seekIndex(0), next() to the end; steps === length and the cursor ends invalid
  for (let j = 0; j < NVIEW; j++) {
    const v = views[j];
    const cur = v.cursor();
    let steps = 0;
    if (cur.seekIndex(0)) {
      steps = 1;
      while (cur.next()) steps++;
    }
    if (steps !== v.length || cur.valid) K[K_WALK]++;
  }
  // splitAt / append: v2 := v2 ++ v1 (v1 empty), v0 := v0[0, mid), v1 := v0's tail
  const a = views[0];
  const b = views[1];
  const c = views[2];
  c.append(b);
  a.splitAt(a.length >>> 1, b);
  if (a.length + b.length + c.length !== a._hdr[0] || b.length === 0 || c.length === 0) K[K_LEN]++;
  // re-home every finger (a positional op) and seek every cursor, so clear() has a finger and a valid bit to reset
  for (let j = 0; j < NVIEW; j++) {
    const v = views[j];
    if (v.length === 0) continue;
    v.entityAt(v.length - 1);
    v.cursor().seekIndex(0);
    if (v._fl === NIL || !v.cursor().valid) K[K_PRE]++;
  }
  for (let j = 0; j < NVIEW; j++) {
    if (mf5) clearKeepFinger(views[j]);
    else views[j].clear();
  }
  const hdr = a._hdr;
  if (hdr[0] !== 0 || hdr[1] !== 0 || hdr[2] !== END || hdr[3] !== 0 || hdr[4] !== END) K[K_HDR]++;
  for (let j = 0; j < NVIEW; j++) {
    if (constructed(views[j])) tracker.untrack(handles[j]);
    else K[K_STATE]++;
  }
  return views;
}

async function runRetention(cycles, mf5) {
  const K = new Int32Array(K_N);
  const leaks = [];
  const warns = [];
  const tracker = createLeakTracker({
    name: mf5 ? 'yg-torture-mf5' : 'yg-torture',
    onLeak: (rep) => leaks.push(rep.kind + ':' + String(rep.tag)),
    onWarning: (w) => warns.push(w.kind + ':' + w.reason),
  });
  // No timer-orphan kernel: Yggdrasil arms no timer, and with no lite-signal owner (R-G1) that kernel flags only
  // this harness's own settle ticks (measured 2026-10-27: 2 x timer-orphan:no-owner-set). warnings gates at 0.
  const kernels = [
    createOwnerCascadeOrphanKernel(), createListenerOrphanKernel(), createObserverOrphanKernel(),
    createAsyncRetentionKernel(),
  ];
  const unreg = [];
  for (const k of kernels) unreg.push(tracker.registerKernel(k));
  const onFin = () => { K[K_FIN]++; }; // closes over K only, never over a view
  RS[0] = 0x2545F491;
  const hold = { views: null };
  for (let i = 0; i < cycles; i++) hold.views = cycle(tracker, onFin, K, mf5);
  await gcSettle();
  const size = tracker.size();
  const findings = tracker.audit();
  const held = hold.views.length; // the last cycle's views stay reachable until here
  hold.views = null;
  for (const u of unreg) u();
  return { K, size, findings, leaks, warns, held, cycles };
}

// ---- F-6 (0005 A15-8): the arena record holds no view ----------------------------------------------------------

function f6Build(Seq, control) {
  const vs = Seq.arena(64, { dims: 2 }, 8);
  for (let j = 0; j < 8; j++) vs[j].insertAt(0, j, j + 1, 1);
  const refs = [];
  for (let j = 1; j < 8; j++) refs.push(new WeakRef(vs[j]));
  if (control) vs[0]._ar.views = vs; // the control: a strong ref via _ar (what 287d10c1's ar.views was)
  return { keep: vs[0], refs };
}

// Returns { alive, dropped: 7, keptLen } after gc() twice with a tick between. Built in its own frame, so no local
// of this function holds the arena array.
export async function f6Row(Seq, control) {
  const r = f6Build(Seq, control);
  await gcSettle();
  let alive = 0;
  for (let j = 0; j < r.refs.length; j++) if (r.refs[j].deref() !== undefined) alive++;
  const keptLen = r.keep.length; // the kept view is live through the whole row
  if (control) delete r.keep._ar.views;
  return { alive, dropped: r.refs.length, keptLen };
}

async function phaseRetention() {
  const m = await runRetention(CYCLES, false);
  const K = m.K;
  const want = CYCLES * REJECTS;
  const okMain = m.size === 0 && K[K_FIN] === 0 && m.leaks.length === 0 && m.findings.length === 0 &&
    m.warns.length === 0 &&
    K[K_REJ] === want && K[K_REJBAD] === 0 && K[K_WALK] === 0 && K[K_PRE] === 0 && K[K_STATE] === 0 &&
    K[K_HDR] === 0 && K[K_LEN] === 0 && m.held === NVIEW;
  console.log('retention C-39: cycles=' + CYCLES + ' size=' + m.size + '/0 finalized-tracked=' + K[K_FIN] +
    '/0 leaks=' + m.leaks.length + ' rejects=' + K[K_REJ] + '/' + want + ' rejectBad=' + K[K_REJBAD] +
    ' walkBad=' + K[K_WALK] + ' preBad=' + K[K_PRE] + ' stateBad=' + K[K_STATE] + ' hdrBad=' + K[K_HDR] +
    ' lenBad=' + K[K_LEN] + ' | ' + (okMain ? 'ok' : 'FAIL'));
  for (const f of m.findings) console.error('  finding ' + f.kind + ':' + String(f.reason));
  for (const l of m.leaks.slice(0, 10)) console.error('  leak ' + l);
  for (const w of m.warns) console.log('  warning ' + w);

  const c = await runRetention(MF5_CYCLES, true);
  // teeth: the gate above must FAIL on this run (size >= 1), and the reason must be the kept finger
  const teethMf5 = c.size >= 1 && c.K[K_STATE] === MF5_CYCLES * NVIEW && c.K[K_PRE] === 0 && c.K[K_FIN] >= 1 && c.leaks.length >= 1;
  console.log('control MF-5 (C-35, clear keeps the finger): cycles=' + MF5_CYCLES + ' size=' + c.size +
    ' (must be >= 1) stateBad=' + c.K[K_STATE] + ' finalized-tracked=' + c.K[K_FIN] + ' leaks=' + c.leaks.length +
    ' | ' + (teethMf5 ? 'fails as expected' : 'FAIL (no teeth)'));

  const f = await f6Row(SumSequence, false);
  const okF6 = f.alive === 0 && f.dropped === 7 && f.keptLen === 1;
  console.log('F-6: dropped views alive=' + f.alive + '/' + f.dropped + ' (must be 0) | ' + (okF6 ? 'ok' : 'FAIL'));
  const fc = await f6Row(SumSequence, true);
  const teethF6 = fc.alive >= 1;
  console.log('control F-6 (strong ref via _ar): alive=' + fc.alive + '/' + fc.dropped + ' (must be >= 1) | ' +
    (teethF6 ? 'fails as expected' : 'FAIL (no teeth)'));

  const ok = okMain && teethMf5 && okF6 && teethF6;
  console.log('GATE retention leak=size ' + m.size + '/0 findings=' + m.findings.length + ' warnings=' +
    m.warns.length + ' finalized=' + K[K_FIN] + ' rejects=' + K[K_REJ] + '/' + want + ' | F-6 alive=' + f.alive +
    '/7 | controls MF-5 size=' + c.size + ' F-6 alive=' + fc.alive + ' | ' + (ok ? 'ok' : 'FAIL'));
  return ok;
}

// ---- alloc (C-38, C-13) ----------------------------------------------------------------------------------------

export async function phaseAlloc(opts) {
  const teeth = opts !== undefined && opts !== null && opts.teeth === true;
  let mod;
  try {
    mod = await import('./torture-alloc.mjs');
  } catch (e) {
    console.log('GATE alloc FAIL: cannot import ./torture-alloc.mjs: ' + String(e && e.message));
    return false;
  }
  if (typeof mod.runAlloc !== 'function') {
    console.log('GATE alloc FAIL: ./torture-alloc.mjs exports no runAlloc()');
    return false;
  }
  const { GcProfiler, checkNoGc } = await import('@zakkster/lite-gc-profiler');
  // Collect the retention phase's garbage BEFORE the window and let its GC entries drain, so no forced or
  // pressure collection lands inside it. No gc() runs inside the window.
  await gcSettle();
  await tick(20);
  const prof = new GcProfiler();
  prof.start();
  const G = new Int32Array(2); // [0] enters, [1] exits of the 'engine' region
  const gate = {
    enter: () => { G[0]++; prof.enter('engine'); },
    exit: () => { G[1]++; prof.exit(); },
  };
  let res = null;
  let err = null;
  try {
    res = await mod.runAlloc(teeth ? { gate, teeth: true } : { gate });
  } catch (e) {
    err = e;
  }
  const st = await prof.settle();
  const s = prof.summary();
  prof.stop();
  const rep = checkNoGc(s, { perRegion: { engine: { maxMajor: 0 } } });
  const eg = s.byRegion && s.byRegion.engine ? s.byRegion.engine.gc : null;
  let gatedWindows = 0;
  let ungatedLanes = 0;
  let rowsOk = err === null && res !== null && typeof res === 'object' && res.ok === true &&
    Array.isArray(res.rows) && res.rows.length > 0;
  let lanes = 0;
  let controls = 0;
  let worst = -Infinity;
  if (res !== null && typeof res === 'object' && Array.isArray(res.rows)) {
    for (const row of res.rows) {
      const good = row !== null && typeof row === 'object' && row.ok === true &&
        (row.kind === 'lane' || row.kind === 'control');
      if (!good) rowsOk = false;
      if (row && row.gated === true) gatedWindows += row.windows;
      if (row && row.kind === 'lane') {
        lanes++;
        if (row.gated !== true) ungatedLanes++;
        // a NaN (every window discarded) or non-number bop poisons the worst cell: FAIL, never skipped
        if (typeof row.bop !== 'number' || Number.isNaN(row.bop)) worst = NaN;
        else if (!Number.isNaN(worst)) worst = Math.max(worst, row.bop);
      } else if (row && row.kind === 'control') {
        controls++;
      }
      console.log('  ' + String(row && row.kind) + ' ' + String(row && row.name) + ' bop=' +
        String(row && row.bop) + ' bound=' + String(row && row.bound) + ' | ' + (good ? 'ok' : 'FAIL'));
    }
  }
  if (lanes === 0 || controls === 0 || Number.isNaN(worst)) rowsOk = false;
  if (err !== null) console.error('  runAlloc threw: ' + String(err && err.stack));
  const covered = eg !== null && G[0] === G[1] && G[0] === gatedWindows && G[0] > 0 && ungatedLanes === 0;
  const gcOk = st.drained === true && rep.verdict === 'pass' && rep.ok === true && s.gc.observed !== false && covered;
  for (const v of rep.violations) console.error('  violation ' + v.metric + ' limit=' + v.limit + ' actual=' + v.actual);
  const ok = rowsOk && gcOk;
  console.log('GATE alloc gc major=' + (eg ? eg.major : 'NaN') + ' minor=' + (eg ? eg.minor : 'NaN') + ' maxMs=' +
    (eg ? eg.maxMs.toFixed(2) : 'NaN') + ' (engine windows=' + G[0] + '/' + gatedWindows + ', maxMs REPORTED R-E2)' +
    ' whole-window major=' + s.gc.major + ' minor=' + s.gc.minor + ' maxMs=' + s.gc.maxMs.toFixed(2) + ' (REPORTED)' +
    ' drained=' + st.drained + ' verdict=' + rep.verdict + ' | alloc=' + String(worst) +
    ' B/op (worst lane) lanes=' + lanes + ' controls=' + controls + ' | ' + (ok ? 'ok' : 'FAIL'));
  return ok;
}

// ---- jit (C-4 A11-2) -------------------------------------------------------------------------------------------

async function phaseJit() {
  let mod;
  try {
    mod = await import('./torture-jit.mjs');
  } catch (e) {
    console.log('GATE jit FAIL: cannot import ./torture-jit.mjs: ' + String(e && e.message));
    return false;
  }
  if (typeof mod.runJit !== 'function') {
    console.log('GATE jit FAIL: ./torture-jit.mjs exports no runJit()');
    return false;
  }
  let res = null;
  let err = null;
  try {
    res = await mod.runJit();
  } catch (e) {
    err = e;
  }
  let ok = err === null && res !== null && typeof res === 'object' && res.ok === true && Array.isArray(res.rows) &&
    res.rows.length === 5;
  let nLive = 0;
  let nDropped = 0;
  if (res !== null && typeof res === 'object' && Array.isArray(res.rows)) {
    for (const row of res.rows) {
      const good = row !== null && typeof row === 'object' && row.ok === true;
      if (!good) ok = false;
      if (row && row.live) nLive++;
      if (row && row.dropped) nDropped++;
      console.log('  ' + String(row && row.fn) + ' live=' + String(row && row.live) + ' dropped=' +
        String(row && row.dropped) + ' | ' + (good ? 'ok' : 'FAIL'));
    }
  }
  if (err !== null) console.error('  runJit threw: ' + String(err && err.stack));
  console.log('GATE jit nil-guard live=' + nLive + '/5 nilDropped=' + nDropped + '/5 | ' + (ok ? 'ok' : 'FAIL'));
  return ok;
}

// ---- main ------------------------------------------------------------------------------------------------------

async function main() {
  for (const f of FLAGS) {
    if (!process.execArgv.includes(f)) {
      console.error('torture: missing node flag ' + f + ' (run: node ' + FLAGS.join(' ') + ' test/torture.mjs)');
      process.exit(1);
    }
  }
  if (typeof globalThis.gc !== 'function') {
    console.error('torture: globalThis.gc is not a function (--expose-gc did not take effect)');
    process.exit(1);
  }
  const args = process.argv.slice(2);
  if (args.length > 1 || (args.length === 1 && !PHASES.includes(args[0]))) {
    console.error('torture: usage: test/torture.mjs [' + PHASES.join('|') + '], got ' + JSON.stringify(args));
    process.exit(1);
  }
  const run = args.length === 1 ? [args[0]] : PHASES;
  let ok = true;
  for (const p of run) {
    const r = p === 'retention' ? await phaseRetention() : p === 'alloc' ? await phaseAlloc() : await phaseJit();
    if (!r) ok = false;
  }
  if (!ok) process.exitCode = 1;
}

if (process.argv[1] !== undefined && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  await main();
}
