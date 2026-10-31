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
import { readFileSync, existsSync } from 'node:fs';

import { SumSequence } from '../Yggdrasil.js';
import {
    NA, NC, COUNTER_NAMES, ADAPTERS, RIVAL_SLOTS, SumSequenceAdapter, SpliceFoilAdapter,
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
    const good = () => ({ id: 'S1', title: 'splice', adapters: ['SumSequence'], sizes: [1024], build() { return null; } });

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
    test('selectScenario(BOGUS) throws; SCENARIOS is empty (group 2 registers them)', () => {
        assert.throws(() => selectScenario('BOGUS'), /unknown scenario BOGUS/);
        assert.equal(SCENARIOS.length, 0);
    });

    test('selectAdapter: unknown name throws; near miss gets a did-you-mean at the helper', () => {
        assert.throws(() => selectAdapter('BOGUS'), /unknown adapter BOGUS/);
        assert.ok(ADAPTERS.length >= 2);
        assert.equal(selectAdapter('SumSequence'), SumSequenceAdapter);
        // pending rival slots fail closed with their status, never a silent stub
        for (const name of Object.keys(RIVAL_SLOTS)) assert.throws(() => selectAdapter(name), /PENDING/);
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
    test('A6: --scenario S1 exits 2 (not registered until group 2)', () => {
        const r = spawnSync(process.execPath, [PKG + 'benchmark/Bench.mjs', '--scenario', 'S1'], { encoding: 'utf8', timeout: 60000 });
        assert.equal(r.status, 2);
    });
});
