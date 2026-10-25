# 0003 -- Counts are the gate; D-host none (Y-13); diagnostic counters (Y-09)

- Status: RULED 2026-10-25 (maintainer, S0)
- Ruling: Y-09 + Y-13 "Rule ADR 0003 as written" (R-Y09); counters "Per view" (R-X2); "(B+1-m | m) = 13|4" so s0 := m (R-X1)
- Severity: S2 (Y-09 S2, Y-13 S3; every member inherits)
- Date: 2026-10-25
- Session: S0

## Ruling (2026-10-25)

- R-X1: "(B+1-m | m) = 13|4" -- ADR 0001 Table 3; finger hits 12/13; ADR 0003 G-12 s0 := m. The G-12 closing sentence "s0 = 2, B = 16 gives the ROADMAP '14 of 15'" and "14 of 15" are superseded by 12/13 (12 of every 13 appends at B = 16).
- R-X2: "Per view" -- counters are per view; ADR 0003 O-2 closed, ADR 0004 O-4 closed.
- R-Y09: Y-09 + Y-13 "Rule ADR 0003 as written" (maintainer, 2026-10-25). O-3 (counter names) and O-4 (stale bench table on a PENDING release) stay OPEN.
- X-1 below: CLOSED by R-X1. O-2 and X-2 below: CLOSED by R-X2.

## DB-1 findings (2026-10-25) -- OPEN for the SumSequence planner

- B-17 (S1): "hit" is defined differently here (G-12: in range + epoch valid + no split / merge / equalize) and in ADR 0001; the finger rule is also incomplete (stale base, freed leaf on a draining hit, stale keyed fence); the finger-on == finger-off metamorphic gate becomes standing.
- B-19 (S2): G-12 "prepends mirror" is false for moves (a prepend into a packed leaf shifts every element: B = 16, 200 prepends -> 1960 moves vs formula 45).
- B-29 (S3): G-13 can never fail (stack size = H(Lmax) by ADR 0001 T-10, so it reduces to "H is monotone").

## Context

The ROADMAP left the statistical host (Y-13, lean "none") and the counter list
(Y-09) to S0, and that list no longer matched the design ("borrows" never occurs
in D-C2 Rev 1; rotations were one counter, not single / double; moves were not
counted). The question: which claims are gated, where, and with what exact
numbers. Precedent: LiteLogLogN decisions/0004-witness.md Amendment 1; the
sibling `_n` design is at LiteLogLogN/LogLogN.js:374-376 and :985-987.

## Decision

- G-1 D-host = none. The STATISTICAL tier is EMPTY: no timing ratio / slope / fit
  / A/B gates anything, in verify or at /release. Every timing is REPORTED
  (ns/op, log2 n fit with lite-logn r2 0.958 printed as reference only, crossover
  n, leaf-size crossover, loss table, maxPauseMs), run via `quiet-lock.mjs run`
  with ROADMAP 3.8 provenance; NOISY = PRELIMINARY; 75/76/2 = PENDING; none
  blocks a release.
- G-2 DETERMINISTIC tier (npm test, every run; a flake is a test bug): oracle,
  walker, exhaustive small-scope, metamorphic, every count gate below, torture
  (0 B/op, maxMajor 0), parity pins, types. A complexity word in docs is backed
  by a count gate or not written (DB-9).
- G-3 Leaving "none" = an ADR amendment by maintainer ruling, only if a hosted
  workflow gives ALL of: (a) named workflow file + pinned runner image + pinned
  Node, named in the ROADMAP Y-13 row; (b) one stated statistic per claim (e.g.
  member/foil median ratio, bootstrap 95% CI or Mann-Whitney), K rounds,
  threshold fixed before the first gating run from M prior CI runs, never
  widened; (c) interleaved A/B, child process per cell (Bench v2); (d) a
  must-fail control (the splice+rebuild foil submitted as the candidate FAILS);
  (e) exit 2 = inconclusive = no verdict; (f) once per release, never inside
  verify; (g) a retained provenance artifact.
- G-4 Storage: one `_n = new Int32Array(NC)` per instance, allocated in the
  constructor, never replaced; indices frozen, append-only across members. `_n`
  holds only never-read diagnostics; the finger epoch is engine-read (I-9) and
  therefore a separate field.
- G-5 Write form only `n[K] = (n[K] + x) | 0`, x an int32; wraps to -2^31, no
  saturation. Gates read window deltas `(after - before) | 0` (valid while the
  true delta < 2^31), never absolutes.
- G-6 The engine never reads `_n`: no branch / index / return depends on it.
  Gate: a census over Yggdrasil.js -- every `_n` occurrence (or alias) matches
  the G-5 form; must-fail fixture `if (this._n[7] > 0)`.
- G-7 Hot body: no per-level loop touches `_n`; increments are post-loop
  (`touches += sp` after the descent, `pulls += sp` after the pull loop,
  `moves += shift`): <= 4 RMW per non-structural op (a hit 3). Structural
  counters on cold paths only. Not compiled out (no build step; a runtime guard =
  load + branch in the hot body, costlier than the increment). Measured code =
  shipped code.
- G-8 `readCounters(out)` copies into a caller Int32Array (0 B; `out.length < NC`
  -> RangeError); `resetCounters()` = fill(0), cold. clear() KEEPS counters
  (sibling parity) -> the 3.5 "clear() restores constructed state" relation
  excludes `_n`.
- G-9 Expected values come only from `test/spec-counts.mjs`: pure functions of
  (B, s0, policy constants, capacity, N, script) passed in by the test -- never
  from a counter, an engine field / method (`seq._B`, height()) or an engine
  twin. spec-counts.mjs must not import Yggdrasil.js (import-graph gate +
  must-fail fixture). Count gates run on the shipped Yggdrasil.js.
- G-10 Structure-exact gates may use depth / L recounted by the test's own
  walker only after that walker passed I-1 + I-5 on the same state.
- G-11 Splice witness: touches(op) <= p(op) * HB(Lmax(n)) + k(op), all integers.
  HB(1) = 0, HB(w) = 1 + HB(floor(3w/4)) (at alpha = 1/4 a child weighs <=
  floor(3w/4)); HB is the exact max depth over all I-1 trees and HB(L) <=
  floor(log_{4/3} L). c = 1/log2(4/3) = 2.409 is a REPORTED slope only; the gate
  uses integer HB. (Nominal, hand-computed: HB(1024) = 21 vs floor(log_{4/3}
  1024) = 24.) Supersedes `ceil(2.41*log2 L)` in the ROADMAP SumSequence
  ASSERTIONS. p(op) = number of root-to-leaf paths the op walks; k(op), Lmax(n)
  SYMBOLIC here (ADR 0001).
- G-12 Finger events: each op increments exactly one of fingerHits /
  fingerMisses. Hit = in range + epoch valid + no split / merge / equalize
  needed; the split-triggering op is a MISS. N strictly increasing appends from
  empty: splits = N <= B ? 0 : 1 + floor((N-B-1)/(B-s0+1)); misses = 1 + splits;
  hits = N - 1 - splits; moves = (s0-1)*splits; merges = equalizes = 0. Prepends
  mirror. s0 = 2, B = 16 gives the ROADMAP "14 of 15" (superseded, R-X1: s0 := m gives 12 of 13).
- G-13 HB(L) <= the I-8 stack size for every L in 1..Lmax(C) (a test of the two
  ADRs' consistency).

### Counters / gates

| idx | counter | +1 per | path | gated as | source |
| --- | --- | --- | --- | --- | --- |
| 0 | touches | trunk node read in a descent | warm | <= G-11 per op; == 0 on every hit | HB, ADR 0001 k/p, I-9 |
| 1 | pulls | summary recompute | hot | == 0 per read op; == depthW per non-structural mutation; <= HB + k_p | spec, G-10 |
| 2 | moves | existing element shifted | hot | exact on edge streams; per op <= ADR 0001 max | G-12, ADR 0001 |
| 3 | splits | leaf split | cold | exact on edge streams; > 0 per fuzz stream | G-12 |
| 4 | merges | leaf merge | cold | exact on edge-drain streams (leaf-size model); > 0 | ADR 0001 |
| 5 | equalizes | redistribute | cold | same as merges | ADR 0001 |
| 6/7 | rotSingle / rotDouble | rotation | cold | each > 0; sum <= HB + 1 per op; totals REPORTED | I-1 |
| 8/9 | fingerHits / Misses | finger op | hot / cold | partition exact every stream; exact on edge streams | G-12 |
| 10 | joinSteps | join spine step | cold | <= ADR 0001 bound; > 0 | ADR 0001 |
| 11 | seamRepairs | seam leaf fixed | cold | <= 2 per splitAt / append; > 0 | P-6 |
| all | stream totals | | | REPORTED (printed beside times) | 3.8 |

Y-09 changes: "borrows" -> equalizes (D-C2 Rev 1 never borrows one); rotations
split single / double (3.2 needs each > 0); ADD moves (ROADMAP 1.4 / 3.4 gate
it); ADD seamRepairs (P-6 "counted"). REJECTED: descents (= misses), epochBumps
(engine-read state), per-dim counters (cost is dim-independent).

### DB-8 mutants

Source patches on a temp copy of Yggdrasil.js, never flags in the shipped file.

- MC-1 reflexive gate (spec-counts imports the engine / reads `_n`): the G-9
  import gate FAILS; under MC-3 a reflexive gate passes while G-12 fails --
  shows why.
- MC-2 fingerHits double-increment: partition + G-12 fail.
- MC-3 symmetric 8+8 split on appends: G-12 splits / moves / hits fail.
- MC-4 fence-less finger: hits = 0 != G-12.
- MC-5 splits increment deleted: G-12 + > 0 fail.
- MC-6 engine reads a counter: G-6 census fails.
- MC-7 saturating increment: pre-seed 2^31 - 3, 5 events -> delta must be 5.

## Evidence (S0, 2026-10-25)

No command was run for this ADR in S0. The one cross-checked number is the
orchestrator's node v26.8.2 (2026-10-25) append simulation recorded in ADR 0001:
with s0 := m = 4 and B = 16, 10,000 appends give splits 768 and hits 9231,
identical to the G-12 formula (X-1). The value HB(1024) = 21 is nominal,
hand-computed, and equals ADR 0001's H(1024) = 21 (X-4).

## Consequences

- No timing gates anything in `npm test` / verify / release; the bench scripts
  print REPORTED tables with provenance (ROADMAP 3.8), and a PENDING bench is a
  maintainer decision (O-4).
- The coder adds `_n`, `readCounters`, `resetCounters` per G-4..G-8, the
  `test/spec-counts.mjs` oracle (no engine import) per G-9, and the MC-1..MC-7
  mutants; G-11 / G-12 / joinSteps bounds become concrete once ADR 0001 fixes
  s0, Lmax and k.
- G-13 is a cross-ADR consistency test: HB(L) <= the ADR 0001 I-8 stack size for
  every L in 1..Lmax(C).
- Doc sites for the S0-U4 pass (not edited here): SCOPE D-C2 / section 6
  "borrows" -> equalizes; ROADMAP Y-09 row = the new list; ROADMAP SumSequence
  ASSERTIONS float form -> HB; ROADMAP 3.5 must exclude `_n` from "clear()
  restores the constructed state".

## OPEN

- O-1 ADR 0001 must supply: s0 and the B+1 split sizes (P-3); min / merge /
  equalize formulas; E and Lmax(n) (P-1 +k per view, P-6); threaded leaves
  (decides p = 2 for a non-sibling neighbour); joinSteps bound; k(op) per op
  class.
- O-2 CLOSED by R-X2 (per view). ADR 0004: counters per view vs per arena -- lean per view. (CONFLICT: ADR
  0004 O-4 leans per arena.)
- O-3 maintainer: index names as static class fields vs a new `COUNTERS` export
  (changes the ROADMAP section 0 export list).
- O-4 maintainer: a release whose bench is PENDING either keeps the prior table
  with its own commit + sha, or drops it.
- X-1 (cross-ADR) -- CLOSED by R-X1: s0 := m, "14 of 15" superseded by 12/13 (0001 T-5 / Table 3 vs 0003 G-12 vs ROADMAP 3.4 "14 of 15"):
  0001 picks the append split (B+1-m | m) [13|4]; 0003 G-12's formula is written
  with a free s0. Setting s0 := m makes them identical (orchestrator check: both
  give 768 splits / 9231 hits for 10,000 appends at B = 16). The ROADMAP "15 + 1"
  / "14 of 15" and SCOPE D-C2 / D-C7 "~14/15" are SUPERSEDED by 12/13 if 0001 is
  ruled. Maintainer ruling (Y-06 lean moves).
- X-2 (cross-ADR) -- CLOSED by R-X2, per view (0003 O-2 vs 0004 O-4): counters per VIEW (0003 lean) vs per
  ARENA (0004 lean). Unresolved; ruling.
- X-4 (cross-ADR) (0001 T-10 H(L) == 0003 G-11 HB(L)): the same recursion
  (w <- floor(3w/4)); one name, H. Orchestrator: H(1024) = 21 in both.
- X-8 (cross-ADR; applied S0-U4) (0003 G-8 vs ROADMAP 3.5 "clear() restores the constructed
  state"): counters are kept by clear(); 3.5 must exclude _n.

Risk: G-11 / G-12 / joinSteps bound stay symbolic until ADR 0001 fixes s0, Lmax,
k.
