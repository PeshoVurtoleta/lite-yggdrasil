/**
 * @zakkster/lite-yggdrasil -- S1a / S1b ("feed") scenario gate (node:test), Bench-ADOPT group g2b-2a TASK 5.
 *
 * Written FROM the PLAN ASSERTIONS A1-A4 (.handoff/PLAN-bench-adopt-g2b2a.md) and the maintainer rulings
 * R-BA16 (S1 mix) / R-BA19 (seeded Fisher-Yates block order). An INDEPENDENT oracle: it never imports the builder's
 * row model (seqModel); every "top" is test/oracle.mjs indexAtSum on a replayed oracle, every census is counted here.
 * Expected values come from the ruling text or hand arithmetic:
 *   per block of 1,000 events: 920 frames + 50 reweights + 30 structural (15 INSERT + 15 REMOVE) -> over the
 *   20,000-event stream (20 blocks): walk 18,400, reweight 1,000, edit 600 (300 + 300), blend 20,000;
 *   --quick (2,000 events, 2 blocks): 1,840 / 100 / 60 / 2,000.
 *   Frame jumps: 2% of 18,400 = 368 expected; |dy| > 512 happens only on a jump (a walk step is <= 512), and a
 *   jump lands within 512 of the old y with probability ~ 1025 / total ~ 0.6%, so the count is Binomial(18400, 0.02)
 *   (sd ~ 19): the gate [280, 460] is ~ +-4.5 sd.
 *   Fill heights at n 65536: 32 with p = 0.80 + 0.15 / 181 = 0.8008 (sd 0.0016, band +-0.01), 0 with p = 0.05
 *   (sd 0.00085, band +-0.005), every other value uniform in [20, 200].
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
const IDS = ['S1a', 'S1b'];
const PHASE_NAMES = ['walk', 'reweight', 'edit', 'blend'];
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

// The endState digest as documented on phaseEndState: fold length(), then sumBefore(0, i) at i = 0, step, ..., then n.
function endStateOf(o, n) {
    let x = fold(0x811c9dc5, o.length);
    const step = Math.max(1, n >> 6);
    for (let i = 0; i < n; i += step) x = fold(x, o.sumBefore(0, i));
    x = fold(x, o.sumBefore(0, n));
    return x >>> 0;
}

function oracleFilled(fill, n) {
    const o = new Oracle(1);
    for (let i = 0; i < n; i++) o.insertAt(i, i, fill[i]);
    return o;
}

function oracleWalk(o, d, y, k) {
    const c = o.cursor();
    if (!c.seekSum(d, y)) return 0;
    let sum = c.measure(d);
    for (let s = 1; s < k && c.next(); s++) sum += c.measure(d);
    return sum;
}

// shift: when true every INSERT lands one row later (the must-fail mutant), clamped to the current length.
function oracleRun(o, script, shift) {
    let acc = 0;
    for (let k = 0; k < script.length; k += REC) {
        const a = script[k + 1];
        const b = script[k + 2];
        const c = script[k + 3];
        switch (script[k]) {
            case OP.INSERT: { const at = shift && a < o.length ? a + 1 : a; o.insertAt(at, at, b); break; }
            case OP.REMOVE: o.removeAt(a); break;
            case OP.SET: o.setMeasure(a, b, c); break;
            case OP.SEEK: acc = (acc + o.indexAtSum(a, b)) | 0; break;
            case OP.SUM: acc = (acc + o.sumBefore(a, b)) | 0; break;
            case OP.WALK: acc = (acc + oracleWalk(o, a, b, c)) | 0; break;
            default: throw new Error('test: unknown opcode ' + script[k]);
        }
    }
    return acc;
}

const buildMemo = new Map();
function build(id, n, events) {
    const key = id + '/' + n + '/' + String(events);
    if (!buildMemo.has(key)) buildMemo.set(key, sc(id).build(null, n, SEED, events));
    return buildMemo.get(key);
}

const wantMemo = new Map();
// Per phase: oracle checksum, endState, FNV traceHash, replayed on a fresh oracle fill (and the final oracle).
function wants(id, n, shift) {
    const key = id + '/' + n + '/' + String(shift);
    if (wantMemo.has(key)) return wantMemo.get(key);
    const built = build(id, n);
    const out = new Map();
    for (const p of built.phases) {
        const o = oracleFilled(built.fill, n);
        const checksum = oracleRun(o, p.script, shift);
        out.set(p.name, { checksum, endState: endStateOf(o, o.length), length: o.length, traceHash: fnv(built.fill, p.script) });
    }
    wantMemo.set(key, out);
    return out;
}

// ---- registry ---------------------------------------------------------------------------------------------------

describe('S1 registry (R-BA16): shape of the two entries', () => {
    test('S1a and S1b are registered before S7, dims 1, views 1, the five S7 adapters, the ruled sizes, phases in order', () => {
        const ids = SCENARIOS.map((s) => s.id);
        assert.ok(ids.indexOf('S1a') >= 0 && ids.indexOf('S1b') > ids.indexOf('S1a') && ids.indexOf('S1a') < ids.indexOf('S7'));
        const sizes = [1024, 2048, 4096, 8192, 16384, 32768, 65536, 100000, 131072, 262144, 524288, 1000000];
        for (const id of IDS) {
            const s = sc(id);
            assert.equal(s.dims, 1);
            assert.equal(s.views, 1);
            assert.deepEqual([...s.sizes], sizes, id + ' sizes (2^10..2^19, 100000, 1000000)');
            assert.deepEqual([...s.adapters], [...sc('S7').adapters], id + ' adapters');
            assert.deepEqual(build(id, 1024, BLOCK_EVENTS).phases.map((p) => p.name), PHASE_NAMES);
        }
    });
    test('S1a and S1b are different, deterministic streams (distinct salts; same seed -> same bytes)', () => {
        const a = sc('S1a').build(null, 1024, SEED, BLOCK_EVENTS);
        const a2 = sc('S1a').build(null, 1024, SEED, BLOCK_EVENTS);
        const b = sc('S1b').build(null, 1024, SEED, BLOCK_EVENTS);
        const c = sc('S1a').build(null, 1024, SEED + 1, BLOCK_EVENTS);
        assert.deepEqual(a.fill, a2.fill);
        assert.deepEqual(a.phases[3].script, a2.phases[3].script);
        assert.notDeepEqual(a.fill, b.fill);
        assert.notDeepEqual(a.phases[3].script, b.phases[3].script);
        assert.notDeepEqual(a.phases[3].script, c.phases[3].script, 'a different seed gives a different stream');
    });
});

// ---- A1 ----------------------------------------------------------------------------------------------------------

describe('A1: all five labels and the oracle agree per phase (S1a, S1b at n 1024 and 4096, 20,000 events)', () => {
    for (const id of IDS) {
        for (const n of [1024, 4096]) {
            test('A1: ' + id + ' @ ' + n + ': checksum + endState + traceHash identical across labels and equal to the oracle', async () => {
                assert.equal(sc(id).adapters.length, 5);
                const built = build(id, n);
                const w = wants(id, n, false);
                for (const label of sc(id).adapters) {
                    const r = await runScenario(label, sc(id), n, { seed: SEED, samples: 1 });
                    assert.equal(r.phases.length, 4);
                    for (const p of built.phases) {
                        const row = r.phases.find((x) => x.phase === p.name);
                        const want = w.get(p.name);
                        assert.equal(row.checksum, want.checksum, label + ' ' + p.name + ' checksum vs oracle');
                        assert.equal(row.endState, want.endState, label + ' ' + p.name + ' endState vs oracle');
                        assert.equal(row.traceHash, want.traceHash, label + ' ' + p.name + ' traceHash vs independent FNV-1a');
                    }
                }
                // not vacuous: the frame phases read a non-zero sum (a walk of 30 rows of heights >= 0)
                assert.notEqual(w.get('walk').checksum, 0);
                assert.notEqual(w.get('blend').checksum, 0);
            });
        }
    }

    test('A1 must-fail: an oracle replay with each S1b INSERT shifted to i + 1 changes >= 1 endState (control: S1a cannot shift)', () => {
        let changed = 0;
        for (const n of [1024, 4096]) {
            const base = wants('S1b', n, false);
            const mut = wants('S1b', n, true);
            for (const name of ['edit', 'blend']) if (mut.get(name).endState !== base.get(name).endState) changed++;
        }
        assert.ok(changed >= 1, 'the shifted-insert mutant survived every endState');
        // control: S1a inserts at the current length, so the shift clamps to a no-op and no endState may change
        for (const name of ['edit', 'blend']) {
            assert.equal(wants('S1a', 1024, true).get(name).endState, wants('S1a', 1024, false).get(name).endState, name);
        }
    });
});

// ---- A2 ----------------------------------------------------------------------------------------------------------

// One pass over the blend on a replayed oracle: window, length and frame checks (all independent of the builder).
function blendCensus(id, n) {
    const built = build(id, n);
    const blend = built.phases.find((p) => p.name === 'blend').script;
    const o = oracleFilled(built.fill, n);
    const c = { frames: 0, sets: 0, ins: 0, rem: 0, checked: 0, skipped: 0, bigDy: 0, nearDy: 0, minOff: 1e9, maxOff: -1e9, insMin: 1e9, insMax: -1e9, remMin: 1e9, remMax: -1e9, errs: [], lenOk: true,
        heights: [], seq: [] };
    let y = -1;
    for (let k = 0, r = 0; k < blend.length; k += REC, r++) {
        const op = blend[k];
        const a = blend[k + 1];
        const b = blend[k + 2];
        const cc = blend[k + 3];
        const len = o.length;
        const total = o.total(0);
        if (op === OP.WALK) {
            c.frames++;
            if (a !== 0 || cc !== 30 || !(b >= 0 && b < total)) c.errs.push('frame ' + r + ' ' + [a, b, cc]);
            if (y >= 0 && Math.abs(b - y) > 512) c.bigDy++;
            if (y >= 0 && Math.abs(b - y) > 512 && Math.abs(b - y) <= 520) c.nearDy++;
            y = b;
            continue;
        }
        let top = -1;
        if (y >= 0) top = o.indexAtSum(0, Math.min(y, total - 1));
        const lo = top < 0 ? 0 : Math.max(0, top - 8);
        if (op === OP.SET) {
            c.sets++;
            if (b !== 0 || !(a >= 0 && a < len)) c.errs.push('set shape ' + r + ' ' + [a, b, cc]);
            c.heights.push(cc);
            if (top >= 0) {
                c.checked++;
                if (a < lo || a > Math.min(top + 38, len - 1)) c.errs.push('set window ' + r + ' i ' + a + ' top ' + top);
                c.minOff = Math.min(c.minOff, a - top);
                c.maxOff = Math.max(c.maxOff, a - top);
            } else c.skipped++;
            o.setMeasure(a, 0, cc);
        } else if (op === OP.INSERT) {
            c.ins++;
            c.seq.push('I');
            if (cc !== 0 || !(a >= 0 && a <= len)) c.errs.push('insert shape ' + r + ' ' + [a, b, cc]);
            c.heights.push(b);
            if (id === 'S1a') { if (a !== len) c.errs.push('S1a insert ' + r + ' at ' + a + ' len ' + len); }
            else if (top >= 0) {
                if (a < lo || a > Math.min(top + 38, len)) c.errs.push('S1b insert window ' + r + ' i ' + a + ' top ' + top);
                c.insMin = Math.min(c.insMin, a - top);
                c.insMax = Math.max(c.insMax, a - top);
            }
            o.insertAt(a, a, b);
        } else if (op === OP.REMOVE) {
            c.rem++;
            c.seq.push('R');
            if (b !== 0 || cc !== 0 || !(a >= 0 && a < len)) c.errs.push('remove shape ' + r + ' ' + [a, b, cc]);
            if (id === 'S1a') { if (a !== 0) c.errs.push('S1a remove ' + r + ' at ' + a); }
            else if (top >= 0) {
                if (a < lo || a > Math.min(top + 38, len - 1)) c.errs.push('S1b remove window ' + r + ' i ' + a + ' top ' + top);
                c.remMin = Math.min(c.remMin, a - top);
                c.remMax = Math.max(c.remMax, a - top);
            }
            o.removeAt(a);
        } else c.errs.push('opcode ' + op + ' at ' + r);
        if (o.length < n || o.length > n + 1) c.lenOk = false;
    }
    c.endLength = o.length;
    return c;
}

describe('A2: counts, order, windows, census', () => {
    for (const id of IDS) {
        test('A2: ' + id + ' @ 1024: events = ops per phase (20,000 stream and --quick), length() === n after every phase', () => {
            const want = { walk: 18400, reweight: 1000, edit: 600, blend: 20000 };
            const quick = { walk: 1840, reweight: 100, edit: 60, blend: 2000 };
            assert.equal(STREAM_EVENTS, 20000);
            assert.equal(scenarioEvents(true), 2000);
            for (const [ev, exp] of [[undefined, want], [scenarioEvents(true), quick]]) {
                const built = sc(id).build(null, 1024, SEED, ev);
                assert.equal(built.capacity, 1025, 'capacity n + 1');
                assert.deepEqual(built.phases.map((p) => p.name), PHASE_NAMES);
                for (const p of built.phases) {
                    assert.equal(p.events, exp[p.name], id + ' ' + p.name + ' events');
                    assert.equal(p.script.length / REC, exp[p.name], id + ' ' + p.name + ' ops');
                }
                // every phase replays on a fresh fill: length n after the phase, in [n, n + 1] after every record
                for (const p of built.phases) {
                    const o = oracleFilled(built.fill, 1024);
                    for (let k = 0; k < p.script.length; k += REC) {
                        oracleRun(o, p.script.subarray(k, k + REC), false);
                        assert.ok(o.length >= 1024 && o.length <= 1025, id + ' ' + p.name + ' record ' + k / REC + ' length ' + o.length);
                    }
                    assert.equal(o.length, 1024, id + ' ' + p.name + ' final length');
                }
            }
        });

        test('A2: ' + id + ' phases are the class-filtered subsequences of the blend; edit alternates INSERT, REMOVE (insert first)', () => {
            const built = build(id, 1024);
            const blend = built.phases[3].script;
            for (const p of built.phases.slice(0, 3)) {
                const exp = [];
                for (let k = 0; k < blend.length; k += REC) if (PHASE_CLASS[blend[k]] === p.name) exp.push(...blend.subarray(k, k + REC));
                assert.deepEqual([...p.script], exp, id + ' ' + p.name + ' = blend filtered by class');
            }
            const edit = built.phases[2].script;
            let ins = 0;
            for (let k = 0; k < edit.length; k += REC) {
                assert.equal(edit[k], (k / REC) % 2 === 0 ? OP.INSERT : OP.REMOVE, 'edit record ' + k / REC);
                if (edit[k] === OP.INSERT) ins++;
            }
            assert.equal(ins, 300);
            for (const p of built.phases.slice(0, 2)) {
                const want = p.name === 'walk' ? OP.WALK : OP.SET;
                for (let k = 0; k < p.script.length; k += REC) assert.equal(p.script[k], want, id + ' ' + p.name + ' record ' + k / REC);
            }
        });

        test('A2: ' + id + ' @ 4096 blend: indexes, windows, length in [n, n + 1] after every record, |dy| > 512 frames in [280, 460]', () => {
            const c = blendCensus(id, 4096);
            assert.deepEqual(c.errs.slice(0, 5), [], 'first violations');
            assert.equal(c.frames, 18400);
            assert.equal(c.sets, 1000);
            assert.equal(c.ins, 300);
            assert.equal(c.rem, 300);
            assert.equal(c.lenOk, true, 'length left [n, n + 1]');
            assert.equal(c.endLength, 4096);
            assert.ok(c.bigDy >= 280 && c.bigDy <= 460, 'frames with |dy| > 512: ' + c.bigDy);
            // coverage floor: the window check saw (nearly) every reweight, and the offsets spread over the window
            assert.ok(c.checked >= 990, 'window-checked reweights: ' + c.checked + ' skipped ' + c.skipped);
            // exact window edges: [top - 8, top + 38] reached on both sides (a 46- or 48-wide window is caught)
            assert.equal(c.minOff, -8, 'SET min offset');
            assert.equal(c.maxOff, 38, 'SET max offset');
            if (id === 'S1b') {
                console.log('# offsets ' + id + ' ins [' + c.insMin + ', ' + c.insMax + '] rem [' + c.remMin + ', ' + c.remMax + ']');
                assert.equal(c.insMin, -8, 'INSERT min offset');
                assert.equal(c.insMax, 38, 'INSERT max offset');
                assert.equal(c.remMin, -8, 'REMOVE min offset');
                assert.equal(c.remMax, 38, 'REMOVE max offset');
            }
            // a walk step is <= 512: frames with 512 < |dy| <= 520 are only the rare jump that lands near (kills a step-513 mutant)
            assert.ok(c.nearDy <= 2, 'frames with 512 < |dy| <= 520: ' + c.nearDy);
            // alternation in stream order, insert first
            for (let j = 0; j < c.seq.length; j++) assert.equal(c.seq[j], j % 2 === 0 ? 'I' : 'R', 'structural ' + j);
            // heights of reweights and inserts are 0 or in [20, 200]; mix is 80% 32 / 5% 0 (loose, 1,300 samples)
            let n32 = 0;
            let n0 = 0;
            for (const h of c.heights) {
                assert.ok(h === 0 || (h >= 20 && h <= 200), 'height ' + h);
                if (h === 32) n32++;
                if (h === 0) n0++;
            }
            assert.equal(c.heights.length, 1300);
            assert.ok(n32 / 1300 >= 0.72 && n32 / 1300 <= 0.88, '32 share ' + n32 / 1300);
            assert.ok(n0 / 1300 >= 0.02 && n0 / 1300 <= 0.09, 'zero share ' + n0 / 1300);
        });

        test('A2: ' + id + ' every 1,000-record block holds exactly 920 / 50 / 30 (15 + 15), placed by a shuffle (R-BA19)', () => {
            const blend = build(id, 4096).phases[3].script;
            const sigs = new Set();
            let early = 0;
            for (let b = 0; b < 20; b++) {
                let f = 0;
                let s = 0;
                let i = 0;
                let r = 0;
                let sig = '';
                for (let j = 0; j < BLOCK_EVENTS; j++) {
                    const op = blend[(b * BLOCK_EVENTS + j) * REC];
                    if (op === OP.WALK) { f++; sig += 'f'; } else if (op === OP.SET) { s++; sig += 's'; } else {
                        if (op === OP.INSERT) i++; else r++;
                        sig += 'x';
                        if (j < BLOCK_EVENTS / 2) early++;
                    }
                }
                assert.deepEqual([f, s, i, r], [920, 50, 15, 15], 'block ' + b);
                sigs.add(sig);
            }
            assert.equal(sigs.size, 20, 'twenty different class placements (a fixed or even-spread order would repeat)');
            // hypergeometric: 30 structural per block, mean 15 in the first half; 20 blocks -> 300, sd ~ 12
            assert.ok(early >= 240 && early <= 360, 'structural ops in block first halves: ' + early);
        });

        test('A2: ' + id + ' reweight and edit phases replay in range on a fresh fill (indexes valid, S1a at length / 0)', () => {
            for (const n of [1024, 4096]) {
                const built = build(id, n);
                for (const p of built.phases.slice(1, 3)) {
                    const o = oracleFilled(built.fill, n);
                    for (let k = 0; k < p.script.length; k += REC) {
                        const op = p.script[k];
                        const a = p.script[k + 1];
                        if (op === OP.SET) assert.ok(a >= 0 && a < o.length, p.name + ' SET ' + a);
                        else if (op === OP.INSERT) {
                            assert.ok(a >= 0 && a <= o.length, p.name + ' INSERT ' + a);
                            if (id === 'S1a') assert.equal(a, o.length);
                        } else {
                            assert.ok(a >= 0 && a < o.length, p.name + ' REMOVE ' + a);
                            if (id === 'S1a') assert.equal(a, 0);
                        }
                        oracleRun(o, p.script.subarray(k, k + REC), false);
                    }
                    assert.equal(o.length, n);
                }
            }
        });

        test('A2: ' + id + ' fill @ 65536: 32s in [0.79, 0.81], zeros in [0.045, 0.055], every other value in [20, 200]', () => {
            const n = 65536;
            const built = sc(id).build(null, n, SEED, BLOCK_EVENTS);
            assert.equal(built.fill.length, n);
            let n32 = 0;
            let n0 = 0;
            for (let i = 0; i < n; i++) {
                const h = built.fill[i];
                if (h === 32) n32++;
                else if (h === 0) n0++;
                else assert.ok(h >= 20 && h <= 200, 'fill[' + i + '] = ' + h);
            }
            assert.ok(n32 / n >= 0.79 && n32 / n <= 0.81, '32 share ' + n32 / n);
            assert.ok(n0 / n >= 0.045 && n0 / n <= 0.055, 'zero share ' + n0 / n);
            // exact replay of the fill from plan TASK 2 + R-BA16 (salt 0x51a / 0x51b, u = uni(100): <80 -> 32, <95 -> 20 + uni(181), else 0)
            const rr = prng((SEED ^ Math.imul(n, 0x9e3779b1) ^ (id === 'S1b' ? 0x51b : 0x51a)) >>> 0);
            const uni = (m) => Math.floor((rr() / 4294967296) * m);
            for (let i = 0; i < n; i++) {
                const u = uni(100);
                const want = u < 80 ? 32 : u < 95 ? 20 + uni(181) : 0;
                if (built.fill[i] !== want) assert.fail('fill[' + i + '] = ' + built.fill[i] + ', replay ' + want);
            }
        });
    }
});

// ---- A3 + A4: the --expose-gc child (BA-7a precedent) -------------------------------------------------------------

async function childMain(u) {
    const SC = await import(u.scn);
    const M = await import(u.meter);
    const L = await import(u.leak);
    const G = await import(u.prof);
    const out = { semi: M.semiSpaceOk(), lanes: [], controls: [], gc: null, leak: null, ctlRetain: null };
    if (!out.semi) return out;
    const tick = (ms) => new Promise((r) => setTimeout(r, ms));
    const settle = async () => { globalThis.gc(); await tick(20); globalThis.gc(); await tick(20); };
    const N = 4096;
    const EV = 20000;
    const WIN = 6;
    const KC = 16; // calls per window: a 1-call window plus a memoized baseline drifts +-16 B and can under-read
    const T = SC.OP;
    const LABELS = u.labels;
    const IOUT = new Int32Array(4);
    const bases = new Map();
    const base = (ops) => { if (!bases.has(ops)) bases.set(ops, M.baseline(ops, WIN)); return bases.get(ops); };
    const prof = new G.GcProfiler();
    prof.start();
    const gate = { enter: () => { prof.enter('lanes'); }, exit: () => { prof.exit(); } };
    for (const sid of u.ids) {
        const scn = SC.SCENARIOS.find((s) => s.id === sid);
        const built = scn.build(null, N, u.seed, EV);
        for (const label of LABELS) {
            const ad = await SC.resolveLabel(label);
            const partner = SC.appendPartner(ad, 1);
            const h = ad.create(built.capacity, 1);
            for (const p of built.phases) {
                if (u.only && p.name !== u.only) continue;
                // every S1 script is length-neutral and valid on any state of length n..n+1: one fill per lane, no refill
                SC.fillHandle(h, built.fill, N, 1, partner);
                const ops = p.script.length / 4;
                // edit lanes warm >= 2000 calls: rare-path tier-up of the BlockedArray split / merge path (a warm floor, not a limit change)
                const calls = u.warm !== undefined ? u.warm : Math.max(p.name === 'edit' ? 2000 : 60, Math.ceil(1e5 / ops));
                for (let w = 0; w < calls; w++) IOUT[0] = SC.runScript(h, p.script);
                const r = M.lane(sid + '.' + label + '.' + p.name, () => { IOUT[0] = SC.runScript(h, p.script); }, KC, WIN, undefined, gate);
                const perCall = M.bop(r, base(KC));
                out.lanes.push({ name: r.name, ops, calls, warmRecords: calls * ops, perCall, bop: perCall / ops, wins: M.winText(r, base(KC)) });
            }
            h.clear();
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
    const allocScript = (h, script) => {
        let acc = 0;
        for (let k = 0; k < script.length; k += 4) {
            HOLD[(k >> 2) & 1] = new Int32Array(1);
            const op = script[k];
            if (op === T.WALK) acc = (acc + h.cursorWalkSum(script[k + 1], script[k + 2], script[k + 3])) | 0;
            else if (op === T.SET) h.setMeasure(script[k + 1], script[k + 2], script[k + 3]);
            else if (op === T.INSERT) h.insertAt(script[k + 1], script[k + 1], script[k + 2], script[k + 3]);
            else if (op === T.REMOVE) h.removeAt(script[k + 1]);
        }
        return acc;
    };
    const b1 = SC.SCENARIOS.find((s2) => s2.id === 'S1b').build(null, N, u.seed, EV);
    const ssA = await SC.resolveLabel('SumSequence');
    const ch = ssA.create(b1.capacity, 1);
    // a 2,000-record prefix of the blend (20,000 allocating records GC in every window and read NaN); refilled per window
    const cref = b1.phases.find((p) => p.name === 'blend').script.subarray(0, 8000);
    const crefn = cref.length / 4;
    const crefill = () => SC.fillHandle(ch, b1.fill, N, 1, null);
    crefill();
    IOUT[0] = allocScript(ch, cref);
    const cr = M.lane('ctl.allocPerOp', () => { IOUT[0] = allocScript(ch, cref); }, 1, WIN, crefill);
    out.controls.push({ name: cr.name, perCall: M.bop(cr, base(1)), bop: M.bop(cr, base(1)) / crefn, wins: M.winText(cr, base(1)) });
    // must-fail control 2: exactly ONE 16 B box per runScript CALL (PC.v starts null, so the field is tagged and every
    // non-Smi store boxes), on ALL labels with the S1b edit script, warmed and measured like the real edit lanes.
    const PC = { v: null };
    const perCallScript = (h, script) => { const a = SC.runScript(h, script); PC.v = a + 0.5; return a; };
    out.pcControls = [];
    const editScript = b1.phases.find((p) => p.name === 'edit').script;
    for (const label of LABELS) {
        const ad = await SC.resolveLabel(label);
        const partner = SC.appendPartner(ad, 1);
        const hh = ad.create(b1.capacity, 1);
        SC.fillHandle(hh, b1.fill, N, 1, partner);
        for (let w = 0; w < 2000; w++) IOUT[0] = perCallScript(hh, editScript);
        const cp = M.lane('ctl.allocPerCall.' + label, () => { IOUT[0] = perCallScript(hh, editScript); }, KC, WIN);
        const pcall = M.bop(cp, base(KC));
        out.pcControls.push({ name: cp.name, perCall: pcall, bop: pcall / (editScript.length / 4), wins: M.winText(cp, base(KC)) });
        hh.clear();
        partner && partner.clear();
    }

    // ---- A4: 100 cycles per label of create(n + 1, 1) -> fill -> S1b blend -> clear -> drop
    const K = new Int32Array(2);
    const onFin = () => { K[0]++; };
    const SN = 64;
    const small = SC.SCENARIOS.find((s2) => s2.id === 'S1b').build(null, SN, u.seed, 1000);
    const blendSmall = small.phases.find((p) => p.name === 'blend').script;
    const leakRun = async (retain) => {
        K[0] = 0; K[1] = 0;
        const tracker = L.createLeakTracker({ name: retain ? 'feed-ctl' : 'feed', onLeak: () => {}, onWarning: () => {} });
        const refs = [];
        const kept = [];
        for (const label of LABELS) {
            const ad = await SC.resolveLabel(label);
            // one cycle per call: no local of a finished cycle survives on the stack to pin its handle
            const cycle = () => {
                const h = ad.create(small.capacity, 1);
                const hv = tracker.track(h, onFin, label + '.handle');
                const hi = tracker.track(h.instance, onFin, label + '.instance');
                refs.push(new WeakRef(h), new WeakRef(h.instance));
                SC.fillHandle(h, small.fill, SN, 1, null);
                IOUT[0] = SC.runScript(h, blendSmall);
                if (!retain) h.clear();
                if (h.length() === 0) { tracker.untrack(hv); tracker.untrack(hi); } else K[1]++;
                if (retain) kept.push(h);
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

let childResult = null;
function runChild(over) {
    if (!over && childResult) return childResult;
    const u = {
        scn: new URL('../benchmark/Scenarios.mjs', import.meta.url).href,
        meter: new URL('./torture-meter.mjs', import.meta.url).href,
        seed: SEED, ids: IDS, labels: [...SCENARIOS.find((s) => s.id === 'S1a').adapters],
        leak: import.meta.resolve('@zakkster/lite-leak'), prof: import.meta.resolve('@zakkster/lite-gc-profiler'),
    };
    Object.assign(u, over);
    const code = '(' + childMain.toString() + ')(' + JSON.stringify(u) + ').then((r) => { process.stdout.write("RESULT " + JSON.stringify(r) + "\\n"); },' +
        ' (e) => { process.stderr.write(String(e && e.stack || e)); process.exit(1); });';
    const r = spawnSync(process.execPath, ['--expose-gc', '--no-concurrent-recompilation', '--min-semi-space-size=4',
        '--max-semi-space-size=4', '--input-type=module', '-e', code], { cwd: PKG, encoding: 'utf8', timeout: 540000, maxBuffer: 1 << 26 });
    assert.equal(r.status, 0, 'child failed: ' + r.stderr + r.stdout.slice(-800));
    const line = r.stdout.split('\n').find((l) => l.startsWith('RESULT '));
    assert.ok(line, 'child printed no RESULT line: ' + r.stdout);
    const res = JSON.parse(line.slice(7));
    if (over) return res;
    childResult = res;
    return childResult;
}

describe('A3 / A4: the --expose-gc child (BA-7a precedent), S1a + S1b', () => {
    test('A3: runScript, 2 scenarios x 4 phases x 5 labels at n 4096 / 20,000 events: < 8 B per call (K = 16) AND < 1 B per op, maxMajor 0; controls fail', () => {
        const r = runChild();
        assert.equal(r.semi, true, 'semi-space flags not pinned in the child');
        for (const l of r.lanes) console.log('# lane ' + l.name + ' perCall=' + String(l.perCall) + ' bop=' + String(l.bop) + ' [' + l.wins + ']');
        for (const l of r.controls) console.log('# control ' + l.name + ' perCall=' + String(l.perCall) + ' bop=' + String(l.bop) + ' [' + l.wins + ']');
        assert.equal(r.lanes.length, 40);
        const want = { walk: 18400, reweight: 1000, edit: 600, blend: 20000 };
        for (const l of r.lanes) {
            const phase = l.name.slice(l.name.lastIndexOf('.') + 1);
            assert.equal(l.ops, want[phase], l.name + ' ops');
            assert.equal(l.calls, Math.max(phase === 'edit' ? 2000 : 60, Math.ceil(1e5 / l.ops)), l.name + ' warm calls');
            assert.ok(l.warmRecords >= 100000, l.name + ' warmed only ' + l.warmRecords + ' records');
            // JSON carries NaN (no gated window) as null: a non-number reading fails closed
            assert.ok(typeof l.perCall === 'number' && l.perCall > -2 && l.perCall < 8, // < 16 per the plan; 8 because one 16 B box per call reads 15 (baseline drift of 1 B per call at K = 16)
                 l.name + ' perCall ' + l.perCall);
            assert.ok(typeof l.bop === 'number' && l.bop < 1, l.name + ' bop ' + l.bop);
        }
        assert.equal(r.gc.ok, true, 'gc region: ' + JSON.stringify(r.gc));
        assert.equal(r.gc.major, 0);
        assert.equal(r.controls.length, 1);
        assert.ok(typeof r.controls[0].bop === 'number' && r.controls[0].bop > 8, 'allocating runScript must read > 8 B/op, read ' + r.controls[0].bop);
        // must-fail control: one 16 B box per runScript CALL on every label reads < 1 B/op but must FAIL the per-call floor
        assert.equal(r.pcControls.length, 5);
        for (const pc of r.pcControls) {
            console.log('# control ' + pc.name + ' perCall=' + String(pc.perCall) + ' bop=' + String(pc.bop) + ' [' + pc.wins + ']');
            assert.ok(typeof pc.bop === 'number' && pc.bop < 1, pc.name + ' must read < 1 B/op, read ' + pc.bop);
            assert.ok(typeof pc.perCall === 'number' && !(pc.perCall < 8), pc.name + ' must FAIL perCall < 8 (one 16 B box reads ~15), read ' + pc.perCall);
        }
    });

    test('A3: cold check -- with 2 warm calls a BlockedArray edit lane reads >= 16 B per call (the warm-up is what keeps the lanes clean)', () => {
        const labels = SCENARIOS.find((s) => s.id === 'S1a').adapters.filter((l) => l.startsWith('BlockedArray'));
        assert.ok(labels.length >= 1);
        const r = runChild({ warm: 2, only: 'edit', labels, ids: ['S1a', 'S1b'] });
        assert.equal(r.semi, true);
        assert.equal(r.lanes.length, labels.length * 2);
        for (const l of r.lanes) console.log('# cold ' + l.name + ' perCall=' + String(l.perCall));
        assert.ok(r.lanes.some((l) => typeof l.perCall === 'number' && l.perCall >= 16), 'no cold edit lane read >= 16 B per call');
    });

    // A4: the retention proof is the WeakRef `alive` count (size() reaches 0 because the test untracks after clear()).
    test('A4: 100 cycles per label of create(n + 1, 1) -> fill -> S1b blend -> clear -> drop: tracker.size() 0; retaining control >= 1', () => {
        const r = runChild();
        console.log('# leak ' + JSON.stringify(r.leak) + ' ctl ' + JSON.stringify(r.ctlRetain));
        assert.equal(r.leak.tracked, 5 * 100 * 2);
        assert.deepEqual([r.leak.size, r.leak.alive, r.leak.fin, r.leak.notReset], [0, 0, 0, 0]);
        assert.ok(r.ctlRetain.size >= 1, 'retaining control must leave size() >= 1');
        assert.ok(r.ctlRetain.alive >= 1, 'retaining control must keep handles alive');
    });
});
