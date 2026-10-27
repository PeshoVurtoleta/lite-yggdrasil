// test/torture-alloc.mjs -- the G2 allocation lanes and their controls (PLAN-G2 TASKS 0c, 2-4; ADR 0005 C-13, C-38;
// maintainer rulings R-G2, R-G3). Test harness only, never shipped.
//
//   runAlloc(opts?) -> Promise<{ ok, rows }>, row { name, kind: 'lane' | 'control', bop, bound, ok, ... } (OA-1).
//     opts (plain object, every key optional): gate { enter(name), exit() } wraps EVERY measured window of every
//     ENGINE lane (sections 1 and 2), never a baseline, a fixture build, a prep refill or a control (test/torture.mjs
//     passes a lite-gc-profiler region and gates maxMajor 0 on it); teeth: true adds the must-fail lane teeth.major
//     INSIDE the gate (it forces a major GC, so the caller's gate must FAIL; its row is ok, it gates nothing itself);
//     trace(kind, name, w, t0, t1): diagnostic only (windows, children, section marks; default
//     globalThis.__ygAllocTrace).
//     bop = the gated B/op (test/torture-meter.mjs: MIN over windows 1..n-1 minus the empty-loop baseline), NaN when
//     every gated window saw a GC (then ok is false for a lane AND a control: fail closed). Never calls gc(), never
//     starts a GcProfiler: test/torture.mjs wraps this call in one and gates maxMajor 0 over it.
//   Standalone: node --expose-gc --min-semi-space-size=4 --max-semi-space-size=4 test/torture-alloc.mjs
//     prints one line per row and a GATE line; exit 1 on any FAIL, and before running anything when a flag is
//     missing (the line names it). `--child <name>` is the internal mode of the mutant controls (one row as
//     `ROW <json>`); `--child rest` is the R-G3 rest-parameter probe, REPORTED, never part of runAlloc.
//
// Sections:
// (1) Smi lanes (C-38): seekIndex / seekSum + 50x next(), getMeasure, entityAt, the dims = 4 positional insertAt +
//     removeAt pair (it also gates ygSlots, called by-args at dims > 1); 6 windows x 1e5 ops; ok iff bop < 1 (R-G2).
// (2) Big lanes (C-13): measures in [2^30, 2^40], live 4096, y in [2^30, live * 2^30) with a .5 fraction; 8 windows
//     x 2^14 ops; ok iff bop <= 16 b + 1. b = 1: setMeasure, getMeasure, sumBefore, total, indexAtSum, seekSum,
//     cursor offset(d) / measure(d). b = 0: removeAt, entityAt, next, seekIndex, splitAt + append as a pair.
//     insertAt + removeAt at dims 1..4: b = dims (R-A1, A15-1).
// (3) Controls, ok iff the control behaves as stated (`expect`): oneBox.smi (a fractional double stored into an
//     object-elements array, one HeapNumber per op) MUST fail the Smi gate; oneBox.big MUST pass the b = 1 bound
//     (one box = 16 B <= 17, the bound is not looser than one box); twoBox.big MUST fail it. In children (spawnSync,
//     timeout + SIGKILL): arrayInsert.d4 (buildMutant: insertAt(i, e, ms), the driver passes [m0..m3] per op, R-G3)
//     MUST fail the Smi gate; descent.sumBefore (buildMutant: every descent level returns acc across a helper under
//     %NeverOptimizeFunction, --allow-natives-syntax in that child only) MUST fail the b = 1 bound (C-13 must-fail).
//
// Orchestrator / coder readings (NOT maintainer rulings):
// - big removeAt runs on its own dims = 1 arena of 2^14 live with measures in [2^30, 2^38] (2^14 * 2^38 = 2^52),
//   refilled before every window outside the measurement (prep), since 2^14 removes cannot come out of 4096 live.
// - arrayInsert.d4 runs 8 windows x 2^14 ops: its ~100 B/op over 1e5 ops (~10 MB) overflows the 4 MB semi-space in
//   every window, so every window would be discarded (NaN, a fail-closed FAIL with no reading). Same R-G2 gate (< 1).
//
// Driver law (torture-harness): indices and Smi measures live in Int32Array tables, big measures and y in
// Float64Array tables; a double result is stored into OUT (a Float64Array slot), an int / bool result into IOUT,
// never summed into a local. ASCII-only. MIT (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>

import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SumSequence } from '../Yggdrasil.js';
import { buildMutant } from './mutant-build.mjs';
import { lane, baseline, bop, winText, semiSpaceOk, setTrace } from './torture-meter.mjs';

const ENGINE = fileURLToPath(new URL('../Yggdrasil.js', import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const FLAGS = ['--expose-gc', '--min-semi-space-size=4', '--max-semi-space-size=4'];
const CHILD_MS = 180000;

const SMI_OPS = 100000;
const SMI_WIN = 6;
const BIG_OPS = 1 << 14;
const BIG_WIN = 8;
const LIVE = 4096;
const MASK = 4095;
const TWO30 = 1073741824;
const TWO40 = 1099511627776;
const RM_LIVE = 1 << 14;
const TWO38 = 274877906944;

const OUT = new Float64Array(4); // double results land here
const IOUT = new Int32Array(4); // int / bool results land here

// ---- tables (cold, built once per process) ------------------------------------------------------------------------
// LCG over int32 (Math.imul), u in [0, 1). Deterministic: same tables on every run.
const RNG = new Int32Array([0x2545F491]);
function u01() {
  RNG[0] = (Math.imul(RNG[0], 1664525) + 1013904223) | 0;
  return (RNG[0] >>> 0) / 4294967296;
}
const IX = new Int32Array(LIVE); // Smi lanes: index in [0, 3900), so 50 next() stay inside the 4000
const BIX = new Int32Array(LIVE); // big lanes: index in [0, live)
const BM = new Float64Array(LIVE); // big measures, integers in [2^30, 2^40]
const BY = new Float64Array(LIVE); // big y in [2^30, live * 2^30), fraction .5
const RM = new Float64Array(RM_LIVE); // removeAt arena measures, integers in [2^30, 2^38]
const FR = new Float64Array(LIVE); // fractional doubles for the box controls
for (let k = 0; k < LIVE; k++) {
  IX[k] = (k * 7919) % 3900;
  BIX[k] = (k * 7919) % LIVE;
  BM[k] = TWO30 + Math.floor(u01() * (TWO40 - TWO30));
  BY[k] = TWO30 + Math.floor(u01() * (LIVE - 1) * TWO30) + 0.5;
  FR[k] = k + 0.25;
}
for (let k = 0; k < RM_LIVE; k++) RM[k] = TWO30 + Math.floor(u01() * (TWO38 - TWO30));

// ---- fixtures (cold) ----------------------------------------------------------------------------------------------
// Smi view: dims 4, 4000 elements with Smi measures. arr = the array-insert mutant's signature.
function smiView(S, arr) {
  const [v] = S.arena(8192, { leafSize: 16, dims: 4 }, 1);
  for (let j = 0; j < 4000; j++) {
    if (arr) v.insertAt(j, j, [j % 7, j % 3, j % 5, 1]);
    else v.insertAt(j, j, j % 7, j % 3, j % 5, 1);
  }
  return v;
}

// Big views [v, w] at `dims`: v holds `live` elements with measures from BM; w is empty (splitAt's out).
function bigViews(S, dims) {
  const vs = S.arena(8192, { leafSize: 16, dims }, 2);
  const v = vs[0];
  for (let j = 0; j < LIVE; j++) {
    const a = BM[j];
    const b = BM[(j + 1) & MASK];
    const c = BM[(j + 2) & MASK];
    const d = BM[(j + 3) & MASK];
    if (dims === 1) v.insertAt(j, j, a);
    else if (dims === 2) v.insertAt(j, j, a, b);
    else if (dims === 3) v.insertAt(j, j, a, b, c);
    else v.insertAt(j, j, a, b, c, d);
  }
  return vs;
}

// ---- row assembly -------------------------------------------------------------------------------------------------
// spec { name, kind, bound, strict, expect }: strict -> pass iff bop < bound (R-G2), else bop <= bound (C-13).
function mkRow(spec, res, base) {
  const b = bop(res, base);
  const pass = spec.strict ? b < spec.bound : b <= spec.bound; // NaN -> false
  const ok = spec.kind === 'lane' ? pass : !Number.isNaN(b) && pass === spec.expect;
  const w0 = (res.delta[0] - base.min) / res.ops;
  return {
    name: spec.name, kind: spec.kind, bop: b, bound: spec.bound, ok, windows: res.windows, gated: res.gated,
    strict: spec.strict, expect: spec.expect, w0, wins: winText(res, base),
  };
}

function smiSpec(name) {
  return { name, kind: 'lane', bound: 1, strict: true, expect: true };
}
function bigSpec(name, b) {
  return { name, kind: 'lane', bound: 16 * b + 1, strict: false, expect: true };
}
function ctlSpec(name, bound, strict, expect) {
  return { name, kind: 'control', bound, strict, expect };
}

// ---- (1) Smi lanes ------------------------------------------------------------------------------------------------
function smiLanes(rows, gate) {
  const base = baseline(SMI_OPS, SMI_WIN);
  const v = smiView(SumSequence, false);
  const c = v.cursor();
  const T = v.total(0);
  const YS = new Int32Array(LIVE);
  for (let k = 0; k < LIVE; k++) YS[k] = (k * 104729) % (T - 200);
  const run = (name, step) => rows.push(mkRow(smiSpec(name), lane(name, step, SMI_OPS, SMI_WIN, undefined, gate), base));
  run('smi.seekIndex+50next', (k) => {
    c.seekIndex(IX[k & MASK]);
    for (let j = 0; j < 50; j++) c.next();
  });
  run('smi.seekSum+50next', (k) => {
    c.seekSum(0, YS[k & MASK]);
    for (let j = 0; j < 50; j++) c.next();
  });
  run('smi.getMeasure', (k) => { OUT[0] = v.getMeasure(IX[k & MASK], k & 3); });
  run('smi.entityAt', (k) => { IOUT[0] = v.entityAt(IX[k & MASK]); });
  run('smi.insertAt+removeAt.d4', (k) => {
    const i = IX[k & MASK];
    v.insertAt(i, k & 0xFFFF, k & 7, k & 3, 5, 9);
    v.removeAt(i);
  });
}

// ---- (2) big lanes ------------------------------------------------------------------------------------------------
function bigLanes(rows, gate) {
  const base = baseline(BIG_OPS, BIG_WIN);
  const run = (name, b, step, prep) =>
    rows.push(mkRow(bigSpec(name, b), lane(name, step, BIG_OPS, BIG_WIN, prep, gate), base));
  const [v, w] = bigViews(SumSequence, 2);
  const c = v.cursor();
  const seek17 = () => { c.seekIndex(17); };
  const seek0 = () => { c.seekIndex(0); };
  // b = 1
  run('big.setMeasure', 1, (k) => { v.setMeasure(BIX[k & MASK], k & 1, BM[(k + 7) & MASK]); });
  run('big.getMeasure', 1, (k) => { OUT[0] = v.getMeasure(BIX[k & MASK], k & 1); });
  run('big.sumBefore', 1, (k) => { OUT[0] = v.sumBefore(k & 1, BIX[k & MASK]); });
  run('big.total', 1, (k) => { OUT[0] = v.total(k & 1); });
  run('big.indexAtSum', 1, (k) => { IOUT[0] = v.indexAtSum(k & 1, BY[k & MASK]); });
  run('big.seekSum', 1, (k) => { IOUT[0] = c.seekSum(k & 1, BY[k & MASK]) ? 1 : 0; });
  run('big.offset', 1, (k) => { OUT[0] = c.offset(k & 1); }, seek17);
  run('big.measure', 1, (k) => { OUT[0] = c.measure(k & 1); }, seek17);
  // b = 0
  run('big.entityAt', 0, (k) => { IOUT[0] = v.entityAt(BIX[k & MASK]); });
  run('big.seekIndex', 0, (k) => { IOUT[0] = c.seekIndex(BIX[k & MASK]) ? 1 : 0; });
  run('big.next', 0, (k) => { if (!c.next()) c.seekIndex(0); }, seek0);
  run('big.splitAt+append', 0, (k) => {
    v.splitAt(BIX[k & MASK], w);
    v.append(w);
  });
  const [rm] = SumSequence.arena(RM_LIVE + 64, { leafSize: 16, dims: 1 }, 1);
  run('big.removeAt', 0, (k) => { rm.removeAt((k * 7919) % (RM_LIVE - k)); }, () => {
    rm.clear();
    for (let j = 0; j < RM_LIVE; j++) rm.insertAt(j, j, RM[j]);
  });
  // insertAt + removeAt, b = dims
  const [v1] = bigViews(SumSequence, 1);
  run('big.insertAt+removeAt.d1', 1, (k) => {
    const i = BIX[k & MASK];
    v1.insertAt(i, k & 0xFFFF, BM[(k + 11) & MASK]);
    v1.removeAt(i);
  });
  const [v2] = bigViews(SumSequence, 2);
  run('big.insertAt+removeAt.d2', 2, (k) => {
    const i = BIX[k & MASK];
    v2.insertAt(i, k & 0xFFFF, BM[(k + 11) & MASK], BM[(k + 12) & MASK]);
    v2.removeAt(i);
  });
  const [v3] = bigViews(SumSequence, 3);
  run('big.insertAt+removeAt.d3', 3, (k) => {
    const i = BIX[k & MASK];
    v3.insertAt(i, k & 0xFFFF, BM[(k + 11) & MASK], BM[(k + 12) & MASK], BM[(k + 13) & MASK]);
    v3.removeAt(i);
  });
  const [v4] = bigViews(SumSequence, 4);
  run('big.insertAt+removeAt.d4', 4, (k) => {
    const i = BIX[k & MASK];
    v4.insertAt(i, k & 0xFFFF, BM[(k + 11) & MASK], BM[(k + 12) & MASK], BM[(k + 13) & MASK],
      BM[(k + 14) & MASK]);
    v4.removeAt(i);
  });
}

// ---- (3) controls -------------------------------------------------------------------------------------------------
const HOLD = [null, null]; // PACKED_ELEMENTS: a double stored here is a fresh HeapNumber (16 B on Node)

function boxControls(rows) {
  const sb = baseline(SMI_OPS, SMI_WIN);
  const bb = baseline(BIG_OPS, BIG_WIN);
  rows.push(mkRow(ctlSpec('ctl.oneBox.smi', 1, true, false),
    lane('ctl.oneBox.smi', (k) => { HOLD[k & 1] = FR[k & MASK]; }, SMI_OPS, SMI_WIN), sb));
  rows.push(mkRow(ctlSpec('ctl.oneBox.big', 17, false, true),
    lane('ctl.oneBox.big', (k) => { HOLD[k & 1] = FR[k & MASK]; }, BIG_OPS, BIG_WIN), bb));
  rows.push(mkRow(ctlSpec('ctl.twoBox.big', 17, false, false),
    lane('ctl.twoBox.big', (k) => {
      HOLD[0] = FR[k & MASK];
      HOLD[1] = FR[(k + 1) & MASK];
    }, BIG_OPS, BIG_WIN), bb));
}

// teeth.major (must-fail of the caller's GC gate): 512 KB holey arrays (large-object space) in a 64-slot ring,
// 2 windows x 256 ops = 256 MB churned inside the gate; old-generation growth forces a mark-compact without gc().
const TEETH = new Array(64).fill(null);
function teethRow(gate) {
  const res = lane('teeth.major', (k) => { TEETH[k & 63] = new Array(1 << 16); }, 256, 2, undefined, gate);
  TEETH.fill(null);
  return { name: 'teeth.major', kind: 'control', bop: res.delta[1] / res.ops, bound: NaN, ok: true,
    windows: res.windows, gated: res.gated,
    why: 'must-fail of the caller GC gate; gcs per window ' + res.gcs[0] + ',' + res.gcs[1] };
}

const SIG = 'insertAt(i, e, m0, m1, m2, m3) {';
const UNPACK = '\n    const m0 = ms[0], m1 = ms[1], m2 = ms[2], m3 = ms[3];';
const DESCENT = 'acc += l < 0 ? lsum[~l] : sums[l];';
const CLASS = 'export class SumSequence {';
const CHILDREN = {
  // R-G3 gated: the driver allocates [m0..m3] per op.
  'ctl.arrayInsert.d4': {
    natives: false,
    patches: [[SIG, 'insertAt(i, e, ms) {' + UNPACK, 1]],
    run: (S) => {
      const base = baseline(BIG_OPS, BIG_WIN);
      const v = smiView(S, true);
      const res = lane('ctl.arrayInsert.d4', (k) => {
        const i = IX[k & MASK];
        v.insertAt(i, k & 0xFFFF, [k & 7, k & 3, 5, 9]);
        v.removeAt(i);
      }, BIG_OPS, BIG_WIN);
      return mkRow(ctlSpec('ctl.arrayInsert.d4', 1, true, false), res, base);
    },
  },
  // C-13 must-fail: a per-level acc helper the JIT may never optimize, so every level returns acc boxed.
  'ctl.descent.sumBefore': {
    natives: true,
    patches: [
      [DESCENT, 'acc = ygAccAdd(acc, l < 0 ? lsum[~l] : sums[l]);', 1],
      [CLASS, 'function ygAccAdd(a, b) { return a + b; }\n%NeverOptimizeFunction(ygAccAdd);\n' + CLASS, 1],
    ],
    run: (S) => {
      const base = baseline(BIG_OPS, BIG_WIN);
      const [v] = bigViews(S, 2);
      const res = lane('ctl.descent.sumBefore', (k) => { OUT[0] = v.sumBefore(k & 1, BIX[k & MASK]); },
        BIG_OPS, BIG_WIN);
      return mkRow(ctlSpec('ctl.descent.sumBefore', 17, false, false), res, base);
    },
  },
  // R-G3 REPORTED only: insertAt(i, e, ...ms), the driver passes m0..m3 positionally (Smi windows, as C-38).
  rest: {
    natives: false,
    patches: [[SIG, 'insertAt(i, e, ...ms) {' + UNPACK, 1]],
    run: (S) => {
      const base = baseline(SMI_OPS, SMI_WIN);
      const v = smiView(S, false);
      const res = lane('rest.insertAt+removeAt.d4', (k) => {
        const i = IX[k & MASK];
        v.insertAt(i, k & 0xFFFF, k & 7, k & 3, 5, 9);
        v.removeAt(i);
      }, SMI_OPS, SMI_WIN);
      const r = mkRow(ctlSpec('rest.insertAt+removeAt.d4', 1, true, false), res, base);
      r.kind = 'reported';
      r.ok = !Number.isNaN(r.bop);
      return r;
    },
  },
};

async function childMain(name) {
  const ch = CHILDREN[name];
  if (ch === undefined) throw new Error('torture-alloc: unknown child ' + name);
  const m = await buildMutant(ENGINE, ch.patches);
  try {
    const r = ch.run(m.SumSequence);
    r.sigLen = m.SumSequence.prototype.insertAt.length; // 6 live; 3 array mutant; 2 rest mutant (patch applied)
    console.log(rowText(r));
    console.log('ROW ' + JSON.stringify(r, (k, x) => (typeof x === 'number' && Number.isNaN(x) ? 'NaN' : x)));
  } finally {
    m.cleanup();
  }
}

// Spawns one child row; any failure (non-zero exit, timeout -> SIGKILL, no ROW line) is a NaN row, ok false.
export function childRow(name, kind) {
  const ch = CHILDREN[name];
  const args = FLAGS.concat(ch.natives ? ['--allow-natives-syntax'] : [], [SELF, '--child', name]);
  const p = spawnSync(process.execPath, args, { encoding: 'utf8', timeout: CHILD_MS, killSignal: 'SIGKILL' });
  const line = (p.stdout || '').split('\n').find((s) => s.startsWith('ROW '));
  if (p.status === 0 && line !== undefined) {
    const r = JSON.parse(line.slice(4), (k, x) => (x === 'NaN' ? NaN : x));
    return r;
  }
  const why = p.error ? String(p.error.code || p.error) : 'status=' + p.status + ' signal=' + p.signal;
  return { name, kind, bop: NaN, bound: NaN, ok: false, why: why + ' ' + (p.stderr || '').trim().split('\n')[0] };
}

const OPT_KEYS = ['gate', 'teeth', 'trace'];

export async function runAlloc(opts) {
  const o = opts === undefined ? {} : opts;
  if (o === null || typeof o !== 'object' || Array.isArray(o) || Object.getPrototypeOf(o) !== Object.prototype) {
    throw new TypeError('runAlloc: opts must be a plain object');
  }
  for (const k of Object.keys(o)) if (!OPT_KEYS.includes(k)) throw new TypeError('runAlloc: unknown option ' + k);
  const gate = o.gate === undefined ? undefined : o.gate;
  const trace = typeof o.trace === 'function' ? o.trace :
    typeof globalThis.__ygAllocTrace === 'function' ? globalThis.__ygAllocTrace : null;
  setTrace(trace);
  try {
    return await runRows(gate, o.teeth === true, trace);
  } finally {
    setTrace(null);
  }
}

async function runRows(gate, teeth, trace) {
  const mark = (label) => { if (trace !== null) { const t = performance.now(); trace('mark', label, 0, t, t); } };
  const rows = [];
  if (!semiSpaceOk()) {
    rows.push({ name: 'flags', kind: 'lane', bop: NaN, bound: NaN, ok: false,
      why: 'needs --min-semi-space-size=4 --max-semi-space-size=4' });
    return { ok: false, rows };
  }
  mark('smi');
  smiLanes(rows, gate);
  mark('big');
  bigLanes(rows, gate);
  if (teeth) {
    mark('teeth');
    rows.push(teethRow(gate));
  }
  mark('boxControls');
  boxControls(rows);
  for (const nm of ['ctl.arrayInsert.d4', 'ctl.descent.sumBefore']) {
    const t0 = trace === null ? 0 : performance.now();
    rows.push(childRow(nm, 'control'));
    if (trace !== null) trace('child', nm, 0, t0, performance.now());
  }
  mark('end');
  let ok = rows.length > 0;
  for (const r of rows) ok = ok && r.ok === true;
  return { ok, rows };
}

export function rowText(r) {
  const cmp = r.strict ? '<' : '<=';
  const exp = r.kind === 'control' ? ' expect=' + (r.expect ? 'pass' : 'FAIL') : r.kind === 'reported' ? ' REPORTED' : '';
  return r.kind.padEnd(8) + ' ' + r.name.padEnd(26) + ' bop=' + (Number.isNaN(r.bop) ? 'NaN' : r.bop.toFixed(3)) +
    ' bound' + cmp + r.bound + exp + ' ok=' + r.ok + (r.wins ? ' w=' + r.wins : '') +
    (r.sigLen !== undefined ? ' insertAt.length=' + r.sigLen : '') + (r.why ? ' why=' + r.why : '');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const ci = process.argv.indexOf('--child');
  const miss = FLAGS.filter((f) => !process.execArgv.includes(f));
  if (miss.length > 0) {
    console.error('torture-alloc: FAIL missing flag ' + miss.join(' ') + ' (run with ' + FLAGS.join(' ') + ')');
    process.exit(1);
  }
  if (ci >= 0) {
    await childMain(process.argv[ci + 1]);
  } else {
    const t0 = Date.now();
    const { ok, rows } = await runAlloc();
    for (const r of rows) console.log(rowText(r));
    const lanes = rows.filter((r) => r.kind === 'lane');
    const ctls = rows.filter((r) => r.kind === 'control');
    console.log('GATE alloc lanes ok=' + lanes.filter((r) => r.ok).length + '/' + lanes.length +
      ' controls ok=' + ctls.filter((r) => r.ok).length + '/' + ctls.length +
      ' wallMs=' + (Date.now() - t0) + ' (REPORTED) | ' + (ok ? 'ok' : 'FAIL'));
    if (!ok) process.exitCode = 1;
  }
}
