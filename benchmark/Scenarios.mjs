/**
 * @zakkster/lite-yggdrasil -- benchmark scenario registry and runner (the scenario axis).
 *
 * MIT (c) Zahary Shinikchiev <shinikchiev@yahoo.com>
 *
 * Repo-only. Bench-ADOPT group 1 TASK 3 froze the first shape; group 2b-1 TASKS 4-5
 * (.handoff/PLAN-bench-adopt-g2b1.md; SPEC-bench-adopt BA-17 = maintainer ruling R-BA15, BA-20 =
 * R-BA18) set the shape below and register S7 / S7b. g2b-2 registers S1 (S1a / S1b) and S2
 * (S2 / S2a / S2b) against the same shape.
 *
 * SCENARIO shape (validateScenario, fail closed, every error names the field): a plain object (own
 * keys only, no Symbol keys) with exactly the keys
 *   { id: /^S\d+[a-z]?$/, title: non-empty string, dims: integer 1..4, views: 1 | 3,
 *     mix: non-empty plain object (ratios, positions, measure distribution, events; printed in the
 *     report header), adapters: non-empty scenario labels (knownLabels(); the foil runs no scenario),
 *     sizes: non-empty int[] in [1, 2^20], build(adapter, n, seed, events?) }
 * build() returns { capacity, fill: Int32Array(n x dims), phases: [{ name, events, script }] }.
 * PHASES = seek | walk | reweight | edit | bulk | blend ('splice' is retired). A phase replays its
 * class's events (PHASE_CLASS) out of ONE stream of STREAM_EVENTS (20 blocks of 1,000) events, in
 * stream order; blend replays the whole stream and is last.
 *
 * A script is an Int32Array of REC = 4-slot records [op, a, b, c] (the OP table). build() runs
 * cold: a PRNG plus an exact model of the measure column (S7: a cold Fenwick tree) precomputes every
 * argument, so runScript (the one hot body) holds no PRNG, no float, no check and no allocation.
 * validateBuilt (cold) owns the unknown-opcode and range throws.
 *
 * Runner (runScenario, cold around one hot runScript call per sample): it creates the handle
 * (create(), or createViews(C, dims, 3)[0] for 3 views), fills it untimed, refills it before the
 * count pass and before every timed sample of every phase, and checks length() === n after each.
 * The checksum of a phase is runScript's Smi acc; its endState is the cold phaseEndState digest
 * (length + sampled sumBefore, so a phase of void ops is checked too); its traceHash is
 * scenarioHash(fill, script). Every adapter of one (scenario, n) must agree on all three
 * (Bench.mjs crossCheck).
 *
 * S7 / S7b (maintainer ruling R-BA18, 2026-11-01, "Suffix, no FenwickFixed"): the Fenwick rival
 * is FenwickRebuild mode 'suffix'; FenwickRebuild.full stays as the LiteVirtual-today row. The
 * FenwickFixed slot is RETIRED: R-BA18 "S7 / S7b run FenwickRebuild mode 'suffix'; no
 * fixed-length Fenwick counter-foil is built" (Adapters.mjs RETIRED_SLOTS; the reason is also in
 * each S7 mix and in meta.rivals).
 * ASCII only.
 */

import { isPlain, didYouMean, ADAPTERS, RIVAL_SLOTS, RETIRED_SLOTS, NA, NC, selectAdapter, countsRecord, validateCounts,
    blockedArrayAdapter } from './Adapters.mjs';
import { VARIANTS } from './rivals/variant.mjs';
import { prng, median, percentile, foldHash, gcNow, DEFAULT_SEED } from './Harness.mjs';

/** Largest scenario size: the bench law keeps measures <= 255 so totals stay < 2^28 at n = 2^20. */
export const MAX_SIZE = 1 << 20;
/** One stream: 20 blocks of 1,000 events (R-BA15). */
export const STREAM_EVENTS = 20000;
export const BLOCK_EVENTS = 1000;
/** --quick caps every size at QUICK_SIZE (deduped) and the stream at STREAM_EVENTS / QUICK_DIV. */
export const QUICK_SIZE = 4096;
export const QUICK_DIV = 10;
/** Rows per chunk of the append fill (fillHandle). */
export const FILL_CHUNK = 1024;

export const PHASES = Object.freeze(['seek', 'walk', 'reweight', 'edit', 'bulk', 'blend']);

/** Int32 slots per script record. */
export const REC = 4;

/**
 * The opcode table. Each record is [op, a, b, c]:
 *   INSERT [1, i, m0, m1] h.insertAt(i, i, m0, m1) (entity = i; dims <= 2)
 *   REMOVE [2, i, 0, 0]   h.removeAt(i)
 *   SET    [3, i, d, m]   h.setMeasure(i, d, m)
 *   SEEK   [4, d, y, 0]   r = h.indexAtSum(d, y)
 *   SUM    [5, d, i, 0]   r = h.sumBefore(d, i)
 *   WALK   [6, d, y, k]   r = h.cursorWalkSum(d, y, k)
 * acc = (acc + r) | 0 for the ops that return a value.
 */
export const OP = Object.freeze({ INSERT: 1, REMOVE: 2, SET: 3, SEEK: 4, SUM: 5, WALK: 6 });
const OP_MAX = 6;

/** The phase class of each opcode (a class phase replays the stream's records of its class). */
export const PHASE_CLASS = Object.freeze({ 1: 'edit', 2: 'edit', 3: 'reweight', 4: 'seek', 5: 'seek', 6: 'walk' });

const WALK_K_MAX = 1024;
const MEAS_MAX = 255;
const SCENARIO_KEYS = ['id', 'title', 'dims', 'views', 'mix', 'adapters', 'sizes', 'build'];
const BUILT_KEYS = ['capacity', 'fill', 'phases'];
const PHASE_KEYS = ['name', 'events', 'script'];

function scFail(where, detail) {
    throw new Error('[bench] scenario ' + where + ': ' + detail);
}

// ---------------------------------------------------------------------------
// Labels: a scenario cell names an adapter by LABEL. A label is a registered adapter name
// ('BlockedArray' = the registered 'unrolled' variant), or 'BlockedArray.<variant>' for every other
// benchmark/rivals/variant.mjs variant, built by blockedArrayAdapter(<variant>). The label keeps the
// result keys unique per variant.
// ---------------------------------------------------------------------------

const BA = 'BlockedArray';
const BA_PREFIX = BA + '.';

/** Every label a scenario may list (SpliceFoil, the primary foil, runs no scenario). */
export function knownLabels() {
    const out = [];
    for (const a of ADAPTERS) {
        if (a.role === 'primary') continue;
        if (!out.includes(a.name)) out.push(a.name);
        if (a.name === BA) {
            for (const v of Object.keys(VARIANTS)) {
                if (v !== 'unrolled' && !out.includes(BA_PREFIX + v)) out.push(BA_PREFIX + v);
            }
        }
    }
    return out;
}

/** The registered adapter name a label runs ('BlockedArray.plain' -> 'BlockedArray'). */
export function labelBase(label) {
    if (typeof label === 'string' && label.startsWith(BA_PREFIX) && label !== BA_PREFIX + 'unrolled' &&
        Object.prototype.hasOwnProperty.call(VARIANTS, label.slice(BA_PREFIX.length))) return BA;
    return label;
}

/** The adapter a label runs (cold; a BlockedArray variant is built by blockedArrayAdapter). */
export async function resolveLabel(label) {
    if (!knownLabels().includes(label)) {
        scFail('label', "unknown adapter label '" + String(label) + "'" + didYouMean(String(label), knownLabels()));
    }
    if (label !== BA && labelBase(label) === BA) return blockedArrayAdapter(label.slice(BA_PREFIX.length));
    return selectAdapter(label);
}

// ---------------------------------------------------------------------------
// Validation (cold).
// ---------------------------------------------------------------------------

function validMixValue(v, depth) {
    if (typeof v === 'string') return v.length > 0;
    if (typeof v === 'number') return Number.isFinite(v);
    if (depth === 0 && isPlain(v)) {
        const ks = Object.keys(v);
        return ks.length > 0 && ks.every((k) => validMixValue(v[k], 1));
    }
    return false;
}

/** Fail-closed shape check of one registry entry. Returns it. */
export function validateScenario(s) {
    // own keys only: a plain object (no prototype keys, no Symbol keys, not an array)
    if (!isPlain(s)) scFail('(root)', 'must be a plain object');
    for (const k of Object.keys(s)) {
        if (!SCENARIO_KEYS.includes(k)) scFail(k, 'unknown key' + didYouMean(k, SCENARIO_KEYS));
    }
    for (const k of SCENARIO_KEYS) {
        if (!Object.prototype.hasOwnProperty.call(s, k)) scFail(k, 'missing');
    }
    if (typeof s.id !== 'string' || !/^S\d+[a-z]?$/.test(s.id)) scFail('id', 'must match S<digits>[a-z]');
    if (typeof s.title !== 'string' || s.title.length === 0) scFail(s.id + '.title', 'must be a non-empty string');
    if (!Number.isInteger(s.dims) || s.dims < 1 || s.dims > 4) scFail(s.id + '.dims', 'must be an integer in 1..4');
    if (s.views !== 1 && s.views !== 3) scFail(s.id + '.views', 'must be 1 or 3');
    if (!isPlain(s.mix) || Object.keys(s.mix).length === 0) scFail(s.id + '.mix', 'must be a non-empty plain object');
    for (const k of Object.keys(s.mix)) {
        if (!validMixValue(s.mix[k], 0)) {
            scFail(s.id + '.mix.' + k, 'must be a non-empty string, a finite number or a plain object of those');
        }
    }
    if (!Array.isArray(s.adapters) || s.adapters.length === 0) scFail(s.id + '.adapters', 'must be a non-empty array');
    const known = knownLabels().concat(Object.keys(RIVAL_SLOTS));
    const seen = new Set();
    for (const a of s.adapters) {
        if (typeof a !== 'string' || a.length === 0) scFail(s.id + '.adapters', 'entries must be adapter labels');
        if (a === 'SpliceFoil') scFail(s.id + '.adapters', 'SpliceFoil runs no scenario (D-rows only, R-BA15)');
        if (Object.prototype.hasOwnProperty.call(RETIRED_SLOTS, a)) {
            scFail(s.id + '.adapters', "'" + a + "' is RETIRED: " + RETIRED_SLOTS[a].reason);
        }
        if (!known.includes(a)) scFail(s.id + '.adapters', "unknown adapter '" + a + "'" + didYouMean(a, known));
        if (seen.has(a)) scFail(s.id + '.adapters', "duplicate label '" + a + "'");
        seen.add(a);
        if (s.views === 3 && !Object.prototype.hasOwnProperty.call(RIVAL_SLOTS, a)) {
            const ad = selectAdapter(labelBase(a));
            if (typeof ad.createViews !== 'function') {
                scFail(s.id + '.adapters', "'" + a + "' has no createViews (views 3): " + ad.na.createViews);
            }
        }
    }
    if (!Array.isArray(s.sizes) || s.sizes.length === 0) scFail(s.id + '.sizes', 'must be a non-empty array');
    for (const n of s.sizes) {
        if (!Number.isInteger(n) || n < 1 || n > MAX_SIZE) scFail(s.id + '.sizes', 'entries must be integers in [1, 2^20]');
    }
    if (typeof s.build !== 'function') scFail(s.id + '.build', 'must be a function');
    return s;
}

/**
 * Fail-closed check of one build(adapter, n, seed) result against n and dims. Returns it. Range
 * checks run against a simulated length; the phase need not end at length n (the runner's
 * length() check owns that, so a planted unbalanced script fails there, "length n+1 != n").
 */
export function validateBuilt(id, built, n, dims) {
    if (!isPlain(built)) scFail(id + '.build()', 'must return a plain object { capacity, fill, phases }');
    for (const k of Object.keys(built)) if (!BUILT_KEYS.includes(k)) scFail(id + '.build().' + k, 'unknown key' + didYouMean(k, BUILT_KEYS));
    if (!Number.isInteger(n) || n < 1 || n > MAX_SIZE) scFail(id + '.n', 'must be an integer in [1, 2^20]');
    if (!Number.isInteger(dims) || dims < 1 || dims > 4) scFail(id + '.dims', 'must be an integer in 1..4');
    const C = built.capacity;
    if (!Number.isInteger(C) || C < n || C > MAX_SIZE + 1024) scFail(id + '.capacity', 'must be an integer in [n, 2^20 + 1024]');
    const f = built.fill;
    if (!(f instanceof Int32Array) || f.length !== n * dims) scFail(id + '.fill', 'must be an Int32Array of n x dims');
    for (let j = 0; j < f.length; j++) {
        if (!(f[j] >= 0 && f[j] <= MEAS_MAX)) scFail(id + '.fill[' + j + ']', 'must be a measure in [0, 255]');
    }
    if (!Array.isArray(built.phases) || built.phases.length === 0) scFail(id + '.phases', 'must be a non-empty array');
    const names = [];
    for (let j = 0; j < built.phases.length; j++) {
        const p = built.phases[j];
        const w = id + '.phases[' + j + ']';
        if (!isPlain(p)) scFail(w, 'must be a plain object { name, events, script }');
        for (const k of Object.keys(p)) if (!PHASE_KEYS.includes(k)) scFail(w + '.' + k, 'unknown key' + didYouMean(k, PHASE_KEYS));
        if (!PHASES.includes(p.name)) scFail(w + '.name', 'must be one of ' + PHASES.join(' | '));
        if (names.includes(p.name)) scFail(w + '.name', "duplicate phase '" + p.name + "'");
        names.push(p.name);
        const S = p.script;
        if (!(S instanceof Int32Array) || S.length === 0 || S.length % REC !== 0) {
            scFail(w + '.script', 'must be a non-empty Int32Array of ' + REC + '-slot records');
        }
        // events <= ops: a smaller declared count would inflate ns/event
        if (!Number.isInteger(p.events) || p.events < 1 || p.events > S.length / REC) {
            scFail(w + '.events', 'must be an integer in [1, ops = ' + (S.length / REC) + ']');
        }
        let len = n;
        for (let k = 0; k < S.length; k += REC) {
            const op = S[k], a = S[k + 1], b = S[k + 2], c = S[k + 3];
            const r = w + '.script record ' + (k / REC);
            if (!(op >= 1 && op <= OP_MAX)) scFail(r, 'unknown opcode ' + op);
            if (op === OP.INSERT) {
                if (dims > 2) scFail(r, 'INSERT carries 2 measures: dims must be <= 2');
                if (!(a >= 0 && a <= len)) scFail(r, 'INSERT index ' + a + ' outside [0, ' + len + ']');
                if (!(b >= 0 && b <= MEAS_MAX && c >= 0 && c <= MEAS_MAX)) scFail(r, 'INSERT measure outside [0, 255]');
                if (len + 1 > C) scFail(r, 'INSERT past capacity ' + C);
                len++;
            } else if (op === OP.REMOVE) {
                if (!(a >= 0 && a < len)) scFail(r, 'REMOVE index ' + a + ' outside [0, ' + len + ')');
                len--;
            } else if (op === OP.SET) {
                if (!(a >= 0 && a < len)) scFail(r, 'SET index ' + a + ' outside [0, ' + len + ')');
                if (!(b >= 0 && b < dims)) scFail(r, 'SET dim ' + b + ' outside [0, ' + dims + ')');
                if (!(c >= 0 && c <= MEAS_MAX)) scFail(r, 'SET measure ' + c + ' outside [0, 255]');
            } else {
                if (!(a >= 0 && a < dims)) scFail(r, 'dim ' + a + ' outside [0, ' + dims + ')');
                if (op === OP.SUM) {
                    if (!(b >= 0 && b <= len)) scFail(r, 'SUM index ' + b + ' outside [0, ' + len + ']');
                } else if (!(b >= 0)) {
                    scFail(r, 'seek y ' + b + ' must be >= 0');
                }
                if (op === OP.WALK && !(c >= 1 && c <= WALK_K_MAX)) scFail(r, 'WALK k ' + c + ' outside [1, ' + WALK_K_MAX + ']');
            }
        }
    }
    const b = names.indexOf('blend');
    if (b !== -1 && b !== names.length - 1) scFail(id + '.phases', "'blend' must be the last phase");
    return built;
}

/** The registered scenario by id; an unknown id throws "unknown scenario <id>". */
export function selectScenario(id) {
    for (const s of SCENARIOS) if (s.id === id) return validateScenario(s);
    throw new Error('unknown scenario ' + String(id));
}

/** A scenario's sizes; quick caps each at QUICK_SIZE (deduped, order kept). */
export function scenarioSizes(s, quick) {
    if (!quick) return s.sizes.slice();
    const out = [];
    for (const n of s.sizes) {
        const m = Math.min(n, QUICK_SIZE);
        if (!out.includes(m)) out.push(m);
    }
    return out;
}

/** Events of one stream: STREAM_EVENTS, or STREAM_EVENTS / QUICK_DIV for --quick. */
export function scenarioEvents(quick) {
    return quick ? STREAM_EVENTS / QUICK_DIV : STREAM_EVENTS;
}

// ---------------------------------------------------------------------------
// HOT: the interpreter. One handle call per record; no allocation, no check (validateBuilt is
// the cold gate; an opcode it did not admit cannot reach here). Returns the Smi acc.
// ---------------------------------------------------------------------------

export function runScript(h, script) {
    let acc = 0;
    const L = script.length;
    for (let k = 0; k < L; k += 4) {
        const a = script[k + 1];
        const b = script[k + 2];
        const c = script[k + 3];
        switch (script[k]) {
            case 1: h.insertAt(a, a, b, c); break;
            case 2: h.removeAt(a); break;
            case 3: h.setMeasure(a, b, c); break;
            case 4: acc = (acc + h.indexAtSum(a, b)) | 0; break;
            case 5: acc = (acc + h.sumBefore(a, b)) | 0; break;
            case 6: acc = (acc + h.cursorWalkSum(a, b, c)) | 0; break;
            default: break;
        }
    }
    return acc;
}

/** The phase traceHash: FNV-1a over the fill, then the script (uint32). Cold. */
export function scenarioHash(fill, script) {
    let h = 0x811c9dc5 >>> 0;
    for (let j = 0; j < fill.length; j++) h = foldHash(h, fill[j]);
    for (let j = 0; j < script.length; j++) h = foldHash(h, script[j]);
    return h >>> 0;
}

// ---------------------------------------------------------------------------
// Runner (cold around the hot runScript).
// ---------------------------------------------------------------------------

/**
 * Cold end-of-phase state digest (uint32): FNV-1a fold of length() and sumBefore(d, i) for every
 * d < dims at i = 0, step, 2 x step, ..., then n (step = max(1, n >> 6)). runScript's checksum
 * cannot see a phase of void ops (reweight = setMeasure only reads 0 on every adapter); this
 * digest can, and Bench.mjs crossCheck compares it ("endState mismatch").
 */
export function phaseEndState(h, n, dims) {
    let x = foldHash(0x811c9dc5 >>> 0, h.length());
    const step = Math.max(1, n >> 6);
    for (let d = 0; d < dims; d++) {
        for (let i = 0; i < n; i += step) x = foldHash(x, h.sumBefore(d, i));
        x = foldHash(x, h.sumBefore(d, n));
    }
    return x >>> 0;
}

/** Throws "length <len> != <n>" (A2) unless the handle holds exactly n rows. */
export function checkLength(h, n, where) {
    const len = h.length();
    if (len !== n) scFail(where, 'length ' + len + ' != ' + n);
}

function insertRow(h, at, row, fill, dims) {
    const o = row * dims;
    h.insertAt(at, row, fill[o], fill[o + 1], fill[o + 2], fill[o + 3]);
}

/**
 * Cold: an empty FILL_CHUNK-capacity handle that two create() handles of this adapter can
 * append into each other, or null. FenwickRebuild.full rebuilds its whole tree on every insert
 * (O(n) each), so an insert-by-insert fill of 10^6 rows is O(n^2); through a partner it is one
 * append (one O(n) rebuild) per chunk. An arena adapter (SumSequence, BlockedArray) cannot append
 * across create() handles and fills row by row.
 */
export function appendPartner(adapter, dims, tune) {
    if (typeof adapter.na.append === 'string') return null;
    try {
        const a = adapter.create(4, dims, tune);
        const b = adapter.create(4, dims, tune);
        if (typeof a.append !== 'function') return null;
        b.insertAt(0, 0, 1, 1, 1, 1);
        a.append(b);
        if (a.length() !== 1 || b.length() !== 0) return null;
    } catch (e) {
        return null;
    }
    return adapter.create(FILL_CHUNK, dims, tune);
}

/** Cold: clear h, then fill rows 0..n-1 at the end (entity = row), through partner when given. */
export function fillHandle(h, fill, n, dims, partner) {
    h.clear();
    if (partner === null || partner === undefined) {
        for (let i = 0; i < n; i++) insertRow(h, i, i, fill, dims);
        return;
    }
    for (let base = 0; base < n; base += FILL_CHUNK) {
        partner.clear();
        const end = Math.min(n, base + FILL_CHUNK);
        for (let i = base; i < end; i++) insertRow(partner, i - base, i, fill, dims);
        h.append(partner);
    }
}

/**
 * One scenario cell: label x scenario x n. opts { seed, quick, tune, samples }. Returns the
 * cell result (phase rows in build order). Throws on a length mismatch, a checksum drift between
 * the count pass and a timed sample, or a bad build.
 */
export async function runScenario(label, scenario, n, opts = {}) {
    const s = validateScenario(scenario);
    if (!s.adapters.includes(label)) scFail(s.id + '.adapters', "'" + String(label) + "' is not a label of " + s.id);
    const adapter = await resolveLabel(label);
    const seed = (opts.seed ?? DEFAULT_SEED) >>> 0;
    const quick = opts.quick === true;
    const events = scenarioEvents(quick);
    const samples = opts.samples ?? (quick ? 3 : 5);
    if (!Number.isInteger(samples) || samples < 1 || samples > 99) scFail(s.id + '.samples', 'must be an integer in [1, 99]');
    const tune = opts.tune;
    const built = validateBuilt(s.id, s.build(adapter, n, seed, events), n, s.dims);
    const dims = s.dims;
    const partner = s.views === 1 ? appendPartner(adapter, dims, tune) : null;
    const views = s.views === 3 ? adapter.createViews(built.capacity, dims, 3, tune) : [adapter.create(built.capacity, dims, tune)];
    const h = views[0];
    // the chunkCap this run used (BlockedArray), read from the instance after create; else 'n/a'
    const chunkCap = h.instance !== undefined && typeof h.instance.chunkCap === 'number' ? h.instance.chunkCap : NA;
    const refill = () => {
        for (let v = 1; v < views.length; v++) views[v].clear();
        fillHandle(h, built.fill, n, dims, partner);
    };
    const cnt = new Int32Array(NC);
    const ext = new Float64Array(adapter.extraCounts.length);
    const ns = new Float64Array(samples);
    const rows = [];
    for (const p of built.phases) {
        const where = s.id + '@' + n + ' ' + label + ' phase ' + p.name;
        const ops = p.script.length / REC;
        refill();
        checkLength(h, n, where + ' (fill)');
        h.resetCounts();
        const checksum = runScript(h, p.script);
        checkLength(h, n, where);
        h.readCounts(cnt);
        if (ext.length > 0) h.readExtras(ext);
        const endState = phaseEndState(h, n, dims); // after the counts read: its probes stay out of the counts
        const rec = countsRecord(adapter, cnt, ext);
        validateCounts(adapter, rec, where); // a wrapped (negative) Int32 counter throws here
        for (let j = 0; j < samples; j++) {
            refill();
            gcNow();
            const t0 = process.hrtime.bigint();
            const r = runScript(h, p.script);
            const t1 = process.hrtime.bigint();
            if (r !== checksum) scFail(where, 'checksum drift: sample ' + j + ' read ' + r + ', count pass ' + checksum);
            checkLength(h, n, where);
            ns[j] = Number(t1 - t0) / p.events;
        }
        const sorted = Float64Array.from(ns).sort();
        rows.push({
            phase: p.name, unit: 'ns/event', events: p.events, ops,
            nsPerOp: median(ns), p50: percentile(sorted, 50), p90: percentile(sorted, 90),
            counts: rec.counts, extras: rec.extras, checksum, endState, traceHash: scenarioHash(built.fill, p.script),
        });
    }
    for (const v of views) v.clear();
    if (partner !== null) partner.clear();
    return {
        scenario: s.id, title: s.title, member: label, adapter: adapter.name, n, dims, views: s.views,
        capacity: built.capacity, seed, events, tune: tune === undefined ? NA : tune, chunkCap, mix: s.mix,
        unit: 'ns/event', phases: rows,
    };
}

// ---------------------------------------------------------------------------
// Scenario builders (cold): PRNG + an exact model of the measure column.
// ---------------------------------------------------------------------------

const TWO32 = 4294967296;

/** uniform integer in [0, m) from one uint32 draw (m <= 2^31). */
function uni(r, m) {
    return Math.floor((r() / TWO32) * m);
}

/** Cold Fenwick model of one measure column (1-based tree), the STRICT M-7 find. */
function fenwickModel(fill, n) {
    const t = new Float64Array(n + 1);
    for (let i = 1; i <= n; i++) t[i] = fill[i - 1];
    for (let i = 1; i <= n; i++) {
        const p = i + (i & -i);
        if (p <= n) t[p] += t[i];
    }
    const m = Int32Array.from(fill);
    let total = 0;
    for (let i = 0; i < n; i++) total += fill[i];
    const top = n > 0 ? 2 ** Math.floor(Math.log2(n)) : 0;
    return {
        total: () => total,
        set(i, w) {
            const dlt = w - m[i];
            m[i] = w;
            total += dlt;
            for (let j = i + 1; j <= n; j += j & -j) t[j] += dlt;
        },
        /** smallest i with prefix(i) + m_i > y, else n */
        find(y) {
            let pos = 0;
            let rem = y;
            for (let step = top; step > 0; step = Math.floor(step / 2)) {
                const nx = pos + step;
                if (nx <= n && t[nx] <= rem) { pos = nx; rem -= t[nx]; }
            }
            return pos;
        },
    };
}

function checkBuildArgs(id, n, events) {
    if (!Number.isInteger(n) || n < 1 || n > MAX_SIZE) scFail(id + '.build', 'n must be an integer in [1, 2^20]');
    if (!Number.isInteger(events) || events < BLOCK_EVENTS || events % BLOCK_EVENTS !== 0) {
        scFail(id + '.build', 'events must be a positive multiple of ' + BLOCK_EVENTS);
    }
}

/** Assemble phases from one stream of [op, a, b, c] records, in the requested order (blend last). */
function phasesFrom(stream, order) {
    const out = [];
    for (const name of order) {
        const recs = [];
        for (let k = 0; k < stream.length; k += REC) {
            if (name === 'blend' || PHASE_CLASS[stream[k]] === name) recs.push(k);
        }
        const script = new Int32Array(recs.length * REC);
        for (let j = 0; j < recs.length; j++) {
            for (let q = 0; q < REC; q++) script[j * REC + q] = stream[recs[j] + q];
        }
        out.push({ name, events: recs.length, script });
    }
    return out;
}

/**
 * S7 / S7b stream (R-BA18). drawsPerSet = 1: S7, each draw followed by setMeasure on the drawn i.
 * drawsPerSet = 19: S7b, 19 draws then one setMeasure at a uniform i (950 + 50 per 1,000).
 */
function buildWeighted(id, drawsPerSet) {
    return function build(adapter, n, seed, events = STREAM_EVENTS) {
        checkBuildArgs(id, n, events);
        const r = prng((seed ^ Math.imul(n, 0x9e3779b1) ^ (drawsPerSet === 1 ? 0x5707 : 0x570b)) >>> 0);
        const fill = new Int32Array(n);
        for (let i = 0; i < n; i++) fill[i] = 1 + uni(r, MEAS_MAX);
        const model = fenwickModel(fill, n);
        const stream = new Int32Array(events * REC);
        let k = 0;
        const per = drawsPerSet + 1;
        for (let e = 0; e < events; e += per) {
            let drawn = -1;
            for (let j = 0; j < drawsPerSet; j++) {
                const tot = model.total();
                const y = tot > 0 ? Math.min(uni(r, tot), tot - 1) : 0;
                drawn = model.find(y);
                stream[k] = OP.SEEK; stream[k + 1] = 0; stream[k + 2] = y; stream[k + 3] = 0;
                k += REC;
            }
            // S7: the drawn i (a draw past the last row -- total 0 -- falls back to a uniform i);
            // S7b: a uniform i.
            const i = drawsPerSet === 1 && drawn >= 0 && drawn < n ? drawn : uni(r, n);
            const w = uni(r, MEAS_MAX + 1);
            model.set(i, w);
            stream[k] = OP.SET; stream[k + 1] = i; stream[k + 2] = 0; stream[k + 3] = w;
            k += REC;
        }
        return { capacity: n, fill, phases: phasesFrom(stream, ['seek', 'reweight', 'blend']) };
    };
}

const S7_ADAPTERS = ['SumSequence', 'BlockedArray', 'BlockedArray.plain', 'FenwickRebuild.suffix',
    'FenwickRebuild.full'];
const S7_RIVALS = "FenwickRebuild mode 'suffix' is the Fenwick rival (R-BA18); FenwickRebuild.full is the " +
    'LiteVirtual-today row';

export const SCENARIOS = Object.freeze([
    Object.freeze({
        id: 'S7',
        title: 'Weighted pick: draw by a uniform running total, then reweight the drawn row',
        dims: 1,
        views: 1,
        mix: Object.freeze({
            perBlock: '500 indexAtSum(0, y), each followed by setMeasure(i, 0, w) on the drawn i',
            positions: 'y uniform in [0, total); i = the index the draw returned',
            measures: 'fill uniform in [1, 255]; w uniform in [0, 255]',
            events: STREAM_EVENTS,
            phases: 'seek, reweight, blend (blend last)',
            rivals: S7_RIVALS,
            retired: 'FenwickFixed -- ' + RETIRED_SLOTS.FenwickFixed.reason,
        }),
        adapters: S7_ADAPTERS,
        sizes: [10000, 100000, 1000000],
        build: buildWeighted('S7', 1),
    }),
    Object.freeze({
        id: 'S7b',
        title: 'Weighted pick, read-heavy: 950 draws + 50 reweights at a uniform row per 1,000 events',
        dims: 1,
        views: 1,
        mix: Object.freeze({
            perBlock: '950 indexAtSum(0, y) + 50 setMeasure(i, 0, w); 19 draws, then one setMeasure',
            positions: 'y uniform in [0, total); i uniform in [0, n)',
            measures: 'fill uniform in [1, 255]; w uniform in [0, 255]',
            events: STREAM_EVENTS,
            phases: 'seek, reweight, blend (blend last)',
            rivals: S7_RIVALS,
            retired: 'FenwickFixed -- ' + RETIRED_SLOTS.FenwickFixed.reason,
        }),
        adapters: S7_ADAPTERS,
        sizes: [10000, 100000, 1000000],
        build: buildWeighted('S7b', 19),
    }),
]);
for (const s of SCENARIOS) validateScenario(s);
