// Type declarations for @zakkster/lite-yggdrasil (rung K-R2: the cursor surface (cursor(), seekIndex / seekSum / next, valid / index / entity, offset / measure) on top of rung F-R: constructor, arena, pools, counters, positional ops and seeks on a multi-leaf trunk with splits, rotations and the remove side: merge, equalize and drain, the k >= 2 clear() free-walk, join and append with the seam repair, splitAt with its seam repairs, and the finger hit test in the positional ops).
export declare const VERSION: string;

export interface SumSequenceOptions {
  /** Measure dimensions per element, 1..4. Default 1. */
  dims?: 1 | 2 | 3 | 4;
  /** Leaf size B. 4 and 8 are test-only. Default 16. */
  leafSize?: 4 | 8 | 16 | 32;
}

/**
 * A reusable cursor over one SumSequence view (type-only; the class is not exported).
 * valid is false until a seek lands on an element, and after a seek to the end or on an empty view.
 */
export interface SumCursor {
  /** true while the cursor sits on an element; false for a fresh cursor, a seek to the end, an empty view. */
  readonly valid: boolean;
  /** Index of the current element; -1 when not valid. */
  readonly index: number;
  /** Entity of the current element; -1 when not valid. */
  readonly entity: number;
  /** Sum of dimension d over the elements before the current one. O(1); NaN when not valid. RangeError 'dim' (d integer in [0, dims)) is checked first, valid or not. Returns a boxed double. */
  offset(d: number): number;
  /** Measure d of the current element; NaN when not valid. RangeError 'dim' is checked first, valid or not. Returns a boxed double. */
  measure(d: number): number;
  /**
   * Move to index i in [0, length]; returns true when it lands on an element.
   * i = length (or an empty view) returns false and leaves valid false (index -1); the seek still counts touches d(t) (0 on an empty view).
   * RangeError 'index' (i not an integer in [0, length], e.g. -1 or NaN) leaves the cursor unchanged.
   */
  seekIndex(i: number): boolean;
  /**
   * Move to the smallest index with prefix(i) + measure(i) > y in dimension d; returns true when it lands on an element.
   * y >= total(d) (or an empty view) returns false and leaves valid false (index -1); the seek still counts touches d(t) (0 on an empty view).
   * RangeError 'dim' (d), then 'seek' (y not finite or < 0, e.g. -1 or NaN) leaves the cursor unchanged.
   */
  seekSum(d: number, y: number): boolean;
  /**
   * Step to the next element and return the new valid: true inside a leaf (0 touches) or across a leaf boundary
   * (touches the nodes pushed below the lowest common ancestor); stepping off the last element returns false and
   * leaves valid false (index -1). On an invalid cursor it returns false and changes nothing (no field, no counter).
   * Takes no argument; never writes the finger and adds no finger hit or miss.
   */
  next(): boolean;
}

export declare class SumSequence {
  /**
   * Fixed capacity C (arena-wide); C <= 2^28 - (leafSize / 4) * count, and the typed arrays of the arena total
   * <= 2^32 bytes. Either cap failing throws RangeError 'capacity' before anything is allocated.
   */
  constructor(capacity: number, options?: SumSequenceOptions);
  /** count views sharing one arena of capacity C; count in 1..min(C, 4096); the constructor's caps apply. */
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
  /** The view's one cursor (the same object on every call; allocates nothing). Not valid until a seek lands on an element; every successful mutation of this view (and append() for the other view too) leaves it invalid. */
  cursor(): SumCursor;
  /** Copy the 12 counters into out (length >= 12). */
  readCounters(out: Int32Array): void;
  resetCounters(): void;
}
