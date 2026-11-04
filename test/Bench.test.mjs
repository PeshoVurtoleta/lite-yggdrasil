/**
 * @zakkster/lite-yggdrasil -- benchmark suite GATE (node:test), Bench-ADOPT group 1 / B4.
 *
 * Independent oracle: every expected value below comes from the SPEC / PLAN ASSERTIONS
 * (A1-A6), from the engine's published bound (test/spec-counts.mjs, recomputed here from the
 * row's own fields) or from hand arithmetic -- never from copying what the implementation
 * printed. The B3 block (Bench.mjs / Readme.mjs) imports dynamically so the rest runs without it.
 * ASCII only.
 */

import test, { describe, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { SumSequence } from '../Yggdrasil.js';
import {
    NA, NC, COUNTER_NAMES, ADAPTERS, RIVAL_SLOTS, RETIRED_SLOTS, SumSequenceAdapter, SpliceFoilAdapter,
    validateAdapter, validateCounts, countsRecord, selectAdapter, didYouMean,
} from '../benchmark/Adapters.mjs';
import { SCENARIOS, validateScenario, selectScenario } from '../benchmark/Scenarios.mjs';
import { D1, D2, traceHash, vacuityCheck, SIZES } from '../benchmark/Dimensions.mjs';
import { bootstrapCI, mannWhitney, DEFAULT_SEED } from '../benchmark/Harness.mjs';
import { validateManifest } from '../benchmark/Template.mjs';
import { classifyClaim, CLAIM_CLASS } from '../benchmark/Matrix.mjs';
import { Lmax, touchesMax } from './spec-counts.mjs';

const PKG = new URL('..', import.meta.url).pathname;
const SEED = 0x9e3779b1 >>> 0;
// Engine default leaf size (Yggdrasil.d.ts: leafSize?: 4|8|16|32, default 16). Pinned here on
// purpose -- NOT imported from Dimensions.mjs, so a wrong leaf size in the bench is caught.
const LEAF = 16;
const TOUCH_HIT = 0; // byRow[0] (C-25 row HIT)

// Spec order of the 12 engine counters (touches..seamRepairs), pinned independently.
const SPEC_NAMES = ['touches', 'pulls', 'moves', 'splits', 'merges', 'equalizes', 'rotSingle', 'rotDouble',
    'fingerHits', 'fingerMisses', 'joinSteps', 'seamRepairs'];

// ============================================================================================
// A2 -- counts shape
// ============================================================================================

describe('A2: counts shape', () => {
    test('COUNTER_NAMES / NC are the 12 spec names in order', () => {
        assert.equal(NC, 12);
        assert.deepEqual([...COUNTER_NAMES], SPEC_NAMES);
        assert.equal(NA, 'n/a');
    });

    const ssRec = () => {
        const h = SumSequenceAdapter.create(64, 1);
        for (let i = 0; i < 20; i++) h.insertAt(i, i, 1 + i);
        const c = new Int32Array(NC);
        h.readCounts(c);
        return countsRecord(SumSequenceAdapter, c, undefined);
    };

    test('SumSequence record: 12/12 integers, extras empty', () => {
        const rec = ssRec();
        assert.deepEqual(Object.keys(rec.counts), SPEC_NAMES);
        for (const k of SPEC_NAMES) assert.ok(Number.isInteger(rec.counts[k]) && rec.counts[k] >= 0, k);
        assert.deepEqual(rec.extras, {});
        assert.equal(validateCounts(SumSequenceAdapter, rec), true);
    });

    test('SpliceFoil record: exactly 1 integer (moves) + 11 n/a, extras {rebuilt}', () => {
        const h = SpliceFoilAdapter.create(64, 1);
        for (let i = 0; i < 20; i++) h.insertAt(i, i, 1 + i);
        const c = new Int32Array(NC);
        const x = new Float64Array(SpliceFoilAdapter.extraCounts.length);
        h.readCounts(c);
        h.readExtras(x);
        const rec = countsRecord(SpliceFoilAdapter, c, x);
        const ints = SPEC_NAMES.filter((k) => Number.isInteger(rec.counts[k]));
        assert.deepEqual(ints, ['moves']);
        for (const k of SPEC_NAMES) if (k !== 'moves') assert.equal(rec.counts[k], 'n/a', k);
        assert.deepEqual(Object.keys(rec.extras), ['rebuilt']);
        assert.equal(validateCounts(SpliceFoilAdapter, rec), true);
    });

    test('SpliceFoil insertAt(floor(n/2)) at n = 1024 -> moves == 512 (hand: n - i = 1024 - 512)', () => {
        const h = SpliceFoilAdapter.create(2048, 1);
        for (let i = 0; i < 1024; i++) h.insertAt(i, i, 1);
        h.resetCounts();
        h.insertAt(512, 7, 1);
        const c = new Int32Array(NC);
        h.readCounts(c);
        assert.equal(c[2], 512); // COUNTERS.moves is slot 2
        assert.equal(countsRecord(SpliceFoilAdapter, c, new Float64Array(1)).counts.moves, 512);
        h.resetCounts();
        h.removeAt(512); // hand: length 1025, removeAt(i) shifts n - i - 1 = 512
        h.readCounts(c);
        assert.equal(c[2], 512);
    });

    // One row per control: validateCounts must THROW on each mutation (and not on the clean record).
    const fresh = () => JSON.parse(JSON.stringify(ssRec()));
    const foilRec = () => {
        const c = new Int32Array(NC);
        c[2] = 5;
        return JSON.parse(JSON.stringify(countsRecord(SpliceFoilAdapter, c, Float64Array.of(3))));
    };
    test('validateCounts: the unmutated records pass (control baseline)', () => {
        assert.equal(validateCounts(SumSequenceAdapter, fresh()), true);
        assert.equal(validateCounts(SpliceFoilAdapter, foilRec()), true);
    });
    test('validateCounts throws: counts deleted', () => {
        const r = fresh(); delete r.counts;
        assert.throws(() => validateCounts(SumSequenceAdapter, r), /counts missing/);
    });
    test('validateCounts throws: a value -5', () => {
        const r = fresh(); r.counts.pulls = -5;
        assert.throws(() => validateCounts(SumSequenceAdapter, r), /pulls/);
    });
    test('validateCounts throws: extras value -1', () => {
        const r = foilRec(); r.extras.rebuilt = -1;
        assert.throws(() => validateCounts(SpliceFoilAdapter, r), /rebuilt/);
    });
    test('validateCounts throws: an undeclared extras key', () => {
        const r = foilRec(); r.extras.bogus = 1;
        assert.throws(() => validateCounts(SpliceFoilAdapter, r), /extras keys/);
        const s = fresh(); s.extras.bogus = 1;
        assert.throws(() => validateCounts(SumSequenceAdapter, s), /extras keys/);
    });
    test('validateCounts throws: a 0 in an n/a slot (null is not zero)', () => {
        const r = foilRec(); r.counts.touches = 0;
        assert.throws(() => validateCounts(SpliceFoilAdapter, r), /touches/);
    });
    test('validateCounts throws: a missing counter key', () => {
        const r = fresh(); delete r.counts.joinSteps;
        assert.throws(() => validateCounts(SumSequenceAdapter, r), /12 keys/);
    });
    test('validateCounts throws: an n/a string in a mapped slot', () => {
        const r = fresh(); r.counts.moves = 'n/a';
        assert.throws(() => validateCounts(SumSequenceAdapter, r), /moves/);
    });

    test('D1 timing + D2 rows with nsPerOp / p50 carry a 12-key counts record', () => {
        const rows = [];
        for (const m of ['SumSequence', 'SpliceFoil']) {
            const d1 = D1(m, { quick: true, sizes: [1024], timingSizes: [1024] });
            for (const r of d1.timing) rows.push([m, 'D1.timing', r]);
            const d2 = D2(m, { quick: true });
            for (const r of d2.points) rows.push([m, 'D2.points', r]);
        }
        let seen = 0;
        for (const [m, where, r] of rows) {
            if (!('nsPerOp' in r) && !('p50' in r)) continue;
            seen++;
            assert.ok(r.counts && typeof r.counts === 'object', m + ' ' + where + ' counts missing');
            assert.deepEqual(Object.keys(r.counts), SPEC_NAMES, m + ' ' + where);
            validateCounts(selectAdapter(m), r, m + ' ' + where);
            if (m === 'SumSequence') {
                for (const k of SPEC_NAMES) assert.ok(Number.isInteger(r.counts[k]), m + ' ' + k);
            } else {
                assert.equal(SPEC_NAMES.filter((k) => Number.isInteger(r.counts[k])).length, 1);
            }
        }
        // coverage floor: D1 timing (1 row) + D2 points (>= 2 checkpoints) for each of 2 members
        assert.ok(seen >= 2 * (1 + 2), 'rows checked: ' + seen);
    });
});

// ============================================================================================
// A3 -- D1 deterministic counts vs the published bound
// ============================================================================================

describe('A3: D1', () => {
    const ss = D1('SumSequence', { quick: true, timing: false, seed: SEED });
    const ss2 = D1('SumSequence', { quick: true, timing: false, seed: SEED });
    const foil = D1('SpliceFoil', { quick: true, timing: false, seed: SEED });

    // Independent recompute of one row's bound from its own fields (model: scratchpad recompute.mjs).
    function boundOf(row) {
        const L = Lmax(row.C, LEAF >> 2, 1);
        let want = -Infinity;
        row.byRow.forEach((c, t) => { if (c > 0) want = Math.max(want, touchesMax(t, L)); });
        return { L, want };
    }
    function checkRow(row, delta = 0) {
        assert.equal(row.leafSize, LEAF, 'engine default leaf size');
        const { L, want } = boundOf(row);
        assert.equal(row.L, L, row.op + ' n=' + row.n + ' L');
        assert.equal(row.maxBound, want + delta, row.op + ' n=' + row.n + ' maxBound');
        assert.ok(row.maxTouches <= want + delta, row.op + ' n=' + row.n + ' maxTouches ' + row.maxTouches + ' <= ' + (want + delta));
    }

    test('11 sizes 2^10..2^20, 9 op kinds each', () => {
        assert.deepEqual([...SIZES], Array.from({ length: 11 }, (_, i) => 1 << (10 + i)));
        const ns = [...new Set(ss.counts.map((r) => r.n))];
        assert.deepEqual(ns, [...SIZES]);
        assert.equal(ss.counts.length, 11 * 9);
    });

    test('every SumSequence row: L, maxBound recomputed independently; maxTouches <= bound', () => {
        for (const row of ss.counts) checkRow(row);
        assert.equal(ss.violations, 0);
        for (const row of ss.counts) assert.equal(row.violations, 0, row.op + ' n=' + row.n + ' per-op violations');
    });
    test('control: boundDelta -1 makes every HIT op a violation (HIT bound = touchesMax(HIT, L) = 0)', () => {
        const c = D1('SumSequence', { quick: true, timing: false, seed: SEED, sizes: [1024], boundDelta: -1 });
        const hit = c.counts.filter((r) => r.byRow[TOUCH_HIT] > 0);
        assert.ok(hit.length >= 1, 'coverage floor: HIT rows ' + hit.length);
        for (const r of hit) {
            assert.equal(touchesMax(TOUCH_HIT, r.L), 0);
            assert.ok(r.violations >= r.byRow[TOUCH_HIT], r.op + ' violations ' + r.violations);
        }
    });

    test('control: bound - 1 FAILS on a row with byRow[HIT] > 0 (equality side) and a maxTouches > bound row FAILS (<= side)', () => {
        const hit = ss.counts.filter((r) => r.byRow[TOUCH_HIT] > 0);
        assert.ok(hit.length >= 11, 'coverage floor: HIT rows ' + hit.length);
        for (const row of hit) assert.throws(() => checkRow(row, -1), /maxBound|maxTouches/);
        // The published bound is loose in this run, so no row is tight; prove the <= side bites
        // with a mutated copy whose maxTouches exceeds the recomputed bound.
        const row = hit[0];
        const { want } = boundOf(row);
        assert.throws(() => checkRow({ ...row, maxTouches: want + 1 }), /maxTouches/);
        // And the clean row still passes (the control is not vacuous).
        assert.doesNotThrow(() => checkRow(row));
    });

    test('SpliceFoil D1: 11 sizes, every row exact, moves/op at 2^20 == 524288 (hand: n - n/2 = 2^19)', () => {
        assert.equal(foil.counts.length, 11);
        for (const r of foil.counts) assert.equal(r.exact, true, 'n=' + r.n);
        const last = foil.counts[foil.counts.length - 1];
        assert.equal(last.n, 1048576);
        assert.equal(last.movesPerOp, 524288);
        assert.equal(last.moves, last.ops * 524288);
        // each size: moves per op == n - floor(n/2) (insert at the middle shifts the upper half)
        for (const r of foil.counts) assert.equal(r.movesPerOp, r.n - (r.n >>> 1), 'n=' + r.n);
    });

    test('two runs, one seed: identical counts + identical traceHash; traceHash present, no scriptHash key', () => {
        assert.deepEqual(ss.counts, ss2.counts);
        assert.equal(typeof ss.traceHash, 'number');
        assert.equal(ss.traceHash, ss2.traceHash);
        assert.ok(!('scriptHash' in ss) && !('scriptHash' in foil));
        for (const r of ss.counts) assert.ok(!('scriptHash' in r));
        assert.equal(typeof foil.traceHash, 'number');
        assert.equal(typeof traceHash, 'function');
    });

    test('control: a different seed moves the traceHash', () => {
        const other = D1('SumSequence', { quick: true, timing: false, sizes: [1024], seed: SEED ^ 0x5a5a });
        const same = D1('SumSequence', { quick: true, timing: false, sizes: [1024], seed: SEED });
        assert.notEqual(other.traceHash, same.traceHash);
    });
});

// ============================================================================================
// Scenarios / adapters fail closed
// ============================================================================================

describe('Scenarios and adapters', () => {
    // the R-BA15 shape (BA-17): id, title, dims, views, mix, adapters, sizes, build
    const good = () => ({ id: 'S1', title: 'splice', dims: 1, views: 1, mix: { events: 20000 }, adapters: ['SumSequence'],
        sizes: [1024], build() { return null; } });

    test('validateScenario: a plain valid object passes (control baseline)', () => {
        assert.equal(validateScenario(good()).id, 'S1');
    });
    test('validateScenario throws on a prototype-chain object carrying the keys', () => {
        const o = Object.create(good());
        assert.throws(() => validateScenario(o), /plain object/);
    });
    test('validateScenario throws on a Symbol key', () => {
        const o = good();
        o[Symbol('x')] = 1;
        assert.throws(() => validateScenario(o), /plain object/);
    });
    test('validateScenario throws on an unknown key with a did-you-mean', () => {
        const o = good();
        o.titel = 'x';
        assert.throws(() => validateScenario(o), /unknown key/);
    });
    test('selectScenario(BOGUS) throws; SCENARIOS holds exactly S1a, S1b, S2, S2a, S2b, S7 and S7b (g2b-2b, R-BA16 / R-BA22 / R-BA18)', () => {
        assert.throws(() => selectScenario('BOGUS'), /unknown scenario BOGUS/);
        assert.deepEqual(SCENARIOS.map((x) => x.id), ['S1a', 'S1b', 'S2', 'S2a', 'S2b', 'S7', 'S7b']);
    });

    test('selectAdapter: unknown name throws; near miss gets a did-you-mean at the helper', () => {
        assert.throws(() => selectAdapter('BOGUS'), /unknown adapter BOGUS/);
        assert.ok(ADAPTERS.length >= 2);
        assert.equal(selectAdapter('SumSequence'), SumSequenceAdapter);
        // g2b-1 registered every pending rival; the retired FenwickFixed slot fails closed naming R-BA18
        assert.equal(Object.keys(RIVAL_SLOTS).length, 0);
        assert.ok(Object.prototype.hasOwnProperty.call(RETIRED_SLOTS, 'FenwickFixed'));
        assert.throws(() => selectAdapter('FenwickFixed'), /RETIRED.*R-BA18/);
        assert.match(didYouMean('SumSequnce', ['SumSequence', 'SpliceFoil']), /did you mean 'SumSequence'/);
        assert.equal(didYouMean('zzzzzzzzzzzzzz', ['SumSequence']), '');
    });

    test('validateAdapter rejects an unknown role (and accepts the clean adapter)', () => {
        assert.doesNotThrow(() => validateAdapter(SumSequenceAdapter));
        assert.throws(() => validateAdapter({ ...SumSequenceAdapter, role: 'bogus' }), /role/);
        assert.throws(() => validateAdapter({ ...SumSequenceAdapter, bogusKey: 1 }), /unknown key/);
    });
});

// ============================================================================================
// K rows that apply (statistics, manifest, vacuity, doc gate)
// ============================================================================================

describe('K rows', () => {
    test('bootstrapCI: deterministic for one seed, moves with another, n < 8 -> n/a', () => {
        const samples = Array.from({ length: 50 }, (_, i) => i + 1);
        const a = bootstrapCI(samples, SEED);
        assert.deepEqual(a, bootstrapCI(samples, SEED));
        assert.ok(a.lo <= 25.5 && 25.5 <= a.hi, 'band brackets the median 25.5 (hand)');
        const c = bootstrapCI(samples, (SEED ^ 0x1234) >>> 0);
        assert.ok(c.lo !== a.lo || c.hi !== a.hi, 'a different seed moves the band');
        assert.equal(bootstrapCI([1, 2, 3], SEED), 'n/a');
        assert.equal(typeof DEFAULT_SEED, 'number');
    });

    test('mannWhitney: deterministic; identical -> not significant; separated -> significant; n < 8 -> n/a', () => {
        const x = Array.from({ length: 20 }, (_, i) => (i * 7 + 3) % 13);
        const same = mannWhitney(x, x.slice());
        assert.equal(same.significant, false);
        assert.deepEqual(same, mannWhitney(x, x.slice()));
        const a = Array.from({ length: 15 }, (_, i) => i + 1);
        const b = Array.from({ length: 15 }, (_, i) => i + 1001);
        assert.equal(mannWhitney(a, b).significant, true);
        assert.equal(mannWhitney([1, 2, 3], b), 'n/a');
    });

    test('validateManifest fails closed', () => {
        assert.throws(() => validateManifest({}), /members/);
        assert.throws(() => validateManifest({ members: ['A'] }), /subject/);
        assert.throws(() => validateManifest({ members: ['A'], subject() {} }), /primaryFoil/);
        assert.equal(validateManifest({ members: ['A'], subject() {}, primaryFoil() {} }), true);
    });

    test('vacuityCheck has teeth: a vacuous result is flagged, a real one is not', () => {
        assert.throws(() => vacuityCheck({ dim: 'DX', member: 'X', _check: [1, 0, 2] }), /impossible value/);
        assert.throws(() => vacuityCheck({ dim: 'DX', member: 'X', _check: [] }), /no _check values/);
        assert.throws(() => vacuityCheck({ dim: 'DX', member: 'X', _check: [1], counts: [] }), /empty array counts/);
        assert.equal(vacuityCheck({ dim: 'DX', member: 'X', _check: [1, 2.5] }), true);
        assert.equal(vacuityCheck(D1('SumSequence', { quick: true, timing: false, sizes: [1024] })), true);
    });

    test('doc gate: benchmark/METHODOLOGY.md has no timing-class "prove*" claim', () => {
        // teeth: the classifier does call a prove-line about timing a timing claim
        assert.equal(classifyClaim('the witness proves the straight O(log n) line'), CLAIM_CLASS.timing);
        const text = readFileSync(PKG + 'benchmark/METHODOLOGY.md', 'utf8');
        for (const line of text.split('\n')) {
            if (!/\b(prov(e[sdn]?|ing|en)|proof)\b/i.test(line)) continue; // word match: not "Provenance"
            assert.notEqual(classifyClaim(line), CLAIM_CLASS.timing, line.trim().slice(0, 90));
        }
    });
});

// ============================================================================================
// A5 -- kernel-lane (one child process)
// ============================================================================================

describe('A5: kernel-lane', () => {
    test('0.000 B/op on every lane, both controls FAIL as required, exit 0', { timeout: 330000 }, () => {
        const r = spawnSync(process.execPath, ['--expose-gc', '--no-concurrent-recompilation',
            '--min-semi-space-size=4', '--max-semi-space-size=4', PKG + 'benchmark/kernel-lane.mjs'],
        { encoding: 'utf8', timeout: 300000 });
        const out = String(r.stdout) + String(r.stderr);
        assert.equal(r.status, 0, out.slice(-1500));
        assert.match(out, /^control ctl\.retain: .*FAILS as required$/m);
        assert.match(out, /^\s+control ctl\.alloc bop=\S+ .*FAILS as required$/m);
        const ca = /^\s+control ctl\.alloc bop=(\S+) /m.exec(out);
        assert.ok(ca !== null && Number(ca[1]) > 8, 'ctl.alloc must read > 8 B/op, got ' + (ca && ca[1]));
        const cr = /^control ctl\.retain: cycles=\d+ size=(\d+) /m.exec(out);
        assert.ok(cr !== null && Number(cr[1]) >= 1, 'ctl.retain size must be >= 1, got ' + (cr && cr[1]));
        const lanes = [...out.matchAll(/^\s+lane (\S+) bop=(\S+) /gm)];
        assert.ok(lanes.length >= 6, 'lanes reported: ' + lanes.length);
        for (const m of lanes) assert.equal(m[2], '0.000', m[1]);
        assert.match(out, /^GATE kernel-lane lanes=\d+ worst=0\.000 B\/op .*\| ok$/m);
    });
});

// ============================================================================================
// B3-dependent rows (Bench.mjs / Readme.mjs; land with the coder's batch)
// ============================================================================================

describe('B3: Bench / Readme', () => {
    const META17 = ['seed', 'node', 'arch', 'platform', 'cpuModel', 'cpuCount', 'date', 'sentinel', 'loadAvgStart',
        'loadAvgEnd', 'hostState', 'quietLockWhy', 'commit', 'mainFileSha', 'runCount', 'command', 'rivals'];
    const PROV9 = ['date', 'node', 'platform', 'arch', 'cpuModel', 'loadAvgStart', 'hostState', 'commit', 'runCount'];
    let B, R;
    const pkg = JSON.parse(readFileSync(PKG + 'package.json', 'utf8'));

    before(async () => {
        B = await import('../benchmark/Bench.mjs');
        R = await import('../benchmark/Readme.mjs');
    });

    const meta = (hostState = 'PRELIMINARY') => ({
        seed: SEED, node: 'v22.0.0', arch: 'arm64', platform: 'darwin', cpuModel: 'Fixture CPU', cpuCount: 8,
        date: '2026-10-31T12:00:00.000Z', sentinel: null, loadAvgStart: [0.5, 0.5, 0.5], loadAvgEnd: [0.6, 0.6, 0.6], hostState,
        quietLockWhy: 'fixture', commit: 'abcdef0', mainFileSha: '0123abcd', runCount: 9973,
        command: 'node benchmark/Bench.mjs', rivals: {},
    });
    const TABLE_OPS = ['insertAt+removeAt', 'setMeasure', 'indexAtSum', 'sumBefore', 'mixed'];
    const row = () => {
        const c = new Int32Array(NC);
        c[0] = 3; c[1] = 4; c[2] = 5;
        return { n: 1024, ops: 64, nsPerOp: 100, ...countsRecord(SumSequenceAdapter, c, undefined) };
    };
    const d8 = (adapter, extras) => {
        const c = new Int32Array(NC);
        c[0] = 3; c[2] = 5;
        const rec = countsRecord(adapter, c, extras);
        return { n: 1024, rows: TABLE_OPS.map((op) => ({ op, ops: 64, nsPerOp: 100, ...rec })) };
    };
    const results = (status = 'PENDING', hostState = 'PRELIMINARY', lossTable = []) => ({
        schema: 'yggdrasil-bench/1', status, meta: meta(hostState),
        subjects: ['SumSequence'], dimensions: ['D1', 'D8'], titles: { D1: 'Splice witness' }, scenarios: [],
        foil: 'SpliceFoil',
        results: {
            'SumSequence/D1': row(),
            'SumSequence/D8': d8(SumSequenceAdapter, undefined),
            'SpliceFoil/D8': d8(SpliceFoilAdapter, Float64Array.of(2)),
        },
        lossTable,
    });
    const LOSS = [{ scenario: 'S1', winner: 'SumSequence', loser: 'SpliceFoil', crossoverN: 1024, reason: 'fixture' }];

    test('B2 MUST 1: meta.rivals carries FenwickFixed RETIRED with its R-BA18 reason, and validates', () => {
        const rv = B.rivalsMeta();
        assert.equal(rv.FenwickFixed.status, 'RETIRED');
        assert.equal(rv.FenwickFixed.version, NA);
        assert.equal(rv.FenwickFixed.params, NA);
        assert.match(rv.FenwickFixed.reason, /R-BA18/);
        const r = results();
        r.meta.rivals = rv;
        assert.doesNotThrow(() => B.validateResults(r));
        r.meta.rivals = { ...rv, FenwickFixed: { ...rv.FenwickFixed, status: 'GONE' } };
        assert.throws(() => B.validateResults(r), /meta\.rivals\.FenwickFixed\.status/);
    });
    test('TASK 6: crossCheck agrees on equal rows and throws "checksum mismatch" / "traceHash mismatch"', () => {
        const cell = (checksum, traceHash) => ({ phases: [{ phase: 'seek', checksum, traceHash }] });
        assert.equal(B.crossCheck({ 'SumSequence/S7@1024': cell(5, 9), 'BlockedArray.plain/S7@1024': cell(5, 9),
            'SumSequence/D1': {} }), 1);
        assert.throws(() => B.crossCheck({ 'SumSequence/S7@1024': cell(5, 9), 'FenwickRebuild.full/S7@1024': cell(6, 9) }),
            /checksum mismatch S7@1024 phase seek/);
        assert.throws(() => B.crossCheck({ 'SumSequence/S7@1024': cell(5, 9), 'FenwickRebuild.full/S7@1024': cell(5, 8) }),
            /traceHash mismatch/);
    });
    test('TASK 6 r1 BLOCKER 1: crossCheck throws "endState mismatch" on a planted end state (reweight checksum 0)', () => {
        const cell = (endState) => ({ phases: [{ phase: 'reweight', checksum: 0, endState, traceHash: 9 }] });
        assert.equal(B.crossCheck({ 'SumSequence/S7@1024': cell(7), 'FenwickRebuild.suffix/S7@1024': cell(7) }), 1);
        assert.throws(() => B.crossCheck({ 'SumSequence/S7@1024': cell(7), 'FenwickRebuild.suffix/S7@1024': cell(8) }),
            /endState mismatch S7@1024 phase reweight/);
    });
    test('TASK 6 r1 BLOCKER 3: 3 labels x 2 phases, only label 3 blend differs -> "checksum mismatch ... phase blend"', () => {
        const cell = (blend) => ({ phases: [{ phase: 'seek', checksum: 11, endState: 1, traceHash: 2 },
            { phase: 'blend', checksum: blend, endState: 3, traceHash: 4 }] });
        const ok = { 'SumSequence/S7@8': cell(21), 'BlockedArray/S7@8': cell(21), 'FenwickRebuild.full/S7@8': cell(21) };
        assert.equal(B.crossCheck(ok), 1);
        assert.throws(() => B.crossCheck({ ...ok, 'FenwickRebuild.full/S7@8': cell(22) }), /checksum mismatch S7@8 phase blend/);
    });
    test('A1: META_FIELDS is the 17 BA-11 names in order', () => {
        assert.deepEqual([...B.META_FIELDS], META17);
    });
    test('A1: a valid results fixture does not throw', () => {
        assert.doesNotThrow(() => B.validateResults(results()));
    });
    for (const f of META17) {
        test('A1: deleting meta.' + f + ' throws naming the field', () => {
            const r = results();
            delete r.meta[f];
            assert.throws(() => B.validateResults(r), (e) => e instanceof Error && e.message.includes('meta.' + f));
        });
    }
    test('A1: an 8-field LiteLogN-shape meta throws', () => {
        const r = results();
        const m = {};
        for (const f of META17.slice(0, 8)) m[f] = r.meta[f];
        r.meta = m;
        assert.throws(() => B.validateResults(r), /meta\.loadAvgStart/); // first missing name past the 8
    });

    const readmeText = readFileSync(PKG + 'README.md', 'utf8');
    const headText = () => {
        const p = PKG + '.handoff/evidence/bench-adopt/README.HEAD.md';
        if (existsSync(p)) return readFileSync(p, 'utf8');
        const g = spawnSync('git', ['show', 'HEAD:README.md'], { cwd: PKG, encoding: 'utf8' });
        assert.equal(g.status, 0);
        return g.stdout;
    };

    test('A4: PROVENANCE_FIELDS is the 9 names', () => {
        assert.deepEqual([...R.PROVENANCE_FIELDS], PROV9);
    });
    test('A4: render(null) == README section == README.HEAD section', () => {
        const render = R.renderBenchmarksSection(null, pkg.version);
        assert.equal(R.extractSection(readmeText), render);
        assert.equal(R.extractSection(headText()), render);
    });
    test('A4 control: a 1-byte mutation of the README no longer equals the render', () => {
        const render = R.renderBenchmarksSection(null, pkg.version);
        const i = readmeText.indexOf('## Benchmarks\n\n') + '## Benchmarks\n\n'.length + 3;
        const mut = readmeText.slice(0, i) + (readmeText[i] === 'x' ? 'y' : 'x') + readmeText.slice(i + 1);
        assert.notEqual(R.extractSection(mut), render);
    });
    test('A4 control: QUIET MEASURED fixture has no PENDING and every provenance field', () => {
        const r = quietFixture();
        const out = R.renderBenchmarksSection(r, pkg.version);
        assert.ok(!out.includes('PENDING'));
        for (const f of PROV9) assert.ok(out.includes(String(r.meta[f])), f);
    });
    const PUB = 'node benchmark/Bench.mjs --publish';
    const quietFixture = (command = PUB) => {
        const r = results('MEASURED', 'QUIET', LOSS);
        r.meta.command = command;
        return r;
    };
    test('A4 control: PRELIMINARY MEASURED fixture renders the PENDING form', () => {
        const out = R.renderBenchmarksSection(results('MEASURED', 'PRELIMINARY', LOSS), pkg.version);
        assert.equal(out, R.renderBenchmarksSection(null, pkg.version));
        assert.equal(R.renderBenchmarksSection(results('PENDING', 'QUIET', LOSS), pkg.version), R.renderBenchmarksSection(null, pkg.version));
    });
    test('A4 control: MEASURED QUIET with an empty lossTable throws', () => {
        assert.throws(() => R.renderBenchmarksSection(results('MEASURED', 'QUIET', []), pkg.version), /loss/);
    });

    test('BA-12: hostState(env, quick) is QUIET only for a full run with QUIET_LOCK_HOST === "quiet"', () => {
        assert.equal(B.hostState({ QUIET_LOCK_HOST: 'quiet' }, false), 'QUIET');
        assert.equal(B.hostState({ QUIET_LOCK_HOST: 'quiet' }, true), 'PRELIMINARY');
        for (const v of ['QUIET', ' quiet', 'preliminary', undefined]) {
            assert.equal(B.hostState(v === undefined ? {} : { QUIET_LOCK_HOST: v }, false), 'PRELIMINARY', String(v));
        }
        assert.equal(B.hostState({}, false), 'PRELIMINARY');
    });
    test('BA-12: measured form needs a --publish command (controls: plain command, --publishx)', () => {
        assert.doesNotThrow(() => R.renderBenchmarksSection(quietFixture(), pkg.version));
        assert.throws(() => R.renderBenchmarksSection(quietFixture('node benchmark/Bench.mjs'), pkg.version), /publish/);
        assert.throws(() => R.renderBenchmarksSection(quietFixture('node benchmark/Bench.mjs --publishx'), pkg.version), /publish/);
    });
    test('BA-12: measured form starts "Measured by the run of record at commit <commit>", no version', () => {
        const out = R.renderBenchmarksSection(quietFixture(), '9.9.9');
        assert.ok(out.startsWith('Measured by the run of record at commit abcdef0'), out.slice(0, 80));
        assert.ok(!out.includes('9.9.9'));
    });
    // Timed-row values: each bad value on an otherwise valid fixture throws naming the field.
    const timedCases = [
        ['nsPerOp null', (r) => { r.results['SumSequence/D1'].nsPerOp = null; }, /nsPerOp/],
        ['nsPerOp "fast"', (r) => { r.results['SumSequence/D1'].nsPerOp = 'fast'; }, /nsPerOp/],
        ['p90 0', (r) => { r.results['SumSequence/D1'].p90 = 0; }, /p90/],
        ['ops deleted', (r) => { delete r.results['SumSequence/D1'].ops; }, /ops/],
        ['ops 0', (r) => { r.results['SumSequence/D1'].ops = 0; }, /ops/],
    ];
    test('BA-12: the unmutated timed fixture validates (control baseline)', () => {
        const r = results();
        r.results['SumSequence/D1'].p90 = 120;
        assert.doesNotThrow(() => B.validateResults(r));
    });
    for (const [name, mutate, re] of timedCases) {
        test('BA-12: timed row ' + name + ' throws naming the field', () => {
            const r = results();
            r.results['SumSequence/D1'].p90 = 120;
            mutate(r);
            assert.throws(() => B.validateResults(r), re);
        });
    }
    test('BA-12: a D8 cell with n deleted makes the measured render throw', () => {
        const r = quietFixture();
        delete r.results['SumSequence/D8'].n;
        assert.throws(() => R.renderBenchmarksSection(r, pkg.version), /\bn\b/);
    });

    // Run-of-record guards: env WITHOUT QUIET_LOCK_HOST; no output file may appear.
    const cleanEnv = () => {
        const e = { ...process.env };
        delete e.QUIET_LOCK_HOST;
        return e;
    };
    const outputs = ['benchmark/results.json', 'benchmark/report.html'].map((f) => PKG + f);
    const before_ = outputs.map((f) => existsSync(f));
    for (const [file, args] of [['Bench.mjs', ['--publish']], ['Report.mjs', ['--publish']],
        ['Bench.mjs', ['--member', 'SumSequence']], ['Bench.mjs', ['--n', '5']]]) {
        test('BA-12: node benchmark/' + file + ' ' + args.join(' ') + ' exits 2 with a message, writes nothing', () => {
            const r = spawnSync(process.execPath, [PKG + 'benchmark/' + file, ...args],
                { encoding: 'utf8', timeout: 60000, env: cleanEnv() });
            assert.equal(r.status, 2, String(r.stdout) + String(r.stderr));
            assert.ok(String(r.stderr).length > 0, 'a message on stderr');
            assert.deepEqual(outputs.map((f) => existsSync(f)), before_, 'no results.json / report.html created');
        });
    }

    test('A4: README pin survives a committed results.json', () => {
        const rj = PKG + 'benchmark/results.json';
        const res = existsSync(rj) ? JSON.parse(readFileSync(rj, 'utf8')) : null;
        assert.equal(R.renderBenchmarksSection(res, pkg.version), R.extractSection(readmeText));
    });

    test('A6: --scenario BOGUS exits 2 with "unknown scenario BOGUS"', () => {
        const r = spawnSync(process.execPath, [PKG + 'benchmark/Bench.mjs', '--scenario', 'BOGUS'], { encoding: 'utf8', timeout: 60000 });
        assert.equal(r.status, 2);
        assert.ok((r.stdout + r.stderr).includes('unknown scenario BOGUS'));
    });
    test('A6: --scenario S1 exits 2: S1 is the family; ids are S1a / S1b (R-BA15)', () => {
        const r = spawnSync(process.execPath, [PKG + 'benchmark/Bench.mjs', '--scenario', 'S1'], { encoding: 'utf8', timeout: 60000 });
        assert.equal(r.status, 2);
    });
});

// ---- g2b-3a B2: cellKey / RESULT_KEY ~c tag, parseArgs sweep flags, the cell plan (PLAN g2b-3a TASK 3 / 7, A3 / A4)
describe('g2b-3a B2: sweep keys, flags and the cell plan', () => {
    let B;
    before(async () => { B = await import('../benchmark/Bench.mjs'); });
    const bench = (args) => spawnSync(process.execPath, [PKG + 'benchmark/Bench.mjs', ...args], { encoding: 'utf8', timeout: 60000 });

    test('cellKey: untagged and tagged keys; bad parts throw', () => {
        assert.equal(B.cellKey('BlockedArray', 'S7', 1024), 'BlockedArray/S7@1024');
        assert.equal(B.cellKey('BlockedArray.twin', 'S1a', 4096), 'BlockedArray.twin/S1a@4096');
        assert.equal(B.cellKey('BlockedArray', 'S7', 1024, 36), 'BlockedArray/S7@1024~c36');
        for (const bad of [['', 'S7', 1], ['X', 'D1', 1], ['X', 'S7', 0], ['X', 'S7', 1.5], ['X', 'S7', 1, 0], ['X', 'S7', 1, 3.5], ['X', 'S7', 1, '36']]) {
            assert.throws(() => B.cellKey(...bad), /cellKey/, JSON.stringify(bad));
        }
    });
    test('RESULT_KEY: accepts X/S7@1024~c36 (group 5 = 36); rejects ~c0, ~c036, ~c, ~cx and a tag on a D-row', () => {
        const m = B.RESULT_KEY.exec('X/S7@1024~c36');
        assert.ok(m);
        assert.deepEqual([m[1], m[3], m[4], m[5]], ['X', 'S7', '1024', '36']);
        assert.equal(B.RESULT_KEY.exec('X/S7@1024')[5], undefined);
        assert.ok(B.RESULT_KEY.test('SumSequence/D2'));
        for (const k of ['X/S7@1024~c0', 'X/S7@1024~c036', 'X/S7@1024~c', 'X/S7@1024~cx', 'X/D1~c36', 'X/S7@1024~c36~c36', 'X/S7~c36']) {
            assert.equal(B.RESULT_KEY.test(k), false, k);
        }
    });
    // an untimed sweep cell (no nsPerOp: walkRow needs no counts record) inside a PENDING payload
    function sweepCell(cc, chunkCap) {
        return { member: 'BlockedArray', scenario: 'S7', n: 1024, chunkCap, tune: { chunkCap: cc },
            phases: [{ phase: 'blend', checksum: 5, endState: 1, traceHash: 9 }] };
    }
    const validFixture = () => ({
        schema: 'yggdrasil-bench/1', status: 'PENDING',
        meta: { seed: SEED, node: 'v22.0.0', arch: 'arm64', platform: 'darwin', cpuModel: 'Fixture CPU', cpuCount: 8,
            date: '2026-10-31T12:00:00.000Z', sentinel: null, loadAvgStart: [0.5, 0.5, 0.5], loadAvgEnd: [0.6, 0.6, 0.6],
            hostState: 'PRELIMINARY', quietLockWhy: 'fixture', commit: 'abcdef0', mainFileSha: '0123abcd', runCount: 1,
            command: 'node benchmark/Bench.mjs --sweep chunkCap --scenario S7', rivals: {} },
        subjects: ['SumSequence'], dimensions: [], titles: {}, scenarios: ['S7'], results: {}, lossTable: [],
    });
    test('validateResults: a tagged cell whose chunkCap equals its tag passes; tag != chunkCap throws (fail closed)', () => {
        const base = JSON.parse(JSON.stringify(validFixture()));
        const ok = { ...base, results: { 'BlockedArray/S7@1024~c36': sweepCell(36, 36) } };
        assert.equal(B.validateResults(ok), true);
        const bad = { ...base, results: { 'BlockedArray/S7@1024~c36': sweepCell(36, 40) } };
        assert.throws(() => B.validateResults(bad), /chunkCap must equal its key tag ~c36/);
        const na = { ...base, results: { 'BlockedArray/S7@1024~c36': sweepCell(36, 'n/a') } };
        assert.throws(() => B.validateResults(na), /chunkCap must equal its key tag/);
        const drow = { ...base, results: { 'SumSequence/D2~c36': { member: 'SumSequence' } } };
        assert.throws(() => B.validateResults(drow), /key must be/);
    });
    test('crossCheck: sweep cells join their (Sid, n) group; a differing chunkCap cell throws naming <label>~c<cc>', () => {
        const row = (c) => ({ phases: [{ phase: 'blend', checksum: c, endState: 1, traceHash: 9 }] });
        assert.equal(B.crossCheck({ 'BlockedArray/S7@1024~c16': row(5), 'BlockedArray/S7@1024~c32': row(5) }), 1);
        assert.throws(() => B.crossCheck({ 'BlockedArray/S7@1024~c16': row(5), 'BlockedArray/S7@1024~c32': row(6) }),
            /checksum mismatch S7@1024 phase blend: BlockedArray~c16 5 vs BlockedArray~c32 6/);
    });
    test('parseArgs: --sweep chunkCap, --all, --picks <path> parse; defaults are null / false / null', () => {
        const d = B.parseArgs([]);
        assert.deepEqual([d.sweep, d.all, d.picks], [null, false, null]);
        const o = B.parseArgs(['--sweep', 'chunkCap', '--scenario', 'S7', '--quick', '--picks', 'benchmark/chunkcap.json']);
        assert.deepEqual([o.sweep, o.scenario, o.quick, o.picks], ['chunkCap', 'S7', true, 'benchmark/chunkcap.json']);
        assert.equal(B.parseArgs(['--all']).all, true);
        assert.equal(B.parseArgs(['--all', '--sweep', 'chunkCap']).sweep, 'chunkCap');
        assert.deepEqual(B.SWEEP_AXES, ['chunkCap']);
    });
    test('parseArgs exits 2: --sweep leafSize, --sweep without a value / a scenario, --picks without a value, --all with --scenario, --sweep with --cell', () => {
        const rows = [
            [['--sweep', 'leafSize', '--scenario', 'S7'], '--sweep must be one of chunkCap'],
            [['--sweep'], '--sweep needs a value'],
            [['--sweep', 'chunkCap'], 'give --scenario <Sid> or --all'],
            [['--picks'], '--picks needs a value'],
            [['--picks', '--all'], '--picks needs a path'],
            [['--picks', ''], '--picks needs a path'],
            [['--all', '--scenario', 'S7'], '--all runs every scenario'],
            [['--cell', '--sweep', 'chunkCap'], 'is an orchestrator flag'],
            [['--alll'], "did you mean '--all'"],
        ];
        for (const [args, msg] of rows) {
            const r = bench(args);
            assert.equal(r.status, 2, args.join(' ') + ': ' + r.stderr);
            assert.ok(r.stderr.includes(msg), args.join(' ') + ' stderr: ' + r.stderr);
        }
    });
    test('planCells: --sweep chunkCap --scenario S7 --quick = BlockedArray x 5 distinct ~c keys, d from the built capacity (A4)', () => {
        const p = B.planCells(B.parseArgs(['--sweep', 'chunkCap', '--scenario', 'S7', '--quick']));
        assert.equal(p.groups.length, 1);
        // hand: S7 builds capacity n = 4096; ceil(sqrt(4096)) = 64 -> d 64; grid 64 x {1/4, 1/2, 1, 2, 4}
        assert.deepEqual(p.sweep, [{ sid: 'S7', n: 4096, capacity: 4096, d: 64, grid: [16, 32, 64, 128, 256] }]);
        const keys = p.groups[0].map((c) => B.cellKey(c.member, c.scenario, c.n, c.chunkCap));
        assert.deepEqual(keys, [16, 32, 64, 128, 256].map((cc) => 'BlockedArray/S7@4096~c' + cc));
        for (const c of p.groups[0]) assert.deepEqual(c.tune, { chunkCap: c.chunkCap });
        // S1a builds capacity n + 1 = 1025 at 1024: d = 36 (ceil(sqrt(1025)) = 33 -> 36), not sqrt(n) = 32
        const q = B.planCells(B.parseArgs(['--sweep', 'chunkCap', '--scenario', 'S1a', '--quick']));
        assert.deepEqual(q.sweep[0], { sid: 'S1a', n: 1024, capacity: 1025, d: 36, grid: [12, 20, 36, 72, 144] });
        assert.equal(q.groups.length, 3);
        for (const g of q.groups) assert.equal(new Set(g.map((c) => c.chunkCap)).size, 5);
    });
    test('planCells: one group per (Sid, n) in registry label order; --all = 16 D-rows + every scenario; --all --sweep has no D-row', () => {
        const S7 = selectScenario('S7');
        const p = B.planCells(B.parseArgs(['--scenario', 'S7']));
        assert.deepEqual(p.groups.map((g) => g[0].n), [10000, 100000, 1000000]);
        for (const g of p.groups) assert.deepEqual(g.map((c) => c.member), [...S7.adapters]);
        const a = B.planCells(B.parseArgs(['--all', '--quick']));
        const flat = a.groups.flat();
        assert.equal(flat.filter((c) => c.scenario === undefined).length, 16);
        assert.deepEqual([...new Set(flat.filter((c) => c.scenario).map((c) => c.scenario))], SCENARIOS.map((s) => s.id));
        const w = B.planCells(B.parseArgs(['--all', '--sweep', 'chunkCap', '--quick']));
        assert.ok(w.groups.flat().every((c) => c.scenario !== undefined && c.member === 'BlockedArray'));
        assert.equal(w.sweep.length, w.groups.length);
    });
    test('rotation (BA-28): pass p runs each group rotated left by p; pass 1 starts at the second label', async () => {
        const { rotateLabels } = await import('../benchmark/Compare.mjs');
        const plan = B.planCells(B.parseArgs(['--scenario', 'S7', '--quick']));
        const g = plan.groups[0];
        assert.equal(rotateLabels(g, 1)[0].member, g[1].member);
        assert.equal(rotateLabels(g, g.length)[0].member, g[0].member);
        // runOrder (the pass loop's order): pass 0 = registry order, pass 1 = every group rotated left by one
        const L = [...selectScenario('S7').adapters];
        const rot1 = [...L.slice(1), L[0]];
        assert.deepEqual(B.runOrder(plan, 0).map((c) => c.member), L);
        assert.deepEqual(B.runOrder(plan, 1).map((c) => c.member + '@' + c.n), rot1.map((m) => m + '@4096'));
        const full = B.planCells(B.parseArgs(['--scenario', 'S7']));
        assert.deepEqual(B.runOrder(full, 1).map((c) => c.member + '@' + c.n),
            [10000, 100000, 1000000].flatMap((n) => rot1.map((m) => m + '@' + n)));
        const src = readFileSync(PKG + 'benchmark/Bench.mjs', 'utf8');
        assert.equal(src.split('for (const c of runOrder(plan, pass))').length, 2, 'the pass loop must run runOrder');
    });
    test('B3: planCells no longer refuses --picks / --sweep --publish (publishGuard owns both refusals)', () => {
        // full S7 sizes 10000 / 100000 / 1000000 -> 3 swept (Sid, n)
        assert.equal(B.planCells(B.parseArgs(['--sweep', 'chunkCap', '--scenario', 'S7', '--publish'])).sweep.length, 3);
        assert.ok(B.planCells(B.parseArgs(['--scenario', 'S7', '--picks', 'x.json'])).groups.length > 0);
        assert.equal(B.planCells(B.parseArgs(['--sweep', 'chunkCap', '--scenario', 'S7', '--quick'])).sweep.length, 1);
    });
    test('EXCLUDED (BA-34): empty today (census max 105.25 s); planted rows: SumSequence / BlockedArray family throw; a valid row prints the ruled wording and leaves the cell out', () => {
        assert.deepEqual(B.EXCLUDED, []);
        assert.ok(Object.isFrozen(B.EXCLUDED));
        const row = { label: 'FenwickRebuild.full', sid: 'S1b', n: 1000000, censusS: 312.5, reason: B.EXCLUDE_REASON };
        assert.equal(B.exclusionLine(row), 'FenwickRebuild.full S1b@1000000 excluded: census 312.5 s per pass (O(n) rebuild per structural op)');
        const p = B.planCells(B.parseArgs(['--scenario', 'S1b']), [row]);
        assert.deepEqual(p.excluded, [row]);
        const g = p.groups.find((x) => x[0].n === 1000000);
        assert.deepEqual(g.map((c) => c.member), selectScenario('S1b').adapters.filter((l) => l !== 'FenwickRebuild.full'));
        assert.equal(B.planCells(B.parseArgs(['--scenario', 'S7']), [row]).excluded.length, 0);
        // a full-run n is no cell of a --quick run: the row drops out, it never throws "names no cell"
        const qrow = { label: 'FenwickRebuild.full', sid: 'S1b', n: 1000000, censusS: 312.5, reason: B.EXCLUDE_REASON };
        for (const args of [['--scenario', 'S1b', '--quick'], ['--all', '--quick']]) {
            const q = B.planCells(B.parseArgs(args), [qrow]);
            assert.deepEqual(q.excluded, [], args.join(' '));
            for (const grp of q.groups.filter((x) => x[0].scenario !== undefined)) {
                assert.deepEqual(grp.map((c) => c.member), [...selectScenario(grp[0].scenario).adapters], args.join(' ') + ' ' + grp[0].scenario + '@' + grp[0].n);
            }
        }
        assert.deepEqual(B.planCells(B.parseArgs(['--scenario', 'S1b', '--quick']), [qrow]).groups.map((x) => x[0].n), [1024, 2048, 4096]);
        for (const label of ['SumSequence', 'BlockedArray', 'BlockedArray.plain', 'BlockedArray.twin']) {
            assert.throws(() => B.validateExcluded([{ ...row, label }]), /is never excluded/, label);
        }
        assert.throws(() => B.validateExcluded([{ ...row, censusS: 300 }]), /censusS/);
        assert.throws(() => B.validateExcluded([{ ...row, n: 4096 + 1 }]), /is not a size of S1b/);
        assert.throws(() => B.validateExcluded([{ ...row, reasn: 'x' }]), /unknown key reasn/);
        assert.throws(() => B.validateExcluded([row, row]), /listed twice/);
    });
});

// ---- g2b-3a B3: publishGuard, the picks table, tuning, lossTable / comparison, Report sections, inl drivers
// (PLAN g2b-3a TASKS 4-5, TASK 7 B3 rows; SPEC CURRENT BA-29..BA-33; ASSERTIONS A2 / A4). Hand oracles:
// sweepGrid(100) = [28, 52, 100, 200, 400] (25 -> 28, 50 -> 52), d(100000) = ceil(316.23) = 317 -> 320,
// sweepGrid(1000) = [252, 500, 1000, 2000, 4000] (250 -> 252).
describe('g2b-3a B3: guard, picks, tuning, loss rows, report', () => {
    let B, Rep;
    before(async () => {
        B = await import('../benchmark/Bench.mjs');
        Rep = await import('../benchmark/Report.mjs');
    });
    const bench = (args, env) => spawnSync(process.execPath, [PKG + 'benchmark/Bench.mjs', ...args],
        { encoding: 'utf8', timeout: 60000, env: env === undefined ? process.env : env });
    const P = (args) => B.parseArgs(args);
    const QUIET = { QUIET_LOCK_HOST: 'quiet' };
    const PRELIM = { QUIET_LOCK_HOST: 'preliminary' };

    const S7_PICKS = () => [
        { scenario: 'S7', n: 10000, capacity: 10000, d: 100, grid: [28, 52, 100, 200, 400], chunkCap: 100, edge: false, nsPerEvent: 41.5 },
        { scenario: 'S7', n: 100000, capacity: 100000, d: 320, grid: [80, 160, 320, 640, 1280], chunkCap: 80, edge: true, nsPerEvent: 52.25 },
        { scenario: 'S7', n: 1000000, capacity: 1000000, d: 1000, grid: [252, 500, 1000, 2000, 4000], chunkCap: 2000, edge: false, nsPerEvent: 77 },
    ];
    const table = (hostState = 'QUIET') => ({
        schema: 'yggdrasil-chunkcap/1',
        meta: { date: '2026-11-01T09:00:00.000Z', hostState, commit: 'abcdef0', mainFileSha: '0123abcd', runCount: 5,
            loadAvgStart: [0.5, 0.5, 0.5], loadAvgEnd: [0.6, 0.6, 0.6], quietLockWhy: 'fixture sweep',
            command: 'node benchmark/Bench.mjs --sweep chunkCap --publish --all' },
        picks: S7_PICKS(),
    });

    // ---- publishGuard (A4): every rule + its allowed case; pure (env passed in)
    const GUARD = [
        ['--publish (no --all), any host', ['--publish', '--runs', '5'], QUIET, null, /needs --all \(BA-33\)/],
        ['--publish --scenario S7 (no --all)', ['--publish', '--scenario', 'S7', '--runs', '5'], PRELIM, null, /needs --all/],
        ['--sweep --scenario S7 --publish (no --all), QUIET', ['--sweep', 'chunkCap', '--scenario', 'S7', '--publish', '--runs', '5'], QUIET, null, /needs --all/],
        ['--sweep with --picks (no publish)', ['--sweep', 'chunkCap', '--scenario', 'S7', '--picks', 'p.json'], {}, table(), /drop --picks/],
        ['--sweep --all --publish on PRELIMINARY (mutant M1c && !o.all)', ['--sweep', 'chunkCap', '--all', '--publish', '--runs', '5'], PRELIM, null, /only from a QUIET host/],
        ['--sweep --all --publish, no quiet-lock env', ['--sweep', 'chunkCap', '--all', '--publish', '--runs', '5'], {}, null, /only from a QUIET host/],
        ['QUIET --all --publish, picks missing', ['--all', '--publish', '--runs', '5'], QUIET, null, /needs --picks/],
        ['QUIET --all --publish, PRELIMINARY picks', ['--all', '--publish', '--picks', 'p.json', '--runs', '5'], QUIET, table('PRELIMINARY'),
            /a QUIET run of record refuses a non-QUIET picks table \(BA-31\): its host is PRELIMINARY/],
        // R-BA28: K passes on every --publish; a QUIET run of record cites only a K-pass sweep
        ['QUIET --sweep --all --publish at the default --runs 1', ['--sweep', 'chunkCap', '--all', '--publish'], QUIET, null, /--publish needs --runs 5 .*got 1$/],
        ['QUIET --sweep --all --publish --runs 4', ['--sweep', 'chunkCap', '--all', '--publish', '--runs', '4'], QUIET, null, /--publish needs --runs 5 .*got 4$/],
        ['QUIET --all --publish with QUIET picks at --runs 1', ['--all', '--publish', '--picks', 'p.json'], QUIET, table('QUIET'), /--publish needs --runs 5 .*got 1$/],
        ['PRELIMINARY --all --publish at --runs 1', ['--all', '--publish'], PRELIM, null, /--publish needs --runs 5/],
        ['QUIET --all --publish --runs 5, picks meta.runCount 1', ['--all', '--publish', '--picks', 'p.json', '--runs', '5'], QUIET,
            (() => { const t = table('QUIET'); t.meta.runCount = 1; return t; })(), /picks table swept at runCount 1 \(R-BA28/],
        // R-BA28 above K: the refusal is !== K, not < K (mutants MRUNSLT / MRCLT)
        ['QUIET --sweep --all --publish --runs 6', ['--sweep', 'chunkCap', '--all', '--publish', '--runs', '6'], QUIET, null, /--publish needs --runs 5 .*got 6$/],
        ['QUIET --all --publish --runs 5, picks meta.runCount 6', ['--all', '--publish', '--picks', 'p.json', '--runs', '5'], QUIET,
            (() => { const t = table('QUIET'); t.meta.runCount = 6; return t; })(), /swept at runCount 6 \(R-BA28/],
        // BA-31: a QUIET run never cites a non-QUIET table, published or not
        ['QUIET --scenario S7 --picks (no publish), PRELIMINARY picks', ['--scenario', 'S7', '--picks', 'p.json'], QUIET, table('PRELIMINARY'),
            /^\[bench\] a QUIET run refuses a non-QUIET picks table \(BA-31\)$/],
        ['QUIET --all --picks (no publish), PRELIMINARY picks', ['--all', '--picks', 'p.json'], QUIET, table('PRELIMINARY'), /a QUIET run refuses a non-QUIET picks table/],
    ];
    for (const [name, args, env, picks, re] of GUARD) {
        test('publishGuard refuses: ' + name, () => {
            const msg = B.publishGuard(P(args), env, picks);
            assert.equal(typeof msg, 'string', name);
            assert.match(msg, re);
        });
    }
    const ALLOWED = [
        ['QUIET --sweep chunkCap --all --publish --runs 5', ['--sweep', 'chunkCap', '--all', '--publish', '--runs', '5'], QUIET, null],
        ['QUIET --all --publish --runs 5 with QUIET picks', ['--all', '--publish', '--picks', 'p.json', '--runs', '5'], QUIET, table('QUIET')],
        ['PRELIMINARY --all --publish --runs 5, no picks', ['--all', '--publish', '--runs', '5'], PRELIM, null],
        ['QUIET --scenario S7 --picks (no publish) with QUIET picks', ['--scenario', 'S7', '--picks', 'p.json'], QUIET, table('QUIET')],
        ['PRELIMINARY --scenario S7 --picks, picks meta.runCount 1 (only a QUIET run of record pins runCount)', ['--scenario', 'S7', '--picks', 'p.json'],
            PRELIM, (() => { const t = table('PRELIMINARY'); t.meta.runCount = 1; return t; })()],
        ['--scenario S7 (no publish)', ['--scenario', 'S7'], {}, null],
        ['--scenario S7 --picks (no publish, PRELIMINARY picks)', ['--scenario', 'S7', '--picks', 'p.json'], {}, table('PRELIMINARY')],
        ['--sweep chunkCap --scenario S7 --quick', ['--sweep', 'chunkCap', '--scenario', 'S7', '--quick'], {}, null],
    ];
    for (const [name, args, env, picks] of ALLOWED) {
        test('publishGuard allows: ' + name, () => assert.equal(B.publishGuard(P(args), env, picks), null));
    }
    test('publishGuard is pure: the host comes from the env argument, never process.env', () => {
        const saved = process.env.QUIET_LOCK_HOST;
        process.env.QUIET_LOCK_HOST = 'quiet';
        try {
            assert.match(B.publishGuard(P(['--sweep', 'chunkCap', '--all', '--publish']), {}, null), /only from a QUIET host/);
        } finally {
            if (saved === undefined) delete process.env.QUIET_LOCK_HOST; else process.env.QUIET_LOCK_HOST = saved;
        }
    });

    // ---- the picks table validator (read side of --picks, write side of a sweep)
    test('validatePicks: the fixture table passes (control baseline); PICKS_SCHEMA pinned', () => {
        assert.equal(B.PICKS_SCHEMA, 'yggdrasil-chunkcap/1');
        assert.equal(B.validatePicks(table()), true);
        assert.equal(B.validatePicks(JSON.parse(JSON.stringify(table('PRELIMINARY')))), true);
    });
    const PICK_BAD = [
        ['non-plain root', () => Object.create(table()), /\(root\) must be a plain object/],
        ['an array root', () => [], /\(root\)/],
        ['schema wrong', (t) => { t.schema = 'yggdrasil-chunkcap/2'; }, /picks: schema/],
        ['unknown top key', (t) => { t.extra = 1; }, /unknown key/],
        ['meta missing commit', (t) => { delete t.meta.commit; }, /meta\.commit missing/],
        ['meta unknown key', (t) => { t.meta.seed = 1; }, /meta\.seed unknown key/],
        ['meta.hostState LOUD', (t) => { t.meta.hostState = 'LOUD'; }, /meta\.hostState/],
        ['meta.date not ISO', (t) => { t.meta.date = 'yesterday'; }, /meta\.date/],
        ['meta.mainFileSha 7 hex', (t) => { t.meta.mainFileSha = '0123abc'; }, /meta\.mainFileSha/],
        ['meta.runCount 0', (t) => { t.meta.runCount = 0; }, /meta\.runCount/],
        ['meta.loadAvgEnd 2 numbers', (t) => { t.meta.loadAvgEnd = [1, 1]; }, /meta\.loadAvgEnd/],
        ['meta.command empty', (t) => { t.meta.command = ''; }, /meta\.command/],
        ['meta non-plain', (t) => { t.meta = Object.create(t.meta); }, /meta must be a plain object/],
        ['picks empty', (t) => { t.picks = []; }, /picks must be a non-empty array/],
        ['picks not an array', (t) => { t.picks = { 0: t.picks[0] }; }, /picks must be a non-empty array/],
        ['row non-plain', (t) => { t.picks[0] = Object.create(t.picks[0]); }, /picks\[0\] must be a plain object/],
        ['row unknown key', (t) => { t.picks[1].chunkcap = 80; }, /picks\[1\]\.chunkcap unknown key/],
        ['row missing edge', (t) => { delete t.picks[0].edge; }, /picks\[0\]\.edge missing/],
        ['scenario S99', (t) => { t.picks[0].scenario = 'S99'; }, /picks\[0\]\.scenario/],
        ['scenario D1', (t) => { t.picks[0].scenario = 'D1'; }, /picks\[0\]\.scenario/],
        ['n 0', (t) => { t.picks[0].n = 0; }, /picks\[0\]\.n/],
        ['n 10000.5', (t) => { t.picks[0].n = 10000.5; }, /picks\[0\]\.n/],
        ['capacity < n', (t) => { t.picks[0].capacity = 9999; }, /picks\[0\]\.capacity/],
        ['d not defaultChunkCap(capacity)', (t) => { t.picks[0].d = 104; }, /picks\[0\]\.d must be defaultChunkCap/],
        ['grid not sweepGrid(d)', (t) => { t.picks[0].grid = [25, 50, 100, 200, 400]; }, /picks\[0\]\.grid/],
        ['chunkCap 102 (not a multiple of 4)', (t) => { t.picks[0].chunkCap = 102; }, /chunkCap must be an integer multiple of 4/],
        ['chunkCap 4 (below 8)', (t) => { t.picks[0].chunkCap = 4; }, /chunkCap must be an integer multiple of 4 in \[8, 65536\]/],
        ['chunkCap 65540 (above 65536)', (t) => { t.picks[0].chunkCap = 65540; }, /chunkCap must be an integer multiple of 4/],
        ['chunkCap "100" (a string)', (t) => { t.picks[0].chunkCap = '100'; }, /chunkCap must be an integer/],
        ['chunkCap 104 (not a grid member)', (t) => { t.picks[0].chunkCap = 104; }, /chunkCap must be a member of grid/],
        ['edge wrong (interior pick flagged edge)', (t) => { t.picks[0].edge = true; }, /picks\[0\]\.edge must be false/],
        ['edge wrong (end pick not flagged)', (t) => { t.picks[1].edge = false; }, /picks\[1\]\.edge must be true/],
        ['nsPerEvent 0', (t) => { t.picks[2].nsPerEvent = 0; }, /picks\[2\]\.nsPerEvent/],
        ['nsPerEvent null', (t) => { t.picks[2].nsPerEvent = null; }, /picks\[2\]\.nsPerEvent/],
        ['a (scenario, n) twice', (t) => { t.picks.push({ ...t.picks[0] }); }, /S7@10000 listed twice/],
    ];
    for (const [name, mutate, re] of PICK_BAD) {
        test('validatePicks throws: ' + name, () => {
            const t = table();
            const r = mutate(t);
            assert.throws(() => B.validatePicks(r === undefined ? t : r), re);
        });
    }

    // ---- results fixtures with timed scenario cells (counts records the adapters accept)
    const phaseRow = (label, phase, ns) => {
        const a = selectAdapter(label.startsWith('BlockedArray') ? 'BlockedArray' : label);
        const rec = countsRecord(a, new Int32Array(NC), new Float64Array(a.extraCounts.length));
        return { phase, events: 100, ops: 100, nsPerOp: ns, p50: ns, p90: ns, ...rec, checksum: 5, endState: 1, traceHash: 9 };
    };
    const S7N = [10000, 100000, 1000000];
    const pickAt = (n) => S7_PICKS().find((p) => p.n === n).chunkCap;
    function put(R, label, n, runs, chunkCap) {
        const cc = chunkCap !== undefined ? chunkCap : label.startsWith('BlockedArray') ? pickAt(n) : 'n/a';
        const one = (v) => ({ member: label, scenario: 'S7', n, chunkCap: cc, phases: [phaseRow(label, 'blend', v)] });
        R[label + '/S7@' + n] = { ...one(runs[0]), repeats: runs.slice(1).map(one) };
    }
    const five = (v) => [v, v, v, v, v];
    // A2 S7 shape: SumSequence median 100 (outliers 900 / 1), FenwickRebuild.suffix 50 (wins: 50 < 95),
    // BlockedArray / .plain 100 (TIE), twin ~100 (TIE): conclusive.
    const s7 = (twinAt1e5 = [100, 101, 99, 100, 100]) => {
        const R = {};
        for (const n of S7N) {
            put(R, 'SumSequence', n, [100, 900, 100, 1, 100]);
            put(R, 'FenwickRebuild.suffix', n, five(50));
            put(R, 'BlockedArray', n, five(100));
            put(R, 'BlockedArray.plain', n, five(100));
            put(R, 'BlockedArray.twin', n, n === 100000 ? twinAt1e5 : [100, 101, 99, 100, 100]);
        }
        return R;
    };
    const meta = (hostState) => ({ seed: SEED, node: 'v22.0.0', arch: 'arm64', platform: 'darwin', cpuModel: 'Fixture CPU',
        cpuCount: 8, date: '2026-11-01T12:00:00.000Z', sentinel: null, loadAvgStart: [0.5, 0.5, 0.5], loadAvgEnd: [0.6, 0.6, 0.6],
        hostState, quietLockWhy: 'fixture', commit: 'abcdef0', mainFileSha: '0123abcd', runCount: 5,
        command: 'node benchmark/Bench.mjs --scenario S7 --runs 5', rivals: {} });
    const payload = (R, hostState = 'PRELIMINARY', status = 'MEASURED') => {
        const cmp = B.comparisonOf(R);
        const p = { schema: 'yggdrasil-bench/1', status, meta: meta(hostState), subjects: ['SumSequence'], dimensions: [],
            titles: {}, scenarios: ['S7'], results: R, lossTable: cmp.lossTable };
        if (cmp.comparison !== null) p.comparison = cmp.comparison;
        return JSON.parse(JSON.stringify(p));
    };

    test('lossTable (A2): the S7 fixture gives exactly one row {S7, FenwickRebuild.suffix, SumSequence, none up to 1000000}; it passes validateResults; twin never a row', () => {
        const cmp = B.comparisonOf(s7());
        assert.equal(cmp.lossTable.length, 1);
        const [row] = cmp.lossTable;
        assert.deepEqual([row.scenario, row.winner, row.loser, row.crossoverN], ['S7', 'FenwickRebuild.suffix', 'SumSequence', 'none up to 1000000']);
        assert.ok(nonEmpty(row.reason) && !/^INCONCLUSIVE/.test(row.reason));
        for (const r of cmp.lossTable) assert.ok(!r.winner.startsWith('BlockedArray'), r.winner);
        assert.deepEqual(cmp.comparison, { inconclusive: false, twin: [] });
        const p = payload(s7());
        assert.equal(p.lossTable.length, 1);
        assert.equal(B.validateResults(p), true);
    });
    const nonEmpty = (s) => typeof s === 'string' && s.length > 0;
    test('lossTable: a twin not TIE at S7@100000 -> comparison INCONCLUSIVE with the reading, every loss reason starts INCONCLUSIVE, still validates', () => {
        const p = payload(s7(five(80)));
        assert.equal(p.comparison.inconclusive, true);
        assert.equal(p.comparison.twin.length, 1);
        assert.deepEqual([p.comparison.twin[0].scenario, p.comparison.twin[0].n, p.comparison.twin[0].phase, p.comparison.twin[0].verdict], ['S7', 100000, 'blend', 'A']);
        assert.ok(p.lossTable.length === 1 && /^INCONCLUSIVE/.test(p.lossTable[0].reason));
        assert.equal(B.validateResults(p), true);
    });
    test('comparisonOf: nothing to compare (D-rows only, or a ~c sweep) -> lossTable [] and no comparison record', () => {
        assert.deepEqual(B.comparisonOf({ 'SumSequence/D1': {}, 'SpliceFoil/D8': {} }), { lossTable: [], comparison: null });
        const sw = {};
        for (const cc of [16, 32]) sw['BlockedArray/S7@4096~c' + cc] = { member: 'BlockedArray', scenario: 'S7', n: 4096, chunkCap: cc, phases: [phaseRow('BlockedArray', 'blend', 10)] };
        assert.deepEqual(B.comparisonOf(sw), { lossTable: [], comparison: null });
    });
    const CMP_BAD = [
        ['non-plain', (p) => { p.comparison = []; }, /comparison must be a plain object/],
        ['unknown key', (p) => { p.comparison.twins = []; }, /comparison\.twins unknown key/],
        ['inconclusive not a boolean', (p) => { p.comparison.inconclusive = 'no'; }, /comparison\.inconclusive must be a boolean/],
        ['inconclusive true with no reading', (p) => { p.comparison.inconclusive = true; }, /must be true exactly when/],
        ['a reading with inconclusive false', (p) => { p.comparison.twin.push({ scenario: 'S7', n: 10000, phase: 'blend', verdict: 'A', ratio: 0.8 }); }, /must be true exactly when/],
        ['a reading with a bad verdict', (p) => { p.comparison = { inconclusive: true, twin: [{ scenario: 'S7', n: 10000, phase: 'blend', verdict: 'TIE', ratio: 1 }] }; }, /twin\[0\]\.verdict/],
        ['MISSING with a ratio', (p) => { p.comparison = { inconclusive: true, twin: [{ scenario: 'S7', n: 10000, phase: null, verdict: 'MISSING', ratio: 1 }] }; }, /twin\[0\]\.ratio must be null/],
        ['a reading with ratio 0', (p) => { p.comparison = { inconclusive: true, twin: [{ scenario: 'S7', n: 10000, phase: 'blend', verdict: 'B', ratio: 0 }] }; }, /twin\[0\]\.ratio/],
    ];
    for (const [name, mutate, re] of CMP_BAD) {
        test('validateResults comparison throws: ' + name, () => {
            const p = payload(s7());
            mutate(p);
            assert.throws(() => B.validateResults(p), re);
        });
    }
    test('validateResults: an unknown top-level key still throws (tuning / comparison are the only new ones)', () => {
        const p = payload(s7());
        p.tunings = {};
        assert.throws(() => B.validateResults(p), /tunings unknown key/);
    });

    // ---- tuning
    const tuning = () => ({ source: 'benchmark/chunkcap.json', sha256: 'ab'.repeat(32), hostState: 'QUIET', picks: S7_PICKS() });
    test('validateTuning: the fixture passes; a payload with tuning + every BlockedArray cell at its pick validates', () => {
        assert.equal(B.validateTuning(tuning()), true);
        const p = payload(s7());
        p.tuning = tuning();
        assert.equal(B.validateResults(p), true);
    });
    const TUNING_BAD = [
        ['non-plain', () => Object.create(tuning()), /tuning must be a plain object/],
        ['unknown key', (t) => { t.commit = 'x'; }, /tuning\.commit unknown key/],
        ['missing picks', (t) => { delete t.picks; }, /tuning\.picks missing/],
        ['source empty', (t) => { t.source = ''; }, /tuning\.source/],
        ['sha256 sha256/8 only', (t) => { t.sha256 = '0123abcd'; }, /tuning\.sha256/],
        ['sha256 uppercase', (t) => { t.sha256 = 'AB'.repeat(32); }, /tuning\.sha256/],
        ['hostState quiet (case)', (t) => { t.hostState = 'quiet'; }, /tuning\.hostState/],
        ['picks empty', (t) => { t.picks = []; }, /tuning\.picks must be a non-empty array/],
        ['a pick chunkCap 102', (t) => { t.picks[0].chunkCap = 102; }, /tuning\.picks\[0\]\.chunkCap/],
        ['a pick with an unknown key', (t) => { t.picks[2].why = 'x'; }, /tuning\.picks\[2\]\.why unknown key/],
    ];
    for (const [name, mutate, re] of TUNING_BAD) {
        test('validateTuning throws: ' + name, () => {
            const t = tuning();
            const r = mutate(t);
            assert.throws(() => B.validateTuning(r === undefined ? t : r), re);
            const p = payload(s7());
            p.tuning = r === undefined ? t : r;
            assert.throws(() => B.validateResults(p), re);
        });
    }
    test('validateResults with tuning: a BlockedArray-family cell (or a repeat) off its pick, or with no pick, throws', () => {
        const p = payload(s7());
        p.tuning = tuning();
        p.results['BlockedArray.plain/S7@10000'].repeats[3].chunkCap = 36;
        assert.throws(() => B.validateResults(p), /BlockedArray\.plain\/S7@10000\.chunkCap must equal the tuning pick 100/);
        const q = payload(s7());
        q.tuning = { ...tuning(), picks: S7_PICKS().slice(0, 2) };
        assert.throws(() => B.validateResults(q), /has no tuning pick for S7@1000000/);
    });
    test('validateResults (BA-31): a QUIET payload citing a PRELIMINARY tuning throws; QUIET + QUIET and PRELIMINARY + PRELIMINARY validate', () => {
        const ok = payload(s7(), 'QUIET');
        ok.tuning = tuning();
        assert.equal(B.validateResults(ok), true);
        const pre = payload(s7(), 'PRELIMINARY');
        pre.tuning = { ...tuning(), hostState: 'PRELIMINARY' };
        assert.equal(B.validateResults(pre), true);
        const bad = payload(s7(), 'QUIET');
        bad.tuning = { ...tuning(), hostState: 'PRELIMINARY' };
        assert.throws(() => B.validateResults(bad), /tuning\.hostState a QUIET run cannot cite a non-QUIET picks table \(BA-31\)/);
    });
    test('validateResults (BA-29): a loss reason is INCONCLUSIVE-marked exactly when comparison.inconclusive (both ways; a marked row needs the record)', () => {
        const strip = payload(s7(five(80)));
        assert.equal(B.validateResults(strip), true);
        strip.lossTable[0].reason = strip.lossTable[0].reason.replace(/^INCONCLUSIVE \([^)]*\): /, '');
        assert.ok(!strip.lossTable[0].reason.startsWith('INCONCLUSIVE'), 'fixture: the prefix was stripped');
        assert.throws(() => B.validateResults(strip), /lossTable\[0\]\.reason must start INCONCLUSIVE/);
        const add = payload(s7());
        add.lossTable[0].reason = 'INCONCLUSIVE (forged): ' + add.lossTable[0].reason;
        assert.throws(() => B.validateResults(add), /lossTable\[0\]\.reason is marked INCONCLUSIVE but comparison\.inconclusive is false/);
        const none = payload(s7(five(80)));
        delete none.comparison;
        assert.throws(() => B.validateResults(none), /lossTable\[0\]\.reason is marked INCONCLUSIVE but there is no comparison record/);
    });
    // a timed D-row (SumSequence/D1) with a valid counts record
    const dRow = () => ({ n: 1024, ops: 64, nsPerOp: 100, ...countsRecord(SumSequenceAdapter, new Int32Array(NC), undefined) });
    test('validateResults (BA-36): a MEASURED payload with untagged scenario cells and no comparison record throws naming comparison + BA-36 (QUIET and PRELIMINARY)', () => {
        for (const host of ['PRELIMINARY', 'QUIET']) {
            const p = payload(s7(), host);
            assert.equal(B.validateResults(p), true, host + ' control: with the record it validates');
            delete p.comparison;
            assert.throws(() => B.validateResults(p), /results: comparison missing: .*\(BA-36\)/, host);
        }
        // one untagged scenario cell among D-rows is enough
        const mix = payload(s7());
        mix.results = { 'SumSequence/D1': dRow(), 'SumSequence/S7@10000': mix.results['SumSequence/S7@10000'] };
        mix.lossTable = [];
        delete mix.comparison;
        assert.throws(() => B.validateResults(mix), /comparison missing/);
    });
    test('validateResults (BA-36): no record needed for D-rows only, a ~c-tagged sweep, or a PENDING scenario payload', () => {
        const drows = payload({ 'SumSequence/D1': dRow() }, 'QUIET');
        assert.equal(drows.status, 'MEASURED');
        assert.equal(drows.comparison, undefined);
        assert.equal(B.validateResults(drows), true, 'D-rows only, MEASURED');
        const sw = {};
        for (const cc of [16, 32]) sw['BlockedArray/S7@4096~c' + cc] = { member: 'BlockedArray', scenario: 'S7', n: 4096, chunkCap: cc, phases: [phaseRow('BlockedArray', 'blend', 10)] };
        const swp = payload(sw);
        assert.equal(swp.status, 'MEASURED');
        assert.equal(swp.comparison, undefined);
        assert.equal(B.validateResults(swp), true, 'a ~c sweep, MEASURED');
        const pend = payload(s7(), 'PRELIMINARY', 'PENDING');
        delete pend.comparison;
        assert.equal(B.validateResults(pend), true, 'PENDING with untagged scenario cells');
    });

    // ---- planCells with picks; sweepPicks
    test('planCells with picks: every BlockedArray label runs its (Sid, n) pick under an UNTAGGED key; other labels untuned', () => {
        const plan = B.planCells(P(['--scenario', 'S7']), [], table());
        let tuned = 0;
        for (const c of plan.groups.flat()) {
            const key = B.cellKey(c.member, c.scenario, c.n);
            assert.ok(!key.includes('~c'), key);
            if (c.member.startsWith('BlockedArray')) {
                tuned++;
                assert.deepEqual(c.tune, { chunkCap: pickAt(c.n) }, key);
                assert.equal(c.pickCap, pickAt(c.n), key);
                assert.equal(c.chunkCap, undefined, key + ': a chunkCap field would tag the key');
            } else {
                assert.equal(c.tune, undefined, key);
            }
        }
        assert.equal(tuned, 3 * 3, 'BlockedArray, .plain, .twin x 3 n');
    });
    test('planCells with picks fails closed: a BlockedArray (Sid, n) with no pick throws (also --quick); an invalid table throws', () => {
        const t = table();
        t.picks = t.picks.filter((p) => p.n !== 100000);
        assert.throws(() => B.planCells(P(['--scenario', 'S7']), [], t), /no chunkCap pick for S7@100000/);
        assert.throws(() => B.planCells(P(['--scenario', 'S7', '--quick']), [], table()), /no chunkCap pick for S7@4096/);
        const bad = table();
        bad.picks[0].chunkCap = 102;
        assert.throws(() => B.planCells(P(['--scenario', 'S7']), [], bad), /picks: picks\[0\]\.chunkCap/);
    });
    test('planCells round trip (S2, built capacity n + 1, R-BA21): --quick sweep plan -> picks table -> planned cells at each pick; a table at capacity n is stale', async () => {
        const { defaultChunkCap, sweepGrid } = await import('../benchmark/Compare.mjs');
        const sweep = B.planCells(P(['--sweep', 'chunkCap', '--scenario', 'S2', '--quick']), []).sweep;
        assert.deepEqual(sweep.map((w) => w.n), [1024, 2048, 4096]);
        for (const w of sweep) {
            assert.equal(w.capacity, w.n + 1, 'S2@' + w.n + ' sweeps at its built capacity n + 1');
            assert.equal(w.capacity, selectScenario('S2').build(null, w.n, SEED).capacity, 'the scenario builds that capacity');
        }
        const t = table();
        t.picks = sweep.map((w) => ({ scenario: w.sid, n: w.n, capacity: w.capacity, d: w.d, grid: w.grid.slice(), chunkCap: w.grid[2],
            edge: false, nsPerEvent: 10 }));
        const plan = B.planCells(P(['--scenario', 'S2', '--quick']), [], JSON.parse(JSON.stringify(t)));
        let tuned = 0;
        for (const c of plan.groups.flat()) {
            if (!c.member.startsWith('BlockedArray')) continue;
            tuned++;
            const w = sweep.find((x) => x.n === c.n);
            assert.equal(c.pickCap, w.grid[2], c.member + '@' + c.n);
            assert.deepEqual(c.tune, { chunkCap: w.grid[2] });
        }
        assert.ok(tuned >= 3, 'BlockedArray labels planned: ' + tuned);
        // control: the same table swept at capacity n (d / grid recomputed so validatePicks accepts it) is stale
        const stale = JSON.parse(JSON.stringify(t));
        for (const p of stale.picks) {
            p.capacity = p.n;
            p.d = defaultChunkCap(p.n);
            p.grid = sweepGrid(p.d);
            p.chunkCap = p.grid[2];
        }
        assert.equal(B.validatePicks(JSON.parse(JSON.stringify(stale))), true, 'the stale control is a valid table');
        assert.throws(() => B.planCells(P(['--scenario', 'S2', '--quick']), [], stale), /swept at capacity 1024, this run builds capacity 1025/);
    });
    test('planCells with picks fails closed: a pick whose capacity is not the capacity this run builds (a stale table) throws', () => {
        // S7 builds capacity n (the sweep test above pins 4096 -> 4096); a pick swept at capacity 20000 for n 10000 is stale.
        // Hand oracle: ceil(sqrt(20000)) = 142 -> 144; sweepGrid(144) = [36, 72, 144, 288, 576].
        const t = table();
        Object.assign(t.picks[0], { capacity: 20000, d: 144, grid: [36, 72, 144, 288, 576], chunkCap: 144, edge: false });
        assert.equal(B.validatePicks(t), true, 'fixture: the stale table is otherwise valid');
        assert.throws(() => B.planCells(P(['--scenario', 'S7']), [], t), /pick for S7@10000 was swept at capacity 20000, this run builds capacity 10000/);
        assert.ok(B.planCells(P(['--scenario', 'S7']), [], table()).groups.length > 0, 'control: the capacity-n table plans');
    });
    test('planCells with picks fails closed: a run with no BlockedArray scenario cell (D-rows only) refuses the table', () => {
        assert.throws(() => B.planCells(P(['--picks', 'p.json']), [], table()), /--picks names no BlockedArray cell of this run/);
        assert.ok(B.planCells(P(['--scenario', 'S7', '--picks', 'p.json']), [], table()).groups.flat().some((c) => c.pickCap !== undefined), 'control: an S7 run tunes its BlockedArray cells');
    });
    test('sweepPicks: argmin per (Sid, n) over the ~c cells, edge flag; the table validates; a missing cell throws', () => {
        const plan = B.planCells(P(['--sweep', 'chunkCap', '--scenario', 'S7', '--quick']));
        const mk = (vals) => {
            const R = {};
            [16, 32, 64, 128, 256].forEach((cc, i) => {
                R['BlockedArray/S7@4096~c' + cc] = { member: 'BlockedArray', scenario: 'S7', n: 4096, chunkCap: cc, phases: [phaseRow('BlockedArray', 'blend', vals[i])] };
            });
            return R;
        };
        const mid = B.sweepPicks(plan, mk([30, 20, 10, 20, 30]));
        assert.deepEqual(mid, [{ scenario: 'S7', n: 4096, capacity: 4096, d: 64, grid: [16, 32, 64, 128, 256], chunkCap: 64, edge: false, nsPerEvent: 10 }]);
        const end = B.sweepPicks(plan, mk([30, 20, 10, 9, 8]));
        assert.deepEqual([end[0].chunkCap, end[0].edge], [256, true]);
        assert.equal(B.validatePicks({ ...table(), picks: mid }), true);
        const gap = mk([1, 2, 3, 4, 5]);
        delete gap['BlockedArray/S7@4096~c128'];
        assert.throws(() => B.sweepPicks(plan, gap), /no cell BlockedArray\/S7@4096~c128/);
    });

    // ---- spawned exits (each before any cell: no 'running' line, no file)
    const scratch = mkdtempSync(tmpdir() + '/ygg-picks-');
    const picksFile = (t) => {
        const f = scratch + '/p' + Math.random().toString(36).slice(2) + '.json';
        writeFileSync(f, typeof t === 'string' ? t : JSON.stringify(t));
        return f;
    };
    const chunkcap = PKG + 'benchmark/chunkcap.json';
    test('spawned: --picks missing file / bad JSON / bad table / no pick for the quick n, and --sweep with --picks, each exit 2 before any cell', () => {
        const bad = table();
        bad.picks[0].edge = true;
        const rows = [
            [['--scenario', 'S7', '--quick', '--picks', scratch + '/none.json'], '--picks: cannot read'],
            [['--scenario', 'S7', '--quick', '--picks', picksFile('{"schema":')], 'is not JSON'],
            [['--scenario', 'S7', '--quick', '--picks', picksFile(bad)], 'picks: picks[0].edge'],
            [['--scenario', 'S7', '--quick', '--picks', picksFile(table())], 'no chunkCap pick for S7@4096'],
            [['--sweep', 'chunkCap', '--scenario', 'S7', '--quick', '--picks', picksFile(table())], 'drop --picks'],
            [['--quick', '--picks', picksFile(table())], '--picks names no BlockedArray cell of this run'],
        ];
        for (const [args, msg] of rows) {
            const r = bench(args);
            assert.equal(r.status, 2, args.join(' ') + ': ' + r.stderr);
            assert.ok(r.stderr.includes(msg), args.join(' ') + ' stderr: ' + r.stderr);
            assert.ok(!r.stderr.includes('running '), 'no cell ran: ' + args.join(' '));
        }
    });
    test('spawned (A4): QUIET_LOCK_HOST=preliminary --sweep chunkCap --all --publish exits 2 before any cell, writes no chunkcap.json', () => {
        const had = existsSync(chunkcap);
        const r = bench(['--sweep', 'chunkCap', '--all', '--publish'], { ...process.env, QUIET_LOCK_HOST: 'preliminary' });
        assert.equal(r.status, 2, r.stdout + r.stderr);
        assert.ok(r.stderr.includes('only from a QUIET host'), r.stderr);
        assert.ok(!r.stderr.includes('running ') && !r.stdout.includes('cells'), 'no header, no cell');
        assert.equal(existsSync(chunkcap), had);
    });
    test('spawned: QUIET_LOCK_HOST=preliminary --scenario S7 --publish exits 2 (needs --all) before any cell', () => {
        const r = bench(['--scenario', 'S7', '--publish'], { ...process.env, QUIET_LOCK_HOST: 'preliminary' });
        assert.equal(r.status, 2, r.stdout + r.stderr);
        assert.ok(r.stderr.includes('needs --all'), r.stderr);
        assert.ok(!r.stderr.includes('running '));
    });

    // ---- Report: the four sections, PRELIMINARY labels, no GO text, "not measured", fail closed
    const TITLES = ['chunkCap picks (BA-31)', 'Blend win / TIE / loss grid (BA-29)', 'Crossovers (BA-30)',
        'BlockedArray unrolled vs plain A/B, twin A/A control (BA-29)'];
    const h2 = (title) => '<h2>' + title.replace(/&/g, '&amp;') ;
    const tuned = (hostState) => { const p = payload(s7(), hostState); p.tuning = tuning(); return p; };
    test('Report: the four sections render; PRELIMINARY payload labels each [PRELIMINARY]; no GO text', () => {
        const html = Rep.renderHtml(tuned('PRELIMINARY'));
        for (const t of TITLES) assert.ok(html.includes(h2(t) + ' [PRELIMINARY]</h2>'), t);
        assert.ok(html.includes('FenwickRebuild.suffix'));
        assert.ok(html.includes('none up to 1000000'));
        assert.ok(html.includes('<td>loss</td>') && html.includes('<td>TIE</td>'), 'blend grid verdicts');
        assert.ok(html.includes('twin TIE'));
        assert.ok(!/\bGO\b/.test(html) && !/NO-GO/i.test(html), 'no GO / NO-GO text');
    });
    test('Report: a QUIET MEASURED payload renders the four sections WITHOUT the PRELIMINARY label; no GO text', () => {
        const html = Rep.renderHtml(tuned('QUIET'));
        for (const t of TITLES) {
            assert.ok(html.includes(h2(t) + '</h2>'), t);
            assert.ok(!html.includes(h2(t) + ' [PRELIMINARY]'), t);
        }
        assert.ok(!/\bGO\b/.test(html));
    });
    test('Report: twin not TIE -> INCONCLUSIVE shown in the crossovers and the A/A section', () => {
        const html = Rep.renderHtml(payload(s7(five(80))));
        assert.ok(html.includes('<td>INCONCLUSIVE</td>'));
        assert.match(html, /twin A\/A \(BlockedArray\.twin vs BlockedArray\): INCONCLUSIVE/);
        // grid (SumSequence vs FenwickRebuild.suffix = loss, vs BlockedArray = TIE) and the unrolled vs plain A/B row (TIE)
        assert.ok(html.includes('<td>loss (INCONCLUSIVE)</td>') && html.includes('<td>TIE (INCONCLUSIVE)</td>'), 'grid + A/B rows');
        assert.ok(/<td>0\.\d+<\/td><td>TIE \(INCONCLUSIVE\)<\/td><\/tr>/.test(html) || /<td>1(\.0+)?<\/td><td>TIE \(INCONCLUSIVE\)<\/td>/.test(html),
            'an A/B row (ratio cell, then its verdict) carries the suffix');
        assert.ok(!/<td>(win|loss|TIE|unrolled win|plain win)<\/td>/.test(html), 'no bare verdict under INCONCLUSIVE');
        assert.ok(!/\bGO\b/.test(html));
    });
    test('Report: labels not in the payload read "not measured in this run" (no throw); no tuning section without tuning', () => {
        const d = { schema: 'yggdrasil-bench/1', status: 'PENDING', meta: meta('PRELIMINARY'), subjects: ['SumSequence'],
            dimensions: [], titles: {}, scenarios: [], results: {}, lossTable: [] };
        const html = Rep.renderHtml(d);
        assert.ok(!html.includes(TITLES[0]));
        assert.ok(html.split('not measured in this run').length - 1 >= 4, 'grid, crossovers, A/B, twin');
        assert.ok(!/\bGO\b/.test(html), 'no GO text in the not-measured form');
        const R = s7();
        for (const n of S7N) { delete R['BlockedArray.plain/S7@' + n]; }
        const h = Rep.renderHtml(payload(R));
        assert.match(h, /unrolled vs plain: not measured in this run/);
        assert.ok(h.includes('FenwickRebuild.suffix'));
    });
    test('Report: the per-phase Scenarios table renders every scenario key form (untagged and a sweep ~c key), n and phase filled', () => {
        const html = Rep.renderHtml(payload(s7()));
        assert.ok(html.includes('<h2>Scenarios'), 'section rendered');
        assert.ok(html.includes('<tr><td>SumSequence/S7@10000</td><td>10000</td><td>blend</td><td>'), 'a known untagged cell');
        assert.ok(html.includes('<tr><td>BlockedArray.twin/S7@1000000</td><td>1000000</td><td>blend</td><td>'), 'a dotted label');
        const sw = {};
        for (const cc of [16, 32]) sw['BlockedArray/S7@4096~c' + cc] = { member: 'BlockedArray', scenario: 'S7', n: 4096, chunkCap: cc, phases: [phaseRow('BlockedArray', 'blend', 10)] };
        const h = Rep.renderHtml(payload(sw));
        assert.ok(h.includes('<tr><td>BlockedArray/S7@4096~c16</td><td>4096</td><td>blend</td><td>'), 'a sweep cell');
        assert.ok(!h.includes('<td>undefined</td>'));
    });
    test('Report fails closed: a Compare throw other than "not measured" propagates (a (Sid, n) with no SumSequence cell)', () => {
        const R = s7();
        delete R['SumSequence/S7@100000'];
        const p = payload(s7());
        p.results = JSON.parse(JSON.stringify(R));
        assert.throws(() => Rep.renderHtml(p), /has no SumSequence cell/);
    });

    // ---- inl drivers (TASK 2 smoke, 2 spawns)
    test('inl drivers: benchmark/inl/unrolled.mjs and plain.mjs exit 0 and print the same checksum line', { timeout: 120000 }, () => {
        const out = ['unrolled', 'plain'].map((v) => spawnSync(process.execPath, [PKG + 'benchmark/inl/' + v + '.mjs'], { encoding: 'utf8', timeout: 110000 }));
        const lines = out.map((r, i) => {
            assert.equal(r.status, 0, ['unrolled', 'plain'][i] + ': ' + r.stderr);
            const m = /^inl checksum \S+ length \d+ sum \S+$/m.exec(r.stdout);
            assert.ok(m, 'checksum line: ' + r.stdout);
            return m[0];
        });
        assert.equal(lines[0], lines[1]);
    });
});
