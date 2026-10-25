# lite-yggdrasil -- purpose and v1 scope (Rev 1, 2026-10-25)

Status: the founding scope note. ROADMAP.md and RESEARCH.md are AUTHORITATIVE from here on; where
this note and ROADMAP.md disagree, ROADMAP.md wins. D7 RULED (both, distinct); D1-D6 + D8 are
leans carried into ROADMAP.md section 2 for S0 to settle. Since S0 (2026-10-25) decisions/0001-0004 are RULED; where they differ from this note they win (e.g. the 13|4 edge split, every SUM dim >= 0, the shared arena).

## 1. Purpose, in one sentence

> A zero-GC engine for **mutable ordered sequences where "where is X?" is a sum**: splice anywhere in
> O(log n), seek by ANY running total (count, pixels, bytes, milliseconds, volume), and keep the same
> entities in more than one order -- without object trees, without O(n) `splice`, without a
> prefix-sum array rebuilt on every insert.

The one idea that makes it a single engine and not a bag of trees is the **summary with dimensions**
(the idea behind Zed's SumTree): every element carries a small vector of measures; every node caches
the sum (or max) of its subtree; a cursor can SEEK by any dimension of that summary.

| You seek by...              | ...and you get                 | Classic name                     |
|-----------------------------|--------------------------------|----------------------------------|
| count                       | the k-th element               | rank / select, implicit treap    |
| sum of row heights          | the row at scrollTop = y       | variable-height virtual list     |
| sum of line feeds           | the line containing offset o   | rope / piece table line index    |
| sum of durations            | the clip playing at time t     | timeline / sequencer             |
| sum of volume (keyed)       | the price where depth reaches V| order-book depth                 |
| max of interval end (keyed) | every interval stabbing x      | interval tree                    |

Mythology is the package name and ONE class name, and it maps to a mechanism: `Yggdrasil` (v0.4)
is the shared entity pool whose trees ("realms") all thread the same stable entity ids.

## 2. The problems it solves (what JS does today, and why that fails)

P1. **Positional lookup over a mutable sequence.** Virtual lists with variable row heights, editor
    line/offset maps, timelines of concatenated clips. Today: a prefix-sum array (rebuild O(n) on every
    insert/delete) or a Fenwick tree (O(log n) value updates, but NO insert in the middle -- indices
    shift). Yggdrasil: insert / delete / resize O(log n), offset -> index and index -> offset O(log n).
P2. **Aggregates over a live KEYED set.** "Volume resting above price p", "how many timers before t",
    "the key where cumulative weight crosses y", percentile of a live set. Rank/select by COUNT exists
    in many trees; seek by an arbitrary SUM dimension usually does not.
P3. **Overlap over MUTABLE intervals.** Clips active at t, booking conflicts, 1D sweep-and-prune
    broadphase, decorations overlapping a range. The common JS interval trees are object-node trees.
P4. **Multi-view entities without sync bugs.** An order book needs price-time order AND cancel-by-id;
    timers need deadline order AND per-owner removal; editor decorations need offset order AND id.
    Today: a Map plus a sorted array kept in sync by hand; the delete path is O(n) or leaves stale
    entries. Yggdrasil: one stable entity id, several intrusive orders, delete once -> gone everywhere.
P5. **Bulk structural edits.** Cut/paste a range of rows, move a block of clips, split a set at a
    key, append two sequences: split / join in O(log n) instead of O(n) copies.

## 3. What already exists, and the gap Yggdrasil fills

In the suite (survey 2026-10-25, file:line from LiteLogN/LogN.js v1.5.1 and the consumer packages):
- lite-logn **Treap** (:1912): size-only summary, rank / select by COUNT, split / merge (shared arena,
  consumes both), Float64 keys + values, randomized. **Scapegoat** (:2515): weight-balanced, size-only,
  NO split / merge. **SortedArray** (:6447): O(n) insert / delete. **SegmentTree** (:1079): one of
  min / max / sum / gcd, FIXED length, no seek. **Fenwick** (:557): the only seek-by-sum in the suite
  (`search(target)` :781), but FIXED length -- no insert in the middle.
- No interval tree, stabbing query, sweep-and-prune, SumTree, rope, piece table or multi-index exists
  anywhere in the suite. lite-logn's ROADMAP (:916) PLANS an IntervalTree (augmented BST, Treap-based)
  -> coordinate before v0.3 (decision D7).
- So the gap is exact: **seek by an arbitrary SUM on a MUTABLE (insertable) sequence or keyed set,
  deterministic split / join, interval overlap, and several orders over one entity id.**

Consumers already in the suite (each hand-rolls a weaker version today):
- **LiteVirtual** `measuredAxis` (Virtual.js:657) keeps a private Fenwick (:46-84): resize is O(log n),
  but inserting a row goes through `setCount` -> full rebuild, O(n) (:677, :748). P1, exactly.
- **LiteTimeline** scans every track every frame (Timeline.js:83), no remove: O(n) active-at-t. P3.
- **LiteKeyframe** sorted Float32 keys with an O(n) insertion shift (Keyframe.js:226), linear scan under
  ~16 then binary search (:44, :55) -- your 16/18 crossover pattern again, at the leaf scale.
- **LiteDataTable** re-sorts the whole table, O(N log N), on every change (Table.js:511, :753), one view
  only. P2 / P4: maintained sort orders.
- **LiteDiCron** polls every job each tick, O(n) (Cron.js:478). A deadline-ordered SumMap fits.
- **LiteArena** already issues generational 32-bit handles (20-bit index + 12-bit generation,
  Arena.js:5, :31): the natural entity-id source for the v0.4 Yggdrasil pool.

Outside the suite:
- `sorted-btree` (qwertie): a fast B+ tree with O(1) clone via subtree sharing. Keyed only, object
  nodes, no summary dimensions, no seek-by-sum.
- `@flatten-js/interval-tree`: the Cormen interval tree, object nodes, O(log n) insert / delete / query.
- Zed's `sum_tree` (Rust): the closest prior art in spirit -- a copy-on-write B+ tree whose Summary
  exposes several Dimensions, any of which can be used to seek. Not JS, not zero-GC by design.
- VS Code's piece tree: a red-black tree caching left-subtree length and line-feed count, i.e. a
  two-dimension sum tree hand-written for one consumer.
Every serious editor re-invents this structure privately. A JS one that is zero-GC, typed-array,
deterministic and count-gated does not exist as a reusable package (as far as this search went).

## 4. Design core (v1)

D-C1 **Trunk:** a leaf-oriented, join-based weight-balanced tree, BB[<3,2>] (Hirai-Yamamoto: the ONE
     integer parameter pair valid for Nievergelt-Reingold, weight = size + 1; verified in Coq and in
     Isabelle by Nipkow-Dirix). BALANCE WEIGHT = LEAF COUNT (every leaf run has weight 1; internal
     weight = sum of children = internal nodes + 1, the N-R external-node convention). Element count is
     a SEPARATE `count` summary column (rank / select come from it). [Rev 1: the draft had weight =
     element count + 1, which breaks with variable-size leaves: two sibling leaves of 4 and 16 elements
     violate 3*5 >= 17 and no rotation can fix two leaves.] Split / join deterministic (no RNG).
     Balance test integer only: `3 * wl >= wr`; gamma = 2 picks single vs double rotation.
     Join is two-argument `join(L, R)` (leaf-oriented: no key lives in an internal node).
D-C2 **Leaves:** bounded SORTED runs of B = 16 slots (uint32 keys = 64 B = one cache line), with
     hysteresis: a full leaf splits into two halves of B/2, and a leaf below B/4 merges into or borrows
     from a neighbour (the YFastTrie K / h policy, reused). Underflow rule (Rev 1): a leaf at 3 looks at
     its sibling leaf first, else the in-order adjacent leaf; neighbour k <= 5 -> merge (3 + k <= 8);
     k >= 6 -> redistribute to floor((3 + k) / 2) / ceil(...) (equalize, never borrow one -- no thrash).
     Rightmost-append fast path (Rev 1): when the full leaf is the rightmost and the new key is past its
     max, split 15 + 1 instead of 8 + 8 (the B-tree monotonic-insert trick), else sorted loads leave
     every leaf half empty. Same for leftmost prepends. v1 keeps leaves sorted; "cracked" unsorted-append leaves are research item R-4, gated by a
     measured crossover, not assumed.
D-C3 **Summaries:** fixed at construction -- `count` always, plus `dims` Float64 SUM columns, plus
     `maxKey` (keyed mode) and later `maxEnd` (interval mode). Monoid KINDS are fixed (SUM / MAX), never
     a user callback in the pull loop (a polymorphic call there deopts).
D-C4 **Measures are integers stored in Float64** (exact to 2^53: device pixels, bytes, ms, lots).
     Reason: pulls recompute from children, and float sums depend on association order, which depends
     on tree SHAPE. With fractional measures, seek results could differ between two trees holding the
     same data -- a deterministic gate would flake. Document it; fail closed on non-integer input.
     Rev 1 additions: (a) SEEKABLE dims require m >= 0 (prefix sums must be monotone; fail closed on
     m < 0). (b) The bound is on the TOTAL, not each measure: an insert / setMeasure that would push a
     dim's total past 2^53 - 1 throws, set unchanged. (c) Seek is pinned STRICT: indexAtSum(d, y) =
     first i with sumBefore(i) + m_i > y, so zero-measure items (collapsed rows) are never returned at a
     boundary; y < 0 -> RangeError; y >= total -> length (one past the end).
D-C5 **Ids are Int32, leaves are negative** (`~leafId`): a sign test, never a value >= 2^31 read out of
     a Uint32Array (the StratifiedBitset `| 0` boxing lesson).
D-C6 **Iterative split / join** over preallocated spine stacks sized from the height bound of the
     capacity (BB<3,2> height <= log_{4/3} L ~ 2.41 log2 L over L leaf runs; L <= ceil(C / 4) + 1).
     Size = ceil(2.5 * log2(L + 2)) + 8, and the invariant walker ASSERTS height <= size (a gate, not
     a comment).
D-C7 **Finger with fence keys:** cache the last leaf, its separator range [lo, hi) and its path. An op
     whose key falls in [lo, hi) skips the descent. Fences, not the leaf's min/max contents -- else every
     sorted append misses. An epoch counter invalidates the finger on any structural change.
     Keyed mode routes "left iff q <= maxKey[left]", so a leaf owns (maxKey of previous leaf,
     its own maxKey], the rightmost owns up to +inf, and fences fall out of the descent. A split /
     merge re-establishes the finger through the trunk: hits are "no descent", splits are counted
     separately (expected ~14/15 hits on a strictly increasing stream with the 15 + 1 split, not 100%).
     SumSequence gets a positional finger: [baseIndex, baseIndex + len) and [baseSum_d, + leafSum_d).
D-C8 **Fixed capacity, fail closed** (RangeError on full / bad input), clear() restores construction
     state, counters are Int32Array REPORTED diagnostics (lite-loglogn style).

## 5. API skeleton (v0.1 -> v0.3)

```js
// v0.1 SumSequence -- position is implicit (a rope / virtual-list index)
const rows = new SumSequence(capacity, { dims: 1 });   // dim 0 = row height in px
rows.insertAt(i, entity, h)        // O(log n); entity is the caller's int32 id
rows.removeAt(i)                   // -> entity
rows.setMeasure(i, 0, h2)          // resize one row, O(log n)
rows.length; rows.total(0)         // n and total height
rows.indexAtSum(0, scrollTop)      // first i whose prefix sum exceeds y   (offset -> row)
rows.sumBefore(0, i)               // row -> offset
rows.splitAt(i, outSeq); rows.append(otherSeq)   // O(log n) cut / paste

// v0.2 SumMap -- uint32 keys, same summaries
const book = new SumMap(capacity, { dims: 1 });      // dim 0 = resting volume
book.set(price, entity, vol); book.delete(price); book.get(price)
book.successor(k); book.predecessor(k); book.rank(k); book.select(r)
book.sumBelow(0, price)            // depth up to a price
book.keyAtSum(0, volume)           // price where cumulative depth reaches V
book.splitAt(k, outMap); book.join(otherMap)

// iteration without allocation: one cursor per instance, preallocated
const c = book.cursor(); c.seekKey(k); while (c.valid) { c.key; c.entity; c.next(); }

// v0.3 IntervalMap -- maxEnd summary: stab(x, out), overlap(lo, hi, out) into caller typed arrays
// v0.4 Yggdrasil  -- entity pool; trees registered on it share ids; pool.remove(id) removes from all
```

## 6. Gates (the suite way)

DETERMINISTIC (`npm test`, every run):
- Fuzz vs an INDEPENDENT oracle (a plain sorted array + naive prefix sums), 0 divergences, splits /
  merges / borrows / joins all triggered (assert each count > 0).
- Invariant walker: BB<3,2> holds at every node after every op; weights = size + 1; summaries recompute.
- Exact counts: pulls per op = path length; split / merge / borrow counts against a model; finger hits on
  a sorted stream derived from the leaf policy (not read back from the engine).
- Must-fail controls: the Adams size-only weight mutant (Hirai-Yamamoto show it breaks balance after
  deletions) must fail the invariant walker; a fence-less finger mutant must lose its hits; a
  callback-monoid mutant must fail the bytecode / inlining pin.
- torture: 0 B/op on every hot path; leak cycles; all via lite-leak + lite-gc-profiler.
REPORTED only (sibling convention, D-host none): leaf-size crossover per host; vs `splice` arrays,
`sorted-btree`, lite-logn Treap / Scapegoat, a prefix-sum-rebuild baseline for P1.

## 7. Roadmap sketch

- 0.1.0 SumSequence (P1, P5). Smallest surface, no sibling overlap, direct consumer in the suite.
- 0.2.0 SumMap (P2, P5) + finger.
- 0.3.0 IntervalMap (P3).
- 0.4.0 Yggdrasil pool: multi-index over stable entity ids, back-pointers per realm (P4).
- Research (not scheduled): R-4 cracked leaves; R-7 B+ internal fanout vs binary trunk; R-8 epoch-based
  persistence (birth / death epoch per node; free only when no live snapshot falls in [birth, death);
  leaves copied whole; secondary realms are NOT versioned -- a documented limit).

## 8. Research directions, with sources

- R-1 Summary dimensions and seek-by-dimension: Zed `sum_tree` (docs.rs zed-sum-tree; Zed "Rope &
  SumTree" write-up via simonwillison.net/b/7735).
- R-2 Weight balance: Nievergelt and Reingold 1972; Hirai and Yamamoto, "Balancing weight-balanced
  trees", JFP 21(3) 2011 (<3,2> unique integer pair, weight = size + 1); Nipkow and Dirix, Isabelle AFP
  "Weight-Balanced Trees" (a verified spec to test against).
- R-3 Join-based ordered sets: Blelloch, Ferizovic, Sun, "Just Join for Parallel Ordered Sets", SPAA 2016.
- R-4 Adaptive leaves: Idreos, Kersten, Manegold, "Database Cracking", CIDR 2007; burst tries (Heinz,
  Zobel, Williams 2002).
- R-5 Fingers and fence keys: Graefe, "Modern B-Tree Techniques" (2011) for fence keys; finger search
  trees (Brodal) for the bound.
- R-6 Consumer recipe: VS Code piece tree (code.visualstudio.com/blogs/2018/03/23/text-buffer-reimplementation).
- R-7 Cache layout: Bender, Demaine, Farach-Colton, cache-oblivious B-trees (2000) -- only if R-7 measures
  a win over the binary trunk.

## 9. Decisions for the maintainer

- D1 Trunk: binary BB<3,2> over leaf runs (simple, deterministic split / join, rank free) vs a B+ tree
  with fanout-16 internal nodes (shallower, more cache-friendly, harder join). Lean: binary for v1,
  B+ internal fanout as measured research R-7.
- D2 First member: SumSequence (no overlap, P1 is the most common pain) vs SumMap. Lean: SumSequence.
- D3 Key domain for SumMap: uint32 only (prefix / clz tricks stay open) vs float keys mapped to
  order-preserving uints. Lean: uint32, plus a documented float-to-sortable-uint helper later.
  Rev 1 helper rules: canonicalize -0 to +0 first (two keys otherwise; the lite-loglogn D1 ruling),
  NaN fails closed; the mapping is a bijection on the remaining floats. Every positive float maps
  ABOVE 2^31, so float-keyed maps live permanently on the >= 2^30 boxing lane (lite-loglogn C-14):
  the v0.2 torture must run that lane as a first-class case, not a straddle step.
- D4 Home: new package `lite-yggdrasil` (lite-logn as devDep oracle / foil) vs a lite-logn member.
  Lean: new package -- lite-logn already has ~20 members, and the summary-dimension engine is a family.
- D5 Measures: integer-valued Float64 (exact, deterministic) vs free floats (shape-dependent rounding).
  Lean: integers, fail closed.
- D6 Leaf size B: 16 (one cache line of uint32 keys) as the default, measured per host, REPORTED.
- D7 Interval overlap: RULED by the maintainer (2026-10-25): BOTH, distinct. lite-logn keeps its
  textbook keyed IntervalTree (its ROADMAP :916); lite-yggdrasil v0.3 IntervalMap is the mutable,
  split / join-able, multi-index one. An IntervalMap orders by the composite (start, entityId) so equal starts (many clips at
  t = 0) always separate across a fence.
- D8 First consumer to prove it: LiteVirtual `measuredAxis` (insert-in-the-middle O(n) -> O(log n)).
  Lean: yes -- a recipe or an optional peer, never a hard dep.
