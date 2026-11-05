/**
 * @zakkster/lite-yggdrasil -- scenario contract gate (node:test), Bench-ADOPT group 2b-1 TASK 8.
 *
 * Written FROM the PLAN ASSERTIONS A1-A5 (.handoff/PLAN-bench-adopt-g2b1.md) and the maintainer
 * rulings R-BA15 (scenario shape) / R-BA18 (S7 / S7b mix). Every expected value comes from the
 * ruling text, hand arithmetic or test/oracle.mjs driven by an interpreter written in THIS file --
 * never from the runner's own output. Mix arithmetic (R-BA18, 20 blocks of 1,000 events = 20,000):
 *   S7  : 500 draws + 500 reweights per block -> seek 10,000, reweight 10,000, blend 20,000.
 *   S7b : 950 draws +  50 reweights per block -> seek 19,000, reweight  1,000, blend 20,000.
 * Deterministic: pinned seeds, no timing in any assertion. Test harness only, never shipped.
 * ASCII only. MIT (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, cpSync, symlinkSync, readFileSync, writeFileSync, rmSync, realpathSync, mkdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Oracle } from './oracle.mjs';
import {
    validateBuilt, SCENARIOS, PHASES, OP, REC, validateScenario, selectScenario, runScript, runScenario, resolveLabel,
    fillHandle, appendPartner, scenarioEvents, phasesFrom,
} from '../benchmark/Scenarios.mjs';
import {
    ADAPTERS, SumSequenceAdapter, BlockedArrayAdapter, FenwickSuffixAdapter, FenwickFullAdapter,
    validateAdapter, blockedArrayAdapter, selectAdapter, countsRecord, NC,
} from '../benchmark/Adapters.mjs';
import { cells } from '../benchmark/Matrix.mjs';
import { DEFAULT_SEED } from '../benchmark/Harness.mjs';
import { meter, METER_REASON } from './meter-gate.mjs';
import { variantSource, loadVariant } from '../benchmark/rivals/variant.mjs';

const PKG = fileURLToPath(new URL('..', import.meta.url));
const S7 = SCENARIOS.find((s) => s.id === 'S7');
const S7B = SCENARIOS.find((s) => s.id === 'S7b');
const SEED = DEFAULT_SEED;

// ---- independent helpers (nothing below calls the runner) -------------------------------------------------

// FNV-1a over the fill then the script, 32-bit exact (the published algorithm, not the runner's foldHash).
function fnv(fill, script) {
    let h = 0x811c9dc5;
    for (const arr of [fill, script]) {
        for (let j = 0; j < arr.length; j++) {
            h = (h ^ (arr[j] | 0)) >>> 0;
            h = Math.imul(h, 16777619) >>> 0;
        }
    }
    return h >>> 0;
}

function oracleFilled(fill, n, dims) {
    const o = new Oracle(dims);
    for (let i = 0; i < n; i++) {
        if (dims === 1) o.insertAt(i, i, fill[i]);
        else o.insertAt(i, i, fill[i * dims], fill[i * dims + 1]);
    }
    return o;
}

// Brute-force cursorWalkSum: seekSum(d, y), then up to k - 1 next(), the sum of measure(d) over the visited rows.
function oracleWalk(o, d, y, k) {
    const c = o.cursor();
    if (!c.seekSum(d, y)) return 0;
    let sum = c.measure(d);
    for (let s = 1; s < k && c.next(); s++) sum += c.measure(d);
    return sum;
}

// The oracle-side script interpreter (own opcode switch over the published table in the R-BA15 ruling text, plus
// SPLIT / APPEND from R-BA21: ov = [main, clip, tail] Oracle views, main = ov[0] = o).
function oracleRun(o, dims, script, ov) {
    let acc = 0;
    for (let k = 0; k < script.length; k += REC) {
        const a = script[k + 1];
        const b = script[k + 2];
        const c = script[k + 3];
        switch (script[k]) {
            case OP.INSERT: if (dims === 1) o.insertAt(a, a, b); else o.insertAt(a, a, b, c); break;
            case OP.REMOVE: o.removeAt(a); break;
            case OP.SET: o.setMeasure(a, b, c); break;
            case OP.SEEK: acc = (acc + o.indexAtSum(a, b)) | 0; break;
            case OP.SUM: acc = (acc + o.sumBefore(a, b)) | 0; break;
            case OP.WALK: acc = (acc + oracleWalk(o, a, b, c)) | 0; break;
            case 7: o.splitAt(a, ov[b]); break;
            case 8: o.append(ov[a]); break;
            default: throw new Error('test: unknown opcode ' + script[k]);
        }
    }
    return acc;
}

function build(sc, n, events) {
    return sc.build(null, n, SEED, events);
}

async function handleFor(label, built, n, dims, views = 1) {
    const ad = await resolveLabel(label);
    const h = views === 1 ? ad.create(built.capacity, dims) : ad.createViews(built.capacity, dims, views)[views - 1];
    fillHandle(h, built.fill, n, dims, views === 1 ? appendPartner(ad, dims) : null);
    return { ad, h };
}

// ---- A1 ----------------------------------------------------------------------------------------------------

describe('A1: every adapter and the oracle agree per phase (S7, S7b at n 1024 and 4096)', () => {
    test('A1: S7 / S7b list exactly the R-BA18 adapters + the BA-29 twin (BlockedArray unrolled + plain + twin, Fenwick suffix + full)', () => {
        for (const sc of [S7, S7B]) {
            assert.equal(sc.adapters.length, 6);
            assert.ok(sc.adapters.includes('SumSequence'));
            assert.ok(sc.adapters.includes('BlockedArray.plain'));
            assert.ok(sc.adapters.includes('BlockedArray.twin'));
            assert.ok(sc.adapters.includes('FenwickRebuild.suffix'));
            assert.ok(sc.adapters.includes('FenwickRebuild.full'));
            assert.equal(sc.adapters.filter((a) => a.startsWith('BlockedArray')).length, 3);
            assert.ok(!sc.adapters.includes('SpliceFoil'));
            assert.ok(!sc.adapters.includes('FenwickFixed'));
        }
    });

    for (const sc of [S7, S7B]) {
        for (const n of [1024, 4096]) {
            test('A1: ' + sc.id + ' @ ' + n + ': checksum + traceHash identical across adapters and equal to the oracle', async () => {
                const built = build(sc, n);
                const rows = new Map();
                for (const label of sc.adapters) rows.set(label, await runScenario(label, sc, n, { seed: SEED, samples: 1 }));
                assert.equal(built.phases.map((p) => p.name).join(','), 'seek,reweight,blend');
                for (const p of built.phases) {
                    const o = oracleFilled(built.fill, n, 1);
                    const want = oracleRun(o, 1, p.script);
                    const wantHash = fnv(built.fill, p.script);
                    for (const [label, r] of rows) {
                        const row = r.phases.find((x) => x.phase === p.name);
                        assert.equal(row.checksum, want, label + ' ' + p.name + ' checksum vs oracle');
                        assert.equal(row.traceHash, wantHash, label + ' ' + p.name + ' traceHash vs independent FNV-1a');
                    }
                    // end state, not only the returned sums: direct run of the script on every adapter
                    const total = o.total(0);
                    for (const label of sc.adapters) {
                        const { h } = await handleFor(label, built, n, 1);
                        assert.equal(runScript(h, p.script), want, label + ' ' + p.name + ' direct checksum');
                        assert.equal(h.length(), n, label + ' ' + p.name + ' length');
                        assert.equal(h.sumBefore(0, n), total, label + ' ' + p.name + ' end-state total');
                        for (const i of [0, 1, n >> 1, n - 1]) assert.equal(h.sumBefore(0, i), o.sumBefore(0, i), label + ' sumBefore ' + i);
                    }
                }
            });
        }
    }

    test('A1: S7 draws are the oracle indexAtSum and each set lands on the drawn row (R-BA18 "on the drawn i")', () => {
        const n = 1024;
        const built = build(S7, n);
        const blend = built.phases.find((p) => p.name === 'blend').script;
        const o = oracleFilled(built.fill, n, 1);
        let drawn = -1;
        let sets = 0;
        for (let k = 0; k < blend.length; k += REC) {
            if (blend[k] === OP.SEEK) {
                drawn = o.indexAtSum(0, blend[k + 2]);
                assert.ok(blend[k + 2] >= 0 && blend[k + 2] < o.total(0), 'y uniform in [0, total)');
            } else {
                assert.equal(blend[k], OP.SET);
                assert.equal(blend[k + 1], drawn, 'set at record ' + k / REC);
                assert.ok(blend[k + 3] >= 0 && blend[k + 3] <= 255, 'w in [0, 255]');
                o.setMeasure(blend[k + 1], blend[k + 2], blend[k + 3]);
                sets++;
            }
        }
        assert.equal(sets, 10000);
        for (let i = 0; i < n; i++) assert.ok(built.fill[i] >= 1 && built.fill[i] <= 255, 'fill in [1, 255]');
    });

    // A test-local Fenwick (1-based tree) answering indexAtSum / setMeasure; strict = `<=` (the M-7 seek), mutant = `<`.
    function localFenwick(fill, n, mutant) {
        const t = new Float64Array(n + 1);
        const m = Float64Array.from(fill);
        for (let i = 1; i <= n; i++) t[i] = fill[i - 1];
        for (let i = 1; i <= n; i++) { const p = i + (i & -i); if (p <= n) t[p] += t[i]; }
        let top = 1;
        while (top * 2 <= n) top *= 2;
        return {
            setMeasure(i, d, w) { const dl = w - m[i]; m[i] = w; for (let j = i + 1; j <= n; j += j & -j) t[j] += dl; },
            indexAtSum(d, y) {
                let pos = 0;
                let rem = y;
                for (let s = top; s > 0; s >>= 1) {
                    const nx = pos + s;
                    if (nx <= n && (mutant ? t[nx] < rem : t[nx] <= rem)) { pos = nx; rem -= t[nx]; }
                }
                return pos;
            },
        };
    }

    test('A1 must-fail: a Fenwick find with `<` in place of `<=` changes >= 1 checksum; the `<=` one changes none', () => {
        const n = 1024;
        const built = build(S7, n);
        let bit = 0;
        for (const p of built.phases) {
            const want = oracleRun(oracleFilled(built.fill, n, 1), 1, p.script);
            assert.equal(runScript(localFenwick(built.fill, n, false), p.script), want, 'control: <= agrees with the oracle (' + p.name + ')');
            if (runScript(localFenwick(built.fill, n, true), p.script) !== want) bit++;
        }
        assert.ok(bit >= 1, 'the < mutant survived in every phase');
    });

    test('A1 must-fail: the orchestrator cross-check exits 1 "checksum mismatch" on a planted rival mutant (scratch copy)', () => {
        // realpath: Bench.mjs runs its CLI only when process.argv[1] equals its resolved URL (macOS /var -> /private/var)
        const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ygg-scn-')));
        try {
            cpSync(join(PKG, 'benchmark'), join(dir, 'benchmark'), { recursive: true, filter: (s) => !/benchmark\/out(\/|$)/.test(s) });
            cpSync(join(PKG, 'Yggdrasil.js'), join(dir, 'Yggdrasil.js'));
            cpSync(join(PKG, 'package.json'), join(dir, 'package.json'));
            cpSync(join(PKG, 'test'), join(dir, 'test'), { recursive: true, filter: (s) => !/test\/types(\/|$)/.test(s) });
            symlinkSync(join(PKG, 'node_modules'), join(dir, 'node_modules'));
            const fw = join(dir, 'benchmark', 'rivals', 'FenwickRebuild.js');
            const src = readFileSync(fw, 'utf8');
            assert.equal(src.split('if (t <= rem) {').length, 2, 'the mutation site must be unique');
            writeFileSync(fw, src.replace('if (t <= rem) {', 'if (t < rem) {')); // the M-7 tie rule broken: `<` for `<=`
            // the scratch copy is no git repo: a read-only `git` shim answers the meta.commit probes (no history is touched)
            mkdirSync(join(dir, 'bin'));
            writeFileSync(join(dir, 'bin', 'git'), '#!/bin/sh\ncase "$1" in rev-parse) echo abc1234;; esac\nexit 0\n');
            chmodSync(join(dir, 'bin', 'git'), 0o755);
            const env = Object.assign({}, process.env, { PATH: join(dir, 'bin') + ':' + process.env.PATH });
            const r = spawnSync(process.execPath, [join(dir, 'benchmark', 'Bench.mjs'), '--scenario', 'S7', '--quick'],
                { cwd: dir, env, encoding: 'utf8', timeout: 120000 });
            assert.equal(r.status, 1, 'exit ' + r.status + ' ' + r.stderr.slice(-400));
            assert.match(r.stderr, /checksum mismatch/);
            // control: the unmutated copy passes the same cross-check
            writeFileSync(fw, src);
            const ok = spawnSync(process.execPath, [join(dir, 'benchmark', 'Bench.mjs'), '--scenario', 'S7', '--quick'],
                { cwd: dir, env, encoding: 'utf8', timeout: 120000 });
            assert.equal(ok.status, 0, 'unmutated copy: exit ' + ok.status + ' ' + ok.stderr.slice(-400));
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});

describe('A1: cursorWalkSum against the brute-force oracle definition (dims 1 and 2)', () => {
    const LABELS = S7.adapters;
    for (const dims of [1, 2]) {
        test('A1: cursorWalkSum dims ' + dims + ': y = 0 / mid / total - 1 / total / beyond, k = 1 / 30 / past the end', async () => {
            const n = 200;
            const fill = new Int32Array(n * dims);
            let s = 12345; // own LCG, 32-bit exact
            for (let j = 0; j < fill.length; j++) {
                s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
                fill[j] = 1 + (s >>> 8) % 255;
            }
            const o = oracleFilled(fill, n, dims);
            for (const label of LABELS) {
                const ad = await resolveLabel(label);
                for (const views of [1, 3]) {
                    const hs = views === 1 ? [ad.create(n, dims)] : ad.createViews(3 * n, dims, 3);
                    for (let v = 0; v < hs.length; v++) {
                        const h = hs[v];
                        fillHandle(h, fill, n, dims, null);
                        for (let d = 0; d < dims; d++) {
                            const total = o.total(d);
                            for (const y of [0, 1, total >> 1, total - 1, total, total + 5]) {
                                for (const k of [1, 2, 30, n, n + 50]) {
                                    assert.equal(h.cursorWalkSum(d, y, k), oracleWalk(o, d, y, k),
                                        label + ' v' + v + ' d' + d + ' y ' + y + ' k ' + k);
                                }
                            }
                        }
                    }
                }
            }
            // by hand: y = total is past the last row -> 0; k = 1 -> exactly the drawn row's measure
            const h = (await resolveLabel('SumSequence')).create(n, dims);
            fillHandle(h, fill, n, dims, null);
            assert.equal(h.cursorWalkSum(0, o.total(0), 30), 0);
            assert.equal(h.cursorWalkSum(0, 0, 1), fill[0]);
            assert.equal(h.cursorWalkSum(0, o.total(0) - 1, 30), fill[(n - 1) * dims]);
        });
    }
});

// ---- A2 ----------------------------------------------------------------------------------------------------

describe('A2: validateBuilt throw rows (one planted record or field per row, each names its check)', () => {
    const n = 64;
    const good = () => S7.build(null, n, SEED, 1000);
    const withRec = (rec, mut) => {
        const b = good();
        const p = b.phases[0];
        const sc = new Int32Array(p.script.length + REC);
        sc.set(p.script);
        sc.set(rec, p.script.length);
        p.script = sc;
        if (mut) mut(b);
        return b;
    };
    const rows = [
        ['SEEK y = -1', () => withRec([OP.SEEK, 0, -1, 0]), /seek y/],
        ['SEEK on dim 1', () => withRec([OP.SEEK, 1, 5, 0]), /dim 1 outside/],
        ['REMOVE at n', () => withRec([OP.REMOVE, n, 0, 0]), /REMOVE index/],
        ['SET at index n', () => withRec([OP.SET, n, 0, 5]), /SET index/],
        ['SET on dim 1', () => withRec([OP.SET, 0, 1, 5]), /SET dim/],
        ['SET measure 256', () => withRec([OP.SET, 0, 0, 256]), /SET measure/],
        ['SUM at n + 1', () => withRec([OP.SUM, 0, n + 1, 0]), /SUM index/],
        ['WALK k = 0', () => withRec([OP.WALK, 0, 5, 0]), /WALK k/],
        ['WALK k = 1025', () => withRec([OP.WALK, 0, 5, 1025]), /WALK k/],
        ['INSERT at n + 1', () => withRec([OP.INSERT, n + 1, 1, 0]), /INSERT index/],
        ['INSERT past capacity (capacity n, insert at n)', () => withRec([OP.INSERT, n, 1, 0]), /past capacity/],
        ['fill entry 256', () => { const b = good(); b.fill[5] = 256; return b; }, /fill\[/],
        ['capacity n - 1', () => { const b = good(); b.capacity = n - 1; return b; }, /capacity/],
    ];
    test('control: the unplanted S7 built validates (dims 1), and a valid INSERT with capacity n + 1 does too', () => {
        assert.doesNotThrow(() => validateBuilt('S7', good(), n, 1));
        assert.doesNotThrow(() => validateBuilt('S7', withRec([OP.INSERT, n, 1, 0], (b) => { b.capacity = n + 1; }), n, 1));
    });
    for (const [name, mk, re] of rows) {
        test('validateBuilt rejects: ' + name, () => {
            assert.throws(() => validateBuilt('S7', mk(), n, 1), re);
        });
    }
    test('validateBuilt rejects: INSERT with dims 3', () => {
        const b = withRec([OP.INSERT, 0, 1, 0]);
        b.fill = new Int32Array(n * 3).fill(1);
        b.capacity = n + 1;
        assert.throws(() => validateBuilt('S7', b, n, 3), /dims must be <= 2/);
    });
});

// ---- g2b-2b A2: SPLIT [7, i, v, 0] / APPEND [8, v, 0, 0] (R-BA21; PLAN-bench-adopt-g2b2b TASKS 1-3) ----------------
// One cut / paste unit = 6 records over views [main, clip, tail]: tail <- [i + L, len), clip <- [i, i + L), main ++ tail,
// tail <- [j, len - L), main ++ clip, main ++ tail. The length is n again after every unit; clip and tail end empty.
function bulkUnits(n, units, jOf) {
    const out = new Int32Array(units * 6 * REC);
    for (let q = 0; q < units; q++) {
        const L = 20 + ((37 * q) % 380);
        const i = (977 * q) % (n - L);
        const j = jOf(q, i, L);
        out.set([7, i + L, 2, 0, 7, i, 1, 0, 8, 2, 0, 0, 7, j, 2, 0, 8, 1, 0, 0, 8, 2, 0, 0], q * 6 * REC);
    }
    return out;
}
// the bulk script with a SUM record after every unit, so the replay acc sees every intermediate order
function withSums(script, n) {
    const units = script.length / (6 * REC);
    const out = new Int32Array(script.length + units * REC);
    for (let q = 0; q < units; q++) {
        out.set(script.subarray(q * 6 * REC, (q + 1) * 6 * REC), q * 7 * REC);
        out.set([OP.SUM, 0, (q * 131) % (n + 1), 0], (q * 7 + 6) * REC);
    }
    return out;
}
const PASTE_J = (q, i, L) => (i * 7 + 13 * q + 1) % (1024 - L + 1);

describe('g2b-2b A2: validateBuilt SPLIT / APPEND rows (views 3; each fails on the frozen tree)', () => {
    const n = 64;
    const good = () => S7.build(null, n, SEED, 1000);
    const withRecs = (recs, mut) => {
        const b = good();
        const p = b.phases[0];
        const sc = new Int32Array(p.script.length + recs.length * REC);
        sc.set(p.script);
        for (let j = 0; j < recs.length; j++) sc.set(recs[j], p.script.length + j * REC);
        p.script = sc;
        if (mut) mut(b);
        return b;
    };
    test('control: views 3 accepts [7, i, 1, 0] + [8, 1, 0, 0], a 6-record cut / paste unit, and INSERT with clip rows inside capacity', () => {
        assert.doesNotThrow(() => validateBuilt('S7', withRecs([[7, 10, 1, 0], [8, 1, 0, 0]]), n, 1, 3));
        assert.doesNotThrow(() => validateBuilt('S7', withRecs([[7, 30, 2, 0], [7, 10, 1, 0], [8, 2, 0, 0], [7, 5, 2, 0], [8, 1, 0, 0], [8, 2, 0, 0]]), n, 1, 3));
        assert.doesNotThrow(() => validateBuilt('S7', withRecs([[7, 10, 1, 0], [1, 10, 1, 0], [8, 1, 0, 0], [2, 0, 0, 0]], (b) => { b.capacity = n + 1; }), n, 1, 3));
    });
    const rows = [
        ['SPLIT under views 1', () => withRecs([[7, 10, 1, 0], [8, 1, 0, 0]]), 1, /need views 3/],
        ['APPEND under views 1', () => withRecs([[8, 1, 0, 0]]), 1, /need views 3/],
        ['SPLIT into view 0', () => withRecs([[7, 10, 0, 0]]), 3, /SPLIT view 0 must be 1 or 2/],
        ['SPLIT into view 3', () => withRecs([[7, 10, 3, 0]]), 3, /SPLIT view 3 must be 1 or 2/],
        ['APPEND view 0', () => withRecs([[8, 0, 0, 0]]), 3, /APPEND view 0 must be 1 or 2/],
        ['APPEND view 3', () => withRecs([[8, 3, 0, 0]]), 3, /APPEND view 3 must be 1 or 2/],
        ['SPLIT index n + 1 (> lens0)', () => withRecs([[7, n + 1, 1, 0], [8, 1, 0, 0]]), 3, /SPLIT index 65 outside \[0, 64\]/],
        ['SPLIT index past lens0 after a split', () => withRecs([[7, 10, 1, 0], [7, 11, 2, 0], [8, 2, 0, 0], [8, 1, 0, 0]]), 3, /SPLIT index 11 outside \[0, 10\]/],
        ['SPLIT into a non-empty view', () => withRecs([[7, 10, 1, 0], [7, 5, 1, 0], [8, 1, 0, 0]]), 3, /view 1 holding 54 rows \(must be empty\)/],
        ['SPLIT non-zero pad slot', () => withRecs([[7, 10, 1, 3], [8, 1, 0, 0]]), 3, /SPLIT pad slot 3 must be 0/],
        ['APPEND non-zero pad slot b', () => withRecs([[8, 1, 1, 0]]), 3, /APPEND pad slots 1, 0 must be 0/],
        ['APPEND non-zero pad slot c', () => withRecs([[8, 2, 0, 9]]), 3, /APPEND pad slots 0, 9 must be 0/],
        ['a phase ending with 1 row in the clip', () => withRecs([[7, n - 1, 1, 0]]), 3, /non-empty clip \/ tail at phase end \(clip 1, tail 0\)/],
        ['a phase ending with rows in the tail', () => withRecs([[7, 3, 2, 0]]), 3, /non-empty clip \/ tail at phase end \(clip 0, tail 61\)/],
        ['SET indexes lens0 (not lens0 + clip)', () => withRecs([[7, 10, 1, 0], [3, 20, 0, 5], [8, 1, 0, 0]]), 3, /SET index 20 outside \[0, 10\)/],
        ['INSERT capacity counts clip + tail rows', () => withRecs([[7, 10, 1, 0], [1, 10, 1, 0], [8, 1, 0, 0], [2, 0, 0, 0]]), 3, /INSERT past capacity 64/],
        ['INSERT capacity counts tail rows', () => withRecs([[7, 10, 2, 0], [1, 10, 1, 0], [8, 2, 0, 0], [2, 0, 0, 0]]), 3, /INSERT past capacity 64/],
        ['views 2', () => good(), 2, /views: must be 1 or 3/],
    ];
    for (const [name, mk, views, re] of rows) {
        test('validateBuilt rejects: ' + name, () => {
            assert.throws(() => validateBuilt('S7', mk(), n, 1, views), re);
        });
    }
});

describe('g2b-2b A2: runScript SPLIT / APPEND against the oracle; the runner checks clip / tail (n 1024)', () => {
    const n = 1024;
    const built = S7.build(null, n, SEED, 1000);
    const bulk = withSums(bulkUnits(n, 120, PASTE_J), n);
    const oracleReplay = (script) => {
        const ov = [oracleFilled(built.fill, n, 1), new Oracle(1), new Oracle(1)];
        const acc = oracleRun(ov[0], 1, script, ov);
        const sums = [];
        for (let i = 0; i <= n; i++) sums.push(ov[0].sumBefore(0, i));
        return { acc, len: ov[0].length, sums, clip: ov[1].length, tail: ov[2].length };
    };
    const replay = async (label, script, run = runScript) => {
        const ad = await resolveLabel(label);
        const views = ad.createViews(n + 8, 1, 3);
        fillHandle(views[0], built.fill, n, 1, appendPartner(ad, 1));
        let acc;
        try { acc = run(views[0], script, views); } catch (e) { return { threw: String(e && e.message) }; }
        const sums = [];
        for (let i = 0; i <= n; i++) sums.push(views[0].sumBefore(0, i));
        return { acc, len: views[0].length(), sums, clip: views[1].length(), tail: views[2].length() };
    };
    test('every S7 label replays a 120-unit cut / paste script (+ SUM per unit) exactly as the oracle', async () => {
        const want = oracleReplay(bulk);
        assert.equal(want.len, n);
        assert.ok(want.sums.some((x, i) => x !== oracleReplay(new Int32Array([OP.SUM, 0, 0, 0])).sums[i]), 'the oracle replay must move rows (the paste is not an identity)');
        for (const label of S7.adapters) assert.deepEqual(await replay(label, bulk), want, label);
    });
    test('mutant: case 7 splitting into views[a] (not views[b]) changes the replay', async () => {
        const src = runScript.toString();
        assert.equal(src.split('h.splitAt(a, views[b])').length - 1, 1, 'case 7 text not found exactly once');
        const mutant = new Function('return ' + src.replace('h.splitAt(a, views[b])', 'h.splitAt(a, views[a])'))();
        // [7, 2, 1, 0] [7, 1, 2, 0] [8, 1] [8, 2]: right = r0, r2..r(n-1), r1; the mutant swaps clip / tail -> identity
        const s4 = new Int32Array([7, 2, 1, 0, 7, 1, 2, 0, 8, 1, 0, 0, 8, 2, 0, 0, OP.SUM, 0, 2, 0]);
        const want = oracleReplay(s4);
        for (const label of S7.adapters) {
            assert.deepEqual(await replay(label, s4), want, label + ' (unmutated)');
            assert.notDeepEqual(await replay(label, s4, mutant), want, label + ' (mutant must differ)');
        }
    });
    const scen = (script, events) => ({
        id: 'S7', title: S7.title, dims: 1, views: 3, mix: S7.mix, adapters: S7.adapters.slice(), sizes: [n],
        build(a, nn, seed, ev) {
            const b = S7.build(a, nn, seed, ev);
            return { capacity: nn + 8, fill: b.fill, phases: [{ name: 'bulk', events, script }] };
        },
    });
    test('runScenario with views 3: every S7 label runs the bulk phase; checksum / endState / traceHash agree', async () => {
        const sc = scen(bulk, 120);
        validateScenario(sc);
        const rows = [];
        for (const label of S7.adapters) {
            const r = await runScenario(label, sc, n, { seed: SEED, samples: 2 });
            assert.equal(r.views, 3);
            rows.push(r.phases.map((p) => [p.phase, p.events, p.ops, p.checksum, p.endState, p.traceHash]));
        }
        for (const r of rows) assert.deepEqual(r, rows[0]);
        assert.deepEqual(rows[0][0].slice(0, 3), ['bulk', 120, 120 * 7]);
        assert.equal(rows[0][0][3], oracleReplay(bulk).acc, 'checksum = the oracle acc');
    });
    test('a wrapped adapter whose append does nothing throws "non-empty clip / tail" (before the length check)', async () => {
        const sc = scen(new Int32Array([7, n - 10, 1, 0, 8, 1, 0, 0]), 1);
        const orig = SumSequenceAdapter.createViews;
        SumSequenceAdapter.createViews = function (...args) {
            const vs = orig.apply(this, args);
            vs[0].append = () => {};
            return vs;
        };
        try {
            await assert.rejects(() => runScenario('SumSequence', sc, n, { seed: SEED, samples: 1 }), /non-empty clip \/ tail: view 1 holds 10 rows/);
        } finally {
            SumSequenceAdapter.createViews = orig;
        }
        const st = scen(new Int32Array([7, n - 10, 2, 0, 8, 2, 0, 0]), 1);
        SumSequenceAdapter.createViews = function (...args) {
            const vs = orig.apply(this, args);
            vs[0].append = () => {};
            return vs;
        };
        try {
            await assert.rejects(() => runScenario('SumSequence', st, n, { seed: SEED, samples: 1 }), /non-empty clip \/ tail: view 2 holds 10 rows/);
        } finally {
            SumSequenceAdapter.createViews = orig;
        }
        // control: the unwrapped adapter runs the same scenario clean
        await assert.doesNotReject(() => runScenario('SumSequence', sc, n, { seed: SEED, samples: 1 }));
    });
    test('the per-sample check: an append that works in the count pass and does nothing in sample 0 throws "non-empty clip / tail"', async () => {
        const sc = scen(new Int32Array([7, n - 10, 1, 0, 8, 1, 0, 0]), 1);
        const orig = SumSequenceAdapter.createViews;
        let calls = 0;
        SumSequenceAdapter.createViews = function (...args) {
            const vs = orig.apply(this, args);
            const real = vs[0].append;
            vs[0].append = function (v) { calls++; if (calls === 1) return real.call(this, v); };
            return vs;
        };
        try {
            // without the per-sample checkViewsEmpty the length check would fire first ("length 1014 != 1024")
            await assert.rejects(() => runScenario('SumSequence', sc, n, { seed: SEED, samples: 1 }), /phase bulk: non-empty clip \/ tail: view 1 holds 10 rows/);
            assert.equal(calls, 2, 'count pass (call 1) clean, sample 0 (call 2) refused');
        } finally {
            SumSequenceAdapter.createViews = orig;
        }
    });
    test('the cell events = the events of its stream, not the build parameter (--quick: S2a 1,600, S2b 100, S7 2,000)', async () => {
        for (const [id, want] of [['S2a', 1600], ['S2b', 100], ['S7', 2000]]) {
            const r = await runScenario('SumSequence', selectScenario(id), 1024, { seed: SEED, quick: true, samples: 1 });
            assert.equal(r.events, want, id + ' cell events');
        }
    });
    test('runScenario throws when the adapter returns a view count other than s.views (2 of 3)', async () => {
        const sc = scen(new Int32Array([7, n - 10, 1, 0, 8, 1, 0, 0]), 1);
        const orig = SumSequenceAdapter.createViews;
        SumSequenceAdapter.createViews = function (...args) { return orig.apply(this, args).slice(0, 2); };
        try {
            await assert.rejects(() => runScenario('SumSequence', sc, n, { seed: SEED, samples: 1 }), /S7\.views: the runner holds 3 views, main = views\[0\]/);
        } finally {
            SumSequenceAdapter.createViews = orig;
        }
    });
});

describe('g2b-2b B2: phasesFrom ev table (R-BA20) -- a continuation record keeps its event class', () => {
    // records: SET SET (one reweight event), SEEK (one seek event); PHASES: seek 0, reweight 2, edit 3
    const stream = new Int32Array([3, 0, 0, 5, 3, 0, 1, 6, 4, 0, 7, 0]);
    test('control: a well-formed ev table counts whole events and keeps every record', () => {
        const ph = phasesFrom(stream, ['seek', 'reweight', 'blend'], new Uint8Array([0x82, 0x02, 0x80]));
        assert.deepEqual(ph.map((p) => [p.name, p.events, p.script.length / REC]), [['seek', 1, 1], ['reweight', 1, 2], ['blend', 2, 3]]);
    });
    const rows = [
        ['a continuation record of a different class than its event', [0x82, 0x03, 0x80], /ev\[1\] continues an event of another class/],
        ['a continuation record of class seek after a reweight event', [0x82, 0x00, 0x80], /ev\[1\] continues an event of another class/],
        ['ev[0] without the first-record flag', [0x02, 0x02, 0x80], /ev\[0\] continues an event of another class \(or no event\)/],
        ['a phase index past PHASES', [0x82, 0x02, 0x86], /ev\[2\] names no phase/],
    ];
    for (const [name, ev, re] of rows) {
        test('phasesFrom rejects: ' + name, () => {
            assert.throws(() => phasesFrom(stream, ['seek', 'reweight', 'blend'], new Uint8Array(ev)), re);
        });
    }
});

describe('A2: counts, length, planted imbalance, determinism (n 1024)', () => {
    const EXPECT = { S7: { seek: 10000, reweight: 10000, blend: 20000 }, S7b: { seek: 19000, reweight: 1000, blend: 20000 } };
    for (const sc of [S7, S7B]) {
        test('A2: ' + sc.id + ' @ 1024: events / ops per phase from the R-BA18 ratios; length() === n after every phase', async () => {
            const built = build(sc, 1024);
            for (const p of built.phases) {
                assert.equal(p.events, EXPECT[sc.id][p.name], sc.id + ' ' + p.name + ' events');
                assert.equal(p.script.length / REC, EXPECT[sc.id][p.name], sc.id + ' ' + p.name + ' ops');
            }
            assert.equal(built.phases[built.phases.length - 1].name, 'blend', 'blend last');
            for (const label of sc.adapters) {
                const r = await runScenario(label, sc, 1024, { seed: SEED, samples: 1 });
                for (const row of r.phases) {
                    assert.equal(row.events, EXPECT[sc.id][row.phase]);
                    assert.equal(row.ops, EXPECT[sc.id][row.phase]);
                }
                for (const p of built.phases) {
                    const { h } = await handleFor(label, built, 1024, 1);
                    runScript(h, p.script);
                    assert.equal(h.length(), 1024, label + ' ' + p.name);
                }
            }
        });
    }

    test('A2: a planted unbalanced insert throws "length 1025 != 1024"', async () => {
        const bad = {
            id: 'S7', title: S7.title, dims: S7.dims, views: S7.views, mix: S7.mix, adapters: ['SumSequence'], sizes: [1024],
            build(a, n, seed, events) {
                const b = S7.build(a, n, seed, events);
                for (const p of b.phases) {
                    const s = new Int32Array(p.script.length + REC);
                    s.set(p.script);
                    s.set([OP.INSERT, 0, 7, 0], p.script.length);
                    p.script = s;
                    p.events += 1;
                }
                b.capacity = n + 8;
                return b;
            },
        };
        validateScenario(bad);
        await assert.rejects(() => runScenario('SumSequence', bad, 1024, { seed: SEED, samples: 1 }), /length 1025 != 1024/);
    });

    test('A2: the scenario validators reject a script with an unknown opcode (cold gate)', async () => {
        const bad = {
            id: 'S7', title: S7.title, dims: 1, views: 1, mix: S7.mix, adapters: ['SumSequence'], sizes: [1024],
            build(a, n, seed, events) {
                const b = S7.build(a, n, seed, events);
                b.phases[0].script[0] = 99;
                return b;
            },
        };
        await assert.rejects(() => runScenario('SumSequence', bad, 1024, { seed: SEED, samples: 1 }), /opcode/);
    });

    test('A2: two children on one seed give identical counts, checksum, traceHash', () => {
        const code = 'import { runScenario, SCENARIOS } from ' + JSON.stringify(new URL('../benchmark/Scenarios.mjs', import.meta.url).href) + ';' +
            'const out = [];' +
            'for (const [id, label] of [["S7", "SumSequence"], ["S7b", "BlockedArray.plain"], ["S7", "FenwickRebuild.suffix"]]) {' +
            ' const r = await runScenario(label, SCENARIOS.find((s) => s.id === id), 1024, { seed: 777, samples: 1 });' +
            ' out.push(r.phases.map((p) => ({ phase: p.phase, counts: p.counts, extras: p.extras, checksum: p.checksum, traceHash: p.traceHash })));' +
            '}' +
            'process.stdout.write("RESULT " + JSON.stringify(out));';
        const run = () => {
            const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], { cwd: PKG, encoding: 'utf8', timeout: 60000 });
            assert.equal(r.status, 0, r.stderr);
            return JSON.parse(r.stdout.slice(r.stdout.indexOf('RESULT ') + 7));
        };
        const a = run();
        const b = run();
        assert.deepEqual(a, b);
        assert.equal(a[0].length, 3);
        assert.ok(a[0].every((p) => p.checksum !== undefined && typeof p.traceHash === 'number'));
        assert.notEqual(a[0][0].traceHash, a[1][0].traceHash, 'S7 and S7b are different streams');
    });
});

describe('A2: counts integrity (phaseEndState must run AFTER readCounts / readExtras)', () => {
    // Guards benchmark/Scenarios.mjs runScenario: phaseEndState probes (sumBefore) bump counters, so reading it before
    // h.readCounts skews the row (observed: BlockedArray reweight elemScans 0 -> 504). The expected values come from
    // an independent replay of the same steps WITHOUT any phaseEndState call.
    for (const sc of [S7, S7B]) {
        test('A2: ' + sc.id + ' @ 1024: every label x phase row counts / extras equal an independent fill + reset + run + read', async () => {
            const built = build(sc, 1024, scenarioEvents(false));
            for (const label of sc.adapters) {
                const row = await runScenario(label, sc, 1024, { seed: SEED, samples: 1 });
                assert.equal(row.phases.length, built.phases.length);
                for (let i = 0; i < built.phases.length; i++) {
                    const p = built.phases[i];
                    const { ad, h } = await handleFor(label, built, 1024, sc.dims, sc.views);
                    const cnt = new Int32Array(NC);
                    const ext = new Float64Array(ad.extraCounts.length);
                    h.resetCounts();
                    runScript(h, p.script);
                    h.readCounts(cnt);
                    if (ext.length > 0) h.readExtras(ext);
                    const rec = countsRecord(ad, cnt, ext);
                    assert.equal(row.phases[i].phase, p.name);
                    assert.deepEqual(row.phases[i].counts, rec.counts, label + ' ' + sc.id + ' ' + p.name + ' counts');
                    assert.deepEqual(row.phases[i].extras, rec.extras, label + ' ' + sc.id + ' ' + p.name + ' extras');
                }
            }
        });
    }
});

// ---- A5 ----------------------------------------------------------------------------------------------------

describe('A5: matrix + the R-BA15 scenario shape (every malformed field named)', () => {
    test('A5: cells().length === 16 (2 members x 8 dimensions)', () => {
        assert.equal(cells().length, 16);
    });
    test('A5: SCENARIOS ids are exactly S1a, S1b, S2, S2a, S2b, S7, S7b; PHASES is the R-BA15 list and "splice" is retired', () => {
        assert.deepEqual(SCENARIOS.map((s) => s.id), ['S1a', 'S1b', 'S2', 'S2a', 'S2b', 'S7', 'S7b']);
        assert.deepEqual([...PHASES], ['seek', 'walk', 'reweight', 'edit', 'bulk', 'blend']);
        assert.ok(!PHASES.includes('splice'));
        assert.equal(selectScenario('S7b').id, 'S7b');
        assert.throws(() => selectScenario('S1'), /unknown scenario S1/);
    });

    const base = () => ({
        id: 'S7', title: 't', dims: 1, views: 1, mix: { a: 1 }, adapters: ['SumSequence'], sizes: [8], build() { return null; },
    });
    assert.doesNotThrow(() => validateScenario(base()));
    const rows = [
        ['id', { id: 's7' }], ['id', { id: 'S' }], ['id', { id: 'S7B' }], ['id', { id: 'S7ab' }], ['id', { id: 7 }],
        ['title', { title: '' }],
        ['dims', { dims: 0 }], ['dims', { dims: 5 }], ['dims', { dims: 1.5 }], ['dims', { dims: '1' }],
        ['views', { views: 2 }], ['views', { views: 0 }], ['views', { views: 4 }],
        ['mix', { mix: [] }], ['mix', { mix: null }], ['mix', { mix: 'x' }], ['mix', { mix: {} }], ['mix', { mix: new Map() }],
        ['mix.a', { mix: { a: NaN } }], ['mix.a', { mix: { a: '' } }], ['mix.a', { mix: { a: [1] } }],
        ['adapters', { adapters: [] }], ['adapters', { adapters: ['SpliceFoil'] }], ['adapters', { adapters: ['Nope'] }],
        ['adapters', { adapters: ['SumSequence', 'SumSequence'] }],
        ['sizes', { sizes: [] }], ['sizes', { sizes: [0] }], ['sizes', { sizes: [1.5] }], ['sizes', { sizes: [(1 << 20) + 1] }],
        ['build', { build: 1 }],
    ];
    for (const [field, patch] of rows) {
        test('A5: validateScenario rejects ' + JSON.stringify(Object.keys(patch)) + ' = ' + JSON.stringify(patch[Object.keys(patch)[0]]) + ' naming ' + field, () => {
            assert.throws(() => validateScenario(Object.assign(base(), patch)), (e) => e.message.includes(field) && /scenario/.test(e.message));
        });
    }
    for (const k of ['id', 'title', 'dims', 'views', 'mix', 'adapters', 'sizes', 'build']) {
        test('A5: validateScenario rejects a missing ' + k + ' naming it', () => {
            const s = base();
            delete s[k];
            assert.throws(() => validateScenario(s), (e) => e.message.includes(k));
        });
    }
    test('A5: validateScenario rejects an unknown key (did-you-mean), a non-plain root and a symbol key', () => {
        assert.throws(() => validateScenario(Object.assign(base(), { dimz: 1 })), /dimz/);
        assert.throws(() => validateScenario([]), /plain/);
        assert.throws(() => validateScenario(Object.assign(base(), { [Symbol('x')]: 1 })), /scenario/);
    });
    test('A5: the retired "splice" phase name is rejected by the built-script gate, naming name', async () => {
        const bad = Object.assign(base(), {
            adapters: ['SumSequence'], sizes: [8],
            build(a, n, seed, events) {
                const b = S7.build(a, n, seed, events);
                b.phases[0].name = 'splice';
                return b;
            },
        });
        await assert.rejects(() => runScenario('SumSequence', bad, 8, { seed: SEED, samples: 1 }), /name|phase/);
        const unk = Object.assign(base(), {
            build(a, n, seed, events) {
                const b = S7.build(a, n, seed, events);
                b.phases[0].name = 'bogus';
                return b;
            },
        });
        await assert.rejects(() => runScenario('SumSequence', unk, 8, { seed: SEED, samples: 1 }), /name|phase/);
    });
});

// ---- B1 review: fail-closed adapter rows -----------------------------------------------------------------------

describe('B1 review: createViews, tune, variant and counter-wrap throw rows (each names its field)', () => {
    const withViews = () => ADAPTERS.filter((a) => typeof a.createViews === 'function');
    test('createViews: k = 0, 4, 1.5, NaN, "3" throw naming createViews on every adapter that has it', () => {
        assert.ok(withViews().length >= 4);
        for (const a of withViews()) {
            for (const k of [0, 4, 1.5, NaN, '3', -1, undefined]) {
                assert.throws(() => a.createViews(8, 1, k), /createViews/, a.name + ' k=' + String(k));
            }
            for (const k of [1, 2, 3]) assert.equal(a.createViews(8, 1, k).length, k);
        }
    });
    test('validateAdapter: createViews AND an na reason fails (na.createViews); neither fails (createViews)', () => {
        assert.throws(() => validateAdapter(Object.assign({}, SumSequenceAdapter, { na: { createViews: 'x' } })), /na\.createViews/);
        const { createViews, ...rest } = SumSequenceAdapter;
        assert.equal(typeof createViews, 'function');
        assert.throws(() => validateAdapter(rest), /createViews/);
        assert.doesNotThrow(() => validateAdapter(Object.assign({}, rest, { na: { createViews: 'one view per create' } })));
    });
    test('BlockedArray tune: unknown key, variant mismatch, chunkCap 6 / 65540 / NaN / 2^16+4 throw naming the field', async () => {
        assert.throws(() => BlockedArrayAdapter.create(64, 1, { bogus: 1 }), /tune\.bogus/);
        assert.throws(() => BlockedArrayAdapter.create(64, 1, { variant: 'plain' }), /tune\.variant/);
        assert.throws(() => BlockedArrayAdapter.create(64, 1, { variant: 'nope' }), /tune\.variant/);
        for (const cc of [6, 65540, NaN, 7, 4, 1.5, '16']) {
            assert.throws(() => BlockedArrayAdapter.create(64, 1, { chunkCap: cc }), /tune\.chunkCap/, 'chunkCap ' + String(cc));
        }
        assert.throws(() => BlockedArrayAdapter.createViews(64, 1, 3, { chunkCap: 6 }), /tune\.chunkCap/);
        const plain = await blockedArrayAdapter('plain');
        assert.throws(() => plain.create(64, 1, { variant: 'unrolled' }), /tune\.variant/);
        assert.equal(BlockedArrayAdapter.create(64, 1, { chunkCap: 8 }).instance.chunkCap, 8);
        assert.equal(BlockedArrayAdapter.create(64, 1, { chunkCap: 65536 }).instance.chunkCap, 65536);
    });
    test('FenwickRebuild takes no tune; blockedArrayAdapter("bogus") throws; SumSequence rejects an unknown tune key', async () => {
        for (const a of [FenwickSuffixAdapter, FenwickFullAdapter]) {
            assert.throws(() => a.create(8, 1, { chunkCap: 8 }), /tune/);
            assert.throws(() => a.createViews(8, 1, 3, { chunkCap: 8 }), /tune/);
        }
        await assert.rejects(() => blockedArrayAdapter('bogus'), /variant/);
        assert.throws(() => SumSequenceAdapter.create(8, 1, { leafSize: 5 }), /leafSize/);
        assert.throws(() => SumSequenceAdapter.create(8, 1, { x: 1 }), /tune\.x/);
    });
    test('counter wrap: a rival whose Int32 counter reads negative makes readCounts / readExtras throw', () => {
        let sawExtras = 0;
        for (const a of [BlockedArrayAdapter, FenwickSuffixAdapter, FenwickFullAdapter]) {
            const h = a.create(8, 1);
            const orig = h.instance.readCounters.bind(h.instance);
            h.instance.readCounters = (out) => { orig(out); out.fill(-1); };
            assert.throws(() => h.readCounts(new Int32Array(12)), /readCounts/, a.name + ' readCounts');
            if (a.extraCounts.length > 0) {
                sawExtras++;
                assert.throws(() => h.readExtras(new Float64Array(a.extraCounts.length)), /readExtras/, a.name + ' readExtras');
            }
        }
        assert.ok(sawExtras >= 1, 'no rival has extras: the readExtras row is vacuous');
    });
    test('selectAdapter names the RETIRED FenwickFixed slot with its ruling', () => {
        assert.throws(() => selectAdapter('FenwickFixed'), /RETIRED.*R-BA18/s);
    });
});

// ---- A3 + A4: the --expose-gc child -----------------------------------------------------------------------------

async function childMain(u) {
    const SC = await import(u.scn);
    const AD = await import(u.adp);
    const M = await import(u.meter);
    const L = await import(u.leak);
    const G = await import(u.prof);
    const out = { semi: M.semiSpaceOk(), lanes: [], walk: [], controls: [], bulkCtl: [], gc: null, leak: null, ctlRetain: null };
    if (!out.semi) return out;
    const tick = (ms) => new Promise((r) => setTimeout(r, ms));
    const settle = async () => { globalThis.gc(); await tick(20); globalThis.gc(); await tick(20); };
    const N = 4096;
    const EV = 4000;
    const WIN = 6;
    const LABELS = u.labels;
    // WARM calls of the script run OUTSIDE the measured region on every lane: BlockedArray's _merge / removeAt tier up
    // only after ~40,000 ops, so 3 warm calls left the edit lane (18,000 ops) interpreted (912 / 896 B per call).
    // u.warm is overridden only by the cold check (warm 2, edit script of BlockedArray labels only).
    const WARM = u.warm;
    const S7 = SC.SCENARIOS.find((s) => s.id === 'S7');
    const built = S7.build(null, N, u.seed, EV);
    const S7B = SC.SCENARIOS.find((s) => s.id === 'S7b');
    const built7b = S7B.build(null, N, u.seed, EV);
    const mk = (n, f) => { const s = new Int32Array(n * 4); for (let j = 0; j < n; j++) f(s, j * 4, j); return s; };
    const T = SC.OP;
    const scripts = built.phases.map((p) => ({ name: p.name, script: p.script, fill: built.fill }));
    for (const p of built7b.phases) scripts.push({ name: 'S7b.' + p.name, script: p.script, fill: built7b.fill });
    scripts.push({ name: 'walk', script: mk(2000, (s, o, j) => { s[o] = T.WALK; s[o + 1] = 0; s[o + 2] = (Math.imul(j, 2654435761) >>> 0) % 400000; s[o + 3] = 30; }), fill: built.fill });
    // edit: alternating insert at the end / remove at 0 keeps the length in [N, N + 1]
    scripts.push({ name: 'edit', script: mk(2000, (s, o, j) => {
        if ((j & 1) === 0) { s[o] = T.INSERT; s[o + 1] = N; s[o + 2] = 7; s[o + 3] = 0; } else { s[o] = T.REMOVE; s[o + 1] = 0; }
    }), fill: built.fill });
    // g2b-2b A3 bulk lane: 300 cut / paste units, L = 20 + (37q mod 380), i = j = 977q mod (N - L) (a paste back at the
    // cut point: the order after a call is the fill, so the lane needs no refill between calls). 6 records per unit.
    const BULK_U = 300;
    const bulk = new Int32Array(BULK_U * 6 * 4);
    for (let q = 0; q < BULK_U; q++) {
        const Lq = 20 + ((37 * q) % 380);
        const iq = (977 * q) % (N - Lq);
        bulk.set([T.SPLIT, iq + Lq, 2, 0, T.SPLIT, iq, 1, 0, T.APPEND, 2, 0, 0, T.SPLIT, iq, 2, 0, T.APPEND, 1, 0, 0, T.APPEND, 2, 0, 0], q * 24);
    }
    SC.validateBuilt('A3.bulk', { capacity: N + 8, fill: built.fill, phases: [{ name: 'bulk', events: BULK_U, script: bulk }] }, N, 1, 3);
    const BULK_RECS = bulk.length / 4;
    // BA-26 warm FLOOR, probed under --trace-opt --no-concurrent-recompilation (.handoff/evidence/bench-adopt/g2b2b/
    // probe-bulk-*.log): BlockedArray splitAt / append / _merge / _equalize reach TurboFan by call 45; _split is not
    // reached without a refill; _repairUnderflow stays Maglev through 300 calls.
    const BULK_WARM = u.bulkWarm;
    const BULK_K = 16; // calls per window: a 1-call window with a memoized base(1) drifts +-16 B (FAIL-OPEN)
    const BOXH = [null, null];
    // must-fail control: exactly ONE 16 B HeapNumber per call (a fractional double stored into a tagged array slot)
    const boxScript = (h, script, views) => { const a = SC.runScript(h, script, views); BOXH[0] = a + 0.5; return a; };
    // REPORTED only (field 'fresh', not gated): the bulk lanes read against a FRESH min of two K-call lanes of a
    // non-allocating step of the lane's shape. The memoized empty base(16) reads up to 16 B per window above a 0 B lane
    // (1 B per call at K = 16), so the gate is < 8 B per call and the one-box control must read >= 8 (a < 16 floor let
    // the control's 15 B per call pass: FAIL-OPEN).
    const bulkBase = () => {
        const a = M.lane('bulk.base', () => { IOUT[2] = 0; }, BULK_K, WIN);
        const b = M.lane('bulk.base', () => { IOUT[3] = 0; }, BULK_K, WIN);
        return b.min < a.min || Number.isNaN(a.min) ? b : a;
    };
    const IOUT = new Int32Array(4);
    const WALKY = new Int32Array(4096);
    for (let j = 0; j < 4096; j++) WALKY[j] = (Math.imul(j, 2246822519) >>> 0) % 400000;
    const bases = new Map();
    const base = (ops) => { if (!bases.has(ops)) bases.set(ops, M.baseline(ops, WIN)); return bases.get(ops); };
    const prof = new G.GcProfiler();
    prof.start();
    const gate = { enter: () => { prof.enter('lanes'); }, exit: () => { prof.exit(); } };
    for (const label of LABELS) {
        const ad = await SC.resolveLabel(label);
        const partner = SC.appendPartner(ad, 1);
        const views = ad.createViews(N + 8, 1, 3);
        for (let v = 0; v < 3; v++) {
            const h = views[v];
            let curFill = built.fill;
            const refill = () => { for (let w = 0; w < 3; w++) if (w !== v) views[w].clear(); SC.fillHandle(h, curFill, N, 1, v === 0 ? partner : null); };
            for (const sc of scripts) {
                if (u.only && sc.name !== u.only) continue;
                curFill = sc.fill;
                for (let w = 0; w < WARM; w++) { refill(); IOUT[0] = SC.runScript(h, sc.script); }
                const r = M.lane(label + '.v' + v + '.' + sc.name, () => { IOUT[0] = SC.runScript(h, sc.script); }, 1, WIN, refill, gate);
                const events = sc.script.length / 4;
                const perCall = M.bop(r, base(1));
                out.lanes.push({ name: r.name, perCall, bop: perCall / events, wins: M.winText(r, base(1)) });
            }
            if (u.only) continue;
            curFill = built.fill;
            refill();
            const r = M.lane(label + '.v' + v + '.cursorWalkSum', (k) => { IOUT[1] = h.cursorWalkSum(0, WALKY[k & 4095], 30); }, 10000, WIN, undefined, gate);
            out.walk.push({ name: r.name, bop: M.bop(r, base(10000)), wins: M.winText(r, base(10000)) });
        }
        if (!u.only) {
            const h = views[0];
            views[1].clear(); views[2].clear();
            SC.fillHandle(h, built.fill, N, 1, partner);
            for (let w = 0; w < BULK_WARM; w++) IOUT[0] = SC.runScript(h, bulk, views);
            const bb = bulkBase();
            const r = M.lane(label + '.v0.bulk', () => { IOUT[0] = SC.runScript(h, bulk, views); }, BULK_K, WIN, undefined, gate);
            if (h.length() !== N || views[1].length() !== 0 || views[2].length() !== 0) throw new Error(label + ' bulk lane left length ' + h.length());
            const perCall = M.bop(r, base(BULK_K));
            out.lanes.push({ name: r.name, perCall, bop: perCall / BULK_RECS, wins: M.winText(r, base(BULK_K)), calls: BULK_WARM,
                warmRecords: BULK_WARM * BULK_RECS, k: BULK_K, fresh: M.bop(r, bb) });
            for (let w = 0; w < BULK_WARM; w++) IOUT[0] = boxScript(h, bulk, views);
            const cb = M.lane('ctl.box.' + label, () => { IOUT[0] = boxScript(h, bulk, views); }, BULK_K, WIN);
            const cbb = bulkBase();
            out.bulkCtl.push({ name: cb.name, perCall: M.bop(cb, base(BULK_K)), wins: M.winText(cb, base(BULK_K)), fresh: M.bop(cb, cbb) });
        }
        for (const v of views) v.clear();
        partner && partner.clear();
    }
    // g2b-3a A5: BlockedArray.twin runScript on every S7 / S7b phase, K = 16 calls per window (the per-call floor
    // needs K calls: a 1-call window drifts +-16 B), warm per BA-26 = max(u.warm, ceil(1e5 / events)) calls, no gc()
    // between the warm and the lane; one-box control (one 16 B HeapNumber per call) on every script, outside the region.
    const TWIN = 'BlockedArray.twin';
    out.twin = [];
    out.twinCtl = [];
    if (!u.only && LABELS.includes(TWIN)) {
        const ad = await SC.resolveLabel(TWIN);
        const h = ad.create(N + 8, 1);
        for (const sc of scripts) {
            if (!/^(S7b\.)?(seek|reweight|blend)$/.test(sc.name)) continue;
            const events = sc.script.length / 4;
            const warm = Math.max(WARM, Math.ceil(1e5 / events));
            const refill = () => SC.fillHandle(h, sc.fill, N, 1, null);
            refill();
            for (let w = 0; w < warm; w++) IOUT[0] = SC.runScript(h, sc.script);
            const r = M.lane(TWIN + '.k16.' + sc.name, () => { IOUT[0] = SC.runScript(h, sc.script); }, BULK_K, WIN, refill, gate);
            const perCall = M.bop(r, base(BULK_K));
            out.twin.push({ name: r.name, perCall, bop: perCall / events, k: BULK_K, calls: warm, warmEvents: warm * events,
                wins: M.winText(r, base(BULK_K)) });
            refill();
            for (let w = 0; w < warm; w++) IOUT[0] = boxScript(h, sc.script);
            const c = M.lane('ctl.box.' + TWIN + '.' + sc.name, () => { IOUT[0] = boxScript(h, sc.script); }, BULK_K, WIN, refill);
            out.twinCtl.push({ name: c.name, perCall: M.bop(c, base(BULK_K)), wins: M.winText(c, base(BULK_K)) });
        }
        h.clear();
    }
    if (u.only) { prof.stop(); return out; }
    await prof.settle();
    const s = prof.summary();
    prof.stop();
    const rep = G.checkNoGc(s, { perRegion: { lanes: { maxMajor: 0 } } });
    const lg = s.byRegion && s.byRegion.lanes ? s.byRegion.lanes.gc : null;
    out.gc = { ok: rep.ok === true && lg !== null, major: lg ? lg.major : -1 };

    // must-fail control (outside the region): a runScript that allocates an Int32Array(1) per event
    const HOLD = [null, null];
    const allocScript = (h, script) => {
        let acc = 0;
        for (let k = 0; k < script.length; k += 4) {
            HOLD[(k >> 2) & 1] = new Int32Array(1);
            if (script[k] === T.SEEK) acc = (acc + h.indexAtSum(script[k + 1], script[k + 2])) | 0;
            else if (script[k] === T.SET) h.setMeasure(script[k + 1], script[k + 2], script[k + 3]);
        }
        return acc;
    };
    const ssA = await SC.resolveLabel('SumSequence');
    const ch = ssA.create(N + 8, 1);
    const cref = built.phases.find((p) => p.name === 'blend').script;
    const crefn = cref.length / 4;
    const crefill = () => SC.fillHandle(ch, built.fill, N, 1, null);
    crefill(); IOUT[0] = allocScript(ch, cref);
    const cr = M.lane('ctl.allocPerEvent', () => { IOUT[0] = allocScript(ch, cref); }, 1, WIN, crefill);
    out.controls.push({ name: cr.name, perCall: M.bop(cr, base(1)), bop: M.bop(cr, base(1)) / crefn, wins: M.winText(cr, base(1)) });
    // must-fail control 2: ONE 32-byte-class allocation per runScript CALL (not per event). Reads < 1 B/event
    // (>= 16 B / 4000 events) but must FAIL the per-call floor. Same warm-up as the lanes.
    const perCallScript = (h, script) => { HOLD[0] = new Float64Array(4); return SC.runScript(h, script); };
    for (let w = 0; w < WARM; w++) { crefill(); IOUT[0] = perCallScript(ch, cref); }
    const cp = M.lane('ctl.allocPerCall', () => { IOUT[0] = perCallScript(ch, cref); }, 1, WIN, crefill);
    out.controls.push({ name: cp.name, perCall: M.bop(cp, base(1)), bop: M.bop(cp, base(1)) / crefn, wins: M.winText(cp, base(1)) });

    // ---- A4: 100 cycles of createViews(C, d, 3) -> fill -> phase -> clear -> drop, per adapter
    const K = new Int32Array(2);
    const onFin = () => { K[0]++; };
    const small = S7.build(null, 40, u.seed, 1000);
    const blendSmall = small.phases.find((p) => p.name === 'blend').script;
    const views3 = (ad) => ad.createViews(128, 1, 3);
    const leakRun = async (retain, labels = LABELS, make = views3) => {
        K[0] = 0; K[1] = 0;
        const tracker = L.createLeakTracker({ name: retain ? 'scn-ctl' : 'scn', onLeak: () => {}, onWarning: () => {} });
        const refs = [];
        const kept = [];
        const per = {};
        for (const label of labels) {
            // one cycle per call: no local of a finished cycle survives on the stack to pin its views
            const cycle = (ad) => {
                const vs = make(ad);
                for (const h of vs) {
                    const hv = tracker.track(h, onFin, label + '.handle');
                    const hi = tracker.track(h.instance, onFin, label + '.instance');
                    refs.push(new WeakRef(h), new WeakRef(h.instance));
                    SC.fillHandle(h, small.fill, 40, 1, null);
                    IOUT[0] = SC.runScript(h, blendSmall);
                    if (!retain) h.clear();
                    if (h.length() === 0) { tracker.untrack(hv); tracker.untrack(hi); } else K[1]++;
                    if (retain) kept.push(h);
                }
            };
            for (let a = 0; a < 100; a++) cycle(await SC.resolveLabel(label)); // resolve -> create -> ... each cycle
            per[label] = 100;
        }
        await settle();
        const size = tracker.size();
        let alive = 0;
        for (const r of refs) if (r.deref() !== undefined) alive++;
        const held = kept.length;
        kept.length = 0;
        return { size, alive, fin: K[0], notReset: K[1], tracked: refs.length, held, cycles: per };
    };
    out.leak = await leakRun(false);
    out.ctlRetain = await leakRun(true);
    // g2b-3a A5: 100 cycles resolve twin -> create -> fill -> runScript -> clear -> drop (one handle per cycle)
    if (LABELS.includes(TWIN)) {
        const one = (ad) => [ad.create(128, 1)];
        out.twinLeak = await leakRun(false, [TWIN], one);
        out.twinRetain = await leakRun(true, [TWIN], one);
    }
    out.labels = LABELS;
    return out;
}

let childResult = null;
const A3_WARM = 60;
const A3_BULK_WARM = 60;
function runChild(over) {
    if (!over && childResult) return childResult;
    const u = {
        scn: new URL('../benchmark/Scenarios.mjs', import.meta.url).href,
        adp: new URL('../benchmark/Adapters.mjs', import.meta.url).href,
        meter: new URL('./torture-meter.mjs', import.meta.url).href,
        seed: SEED, labels: S7.adapters, warm: A3_WARM, bulkWarm: A3_BULK_WARM, leak: import.meta.resolve('@zakkster/lite-leak'), prof: import.meta.resolve('@zakkster/lite-gc-profiler'),
    };
    Object.assign(u, over);
    const code = '(' + childMain.toString() + ')(' + JSON.stringify(u) + ').then((r) => { process.stdout.write("RESULT " + JSON.stringify(r) + "\\n"); },' +
        ' (e) => { process.stderr.write(String(e && e.stack || e)); process.exit(1); });';
    const r = spawnSync(process.execPath, ['--expose-gc', '--no-concurrent-recompilation', '--min-semi-space-size=4',
        '--max-semi-space-size=4', '--input-type=module', '-e', code], { cwd: PKG, encoding: 'utf8', timeout: 240000 });
    assert.equal(r.status, 0, 'child failed: ' + r.stderr + r.stdout.slice(-800));
    const line = r.stdout.split('\n').find((l) => l.startsWith('RESULT '));
    assert.ok(line, 'child printed no RESULT line: ' + r.stdout);
    const res = JSON.parse(line.slice(7));
    if (over) return res;
    childResult = res;
    return childResult;
}

describe('A3 / A4: the --expose-gc child (BA-7a precedent)', () => {
    // Y-CI-6a (burst 44): every lane B/op row and every per-call / per-op must-fail control row goes through
    // test/meter-gate.mjs (asserted on node >= 24, REPORTED on < 24); semi, counts, names, k, calls, warm counts, field
    // presence, gc and retention rows stay asserted on every version. Prints live in the test bodies.
    // meter rows: 6 bulk perCall + 6 bulkCtl + 150 lanes x (perCall + bop) + controls[0] + pc (bop + perCall) = 315
    function a3Gate(r, ver = process.versions.node, log = console.log) {
        const m = meter(ver, log);
        assert.equal(r.semi, true, 'semi-space flags not pinned in the child');
        // 6 adapters x 3 views x 8 scripts (S7 seek / reweight / blend, S7b the same, walk, edit) + 1 bulk lane per adapter
        assert.equal(r.lanes.length, 150);
        for (const l of r.lanes) assert.ok(Object.hasOwn(l, 'perCall') && Object.hasOwn(l, 'bop'), l.name + ' has no perCall / bop field');
        // g2b-2b bulk lane: one per label on views[0], 16 calls per window, warm >= 60 calls (108,000 records)
        const bulk = r.lanes.filter((l) => l.name.endsWith('.v0.bulk'));
        assert.deepEqual(bulk.map((l) => l.name), S7.adapters.map((x) => x + '.v0.bulk'));
        for (const l of bulk) {
            assert.equal(l.k, 16, l.name + ' calls per window');
            assert.ok(l.calls >= 60 && l.warmRecords >= 108000, l.name + ' warmed ' + l.calls + ' calls / ' + l.warmRecords + ' records');
            m.ok(typeof l.perCall === 'number' && l.perCall > -2 && l.perCall < 8, l.name + ' perCall ' + l.perCall);
        }
        // must-fail control: one 16 B box per bulk call, every label, must FAIL the < 8 B per call floor
        assert.deepEqual(r.bulkCtl.map((c) => c.name), S7.adapters.map((x) => 'ctl.box.' + x));
        for (const c of r.bulkCtl) {
            assert.ok(Object.hasOwn(c, 'perCall'), c.name + ' has no perCall field');
            m.ok(typeof c.perCall === 'number' && c.perCall >= 8, c.name + ' must FAIL perCall < 8, read ' + c.perCall);
        }
        // JSON carries NaN (no gated window) as null: a non-number reading fails closed. Both floors: per call < 16 B
        // AND per event < 1 B (the division alone hid a ~900 B interpreted-boxing call behind 4000 events).
        for (const l of r.lanes) {
            m.ok(typeof l.perCall === 'number' && l.perCall < 16, l.name + ' perCall ' + l.perCall);
            m.ok(typeof l.bop === 'number' && l.bop < 1, l.name + ' bop ' + l.bop);
        }
        assert.equal(r.gc.ok, true, 'gc region: ' + JSON.stringify(r.gc));
        assert.equal(r.gc.major, 0, 'A3 lanes-region gc major');
        assert.equal(r.controls.length, 2);
        assert.ok(Object.hasOwn(r.controls[0], 'bop'), r.controls[0].name + ' has no bop field');
        m.ok(typeof r.controls[0].bop === 'number' && r.controls[0].bop > 8, r.controls[0].name + ': control must read > 8 B/event, read ' + r.controls[0].bop);
        // must-fail control: one allocation per runScript CALL reads < 1 B/event but must FAIL the per-call floor
        const pc = r.controls[1];
        assert.equal(pc.name, 'ctl.allocPerCall');
        assert.ok(Object.hasOwn(pc, 'perCall') && Object.hasOwn(pc, 'bop'), pc.name + ' has no perCall / bop field');
        m.ok(typeof pc.bop === 'number' && pc.bop < 1, pc.name + ' per-call control must read < 1 B/event, read ' + pc.bop);
        m.ok(typeof pc.perCall === 'number' && !(pc.perCall < 16), pc.name + ' per-call control must FAIL perCall < 16, read ' + pc.perCall);
        const rep = m.report();
        assert.equal(rep.asserted + rep.reported, 315, 'meter rows');
        assert.equal(rep.gated ? rep.reported : rep.asserted, 0, 'every meter row on one tier');
        return rep;
    }
    // meter rows: 18 walk lanes
    function walkGate(r, ver = process.versions.node, log = console.log) {
        const m = meter(ver, log);
        assert.equal(r.walk.length, 18);
        for (const l of r.walk) {
            assert.ok(Object.hasOwn(l, 'bop'), l.name + ' has no bop field');
            m.ok(typeof l.bop === 'number' && l.bop < 1, l.name + ' bop ' + l.bop);
        }
        const rep = m.report();
        assert.equal(rep.asserted + rep.reported, 18, 'meter rows');
        assert.equal(rep.gated ? rep.reported : rep.asserted, 0, 'every meter row on one tier');
        return rep;
    }
    // meter rows: 6 twin lanes x (perCall + bop) + 6 twin controls = 18
    function twinGate(r, ver = process.versions.node, log = console.log) {
        const m = meter(ver, log);
        assert.equal(r.semi, true, 'semi-space flags not pinned in the child');
        const names = ['seek', 'reweight', 'blend', 'S7b.seek', 'S7b.reweight', 'S7b.blend'];
        assert.deepEqual(r.twin.map((l) => l.name), names.map((x) => 'BlockedArray.twin.k16.' + x));
        assert.deepEqual(r.twinCtl.map((c) => c.name), names.map((x) => 'ctl.box.BlockedArray.twin.' + x));
        for (const l of r.twin) {
            assert.equal(l.k, 16, l.name + ' calls per window');
            assert.ok(l.calls >= 60 && l.warmEvents >= 1e5, l.name + ' warmed ' + l.calls + ' calls / ' + l.warmEvents + ' events (BA-26 floor)');
            assert.ok(Object.hasOwn(l, 'perCall') && Object.hasOwn(l, 'bop'), l.name + ' has no perCall / bop field');
            m.ok(typeof l.perCall === 'number' && l.perCall > -2 && l.perCall < 8, l.name + ' perCall ' + l.perCall);
            m.ok(typeof l.bop === 'number' && l.bop < 1, l.name + ' bop ' + l.bop);
        }
        for (const c of r.twinCtl) {
            assert.ok(Object.hasOwn(c, 'perCall'), c.name + ' has no perCall field');
            m.ok(typeof c.perCall === 'number' && c.perCall >= 8, c.name + ' must FAIL perCall < 8, read ' + c.perCall);
        }
        assert.equal(r.gc.ok, true, 'gc region: ' + JSON.stringify(r.gc));
        assert.equal(r.gc.major, 0, 'twin lanes-region gc major');
        const rep = m.report();
        assert.equal(rep.asserted + rep.reported, 18, 'meter rows');
        assert.equal(rep.gated ? rep.reported : rep.asserted, 0, 'every meter row on one tier');
        return rep;
    }
    test('A3: runScript, every phase x every adapter x view 0..2 at n 4096: < 1 B/event, maxMajor 0; control reads > 8', () => {
        const r = runChild();
        for (const l of r.lanes) console.log('# lane ' + l.name + ' bop=' + String(l.bop) + ' [' + l.wins + ']');
        for (const l of r.controls) console.log('# control ' + l.name + ' bop=' + String(l.bop) + ' [' + l.wins + ']');
        for (const l of r.lanes.filter((x) => x.name.endsWith('.v0.bulk'))) console.log('# bulk ' + l.name + ' perCall=' + String(l.perCall) + ' fresh=' + String(l.fresh));
        for (const c of r.bulkCtl) console.log('# control ' + c.name + ' perCall=' + String(c.perCall) + ' fresh=' + String(c.fresh) + ' [' + c.wins + ']');
        if (r.controls[1]) console.log('# control ' + r.controls[1].name + ' perCall=' + String(r.controls[1].perCall));
        a3Gate(r);
    });
    test('A3: cold check -- with 2 warm calls the BlockedArray edit lane reads >= 16 B per call (the lane reaches the interpreted path)', () => {
        const labels = S7.adapters.filter((l) => l.startsWith('BlockedArray'));
        assert.ok(labels.length >= 1);
        const r = runChild({ warm: 2, only: 'edit', labels });
        const m = meter(process.versions.node);
        assert.equal(r.semi, true);
        assert.equal(r.lanes.length, labels.length * 3);
        for (const l of r.lanes) console.log('# cold ' + l.name + ' perCall=' + String(l.perCall));
        for (const l of r.lanes) assert.ok(Object.hasOwn(l, 'perCall'), l.name + ' has no perCall field');
        m.ok(r.lanes.some((l) => typeof l.perCall === 'number' && l.perCall >= 16), 'no cold edit lane read >= 16 B per call');
        const rep = m.report();
        assert.equal(rep.asserted + rep.reported, 1, 'meter rows');
    });
    test('A3: the cursorWalkSum lanes (every adapter, views 0..2) read < 1 B/op', () => {
        const r = runChild();
        for (const l of r.walk) console.log('# walk ' + l.name + ' bop=' + String(l.bop) + ' [' + l.wins + ']');
        walkGate(r);
    });
    test('A4: 100 cycles of createViews(C, d, 3) -> fill -> phase -> clear -> drop, every adapter: tracker.size() 0; retaining control >= 1', () => {
        const r = runChild();
        console.log('# leak ' + JSON.stringify(r.leak) + ' ctl ' + JSON.stringify(r.ctlRetain));
        assert.equal(r.leak.tracked, 6 * 100 * 3 * 2);
        assert.deepEqual([r.leak.size, r.leak.alive, r.leak.fin, r.leak.notReset], [0, 0, 0, 0]);
        assert.ok(r.ctlRetain.size >= 1, 'retaining control must leave size() >= 1');
        assert.ok(r.ctlRetain.alive >= 1, 'retaining control must keep views alive');
    });
    test('g2b-3a A5: BlockedArray.twin runScript, S7 + S7b every phase at n 4096, K = 16 calls / window: < 1 B/event, -2 < B/call < 8, maxMajor 0; one-box control >= 8', () => {
        const r = runChild();
        for (const l of r.twin) console.log('# twin ' + l.name + ' perCall=' + String(l.perCall) + ' bop=' + String(l.bop) + ' calls=' + l.calls + ' [' + l.wins + ']');
        for (const c of r.twinCtl) console.log('# twin control ' + c.name + ' perCall=' + String(c.perCall) + ' [' + c.wins + ']');
        twinGate(r);
    });
    test('g2b-3a A5: 100 cycles resolve twin -> create -> fill -> runScript -> clear -> drop: tracker.size() 0; retaining control >= 1', () => {
        const r = runChild();
        console.log('# twin leak ' + JSON.stringify(r.twinLeak) + ' ctl ' + JSON.stringify(r.twinRetain));
        assert.equal(r.twinLeak.tracked, 100 * 1 * 2);
        assert.deepEqual(r.twinLeak.cycles, { 'BlockedArray.twin': 100 });
        assert.deepEqual([r.twinLeak.size, r.twinLeak.alive, r.twinLeak.fin, r.twinLeak.notReset], [0, 0, 0, 0]);
        assert.ok(r.twinRetain.size >= 1, 'retaining control must leave size() >= 1');
        assert.ok(r.twinRetain.alive >= 1, 'retaining control must keep the handle alive');
    });

    // Y-CI-6a replay: the census b43 node 22.23.4 readings written into a clone of the real child. On HEAD's gates (no
    // meter) every one of them fails except the -880 lane (below); here they are REPORTED on 22.23.4 and still fail on
    // 26.8.2, and the always-gated rows (gc major, field presence, lane count) still fail on 22.23.4.
    // FINDING (burst 44): the S7 / S7b / walk / edit lanes carry no lower bound (perCall < 16, bop < 1), so the census
    // reading SumSequence.v1.* perCall -880 passes the unchanged node >= 24 gate too: it is injected and pinned INSIDE.
    test('Y-CI-6a replay: census readings in a clone of the child are REPORTED on 22.23.4 (each named outside), fail on 26.8.2; gc major 1 / a deleted perCall / a popped lane fail on 22.23.4', () => {
        const real = runChild();
        const injected = [];
        const find = (list, name) => { const l = list.find((x) => x.name === name); assert.ok(l, 'no row ' + name); return l; };
        const inject = () => {
            const c = structuredClone(real);
            injected.length = 0;
            const e = find(c.lanes, 'BlockedArray.v0.edit'); e.perCall = 32; e.bop = 32 / 2000; injected.push(e.name);
            const pc = find(c.controls, 'ctl.allocPerCall'); pc.perCall = -648; pc.bop = -648 / 4000; injected.push(pc.name);
            const w = find(c.walk, 'SumSequence.v1.cursorWalkSum'); w.bop = 2; injected.push(w.name);
            const t = find(c.twin, 'BlockedArray.twin.k16.blend'); t.perCall = 316; t.bop = 316 / (t.warmEvents / t.calls); injected.push(t.name);
            const s = find(c.lanes, 'SumSequence.v1.blend'); s.perCall = -880; s.bop = -880 / 20000;
            return c;
        };
        const lines = [];
        const log = (x) => lines.push(x);
        const c = inject();
        const reps = [a3Gate(c, '22.23.4', log), walkGate(c, '22.23.4', log), twinGate(c, '22.23.4', log)];
        const outside = reps.flatMap((x) => x.outside);
        console.log('# replay 22.23.4 ' + JSON.stringify(outside));
        assert.deepEqual(reps.map((x) => [x.gated, x.reported]), [[false, 315], [false, 18], [false, 18]]);
        for (const name of injected) assert.ok(outside.some((o) => o.startsWith(name + ' ')), name + ' is not an outside row: ' + JSON.stringify(outside));
        assert.ok(!outside.some((o) => o.startsWith('SumSequence.v1.blend ')), 'the -880 lane has no lower bound on any version');
        assert.equal(lines.filter((x) => x.startsWith('# REPORTED ' + METER_REASON + ' [node 22.23.4: ')).length, 3, lines.join('\n'));
        const quiet = () => {};
        const named = (err) => err instanceof assert.AssertionError && injected.some((name) => err.message.startsWith(name + ' '));
        assert.throws(() => a3Gate(inject(), '26.8.2', quiet), named);
        assert.throws(() => walkGate(inject(), '26.8.2', quiet), named);
        assert.throws(() => twinGate(inject(), '26.8.2', quiet), named);
        const g = inject(); g.gc.major = 1;
        assert.throws(() => a3Gate(g, '22.23.4', quiet), (err) => err instanceof assert.AssertionError && /A3 lanes-region gc major/.test(err.message));
        assert.throws(() => twinGate(g, '22.23.4', quiet), (err) => err instanceof assert.AssertionError && /twin lanes-region gc major/.test(err.message));
        const d = inject(); delete find(d.lanes, 'BlockedArray.v0.edit').perCall;
        assert.throws(() => a3Gate(d, '22.23.4', quiet), (err) => err instanceof assert.AssertionError && /has no perCall \/ bop field/.test(err.message));
        const dt = inject(); delete dt.twin[0].perCall;
        assert.throws(() => twinGate(dt, '22.23.4', quiet), (err) => err instanceof assert.AssertionError && /has no perCall \/ bop field/.test(err.message));
        const p = inject(); p.lanes.pop();
        assert.throws(() => a3Gate(p, '22.23.4', quiet), assert.AssertionError);
        const pw = inject(); pw.walk.pop();
        assert.throws(() => walkGate(pw, '22.23.4', quiet), assert.AssertionError);
    });
});

// ---- g2b-3a A3: the BlockedArray.twin A/A control ---------------------------------------------------------------

describe('g2b-3a A3: BlockedArray.twin = BlockedArray.js + one comment line, a separately compiled copy', () => {
    test('variantSource("twin") differs from BlockedArray.js by exactly 1 added line (a comment), nothing else', () => {
        const base = readFileSync(join(PKG, 'benchmark', 'rivals', 'BlockedArray.js'), 'utf8').split('\n');
        const twin = variantSource('twin').split('\n');
        assert.equal(twin.length, base.length + 1);
        let i = 0;
        while (i < base.length && base[i] === twin[i]) i++;
        assert.ok(i < base.length, 'no differing line');
        assert.deepEqual(twin.slice(i + 1), base.slice(i), 'everything after the added line is BlockedArray.js');
        assert.match(twin[i], /^ \* A\/A twin \(BA-29\)/, 'the added line is a comment line inside the header block');
        assert.notEqual(variantSource('twin'), variantSource('unrolled'));
    });
    test('loadVariant("twin") is its own module: its BlockedArray class is neither the registered one nor a second load of plain', async () => {
        const t = (await loadVariant('twin')).BlockedArray;
        assert.equal(typeof t, 'function');
        assert.notEqual(t, BlockedArrayAdapter.Class);
        assert.notEqual(t, (await loadVariant('plain')).BlockedArray);
        assert.notEqual(t, (await loadVariant('unrolled')).BlockedArray);
        const a = await resolveLabel('BlockedArray.twin');
        assert.equal(a.name, 'BlockedArray.twin');
        assert.equal(a.params.variant, 'twin');
    });
    test('cells(Sid, { exclude }) (BA-34): a valid entry removes exactly that cell; every malformed entry throws (fail closed)', () => {
        const all = cells('S7');
        assert.ok(all.some((c) => c.member === 'FenwickRebuild.full' && c.n === 10000), 'S7 has FenwickRebuild.full@10000');
        const key = (c) => c.member + '/' + c.scenario + '@' + c.n;
        for (const ex of ['FenwickRebuild.full/S7@10000', { label: 'FenwickRebuild.full', n: 10000 }]) {
            const got = cells('S7', { exclude: [ex] });
            assert.equal(got.length, all.length - 1, JSON.stringify(ex));
            assert.ok(!got.map(key).includes('FenwickRebuild.full/S7@10000'), JSON.stringify(ex));
            assert.deepEqual(got.map(key), all.map(key).filter((k) => k !== 'FenwickRebuild.full/S7@10000'), JSON.stringify(ex));
        }
        assert.deepEqual(cells('S7', { exclude: [] }), all);
        assert.throws(() => cells('S7', { exclude: ['FenwickRebuild.full/S7b@10000'] }), /names scenario S7b/);
        assert.throws(() => cells('S7', { exclude: [{ label: 'Nope', n: 10000 }] }), /names no cell/);
        assert.throws(() => cells('S7', { exclude: ['FenwickRebuild.full/S7@4096'] }), /names no cell/);
        assert.throws(() => cells('S7', { exclude: 'x' }), /must be an array/);
        assert.throws(() => cells('S7', { exclude: [{ label: 'SumSequence', n: 10000, extra: 1 }] }), /unknown key extra/);
        assert.throws(() => cells('S7', { exclude: [Object.create({ label: 'SumSequence', n: 10000 })] }), /plain/);
        assert.throws(() => cells('S7', { exclude: ['SumSequence/S7@10000', { label: 'SumSequence', n: 10000 }] }), /listed twice/);
        assert.throws(() => cells(undefined, { exclude: [] }), /needs a scenario id/);
    });
    test('every scenario lists BlockedArray.twin right after BlockedArray.plain; cells() carries it at every n', () => {
        for (const sc of SCENARIOS) {
            const i = sc.adapters.indexOf('BlockedArray.plain');
            assert.ok(i >= 0, sc.id);
            assert.equal(sc.adapters[i + 1], 'BlockedArray.twin', sc.id);
            const c = cells(sc.id, { quick: true });
            assert.equal(c.filter((x) => x.member === 'BlockedArray.twin').length, new Set(c.map((x) => x.n)).size, sc.id);
        }
    });
    for (const sc of [S7, S7B]) {
        test('A3 twin parity: ' + sc.id + ' --quick @ 4096: twin checksum / endState / traceHash equal BlockedArray in every phase', async () => {
            const a = await runScenario('BlockedArray', sc, 4096, { seed: SEED, quick: true, samples: 1 });
            const b = await runScenario('BlockedArray.twin', sc, 4096, { seed: SEED, quick: true, samples: 1 });
            assert.deepEqual(b.phases.map((p) => p.phase), a.phases.map((p) => p.phase));
            assert.ok(a.phases.length >= 3);
            for (let k = 0; k < a.phases.length; k++) {
                const p = a.phases[k];
                const q = b.phases[k];
                assert.deepEqual([q.checksum, q.endState, q.traceHash], [p.checksum, p.endState, p.traceHash], sc.id + ' ' + p.phase);
            }
            assert.equal(b.chunkCap, a.chunkCap);
        });
    }
});
