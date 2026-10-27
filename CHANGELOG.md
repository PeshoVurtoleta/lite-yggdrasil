# Changelog

All notable changes to `@zakkster/lite-yggdrasil` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- The cursor class was constructible through `v.cursor().constructor`. It now throws
  `TypeError 'lite-yggdrasil: SumCursor is not constructible'` with any arguments; only the engine creates cursors.
  (audit AF3, R-A7)
- The 16 `index` / `dim` upper-bound guards are written NaN-closed (`!(i <= n)`, `!(i < n)`, `!(d < dims)`). Same throw text; hardening only,
  no behavior change on a reachable input. (audit AF3, R-A9)
- `readCounters` on a fake or short `out` (`Object.create(Int32Array.prototype)`, an `Int32Array(4)` with an own
  `length` of 12) threw a `TypeError` or an untokened `RangeError 'offset is out of bounds'`; it now throws
  `RangeError 'counters'`, and an own `length` valueOf is never called. (audit AF3, R-A8)

### Changed

- `readCounters(out)` checks `out` through the `%TypedArray%` toStringTag getter (must be `'Int32Array'`) and its
  true length (internal slot) `>= 12`, both cached at module load, so the checks run no user code; otherwise
  `RangeError 'counters'`. (audit AF3, R-A8, R-A11)
- `readCounters` accepts an `Int32Array` from another realm (vm / iframe); 0.1.0 rejected it. (audit AF3, R-A8)
- `readCounters` ignores an own `length` property on `out`: a genuine `Int32Array(12)` with an own NaN `length`
  now copies instead of throwing. (audit AF3, R-A8)
- `readCounters` on a genuine `Int32Array` whose prototype was swapped (null / `Object.prototype`) throws
  `TypeError 'out.set is not a function'` (0.1.0: `RangeError 'counters'`); the copy still calls `out.set`.
  (audit AF3, R-A11)

## [0.1.0] - 2026-10-27

The first engine release. Nothing was published before it; the unpublished 0.0.0 scaffold exported only
`VERSION`.

### Added

- `SumSequence`: a fixed-capacity mutable ordered sequence with 1 to 4 integer measures per element and a cached
  subtree sum per dimension. `insertAt`, `removeAt`, `setMeasure`, `getMeasure`, `entityAt`, `total`,
  `indexAtSum`, `sumBefore`, `clear` and the `length` / `capacity` / `available` getters. (rungs 2..8)
- `SumSequence.arena(capacity, options, count)`: up to 4096 views sharing one arena, and `splitAt(i, out)` /
  `append(other)` to move a range between views. (rungs 5..7)
- A finger on the last touched leaf: positional ops that land in it skip the descent. (rung 8)
- A reusable cursor per view: `cursor()`, `seekIndex`, `seekSum`, `next`, `valid` / `index` / `entity`,
  `offset(d)` / `measure(d)`. (rungs 9, 10)
- Exact operation counters: `SumSequence.COUNTERS`, `readCounters(out)`, `resetCounters()`.
- A byte cap: the constructor rejects an arena whose typed arrays would total more than 2^32 bytes with
  `RangeError 'capacity'`, before allocating anything. (byte-cap unit)
- Fail-closed validation: every argument error is a `RangeError` whose message starts with a token (`index`, `dim`,
  `entity`, `measure`, `extra`, `capacity`, `headroom`, `seek`, `options`, `dims`, `count`, `operand`, `counters`,
  `pool`).
- TypeScript declarations (`Yggdrasil.d.ts`) for the whole surface, and a rewritten README and `llms.txt`.
- Tests (repo only): 838 `node:test` cases, a type test, exhaustive engine lanes (`npm run test:lanes`) and a
  torture gate (`npm run torture`: retention, allocation lanes with must-fail controls, a JIT nil-guard check),
  chained as `npm run verify`. (G-B2, G2)

### Changed

- `SumSequence.COUNTERS` is now a read-only binding (non-writable, non-configurable; the object was already
  frozen). In strict code, including every ES module, assigning to `SumSequence.COUNTERS` now throws `TypeError`;
  in sloppy-mode code the assignment is silently ignored. (audit AF2)

### Fixed

- `clear()` checks the view's internal state before it writes and throws a plain `Error` (`lite-yggdrasil:
  clear() corrupt view: ...`) when `_len` or the root is corrupt, instead of looping forever; a bad child ref or a
  cycle found mid-walk throws after partial frees (the arena is not trusted after it), and a ref naming another
  view's node is not detected. (audit AF)
- The headroom, capacity, `dims` and `count` guards are written so a NaN takes the throw branch (fail closed),
  including a NaN cached total on a damaged view. (audit AF)
- `readCounters` with a NaN `out.length` throws `RangeError 'counters'`. (audit AF2)
- `getMeasure` now fits under V8's inlining limit, so a big-value read no longer boxes a double on the gated
  lane; the cursor's `offset(d)` / `measure(d)` no longer box on an invalid cursor. (audit AF2)
- Every counter write uses the documented wrap-to-int32 form `(n + x) | 0`; values are unchanged below 2^31. (audit AF)
- Views dropped from a `SumSequence.arena()` can be garbage-collected: the shared arena no longer holds a list of
  its views. (audit AF)

### Known limits

- `insertAt` on values beyond 2^30 may allocate up to `16 * dims + 1` bytes per call (one boxed double per
  measure argument); values below 2^30 allocate nothing on the gated lane. See the README, "Zero-GC design notes".
- The allocation gates are measured on Node v26.8.2 only. No timing claims are made. Benchmarks are PENDING.
