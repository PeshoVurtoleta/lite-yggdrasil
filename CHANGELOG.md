# Changelog

All notable changes to `@zakkster/lite-yggdrasil` are documented here. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

The first engine release (0.1.0 content). Nothing was published before it; the unpublished 0.0.0 scaffold exported only `VERSION`.

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
  clear() corrupt view: ...`) when `_len` or the root is corrupt, instead of looping forever; a bad child ref or a cycle found mid-walk throws after partial frees (the arena is not trusted after it), and a ref naming another view's node is not detected. (audit AF)
- The headroom, capacity, `dims` and `count` guards are written so a NaN takes the throw branch (fail closed),
  including a NaN cached total on a damaged view. (audit AF)
- `readCounters` with a NaN `out.length` throws `RangeError 'counters'`. (audit AF2)
- `getMeasure` now fits under V8's inlining limit, so a big-value read no longer boxes a double on the gated
  lane; the cursor's `offset(d)` / `measure(d)` no longer box on an invalid cursor. (audit AF2)
- Every counter write uses the documented wrap-to-int32 form `(n + x) | 0`; values are unchanged below 2^31. (audit AF)
- Views dropped from a `SumSequence.arena()` can be garbage-collected: the shared arena no longer holds a list of its views. (audit AF)

### Known limits

- `insertAt` on values beyond 2^30 may allocate up to `16 * dims + 1` bytes per call (one boxed double per
  measure argument); values below 2^30 allocate nothing on the gated lane. See the README, "Zero-GC design notes".
- The allocation gates are measured on Node v26.8.2 only. No timing claims are made. Benchmarks are PENDING.
