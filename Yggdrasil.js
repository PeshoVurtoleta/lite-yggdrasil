/**
 * @zakkster/lite-yggdrasil
 *
 * MIT (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>
 *
 * Pre-release engine build (rung A-R1a of the E0 ladder): SumSequence init,
 * layout, pools, constructor validation, counters and getters. The element ops
 * land in the next rungs; nothing is released between rungs.
 *
 * Layout (0005 C-44). Every view owns, in this order: _root, _len, _fl, _fb,
 * _fdepth, _fpath, _cv, _n, then the hoisted refs _hdr, _left, _right, _weight,
 * _count, _inext, _sums, _llen, _lnext, _ent, _meas, _lsum, then _ar (the
 * shared arena record {C, B, shift, m, dims, Lmax, HL, views, sx}).
 * hdr = Int32Array(5) [live, lbump, lfree, ibump, ifree], END = -1.
 * A child ref >= 0 is an internal id; a ref < 0 is ~leafId. NIL = 0 (finger,
 * C-1); EMPTY_ROOT = 0x3FFFFFFF (C-8).
 */

export const VERSION = '0.0.0';

// ---- constants (Smi only) ---------------------------------------------------

const YG_NIL = 0;                 // empty finger (C-1, RA-2)
const YG_EMPTY_ROOT = 0x3FFFFFFF; // _root of an empty view (C-8, RA-2)
const YG_END = -1;                // free-list END (C-44)
const YG_NC = 12;                 // counters per view (0003 G-4)
const YG_MAX_VIEWS = 4096;        // count cap (C-14)
const YG_SLOT_CAP = 268435456;    // 2^28: Lmax * B <= 2^30 slot ids (C-14)
const YG_LIVE = 0;                // hdr slots (C-44)
const YG_LBUMP = 1;
const YG_LFREE = 2;
const YG_IBUMP = 3;
const YG_IFREE = 4;

// Handoff from arena() to the constructor: the pending arena columns while
// arena() builds its views, null at every other time. Cold only.
let ygPend = null;

// ---- cold helpers -------------------------------------------------------------

// Every RangeError of the engine: message = token + ' ' + detail, both string
// literals at every call site (V SPEC).
function ygFail(token, detail) {
  throw new RangeError(token + ' ' + detail);
}

// Levenshtein distance, cold (C-11 did-you-mean, RV-4). Plain arrays: the
// typed-array constructors are never read during validation (RV-6).
function ygLev(a, b) {
  const n = b.length;
  let prev = [];
  let cur = [];
  for (let j = 0; j <= n; j++) prev.push(j);
  for (let i = 1; i <= a.length; i++) {
    cur = [i];
    for (let j = 1; j <= n; j++) {
      const sub = prev[j - 1] + (a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1);
      cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, sub));
    }
    prev = cur;
  }
  return prev[n];
}

// Unknown option key: the nearest legal key, a tie goes to 'dims'; the user's
// key is never echoed (C-11, RV-4).
function ygUnknownKey(key) {
  if (ygLev(key, 'leafSize') < ygLev(key, 'dims')) {
    ygFail('options', "unknown key, did you mean 'leafSize'?");
  }
  ygFail('options', "unknown key, did you mean 'dims'?");
}

// H(L): the maximum height of a tree over L leaves (C-23). H(1) = 0.
function ygH(L) {
  let h = 0;
  let w = L;
  while (w > 1) {
    w = Math.floor((3 * w) / 4);
    h++;
  }
  return h;
}

// The ONE init of both constructor paths (M-2, 0004 A-8; C-11, C-14, C-15,
// C-16). Check order (RV-1): C -> options -> leafSize -> dims -> count -> cap.
// Every check runs before the first typed-array allocation; every column is
// allocated into a local. Returns the pending record the constructor binds.
function ygInit(C, o, k) {
  if (typeof C !== 'number' || !Number.isInteger(C) || C < 1) {
    ygFail('capacity', 'C must be an integer >= 1');
  }
  let B = 16;
  let dims = 1;
  if (o !== undefined) {
    if (o === null || typeof o !== 'object') ygFail('options', 'must be undefined or a plain object');
    const proto = Object.getPrototypeOf(o);
    if (proto !== Object.prototype && proto !== null) ygFail('options', 'must be a plain object');
    const keys = Reflect.ownKeys(o);
    for (let j = 0; j < keys.length; j++) {
      const key = keys[j];
      if (typeof key !== 'string') ygFail('options', 'symbol keys are not options');
      if (key !== 'dims' && key !== 'leafSize') ygUnknownKey(key);
      const desc = Object.getOwnPropertyDescriptor(o, key);
      if (desc === undefined || !('value' in desc)) {
        if (key === 'dims') ygFail('options', 'dims must be a data property, not an accessor');
        ygFail('options', 'leafSize must be a data property, not an accessor');
      }
      if (desc.value === undefined) {
        if (key === 'dims') ygFail('options', 'dims is present but undefined');
        ygFail('options', 'leafSize is present but undefined');
      }
      if (key === 'dims') dims = desc.value;
      else B = desc.value;
    }
  }
  if (typeof B !== 'number') ygFail('options', 'leafSize must be a number');
  if (B !== 4 && B !== 8 && B !== 16 && B !== 32) ygFail('options', 'leafSize must be 4, 8, 16 or 32');
  if (typeof dims !== 'number' || !Number.isInteger(dims) || dims < 1 || dims > 4) {
    ygFail('dims', 'must be an integer in 1..4');
  }
  if (typeof k !== 'number' || !Number.isInteger(k) || k < 1 || k > YG_MAX_VIEWS || k > C) {
    ygFail('count', 'must be an integer in 1..min(C, 4096)');
  }
  const m = B >> 2;
  if (C > YG_SLOT_CAP - m * k) ygFail('capacity', 'C must be <= 2^28 - (leafSize/4) * count');
  // ---- allocation: no check below this line --------------------------------
  const shift = 31 - Math.clz32(B);
  const Lmax = Math.ceil(C / m) + k;
  const HL = ygH(Lmax);
  const LB = Lmax * B;
  const NI = Lmax - 1;
  const ent = new Int32Array(LB);
  const meas = [];
  for (let d = 0; d < dims; d++) meas.push(new Float64Array(LB));
  const llen = new Int32Array(Lmax);
  const lnext = new Int32Array(Lmax);
  const lsum = [];
  for (let d = 0; d < dims; d++) lsum.push(new Float64Array(Lmax));
  const left = new Int32Array(NI);
  const right = new Int32Array(NI);
  const weight = new Int32Array(NI);
  const count = new Int32Array(NI);
  const inext = new Int32Array(NI);
  const sums = [];
  for (let d = 0; d < dims; d++) sums.push(new Float64Array(NI));
  const hdr = new Int32Array(5);
  const sx = new Float64Array(4);
  lnext.fill(YG_END);
  inext.fill(YG_END);
  hdr[YG_LFREE] = YG_END;
  hdr[YG_IFREE] = YG_END;
  const ar = { C: C, B: B, shift: shift, m: m, dims: dims, Lmax: Lmax, HL: HL, views: [], sx: sx };
  return {
    ar: ar, hdr: hdr, left: left, right: right, weight: weight, count: count, inext: inext, sums: sums,
    llen: llen, lnext: lnext, ent: ent, meas: meas, lsum: lsum,
  };
}

// ---- pools (cold; C-15, R-E4) ---------------------------------------------------

// Leaf allocator: free list first, then bump. Returns the leaf id (a ref is
// ~id). Exhaustion is RangeError 'pool' (R-E4); by the C-15 slack it never fires.
function ygAllocLeaf(v) {
  const hdr = v._hdr;
  const next = v._lnext;
  let id = hdr[YG_LFREE];
  if (id !== YG_END) {
    hdr[YG_LFREE] = next[id];
  } else {
    id = hdr[YG_LBUMP];
    if (!(id < v._ar.Lmax)) ygFail('pool', 'leaf pool exhausted');
    hdr[YG_LBUMP] = id + 1;
  }
  next[id] = YG_END;
  return id;
}

function ygFreeLeaf(v, id) {
  const hdr = v._hdr;
  v._lnext[id] = hdr[YG_LFREE];
  hdr[YG_LFREE] = id;
}

// Internal-node allocator: same discipline, pool size Lmax - 1.
function ygAllocInt(v) {
  const hdr = v._hdr;
  const next = v._inext;
  let id = hdr[YG_IFREE];
  if (id !== YG_END) {
    hdr[YG_IFREE] = next[id];
  } else {
    id = hdr[YG_IBUMP];
    if (!(id < v._ar.Lmax - 1)) ygFail('pool', 'internal pool exhausted');
    hdr[YG_IBUMP] = id + 1;
  }
  next[id] = YG_END;
  return id;
}

function ygFreeInt(v, id) {
  const hdr = v._hdr;
  v._inext[id] = hdr[YG_IFREE];
  hdr[YG_IFREE] = id;
}

// O(1) pool reset to construction order (0004 A-6; C-8): legal only when no
// view holds a node.
function ygReset(hdr) {
  hdr[YG_LIVE] = 0;
  hdr[YG_LBUMP] = 0;
  hdr[YG_LFREE] = YG_END;
  hdr[YG_IBUMP] = 0;
  hdr[YG_IFREE] = YG_END;
}

// clear() of a non-empty view while another view holds elements: the k >= 2
// free-walk (0004 A-6) lands in rung S-R1. Until then it fails closed, before
// any write.
function ygClearWalk() {
  throw new Error('lite-yggdrasil: clear() free-walk is not built yet (rung S-R1)');
}

// ---- the view ---------------------------------------------------------------------

export class SumSequence {
  // Counter indexes (C-24, R-D2; 0003 counters table).
  static COUNTERS = Object.freeze({
    touches: 0, pulls: 1, moves: 2, splits: 3, merges: 4, equalizes: 5,
    rotSingle: 6, rotDouble: 7, fingerHits: 8, fingerMisses: 9, joinSteps: 10,
    seamRepairs: 11,
  });

  // new SumSequence(C, o) is arena(C, o, 1)'s one view (M-2): the same init,
  // the same field order (one hidden class across views, 0004 A-8).
  constructor(C, o) {
    const p = ygPend === null ? ygInit(C, o, 1) : ygPend;
    const ar = p.ar;
    const fpath = new Int32Array(ar.HL);
    const n = new Int32Array(YG_NC);
    this._root = YG_EMPTY_ROOT;
    this._len = 0;
    this._fl = YG_NIL;
    this._fb = 0;
    this._fdepth = 0;
    this._fpath = fpath;
    this._cv = false;
    this._n = n;
    this._hdr = p.hdr;
    this._left = p.left;
    this._right = p.right;
    this._weight = p.weight;
    this._count = p.count;
    this._inext = p.inext;
    this._sums = p.sums;
    this._llen = p.llen;
    this._lnext = p.lnext;
    this._ent = p.ent;
    this._meas = p.meas;
    this._lsum = p.lsum;
    this._ar = ar;
    ar.views.push(this);
  }

  // count views over one shared arena (0004 A-2; C-15 pools sized for count).
  static arena(C, o, count) {
    const p = ygInit(C, o, count);
    ygPend = p;
    try {
      for (let v = 0; v < count; v++) new SumSequence();
    } finally {
      ygPend = null;
    }
    return p.ar.views.slice();
  }

  // ---- getters ----------------------------------------------------------------

  get length() {
    return this._len;
  }

  // Arena-wide C (0004 A-5).
  get capacity() {
    return this._ar.C;
  }

  // C - live elements, whole arena (0004 signatures).
  get available() {
    return this._ar.C - this._hdr[YG_LIVE];
  }

  // O(1) total of dim d (C-12); a boxed double on return (C-13, b = 1).
  total(d) {
    if (typeof d !== 'number' || (((d >>> 0) !== d) | (d >= this._ar.dims))) {
      ygFail('dim', 'must be an integer in [0, dims)');
    }
    const r = this._root;
    if (r === YG_EMPTY_ROOT) return 0;
    return r < 0 ? this._lsum[d >>> 0][~r] : this._sums[d >>> 0][r];
  }

  // ---- clear (C-8, 0004 A-6) ---------------------------------------------------------

  clear() {
    const hdr = this._hdr;
    if (this._len === hdr[YG_LIVE]) ygReset(hdr);
    else if (this._len !== 0) ygClearWalk();
    this._root = YG_EMPTY_ROOT;
    this._len = 0;
    this._fl = YG_NIL;
    this._fb = 0;
    this._fdepth = 0;
    this._cv = false;
    return this;
  }

  // ---- counters (0003 G-8, C-24) ----------------------------------------------------

  readCounters(out) {
    if (!(out instanceof Int32Array)) ygFail('counters', 'out must be an Int32Array');
    if (out.length < YG_NC) ygFail('counters', 'out.length must be >= 12');
    out.set(this._n);
  }

  resetCounters() {
    this._n.fill(0);
  }
}
