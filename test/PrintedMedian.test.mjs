/**
 * PrintedMedian.test.mjs -- BA-41 / R-BA47 / R-BA51 (burst 49): the printed value of every Scenarios phase and
 * every D8 op row is the median of its K passes, with the min of K and K beside it; the other timed D-row
 * columns keep pass 1 and say so ("(pass 1)"). Written FROM the plan ASSERTIONS 1-4 and 8 (an oracle
 * independent of the coder). Every expected number is computed by hand from the per-pass lists below:
 *   [50,10,20,30,40] sorted 10,20,30,40,50 -> median 30, min 10
 *   [40,10,20,30]    sorted 10,20,30,40    -> median (20+30)/2 = 25, min 10   (even K)
 *   [400,100,200,300,250] sorted 100,200,250,300,400 -> median 250, min 100
 *   [400,100,200,300]     sorted 100,200,300,400     -> median 250, min 100
 *   [70,30,90,10,50]      sorted 10,30,50,70,90      -> median 50, min 10
 * Namespace imports (import * as) so the file LOADS on the pre-BA-41 code: a missing export fails its own row
 * with a clear message instead of crashing the load. No timing, no files, deterministic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import * as C from '../benchmark/Compare.mjs';
import * as Rep from '../benchmark/Report.mjs';
import * as Rd from '../benchmark/Readme.mjs';
import * as B from '../benchmark/Bench.mjs';
import { NC, SumSequenceAdapter, SpliceFoilAdapter, countsRecord } from '../benchmark/Adapters.mjs';

const SEED = 0x9e3779b1 >>> 0;
const N8 = 16384;
const TABLE_OPS = ['insertAt+removeAt', 'setMeasure', 'indexAtSum', 'sumBefore', 'mixed'];

// ---- fixture builders (modelled on the payload / results builders of test/Bench.test.mjs) ----
const rec = (adapter, extras) => {
    const c = new Int32Array(NC);
    c[0] = 3; c[2] = 5;
    return JSON.parse(JSON.stringify(countsRecord(adapter, c, extras)));
};
const SUBJ_REC = () => rec(SumSequenceAdapter, undefined);
const FOIL_REC = () => rec(SpliceFoilAdapter, Float64Array.of(2));

// default per-op runs (K = 5), the two ops with distinct values, then a K / member override
const DEFAULT_RUNS = [100, 100, 100, 100, 100];
const S_RUNS = { indexAtSum: [50, 10, 20, 30, 40], setMeasure: [70, 30, 90, 10, 50] };
const F_RUNS = { indexAtSum: [400, 100, 200, 300, 250], setMeasure: [700, 300, 900, 100, 500] };

// One D8 result: pass 1 on top, passes 2..K as whole result objects in repeats (the real shape).
// p50 / p90 are CONSTANT across passes on purpose: they are "(pass 1)"-labelled spread columns, not under
// assertion here, so a pass permutation must leave them unchanged (counts are equal across passes too).
function d8Cell(member, getRec, runsByOp, naOp) {
    const K = (runsByOp.indexAtSum || DEFAULT_RUNS).length;
    const pass = (i) => ({
        dim: 'D8', member, baseline: 'fixture', unit: 'ns/op', n: N8,
        rows: TABLE_OPS.map((op) => (op === naOp ? { op, n: N8, na: 'fixture n/a' } : {
            op, n: N8, ops: 4096, samples: 9, nsPerOp: (runsByOp[op] || DEFAULT_RUNS)[i], p50: 555, p90: 666, ...getRec(),
        })),
    });
    const top = pass(0);
    top.repeats = [];
    for (let i = 1; i < K; i++) top.repeats.push(pass(i));
    return top;
}

const scenPhase = (ns) => ({ phase: 'blend', events: 100, ops: 100, nsPerOp: ns, p50: 555, p90: 666, ...SUBJ_REC(),
    checksum: 5, endState: 1, traceHash: 9 });
function scenCell(runs) {
    const one = (v) => ({ member: 'SumSequence', scenario: 'S7', n: 1000, chunkCap: 'n/a', phases: [scenPhase(v)] });
    return { ...one(runs[0]), repeats: runs.slice(1).map(one) };
}

const META = () => ({
    seed: SEED, node: 'v22.0.0', arch: 'arm64', platform: 'darwin', cpuModel: 'Fixture CPU', cpuCount: 8,
    date: '2026-11-06T12:00:00.000Z', sentinel: null, loadAvgStart: [0.5, 0.5, 0.5], loadAvgEnd: [0.6, 0.6, 0.6],
    hostState: 'QUIET', quietLockWhy: 'fixture', commit: 'abcdef0', mainFileSha: '0123abcd', runCount: 5,
    command: 'node benchmark/Bench.mjs --publish --all --runs 5', rivals: {},
});
const LOSS = [{ scenario: 'S7', winner: 'FenwickRebuild.suffix', loser: 'SumSequence', crossoverN: 1024, reason: 'fixture' }];

// D1..D7 results (pass 1 only), one valid minimal row each, for the "(pass 1)" label rows
function dRows() {
    const timed = (extra) => ({ ops: 1024, samples: 9, nsPerOp: 200, p50: 200, p90: 210, ...SUBJ_REC(), ...extra });
    const r = SUBJ_REC();
    return {
        'SumSequence/D1': {
            dim: 'D1', member: 'SumSequence', unit: 'touches/op',
            counts: [{ op: 'insertAt.mid', n: 1024, ops: 1024, touches: 6, maxTouches: 6, maxBound: 19, hits: 1, misses: 1,
                splits: 0, underflows: 0, violations: 0, touchesPerOp: 0.5, counts: r.counts }],
            violations: 0, traceHash: 1,
            fit: { x: 'log2 n', r2: 0.85, slope: 32.5, intercept: -140, r2Reference: 0.958, gates: false },
            timing: [timed({ op: 'insertAt+removeAt.random', n: 1024 })],
        },
        'SumSequence/D2': { dim: 'D2', member: 'SumSequence', unit: 'ns/op', n: 8192, total: 1049562,
            points: [{ ops: 1024, nsPerOp: 1282, ...SUBJ_REC() }], drift: 0.11, traceHash: 1 },
        'SumSequence/D3': { dim: 'D3', member: 'SumSequence', unit: 'bytes/live',
            rows: [{ dims: 1, n: 65536, bytes: 3867452, perLive: 59.01, floor: 8, ratio: 7.37, refillBytes: 3867452, stable: true }] },
        'SumSequence/D4': { dim: 'D4', member: 'SumSequence', unit: 'ns', proxy: true, n: 65536,
            walk: timed({ op: 'cursorWalk(0, n)', nsPerElem: 4.6 }), seek: timed({ op: 'indexAtSum.random' }), gap: 15.7,
            leafSweep: [{ leafSize: 4, walkNsPerElem: 5.2, seekNsPerOp: 83.9, gap: 16.1,
                walk: timed({ op: 'cursorWalk(0, n)', nsPerElem: 5.2 }), seek: timed({ op: 'indexAtSum.random' }) }] },
        'SumSequence/D5': { dim: 'D5', member: 'SumSequence', unit: 'bytes', file: 'Yggdrasil.js', sha256_8: 'e0618227',
            raw: 74643, gzip: 20010, gzipLevel: 9, minified: 'n/a', treeShaking: 'n/a', treeShakingReason: 'fixture' },
        'SumSequence/D6': { dim: 'D6', member: 'SumSequence', unit: 'B/op',
            perOp: [{ op: 'indexAtSum', zeroAlloc: true, points: [{ n: 1024, bytesPerOp: 0, opsPerMs: 5000, gcMajor: 0,
                gcMinor: 0, gcMaxMs: 0.5, ...SUBJ_REC() }] }], maxMajor: 0, maxPauseMs: 0.5 },
        'SumSequence/D7': { dim: 'D7', member: 'SumSequence', unit: 'ns/insert',
            rows: [{ pattern: 'append', dims: 1, fill: 0.25, ops: 4096, nsPerOp: 203, ...SUBJ_REC() }],
            keyTypes: { int: 'measured', string: 'n/a', object: 'n/a', reason: 'fixture' } },
    };
}

/** A MEASURED QUIET payload: D1..D8 + one S7 scenario cell; D8 and S7 carry K passes. */
function fullPayload(opts = {}) {
    const sRuns = opts.sRuns || S_RUNS;
    const fRuns = opts.fRuns || F_RUNS;
    const scen = opts.scenRuns || [50, 10, 20, 30, 40];
    return JSON.parse(JSON.stringify({
        schema: 'yggdrasil-bench/1', status: 'MEASURED', meta: { ...META(), ...(opts.sentinel ? { sentinel: opts.sentinel } : {}) },
        subjects: ['SumSequence'], foil: 'SpliceFoil',
        dimensions: ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8'], titles: {}, scenarios: ['S7'],
        adapters: { SumSequence: { role: 'subject', version: '0.1.1', params: {} },
            SpliceFoil: { role: 'primary', version: 'hand-written', params: {} } },
        results: {
            ...dRows(),
            'SumSequence/D8': d8Cell('SumSequence', SUBJ_REC, sRuns, opts.naOp),
            'SpliceFoil/D8': d8Cell('SpliceFoil', FOIL_REC, fRuns, opts.naOp),
            'SumSequence/S7@1000': scenCell(scen),
        },
        lossTable: LOSS, comparison: { inconclusive: false, twin: [] },
    }));
}

// ---- helpers ----
const need = (ns, name) => assert.equal(typeof ns[name], 'function', name + ' is not exported (old code?)');
function html(p) { need(Rep, 'renderHtml'); return Rep.renderHtml(p); }
function readme(p) { need(Rd, 'renderBenchmarksSection'); return Rd.renderBenchmarksSection(p, '1.2.3'); }
function summary(p) {
    need(B, 'summarize');
    const out = [];
    const orig = console.log;
    console.log = (...a) => { out.push(a.join(' ')); };
    try { B.summarize(p.results); } finally { console.log = orig; }
    return out.join('\n');
}
function section(h, prefix) {
    const a = h.indexOf('<section><h2>' + prefix);
    assert.ok(a >= 0, 'section "' + prefix + '" not rendered');
    return h.slice(a, h.indexOf('</section>', a));
}
function block(text, prefix) {
    const lines = text.split('\n');
    const i = lines.findIndex((l) => l.startsWith('-- ' + prefix));
    assert.ok(i >= 0, 'summarize block "' + prefix + '" not printed');
    let j = i + 1;
    while (j < lines.length && lines[j] !== '') j++;
    return lines.slice(i, j).join('\n');
}
const swapPass = (cell) => {
    // pass 1 <-> repeats[1], every field of the pass (counts equal across passes in these fixtures)
    const { repeats, ...first } = cell;
    const second = repeats[1];
    const rest = repeats.slice();
    rest[1] = first;
    return { ...second, repeats: rest };
};

// ---- validity control ----
test('control: the fixture payloads pass validateResults (a red row on old code is the old printing, not the fixture)', () => {
    need(B, 'validateResults');
    assert.doesNotThrow(() => B.validateResults(fullPayload()));
    assert.doesNotThrow(() => B.validateResults(fullPayload({ sRuns: { indexAtSum: [40, 10, 20, 30] }, fRuns: { indexAtSum: [400, 100, 200, 300] } })));
    assert.doesNotThrow(() => B.validateResults(fullPayload({ sRuns: { indexAtSum: [42] }, fRuns: { indexAtSum: [84] } })));
    assert.doesNotThrow(() => B.validateResults(fullPayload({ naOp: 'mixed' })));
});

// ---- ASSERTION 1: Report Scenarios ----
test('A1: Report Scenarios prints K, median-of-K and min-of-K for SumSequence/S7@1000 blend [50,10,20,30,40]', () => {
    const sc = section(html(fullPayload()), 'Scenarios');
    assert.ok(sc.includes('<td>blend</td><td>5</td><td>30.00</td><td>10.00</td>'), 'median 30.00, min 10.00, K 5');
    assert.match(sc, /<td>SumSequence\/S7@1000<\/td><td>1000<\/td><td>blend<\/td><td>5<\/td><td>30\.00<\/td><td>10\.00<\/td>/);
});

// ---- ASSERTION 2: D8 on all three surfaces (K = 5, even K = 4, K = 1 control) ----
const CASES = [
    { name: 'K=5', s: [50, 10, 20, 30, 40], f: [400, 100, 200, 300, 250], K: 5, sm: '30.00', sn: '10.00', fm: '250.00', fn: '100.00' },
    { name: 'even K=4', s: [40, 10, 20, 30], f: [400, 100, 200, 300], K: 4, sm: '25.00', sn: '10.00', fm: '250.00', fn: '100.00' },
    { name: 'K=1 control (median = min = pass 1)', s: [42], f: [84], K: 1, sm: '42.00', sn: '42.00', fm: '84.00', fn: '84.00' },
];
for (const c of CASES) {
    const p = () => fullPayload({ sRuns: { indexAtSum: c.s }, fRuns: { indexAtSum: c.f } });
    test('A2 README ' + c.name + ': | indexAtSum | median | min | ... | foil median | foil min | ... |', () => {
        const out = readme(p());
        const re = new RegExp('^\\| indexAtSum \\| ' + c.sm.replace('.', '\\.') + ' \\| ' + c.sn.replace('.', '\\.') +
            ' \\| [^|]+ \\| ' + c.fm.replace('.', '\\.') + ' \\| ' + c.fn.replace('.', '\\.') + ' \\| [^|]+ \\|$', 'm');
        assert.match(out, re);
    });
    test('A2 README header ' + c.name + ': literal K in every median / min header; 6 x ---: separator', () => {
        const lines = readme(p()).split('\n');
        const K = c.K;
        assert.ok(lines.includes('| op (n = 16384) | SumSequence ns/op (median of ' + K + ') | SumSequence ns/op (min of ' + K +
            ') | SumSequence touches/op | SpliceFoil ns/op (median of ' + K + ') | SpliceFoil ns/op (min of ' + K +
            ') | SpliceFoil moves/op |'), 'header line');
        assert.ok(lines.includes('| --- | ---: | ---: | ---: | ---: | ---: | ---: |'), 'separator line');
    });
    test('A2 Report D8 ' + c.name + ': the op-row shows K, median, min', () => {
        const sec = section(html(p()), 'D8 --');
        const row = (m, med, min) => new RegExp('<td>' + m + '\\.indexAtSum</td><td>' + N8 + '</td><td>' + c.K + '</td><td>' +
            med.replace('.', '\\.') + '</td><td>' + min.replace('.', '\\.') + '</td>');
        assert.match(sec, row('SumSequence', c.sm, c.sn));
        assert.match(sec, row('SpliceFoil', c.fm, c.fn));
    });
    test('A2 summarize D8 ' + c.name + ': the op-row line shows median | min and K', () => {
        const blk = block(summary(p()), 'D8 ');
        const line = (m, med, min) => new RegExp(m + '\\.indexAtSum\\s+' + med.replace('.', '\\.') + '\\s*\\|\\s*' +
            min.replace('.', '\\.') + '\\s*\\|.*K ' + c.K + '\\s*$', 'm');
        assert.match(blk, line('SumSequence', c.sm, c.sn));
        assert.match(blk, line('SpliceFoil', c.fm, c.fn));
    });
}
test('A2 summarize Scenario line: median, "min" beside it, K (cell S7@1000 blend)', () => {
    const blk = block(summary(fullPayload()), 'Scenario cells');
    assert.match(blk, /SumSequence\/S7@1000 blend\s+30\.00 ns\/event\s+min\s+10\.00\s+K 5\b/);
});
test('A2 rowRunValues returns the K pass values in pass order (Compare)', () => {
    need(C, 'rowRunValues');
    const p = fullPayload();
    assert.deepEqual(C.rowRunValues(p.results['SumSequence/D8'], 'indexAtSum', N8), [50, 10, 20, 30, 40]);
    assert.deepEqual(C.rowRunValues(p.results['SpliceFoil/D8'], 'indexAtSum', N8), [400, 100, 200, 300, 250]);
});

// ---- ASSERTION 3: pass permutation leaves every printed form byte-identical ----
function swapped(p) {
    const q = JSON.parse(JSON.stringify(p));
    for (const k of ['SumSequence/D8', 'SpliceFoil/D8', 'SumSequence/S7@1000']) q.results[k] = swapPass(q.results[k]);
    return q;
}
test('A3 permutation: swapping pass 1 with repeats[1] leaves renderHtml byte-identical', () => {
    const p = fullPayload();
    assert.notDeepEqual(p, swapped(p), 'the swap changes the data');
    assert.equal(html(swapped(p)), html(p));
});
test('A3 permutation: renderBenchmarksSection byte-identical', () => {
    const p = fullPayload();
    assert.equal(readme(swapped(p)), readme(p));
});
test('A3 permutation: summarize output byte-identical', () => {
    const p = fullPayload();
    assert.equal(summary(swapped(p)), summary(p));
});

// ---- ASSERTION 4: rowRunValues fails closed (6 throw rows + na -> null) ----
const cellOf = () => fullPayload().results['SumSequence/D8'];
const callRRV = (cell, op = 'indexAtSum') => { need(C, 'rowRunValues'); return C.rowRunValues(cell, op, N8); };
test('A4 throw 1: a repeat missing the op', () => {
    const c = cellOf();
    c.repeats[2].rows = c.repeats[2].rows.filter((x) => x.op !== 'indexAtSum');
    need(C, 'rowRunValues');
    assert.throws(() => callRRV(c));
});
test('A4 throw 2: a repeat that names another member', () => {
    const c = cellOf();
    c.repeats[1].member = 'SpliceFoil';
    need(C, 'rowRunValues');
    assert.throws(() => callRRV(c));
});
test('A4 throw 2b: a repeat with another dim', () => {
    const c = cellOf();
    c.repeats[1].dim = 'D7';
    need(C, 'rowRunValues');
    assert.throws(() => callRRV(c));
});
test('A4 throw 2c: a repeat with another n', () => {
    const c = cellOf();
    c.repeats[1].n = 8192;
    need(C, 'rowRunValues');
    assert.throws(() => callRRV(c));
});
test('A4 throw 5b: README throws when pass 1 of a D8 row is n/a but the repeats are timed', () => {
    const p = fullPayload();
    const cell = p.results['SumSequence/D8'];
    cell.rows = cell.rows.map((x) => (x.op === 'mixed' ? { op: x.op, n: x.n, na: 'x' } : x));
    need(Rd, 'renderBenchmarksSection');
    assert.throws(() => Rd.renderBenchmarksSection(p, '1.2.3'));
});
test('A4 throw 3: a duplicate op row (pass 1, and inside a repeat)', () => {
    need(C, 'rowRunValues');
    const a = cellOf();
    a.rows.push({ ...a.rows.find((x) => x.op === 'indexAtSum') });
    assert.throws(() => callRRV(a));
    const b = cellOf();
    b.repeats[0].rows.push({ ...b.repeats[0].rows.find((x) => x.op === 'indexAtSum') });
    assert.throws(() => callRRV(b));
});
for (const [label, bad] of [['0', 0], ['NaN', NaN], ['null', null]]) {
    test('A4 throw 4 (' + label + '): a repeat nsPerOp of ' + label, () => {
        const c = cellOf();
        c.repeats[1].rows.find((x) => x.op === 'indexAtSum').nsPerOp = bad;
        need(C, 'rowRunValues');
        assert.throws(() => callRRV(c));
    });
}
test('A4 throw 5: na-ness differs (pass 1 timed, a repeat na; and the reverse)', () => {
    need(C, 'rowRunValues');
    const a = cellOf();
    a.repeats[1].rows = a.repeats[1].rows.map((x) => (x.op === 'indexAtSum' ? { op: x.op, n: x.n, na: 'x' } : x));
    assert.throws(() => callRRV(a));
    const b = cellOf();
    b.rows = b.rows.map((x) => (x.op === 'indexAtSum' ? { op: x.op, n: x.n, na: 'x' } : x));
    assert.throws(() => callRRV(b));
});
test('A4 throw 6: README measured form throws when the subject and foil D8 cells disagree on K', () => {
    const p = fullPayload();
    p.results['SpliceFoil/D8'].repeats = p.results['SpliceFoil/D8'].repeats.slice(0, 2); // K = 3 vs 5
    need(Rd, 'renderBenchmarksSection');
    assert.throws(() => Rd.renderBenchmarksSection(p, '1.2.3'), /D8 cells disagree on K/);
});
test('A4 na row: rowRunValues returns null (strictEqual), never 0; README prints n/a for it', () => {
    need(C, 'rowRunValues');
    const p = fullPayload({ naOp: 'mixed' });
    assert.strictEqual(C.rowRunValues(p.results['SumSequence/D8'], 'mixed', N8), null);
    assert.strictEqual(C.rowRunValues(p.results['SpliceFoil/D8'], 'mixed', N8), null);
    const row = readme(p).split('\n').find((l) => l.startsWith('| mixed |'));
    assert.ok(row !== undefined && !/\| 0 \|/.test(row) && /n\/a/.test(row), row);
});

// ---- ASSERTION 8 (P1, R-BA51): every other timed D-row header carries "(pass 1)" ----
for (const [id, prefix] of [['D1', 'D1 --'], ['D2', 'D2 --'], ['D4', 'D4 --'], ['D6', 'D6 --'], ['D7', 'D7 --']]) {
    test('A8 report.html ' + id + ': the timing header / note carries "(pass 1)"', () => {
        assert.ok(section(html(fullPayload()), prefix).includes('(pass 1)'), id + ' section has no "(pass 1)"');
    });
}
const HDRS = { 'D1 --': ['fit r2', 'slope (ns/level)', 'intercept'], 'D2 --': ['drift (last/first)'],
    'D4 --': ['walk ns/elem', 'seek ns/op', 'gap'], 'D6 --': ['ops/ms', 'max pause ms'], 'D7 --': ['ns/insert'] };
for (const prefix of Object.keys(HDRS)) {
    test('A8 report.html ' + prefix + ' exact header cells carry (pass 1): ' + HDRS[prefix].join(', '), () => {
        const sec = section(html(fullPayload()), prefix);
        for (const h of HDRS[prefix]) assert.ok(sec.includes('<th>' + h + ' (pass 1)</th>'), h);
    });
}
test('A8 report.html D2: the drift-sentinel note prints "first (pass 1)"', () => {
    const sent = { cell: 'SumSequence/D2', first: 100, second: 105, drift: 0.05, limit: 0.1 };
    const sec = section(html(fullPayload({ sentinel: sent })), 'D2 --');
    assert.match(sec, /first \(pass 1\)/);
});
test('A8 report.html D8: p50 and p90 headers read "p50 (pass 1)" / "p90 (pass 1)"', () => {
    const sec = section(html(fullPayload()), 'D8 --');
    assert.ok(sec.includes('<th>p50 (pass 1)</th>') && sec.includes('<th>p90 (pass 1)</th>'));
});
for (const [id, prefix] of [['D1', 'D1 '], ['D2', 'D2 '], ['D4', 'D4 '], ['D6', 'D6 '], ['D7', 'D7 ']]) {
    test('A8 summarize ' + id + ': the block title / lines carry "(pass 1)"', () => {
        assert.ok(block(summary(fullPayload()), prefix).includes('(pass 1)'), id + ' block has no "(pass 1)"');
    });
}
test('A8 summarize: EVERY data line of D2 / D4 / D7, the D6 maxPauseMs line and the D1 fit line carry "(pass 1)"', () => {
    const s = summary(fullPayload());
    for (const id of ['D2 ', 'D4 ', 'D7 ']) {
        const data = block(s, id).split('\n').slice(1);
        assert.ok(data.length >= (id === 'D4 ' ? 2 : 1), id + ' has data lines (D4 incl. the leaf line)');
        for (const l of data) assert.ok(l.includes('(pass 1)'), id + ' line lacks (pass 1): ' + l);
    }
    const d6 = block(s, 'D6 ').split('\n').find((l) => l.includes('maxPauseMs'));
    assert.ok(d6 !== undefined && d6.includes('(pass 1)'), 'D6 maxPauseMs line: ' + d6);
    const d1 = block(s, 'D1 ').split('\n').find((l) => l.includes(' fit ') && !l.startsWith('-- '));
    assert.ok(d1 !== undefined && d1.includes('(pass 1)'), 'D1 fit line: ' + d1);
});
// regression pins (pass on old and new code): counts / sizes / bytes are DETERMINISTIC and stay unlabelled
test('A8 pin: D3 (bytes) and D5 (sizes) are NOT labelled "(pass 1)" in report.html or summarize', () => {
    const h = html(fullPayload());
    const s = summary(fullPayload());
    for (const id of ['D3', 'D5']) {
        assert.ok(!section(h, id + ' --').includes('(pass 1)'), 'report ' + id);
        assert.ok(!block(s, id + ' ').includes('(pass 1)'), 'summarize ' + id);
    }
});
