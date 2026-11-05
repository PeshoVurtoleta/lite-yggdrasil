// test/meter-gate.mjs -- the ONE meter gate of the 4 alloc children (RULING Y-CI-6a, burst 44; .handoff/PLAN-ci-fix.md
// TASK 1). Every B/op lane row and every per-call / per-op must-fail control row of EditorFeed / Rivals / ScenarioFeed /
// Scenarios goes through meter(v).ok(cond, msg):
// - node >= 24, or a version string this module cannot parse: ASSERTED (assert.ok), exactly as before (fail closed);
// - node < 24 (a parsed integer major below 24): REPORTED -- counted, a false row kept in `outside`, never asserted;
//   report() prints `# REPORTED <METER_REASON>` once per meter with the counts and the first 8 outside rows.
// Every other row of those children (semi-space flags, gc major 0, retention, coverage, lane counts, names, ops, warm
// calls, field presence) stays a plain assert on every version: it never goes through this module.
// No environment override. Test harness only, never shipped. ASCII only. MIT (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>

import assert from 'node:assert/strict';

export const METER_REASON = 'alloc meter uncalibrated on node < 24 (census b43: rival edit 316-365 B per call, later lanes -55 / -880, a must-fail control -648)';
export const METER_MIN_MAJOR = 24;
const OUTSIDE_SHOWN = 8;
const VERSION_RE = /^(\d+)\.\d+\.\d+(-\S*)?$/;

// the integer major of a process.versions.node string; NaN for anything else (a number, 'v22.23.4', '22', '', undefined)
export function nodeMajor(v) {
    if (typeof v !== 'string') return NaN;
    const m = VERSION_RE.exec(v);
    return m === null ? NaN : Number(m[1]);
}

// true = the meter rows are asserted. Only a parsed integer major below 24 turns them off (fail closed).
export function meterGated(v) {
    const maj = nodeMajor(v);
    return !(Number.isInteger(maj) && maj < METER_MIN_MAJOR);
}

// meter(v, log) -> { gated, ok(cond, msg), report() }; log receives each printed line (default console.log)
export function meter(v, log = console.log) {
    const gated = meterGated(v);
    let asserted = 0;
    let reported = 0;
    let done = false;
    const outside = [];
    return {
        gated,
        ok(cond, msg) {
            if (done) throw new Error('meter: ok() after report()');
            if (gated) { assert.ok(cond, msg); asserted++; return; }
            reported++;
            if (!cond) outside.push(String(msg));
        },
        report() {
            if (done) throw new Error('meter: report() called twice');
            done = true;
            if (!gated) {
                log('# REPORTED ' + METER_REASON + ' [node ' + String(v) + ': ' + reported + ' meter rows reported, ' +
                    outside.length + ' outside the node >= 24 bounds]');
                for (let i = 0; i < outside.length && i < OUTSIDE_SHOWN; i++) log('#   outside ' + outside[i]);
                if (outside.length > OUTSIDE_SHOWN) log('#   ... ' + (outside.length - OUTSIDE_SHOWN) + ' more outside rows');
            }
            return { gated, asserted, reported, outside: outside.slice() };
        },
    };
}
