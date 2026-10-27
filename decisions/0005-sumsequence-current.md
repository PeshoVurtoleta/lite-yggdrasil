# 0005 -- SumSequence CURRENT: the binding rules of the 0.1.0 spec closure

consolidated through ADDENDUM 12 at cdfe5d4 (the D12 commit; Yggdrasil.js 4f1a2e3a, the K-R1 tree).
Earlier fold notes (each names the HEAD the fold was written against; it landed in the next docs commit):
- ADDENDUMS 1-3: da45c50 / PLAN-G-A e2b52b3f / PLAN-G-B 03f0bf88 / DB1-plans 4f60e9a1
- ADDENDUM 4 (0005's own): folded in at 6514d58
- ADDENDUM 5 (0005's own, E0 planner pass): folded in at f5d95af
- ADDENDUM 6 (0005's own, rung 3-4 rulings): folded in at fabc0a9
- ADDENDUM 7 (0005's own, rung 4 readings): folded in at d2bf49a
- ADDENDUM 8 (0005's own, rung 5 rulings R-S1..R-S3): folded in at d2bf49a
- ADDENDUM 9 (0005's own, rung 6 ruling R-J1 and review readings): folded in at aee3c83 + rung-6 tree
- ADDENDUM 10 (0005's own, rung 7 review readings): written against cf0b700 (rung-7 tree, Yggdrasil.js 1637bf1a)
- ADDENDUM 11 (0005's own, rung 8 review readings): written against a70c6cb + rung-8 tree (Yggdrasil.js 43276f1e)
- ADDENDUM 12 (0005's own, rulings R-C1 / R-B1, G-B2 engine-lane readings and rung 9 (K-R1, cursor) readings): written
  against e4b5de5 + the K-R1 tree (Yggdrasil.js 4f1a2e3a)
- ADDENDUM 13 (0005's own, the bc unit's readings): written against cdfe5d4 + the bc tree (Yggdrasil.js 5eb49244)
- ADDENDUM 14 (0005's own, the K-R2 rung (rung 10, cursor next()) readings): written against 17ffcab + the K-R2 tree
  (Yggdrasil.js 287d10c1, test/exhaustive.mjs 6734c7aa)
- ADDENDUM 15 (0005's own, the AF unit and rulings R-A1..R-A3): written against 390ed2e + the AF tree (Yggdrasil.js
  92e67fa0)
- ADDENDUM 16 (0005's own, the AF2 unit and rulings R-A4..R-A6): written against 188c4f8 + the AF2 tree (Yggdrasil.js
  8052b70f). Re-consolidation is the docs batch's job: A13..A16 are past the ADDENDUM 12 consolidation.
- Re-consolidated at ADDENDUM 9 (A4..A9 were past the B1 consolidation): the D8 nits are folded (the A8-1 quote form,
  the C-8 guard tag, the Status and legend wrapping, long headings split into a heading + a Sources line).
- Re-consolidated at ADDENDUM 12 (A10..A12 were past the ADDENDUM 9 consolidation): every rule changed by A10-1..A10-11,
  A11-1..A11-8 and A12-1..A12-15 states its final text once; landing-history clauses became pointers.

- Status: CURRENT, consolidated through ADDENDUM 12 (not RULED). The maintainer rulings are R-D1..R-D4, R-E1..R-E5,
  R-Q1, R-P1, R-P2, R-S1..R-S3, R-J1, R-C1, R-B1, R-A1..R-A6 (quoted in "Maintainer rulings"; R-C1 and R-B1 are
  A12-14 and A12-15; R-A1..R-A3 are A15-1..A15-3; R-A4..R-A6 are A16-1..A16-3). Every other rule is a planner rule or
  a reading (NOT ruled): DB-1
  r1..r3, A4-1..A4-14, A5-1..A5-34 (incl. the merge rulings M-1..M-8), A6-3 (Q4), A7-1..A7-5, A8-4, A9-2..A9-8,
  A10-1..A10-11, A11-1..A11-8, A12-1..A12-13, A13-1..A13-5, A14-1..A14-13, A15-4..A15-9 and A16-4..A16-8.
- Date: 2026-10-26
- Session: SumSequence CURRENT consolidation (docs unit B1)
- Provenance of this text: consolidated from .handoff/PLAN-G-A.md (body, rulings, ADDENDA 1-3), .handoff/PLAN-G-B.md
  (body, ADDENDA 1-3) and .handoff/DB1-plans.md (r1, r2 incl. TOUCHES RECONCILED, r3, R-D4), and (E0 engine planner
  pass) from .handoff/PLAN-E0.md (the merge: M-1..M-8, R-E1..R-E4; its reconciliations win over the six plans) and its
  six plans PLAN-E0-A / -F / -K / -S / -V / -G. Rule ids cite those files by name (Sources legend);
  the plan files are gitignored and archived at release. The rung ladder lives in PLAN-E0.md, never here.
- Precedence: ADDENDUM 16 > ADDENDUM 15 > ADDENDUM 14 > ADDENDUM 13 > ADDENDUM 12 > ADDENDUM 11 > ADDENDUM 10 >
  ADDENDUM 9 >
  ADDENDUM 8 > ADDENDUM 7 > ADDENDUM 6 > ADDENDUM 5 > ADDENDUM 4 >
  ADDENDUM 3 > ADDENDUM 2 > ADDENDUM 1 > body. Every rule below is the FINAL rule, stated in full.
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

AskUserQuestion, 2026-10-26 (E0 burst):

- R-E1: (G D-1 + F D-F1) = "test:lanes in verify (Recommended)" -> a new `npm run test:lanes` (ENGINE-size exhaustive
  lanes and the C-34 A1 run), untimed, chained into `npm run verify`; CAPS-size lanes stay in npm test.
- R-E2: (G D-2) = "REPORTED only (Recommended)" -> torture maxPauseMs is printed with provenance and gates nothing;
  maxMajor 0 and 0 B/op are gated.
- R-E3: (K D-K1) = "valid false (Recommended)" -> a seek to the end (i = length or y >= total) and next() off the last
  element leave valid false (index -1), same as an empty view; the descent still counts touches d(t).
- R-E4: (S D-S1 + V RV-5) = "Yes, RangeError 'pool' (Recommended)" -> a cold check before the first write of splitAt
  (1 leaf) / append (1 internal), and the cold allocator, throw RangeError token 'pool'.

AskUserQuestion, 2026-10-26 (D5 burst; raised by the D5 doc review as a conflict with ruled 0001 T-7):

- R-E5: (S RS-2 vs 0001 T-7 "after join") = "Before join (RS-2)" -> append's seam repair runs on the two operands
  before the join; amends the order in 0001 T-7 (pointer row T-7 -> C-21).

AskUserQuestion, 2026-10-26 (rung 3 A-R2 burst):

- R-Q1: (ygSlots m1..m3 at dims > 1: C-44 stages them in sx, but staging in the Float64Array first would coerce before
  the typeof check) = "Inline typeof, stage sx (Recommended)" -> a fused `typeof m1..m3 !== 'number'` check under
  dims > 1, then store sx[1..3] before the cold re-check, which reads sx. Amends RV-2 / the C-10 census +1 hot branch
  (14 -> 15 at dims = 1). Lands in rung 4's coder round.
- R-P1: (the pool RangeError inside ygSplit fires after the descent wrote _fpath[0..d); C-3 says a throwing op leaves
  _fpath unchanged) = "Amend C-3 exemption (Recommended)" -> C-3 gains: the R-E4 allocator throw (unreachable under
  C-15) may leave _fpath[0..d) rewritten; _fl / _fb / _fdepth unchanged. No engine change.
  (Superseded in part by R-P2 below: the _fl / _fb / _fdepth clause.)

AskUserQuestion, 2026-10-26 (rung 4 A-R3 burst; raised by the D6 doc review):

- R-P2: (the review of D6 found that R-P1's exempted state, _fpath[0..d) rewritten with _fl / _fb / _fdepth kept, fails
  walker I-9(e) when the paths differ, and once the C-4 hit test lands a hit would run the pull pass over that stale
  path) = "Drop fl to NIL on throw (Recommended)" -> the cold R-E4 'pool' throw path sets _fl = NIL, _fb = 0,
  _fdepth = 0 before throwing (the next positional op is a miss; I-9 holds; no stale-path hit); one cold store, no hot
  cost; _fpath may stay rewritten. Supersedes the R-P1 exemption's "_fl / _fb / _fdepth unchanged".

AskUserQuestion, 2026-10-26 (rung 5 burst):

- R-S1: (clear()'s k >= 2 free-walk (0004 A-6) trusts C-8 and, on a forged / corrupt root, loops forever; should it fail
  closed?) = "Cold guard, throw Error (Recommended)". Option text: "Before any write: root ref range-checked against
  the pool bumps; the walk bounded by the pool sizes. A failure throws a plain Error('lite-yggdrasil: clear() corrupt
  view ...'), not a RangeError token (it is not an argument error). Cold path only; hot bodies unchanged."
- R-S2: (R-S1 said "Before any write: root ref range-checked ...; the walk bounded by the pool sizes." Today a
  walk-bound failure (cycle / child out of range deep in the tree) throws MID-walk, after live -= _len and some frees
  already ran. Which reading of R-S1 holds?) = "Mid-walk throw OK (Recommended)". Option text: "Only the root / _len
  checks are before any write. A mid-walk failure throws after partial frees: the view was already corrupt and the
  arena is not trusted after it. Documented in C-8 as such. No code change."
- R-S3: (The guard cannot see a ref INSIDE the bumps that names another view's node, a free node, or a node shared
  within the view; clear() then frees it (corrupting the other view). Detect it?) = "Out of scope, document
  (Recommended)". Option text: "C-8 says plainly what is NOT detected. Forged private state is beyond the guard; the
  walker (test-side) catches it. No code change."

AskUserQuestion, 2026-10-26 (rung 6 burst):

- R-J1: (join pulls; C-20 named no join rule) = "Split convention, gated (Recommended)". Option text: "Join pulls = 1
  for the fresh internal node + 1 per popped join-spine node + 2 per single / 3 per double rotation (the C-20 A6-3
  split convention); append's pulls delta = the seam repair's C-20 pulls + these; an exact test row pins it. No
  engine change."

AskUserQuestion, 2026-10-27 (D12 burst; relayed by the orchestrator session, ADDENDUM 12):

- R-C1: (C-17 / C-14; the byte cap and TASK 0(alloc)) = "Byte cap 2^32, no probe (Recommended)". Option text: "Before
  the first allocation, the constructor sums the bytes of every typed array the arena will hold. If the total exceeds
  2^32 bytes (4 GiB), it throws RangeError 'capacity'. TASK 0(alloc), the 8 GiB probe, is dropped. Deterministic on
  every host and fail-closed. Max C becomes about 72M at leafSize 16 with dims 1, and about 18M at leafSize 4 with
  dims 4. It is one cold check, done in its own small engine unit before G2."
- R-B1: (ADR 0003 O-4; a release whose bench is PENDING) = "Drop it, point back (Recommended)". Option text: "A
  release whose bench is PENDING ships no benchmark numbers. The README Benchmarks section says 'PENDING for
  <version>' and names the last release that has a measured table, without copying its numbers. This matches the suite
  law that numbers enter docs only from a run log of THIS cycle."

AskUserQuestion, 2026-10-27 (maintainer audit triage; relayed by the orchestrator session, ADDENDUM 15):

- R-A1: (F-4b, 0005 C-13) = "Amend C-13: b = dims (Recommended)". Option text: "C-13's big-lane bound for insertAt
  becomes b = dims (<= 16*dims + 1 B/op), stated as a documented limit in README / llms.txt. No engine change. G2's big
  lane gates the amended bound."
- R-A2: (F-3) = "Record, no change (Recommended)". Option text: "A one-time re-tiering deopt on a dims change, recorded
  as a reading in 0005. R-Q1's single fused branch and the dims = 1 hot-branch census (15) stay as ruled. No engine
  change."
- R-A3: (F-7) = "No action (Recommended)". Option text: "'Cold' in C-25 means a separate source function, not a
  promise that V8 won't inline it. The finding is recorded as a REPORTED observation; nothing is gated and nothing
  changes."

AskUserQuestion, 2026-10-27 (maintainer audit #2 triage; relayed by the orchestrator session, ADDENDUM 16):

- R-A4: (pass 2 F4, 0005 C-3) = "Amend C-3 (Recommended)". Option text: "C-3's R-E4 'pool' exemption also covers the
  cursor: the throw may leave cursor() invalid (_cv = false), the fail-safe outcome, like the finger. No engine change."
- R-A5: (CL-2, 0005 C-24) = "Lock the binding (Recommended)". Option text: "After the class body, define
  SumSequence.COUNTERS as writable: false, configurable: false (cold, module load only). A row asserts the descriptor.
  C-24 gains 'read-only binding'."
- R-A6: (pass 2 F1a, 0005 C-8) = "Document as not detected (Recommended)". Option text: "C-8's not-detected list
  gains: a forged _len inside [0, live] on a valid root is beyond the guard (R-S3 class). clear() stays O(1) when the
  view holds every live element."

## Sources legend

- 0005 A16-1..A16-8 = this file's own ADDENDUM 16 (below; the audit #2 fix unit AF2: A16-1..A16-3 are the rulings
  R-A4..R-A6, quoted above; A16-4..A16-8 are readings of the AF2 unit, NOT ruled). Every A16 item names the CURRENT
  rules it changed and every changed rule cites its A16 ids.
- 0005 A15-1..A15-9 = this file's own ADDENDUM 15 (below; the maintainer-audit fix unit AF: A15-1..A15-3 are the rulings
  R-A1..R-A3, quoted above; A15-4..A15-9 are readings of the AF unit, NOT ruled). Every A15 item names the CURRENT rules
  it changed and every changed rule cites its A15 ids.
- 0005 A14-1..A14-13 = this file's own ADDENDUM 14 (below; the K-R2 rung (rung 10, cursor next()) readings, NOT ruled;
  no maintainer ruling was given in K-R2). Every A14 item names the CURRENT rules it changed and every changed rule
  cites its A14 ids.
- 0005 A13-1..A13-5 = this file's own ADDENDUM 13 (below; the R-C1 byte-cap unit bc: readings, NOT ruled; no new
  ruling, R-C1 is quoted above). Every A13 item names the CURRENT rules it changed and every changed rule cites its A13
  ids.
- 0005 A12-1..A12-15 = this file's own ADDENDUM 12 (below; G-B2 engine-lane readings and rung-9 (K-R1, cursor)
  readings A12-1..A12-13, NOT ruled, plus the two rulings A12-14 = R-C1 and A12-15 = R-B1, quoted above; the
  re-consolidation note is in the intro, unnumbered, with no source row). Every A12 item names the CURRENT rules it
  changed and every changed rule cites its A12 ids.
- 0005 A11-1..A11-8 = this file's own ADDENDUM 11 (below; rung-8 review readings, NOT ruled; tags R8-n). Every A11
  item names the CURRENT rules it changed and every changed rule cites its A11 ids.
- 0005 A10-1..A10-11 = this file's own ADDENDUM 10 (below; rung-7 review readings, NOT ruled; tags RD-n, S3-n, H3).
  Every A10 item names the CURRENT rules it changed and every changed rule cites its A10 ids.
- 0005 A9-1..A9-8 = this file's own ADDENDUM 9 (below; the ruling R-J1, quoted above, and the rung-6 review readings
  A9-2..A9-8, NOT ruled). Every A9 item names the CURRENT rules it changed and every changed rule cites its A9 ids.
- 0005 A8-1..A8-4 = this file's own ADDENDUM 8 (below; the rulings R-S1..R-S3, quoted above). Every A8 item names the
  CURRENT rules it changed and every changed rule cites its A8 ids.
- 0005 A7-1..A7-5 = this file's own ADDENDUM 7 (below; orchestrator / reviewer readings from rung 4, no ruling).
  Every A7 item names the CURRENT rules it changed and every changed rule cites its A7 ids.
- 0005 A6-1..A6-4 = this file's own ADDENDUM 6 (below; the rulings R-Q1, R-P1 and R-P2 and the r3 review reading Q4).
  Every A6 item names the CURRENT rules it changed and every changed rule cites its A6 ids.
- 0005 A5-1..A5-34 = this file's own ADDENDUM 5 (below; the E0 engine planner pass). Every A5 item names its source and
  the CURRENT rules it changed, and every changed rule cites its A5 ids.
- E0 = PLAN-E0 (M-1..M-8 are ORCHESTRATOR merge rulings, not maintainer rulings; R-E1..R-E5 are the maintainer rulings
  above) + PLAN-E0-A RA-1..RA-6 (core), PLAN-E0-F RF-1..RF-3 (finger), PLAN-E0-K RK-1..RK-6 (cursor), PLAN-E0-S
  RS-1..RS-8 (splitAt / append), PLAN-E0-V RV-1..RV-8 (validation / caps), PLAN-E0-G "G R-1".."G R-5" (engine gates;
  prefixed so they do not collide with R-D / R-E). The decision ids G D-1, G D-2, F D-F1, K D-K1, S D-S1 became
  R-E1..R-E4.
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

### C-1 Finger state (G-A F-1 -> G-B-D3 -> G-B B2-2 -> 0005 A5-11)

- A view's finger is (fl, fb, depth, path): the leaf, the index of its first element, the descent depth, and a path
  stack Int32Array(H(Lmax)) owned by the VIEW (path[k] = node at depth k). Field names: _fl, _fb, _fdepth, _fpath.
- This amends 0004 A-5 "one set per arena" for the finger path only: the join and split stacks stay one set per
  arena (no op re-enters); the finger path stack costs k * H(Lmax) * 4 B for k views (nominal).
- A view that is empty has _fl === NIL. NIL = 0 is legal for _fl only (leaf refs are < 0 by I-7); the engine
  planner fixed the value: NIL = 0 (RA-2, A5-11); the harness still reads it from a fresh view (C-27).

### C-2 Only the positional path uses the finger; the finger caches no sum (G-A F-2)

- Only insertAt, removeAt, setMeasure, getMeasure and entityAt read or write the finger. sumBefore, indexAtSum,
  total and the whole cursor never read or write it: a seek is one descent from the root, never the finger.
  The finger stores positions (leaf, first index, depth, path) and nothing summed: it caches no prefix sum.
- ROADMAP wording "indexAtSum / sumBefore ... (or a finger hit)" is therefore false; seeks are "one descent".

### C-3 Re-home after every positional op
Sources: G-A F-3 -> G-A-D11 -> 0005 A5-5, A5-16 -> 0005 A6-2 -> A6-4 -> 0005 A7-4 -> 0005 A9-3 ->
  0005 A10-2 -> 0005 A11-1 -> 0005 A16-1

- Every positional op re-homes the finger after its last write, reads included (their descent writes the path).
  Non-structural op: fl / fb := the leaf the op touched. Structural op (split, merge, equalize, first-leaf
  creation): a cold descent to i re-homes (removeAt uses min(i, length-1)). A view emptied by the op: fl := NIL.
- Hit test (M-1, A5-5, A11-1; landed in rung F-R): the core writes the finger (re-home + NIL, C-43) and reads it for the
  hit test (C-4); a hit leaves _fl, _fb, _fdepth and _fpath equal by value (the same ref, at - k, depth).
- A throwing op re-homes nothing: a RangeError (for setMeasure the headroom one, RF-1, C-10) leaves _fl, _fb, _fdepth
  and _fpath unchanged. One exemption (R-P1, R-P2, A6-2, A6-4): the R-E4 'pool' throw (the cold allocator / ygSplit;
  unreachable under C-15) leaves the finger invalidated (_fl = NIL, _fb = 0, _fdepth = 0, set before the throw, so the
  next positional op is a miss and I-9 holds) and may leave _fpath[0..d) rewritten by the descent. The exemption also
  covers the cursor (R-A4, A16-1, RULED): the
  same 'pool' throw may leave cursor() invalid (_cv = false: valid false, index -1, entity -1, offset / measure NaN),
  the fail-safe outcome, like the finger; no engine change. Every other throw
  changes nothing. The splitAt / append 'pool' pre-checks fire before any write and change nothing (A7-4). "Nothing"
  covers the C-27 snapshot and the counters: splitAt's pre-check is decided after a descent that writes nothing but the
  arena scratch sstack (A10-2; not in the snapshot, never read before written).
- Append pre-check (A9-3): its test is (both operands non-empty) and (internal free list empty) and (internal bump
  exhausted). It is decided on the operands, before the seam repair, so with both operands non-empty and a full internal
  pool it throws even when the seam merge would make the join the identity (no fresh node would then be allocated).
- Standing gate: A1 (C-34). Mutants MF-2 and MF-4 (C-35) are the teeth.
- The keyed-fence variant (B-17 part c: a stale fence after equalize, I-6) is DEFERRED to the SumMap brief
  (C-42); the carried rule is this structural re-home plus a keyed copy of MF-4.

### C-4 Hit (G-A HIT-1 -> G-A-D7 lo formula -> 0005 A5-17 -> 0005 A11-1..A11-3)

- Hit iff fl !== NIL and the index lies in the leaf's range and no split, merge, equalize or free is needed, decided
  before the first write. Range: insertAt i in (fb, fb+len] and, for the first leaf (fb = 0), [0, len]; every other
  positional op i in [fb, fb+len). The insert test is branchless: lo = fb - ((fb-1)>>>31); hit iff lo < i and
  i <= fb+len (fb = 0 gives lo = -1; fb >= 1 gives lo = fb).
- removeAt (RF-2, A5-17): "no free is needed" means no underflow and no emptied view: removeAt hits iff fb <= i <
  fb+len and len > (_fdepth === 0 ? 1 : m) (_fdepth === 0 detects a single-leaf view; the stub reads
  `L === 1 ? len > 1 : len > m`).
- A hit adds 0 to touches. The split-triggering insert is a MISS. This replaces 0003 G-12 "in range + epoch valid +
  no split / merge / equalize needed" and the 0001 Table 3 hit wording.
- Hit test wiring (A11-1; landed in rung F-R): insertAt, removeAt, setMeasure, getMeasure and entityAt run the hit test
  after every C-10 check and before the first write, NIL tested first. A hit skips the descent, adds 0 to touches, adds
  _fdepth to pulls on a mutation and rewrites the finger with the same values (ref === _fl, at - k === _fb, depth ===
  _fdepth). Structural work (first leaf, split, T-6) is on the miss branch only. The tail adds `touches += depth & (h -
  1)` and 1 to slot `YG_MISSES - h` (h = 1 on a hit). removeAt at n === 1 drains before the test and counts a miss.
- NIL guard is textual (A11-2, R8-1): dropping `ref !== YG_NIL &&` (5 sites) is behaviorally EQUIVALENT: llen[~0] =
  llen[-1] is undefined on an Int32Array, fb + undefined is NaN, so the upper-bound compare (at <= fb + len / at < fb +
  len) is false and the op misses (removeAt's `_fdepth === 0 ? 1 : m` term is never evaluated). The guard stays: it is
  the C-4 text, the C-10 census "NIL" term, and it keeps the hot site free of an out-of-bounds typed-array load. Its
  only gate is textual: test/Finger.test.mjs pins it as an equivalent-mutant row whose identity build asserts anchor
  count 5.
- removeAt threshold (A11-3, reviewer mutant R6): `_fdepth === 0 ? 1` is equivalent to `? 0`, because the n === 1 drain
  runs before the test, so on a single-leaf view len === n >= 2 at the test. The rule text keeps `? 1` (it matches the
  stub).

### C-5 Ownership and NIL writes (G-A B-18 -> G-B XG-1 -> 0005 A11-5)

- Invariant: fl !== NIL implies the leaf is live and owned by THIS view (not free, not another view's).
- splitAt (both views), append (both views) and clear set the finger NIL. Draining the last element of a view sets
  NIL (C-3). A moved-from view therefore never walks foreign nodes.
- Empty view (A11-5): insertAt's empty-root (ygFirstLeaf) check sits on the miss branch. An empty view always has fl ===
  NIL (born NIL; drain, splitAt with either side empty, append's source and clear write NIL; the 'pool' throw writes NIL
  / 0 / 0), so the NIL test sends it to the miss branch; walker I-9a checks it after every op.

### Cursor

### C-6 No epoch counter; the cursor bit _cv
Sources: G-A B-18 -> G-A-D3 -> G-A A2-4 -> G-A A3-4 -> 0005 A5-3, A5-22 -> 0005 A12-7, A12-8, A12-10 ->
  0005 A14-1, A14-4, A14-5, A14-13 -> 0005 A16-1

- No epoch counter exists. The finger is never stale (C-3), so the only invalidation state is the view's one cursor
  (Y-11). Its `valid`, `index` and `entity` are prototype getters over view state; `valid` returns the boolean _cv.
- Every successful mutator stores `_cv = false` once per view it invalidates, AFTER validation: `this._cv` for
  insertAt, removeAt, setMeasure, splitAt, append, clear; append also `other._cv = false` (A3-4).
  splitAt's `out` must be empty (0004 A-3) so its cursor is never valid. A RangeError
  mutation and every read op leave _cv and the cursor fields unchanged, except the R-E4 'pool' throw, which may leave
  _cv false (C-3, R-A4, A16-1).
- A seek (seekIndex / seekSum) sets _cv = true, except a seek to the end (i = length, or y >= total) and a seek on an
  empty view, which leave _cv false (R-E3, RK-1); next() off the last element sets _cv = false (R-E3). While _cv is
  false: index and entity read -1, offset(d) and measure(d) are NaN. After `a.append(b)`, b's cursor valid === false
  (0004 assertion 5 unchanged).
- Only _cv is cursor state on the view (RK-5, A5-22): the C-27 snapshot is unchanged; the cursor's leaf, position,
  stack and running offsets live in its own preallocated state, and the cursor class is not exported.
- Landing (A12-7; C-7, C-43): rung K-R1 landed the `_cv = false` store of all six mutators (append's other and splitAt's
  out included), the cursor, the getters and the seeks; rung K-R2 landed next() and the stack writes (A14-13).
- The view's one extra own field (A12-8, K1-R1, reviewer ACCEPT): `_cur`, the cursor object reference, set once in the
  constructor after `_cv` and never reassigned. A reference is not cursor state: the C-27 snapshot and the walker's
  WK_VIEW_FIELDS are unchanged, and single and arena views share one hidden class (%HaveSameMap).
- An end seek partly rewrites the cursor's running offsets while _cv stays false (A12-10, K1-R4 / K1-R5, reviewer
  ACCEPT); never observable, offset(d) is NaN while invalid. The state slot [0] holds the leaf id (not ~id). The
  Int32Array(HL) stack is allocated in K-R1 and written by the seeks and next() since K-R2 (shape stable across
  rungs; A14-1).
- Stack and leaf length (A14-1, K2-R1, reviewer ACCEPT): each seek stores every internal node of its descent in
  _stk[depth] before descending (the d(t) stores, trailing `// cr:push`); state slot 2 (YG_CLEN renamed YG_CDEP) holds
  the leaf's stack depth; next() reads the leaf length from v._llen[leaf], valid because every mutator clears _cv
  first (the 8 `// cv:` stores). Shape and ygBytes are unchanged (A12-10). Hot cost: one property load plus one
  Int32Array read in next(); one Int32Array store per level in each seek.
- Running offset at the end (A14-4, K2-R4, reviewer ACCEPT): next() carries _off before the end check, so off the last
  element _off holds the total while _cv is false; unobservable (offset() is NaN while invalid), the same class as
  A12-10.
- Empty-view seek store (A14-5, K2-O1, reviewer ACCEPT): the `_cv = false` stores in both seeks on an empty view are
  kept: cold, equivalent today (an empty view's _cv is always false), fail closed.
- Amends 0004 A-1 / A-6 / A-7 (epoch per view; "bump"), 0003 G-4 (the engine-read field is _cv, a separate field
  from the never-read `_n`), 0002 M-5 ("finger or epoch" -> "finger or _cv").

### C-7 Cursor API (G-A B-24 -> 0005 A5-3, A5-19, A5-20, A5-21 -> 0005 A12-7, A12-9, A12-10, A12-11 -> 0005 A14-1,
  A14-2, A14-3, A14-13)

- view.cursor() returns the view's ONE cursor: seekIndex(i), seekSum(d, y), next(); fields valid, index, entity;
  methods offset(d), measure(d). Invalid state as C-6. The cursor has its own stack and allocates nothing.
- Returns (RK-2, A5-19): seekIndex, seekSum and next() return a boolean = the cursor's valid after the call; next() on
  an invalid cursor does nothing and returns false.
- End state (R-E3, A5-3): a seek to the end (i = length or y >= total) and next() off the last element leave valid
  false (index -1), same as an empty view; the seek descent still counts touches d(t) (C-25). A walk is therefore
  `while (c.valid ...)` over a seek to a start index.
- Validation (RK-3, A5-20; C-10): seekIndex(i) takes i in [0, length], token 'index'; seekSum(d, y) checks the dim,
  then y per 0002 M-8 (tokens 'dim', 'seek'); a throwing seek leaves the cursor unchanged.
- Cost (RK-4, A5-21): offset(d) is O(1), read from the cursor's running Float64Array of offsets; offset(d) and
  measure(d) each return a boxed double (b = 1, C-13).
- Landed in rung K-R1 (A12-7; C-6, C-43): cursor(), the valid / index / entity getters, offset(d) / measure(d),
  seekIndex and seekSum. Landed in rung K-R2 (A14-13): next() (the leaf walk and _cross, the leaf crossing) and the
  stack writes of the seeks (A14-1).
- Crossing (A14-3, K2-R3, reviewer ACCEPT; C-25): _cross's lca test is `left[u] === child` (child starts as ~leaf, then
  the popped node); a crossing adds depth - top touches, top = depth(lca) + 1, so d(t') - depth(lca) - 1 (trailing
  `// cr:pop`). The end crossing (off the last element) pushes nothing and adds 0 (A14-2); _cross sets _cv false and
  returns false (`// cr:end`).
- seekSum's text (A12-9, K1-R2 / K1-R3, reviewer ACCEPT): the indexAtSum rule is written `if (acc + sl > y) {` and
  `if (y < acc + m) break;` (equivalent, NaN and -0 included) so Core.test's indexAtSum source anchors stay unique;
  future seekSum anchors use this text. Its end test is the in-leaf scan reaching j === len, equal to y >= total(d)
  because sums are exact integers <= 2^53 - 1 (reviewer scratch k3, log .handoff/evidence/k1/review/k3.log, live
  Yggdrasil.js 4f1a2e3a: 30,960 calls, 2,214 end seeks, 0 mismatches).
- Zeros (A12-11, H1 readings, reviewer ACCEPT; C-10): -0 for d or y acts as 0; seekIndex(-0) on an empty view is the
  end (false), not a throw; seekSum never lands on a zero-measure element (strict >, 0002 M-8 / M-7 as 0005 cites it).
- Closes RESEARCH Q-3. A cursor walk gives O(log n + k) reads at 0 B (this is why readRange is not in v0.1, C-12).

### C-8 clear() restores the constructed state, `_n` excepted
Sources: G-A B-18 -> DB1 P-09 -> G-B B3-1 -> 0005 A5-11, A5-13 -> 0005 A8-1..A8-4 -> 0005 A15-4 -> 0005 A16-3

- clear() restores the view to its constructed state exactly: _len 0, _root === EMPTY_ROOT, _fl NIL, _cv false,
  header bump 0 and live 0 once every view has cleared. The diagnostic counters `_n` are EXCLUDED (0003 G-8, X-8:
  clear() keeps counters); this is not XD-1.
- EMPTY_ROOT is the _root read from a fresh empty view; the harness asserts EMPTY_ROOT !== 0 (an empty view's _root
  must not equal internal id 0). The walker asserts (_len === 0) === (_root === EMPTY_ROOT) on every view after
  every op.
- Engine values (RA-2, A5-11): EMPTY_ROOT = 0x3FFFFFFF (a Smi under pointer compression, above any internal id since
  Lmax - 1 < 2^28 by C-14, not a leaf ref, not 0); NIL = 0 (C-1). The harness still reads both from a fresh view; the
  stub default 0x7fffffff is not a 31-bit Smi and stays harmless.
- Drain (RA-4, A5-13): a removeAt that takes the arena to live 0 resets both pools to construction order exactly as
  clear() does (0004 A-6 states the reset only for clear(); the stubs reset on every transition to live 0). With
  k >= 2 views, live 0 means every view is empty.
- Corrupt-view guard (R-S1, R-S2, R-S3, A8-1..A8-4, A15-4): clear() runs one cold pre-check, ygClearCheck, BEFORE BOTH
  branches (the _len === live ygReset fast path and the k >= 2 free-walk, 0004 A-6), so before any write: _len is a
  number, an integer, 0 <= _len <= live (NaN, negatives, fractions, non-numbers fail); _root is a number and an int32
  (`(root | 0) === root`, no coercion: null, false, '', '0.5', '-1', -Infinity, -2^32 fail); (_len === 0) === (_root ===
  EMPTY_ROOT); a non-empty root is range-checked against the bumps (leaf ref ~root < leaf bump; internal 0 <= root <
  internal bump; EMPTY_ROOT with _len > 0 fails). The k >= 2 walk then range-checks every child ref and bounds the walk
  by the bumps. A failure throws a plain Error whose message starts 'lite-yggdrasil: clear() corrupt view: ' (not a
  RangeError, no C-10 token), with hdr and every column unchanged for a pre-check failure. Detail texts: `_len X is not
  an integer >= 0`, `_len N > live L`, `root ref X is not an int32`, `root ref R with _len 0`, `root ref R out of
  range`. Cold path only; hot bodies unchanged.
- Mid-walk failure (R-S2): only the root / _len checks run before any write; a mid-walk failure throws AFTER live -=
  _len and the frees already made (the view keeps _root / _len); the arena is not trusted after it.
- Not detected (R-S3, A15-4, A16-3): a ref inside the bumps that names another view's node, a free node or a node
  shared inside
  the view (the walk frees it); the test-side walker catches these. The two audit shapes (F-1e) stay out of scope:
  duplicate leaf children of one internal (left === right, a leaf freed twice, which makes a free-list self-loop) is
  in this class, not detected (R-S3); an internal child equal to its parent (u's own ref as a child) is caught
  mid-walk by the walk bound ('more than N internals') after live -= _len and the frees already made, leaving u on the
  internal free list (R-S2). A forged _len inside [0, live] on a valid root is also beyond the guard (R-A6, A16-3,
  RULED; R-S3 class): the pre-check cannot tell it from a true count. clear() stays O(1) when the view holds every
  live element (_len === live, the ygReset fast path); that fast path is correct when the view truly holds every live
  element (pass 2 F1c is not a defect, A16-3).

### Entity, signatures, options

### C-9 Entity domain and E rows (G-A B-22 -> G-A D-3 = R-D3)

- Entity domain is [0, 2^30-1] (R-D3). The check is `typeof e === 'number' && (e & 0x3FFFFFFF) === e`; -0 is stored
  as 0. A bad entity is a RangeError before any write, with 0 valueOf calls.
- DB-7 rows (U = RangeError, snapshot unchanged): E-1 0 ok; E-2 -0 ok, Object.is(entityAt(i), 0); E-3 2^30-1 ok;
  E-4 2^30, 2^31, 2^32 -> U; E-5 -1 -> U; E-6 1.5, NaN, +-Infinity -> U; E-7 '5', null, undefined, true, 5n,
  new Number(5), a valueOf spy -> U with 0 spy calls.
- Replaces any int32-range guard (RESEARCH :306-308 becomes `(e & 0x3FFFFFFF) === e`, [0, 2^30-1]).
- Amends 0002 M-5 (entity added to the check set). The cursor sentinel -1 cannot collide with an entity.

### C-10 Check order
Sources: G-A B-22 -> B-24 -> G-A-D7 -> G-A A2-2 -> 0005 A4-9, A5-4, A5-7, A5-16, A5-20, A5-26, A5-30 -> 0005 A6-1 ->
  0005 A7-3 -> 0005 A8-1 -> 0005 A9-3 -> 0005 A10-2, A10-5 -> 0005 A12-11 -> 0005 A15-2, A15-7 -> 0005 A16-6

- Check order, all before the first write: i, e, measures (M-3 each, slots < dims), extra slots, capacity, headroom.
  The capacity RangeError message carries the token 'capacity' and is checked between extra slots and headroom.
- Measure checks (R-Q1, A7-3): at dims > 1 insertAt checks slot 0 in full first, then runs the typeof of EVERY slot
  1..dims-1 before any range / integer check of those slots (m1 = -1 with m2 = '5' reports "must be a number"; m0 = -1
  with m1 = '5' reports the range error), token 'measure'.
- One exception to R-X5 "RangeError everywhere" (ADR 0002 / 0004 ruling; narrowed by the later ruling R-S1, A8-1):
  the corrupt-view guard of clear() throws a plain Error, not a RangeError and not a C-10 token (C-8; it is not an
  argument error).
- M-3 (A5-7): no op exists without its checks. Each op's C-10 checks ride the rung that adds the op (C-43); an op added
  without them is REJECTED at review.
- setMeasure (RF-1, A5-16; wins over the V-R3 form `m > MAX - (t - m_old)`): checks i, dim, m, then headroom as the
  last check before the first write. The hot test is `m <= MAX - total(d)` with no locate; only when it fails does a
  cold READ-ONLY descent (no _fpath / _fdepth / _fl / _fb write) fetch the old value and decide. A headroom
  RangeError therefore leaves the finger as it was (a row: the finger in the other root subtree stays put).
- Tokens (R-E4, A5-4): the cold allocator, and a cold check before the first write of splitAt (1 leaf) and append (1
  internal), throw RangeError with the token 'pool'; under C-15 it never fires (0004 A-5's only capacity failure stays
  live + 1 > C). RV-5's proposed Error('pool') is superseded by R-E4 (consistent with R-X5 "RangeError everywhere"). The
  append check is evaluated whenever both operands are non-empty, whatever the seam repair then does (A9-3; C-3).
  splitAt's pre-check: see C-3 (A10-2).
- Dims 1..3 (RV-2, A5-30, R-Q1, A6-1): the extra-slot and headroom branches carry `| (dims > 1)` and send dims > 1 to
  one cold re-check. R-Q1 adds one hot branch, the dims > 1 test guarding the fused inline typeof of slots 1..dims-1
  (C-44), so the dims=1 census below is 15 (RV-2's 14 is superseded). No hot-branch census gate exists (the 0003 G-6
  counter census is gated, C-24): the reviewer counts, backed by a bytecode golden of the hot functions. R-A2 (A15-2,
  RULED) keeps R-Q1's single fused branch and the census of 15 as ruled; the one-time re-tiering deopt on a dims change
  (F-3) is a recorded reading, no engine change.
- Guard form (A15-7, lite-law: NaN fails closed by construction): the headroom guards (insertAt, ygHeadroomIns,
  setMeasure, ygSetHeadroom, append), the C cap, clear()'s _len check, and the dims and count guards are written
  `!(x <= bound)`, never `x > bound` (same throw text). readCounters' `!(out.length >= YG_NC)` (A16-6, AF2-3) is the
  same form for a lower bound: a forged NaN or undefined length throws RangeError 'counters' (same token and text).
  The hot index / dim guards `((x >>> 0) !== x) | (x > n)`
  stay: they are NaN-safe by the uint32 term.
- Operand check (RS-6, A5-26): a private `#` brand, then `_hdr` identity (0004 A-3's _hdr check alone passes a forged
  object). Order: not a view, self, another arena, non-empty out; then (append only) headroom. Index before operand
  stays as below. A non-empty out throws the message 'operand out must be empty' (token 'operand', detail 'out must be
  empty'; A10-5).
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
- Cursor zeros: see C-7 (A12-11): -0 for a seek's d or y acts as 0, and seekIndex(-0) on an empty view is the end
  (false), not a throw.
- Branch census of an insertAt hit at dims=1 is 15 (R-Q1, A6-1): i 2, entity 2, m0 3, extra-slot 1, dims > 1 typeof
  guard 1, capacity 1, headroom 1, finger 3 (NIL, lo, hi), structural 1.

### C-11 Options (G-A B-21 -> G-A-D9 -> G-B-D3 -> 0005 A5-31)

- options is undefined or a PLAIN object (prototype Object.prototype or null). Only own string data keys in
  {dims, leafSize} are legal; RangeError for present-but-undefined, accessor, symbol key and unknown key (the message
  names the nearest key, "did you mean 'dims'?", built cold); no getter is ever called.
- leafSize in {4, 8, 16, 32}, default 16: typeof check first, else RangeError; stored as a shift; the .d.ts marks 4
  and 8 test-only. There is NO finger option; the harness factory is make({leafSize, dims}) and "finger off" is
  C-27.
- Rows (RangeError): [], null, Object.create({dims:5}), {dim:2} (message contains 'dims'), {dims:undefined},
  {[Symbol()]:1}, an accessor spy (0 calls). Object.create(null) with dims 2 is ok.
- Readings (A5-31): the values come from the own data descriptor (RV-3: Object.prototype.dims = 3 leaves dims 1); the
  nearest key is by Levenshtein distance, a tie goes to 'dims', and the user's key is never echoed in the message
  (RV-4); a Proxy as options runs its traps, which is user code: a documented limit, outside "no getter is ever
  called" (RV-8).

### C-12 Signatures, closed open items (G-A B-24 -> G-A XG-3 -> 0005 A4-9)

- getMeasure(i, d) -> number; entityAt(i) -> entity; removeAt(i) -> entity; sumBefore(d, i) -> number (dim first, then
  the index); total(d) stays, O(1); cursor() per C-7.
- Closes 0002 O-4 (getMeasure). 0004 O-2 (moveRange): closed, not needed (spike (e)). XG-3 readRange: not in
  v0.1 (the cursor gives O(log n + k) at 0 B); owner Tier 2. 0004 O-3 (parent column, entity -> index): not carried
  into v0.1 (it needs an entity-slot write on every leaf move, which is hot); owner = the v0.4 pool planner.

### C-13 Zero-box lanes (G-A-D8 -> G-A A2-3 -> 0005 A5-19, A5-27 -> 0005 A12-13 -> 0005 A15-1, A15-9 ->
  0005 A16-4, A16-5, A16-8)

- 0002 O-1 outcome = a documented limit; no io-slot API. Smi lane: 0 B/op. Big lane (measures and y beyond 2^30):
  measures drawn in [2^30, 2^40] with live <= 4096 (4096 * 2^40 = 2^52, never a headroom RangeError), y drawn in
  [2^30, total); the steady-state MINIMUM bytes/op over windows 1..n-1 (window 0 is printed, never gated) must be
  <= 16*b + 1 with maxMajor 0.
- b = boxed boundary values per call: 1 for setMeasure, getMeasure, sumBefore, total, indexAtSum, seekSum, cursor
  offset(d) and measure(d); 0 for removeAt, entityAt, next, seekIndex (RK-2), splitAt and append (RS-7).
- insertAt (R-A1, A15-1, RULED): b = dims, so the big-lane bound for insertAt is <= 16*dims + 1 B/op (dims 1..4), a
  documented limit in README / llms.txt (docs batch). No engine change. G2's big lane gates the amended bound; at
  dims = 1 it equals the old bound.
- Must-fail: a descent that returns acc across a %NeverOptimizeFunction helper shows > 16*b + 1. Doc sites: README
  Zero-GC notes and llms.txt state the limit, insertAt's as b = dims (R-A1).
- Bytecode (A15-9, REPORTED, node v26.8.2): getMeasure 443 (287d10c1) -> 464 (92e67fa0) bytes, over V8's default
  460-byte inline limit. Not a spec violation (b = 1 above, the Smi lane returns a Smi, 0003 G-7 holds); a G2 input
  (superseded by A16-4: 455 B at 8052b70f).
- Bytecode after AF2 (A16-4, REPORTED, node v26.8.2): getMeasure hoists the misses slot (`const j = YG_MISSES - h;
  cn[j] = (cn[j] + 1) | 0;`, still the 0003 G-5 form) and is 455 bytes (464 -> 455; 5 B under the 460 limit); entityAt
  400, indexAtSum 420, sumBefore 422 unchanged. Pinned < 460 in npm test (fails on 92e67fa0, A16-8;
  test/AuditFixes2.test.mjs: child process with
  a timeout, fail closed). The cursor offset(d) / measure(d) invalid branch returns `0 / 0` instead of the global NaN
  (A16-5; results unchanged, NaN while invalid). Re-measure (REPORTED, audit/2026-10-27/claude/alloc-tight.mjs, 16 MB
  semi-space (the probe's usage line), steady-state min B/op, 3 interleaved runs per op, 92e67fa0 -> 8052b70f,
  2026-10-27T07:01:20Z-07:01:23Z, node
  v26.8.2, QUIET load1 2.17 vs baseline 2.21, 12 cores, no other node >= 10% CPU, 24 runs): getMeasure 16 -> 0, cursor
  measure 16 -> 0, cursor offset 0 -> 0, total 0 -> 0. The 0 B/op claim is G2 B4's torture lane (big.getMeasure,
  big.offset, big.measure at 0 B/op; the bound stays 16*b + 1, b = 1), not gated at 0 yet.
- Cursor probe (A12-13, reviewer scratch; PRELIMINARY: host load 3.2-4.6, --trace-gc scavenge counts, 2^21 ops, 1 MB
  semi-space, node v26.8.2, 2026-10-27): seekIndex with measures in [2^30, 2^40] gave 0 scavenges; the getters 0;
  seekSum with a big fractional y 32 (about 16 B/op = the one boxed y, b = 1); with a small y 0. Not a gate (the gate is
  G2 torture, C-38). Re-run by the D12 reviewer (.handoff/evidence/d12/review/run13.log: probe2.mjs big lanes 0 / 32 /
  0, probe3.mjs small lanes 0; node v26.8.2, load1 1.3); .handoff/evidence/k1/alloc-iso.log (k1-alloc-iso.mjs) shows 0
  scavenges per 2e6 for empty, seekIndex, seekSum, getters, offset, not the 32.

### Capacity

### C-14 Caps (G-A B-28 -> G-A-D5 -> G-A A2-5 -> 0005 A5-6, A5-29, A5-32 -> 0005 A12-14 -> 0005 A13-1..A13-5
  -> 0005 A14-6)

- Slot ids stay Smi: Lmax*B <= 2^30, so C <= 2^28 - m*k (B=4: 2^28-k, B=8: 2^28-2k, B=16: 2^28-4k, B=32: 2^28-8k). C is
  an integer >= 1. MAX_VIEWS = 4096: count is an integer in [1, min(C, 4096)]. dims is an integer in 1..4. leafSize per
  C-11; unknown option keys are a RangeError. Every check is integer arithmetic done BEFORE the first allocation. The
  caps are documented, not exported. Brute force over B 4..32, k in {1, 3, 6, 4096}: cap -> 2^30 slots, cap+1 -> 2^30+4m
  (node v26.8.2, untimed, 2026-10-26); at the cap one Float64 column is 8 GiB (rejected by the byte cap, A13-3).
- A3 rows (RangeError, arrayBuffers delta < 1 MiB): count 4097; count 4 at C=3; C = 2^28 - m + 1 at k=1 for each B;
  C=2^30; dims 0 and 5; leafSize 12. Exception with teeth: the count-4097 row runs at C = 2^20 (an unchecked build
  allocates >= 32 MiB there; the column is 32.1-33.0 MiB for B 4..32) and its must-fail is a validate-after-allocate
  mutant on that row only, arrayBuffers delta >= 1 MiB. No other row claims an allocation mutant. At-cap is never
  built in npm test.
- Order (RV-1, A5-29; the synthStub order): C -> options -> leafSize -> dims -> count -> the C cap (2^28 - m*k), then
  the byte cap, last (both need m and k); every step is before the first allocation. One init serves both constructor
  paths (M-2, A5-6, C-43).
- Byte cap (R-C1, A12-14, RULED: the sum and the 2^32 cap; implemented in unit bc, A13-1..A13-4, readings NOT ruled):
  the constructor sums the bytes of every typed array the arena will hold with ygBytes(C, B, k, dims) (the formula is
  A13-1); a total > 2^32 bytes throws RangeError 'capacity', message 'arena typed arrays must total <= 2^32 bytes'. The
  comparison is strict: exactly 2^32 bytes is accepted (A13-2). Its text is `if (!(ygBytes(C, B, k, dims) <=
  YG_BYTE_CAP)) ygFail('capacity', ...)` (A14-6, amends A13-2's wording): exactly 2^32 is still accepted and a NaN
  total throws (fail closed by construction). The check is one line after the unchanged C cap line and
  BEFORE the allocation marker (Yggdrasil.js "allocation: no check below this line"). Plain JS containers (the meas /
  lsum / sums column arrays, views[], the view objects) are not counted. The byte cap rejects C = 2^28 - m*k for every
  legal (B, dims, count), so the C cap never decides alone: it fires first only for C > 2^28 - m*count, and it keeps
  ygBytes' terms below 2^53 (exact integers). One token 'capacity' serves both caps, told apart by message ('2^28' vs
  '2^32 bytes') (A13-3). Gates (A13-4): the Capacity.test.mjs byte-cap rows, the largest accepted C per cell from the
  test's own oracle, a recording sentinel at C* and C* + 1, a check-order row and the mutants M1..M3, and (A14-6) a
  NaN row: ygBytes patched to return NaN throws RangeError 'capacity' with 0 typed-array calls (it fails on the
  17ffcab build, Yggdrasil.js 5eb49244). The recorder points every other typed-array constructor at a throwing
  sentinel; Capacity.test's A_BYTE anchor follows the new text.
- Cap teeth (RV-6, A5-32): a cap too strict by 1 passes every row above, so one ctor call runs with
  globalThis.Float64Array / Int32Array replaced by a sentinel and the requested lengths are asserted; the engine must
  therefore read the typed-array constructors at call time and not alias them at module scope. That sentinel call now
  runs at the byte cap's C* (the R-C1 C* row asserts the first length Lmax*B and the total bytes); the row titled RV-6
  runs at C = cap (byte-cap message) and cap + 1 (C-cap message), 0 allocator calls each (A13-4).

### C-15 Pools; T = 0 by slack (G-A X-3 -> G-A-D10 -> G-A A2-8 (c) -> DB1 P-14 -> 0005 A5-4, A5-6 -> 0005 A10-4)

- Lmax = ceil(C/m) + k. Leaf pool = Lmax; internal pool = Lmax-1; T = 0 (no transient reserve). A view with
  0 < n < m holds one T-8 exempt leaf (this replaces 0004 A-5 "one under-min leaf per view"). A split's peak is its
  post-op state; a splitAt cut's extra leaf is the out view's +1 allowance; join's fresh node fits once two trees
  become one.
- Why T = 0 is safe (slack argument): each view holds at most one leaf < m at any moment (T-8 exempt, unrepaired
  seam, or underflow); a join takes over the emptied view's allowance; so leaves <= floor((C-S)/m) + S <= Lmax with
  S <= k; internal <= leaves - nonempty + 1 <= Lmax - 1 (append's join needs two non-empty views; splitAt's joins reuse
  path nodes, T-4). If a splitAt ever needed a spare internal node the internal pool becomes Lmax; the 0004
  assertion 1 stream (C-36) is the gate meant to catch it, since A2 has no splitAt.
- Pool exhaustion (R-E4, A5-4): the cold allocator and a cold pre-check before the first write of splitAt (1 leaf) and
  append (1 internal) throw RangeError token 'pool' (C-10). By the slack argument it never fires.
- splitAt frees and allocs (A10-4; ygSplitCut): a boundary cut frees exactly 1 internal (the identity join's path node)
  and allocates nothing; a mid-leaf cut frees 0 and allocates 1 leaf; each repair MERGE also frees 1 leaf + 1 internal
  (T-6).
- k-sized from the start (M-2, A5-6): every constructor path, `new SumSequence(C, o)` included (= arena(C, o, 1)), sizes
  its pools with Lmax = ceil(C/m) + k.
- Amends 0001 T-9 / X-3 (cross-ADR) and 0004 A-5 (transient T) and X-3.

### C-16 No grow (R-D1)

- 0.1.0 has no capacity growth (option (a)): capacity is arena-wide and fixed. The README recipe: pre-size C, watch
  `available`, or cold-rebuild into a bigger arena via a cursor walk plus appends, O(n log n). Option (c), a static
  cold bulk build from(seq, C') in O(n) with its own oracle and walker gates, is queued for 0.1.x.

### C-17 TASK 0(alloc): catchability of a huge allocation (G-A A2-5 -> G-A A3-5 -> 0005 R-C1, A12-14, A13-5)

- RULED (R-C1, A12-14): the TASK 0(alloc) probe (whether `new Float64Array(2**30)` throws a catchable RangeError, 8 GiB
  on the shared host) is DROPPED; it was never run. A total byte cap on the arena replaces it: C-14's byte cap
  (implemented in unit bc, A13-5), RangeError 'capacity', deterministic on every host and fail-closed. The G-B sha pin
  is separate and unchanged.

### Counts

### C-18 Moves formulas (G-B O-4)

- Leaves are packed-left. `moves` = existing elements moved to a new slot (the new element is not counted). A split
  keeps the left part in place; the fresh leaf is the right part. Insert into a leaf of size s < B at position p:
  s-p moves. Split into (a | B+1-a): p < a ? B-p : B-a moves; interior p <= B/2 -> B-p (max 15 at B=16), p > B/2 ->
  B/2; append split m-1; prepend split B. Remove with s > m, or from the only leaf: s-1-p. Remove that underflows:
  (m-1-p) + rep. rep(sL, sR, uLeft) (T-6 "free u", t = the pair total): merge (t <= B/2): uLeft ? (sL ? t : 0) :
  sR; equalize: uLeft ? sR : ceil(t/2). Mid-leaf cut: s-p moves; a cut on a leaf boundary: 0.
- Closes 0001 O-4 (the ROADMAP "<= 15 leaf moves" is replaced by these formulas).

### C-19 No front gap; prepends do not mirror moves (G-B B-19 -> 0005 A11-8)

- No front gap exists (a gap costs one load and one add on every in-leaf access of every hot op). "Prepends mirror"
  (0003 G-12) holds for splits, hits, misses and leaves only. prepMoves(N) = N <= B ? N(N-1)/2 : B(B-1)/2 + S*B +
  (S-1)*T(m,B) + T(m,m+r), with S = S(N) (0001 Table 3), r = (N-B-1) mod (B-m+1) and T(a,b) = the sum of s for a <= s <
  b. N=200 at B=16, m=4: 1960 moves, 15 splits, 184 hits (closed form == simulation, node v26.8.2, untimed, 2026-10-26;
  engine-measured, A11-8: 200 insertAt(0) at B = 16 give fingerHits 184, splits 15, moves 1960; node v26.8.2, untimed,
  2026-10-27).

### C-20 Hot pull pass (G-B B-25 -> 0005 A6-3 -> 0005 A9-1 -> 0005 A10-7)

- A non-structural insert / remove / setMeasure is ONE pull pass (count and sums only): no weight read, no balance
  check; pulls == depth. Weights and the T-2 balance check run only in cold rebalance (split, merge), where pulls <=
  4(H+1); a split pulls >= 1 (A6-3: 1 for the fresh node, +1 per ancestor, +2 / 3 per single / double rotation); a merge
  may pull 0 (T-6 splices parent(u): at depth 1 no internal node remains). An equalize changes no weight: pulls ==
  |anc(u) U anc(v)|. Amends 0001 T-2 and 0003 counters row 1.
- Join pulls (R-J1, A9-1): a join (ygJoin) pulls 1 for the fresh internal node + 1 per popped join-spine node + 2 per
  single / 3 per double rotation (the A6-3 split convention). append's pulls delta = the seam repair's C-20 pulls + the
  join's. An exact test row pins it (the R-J1 hand rows of test/SplitAppend.test.mjs). No engine change.
- splitAt with repairs (A10-7; ygSplitCut / ygSplitSeam): the touches are exact (C-25) and an equalize repair's pulls
  are exact (|anc(u) U anc(v)|, above); only a repair MERGE's pulls / rotations are bounded (its cold rebalance may
  rotate).

### C-21 Seam repair counts (G-B B-26 -> 0005 A5-8, A5-24 -> 0005 A7-2 -> 0005 A9-2 -> 0005 A10-3, A10-6)

- splitAt repairs rL + rR in 0..2, where rX = [result X has >= 2 leaves and its seam leaf < m]; the joins inside a
  split do no repair. append repairs [both non-empty and min(a,b) < m] in 0..1, repairing u = the short seam leaf
  (the right one if both are short). T-7 fix: two single leaves become one leaf only when that repair merges
  (3+5 -> 8); 10+10 -> two leaves, 0 repairs; 3+10 -> 6|7 (equalize).
- Order and decision (R-E5 = RS-2, RS-4, A5-24): append's repair runs at the seam of the two operands, before the
  join, on the operands (R-E5; amends 0001 T-7's "after join"; C-25's d_a(last) + d_b(first)); a one-leaf operand
  merged away makes the join the identity. rX is decided from the result's leaf count and its seam leaf size,
  without a seam search (so "0 repairs: d(c)" is exact); a boundary cut never repairs.
- rX exactly (A10-3; ygSplitCut): for a mid-leaf cut (p > 0; a boundary cut never repairs), rX = (the post-join result
  root is internal) & (the cut part < m), the left part p for rL and s - p for rR; it reads no weight and no leaf.
- T-4 join order (A10-6; ygSplitCut): the joins run bottom-up, nearest sibling first: a path node x reached by its left
  child gives right := join(right, right[x]) (x's right child, the path child's sibling), one reached by its right child
  gives left := join(left[x], left); each popped path node is that join's node, ygJoin(v, a, b, u) with u = x, except a
  boundary cut's first pop reached from the right (the identity join: x is freed, C-15).
- Seam leaf (A9-2): u, the short seam leaf append repairs, is always a ROOT leaf: a short seam leaf (< m) exists only in
  a one-leaf operand (walker I-5 / 0001 T-8), so u's stack depth is 0.
- Helpers (M-5, A5-8): repair(u, v, uLeft) and the T-6 helpers take (stack, depth) and accept u and v in different
  trees (C-43), so append's seam repair needs no core hunk. A7-2: repair takes TWO (stack, depth) pairs, a shared-
  prefix count sh and the owner view vu; it never writes _len, hdr live or the finger (the caller does). It fits the
  two-tree seam of splitAt / append with sh = 0.
- Amends 0001 T-7, 0004 A-4 ("one seam repair") and 0003 counters row 11.

### C-22 Edge hysteresis row (G-B B-27)

- Table 3 gains an edge row: right after a 13|4 / 4|13 split, ONE remove on the m side underflows; the repair is
  always an equalize (t = B) to 8|8, costing 8 moves (append side) / 13 (prepend side). The big side needs B/2+2 = 10
  removes. The interior row (5 removes / 9 inserts) is unchanged; R-X1 sizes stay.

### C-23 Height bound and G-13 (G-B B-29 -> G-B ASSERTION 2 -> 0005 A9-4 -> 0005 A10-10)

- G-13 becomes: H(L) == a DP maximum height over all I-1 splits, for L in 1..2048; the engine group adds attainment
  at Lmax; a stack of H(Lmax)-1 must FAIL. H(1) = 0; the bound "<= log_{4/3} L - 1.4" holds only for L >= 2.
  H(1024) = 21, H(2^16) = 36. Controls: a floor(2w/3) mutant FAILS at L = 4 (2 vs 3); the old bound FAILS at L = 1.
- Stack attainment (A9-4, A10-10): a join pushes fewer than HL entries (HL = H(Lmax)). The full H(Lmax) size is attained
  by both stacks, on the rung-7 tree: jstack through append's other-first-leaf path (d_b entries), sstack through
  append's this-last-leaf path (d_a entries) and also through splitAt's descent (d(c)); d == HL == 12 at B = 8 in the
  jsize / jsizeR rows and the sphl R / L rows of test/SplitAppendMutants.test.mjs. The HL - 1 sstack mutant is killed by
  the child timeout: it spins in ygJoin on undefined weights (3 * w is NaN) after the dropped ss[HL-1] write.
- Amends 0001 T-10 and 0003 G-13.

### C-24 COUNTERS (R-D2 -> 0005 A5-15 -> 0005 A9-1, A9-5 -> 0005 A11-4 -> 0005 A15-5 -> 0005 A16-2, A16-4)

- The counter indexes are a static frozen class field SumSequence.COUNTERS; the export list is unchanged. Closes
  0003 O-3. Read-only binding (R-A5, A16-2, RULED): after the class body, Object.defineProperty(SumSequence,
  'COUNTERS', { writable: false, configurable: false }) (cold, module load only); the object stays frozen and
  enumerable is unchanged; a strict-mode assignment throws TypeError. A row asserts the descriptor. Counters stay per
  view (R-X2) and clear() keeps them (C-8).
- Readings (A5-15): readCounters() and resetCounters() ship as the 0003 G-8 rules (resetCounters = fill(0), cold;
  C-12 never listed them) (RA-6). splitAt and append count into this._n, as the stubs and StubCounts do; splitAt's
  out._n delta is 0 (RS-1). joinSteps = internal nodes pushed on the join stack, at most HB(Lmax) per join (RS-5;
  0003 row 10 cites a bound that 0001 never stated).
- Join counters (A9-1, A9-5): a join's pulls are counted per C-20 (R-J1). joinSteps (A9-5) is 0 when the two trees are
  already balanced (the first c, b's root unless 3 w(b) < w(a), already passes I-1 against the other root, so the push
  loop does not run).
- Write form and census (A15-5; 0003 G-5 / G-6, binding as written): every `_n` write is in the 0003 G-5 form
  `n[K] = (n[K] + x) | 0` (51 sites, aliases included; the wrap goes to -2^31, gates read window deltas `(after -
  before) | 0`). The 0003 G-6 census is GATED in npm test (test/CounterCensus.test.mjs): 0 violations, >= 51 G-5
  writes, must-fail fixtures including `if (this._n[7] > 0)` and a `+=` site. The three allowed non-write sites are the
  constructor, readCounters and resetCounters. AF2 leaves the census at 51 G-5 writes, 0 violations (A16-4, reviewer,
  base and head).
- Slot dependence (A11-4, R8-2): the positional tail indexes `YG_MISSES - h`, so it depends on fingerHits = slot 8 =
  fingerMisses - 1 (this layout); test/Counters.test.mjs gates it (deep-equals COUNTERS).

### C-25 Touches
Sources: DB1 P-08 -> G-B-D7 -> G-A A2-6 = G-B B2-4 -> G-B B3-2 -> DB1 N-4 -> 0005 A5-3, A5-14, A5-24, A5-25 ->
  0005 A7-1 -> 0005 A9-6 -> 0005 A10-1, A10-7, A10-8, A10-11 -> 0005 A14-2, A14-3 -> 0005 A15-3

- touches = internal nodes PUSHED onto a descent's path stack: the main descent, the neighbour walk from sibling(u),
  the F-3 re-home, the seam search, and a cursor leaf crossing. Never the leaf itself, never pulls, rotations or join
  spine steps. k(op) = 0 for every op. Bound: touches <= p*HB(Lmax). Exact values come from walker-recounted depths d
  and d' (0003 G-10). A7-1: d(v) is the depth of the neighbour leaf v; the main descent pushes d(u), the T-6 walk
  pushes d(v) - d(u) more.
- Readings (A5-3, A5-14, A5-24, A5-25): a seek on an empty view adds 0 and runs no descent (RA-5); a seek to the end
  still pays d(t) although the cursor ends invalid (R-E3); splitAt at i in {0, length}, or on an empty view, has no
  leaf c: touches 0, no descent (RS-3; the stub short-circuits); append's seam repair is counted before the join
  (R-E5, C-21).
- "Cold" (R-A3, A15-3, RULED): in C-25 and the engine comments, 'cold' means a separate source function, not a promise
  that V8 will not inline it. F-7 (the 195-byte (audit 2026-10-27 F-7, node v26.8.2, untimed) SumCursor _cross inlined
  into next() by TurboFan) is a REPORTED observation: nothing is gated and nothing changes.
- Cursor crossings (A14-2, A14-3; C-7): C-25 counts pushes only. The end crossing (off the last element) pushes nothing
  and adds 0 touches; a leaf crossing adds depth - top touches, top = depth(lca) + 1, = d(t') - depth(lca) - 1.
- Append descents (A9-6): append counts touches += d_a + d_b once, when both operands are non-empty. The d_b descent
  (other's first leaf) pushes nothing and only measures d_b; only a repair re-walks that path into jstack, uncounted.
  Either way the touches counted equal the nodes of the two descents.
- splitAt exact (A10-1, A10-7, A10-8, A10-11; splitAt, ygSplitSeam): touches = d(c) once (the splitAt descent) plus, per
  repair, dv = the depth of the neighbour w in the result tree before the repair (ygSplitSeam's touches += dv), so
  touches = d(c) + the sum of dv over the repairs. The table row "<= d(c) + (rL+rR)*HB(Lmax)" stays a bound; the exact
  value is the sum above. A boundary cut's touches = d(c) of the leaf that STARTS at i. Example (ASSERTION 1 tail, 17
  appends 13|4, splitAt(14)): touches 2 (d(c) 1 + d(w) 1), pulls 2, joinSteps 0, moves 10.
- Table (exact | p): hit 0 | 0; first leaf 0 | 0; total, clear 0 | 0; non-structural miss incl. drain d(t) | 1;
  indexAtSum / sumBefore / seekIndex / seekSum d(t) (t = last leaf when i = length or y >= total) | 1; cursor next 0
  inside a leaf, d(t') - depth(lca) - 1 on a crossing | 1; insert that splits d(t) + d'(t') | 2; remove that
  underflows (merge or equalize) d(v) + d'(t') | 2; append 0 if an operand is empty else d_a(last) + d_b(first) | 2;
  splitAt 0 repairs d(c) | 3; splitAt with repairs <= d(c) + (rL+rR)*HB(Lmax) | 3.
- test/spec-counts.mjs adds touchesMax and touchesExact over this table (zero imports, scalar return);
  SpecCounts.test.mjs has one row per table row. The control is a stub whose touches counter adds 2 per level: it
  FAILS touchesExact. Owners: table -> 0001 (answers 0003 O-1 k(op) = 0); definition -> 0003 G-11, counters row 0.

### C-26 Hit / miss partition (G-A-D6 -> G-B-D7 -> 0005 A5-5 -> 0005 A11-1, A11-6 -> 0005 A12-6)

- Each POSITIONAL op (insertAt, removeAt, setMeasure, getMeasure, entityAt) adds 1 to exactly one of fingerHits /
  fingerMisses; every other op (seeks, indexAtSum, sumBefore, total, next, splitAt, append, clear) adds 0. Amends
  0003 G-12 ("each op") and counters row 8/9. On every finger-off run op the fingerHits delta is 0.
- The hit test landed in rung F-R (A11-1; M-1, C-43): the tail adds 1 to fingerHits on a hit and to fingerMisses
  otherwise (C-4).
- Coverage of the finger-off delta (A11-6, A12-6): the exhaustive driver's off run drops the finger before EVERY op and
  fails 'C-26' on any off-run fingerHits delta (exhaustive.mjs, the off-run check); on the engine that holds since
  Core.test A1. The INTERLEAVED drop (a drop on 1 op in k of an on-run) is gated on the engine by
  test/EngineLanes.test.mjs's FO block (1 op in 4, B 4 / 8 / 16 x seeds 1..3, every positional op x {ok, throw} x
  {dropped, not}). test/count-lane.mjs engine mode never drops the finger (the finger-off drop is stub mode only, at
  HEAD too). Further engine coverage of the NIL finger: test/Finger.test.mjs's NIL row (insertAt only), the G-B2 engine
  lanes and A1 (C-34, test:lanes).

### Harness

### C-27 Snapshot, finger-off, walker state (G-B-D3 -> G-B B2-1 -> G-B B2-2 -> G-A A3-1 -> 0005 A4-6, A4-7, A4-11
  -> 0005 A14-8)

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
- Cursor ops in the drivers (A14-8; C-31): seekIndex / seekSum / next join EX_OPS and EX_NEUTRAL in
  test/exhaustive.mjs, so sweepLane's `cursor` option checks them against this finger-neutral rule.
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

### C-29 Oracle (G-B TASK 3 -> G-B-D8 -> 0005 A12-5 -> 0005 A14-7)

- oracle.mjs is a plain-array model per I-3 / I-4 / M-1..M-8 with boundary rows. Its entity rule is C-9 via the
  B-22 test (no hook). Oracle.test.mjs covers it; the walker and the oracle run after every op in the lanes.
- clear() return (A12-5; harness, C-46): Oracle.clear and the stubs return undefined, the engine returns this (0004),
  and exhaustive.mjs compared returns by kind. Fixed in the driver at K-R2 (A14-7): exInvoke in test/exhaustive.mjs
  reads a clear() that returns the view as undefined (oracle and stubs unchanged).
  test/EngineLanes.test.mjs runs every lane on the unwrapped engineFactory (two clear rows replaced the G-B2 clear
  wrapper rows; v.clear() === v is still asserted there); test/engine-lanes.mjs keeps one counting wrapper with no
  return shim. Gate: on the HEAD driver the unwrapped CAPS sweeps (B 4 / 8) and the clear row fail.

### C-30 spec-counts (G-B SPEC -> ASSERTIONS 1 and 5 -> G-B B2-6)

- test/spec-counts.mjs: H, Lmax(C,m,K,T=0), appendStream / prependStream(B,m,N,out), insertMoves, removeMoves,
  repMoves, cutMoves, seamSplit, seamAppend, pullsHot, touchesMax, touchesExact. Zero imports; scalar return or a
  caller out array. All test files are flat in test/ (the Scaffold scan covers only top-level test/*.mjs).
- appendStream(16,4,1e4) = 768 splits / 9231 hits / 769 misses / 2304 moves; prependStream(16,4,200) = 1960 moves /
  15 splits / 184 hits; closed forms == simulation for N in 1..2000, B in {4, 8, 16} (6000/6000; 1e4 appends give 769
  leaves; node v26.8.2, untimed, 2026-10-26). Controls: the old (m-1)*S = 45 moves formula FAILS; MC-3 (8|8) FAILS on
  splits; an `import` fixture added to spec-counts FAILS the 0003 G-9 gate.
- GC: spec-counts exports 0 B/op over 1e5 calls, maxMajor 0; an object-returning mutant FAILS.

### C-31 Lanes
Sources: G-B B-32 -> G-B-D1 -> B2-1 -> B2-6 -> DB1 P-01 -> 0005 A4-2, A4-5, A4-6, A4-11..14, A5-1, A5-23, A5-34 -> 0005
  A7-5 -> 0005 A12-1, A12-2, A12-3 -> 0005 A14-8

- Shape-only BFS stays the state generator, closed under insertAt / removeAt / splitAt + append at every position,
  with walker and oracle after every op. At EVERY state, for each j in {NIL, 0..L-1}: replay the witness; j = NIL ->
  the NIL write; else getMeasure(firstIndex(j), 0) and assert the walker reads fl == leaf j (a sweep that never lands
  is a failure). Then every 1-op suffix finger on and off: positional ops at every i, seeks at every boundary,
  splitAt(i, b), b.clear(), a.append(b); answers, walker state and post-op fl / fb / depth / path per C-27.
- Free-list order is merged on purpose: it is observable only through ids, and any id alias fails the C-28 census in
  the state where it appears. This works because the walker checks the finger against truth after EVERY op.
- Engine budgets (DEFERRED to the engine group; not run on the stubs): two lanes, each capped at 2^22 op applications
  (nominal), the WHOLE lane (a BFS that closes every size n' <= n pays the cumulative cost). BFS cost = U*(3n+2)*(n+2);
  sweep cost = sum over L of S(L)*comp(n,L)*(L+1)*(8n+7)*(n+2). Result: nMax 9/15 (B=4 / B=8), nSweep 7/11 on the engine
  (A12-1; the nominal B=8 12 exceeds 2^22, below); nSweep <= nMax, reported, never raised. U(B,n) = sum over L of
  S(L)*comp(n,L,[m,B]) (S(L) = number of I-1 shapes) is an upper bound: U(4,16) = 7,901,563, U(8,24) = 1,244,740; the
  reachable count is logged by the first engine run (TASK 0(a) ran: node v26.8.2, untimed, 2026-10-26). If a bound ever
  drops nMax, record it; never raise the budget.
- Engine cap rule applied (A12-1; log .handoff/evidence/g-b2/0b.log, PRELIMINARY host load 4.4-6.8): the engine sweep at
  B=8 exceeds its cap at the nominal sizes. CAPS nSweep 9 applies 262145 > 2^18, so 8 is used (132775 applied); ENGINE
  nSweep 12 applies 4194305 > 2^22, so 11 is used (2116908 applied). Both are passed as nSweep - 1 in
  test/EngineLanes.test.mjs and test/engine-lanes.mjs; CAPS / ENGINE in exhaustive.mjs are unedited (M-6). The B=4 sweep
  is not over (116810 at CAPS, 1960073 at ENGINE).
- Engine reachable counts (A12-2; same log; B=4 / B=8): bfs states 171 / 186 at CAPS, 4044 / 4475 at ENGINE; applied bfs
  24188 / 58161 (CAPS), 1285558 / 3052009 (ENGINE); deep 4226 / 4222 (CAPS), 21091 / 21079 (ENGINE); the deep CAPS
  counts equal the stub counts of C-46 M-6.
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
- Engine-time coverage: see C-32 (0005 A4-14, A7-5).
- The 2^22 runs and the nMax / nSweep 9/15 and 7/11 figures stay with the engine group. The cursor suffixes at CAPS
  landed in K-R2 (A14-8, next bullets).
- Where the lanes run (R-E1, G R-3, A5-1): the CAPS-size lanes run on the engine adapter in npm test; the ENGINE-size
  lanes (2^22 applications, nMax 9 / 15, nSweep 7 / 11, 2e4 deep) run in `npm run test:lanes` (test/engine-lanes.mjs,
  not a *.test file), untimed and DETERMINISTIC, chained into `npm run verify`. A lane over its cap lowers nMax /
  nSweep by 1 with an addendum; the cap is never raised.
- Cursor suffixes (RK-6, A5-23): sweepLane gains an option `cursor` (boolean, default false): per state, for i in
  0..n seekIndex(i) then next() until false; then seekSum(0, sumBefore(0, i)) then next() until false; each answer
  (ret, valid, index, entity, offset(0), measure(0)) is compared with Object.is; the cursor ops join the finger-neutral
  set (C-27). It has its own 2^18 cap (over it: nSweep - 1 and an addendum). Without `cursor` every stub lane report
  stays byte-identical (C-46, M-6).
- Cursor sweep landed (A14-8, K-R2; reading, NOT ruled): `cursor` is as above. Own 2^18 cap. Deterministic counts at
  CAPS (TASK 0(c)): B 4 nSweep 5: 2872 applied (2390 ops); B 8 nSweep 8: 3988 applied (3522 ops); both under the cap,
  so no nSweep reduction beyond A12-1's B = 8 figure. test/CursorLane.test.mjs (14 tests): the engine sweep at B 4 / 8,
  the option checks, a no-patch forwarding control that must pass, and at B 4 and 8 the 4 wrapper controls that must
  fail with their code (ORACLE offset + 1, ORACLE seekSum y + 1, C-27 a seek writes _fl, C-26 a seek adds a miss).
- Engine control mutants (G R-4, A5-34, A12-3): B-1a (weight = element count) fails the CAPS bfsLane with code 'I-1'.
  B-1b (balance by element count, stored weight correct) shows no failure at n <= 6 on the engine (the CAPS bfsLane at
  B=4, nMax 6 passes, applied 24188), so its row runs in test:lanes at bfsLane B=4, nMax 9 (CAPS never raised): first
  {code 'I-1', detail /^balance/, op removeAt, n 7, witnessLength 12}, the first I-1 balance failure. The mutant is
  "rotate only when the weight imbalance is ALSO an element-count imbalance" at both rebalance sites; the
  element-count-only trigger fails I-7 (shared leaf, n 6, witnessLength 9), not I-1. The unpatched build passes through
  the same path.

### C-32 Deep lane, coverage
Sources: G-B-D6 -> G-B B2-3 -> G-B B2-5 -> 0005 A4-1, A4-2, A4-5, A4-10..A4-12, A4-14, A5-1 -> 0005 A7-5 ->
  0005 A10-9 -> 0005 A12-4

- Deep lane: xorshift32 with separate op / index / measure streams (G-A's constants and seeds, C-34); B=4 n in
  [8, 48], B=8 n in [16, 96]; two-view ops included; finger on / off in lockstep; walker + oracle after every op.
  W-DEL / W-INS / W-TIE stay join-built (0001 M-2, engine group). The engine run is 2e4 ops each (DEFERRED to the
  engine group); the stub run (npm test) is 4,000 ops per B, reaches >= 11 leaves (maxLeaves 33 / 32 at B=4 / 8,
  asserted >= 11) and reports its maxLeaves. On the engine the 2e4 run is in `npm run test:lanes` (R-E1, A5-1, C-31).
- Witness tuples (A10-9; test/Witness.test.mjs): 0001 M-2's tuples are leaf counts: (x, y) is a node whose children hold
  x and y leaves. W-INS and W-TIE share the tree shape and differ in leaf sizes (B = 8: INS full leaves -> the insert
  splits; TIE / DEL 2-entry leaves -> the remove merges).
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
- Must fail (stubs; the engine set is the next bullet): a run with removeAt dropped (drop applies to bfsLane AND
  deepLane; at B=8 against the STUBS, missing(drop ['removeAt']) minus missing(full) = {mergeMoves,
  equalize4..equalize8}, where missing(full) is the 4 rot cells); a tally fixture with one zero cell. assertCoverage and
  its controls ship now. The synthStub run misses exactly the 4 rot cells per B (expected: it never rotates); the
  positive coverage run needs rotations and stays with the engine group.
- Engine must-fail set (A12-4; measured on Yggdrasil.js 43276f1e, pinned in test/EngineLanes.test.mjs at CAPS sizes):
  the stub "minus" set above does not carry over: on the engine missing(full) is [] and the set lost by dropping
  removeAt (B=8) is exactly {rotSingle@removeAt, rotDouble@insertAt, rotDouble@removeAt, mergeMoves,
  equalize4..equalize8}. rotSingle@insertAt survives the drop on 2 deep-lane hits only (bfs 0): a thin margin, visible
  in the pin (reviewer log .handoff/evidence/d12/review/a4.log on 4f1a2e3a: rotSingle@insertAt bfs 0 / deep 2 with
  removeAt dropped, deep 5 without the drop). Re-measure on a balance change.

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

### C-34 A1: finger on == finger off
Sources: G-A A1 -> G-A-D1 -> G-A A2-7 -> G-A A3-1..A3-3 -> 0005 A5-1 -> 0005 A11-7, A11-8 -> 0005 A14-10

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
- Engine-measured (A11-8; node v26.8.2, untimed, 2026-10-27): 1e4 insertAt(length) at B = 16 give fingerHits 9231,
  fingerMisses 769, splits 768; 200 insertAt(0) at B = 16 give fingerHits 184, splits 15, moves 1960 (C-19) -- equal to
  the closed-form figures (768 splits: C-30; 184 / 15 / 1960: C-19), now measured on the engine and not only on the leaf
  model.
- Golden stream (A11-7, R8-3): the rung-8 coder's golden stream (1e4 DRAWS, 10328 executed at B8 s1) gives fingerHits
  2062 against the leaf model's 2069 (B8 s1, floors bullet below; its streams count 1e4 executed ops). Informational,
  above the 2000 floor; confirmed by the A1 lane (A14-10): B8 s1 fingerHits 2062 equals the golden stream's.
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
- Where it runs (R-E1, A5-1): A1 (about 1.2e5 full-pool snapshots) runs in `npm run test:lanes`, chained into
  `npm run verify`; DETERMINISTIC, so a missed floor fails and is never re-run. CAPS-size lanes stay in npm test.
- A1 lane (A14-10, K-R2; R-E1 pointer only, the ruling is quoted above and unchanged): test/a1-lane.mjs runs the
  6 streams (s 1..3 x B 8 / 16) and exports runA1() -> {failures, lines}; `npm run test:lanes` SECTION 3 imports it
  with no try/catch (fail closed). Every floor is met, 0 divergences, hits + misses == positional, off-run fingerHits
  0. Deterministic counts (splits / merges / equalizes / hit-after-structural / fingerHits): B8 s1 363 / 518 / 195 /
  182 / 2062; B8 s2 366 / 455 / 198 / 159 / 2187; B8 s3 370 / 482 / 179 / 186 / 2212; B16 s1 130 / 273 / 200 / 127 /
  2603; B16 s2 148 / 250 / 212 / 113 / 2663; B16 s3 149 / 275 / 200 / 125 / 2736. splitAt+append 324 / 271 / 290 and
  clearsLive 3 / 3 / 2 per seed (s 1 / 2 / 3). B8 s1 fingerHits 2062 is 7 under the leaf model's 2069. Controls: the
  MF-2 and MF-4 wrappers (C-35) diverge; an all-off run misses the fingerHits >= 2000 floor. test/Finger.test.mjs
  part 3 runs a 1500-op A1 row (B 8, s 1) in npm test (no floors asserted at that length).

### C-35 Mutants MF-1..MF-5 (G-A-D2 -> G-A A2-1 -> 0005 A5-18 -> 0005 A14-11)

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
- Equivalent engine mutants (A11-3, A14-11): reviewer mutant R6 singleLeafGt0 (`_fdepth === 0 ? 1` -> `? 0` in
  removeAt) is a second EQUIVALENT row in test/Finger.test.mjs beside nilDropped: n === 1 drains before the hit test
  (Yggdrasil.js :1379), so the changed arm is never reached with len 1.
- Wrappers (RF-3, A5-18): MF-2..MF-5 and the rule-1 re-home mutant are TEST WRAPPERS that rewrite the view's own finger
  fields around the correct build (no source anchor, C-46). MF-4 = the structural op re-homes to the touched leaf
  with its pre-op fb and path (the only reading that gives C-35's 9).

### C-36 A2 capacity, assertion-1 stream (G-A B-20 -> G-A A2 -> G-A TASK 0 -> G-A-D10 -> DB1 P-09 -> 0005 A5-4)

- A2: arena(4096, {dims:1}, 6). Stream: five singleton views; view 6 appends and trims each 13-leaf to 4; the leaf
  count reaches L = 1025 at split 1019 with live 4094; pool-exhausted 0; the 4097th insert on each view is a
  RangeError and every view is walker-identical (leaf model, node v26.8.2, untimed, 2026-10-26). Must fail: the
  Lmax = ceil(C/m) mutant (1024) exhausts at split 1019; Lmax = 1030 does not.
- "pool-exhausted 0" is observable on the engine since R-E4 (A5-4): no RangeError with the token 'pool' (C-10, C-15)
  is thrown; the 4097th insert's RangeError carries the token 'capacity'.
- The former 0004 / RESEARCH B-20 text "1 / 1 / 4094 -> 1025" is wrong: that stream peaks at 1023, and the
  1365/1365/1366 stream at 1017 (1023/1017; same provenance); the working control is A2 above.
- Kept beside A2 (0004 assertion 1): arena(4096,{dims:1},3), 1e4 C-34 xorshift32 ops including >= 100 splitAt /
  append, fill to live 4096, the 4097th insert throws on each view, pool-exhausted 0, walkers identical; its
  must-fail is A2's no-+k mutant on the k=6 stream.

### C-37 A3 validation (G-A A3 -> G-A-D9 -> G-A A2-5 -> 0005 A5-33)

- Every E row (C-9), index row (C-10), extra-slot row (C-10), options row (C-11) and cap row (C-14) throws
  RangeError with the snapshot (finger, cursor.valid, walker) unchanged and 0 spy calls; C=2^30, dims 0 / 5, leafSize
  12 and C beyond the C-14 cap throw before allocation.
- Must fail: Number.isInteger(e) (E-4 2^31 stored as -2147483648); `e|0` (E-6 1.5 stored); no typeof (1 spy call).
- Row ownership (RV-7, A5-33): test/Entity.test.mjs owns the per-op rows (E, index, extra-slot, order);
  test/Capacity.test.mjs owns the ctor / cap / pool / stream rows (C-14, C-15, C-36); test/Measures.test.mjs (0002
  DB-7, with no owner until now) is owned by the validation helper and written with the seek rung (C-42).

### C-38 A4 GC (G-A A4 -> G-A-D8 -> 0005 A5-2)

- Cursor seek + 50x next, getMeasure, entityAt, and dims=4 positional insertAt + removeAt: 0 B/op over 1e5 ops each,
  maxMajor 0, Smi lane; the big lane is C-13. Must fail: an array or rest-parameter insert variant > 0 B/op.
- Pause (R-E2, A5-2; DETERMINISTIC gates = maxMajor 0 and 0 B/op): torture's maxPauseMs is REPORTED only, printed
  with provenance, and gates nothing (0003 G-1 already lists maxPauseMs as REPORTED).
- Imports (G R-5, A5-2): the torture template imports @zakkster/lite-signal, which is not a devDependency;
  test/torture.mjs drops the createRoot wrapper and imports no lite-signal.

### C-39 A5 retention (G-A A5 -> 0002 / 0004 retention)

- 1000 cycles of arena(1e3, {dims:2}, 3): 1e3 inserts with 100 caught rejects, a cursor walk, splitAt / append, then
  clear() on every view. lite-leak tracker.size() == 0 after the 1000 cycles; every view equals the constructed state
  (fl NIL, valid false, length 0); header bump 0, live 0. Must fail: MF-5.

### C-40 A6 cursor bit (G-A-D4 -> G-A A2-4 -> G-A A3-4 -> DB1 P-05, P-21 -> 0005 A5-3 -> 0005 A12-12 -> 0005 A16-1)

- test/Cursor.test.mjs. Mutator classes: insertAt, removeAt, setMeasure, splitAt (this), append (this), append
  (other), clear. Per class: a cursor seeked to row 0, the mutation, then valid === false, index -1, entity -1,
  Number.isNaN(offset(0)). A RangeError mutation and every read op leave valid === true and the fields unchanged,
  except the R-E4 'pool' throw,
  which may leave valid false (C-3, R-A4, A16-1; unreachable under C-15, no row).
  The splitAt-out row is not a mutant row: out must be empty, so the test asserts out's cursor valid === false both
  before and after the splitAt.
- Must fail: 7 class mutants, each dropping one class's store (the append-other mutant drops `other._cv = false`),
  plus the validation-order mutant (store before validation; fails the RangeError row), plus the removeAt drain-exit
  mutant (A12-12, below): 9 teeth in test/Cursor.test.mjs.
- One row and one mutant per exit (A12-12, reviewer GATE TEETH finding r1): a mutator with more than one exit gets one
  C-40 row and one must-fail mutant per exit. removeAt's n === 1 drain exit (its `_cv = false` store moved below the
  drain) is the 9th Cursor.test mutant; the reviewer's mutant passed 29/29 before the row was added (K-R1 review r1
  REJECTED test-only, fixed in the one literal round, r2 APPROVED).
- End state (R-E3, A5-3): a seek to the end (i = length or y >= total) and the last next() leave valid === false and
  index -1 (rows on the walk and the empty view); a mutant whose last next() leaves _cv true FAILS (K's MK-4).

### C-41 G-B ASSERTIONS 1-6 (G-B ASSERTIONS -> G-B-D6 -> G-B-D8)

- 1: C-30 counts and controls. 2: H(L) == DP for L in 1..2048, H(1024) = 21, H(2^16) = 36, controls C-23. 3: fixtures
  C-28 (clean passes, each fails with exactly its code; retention live + free == pool). 4: stubs C-33 and the G-9
  import fixture. 5: spec-counts GC C-30. 6: coverage cells C-32.

### Deferred, owners, unverified

### C-42 Deferred
Sources: G-A XG-2 -> G-A XG-4 -> G-A-D11 -> G-A TASKS 5-8 -> DB1 P-10 -> 0005 A4-12, A5-11, A5-28, A5-33 ->
  0005 A9-7, A9-8 -> 0005 A12-1, A12-14, A12-15, A13-5 -> 0005 A14-10

- PENDING bench (R-B1, A12-15, RULED; owns ADR 0003 O-4; it does not apply to 0.1.0, Bench-ADOPT follows 0.1.0): a
  release whose bench is PENDING ships no benchmark numbers. The README Benchmarks section says 'PENDING for
  <version>' and names the last release that has a measured table, without copying its numbers. Statistical claims
  are REPORTED only (ROADMAP Y-13), so no statistical release gate is owed.
- DEFERRED to the engine group (0005 A4-12): the engine lane numbers of C-31 / C-32 (2^22, nMax 9/15, nSweep 7/11, the
  2e4 deep run), the positive coverage run, the cursor suffixes, C-20 / C-25 exactness, and W-DEL / W-INS / W-TIE.
  The ENGINE-size runs go to `npm run test:lanes` (R-E1, C-31).

- DEFERRED to SumMap: B-17 part (c) keyed fence (I-6) and B-23. XG-2: v0.1 one column per dim (identical at dims=1);
  interleaved A/B is a REPORTED measurement, owner Bench-ADOPT / LP-4 Q-1. XG-4: deferred to the post-engine perf
  pass (one RMW on a hot miss descent; the structural reason is already exact as splits + merges + equalizes).
  XG-3 readRange: Tier 2. 0004 O-3 parent column: v0.4 pool planner. from(seq, C'): 0.1.x (C-16).
- Engine phase owners: tests test/Finger.test.mjs, Entity.test.mjs, Capacity.test.mjs, Cursor.test.mjs (helper, from
  the gates C-34..C-40) and test/Measures.test.mjs (RV-7, C-37); Yggdrasil.d.ts, test/types/smoke.ts, llms.txt,
  CHANGELOG [Unreleased] and README (docs helper). Yggdrasil.js hunks belong to the engine planner's sequential
  rungs. The spike stub update (move to the closed API: cursor loop, adapter clamps, ids <= 2^30-1) is a FILLER.
- Engine planner CONFIRMED (E0, RA-2, A5-11): NIL = 0 and EMPTY_ROOT = 0x3FFFFFFF (C-1, C-8, C-27).
- OPEN, stays open (RS-8, A5-28): 0001 O-1 (the BFS join predicates, written from memory). The join rung transcribes
  0001 T-3 literally; walker I-1 on the lanes is the gate.
- Evidence on O-1 (A9-7, review proof): join's double rotation never sees a leaf inner node (ygJoinRotL / ygJoinRotR
  read the children of z = the inner child of y, and have no leaf guard). O-1 stays OPEN.
- 0001 M-4 (the gamma rotation rule inside join; not C-43's M-4) "record whether killed" (A9-8): the gamma-inside-join
  mutant SURVIVES. Recorded as a fact; the engine's join keeps BFS's own rule (no gamma).
- UNVERIFIED: the C-32 cells on the real engine; the C-14 byte cap's formula against real allocations (implemented in
  unit bc, A13-5); the U reachable counts (C-31). The C-34 floors are measured on the engine (A14-10, test:lanes).

### Engine build (E0)

### C-43 Engine landing contracts
Sources: PLAN-E0 M-1 -> M-2 -> M-3 -> M-4 -> M-5 -> 0005 A5-5..A5-8 -> 0005 A7-2 -> 0005 A11-1 -> 0005 A12-7 ->
  0005 A14-13

- Orchestrator merge rulings, not maintainer rulings; they bind the engine build. The rung ladder is PLAN-E0.md's.
- M-1 (A5-5): the finger WRITE side lives in the engine core. From the rung that adds each positional op, the op
  re-homes (C-3, by the A4-10 (a) element rule on a structural op) and writes NIL / 0 / 0 where C-5 says. Rung F-R
  (landed, A11-1) added the hit test (C-4) and the C-26 split and no structural code: structural work is on the miss
  branch only, and the core reads the finger for the hit test. The re-home / NIL / neutral part of Finger.test.mjs is
  written alongside the trunk insert-side rung (M-1).
- Cursor landing (A12-7; C-6, C-7): rung K-R1 landed cursor(), the valid / index / entity getters, offset(d) /
  measure(d), seekIndex, seekSum and the `_cv = false` stores in all six mutators (append's other and splitAt's out
  included); rung K-R2 landed next() and the stack writes (A14-13).
- M-2 (A5-6): `new SumSequence(C, o)` is `arena(C, o, 1)` through ONE init, with pools sized for k views (C-15) and the
  full constructor validation (C-11, C-14, C-16) from its first version. After it, the only arena-specific addition is
  the k >= 2 clear free-walk (0004 A-6); its teeth: an O(1) pool reset while another view is live fails I-7 'shared';
  a second init fails %HaveSameMap.
- M-3 (A5-7): validation has no rung of its own. The constructor checks ride the init, each op's C-10 checks ride the
  rung that adds the op, and the splitAt / append operand checks ride their rungs; an op added without its checks is
  REJECTED at review. Until every op carries them the engine is fail-open: nothing is released in between.
- M-4 (A5-7): init, layout, pools, constructor validation, counters and getters (no ops) land before the first op; the
  one-leaf ops, seeks and clear, with their checks, follow.
- M-5 (A5-8, A7-2): repair(u, v, uLeft) and the T-6 helpers take (stack, depth) and accept u / v in different trees
  (C-21); repair takes two (stack, depth) pairs + sh + vu and leaves _len, hdr live and the finger to its caller.

### C-44 Engine internal layout, the adapter contract
Sources: PLAN-E0-A RA-1, RA-2 -> PLAN-E0-G G R-1 -> 0005 A5-10, A5-11 -> 0005 A6-1 -> 0005 A12-8 -> 0005 A15-2, A15-6,
  A15-8 -> 0005 A16-7

- Each view has own fields in this order: _root, _len, _fl, _fb, _fdepth, _fpath, _cv, _cur, _n, then hoisted column
  refs, and _ar (the shared arena record). _ar keys (A15-8): C, B, shift, m, dims, Lmax, HL, sx, jstack, sstack
  (no `views`: it was never read after arena() returned and retained every sibling view and cursor; arena() builds and
  returns its own array, and `new SumSequence` keeps none). _cur (A12-8, K1-R1) is
  the one cursor object reference, set once in the constructor and never reassigned. The header hdr is an
  Int32Array(5) [live, lbump, lfree, ibump, ifree] with END = -1; a fresh arena reads [0, 0, -1, 0, -1].
- Internal columns: left, right, weight, count, inext, sums[d]. Leaf columns: llen, lnext, ent, meas[d] (each
  Lmax * B), lsum[d] (engine-only, not in the snapshot). The m0..m3 of a new element are staged in _ar.sx
  (Float64Array(4)), never passed as arguments (zero-box).
  At dims > 1 insertAt's public measure arguments of slots 1..dims-1 (slots < dims, C-10) are
  typeof-checked inline BEFORE any store into sx (one fused `(typeof m1 !== 'number') | ...` branch under dims > 1;
  R-Q1, A6-1), then stored into sx[1..dims-1]. ygSlots (A15-6) then checks sx[1..dims-1] inline, each slot: range
  `!((m >= 0) & (m <= YG_MAX))` ('measure must be in [0, 2^53-1]'), then `m % 1 !== 0` ('measure must be an
  integer'); no call carries the double (Zero-Box law) and the helper ygMeasure is removed. Messages and tokens are
  unchanged. R-A2 (A15-2): the dims-change re-tiering deopt (F-3) is a reading; the fused branch stands.
  Gate (A16-7, CL-5): the AF-3 test is call-shape keyed: inside ygSlots every `yg\w+(` call is `ygFail(`, plus the kept
  `(sx[` and ygMeasure checks, with in-test must-fail controls (test/AuditFixes.test.mjs).
- The engine adapter engineFactory(C, {leafSize, dims}, count, cfg) -> {views, snapshot()} reads the RA-1 fields (each
  view's hoisted column refs; the constants in views[0]._ar); snapshot() follows the walker header (C-27) exactly,
  every array a deep copy; any cfg key is a RangeError 'cfg' (the engine takes none). NIL = 0 and
  EMPTY_ROOT = 0x3FFFFFFF (RA-2, C-8).

### C-45 Leaf sums are recounted (PLAN-E0-A RA-3 -> 0005 A5-12)

- The I-2 rule "recomputed, never by deltas" binds the leaf-sum column too: an op recounts the touched leaf's sum,
  O(len) per dim, and never adjusts it by a delta. The column is engine-only; the walker recounts from len + meas
  (C-27). The gate is walker I-2 (C-28).

### C-46 Engine test infrastructure
Sources: PLAN-E0 M-6 -> M-7 -> M-8 -> PLAN-E0-G G R-2 -> 0005 A5-9, A5-18 -> 0005 A12-5, A12-9 ->
  0005 A14-7, A14-9, A14-12

- M-6 (A5-9): test/exhaustive.mjs stays byte-identical to HEAD (the G parity pin) until the cursor-suffix batch (C-31);
  that batch re-pins it with a golden of every stub lane report, byte-identical: bfs 7,095 / 24,532, sweep 40,623 /
  154,475, deep 4,226 / 4,222 (B=4 / B=8; the C-31 counts).
- M-6 re-pin landed (A14-9, K-R2): golden (b) (every stub lane at CAPS, the frozen HEAD driver against the live driver
  with cursor off) is byte-identical (bfs 7095 / 24532, sweep 40623 / 154475, deep 4226 / 4222); the Exhaustive.test
  pin is fce39b1a -> 6734c7aa ("re-pinned at K-R2"); CAPS, ENGINE and the exports are unchanged.
- M-6 clear fix (A12-5, A14-7; C-29): landed in the driver (exInvoke reads a clear() that returns the view as
  undefined); the G-B2 clear wrappers are gone (C-29 has the text).
- Cursor anchors (A14-12; C-7, C-25): the cursor source anchors are trailing `// cr:<site>` comments, one per site, 7
  in Yggdrasil.js: cr:push x2 (the two seeks), cr:guard, cr:carry, cr:cross, cr:pop, cr:end (`ck:` collided with
  jstack: / sstack: / check:). test/Cursor.test.mjs MK-1..MK-5 and the cr:cross / cr:pop / cr:push mutants are built
  on them with buildMutant (M-8).
- Source anchors (A12-9; C-7): Core.test's indexAtSum source anchors stay unique because seekSum writes `if (acc + sl >
  y) {` and `if (y < acc + m) break;`; future seekSum anchors use that text.
- M-7 (A5-9): StubCounts stays stub-only. Its runLane moves into test/count-lane.mjs with a factory parameter (stub /
  engine modes) only after HB4b is committed, with a golden of the stub-mode report cut first.
- M-8, G R-2 (A5-9): engine mutants are exact-count source patches of a temp copy,
  buildMutant(path, [[anchor, replacement, count]]) (each anchor must match exactly `count` times, else throw; mkdtemp,
  import, clean up; the StubCounts pattern); no test hook lives in a hot body. D5 reconciliation (not in PLAN-E0;
  orchestrator-confirmed in D5): the C-35 finger wrappers (RF-3) patch no source and add no hot hook, so M-8 does not
  cover them.

## Amends

Batch B2 copies these rows into each ADR's pointer block; the ADR column is the exact item id in that ADR. The rows
0003 G-2 and 0004 A-3 are new with ADDENDUM 5 (R-E1, RS-6); both ADR pointer blocks carry them (D5).

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
| 0003 G-2 | C-31, C-34 |
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
| 0003 O-4 | C-42 |
| 0003 X-8 | C-8 |
| 0003 DB-1 B-17 | C-4, C-27 |
| 0003 DB-1 B-19 | C-19 |
| 0003 DB-1 B-29 | C-23 |
| 0004 A-1 | C-6 |
| 0004 A-2 | C-14 |
| 0004 A-3 | C-10 |
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
| PLAN-E0 R-E1 | C-31, C-32, C-34 |
| PLAN-E0 R-E2 | C-38 |
| PLAN-E0 R-E3 | C-6, C-7, C-25, C-40 |
| PLAN-E0 R-E4 | C-10, C-15, C-36 |
| R-E5 (D5) | C-21, C-25 |
| PLAN-E0 M-1 | C-3, C-26, C-43 |
| PLAN-E0 M-2 | C-14, C-15, C-43 |
| PLAN-E0 M-3 | C-10, C-43 |
| PLAN-E0 M-4 | C-43 |
| PLAN-E0 M-5 | C-21, C-43 |
| PLAN-E0 M-6 | C-31, C-46 |
| PLAN-E0 M-7 | C-46 |
| PLAN-E0 M-8 | C-46 |
| PLAN-E0-A RA-1 | C-44 |
| PLAN-E0-A RA-2 | C-1, C-8, C-42, C-44 |
| PLAN-E0-A RA-3 | C-45 |
| PLAN-E0-A RA-4 | C-8 |
| PLAN-E0-A RA-5 | C-25 |
| PLAN-E0-A RA-6 | C-24 |
| PLAN-E0-F RF-1 | C-3, C-10 |
| PLAN-E0-F RF-2 | C-4 |
| PLAN-E0-F RF-3 | C-35, C-46 |
| PLAN-E0-K RK-1 | C-6, C-7, C-25, C-40 |
| PLAN-E0-K RK-2 | C-7, C-13 |
| PLAN-E0-K RK-3 | C-7, C-10 |
| PLAN-E0-K RK-4 | C-7 |
| PLAN-E0-K RK-5 | C-6 |
| PLAN-E0-K RK-6 | C-31 |
| PLAN-E0-S RS-1 | C-24 |
| PLAN-E0-S RS-2 | C-21, C-25 |
| PLAN-E0-S RS-3 | C-25 |
| PLAN-E0-S RS-4 | C-21 |
| PLAN-E0-S RS-5 | C-24 |
| PLAN-E0-S RS-6 | C-10 |
| PLAN-E0-S RS-7 | C-13 |
| PLAN-E0-S RS-8 | C-42 |
| PLAN-E0-V RV-1 | C-14 |
| PLAN-E0-V RV-2 | C-10 (census 14 superseded by R-Q1) |
| PLAN-E0-V RV-3 | C-11 |
| PLAN-E0-V RV-4 | C-11 |
| PLAN-E0-V RV-5 | C-10, C-15, C-36 (superseded by R-E4: Error becomes RangeError) |
| PLAN-E0-V RV-6 | C-14 |
| PLAN-E0-V RV-7 | C-37, C-42 |
| PLAN-E0-V RV-8 | C-11 |
| PLAN-E0-G G R-1 | C-44 |
| PLAN-E0-G G R-2 | C-46 |
| PLAN-E0-G G R-3 | C-31 (answered by R-E1) |
| PLAN-E0-G G R-4 | C-31 |
| PLAN-E0-G G R-5 | C-38 |
| 0005 A5-1 | C-31, C-32, C-34 |
| 0005 A5-2 | C-38 |
| 0005 A5-3 | C-6, C-7, C-25, C-40 |
| 0005 A5-4 | C-10, C-15, C-36 |
| 0005 A5-5 | C-3, C-26, C-43 |
| 0005 A5-6 | C-14, C-15, C-43 |
| 0005 A5-7 | C-10, C-43 |
| 0005 A5-8 | C-21, C-43 |
| 0005 A5-9 | C-46 |
| 0005 A5-10 | C-44 |
| 0005 A5-11 | C-1, C-8, C-42, C-44 |
| 0005 A5-12 | C-45 |
| 0005 A5-13 | C-8 |
| 0005 A5-14 | C-25 |
| 0005 A5-15 | C-24 |
| 0005 A5-16 | C-3, C-10 |
| 0005 A5-17 | C-4 |
| 0005 A5-18 | C-35, C-46 |
| 0005 A5-19 | C-7, C-13 |
| 0005 A5-20 | C-7, C-10 |
| 0005 A5-21 | C-7 |
| 0005 A5-22 | C-6 |
| 0005 A5-23 | C-31 |
| 0005 A5-24 | C-21, C-25 |
| 0005 A5-25 | C-25 |
| 0005 A5-26 | C-10 |
| 0005 A5-27 | C-13 |
| 0005 A5-28 | C-42 |
| 0005 A5-29 | C-14 |
| 0005 A5-30 | C-10 |
| 0005 A5-31 | C-11 |
| 0005 A5-32 | C-14 |
| 0005 A5-33 | C-37, C-42 |
| 0005 A5-34 | C-31 |
| R-Q1 | C-10, C-44 |
| R-P1 | C-3 |
| R-P2 | C-3 |
| r3 review Q4 | C-20 |
| 0005 A6-1 | C-10, C-44 |
| 0005 A6-2 | C-3 |
| 0005 A6-3 | C-20 |
| 0005 A6-4 | C-3 |
| 0005 A7-1 | C-25 |
| 0005 A7-2 | C-21, C-43 |
| 0005 A7-3 | C-10 |
| 0005 A7-4 | C-3 |
| 0005 A7-5 | C-31, C-32 |
| R-S1 | C-8, C-10 |
| R-S2 | C-8 |
| R-S3 | C-8 |
| 0005 A8-1 | C-8, C-10 |
| 0005 A8-2 | C-8 |
| 0005 A8-3 | C-8 |
| 0005 A8-4 | C-8 |
| R-J1 | C-20, C-24 |
| 0005 A9-1 | C-20, C-24 |
| 0005 A9-2 | C-21 |
| 0005 A9-3 | C-3, C-10 |
| 0005 A9-4 | C-23 |
| 0005 A9-5 | C-24 |
| 0005 A9-6 | C-25 |
| 0005 A9-7 | C-42 |
| 0005 A9-8 | C-42 |
| 0005 A10-1 | C-25 |
| 0005 A10-2 | C-3, C-10 |
| 0005 A10-3 | C-21 |
| 0005 A10-4 | C-15 |
| 0005 A10-5 | C-10 |
| 0005 A10-6 | C-21 |
| 0005 A10-7 | C-20, C-25 |
| 0005 A10-8 | C-25 |
| 0005 A10-9 | C-32 |
| 0005 A10-10 | C-23 |
| 0005 A10-11 | C-25 |
| 0005 A11-1 | C-3, C-4, C-26, C-43 |
| 0005 A11-2 | C-4 |
| 0005 A11-3 | C-4 |
| 0005 A11-4 | C-24 |
| 0005 A11-5 | C-5 |
| 0005 A11-6 | C-26 |
| 0005 A11-7 | C-34 |
| 0005 A11-8 | C-19, C-34 |
| R-C1 | C-14, C-17, C-42 |
| R-B1 | C-42 |
| 0005 A12-1 | C-31, C-42 |
| 0005 A12-2 | C-31 |
| 0005 A12-3 | C-31 |
| 0005 A12-4 | C-32 |
| 0005 A12-5 | C-29, C-46 |
| 0005 A12-6 | C-26 |
| 0005 A12-7 | C-6, C-7, C-43 |
| 0005 A12-8 | C-6, C-44 |
| 0005 A12-9 | C-7, C-46 |
| 0005 A12-10 | C-6, C-7 |
| 0005 A12-11 | C-7, C-10 |
| 0005 A12-12 | C-40 |
| 0005 A12-13 | C-13 |
| 0005 A12-14 | C-14, C-17, C-42 |
| 0005 A12-15 | C-42 |
| 0005 A13-1 | C-14 |
| 0005 A13-2 | C-14 |
| 0005 A13-3 | C-14 |
| 0005 A13-4 | C-14 |
| 0005 A13-5 | C-17, C-42 |
| 0005 A14-1 | C-6, C-7 |
| 0005 A14-2 | C-7, C-25 |
| 0005 A14-3 | C-7, C-25 |
| 0005 A14-4 | C-6 |
| 0005 A14-5 | C-6 |
| 0005 A14-6 | C-14 |
| 0005 A14-7 | C-29, C-46 |
| 0005 A14-8 | C-27, C-31 |
| 0005 A14-9 | C-46 |
| 0005 A14-10 | C-34, C-42 |
| 0005 A14-11 | C-35 |
| 0005 A14-12 | C-46 |
| 0005 A14-13 | C-6, C-7, C-43 |
| R-A1 | C-13 |
| R-A2 | C-10, C-44 |
| R-A3 | C-25 |
| 0005 A15-1 | C-13 |
| 0005 A15-2 | C-10, C-44 |
| 0005 A15-3 | C-25 |
| 0005 A15-4 | C-8 |
| 0005 A15-5 | C-24 |
| 0005 A15-6 | C-44 |
| 0005 A15-7 | C-10 |
| 0005 A15-8 | C-44 |
| 0005 A15-9 | C-13 |
| R-A4 | C-3 |
| R-A5 | C-24 |
| R-A6 | C-8 |
| 0005 A16-1 | C-3, C-6, C-40 |
| 0005 A16-2 | C-24 |
| 0005 A16-3 | C-8 |
| 0005 A16-4 | C-13, C-24 |
| 0005 A16-5 | C-13 |
| 0005 A16-6 | C-10 |
| 0005 A16-7 | C-44 |
| 0005 A16-8 | C-13 |

Count note: this map has 128 rows: G-A 61 (body 13, D-1..D-3 3, R-D1..R-D3 3, TASKS 0-8 9, A1..A5 5, RISK 3, G-A-D1..D11
11, A2-1..A2-8 8, A3-1..A3-5 5, plus the shared R-D4 row), G-B 39 (O-4, B-19, B-25, B-26, B-27, B-29, B-32, XG-1;
TASKS 0-7; ASSERTIONS 1-6; RISK; D1..D8; B2-1..B2-6; B3-1..B3-2) and DB1 28 (P-01..P-23, N-1..N-5). The planner's 97
(45/24/28) = G-A body 13 + A1..A5 5 + D-1..D-3 3 + G-A-D1..D11 11 + A2 8 + A3 5; G-B body 8 + D1..D8 8 + B2 6 + B3 2;
DB1 28. The 31 extra rows are G-A R-D1..R-D4, TASKS 0-8, RISK 1-3 and G-B TASKS 0-7, ASSERTIONS 1-6, RISK. The 14
rows 0005 A4-1..A4-14 follow the DB1 rows (142 rows). The 49 E0 source rows (PLAN-E0 R-E1..R-E4 4, R-E5 (D5) 1,
M-1..M-8 8, RA 6, RF 3, RK 6, RS 8, RV 8, G R 5) and the 34 rows 0005 A5-1..A5-34 follow the A4 rows (225 rows).
The 4 rung-3/4 source rows (R-Q1, R-P1, R-P2, r3 review Q4) and the 4 rows 0005 A6-1..A6-4 follow the A5 rows (233
rows); the 5 rows 0005 A7-1..A7-5 follow them (238 rows); the 3 rung-5 source rows R-S1..R-S3 and the 4 rows
0005 A8-1..A8-4 follow those (245 rows); the rung-6 source row R-J1 and the 8 rows 0005 A9-1..A9-8 follow those (254
rows in all); the 11 rows 0005 A10-1..A10-11 follow those (265 rows; the rung-7 readings carry their RD / S3 / H3 tag
in the ADDENDUM 10 item, no separate source row); the 8 rows 0005 A11-1..A11-8 follow those (273 rows; the rung-8
readings carry their R8 tag in the ADDENDUM 11 item, no separate source row); the 2 ruling rows R-C1, R-B1 and the 15
rows 0005 A12-1..A12-15 follow those (290 rows; A12-14 and A12-15 are the two rulings, the readings carry no separate
source row); the 5 rows 0005 A13-1..A13-5 follow those (295 rows; the bc readings carry no separate source row);
the 13 rows 0005 A14-1..A14-13 follow those (308 rows; the K-R2 readings carry their K2-id tag in the ADDENDUM 14
item, no separate source row); the 3 ruling source rows R-A1..R-A3 and the 9 rows 0005 A15-1..A15-9 follow those (320
rows; A15-1..A15-3 are the three rulings, the AF readings carry their AF-n tag in the ADDENDUM 15 item, no separate
source row); the 3 ruling source rows R-A4..R-A6 and the 8 rows 0005 A16-1..A16-8 follow those (331 rows;
A16-1..A16-3 are the three rulings, the AF2 readings carry their AF2-n tag in the ADDENDUM 16 item, no separate source
row).
No E0 or rung-3/4/5/6 source item is history-only: each one changed a CURRENT rule.

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

### ADDENDUM 5 (2026-10-26) -- E0 engine planner pass, 0005's own

Tier: every gate named here is DETERMINISTIC: npm test (CAPS-size engine lanes, Cursor / Entity / Capacity / Finger
rows, mutants) and `npm run test:lanes` (ENGINE-size lanes and the C-34 A1 run; chained into `npm run verify`, R-E1).
The torture pause (maxPauseMs) is REPORTED only (R-E2); maxMajor 0 and 0 B/op are DETERMINISTIC. No number below is an
engine measurement (there is no engine yet): counts are closed-form or nominal. A5 items from the six E0 plans are
PROPOSED readings folded as rules; where two plans differ, PLAN-E0.md's reconciliation wins. M-1..M-8 are
orchestrator rulings, not maintainer rulings. Each item names the CURRENT rule(s) it changed; the rule text above is
already amended (same edit). The map rows are in the Source map.

- A5-1 R-E1 + G R-3 (maintainer ruling, quoted above) -> C-31, C-32, C-34 (amends 0003 G-2 in the
  Amends table). ENGINE-size lanes and the A1 run live in `npm run test:lanes`, chained into verify; CAPS lanes stay
  in npm test.
- A5-2 R-E2 + G R-5 (maintainer ruling, quoted above) -> C-38. maxPauseMs is printed with provenance and
  gates nothing; torture imports no @zakkster/lite-signal (G R-5).
- A5-3 R-E3 + RK-1 (maintainer ruling, quoted above) -> C-6, C-7, C-25, C-40. The end state of a cursor is
  valid false; the seek descent still counts d(t). Resolves RK-1 and D-K1.
- A5-4 R-E4 + RV-5 + S D-S1 (maintainer ruling, quoted above) -> C-10, C-15, C-36. RV-5's
  Error('pool') becomes RangeError 'pool' (R-E4); "pool-exhausted 0" is observable on the engine.
- A5-5 M-1 (merge ruling; PLAN-E0-A "core WRITES the finger and never READS it"; PLAN-E0-F F-R1 absorbed) -> C-3, C-26,
  C-43. Core re-homes and NILs from the op's first rung; the hit test lands later; no change to C-4 or C-26 semantics.
- A5-6 M-2 -> C-14, C-15, C-43. One init: `new SumSequence(C, o)` = `arena(C, o, 1)`, k-sized pools, ctor validation.
- A5-7 M-3 + M-4 (PLAN-E0-V: no V rung of its own) -> C-10, C-43. No op without its C-10 checks; no release between
  the init rung and the last op rung; init / layout / counters before the first op.
- A5-8 M-5 (PLAN-E0-S RISK) -> C-21, C-43. repair(u, v, uLeft) and the T-6 helpers take (stack, depth) and accept u / v
  in different trees.
- A5-9 M-6 + M-7 + M-8 + G R-2 (PLAN-E0-G TASK 2, TASK 6) -> C-46. exhaustive.mjs pinned until the cursor-suffix batch;
  StubCounts stub-only until HB4b is committed; engine mutants are exact-count source patches, no test hook.
- A5-10 RA-1 + G R-1 (PLAN-E0-A, PLAN-E0-G TASK 1) -> C-44. The engine-internal contract the adapter reads: view
  fields, _ar keys, hdr, column names; engineFactory and its cfg rule.
- A5-11 RA-2 (confirmation of C-42) -> C-1, C-8, C-42, C-44. NIL = 0 and EMPTY_ROOT = 0x3FFFFFFF; the harness still
  reads both from a fresh view. Restates the C-42 "engine planner confirms" item as confirmed.
- A5-12 RA-3 (PLAN-E0-A) -> C-45. I-2 "recomputed, never by deltas" binds the leaf-sum column: recount the touched
  leaf, O(len) per dim.
- A5-13 RA-4 -> C-8. A removeAt that takes the arena to live 0 resets the pools as clear() does.
- A5-14 RA-5 -> C-25. A seek on an empty view adds 0 touches and runs no descent.
- A5-15 RA-6 + RS-1 + RS-5 -> C-24. readCounters / resetCounters ship (0003 G-8); splitAt / append count into this._n;
  joinSteps = nodes pushed on the join stack, <= HB(Lmax) per join.
- A5-16 RF-1 (wins over V's V-R3 `m > MAX - (t - m_old)`; PLAN-E0 reconciliation) -> C-3, C-10. setMeasure: hot headroom
  `m <= MAX - total(d)`, cold READ-ONLY descent on failure; compatible with "headroom last before the first write";
  a headroom RangeError leaves the finger unchanged.
- A5-17 RF-2 -> C-4. removeAt hit needs len > 1 on a single-leaf view and len > m otherwise; restates C-4 "no free is
  needed" for removeAt.
- A5-18 RF-3 -> C-35, C-46. MF-2..MF-5 and the rule-1 mutant are test wrappers; MF-4 re-homes to the touched leaf with
  its pre-op fb and path. D5 reconciliation (C-46): M-8 covers source patches only.
- A5-19 RK-2 -> C-7, C-13. Seeks and next() return boolean valid; next() on an invalid cursor does nothing and returns
  false; seekIndex b = 0.
- A5-20 RK-3 -> C-7, C-10. seekIndex i in [0, length], token 'index'; seekSum dim then y (M-8 of 0002), tokens 'dim' /
  'seek'; a throwing seek leaves the cursor unchanged.
- A5-21 RK-4 -> C-7. offset(d) is O(1) from the running Float64Array.
- A5-22 RK-5 -> C-6. Only _cv lives on the view; the C-27 snapshot is unchanged; the class is not exported.
- A5-23 RK-6 -> C-31. sweepLane option `cursor`, own 2^18 cap, over it nSweep - 1 + an addendum.
- A5-24 RS-2 (ruled R-E5, quoted above) + RS-4 -> C-21, C-25. append's repair runs on the
  operands before the join (amends 0001 T-7's order); rX is decided without a seam search; a boundary cut never repairs.
- A5-25 RS-3 -> C-25. splitAt at i in {0, length} or on an empty view: touches 0, no descent.
- A5-26 RS-6 -> C-10 (amends 0004 A-3 in the Amends table). Operand check = a private `#` brand, then `_hdr`; order:
  not a view, self, other arena, non-empty out, then headroom.
- A5-27 RS-7 -> C-13. b = 0 for splitAt and append.
- A5-28 RS-8 -> C-42. 0001 O-1 stays OPEN; the join transcribes T-3 literally; walker I-1 is the gate.
- A5-29 RV-1 -> C-14. Check order: C -> options -> leafSize -> dims -> count -> cap last.
- A5-30 RV-2 -> C-10. `| (dims > 1)` on the extra-slot and headroom branches; the dims=1 census stays 14; no census
  gate.
- A5-31 RV-3 + RV-4 + RV-8 -> C-11. Own-descriptor values; Levenshtein nearest key (tie -> 'dims'); a Proxy's traps are
  a documented limit.
- A5-32 RV-6 -> C-14. The cap is tested with a sentinel for globalThis.Float64Array / Int32Array during one ctor call;
  the engine must not alias them at module scope.
- A5-33 RV-7 -> C-37, C-42. Entity.test = per-op rows, Capacity.test = ctor / cap / pool / stream rows; Measures.test
  gets an owner.
- A5-34 G R-4 -> C-31. Engine control mutants B-1a / B-1b: codes, first-failure shape and the test:lanes fallback.

OPEN (not folded, maintainer decision pending): none. RS-2 contradicted the order in ruled 0001 T-7; the D5 review
raised it and the maintainer ruled R-E5 (quoted above). No other E0 reading contradicts R-D1..R-D4 or the
ruled text of ADRs 0001..0004 (R-Y01, R-X1, R-X2, R-X5, R-Y05, R-Y09, R-Y15).

### ADDENDUM 6 (2026-10-26) -- rung 3-4 rulings and review readings, 0005's own

Tier: every rule named here is DETERMINISTIC (a branch count by reviewer reading plus a bytecode golden, a finger
state row, a pull-count lane). No number below is an engine timing. A6-1, A6-2 and A6-4 are maintainer
rulings (R-Q1, R-P1, R-P2, quoted above); A6-3 is a review reading, not a ruling. A6-4 is engine work for rung 4. Each
item names the CURRENT rule(s) it changed; the rule text above is already amended (same edit). The map rows are in the
Source map. No ruling here amends an ADR rule (they amend 0005 rules and a plan rule, RV-2),
so the Amends table gains no row.

- A6-1 R-Q1 (maintainer ruling, quoted above) -> C-10, C-44. At dims > 1 insertAt's slots 1..dims-1 are
  typeof-checked inline (one fused branch) before the store into sx[1..dims-1]; the cold re-check reads sx. This adds
  one hot branch: the dims=1 census is 15 (supersedes A5-30's 14). Lands in rung 4's coder round.
- A6-2 R-P1 (maintainer ruling, quoted above) -> C-3. The R-E4 'pool' throw (unreachable under C-15) may leave
  _fpath[0..d) rewritten; _fl, _fb and _fdepth are unchanged. No engine change. (Superseded in part by A6-4.)
- A6-3 Q4 (r3 reviewer nit; a review reading, NOT a maintainer ruling) -> C-20. A split pulls >=
  1 and <= 4(H+1) (a merge may pull 0: splicing a root parent(u)
  leaves no internal node); the Core.test B1 lane asserts >= 1 (1 for the fresh
  node + 1 per ancestor + 2 / 3 per single / double rotation).
- A6-4 R-P2 (maintainer ruling, quoted above) -> C-3. The cold R-E4 'pool' throw path sets _fl = NIL, _fb = 0,
  _fdepth = 0 before throwing; the next positional op is a miss, I-9 holds, no stale-path hit once C-4 lands. _fpath
  may stay rewritten. One cold store, no hot cost. Supersedes A6-2's "_fl, _fb and _fdepth unchanged". Engine work
  for rung 4.

OPEN (not folded, maintainer decision pending): none.

### ADDENDUM 7 (2026-10-26) -- rung 4 readings and D6 nits, 0005's own

Tier: DETERMINISTIC (rule wording; no number, no timing). Every item is an orchestrator or reviewer READING, not a
maintainer ruling: the ruling list stays R-D1..R-D4, R-E1..R-E5, R-Q1, R-P1, R-P2 (Status line, unchanged). Each item
names the CURRENT rule(s) it changed; the rule text above is already amended (same edit). The map rows are in the
Source map. No item amends an ADR rule, so the Amends table gains no row.

- A7-1 (rung 4 review reading; touchDu mutant killed) -> C-25. d(v) is the depth of the neighbour leaf v: the main
  descent pushes d(u), the T-6 walk pushes d(v) - d(u) more.
- A7-2 (rung 4 reading) -> C-21, C-43 (M-5). repair takes two (stack, depth) pairs, a shared-prefix count sh and
  the owner view vu; it never writes _len, hdr live or the finger (the caller does). It fits the two-tree seam with
  sh = 0.
- A7-3 (R-Q1 consequence, a reading) -> C-10. At dims > 1 insertAt checks slot 0 in full first, then runs the typeof
  of EVERY slot 1..dims-1 before any range / integer check of those slots (m1 = -1 with m2 = '5' reports "must be a
  number"; m0 = -1 with m1 = '5' reports the range error), token 'measure'.
- A7-4 (D6 r2 nits) -> C-3. The header and the ADDENDUM 6 title say "rung 3-4 rulings", the source-map count
  note says "rung-3/4", and C-3 states that the splitAt / append 'pool' pre-checks fire before any write and change
  nothing (R-E4 consistency).
- A7-5 (cosmetic) -> C-31, C-32. The blank line between A4-12 and A4-13 is gone; the A4-14 clear-gap text lives in C-32
  only and C-31 points to it.

OPEN (not folded, maintainer decision pending): none.

### ADDENDUM 8 (2026-10-26) -- rung 5 rulings R-S1..R-S3 and coder readings, 0005's own

Tier: DETERMINISTIC (a cold guard: a throw on a root / child ref outside the bumps, _len > live, or a walk past the
bumps; no number, no timing). A8-1..A8-3 are maintainer rulings (R-S1, R-S2, R-S3, quoted above); A8-4 is a set of coder
readings, NOT ruled. It amends C-8 and C-10; C-10's exception narrows the ADR ruling R-X5, already pointed to C-10 by
the 0004 A-3 Amends row, so the Amends table gains no row. The map rows are in the Source map.

- A8-1 R-S1 (maintainer ruling, quoted above) = ruled text "Before any write: root ref range-checked against the pool
  bumps; the walk bounded by the pool sizes. A failure throws a plain Error('lite-yggdrasil: clear() corrupt view
  ...'), not a RangeError token (it is not an argument error). Cold path only; hot bodies unchanged." -> C-8, C-10.
  Engine work for rung 5.
- A8-2 R-S2 (maintainer ruling, quoted above) -> C-8. Only the root / _len checks run before any write; a mid-walk
  failure throws AFTER live -= _len and the frees already made (the view keeps _root / _len); the arena is not trusted
  after it. No code change.
- A8-3 R-S3 (maintainer ruling, quoted above) -> C-8. Not detected: a ref inside the bumps that names another view's
  node, a free node or a node shared inside the view (the walk frees it); the test-side walker catches these. No code
  change.
- A8-4 Coder readings, rung 5, NOT ruled -> C-8. EMPTY_ROOT fails the root check; every popped node's child refs are
  range-checked before that node's writes; "pool sizes" is implemented as the bumps (ibump internals / lbump leaves);
  the message prefix is exactly 'lite-yggdrasil: clear() corrupt view: '.

OPEN (not folded, maintainer decision pending): none.

### ADDENDUM 9 (2026-10-26) -- rung 6 ruling R-J1 and review readings, 0005's own

Tier: DETERMINISTIC (exact pull / joinSteps / touches counts, stack sizes; no timing). A9-1 is a maintainer ruling
(R-J1, quoted above); A9-2..A9-8 are rung-6 review readings, each checked against Yggdrasil.js (rung-6 tree, sha256
ee348f22), NOT rulings: the Status line's ruling list gains R-J1 only. Each item names the CURRENT rule(s) it changed;
the rule text above is already amended (same edit). The map rows are in the Source map. No item amends an ADR rule,
so the Amends table gains no row.

- A9-1 R-J1 (maintainer ruling, quoted above) = ruled text "Join pulls = 1 for the fresh internal node + 1 per popped
  join-spine node + 2 per single / 3 per double rotation (the C-20 A6-3 split convention); append's pulls delta = the
  seam repair's C-20 pulls + these; an exact test row pins it. No engine change." -> C-20, C-24.
- A9-2 (review reading, NOT ruled) -> C-21. u, the short seam leaf append repairs, is always a ROOT leaf: a short seam
  leaf exists only in a one-leaf operand (walker I-5 / 0001 T-8).
- A9-3 (review reading, NOT ruled) -> C-3, C-10. The append 'pool' pre-check (R-E4) is evaluated whenever both operands
  are non-empty, even when the seam merge then makes the join the identity; it throws only when the internal free
  list is empty and the internal bump is exhausted.
- A9-4 (review reading, NOT ruled) -> C-23. A join pushes fewer than HL entries; both stacks' H(Lmax) size is, on the
  rung-6 tree, attained through append's SEAM PATHS (A10-10 adds splitAt's descent)
  (jstack = other's first-leaf path, sstack = this's last-leaf path); d == HL == 12 at B = 8 (the jsize / jsizeR rows).
- A9-5 (review reading, NOT ruled) -> C-24. joinSteps is 0 when the two trees are already balanced (the first c,
  b's root unless 3 w(b) < w(a), already passes I-1 against the other root).
- A9-6 (review reading, NOT ruled) -> C-25. On append touches += d_a + d_b once; the d_b descent (other's first
  leaf) pushes nothing, and only a repair re-walks that path into jstack, uncounted.
- A9-7 (review proof, NOT ruled) -> C-42. Join's double rotation never sees a leaf inner node: evidence on the OPEN
  0001 O-1 (RS-8); O-1 stays open.
- A9-8 (a recorded fact) -> C-42. 0001 M-4 "record whether killed": the gamma-inside-join mutant SURVIVES.

OPEN (not folded, maintainer decision pending): none.

### ADDENDUM 10 (2026-10-27) -- rung 7 review readings, 0005's own

Tier: DETERMINISTIC (exact touches / pulls / joinSteps / moves counts, stack sizes, pool frees; no timing).
A10-1..A10-11 are rung-7 review readings, each checked against Yggdrasil.js (cf0b700, sha256 1637bf1a) by function,
NOT rulings and NOT ruled: the Status line's ruling list is unchanged. Each item names the CURRENT rule(s) it
changed; the rule text above is already amended (same edit). The map rows are in the Source map. No item amends an ADR
rule, so the Amends table gains no row. This is not a re-consolidation (the "consolidated through" line
stays at ADDENDUM 9).

- A10-1 (RD-1; review reading, NOT ruled) -> C-25. splitAt (ygSplitSeam): the repair touches are exact, d(c) once plus
  d(w) per repair (dv = the depth of w in the result tree before the repair); C-25's table row stays a bound.
- A10-2 (RD-2; review reading, NOT ruled) -> C-3, C-10. splitAt: the 'pool' pre-check is decided after a
  descent that writes nothing but the arena sstack (scratch: not in the C-27 snapshot, never read before written), so
  C-3's "changes nothing" covers the snapshot and the counters.
- A10-3 (RD-3; review reading, NOT ruled) -> C-21. ygSplitCut: for a mid-leaf cut (p > 0; a boundary cut never
  repairs), rX = (the post-join result root is internal) & (the cut part < m); it reads no weight and no leaf.
- A10-4 (RD-4; review reading, NOT ruled) -> C-15. ygSplitCut / ygRepair: C-15 holds; a boundary cut frees exactly 1
  internal (the identity join's path node), a mid-leaf cut frees 0 and allocates 1 leaf; each repair MERGE also frees
  1 leaf + 1 internal (T-6).
- A10-5 (RD-5; review reading, NOT ruled) -> C-10. splitAt: a non-empty out throws 'operand out must be
  empty' (token 'operand', detail 'out must be empty').
- A10-6 (S3-1; review reading, NOT ruled) -> C-21. ygSplitCut / ygJoin: the T-4 joins run bottom-up, nearest sibling
  first (left := join(left[x], left); right := join(right, right[x])); each popped path node is that join's node via
  ygJoin(v, a, b, u), except a boundary cut's first pop reached from the right (the identity join: x is freed, C-15).
  (C-42 states no join order and is not edited.)
- A10-7 (S3-2, as corrected by the reviewer; review reading, NOT ruled) -> C-20, C-25. With repairs, touches are exact
  (A10-1) and equalize pulls are exact (C-20); only a repair MERGE's pulls / rotations are bounded (its cold rebalance
  may rotate, S3-4).
- A10-8 (S3-3; review reading, NOT ruled) -> C-25. splitAt: a boundary cut's touches = d(c) of the leaf that STARTS at
  i.
- A10-9 (H3; review reading, NOT ruled) -> C-32. test/Witness.test.mjs: 0001 M-2's tuples are leaf counts ((x, y) = a
  node whose children hold x and y leaves); W-INS / W-TIE share the shape and differ in leaf sizes (B = 8: INS full
  leaves -> split, TIE / DEL 2-entry leaves -> merge).
- A10-10 (C-23 / A9-4 scope, HISTORY lesson 13.2; review reading, NOT ruled) -> C-23. splitAt, ygSplitCut, ygJoin: on
  the rung-7 tree sstack's H(Lmax) is ALSO attained by splitAt's descent (d(c) == HL == 12 at B = 8, the sphl R / L
  rows of test/SplitAppendMutants.test.mjs); the HL - 1 sstack mutant is killed by the child timeout (it spins in ygJoin
  on undefined weights (3 * w is NaN) after the dropped ss[HL-1] write). Narrows A9-4's append-only wording.
- A10-11 (review reading, NOT ruled) -> C-25. ASSERTION 1 tail measured: touches 2 (d(c) 1 + d(w) 1), pulls 2,
  joinSteps 0, moves 10.

OPEN (not folded, maintainer decision pending): none.

### ADDENDUM 11 (2026-10-27) -- rung 8 review readings, 0005's own

Tier: DETERMINISTIC (exact hit / miss / touches / pulls counts; the engine-measured figures are counts, not timings).
A11-1..A11-8 are rung-8 (F-R, finger hits) review readings, each checked against Yggdrasil.js (a70c6cb + rung-8 tree,
sha256 43276f1e; review r1 APPROVED, npm test 703/703), NOT rulings and NOT ruled: the Status line's ruling list is
unchanged. Each item names the CURRENT rule(s) it changed; the rule text above is already amended (same edit). The map
rows are in the Source map. No item amends an ADR rule, so the Amends table gains no row. This is not a
re-consolidation (the "consolidated through" line stays at ADDENDUM 9).

- A11-1 (F-R landing; review reading, NOT ruled) -> C-3, C-4, C-26, C-43. The hit test landed: insertAt / removeAt /
  setMeasure / getMeasure / entityAt run it after every C-10 check and before the first write, NIL tested first. A hit
  skips the descent, touches += 0, pulls += _fdepth on a mutation, and rewrites the finger with the same values (ref
  === _fl, at - k === _fb, depth === _fdepth); structural work is on the miss branch only; the tail is
  `touches += depth & (h - 1)` and slot `YG_MISSES - h` += 1 (h = 1 on a hit). The core now reads the finger.
- A11-2 (R8-1; review reading, NOT ruled) -> C-4. Dropping the NIL guard (5 sites) is behaviorally equivalent (an
  undefined load makes the upper-bound compare false); the guard stays as the C-4 text and the C-10 census term; the
  only gate is test/Finger.test.mjs's equivalent-mutant row (identity build, anchor count 5).
- A11-3 (reviewer mutant R6; review reading, NOT ruled) -> C-4. removeAt's `_fdepth === 0 ? 1` is equivalent to
  `? 0` (the n === 1 drain runs first); the rule text keeps `? 1`.
- A11-4 (R8-2; review reading, NOT ruled) -> C-24. The tail's `YG_MISSES - h` depends on fingerHits = slot 8 =
  fingerMisses - 1; test/Counters.test.mjs gates it.
- A11-5 (review check 2; review reading, NOT ruled) -> C-5. An empty view always has fl === NIL, so insertAt's
  empty-root (ygFirstLeaf) check on the miss branch is reached; walker I-9a checks it after every op.
- A11-6 (H2 and reviewer; review reading, NOT ruled) -> C-26. count-lane.mjs engine mode never drops the finger, so
  the finger-off fingerHits delta 0 is gated on the stub only; engine coverage is Finger.test's NIL row (insertAt
  only), the G-B2 engine lanes and A1 (C-34, test:lanes).
- A11-7 (R8-3; review reading, NOT ruled) -> C-34. The coder's golden stream (1e4 draws, 10328 executed at B8 s1)
  gives fingerHits 2062 against the leaf-model 2069; informational, above the 2000 floor; reconcile when A1 lands.
- A11-8 (review reading, NOT ruled; engine, node v26.8.2, untimed, 2026-10-27) -> C-19, C-34. ASSERTION 1: 1e4
  insertAt(length) at B = 16 give fingerHits 9231, fingerMisses 769, splits 768; 200 insertAt(0) at B = 16 give
  fingerHits 184, splits 15, moves 1960 -- equal to C-34 / C-19's figures.

OPEN (not folded, maintainer decision pending): none.

### ADDENDUM 12 (2026-10-27) -- rulings R-C1 / R-B1, G-B2 engine-lane readings and rung 9 (K-R1) readings, 0005's own

Tier: DETERMINISTIC (exact counts; the one PRELIMINARY probe, A12-13, is labelled and gates nothing). Written against
e4b5de5 + the K-R1 tree (Yggdrasil.js sha256 4f1a2e3a; K-R1 review r1 REJECTED test-only (GATE TEETH: no Cursor.test
row covered removeAt's n === 1 drain exit), the one literal round, r2 APPROVED on the fix diff only; live npm test
761/761, node v26.8.2, 2026-10-27; logs .handoff/evidence/k1/unit-npm-test.log, reviewer scratch
.handoff/evidence/k1/review/, G-B2 logs .handoff/evidence/g-b2/0b.log). This addendum holds TWO MAINTAINER RULINGS,
A12-14 = R-C1 and A12-15 = R-B1 (quoted verbatim in the rulings section above; the Status ruling list gains both), and
the readings A12-1..A12-13, which are review readings, NOT ruled. Each item names the CURRENT rule(s) it changed; the
rule text above is already amended (same edit). The map rows are in the Source map. A12-15 amends ADR 0003 O-4 (the
Amends table gains the row 0003 O-4 -> C-42; 0003's own pointer lines are in decisions/0003-counts-gate.md); no other
item amends an ADR rule. This is not a re-consolidation (the "consolidated through" line stays at ADDENDUM 9); it is
DUE: A10, A11 and A12 are past the A9 consolidation, so the next doc unit re-consolidates (no CURRENT edit for that).
ROADMAP Y-13 already rules "none: statistical claims are REPORTED only", so no statistical release gate is owed for
0.1.0.

- A12-1 (review reading, NOT ruled; log .handoff/evidence/g-b2/0b.log) -> C-31, C-42. The engine sweep at B=8 exceeds
  its cap at nominal sizes: CAPS nSweep 9 applies 262145 > 2^18, so 8 (132775 applied); ENGINE nSweep 12 applies
  4194305 > 2^22, so 11 (2116908). Passed as nSweep - 1 in test/EngineLanes.test.mjs / test/engine-lanes.mjs; CAPS /
  ENGINE in exhaustive.mjs unedited (M-6). C-31's "nSweep 7/12" becomes 7/11 on the engine.
- A12-2 (review reading, NOT ruled; same log) -> C-31. Engine reachable counts, B=4 / B=8: bfs states 171 / 186 (CAPS),
  4044 / 4475 (ENGINE); applied bfs 24188 / 58161 (CAPS), 1285558 / 3052009 (ENGINE); deep 4226 / 4222 (CAPS), 21091 /
  21079 (ENGINE).
- A12-3 (review reading, NOT ruled; same log; R-4, B-1b) -> C-31. No failure at n <= 6, so the B-1b row runs in
  test:lanes at bfsLane B=4, nMax 9 (first I-1 balance at n 7, witnessLength 12, op removeAt). The B-1b mutant rotates
  only when the weight imbalance is ALSO an element-count imbalance (both rebalance sites); the element-count-only
  trigger fails I-7 (shared leaf), not I-1.
- A12-4 (review reading, NOT ruled; test/EngineLanes.test.mjs) -> C-32. The must-fail sentence "missing(drop removeAt)
  minus missing(full) = {mergeMoves, equalize4..8}" is stub-relative. On the engine (full = []) the lost set is
  exactly {rotSingle@removeAt, rotDouble@insertAt, rotDouble@removeAt, mergeMoves, equalize4..8} (measured on
  Yggdrasil.js 43276f1e), pinned in EngineLanes.test; rotSingle@insertAt survives the drop on 2 deep-lane hits only
  (bfs 0): a thin margin (reviewer log .handoff/evidence/d12/review/a4.log on 4f1a2e3a: bfs 0 / deep 2 with removeAt
  dropped, deep 5 without the drop).
- A12-5 (review reading, NOT ruled; harness) -> C-29, C-46. Oracle.clear and the stubs return undefined, the engine
  returns this (0004), and exhaustive.mjs compares returns by kind, so an unwrapped engine sweep fails ORACLE at the
  first clear. Both G-B2 files wrap clear as an own property (call the real clear, throw unless it returned the view,
  return undefined (test/engine-lanes.mjs also counts non-empty clears)). Owner of the real fix: the K-R2 M-6 re-pin
  of exhaustive.mjs / oracle.mjs (+ stubs).
- A12-6 (review reading, NOT ruled; corrects A11-6) -> C-26. The exhaustive driver's off run already drops the finger
  before EVERY op and fails 'C-26' on any off-run fingerHits delta, on the engine since Core.test A1; A11-6's "gated
  on the stub only" was true only of the INTERLEAVED drop, now gated on the engine by EngineLanes.test's FO block (1
  op in 4, B 4 / 8 / 16 x seeds 1..3, every positional op x {ok, throw} x {dropped, not}).
- A12-7 (K-R1 landing; review reading, NOT ruled) -> C-6, C-7, C-43. cursor(), the valid / index / entity getters,
  offset(d) / measure(d), seekIndex / seekSum and the `_cv = false` stores in all six mutators (append's other
  included) landed in rung K-R1; next() and the stack writes land in K-R2.
- A12-8 (K1-R1, reviewer ACCEPT; review reading, NOT ruled) -> C-6, C-44. Each view has one more own field `_cur` (the
  cursor object ref, set once in the constructor, never reassigned) after `_cv`; a reference is not cursor state; the
  C-27 snapshot and walker WK_VIEW_FIELDS are unchanged; one hidden class across single and arena views. C-44's field
  order becomes `_root, _len, _fl, _fb, _fdepth, _fpath, _cv, _cur, _n`.
- A12-9 (K1-R2 + K1-R3, reviewer ACCEPT; review reading, NOT ruled) -> C-7, C-46. seekSum writes the indexAtSum rule
  as `if (acc + sl > y) {` and `if (y < acc + m) break;` so Core.test's source anchors stay unique; its end test
  (the in-leaf scan reaching j === len) equals y >= total(d) because sums are exact integers <= 2^53 - 1 (reviewer
  scratch k3, log .handoff/evidence/k1/review/k3.log: 30,960 calls, 2,214 end seeks, 0 mismatches).
- A12-10 (K1-R4 + K1-R5, reviewer ACCEPT; review reading, NOT ruled) -> C-6, C-7. An end seek partly rewrites the
  running offsets while _cv stays false (never observable); the state slot [0] holds the leaf id (not ~id); the
  Int32Array(HL) stack is allocated in K-R1 and written from K-R2; the empty-view `_cv = false` store in each seek is
  a dead write (equivalent mutant).
- A12-11 (H1 readings, reviewer ACCEPT; review reading, NOT ruled) -> C-7, C-10. -0 for d or y acts as 0;
  seekIndex(-0) on an empty view is the end (false), not a throw; seekSum never lands on a zero-measure element
  (strict >, 0002 M-8 / M-7 as 0005 cites it).
- A12-12 (reviewer GATE TEETH finding r1; review reading, NOT ruled) -> C-40. A mutator with more than one exit gets
  one C-40 row and one must-fail mutant per exit: removeAt's n === 1 drain exit (store moved below the drain) is the
  9th Cursor.test mutant (the r1 mutant passed 29/29 before the fix).
- A12-13 (reviewer scratch; review reading, NOT ruled; PRELIMINARY, host load 3.2-4.6, --trace-gc counts, 2^21 ops, 1
  MB semi-space, node v26.8.2, 2026-10-27) -> C-13. seekIndex with measures in [2^30, 2^40]: 0 scavenges; getters 0;
  seekSum with a big fractional y 32 scavenges (about 16 B/op = the one boxed y, b = 1); small y 0. Not a gate (the
  gate is G2 torture, C-38). Re-run: .handoff/evidence/d12/review/run13.log (probe2.mjs).
- A12-14 (RULED, R-C1, maintainer 2026-10-27) -> C-14, C-17, C-42. Quoted verbatim in the rulings section: byte cap
  2^32, no probe. C-17's TASK 0(alloc) probe is dropped; C-14 gains the byte-cap bullet. NOT YET IMPLEMENTED: it lands
  in its own small engine unit before G2 (a coder + Capacity.test rows: the sentinel at the byte cap and cap + 1, and
  a source mutant that drops the byte term). The max-C figures live only inside the quote (the orchestrator's nominal
  estimates); the exact byte formula is computed in the unit's brief.
- A12-15 (RULED, R-B1, maintainer 2026-10-27) -> C-42; amends ADR 0003 O-4. Quoted verbatim in the rulings section: a
  PENDING-bench release ships no benchmark numbers, the README says 'PENDING for <version>' and names the last
  measured release without its numbers. It does not apply to 0.1.0 (Bench-ADOPT follows 0.1.0). The bench rule lives
  in C-42 (no earlier CURRENT rule owned it).

OPEN (not folded, maintainer decision pending): none.

### ADDENDUM 13 (2026-10-27) -- the R-C1 byte-cap unit bc readings, 0005's own

Tier: DETERMINISTIC (exact byte counts from integer arithmetic; no timing). A13-1..A13-5 are readings of the R-C1
byte-cap unit bc, NOT rulings and NOT ruled: R-C1 itself is quoted in the rulings section and unchanged. Written against
cdfe5d4 + the bc tree (Yggdrasil.js sha256 5eb49244, test/Capacity.test.mjs sha256 27c71e2e; bc review APPROVED; npm
test 761 -> 770). Each item names the CURRENT rules it changed; the rule text above is already amended (same edit). The
map rows are in the Source map. No item amends an ADR rule, so the Amends table gains no row. This is not a
re-consolidation (the "consolidated through" line stays at ADDENDUM 12); A13 is past it.

- A13-1 (implements R-C1; reading, NOT ruled) -> C-14. The formula as implemented in ygBytes(C, B, k, dims), with m =
  B/4, Lmax = ceil(C/m) + k, LB = Lmax*B, NI = Lmax - 1, HL = H(Lmax): LB*(4 + 8*dims) + Lmax*(8 + 8*dims) + NI*(20 +
  8*dims) + 20 + 32 + 8*HL + k*(8*HL + 48 + 16 + 8*dims) bytes (ent / meas; llen, lnext / lsum; left, right, weight,
  count, inext / sums; hdr, sx, jstack, sstack; per view _fpath, _n, cursor _st, _stk, _off). Check position: one line
  after the unchanged C cap line, before the allocation marker; message 'arena typed arrays must total <= 2^32 bytes'.
  Plain JS containers (the meas / lsum / sums column arrays, views[], the view objects) are not counted: "every typed
  array" is read fail-closed, counting the per-view arrays x count.
- A13-2 (reading, NOT ruled) -> C-14. The comparison is strict `>`: a total of exactly 2^32 bytes is accepted
  ("exceeds"). Two grid cells land exactly on 2^32 and pin it: B 4, dims 1, count 1 at C* 46,684,415, and B 16, dims 3,
  count 4096 at C* 32,753,864.
- A13-3 (reading, NOT ruled) -> C-14. The byte cap rejects C = 2^28 - m*k for every legal (B, dims, count), so the C cap
  never decides alone: it fires first only for C > 2^28 - m*count (the check-order row), and the C cap keeps ygBytes'
  terms below 2^53 (exact integers). At C = cap the byte cap fires first (C-14's first bullet, the RV-6 row); the A3
  rows are cap + 1 rows and still report the C cap. One token 'capacity' serves both caps, told apart by message ('2^28'
  vs '2^32 bytes').
- A13-4 (reading, NOT ruled) -> C-14. Capacity.test.mjs rows: the largest accepted C, C*, per cell (B {4, 8, 16, 32} x
  dims 1..4 x count {1, 3, 6, 4096}) from the test's own oracle; at C* a recording sentinel (Int32Array / Float64Array
  return zero-length arrays) sees exactly the oracle's bytes; C* + 1 is a RangeError with 0 constructor calls; the plain
  constructor too; the check order; the mutants M1 (byte line dropped), M2 (byte line below the first allocation) and
  M3 (per-view term dropped) each fail; the RV-6 row and the two C-cap mutant controls are retargeted. C* examples
  (exact integer arithmetic, not measurements): 72,796,032 at leafSize 16, dims 1, count 1; 18,199,008 at leafSize 4,
  dims 4, count 1 (the ruling's NOMINAL ~72M / ~18M). npm test 761 -> 770.
- A13-5 (reading, NOT ruled) -> C-17, C-42. R-C1 is implemented; nothing is PENDING. C-17 points to the implemented
  byte cap and C-42's UNVERIFIED list no longer carries it as not yet implemented.

OPEN (not folded, maintainer decision pending): none.

### ADDENDUM 14 (2026-10-27) -- the K-R2 rung (rung 10, cursor next()) readings, 0005's own

Tier: DETERMINISTIC (source anchors, exact call and move counts, sha pins; no timing). A14-1..A14-13 are readings of the
K-R2 rung, NOT rulings and NOT ruled: no maintainer ruling was given in K-R2. Written against 17ffcab + the K-R2 tree
(Yggdrasil.js sha256 287d10c1, test/exhaustive.mjs 6734c7aa; K-R2 review APPROVED; npm test 770 -> 806). Each item
names the CURRENT rules it changed; the rule text above is already amended (same edit). The map rows are in the Source
map. No item amends an ADR rule, so the Amends table gains no row. This is not a re-consolidation (the "consolidated
through" line stays at ADDENDUM 12); A13 and A14 are past it.

- A14-1 (K2-R1, reviewer ACCEPT; reading, NOT ruled) -> C-6, C-7. Each seek stores every internal node of its descent
  in _stk[depth] before descending (the d(t) stores, `// cr:push`, Yggdrasil.js :1961 / :2031); state slot 2 (YG_CLEN
  renamed YG_CDEP) holds the leaf's stack depth; next() reads the leaf length from v._llen[leaf] (valid: every mutator
  clears _cv first; the 8 `// cv:` stores). Shape and ygBytes unchanged (A12-10). Hot cost: one property load and one
  Int32Array read in next(); one Int32Array store per level in each seek. (Yggdrasil.js :69, :1990, :2070, :2081-2097.)
- A14-2 (K2-R2, reviewer ACCEPT; reading, NOT ruled) -> C-7, C-25. The end crossing (off the last element) pushes
  nothing and adds 0 touches; C-25 counts pushes only. _cross sets _cv false and returns false (`// cr:end`, :2131). The
  reviewer killed an endTouches mutant.
- A14-3 (K2-R3, reviewer ACCEPT; reading, NOT ruled) -> C-7, C-25. _cross's lca test is `left[u] === child` (child
  starts as ~leaf, then the popped node); a crossing adds depth - top touches, top = depth(lca) + 1, = d(t') -
  depth(lca) - 1 (`// cr:pop`, :2123).
- A14-4 (K2-R4, reviewer ACCEPT; reading, NOT ruled) -> C-6. next() carries _off before the end check, so off the last
  element _off holds the total while _cv is false: unobservable (offset() is NaN while invalid), the same class as
  A12-10.
- A14-5 (K2-O1, reviewer ACCEPT; reading, NOT ruled) -> C-6. The empty-view `_cv = false` stores in both seeks are kept
  (cold, equivalent today, fail closed).
- A14-6 (byte check form; reading, NOT ruled) -> C-14. Amends A13-2's wording (A13-2 stays). The constructor line is
  now `if (!(ygBytes(C, B, k, dims) <= YG_BYTE_CAP)) ygFail('capacity', ...)` (Yggdrasil.js :184): exactly 2^32 is still
  accepted, a NaN total now throws (fail closed by construction). Capacity.test: A_BYTE follows the new text; a NaN row
  (ygBytes patched to return NaN -> RangeError 'capacity', 0 typed-array calls) fails on 17ffcab (5eb49244); the
  installRecorder points every other typed-array constructor at a throwing sentinel.
- A14-7 (C-29 A12-5 clear-return fix; reading, NOT ruled) -> C-29, C-46. The fix lives in the driver:
  test/exhaustive.mjs exInvoke reads a clear() that returns the view as undefined (oracle and stubs unchanged).
  EngineLanes.test.mjs runs every lane on the unwrapped engineFactory (the G-B2 clear wrapper rows are replaced by two
  clear rows; v.clear() === v is still asserted there); engine-lanes.mjs keeps one counting wrapper with no return
  shim. Gate: on the HEAD driver the unwrapped CAPS sweeps (B 4 / 8) and the clear row fail.
- A14-8 (cursor sweep; reading, NOT ruled) -> C-27, C-31. sweepLane gains option `cursor` (boolean, default false; the
  default report is unchanged); the cursor ops seekIndex / seekSum / next join EX_OPS and EX_NEUTRAL; per state
  seekIndex(i) + next() to false, then seekSum(0, sumBefore(0, i)) + next() to false. Own 2^18 cap. TASK 0(c) at CAPS:
  B 4 nSweep 5: 2872 applied (2390 ops); B 8 nSweep 8: 3988 applied (3522 ops); under the cap, no nSweep reduction.
  test/CursorLane.test.mjs (new, 14 tests): the engine sweep at B 4 / 8, the option rows, a no-patch forwarding control
  and 4 wrapper controls per B (ORACLE offset + 1, ORACLE seekSum y + 1, C-27 a seek writes _fl, C-26 a seek adds a
  miss).
- A14-9 (M-6 re-pin; reading, NOT ruled) -> C-46. Golden (b) (every stub lane at CAPS, frozen HEAD driver against the
  live driver with cursor off) is byte-identical (bfs 7095 / 24532, sweep 40623 / 154475, deep 4226 / 4222);
  Exhaustive.test pin fce39b1a -> 6734c7aa, "re-pinned at K-R2"; CAPS, ENGINE and the exports are unchanged.
- A14-10 (A1 lane; reading, NOT ruled) -> C-34, C-42 (R-E1 pointer only; R-E1 is a ruling, its quote is not edited).
  test/a1-lane.mjs (new) runs C-34 A1 (6 streams, s 1..3 x B 8 / 16) and exports runA1() -> {failures, lines};
  test:lanes SECTION 3 imports it with no try/catch (fail closed). All floors are met, 0 divergences, hits + misses ==
  positional, off-run fingerHits 0. Floors table (deterministic counts): B8 s1 splits 363 merges 518 equalizes 195
  hitAfterStr 182 fingerHits 2062; B8 s2 366/455/198/159/2187; B8 s3 370/482/179/186/2212; B16 s1
  130/273/200/127/2603; B16 s2 148/250/212/113/2663; B16 s3 149/275/200/125/2736 (splitAt+append 324/271/290,
  clearsLive 3/3/2 per seed). B8 s1 fingerHits 2062 = the golden stream's 2062 (A11-7), 7 under the leaf model's 2069.
  Controls: MF-2 and MF-4 (C-35) diverge; all-off misses the fingerHits >= 2000 floor. Finger.test.mjs part 3: a 1500-op
  A1 row (B 8, s 1) in npm test. C-42's UNVERIFIED list drops the C-34 floors on the real engine.
- A14-11 (C-35 / A11-3; reviewer mutant R6; reading, NOT ruled) -> C-35. R6 singleLeafGt0 (`_fdepth === 0 ? 1` -> `? 0`
  in removeAt) is a second EQUIVALENT row beside nilDropped: n === 1 drains before the hit test (Yggdrasil.js :1379).
- A14-12 (anchors; reading, NOT ruled) -> C-46. The cursor anchors are trailing `// cr:<site>` comments, one per site,
  7 in the file: cr:push x2, cr:guard, cr:carry, cr:cross, cr:pop, cr:end (`ck:` collided with jstack: / sstack: /
  check:). Cursor.test MK-1..MK-5 (plus the cr:cross / cr:pop / cr:push mutants) are built on them with buildMutant.
- A14-13 (landing; reading, NOT ruled) -> C-6, C-7, C-43. next() and the stack writes, stated as future ("land in
  K-R2" in 0005 C-6 / C-43, "_stk not written" in the 17ffcab Yggdrasil.js comment :1867), are implemented: C-6, C-7
  and C-43 now state them as landed in K-R2.

OPEN (not folded, maintainer decision pending): none.

### ADDENDUM 15 (2026-10-27) -- the maintainer-audit fix unit AF and rulings R-A1..R-A3, 0005's own

Tier: DETERMINISTIC (source anchors, exact counts, sha pins, mutant and parity results; no timing), except the bytecode
lengths in A15-9, which are REPORTED (node v26.8.2, untimed). A15-1..A15-3 are the maintainer rulings R-A1..R-A3 (quoted
in "Maintainer rulings" above, AskUserQuestion 2026-10-27); A15-4..A15-9 are readings of the AF unit, NOT rulings and
NOT ruled. Written against 390ed2e + the AF tree (Yggdrasil.js sha256 92e67fa0, before 287d10c1; AF review r1 REJECTED
test-only (GATE TEETH: no AF-3 row), helper fix round, r2 APPROVED; npm test 806 -> 831). Each item names the CURRENT
rules it changed; the rule text above is already amended (same edit). The map rows are in the Source map. No item
amends an ADR rule (0003 G-5 / G-6 are applied as written), so the Amends table gains no row. This is not a
re-consolidation (the "consolidated through" line stays at ADDENDUM 12); A13, A14 and A15 are past it.

- A15-1 (R-A1, RULED; F-4b) -> C-13. insertAt's b becomes dims: the big-lane bound is <= 16*dims + 1 B/op, a documented
  limit in README / llms.txt (docs batch, not part of this edit). insertAt leaves C-13's b = 1 list and has its own
  clause. No engine change; G2's big lane gates the amended bound.
- A15-2 (R-A2, RULED; F-3) -> C-10, C-44. A one-time re-tiering deopt on a dims change is recorded as a reading. R-Q1's
  single fused branch and the dims = 1 hot-branch census (15) stand as ruled. No engine change.
- A15-3 (R-A3, RULED; F-7) -> C-25. 'Cold' means a separate source function, not a promise that V8 will not inline it.
  F-7 (SumCursor _cross, 195 B bytecode, inlined into next()) is a REPORTED observation; nothing is gated, nothing
  changes.
- A15-4 (AF-1; F-1a..F-1d; reading, NOT ruled) -> C-8. The clear() guard is one cold function, ygClearCheck, run BEFORE
  BOTH branches (the _len === live ygReset fast path and the k >= 2 walk), before any write: _len a number, an integer,
  0 <= _len <= live; _root an int32 number (no coercion); (_len === 0) === (_root === EMPTY_ROOT); a non-empty root
  inside the bumps. C-8's guard bullet states the checks and the new detail texts (`_len X is not an integer >= 0`,
  `root ref X is not an int32`, `root ref R with _len 0`; the old `_len N > live L` and `root ref R out of range`
  kept). F-1e stays out of scope: duplicate leaf children (a leaf freed twice into a free-list
  self-loop) is NOT detected (R-S3); an internal child equal to its parent throws mid-walk ('more than N internals',
  R-S2) after partial frees. C-8 states both.
- A15-5 (AF-2; F-2; reading, NOT ruled) -> C-24. Every `_n` write is in the 0003 G-5 form (51 sites, aliases
  included). The 0003 G-6 census is gated in npm test (test/CounterCensus.test.mjs: 0 violations, >= 51 G-5 writes,
  must-fail fixtures including `if (this._n[7] > 0)` and a `+=` site); the three allowed non-write sites are the
  constructor, readCounters and resetCounters. Answers and counter values are identical below 2^31.
- A15-6 (AF-3; F-4a; reading, NOT ruled) -> C-44. ygSlots checks sx[1..dims-1] inline (the range, then `m % 1 !== 0`);
  no call carries the double; ygMeasure is removed; messages and tokens unchanged (3.5M seeded Float64 patterns plus
  edges, 0 differences against the old ygMeasure, reviewer). The r1 REJECTED was this item's missing npm-test row; r2's
  rows close the two surviving AF-3 mutants.
- A15-7 (AF-4; F-5; reading, NOT ruled) -> C-10. The lite-law guard form `!(x <= bound)`: the headroom guards
  (insertAt, ygHeadroomIns, setMeasure, ygSetHeadroom, append), the C cap, clear()'s _len and the dims and count guards.
  The hot index / dim guards `((x >>> 0) !== x) | (x > n)` stay (NaN-safe by the uint32 term; reviewer: the remaining
  `>` guards are NaN-safe).
- A15-8 (AF-5; F-6; reading, NOT ruled) -> C-44. _ar no longer holds `views` (never read after arena() returned, and
  it retained every sibling view and cursor). The live ygInit record is C, B, shift, m, dims, Lmax, HL, sx, jstack,
  sstack; arena() builds and returns its own array. The F-6 retention row (lite-leak) is a G2 input.
- A15-9 (AF review and parity; reading, NOT ruled) -> C-13. Review r1: 27 mutants, all AF-1 / AF-2 / AF-4 /
  AF-5 mutants killed, the 2 survivors were the AF-3 rows closed by r2. Parity against 287d10c1: 16 configs x 20000 ops
  (reviewer) and 8 configs x 6000 ops (coder): answers, errors and readCounters byte-identical; golden (a)
  byte-identical. Audit reproduction after AF: F-1a..F-1d, F-2, F-4a, F-5, F-6 no longer reproduce; F-1e, F-3 and F-7
  still do (ruled: R-S2 / R-S3, R-A2, R-A3). Bytecode lengths (REPORTED, node v26.8.2): insertAt 1509 -> 1560, removeAt
  1007 -> 1042, setMeasure 849 -> 877, getMeasure 443 -> 464 (over V8's default 460-byte inline limit; the reviewer:
  not a spec violation, C-13 counts getMeasure b = 1, the Smi lane returns a Smi, 0003 G-7 holds; a G2 input), entityAt
  379 -> 400.

OPEN (not folded, maintainer decision pending): none.


### ADDENDUM 16 (2026-10-27) -- the audit #2 fix unit AF2 and rulings R-A4..R-A6, 0005's own

Tier: DETERMINISTIC (source anchors, exact counts, mutant and revert-check results; no timing), except the bytecode
lengths and the B/op re-measure in A16-4, which are REPORTED (node v26.8.2). A16-1..A16-3 are the maintainer rulings
R-A4..R-A6 (quoted in "Maintainer rulings" above, AskUserQuestion 2026-10-27); A16-4..A16-8 are readings of the AF2
unit, NOT rulings and NOT ruled. Written against 188c4f8 + the AF2 tree (Yggdrasil.js sha256 8052b70f, before 92e67fa0;
engine reviewed clean, a test-only fix round followed; npm test 831 -> 838). Each item names the CURRENT rules it
changed; the rule text above is already amended (same edit). The map rows are in the Source map. No item amends an ADR
rule (0003 G-5 / G-6 are applied as written), so the Amends table gains no row. This is not a re-consolidation (the
"consolidated through" line stays at ADDENDUM 12); A13..A16 are past it.

- A16-1 (R-A4, RULED; pass 2 F4) -> C-3, C-6, C-40. C-3's R-E4 'pool' exemption also covers the cursor: the throw may
  leave cursor() invalid (_cv = false), the fail-safe outcome, like the finger. No engine change. Audit reproduction
  (audit/2026-10-27/reproduction.js "[Finding 4]"): after insertAt threw RangeError 'pool', cursor().valid was false
  (index -1, entity -1, offset / measure NaN). C-6 and C-40 each carried a sentence that a RangeError mutation leaves
  _cv unchanged; both now point at the exemption.
- A16-2 (R-A5, RULED; CL-2, AF2-4) -> C-24. COUNTERS is a read-only binding: after the class body,
  Object.defineProperty(SumSequence, 'COUNTERS', { writable: false, configurable: false }); the object stays frozen,
  enumerable unchanged, a strict-mode assignment throws TypeError. Gated by a descriptor row in
  test/AuditFixes2.test.mjs (fails on 92e67fa0).
- A16-3 (R-A6, RULED; pass 2 F1a, F1c) -> C-8. Not detected: a forged _len inside [0, live] on a valid root is beyond
  the guard (R-S3 class). clear() stays O(1) when the view holds every live element. Pass 2 F1c is NOT a defect: the
  fast path is correct when the view truly holds every live element.
- A16-4 (AF2-1; CL-1 = pass 2 F2; reading, NOT ruled) -> C-13, C-24. getMeasure hoists the misses slot (`const j =
  YG_MISSES - h; cn[j] = (cn[j] + 1) | 0;`), still the 0003 G-5 form; bytecode 464 -> 455 B (under V8's 460-byte inline
  limit, 5 B headroom); entityAt 400, indexAtSum 420, sumBefore 422 unchanged. Gated: bytecode-length pins (< 460, child
  with timeout, fail closed). The G-6 census still reads 51 G-5 writes, 0 violations (reviewer, base and head).
  Re-measure (REPORTED, 92e67fa0 -> 8052b70f, details in C-13): getMeasure 16 -> 0, cursor measure 16 -> 0, cursor
  offset 0 -> 0 (it did NOT box on the before build in this probe; the audit's 16.21 came from another harness), total
  0 -> 0. Torture big lanes after: big.getMeasure / big.offset / big.measure 0 B/op (bound stays 16*b + 1, b = 1).
- A16-5 (AF2-2; pass 2 F3; reading, NOT ruled) -> C-13. SumCursor offset(d) / measure(d) return `0 / 0` instead of the
  global NaN on the invalid branch; results unchanged (NaN while invalid). Bytecode: `LdaGlobal [NaN]` ->
  `LdaConstant <HeapNumber nan>`; why that removes the box was not isolated (a reading of the bytecode and the
  re-measure, not a proven cause). The 0 B/op claim is G2 B4's torture lane, not gated at 0 yet: the global-NaN mutants
  survive every npm-test row (expected).
- A16-6 (AF2-3; CL-4; reading, NOT ruled) -> C-10. readCounters guard `!(out.length >= YG_NC)` (NaN-closed; same
  'counters' token and text). A forged NaN or undefined length now throws RangeError 'counters' (the old build threw a
  TypeError from set (the test's Object.create forgery; a real Int32Array with an own length forged to NaN copied
  without throwing)). Yggdrasil.d.ts readCounters documents the throw (CL-3).
- A16-7 (CL-5; reading, NOT ruled) -> C-44. The AF-3 gate (A15-6) is keyed on call shape: inside ygSlots every `yg\w+(`
  call is `ygFail(`, plus the kept `(sx[` and ygMeasure checks, with in-test must-fail controls. The review r1 test-only
  REJECTED was a survivor `chk(sx[d])`, fixed in the helper round.
- A16-8 (AF2 review and revert-check; reading, NOT ruled) -> C-13. Revert-check on 92e67fa0: the getMeasure pin, the
  COUNTERS descriptor and the readCounters NaN row FAIL; PIN rows pass. Review r1 (review/mutants.log): 10 mutants
  (hoist undone,
  descriptor variants, `<` restored, ygChk added, bytecode child silent / hung / no-print, measure returns 0) killed;
  the `chk(sx[d])` mutant (m4b) survived r1 and is killed in r2 (r2/m4b.tap, 1 fail); the global-NaN mutants survive
  every row (A16-5). npm test 831 -> 838.

OPEN (not folded, maintainer decision pending): none.
