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
>
> **UPDATE (2026-10-31; supersedes the 2026-10-28 sequencing): Bench-ADOPT is under way, ahead of the lite-signal
> release (maintainer 2026-10-31: "start
> next, i will release 0.2.0, then signal"). Committed: the Bench v2 kit copy and the blocked-array and Fenwick
> rivals (3c6ef73), adapters / dimensions D1-D8 / kernel lane (629f04b), runner / report / README generator / Bench
> tests (7b4187b). Committed (burst 31-32): the rival fixes R-BA9 / R-BA10 / R-BA13 (5b5f375),
> test/Rivals.test.mjs, the rival B/op lanes, and group 2b-1 (the scenario runner, S7 / S7b, the cross-check) (bd7faf3).
> Built since: S1a / S1b (3a7a668) and S2 / S2a / S2b (g2b-2b, review APPROVED, uncommitted in the working tree).
> Left: the chunkCap sweep, unroll A/B, loss rows, run of
> record and results.json (g2b-3) and the pre-registered GO /
> NO-GO (section 5). SumMap settle input: RESEARCH.md 13
> (PROPOSED) and RESEARCH.md 16 (PROPOSED: compare-form probe, Smi top, sorted-btree, S4-depth); rivals and GO /
> NO-GO: RESEARCH.md 14; scenario mixes: RESEARCH.md 15 (RULED, R-BA15..R-BA27).**
>
> **UPDATE (2026-11-06, burst 48/49; supersedes "the GO / NO-GO (BA-16) has no verdict yet" of the 2026-11-05 line and
> "Next: ... the run of record (BA-16); the SumMap engine planner waits for BA-16 (R-SM9)" of the burst-45 line):
> the 6-point chunkCap table was re-published (QUIET re-sweep, committed 8e27490) and run of record #2 read CONCLUSIVE
> (8e27490, twin 0 / 57). BA-16 is DECIDED = PAUSE (R-BA49, "PAUSE (Recommended)", section 5): BlockedArray beats
> SumSequence at n >= 100k on S2. The SumMap engine planner now waits for the R-7 research burst's ruled PROPOSAL
> (F = 4 and F = 8 first, RESEARCH 16.5; R-SM9 PAUSE branch). Run #2's results.json / report.html are held uncommitted
> until the BA-41 tooling unit lands (R-BA50 "Hold until BA-41 (Recommended)", a ruling, not done).**
> (2026-11-06, burst 49: BA-41 landed in 804aa83; R-BA52 "Hold; re-run in a quiet window" holds run #2 unpublished
> and supersedes R-BA50 for it; run #3 read INCONCLUSIVE, trace crossed the R-BA53 line, archived, not committed;
> README keeps PENDING, BA-16 = PAUSE unchanged. Detail: section 5 note.)
>
> **UPDATE (2026-11-05; supersedes "Left: the chunkCap sweep, unroll A/B, loss rows, run of record ..." of the
> 2026-10-31 line): g2b-3a landed; g2b-3b ran (the chunkCap sweep wrote benchmark/chunkcap.json, committed 6b70f54;
> the run of record was INCONCLUSIVE on the twin A/A control and is archived, not committed, rulings R-BA39 /
> R-BA40; the GO / NO-GO (BA-16) has no verdict yet). Next is the SumMap research burst, twin A/A noise first.
> Hosted CI (burst 42): .github/workflows/ci.yml runs npm test + npm run test:types on every push / PR (node 22 /
> 24 / 26 x ubuntu-latest + macos-latest, plus node 26.8.2 per OS: 8 legs), and .github/workflows/nightly.yml runs
> the full npm run verify daily (node 26 (newest 26.x, Y-CI-8) and 22 x both OSes: 4 legs). DETERMINISTIC tier only;
> Y-13 stands (no timing threshold or statistical gate). The first push run and first nightly (2026-11-05) were a
> census (Y-CI-5): node 26.8.2 (both OSes), ubuntu node 24 and macOS 26.13.0 green; node 22, ubuntu 26.13.0 and
> nightly 'latest' (a node 27 alpha) red; macOS node 24 (push) and macOS node 22 (nightly) cancelled before a runner
> (Y-CI-9, PENDING); verify's tails ran on no nightly leg. Burst 44 answers the red rows with Y-CI-6a / Y-CI-7a /
> Y-CI-8 (expected green, unobserved: the next runs are pending).**
>
> **UPDATE (2026-11-05, burst 45; supersedes the older 'Next' sentences and 'Y-CI-9, PENDING' / 'expected green,
> unobserved' of the earlier 2026-11-05 lines): census check 3 and the SumMap research continuation. Push run
> 42101258088 of b76f3cc: 8 / 8 legs green (the node 22 legs print the Y-CI-6a REPORTED meter lines; ubuntu 26.13.0
> green; macOS node 24 ran). Dispatched nightly 42117882541: the node 26 legs are green with verify's tails observed
> (torture alloc gc major 0 (engine windows; whole-window major 1, REPORTED), retention ok, jit 5/5, kernel-lane 63
> lanes worst 0.000 B/op); the node 22 legs are red on the torture jit nil-guard gate (C-5, Y-CI-10: probe first).
> Rows C-1..C-4 are closed by observation. SumMap research continuation: the QUIET P1b / P2 probes ran; R-BA41..R-BA44
> are ruled (BA-29 min-of-K 0.95, the twin check on the crossover phase only, K = 5 kept, sweep grid + 8 x d); R-BA45
> (GO reads the BA-29 min-of-K verdict) and R-SM10 (DB-5 references) are ruled; R-SM1..R-SM9 (burst 43) are in the
> table below and in RESEARCH.md 17. Next: a Bench tooling code unit for BA-29 / BA-31, a QUIET re-sweep, the run of
> record (BA-16); the SumMap engine planner waits for BA-16 (R-SM9).**

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
| **Y-CI-1** | S3 | Hosted CI: verification tier. | "Deterministic only (Recommended)": Hosted CI runs the DETERMINISTIC tier only: npm test plus verify's untimed parts (types, allocation / GC count lanes, torture). RULED Y-13 "none: statistical claims are REPORTED only" stands; CI carries no timing threshold and no statistical gate. | **RULED 2026-11-05** (burst 42) |
| **Y-CI-2** | S3 | Hosted CI: push / PR vs nightly jobs. | "Split (Recommended)": ci.yml (push / PR): npm test + npm run test:types. nightly.yml (cron + workflow_dispatch): the full npm run verify (adds test:lanes, torture, kernel-lane). A nightly failure in a count gate is a DETERMINISTIC-tier test bug to fix, never re-run for green. | **RULED 2026-11-05** (burst 42) |
| **Y-CI-3** | S3 | Hosted CI: OS x Node matrix. | "LiteUtils matrix (Recommended)": ci.yml: node 22 / 24 / 26 x ubuntu-latest + macos-latest, plus one node 26.8.2 leg per OS (the version the measured comments and REPORTED numbers name); nightly.yml: node 'latest' and 22 (check-latest) x both OSes. No Windows. engines ">=18" stays as is but untested in CI: a FILLERS item asks whether to raise it. | **RULED 2026-11-05** (burst 42); nightly node spec amended by Y-CI-8 ('latest' -> '26') |
| **Y-CI-4** | S3 | Hosted CI: devDependency install. | "npm install, log versions (Recommended)": CI runs `npm install --no-audit --no-fund` against the declared ^ ranges (no lockfile, no npm cache) and a provenance step prints `npm ls --depth=0`, so every run records the devDependency versions it tested. | **RULED 2026-11-05** (burst 42) |
| **Y-CI-5** | S3 | Hosted CI: rows failing only off node 26.8.2. | "Census, then rule per row (Recommended)": The first CI run is a census: each row that fails only off node 26.8.2 is logged in .handoff/evidence/b42-ci/ with leg, file:row and observed vs expected; nothing in test/ changes; each such row comes back to the maintainer as its own question (skip-with-reason below node N as in LiteUtils A1, recalibrate per version, or fix the engine). | **RULED 2026-11-05** (burst 42) |
| **Y-CI-6** | S3 | Hosted CI: node 22 rival B/op rows (Q-CI-1). | "Skip rival rows < 24 (Recommended)": On node < 24 the rival (BlockedArray-family) B/op rows of those 4 children skip with the reason 'rival edit path allocates on node < 24 (census b43: 316-365 B per call on 22.23.4)'; every engine lane and every must-fail control stays gated on every version; a test-only change, its own coder batch + review, with a row that fails on the old code. | **SUPERSEDED 2026-11-05** (ruled burst 43) by Y-CI-6a (burst 44: its premise, only rival rows fail on node 22, was false) |
| **Y-CI-6a** | S3 | Hosted CI: node 22 alloc meter (Q-CI-1a). | "Lanes REPORTED < 24 (Recommended)": Y-CI-6 reads: on node < 24 the 4 alloc children still run; every B/op lane row and every per-call / per-op must-fail control row (engine and rival) is printed, not asserted, with the reason 'alloc meter uncalibrated on node < 24 (census b43: rival edit 316-365 B per call, later lanes -55 / -880, a must-fail control -648)'; the gc major 0, retention, coverage and lane-count rows stay gated on every version (unobserved on 22: a failure there is a new census row); node >= 24 gates every row unchanged; test-only, with a row that fails on the old code. | **RULED 2026-11-05** (burst 44) |
| **Y-CI-7** | S3 | Hosted CI: node 26.13.0 ubuntu major GC (Q-CI-2). | "Split the child (Recommended)": The A5 child is split so no alloc child compiles more than 2 BlockedArray variants (the known major-GC trigger), keeping every lane and control and maxMajor 0 on every version; test-only change, its own coder batch + review; the next CI run shows whether 26.13.0 ubuntu is green. | **SUPERSEDED 2026-11-05** (ruled burst 43) by Y-CI-7a (same sitting: its "more than 2" was imprecise) |
| **Y-CI-7a** | S3 | Hosted CI: EditorFeed A5 child split (Q-CI-2a). | "One variant per child (Recommended)": Y-CI-7 reads: the A5 lanes run in one child per BlockedArray variant (BlockedArray + the non-BlockedArray labels in one child, BlockedArray.plain alone, BlockedArray.twin alone), so no alloc child compiles more than 1 BlockedArray variant; every lane, control and maxMajor 0 kept on every version; the same rule is applied to the other 3 alloc children of Y-CI-6 only if a census shows a major GC there. | **RULED 2026-11-05** (burst 43) |
| **Y-CI-8** | S3 | Hosted CI: nightly node spec (Q-CI-3). | "Pin newest stable major (Recommended)": The nightly 'latest' legs become node 26 (setup-node resolves the newest 26.x release), bumped by hand to 27 once 27 ships a stable release; no prerelease node in CI; workflow-only change + review (validate-workflows.mjs updated). | **RULED 2026-11-05** (burst 43) |
| **Y-CI-9** | S3 | Hosted CI: legs cancelled before a runner (Q-CI-4). | "Wait for next runs (Recommended)": No re-run now; the next push run and the 04:17Z cron show those legs; the census records them PENDING (runner, not code). | **RULED 2026-11-05** (burst 43; the cancelled legs are PENDING on runners, not code) |
| **Y-CI-10** | S3 | Hosted CI: node 22 nightly jit nil-guard (Q-CI-11, census row C-5). | "Probe the reason first (Recommended)": "C-5 stays red, nothing changes now; a later burst runs `node test/torture-jit.mjs` (it prints the failing rule R1..R4 and the signature per row) on a node 22.23.4 binary obtained with the maintainer's approval at that time (download or another package's copy, asked then), and the fix is asked as its own Q-id with that reason in its option text. This burst continues with the SumMap research (b)." | **RULED 2026-11-05** (burst 45; C-5 stays red until the probe + its own Q-id) |
| **R-SM1** | S2 | SumMap rivals (Q-S5). | "Treap + sorted array (Recommended)": "\"Treap + tail-best sorted array, Map timing-only\": lite-logn Treap and a tail-best sorted array (lite-logn SortedArray, else hand-written in benchmark/rivals/) are the live rivals, gated in verify under BA-7 / BA-7a; each must read 0 B/op on its lanes before it is wired in, and one that allocates is replaced by a hand-written form in benchmark/rivals/ or left out with its reason printed; Map stays the counter-foil for get / set / delete as a timing-only row outside kernel-lane and the Rivals child (exempts Map from BA-7 / BA-7a: no B/op lane, its rows labelled 'not allocation-gated'; it allocates by design); sorted-btree is documented (RESEARCH 16.3), not installed; lite-logn Scapegoat is not a rival (Treap covers the balanced-BST class); lite-logn arrives as a devDependency with SumMap (R-BA4)." | **RULED 2026-11-05** (burst 43) |
| **R-SM2** | S2 | SumMap key storage and compare form (Q-S2). | "Int32Array + xor-bias (Recommended)": "Keys stored as k \| 0, every compare `(a ^ -2147483648) < (b ^ -2147483648)`, `>>> 0` only at a public key return; a QUIET X / S / U run of the 16.1 probe may revisit the form before the compare rung lands, never after." | **RULED 2026-11-05** (burst 43) |
| **R-SM3** | S2 | SumMap absent-key results (Q-S1). | "-1 / NaN / false (Recommended)": "get / delete (entity) and successor / predecessor / minKey / maxKey / keyAtSum (key) return -1 for "none"; getMeasure returns NaN (key and dim checked first); has / setMeasure return false; no throw." | **RULED 2026-11-05** (burst 43) |
| **R-SM4** | S1 | SumMap finger; amends invariant I-9 (Q-S4). | "Fence-key finger (Recommended)": "I-9 is amended so SumSequence keeps its positional finger and SumMap uses the inclusive fence-key finger [_flo, _fhi] (bit pattern -1 = 2^32 - 1 on the rightmost leaf) for get / has / getMeasure / set / setMeasure / delete, with the tail-delete shrink of RESEARCH 13.2; rank / select / sumBelow / keyAtSum always descend from the root; fingerHits / fingerMisses count it; the standing gate finger on == finger off covers SumMap." | **RULED 2026-11-05** (burst 43) |
| **R-SM5** | S2 | SumMap cursor prev() (Q-S8). | "No prev() in 0.2.0 (Recommended)": "The cursor has next() only; the bid side walks deepest-first with seekIndex(max(0, length - w)) + next(); S4a and S4b per RESEARCH 16.6 with that walk stated; prev() is a later rung if S4 shows the need." | **RULED 2026-11-05** (burst 43) |
| **R-SM6** | S2 | SumMap set return value (Q-S3). | "this (Recommended)": "set returns this (Map.set style); whether k was new is length's change." | **RULED 2026-11-05** (burst 43) |
| **R-SM7** | S2 | SumMap big-key B/op lane (Q-S6). | "Straddle Smi top (Recommended)": "\"Straddle the Smi top, b per op\": the big-key B/op lane draws keys straddling 2^31 (2^31 - 1, 2^31, 2^31 + 1, 2^32 - 1 and a band in [2^31, 2^32)), reads the build flag (pointer compression -> Smi top 2^30, else 2^31) to set its expectation, and is bounded <= 16 x b + 1 B/op where b = key returns + measure returns of that op (C-13 form); the lane must also read >= 1 B/op (above R-G2's 0 B/op threshold; a floor: a lane that never returns a key at or above the Smi top fails, DB-8); its control is a lane whose keys stay below the build's Smi top and must read 0 B/op." | **RULED 2026-11-05** (burst 43) |
| **R-SM8** | S2 | SumMap argument check order (Q-S7). | "Argument order (Recommended)": "\"Argument order, then state\": every op checks its arguments in argument order (set: 'key', 'entity', 'measure' / 'extra'; getMeasure / setMeasure: 'key', 'dim', then the value; sumBelow: 'dim', then 'key'), then state (capacity / headroom / pool); join: 'operand' before 'order', then headroom / pool; getMeasure checks key and dim BEFORE presence (absent -> NaN only for valid arguments); the planner states it per op as an ASSERTION row." | **RULED 2026-11-05** (burst 43) |
| **R-SM9** | S1 | SumMap sequencing under the PAUSE risk: the engine planner waits for BA-16 (Q-P1). | "Surface now, engine waits (Recommended)": "\"Rule the surface now, engine waits for BA-16\": this PROPOSAL's Part B is ruled now; the SumMap engine planner waits for the GO / NO-GO decision on a CONCLUSIVE run of record; if that run fires PAUSE, an R-7 research burst (F = 4 and F = 8 first, RESEARCH 16.5) runs before any SumMap engine work." | **RULED 2026-11-05** (burst 43); BA-16 decided PAUSE 2026-11-06 (R-BA49) |
| **R-SM10** | S2 | DB-5 keyed-order references for SumMap (Q-DB5). | "lite-logn Treap + model (Recommended)": "DB-5's keyed-order references for SumMap are the naive sorted-array model (3.2) plus lite-logn Treap (the R-SM1 live rival, a devDependency with SumMap per R-BA4); sorted-btree stays documented, not installed (R-SM1 unchanged); ROADMAP DB-5's text says so." | **RULED 2026-11-05** (burst 45) |

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
AS BUILT (2026-10-31, HEAD fb09e6f): the scripts `bench` (node benchmark/Bench.mjs), `bench:report` (Report.mjs),
`bench:readme` (Readme.mjs --check) and `kernel-lane` exist, and `verify` ends with `npm run kernel-lane`.
AS BUILT (2026-11-05, burst 42; Y-CI-1..5): .github/workflows/ci.yml (push / PR: npm install --no-audit --no-fund,
npm ls --depth=0 as deps provenance, npm test, npm run test:types; 8 legs) and .github/workflows/nightly.yml (cron +
workflow_dispatch: the same steps with npm run verify; 4 legs). No lockfile, no npm cache, no Windows, no quiet lock,
no bench script in CI; engines ">=18" is untested (floor leg node 22). The R-LU1 tools --self-test rows are a
commented slot in both files.
AS BUILT (2026-11-05, burst 44; Y-CI-6a / 7a / 8): test/meter-gate.mjs gates the B/op lane and must-fail control rows
of the 4 alloc children (EditorFeed A5, Rivals child, ScenarioFeed A3, Scenarios A3) on node >= 24 and prints them as
REPORTED on node < 24 (gc major 0, retention, coverage and count rows gated everywhere); EditorFeed A5 runs 3 lane
children (BlockedArray + the non-BlockedArray labels, BlockedArray.plain alone, BlockedArray.twin alone); nightly.yml
node ['26', '22'] with check-latest; npm test on node 26.8.2: 1357 tests, 1356 pass, 1 skip, 0 fail (burst 44 run).
Ruled 2026-10-25 (R-SC): S0 ships `npm test`, `test:types`, `verify` only; `torture` / `test:perf` arrive with SumSequence and `bench` with Bench-ADOPT, so no script is ever green on nothing. (`test:lanes` and `torture` arrived with SumSequence; `bench` arrived with Bench-ADOPT, 7b4187b; `test:perf` has not.)

### 3.2 Oracle gate (DETERMINISTIC)
Fuzz vs an INDEPENDENT oracle written from the spec, not from the engine: a plain JS array of
(entity, measures) for SumSequence, a sorted array for SumMap, a naive interval list for IntervalMap.
0 divergences over seeded streams; every structural event (interior split 9|8 / 8|9, edge split 13|4 / 4|13, merge,
equalize, rotation single / double, join, splitAt) asserted to fire > 0 times per stream.

### 3.3 Invariant walker (DETERMINISTIC)
Runs after EVERY op in the fuzz and the exhaustive small-scope runs (section 4 DB-2, DB-3): I-1
balance at every node, I-2 summaries recompute exactly, I-3 totals bound, I-5 leaf occupancy, I-6
fences, I-7 id signs, I-8 height <= spine size, I-9 finger (0005 C-28; SumMap's fence-key finger per R-SM4).

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
- AS-BUILT (g2b-3a, 2026-11-04): the sweep / A/B / crossover / loss-table tooling is built and gated
  (benchmark/Bench.mjs,
  Compare.mjs, Report.mjs; benchmark/METHODOLOGY.md "Sweep, A/B, crossover").
- RAN (g2b-3b, 2026-11-05): the QUIET chunkCap sweep wrote benchmark/chunkcap.json (committed 6b70f54); the run of
  record at 6b70f54 read INCONCLUSIVE (R-BA29: twin A/A not TIE at 28 of 204 (scenario, n, phase) cells), so it is not
  committed and the README keeps its PENDING form (R-BA39), and BA-16 takes no verdict from it (R-BA40); rulings and
  the REPORTED readings: RESEARCH 14.4. The twin A/A noise research ran (burst 45, RESEARCH 17.3 / 17.4) and is ruled
  R-BA41..R-BA44 (17.6). Next: the Bench tooling code unit for BA-29 / BA-31, a QUIET re-sweep, then a new run of
  record (BA-16).
  (2026-11-06, burst 48/49: all three done; run of record #2 read CONCLUSIVE and BA-16 = PAUSE, R-BA49, section 5.)
- Benchmark rulings R-BA1..R-BA8 -- RULED (maintainer, AskUserQuestion, 2026-10-31; cited by benchmark/METHODOLOGY.md;
  option text quoted verbatim from the maintainer-local, gitignored .handoff/SPEC-bench-adopt.md "Maintainer rulings";
  R-BA9..R-BA11 are quoted in section 6 (Bench-ADOPT notes, "Competent rivals -- RULED"), R-BA12 in section 5,
  R-BA13..R-BA18 in section 6 ("Scenario rulings -- RULED")):
  R-BA1 "Commit run of record (Recommended)": "results.json and report.html are committed, but only the run of record
  writes them. `npm run bench` writes to benchmark/out/ (gitignored); `npm run bench -- --publish`, run under
  quiet-lock, writes benchmark/results.json and benchmark/report.html. The README pin reads the committed results.json,
  so a local bench run never turns npm test red."
  (As built, BA-33 / R-BA28 / BA-31: --publish needs --all and --runs 5, and on a QUIET host a QUIET --picks table;
  the run of record is `npm run bench -- --publish --all --runs 5 --picks benchmark/chunkcap.json` run under
  `quiet-lock run --strict` (procedure, not enforced by Bench.mjs), after the QUIET
  `--sweep chunkCap --publish --all --runs 5`; see benchmark/METHODOLOGY.md "Sweep, A/B, crossover".)
  R-BA2 "Raw + gzip, no dep (Recommended)": "D5 reports the raw and node:zlib gzip size of Yggdrasil.js, with no
  minifier and no new devDependency; the tree-shaking column is 'n/a' (single-file, single-member package)."
  R-BA3 "Counts, then REPORTED fit (Recommended)": "D1 shows the deterministic splice-witness counts first (touches per
  op against the G-11 bound, the foil's moves per op), then the REPORTED ns/op vs log2 n fit with lite-logn's r2 0.958
  printed as a reference only; neither gates anything."
  R-BA4 "Hand-written (Recommended)": "The Fenwick + rebuild rival is hand-written in benchmark/rivals/FenwickRebuild.js
  from LiteVirtual Virtual.js:46-84 under the fair-rival rules; its rebuild runs in place into preallocated arrays, and
  the report header names its source as file:line @ sha. No new devDependency (lite-logn arrives as a devDependency with
  SumMap)."
  R-BA5 "QUIET run only (Recommended)": "README carries numbers only from a QUIET run of record; a PRELIMINARY
  results.json renders the R-B1 PENDING form in README, and report.html shows the numbers labelled PRELIMINARY."
  R-BA6 "Current text, byte-exact (Recommended)": "The generator's PENDING form reproduces the current README Benchmarks
  paragraph byte-for-byte with <version> from package.json, so this repo-only unit changes no shipped file."
  R-BA7 "In npm run verify (Recommended)": "The rival B/op lanes are chained into npm run verify (folded into
  benchmark/kernel-lane.mjs with the engine adapter lanes); a rival that allocates fails verify."
  R-BA8 "moves only (Recommended)": "Fenwick pairs only moves (elements shifted) with the engine; node visits and
  rebuilds print in native columns; touches = n/a."
- **Generated, not typed.** The README "Benchmarks" section and `benchmark/report.html` are generated
  from `benchmark/results.json`; test/Bench.test.mjs pins it ("A4: render(null) == README section == README.HEAD
  section", with a 1-byte-mutation control;
  "A4: README pin survives a committed results.json"): the README Benchmarks section equals the generator's
  PENDING form, byte for byte (R-BA6).
- **Reproduce**: `npm run bench` (all), `npm run bench -- --scenario S7` (one); the report header
  prints the exact command.
- AS BUILT (2026-10-31, HEAD fb09e6f; commits 3c6ef73, 629f04b, 7b4187b; group 1 B1-B4): benchmark/Bench.mjs (runner),
  Report.mjs, Readme.mjs (README generator, `--check`), Dimensions.mjs (D1-D8), Adapters.mjs, Scenarios.mjs (registry,
EMPTY at that commit: S1 / S2 / S7 arrive in group 2b), Matrix.mjs, kernel-lane.mjs (engine adapter B/op lanes;
  RIVAL_LANES = []),
  METHODOLOGY.md, and test/Bench.test.mjs (76 tests in 6 suites, 76 pass,
  run 2026-10-31). At that commit not built: benchmark/results.json and report.html (no run of record yet; the README
  shows the PENDING form), the rival fixes, the rival tests and rival B/op lanes, and group 2b. The registry and
  RIVAL_LANES figures in this line are as of fb09e6f; the next line supersedes them.
- AS BUILT (5b5f375 + bd7faf3, burst 31-32; g2a + g2b-1; APPROVED by review): FenwickRebuild 'suffix' mode
  (R-BA9, R-BA13); BlockedArray asymmetric split (R-BA10); test/Rivals.test.mjs (differential, 28 mutants, the
  --expose-gc B/op child, the edit lane); kernel-lane.mjs 63 lanes (9 laneSet calls x 7 kernels: SumSequence + 8
  RIVAL_LANES, R-BA14); Adapters.mjs (rivals BlockedArray, BlockedArray.plain, FenwickRebuild.suffix,
  FenwickRebuild.full; FenwickFixed RETIRED, R-BA18; cursorWalkSum, createViews); Scenarios.mjs (R-BA15 shape,
  runScript, S7 / S7b, phaseEndState); Bench.mjs (scenario child, keys <label>/<Sid>@<n>, crossCheck of checksum +
  endState + traceHash, exit 1 on a mismatch, exit 2 on a duplicate key); test/Scenarios.test.mjs. Not built at
that commit: S1 and S2 (since built, see the next two lines), the chunkCap sweep, the unroll A/B, the run of record
  and results.json (g2b-3), the bulk and
  view-indexed opcodes.
- AS BUILT (3a7a668, g2b-2a + g2b-2b B1): S1a / S1b registered (dims 1, 1 view; R-BA16, R-BA19; they use WALK),
  plus the SPLIT 7 / APPEND 8 opcodes and the 3-view runner (R-BA21).
- AS BUILT (g2b-2b, working tree, uncommitted; review APPROVED): S2 / S2a / S2b registered from one generator
  (buildEditor, EDITOR_MASK) under R-BA17 and R-BA19..R-BA27; S2 and S2b are the only users of SPLIT 7 / APPEND 8;
capacity n + 1; A6 cells S2@131072, S2@100000, S2b@131072 pass on 4 labels (Fenwick full excluded: g2b-3 wall
  time). No timing is
  of record (S2 quick cells ran PRELIMINARY). The S2 generator law is gated in
  test/EditorFeed.test.mjs, an independent oracle (38 tests, review APPROVED).
- **Rivals at a pinned version** (`@flatten-js/interval-tree`, lite-logn; `sorted-btree` documented, not installed,
  R-SM1) as devDependencies, their versions printed in the header; a rival that cannot answer a query gets
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
  sums, for SumMap's keyed order the naive sorted-array model plus lite-logn Treap (R-SM10; `sorted-btree`
  documented, not installed, R-SM1)). Three-way disagreement localizes the bug.
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
  Pre-registered reading (maintainer 2026-10-31, R-BA12 "Pre-register, gap closed (Recommended)"; RESEARCH 14.4):
  "Pre-registered before the run: GO if S1's crossover vs BlockedArray is <= 64k and SumSequence wins at 100k and
  1M, AND S2's crossover is <= 32k and SumSequence wins at 100k, AND the S7 loss row shows the Fenwick rival winning
  fixed-n reweighting. PAUSE and evaluate R-7 if BlockedArray beats SumSequence at n >= 100k on S1 or S2. Any other
  outcome has no automatic verdict: the maintainer decides from the table. 'Wins' = median of K interleaved runs on a
  QUIET host; a PRELIMINARY log decides nothing."
  Note (2026-11-05, burst 45, R-BA45, quoted in RESEARCH 17.6): R-BA41 amends 'Wins' -- a win in this reading is the
  BA-29 verdict (min-of-K, 0.95 band) on a QUIET host; amended before any CONCLUSIVE run of record was read.
  Note (2026-11-06, burst 48/49): BA-16 DECIDED = PAUSE.
  R-BA49 (Q-BA16, 2026-11-06, burst 48, on b48 run of record #2, CONCLUSIVE) = "PAUSE (Recommended)". Option text:
  "BA-16 = PAUSE per the pre-registered reading (R-BA12 as amended by R-BA45). On b48 run of record #2 (8e27490,
  CONCLUSIVE, twin 0 / 57), BlockedArray beats SumSequence at n >= 100k on S2 (S2@100000 blend, min-of-K, 0.95
  band). An R-7 research burst (F = 4 and F = 8 first, RESEARCH 16.5) runs before any SumMap engine work (R-SM9)." The
  question
  stated the host caveat below.
  run of record #2 (8e27490, Yggdrasil.js sha256/8 e0618227, chunkcap.json f79b43a6): `node benchmark/Bench.mjs
  --publish --all --runs 5 --picks benchmark/chunkcap.json`, K = 5, 358 cells, node v26.8.2, darwin arm64 Apple M4 Pro
  (12 cores), 2026-11-06, start 09:25:15Z QUIET (load1 2.46, baseline 2.21), end 11:11:18Z (load1 1.16), 6,363 s,
  exit 0, drift sentinel 6.6% (< 10%). HOST CAVEAT: the start was QUIET but load1 peaked 26.7 at 09:28-09:41Z and sat
  3-8 at
  10:00-10:25Z (other sessions; no other node process); a 60 s load trace is kept with the evidence.
  Readings (REPORTED, never a law; verdict CONCLUSIVE: twin A/A crossover-phase non-TIE 0 / 57; 18 twin-noise rows on
  non-crossover phases, REPORTED, never a gate, R-BA42; lossTable 15 rows). Crossovers vs BlockedArray (BA-29:
  min-of-K, 0.95 band): S1 1024 (S1a / S1b x unrolled / plain), SumSequence wins at 100k and 1M; S2 none up to 131072
  (BlockedArray wins every n through 100000; plain crosses at 131072), so BlockedArray beats SumSequence at
  S2@100000; S2a none up to 131072 (plain 100000); S2b 16384 (bulk); S7 / S7b: FenwickRebuild wins at every n (the
  expected fixed-n reweight loss). Against the pre-registered reading: the S1 clauses hold (1024 <= 64k, wins at
  100k and 1M); the S7 clause holds (FenwickRebuild wins S7 / S7b at every n); the S2 clause fails (no crossover <=
  32k, no win at 100k) and BlockedArray beats SumSequence at n >= 100k on S2 -> the PAUSE branch.
  R-BA50 (Q-PUB) = "Hold until BA-41 (Recommended)": run #2's results.json + report.html are held uncommitted until
  the BA-41 tooling unit (median-of-K printing, R-BA47) lands; then one commit carries results.json, report.html
  regenerated from it and the README Benchmarks section, batched with the release (HOLD-RELEASE). A ruling, not done.
  (2026-11-06, burst 49): superseded for run #2. BA-41 (median-of-K printing) landed in 804aa83.
  R-BA52 (Q-PUB2) = "Hold; re-run in a quiet window": "Run #2 stays unpublished (archived in
  .handoff/evidence/bench-adopt/b48-ror2/); README keeps its PENDING form. A new run of record (BA-37..BA-40 standing)
  runs in a later quiet window with a 60 s load trace, and only a run whose trace stays quiet is published. BA-16 =
  PAUSE stands (R-BA49)." It supersedes R-BA50 for run #2 (asked because the generated README says "QUIET host" from
  the start reading and does not show run #2's mid-run load spike).
  R-BA53 (Q-TRACE) = "Every sample under the line (Recommended)": "A run of record's trace stays quiet when every 60 s
  sample has load1 < BASELINE + 1 (quiet-lock's NOISY line; BASELINE 2.21 today -> 3.21) and no node process >= 10%
  CPU other than the bench's own children, for the whole run. A run whose trace crosses the line is not published:
  results.json + report.html are archived like an INCONCLUSIVE run (BA-39 pattern), README keeps its PENDING form, and
  BA-16 is unchanged."
  Run of record #3 (REPORTED; 2026-11-06, commit 804aa83, Yggdrasil.js e0618227, chunkcap.json f79b43a6, node
  v26.8.2, Apple M4 Pro x12 darwin arm64, K = 5, 358 cells; start 17:45:48Z after 3 QUIET reads (load1 1.60, baseline
  2.21), end 19:43:37Z, exit 0): INCONCLUSIVE (twin A/A non-TIE on the crossover phase at S2b@32768 bulk, minRatio
  0.940); the 60 s trace crossed the R-BA53 line in 2 of 94 samples (load1 3.42 at 18:30:56Z, 3.66 at 18:35:41Z; no
  node process other than the bench's own); drift sentinel 22% (> 10% limit). Archived, not committed
  (.handoff/evidence/b49/ror3/); README keeps PENDING; BA-16 = PAUSE unchanged. Its S2 readings repeat run #2's
  (BlockedArray wins S2 through n = 100000; crossover "none up to 131072") -- REPORTED, decides nothing (INCONCLUSIVE,
  BA-40 standing). Next: another run of record in a quiet window (R-BA52 / R-BA53); no date set.
  Status (2026-11-07): runs #4 and #5 archived, not committed (#4 CONCLUSIVE but its trace crossed the R-BA53 line; #5
  trace quiet, INCONCLUSIVE on S2a@1024). Twin-noise read (REPORTED, .handoff research): runs #1..#5 read 6 / 285 twin
  cells non-TIE; a timed probe (one run, quiet host) found S2a@1024 bimodal in both labels, P(twin non-TIE) K = 5 6.7%
  -> 0.45% expected with one re-measure (assumes independent draws; FINDINGS F5, 2026-11-07, M4 Pro, node v26.8.2,
  REPORTED); for the other flagged cells the effect is untested. Rulings R-BA57..R-BA60 (re-measure
  flagged once, `remeasure` record, report / README naming, re-measure failure fails the run); the tooling landed
  uncommitted until the maintainer commits it. Run of record #6 is PENDING (exclusive window, after the commit);
  README stays PENDING; BA-16 = PAUSE unchanged.
  Status (2026-11-07, burst 50): the tooling is committed (e9fcf9c). Runs of record #6 and #7 (e9fcf9c, K = 5,
  358 cells, node v26.8.2, Apple M4 Pro x12) read CONCLUSIVE (twin non-TIE 0 / 57, no group re-measured; drift
  sentinel 3.0% / 1.7%; S2 rows identical to run #2) but each 60 s trace crossed the R-BA53 line in one sample (#6:
  load1 3.40 at 19:50:35Z, 1 of 93; #7: load1 3.67 at 23:04:17Z, 1 of 94; no node process other than the bench's
  own). Both archived, not committed; README stays PENDING; BA-16 = PAUSE unchanged. R-BA62 kept R-BA53 unchanged
  for run #7. Next: run of record #8 in a quiet window (R-BA52 / R-BA53); no date set.
- The pool (0.4) needs SumMap and IntervalMap realms to be worth shipping.

Estimate to SumMap 0.2.0 (2026-10-28, est., from .handoff/HISTORY.md: 28 burst sessions S0 -> 0.1.1 (S0, the
unnumbered planner burst, 2..27), about 26 to 0.1.0, 13 of them on 2026-10-27). Nominal 15-22 burst sessions:

| Stage | Bursts (est.) | Basis |
|---|---|---|
| Bench-ADOPT | 2-3 | planner; coder + review; one quiet-host bench run |
| GO / NO-GO | 0 | maintainer decision on a quiet-host run log of S1 / S2 (decided 2026-11-06: PAUSE, R-BA49) |
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
- Rival draft (2026-10-31, RESEARCH 12.3): researchNotes/BlockedArray.md (repo-local, not committed), 0
  mismatches against the Oracle over 500,083 fuzzed ops. Before it is the rival (in benchmark/, section 4.1):
  add a cursor (seekIndex / seekSum / next) for S1 (DONE, 3c6ef73; RESEARCH 12.3); report space beside time (at most 4 x C + (2 x views + 5) x chunkCap element slots plus a directory per view); gate its B/op lanes like the engine's (DONE, bd7faf3; R-BA14); A/B its 4 x unrolled loops against plain
  ones (LiteUtils/inlining-budget-diff.sh driver mode + a timed run); interleaved runs under the quiet lock
  with the LiteO1 benchmark harness; sweep chunkCap and leafSize; add a net-growth edit phase (its edit cells almost never split or merge).
- Inlining gate for every member that edits a hot function: LiteUtils/inlining-budget-diff.sh, driver mode,
  frozen before build vs the live file, both tiers; STATISTICAL, run under the quiet lock, never in npm test.
- LiteUtils tools -- RULED (maintainer 2026-11-04; option text quoted verbatim; LiteUtils is private 0.0.0,
  so a tool arrives as a copy, never a dependency):
  R-LU1 "bb + ibd now, dd later (Recommended)": "Copy bytecode-budget.sh and inlining-budget-diff.sh into
  test/tools/, byte-identical to the LiteUtils root copy at a named commit + sha256/8, never imported (as in
  LiteLogLogN and LiteSignal). bytecode-budget becomes a DETERMINISTIC npm-test gate: --max per hot function,
  pinned on node v26.8.2, plus --self-test and must-fail mutant rows. inlining-budget-diff gets the same
  self-test and mutant test; its real runs (benchmark/inl drivers, the hot-function edit rule at ROADMAP :490)
  stay STATISTICAL, under the quiet lock. deopt-diff.sh is copied the same way once LiteUtils Phase 3 closes."
  R-LU2 "SumMap key-compare gate (Recommended)": "ROADMAP's 'Not planned: a --trace-deopt gate (not
  deterministic)' is replaced: deopt-diff.sh, in file mode against the frozen before build, gates SumMap's hot
  functions with keys >= 2^31 (the RESEARCH 16.1 compare-form finding). A `>>> 0` compare variant is the
  must-fail control and must read DIFF. The gate is STATISTICAL, run once per release under the quiet lock,
  never in npm test."
- Competent rivals -- RULED (unlike the notes above, which are not ruled): maintainer 2026-10-31, RESEARCH 14;
  option text quoted verbatim:
  R-BA9 "Mode in FenwickRebuild.js (Recommended)": "The bit-straddle suffix rebuild is added as a 'suffix' mode of
  benchmark/rivals/FenwickRebuild.js, keeping its engine tokens, check order, cursor, splitAt / append and BA-8
  counters; the strong-rival slot uses mode 'suffix', and mode 'full' stays as the LiteVirtual-today baseline row.
  The drafted PartialFenwickRival class is not added as a separate file."
  R-BA10 "3/4:1/4 on append only (Recommended)": "An insert at index == length into a full last chunk splits it 3/4 :
  1/4 (the old chunk keeps chunkCap - chunkCap/4), an insert at index 0 into a full first chunk splits 1/4 : 3/4, and
  every other split stays 1/2 : 1/2 -- the same trigger as SumSequence's 13|4 / 4|13 rule (I-5 Table 3)."
  R-BA11 "Sweep picks per n (Recommended)": "The default stays max(16, ceil(sqrt(C))) rounded up to a multiple of 4
  (as built); the group 2b sweep runs each n over a chunkCap grid and the fastest chunkCap per n is the rival's
  reported value, printed in the header (RESEARCH 4.1 'chunk size tuned per n')."
- Scenario rulings -- RULED (maintainer, AskUserQuestion; R-BA13 2026-10-31, R-BA14..R-BA27 2026-11-01; option text
  quoted verbatim from the maintainer-local, gitignored .handoff/SPEC-bench-adopt.md "Maintainer rulings"). S7 / S7b
  are built (bd7faf3); S1a / S1b (R-BA16) are built (3a7a668); S2 / S2a / S2b (R-BA17) are built in the working tree
  (g2b-2b, uncommitted):
  R-BA13 "Suffix append too (Recommended)" (2026-10-31, maintainer, AskUserQuestion): "In mode 'suffix', append
  rebuilds only the tree nodes from the old length onward (O(k + log n)), because nodes 1..n already hold exact sums;
  mode 'full' keeps the full O(n + k) rebuild. "Keeping splitAt / append" in R-BA9 means the same operations, tokens
  and check order, not the same rebuild cost. The suffix-vs-full differential covers append."
  R-BA14 "Accept split (Recommended)" (2026-11-01, maintainer, AskUserQuestion): "Rival B/op lanes that kernel-lane's
  laneSet runs (insert / remove / setMeasure / indexAtSum / sumBefore / cursor walk) stay in
  benchmark/kernel-lane.mjs; the read and cursor lanes it cannot run (getMeasure, entityAt, total, seekSum + 50 next)
  and their must-fail controls live in the --expose-gc child of test/Rivals.test.mjs. Both run in npm run verify, so a
  rival that allocates still fails verify; R-BA7's "folded into kernel-lane" is read as "in verify, kernel-lane where
  laneSet can run it"."
  R-BA15 "New phases (Recommended)" (2026-11-01, maintainer, AskUserQuestion): "The SCENARIO shape gains id
  /^S\d+[a-z]?$/, so S1a, S1b, S2a, S2b and S7b are their own ids, plus the required keys dims (1..4), views (1 or 3)
  and mix (a plain object of ratios, positions, measure distribution and events, printed in the report header).
  build(adapter, n, seed) returns { capacity, fill: Int32Array(n x dims), phases }. The runner creates the handle
  (create, or createViews for 3 views), fills it untimed and refills it before every phase. PHASES becomes seek | walk |
  reweight | edit | bulk | blend ('splice' is retired). A phase replays its class's events out of one 20-block
  (20,000-event) stream, with blend last. The adapter contract gains the optional cursorWalkSum(d, y, k) (seekSum,
  then up to k - 1 next(), returning the sum of measure(d) over the visited rows) and createViews(capacity, dims, k <=
  3). D-rows stay SumSequence + SpliceFoil; the foil runs no scenario."
  R-BA16 "S1a + S1b (Recommended)" (2026-11-01, maintainer, AskUserQuestion): "S1 runs at dims 1, with sizes
  2^10..2^19, 100000 and 1000000. Per 1,000 events: 920 frames cursorWalkSum(0, y, 30). y moves by a uniform delta in
  [-512, 512], clamped to [0, total - 1]; 2% of frames jump to a uniform y. 50 setMeasure(i, 0, h), with i uniform in
  [top - 8, top + 38], clamped. 30 structural ops: 15 insertAt + 15 removeAt, alternating, so the length stays in [n -
  1, n + 1]. S1a inserts at length and removes at 0; S1b inserts and removes in [top - 8, top + 38]. Heights (fill,
  remeasure and insert): 80% are 32, 15% are uniform in [20, 200], 5% are 0. Phases: walk, reweight, edit, blend."
  R-BA17 "Dims 2 + bulk (Recommended)" (2026-11-01, maintainer, AskUserQuestion): "S2 runs at dims 2: d0 = UTF-16
  units including the newline, d1 = UTF-8 bytes (d0 for 90% of lines, else d0 + uniform [1, d0], capped at 255). d0 is
  1 for 10% of lines, uniform [2, 81] for 85%, uniform [82, 255] for 5%. Sizes are 2^10..2^17 and 100000. The caret
  moves by a uniform [-3, 3] lines, with a 1% jump. Per 1,000 events: 600 char edits: setMeasure on both dims, +1
  (60%) or -1 (40%), never below 1. 50 Enter (setMeasure + insertAt) and 50 line-start backspace (setMeasure +
  removeAt), alternating. 150 mid edits: k in [10, 50] consecutive lines, setMeasure on both dims. 50 bulk ops: 25 cut +
  25 paste of L = uniform [2000, 10000] x min(1, n / 100000) lines (at least 2), over 3 views (main, clip, tail). 100
  seeks: 50 indexAtSum(0, caret offset + [0, len)) and 50 sumBefore(0, caret +- [0, 50]). S2a = character edits,
  splits / joins and seeks; S2b = bulk only."
  R-BA18 "Suffix, no FenwickFixed (Recommended)" (2026-11-01, maintainer, AskUserQuestion): "S7 runs at dims 1 and n
  in {10000, 100000, 1000000}. Weights fill uniform in [1, 255]. Per 1,000 events: 500 indexAtSum(0, y), y uniform in
  [0, total), each followed by setMeasure(i, 0, w) on the drawn i, w uniform in [0, 255]. S7b = 950 draws + 50
  setMeasure at uniform i. The Fenwick rival is FenwickRebuild mode 'suffix'. The FenwickFixed slot is retired, and
  its reason is printed in the header. Phases: seek, reweight, blend."
  R-BA19 "Seeded shuffle (Recommended)" (2026-11-01, maintainer, AskUserQuestion): "Each 1,000-event block places its
  event classes by a Fisher-Yates shuffle, drawn from the scenario's seeded PRNG, of the block's exact class counts
  (S1: 920 frames, 50 setMeasure, 30 structural), so every block holds the ruled counts. Structural ops alternate
  insertAt / removeAt in stream order, insertAt first. In S2 a cut and its paste fill two adjacent slots (one shuffled
  unit). y starts uniform in [0, total); top is the row indexAtSum(0, min(y, total - 1)) lands on."
  R-BA20 "Event = records (Recommended)" (2026-11-01, maintainer, AskUserQuestion): "An event is one or more
  consecutive script records, all in that event's phase class. Character edit = 2 setMeasure; Enter = 2 setMeasure +
  insertAt; line-start backspace = 2 setMeasure + removeAt; mid edit = 2k setMeasure; cut = 2 splitAt + append; paste
  = splitAt + 2 append; a seek = 1 record. A phase's events counts whole events, its ops counts records, and ns/event
  = phase time / events. Character and mid edits -> reweight; Enter / backspace -> edit; cut / paste -> bulk;
  indexAtSum / sumBefore -> seek. S2 phases: seek, reweight, edit, bulk, blend."
  R-BA21 "SPLIT / APPEND opcodes (Recommended)" (2026-11-01, maintainer, AskUserQuestion): "SPLIT [7, i, v, 0] =
  main.splitAt(i, views[v]) and APPEND [8, v, 0, 0] = main.append(views[v]), with v 1 = clip and 2 = tail;
  runScript(h, script, views) takes the view array, and main = views[0] is the only receiver. A cut of rows [i, i + L)
  is SPLIT(i + L, tail), SPLIT(i, clip), APPEND(tail); its paste at j uniform in [0, n - L] is SPLIT(j, tail),
  APPEND(clip), APPEND(tail). The runner fails a phase that ends with a non-empty clip or tail. Capacity n + 1 is the
  arena total for SumSequence / BlockedArray and per instance for FenwickRebuild."
  R-BA22 "Masked blocks (Recommended)" (2026-11-01, maintainer, AskUserQuestion): "S2, S2a and S2b come from one
  editor generator, each as its own seeded 20-block stream. An S2 block is the R-BA17 1,000. An S2a block drops the
  150 mid edits and 50 bulk ops (600 character edits, 50 Enter, 50 backspace, 50 indexAtSum, 50 sumBefore = 800
  events; 16,000 in the stream). An S2b block is 25 cuts + 25 pastes (50 events; 1,000 in the stream). S2 and S2b run
  on 3 views, S2a on 1. Phases: S2 = seek, reweight, edit, bulk, blend; S2a = seek, reweight, edit, blend; S2b =
  bulk."
  R-BA23 "Redraw d1 (Recommended)" (2026-11-01, maintainer, AskUserQuestion): "Enter splits the caret row r (d0 = m,
  newline included) at a column c uniform in [0, m - 1]: setMeasure(r, 0, c + 1), setMeasure(r, 1, d1a), insertAt(r +
  1, m - c, d1b), where d1a and d1b are each re-drawn by the R-BA17 d1 rule from their new d0; the caret moves to r +
  1."
  R-BA24 "Clamp to 255 (Recommended)" (2026-11-01, maintainer, AskUserQuestion): "A line-start backspace joins row r =
  max(1, caret) into r - 1: setMeasure(r - 1, 0, min(255, a0 + b0 - 1)), setMeasure(r - 1, 1, min(255, a1 + b1 - 1)),
  removeAt(r); the caret moves to r - 1. Every value the editor writes is clamped to [1, 255] with d1 >= d0: a
  character edit writes d0' = clamp(d0 + s, 1, 255), d1' = clamp(d1 + s, d0', 255)."
  R-BA25 "Fresh line law (Recommended)" (2026-11-01, maintainer, AskUserQuestion): "A mid edit rewrites rows [s, s +
  k), k uniform in [10, 50], s = min(caret, n - k); each row gets a fresh d0 / d1 from the R-BA17 line law, written d0
  then d1, rows in order."
  R-BA26 "Uniform cut (Recommended)" (2026-11-01, maintainer, AskUserQuestion): "L = max(2, floor(U x min(1, n /
  100000))) with U an integer uniform in [2000, 10000]; a cut takes rows [i, i + L) with i uniform in [0, n - L]; its
  paste goes to j uniform in [0, n - L] as ruled."
  R-BA27 "Every event (Recommended)" (2026-11-01, maintainer, AskUserQuestion): "The caret starts uniform in [0, n)
  and moves before every event of every class: 1% jump to a uniform row in [0, length), else clamp(caret + uniform
  [-3, 3], 0, length - 1). Character edits, mid edits and seeks use row min(caret, n - 1), and sumBefore indices are
  clamped to [0, n], because a class phase replays its records at length n."
- Scenario mixes (the original proposal, superseded by R-BA15..R-BA18 above; RESEARCH 15): fixed n with balanced
  structural ops; every mix's ratios, positions, measure distribution, n and seed printed; each op class
  reported apart from the blend; S1 = local scroll +
  visible-window next() walk, near-viewport remeasures, S1a tail-feed / S1b list-edit structural variants; S2 =
  caret-local typing, Enter / backspace as insertAt / removeAt, balanced bulk cut / paste, S2a typing-only and S2b
  bulk-only variants; S7 = 1:1 draw + reweight and S7b draw-heavy. The ratios are assumptions until a real host is
  instrumented (RESEARCH 15.5). The maintainer ruled the specs (R-BA15..R-BA18, 2026-11-01).

### Queued -- SumMap 0.2.0, IntervalMap 0.3.0, Yggdrasil pool 0.4.0 (one full brief each at greenlight)

- **SumMap 0.2.0**: uint32 keys (Y-03), routing I-6, fence-key finger, rank / select / sumBelow / keyAtSum / splitAt /
  join; the >= 2^30 boxing lane as a first-class torture lane; S4-depth scenario; rivals lite-logn Treap and a
  tail-best sorted array, `Map` a timing-only counter-foil (R-SM1: sorted-btree documented, not installed; Scapegoat
  not a rival). Surface RULED R-SM1..R-SM9 (2026-11-05, burst 43; RESEARCH 17.2); the engine planner waits for BA-16
  (R-SM9; BA-16 decided PAUSE 2026-11-06, R-BA49: it now waits for the R-7 research burst's ruled PROPOSAL). Settle
  input (PROPOSED; 17.2 rules where it differs): RESEARCH 13 -- keys and boxing bands, fence-key finger rules, API
  contracts, rival matrix, DB-4 table, K-1..K-15 boundary rows, and the decisions the settle burst
  must take (13.7). Settle evidence (PROPOSED; superseded by RESEARCH 17): RESEARCH 16 -- the compare-form probe (all
  forms 0 B/op inside the engine; only xor-bias survives the first key >= 2^31 without a deopt), the build-dependent
  Smi top (node default: a returned key boxes from 2^31, so the big-key lane needs keys >= 2^31), sorted-btree 2.1.0
  checked, absent-key precedent, R-7 at average occupancy, the S4-depth mix (S4a / S4b), and draft settle options
  R-SM1..R-SM5 (superseded by RESEARCH 17.2).
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
- Tier 2 / Tier 3 detail (RESEARCH 12.1 / 12.2, maintainer notes 2026-10-31): the quantile recipe is
  checked (36,000 cases, 0 mismatches) and ready as a docs recipe; R-4 is proposed for Declined at the SumMap
  planner pass; R-8 would also make RangeError 'pool' reachable from setMeasure / removeAt; R-9 only as a
  get(k) leaf-hint table after SumMap ships; R-7 needs the pull op count measured as time.
- Not planned (RESEARCH 11.7): an Euler tour facade (LiteLogN EulerTourTree / LinkCutTree), a wavelet
  matrix (LiteLogN WaveletTree), timing wheels (LiteO1). (A --trace-deopt gate was here; R-LU2, 2026-11-04,
  replaced it with the deopt-diff.sh SumMap key-compare gate; R-LU2 is quoted beside R-LU1.)

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
