/**
 * @zakkster/lite-yggdrasil -- benchmark orchestrator.
 *
 * MIT (c) Zahary Shinikchiev <shinikchiev@yahoo.com>
 *
 *     npm run bench                         # every (adapter x dimension) cell -> benchmark/out/
 *     npm run bench -- --quick              # the same, small sizes (a smoke, never a run of record)
 *     npm run bench -- --scenario S7        # one scenario's (label x size) cells (exit 2 on an unknown id)
 *     npm run bench -- --runs 3             # every cell 3 times, interleaved by pass
 *     npm run bench -- --publish            # the run of record: benchmark/results.json + report.html
 *     npm run bench -- --all                # the 16 D-rows + every registered scenario's cells (BA-33)
 *     npm run bench -- --sweep chunkCap --scenario S7   # BlockedArray x sweepGrid(d) per (Sid, n) (BA-31)
 *     npm run bench -- --picks <path>       # parsed + validated, then refused until g2b-3a B3
 *
 * Repo-only. Bench-ADOPT group 1 TASK 6 (.handoff/PLAN-bench-adopt-g1.md; SPEC-bench-adopt BA-1,
 * BA-5, BA-9, BA-11). Copied from @zakkster/lite-logn benchmark/Bench.mjs (Bench v2 kit, LiteLogN
 * commit 9eb484c: one child process per cell, parseCellResult, the drift sentinel helpers, the
 * import-safe isMain guard) and re-wired: the cells are (SumSequence, SpliceFoil) x D1..D8 or one
 * scenario's (adapter x size) cells; the sentinel is SumSequence/D2; the meta block carries the 17
 * META_FIELDS of BA-11; every timed row (nsPerOp or p50) carries a COUNTS record
 * (benchmark/Adapters.mjs countsRecord / validateCounts) and validateResults checks all of it
 * before anything is written.
 *
 * Publication (maintainer ruling R-BA1): without --publish the run writes benchmark/out/ (gitignored);
 * only `--publish`, run under the quiet lock, writes the committed benchmark/results.json and
 * benchmark/report.html, and it refuses to run outside the quiet lock (exit 2). hostState is 'QUIET'
 * only when the quiet lock passed QUIET_LOCK_HOST=quiet AND the run is not --quick, else 'PRELIMINARY'
 * (BA-5). Every timing is REPORTED (ADR 0003 G-1); counts are DETERMINISTIC.
 *
 * Each child runs with --expose-gc; D6 children also get --no-concurrent-recompilation
 * (benchmark/METHODOLOGY.md). The parent needs no special flags.
 *
 * Scenario cells (group 2b-1 TASK 6, SPEC BA-17 / BA-20): the child runs
 * `--cell --scenario <Sid> --member <label> --n <n> [--tune <json>]` through Scenarios.mjs runScenario
 * (create / createViews, untimed fill, refill before every phase sample, length() === n checks)
 * and prints one row per phase {phase, unit 'ns/event', events, ops, nsPerOp, p50, p90, counts,
 * extras, checksum, traceHash}. Keys are '<label>/<Sid>@<n>'. The orchestrator cross-checks
 * checksum + endState + traceHash per (Sid, n) across every label (crossCheck) and exits 1 on
 * "checksum mismatch" / "endState mismatch" / "traceHash mismatch" before anything is written. --quick caps sizes at
 * 4096 and the event stream at 1/10. ASCII only.
 *
 * g2b-3a B2 (SPEC BA-28 / BA-31 / BA-34): every pass runs each (Sid, n) group with its label order
 * rotated by the pass (Compare.mjs rotateLabels, pass-major); a --sweep chunkCap run's cells are the
 * registered BlockedArray at every chunkCap of sweepGrid(defaultChunkCap(C)), C the scenario's built
 * capacity computed cold in this parent, keyed '<label>/<Sid>@<n>~c<chunkCap>' (cellKey); EXCLUDED
 * (the census cells over 300 s per pass) are left out and printed with their census seconds.
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { runDimension, vacuityCheck } from './Dimensions.mjs';
import { SUBJECTS, FOIL, DIMENSIONS, DIMENSION_TITLES, baselineFor, cells, OP_CLASS } from './Matrix.mjs';
import { DEFAULT_SEED } from './Harness.mjs';
import { ADAPTERS, RIVAL_SLOTS, RETIRED_SLOTS, selectAdapter, validateCounts, isPlain, didYouMean, NA }
    from './Adapters.mjs';
import { SCENARIOS, MAX_SIZE, selectScenario, scenarioSizes, scenarioEvents, labelBase, knownLabels, resolveLabel, runScenario }
    from './Scenarios.mjs';
import { defaultChunkCap, sweepGrid, rotateLabels } from './Compare.mjs';

const THIS_FILE = fileURLToPath(import.meta.url);
const PKG_DIR = fileURLToPath(new URL('..', import.meta.url));
const MAIN_FILE = fileURLToPath(new URL('../Yggdrasil.js', import.meta.url));
const OUT_DIR = fileURLToPath(new URL('./out/', import.meta.url));
const PUBLISH_PATHS = {
    results: fileURLToPath(new URL('./results.json', import.meta.url)),
    report: fileURLToPath(new URL('./report.html', import.meta.url)),
    label: 'benchmark/',
};
const OUT_PATHS = { results: OUT_DIR + 'results.json', report: OUT_DIR + 'report.html', label: 'benchmark/out/' };

/** results.json schema id. */
export const SCHEMA = 'yggdrasil-bench/1';
/** results.json status values. */
export const STATUSES = Object.freeze(['MEASURED', 'PENDING']);

/**
 * The meta block: 17 flat required fields, in this order (SPEC-bench-adopt BA-11). The first 8
 * are the lite-logn kit's; a kit-shaped (8-field) meta fails validateResults.
 */
export const META_FIELDS = Object.freeze(['seed', 'node', 'arch', 'platform', 'cpuModel', 'cpuCount', 'date',
    'sentinel', 'loadAvgStart', 'loadAvgEnd', 'hostState', 'quietLockWhy', 'commit', 'mainFileSha', 'runCount',
    'command', 'rivals']);

const TOP_REQUIRED = ['schema', 'status', 'meta', 'subjects', 'dimensions', 'titles', 'scenarios', 'results',
    'lossTable'];
const TOP_OPTIONAL = ['foil', 'adapters', 'opClass'];
const LOSS_KEYS = ['scenario', 'winner', 'loser', 'crossoverN', 'reason'];
const RIVAL_KEYS = ['role', 'status', 'version', 'params', 'reason'];
const HOST_STATES = ['QUIET', 'PRELIMINARY'];

/** Threshold above which the drift sentinel discloses thermal / turbo noise. */
export const DRIFT_LIMIT = 0.10;

/**
 * Fractional drift between two readings of the same cheap cell: |second-first|/first.
 * Pure + exported so the sentinel logic is unit-testable without spawning children.
 * FAIL CLOSED: a non-positive first reading returns 0 (no basis to claim drift).
 * @param {number} first
 * @param {number} second
 * @returns {number}
 */
export function driftFraction(first, second) {
    if (!(first > 0) || !isFinite(second)) return 0;
    return Math.abs(second - first) / first;
}

/** True iff the drift fraction exceeds the disclosure threshold. Pure + exported. */
export function driftExceeds(first, second, limit = DRIFT_LIMIT) {
    return driftFraction(first, second) > limit;
}

/** The cheap comparable scalar the sentinel compares across two runs (D2 first checkpoint). */
export function sentinelMetric(result) {
    if (result && Array.isArray(result.points) && result.points.length > 0) return result.points[0].nsPerOp;
    return 0;
}

/**
 * Parse a child's stdout as the JSON cell result. Isolated from spawnCell so a child that writes
 * partial / garbage / empty JSON is a testable, named failure mode.
 * @param {string} member
 * @param {string} dim
 * @param {string} stdout
 * @returns {object}
 */
export function parseCellResult(member, dim, stdout) {
    try {
        return JSON.parse((stdout || '').trim());
    } catch (e) {
        throw new Error('[bench] cell ' + member + '/' + dim + ' bad JSON: ' + e.message);
    }
}

// ---------------------------------------------------------------------------
// validateResults: the frozen results.json contract (fail closed; every throw names the field).
// ---------------------------------------------------------------------------

function rvFail(field, detail) {
    throw new Error('[bench] results: ' + field + ' ' + detail);
}

const nonEmptyString = (v) => typeof v === 'string' && v.length > 0;
const loadAvg = (v) => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && isFinite(x) && x >= 0);

function validateRivals(r) {
    if (!isPlain(r)) rvFail('meta.rivals', 'must be a plain object {name: {version, params}}');
    for (const name of Object.keys(r)) {
        const v = r[name];
        const w = 'meta.rivals.' + name;
        if (!isPlain(v)) rvFail(w, 'must be a plain object');
        for (const k of Object.keys(v)) if (!RIVAL_KEYS.includes(k)) rvFail(w + '.' + k, 'unknown key' + didYouMean(k, RIVAL_KEYS));
        if (v.role !== 'rival' && v.role !== 'counter') rvFail(w + '.role', "must be 'rival' or 'counter'");
        if (v.version === NA) {
            if (v.params !== NA) rvFail(w + '.params', "must be 'n/a' when version is 'n/a'");
            if (v.status !== 'PENDING' && v.status !== 'RETIRED') {
                rvFail(w + '.status', "must be 'PENDING' or 'RETIRED' when version is 'n/a'");
            }
            if (!nonEmptyString(v.reason)) rvFail(w + '.reason', "must be a non-empty string when version is 'n/a'");
        } else {
            if (!nonEmptyString(v.version)) rvFail(w + '.version', "must be 'hand-written', a semver or 'n/a'");
            if (!isPlain(v.params)) rvFail(w + '.params', 'must be a plain object');
            if (v.status !== 'LIVE') rvFail(w + '.status', "must be 'LIVE' for a live adapter");
        }
    }
}

const META_CHECKS = {
    seed: (v) => Number.isInteger(v) && v >= 0 && v <= 0xFFFFFFFF || 'must be a uint32 integer',
    node: (v) => typeof v === 'string' && /^v\d+\.\d+\.\d+/.test(v) || 'must be a node version string (vX.Y.Z)',
    arch: (v) => nonEmptyString(v) || 'must be a non-empty string',
    platform: (v) => nonEmptyString(v) || 'must be a non-empty string',
    cpuModel: (v) => nonEmptyString(v) || 'must be a non-empty string',
    cpuCount: (v) => Number.isInteger(v) && v >= 1 || 'must be an integer >= 1',
    date: (v) => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d/.test(v) && !isNaN(Date.parse(v)) || 'must be an ISO date string',
    sentinel: (v) => v === null || (isPlain(v) && nonEmptyString(v.cell) && [v.first, v.second, v.drift, v.limit]
        .every((x) => typeof x === 'number' && isFinite(x) && x >= 0)) || 'must be null or {cell, first, second, drift, limit}',
    loadAvgStart: (v) => loadAvg(v) || 'must be an array of 3 finite numbers >= 0',
    loadAvgEnd: (v) => loadAvg(v) || 'must be an array of 3 finite numbers >= 0',
    hostState: (v) => HOST_STATES.includes(v) || "must be 'QUIET' or 'PRELIMINARY'",
    quietLockWhy: (v) => v === null || nonEmptyString(v) || 'must be a non-empty string, or null when not under quiet-lock',
    commit: (v) => typeof v === 'string' && /^[0-9a-f]{7,40}(-dirty)?$/.test(v) || "must be a short sha, with '-dirty' when the tree was dirty",
    mainFileSha: (v) => typeof v === 'string' && /^[0-9a-f]{8}$/.test(v) || 'must be sha256/8 (8 lowercase hex)',
    runCount: (v) => Number.isInteger(v) && v >= 1 || 'must be an integer >= 1',
    command: (v) => nonEmptyString(v) || 'must be a non-empty string',
    rivals: (v) => { validateRivals(v); return true; },
};

function validateMeta(meta) {
    if (!isPlain(meta)) rvFail('meta', 'must be a plain object');
    for (const f of META_FIELDS) {
        if (!Object.prototype.hasOwnProperty.call(meta, f)) rvFail('meta.' + f, 'missing');
    }
    for (const k of Object.keys(meta)) {
        if (!META_FIELDS.includes(k)) rvFail('meta.' + k, 'unknown key' + didYouMean(k, META_FIELDS));
    }
    for (const f of META_FIELDS) {
        const ok = META_CHECKS[f](meta[f]);
        if (ok !== true) rvFail('meta.' + f, ok + ', got ' + JSON.stringify(meta[f]));
    }
}

/** Every object under a result row: nsPerOp / p50 -> counts required; any counts record -> validateCounts. */
function walkRow(adapter, node, where) {
    if (Array.isArray(node)) {
        for (let i = 0; i < node.length; i++) walkRow(adapter, node[i], where + '[' + i + ']');
        return;
    }
    if (node === null || typeof node !== 'object') return;
    const timed = Object.prototype.hasOwnProperty.call(node, 'nsPerOp') || Object.prototype.hasOwnProperty.call(node, 'p50');
    const rec = node.counts;
    const isRecord = rec !== null && typeof rec === 'object' && !Array.isArray(rec);
    if (timed && !isRecord) rvFail(where + '.counts', 'missing on a timed row (nsPerOp / p50)');
    if (timed && (node.extras === null || typeof node.extras !== 'object')) rvFail(where + '.extras', 'missing on a timed row');
    for (const k of ['nsPerOp', 'p50', 'p90']) {
        if (node[k] !== undefined && !(typeof node[k] === 'number' && isFinite(node[k]) && node[k] > 0)) {
            rvFail(where + '.' + k, 'must be a finite number > 0 on a timed row');
        }
    }
    if (timed && !(Number.isInteger(node.ops) && node.ops >= 1)) rvFail(where + '.ops', 'must be an integer >= 1 on a timed row');
    if (isRecord) {
        // a counts-only row (D1 subject rows) carries no extras: valid only for an adapter with none
        const extras = node.extras === undefined ? {} : node.extras;
        try {
            validateCounts(adapter, { counts: rec, extras }, where);
        } catch (e) {
            rvFail(where + '.counts', 'invalid: ' + e.message);
        }
    }
    for (const k of Object.keys(node)) {
        if (k === 'counts' && isRecord) continue;
        if (k === 'extras') continue;
        walkRow(adapter, node[k], where + '.' + k);
    }
}

function validateLossRow(l, i) {
    const w = 'lossTable[' + i + ']';
    if (!isPlain(l)) rvFail(w, 'must be a plain object {scenario, winner, loser, crossoverN, reason}');
    for (const k of LOSS_KEYS) if (!Object.prototype.hasOwnProperty.call(l, k)) rvFail(w + '.' + k, 'missing');
    for (const k of Object.keys(l)) if (!LOSS_KEYS.includes(k)) rvFail(w + '.' + k, 'unknown key' + didYouMean(k, LOSS_KEYS));
    for (const k of ['scenario', 'winner', 'loser', 'reason']) {
        if (!nonEmptyString(l[k])) rvFail(w + '.' + k, 'must be a non-empty string');
    }
    if (l.winner === l.loser) rvFail(w + '.loser', 'must differ from winner');
    const c = l.crossoverN;
    const ok = (Number.isInteger(c) && c >= 1) || c === NA || (typeof c === 'string' && /^none up to [1-9]\d*$/.test(c));
    if (!ok) rvFail(w + '.crossoverN', "must be an integer >= 1, 'none up to <n>' or 'n/a', got " + JSON.stringify(c));
}

/**
 * '<adapter>/<Dk>' (D-rows) or '<label>/<Sid>@<n>' (scenario cells; a label may carry one '.<tag>'), a
 * chunkCap sweep cell '<label>/<Sid>@<n>~c<chunkCap>' (g2b-3a; a D-row key never takes the tag). Groups:
 * 1 label, 2 Dk, 3 Sid, 4 n, 5 chunkCap tag digits. Compare.mjs SCENARIO_KEY is the reference.
 */
export const RESULT_KEY = /^([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)?)\/(?:(D[1-8])|(S\d+[a-z]?)@([1-9]\d*)(?:~c([1-9]\d*))?)$/;

const LABEL_RE = /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)?$/;
const SID_RE = /^S\d+[a-z]?$/;

/**
 * The results.json key of one scenario cell: '<label>/<Sid>@<n>', or '<label>/<Sid>@<n>~c<chunkCap>'
 * when chunkCap is given (a sweep cell). Throws on a malformed part. Pure.
 * @param {string} label
 * @param {string} sid
 * @param {number} n
 * @param {number} [chunkCap]
 * @returns {string}
 */
export function cellKey(label, sid, n, chunkCap) {
    if (typeof label !== 'string' || !LABEL_RE.test(label)) throw new TypeError('[bench] cellKey: bad label ' + JSON.stringify(label));
    if (typeof sid !== 'string' || !SID_RE.test(sid)) throw new TypeError('[bench] cellKey: bad scenario id ' + JSON.stringify(sid));
    if (!Number.isInteger(n) || n < 1) throw new TypeError('[bench] cellKey: n must be an integer >= 1, got ' + String(n));
    if (chunkCap !== undefined && !(Number.isInteger(chunkCap) && chunkCap >= 1)) {
        throw new TypeError('[bench] cellKey: chunkCap must be an integer >= 1, got ' + String(chunkCap));
    }
    return label + '/' + sid + '@' + n + (chunkCap === undefined ? '' : '~c' + chunkCap);
}

// the key of one planned cell (a D-row or a scenario cell)
function keyOf(c) {
    return c.scenario !== undefined ? cellKey(c.member, c.scenario, c.n, c.chunkCap) : c.member + '/' + c.dim;
}

/**
 * Cross-check of the scenario cells (A1): every label of one (Sid, n) must read the same phase
 * list, and per phase the same checksum and traceHash. Throws "[bench] checksum mismatch ..." /
 * "[bench] endState mismatch ..." (the cold end-of-phase digest, Scenarios.mjs phaseEndState) /
 * "[bench] traceHash mismatch ..." / "[bench] phase mismatch ..." naming both labels. Returns the
 * number of (Sid, n) groups checked. D-row keys are ignored; a chunkCap sweep cell ('~c<cc>') joins its
 * (Sid, n) group under the name '<label>~c<cc>' (chunkCap never changes a checksum). Pure.
 * @param {object} results  the results map ('<label>/<Sid>@<n>' -> cell result)
 * @returns {number}
 */
export function crossCheck(results) {
    const groups = new Map();
    for (const key of Object.keys(results)) {
        const m = RESULT_KEY.exec(key);
        if (!m || m[3] === undefined) continue;
        const g = m[3] + '@' + m[4];
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push([m[5] === undefined ? m[1] : m[1] + '~c' + m[5], results[key]]);
    }
    for (const [g, list] of groups) {
        const [refName, ref] = list[0];
        for (let j = 1; j < list.length; j++) {
            const [name, row] = list[j];
            const a = ref.phases.map((p) => p.phase).join(',');
            const b = row.phases.map((p) => p.phase).join(',');
            if (a !== b) throw new Error('[bench] phase mismatch ' + g + ': ' + refName + ' [' + a + '] vs ' + name + ' [' + b + ']');
            for (let k = 0; k < ref.phases.length; k++) {
                const p = ref.phases[k];
                const q = row.phases[k];
                if (p.checksum !== q.checksum) {
                    throw new Error('[bench] checksum mismatch ' + g + ' phase ' + p.phase + ': ' + refName + ' ' + p.checksum +
                        ' vs ' + name + ' ' + q.checksum);
                }
                if (p.endState !== q.endState) {
                    throw new Error('[bench] endState mismatch ' + g + ' phase ' + p.phase + ': ' + refName + ' 0x' +
                        (p.endState >>> 0).toString(16) + ' vs ' + name + ' 0x' + (q.endState >>> 0).toString(16));
                }
                if (p.traceHash !== q.traceHash) {
                    throw new Error('[bench] traceHash mismatch ' + g + ' phase ' + p.phase + ': ' + refName + ' 0x' +
                        (p.traceHash >>> 0).toString(16) + ' vs ' + name + ' 0x' + (q.traceHash >>> 0).toString(16));
                }
            }
        }
    }
    return groups.size;
}

/**
 * Fail-closed check of a results.json payload (the frozen group 1 -> group 2 contract).
 * Throws an Error whose message names the missing or invalid field (e.g. "meta.mainFileSha").
 * @param {object} results
 * @returns {true}
 */
export function validateResults(results) {
    if (!isPlain(results)) rvFail('(root)', 'must be a plain object');
    for (const k of TOP_REQUIRED) if (!Object.prototype.hasOwnProperty.call(results, k)) rvFail(k, 'missing');
    const known = TOP_REQUIRED.concat(TOP_OPTIONAL);
    for (const k of Object.keys(results)) if (!known.includes(k)) rvFail(k, 'unknown key' + didYouMean(k, known));
    if (results.schema !== SCHEMA) rvFail('schema', "must be '" + SCHEMA + "', got " + JSON.stringify(results.schema));
    if (!STATUSES.includes(results.status)) rvFail('status', "must be 'MEASURED' or 'PENDING'");
    validateMeta(results.meta);
    for (const k of ['subjects', 'dimensions', 'scenarios']) {
        const a = results[k];
        if (!Array.isArray(a) || !a.every(nonEmptyString)) rvFail(k, 'must be an array of non-empty strings');
    }
    if (results.subjects.length === 0) rvFail('subjects', 'must be non-empty');
    if (!isPlain(results.titles)) rvFail('titles', 'must be a plain object');
    if (!isPlain(results.results)) rvFail('results', 'must be a plain object');
    const keys = Object.keys(results.results);
    if (results.status === 'MEASURED' && keys.length === 0) rvFail('results', 'must hold >= 1 cell when MEASURED');
    for (const key of keys) {
        const m = RESULT_KEY.exec(key);
        if (!m) rvFail('results.' + key, "key must be '<adapter>/<Dk>', '<label>/<Sid>@<n>' or '<label>/<Sid>@<n>~c<chunkCap>'");
        const row = results.results[key];
        if (!isPlain(row)) rvFail('results.' + key, 'must be a plain object');
        if (row.member !== undefined && row.member !== m[1]) rvFail('results.' + key + '.member', 'must be ' + m[1]);
        if (m[3] !== undefined && (row.scenario !== m[3] || row.n !== Number(m[4]))) {
            rvFail('results.' + key + '.scenario', 'must be ' + m[3] + ' at n ' + m[4]);
        }
        if (m[5] !== undefined && row.chunkCap !== Number(m[5])) {
            rvFail('results.' + key + '.chunkCap', 'must equal its key tag ~c' + m[5] + ', got ' + JSON.stringify(row.chunkCap));
        }
        let adapter;
        try {
            adapter = selectAdapter(labelBase(m[1]));
        } catch (e) {
            rvFail('results.' + key, 'names no live adapter: ' + e.message);
        }
        walkRow(adapter, row, 'results.' + key);
    }
    if (!Array.isArray(results.lossTable)) rvFail('lossTable', 'must be an array');
    results.lossTable.forEach(validateLossRow);
    if (results.adapters !== undefined && !isPlain(results.adapters)) rvFail('adapters', 'must be a plain object');
    if (results.opClass !== undefined && !isPlain(results.opClass)) rvFail('opClass', 'must be a plain object');
    if (results.foil !== undefined && !nonEmptyString(results.foil)) rvFail('foil', 'must be a non-empty string');
    return true;
}

// ---------------------------------------------------------------------------
// CLI argument parsing (fail closed: an unknown flag or a bad value exits 2).
// ---------------------------------------------------------------------------

const VALUE_FLAGS = ['--scenario', '--runs', '--seed', '--member', '--dim', '--n', '--tune', '--sweep', '--picks'];
const CELL_ONLY_FLAGS = ['--member', '--dim', '--n', '--tune'];
const PARENT_ONLY_FLAGS = ['--sweep', '--all', '--picks'];
const BOOL_FLAGS = ['--quick', '--publish', '--cell', '--all'];
/** The only --sweep axis (BA-31; the leafSize sweep stays in D4, BA-32). */
export const SWEEP_AXES = Object.freeze(['chunkCap']);

function usageExit(msg) {
    process.stderr.write(msg + '\n');
    process.exit(2);
}

/**
 * Parse the CLI flags into an options object. Fail closed: an unknown flag or a bad value prints the
 * reason and exits 2. Exported so a test can pin the parsed shape of a valid argv.
 * @param {string[]} argv
 */
export function parseArgs(argv) {
    const o = { scenario: null, runs: 1, seed: DEFAULT_SEED, quick: false, publish: false, cell: false,
        member: null, dim: null, n: null, tune: undefined, sweep: null, all: false, picks: null };
    const all = VALUE_FLAGS.concat(BOOL_FLAGS);
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (BOOL_FLAGS.includes(a)) { o[a.slice(2)] = true; continue; }
        if (!VALUE_FLAGS.includes(a)) usageExit('[bench] unknown flag ' + a + didYouMean(a, all));
        const v = argv[++i];
        if (v === undefined) usageExit('[bench] ' + a + ' needs a value');
        if (a === '--runs') {
            if (!/^[1-9]\d?$/.test(v)) usageExit('[bench] --runs must be an integer in [1, 99], got ' + v);
            o.runs = Number(v);
        } else if (a === '--seed') {
            if (!/^\d{1,10}$/.test(v) || Number(v) > 0xFFFFFFFF) usageExit('[bench] ' + a + ' must be a uint32, got ' + v);
            o[a.slice(2)] = Number(v);
        } else if (a === '--n') {
            if (!/^[1-9]\d{0,6}$/.test(v) || Number(v) > MAX_SIZE) usageExit('[bench] --n must be an integer in [1, 2^20], got ' + v);
            o.n = Number(v);
        } else if (a === '--tune') {
            let t;
            try { t = JSON.parse(v); } catch (e) { usageExit('[bench] --tune must be a JSON object: ' + e.message); }
            if (!isPlain(t)) usageExit('[bench] --tune must be a JSON object, got ' + v);
            o.tune = t;
        } else if (a === '--sweep') {
            if (!SWEEP_AXES.includes(v)) usageExit('[bench] --sweep must be one of ' + SWEEP_AXES.join(', ') + ', got ' + v + didYouMean(v, SWEEP_AXES));
            o.sweep = v;
        } else if (a === '--picks') {
            // a path string only (its use is B3): non-empty, no NUL, not a flag (a missing value never eats the next flag)
            if (v.length === 0 || v.includes('\0') || v.startsWith('-')) usageExit('[bench] --picks needs a path, got ' + JSON.stringify(v));
            o.picks = v;
        } else {
            o[a.slice(2)] = v;
        }
    }
    if (!o.cell) {
        for (const f of CELL_ONLY_FLAGS) if (argv.includes(f)) usageExit('[bench] ' + f + ' is a child-cell flag: it needs --cell');
    } else {
        for (const f of PARENT_ONLY_FLAGS) if (argv.includes(f)) usageExit('[bench] ' + f + ' is an orchestrator flag: drop --cell');
    }
    if (o.all && o.scenario !== null) usageExit('[bench] --all runs every scenario: drop --scenario');
    if (o.sweep !== null && o.scenario === null && !o.all) usageExit('[bench] --sweep ' + o.sweep + ' sweeps scenario cells: give --scenario <Sid> or --all');
    return o;
}

// ---------------------------------------------------------------------------
// Single-cell mode: run exactly one dimension and emit its JSON on stdout.
// ---------------------------------------------------------------------------
async function runCell(o) {
    if (o.scenario !== null) {
        let s;
        try {
            s = selectScenario(o.scenario);
        } catch (e) {
            usageExit(e.message); // "unknown scenario <id>" -> exit 2
        }
        if (!s.adapters.includes(o.member)) {
            usageExit('[bench] bad scenario cell: --member ' + o.member + ' is not a label of ' + s.id + ' (' + s.adapters.join(', ') + ')');
        }
        if (!scenarioSizes(s, o.quick).includes(o.n)) {
            usageExit('[bench] bad scenario cell: --n ' + o.n + ' is not a size of ' + s.id + (o.quick ? ' --quick' : '') +
                ' (' + scenarioSizes(s, o.quick).join(', ') + ')');
        }
        const result = await runScenario(o.member, s, o.n, { seed: o.seed, quick: o.quick, tune: o.tune });
        if (result.phases.length === 0) throw new Error('[bench] vacuous: ' + s.id + '/' + o.member + ' returned no phase');
        process.stdout.write(JSON.stringify(result));
        return;
    }
    if (o.n !== null || o.tune !== undefined) usageExit('[bench] --n / --tune are scenario-cell flags: they need --scenario');
    const member = o.member;
    const dim = o.dim;
    if (!(SUBJECTS.includes(member) || member === FOIL) || !DIMENSIONS.includes(dim)) {
        process.stderr.write('[bench] bad cell: member=' + member + ' dim=' + dim + '\n');
        process.exit(2);
    }
    // Quiesce before the two THERMAL-SENSITIVE dimensions (the kit's settle): the D1 fit and the
    // D6 heap-delta curve. A --quick smoke skips it.
    if (!o.quick && (dim === 'D1' || dim === 'D6')) {
        if (typeof globalThis.gc === 'function') globalThis.gc();
        await new Promise((r) => setTimeout(r, 3000));
    }
    const result = await runDimension(member, dim, { seed: o.seed, quick: o.quick });
    result.baseline = baselineFor(member, dim);
    vacuityCheck(result); // fail closed: an empty array or an impossible 0 -> throw -> non-zero exit
    process.stdout.write(JSON.stringify(result));
}

// ---------------------------------------------------------------------------
// Orchestrator mode: spawn a child per cell, collect, summarize, validate, persist.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The cell plan (cold): exclusions (BA-34), the chunkCap sweep (BA-31), (Sid, n) groups (BA-28).
// ---------------------------------------------------------------------------

/** Census wall time per pass above which a scenario cell is excluded (BA-34). */
export const EXCLUDE_LIMIT_S = 300;
/** The ruled reason an excluded cell prints (BA-34 / R-BA34 option A). */
export const EXCLUDE_REASON = 'O(n) rebuild per structural op';

/**
 * The cells left out of the sweep and the run of record (BA-34): every census cell over
 * EXCLUDE_LIMIT_S s per pass, each { label, sid, n, censusS, reason }. FROZEN from
 * .handoff/evidence/bench-adopt/g2b3/census.json (B0, frozen ea760e4, PRELIMINARY, 1 pass, 37 / 37 cells
 * complete): the slowest cell read 105.25 s (FenwickRebuild.full S1b@1000000), none over 300 s, so the
 * list is empty today. A re-census edits this constant, never a run's flags.
 */
export const EXCLUDED = Object.freeze([]);

const EXCLUDED_FIELDS = ['label', 'sid', 'n', 'censusS', 'reason'];

/**
 * Fail-closed check of an exclusion list (BA-34). Throws on a malformed entry, an unknown label /
 * scenario / size, a census time not over EXCLUDE_LIMIT_S, a duplicate, and on any SumSequence or
 * BlockedArray-family cell ("never excluded: one over 300 s re-plans the run"). Returns the list.
 */
export function validateExcluded(list) {
    if (!Array.isArray(list)) throw new TypeError('[bench] EXCLUDED: must be an array');
    const seen = new Set();
    for (let i = 0; i < list.length; i++) {
        const e = list[i];
        const w = '[bench] EXCLUDED[' + i + ']';
        if (!isPlain(e)) throw new TypeError(w + ': must be a plain {label, sid, n, censusS, reason}');
        for (const k of Object.keys(e)) if (!EXCLUDED_FIELDS.includes(k)) throw new TypeError(w + ': unknown key ' + k + didYouMean(k, EXCLUDED_FIELDS));
        for (const k of EXCLUDED_FIELDS) if (!Object.prototype.hasOwnProperty.call(e, k)) throw new TypeError(w + '.' + k + ': missing');
        if (!knownLabels().includes(e.label)) throw new Error(w + ".label: unknown label '" + String(e.label) + "'");
        if (e.label === 'SumSequence' || labelBase(e.label) === 'BlockedArray') {
            throw new Error(w + ': ' + e.label + ' is never excluded (BA-34: a SumSequence or BlockedArray cell over ' +
                EXCLUDE_LIMIT_S + ' s re-plans the run)');
        }
        let sc;
        try { sc = selectScenario(e.sid); } catch (err) { throw new Error(w + '.sid: ' + err.message); }
        if (!sc.adapters.includes(e.label)) throw new Error(w + ': ' + e.label + ' is not a label of ' + sc.id);
        if (!scenarioSizes(sc, false).includes(e.n)) throw new Error(w + '.n: ' + String(e.n) + ' is not a size of ' + sc.id);
        if (!(typeof e.censusS === 'number' && e.censusS > EXCLUDE_LIMIT_S && isFinite(e.censusS))) {
            throw new Error(w + '.censusS: must be a census time over ' + EXCLUDE_LIMIT_S + ' s, got ' + String(e.censusS));
        }
        if (!nonEmptyString(e.reason)) throw new Error(w + '.reason: must be a non-empty string');
        const k = e.label + '/' + e.sid + '@' + e.n;
        if (seen.has(k)) throw new Error(w + ': ' + k + ' listed twice');
        seen.add(k);
    }
    return list;
}

/** The printed exclusion line (BA-34 wording). */
export function exclusionLine(e) {
    return e.label + ' ' + e.sid + '@' + e.n + ' excluded: census ' + e.censusS + ' s per pass (' + e.reason + ')';
}

/**
 * The cell plan of one orchestrator run, cold. Returns { groups, excluded, sweep }: groups = the
 * cells as run-order groups (each D-row alone; each scenario (Sid, n) one group, its labels in the
 * registry order -- the orchestrator rotates each group per pass), excluded = the EXCLUDED entries
 * of the scenarios in scope, sweep = one { sid, n, capacity, d, grid } row per swept (Sid, n). A
 * sweep cell is the registered BlockedArray with tune { chunkCap } and its chunkCap field set; d =
 * defaultChunkCap(capacity), capacity from the scenario's build at this n, computed HERE, cold.
 * excluded keeps only the rows whose n is a size of THIS run (a --quick run caps sizes, so a row at a
 * full-run n drops out). Throws "unknown scenario <id>" on a bad --scenario, on a bad exclusion list,
 * and on --picks or --sweep --publish (both refused until g2b-3a B3; orchestrate -> exit 2).
 * @param {object} o  parseArgs options
 * @param {object[]} [excludedList]  defaults to EXCLUDED
 */
export function planCells(o, excludedList = EXCLUDED) {
    validateExcluded(excludedList);
    if (o.picks !== null) throw new Error('[bench] --picks lands with publishGuard (g2b-3a B3): refused until then');
    if (o.sweep !== null && o.publish) throw new Error('[bench] --sweep --publish writes benchmark/chunkcap.json (BA-31, g2b-3a B3): refused until then');
    const groups = [];
    const sweep = [];
    const ids = o.scenario !== null ? [selectScenario(o.scenario).id] : o.all ? SCENARIOS.map((x) => x.id) : [];
    // an EXCLUDED row names a full-run n: a --quick run (sizes capped) is not its run, so it drops out
    const excluded = excludedList.filter((e) => ids.includes(e.sid) && scenarioSizes(selectScenario(e.sid), o.quick).includes(e.n));
    if (ids.length === 0 || (o.all && o.sweep === null)) for (const c of cells()) groups.push([c]);
    for (const id of ids) {
        const sc = selectScenario(id);
        if (o.sweep === 'chunkCap') {
            const ba = selectAdapter('BlockedArray');
            for (const n of scenarioSizes(sc, o.quick)) {
                const capacity = sc.build(ba, n, o.seed >>> 0, scenarioEvents(o.quick)).capacity;
                const d = defaultChunkCap(capacity);
                const grid = sweepGrid(d);
                sweep.push({ sid: sc.id, n, capacity, d, grid });
                groups.push(grid.map((chunkCap) => ({ member: 'BlockedArray', dim: sc.id, baseline: NA, n, scenario: sc.id,
                    tune: { chunkCap }, chunkCap })));
            }
            continue;
        }
        const exclude = excluded.filter((e) => e.sid === sc.id).map((e) => ({ label: e.label, n: e.n }));
        const byN = new Map();
        for (const c of cells(sc.id, { quick: o.quick, exclude })) {
            if (!byN.has(c.n)) byN.set(c.n, []);
            byN.get(c.n).push(c);
        }
        for (const g of byN.values()) groups.push(g);
    }
    return { groups, excluded, sweep };
}

/** The cells of one pass in run order, pure (BA-28): pass-major, each group rotated left by pass. */
export function runOrder(plan, pass) {
    return plan.groups.flatMap((g) => rotateLabels(g, pass));
}

function spawnCell(member, dim, o, c = null) {
    const flags = ['--expose-gc'];
    if (dim === 'D6') flags.push('--no-concurrent-recompilation');
    const args = c !== null && c.scenario !== undefined
        ? flags.concat([THIS_FILE, '--cell', '--scenario', c.scenario, '--member', member, '--n', String(c.n),
            '--seed', String(o.seed)])
        : flags.concat([THIS_FILE, '--cell', '--member', member, '--dim', dim, '--seed', String(o.seed)]);
    if (c !== null && c.tune !== undefined) args.push('--tune', JSON.stringify(c.tune));
    if (o.quick) args.push('--quick');
    const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
    if (r.status !== 0) {
        const err = (r.stderr || '').trim() || ('exit ' + r.status + (r.signal ? ' signal ' + r.signal : ''));
        throw new Error('[bench] cell ' + member + '/' + dim + ' FAILED: ' + err);
    }
    return parseCellResult(member, dim, r.stdout);
}

function fmt(x) {
    if (typeof x !== 'number' || !isFinite(x)) return String(x);
    if (x === 0) return '0';
    if (x >= 1000) return x.toFixed(0);
    if (x >= 1) return x.toFixed(2);
    return x.toFixed(4);
}

function git(args) {
    const r = spawnSync('git', args, { cwd: PKG_DIR, encoding: 'utf8' });
    if (r.status !== 0) throw new Error('[bench] meta.commit: git ' + args.join(' ') + ' failed: ' + (r.stderr || '').trim());
    return r.stdout;
}

/** Short sha, '-dirty' appended when the working tree has any change (read-only git). */
function commitId() {
    const sha = git(['rev-parse', '--short', 'HEAD']).trim();
    const dirty = git(['status', '--porcelain']).trim().length > 0;
    return sha + (dirty ? '-dirty' : '');
}

function mainFileSha() {
    return createHash('sha256').update(readFileSync(MAIN_FILE)).digest('hex').slice(0, 8);
}

/**
 * meta.rivals: live rival / counter adapters (then the extra [label, adapter] pairs a scenario run
 * resolved, e.g. 'BlockedArray.plain'), then every RIVAL_SLOTS entry still PENDING and every
 * RETIRED_SLOTS entry, each as 'n/a' + its reason (FenwickFixed: R-BA18).
 * @param {[string, object][]} [extra]
 */
export function rivalsMeta(extra = []) {
    const out = {};
    for (const a of ADAPTERS) {
        if (a.role === 'rival' || a.role === 'counter') out[a.name] = { role: a.role, status: 'LIVE', version: a.version, params: a.params };
    }
    for (const [label, a] of extra) {
        if (!Object.prototype.hasOwnProperty.call(out, label)) out[label] = { role: a.role, status: 'LIVE', version: a.version, params: a.params };
    }
    for (const slots of [RIVAL_SLOTS, RETIRED_SLOTS]) {
        for (const name of Object.keys(slots)) {
            if (Object.prototype.hasOwnProperty.call(out, name)) continue;
            const s = slots[name];
            out[name] = { role: s.role, status: s.status, version: NA, params: NA, reason: s.reason };
        }
    }
    return out;
}

/**
 * BA-5: 'QUIET' only for a full (non --quick) run whose quiet lock passed QUIET_LOCK_HOST=quiet; else
 * 'PRELIMINARY'. A --quick smoke is never QUIET. Pure (env and quick passed in) so a test can pin it.
 */
export function hostState(env = process.env, quick = false) {
    return !quick && env.QUIET_LOCK_HOST === 'quiet' ? 'QUIET' : 'PRELIMINARY';
}

function quietLockWhy() {
    const w = process.env.QUIET_LOCK_WHY;
    return typeof w === 'string' && w.length > 0 ? w : null;
}

function cpuInfo() {
    const cpus = os.cpus();
    return {
        cpuModel: (cpus && cpus.length ? cpus[0].model.trim() : '') || 'unknown',
        cpuCount: cpus && cpus.length ? cpus.length : os.availableParallelism(),
    };
}

function printHeader(o, meta0, nCells, extra = [], plan = null) {
    const cpu = cpuInfo();
    console.log('===========================================================================');
    console.log('@zakkster/lite-yggdrasil -- benchmark suite (' + nCells + ' cells' +
        (o.scenario ? ', scenario ' + o.scenario : o.all ? ', all: ' + (o.sweep ? '' : DIMENSIONS.length + ' dimensions + ') +
            SCENARIOS.length + ' scenarios' : ', ' + DIMENSIONS.length + ' dimensions') + (o.sweep ? ', --sweep ' + o.sweep : '') +
        ', subject ' + SUBJECTS.join(', ') + ' vs foil ' + FOIL + ')');
    console.log('===========================================================================');
    console.log('  seed:    0x' + (o.seed >>> 0).toString(16) + ' (' + (o.seed >>> 0) + ')');
    console.log('  node:    ' + process.version);
    console.log('  cpu:     ' + cpu.cpuModel + ' x' + cpu.cpuCount);
    console.log('  arch:    ' + process.arch + ' / ' + process.platform);
    console.log('  date:    ' + meta0.date);
    console.log('  load:    ' + meta0.loadAvgStart.map((x) => x.toFixed(2)).join(' '));
    console.log('  host:    ' + meta0.hostState + (meta0.quietLockWhy ? ' (' + meta0.quietLockWhy + ')' : ' (not under quiet-lock)'));
    console.log('  commit:  ' + meta0.commit + ' | Yggdrasil.js sha256/8 ' + meta0.mainFileSha);
    console.log('  runs:    ' + o.runs + (o.quick ? ' | QUICK (a smoke, never a run of record)' : ''));
    console.log('  writes:  ' + (o.publish ? PUBLISH_PATHS.label : OUT_PATHS.label) + 'results.json + report.html');
    console.log('  gc:      children spawned with --expose-gc; D6 children + --no-concurrent-recompilation');
    console.log('  NOTE:    counts are DETERMINISTIC; every timing is REPORTED (gates nothing).');
    console.log('  NOTE:    D4 is a PORTABLE PROXY (no native perf counters).');
    for (const [name, v] of Object.entries(rivalsMeta(extra))) {
        console.log('  rival:   ' + name + ' (' + v.role + ') ' + (v.version === NA ? v.status + ' n/a -- ' + v.reason : v.version));
    }
    if (o.scenario) {
        const s = selectScenario(o.scenario);
        console.log('  scenario ' + s.id + ': ' + s.title + ' | dims ' + s.dims + ' | views ' + s.views + ' | sizes ' +
            scenarioSizes(s, o.quick).join(', ') + (o.quick ? ' (--quick: capped at 4096, events / 10)' : ''));
        for (const k of Object.keys(s.mix)) console.log('  mix.' + k + ': ' + (typeof s.mix[k] === 'object' ? JSON.stringify(s.mix[k]) : s.mix[k]));
    }
    if (plan !== null) {
        console.log('  order:   each (Sid, n) group rotated by one label per pass (BA-28, pass-major)');
        for (const w of plan.sweep) {
            console.log('  sweep:   ' + w.sid + '@' + w.n + ' capacity ' + w.capacity + ' d ' + w.d + ' chunkCap ' + w.grid.join(', '));
        }
        for (const e of plan.excluded) console.log('  exclude: ' + exclusionLine(e));
        if (o.scenario !== null || o.all) {
            console.log('  exclude: ' + (plan.excluded.length === 0 ? 'none (no census cell over ' + EXCLUDE_LIMIT_S + ' s per pass, BA-34)'
                : plan.excluded.length + ' cell(s), never a GO input (BA-34)'));
        }
    }
    console.log('');
}

function na(r) {
    return r && typeof r.na === 'string' ? 'n/a (' + r.na + ')' : null;
}

function perOpCount(row, key) {
    const v = row.counts ? row.counts[key] : undefined;
    return typeof v === 'number' ? fmt(v / row.ops) : NA;
}

function summarize(results) {
    const members = [...SUBJECTS, FOIL];
    const get = (m, d) => results[m + '/' + d];
    const line = (title) => console.log('-- ' + title + ' ' + '-'.repeat(Math.max(3, 72 - title.length)));

    if (members.some((m) => get(m, 'D1'))) {
        line('D1 splice witness (counts first; fit REPORTED)');
        for (const m of members) {
            const r = get(m, 'D1');
            if (!r) continue;
            if (na(r)) { console.log('  ' + m.padEnd(12) + ' ' + na(r)); continue; }
            const byKind = new Map();
            for (const c of r.counts) {
                const k = c.op;
                const cur = byKind.get(k) || { maxPer: 0, maxT: 0, maxB: -Infinity, viol: 0, moves: 0, exact: true };
                if (typeof c.touchesPerOp === 'number') {
                    cur.maxPer = Math.max(cur.maxPer, c.touchesPerOp);
                    cur.maxT = Math.max(cur.maxT, c.maxTouches);
                    cur.maxB = Math.max(cur.maxB, c.maxBound);
                    cur.viol += c.violations;
                } else {
                    cur.moves = Math.max(cur.moves, c.movesPerOp);
                    cur.exact = cur.exact && c.exact;
                }
                byKind.set(k, cur);
            }
            for (const [k, c] of byKind) {
                if (r.unit === 'moves/op') {
                    console.log('  ' + (m + '.' + k).padEnd(30) + ' max moves/op ' + fmt(c.moves) + ' (exact n - floor(n/2): ' + (c.exact ? 'yes' : 'NO') + ')');
                } else {
                    console.log('  ' + (m + '.' + k).padEnd(30) + ' max touches/op ' + fmt(c.maxPer).padStart(7) +
                        '  max single ' + String(c.maxT).padStart(4) + ' <= bound ' + String(c.maxB).padStart(4) +
                        '  violations ' + c.viol);
                }
            }
            const f = r.fit;
            console.log('  ' + (m + ' fit').padEnd(30) + (f === NA ? ' n/a' : ' r2 ' + fmt(f.r2) + ' slope ' + fmt(f.slope) +
                ' ns/level (r2 reference ' + f.r2Reference + ', gates nothing)') + ' | traceHash 0x' + (r.traceHash >>> 0).toString(16));
        }
        console.log('');
    }
    if (members.some((m) => get(m, 'D2'))) {
        line('D2 amortized drift (last/first cumulative ns/op)');
        for (const m of members) {
            const r = get(m, 'D2');
            if (!r) continue;
            const last = na(r) ? null : r.points[r.points.length - 1];
            console.log('  ' + m.padEnd(12) + (na(r) || ' drift=' + fmt(r.drift) + ' over ' + r.total + ' ops, final ' +
                fmt(last.nsPerOp) + ' ns/op'));
        }
        console.log('');
    }
    if (members.some((m) => get(m, 'D3'))) {
        line('D3 memory (typed-array bytes per live element vs 4 x dims + 4)');
        for (const m of members) {
            const r = get(m, 'D3');
            if (!r) continue;
            if (na(r)) { console.log('  ' + m.padEnd(12) + ' ' + na(r)); continue; }
            for (const x of r.rows) {
                console.log('  ' + m.padEnd(12) + ' dims ' + x.dims + '  B/live ' + fmt(x.perLive).padStart(7) +
                    '  floor ' + x.floor + '  ratio ' + fmt(x.ratio) + (x.stable ? '' : '  REFILL CHANGED BYTES'));
            }
        }
        console.log('');
    }
    if (members.some((m) => get(m, 'D4'))) {
        line('D4 cache PROXY (walk ns/elem vs random seek ns/op)');
        for (const m of members) {
            const r = get(m, 'D4');
            if (!r) continue;
            if (na(r)) { console.log('  ' + m.padEnd(12) + ' ' + na(r)); continue; }
            console.log('  ' + m.padEnd(12) + ' default   walk ' + fmt(r.walk.nsPerElem) + '  seek ' + fmt(r.seek.nsPerOp) + '  gap ' + fmt(r.gap));
            for (const p of r.leafSweep) {
                console.log('  ' + m.padEnd(12) + ' leaf ' + String(p.leafSize).padEnd(4) + ' walk ' + fmt(p.walkNsPerElem) +
                    '  seek ' + fmt(p.seekNsPerOp) + '  gap ' + fmt(p.gap));
            }
        }
        console.log('');
    }
    if (members.some((m) => get(m, 'D5'))) {
        line('D5 bundle size (raw + node:zlib gzip; tree-shaking n/a)');
        for (const m of members) {
            const r = get(m, 'D5');
            if (!r) continue;
            console.log('  ' + m.padEnd(12) + (na(r) || ' ' + r.file + ' raw ' + r.raw + '  gzip ' + r.gzip + '  sha256/8 ' + r.sha256_8));
        }
        console.log('');
    }
    if (members.some((m) => get(m, 'D6'))) {
        line('D6 GC pressure (REPORTED; the 0 B/op claim is gated elsewhere)');
        for (const m of members) {
            const r = get(m, 'D6');
            if (!r) continue;
            if (na(r)) { console.log('  ' + m.padEnd(12) + ' ' + na(r)); continue; }
            for (const o of r.perOp) {
                console.log('  ' + (m + '.' + o.op).padEnd(30) + ' B/op ' + o.points.map((p) => p.bytesPerOp).join(' / ') +
                    '  zeroAlloc ' + o.zeroAlloc);
            }
            console.log('  ' + m.padEnd(30) + ' maxMajor ' + r.maxMajor + '  maxPauseMs ' + fmt(r.maxPauseMs));
        }
        console.log('');
    }
    if (members.some((m) => get(m, 'D7'))) {
        line('D7 scalability (ns/insert by pattern x dims, fills joined)');
        for (const m of members) {
            const r = get(m, 'D7');
            if (!r) continue;
            if (na(r)) { console.log('  ' + m.padEnd(12) + ' ' + na(r)); continue; }
            const g = new Map();
            for (const x of r.rows) {
                const k = x.pattern + ' dims ' + x.dims;
                if (!g.has(k)) g.set(k, []);
                g.get(k).push(fmt(x.nsPerOp) + '@' + x.fill);
            }
            for (const [k, v] of g) console.log('  ' + (m + ' ' + k).padEnd(30) + ' ' + v.join('  '));
        }
        console.log('');
    }
    const sKeys = Object.keys(results).filter((k) => { const m = RESULT_KEY.exec(k); return m !== null && m[3] !== undefined; });
    if (sKeys.length > 0) {
        line('Scenario cells (ns/event REPORTED; checksum + endState + traceHash cross-checked per (Sid, n))');
        for (const k of sKeys) {
            for (const p of results[k].phases) {
                console.log('  ' + (k + ' ' + p.phase).padEnd(40) + ' ' + fmt(p.nsPerOp).padStart(9) + ' ns/event  events ' +
                    String(p.events).padStart(6) + '  checksum ' + p.checksum + '  endState 0x' + (p.endState >>> 0).toString(16) + '  traceHash 0x' + (p.traceHash >>> 0).toString(16));
            }
        }
        console.log('');
    }
    if (members.some((m) => get(m, 'D8'))) {
        line('D8 op-row workloads (ns/op | touches/op | moves/op)');
        for (const m of members) {
            const r = get(m, 'D8');
            if (!r) continue;
            if (na(r)) { console.log('  ' + m.padEnd(12) + ' ' + na(r)); continue; }
            for (const x of r.rows) {
                if (typeof x.na === 'string') { console.log('  ' + (m + '.' + x.op).padEnd(30) + ' n/a (' + x.na + ')'); continue; }
                console.log('  ' + (m + '.' + x.op).padEnd(30) + ' ' + fmt(x.nsPerOp).padStart(9) + ' | ' +
                    perOpCount(x, 'touches').padStart(7) + ' | ' + perOpCount(x, 'moves').padStart(9));
            }
        }
        console.log('');
    }
}

async function orchestrate(o) {
    if (o.publish && o.quick) usageExit('[bench] --publish writes the run of record: drop --quick');
    if (o.publish && process.env.QUIET_LOCK_HOST !== 'quiet' && process.env.QUIET_LOCK_HOST !== 'preliminary') {
        usageExit('[bench] --publish is the run of record: run it under quiet-lock');
    }
    let plan;
    try {
        plan = planCells(o);
    } catch (e) {
        usageExit(e.message); // "unknown scenario <id>" -> exit 2
    }
    const all = plan.groups.flat();
    // labels that are not registered adapter names (BlockedArray variants) print in meta.rivals too
    const extra = [];
    for (const c of all) {
        if (c.scenario === undefined || labelBase(c.member) === c.member || extra.some((x) => x[0] === c.member)) continue;
        const a = await resolveLabel(c.member);
        if (!ADAPTERS.includes(a)) extra.push([c.member, a]);
    }
    const P = o.publish ? PUBLISH_PATHS : OUT_PATHS;
    const meta0 = {
        date: new Date().toISOString(),
        loadAvgStart: os.loadavg(),
        hostState: hostState(process.env, o.quick),
        quietLockWhy: quietLockWhy(),
        commit: commitId(),
        mainFileSha: mainFileSha(),
    };
    printHeader(o, meta0, all.length, extra, plan);

    // fail closed: no two cells may share a result key (variant labels; a g2b-3 tune sweep must tag its keys)
    const seenKeys = new Set();
    for (const c of all) {
        const key = keyOf(c);
        if (seenKeys.has(key)) usageExit('[bench] duplicate result key ' + key + ' (one cell per label x scenario x n)');
        seenKeys.add(key);
    }
    const results = {};
    let failures = 0;
    for (let pass = 0; pass < o.runs; pass++) {
        // BA-28: pass-major; inside each (Sid, n) group the label order rotates by one per pass
        for (const c of runOrder(plan, pass)) {
            const key = keyOf(c);
            process.stderr.write('  running ' + key + (o.runs > 1 ? ' pass ' + (pass + 1) + '/' + o.runs : '') + ' (' +
                (DIMENSION_TITLES[c.dim] || c.dim) + ') ...\n');
            try {
                const r = spawnCell(c.member, c.dim, o, c);
                if (pass === 0) results[key] = r;
                else if (results[key]) (results[key].repeats ||= []).push(r);
            } catch (e) {
                failures++;
                process.stderr.write('  ' + e.message + '\n');
            }
        }
    }
    if (failures > 0) {
        process.stderr.write('[bench] ' + failures + ' cell(s) failed\n');
        process.exit(1);
    }

    try {
        const g = crossCheck(results);
        if (g > 0) console.log('[bench] cross-check: checksum + endState + traceHash agree across every label in ' + g + ' (Sid, n) group(s)');
    } catch (e) {
        process.stderr.write(e.message + '\n[bench] nothing written\n');
        process.exit(1);
    }

    summarize(results);

    // Drift sentinel: re-run SumSequence/D2 after the whole matrix and compare its first-checkpoint
    // ns/op. DISCLOSURE, not a failure: a noisy run is still a run, so exit stays 0.
    let sentinel = null;
    const sentinelKey = results['SumSequence/D2'] ? 'SumSequence/D2' : null;
    if (sentinelKey) {
        const first = sentinelMetric(results[sentinelKey]);
        const second = sentinelMetric(spawnCell('SumSequence', 'D2', o));
        const drift = driftFraction(first, second);
        sentinel = { cell: sentinelKey, first, second, drift, limit: DRIFT_LIMIT };
        if (driftExceeds(first, second)) {
            console.log('[bench] WARNING: thermal/turbo drift ' + (drift * 100).toFixed(0) +
                '% on the sentinel cell (' + sentinelKey + ' ' + fmt(first) + ' -> ' + fmt(second) +
                ' ns/op) -- results may be noisy');
        }
    }

    const cpu = cpuInfo();
    const meta = {
        seed: o.seed >>> 0, node: process.version, arch: process.arch, platform: process.platform,
        cpuModel: cpu.cpuModel, cpuCount: cpu.cpuCount, date: meta0.date, sentinel,
        loadAvgStart: meta0.loadAvgStart, loadAvgEnd: os.loadavg(),
        hostState: meta0.hostState, quietLockWhy: meta0.quietLockWhy,
        commit: meta0.commit, mainFileSha: meta0.mainFileSha,
        runCount: o.runs, command: ['node', 'benchmark/Bench.mjs', ...process.argv.slice(2)].join(' '),
        rivals: rivalsMeta(extra),
    };
    const adapters = {};
    for (const a of ADAPTERS) adapters[a.name] = { role: a.role, version: a.version, params: a.params };
    const payload = {
        schema: SCHEMA, status: 'MEASURED', meta,
        subjects: SUBJECTS, foil: FOIL, dimensions: DIMENSIONS, titles: DIMENSION_TITLES,
        scenarios: o.scenario !== null ? [selectScenario(o.scenario).id] : SCENARIOS.map((s) => s.id),
        adapters, results,
        lossTable: [], // group 2b: the scenario runs measure the loss rows (RESEARCH section 4.3)
        opClass: OP_CLASS,
    };
    // round-trip through JSON first, so the check sees exactly what lands on disk
    const json = JSON.stringify(payload, null, 2);
    const onDisk = JSON.parse(json);
    try {
        validateResults(onDisk);
    } catch (e) {
        process.stderr.write(e.message + '\n[bench] nothing written\n');
        process.exit(1);
    }
    const { renderHtml } = await import('./Report.mjs');
    const html = renderHtml(onDisk);
    if (!o.publish) mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(P.results, json);
    writeFileSync(P.report, html);
    console.log('results written to ' + P.label + 'results.json + report.html (' + all.length + ' cells x ' +
        o.runs + ' run(s), host ' + meta.hostState + ')');
}

// Guard: only run the CLI (single-cell or orchestrator) when this file is the process entry point,
// so importing Bench.mjs (tests, Report.mjs, Readme.mjs) runs nothing.
const isMain = process.argv[1] === THIS_FILE;
if (isMain) {
    const o = parseArgs(process.argv.slice(2));
    const run = o.cell ? runCell(o) : orchestrate(o);
    run.catch((e) => {
        process.stderr.write((e && e.message ? e.message : String(e)) + '\n');
        process.exit(1);
    });
}
