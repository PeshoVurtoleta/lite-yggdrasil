/**
 * @zakkster/lite-yggdrasil -- S2 / S2a / S2b ("editor") scenario gate (node:test), Bench-ADOPT g2b-2b TASK 7 (B3).
 *
 * Written FROM the PLAN ASSERTIONS A4 + A5 (.handoff/PLAN-bench-adopt-g2b2b.md) and the maintainer rulings
 * R-BA17 (S2 mix, line law), R-BA19 (seeded block order), R-BA20 (event = records), R-BA21 (SPLIT / APPEND),
 * R-BA22 (masked blocks), R-BA23 Enter, R-BA24 join + clamp, R-BA25 mid edit, R-BA26 cut position, R-BA27 caret.
 * An INDEPENDENT oracle: it never imports the builder's row model; every replay is test/oracle.mjs with THREE
 * Oracle views (main, clip, tail) and every census is counted here from the public script records.
 *
 * Expected values come from the ruling text or hand arithmetic:
 *   per 1,000-event S2 block: 600 char edits + 150 mid edits (-> reweight 750 events), 50 Enter + 50 backspace
 *   (edit 100), 25 cut + 25 paste (bulk 50), 50 indexAtSum + 50 sumBefore (seek 100); 20 blocks ->
 *   seek 2,000 / reweight 15,000 / edit 2,000 / bulk 1,000 / blend 20,000 events. S2a block (800 events): 600
 *   char + 50 Enter + 50 backspace + 100 seeks -> 2,000 / 12,000 / 2,000 / 16,000. S2b block (50 events) -> 1,000.
 *   Records: char edit 2, Enter 3, backspace 3, cut 3, paste 3, seek 1, mid 2k (k uniform [10, 50]).
 *   edit ops = 100 x 3 x 20 = 6,000; bulk ops = 50 x 3 x 20 = 3,000; seek ops 2,000; S2a reweight ops
 *   600 x 2 x 20 = 24,000; S2 reweight ops = 24,000 + 2 x sum(k) over 3,000 mid edits: mean k = 30 (hand: (10 + 50) / 2),
 *   var(k) = (41^2 - 1) / 12 = 140, sd(sum k) = sqrt(3000 x 140) = 648 -> mean ops 204,000, sd 1,296 -> the census
 *   band [197,500, 210,500] is +-5 sd (inside the ruled [84,000, 324,000]).
 *   Cut length L = max(2, floor(U x min(1, n / 100000))), U integer uniform [2000, 10000]: for n < 100000 the extremes
 *   are floor(2000 n / 1e5) and floor(10000 n / 1e5) (n 1024: 20 and 102; n 4096: 81 and 409); n >= 100000: 2000 / 10000.
 *   Fill line law: d0 = 1 p 0.10; uniform [2, 81] p 0.85; uniform [82, 255] p 0.05; d1 = d0 (p 0.90) else d0 +
 *   uniform [1, d0] capped 255 -> P(d1 > d0) = 0.10 (minus the d0 = 255 cap, p ~ 0.0003).
 * Transient note: a pair writes d0 then d1, so d0 > d1 can exist BETWEEN the two writes of one pair; the invariant
 * 1 <= d0 <= d1 <= 255 is checked after every record that is not the first half of a pair (and every written value
 * is checked for [1, 255] after every record).
 * Deterministic: pinned seeds, no timing in any assertion. Test harness only, never shipped.
 * ASCII only. MIT (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { Oracle } from './oracle.mjs';
import {
    SCENARIOS, OP, REC, PHASE_CLASS, selectScenario, runScenario, scenarioEvents, BLOCK_EVENTS, STREAM_EVENTS,
} from '../benchmark/Scenarios.mjs';
import { DEFAULT_SEED, prng } from '../benchmark/Harness.mjs';

const PKG = fileURLToPath(new URL('..', import.meta.url));
const SEED = DEFAULT_SEED;
const IDS = ['S2', 'S2a', 'S2b'];
const PHASE_NAMES = {
    S2: ['seek', 'reweight', 'edit', 'bulk', 'blend'],
    S2a: ['seek', 'reweight', 'edit', 'blend'],
    S2b: ['bulk'],
};
// full-stream events per phase (R-BA20 / R-BA22), hand-computed in the header; --quick is exactly /10
const EVENTS = {
    S2: { seek: 2000, reweight: 15000, edit: 2000, bulk: 1000, blend: 20000 },
    S2a: { seek: 2000, reweight: 12000, edit: 2000, blend: 16000 },
    S2b: { bulk: 1000 },
};
const sc = (id) => selectScenario(id);

// ---- independent helpers (nothing below calls the runner or the builder's model) -------------------------------

// FNV-1a over int32 words, 32-bit exact (the published algorithm).
function fold(h, x) {
    h = (h ^ (x | 0)) >>> 0;
    return Math.imul(h, 16777619) >>> 0;
}

function fnv(fill, script) {
    let h = 0x811c9dc5;
    for (const arr of [fill, script]) for (let j = 0; j < arr.length; j++) h = fold(h, arr[j]);
    return h >>> 0;
}

// The endState digest as documented on phaseEndState: fold length(), then for each dim sumBefore at i = 0, step, ..., n.
function endStateOf(o, n, dims) {
    let x = fold(0x811c9dc5, o.length);
    const step = Math.max(1, n >> 6);
    for (let d = 0; d < dims; d++) {
        for (let i = 0; i < n; i += step) x = fold(x, o.sumBefore(d, i));
        x = fold(x, o.sumBefore(d, n));
    }
    return x >>> 0;
}

const mkViews = () => [new Oracle(2), new Oracle(2), new Oracle(2)];

function fillOracle(o, fill, n) {
    for (let i = 0; i < n; i++) o.insertAt(i, i, fill[2 * i], fill[2 * i + 1]);
}

function oracleFilled(fill, n) {
    const vs = mkViews();
    fillOracle(vs[0], fill, n);
    return vs;
}

// One record on the Oracle views (SPLIT [7, i, v, 0] = main.splitAt(i, views[v]); APPEND [8, v, 0, 0] = main.append(views[v])).
function oracleStep(vs, script, k, acc) {
    const o = vs[0];
    const a = script[k + 1];
    const b = script[k + 2];
    const c = script[k + 3];
    switch (script[k]) {
        case OP.INSERT: o.insertAt(a, a, b, c); return acc;
        case OP.REMOVE: o.removeAt(a); return acc;
        case OP.SET: o.setMeasure(a, b, c); return acc;
        case OP.SEEK: return (acc + o.indexAtSum(a, b)) | 0;
        case OP.SUM: return (acc + o.sumBefore(a, b)) | 0;
        case OP.SPLIT: o.splitAt(a, vs[b]); return acc;
        case OP.APPEND: o.append(vs[a]); return acc;
        default: throw new Error('test: unknown opcode ' + script[k]);
    }
}

function oracleRun(vs, script) {
    let acc = 0;
    for (let k = 0; k < script.length; k += REC) acc = oracleStep(vs, script, k, acc);
    return acc;
}

// Must-fail mutant: every paste's two appends swapped (APPEND clip, APPEND tail -> APPEND tail, APPEND clip).
// A cut never contains APPEND(1), so APPEND(1) followed by APPEND(2) identifies exactly the paste pair.
function swapPaste(script) {
    const out = Int32Array.from(script);
    for (let k = 0; k + REC < out.length; k += REC) {
        if (out[k] === OP.APPEND && out[k + 1] === 1 && out[k + REC] === OP.APPEND && out[k + REC + 1] === 2) {
            out[k + 1] = 2;
            out[k + REC + 1] = 1;
        }
    }
    return out;
}

const buildMemo = new Map();
function build(id, n, events) {
    const key = id + '/' + n + '/' + String(events);
    if (!buildMemo.has(key)) buildMemo.set(key, sc(id).build(null, n, SEED, events));
    return buildMemo.get(key);
}

const wantMemo = new Map();
// Per phase: oracle checksum, endState (+ lengths), FNV traceHash, each replayed on a fresh oracle fill.
function wants(id, n, swap) {
    const key = id + '/' + n + '/' + String(swap);
    if (wantMemo.has(key)) return wantMemo.get(key);
    const built = build(id, n);
    const out = new Map();
    for (const p of built.phases) {
        const vs = oracleFilled(built.fill, n);
        const checksum = oracleRun(vs, swap ? swapPaste(p.script) : p.script);
        out.set(p.name, {
            checksum, endState: endStateOf(vs[0], n, 2), lens: [vs[0].length, vs[1].length, vs[2].length],
            traceHash: fnv(built.fill, p.script),
        });
    }
    wantMemo.set(key, out);
    return out;
}

// d1 law (R-BA17): d1 = d0, or d0 + uniform [1, d0] capped at 255.
const d1Ok = (d0, d1) => d1 === d0 || (d1 > d0 && d1 <= Math.min(255, 2 * d0));

// ---- registry ---------------------------------------------------------------------------------------------------

describe('S2 registry (R-BA17 / R-BA22): shape of the three entries', () => {
    test('S2, S2a, S2b are registered after S1b and before S7: dims 2, views 3 / 1 / 3, the five S7 adapters, the ruled sizes, phases in order', () => {
        const ids = SCENARIOS.map((s) => s.id);
        assert.ok(ids.indexOf('S1b') >= 0 && ids.indexOf('S2') > ids.indexOf('S1b'));
        assert.ok(ids.indexOf('S2a') > ids.indexOf('S2') && ids.indexOf('S2b') > ids.indexOf('S2a') && ids.indexOf('S2b') < ids.indexOf('S7'));
        // R-BA17: sizes 2^10 .. 2^17 and 100000 (compared as a sorted set: the listing order is not ruled)
        const sizes = [1024, 2048, 4096, 8192, 16384, 32768, 65536, 100000, 131072];
        const views = { S2: 3, S2a: 1, S2b: 3 };
        for (const id of IDS) {
            const s = sc(id);
            assert.equal(s.dims, 2, id + ' dims');
            assert.equal(s.views, views[id], id + ' views');
            assert.deepEqual([...s.sizes].sort((x, y) => x - y), sizes, id + ' sizes');
            assert.equal(new Set(s.sizes).size, s.sizes.length, id + ' sizes unique');
            assert.deepEqual([...s.adapters], [...sc('S7').adapters], id + ' adapters');
            assert.equal(s.adapters.length, 5);
            assert.deepEqual(build(id, 1024, BLOCK_EVENTS).phases.map((p) => p.name), PHASE_NAMES[id], id + ' phases');
        }
    });
    test('S2, S2a, S2b are different, deterministic streams (distinct salts; same seed -> same bytes)', () => {
        const a = sc('S2').build(null, 1024, SEED, BLOCK_EVENTS);
        const a2 = sc('S2').build(null, 1024, SEED, BLOCK_EVENTS);
        const b = sc('S2a').build(null, 1024, SEED, BLOCK_EVENTS);
        const c = sc('S2b').build(null, 1024, SEED, BLOCK_EVENTS);
        const d = sc('S2').build(null, 1024, SEED + 1, BLOCK_EVENTS);
        const last = (x) => x.phases[x.phases.length - 1].script;
        assert.deepEqual(a.fill, a2.fill);
        assert.deepEqual(last(a), last(a2));
        assert.notDeepEqual(a.fill, b.fill);
        assert.notDeepEqual(a.fill, c.fill);
        assert.notDeepEqual(last(a), last(b));
        assert.notDeepEqual(last(a), last(d), 'a different seed gives a different stream');
    });
});

// ---- A4: events / ops / phase structure ---------------------------------------------------------------------------

describe('A4: events and ops per phase (full stream and --quick), capacity n + 1', () => {
    test('A4: events per phase = 2,000 / 15,000 / 2,000 / 1,000 / 20,000 (S2), 2,000 / 12,000 / 2,000 / 16,000 (S2a), 1,000 (S2b); --quick = /10', () => {
        assert.equal(STREAM_EVENTS, 20000);
        assert.equal(scenarioEvents(true), 2000);
        assert.equal(BLOCK_EVENTS, 1000);
        for (const id of IDS) {
            for (const [ev, div] of [[undefined, 1], [scenarioEvents(true), 10]]) {
                const built = sc(id).build(null, 1024, SEED, ev);
                assert.equal(built.capacity, 1025, id + ' capacity n + 1');
                assert.deepEqual(built.phases.map((p) => p.name), PHASE_NAMES[id]);
                for (const p of built.phases) assert.equal(p.events, EVENTS[id][p.name] / div, id + ' ' + p.name + ' events /' + div);
            }
        }
    });

    test('A4: ops per phase: edit 6,000, bulk 3,000, seek 2,000, S2a reweight 24,000, S2 reweight in the ruled band AND in the +-5 sd census band (--quick /10)', () => {
        for (const [ev, div] of [[undefined, 1], [scenarioEvents(true), 10]]) {
            const s2 = sc('S2').build(null, 1024, SEED, ev);
            const ops = (b, name) => b.phases.find((p) => p.name === name).script.length / REC;
            assert.equal(ops(s2, 'edit'), 6000 / div);
            assert.equal(ops(s2, 'bulk'), 3000 / div);
            assert.equal(ops(s2, 'seek'), 2000 / div);
            const rw = ops(s2, 'reweight');
            if (div === 1) assert.ok(rw >= 84000 && rw <= 324000, 'ruled band, ops ' + rw);
            // 24,000 char records + 2 x sum(k); mean k 30 (header): full 204,000 +- 6,480; quick 20,400 +- 5 x 410
            const mean = 204000 / div;
            const half = div === 1 ? 6480 : 2050;
            assert.ok(rw >= mean - half && rw <= mean + half, 'S2 reweight ops ' + rw + ' not in ' + mean + ' +- ' + half);
            assert.equal(rw % 2, 0, 'reweight records come in pairs');
            // blend = every record of every class once
            assert.equal(ops(s2, 'blend'), rw + 6000 / div + 3000 / div + 2000 / div);
            const s2a = sc('S2a').build(null, 1024, SEED, ev);
            assert.equal(ops(s2a, 'reweight'), 24000 / div);
            assert.equal(ops(s2a, 'edit'), 6000 / div);
            assert.equal(ops(s2a, 'seek'), 2000 / div);
            assert.equal(ops(s2a, 'blend'), (24000 + 6000 + 2000) / div);
            const s2b = sc('S2b').build(null, 1024, SEED, ev);
            assert.equal(ops(s2b, 'bulk'), 3000 / div);
        }
    });

    test('A4: phases are the event-class subsequences of the blend (S2, S2a: seek, bulk by opcode; edit = the SET,SET,INSERT|REMOVE triples; reweight = the rest); S2a has no SPLIT / APPEND; S2b is bulk only; ends at length n, clip and tail 0', () => {
        for (const id of ['S2', 'S2a']) {
            const built = build(id, 1024);
            const blend = built.phases[built.phases.length - 1].script;
            assert.equal(built.phases[built.phases.length - 1].name, 'blend');
            // R-BA20: Enter / backspace (2 SET + INSERT / REMOVE) are EDIT events, so the SET opcode is not a class by itself:
            // seek = blend records 4 / 5, bulk = records 7 / 8, edit = the (SET, SET, INSERT|REMOVE) triples, reweight = the rest.
            const triple = new Uint8Array(blend.length / REC);
            for (let r = 2; r < triple.length; r++) {
                const op = blend[r * REC];
                if (op === OP.INSERT || op === OP.REMOVE) triple[r] = triple[r - 1] = triple[r - 2] = 1;
            }
            const exp = { seek: [], bulk: [], edit: [], reweight: [] };
            for (let r = 0; r < triple.length; r++) {
                const rc = [...blend.subarray(r * REC, (r + 1) * REC)];
                const op = rc[0];
                const cls = op === OP.SEEK || op === OP.SUM ? 'seek' : op === OP.SPLIT || op === OP.APPEND ? 'bulk' : triple[r] ? 'edit' : 'reweight';
                exp[cls].push(rc.join());
            }
            const key = (script) => { const out = []; for (let k = 0; k < script.length; k += REC) out.push(script[k] + ',' + script[k + 1] + ',' + script[k + 2] + ',' + script[k + 3]); return out; };
            for (const p of built.phases.slice(0, -1)) {
                const got = key(p.script);
                assert.equal(got.length, exp[p.name].length, id + ' ' + p.name + ' record count');
                for (let q = 0; q < got.length; q++) if (got[q] !== exp[p.name][q]) assert.fail(id + ' ' + p.name + ' record ' + q + ': ' + got[q] + ' != blend-derived ' + exp[p.name][q]);
            }
            assert.ok(PHASE_CLASS[OP.SEEK] === 'seek' && PHASE_CLASS[OP.SPLIT] === 'bulk' && PHASE_CLASS[OP.APPEND] === 'bulk');
            if (id === 'S2a') for (let k = 0; k < blend.length; k += REC) assert.ok(blend[k] !== OP.SPLIT && blend[k] !== OP.APPEND, 'S2a record ' + k / REC);
        }
        const b = build('S2b', 1024);
        for (let k = 0; k < b.phases[0].script.length; k += REC) assert.ok(b.phases[0].script[k] === OP.SPLIT || b.phases[0].script[k] === OP.APPEND);
        for (const id of IDS) {
            for (const n of [1024, 4096]) {
                const w = wants(id, n, false);
                for (const [name, v] of w) assert.deepEqual(v.lens, [n, 0, 0], id + ' @ ' + n + ' ' + name + ' final lengths [main, clip, tail]');
            }
        }
    });
});

// ---- A4: the bulk (cut / paste) unit, both views ------------------------------------------------------------------

// exec false: pattern + range checks only (no oracle: Oracle.insertAt re-sums the total, so a 131072 fill is O(n^2))
function bulkCheck(n, script, fill, withEntities, exec = true) {
    const pat = [];
    const st = [];
    const stats = { units: 0, L: [], i: [], j: [], iR: [], jR: [] };
    const lo = Math.max(2, Math.floor(2000 * Math.min(1, n / 100000)));
    const hi = Math.floor(10000 * Math.min(1, n / 100000));
    const vs = exec ? oracleFilled(fill, n) : null;
    let model = null;
    if (withEntities) model = Array.from({ length: n }, (_, k) => k);
    if ((script.length / REC) % 6 !== 0) pat.push('bulk records not a multiple of 6');
    const err = (list, m) => { if (list.length < 12) list.push(m); };
    for (let g = 0; g * 6 * REC < script.length; g++) {
        const at = (t) => (g * 6 + t) * REC;
        const r = (t, f) => script[at(t) + f];
        const ops = [7, 7, 8, 7, 8, 8];
        for (let t = 0; t < 6; t++) if (r(t, 0) !== ops[t]) err(pat, 'unit ' + g + ' rec ' + t + ' op ' + r(t, 0));
        const L = r(0, 1) - r(1, 1);
        const i = r(1, 1);
        const j = r(3, 1);
        // cut = SPLIT(i + L, tail), SPLIT(i, clip), APPEND(tail); paste = SPLIT(j, tail), APPEND(clip), APPEND(tail)
        if (r(0, 2) !== 2 || r(1, 2) !== 1 || r(2, 1) !== 2) err(pat, 'unit ' + g + ' cut views');
        if (r(3, 2) !== 2 || r(4, 1) !== 1 || r(5, 1) !== 2) err(pat, 'unit ' + g + ' paste views');
        if (r(0, 3) !== 0 || r(1, 3) !== 0 || r(2, 2) !== 0 || r(2, 3) !== 0 || r(3, 3) !== 0 ||
            r(4, 2) !== 0 || r(4, 3) !== 0 || r(5, 2) !== 0 || r(5, 3) !== 0) err(pat, 'unit ' + g + ' pad slots');
        if (!(L >= lo && L <= hi)) err(pat, 'unit ' + g + ' L ' + L + ' not in [' + lo + ', ' + hi + ']');
        if (!(i >= 0 && i <= n - L)) err(pat, 'unit ' + g + ' cut start ' + i);
        if (!(j >= 0 && j <= n - L)) err(pat, 'unit ' + g + ' paste at ' + j);
        stats.units++;
        stats.L.push(L);
        stats.i.push(i);
        stats.j.push(j);
        stats.iR.push(i / (n - L));
        stats.jR.push(j / (n - L));
        // exact view lengths [main, clip, tail] after each of the six records
        const want = [[i + L, 0, n - i - L], [i, L, n - i - L], [n - L, L, 0], [j, L, n - L - j], [j + L, 0, n - L - j], [n, 0, 0]];
        let acc = 0;
        for (let t = 0; exec && t < 6; t++) {
            try { acc = oracleStep(vs, script, at(t), acc); } catch (e) { err(st, 'unit ' + g + ' rec ' + t + ' threw ' + e.message); break; }
            const got = [vs[0].length, vs[1].length, vs[2].length];
            if (got.join() !== want[t].join()) { err(st, 'unit ' + g + ' rec ' + t + ' lengths ' + got + ' want ' + want[t]); break; }
        }
        if (exec && withEntities) {
            const cut = model.slice(i, i + L);
            const rem = model.slice(0, i).concat(model.slice(i + L));
            model = rem.slice(0, j).concat(cut, rem.slice(j));
            const got = vs[0].dump().entities;
            let same = got.length === model.length;
            for (let q = 0; same && q < got.length; q++) if (got[q] !== model[q]) same = false;
            if (!same) err(st, 'unit ' + g + ' row order after the paste differs from the splice model');
        }
    }
    return { pat, st, stats };
}

describe('A4: the cut / paste unit on all three views (R-BA21, R-BA26)', () => {
    for (const [id, n] of [['S2b', 1024], ['S2b', 4096], ['S2', 1024], ['S2', 4096]]) {
        test('A4: ' + id + ' @ ' + n + ' bulk phase: 6-record units, exact view lengths after every record (clip AND tail), row order = splice model, L / i / j law', () => {
            const built = build(id, n);
            const bulk = built.phases.find((p) => p.name === 'bulk').script;
            const c = bulkCheck(n, bulk, built.fill, true);
            assert.deepEqual(c.pat, [], 'pattern violations');
            assert.deepEqual(c.st, [], 'state violations');
            // 1,000 bulk events = 500 cuts + 500 pastes = 500 units of 6 records = 3,000 records
            assert.equal(c.stats.units, 500, 'units');
        });
    }

    test('A4: S2b cut / paste statistics at n 4096 and 131072: L, cut start i and paste row j cover their ruled ranges and are uniform (coverage floors)', () => {
        for (const n of [4096, 131072]) {
            const built = build('S2b', n);
            const bulk = built.phases[0].script;
            const c = bulkCheck(n, bulk, built.fill, false, n <= 4096);
            assert.deepEqual(c.pat, [], n + ' pattern');
            assert.deepEqual(c.st, [], n + ' state');
            const s = c.stats;
            assert.equal(s.units, 500, n + ' units');
            const f = Math.min(1, n / 100000);
            const lo = Math.max(2, Math.floor(2000 * f));
            const hi = Math.floor(10000 * f);
            const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
            // E[floor(U f)] ~ 6000 f - 0.5; sd(U) = 2309, sd of the mean of 500 = 103 -> +-5 sd = 516 f
            assert.ok(Math.abs(mean(s.L) - (6000 * f - 0.5)) <= 5 * 103.3 * f + 1, n + ' mean L ' + mean(s.L));
            assert.ok(Math.min(...s.L) <= lo + 0.03 * (hi - lo), n + ' min L ' + Math.min(...s.L));
            assert.ok(Math.max(...s.L) >= hi - 0.03 * (hi - lo), n + ' max L ' + Math.max(...s.L));
            for (const [name, r] of [['cut start i', s.iR], ['paste row j', s.jR]]) {
                // uniform [0, 1]: mean 0.5, sd of the mean 0.2887 / sqrt(500) = 0.0129 -> +-0.065; both tails reached
                assert.ok(Math.abs(mean(r) - 0.5) <= 0.065, n + ' ' + name + ' mean ' + mean(r));
                assert.ok(Math.min(...r) < 0.03 && Math.max(...r) > 0.97, n + ' ' + name + ' range [' + Math.min(...r) + ', ' + Math.max(...r) + ']');
            }
        }
    });

    test('A4 must-fail: swapping each paste\'s two appends changes >= 1 endState (oracle replay), and every mutant row is caught on BOTH views', () => {
        let changed = 0;
        for (const id of ['S2', 'S2b']) {
            for (const n of [1024, 4096]) {
                const base = wants(id, n, false);
                const mut = wants(id, n, true);
                for (const name of ['bulk', 'blend']) {
                    if (!base.has(name)) continue;
                    if (mut.get(name).endState !== base.get(name).endState) changed++;
                }
            }
        }
        assert.ok(changed >= 1, 'the swapped-append mutant survived every endState');
        // mutant rows against the exact view-length / splice-model check: each of the three appends, on the clip side and the tail side
        const built = build('S2b', 1024);
        const bulk = built.phases[0].script;
        const mutate = (rec, field, value) => { const m = Int32Array.from(bulk); m[rec * REC + field] = value; return m; };
        const rows = [
            ['swap the paste appends', swapPaste(bulk)],
            ['paste APPEND(clip) -> APPEND(tail): clip left non-empty', mutate(4, 1, 2)],
            ['paste APPEND(tail) -> APPEND(clip): tail left non-empty', mutate(5, 1, 1)],
            ['cut APPEND(tail) -> APPEND(clip): tail left non-empty', mutate(2, 1, 1)],
            ['cut SPLIT views swapped (tail <-> clip)', mutate(0, 2, 1)],
        ];
        for (const [name, script] of rows) {
            const c = bulkCheck(1024, script, built.fill, true);
            assert.ok(c.pat.length + c.st.length > 0, 'mutant survived: ' + name);
        }
        for (const [name, script] of rows.slice(1, 4)) {
            const c = bulkCheck(1024, script, built.fill, false);
            assert.ok(c.st.length > 0, 'mutant not caught by the view lengths alone: ' + name);
        }
        assert.deepEqual(bulkCheck(1024, bulk, built.fill, true).st, [], 'control: the unmutated script passes the same check');
    });
});

// ---- A4: the full-stream census (blend replay): line law, Enter, join, char edits, seeks --------------------------

function census(n, script, fill) {
    const vs = oracleFilled(fill, n);
    const o = vs[0];
    const R = script.length / REC;
    const oldv = new Int32Array(R);
    const c = {
        errs: [], n: R, ops: new Int32Array(9), enters: 0, joins: 0, clampHits: 0, enterD1Gt: 0, enterD1: 0, enterCSum: 0,
        pairs: 0, free: 0, charOk: 0, charPlus: 0, charMinus: 0, seq: '', runBad: 0, finalLens: null,
    };
    const err = (m) => { if (c.errs.length < 20) c.errs.push(m); };
    const rec = (r, f) => script[r * REC + f];
    let run = 0;
    for (let r = 0; r < R; r++) {
        const k = r * REC;
        const op = script[k];
        const a = script[k + 1];
        const b = script[k + 2];
        const cc = script[k + 3];
        const len = o.length;
        if (op >= 1 && op <= 8) c.ops[op]++; else err('opcode ' + op + ' at ' + r);
        if (op === OP.SPLIT || op === OP.APPEND) run++; else { if (run % 6 !== 0) c.runBad++; run = 0; }
        if (op === OP.SET) {
            if (!(b === 0 || b === 1) || !(a >= 0 && a < len)) { err('set shape ' + r + ' ' + [a, b, cc]); break; }
            if (!(cc >= 1 && cc <= 255)) err('set value ' + r + ' = ' + cc);
            oldv[r] = o.getMeasure(a, b);
            // a pair is SET(row, 0) then SET(row, 1), same row
            if (b === 0 && !(r + 1 < R && rec(r + 1, 0) === OP.SET && rec(r + 1, 1) === a && rec(r + 1, 2) === 1)) err('dim 0 set ' + r + ' not followed by its dim 1 set');
            if (b === 1 && !(r > 0 && rec(r - 1, 0) === OP.SET && rec(r - 1, 1) === a && rec(r - 1, 2) === 0)) err('dim 1 set ' + r + ' not preceded by its dim 0 set');
        } else if (op === OP.INSERT) {
            if (!(a >= 0 && a <= len) || !(b >= 1 && b <= 255 && cc >= b && cc <= 255)) err('insert ' + r + ' ' + [a, b, cc] + ' len ' + len);
            c.seq += 'I';
            // Enter (R-BA23): SET(r0, 0, x = c + 1), SET(r0, 1, d1a), INSERT(r0 + 1, m - c, d1b); m = d0 before; c in [0, m - 1]
            if (r >= 2 && rec(r - 2, 0) === OP.SET && rec(r - 1, 0) === OP.SET && rec(r - 2, 2) === 0 && rec(r - 1, 2) === 1 &&
                rec(r - 2, 1) === a - 1 && rec(r - 1, 1) === a - 1) {
                const m = oldv[r - 2];
                const x = rec(r - 2, 3);
                const d1a = rec(r - 1, 3);
                c.enters++;
                if (!(x >= 1 && x <= m)) err('Enter ' + r + ' column: x ' + x + ' m ' + m);
                if (b !== m - x + 1) err('Enter ' + r + ': new row d0 ' + b + ' != m - c = ' + (m - x + 1));
                if (!d1Ok(x, d1a) || !d1Ok(b, cc)) err('Enter ' + r + ' d1 not re-drawn by the line law: (' + x + ', ' + d1a + ') (' + b + ', ' + cc + ')');
                c.enterD1 += 2;
                if (d1a > x) c.enterD1Gt++;
                if (cc > b) c.enterD1Gt++;
                c.enterCSum += (x - 1 + 0.5) / m;
            } else err('INSERT ' + r + ' is not the third record of an Enter');
        } else if (op === OP.REMOVE) {
            c.seq += 'R';
            if (!(a >= 1 && a < len) || b !== 0 || cc !== 0) err('remove ' + r + ' ' + [a, b, cc] + ' len ' + len);
            // line-start backspace (R-BA24): SET(r-1, 0, min(255, a0 + b0 - 1)), SET(r-1, 1, min(255, a1 + b1 - 1)), REMOVE(r)
            if (r >= 2 && rec(r - 2, 0) === OP.SET && rec(r - 1, 0) === OP.SET && rec(r - 2, 2) === 0 && rec(r - 1, 2) === 1 &&
                rec(r - 2, 1) === a - 1 && rec(r - 1, 1) === a - 1 && a >= 1 && a < len) {
                const a0 = oldv[r - 2];
                const a1 = oldv[r - 1];
                const b0 = o.getMeasure(a, 0);
                const b1 = o.getMeasure(a, 1);
                c.joins++;
                if (rec(r - 2, 3) !== Math.min(255, a0 + b0 - 1)) err('join ' + r + ' d0 ' + rec(r - 2, 3) + ' != min(255, ' + a0 + ' + ' + b0 + ' - 1)');
                if (rec(r - 1, 3) !== Math.min(255, a1 + b1 - 1)) err('join ' + r + ' d1 ' + rec(r - 1, 3) + ' != min(255, ' + a1 + ' + ' + b1 + ' - 1)');
                if (a0 + b0 - 1 > 255 || a1 + b1 - 1 > 255) c.clampHits++;
            } else err('REMOVE ' + r + ' is not the third record of a join');
        } else if (op === OP.SEEK) {
            if (a !== 0 || cc !== 0 || !(b >= 0 && b < o.total(0))) err('seek ' + r + ' ' + [a, b, cc]);
        } else if (op === OP.SUM) {
            if (a !== 0 || cc !== 0 || !(b >= 0 && b <= len)) err('sum ' + r + ' ' + [a, b, cc]);
        }
        if (op === OP.WALK) err('S2 has no WALK record ' + r);
        try { oracleStep(vs, script, k, 0); } catch (e) { err('record ' + r + ' threw ' + e.message); break; }
        // free pair (not an Enter / backspace pair): the character-edit law (R-BA24 second half)
        if (op === OP.SET && b === 1) {
            c.pairs++;
            const nx = r + 1 < R ? rec(r + 1, 0) : 0;
            if (nx !== OP.INSERT && nx !== OP.REMOVE) {
                c.free++;
                const o0 = oldv[r - 1];
                const o1 = oldv[r];
                const x = rec(r - 1, 3);
                const y = cc;
                for (const s of [1, -1]) {
                    if (x === Math.min(255, Math.max(1, o0 + s)) && y === Math.min(255, Math.max(x, o1 + s))) {
                        c.charOk++;
                        if (s === 1) c.charPlus++; else c.charMinus++;
                    }
                }
            }
        }
        // invariant 1 <= d0 <= d1 <= 255 after every record that is not the first half of a pair; and total length in [n, n + 1]
        const total = vs[0].length + vs[1].length + vs[2].length;
        if (total < n || total > n + 1) err('total length ' + total + ' after record ' + r);
        const partial = op === OP.SET && b === 0;
        if (!partial) {
            if (op === OP.SET || op === OP.INSERT) {
                const row = a;
                const d0 = o.getMeasure(row, 0);
                const d1 = o.getMeasure(row, 1);
                if (!(d0 >= 1 && d0 <= d1 && d1 <= 255)) err('row ' + row + ' after record ' + r + ' = (' + d0 + ', ' + d1 + ')');
            }
            if (r % 97 === 0 || r === R - 1) {
                for (const v of vs) {
                    const dm = v.dump().measures;
                    for (let q = 0; q < v.length; q++) {
                        if (!(dm[0][q] >= 1 && dm[0][q] <= dm[1][q] && dm[1][q] <= 255)) { err('scan: row ' + q + ' = (' + dm[0][q] + ', ' + dm[1][q] + ') after record ' + r); break; }
                    }
                }
            }
        }
    }
    if (run % 6 !== 0) c.runBad++;
    c.finalLens = [vs[0].length, vs[1].length, vs[2].length];
    return c;
}

const censusMemo = new Map();
function censusOf(id, n) {
    const key = id + '/' + n;
    if (!censusMemo.has(key)) {
        const built = build(id, n);
        censusMemo.set(key, census(n, built.phases[built.phases.length - 1].script, built.fill));
    }
    return censusMemo.get(key);
}

describe('A4: the full-stream census over the blend replay (R-BA17, R-BA23, R-BA24, R-BA27)', () => {
    for (const id of ['S2', 'S2a']) {
        test('A4: ' + id + ' @ 4096 blend: every record valid, 1 <= d0 <= d1 <= 255 after every record, length in [n, n + 1], ends at n with clip and tail 0', () => {
            const c = censusOf(id, 4096);
            assert.deepEqual(c.errs, [], 'first violations');
            assert.deepEqual(c.finalLens, [4096, 0, 0]);
            assert.equal(c.runBad, 0, 'a maximal SPLIT / APPEND run that is not a whole number of 6-record units');
        });

        test('A4: ' + id + ' @ 4096 record-class totals: INSERT = REMOVE = SEEK = SUM = 1,000 (S2) / same for S2a; SPLIT = APPEND = 1,500 (S2) / 0 (S2a); structural ops alternate, insert first', () => {
            const c = censusOf(id, 4096);
            const k = id === 'S2' ? 1500 : 0;
            assert.deepEqual([c.ops[OP.INSERT], c.ops[OP.REMOVE], c.ops[OP.SEEK], c.ops[OP.SUM]], [1000, 1000, 1000, 1000]);
            assert.deepEqual([c.ops[OP.SPLIT], c.ops[OP.APPEND]], [k, k]);
            assert.equal(c.enters, 1000);
            assert.equal(c.joins, 1000);
            for (let j = 0; j < c.seq.length; j++) assert.equal(c.seq[j], j % 2 === 0 ? 'I' : 'R', 'structural ' + j);
            // SET records = 2 x (char pairs + mid rows) + 2 x 100 per block of Enter / backspace: derived from the pair count
            assert.equal(c.ops[OP.SET], 2 * c.pairs);
            assert.equal(c.pairs, c.free + 2000, 'every pair is a free pair, an Enter pair or a backspace pair');
        });

        test('A4: ' + id + ' @ 4096 Enter law (R-BA23): column uniform in [0, m - 1], both d1 re-drawn by the d1 rule (10% above d0); join clamp (R-BA24) hit at least once', () => {
            const c = censusOf(id, 4096);
            // (c + 0.5) / m has mean 0.5 for c uniform in [0, m - 1]; sd <= 0.29 / sqrt(1000) = 0.009 -> +-0.05
            assert.ok(Math.abs(c.enterCSum / c.enters - 0.5) <= 0.05, 'mean column position ' + c.enterCSum / c.enters);
            // 2,000 re-drawn d1: P(d1 > d0) = 0.10 (cap on d0 = 255 negligible), sd 0.0067 -> +-0.035
            assert.ok(Math.abs(c.enterD1Gt / c.enterD1 - 0.1) <= 0.035, 'Enter d1 > d0 share ' + c.enterD1Gt / c.enterD1);
            // P(a0 + b0 - 1 > 255) ~ 0.02 per join over 1,000 joins -> ~ 20 expected; floor 1 (P(0) ~ e^-20)
            assert.ok(c.clampHits >= 1, 'no join reached the 255 clamp: coverage floor');
        });

        test('A4: ' + id + ' @ 4096 character edits (R-BA24): every one of the 12,000 obeys d0 + s, d1 + s clamped to [1, 255] / [d0, 255]; +1 share 0.60', () => {
            const c = censusOf(id, 4096);
            // all 12,000 char edits are consistent with some s in {+1, -1}; a fresh mid pair matches by chance (<= ~2%)
            assert.ok(c.charOk >= 12000, 'only ' + c.charOk + ' free pairs obey the character-edit law');
            const midPairs = c.free - 12000;
            assert.ok(c.charOk <= 12000 + 0.05 * midPairs + 50, 'char-law pairs ' + c.charOk + ' of ' + c.free + ' free pairs');
            const share = c.charPlus / (c.charPlus + c.charMinus);
            assert.ok(share >= 0.54 && share <= 0.64, '+1 share ' + share + ' (ruled 0.60; mid-pair chance matches pull toward 0.5)');
            if (id === 'S2a') {
                // no mid edits in S2a: free pairs are exactly the 12,000 character edits and ALL obey the law
                assert.equal(c.free, 12000);
                assert.equal(c.charOk, 12000);
                assert.ok(Math.abs(share - 0.6) <= 0.025, 'S2a +1 share ' + share);
            }
        });
    }

    test('A4: S2 reweight phase = 12,000 character pairs + mid edits of k rows; mean k = 30 (uniform [10, 50]); pairs write d0 then d1; rows ascend within a mid edit', () => {
        const built = build('S2', 4096);
        const rw = built.phases.find((p) => p.name === 'reweight').script;
        const R = rw.length / REC;
        const pairs = R / 2;
        for (let t = 0; t < pairs; t++) {
            const x = rw.subarray(2 * t * REC, (2 * t + 1) * REC);
            const y = rw.subarray((2 * t + 1) * REC, (2 * t + 2) * REC);
            assert.ok(x[0] === OP.SET && y[0] === OP.SET && x[2] === 0 && y[2] === 1 && x[1] === y[1] && x[1] >= 0 && x[1] < 4096, 'pair ' + t);
            assert.ok(x[3] >= 1 && x[3] <= 255 && y[3] >= 1 && y[3] <= 255, 'pair ' + t + ' values');
        }
        // 3,000 mid edits: sum(k) = pairs - 12,000; mean k sd = sqrt(140 / 3000) = 0.216 -> +-5 sd = 1.08
        const meanK = (pairs - 12000) / 3000;
        assert.ok(meanK >= 28.9 && meanK <= 31.1, 'mean k ' + meanK);
        // runs of ascending consecutive rows: a mid edit is one run of 10..50 pairs; at most 3,000 runs of >= 10 (merges only lower it)
        let runs = 0;
        let ok = 0;
        let len = 1;
        for (let t = 1; t <= pairs; t++) {
            if (t < pairs && rw[2 * t * REC + 1] === rw[2 * (t - 1) * REC + 1] + 1) len++;
            else { if (len >= 10) { runs++; if (len <= 50) ok++; } len = 1; }
        }
        assert.ok(runs <= 3000 && runs >= 2900, 'ascending runs of >= 10 rows: ' + runs);
        assert.ok(ok >= 2800, 'runs of 10..50 rows: ' + ok);
    });

    test('A4: seek phase: SEEK [4, 0, y, 0] with y >= 0 and SUM [5, 0, i, 0] with i in [0, n], 50% each (y < total is the blend census)', () => {
        for (const id of ['S2', 'S2a']) {
            const built = build(id, 4096);
            const seek = built.phases.find((p) => p.name === 'seek').script;
            // y < the blend's total at that record is the census check; a class phase replays on the fill, whose total differs
            let nSeek = 0;
            let nSum = 0;
            let maxI = 0;
            for (let k = 0; k < seek.length; k += REC) {
                assert.equal(seek[k + 1], 0);
                assert.equal(seek[k + 3], 0);
                if (seek[k] === OP.SEEK) { nSeek++; assert.ok(seek[k + 2] >= 0 && seek[k + 2] < 255 * 4096, id + ' y ' + seek[k + 2]); } else {
                    assert.equal(seek[k], OP.SUM);
                    nSum++;
                    assert.ok(seek[k + 2] >= 0 && seek[k + 2] <= 4096, id + ' i ' + seek[k + 2]);
                    maxI = Math.max(maxI, seek[k + 2]);
                }
            }
            assert.deepEqual([nSeek, nSum], [1000, 1000]);
            assert.ok(maxI > 3000, 'sumBefore indexes never leave the first 3/4 of the rows: ' + maxI);
        }
    });

    test('A4 must-fail: the census catches a mutated join value, Enter row, Enter d1, a broken pair and a dropped unit record (control: the unmutated stream is clean)', () => {
        const built = sc('S2').build(null, 1024, SEED, scenarioEvents(true));
        const blend = built.phases[built.phases.length - 1].script;
        assert.deepEqual(census(1024, blend, built.fill).errs, [], 'control: clean');
        const firstOf = (op) => { for (let k = 0; k < blend.length; k += REC) if (blend[k] === op) return k / REC; return -1; };
        const mut = (r, f, v) => { const m = Int32Array.from(blend); m[r * REC + f] = v; return m; };
        const rm = firstOf(OP.REMOVE);
        const ins = firstOf(OP.INSERT);
        const rows = [
            ['join d0 + 1', mut(rm - 2, 3, blend[(rm - 2) * REC + 3] === 255 ? 254 : blend[(rm - 2) * REC + 3] + 1)],
            ['join d1 + 1', mut(rm - 1, 3, blend[(rm - 1) * REC + 3] === 255 ? 254 : blend[(rm - 1) * REC + 3] + 1)],
            ['Enter new-row d0 + 1', mut(ins, 2, blend[ins * REC + 2] + 1)],
            ['Enter new-row d1 below its d0', mut(ins, 3, blend[ins * REC + 2] - 1)],
            ['Enter SET row moved', mut(ins - 2, 1, blend[(ins - 2) * REC + 1] + 1)],
            ['pair dims swapped', mut(ins - 2, 2, 1)],
        ];
        for (const [name, script] of rows) assert.ok(census(1024, script, built.fill).errs.length > 0, 'census missed: ' + name);
    });
});

// ---- A4: fill census at n 131072 ---------------------------------------------------------------------------------

describe('A4: the fill line law at n 131072 (R-BA17)', () => {
    for (const id of IDS) {
        test('A4: ' + id + ' fill @ 131072: d0 = 1 in [0.095, 0.105], d0 > 81 in [0.045, 0.055], d1 > d0 in [0.095, 0.105], all values in [1, 255], d1 law', () => {
            const n = 131072;
            const built = sc(id).build(null, n, SEED, BLOCK_EVENTS);
            assert.equal(built.fill.length, 2 * n);
            let one = 0;
            let big = 0;
            let gt = 0;
            let low = 0;
            let mid2 = 0;
            let big1 = 0;
            let big2 = 0;
            for (let i = 0; i < n; i++) {
                const d0 = built.fill[2 * i];
                const d1 = built.fill[2 * i + 1];
                if (!(d0 >= 1 && d0 <= 255) || !d1Ok(d0, d1)) assert.fail('fill row ' + i + ' = (' + d0 + ', ' + d1 + ')');
                if (d0 === 1) one++;
                if (d0 > 81) { big++; if (d0 <= 168) big1++; else big2++; }
                if (d1 > d0) gt++;
                if (d0 >= 2 && d0 <= 41) low++;
                if (d0 >= 42 && d0 <= 81) mid2++;
            }
            assert.ok(one / n >= 0.095 && one / n <= 0.105, 'd0 = 1 share ' + one / n);
            assert.ok(big / n >= 0.045 && big / n <= 0.055, 'd0 > 81 share ' + big / n);
            assert.ok(gt / n >= 0.095 && gt / n <= 0.105, 'd1 > d0 share ' + gt / n);
            // the two bands are uniform: [2, 41] and [42, 81] each 0.425 (sd 0.0014), [82, 168] and [169, 255] each ~ 0.025
            assert.ok(Math.abs(low / n - 0.425) <= 0.01 && Math.abs(mid2 / n - 0.425) <= 0.01, 'uniform [2, 81] halves ' + low / n + ' ' + mid2 / n);
            assert.ok(Math.abs(big1 / n - big2 / n) <= 0.006, 'uniform [82, 255] halves ' + big1 / n + ' ' + big2 / n);
        });
    }
});

describe('A4: exact fill replay (plan TASK 5 salts 0x52 / 0x52a / 0x52b, S1 draw convention)', () => {
    // Replay of the ruled law with this file's own PRNG use: u = uni(100): < 10 -> d0 1, < 95 -> 2 + uni(80), else 82 + uni(174);
    // then v = uni(100): < 90 -> d1 = d0, else min(255, d0 + 1 + uni(d0)). The draw ORDER is not in the ruling text; it is the
    // S1 fill convention (ScenarioFeed.test.mjs), checked once against the built fill.
    const replayFill = (id, n, salt) => {
        const rr = prng((SEED ^ Math.imul(n, 0x9e3779b1) ^ salt) >>> 0);
        const uni = (m) => Math.floor((rr() / 4294967296) * m);
        const out = new Int32Array(2 * n);
        for (let i = 0; i < n; i++) {
            const u = uni(100);
            const d0 = u < 10 ? 1 : u < 95 ? 2 + uni(80) : 82 + uni(174);
            out[2 * i] = d0;
            out[2 * i + 1] = uni(100) < 90 ? d0 : Math.min(255, d0 + 1 + uni(d0));
        }
        return out;
    };
    const SALT = { S2: 0x52, S2a: 0x52a, S2b: 0x52b };
    for (const id of IDS) {
        test('A4: ' + id + ' fill @ 1024 and 4096 equals the replay of the ruled law; a wrong salt does not (control)', () => {
            for (const n of [1024, 4096]) {
                const built = build(id, n, BLOCK_EVENTS);
                const want = replayFill(id, n, SALT[id]);
                assert.equal(built.fill.length, want.length);
                for (let i = 0; i < want.length; i++) if (built.fill[i] !== want[i]) assert.fail(id + ' @ ' + n + ' fill[' + i + '] = ' + built.fill[i] + ', replay ' + want[i]);
                const wrong = replayFill(id, n, SALT[id] ^ 1);
                let diff = 0;
                for (let i = 0; i < want.length; i++) if (built.fill[i] !== wrong[i]) diff++;
                assert.ok(diff > want.length / 10, 'control: the wrong-salt replay matched ' + (want.length - diff) + ' of ' + want.length);
            }
        });
    }
});

// ---- A4: all five labels and the oracle agree --------------------------------------------------------------------

describe('A4: all five labels and the 3-view oracle replay agree per phase (n 1024 and 4096, full stream)', () => {
    for (const id of IDS) {
        for (const n of [1024, 4096]) {
            test('A4: ' + id + ' @ ' + n + ': checksum + endState + traceHash identical across labels and equal to the oracle', async () => {
                assert.equal(sc(id).adapters.length, 5);
                const built = build(id, n);
                const w = wants(id, n, false);
                for (const label of sc(id).adapters) {
                    const r = await runScenario(label, sc(id), n, { seed: SEED, samples: 1 });
                    assert.equal(r.phases.length, PHASE_NAMES[id].length);
                    assert.equal(r.views, sc(id).views);
                    for (const p of built.phases) {
                        const row = r.phases.find((x) => x.phase === p.name);
                        const want = w.get(p.name);
                        assert.equal(row.events, EVENTS[id][p.name], label + ' ' + p.name + ' events');
                        assert.equal(row.checksum, want.checksum, label + ' ' + p.name + ' checksum vs oracle');
                        assert.equal(row.endState, want.endState, label + ' ' + p.name + ' endState vs oracle');
                        assert.equal(row.traceHash, want.traceHash, label + ' ' + p.name + ' traceHash vs independent FNV-1a');
                    }
                }
                // not vacuous: a seek / sum phase reads a non-zero acc (S2b has none: its checksum is 0 by construction)
                if (id !== 'S2b') assert.notEqual(w.get('seek').checksum, 0);
            });
        }
    }
});

// ---- A5: the --expose-gc child (BA-7a / BA-26 precedent) ----------------------------------------------------------

// NOTE: serialized with toString() into a child process; it may reference only its own locals and its argument.
async function childMain(u) {
    const SC = await import(u.scn);
    const M = await import(u.meter);
    const L = await import(u.leak);
    const G = await import(u.prof);
    const out = { semi: M.semiSpaceOk(), lanes: [], controls: [], pcControls: [], gc: null, leak: null, ctlRetain: null };
    if (!out.semi) return out;
    const tick = (ms) => new Promise((r) => setTimeout(r, ms));
    const settle = async () => { globalThis.gc(); await tick(20); globalThis.gc(); await tick(20); };
    const N = 4096;
    const EV = u.events; // --quick stream (2,000 events, records /10): runtime; the warm below still passes the record floors
    const WIN = 6;
    const KC = 16; // calls per window: a 1-call window plus a memoized baseline drifts +-16 B and can under-read
    const T = SC.OP;
    const LABELS = u.labels;
    const IOUT = new Int32Array(4);
    const bases = new Map();
    const base = (ops) => { if (!bases.has(ops)) bases.set(ops, M.baseline(ops, WIN)); return bases.get(ops); };
    const warmCalls = (name, ops) => Math.max(u.minCalls[name] || u.minCalls.other, Math.ceil((u.warmRecords[name] || u.warmRecords.other) / ops));
    const mkViews = async (ad, scn, cap) => (scn.views === 3 ? ad.createViews(cap, 2, 3) : [ad.create(cap, 2)]);
    const prof = new G.GcProfiler();
    prof.start();
    const gate = { enter: () => { prof.enter('lanes'); }, exit: () => { prof.exit(); } };
    for (const sid of u.ids) {
        const scn = SC.SCENARIOS.find((s) => s.id === sid);
        const built = scn.build(null, N, u.seed, EV);
        for (const label of LABELS) {
            const ad = await SC.resolveLabel(label);
            const partner = SC.appendPartner(ad, 2);
            const views = await mkViews(ad, scn, built.capacity);
            const h = views[0];
            for (const p of built.phases) {
                if (u.only && p.name !== u.only) continue;
                // every S2 script is length-neutral and index-valid on any state of length n..n+1 (and ends with clip / tail empty)
                for (let v = 1; v < views.length; v++) views[v].clear();
                SC.fillHandle(h, built.fill, N, 2, partner);
                const ops = p.script.length / 4;
                const calls = u.warm !== undefined ? u.warm : warmCalls(p.name, ops);
                // NO gc() anywhere between fill and lane (measured, g2b2c alloc probes + this file): code optimized for earlier labels
                // embeds weak refs to dead objects; a forced GC clears them and V8 deopts BlockedArray _split / _equalize ("embedded weak
                // objects cleared"). Those paths are too rare to re-tier in 6 x 16 lane calls -> 130..3000 B per call of Float64 boxing,
                // even with the gc() placed BEFORE the warm-up (S2a.BlockedArray.edit read 134 quick / 1168 full). Without it: 0.
                for (let w = 0; w < calls; w++) IOUT[0] = SC.runScript(h, p.script, views);
                const r = M.lane(sid + '.' + label + '.' + p.name, () => { IOUT[0] = SC.runScript(h, p.script, views); }, KC, WIN, undefined, gate);
                const perCall = M.bop(r, base(KC));
                const end = [];
                for (let v = 0; v < views.length; v++) end.push(views[v].length());
                out.lanes.push({ sid, name: r.name, ops, calls, warmRecords: calls * ops, perCall, bop: perCall / ops, wins: M.winText(r, base(KC)), end });
            }
            for (const v of views) v.clear();
            partner && partner.clear();
        }
    }
    if (u.only) { prof.stop(); return out; }
    await prof.settle();
    const s = prof.summary();
    prof.stop();
    const rep = G.checkNoGc(s, { perRegion: { lanes: { maxMajor: 0 } } });
    const lg = s.byRegion && s.byRegion.lanes ? s.byRegion.lanes.gc : null;
    out.gc = { ok: rep.ok === true && lg !== null, major: lg ? lg.major : -1 };

    // must-fail control 1 (outside the region): a runScript that allocates an Int32Array(1) per record
    const HOLD = [null, null];
    const allocScript = (h, script, views) => {
        let acc = 0;
        for (let k = 0; k < script.length; k += 4) {
            HOLD[(k >> 2) & 1] = new Int32Array(1);
            const op = script[k];
            if (op === T.SET) h.setMeasure(script[k + 1], script[k + 2], script[k + 3]);
            else if (op === T.INSERT) h.insertAt(script[k + 1], script[k + 1], script[k + 2], script[k + 3]);
            else if (op === T.REMOVE) h.removeAt(script[k + 1]);
            else if (op === T.SEEK) acc = (acc + h.indexAtSum(script[k + 1], script[k + 2])) | 0;
            else if (op === T.SUM) acc = (acc + h.sumBefore(script[k + 1], script[k + 2])) | 0;
            else if (op === T.SPLIT) h.splitAt(script[k + 1], views[script[k + 2]]);
            else if (op === T.APPEND) h.append(views[script[k + 1]]);
        }
        return acc;
    };
    const scn2 = SC.SCENARIOS.find((s2) => s2.id === 'S2');
    const b2 = scn2.build(null, N, u.seed, EV);
    const ssA = await SC.resolveLabel('SumSequence');
    const cviews = await mkViews(ssA, scn2, b2.capacity);
    const ch = cviews[0];
    // the 2,000-record prefix of the blend (long allocating runs GC in every window and read NaN); refilled per window
    const cref = b2.phases.find((p) => p.name === 'blend').script.subarray(0, 8000);
    const crefn = cref.length / 4;
    const crefill = () => { for (let v = 1; v < cviews.length; v++) cviews[v].clear(); SC.fillHandle(ch, b2.fill, N, 2, null); };
    crefill();
    IOUT[0] = allocScript(ch, cref, cviews);
    const cr = M.lane('ctl.allocPerOp', () => { IOUT[0] = allocScript(ch, cref, cviews); }, 1, WIN, crefill);
    out.controls.push({ name: cr.name, perCall: M.bop(cr, base(1)), bop: M.bop(cr, base(1)) / crefn, wins: M.winText(cr, base(1)) });
    // must-fail control 2: exactly ONE 16 B box per runScript CALL on ALL labels with the S2 edit script, warmed and
    // measured like the real edit lanes (PC.v starts null, so the field is tagged and every non-Smi store boxes).
    const PC = { v: null };
    const perCallScript = (h, script, views) => { const a = SC.runScript(h, script, views); PC.v = a + 0.5; return a; };
    const editScript = b2.phases.find((p) => p.name === 'edit').script;
    const editCalls = u.warm !== undefined ? u.warm : warmCalls('edit', editScript.length / 4);
    for (const label of LABELS) {
        const ad = await SC.resolveLabel(label);
        const partner = SC.appendPartner(ad, 2);
        const vv = await mkViews(ad, scn2, b2.capacity);
        SC.fillHandle(vv[0], b2.fill, N, 2, partner);
        for (let w = 0; w < editCalls; w++) IOUT[0] = perCallScript(vv[0], editScript, vv);
        const cp = M.lane('ctl.allocPerCall.' + label, () => { IOUT[0] = perCallScript(vv[0], editScript, vv); }, KC, WIN);
        const pcall = M.bop(cp, base(KC));
        out.pcControls.push({ name: cp.name, perCall: pcall, bop: pcall / (editScript.length / 4), wins: M.winText(cp, base(KC)) });
        for (const v of vv) v.clear();
        partner && partner.clear();
    }

    // ---- A5: 100 cycles per label of createViews(n + 1, 2, 3) -> fill -> S2 blend at n 256 -> clear -> drop
    const K = new Int32Array(2);
    const onFin = () => { K[0]++; };
    const SN = 256;
    const small = scn2.build(null, SN, u.seed, 1000);
    const blendSmall = small.phases.find((p) => p.name === 'blend').script;
    const leakRun = async (retain) => {
        K[0] = 0; K[1] = 0;
        const tracker = L.createLeakTracker({ name: retain ? 'editor-ctl' : 'editor', onLeak: () => {}, onWarning: () => {} });
        const refs = [];
        const kept = [];
        for (const label of LABELS) {
            const ad = await SC.resolveLabel(label);
            // one cycle per call: no local of a finished cycle survives on the stack to pin its handles
            const cycle = () => {
                const vv = ad.createViews(small.capacity, 2, 3);
                const tr = [];
                for (let v = 0; v < vv.length; v++) {
                    tr.push(tracker.track(vv[v], onFin, label + '.view' + v));
                    tr.push(tracker.track(vv[v].instance, onFin, label + '.instance' + v));
                    refs.push(new WeakRef(vv[v]), new WeakRef(vv[v].instance));
                }
                SC.fillHandle(vv[0], small.fill, SN, 2, null);
                IOUT[0] = SC.runScript(vv[0], blendSmall, vv);
                if (!retain) for (const v of vv) v.clear();
                if (vv[0].length() === 0 && vv[1].length() === 0 && vv[2].length() === 0) { for (const t of tr) tracker.untrack(t); } else K[1]++;
                if (retain) kept.push(vv);
            };
            for (let a = 0; a < 100; a++) cycle();
        }
        await settle();
        const size = tracker.size();
        let alive = 0;
        for (const r of refs) if (r.deref() !== undefined) alive++;
        const held = kept.length;
        kept.length = 0;
        return { size, alive, fin: K[0], notReset: K[1], tracked: refs.length, held };
    };
    out.leak = await leakRun(false);
    out.ctlRetain = await leakRun(true);
    return out;
}

// Warm FLOOR (BA-26): records per phase before a lane is read; calls = max(MIN_CALLS, ceil(records / ops)).
// edit / bulk / blend drive the BlockedArray rare paths (_split / _equalize / _repairUnderflow). Probed (isolated child,
// n 4096, K = 16, 6 windows): S2 BlockedArray / .plain edit reads 72 B per call after 200 calls (1.2e6 records) and 0 after
// 400; S2b bulk and S2 blend read 0 from 34 / 4 calls. edit warms >= 2000 calls (BA-26 floor; 12e6 records, 5x the first 0).
const WARM_RECORDS = { edit: 1200000, bulk: 1200000, blend: 1200000, other: 200000 };
// BA-26 (orchestrator ruling for this unit): edit lanes warm >= max(2000, ceil(1e5 / ops)) calls.
const MIN_CALLS = { edit: 2000, other: 4 };
const warmCallsOf = (phase, ops) => Math.max(MIN_CALLS[phase] || MIN_CALLS.other, Math.ceil((WARM_RECORDS[phase] || WARM_RECORDS.other) / ops));

let childResult = null;
function runChild(over) {
    if (!over && childResult) return childResult;
    const u = {
        scn: new URL('../benchmark/Scenarios.mjs', import.meta.url).href,
        meter: new URL('./torture-meter.mjs', import.meta.url).href,
        seed: SEED, ids: IDS, labels: [...sc('S2').adapters], warmRecords: WARM_RECORDS, minCalls: MIN_CALLS, events: scenarioEvents(true),
        leak: import.meta.resolve('@zakkster/lite-leak'), prof: import.meta.resolve('@zakkster/lite-gc-profiler'),
    };
    Object.assign(u, over);
    const code = '(' + childMain.toString() + ')(' + JSON.stringify(u) + ').then((r) => { process.stdout.write("RESULT " + JSON.stringify(r) + "\\n"); },' +
        ' (e) => { process.stderr.write(String(e && e.stack || e)); process.exit(1); });';
    const r = spawnSync(process.execPath, ['--expose-gc', '--no-concurrent-recompilation', '--min-semi-space-size=4',
        '--max-semi-space-size=4', '--input-type=module', '-e', code], { cwd: PKG, encoding: 'utf8', timeout: 1800000, maxBuffer: 1 << 26 });
    assert.equal(r.status, 0, 'child failed: ' + r.stderr + r.stdout.slice(-800));
    const line = r.stdout.split('\n').find((l) => l.startsWith('RESULT '));
    assert.ok(line, 'child printed no RESULT line: ' + r.stdout);
    const res = JSON.parse(line.slice(7));
    if (over) return res;
    childResult = res;
    return childResult;
}

describe('A5: the --expose-gc child (BA-26), S2 + S2a + S2b', () => {
    test('A5: runScript phase lanes, 3 scenarios x 5 labels at n 4096 / --quick 2,000 events: < 8 B per call (K = 16, > -2) AND < 1 B per record, maxMajor 0; controls fail', () => {
        const r = runChild();
        assert.equal(r.semi, true, 'semi-space flags not pinned in the child');
        for (const l of r.lanes) console.log('# lane ' + l.name + ' ops=' + l.ops + ' calls=' + l.calls + ' perCall=' + String(l.perCall) + ' bop=' + String(l.bop) + ' [' + l.wins + ']');
        for (const l of r.controls) console.log('# control ' + l.name + ' perCall=' + String(l.perCall) + ' bop=' + String(l.bop) + ' [' + l.wins + ']');
        // 5 labels x (5 + 4 + 1 phases)
        assert.equal(r.lanes.length, 5 * (5 + 4 + 1));
        const exactOps = { S2: { seek: 200, edit: 600, bulk: 300 }, S2a: { seek: 200, reweight: 2400, edit: 600, blend: 3200 }, S2b: { bulk: 300 } }; // --quick = /10
        const build4096 = (sid) => build(sid, 4096, scenarioEvents(true));
        for (const l of r.lanes) {
            const phase = l.name.slice(l.name.lastIndexOf('.') + 1);
            const want = exactOps[l.sid][phase];
            if (want !== undefined) assert.equal(l.ops, want, l.name + ' ops');
            else {
                // S2 reweight / blend (--quick): mean 20,400 +- 5 x 410; blend adds 1,100 other records
                const lo = phase === 'reweight' ? 18350 : 18350 + 1100;
                assert.ok(l.ops >= lo && l.ops <= lo + 4100, l.name + ' ops ' + l.ops);
            }
            assert.equal(l.ops, build4096(l.sid).phases.find((p) => p.name === phase).script.length / 4, l.name + ' ops = the 4096 build');
            assert.equal(l.calls, warmCallsOf(phase, l.ops), l.name + ' warm calls');
            assert.ok(l.warmRecords >= 100000, l.name + ' warmed only ' + l.warmRecords + ' records');
            // every call ends at length n with clip and tail empty (exact)
            assert.deepEqual(l.end, l.sid === 'S2a' ? [4096] : [4096, 0, 0], l.name + ' end lengths [main, clip, tail]');
            // JSON carries NaN (no gated window) as null: a non-number reading fails closed
            assert.ok(typeof l.perCall === 'number' && l.perCall > -2 && l.perCall < 8, // 8: one 16 B box per call reads ~15 at K = 16 (BA-26)
                l.name + ' perCall ' + l.perCall);
            assert.ok(typeof l.bop === 'number' && l.bop < 1, l.name + ' bop ' + l.bop);
        }
        assert.equal(r.gc.ok, true, 'gc region: ' + JSON.stringify(r.gc));
        assert.equal(r.gc.major, 0);
        assert.equal(r.controls.length, 1);
        assert.ok(typeof r.controls[0].bop === 'number' && r.controls[0].bop > 8, 'allocating runScript must read > 8 B per record, read ' + r.controls[0].bop);
        // must-fail control: ONE 16 B box per runScript CALL on EVERY label reads < 1 B/record but must FAIL the per-call floor (>= 8)
        assert.equal(r.pcControls.length, 5);
        assert.deepEqual(r.pcControls.map((x) => x.name), sc('S2').adapters.map((l) => 'ctl.allocPerCall.' + l));
        for (const pc of r.pcControls) {
            console.log('# control ' + pc.name + ' perCall=' + String(pc.perCall) + ' bop=' + String(pc.bop) + ' [' + pc.wins + ']');
            assert.ok(typeof pc.bop === 'number' && pc.bop < 1, pc.name + ' must read < 1 B per record, read ' + pc.bop);
            assert.ok(typeof pc.perCall === 'number' && pc.perCall >= 8, pc.name + ' window has no teeth: one box per call must read >= 8, read ' + pc.perCall);
        }
    });

    // A5 retention: the proof is the WeakRef `alive` count; size() reaches 0 because the test untracks after clear().
    test('A5: 100 cycles per label of createViews(n + 1, 2, 3) -> fill -> S2 blend at n 256 -> clear -> drop: tracker.size() 0; retaining control >= 1', () => {
        const r = runChild();
        console.log('# leak ' + JSON.stringify(r.leak) + ' ctl ' + JSON.stringify(r.ctlRetain));
        // 5 labels x 100 cycles x 3 views x (handle + instance)
        assert.equal(r.leak.tracked, 5 * 100 * 3 * 2);
        assert.deepEqual([r.leak.size, r.leak.alive, r.leak.fin, r.leak.notReset], [0, 0, 0, 0]);
        assert.equal(r.ctlRetain.tracked, 5 * 100 * 3 * 2);
        assert.ok(r.ctlRetain.size >= 1, 'retaining control must leave size() >= 1');
        assert.ok(r.ctlRetain.alive >= 1, 'retaining control must keep handles alive');
        assert.equal(r.ctlRetain.held, 5 * 100, 'the retaining control kept every cycle');
    });
});

// ---- review r1 rows: R-BA19 block counts + shuffle, R-BA23 column end, R-BA25 mid start, R-BA27 caret locality, sumBefore window ----
// Events are segmented from the public records only: SEEK / SUM = 1 record; a 6-record SPLIT / APPEND unit = cut + paste;
// a SET pair followed by INSERT / REMOVE = Enter / backspace; a maximal run of >= 10 SET pairs on ascending rows = a mid
// edit; any other SET pair = a character edit. pre = the caret the event reveals, post = the caret it leaves (-1 = none).
function segment(n, script, fill) {
    const vs = oracleFilled(fill, n);
    const o = vs[0];
    const R = script.length / REC;
    const ev = []; // [cls, pre, post, x, m]: cls 0 char 1 Enter 2 backspace 3 mid 4 cut 5 paste 6 indexAtSum 7 sumBefore
    const at = (q, f) => script[q * REC + f];
    const pairEnds = (q) => q + 2 < R && (at(q + 2, 0) === OP.INSERT || at(q + 2, 0) === OP.REMOVE);
    let q = 0;
    while (q < R) {
        const op = at(q, 0);
        let len = 1;
        if (op === OP.SEEK) ev.push([6, o.indexAtSum(0, at(q, 2)), o.indexAtSum(0, at(q, 2))]);
        else if (op === OP.SUM) ev.push([7, -1, -1, at(q, 2)]);
        else if (op === OP.SPLIT) { ev.push([4, -1, -1], [5, -1, -1]); len = 6; }
        else if (pairEnds(q)) {
            const row = at(q, 1);
            if (at(q + 2, 0) === OP.INSERT) ev.push([1, row, row + 1, at(q, 3), o.getMeasure(row, 0)]);
            else ev.push([2, row + 1, row]);
            len = 3;
        } else {
            let k = 1;
            while (q + 2 * k < R && at(q + 2 * k, 0) === OP.SET && at(q + 2 * k, 1) === at(q, 1) + k && !pairEnds(q + 2 * k)) k++;
            if (k >= 10) { ev.push([3, at(q, 1), at(q, 1)]); len = 2 * k; } else { ev.push([0, at(q, 1), at(q, 1)]); len = 2; }
        }
        for (let t = 0; t < len; t++) oracleStep(vs, script, (q + t) * REC, 0);
        q += len;
    }
    return ev;
}

describe('review r1: R-BA19 block counts and shuffle, R-BA23 column end, R-BA25 mid start, R-BA27 caret, sumBefore window', () => {
    for (const id of ['S2a', 'S2']) {
        test('r1: ' + id + ' @ 4096: exact class counts per block (non-reweight events per 250 for S2), shuffled; caret moves before every event by [-3, 3] with a 1% jump; Enter / backspace move it +-1; sumBefore window +-50', () => {
            const built = build(id, 4096);
            const ev = segment(4096, built.phases[built.phases.length - 1].script, built.fill);
            // R-BA19: S2a = 20 blocks of 800 events [600 char, 50 Enter, 50 backspace, 50 indexAtSum, 50 sumBefore];
            // S2 = 20 groups of 250 non-reweight events [50 Enter, 50 backspace, 25 cut, 25 paste, 50 indexAtSum, 50 sumBefore]
            const stream = id === 'S2a' ? ev : ev.filter((e) => e[0] !== 0 && e[0] !== 3);
            const B = id === 'S2a' ? 800 : 250;
            const want = id === 'S2a' ? [600, 50, 50, 0, 0, 0, 50, 50] : [0, 50, 50, 0, 25, 25, 50, 50];
            assert.equal(stream.length, 20 * B, id + ' segmented events');
            for (let b = 0; b < 20; b++) {
                const cnt = [0, 0, 0, 0, 0, 0, 0, 0];
                let tr = 0;
                for (let t = b * B; t < (b + 1) * B; t++) { cnt[stream[t][0]]++; if (t > b * B && stream[t][0] !== stream[t - 1][0]) tr++; }
                assert.deepEqual(cnt, want, id + ' block ' + b + ' class counts');
                // a Fisher-Yates block changes class at ~42% (S2a) / ~80% (S2) of adjacent slots; an unshuffled block ~5
                assert.ok(tr >= B / 4, id + ' block ' + b + ' class transitions ' + tr + ': not shuffled');
            }
            // R-BA27 caret: d = pre(B) - post(A) over ADJACENT events that both reveal the caret exactly
            const near = [0, 0, 0, 0, 0, 0, 0];
            let far = 0, all = 0, sumW = 0, sumWide = 0, sumIn = 0, midZero = 0, midN = 0;
            const byPrev = new Map([[1, [0, 0]], [2, [0, 0]]]);
            for (let t = 1; t < ev.length; t++) {
                const a = ev[t - 1], b = ev[t];
                if (a[2] < 0) continue;
                if (b[0] === 7) { const e = b[3] - a[2]; sumW++; if (Math.abs(e) <= 53) sumIn++; if (Math.abs(e) > 40 && Math.abs(e) <= 53) sumWide++; continue; }
                if (b[1] < 0) continue;
                const d = b[1] - a[2];
                all++;
                if (Math.abs(d) > 3) { far++; continue; }
                // a char edit at c followed by a mid edit at c + 1 segments as ONE run, so B = mid under-counts d = +1: kept out of the step histogram
                if (b[0] !== 3) near[d + 3]++;
                if (byPrev.has(a[0])) { byPrev.get(a[0])[0] += d; byPrev.get(a[0])[1]++; }
                if (b[0] === 3) { midN++; if (d === 0) midZero++; }
            }
            const ends0 = ev.filter((e) => e[0] === 1 && e[4] >= 2 && e[3] === e[4]).length;
            console.log('# r1 ' + id + ' all=' + all + ' far=' + (far / all).toFixed(4) + ' near=' + near.map((x) => (x / near.reduce((p, y) => p + y, 0)).toFixed(3)) + ' prev=' + [...byPrev].map(([c, [s2, m2]]) => c + ':' + (s2 / m2).toFixed(3) + '/' + m2) + ' mid0=' + (midZero / midN).toFixed(3) + '/' + midN + ' sum=' + (sumIn / sumW).toFixed(3) + ',' + (sumWide / sumW).toFixed(3) + '/' + sumW + ' ends=' + ends0);
            assert.ok(all >= 10000, id + ' caret pairs ' + all + ': coverage floor');
            assert.ok(far / all >= 0.004 && far / all <= 0.02, id + ' caret jump share ' + far / all + ' (ruled 1%)');
            const nearN = near.reduce((x, y) => x + y, 0);
            for (let d = 0; d < 7; d++) assert.ok(Math.abs(near[d] / nearN - 1 / 7) <= 0.02, id + ' caret step ' + (d - 3) + ' share ' + near[d] / nearN);
            for (const [c, [s, m]] of byPrev) assert.ok(m >= 500 && Math.abs(s / m) <= 0.3, id + ' mean step after class ' + c + ' = ' + s / m + ' over ' + m + ' (Enter -> r + 1, backspace -> r - 1)');
            if (id === 'S2') assert.ok(midN >= 1000 && midZero / midN <= 0.25, 'mid edits: caret did not move first (d = 0 share ' + midZero / midN + ')');
            assert.ok(sumW >= 500 && sumIn / sumW >= 0.98 && sumWide / sumW >= 0.1, id + ' sumBefore window: in ' + sumIn / sumW + ', |e| in (40, 53] ' + sumWide / sumW);
            // R-BA23 column c uniform in [0, m - 1]: the end column c = m - 1 (x = m) occurs on rows with m >= 2
            const ends = ev.filter((e) => e[0] === 1 && e[4] >= 2 && e[3] === e[4]).length;
            assert.ok(ends >= 10, id + ' Enter at the line end (c = m - 1, m >= 2) seen ' + ends + ' times: coverage floor');
        });
    }
});
