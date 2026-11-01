/**
 * @zakkster/lite-yggdrasil -- benchmark/Compare.mjs oracle (node:test), Bench-ADOPT g2b-3a B4.
 *
 * Independent oracle: every expected value is hand-derived from SPEC-bench-adopt CURRENT
 * BA-28..BA-31 and PLAN-bench-adopt-g2b3a ASSERTIONS A1 / A2 (arithmetic in comments), never
 * copied from Compare.mjs output. Compare.mjs was read for signatures and throw messages only.
 * Each value rule names the mutant a row would catch. Pure + cold: no clock, no PRNG. ASCII only.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';

import {
    K, BAND, CAP_MIN, CAP_MAX, defaultChunkCap, sweepGrid, rotateLabels, median, runValues, medianOfK,
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

    test('sweepGrid: 36 -> [12,20,36,72,144]; 1004 -> [252,504,1004,2008,4016]', () => {
        // 36 x {1/4,1/2,1,2,4} = 9, 18, 36, 72, 144 -> up to a multiple of 4 = 12, 20, 36, 72, 144.
        assert.deepEqual(sweepGrid(36), [12, 20, 36, 72, 144]);
        // 1004 x ... = 251, 502, 1004, 2008, 4016 -> 252, 504, 1004, 2008, 4016.
        assert.deepEqual(sweepGrid(1004), [252, 504, 1004, 2008, 4016]);
    });

    test('sweepGrid: round UP (not nearest/down): 20 -> 5,10,20,40,80 -> [8,12,20,40,80]', () => {
        // 5 -> 8 (round up 8, also the clamp floor); 10 -> 12 (down/nearest would give 8 / 12).
        assert.deepEqual(sweepGrid(20), [8, 12, 20, 40, 80]);
    });

    test('sweepGrid: low clamp + dedupe: 8 -> 2,4,8,16,32 -> 8,8,8,16,32 -> [8,16,32]', () => {
        assert.deepEqual(sweepGrid(8), [8, 16, 32]);
        // 12 -> 3, 6, 12, 24, 48 -> up 4, 8, 12, 24, 48 -> clamp 8, 8, 12, 24, 48 -> dedupe.
        assert.deepEqual(sweepGrid(12), [8, 12, 24, 48]);
    });

    test('sweepGrid: high clamp + dedupe', () => {
        // 65536 -> 16384, 32768, 65536, 131072, 262144 -> clamp the last two to 65536 -> dedupe.
        assert.deepEqual(sweepGrid(65536), [16384, 32768, 65536]);
        // 32768 -> 8192, 16384, 32768, 65536, 131072 -> clamp last to 65536 (already present).
        assert.deepEqual(sweepGrid(32768), [8192, 16384, 32768, 65536]);
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

    test('compare uses the median of K (BA-28), not first/mean/min', () => {
        // a = [1, 100, 100, 100, 900]: median 100 (min 1, mean 240.2, first 1).
        // b = [100 x 5]: median 100 -> TIE. A min/first/mean mutant says A or B.
        assert.equal(compare([1, 100, 100, 100, 900], five(100)), 'TIE');
        // even length: median [10, 20] = 15; 15 vs 100 -> A.
        assert.equal(compare([10, 20], [100]), 'A');
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

    // S7 fixture: SS blend median 100 (outliers 900 and 1 in the runs: min/first/mean would flip it),
    // FenwickRebuild.suffix median 50 (wins: 50 < 95), BlockedArray + twin median 100 (TIE).
    const s7 = () => {
        const r = {};
        for (const n of NS) {
            put(r, 'SumSequence', 'S7', n, [100, 900, 100, 1, 100]);
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
        assert.equal(out.rows.length, 1);
        assert.ok(out.rows[0].reason.startsWith('INCONCLUSIVE (twin A/A not TIE at'), out.rows[0].reason);
        assert.ok(out.rows[0].reason.includes('S7@8192'));
        // twinControl agrees; a band of 0.7 (80 < 70 false, 100 < 56 false) calls it TIE again.
        assert.equal(twinControl(r).inconclusive, true);
        assert.equal(twinControl(r, { band: 0.7 }).inconclusive, false);
    });

    test('twin not TIE on a non-blend phase is still inconclusive (fail closed over every shared phase)', () => {
        const r = {};
        put(r, 'SumSequence', 'S7', 64, five(100), five(5));
        put(r, 'BlockedArray', 'S7', 64, five(100), five(100));
        put(r, 'BlockedArray.twin', 'S7', 64, five(100), five(50)); // seek: 50 < 95 -> A
        const tc = twinControl(r);
        assert.equal(tc.inconclusive, true);
        assert.equal(tc.twin.length, 1);
        assert.equal(tc.twin[0].phase, 'seek');
    });

    test('twin MISSING beside a BlockedArray cell -> inconclusive; none without BlockedArray', () => {
        const r = {};
        put(r, 'SumSequence', 'S7', 64, five(100));
        put(r, 'BlockedArray', 'S7', 64, five(100));
        const out = lossRows(r);
        assert.equal(out.inconclusive, true);
        assert.equal(out.twin[0].verdict, 'MISSING');
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

    test('abSummary: verdict, ratio, medians per (scenario, n)', () => {
        const r = {};
        put(r, 'SumSequence', 'S7', 8, [100, 100, 100, 100, 100]);
        put(r, 'BlockedArray', 'S7', 8, [200, 200, 200, 200, 200]);
        put(r, 'SumSequence', 'S7', 16, [100, 100, 100, 100, 100]);
        put(r, 'BlockedArray', 'S7', 16, [101, 103, 99, 100, 102]); // median 101 -> TIE (100 < 95.95 false)
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
        assert.ok(Math.abs(out.rows[1].ratio - 100 / 101) < 1e-12);
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
            put(r, 'SumSequence', 'S7', n, [100, 900, 100, 1, 100]);
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
