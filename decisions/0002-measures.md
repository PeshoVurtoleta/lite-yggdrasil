# 0002 -- Measures: every SUM dim is an integer in [0, 2^53-1] (Y-05)

- Status: RULED 2026-10-25 (maintainer, S0)
- Ruling: "Rule as ADR 0002" (R-Y05); "RangeError everywhere" (R-X5)
- Severity: S1 (P-5 measures; shape-dependent rounding would break the oracle)
- Date: 2026-10-25
- Session: S0

## Ruling (2026-10-25)

- R-Y05 (Y-05): "Rule as ADR 0002" -- option (a): every SUM dim an integer in [0, 2^53-1], totals <= 2^53-1.
- R-X5: "RangeError everywhere" -- ADR 0002 O-3 closed (RangeError); ADR 0004 A-3 TypeError -> RangeError.
- O-3 and X-5 below: CLOSED by R-X5.

## DB-1 findings (2026-10-25) -- OPEN for the SumSequence planner

- B-22 (S2): the entity argument is never validated (undefined -> 0, 2^31 -> -2^31, 1.5 -> 1 in an Int32 column; fail open).
- B-24 (S2): the virtual-list consumer needs getMeasure(i, d) (and entityAt, a cursor seek, a non-allocating dims > 1 insert form) that no document specifies; see O-4.

## Context

I-3 bounds each dim's TOTAL and requires m >= 0 only on seekable dims. A
non-seekable dim holding negatives can have an internal partial sum above 2^53
while the total is fine, so rounding becomes shape-dependent (B-2 returns). The
problem (P-5): either every SUM dim is >= 0, or sum(|m|) is bounded per dim.
The same decision fixes the boundary rows for the seek argument y (P-8) and the
-0 / non-number rules.

SPEC (hot body): one fused input check (type, range, integer) per written
measure + one exact headroom compare per dim; pull / seek loops unchanged, no
new column. Cold: non-inlined throwers `_fail(code)` with a Smi code. Option (b)
machinery never enters the body.

## Decision

- M-1 Every SUM dim holds integer-valued Numbers 0 <= m <= MAX = 2^53-1 (P-5
  option (a)). v0.1 has no non-seekable dims (indexAtSum accepts any d < dims),
  so "seekable" is not a flag: drop the qualifier from I-3 / D-C4(a). The
  integer test must accept 2^31..MAX.
- M-2 -0 is accepted and stored as +0 (`m + 0`).
- M-3 No coercion: a non-number -> RangeError (ROADMAP law 1, one error class).
  Order: typeof, then `!(m >= 0 && m <= MAX)` (NaN fails), then the integer test.
- M-4 Invariant after every op: total_d <= MAX for all d. Check
  `m_new > MAX - (total_d - m_old)` (m_old = 0 on insert): every operand exact
  in [0, MAX], nothing rounds. append checks `tR_d > MAX - tL_d`. removeAt /
  splitAt never check (cannot raise a total).
- M-5 Check-before-write: index, d, every dim's measure, every headroom and
  capacity (ADR 0004) validated before the first write to any column, leaf slot,
  length, finger or epoch. setMeasure's descent to read m_old is read-only
  (spine stack = scratch); the headroom compare is the last statement before the
  first write. A failed op leaves state + epoch identical (REPORTED counters
  exempt).
- M-6 Exactness: M-1 + M-4 keep every partial sum in [0, total_d], so every pull
  and descent add is exact -> total / sumBefore / indexAtSum are
  shape-independent bit-for-bit. COUNT (< 2^31) and MAX kinds unconstrained (max
  never rounds).
- M-7 indexAtSum(d, y) = smallest i with S_i + m_i > y, else length. Routing:
  left iff y < acc + sum(left); in-leaf: first j with acc + m_j > y. Corollary:
  result r < length => m_r > 0 (m_r = 0 means S_r > y so r-1 already matched;
  r = 0 needs y < 0). Metamorphic: indexAtSum(d, sumBefore(d, i)) =
  min{j >= i : m_j > 0}, else length.
- M-8 Seek y accepted iff typeof number && y >= 0 (so -0 acts as 0) &&
  y !== Infinity. Fractional y allowed (exact integer acc vs y never rounds);
  finite y > total -> length; everything else RangeError.
- M-9 Zero-box: acc, y, headroom, m_old stay locals of one op body; an internal
  helper needing them goes through a Float64Array scratch slot.
- M-10 Mutants -> killing rows: float measures W-1; wrong bound R-13 / R-14;
  non-strict seek S-3 / S-4; no -0 canonicalization R-2; `|0` integer test R-7;
  headroom without m_old R-16.

### P-5 options

| Option | Counterexample / hot-path cost |
| --- | --- |
| I-3 as written (REJECTED) | non-seekable dim [a = 2^53-1, 2, c = -(2^53-1)], total 2. One leaf: (a+2)+c = 2^53 + c = 1 (2^53+1 rounds to 2^53, ties-to-even). root(leaf[a], leaf[2,c]): a+(2+c) = 2. total(d) is shape-dependent and the bound check reads a rounded root. |
| (a) all SUM >= 0 (CHOSEN) | 0 B: the sign test is the existing range compare; no column. |
| (b) sum(abs m) <= MAX | sound, but splitAt cannot split a per-instance scalar -> either a per-node abs column per signed dim (+8 B/node/dim; +1 load/add/store per pull level; Math.abs per slot on leaf recompute; a 2nd headroom check per write) or a scalar that drifts up across split / append and refuses valid states. Signed prefix sums are non-monotone -> also needs a seekable flag + a branch in indexAtSum. -> O-2. |

### DB-7 catalogue

U = RangeError, snapshot unchanged: length, every dim total, every sumBefore,
entities, epoch; walker passes. Every R row via insertAt AND setMeasure. File
test/Measures.test.mjs unless noted.

| Row | Input | Expected | Rule |
| --- | --- | --- | --- |
| R-1 | 0 | ok | M-1 |
| R-2 | -0 | ok; Object.is(getMeasure, 0), Object.is(total, 0) on [-0,-0] | M-2 |
| R-3 | NaN | U | M-3 |
| R-4 | +Infinity | U | M-3 |
| R-5 | -Infinity | U | M-3 |
| R-6 | 0.5; 2^52-0.5 | U | M-1 |
| R-7 | 2^31; 2^32+1 | ok | M-1 |
| R-8 | -1 (each dim) | U | M-1 |
| R-9 | '5', null, undefined, true, 5n, new Number(5) | U | M-3 |
| R-10 | 2^53-1 into empty | ok, total 9007199254740991 | M-4 |
| R-11 | 2^53 single | U | M-1 |
| R-12 | 2^52 then 2^52-1 | ok, total = MAX | M-4 |
| R-13 | total MAX, insert 1 | U | M-4 |
| R-14 | total 2^53-2, insert 3 | U (true 2^53+1 rounds to 2^53: a `total + m > 2^53` check would accept) | M-4 |
| R-15 | [2^52, 2^52-1]: set(1,0) ok; set(1,2^52-1) ok (=MAX); set(1,2^52) | U, measure stays 2^52-1 | M-4, M-5 |
| R-16 | total MAX, setMeasure(i,d,m_old) | ok (no-op) | M-4 |
| R-17 | dims 2, dim-1 total MAX: insert (5,1); also insert (5,-1) | U, dim-0 total unchanged | M-5 |
| R-18 | append with tL+tR = 2^53; = MAX | U both sequences unchanged; ok | M-4 |
| R-19 | removeAt at total MAX | ok | M-4 |
| R-20 | d in {dims, -1, 0.5, '0', NaN} for setMeasure / total / sumBefore / indexAtSum | RangeError | M-5 |
| R-21 | sumBefore(d, length); i in {length+1, -1, 0.5} | = total; RangeError | M-7 |
| S-1 | empty: y = 0; y = 7 | 0; 0 | M-7 |
| S-2 | [0,0,0]: y = 0 | 3 | M-7 |
| S-3 | [0,0,2]: y=0 / [2,0,0,3]: y = 1, 2, 4.9 | 2 (non-strict mutant -> 0) / 0, 3, 3 | M-7 |
| S-4 | [1 x12, 0 x8, 1 x12] at B=16 (walker asserts a leaf boundary in 13..19): y = 12 | 20 (kills `<=` in internal routing) | M-7 |
| S-5 | y = -1, -0.5, -Infinity | RangeError | M-8 |
| S-6 | y = -0 on [0,0,2] | 2 | M-8 |
| S-7 | [2,2]: y = 1.999, 2.5, 3.999 / [2^52, 1]: y = 2^52-0.5 | 0, 1, 1 / 0 | M-8 |
| S-8 | y = total / last m = 1, y = total-1 | length / length-1 | M-7 |
| S-9 | y = total+1; 1e300 | length | M-8 |
| S-10 | y = NaN; +Infinity | RangeError (P-8) | M-8 |
| S-11 | y = '3', null, undefined | RangeError | M-8 |
| S-12 | [2^53-2, 1]: y = 2^53-2; 2^53-1 | 1; 2 | M-7 |
| S-13 | Oracle fuzz (test/Oracle.test.mjs) every seek | M-7 corollary + metamorphic hold | M-7 |

### DB-8 witness W-1

File test/Metamorphic.test.mjs, B = 16; the mutant only drops the integer check.

X = [0.1,0,0,0, 0.2,0.3,0,0, 0.4,0,0,0].

- H1: insertAt X in order (12 <= 16: one leaf under any split policy).
- H2: A = [0.1,0,0,0], Bq = [0.2,0.3,0,0], C = [0.4,0,0,0]; Bq.append(C);
  A.append(Bq) -> root(A, node(Bq, C)) (weights 1:2 balanced; every leaf at B/4,
  no seam repair). The test ASSERTS that shape; if not met the test FAILS (never
  vacuous).

indexAtSum(0, 0.6): H1 leaf scan 0.1, 0.30000000000000004, 0.6000000000000001 >
0.6 -> 5. H2: acc 0.1; 0.6 < 0.1 + 0.5? (0.1+0.5 == 0.6 exactly) no -> right,
acc 0.6; in C 0.6 + 0.4 = 1 > 0.6 -> 8.

Exact: 0.2+0.3 = 0.5 exact; 0.1+0.5 = 5404319552844595 x 2^-53 = literal 0.6;
(0.1+0.2)+0.3 = 5404319552844596 x 2^-53 (two ties-to-even). Both totals = 1, so
a `y >= total` early exit cannot mask it. Real engine (10x X, y = 6): both
histories return 8.

### Assertions

Torture insertAt / setMeasure / indexAtSum / sumBefore / total 0 B/op over 1e5
ops each in the Smi lane, maxMajor 0, big lane recorded (O-1); retention 1000 x
(construct, 1e3 inserts, 100 caught rejects, clear()) -> tracker.size() == 0;
W-1 mutant 5 vs 8, real 8 vs 8; every M-10 mutant fails its row; the real engine
passes every R / S row.

## Evidence (S0, 2026-10-25)

TASK 0 RUN (orchestrator, node v26.8.2, 2026-10-25):
`(0.1+0.2)+0.3, 0.1+(0.2+0.3), 0.1+0.5===0.6, 0.6+0.4===1,
(2**53-1+2)-(2**53-1), (2**53-1)+(2-(2**53-1)), (2**53-2)+3>2**53` ->
`0.6000000000000001, 0.6, true, true, 1, 2, false` (matches the expected line
exactly).

## Consequences

- The SumSequence coder implements one fused input check per written measure
  plus one exact headroom compare per dim in the hot body (M-1..M-5), with cold
  non-inlined `_fail(code)` throwers; no new column.
- ADR 0004 A-4 (append) uses the M-4 bound `tR_d > MAX - tL_d`; ADR 0004 A-5
  capacity checks are validated before the first write under M-5.
- Test files test/Measures.test.mjs, test/Metamorphic.test.mjs and
  test/Oracle.test.mjs carry the DB-7 rows, W-1 and the seek fuzz; every M-10
  mutant must fail its row.
- Doc sites for the S0-U4 pass (not edited here): RESEARCH section 5 I-3 / I-4
  and ROADMAP section 1 item 1 + Y-05 row: "seekable dims >= 0" -> "every SUM
  dim >= 0"; add the -0 rule and the y domain.
- getMeasure(i, d) is not in SCOPE section 5 but R-2 / R-15 need it (O-4).

## OPEN

- O-1 Values >= 2^30 (measures, sums) and fractional y box (16 B nominal) when
  crossing a public non-inlined call / return boundary. The torture big lane is
  mandatory; outcome = 0 B/op proven, OR an io-slot (Float64Array) variant, OR a
  documented limit -- decided in the SumSequence DB-11 spike.
- O-2 A signed SUM kind (option (b)) = its own ADR, never seekable.
- O-3 CLOSED by R-X5 (RangeError everywhere). Non-number: RangeError vs TypeError -- maintainer at the Y-05 ruling.
  (Note: ADR 0004 A-3 used TypeError; now RangeError, R-X5.)
- O-4 getMeasure(i, d) is not in SCOPE section 5 but R-2 / R-15 need it.
- O-5 W-1 H2 needs append on one shared arena (P-1 / ADR 0004); an H2 built by
  inserts / removes is fine if the shape assert holds.
- X-5 (cross-ADR) -- CLOSED by R-X5 (0002 O-3 vs 0004 A-3): a non-number measure -> RangeError
  (0002 M-3) but a non-SumSequence argument -> TypeError (0004 A-3). ROADMAP law
  1 says RangeError. Ruling: one error class or a stated split.

Risk: W-1 / S-4 / R-18 assume ADR 0001 / 0004 keep B = 16, min B/4, append on a
shared arena (O-5); O-1 may force an io-slot API.
