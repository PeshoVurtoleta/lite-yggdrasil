/**
 * @zakkster/lite-yggdrasil -- benchmark orchestrator.
 *
 * MIT (c) Zahary Shinikchiev <shinikchiev@yahoo.com>
 *
 *     npm run bench                         # every (adapter x dimension) cell -> benchmark/out/
 *     npm run bench -- --quick              # the same, small sizes (a smoke, never a run of record)
 *     npm run bench -- --scenario S7        # one scenario's (label x size) cells (exit 2 on an unknown id)
 *     npm run bench -- --runs 3             # every cell 3 times, interleaved by pass
 *     npm run bench -- --publish --all --runs 5 --picks benchmark/chunkcap.json   # the run of record (under quiet-lock)
 *     npm run bench -- --all                # the 16 D-rows + every registered scenario's cells (BA-33)
 *     npm run bench -- --sweep chunkCap --scenario S7   # BlockedArray x sweepGrid(d) per (Sid, n) (BA-31;
 *                                                     #   d x {1/4, 1/2, 1, 2, 4, 8}, R-BA44)
 *     npm run bench -- --picks <path>       # every BlockedArray label at the picked chunkCap (BA-31)
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
 * registered BlockedArray at every chunkCap of sweepGrid(defaultChunkCap(C)) (g2b-4: the 6-point grid
 * d x {1/4, 1/2, 1, 2, 4, 8}, R-BA44), C the scenario's built
 * capacity computed cold in this parent, keyed '<label>/<Sid>@<n>~c<chunkCap>' (cellKey); EXCLUDED
 * (the census cells over 300 s per pass) are left out and printed with their census seconds.
 *
 * g2b-3a B3 (SPEC BA-29 / BA-30 / BA-31 / BA-33): publishGuard (pure) refuses, with exit 2 before any
 * cell runs or any file is written: --publish without --all; --publish whose --runs is not K (5);
 * --sweep with --picks; a sweep --publish on a non-QUIET host; a QUIET run (published or not) citing a
 * non-QUIET --picks table; a QUIET run-of-record --publish --all with no --picks table or one whose
 * meta.runCount is not K.
 * results.json lossTable = Compare.mjs lossRows(results).rows, its INCONCLUSIVE flag + twin readings
 * in 'comparison' (validated; g2b-4: every BA-29 verdict reads min-of-K (R-BA41), the twin A/A gates
 * on the crossover phase only and its other-phase noise rows are NOT stored (R-BA42); a measured twin
 * reading carries minRatio (finite, > 0), a MISSING one minRatio null); a run with no untagged scenario
 * cell (D-rows only, or a sweep) carries lossTable [] and no 'comparison' (lossRows is never called with
 * nothing to compare). validateResults requires 'comparison' on a MEASURED payload with an untagged
 * scenario cell (BA-36).
 *
 * The chunkCap pick table (benchmark/chunkcap.json; schema PICKS_SCHEMA, checked by validatePicks both
 * when written and when read by --picks; fail closed on a malformed field, an unknown key, a non-plain
 * object, a chunkCap that is not a multiple of 4 in [8, 65536]):
 *   { schema: 'yggdrasil-chunkcap/1',
 *     meta: { date, hostState, commit, mainFileSha, runCount, loadAvgStart, loadAvgEnd, quietLockWhy,
 *             command },                       (the results.json meta checks of the same names)
 *     picks: [{ scenario, n, capacity, d, grid, chunkCap, edge, nsPerEvent }] }
 * one row per swept (Sid, n): d = defaultChunkCap(capacity), grid = sweepGrid(d), chunkCap = the
 * pickChunkCap argmin (a grid member; the pick stays the median-of-K argmin, never min-of-K, R-BA41),
 * edge = it is the grid's first or last entry, nsPerEvent its median-of-K blend ns/event (REPORTED).
 * A table cut on the 5-point grid (before R-BA44) fails validatePicks: re-run --sweep chunkCap.
 * A QUIET `--sweep chunkCap --publish --all` writes benchmark/chunkcap.json ONLY (no results.json /
 * report.html); a sweep without --publish writes benchmark/out/chunkcap.json beside its out/ results.
 * With --picks <path>, every BlockedArray label (BlockedArray, BlockedArray.plain, BlockedArray.twin) runs each (Sid, n) cell with tune { chunkCap:
 * pick } under its UNTAGGED key; planCells exits 2 (also --quick) on a BlockedArray cell with no pick for
 * its (Sid, n), on a stale pick (its capacity is not the capacity this run builds at that (Sid, n): re-run
 * --sweep chunkCap) and on a picks table naming no BlockedArray cell of the run; a cell that recorded
 * another chunkCap exits 1, and results.json carries 'tuning'
 * { source, sha256, hostState, picks } (validateTuning).
 */

import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
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
import { defaultChunkCap, sweepGrid, rotateLabels, lossRows, pickChunkCap, CAP_MIN, CAP_MAX, K } from './Compare.mjs';

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
/** The committed chunkCap pick table (written only by a QUIET `--sweep chunkCap --publish --all`). */
const PICKS_PUBLISH_PATH = fileURLToPath(new URL('./chunkcap.json', import.meta.url));
const PICKS_OUT_PATH = OUT_DIR + 'chunkcap.json';

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
const TOP_OPTIONAL = ['foil', 'adapters', 'opClass', 'tuning', 'comparison'];
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

// ---------------------------------------------------------------------------
// The chunkCap pick table (BA-31) and the payload records that cite it (tuning) or the A/A control
// (comparison). Cold, fail closed; every throw names the field.
// ---------------------------------------------------------------------------

/** chunkcap.json schema id. */
export const PICKS_SCHEMA = 'yggdrasil-chunkcap/1';
const PICKS_TOP = ['schema', 'meta', 'picks'];
/** The picks table meta: the results.json meta checks of the same names. */
export const PICKS_META_FIELDS = Object.freeze(['date', 'hostState', 'commit', 'mainFileSha', 'runCount', 'loadAvgStart',
    'loadAvgEnd', 'quietLockWhy', 'command']);
const PICK_KEYS = ['scenario', 'n', 'capacity', 'd', 'grid', 'chunkCap', 'edge', 'nsPerEvent'];
const TUNING_KEYS = ['source', 'sha256', 'hostState', 'picks'];
const COMPARISON_KEYS = ['inconclusive', 'twin'];
const TWIN_KEYS = ['scenario', 'n', 'phase', 'verdict', 'ratio', 'minRatio'];

function exactKeys(v, keys, w, fail) {
    if (!isPlain(v)) fail(w, 'must be a plain object {' + keys.join(', ') + '}');
    for (const k of keys) if (!Object.prototype.hasOwnProperty.call(v, k)) fail(w + '.' + k, 'missing');
    for (const k of Object.keys(v)) if (!keys.includes(k)) fail(w + '.' + k, 'unknown key' + didYouMean(k, keys));
}

function pkFail(field, detail) {
    throw new Error('[bench] picks: ' + field + ' ' + detail);
}

const capOk = (c) => Number.isInteger(c) && c >= CAP_MIN && c <= CAP_MAX && c % 4 === 0;

// one pick row, with `fail` naming the container (picks table or results.json tuning)
function validatePickRow(p, w, fail) {
    exactKeys(p, PICK_KEYS, w, fail);
    if (typeof p.scenario !== 'string' || !SID_RE.test(p.scenario)) fail(w + '.scenario', 'must be a scenario id, got ' + JSON.stringify(p.scenario));
    try { selectScenario(p.scenario); } catch (e) { fail(w + '.scenario', e.message); }
    if (!(Number.isInteger(p.n) && p.n >= 1 && p.n <= MAX_SIZE)) fail(w + '.n', 'must be an integer in [1, 2^20], got ' + JSON.stringify(p.n));
    if (!(Number.isInteger(p.capacity) && p.capacity >= p.n && p.capacity <= 0x7FFFFFFF)) {
        fail(w + '.capacity', 'must be an integer >= n, got ' + JSON.stringify(p.capacity));
    }
    if (p.d !== defaultChunkCap(p.capacity)) fail(w + '.d', 'must be defaultChunkCap(capacity) = ' + defaultChunkCap(p.capacity) + ', got ' + JSON.stringify(p.d));
    const grid = sweepGrid(p.d);
    if (!Array.isArray(p.grid) || p.grid.length !== grid.length || !grid.every((c, i) => p.grid[i] === c)) {
        fail(w + '.grid', 'must be sweepGrid(d) = [' + grid.join(', ') + '], got ' + JSON.stringify(p.grid));
    }
    if (!capOk(p.chunkCap)) fail(w + '.chunkCap', 'must be an integer multiple of 4 in [' + CAP_MIN + ', ' + CAP_MAX + '], got ' + JSON.stringify(p.chunkCap));
    if (!grid.includes(p.chunkCap)) fail(w + '.chunkCap', 'must be a member of grid, got ' + p.chunkCap);
    const edge = p.chunkCap === grid[0] || p.chunkCap === grid[grid.length - 1];
    if (p.edge !== edge) fail(w + '.edge', 'must be ' + edge + ' (the pick is ' + (edge ? '' : 'not ') + "the grid's first or last chunkCap)");
    if (!(typeof p.nsPerEvent === 'number' && Number.isFinite(p.nsPerEvent) && p.nsPerEvent > 0)) {
        fail(w + '.nsPerEvent', 'must be a finite number > 0, got ' + JSON.stringify(p.nsPerEvent));
    }
}

function validatePickList(list, w, fail) {
    if (!Array.isArray(list) || list.length === 0) fail(w, 'must be a non-empty array');
    const seen = new Set();
    for (let i = 0; i < list.length; i++) {
        validatePickRow(list[i], w + '[' + i + ']', fail);
        const k = list[i].scenario + '@' + list[i].n;
        if (seen.has(k)) fail(w + '[' + i + ']', k + ' listed twice');
        seen.add(k);
    }
}

/**
 * Fail-closed check of a chunkCap pick table (the chunkcap.json format in the header). Used when a
 * sweep writes the table and when --picks reads one. Throws "[bench] picks: <field> ..."; returns true.
 */
export function validatePicks(t) {
    exactKeys(t, PICKS_TOP, '(root)', pkFail);
    if (t.schema !== PICKS_SCHEMA) pkFail('schema', "must be '" + PICKS_SCHEMA + "', got " + JSON.stringify(t.schema));
    exactKeys(t.meta, PICKS_META_FIELDS, 'meta', pkFail);
    for (const f of PICKS_META_FIELDS) {
        const ok = META_CHECKS[f](t.meta[f]);
        if (ok !== true) pkFail('meta.' + f, ok + ', got ' + JSON.stringify(t.meta[f]));
    }
    validatePickList(t.picks, 'picks', pkFail);
    return true;
}

/** Fail-closed check of results.json 'tuning' { source, sha256, hostState, picks } (throws like validateResults). */
export function validateTuning(v) {
    exactKeys(v, TUNING_KEYS, 'tuning', rvFail);
    if (!nonEmptyString(v.source)) rvFail('tuning.source', 'must be a non-empty string (the --picks path)');
    if (typeof v.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(v.sha256)) rvFail('tuning.sha256', 'must be the sha256 of the picks file (64 lowercase hex)');
    if (!HOST_STATES.includes(v.hostState)) rvFail('tuning.hostState', "must be 'QUIET' or 'PRELIMINARY'");
    validatePickList(v.picks, 'tuning.picks', rvFail);
    return true;
}

/**
 * Fail-closed check of results.json 'comparison' { inconclusive, twin } (Compare.mjs twinControl's gate
 * fields; its noise list is never stored, BA-36 / R-BA42). Twin rows { scenario, n, phase, verdict, ratio,
 * minRatio }: ratio / minRatio finite > 0 on a measured reading, both null when MISSING.
 */
export function validateComparison(v) {
    exactKeys(v, COMPARISON_KEYS, 'comparison', rvFail);
    if (typeof v.inconclusive !== 'boolean') rvFail('comparison.inconclusive', 'must be a boolean');
    if (!Array.isArray(v.twin)) rvFail('comparison.twin', 'must be an array');
    if (v.inconclusive !== (v.twin.length > 0)) rvFail('comparison.inconclusive', 'must be true exactly when twin lists a reading');
    v.twin.forEach((t, i) => {
        const w = 'comparison.twin[' + i + ']';
        exactKeys(t, TWIN_KEYS, w, rvFail);
        if (typeof t.scenario !== 'string' || !SID_RE.test(t.scenario)) rvFail(w + '.scenario', 'must be a scenario id');
        if (!(Number.isInteger(t.n) && t.n >= 1)) rvFail(w + '.n', 'must be an integer >= 1');
        const missing = t.verdict === 'MISSING';
        if (!missing && t.verdict !== 'A' && t.verdict !== 'B') rvFail(w + '.verdict', "must be 'A', 'B' or 'MISSING'");
        if (missing ? t.phase !== null : !nonEmptyString(t.phase)) rvFail(w + '.phase', missing ? 'must be null when MISSING' : 'must be a non-empty string');
        if (missing ? t.ratio !== null : !(typeof t.ratio === 'number' && Number.isFinite(t.ratio) && t.ratio > 0)) {
            rvFail(w + '.ratio', missing ? 'must be null when MISSING' : 'must be a finite number > 0');
        }
        if (missing ? t.minRatio !== null : !(typeof t.minRatio === 'number' && Number.isFinite(t.minRatio) && t.minRatio > 0)) {
            rvFail(w + '.minRatio', missing ? 'must be null when MISSING' : 'must be a finite number > 0 (min-of-K twin / BlockedArray, R-BA41)');
        }
    });
    return true;
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
    if (results.comparison !== undefined) validateComparison(results.comparison);
    // BA-29: a loss reason is INCONCLUSIVE-marked exactly when the twin A/A record says so; a marked
    // row with no comparison record cites a reading that is not there (fail closed)
    const inconclusive = results.comparison !== undefined && results.comparison.inconclusive === true;
    results.lossTable.forEach((l, i) => {
        const marked = l.reason.startsWith('INCONCLUSIVE');
        if (marked !== inconclusive) {
            rvFail('lossTable[' + i + '].reason', marked ? 'is marked INCONCLUSIVE but ' + (results.comparison === undefined ?
                'there is no comparison record' : 'comparison.inconclusive is false') :
                'must start INCONCLUSIVE: comparison.inconclusive is true (BA-29)');
        }
    });
    // BA-36: a MEASURED payload with an untagged scenario cell carries its A/A control record; an
    // unmeasured twin is never read as TIE (fail closed). D-rows only, a ~c sweep or PENDING: optional.
    if (results.status === 'MEASURED' && results.comparison === undefined &&
        keys.some((k) => { const m = RESULT_KEY.exec(k); return m[3] !== undefined && m[5] === undefined; })) {
        rvFail('comparison', 'missing: a MEASURED payload with an untagged scenario cell needs { inconclusive, twin } (BA-36)');
    }
    if (results.tuning !== undefined) {
        validateTuning(results.tuning);
        if (results.meta.hostState === 'QUIET' && results.tuning.hostState !== 'QUIET') {
            rvFail('tuning.hostState', 'a QUIET run cannot cite a non-QUIET picks table (BA-31)');
        }
        // every untagged BlockedArray-family cell ran at its (Sid, n) pick (fail closed)
        const pick = new Map(results.tuning.picks.map((p) => [p.scenario + '@' + p.n, p.chunkCap]));
        for (const key of keys) {
            const m = RESULT_KEY.exec(key);
            if (m[3] === undefined || m[5] !== undefined || labelBase(m[1]) !== 'BlockedArray') continue;
            const want = pick.get(m[3] + '@' + m[4]);
            if (want === undefined) rvFail('results.' + key + '.chunkCap', 'has no tuning pick for ' + m[3] + '@' + m[4]);
            const row = results.results[key];
            const runs = [row].concat(Array.isArray(row.repeats) ? row.repeats : []);
            for (const r of runs) {
                if (!isPlain(r) || r.chunkCap !== want) {
                    rvFail('results.' + key + '.chunkCap', 'must equal the tuning pick ' + want + ', got ' + JSON.stringify(isPlain(r) ? r.chunkCap : r));
                }
            }
        }
    }
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
 * excluded keeps only the rows whose n is a size of THIS run (a --quick run caps sizes, so a row at an
 * n outside the quick sizes drops out). With picks (a validatePicks table), every BlockedArray-family
 * cell (BlockedArray, BlockedArray.plain, BlockedArray.twin) gets tune { chunkCap: pick } and
 * pickCap = pick, its key staying UNTAGGED. Throws "unknown scenario <id>" on a bad --scenario, on a
 * bad exclusion list, on a BlockedArray cell whose (Sid, n) has no pick, on a pick whose capacity is
 * not the capacity this run builds at that (Sid, n) (a stale table), and on a picks table naming no
 * BlockedArray cell of the run (orchestrate -> exit 2).
 * @param {object} o  parseArgs options
 * @param {object[]} [excludedList]  defaults to EXCLUDED
 * @param {object|null} [picks]  the parsed + validated --picks table, or null
 */
export function planCells(o, excludedList = EXCLUDED, picks = null) {
    validateExcluded(excludedList);
    if (picks !== null) validatePicks(picks);
    const pickOf = picks === null ? null : new Map(picks.picks.map((p) => [p.scenario + '@' + p.n, p]));
    const builtCap = new Map(); // (Sid, n) -> the built capacity, computed cold the way the sweep computes it
    let tunedCells = 0;
    const groups = [];
    const sweep = [];
    const ids = o.scenario !== null ? [selectScenario(o.scenario).id] : o.all ? SCENARIOS.map((x) => x.id) : [];
    // a --quick run keeps only the EXCLUDED rows whose n is one of its (capped) sizes
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
        for (const c0 of cells(sc.id, { quick: o.quick, exclude })) {
            let c = c0;
            if (pickOf !== null && labelBase(c.member) === 'BlockedArray') {
                const p = pickOf.get(sc.id + '@' + c.n);
                if (p === undefined) {
                    throw new Error('[bench] --picks: no chunkCap pick for ' + sc.id + '@' + c.n + ' (' + c.member + ' cannot run untuned: fail closed)');
                }
                const at = sc.id + '@' + c.n;
                if (!builtCap.has(at)) builtCap.set(at, sc.build(selectAdapter('BlockedArray'), c.n, o.seed >>> 0, scenarioEvents(o.quick)).capacity);
                if (p.capacity !== builtCap.get(at)) {
                    throw new Error('[bench] --picks: the pick for ' + at + ' was swept at capacity ' + p.capacity + ', this run builds capacity ' +
                        builtCap.get(at) + ' (a stale table: re-run --sweep chunkCap)');
                }
                tunedCells++;
                c = { ...c0, tune: { chunkCap: p.chunkCap }, pickCap: p.chunkCap };
            }
            if (!byN.has(c.n)) byN.set(c.n, []);
            byN.get(c.n).push(c);
        }
        for (const g of byN.values()) groups.push(g);
    }
    if (picks !== null && tunedCells === 0) throw new Error('[bench] --picks names no BlockedArray cell of this run');
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

/**
 * The publication guard (BA-31 / BA-33), PURE: o = parseArgs options, env = the process env (host via
 * hostState(env, o.quick)), picks = the parsed --picks table or null. Returns null (allowed) or the
 * refusal message; orchestrate exits 2 on a message before any cell runs or any file is written.
 * Refused: --sweep with --picks; a QUIET run (published or not) citing a non-QUIET picks table;
 * --publish without --all (both modes); a sweep --publish on a non-QUIET host (only a QUIET sweep
 * writes the committed chunkcap.json); a QUIET run-of-record --publish --all with no picks table, a
 * non-QUIET one or one whose meta.runCount is not K; any --publish whose --runs is not K (R-BA28).
 */
export function publishGuard(o, env, picks) {
    const host = hostState(env, o.quick);
    if (o.sweep !== null && (o.picks !== null || picks !== null)) {
        return '[bench] --sweep ' + o.sweep + ' computes the picks: drop --picks';
    }
    if (!o.publish) {
        // BA-31: a QUIET run never cites a non-QUIET picks table, published or not
        if (host === 'QUIET' && picks !== null && (!isPlain(picks) || !isPlain(picks.meta) || picks.meta.hostState !== 'QUIET')) {
            return '[bench] a QUIET run refuses a non-QUIET picks table (BA-31)';
        }
        return null;
    }
    if (!o.all) return '[bench] --publish is the run of record: it needs --all (BA-33)';
    if (o.sweep !== null) {
        if (host !== 'QUIET') {
            return '[bench] --sweep ' + o.sweep + ' --publish writes the committed benchmark/chunkcap.json: ' +
                'only from a QUIET host, this host is ' + host + ' (BA-31)';
        }
    } else if (host === 'QUIET') {
        if (picks === null) return '[bench] a QUIET run of record needs --picks <QUIET chunkcap.json> (BA-31): none given';
        if (!isPlain(picks) || !isPlain(picks.meta) || picks.meta.hostState !== 'QUIET') {
            return '[bench] a QUIET run of record refuses a non-QUIET picks table (BA-31): its host is ' +
                String(isPlain(picks) && isPlain(picks.meta) ? picks.meta.hostState : picks);
        }
        if (picks.meta.runCount !== K) {
            return '[bench] a QUIET run of record refuses a picks table swept at runCount ' + String(picks.meta.runCount) +
                ' (R-BA28: the sweep runs K = ' + K + ' interleaved passes)';
        }
    }
    if (o.runs !== K) return '[bench] --publish needs --runs ' + K + ' (R-BA28: K interleaved passes; the sweep uses the same K), got ' + o.runs;
    return null;
}

/**
 * Read + validate a --picks table cold (fail closed). Returns { table, tuning } with tuning the
 * results.json record { source, sha256, hostState, picks }; throws on a missing file, bad JSON or a
 * table validatePicks rejects.
 */
export function readPicks(path) {
    let bytes;
    try {
        bytes = readFileSync(resolvePath(path));
    } catch (e) {
        throw new Error('[bench] --picks: cannot read ' + path + ': ' + e.message);
    }
    let table;
    try {
        table = JSON.parse(bytes.toString('utf8'));
    } catch (e) {
        throw new Error('[bench] --picks: ' + path + ' is not JSON: ' + e.message);
    }
    validatePicks(table);
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    return { table, tuning: { source: path, sha256, hostState: table.meta.hostState, picks: table.picks } };
}

/**
 * The picks of a finished sweep run (BA-31), pure: one row per plan.sweep (Sid, n), pickChunkCap over
 * its '~c' cells. Throws on a missing sweep cell.
 */
export function sweepPicks(plan, results) {
    return plan.sweep.map((w) => {
        const rows = w.grid.map((cc) => {
            const key = cellKey('BlockedArray', w.sid, w.n, cc);
            if (!isPlain(results[key])) throw new Error('[bench] sweep: no cell ' + key);
            return results[key];
        });
        const p = pickChunkCap(rows);
        return { scenario: w.sid, n: w.n, capacity: w.capacity, d: w.d, grid: w.grid.slice(), chunkCap: p.chunkCap,
            edge: p.edge, nsPerEvent: p.nsPerEvent };
    });
}

/**
 * The comparison records of a results map, pure (BA-29 / BA-30): { lossTable, comparison } with
 * lossTable = lossRows(results).rows and comparison = { inconclusive, twin } (twinControl's noise
 * is not stored: BA-36 shape, R-BA42). A map with no untagged scenario cell (D-rows only, or a
 * chunkCap sweep) has nothing to compare: { lossTable: [], comparison: null } and lossRows is not called.
 */
export function comparisonOf(results) {
    const scen = Object.keys(results).some((k) => { const m = RESULT_KEY.exec(k); return m !== null && m[3] !== undefined && m[5] === undefined; });
    if (!scen) return { lossTable: [], comparison: null };
    const lr = lossRows(results);
    return { lossTable: lr.rows, comparison: { inconclusive: lr.inconclusive, twin: lr.twin } };
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

function printHeader(o, meta0, nCells, extra = [], plan = null, picked = null) {
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
    console.log('  writes:  ' + (o.sweep !== null && o.publish ? 'benchmark/chunkcap.json ONLY (a QUIET sweep, BA-31)'
        : (o.publish ? PUBLISH_PATHS.label : OUT_PATHS.label) + 'results.json + report.html' + (o.sweep !== null ? ' + chunkcap.json' : '')));
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
        if (picked !== null) {
            const m = picked.table.meta;
            console.log('  picks:   ' + picked.tuning.source + ' | host ' + m.hostState + ' | date ' + m.date + ' | commit ' + m.commit +
                ' | sha256/8 ' + picked.tuning.sha256.slice(0, 8) + ' | every BlockedArray label at its (Sid, n) pick (BA-31)');
            for (const p of picked.table.picks) {
                console.log('  pick:    ' + p.scenario + '@' + p.n + ' chunkCap ' + p.chunkCap + (p.edge ? ' (edge)' : '') + ' of [' +
                    p.grid.join(', ') + '] d ' + p.d + ' | ' + fmt(p.nsPerEvent) + ' ns/event (REPORTED)');
            }
        }
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
    // --picks is read + validated cold, then the publication guard runs: all before any cell or file
    let picked = null;
    if (o.picks !== null) {
        try {
            picked = readPicks(o.picks);
        } catch (e) {
            usageExit(e.message);
        }
    }
    const refusal = publishGuard(o, process.env, picked === null ? null : picked.table);
    if (refusal !== null) usageExit(refusal);
    let plan;
    try {
        plan = planCells(o, EXCLUDED, picked === null ? null : picked.table);
    } catch (e) {
        usageExit(e.message); // "unknown scenario <id>", a BlockedArray cell with no pick -> exit 2
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
    printHeader(o, meta0, all.length, extra, plan, picked);

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

    // --picks: every tuned cell (and each repeat) must have run at its pick (fail closed)
    for (const c of all) {
        if (c.pickCap === undefined) continue;
        const r = results[keyOf(c)];
        for (const x of [r].concat(Array.isArray(r.repeats) ? r.repeats : [])) {
            if (x.chunkCap !== c.pickCap) {
                process.stderr.write('[bench] tuning: ' + keyOf(c) + ' ran at chunkCap ' + x.chunkCap + ', its pick is ' + c.pickCap +
                    '\n[bench] nothing written\n');
                process.exit(1);
            }
        }
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
        lossTable: [],
        opClass: OP_CLASS,
    };
    // BA-30: the loss rows + the A/A control readings (none for a D-row-only run or a sweep)
    try {
        const cmp = comparisonOf(results);
        payload.lossTable = cmp.lossTable;
        if (cmp.comparison !== null) payload.comparison = cmp.comparison;
    } catch (e) {
        process.stderr.write(e.message + '\n[bench] nothing written\n');
        process.exit(1);
    }
    if (picked !== null) payload.tuning = picked.tuning;
    let pickTable = null;
    if (o.sweep !== null) {
        try {
            pickTable = { schema: PICKS_SCHEMA, meta: {
                date: meta.date, hostState: meta.hostState, commit: meta.commit, mainFileSha: meta.mainFileSha,
                runCount: meta.runCount, loadAvgStart: meta.loadAvgStart, loadAvgEnd: meta.loadAvgEnd,
                quietLockWhy: meta.quietLockWhy, command: meta.command }, picks: sweepPicks(plan, results) };
            validatePicks(JSON.parse(JSON.stringify(pickTable)));
        } catch (e) {
            process.stderr.write(e.message + '\n[bench] nothing written\n');
            process.exit(1);
        }
        console.log('-- chunkCap picks (BA-31; median-of-K blend ns/event, REPORTED) ' + '-'.repeat(8));
        for (const p of pickTable.picks) {
            console.log('  ' + (p.scenario + '@' + p.n).padEnd(16) + ' chunkCap ' + String(p.chunkCap).padStart(5) + (p.edge ? ' edge' : '     ') +
                '  of [' + p.grid.join(', ') + ']  ' + fmt(p.nsPerEvent) + ' ns/event');
        }
    }
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
    if (pickTable !== null && o.publish) {
        // BA-31: a QUIET sweep --publish writes the committed pick table ONLY (publishGuard checked the host)
        writeFileSync(PICKS_PUBLISH_PATH, JSON.stringify(pickTable, null, 2) + '\n');
        console.log('picks written to benchmark/chunkcap.json (' + pickTable.picks.length + ' (Sid, n) row(s), host ' + meta.hostState + ')');
        return;
    }
    if (!o.publish) mkdirSync(OUT_DIR, { recursive: true });
    if (pickTable !== null) writeFileSync(PICKS_OUT_PATH, JSON.stringify(pickTable, null, 2) + '\n');
    writeFileSync(P.results, json);
    writeFileSync(P.report, html);
    console.log('results written to ' + P.label + 'results.json + report.html' + (pickTable !== null ? ' + chunkcap.json' : '') + ' (' + all.length + ' cells x ' +
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
