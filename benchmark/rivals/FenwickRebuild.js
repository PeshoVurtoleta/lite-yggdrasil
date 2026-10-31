/**
 * FenwickRebuild -- the Fenwick + rebuild rival for SumSequence (benchmark only, never shipped).
 *
 * MIT (c) Zahary Shinikchiev <shinikchiev@yahoo.com>
 *
 * Source: LiteVirtual Virtual.js:46-84 @ sha256 331cca9f (first 8 hex of the
 * file's sha256; LiteVirtual has no git history): fenwickBuild 46-56,
 * fenwickUpdate 58-60, fenwickPrefix 62-67, fenwickFind 69-84. RESEARCH 4.1
 * strong rival ("Fenwick + rebuild on insert, LiteVirtual today"); SPEC
 * bench-adopt BA-4 (hand-written, in-place rebuild into preallocated arrays)
 * and BA-8 (counters).
 *
 * Changes against the source (fair-rival rules, same results):
 *  - one tree per dim, all in ONE preallocated Float64Array(dims x (C+1));
 *    dim d's node j (1-based) is tree[d * (C+1) + j]. Measures are flat
 *    Float64Array(dims x C), dim d at d * C; entities Int32Array(C).
 *  - fenwickBuild runs IN PLACE over the live prefix (fill 0, then the same
 *    one-pass loop) instead of returning a new Float64Array.
 *  - fenwickFind's top power of two is 1 << (31 - clz32(n)) (the value the
 *    doubling loop reaches). Its `t[next] <= rem` is the STRICT M-7 seek:
 *    the largest pos with prefix(pos) <= y is the smallest i with
 *    prefix(i) + m_i > y, else length.
 *
 * Cost model: insertAt / removeAt shift every column with copyWithin, then
 * rebuild every dim's tree (O(n), 0 B). setMeasure is the O(log n) delta
 * update. getMeasure / entityAt / total are O(1); sumBefore / indexAtSum and
 * the seeks are O(log n). splitAt copies the tail and rebuilds out only (the
 * left tree stays exact); append copies, then rebuilds. Each instance
 * owns its own C (no shared arena): splitAt / append are O(moved).
 *
 * Checks: the engine's RangeError tokens and C-10 order (index, entity, dim,
 * measure, extra, capacity, headroom, seek, operand), every check before the
 * first write, every throw through the one cold fwFail(). Operand rules this
 * rival adds (the engine's arena rule has no analogue): a FenwickRebuild of
 * the same dims ('operand'); the receiver must hold the moved elements
 * ('capacity'), checked after headroom.
 *
 * Counters (BA-8), a Float64Array(3) (exact past 2^31): elemMoves = elements
 * shifted or copied (paired with the engine's moves), nodeVisits = Fenwick
 * nodes read or written by update / prefix / find (rebuild work excluded),
 * rebuilds = O(n) rebuild passes. Every other engine counter is 'n/a'
 * (COUNTER_MAP). Counters go to this view only (the engine's RS-1).
 *
 * The cursor is ONE preallocated object per instance; every successful
 * mutator invalidates it after its checks (the oracle's K-R1 / C-6).
 * ASCII only.
 */

const FW_MAX = 9007199254740991; // 2^53-1
const FW_CAP = 268435456; // 2^28: capacity cap (allocation sizing, fail closed)
const FW_BYTE_CAP = 4294967296; // 2^32 bytes of typed arrays per instance
const FW_MOVES = 0;
const FW_VISITS = 1;
const FW_REBUILDS = 2;
const FW_NC = 3;
const FW_KEY = {};

const fwTAProto = Object.getPrototypeOf(Int32Array.prototype);
const fwTag = Function.prototype.call.bind(Object.getOwnPropertyDescriptor(fwTAProto, Symbol.toStringTag).get);
const fwLen = Function.prototype.call.bind(Object.getOwnPropertyDescriptor(fwTAProto, 'length').get);

// ---- cold helpers ---------------------------------------------------------------

// Every RangeError: token + ' ' + detail, both literals at every call site.
function fwFail(token, detail) {
  throw new RangeError(token + ' ' + detail);
}

// Exact typed-array bytes of one instance: ent, meas, tree, totals, sx, counters, cursor offsets.
function fwBytes(C, dims) {
  return 4 * C + 8 * dims * C + 8 * dims * (C + 1) + 8 * dims + 8 * 4 /* sx */ + 8 * FW_NC + 8 * dims;
}

// Check order: C -> options -> dims -> cap -> byte cap. Returns dims.
function fwInit(C, o) {
  if (typeof C !== 'number' || !Number.isInteger(C) || C < 1) {
    fwFail('capacity', 'C must be an integer >= 1');
  }
  let dims = 1;
  if (o !== undefined) {
    if (o === null || typeof o !== 'object') fwFail('options', 'must be undefined or a plain object');
    const proto = Object.getPrototypeOf(o);
    if (proto !== Object.prototype && proto !== null) fwFail('options', 'must be a plain object');
    const keys = Reflect.ownKeys(o);
    for (let j = 0; j < keys.length; j++) {
      const key = keys[j];
      if (typeof key !== 'string') fwFail('options', 'symbol keys are not options');
      if (key !== 'dims') fwFail('options', "unknown key, did you mean 'dims'?");
      const desc = Object.getOwnPropertyDescriptor(o, key);
      if (desc === undefined || !('value' in desc)) fwFail('options', 'dims must be a data property, not an accessor');
      if (desc.value === undefined) fwFail('options', 'dims is present but undefined');
      dims = desc.value;
    }
  }
  if (typeof dims !== 'number' || !Number.isInteger(dims) || dims < 1 || !(dims <= 4)) {
    fwFail('dims', 'must be an integer in 1..4');
  }
  if (!(C <= FW_CAP)) fwFail('capacity', 'C must be <= 2^28');
  if (!(fwBytes(C, dims) <= FW_BYTE_CAP)) fwFail('capacity', 'typed arrays must total <= 2^32 bytes');
  return dims;
}

// insertAt slots 1..dims-1 (staged in sx by insertAt, typeof already checked), then the extra slots.
function fwSlots(v, xs) {
  const dims = v._dims;
  const sx = v._sx;
  for (let d = 1; d < dims; d++) {
    const m = sx[d];
    if (!((m >= 0) & (m <= FW_MAX))) fwFail('measure', 'must be in [0, 2^53-1]');
    if (m % 1 !== 0) fwFail('measure', 'must be an integer');
  }
  if (xs !== 0) fwFail('extra', 'slot beyond dims must be undefined');
}

// The operand rules of splitAt / append (no state read beyond the brand).
function fwOperand(v, o) {
  if (o === null || typeof o !== 'object' || !FenwickRebuild._is(o)) {
    fwFail('operand', 'must be a FenwickRebuild');
  }
  if (o === v) fwFail('operand', 'must not be this');
  if (o._dims !== v._dims) fwFail('operand', 'dims differ');
}

// ---- Fenwick core (LiteVirtual Virtual.js:46-84) ----------------------------------

// fenwickBuild (46-56), in place over the live prefix [1, n] of every dim.
function fwRebuild(v) {
  const n = v._len;
  const C = v._C;
  const tree = v._tree;
  const meas = v._meas;
  for (let d = 0; d < v._dims; d++) {
    const b = d * (C + 1);
    const mb = d * C;
    tree.fill(0, b + 1, b + n + 1);
    for (let i = 0; i < n; i++) {
      const j = i + 1;
      tree[b + j] += meas[mb + i];
      const up = j + (j & -j);
      if (up <= n) tree[b + up] += tree[b + j];
    }
  }
  v._c[FW_REBUILDS] += 1;
}

// fenwickPrefix (62-67): sum of dim dd over [0, i) into sx[1] (a double never crosses the call).
function fwPrefix(v, dd, i) {
  const tree = v._tree;
  const b = dd * (v._C + 1);
  let s = 0;
  let c = 0;
  for (let k = i; k > 0; k -= k & -k) {
    s += tree[b + k];
    c++;
  }
  v._sx[1] = s;
  v._c[FW_VISITS] += c;
}

// fenwickFind (69-84) for y = sx[0]: the largest pos in [0, n] with prefix(pos) <= y. n >= 1.
function fwFind(v, dd) {
  const n = v._len;
  const tree = v._tree;
  const b = dd * (v._C + 1);
  let pos = 0;
  let rem = v._sx[0];
  let c = 0;
  for (let pw = 1 << (31 - Math.clz32(n)); pw > 0; pw >>= 1) {
    const nx = pos + pw;
    if (nx <= n) {
      c++;
      const t = tree[b + nx];
      if (t <= rem) {
        rem -= t;
        pos = nx;
      }
    }
  }
  v._c[FW_VISITS] += c;
  return pos;
}

// ---- the rival -----------------------------------------------------------------------

export class FenwickRebuild {
  // Native counter slots (readCounters order).
  static COUNTERS = Object.freeze({ elemMoves: FW_MOVES, nodeVisits: FW_VISITS, rebuilds: FW_REBUILDS });

  // Engine counter name -> native counter name, or 'n/a' (BA-8: only moves pairs).
  static COUNTER_MAP = Object.freeze({
    touches: 'n/a', pulls: 'n/a', moves: 'elemMoves', splits: 'n/a', merges: 'n/a', equalizes: 'n/a',
    rotSingle: 'n/a', rotDouble: 'n/a', fingerHits: 'n/a', fingerMisses: 'n/a', joinSteps: 'n/a',
    seamRepairs: 'n/a',
  });

  #fw() {}

  static _is(o) {
    return #fw in o;
  }

  constructor(C, o) {
    const dims = fwInit(C, o);
    // ---- allocation: no check below this line ----
    this._len = 0;
    this._ci = -1; // cursor index, -1 = invalid
    this._C = C;
    this._dims = dims;
    this._ent = new Int32Array(C);
    this._meas = new Float64Array(dims * C);
    this._tree = new Float64Array(dims * (C + 1));
    this._tot = new Float64Array(dims);
    this._sx = new Float64Array(4); // [0] staged y / m0, [1..3] staged m1..m3, [1] prefix out
    this._c = new Float64Array(FW_NC);
    this._cur = new FenwickCursor(this, dims, FW_KEY);
  }

  get length() {
    return this._len;
  }

  get capacity() {
    return this._C;
  }

  get available() {
    return this._C - this._len;
  }

  // Exact typed-array bytes this instance holds (cold).
  bytes() {
    return fwBytes(this._C, this._dims);
  }

  cursor() {
    return this._cur;
  }

  total(d) {
    if (typeof d !== 'number' || (((d >>> 0) !== d) | !(d < this._dims))) {
      fwFail('dim', 'must be an integer in [0, dims)');
    }
    return this._tot[d >>> 0];
  }

  // ---- mutation ----------------------------------------------------------------------

  insertAt(i, e, m0, m1, m2, m3) {
    const n = this._len;
    if (typeof i !== 'number') fwFail('index', 'must be a number');
    if (((i >>> 0) !== i) | !(i <= n)) fwFail('index', 'must be an integer in [0, length]');
    const at = i >>> 0;
    if (typeof e !== 'number' || (e & 0x3FFFFFFF) !== e) fwFail('entity', 'must be an integer in [0, 2^30-1]');
    if (typeof m0 !== 'number') fwFail('measure', 'must be a number');
    if (!((m0 >= 0) & (m0 <= FW_MAX))) fwFail('measure', 'must be in [0, 2^53-1]');
    if (!Number.isInteger(m0)) fwFail('measure', 'must be an integer');
    const dims = this._dims;
    const sx = this._sx;
    if (dims > 1) {
      if ((typeof m1 !== 'number') | ((dims > 2) & (typeof m2 !== 'number')) |
          ((dims > 3) & (typeof m3 !== 'number'))) {
        fwFail('measure', 'must be a number');
      }
      sx[1] = m1 + 0;
      if (dims > 2) sx[2] = m2 + 0;
      if (dims > 3) sx[3] = m3 + 0;
    }
    const xs = ((m1 !== undefined) & (dims < 2)) | ((m2 !== undefined) & (dims < 3)) |
        ((m3 !== undefined) & (dims < 4));
    if (xs | (dims > 1)) fwSlots(this, xs);
    const C = this._C;
    if (!(n < C)) fwFail('capacity', 'live + 1 > C');
    sx[0] = m0 + 0;
    const tot = this._tot;
    for (let d = 0; d < dims; d++) {
      if (!(sx[d] <= FW_MAX - tot[d])) fwFail('headroom', 'total would exceed 2^53-1');
    }
    // ---- first write ----
    this._ci = -1;
    const ent = this._ent;
    const meas = this._meas;
    ent.copyWithin(at + 1, at, n);
    ent[at] = e;
    for (let d = 0; d < dims; d++) {
      const mb = d * C;
      meas.copyWithin(mb + at + 1, mb + at, mb + n);
      meas[mb + at] = sx[d];
      tot[d] += sx[d];
    }
    this._len = n + 1;
    this._c[FW_MOVES] += n - at;
    fwRebuild(this);
  }

  removeAt(i) {
    const n = this._len;
    if (typeof i !== 'number') fwFail('index', 'must be a number');
    if (((i >>> 0) !== i) | !(i < n)) fwFail('index', 'must be an integer in [0, length)');
    // ---- first write ----
    this._ci = -1;
    const at = i >>> 0;
    const C = this._C;
    const ent = this._ent;
    const meas = this._meas;
    const tot = this._tot;
    const e = ent[at];
    ent.copyWithin(at, at + 1, n);
    for (let d = 0; d < this._dims; d++) {
      const mb = d * C;
      tot[d] -= meas[mb + at];
      meas.copyWithin(mb + at, mb + at + 1, mb + n);
    }
    this._len = n - 1;
    this._c[FW_MOVES] += n - 1 - at;
    fwRebuild(this);
    return e;
  }

  setMeasure(i, d, m) {
    const n = this._len;
    if (typeof i !== 'number') fwFail('index', 'must be a number');
    if (((i >>> 0) !== i) | !(i < n)) fwFail('index', 'must be an integer in [0, length)');
    const at = i >>> 0;
    if (typeof d !== 'number' || (((d >>> 0) !== d) | !(d < this._dims))) {
      fwFail('dim', 'must be an integer in [0, dims)');
    }
    const dd = d >>> 0;
    if (typeof m !== 'number') fwFail('measure', 'must be a number');
    if (!((m >= 0) & (m <= FW_MAX))) fwFail('measure', 'must be in [0, 2^53-1]');
    if (!Number.isInteger(m)) fwFail('measure', 'must be an integer');
    const C = this._C;
    const meas = this._meas;
    const tot = this._tot;
    const mi = dd * C + at;
    const old = meas[mi];
    if (!(m <= FW_MAX - (tot[dd] - old))) fwFail('headroom', 'total would exceed 2^53-1');
    // ---- first write ----
    this._ci = -1;
    const delta = m - old;
    meas[mi] = m + 0;
    tot[dd] += delta;
    // fenwickUpdate (58-60)
    const tree = this._tree;
    const b = dd * (C + 1);
    let c = 0;
    for (let j = at + 1; j <= n; j += j & -j) {
      tree[b + j] += delta;
      c++;
    }
    this._c[FW_VISITS] += c;
  }

  // this := [0, i), out := [i, length); returns this.
  splitAt(i, out) {
    const n = this._len;
    if (typeof i !== 'number') fwFail('index', 'must be a number');
    if (((i >>> 0) !== i) | !(i <= n)) fwFail('index', 'must be an integer in [0, length]');
    fwOperand(this, out);
    if (out._len !== 0) fwFail('operand', 'out must be empty');
    const at = i >>> 0;
    const k = n - at;
    if (!(k <= out._C)) fwFail('capacity', 'out cannot hold the moved elements');
    // ---- first write ----
    this._ci = -1;
    out._ci = -1;
    const C = this._C;
    const oC = out._C;
    const ent = this._ent;
    const oent = out._ent;
    for (let j = 0; j < k; j++) oent[j] = ent[at + j];
    const meas = this._meas;
    const omeas = out._meas;
    for (let d = 0; d < this._dims; d++) {
      const mb = d * C + at;
      const ob = d * oC;
      let s = 0;
      for (let j = 0; j < k; j++) {
        const x = meas[mb + j];
        omeas[ob + j] = x;
        s += x;
      }
      out._tot[d] = s;
      this._tot[d] -= s;
    }
    this._len = at;
    out._len = k;
    this._c[FW_MOVES] += k;
    // No rebuild of this: Fenwick node j covers [j - lowbit(j), j), so nodes 1..at already hold exact sums of [0, at).
    if (k !== 0) fwRebuild(out);
    return this;
  }

  // this := this ++ other, other := empty; returns this.
  append(other) {
    fwOperand(this, other);
    const dims = this._dims;
    const tot = this._tot;
    const otot = other._tot;
    for (let d = 0; d < dims; d++) {
      if (!(otot[d] <= FW_MAX - tot[d])) fwFail('headroom', 'total would exceed 2^53-1');
    }
    const n = this._len;
    const k = other._len;
    if (!(k <= this._C - n)) fwFail('capacity', 'this cannot hold the appended elements');
    // ---- first write ----
    this._ci = -1;
    other._ci = -1;
    const C = this._C;
    const oC = other._C;
    const ent = this._ent;
    const oent = other._ent;
    for (let j = 0; j < k; j++) ent[n + j] = oent[j];
    const meas = this._meas;
    const omeas = other._meas;
    for (let d = 0; d < dims; d++) {
      const mb = d * C + n;
      const ob = d * oC;
      for (let j = 0; j < k; j++) meas[mb + j] = omeas[ob + j];
      tot[d] += otot[d];
      otot[d] = 0;
    }
    this._len = n + k;
    other._len = 0;
    this._c[FW_MOVES] += k;
    if (k !== 0) fwRebuild(this);
    return this;
  }

  // Back to the freshly constructed state (counters kept); returns this.
  clear() {
    this._ci = -1;
    this._len = 0;
    this._tot.fill(0);
    return this;
  }

  // ---- queries -------------------------------------------------------------------------

  getMeasure(i, d) {
    const n = this._len;
    if (typeof i !== 'number') fwFail('index', 'must be a number');
    if (((i >>> 0) !== i) | !(i < n)) fwFail('index', 'must be an integer in [0, length)');
    if (typeof d !== 'number' || (((d >>> 0) !== d) | !(d < this._dims))) {
      fwFail('dim', 'must be an integer in [0, dims)');
    }
    return this._meas[(d >>> 0) * this._C + (i >>> 0)];
  }

  entityAt(i) {
    const n = this._len;
    if (typeof i !== 'number') fwFail('index', 'must be a number');
    if (((i >>> 0) !== i) | !(i < n)) fwFail('index', 'must be an integer in [0, length)');
    return this._ent[i >>> 0];
  }

  sumBefore(d, i) {
    const n = this._len;
    if (typeof i !== 'number') fwFail('index', 'must be a number');
    if (((i >>> 0) !== i) | !(i <= n)) fwFail('index', 'must be an integer in [0, length]');
    if (typeof d !== 'number' || (((d >>> 0) !== d) | !(d < this._dims))) {
      fwFail('dim', 'must be an integer in [0, dims)');
    }
    fwPrefix(this, d >>> 0, i >>> 0);
    return this._sx[1];
  }

  // Smallest i with prefix(i) + m_i > y (STRICT, M-7), else length.
  indexAtSum(d, y) {
    if (typeof d !== 'number' || (((d >>> 0) !== d) | !(d < this._dims))) {
      fwFail('dim', 'must be an integer in [0, dims)');
    }
    if (typeof y !== 'number' || !((y >= 0) & (y < Infinity))) {
      fwFail('seek', 'must be a number in [0, Infinity)');
    }
    if (this._len === 0) return 0;
    this._sx[0] = y;
    return fwFind(this, d >>> 0);
  }

  // ---- counters ------------------------------------------------------------------------

  // out: a genuine Int32Array (wraps past 2^31, like the engine) or Float64Array (exact), length >= 3.
  readCounters(out) {
    const tag = fwTag(out);
    if (tag !== 'Int32Array' && tag !== 'Float64Array') {
      fwFail('counters', 'out must be an Int32Array or a Float64Array');
    }
    if (!(fwLen(out) >= FW_NC)) fwFail('counters', 'out.length must be >= 3');
    const c = this._c;
    out[0] = c[0];
    out[1] = c[1];
    out[2] = c[2];
  }

  resetCounters() {
    this._c.fill(0);
  }
}

// ---- the cursor (one per instance, preallocated) ------------------------------------------

class FenwickCursor {
  constructor(v, dims, key) {
    if (key !== FW_KEY) throw new TypeError('FenwickCursor is not constructible');
    this._off = new Float64Array(dims); // _off[d] = sum of dim d over [0, index)
    this._v = v;
  }

  get valid() {
    return this._v._ci >= 0;
  }

  get index() {
    return this._v._ci;
  }

  get entity() {
    const v = this._v;
    const ci = v._ci;
    return ci >= 0 ? v._ent[ci] : -1;
  }

  // dim checked first, valid or not; NaN when not valid.
  offset(d) {
    const v = this._v;
    if (typeof d !== 'number' || (((d >>> 0) !== d) | !(d < v._dims))) {
      fwFail('dim', 'must be an integer in [0, dims)');
    }
    return v._ci >= 0 ? this._off[d >>> 0] : 0 / 0;
  }

  measure(d) {
    const v = this._v;
    if (typeof d !== 'number' || (((d >>> 0) !== d) | !(d < v._dims))) {
      fwFail('dim', 'must be an integer in [0, dims)');
    }
    const ci = v._ci;
    return ci >= 0 ? v._meas[(d >>> 0) * v._C + ci] : 0 / 0;
  }

  // i in [0, length]; i = length (or an empty view) leaves the cursor invalid.
  seekIndex(i) {
    const v = this._v;
    const n = v._len;
    if (typeof i !== 'number') fwFail('index', 'must be a number');
    if (((i >>> 0) !== i) | !(i <= n)) fwFail('index', 'must be an integer in [0, length]');
    const at = i >>> 0;
    if (at === n) {
      v._ci = -1;
      return false;
    }
    const off = this._off;
    const sx = v._sx;
    for (let d = 0; d < v._dims; d++) {
      fwPrefix(v, d, at);
      off[d] = sx[1];
    }
    v._ci = at;
    return true;
  }

  // dim, then y (M-8), then the indexAtSum answer; y >= total(d) leaves the cursor invalid.
  seekSum(d, y) {
    const v = this._v;
    if (typeof d !== 'number' || (((d >>> 0) !== d) | !(d < v._dims))) {
      fwFail('dim', 'must be an integer in [0, dims)');
    }
    if (typeof y !== 'number' || !((y >= 0) & (y < Infinity))) {
      fwFail('seek', 'must be a number in [0, Infinity)');
    }
    const n = v._len;
    if (n === 0) {
      v._ci = -1;
      return false;
    }
    const sx = v._sx;
    sx[0] = y;
    const k = fwFind(v, d >>> 0);
    if (k === n) {
      v._ci = -1;
      return false;
    }
    const off = this._off;
    for (let j = 0; j < v._dims; j++) {
      fwPrefix(v, j, k);
      off[j] = sx[1];
    }
    v._ci = k;
    return true;
  }

  // Invalid -> false, no change; else index + 1, O(1); stepping off the end -> invalid, false.
  next() {
    const v = this._v;
    const ci = v._ci;
    if (ci < 0) return false;
    const off = this._off;
    const meas = v._meas;
    const C = v._C;
    for (let d = 0; d < v._dims; d++) off[d] += meas[d * C + ci];
    const k = ci + 1;
    if (k < v._len) {
      v._ci = k;
      return true;
    }
    v._ci = -1;
    return false;
  }
}
