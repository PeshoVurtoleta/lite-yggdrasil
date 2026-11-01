/**
 * @zakkster/lite-yggdrasil -- the shared loop of the inlining-budget-diff.sh drivers (unrolled.mjs / plain.mjs).
 *
 * MIT (c) Zahary Shinikchiev <shinikchiev@yahoo.com>
 *
 * Repo-only. Bench-ADOPT g2b-3a TASK 2 (.handoff/PLAN-bench-adopt-g2b3a.md; RESEARCH 12.3, the unroll
 * hypothesis; SPEC-bench-adopt BA-9: every timing REPORTED). Driver mode of
 * LiteUtils/inlining-budget-diff.sh runs `node --trace-opt --trace-turbo-inlining <driver>` (or the
 * Maglev flag) from the driver's own directory and needs exit 0:
 *
 *     inlining-budget-diff.sh --fn _locate,indexAtSum benchmark/inl/unrolled.mjs benchmark/inl/plain.mjs
 *
 * drive(name) loads the BlockedArray variant (benchmark/rivals/variant.mjs loadVariant), builds it at
 * capacity 65537, dims 1, the class default chunkCap, fills FILL rows untimed, then runs OPS seeded
 * iterations: one indexAtSum per iteration, plus an insertAt on even and a removeAt (after a
 * getMeasure) on odd iterations, so _locate and indexAtSum both tier up. It prints one line
 * 'inl checksum <hex> length <n> sum <s>' (identical for every variant: the variants differ only in
 * loop shape) and returns. A throw exits non-zero, which the script reads as NO-VERDICT.
 * Not a timed lane: the prng's uint32 draws may box; both drivers run the identical loop. ASCII only.
 */

import { loadVariant } from '../rivals/variant.mjs';
import { prng } from '../Harness.mjs';

export const CAPACITY = 65537;
export const FILL = 32768;
export const OPS = 200000;
export const SEED = 0x5EED1234;

export async function drive(name) {
    const { BlockedArray } = await loadVariant(name);
    const ba = new BlockedArray(CAPACITY, 1);
    const next = prng(SEED);
    let sum = 0;
    for (let i = 0; i < FILL; i++) {
        const m = 1 + (next() & 0xFF) % 255;
        ba.insertAt(i, i & 0x3FFFFFFF, m);
        sum += m;
    }
    let acc = 0;
    for (let i = 0; i < OPS; i++) {
        const idx = ba.indexAtSum(0, next() % sum);
        acc = (Math.imul(acc, 31) + idx) | 0;
        if ((i & 1) === 0) {
            const m = 1 + (next() & 0xFF) % 255;
            ba.insertAt(next() % (ba.length + 1), i & 0x3FFFFFFF, m);
            sum += m;
        } else {
            const at = next() % ba.length;
            sum -= ba.getMeasure(at, 0);
            ba.removeAt(at);
        }
    }
    console.log('inl checksum ' + (acc >>> 0).toString(16) + ' length ' + ba.length + ' sum ' + sum);
}
