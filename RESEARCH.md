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
11. Post-0.1.1 review notes (2026-10-28) -- Zed tests, sibling patterns, positioning claims, caching,
    external reviews #2 and #3 assessed, the maintainer's learning guides

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
  c = 2.409 of log2 L is REPORTED only), k(op) = 0 (0005 C-25) -- an exact, host-independent line. The foil's count (elements moved) is n-linear.
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
- I-9 **Finger**: positional only, per-view path stack, no epoch (0005 C-1..C-5).

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
| B-17 | (S1) Finger rule incomplete: (a) an ordinary miss does not move the finger and no epoch bump follows a non-finger mutation -> stale positional base returns a wrong row (B = 8, 9 rows, setMeasure(0), indexAtSum(75) -> 7, true 5); (b) draining the last element frees the leaf on a "hit" -> the next insert writes a freed leaf; (c) equalize ("no shape change") leaves a stale keyed fence -> I-6 broken. ADR 0001 and 0003 also define "hit" differently. SECOND finger-class bug (B-3) -> STANDING GATE: every op stream run with the finger enabled and disabled must give identical answers and identical walker state. -> CLOSED 0005 C-1..C-5 (c: DEFERRED SumMap) | DB-1 adversarial review (also pre-read P-4) | DB-6 metamorphic (finger on == finger off) + DB-2 with the finger live |
| B-18 | (S2) Epoch storage / wrap / clear() unspecified: b.clear() O(1) pool reset then a's insert reuses b's finger leaf; an Int32 epoch re-matches after 2^32 bumps; a plain field leaves Smi range after 2^30. -> CLOSED 0005 C-6 | DB-1 | DB-7 boundary catalogue (counters and epochs at 2^30 / 2^31 / 2^32) |
| B-19 | (S2) ADR 0003 G-12 "prepends mirror" is false for moves: a prepend into a packed leaf shifts every element (B = 16, 200 prepends: 1960 moves vs formula 45). -> CLOSED 0005 C-19 | DB-1 | DB-9 count-first (simulate the edge stream before writing the formula) |
| B-20 | (S2) ADR 0004 assertion-1 control can never fail: views 1365/1365/1366 make <= 1023 leaves under ADR 0001 T-9, not 1026; and 0004 A-5 ("one under-min leaf per view") contradicts T-9. The proposed 1 / 1 / 4094 control fails too (peaks at 1023); 1365/1365/1366 at 1017; control = C-36. -> CLOSED 0005 C-36 | DB-1 | DB-8 (run every control against the correct code AND the mutant before writing it down) |
| B-21 | (S2) No way to choose B: DB-2 needs B = 4 / 8, the .d.ts options are { dims } only. -> CLOSED 0005 C-11 | DB-1 | DB-11 spike (write the test harness against the API first) |
| B-22 | (S2) The entity argument is never validated: undefined -> 0, 2^31 -> -2^31, 1.5 -> 1 in an Int32 column (fail open). -> CLOSED 0005 C-9 | DB-1 | DB-7 boundary catalogue (every argument, not only measures) |
| B-23 | (S2) I-7 ("no value >= 2^31 read from a Uint32Array on a hot path") contradicts SumMap's uint32 key column. -> DEFERRED SumMap | DB-1 | DB-7 + the lite-loglogn C-14 boxing lesson |
| B-24 | (S2) The virtual-list consumer needs ops no document specifies: entityAt(i), getMeasure, a SumSequence cursor seek, a dims > 1 insert form that does not allocate, entity -> index (parent column; ADR 0004 O-3 defers it to v0.4). -> CLOSED 0005 C-12 | DB-1 | DB-11 consumer-first spike |
| B-25 | (S3) ADR 0001 T-2's per-ancestor balance check is dead on the hot path: weight = leaf count, so a non-splitting insert / non-underflowing remove changes no weight. -> CLOSED 0005 C-20 | DB-1 | DB-4 (restating the proof's preconditions per op) |
| B-26 | (S3) Seam-repair counts disagree (0004 A-4 "one", 0001 T-7 "<= 2" / join "<= 1", 0003 row 11 "<= 2"); T-7's "both single leaves -> one leaf" is false (10 + 10 -> two leaves). -> CLOSED 0005 C-21 | DB-1 | DB-1 cross-document read |
| B-27 | (S3) Table 3 hysteresis row holds only for the interior split: after a 13 + 4 edge split one remove underflows. -> CLOSED 0005 C-22 | DB-1 | DB-2 |
| B-28 | (S3) No stated MAX_CAPACITY / dims cap: Int32 count overflows near 2^31; indices >= 2^30 leave Smi range. -> CLOSED 0005 C-14 | DB-1 | DB-7 |
| B-29 | (S3) ADR 0003 G-13 can never fail (stack size = H(Lmax) by T-10, so G-13 reduces to "H is monotone"); "H(L) <= log_{4/3}(L) - 1.4" is false at L = 1. -> CLOSED 0005 C-23 | DB-1 | DB-8 |
| B-30 | (S3) ROADMAP 3.1 asked for torture / perf / bench scripts on day 1 with no engine: green on nothing. | pre-read (S0) | DB-8 (a gate with no subject cannot fail) -> ruled: scripts land with their subject |
| B-31 | (S2) The strongest competent SumSequence rival -- the blocked array (sqrt decomposition) -- was missing from the foil table and the loss table, so the benchmark plan could only beat O(n) foils and Fenwick-rebuild. | external review (lite-pick session, 2026-10-25) | DB-1 applied to the benchmark plan: ask "what would a competent engineer write instead?" before fixing the foil list |
| B-32 | (S2) ADR 0001's DB-2 canonical state (shape + leaf sizes) merges states that differ in finger / cursor / pool free-list order, so the exhaustive run can miss the B-17 / B-18 classes; a raw epoch in the signature would instead make nearly every state distinct. -> CLOSED 0005 C-31 | external review of a Canopy blueprint + doc-truth review (2026-10-25), RESEARCH Q-6 | DB-4 applied to the state merge: a merge is sound only if it distinguishes every field the next op reads |

Standing rules from repeated classes (2026-10-25). Class seen twice becomes a standing gate / law
(DB-12). FINGER (B-3, B-17): every op stream is run with the finger enabled and disabled and must give
identical answers and identical walker state (the finger-on == finger-off metamorphic gate; walker state = 0005 C-27).
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
  indexAtSum / sumBefore / splitAt / append, positional finger (positional ops only, 0005 C-2).
- **SumMap** (0.2.0) -- uint32 keys, get / set / delete, successor / predecessor, rank / select,
  sumBelow / keyAtSum, splitAt / join, fence-key finger.
- **IntervalMap** (0.3.0) -- (start, entityId) order, maxEnd summary, stab / overlap into caller
  typed arrays, split / join.
- **Yggdrasil pool** (0.4.0) -- stable entity ids (raw int32 or a lite-arena handle, Y-12), several
  realms, per-realm back-pointers, remove(id) from all realms.
  Candidate (external review, 2026-10-25): a `realmMask` Int32 column per entity, bit r set while the
  id is in realm r (at most 30 realms, bits 0..29, so the mask stays a Smi across a call -- the
  Chrome / Electron Smi ceiling, 0x3FFFFFFF), so remove(id) visits only the realms that
  hold it (lowest-set-bit loop, deterministic order); plus an id-liveness bitset so a double remove
  or an unknown id fails closed. NOT a fix for B-22 (that is v0.1 argument validation: typeof + an
  `(e & 0x3FFFFFFF) === e` guard, [0, 2^30-1] (0005 C-9), on the caller's id; an integer test alone
  passes B-22's 2^31 witness, which an Int32 column stores as -2^31).

### Tier 2 -- strong candidates
- **Lazy range measure update** (shift every clip in a range by dt; collapse a section) -- a lazy tag
  per node; needs its own invariant set (rows from an outside proof sketch, corrected: 11.7 C).
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
  of the one-instruction claim. Refcounted path copying is the standard rescue, but it conflicts with the
  pool's parent column and back-pointers and with the C-4 finger hit (11.7 A).
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
  ADR 0004 headline (A-4). B-18 is CLOSED (0005 C-6): A-6's O(1) reset with A-7
  bumping epochs only on splitAt / append IS the B-18 case (b.clear() resets the pools; a's next
  insert takes the leaf b's still-valid finger names). Its fix is no epoch and a finger NIL at
  clear() (0005 C-5, C-6), not ownership bits; the wrap / Smi-range parts are counter
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
    step k has period exactly 2^32 in a 32-bit counter, the same as k = 1, so it buys nothing. B-18 is
    closed with no epoch at all (0005 C-6).
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
    The non-allocating dims > 1 form is CLOSED (B-24, 0005 C-10): fixed positional measure arguments /
    insertAt(i, e, m0, m1?, m2?, m3?), dims <= 4; no Float64Array form (0005 C-13).
  - A capacity ceiling chosen to keep "height + spine + counters" in Smi range (e.g. 2^26): counters
    are Int32 that wrap by design (ADR 0003 G-5) and height <= H(2^29) = 67; the binding limits are
    indices and the count column (B-28; caps = 0005 C-14).
  - A quantile-helper "numerical stability near 2^53" concern: every partial sum is exact by
    ADR 0002 M-6, so the sums cannot drift; the one rounding step is the helper's own q -> target conversion
    (q * total rounds, ulp 1 in [2^52, 2^53), and can move a strict seek by one element) -- a rule the
    helper spec must state (e.g. an integer rank target), not a trunk concern; the 2^53 - 1 bound (M-4)
    is the fail-closed total check.
- An intrusive leaf chain nextLeaf / prevLeaf (external review #2, 2026-10-28): cursor next() already
  crosses leaves through _cross() (pop to the common ancestor, push the next leftmost path: amortized
  O(1) per step over a walk), and neighbour leaves for merge / equalize / seams come from the descent
  stacks. A chain adds two columns rewritten at every split, merge, seam repair, join and splitAt cut,
  and more state for the DB-2 signature (B-32). Reopen only if counts show a member needs O(1) leaf
  neighbours outside a descent.

---

## 8. Boundaries with sibling packages

- **lite-logn**: textbook O(log n) members incl. its planned IntervalTree (D7: both exist, distinct).
  lite-logn is a devDep oracle / foil here, never a runtime dep. It ships EulerTourTree / LinkCutTree
  (dynamic forests), WaveletTree (static wavelet matrix) and PersistentSegTree (path copying): not
  duplicated here (11.7).
- **lite-loglogn**: integer-universe successor (StratifiedBitset / XFastTrie / YFastTrie). Shares the
  bucket-hysteresis lesson (YFastTrie K / h) and the boxing lesson (C-14), no code.
- **lite-o1**: BitSet, CuckooMap, SparseSet -- usable by the pool for id liveness; devDep only. Its
  TimerWheel / HierarchicalTimerWheel / CoarseTimerWheel cover timing wheels (11.7).
- **lite-arena**: generational handles -- the candidate id source for the pool (Y-12). Its 1.10.0 handle
  design (FREE bit, retirement, sparse-set back-pointers) is the reference for the pool (section 11.3).
- **lite-fastbit32 / fastbit1024**: occupancy masks if R-4 ever ships; one membership word per element is
  the reference for pool realm membership at k <= 32 (section 11.3).
- **lite-bvh**: an augmented-summary tree over typed arrays (AABB union); the reference for IntervalMap
  query output and summary refit (section 11.3). Patterns only, no code or dependency.
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
- Zed `sum_tree` source and tests (read 2026-10-28): github.com/zed-industries/zed, crates/sum_tree/src/
  sum_tree.rs (`test_random`, `test_cursor`), cursor.rs, property_test.rs (a proptest generator only).
- Jackson, "Software Abstractions" (Alloy; the small-scope hypothesis behind DB-2).

---

## 10. Open questions

- Q-1 Leaf size B per facade: 16 uint32 keys is one cache line; SumSequence carries no keys, so its
  leaf may be measure-bound instead (16 x dims x 8 B). Measure, REPORTED.
- Q-2 Max dims per instance (fixed at construction; 1..4?) and its effect on pull cost (closed: 0005 C-14).
- Q-3 Cursor API: one preallocated cursor per instance vs a caller-owned cursor object created once (closed: 0005 C-7).
- Q-4 Id source for the pool: raw int32 vs lite-arena handle (generation checks cost a load per op).
  2026-10-28: the entity is 30-bit, so a generation packed into it costs index bits (lite-arena packs
  12 gen + 20 index bits into int32); see section 11.3.
- Q-5 Whether IntervalMap needs a min-start summary for "free slots in [a, b)" (S5).
  ANSWER (orchestrator 2026-10-28, not ruled): no. Start is the sort key, so a subtree's minimum start is
  its leftmost key (found by descent, no column). Free gaps come from maxEnd alone: a point t is free iff
  maxEndBelow(t) <= t, where maxEndBelow(t) = max end over intervals with start <= t (a prefix-max
  descent, the MAX analogue of sumBelow). Loop: w = a; while w < b: c = maxEndBelow(w); if c > w then
  w = c (continue); else s = successor start > w (descent) and report [w, min(s, b)), then w = s.
  Cost: O((k' + g) log n) for g gaps and k' waterline advances. CORRECTION to external review #2: a
  cluster is NOT coalesced in O(log n) steps -- chained intervals [0,2], [1,3], [2,4], ... advance w by
  2 per step, so k' is O(cluster size) in the worst case. Edge cases to specify in the 0.3 ADR: zero-
  length intervals (one splits a free gap into two touching gaps, e.g. [13,14) and [14,17)), an interval
  starting exactly at w, and open / closed ends. Checked by a seeded brute-force comparison (20,000 cases,
  0 mismatches; a reviewer's one-off check, 2026-10-28, script not kept).
- Q-6 DB-2 state signature (external review, 2026-10-25): de-duplication is already RULED -- ADR 0001
  (DB-2 B values) defines DB-2 as a BFS over canonical states (shape + leaf sizes); test code may
  allocate (a `Set` of canonical serializations). TRAP, against that ruled signature: shape + leaf
  sizes merges states that differ in finger / cursor / free-list order and hides exactly the B-17
  finger class (and B-18's reused leaf). Either the signature is the full engine state (shape, leaf
  sizes, pool free heads; per view root, finger leaf + a finger-valid bit, cursor), each epoch
  reduced to that valid bit (a raw monotone epoch makes nearly every state distinct), or the
  shape-only BFS runs finger-disabled and every reached state's witness stream is replayed finger-on
  (FINGER standing rule). Logged as B-32 against ADR 0001. "Depth 14-16 in milliseconds" is unmeasured. Closed: 0005 C-31.
- Q-7 (pool) Back-pointer target: an element POSITION is rewritten on every move (in-leaf shifts, splits,
  merges, equalizes, seam repairs), so back-pointer writes would equal `moves`; a LEAF target changes only
  on cross-leaf moves and costs an O(B) in-leaf scan per lookup. Count both before choosing (section 11.3).
  LEAN (orchestrator 2026-10-28, not ruled; refines ADR 0004 O-3 and 0005 C-12): a positional realm
  cannot remove by id without a leaf -> root PARENT column -- with only a leaf id there is no index to
  re-descend by, and the sums above the leaf must be pulled. That is ADR 0004 O-3, deferred by 0005 C-12
  because an entity -> slot back-pointer "needs an entity-slot write on every leaf move, which is hot".
  A LEAF-target back-pointer (backLeaf per realm) plus the parent column narrows that objection: an
  in-leaf insert writes ONE backLeaf entry (the new element's) and a remove clears one; no other
  element's entry and no parent changes. Only cross-leaf moves (split, merge, equalize, seam repair,
  splitAt cut) rewrite backLeaf for the moved elements, and parent writes happen only at relinks (split,
  rotation, merge splice, join, splitAt, ygFirstLeaf, ygDrain, ygRepair's root collapse, and the root
  hand-offs in append / splitAt, where the root's parent slot is ~viewIndex per O-3) -- all cold. The
  hot in-leaf body gains one store per insert / remove, in the opt-in build only: a ROADMAP 3.7 hot-body
  edit, as O-3 says. Walking parents up also yields the element's index (sum of left-sibling counts) and its
  sumBefore -- B-24's entity -> index. Costs to count: one Int32 column per node kind, a census gate that
  every relink site writes parent (like 0003 G-6), walker reciprocity checks, and an opt-in built as a
  separate monomorphic path at construction (D11 shape or lite-lru 0017 option (b), not a null guard;
  section 11.5). ROADMAP 3.7's
  byte-identity rule for prior members still applies to the shared cold helpers.
- Q-8 (IntervalMap) stab / overlap into a caller buffer: return the count written (lite-bvh) or the total
  match count (lets the caller size a retry)? Maintainer call.
- Q-9 (pool) Realm count: one int32 membership word caps k at 32; k > 32 needs a two-level map
  (FastBit1024 shape) or a hard cap.

---

## 11. Post-0.1.1 review notes (2026-10-28)

Orchestrator notes after 0.1.1 shipped. Sources: Zed's `sum_tree` crate read at its GitHub head on
2026-10-28; three read-only readers over LiteArena 1.10.0 (2c7af47), LiteBvh 2.0.0 (57d1517) and
LiteFastBit32 1.5.0 (36d6b73); file:line evidence in .handoff/BORROW-2026-10-28.md (repo-local, gitignored).
Nothing here is ruled unless a maintainer quote says so.

### 11.1 Zed `sum_tree` tests against ours

- Zed's `test_random`: 100 seeds x 5 operations by default (SEED / ITERATIONS / OPERATIONS env vars),
  each a splice built from cursor `slice` + `extend` + `append`, checked against a reference Vec; then a
  filter cursor walked next / prev against the reference, a cursor seek + 10 steps checking
  `item` / `prev_item` / `next_item` / `start`, and 10 random range summaries == the slice's summary.
- Ours already exceeds it on most axes: the plain-array oracle (test/oracle.mjs) after every op, the
  invariant walker (I-1..I-9 except I-4, oracle-checked, and I-6, n/a) after every op, exhaustive
  small-scope BFS lanes, exact per-op count models (spec-counts / stubs), must-fail mutants and the
  torture gates. Zed's sum_tree.rs tests have no count oracle, structural walker or allocation gate (the
  other sum_tree files were not read for tests).
- The one real gap: cursor walks are checked only on BFS states (small n) and on insert-only shapes
  (random-position inserts n <= 40 and a 1000-element insertAt-at-end stream; test/Cursor.test.mjs rows
  4 / 10, test/CursorLane.test.mjs). No in-suite lane walks the cursor on trees shaped by random removes,
  merges, equalizes and seam repairs, and no lane walks cursors against the oracle on 3+ views across
  clear() while siblings hold nodes. The audit-2 differential fuzzer did both (15.0M next() steps, k 1..6)
  but lives in audit/2026-10-27/claude/r2/, outside `npm test`.
- Borrowable: a seeded differential soak (Zed's shape + SEED / ITERATIONS / OPERATIONS replay; print the
  failing seed and op index) with a must-fail mutant control. Maintainer 2026-10-28: "Leave it as a future
  idea good-to-have".
- Not borrowable: prev / prev_item / next_item, Bias, filter cursors, seek_forward, slice-by-cursor are API,
  not tests; persistence and Arc sharing do not apply to a mutable arena.
- Correction to an external comparison: Zed's `slice` / `append` share whole subtrees in O(log n) and
  clone only the seam leaves' items (path copying through Arc::make_mut). Yggdrasil's difference is
  mutability in one preallocated arena (no per-node allocation), not "no copy" -- a mid-leaf splitAt cut
  and every seam repair do move elements (counted in `moves`).

### 11.2 External positioning claims, checked (for README "Why this exists")

- TRUE, deterministic, usable: one shared arena with up to 4096 views; append / splitAt relink nodes (no
  element-by-element copy of the range); a finger hit adds 0 touches, hits / misses counted separately;
  12 exact public counters (frozen COUNTERS); columns allocated once, no per-node objects; one cursor per
  view, invalidated by every mutator, O(1) offset; fail-closed validation incl. did-you-mean option names
  and the clear() corrupt-view check.
- NOT usable as written: "dramatically cheaper" for local access (a timing claim, unmeasured; only the
  touch counts are claimable); "without GC" against Zed (Rust has no GC; its cost is refcounting and path
  copying); "almost no GC pressure" without the C-13 qualifier (b = 1 box per big-lane read); "Zed has
  nothing this granular" (unverified).
- Of eight recommended test additions, seven already exist (count oracles, walker after every op, finger
  matrix, headroom / zero edges, forced pool exhaustion in test/Core.test.mjs, the I-8 height bound, a
  second model in stubs.mjs); the eighth (multi-view interleaving with cursors) is section 11.1's gap.

### 11.3 Sibling patterns that transfer (copy, never import)

Already in Yggdrasil: a bounded preallocated descent stack (lite-bvh queryStack); cold error builders;
a frozen-build env override (YG_ENGINE); must-fail controls; an O(n) structural checker (stronger than
lite-bvh validate()); brand checks through cached intrinsic getters (lite-arena M-23 == R-A8).

- IntervalMap 0.3.0 (lite-bvh): caller-buffer queries return the count written and test `hits >= cap`
  BEFORE the write (a 0-length buffer records nothing, lite-bvh B-02). maxEnd is a summary that queries
  read, so it must be recomputed at every site that recomputes sums (pull passes, rotations, joins,
  repairs, splitAt); lite-bvh shipped a refit that started one level too high, invisible until a balance
  read it. Gate it with a census like 0003 G-6. Input doors: start / end finite, start <= end, NaN
  rejected before any write.
- Bulk constructor (queued): batch-atomic -- validate count, lengths, aliasing, capacity and every element
  before the first write (lite-bvh insertLeaves); differential gate: bulk build == the same sequence by
  single inserts.
- Pool 0.4.0 (lite-arena 1.10.0): generational handle (gen << 20 | index); a FREE bit on free slots so a
  free slot's next handle is already dead; retirement at the max generation instead of wrap (no ABA);
  the signedness trap (generation >= 2048 makes the handle negative: Int32Array only); sparse-set
  back-pointers verified by the full handle; despawn fans out over every registered set. See Q-4, Q-7.
- Pool membership (lite-fastbit32): one int32 word per element for k <= 32 realms; remove(id) from all
  realms is the allocation-free set-bit walk `for (; v !== 0; v &= v - 1) bit = 31 - clz32(v & -v)` (paraphrased; FastBit32.js uses a while loop);
  hasAll as `(~v & mask) === 0` (signedness-safe). See Q-9.
- SumMap 0.2.0 (uint32 keys): a key >= 2^31 stored in an Int32Array reads back negative -- compare
  unsigned and add a key lane at 2^31 - 1, 2^31, 2^31 + 1 and 2^32 - 1 (the lite-arena handle and
  lite-fastbit32 FB-01 bit-31 classes).
- Test-only, any time: a docs-drift test (lite-arena: every public method named in llms.txt, every
  `.method(` in llms.txt examples exists, every relative link resolves); "each control must fail EVERY
  target tier" (lite-fastbit32 T9) as an audit of our controls.
- Only if timing claims ever ship: lite-fastbit32's release gate (K = 5 serial runs, strict-majority vote
  per row, exit 0 / 1 / 2, REPORTED rows present but never voted, a sha256 stamp so prepublish skips an
  unchanged gate).

### 11.4 Lesson: diagrams generated from source comments

An AI-generated workflow diagram (2026-10-28) copied the stale Yggdrasil.js header ("Pre-release engine
build (rung K-R2 ...)", "Nothing is released between rungs" -- still in the shipped 0.1.1 file) and
invented branches (every op through the finger, a repair on every remove, allocation after rotation).
The README diagrams that replaced it ("How an operation runs") needed one review round to remove nine
false claims of the orchestrator's own (merge is 2t <= B, sumBefore descends by counts, ...). Rule:
every diagram node is checked against code lines, never against the file header; the stale header is
a FILLERS item.

### 11.5 Caching: does any member need it? (lite-lru 1.19.0)

No. No queued member (SumMap, IntervalMap, the pool, the bulk constructor) and no Tier 2 item needs an
eviction cache. Yggdrasil's caches are always-coherent derived state -- node sums, the finger (a one-entry
cache of the last leaf), the cursor's _off -- kept correct or reset by rule on every mutation and never
evicted. An LRU inside the engine would be a second source of truth that must be invalidated after every
split, merge and rotation: the B-17 / B-18 stale-finger class. SumMap's fence-key finger is the same kind
of one-entry cache with the same reset rules; a multi-finger with LRU replacement is justified only by
counts. Do not add an LRU.

Patterns that transfer from lite-lru (Lru.js header, decisions 0011 / 0017 / 0019 / 0021 read; the rest
of the 8,492-line file was not):
- IntSlotStore (Lru.js:505-610): an open-addressed Int32 index, linear probing, backward-shift deletion
  (no tombstones), a fixed table at load <= 0.75; its door accepts 32-bit SIGNED keys (:509), so external
  uint32 ids need a changed door. A direct k -> slot map for dense ids is DirectSlotStore (:615, lite-lru
  decisions/0029, not read here). Use a hash only if pool ids are EXTERNAL (a side index id -> handle);
  dense arena-style ids need no hash. Any
  key -> position side index inherits Q-7's cost.
- Opt-ins: D11 picks one of two monomorphic backings at construction (pays nothing); ttl / stats OFF are
  byte-identical IN EFFECT only (same writes per hit, 0 B) behind one predicted-not-taken null guard per
  hot method (0017 option (a), 0019); 0017 option (b), constructor-time specialization, is the zero-byte
  form. The D11 / option (b) shape is the one for optional features (pool realms, Tier 2 lazy range
  update).
- dump() / static restore() (0021): cold, warm reconstruct, no hot-path change -- a candidate sibling of
  the queued bulk constructor (restore = bulk build from saved columns). Not planned.

### 11.6 External review #2 assessed (2026-10-28) -- read before reusing any of it

An external AI review (chapters 1-5: assessment, answers to Q-4 / Q-5 / Q-7, books, papers, structures)
was checked against the ADRs, this file and llms.txt. Summary: chapter 1 is accurate; chapter 2 has one
real refinement and one wrong complexity claim; chapters 3-4 name the right literature with several
wrong venues, authors or chapter pointers; chapter 5's judgments are sound but two attributions are
wrong. Use the corrected forms below, not the review text.

- Ch 1 (assessment): ACCURATE. The boxing contract matches llms.txt:50-54 (0 B/op below 2^30; <= 16b + 1
  in [2^30, 2^40]; insertAt b = dims); 13 | 4 is Table 3's append split at B = 16 (a = B + 1 - m); the R-8
  mask flaw and the declined ownership bitsets match section 7.
- Ch 2A (Q-5): CORRECT IDEA, WRONG BOUND. See Q-5 ANSWER: no minStart column; O((k' + g) log n), not
  O(g log n); it also used an undefined maxEndAt().
- Ch 2B (Q-7 + B-24): USEFUL, NOT NEW. The parent column is ADR 0004 O-3 (deferred by 0005 C-12), not a
  hidden catch. Its new part -- a leaf-target back-pointer removes C-12's per-move objection -- is folded
  into Q-7's LEAN with the opt-in condition and the one hot store it left out.
- Ch 2C (Bench-ADOPT): MOSTLY ALREADY IN section 4.1 (chunk ~1K, cost formulas, chunk tuned per n). Its
  L1-prefetch argument for the chunk-sum scan is a prediction: label it "expected". Keep its good
  suggestion: report seek and splice (cut / paste) timings separately, not as one blend.
- Ch 3 (books): right books, unreliable pointers.
  - Navarro, "Compact Data Structures" (CUP 2016): dynamic structures are chapter 12 ("Dynamic
    structures"), not chapter 6 (chapter 6 is "Sequences"); whether partial sums sit in chapter 12 is
    UNVERIFIED.
  - Okasaki (1998): does NOT cover cached monoidal summaries. Cached subtree sums are older (Knuth
    6.2.3's RANK fields); Hinze and Paterson 2006 give the generic monoid form.
  - Graefe (2011) is organized in sections, not numbered chapters; its fence-key and edge-split content
    is real (already cited in section 9).
  - Jackson (2012) and Knuth vol. 3 6.2.3 / vol. 4A 7.1.3 pointers: plausible, UNVERIFIED.
- Ch 4 (papers):
  - Blelloch, Ferizovic, Sun, "Joinable Parallel Balanced Binary Trees": ACM Transactions on Parallel
    Computing 9(2), 2022 (DOI 10.1145/3512769), NOT JACM; the extended SPAA 2016 version.
  - The 2003 searchable-partial-sums paper is attributed to Hon, Sadakane and Sung in the orchestrator's
    recollection, not "Vitter"; UNVERIFIED (not found online) -- check DBLP before citing. The canonical
    succinct dynamic partial sums result is "Succinct Dynamic Data Structures" (WADS 2001, LNCS,
    DOI 10.1007/3-540-44634-6_39; authors Raman, Raman, Rao from recollection). Cell-probe LOWER bounds come
    from Fredman and Saks (STOC 1989) and Patrascu and Demaine ("Tight bounds for the partial-sums problem", SODA 2004; journal SICOMP 35(4),
    2006 -- venues from recollection, UNVERIFIED), not from these
    upper-bound papers.
  - Bille et al., "Succinct Partial Sums and Fenwick Trees" (SPIRE 2017); Hinze and Paterson (JFP 16(2),
    2006); Boehm, Atkinson, Plass, "Ropes" (SPE 25(12), 1995); Bender, Demaine, Farach-Colton,
    cache-oblivious B-trees (FOCS 2000 / SICOMP 2005, incl. the packed-memory array): as given.
- Ch 5 (structures):
  - Tiered vectors are Goodrich and Kloss (WADS 1999), not Brodal et al.; Rust's im::Vector is an RRB
    tree, not a tiered vector. The fanout-8 / 16 synthesis is R-7, already gated on losing to the blocked
    array at realistic sizes.
  - Priority search tree (McCreight 1985) vs a maxEnd-augmented tree: SOUND. A PST's heap order on end
    breaks split / join by key (P5), which IntervalMap needs; state the trade-off in the 0.3 ADR.
  - Leaf chain: agreed, declined (section 7).
- Its closing offer (map the blocked array's costs 1-to-1 onto COUNTERS): only touches (directory scan
  steps) and moves (element shifts) correspond; a blocked array has no pulls, rotations, joins or seams.
  Pair those two and report the rest as n/a (Bench-ADOPT planner).

Intake rule for future external reviews: check each claim against decisions/ (CURRENT first), this file
and the code before acting; label every citation verified / from recollection / UNVERIFIED; never copy a
complexity bound without a counterexample hunt.

### 11.7 External review #3 assessed (2026-10-29) -- post-0.5.0 proposals

An external AI review proposed work "after v0.5.0": three engine mechanisms (refcounted copy-on-write
with structural diffing, "Norn"; Euler tour trees on SumSequence, "Ratatoskr"; lazy range tags), three
sibling packages (lite-mimir, lite-heimdall, lite-bifrost), three new pipeline gates (DB-13..DB-15) and a
reading list. It was checked against this file, ROADMAP.md, the suite catalog (~/LiteCatalog) and the
LiteLogN 1.5.1 / LiteO1 1.11.3 sources. Summary: it cites this repo correctly (R-8, I-3, DB-4, the 3.2
event rule, the B-ids) but did not check the suite, so three of its five new structures already ship
elsewhere; none of its engine proposals handles the C-4 finger. Nothing here is ruled.

- Framing:
  - There is no v0.5.0 in the plan: after pool 0.4.0 come the demo, then Tier 2 (ROADMAP section 5
    graph); the bulk constructor is queued without a version.
  - Naming: section 1 says the myth names exactly one mechanism (the pool) and "Nothing else in the API
    is named after a myth". In-package "Norn" / "Ratatoskr" names break that rule.
- A. Refcounted copy-on-write + structural diff (R-8): RIGHT MECHANISM, NOT AN ADD-ON.
  - Its account of the R-8 mask flaw matches section 7. Refcounted path copying (copy a node whose count
    is > 1, push the shared reference one level down, on clear() free a node only when its count reaches
    0) is the standard rescue (Zed's Arc::make_mut, 11.1). LiteLogN's PersistentSegTree is path copying
    WITHOUT refcounts: a monotonic bump arena that never frees a node (LiteLogN decisions/0017 D-PST2),
    so it is no precedent for clear().
  - (1) Pool 0.4.0 conflict, missed: the parent column (ADR 0004 O-3) and the Q-7 leaf back-pointer
    assume one parent per node and one leaf per entity; a shared node has a parent per version.
    Persistence and pool back-pointers cannot both hold as designed -- a choice to make before either
    is planned.
  - (2) The finger, missed: a C-4 hit writes its leaf and pulls sums up _fpath with no descent; under
    sharing every hit must check the leaf's and every ancestor's count (a ROADMAP 3.7 hot-body edit, and
    a hit is no longer 0 touches). The review copies only on a descent.
  - (3) Off-spine writes need an unshare too: H-Y rotations move a sibling's child, ygRepair writes the
    in-order neighbour leaf w in the sibling subtree, join and the split seam walk two spines, ygSplitCut reuses popped nodes in place. A
    leaf copy is O(B x dims), not O(1).
  - The diff payoff is overstated: skipping equal node ids is sound, but equalize / merge move unchanged
    entries into new leaves, so a diff costs O(delta x (log n + B)) and yields changed regions, not an
    edit script.
  - Zed does not diff by node identity: its text buffer's edits_since filters fragments by a
    max_version summary (from recollection, UNVERIFIED). The engine-native equivalent is a per-entry
    change stamp with a MAX summary -- the maxEnd mechanism IntervalMap 0.3.0 adds -- giving the rows
    changed since t0 in O(k x (log n + B)) with no persistence and no pool conflict (the stamp's
    width and wrap policy still to state). Removals are invisible
    that way (they need a tombstone or an edit log). An idea, not planned.
- B. Euler tour trees on SumSequence: DECLINE as a facade.
  - Already shipped: LiteLogN 1.5.0 EulerTourTree (Henzinger-King tour in a parent-pointer treap:
    connected, component and subtree folds, expected O(log n), zero allocation) and 1.3.0 LinkCutTree
    (path folds).
  - "85% already built" hides the hard part: link / cut / connected must find where a vertex occurrence
    sits and which tree holds it -- the open Q-7 / parent-column hot-store question. Positional ops
    alone cannot.
  - Counts are off: link = reroot one tour (split + append) + split the other after u + 4 appends (L,
    (u,v), the rerooted tour, (v,u), R) -- 2 splits + 5 appends, or 2 splits + 3 appends + 2 arc
    inserts -- not "2 splitAt + 2 append". Each component is a view, so a cut needs a preallocated view (about n view objects to stay
    zero-GC). A vertex weight must sit on exactly one of its occurrences.
  - A dynamic forest is not dynamic graph connectivity: general connectivity (Holm, de Lichtenberg,
    Thorup; from recollection, UNVERIFIED) needs about log n levels of Euler tour trees plus non-tree edge sets.
  - At most: a benchmark of SumSequence against LiteLogN's treap tour after the pool exists
    (worst-case vs expected bounds, leaf locality).
- C. Lazy range tags (Tier 2): RIGHT PLACE, WRONG PROOF SKETCH. Rows for its DB-4 table when planned:
  - "0 extra node touches" is false: pushing a tag writes both children (off the spine); a rotation
    must push the tag of the node whose child it moves; equalize / merge between leaves with different
    pending tags must apply the sibling's tag first (O(B)). The O(log n) bound survives; touches and
    moves are frozen COUNTERS, so the counts must be stated.
  - Finger and cursor: a tag above the finger leaf leaves its stored measures stale, and the cursor's
    _off reads raw values -- the B-17 / B-18 stale-finger class. A tag op resets the finger, or a hit
    applies pending tags; the spec states which.
  - I-3 guard: a positive integer delta over k elements is checked by total + k x delta <= 2^53 - 1. A
    negative delta ("collapse a section") must keep every measure >= 0: it needs min(range) + delta >= 0,
    a MIN summary or an O(k) scan, which the review omitted. delta must be an integer (B-2).
  - A tag must distribute over every summary the node keeps (+delta over maxEnd is fine; a scale
    factor c only as a non-negative integer, per I-3).
- Sibling packages:
  - lite-mimir (wavelet matrix): DUPLICATE. LiteLogN 1.1.0 ships WaveletTree, a static wavelet matrix
    (Claude / Navarro); 1.4.0 added quantileInto and rebuildFrom; lite-hud takes it as an optional injected peer (its crossCheck
    factory).
  - lite-heimdall: HALF DUPLICATE. The wheel half is LiteO1's TimerWheel (Varghese-Lauck),
    HierarchicalTimerWheel (the Linux tvec shape) and CoarseTimerWheel. A kinetic tournament is absent from the catalog, but pairing
    it with a wheel puts two mechanisms under one name; its research is numeric robustness (float
    certificate times, simultaneous events), not the tree.
  - lite-bifrost: OPEN, MISQUOTED. Bender, Fineman, Gilbert, Tarjan give (from recollection,
    UNVERIFIED) amortized O(min(m^(1/2), n^(2/3))) per inserted edge in the sparse case and no per-edge
    O(log n) bound.
    Lengauer-Tarjan dominators are static (one-shot); incremental dominators are a second problem.
    Pearce and Kelly's dynamic topological sort is the practical baseline (Lengauer-Tarjan and
    Pearce-Kelly from recollection, UNVERIFIED). A suite question (perhaps
    lite-signal's), not this package's.
- Gates:
  - DB-13 (deopt gate parsed from --trace-deopt): REJECT as a gate. Deopts depend on JIT heuristics and
    timing (the B/op lanes already need --no-concurrent-recompilation, llms.txt:59); the trace format
    changes between Node versions; the [2^30, 2^40] lane leaves the Smi range on purpose. Its examples
    miss: an Int32Array store at bit 31 wraps silently with no deopt (key lanes at 2^31 - 1, 2^31, 2^31 + 1
    and 2^32 - 1 catch it, 11.3); "holey arrays" do not apply to typed-array columns. At most a REPORTED, Node-pinned census.
  - DB-14 (transition coverage matrix): KEEP as a good-to-have. It extends the 3.2 rule ("every
    structural event fires > 0") to combinations of (height difference, seam occupancies, rotation kind)
    for join and seam repair. Conditions: every cell is hit or listed unreachable with a reason (else
    the gate cannot fail); calls are classified from outside the engine (the walker reads shapes before
    and after), so the 12 frozen COUNTERS and the hot body stay unchanged; cases come from the DB-2
    B = 4 enumerator.
  - DB-15 (Alloy / TLA+): OPTIONAL design aid. Jackson is already DB-2's source (section 9). A model of
    pool back-pointer reciprocity can help the 0.4.0 DB-1 pass, but it needs a JVM and cannot gate
    npm test; the DB-2 enumerator plus walker reciprocity is already executable small-scope checking.
- Literature:
  - For persistence cite Driscoll, Sarnak, Sleator, Tarjan, "Making data structures persistent" (JCSS
    38, 1989; from recollection), which the review omits. Bagwell's "Ideal Hash Trees" (2001; from
    recollection, UNVERIFIED) covers hash tries, not sequences. Stucki et al., "RRB Vector" (ICFP 2015;
    from recollection, UNVERIFIED) uses GC-managed JVM nodes with radix balance, not refcounting.
  - As the review gave them, from recollection, UNVERIFIED: Henzinger and King (JACM 1999); Tarjan,
    "Dynamic trees as search trees via Euler tours" (Mathematical Programming, 1997); Claude, Navarro,
    Ordonez, "The Wavelet Matrix" (Information Systems, 2015); Varghese and Lauck (SOSP 1987); Basch,
    Guibas, Hershberger (kinetic data structures, SODA 1997 / J. Algorithms 1999). Bender et al. is in
    ACM TALG 12(2); its year (2015 or 2016) is UNVERIFIED.
- Kept for later, not planned: the change-stamp MAX summary (after 0.3.0); DB-14; the C rows in the
  Tier 2 entry; the A conflict in R-8. Declined: an in-package Euler tour facade, lite-mimir, the wheel
  half of lite-heimdall, DB-13 as a gate.

### 11.8 The maintainer's learning guides, read for the next members (2026-10-29)

The maintainer's study notes (~/Work/Portfolio/Learning: BeautifulCode, PracticeOfProgramming,
HotPathCosts read in full by the orchestrator; V8, ElementsKinds, TypedArrays, ENGINE-ANATOMY, Loops,
Bitwise, Trees, OrderedMaps, RangeQueries, DeriveRankSelect, DeriveWindowFoldUint32, SuccinctBits, BigO,
LiteArena, LiteLogN, LiteO1, ObjectPool, DataStructureCatalog swept by three read-only readers) were
checked for what transfers to the queued members. Guide line numbers are as of 2026-10-29. Nothing here is
ruled.

- Delta debugging (BeautifulCode Part 8, Zeller's ddmin): the missing piece beside the seeded soak and the
  transition matrix (11.1 and 11.7, ROADMAP Good-to-have). No test here shrinks a failing op stream. Two engine
  traps: ops carry positions, so a replayed sub-log must normalize each argument against the current
  length (i mod (len + 1) for insertAt; i mod len for removeAt / setMeasure, dropping the op when
  len is 0) to stay legal; and shrink only while the SAME named walker / oracle check
  fails, else ddmin drifts to another bug. A debugging tool, run after a failure, never inside a gate.
- Inlining budgets (PracticeOfProgramming Part 7 Correction 2; V8.md inlining-limit table): every member
  adds bytes to shared hot functions (maxEnd in the pull pass, key compares in the leaf scan). Maglev's
  inline limit is 100 bytecode bytes, and this engine already has Maglev-only boxing rows (decisions/0005
  A17-10). Each member planner runs the two-lane (Maglev and TurboFan) inlining diff on every hot function
  it touches, beside the B/op gate.
- SumMap 0.2.0 keys (Bitwise rules 9, 11, 13; PracticeOfProgramming Correction 1): signed int32 inside,
  unsigned only at the edge. An unsigned compare that stays int32 is (a ^ 0x80000000) < (b ^ 0x80000000)
  -- an option to measure, not a rule. The key lanes of 11.3 stand; what Bitwise rule 13 adds is testing
  each word in both forms (x | 0 and x >>> 0) plus the out-of-domain -1, 2^32 and NaN. The midpoint trap
  (BeautifulCode Part 2) applies only to key-space bisection: use lo + ((hi - lo) >>> 1) there, on the
  uint32 values (not the int32-stored form) and only while hi - lo < 2^32 (sentinels -1 / 2^32 give
  mid = lo forever); the engine's own halvings (Yggdrasil.js:632, :789) are single-operand shifts of small
  sizes (:632 halves B, :789 halves a two-leaf size t < 2B), with no lo + hi sum, so the trap cannot arise.
- SumMap property tests (SuccinctBits, DeriveRankSelect): rank(select(k)) === k for every 0 <= k < size (exclusive rank, 0-based select, SuccinctBits.md 2.1);
  select(rank(x)) === x only when x is a member (for an absent key rank is the insertion point).
- Pool 0.4.0 tests (PracticeOfProgramming 6.2, 6.4; BeautifulCode Part 2, Savoia): a conservation law
  (live + retired + free = capacity, as lite-arena's activeCount + retiredCount + remainingCapacity() ===
  capacity at Arena.js:604, and per-realm membership counts) asserted after every op; the generation
  edges (lite-arena 1.10.0: the sign bit at gen 2048; the Pool's own width is open, Q-4) and retirement reached with a scratch copy that shrinks the generation budget, never
  a shipped option.
- IntervalMap 0.3.0 maxEnd (DeriveWindowFoldUint32, "you can't un-OR"): max is not invertible, so maxEnd
  is recomputed from the children, never adjusted by a delta. The hot pull pass already recomputes: it
  rescans the leaf and reads both children per level (setMeasure Yggdrasil.js:1544-1554; insertAt :1370-1386 and removeAt :1459-1475 have the same shape), so maxEnd fits it as is.
- Bench-ADOPT (BigO Part 4, Dongarra, Loops): a chunked array is O(chunk) + O(n / chunk) per insert, not
  O(1); compare constants and tails at fixed n, not a "no log n" story. Precedent:
  LiteO1/benchmark/ (METHODOLOGY.md, SESSION_A_ADOPT_BRIEF.md, Harness.mjs); provenance template:
  ElementsKinds.md:11-21.
- Lazy range tags (Tier 2): the condition is a monoid ACTION -- apply(tag, summary) computable without the
  children (+c on a range adds c x count to a sum), tags that compose, and apply distributes over the fold (apply(t, x . y) = apply(t, x) . apply(t, y)) -- not
  commutativity of the fold.

Do not import these guide statements into a spec:
- V8.md:509 "a 31-bit signed int" as a law: Node 26 (no pointer compression) has 32-bit Smis
  (ElementsKinds.md:98-99, ENGINE-ANATOMY.md:770); 31-bit holds on pointer-compressed V8 (Chrome, Electron). The 2^30 lane edge in llms.txt
  stays: it is the portable edge, and llms.txt states lanes, not a Smi width.
- OrderedMaps.md:264, :280: deterministic split / merge needing O(n) rebuilds is scapegoat-specific;
  weight-balanced trees split and join in O(log n) (this engine).
- OrderedMaps.md:430-432: lazy reversal is cheap there because its folds are commutative -- sufficient,
  not necessary: a non-commutative fold keeps a reversed aggregate beside the forward one and the tag swaps
  them (a monoid action, above). Do not import commutativity as the condition.
- RangeQueries.md:239-242: folds need only associativity (and an identity, or an empty flag) when left and right
  accumulators are kept apart;
  do not carry a commutativity restriction into a spec.
- Trees.md:158, :224: a BVH query as O(log n) ignores overlap and output size; IntervalMap queries pay per
  reported interval (Q-5 counts it that way).
- BigO.md:82: quickselect is EXPECTED O(n), worst case O(n^2) -- matters for the quantile helper.
- Stale package guides (fix in the Learning repo, not here): LiteArena.md describes 1.9.0 (1.10.0's FREE
  bit is 0x2000, bit 13); LiteLogN.md describes 1.4.0 (no EulerTourTree); DataStructureCatalog calls
  lite-loglogn a scaffold (it is 0.4.0).
