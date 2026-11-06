# lite-yggdrasil -- the consolidated ledger

*Every design declined, every defect caught (in the spec, in a gate, in a doc, in an audit, in CI), every run that
decided nothing, and the laws each one produced. This is the evidence base the roadmap builds on: it is why a gate
here has teeth and a number here has a tier. Nothing here is re-litigated without a **new mechanism** clearing
**every** gate.*

Numbering note: entries are numbered #1.. in file order, grouped by family: A #1-#10, B #11-#31, C #32-#35,
D #36-#39, E #40-#45, F #46-#54. No id is reserved or unassigned. Design-bug ids (B-n), audit ids (AF-n / AF2-n /
AF3-n), census rows (C-1..C-5), ruling ids (R-..., Y-...) and burst numbers are the repo's own and are quoted as the
source gives them. Status words are the source's: OPEN / RULED / CLOSED / SUPERSEDED; "Declined" is RESEARCH.md's
word for a rejected design. Commits are the short hashes `git log --oneline` prints on main; "sha256/8" is the first 8
hex digits of the file's sha256. Tier words: DETERMINISTIC / STATISTICAL / REPORTED / PRELIMINARY / nominal, as the
source states them; an entry whose source states none says "tier: none stated -- unproven". Local measured rows ran on node v26.8.2 (the g2b-3b rows on an Apple M4 Pro, RESEARCH.md:1286-1287); CI rows name their own node.

---

## The laws that fell out (read this first)

Every entry below collapses into a dozen rules. The rules are the payoff; the entries are the proof.

1. **A control that cannot fail is not a control.** Run every control against the correct code (must pass) AND its
   mutant (must fail), in the session that writes it. The controls and witnesses of B-14, B-15 (the Adams mutant), B-20 and B-29 were vacuous before
   anyone ran them; later reviews found the same class in tests. *(#13, #16, #18)*
2. **A bug class seen twice becomes a standing gate.** The finger bugs B-3 and B-17 became "finger on == finger off,
   identical answers and identical walker state" for every op stream. *(#12)*
3. **A guard with N terms needs a row per term on its own, and a gate needs a mutant per rule.** Test-only reviews
   rejected for surviving mutants again and again; the count is in the entries. *(#16, #17, #18)*
4. **Bytes in a hot body decide inlining, and the limit is pinned.** V8's single-inline limit is 460 bytecode bytes;
   getMeasure at 464 B boxed on the big lane, at 455 B it did not. The pin is a DETERMINISTIC test, not a timing.
   *(#23, #26, #33)*
5. **NaN fails closed by construction.** `!(x <= bound)`, never `x > bound`; every upper-bound guard, counters
   written in the G-5 form `(n + x) | 0`. *(#21, #22, #26)*
6. **A zero-box entry is not a zero-box path, and the Smi top depends on the V8 build.** Keys at or above 2^31 box
   on a returned path on this Node build; entity and key arguments are validated at the door. *(#14, #22, #39)*
7. **An allocation gate must model the JIT.** Per-call windows need K = 16 calls, TurboFan must install synchronously,
   rare paths must be warmed past tier-up, and no forced gc() may sit between fill and lane. *(#38, #46, #47, #48, #49)*
8. **Gate the region you mean, and count what the child compiles.** The G2 whole-window major=1 was an idle-scheduled major (3 runs); a third
   compiled BlockedArray module in one child read major 1 (3 / 3). *(#28, #50)*
9. **A PRELIMINARY or INCONCLUSIVE reading decides nothing, a one-run REPORTED reading is evidence for a ruling, never a verdict, and an INCONCLUSIVE run of record is archived, not
   committed.** Verdict rules are tested against an A/A pair first. *(#32, #33, #52, #53, #54)*
10. **Reasoning is not measurement; say which one you did.** Most declined designs here are reasoning-only, and the
    ledger says so. *(#1 .. #8, #10)*
11. **Documents are code: a false claim is a defect.** Review caught false doc claims in at least five doc units (#31); a rule
    that lives only in an old ADR is missed by the next rung. *(#21, #31, #43, #44)*
12. **"Not exported" is not "unreachable", and a CI matrix is a census, not a verdict.** A private class is reachable
    through `.constructor`; each off-baseline red row is classified from ALL its lanes and ruled on its own. *(#25,
    #27, #29, #30, #42)*

---

## A. Rejected designs and optimisations

All entries in this family are RESEARCH.md section 7 "Declined" items unless the entry says otherwise. Unless an
entry states a measurement, the rejection is **reasoning, not measured**.

### #1 -- Per-view arena ownership bitsets *(Declined)*
- **Tried / found:** per-view OWNERSHIP bitsets so a view knows its leaves (RESEARCH.md:363-369).
- **Mechanism:** after splitAt every right-side leaf changes owner, so maintaining the masks makes splitAt / append
  O(leaves moved) -- it breaks ADR 0004 A-4 (the O(log n) headline). The B-18 problem it was meant to fix is solved
  by no epoch plus a NIL finger at clear() (0005 C-5, C-6).
- **Evidence:** reasoning, not measured.
- **Law:** a structure whose point is O(log n) split cannot carry per-element ownership.

### #2 -- Prefix bit-directory top-level router "Canopy" *(Declined)*
- **Tried / found:** shard the key space into up to 65,536 sub-trees behind a bit directory (RESEARCH.md:358-362).
- **Mechanism:** every summary op (sumBelow / keyAtSum / rank / select) then needs a Fenwick over the buckets, and
  splitAt / join become O(buckets). The lookup-aid variant is a separate item (R-9).
- **Evidence:** reasoning, not measured. B-32 (RESEARCH section 6) came from an external review of a Canopy blueprint.
- **Law:** none.

### #3 -- SWAR key signatures; a user-callback monoid in the pull loop *(Declined)*
- **Tried / found:** packed-signature leaves; a user callback as the summary.
- **Mechanism:** SWAR helps equality only, not ordered seek, and BigInt64Array lanes allocate; a polymorphic call
  site in the pull loop deopts, so only fixed kinds are offered (RESEARCH.md:356-357).
- **Evidence:** stated in the source, not measured here (tier: none stated -- unproven).
- **Law:** none.

### #4 -- Per-leaf positive-measure mask *(Declined, reopen only for a consumer)*
- **Tried / found:** a mask to skip zero-height rows inside a leaf (RESEARCH.md:370-374).
- **Mechanism:** the strict seek already skips zero measures; inside <= B slots the saving is "expected to be small
  (unmeasured)" and the mask is one more column every insert / remove / split / merge must shift.
- **Evidence:** expected (unmeasured). Reopen only for a consumer that needs "next visible row" iteration.
- **Law:** none.

### #5 -- "Sticky finger" that skips the fence check *(Declined)*
- **Tried / found:** after a sequential call, skip the finger's range test (RESEARCH.md:381-383).
- **Mechanism:** the fence check is exactly what B-3 and B-17 are about (a class seen twice, #12); the saving is
  "nominal: one or two compares" and the hit count is unchanged. Sequential walks use the cursor (Y-11).
- **Evidence:** nominal; reasoning, not measured.
- **Law:** see #12.

### #6 -- Zero-copy `subarray()` leaf view *(Declined)*
- **Tried / found:** hand the caller a view of a leaf range (RESEARCH.md:384-386).
- **Mechanism:** `subarray()` allocates per call and exposes writable engine storage -- one write breaks every cached
  sum (fail open). The candidate instead is a copy-out read into caller typed arrays, O(log n + k) expected, 0 B.
- **Evidence:** reasoning, not measured.
- **Law:** never hand out writable engine storage.

### #7 -- Rest-parameter insert for dims > 1; a construction `profile` preset *(Declined)*
- **Tried / found:** `insertAt(i, e, ...m)`; a string preset ("virtual-list", "editor") (RESEARCH.md:387-392).
- **Mechanism:** a rest array allocates per call (ROADMAP 3.6: 0 B/op on insertAt); the chosen form is fixed positional
  `insertAt(i, e, m0, m1?, m2?, m3?)`, dims <= 4 (B-24, 0005 C-10). A preset could bundle only B and dims and hides
  parameters from README examples.
- **Evidence:** reasoning, not measured.
- **Law:** none.

### #8 -- Capacity ceiling 2^26 to stay in Smi range *(Declined)*
- **Tried / found:** cap the capacity so height + spine + counters stay Smi (RESEARCH.md:393-395).
- **Mechanism:** counters are Int32 that wrap by design (ADR 0003 G-5) and height <= H(2^29) = 67; the binding limits
  are indices and the count column (B-28; caps = 0005 C-14).
- **Evidence:** reasoning, not measured.
- **Law:** none beyond the G-5 form (#21).

### #9 -- Invariant I-3 "as written" *(REJECTED in ADR 0002)*
- **Tried / found:** bound sum of measures per seekable and non-seekable dim as first drafted.
- **Mechanism:** counterexample on a non-seekable dim `[2^53-1, 2, -(2^53-1)]`, total 2: one leaf gives
  `(a+2)+c = 1`, a two-leaf shape gives 2, so total(d) is shape-dependent and the bound check reads a rounded root.
  Option (a) "all SUM >= 0" was CHOSEN (0 B, the sign test is the existing range compare); option (b)
  `sum(abs m) <= MAX` is sound but needs an abs column or a drifting scalar and is parked as O-2.
- **Evidence:** worked arithmetic in decisions/0002-measures.md:89-91 (tier: none stated).
- **Law:** bounds are stated per dimension TOTAL and per partial sum, not per measure (see #14).

### #10 -- Arena options (a'), (b), (c2) for splitAt / append *(rejected in ADR 0004)*
- **Tried / found:** an exported `SumArena`; a per-instance arena; Treap-style returned views.
- **Mechanism:** (a') adds an export and a polymorphic first argument; (b) breaks O(log n) "a silent cross-arena copy is a
  hidden O(n) cliff"; (c2) returns views per call, "UNBOUNDED -> fixed arena unsizable". ADOPTED: (a) shared arena,
  setup views. Derived from B-9 (a moved block between independent typed-array arenas is O(moved)).
- **Evidence:** decisions/0004-arena-ownership.md:123-132 option table; reasoning, not measured.
- **Law:** a consumer-first spike (DB-11) before fixing the API shape.

---

## B. Regressions and bugs found and fixed

The design-bug rows come from RESEARCH.md section 6 (the draft spec, before code). The rest are defects in gates,
engine code, CI and docs, each with its fix commit.

### #11 -- B-1 balance weight over variable-size leaves *(caught before code)*
- **Tried / found:** weight = element count + 1 over variable-size leaf runs: sibling leaves of 4 and 16 elements
  violate 3*5 >= 17 and no rotation can repair two leaves (RESEARCH.md:257).
- **Mechanism:** the cited proof assumes uniform external weight 1; a representation change broke its assumption.
  Fix: weight = leaf count (Y-01); the element-count mutant fails. B-14 then corrected the ROADMAP: at B = 4 those
  leaves weigh 2 vs 5 (balanced), the unfixable pair exists only at B = 16 (5 vs 17).
- **Evidence:** RESEARCH.md section 6 (B-1, B-14), confirmed "by node arithmetic" (tier: none stated).
- **Law:** citing a verified result is not verifying OUR structure; list the proof's assumptions and check each one.

### #12 -- Finger-class bugs B-3 and B-17 *(CLOSED 0005 C-1..C-5; c DEFERRED to SumMap)*
- **Tried / found:** B-3 finger tested on the leaf's contents (every sorted append misses); B-17 (a) an ordinary miss
  does not move the finger and no epoch bump follows, so a stale base returns a wrong row (B = 8, 9 rows,
  setMeasure(0), indexAtSum(75) -> 7, true 5), (b) draining the last element frees the leaf on a "hit", (c) equalize
  leaves a stale keyed fence.
- **Mechanism:** the finger caches positional state that a mutation path can leave stale.
- **Evidence:** RESEARCH.md section 6 (B-3, B-17 rows) and its "Standing rules from repeated classes" paragraph.
- **Law:** **standing gate** -- every op stream runs with the finger enabled and disabled and must give identical
  answers and identical walker state (walker state = 0005 C-27). SumMap's rule R-SM4 extends it.

### #13 -- Controls that cannot fail: B-14, B-15, B-20, B-29 *(B-20 CLOSED 0005 C-36, B-29 CLOSED 0005 C-23; B-14, B-15 no status word in the source)*
- **Tried / found:** B-15 the Adams size-only-weight mutant is EQUIVALENT on I-1 shapes (3(wl-1) >= wr-1 implies
  3wl >= wr), so it cannot witness deletion; B-20 ADR 0004 assertion-1 control can never fail (views 1365/1365/1366
  make <= 1023 leaves, not 1026; the proposed 1/1/4094 also peaks at 1023; control = C-36); B-29 ADR 0003 G-13 can
  never fail (stack size = H(Lmax) by T-10).
- **Mechanism:** nobody had executed the control against a mutant. Replaced by three witnesses W-DEL / W-INS / W-TIE
  (decisions/0001-trunk.md:182-189).
- **Evidence:** RESEARCH.md section 6 (B-14, B-15, B-20, B-29, B-30, standing rules); tier: none stated.
- **Law:** every control runs against correct code AND its mutant in the session that writes it (DB-8); B-30:
  "a gate with no subject cannot fail" -- scripts land with their subject.

### #14 -- Boundary-class bugs: B-5, B-12, B-18, B-22, B-23, B-28 *(B-18 CLOSED 0005 C-6, B-22 C-9, B-28 C-14; B-23 DEFERRED SumMap; B-5, B-12 no status word)*
- **Tried / found:** B-5 float-to-uint helper (-0 / +0 two keys, NaN unspecified, every positive float above 2^31 =
  the boxing lane); B-12 an internal partial sum can exceed 2^53 while the total does not; B-18 epoch wrap (Int32 epoch
  re-matches after 2^32 bumps; a plain field leaves Smi after 2^30); B-22 the entity argument unvalidated
  (undefined -> 0, 2^31 -> -2^31, 1.5 -> 1: fail open); B-23 I-7 contradicts SumMap's uint32 key column; B-28 no
  MAX_CAPACITY (Int32 count overflows near 2^31).
- **Mechanism:** specs bounded totals, not arguments, partial sums or counters.
- **Evidence:** RESEARCH.md section 6 (the B-n rows named; tier: none stated).
- **Law:** a boundary catalogue (DB-7) covers every argument, partial sums, and counters at 2^30 / 2^31 / 2^32.
  Fix-direction for keys: R-SM2 Int32Array + xor-bias (see #39).

### #15 -- Unverified prose and counts: B-8, B-11, B-16, B-19 *(B-19 CLOSED 0005 C-19; B-8, B-11, B-16 no status word)*
- **Tried / found:** B-8 "sub-nanosecond" and "copyWithin compiles to memmove" with no run; B-16 ROADMAP "<= 15 leaf
  moves" is false (an interior split at p = 1 writes 16 at B = 16); B-19 "prepends mirror" is false for moves (B = 16,
  200 prepends: 1960 moves vs formula 45, 0005 C-19); B-11 where the 17th element goes was unspecified.
- **Mechanism:** formulas written before the edge stream was simulated.
- **Evidence:** RESEARCH.md section 6 (B-8, B-11, B-16, B-19 rows; tier: none stated).
- **Law:** count-first claims (DB-9): derive the formula by simulating the stream before writing it; every number
  needs a run log or an "expected" label (DB-10).

### #16 -- Bench-ADOPT burst 29 B2: fail-open validators *(fixed r2)*
- **Tried / found:** review r1 REJECTED with 4 blockers: Fenwick Float64 counters wrapped through Int32Array;
  validateCounts / validateScenario fail open (-5, undeclared extras, prototype build, Symbol keys); kernel-lane pass
  rule duplicated with no proof of work; retention blind to a live view; D1 bound only hit rows.
- **Mechanism:** validators accepted shapes they did not name.
- **Evidence:** .handoff/archive/HISTORY-15-29.md:11-15 (r2 APPROVED: Float64 read path, validators closed, work > 0
  checks, WeakRef alive gate).
- **Law:** a gate that cannot refuse a bad input is open; every validator gets a refusal row (see #18).

### #17 -- g2b-3a publishGuard and `--picks` fail-open rows *(B2 fixed r2; B3 r2 REJECTED, fixed r3)*
- **Tried / found:** B3 r1 FAIL-OPEN: A/B rows print bare verdicts under INCONCLUSIVE; publishGuard never checks
  `--runs K` (a 1-pass sweep could write chunkcap.json); a QUIET payload accepts a PRELIMINARY picks table. B2 r1
  FAIL-OPEN: `--picks` ignored and `--sweep --publish` overwrites results.json. Earlier, Bench-ADOPT g1 B3 (burst 30): timed-row values unchecked,
  `--quick` labelled QUIET, `--publish` without quiet-lock.
- **Mechanism:** the publish path trusted its inputs; the statistics were not tied to their K.
- **Evidence:** .handoff/HISTORY.md:152-158, :172-175, :272-277; fix commit 5fcd156 (publishGuard, chunkCap pick
  table). The B3 r2 review (HISTORY.md:133-134): runs / runCount refusals tested only below K, so "< K" mutants survived.
- **Law:** a publish path refuses PRELIMINARY, wrong-K and un-quiet input; the verdict carries its tier.

### #18 -- GATE TEETH rejects: tests that stayed green on a mutant *(fixed in each round)*
- **Tried / found:** review rejected test-only diffs on surviving mutants: AF3 mutants g / h (the burst's npm test grew 838 -> 856),
  AF2 CL-5 rewrite dropped the `(sx[` assertion (m4b `chk(sx[d])` survived), G2 MF-5 control did not require
  finalization (mutant H2 survived), AF no AF-3 row (both AF-3 mutants survived), 9 survivors on an early S0-14
  review, and 28 of 42 driver mutants survived 41 green tests (exhaustive.mjs, commit b522427; after the fix 16 of the
  28 are caught, 12 equivalent / engine-time, 0005 A4-14).
- **Mechanism:** a row existed but did not pin the term it claimed.
- **Evidence:** .handoff/archive/HISTORY-15-29.md:72-74, :119-121, :159-160, :185-186; .handoff/archive/HISTORY-S0-14.md:
  145-146, :200-202; also "a guard with N terms needs a row per term ON ITS OWN" (HISTORY-S0-14.md:19-24).
- **Law:** reviewer mutants (>= 1 per fix) are part of every test unit; brief helpers with "each conjunct alone
  flips the result".

### #19 -- g2b-1 B1 / B2 (Scenarios) review findings *(fixed r2 / r3)*
- **Tried / found:** `params.chunkCap` shared mutable, last-writer-wins (B1 r1); reweight checksum always 0 (fix: a cold endState
  in crossCheck), then endState probes counted into the phase counts (B2 r1, r2).
- **Mechanism:** a check ran on state that was not the state under test.
- **Evidence:** .handoff/HISTORY.md:229-236; r3 was a literal 1-line move; counts matched the pre-endState run in
  60 / 60 rows (HISTORY).
- **Law:** none beyond #18.

### #20 -- AF-1: clear() fast path skipped the root and _len checks *(fixed 4363754)*
- **Tried / found:** audit #1 F-1a..F-1d: the `_len === live` ygReset fast path skipped the root / _len checks that
  R-S1 puts before any write; `~ref` coerced an unvalidated JS root (-Infinity, null, false, "", "-1" passed);
  `len > live` passed NaN and negative _len.
- **Mechanism:** a check ordered after the branch that needed it, and ToInt32 coercion of unvalidated input.
- **Evidence:** .handoff/AUDIT-2026-10-27-TRIAGE.md:5 ("11/11 reproduced, exit 0", node v26.8.2, load1 2.9, untimed;
  PRELIMINARY host); pins in test/AuditFixes.test.mjs; fix `4363754`, Yggdrasil.js sha256/8 92e67fa0 (git show
  4363754:Yggdrasil.js; the before-build was 287d10c1 per TRIAGE:4). Review r1 REJECTED on GATE TEETH (#18), r2 APPROVED.
- **Law:** validate before either branch; hot bodies unchanged (cold fix).

### #21 -- AF-2: 51 counter writes not in the G-5 form, no G-6 census *(fixed 4363754)*
- **Tried / found:** audit F-2: 51 `+=` counter sites, 0 in the G-5 form `n[K] = (n[K] + x) | 0`, and no census gate
  for ADR 0003 G-6 existed. TRIAGE: "A missed gate in every rung".
- **Mechanism:** the rule lived in ADR 0003 (R-Y09 "Rule ADR 0003 as written"); 0005 never superseded it, but no rung's
  planner folded it into the engine spec.
- **Evidence:** TRIAGE rows F-2 / AF-2; test/CounterCensus.test.mjs (added in 4363754): census floor 51 plus a
  catch-all `_n` rule (.handoff/archive/HISTORY-15-29.md:186-187), wrap row at 0x7FFFFFFF -> -2^31.
- **Law:** sweep binding laws from older ADRs into CURRENT per fix (see #43); G-6 is now gated.

### #22 -- AF-3, AF-4, AF-5: ygSlots boxing path, NaN-open guards, retained views *(fixed 4363754)*
- **Tried / found:** F-4a ygSlots passed `sx[d]` across a call to ygMeasure (box when not inlined); F-5 seven
  `x > bound` guards let NaN through; F-6 `_ar.views` retained every sibling view and cursor.
- **Mechanism:** a Float64 crossed a non-inlined call; wrong comparison polarity; a never-read array held all siblings.
- **Evidence:** TRIAGE rows AF-3 / AF-4 / AF-5; retention gate after fix: F-6 0/7 alive, 7/7 alive on 287d10c1
  (.handoff/archive/HISTORY-15-29.md:150-153, G2 torture). Pins test/AuditFixes.test.mjs.
- **Law:** `!(x <= bound)`, never `x > bound`; a value stays in a typed-array slot end to end.

### #23 -- AF2-1: getMeasure past V8's 460-byte inline limit *(fixed 732c599)*
- **Tried / found:** audit #2 CL-1 / pass 2 F2: getMeasure bytecode 464 B was not inlined, so the big lane boxed.
  Fix: hoist `const j = YG_MISSES - h`, giving 455 B (still in the G-5 form).
- **Mechanism:** a hot function over the single-inline limit loses TurboFan inlining; the box returns.
- **Evidence:** TRIAGE:84-85 ("454 B -> inlined, big lane 16.21 -> 0.21 B/op (same engine A/B)"; pass 2 reading, tier: none stated); .handoff/archive/HISTORY-15-29.md:117-119
  (464 -> 455); pin test/AuditFixes2.test.mjs:48 (bytecode < LIMIT); Yggdrasil.js 92e67fa0 -> 8052b70f (732c599).
  The re-measure TRIAGE:98-100 marks PENDING; it RAN, tier REPORTED (0005:626-629: "Re-measure (REPORTED, ... 24 runs): getMeasure 16 -> 0, cursor measure 16 -> 0, cursor offset 0 -> 0, total 0 -> 0"). 10 mutants killed.
- **Law:** pin the bytecode length of every inline-critical function; any edit needs headroom (5 B at 455).

### #24 -- AF2-2, AF2-3, AF2-4: cursor NaN, readCounters length, COUNTERS binding *(fixed 732c599)*
- **Tried / found:** SumCursor offset(d) / measure(d) returned the global NaN on the invalid branch (boxes), now a
  constant `0 / 0`; readCounters `!(out.length >= YG_NC)`; COUNTERS defined writable: false, configurable: false
  (R-A5, "Lock the binding").
- **Mechanism:** cold-looking branches that reached the boxing lane; a writable public constant.
- **Evidence:** TRIAGE:62-98 (6/6 reproduce, exit 0, orchestrator); pins test/AuditFixes2.test.mjs (descriptor, NaN
  length rows).
- **Law:** none beyond #22.

### #25 -- AF3-1: cursor constructor reachable through `.constructor` *(fixed c765920; severity S3)*
- **Tried / found:** audit #3 F1: `new (v.cursor().constructor)(v, {HL, dims})` builds a second cursor sharing the
  view's `_cv` (reads another view's leaf, revives a stale cursor). Severity corrected from S2 to S3 (R-S3 class: needs
  a hand-made arena descriptor).
- **Mechanism:** "not exported" never meant "unreachable". R-A7: a module-private key as a third constructor argument;
  cold, hot bodies unchanged. Maintainer, verbatim: "I am taking your recommendation, put a tiny guard, I want to
  learn how to prevent in the future" (TRIAGE, R-A7 re-checked).
- **Evidence:** TRIAGE audit #3 (5/5 reproduce, exit 0, node v26.8.2, load1 1.92, untimed); test/AuditFixes3.test.mjs:
  45-99; Yggdrasil.js sha256/8 ab2090ca at c765920 (computed here by `git show c765920:Yggdrasil.js`).
- **Law:** key-guard the ctor of every internal class that instances can leak.

### #26 -- AF3-2, AF3-3: hostile `out`, and 16 index / dim guards *(fixed c765920)*
- **Tried / found:** F3 readCounters with a forged-prototype object, a shadowed `length` or a `valueOf` spy (wrong error class, valueOf called); F2 exactly 16
  `i > n` / `d >= dims` throw-guards. R-A8: brand via the cached %TypedArray%.prototype toStringTag getter plus the true
  length, RangeError 'counters', no user code runs. R-A9 "Convert all 16" to the NaN-closed form. R-A11: `out.set` stays.
- **Mechanism:** hostile arguments, and lite-law's "never `x >= bound`" applied to throw guards too.
- **Evidence:** TRIAGE audit #3 table and R-A8..R-A11; pins test/AuditFixes3.test.mjs (:344 skips when the frozen
  before-build is absent = the "1 skip" in census.md), test/SplitAppendMutants.test.mjs:57 (ms10 anchor). getMeasure
  455 -> 457 B, all pins < 460 (.handoff/archive/HISTORY-15-29.md:70). Review r1: 13 mutants, g / h survived -> r2 APPROVED.
- **Law:** a census row forbids `x > bound` / `x >= bound` throw-guards.

### #27 -- CI census C-1: node 22.23.4 alloc meter *(CLOSED by Y-CI-6a, b76f3cc)*
- **Tried / found:** the first hosted run (push 42072811093) failed on node 22.23.4: 4 alloc children; only the rival
  BlockedArray edit lanes allocated (S2 316-320.5 B per 2,000-op call, S1b 365 B per call, expected < 8); later lanes
  read negative. Y-CI-6 (skip rival rows) was SUPERSEDED by Y-CI-6a: "its premise, only rival rows fail on node 22, was
  false". Y-CI-6a: on node < 24 B/op lanes and must-fail control rows are PRINTED, not asserted.
- **Mechanism:** the meter itself is uncalibrated below node 24 (later lanes -55 / -880, a must-fail control -648).
- **Evidence:** .handoff/evidence/b42-ci/census.md (check 2, red rows; later push run 42101258088 SUCCESS, 8 of 8 legs,
  node 22 legs "11 REPORTED lines"); test/meter-gate.mjs METER_REASON and test/MeterGate.test.mjs (b76f3cc);
  ROADMAP Y-CI-6 / Y-CI-6a rows (Y-CI-6 SUPERSEDED by Y-CI-6a, ROADMAP.md:139; Y-CI-6a RULED 2026-11-05, burst 44). Deterministic tier only, no timing read on CI.
- **Law:** a version-conditional meter is REPORTED below its calibrated floor; lane counts, gc major 0 and retention
  stay gated everywhere.

### #28 -- CI census C-2: A5 alloc child major GC (module count) *(CLOSED by Y-CI-7a, b76f3cc)*
- **Tried / found:** on node 26.13.0 ubuntu the EditorFeed A5 child read gc major 1 (lanes 0 B/op). First fix Y-CI-7
  ("no alloc child compiles more than 2 BlockedArray variants") was SUPERSEDED by Y-CI-7a ("more than 2" imprecise):
  one child per BlockedArray variant; maxMajor 0 kept.
- **Mechanism:** the twin-work probe (HISTORY.md:171-173): a third compiled BlockedArray module in one child read gc major 1
  (3 / 3), a heap-size effect, not twin-specific -> PRE_TWIN split (npm test 329 s -> 182 s). C-2's PRE_TWIN child already
  compiled only 2 variants (census.md:89-90), hence Y-CI-7a's one variant per child; C-2's cause is not measured.
- **Evidence:** census.md C-2; HISTORY.md:170-173; pin test/EditorFeed.test.mjs:1034 ("three lane children cover the
  six S2 labels exactly once; no child holds > 1 BlockedArray variant"); push run 42101258088 shows ubuntu node 26 green.
- **Law:** count what a child compiles; split children, do not force gc().

### #29 -- CI census C-3, C-4: nightly node alpha, legs cancelled before a runner *(CLOSED)*
- **Tried / found:** C-3 nightly 'latest' resolved to v27.0.0-alpha / npm 12.1.0 and Scaffold.test.mjs:314 failed
  "expected one pack entry" -> Y-CI-8 pin newest stable major (node 26, bumped by hand, no prerelease node in CI).
  C-4 two legs cancelled before a runner (not a timeout) -> Y-CI-9 PENDING (runner, not code); both legs later RAN.
- **Mechanism:** an unpinned prerelease changed the pack output; cancellation is infrastructure.
- **Evidence:** census.md C-3 / C-4 and the final census verdict; nightly 42117882541 node 26 green; ROADMAP Y-CI-8,
  Y-CI-9 (RULED 2026-11-05, burst 43); commits 0e286b2, b76f3cc.
- **Law:** a cancelled leg is PENDING, never green; no prerelease node in CI.

### #30 -- CI census C-5: node 22 jit nil-guard *(OPEN, Y-CI-10: probe first)*
- **Tried / found:** the nightly on node 22.23.4 (ubuntu + macOS): torture `jit` branch prints every row
  live=false dropped=false -> GATE FAIL (live 0/5, nilDropped 0/5); node 26.13.0 shows 5/5 ok. torture.mjs prints
  no R1..R4 reason, so which rule fails is unknown; no node 22 binary on the host.
- **Mechanism:** unknown. RULED Y-CI-10 = "Probe the reason first (Recommended)": run `node test/torture-jit.mjs` on a
  node 22.23.4 binary (obtained with the maintainer's approval then), and ask the fix as its own Q-id.
- **Evidence:** census.md C-5 (nightly 42117882541); ROADMAP Y-CI-10 (burst 45). Not yet observed: the A4 kernel-lane
  on node 22 (blocked by C-5).
- **Law:** none yet. The nightly stays red on its node 22 legs until the probe and its own fix Q-id land (ROADMAP Y-CI-10).

### #31 -- False doc claims caught in review *(each fixed in a literal round)*
- **Tried / found:** (a) CI docs said macOS node 24 was green; it was cancelled, and a "fixed by" line stated an
  unobserved result; (b) the nightly "ceilings" claim was false; (c) D15 called both F-1e shapes undetected -- the
  self-parent shape throws on the walk bound (the error came from the triage line via a brief); (d) C-25 / A9-6 said
  d_b counts only without a repair, the code adds d_a + d_b once, unconditionally; (e) D17: 3 FALSE CLAIM on B4 rep-*
  numbers and a revert-check mislabelled (it is REPORTED).
- **Mechanism:** claims relayed without a probe or a source line.
- **Evidence:** HISTORY.md:38-41, :78-81; .handoff/archive/HISTORY-15-29.md:90-93, :190-192; .handoff/archive/HISTORY-S0-14.md:36-38. All r2 APPROVED.
- **Law:** every claim carries a tier and a source line; behaviour claims relayed into a doc brief are probed first.

---

## C. Shelved -- built, measured, parked

### #32 -- g2b-3b run of record at 6b70f54: INCONCLUSIVE, archived *(R-BA39, R-BA40)*
- **Tried / found:** `--publish --all --runs 5 --picks benchmark/chunkcap.json` at 6b70f54, 2026-11-05 05:39Z ->
  08:04Z, load1 1.51 -> 1.24, 358 cells x 5 passes, 8,689 s, exit 0; sweep before it (285 cells x 5, 659 s) at 2780610
  gave chunkcap.json sha256/8 921c2b86. Twin A/A read other than TIE at 28 of 204 cells (5 on the crossover phase),
  drift sentinel 14% against a 10% limit, WebStorm at ~100% CPU on the host.
- **Mechanism:** an A/A control that is not TIE means the run cannot support a verdict: R-BA40 "No verdict"; R-BA39
  "Keep PENDING": archived, README PENDING, not committed, no release. Yggdrasil.js sha256/8 e0618227.
- **Evidence:** RESEARCH.md:1286-1299; HISTORY.md:95-101; REPORTED, INCONCLUSIVE.
- **Law:** an INCONCLUSIVE run decides nothing; the A/A twin is the arbiter (#52, #53).

### #33 -- Inlining-budget diff for the unrolled `_locate`: NO-VERDICT *(REPORTED, PENDING)*
- **Tried / found:** LiteUtils/inlining-budget-diff.sh (sha256/8 740da13b), `--fn _locate,indexAtSum`, unrolled vs
  plain, 3 runs per side per tier, commit 2780610, QUIET load1 1.51: exit 2 NO-VERDICT (the TurboFan guard printed "no
  trace of indexAtSum in before run 1"). Run-1 readings: bytecode _locate 514 -> 162 B; TurboFan rejects the unrolled
  `_locate` ("exceeds bytecode limit", single-inline limit 460) in 4 compile units; the plain form is inlined in the same 4.
- **Mechanism:** the lead (not checked): the tool guard may count only decision lines naming the function.
- **Evidence:** RESEARCH.md:955-968; the null control (unrolled vs unrolled) is also NO-VERDICT by the same guard.
- **Law:** see #23. A NO-VERDICT is PENDING, never "no difference".

### #34 -- Parked rejected diffs *(parked, not disproven)*
- **Tried / found:** g2b3a-b3-r2 (second reject + DESIGN: a MEASURED results.json without `comparison` validates;
  R-BA36 "Require comparison" ruled -> SPEC BA-36 / A16) and rivals-throwkill-r2 (8-line fix > 2 lines, so no third round).
- **Mechanism:** review round limits; the parked r2 copies are under .handoff/archive/bench-adopt-b42/rejected/ (g2b3a-b3-r2.restored-*, rivals-throwkill-r2.restored-*); g2b3a-b3-r1 under .handoff/archive/bench-adopt-b42/bench-adopt/.
- **Evidence:** HISTORY.md:130-142. Only the process rule that changed what ships is recorded here.
- **Law:** none.

### #35 -- SumMap engine waits for the run of record, then for the R-7 PROPOSAL *(OPEN)*
- **Tried / found:** SumMap contract rulings (R-SM1..R-SM10, 2026-11-05) are RULED; the SumMap ENGINE planner waits for
  GO / NO-GO on a CONCLUSIVE run of record (R-SM9). The PROPOSAL A.1-P1b / A.2 review ended r2 REJECTED (5 LITERAL),
  reviewer text applied verbatim with no third round; a fresh one-pass review of that applied diff (burst 46,
  2026-11-06; head PROPOSAL sha256/8 c43cd7a1) read APPROVED with 2 wording NITs and no change to a ruled option.
- **Mechanism:** SumMap shares SumSequence's trunk, so a fanout change (R-7) after the PAUSE reading would redo the
  routing and finger rungs (RESEARCH 17.5); the reading S2@100000 (BlockedArray 0.911 median-of-K, 0.948 min-of-K of
  SumSequence, one QUIET run, K = 3) is REPORTED.
- **Evidence:** RESEARCH.md:1726-1742, :1698-1724; HISTORY.md:12-21; review overlay .handoff/research/summap/review/b45-r3/ (base / head).
- **Law:** none yet. OPEN.
- **Update (2026-11-06, burst 48/49):** the run of record decided: BA-16 = PAUSE (R-BA49, Q-BA16, on b48 run of record
  #2, CONCLUSIVE, twin 0 / 57; 8e27490, chunkcap.json f79b43a6; "PAUSE (Recommended)"). REPORTED: BlockedArray beats
  SumSequence at S2@100000 (min-of-K, 0.95 band; K = 5, node v26.8.2, Apple M4 Pro x12, darwin arm64; full
  provenance RESEARCH 14.4); S1 crossover 1024; S2 none up to 131072. Host caveat: QUIET start
  (load1 2.46, baseline 2.21) but load1 peaked 26.7 at 09:28-09:41Z and sat 3-8 at 10:00-10:25Z (other sessions; no
  other node process). Run #1 (INCONCLUSIVE, twin 4 / 57) decides nothing. The engine planner now waits for the R-7
  research burst's ruled PROPOSAL (F = 4 and F = 8 first, RESEARCH 16.5; R-SM9). Still OPEN until that burst rules.
  R-BA50 "Hold until BA-41 (Recommended)": run #2's results.json / report.html stay uncommitted until BA-41 lands.
  (2026-11-06, burst 49) BA-41 landed (804aa83); R-BA52 "Hold; re-run in a quiet window" supersedes R-BA50 for run #2
  (unpublished, README keeps PENDING); run #3 (804aa83) INCONCLUSIVE, 60 s trace crossed the R-BA53 line (2 of 94
  samples, load1 3.42 / 3.66 vs 3.21), archived, not committed; BA-16 = PAUSE unchanged. Detail: RESEARCH 14.4.

---

## D. Closings -- questions answered "no fix" / "not a defect"

### #36 -- Audit #1 closings: F-1e, F-3, F-4b, F-7 *(RULED)*
- **Tried / found:** F-1e shapes (R-S3 out of scope / R-S2 mid-walk throw OK; added to C-8 "Not detected"); F-3 a
  one-time re-tiering deopt on a dims change (R-A2 "Record, no change"); F-4b insertAt big lane bound b = dims (R-A1
  "Amend C-13: b = dims", <= 16*dims + 1 B/op, documented limit); F-7 "cold" means a separate source function, not a
  promise V8 will not inline (R-A3 "No action").
- **Mechanism:** each is a reading, not an engine change.
- **Evidence:** TRIAGE rows and rulings (verbatim option text); F-3 a reading and F-7 REPORTED (option text); F-4b's b = dims bound is gated by G2's big lane (R-A1).
- **Law:** an option's text is the ruling's text.

### #37 -- Audit #2 / #3 closings: F1a, F1c, F4, F5 *(F1a R-A6, F4 R-A10 RULED; F1c NOT a defect; F5 KNOWN, no ruling needed)*
- **Tried / found:** pass 2 F1a a forged `_len` in [0, live] is beyond the guard (R-A6, R-S3 class, clear() stays O(1)); F1c
  is NOT A DEFECT ("the fast path is correct when the view truly holds every live element", TRIAGE:96-97); R-A4 amend C-3 (a
  throw may leave cursor() invalid); pass 3 F4 a 2nd clear() after a mid-walk throw (R-A10 "R-S2 stands": the arena
  must be discarded); F5 counter-wrap eager deopt is KNOWN, REPORTED (0005 A17-13).
- **Mechanism:** forged state is out of scope (R-S3); the wrap deopt is one per wrap per function after 2^31 counts.
- **Evidence:** TRIAGE audit #2 / #3 sections; test pins unaffected.
- **Law:** forged private state is R-S3; no receiver brand check is added.

### #38 -- One-process 130 B/event and BlockedArray edit 912-3648 B/call *(not defects; tier: none stated)*
- **Tried / found:** the reviewer's finding of 130 B/event in one process was first-call warm-up, not steady state; the
  BlockedArray edit 912-3648 B/call was interpreted boxing before tier-up (~4e4 ops).
- **Mechanism:** rare paths run interpreted until tier-up; BlockedArray.js unchanged.
- **Evidence:** HISTORY.md:237-240; led to Scenarios.test A3 warm-up (see #48).
- **Law:** see #48.

### #39 -- The 16.1 probe: uint32 / `>>> 0` boxing claim not reproduced; the Smi top is per build *(PRELIMINARY)*
- **Tried / found:** probe .handoff/evidence/research7/probe-u32-compare.mjs, 2026-11-01, 1 run, load1 5.02 vs baseline
  2.21 (PRELIMINARY). Leaf and fence kernels 0 B/op in every band for X (Int32 + xor-bias), S (`>>> 0`) and U
  (Uint32Array); the ret kernels read 0 B/op below 2^31 and 15.25 B/op above (DETERMINISTIC count on this build). In the leaf and fence kernels S and U
  deopt on the first key >= 2^31 and X does not; retX and retU deopt at the boundary conversion. The claim that a Uint32Array key carried through a branch phi boxes inside
  the engine did NOT reproduce; a draft clamp bug (`Math.max(0, heapUsed - h0)`) hid GC windows (from the pasted script; UNVERIFIED in the repo).
- **Mechanism:** 16.2: on node v26.8.2 arm64 2^30 and 2^31-1 are Smis, 2^31 is not (pointer compression 0), so 13.1's
  bands hold for compressed builds only; "No shipped 0.1.1 claim is falsified". This favours X for the I-7 amendment, pending a QUIET timing run.
- **Evidence:** RESEARCH.md:1419-1457; timing medians within ~1 ns: PRELIMINARY, decides nothing.
- **Law:** a fence kernel offered as a must-fail control must be able to fail (DB-8).

---

## E. Standing rules learned

### #40 -- Research burst and a ruled PROPOSAL before any new surface *(maintainer decision (chat), 2026-11-04)*
- **Tried / found:** maintainer decision (chat): a research burst plus a ruled PROPOSAL draft before any new `.d.ts` or
  engine planner; first use: SumMap after g2b-3b. The PROPOSAL review caught 17 LITERAL incl. false claims on the retX
  deopt and the 15.25 B/op tag (r1), then 3 (r2), r3 APPROVED.
- **Evidence:** HISTORY.md:55-59, :138-141. Memory research-burst-before-surface (session memory only for the wording).
- **Law:** probes and a ruled PROPOSAL precede any `.d.ts` / engine planner.

### #41 -- Prove CI paths in a clean clone *(standing rule; source states no status)*
- **Tried / found:** local `npm test` always finds `.handoff/`; a clean git clone (no `.handoff/`) with a fresh
  `npm install` gave npm test 1348 / 1347 / 1 skip / 0 fail.
- **Evidence:** HISTORY.md:80-81 (the clone run); push run 42101258088 (1357: 1356 / 1 / 0, 8 / 8 legs).
- **Law:** CI is proven by clone, not by the working tree.

### #42 -- Census: classify every printed lane *(standing rule; source states no status)*
- **Tried / found:** the burst-44 re-read of the node 22 legs' printed `# lane` / `# control` lines (census.md:96-105) found the -55 / -880 /
  -648 readings (#27); check 3 then classified every such line of every leg (bounds: perCall < 8 and > -2, bop in [0, 1);
  census.md:117-121, which cites memory census-read-all-lanes).
- **Evidence:** census.md (check 2, "memory census-read-all-lanes" in the file itself); fix b76f3cc.
- **Law:** one question per red row; classify all lanes before asking.

### #43 -- A rule left in an old ADR gets missed *(G-5 / G-6 binding per R-Y09; sweep-per-fix is session memory only)*
- **Tried / found:** ADR 0003 G-5 / G-6 were binding but not folded into 0005 CURRENT; no rung enforced them until AF-2
  (#21). Counted at 51 sites. Fix pattern: each fix batch sweeps binding laws from older ADRs.
- **Evidence:** TRIAGE F-2 row; commit 265509c (docs). Memory unfolded-adr-rules-get-missed (wording only).
- **Law:** CURRENT carries every binding rule with an id; addenda are history.

### #44 -- Probe relayed claims; sweep ruled-out names *(standing rule; source states no status)*
- **Tried / found:** the D15 false claim came from a triage line relayed into a brief (#31c); the burst-45 docs review
  took three rounds (r1 REJECTED 5 LITERAL + 2 DESIGN, r2 REJECTED 1 LITERAL at RESEARCH:151, r3 APPROVED; HISTORY.md:21-23);
  that the misses were ruled-out names and a changed statistic is session memory only -- unproven.
- **Evidence:** .handoff/archive/HISTORY-15-29.md:190-192; HISTORY.md:21-23.
- **Law:** probe any behaviour claim before a doc brief; grep every ruled-out name and every changed statistic across all docs.

### #45 -- Lessons with no in-repo evidence *(session memory only -- unproven)*
- **Test-helper briefs list the full surface** (every op x counter x guard side): evidence: session memory only --
  unproven here (a related in-repo form is #18). **`.constructor` leak:** evidence in #25.
- **Law:** do not promote to a gate without a commit or log.

---

## F. How the gates evolved

### #46 -- Per-call floor: K = 16 calls, bound below, one-box control *(deterministic count, fixed)*
- **Tried / found:** g2b-2a B2 r1 FAIL-OPEN: 1-call windows drift +-16 B on a < 16 B/call floor (one boxed double is 16 B).
  r2 APPROVED with K = 16 and a bound < 8.
- **Evidence:** HISTORY.md:204-206; test/ScenarioFeed.test.mjs.
- **Law:** a per-call floor needs K calls, a lower bound, and a one-box control.

### #47 -- Sync JIT for B/op lanes: `--no-concurrent-recompilation` *(R-G5)*
- **Tried / found:** a B/op lane that relies on TurboFan inlining (e.g. getMeasure under 460 B) passes only if the
  concurrent compile lands before the last window. R-G5 = "No concurrent recompile (Recommended)".
- **Evidence:** package.json:30 (torture script) and test/torture.mjs:33; revert-check under R-G5: big.offset fails on
  both old builds (.handoff/archive/HISTORY-15-29.md:98-101; PRELIMINARY host); R-G5 quoted at .handoff/archive/HISTORY-15-29.md:123-124; .handoff/archive/HISTORY-15-29.md:132-134 (the concurrent-recompilation-delay=5 run).
- **Law:** timing-dependent compilation is removed from the gate, not tolerated.

### #48 -- Warm past tier-up *(fixed in ScenarioFeed.test A3; Scenarios.test A3 by the BA-26 warm floor, Scenarios.test.mjs:825)*
- **Tried / found:** A3 edit lanes read 160 B/call at 167 warm calls (a rare path still interpreted); warming to 2000
  removed it. Related: BlockedArray edit lanes read interpreted boxing until ~4e4 ops (#38).
- **Evidence:** HISTORY.md:204-205, :238-240.
- **Law:** warm a rare path past tier-up before the lane; gate per call AND per op.

### #49 -- No forced gc() between fill and lane *(fixed)*
- **Tried / found:** a forced gc() after earlier labels died deoptimised BlockedArray rare paths ("embedded weak
  objects cleared"), a ~3000 B/call artifact.
- **Evidence:** HISTORY.md:193-194; B2 / B3 review r2.
- **Law:** no gc() between fill and lane.

### #50 -- Engine-region major GC instead of whole-window *(gate moved; whole-window REPORTED)*
- **Tried / found:** the full G2 run read whole-window major=1 (B1 alone 0): an idle-scheduled major (perf_hooks flags
  64) during settle() after runAlloc returned (b1-r2/diag.log, 3 runs).
- **Mechanism:** the gate moved to a lite-gc-profiler region 'engine' around all 166 measured windows, coverage asserted, a
  teeth lane (major=3 -> FAIL); whole-window counts stay REPORTED. Nightly node 26: engine windows 166/166, whole-window major 1.
- **Evidence:** .handoff/archive/HISTORY-15-29.md:155-158; census.md nightly row. Commit 4e92b86 (G2 harness).
- **Law:** gate the region you mean.

### #51 -- NIL-guard gate = bytecode presence *(DETERMINISTIC)*
- **Tried / found:** the finger guards' NIL check is gated by `--print-bytecode` signature (LCS of the 5 guards): 5/5 live,
  0/5 nilDropped, one-site mutant 4/5; `--trace-deopt` has no teeth for it. 0 deopts over 1000 clear -> op cycles (REPORTED).
- **Evidence:** .handoff/archive/HISTORY-15-29.md:148-149, :153-154; test/torture-jit.mjs (4e92b86). The node 22 failure is #30 (OPEN).
- **Law:** gate presence in the bytecode, not a deopt trace.

### #52 -- Twin A/A and min-of-K 0.95 *(R-BA41 RULED, burst 45)*
- **Tried / found:** P1b QUIET one run, K = 7, 2026-11-05 22:45:52Z -> 22:47:17Z (84.7 s), load1 1.94 / load5 11.23 /
  load15 15.97 at start, HEAD b76f3cc, Yggdrasil.js e0618227, BlockedArray.js 1066ac31, 273 / 273 cells. The twin is no
  noisier than a second BlockedArray process (8 / 7 / 5 of 51 non-TIE); the mechanism is child-level bimodality (S2a@1024
  blend ~39 vs ~55 ns/event), which flips median-of-K. Under min-of-K 0.95, crossover-phase A/A false positives 0 / 39
  (K = 5 and K = 7); every phase 12 / 153 (K = 5) and 13 / 153 (K = 7).
- **Mechanism:** R-BA41 "Min-of-K, 0.95 band": a win = min-of-K below 0.95 x the other's min-of-K, else TIE; the printed cell
  stays median-of-K. 5 of 228 archive verdicts change (3 TIE -> win, 2 win -> TIE).
- **Evidence:** RESEARCH.md:1638-1651, :1745-1751; logs .handoff/research/summap/p1b.jsonl, p1b.read.txt. REPORTED (one run;
  load5 / load15 still elevated at start).
- **Law:** test a verdict rule on an A/A pair before using it on A/B.

### #53 -- Crossover-phase-only twin check *(R-BA42 RULED)*
- **Tried / found:** the twin A/A check that sets INCONCLUSIVE reads only the crossover phase (blend; S2b bulk); other phases
  print as a noise row, never a gate. Evidence: P1b one run, K = 7: 18 of the 20 non-TIE pair-cells are non-crossover
  phases (13 reweight / edit of 600-1,000 events, 5 S2 reweight of 15,000 events). R-BA43 keeps K = 5 (K = 7 does not
  lower false positives under median or min-of-K).
- **Evidence:** RESEARCH.md:1745-1762 (R-BA42, R-BA43). REPORTED.
- **Law:** the arbiter reads the phase the verdict reads.

### #54 -- Grid + 8 x d *(R-BA44 RULED)*
- **Tried / found:** the sweep grid d x {1/4, 1/2, 1, 2, 4, 8}; P2 one QUIET run, K = 3, 22:47:17Z -> 22:48:07Z (49.6 s), 168
  / 168 cells: 6 of the 8 measured edge cells keep 4 x d as argmin, 2 move to 8 x d by 1.6% and 4.9% (both TIE under 0.95); 16
  x d is 1.4-4.3 x slower at every cell and never argmin. 14 of the 22 edge cells were not measured.
- **Mechanism:** the sweep must be re-run QUIET to re-publish chunkcap.json before the next run of record (done
  2026-11-06, 8e27490, chunkcap.json f79b43a6).
- **Evidence:** RESEARCH.md:1698-1724 (REPORTED); the 22-of-57 edge fact is DETERMINISTIC (chunkcap.json 921c2b86).
- **Law:** an argmin at a grid edge prints 'edge'; the fix adds 8 x d to every grid once (R-BA44).

---

## How to add an entry

1. Pick the family; take the next free number (#55 and up) and add it in the numbering note.
2. Title `### #N -- <title> *(status)*` with the source's status word. A new entry needs a **new mechanism** or a
   confirmed defect, not a restatement.
3. Evidence: the commit short hash from `git log --oneline` on main, sha256/8 of the file when a source gives one (or
   `git show <commit>:<file> | shasum -a 256`), the log / jsonl path, run id, run count, and a tier word. Reasoning-only:
   say "reasoning, not measured". No tier: "tier: none stated -- unproven".
4. Never upgrade a tier. Open items stay OPEN until a ruling is quoted.
5. The pre-release dual audit's confirmed findings land as new B (defect) or D (no-fix) entries with their fix commit.
6. Keep it ASCII, 5-15 lines. A new law needs two entries or one entry plus a gate.
