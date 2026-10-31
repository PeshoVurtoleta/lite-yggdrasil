/**
 * @zakkster/lite-yggdrasil -- benchmark adapters (the subject / foil / rival registry).
 *
 * MIT (c) Zahary Shinikchiev <shinikchiev@yahoo.com>
 *
 * Repo-only (never in package.json files[], never imported by Yggdrasil.js). Bench-ADOPT
 * group 1 TASK 3 (.handoff/PLAN-bench-adopt-g1.md SPEC "ADAPTER"); B3 freezes this contract,
 * group 2b fills RIVAL_SLOTS through rivalAdapter() below without changing it.
 *
 * ADAPTER (validateAdapter, fail closed, every error names the bad field):
 *   { name, role: 'subject'|'primary'|'rival'|'counter', version: 'hand-written'|semver,
 *     params: plain object (printed in the report header), counterMap: bool[12] in
 *     SumSequence.COUNTERS order, extraCounts: string[] (native counters with no engine
 *     pair), na: { op: reason } for every optional op the handle lacks,
 *     create(capacity, dims, tune?) -> handle, createPair?(capacity, dims, tune?) -> [a, b] }
 *   handle: insertAt(i, e, m0, m1?, m2?, m3?) (slots past dims are ignored, never forwarded:
 *     the engine rejects a defined slot beyond dims), removeAt(i), setMeasure(i, d, m),
 *     indexAtSum(d, y), sumBefore(d, i), length(), clear(), readCounts(Int32Array(12)),
 *     resetCounts(), readExtras(Float64Array(extraCounts.length)) when extraCounts is non-empty;
 *     optional: splitAt(i, out), append(other) (out / other from createPair), cursorWalk(i, k)
 *     (seek to i, then up to k - 1 next(); returns the elements visited), bytes() (typed-array
 *     bytes held). A missing optional op is legal only with its na[op] reason; a present op
 *     with an na reason is a contradiction (throws).
 *   tune: adapter-specific knobs (SumSequence: { leafSize }), validated by the adapter.
 *
 * COUNTS record (countsRecord): 12 keys touches..seamRepairs in COUNTERS order; an integer
 * where counterMap is true, the STRING 'n/a' where it is false (never 0); extras = named
 * integers. validateCounts throws on a missing key, a negative or non-integer count, a number in
 * an n/a slot, or an extras key set that is not exactly extraCounts. A paired counter >= 2^31
 * throws on readCounts (never wraps into the Int32Array(12)); a rival whose readCounters takes a
 * Float64Array is read through one (acceptsF64), so its extras stay exact.
 *
 * Hot path: the handle methods forward to the instance and allocate nothing (the B/op lanes
 * in benchmark/kernel-lane.mjs gate the SumSequence ones). Everything else here is cold.
 * ASCII only.
 */

import { SumSequence, VERSION } from '../Yggdrasil.js';

export const NA = 'n/a';
export const NC = 12;

/** Engine counter names in COUNTERS index order (read from the engine, never retyped). */
export const COUNTER_NAMES = Object.freeze(Object.keys(SumSequence.COUNTERS)
    .sort((a, b) => SumSequence.COUNTERS[a] - SumSequence.COUNTERS[b]));

export const ROLES = Object.freeze(['subject', 'primary', 'rival', 'counter']);
export const REQUIRED_OPS = Object.freeze(['insertAt', 'removeAt', 'setMeasure', 'indexAtSum', 'sumBefore',
    'length', 'clear', 'readCounts', 'resetCounts']);
export const OPTIONAL_OPS = Object.freeze(['splitAt', 'append', 'cursorWalk', 'bytes']);
const ADAPTER_KEYS = ['name', 'role', 'version', 'params', 'counterMap', 'extraCounts', 'na', 'create',
    'createPair'];
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

// ---- cold helpers --------------------------------------------------------------------------

function adFail(field, detail) {
    throw new Error('[bench] adapter ' + field + ': ' + detail);
}

function lev(a, b) {
    const m = a.length;
    const n = b.length;
    let prev = new Int32Array(n + 1);
    let cur = new Int32Array(n + 1);
    for (let j = 0; j <= n; j++) prev[j] = j;
    for (let i = 1; i <= m; i++) {
        cur[0] = i;
        for (let j = 1; j <= n; j++) {
            const c = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
            cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + c);
        }
        const t = prev; prev = cur; cur = t;
    }
    return prev[n];
}

/** Did-you-mean hint for an unknown key (cold). */
export function didYouMean(key, known) {
    let best = '';
    let bd = Infinity;
    for (const k of known) {
        const d = lev(String(key), k);
        if (d < bd) { bd = d; best = k; }
    }
    return bd <= 3 ? ", did you mean '" + best + "'?" : '';
}

/** A plain object: prototype Object.prototype or null, not an array, no Symbol keys. */
export function isPlain(o) {
    if (o === null || typeof o !== 'object' || Array.isArray(o)) return false;
    const p = Object.getPrototypeOf(o);
    if (p !== Object.prototype && p !== null) return false;
    return Object.getOwnPropertySymbols(o).length === 0;
}

// ---- validateAdapter -----------------------------------------------------------------------

/**
 * Fail-closed adapter check. Builds one probe handle (capacity 8, dims 1) to check the method
 * surface. Returns the adapter. Every throw names the field.
 */
export function validateAdapter(a) {
    if (!isPlain(a)) adFail('(root)', 'must be a plain object');
    for (const k of Object.keys(a)) {
        if (!ADAPTER_KEYS.includes(k)) adFail(k, 'unknown key' + didYouMean(k, ADAPTER_KEYS));
    }
    if (typeof a.name !== 'string' || a.name.length === 0) adFail('name', 'must be a non-empty string');
    if (!ROLES.includes(a.role)) adFail('role', 'must be one of ' + ROLES.join(' | '));
    if (a.version !== 'hand-written' && !(typeof a.version === 'string' && SEMVER.test(a.version))) {
        adFail('version', "must be 'hand-written' or a semver");
    }
    if (!isPlain(a.params)) adFail('params', 'must be a plain object');
    const cm = a.counterMap;
    if (!Array.isArray(cm) || cm.length !== NC) adFail('counterMap', 'must be an array of ' + NC + ' booleans');
    for (let j = 0; j < NC; j++) {
        if (typeof cm[j] !== 'boolean') adFail('counterMap', 'slot ' + j + ' (' + COUNTER_NAMES[j] + ') must be a boolean');
    }
    const ex = a.extraCounts;
    if (!Array.isArray(ex)) adFail('extraCounts', 'must be an array of strings');
    for (const s of ex) {
        if (typeof s !== 'string' || s.length === 0) adFail('extraCounts', 'entries must be non-empty strings');
        if (COUNTER_NAMES.includes(s)) adFail('extraCounts', "'" + s + "' shadows an engine counter name");
    }
    if (new Set(ex).size !== ex.length) adFail('extraCounts', 'duplicate name');
    if (!isPlain(a.na)) adFail('na', 'must be a plain object');
    for (const k of Object.keys(a.na)) {
        if (!OPTIONAL_OPS.includes(k)) adFail('na.' + k, 'not an optional op' + didYouMean(k, OPTIONAL_OPS));
        if (typeof a.na[k] !== 'string' || a.na[k].length === 0) adFail('na.' + k, 'reason must be a non-empty string');
    }
    if (typeof a.create !== 'function') adFail('create', 'must be a function');
    const needPair = typeof a.na.splitAt !== 'string' || typeof a.na.append !== 'string';
    if (a.createPair !== undefined && typeof a.createPair !== 'function') adFail('createPair', 'must be a function');
    if (needPair && typeof a.createPair !== 'function') adFail('createPair', 'required when splitAt / append are live');
    const h = a.create(8, 1);
    if (h === null || typeof h !== 'object') adFail('create', 'must return a handle object');
    for (const op of REQUIRED_OPS) {
        if (typeof h[op] !== 'function') adFail('handle.' + op, 'must be a function');
    }
    for (const op of OPTIONAL_OPS) {
        const live = typeof h[op] === 'function';
        const reason = typeof a.na[op] === 'string';
        if (live && reason) adFail('na.' + op, 'the handle implements ' + op + ' (drop the n/a reason)');
        if (!live && !reason) adFail('handle.' + op, 'missing: implement it or give na.' + op + ' a reason');
    }
    if (ex.length > 0 && typeof h.readExtras !== 'function') adFail('handle.readExtras', 'required when extraCounts is non-empty');
    if (h.length() !== 0) adFail('create', 'a new handle must be empty');
    return a;
}

// ---- COUNTS record -------------------------------------------------------------------------

/**
 * Cold: the COUNTS record of one row from raw reads. counts: Int32Array(12) from readCounts,
 * extras: Float64Array(extraCounts.length) from readExtras (or undefined when there are none).
 */
export function countsRecord(adapter, counts, extras) {
    const out = {};
    for (let j = 0; j < NC; j++) out[COUNTER_NAMES[j]] = adapter.counterMap[j] ? counts[j] : NA;
    const x = {};
    for (let j = 0; j < adapter.extraCounts.length; j++) x[adapter.extraCounts[j]] = extras[j];
    return { counts: out, extras: x };
}

/**
 * Throws (naming the key) unless rec.counts has the 12 keys in order, an integer >= 0 / 'n/a' per
 * counterMap, and rec.extras has exactly the adapter's extraCounts keys in order, integers >= 0.
 */
export function validateCounts(adapter, rec, where = 'row') {
    if (rec === null || typeof rec !== 'object' || rec.counts === null || typeof rec.counts !== 'object') {
        throw new Error('[bench] ' + where + ': counts missing');
    }
    const keys = Object.keys(rec.counts);
    if (keys.length !== NC) throw new Error('[bench] ' + where + ': counts must have exactly ' + NC + ' keys');
    for (let j = 0; j < NC; j++) {
        const k = COUNTER_NAMES[j];
        if (keys[j] !== k) throw new Error('[bench] ' + where + ': counts key ' + j + ' must be ' + k);
        const v = rec.counts[k];
        if (adapter.counterMap[j]) {
            if (!(Number.isInteger(v) && v >= 0)) throw new Error('[bench] ' + where + ': counts.' + k + ' must be an integer >= 0');
        } else if (v !== NA) {
            throw new Error('[bench] ' + where + ": counts." + k + " must be 'n/a' (unmapped), got " + String(v));
        }
    }
    const ex = rec.extras;
    if (ex === null || typeof ex !== 'object') throw new Error('[bench] ' + where + ': extras missing');
    const xk = Object.keys(ex);
    if (xk.length !== adapter.extraCounts.length || xk.some((k, j) => k !== adapter.extraCounts[j])) {
        throw new Error('[bench] ' + where + ': extras keys must be exactly [' + adapter.extraCounts.join(', ') +
            '] in order, got [' + xk.join(', ') + ']');
    }
    for (const k of adapter.extraCounts) {
        if (!(Number.isInteger(ex[k]) && ex[k] >= 0)) throw new Error('[bench] ' + where + ': extras.' + k + ' must be an integer >= 0');
    }
    return true;
}

/**
 * insertAt forwarder for one dims, built once per handle (cold): it forwards exactly dims
 * measures, so the caller may always pass four and the hot call carries no dims branch.
 */
export function insertFor(inst, dims) {
    if (dims === 1) return (i, e, m0) => { inst.insertAt(i, e, m0); };
    if (dims === 2) return (i, e, m0, m1) => { inst.insertAt(i, e, m0, m1); };
    if (dims === 3) return (i, e, m0, m1, m2) => { inst.insertAt(i, e, m0, m1, m2); };
    if (dims === 4) return (i, e, m0, m1, m2, m3) => { inst.insertAt(i, e, m0, m1, m2, m3); };
    return adFail('dims', 'must be an integer in 1..4');
}

// ---- rival COUNTER_MAP translation (group 2b uses this; nothing is registered here) --------

/**
 * Translate a rival's static COUNTER_MAP (engine name -> native name | 'n/a') and its native
 * COUNTERS (native name -> slot) into { counterMap: bool[12], pair: Int32Array(12) (native slot
 * or -1), extraCounts: string[] (native names with no engine pair, slot order; a name equal
 * to an engine counter name gets the prefix 'native.'), extraSlot:
 * Int32Array, nativeN }. Throws on an engine name missing from the map, an unknown engine or
 * native name, or a native counter paired twice.
 */
export function translateCounterMap(counterMap, nativeCounters) {
    if (!isPlain(counterMap) && !Object.isFrozen(counterMap)) adFail('COUNTER_MAP', 'must be an object');
    const nativeNames = Object.keys(nativeCounters).sort((a, b) => nativeCounters[a] - nativeCounters[b]);
    const slots = new Set();
    for (const k of nativeNames) {
        const v = nativeCounters[k];
        if (!Number.isInteger(v) || v < 0) adFail('COUNTERS.' + k, 'native slot must be an integer >= 0');
        if (slots.has(v)) adFail('COUNTERS.' + k, 'native slot ' + v + ' is shared by two names');
        slots.add(v);
    }
    for (const k of Object.keys(counterMap)) {
        if (!COUNTER_NAMES.includes(k)) adFail('COUNTER_MAP.' + k, 'not an engine counter' + didYouMean(k, COUNTER_NAMES));
    }
    const bools = [];
    const pair = new Int32Array(NC).fill(-1);
    const used = new Set();
    for (let j = 0; j < NC; j++) {
        const k = COUNTER_NAMES[j];
        if (!Object.prototype.hasOwnProperty.call(counterMap, k)) adFail('COUNTER_MAP.' + k, 'missing');
        const v = counterMap[k];
        if (v === NA) { bools.push(false); continue; }
        if (!Object.prototype.hasOwnProperty.call(nativeCounters, v)) adFail('COUNTER_MAP.' + k, "unknown native counter '" + String(v) + "'");
        if (used.has(v)) adFail('COUNTER_MAP.' + k, "native counter '" + v + "' paired twice");
        used.add(v);
        pair[j] = nativeCounters[v];
        bools.push(true);
    }
    const extraNative = nativeNames.filter((s) => !used.has(s));
    const extraSlot = Int32Array.from(extraNative.map((s) => nativeCounters[s]));
    // A native name equal to an engine counter name (BlockedArray's chunk splits / merges / ...)
    // is NOT the engine's event: it is printed as 'native.<name>' so no column reads as ours.
    const extraCounts = extraNative.map((s) => (COUNTER_NAMES.includes(s) ? 'native.' + s : s));
    return { counterMap: bools, pair, extraCounts, extraSlot, nativeN: nativeNames.length };
}

/**
 * Build (do NOT register) an adapter for a rival class with static COUNTERS + COUNTER_MAP and
 * readCounters(out: Int32Array) / resetCounters(). spec: { name, role, version, params, Class,
 * make(capacity, dims, tune) -> instance, makePair?(capacity, dims, tune) -> [a, b], na }.
 * The instance supplies insertAt / removeAt / setMeasure / indexAtSum / sumBefore / clear /
 * length; splitAt / append / cursor() / bytes() become live ops when present and not in na.
 */
export function rivalAdapter(spec) {
    const tr = translateCounterMap(spec.Class.COUNTER_MAP, spec.Class.COUNTERS);
    tr.f64 = acceptsF64(spec, Math.max(tr.nativeN, 8));
    const na = Object.assign({}, spec.na || {});
    const wrap = (inst, dims) => rivalHandle(inst, dims, tr, na);
    const a = {
        name: spec.name, role: spec.role, version: spec.version, params: spec.params,
        counterMap: tr.counterMap, extraCounts: tr.extraCounts, na,
        create: (C, dims, tune) => wrap(spec.make(C, dims, tune), dims),
    };
    if (typeof spec.makePair === 'function') {
        a.createPair = (C, dims, tune) => spec.makePair(C, dims, tune).map((x) => wrap(x, dims));
    }
    return a;
}

/**
 * Cold probe: does the rival's readCounters take a Float64Array (exact past 2^31)? FenwickRebuild
 * does; BlockedArray takes an Int32Array only and stays Int32.
 */
function acceptsF64(spec, n) {
    try {
        spec.make(8, 1).readCounters(new Float64Array(n));
        return true;
    } catch (e) {
        return false;
    }
}

/** Cold thrower: a paired counter that does not fit the Int32Array(12) COUNTS read (never wrap). */
function adOverflow(name, j, v) {
    adFail(name + '.readCounts', COUNTER_NAMES[j] + ' = ' + v + ' does not fit an Int32Array slot (>= 2^31)');
}

function rivalHandle(inst, dims, tr, na) {
    const m = Math.max(tr.nativeN, 8);
    const scratch = tr.f64 ? new Float64Array(m) : new Int32Array(m);
    const name = inst.constructor.name;
    const pair = tr.pair;
    const xs = tr.extraSlot;
    const h = {
        instance: inst,
        insertAt: insertFor(inst, dims),
        removeAt(i) { inst.removeAt(i); },
        setMeasure(i, d, m) { inst.setMeasure(i, d, m); },
        indexAtSum(d, y) { return inst.indexAtSum(d, y); },
        sumBefore(d, i) { return inst.sumBefore(d, i); },
        length() { return inst.length; },
        clear() { inst.clear(); },
        readCounts(out) {
            inst.readCounters(scratch);
            for (let j = 0; j < NC; j++) {
                const p = pair[j];
                if (p < 0) { out[j] = 0; continue; }
                const v = scratch[p];
                if (!(v < 2147483648)) adOverflow(name, j, v);
                out[j] = v;
            }
        },
        resetCounts() { inst.resetCounters(); },
        readExtras(out) {
            inst.readCounters(scratch);
            for (let j = 0; j < xs.length; j++) out[j] = scratch[xs[j]];
        },
    };
    if (typeof inst.splitAt === 'function' && !na.splitAt) h.splitAt = (i, out) => { inst.splitAt(i, out.instance); };
    if (typeof inst.append === 'function' && !na.append) h.append = (o) => { inst.append(o.instance); };
    if (typeof inst.cursor === 'function' && !na.cursorWalk) {
        const cur = inst.cursor();
        h.cursorWalk = (i, k) => {
            if (!cur.seekIndex(i)) return 0;
            let s = 1;
            while (s < k && cur.next()) s++;
            return s;
        };
    }
    if (typeof inst.bytes === 'function' && !na.bytes) h.bytes = () => inst.bytes();
    return h;
}

// ---- SumSequence (the subject) -------------------------------------------------------------

const SS_LEAF = [4, 8, 16, 32];

function ssTune(tune) {
    if (tune === undefined) return 16;
    if (!isPlain(tune)) adFail('SumSequence.tune', 'must be a plain object');
    for (const k of Object.keys(tune)) {
        if (k !== 'leafSize') adFail('SumSequence.tune.' + k, 'unknown key' + didYouMean(k, ['leafSize']));
    }
    if (tune.leafSize === undefined) return 16;
    if (!SS_LEAF.includes(tune.leafSize)) adFail('SumSequence.tune.leafSize', 'must be 4, 8, 16 or 32');
    return tune.leafSize;
}

/** Typed-array bytes reachable from a view, its arena record and its cursor (cold, deduped by buffer). */
export function ssBytes(seq) {
    const seen = new Set();
    let t = 0;
    const add = (x) => {
        if (ArrayBuffer.isView(x)) {
            if (!seen.has(x.buffer)) { seen.add(x.buffer); t += x.buffer.byteLength; }
        } else if (Array.isArray(x)) {
            for (const y of x) add(y);
        }
    };
    for (const v of Object.values(seq)) add(v);
    for (const v of Object.values(seq._ar)) add(v);
    for (const v of Object.values(seq.cursor())) add(v);
    return t;
}

function ssHandle(seq, dims) {
    const cur = seq.cursor();
    return {
        instance: seq,
        insertAt: insertFor(seq, dims),
        removeAt(i) { seq.removeAt(i); },
        setMeasure(i, d, m) { seq.setMeasure(i, d, m); },
        indexAtSum(d, y) { return seq.indexAtSum(d, y); },
        sumBefore(d, i) { return seq.sumBefore(d, i); },
        length() { return seq.length; },
        clear() { seq.clear(); },
        readCounts(out) { seq.readCounters(out); },
        resetCounts() { seq.resetCounters(); },
        splitAt(i, out) { seq.splitAt(i, out.instance); },
        append(other) { seq.append(other.instance); },
        cursorWalk(i, k) {
            if (!cur.seekIndex(i)) return 0;
            let s = 1;
            while (s < k && cur.next()) s++;
            return s;
        },
        bytes() { return ssBytes(seq); },
    };
}

export const SumSequenceAdapter = {
    name: 'SumSequence',
    role: 'subject',
    version: VERSION,
    params: { leafSize: 16, arenaViews: 1 },
    counterMap: [true, true, true, true, true, true, true, true, true, true, true, true],
    extraCounts: [],
    na: {},
    create(capacity, dims, tune) {
        const B = ssTune(tune);
        return ssHandle(new SumSequence(capacity, { dims, leafSize: B }), dims);
    },
    createPair(capacity, dims, tune) {
        const B = ssTune(tune);
        return SumSequence.arena(capacity, { dims, leafSize: B }, 2).map((v) => ssHandle(v, dims));
    },
};

// ---- SpliceFoil (the primary O(n) foil) ----------------------------------------------------
// JS Array.splice per column + an in-place prefix-sum rebuild from the edit point into ONE
// preallocated Int32Array(dims x (C+1)) (dim d's prefix P(j) at d * (C+1) + j). Measures are
// integers in [0, 255] here (the bench law), so P < 2^31 needs C <= 2^23 (checked).
// Counters: moves (engine slot 2) = elements shifted by the splice (n - i on insert,
// n - i - 1 on remove); extra 'rebuilt' = prefix rebuild passes. Every other counter is n/a.
// Array.splice allocates its (empty) return array by design: the foil is the naive default,
// it is not B/op-gated (kernel-lane gates the subject and, from group 2a B3, the rivals).

const SF_CAP = 1 << 23;
const SF_MOVES = 0;
const SF_REBUILT = 1;

function sfFail(token, detail) {
    throw new RangeError(token + ' ' + detail);
}

// Bench law: measures are integers in [0, 255] (keeps every prefix < 2^31 at C <= 2^23).
function sfMeasure(m) {
    if (!(Number.isInteger(m) && m >= 0 && m <= 255)) sfFail('measure', 'must be an integer in [0, 255]');
}

class SpliceFoil {
    constructor(C, dims) {
        if (!Number.isInteger(C) || C < 1 || C > SF_CAP) sfFail('capacity', 'must be an integer in [1, 2^23]');
        if (!Number.isInteger(dims) || dims < 1 || dims > 4) sfFail('dims', 'must be an integer in 1..4');
        this.C = C;
        this.dims = dims;
        this.n = 0;
        this.ent = [];
        this.meas = [];
        for (let d = 0; d < dims; d++) this.meas.push([]);
        this.pre = new Int32Array(dims * (C + 1));
        this.c = new Float64Array(2);
    }

    _rebuild(from) {
        const n = this.n;
        const W = this.C + 1;
        for (let d = 0; d < this.dims; d++) {
            const col = this.meas[d];
            const b = d * W;
            let acc = this.pre[b + from];
            for (let j = from; j < n; j++) { acc += col[j]; this.pre[b + j + 1] = acc; }
        }
        this.c[SF_REBUILT] += 1;
    }

    insertAt(i, e, m0, m1, m2, m3) {
        const n = this.n;
        if (!Number.isInteger(i) || i < 0 || i > n) sfFail('index', 'must be an integer in [0, length]');
        if (n >= this.C) sfFail('capacity', 'full');
        sfMeasure(m0);
        if (this.dims > 1) sfMeasure(m1);
        if (this.dims > 2) sfMeasure(m2);
        if (this.dims > 3) sfMeasure(m3);
        this.ent.splice(i, 0, e);
        this.meas[0].splice(i, 0, m0);
        if (this.dims > 1) this.meas[1].splice(i, 0, m1);
        if (this.dims > 2) this.meas[2].splice(i, 0, m2);
        if (this.dims > 3) this.meas[3].splice(i, 0, m3);
        this.n = n + 1;
        this.c[SF_MOVES] += n - i;
        this._rebuild(i);
    }

    removeAt(i) {
        const n = this.n;
        if (!Number.isInteger(i) || i < 0 || i >= n) sfFail('index', 'must be an integer in [0, length)');
        this.ent.splice(i, 1);
        for (let d = 0; d < this.dims; d++) this.meas[d].splice(i, 1);
        this.n = n - 1;
        this.c[SF_MOVES] += n - i - 1;
        this._rebuild(i);
    }

    setMeasure(i, d, m) {
        if (!Number.isInteger(i) || i < 0 || i >= this.n) sfFail('index', 'must be an integer in [0, length)');
        if (!Number.isInteger(d) || d < 0 || d >= this.dims) sfFail('dim', 'must be an integer in [0, dims)');
        sfMeasure(m);
        this.meas[d][i] = m;
        this._rebuild(i);
    }

    sumBefore(d, i) {
        if (!Number.isInteger(i) || i < 0 || i > this.n) sfFail('index', 'must be an integer in [0, length]');
        if (!Number.isInteger(d) || d < 0 || d >= this.dims) sfFail('dim', 'must be an integer in [0, dims)');
        return this.pre[d * (this.C + 1) + i];
    }

    // The strict seek (M-7): the smallest i with P(i + 1) > y, else length.
    indexAtSum(d, y) {
        if (!Number.isInteger(d) || d < 0 || d >= this.dims) sfFail('dim', 'must be an integer in [0, dims)');
        if (typeof y !== 'number' || !(y >= 0)) sfFail('seek', 'must be a number in [0, Infinity)');
        const b = d * (this.C + 1);
        let lo = 0;
        let hi = this.n;
        while (lo < hi) {
            const mid = (lo + hi) >>> 1;
            if (this.pre[b + mid + 1] > y) hi = mid;
            else lo = mid + 1;
        }
        return lo;
    }

    clear() {
        this.ent.length = 0;
        for (let d = 0; d < this.dims; d++) this.meas[d].length = 0;
        this.n = 0;
    }
}

function sfHandle(f) {
    const c = f.c;
    return {
        instance: f,
        insertAt(i, e, m0, m1, m2, m3) { f.insertAt(i, e, m0, m1, m2, m3); },
        removeAt(i) { f.removeAt(i); },
        setMeasure(i, d, m) { f.setMeasure(i, d, m); },
        indexAtSum(d, y) { return f.indexAtSum(d, y); },
        sumBefore(d, i) { return f.sumBefore(d, i); },
        length() { return f.n; },
        clear() { f.clear(); },
        readCounts(out) {
            out.fill(0);
            const v = c[SF_MOVES];
            if (!(v < 2147483648)) adOverflow('SpliceFoil', SumSequence.COUNTERS.moves, v);
            out[SumSequence.COUNTERS.moves] = v;
        },
        resetCounts() { c.fill(0); },
        readExtras(out) { out[0] = c[SF_REBUILT]; },
    };
}

const SF_COUNTER_MAP = COUNTER_NAMES.map((k) => k === 'moves');

export const SpliceFoilAdapter = {
    name: 'SpliceFoil',
    role: 'primary',
    version: 'hand-written',
    params: { storage: 'Array.splice per column', prefix: 'Int32Array(dims x (C+1)), rebuilt from the edit point' },
    counterMap: SF_COUNTER_MAP,
    extraCounts: ['rebuilt'],
    na: {
        splitAt: 'foil: the splice witness covers insert / remove / seek only',
        append: 'foil: the splice witness covers insert / remove / seek only',
        cursorWalk: 'foil: no cursor (index access is O(1) on a JS Array)',
        bytes: 'foil: JS Array columns have no typed-array byte count',
    },
    create(capacity, dims, tune) {
        if (tune !== undefined) adFail('SpliceFoil.tune', 'takes no tune object');
        return sfHandle(new SpliceFoil(capacity, dims));
    },
};

// ---- registry ------------------------------------------------------------------------------

/** Live adapters, validated at module load (fail closed). */
export const ADAPTERS = Object.freeze([SumSequenceAdapter, SpliceFoilAdapter]);
for (const a of ADAPTERS) validateAdapter(a);

/**
 * Rival slots not yet registered: each renders 'n/a' with its reason. Group 2b replaces a
 * slot with a live adapter built by rivalAdapter() (and moves it into ADAPTERS).
 */
export const RIVAL_SLOTS = {
    BlockedArray: {
        status: 'PENDING', role: 'rival',
        reason: 'rival class landed (benchmark/rivals/BlockedArray.js); adapter registration is group 2b',
    },
    FenwickRebuild: {
        status: 'PENDING', role: 'rival',
        reason: 'rival class landed (benchmark/rivals/FenwickRebuild.js); adapter registration is group 2b',
    },
    FenwickFixed: {
        status: 'PENDING', role: 'counter',
        reason: 'counter-foil (Fenwick on a fixed-length, resize-only workload, S7): not built; group 2b',
    },
};

/** The live adapter by name; an unknown name throws (a PENDING rival slot names its reason). */
export function selectAdapter(name) {
    for (const a of ADAPTERS) if (a.name === name) return a;
    if (Object.prototype.hasOwnProperty.call(RIVAL_SLOTS, name)) {
        throw new Error('[bench] adapter ' + name + ' is ' + RIVAL_SLOTS[name].status + ': ' + RIVAL_SLOTS[name].reason);
    }
    throw new Error('[bench] unknown adapter ' + String(name));
}
