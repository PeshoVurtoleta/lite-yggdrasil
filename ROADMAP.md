# lite-yggdrasil -- PRE-BUILD roadmap

> **STATE (2026-10-25): S0 in progress (2026-10-25): Y-01, Y-02, Y-04, Y-05, Y-09, Y-13, Y-15 RULED; ADRs
> 0001-0004; scaffolding at 0.0.0 (npm test green). 24 design bugs logged (RESEARCH
> section 6 B-9..B-32); the 13 from the DB-1 review (B-17..B-29) are closed / deferred in decisions/0005 (CURRENT).** D7 is RULED (both, distinct). Nothing
> is published; git repo initialized (e14e2f3).
>
> **UPDATE (2026-10-27): the SumSequence engine is built and gated (`npm run verify`: 838 tests, types, lanes, torture); the 0.1.0 docs are written; the release itself (version bump, tag, publish) is still pending.**
>
> **UPDATE (2026-10-28): 0.1.0 and 0.1.1 (audit #3 fixes) are tagged and published. Next: Bench-ADOPT, then the
> GO / NO-GO checkpoint, then SumMap 0.2.0 -- resumed after the lite-signal release (maintainer 2026-10-28:
> "After lite-signal release, we continue developing"). Estimate to 0.2.0 and borrowed patterns: section 5
> and the Queued section below; findings in RESEARCH.md section 11.**

One package, `@zakkster/lite-yggdrasil` (folder `LiteYggdrasil`, main `Yggdrasil.js`): a zero-GC
engine for mutable ordered sequences where "where is X?" is a running total (RESEARCH.md section 1).
It inherits the suite process wholesale from lite-logn / lite-loglogn.

**How this roadmap is shaped.** Same form as lite-logn's ROADMAP: shared law, a severity-tagged
table of design calls to settle, the gate spec, an ASCII session-order graph, one self-contained
BRIEF per session (fenced `markdown` with frontmatter + PURPOSE / TASKS / ASSERTIONS / HOT PATH /
NON-GOALS / DONE WHEN). It adds two sections the siblings grew only after shipping:
**section 3.8 the public benchmark** (honest numbers anyone can reproduce, including where it loses)
and **section 4 design-bug hunting** (how design bugs are found BEFORE code, because the first draft
of this package already had eight -- RESEARCH.md section 6).

**This is a PLAN, not a go.** No member is built until the maintainer greenlights its session. The
assistant never commits, publishes, pushes or tags (the suite git guard enforces it).

**External reviews (rule added 2026-10-28).** Before acting on any outside review, check each claim
against decisions/ (CURRENT first), RESEARCH.md and the code; label every citation verified / from
recollection / UNVERIFIED; hunt for a counterexample before copying any complexity bound. RESEARCH.md
11.2, 11.6 and 11.7 record three reviews already checked this way -- reuse their corrected answers, not the
review text.

---

## 0. Name and layout

| Field      | Value                                                          |
| ---------- | -------------------------------------------------------------- |
| npm name   | `@zakkster/lite-yggdrasil` (scope `@zakkster`, one `s`)        |
| folder     | `LiteYggdrasil`                                                |
| main file  | `Yggdrasil.js` (single PascalCase)                             |
| error tag  | none: RangeError message = token + ' ' + detail (as built, 0005 C-10) |
| exports    | `SumSequence`, `SumMap`, `IntervalMap`, `Yggdrasil` (+ `VERSION`) |

**UNPUBLISHED.** Git initialized 2026-10-25 (e14e2f3). Every version below is a first issue.

---

## 1. Shared law (non-negotiable, every session)

The suite CLAUDE.md law applies unchanged (zero runtime deps, `node:test` only, ASCII-only, single
PascalCase main file, `sideEffects: false`, llms.txt + CHANGELOG.md, MIT (c) Zahary Shinikchiev,
fixed preallocated capacity, fail closed, null is not zero, typeof-guard first, 0 B/op on every
steady-state hot path proven by `node --expose-gc test/torture.mjs`, every gate can FAIL).

Family deltas (RESEARCH.md section 5 states them as invariants I-1..I-9):

1. **Measures are integers** stored in Float64, every SUM dim >= 0 (ADR 0002 M-1), each dim's TOTAL <= 2^53 - 1;
   anything else throws a `RangeError` whose message is token + ' ' + detail (as built; no `[lite-yggdrasil]` tag), set unchanged.
2. **No user callback in a hot loop.** Summary kinds are fixed (COUNT, SUM, MAX); a polymorphic call
   in the pull loop is a rejected design.
3. **Int32 ids, negative leaves.** No value >= 2^31 is read out of a Uint32Array on a hot path.
4. **Counts are the gate, time is REPORTED** (sibling convention, D-host = none -- Y-13). Every
   performance statement is first a COUNT (touches, pulls, moves, splits, finger hits) with an exact
   expected value, then optionally a REPORTED time with provenance.
5. **No recursion** in split / join / walkers: preallocated spine stacks sized from capacity.
6. **Siblings are devDeps or optional peers only**, never runtime deps.

---

## 2. Design calls to settle

Severity: **S1** blocks everything or outlives many members; **S2** shapes one member; **S3** hygiene.
Each settled call becomes a `decisions/NNNN-*.md` ADR in the session that owns it.

| ID | Sev | Design call | Recommended resolution | Status |
| --- | --- | --- | --- | --- |
| **Y-01** (D1) | **S1** | Trunk: binary BB<3,2> over leaf runs vs a B+ tree with fanout-16 internal nodes. | Binary BB<3,2>, balance weight = LEAF COUNT, gamma = 2 for insert / delete, BFS own rule inside join / split (R-Y01), two-argument `join(L, R)`; B+ fanout = research R-7, measured. | **RULED 2026-10-25** (0001) |
| **Y-02** (D2) | **S1** | First member: SumSequence vs SumMap. | SumSequence (no sibling overlap; P1 is the most common pain; proves trunk + leaves + sums without keys). | **RULED 2026-10-25** (maintainer: approved) |
| **Y-03** (D3) | S2 | SumMap key domain: uint32 vs mapped floats. | uint32; a float -> sortable-uint helper later with -0 -> +0, NaN fails closed, and the >= 2^30 boxing lane gated as a first-class torture lane. | LEAN -> SumMap |
| **Y-04** (D4) | S3 | Home: new package vs lite-logn member. | New package; lite-logn as devDep oracle / foil. | **RULED 2026-10-25** (maintainer: approved) |
| **Y-05** (D5) | **S1** | Measures: integer-valued Float64 vs free floats. | Integers, totals <= 2^53 - 1, every SUM dim >= 0, fail closed. | **RULED 2026-10-25** (0002) |
| **Y-06** (D6) | S2 | Leaf size B and policy. | B = 16; split 9 + 8 / 8 + 9 (interior), 13 + 4 / 4 + 13 (rightmost append / leftmost prepend); merge / equalize below 4 (RESEARCH I-5). Measured per host, REPORTED. Split sizes RULED by ADR 0001 Table 3 (13 + 4 edge split, R-X1); B value still measured. | LEAN -> SumSequence |
| **Y-07** (D7) | S2 | Interval overlap ownership. | **RULED 2026-10-25 (maintainer): BOTH, distinct.** lite-logn keeps its textbook keyed IntervalTree (its ROADMAP :916); lite-yggdrasil v0.3 IntervalMap is the mutable, split / join-able, multi-index one, ordered by (start, entityId). Neither package edits the other's roadmap. | **RULED** |
| **Y-08** (D8) | S2 | First consumer to prove the API. | LiteVirtual `measuredAxis` (insert-in-the-middle O(n) -> O(log n)), as a recipe / spike on the yggdrasil side first; any LiteVirtual change is LiteVirtual's own session. | LEAN -> SumSequence |
| **Y-09** | S2 | Diagnostic counters: which ones, Int32 wrap policy. | `_n` Int32Array: touches, pulls, moves, splits, merges, equalizes, rotSingle, rotDouble, fingerHits, fingerMisses, joinSteps, seamRepairs (ADR 0003); wrap at 2^31; REPORTED; the engine never reads them (lite-loglogn precedent). | **RULED 2026-10-25** (0003; per-view counters, list per ADR 0003 table) |
| **Y-10** | S2 | Max dims per instance. | 1..4, fixed at construction (Q-2). | SumSequence |
| **Y-11** | S2 | Iteration API. | One preallocated cursor per instance (`c.seek*`, `c.next()`, fields), invalidated by a cursor bit (0005 C-6, C-7); no iterator objects. | SumSequence |
| **Y-12** | S2 | Entity id source for the pool. | Raw int32 by default; lite-arena handle as an optional adapter (generation check = one load). | Yggdrasil pool |
| **Y-13** | S3 | Statistical host. | "none: statistical claims are REPORTED only" (sibling convention, as lite-loglogn). | **RULED 2026-10-25** (0003) |
| **Y-14** | S3 | Day-1 scaffolding and `files[]`. | Mirror `LiteLogN/` (6 shipped files: Yggdrasil.js, .d.ts, llms.txt, README.md, CHANGELOG.md, LICENSE); test/, benchmark/, decisions/, demo/ repo-only. | S0 |
| **Y-15** | **S1** | Arena ownership for split / join | ADR 0004 option (a): one internal shared arena, `SumSequence.arena(C, o, k)` views at setup, cross-arena split / append = RangeError | **RULED 2026-10-25** (0004) |

---

## 3. The gate spec

A member is DONE only when every gate below is green with REAL output, each gate's must-fail
control fails, and the reviewer has asked of every test "would this fail if the member were broken".

### 3.1 Day-1 scaffolding
Mirror `LiteLogN/` (package.json scripts, test layout, decisions/, benchmark/ copied from Bench v2).
`npm test` (deterministic only), `npm run torture`, `npm run test:perf`, `npm run bench`,
`npm run verify` (test + types + torture + perf, timed parts under quiet-lock).
AS BUILT (2026-10-27): the scripts are `test`, `test:types`, `test:lanes`, `torture` and `verify`, and
`verify` = test -> test:types -> test:lanes -> torture (`test:perf` and `bench` do not exist; no statistical
tier, Y-13).
Ruled 2026-10-25 (R-SC): S0 ships `npm test`, `test:types`, `verify` only; `torture` / `test:perf` arrive with SumSequence and `bench` with Bench-ADOPT, so no script is ever green on nothing. (`test:lanes` and `torture` arrived with SumSequence; `test:perf` and `bench` have not.)

### 3.2 Oracle gate (DETERMINISTIC)
Fuzz vs an INDEPENDENT oracle written from the spec, not from the engine: a plain JS array of
(entity, measures) for SumSequence, a sorted array for SumMap, a naive interval list for IntervalMap.
0 divergences over seeded streams; every structural event (interior split 9|8 / 8|9, edge split 13|4 / 4|13, merge,
equalize, rotation single / double, join, splitAt) asserted to fire > 0 times per stream.

### 3.3 Invariant walker (DETERMINISTIC)
Runs after EVERY op in the fuzz and the exhaustive small-scope runs (section 4 DB-2, DB-3): I-1
balance at every node, I-2 summaries recompute exactly, I-3 totals bound, I-5 leaf occupancy, I-6
fences, I-7 id signs, I-8 height <= spine size, I-9 finger (0005 C-28).

### 3.4 Count gates (DETERMINISTIC) -- the splice witness
touches / pulls / moves per op against exact formulas from the spec (RESEARCH section 3); finger
hits on a strictly increasing stream = the value derived from the leaf policy (12 of every 13 appends at B = 16 (ADR 0001 Table 3, ADR 0003 G-12 with s0 = m)), computed in the test from the policy, never read back from the engine.

### 3.5 Metamorphic gates (DETERMINISTIC)
- shape independence: one multiset, k insertion orders -> bit-identical answers to every seek;
- `splitAt(i)` then `append` == identity (structure-independent comparison);
- `insertAt(i, x)` then `removeAt(i)` == identity;
- `indexAtSum(d, sumBefore(d, i)) == i` whenever m_i > 0;
- clear() restores the constructed state (diagnostic counters excepted -- ADR 0003 G-8).

### 3.6 Torture and perf (DETERMINISTIC counts, timed parts under quiet-lock)
0 B/op on every hot op (insertAt, removeAt, setMeasure, indexAtSum, sumBefore, cursor walk, and for
SumMap set / delete / successor / keyAtSum), including split / merge / join paths (amortized, not
per-op allocation); leak cycles; the >= 2^30 key lane for SumMap; must-fail allocating controls.

### 3.7 Byte-identical prior members
When a new facade lands, the shared core changes only by additive hunks and prior facades' regions
are byte-identical (parity pin vs the frozen "before" build, named by commit + sha).

### 3.8 The public benchmark -- honest numbers anyone can reproduce

ADOPT Bench v2 from `LiteLogN/benchmark/` (copy + wire, never redesign): child-process-per-cell,
honesty header, `n/a` never 0, traceHash determinism, bootstrap CI + Mann-Whitney, inline-SVG report.
Swap in the splice witness and the foils of RESEARCH.md section 4.1.

What makes it public and honest:
- **Scenario tier** (RESEARCH 4.2): S1 virtual list 1M rows, S2 editor line index, S3 timeline,
  S4 order book, S5 booking, S6 multi-order data table, S7 weighted pick (fixed n, live reweighting).
  Each scenario lands with the member that enables it (S1-S2 and S7 with 0.1, S4-depth with 0.2, S3-active / S5 with 0.3, S4-cancel / S6 with 0.4).
- **Counts beside every time.** Exact op counts are printed next to each timing, so a reader on a
  different machine can verify the work bit-for-bit even when the times differ.
- **The loss table is mandatory** (RESEARCH 4.3): static data, resize-only (S7), the blocked array below its crossover (S1 /
  S2), point lookup, tiny n --
  each with its measured crossover n. A report with no loss rows fails review.
- **Provenance on every table**: date, host, CPU, Node, load average start / end, quiet-lock state
  (QUIET / NOISY = PRELIMINARY), run count, commit + main-file sha. Numbers enter README / llms.txt /
  CHANGELOG only from a run log of THIS cycle, after the final gate run (suite law).
- **Generated, not typed.** The README "Benchmarks" section and `benchmark/report.html` are generated
  from `benchmark/results.json`; a test pins that the README table equals the generator output.
- **Reproduce**: `npm run bench` (all), `npm run bench -- --scenario S1` (one); the report header
  prints the exact command.
- **Rivals at a pinned version** (`sorted-btree`, `@flatten-js/interval-tree`, lite-logn) as
  devDependencies, their versions printed in the header; a rival that cannot answer a query gets
  `n/a` with the reason.
- **Hand-written rivals** with no npm package (the blocked array for SumSequence, RESEARCH 4.1) live
  in benchmark/, follow the same fairness rules (typed arrays, tuned parameters printed, zero allocation
  in their hot loop) and are reviewed like engine code.

---

## 4. Design-bug hunting -- how design bugs are found BEFORE code

The first draft of this package carried eight design bugs (RESEARCH.md section 6, B-1..B-8). One of
them (B-1, the balance weight over variable-size leaves) would have produced a tree that silently
violates its own balance invariant with no rotation able to repair it. Review found it; the
techniques below find that CLASS earlier and cheaper. Each member's planner pass runs DB-1..DB-4
before any engine code; DB-5..DB-12 become gates in the member's session.

- **DB-1 Independent adversarial design review.** Before code, a reviewer who did NOT write the spec
  gets the spec text only (not the author's conclusions) and one question: "construct an input that
  breaks an invariant or a stated bound". B-1 and B-3..B-6 were found this way. One per member, plus
  one on any spec change touching I-1..I-9.
- **DB-2 Exhaustive small-scope checking.** Bugs show up in small cases (the small-scope hypothesis).
  The leaf size B and capacity are constructor parameters with a TEST-ONLY minimum (B = 4), so the
  test enumerates EVERY op sequence up to length ~10-12 over a tiny key / measure alphabet and runs
  the invariant walker after each op. B-1 unfixable sibling PAIR needs B = 16 (5 vs 17; at B = 4 the pair 1 / 4 weighs 2 vs 5, balanced -- B-14), but the element-count mutant still fails the walker at B = 4 (a 4-element leaf beside a 4-leaf subtree, ADR 0001 M-1); DB-2 runs at B = 4 AND B = 8 (ADR 0001 Table 3).
  Deterministic, part of `npm test`.
- **DB-3 Invariant walker after every op** (section 3.3), in fuzz AND exhaustive runs, including the
  height <= spine-stack bound (B-7) -- an assertion, not a comment.
- **DB-4 Proof-assumption table.** Every cited result (Hirai-Yamamoto <3,2>, Nipkow-Dirix, Blelloch
  join) gets a table in its ADR: each assumption of the proof, and where OUR representation meets
  it or not. "Uniform external weight 1" vs "variable leaf runs" is the row that exposes B-1. A cited
  proof with an unchecked assumption is an open design call, not a settled one.
- **DB-5 Differential oracles.** At least two independent references per facade: the naive model
  (3.2) plus a second real implementation (lite-logn Treap for rank / select, Fenwick for static
  sums, `sorted-btree` for keyed order). Three-way disagreement localizes the bug.
- **DB-6 Metamorphic relations** (section 3.5). Shape independence catches B-2 (float measures);
  identity round-trips catch split / join seam bugs; seek-of-sumBefore catches the strict / non-strict
  boundary (I-4).
- **DB-7 Boundary-value catalogue**, one table per facade, every row a test: empty, single element,
  single leaf, capacity full, zero measures, -0, NaN, non-integers, negatives on any SUM dim,
  totals at 2^53 - 1 and +1, keys at 2^30 - 1 / 2^30 / 2^31 - 1 / 2^31 / 2^32 - 1, rightmost and
  leftmost leaves, ties in (start, entityId). B-4 and B-5 are rows of it.
- **DB-8 Mutation-tested gates.** Every gate ships the mutant it must kill: the gamma witnesses W-DEL / W-INS / W-TIE (the Adams size-weight mutant is equivalent on I-1 shapes -- B-15), element-count weights over leaves (B-1, must fail DB-2), fence-less
  finger (must lose its hits), symmetric split on appends (must fail the occupancy count), float
  measures (must fail shape independence), recursion in join (must fail the deep-tree stack test).
- **DB-9 Count-first claims.** No sentence says "fast", "100%" or "O(1)" without the count that
  backs it (B-3, B-6). Counts are derived in the test from the spec's policy, never read back from
  the engine under test.
- **DB-10 Claim audit before docs.** Every number or mechanism claim in README / llms.txt / ADR /
  CHANGELOG cites a run log of this cycle or is labelled "expected" / "nominal" (B-8). The doc
  reviewer greps for unlabelled numbers.
- **DB-11 Consumer-first API spike.** Before the engine, write the LiteVirtual `measuredAxis`
  adapter (and for 0.2 an order-book sketch) against the proposed API on paper / in a test stub.
  API design bugs (missing ops, wrong boundary semantics, an allocation forced on the caller) surface
  before they are frozen.
- **DB-12 The design-bug log is append-only.** Every design bug found anywhere (review, fuzz,
  consumer, user report) goes into RESEARCH.md section 6 with: class, how found, which DB-n would
  have caught it earlier. A class seen twice becomes a standing gate or a law clause.

---

## 5. Session order

```
 S0 settle (Y-01, Y-02, Y-04, Y-05, Y-09, Y-13, Y-14; git init by maintainer)
   |
   v
 SumSequence 0.1.0 --> Bench-ADOPT (copy + wire, scenarios S1, S2, S7) --> GO / NO-GO --> SumMap 0.2.0 (+ S4-depth)
                                                                                             |
                                                                                             v
                                    Yggdrasil pool 0.4.0 (+ S4-cancel, S6) <-- IntervalMap 0.3.0 (+ S3, S5)
                                          |
                                          v
                                    Demo (repo-only) --> Tier 2 (lazy range update, quantile helper)
```

What blocks what:
- S0 settles the trunk (Y-01) and measures (Y-05): every member depends on both.
- SumSequence brings up every gate (oracle, walker, exhaustive small-scope, counts, metamorphic,
  torture) -- it is load-bearing beyond its own release, like lite-logn's BinaryHeap.
- Bench-ADOPT follows the first member so the public numbers exist from 0.1 on (S1, S2 and S7 need only
  SumSequence); each later member extends the scenarios it enables.
- GO / NO-GO checkpoint (added 2026-10-25, lite-pick review): SumMap is greenlit only by a maintainer
  decision on SumSequence's S1 / S2 numbers against the blocked array AND Fenwick-rebuild (RESEARCH
  4.1). It reads REPORTED numbers from a run log of that cycle with provenance; it is not a test gate
  (ADR 0003 G-1: no timing ... gates anything, in verify or at /release); a PRELIMINARY / PENDING
  log is labelled so in the decision. NO-GO = the program stops at SumSequence (or is rescoped),
  and the README says where the trunk wins and loses.
- The pool (0.4) needs SumMap and IntervalMap realms to be worth shipping.

Estimate to SumMap 0.2.0 (2026-10-28, est., from .handoff/HISTORY.md: 28 burst sessions S0 -> 0.1.1 (S0, the
unnumbered planner burst, 2..27), about 26 to 0.1.0, 13 of them on 2026-10-27). Nominal 15-22 burst sessions:

| Stage | Bursts (est.) | Basis |
|---|---|---|
| Bench-ADOPT | 2-3 | planner; coder + review; one quiet-host bench run |
| GO / NO-GO | 0 | maintainer decision on a quiet-host run log of S1 / S2 |
| SumMap settle (Y-03 keys, new ADR + CURRENT) | 1-2 | maintainer decisions inside the burst |
| SumMap rungs | 8-12 | keyed ops + routing I-6, fence-key finger, rank / select / sumBelow / keyAtSum, split / join by key, the >= 2^30 boxing lane, S4-depth |
| Docs + release | 2 | as 0.1.x |
| Audit-fix cycles | 1-3 | each of the three 0.1.x audits cost 1-2 bursts |

About half of 0.1.0 because the trunk and every gate harness are reused; not less because keyed routing
is a new invariant and most 0.1.x units needed a second review round. A NO-GO ends the program
at SumSequence (or rescopes it), so Bench-ADOPT is the real next gate.
Scheduling: Bench-ADOPT's timed run and the GO / NO-GO log need a QUIET host (quiet-lock); do not run
them while another package's torture or timed tests run (the result would be PRELIMINARY). Untimed
bursts (planner, coder, docs) can run beside another package's bursts.

---

## 6. The briefs

===============================================================================
# S0 -- lite-yggdrasil (pre-release) -- settle the trunk, the measures, the gates
===============================================================================

```markdown
---
package: "@zakkster/lite-yggdrasil"
version_target: none (no release)
status: done (SumSequence, which depends on S0, is built; see the 2026-10-27 UPDATE at the top)
peers: ["@zakkster/lite-gc-profiler", "@zakkster/lite-leak", "@zakkster/lite-perf-gate"]
depends_on: []
blocks: [SumSequence, SumMap, IntervalMap, Yggdrasil]
---

# lite-yggdrasil -- stand up the repo and settle what outlives member 1

PURPOSE
  Turn the leans of section 2 into ADRs and stand up the scaffolding, so SumSequence starts from
  settled ground. No engine code.

TASKS
  - Maintainer: `git init`. Agent: scaffolding mirroring LiteLogN (package.json, files[] = 6,
    test/, decisions/, benchmark/ placeholder, .gitignore with /.handoff/).
  - ADR 0001 trunk (Y-01) WITH its proof-assumption table (DB-4) for BB<3,2> over leaf runs.
  - ADR 0002 measures (Y-05) WITH the boundary catalogue rows for measures (DB-7).
  - ADR 0003 counts-are-the-gate / D-host none (Y-13), counters (Y-09).
  - DB-1 adversarial review of SCOPE.md Rev 1 + ADRs 0001-0003 by an agent that did not write them;
    every finding appended to RESEARCH.md section 6.
  - Maintainer rulings (AskUserQuestion) on Y-01, Y-02, Y-04, Y-05; record in this table.

ASSERTIONS
  - Every S1 call has an ADR with a status line; every ADR citing a proof has an assumption table.
  - `npm test` runs (empty suite green) and `npm pack --dry-run` lists exactly the 6 files.

NON-GOALS
  No engine code, no benchmark numbers.

DONE WHEN
  Y-01 / Y-02 / Y-04 / Y-05 / Y-09 / Y-13 / Y-15 RULED, ADRs 0001-0004 written and reviewed, scaffolding green.
```

===============================================================================
# SumSequence -- v0.1.0 -- the headline: splice anywhere, seek by any sum
===============================================================================

```markdown
---
package: "@zakkster/lite-yggdrasil"
version_target: 0.1.0
status: built, release pending (2026-10-27)
gc_maxMajor: 0
alloc_bytes_per_op: "0 on the Smi lane (< 2^30); big lane <= 16*b + 1 per C-13, insertAt b = dims (R-A1)"
peers: ["@zakkster/lite-gc-profiler", "@zakkster/lite-leak", "@zakkster/lite-perf-gate"]
depends_on: [S0]
blocks: [Bench-ADOPT, SumMap]
gate_note: counts are the hard gate (touches / pulls / moves / splits / finger hits, exact);
           timing REPORTED with quiet-lock provenance
---

# lite-yggdrasil -- SumSequence: an implicit-position sequence with multi-dimension sums

PURPOSE
  The P1 / P5 engine: insertAt / removeAt / setMeasure / indexAtSum / sumBefore / splitAt / append
  in O(log n) over a fixed-capacity typed-array arena. Brings up EVERY family gate.

TASKS
  - DB-11 spike first: the LiteVirtual measuredAxis adapter written against the API as a test stub.
  - DB-2 harness first: the exhaustive small-scope enumerator (test-only B = 4) + the invariant
    walker (3.3), BEFORE the engine; they must fail on a stub engine (control).
  - Engine: BB<3,2> leaf-count trunk, leaf runs (B = 16, I-5), count + dims SUM columns, strict seek
    (I-4), iterative splitAt / append on spine stacks (I-8), positional finger (I-9), counters (Y-09),
    preallocated cursor (Y-11). Int32 ids, negative leaves (I-7). Fail closed per I-3.
  - Gates 3.2-3.6 with their mutants (DB-8).
  - DB-1 findings B-17..B-29 (RESEARCH section 6) resolved in the planner pass (decisions/0005 CURRENT); B-17 adds the finger-on == finger-off metamorphic gate.
  - Docs: README (LiteSepforge blueprint spine), llms.txt, .d.ts, CHANGELOG 0.1.0, GUIDE.

ASSERTIONS
  - Oracle 0 divergences; every structural event fires > 0 per stream.
  - Exhaustive small-scope: every sequence up to the chosen length passes the walker; the
    element-count-weight mutant (B-1) FAILS it.
  - touches per op <= p(op) * H(Lmax(n)) + k(op), k(op) = 0 (ADR 0003 G-11, 0005 C-25); finger hits on a strictly
    increasing append stream = policy-derived value.
  - Shape independence: 3 insertion orders, identical seek answers; float-measure mutant FAILS.
  - torture 0 B/op on every hot op; controls fail.

HOT PATH
  insertAt / removeAt / setMeasure / indexAtSum / sumBefore: one descent, or a finger hit for the positional ops (0005 C-4; seeks never use the finger, C-2), leaf moves per the exact formula of the SumSequence spec (formulas: 0005 C-18; the old <= 15 was false -- B-16, ADR 0001 O-4), one pull per level, zero allocation.

NON-GOALS
  No keys (SumMap), no intervals, no pool, no persistence, no lazy range updates.

DONE WHEN
  All gates green with real output, every mutant killed, DB-1 review of the finished spec clean,
  design-bug log updated.
```

===============================================================================
# Bench-ADOPT -- repo-only -- copy + wire Bench v2, scenarios S1, S2 and S7, the blocked-array rival, the loss table
===============================================================================

```markdown
---
package: "@zakkster/lite-yggdrasil"
version_target: none (repo-only; may ride 0.1.x docs)
status: planned
depends_on: [SumSequence]
---

# lite-yggdrasil -- port Bench v2 from LiteLogN/benchmark, add the public scenario tier

TASKS
  - Copy Harness / Matrix / Report / Template / METHODOLOGY from LiteLogN/benchmark; adapt
    METHODOLOGY to the splice witness and the foils of RESEARCH 4.1.
  - Scenarios S1 (virtual list 1M rows), S2 (editor line index) and S7 (weighted pick, fixed n, live
    reweighting) with counts beside times.
  - The blocked-array rival (RESEARCH 4.1: written in benchmark/, chunk size tuned per n and printed).
  - Loss table rows (static, resize-only on S7, tiny n, blocked array below its crossover) with measured
    crossover n; the result feeds the GO / NO-GO checkpoint (section 5).
  - README "Benchmarks" generated from results.json + a test pinning README == generator output.
  - Runs under quiet-lock; NOISY / BUSY = PRELIMINARY / PENDING, never retried in a loop.

DONE WHEN
  `npm run bench` reproduces the report; the loss table is present; provenance complete.
```

Planner notes for Bench-ADOPT (2026-10-28, not ruled; RESEARCH 11.6):
- Report seek and splice (cut / paste) timings separately for S1 / S2, plus the blend -- not one average.
- Counter mapping for the blocked array: only touches (directory scan steps) and moves (element shifts)
  correspond to COUNTERS; pulls, rotations, joins and seams are n/a for it.
- "The chunk-sum scan stays in L1 and beats the trunk's dependent loads at small n" is EXPECTED, not
  measured; the crossover n comes only from this cycle's quiet-host run log.

### Queued -- SumMap 0.2.0, IntervalMap 0.3.0, Yggdrasil pool 0.4.0 (one full brief each at greenlight)

- **SumMap 0.2.0**: uint32 keys (Y-03), routing I-6, fence-key finger, rank / select / sumBelow /
  keyAtSum / splitAt / join; the >= 2^30 boxing lane as a first-class torture lane; S4-depth
  scenario; rivals `sorted-btree`, lite-logn Treap / Scapegoat (`n/a` for sum seek), `Map` counter-foil.
- **IntervalMap 0.3.0**: (start, entityId) order, maxEnd summary, stab / overlap into caller typed
  arrays, split / join; S3 active-at-t and S5 booking; rivals `@flatten-js/interval-tree` and
  lite-logn's IntervalTree once shipped (Y-07: both exist; the benchmark compares, neither replaces).
- **Yggdrasil pool 0.4.0**: stable ids (Y-12), realms, per-realm back-pointers, remove(id) from all
  realms in k * O(log n); S4-cancel and S6; foil `Map` + k hand-synced arrays.

Borrowed patterns per member (2026-10-28, not ruled; RESEARCH.md 11.3, evidence in
.handoff/BORROW-2026-10-28.md). Each planner reads them before its brief:
- SumMap 0.2.0: uint32 keys >= 2^31 read back negative from an Int32Array -- unsigned compares and a key
  lane at 2^31 - 1, 2^31, 2^31 + 1, 2^32 - 1.
- IntervalMap 0.3.0 (lite-bvh): caller-buffer stab / overlap with the cap test before the write; maxEnd
  recomputed at every sums site, gated by a census (0003 G-6 style); start / end / NaN input doors before
  any write; decide written-count vs total-count returns (RESEARCH Q-8).
- Pool 0.4.0 (lite-arena 1.10.0, lite-fastbit32): generational handle with a FREE bit and retirement
  instead of wrap; full-handle-checked back-pointers; fan-out remove; one membership word per element for
  k <= 32 with the `v &= v - 1` set-bit walk. Open: generation bits vs the 30-bit entity (Q-4),
  back-pointer to position vs leaf (Q-7: count the moves), the realm cap (Q-9).
- Bulk constructor ("rebuild bigger", queued in README Design decisions): batch-atomic validation before
  the first write; differential gate bulk == single inserts (lite-bvh insertLeaves). A cold dump() /
  restore() pair (lite-lru 0021) is its natural sibling; not planned.
- IntervalMap, answered (RESEARCH Q-5): no minStart column -- start is the key; free gaps come from a
  maxEndBelow prefix-max descent plus a successor descent, O((k' + g) log n) (k' = waterline advances,
  O(cluster size) worst case, NOT O(log n) per cluster). The 0.3 ADR states why maxEnd and not a
  priority search tree: a PST's heap order breaks split / join by key.
- Pool, lean (RESEARCH Q-7, refines ADR 0004 O-3 / 0005 C-12): positional realms need a parent column;
  pair it with a LEAF-target back-pointer, so an in-leaf op writes one backLeaf entry (its own element)
  and no parent; all other writes sit in cold relink code; the one hot store is a ROADMAP 3.7 hot-body
  edit (O-3), so it lives in an opt-in path built at construction; a census gate on every relink site; walker reciprocity checks.
- Not planned, with reasons (RESEARCH 7 / 11.5): no LRU or other eviction cache inside the engine (the
  finger, sums and cursor offsets are rule-reset caches; an LRU reopens the B-17 / B-18 class); no
  intrusive leaf chain (cursor _cross is amortized O(1) per step). lite-lru's IntSlotStore only if pool
  ids are external uint32 (with a changed door; lite-lru's accepts int32 only).

### Good-to-have -- test-only, no release, take when a burst has room
- Seeded differential soak (RESEARCH 11.1): cursor seek + next() walks against Oracle.cursor() on trees
  shaped by mixed mutation, 3+ views with clear() beside live siblings, SEED / ITERATIONS / OPERATIONS
  replay, a must-fail mutant control; adapt audit/2026-10-27/claude/r2/fuzz-full.mjs. Maintainer
  2026-10-28: "Leave it as a future idea good-to-have".
- Docs-drift test (lite-arena test/docs-drift.test.js shape).
- Audit every must-fail control against "fails EVERY target tier" (lite-fastbit32 T9).
- Transition coverage matrix (RESEARCH 11.7, review #3's DB-14): join and seam repair classified by
  (height difference, seam occupancies, rotation kind) from outside the engine; every cell hit or listed
  unreachable with a reason; cases from the DB-2 B = 4 enumerator; no new COUNTERS, no hot-body change.

### Queued -- Tier 2 / research (RESEARCH.md section 7)
Lazy range measure update; quantile helper; rope recipe; R-4 cracked leaves; R-7 B+ fanout; R-8
epoch persistence. Each needs a measured case before a session.
- Lazy range update planner notes (RESEARCH 11.7 C): tag pushes touch both children, rotations and
  equalize / merge push or apply tags off the spine (state the touches / moves counts); a tag op resets
  the finger or a hit applies pending tags; a negative delta needs min(range) + delta >= 0 (a MIN summary
  or an O(k) scan) on top of the I-3 total check; integer deltas only.
- R-8 (RESEARCH 11.7 A): refcounted path copying conflicts with the pool's parent column / back-pointers
  and with the finger hit -- choose between persistence and pool back-pointers before planning either.
- Idea, not planned: a per-entry change stamp with a MAX summary (the IntervalMap maxEnd mechanism)
  finds rows changed since t0 in O(k x (log n + B)) without persistence; removals need a tombstone or an edit log.
- Not planned (RESEARCH 11.7): an Euler tour facade (LiteLogN EulerTourTree / LinkCutTree), a wavelet
  matrix (LiteLogN WaveletTree), timing wheels (LiteO1), a --trace-deopt gate (not deterministic).

---

## 7. Cross-package boundaries (state them in the README)

- lite-logn: textbook members incl. its own IntervalTree (Y-07); devDep oracle / foil here. Its
  EulerTourTree / LinkCutTree, WaveletTree and PersistentSegTree are not duplicated here (RESEARCH 11.7).
- lite-loglogn: integer-universe successor; shared lessons (bucket hysteresis, boxing lane), no code.
- lite-o1 / lite-arena / lite-fastbit32: devDeps or optional adapters only (lite-o1 owns the timing wheels).
- lite-bvh: pattern source for IntervalMap (caller-buffer queries, summary refit); no dependency.
- Consumers (LiteVirtual, LiteTimeline, LiteKeyframe, LiteDataTable, LiteDiCron) adopt via recipes or
  optional peers in THEIR sessions; this package never imports them.

---

## 8. How to run it

One session per brief, started in `LiteYggdrasil/` (main checkout), following the suite agent
pipeline (scout / sweeper -> planner -> coder + helper -> sweeper -> reviewer -> qa) and the burst
rules in `~/.claude/CLAUDE.md`. Each member's planner pass runs DB-1..DB-4 before the first coder
batch; the design-bug log is read at the start of every session.
