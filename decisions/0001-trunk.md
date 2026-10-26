# 0001 -- Trunk: binary leaf-oriented BB[1/4], join / split, leaf policy (Y-01)

- Status: RULED 2026-10-25 (maintainer, S0)
- Ruling: "Rule as ADR 0001" (R-Y01); append split "(B+1-m | m) = 13|4" (R-X1)
- Severity: S1 (P-2 proof gap; the trunk shape feeds ADR 0003 and ADR 0004)
- Date: 2026-10-25
- Session: S0

## Ruling (2026-10-25)

- R-Y01 (Y-01): "Rule as ADR 0001" -- binary leaf-oriented BB[1/4], weight = leaf count, H-Y gamma = 2 for insert / delete, BFS's own rule inside join / split; B+ fanout stays research R-7. O-1 / O-2 stay OPEN.
- R-X1: "(B+1-m | m) = 13|4" -- ADR 0001 Table 3; finger hits 12/13; ADR 0003 G-12 s0 := m. ROADMAP / SCOPE "15 + 1", "~14/15", "14 of every 15" are SUPERSEDED. (Y-06 numeric B stays measured in SumSequence.)
- X-1 below: CLOSED by R-X1.

## Superseded / amended by 0005 (CURRENT)

These items are amended by decisions/0005-sumsequence-current.md (CURRENT, consolidated through ADDENDUM 3); 0005 is binding where they differ.

| ADR item | amended by |
| --- | --- |
| Table 3 -- leaf policy in B (m = B/4; [B = 16]), finger-hits paragraph | C-4 |
| Table 3 -- leaf policy in B (m = B/4; [B = 16]), row `last leaf, p = B (append)` | C-18 |
| Table 3 -- leaf policy in B (m = B/4; [B = 16]), row `first leaf, p = 0 (prepend)` | C-18 |
| Table 3 -- leaf policy in B (m = B/4; [B = 16]), row `hysteresis` | C-22 |
| T-2 | C-20 |
| T-7 | C-21 |
| T-9 | C-14, C-15 |
| T-10 | C-23 |
| O-4 | C-18 |
| O-6 | C-4 |
| DB-2 | C-31 |
| I-8 walker assertions | C-28 |
| X-3 (cross-ADR) | C-15 |
| DB-1 B-17 | C-1, C-2, C-3, C-4, C-5 |
| DB-1 B-21 | C-11 |
| DB-1 B-25 | C-20 |
| DB-1 B-26 | C-21 |
| DB-1 B-27 | C-22 |
| DB-1 B-28 | C-14 |
| DB-1 B-29 | C-23 |

## DB-1 findings (2026-10-25) -- OPEN for the SumSequence planner -- closed / deferred in 0005

- B-17 (S1): the finger rule is incomplete (stale positional base after an ordinary miss; draining the last element frees the leaf on a "hit"; equalize leaves a stale keyed fence), and ADR 0001 and 0003 define "hit" differently.
- B-21 (S2): there is no way to choose B (DB-2 needs B = 4 / 8; the .d.ts options are { dims } only).
- B-25 (S3): T-2's per-ancestor balance check is dead on the hot path (weight = leaf count, so a non-splitting insert / non-underflowing remove changes no weight).
- B-26 (S3): seam-repair counts disagree (T-7 "<= 2" / join "<= 1" vs 0004 A-4 "one", 0003 row 11 "<= 2"), and T-7's "both single leaves -> one leaf" is false (10 + 10 -> two leaves).
- B-27 (S3): the Table 3 hysteresis row holds only for the interior split; after a 13|4 edge split one remove underflows.
- B-28 (S3): no stated MAX_CAPACITY / dims cap (Int32 count overflows near 2^31; indices >= 2^30 leave Smi range).
- B-29 (S3): "H(L) <= log_{4/3}(L) - 1.4" (T-10) is false at L = 1.

## Context

The ROADMAP leaned on Hirai-Yamamoto <3,2> (H-Y) rebalancing for the trunk, but
H-Y covers single insert / delete only; join / split correctness is
Blelloch-Ferizovic-Sun (BFS) with its own alpha range and rotation rule (P-2).
The leaf policy ("split 8 + 8", "15 + 1") also left the split sizes of a 17th
element, the finger-hit formula and every occupancy count undefined (P-3), and
the seam leaves after splitAt / join can drop below the minimum (P-6). This ADR
states the trunk, both assumption tables and the leaf policy as formulas in B.

## Sources and confidence

FROM MEMORY, not re-read: the H-Y rotation rule "single iff w(inner) <
2*w(outer)" (strict); the BFS alpha range <= 1 - 1/sqrt2 and its rotation rule;
Straka / Data.Map delta 3 ratio 2 with size-only weights. Everything else is
derived in this ADR, each item with a test. These three items stay OPEN
(O-1, O-2) until transcribed from the papers; none is a fact here.

Hot vs cold: HOT = descent + leaf shift + one pull-and-balance-check pass (T-2).
COLD = leaf split / merge / equalize, join / split, seam repair, rotations (own
non-inlined functions taking node ids only), walker.

## Decision

- T-1 Trunk: binary, leaf-oriented, BB[1/4]. w(leaf) = 1, w(u) = w(l) + w(r),
  Int32. I-1: `3*w(l) >= w(r) && 3*w(r) >= w(l)` (alpha = 1/4 == H-Y delta = 3).
  Element count is a separate column.
- T-2 insertAt / removeAt (HOT): bottom-up over the path stack visiting EVERY
  ancestor (no early exit: weights change to the root); an out-of-balance node
  gets ONE rotation chosen by H-Y gamma = 2, strict: single iff
  w(inner) < 2*w(outer), else double.
- T-3 join(L, R) (COLD): iterative BFS joinRight / joinLeft -- push the heavier
  tree's spine to the first node c balanced (I-1) against the other tree; one
  fresh internal node; pop back up: keep if balanced; single rotation iff both
  new nodes pass I-1; else double. The gamma rule is NOT used in join (no proof
  covers it there).
- T-4 splitAt (COLD): iterative BFS split; path internal nodes are reused as
  each join's fresh node; a mid-leaf cut allocates one leaf (the left part stays
  in place); an empty operand is the identity.
- T-5 Leaf policy = Table 3, m = B/4. B in {4, 8, 16, 32}, default 16; B = 4 and
  8 documented test-only. Insert routing: left iff i <= count[left] (so p = 0
  only occurs in the first leaf).
- T-6 Underflow (s = m-1 after a remove): neighbour v = the in-order adjacent
  leaf on u's sibling side (always exists). s + k <= B/2 -> merge (free u,
  splice out parent(u)); else equalize: left leaf of the pair floor(t/2), right
  ceil(t/2).
- T-7 Seams: after splitAt, repair each result's seam leaf if < m (<= 2
  repairs); after join, repair the seam pair if either is short, using the other
  seam leaf as neighbour (<= 1 repair). Rule = T-6 for any s in [1, m-1].
  Results >= m, except both inputs single leaves -> result is one leaf and
  exempt (T-8).
- T-8 Single-leaf exemption: a one-leaf sequence holds 1..B elements; an empty
  sequence is a NIL root with no leaf.
- T-9 Leaf-count bound: per sequence L_s <= max(1, floor(n_s/m)). Both pools
  (leaf, internal) sized Lmax = ceil(C/m) + K, K = max non-empty sequences per
  arena (ADR 0004 / Y-15 owns it). Lmax <= 2^29 so 3*w stays int32 (unboxed).
  Temporary peaks fit: a mid-leaf cut's extra leaf is covered because `out`
  becomes non-empty (k+1); join's fresh node fits inside Lmax.
- T-10 Height: H(L) = number of steps w <- floor(3w/4) from L down to 1 = the
  exact max height, integer-only (no Math.log). H(L) <= log_{4/3}(L) - 1.4
  (nominal); H(2^22) = 50 (checked, see Evidence). Path stack and join stack are
  each Int32Array(H(Lmax)). Replaces ceil(2.5 log2(L+2)) + 8.

### Table 1 -- Hirai-Yamamoto <3,2> (insert / delete)

| assumption | our representation | holds? | how a test checks it |
| --- | --- | --- | --- |
| w = size+1 (external nodes) | leaf count; a leaf = an external node | yes (isomorphism) | walker recomputes leaf counts, asserts stored == recompute, checks I-1 on the recompute |
| delta = 3 | T-1 integer | yes | walker I-1 after every op |
| single iff inner < 2*outer, strict | T-2 | only if transcribed exactly | witnesses W-INS / W-DEL / W-TIE (DB-8) |
| insert = one external node on one path (+1 per ancestor) | leaf split | yes | walker after each split; DB-2 |
| delete splices a node with an external child (-1 on one path) | merge splices parent(u) whose child u is a leaf | OPEN O-2 | DB-2 removes at every position |
| equalize | no shape change | yes | walker: shape hash unchanged, 0 rotations |
| empty tree = 1 external node | L = 1 matches; L = 0 (NIL root) outside the proof | yes (no internal node) | DB-7 rows |

### Table 2 -- Blelloch-Ferizovic-Sun join / split (WB)

| assumption | our representation | holds? | how a test checks it |
| --- | --- | --- | --- |
| BB[alpha], w = size+1 | alpha = 1/4 | yes: 4wl >= wl+wr <=> 3wl >= wr | walker |
| join correct for alpha <= 1-1/sqrt2 (~0.293), one rotation per level | 0.25 | OPEN O-1 | DB-2 joins every pair of reachable trees |
| BFS's own rotation rule (not gamma) | T-3 | yes, by choice | mutant M-4 (gamma rule inside join): record whether killed |
| join3(TL, k, TR) | join(L, R) + fresh node; w = wL + wR | yes (isomorphism) | oracle + walker; splitAt then append = identity |
| split = joins up the path | T-4 | yes, follows from join | DB-2 splitAt at every position |
| join with empty Leaf inserts k | NIL is the identity | yes, by definition | DB-7 rows |
| BFS has no leaf runs / seams | a T-7 merge = a Table-1 delete on a BFS-balanced tree | inherits O-2 | walker after each repair |

Answer to P-2(b): alpha = 1/4 is inside BFS's range, but BFS proves join only
with its OWN rotation rule; neither paper establishes gamma = 2 inside join, so
T-3 does not use it. (The BFS range itself is from memory; see O-1.)

### Table 3 -- leaf policy in B (m = B/4; [B = 16])

| event | sizes |
| --- | --- |
| full interior leaf gets element B+1 at p in [1, B] | old elements split B/2 \| B/2; the new element goes to its own half: p <= B/2 -> (B/2+1 \| B/2) [9\|8], else (B/2 \| B/2+1) [8\|9] |
| last leaf, p = B (append) | (B+1-m \| m) [13\|4]; m moves |
| first leaf, p = 0 (prepend) | (m \| B+1-m) [4\|13] |
| underflow | s = m-1 [3] |
| merge | iff s+k <= B/2 [k <= 5]; result in [2m-1, B/2] |
| equalize | floor / ceil((s+k)/2), both >= m |
| hysteresis | split -> underflow takes B/2-m+1 removes [5]; merge -> split takes B/2+1 inserts [9] |

Finger hits, N strictly increasing appends from empty (hit = no descent + no
structural change, ADR 0003): S(N) = 0 if N <= B else floor((N-B-1)/(B-m+1)) + 1;
hits(N) = N - 1 - S(N). B = 16: S(N) = floor((N-17)/13) + 1, hit ratio -> 12/13.

Rejected alternative: (B | 1) split with an edge-leaf exemption -- 15/16 hits
and full leaves, but +2K short leaves and an exemption that moves on every join
/ splitAt.

DB-2 B values: B = 4 (m = 1) reaches every rotation case at small n, both split
kinds, equalize; its merge moves 0 elements and seam repair never fires
("short" = empty). B = 8 (m = 2) reaches a moving merge (s = 1, k in {2,3}),
equalize with k in 4..8, every seam repair. BOTH required; B = 16 only for count
gates. DB-2 = breadth-first search over canonical states (shape + leaf sizes),
closed under insertAt / removeAt / splitAt + append at every position.

### I-8 walker assertions

height(s) <= H(L_s) <= stack length; L_s <= max(1, floor(n_s/m)); sum of L_s
over the arena <= Lmax; live internal nodes = sum (L_s - 1).

### DB-8 mutants

- M-1 element-count weights: killed by I-1 on recomputed leaf counts. Example: a
  4-element leaf next to a 4-leaf subtree of 1-element leaves: mutant 5 vs 5
  (balanced), leaf counts 1 vs 4 (fails). At B = 4 there is NO unfixable sibling
  PAIR (sizes 1 and 4 weigh 2 vs 5, balanced); the pair exists only at B = 16
  (5 vs 17) -> ROADMAP DB-2's "1 and 4" is wrong (X-6).
- M-2 Adams size-only weights: EQUIVALENT for I-1 shapes (3(wl-1) >= wr-1
  implies 3wl >= wr); only the column check kills it -> not a deletion witness.
  Replaced by three witnesses (pre-shapes built by joins, walker-checked;
  correct gamma = 2 passes all three): W-DEL pre-shape (3, ((3,1), 4)), remove
  inside a: the gamma = 1 mutant double-rotates and leaves a (1,4) node. W-INS
  pre-shape (2, ((2,2), 2)), insert inside b: the gamma = 3 mutant
  single-rotates and leaves root 7 vs 2. W-TIE same pre-shape, remove inside a:
  the `<=` mutant single-rotates and leaves a (1,4) node.
- M-3 recursion in join: height <= H(Lmax) ~ 67 never overflows V8's stack
  (~1e4 frames) -> no stack-overflow kill exists. Kill via (a) poisoned join
  stack: after a join descending d levels, entries [0, d) must have been written
  (test-only `_` field); (b) static gate: no join / split / walker function
  calls itself.

Deep-tree test retargeted to B-7: build the worst-case tree by joins at 1:3
(ceil(w/4) | rest), assert height == H(L) exactly; stacks of size H(Lmax)-1 must
FAIL.

(M-4, the gamma rule inside join, is named in Table 2; whether M-2 / M-4 survive
is measured by DB-2, O-3.)

### Assertions

- A1 W-INS / W-DEL / W-TIE pass at gamma = 2; each mutant fails its witness.
- A2 B = 16, 10,000 appends: splits 768, hits 9231, leaves 769.
- A3 worst-case tree at L = 2^16 has height == H(2^16) = 36.
- A4 join / splitAt / seam repair 0 B/op over 1e5 cycles, maxMajor 0.
- A5 after 1e4 splitAt + append cycles the free-leaf and free-internal counts
  return to their start values.

## Evidence (S0, 2026-10-25)

Orchestrator checks, node v26.8.2, 2026-10-25, untimed:

- H(2^10) = 21, H(2^16) = 36, H(2^22) = 50, H(2^29) = 67, against
  floor(log_{4/3} L) = 24 / 38 / 53 / 69 respectively.
- A2 checked by formula AND by an append simulation with the (13 | 4) split:
  splits 768, hits 9231, leaves 769.
- M-1 at B = 4: element-count+1 weights of sibling leaves 1 and 4 = 2 vs 5 ->
  balanced (3*2 >= 5); at B = 16 leaves 4 and 16 = 5 vs 17 -> unbalanced. So the
  ROADMAP DB-2 sentence "B-1 falls out ... (sibling leaves of 1 and 4)" is wrong
  at B = 4 (it holds only at B = 16 via deeper shapes, see M-1).

TASK 0 (coder, SumSequence session, untimed): count DB-2 states at B = 4
(n <= 16) and B = 8 (n <= 24) to fix the scope. The H(L) table is done above.

## Consequences

- The SumSequence coder implements T-1..T-10 with the cold functions
  (rotations, join, split, seam repair, walker) as non-inlined, node-id-only
  functions; the hot body holds only descent, leaf shift and one pull-and-check
  pass.
- Pools and stacks are sized from Lmax = ceil(C/m) + K and H(Lmax) (replacing
  ceil(2.5 log2(L+2)) + 8); K comes from ADR 0004 (A-5, X-3).
- The finger-hit ratio becomes 12/13 (S(N) formula); ADR 0003 G-12 with s0 := m
  is identical (X-1). The ROADMAP "15 + 1" / "14 of 15" wording is superseded
  (R-X1).
- DB-2 runs at B = 4 and B = 8 (both required); a design-bug log row records
  that the ROADMAP DB-2 "1 and 4" sentence is wrong at B = 4 (X-6).
- Doc sites for the S0-U4 pass (not edited here): SCOPE D-C2, D-C6, D-C7,
  section 6 (walker line, Adams mutant); ROADMAP Y-06, 3.2, 3.4, DB-2, DB-8,
  SumSequence ASSERTIONS + HOT PATH; RESEARCH section 3 "c", I-1 (cite BFS for
  join), I-5, I-8.

## OPEN

- O-1 The BFS alpha bound and exact predicates must be transcribed from the
  paper (currently from memory).
- O-2 Is the H-Y delete lemma stated per node, or only for H-Y's whole delete
  function? (Check the Coq / Nipkow-Dirix statement.)
- O-3 Whether M-2 / M-4 survive is measured by DB-2 and recorded.
- O-4 ROADMAP HOT PATH "<= 15 leaf moves" is false: an interior split at p = 1
  writes 16 at B = 16; the SumSequence session gives exact move formulas.
- O-5 K and its default belong to ADR 0004.
- O-6 (P-4) With T-5 routing, the positional finger's insert range is
  (base, base+len], or [0, len] for the first leaf.
- X-1 (cross-ADR) -- CLOSED by R-X1 (0001 T-5 / Table 3 vs 0003 G-12 vs ROADMAP 3.4 "14 of 15"):
  0001 picks the append split (B+1-m | m) [13|4]; 0003 G-12's formula is written
  with a free s0. Setting s0 := m makes them identical (orchestrator check: both
  give 768 splits / 9231 hits for 10,000 appends at B = 16). The ROADMAP "15 + 1"
  / "14 of 15" and SCOPE D-C2 / D-C7 "~14/15" are SUPERSEDED by 12/13 if 0001 is
  ruled. Maintainer ruling (Y-06 lean moves).
- X-3 (cross-ADR) (0001 T-9 vs 0004 A-5): both size pools as ceil(C/m) + K; 0004
  adds a transient T (expected 1/1) that 0001 argues is unnecessary (covered by
  out becoming non-empty / fresh node inside Lmax). The SumSequence planner fixes
  one formula.
- X-4 (cross-ADR) (0001 T-10 H(L) == 0003 G-11 HB(L)): the same recursion
  (w <- floor(3w/4)); one name, H. Orchestrator: H(1024) = 21 in both.
- X-6 (cross-ADR; applied S0-U4) (0001 M-1): ROADMAP DB-2 "B-1 falls out in milliseconds
  (sibling leaves of 1 and 4)" is wrong at B = 4 (2 vs 5 is balanced). New
  design-bug log row (U4).
- X-7 (cross-ADR; applied S0-U4) (0001 T-10 vs RESEARCH I-8 / SCOPE D-C6): stack size H(Lmax)
  replaces ceil(2.5 * log2(L + 2)) + 8.

Cross-group coupling: ADR 0003 (hit definition), ADR 0004 (K), SumSequence P-4.
