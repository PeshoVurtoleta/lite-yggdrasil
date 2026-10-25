# 0004 -- Arena ownership: one shared internal arena, setup-time views (Y-15)

- Status: RULED 2026-10-25 (maintainer, S0)
- Ruling: "(a) internal shared arena" (R-Y15); counters "Per view" (R-X2); "RangeError everywhere" (R-X5)
- Severity: S1
- Date: 2026-10-25
- Session: S0

## Ruling (2026-10-25)

- R-Y15 (Y-15): "(a) internal shared arena" -- ADR 0004 as written (SumSequence.arena(C, o, k)).
- R-X2: "Per view" -- counters are per view; ADR 0004 O-4 closed.
- R-X5: "RangeError everywhere" -- A-3 TypeError -> RangeError.
- O-4 and X-2 below: CLOSED by R-X2. X-5 below: CLOSED by R-X5.

## DB-1 findings (2026-10-25) -- OPEN for the SumSequence planner

- B-18 (S2): epoch storage / wrap / clear() are unspecified (b.clear() O(1) pool reset then a's insert reuses b's finger leaf; an Int32 epoch re-matches after 2^32 bumps; a plain field leaves Smi range after 2^30).
- B-20 (S2): assertion-1 control can never fail (views 1365/1365/1366 make <= 1023 leaves under ADR 0001 T-9, not 1026), and A-5 ("one under-min leaf per view") contradicts T-9; a working control is views 1 / 1 / 4094 -> 1025.
- B-24 (S2): the virtual-list consumer needs entity -> index (a parent column), which O-3 defers to v0.4, plus entityAt, getMeasure, a cursor seek and a non-allocating dims > 1 insert form.
- B-26 (S3): seam-repair counts disagree (A-4 "one" vs ADR 0001 T-7 "<= 2" / join "<= 1" vs ADR 0003 row 11 "<= 2").

## Context

SCOPE section 5 offers `rows.splitAt(i, outSeq)` / `append(otherSeq)` between two
independently constructed fixed-capacity arenas, which cannot be O(log n): moving
nodes between typed-array arenas is O(moved) (P-1). The sibling lite-logn Treap
shares ONE arena but returns views, and its split allocates (`[left, right]` plus
two views, LogN.js:2210-2228), so it is not the zero-GC model either. The same
choice moves the leaf bound I-8: with k sequences on one arena,
L <= ceil(C / 4) + k (each sequence may own one short leaf).

Recommendation: option (a), ONE internal arena shared by views created at setup;
the hot body is identical for any k (no view branch); every multi-view check
lives in cold splitAt / append / clear.

## Decision

- A-1 The ARENA owns every column, both node pools, spine stacks, counters and an
  Int32Array header (live, bump / free heads). It is internal, never exported
  (export list unchanged). A SumSequence is a VIEW: hoisted column refs + its own
  root, length, epoch, finger, cursor. An empty view owns 0 nodes.
- A-2 Views exist only from setup: `new SumSequence(C, o)` = an arena with k = 1;
  `SumSequence.arena(C, o, count)` = k = count views (count integer in [1, C],
  validated before any allocation -- lite-logn F8 precedent, LogN.js:3914). No op
  ever creates, consumes or kills a view (contrast Treap.split / merge
  :2219-2261 and BinomialHeap consumed-after-meld :4067). After `a.append(b)`, b
  is a live empty view, reusable as the next `out`.
- A-3 Validation precedes all mutation (every view unchanged on throw): RangeError (was TypeError; R-X5)
  if the argument is not a SumSequence; RangeError if from another arena (column
  identity `other._hdr !== this._hdr`; so on a k = 1 sequence splitAt / append
  always throw -- the message names `SumSequence.arena`), if `other === this`, if
  `out` is non-empty, if i is not an integer in [0, length] (typeof guard first).
- A-4 `splitAt(i, out)`: this keeps [0, i), out gets [i, length).
  `append(other)`: this := this ++ other, other := empty. Both O(log n) relink +
  one seam repair (ADR 0001), zero allocation, return this. append pre-checks
  total_d(this) + total_d(other) <= 2^53 - 1 for every dim (ADR 0002 bound);
  splitAt never raises a total.
- A-5 Capacity C is arena-wide in ELEMENTS. The ONLY capacity failure is
  `live + 1 > C` on insertAt of any view (RangeError, all views unchanged); pools
  can never run empty, so the failure point is shape-independent. Pools: leaf
  pool = L_max + T_leaf, internal pool = L_max - 1 + T_int, with
  L_max = ceil(C / m) + k (m = ADR 0001 min leaf occupancy, 4 at B = 16; each view
  at most one under-min leaf) and T = one op's transient peak (expected 1 / 1,
  nominal). Spine stacks sized from L_max, one set per arena (shared: no op
  re-enters). I-8 becomes L <= ceil(C / m) + k. Fixed views are what make L
  boundable.
- A-6 clear() empties THIS view only: O(L_view) cold iterative allocation-free
  free-walk; if length === live (this view holds everything) it skips the walk and
  resets the pools to construction order in O(1). So k = 1 clear() IS the D-C8
  reset, and the last view to clear restores the header byte-for-byte. No
  arena-wide clear in v0.1.
- A-7 Epoch per view; splitAt / append bump BOTH views' epochs. A moved-from
  view's finger misses and its cursor reads `valid === false`; it never walks
  foreign nodes.
- A-8 insertAt / removeAt / setMeasure / indexAtSum / sumBefore / cursor carry no
  k or view branch. Both construction paths go through one internal init with
  identical field order (one hidden class across views).
- A-9 v0.4 Yggdrasil pool owns ARENAS (one per realm, built by the same internal
  factory) and adds arena-wide id columns + entity uniqueness per arena
  (PairingHeap `_pos` precedent :4364). v0.1 needs neither.

### Signatures v0.1 (.d.ts)

```
constructor(capacity: number, options?: { dims?: number });
static arena(capacity: number, options: { dims?: number } | undefined, count: number): SumSequence[];
readonly capacity: number;   // arena-wide C
readonly available: number;  // C - live elements, whole arena
readonly length: number;     // this view
splitAt(i: number, out: SumSequence): this;
append(other: SumSequence): this;
clear(): this;
```

### Options

| opt | split/append | GC per call | 2nd sequence | leaf bound L | verdict |
| --- | --- | --- | --- | --- | --- |
| (a) shared arena, setup views | O(log n) | 0 | `arena(C,o,k)` | ceil(C/m)+k | ADOPT |
| (a') exported SumArena, `new SumSequence(arena)` / lazy `sibling()` | O(log n) | 0 | ctor overload | needs a fixed maxViews anyway | reject v0.1: same mechanics + a new export + a polymorphic first arg (number or object) |
| (b) per-instance arena | O(moved) | 0 | any | ceil(C/m)+1 each | reject: breaks P5's O(log n); a silent cross-arena copy is a hidden O(n) cliff |
| (c1) root registers inside one instance | O(log n) | 0 | register index | +R | reject: every query takes a register arg |
| (c2) Treap-style returned views | O(log n) | 2 views + tuple (:2223-2227) | per call | UNBOUNDED -> fixed arena unsizable | reject |
| (c3) `moveRange(i, j, at)` on internal scratch roots | O(log n) | 0 | none | +2 | additive to (a), not a replacement -> O-2 |

### Assertions

1. `arena(4096,{dims:1},3)` under 1e4 seeded ops incl. splitAt/append: filling to
   live = 4096 succeeds, the 4097th insertAt on ANY view throws, all views
   walker-identical, pool-empty events = 0. Control: L_max without the +k; a
   constructed stream (views of 1365/1365/1366 = 1026 leaves > 1024) exhausts the
   leaf pool.
2. Torture cut/paste lane on `arena(1e5,{dims:2},3)`:
   `splitAt(i,tmp); tmp.splitAt(j,clip); append(clip); append(tmp)` x 1e5 ->
   0 B/op, maxMajor 0. Control: Treap-style lane creating a view per split shows
   > 0 B/op.
3. Elements moved per splitAt <= 48 (3 x B, nominal until ADR 0001's formula) at
   n = 1e3 and 1e6 alike; control: option-(b) copy mutant moves n - i.
4. Retention: after every op over 1e4 cycles, allocated nodes == sum of views'
   walker node counts; after all views clear, header == construction state
   (bump 0, live 0); lite-leak tracker.size() == 0 after 100
   create/fill/cut-paste/clear/drop cycles.
5. append(self), splitAt(i,self), non-empty out, cross-arena, total overflow ->
   each throws with both views unchanged; after `a.append(other)` other's cursor
   valid === false; `%HaveSameMap(new SumSequence(C,o), arena(C,o,3)[2])` true;
   touches/pulls on `arena(C,o,3)[0]` == `new SumSequence(C,o)` for the same
   1e4-op stream (A-8).

## Evidence (S0, 2026-10-25)

No command was run for this ADR in S0 (node v26.8.2 session). The line citations
(LogN.js:3914, :2219-2261, :2223-2227, :4067, :4364) are from the planner's read
of the sibling source and are not re-verified here. The "48 = 3 x B" bound in
assertion 3 and T = 1 / 1 in A-5 are nominal.

## Consequences

- The SumSequence coder builds the internal arena, the header, `arena()` and the
  cold split / append / clear paths per A-1..A-8; the hot body gets no view
  branch (assertion 5 compares touches/pulls of a k = 3 view with a k = 1
  sequence).
- Pool and stack sizes use L_max = ceil(C/m) + k; the formula is reconciled with
  ADR 0001 T-9 (X-3) before coding, and ADR 0001 must prove at most one under-min
  leaf per non-empty view (O-1).
- append's total pre-check uses ADR 0002 M-4; A-3 throws RangeError for every bad
  argument (R-X5).
- The .d.ts gains `static arena`, `capacity`, `available`, `splitAt`, `append`,
  `clear` as in the signatures block; the export list is unchanged.
- Doc sites for the S0-U4 pass (not edited here): ROADMAP section 2 Y-15 row,
  RESEARCH I-8, SCOPE section 5 line 145 comment.

## OPEN

- O-1 (S1) A-5 holds only if ADR 0001's seam repair (P-6) proves "at most one
  under-min leaf per non-empty view" and fixes T; else L_max uses ADR 0001's
  exact count.
- O-2 (S2) `moveRange` / `insertSeqAt` for P5 cut/paste without a tmp view --
  lean: only if the DB-11 LiteVirtual spike needs it.
- O-3 (S1, forward) v0.4 `pool.remove(id)` on a POSITIONAL realm needs a
  leaf -> root walk = a parent column (root's parent slot = ~viewIndex names its
  view); keyed realms can re-descend by stored key. Adding parents in v0.4 edits
  the trunk hot body (ROADMAP 3.7 allows only additive hunks). Decide in the
  SumSequence planner pass: carry the column from v0.1, or exclude positional
  realms from pool.remove.
- O-4 (S3) CLOSED by R-X2 (per view). Counters per arena (lean) vs per view -- ADR 0003.
- X-2 (cross-ADR) -- CLOSED by R-X2, per view (0003 O-2 vs 0004 O-4): counters per VIEW (0003 lean) vs per
  ARENA (0004 lean). Unresolved; ruling.
- X-3 (cross-ADR) (0001 T-9 vs 0004 A-5): both size pools as ceil(C/m) + K; 0004
  adds a transient T (expected 1/1) that 0001 argues is unnecessary (covered by
  out becoming non-empty / fresh node inside Lmax). The SumSequence planner fixes
  one formula.
- X-5 (cross-ADR) -- CLOSED by R-X5, RangeError everywhere (0002 O-3 vs 0004 A-3): a non-number measure -> RangeError
  (0002 M-3) but a non-SumSequence argument -> TypeError (0004 A-3). ROADMAP law
  1 says RangeError. Ruling: one error class or a stated split.

Risk: couples to ADR 0001 (O-1, T), ADR 0002 (append total check, P-5 sign
rule), ADR 0003 (O-4).
