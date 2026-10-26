# 0005 -- SumSequence CURRENT: the binding rules of the 0.1.0 spec closure

consolidated through ADDENDUM 3 at da45c50 / PLAN-G-A e2b52b3f / PLAN-G-B 03f0bf88 / DB1-plans 4f60e9a1; ADDENDUM 4
(0005's own) folded in at 6514d58

- Status: CURRENT, consolidated (not RULED: the maintainer rulings are R-D1..R-D4 below; every other rule is a
  planner rule that survived DB-1 review rounds r1..r3)
- Date: 2026-10-26
- Session: SumSequence CURRENT consolidation (docs unit B1)
- Provenance of this text: consolidated from .handoff/PLAN-G-A.md (body, rulings, ADDENDA 1-3), .handoff/PLAN-G-B.md
  (body, ADDENDA 1-3) and .handoff/DB1-plans.md (r1, r2 incl. TOUCHES RECONCILED, r3, R-D4). This is the only place
  that names those files; the plan files are gitignored and archived at release.
- Precedence: ADDENDUM 4 > ADDENDUM 3 > ADDENDUM 2 > ADDENDUM 1 > body. Every rule below is the FINAL rule, stated in
  full.
  A superseded rule is not repeated here (it lives in the plan files and the Source map says where it went).
- Binding: this file is binding for every agent. ADRs 0001..0004 keep their ruled text; where this file amends an
  item, the ADR carries a pointer block (the Amends table below). Two texts for one rule would be two specs.
- Evidence labels: "(leaf model, node v26.8.2, untimed, 2026-10-26)" = a scratch leaf-list simulation, not an engine
  measurement; "nominal" = an estimate; closed-form counts are exact integers. No number below is an engine timing.

## Maintainer rulings (quoted verbatim)

AskUserQuestion, 2026-10-26:

- R-D1: D-1 = "No grow + recipe (Recommended)" -> option (a) for 0.1.0; (c) from(seq, C') queued for 0.1.x.
- R-D2: D-2 = "Static SumSequence.COUNTERS (Recommended)" -> static frozen class field; export list unchanged.
- R-D3: D-3 = "[0, 2^30 - 1] (Recommended)" -> entity domain [0, 2^30-1]; E-4 upper bound unblocked.
- R-D4: "Fold into CURRENT (Recommended)" -> no DB-1 r4; the CURRENT consolidation review also checks every
  ADDENDUM 3 item.

## Sources legend

- 0005 A4-1..A4-14 = this file's own ADDENDUM 4 (below; HB4 plan review R1, the HB3 walker, the B1 stub readings and
  the B2 driver readings). Every A4 item names the CURRENT rules it changed and every changed rule cites its A4 ids.

- G-A = PLAN-G-A (body: B-17 F-1..F-3, HIT-1, B-18, B-20, B-21, B-22, B-24, B-28, X-3, XG-2, XG-4, D-1..D-3, TASKS,
  A1..A5, RISK; G-A-D1..D11 = ADDENDUM 1; A2-1..A2-8 = ADDENDUM 2; A3-1..A3-5 = ADDENDUM 3).
- G-B = PLAN-G-B (body: O-4, B-19, B-25, B-26, B-27, B-29, B-32, XG-1, TASKS, ASSERTIONS 1-5, RISK; G-B-D1..D8 =
  ADDENDUM 1; B2-1..B2-6 = ADDENDUM 2; B3-1..B3-2 = ADDENDUM 3).
- DB1 = DB1-plans (P-01..P-23 findings of r1/r2, N-1..N-5 of r3; "TOUCHES RECONCILED" in r2).
- Names: _fl / _fb / _fdepth / _fpath are the finger fields (G-A F-1 fl / fb / depth / path are aliases) and _cv is
  the cursor bit. NIL is read from a fresh empty view's _fl, never written as a literal (C-27).

## Rules

### Finger

### C-1 Finger state (G-A F-1 -> G-B-D3 -> G-B B2-2)

- A view's finger is (fl, fb, depth, path): the leaf, the index of its first element, the descent depth, and a path
  stack Int32Array(H(Lmax)) owned by the VIEW (path[k] = node at depth k). Field names: _fl, _fb, _fdepth, _fpath.
- This amends 0004 A-5 "one set per arena" for the finger path only: the join and split stacks stay one set per
  arena (no op re-enters); the finger path stack costs k * H(Lmax) * 4 B for k views (nominal).
- A view that is empty has _fl === NIL. NIL = 0 is legal for _fl only (leaf refs are < 0 by I-7); the engine
  planner fixes the value, the harness reads it (C-27).

### C-2 Only the positional path uses the finger; the finger caches no sum (G-A F-2)

- Only insertAt, removeAt, setMeasure, getMeasure and entityAt read or write the finger. sumBefore, indexAtSum,
  total and the whole cursor never read or write it: a seek is one descent from the root, never the finger.
  The finger stores positions (leaf, first index, depth, path) and nothing summed: it caches no prefix sum.
- ROADMAP wording "indexAtSum / sumBefore ... (or a finger hit)" is therefore false; seeks are "one descent".

### C-3 Re-home after every positional op (G-A F-3 -> G-A-D11)

- Every positional op re-homes the finger after its last write, reads included (their descent writes the path).
  Non-structural op: fl / fb := the leaf the op touched. Structural op (split, merge, equalize, first-leaf
  creation): a cold descent to i re-homes (removeAt uses min(i, length-1)). A view emptied by the op: fl := NIL.
- Standing gate: A1 (C-34). Mutants MF-2 and MF-4 (C-35) are the teeth.
- The keyed-fence variant (B-17 part c: a stale fence after equalize, I-6) is DEFERRED to the SumMap brief
  (C-42); the carried rule is this structural re-home plus a keyed copy of MF-4.

### C-4 Hit (G-A HIT-1 -> G-A-D7 lo formula)

- Hit iff fl !== NIL and the index lies in the leaf's range and no split, merge, equalize or free is needed, decided
  before the first write. Range: insertAt i in (fb, fb+len] and, for the first leaf (fb = 0), [0, len]; every other
  positional op i in [fb, fb+len). The insert test is branchless: lo = fb - ((fb-1)>>>31); hit iff lo < i and
  i <= fb+len (fb = 0 gives lo = -1; fb >= 1 gives lo = fb).
- A hit adds 0 to touches. The split-triggering insert is a MISS. This replaces 0003 G-12 "in range + epoch valid +
  no split / merge / equalize needed" and the 0001 Table 3 hit wording.

### C-5 Ownership and NIL writes (G-A B-18 -> G-B XG-1)

- Invariant: fl !== NIL implies the leaf is live and owned by THIS view (not free, not another view's).
- splitAt (both views), append (both views) and clear set the finger NIL. Draining the last element of a view sets
  NIL (C-3). A moved-from view therefore never walks foreign nodes.

### Cursor

### C-6 No epoch counter; the cursor bit _cv (G-A B-18 -> G-A-D3 -> G-A A2-4 -> G-A A3-4)

- No epoch counter exists. The finger is never stale (C-3), so the only invalidation state is the view's one cursor
  (Y-11). Its `valid`, `index` and `entity` are prototype getters over view state; `valid` returns the boolean _cv.
- Every successful mutator stores `_cv = false` once per view it invalidates, AFTER validation: `this._cv` for
  insertAt, removeAt, setMeasure, splitAt, append, clear; append also `other._cv = false` (A3-4).
  splitAt's `out` must be empty (0004 A-3) so its cursor is never valid. A RangeError
  mutation and every read op leave _cv and the cursor fields unchanged.
- A seek (seekIndex / seekSum) sets _cv = true. While _cv is false: index and entity read -1, offset(d) and
  measure(d) are NaN. After `a.append(b)`, b's cursor valid === false (0004 assertion 5 unchanged).
- Amends 0004 A-1 / A-6 / A-7 (epoch per view; "bump"), 0003 G-4 (the engine-read field is _cv, a separate field
  from the never-read `_n`), 0002 M-5 ("finger or epoch" -> "finger or _cv").

### C-7 Cursor API (G-A B-24)

- view.cursor() returns the view's ONE cursor: seekIndex(i), seekSum(d, y), next(); fields valid, index, entity;
  methods offset(d), measure(d). Invalid state as C-6. The cursor has its own stack and allocates nothing.
- Closes RESEARCH Q-3. A cursor walk gives O(log n + k) reads at 0 B (this is why readRange is not in v0.1, C-12).

### C-8 clear() restores the constructed state exactly, `_n` excepted (G-A B-18 -> DB1 P-09 -> G-B B3-1)

- clear() restores the view to its constructed state exactly: _len 0, _root === EMPTY_ROOT, _fl NIL, _cv false,
  header bump 0 and live 0 once every view has cleared. The diagnostic counters `_n` are EXCLUDED (0003 G-8, X-8:
  clear() keeps counters); this is not XD-1.
- EMPTY_ROOT is the _root read from a fresh empty view; the harness asserts EMPTY_ROOT !== 0 (an empty view's _root
  must not equal internal id 0). The walker asserts (_len === 0) === (_root === EMPTY_ROOT) on every view after
  every op.

### Entity, signatures, options

### C-9 Entity domain and E rows (G-A B-22 -> G-A D-3 = R-D3)

- Entity domain is [0, 2^30-1] (R-D3). The check is `typeof e === 'number' && (e & 0x3FFFFFFF) === e`; -0 is stored
  as 0. A bad entity is a RangeError before any write, with 0 valueOf calls.
- DB-7 rows (U = RangeError, snapshot unchanged): E-1 0 ok; E-2 -0 ok, Object.is(entityAt(i), 0); E-3 2^30-1 ok;
  E-4 2^30, 2^31, 2^32 -> U; E-5 -1 -> U; E-6 1.5, NaN, +-Infinity -> U; E-7 '5', null, undefined, true, 5n,
  new Number(5), a valueOf spy -> U with 0 spy calls.
- Replaces any int32-range guard (RESEARCH :306-308 becomes `(e & 0x3FFFFFFF) === e`, [0, 2^30-1]).
- Amends 0002 M-5 (entity added to the check set). The cursor sentinel -1 cannot collide with an entity.

### C-10 Check order, index rule, extra-slot branch, census (G-A B-22 -> B-24 -> G-A-D7 -> G-A A2-2 -> 0005 A4-9)

- Check order, all before the first write: i, e, measures (M-3 each, slots < dims), extra slots, capacity, headroom.
  The capacity RangeError message carries the token 'capacity' and is checked between extra slots and headroom.
- The orders C-10 did not place (the index / dim / -0 orders are pinned by test/oracle.mjs and Oracle.test.mjs): the
  index is validated before the operand (splitAt; append takes no index) and the dim before the seek (indexAtSum); -0
  acts as 0 for both the index and the dim. An operand from another arena throws, the message carrying the token
  'operand' (0004 A-3). 'capacity' and the cross-arena 'operand' are stub + driver behaviour (oracle.mjs (a) / (b): the
  oracle does not model them).
- Indexes are validated, never clamped: insertAt and sumBefore take [0, length]; removeAt, setMeasure, getMeasure and
  entityAt take [0, length); anything else is a RangeError (the adapter clamps). typeof guard first.
- Dims > 1 insert is insertAt(i, e, m0, m1?, m2?, m3?). Slots < dims are validated under M-3; slots >= dims must be
  undefined (present-as-undefined is legal, so insertAt(0, 7, 5, undefined) at dims=1 is ok; insertAt(0, 7, 5, 0)
  at dims=1 is a RangeError with the snapshot unchanged).
- The extra-slot check is ONE fused branch: ((m1 !== undefined) & (dims < 2)) | ((m2 !== undefined) & (dims < 3)) |
  ((m3 !== undefined) & (dims < 4)) -> RangeError. No variadic or rest form exists on this path.
- Branch census of an insertAt hit at dims=1 is 14: i 2, entity 2, m0 3, extra-slot 1, capacity 1, headroom 1,
  finger 3 (NIL, lo, hi), structural 1.

### C-11 Options (G-A B-21 -> G-A-D9 -> G-B-D3)

- options is undefined or a PLAIN object (prototype Object.prototype or null). Only own string data keys in
  {dims, leafSize} are legal; RangeError for present-but-undefined, accessor, symbol key and unknown key (the message
  names the nearest key, "did you mean 'dims'?", built cold); no getter is ever called.
- leafSize in {4, 8, 16, 32}, default 16: typeof check first, else RangeError; stored as a shift; the .d.ts marks 4
  and 8 test-only. There is NO finger option; the harness factory is make({leafSize, dims}) and "finger off" is
  C-27.
- Rows (RangeError): [], null, Object.create({dims:5}), {dim:2} (message contains 'dims'), {dims:undefined},
  {[Symbol()]:1}, an accessor spy (0 calls). Object.create(null) with dims 2 is ok.

### C-12 Signatures, closed open items (G-A B-24 -> G-A XG-3 -> 0005 A4-9)

- getMeasure(i, d) -> number; entityAt(i) -> entity; removeAt(i) -> entity; sumBefore(d, i) -> number (dim first, then
  the index); total(d) stays, O(1); cursor() per C-7.
- Closes 0002 O-4 (getMeasure). 0004 O-2 (moveRange): closed, not needed (spike (e)). XG-3 readRange: not in
  v0.1 (the cursor gives O(log n + k) at 0 B); owner Tier 2. 0004 O-3 (parent column, entity -> index): not carried
  into v0.1 (it needs an entity-slot write on every leaf move, which is hot); owner = the v0.4 pool planner.

### C-13 Zero-box lanes (G-A-D8 -> G-A A2-3)

- 0002 O-1 outcome = a documented limit; no io-slot API. Smi lane: 0 B/op. Big lane (measures and y beyond 2^30):
  measures drawn in [2^30, 2^40] with live <= 4096 (4096 * 2^40 = 2^52, never a headroom RangeError), y drawn in
  [2^30, total); the steady-state MINIMUM bytes/op over windows 1..n-1 (window 0 is printed, never gated) must be
  <= 16*b + 1 with maxMajor 0.
- b = boxed boundary values per call: 1 for insertAt, setMeasure, getMeasure, sumBefore, total, indexAtSum, seekSum,
  cursor offset(d) and measure(d); 0 for removeAt, entityAt, next.
- Must-fail: a descent that returns acc across a %NeverOptimizeFunction helper shows > 16*b + 1. Doc sites: README
  Zero-GC notes and llms.txt state the limit.

### Capacity

### C-14 Caps (G-A B-28 -> G-A-D5 -> G-A A2-5)

- Slot ids stay Smi: Lmax*B <= 2^30, so C <= 2^28 - m*k (B=4: 2^28-k, B=8: 2^28-2k, B=16: 2^28-4k, B=32: 2^28-8k).
  C is an integer >= 1. MAX_VIEWS = 4096: count is an integer in [1, min(C, 4096)]. dims is an integer in 1..4.
  leafSize per C-11; unknown option keys are a RangeError. Every check is integer arithmetic done BEFORE the first
  allocation. The caps are documented, not exported. Brute force over B 4..32, k in {1, 3, 6, 4096}: cap -> 2^30 slots,
  cap+1 -> 2^30+4m (node v26.8.2, untimed, 2026-10-26); at the cap one Float64 column is 8 GiB.
- A3 rows (RangeError, arrayBuffers delta < 1 MiB): count 4097; count 4 at C=3; C = 2^28 - m + 1 at k=1 for each B;
  C=2^30; dims 0 and 5; leafSize 12. Exception with teeth: the count-4097 row runs at C = 2^20 (an unchecked build
  allocates >= 32 MiB there; the column is 32.1-33.0 MiB for B 4..32) and its must-fail is a validate-after-allocate
  mutant on that row only, arrayBuffers delta >= 1 MiB. No other row claims an allocation mutant. At-cap is never
  built in npm test.

### C-15 Pools; T = 0 by slack (G-A X-3 -> G-A-D10 -> G-A A2-8 (c) -> DB1 P-14)

- Lmax = ceil(C/m) + k. Leaf pool = Lmax; internal pool = Lmax-1; T = 0 (no transient reserve). A view with
  0 < n < m holds one T-8 exempt leaf (this replaces 0004 A-5 "one under-min leaf per view"). A split's peak is its
  post-op state; a splitAt cut's extra leaf is the out view's +1 allowance; join's fresh node fits once two trees
  become one.
- Why T = 0 is safe (slack argument): each view holds at most one leaf < m at any moment (T-8 exempt, unrepaired
  seam, or underflow); a join takes over the emptied view's allowance; so leaves <= floor((C-S)/m) + S <= Lmax with
  S <= k; internal <= leaves - nonempty + 1 <= Lmax - 1 (append's join needs two non-empty views; splitAt's joins reuse
  path nodes, T-4). If a splitAt ever needed a spare internal node the internal pool becomes Lmax; the 0004
  assertion 1 stream (C-36) is the gate meant to catch it, since A2 has no splitAt.
- Amends 0001 T-9 / X-3 (cross-ADR) and 0004 A-5 (transient T) and X-3.

### C-16 No grow (R-D1)

- 0.1.0 has no capacity growth (option (a)): capacity is arena-wide and fixed. The README recipe: pre-size C, watch
  `available`, or cold-rebuild into a bigger arena via a cursor walk plus appends, O(n log n). Option (c), a static
  cold bulk build from(seq, C') in O(n) with its own oracle and walker gates, is queued for 0.1.x.

### C-17 TASK 0(alloc): catchability of a huge allocation (G-A A2-5 -> G-A A3-5)

- Whether `new Float64Array(2**30)` throws a catchable RangeError is NOT RUN (8 GiB on the shared host): PENDING.
  Outcome rule: if it is not a catchable RangeError, or it succeeds lazily, a total byte cap on the arena becomes a
  MAINTAINER decision, recorded PENDING. The probe is named TASK 0(alloc); the G-B sha pin is separate.

### Counts

### C-18 Moves formulas (G-B O-4)

- Leaves are packed-left. `moves` = existing elements moved to a new slot (the new element is not counted). A split
  keeps the left part in place; the fresh leaf is the right part. Insert into a leaf of size s < B at position p:
  s-p moves. Split into (a | B+1-a): p < a ? B-p : B-a moves; interior p <= B/2 -> B-p (max 15 at B=16), p > B/2 ->
  B/2; append split m-1; prepend split B. Remove with s > m, or from the only leaf: s-1-p. Remove that underflows:
  (m-1-p) + rep. rep(sL, sR, uLeft) (T-6 "free u", t = the pair total): merge (t <= B/2): uLeft ? (sL ? t : 0) :
  sR; equalize: uLeft ? sR : ceil(t/2). Mid-leaf cut: s-p moves; a cut on a leaf boundary: 0.
- Closes 0001 O-4 (the ROADMAP "<= 15 leaf moves" is replaced by these formulas).

### C-19 No front gap; prepends do not mirror moves (G-B B-19)

- No front gap exists (a gap costs one load and one add on every in-leaf access of every hot op). "Prepends mirror"
  (0003 G-12) holds for splits, hits, misses and leaves only. prepMoves(N) = N <= B ? N(N-1)/2 :
  B(B-1)/2 + S*B + (S-1)*T(m,B) + T(m,m+r), with S = S(N) (0001 Table 3), r = (N-B-1) mod (B-m+1) and
  T(a,b) = the sum of s for a <= s < b. N=200 at B=16, m=4: 1960 moves, 15 splits, 184 hits (closed form ==
  simulation, node v26.8.2, untimed, 2026-10-26).

### C-20 Hot pull pass (G-B B-25)

- A non-structural insert / remove / setMeasure is ONE pull pass (count and sums only): no weight read, no balance
  check; pulls == depth. Weights and the T-2 balance check run only in cold rebalance (split, merge), pulls <=
  4(H+1). An equalize changes no weight: pulls == |anc(u) U anc(v)|. Amends 0001 T-2 and 0003 counters row 1.

### C-21 Seam repair counts (G-B B-26)

- splitAt repairs rL + rR in 0..2, where rX = [result X has >= 2 leaves and its seam leaf < m]; the joins inside a
  split do no repair. append repairs [both non-empty and min(a,b) < m] in 0..1, repairing u = the short seam leaf
  (the right one if both are short). T-7 fix: two single leaves become one leaf only when that repair merges
  (3+5 -> 8); 10+10 -> two leaves, 0 repairs; 3+10 -> 6|7 (equalize).
- Amends 0001 T-7, 0004 A-4 ("one seam repair") and 0003 counters row 11.

### C-22 Edge hysteresis row (G-B B-27)

- Table 3 gains an edge row: right after a 13|4 / 4|13 split, ONE remove on the m side underflows; the repair is
  always an equalize (t = B) to 8|8, costing 8 moves (append side) / 13 (prepend side). The big side needs B/2+2 = 10
  removes. The interior row (5 removes / 9 inserts) is unchanged; R-X1 sizes stay.

### C-23 Height bound and G-13 (G-B B-29 -> G-B ASSERTION 2)

- G-13 becomes: H(L) == a DP maximum height over all I-1 splits, for L in 1..2048; the engine group adds attainment
  at Lmax; a stack of H(Lmax)-1 must FAIL. H(1) = 0; the bound "<= log_{4/3} L - 1.4" holds only for L >= 2.
  H(1024) = 21, H(2^16) = 36. Controls: a floor(2w/3) mutant FAILS at L = 4 (2 vs 3); the old bound FAILS at L = 1.
- Amends 0001 T-10 and 0003 G-13.

### C-24 COUNTERS (R-D2)

- The counter indexes are a static frozen class field SumSequence.COUNTERS; the export list is unchanged. Closes
  0003 O-3. Counters stay per view (R-X2) and clear() keeps them (C-8).

### C-25 Touches definition and table (DB1 P-08 -> G-B-D7 -> G-A A2-6 = G-B B2-4 -> G-B B3-2 -> DB1 N-4)

- touches = internal nodes PUSHED onto a descent's path stack: the main descent, the neighbour walk from sibling(u),
  the F-3 re-home, the seam search, and a cursor leaf crossing. Never the leaf itself, never pulls, rotations or join
  spine steps. k(op) = 0 for every op. Bound: touches <= p*HB(Lmax). Exact values come from walker-recounted depths d
  and d' (0003 G-10).
- Table (exact | p): hit 0 | 0; first leaf 0 | 0; total, clear 0 | 0; non-structural miss incl. drain d(t) | 1;
  indexAtSum / sumBefore / seekIndex / seekSum d(t) (t = last leaf when i = length or y >= total) | 1; cursor next 0
  inside a leaf, d(t') - depth(lca) - 1 on a crossing | 1; insert that splits d(t) + d'(t') | 2; remove that
  underflows (merge or equalize) d(v) + d'(t') | 2; append 0 if an operand is empty else d_a(last) + d_b(first) | 2;
  splitAt 0 repairs d(c) | 3; splitAt with repairs <= d(c) + (rL+rR)*HB(Lmax) | 3.
- test/spec-counts.mjs adds touchesMax and touchesExact over this table (zero imports, scalar return);
  SpecCounts.test.mjs has one row per table row. The control is a stub whose touches counter adds 2 per level: it
  FAILS touchesExact. Owners: table -> 0001 (answers 0003 O-1 k(op) = 0); definition -> 0003 G-11, counters row 0.

### C-26 Hit / miss partition (G-A-D6 -> G-B-D7)

- Each POSITIONAL op (insertAt, removeAt, setMeasure, getMeasure, entityAt) adds 1 to exactly one of fingerHits /
  fingerMisses; every other op (seeks, indexAtSum, sumBefore, total, next, splitAt, append, clear) adds 0. Amends
  0003 G-12 ("each op") and counters row 8/9. On every finger-off run op the fingerHits delta is 0.

### Harness

### C-27 Snapshot, finger-off, walker state (G-B-D3 -> G-B B2-1 -> G-B B2-2 -> G-A A3-1 -> 0005 A4-6, A4-7, A4-11)

- Snapshot contract per view: _root, _len, _fl, _fb, _fdepth, _fpath (Int32Array, [k] = node at depth k), _cv.
- The binding SNAPSHOT shape is the header of test/walker.mjs (sha256 3a163137), which the engine adapter
  snapshot(arena) must produce. In short: arena constants C, B, dims, NIL, EMPTY_ROOT and the header live; an internal
  pool {size = Lmax - 1, bump, free, next, left, right, weight, count, sum (dims columns)}; a leaf pool {size = Lmax,
  bump, free, next, len, ent (size*B slots), meas (dims columns of size*B)}; views[] (k >= 1), each {_root, _len, _fl,
  _fb, _fdepth, _fpath (length exactly H(Lmax)), _cv}. A child ref >= 0 is an internal id and < 0 is ~leafId; leaf
  sums are not stored (the walk recounts them from len + meas); slots >= len are never read; free-list ids are plain.
  When _fl === NIL, _fb / _fdepth and the _fpath contents are never read.
- NIL is read from a fresh empty view's _fl. At the START of a lane (a lane-start check, not a per-op step) the
  harness asserts Object.hasOwn(view, f) for f in _fl, _fb, _fdepth, _fpath (a renamed field, or one that lives on the
  prototype, fails here with code C-27, op null, witnessLength 0). Finger off = before each op write NIL / 0 / 0 into
  _fl / _fb / _fdepth.
- "Walker state" = the walk() verdict plus the snapshot minus _fl / _fb / _fdepth / _fpath. Answers (compared with
  Object.is) and walker state are compared on == off after EVERY op. The finger fields are compared on == off only
  after positional ops, splitAt, append and clear, and only the op's own view's (both views for splitAt / append).
  After a finger-neutral op (indexAtSum, sumBefore, total, cursor seekIndex / seekSum / next) the on-run finger is
  byte-identical to its own pre-op value and the off-run finger is still the NIL it was given. This holds in every
  on / off lane: A1 (C-34), BFS + sweep (C-31) and the deep lane (C-32).
- B2 readings (review-ACCEPTED 2026-10-26; 0005 A4-11): the on / off finger compare skips an op that threw; two
  NIL fingers are equal; _fpath is compared on [0, _fdepth) only.

### C-28 Walker I-9, XG-1, pool census (G-B-D4 -> G-B-D5 -> G-B XG-1 -> 0005 A4-7, A4-8)

- Codes, in walker CHECK ORDER (test/walker.mjs CODES; the first failure wins): SNAP, I-7, I-8, I-1, I-2, I-3, I-5,
  I-9a, XG-1, I-9c, I-9d, I-9e. XG-1 is I-9 (b), the C-5 ownership rule: there is no code I-9b. I-4 (seek) is
  oracle-checked and I-6 is n/a (no keys), so neither is a walker code. walk() never throws: a malformed snapshot or
  any exception while reading it is SNAP (detail 'exception ...'). The tokens 'reach' and 'retention' are
  unreachable defensive tokens.
- I-9: (a) an empty view has fl NIL, and fl NIL checks nothing else; (b) otherwise fl is reachable from THIS view's
  root and not free (not another view's); (c) fb == the recount; (d) depth == the recount; (e) _fpath[0..depth) each
  == the recount. _fb / _fdepth are type-checked only when _fl !== NIL. Fixtures, each failing with its own code:
  freed leaf; foreign leaf; stale fb (B=16, 17 appends, removeAt(16) -> 8|8, fb 13 vs 8); depth + 1; a path entry
  from before a rotation; non-NIL fl on an empty view.
- Pool census per pool: the free-list walk takes <= pool-size steps (longer = cycle); no duplicate ids; no id shared
  with any view's live nodes; live U free == [0, bump). Fixtures that must FAIL I-7: double free, live id on the free
  list, leak, cycle. Retention: live + free == pool, internal == sum(L_s - 1).
- Census readings (accepted at HB3 review): in a free list 'dup' = next[x] === x (an id linking to itself); any other
  revisit is 'cycle'. The census checks 'range' before 'shared', and the leaf pool before the internal pool. I-8 uses
  n_s = the RECOUNTED element count, with slot reads capped to [0, B]. The I-2 sum compare treats NaN as equal (I-3
  is the code that reports it).
- Per-code fixtures (clean passes; each fails with exactly its code): I-1 (M-1 shape, stored 5|5), I-2, I-3 (-0;
  total 2^53), I-5, I-7, I-8, I-9a, XG-1, I-9c, I-9d, I-9e. I-6 is "n/a" (no keys). The snapshot contract is C-27.

### C-29 Oracle (G-B TASK 3 -> G-B-D8)

- oracle.mjs is a plain-array model per I-3 / I-4 / M-1..M-8 with boundary rows. Its entity rule is C-9 via the
  B-22 test (no hook). Oracle.test.mjs covers it; the walker and the oracle run after every op in the lanes.

### C-30 spec-counts (G-B SPEC -> ASSERTIONS 1 and 5 -> G-B B2-6)

- test/spec-counts.mjs: H, Lmax(C,m,K,T=0), appendStream / prependStream(B,m,N,out), insertMoves, removeMoves,
  repMoves, cutMoves, seamSplit, seamAppend, pullsHot, touchesMax, touchesExact. Zero imports; scalar return or a
  caller out array. All test files are flat in test/ (the Scaffold scan covers only top-level test/*.mjs).
- appendStream(16,4,1e4) = 768 splits / 9231 hits / 769 misses / 2304 moves; prependStream(16,4,200) = 1960 moves /
  15 splits / 184 hits; closed forms == simulation for N in 1..2000, B in {4, 8, 16} (6000/6000; 1e4 appends give 769
  leaves; node v26.8.2, untimed, 2026-10-26). Controls: the old (m-1)*S = 45 moves formula FAILS; MC-3 (8|8) FAILS on
  splits; an `import` fixture added to spec-counts FAILS the 0003 G-9 gate.
- GC: spec-counts exports 0 B/op over 1e5 calls, maxMajor 0; an object-returning mutant FAILS.

### C-31 BFS and sweep lanes (G-B B-32 -> G-B-D1 -> G-B B2-1 -> G-B B2-6 -> DB1 P-01 -> 0005 A4-2, A4-5, A4-6, A4-11..A4-14)

- Shape-only BFS stays the state generator, closed under insertAt / removeAt / splitAt + append at every position,
  with walker and oracle after every op. At EVERY state, for each j in {NIL, 0..L-1}: replay the witness; j = NIL ->
  the NIL write; else getMeasure(firstIndex(j), 0) and assert the walker reads fl == leaf j (a sweep that never lands
  is a failure). Then every 1-op suffix finger on and off: positional ops at every i, seeks at every boundary,
  splitAt(i, b), b.clear(), a.append(b); answers, walker state and post-op fl / fb / depth / path per C-27.
- Free-list order is merged on purpose: it is observable only through ids, and any id alias fails the C-28 census in
  the state where it appears. This works because the walker checks the finger against truth after EVERY op.
- Engine budgets (DEFERRED to the engine group; not run on the stubs): two lanes, each capped at 2^22 op
  applications (nominal), the WHOLE lane (a BFS that closes every size n' <= n pays the cumulative cost). BFS cost =
  U*(3n+2)*(n+2); sweep cost = sum over L of S(L)*comp(n,L)*(L+1)*(8n+7)*(n+2). Result: nMax 9/15 (B=4 / B=8), nSweep
  7/12; nSweep <= nMax, reported, never raised. U(B,n) = sum over L of S(L)*comp(n,L,[m,B]) (S(L) = number of I-1
  shapes) is an upper bound: U(4,16) = 7,901,563, U(8,24) = 1,244,740; the reachable count is logged by the first
  engine run (TASK 0(a) ran: node v26.8.2, untimed, 2026-10-26). If a bound ever drops nMax, record it; never raise
  the budget.
- Stub budgets (npm test, test/Exhaustive.test.mjs, DETERMINISTIC): one APPLICATION = one op on one on / off pair,
  replays included; each lane is capped at 2^18 applications (ENGINE / CAPS key cap). If a lane exceeds the cap, lower
  that lane's nMax / nSweep by 1 and record it in an addendum; never raise 2^18. Sizes: nMax 6 / 10 (B=4 / B=8),
  nSweep 5 / 9 over the BFS states, deep 4,000 ops per B. Applied per lane (deterministic counts, test code, node
  v26.8.2, 2026-10-26; no wall time), B=4 / B=8: bfs 7,095 / 24,532; sweep 40,623 / 154,475 (59% of 2^18 at B=8);
  deep 4,226 / 4,222. 15 s wall is nominal, not a gate.
- Lane API (0005 A4-5): bfsLane(f, {B, nMax, walker, cap, drop, cfg}); sweepLane(f, {B, states, nSweep, suffixes =
  true, cfg}); deepLane(f, {B, ops, seed, nLo, nHi, drop, cfg}); lanes call f(C = nMax, {leafSize: B, dims: 1}, 2,
  cfg ?? {}). Report {ok, first, applied, divergences, tally, states (bfs) | maxLeaves (deep)}; first = {lane
  'bfs' | 'sweep' | 'deep', run 'on' | 'off', code, detail, op, n (pre-op length), witnessLength (ops from empty
  through the failing op, inclusive)}; a witness is an array of {op, i}, replayable on any stub. exhaustive.mjs
  exports bfsLane, sweepLane, deepLane, CELLS, coverageMissing, assertCoverage, mergeTally, CODES, ENGINE, CAPS; ENGINE
  and CAPS are deep-frozen with the keys cap, nMax, nSweep, deepOps, deepN ({4: [8, 48], 8: [16, 96]}).
- Driver check order per op, first failure wins (source: PLAN-HB4 SPEC 2, 0005 A4-11): walker (on), sweep landing,
  walker (off), oracle (an indexAtSum answer mismatch = I-4, anything else = ORACLE), ONOFF (C-27), C-26, C-27 (neutral
  finger), BUDGET. The driver checks capacity before calling the oracle; replays are unchecked.
- Fail-open closers (0005 A4-6): a lane fails unless applied > 0 and, for BFS, every n in 0..nMax is seen. sweepLane
  fails 'SWEEP' with detail 'no states' when no state has n <= nSweep. A stub throw the oracle does not match,
  including during a replay, is 'ORACLE'. Invalid lane options throw RangeError. The 'LANE' code reports the
  applied-0 and missing-n closers (B2 reading, A4-11). The deep lane redraws insertAt at n >= nHi, removeAt at
  n <= nLo, and setMeasure / getMeasure / entityAt at n == 0 (the lane starts empty).
- B2 readings (review-ACCEPTED 2026-10-26; 0005 A4-11): the sweep landing is checked on the on run only; a lane
  stops at its first failure (divergences 0 or 1); sweep C = max(nSweep + 1, the highest live a witness reaches); the
  suffix set per state costs 8n + 7 applications (the extra one
  is `total`); witness args come from position k (entity k, measure 1 + k % 3,
  indexAtSum y = sumBefore(0, i), a clear entry's i = the view index); sweepLane and deepLane take `cap`.
- Driver contract (0005 A4-13): for every pair the driver builds the finger-ON arena first, then the finger-OFF arena.
  The test's off-only wrapper controls rely on this order.
- Engine-time coverage (0005 A4-14): under CAPS the sweep's b.clear() always runs on an empty b, so a clear on a
  non-empty view is covered only at engine size.
- Cursor suffixes, the 2^22 runs and the nMax / nSweep 9/15 and 7/12 figures stay with the engine group.

### C-32 Deep lane and coverage cells (G-B-D6 -> G-B B2-3 -> G-B B2-5 -> 0005 A4-1, A4-2, A4-5, A4-10..A4-12, A4-14)

- Deep lane: xorshift32 with separate op / index / measure streams (G-A's constants and seeds, C-34); B=4 n in
  [8, 48], B=8 n in [16, 96]; two-view ops included; finger on / off in lockstep; walker + oracle after every op.
  W-DEL / W-INS / W-TIE stay join-built (0001 M-2, engine group). The engine run is 2e4 ops each (DEFERRED to the
  engine group); the stub run (npm test) is 4,000 ops per B, reaches >= 11 leaves (maxLeaves 33 / 32 at B=4 / 8,
  asserted >= 11) and reports its maxLeaves.
- B2 readings (review-ACCEPTED 2026-10-26; 0005 A4-11): the deep lane starts empty (no view draw at start), C = nHi,
  and draws a zero measure when (r >>> 16) % 20 == 0; the C-34 fixed clears are kept (they fire only at 2e4 ops, NEVER
  at the 4,000-op npm-test size); splitAt + append is ONE stream op and TWO applications.
- Engine-time coverage (0005 A4-14; not gated on the stub): under CAPS, clear only ever runs on an empty b, so a clear
  on a non-empty view is covered only at engine size; and the mergeMoves move condition (moves delta - removeMoves(m,
  m, p, 0, 0) > 0) is never false on the stub, so its false branch is unexercised there.
- Coverage (G-B ASSERTION 6): over bfsLane + deepLane ONLY (the sweep adds no cell) at each B in {4, 8}, every cell
  fires >= 1, attributed by the per-op SumSequence.COUNTERS delta: rotSingle / rotDouble each on insertAt and removeAt;
  mergeMoves and equalizeK count on a removeAt op only: a merge that moves elements (moves delta - removeMoves(m, m, p,
  0, 0) > 0, removeMoves from spec-counts, p = i - fb of the pre-op leaf); equalize at each k in 4..8 (k = the size of
  T-6's neighbour v, the in-order leaf on u's sibling side, read from the PRE-op walker snapshot); a merge or equalize
  inside splitAt / append counts only toward splitAt1 / splitAt2 / append1 (the seamRepairs delta): splitAt with 1 and
  with 2 seam repairs; append with 1 seam repair (merge / equalize / seam cells at B=8 only). CELLS(B) is a frozen
  array in this order: 'rotSingle@insertAt', 'rotSingle@removeAt', 'rotDouble@insertAt', 'rotDouble@removeAt', then at
  B=8 'mergeMoves', 'equalize4'..'equalize8', 'splitAt1', 'splitAt2', 'append1' (|CELLS(4)| = 4, |CELLS(8)| = 13);
  tally is a plain object with every CELLS(B) key; coverageMissing(tally, B) lists the names with !(t[c] >= 1) in CELLS
  order; assertCoverage(tally, B) throws RangeError 'coverage: missing ' + names.join(', ').
- Must fail: a run with removeAt dropped (drop applies to bfsLane AND deepLane; at B=8 missing(drop ['removeAt'])
  minus missing(full) = {mergeMoves, equalize4..equalize8}); a tally fixture with one zero cell. assertCoverage and
  its controls ship now. The synthStub run misses exactly the 4 rot cells per B (expected: it never rotates); the
  positive coverage run needs rotations and stays with the engine group.

### C-33 Stubs (G-B TASK 7 -> G-B ASSERTION 4 -> G-B-D8 -> 0005 A4-3, A4-4, A4-5, A4-10, A4-12, A4-13)

- stubs.mjs exports the factories synthStub, flatStub, seekStub, staleFingerStub, nolandStub, countStub, homeStub,
  each (C, {leafSize, dims}, count, cfg) -> {views, snapshot()}; cfg keys NIL, EMPTY_ROOT, protoField. It also exports
  the frozen COUNTERS (0003 names, idx 0-11); counters live in view._n. Exhaustive.test.mjs runs them (DETERMINISTIC,
  npm test). Stubs are test code, not a hot path. The lane driver builds the finger-ON arena first, then the
  finger-OFF arena, for every pair (0005 A4-13): the test's off-only wrapper controls rely on that order.
- Expected reports (each on the stated lane, B=4 unless stated): synthStub PASSES (it re-homes per C-3) at B=4 and
  B=8 in BFS, sweep and deep. flatStub (never splits): bfsLane first.code 'I-5', detail starts 'leaf:', op insertAt,
  witnessLength 5; it stores leaves overlap-free, so with walker: false the lane is ok with 0 divergences. seekStub
  (flips only the internal-node comparator of the sum descent, `>=` for `>`): BFS ok; sweep first {lane 'sweep', code
  'I-4', op indexAtSum}. staleFingerStub (keeps the pre-op _fb on every miss re-home, structural and first-leaf
  included): sweepLane over the states of bfsLane(synthStub, {B: 4, nMax: 6}) with nSweep 5 gives first {lane 'sweep',
  code 'I-9c', run 'on'}; synthStub on the same states is ok. nolandStub (getMeasure skips the re-home): BFS ok; sweep
  first {code 'ONOFF', op getMeasure}; sweep with suffixes: false first code 'SWEEP'. countStub (indexAtSum adds a
  miss, after validation): sweep 'C-26'. homeStub (indexAtSum re-homes, only when y < total): sweep 'C-27'.
  cfg.protoField '_fdepth' (the field lives on the prototype): first {code 'C-27', op null, witnessLength 0}.
  synthStub with cap 10: first code 'BUDGET'.
- A4 on stubs (0005 A4-4): the B/op lane and the lite-leak arena tracking (and the `onArena` option) are DROPPED (stubs
  are not hot path; the engine's C-38 / C-39 are unchanged). KEPT: 100 fill / split / append / clear cycles each
  ending with bump = live = 0 on both pools (deterministic; it gives the walker's I-7 'leak' check meaning).
- Stub readings (B1, review-ACCEPTED; 0005 A4-10): (a) a structural re-home descends by `i < count[left]` goes left; a
  non-structural miss re-homes to the touched leaf. The walker and ONOFF cannot see this rule (a mutant of it passes
  lockstep), so no lane gate here covers it. (b) Every NIL write
  (drain, splitAt, append, clear) sets NIL / 0 / 0 on _fl / _fb / _fdepth and leaves _fpath. (c) T-6's neighbour v =
  the in-order leaf on u's sibling side in the CURRENT tree: literal T-6, which DIFFERS from the C-42 leaf model
  ("right neighbour unless u is last"); the equalize k of C-32 is read from that sibling-side neighbour in the PRE-op
  snapshot. (d) Each seam repair also adds one merge or equalize counter; a splitAt mid-leaf cut is not a split. (e)
  moves are counted per phase (remove, then repair) = C-18 term by term. (f) Leaf slots are stored per leaf; the
  snapshot writes min(len, B) slots. (g) seekStub flips only the internal-node comparator. (h) staleFingerStub as
  above. (i) homeStub re-homes only when y < total; countStub adds its miss after validation. (j) Stub-only limits:
  C <= 2^20; cfg keys are validated (NIL is not a pool leaf ref; EMPTY_ROOT is not 0 and not a valid ref; protoField
  is one of _fl, _fb, _fdepth, _fpath).

### Gates

### C-34 A1: finger on == finger off (G-A A1 -> G-A-D1 -> G-A A2-7 -> G-A A3-1..A3-3)

- Streams: xorshift32 (x^=x<<13; x^=x>>>17; x^=x<<5; x>>>0), three independent states op 0x9E3779B9^s, index
  0x85EBCA6B^s, measure 0xC2B2AE35^s; seeds s in {1,2,3} x B in {8,16}, arena(4096, {dims:1}, 3); 1e4 executed ops;
  floor(op/2500) even = grow, odd = drain. Weights insertAt / removeAt / setMeasure / getMeasure / entityAt /
  indexAtSum / sumBefore / splitAt+append: grow 61/16/4/4/4/4/4/3, drain 16/61/4/4/4/4/4/3 (sum 100). class = op draw
  % 100, then view = next op draw & 1. If removeAt / setMeasure / getMeasure / entityAt lands on an empty view, or
  insertAt lands at live == C, class AND view are redrawn and the redraw is not counted.
- clear has random weight 0; instead a FIXED op after each op o with o % 5000 == 4999: clear(view 0) then
  clear(view 1) -- 4 per stream, no draws, compared like any op. Index draw r: r&1 -> clamp(last + (r>>>1)%3 - 1,
  0, range-1), else (r>>>1) % range; range = n+1 for insertAt / sumBefore / splitAt, else n; `last` shared across
  views; indexAtSum and clear draw no index. Measure r % 1000 with 5% zeros; indexAtSum y = measure draw r %
  (total + 1). splitAt+append = splitAt(i, view 2); append(view 2).
- Comparison and finger-off write follow C-27 verbatim. 10,000 appends at B=16 give 9231/769 hits/misses.
- Floors per stream, counted on the finger-on run (deterministic: below a floor the test FAILS, never re-run):
  splits >= 100, merges >= 25, equalizes >= 25 (COUNTERS deltas across insertAt / removeAt only; seam repairs from
  splitAt+append excluded), hit-after-structural >= 25 (the immediately next stream op is a positional op on the
  same view and a finger hit, after a split / merge / equalize of insertAt / removeAt; first-leaf creation excluded;
  splitAt / append / clear NIL the finger and are not structural here), fingerHits >= 2000, splitAt+append >= 100,
  and >= 1 fixed clear lands on a non-empty view with fl !== NIL. Leaf model (node v26.8.2, untimed, 2026-10-26):
  20/20 streams at s 1..10 x {8,16}; thinnest margins fingerHits 2069 (B8 s1), splits 122 (B16 s4); clears: 56/80
  qualify, every stream has one.
- If the real engine misses a floor: change the weights (sum 100, fixed clears kept), never the floors or the
  seeds; new weights must pass s 1..10 x {8,16} 20/20 on the real engine, logged as an evidence file + an addendum.
- Standing invariants: hits + misses == positional ops. Teeth: C-35.

### C-35 Mutants MF-1..MF-5 (G-A-D2 -> G-A A2-1)

- Rows carry entity i and measure i+1 unless stated.
- MF-1 indexAtSum keeps (leaf, index base, sum base) of its last answer and starts from it when y >= sum base:
  B=8, 9 appends of measure 10 (leaves 7|2), indexAtSum(0,75) = 7, setMeasure(0,0,30), indexAtSum(0,75) = 5
  correct; the mutant returns 7 (MF-1 5 vs 7). A finger that stores a prefix sum is equivalent here (setMeasure(0)
  re-homes to leaf 0, base 0, answer 5) and is NOT a mutant.
- MF-2 a miss keeps the finger: B=16, 17 appends (13|4, fb=13), removeAt(0), entityAt(13) = 14; the mutant returns 13.
- MF-3 a drain keeps the finger: the walker check of C-28 (a) / (b) fails.
- MF-4 a structural op without re-home: the same 17 appends, removeAt(16) -> 8|8 (true fb 8), removeAt(14) returns 14;
  the mutant returns 9. A keyed copy is carried to SumMap (C-42).
- MF-5 clear() that keeps the finger: fails A5 (C-39).

### C-36 A2 capacity and the 0004 assertion-1 stream (G-A B-20 -> G-A A2 -> G-A TASK 0 -> G-A-D10 -> DB1 P-09)

- A2: arena(4096, {dims:1}, 6). Stream: five singleton views; view 6 appends and trims each 13-leaf to 4; the leaf
  count reaches L = 1025 at split 1019 with live 4094; pool-exhausted 0; the 4097th insert on each view is a
  RangeError and every view is walker-identical (leaf model, node v26.8.2, untimed, 2026-10-26). Must fail: the
  Lmax = ceil(C/m) mutant (1024) exhausts at split 1019; Lmax = 1030 does not.
- The former 0004 / RESEARCH B-20 text "1 / 1 / 4094 -> 1025" is wrong: that stream peaks at 1023, and the
  1365/1365/1366 stream at 1017 (1023/1017; same provenance); the working control is A2 above.
- Kept beside A2 (0004 assertion 1): arena(4096,{dims:1},3), 1e4 C-34 xorshift32 ops including >= 100 splitAt /
  append, fill to live 4096, the 4097th insert throws on each view, pool-exhausted 0, walkers identical; its
  must-fail is A2's no-+k mutant on the k=6 stream.

### C-37 A3 validation (G-A A3 -> G-A-D9 -> G-A A2-5)

- Every E row (C-9), index row (C-10), extra-slot row (C-10), options row (C-11) and cap row (C-14) throws
  RangeError with the snapshot (finger, cursor.valid, walker) unchanged and 0 spy calls; C=2^30, dims 0 / 5, leafSize
  12 and C beyond the C-14 cap throw before allocation.
- Must fail: Number.isInteger(e) (E-4 2^31 stored as -2147483648); `e|0` (E-6 1.5 stored); no typeof (1 spy call).

### C-38 A4 GC (G-A A4 -> G-A-D8)

- Cursor seek + 50x next, getMeasure, entityAt, and dims=4 positional insertAt + removeAt: 0 B/op over 1e5 ops each,
  maxMajor 0, Smi lane; the big lane is C-13. Must fail: an array or rest-parameter insert variant > 0 B/op.

### C-39 A5 retention (G-A A5 -> 0002 / 0004 retention)

- 1000 cycles of arena(1e3, {dims:2}, 3): 1e3 inserts with 100 caught rejects, a cursor walk, splitAt / append, then
  clear() on every view. lite-leak tracker.size() == 0 after the 1000 cycles; every view equals the constructed state
  (fl NIL, valid false, length 0); header bump 0, live 0. Must fail: MF-5.

### C-40 A6 cursor bit (G-A-D4 -> G-A A2-4 -> G-A A3-4 -> DB1 P-05, P-21)

- test/Cursor.test.mjs. Mutator classes: insertAt, removeAt, setMeasure, splitAt (this), append (this), append
  (other), clear. Per class: a cursor seeked to row 0, the mutation, then valid === false, index -1, entity -1,
  Number.isNaN(offset(0)). A RangeError mutation and every read op leave valid === true and the fields unchanged.
  The splitAt-out row is not a mutant row: out must be empty, so the test asserts out's cursor valid === false both
  before and after the splitAt.
- Must fail: 7 class mutants, each dropping one class's store (the append-other mutant drops `other._cv = false`),
  plus the validation-order mutant (store before validation; fails the RangeError row).

### C-41 G-B ASSERTIONS 1-6 (G-B ASSERTIONS -> G-B-D6 -> G-B-D8)

- 1: C-30 counts and controls. 2: H(L) == DP for L in 1..2048, H(1024) = 21, H(2^16) = 36, controls C-23. 3: fixtures
  C-28 (clean passes, each fails with exactly its code; retention live + free == pool). 4: stubs C-33 and the G-9
  import fixture. 5: spec-counts GC C-30. 6: coverage cells C-32.

### Deferred, owners, unverified

### C-42 Deferred / owners / UNVERIFIED (G-A XG-2 -> G-A XG-4 -> G-A-D11 -> G-A TASKS 5-8 -> DB1 P-10 -> 0005 A4-12)

- DEFERRED to the engine group (0005 A4-12): the engine lane numbers of C-31 / C-32 (2^22, nMax 9/15, nSweep 7/12, the
  2e4 deep run), the positive coverage run, the cursor suffixes, C-20 / C-25 exactness, and W-DEL / W-INS / W-TIE.

- DEFERRED to SumMap: B-17 part (c) keyed fence (I-6) and B-23. XG-2: v0.1 one column per dim (identical at dims=1);
  interleaved A/B is a REPORTED measurement, owner Bench-ADOPT / LP-4 Q-1. XG-4: deferred to the post-engine perf
  pass (one RMW on a hot miss descent; the structural reason is already exact as splits + merges + equalizes).
  XG-3 readRange: Tier 2. 0004 O-3 parent column: v0.4 pool planner. from(seq, C'): 0.1.x (C-16).
- Engine phase owners: tests test/Finger.test.mjs, Entity.test.mjs, Capacity.test.mjs, Cursor.test.mjs (helper, from
  the gates C-34..C-40); Yggdrasil.d.ts, test/types/smoke.ts, llms.txt, CHANGELOG [Unreleased] and README (docs
  helper). Yggdrasil.js hunks belong to the engine planner's sequential rungs. The spike stub update (move to the
  closed API: cursor loop, adapter clamps, ids <= 2^30-1) is a FILLER.
- Engine planner confirms: the NIL value and the _root sentinel value (C-1, C-8, C-27).
- UNVERIFIED: the C-34 floors on the real engine (the leaf model always takes the right neighbour unless u is last;
  fingerHits margin 3.5%); the C-32 cells on the real engine; C-17 (PENDING); the U reachable counts (C-31).

## Amends

Batch B2 copies these rows into each ADR's pointer block; the ADR column is the exact item id in that ADR.

| ADR item | amended by |
| --- | --- |
| 0001 Table 3 -- leaf policy in B (m = B/4; [B = 16]), finger-hits paragraph | C-4 |
| 0001 Table 3 -- leaf policy in B (m = B/4; [B = 16]), row `last leaf, p = B (append)` | C-18 |
| 0001 Table 3 -- leaf policy in B (m = B/4; [B = 16]), row `first leaf, p = 0 (prepend)` | C-18 |
| 0001 Table 3 -- leaf policy in B (m = B/4; [B = 16]), row `hysteresis` | C-22 |
| 0001 T-2 | C-20 |
| 0001 T-7 | C-21 |
| 0001 T-9 | C-14, C-15 |
| 0001 T-10 | C-23 |
| 0001 O-4 | C-18 |
| 0001 O-6 | C-4 |
| 0001 DB-2 | C-31 |
| 0001 I-8 walker assertions | C-28 |
| 0001 X-3 (cross-ADR) | C-15 |
| 0001 DB-1 B-17 | C-1, C-2, C-3, C-4, C-5 |
| 0001 DB-1 B-21 | C-11 |
| 0001 DB-1 B-25 | C-20 |
| 0001 DB-1 B-26 | C-21 |
| 0001 DB-1 B-27 | C-22 |
| 0001 DB-1 B-28 | C-14 |
| 0001 DB-1 B-29 | C-23 |
| 0002 M-5 | C-6, C-9, C-10 |
| 0002 DB-7 catalogue | C-9 |
| 0002 O-1 | C-13 |
| 0002 O-4 | C-12 |
| 0002 Assertions | C-13 |
| 0002 DB-1 B-22 | C-9, C-10 |
| 0002 DB-1 B-24 | C-7, C-12 |
| 0003 G-4 | C-6, C-24 |
| 0003 G-8 | C-8 |
| 0003 G-11 | C-25 |
| 0003 G-12 | C-4, C-19, C-26 |
| 0003 G-13 | C-23 |
| 0003 Counters / gates, idx 0 (touches) | C-25 |
| 0003 Counters / gates, idx 1 (pulls) | C-20 |
| 0003 Counters / gates, idx 8/9 (fingerHits / Misses) | C-26 |
| 0003 Counters / gates, idx 11 (seamRepairs) | C-21 |
| 0003 O-1 | C-25 |
| 0003 O-3 | C-24 |
| 0003 X-8 | C-8 |
| 0003 DB-1 B-17 | C-4, C-27 |
| 0003 DB-1 B-19 | C-19 |
| 0003 DB-1 B-29 | C-23 |
| 0004 A-1 | C-6 |
| 0004 A-2 | C-14 |
| 0004 A-4 | C-21 |
| 0004 A-5 | C-1, C-15, C-16 |
| 0004 A-6 | C-6, C-8 |
| 0004 A-7 | C-6 |
| 0004 Assertions, item 1 | C-36 |
| 0004 Assertions, item 3 | C-18 |
| 0004 Assertions, item 4 | C-39 |
| 0004 Assertions, item 5 | C-6, C-40 |
| 0004 Signatures v0.1 (.d.ts) | C-7, C-12 |
| 0004 O-1 | C-15 |
| 0004 O-2 | C-12 |
| 0004 O-3 | C-12 |
| 0004 X-3 (cross-ADR) | C-15 |
| 0004 DB-1 B-18 | C-6, C-8 |
| 0004 DB-1 B-20 | C-36 |
| 0004 DB-1 B-24 | C-7, C-12 |
| 0004 DB-1 B-26 | C-21 |

## Source map

Each source item maps to a C-id or reads "history-only". Rule text is not repeated here.

| item | C-id |
| --- | --- |
| G-A F-1 | C-1 |
| G-A F-2 | C-2 |
| G-A F-3 | C-3 |
| G-A HIT-1 | C-4 |
| G-A B-18 | C-5, C-6, C-8 |
| G-A B-20 | C-36 |
| G-A B-21 | C-11 |
| G-A B-22 | C-9, C-10 |
| G-A B-24 | C-7, C-10, C-12 |
| G-A B-28 | C-14 |
| G-A X-3 | C-15 |
| G-A XG-2 | C-42 |
| G-A XG-4 | C-42 |
| G-A D-1 | C-16 |
| G-A D-2 | C-24 |
| G-A D-3 | C-9 |
| G-A R-D1 | C-16 |
| G-A R-D2 | C-24 |
| G-A R-D3 | C-9 |
| G-A TASK 0 | C-36 |
| G-A TASK 1 | history-only: superseded by the Amends table and C-42 |
| G-A TASK 2 | history-only: superseded by the Amends table and C-42 |
| G-A TASK 3 | history-only: superseded by the Amends table and C-42 |
| G-A TASK 4 | history-only: superseded by the Amends table and C-42 |
| G-A TASK 5 | history-only: docs unit, statuses live in C-42 |
| G-A TASK 6 | history-only: a FILLER, see C-42 |
| G-A TASK 7 | C-34, C-37, C-38, C-39, C-40 |
| G-A TASK 8 | C-42 |
| G-A A1 | C-34, C-35 |
| G-A A2 | C-36 |
| G-A A3 | C-37 |
| G-A A4 | C-38 |
| G-A A5 | C-39 |
| G-A RISK-1 | history-only: superseded by C-25 (p table) and C-15 (T = 0 by slack) |
| G-A RISK-2 | history-only: confirmed in C-1 and C-6 (rewritten ADR items) |
| G-A RISK-3 | history-only: closed by R-D3 in C-9 |
| G-A-D1 | C-34 |
| G-A-D2 | C-35 |
| G-A-D3 | C-6 |
| G-A-D4 | C-40 |
| G-A-D5 | C-14, C-17, C-37 |
| G-A-D6 | C-26 (touches text history-only: superseded by C-25) |
| G-A-D7 | C-4, C-10 |
| G-A-D8 | C-13 |
| G-A-D9 | C-11, C-37 |
| G-A-D10 | C-15, C-36 |
| G-A-D11 | C-3, C-42 |
| G-A A2-1 | C-35 |
| G-A A2-2 | C-10 |
| G-A A2-3 | C-13 |
| G-A A2-4 | C-40 |
| G-A A2-5 | C-14, C-17, C-37 |
| G-A A2-6 | C-25 |
| G-A A2-7 | C-34 |
| G-A A2-8 | C-15, C-34 |
| G-A A3-1 | C-27, C-34 |
| G-A A3-2 | C-34 |
| G-A A3-3 | C-34 |
| G-A A3-4 | C-40 |
| G-A A3-5 | C-17 |
| R-D4 | C-42 (ruling recorded in the header section) |
| G-B O-4 | C-18 |
| G-B B-19 | C-19 |
| G-B B-25 | C-20 |
| G-B B-26 | C-21 |
| G-B B-27 | C-22 |
| G-B B-29 | C-23 |
| G-B B-32 | C-31 |
| G-B XG-1 | C-5, C-28 |
| G-B TASK 0 | C-30, C-31 |
| G-B TASK 1 | C-30 |
| G-B TASK 2 | C-30 |
| G-B TASK 3 | C-29 |
| G-B TASK 4 | C-28 |
| G-B TASK 5 | C-28 |
| G-B TASK 6 | C-31, C-32 |
| G-B TASK 7 | C-33 |
| G-B ASSERT 1 | C-30, C-41 |
| G-B ASSERT 2 | C-23, C-41 |
| G-B ASSERT 3 | C-28, C-41 |
| G-B ASSERT 4 | C-33, C-41 |
| G-B ASSERT 5 | C-30, C-41 |
| G-B ASSERT 6 | C-32, C-41 |
| G-B RISK | history-only: dependencies closed by C-3, C-4, C-6, C-15, C-27, C-29 |
| G-B-D1 | C-31 |
| G-B-D2 | C-31 |
| G-B-D3 | C-27, C-11 |
| G-B-D4 | C-28 |
| G-B-D5 | C-28 |
| G-B-D6 | C-32 |
| G-B-D7 | C-26 (touches text history-only: superseded by C-25) |
| G-B-D8 | C-29, C-33 |
| G-B B2-1 | C-27, C-31 |
| G-B B2-2 | C-27, C-1 |
| G-B B2-3 | C-32 |
| G-B B2-4 | C-25 |
| G-B B2-5 | C-32 |
| G-B B2-6 | C-31, C-30 |
| G-B B3-1 | C-8, C-27 |
| G-B B3-2 | C-25 |
| DB1 P-01 | C-31 |
| DB1 P-02 | C-34, C-35 |
| DB1 P-03 | C-28 |
| DB1 P-04 | C-27, C-11 |
| DB1 P-05 | C-6, C-40 |
| DB1 P-06 | C-14 |
| DB1 P-07 | C-31, C-32 |
| DB1 P-08 | C-25 |
| DB1 P-09 | C-36, C-8, C-2, C-9 |
| DB1 P-10 | C-42 |
| DB1 P-11 | C-10, C-13 |
| DB1 P-12 | C-11 |
| DB1 P-13 | history-only: moot after R-D3 (C-9) |
| DB1 P-14 | C-15 |
| DB1 P-15 | C-28 |
| DB1 P-16 | C-27 |
| DB1 P-17 | C-27, C-8 |
| DB1 P-18 | C-35 |
| DB1 P-19 | C-10 |
| DB1 P-20 | C-13 |
| DB1 P-21 | C-40 |
| DB1 P-22 | C-32 |
| DB1 P-23 | C-14, C-17 |
| DB1 N-1 | C-27, C-34 |
| DB1 N-2 | C-34 |
| DB1 N-3 | C-8 |
| DB1 N-4 | C-25 |
| DB1 N-5 | C-34 |
| 0005 A4-1 | C-32 |
| 0005 A4-2 | C-31, C-32 |
| 0005 A4-3 | C-33 |
| 0005 A4-4 | C-33 |
| 0005 A4-5 | C-31, C-32, C-33 |
| 0005 A4-6 | C-27, C-31 |
| 0005 A4-7 | C-27, C-28 |
| 0005 A4-8 | C-28 |
| 0005 A4-9 | C-10, C-12 |
| 0005 A4-10 | C-32, C-33 |
| 0005 A4-11 | C-27, C-31, C-32 |
| 0005 A4-12 | C-31, C-32, C-33, C-42 |
| 0005 A4-13 | C-31, C-33 |
| 0005 A4-14 | C-31, C-32 |

Count note: this map has 128 rows: G-A 61 (body 13, D-1..D-3 3, R-D1..R-D3 3, TASKS 0-8 9, A1..A5 5, RISK 3, G-A-D1..D11
11, A2-1..A2-8 8, A3-1..A3-5 5, plus the shared R-D4 row), G-B 39 (O-4, B-19, B-25, B-26, B-27, B-29, B-32, XG-1;
TASKS 0-7; ASSERTIONS 1-6; RISK; D1..D8; B2-1..B2-6; B3-1..B3-2) and DB1 28 (P-01..P-23, N-1..N-5). The planner's 97
(45/24/28) = G-A body 13 + A1..A5 5 + D-1..D-3 3 + G-A-D1..D11 11 + A2 8 + A3 5; G-B body 8 + D1..D8 8 + B2 6 + B3 2;
DB1 28. The 31 extra rows are G-A R-D1..R-D4, TASKS 0-8, RISK 1-3 and G-B TASKS 0-7, ASSERTIONS 1-6, RISK. The 14
rows 0005 A4-1..A4-14 follow the DB1 rows (142 rows in all).

## Addenda

### ADDENDUM 4 (2026-10-26) -- HB4 (stubs + exhaustive lanes), HB3 walker, 0005's own

Tier: every gate named here is DETERMINISTIC (npm test, test/Exhaustive.test.mjs, test/Walker.test.mjs,
test/Oracle.test.mjs); the counts in A4-2 and A4-12 are exact integers, not timings. Each item names the CURRENT
rule(s) it changed; the rule text above is already amended (same edit). The map rows are in the Source map.

- A4-1 Cell attribution (plan review R1-1) -> C-32. Cells are tallied over bfsLane + deepLane only (the sweep adds
  none). mergeMoves / equalizeK count on a removeAt op only (k = T-6's neighbour v in the pre-op snapshot, p = i - fb
  of the pre-op leaf); a merge or equalize inside splitAt / append counts only toward splitAt1 / splitAt2 / append1.
  drop applies to bfsLane AND deepLane; at B=8 missing(drop ['removeAt']) minus missing(full) = {mergeMoves,
  equalize4..equalize8}.
- A4-2 Sizes and the "application" definition (R1-2) -> C-31, C-32. One application = one op on one on / off pair,
  replays included; a lane over 2^18 lowers its nMax / nSweep by 1 and records it here, never raises 2^18; 15 s is
  nominal, not a gate. Replaces the plan's "if over, halve the deep ops". Stub sizes: nMax 6 / 10, nSweep 5 / 9, deep
  4,000 ops per B.
- A4-3 Expected mutant reports (R1-3) -> C-33. flatStub, seekStub, staleFingerStub, nolandStub, countStub, homeStub,
  cfg.protoField and the cap-10 BUDGET control have the first-failure reports now stated in C-33.
- A4-4 A4 scope (R1-4, settled: DROP) -> C-33. The stub B/op lane and the lite-leak arena tracking (with `onArena`)
  are dropped; the 100 fill / split / append / clear cycles ending at bump = live = 0 are kept. The engine's C-38 and
  C-39 are unchanged.
- A4-5 API pin (R1-5) -> C-31, C-32, C-33: stub factories and cfg keys, lane signatures, report and first
  shapes, CELLS / coverageMissing / assertCoverage, ENGINE / CAPS keys (cap, nMax, nSweep, deepOps, deepN).
- A4-6 Fail-open closers (R1-6) -> C-31, C-27: applied > 0 and every n in 0..nMax seen; 'SWEEP' 'no states'; an
  unmatched stub throw (replays included) = 'ORACLE'; the deep-lane redraws at nHi / nLo; the C-27 hasOwn check is a
  lane-start check, not a per-op step.
- A4-7 HB3 walker (committed 6514d58) -> C-27, C-28. C-28 names the codes in check order: SNAP, I-7, I-8, I-1, I-2,
  I-3, I-5, I-9a, XG-1 (= I-9 (b), the C-5 ownership rule; there is no I-9b), I-9c, I-9d, I-9e. C-27 states that the
  binding SNAPSHOT shape is the test/walker.mjs header (sha256 3a163137) and summarises it.
- A4-8 HB3 implementer readings (review-ACCEPTED) -> C-28: 'dup' = next[x] === x, any other revisit = 'cycle'; census
  'range' before 'shared', leaf pool before internal; I-8 n_s = recounted count with slot reads capped to [0, B]; NaN
  equal in the I-2 sum compare (I-3 reports it); _fb / _fdepth typed only when _fl !== NIL; walk() try/catch -> SNAP
  'exception ...'; 'reach' / 'retention' are unreachable defensive tokens.
- A4-9 C-10 gap -> C-10, C-12: index before operand (splitAt; append takes no index); dim before seek (indexAtSum);
  -0 acts as 0 for both; the capacity token 'capacity' sits between extra slots and headroom; an operand from another
  arena throws with the token 'operand'; sumBefore is sumBefore(d, i). The index / dim / -0 orders are pinned by
  test/oracle.mjs and Oracle.test.mjs; 'capacity' and the cross-arena 'operand' are stub + driver behaviour (oracle.mjs
  (a) / (b): the oracle does not model them).
- A4-10 B1 stub readings (review-ACCEPTED) -> C-33, C-32: items (a)..(j) of C-33. (a) is invisible to the walker and
  to ONOFF; (c) is literal T-6 and differs from the C-42 leaf model (it feeds the equalize k of C-32).
- A4-11 B2 driver readings (review-ACCEPTED 2026-10-26; the driver check order is from PLAN-HB4 SPEC 2) -> C-31,
  C-32, C-27: the sweep landing on the on run only; a
  lane stops at its first failure (divergences 0 or 1); sweep C = max(nSweep + 1, the highest live a witness reaches),
  deep C = nHi; witness args from position k; the deep-lane zero measure when (r >>> 16) % 20 == 0; the C-34 fixed
  clears kept (never fire at 4,000 ops); starts empty with no view draw at start; splitAt + append = one stream op /
  two applications; the LANE code; invalid lane options throw RangeError; sweepLane / deepLane take `cap`; suffixes per
  state 8n + 7 (the extra one is `total`, so C-31's sweep cost factor (8n+6) became (8n+7)); the finger compare skips
  ops that threw, two NIL fingers equal, on vs off compares _fpath[0, _fdepth) only.
- A4-12 Measured (deterministic counts, test code, node v26.8.2, 2026-10-26; no timing) -> C-31, C-32, C-33, C-42.
  Applied per lane, B=4 / B=8: bfs 7,095 / 24,532; sweep 40,623 / 154,475 (59% of 2^18); deep 4,226 / 4,222. synthStub
  coverage misses exactly the 4 rot cells per B (expected: it never rotates). Engine numbers (2^22, 9/15, 7/12, 2e4,
  the 2e4 deep run, positive coverage, cursor suffixes, C-20 / C-25 exactness, W-DEL / W-INS / W-TIE) stay DEFERRED
  to the engine group.

- A4-13 Driver order -> C-31, C-33: the lane driver builds the finger-ON arena first, then the finger-OFF arena, for
  every pair; this is a driver contract (the test's off-only wrapper controls rely on it).
- A4-14 Engine-time coverage (not gated on the stub) -> C-31, C-32: under CAPS, clear only ever runs on an empty b
  (the sweep suffix b.clear() follows a fresh replay where b is empty; the deep lane's fixed clears need op >= 4999),
  so a clear on a non-empty view is covered only at engine size; the mergeMoves move condition (moves delta -
  removeMoves(m, m, p, 0, 0) > 0) is never false on the stub (252/252 removeAt merges pass it, B=8; bfsLane 144 +
  deepLane 108, CAPS), so its false branch is unexercised there.
