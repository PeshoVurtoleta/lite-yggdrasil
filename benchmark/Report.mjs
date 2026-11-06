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
 *
 * g2b-3a B3 (SPEC BA-29 / BA-30 / BA-31): the comparison sections read the results map through
 * benchmark/Compare.mjs (crossovers, abSummary, twinControl): the chunkCap pick table (when the run
 * used --picks), the blend win / TIE / loss grid per (scenario, rival, n), the crossovers (INCONCLUSIVE
 * when the twin A/A control is not TIE), and the unrolled vs plain BlockedArray A/B plus the twin A/A
 * readings. g2b-4 (R-BA41 / R-BA42 / R-BA44): every verdict reads min-of-K, the printed values stay
 * median-of-K with the min-of-K columns beside them; the twin A/A gates on the crossover phase only, and
 * a fifth section lists the twin's non-TIE readings on the other phases (noise, never a gate). Each is labelled PRELIMINARY unless the payload is a QUIET MEASURED run (isPreliminary).
 * A section whose labels did not run in the payload reads "not measured in this run"; any other
 * Compare throw propagates (fail closed). The report prints facts, never a go / no-go verdict (BA-30).
 *
 * BA-41 (R-BA47 / R-BA51): the Scenarios phases and the D8 op rows print K, the median-of-K ns/op and the
 * min-of-K beside it (Compare.mjs runValues / rowRunValues; a malformed repeat throws); every other
 * timed D-row column (D1 fit, D2, D4, D6 ops/ms + pause, D7, D8 p50 / p90) prints pass 1 and its
 * header carries "(pass 1)"; counts, sizes and DETERMINISTIC columns carry no label.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validateResults } from './Bench.mjs';
import { COUNTER_NAMES } from './Adapters.mjs';
import { crossovers, abSummary, twinControl, runValues, rowRunValues, median, minOfList, BAND, SUBJECT, TWIN, TWIN_OF } from './Compare.mjs';

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

const NOT_MEASURED = 'not measured in this run';
// BA-41: the note of the two median-of-K tables (Scenarios, D8).
const KOF_NOTE = 'ns/op = median of the K passes\' child medians (BA-28); min of K = the lowest (what BA-29 verdicts read); ' +
    'counts are pass 1\'s.';
const PLAIN = 'BlockedArray.plain';
const UNTAGGED_SCENARIO = /^([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)?)\/(S\d+[a-z]?)@([1-9]\d*)$/;

// SumSequence's side of one compare(SumSequence, rival) verdict
const VERDICT_TEXT = { A: 'win', B: 'loss', TIE: 'TIE' };

// The comparison sections (BA-29 / BA-30 / BA-31), in order; sec = the PRELIMINARY-aware section builder.
function comparisonSections(payload, sec) {
    const R = payload.results;
    const out = [];
    // labels per scenario, untagged scenario cells only (what Compare compares)
    const labels = new Map();
    for (const k of Object.keys(R)) {
        const m = UNTAGGED_SCENARIO.exec(k);
        if (m === null) continue;
        if (!labels.has(m[2])) labels.set(m[2], new Set());
        labels.get(m[2]).add(m[1]);
    }
    const ran = (label) => [...labels.values()].some((x) => x.has(label));

    if (payload.tuning !== undefined) {
        const t = payload.tuning;
        out.push(sec('chunkCap picks (BA-31)', 'Every BlockedArray label ran each (scenario, n) at the chunkCap picked by a ' +
            '--sweep chunkCap run: the lowest median-of-K blend ns/event over d x {1/4, 1/2, 1, 2, 4, 8} (REPORTED; the pick reads median-of-K, never min-of-K). Table ' +
            t.source + ', sha256/8 ' + t.sha256.slice(0, 8) + ', host ' + t.hostState + '. "edge" = the pick is the end of its grid.', null,
        tableRows(['scenario', 'n', 'capacity', 'd', 'grid', 'chunkCap', 'edge', 'ns/event'],
            t.picks.map((p) => [p.scenario, String(p.n), String(p.capacity), String(p.d), p.grid.join(' '), String(p.chunkCap),
                p.edge ? 'edge' : '', num(p.nsPerEvent)]))));
    }

    const xs = crossovers(R);
    const inc = xs.length > 0 && xs[0].inconclusive;
    const incNote = inc ? 'INCONCLUSIVE: the twin A/A control read other than TIE on a crossover phase in this run (BA-29, R-BA42); ' +
        'every comparison below is INCONCLUSIVE. ' : '';
    const grid = [];
    for (const e of xs) {
        for (let i = 0; i < e.grid.length; i++) {
            grid.push([e.scenario, e.rival, e.phase, String(e.grid[i]), VERDICT_TEXT[e.verdicts[i]] + (inc ? ' (INCONCLUSIVE)' : '')]);
        }
    }
    out.push(sec('Blend win / TIE / loss grid (BA-29)', grid.length === 0 ? NOT_MEASURED + ' (no ' + SUBJECT + ' vs rival scenario cells)' :
        incNote + SUBJECT + ' vs each rival on the blend phase (a one-phase scenario on its only phase): win = ' + SUBJECT +
        "'s min-of-K below " + BAND + " x the rival's min-of-K, loss = the rival's min-of-K below " + BAND + ' x ' + SUBJECT +
        "'s, else TIE (min-of-K = the minimum of the K child medians, R-BA41). REPORTED.",
    null, grid.length === 0 ? '' : tableRows(['scenario', 'rival', 'phase', 'n', SUBJECT], grid)));

    out.push(sec('Crossovers (BA-30)', xs.length === 0 ? NOT_MEASURED + ' (no ' + SUBJECT + ' vs rival scenario cells)' :
        incNote + 'The smallest measured n from which ' + SUBJECT + ' wins at every larger measured n ("none up to <n>" when there is ' +
        'none). REPORTED.', null, xs.length === 0 ? '' : tableRows(['scenario', 'rival', 'phase', 'measured n', 'crossover n', 'control'],
        xs.map((e) => [e.scenario, e.rival, e.phase, e.grid.join(' '), String(e.crossoverN), e.inconclusive ? 'INCONCLUSIVE' : 'twin TIE']))));

    // unrolled vs plain (per scenario: blend, or a one-phase scenario's only phase) + the twin A/A readings
    const ab = [];
    for (const [sid, set] of labels) {
        if (!set.has(TWIN_OF) || !set.has(PLAIN)) continue;
        const sub = {};
        let phase = null;
        for (const k of Object.keys(R)) {
            const m = UNTAGGED_SCENARIO.exec(k);
            if (m === null || m[2] !== sid) continue;
            sub[k] = R[k];
            if (m[1] === TWIN_OF && phase === null) {
                const names = Array.isArray(R[k].phases) ? R[k].phases.map((p) => p.phase) : [];
                phase = names.includes('blend') ? 'blend' : names.length === 1 ? names[0] : 'blend';
            }
        }
        for (const r of abSummary(sub, TWIN_OF, PLAIN, phase).rows) {
            ab.push([r.scenario, String(r.n), phase, num(r.a), num(r.b), num(r.ratio), num(r.aMin), num(r.bMin), num(r.minRatio),
                (r.verdict === 'A' ? 'unrolled win' : r.verdict === 'B' ? 'plain win' : 'TIE') + (inc ? ' (INCONCLUSIVE)' : '')]);
        }
    }
    let twinRows = null;
    let noiseRows = null;
    let twinNote = 'twin A/A: ' + NOT_MEASURED + ' (no BlockedArray scenario cell).';
    if (ran(TWIN_OF)) {
        const tc = twinControl(R);
        const row = (t) => [t.scenario, String(t.n), t.phase === null ? NA : t.phase, t.verdict,
            t.ratio === null ? NA : num(t.ratio), t.minRatio === null ? NA : num(t.minRatio)];
        twinRows = tc.twin.map(row);
        noiseRows = tc.noise.map(row);
        twinNote = 'The twin A/A gates on the crossover phase only (blend, or a one-phase scenario\'s only phase; R-BA42). ' +
            (tc.inconclusive ? 'twin A/A (' + TWIN + ' vs ' + TWIN_OF + '): INCONCLUSIVE, ' + tc.twin.length +
            ' crossover-phase reading(s) other than TIE (or a missing twin cell) below; every comparison of this run is INCONCLUSIVE.' :
            'twin A/A (' + TWIN + ' vs ' + TWIN_OF + '): TIE at every (scenario, n) crossover phase both ran.');
    }
    out.push(sec('BlockedArray unrolled vs plain A/B, twin A/A control (BA-29)',
        (ab.length === 0 ? 'unrolled vs plain: ' + NOT_MEASURED + ' (no scenario ran both ' + TWIN_OF + ' and ' + PLAIN + '). ' :
            'unrolled (' + TWIN_OF + ') vs ' + PLAIN + ': ns/event and ratio = unrolled / plain are median-of-K; min and min ratio are ' +
            'min-of-K; the verdict reads min-of-K, win band ' + BAND + ' (R-BA41). REPORTED. ') + twinNote,
    null, (ab.length === 0 ? '' : tableRows(['scenario', 'n', 'phase', 'unrolled ns/event', 'plain ns/event', 'ratio', 'unrolled min',
        'plain min', 'min ratio', 'verdict'], ab)) +
        (twinRows === null || twinRows.length === 0 ? '' : tableRows(['scenario', 'n', 'phase', 'twin verdict', 'twin / BlockedArray',
            'min ratio'], twinRows))));
    out.push(sec('twin noise (other phases, never a gate, R-BA42)',
        noiseRows === null ? 'twin noise: ' + NOT_MEASURED + ' (no BlockedArray scenario cell).' :
            'The NON-TIE twin A/A readings (' + TWIN + ' vs ' + TWIN_OF + ') on the non-crossover phases: noise, printed, never a gate ' +
            '(they never make a comparison INCONCLUSIVE). twin / BlockedArray is median-of-K, min ratio min-of-K. ' +
            (noiseRows.length === 0 ? 'None: every non-crossover twin reading is TIE.' : noiseRows.length + ' reading(s) below.') + ' REPORTED.',
    null, noiseRows === null || noiseRows.length === 0 ? '' : tableRows(['scenario', 'n', 'phase', 'twin verdict', 'twin / BlockedArray',
        'min ratio'], noiseRows)));
    return out;
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
        const chart = series.length > 0 ? renderSvg({ type: 'line', title: 'D1 REPORTED ns/op vs n (pass 1)',
            xlabel: 'n (log10)', ylabel: 'ns per insertAt+removeAt (pass 1)', series }) : null;
        sections.push(sec('D1 -- Splice witness (counts first, then the REPORTED fit)',
            'DETERMINISTIC first: the subject\'s touches per op against touchesMax(row, Lmax) of test/spec-counts.mjs ' +
            '(G-11 as amended by 0005 C-25; violations must be 0), the foil\'s moves per insertAt(floor(n/2)) ' +
            '(exactly n - floor(n/2)). Then the REPORTED ns/op vs log2 n fit; lite-logn\'s r2 0.958 is a reference only. ' +
            'Neither the fit nor the reference gates anything.', chart,
            tableRows(['adapter', 'n', 'op', 'ops', 'touches/op', 'max touches', 'max bound', 'hits', 'misses',
                'splits', 'underflows', 'violations'], subj) +
            tableRows(['adapter', 'n', 'op', 'ops', 'moves/op', 'expected', 'exact'], foil) +
            tableRows(['adapter', 'fit r2 (pass 1)', 'slope (ns/level) (pass 1)', 'intercept (pass 1)', 'r2 reference', 'violations'], fits)));
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
            'Drift sentinel ' + s.cell + ': first (pass 1) ' + num(s.first) + ' -> ' + num(s.second) + ' ns/op (' +
            (s.drift * 100).toFixed(0) + '%, disclosure limit ' + (s.limit * 100).toFixed(0) + '%).');
        sections.push(sec('D2 -- Amortized cost over a long mixed trace', note,
            series.length > 0 ? renderSvg({ type: 'line', title: 'D2 amortized (pass 1)', xlabel: 'ops (log10)',
                ylabel: 'cumulative ns/op (pass 1)', series }) : null,
            tableRows(['adapter', 'drift (last/first) (pass 1)', 'ops', 'counts at the end'], rows)));
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
            tableRows(['adapter', 'config', 'walk ns/elem (pass 1)', 'seek ns/op (pass 1)', 'gap (pass 1)', 'seek counts'], rows)));
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
            tableRows(['op-row', 'n', 'B/op', 'ops/ms (pass 1)', 'GC major / minor', 'max pause ms (pass 1)', 'counts'], rows)));
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
            tableRows(['adapter', 'pattern', 'dims', 'fill', 'inserts', 'ns/insert (pass 1)', 'counts'], rows)));
    }

    // D8 -- op-row workloads, with one column per counter (per op).
    if (has('D8')) {
        const rows = [];
        for (const m of members) {
            const r = get(m, 'D8');
            if (!r) continue;
            if (naNote(r)) { rows.push([m, naNote(r)]); continue; }
            for (const x of r.rows) {
                const vs = rowRunValues(r, x.op, x.n); // null = an n/a row (every pass n/a, else it throws)
                if (vs === null) { rows.push([m + '.' + x.op, String(x.n), 'n/a: ' + x.na]); continue; }
                const ex = x.extras ? Object.keys(x.extras).map((k) => k + '=' + num(x.extras[k] / x.ops)).join(' ') : '';
                rows.push([m + '.' + x.op, String(x.n), String(vs.length), num(median(vs)), num(minOfList(vs)), num(x.p50), num(x.p90),
                    ...COUNTER_NAMES.map((k) => perOp(x, k)), ex]);
            }
        }
        sections.push(sec('D8 -- Op-row workloads (counts per op beside every time)',
            'Every timed row carries the 12 engine counters per op (n/a where the adapter has no pair -- never 0) ' +
            'and its native extras per op. ' + KOF_NOTE, null,
            tableRows(['op-row', 'n', 'K', 'ns/op (median of K)', 'min of K', 'p50 (pass 1)', 'p90 (pass 1)', ...COUNTER_NAMES, 'extras/op'], rows)));
    }

    // Scenarios (group 2b): one row per timed phase; counts beside the times. Every scenario key form
    // of Bench.mjs RESULT_KEY ('<label>/<Sid>@<n>' and a sweep's '<label>/<Sid>@<n>~c<chunkCap>'): a
    // sweep's per-chunkCap cells are listed too (they are its only per-cell timing table).
    const scen = Object.keys(R).filter((k) => /\/S\d+[a-z]?@[1-9]\d*(~c[1-9]\d*)?$/.test(k));
    if (scen.length > 0) {
        const rows = [];
        for (const k of scen) {
            const r = R[k];
            if (naNote(r)) { rows.push([k, naNote(r)]); continue; }
            for (const p of (Array.isArray(r.phases) ? r.phases : [])) {
                const vs = runValues(r, p.phase);
                rows.push([k, String(r.n), String(p.phase), String(vs.length), num(median(vs)), num(minOfList(vs)), countsCell(p)]);
            }
        }
        sections.push(sec('Scenarios', 'Scenario cells (RESEARCH section 4.2), counts beside the times. ' + KOF_NOTE, null,
            tableRows(['cell', 'n', 'phase', 'K', 'ns/op (median of K)', 'min of K', 'counts'], rows)));
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

    // The comparison sections (g2b-3a B3).
    for (const x of comparisonSections(payload, sec)) sections.push(x);

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
