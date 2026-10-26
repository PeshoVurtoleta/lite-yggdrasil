// test/spec-counts.mjs -- the ONLY source of expected counter values for the
// SumSequence count gates (ADR 0003 G-9). Pure integer functions of the policy
// constants (B, m), capacity, N and the script the test passes in.
//
// Binding rules: ADR 0005 C-15 (Lmax), C-18 (moves), C-19 (prepend moves),
// C-20 (hot pulls), C-21 (seam repairs), C-23 (height H), C-25 (touches table),
// C-30 (this file). Definitions: ADR 0001 Table 3 (S(N)) and T-6 (underflow);
// ADR 0003 G-11 (HB). Where 0005 and an older ADR differ, 0005 wins (append
// split = m-1 moves per C-18, not Table 3's "m moves").
//
// File law: zero imports (no engine, no counter, no engine field); ASCII only;
// integer-only arithmetic; no export allocates (scalar return, or a write into
// a caller-supplied out array). Invalid arguments throw RangeError from the one
// cold thrower below; only it builds a message string.
//
// MIT (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>

// ---- cold path ---------------------------------------------------------------

function scBad(where) {
  throw new RangeError('spec-counts: invalid argument to ' + where);
}

function scInt(x) {
  return Number.isSafeInteger(x);
}

function scFlag(x) {
  return x === 0 || x === 1 || x === true || x === false;
}

// floor(a / d) for safe integers a >= 0, d >= 1 (exact, no float rounding).
function scDiv(a, d) {
  return (a - (a % d)) / d;
}

// T(a, b) = sum of s for a <= s < b (C-19); 0 when b <= a.
function scTri(a, b) {
  if (b <= a) return 0;
  const n = b - a;
  const t = a + b - 1;
  return (n % 2 === 0) ? (n / 2) * t : n * (t / 2);
}

function scPolicy(B, m) {
  return scInt(B) && scInt(m) && m >= 1 && B >= m;
}

// ---- height (C-23; 0001 T-10 == 0003 G-11 HB) --------------------------------

// H(1) = 0, H(w) = 1 + H(floor(3w/4)). Iterative.
export function H(L) {
  if (!scInt(L) || L < 1) scBad('H');
  let h = 0;
  let w = L;
  while (w > 1) {
    w = scDiv(3 * w, 4);
    h++;
  }
  return h;
}

export const HB = H;

// ---- pools (C-15) ------------------------------------------------------------

// Lmax = ceil(C/m) + K + T; C-15 sets T = 0 (no transient reserve).
export function Lmax(C, m, K, T = 0) {
  if (!scInt(C) || !scInt(m) || !scInt(K) || !scInt(T) ||
      C < 0 || m < 1 || K < 0 || T < 0) scBad('Lmax');
  return scDiv(C, m) + (C % m === 0 ? 0 : 1) + K + T;
}

// ---- append / prepend streams (0001 Table 3, C-18, C-19) ---------------------

// S(N): splits of N strictly increasing appends from empty.
export function S(B, m, N) {
  if (!scPolicy(B, m) || !scInt(N) || N < 0) scBad('S');
  return N <= B ? 0 : scDiv(N - B - 1, B - m + 1) + 1;
}

function scStreamCheck(B, m, N, out, where) {
  if (!scPolicy(B, m) || !scInt(N) || N < 0 ||
      out === null || typeof out !== 'object' || !(out.length >= 5)) scBad(where);
}

// out = [splits, hits, misses, moves, leaves]. Append moves = (m-1) * S
// (C-18: in-leaf append 0, append split m-1).
export function appendStream(B, m, N, out) {
  scStreamCheck(B, m, N, out, 'appendStream');
  if (N === 0) {
    out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0; out[4] = 0;
    return out;
  }
  const s = N <= B ? 0 : scDiv(N - B - 1, B - m + 1) + 1;
  out[0] = s;
  out[1] = N - 1 - s;
  out[2] = 1 + s;
  out[3] = (m - 1) * s;
  out[4] = 1 + s;
  return out;
}

// Prepends mirror splits / hits / misses / leaves, not moves (C-19):
// prepMoves(N) = N <= B ? N(N-1)/2
//              : B(B-1)/2 + S*B + (S-1)*T(m,B) + T(m, m+r), r = (N-B-1) mod (B-m+1).
export function prependStream(B, m, N, out) {
  scStreamCheck(B, m, N, out, 'prependStream');
  if (N === 0) {
    out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0; out[4] = 0;
    return out;
  }
  let s = 0;
  let mv = scTri(0, N);
  if (N > B) {
    const q = N - B - 1;
    const per = B - m + 1;
    s = scDiv(q, per) + 1;
    mv = scTri(0, B) + s * B + (s - 1) * scTri(m, B) + scTri(m, m + (q % per));
  }
  out[0] = s;
  out[1] = N - 1 - s;
  out[2] = 1 + s;
  out[3] = mv;
  out[4] = 1 + s;
  return out;
}

// ---- per-op moves (C-18) -----------------------------------------------------

// Insert at in-leaf position p into a leaf of size s; last = 1 iff the leaf is
// the sequence's last leaf. s < B: s-p. s == B splits: append split (last leaf,
// p == B) m-1; otherwise interior p <= B/2 ? B-p : B/2 (p = 0 gives B, the
// prepend split).
export function insertMoves(B, m, s, p, last) {
  if (!scPolicy(B, m) || !scInt(s) || !scInt(p) || !scFlag(last) ||
      p < 0 || p > s || s > B) scBad('insertMoves');
  if (s < B) return s - p;
  if (last && p === B) return m - 1;
  return 2 * p <= B ? B - p : scDiv(B, 2);
}

// Remove at in-leaf position p from a leaf of size s: s-1-p, plus rep (the
// caller's repMoves value) when the remove underflows (s == m, not the only leaf).
// s < m on a non-only leaf cannot exist in a valid tree (C-18 / T-6): RangeError.
export function removeMoves(m, s, p, only, rep) {
  if (!scInt(m) || !scInt(s) || !scInt(p) || !scFlag(only) || !scInt(rep) ||
      m < 1 || s < 1 || p < 0 || p >= s || rep < 0 || (s < m && !only)) scBad('removeMoves');
  const base = s - 1 - p;
  return (s === m && !only) ? base + rep : base;
}

// C-18 rep(sL, sR, uLeft), t = sL + sR (T-6 "free u"):
// merge (t <= B/2): uLeft ? (sL ? t : 0) : sR; equalize: uLeft ? sR : ceil(t/2).
export function repMoves(B, sL, sR, uLeft) {
  if (!scInt(B) || !scInt(sL) || !scInt(sR) || !scFlag(uLeft) ||
      B < 1 || sL < 0 || sR < 0) scBad('repMoves');
  const t = sL + sR;
  if (2 * t <= B) return uLeft ? (sL ? t : 0) : sR;
  return uLeft ? sR : scDiv(t + 1, 2);
}

// Cut at in-leaf position p of a leaf of size s: a leaf-boundary cut moves 0,
// a mid-leaf cut moves s-p.
export function cutMoves(s, p) {
  if (!scInt(s) || !scInt(p) || p < 0 || p > s) scBad('cutMoves');
  return (p === 0 || p === s) ? 0 : s - p;
}

// ---- seam repairs (C-21) -----------------------------------------------------

// splitAt repairs rL + rR in 0..2, rX = [result X has >= 2 leaves and its seam
// leaf < m].
export function seamSplit(m, leavesL, seamL, leavesR, seamR) {
  if (!scInt(m) || !scInt(leavesL) || !scInt(seamL) || !scInt(leavesR) || !scInt(seamR) ||
      m < 1 || leavesL < 0 || seamL < 0 || leavesR < 0 || seamR < 0) scBad('seamSplit');
  return ((leavesL >= 2 && seamL < m) ? 1 : 0) + ((leavesR >= 2 && seamR < m) ? 1 : 0);
}

// append repairs [both operands non-empty and min(a, b) < m] in 0..1; a = the
// left operand's last-leaf size, b = the right operand's first-leaf size,
// 0 = empty operand.
export function seamAppend(m, a, b) {
  if (!scInt(m) || !scInt(a) || !scInt(b) || m < 1 || a < 0 || b < 0) scBad('seamAppend');
  return (a > 0 && b > 0 && (a < m || b < m)) ? 1 : 0;
}

// ---- pulls (C-20) ------------------------------------------------------------

// A non-structural insert / remove / setMeasure is one pull pass: pulls == depth.
export function pullsHot(depth) {
  if (!scInt(depth) || depth < 0) scBad('pullsHot');
  return depth;
}

// ---- touches (C-25) ----------------------------------------------------------

// Rows in C-25 table order; p(row) = root-to-leaf paths the op walks.
export const TOUCH_HIT = 0;
export const TOUCH_FIRST_LEAF = 1;
export const TOUCH_TOTAL_CLEAR = 2;
export const TOUCH_MISS = 3;
export const TOUCH_SEEK = 4;
export const TOUCH_NEXT = 5;
export const TOUCH_INSERT_SPLIT = 6;
export const TOUCH_REMOVE_UNDERFLOW = 7;
export const TOUCH_APPEND = 8;
export const TOUCH_SPLITAT = 9;
export const TOUCH_SPLITAT_REPAIRS = 10;

function scP(row) {
  if (row <= 2) return 0;
  if (row <= 5) return 1;
  if (row <= 8) return 2;
  return 3;
}

function scRow(row) {
  return scInt(row) && row >= 0 && row <= 10;
}

// Bound: touches <= p(row) * HB(L), L = Lmax, k(op) = 0 (C-25).
export function touchesMax(row, L) {
  if (!scRow(row) || !scInt(L) || L < 1) scBad('touchesMax');
  return scP(row) * H(L);
}

// Exact touches per C-25 row from walker-recounted depths (0003 G-10).
// The arguments a, b, c mean, per row:
//   HIT / FIRST_LEAF / TOTAL_CLEAR: unused -> 0.
//   MISS, SEEK: a = d(t).
//   NEXT: a = d(t'), b = depth(lca); a = -1 = inside a leaf -> 0.
//   INSERT_SPLIT: a = d(t), b = d'(t').  REMOVE_UNDERFLOW: a = d(v), b = d'(t').
//   APPEND: a = d_a(last), b = d_b(first), -1 = empty operand -> 0.
//   SPLITAT: a = d(c).
//   SPLITAT_REPAIRS: a = d(c), b = rL + rR, c = Lmax. This is the ONLY row
//   whose value is an UPPER BOUND (d(c) + (rL+rR)*HB(Lmax)), not an exact count.
export function touchesExact(row, a, b, c) {
  if (!scRow(row)) scBad('touchesExact');
  if (row <= TOUCH_TOTAL_CLEAR) return 0;
  if (row === TOUCH_MISS || row === TOUCH_SEEK || row === TOUCH_SPLITAT) {
    if (!scInt(a) || a < 0) scBad('touchesExact');
    return a;
  }
  if (row === TOUCH_NEXT) {
    if (!scInt(a)) scBad('touchesExact');
    if (a === -1) return 0;
    if (!scInt(b) || b < 0 || a - b - 1 < 0) scBad('touchesExact');
    return a - b - 1;
  }
  if (row === TOUCH_INSERT_SPLIT || row === TOUCH_REMOVE_UNDERFLOW) {
    if (!scInt(a) || !scInt(b) || a < 0 || b < 0) scBad('touchesExact');
    return a + b;
  }
  if (row === TOUCH_APPEND) {
    if (!scInt(a) || !scInt(b) || a < -1 || b < -1) scBad('touchesExact');
    return (a < 0 || b < 0) ? 0 : a + b;
  }
  // TOUCH_SPLITAT_REPAIRS (upper bound)
  if (!scInt(a) || !scInt(b) || !scInt(c) || a < 0 || b < 0 || b > 2 || c < 1) scBad('touchesExact');
  return a + b * H(c);
}
