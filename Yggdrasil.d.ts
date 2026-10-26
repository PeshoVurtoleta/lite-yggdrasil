// Type declarations for @zakkster/lite-yggdrasil (rung F-R: constructor, arena, pools, counters, positional ops and seeks on a multi-leaf trunk with splits, rotations and the remove side: merge, equalize and drain, the k >= 2 clear() free-walk, join and append with the seam repair, splitAt with its seam repairs, and the finger hit test in the positional ops).
export declare const VERSION: string;

export interface SumSequenceOptions {
  /** Measure dimensions per element, 1..4. Default 1. */
  dims?: 1 | 2 | 3 | 4;
  /** Leaf size B. 4 and 8 are test-only. Default 16. */
  leafSize?: 4 | 8 | 16 | 32;
}

export declare class SumSequence {
  /** Fixed capacity C (arena-wide); C <= 2^28 - (leafSize / 4) * count. */
  constructor(capacity: number, options?: SumSequenceOptions);
  /** count views sharing one arena of capacity C; count in 1..min(C, 4096). */
  static arena(capacity: number, options: SumSequenceOptions | undefined, count: number): SumSequence[];
  /** Index of each counter in readCounters(out). */
  static readonly COUNTERS: Readonly<{
    touches: 0; pulls: 1; moves: 2; splits: 3; merges: 4; equalizes: 5;
    rotSingle: 6; rotDouble: 7; fingerHits: 8; fingerMisses: 9; joinSteps: 10; seamRepairs: 11;
  }>;
  readonly length: number;
  readonly capacity: number;
  readonly available: number;
  /** Total of dimension d (0 <= d < dims). O(1). */
  total(d: number): number;
  /**
   * Insert entity e at index i in [0, length] with measures m0 (and m1..m3 for dims > 1).
   * Entity range [0, 2^30 - 1]; measure range [0, 2^53 - 1] integers; slots >= dims must be undefined.
   * RangeError (first token index / entity / measure / extra / capacity / headroom) leaves the sequence unchanged.
   */
  insertAt(i: number, e: number, m0: number, m1?: number, m2?: number, m3?: number): void;
  /** Remove and return the entity at index i in [0, length). */
  removeAt(i: number): number;
  /** Set measure d of the element at index i in [0, length) to m (integer in [0, 2^53 - 1]). */
  setMeasure(i: number, d: number, m: number): void;
  /** Measure d of the element at index i in [0, length). */
  getMeasure(i: number, d: number): number;
  /** Entity at index i in [0, length). */
  entityAt(i: number): number;
  /** Smallest index i with prefix(i) + measure(i) > y in dimension d, else length. y finite, >= 0. */
  indexAtSum(d: number, y: number): number;
  /** Sum of dimension d over elements [0, i), i in [0, length]. */
  sumBefore(d: number, i: number): number;
  clear(): this;
  /** this := this ++ other (a view of the same arena), other := empty; returns this. RangeError operand / headroom / pool leaves both views unchanged. */
  append(other: SumSequence): this;
  /** this := [0, i), out := [i, length) (an empty view of the same arena); returns this. RangeError index / operand / pool leaves both views unchanged. */
  splitAt(i: number, out: SumSequence): this;
  /** Copy the 12 counters into out (length >= 12). */
  readCounters(out: Int32Array): void;
  resetCounters(): void;
}
