// test/MeterGate.test.mjs -- test/meter-gate.mjs (RULING Y-CI-6a, burst 44; .handoff/PLAN-ci-fix.md TASK 6 / A3).
// The predicate is written out as a table (no regex shared with the module); the reason string is the ruling's
// quoted text, typed here a second time so a drift in either copy fails.
// Deterministic, no child process. Test harness only, never shipped. ASCII only.
// MIT (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { METER_REASON, nodeMajor, meterGated, meter } from './meter-gate.mjs';

// Y-CI-6a, verbatim (census.md, burst 44 re-read)
const RULED_REASON = 'alloc meter uncalibrated on node < 24 (census b43: rival edit 316-365 B per call, later lanes -55 / -880, a must-fail control -648)';

test('meterGated: 22.23.4 / 23.11.1 -> false; 24.0.0 / 26.8.2 / 26.13.0 / 27.0.0-alpha.0.0.0 -> true; unparseable -> true (fail closed)', () => {
    const rows = [
        ['22.23.4', false, 22], ['23.11.1', false, 23], ['0.12.18', false, 0], ['18.20.8', false, 18],
        ['24.0.0', true, 24], ['26.8.2', true, 26], ['26.13.0', true, 26], ['27.0.0-alpha.0.0.0', true, 27], ['100.0.0', true, 100],
        ['', true, NaN], ['v22.23.4', true, NaN], ['22', true, NaN], ['22.23', true, NaN], ['x.y.z', true, NaN],
        [' 22.23.4', true, NaN], ['22.23.4 ', true, NaN], ['22.23.4-', false, 22],
        [undefined, true, NaN], [null, true, NaN], [22, true, NaN], [22.5, true, NaN], [{}, true, NaN],
    ];
    const bad = [];
    for (const [v, gated, maj] of rows) {
        if (meterGated(v) !== gated) bad.push(JSON.stringify(v) + ' gated ' + meterGated(v) + ' want ' + gated);
        if (!Object.is(nodeMajor(v), maj)) bad.push(JSON.stringify(v) + ' major ' + nodeMajor(v) + ' want ' + maj);
    }
    assert.deepEqual(bad, []);
    // this process (the version the suite runs on) parses
    assert.ok(Number.isInteger(nodeMajor(process.versions.node)), 'process.versions.node ' + process.versions.node + ' must parse');
});

test('meter.ok(): gated asserts + counts; ungated never throws, counts every row, keeps the false ones in order', () => {
    const g = meter('26.8.2', () => {});
    assert.equal(g.gated, true);
    g.ok(true, 'a'); g.ok(1 < 2, 'b');
    assert.throws(() => g.ok(false, 'lane X perCall 316'), (e) => e instanceof assert.AssertionError && e.message === 'lane X perCall 316');
    assert.throws(() => g.ok(null, 'null reading'), assert.AssertionError);
    assert.deepEqual(g.report(), { gated: true, asserted: 2, reported: 0, outside: [] });

    const u = meter('22.23.4', () => {});
    assert.equal(u.gated, false);
    u.ok(true, 'in'); u.ok(false, 'first'); u.ok(null, 'second'); u.ok(0, 'third'); u.ok(1, 'in2');
    assert.deepEqual(u.report(), { gated: false, asserted: 0, reported: 5, outside: ['first', 'second', 'third'] });

    // unparseable version: gated (fail closed)
    const x = meter('v22.23.4', () => {});
    assert.equal(x.gated, true);
    assert.throws(() => x.ok(false, 'fails'), assert.AssertionError);
});

test('meter.report(): once only; the REPORTED line carries the Y-CI-6a reason byte-exact + counts + the first 8 outside rows; silent when gated', () => {
    assert.equal(METER_REASON, RULED_REASON);
    assert.deepEqual([...Buffer.from(METER_REASON, 'utf8')], [...Buffer.from(RULED_REASON, 'latin1')], 'ASCII only, byte-identical');

    const lines = [];
    const u = meter('22.23.4', (s) => lines.push(s));
    for (let i = 0; i < 12; i++) u.ok(false, 'row' + i);
    u.ok(true, 'in');
    const rep = u.report();
    assert.equal(rep.reported, 13);
    assert.equal(rep.outside.length, 12);
    assert.equal(lines[0], '# REPORTED ' + RULED_REASON + ' [node 22.23.4: 13 meter rows reported, 12 outside the node >= 24 bounds]');
    assert.equal(lines.filter((l) => l.startsWith('# REPORTED ')).length, 1, 'one REPORTED line');
    assert.deepEqual(lines.slice(1, 9), [0, 1, 2, 3, 4, 5, 6, 7].map((i) => '#   outside row' + i));
    assert.deepEqual(lines.slice(9), ['#   ... 4 more outside rows']);
    assert.throws(() => u.report(), /report\(\) called twice/);
    assert.throws(() => u.ok(true, 'late'), /ok\(\) after report\(\)/);
    assert.equal(lines.length, 10, 'the failed second report() printed nothing');

    const quiet = [];
    const g = meter('26.8.2', (s) => quiet.push(s));
    g.ok(true, 'a');
    g.report();
    assert.deepEqual(quiet, [], 'a gated meter prints nothing');
    assert.throws(() => g.report(), /report\(\) called twice/);
});
