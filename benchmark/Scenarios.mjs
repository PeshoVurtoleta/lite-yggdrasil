/**
 * @zakkster/lite-yggdrasil -- benchmark scenario registry (the scenario axis).
 *
 * MIT (c) Zahary Shinikchiev <shinikchiev@yahoo.com>
 *
 * Repo-only. Bench-ADOPT group 1 TASK 3 (.handoff/PLAN-bench-adopt-g1.md SPEC "SCENARIO").
 * The registry ships EMPTY: group 2b registers S1 (virtual list), S2 (editor line index) and
 * S7 (weighted pick) against the frozen shape below (RESEARCH section 4.2).
 *
 * SCENARIO shape (validateScenario, fail closed, every error names the field):
 *   a plain object (own keys only, no Symbol keys): { id: /^S\d+$/, title: non-empty string,
 *     adapters: non-empty string[] (registered adapter or RIVAL_SLOTS names), sizes: non-empty
 *     int[] (each in [1, 2^20]), build(adapter, n, seed) -> { phases: [{ name:
 *     'seek'|'splice'|'blend', script: Int32Array, run(handle, script) }] } }
 * build() runs cold and precomputes every op argument into the phase's Int32Array script; run()
 * is the timed loop and holds no PRNG, no float and no allocation (benchmark/METHODOLOGY.md
 * "Determinism"). validateBuilt checks a build() result.
 * ASCII only.
 */

import { isPlain, didYouMean, ADAPTERS, RIVAL_SLOTS } from './Adapters.mjs';

export const SCENARIOS = [];

/** Largest scenario size: the bench law keeps measures <= 255 so totals stay < 2^28 at n = 2^20. */
export const MAX_SIZE = 1 << 20;

export const PHASES = Object.freeze(['seek', 'splice', 'blend']);
const SCENARIO_KEYS = ['id', 'title', 'adapters', 'sizes', 'build'];

function scFail(where, detail) {
    throw new Error('[bench] scenario ' + where + ': ' + detail);
}

/** Fail-closed shape check of one registry entry. Returns it. */
export function validateScenario(s) {
    // own keys only: a plain object (no prototype keys, no Symbol keys, not an array)
    if (!isPlain(s)) scFail('(root)', 'must be a plain object');
    for (const k of Object.keys(s)) {
        if (!SCENARIO_KEYS.includes(k)) scFail(k, 'unknown key' + didYouMean(k, SCENARIO_KEYS));
    }
    if (typeof s.id !== 'string' || !/^S\d+$/.test(s.id)) scFail('id', 'must match S<digits>');
    if (typeof s.title !== 'string' || s.title.length === 0) scFail(s.id + '.title', 'must be a non-empty string');
    if (!Array.isArray(s.adapters) || s.adapters.length === 0) scFail(s.id + '.adapters', 'must be a non-empty array');
    for (const a of s.adapters) {
        if (typeof a !== 'string' || a.length === 0) scFail(s.id + '.adapters', 'entries must be adapter names');
        const known = ADAPTERS.map((x) => x.name).concat(Object.keys(RIVAL_SLOTS));
        if (!known.includes(a)) scFail(s.id + '.adapters', "unknown adapter '" + a + "'" + didYouMean(a, known));
    }
    if (!Array.isArray(s.sizes) || s.sizes.length === 0) scFail(s.id + '.sizes', 'must be a non-empty array');
    for (const n of s.sizes) {
        if (!Number.isInteger(n) || n < 1 || n > MAX_SIZE) scFail(s.id + '.sizes', 'entries must be integers in [1, 2^20]');
    }
    if (typeof s.build !== 'function') scFail(s.id + '.build', 'must be a function');
    return s;
}

/** Fail-closed check of one build(adapter, n, seed) result. Returns it. */
export function validateBuilt(id, built) {
    if (built === null || typeof built !== 'object' || !Array.isArray(built.phases) || built.phases.length === 0) {
        scFail(id + '.build()', 'must return { phases: [...] } with at least one phase');
    }
    for (let j = 0; j < built.phases.length; j++) {
        const p = built.phases[j];
        const w = id + '.phases[' + j + ']';
        if (p === null || typeof p !== 'object') scFail(w, 'must be an object');
        if (!PHASES.includes(p.name)) scFail(w + '.name', 'must be one of ' + PHASES.join(' | '));
        if (!(p.script instanceof Int32Array) || p.script.length === 0) scFail(w + '.script', 'must be a non-empty Int32Array');
        if (typeof p.run !== 'function') scFail(w + '.run', 'must be a function');
    }
    return built;
}

/** The registered scenario by id; an unknown id throws "unknown scenario <id>". */
export function selectScenario(id) {
    for (const s of SCENARIOS) if (s.id === id) return validateScenario(s);
    throw new Error('unknown scenario ' + String(id));
}
