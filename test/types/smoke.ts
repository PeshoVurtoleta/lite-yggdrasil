/**
 * @zakkster/lite-yggdrasil -- ambient type smoke test (tsc -p test/types/tsconfig.json).
 *
 * Exports: `VERSION` and `SumSequence` (rung A-R1b surface). ASCII-only.
 */

import { VERSION, SumSequence } from '../../Yggdrasil.js';
import type { SumCursor } from '../../Yggdrasil.js';

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

// One-leaf ops (rung A-R1b): right types, then one wrong argument type per method.
seq.insertAt(0, 7, 5, 6);
const r1: number = seq.removeAt(0);
seq.setMeasure(0, 0, 1);
const r2: number = seq.getMeasure(0, 0);
const r3: number = seq.entityAt(0);
const r4: number = seq.indexAtSum(0, 1.5);
const r5: number = seq.sumBefore(0, 0);
void (r1 + r2 + r3 + r4 + r5);

// @ts-expect-error -- insertAt takes a numeric index.
seq.insertAt('0', 7, 5);
// @ts-expect-error -- removeAt takes a numeric index.
seq.removeAt('0');
// @ts-expect-error -- setMeasure takes a numeric measure.
seq.setMeasure(0, 0, '1');
// @ts-expect-error -- getMeasure takes a numeric dim.
seq.getMeasure(0, '0');
// @ts-expect-error -- entityAt takes a numeric index.
seq.entityAt('0');
// @ts-expect-error -- indexAtSum takes a numeric y.
seq.indexAtSum(0, '1');
// @ts-expect-error -- sumBefore takes a numeric index.
seq.sumBefore(0, '0');

// append (rung S-R2): takes a view of the same arena, returns this.
const ap: SumSequence = views[0].append(views[1]);
void ap;

// @ts-expect-error -- append takes a view.
views[0].append(5);

// splitAt (rung S-R3): takes an index and an empty view of the same arena, returns this.
const sp: SumSequence = views[0].splitAt(0, views[1]);
void sp;

// @ts-expect-error -- splitAt takes a view as out.
views[0].splitAt(0, 5);

// cursor (rung K-R2): seek, next, read the fields, offset / measure; valid is readonly.
const cur: SumCursor = views[0].cursor();
const cs1: boolean = cur.seekIndex(0);
const cs2: boolean = cur.seekSum(0, 1);
const cf: boolean = cur.valid;
const ci: number = cur.index;
const ce: number = cur.entity;
const co: number = cur.offset(0);
const cm: number = cur.measure(0);
const cn: boolean = cur.next();
void (cs1 && cs2 && cn && cf && ci + ce + co + cm);

// @ts-expect-error -- valid is readonly.
cur.valid = true;
// @ts-expect-error -- next takes no argument.
cur.next(1);
// @ts-expect-error -- seekIndex takes a numeric index.
cur.seekIndex('0');
