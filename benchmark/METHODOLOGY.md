# How lite-yggdrasil is benchmarked

Repo-only dev doc (NOT in package.json `files[]`). This is the methodology the
`@zakkster/lite-yggdrasil` benchmark follows. It adopts Bench v2 from
`@zakkster/lite-logn` (`LiteLogN/benchmark/`, the O(log n) family copy, commit
9eb484c): `benchmark/Harness.mjs` and `benchmark/Template.mjs` are copied with a
byte-identical body (only the header comment differs). Copy and wire, never
redesign (ROADMAP section 3.8).

ASCII-only (`->`, `<=`, `x`, "degrees"). Zero runtime deps, `node:test` only.

Status (2026-10-31): Harness.mjs and Template.mjs are in place. The adapters,
scenarios, dimensions, kernel lanes, runner, report, README generator and its
README pin test land in later Bench-ADOPT batches; the sections below are the
contract they are built to, and until they land no `npm run bench` script exists.

## The one rule

A benchmark that flatters the library is worthless. Every number here is built to
be falsifiable and fair: measured against the thing a competent engineer would
actually write, printed beside the exact work it did, and never rounded up into a
marketing claim. Where a measurement does not apply, the cell is the STRING `n/a`
with its reason, NEVER `0` -- a reader can never confuse "not applicable" with
"measured zero".

## Two tiers, and the empty one

Every claim this benchmark makes belongs to exactly one tier.

- DETERMINISTIC -- the operation counts. SumSequence keeps 12 counters
  (`readCounters(out)`: touches, pulls, moves, splits, merges, equalizes,
  rotSingle, rotDouble, fingerHits, fingerMisses, joinSteps, seamRepairs). They
  are exact integers, reproducible bit-for-bit on any host, and their bounds are
  gated in `npm test` (decisions/0003 G-2). Expected values come only from
  `test/spec-counts.mjs` (decisions/0003 G-9), never from the engine.
- REPORTED -- every timing: ns/op, the log2 n fit, crossover n, leaf-size
  crossover, the loss table, B/op curves, maxPauseMs. A timing is a measurement
  on one host, never a law, and it gates nothing -- not in `npm run verify`, not
  at `/release` (decisions/0003 G-1).
- STATISTICAL -- EMPTY. D-host = none (decisions/0003 G-1, ROADMAP Y-13): no
  timing ratio, slope, fit or A/B gates anything. Leaving "none" takes an ADR
  amendment by maintainer ruling with a hosted workflow (decisions/0003 G-3).

Language follows the tier. A count is "exact". A timing is "observed",
"measured" or "witnessed on this host"; a timing sentence never uses a verb that
claims deduction. A complexity word in the docs is backed by a count gate or not
written (decisions/0003 G-2).

## D1: the splice witness, counts first

lite-logn's D1 is a timing fit. Here the statistical tier is empty, so D1 leads
with the deterministic witness (maintainer ruling R-BA3, 2026-10-31):

1. Counts. For each size n (2^10 .. 2^20) and each hot op, the subject's
   touches per op are printed beside the G-11 bound (as amended by 0005 C-25, k(op) = 0): `touches(op) <= p(op) *
   HB(Lmax(n)) + k(op)`, all integers, computed by `touchesMax(row, L)` in
   `test/spec-counts.mjs` (decisions/0003 G-11). The primary foil's moves per op
   sit next to it: an insert at the middle of n elements moves n/2 of them.
2. Then the REPORTED fit. `nsPerOp = intercept + slope * log2(n)` is printed with
   its r2, and lite-logn's family floor r2 0.958 is printed as a reference only.
   The slope c = 1/log2(4/3) = 2.409 of G-11 is a REPORTED slope only; the gate
   uses the integer HB. Neither the fit nor the floor gates anything.

A reader on a different machine re-runs the counts and gets the same integers,
even when every timing differs.

## The eight dimensions

- D1 Splice witness -- counts vs G-11 first, then the REPORTED ns/op vs log2 n fit.
- D2 Amortized cost over a long mixed trace -- cumulative ns/op drift.
- D3 Memory -- typed-array bytes per live element vs the floor (4 x dims + 4).
- D4 Cache behaviour -- cursor walk vs random seek, plus a leafSize sweep; a
  portable PROXY (no native perf counters).
- D5 Bundle size -- raw and `node:zlib` gzip size of Yggdrasil.js; no minifier,
  no new devDependency; tree-shaking is `n/a` (single file, single member;
  maintainer ruling R-BA2).
- D6 GC pressure -- REPORTED B/op and maxPauseMs per op-row; each child runs
  with `--no-concurrent-recompilation`. The 0 B/op claim itself is gated by
  `test/torture.mjs` and the lane harnesses (DETERMINISTIC), not by D6.
- D7 Scalability -- insertion pattern x dims x fill. Key types are `n/a`
  ("positional, integer measures").
- D8 Workload micro-benchmarks -- the op-row workloads.

Scenarios (RESEARCH section 4.2: S1 virtual list, S2 editor line index, S7
weighted pick for this release line) are their own axis, run against the foil,
the strong rivals and the engine with exact op counts beside the times.

## Foils and rivals (RESEARCH section 4.1)

| Role | SumSequence opponent | Counts it pairs |
| --- | --- | --- |
| Primary foil (fair, O(n)) | `Array.splice` + prefix-sum rebuild into an Int32Array | moves only; every other counter `n/a` |
| Strong rival | blocked array (sqrt decomposition), hand-written in `benchmark/rivals/` | its own chunk scans, moves, splits, printed beside ours |
| Strong rival | Fenwick + rebuild on insert, hand-written in `benchmark/rivals/FenwickRebuild.js` from LiteVirtual Virtual.js:46-84 | moves only; node visits and rebuilds in native columns; touches `n/a` |
| Counter-foil (where we should lose) | Fenwick on a fixed-length, resize-only workload (S7) | as above |

Rules for every rival (ROADMAP section 3.8, maintainer rulings R-BA4, R-BA7,
R-BA8):

- Written in `benchmark/` when no npm package exists; the header names its source
  as file:line @ sha.
- Typed arrays, tuned parameters (chunk size per n) printed in the report header,
  in-place rebuilds into preallocated arrays.
- Zero allocation in its hot loop: its B/op lane runs in `npm run verify`, and a
  rival that allocates fails verify.
- A rival that cannot answer a query gets `n/a` with the reason, never a number
  and never 0.
- Reviewed like engine code.

## The loss table is mandatory (RESEARCH section 4.3)

The expected losses are hypotheses to be MEASURED and printed with their
crossover n (or "none up to n = <max measured>"): static data (a prefix-sum array
+ binary search), resize-only (Fenwick, S7), the blocked array below its
crossover (S1 / S2), point lookup by key (`Map`), tiny n (a plain array splice), split / join on a 2-element sequence (overhead dominates).
A report with no loss rows fails the honesty review, and a MEASURED results.json
with zero loss rows is rejected by the generator.

## Determinism

Op scripts are precomputed from a fixed seed (the Harness LCG, DEFAULT_SEED) into
an Int32Array before the timed loop; the loop holds no PRNG and no float. Two runs
at one seed give identical counts and an identical traceHash. Every dispatch site
(adapter, scenario, dimension) ends in a loud throw for an unknown name; an
unknown scenario exits 2.

## The statistics

The shared `Harness.mjs` (bootstrap 95% CI, Mann-Whitney U, uniform overhead
subtraction) is the same core lite-logn and lite-o1 use. Here its output is
REPORTED: printed with the timings, gating nothing. Fail closed everywhere: fewer
than 8 samples -> `n/a` (the string), never NaN / Infinity / 0.

## Provenance and the quiet host

Every timed run goes through the suite quiet lock:

    node ~/.claude/hooks/quiet-lock.mjs status
    node ~/.claude/hooks/quiet-lock.mjs run "lite-yggdrasil bench" -- <bench command>

The lock passes `QUIET_LOCK_HOST=quiet|preliminary` and `QUIET_LOCK_WHY` to the
command. The results record `hostState` = QUIET only when `QUIET_LOCK_HOST=quiet`,
else PRELIMINARY. Exit 75 (BUSY, lock held), 76 (NOISY, refused under `--strict`)
and 2 (ran, host inconclusive) are no verdict: that run is PENDING
(decisions/0003 G-1).

Every table carries the provenance line of ROADMAP section 3.8 and RESEARCH
section 4.4: date, host, CPU, Node, load average at start and end, quiet-lock
state, run count, commit + main-file sha, plus the seed and the exact command.

## Publication

- `npm run bench` writes to `benchmark/out/` (gitignored). Only the run of
  record, `npm run bench -- --publish` under the quiet lock, writes the committed
  `benchmark/results.json` and `benchmark/report.html` (maintainer ruling R-BA1).
- The README "Benchmarks" section is generated from the committed results.json,
  never hand-typed, and a test pins that README equals the generator output.
- README carries numbers only from a QUIET run of record. A PRELIMINARY
  results.json renders the R-B1 PENDING form in README, and report.html shows its
  numbers labelled PRELIMINARY (maintainer ruling R-BA5).
- The PENDING form is the current README Benchmarks paragraph byte-for-byte, with
  <version> read from package.json (maintainer ruling R-BA6). A release whose
  bench is PENDING ships no benchmark numbers (decisions/0005 R-B1, C-42).
- Numbers enter README / llms.txt / CHANGELOG only from a run log of THIS cycle,
  after the final gate run (suite law).
