// Type declarations for @zakkster/lite-yggdrasil (rung A-R1a: constructor, arena, pools, counters; no ops yet).
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
  /** Total of dimension d (0 <= d < dims). */
  total(d: number): number;
  clear(): this;
  /** Copy the 12 counters into out (length >= 12). */
  readCounters(out: Int32Array): void;
  resetCounters(): void;
}
