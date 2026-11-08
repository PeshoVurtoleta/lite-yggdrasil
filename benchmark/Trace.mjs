/**
 * @zakkster/lite-yggdrasil -- run-of-record load trace -> benchmark/trace.json.
 *
 * MIT (c) Zahary Shinikchiev <shinikchiev@yahoo.com>
 *
 *     node benchmark/Trace.mjs <load> <baseline> <benchPid> [--cause <text>] [--replicas <a,b>]
 *                              [--results <path>] [--out <path>]
 *
 * Repo-only, cold tooling (R-BA64, R-BA65; .handoff/PLAN-bench-adopt-publish7.md). Reads the run's
 * 60 s load trace (one row per sample: '<at>  <load1> <load5> <load15>  | node>=10%: <entries>',
 * entries ' ; '-separated as '<pid>:<ppid>:<cpu>: <args>') and writes the committed
 * benchmark/trace.json that benchmark/Readme.mjs prints in the README provenance line.
 *
 * - The R-BA53 line is load1 < round2(baseline + 1). A row CROSSES when !(load1 < line) or it lists
 *   a foreign node entry: one that is not the bench's own (pid === benchPid, ppid === benchPid, or
 *   args naming Bench.mjs). Same regex and foreign rule as the b49 trace-check.mjs, except that an
 *   unparsed non-empty row THROWS (fail closed) instead of counting as a crossing.
 * - A trace with crossed > 0 carries rule 'R-BA64' and >= 2 distinct replica runs (published on
 *   replication); crossed === 0 carries rule 'R-BA53' and no replicas.
 * - CLI defaults: --results benchmark/results.json (validated by validateResults first), --out
 *   benchmark/trace.json, --cause 'unattributed'. Writes JSON.stringify(trace, null, 2) + '\n',
 *   prints one summary line; exit 1 on any error. ASCII only, zero deps.
 *
 * exports: TRACE_SCHEMA, parseTrace(text, baseline, benchPid), buildTrace(parsed, results, opts),
 * validateTrace(trace, results), traceNote(trace).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateResults } from './Bench.mjs';

/** The trace.json schema id. */
export const TRACE_SCHEMA = 'lite-yggdrasil/trace/1';

const RESULTS_PATH = fileURLToPath(new URL('./results.json', import.meta.url));
const OUT_PATH = fileURLToPath(new URL('./trace.json', import.meta.url));

const ROW = /^(\S+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+\| node>=10%: ?(.*)$/;
const DIGITS = /^\d+$/;
const ASCII = /^[\x20-\x7e]*$/;
const KEYS = ['schema', 'commit', 'date', 'baseline', 'line', 'samples', 'crossed', 'peak', 'crossings', 'cause',
    'replicas', 'rule'];
const OPT_KEYS = ['cause', 'replicas'];

function round2(x) {
    return Math.round(x * 100) / 100;
}

function isPlain(o) {
    if (o === null || typeof o !== 'object' || Array.isArray(o)) return false;
    const p = Object.getPrototypeOf(o);
    return p === Object.prototype || p === null;
}

function fail(field, why) {
    throw new Error('[trace] ' + field + ': ' + why);
}

/**
 * Parse a 60 s load trace.
 * @param {string} text
 * @param {number} baseline   quiet-host load1 baseline (finite > 0)
 * @param {string} benchPid   the bench orchestrator pid (a non-empty digit string)
 * @returns {{ baseline: number, line: number, samples: number, crossed: number,
 *   peak: { load1: number, at: string }, crossings: Array<{ at: string, load1: number, foreign: string[] }> }}
 */
export function parseTrace(text, baseline, benchPid) {
    if (typeof text !== 'string') fail('text', 'must be a string');
    if (!(typeof baseline === 'number' && Number.isFinite(baseline) && baseline > 0)) {
        fail('baseline', 'must be a finite number > 0, got ' + String(baseline));
    }
    if (!(typeof benchPid === 'string' && DIGITS.test(benchPid))) {
        fail('benchPid', 'must be a non-empty digit string, got ' + JSON.stringify(benchPid));
    }
    const line = round2(baseline + 1);
    const rows = text.split('\n').filter((l) => l.trim() !== '');
    if (rows.length === 0) fail('text', 'empty trace');
    let peakLoad = -1;
    let peakAt = '';
    const crossings = [];
    for (let i = 0; i < rows.length; i++) {
        const r = rows[i];
        const m = ROW.exec(r);
        if (m === null) fail('text', 'unparsed row ' + (i + 1) + ': ' + JSON.stringify(r));
        const l1 = Number(m[2]);
        if (!Number.isFinite(l1)) fail('text', 'row ' + (i + 1) + ' load1 is not a number: ' + JSON.stringify(m[2]));
        if (l1 > peakLoad) { peakLoad = l1; peakAt = m[1]; }
        const foreign = m[5].split(' ; ').map((s) => s.trim()).filter((s) => s !== '').filter((s) => {
            const [pid, ppid] = s.split(':');
            return !(pid === benchPid || ppid === benchPid || s.includes('Bench.mjs'));
        });
        if (!(l1 < line) || foreign.length > 0) crossings.push({ at: m[1], load1: l1, foreign });
    }
    return { baseline, line, samples: rows.length, crossed: crossings.length, peak: { load1: peakLoad, at: peakAt },
        crossings };
}

/**
 * Validate a trace.json object against the results.json it sits beside. Returns true or throws
 * '[trace] <field>: <why>'.
 * @param {object} trace
 * @param {object} results
 * @returns {true}
 */
export function validateTrace(trace, results) {
    if (!isPlain(trace)) fail('trace', 'must be a plain object');
    if (results === null || typeof results !== 'object' || results.meta === null || typeof results.meta !== 'object') {
        fail('results', 'must be a results.json object with meta');
    }
    for (const k of Object.keys(trace)) if (!KEYS.includes(k)) fail(k, 'unexpected key');
    for (const k of KEYS) if (!Object.prototype.hasOwnProperty.call(trace, k)) fail(k, 'missing');
    if (trace.schema !== TRACE_SCHEMA) fail('schema', 'must be ' + JSON.stringify(TRACE_SCHEMA) + ', got ' + JSON.stringify(trace.schema));
    if (trace.commit !== results.meta.commit) {
        fail('commit', JSON.stringify(trace.commit) + ' !== results.meta.commit ' + JSON.stringify(results.meta.commit));
    }
    if (trace.date !== results.meta.date) {
        fail('date', JSON.stringify(trace.date) + ' !== results.meta.date ' + JSON.stringify(results.meta.date));
    }
    const b = trace.baseline;
    if (!(typeof b === 'number' && Number.isFinite(b) && b > 0)) fail('baseline', 'must be a finite number > 0');
    if (trace.line !== round2(b + 1)) fail('line', String(trace.line) + ' !== round2(baseline + 1) ' + String(round2(b + 1)));
    const n = trace.samples;
    if (!(Number.isInteger(n) && n >= 1)) fail('samples', 'must be an integer >= 1');
    const c = trace.crossed;
    if (!(Number.isInteger(c) && c >= 0 && c <= n)) fail('crossed', 'must be an integer in [0, samples]');
    if (!isPlain(trace.peak)) fail('peak', 'must be a plain object');
    const pk = Object.keys(trace.peak);
    if (pk.length !== 2 || !pk.includes('load1') || !pk.includes('at')) fail('peak', 'keys must be exactly load1, at');
    const pl = trace.peak.load1;
    if (!(typeof pl === 'number' && Number.isFinite(pl))) fail('peak', 'load1 must be a finite number');
    if (typeof trace.peak.at !== 'string' || trace.peak.at === '') fail('peak', 'at must be a non-empty string');
    if (!Array.isArray(trace.crossings)) fail('crossings', 'must be an array');
    if (trace.crossings.length !== c) fail('crossings', 'length ' + trace.crossings.length + ' !== crossed ' + c);
    for (let i = 0; i < trace.crossings.length; i++) {
        const x = trace.crossings[i];
        if (!isPlain(x)) fail('crossings', '[' + i + '] must be a plain object');
        const xk = Object.keys(x);
        if (xk.length !== 3 || !xk.includes('at') || !xk.includes('load1') || !xk.includes('foreign')) {
            fail('crossings', '[' + i + '] keys must be exactly at, load1, foreign');
        }
        if (typeof x.at !== 'string' || x.at === '') fail('crossings', '[' + i + '].at must be a non-empty string');
        if (!(typeof x.load1 === 'number' && Number.isFinite(x.load1))) fail('crossings', '[' + i + '].load1 must be a finite number');
        if (!Array.isArray(x.foreign) || !x.foreign.every((s) => typeof s === 'string')) {
            fail('crossings', '[' + i + '].foreign must be an array of strings');
        }
        if (!(pl >= x.load1)) fail('peak', 'load1 ' + pl + ' is below crossing [' + i + '] load1 ' + x.load1);
        if (x.load1 < trace.line && x.foreign.length === 0) {
            fail('crossings', '[' + i + '] load1 ' + x.load1 + ' is below the line with no foreign entry');
        }
    }
    if (c === 0 && !(pl < trace.line)) fail('crossed', '0 but peak load1 ' + pl + ' is not below the line ' + trace.line);
    if (typeof trace.cause !== 'string' || trace.cause === '' || !ASCII.test(trace.cause)) {
        fail('cause', 'must be a non-empty printable ASCII string');
    }
    const rp = trace.replicas;
    if (!Array.isArray(rp)) fail('replicas', 'must be an array');
    if (c > 0) {
        if (rp.length < 2) fail('replicas', 'crossed > 0 needs >= 2 replica runs (R-BA64), got ' + rp.length);
        for (const s of rp) if (typeof s !== 'string' || s === '') fail('replicas', 'each must be a non-empty string');
        if (new Set(rp).size !== rp.length) fail('replicas', 'must be distinct');
    } else if (rp.length !== 0) {
        fail('replicas', 'crossed 0 carries no replicas');
    }
    const rule = c > 0 ? 'R-BA64' : 'R-BA53';
    if (trace.rule !== rule) fail('rule', 'must be ' + rule + ' for crossed ' + c + ', got ' + JSON.stringify(trace.rule));
    return true;
}

/**
 * The trace.json object for a parsed trace beside its results.json (validated before return).
 * @param {ReturnType<typeof parseTrace>} parsed
 * @param {object} results
 * @param {{ cause?: string, replicas?: string[] }} [opts]
 * @returns {object}
 */
export function buildTrace(parsed, results, opts = {}) {
    if (!isPlain(opts)) fail('opts', 'must be a plain object');
    for (const k of Reflect.ownKeys(opts)) {
        if (typeof k !== 'string' || !OPT_KEYS.includes(k)) {
            const hint = typeof k === 'string' ? OPT_KEYS.find((o) => o[0] === k[0]) : undefined;
            fail('opts', 'unknown key ' + String(k) + (hint ? ' (did you mean ' + hint + '?)' : ''));
        }
    }
    const { cause = 'unattributed', replicas = [] } = opts;
    if (!isPlain(parsed) || !isPlain(parsed.peak) || !Array.isArray(parsed.crossings)) {
        fail('parsed', 'must be a parseTrace result');
    }
    if (!Array.isArray(replicas)) fail('replicas', 'must be an array');
    if (results === null || typeof results !== 'object' || results.meta === null || typeof results.meta !== 'object') {
        fail('results', 'must be a results.json object with meta');
    }
    const trace = {
        schema: TRACE_SCHEMA,
        commit: results.meta.commit,
        date: results.meta.date,
        baseline: parsed.baseline,
        line: parsed.line,
        samples: parsed.samples,
        crossed: parsed.crossed,
        peak: { load1: parsed.peak.load1, at: parsed.peak.at },
        crossings: parsed.crossings.map((x) => ({ at: x.at, load1: x.load1,
            foreign: Array.isArray(x.foreign) ? x.foreign.slice() : x.foreign })),
        cause,
        replicas: replicas.slice(),
        rule: parsed.crossed > 0 ? 'R-BA64' : 'R-BA53',
    };
    validateTrace(trace, results);
    return trace;
}

/**
 * The README provenance-line suffix for a trace (Readme.mjs appends it after the re-measure note).
 * @param {object} trace
 * @returns {string}
 */
export function traceNote(trace) {
    const head = ', load trace (R-BA53): ' + trace.crossed + ' of ' + trace.samples + ' samples crossed load1 < ' + trace.line;
    if (trace.crossed === 0) return head;
    return head + ' (peak ' + trace.peak.load1 + ' at ' + trace.peak.at + ', ' + trace.cause +
        '); published on replication (R-BA64): runs ' + trace.replicas.join(', ');
}

function main() {
    const args = process.argv.slice(2);
    const pos = [];
    const flags = { cause: undefined, replicas: undefined, results: RESULTS_PATH, out: OUT_PATH };
    for (let i = 0; i < args.length; i++) {
        const a = args[i];
        if (a.startsWith('--')) {
            const k = a.slice(2);
            if (!Object.prototype.hasOwnProperty.call(flags, k)) throw new Error('[trace] unknown flag ' + a);
            if (i + 1 >= args.length) throw new Error('[trace] ' + a + ' needs a value');
            flags[k] = args[++i];
        } else {
            pos.push(a);
        }
    }
    if (pos.length !== 3) {
        throw new Error('usage: node benchmark/Trace.mjs <load> <baseline> <benchPid> [--cause <text>] ' +
            '[--replicas <a,b>] [--results <path>] [--out <path>]');
    }
    const results = JSON.parse(readFileSync(resolve(flags.results), 'utf8'));
    validateResults(results);
    const parsed = parseTrace(readFileSync(resolve(pos[0]), 'utf8'), Number(pos[1]), pos[2]);
    const opts = {};
    if (flags.cause !== undefined) opts.cause = flags.cause;
    if (flags.replicas !== undefined) opts.replicas = flags.replicas.split(',').map((s) => s.trim());
    const trace = buildTrace(parsed, results, opts);
    const out = resolve(flags.out);
    writeFileSync(out, JSON.stringify(trace, null, 2) + '\n');
    process.stdout.write('[trace] ' + out + ': samples ' + trace.samples + ', crossed ' + trace.crossed +
        ', line load1 < ' + trace.line + ', peak load1 ' + trace.peak.load1 + ' at ' + trace.peak.at + ', rule ' +
        trace.rule + (trace.replicas.length ? ', replicas ' + trace.replicas.join(', ') : '') + '\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        main();
    } catch (e) {
        process.stderr.write((e && e.message ? e.message : String(e)) + '\n');
        process.exit(1);
    }
}
