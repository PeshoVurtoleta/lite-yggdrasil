/**
 * @zakkster/lite-yggdrasil -- the eight benchmark dimensions.
 *
 * MIT (c) Zahary Shinikchiev <shinikchiev@yahoo.com>
 *
 * Repo-only. Bench-ADOPT group 1 TASK 4 (.handoff/PLAN-bench-adopt-g1.md SPEC "Dimensions";
 * SPEC-bench-adopt BA-2, BA-3). Each Dk(member, opts) -> a plain JSON-safe result for ONE
 * adapter (results.json key '<adapter>/<Dk>'); the orchestrator (Bench.mjs, B3) runs one cell
 * per child process. traceHash, vacuityCheck and runDimension are copied from the kit
 * (@zakkster/lite-logn benchmark/Dimensions.mjs, LiteLogN commit 9eb484c) and re-wired for a
 * positional sum sequence; D1..D8 are written for it.
 *
 * Tiers (benchmark/METHODOLOGY.md; ADR 0003 G-1): every count is DETERMINISTIC (exact
 * integers, the same on any host); every timing (ns/op, the log2 n fit, B/op curves, pauses)
 * is REPORTED and gates nothing. D1 leads with the counts (R-BA3): the subject's touches per op
 * against touchesMax(row, Lmax) from test/spec-counts.mjs (G-11 as amended by 0005 C-25), the
 * foil's moves per op; then the REPORTED ns/op vs log2 n fit with lite-logn's r2 0.958 printed
 * as a reference only.
 *
 * Every timed row carries `counts` (the 12-key COUNTS record of benchmark/Adapters.mjs, 'n/a'
 * where the adapter has no pair) and `extras`, counted over `ops` ops of the same op on an
 * untimed pass. Every result carries `_check`: the numbers that MUST be strictly positive for
 * the reading to be non-vacuous (ns/op, byte figures, op counts). Touches, B/op and pauses are
 * not in `_check` (0 is a correct answer for them). A dimension that does not apply to an
 * adapter returns { dim, member, na: reason } with no `_check`.
 *
 * Hot body law: a timed loop only runs op(k) over an Int32Array script precomputed (cold, from
 * the Harness LCG) through an adapter handle; it holds no PRNG, no float, no allocation, and
 * results land in the Int32Array SINK. Measures are integers in [0, 255], so totals stay
 * < 2^28 at n = 2^20. `quick: true` shrinks sizes / op counts for an in-process run; D1 keeps
 * all 11 count sizes in quick form.
 *
 * Never imported by Yggdrasil.js; it imports Yggdrasil.js the way a consumer does.
 * ASCII only.
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { SumSequence } from '../Yggdrasil.js';
import {
    touchesMax, Lmax, TOUCH_HIT, TOUCH_MISS, TOUCH_SEEK, TOUCH_INSERT_SPLIT, TOUCH_REMOVE_UNDERFLOW,
} from '../test/spec-counts.mjs';
import { prng, median, collect, warm, gcNow, percentile, foldHash, DEFAULT_SEED } from './Harness.mjs';
import { NA, NA_REASONS, SUBJECTS, FOIL, baselineFor } from './Matrix.mjs';
import { selectAdapter, countsRecord, validateCounts, NC } from './Adapters.mjs';

/** Integer sink: every timed op writes here so V8 cannot dead-code-eliminate it. */
export const SINK = new Int32Array(4);

/** The package root and the main file (D5). */
export const PKG_DIR = new URL('..', import.meta.url).pathname;
export const MAIN_FILE = new URL('../Yggdrasil.js', import.meta.url).pathname;

/** D1 count sizes: n = 2^10 .. 2^20 (11 sizes), all of them in quick form too. */
export const SIZES = Object.freeze([1 << 10, 1 << 11, 1 << 12, 1 << 13, 1 << 14, 1 << 15, 1 << 16, 1 << 17,
    1 << 18, 1 << 19, 1 << 20]);
const QUICK_TIMING_SIZES = [1 << 10, 1 << 13, 1 << 16];

/** lite-logn's family r2 floor: printed beside the fit as a REFERENCE only (R-BA3). */
export const R2_REFERENCE = 0.958;

const MEAS_MASK = 255;
const ENT_MASK = 0xFFFF;
const CI = SumSequence.COUNTERS;
const MEMBERS = [...SUBJECTS, FOIL];

// ---- cold helpers --------------------------------------------------------------------------

function memberAdapter(member) {
    if (!MEMBERS.includes(member)) throw new Error('[bench] unhandled member: ' + String(member));
    return selectAdapter(member);
}

function naResult(dim, member, reason) {
    return { dim, member, baseline: baselineFor(member, dim), na: reason };
}

/** Least squares y = intercept + slope * x; r2 is NA when it is undefined (< 2 points, flat x / y). */
export function fitLogLinear(xs, ys) {
    const n = xs.length;
    if (n < 2) return { slope: NA, intercept: NA, r2: NA };
    let sx = 0, sy = 0;
    for (let i = 0; i < n; i++) { sx += xs[i]; sy += ys[i]; }
    const mx = sx / n, my = sy / n;
    let sxx = 0, sxy = 0, syy = 0;
    for (let i = 0; i < n; i++) {
        const dx = xs[i] - mx, dy = ys[i] - my;
        sxx += dx * dx; sxy += dx * dy; syy += dy * dy;
    }
    if (sxx === 0 || syy === 0) return { slope: NA, intercept: NA, r2: NA };
    const slope = sxy / sxx;
    const intercept = my - slope * mx;
    let ssr = 0;
    for (let i = 0; i < n; i++) { const e = ys[i] - (intercept + slope * xs[i]); ssr += e * e; }
    return { slope, intercept, r2: 1 - ssr / syy };
}

/** Int32Array of `count` values from the LCG (cold). */
function lcgTable(seed, count, mod) {
    const r = prng(seed >>> 0);
    const t = new Int32Array(count);
    for (let k = 0; k < count; k++) t[k] = (r() >>> 4) % mod;
    return t;
}

/** Append n elements (measures from the LCG, in [0, 255]) at the end, untimed. */
function fillTo(h, n, seed) {
    const r = prng(seed >>> 0);
    for (let j = h.length(); j < n; j++) {
        const m = (r() >>> 8) & MEAS_MASK;
        h.insertAt(j, j & ENT_MASK, m, m, m, m);
    }
}

function readRecord(adapter, h, cnt) {
    h.readCounts(cnt);
    let ex;
    if (adapter.extraCounts.length > 0) {
        ex = new Float64Array(adapter.extraCounts.length);
        h.readExtras(ex);
    }
    const rec = countsRecord(adapter, cnt, ex);
    validateCounts(adapter, rec, adapter.name);
    return rec;
}

function hashScript(h, S) {
    for (let k = 0; k < S.length; k++) h = foldHash(h, S[k]);
    return h;
}

/**
 * One REPORTED timing row with its counts: an untimed count pass of `ops` calls op(k) from
 * reset (which also warms), then collect() of `samples` batches. ns/op = median.
 */
function timedRow(adapter, h, op, ops, samples) {
    h.resetCounts();
    for (let k = 0; k < ops; k++) op(k);
    const rec = readRecord(adapter, h, new Int32Array(NC));
    const s = collect(op, ops, samples);
    const sorted = Float64Array.from(s).sort();
    return {
        ops, samples, nsPerOp: median(s), p50: percentile(sorted, 50), p90: percentile(sorted, 90),
        counts: rec.counts, extras: rec.extras,
    };
}

/** Mixed op script, length-neutral (ends at the start length n), 3 ints per op [op, a, v]. */
export function mixedScript(n, ops, seed) {
    const r = prng(seed >>> 0);
    const out = [];
    let len = n;
    for (let k = 0; k < ops; k++) {
        const x = r();
        let op = x % 5;
        if (op === 1 && len <= (n >>> 1)) op = 0;
        if (op === 0) { out.push(0, (x >>> 3) % (len + 1), (x >>> 8) & MEAS_MASK); len++; }
        else if (op === 1) { out.push(1, (x >>> 3) % len, 0); len--; }
        else if (op === 2) out.push(2, (x >>> 3) % len, (x >>> 8) & MEAS_MASK);
        else if (op === 3) out.push(3, 0, (x >>> 4) % (len * 128 + 1));
        else out.push(4, (x >>> 3) % (len + 1), 0);
    }
    while (len > n) { out.push(1, len - 1, 0); len--; }
    while (len < n) { out.push(0, len, 0); len++; }
    return { script: Int32Array.from(out), count: out.length / 3, growth: 0 };
}

function mixedOp(h, S) {
    return (k) => {
        const b = k * 3;
        const op = S[b];
        const a = S[b + 1];
        const v = S[b + 2];
        if (op === 0) h.insertAt(a, k & ENT_MASK, v, v, v, v);
        else if (op === 1) h.removeAt(a);
        else if (op === 2) h.setMeasure(a, 0, v);
        else if (op === 3) SINK[0] = h.indexAtSum(0, v);
        else SINK[1] = h.sumBefore(0, a);
    };
}

/** Max live growth of a mixed script over its start length (capacity sizing, cold). */
function mixedPeak(S, count) {
    let len = 0, peak = 0;
    for (let k = 0; k < count; k++) {
        const op = S[k * 3];
        if (op === 0) { len++; if (len > peak) peak = len; } else if (op === 1) len--;
    }
    return peak;
}

// ===========================================================================
// D1 -- the splice witness, counts first (R-BA3).
// Subject: at every n in SIZES, per op kind, each op runs from a counter read to a counter
// read; its C-25 row is classified from the deltas (fingerHits -> HIT; insert with splits ->
// INSERT_SPLIT; remove with merges / equalizes -> REMOVE_UNDERFLOW; seeks -> SEEK; else MISS)
// and its touches are checked against touchesMax(row, Lmax(C, leafSize / 4, 1)) + boundDelta.
// boundDelta (default 0) exists only for the must-fail control (-1: a HIT row's bound is -1).
// Foil: moves per insertAt(floor(n / 2)) at length n == n - floor(n / 2), exactly.
// Then the REPORTED fit (opts.timing === false skips it).
// ===========================================================================

// Op kinds: '.mid' / '.random' keep n fixed (an insert is undone after its read; a remove is
// preceded by an untimed insert at the END, so its finger misses). '.grow' inserts ops times at
// the middle and '.shrink' removes ops times at the middle of the current length, without undo, so one leaf overfills
// / drains (a split / an underflow is forced at every n), then n is restored untimed. Every
// restore op sits outside the counted delta.
const D1_KINDS = ['insertAt.mid', 'insertAt.random', 'insertAt.grow', 'removeAt.mid', 'removeAt.random',
    'removeAt.shrink', 'setMeasure', 'indexAtSum', 'sumBefore'];

/** D1 quick-form ops per kind and size; the coverage floors below hold at this count too. */
export const D1_QUICK_OPS = 64;

function d1Fail(n, kind, what) {
    throw new Error('[bench] D1 n=' + n + ' ' + kind + ': ' + what);
}

/**
 * Cold self-check of one row, after its op loop: the row classification agrees with the counter
 * events (catches a MISS classified INSERT_SPLIT and a non-underflow remove classified
 * REMOVE_UNDERFLOW), and maxBound equals the bound RECOMPUTED from the row's own fields (C,
 * leafSize read from the instance, byRow) through a second Lmax call (catches a scaled bound or
 * a wrong L). B4's test recomputes the same from row.C / row.leafSize / row.byRow.
 */
function d1Recheck(row, boundDelta, declaredLeaf) {
    const by = row.byRow;
    // the printed adapter param must be the instance's leaf size (the report header names params)
    if (row.leafSize !== declaredLeaf) d1Fail(row.n, row.op, 'instance leafSize ' + row.leafSize + ' != adapter.params.leafSize ' + declaredLeaf);
    if (by[TOUCH_HIT] !== row.hits) d1Fail(row.n, row.op, 'byRow[HIT] ' + by[TOUCH_HIT] + ' != hits ' + row.hits);
    if (!(by[TOUCH_INSERT_SPLIT] <= row.splits)) d1Fail(row.n, row.op, 'byRow[INSERT_SPLIT] > splits');
    if (!(by[TOUCH_REMOVE_UNDERFLOW] <= row.underflows)) d1Fail(row.n, row.op, 'byRow[REMOVE_UNDERFLOW] > underflows');
    let total = 0;
    let want = -Infinity;
    const L2 = Lmax(row.C, row.leafSize >> 2, 1);
    for (let t = 0; t < by.length; t++) {
        total += by[t];
        if (by[t] > 0) want = Math.max(want, touchesMax(t, L2) + boundDelta);
    }
    if (total !== row.ops) d1Fail(row.n, row.op, 'byRow sums to ' + total + ', not ops ' + row.ops);
    if (L2 !== row.L || want !== row.maxBound) {
        d1Fail(row.n, row.op, 'bound recompute: L ' + row.L + ' vs ' + L2 + ', maxBound ' + row.maxBound + ' vs ' + want);
    }
}

/** Coverage floors per n (both forms): the gate must see every C-25 row it claims to bound. */
function d1Floors(rows, ops) {
    const half = ops >>> 1;
    for (const r of rows) {
        if (r.op === 'insertAt.grow' && !(r.splits >= 1)) d1Fail(r.n, r.op, 'coverage floor: splits >= 1, got ' + r.splits);
        if (r.op === 'removeAt.shrink' && !(r.underflows >= 1)) d1Fail(r.n, r.op, 'coverage floor: underflows >= 1, got ' + r.underflows);
        if (r.op === 'insertAt.mid' && !(r.hits >= half)) d1Fail(r.n, r.op, 'coverage floor: hits >= ' + half + ', got ' + r.hits);
        if (r.op.endsWith('.random') && !(r.misses >= half)) d1Fail(r.n, r.op, 'coverage floor: misses >= ' + half + ', got ' + r.misses);
    }
}

function d1SubjectCounts(adapter, n, ops, seed, boundDelta) {
    const C = n + ops + 64;
    const h = adapter.create(C, 1);
    const B = h.instance._ar.B; // the leaf size of the INSTANCE (one source of truth), not adapter.params
    const L = Lmax(C, B >> 2, 1);
    fillTo(h, n, seed ^ n);
    const P = lcgTable(seed ^ (n * 3), ops, n);
    const V = lcgTable(seed ^ (n * 5), ops, MEAS_MASK + 1);
    const Y = lcgTable(seed ^ (n * 7), ops, n * 128);
    const sh = hashScript(hashScript(hashScript(0x811c9dc5 >>> 0, P), V), Y);
    const cnt = new Int32Array(NC);
    const sum = new Int32Array(NC);
    const prev = new Int32Array(NC);
    const rows = [];
    const mid = n >>> 1;
    for (const kind of D1_KINDS) {
        const row = { op: kind, n, C, leafSize: B, L, ops, touches: 0, maxTouches: 0, maxBound: -Infinity, hits: 0,
            misses: 0, splits: 0, underflows: 0, violations: 0 };
        const byRow = new Int32Array(11);
        const isInsert = kind.startsWith('insertAt.');
        const isRemove = kind.startsWith('removeAt.');
        const undo = kind.endsWith('.mid') || kind.endsWith('.random');
        h.resetCounts();
        prev.fill(0);
        sum.fill(0);
        for (let k = 0; k < ops; k++) {
            const len = h.length();
            // shrink removes at the middle of the CURRENT length, so ops may reach n (full form) without leaving range
            const i = (kind.endsWith('.random') || kind === 'setMeasure' || kind === 'sumBefore') ? P[k]
                : (kind === 'removeAt.shrink' ? (len - 1) >>> 1 : mid);
            if (isRemove && undo) { h.insertAt(len, k & ENT_MASK, V[k]); h.readCounts(prev); }
            if (isInsert) h.insertAt(i, k & ENT_MASK, V[k]);
            else if (isRemove) h.removeAt(i);
            else if (kind === 'setMeasure') h.setMeasure(i, 0, V[k]);
            else if (kind === 'indexAtSum') SINK[0] = h.indexAtSum(0, Y[k]);
            else SINK[1] = h.sumBefore(0, i);
            h.readCounts(cnt);
            const dT = cnt[CI.touches] - prev[CI.touches];
            const hit = cnt[CI.fingerHits] - prev[CI.fingerHits] > 0;
            const split = cnt[CI.splits] - prev[CI.splits] > 0;
            const under = (cnt[CI.merges] - prev[CI.merges]) + (cnt[CI.equalizes] - prev[CI.equalizes]) > 0;
            let tr;
            if (kind === 'indexAtSum' || kind === 'sumBefore') tr = TOUCH_SEEK;
            else if (hit) tr = TOUCH_HIT;
            else if (isInsert && split) tr = TOUCH_INSERT_SPLIT;
            else if (isRemove && under) tr = TOUCH_REMOVE_UNDERFLOW;
            else tr = TOUCH_MISS;
            byRow[tr]++;
            const bound = touchesMax(tr, L) + boundDelta;
            row.touches += dT;
            if (dT > row.maxTouches) row.maxTouches = dT;
            if (bound > row.maxBound) row.maxBound = bound;
            if (hit) row.hits++; else if (tr !== TOUCH_SEEK) row.misses++;
            if (split) row.splits++;
            if (under) row.underflows++;
            if (dT > bound) row.violations++;
            for (let j = 0; j < NC; j++) sum[j] += cnt[j] - prev[j];
            if (isInsert && undo) { h.removeAt(i); h.readCounts(prev); } else prev.set(cnt);
        }
        if (kind === 'insertAt.grow') while (h.length() > n) h.removeAt(h.length() - 1);
        if (kind === 'removeAt.shrink') fillTo(h, n, seed ^ k32(n));
        // the row's COUNTS record: the per-op deltas of the counted ops only, summed (the untimed
        // restore ops are outside every delta)
        row.touchesPerOp = row.touches / ops;
        row.byRow = Array.from(byRow);
        row.counts = countsRecord(adapter, sum).counts;
        d1Recheck(row, boundDelta, adapter.params.leafSize);
        rows.push(row);
    }
    if (h.length() !== n) throw new Error('[bench] D1 restore drift at n=' + n);
    d1Floors(rows, ops);
    return { rows, scriptHash: sh >>> 0 };
}

function k32(n) {
    return (n * 0x9E3779B1) >>> 0;
}

function d1FoilCounts(adapter, n, ops, seed, sh) {
    const h = adapter.create(n + 64, 1);
    fillTo(h, n, seed ^ n);
    const mid = n >>> 1;
    const cnt = new Int32Array(NC);
    h.resetCounts();
    let moves = 0, exact = 0;
    for (let k = 0; k < ops; k++) {
        h.readCounts(cnt);
        const before = cnt[CI.moves];
        h.insertAt(mid, k & ENT_MASK, k & MEAS_MASK);
        h.readCounts(cnt);
        const d = cnt[CI.moves] - before;
        moves += d;
        if (d === n - mid) exact++;
        h.removeAt(mid);
    }
    // the foil's op stream is (n, mid, ops, k & 255): fold it, so traceHash covers what D1 ran
    sh = foldHash(foldHash(foldHash(sh, n), mid), ops);
    return { row: { op: 'insertAt.mid', n, ops, moves, movesPerOp: moves / ops, movesExpected: n - mid, exact: exact === ops }, sh };
}

export function D1(member, opts = {}) {
    const adapter = memberAdapter(member);
    const quick = opts.quick === true;
    const seed = (opts.seed ?? DEFAULT_SEED) >>> 0;
    const sizes = opts.sizes ?? SIZES;
    const boundDelta = opts.boundDelta ?? 0;
    const check = [];
    const counts = [];
    let sh = 0x811c9dc5 >>> 0;
    let violations = 0;
    for (const n of sizes) {
        if (adapter.role === 'primary') {
            const fr = d1FoilCounts(adapter, n, opts.ops ?? (quick ? 4 : 32), seed, sh);
            const row = fr.row;
            sh = fr.sh;
            counts.push(row);
            check.push(row.movesPerOp);
            if (!row.exact) violations++;
        } else if (adapter.role === 'subject') {
            const r = d1SubjectCounts(adapter, n, opts.ops ?? (quick ? D1_QUICK_OPS : 1024), seed, boundDelta);
            sh = foldHash(sh, r.scriptHash);
            for (const row of r.rows) { counts.push(row); check.push(row.ops); violations += row.violations; }
        } else {
            throw new Error('[bench] D1 has no count lane for role ' + String(adapter.role) + ' (' + member + ')');
        }
    }

    let fit = NA;
    const timing = [];
    if (opts.timing !== false) {
        const tsizes = opts.timingSizes ?? (quick ? QUICK_TIMING_SIZES : sizes);
        const xs = [], ys = [];
        for (const n of tsizes) {
            const h = adapter.create(n + 64, 1);
            fillTo(h, n, seed ^ n);
            const M = 1023;
            const P = lcgTable(seed ^ (n * 11), M + 1, n);
            const V = lcgTable(seed ^ (n * 13), M + 1, MEAS_MASK + 1);
            const op = (k) => { const i = P[k & M]; h.insertAt(i, k & ENT_MASK, V[k & M]); h.removeAt(i); };
            const batch = member === FOIL ? Math.max(2, Math.min(512, (1 << 18) / n | 0)) : (quick ? 512 : 2048);
            const row = timedRow(adapter, h, op, batch, quick ? 5 : 9);
            row.op = 'insertAt+removeAt.random';
            row.n = n;
            timing.push(row);
            xs.push(Math.log2(n)); ys.push(row.nsPerOp); check.push(row.nsPerOp);
        }
        const f = fitLogLinear(xs, ys);
        fit = { x: 'log2 n', r2: f.r2, slope: f.slope, intercept: f.intercept, r2Reference: R2_REFERENCE, gates: false };
    }

    return {
        dim: 'D1', member, baseline: baselineFor(member, 'D1'), unit: member === FOIL ? 'moves/op' : 'touches/op',
        tier: { counts: 'DETERMINISTIC', fit: 'REPORTED' },
        counts, violations, boundDelta, control: boundDelta !== 0,
        traceHash: sh >>> 0, // the hash of the op scripts D1 itself ran (count lanes)
        fit, timing,
        _check: check,
    };
}

// ===========================================================================
// D2 -- amortized cost over a long mixed trace (insert / remove / setMeasure / indexAtSum /
// sumBefore, length-neutral script): cumulative ns/op at power-of-two checkpoints, drift =
// last / first; cumulative counts at every checkpoint (read outside the timed segments).
// ===========================================================================

export function D2(member, opts = {}) {
    const adapter = memberAdapter(member);
    const quick = opts.quick === true;
    const seed = (opts.seed ?? DEFAULT_SEED) >>> 0;
    const n = opts.n ?? (quick ? 2048 : 8192);
    const want = opts.total ?? (member === FOIL ? (quick ? 1 << 12 : 1 << 14) : (quick ? 1 << 14 : 1 << 20));
    const { script, count } = mixedScript(n, want, seed);
    const h = adapter.create(n + mixedPeak(script, count) + 1, 1);
    fillTo(h, n, seed ^ n);
    const op = mixedOp(h, script);
    const cnt = new Int32Array(NC);
    const ckpts = [];
    for (let c = 1024; c < count; c *= 2) ckpts.push(c);
    ckpts.push(count);
    h.resetCounts();
    const points = [];
    let done = 0, elapsed = 0;
    for (const c of ckpts) {
        const t0 = performance.now();
        for (; done < c; done++) op(done);
        elapsed += performance.now() - t0;
        const rec = readRecord(adapter, h, cnt);
        points.push({ ops: done, nsPerOp: (elapsed * 1e6) / done, counts: rec.counts, extras: rec.extras });
    }
    const first = points[0].nsPerOp;
    const last = points[points.length - 1].nsPerOp;
    return {
        dim: 'D2', member, baseline: baselineFor(member, 'D2'), unit: 'ns/op', n, total: count,
        points, drift: first > 0 ? last / first : NA,
        traceHash: hashScript(0x811c9dc5 >>> 0, script) >>> 0,
        _check: points.map((p) => p.nsPerOp).concat([count]),
    };
}

// ===========================================================================
// D3 -- memory: typed-array bytes per live element at full fill vs the floor (4 x dims + 4:
// one int32 entity + dims int32 measures), dims 1..4; the bytes again after clear() + refill
// (stable: preallocated arrays never grow).
// ===========================================================================

export function D3(member, opts = {}) {
    const adapter = memberAdapter(member);
    if (typeof adapter.na.bytes === 'string') return naResult('D3', member, adapter.na.bytes);
    const quick = opts.quick === true;
    const n = opts.n ?? (quick ? 1 << 12 : 1 << 16);
    const seed = (opts.seed ?? DEFAULT_SEED) >>> 0;
    const rows = [];
    const check = [];
    for (let dims = 1; dims <= 4; dims++) {
        const h = adapter.create(n, dims);
        fillTo(h, n, seed ^ dims);
        const bytes = h.bytes();
        h.clear();
        fillTo(h, n, seed ^ dims);
        const refill = h.bytes();
        const floor = 4 * dims + 4;
        const perLive = bytes / n;
        rows.push({ dims, n, bytes, perLive, floor, ratio: perLive / floor, refillBytes: refill, stable: refill === bytes });
        check.push(bytes, perLive, refill);
    }
    return { dim: 'D3', member, baseline: baselineFor(member, 'D3'), unit: 'bytes/live', rows, _check: check };
}

// ===========================================================================
// D4 -- cache behaviour PROXY: a full cursor walk (ns per element) vs a random indexAtSum
// seek (ns/op), gap = seek / walk; then the same pair per leafSize (4, 8, 16, 32).
// ===========================================================================

function d4Pair(adapter, n, tune, seed, quick) {
    const h = adapter.create(n, 1, tune);
    fillTo(h, n, seed);
    const M = 1023;
    const Y = lcgTable(seed ^ 0x51, M + 1, n * 128);
    const walk = timedRow(adapter, h, () => { SINK[2] = h.cursorWalk(0, n); }, 2, quick ? 5 : 9);
    walk.op = 'cursorWalk(0, n)';
    walk.nsPerElem = walk.nsPerOp / n;
    const seek = timedRow(adapter, h, (k) => { SINK[0] = h.indexAtSum(0, Y[k & M]); }, quick ? 1024 : 4096, quick ? 5 : 9);
    seek.op = 'indexAtSum.random';
    return { walk, seek, gap: seek.nsPerOp / walk.nsPerElem };
}

export function D4(member, opts = {}) {
    const adapter = memberAdapter(member);
    if (typeof adapter.na.cursorWalk === 'string') return naResult('D4', member, adapter.na.cursorWalk);
    const quick = opts.quick === true;
    const n = opts.n ?? (quick ? 1 << 12 : 1 << 16);
    const seed = (opts.seed ?? DEFAULT_SEED) >>> 0;
    const base = d4Pair(adapter, n, undefined, seed, quick);
    const check = [base.walk.nsPerOp, base.seek.nsPerOp];
    const leafSweep = [];
    for (const leafSize of [4, 8, 16, 32]) {
        const p = d4Pair(adapter, n, { leafSize }, seed, quick);
        leafSweep.push({ leafSize, walkNsPerElem: p.walk.nsPerElem, seekNsPerOp: p.seek.nsPerOp, gap: p.gap,
            walk: p.walk, seek: p.seek });
        check.push(p.walk.nsPerOp, p.seek.nsPerOp);
    }
    return {
        dim: 'D4', member, baseline: baselineFor(member, 'D4'), unit: 'ns', proxy: true, n,
        walk: base.walk, seek: base.seek, gap: base.gap, leafSweep, _check: check,
    };
}

// ===========================================================================
// D5 -- bundle size (R-BA2): raw + node:zlib gzip bytes of Yggdrasil.js; no minifier, no new
// devDependency; tree-shaking 'n/a' (single file, single member).
// ===========================================================================

export function D5(member, opts = {}) {
    memberAdapter(member);
    if (member === FOIL) return naResult('D5', member, 'foil: not a shipped file');
    const buf = readFileSync(opts.file ?? MAIN_FILE);
    const gzip = gzipSync(buf, { level: 9 }).length;
    return {
        dim: 'D5', member, baseline: NA, unit: 'bytes', file: 'Yggdrasil.js',
        sha256_8: createHash('sha256').update(buf).digest('hex').slice(0, 8),
        raw: buf.length, gzip, gzipLevel: 9, minified: NA, treeShaking: NA, treeShakingReason: NA_REASONS.treeShaking,
        _check: [buf.length, gzip],
    };
}

// ===========================================================================
// D6 -- GC pressure, REPORTED: B/op (MIN clean heapUsed delta over `passes` observer-free
// passes, the kit's method) and the GC count / max pause of one observer pass, per op-row and
// size. Children run with --no-concurrent-recompilation (Bench.mjs). The 0 B/op CLAIM is gated
// by test/torture.mjs and benchmark/kernel-lane.mjs, never by D6.
// ===========================================================================

async function withGcObserver(fn) {
    const { PerformanceObserver, constants } = await import('node:perf_hooks');
    let major = 0, minor = 0, totalMs = 0, maxMs = 0;
    const MAJOR = constants.NODE_PERFORMANCE_GC_MAJOR;
    const obs = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) {
            const kind = (e.detail && e.detail.kind) != null ? e.detail.kind : e.kind;
            if (kind === MAJOR) major++; else minor++;
            totalMs += e.duration;
            if (e.duration > maxMs) maxMs = e.duration;
        }
    });
    obs.observe({ entryTypes: ['gc'] });
    fn();
    await new Promise((r) => setTimeout(r, 30)); // GC entries arrive asynchronously
    obs.disconnect();
    return { major, minor, totalMs, maxMs };
}

/** The op-row kernels of one filled handle (cold builder; the closures are the timed bodies). */
function opKernels(adapter, h, n, seed) {
    const M = 1023;
    const P = lcgTable(seed ^ 0x61, M + 1, n);
    const V = lcgTable(seed ^ 0x62, M + 1, MEAS_MASK + 1);
    const Y = lcgTable(seed ^ 0x63, M + 1, n * 128);
    const ks = [
        ['insertAt+removeAt', (k) => { const i = P[k & M]; h.insertAt(i, k & ENT_MASK, V[k & M]); h.removeAt(i); }],
        ['setMeasure', (k) => { h.setMeasure(P[k & M], 0, V[k & M]); }],
        ['indexAtSum', (k) => { SINK[0] = h.indexAtSum(0, Y[k & M]); }],
        ['sumBefore', (k) => { SINK[1] = h.sumBefore(0, P[k & M]); }],
    ];
    if (typeof h.cursorWalk === 'function') ks.push(['cursorWalk16', (k) => { SINK[2] = h.cursorWalk(P[k & M], 16); }]);
    return ks;
}

function foilOps(member, n, ops) {
    return member === FOIL ? Math.max(64, Math.min(ops, (1 << 22) / n | 0)) : ops;
}

export async function D6(member, opts = {}) {
    const adapter = memberAdapter(member);
    const quick = opts.quick === true;
    const seed = (opts.seed ?? DEFAULT_SEED) >>> 0;
    const sizes = opts.sizes ?? (quick ? [1 << 12] : [1 << 10, 1 << 14, 1 << 16]);
    const baseOps = opts.ops ?? (quick ? 20000 : 100000);
    const PASSES = opts.passes ?? 5;
    const perOp = new Map();
    const check = [];
    let worstMajor = 0, maxPauseMs = 0, allZero = true;
    for (const n of sizes) {
        const h = adapter.create(n + 8, 1);
        fillTo(h, n, seed ^ n);
        const ops = foilOps(member, n, baseOps);
        for (const [name, op] of opKernels(adapter, h, n, seed ^ n)) {
            h.resetCounts();
            warm(op, Math.min(ops, 20000));
            let minDelta = Infinity, best = Infinity;
            for (let pass = 0; pass < PASSES; pass++) {
                gcNow();
                const h0 = process.memoryUsage().heapUsed;
                const t0 = performance.now();
                for (let k = 0; k < ops; k++) op(k);
                const el = performance.now() - t0;
                const d = Math.max(0, process.memoryUsage().heapUsed - h0);
                if (d < minDelta) minDelta = d;
                if (el < best) best = el;
            }
            gcNow();
            const gc = await withGcObserver(() => { for (let k = 0; k < ops; k++) op(k); });
            h.resetCounts();
            for (let k = 0; k < ops; k++) op(k);
            const rec = readRecord(adapter, h, new Int32Array(NC));
            const raw = minDelta / ops;
            const bytesPerOp = raw < 1 ? 0 : Math.round(raw);
            const opsPerMs = best > 0 && Number.isFinite(best) ? ops / best : Infinity;
            if (gc.major > worstMajor) worstMajor = gc.major;
            if (gc.maxMs > maxPauseMs) maxPauseMs = gc.maxMs;
            if (bytesPerOp !== 0) allZero = false;
            if (!perOp.has(name)) perOp.set(name, []);
            perOp.get(name).push({ n, ops, bytesPerOp, opsPerMs, gcMajor: gc.major, gcMinor: gc.minor,
                gcPauseMs: gc.totalMs, gcMaxMs: gc.maxMs, counts: rec.counts, extras: rec.extras });
            check.push(opsPerMs, ops);
        }
    }
    return {
        dim: 'D6', member, baseline: baselineFor(member, 'D6'), unit: 'B/op', tier: 'REPORTED',
        perOp: [...perOp].map(([op, points]) => ({ op, points, zeroAlloc: points.every((p) => p.bytesPerOp === 0) })),
        maxMajor: worstMajor, maxPauseMs, zeroAlloc: allZero,
        _check: check, // throughput + op counts (positive). B/op and pauses are ALLOWED 0.
    };
}

// ===========================================================================
// D7 -- scalability: insertion pattern (append / prepend / middle / random) x dims x fill
// fraction of C: ns per insert of a fresh build (median of reps), counts of the last build.
// Key types are 'n/a' ("positional, integer measures").
// ===========================================================================

export const D7_PATTERNS = Object.freeze(['append', 'prepend', 'middle', 'random']);

function patternScript(pattern, count, seed) {
    const P = new Int32Array(count);
    const r = prng(seed >>> 0);
    for (let j = 0; j < count; j++) {
        if (pattern === 'append') P[j] = j;
        else if (pattern === 'prepend') P[j] = 0;
        else if (pattern === 'middle') P[j] = j >>> 1;
        else if (pattern === 'random') P[j] = (r() >>> 4) % (j + 1);
        else throw new Error('[bench] unknown D7 pattern ' + String(pattern));
    }
    return P;
}

export function D7(member, opts = {}) {
    const adapter = memberAdapter(member);
    const quick = opts.quick === true;
    const seed = (opts.seed ?? DEFAULT_SEED) >>> 0;
    const C = opts.C ?? (member === FOIL ? (quick ? 1 << 10 : 1 << 12) : (quick ? 1 << 11 : 1 << 14));
    const dimsList = opts.dims ?? (quick ? [1, 4] : [1, 2, 4]);
    const fills = opts.fills ?? [0.25, 0.5, 1];
    const reps = opts.reps ?? (quick ? 3 : 5);
    const V = lcgTable(seed ^ 0x71, C, MEAS_MASK + 1);
    const rows = [];
    const check = [];
    const cnt = new Int32Array(NC);
    for (const pattern of D7_PATTERNS) {
        for (const dims of dimsList) {
            for (const fill of fills) {
                const count = Math.max(1, Math.floor(C * fill));
                const P = patternScript(pattern, count, seed ^ count);
                const h = adapter.create(C, dims);
                const times = new Float64Array(reps);
                for (let r = 0; r < reps; r++) {
                    h.clear();
                    h.resetCounts();
                    const t0 = performance.now();
                    for (let j = 0; j < count; j++) { const m = V[j]; h.insertAt(P[j], j & ENT_MASK, m, m, m, m); }
                    times[r] = ((performance.now() - t0) * 1e6) / count;
                }
                const rec = readRecord(adapter, h, cnt);
                const ns = median(times);
                rows.push({ pattern, dims, fill, C, ops: count, nsPerOp: ns, counts: rec.counts, extras: rec.extras });
                check.push(ns > 0 ? ns : 1e-3, count);
            }
        }
    }
    return {
        dim: 'D7', member, baseline: baselineFor(member, 'D7'), unit: 'ns/insert', rows,
        keyTypes: { int: 'measured', string: NA, object: NA, reason: NA_REASONS.keyTypes },
        _check: check,
    };
}

// ===========================================================================
// D8 -- op-row micro workloads at one n: every op kernel of D6, the mixed trace replayed
// (length-neutral, so every replay starts at n), and splitAt + append as a pair (live only
// where the adapter has them; otherwise the row is 'n/a' with the adapter's reason).
// ===========================================================================

export function D8(member, opts = {}) {
    const adapter = memberAdapter(member);
    const quick = opts.quick === true;
    const seed = (opts.seed ?? DEFAULT_SEED) >>> 0;
    const n = opts.n ?? (quick ? 1 << 12 : 1 << 14);
    const samples = quick ? 5 : 9;
    const batch = foilOps(member, n, quick ? 1024 : 4096) >>> (member === FOIL ? 4 : 0);
    const rows = [];
    const check = [];
    const h = adapter.create(n + 1024, 1);
    fillTo(h, n, seed ^ n);
    for (const [name, op] of opKernels(adapter, h, n, seed ^ n)) {
        const row = timedRow(adapter, h, op, batch, samples);
        row.op = name;
        row.n = n;
        rows.push(row);
        check.push(row.nsPerOp, row.ops);
    }
    const mx = mixedScript(n, batch, seed ^ 0x81);
    const mrow = timedRow(adapter, h, mixedOp(h, mx.script), mx.count, samples);
    mrow.op = 'mixed';
    mrow.n = n;
    mrow.traceHash = hashScript(0x811c9dc5 >>> 0, mx.script) >>> 0;
    rows.push(mrow);
    check.push(mrow.nsPerOp, mrow.ops);
    if (typeof h.cursorWalk !== 'function') rows.push({ op: 'cursorWalk16', n, na: adapter.na.cursorWalk });
    if (typeof adapter.createPair === 'function' && typeof adapter.na.splitAt !== 'string') {
        const [a, b] = adapter.createPair(2 * n, 1);
        fillTo(a, n, seed ^ n);
        const M = 1023;
        const P = lcgTable(seed ^ 0x82, M + 1, n);
        const row = timedRow(adapter, a, (k) => { a.splitAt(P[k & M], b); a.append(b); }, batch, samples);
        row.op = 'splitAt+append';
        row.n = n;
        rows.push(row);
        check.push(row.nsPerOp, row.ops);
    } else {
        rows.push({ op: 'splitAt+append', n, na: adapter.na.splitAt });
    }
    return { dim: 'D8', member, baseline: baselineFor(member, 'D8'), unit: 'ns/op', n, rows, _check: check };
}

// ===========================================================================
// Fixed-seed workload TRACE hash (the determinism gate, copied from the kit, re-wired): the
// hash of the mixed op script (op selector, index, value) at n = 8192. Deterministic given the
// seed; timing plays no part. The member dispatch is explicit and fail closed.
// ===========================================================================

export function traceHash(member, seed = DEFAULT_SEED, length = 100000) {
    if (!MEMBERS.includes(member)) throw new Error('[bench] unhandled member: ' + String(member));
    const { script } = mixedScript(8192, length, seed);
    return hashScript(0x811c9dc5 >>> 0, script) >>> 0;
}

// ===========================================================================
// Vacuity gate (copied from the kit): a dimension that returns an empty array or an impossible
// value (a non-positive ns/op / byte figure / op count) must make the process fail. An honest
// 'n/a' cell ({ na: reason } with no _check) passes.
// ===========================================================================

export function vacuityCheck(result) {
    if (!result || typeof result !== 'object') {
        throw new Error('[bench] vacuous: null/non-object result');
    }
    if (typeof result.na === 'string' && result.na.length > 0 && result._check === undefined) return true;
    const chk = result._check;
    if (!Array.isArray(chk) || chk.length === 0) {
        throw new Error('[bench] vacuous: ' + result.dim + '/' + result.member + ' returned no _check values');
    }
    for (const v of chk) {
        if (typeof v !== 'number' || !isFinite(v) || v <= 0) {
            throw new Error('[bench] vacuous: ' + result.dim + '/' + result.member +
                ' impossible value ' + String(v));
        }
    }
    for (const key of ['points', 'rows', 'counts', 'timing', 'perOp', 'leafSweep']) {
        if (Array.isArray(result[key]) && result[key].length === 0 && !(key === 'timing' && result.fit === NA)) {
            throw new Error('[bench] vacuous: ' + result.dim + '/' + result.member +
                ' empty array ' + key);
        }
    }
    return true;
}

/** Dispatch table: run one dimension by name (async, since D6 is async). */
export async function runDimension(member, dim, opts = {}) {
    switch (dim) {
        case 'D1': return D1(member, opts);
        case 'D2': return D2(member, opts);
        case 'D3': return D3(member, opts);
        case 'D4': return D4(member, opts);
        case 'D5': return D5(member, opts);
        case 'D6': return D6(member, opts);
        case 'D7': return D7(member, opts);
        case 'D8': return D8(member, opts);
        default: throw new Error('[bench] unknown dimension ' + String(dim));
    }
}
