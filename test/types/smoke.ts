/**
 * @zakkster/lite-yggdrasil -- ambient type smoke test (tsc -p test/types/tsconfig.json).
 *
 * Exports: `VERSION` and `SumSequence` (rung A-R1a surface). ASCII-only.
 */

import { VERSION, SumSequence } from '../../Yggdrasil.js';

// VERSION is a string.
const v: string = VERSION;
void v;

// @ts-expect-error -- VERSION is not a number.
const n: number = VERSION;
void n;

// SumSequence: construct, arena, COUNTERS, readCounters.
const seq: SumSequence = new SumSequence(64, { dims: 2, leafSize: 16 });
const views: SumSequence[] = SumSequence.arena(64, undefined, 3);
const ti: 0 = SumSequence.COUNTERS.touches;
const cap: number = seq.capacity + views.length + ti + seq.total(0);
void cap;
seq.readCounters(new Int32Array(12));

// @ts-expect-error -- dims is 1..4.
const bad = new SumSequence(64, { dims: 5 });
void bad;
