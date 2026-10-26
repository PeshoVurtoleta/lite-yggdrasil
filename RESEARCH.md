# lite-yggdrasil Research Notes

Research companion to ROADMAP.md (the plan) and SCOPE.md (the founding scope note, Rev 1).
ASCII-only. Started 2026-10-25. Nothing in this file is a shipped claim: every timing statement is
labelled "expected" until a run log of the cycle that measured it exists (suite law).

Contents
1. Core identity -- "where is X?" is a sum
2. The problems, and who has them today
3. The analytical anchor -- the splice witness (counts first)
4. The benchmark suite -- adopt Bench v2, add the scenario tier and the "where it loses" table
5. Design core and its invariants
6. Design-bug log -- what review caught before code, and which technique would have caught it earlier
7. The candidate roster
8. Boundaries with sibling packages
9. Prior art (sources)
10. Open questions

---

## 1. Core identity -- "where is X?" is a sum

lite-yggdrasil is a zero-GC engine for **mutable ordered sequences where the position of anything is
a running total**: splice anywhere in O(log n), seek by ANY running total (count, pixels, bytes,
milliseconds, volume), and keep the same entities in more than one order.

### The honest unifying thread

The engine is one idea, not a bag of trees: the **summary with dimensions** (the idea behind Zed's
`sum_tree`). Every element carries a small vector of integer measures; every node caches the sum
(or the max) of its subtree; a cursor descends by ANY one dimension of that summary.

| You seek by...              | ...and you get                  | Classic name                     |
|-----------------------------|---------------------------------|----------------------------------|
| count                       | the k-th element                | rank / select, implicit treap    |
| sum of row heights          | the row at scrollTop = y        | variable-height virtual list     |
| sum of line feeds           | the line containing offset o    | rope / piece-table line index    |
| sum of durations            | the clip playing at time t      | timeline / sequencer             |
| sum of volume (keyed)       | the price where depth reaches V | order-book depth                 |
| max of interval end (keyed) | every interval stabbing x       | interval tree                    |

Three facades share ONE trunk and ONE leaf arena: `SumSequence` (implicit position), `SumMap`
(uint32 keys), `IntervalMap` (start-ordered, `maxEnd` summary). The fourth export, `Yggdrasil`, is
the shared entity pool whose trees ("realms") all thread the same stable entity ids. The mythology
names exactly one mechanism: one trunk connecting several worlds = one id space connecting several
orders. Nothing else in the API is named after a myth.

### What it is NOT

- Not a hash map (no O(1) point lookup; a `Map` beats it there, and the benchmark says so).
- Not an integer-universe successor structure (that is lite-loglogn).
- Not a textbook teaching member (that is lite-logn; it keeps its IntervalTree -- D7 ruling).
- Not a spatial index (lite-bvh / lite-spatial).
- Not persistent in v1 (research R-8 only).

---

## 2. The problems, and who has them today

P1. **Positional lookup over a mutable sequence.** Variable-height virtual lists, editor line /
    offset maps, timelines of concatenated clips. Today: a prefix-sum array (O(n) rebuild on every
    insert / delete) or a Fenwick tree (O(log n) VALUE updates, no insert in the middle).
P2. **Aggregates over a live keyed set.** "Volume resting above price p", "how many timers before
    t", "the key where cumulative weight crosses y". Rank / select by COUNT is common; seek by an
    arbitrary SUM dimension is not.
P3. **Overlap over MUTABLE intervals.** Clips active at t, booking conflicts, 1D sweep broadphase,
    decorations overlapping a range.
P4. **Multi-view entities without sync bugs.** Price-time order AND cancel-by-id; deadline order AND
    per-owner removal; offset order AND decoration id. Today: a `Map` plus a sorted array kept in
    sync by hand, an O(n) delete path or stale entries.
P5. **Bulk structural edits.** Cut / paste a range of rows, move a block of clips, split at a key,
    append two sequences: O(log n) split / join instead of O(n) copies.

### In the suite (survey 2026-10-25; file:line at that date)

- lite-logn (LogN.js v1.5.1): **Treap** (:1912) size-only summary, rank / select by count, split /
  merge on a shared arena, randomized; **Scapegoat** (:2515) size-only, no split / merge;
  **SortedArray** (:6447) O(n) insert / delete; **SegmentTree** (:1079) fixed kind, fixed length;
  **Fenwick** (:557) the suite's only seek-by-sum (`search` :781), fixed length.
- No interval tree, stabbing query, sweep, sum tree, rope, piece table or multi-index anywhere.
  lite-logn's ROADMAP (:916) plans a Treap-based IntervalTree; it stays there (D7 ruling).

Consumers that hand-roll a weaker version today (each is a candidate recipe, never a hard dep):

| Package       | Today                                                               | Problem |
|---------------|---------------------------------------------------------------------|---------|
| LiteVirtual   | `measuredAxis` private Fenwick (Virtual.js:46-84); a row insert goes through `setCount` = full rebuild, O(n) (:677, :748) | P1 |
| LiteTimeline  | every track scanned every frame (Timeline.js:83); no remove          | P3, P1  |
| LiteKeyframe  | sorted Float32 keys, O(n) insertion shift (Keyframe.js:226); linear scan under ~16 then binary search (:44, :55) | P2 (leaf-scale crossover precedent) |
| LiteDataTable | full O(N log N) re-sort per change (Table.js:511, :753); one view    | P4, P2  |
| LiteDiCron    | every job polled every tick, O(n) (Cron.js:478)                      | P2      |
| LiteArena     | generational 32-bit handles, 20-bit index + 12-bit generation (Arena.js:5, :31) | the id source for P4 |

### Outside the suite

Every serious editor builds this privately: VS Code's piece tree (a red-black tree caching left-
subtree length and line-feed count -- a two-dimension sum tree for one consumer) and Zed's
`sum_tree` (a copy-on-write B+ tree whose Summary exposes several Dimensions, any of which can be
used to seek). `sorted-btree` (npm) is a fast keyed B+ tree with O(1) clone, but has no summary
dimensions; `@flatten-js/interval-tree` is the Cormen interval tree on object nodes. No reusable,
zero-GC, typed-array, deterministic JS engine for the summary-dimension idea was found.

---

## 3. The analytical anchor -- the splice witness (counts first)

Every sibling family has an anchor whose SHAPE witnesses its class (lite-o1 flat, lite-logn a
straight line vs log2 n, lite-loglogn a line vs log2 w). lite-yggdrasil's anchor is the **splice
witness**: the cost of `insertAt(middle)` + `indexAtSum(random y)` grows as a straight line in
log2 n, while the honest O(n) foils (splice + prefix-sum rebuild; Fenwick + rebuild on insert --
LiteVirtual's pattern today) leave it.

Following the sibling convention (lite-loglogn ADR 0004 Amendment 1, D-host = none), the anchor is
gated in COUNTS, not time:

- DETERMINISTIC (gated every run): trunk nodes touched per op, pulls per op, leaf moves per op.
  touches(op) <= p(op) * H(Lmax(n)) + k(op), all integers (ADR 0003 G-11; the slope
  c = 2.409 of log2 L is REPORTED only), k(op) the leaf constant -- an exact, host-independent line. The foil's count (elements moved) is n-linear.
- REPORTED (docs only, with provenance): ns/op vs log2 n, fitted with lite-logn's frozen family fit
  (r2 floor 0.958) for display. Never a gate (no hosted CI; sibling convention).

A second, family-specific anchor: the **shape-independence witness**. The same multiset inserted in
k different orders (different tree shapes) answers every seek bit-identically. It exists only
because measures are integers (D5); with fractional floats it fails by design (control).

---

## 4. The benchmark suite -- adopt Bench v2, add the scenario tier and the "where it loses" table

**Adopt, do not reinvent.** lite-o1 Bench v2, already ported to lite-logn (`LiteLogN/benchmark/`:
Harness / Matrix / Report / Template / METHODOLOGY), is copied and wired: child process per cell,
honesty header (seed / node / arch / date / load), vacuity rule (the STRING `n/a`, never 0),
`traceHash` determinism, bootstrap CI + Mann-Whitney, zero-dep inline-SVG report. The eight
dimensions carry over (D1 witness ... D8 workloads). Swapped in: the splice witness (section 3) and
the foils below.

### 4.1 Foils (the thing a competent engineer would actually write)

| Facade        | Primary foil (fair, O(n))                         | Strong rival (fair, competent)           | Counter-foil (where WE should lose) |
|---------------|---------------------------------------------------|------------------------------------------|-------------------------------------|
| SumSequence   | `Array.splice` + prefix-sum rebuild               | blocked array (sqrt decomposition, below); Fenwick + rebuild on insert (LiteVirtual today) | Fenwick on a FIXED-length, resize-only workload (S7) |
| SumMap        | sorted typed array + binary search + shift        | `sorted-btree` (npm), lite-logn Treap / Scapegoat (count seek only) | native `Map` for point get / set |
| IntervalMap   | linear scan of an interval array                  | `@flatten-js/interval-tree`, lite-logn IntervalTree once shipped | static sorted-by-start array for read-only data |
| Yggdrasil pool| `Map` + k sorted arrays synced by hand            | k independent SumMaps + a `Map` id index | a single SumMap when only one order is needed |

A rival that cannot answer a query (Treap seek-by-sum, `Map` successor) gets the cell `n/a` with
the reason, never a number and never 0.

**The blocked array is the SumSequence rival to beat** (added 2026-10-25 from the lite-pick review,
B-31). Many engineers would write it for S1 / S2: rows in chunks of ~1K (about sqrt n at 1M), each chunk
holding its own sums. insertAt = a scan of the n / chunk chunk counts to find the chunk, O(chunk)
element moves, plus a chunk split (O(chunk) copy + O(n / chunk) directory shift) when the chunk is
full -- O(n / chunk + chunk) in all; indexAtSum = a scan of the chunk sums, then one chunk; splitAt /
append = O(n / chunk + chunk) when both sequences draw chunks from one shared pool (the ADR 0004
model the trunk gets; the rival gets it too) -- per-sequence typed arrays make it O(moved) (B-9). It is flat and cache-friendly, and
it is the height-1 end of the R-7 fanout spectrum, so it also tests whether the binary trunk earns its
constant. Expected (hypothesis, to be MEASURED): it wins below some n and loses above it; that
crossover n (or "none up to n = <max measured>") is a headline number and the README states it. Fair-rival rules: written in benchmark/
(no npm package exists), chunk size tuned per n and printed in the report header, typed arrays,
zero allocation in its hot loop. Its counts (chunk entries scanned + elements moved + splits per insert; chunk sums + elements
scanned per seek)
are printed beside ours.

### 4.2 The scenario tier (the "advanced problems" made visible)

Each scenario is a scripted, seeded workload a reader recognizes, run against the foil, the strong
rival and Yggdrasil, with exact op counts printed next to the times:

- S1 **Virtual list, 1M rows**: smooth scroll (indexAtSum per frame), random row expand / collapse
  (setMeasure, zero heights included), insert / delete rows mid-list while scrolling.
- S2 **Editor line index, 100k lines**: random edits; offset -> line and line -> offset; paste of a
  10k-line block (join) and cut of one (split).
- S3 **Timeline, 50k clips**: scrub (time -> clip), ripple delete, move a block of clips (split +
  join), clips active at t (IntervalMap, v0.3).
- S4 **Order book**: price levels with resting volume; depth-at-volume (keyAtSum), best bid / ask,
  cancel-by-order-id across price-time and id realms (pool, v0.4).
- S5 **Calendar / booking**: insert with overlap check, release, "free slots in [a, b)" (v0.3).
- S6 **Data table, 3 maintained sort orders under updates** vs re-sort-on-change (pool, v0.4).
- S7 **Weighted pick, fixed n, live reweighting** (the lite-pick pattern: setMeasure + indexAtSum
  of an integer draw y in [0, total) vs Fenwick set + search; an integer y < 2^30 stays off the boxing lane --
  a fractional or >= 2^30 draw boxes while ADR 0002 O-1 is open): the real-world case of the "resize-only: Fenwick wins"
  loss row (v0.1).

### 4.3 The "where it loses" table (published, not hidden)

Expected losses, stated as hypotheses to be MEASURED and printed with the crossover n:
- static data: a prefix-sum array + binary search beats any tree for read-only seeks;
- resize-only (no inserts): Fenwick wins (smaller constant, one array) -- shown on S7;
- S1 / S2 below some n: the blocked array wins (expected; section 4.1) -- the crossover n is
  measured and stated in the README, not hidden;
- point lookups by key: `Map` wins (O(1), no order);
- tiny n (expected below ~64-256): a plain array splice wins;
- split / join on a 2-element sequence: overhead dominates.
A benchmark page with no loss rows is a red flag; the suite treats it as a failed honesty review.

### 4.4 Publication (everyone can see the numbers)

- `benchmark/report.html` + `benchmark/results.json` committed; the README "Benchmarks" section is
  generated from results.json (never hand-typed numbers) with the provenance line: date, host, CPU,
  Node, load average at start and end, quiet-lock state, run count, commit + main-file sha.
- `npm run bench` reproduces it on any machine; `npm run bench -- --scenario S1` runs one scenario.
- Every number is REPORTED tier (D-host = none): a measurement, never a law; PRELIMINARY when the host
  was NOISY (quiet-lock exit 76), and labelled so in the report header.
- Counts (touches, pulls, splits, finger hits) are printed beside every timing; counts are exact and
  reproducible bit-for-bit, so a reader can verify the work even when their timings differ.

---

## 5. Design core and its invariants

(SCOPE.md Rev 1 D-C1..D-C8; restated here as invariants the walker checks.)

- I-1 **Balance**: leaf-oriented BB<3,2> (Hirai-Yamamoto, the unique integer pair for Nievergelt-
  Reingold) with BALANCE WEIGHT = LEAF COUNT: each leaf run weighs 1; internal weight = sum of the
  children. For every internal node: 3 * w(l) >= w(r) and 3 * w(r) >= w(l). Gamma = 2 for insert /
  delete only; join / split use BFS's rule (ADR 0001 T-2 / T-3). Element count is a SEPARATE summary column.
- I-2 **Summaries**: count[u] = count[l] + count[r]; sum_d[u] = sum_d[l] + sum_d[r]; maxKey / maxEnd
  likewise -- recomputed from children on every pull, never maintained by deltas.
- I-3 **Measures**: integers in Float64; every SUM dim m >= 0 (ADR 0002 M-1; -0 -> +0, M-2); each dim's TOTAL <= 2^53 - 1 (an op
  that would exceed it throws, set unchanged).
- I-4 **Seek**: indexAtSum(d, y) = first i with sumBefore(i) + m_i > y (STRICT); zero-measure items
  never returned at a boundary; y < 0 throws; y >= total returns length.
  y domain: NaN / +-Infinity / non-number throw; fractional allowed (ADR 0002 M-8).
- I-5 **Leaves**: sorted runs, B = 16, m = B/4 = 4; Table 3 sizes: interior full-leaf split 9|8 / 8|9,
  rightmost-append 13|4 / leftmost-prepend 4|13; underflow (s = m - 1) -> merge iff s + k <= B/2, else
  equalize floor / ceil((s + k) / 2) (ADR 0001 T-5..T-8).
- I-6 **Routing (keyed)**: go left iff q <= maxKey[left]; a leaf owns (maxKey(prev leaf),
  maxKey(leaf)]; the rightmost owns up to +inf.
- I-7 **Ids**: Int32; leaves negative (`~leafId`); no value >= 2^31 is ever read from a Uint32Array on
  a hot path.
- I-8 **Height**: height <= spine-stack size = H(Lmax), Lmax = ceil(C / m) + K (ADR 0001 T-9 /
  T-10, ADR 0004 A-5).
- I-9 **Finger**: valid only while its epoch equals the tree epoch; a hit never descends. Incomplete as stated -- see B-17; the SumSequence planner fixes it.

---

## 6. Design-bug log -- caught before code (2026-10-25)

The point of this section is the habit: each entry names the bug class, how it was found, and the
ROADMAP section 4 technique that would have caught it EARLIER and cheaper. New entries are appended
by every design review; a class seen twice becomes a standing gate.

| ID  | Bug (in the draft spec)                                                                 | Found by                         | Would have been caught by |
|-----|-----------------------------------------------------------------------------------------|----------------------------------|---------------------------|
| B-1 | Balance weight = element count + 1 over variable-size leaf runs: two sibling leaves of 4 and 16 elements violate 3*5 >= 17 and no rotation can fix two leaves. | external design review (a peer's read of SCOPE draft) | DB-2 exhaustive small-scope (B = 4, n <= 12 finds it in milliseconds); DB-4 proof-assumption table (the proof assumes uniform external weight 1) |
| B-2 | Fractional float measures make seek results depend on tree shape (rounding by association order). | internal review of the draft    | DB-6 metamorphic: same multiset, k insertion orders, identical answers |
| B-3 | Finger tested on the leaf's [min, max] CONTENTS: every sorted append misses.            | internal review of a peer's design | DB-6 metamorphic + DB-9 count-first claims (hit count on a sorted stream) |
| B-4 | The 2^53 bound stated per measure, not per dimension TOTAL.                              | review of a peer's design        | DB-7 boundary catalogue (totals at 2^53 - 1) |
| B-5 | Float-to-uint key helper: -0 and +0 become two keys; NaN unspecified; every positive float maps above 2^31 (the V8 boxing lane). | review of a peer's design | DB-7 boundary catalogue; the lite-loglogn D1 (-0) and C-14 (boxing) lessons |
| B-6 | Symmetric 8 + 8 split on sorted appends leaves every leaf half full; "100% finger hits" claimed. | review of a peer's design | DB-9 count-first claims (occupancy and hit counts printed, not asserted) |
| B-7 | Spine stack fixed at 64 entries; BB<3,2> height exceeds it near 2^27 elements.          | internal review                  | DB-3 invariant walker asserting height <= stack size |
| B-8 | Unverified performance prose ("sub-nanosecond" within 2^53 ns = ~104 days; "copyWithin compiles to memmove"). | review of a peer's design | DB-10 claim audit (every number needs a run log or an "expected" label) |
| B-9 | (S1) splitAt / append between independently constructed fixed-capacity arenas cannot be O(log n) (moving nodes between typed-array arenas is O(moved)); lite-logn Treap shares one arena but allocates views per split. | pre-read of SCOPE section 5 (orchestrator, S0) | DB-11 consumer-first spike (cut / paste a block) -> ruled Y-15, ADR 0004 |
| B-10 | (S1) The <3,2> proof (Hirai-Yamamoto) covers insert / delete only; join / split is Blelloch-Ferizovic-Sun's proof with its own rotation rule -- gamma = 2 inside join is unproven. | pre-read (S0) | DB-4 proof-assumption table (one table per cited proof, not one per structure) -> ADR 0001 T-3, Table 2 |
| B-11 | (S2) "split 8 + 8" / "15 + 1" describe 16 elements; where the 17th goes was unspecified, and every count formula (finger hits, occupancy) depends on it. | pre-read (S0) | DB-9 count-first claims (deriving the formula forces it) -> ADR 0001 Table 3 |
| B-12 | (S1) Totals bounded per dim but negatives allowed on non-seekable dims: an internal partial sum can exceed 2^53 while the total does not -> shape-dependent rounding (B-2 class again). | pre-read (S0) | DB-7 boundary catalogue (partial sums, not only totals) -> ADR 0002 M-1 |
| B-13 | (S2) Seam leaves after splitAt / join can fall below the minimum; no repair rule, no single-leaf exemption. | pre-read (S0) | DB-2 exhaustive small-scope (splitAt at every position) -> ADR 0001 T-7 / T-8 |
| B-14 | (S3) ROADMAP DB-2 claimed B-1 "falls out at B = 4 (sibling leaves of 1 and 4)": at B = 4 those weigh 2 vs 5 under element-count+1 weights -- balanced; the unfixable pair exists only at B = 16 (5 vs 17). | planner P-A (ADR 0001 M-1), confirmed by node arithmetic | DB-8 mutation-tested gates (run the mutant against the claimed witness) |
| B-15 | (S3) The Adams size-only-weight mutant is EQUIVALENT on I-1 shapes (3(wl-1) >= wr-1 implies 3wl >= wr): it cannot be a deletion witness. | planner P-A | DB-8 (a mutant that no gate can kill is not a control) -> W-DEL / W-INS / W-TIE |
| B-16 | (S3) ROADMAP HOT PATH "<= 15 leaf moves" is false: an interior split at p = 1 writes 16 at B = 16. | planner P-A | DB-9 count-first claims |
| B-17 | (S1) Finger rule incomplete: (a) an ordinary miss does not move the finger and no epoch bump follows a non-finger mutation -> stale positional base returns a wrong row (B = 8, 9 rows, setMeasure(0), indexAtSum(75) -> 7, true 5); (b) draining the last element frees the leaf on a "hit" -> the next insert writes a freed leaf; (c) equalize ("no shape change") leaves a stale keyed fence -> I-6 broken. ADR 0001 and 0003 also define "hit" differently. SECOND finger-class bug (B-3) -> STANDING GATE: every op stream run with the finger enabled and disabled must give identical answers and identical walker state. | DB-1 adversarial review (also pre-read P-4) | DB-6 metamorphic (finger on == finger off) + DB-2 with the finger live |
| B-18 | (S2) Epoch storage / wrap / clear() unspecified: b.clear() O(1) pool reset then a's insert reuses b's finger leaf; an Int32 epoch re-matches after 2^32 bumps; a plain field leaves Smi range after 2^30. | DB-1 | DB-7 boundary catalogue (counters and epochs at 2^30 / 2^31 / 2^32) |
| B-19 | (S2) ADR 0003 G-12 "prepends mirror" is false for moves: a prepend into a packed leaf shifts every element (B = 16, 200 prepends: 1960 moves vs formula 45). | DB-1 | DB-9 count-first (simulate the edge stream before writing the formula) |
| B-20 | (S2) ADR 0004 assertion-1 control can never fail: views 1365/1365/1366 make <= 1023 leaves under ADR 0001 T-9, not 1026; and 0004 A-5 ("one under-min leaf per view") contradicts T-9. Working control: views 1 / 1 / 4094 -> 1025. | DB-1 | DB-8 (run every control against the correct code AND the mutant before writing it down) |
| B-21 | (S2) No way to choose B: DB-2 needs B = 4 / 8, the .d.ts options are { dims } only. | DB-1 | DB-11 spike (write the test harness against the API first) |
| B-22 | (S2) The entity argument is never validated: undefined -> 0, 2^31 -> -2^31, 1.5 -> 1 in an Int32 column (fail open). | DB-1 | DB-7 boundary catalogue (every argument, not only measures) |
| B-23 | (S2) I-7 ("no value >= 2^31 read from a Uint32Array on a hot path") contradicts SumMap's uint32 key column. | DB-1 | DB-7 + the lite-loglogn C-14 boxing lesson |
| B-24 | (S2) The virtual-list consumer needs ops no document specifies: entityAt(i), getMeasure, a SumSequence cursor seek, a dims > 1 insert form that does not allocate, entity -> index (parent column; ADR 0004 O-3 defers it to v0.4). | DB-1 | DB-11 consumer-first spike |
| B-25 | (S3) ADR 0001 T-2's per-ancestor balance check is dead on the hot path: weight = leaf count, so a non-splitting insert / non-underflowing remove changes no weight. | DB-1 | DB-4 (restating the proof's preconditions per op) |
| B-26 | (S3) Seam-repair counts disagree (0004 A-4 "one", 0001 T-7 "<= 2" / join "<= 1", 0003 row 11 "<= 2"); T-7's "both single leaves -> one leaf" is false (10 + 10 -> two leaves). | DB-1 | DB-1 cross-document read |
| B-27 | (S3) Table 3 hysteresis row holds only for the interior split: after a 13 + 4 edge split one remove underflows. | DB-1 | DB-2 |
| B-28 | (S3) No stated MAX_CAPACITY / dims cap: Int32 count overflows near 2^31; indices >= 2^30 leave Smi range. | DB-1 | DB-7 |
| B-29 | (S3) ADR 0003 G-13 can never fail (stack size = H(Lmax) by T-10, so G-13 reduces to "H is monotone"); "H(L) <= log_{4/3}(L) - 1.4" is false at L = 1. | DB-1 | DB-8 |
| B-30 | (S3) ROADMAP 3.1 asked for torture / perf / bench scripts on day 1 with no engine: green on nothing. | pre-read (S0) | DB-8 (a gate with no subject cannot fail) -> ruled: scripts land with their subject |
| B-31 | (S2) The strongest competent SumSequence rival -- the blocked array (sqrt decomposition) -- was missing from the foil table and the loss table, so the benchmark plan could only beat O(n) foils and Fenwick-rebuild. | external review (lite-pick session, 2026-10-25) | DB-1 applied to the benchmark plan: ask "what would a competent engineer write instead?" before fixing the foil list |
| B-32 | (S2) ADR 0001's DB-2 canonical state (shape + leaf sizes) merges states that differ in finger / cursor / pool free-list order, so the exhaustive run can miss the B-17 / B-18 classes; a raw epoch in the signature would instead make nearly every state distinct. | external review of a Canopy blueprint + doc-truth review (2026-10-25), RESEARCH Q-6 | DB-4 applied to the state merge: a merge is sound only if it distinguishes every field the next op reads |

Standing rules from repeated classes (2026-10-25). Class seen twice becomes a standing gate / law
(DB-12). FINGER (B-3, B-17): every op stream is run with the finger enabled and disabled and must give
identical answers and identical walker state (the finger-on == finger-off metamorphic gate).
CONTROL THAT CANNOT FAIL (B-20, B-29, plus the S0 scaffold review's GATE TEETH rejects): every control
is executed against the correct code (must pass) AND against its mutant (must fail) in the session
that writes it.

Lesson for the suite: B-1 is the classic "a proof's assumptions do not survive a representation
change" error. Citing a verified result (Coq / Isabelle) is not verification of OUR structure;
listing the proof's assumptions and checking each one is.

---

## 7. The candidate roster

### Tier 1 -- the members to ship
- **SumSequence** (0.1.0) -- implicit position, multi-dim sums, insertAt / removeAt / setMeasure /
  indexAtSum / sumBefore / splitAt / append, positional finger.
- **SumMap** (0.2.0) -- uint32 keys, get / set / delete, successor / predecessor, rank / select,
  sumBelow / keyAtSum, splitAt / join, fence-key finger.
- **IntervalMap** (0.3.0) -- (start, entityId) order, maxEnd summary, stab / overlap into caller
  typed arrays, split / join.
- **Yggdrasil pool** (0.4.0) -- stable entity ids (raw int32 or a lite-arena handle, Y-12), several
  realms, per-realm back-pointers, remove(id) from all realms.
  Candidate (external review, 2026-10-25): a `realmMask` Int32 column per entity, bit r set while the
  id is in realm r (at most 30 realms, bits 0..29, so the mask stays a Smi across a call -- the
  same reason R-8 picks 30 bits), so remove(id) visits only the realms that
  hold it (lowest-set-bit loop, deterministic order); plus an id-liveness bitset so a double remove
  or an unknown id fails closed. NOT a fix for B-22 (that is v0.1 argument validation: typeof + an
  int32-range integer guard (-2^31 <= x <= 2^31 - 1) on the caller's int32 id; an integer test alone
  passes B-22's 2^31 witness, which an Int32 column stores as -2^31).

### Tier 2 -- strong candidates
- **Lazy range measure update** (shift every clip in a range by dt; collapse a section) -- a lazy tag
  per node; needs its own invariant set.
- **Percentile / quantile helper** over a SumMap count or weight dim.
- **Rope payload helper** (piece-table recipe for text) -- a recipe first, a member only if earned.

### Tier 3 -- research track (measured, never assumed)
- R-4 **Cracked leaves** (unsorted append, sort / select at burst): pays only if the measured
  crossover moves; in-order scans then pay a per-leaf sort.
- R-7 **B+ internal fanout** vs the binary trunk: shallower and cache-friendlier, harder split / join.
- R-8 **Epoch persistence**: birth / death epoch per node, free only when no live snapshot falls in
  [birth, death); leaves copied whole; secondary realms not versioned (a documented limit); fixed
  arena fills faster (fail closed). A proposed 30-bit live-snapshot mask (`spanMask = (1 << d) -
  (1 << b)` ANDed with the live mask) is WRONG as stated: epochs are monotone counters and snapshot
  slots are reused, so bit order stops matching time order after the first reuse; the single AND is
  only correct for at most 30 epochs ever; past that `1 << d` wraps mod 32 and the AND can read
  0, silently freeing a node a live snapshot still reads. A ring with renumbering could rescue it, at the cost
  of the one-instruction claim.
- R-9 **Prefix bit-directory as a lookup aid (SumMap, keys spread over the uint32 range)**: the "Canopy" of an
  early blueprint -- a bit directory over the top 16 key bits (65,536 prefixes: 4 levels of 32-ary words;
  lite-fastbit32's two-level FastBit1024 covers only 1,024). As a ROUTER above the
  trunk it is declined (below). If explored at all, it is a read-only table BESIDE the single BB<3,2>
  trunk mapping each populated prefix to the lowest trunk node covering it (a leaf id only when the
  prefix holds at most one leaf of keys), to skip the top trunk levels on random point lookups.
  Every leaf split / merge / equalize changes which leaf owns which prefixes, so maintenance is not
  O(1); "saves 6-8 levels" needs a count before it is believed. Gate: measured lookups saved vs
  directory maintenance on a split / merge stream.

### Declined (do not reopen without new evidence)
- SWAR key signatures in leaves: help equality only, not ordered seek; BigInt64Array lanes allocate.
- A user callback monoid in the pull loop: a polymorphic call site deopts; fixed kinds only.
- A prefix bit-directory as the top-level ROUTER ("Canopy", 2026-10-25): sharding the key space into
  up to 65,536 sub-trees breaks every summary op (successor / predecessor across buckets
  is what a bit directory does well) -- sumBelow / keyAtSum / rank / select need a summary
  over the directory (in effect a Fenwick over the buckets) and splitAt / join become O(buckets).
  The lookup-aid variant is R-9.
- Per-view arena OWNERSHIP bitsets (2026-10-25): after splitAt every leaf on the right side changes
  owner, so maintaining the masks makes splitAt / append O(leaves moved), not O(log n) -- it breaks the
  ADR 0004 headline (A-4). B-18 stays OPEN (ADR 0004 DB-1 findings): A-6's O(1) reset with A-7
  bumping epochs only on splitAt / append IS the B-18 case (b.clear() resets the pools; a's next
  insert takes the leaf b's still-valid finger names). Its fix is a clear()-time epoch bump / finger
  reset for the SumSequence planner, not ownership bits; the wrap / Smi-range parts are counter
  width, not ownership.
- A per-leaf positive-measure mask for zero-height skipping: the strict seek (I-4) already skips
  zero measures and tree-level sums skip collapsed runs; inside <= B slots (16 default, up to 32 by ADR 0001
  T-5) the saving is expected to be small (unmeasured)
  and the mask is one more column every insert / remove / split / merge must shift. Reopen only for
  a consumer that needs "next visible row" iteration.
- From an external review (2026-10-26), each checked against the ruled ADRs:
  - clear() zeroing the diagnostic counters: contradicts ADR 0003 G-8 (RULED, R-Y09) -- clear() keeps
    the counters, resetCounters() zeroes them.
  - An epoch stepped by a large odd constant "so a wrap collision is astronomically unlikely": any odd
    step k has period exactly 2^32 in a 32-bit counter, the same as k = 1, so it buys nothing. B-18's
    fix stays with the SumSequence planner (finger reset on splitAt / append / clear plus an epoch that
    cannot re-match).
  - A "sticky finger" that skips the fence check after a sequential call: the fence check is what
    B-3 and B-17 are about (a class seen twice); skipping it saves only the range test (nominal: one or two compares) and does not change the
    hit count. Sequential walks use the cursor (Y-11), not the finger.
  - A zero-copy view of a leaf range: a `subarray()` allocates per call, and it hands the caller
    writable engine storage -- one write breaks every cached sum (fail open). The candidate instead is
    a copy-out read into caller typed arrays (O(log n + k) expected, 0 B).
  - A construction `profile` preset ("virtual-list", "editor", ...): the finger policy and the summary
    kinds are fixed by design, so a preset could bundle only B and dims -- a string option that hides
    parameters from README examples.
  - A rest-parameter insert for dims > 1: a rest array allocates per call (ROADMAP 3.6: 0 B/op on insertAt).
    The non-allocating dims > 1 form stays OPEN (B-24): a caller-preallocated Float64Array,
    or fixed positional measure arguments (dims <= 4, Y-10 lean).
  - A capacity ceiling chosen to keep "height + spine + counters" in Smi range (e.g. 2^26): counters
    are Int32 that wrap by design (ADR 0003 G-5) and height <= H(2^29) = 67; the binding limits are
    indices and the count column (B-28; lean: MAX_CAPACITY <= 2^30 - 1) and ADR 0001 T-9's
    Lmax <= 2^29, which binds first at B = 4 / 8 (C <= m x (2^29 - K)).
  - A quantile-helper "numerical stability near 2^53" concern: every partial sum is exact by
    ADR 0002 M-6, so the sums cannot drift; the one rounding step is the helper's own q -> target conversion
    (q * total rounds, ulp 1 in [2^52, 2^53), and can move a strict seek by one element) -- a rule the
    helper spec must state (e.g. an integer rank target), not a trunk concern; the 2^53 - 1 bound (M-4)
    is the fail-closed total check.

---

## 8. Boundaries with sibling packages

- **lite-logn**: textbook O(log n) members incl. its planned IntervalTree (D7: both exist, distinct).
  lite-logn is a devDep oracle / foil here, never a runtime dep.
- **lite-loglogn**: integer-universe successor (StratifiedBitset / XFastTrie / YFastTrie). Shares the
  bucket-hysteresis lesson (YFastTrie K / h) and the boxing lesson (C-14), no code.
- **lite-o1**: BitSet, CuckooMap, SparseSet -- usable by the pool for id liveness; devDep only.
- **lite-arena**: generational handles -- the candidate id source for the pool (Y-12).
- **lite-fastbit32 / fastbit1024**: occupancy masks if R-4 ever ships.
- Consumers (LiteVirtual, LiteTimeline, LiteKeyframe, LiteDataTable, LiteDiCron): recipes or optional
  peers on THEIR side; lite-yggdrasil never imports them.

---

## 9. Prior art (sources)

- Zed `sum_tree`: docs.rs/zed-sum-tree; "Rope & SumTree" write-up via simonwillison.net/b/7735.
- VS Code piece tree: code.visualstudio.com/blogs/2018/03/23/text-buffer-reimplementation.
- `sorted-btree` (qwertie/btree-typescript): cdn.jsdelivr.net/npm/sorted-btree@2.1.0/readme.md.
- `@flatten-js/interval-tree` (Cormen interval tree, object nodes).
- Nievergelt and Reingold, "Binary search trees of bounded balance", 1972/73.
- Hirai and Yamamoto, "Balancing weight-balanced trees", JFP 21(3) 2011 (<3,2> unique integer pair,
  weight = size + 1 for the N-R scheme; Coq-checked). Notes: mew.org/~kazu/proj/weight-balanced-tree/
- Nipkow and Dirix, "Weight-Balanced Trees", Isabelle AFP (a verified spec to test against).
- Blelloch, Ferizovic, Sun, "Just Join for Parallel Ordered Sets", SPAA 2016.
- Idreos, Kersten, Manegold, "Database Cracking", CIDR 2007 (R-4).
- Heinz, Zobel, Williams, "Burst tries", 2002 (R-4).
- Graefe, "Modern B-Tree Techniques", 2011 (fence keys; monotonic-insert split).
- Jackson, "Software Abstractions" (Alloy; the small-scope hypothesis behind DB-2).

---

## 10. Open questions

- Q-1 Leaf size B per facade: 16 uint32 keys is one cache line; SumSequence carries no keys, so its
  leaf may be measure-bound instead (16 x dims x 8 B). Measure, REPORTED.
- Q-2 Max dims per instance (fixed at construction; 1..4?) and its effect on pull cost.
- Q-3 Cursor API: one preallocated cursor per instance vs a caller-owned cursor object created once.
- Q-4 Id source for the pool: raw int32 vs lite-arena handle (generation checks cost a load per op).
- Q-5 Whether IntervalMap needs a min-start summary for "free slots in [a, b)" (S5).
- Q-6 DB-2 state signature (external review, 2026-10-25): de-duplication is already RULED -- ADR 0001
  (DB-2 B values) defines DB-2 as a BFS over canonical states (shape + leaf sizes); test code may
  allocate (a `Set` of canonical serializations). TRAP, against that ruled signature: shape + leaf
  sizes merges states that differ in finger / cursor / free-list order and hides exactly the B-17
  finger class (and B-18's reused leaf). Either the signature is the full engine state (shape, leaf
  sizes, pool free heads; per view root, finger leaf + a finger-valid bit, cursor), each epoch
  reduced to that valid bit (a raw monotone epoch makes nearly every state distinct), or the
  shape-only BFS runs finger-disabled and every reached state's witness stream is replayed finger-on
  (FINGER standing rule). Logged as B-32 against ADR 0001. "Depth 14-16 in milliseconds" is unmeasured.
