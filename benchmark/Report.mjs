/**
 * @zakkster/lite-yggdrasil -- benchmark report renderer (zero-dep, hand-rolled SVG).
 *
 * MIT (c) Zahary Shinikchiev <shinikchiev@yahoo.com>
 *
 *     npm run bench:report             # benchmark/out/results.json -> benchmark/out/report.html
 *     npm run bench:report -- --publish  # benchmark/results.json -> benchmark/report.html
 *
 * Repo-only. Bench-ADOPT group 1 TASK 6 (.handoff/PLAN-bench-adopt-g1.md; SPEC-bench-adopt BA-1,
 * BA-4, BA-5). Copied from @zakkster/lite-logn benchmark/Report.mjs (Bench v2 kit, LiteLogN commit
 * 9eb484c: esc / num / the two SVG primitives / renderSvg / tableRows / section / STYLE), re-wired
 * for one positional summary tree measured against the splice foil: a header naming the subject,
 * the foil and every rival (a rival's source file:line @ sha when its params carry one, BA-4), a
 * provenance line (every meta field of BA-11), counts columns beside every timing, and the loss
 * table. A results.json whose hostState is not QUIET (or whose status is PENDING) renders every
 * section labelled PRELIMINARY (BA-5).
 *
 * The input is validated by validateResults (benchmark/Bench.mjs) before anything renders: a
 * malformed results.json fails closed (exit 1), it never renders a partial report.
 * Self-contained HTML: no charting library, no web fonts, no external assets. ASCII only.
 *
 * exports: renderSvg (one chart spec -> an <svg> string), renderHtml (the payload -> an HTML document),
 * isPreliminary (the BA-5 label rule).
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateResults } from './Bench.mjs';
import { COUNTER_NAMES } from './Adapters.mjs';

const OUT_DIR = fileURLToPath(new URL('./out/', import.meta.url));
const PATHS = {
    out: { results: OUT_DIR + 'results.json', report: OUT_DIR + 'report.html', label: 'benchmark/out/' },
    publish: {
        results: fileURLToPath(new URL('./results.json', import.meta.url)),
        report: fileURLToPath(new URL('./report.html', import.meta.url)),
        label: 'benchmark/',
    },
};

const PALETTE = ['#2563eb', '#dc2626', '#059669', '#d97706', '#7c3aed', '#0891b2'];
const NA = 'n/a';

function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function num(x) {
    if (typeof x !== 'number' || !isFinite(x)) return String(x);
    if (x === 0) return '0';
    if (x >= 1000) return x.toFixed(0);
    if (x >= 1) return x.toFixed(2);
    return x.toFixed(4);
}

// ---------------------------------------------------------------------------
// Hand-rolled SVG primitives (the kit's, unchanged).
// ---------------------------------------------------------------------------
function barChartSvg(spec) {
    const W = 640, H = 300, PADL = 56, PADB = 54, PADT = 28, PADR = 16;
    const plotW = W - PADL - PADR, plotH = H - PADT - PADB;
    const labels = spec.labels;
    const series = spec.series; // [{name, values, color}]
    const groups = labels.length;
    const perGroup = series.length;
    let max = 0;
    for (const s of series) for (const v of s.values) if (v > max) max = v;
    if (max <= 0) max = 1;
    const gGap = plotW / groups;
    const bW = (gGap * 0.72) / perGroup;

    let bars = '';
    for (let g = 0; g < groups; g++) {
        const gx = PADL + g * gGap + gGap * 0.14;
        for (let s = 0; s < perGroup; s++) {
            const v = series[s].values[g] || 0;
            const h = (v / max) * plotH;
            const x = gx + s * bW;
            const y = PADT + plotH - h;
            bars += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' +
                (bW * 0.9).toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + series[s].color + '"/>';
        }
        bars += '<text x="' + (PADL + g * gGap + gGap / 2).toFixed(1) + '" y="' + (H - PADB + 16) +
            '" font-size="11" text-anchor="middle" fill="#334155">' + esc(labels[g]) + '</text>';
    }
    let ticks = '';
    for (let t = 0; t <= 4; t++) {
        const v = (max * t) / 4;
        const y = PADT + plotH - (t / 4) * plotH;
        ticks += '<line x1="' + PADL + '" y1="' + y.toFixed(1) + '" x2="' + (W - PADR) + '" y2="' +
            y.toFixed(1) + '" stroke="#e2e8f0"/>';
        ticks += '<text x="' + (PADL - 6) + '" y="' + (y + 4).toFixed(1) +
            '" font-size="10" text-anchor="end" fill="#64748b">' + num(v) + '</text>';
    }
    let legend = '';
    for (let s = 0; s < perGroup; s++) {
        legend += '<rect x="' + (PADL + s * 150) + '" y="6" width="12" height="12" fill="' + series[s].color + '"/>' +
            '<text x="' + (PADL + s * 150 + 16) + '" y="16" font-size="11" fill="#334155">' + esc(series[s].name) + '</text>';
    }
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="' +
        esc(spec.title) + '">' +
        '<text x="' + (W / 2) + '" y="' + (H - 6) + '" font-size="11" text-anchor="middle" fill="#475569">' +
        esc(spec.xlabel || '') + '</text>' +
        '<text x="14" y="' + (PADT + plotH / 2) + '" font-size="11" text-anchor="middle" fill="#475569" transform="rotate(-90 14 ' +
        (PADT + plotH / 2) + ')">' + esc(spec.ylabel || '') + '</text>' +
        ticks + bars + legend + '</svg>';
}

function lineChartSvg(spec) {
    const W = 640, H = 300, PADL = 56, PADB = 54, PADT = 28, PADR = 16;
    const plotW = W - PADL - PADR, plotH = H - PADT - PADB;
    const series = spec.series; // [{name, points:[{x,y}], color}]
    let xmin = Infinity, xmax = -Infinity, ymax = 0;
    for (const s of series) for (const p of s.points) {
        const lx = Math.log10(Math.max(1, p.x));
        if (lx < xmin) xmin = lx; if (lx > xmax) xmax = lx;
        if (p.y > ymax) ymax = p.y;
    }
    if (ymax <= 0) ymax = 1;
    if (xmax <= xmin) xmax = xmin + 1;
    const sx = (x) => PADL + ((Math.log10(Math.max(1, x)) - xmin) / (xmax - xmin)) * plotW;
    const sy = (y) => PADT + plotH - (y / ymax) * plotH;

    let ticks = '';
    for (let t = 0; t <= 4; t++) {
        const v = (ymax * t) / 4;
        const y = PADT + plotH - (t / 4) * plotH;
        ticks += '<line x1="' + PADL + '" y1="' + y.toFixed(1) + '" x2="' + (W - PADR) + '" y2="' +
            y.toFixed(1) + '" stroke="#e2e8f0"/>';
        ticks += '<text x="' + (PADL - 6) + '" y="' + (y + 4).toFixed(1) +
            '" font-size="10" text-anchor="end" fill="#64748b">' + num(v) + '</text>';
    }
    for (let t = 0; t <= 4; t++) {
        const lx = xmin + ((xmax - xmin) * t) / 4;
        const x = PADL + (t / 4) * plotW;
        ticks += '<text x="' + x.toFixed(1) + '" y="' + (H - PADB + 16) +
            '" font-size="10" text-anchor="middle" fill="#64748b">1e' + lx.toFixed(1) + '</text>';
    }
    let paths = '';
    for (const s of series) {
        let d = '';
        for (let i = 0; i < s.points.length; i++) {
            const p = s.points[i];
            d += (i === 0 ? 'M' : 'L') + sx(p.x).toFixed(1) + ' ' + sy(p.y).toFixed(1) + ' ';
        }
        paths += '<path d="' + d.trim() + '" fill="none" stroke="' + s.color + '" stroke-width="2"/>';
        for (const p of s.points) {
            paths += '<circle cx="' + sx(p.x).toFixed(1) + '" cy="' + sy(p.y).toFixed(1) +
                '" r="2.5" fill="' + s.color + '"/>';
        }
    }
    let legend = '';
    for (let s = 0; s < series.length; s++) {
        legend += '<rect x="' + (PADL + s * 150) + '" y="6" width="12" height="12" fill="' + series[s].color + '"/>' +
            '<text x="' + (PADL + s * 150 + 16) + '" y="16" font-size="11" fill="#334155">' + esc(series[s].name) + '</text>';
    }
    return '<svg viewBox="0 0 ' + W + ' ' + H + '" width="100%" role="img" aria-label="' +
        esc(spec.title) + '">' +
        '<text x="' + (W / 2) + '" y="' + (H - 6) + '" font-size="11" text-anchor="middle" fill="#475569">' +
        esc(spec.xlabel || '') + '</text>' +
        '<text x="14" y="' + (PADT + plotH / 2) + '" font-size="11" text-anchor="middle" fill="#475569" transform="rotate(-90 14 ' +
        (PADT + plotH / 2) + ')">' + esc(spec.ylabel || '') + '</text>' +
        ticks + paths + legend + '</svg>';
}

/**
 * Render one chart spec to an <svg> string.
 * @param {{type:'bar'|'line'}} spec
 * @returns {string}
 */
export function renderSvg(spec) {
    if (spec.type === 'bar') return barChartSvg(spec);
    if (spec.type === 'line') return lineChartSvg(spec);
    throw new Error('[report] unknown chart type ' + String(spec.type));
}

// ---------------------------------------------------------------------------
// Section builders.
// ---------------------------------------------------------------------------
function tableRows(headers, rows) {
    let h = '<tr>';
    for (const c of headers) h += '<th>' + esc(c) + '</th>';
    h += '</tr>';
    let b = '';
    for (const r of rows) {
        b += '<tr>';
        for (const c of r) b += '<td>' + esc(c) + '</td>';
        b += '</tr>';
    }
    return '<table>' + h + b + '</table>';
}

function section(title, note, chart, table, prelim) {
    return '<section><h2>' + esc(title) + (prelim ? ' [PRELIMINARY]' : '') + '</h2>' +
        (note ? '<p class="note">' + esc(note) + '</p>' : '') +
        (chart ? '<div class="chart">' + chart + '</div>' : '') +
        (table || '') + '</section>';
}

/** BA-5: numbers from a run that is not a QUIET MEASURED run of record are labelled PRELIMINARY. */
export function isPreliminary(payload) {
    return payload.status !== 'MEASURED' || payload.meta.hostState !== 'QUIET';
}

/** Compact counts cell: the mapped counters and extras as k=v, unmapped ones summarised (never 0). */
function countsCell(row) {
    if (!row || row.counts === null || typeof row.counts !== 'object' || Array.isArray(row.counts)) return NA;
    const parts = [];
    let unmapped = 0;
    for (const k of Object.keys(row.counts)) {
        if (row.counts[k] === NA) unmapped++;
        else parts.push(k + '=' + row.counts[k]);
    }
    if (row.extras && typeof row.extras === 'object') {
        for (const k of Object.keys(row.extras)) parts.push(k + '=' + row.extras[k]);
    }
    if (unmapped > 0) parts.push('(' + unmapped + ' n/a)');
    return parts.join(' ');
}

/** One counter per op of a timed row: count / ops, or 'n/a' (unmapped, never 0). */
function perOp(row, key) {
    if (!row || !row.counts || !(key in row.counts)) return NA;
    const v = row.counts[key];
    if (v === NA) return NA;
    return num(v / row.ops);
}

function naNote(r) {
    return typeof r.na === 'string' ? 'n/a: ' + r.na : null;
}

function provenanceLine(meta) {
    const la = (a) => a.map((x) => x.toFixed(2)).join(' ');
    return 'date ' + meta.date + ' | node ' + meta.node + ' | ' + meta.platform + '/' + meta.arch +
        ' | cpu ' + meta.cpuModel + ' x' + meta.cpuCount +
        ' | load ' + la(meta.loadAvgStart) + ' -> ' + la(meta.loadAvgEnd) +
        ' | host ' + meta.hostState + (meta.quietLockWhy === null ? ' (not under quiet-lock)' : ' (' + meta.quietLockWhy + ')') +
        ' | runs ' + meta.runCount + ' | commit ' + meta.commit + ' | Yggdrasil.js sha256/8 ' + meta.mainFileSha +
        ' | seed 0x' + (meta.seed >>> 0).toString(16) + ' | command: ' + meta.command;
}

/**
 * Render the full payload (results.json shape, validated first) to an HTML document.
 * @param {object} payload
 * @returns {string}
 */
export function renderHtml(payload) {
    validateResults(payload);
    const R = payload.results;
    const meta = payload.meta;
    const prelim = isPreliminary(payload);
    const adapters = payload.adapters || {};
    const names = Object.keys(adapters);
    const get = (m, d) => R[m + '/' + d];
    const color = (i) => PALETTE[i % PALETTE.length];
    const members = names.filter((m) => Object.keys(R).some((k) => k.startsWith(m + '/')));
    const has = (d) => members.some((m) => get(m, d) !== undefined);
    const sec = (title, note, chart, table) => section(title, note, chart, table, prelim);
    const sections = [];

    // D1 -- the splice witness: counts first (R-BA3), then the REPORTED fit.
    if (has('D1')) {
        const subj = [], foil = [], fits = [], series = [];
        for (const m of members) {
            const r = get(m, 'D1');
            if (!r) continue;
            if (naNote(r)) { fits.push([m, naNote(r), '', '', '', '']); continue; }
            for (const c of r.counts) {
                if (typeof c.touchesPerOp === 'number') {
                    subj.push([m, String(c.n), c.op, String(c.ops), num(c.touchesPerOp), String(c.maxTouches),
                        String(c.maxBound), String(c.hits), String(c.misses), String(c.splits), String(c.underflows),
                        String(c.violations)]);
                } else {
                    foil.push([m, String(c.n), c.op, String(c.ops), num(c.movesPerOp), String(c.movesExpected),
                        c.exact ? 'yes' : 'NO']);
                }
            }
            const f = r.fit;
            if (f === NA) fits.push([m, NA, NA, NA, NA, String(r.violations)]);
            else fits.push([m, num(f.r2), num(f.slope), num(f.intercept), num(f.r2Reference), String(r.violations)]);
            if (r.timing.length > 0) {
                series.push({ name: m, color: color(series.length), points: r.timing.map((t) => ({ x: t.n, y: t.nsPerOp })) });
            }
        }
        const chart = series.length > 0 ? renderSvg({ type: 'line', title: 'D1 REPORTED ns/op vs n',
            xlabel: 'n (log10)', ylabel: 'ns per insertAt+removeAt', series }) : null;
        sections.push(sec('D1 -- Splice witness (counts first, then the REPORTED fit)',
            'DETERMINISTIC first: the subject\'s touches per op against touchesMax(row, Lmax) of test/spec-counts.mjs ' +
            '(G-11 as amended by 0005 C-25; violations must be 0), the foil\'s moves per insertAt(floor(n/2)) ' +
            '(exactly n - floor(n/2)). Then the REPORTED ns/op vs log2 n fit; lite-logn\'s r2 0.958 is a reference only. ' +
            'Neither the fit nor the reference gates anything.', chart,
            tableRows(['adapter', 'n', 'op', 'ops', 'touches/op', 'max touches', 'max bound', 'hits', 'misses',
                'splits', 'underflows', 'violations'], subj) +
            tableRows(['adapter', 'n', 'op', 'ops', 'moves/op', 'expected', 'exact'], foil) +
            tableRows(['adapter', 'fit r2', 'slope (ns/level)', 'intercept', 'r2 reference', 'violations'], fits)));
    }

    // D2 -- amortized cost over a long mixed trace.
    if (has('D2')) {
        const series = [], rows = [];
        for (const m of members) {
            const r = get(m, 'D2');
            if (!r) continue;
            if (naNote(r)) { rows.push([m, naNote(r), '', '']); continue; }
            series.push({ name: m, color: color(series.length), points: r.points.map((p) => ({ x: p.ops, y: p.nsPerOp })) });
            const last = r.points[r.points.length - 1];
            rows.push([m, num(r.drift), String(r.total), countsCell(last)]);
        }
        const s = meta.sentinel;
        const note = 'Cumulative ns/op at power-of-two checkpoints on a length-neutral mixed trace; drift = last / first. ' +
            'Counts are cumulative at the last checkpoint. ' + (s === null ? 'No drift sentinel ran.' :
            'Drift sentinel ' + s.cell + ': ' + num(s.first) + ' -> ' + num(s.second) + ' ns/op (' +
            (s.drift * 100).toFixed(0) + '%, disclosure limit ' + (s.limit * 100).toFixed(0) + '%).');
        sections.push(sec('D2 -- Amortized cost over a long mixed trace', note,
            series.length > 0 ? renderSvg({ type: 'line', title: 'D2 amortized', xlabel: 'ops (log10)',
                ylabel: 'cumulative ns/op', series }) : null,
            tableRows(['adapter', 'drift (last/first)', 'ops', 'counts at the end'], rows)));
    }

    // D3 -- memory.
    if (has('D3')) {
        const rows = [];
        for (const m of members) {
            const r = get(m, 'D3');
            if (!r) continue;
            if (naNote(r)) { rows.push([m, naNote(r), '', '', '', '', '']); continue; }
            for (const x of r.rows) {
                rows.push([m, String(x.dims), String(x.n), String(x.bytes), num(x.perLive), String(x.floor),
                    num(x.ratio) + (x.stable ? '' : ' (refill changed bytes!)')]);
            }
        }
        sections.push(sec('D3 -- Memory: typed-array bytes per live element',
            'Bytes held by the typed arrays at full fill vs the floor 4 x dims + 4 (one int32 entity + dims int32 ' +
            'measures). The arrays are preallocated: clear() + refill holds the same bytes.', null,
            tableRows(['adapter', 'dims', 'n', 'bytes', 'B/live', 'floor', 'ratio'], rows)));
    }

    // D4 -- cache PROXY.
    if (has('D4')) {
        const rows = [];
        for (const m of members) {
            const r = get(m, 'D4');
            if (!r) continue;
            if (naNote(r)) { rows.push([m, naNote(r), '', '', '', '']); continue; }
            rows.push([m, 'default', num(r.walk.nsPerElem), num(r.seek.nsPerOp), num(r.gap), countsCell(r.seek)]);
            for (const p of r.leafSweep) {
                rows.push([m, 'leafSize ' + p.leafSize, num(p.walkNsPerElem), num(p.seekNsPerOp), num(p.gap), countsCell(p.seek)]);
            }
        }
        sections.push(sec('D4 -- Cache behaviour (PROXY)',
            'PROXY ONLY: no native perf counters. A full cursor walk (ns per element) vs a random indexAtSum seek ' +
            '(ns/op); gap = seek / walk; then the same pair per leafSize.', null,
            tableRows(['adapter', 'config', 'walk ns/elem', 'seek ns/op', 'gap', 'seek counts'], rows)));
    }

    // D5 -- bundle size (R-BA2).
    if (has('D5')) {
        const rows = [];
        for (const m of members) {
            const r = get(m, 'D5');
            if (!r) continue;
            if (naNote(r)) { rows.push([m, naNote(r), '', '', '', '']); continue; }
            rows.push([m, r.file + ' @ ' + r.sha256_8, String(r.raw), String(r.gzip), String(r.minified),
                String(r.treeShaking) + ' (' + r.treeShakingReason + ')']);
        }
        sections.push(sec('D5 -- Bundle size', 'Raw and node:zlib gzip (level 9) bytes of the one shipped file; ' +
            'no minifier, no new devDependency; tree-shaking n/a (maintainer ruling R-BA2).', null,
            tableRows(['adapter', 'file', 'raw', 'gzip', 'minified', 'tree-shaking'], rows)));
    }

    // D6 -- GC pressure (REPORTED).
    if (has('D6')) {
        const rows = [];
        for (const m of members) {
            const r = get(m, 'D6');
            if (!r) continue;
            if (naNote(r)) { rows.push([m, naNote(r), '', '', '', '', '']); continue; }
            for (const o of r.perOp) {
                for (const p of o.points) {
                    rows.push([m + '.' + o.op, String(p.n), String(p.bytesPerOp), num(p.opsPerMs),
                        p.gcMajor + ' / ' + p.gcMinor, num(p.gcMaxMs), countsCell(p)]);
                }
            }
        }
        sections.push(sec('D6 -- GC pressure (REPORTED)',
            'REPORTED B/op (min clean heap delta over 5 passes) and GC events of one observer pass, per op-row; ' +
            'children run with --no-concurrent-recompilation. The 0 B/op claim is gated by test/torture.mjs and ' +
            'benchmark/kernel-lane.mjs (DETERMINISTIC), never by this table.', null,
            tableRows(['op-row', 'n', 'B/op', 'ops/ms', 'GC major / minor', 'max pause ms', 'counts'], rows)));
    }

    // D7 -- scalability.
    if (has('D7')) {
        const rows = [];
        for (const m of members) {
            const r = get(m, 'D7');
            if (!r) continue;
            if (naNote(r)) { rows.push([m, naNote(r), '', '', '', '', '']); continue; }
            for (const x of r.rows) {
                rows.push([m, x.pattern, String(x.dims), String(x.fill), String(x.ops), num(x.nsPerOp), countsCell(x)]);
            }
        }
        sections.push(sec('D7 -- Scalability: insertion pattern x dims x fill',
            'ns per insert of a fresh build (median of reps), counts of the last build. Key types n/a ' +
            '(positional, integer measures).', null,
            tableRows(['adapter', 'pattern', 'dims', 'fill', 'inserts', 'ns/insert', 'counts'], rows)));
    }

    // D8 -- op-row workloads, with one column per counter (per op).
    if (has('D8')) {
        const rows = [];
        for (const m of members) {
            const r = get(m, 'D8');
            if (!r) continue;
            if (naNote(r)) { rows.push([m, naNote(r)]); continue; }
            for (const x of r.rows) {
                if (typeof x.na === 'string') { rows.push([m + '.' + x.op, String(x.n), 'n/a: ' + x.na]); continue; }
                const ex = x.extras ? Object.keys(x.extras).map((k) => k + '=' + num(x.extras[k] / x.ops)).join(' ') : '';
                rows.push([m + '.' + x.op, String(x.n), num(x.nsPerOp), num(x.p50), num(x.p90),
                    ...COUNTER_NAMES.map((k) => perOp(x, k)), ex]);
            }
        }
        sections.push(sec('D8 -- Op-row workloads (counts per op beside every time)',
            'Every timed row carries the 12 engine counters per op (n/a where the adapter has no pair -- never 0) ' +
            'and its native extras per op.', null,
            tableRows(['op-row', 'n', 'ns/op', 'p50', 'p90', ...COUNTER_NAMES, 'extras/op'], rows)));
    }

    // Scenarios (group 2b): one row per timed phase; counts beside the times.
    const scen = Object.keys(R).filter((k) => /\/S\d+$/.test(k));
    if (scen.length > 0) {
        const rows = [];
        for (const k of scen) {
            const r = R[k];
            if (naNote(r)) { rows.push([k, naNote(r)]); continue; }
            for (const p of (Array.isArray(r.phases) ? r.phases : [])) {
                rows.push([k, String(p.n), String(p.name), num(p.nsPerOp), countsCell(p)]);
            }
        }
        sections.push(sec('Scenarios', 'Scenario cells (RESEARCH section 4.2), counts beside the times.', null,
            tableRows(['cell', 'n', 'phase', 'ns/op', 'counts'], rows)));
    }

    // Loss table (mandatory, RESEARCH section 4.3).
    {
        const rows = payload.lossTable.map((l) => [l.scenario, l.winner, l.loser, String(l.crossoverN), l.reason]);
        sections.push(sec('Loss table (where SumSequence loses)',
            rows.length === 0 ? 'No loss rows in this results.json yet (they are measured by the scenario runs). ' +
                'A MEASURED QUIET results.json with zero loss rows is rejected by the README generator.' :
                'Each loss with its crossover n (or "none up to <n>").', null,
            tableRows(['scenario', 'winner', 'loser', 'crossover n', 'reason'], rows)));
    }

    // Per-op honesty class.
    if (payload.opClass) {
        const rows = Object.keys(payload.opClass).map((k) => [k, String(payload.opClass[k])]);
        sections.push(sec('Per-op honesty class', 'Every op is bounded by the integer G-11 touches bound, gated in ' +
            'npm test; none is claimed O(1) or amortized O(1).', null, tableRows(['op-row', 'class'], rows)));
    }

    // Header: subject / foil / rivals (BA-4 source line when present), provenance, notes.
    const roles = (want) => names.filter((n) => adapters[n].role === want);
    const rivalLines = Object.keys(meta.rivals).map((n) => {
        const v = meta.rivals[n];
        if (v.version === NA) return n + ' (' + v.role + '): n/a -- ' + v.reason;
        const src = v.params && typeof v.params.source === 'string' ? ' -- source ' + v.params.source : '';
        return n + ' (' + v.role + ', ' + v.version + ') params ' + JSON.stringify(v.params) + src;
    });
    const head = '<header><h1>@zakkster/lite-yggdrasil -- benchmark report' + (prelim ? ' [PRELIMINARY]' : '') + '</h1>' +
        (prelim ? '<p class="prelim">PRELIMINARY: status ' + esc(payload.status) + ', host ' + esc(meta.hostState) +
            '. These numbers are not a QUIET run of record; README carries none of them (maintainer ruling R-BA5).</p>' : '') +
        '<p class="meta">subject ' + esc(roles('subject').join(', ') || NA) + ' | foil ' +
        esc(roles('primary').join(', ') || NA) + '</p>' +
        rivalLines.map((l) => '<p class="meta">rival ' + esc(l) + '</p>').join('') +
        '<p class="meta">' + esc(provenanceLine(meta)) + '</p>' +
        '<p class="note">Repo-only measurement infra. Counts are DETERMINISTIC (exact integers, the same on any host); ' +
        'every timing is REPORTED: a measurement on this host, not a law, gating nothing (ADR 0003 G-1). ' +
        'D4 is a PORTABLE PROXY. A cell that does not apply reads n/a with its reason, never 0.</p></header>';

    return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">' +
        '<title>lite-yggdrasil benchmark report</title><style>' + STYLE + '</style></head><body>' +
        head + sections.join('') + '</body></html>';
}

const STYLE =
    ':root{--bg:#f8fafc;--card:#ffffff;--ink:#0f172a;--muted:#64748b;--line:#e2e8f0;--warn:#b45309}' +
    '*{box-sizing:border-box}' +
    'body{margin:0;padding:1.5rem;background:var(--bg);color:var(--ink);' +
    'font:15px/1.55 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}' +
    'header{max-width:72rem;margin:0 auto 1.5rem}' +
    'h1{font-size:1.5rem;margin:0 0 .3rem}h2{font-size:1.15rem;margin:0 0 .5rem}' +
    '.meta{color:var(--muted);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.85rem;margin:.2rem 0}' +
    '.note{color:var(--muted);font-size:.85rem;margin:.2rem 0 .8rem}' +
    '.prelim{color:var(--warn);font-weight:600;margin:.4rem 0}' +
    'section{max-width:72rem;margin:0 auto 1.5rem;background:var(--card);border:1px solid var(--line);' +
    'border-radius:.6rem;padding:1rem 1.2rem;overflow-x:auto}' +
    '.chart{margin:.5rem 0 1rem}' +
    'table{width:100%;border-collapse:collapse;font-size:.8rem;margin:0 0 1rem;' +
    'font-variant-numeric:tabular-nums}' +
    'th,td{text-align:right;padding:.3rem .45rem;border-bottom:1px solid var(--line)}' +
    'th:first-child,td:first-child{text-align:left}' +
    'th{color:var(--muted);font-weight:600}';

// ---------------------------------------------------------------------------
// CLI: read results.json, write report.html (fail closed). Mirrors Bench: --publish -> the committed files.
// ---------------------------------------------------------------------------
function main() {
    const args = process.argv.slice(2);
    for (const a of args) {
        if (a !== '--publish') {
            process.stderr.write('[report] unknown flag ' + a + ' (known: --publish)\n');
            process.exit(2);
        }
    }
    const P = args.includes('--publish') ? PATHS.publish : PATHS.out;
    // BA-1: the committed report.html is written only by the run of record (under the quiet lock)
    if (P === PATHS.publish && process.env.QUIET_LOCK_HOST !== 'quiet' && process.env.QUIET_LOCK_HOST !== 'preliminary') {
        process.stderr.write('[report] --publish is the run of record: run it under quiet-lock\n');
        process.exit(2);
    }
    let payload;
    try {
        payload = JSON.parse(readFileSync(P.results, 'utf8'));
    } catch (e) {
        process.stderr.write('[report] cannot read ' + P.label + 'results.json -- run `npm run bench' +
            (P === PATHS.publish ? ' -- --publish' : '') + '` first (' + e.message + ')\n');
        process.exit(1);
    }
    let html;
    try {
        html = renderHtml(payload);
    } catch (e) {
        process.stderr.write('[report] ' + P.label + 'results.json is invalid: ' + e.message + '\n');
        process.exit(1);
    }
    if (P === PATHS.out) mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(P.report, html);
    process.stdout.write('report written to ' + P.label + 'report.html (' + Buffer.byteLength(html) + ' bytes)\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    main();
}
