// Tests for benchmark/Trace.mjs + the trace.json hook in benchmark/Readme.mjs (PLAN-bench-adopt-publish7,
// R-BA64 / R-BA65). Expected values come from the plan SPEC + ASSERTIONS and the evidence traces, never from
// the implementation. Tests that read .handoff/ evidence (gitignored, absent in CI clones) skip when it is missing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const EV = ROOT + '.handoff/evidence/';
const T = await import(pathToFileURL(ROOT + 'benchmark/Trace.mjs').href);
const R = await import(pathToFileURL(ROOT + 'benchmark/Readme.mjs').href);
const { parseTrace, buildTrace, validateTrace, traceNote, TRACE_SCHEMA } = T;
const VERSION = JSON.parse(readFileSync(ROOT + 'package.json', 'utf8')).version;

// ---- helpers: synthetic trace rows in the evidence format ----
const row = (at, l1, entries) => at + '  ' + l1 + ' 5.95 11.67  | node>=10%: ' + entries;
const BENCH = '21354';
const own = '21463:21354:105.5: /opt/homebrew/bin/node --expose-gc /x/benchmark/Bench.mjs --cell --scenario ; ';
const quiet = (at) => row(at, '1.14', '');
const FAKE_RESULTS = { meta: { commit: 'e9fcf9c', date: '2026-11-07T22:03:16.396Z' } };

// A crossed synthetic trace (1 of 3) and a clean one (0 of 2), built by the module under test.
const crossedText = [quiet('22:00:00Z'), row('22:01:00Z', '3.67', own), quiet('22:02:00Z')].join('\n') + '\n';
const cleanText = [quiet('22:00:00Z'), row('22:01:00Z', '1.9', own)].join('\n') + '\n';
const REPL = ['#2 8e27490', '#4 8d0113f'];
const mkCrossed = () => buildTrace(parseTrace(crossedText, 2.21, BENCH), FAKE_RESULTS, { replicas: REPL.slice() });
const mkClean = () => buildTrace(parseTrace(cleanText, 2.21, BENCH), FAKE_RESULTS, {});

// ---- ASSERTION 1: real traces ----
const REAL = [
    ['b52/ror7.load', '21354', 94, 1, '23:04:17Z', 3.67, ['23:04:17Z']],
    ['b51/ror6.load', '79585', 93, 1, '19:50:35Z', 3.4, ['19:50:35Z']],
    ['b53/ror8.load', '87729', 94, 6, '04:11:17Z', 4.09, null],
    ['b50/ror5/ror5.load', '87280', 93, 0, '05:23:26Z', 1.8, []],
];
for (const [rel, pid, samples, crossed, peakAt, peak, crossAts] of REAL) {
    test('A1 parseTrace real trace ' + rel, (t) => {
        if (!existsSync(EV + rel)) return t.skip('.handoff evidence absent');
        const p = parseTrace(readFileSync(EV + rel, 'utf8'), 2.21, pid);
        assert.equal(p.samples, samples);
        assert.equal(p.crossed, crossed);
        assert.equal(p.crossings.length, crossed);
        assert.equal(p.peak.load1, peak);
        assert.equal(p.peak.at, peakAt);
        assert.equal(p.baseline, 2.21);
        assert.equal(p.line, 3.21);
        if (crossAts !== null) assert.deepEqual(p.crossings.map((c) => c.at), crossAts);
        if (rel === 'b52/ror7.load') assert.equal(p.crossings[0].load1, 3.67);
        // the same counts as the reference script the plan names
        const tc = EV + 'b49/ror3/trace-check.mjs';
        if (existsSync(tc)) {
            const out = spawnSync('node', [tc, EV + rel, '2.21', pid], { encoding: 'utf8' }).stdout;
            const m = /samples (\d+), crossed (\d+), line load1 < ([\d.]+), peak load1 ([\d.]+) at (\S+)/.exec(out);
            assert.ok(m, 'trace-check output');
            assert.equal(p.samples, Number(m[1]));
            assert.equal(p.crossed, Number(m[2]));
            assert.equal(p.line, Number(m[3]));
            assert.equal(p.peak.load1, Number(m[4]));
            assert.equal(p.peak.at, m[5]);
        }
    });
}

// ---- ASSERTION 2: synthetic rows ----
test('A2 load1 exactly at the line crosses; just below does not', () => {
    const a = parseTrace(row('10:00:00Z', '3.21', '') + '\n', 2.21, BENCH);
    assert.equal(a.line, 3.21);
    assert.equal(a.crossed, 1);
    assert.equal(a.samples, 1);
    const b = parseTrace(row('10:00:00Z', '3.2099', '') + '\n', 2.21, BENCH);
    assert.equal(b.crossed, 0);
    assert.deepEqual(b.crossings, []);
});
test('A2 foreign node entry crosses and is listed; bench pid / ppid / Bench.mjs entries do not', () => {
    const foreign = '999:998:50.0: /bin/node /tmp/other.js';
    const a = parseTrace(row('10:00:00Z', '1.0', foreign + ' ; ') + '\n', 2.21, BENCH);
    assert.equal(a.crossed, 1);
    assert.equal(a.crossings[0].at, '10:00:00Z');
    assert.equal(a.crossings[0].foreign.length, 1);
    assert.ok(a.crossings[0].foreign[0].includes('999:998'));
    const viaPpid = parseTrace(row('10:00:00Z', '1.0', '1234:' + BENCH + ':50.0: /bin/node y.js ; ') + '\n', 2.21, BENCH);
    assert.equal(viaPpid.crossed, 0);
    const viaPid = parseTrace(row('10:00:00Z', '1.0', BENCH + ':1:50.0: /bin/node y.js ; ') + '\n', 2.21, BENCH);
    assert.equal(viaPid.crossed, 0);
    const viaName = parseTrace(row('10:00:00Z', '1.0', '5:6:50.0: node /a/benchmark/Bench.mjs --cell ; ') + '\n', 2.21, BENCH);
    assert.equal(viaName.crossed, 0);
});
test('A2 fail closed: unparsed row, empty text, bad baseline, bad pid', () => {
    assert.throws(() => parseTrace(quiet('10:00:00Z') + '\nthis is not a row\n', 2.21, BENCH));
    assert.throws(() => parseTrace('', 2.21, BENCH));
    assert.throws(() => parseTrace('\n  \n', 2.21, BENCH));
    for (const b of [0, NaN, -1, Infinity]) assert.throws(() => parseTrace(quiet('10:00:00Z') + '\n', b, BENCH));
    for (const p of ['', 'abc', 21354]) assert.throws(() => parseTrace(quiet('10:00:00Z') + '\n', 2.21, p));
});

// ---- ASSERTION 3: validateTrace / buildTrace ----
test('A3 buildTrace output passes validateTrace; key order and values per SPEC', () => {
    const c = mkCrossed();
    assert.deepEqual(Object.keys(c), ['schema', 'commit', 'date', 'baseline', 'line', 'samples', 'crossed', 'peak',
        'crossings', 'cause', 'replicas', 'rule']);
    assert.equal(c.schema, 'lite-yggdrasil/trace/1');
    assert.equal(TRACE_SCHEMA, 'lite-yggdrasil/trace/1');
    assert.equal(c.commit, 'e9fcf9c');
    assert.equal(c.date, FAKE_RESULTS.meta.date);
    assert.equal(c.samples, 3);
    assert.equal(c.crossed, 1);
    assert.equal(c.cause, 'unattributed');
    assert.equal(c.rule, 'R-BA64');
    assert.deepEqual(c.replicas, REPL);
    assert.equal(validateTrace(c, FAKE_RESULTS), true);
    const k = mkClean();
    assert.equal(k.rule, 'R-BA53');
    assert.deepEqual(k.replicas, []);
    assert.equal(k.crossed, 0);
    assert.equal(validateTrace(k, FAKE_RESULTS), true);
});

const MUT = [
    ['extra key', 'zzextra', (t) => { t.zzextra = 1; }],
    ['missing key', 'cause', (t) => { delete t.cause; }],
    ['schema', 'schema', (t) => { t.schema = 'lite-yggdrasil/trace/2'; }],
    ['commit mismatch', 'commit', (t) => { t.commit = 'deadbee'; }],
    ['date mismatch', 'date', (t) => { t.date = '2020-01-01T00:00:00.000Z'; }],
    ['line mismatch', 'line', (t) => { t.line = 3.2; }],
    ['crossed > samples', 'crossed', (t) => { t.crossed = t.samples + 1; while (t.crossings.length < t.crossed) t.crossings.push(t.crossings[0]); }],
    ['crossings.length !== crossed', 'crossings', (t) => { t.crossings.push(t.crossings[0]); }],
    ['peak below a crossing', 'peak', (t) => { t.peak = { load1: 3.0, at: t.peak.at }; }],
    ['1 replica with crossed > 0', 'replicas', (t) => { t.replicas = ['#2 8e27490']; }],
    ['duplicate replicas', 'replicas', (t) => { t.replicas = ['#2 8e27490', '#2 8e27490']; }],
    ['wrong rule', 'rule', (t) => { t.rule = 'R-BA53'; }],
    ['crossing below the line with no foreign entry', 'crossings', (t) => { t.crossings[0] = { at: t.crossings[0].at, load1: 1.0, foreign: [] }; }],
    ['crossed 0 with peak at or above the line', 'crossed', (t) => { t.crossed = 0; t.crossings = []; t.replicas = []; t.rule = 'R-BA53'; }],
];
for (const [name, field, fn] of MUT) {
    test('A3 validateTrace throws naming the field: ' + name, () => {
        const t = structuredClone(mkCrossed());
        fn(t);
        assert.throws(() => validateTrace(t, FAKE_RESULTS), (e) => {
            assert.ok(e.message.startsWith('[trace] ' + field), 'message was: ' + e.message);
            return true;
        });
    });
}
test('A3 validateTrace: crossed 0 with a replica throws replicas; clean trace with wrong rule throws rule', () => {
    const t = structuredClone(mkClean());
    t.replicas = ['#2 8e27490'];
    assert.throws(() => validateTrace(t, FAKE_RESULTS), (e) => e.message.startsWith('[trace] replicas'));
    const u = structuredClone(mkClean());
    u.rule = 'R-BA64';
    assert.throws(() => validateTrace(u, FAKE_RESULTS), (e) => e.message.startsWith('[trace] rule'));
});
test('A3 traceNote text per SPEC', () => {
    assert.equal(traceNote(mkCrossed()),
        ', load trace (R-BA53): 1 of 3 samples crossed load1 < 3.21 (peak 3.67 at 22:01:00Z, unattributed); ' +
        'published on replication (R-BA64): runs #2 8e27490, #4 8d0113f');
    assert.equal(traceNote(mkClean()), ', load trace (R-BA53): 0 of 2 samples crossed load1 < 3.21');
});
test('A3 buildTrace cause option and validation on build', () => {
    const c = buildTrace(parseTrace(crossedText, 2.21, BENCH), FAKE_RESULTS, { cause: 'spotlight', replicas: REPL.slice() });
    assert.equal(c.cause, 'spotlight');
    assert.throws(() => buildTrace(parseTrace(crossedText, 2.21, BENCH), FAKE_RESULTS, { replicas: ['#2 8e27490'] }),
        (e) => e.message.startsWith('[trace] replicas'));
});

// ---- ASSERTION 4: Readme ----
const GOLDEN = ['bench-adopt/b48', 'bench-adopt/b48-ror2', 'b49/pub-held', 'b49/ror3', 'b50', 'b50/ror5'];
const BEFORE = EV + 'b54/before/benchmark/Readme.mjs';
const outcome = (fn) => { try { return { ok: fn() }; } catch (e) { return { error: e.message }; } };
for (const g of GOLDEN) {
    test('A4 byte identity without a trace: ' + g, async (t) => {
        if (!existsSync(EV + g + '/results.json')) return t.skip('.handoff evidence absent');
        const r = JSON.parse(readFileSync(EV + g + '/results.json', 'utf8'));
        const a = outcome(() => R.renderBenchmarksSection(r, VERSION));
        const b = outcome(() => R.renderBenchmarksSection(r, VERSION, null));
        assert.deepEqual(a, b);
        if (!existsSync(BEFORE)) return;
        const Before = await import(pathToFileURL(BEFORE).href);
        const c = outcome(() => Before.renderBenchmarksSection(r, VERSION));
        assert.deepEqual(a, c);
    });
}
const RESULTS_PATH = ROOT + 'benchmark/results.json';
const haveResults = existsSync(RESULTS_PATH);
const live = haveResults ? JSON.parse(readFileSync(RESULTS_PATH, 'utf8')) : null;
const handTrace = () => ({
    schema: 'lite-yggdrasil/trace/1', commit: live.meta.commit, date: live.meta.date, baseline: 2.21, line: 3.21,
    samples: 94, crossed: 1, peak: { load1: 3.67, at: '23:04:17Z' },
    crossings: [{ at: '23:04:17Z', load1: 3.67, foreign: [] }],
    cause: 'unattributed', replicas: ['#2 8e27490', '#4 8d0113f'], rule: 'R-BA64',
});
const NOTE = ', load trace (R-BA53): 1 of 94 samples crossed load1 < 3.21 (peak 3.67 at 23:04:17Z, unattributed); ' +
    'published on replication (R-BA64): runs #2 8e27490, #4 8d0113f';

test('A4 with a trace: provenance ends with traceNote + ".", lead reads load-trace wording, no PENDING', (t) => {
    if (!haveResults || live.status !== 'MEASURED' || live.meta.hostState !== 'QUIET') return t.skip('benchmark/results.json absent or not measured');
    const tr = handTrace();
    assert.equal(traceNote(tr), NOTE);
    const plain = R.renderBenchmarksSection(live, VERSION);
    const s = R.renderBenchmarksSection(live, VERSION, tr);
    assert.ok(!s.includes('PENDING'));
    assert.ok(s.includes('(QUIET host at start; load trace below)'));
    assert.ok(!plain.includes('(QUIET host at start; load trace below)'));
    assert.ok(s.split('\n').some((l) => l.endsWith(NOTE + '.')));
    assert.ok(!plain.includes('load trace (R-BA53)'));
});
test('A4 trace with commit deadbee throws; trace beside a non-measured results throws', (t) => {
    if (!haveResults || live.status !== 'MEASURED' || live.meta.hostState !== 'QUIET') return t.skip('benchmark/results.json absent or not measured');
    const bad = handTrace();
    bad.commit = 'deadbee';
    assert.throws(() => R.renderBenchmarksSection(live, VERSION, bad), (e) => e.message.startsWith('[trace] commit'));
    assert.throws(() => R.renderBenchmarksSection(null, VERSION, handTrace()),
        (e) => e.message === '[readme] trace.json needs a measured results.json');
    // a PENDING or PRELIMINARY results.json beside a trace must throw
    for (const [k, v] of [['status', 'PENDING'], ['hostState', 'PRELIMINARY']]) {
        const r = structuredClone(live);
        if (k === 'status') r.status = v; else r.meta.hostState = v;
        assert.throws(() => R.renderBenchmarksSection(r, VERSION, handTrace()),
            (e) => e.message === '[readme] trace.json needs a measured results.json');
    }
});
test('A4 readTraceFile: absent -> null; a non-object trace.json throws; an object parses', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ygg-trace-'));
    try {
        assert.equal(R.readTraceFile(join(dir, 'absent.json')), null);
        for (const body of ['null', '[]', '5', '"x"', 'true']) {
            const f = join(dir, 'trace.json');
            writeFileSync(f, body + '\n');
            assert.throws(() => R.readTraceFile(f), (e) => e.message === '[readme] trace.json must be an object', body);
        }
        const f = join(dir, 'ok.json');
        writeFileSync(f, '{"schema":"x"}\n');
        assert.deepEqual(R.readTraceFile(f), { schema: 'x' });
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
});

// ---- ASSERTION 5: committed trace.json ----
const TRACE_PATH = ROOT + 'benchmark/trace.json';
test('A5 committed benchmark/trace.json validates against results.json; Readme --check exits 0', (t) => {
    if (!existsSync(TRACE_PATH) || !haveResults) return t.skip('benchmark/trace.json or results.json absent');
    const tr = JSON.parse(readFileSync(TRACE_PATH, 'utf8'));
    assert.equal(validateTrace(tr, live), true);
    const r = spawnSync('node', [ROOT + 'benchmark/Readme.mjs', '--check'], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
});
