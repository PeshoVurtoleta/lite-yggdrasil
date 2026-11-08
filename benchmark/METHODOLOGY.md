# How lite-yggdrasil is benchmarked

Repo-only dev doc (NOT in package.json `files[]`). This is the methodology the
`@zakkster/lite-yggdrasil` benchmark follows. It adopts Bench v2 from
`@zakkster/lite-logn` (`LiteLogN/benchmark/`, the O(log n) family copy, commit
9eb484c): `benchmark/Harness.mjs` and `benchmark/Template.mjs` are copied with a
byte-identical body (only the header comment differs). Copy and wire, never
redesign (ROADMAP section 3.8).

ASCII-only (`->`, `<=`, `x`, "degrees"). Zero runtime deps, `node:test` only.

Status (2026-11-01): Harness.mjs, Template.mjs, the adapters, dimensions and
kernel lanes are in place (629f04b); the runner, report and README generator
(`npm run bench`, `bench:report`, `bench:readme`) landed in group 1 B3 and the
README pin test in B4. Committed in burst 31-32 (5b5f375, bd7faf3): the rival fixes, the
rival tests and B/op lanes, and the scenario runner with S7 / S7b. S1a / S1b are
built (3a7a668) and S2 / S2a / S2b are built in the working tree (g2b-2b, R-BA17,
R-BA19..R-BA27; uncommitted at this edit); the chunkCap sweep / A/B / crossover tooling is built
(g2b-3a); its timed runs ran in g2b-3b (picks in benchmark/chunkcap.json, 6b70f54; the run of record INCONCLUSIVE, not
committed). Update (2026-11-06, burst 48/49): the 6-point chunkCap table was re-published (8e27490); run of record #2
(8e27490) read CONCLUSIVE and BA-16 = PAUSE (R-BA49).
Status (2026-11-06, burst 49): the BA-41 tooling unit (median-of-K
printing) landed in 804aa83; run #2 is held unpublished (R-BA52 = "Hold; re-run in a quiet window", archived, README
keeps its PENDING form; supersedes R-BA50 for run #2); run #3 (804aa83) read INCONCLUSIVE, its 60 s load trace
crossed the R-BA53 line, and it is archived, not committed. This file still holds no measured number. The sections
below are the
contract they are built to.

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
weighted pick for this release line) are their own axis, run against the strong
rivals and the engine with exact op counts beside the times; the SpliceFoil runs
no scenario (R-BA15). Built: S7, S7b, S1a, S1b, S2, S2a and S2b (there is no bare
S1; S2 is registered as itself). `npm run bench -- --scenario S7`
runs one scenario's cells.

| Id | dims / views | Per block | Stream events (--quick: /10) | Phases |
|---|---|---|---|---|
| S1a, S1b | 1 / 1 | 920 cursorWalkSum(0, y, 30) + 50 setMeasure + 30 structural (15 insertAt + 15 removeAt) | 20,000 | walk, reweight, edit, blend |
| S2 | 2 / 3 | 600 char edits + 50 Enter + 50 backspace + 150 mid edits + 25 cut + 25 paste + 50 indexAtSum + 50 sumBefore (1,000) | 20,000 | seek 2,000, reweight 15,000, edit 2,000, bulk 1,000, blend 20,000 |
| S2a | 2 / 1 | the S2 block without mid edits and bulk (800) | 16,000 | seek, reweight, edit, blend |
| S2b | 2 / 3 | 25 cut + 25 paste (50) | 1,000 | bulk |
| S7, S7b | 1 / 1 | 500 draw + reweight pairs / 950 draws + 50 reweights | 20,000 | seek, reweight, blend |

S1a inserts at the list length and removes at row 0; S1b inserts and removes in the
viewport window (R-BA16). Heights: 80% are 32, 15% uniform in [20, 200], 5% are 0.
S2 rows are filled by the line rule: row i = [d0, d1]; d0 is 1 (10%), uniform
[2, 81] (85%) or uniform [82, 255] (5%); d1 = d0 (90%), else d0 + uniform [1, d0]
capped at 255 (R-BA17). The fractions realised at n 131072 with the default seed
are deterministic (seeded generator, not measurements): S2 d0 = 1 0.10068, d0 > 81
0.04962, d1 > d0 0.10043; S2a 0.09982 / 0.04993 / 0.09810; S2b 0.10024 / 0.05083 /
0.09974. The S2 caret moves before every event; between a cut and its paste,
"length" means the main view's rows (length - L). Capacity is n + 1 for S1 and S2
(the arena total across all views for SumSequence /
BlockedArray, per instance for FenwickRebuild; R-BA21).

Two opcodes exist only for the 3-view scenarios (S2 and S2b): SPLIT 7 = splitAt(i,
views[v]) and APPEND 8 = append(views[v]), v in {1, 2} (clip, tail). A cut is
SPLIT(i + L, 2), SPLIT(i, 1), APPEND(2); a paste is SPLIT(j, 2), APPEND(1),
APPEND(2). Both views are empty again when a phase ends (checked cold by the
runner). These facts are DETERMINISTIC. The opcode rows, the empty-view check and the cell
event counts are gated in test/Scenarios.test.mjs; the S2 generator law (phase
events and ops, record shapes, block counts, caret, fill bands) is gated in
test/EditorFeed.test.mjs, an independent oracle.

## Scenario cells (maintainer rulings R-BA14..R-BA18)

- One cell = one label x scenario x size, in one child process
  (`--cell --scenario <Sid> --member <label> --n <n>`).
- Result key: `<label>/<Sid>@<n>`, e.g. `FenwickRebuild.suffix/S7@10000`. The label is
  an adapter name or `Name.variant`; the scenario id matches `S\d+[a-z]?`; n is a
  positive integer (the Bench.mjs result-key regex). A second cell with the same
  key exits 2 ("duplicate result key": one cell per label x scenario x n).
- Each scenario builds one precomputed stream of 20 blocks (a block is 1,000
  events; S2a 800, S2b 50, so the stream is 20,000 events, S2a 16,000, S2b 1,000);
  a phase replays only its class's events out of it, and blend (last)
  replays all of them: S7 seek 10,000 / reweight 10,000 / blend 20,000, S7b
  19,000 / 1,000 / 20,000, S2 seek 2,000 / reweight 15,000 / edit 2,000 / bulk
  1,000 / blend 20,000. A cell's `events` is the stream's event count, never a
  build parameter. Phases are seek | walk | reweight | edit | bulk | blend
  (R-BA15; 'splice' is retired); S7 / S7b run seek, reweight and blend. The handle
  is filled untimed and refilled before every phase.
- Cross-check: for every (scenario, n) group the runner compares, across all
  labels, each phase's checksum, endState and traceHash, and exits 1 with
  "checksum mismatch", "endState mismatch", "traceHash mismatch" or "phase
  mismatch" (a differing phase list; each names both labels) before anything is
  written. Reweight is setMeasure only, so its
  checksum is 0 by design on every label; the endState digest (length and
  sumBefore every n/64 rows plus the total, read cold after the phase) is what
  carries it.
- Fill: a FenwickRebuild handle (mode 'full' rebuilds its whole tree on every
  insert) is filled through append in 1024-row chunks from a partner handle, so
  the fill is one rebuild per chunk, not per row. This is untimed. An arena
  adapter (SumSequence, BlockedArray) cannot append across handles and fills row
  by row.
- `--quick` caps every size at 4096 (deduped) and the event stream at 1/10 (S2
  2,000 events, S2a 1,600, S2b 100). A smoke, never a run of record.
- B/op lanes (R-BA14): the rival lanes that kernel-lane's laneSet can run stay in
  `npm run kernel-lane`; getMeasure, entityAt, total, seekSum + 50 next and the
  edit lanes (insertAt at the end / removeAt at 0 on view 1 of a 3-view arena) run in
  the `--expose-gc` child of `test/Rivals.test.mjs`. Both are in `npm run verify`.
  The edit lanes are gated only after JIT warm-up (60 windows outside the gated
  region), because the rare repair paths box while still interpreted: `_merge` runs
  interpreted and `removeAt` in Maglev until tier-up (Rivals.test.mjs:995-997);
  the gate is < 16 B per 2000-op call and < 1 B/op.
- The scenario interpreter (runScript) is gated in the
  `--expose-gc` child of `test/Scenarios.test.mjs` (every S7 / S7b label x views
  0..2, n 4096, 60 warm calls outside the region): < 1 B/event and < 16 B per
  call, with a must-fail per-call control; cursorWalkSum(0, y, 30) at < 1 B/op.
- FenwickFixed is retired (R-BA18); selecting it throws with that reason. The
  Fenwick rival is FenwickRebuild mode 'suffix'; mode 'full' stays as the
  LiteVirtual-today row.

## Foils and rivals (RESEARCH section 4.1)

| Role | SumSequence opponent | Counts it pairs |
| --- | --- | --- |
| Primary foil (fair, O(n)) | `Array.splice` + prefix-sum rebuild into an Int32Array | moves only; every other counter `n/a` |
| Strong rival | blocked array (sqrt decomposition), hand-written in `benchmark/rivals/` | its own chunk scans, moves, splits, printed beside ours |
| Strong rival | Fenwick + rebuild on insert, hand-written in `benchmark/rivals/FenwickRebuild.js` from LiteVirtual Virtual.js:46-84 | moves only; node visits and rebuilds in native columns; touches `n/a` |
| Counter-foil (where we should lose) | FenwickRebuild mode 'suffix' on the fixed-length S7 / S7b draw + reweight workload (R-BA18; the FenwickFixed slot is retired) | as above |

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
crossover (S1 / S2), point lookup by key (`Map`), tiny n (a plain array splice), split / join on a 2-element
sequence (overhead dominates).
A report with no loss rows fails the honesty review, and a MEASURED QUIET results.json
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

## Sweep, A/B, crossover

Status: the tooling is built and gated (g2b-3a: Bench.mjs, Compare.mjs, Report.mjs; rulings R-BA28..R-BA36, SPEC
BA-28..BA-36; g2b-4: R-BA41, R-BA42, R-BA44). The QUIET chunkCap sweep ran (g2b-3b, benchmark/chunkcap.json at
6b70f54); the run of record read INCONCLUSIVE (R-BA29) and is not committed (R-BA39), so a new run of
record was PENDING.
Update (2026-11-06, burst 48/49): the 6-point table was committed (8e27490); run of record #2 (8e27490) read
CONCLUSIVE and BA-16 = PAUSE (R-BA49).
Status (2026-11-06, burst 49): the BA-41 tooling unit (median-of-K printing) landed in 804aa83. Run #2 is held
unpublished (R-BA52 = "Hold; re-run in a quiet window"; archived, README keeps its PENDING form; supersedes R-BA50
for run #2). Run #3 (804aa83) read INCONCLUSIVE and its 60 s trace crossed the R-BA53 line ("Every sample under the
line"); it is archived, not committed. This section still holds no measured number.
Status (2026-11-07): runs #4 and #5 are archived, not committed. Run #4 read CONCLUSIVE but its trace crossed the
R-BA53 line; run #5's trace stayed quiet but it read INCONCLUSIVE on S2a@1024 (twin non-TIE). README stays PENDING;
BA-16 = PAUSE unchanged. The twin re-measure tooling (R-BA57..R-BA60) is described below; run of record #6 is
PENDING (exclusive window, after that tooling is committed).
Status (2026-11-07, burst 50): the re-measure tooling is committed (e9fcf9c). Runs of record #6 and #7 (e9fcf9c)
read CONCLUSIVE (twin non-TIE 0 / 57, no group re-measured) but each 60 s trace crossed the R-BA53 line in one
sample (#6: 1 of 93, load1 3.40; #7: 1 of 94, load1 3.67; no node process other than the bench's own); both are
archived, not committed. README stays PENDING; BA-16 = PAUSE unchanged. No run of record has yet re-measured a group.

- Passes (BA-28): K = 5 interleaved passes, pass-major. Inside each (scenario, n) group the label order is rotated
  left by one per pass (Compare.mjs rotateLabels). A child times 5 samples per phase (3 under --quick, never a run
  of record) and reports their median; a (label, scenario, n, phase) value is the median of its K child medians. The
  sweep uses the same K.
- Win or TIE (BA-29, R-BA41): A wins when its min-of-K (the minimum of its K child medians) is below 0.95 x B's
  min-of-K (Compare.mjs BAND), B wins the same way, else TIE (neither a win nor a loss).
  The printed comparison values stay the median-of-K (the A/B 'unrolled ns/event', 'plain ns/event' and 'ratio'
  columns, the twin 'twin / BlockedArray' column, the pick's ns/event); the report prints the min-of-K beside them
  (the A/B 'unrolled min', 'plain min' and 'min ratio' columns, the twin and twin-noise 'min ratio' column, and the
  section notes). results.json stores each cell's K child medians (the cell is pass 1, its repeats passes 2..K), not a
  median-of-K. The Scenarios table and the D8 table (report.html, the Bench.mjs summarize lines, the README D8 table)
  print the median-of-K of the K stored passes ("ns/op (median of K)"), the min-of-K in a column beside it, and K
  (BA-28, BA-41, R-BA47). D8's p50 / p90 stay pass 1's per-sample spread, labelled "(pass 1)"; every other timed D-row
  value (D1..D7 timing columns) keeps pass 1, labelled "(pass 1)", its median-of-K a later ruling (R-BA51). Counts
  beside the times are pass 1's (exact, DETERMINISTIC).
- A/A twin control (BA-29): `BlockedArray.twin` (BlockedArray.js plus one comment line, separately compiled) runs
  beside `BlockedArray` in every pass. Twin vs BlockedArray other than TIE (min-of-K rule) at any (scenario, n), on
  the crossover phase only (blend; a one-phase scenario's only phase, S2b bulk), makes every comparison of that run
  INCONCLUSIVE (results.json `comparison { inconclusive, twin }`, twin[] rows carrying minRatio; each loss row's reason
  then starts INCONCLUSIVE), unless that group's re-measure reads TIE (next bullet). A missing twin cell beside a
  BlockedArray cell also reads INCONCLUSIVE (verdict 'MISSING'). The twin's other phases are never a gate (R-BA42): the
  report prints their non-TIE readings in a "twin noise (other phases, never a gate, R-BA42)" section, and results.json
  does not store them (Compare.mjs twinControl).
- Re-measure flagged once (R-BA57, R-BA60): when the twin reads non-TIE at a (scenario, n) on the crossover phase, that
  whole group (every label, K fresh interleaved passes) is measured once more after the K passes and before the drift
  sentinel, and the re-measure replaces the group's cells; both measurements are kept (results.json `remeasure`).
  The run is CONCLUSIVE only if every re-measured twin reads TIE; BAND 0.95 and min-of-K are unchanged (R-BA41). A
  MISSING twin is never re-measured (fail-closed), and noise rows (non-crossover phases) never trigger one (R-BA42). A
  re-measure cell failure fails the run like any cell (exit 1, nothing written, R-BA60).
- Crossover (BA-30): read on the blend phase (S2b, a one-phase scenario, on its only phase, bulk; Compare.mjs blendOf,
  so its crossover and chunkCap pick read bulk, not blend). The crossover vs a rival label is the smallest measured n
  from which SumSequence wins at every larger measured n; a TIE or a rival win breaks the run; none -> 'none up to
  <largest n>'. S1 = the larger of S1a / S1b; S2 = the S2 id (S2a / S2b are reported, not GO inputs); "vs
  BlockedArray" = the larger of BlockedArray and BlockedArray.plain. The maintainer combines these (Compare.mjs
  combineS1 is the helper; no pipeline code calls it, and Report's crossover table prints one row per scenario and
  rival). A loss row exists per (scenario, rival label except twin) with a rival win at >= 1 measured n; the S7
  Fenwick row reads S7's blend against FenwickRebuild.suffix. The tooling never prints GO / NO-GO (the verdict is
  the maintainer's, RESEARCH 14.4).
- chunkCap sweep (BA-31): `--sweep chunkCap` runs the registered BlockedArray at every (Sid, n) over d x {1/4, 1/2, 1,
  2, 4, 8} (R-BA44), d = defaultChunkCap(capacity) (max(16, ceil(sqrt(C))) rounded up to a multiple of 4, C the
  capacity the scenario builds at that n, computed cold in the parent). Each grid member is rounded up to a multiple of 4,
  clamped to [8, 65536] and deduped. The pick is unchanged by the min-of-K rule: the lowest median-of-K blend ns/event; a
  pick at the grid's first or last entry prints 'edge'. Cells are keyed `<label>/<Sid>@<n>~c<chunkCap>`.
- Exclusions (BA-34): a scenario cell whose census wall time exceeds 300 s per pass is left out and printed with its
  census seconds; no SumSequence or BlockedArray cell is ever excluded. Nothing is excluded today
  (the EXCLUDED list in Bench.mjs is empty: the B0 census, PRELIMINARY, one pass at frozen ea760e4,
  found no cell over 300 s; SPEC BA-34).
- `benchmark/chunkcap.json`: `{ schema: 'yggdrasil-chunkcap/1', meta, picks }`. meta = date, hostState, commit,
  mainFileSha, runCount, loadAvgStart, loadAvgEnd, quietLockWhy, command (the results.json meta fields of the same
  names). One picks row per swept (Sid, n): scenario, n, capacity, d, grid, chunkCap, edge, nsPerEvent (median-of-K
  blend ns/event, REPORTED). validatePicks checks it when written and when read by `--picks` (fail closed on a
  malformed field, an unknown key, a non-plain object, or a chunkCap that is not a multiple of 4 in [8, 65536]). A
  QUIET `--sweep chunkCap --publish --all` writes this committed file ONLY (no results.json / report.html); a sweep
  without --publish writes `benchmark/out/chunkcap.json` beside its out/ results. The committed file was on the
  5-point grid (no 8 x d), which validatePicks rejects; the QUIET re-sweep (R-BA44) re-published it on the 6-point
  grid (8e27490, 2026-11-06).
- `--picks <path>`: every BlockedArray label (BlockedArray, BlockedArray.plain, BlockedArray.twin) runs each (Sid, n)
  at the picked chunkCap under its untagged key; results.json carries `tuning { source, sha256, hostState, picks }`.
  planCells exits 2 (also under --quick) on a BlockedArray cell with no pick for its (Sid, n), on a stale pick (its
  capacity is not the capacity this run builds there: re-run the sweep), and on a picks table naming no BlockedArray
  cell of the run. A cell that recorded another chunkCap exits 1.
- publishGuard refusals (exit 2, before any cell runs or any file is written):
  - `--publish` without `--all` (BA-33);
  - `--publish` whose `--runs` is not 5 (R-BA28);
  - `--sweep` with `--picks` (the sweep computes the picks);
  - a sweep `--publish` on a non-QUIET host (only a QUIET sweep writes chunkcap.json);
  - a QUIET run, published or not, citing a non-QUIET `--picks` table;
  - a QUIET run-of-record `--publish --all` with no `--picks` table, or one whose meta.runCount is not 5.
- Empty loss table (BA-35, R-BA35): a MEASURED QUIET results.json with an empty lossTable makes Readme.mjs
  renderBenchmarksSection throw (Readme.mjs:151-152); README keeps its PENDING form and the run is re-planned. A run
  with no untagged scenario cell (D-rows only, or a sweep) carries lossTable [] and no `comparison`; it is not a run
  of record.
- Comparison record (BA-36, R-BA36): validateResults requires `comparison { inconclusive, twin }` whenever status is
  MEASURED and any key is an untagged scenario key (`<label>/<Sid>@<n>`, no ~c tag); a missing record throws, since
  an unmeasured twin control is never treated as TIE.
- Re-measure record (R-BA58, R-BA59): results.json carries top-level `remeasure: [{ scenario, n, first: { twin, results } }]`,
  written (possibly []) on every run with a comparison record; files without the key (runs #1..#5) stay valid and
  render byte-identically. For a new-format file the validator checks that every A/B twin row is listed in
  `remeasure` and that `comparison` equals the twin control re-read on the stored cells. report.html adds the section
  "twin re-measure (R-BA57)" and the generated README provenance names each re-measured group (", twin re-measure
  (R-BA57): none" or "<Sid>@<n> (first <v>, re-measure <v>)").

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

- `npm run bench` writes to `benchmark/out/` (gitignored). Only `--publish`, run under the quiet lock (exit 2
  outside it), writes the committed `benchmark/results.json` and `benchmark/report.html` (maintainer ruling R-BA1);
  publishGuard requires `--all` (BA-33), `--runs 5` (R-BA28) and, on a QUIET host, a QUIET `--picks` table swept at
  K = 5 (BA-31). The run of record is
  `npm run bench -- --publish --all --runs 5 --picks benchmark/chunkcap.json` run under `quiet-lock run --strict`
  (procedure: Bench.mjs reads only QUIET_LOCK_HOST and does not enforce --strict), after the QUIET
  `--sweep chunkCap --publish --all --runs 5` that writes chunkcap.json (see "Sweep, A/B, crossover").
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
