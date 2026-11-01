/**
 * @zakkster/lite-yggdrasil -- benchmark comparison statistics (the g2b-3 sweep, A/B and crossover rules).
 *
 * MIT (c) Zahary Shinikchiev <shinikchiev@yahoo.com>
 *
 * Repo-only. Bench-ADOPT g2b-3a TASK 1 (.handoff/PLAN-bench-adopt-g2b3a.md; SPEC-bench-adopt CURRENT
 * BA-28 = R-BA28, BA-29 = R-BA29, BA-30 = R-BA30, BA-31 = R-BA31, refining BA-15). Pure and cold: no I/O,
 * no clock, no PRNG; every function reads its arguments and returns a fresh value. Every timing it
 * reads is REPORTED (ADR 0003 G-1, BA-9); it prints facts (win / TIE / loss, crossover n) and never
 * GO / NO-GO text (BA-16, BA-30).
 *
 * Shapes read (the live results map of Bench.mjs orchestrate, '<label>/<Sid>@<n>' -> cell):
 *   cell = Scenarios.mjs runScenario's return: { scenario, member, n, chunkCap, phases: [{ phase,
 *   nsPerOp, ... }], repeats?: [cell, ...] }. Pass 1 of `--runs K` is the cell itself, passes 2..K
 *   are cell.repeats (Bench.mjs orchestrate). A phase's nsPerOp is that child's median of its
 *   samples (ns/event); runValues(cell, phase) lists the K child medians in pass order.
 *   A key '<label>/<Sid>@<n>~c<chunkCap>' is a chunkCap sweep cell (g2b-3a TASK 3): lossRows,
 *   abSummary and twinControl skip it; pickChunkCap reads such cells. '<adapter>/D<k>' keys
 *   (D-rows) are skipped. Any other key throws.
 *
 * Rules (quoted from SPEC CURRENT):
 *   BA-28  K = 5 interleaved passes; a (label, scenario, n, phase) value = median of its K child medians.
 *   BA-29  A wins when its median-of-K is below 0.95 x B's, B likewise, else TIE (neither win nor loss).
 *          BlockedArray.twin vs BlockedArray other than TIE at any (scenario, n) -> INCONCLUSIVE.
 *   BA-30  Crossover reads the blend phase: the smallest measured n from which SumSequence wins at every
 *          larger measured n; none -> 'none up to <largest n>'. S1 = the larger of S1a / S1b; vs
 *          BlockedArray = the larger of BlockedArray / BlockedArray.plain (combineS1 serves both).
 *          A loss row per (scenario, rival label except twin) with a rival win at >= 1 measured n.
 *   BA-31  chunkCap grid = d x {1/4, 1/2, 1, 2, 4}, each rounded up to a multiple of 4, clamped
 *          [8, 65536], deduped; pick = lowest median-of-K blend ns/event; an end-of-grid pick is 'edge'.
 *
 * A one-phase scenario (S2b: ['bulk'], no blend) is read on its only phase wherever blend is named.
 * Every scenario cell of one results map must carry the same run count (1 + repeats.length).
 *
 * INCONCLUSIVE surface: lossRows and abSummary return { rows, inconclusive, twin }; every crossovers()
 * entry carries inconclusive; twin lists every (scenario, n, phase) where the A/A control read other
 * than TIE (or ran no twin cell beside a BlockedArray cell: verdict 'MISSING'), checked over EVERY
 * phase both labels share (fail closed). When inconclusive, every loss row's reason starts with
 * 'INCONCLUSIVE'. A twin cell at another chunkCap than BlockedArray's throws (not an A/A pair).
 *
 * Fail closed: a missing phase, a non-finite or <= 0 value, an empty list, an unknown verdict, an
 * unknown option key (did-you-mean) or a key / cell mismatch throws. ASCII only.
 */

import { isPlain, didYouMean } from './Adapters.mjs';

/** Interleaved passes per run of record and per sweep (BA-28). */
export const K = 5;
/** Win band (BA-29): a wins when med(a) < BAND x med(b). */
export const BAND = 0.95;
/** chunkCap sweep factors on the class default d (BA-31). */
export const SWEEP_FACTORS = Object.freeze([1 / 4, 1 / 2, 1, 2, 4]);
/** chunkCap clamp (BA-31). */
export const CAP_MIN = 8;
export const CAP_MAX = 65536;
/** The phase crossovers, loss rows and the chunkCap pick read (BA-30, BA-31). */
export const BLEND = 'blend';
/** The subject every loss row and crossover is read against. */
export const SUBJECT = 'SumSequence';
/** The A/A control label and the label it shadows (BA-29). */
export const TWIN = 'BlockedArray.twin';
export const TWIN_OF = 'BlockedArray';
/** compare() verdicts. */
export const VERDICTS = Object.freeze(['A', 'B', 'TIE']);

function cmpFail(where, detail) {
    throw new Error('[compare] ' + where + ' ' + detail);
}

function checkOpts(opts, known, where) {
    if (opts === undefined) return {};
    if (!isPlain(opts)) cmpFail(where, 'options must be a plain object');
    for (const k of Object.keys(opts)) {
        if (!known.includes(k)) cmpFail(where + '.' + k, 'unknown option' + didYouMean(k, known));
    }
    return opts;
}

function checkBand(band, where) {
    if (typeof band !== 'number' || !(band > 0) || !(band <= 1)) cmpFail(where, 'band must be a number in (0, 1], got ' + String(band));
    return band;
}

function optBand(opts, where) {
    const o = checkOpts(opts, ['band'], where);
    return checkBand(Object.prototype.hasOwnProperty.call(o, 'band') ? o.band : BAND, where);
}

function checkValue(v, where) {
    if (typeof v !== 'number' || !Number.isFinite(v) || !(v > 0)) {
        cmpFail(where, 'must be a finite number > 0, got ' + String(v));
    }
    return v;
}

function checkList(xs, where) {
    if (!Array.isArray(xs) || xs.length === 0) cmpFail(where, 'must be a non-empty array');
    for (let i = 0; i < xs.length; i++) checkValue(xs[i], where + '[' + i + ']');
    return xs;
}

/**
 * BlockedArray's default chunkCap for a capacity: max(16, ceil(sqrt(C))) rounded up to a multiple
 * of 4 (BA-15). A COPY of benchmark/rivals/BlockedArray.js baDefaultChunkCap (not exported there);
 * test/Compare.test.mjs pins it against new BlockedArray(C).chunkCap.
 */
export function defaultChunkCap(capacity) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 0x7FFFFFFF) {
        cmpFail('defaultChunkCap', 'capacity must be an integer in [1, 2^31 - 1], got ' + String(capacity));
    }
    const raw = Math.max(16, Math.ceil(Math.sqrt(capacity)));
    return (raw + 3) & ~3;
}

/** The chunkCap grid for class default d (BA-31): ascending, deduped, multiples of 4 in [8, 65536]. */
export function sweepGrid(d) {
    if (!Number.isInteger(d) || d < CAP_MIN || d > CAP_MAX || d % 4 !== 0) {
        cmpFail('sweepGrid', 'd must be a multiple of 4 in [' + CAP_MIN + ', ' + CAP_MAX + '], got ' + String(d));
    }
    const out = [];
    for (const f of SWEEP_FACTORS) {
        let c = Math.ceil((d * f) / 4) * 4;
        if (c < CAP_MIN) c = CAP_MIN;
        if (c > CAP_MAX) c = CAP_MAX;
        if (!out.includes(c)) out.push(c);
    }
    return out.sort((a, b) => a - b);
}

/** The label order of pass `pass` (BA-28): rotated left by pass mod length. Returns a new array. */
export function rotateLabels(labels, pass) {
    if (!Array.isArray(labels) || labels.length === 0) cmpFail('rotateLabels', 'labels must be a non-empty array');
    if (!Number.isInteger(pass) || pass < 0) cmpFail('rotateLabels', 'pass must be an integer >= 0, got ' + String(pass));
    const r = pass % labels.length;
    return labels.slice(r).concat(labels.slice(0, r));
}

/** Median of a non-empty list of finite values > 0 (the input is not modified). */
export function median(xs) {
    checkList(xs, 'median');
    const a = xs.slice().sort((p, q) => p - q);
    const m = a.length >> 1;
    return (a.length & 1) ? a[m] : (a[m - 1] + a[m]) / 2;
}

function phaseValue(cell, phase, where) {
    if (!isPlain(cell) || !Array.isArray(cell.phases)) cmpFail(where, 'must be a scenario cell with a phases array');
    let row = null;
    for (const p of cell.phases) {
        if (p !== null && typeof p === 'object' && p.phase === phase) {
            if (row !== null) cmpFail(where, "lists phase '" + phase + "' twice");
            row = p;
        }
    }
    if (row === null) cmpFail(where, "has no phase '" + String(phase) + "'");
    return checkValue(row.nsPerOp, where + ' phase ' + phase + ' nsPerOp');
}

/**
 * The per-run child medians of one (label, scenario, n, phase) value, in pass order: the cell's own
 * phase nsPerOp, then each cell.repeats[i]'s. A repeat naming another (member, scenario, n, chunkCap) throws.
 */
export function runValues(cell, phase) {
    if (typeof phase !== 'string' || phase.length === 0) cmpFail('runValues', 'phase must be a non-empty string');
    const out = [phaseValue(cell, phase, 'cell')];
    if (cell.repeats !== undefined) {
        if (!Array.isArray(cell.repeats)) cmpFail('cell.repeats', 'must be an array');
        for (let i = 0; i < cell.repeats.length; i++) {
            const r = cell.repeats[i];
            const w = 'cell.repeats[' + i + ']';
            if (isPlain(r) && (r.member !== cell.member || r.scenario !== cell.scenario || r.n !== cell.n || r.chunkCap !== cell.chunkCap)) {
                cmpFail(w, 'names another cell (' + r.member + '/' + r.scenario + '@' + r.n + ' chunkCap ' + r.chunkCap + ')');
            }
            out.push(phaseValue(r, phase, w));
        }
    }
    return out;
}

/** The median of the K child medians of one cell's phase (BA-28). */
export function medianOfK(cell, phase) {
    return median(runValues(cell, phase));
}

/**
 * Win / TIE on two lists of per-run values (BA-29): 'A' when med(a) < band x med(b), 'B' when
 * med(b) < band x med(a), else 'TIE'.
 */
export function compare(a, b, band = BAND) {
    checkBand(band, 'compare');
    const ma = median(checkList(a, 'compare a'));
    const mb = median(checkList(b, 'compare b'));
    if (ma < band * mb) return 'A';
    if (mb < band * ma) return 'B';
    return 'TIE';
}

/**
 * Crossover (BA-30). grid = measured n, strictly ascending; verdicts[i] = compare(SumSequence, rival)
 * at grid[i] ('A' = SumSequence wins, 'B' = the rival wins, 'TIE'). Returns the smallest grid n from
 * which every verdict is 'A' through the largest n, else 'none up to <largest n>'.
 */
export function crossover(grid, verdicts) {
    if (!Array.isArray(grid) || grid.length === 0) cmpFail('crossover', 'grid must be a non-empty array');
    if (!Array.isArray(verdicts) || verdicts.length !== grid.length) {
        cmpFail('crossover', 'verdicts must be an array of grid.length (' + grid.length + ')');
    }
    for (let i = 0; i < grid.length; i++) {
        if (!Number.isInteger(grid[i]) || grid[i] < 1) cmpFail('crossover', 'grid[' + i + '] must be an integer >= 1');
        if (i > 0 && !(grid[i] > grid[i - 1])) cmpFail('crossover', 'grid must be strictly ascending at [' + i + ']');
        if (!VERDICTS.includes(verdicts[i])) {
            cmpFail('crossover', "verdicts[" + i + "] must be 'A', 'B' or 'TIE', got " + JSON.stringify(verdicts[i]));
        }
    }
    let i = grid.length;
    while (i > 0 && verdicts[i - 1] === 'A') i--;
    return i === grid.length ? 'none up to ' + grid[grid.length - 1] : grid[i];
}

const NONE_UP_TO = /^none up to ([1-9]\d*)$/;

function checkCrossover(x, where) {
    if (Number.isInteger(x) && x >= 1) return;
    if (typeof x === 'string' && NONE_UP_TO.test(x)) return;
    cmpFail(where, "must be an integer >= 1 or 'none up to <n>', got " + JSON.stringify(x));
}

/** The larger of two crossovers (BA-30: S1 = S1a vs S1b; vs BlockedArray = unrolled vs plain). */
export function combineS1(xa, xb) {
    checkCrossover(xa, 'combineS1 xa');
    checkCrossover(xb, 'combineS1 xb');
    const na = typeof xa === 'string';
    const nb = typeof xb === 'string';
    if (na && nb) return Number(NONE_UP_TO.exec(xa)[1]) >= Number(NONE_UP_TO.exec(xb)[1]) ? xa : xb;
    if (na) return xa;
    if (nb) return xb;
    return xa >= xb ? xa : xb;
}

const SCENARIO_KEY = /^([A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)?)\/(S\d+[a-z]?)@([1-9]\d*)(~c[1-9]\d*)?$/;
const DROW_KEY = /^[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z][A-Za-z0-9]*)?\/D[1-8]$/;

// '<Sid>@<n>' -> Map(label -> cell), untagged scenario cells only; checks key vs cell.
function groupCells(results, where) {
    if (!isPlain(results)) cmpFail(where, 'results must be the plain results map');
    if (Object.prototype.hasOwnProperty.call(results, 'schema')) {
        cmpFail(where, 'takes the results map (payload.results), not the payload');
    }
    const groups = new Map();
    let runs = 0;
    for (const key of Object.keys(results)) {
        if (DROW_KEY.test(key)) continue;
        const m = SCENARIO_KEY.exec(key);
        if (!m) cmpFail(where, "key '" + key + "' is not '<label>/<Sid>@<n>[~c<chunkCap>]' or '<adapter>/D<k>'");
        const cell = results[key];
        const n = Number(m[3]);
        if (!isPlain(cell) || cell.member !== m[1] || cell.scenario !== m[2] || cell.n !== n) {
            cmpFail(where, "cell '" + key + "' does not name its key's member / scenario / n");
        }
        if (m[4] !== undefined && cell.chunkCap !== Number(m[4].slice(2))) {
            cmpFail(where, "cell '" + key + "' has chunkCap " + cell.chunkCap + ', its key tag ' + m[4]);
        }
        const k = 1 + (Array.isArray(cell.repeats) ? cell.repeats.length : 0);
        if (runs === 0) runs = k;
        else if (k !== runs) cmpFail(where, "cell '" + key + "' has " + k + ' runs, other cells ' + runs + ' (a failed or missing pass)');
        if (m[4] !== undefined) continue; // a chunkCap sweep cell
        const g = m[2] + '@' + n;
        if (!groups.has(g)) groups.set(g, { scenario: m[2], n, cells: new Map() });
        groups.get(g).cells.set(m[1], cell);
    }
    return [...groups.values()].sort((a, b) => sidOrder(a.scenario, b.scenario) || a.n - b.n);
}

function sidOrder(a, b) {
    const na = Number(/\d+/.exec(a)[0]);
    const nb = Number(/\d+/.exec(b)[0]);
    if (na !== nb) return na - nb;
    return a < b ? -1 : a > b ? 1 : 0;
}

function phaseNames(cell) {
    return Array.isArray(cell.phases) ? cell.phases.map((p) => (p !== null && typeof p === 'object' ? p.phase : undefined)) : [];
}

// The phase a crossover / pick reads: 'blend', or a one-phase scenario's only phase (S2b: ['bulk']).
function blendOf(cell, where) {
    const names = phaseNames(cell);
    if (names.includes(BLEND)) return BLEND;
    if (names.length === 1 && typeof names[0] === 'string') return names[0];
    cmpFail(where, "has no '" + BLEND + "' phase and more than one phase");
}

/**
 * The A/A control (BA-29): for every (scenario, n) holding a BlockedArray cell, twin vs BlockedArray
 * over every phase both list. Returns { inconclusive, twin: [{ scenario, n, phase, verdict, ratio }] }
 * with one entry per non-TIE reading; a missing twin cell reads { phase: null, verdict: 'MISSING',
 * ratio: null }.
 */
export function twinControl(results, opts) {
    const band = optBand(opts, 'twinControl');
    const twin = [];
    for (const g of groupCells(results, 'twinControl')) {
        const ref = g.cells.get(TWIN_OF);
        if (ref === undefined) continue;
        const tw = g.cells.get(TWIN);
        if (tw === undefined) {
            twin.push({ scenario: g.scenario, n: g.n, phase: null, verdict: 'MISSING', ratio: null });
            continue;
        }
        if (tw.chunkCap !== ref.chunkCap) {
            cmpFail('twinControl', g.scenario + '@' + g.n + ': twin chunkCap ' + tw.chunkCap + ' != BlockedArray ' + ref.chunkCap + ' (not an A/A pair)');
        }
        const names = phaseNames(ref);
        if (names.join(',') !== phaseNames(tw).join(',')) cmpFail('twinControl', g.scenario + '@' + g.n + ': twin and BlockedArray list other phases');
        for (const ph of names) {
            const a = runValues(tw, ph);
            const b = runValues(ref, ph);
            const v = compare(a, b, band);
            if (v !== 'TIE') twin.push({ scenario: g.scenario, n: g.n, phase: ph, verdict: v, ratio: median(a) / median(b) });
        }
    }
    return { inconclusive: twin.length > 0, twin };
}

function twinNote(tc) {
    const t = tc.twin[0];
    return 'INCONCLUSIVE (twin A/A ' + (t.verdict === 'MISSING' ? 'missing' : 'not TIE') + ' at ' + t.scenario + '@' + t.n +
        (t.phase === null ? '' : ' ' + t.phase) + (tc.twin.length > 1 ? ' and ' + (tc.twin.length - 1) + ' more' : '') + '): ';
}

/**
 * The crossover table (BA-30): one { scenario, rival, phase, grid, verdicts, crossoverN, inconclusive }
 * per (scenario, rival label except BlockedArray.twin), every rival included (with or without a loss).
 * phase = 'blend', or the only phase of a one-phase scenario (S2b); grid = the measured n where both
 * SumSequence and the rival ran, ascending; verdicts[i] = compare(SumSequence, rival) at grid[i];
 * crossoverN = crossover(grid, verdicts); inconclusive = twinControl(results, { band }).inconclusive
 * (BA-29; the same flag lossRows reports). Ordered by scenario, then rival label. opts { band }.
 */
export function crossovers(results, opts) {
    const band = optBand(opts, 'crossovers');
    const tc = twinControl(results, { band });
    // scenario -> label -> { phase, grid, verdicts }
    const per = new Map();
    for (const g of groupCells(results, 'crossovers')) {
        const subj = g.cells.get(SUBJECT);
        if (subj === undefined) cmpFail('crossovers', g.scenario + '@' + g.n + ' has no ' + SUBJECT + ' cell');
        const ph = blendOf(subj, 'crossovers ' + g.scenario + '@' + g.n);
        const a = runValues(subj, ph);
        if (!per.has(g.scenario)) per.set(g.scenario, new Map());
        const byLabel = per.get(g.scenario);
        for (const [label, cell] of g.cells) {
            if (label === SUBJECT || label === TWIN) continue;
            if (!byLabel.has(label)) byLabel.set(label, { phase: ph, grid: [], verdicts: [] });
            const e = byLabel.get(label);
            e.grid.push(g.n);
            e.verdicts.push(compare(a, runValues(cell, ph), band));
        }
    }
    const out = [];
    for (const [scenario, byLabel] of per) {
        for (const rival of [...byLabel.keys()].sort()) {
            const e = byLabel.get(rival);
            out.push({ scenario, rival, phase: e.phase, grid: e.grid, verdicts: e.verdicts, crossoverN: crossover(e.grid, e.verdicts), inconclusive: tc.inconclusive });
        }
    }
    return out;
}

/**
 * Loss rows (BA-30) from the results map: one { scenario, winner, loser, crossoverN, reason } per
 * crossovers() entry where the rival wins at >= 1 measured n. opts { band }. Returns
 * { rows, inconclusive, twin } (twinControl). Never emits GO / NO-GO text.
 */
export function lossRows(results, opts) {
    const band = optBand(opts, 'lossRows');
    const tc = twinControl(results, { band });
    const rows = [];
    const prefix = tc.inconclusive ? twinNote(tc) : '';
    for (const e of crossovers(results, { band })) {
        const lost = [];
        for (let i = 0; i < e.grid.length; i++) if (e.verdicts[i] === 'B') lost.push(e.grid[i]);
        if (lost.length === 0) continue;
        rows.push({
            scenario: e.scenario, winner: e.rival, loser: SUBJECT, crossoverN: e.crossoverN,
            reason: prefix + e.rival + ' wins ' + e.phase + ' (median-of-K below ' + band + ' x ' + SUBJECT + "'s) at n = " +
                lost.join(', ') + ' of ' + e.grid.length + ' measured n (largest measured n ' + e.grid[e.grid.length - 1] + ')',
        });
    }
    return { rows, inconclusive: tc.inconclusive, twin: tc.twin };
}

/**
 * The chunkCap pick for one (scenario, n) (BA-31): cells = the sweep cells (one per grid chunkCap,
 * each with its own repeats), all naming one (member, scenario, n). Returns { chunkCap, edge,
 * nsPerEvent } = the argmin of median-of-K blend ns/event (the smaller chunkCap on an exact tie);
 * edge = the pick is the grid's first or last chunkCap.
 */
export function pickChunkCap(rows) {
    if (!Array.isArray(rows) || rows.length === 0) cmpFail('pickChunkCap', 'rows must be a non-empty array of sweep cells');
    const r0 = rows[0];
    const k0 = isPlain(r0) ? 1 + (Array.isArray(r0.repeats) ? r0.repeats.length : 0) : 0;
    const seen = [];
    let best = -1;
    let bestV = Infinity;
    for (let i = 0; i < rows.length; i++) {
        const c = rows[i];
        if (!isPlain(c)) cmpFail('pickChunkCap', 'rows[' + i + '] must be a sweep cell');
        if (c.member !== r0.member || c.scenario !== r0.scenario || c.n !== r0.n) {
            cmpFail('pickChunkCap', 'rows[' + i + '] names another (member, scenario, n) than rows[0]');
        }
        if (!Number.isInteger(c.chunkCap) || c.chunkCap < CAP_MIN || c.chunkCap > CAP_MAX) {
            cmpFail('pickChunkCap', 'rows[' + i + '].chunkCap must be an integer in [' + CAP_MIN + ', ' + CAP_MAX + ']');
        }
        if (seen.includes(c.chunkCap)) cmpFail('pickChunkCap', 'rows[' + i + '].chunkCap ' + c.chunkCap + ' listed twice');
        const k = 1 + (Array.isArray(c.repeats) ? c.repeats.length : 0);
        if (k !== k0) cmpFail('pickChunkCap', 'rows[' + i + '] has ' + k + ' runs, rows[0] ' + k0 + ' (a failed or missing pass)');
        seen.push(c.chunkCap);
    }
    const order = rows.map((c, i) => i).sort((p, q) => rows[p].chunkCap - rows[q].chunkCap);
    for (const i of order) {
        const v = medianOfK(rows[i], blendOf(rows[i], 'pickChunkCap rows[' + i + ']'));
        if (v < bestV) { bestV = v; best = i; }
    }
    const pos = order.indexOf(best);
    return { chunkCap: rows[best].chunkCap, edge: pos === 0 || pos === order.length - 1, nsPerEvent: bestV };
}

/**
 * A/B per (scenario, n) where both labels ran (untagged cells): rows [{ scenario, n, verdict, ratio,
 * a, b }] with a / b = median-of-K of phase, ratio = a / b, verdict = compare(A runs, B runs).
 * opts { band }. Returns { rows, inconclusive, twin } (twinControl). Throws when no (scenario, n)
 * holds both labels.
 */
export function abSummary(results, A, B, phase, opts) {
    const band = optBand(opts, 'abSummary');
    if (typeof A !== 'string' || typeof B !== 'string' || A.length === 0 || A === B) {
        cmpFail('abSummary', 'A and B must be two different non-empty labels');
    }
    if (typeof phase !== 'string' || phase.length === 0) cmpFail('abSummary', 'phase must be a non-empty string');
    const tc = twinControl(results, { band });
    const rows = [];
    for (const g of groupCells(results, 'abSummary')) {
        const ca = g.cells.get(A);
        const cb = g.cells.get(B);
        if (ca === undefined || cb === undefined) continue;
        const ra = runValues(ca, phase);
        const rb = runValues(cb, phase);
        const a = median(ra);
        const b = median(rb);
        rows.push({ scenario: g.scenario, n: g.n, verdict: compare(ra, rb, band), ratio: a / b, a, b });
    }
    if (rows.length === 0) cmpFail('abSummary', 'no (scenario, n) holds both ' + A + ' and ' + B);
    return { rows, inconclusive: tc.inconclusive, twin: tc.twin };
}
