/**
 * @zakkster/lite-yggdrasil
 *
 * MIT (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>
 *
 * Pre-release engine build (rung F-R of the E0 ladder): SumSequence init,
 * layout, pools, constructor validation, counters and getters (A-R1a), the
 * positional ops insertAt / removeAt / setMeasure / getMeasure / entityAt, the
 * seeks indexAtSum / sumBefore and clear(), with their C-10 checks (A-R1b),
 * the trunk insert side (A-R2): positional descents into _fpath, the Table 3
 * leaf split, the hot pull pass, the cold weight pull with H-Y rotations and
 * the structural re-home, and the remove side (A-R3): the T-6 neighbour walk,
 * the one repair (merge / equalize), the delete rebalance and the drain, and
 * the k >= 2 clear() free-walk (S-R1), the T-3 join and append with its
 * C-21 seam repair (S-R2), splitAt (S-R3): the T-4 split whose joins
 * reuse the popped path nodes, and the C-21 rL + rR seam repairs, and the
 * C-4 finger hit test in the five positional ops (F-R): a hit skips the
 * descent and adds 0 touches; fingerHits / fingerMisses split (C-26). Nothing
 * is released between rungs.
 *
 * Layout (0005 C-44). Every view owns, in this order: _root, _len, _fl, _fb,
 * _fdepth, _fpath, _cv, _n, then the hoisted refs _hdr, _left, _right, _weight,
 * _count, _inext, _sums, _llen, _lnext, _ent, _meas, _lsum, then _ar (the
 * shared arena record {C, B, shift, m, dims, Lmax, HL, views, sx, jstack,
 * sstack}, each Int32Array(H(Lmax)): jstack is the T-3 join stack, sstack the
 * split stack. append's seam path uses BOTH: sstack = this's last-leaf path,
 * jstack = other's first-leaf path (written only for a repair). splitAt's
 * descent path and its seam paths go in sstack; its joins use jstack).
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
const YG_TOUCHES = 0;             // counter slots (C-24)
const YG_PULLS = 1;
const YG_MOVES = 2;
const YG_SPLITS = 3;
const YG_MERGES = 4;
const YG_EQUALIZES = 5;
const YG_ROTS = 6;
const YG_ROTD = 7;
const YG_MISSES = 9;
const YG_JOINS = 10;
const YG_SEAMS = 11;
// 2^53-1, the measure / total bound (0002 M-1, M-4). The one non-Smi constant.
const YG_MAX = 9007199254740991;

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
  const jstack = new Int32Array(HL);
  const sstack = new Int32Array(HL);
  lnext.fill(YG_END);
  inext.fill(YG_END);
  hdr[YG_LFREE] = YG_END;
  hdr[YG_IFREE] = YG_END;
  const ar = {
    C: C, B: B, shift: shift, m: m, dims: dims, Lmax: Lmax, HL: HL, views: [], sx: sx,
    jstack: jstack, sstack: sstack,
  };
  return {
    ar: ar, hdr: hdr, left: left, right: right, weight: weight, count: count, inext: inext, sums: sums,
    llen: llen, lnext: lnext, ent: ent, meas: meas, lsum: lsum,
  };
}

// ---- pools (cold; C-15, R-E4) ---------------------------------------------------

// The R-E4 'pool' throw of the allocators and ygSplit (R-P2, 0005 A6-4, C-3):
// the finger is invalidated (NIL / 0 / 0) before the throw, so the next
// positional op is a miss and I-9 holds; _fpath may stay rewritten by the op's
// descent. The splitAt / append 'pool' pre-checks call ygFail directly and
// change nothing (A7-4). Unreachable under C-15.
function ygPoolFail(v, detail) {
  v._fl = YG_NIL; // R-P2 (C-3)
  v._fb = 0;
  v._fdepth = 0;
  ygFail('pool', detail);
}

// Leaf allocator: free list first, then bump. Returns the leaf id (a ref is
// ~id). Exhaustion is RangeError 'pool' (R-E4, R-P2); by the C-15 slack it
// never fires.
function ygAllocLeaf(v) {
  const hdr = v._hdr;
  const next = v._lnext;
  let id = hdr[YG_LFREE];
  if (id !== YG_END) {
    hdr[YG_LFREE] = next[id];
  } else {
    id = hdr[YG_LBUMP];
    if (!(id < v._ar.Lmax)) ygPoolFail(v, 'leaf pool exhausted');
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
    if (!(id < v._ar.Lmax - 1)) ygPoolFail(v, 'internal pool exhausted');
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

// R-S1: a corrupt view fails closed. One cold throw site, a plain Error (no
// ygFail token): clear() trusts nothing it is about to free.
function ygCorrupt(detail) {
  throw new Error('lite-yggdrasil: clear() corrupt view: ' + detail);
}

// A root / child ref must name a bumped node: a leaf ref needs ~ref < lbump,
// an internal ref 0 <= ref < ibump (EMPTY_ROOT fails this).
function ygClearRef(ref, lb, ib, what) {
  if (ref < 0 ? !(~ref < lb) : !(ref < ib)) ygCorrupt(what + ' ref ' + ref + ' out of range');
}

// clear() of a non-empty view while another view holds elements: the k >= 2
// free-walk (0004 A-6; C-8). Cold, iterative, allocation-free, O(L_view): the
// internal free-list link _inext is the work stack (a live node's _inext is
// unused). Pop u, check both child refs, free each leaf child, push each
// internal child, then free u. Every node of THIS view's tree goes back to
// its pool; live -= _len. No counter write (C-25), _n untouched (C-8).
// Fail closed (R-S1, R-S2): _len > live or a bad root throws before any
// write; a child ref outside the bumps, or a walk past ibump internals /
// lbump leaves (a cycle), throws mid-walk after live -= _len and partial
// frees, with no further write. Not detected (R-S3): a ref inside the bumps
// naming another view's node, a free node or a node shared within the view.
function ygClearWalk(v) {
  const hdr = v._hdr;
  const left = v._left;
  const right = v._right;
  const inext = v._inext;
  const root = v._root;
  const len = v._len;
  const lb = hdr[YG_LBUMP];
  const ib = hdr[YG_IBUMP];
  if (len > hdr[YG_LIVE]) ygCorrupt('_len ' + len + ' > live ' + hdr[YG_LIVE]);
  ygClearRef(root, lb, ib, 'root');
  hdr[YG_LIVE] -= len;
  if (root < 0) {
    ygFreeLeaf(v, ~root);
    return;
  }
  inext[root] = YG_END;
  let top = root;
  let ni = 0;
  let nl = 0;
  while (top !== YG_END) {
    if (!(ni < ib)) ygCorrupt('more than ' + ib + ' internals');
    const u = top;
    top = inext[u];
    const l = left[u];
    const r = right[u];
    ygClearRef(l, lb, ib, 'child');
    ygClearRef(r, lb, ib, 'child');
    if (l < 0) {
      if (!(nl < lb)) ygCorrupt('more than ' + lb + ' leaves');
      ygFreeLeaf(v, ~l);
      nl++;
    } else {
      inext[l] = top;
      top = l;
    }
    if (r < 0) {
      if (!(nl < lb)) ygCorrupt('more than ' + lb + ' leaves');
      ygFreeLeaf(v, ~r);
      nl++;
    } else {
      inext[r] = top;
      top = r;
    }
    ygFreeInt(v, u);
    ni++;
  }
}

// ---- op helpers (cold; C-10, RV-2, RF-1) ------------------------------------------

// M-3 for one measure slot (m1..m3 at dims > 1): typeof, range (NaN fails),
// integer test. No coercion, no valueOf call.
function ygMeasure(m) {
  if (typeof m !== 'number') ygFail('measure', 'must be a number');
  if (!((m >= 0) & (m <= YG_MAX))) ygFail('measure', 'must be in [0, 2^53-1]');
  if (!Number.isInteger(m)) ygFail('measure', 'must be an integer');
}

// insertAt's one cold re-check for the slots 1..dims-1 (RV-2, R-Q1 / A6-1):
// reached on a present extra slot, or on every insert at dims > 1. It takes
// no measure argument: insertAt typeof-checked slots 1..dims-1 inline and
// staged them in sx (scratch, not state, C-44); this reads sx. C-10 order:
// the measures of slots < dims (range, integer), then the extra slots (xs = 1
// iff a slot >= dims is not undefined, computed in insertAt).
function ygSlots(ar, xs) {
  const dims = ar.dims;
  const sx = ar.sx;
  for (let d = 1; d < dims; d++) ygMeasure(sx[d]);
  if (xs !== 0) ygFail('extra', 'slot beyond dims must be undefined');
}

// insertAt headroom over every dim, from the staged sx (M-4: m_d > MAX - t_d).
function ygHeadroomIns(v) {
  const ar = v._ar;
  const sx = ar.sx;
  const r = v._root;
  for (let d = 0; d < ar.dims; d++) {
    const t = r === YG_EMPTY_ROOT ? 0 : r < 0 ? v._lsum[d][~r] : v._sums[d][r];
    if (sx[d] > YG_MAX - t) ygFail('headroom', 'total would exceed 2^53-1');
  }
}

// setMeasure headroom (RF-1): the hot test m <= MAX - t failed, so a READ-ONLY
// descent (element rule; no _fpath / _fl / _fb / _fdepth write) fetches m_old
// and decides m > MAX - (t - m_old). The new m is staged in sx[0].
function ygSetHeadroom(v, at, dd) {
  const left = v._left;
  const right = v._right;
  const count = v._count;
  const llen = v._llen;
  let ref = v._root;
  let k = at;
  while (ref >= 0) {
    const l = left[ref];
    const cl = l < 0 ? llen[~l] : count[l];
    if (k < cl) {
      ref = l;
    } else {
      k -= cl;
      ref = right[ref];
    }
  }
  const r = v._root;
  const t = r < 0 ? v._lsum[dd][~r] : v._sums[dd][r];
  const old = v._meas[dd][(~ref << v._ar.shift) + k];
  if (v._ar.sx[0] > YG_MAX - (t - old)) ygFail('headroom', 'total would exceed 2^53-1');
}

// First insert on an empty view: allocate the root leaf (C-8 cold). The new
// element's measures come from sx. A miss; moves 0 (s = p = 0); touches 0.
function ygFirstLeaf(v, e) {
  const ar = v._ar;
  const id = ygAllocLeaf(v);
  const base = id << ar.shift;
  const sx = ar.sx;
  v._ent[base] = e;
  for (let d = 0; d < ar.dims; d++) {
    v._meas[d][base] = sx[d];
    v._lsum[d][id] = v._meas[d][base]; // recount over len 1 (C-45)
  }
  v._llen[id] = 1;
  v._hdr[YG_LIVE] += 1;
  v._root = ~id;
  v._len = 1;
  v._fl = ~id;
  v._fb = 0;
  v._fdepth = 0;
  v._n[YG_MISSES] += 1;
}

// removeAt of a view's last element: free the leaf, finger NIL / 0 / 0 (C-5);
// at live 0 both pools reset to construction order instead (RA-4, C-8).
function ygDrain(v, id) {
  const hdr = v._hdr;
  hdr[YG_LIVE] -= 1;
  if (hdr[YG_LIVE] === 0) ygReset(hdr);
  else ygFreeLeaf(v, id);
  v._root = YG_EMPTY_ROOT;
  v._len = 0;
  v._fl = YG_NIL;
  v._fb = 0;
  v._fdepth = 0;
  v._n[YG_MISSES] += 1;
}

// ---- trunk: structural path (cold; C-18..C-20, C-23, C-25, T-2) ----------------

// Weight pull of one internal node: weight (leaf count, T-1), count and every
// dim's sum, each RECOMPUTED from the two children (C-45 / I-2). One pull.
function ygPullW(v, x) {
  const l = v._left[x];
  const r = v._right[x];
  const weight = v._weight;
  const count = v._count;
  const llen = v._llen;
  weight[x] = (l < 0 ? 1 : weight[l]) + (r < 0 ? 1 : weight[r]);
  count[x] = (l < 0 ? llen[~l] : count[l]) + (r < 0 ? llen[~r] : count[r]);
  const dims = v._ar.dims;
  for (let d = 0; d < dims; d++) {
    const S = v._sums[d];
    const LS = v._lsum[d];
    S[x] = (l < 0 ? LS[~l] : S[l]) + (r < 0 ? LS[~r] : S[r]);
  }
}

// One H-Y rotation at x (gamma = 2, strict: single iff w(inner) < 2*w(outer),
// T-2). x keeps its id as the subtree top, so the parent's link and the path
// above stay valid; the lower node(s) are reused. Returns the pulls it ran.
function ygRotate(v, x, wl, wr) {
  const left = v._left;
  const right = v._right;
  const weight = v._weight;
  const cn = v._n;
  if (wr > wl) {
    const y = right[x];
    const yl = left[y];
    const yr = right[y];
    if ((yl < 0 ? 1 : weight[yl]) < 2 * (yr < 0 ? 1 : weight[yr])) {
      // single left: (A, (yl, yr)) -> ((A, yl), yr)
      left[y] = left[x];
      right[y] = yl;
      left[x] = y;
      right[x] = yr;
      ygPullW(v, y);
      ygPullW(v, x);
      cn[YG_ROTS] += 1;
      return 2;
    }
    // double left: (A, ((zl, zr), yr)) -> ((A, zl), (zr, yr))
    const z = yl;
    const zl = left[z];
    const zr = right[z];
    left[z] = left[x];
    right[z] = zl;
    left[y] = zr;
    left[x] = z;
    right[x] = y;
    ygPullW(v, z);
    ygPullW(v, y);
    ygPullW(v, x);
    cn[YG_ROTD] += 1;
    return 3;
  }
  const y = left[x];
  const yl = left[y];
  const yr = right[y];
  if ((yr < 0 ? 1 : weight[yr]) < 2 * (yl < 0 ? 1 : weight[yl])) {
    // single right: ((yl, yr), C) -> (yl, (yr, C))
    left[y] = yr;
    right[y] = right[x];
    left[x] = yl;
    right[x] = y;
    ygPullW(v, y);
    ygPullW(v, x);
    cn[YG_ROTS] += 1;
    return 2;
  }
  // double right: ((yl, (zl, zr)), C) -> ((yl, zl), (zr, C))
  const z = yr;
  const zl = left[z];
  const zr = right[z];
  right[y] = zl;
  left[z] = zr;
  right[z] = right[x];
  left[x] = y;
  right[x] = z;
  ygPullW(v, y);
  ygPullW(v, z);
  ygPullW(v, x);
  cn[YG_ROTD] += 1;
  return 3;
}

// Structural re-home (C-3, 0005 A4-10 (a)): a cold descent to element i by the
// element rule (i < count[left] goes left), writing _fpath[0..d') and
// _fl / _fb / _fdepth. Returns d' (its pushes are touches, C-25).
function ygHome(v, i) {
  const left = v._left;
  const right = v._right;
  const count = v._count;
  const llen = v._llen;
  const fpath = v._fpath;
  let ref = v._root;
  let q = i;
  let depth = 0;
  while (ref >= 0) {
    fpath[depth] = ref;
    depth++;
    const l = left[ref];
    const c = l < 0 ? llen[~l] : count[l];
    if (q < c) {
      ref = l;
    } else {
      q -= c;
      ref = right[ref];
    }
  }
  v._fl = ref;
  v._fb = i - q;
  v._fdepth = depth;
  return depth;
}

// Insert into a full leaf: the Table 3 split (C-18 sizes and moves; C-19 no
// front gap). The left part stays in leaf id, the fresh leaf f is the right
// part. Then one fresh internal node u = (id, f) replaces the leaf ref, the
// cold weight pull runs over _fpath[depth-1..0] with the T-2 balance check
// (pulls <= 4(H+1), C-20), and the structural re-home descends to at.
// touches = depth + d' (C-25, p = 2). Both pools are checked read-only before
// the first write (R-E4); a failing check drops the finger to NIL / 0 / 0
// (R-P2); under C-15 neither check fires.
function ygSplit(v, at, e, id, p, depth) {
  const ar = v._ar;
  const hdr = v._hdr;
  if ((hdr[YG_LFREE] === YG_END) & !(hdr[YG_LBUMP] < ar.Lmax)) ygPoolFail(v, 'leaf pool exhausted');
  if ((hdr[YG_IFREE] === YG_END) & !(hdr[YG_IBUMP] < ar.Lmax - 1)) ygPoolFail(v, 'internal pool exhausted');
  // ---- first write ----
  const f = ygAllocLeaf(v);
  const u = ygAllocInt(v);
  const B = ar.B;
  const m = ar.m;
  const n = v._len;
  const fb = at - p;
  let a; // the left part's size (Table 3 via C-18)
  if ((p === B) & (fb + B === n)) a = B + 1 - m; // append split (last leaf)
  else if ((p === 0) & (fb === 0)) a = m; // prepend split (first leaf)
  else a = 2 * p <= B ? (B >> 1) + 1 : B >> 1; // interior: the new element's own half
  const bo = id << ar.shift;
  const bf = f << ar.shift;
  const nr = B + 1 - a;
  // Virtual sequence c[0..B]: old[0..p), new, old[p..B). Right part c[a..B]
  // first (it reads old slots the left shift overwrites), then the left shift.
  const ent = v._ent;
  for (let t = 0; t < nr; t++) {
    const j = a + t;
    ent[bf + t] = j === p ? e : ent[bo + (j < p ? j : j - 1)];
  }
  if (p < a) {
    for (let j = a - 1; j > p; j--) ent[bo + j] = ent[bo + j - 1];
    ent[bo + p] = e;
  }
  const sx = ar.sx;
  const dims = ar.dims;
  for (let d = 0; d < dims; d++) {
    const col = v._meas[d];
    for (let t = 0; t < nr; t++) {
      const j = a + t;
      if (j === p) col[bf + t] = sx[d];
      else col[bf + t] = col[bo + (j < p ? j : j - 1)];
    }
    if (p < a) {
      for (let j = a - 1; j > p; j--) col[bo + j] = col[bo + j - 1];
      col[bo + p] = sx[d];
    }
    const LS = v._lsum[d];
    let s = 0;
    for (let j = 0; j < a; j++) s += col[bo + j];
    LS[id] = s; // recount (C-45)
    s = 0;
    for (let j = 0; j < nr; j++) s += col[bf + j];
    LS[f] = s;
  }
  const llen = v._llen;
  llen[id] = a;
  llen[f] = nr;
  const left = v._left;
  const right = v._right;
  const weight = v._weight;
  left[u] = ~id;
  right[u] = ~f;
  ygPullW(v, u);
  const fpath = v._fpath;
  if (depth === 0) {
    v._root = u;
  } else {
    const par = fpath[depth - 1];
    if (left[par] === ~id) left[par] = u;
    else right[par] = u;
  }
  hdr[YG_LIVE] += 1;
  v._len = n + 1;
  let pulls = 1;
  for (let q = depth - 1; q >= 0; q--) {
    const x = fpath[q];
    ygPullW(v, x);
    pulls++;
    const xl = left[x];
    const xr = right[x];
    const wl = xl < 0 ? 1 : weight[xl];
    const wr = xr < 0 ? 1 : weight[xr];
    if ((3 * wl < wr) | (3 * wr < wl)) pulls += ygRotate(v, x, wl, wr);
  }
  const d2 = ygHome(v, at);
  const cn = v._n;
  cn[YG_TOUCHES] += depth + d2;
  cn[YG_PULLS] += pulls;
  cn[YG_MOVES] += p < a ? B - p : B - a;
  cn[YG_SPLITS] += 1;
  cn[YG_MISSES] += 1;
}

// ---- remove side: T-6 underflow, repair, delete rebalance (cold; C-18, C-20, C-21, C-25, M-5) ----

// Count + sums pull of one internal node, no weight read or write (C-20: an
// equalize, and the neighbour side of a merge, change no leaf count). Each
// value RECOMPUTED from the two children (C-45 / I-2). One pull.
function ygPullC(v, x) {
  const l = v._left[x];
  const r = v._right[x];
  const count = v._count;
  const llen = v._llen;
  count[x] = (l < 0 ? llen[~l] : count[l]) + (r < 0 ? llen[~r] : count[r]);
  const dims = v._ar.dims;
  for (let d = 0; d < dims; d++) {
    const S = v._sums[d];
    const LS = v._lsum[d];
    S[x] = (l < 0 ? LS[~l] : S[l]) + (r < 0 ? LS[~r] : S[r]);
  }
}

// Recount one leaf's sum in every dim from its slots (C-45).
function ygRecount(v, id) {
  const ar = v._ar;
  const b = id << ar.shift;
  const end = b + v._llen[id];
  for (let d = 0; d < ar.dims; d++) {
    const col = v._meas[d];
    let s = 0;
    for (let j = b; j < end; j++) s += col[j];
    v._lsum[d][id] = s;
  }
}

// Move len slots (entity + every measure column) from slot `from` to slot
// `to`; overlap-safe (copyWithin), allocation-free.
function ygMove(v, to, from, len) {
  if (len === 0) return;
  v._ent.copyWithin(to, from, from + len);
  const dims = v._ar.dims;
  for (let d = 0; d < dims; d++) v._meas[d].copyWithin(to, from, from + len);
}

// The ONE repair(u, w, uLeft) (T-6; T-7 seams of rung S-R2 reuse it, M-5,
// C-21). u is a leaf of any size s in [0, m-1], w its neighbour leaf, uLeft = 1
// iff u precedes w in sequence order. (su, du): the path to u, su[du-1] =
// parent(u) (du = 0: u is vu's root leaf). (sv, dv): the path to w. The first
// sh entries are nodes both paths share: one tree (T-6) sh = du, the neighbour
// walk wrote sv[du..dv) after it; two trees (a seam) sh = 0. vu is the view
// whose tree holds u (its _root moves when the merge splices a root parent(u)
// or frees a root leaf u); v reads the columns and counts. t = s(u) + s(w):
//   merge (2t <= B): w takes the pair's t elements in order; u and parent(u)
//     are freed (leaf + internal pools), sibling(u) replaces parent(u); then
//     the delete rebalance: weight pull with the T-2 check (ygRotate, H-Y
//     gamma = 2) up u's spine su[du-2..0] (C-20 cold rebalance).
//   equalize: left leaf floor(t/2), right ceil(t/2); no weight changes, so
//     pulls == |anc(u) U anc(w)| (C-20).
// Returns the C-18 rep moves: merge uLeft ? (sL ? t : 0) : sR; equalize
// uLeft ? sR : ceil(t/2). _len, hdr live and the finger are the caller's.
function ygRepair(v, vu, u, w, uLeft, su, du, sv, dv, sh) {
  const ar = v._ar;
  const shift = ar.shift;
  const llen = v._llen;
  const lid = uLeft !== 0 ? u : w;
  const rid = uLeft !== 0 ? w : u;
  const sL = llen[lid];
  const sR = llen[rid];
  const t = sL + sR;
  const bl = lid << shift;
  const br = rid << shift;
  const merge = 2 * t <= ar.B;
  let rep;
  if (merge) {
    if (uLeft !== 0) {
      ygMove(v, br + sL, br, sR);
      ygMove(v, br, bl, sL);
      rep = sL > 0 ? t : 0;
    } else {
      ygMove(v, bl + sL, br, sR);
      rep = sR;
    }
    llen[w] = t;
    ygRecount(v, w);
  } else {
    const h = t >> 1;
    if (sL < h) {
      ygMove(v, bl + sL, br, h - sL);
      ygMove(v, br, br + h - sL, sR - (h - sL));
      rep = sR;
    } else {
      ygMove(v, br + sL - h, br, sR);
      ygMove(v, br, bl + h, sL - h);
      rep = sR + sL - h;
    }
    llen[lid] = h;
    llen[rid] = t - h;
    ygRecount(v, lid);
    ygRecount(v, rid);
  }
  // w's own path below the shared part: count + sums (its leaf count is kept)
  let pulls = 0;
  for (let q = dv - 1; q >= sh; q--) {
    ygPullC(v, sv[q]);
    pulls++;
  }
  const cn = v._n;
  if (merge) {
    ygFreeLeaf(v, u);
    if (du === 0) {
      vu._root = YG_EMPTY_ROOT;
    } else {
      const left = v._left;
      const right = v._right;
      const weight = v._weight;
      const par = su[du - 1];
      const sib = left[par] === ~u ? right[par] : left[par];
      if (du === 1) {
        vu._root = sib;
      } else {
        const g = su[du - 2];
        if (left[g] === par) left[g] = sib;
        else right[g] = sib;
      }
      ygFreeInt(v, par); // merge frees parent(u)
      for (let q = du - 2; q >= 0; q--) {
        const x = su[q];
        ygPullW(v, x);
        pulls++;
        const xl = left[x];
        const xr = right[x];
        const lw = xl < 0 ? 1 : weight[xl];
        const rw = xr < 0 ? 1 : weight[xr];
        if ((3 * lw < rw) | (3 * rw < lw)) pulls += ygRotate(v, x, lw, rw); // T-2, delete side
      }
    }
    cn[YG_MERGES] += 1;
  } else {
    for (let q = du - 1; q >= 0; q--) {
      ygPullC(v, su[q]); // equalize: no weight change
      pulls++;
    }
    cn[YG_EQUALIZES] += 1;
  }
  cn[YG_PULLS] += pulls;
  return rep;
}

// removeAt from a leaf u of a multi-leaf view that holds exactly m elements
// (C-18 "remove that underflows"), reached from the hot body after its descent
// wrote _fpath[0..D), D >= 1, and before any write. Removes the element at
// in-leaf position p; the T-6 neighbour walk from sibling(u) writes
// _fpath[D..dv), exactly the path to the in-order neighbour w on u's sibling
// side (its pushes are touches); repair(u, w); then the structural re-home: a
// cold descent to min(i, length-1) by the element rule (C-3).
// touches = d(w) + d'(t') (C-25), moves = (m-1-p) + rep (C-18), one miss.
function ygUnder(v, at, id, p, D) {
  const ar = v._ar;
  const base = id << ar.shift;
  const len = v._llen[id];
  const e = v._ent[base + p];
  ygMove(v, base + p, base + p + 1, len - 1 - p);
  v._llen[id] = len - 1;
  const left = v._left;
  const right = v._right;
  const fpath = v._fpath;
  const par = fpath[D - 1];
  const uLeft = left[par] === ~id ? 1 : 0;
  let ref = uLeft !== 0 ? right[par] : left[par];
  let dv = D;
  while (ref >= 0) {
    fpath[dv] = ref;
    dv++;
    ref = uLeft !== 0 ? left[ref] : right[ref];
  }
  const rep = ygRepair(v, v, id, ~ref, uLeft, fpath, D, fpath, dv, D);
  const n = v._len;
  v._hdr[YG_LIVE] -= 1;
  v._len = n - 1;
  const d2 = ygHome(v, Math.min(at, n - 2));
  const cn = v._n;
  cn[YG_TOUCHES] += dv + d2;
  cn[YG_MISSES] += 1;
  cn[YG_MOVES] += len - 1 - p + rep;
  return e;
}

// ---- join and append (cold; 0001 T-3, C-21, C-24, C-25, M-3) ----------------------

// T-3 join rotation at x after joinRight replaced right[x] (BFS's own rule, no
// gamma): single left iff both new nodes (l, yl) and ((l, yl), yr) pass I-1,
// else double left. x keeps its id as the subtree top. wl = w(left[x]).
// Returns the pulls it ran.
function ygJoinRotL(v, x, wl) {
  const left = v._left;
  const right = v._right;
  const weight = v._weight;
  const cn = v._n;
  const y = right[x];
  const yl = left[y];
  const yr = right[y];
  const a = yl < 0 ? 1 : weight[yl];
  const b = yr < 0 ? 1 : weight[yr];
  const s = wl + a;
  if ((3 * wl >= a) & (3 * a >= wl) & (3 * s >= b) & (3 * b >= s)) {
    // single left: (A, (yl, yr)) -> ((A, yl), yr)
    left[y] = left[x];
    right[y] = yl;
    left[x] = y;
    right[x] = yr;
    ygPullW(v, y);
    ygPullW(v, x);
    cn[YG_ROTS] += 1;
    return 2;
  }
  // double left: (A, ((zl, zr), yr)) -> ((A, zl), (zr, yr))
  const z = yl;
  const zl = left[z];
  const zr = right[z];
  left[z] = left[x];
  right[z] = zl;
  left[y] = zr;
  left[x] = z;
  right[x] = y;
  ygPullW(v, z);
  ygPullW(v, y);
  ygPullW(v, x);
  cn[YG_ROTD] += 1;
  return 3;
}

// Mirror of ygJoinRotL after joinLeft replaced left[x]: single right iff both
// new nodes (yr, C) and (yl, (yr, C)) pass I-1, else double right.
// wr = w(right[x]). Returns the pulls it ran.
function ygJoinRotR(v, x, wr) {
  const left = v._left;
  const right = v._right;
  const weight = v._weight;
  const cn = v._n;
  const y = left[x];
  const yl = left[y];
  const yr = right[y];
  const a = yr < 0 ? 1 : weight[yr];
  const b = yl < 0 ? 1 : weight[yl];
  const s = wr + a;
  if ((3 * wr >= a) & (3 * a >= wr) & (3 * s >= b) & (3 * b >= s)) {
    // single right: ((yl, yr), C) -> (yl, (yr, C))
    left[y] = yr;
    right[y] = right[x];
    left[x] = yl;
    right[x] = y;
    ygPullW(v, y);
    ygPullW(v, x);
    cn[YG_ROTS] += 1;
    return 2;
  }
  // double right: ((yl, (zl, zr)), C) -> ((yl, zl), (zr, C))
  const z = yr;
  const zl = left[z];
  const zr = right[z];
  right[y] = zl;
  left[z] = zr;
  right[z] = right[x];
  left[x] = y;
  right[x] = z;
  ygPullW(v, y);
  ygPullW(v, z);
  ygPullW(v, x);
  cn[YG_ROTD] += 1;
  return 3;
}

// T-3 join(a, b) of two non-empty trees of one arena (refs; a precedes b):
// iterative BFS joinRight / joinLeft. Push the heavier tree's spine (right
// spine of a, left spine of b) onto the arena join stack jstack until the
// first node c balanced (I-1) against the other tree; the caller's internal
// node u becomes (c, b) or (a, c) (append: a fresh ygAllocInt node, its pool
// pre-checked; splitAt: the popped path node, reused per T-4, so a split's
// joins allocate nothing); pop back up, relinking and recomputing weight,
// count and every dim's sum (ygPullW), keeping each node that passes I-1 and
// rotating it otherwise (ygJoinRotL / ygJoinRotR). joinSteps += internal
// nodes pushed (C-24); the spine steps are not touches (C-25). Pulls per R-J1
// (C-20): 1 for u + 1 per popped node + 2 / 3 per rotation. Returns the root
// ref of the joined tree.
function ygJoin(v, a, b, u) {
  const left = v._left;
  const right = v._right;
  const weight = v._weight;
  const js = v._ar.jstack;
  const wa = a < 0 ? 1 : weight[a];
  const wb = b < 0 ? 1 : weight[b];
  const heavyA = 3 * wb < wa ? 1 : 0;
  let c = heavyA !== 0 ? a : b;
  let wc = heavyA !== 0 ? wa : wb;
  const wo = heavyA !== 0 ? wb : wa;
  let top = 0;
  while (!((3 * wc >= wo) & (3 * wo >= wc))) {
    js[top] = c;
    top++;
    c = heavyA !== 0 ? right[c] : left[c];
    wc = c < 0 ? 1 : weight[c];
  }
  left[u] = heavyA !== 0 ? c : a;
  right[u] = heavyA !== 0 ? b : c;
  ygPullW(v, u);
  let pulls = 1;
  let cur = u;
  for (let q = top - 1; q >= 0; q--) {
    const p = js[q];
    if (heavyA !== 0) right[p] = cur;
    else left[p] = cur;
    ygPullW(v, p);
    pulls++;
    const l = left[p];
    const r = right[p];
    const wl = l < 0 ? 1 : weight[l];
    const wr = r < 0 ? 1 : weight[r];
    if (!((3 * wl >= wr) & (3 * wr >= wl))) {
      pulls += heavyA !== 0 ? ygJoinRotL(v, p, wl) : ygJoinRotR(v, p, wr);
    }
    cur = p;
  }
  const cn = v._n;
  cn[YG_JOINS] += top;
  cn[YG_PULLS] += pulls;
  return cur;
}

// append's tree work for two non-empty views (C-21, R-E5): descend to v's last
// leaf (pushes into sstack, d_a) and to o's first leaf (d_b); touches +=
// d_a + d_b (C-25). If a seam leaf is < m, ONE repair before the join: u = the
// short seam leaf (the right one if both are short), w = the other one, sh = 0;
// o's seam path is written into jstack only then (the join stack is otherwise
// the join's own). A merge that empties a one-leaf operand makes the join the
// identity. Returns the result root ref; _len, live and the finger are append's.
function ygSeamJoin(v, o) {
  const ar = v._ar;
  const left = v._left;
  const right = v._right;
  const llen = v._llen;
  const ss = ar.sstack;
  const js = ar.jstack;
  let ra = v._root;
  let da = 0;
  while (ra >= 0) {
    ss[da] = ra;
    da++;
    ra = right[ra];
  }
  let rb = o._root;
  let db = 0;
  while (rb >= 0) {
    db++;
    rb = left[rb];
  }
  const cn = v._n;
  cn[YG_TOUCHES] += da + db;
  const m = ar.m;
  const la = llen[~ra];
  const lb = llen[~rb];
  if ((la < m) | (lb < m)) {
    let x = o._root;
    for (let q = 0; q < db; q++) {
      js[q] = x;
      x = left[x];
    }
    let rep;
    if (lb < m) rep = ygRepair(v, o, ~rb, ~ra, 0, js, db, ss, da, 0);
    else rep = ygRepair(v, v, ~ra, ~rb, 1, ss, da, js, db, 0);
    cn[YG_MOVES] += rep;
    cn[YG_SEAMS] += 1;
  }
  const a = v._root;
  const b = o._root;
  if (a === YG_EMPTY_ROOT) return b;
  if (b === YG_EMPTY_ROOT) return a;
  return ygJoin(v, a, b, ygAllocInt(v));
}

// ---- splitAt (cold; 0001 T-4, C-18, C-21, C-24, C-25, M-3) ------------------------

// splitAt's tree work for 0 < at < length, after splitAt's descent wrote the
// path to leaf c into sstack[0..d) and the pool pre-check passed. Cut c at
// in-leaf position p (C-18): p > 0 moves [p, s) into one fresh leaf f (the left
// part stays in c; s - p moves); p = 0 (a leaf boundary) moves nothing. Then
// pop the path (T-4): a node x reached by its left child joins its right
// subtree onto the right result, one reached by its right child joins its left
// subtree before the left result, x itself being that join's node (ygJoin
// with u = x; no allocation). The one identity join of a boundary cut (the
// first x reached from the right, while the left result is still empty)
// consumes no node: x is freed. Then the C-21 repairs, rX = [result X has
// >= 2 leaves and its seam leaf < m], decided from the result's root and the
// cut sizes (no seam search; a boundary cut never repairs). Writes both roots;
// _len and the fingers are splitAt's; live is unchanged. Counters into v._n (RS-1).
function ygSplitCut(v, o, c, p, d) {
  const ar = v._ar;
  const left = v._left;
  const right = v._right;
  const llen = v._llen;
  const ss = ar.sstack;
  const s = llen[c];
  let lt = YG_EMPTY_ROOT;
  let rt = ~c;
  if (p !== 0) {
    const f = ygAllocLeaf(v);
    ygMove(v, f << ar.shift, (c << ar.shift) + p, s - p);
    llen[c] = p;
    llen[f] = s - p;
    ygRecount(v, c);
    ygRecount(v, f);
    v._n[YG_MOVES] += s - p;
    lt = ~c;
    rt = ~f;
  }
  let child = ~c;
  for (let q = d - 1; q >= 0; q--) {
    const x = ss[q];
    const xl = left[x];
    if (xl === child) {
      rt = ygJoin(v, rt, right[x], x);
    } else if (lt === YG_EMPTY_ROOT) {
      lt = xl;
      ygFreeInt(v, x);
    } else {
      lt = ygJoin(v, xl, lt, x);
    }
    child = x;
  }
  v._root = lt;
  o._root = rt;
  if (p !== 0) {
    const m = ar.m;
    if ((lt >= 0) & (p < m)) ygSplitSeam(v, v, 0);
    if ((rt >= 0) & (s - p < m)) ygSplitSeam(v, o, 1);
  }
}

// One C-21 seam repair of a splitAt result (a multi-leaf tree of view vu):
// u = its last leaf (uLeft = 0, the left result) or its first leaf (uLeft = 1,
// the right result), pushed into sstack[0..du); the T-6 walk from sibling(u)
// pushes sstack[du..dv) to the neighbour w; repair(u, w) with sh = du (one
// tree). touches += dv (the seam search, C-25); moves += rep (C-18).
function ygSplitSeam(v, vu, uLeft) {
  const left = v._left;
  const right = v._right;
  const ss = v._ar.sstack;
  let ref = vu._root;
  let du = 0;
  while (ref >= 0) {
    ss[du] = ref;
    du++;
    ref = uLeft !== 0 ? left[ref] : right[ref];
  }
  const u = ~ref;
  const par = ss[du - 1];
  ref = uLeft !== 0 ? right[par] : left[par];
  let dv = du;
  while (ref >= 0) {
    ss[dv] = ref;
    dv++;
    ref = uLeft !== 0 ? left[ref] : right[ref];
  }
  const rep = ygRepair(v, vu, u, ~ref, uLeft, ss, du, ss, dv, du);
  const cn = v._n;
  cn[YG_TOUCHES] += dv;
  cn[YG_MOVES] += rep;
  cn[YG_SEAMS] += 1;
}

// ---- the view ---------------------------------------------------------------------

export class SumSequence {
  // Counter indexes (C-24, R-D2; 0003 counters table).
  static COUNTERS = Object.freeze({
    touches: 0, pulls: 1, moves: 2, splits: 3, merges: 4, equalizes: 5,
    rotSingle: 6, rotDouble: 7, fingerHits: 8, fingerMisses: 9, joinSteps: 10,
    seamRepairs: 11,
  });

  // The private brand of a view (C-10 RS-6 operand check: `#yg in o`). A
  // method, not a field: no stored value, and every view (ctor and arena
  // paths alike) gets it the same way, so the one hidden class stays (MS-2).
  #yg() {}

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

  // ---- positional ops (C-4, C-10, C-12; finger M-1, C-3, C-5, C-26) ---------------
  // After every C-10 check, the finger hit test (C-4) from _fl / _fb / _fdepth
  // and llen[~_fl], NIL tested first: insertAt hits iff lo < i <= fb+len and
  // len < B (lo = fb - ((fb-1)>>>31): -1 on the first leaf, else fb); removeAt
  // iff fb <= i < fb+len and len > (_fdepth === 0 ? 1 : m) (no underflow, no
  // drain; n === 1 drains before the test); setMeasure / getMeasure / entityAt
  // iff fb <= i < fb+len. A hit takes the leaf, fb, depth and _fpath as they
  // are (a hit is non-structural: none of them changes) and skips the descent.
  // A miss runs ONE descent from _root writing this._fpath[0..d): insertAt by
  // the T-5 insert rule (k <= count[left] goes left), every other op by the
  // element rule (k < count[left]). A root-leaf view runs no loop (d = 0).
  // Then the leaf work and, for a non-structural mutation, ONE hot pull pass
  // over _fpath (count + sums recomputed from the children, no weight read;
  // pulls == d on a hit and a miss alike, C-20, C-45). The only branch to cold
  // structural code is a miss: insertAt into a full leaf (ygSplit), removeAt
  // from a leaf of length m when the view has >= 2 leaves (ygUnder, T-6).
  // Every op re-homes to the touched leaf (a hit rewrites the same values).
  // h = 1 on a hit: touches += d & (h - 1) (0 on a hit, d on a miss, C-25) and
  // slot YG_MISSES - h (fingerHits = 8, fingerMisses = 9) += 1 (C-26).
  // Counters are bumped after the loops (0003 G-5 / G-7).

  insertAt(i, e, m0, m1, m2, m3) {
    const n = this._len;
    if (typeof i !== 'number') ygFail('index', 'must be a number');
    if (((i >>> 0) !== i) | (i > n)) ygFail('index', 'must be an integer in [0, length]');
    const at = i >>> 0;
    if (typeof e !== 'number' || (e & 0x3FFFFFFF) !== e) ygFail('entity', 'must be an integer in [0, 2^30-1]');
    if (typeof m0 !== 'number') ygFail('measure', 'must be a number');
    if (!((m0 >= 0) & (m0 <= YG_MAX))) ygFail('measure', 'must be in [0, 2^53-1]');
    if (!Number.isInteger(m0)) ygFail('measure', 'must be an integer');
    const ar = this._ar;
    const dims = ar.dims;
    const sx = ar.sx;
    if (dims > 1) {
      // R-Q1 (A6-1, C-44): typeof of slots 1..dims-1 before any store into sx
      if ((typeof m1 !== 'number') | ((dims > 2) & (typeof m2 !== 'number')) |
          ((dims > 3) & (typeof m3 !== 'number'))) {
        ygFail('measure', 'must be a number');
      }
      sx[1] = m1 + 0;
      if (dims > 2) sx[2] = m2 + 0;
      if (dims > 3) sx[3] = m3 + 0;
    }
    const xs = ((m1 !== undefined) & (dims < 2)) | ((m2 !== undefined) & (dims < 3)) |
        ((m3 !== undefined) & (dims < 4));
    if (xs | (dims > 1)) ygSlots(ar, xs);
    const hdr = this._hdr;
    if (!(hdr[YG_LIVE] < ar.C)) ygFail('capacity', 'live + 1 > C');
    const r = this._root;
    const t0 = r === YG_EMPTY_ROOT ? 0 : r < 0 ? this._lsum[0][~r] : this._sums[0][r];
    sx[0] = m0 + 0; // staged (scratch, not state; -0 -> +0, 0002 M-2)
    if ((m0 > YG_MAX - t0) | (dims > 1)) ygHeadroomIns(this);
    const left = this._left;
    const right = this._right;
    const count = this._count;
    const llen = this._llen;
    const fpath = this._fpath;
    const fb = this._fb;
    let ref = this._fl;
    let k = at;
    let depth = 0;
    let len = 0;
    let h = 0;
    if (ref !== YG_NIL && fb - ((fb - 1) >>> 31) < at && at <= fb + (len = llen[~ref]) && len < ar.B) {
      k = at - fb; // C-4 hit: i in (fb, fb+len], [0, len] on the first leaf
      depth = this._fdepth;
      h = 1;
    } else {
      if (r === YG_EMPTY_ROOT) {
        ygFirstLeaf(this, e);
        return;
      }
      ref = r;
      while (ref >= 0) {
        fpath[depth] = ref;
        depth++;
        const l = left[ref];
        const cl = l < 0 ? llen[~l] : count[l];
        if (k <= cl) {
          ref = l;
        } else {
          k -= cl;
          ref = right[ref];
        }
      }
      len = llen[~ref];
      if (len === ar.B) {
        ygSplit(this, at, e, ~ref, k, depth);
        return;
      }
    }
    const id = ~ref;
    // ---- leaf write ----
    const base = id << ar.shift;
    const p = base + k;
    const end = base + len;
    const ent = this._ent;
    for (let j = end; j > p; j--) ent[j] = ent[j - 1];
    ent[p] = e;
    const meas = this._meas;
    const lsum = this._lsum;
    for (let d = 0; d < dims; d++) {
      const col = meas[d];
      for (let j = end; j > p; j--) col[j] = col[j - 1];
      col[p] = sx[d];
      let s = 0;
      for (let j = base; j <= end; j++) s += col[j];
      lsum[d][id] = s;
    }
    llen[id] = len + 1;
    const sums = this._sums;
    for (let q = depth - 1; q >= 0; q--) {
      const u = fpath[q];
      const l = left[u];
      const rr = right[u];
      count[u] = (l < 0 ? llen[~l] : count[l]) + (rr < 0 ? llen[~rr] : count[rr]);
      for (let d = 0; d < dims; d++) {
        const S = sums[d];
        const LS = lsum[d];
        S[u] = (l < 0 ? LS[~l] : S[l]) + (rr < 0 ? LS[~rr] : S[rr]);
      }
    }
    hdr[YG_LIVE] += 1;
    this._len = n + 1;
    this._fl = ref;
    this._fb = at - k;
    this._fdepth = depth;
    const cn = this._n;
    cn[YG_TOUCHES] += depth & (h - 1);
    cn[YG_PULLS] += depth;
    cn[YG_MISSES - h] += 1;
    cn[YG_MOVES] += len - k;
  }

  removeAt(i) {
    const n = this._len;
    if (typeof i !== 'number') ygFail('index', 'must be a number');
    if (((i >>> 0) !== i) | (i >= n)) ygFail('index', 'must be an integer in [0, length)');
    const at = i >>> 0;
    const r = this._root;
    const ar = this._ar;
    const ent = this._ent;
    if (n === 1) {
      const e1 = ent[~r << ar.shift];
      ygDrain(this, ~r);
      return e1;
    }
    const left = this._left;
    const right = this._right;
    const count = this._count;
    const llen = this._llen;
    const fpath = this._fpath;
    const fb = this._fb;
    let ref = this._fl;
    let k = at;
    let depth = 0;
    let len = 0;
    let h = 0;
    if (ref !== YG_NIL && fb <= at && at < fb + (len = llen[~ref]) &&
        len > (this._fdepth === 0 ? 1 : ar.m)) {
      k = at - fb; // C-4 hit: i in [fb, fb+len), no underflow, no drain
      depth = this._fdepth;
      h = 1;
    } else {
      ref = r;
      while (ref >= 0) {
        fpath[depth] = ref;
        depth++;
        const l = left[ref];
        const cl = l < 0 ? llen[~l] : count[l];
        if (k < cl) {
          ref = l;
        } else {
          k -= cl;
          ref = right[ref];
        }
      }
      len = llen[~ref];
      if ((len === ar.m) & (depth !== 0)) return ygUnder(this, at, ~ref, k, depth);
    }
    const id = ~ref;
    // ---- leaf write ----
    const base = id << ar.shift;
    const p = base + k;
    const e = ent[p];
    const last = base + len - 1;
    for (let j = p; j < last; j++) ent[j] = ent[j + 1];
    const meas = this._meas;
    const lsum = this._lsum;
    const dims = ar.dims;
    for (let d = 0; d < dims; d++) {
      const col = meas[d];
      for (let j = p; j < last; j++) col[j] = col[j + 1];
      let s = 0;
      for (let j = base; j < last; j++) s += col[j];
      lsum[d][id] = s;
    }
    llen[id] = len - 1;
    const sums = this._sums;
    for (let q = depth - 1; q >= 0; q--) {
      const u = fpath[q];
      const l = left[u];
      const rg = right[u];
      count[u] = (l < 0 ? llen[~l] : count[l]) + (rg < 0 ? llen[~rg] : count[rg]);
      for (let d = 0; d < dims; d++) {
        const S = sums[d];
        const LS = lsum[d];
        S[u] = (l < 0 ? LS[~l] : S[l]) + (rg < 0 ? LS[~rg] : S[rg]);
      }
    }
    this._hdr[YG_LIVE] -= 1;
    this._len = n - 1;
    this._fl = ref;
    this._fb = at - k;
    this._fdepth = depth;
    const cn = this._n;
    cn[YG_TOUCHES] += depth & (h - 1);
    cn[YG_PULLS] += depth;
    cn[YG_MISSES - h] += 1;
    cn[YG_MOVES] += len - 1 - k;
    return e;
  }

  setMeasure(i, d, m) {
    const n = this._len;
    if (typeof i !== 'number') ygFail('index', 'must be a number');
    if (((i >>> 0) !== i) | (i >= n)) ygFail('index', 'must be an integer in [0, length)');
    const at = i >>> 0;
    const ar = this._ar;
    if (typeof d !== 'number' || (((d >>> 0) !== d) | (d >= ar.dims))) {
      ygFail('dim', 'must be an integer in [0, dims)');
    }
    const dd = d >>> 0;
    if (typeof m !== 'number') ygFail('measure', 'must be a number');
    if (!((m >= 0) & (m <= YG_MAX))) ygFail('measure', 'must be in [0, 2^53-1]');
    if (!Number.isInteger(m)) ygFail('measure', 'must be an integer');
    const r = this._root;
    const sc = this._sums[dd];
    const ls = this._lsum[dd];
    const t = r < 0 ? ls[~r] : sc[r];
    if (m > YG_MAX - t) {
      ar.sx[0] = m;
      ygSetHeadroom(this, at, dd);
    }
    // ---- first write ----
    const left = this._left;
    const right = this._right;
    const count = this._count;
    const llen = this._llen;
    const fpath = this._fpath;
    const fb = this._fb;
    let ref = this._fl;
    let k = at;
    let depth = 0;
    let h = 0;
    if (ref !== YG_NIL && fb <= at && at < fb + llen[~ref]) {
      k = at - fb; // C-4 hit: i in [fb, fb+len)
      depth = this._fdepth;
      h = 1;
    } else {
      ref = r;
      while (ref >= 0) {
        fpath[depth] = ref;
        depth++;
        const l = left[ref];
        const cl = l < 0 ? llen[~l] : count[l];
        if (k < cl) {
          ref = l;
        } else {
          k -= cl;
          ref = right[ref];
        }
      }
    }
    const id = ~ref;
    const b0 = id << ar.shift;
    const col = this._meas[dd];
    col[b0 + k] = m + 0;
    const end = b0 + llen[id];
    let s = 0;
    for (let j = b0; j < end; j++) s += col[j];
    ls[id] = s;
    for (let q = depth - 1; q >= 0; q--) {
      const u = fpath[q];
      const l = left[u];
      const rt = right[u];
      sc[u] = (l < 0 ? ls[~l] : sc[l]) + (rt < 0 ? ls[~rt] : sc[rt]);
    }
    this._fl = ref;
    this._fb = at - k;
    this._fdepth = depth;
    const cn = this._n;
    cn[YG_TOUCHES] += depth & (h - 1);
    cn[YG_PULLS] += depth;
    cn[YG_MISSES - h] += 1;
  }

  getMeasure(i, d) {
    const n = this._len;
    if (typeof i !== 'number') ygFail('index', 'must be a number');
    if (((i >>> 0) !== i) | (i >= n)) ygFail('index', 'must be an integer in [0, length)');
    const at = i >>> 0;
    const ar = this._ar;
    if (typeof d !== 'number' || (((d >>> 0) !== d) | (d >= ar.dims))) {
      ygFail('dim', 'must be an integer in [0, dims)');
    }
    const left = this._left;
    const right = this._right;
    const count = this._count;
    const llen = this._llen;
    const fpath = this._fpath;
    const fb = this._fb;
    let ref = this._fl;
    let k = at;
    let depth = 0;
    let h = 0;
    if (ref !== YG_NIL && fb <= at && at < fb + llen[~ref]) {
      k = at - fb; // C-4 hit: i in [fb, fb+len)
      depth = this._fdepth;
      h = 1;
    } else {
      ref = this._root;
      while (ref >= 0) {
        fpath[depth] = ref;
        depth++;
        const l = left[ref];
        const cl = l < 0 ? llen[~l] : count[l];
        if (k < cl) {
          ref = l;
        } else {
          k -= cl;
          ref = right[ref];
        }
      }
    }
    const x = this._meas[d >>> 0][(~ref << ar.shift) + k];
    this._fl = ref;
    this._fb = at - k;
    this._fdepth = depth;
    const cn = this._n;
    cn[YG_TOUCHES] += depth & (h - 1);
    cn[YG_MISSES - h] += 1;
    return x;
  }

  entityAt(i) {
    const n = this._len;
    if (typeof i !== 'number') ygFail('index', 'must be a number');
    if (((i >>> 0) !== i) | (i >= n)) ygFail('index', 'must be an integer in [0, length)');
    const at = i >>> 0;
    const left = this._left;
    const right = this._right;
    const count = this._count;
    const llen = this._llen;
    const fpath = this._fpath;
    const fb = this._fb;
    let ref = this._fl;
    let k = at;
    let depth = 0;
    let h = 0;
    if (ref !== YG_NIL && fb <= at && at < fb + llen[~ref]) {
      k = at - fb; // C-4 hit: i in [fb, fb+len)
      depth = this._fdepth;
      h = 1;
    } else {
      ref = this._root;
      while (ref >= 0) {
        fpath[depth] = ref;
        depth++;
        const l = left[ref];
        const cl = l < 0 ? llen[~l] : count[l];
        if (k < cl) {
          ref = l;
        } else {
          k -= cl;
          ref = right[ref];
        }
      }
    }
    const e = this._ent[(~ref << this._ar.shift) + k];
    this._fl = ref;
    this._fb = at - k;
    this._fdepth = depth;
    const cn = this._n;
    cn[YG_TOUCHES] += depth & (h - 1);
    cn[YG_MISSES - h] += 1;
    return e;
  }

  // ---- seeks: one sum descent from the root, finger-neutral (C-2, I-4) ---------
  // touches += d(t) (C-25); an empty view runs no descent and touches 0 (RA-5).
  // acc and y stay in this body (C-13).

  // M-7: the smallest i with S_i + m_i > y (strict), else length. y >= total
  // goes right at every node and the leaf scan runs off the last leaf: length.
  indexAtSum(d, y) {
    const ar = this._ar;
    if (typeof d !== 'number' || (((d >>> 0) !== d) | (d >= ar.dims))) {
      ygFail('dim', 'must be an integer in [0, dims)');
    }
    if (typeof y !== 'number' || !((y >= 0) & (y < Infinity))) {
      ygFail('seek', 'must be a number in [0, Infinity)');
    }
    let ref = this._root;
    if (ref === YG_EMPTY_ROOT) return 0;
    const dd = d >>> 0;
    const left = this._left;
    const right = this._right;
    const count = this._count;
    const llen = this._llen;
    const sums = this._sums[dd];
    const lsum = this._lsum[dd];
    let acc = 0;
    let base = 0;
    let depth = 0;
    while (ref >= 0) {
      const l = left[ref];
      const sl = l < 0 ? lsum[~l] : sums[l];
      if (y < acc + sl) {
        ref = l;
      } else {
        acc += sl;
        base += l < 0 ? llen[~l] : count[l];
        ref = right[ref];
      }
      depth++;
    }
    const id = ~ref;
    const len = llen[id];
    const col = this._meas[dd];
    const b0 = id << ar.shift;
    let j = 0;
    while (j < len) {
      const m = col[b0 + j];
      if (acc + m > y) break;
      acc += m;
      j++;
    }
    this._n[YG_TOUCHES] += depth;
    return base + j;
  }

  // Sum of dim d over [0, i). The oracle order: index, then dim (C-10).
  sumBefore(d, i) {
    const n = this._len;
    if (typeof i !== 'number') ygFail('index', 'must be a number');
    if (((i >>> 0) !== i) | (i > n)) ygFail('index', 'must be an integer in [0, length]');
    const ar = this._ar;
    if (typeof d !== 'number' || (((d >>> 0) !== d) | (d >= ar.dims))) {
      ygFail('dim', 'must be an integer in [0, dims)');
    }
    let ref = this._root;
    if (ref === YG_EMPTY_ROOT) return 0;
    const dd = d >>> 0;
    const left = this._left;
    const right = this._right;
    const count = this._count;
    const llen = this._llen;
    const sums = this._sums[dd];
    const lsum = this._lsum[dd];
    let acc = 0;
    let k = i >>> 0;
    let depth = 0;
    while (ref >= 0) {
      const l = left[ref];
      const cl = l < 0 ? llen[~l] : count[l];
      if (k < cl) {
        ref = l;
      } else {
        acc += l < 0 ? lsum[~l] : sums[l];
        k -= cl;
        ref = right[ref];
      }
      depth++;
    }
    const col = this._meas[dd];
    const b0 = ~ref << ar.shift;
    for (let j = 0; j < k; j++) acc += col[b0 + j];
    this._n[YG_TOUCHES] += depth;
    return acc;
  }

  // ---- clear (C-8, 0004 A-6) ---------------------------------------------------------

  clear() {
    const hdr = this._hdr;
    if (this._len === hdr[YG_LIVE]) ygReset(hdr);
    else if (this._len !== 0) ygClearWalk(this);
    this._root = YG_EMPTY_ROOT;
    this._len = 0;
    this._fl = YG_NIL;
    this._fb = 0;
    this._fdepth = 0;
    this._cv = false;
    return this;
  }

  // ---- append (0004 A-4; C-3, C-5, C-6, C-10, C-21, C-24, C-25) ---------------------
  // this := this ++ other, other := empty; returns this. Every check before the
  // first write (RS-6 order): not a view, self, another arena, headroom (V-R4,
  // in-body, b = 0, C-13), then the R-E4 'pool' pre-check (one internal node
  // when both are non-empty; ygFail, so a throw changes nothing, A7-4). Live is
  // unchanged (elements move, none is created). Both fingers NIL / 0 / 0 and
  // both _cv false; counters into this._n only (RS-1).

  append(other) {
    if (other === null || typeof other !== 'object' || !(#yg in other)) {
      ygFail('operand', 'must be a SumSequence view');
    }
    if (other === this) ygFail('operand', 'must not be this view');
    if (other._hdr !== this._hdr) {
      ygFail('operand', 'is from another arena (views of one SumSequence.arena only)');
    }
    const ar = this._ar;
    const ra = this._root;
    const rb = other._root;
    for (let d = 0; d < ar.dims; d++) {
      const tL = ra === YG_EMPTY_ROOT ? 0 : ra < 0 ? this._lsum[d][~ra] : this._sums[d][ra];
      const tR = rb === YG_EMPTY_ROOT ? 0 : rb < 0 ? this._lsum[d][~rb] : this._sums[d][rb];
      if (tR > YG_MAX - tL) ygFail('headroom', 'total would exceed 2^53-1');
    }
    const hdr = this._hdr;
    if ((ra !== YG_EMPTY_ROOT) & (rb !== YG_EMPTY_ROOT) & (hdr[YG_IFREE] === YG_END) &
        !(hdr[YG_IBUMP] < ar.Lmax - 1)) {
      ygFail('pool', 'internal pool exhausted');
    }
    // ---- first write ----
    if (rb !== YG_EMPTY_ROOT) {
      this._root = ra === YG_EMPTY_ROOT ? rb : ygSeamJoin(this, other);
    }
    this._len += other._len;
    other._root = YG_EMPTY_ROOT;
    other._len = 0;
    this._fl = YG_NIL;
    this._fb = 0;
    this._fdepth = 0;
    other._fl = YG_NIL;
    other._fb = 0;
    other._fdepth = 0;
    this._cv = false;
    other._cv = false;
    return this;
  }

  // ---- splitAt (0004 A-3, A-4; 0001 T-4; C-3, C-5, C-6, C-10, C-21, C-24, C-25) ------
  // this := [0, i), out := [i, length); returns this. Every check before the
  // first write (C-10): the index first, then the operand (RS-6: not a view,
  // self, another arena, out non-empty), then the R-E4 'pool' pre-check (one
  // leaf, only for a mid-leaf cut, decided after the descent into the arena
  // split stack; ygFail, so a throw changes nothing, A7-4). i in {0, length}
  // or an empty view: no descent, touches 0, nothing allocated or freed (RS-3).
  // Live is unchanged. Both fingers NIL / 0 / 0, both _cv false (C-5, C-6);
  // counters into this._n only (RS-1); b = 0 (C-13).

  splitAt(i, out) {
    const n = this._len;
    if (typeof i !== 'number') ygFail('index', 'must be a number');
    if (((i >>> 0) !== i) | (i > n)) ygFail('index', 'must be an integer in [0, length]');
    if (out === null || typeof out !== 'object' || !(#yg in out)) {
      ygFail('operand', 'must be a SumSequence view');
    }
    if (out === this) ygFail('operand', 'must not be this view');
    if (out._hdr !== this._hdr) {
      ygFail('operand', 'is from another arena (views of one SumSequence.arena only)');
    }
    if (out._len !== 0) ygFail('operand', 'out must be empty');
    const at = i >>> 0;
    if ((at !== 0) & (at !== n)) {
      const ar = this._ar;
      const left = this._left;
      const right = this._right;
      const count = this._count;
      const llen = this._llen;
      const ss = ar.sstack;
      let ref = this._root;
      let k = at;
      let depth = 0;
      while (ref >= 0) {
        ss[depth] = ref;
        depth++;
        const l = left[ref];
        const cl = l < 0 ? llen[~l] : count[l];
        if (k < cl) {
          ref = l;
        } else {
          k -= cl;
          ref = right[ref];
        }
      }
      const hdr = this._hdr;
      if ((k !== 0) & (hdr[YG_LFREE] === YG_END) & !(hdr[YG_LBUMP] < ar.Lmax)) {
        ygFail('pool', 'leaf pool exhausted');
      }
      // ---- first write ----
      this._n[YG_TOUCHES] += depth;
      ygSplitCut(this, out, ~ref, k, depth);
    } else if ((at === 0) & (n !== 0)) {
      out._root = this._root;
      this._root = YG_EMPTY_ROOT;
    }
    this._len = at;
    out._len = n - at;
    this._fl = YG_NIL;
    this._fb = 0;
    this._fdepth = 0;
    out._fl = YG_NIL;
    out._fb = 0;
    out._fdepth = 0;
    this._cv = false;
    out._cv = false;
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
