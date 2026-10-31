/**
 * BlockedArray -- Stride-1 Sqrt-Decomposition Rival for SumSequence (RESEARCH.md 4.1 / B-31, 12.3).
 *
 * MIT (c) Zahary Shinikchiev <shinikchiev@yahoo.com>
 *
 * Benchmark-only rival (repo-only, never in package.json files[]). Moved from researchNotes/BlockedArray.md
 * (frozen copy: .handoff/bench-adopt/before/draft.js); group 2a TASKS 1-2 of .handoff/PLAN-bench-adopt-g2a.md.
 *
 * Fair-rival invariants:
 *  - 0 B/op on steady-state hot paths (flat 1D TypedArrays, copyWithin memmove, zero .subarray()).
 *    A query that returns a computed double (sumBefore, total, getMeasure, cursor offset / measure)
 *    boxes once per call when it is not inlined, the same lane as the engine's.
 *  - Directory-aligned SoA columns (dirSize, dirSums) for 4x-unrolled stride-1 Dongarra loops
 *    (_locate, indexAtSum; sumBefore is a plain loop). benchmark/rivals/variant.mjs builds the
 *    'plain' variant from this file by count-checked text replacement.
 *  - Chunk-level hysteresis: split at B, merge/equalize below B/4 (never exhausts chunk pool).
 *  - Shared-arena views (BlockedArray.arena) for fair O(n/B + B) splitAt / append on S2.
 *  - Fail-closed validation matching @zakkster/lite-yggdrasil v0.1.1 domains: every RangeError
 *    message starts with the engine's check token and a space; every throw goes through the one
 *    cold baFail(token, detail). No string is built on a hot path.
 *  - One preallocated cursor per view (cursor()); every successful mutator leaves it invalid
 *    after its checks, as test/oracle.mjs does (K-R1, 0005 C-6).
 */

const MAX_SAFE   = 9007199254740991; // 2^53 - 1
const MAX_ENTITY = 0x3FFFFFFF;       // 2^30 - 1

const C_DIR_SCANS    = 0; // chunk directory entries inspected (locate / seek / splitAt / cursor chunk step)
const C_ELEM_SCANS   = 1; // intra-chunk elements inspected (seek / split sum / equalize sum)
const C_ELEM_MOVES   = 2; // elements shifted or copied (insert / remove / split / merge / equalize)
const C_DIR_MOVES    = 3; // directory entries shifted (split / merge / splitAt / append)
const C_SPLITS       = 4; // chunk splits
const C_MERGES       = 5; // chunk merges
const C_EQUALIZES    = 6; // chunk equalizations (borrow)
const C_SEAM_REPAIRS = 7; // splitAt / append boundary chunk repairs

// Cursor state slots (Int32Array(4)).
const CU_DIR   = 0; // directory index of the current chunk
const CU_LOCAL = 1; // index inside that chunk
const CU_INDEX = 2; // global index
const CU_CHUNK = 3; // pool chunk id (dir[CU_DIR])

// Module-private key: only arena() builds a view on a shared arena, only a view builds its cursor.
const BA_KEY = Symbol('BlockedArray key');

// The one cold throw. token = the engine's check token (index, entity, dim, measure, extra,
// capacity, headroom, seek, operand, ...); the message is token + ' ' + detail, never an argument.
function baFail(token, detail) {
  throw new RangeError(token + ' ' + detail);
}

// Default chunkCap: max(16, ceil(sqrt(capacity))) rounded up to a multiple of 4.
function baDefaultChunkCap(capacity) {
  const raw = Math.max(16, Math.ceil(Math.sqrt(capacity)));
  return (raw + 3) & ~3;
}

// Pool chunk count: ceil(capacity / (chunkCap / 4)) + 2 x views + 4.
function baMaxChunks(capacity, chunkCap, views) {
  return Math.ceil(capacity / (chunkCap >>> 2)) + views * 2 + 4;
}

function baCheckCapacity(capacity) {
  if (typeof capacity !== 'number' || (capacity | 0) !== capacity || capacity < 1) {
    baFail('capacity', 'must be an integer >= 1');
  }
}

function baCheckChunkCap(chunkCap) {
  if (typeof chunkCap !== 'number' || (chunkCap | 0) !== chunkCap || chunkCap < 8 || (chunkCap & 3) !== 0) {
    baFail('chunkCap', 'must be an integer multiple of 4 >= 8');
  }
}

function baCheckViews(count) {
  if (typeof count !== 'number' || (count | 0) !== count || count < 1 || count > 4096) {
    baFail('count', 'must be an integer in [1, 4096]');
  }
}

export class BlockedArray {
  static COUNTERS = Object.freeze({
    dirScans:    C_DIR_SCANS,
    elemScans:   C_ELEM_SCANS,
    elemMoves:   C_ELEM_MOVES,
    dirMoves:    C_DIR_MOVES,
    splits:      C_SPLITS,
    merges:      C_MERGES,
    equalizes:   C_EQUALIZES,
    seamRepairs: C_SEAM_REPAIRS,
  });

  /**
   * Engine counter name (SumSequence.COUNTERS) -> the native counter it pairs with, or 'n/a'
   * (RESEARCH 11.6 / 12.3: dirScans <-> touches and elemMoves <-> moves only). Every native
   * counter keeps its own column; same-named native counters (splits, merges, ...) are NOT
   * the engine's (chunk events, not tree events), so they map to 'n/a' here.
   */
  static COUNTER_MAP = Object.freeze({
    touches:      'dirScans',
    pulls:        'n/a',
    moves:        'elemMoves',
    splits:       'n/a',
    merges:       'n/a',
    equalizes:    'n/a',
    rotSingle:    'n/a',
    rotDouble:    'n/a',
    fingerHits:   'n/a',
    fingerMisses: 'n/a',
    joinSteps:    'n/a',
    seamRepairs:  'n/a',
  });

  /**
   * Pool element slots for an arena: maxChunks x chunkCap, maxChunks = ceil(C / (chunkCap / 4))
   * + 2 x views + 4 (RESEARCH 12.3). chunkCap 0 (or undefined) = the default for C.
   * spaceSlots(32, 32, 1) = 10 x 32 = 320; spaceSlots(32, 32, 3) = 14 x 32 = 448;
   * spaceSlots(1e6, 0, 1) = 4006 x 1000 = 4,006,000.
   */
  static spaceSlots(capacity, chunkCap = 0, views = 1) {
    baCheckCapacity(capacity);
    baCheckViews(views);
    let cc = chunkCap;
    if (cc === 0 || cc === undefined) cc = baDefaultChunkCap(capacity);
    else baCheckChunkCap(cc);
    return baMaxChunks(capacity, cc, views) * cc;
  }

  /**
   * Computes exact bytes moved from a counter snapshot (0 hot-path overhead).
   * - Each elemMove shifts: 4B (Int32 entity) + 8B * dims (Float64 measures)
   * - Each dirMove shifts:  4B (Int32 dir) + 4B (Int32 dirSize) + 8B * dims (Float64 dirSums)
   */
  static bytesMovedFromCounts(counters, dims) {
    const elemBytesPerMove = 4 + 8 * dims;
    const dirBytesPerMove  = 8 + 8 * dims;
    const elemMoves = counters[C_ELEM_MOVES] >>> 0;
    const dirMoves  = counters[C_DIR_MOVES] >>> 0;
    return elemMoves * elemBytesPerMove + dirMoves * dirBytesPerMove;
  }

  /**
   * Shared-arena factory matching SumSequence.arena(capacity, options, count).
   */
  static arena(capacity, options, count = 1) {
    baCheckViews(count);
    const shared = BlockedArray._createArena(capacity, options, count);
    const views = new Array(count);
    for (let i = 0; i < count; i++) {
      views[i] = new BlockedArray(shared, BA_KEY);
    }
    return views;
  }

  static _createArena(capacity, options, viewCount) {
    baCheckCapacity(capacity);
    let dims = 1;
    let chunkCap = 0;
    if (options !== undefined) {
      if (typeof options === 'number') {
        dims = options;
      } else if (options !== null && typeof options === 'object' && !Array.isArray(options)) {
        if (options.dims !== undefined) dims = options.dims;
        if (options.chunkCap !== undefined) chunkCap = options.chunkCap;
      } else {
        baFail('options', 'must be a plain object');
      }
    }
    if (typeof dims !== 'number' || (dims | 0) !== dims || dims < 1 || dims > 4) {
      baFail('dims', 'must be an integer in [1, 4]');
    }
    if (chunkCap === 0) {
      chunkCap = baDefaultChunkCap(capacity);
    } else {
      baCheckChunkCap(chunkCap);
    }

    const minOcc = chunkCap >>> 2;
    const maxChunks = baMaxChunks(capacity, chunkCap, viewCount);

    const freeList = new Int32Array(maxChunks);
    for (let i = 0; i < maxChunks; i++) freeList[i] = maxChunks - 1 - i;

    return {
      capacity: capacity | 0,
      dims: dims | 0,
      chunkCap: chunkCap | 0,
      minOcc: minOcc | 0,
      maxChunks: maxChunks | 0,
      views: viewCount | 0,
      liveElements: 0,
      freeList,
      freeTop: maxChunks | 0,
      poolEntities: new Int32Array(maxChunks * chunkCap),
      poolMeasures: new Float64Array(dims * maxChunks * chunkCap),
    };
  }

  constructor(capacity, options, chunkCapOverride = 0) {
    let shared;
    if (options === BA_KEY) {
      shared = capacity;
    } else {
      const opts = typeof options === 'number'
              ? { dims: options, chunkCap: chunkCapOverride }
              : options;
      shared = BlockedArray._createArena(capacity, opts, 1);
    }

    this._arena = shared;
    this.capacity = shared.capacity;
    this.dims = shared.dims;
    this.chunkCap = shared.chunkCap;
    this._minOcc = shared.minOcc;
    this.maxChunks = shared.maxChunks;

    this.dir = new Int32Array(this.maxChunks);
    this.dirSize = new Int32Array(this.maxChunks);
    this.dirSums = new Float64Array(this.dims * this.maxChunks);
    this.dirLen = 0;

    this._len = 0;
    this.totals = new Float64Array(this.dims);

    this._locDir = 0;
    this._locLocal = 0;

    this._n = new Int32Array(8);

    this._cv = false; // cursor valid (K-R1): every successful mutator writes false after its checks
    this._cur = new BlockedCursor(this, BA_KEY);
  }

  get length() {
    return this._len;
  }

  get available() {
    return this._arena.capacity - this._arena.liveElements;
  }

  /** The view's one cursor (the same object on every call; allocates nothing). */
  cursor() {
    return this._cur;
  }

  /**
   * Bytes of every typed array the WHOLE arena holds: the shared pool (entities, measures,
   * free list) plus views x one view's directory, totals, counters and cursor state (every
   * view of an arena has the same sizes). Cold; the same number on every view of one arena.
   */
  bytes() {
    const a = this._arena;
    const c = this._cur;
    const pool = a.poolEntities.byteLength + a.poolMeasures.byteLength + a.freeList.byteLength;
    const view = this.dir.byteLength + this.dirSize.byteLength + this.dirSums.byteLength +
      this.totals.byteLength + this._n.byteLength + c._st.byteLength + c._off.byteLength;
    return pool + a.views * view;
  }

  readCounters(out) {
    if (!(out instanceof Int32Array) || out.length < 8) {
      baFail('counters', 'must be an Int32Array of length >= 8');
    }
    out.set(this._n);
    return out;
  }

  resetCounters() {
    this._n.fill(0);
  }

  bytesMoved() {
    return BlockedArray.bytesMovedFromCounts(this._n, this.dims);
  }

  /**
   * Diagnostic inspector for end-of-cell hysteresis evaluation (Point 5).
   * Never called on the hot path.
   */
  occupancyStats() {
    const k = this.dirLen;
    if (k === 0) {
      return {
        chunks: 0,
        chunkCap: this.chunkCap,
        minOcc: this._minOcc,
        min: 0,
        max: 0,
        avg: 0,
        stddev: 0,
        fillRatio: 0,
        underflowCount: 0,
      };
    }
    let min = this.chunkCap + 1;
    let max = -1;
    let sum = 0;
    let underflowCount = 0;
    for (let i = 0; i < k; i++) {
      const sz = this.dirSize[i];
      if (sz < min) min = sz;
      if (sz > max) max = sz;
      if (k > 1 && sz < this._minOcc) underflowCount++;
      sum += sz;
    }
    const avg = sum / k;
    let sqDiff = 0;
    for (let i = 0; i < k; i++) {
      const d = this.dirSize[i] - avg;
      sqDiff += d * d;
    }
    return {
      chunks: k,
      chunkCap: this.chunkCap,
      minOcc: this._minOcc,
      min,
      max,
      avg,
      stddev: Math.sqrt(sqDiff / k),
      fillRatio: avg / this.chunkCap,
      underflowCount,
    };
  }

  _allocChunk() {
    const a = this._arena;
    if (a.freeTop === 0) baFail('pool', 'chunk pool exhausted');
    return a.freeList[--a.freeTop];
  }

  _freeChunk(cIdx) {
    const a = this._arena;
    a.freeList[a.freeTop++] = cIdx;
  }

  clear() {
    this._cv = false;
    const a = this._arena;
    for (let i = 0; i < this.dirLen; i++) {
      a.freeList[a.freeTop++] = this.dir[i];
    }
    a.liveElements -= this._len;
    this.dirLen = 0;
    this._len = 0;
    this.totals.fill(0);
    return this;
  }

  total(d) {
    if (typeof d !== 'number' || (d | 0) !== d || d < 0 || d >= this.dims) {
      baFail('dim', 'out of range');
    }
    return this.totals[d];
  }

  // -- Dongarra Stride-1 Directory Locate (4x Unrolled) -----------------

  _locate(globalIndex) {
    const dirSize = this.dirSize;
    const n = this.dirLen;
    let dirIdx = 0;
    let rem = globalIndex;

    const n4 = n - 3;
    while (dirIdx < n4) {
      const s0 = dirSize[dirIdx];
      if (rem < s0) { this._n[C_DIR_SCANS] = (this._n[C_DIR_SCANS] + dirIdx + 1) | 0; this._locDir = dirIdx; this._locLocal = rem; return; }
      rem -= s0;

      const s1 = dirSize[dirIdx + 1];
      if (rem < s1) { this._n[C_DIR_SCANS] = (this._n[C_DIR_SCANS] + dirIdx + 2) | 0; this._locDir = dirIdx + 1; this._locLocal = rem; return; }
      rem -= s1;

      const s2 = dirSize[dirIdx + 2];
      if (rem < s2) { this._n[C_DIR_SCANS] = (this._n[C_DIR_SCANS] + dirIdx + 3) | 0; this._locDir = dirIdx + 2; this._locLocal = rem; return; }
      rem -= s2;

      const s3 = dirSize[dirIdx + 3];
      if (rem < s3) { this._n[C_DIR_SCANS] = (this._n[C_DIR_SCANS] + dirIdx + 4) | 0; this._locDir = dirIdx + 3; this._locLocal = rem; return; }
      rem -= s3;

      dirIdx += 4;
    }

    while (dirIdx < n) {
      const sz = dirSize[dirIdx];
      if (rem < sz) {
        this._n[C_DIR_SCANS] = (this._n[C_DIR_SCANS] + dirIdx + 1) | 0;
        this._locDir = dirIdx;
        this._locLocal = rem;
        return;
      }
      rem -= sz;
      dirIdx++;
    }

    this._n[C_DIR_SCANS] = (this._n[C_DIR_SCANS] + n) | 0;
    this._locDir = n;
    this._locLocal = rem;
  }

  // -- Reads & Seeks (Stride-1 Dongarra Loops) --------------------------

  entityAt(globalIndex) {
    if (typeof globalIndex !== 'number' || (globalIndex | 0) !== globalIndex || globalIndex < 0 || globalIndex >= this._len) {
      baFail('index', 'out of range');
    }
    this._locate(globalIndex);
    const cIdx = this.dir[this._locDir];
    return this._arena.poolEntities[cIdx * this.chunkCap + this._locLocal];
  }

  getMeasure(globalIndex, dim) {
    if (typeof globalIndex !== 'number' || (globalIndex | 0) !== globalIndex || globalIndex < 0 || globalIndex >= this._len) {
      baFail('index', 'out of range');
    }
    if (typeof dim !== 'number' || (dim | 0) !== dim || dim < 0 || dim >= this.dims) {
      baFail('dim', 'out of range');
    }
    this._locate(globalIndex);
    const cIdx = this.dir[this._locDir];
    return this._arena.poolMeasures[(dim * this.maxChunks + cIdx) * this.chunkCap + this._locLocal];
  }

  sumBefore(dim, globalIndex) {
    // Engine order (Yggdrasil.js sumBefore): index first, then dim.
    if (typeof globalIndex !== 'number' || (globalIndex | 0) !== globalIndex || globalIndex < 0 || globalIndex > this._len) {
      baFail('index', 'out of range');
    }
    if (typeof dim !== 'number' || (dim | 0) !== dim || dim < 0 || dim >= this.dims) {
      baFail('dim', 'out of range');
    }
    if (globalIndex === 0) return 0;
    if (globalIndex === this._len) return this.totals[dim];

    const dirSize = this.dirSize;
    const dirSums = this.dirSums;
    const sumBase = dim * this.maxChunks;
    let dirIdx = 0;
    let rem = globalIndex;
    let acc = 0;

    while (dirIdx < this.dirLen) {
      const sz = dirSize[dirIdx];
      if (rem < sz) break;
      rem -= sz;
      acc += dirSums[sumBase + dirIdx];
      dirIdx++;
    }
    this._n[C_DIR_SCANS] = (this._n[C_DIR_SCANS] + dirIdx + 1) | 0;

    if (rem > 0) {
      const cIdx = this.dir[dirIdx];
      const mArr = this._arena.poolMeasures;
      const mBase = (dim * this.maxChunks + cIdx) * this.chunkCap;
      for (let i = 0; i < rem; i++) {
        acc += mArr[mBase + i];
      }
      this._n[C_ELEM_SCANS] = (this._n[C_ELEM_SCANS] + rem) | 0;
    }
    return acc;
  }

  indexAtSum(dim, target) {
    if (typeof dim !== 'number' || (dim | 0) !== dim || dim < 0 || dim >= this.dims) {
      baFail('dim', 'out of range');
    }
    if (typeof target !== 'number' || !(target >= 0) || !Number.isFinite(target)) {
      baFail('seek', 'target must be a finite number >= 0');
    }
    if (target >= this.totals[dim]) {
      this._n[C_DIR_SCANS] = (this._n[C_DIR_SCANS] + this.dirLen) | 0;
      return this._len;
    }

    const dirSums = this.dirSums;
    const dirSize = this.dirSize;
    const sumBase = dim * this.maxChunks;
    const n = this.dirLen;
    let dirIdx = 0;
    let globalIdx = 0;
    let rem = target;

    const n4 = n - 3;
    while (dirIdx < n4) {
      const s0 = dirSums[sumBase + dirIdx];
      if (rem < s0) break;
      rem -= s0;
      globalIdx += dirSize[dirIdx];

      const s1 = dirSums[sumBase + dirIdx + 1];
      if (rem < s1) { dirIdx += 1; break; }
      rem -= s1;
      globalIdx += dirSize[dirIdx + 1];

      const s2 = dirSums[sumBase + dirIdx + 2];
      if (rem < s2) { dirIdx += 2; break; }
      rem -= s2;
      globalIdx += dirSize[dirIdx + 2];

      const s3 = dirSums[sumBase + dirIdx + 3];
      if (rem < s3) { dirIdx += 3; break; }
      rem -= s3;
      globalIdx += dirSize[dirIdx + 3];

      dirIdx += 4;
    }

    while (dirIdx < n) {
      const s = dirSums[sumBase + dirIdx];
      if (rem < s) break;
      rem -= s;
      globalIdx += dirSize[dirIdx];
      dirIdx++;
    }
    this._n[C_DIR_SCANS] = (this._n[C_DIR_SCANS] + dirIdx + 1) | 0;

    if (dirIdx >= n) return this._len;

    const cIdx = this.dir[dirIdx];
    const sz = dirSize[dirIdx];
    const mArr = this._arena.poolMeasures;
    const mBase = (dim * this.maxChunks + cIdx) * this.chunkCap;

    let local = 0;
    while (local < sz) {
      const m = mArr[mBase + local];
      if (m > rem) {
        this._n[C_ELEM_SCANS] = (this._n[C_ELEM_SCANS] + local + 1) | 0;
        return globalIdx + local;
      }
      rem -= m;
      local++;
    }
    this._n[C_ELEM_SCANS] = (this._n[C_ELEM_SCANS] + sz) | 0;
    return globalIdx + sz;
  }

  // -- Mutators ---------------------------------------------------------

  insertAt(globalIndex, entity, m0, m1, m2, m3) {
    if (typeof globalIndex !== 'number' || (globalIndex | 0) !== globalIndex || globalIndex < 0 || globalIndex > this._len) {
      baFail('index', 'out of range');
    }
    if (typeof entity !== 'number' || (entity & MAX_ENTITY) !== entity) {
      baFail('entity', 'must be an integer in [0, 2^30 - 1]');
    }
    const dims = this.dims;
    if (!Number.isSafeInteger(m0) || m0 < 0) baFail('measure', 'm0 must be a non-negative safe integer');
    if (dims >= 2 && (!Number.isSafeInteger(m1) || m1 < 0)) baFail('measure', 'm1 must be a non-negative safe integer');
    if (dims >= 3 && (!Number.isSafeInteger(m2) || m2 < 0)) baFail('measure', 'm2 must be a non-negative safe integer');
    if (dims >= 4 && (!Number.isSafeInteger(m3) || m3 < 0)) baFail('measure', 'm3 must be a non-negative safe integer');

    if (dims < 4 && m3 !== undefined) baFail('extra', 'measure slot m3 must be undefined');
    if (dims < 3 && m2 !== undefined) baFail('extra', 'measure slot m2 must be undefined');
    if (dims < 2 && m1 !== undefined) baFail('extra', 'measure slot m1 must be undefined');

    const a = this._arena;
    if (a.liveElements >= a.capacity) baFail('capacity', 'exceeded');

    if (this.totals[0] + m0 > MAX_SAFE) baFail('headroom', 'exceeded on dim 0');
    if (dims >= 2 && this.totals[1] + m1 > MAX_SAFE) baFail('headroom', 'exceeded on dim 1');
    if (dims >= 3 && this.totals[2] + m2 > MAX_SAFE) baFail('headroom', 'exceeded on dim 2');
    if (dims >= 4 && this.totals[3] + m3 > MAX_SAFE) baFail('headroom', 'exceeded on dim 3');

    this._cv = false;

    if (this.dirLen === 0) {
      this.dir[0] = this._allocChunk();
      this.dirSize[0] = 0;
      for (let d = 0; d < dims; d++) this.dirSums[d * this.maxChunks] = 0;
      this.dirLen = 1;
    }

    let dirIdx;
    let localIndex;

    if (globalIndex === this._len) {
      dirIdx = this.dirLen - 1;
      localIndex = this.dirSize[dirIdx];
      this._n[C_DIR_SCANS] = (this._n[C_DIR_SCANS] + 1) | 0;
    } else {
      this._locate(globalIndex);
      dirIdx = this._locDir;
      localIndex = this._locLocal;
    }

    const cIdx = this.dir[dirIdx];
    const sz = this.dirSize[dirIdx];
    const B = this.chunkCap;
    const maxC = this.maxChunks;
    const moves = sz - localIndex;

    if (moves > 0) {
      const eBase = cIdx * B;
      a.poolEntities.copyWithin(eBase + localIndex + 1, eBase + localIndex, eBase + sz);
      const mArr = a.poolMeasures;
      const mBase0 = cIdx * B;
      mArr.copyWithin(mBase0 + localIndex + 1, mBase0 + localIndex, mBase0 + sz);
      if (dims >= 2) { const b1 = (maxC + cIdx) * B; mArr.copyWithin(b1 + localIndex + 1, b1 + localIndex, b1 + sz); }
      if (dims >= 3) { const b2 = (2 * maxC + cIdx) * B; mArr.copyWithin(b2 + localIndex + 1, b2 + localIndex, b2 + sz); }
      if (dims >= 4) { const b3 = (3 * maxC + cIdx) * B; mArr.copyWithin(b3 + localIndex + 1, b3 + localIndex, b3 + sz); }
      this._n[C_ELEM_MOVES] = (this._n[C_ELEM_MOVES] + moves) | 0;
    }

    a.poolEntities[cIdx * B + localIndex] = entity | 0;
    const mArr = a.poolMeasures;
    mArr[cIdx * B + localIndex] = m0 + 0; // -0 -> +0 (0002 M-2)
    this.dirSums[dirIdx] += m0;
    this.totals[0] += m0;

    if (dims >= 2) { mArr[(maxC + cIdx) * B + localIndex] = m1 + 0; this.dirSums[maxC + dirIdx] += m1; this.totals[1] += m1; }
    if (dims >= 3) { mArr[(2 * maxC + cIdx) * B + localIndex] = m2 + 0; this.dirSums[2 * maxC + dirIdx] += m2; this.totals[2] += m2; }
    if (dims >= 4) { mArr[(3 * maxC + cIdx) * B + localIndex] = m3 + 0; this.dirSums[3 * maxC + dirIdx] += m3; this.totals[3] += m3; }

    const newSz = sz + 1;
    this.dirSize[dirIdx] = newSz;
    this._len++;
    a.liveElements++;

    if (newSz === B) {
      this._split(dirIdx);
    }
  }

  removeAt(globalIndex) {
    if (typeof globalIndex !== 'number' || (globalIndex | 0) !== globalIndex || globalIndex < 0 || globalIndex >= this._len) {
      baFail('index', 'out of range');
    }

    this._cv = false;

    this._locate(globalIndex);
    const dirIdx = this._locDir;
    const localIndex = this._locLocal;
    const cIdx = this.dir[dirIdx];
    const sz = this.dirSize[dirIdx];
    const B = this.chunkCap;
    const maxC = this.maxChunks;
    const dims = this.dims;
    const a = this._arena;

    const eBase = cIdx * B;
    const entity = a.poolEntities[eBase + localIndex];
    const mArr = a.poolMeasures;

    const m0 = mArr[eBase + localIndex];
    this.dirSums[dirIdx] -= m0;
    this.totals[0] -= m0;
    if (dims >= 2) { const v = mArr[(maxC + cIdx) * B + localIndex]; this.dirSums[maxC + dirIdx] -= v; this.totals[1] -= v; }
    if (dims >= 3) { const v = mArr[(2 * maxC + cIdx) * B + localIndex]; this.dirSums[2 * maxC + dirIdx] -= v; this.totals[2] -= v; }
    if (dims >= 4) { const v = mArr[(3 * maxC + cIdx) * B + localIndex]; this.dirSums[3 * maxC + dirIdx] -= v; this.totals[3] -= v; }

    const moves = sz - localIndex - 1;
    if (moves > 0) {
      a.poolEntities.copyWithin(eBase + localIndex, eBase + localIndex + 1, eBase + sz);
      mArr.copyWithin(eBase + localIndex, eBase + localIndex + 1, eBase + sz);
      if (dims >= 2) { const b1 = (maxC + cIdx) * B; mArr.copyWithin(b1 + localIndex, b1 + localIndex + 1, b1 + sz); }
      if (dims >= 3) { const b2 = (2 * maxC + cIdx) * B; mArr.copyWithin(b2 + localIndex, b2 + localIndex + 1, b2 + sz); }
      if (dims >= 4) { const b3 = (3 * maxC + cIdx) * B; mArr.copyWithin(b3 + localIndex, b3 + localIndex + 1, b3 + sz); }
      this._n[C_ELEM_MOVES] = (this._n[C_ELEM_MOVES] + moves) | 0;
    }

    const newSz = sz - 1;
    this.dirSize[dirIdx] = newSz;
    this._len--;
    a.liveElements--;

    if (this._len === 0) {
      this._freeChunk(cIdx);
      this.dirLen = 0;
    } else if (newSz < this._minOcc && this.dirLen > 1) {
      this._repairUnderflow(dirIdx);
    }

    return entity;
  }

  setMeasure(globalIndex, dim, value) {
    if (typeof globalIndex !== 'number' || (globalIndex | 0) !== globalIndex || globalIndex < 0 || globalIndex >= this._len) {
      baFail('index', 'out of range');
    }
    if (typeof dim !== 'number' || (dim | 0) !== dim || dim < 0 || dim >= this.dims) {
      baFail('dim', 'out of range');
    }
    if (!Number.isSafeInteger(value) || value < 0) {
      baFail('measure', 'must be a non-negative safe integer');
    }

    this._locate(globalIndex);
    const dirIdx = this._locDir;
    const cIdx = this.dir[dirIdx];
    const slot = (dim * this.maxChunks + cIdx) * this.chunkCap + this._locLocal;
    const mArr = this._arena.poolMeasures;

    const old = mArr[slot];
    const delta = value - old;
    if (this.totals[dim] + delta > MAX_SAFE) {
      baFail('headroom', 'exceeded');
    }

    this._cv = false;
    mArr[slot] = value + 0; // -0 -> +0 (0002 M-2)
    this.dirSums[dim * this.maxChunks + dirIdx] += delta;
    this.totals[dim] += delta;
  }

  // -- Shared-Arena Bulk Edits (S2 Cut / Paste) -------------------------

  splitAt(globalIndex, out) {
    if (typeof globalIndex !== 'number' || (globalIndex | 0) !== globalIndex || globalIndex < 0 || globalIndex > this._len) {
      baFail('index', 'out of range');
    }
    if (!(out instanceof BlockedArray) || out._arena !== this._arena || out === this || out._len !== 0) {
      baFail('operand', 'must be an empty BlockedArray view of the same arena');
    }
    this._cv = false;
    out._cv = false;
    if (globalIndex === this._len) return this;
    if (globalIndex === 0) {
      const n = this.dirLen;
      for (let i = 0; i < n; i++) {
        out.dir[i] = this.dir[i];
        out.dirSize[i] = this.dirSize[i];
      }
      for (let d = 0; d < this.dims; d++) {
        const base = d * this.maxChunks;
        for (let i = 0; i < n; i++) {
          out.dirSums[base + i] = this.dirSums[base + i];
        }
        out.totals[d] = this.totals[d];
        this.totals[d] = 0;
      }
      out.dirLen = n;
      out._len = this._len;
      this.dirLen = 0;
      this._len = 0;
      this._n[C_DIR_MOVES] = (this._n[C_DIR_MOVES] + n) | 0;
      return this;
    }

    this._locate(globalIndex);
    let splitDir = this._locDir;
    const localIndex = this._locLocal;
    const B = this.chunkCap;
    const maxC = this.maxChunks;
    const dims = this.dims;
    const a = this._arena;

    if (localIndex > 0) {
      const leftCIdx = this.dir[splitDir];
      const rightCIdx = this._allocChunk();
      const sz = this.dirSize[splitDir];
      const rightSz = sz - localIndex;

      a.poolEntities.copyWithin(rightCIdx * B, leftCIdx * B + localIndex, leftCIdx * B + sz);
      for (let d = 0; d < dims; d++) {
        const dOff = d * maxC;
        const lBase = (dOff + leftCIdx) * B;
        const rBase = (dOff + rightCIdx) * B;
        a.poolMeasures.copyWithin(rBase, lBase + localIndex, lBase + sz);

        let rSum = 0;
        for (let i = 0; i < rightSz; i++) rSum += a.poolMeasures[rBase + i];
        this.dirSums[dOff + splitDir] -= rSum;
        out.dirSums[dOff] = rSum;
      }
      this.dirSize[splitDir] = localIndex;
      out.dir[0] = rightCIdx;
      out.dirSize[0] = rightSz;
      out.dirLen = 1;
      splitDir++;
      this._n[C_ELEM_MOVES] = (this._n[C_ELEM_MOVES] + rightSz) | 0;
      this._n[C_ELEM_SCANS] = (this._n[C_ELEM_SCANS] + rightSz) | 0;
      this._n[C_SPLITS]     = (this._n[C_SPLITS] + 1) | 0;
    }

    const remDirs = this.dirLen - splitDir;
    const outStart = out.dirLen;
    for (let i = 0; i < remDirs; i++) {
      out.dir[outStart + i] = this.dir[splitDir + i];
      out.dirSize[outStart + i] = this.dirSize[splitDir + i];
    }
    for (let d = 0; d < dims; d++) {
      const base = d * maxC;
      for (let i = 0; i < remDirs; i++) {
        out.dirSums[base + outStart + i] = this.dirSums[base + splitDir + i];
      }
    }
    out.dirLen = outStart + remDirs;
    this.dirLen = splitDir;
    this._n[C_DIR_MOVES] = (this._n[C_DIR_MOVES] + remDirs) | 0;

    for (let d = 0; d < dims; d++) {
      const base = d * maxC;
      let oTot = 0;
      for (let i = 0; i < out.dirLen; i++) oTot += out.dirSums[base + i];
      out.totals[d] = oTot;
      this.totals[d] -= oTot;
    }
    this._n[C_DIR_SCANS] = (this._n[C_DIR_SCANS] + out.dirLen) | 0;

    out._len = this._len - globalIndex;
    this._len = globalIndex;

    if (this.dirLen > 1 && this.dirSize[this.dirLen - 1] < this._minOcc) {
      this._n[C_SEAM_REPAIRS] = (this._n[C_SEAM_REPAIRS] + 1) | 0;
      this._repairUnderflow(this.dirLen - 1);
    }
    if (out.dirLen > 1 && out.dirSize[0] < out._minOcc) {
      this._n[C_SEAM_REPAIRS] = (this._n[C_SEAM_REPAIRS] + 1) | 0;
      out._repairUnderflow(0);
    }
    return this;
  }

  append(other) {
    if (!(other instanceof BlockedArray) || other._arena !== this._arena || other === this) {
      baFail('operand', 'must be a distinct BlockedArray view of the same arena');
    }

    const dims = this.dims;
    const maxC = this.maxChunks;
    for (let d = 0; d < dims; d++) {
      if (this.totals[d] + other.totals[d] > MAX_SAFE) {
        baFail('headroom', 'exceeded');
      }
    }
    this._cv = false;
    other._cv = false;
    if (other._len === 0) return this;

    const hadLeft = this.dirLen > 0;
    const seamIdx = this.dirLen - 1;
    const base = this.dirLen;
    const addDirs = other.dirLen;

    for (let i = 0; i < addDirs; i++) {
      this.dir[base + i] = other.dir[i];
      this.dirSize[base + i] = other.dirSize[i];
    }
    for (let d = 0; d < dims; d++) {
      const dOff = d * maxC;
      for (let i = 0; i < addDirs; i++) {
        this.dirSums[dOff + base + i] = other.dirSums[dOff + i];
      }
      this.totals[d] += other.totals[d];
      other.totals[d] = 0;
    }

    this.dirLen = base + addDirs;
    this._len += other._len;
    other.dirLen = 0;
    other._len = 0;
    this._n[C_DIR_MOVES] = (this._n[C_DIR_MOVES] + addDirs) | 0;

    if (hadLeft && this.dirLen > 1) {
      if (this.dirSize[seamIdx] < this._minOcc) {
        this._n[C_SEAM_REPAIRS] = (this._n[C_SEAM_REPAIRS] + 1) | 0;
        this._repairUnderflow(seamIdx);
      }
      if (seamIdx + 1 < this.dirLen && this.dirSize[seamIdx + 1] < this._minOcc) {
        this._n[C_SEAM_REPAIRS] = (this._n[C_SEAM_REPAIRS] + 1) | 0;
        this._repairUnderflow(seamIdx + 1);
      }
    }
    return this;
  }

  // -- Internal Structural Operations (Zero-GC copyWithin) --------------

  _split(dirIdx) {
    const oldCIdx = this.dir[dirIdx];
    const newCIdx = this._allocChunk();
    const sz = this.dirSize[dirIdx];
    const half = sz >>> 1;
    const keep = sz - half;
    const B = this.chunkCap;
    const maxC = this.maxChunks;
    const dims = this.dims;
    const a = this._arena;

    a.poolEntities.copyWithin(newCIdx * B, oldCIdx * B + half, oldCIdx * B + sz);

    const dirTail = this.dirLen - (dirIdx + 1);
    if (dirTail > 0) {
      this.dir.copyWithin(dirIdx + 2, dirIdx + 1, this.dirLen);
      this.dirSize.copyWithin(dirIdx + 2, dirIdx + 1, this.dirLen);
    }

    const mArr = a.poolMeasures;
    for (let d = 0; d < dims; d++) {
      const dOff = d * maxC;
      if (dirTail > 0) {
        this.dirSums.copyWithin(dOff + dirIdx + 2, dOff + dirIdx + 1, dOff + this.dirLen);
      }
      const oldBase = (dOff + oldCIdx) * B;
      const newBase = (dOff + newCIdx) * B;
      mArr.copyWithin(newBase, oldBase + half, oldBase + sz);

      let sNew = 0;
      for (let i = 0; i < keep; i++) sNew += mArr[newBase + i];
      this.dirSums[dOff + dirIdx + 1] = sNew;
      this.dirSums[dOff + dirIdx] -= sNew;
    }

    this.dir[dirIdx + 1] = newCIdx;
    this.dirSize[dirIdx] = half;
    this.dirSize[dirIdx + 1] = keep;
    this.dirLen++;

    this._n[C_ELEM_MOVES] = (this._n[C_ELEM_MOVES] + keep) | 0;
    this._n[C_ELEM_SCANS] = (this._n[C_ELEM_SCANS] + keep) | 0;
    this._n[C_DIR_MOVES]  = (this._n[C_DIR_MOVES] + dirTail) | 0;
    this._n[C_SPLITS]     = (this._n[C_SPLITS] + 1) | 0;
  }

  _repairUnderflow(dirIdx) {
    const leftDir = dirIdx > 0 ? dirIdx - 1 : 0;
    const rightDir = leftDir + 1;
    const lSz = this.dirSize[leftDir];
    const rSz = this.dirSize[rightDir];
    const total = lSz + rSz;

    if (total <= (this.chunkCap >>> 1)) {
      this._merge(leftDir, rightDir, lSz, rSz);
    } else {
      this._equalize(leftDir, rightDir, lSz, rSz, total);
    }
  }

  _merge(leftDir, rightDir, lSz, rSz) {
    const leftCIdx = this.dir[leftDir];
    const rightCIdx = this.dir[rightDir];
    const B = this.chunkCap;
    const maxC = this.maxChunks;
    const dims = this.dims;
    const a = this._arena;

    if (rSz > 0) {
      a.poolEntities.copyWithin(leftCIdx * B + lSz, rightCIdx * B, rightCIdx * B + rSz);
      const mArr = a.poolMeasures;
      for (let d = 0; d < dims; d++) {
        const dOff = d * maxC;
        mArr.copyWithin((dOff + leftCIdx) * B + lSz, (dOff + rightCIdx) * B, (dOff + rightCIdx) * B + rSz);
        this.dirSums[dOff + leftDir] += this.dirSums[dOff + rightDir];
      }
    }

    this.dirSize[leftDir] = lSz + rSz;

    const dirTail = this.dirLen - (rightDir + 1);
    if (dirTail > 0) {
      this.dir.copyWithin(rightDir, rightDir + 1, this.dirLen);
      this.dirSize.copyWithin(rightDir, rightDir + 1, this.dirLen);
      for (let d = 0; d < dims; d++) {
        const dOff = d * maxC;
        this.dirSums.copyWithin(dOff + rightDir, dOff + rightDir + 1, dOff + this.dirLen);
      }
    }
    this.dirLen--;
    this._freeChunk(rightCIdx);

    this._n[C_ELEM_MOVES] = (this._n[C_ELEM_MOVES] + rSz) | 0;
    this._n[C_DIR_MOVES]  = (this._n[C_DIR_MOVES] + dirTail) | 0;
    this._n[C_MERGES]     = (this._n[C_MERGES] + 1) | 0;
  }

  _equalize(leftDir, rightDir, lSz, rSz, total) {
    const leftCIdx = this.dir[leftDir];
    const rightCIdx = this.dir[rightDir];
    const targetLeft = total >>> 1;
    const targetRight = total - targetLeft;
    const B = this.chunkCap;
    const maxC = this.maxChunks;
    const dims = this.dims;
    const a = this._arena;
    const mArr = a.poolMeasures;

    if (lSz < targetLeft) {
      const shift = targetLeft - lSz;
      a.poolEntities.copyWithin(leftCIdx * B + lSz, rightCIdx * B, rightCIdx * B + shift);
      a.poolEntities.copyWithin(rightCIdx * B, rightCIdx * B + shift, rightCIdx * B + rSz);

      for (let d = 0; d < dims; d++) {
        const dOff = d * maxC;
        const lBase = (dOff + leftCIdx) * B;
        const rBase = (dOff + rightCIdx) * B;
        let movedSum = 0;
        for (let i = 0; i < shift; i++) movedSum += mArr[rBase + i];

        mArr.copyWithin(lBase + lSz, rBase, rBase + shift);
        mArr.copyWithin(rBase, rBase + shift, rBase + rSz);
        this.dirSums[dOff + leftDir] += movedSum;
        this.dirSums[dOff + rightDir] -= movedSum;
      }
      this._n[C_ELEM_MOVES] = (this._n[C_ELEM_MOVES] + rSz) | 0;
      this._n[C_ELEM_SCANS] = (this._n[C_ELEM_SCANS] + shift) | 0;
    } else {
      const shift = lSz - targetLeft;
      a.poolEntities.copyWithin(rightCIdx * B + shift, rightCIdx * B, rightCIdx * B + rSz);
      a.poolEntities.copyWithin(rightCIdx * B, leftCIdx * B + targetLeft, leftCIdx * B + lSz);

      for (let d = 0; d < dims; d++) {
        const dOff = d * maxC;
        const lBase = (dOff + leftCIdx) * B;
        const rBase = (dOff + rightCIdx) * B;
        let movedSum = 0;
        for (let i = targetLeft; i < lSz; i++) movedSum += mArr[lBase + i];

        mArr.copyWithin(rBase + shift, rBase, rBase + rSz);
        mArr.copyWithin(rBase, lBase + targetLeft, lBase + lSz);
        this.dirSums[dOff + leftDir] -= movedSum;
        this.dirSums[dOff + rightDir] += movedSum;
      }
      this._n[C_ELEM_MOVES] = (this._n[C_ELEM_MOVES] + rSz + shift) | 0;
      this._n[C_ELEM_SCANS] = (this._n[C_ELEM_SCANS] + shift) | 0;
    }

    this.dirSize[leftDir] = targetLeft;
    this.dirSize[rightDir] = targetRight;
    this._n[C_EQUALIZES] = (this._n[C_EQUALIZES] + 1) | 0;
  }
}

/**
 * The cursor of one BlockedArray view (not exported; cursor() returns the view's one instance,
 * built with the view; `new (v.cursor().constructor)()` throws TypeError).
 * State: (directory index, local index, global index, chunk id) in an Int32Array(4) and the
 * running offset of every dim in a Float64Array(dims). Validity lives on the view (_cv) so every
 * mutator invalidates it with one field write. next() is O(1): one in-chunk step, or one
 * directory step at a chunk end (counted as 1 dirScan).
 * Contract (test/oracle.mjs cursor, Yggdrasil.d.ts SumCursor): a fresh cursor is invalid;
 * seekIndex(i) checks 'index' i in [0, length], i = length leaves it invalid; seekSum(d, y)
 * checks 'dim' then 'seek', y >= total(d) leaves it invalid; offset(d) / measure(d) check 'dim'
 * first (valid or not), then NaN when invalid; index / entity read -1 when invalid; next() on an
 * invalid cursor returns false and changes nothing.
 */
class BlockedCursor {
  constructor(v, key) {
    if (key !== BA_KEY) throw new TypeError('BlockedCursor is not constructible');
    this._v = v;
    this._st = new Int32Array(4);
    this._off = new Float64Array(v.dims);
  }

  get valid() {
    return this._v._cv;
  }

  get index() {
    return this._v._cv ? this._st[CU_INDEX] : -1;
  }

  get entity() {
    const v = this._v;
    if (!v._cv) return -1;
    const st = this._st;
    return v._arena.poolEntities[st[CU_CHUNK] * v.chunkCap + st[CU_LOCAL]];
  }

  offset(d) {
    const v = this._v;
    if (typeof d !== 'number' || (d | 0) !== d || d < 0 || d >= v.dims) {
      baFail('dim', 'out of range');
    }
    return v._cv ? this._off[d] : 0 / 0;
  }

  measure(d) {
    const v = this._v;
    if (typeof d !== 'number' || (d | 0) !== d || d < 0 || d >= v.dims) {
      baFail('dim', 'out of range');
    }
    if (!v._cv) return 0 / 0;
    const st = this._st;
    return v._arena.poolMeasures[(d * v.maxChunks + st[CU_CHUNK]) * v.chunkCap + st[CU_LOCAL]];
  }

  // Land on (dirIdx, local, index). The seek that calls it has already filled _off in its own
  // (counted) scan; this only writes the position.
  _land(dirIdx, local, index) {
    const v = this._v;
    const st = this._st;
    st[CU_DIR] = dirIdx;
    st[CU_LOCAL] = local;
    st[CU_INDEX] = index;
    st[CU_CHUNK] = v.dir[dirIdx];
    v._cv = true;
  }

  // One pass: the directory scan by dirSize carries every dim's dirSums entry into _off
  // (dirIdx + 1 dirScans, one per directory entry read, all dims of it), then the `rem` in-chunk
  // elements of every dim (rem elemScans) -- the work sumBefore(d, i) counts for the same i.
  seekIndex(i) {
    const v = this._v;
    if (typeof i !== 'number' || (i | 0) !== i || i < 0 || i > v._len) {
      baFail('index', 'out of range');
    }
    if (i === v._len) {
      v._locate(i); // reads and counts the scan to the end (0 on an empty view)
      v._cv = false;
      return false;
    }
    const off = this._off;
    const dims = v.dims;
    const maxC = v.maxChunks;
    const dirSize = v.dirSize;
    const dirSums = v.dirSums;
    for (let e = 0; e < dims; e++) off[e] = 0;
    let dirIdx = 0;
    let rem = i;
    while (rem >= dirSize[dirIdx]) {
      rem -= dirSize[dirIdx];
      for (let e = 0; e < dims; e++) off[e] += dirSums[e * maxC + dirIdx];
      dirIdx++;
    }
    v._n[C_DIR_SCANS] = (v._n[C_DIR_SCANS] + dirIdx + 1) | 0;
    if (rem > 0) {
      const mArr = v._arena.poolMeasures;
      const B = v.chunkCap;
      const cIdx = v.dir[dirIdx];
      for (let e = 0; e < dims; e++) {
        const mb = (e * maxC + cIdx) * B;
        for (let j = 0; j < rem; j++) off[e] += mArr[mb + j];
      }
      v._n[C_ELEM_SCANS] = (v._n[C_ELEM_SCANS] + rem) | 0;
    }
    this._land(dirIdx, rem, i);
    return true;
  }

  // One pass, like indexAtSum (plain loop): every directory entry passed adds all dims' dirSums
  // to _off, every element passed adds all dims' measures; counted as indexAtSum counts.
  seekSum(d, y) {
    const v = this._v;
    if (typeof d !== 'number' || (d | 0) !== d || d < 0 || d >= v.dims) {
      baFail('dim', 'out of range');
    }
    if (typeof y !== 'number' || !(y >= 0) || !Number.isFinite(y)) {
      baFail('seek', 'target must be a finite number >= 0');
    }
    const n = v.dirLen;
    if (y >= v.totals[d]) {
      v._n[C_DIR_SCANS] = (v._n[C_DIR_SCANS] + n) | 0;
      v._cv = false;
      return false;
    }
    const off = this._off;
    const dims = v.dims;
    const maxC = v.maxChunks;
    const dirSums = v.dirSums;
    const dirSize = v.dirSize;
    const sb = d * maxC;
    for (let e = 0; e < dims; e++) off[e] = 0;
    let dirIdx = 0;
    let g = 0;
    let rem = y;
    while (dirIdx < n) {
      const s = dirSums[sb + dirIdx];
      if (rem < s) break;
      rem -= s;
      g += dirSize[dirIdx];
      for (let e = 0; e < dims; e++) off[e] += dirSums[e * maxC + dirIdx];
      dirIdx++;
    }
    v._n[C_DIR_SCANS] = (v._n[C_DIR_SCANS] + dirIdx + 1) | 0;
    if (dirIdx >= n) {
      v._cv = false;
      return false;
    }
    const sz = dirSize[dirIdx];
    const mArr = v._arena.poolMeasures;
    const B = v.chunkCap;
    const cIdx = v.dir[dirIdx];
    const mb = (sb + cIdx) * B;
    let local = 0;
    while (local < sz) {
      const m = mArr[mb + local];
      if (m > rem) break;
      rem -= m;
      for (let e = 0; e < dims; e++) off[e] += mArr[(e * maxC + cIdx) * B + local];
      local++;
    }
    if (local >= sz) {
      // the target lies past this chunk's last element: rounding only; land on the next chunk's head
      // (_off already holds the whole chunk)
      v._n[C_ELEM_SCANS] = (v._n[C_ELEM_SCANS] + sz) | 0;
      if (dirIdx + 1 >= n) {
        v._cv = false;
        return false;
      }
      this._land(dirIdx + 1, 0, g + sz);
      return true;
    }
    v._n[C_ELEM_SCANS] = (v._n[C_ELEM_SCANS] + local + 1) | 0;
    this._land(dirIdx, local, g + local);
    return true;
  }

  next() {
    const v = this._v;
    if (!v._cv) return false;
    const st = this._st;
    const off = this._off;
    const dims = v.dims;
    const maxC = v.maxChunks;
    const B = v.chunkCap;
    const mArr = v._arena.poolMeasures;
    const cIdx = st[CU_CHUNK];
    const local = st[CU_LOCAL];
    for (let d = 0; d < dims; d++) off[d] += mArr[(d * maxC + cIdx) * B + local];
    st[CU_INDEX] += 1;
    const nl = local + 1;
    const dirIdx = st[CU_DIR];
    if (nl < v.dirSize[dirIdx]) {
      st[CU_LOCAL] = nl;
      return true;
    }
    const nd = dirIdx + 1;
    if (nd < v.dirLen) {
      st[CU_DIR] = nd;
      st[CU_LOCAL] = 0;
      st[CU_CHUNK] = v.dir[nd];
      v._n[C_DIR_SCANS] = (v._n[C_DIR_SCANS] + 1) | 0;
      return true;
    }
    v._cv = false;
    return false;
  }
}
