/**
 * @zakkster/lite-yggdrasil -- README "Benchmarks" section generator.
 *
 * MIT (c) Zahary Shinikchiev <shinikchiev@yahoo.com>
 *
 *     node benchmark/Readme.mjs --check   # npm run bench:readme: README section == generator output
 *     node benchmark/Readme.mjs --write   # rewrite only that section of README.md
 *
 * Repo-only. Bench-ADOPT group 1 TASK 6 (.handoff/PLAN-bench-adopt-g1.md; SPEC-bench-adopt BA-1,
 * BA-5, BA-6, BA-11). The README Benchmarks section is generated from the COMMITTED
 * benchmark/results.json (the run of record, R-BA1), never hand-typed and never from
 * benchmark/out/, so a local bench run never changes README.
 *
 * - No committed results.json, status PENDING, or hostState PRELIMINARY -> the PENDING form: the
 *   README paragraph as of 0.1.1 byte-for-byte, with <version> read from package.json (R-BA5, R-BA6).
 * - MEASURED + QUIET -> the measured form: no "PENDING", every PROVENANCE_FIELDS value, the
 *   counts / timing table and the loss table. The D8 timing columns print, per op row, the median-of-K
 *   ns/op and the min-of-K beside it (BA-41, R-BA47 / R-BA51; Compare.mjs rowRunValues), K = 1 +
 *   repeats.length printed as a number in the header; the subject's and the foil's D8 cells must
 *   carry the same K (else it throws). The per-op counts are pass 1's. A MEASURED QUIET results.json with zero loss rows
 *   throws (RESEARCH section 4.3: a report with no loss rows fails the honesty review).
 * - R-BA57 / R-BA59: a results.json carrying 'remeasure' adds ", twin re-measure (R-BA57): none" or
 *   "<Sid>@<n> (first <v>, re-measure <v>)" per re-measured group to the provenance line; with no
 *   'remeasure' key the section is byte-identical to before.
 * - R-BA64 / R-BA65: when benchmark/trace.json exists (written by benchmark/Trace.mjs from the run's
 *   60 s load trace), main passes it as the third argument: results.json must then be MEASURED + QUIET,
 *   the trace is checked by validateTrace (benchmark/Trace.mjs) against it, the provenance line adds
 *   traceNote(trace) after the re-measure note (the R-BA53 trace verdict and, when the trace crossed,
 *   "published on replication (R-BA64): runs ..."), and the lead's "(QUIET host)" reads "(QUIET host at
 *   start; load trace below)". With no trace.json (trace null) the section is byte-identical to before.
 * The input is validated by validateResults (benchmark/Bench.mjs) first. ASCII only.
 *
 * exports: renderBenchmarksSection(results | null, version, trace = null), extractSection(readmeText),
 * readTraceFile(path), PROVENANCE_FIELDS, PENDING_TEMPLATE.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateResults } from './Bench.mjs';
import { rowRunValues, median, minOfList } from './Compare.mjs';
import { validateTrace, traceNote } from './Trace.mjs';

const README_PATH = fileURLToPath(new URL('../README.md', import.meta.url));
const PKG_PATH = fileURLToPath(new URL('../package.json', import.meta.url));
const RESULTS_PATH = fileURLToPath(new URL('./results.json', import.meta.url));
const TRACE_PATH = fileURLToPath(new URL('./trace.json', import.meta.url));

const START = '## Benchmarks\n\n';
const END = '\n\n## Design';
const NA = 'n/a';
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

/** The 9 meta fields the measured form prints as its provenance (SPEC-bench-adopt BA-11). */
export const PROVENANCE_FIELDS = Object.freeze(['date', 'node', 'platform', 'arch', 'cpuModel', 'loadAvgStart',
    'hostState', 'commit', 'runCount']);

/** The PENDING form: README.md at HEAD 629f04b, '<version>' = package.json version (R-BA6). */
export const PENDING_TEMPLATE = 'PENDING for <version>. This release ships no benchmark numbers and no timing ' +
    'claims, and no earlier release has a measured table to point back to. Performance is stated as exact ' +
    'operation counts (the counters above), which are gated.';

/** D8 op rows the measured table prints, subject beside foil. */
const TABLE_OPS = ['insertAt+removeAt', 'setMeasure', 'indexAtSum', 'sumBefore', 'mixed'];

/**
 * The text between "## Benchmarks\n\n" and "\n\n## Design". Throws if either marker is missing
 * (or appears twice).
 * @param {string} readmeText
 * @returns {string}
 */
export function extractSection(readmeText) {
    if (typeof readmeText !== 'string') throw new Error('[readme] README text must be a string');
    const a = readmeText.indexOf(START);
    if (a < 0) throw new Error('[readme] marker "## Benchmarks" + blank line not found');
    if (readmeText.indexOf(START, a + 1) >= 0) throw new Error('[readme] marker "## Benchmarks" appears twice');
    const b = readmeText.indexOf(END, a + START.length);
    if (b < 0) throw new Error('[readme] marker "## Design" after "## Benchmarks" not found');
    return readmeText.slice(a + START.length, b);
}

function num(x) {
    if (typeof x !== 'number' || !isFinite(x)) return String(x);
    if (x === 0) return '0';
    if (x >= 1000) return x.toFixed(0);
    if (x >= 1) return x.toFixed(2);
    return x.toFixed(4);
}

function d8Row(results, member, op) {
    const r = results.results[member + '/D8'];
    if (!r) throw new Error('[readme] measured form needs results.' + member + '/D8');
    if (typeof r.na === 'string') return null;
    for (const x of r.rows) if (x.op === op) return typeof x.na === 'string' ? null : x;
    return null;
}

// The median-of-K and min-of-K ns/op cells of one D8 op row: an n/a cell, an absent op (as d8Row) or
// an n/a row -> n/a, never 0. rowRunValues checks every repeat, an n/a row's too (fail closed).
function kCells(results, member, op) {
    const r = results.results[member + '/D8'];
    if (typeof r.na === 'string') return [NA, NA];
    const x = r.rows.find((y) => y.op === op);
    const vs = x === undefined ? null : rowRunValues(r, op, x.n);
    if (vs === null) return [NA, NA];
    return [num(median(vs)), num(minOfList(vs))];
}

function runsOf(cell) {
    return 1 + (Array.isArray(cell.repeats) ? cell.repeats.length : 0);
}

function perOp(row, key) {
    if (row === null) return NA;
    const v = row.counts[key];
    return typeof v === 'number' ? num(v / row.ops) : NA;
}

/** A markdown table cell: a literal '|' is escaped so a reason cannot split the row. */
function cell(s) {
    return String(s).replace(/\|/g, '\\|');
}

// R-BA59: ', twin re-measure (R-BA57): none' or '<Sid>@<n> (first <v>, re-measure <v>)' per re-measured
// group ('; '-joined); '' when results.json carries no 'remeasure' key (runs #1..#5 render as before). The
// re-measure verdict is comparison.twin's row for that (Sid, n), or TIE when it lists none (validateResults
// checked comparison against twinControl(results)).
function remeasureNote(results) {
    if (results.remeasure === undefined) return '';
    if (results.remeasure.length === 0) return ', twin re-measure (R-BA57): none';
    return ', twin re-measure (R-BA57): ' + results.remeasure.map((e) => {
        const now = results.comparison.twin.find((x) => x.scenario === e.scenario && x.n === e.n);
        return e.scenario + '@' + e.n + ' (first ' + e.first.twin.verdict + ', re-measure ' + (now === undefined ? 'TIE' : now.verdict) + ')';
    }).join('; ');
}

function measuredForm(results, trace) {
    const m = results.meta;
    const subj = results.subjects[0];
    const foil = results.foil;
    if (typeof foil !== 'string') throw new Error('[readme] measured form needs results.foil');
    const n = results.results[subj + '/D8'] && results.results[subj + '/D8'].n;
    if (!(Number.isInteger(n) && n >= 1)) throw new Error('[readme] measured form needs results.' + subj + '/D8.n (an integer >= 1)');
    if (!/ --publish( |$)/.test(m.command)) {
        throw new Error('[readme] measured form needs the run of record (meta.command has no --publish): ' + m.command);
    }
    const lines = [];
    lines.push('Measured by the run of record at commit ' + m.commit + (trace === null ? ' (QUIET host)' :
        ' (QUIET host at start; load trace below)') + '. Every time below is REPORTED: one ' +
        'host\'s measurement, not a law, and it gates nothing. The operation counts beside each time are exact and ' +
        'DETERMINISTIC (the counters above, gated in `npm test`).');
    lines.push('');
    lines.push('Provenance: date ' + m.date + ', node ' + m.node + ', platform ' + m.platform + ', arch ' + m.arch +
        ', cpu ' + m.cpuModel + ', load average at start ' + JSON.stringify(m.loadAvgStart) + ', host ' + m.hostState +
        ', commit ' + m.commit + ' (Yggdrasil.js sha256/8 ' + m.mainFileSha + '), runs ' + m.runCount + ', seed 0x' +
        (m.seed >>> 0).toString(16) + remeasureNote(results) + (trace === null ? '' : traceNote(trace)) + '.');
    lines.push('');
    const fd8 = results.results[foil + '/D8'];
    if (!fd8) throw new Error('[readme] measured form needs results.' + foil + '/D8');
    const k = runsOf(results.results[subj + '/D8']);
    if (runsOf(fd8) !== k) throw new Error('[readme] D8 cells disagree on K (' + subj + ' ' + k + ', ' + foil + ' ' + runsOf(fd8) + ')');
    lines.push('| op (n = ' + n + ') | ' + subj + ' ns/op (median of ' + k + ') | ' + subj + ' ns/op (min of ' + k + ') | ' + subj +
        ' touches/op | ' + foil + ' ns/op (median of ' + k + ') | ' + foil + ' ns/op (min of ' + k + ') | ' + foil + ' moves/op |');
    lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: |');
    for (const op of TABLE_OPS) {
        const a = d8Row(results, subj, op);
        const b = d8Row(results, foil, op);
        lines.push('| ' + op + ' | ' + kCells(results, subj, op).join(' | ') + ' | ' + perOp(a, 'touches') + ' | ' +
            kCells(results, foil, op).join(' | ') + ' | ' + perOp(b, 'moves') + ' |');
    }
    lines.push('');
    lines.push('Where ' + subj + ' loses (each loss with its crossover n):');
    lines.push('');
    lines.push('| scenario | winner | loser | crossover n | reason |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const l of results.lossTable) {
        lines.push('| ' + [l.scenario, l.winner, l.loser, String(l.crossoverN), l.reason].map(cell).join(' | ') + ' |');
    }
    lines.push('');
    lines.push('Every dimension, scenario and counter column: `benchmark/report.html` (data: `benchmark/results.json`; ' +
        'method: `benchmark/METHODOLOGY.md`).');
    return lines.join('\n');
}

/**
 * The README Benchmarks section body for a results payload (or null), the package version and the
 * run's trace.json object (or null: byte-identical to the two-argument form).
 * @param {object|null} results
 * @param {string} version
 * @param {object|null} [trace]
 * @returns {string}
 */
export function renderBenchmarksSection(results, version, trace = null) {
    if (typeof version !== 'string' || !SEMVER.test(version)) {
        throw new Error('[readme] version must be a semver string, got ' + JSON.stringify(version));
    }
    if (trace !== null && results === null) throw new Error('[readme] trace.json needs a measured results.json');
    if (results === null) return PENDING_TEMPLATE.replace('<version>', version);
    validateResults(results);
    if (results.status === 'PENDING' || results.meta.hostState !== 'QUIET') {
        if (trace !== null) throw new Error('[readme] trace.json needs a measured results.json');
        return PENDING_TEMPLATE.replace('<version>', version);
    }
    if (trace !== null) validateTrace(trace, results);
    if (results.lossTable.length === 0) {
        throw new Error('[readme] a MEASURED QUIET results.json must carry >= 1 loss row (lossTable is empty)');
    }
    const out = measuredForm(results, trace);
    if (out.includes('PENDING')) throw new Error('[readme] the measured form must not contain "PENDING"');
    return out;
}

/**
 * The parsed trace.json at path, or null when the file is absent. A present file must parse to a plain
 * object (null / array / scalar throw: a "null" file is not "no trace").
 * @param {string} path
 * @returns {object|null}
 */
export function readTraceFile(path) {
    if (!existsSync(path)) return null;
    const t = JSON.parse(readFileSync(path, 'utf8'));
    const p = t !== null && typeof t === 'object' && !Array.isArray(t) ? Object.getPrototypeOf(t) : undefined;
    if (p !== Object.prototype && p !== null) throw new Error('[readme] trace.json must be an object');
    return t;
}

function firstDiff(a, b) {
    const k = Math.min(a.length, b.length);
    for (let i = 0; i < k; i++) if (a[i] !== b[i]) return i;
    return a.length === b.length ? -1 : k;
}

function main() {
    const args = process.argv.slice(2);
    if (args.length !== 1 || (args[0] !== '--check' && args[0] !== '--write')) {
        process.stderr.write('usage: node benchmark/Readme.mjs --check | --write\n');
        process.exit(2);
    }
    const version = JSON.parse(readFileSync(PKG_PATH, 'utf8')).version;
    const results = existsSync(RESULTS_PATH) ? JSON.parse(readFileSync(RESULTS_PATH, 'utf8')) : null;
    const trace = readTraceFile(TRACE_PATH);
    const want = renderBenchmarksSection(results, version, trace);
    const readme = readFileSync(README_PATH, 'utf8');
    const have = extractSection(readme);
    if (args[0] === '--check') {
        if (have === want) {
            process.stdout.write('[readme] Benchmarks section matches the generator (' +
                (results === null ? 'no committed results.json' : 'benchmark/results.json') +
                (trace === null ? '' : ' + benchmark/trace.json') + ', version ' + version + ')\n');
            return;
        }
        const i = firstDiff(have, want);
        process.stderr.write('[readme] README.md Benchmarks section differs from the generator at offset ' + i +
            ':\n  README:    ' + JSON.stringify(have.slice(i, i + 60)) + '\n  generator: ' +
            JSON.stringify(want.slice(i, i + 60)) + '\n  fix: node benchmark/Readme.mjs --write (then review the diff)\n');
        process.exit(1);
    }
    if (have === want) {
        process.stdout.write('[readme] README.md already current\n');
        return;
    }
    const a = readme.indexOf(START) + START.length;
    writeFileSync(README_PATH, readme.slice(0, a) + want + readme.slice(a + have.length));
    process.stdout.write('[readme] README.md Benchmarks section rewritten\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    try {
        main();
    } catch (e) {
        process.stderr.write((e && e.message ? e.message : String(e)) + '\n');
        process.exit(1);
    }
}
