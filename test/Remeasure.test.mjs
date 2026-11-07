/**
 * @zakkster/lite-yggdrasil -- twin re-measure tooling GATE (node:test), R-BA57 / H1.
 *
 * Independent oracle: every expected value comes from the PLAN ASSERTIONS 1-5
 * (.handoff/PLAN-bench-adopt-remeasure.md) or from hand arithmetic -- never from running the
 * implementation and copying its output. The fake runner holds no child process and no clock: a
 * cell's value is a pure function of (label, n, round), where round = floor(call index of that
 * key / o.runs); round 0 is the K-pass measurement, round 1 the re-measure. Expected call
 * sequences are written out by hand from BA-28 (pass-major, each group rotated LEFT by the pass).
 *
 * A4 pins: the key-absent html / README shas below were produced ONCE by the frozen 8d0113f build
 * (.handoff/evidence/b50/before/, renderHtml / renderBenchmarksSection) on this file's fixture
 * (REMEASURE_DUMP=<path> writes it), not by the live code. Run the 6 real results.json goldens with
 * `node .handoff/evidence/remeasure/golden.mjs <root> --check .handoff/evidence/remeasure/golden.json`
 * (GOLDEN OK 6/6 when this file was written). ASCII only.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync, readFileSync } from 'node:fs';

import { NC, countsRecord, selectAdapter, SumSequenceAdapter, SpliceFoilAdapter } from '../benchmark/Adapters.mjs';
import * as B from '../benchmark/Bench.mjs';
import * as Rep from '../benchmark/Report.mjs';
import * as Rd from '../benchmark/Readme.mjs';
import { defaultChunkCap, sweepGrid } from '../benchmark/Compare.mjs';

const SEED = 0x9e3779b1 >>> 0;
const RUNS = 5;
// the plan's label order for a scenario group (hand-copied from planCells' documented order)
const LABELS = ['SumSequence', 'BlockedArray', 'BlockedArray.plain', 'BlockedArray.twin',
    'FenwickRebuild.suffix', 'FenwickRebuild.full'];
const NS = [1024, 2048, 4096];          // --scenario S2a --quick
const FLAG = 2048;                      // the group whose twin reads A on the first measurement
const A = NS.length * LABELS.length;    // 18 cells per pass
const L = LABELS.length;                // 6 labels per group
const BASE = { 'SumSequence': 200, 'BlockedArray': 100, 'BlockedArray.plain': 100, 'BlockedArray.twin': 100,
    'FenwickRebuild.suffix': 150, 'FenwickRebuild.full': 300 };
// round-1 values of the flagged group (re-measure): everything shifts, so a kept / merged cell is identifiable
const AGAIN = { 'SumSequence': 250, 'BlockedArray': 110, 'BlockedArray.plain': 110, 'BlockedArray.twin': 110,
    'FenwickRebuild.suffix': 160, 'FenwickRebuild.full': 310 };
const THROW = Symbol('throw');

const phaseRow = (label, ns) => {
    const a = selectAdapter(label.startsWith('BlockedArray') ? 'BlockedArray' : label);
    const rec = countsRecord(a, new Int32Array(NC), new Float64Array(a.extraCounts.length));
    return { phase: 'blend', events: 100, ops: 100, nsPerOp: ns, p50: ns, p90: ns, ...rec, checksum: 5, endState: 1, traceHash: 9 };
};
const cellOf = (member, n, ns) => ({ member, scenario: 'S2a', n, chunkCap: member.startsWith('BlockedArray') ? 64 : 'n/a',
    phases: [phaseRow(member, ns)] });

/**
 * A fake runner. val(member, n, round, idx) -> ns | THROW. Records every call.
 * `round` is derived here from the per-key call index, not from the implementation.
 */
function fake(val, runs = RUNS) {
    const seen = new Map();
    const calls = [];
    const run = (member, dim, o, c) => {
        const key = member + '@' + c.n;
        const idx = seen.get(key) || 0;
        seen.set(key, idx + 1);
        const round = Math.floor(idx / runs);
        calls.push({ member, n: c.n, round, idx });
        const v = val(member, c.n, round, idx);
        if (v === THROW) throw new Error('fake cell failure ' + key);
        return cellOf(member, c.n, v);
    };
    return { run, calls };
}
// flagged-group twin: round 0 -> 90 (min ratio 90/100 = 0.9, 'A'); round 1 -> `twinAgain` (110 = TIE vs 110)
const spec = (twinAgain = 110) => (member, n, round) => {
    if (n !== FLAG) return BASE[member];
    if (round === 0) return member === 'BlockedArray.twin' ? 90 : BASE[member];
    return member === 'BlockedArray.twin' ? twinAgain : AGAIN[member];
};
const flat = () => (member) => BASE[member];

const optsOf = (runs = RUNS) => B.parseArgs(['--scenario', 'S2a', '--quick', '--runs', String(runs)]);
const planOf = () => B.planCells(optsOf());
const quiet = () => {};
const callIds = (calls) => calls.map((c) => c.member + '@' + c.n);

// hand-written expected call sequences (BA-28: pass p rotates every group left by p)
const rot = (p) => LABELS.map((_, i) => LABELS[(i + p) % L]);
function expectFirst(passes) {
    const out = [];
    for (let p = 0; p < passes; p++) for (const n of NS) for (const m of rot(p)) out.push(m + '@' + n);
    return out;
}
function expectRe(passes) {
    const out = [];
    for (let p = 0; p < passes; p++) for (const m of rot(p)) out.push(m + '@' + FLAG);
    return out;
}
const KEYS_FLAG = LABELS.map((m) => m + '/S2a@' + FLAG);
const ALL_KEYS = NS.flatMap((n) => LABELS.map((m) => m + '/S2a@' + n));
const nsList = (cell) => [cell].concat(cell.repeats || []).map((r) => r.phases[0].nsPerOp);

const meta = () => ({ seed: SEED, node: 'v22.0.0', arch: 'arm64', platform: 'darwin', cpuModel: 'Fixture CPU',
    cpuCount: 8, date: '2026-11-01T12:00:00.000Z', sentinel: null, loadAvgStart: [0.5, 0.5, 0.5], loadAvgEnd: [0.6, 0.6, 0.6],
    hostState: 'PRELIMINARY', quietLockWhy: 'fixture', commit: 'abcdef0', mainFileSha: '0123abcd', runCount: RUNS,
    command: 'node benchmark/Bench.mjs --scenario S2a --quick --runs 5', rivals: {} });
function payloadOf(results, remeasure, cmpSource = results) {
    const cmp = B.comparisonOf(cmpSource);
    const p = { schema: 'yggdrasil-bench/1', status: 'MEASURED', meta: meta(), subjects: ['SumSequence'], dimensions: [],
        titles: {}, scenarios: ['S2a'], results, lossTable: cmp.lossTable };
    if (cmp.comparison !== null) p.comparison = cmp.comparison;
    if (remeasure !== null && remeasure !== undefined) p.remeasure = remeasure;
    return JSON.parse(JSON.stringify(p));
}
// README-capable payload (measured form needs a QUIET --publish run, foil + D8 cells, >= 1 loss row)
const TABLE_OPS = ['insertAt+removeAt', 'setMeasure', 'indexAtSum', 'sumBefore', 'mixed'];
const d8 = (adapter, extras) => {
    const c = new Int32Array(NC);
    c[0] = 3; c[2] = 5;
    const rec = countsRecord(adapter, c, extras);
    return { n: 1024, rows: TABLE_OPS.map((op) => ({ op, ops: 64, nsPerOp: 100, ...rec })) };
};
function fullPayload(results, remeasure, cmpSource = results) {
    const p = payloadOf(results, remeasure, cmpSource);
    p.results = { 'SumSequence/D8': d8(SumSequenceAdapter, undefined), 'SpliceFoil/D8': d8(SpliceFoilAdapter, Float64Array.of(2)),
        ...JSON.parse(JSON.stringify(results)) };
    p.dimensions = ['D8'];
    p.foil = 'SpliceFoil';
    p.meta.hostState = 'QUIET';
    p.meta.command = 'node benchmark/Bench.mjs --publish --scenario S2a --runs 5';
    p.lossTable = [{ scenario: 'S2a', winner: 'FenwickRebuild.suffix', loser: 'SumSequence', crossoverN: 'none up to 4096', reason: 'fixture' }];
    return JSON.parse(JSON.stringify(p));
}
const go = (val, runs = RUNS) => {
    const f = fake(val, runs);
    const mr = B.measureRun(planOf(), optsOf(runs), f.run, quiet);
    return { f, mr };
};
const sha = (s) => createHash('sha256').update(s).digest('hex');

describe('R-BA57 A1: call counts and order', () => {
    test('a flagged group is re-measured once: exactly 5A + 5L calls; the re-measure calls are every label of that group, K passes, rotated', () => {
        const { f, mr } = go(spec());
        assert.equal(f.calls.length, RUNS * A + RUNS * L);   // 5*18 + 5*6 = 120
        assert.equal(f.calls.length, 120);
        assert.deepEqual(callIds(f.calls), expectFirst(RUNS).concat(expectRe(RUNS)));
        assert.equal(mr.failures, 0);
    });
    test('no flagged group: 5A calls and remeasure []', () => {
        const { f, mr } = go(flat());
        assert.equal(f.calls.length, RUNS * A);
        assert.deepEqual(callIds(f.calls), expectFirst(RUNS));
        assert.deepEqual(mr.remeasure, []);
    });
    test('K = 2: 2A + 2L calls (the K of the re-measure follows o.runs)', () => {
        const { f } = go(spec(), 2);
        assert.deepEqual(callIds(f.calls), expectFirst(2).concat(expectRe(2)));
    });
    test('the re-measure never touches an unflagged group (no call of n 1024 / 4096 after the first 5A)', () => {
        const { f } = go(spec());
        for (const c of f.calls.slice(RUNS * A)) assert.equal(c.n, FLAG);
        for (const c of f.calls.slice(RUNS * A)) assert.equal(c.round, 1);
    });
    test('the check hook runs after the K passes and before any re-measure call', () => {
        const f = fake(spec());
        let at = -1;
        let keys = -1;
        B.measureRun(planOf(), optsOf(), f.run, quiet, (res) => { at = f.calls.length; keys = Object.keys(res).length; });
        assert.equal(at, RUNS * A);
        assert.equal(keys, A);
    });
    test('a throwing check hook: the error propagates and there are 0 re-measure calls', () => {
        const f = fake(spec());
        assert.throws(() => B.measureRun(planOf(), optsOf(), f.run, quiet, () => { throw new Error('pick check'); }), /pick check/);
        assert.equal(f.calls.length, RUNS * A);
    });
    test('check must be a function or null', () => {
        assert.throws(() => B.measureRun(planOf(), optsOf(), fake(flat()).run, quiet, 5), TypeError);
    });
});

describe('R-BA57 A2: merge shape', () => {
    test('remeasure holds the first measurement; results hold the re-measured cells; comparison reads them', () => {
        const { mr } = go(spec());
        assert.equal(mr.remeasure.length, 1);
        const e = mr.remeasure[0];
        assert.equal(e.scenario, 'S2a');
        assert.equal(e.n, FLAG);
        assert.deepEqual(e.first.twin, { scenario: 'S2a', n: FLAG, phase: 'blend', verdict: 'A', ratio: 0.9, minRatio: 0.9 });
        assert.deepEqual(Object.keys(e.first.results), KEYS_FLAG);
        for (const m of LABELS) {
            assert.deepEqual(nsList(e.first.results[m + '/S2a@' + FLAG]), Array(RUNS).fill(m === 'BlockedArray.twin' ? 90 : BASE[m]), m);
            assert.deepEqual(nsList(mr.results[m + '/S2a@' + FLAG]), Array(RUNS).fill(m === 'BlockedArray.twin' ? 110 : AGAIN[m]), m);
        }
        assert.deepEqual(B.comparisonOf(mr.results).comparison, { inconclusive: false, twin: [] });
    });
    test('the merged map keeps the key order and the other groups untouched', () => {
        const { mr } = go(spec());
        assert.deepEqual(Object.keys(mr.results), ALL_KEYS);
        for (const n of [1024, 4096]) {
            for (const m of LABELS) assert.deepEqual(nsList(mr.results[m + '/S2a@' + n]), Array(RUNS).fill(BASE[m]));
        }
    });
    test('the merged payload validates, carries remeasure, and its twin is no longer A/B', () => {
        const { mr } = go(spec());
        const p = payloadOf(mr.results, mr.remeasure);
        assert.equal(B.validateResults(p), true);
        assert.deepEqual(p.comparison, { inconclusive: false, twin: [] });
        assert.equal(p.remeasure.length, 1);
    });
    test('remeasureTargets: A/B rows in order, copied; MISSING skipped; TIE / bad row / duplicate throw', () => {
        const row = (n, verdict) => ({ scenario: 'S2a', n, phase: 'blend', verdict, ratio: 0.9, minRatio: 0.9 });
        const miss = { scenario: 'S2a', n: 8, phase: null, verdict: 'MISSING', ratio: null, minRatio: null };
        const tc = { twin: [row(1, 'A'), miss, row(2, 'B')] };
        const t = B.remeasureTargets(tc);
        assert.deepEqual(t, [row(1, 'A'), row(2, 'B')]);
        assert.notEqual(t[0], tc.twin[0]);
        assert.deepEqual(B.remeasureTargets({ twin: [miss] }), []);
        assert.throws(() => B.remeasureTargets({ twin: [row(1, 'TIE')] }));
        assert.throws(() => B.remeasureTargets({ twin: [row(1, 'A'), row(1, 'B')] }), /listed twice/);
        assert.throws(() => B.remeasureTargets({}));
    });
    test('remeasurePlan: the whole groups of the targets, plan order, unchanged cells; unknown target throws; pure', () => {
        const plan = planOf();
        const snap = JSON.stringify(plan);
        const t = [{ scenario: 'S2a', n: 4096, phase: 'blend', verdict: 'A', ratio: 0.9, minRatio: 0.9 },
            { scenario: 'S2a', n: 1024, phase: 'blend', verdict: 'B', ratio: 1.1, minRatio: 1.1 }];
        const rp = B.remeasurePlan(plan, t);
        assert.deepEqual(rp.groups, [plan.groups[0], plan.groups[2]]);
        assert.equal(rp.groups[0].length, L);
        assert.equal(JSON.stringify(plan), snap);
        assert.throws(() => B.remeasureTargets && B.remeasurePlan(plan, [{ ...t[0], n: 7 }]));
    });
    test('mergeRemeasure: fresh key set must be exactly the group; a K mismatch throws; inputs are never mutated', () => {
        const { mr } = go(spec());
        const firstMap = { ...mr.results, ...mr.remeasure[0].first.results };
        const fresh = {};
        for (const k of KEYS_FLAG) fresh[k] = mr.results[k];
        const tgt = [mr.remeasure[0].first.twin];
        const s1 = JSON.stringify(firstMap);
        const s2 = JSON.stringify(fresh);
        const m = B.mergeRemeasure(firstMap, fresh, tgt);
        assert.equal(JSON.stringify(firstMap), s1);
        assert.equal(JSON.stringify(fresh), s2);
        assert.deepEqual(m.results, mr.results);
        assert.deepEqual(m.remeasure, mr.remeasure);
        const missing = { ...fresh }; delete missing[KEYS_FLAG[0]];
        assert.throws(() => B.mergeRemeasure(firstMap, missing, tgt));
        assert.throws(() => B.mergeRemeasure(firstMap, { ...fresh, 'SumSequence/S2a@1024': firstMap['SumSequence/S2a@1024'] }, tgt));
        const k4 = { ...fresh, [KEYS_FLAG[0]]: { ...fresh[KEYS_FLAG[0]], repeats: fresh[KEYS_FLAG[0]].repeats.slice(1) } };
        assert.throws(() => B.mergeRemeasure(firstMap, k4, tgt), /K differs/);
    });
});

describe('R-BA57 A3: fail closed', () => {
    test('the re-measure reads A again: still exactly ONE re-measure (5A + 5L), INCONCLUSIVE, row carries the re-measure minRatio', () => {
        // re-measure twin 97 vs BlockedArray 110: 97 < 0.95 * 110 = 104.5 -> A; min ratio 97 / 110 (hand division)
        const { f, mr } = go(spec(97));
        assert.equal(f.calls.length, RUNS * A + RUNS * L);
        assert.equal(mr.remeasure.length, 1);
        const cmp = B.comparisonOf(mr.results);
        assert.equal(cmp.comparison.inconclusive, true);
        assert.equal(cmp.comparison.twin.length, 1);
        assert.equal(cmp.comparison.twin[0].verdict, 'A');
        assert.equal(cmp.comparison.twin[0].minRatio, 97 / 110);
        assert.equal(mr.remeasure[0].first.twin.minRatio, 0.9);
        for (const r of cmp.lossTable) assert.ok(r.reason.startsWith('INCONCLUSIVE'), r.reason);
        assert.equal(B.validateResults(payloadOf(mr.results, mr.remeasure)), true);
    });
    test('a MISSING twin is never re-measured: 0 re-measure calls', () => {
        const plan = { groups: planOf().groups.map((g) => g.filter((c) => c.member !== 'BlockedArray.twin')) };
        const f = fake(spec());
        const mr = B.measureRun(plan, optsOf(), f.run, quiet);
        assert.equal(f.calls.length, RUNS * (A - NS.length));   // 5 * 15
        assert.deepEqual(mr.remeasure, []);
        const tc = B.comparisonOf(mr.results).comparison;
        assert.equal(tc.inconclusive, true);
        assert.ok(tc.twin.length > 0 && tc.twin.every((r) => r.verdict === 'MISSING'));
    });
    test('a runner that throws on a re-measure call: failures counted, remeasure null, nothing merged', () => {
        const base = spec();
        const { f, mr } = go((m, n, round, idx) => (n === FLAG && round === 1 && m === 'BlockedArray.twin' && idx === RUNS ? THROW : base(m, n, round)));
        assert.equal(mr.failures, 1);
        assert.equal(mr.remeasure, null);
        assert.equal(f.calls.length, RUNS * A + RUNS * L);
        assert.deepEqual(nsList(mr.results['BlockedArray.twin/S2a@' + FLAG]), Array(RUNS).fill(90));   // first cell kept
        assert.deepEqual(nsList(mr.results['SumSequence/S2a@' + FLAG]), Array(RUNS).fill(200));
    });
    test('a runner that throws during the K passes: failures counted, remeasure null, no re-measure call', () => {
        const { f, mr } = go((m, n, round, idx) => (m === 'SumSequence' && n === 1024 && idx === 2 ? THROW : spec()(m, n, round)));
        assert.equal(mr.failures, 1);
        assert.equal(mr.remeasure, null);
        assert.equal(f.calls.length, RUNS * A);
    });

    describe('validateResults mutations (each throws naming its field)', () => {
        const good = () => { const { mr } = go(spec()); return payloadOf(mr.results, mr.remeasure); };
        const goodAgain = () => { const { mr } = go(spec(97)); return payloadOf(mr.results, mr.remeasure); };
        const MUT = [
            ['drop first', good, (p) => { delete p.remeasure[0].first; }, /remeasure\[0\]\.first/],
            ['drop one label of first.results', good, (p) => { delete p.remeasure[0].first.results['FenwickRebuild.full/S2a@2048']; }, /remeasure\[0\]\.first\.results/],
            ['[] beside an A/B row', goodAgain, (p) => { p.remeasure = []; }, /remeasure misses S2a@2048/],
            ['comparison taken from the first cells', null, null, /comparison must equal twinControl\(results\)/],
            ['duplicate entry', good, (p) => { p.remeasure.push(JSON.parse(JSON.stringify(p.remeasure[0]))); }, /remeasure\[1\] S2a@2048 listed twice/],
            ['first group reading TIE (cells)', good, (p) => {
                const r = p.remeasure[0].first.results;
                const c = JSON.parse(JSON.stringify(r['BlockedArray/S2a@2048']));
                for (const x of [c].concat(c.repeats)) x.member = 'BlockedArray.twin';
                r['BlockedArray.twin/S2a@2048'] = c;
            }, /remeasure\[0\]\.first\.twin must equal twinControl\(first\.results\)/],
            ['first.twin verdict TIE', good, (p) => { p.remeasure[0].first.twin.verdict = 'TIE'; }, /remeasure\[0\]\.first\.twin\.verdict/],
            ['remeasure without comparison', good, (p) => { delete p.comparison; }, /comparison missing/],
            ['remeasure not an array', good, (p) => { p.remeasure = {}; }, /remeasure must be an array/],
            ['first.twin names another group', good, (p) => { p.remeasure[0].first.twin.n = 4096; }, /remeasure\[0\]\.first\.twin must name S2a@2048/],
            ['unknown key in an entry', good, (p) => { p.remeasure[0].extra = 1; }, /remeasure\[0\]\.extra/],
        ];
        for (const [name, make, mutate, re] of MUT) {
            test(name, () => {
                let p;
                if (make === null) {
                    // lossTable + comparison computed from the FIRST cells, results = re-measured cells
                    const { mr } = go(spec());
                    const firstMap = { ...mr.results, ...mr.remeasure[0].first.results };
                    p = payloadOf(mr.results, mr.remeasure, firstMap);
                    assert.equal(p.comparison.inconclusive, true);
                } else {
                    p = make();
                    assert.equal(B.validateResults(JSON.parse(JSON.stringify(p))), true, 'the unmutated payload must validate');
                    mutate(p);
                }
                assert.throws(() => B.validateResults(p), re);
            });
        }
    });
});

describe('R-BA57 A4: key-absent files are unchanged', () => {
    // sha256 of renderHtml / renderBenchmarksSection(p, '0.0.0-fixture') on this fixture WITHOUT the remeasure key,
    // produced once by the frozen 8d0113f build (see the header); the live code must reproduce them byte for byte
    const HTML_SHA = 'ebb568643f636e6c11c387660464edd3ae3178ffe36b7650ede69a615c483319';
    const README_SHA = '37841b46f7101d5c8b96b7f66a8036fae5f91788f66672c158c7fe23a4579d74';
    const flatPayload = () => { const { mr } = go(flat()); return fullPayload(mr.results, null); };

    test('dump hook (REMEASURE_DUMP=<path> writes the key-absent fixture for the frozen-build pin)', () => {
        const p = flatPayload();
        assert.equal(p.remeasure, undefined);
        if (process.env.REMEASURE_DUMP) writeFileSync(process.env.REMEASURE_DUMP, JSON.stringify(p));
    });
    test('key-absent payload validates and renders byte-identically to the frozen build', () => {
        const p = flatPayload();
        assert.equal(B.validateResults(JSON.parse(JSON.stringify(p))), true);
        assert.equal(sha(Rep.renderHtml(p)), HTML_SHA);
        assert.equal(sha(Rd.renderBenchmarksSection(p, '0.0.0-fixture')), README_SHA);
    });
    test('control: the same payload + remeasure [] changes the html and the README', () => {
        const p = flatPayload();
        const q = { ...p, remeasure: [] };
        assert.equal(B.validateResults(JSON.parse(JSON.stringify(q))), true);
        assert.notEqual(sha(Rep.renderHtml(q)), HTML_SHA);
        assert.notEqual(sha(Rd.renderBenchmarksSection(q, '0.0.0-fixture')), README_SHA);
        assert.ok(Rep.renderHtml(q).includes('twin re-measure (R-BA57)'));
        assert.ok(!Rep.renderHtml(p).includes('twin re-measure'));
    });
    test('README provenance: ", twin re-measure (R-BA57): none" for [] and "<Sid>@<n> (first <v>, re-measure <v>)" for a group; absent for no key', () => {
        const p = flatPayload();
        assert.ok(!Rd.renderBenchmarksSection(p, '0.0.0-fixture').includes('re-measure'));
        assert.ok(Rd.renderBenchmarksSection({ ...p, remeasure: [] }, '0.0.0-fixture').includes(', twin re-measure (R-BA57): none'));
        const { mr } = go(spec());
        const q = fullPayload(mr.results, mr.remeasure);
        assert.ok(Rd.renderBenchmarksSection(q, '0.0.0-fixture').includes('S2a@2048 (first A, re-measure TIE)'));
        const html = Rep.renderHtml(q);
        assert.ok(html.includes('twin re-measure (R-BA57)'));
        assert.ok(html.includes('2048'));
    });
    test('an old file with a MEASURED comparison and no key still validates (runs #1..#5 path)', () => {
        const { mr } = go(spec());
        // the re-measured results as a key-absent file: comparison reads them, no remeasure key
        const p = payloadOf(mr.results, null);
        assert.equal(B.validateResults(p), true);
    });
});

describe('R-BA57 A5: repeatability and retention', () => {
    test('50 measureRun cycles: stable call count, plan and options unchanged, records deep-equal', () => {
        const plan = planOf();
        const o = optsOf();
        const planSnap = JSON.stringify(plan);
        const oSnap = JSON.stringify(o);
        let ref = null;
        for (let i = 0; i < 50; i++) {
            const f = fake(spec());
            const mr = B.measureRun(plan, o, f.run, quiet);
            assert.equal(f.calls.length, RUNS * A + RUNS * L, 'cycle ' + i);
            if (ref === null) ref = mr;
            else {
                assert.deepEqual(mr.results, ref.results, 'cycle ' + i);
                assert.deepEqual(mr.remeasure, ref.remeasure, 'cycle ' + i);
            }
        }
        assert.equal(JSON.stringify(plan), planSnap);
        assert.equal(JSON.stringify(o), oSnap);
        assert.equal(ref.remeasure.length, 1);
    });
});

describe('R-BA57 gate teeth (X1-X7)', () => {
    const good = () => { const { mr } = go(spec()); return payloadOf(mr.results, mr.remeasure); };
    test('X1 first.twin minRatio not reproduced', () => {
        const p = good(); p.remeasure[0].first.twin.minRatio = 0.91;
        assert.throws(() => B.validateResults(p), /remeasure\[0\]\.first\.twin must equal twinControl\(first\.results\)/);
    });
    test('X2 first cell K differs', () => {
        const p = good(); p.remeasure[0].first.results['SumSequence/S2a@2048'].repeats.pop();
        assert.throws(() => B.validateResults(p), /remeasure\[0\]\.first\.results\.SumSequence\/S2a@2048 has 4 run\(s\).*K differs/);
    });
    test('X3 first cell names another n', () => {
        const p = good(); p.remeasure[0].first.results['SumSequence/S2a@2048'].n = 4096;
        assert.throws(() => B.validateResults(p), /remeasure\[0\]\.first\.results\.SumSequence\/S2a@2048\.scenario must be S2a at n 2048/);
    });
    test('X4 comparison with an extra row', () => {
        const { mr } = go(spec(97)); const p = payloadOf(mr.results, mr.remeasure);
        p.comparison.twin.push({ scenario: 'S2a', n: 4096, phase: null, verdict: 'MISSING', ratio: null, minRatio: null });
        p.remeasure.push(null);
        p.remeasure.pop();
        assert.throws(() => B.validateResults(p), /comparison must equal twinControl\(results\)/);
    });
    test('X5 re-measure calls get the same o and the same plan cells as pass k', () => {
        const plan = planOf(); const o = optsOf();
        const seen = [];
        const f = fake(spec());
        const run = (m, d, oo, c) => { seen.push({ oo, c }); return f.run(m, d, oo, c); };
        B.measureRun(plan, o, run, quiet);
        assert.equal(seen.length, RUNS * A + RUNS * L);
        for (let j = 0; j < RUNS * A; j++) assert.equal(seen[j].oo, o);
        for (let p = 0; p < RUNS; p++) {
            const g = plan.groups[1]; const r = LABELS.map((_, i) => g[(i + p) % L]);
            for (let i = 0; i < L; i++) {
                const s = seen[RUNS * A + p * L + i];
                assert.equal(s.oo, o, 'o');
                assert.equal(s.c, r[i], 'cell');
            }
        }
    });
    test('X6 a checksum mismatch in the first measurement throws before any re-measure', () => {
        const base = fake(spec());
        let calls = 0;
        const run = (m, d, oo, c) => { calls++; const r = base.run(m, d, oo, c); if (m === 'FenwickRebuild.full' && c.n === FLAG) r.phases[0].checksum = 6; return r; };
        assert.throws(() => B.measureRun(planOf(), optsOf(), run, quiet), /checksum mismatch S2a@2048/);
        assert.equal(calls, RUNS * A);
    });
    test('X7 first cell off its tuning pick', () => {
        const p = good();
        const picks = NS.map((n) => { const cap = n === 2048 ? 4096 : n; const d = defaultChunkCap(cap); const grid = sweepGrid(d); return { scenario: 'S2a', n, capacity: cap, d, grid, chunkCap: 64, edge: grid[0] === 64 || grid[grid.length - 1] === 64, nsPerEvent: 1 }; });
        p.tuning = { source: 'x.json', sha256: '0'.repeat(64), hostState: 'PRELIMINARY', picks };
        assert.equal(B.validateResults(JSON.parse(JSON.stringify(p))), true);
        const c = p.remeasure[0].first.results['BlockedArray/S2a@2048'];
        c.repeats[0].chunkCap = 128;
        assert.throws(() => B.validateResults(p), /remeasure\[0\]\.first\.results\.BlockedArray\/S2a@2048\.chunkCap must equal the tuning pick 64/);
    });
});

describe('R-BA58 wiring pin', () => {
    // R-BA58 wiring pin: the payload must carry remeasure, and only after comparisonOf(results) is built
    test('Bench.mjs attaches payload.remeasure exactly once, after comparisonOf(results)', () => {
        const src = readFileSync(new URL('../benchmark/Bench.mjs', import.meta.url).pathname, 'utf8');
        const line = 'if (remeasure !== null) payload.remeasure = remeasure;';
        assert.equal(src.split(line).length, 2, 'exactly one attach line');
        assert.ok(src.indexOf(line) > src.indexOf('const cmp = comparisonOf(results);'), 'attach follows comparisonOf');
    });
});
