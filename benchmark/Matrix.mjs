/**
 * @zakkster/lite-yggdrasil -- benchmark applicability matrix (subject x dimension x baseline).
 *
 * MIT (c) Zahary Shinikchiev <shinikchiev@yahoo.com>
 *
 * Repo-only. Bench-ADOPT group 1 TASK 4. Shape copied from @zakkster/lite-logn
 * benchmark/Matrix.mjs (Bench v2 kit, LiteLogN commit 9eb484c): NA, SUBJECTS, DIMENSIONS,
 * titles, BASELINE, baselineFor, cells, OP_ROWS, OP_CLASS and the claim classifier
 * (CLAIM_CLASS, CLAIM_MARKERS, classifyClaim -- the classifier body is the kit's), re-wired for
 * one positional summary tree measured against the splice foil (benchmark/METHODOLOGY.md).
 *
 * The matrix is the honesty spine: for every (subject, dimension) cell it names the baseline
 * the subject is measured against, and a cell that does not apply is the STRING 'n/a' with its
 * reason (NA_REASONS) -- NEVER 0, so "not applicable" never reads as "measured zero".
 * ASCII only.
 */

import { selectScenario } from './Scenarios.mjs';

/** Sentinel for a cell that does not apply. NEVER 0. */
export const NA = 'n/a';

/** The shipped subject (the package's one member). */
export const SUBJECTS = ['SumSequence'];

/** The primary O(n) foil every D-row prints beside the subject (benchmark/Adapters.mjs). */
export const FOIL = 'SpliceFoil';

/** The eight measurement dimensions. */
export const DIMENSIONS = ['D1', 'D2', 'D3', 'D4', 'D5', 'D6', 'D7', 'D8'];

/** Human titles (report + tables). */
export const DIMENSION_TITLES = {
    D1: 'Splice witness: touches per op vs touchesMax (G-11) and foil moves per op, then the REPORTED ns/op vs log2 n fit',
    D2: 'Amortized cost over a long mixed trace (cumulative ns/op drift)',
    D3: 'Memory: typed-array bytes per live element vs the floor (4 x dims + 4)',
    D4: 'Cache behaviour (PROXY: cursor walk vs random seek + leafSize sweep)',
    D5: 'Bundle size (raw + node:zlib gzip of Yggdrasil.js; tree-shaking n/a)',
    D6: 'GC pressure (REPORTED B/op + maxPauseMs per op-row)',
    D7: 'Scalability: insertion pattern x dims x fill (key types n/a)',
    D8: 'Workload micro-benchmarks (op-row workloads)',
};

/** The PRIMARY O(n) foil the subject is measured against. */
export const BASELINE = {
    SumSequence: 'splice-foil (Array.splice + Int32Array prefix rebuild)',
};

/** Why a cell or sub-cell is 'n/a' (rendered beside the string, never as 0). */
export const NA_REASONS = Object.freeze({
    D5: 'bundle size is intrinsic to the file; no built-in to compare a gzip size against',
    treeShaking: 'single file, single member (maintainer ruling R-BA2)',
    keyTypes: 'positional, integer measures',
    foilBytes: 'foil: JS Array columns have no typed-array byte count',
    foilCursor: 'foil: no cursor (index access is O(1) on a JS Array)',
});

/** The baseline for a (subject, dimension) cell, or NA (D5 has no head-to-head baseline). */
export function baselineFor(member, dim) {
    if (!SUBJECTS.includes(member)) return NA;
    if (!DIMENSIONS.includes(dim)) return NA;
    if (dim === 'D5') return NA;
    return BASELINE[member];
}

/**
 * Every cell the orchestrator runs, one child process per cell. No argument: (SUBJECTS + FOIL)
 * x DIMENSIONS (results.json keys '<adapter>/<Dk>'; the foil row's baseline is NA, it IS the
 * baseline, and a dimension that does not apply to it returns its n/a reason). A scenario id: that scenario's adapters x sizes (selectScenario throws
 * "unknown scenario <id>" on an id the registry does not hold).
 * @param {string} [scenarioId]
 * @returns {{member:string, dim:string, baseline:string, n?:number, scenario?:string}[]}
 */
export function cells(scenarioId) {
    const out = [];
    if (scenarioId !== undefined) {
        const s = selectScenario(scenarioId);
        for (const member of s.adapters) {
            for (const n of s.sizes) out.push({ member, dim: s.id, baseline: NA, n, scenario: s.id });
        }
        return out;
    }
    for (const member of [...SUBJECTS, FOIL]) {
        for (const dim of DIMENSIONS) out.push({ member, dim, baseline: baselineFor(member, dim) });
    }
    return out;
}

// ===========================================================================
// Op rows + per-op honesty class. Every hot op of SumSequence is bounded by the G-11 touches
// bound touches <= p(row) x HB(Lmax) (ADR 0005 C-25), an integer gated in npm test, so each
// reads O(log n) worst-case. OP_ROW_TOUCH names the C-25 row(s) each op is counted against
// (test/spec-counts.mjs TOUCH_* ids). No value may claim O(1) or amortized O(1): no count gate
// backs it (decisions/0003 G-2).
// ===========================================================================

/** The op rows D1 / D6 / D8 measure, as `member.op`. */
export const OP_ROWS = [
    'SumSequence.insertAt',
    'SumSequence.removeAt',
    'SumSequence.setMeasure',
    'SumSequence.indexAtSum',
    'SumSequence.sumBefore',
    'SumSequence.cursorWalk',
    'SumSequence.splitAt',
    'SumSequence.append',
];

/** The O(log n) honesty class label for a worst-case (G-11-bounded) op. */
export const OLOGN_WORST = 'O(log n) worst-case';

export const OP_CLASS = Object.freeze({
    'SumSequence.insertAt': OLOGN_WORST,   // C-25 rows HIT / MISS / INSERT_SPLIT (p = 0 / 1 / 2)
    'SumSequence.removeAt': OLOGN_WORST,   // C-25 rows HIT / MISS / REMOVE_UNDERFLOW (p = 0 / 1 / 2)
    'SumSequence.setMeasure': OLOGN_WORST, // C-25 rows HIT / MISS (p = 0 / 1)
    'SumSequence.indexAtSum': OLOGN_WORST, // C-25 row SEEK (p = 1)
    'SumSequence.sumBefore': OLOGN_WORST,  // C-25 row SEEK (p = 1)
    'SumSequence.cursorWalk': OLOGN_WORST, // per next(): C-25 row NEXT (p = 1)
    'SumSequence.splitAt': OLOGN_WORST,    // C-25 rows SPLITAT / SPLITAT_REPAIRS (p = 3)
    'SumSequence.append': OLOGN_WORST,     // C-25 row APPEND (p = 2)
});

// ===========================================================================
// Claim-honesty classification (MEMBER-AGNOSTIC MACHINERY copied from the kit, RE-WIRED
// markers). THREE claim classes -- the doc gate keys off this:
//   - alloc : the DETERMINISTIC tier -- 0 B/op proved by test/torture.mjs and the lane
//             harnesses, and the integer count bounds gated by test/spec-counts.mjs (G-11);
//             the wording KEEPS "proven".
//   - timing: REPORTED only (ns/op, the log2 n fit, crossovers): the wording must read
//             "witness" / "empirical" / "we observe" / "measured" -- NEVER "proven".
//   - cited : "proven" refers to CITED LITERATURE, not a measurement on this host.
// A blanket find-replace of "proven" is a BUG: each hit is classified FIRST.
// ===========================================================================

/** The three claim classes. Frozen so a typo is a reference error, not a silent miss. */
export const CLAIM_CLASS = Object.freeze({
    alloc: 'alloc',
    timing: 'timing',
    cited: 'cited',
});

/**
 * Signatures of a NON-timing "prove*" hit. cited is checked before alloc. Re-wired for
 * lite-yggdrasil: alloc = the torture / 0 B/op vocabulary plus the count-gate vocabulary
 * (spec-counts, touchesMax, G-11); cited = literature (the weight-balanced tree papers).
 */
export const CLAIM_MARKERS = Object.freeze({
    cited: [/\bNievergelt\b/, /\bReingold\b/, /\bBlum\b.*\bMehlhorn\b/, /literature/i],
    alloc: [/0 ?B\/op/i, /zero-alloc/i, /byte-identical/i, /\btorture\b/i, /\bspec-counts\b/, /\btouchesMax\b/,
        /\bG-11\b/],
});

/**
 * Classify a single line that contains a "prove*" hit into its CLAIM_CLASS. Pure. A line with
 * no alloc / cited marker is a TIMING claim (the default). Fail closed: a non-string is timing.
 * @param {string} line
 * @returns {'alloc'|'timing'|'cited'}
 */
export function classifyClaim(line) {
    const s = typeof line === 'string' ? line : '';
    for (const re of CLAIM_MARKERS.cited) if (re.test(s)) return CLAIM_CLASS.cited;
    for (const re of CLAIM_MARKERS.alloc) if (re.test(s)) return CLAIM_CLASS.alloc;
    return CLAIM_CLASS.timing;
}
