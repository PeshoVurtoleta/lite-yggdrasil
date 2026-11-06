/**
 * @zakkster/lite-yggdrasil -- benchmark/Compare.mjs oracle (node:test), Bench-ADOPT g2b-3a B4.
 *
 * Independent oracle: every expected value is hand-derived from SPEC-bench-adopt CURRENT
 * BA-28..BA-31 and PLAN-bench-adopt-g2b3a ASSERTIONS A1 / A2 (arithmetic in comments), never
 * copied from Compare.mjs output. g2b-4 B2 rows (R-BA41 min-of-K verdicts, R-BA42 crossover-only
 * twin gate, R-BA44 grid + 8 x d) are derived from the g2b-4 ASSERTIONS A1..A3. Compare.mjs was read for signatures and throw messages only.
 * Each value rule names the mutant a row would catch. Pure + cold: no clock, no PRNG. ASCII only.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    K, BAND, CAP_MIN, CAP_MAX, SWEEP_FACTORS, defaultChunkCap, sweepGrid, rotateLabels, median, minOfList, runValues, medianOfK, minOfK,
    compare, crossover, crossovers, combineS1, twinControl, lossRows, pickChunkCap, abSummary,
} from '../benchmark/Compare.mjs';
import { validateResults } from '../benchmark/Bench.mjs';
import { BlockedArray } from '../benchmark/rivals/BlockedArray.js';

// ---- fixtures -------------------------------------------------------------------------------
// cell(member, Sid, n, runs, phase = 'blend'): runs[0] = pass 1 (the cell), runs[1..] = repeats.
const mk = (member, scenario, n, v, extra = {}) => ({
    member, scenario, n, phases: [{ phase: 'blend', nsPerOp: v }], ...extra,
});
const cell = (member, scenario, n, runs, extraPhases = null) => {
    const one = (v, ph) => ({ member, scenario, n, phases: [{ phase: 'blend', nsPerOp: v },
        ...(extraPhases ? [{ phase: 'seek', nsPerOp: ph }] : [])] });
    const c = one(runs[0], extraPhases ? extraPhases[0] : 0);
    if (runs.length > 1) c.repeats = runs.slice(1).map((v, i) => one(v, extraPhases ? extraPhases[i + 1] : 0));
    return c;
};
// withCap: chunkCap on the cell and on every repeat (a sweep cell's repeats share its chunkCap).
const withCap = (c, cc) => {
    const o = { ...c, chunkCap: cc };
    if (c.repeats) o.repeats = c.repeats.map((r) => ({ ...r, chunkCap: cc }));
    return o;
};
const five = (v) => [v, v, v, v, v];
const put = (res, member, scenario, n, runs, extra) => { res[member + '/' + scenario + '@' + n] = cell(member, scenario, n, runs, extra); };

describe('A1: constants, defaultChunkCap, sweepGrid, compare, rotateLabels', () => {
    test('constants: K = 5, BAND = 0.95, clamp [8, 65536]', () => {
        assert.equal(K, 5);
        assert.equal(BAND, 0.95);
        assert.equal(CAP_MIN, 8);
        assert.equal(CAP_MAX, 65536);
    });

    test('defaultChunkCap hand values: 1025 -> 36, 1000001 -> 1004', () => {
        // sqrt(1025) = 32.016 -> ceil 33 -> max(16, 33) = 33 -> up to a multiple of 4 = 36.
        assert.equal(defaultChunkCap(1025), 36);
        // sqrt(1000001) = 1000.0005 -> ceil 1001 -> up to a multiple of 4 = 1004.
        // (a floor mutant gives 1000; a no-round-up mutant gives 1001.)
        assert.equal(defaultChunkCap(1000001), 1004);
        // floor of 16: sqrt(1) = 1 -> 16; sqrt(256) = 16 -> 16; sqrt(257) = 16.03 -> 17 -> 20.
        assert.equal(defaultChunkCap(1), 16);
        assert.equal(defaultChunkCap(256), 16);
        assert.equal(defaultChunkCap(257), 20);
    });

    test('defaultChunkCap === new BlockedArray(C).chunkCap (parity, one instance at a time)', () => {
        for (const C of [1, 8, 255, 256, 257, 1025, 4097, 65537, 100001, 1000001, 1048577]) {
            let b = new BlockedArray(C);
            const got = b.chunkCap;
            b = null;
            assert.equal(defaultChunkCap(C), got, 'C = ' + C);
        }
    });

    test('SWEEP_FACTORS = [1/4, 1/2, 1, 2, 4, 8] (R-BA44)', () => {
        assert.deepEqual([...SWEEP_FACTORS], [1 / 4, 1 / 2, 1, 2, 4, 8]);
    });

    test('sweepGrid hand values: 36, 1004, 8, 8192, 65536 (6 cells, top = 8 x d)', () => {
        // 36 x {1/4,1/2,1,2,4,8} = 9, 18, 36, 72, 144, 288 -> up to a multiple of 4 = 12, 20, 36, 72, 144, 288.
        assert.deepEqual(sweepGrid(36), [12, 20, 36, 72, 144, 288]);
        // 1004 x ... = 251, 502, 1004, 2008, 4016, 8032 -> 252, 504, 1004, 2008, 4016, 8032.
        assert.deepEqual(sweepGrid(1004), [252, 504, 1004, 2008, 4016, 8032]);
        // 8 x ... = 2, 4, 8, 16, 32, 64 -> clamp 8, 8, 8 -> dedupe -> 8, 16, 32, 64.
        assert.deepEqual(sweepGrid(8), [8, 16, 32, 64]);
        // 8192 x ... = 2048, 4096, 8192, 16384, 32768, 65536 (the 8 x d cell lands exactly on CAP_MAX).
        assert.deepEqual(sweepGrid(8192), [2048, 4096, 8192, 16384, 32768, 65536]);
        // 65536 -> 16384, 32768, 65536, then 131072 / 262144 / 524288 clamp to 65536 -> dedupe.
        assert.deepEqual(sweepGrid(65536), [16384, 32768, 65536]);
    });

    test('sweepGrid: round UP (not nearest/down): 20 -> 5,10,20,40,80,160 -> [8,12,20,40,80,160]', () => {
        // 5 -> 8 (round up 8, also the clamp floor); 10 -> 12 (down/nearest would give 8 / 12).
        assert.deepEqual(sweepGrid(20), [8, 12, 20, 40, 80, 160]);
    });

    test('sweepGrid: low clamp + dedupe: 12 -> 3,6,12,24,48,96 -> [8,12,24,48,96]', () => {
        // 3 -> 4 -> clamp 8; 6 -> 8; 12; 24; 48; 96 -> dedupe the two 8s.
        assert.deepEqual(sweepGrid(12), [8, 12, 24, 48, 96]);
    });

    test('sweepGrid: high clamp + dedupe: 32768 -> [8192,16384,32768,65536]', () => {
        // 8192, 16384, 32768, 65536, 131072, 262144 -> clamp the last two to 65536 (already present).
        assert.deepEqual(sweepGrid(32768), [8192, 16384, 32768, 65536]);
    });

    test('sweepGrid property: new grid = sorted unique(OLD 5-factor grid U {min(65536, ceil(8d/4)*4)})', () => {
        // Independent reimplementation of the OLD rule (factors 1/4 .. 4, ceil to a multiple of 4,
        // clamp to [8, 65536]); the new grid adds exactly the 8 x d cell.
        const oldGrid = (d) => {
            const out = new Set();
            for (const f of [1 / 4, 1 / 2, 1, 2, 4]) out.add(Math.min(65536, Math.max(8, Math.ceil((d * f) / 4) * 4)));
            return out;
        };
        const ds = [8, 12, 16, 20, 24, 36, 1004, 4096, 8192, 16384, 16388, 32768, 49152, 65532, 65536];
        for (let d = 8; d <= 65536; d += 4) ds.push(d); // every legal d (16,383 values)
        for (const d of ds) {
            const want = oldGrid(d);
            want.add(Math.min(65536, Math.ceil((8 * d) / 4) * 4));
            const exp = [...want].sort((p, q) => p - q);
            assert.deepEqual(sweepGrid(d), exp, 'd = ' + d);
            for (const c of exp) assert.ok(c % 4 === 0 && c >= 8 && c <= 65536, 'd = ' + d + ' c = ' + c);
        }
    });

    test('compare: TIE inside the band; band 1.0 turns the same inputs into A', () => {
        // 100 < 0.95 x 102 = 96.9? no. 102 < 0.95 x 100 = 95? no -> TIE.
        assert.equal(compare(five(100), five(102)), 'TIE');
        // band 1.0: 100 < 102 -> A.
        assert.equal(compare(five(100), five(102), 1.0), 'A');
    });

    test('compare: A / B symmetric', () => {
        // 90 < 0.95 x 100 = 95 -> A.
        assert.equal(compare(five(90), five(100)), 'A');
        assert.equal(compare(five(100), five(90)), 'B');
    });

    test('compare: exactly at the band is TIE (strict <), a hair below wins', () => {
        // band 0.5: 50 < 0.5 x 100 = 50 is false (strict) -> TIE; 49.9 < 50 -> A.
        assert.equal(compare([50], [100], 0.5), 'TIE');
        assert.equal(compare([49.9], [100], 0.5), 'A');
        assert.equal(compare([100], [50], 0.5), 'TIE');
        assert.equal(compare([100], [49.9], 0.5), 'B');
        // default band, 95 vs 100: 95 < 0.95 x 100 = 95 is false -> TIE; 94.9 -> A.
        assert.equal(compare([95], [100]), 'TIE');
        assert.equal(compare([94.9], [100]), 'A');
    });

    test('compare decides on the MIN of each list (R-BA41), not the median', () => {
        // a = [100, 900, 100, 1, 100]: min 1 (median 100). b = five(50): min 50.
        // min: 1 < 0.95 x 50 = 47.5 -> 'A'. A median mutant: 100 vs 50 -> 50 < 95 -> 'B'.
        assert.equal(compare([100, 900, 100, 1, 100], five(50)), 'A');
        // a = five(100): min 100. b = [90, 200, 200, 200, 200]: min 90.
        // min: 90 < 0.95 x 100 = 95 -> 'B'. A median mutant: 100 vs 200 -> 100 < 190 -> 'A'.
        assert.equal(compare(five(100), [90, 200, 200, 200, 200]), 'B');
        // [1, 100, 100, 100, 900] vs five(100): min 1 < 95 -> 'A' (the old median rule said TIE).
        assert.equal(compare([1, 100, 100, 100, 900], five(100)), 'A');
        // even length: min [10, 20] = 10; 10 vs 100 -> A.
        assert.equal(compare([10, 20], [100]), 'A');
        // a high outlier does not move the min: [100, 900, 900, 900, 900] vs five(100) -> TIE.
        assert.equal(compare([100, 900, 900, 900, 900], five(100)), 'TIE');
    });

    test('minOfList: min, input not mutated, fail closed like median', () => {
        const xs = [5, 1, 4, 2, 3];
        assert.equal(minOfList(xs), 1);
        assert.deepEqual(xs, [5, 1, 4, 2, 3]);
        assert.equal(minOfList([7]), 7);
        assert.equal(minOfList([2.5, 2.25]), 2.25);
        assert.throws(() => minOfList([]), /non-empty array/);
        assert.throws(() => minOfList([1, 0, 3]), /must be a finite number > 0/);
        assert.throws(() => minOfList([1, NaN]), /must be a finite number > 0/);
    });

    test('median: odd, even, order-independent, input not mutated', () => {
        const xs = [5, 1, 4, 2, 3];
        assert.equal(median(xs), 3);
        assert.deepEqual(xs, [5, 1, 4, 2, 3]);
        assert.equal(median([4, 1, 3, 2]), 2.5); // (2 + 3) / 2
        assert.equal(median([7]), 7);
    });

    test('rotateLabels: rotate left by pass mod len, new array, input untouched', () => {
        const labels = ['a', 'b', 'c', 'd', 'e', 'f'];
        const r = rotateLabels(labels, 7); // 7 mod 6 = 1
        assert.equal(r[0], labels[1]);
        assert.deepEqual(r, ['b', 'c', 'd', 'e', 'f', 'a']);
        assert.notEqual(r, labels);
        assert.deepEqual(labels, ['a', 'b', 'c', 'd', 'e', 'f']);
        assert.deepEqual(rotateLabels(labels, 0), labels);
        assert.notEqual(rotateLabels(labels, 0), labels);
        assert.deepEqual(rotateLabels(labels, 6), labels);
        assert.deepEqual(rotateLabels(labels, 2), ['c', 'd', 'e', 'f', 'a', 'b']);
    });

    test('runValues / medianOfK: pass 1 = the cell, passes 2..K = repeats, in order', () => {
        const c = cell('SumSequence', 'S7', 1024, [30, 10, 20, 50, 40]);
        assert.deepEqual(runValues(c, 'blend'), [30, 10, 20, 50, 40]);
        assert.equal(medianOfK(c, 'blend'), 30); // sorted 10 20 30 40 50
        assert.equal(minOfK(c, 'blend'), 10); // min of the five run values (pass order is irrelevant)
        assert.throws(() => minOfK(c, 'nope'), /has no phase 'nope'/);
        assert.equal(minOfK(mk('SumSequence', 'S7', 8, 12), 'blend'), 12);
        // no repeats: a single value
        assert.deepEqual(runValues(mk('SumSequence', 'S7', 8, 12), 'blend'), [12]);
    });
});

describe('A2: crossover, combineS1', () => {
    const GRID = [1024, 2048, 4096, 8192, 16384, 32768, 65536, 262144, 1000000];

    test('S1 shape: rival wins 1024..8192, SS 16384, rival 32768, SS 65536.. -> 65536 (not 16384)', () => {
        const v = ['B', 'B', 'B', 'B', 'A', 'B', 'A', 'A', 'A'];
        assert.equal(crossover(GRID, v), 65536);
    });

    test('a TIE inside the tail breaks the run', () => {
        // A at 65536, TIE at 262144, A at 1000000 -> only 1000000 is "from here on".
        assert.equal(crossover(GRID, ['B', 'B', 'B', 'B', 'A', 'B', 'A', 'TIE', 'A']), 1000000);
    });

    test('a rival win in the tail breaks the run', () => {
        assert.equal(crossover(GRID, ['A', 'A', 'A', 'A', 'A', 'A', 'A', 'B', 'A']), 1000000);
    });

    test('a non-A last verdict -> none up to <largest n>', () => {
        assert.equal(crossover(GRID, ['B', 'B', 'B', 'B', 'B', 'B', 'B', 'B', 'B']), 'none up to 1000000');
        assert.equal(crossover(GRID, ['A', 'A', 'A', 'A', 'A', 'A', 'A', 'A', 'TIE']), 'none up to 1000000');
    });

    test('all A -> the smallest n', () => {
        assert.equal(crossover(GRID, GRID.map(() => 'A')), 1024);
        assert.equal(crossover([8], ['A']), 8);
        assert.equal(crossover([8], ['TIE']), 'none up to 8');
    });

    test('combineS1: the larger; a "none up to" string dominates', () => {
        assert.equal(combineS1(16384, 65536), 65536);
        assert.equal(combineS1(65536, 16384), 65536);
        assert.equal(combineS1(16384, 'none up to 1000000'), 'none up to 1000000');
        assert.equal(combineS1('none up to 1000000', 65536), 'none up to 1000000');
        // two strings: numerically larger bound (1000000 > 8192; a lexical compare would say 8192).
        assert.equal(combineS1('none up to 8192', 'none up to 1000000'), 'none up to 1000000');
        assert.equal(combineS1('none up to 1000000', 'none up to 8192'), 'none up to 1000000');
    });
});

describe('A2: twinControl / lossRows / abSummary', () => {
    const NS = [1024, 8192, 65536];

    // S7 fixture (min-of-K, R-BA41): SS blend runs [100,900,100,140,100] -> min 100 (high outliers only,
    // so min and median agree), FenwickRebuild.suffix min 50 (wins: 50 < 95), BlockedArray min 100 (TIE),
    // twin [100,101,99,100,100] min 99: 99 < 95 false and 100 < 94.05 false -> TIE.
    const s7 = () => {
        const r = {};
        for (const n of NS) {
            put(r, 'SumSequence', 'S7', n, [100, 900, 100, 140, 100]);
            put(r, 'FenwickRebuild.suffix', 'S7', n, five(50));
            put(r, 'BlockedArray', 'S7', n, five(100));
            put(r, 'BlockedArray.twin', 'S7', n, [100, 101, 99, 100, 100]);
        }
        return r;
    };

    test('S7: exactly one row for FenwickRebuild.suffix; twin never a row; conclusive', () => {
        const out = lossRows(s7());
        assert.equal(out.inconclusive, false);
        assert.deepEqual(out.twin, []);
        assert.equal(out.rows.length, 1);
        const row = out.rows[0];
        assert.equal(row.scenario, 'S7');
        assert.equal(row.winner, 'FenwickRebuild.suffix');
        assert.equal(row.loser, 'SumSequence');
        assert.equal(row.crossoverN, 'none up to 65536');
        assert.equal(typeof row.reason, 'string');
        assert.ok(row.reason.length > 0);
        assert.ok(!/^INCONCLUSIVE/.test(row.reason));
        assert.ok(!/GO|NO-GO/.test(row.reason));
        assert.deepEqual(Object.keys(row).sort(), ['crossoverN', 'loser', 'reason', 'scenario', 'winner']);
        for (const r of out.rows) assert.notEqual(r.winner, 'BlockedArray.twin');
    });

    test('S7 rows pass Bench validateResults inside a payload', () => {
        const out = lossRows(s7());
        const payload = {
            schema: 'yggdrasil-bench/1', status: 'PENDING',
            meta: {
                seed: 1, node: 'v22.0.0', arch: 'arm64', platform: 'darwin', cpuModel: 'Fixture CPU', cpuCount: 8,
                date: '2026-10-31T12:00:00.000Z', sentinel: null, loadAvgStart: [0.5, 0.5, 0.5], loadAvgEnd: [0.6, 0.6, 0.6],
                hostState: 'PRELIMINARY', quietLockWhy: 'fixture', commit: 'abcdef0', mainFileSha: '0123abcd', runCount: 5,
                command: 'node benchmark/Bench.mjs', rivals: {},
            },
            subjects: ['SumSequence'], dimensions: [], titles: {}, scenarios: [], results: {}, lossTable: out.rows,
        };
        assert.equal(validateResults(payload), true);
        // and a mutated row (winner === loser) is refused, so the check has teeth
        payload.lossTable = [{ ...out.rows[0], winner: 'SumSequence' }];
        assert.throws(() => validateResults(payload), /lossTable\[0\]\.loser/);
    });

    test('crossoverN per rival: lost at 1024 only -> 8192; rival TIE gives no row; one row per (scenario, label)', () => {
        const r = {};
        // BlockedArray.plain: 40 vs SS 100 at 1024 (rival wins: 40 < 95); 200 at 8192 / 65536 (SS wins: 100 < 190).
        // FenwickRebuild.full in S2: 97 vs 100 is a TIE (97 < 95 false; 100 < 0.95 x 97 = 92.15 false).
        put(r, 'SumSequence', 'S1a', 1024, five(100));  put(r, 'BlockedArray.plain', 'S1a', 1024, five(40));
        put(r, 'SumSequence', 'S1a', 8192, five(100));  put(r, 'BlockedArray.plain', 'S1a', 8192, five(200));
        put(r, 'SumSequence', 'S1a', 65536, five(100)); put(r, 'BlockedArray.plain', 'S1a', 65536, five(200));
        // Other scenario, same label, never wins -> no row. Label that only TIEs -> no row.
        put(r, 'SumSequence', 'S2', 1024, five(100));   put(r, 'BlockedArray.plain', 'S2', 1024, five(200));
        put(r, 'SumSequence', 'S2', 8192, five(100));   put(r, 'FenwickRebuild.full', 'S2', 8192, five(97));
        const out = lossRows(r);
        assert.equal(out.inconclusive, false);
        assert.equal(out.rows.length, 1);
        // verdicts over [1024, 8192, 65536] = B, A, A -> smallest n from which A holds through the end = 8192.
        assert.deepEqual({ ...out.rows[0], reason: 0 }, {
            scenario: 'S1a', winner: 'BlockedArray.plain', loser: 'SumSequence', crossoverN: 8192, reason: 0,
        });
    });

    test('the rival wins blend only (another phase does not make a row)', () => {
        const r = {};
        const c = (m, blend, seek) => ({ member: m, scenario: 'S2', n: 64,
            phases: [{ phase: 'blend', nsPerOp: blend }, { phase: 'seek', nsPerOp: seek }] });
        r['SumSequence/S2@64'] = c('SumSequence', 100, 100);
        r['FenwickRebuild.full/S2@64'] = c('FenwickRebuild.full', 200, 10);
        assert.deepEqual(lossRows(r).rows, []);
    });

    test('twin not TIE -> inconclusive + reason prefix on every row; twin entry has verdict, phase, ratio', () => {
        const r = s7();
        // twin blend median 80 vs BlockedArray 100 at n = 8192 only: 80 < 95 -> A; ratio 0.8.
        put(r, 'BlockedArray.twin', 'S7', 8192, five(80));
        const out = lossRows(r);
        assert.equal(out.inconclusive, true);
        assert.equal(out.twin.length, 1);
        assert.equal(out.twin[0].scenario, 'S7');
        assert.equal(out.twin[0].n, 8192);
        assert.equal(out.twin[0].phase, 'blend');
        assert.equal(out.twin[0].verdict, 'A');
        assert.ok(Math.abs(out.twin[0].ratio - 0.8) < 1e-12);
        assert.ok(Math.abs(out.twin[0].minRatio - 0.8) < 1e-12);
        assert.deepEqual(Object.keys(out.twin[0]).sort(), ['minRatio', 'n', 'phase', 'ratio', 'scenario', 'verdict']);
        assert.equal(out.rows.length, 1);
        assert.ok(out.rows[0].reason.startsWith('INCONCLUSIVE (twin A/A not TIE at'), out.rows[0].reason);
        assert.ok(out.rows[0].reason.includes('S7@8192'));
        // twinControl agrees; a band of 0.7 (80 < 70 false, 100 < 56 false) calls it TIE again.
        assert.equal(twinControl(r).inconclusive, true);
        assert.equal(twinControl(r, { band: 0.7 }).inconclusive, false);
    });

    test('twin not TIE on a non-blend phase goes to noise and never gates (R-BA42)', () => {
        const r = {};
        put(r, 'SumSequence', 'S7', 64, five(100), five(5));
        put(r, 'BlockedArray', 'S7', 64, five(100), five(100));
        put(r, 'BlockedArray.twin', 'S7', 64, five(100), five(50)); // blend TIE; seek: 50 < 95 -> A
        const tc = twinControl(r);
        assert.equal(tc.inconclusive, false); // HEAD said true
        assert.deepEqual(tc.twin, []);
        assert.equal(tc.noise.length, 1);
        assert.equal(tc.noise[0].phase, 'seek');
        assert.equal(tc.noise[0].scenario, 'S7');
        assert.equal(tc.noise[0].n, 64);
        assert.equal(tc.noise[0].verdict, 'A');
        assert.equal(tc.noise[0].ratio, 0.5);
        assert.equal(tc.noise[0].minRatio, 0.5);
        assert.deepEqual(Object.keys(tc.noise[0]).sort(), ['minRatio', 'n', 'phase', 'ratio', 'scenario', 'verdict']);
        // the loss rows carry no INCONCLUSIVE prefix and the flag is false everywhere
        const loss = lossRows(r);
        assert.equal(loss.inconclusive, false);
        assert.deepEqual(loss.twin, []);
        assert.equal(abSummary(r, 'SumSequence', 'BlockedArray', 'blend').inconclusive, false);
        assert.ok(crossovers(r).every((e) => e.inconclusive === false));
        // no non-TIE anywhere -> noise is an empty array (present, not undefined)
        assert.deepEqual(twinControl(s7()).noise, []);
    });

    test('twin blend gates while the same pair also has a noisy seek: both lists filled, shapes equal', () => {
        const r = {};
        put(r, 'SumSequence', 'S7', 64, five(100), five(5));
        put(r, 'BlockedArray', 'S7', 64, five(100), five(100));
        // blend: min 60 vs 100 -> A (median 100 -> ratio 1, minRatio 0.6); seek [30,90,90,90,90]: min 30 -> A, ratio 0.9, minRatio 0.3.
        put(r, 'BlockedArray.twin', 'S7', 64, [60, 100, 100, 100, 100], [30, 90, 90, 90, 90]);
        const tc = twinControl(r);
        assert.equal(tc.inconclusive, true);
        assert.equal(tc.twin.length, 1);
        assert.equal(tc.noise.length, 1);
        assert.equal(tc.twin[0].phase, 'blend');
        assert.equal(tc.noise[0].phase, 'seek');
        assert.ok(Math.abs(tc.twin[0].ratio - 1) < 1e-12);      // median-of-K 100 / 100
        assert.ok(Math.abs(tc.twin[0].minRatio - 0.6) < 1e-12); // min 60 / 100
        assert.ok(Math.abs(tc.noise[0].ratio - 0.9) < 1e-12);   // median 90 / 100
        assert.ok(Math.abs(tc.noise[0].minRatio - 0.3) < 1e-12); // min 30 / 100
        assert.deepEqual(Object.keys(tc.twin[0]).sort(), Object.keys(tc.noise[0]).sort());
    });

    test('twin gate reads the MIN: blend medians equal but a low-run twin still gates; high outliers do not', () => {
        const r = {};
        put(r, 'SumSequence', 'S7', 64, five(100));
        put(r, 'BlockedArray', 'S7', 64, five(100));
        // twin median 100 (HEAD: TIE) but min 60 -> 60 < 95 -> A -> gates.
        put(r, 'BlockedArray.twin', 'S7', 64, [60, 100, 100, 100, 100]);
        assert.equal(twinControl(r).inconclusive, true);
        // twin min 100, high outliers only -> TIE -> conclusive.
        put(r, 'BlockedArray.twin', 'S7', 64, [100, 900, 900, 900, 900]);
        assert.equal(twinControl(r).inconclusive, false);
    });

    test('S2b one-phase bulk twin non-TIE gates (bulk is the crossover phase)', () => {
        const bulk = (member, v) => ({ member, scenario: 'S2b', n: 64, phases: [{ phase: 'bulk', nsPerOp: v }] });
        const r = {
            'SumSequence/S2b@64': bulk('SumSequence', 100),
            'BlockedArray/S2b@64': bulk('BlockedArray', 100),
            'BlockedArray.twin/S2b@64': bulk('BlockedArray.twin', 80), // 80 < 95 -> A
        };
        const tc = twinControl(r);
        assert.equal(tc.inconclusive, true);
        assert.equal(tc.twin.length, 1);
        assert.deepEqual(tc.noise, []);
        assert.equal(tc.twin[0].phase, 'bulk');
        assert.equal(tc.twin[0].verdict, 'A');
        assert.ok(Math.abs(tc.twin[0].minRatio - 0.8) < 1e-12);
        // the same pair at 100 is a TIE -> conclusive
        r['BlockedArray.twin/S2b@64'] = bulk('BlockedArray.twin', 100);
        assert.equal(twinControl(r).inconclusive, false);
    });

    test('twin seek 50 vs BlockedArray 100 with blend TIE: lossRows conclusive, noise[0] seek', () => {
        const r = {};
        put(r, 'SumSequence', 'S7', 64, five(100), five(100));
        put(r, 'BlockedArray', 'S7', 64, five(100), five(100));
        put(r, 'BlockedArray.twin', 'S7', 64, five(100), five(50));
        const tc = twinControl(r);
        assert.equal(tc.inconclusive, false);
        assert.deepEqual(tc.twin, []);
        assert.equal(tc.noise[0].phase, 'seek');
    });

    test('twin MISSING beside a BlockedArray cell -> inconclusive; none without BlockedArray', () => {
        const r = {};
        put(r, 'SumSequence', 'S7', 64, five(100));
        put(r, 'BlockedArray', 'S7', 64, five(100));
        const out = lossRows(r);
        assert.equal(out.inconclusive, true);
        assert.equal(out.twin[0].verdict, 'MISSING');
        assert.equal(out.twin[0].phase, null);
        assert.equal(out.twin[0].ratio, null);
        assert.equal(out.twin[0].minRatio, null); // a MISSING row still gates, with a null minRatio
        assert.deepEqual(Object.keys(out.twin[0]).sort(), ['minRatio', 'n', 'phase', 'ratio', 'scenario', 'verdict']);
        assert.deepEqual(twinControl(r).noise, []);
        const none = {};
        put(none, 'SumSequence', 'S7', 64, five(100));
        put(none, 'FenwickRebuild.full', 'S7', 64, five(100));
        assert.equal(twinControl(none).inconclusive, false);
        assert.deepEqual(twinControl(none).twin, []);
    });

    test('skips <adapter>/D<k> keys and ~c<chunkCap> sweep keys', () => {
        const r = s7();
        r['SumSequence/D1'] = { n: 1024 };
        r['BlockedArray/S7@8192~c252'] = withCap(cell('BlockedArray', 'S7', 8192, five(1)), 252); // would be a huge rival win if read
        const out = lossRows(r);
        assert.equal(out.rows.length, 1);
        assert.equal(out.inconclusive, false);
    });

    test('abSummary: verdict (min-of-K), ratio / a / b (median-of-K), aMin / bMin / minRatio per (scenario, n)', () => {
        const r = {};
        put(r, 'SumSequence', 'S7', 8, [100, 100, 100, 100, 100]);
        put(r, 'BlockedArray', 'S7', 8, [200, 200, 200, 200, 200]);
        put(r, 'SumSequence', 'S7', 16, [100, 100, 100, 100, 100]);
        put(r, 'BlockedArray', 'S7', 16, [101, 103, 99, 100, 102]); // min 99 -> TIE (99 < 95 false; 100 < 94.05 false)
        const out = abSummary(r, 'SumSequence', 'BlockedArray', 'blend');
        assert.equal(out.inconclusive, true); // BlockedArray without twin
        assert.equal(out.rows.length, 2);
        assert.equal(out.rows[0].n, 8);
        assert.equal(out.rows[0].verdict, 'A');
        assert.equal(out.rows[0].ratio, 0.5);
        assert.equal(out.rows[0].a, 100);
        assert.equal(out.rows[0].b, 200);
        assert.equal(out.rows[1].n, 16);
        assert.equal(out.rows[1].verdict, 'TIE');
        assert.equal(out.rows[1].b, 101);
        // new min-of-K fields: SS min 100 / 100; BlockedArray [101,103,99,100,102] min 99.
        assert.equal(out.rows[0].aMin, 100);
        assert.equal(out.rows[0].bMin, 200);
        assert.equal(out.rows[0].minRatio, 0.5);
        assert.equal(out.rows[1].aMin, 100);
        assert.equal(out.rows[1].bMin, 99);
        assert.ok(Math.abs(out.rows[1].minRatio - 100 / 99) < 1e-12);
        assert.ok(Math.abs(out.rows[1].ratio - 100 / 101) < 1e-12);
    });
});

describe('g2b-4 B2: abSummary min-of-K, lossRows text', () => {
    test('abSummary verdict follows the min while ratio / a / b stay median-of-K', () => {
        const r = {};
        put(r, 'SumSequence', 'S7', 8, five(100));
        // B = [96,120,120,120,120]: min 96 -> 100 < 91.2 no, 96 < 95 no -> TIE; median 120 -> 100 < 114 -> the old rule said A.
        put(r, 'BlockedArray', 'S7', 8, [96, 120, 120, 120, 120]);
        const out = abSummary(r, 'SumSequence', 'BlockedArray', 'blend');
        const row = out.rows[0];
        assert.equal(row.verdict, 'TIE');
        assert.equal(row.a, 100);
        assert.equal(row.b, 120);
        assert.ok(Math.abs(row.ratio - 100 / 120) < 1e-12);
        assert.equal(row.aMin, 100);
        assert.equal(row.bMin, 96);
        assert.ok(Math.abs(row.minRatio - 100 / 96) < 1e-12);
        assert.deepEqual(Object.keys(row).sort(), ['a', 'aMin', 'b', 'bMin', 'n', 'minRatio', 'ratio', 'scenario', 'verdict'].sort());
        // SS [80,100,100,100,100] (min 80, median 100) vs five(100): aMin 80 while a stays 100; 80 < 95 -> A.
        put(r, 'SumSequence', 'S7', 16, [80, 100, 100, 100, 100]);
        put(r, 'BlockedArray', 'S7', 16, five(100));
        const row2 = abSummary(r, 'SumSequence', 'BlockedArray', 'blend').rows[1];
        assert.equal(row2.n, 16);
        assert.equal(row2.aMin, 80);
        assert.equal(row2.a, 100);
        assert.equal(row2.bMin, 100);
        assert.equal(row2.verdict, 'A');
        assert.ok(Math.abs(row2.minRatio - 0.8) < 1e-12);
    });

    test('lossRows reason says "min-of-K below" and no longer "median-of-K below"', () => {
        const r = {};
        put(r, 'SumSequence', 'S7', 64, five(100));
        put(r, 'FenwickRebuild.suffix', 'S7', 64, five(50));
        const out = lossRows(r);
        assert.equal(out.rows.length, 1);
        assert.ok(out.rows[0].reason.includes('min-of-K below'), out.rows[0].reason);
        assert.ok(!out.rows[0].reason.includes('median-of-K'), out.rows[0].reason);
    });

    test('lossRows: a rival win rests on the min (SS high outliers do not hand the rival a win)', () => {
        const r = {};
        // SS min 100, median 100; rival [96,300,300,300,300]: min 96 -> TIE (96 < 95 no); no row.
        put(r, 'SumSequence', 'S7', 64, [100, 100, 100, 100, 100]);
        put(r, 'FenwickRebuild.suffix', 'S7', 64, [96, 300, 300, 300, 300]);
        assert.deepEqual(lossRows(r).rows, []);
        // rival [90,300,...]: min 90 < 95 -> B -> one row (a median rule says SS wins -> no row).
        put(r, 'FenwickRebuild.suffix', 'S7', 64, [90, 300, 300, 300, 300]);
        assert.equal(lossRows(r).rows.length, 1);
    });
});

describe('A2: pickChunkCap', () => {
    const GRID = [252, 504, 1004, 2008, 4016];
    const sweep = (nsList) => GRID.map((cc, i) => ({ ...mk('BlockedArray', 'S1a', 65536, nsList[i]), chunkCap: cc }));

    test('argmin in the middle, not edge; nsPerEvent = that median', () => {
        const out = pickChunkCap(sweep([30, 20, 10, 25, 40]));
        assert.deepEqual(out, { chunkCap: 1004, edge: false, nsPerEvent: 10 });
    });

    test('argmin at the first grid point -> edge', () => {
        const out = pickChunkCap(sweep([10, 20, 30, 40, 50]));
        assert.equal(out.chunkCap, 252);
        assert.equal(out.edge, true);
    });

    test('argmin at the last grid point -> edge', () => {
        const out = pickChunkCap(sweep([50, 40, 30, 20, 10]));
        assert.equal(out.chunkCap, 4016);
        assert.equal(out.edge, true);
    });

    test('exact tie -> the smaller chunkCap, whatever the input order', () => {
        const rows = sweep([20, 10, 10, 30, 40]); // 504 and 1004 tie at 10
        assert.equal(pickChunkCap(rows).chunkCap, 504);
        assert.equal(pickChunkCap(rows.slice().reverse()).chunkCap, 504);
        assert.equal(pickChunkCap(rows).edge, false);
    });

    test('pick stays median-of-K when the min-argmin differs (R-BA41: the pick is not a verdict)', () => {
        const mkc = (cc, runs) => withCap(cell('BlockedArray', 'S1a', 65536, runs), cc);
        // cap 252: runs [10,60,60,60,60] -> min 10, median 60. cap 504: five(40). cap 1004: five(70).
        // min-argmin = 252; median-argmin = 504 (median 40 < 60 < 70). The pick must return 504 / 40.
        const out = pickChunkCap([mkc(252, [10, 60, 60, 60, 60]), mkc(504, five(40)), mkc(1004, five(70))]);
        assert.deepEqual(out, { chunkCap: 504, edge: false, nsPerEvent: 40 });
        // the other direction: cap 504 runs [90,30,90,90,90] (min 30, median 90), cap 252 five(50):
        // min-argmin = 504 (30); median-argmin = 252 (50 < 90).
        const out2 = pickChunkCap([mkc(252, five(50)), mkc(504, [90, 30, 90, 90, 90]), mkc(1004, five(100))]);
        assert.deepEqual(out2, { chunkCap: 252, edge: true, nsPerEvent: 50 });
    });

    test('6-cell sweep (R-BA44): argmin at 4d reads edge false, at 8d edge true', () => {
        const G6 = sweepGrid(1004); // [252,504,1004,2008,4016,8032]; 4d = 4016, 8d = 8032
        const sw = (nsList) => G6.map((cc, i) => ({ ...mk('BlockedArray', 'S1a', 65536, nsList[i]), chunkCap: cc }));
        assert.deepEqual(pickChunkCap(sw([60, 50, 40, 30, 10, 20])), { chunkCap: 4016, edge: false, nsPerEvent: 10 });
        assert.deepEqual(pickChunkCap(sw([60, 50, 40, 30, 20, 10])), { chunkCap: 8032, edge: true, nsPerEvent: 10 });
        assert.deepEqual(pickChunkCap(sw([10, 50, 40, 30, 20, 60])), { chunkCap: 252, edge: true, nsPerEvent: 10 });
    });

    test('reads the median of K, not the first pass', () => {
        // cap 252 has pass 1 = 1 (lucky) but runs [1,50,50,50,50] -> median 50;
        // cap 504 has runs all 40 -> median 40; others median 60.
        const mkc = (cc, runs) => withCap(cell('BlockedArray', 'S1a', 65536, runs), cc);
        const out = pickChunkCap([
            mkc(252, [1, 50, 50, 50, 50]), mkc(504, five(40)), mkc(1004, five(60)),
        ]);
        assert.deepEqual(out, { chunkCap: 504, edge: false, nsPerEvent: 40 });
    });
});

describe('fail closed: throws carry the message', () => {
    const c = cell('SumSequence', 'S7', 8, five(10));

    test('missing phase', () => {
        assert.throws(() => runValues(c, 'nope'), /has no phase 'nope'/);
        assert.throws(() => medianOfK(c, 'nope'), /has no phase 'nope'/);
    });
    test('NaN / 0 / negative / non-number value', () => {
        for (const bad of [NaN, 0, -3, Infinity, '5']) {
            assert.throws(() => runValues(mk('SumSequence', 'S7', 8, bad), 'blend'), /must be a finite number > 0/, String(bad));
        }
        assert.throws(() => median([1, NaN, 3]), /must be a finite number > 0/);
        assert.throws(() => median([1, 0, 3]), /must be a finite number > 0/);
        assert.throws(() => compare([NaN], [1]), /must be a finite number > 0/);
    });
    test('a bad repeat is refused too', () => {
        const bad = cell('SumSequence', 'S7', 8, [10, 10, NaN, 10, 10]);
        assert.throws(() => runValues(bad, 'blend'), /repeats\[1\].*finite number > 0/);
    });
    test('empty list', () => {
        assert.throws(() => median([]), /must be a non-empty array/);
        assert.throws(() => compare([], [1]), /must be a non-empty array/);
        assert.throws(() => compare([1], []), /must be a non-empty array/);
    });
    test('unknown verdict / length mismatch in crossover', () => {
        assert.throws(() => crossover([1, 2], ['A', 'WIN']), /must be 'A', 'B' or 'TIE'/);
        assert.throws(() => crossover([1, 2], ['A']), /verdicts must be an array of grid\.length/);
        assert.throws(() => crossover([], []), /grid must be a non-empty array/);
    });
    test('combineS1 refuses junk', () => {
        assert.throws(() => combineS1(0, 5), /integer >= 1/);
        assert.throws(() => combineS1('soon', 5), /none up to/);
    });
    test('payload instead of results map', () => {
        const payload = { schema: 'yggdrasil-bench/1', status: 'PENDING', results: {} };
        assert.throws(() => lossRows(payload), /results map \(payload\.results\), not the payload/);
        assert.throws(() => twinControl(payload), /not the payload/);
        assert.throws(() => abSummary(payload, 'SumSequence', 'BlockedArray', 'blend'), /not the payload/);
    });
    test('unknown option key (did-you-mean) and bad key', () => {
        assert.throws(() => lossRows({}, { bnad: 0.9 }), /unknown option/);
        assert.throws(() => lossRows({ 'junk': {} }), /is not '<label>\/<Sid>@<n>/);
    });
    test('sweepGrid / defaultChunkCap / rotateLabels refuse bad input', () => {
        assert.throws(() => sweepGrid(10), /multiple of 4/);
        assert.throws(() => sweepGrid(4), /multiple of 4/);
        assert.throws(() => defaultChunkCap(0), /capacity must be an integer/);
        assert.throws(() => rotateLabels([], 1), /non-empty array/);
        assert.throws(() => rotateLabels(['a'], -1), /pass must be an integer >= 0/);
    });
    test('abSummary with no shared (scenario, n)', () => {
        const r = {};
        put(r, 'SumSequence', 'S7', 8, five(10));
        assert.throws(() => abSummary(r, 'SumSequence', 'BlockedArray', 'blend'), /no \(scenario, n\) holds both/);
    });
});

describe('g2b-3a r1: band, mixed K, twin config, tags, repeats, bulk-only, crossovers', () => {
    const NS = [1024, 8192, 65536];
    const s7 = () => {
        const r = {};
        for (const n of NS) {
            put(r, 'SumSequence', 'S7', n, [100, 900, 100, 140, 100]);
            put(r, 'FenwickRebuild.suffix', 'S7', n, five(50));
            put(r, 'BlockedArray', 'S7', n, five(100));
            put(r, 'BlockedArray.twin', 'S7', n, [100, 101, 99, 100, 100]);
        }
        return r;
    };

    test('band: null / undefined throw; > 1 throws; band reaches twinControl', () => {
        const r = s7();
        const msg = /band must be a number in \(0, 1\], got /;
        assert.throws(() => lossRows(r, { band: null }), /band must be a number in \(0, 1\], got null/);
        assert.throws(() => lossRows(r, { band: undefined }), msg);
        assert.throws(() => abSummary(r, 'SumSequence', 'BlockedArray', 'blend', { band: null }), /got null/);
        assert.throws(() => abSummary(r, 'SumSequence', 'BlockedArray', 'blend', { band: undefined }), msg);
        assert.throws(() => compare([1], [1], 1.5), /band must be/);
        // twin-80 fixture: 80 vs 100 at 8192; band 0.7 -> 80 < 70 false, 100 < 56 false -> TIE -> conclusive.
        put(r, 'BlockedArray.twin', 'S7', 8192, five(80));
        assert.equal(lossRows(r).inconclusive, true);
        assert.equal(lossRows(r, { band: 0.7 }).inconclusive, false);
        assert.deepEqual(crossovers(r, { band: 0.7 }).map((e) => e.inconclusive), [false, false]);
        assert.equal(lossRows(s7(), { band: 0.4 }).rows.length, 0); // 50 < 40 false, 100 < 20 false -> TIE
    });

    test('mixed K in the map: a cell with 4 runs among 5-run cells throws', () => {
        const r = s7();
        put(r, 'FenwickRebuild.suffix', 'S7', 8192, [50, 50, 50, 50]);
        assert.throws(() => twinControl(r), /cell '.*' has 4 runs, other cells 5 \(a failed or missing pass\)/);
        assert.throws(() => lossRows(r), /has 4 runs, other cells 5/);
        const q = s7();
        q['BlockedArray/S7@8192~c252'] = withCap(cell('BlockedArray', 'S7', 8192, [1, 1]), 252);
        assert.throws(() => lossRows(q), /has 2 runs, other cells 5/);
    });

    test('mixed K in a pick: rows[i] has 4 runs, rows[0] 5', () => {
        const mkc = (cc, runs) => withCap(cell('BlockedArray', 'S1a', 64, runs), cc);
        assert.throws(() => pickChunkCap([mkc(12, five(10)), mkc(20, [10, 10, 10, 10])]),
            /pickChunkCap rows\[1\] has 4 runs, rows\[0\] 5/);
    });

    test('twin config: twin chunkCap != BlockedArray chunkCap is not an A/A pair', () => {
        const r = {};
        put(r, 'SumSequence', 'S7', 64, five(100));
        r['BlockedArray/S7@64'] = withCap(cell('BlockedArray', 'S7', 64, five(100)), 252);
        r['BlockedArray.twin/S7@64'] = withCap(cell('BlockedArray.twin', 'S7', 64, five(100)), 504);
        assert.throws(() => twinControl(r), /twinControl S7@64: twin chunkCap 504 != BlockedArray 252 \(not an A\/A pair\)/);
    });

    test('bad tag: key ~c252 holding chunkCap 504', () => {
        const r = {};
        r['BlockedArray/S7@64~c252'] = withCap(cell('BlockedArray', 'S7', 64, five(100)), 504);
        assert.throws(() => lossRows(r), /cell 'BlockedArray\/S7@64~c252' has chunkCap 504, its key tag ~c252/);
    });

    test('repeat mismatch: other n, other chunkCap', () => {
        const c = cell('SumSequence', 'S7', 8, five(10));
        c.repeats[0] = { ...c.repeats[0], n: 16 };
        assert.throws(() => runValues(c, 'blend'), /cell\.repeats\[0\] names another cell/);
        const d = withCap(cell('BlockedArray', 'S1a', 8, five(10)), 12);
        d.repeats[0] = { ...d.repeats[0], chunkCap: 20 };
        assert.throws(() => runValues(d, 'blend'), /cell\.repeats\[0\] names another cell/);
    });

    test('no blend phase and more than one phase throws (crossovers and pick)', () => {
        const two = (member, cc) => ({ member, scenario: 'S7', n: 64, ...(cc ? { chunkCap: cc } : {}),
            phases: [{ phase: 'seek', nsPerOp: 5 }, { phase: 'bulk', nsPerOp: 6 }] });
        const r = { 'SumSequence/S7@64': two('SumSequence'), 'FenwickRebuild.full/S7@64': two('FenwickRebuild.full') };
        assert.throws(() => lossRows(r), /has no 'blend' phase and more than one phase/);
        assert.throws(() => crossovers(r), /has no 'blend' phase and more than one phase/);
        const rt = { 'BlockedArray/S7@64': two('BlockedArray'), 'BlockedArray.twin/S7@64': two('BlockedArray.twin') };
        assert.throws(() => twinControl(rt), /twinControl S7@64 has no 'blend' phase and more than one phase/);
        assert.throws(() => pickChunkCap([two('BlockedArray', 12), two('BlockedArray', 20)]),
            /has no 'blend' phase and more than one phase/);
    });

    test('S2b bulk-only: one row for FenwickRebuild.suffix; bulk-only pick is the argmin', () => {
        const bulk = (member, scenario, n, runs) => {
            const one = (v) => ({ member, scenario, n, phases: [{ phase: 'bulk', nsPerOp: v }] });
            return { ...one(runs[0]), repeats: runs.slice(1).map(one) };
        };
        const r = {};
        for (const n of [64, 512]) {
            r['SumSequence/S2b@' + n] = bulk('SumSequence', 'S2b', n, [100, 100, 100, 100, 100]);
            // 50 < 0.95 x 100 -> the rival wins at both n.
            r['FenwickRebuild.suffix/S2b@' + n] = bulk('FenwickRebuild.suffix', 'S2b', n, five(50));
        }
        const out = lossRows(r);
        assert.equal(out.rows.length, 1);
        const row = out.rows[0];
        assert.equal(row.scenario, 'S2b');
        assert.equal(row.winner, 'FenwickRebuild.suffix');
        assert.equal(row.loser, 'SumSequence');
        assert.equal(row.crossoverN, 'none up to 512');
        assert.ok(row.reason.endsWith(' (largest measured n 512)'), row.reason);
        assert.ok(row.reason.includes('bulk'), row.reason);
        const cap = (cc, v) => withCap({ ...bulk('BlockedArray', 'S2b', 512, five(v)) }, cc);
        // medians 30, 10, 20 over caps 12, 20, 36 -> argmin cap 20 (middle, not edge).
        assert.deepEqual(pickChunkCap([cap(12, 30), cap(20, 10), cap(36, 20)]), { chunkCap: 20, edge: false, nsPerEvent: 10 });
    });

    test('survivors: no SumSequence cell; key/cell mismatch; duplicate phase; twin extra phase', () => {
        assert.throws(() => lossRows({ 'BlockedArray.plain/S7@64': mk('BlockedArray.plain', 'S7', 64, 5) }),
            /has no SumSequence cell/);
        assert.throws(() => lossRows({ 'SumSequence/S7@64': mk('SumSequence', 'S7', 128, 5) }),
            /does not name its key/);
        const dup = { member: 'SumSequence', scenario: 'S7', n: 64,
            phases: [{ phase: 'blend', nsPerOp: 5 }, { phase: 'blend', nsPerOp: 6 }] };
        assert.throws(() => runValues(dup, 'blend'), /twice/);
        const r = {};
        put(r, 'SumSequence', 'S7', 64, five(100));
        put(r, 'BlockedArray', 'S7', 64, five(100));
        put(r, 'BlockedArray.twin', 'S7', 64, five(100), five(5));
        assert.throws(() => twinControl(r), /list other phases/);
    });

    test('crossovers: S7 shape, ordered by rival label, TIE-only rival included, twin absent', () => {
        const out = crossovers(s7());
        // BlockedArray 100 vs SS median 100 -> TIE x3; FenwickRebuild.suffix 50 vs 100 -> B x3.
        // 'BlockedArray' < 'FenwickRebuild.suffix' in code-unit order.
        assert.deepEqual(out, [
            { scenario: 'S7', rival: 'BlockedArray', phase: 'blend', grid: NS, verdicts: ['TIE', 'TIE', 'TIE'], crossoverN: 'none up to 65536', inconclusive: false },
            { scenario: 'S7', rival: 'FenwickRebuild.suffix', phase: 'blend', grid: NS, verdicts: ['B', 'B', 'B'], crossoverN: 'none up to 65536', inconclusive: false },
        ]);
        assert.ok(!out.some((e) => e.rival === 'BlockedArray.twin'));
    });

    test('crossovers: a missing twin marks every entry inconclusive (BA-29)', () => {
        const miss = s7();
        assert.ok('BlockedArray.twin/S7@1024' in miss);
        delete miss['BlockedArray.twin/S7@1024'];
        for (const l of ['SumSequence', 'BlockedArray', 'BlockedArray.twin']) put(miss, l, 'S1a', 1024, five(100));
        const out = crossovers(miss);
        assert.ok(out.length > 0);
        assert.ok(out.every((e) => e.inconclusive === true));
    });
});
