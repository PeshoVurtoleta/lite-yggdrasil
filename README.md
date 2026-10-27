# @zakkster/lite-yggdrasil

> A zero-GC summary tree for mutable ordered sequences: splice anywhere, and ask "where is X?" by any running total -- count, pixels, bytes, milliseconds.

[![npm version](https://img.shields.io/npm/v/@zakkster/lite-yggdrasil.svg?style=for-the-badge&color=latest)](https://www.npmjs.com/package/@zakkster/lite-yggdrasil)
[![sponsor](https://img.shields.io/badge/sponsor-PeshoVurtoleta-ea4aaa.svg?logo=github)](https://github.com/sponsors/PeshoVurtoleta)
![Zero-GC](https://img.shields.io/badge/Zero--GC-Engine-00C853?style=for-the-badge&logo=leaf&logoColor=white)
[![npm bundle size](https://img.shields.io/bundlephobia/minzip/@zakkster/lite-yggdrasil?style=for-the-badge)](https://bundlephobia.com/result?p=@zakkster/lite-yggdrasil)
[![npm downloads](https://img.shields.io/npm/dm/@zakkster/lite-yggdrasil?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-yggdrasil)
[![npm total downloads](https://img.shields.io/npm/dt/@zakkster/lite-yggdrasil?style=for-the-badge&color=blue)](https://www.npmjs.com/package/@zakkster/lite-yggdrasil)
![Tree-Shakeable](https://img.shields.io/badge/tree--shakeable-yes-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-Types-informational)
![Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
[![license](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](./LICENSE)

## The summary tree the ecosystem was missing

A virtual list with variable row heights, a timeline of clips, a text buffer indexed by line: all of them ask the same question, "which element sits at this running total?", while the sequence keeps changing. A prefix-sum array answers it but costs O(n) to rebuild on every insert. A Fenwick tree has no insert in the middle. An array of objects allocates.

`lite-yggdrasil` ships `SumSequence`: a mutable ordered sequence in which every element carries a small vector of integer measures (1 to 4 dimensions), every tree node caches the sum of its subtree, and you can seek by any one of those dimensions. Insert, remove, resize and seek are O(log n); the running total of a dimension is O(1). All storage is preallocated typed arrays, sized once when you construct it.

```bash
npm install @zakkster/lite-yggdrasil
```

```js
import { SumSequence } from '@zakkster/lite-yggdrasil';

// A virtual list: one dimension = row height in px, entity = a row id you own.
const rows = new SumSequence(1000);                    // fixed capacity 1000, dims 1
for (let id = 0; id < 5; id++) rows.insertAt(id, id, 20 + id * 10); // heights 20 30 40 50 60

console.log(rows.length, rows.total(0));               // 5 200
console.log(rows.indexAtSum(0, 75));                   // 2  (row 2 covers y = 50..89)
console.log(rows.sumBefore(0, 3));                     // 90 (px above row 3)

rows.setMeasure(1, 0, 100);                            // row 1 grows from 30 to 100 px
console.log(rows.sumBefore(0, 3), rows.removeAt(0));   // 160 0  (removeAt returns the entity)

const cur = rows.cursor();                             // the view's one reusable cursor
cur.seekSum(0, 75);                                    // land on the row covering y = 75
console.log(cur.index, cur.entity, cur.offset(0), cur.measure(0)); // 0 1 0 100
while (cur.next()) console.log(cur.entity, cur.offset(0));         // 2 100, 3 140, 4 190
```

Every output comment above is the observed output of this exact snippet on Node v26.8.2 (run verbatim from the repo, 2026-10-27).

## Table of contents

- [Why this exists](#why-this-exists)
- [What you get](#what-you-get)
- [Seeking by any running total](#seeking-by-any-running-total)
- [API reference](#api-reference)
- [Composability](#composability)
- [Zero-GC design notes](#zero-gc-design-notes)
- [Benchmarks](#benchmarks)
- [Design decisions worth knowing](#design-decisions-worth-knowing)
- [Testing](#testing)
- [What this is not](#what-this-is-not)
- [Ecosystem](#ecosystem)
- [License](#license)

## Why this exists

| You seek by...        | ...and you get                | Classic name                  |
|-----------------------|-------------------------------|-------------------------------|
| count                 | the k-th element              | rank / select                 |
| sum of row heights    | the row at `scrollTop = y`    | variable-height virtual list  |
| sum of durations      | the clip playing at time t    | timeline / sequencer          |
| sum of bytes          | the message at a byte offset  | log / buffer index            |

The usual tools each give up one thing: an array gives up cheap inserts, a prefix-sum array gives up cheap updates, a Fenwick tree gives up positional inserts, and an object tree gives up zero-GC. `SumSequence` keeps all three operations logarithmic and, on the lanes listed in [Zero-GC design notes](#zero-gc-design-notes), allocation-free.

## What you get

- **One class, `SumSequence`**, plus the `VERSION` string. Nothing else is exported.
- **1 to 4 integer measures per element** (`dims`), each in `[0, 2^53 - 1]`, plus one entity id in `[0, 2^30 - 1]` that you own (a row id, a clip id, an index into your own arrays).
- **Positional ops**: `insertAt`, `removeAt`, `setMeasure`, `getMeasure`, `entityAt`, all O(log n) (a finger on the last touched leaf skips the descent on a hit).
- **Seeks by any dimension**: `indexAtSum(d, y)` and `sumBefore(d, i)`; `total(d)` is O(1).
- **Cheap structure edits**: `splitAt(i, out)` and `append(other)` move a range between views of one shared arena with O(log n) tree work, not an element-by-element copy.
- **A reusable cursor** per view: `seekIndex`, `seekSum`, `next`, and `offset(d)` / `measure(d)` of the current element.
- **Exact operation counters** (`touches`, `pulls`, `moves`, `splits`, ...) so the cost of a workload is a count you can assert, not a timing.
- **Fail-closed validation**: a bad argument throws a `RangeError` whose message starts with a stable token, and the sequence is left unchanged.
- **TypeScript types** (`Yggdrasil.d.ts`), no runtime dependencies, one ESM file.

## Seeking by any running total

<details>
<summary>The summary with dimensions, the seek rule, and how a cursor walks.</summary>

### The summary with dimensions

Each element is `(entity, m0 [, m1, m2, m3])`. A node stores, for every dimension, the sum of the measures below it. Seeking dimension `d` descends from the root choosing the child whose running total covers the target, so any dimension is as cheap to seek as any other. `setMeasure` changes one value and re-sums the path to the root; nothing else is rebuilt.

### The seek rule

`indexAtSum(d, y)` returns the smallest index `i` with `sumBefore(d, i) + getMeasure(i, d) > y` -- a strict comparison. Consequences you can rely on:

- `y` in `[0, total(d))` returns the element that covers `y`; an element with measure 0 in dimension `d` is never returned.
- `y >= total(d)` returns `length` (no element covers it).
- `y` must be a finite number `>= 0`; NaN, a negative number and `Infinity` throw `RangeError` with token `'seek'`.
- `sumBefore(d, i)` takes `i` in `[0, length]`; `sumBefore(d, length)` is the total.

`cursor.seekSum(d, y)` follows the same rule and returns `true` when it lands on an element.

### The cursor

`view.cursor()` returns the view's one cursor (the same object on every call). It is not valid until a seek lands on an element.

- `valid`, `index` (`-1` when not valid), `entity` (`-1` when not valid).
- `offset(d)`: the sum of dimension `d` over the elements before the current one, O(1). `measure(d)`: the current element's measure. Both return `NaN` while the cursor is not valid, and both throw `RangeError 'dim'` for a bad `d` whether or not the cursor is valid.
- `seekIndex(i)` for `i` in `[0, length]`; `i === length` (or an empty view) returns `false` and leaves the cursor invalid. A bad `i` throws `RangeError 'index'` and leaves the cursor unchanged.
- `next()` steps to the next element and returns the new `valid`; stepping off the last element returns `false` and leaves the cursor invalid. On an invalid cursor it returns `false` and does nothing.
- Any successful mutation of the view (`insertAt`, `removeAt`, `setMeasure`, `splitAt`, `append`, `clear`) leaves its cursor invalid; `append` also invalidates the other view's cursor. Reads never do. A mutation that throws leaves the cursor as it was.

A full walk from index `i` is `cur.seekIndex(i); while (cur.valid) { ...; cur.next(); }`, O(log n + k) for `k` elements.

</details>

## API reference

All signatures are in `Yggdrasil.d.ts`. `i` is an index, `d` a dimension in `[0, dims)`, `e` an entity, `m` a measure.

### Construction

```js
new SumSequence(capacity, options?)
SumSequence.arena(capacity, options, count)   // -> SumSequence[] of `count` views sharing one arena
```

| Option     | Values                  | Default | Notes |
|------------|-------------------------|---------|-------|
| `dims`     | 1, 2, 3, 4              | 1       | measures per element |
| `leafSize` | 4, 8, 16, 32            | 16      | 4 and 8 exist for the test suite |

`options` must be `undefined` or a plain object. An unknown key throws `RangeError 'options'` with a did-you-mean hint; a key that is present but `undefined` throws too.

`capacity` is arena-wide and fixed: there is no growth. Views of one arena share it, so one view's inserts use up `available` for all of them. `length`, `capacity` and `available` are read-only getters (`available` is the arena's free slots).

### Reads and seeks

| Method | Returns | Notes |
|---|---|---|
| `total(d)` | sum of dimension `d` | O(1); `0` on an empty view |
| `getMeasure(i, d)` | measure `d` of element `i` | `i` in `[0, length)` |
| `entityAt(i)` | entity at `i` | `i` in `[0, length)` |
| `sumBefore(d, i)` | sum of `d` over `[0, i)` | `i` in `[0, length]` |
| `indexAtSum(d, y)` | smallest `i` covering `y`, else `length` | `y` finite, `>= 0` |
| `cursor()` | the view's one cursor | allocates nothing |

### Mutations

| Method | Effect | Notes |
|---|---|---|
| `insertAt(i, e, m0, m1?, m2?, m3?)` | insert at `i` in `[0, length]` | slots `>= dims` must be `undefined` |
| `removeAt(i)` | remove, returns the entity | `i` in `[0, length)` |
| `setMeasure(i, d, m)` | set one measure | `m` integer in `[0, 2^53 - 1]` |
| `splitAt(i, out)` | `this := [0, i)`, `out := [i, length)`; returns `this` | `out` must be an empty view of the same arena |
| `append(other)` | `this := this ++ other`, `other := empty`; returns `this` | `other` a view of the same arena |
| `clear()` | empties this view; returns `this` | keeps the counters; see below |

A mutation that throws a `RangeError` leaves the sequence byte-identical to before. Totals may never exceed `2^53 - 1`: an insert or `setMeasure` that would push a dimension past it throws `RangeError 'headroom'`.

`clear()` returns this view to its freshly constructed state (length 0, cursor invalid) and keeps the counters. It is O(1) when the view holds every live element of its arena; with several views in use it releases only this view's nodes. Before its first write it checks the view's `_len` and root reference; a view whose private fields were forged or corrupted throws a plain `Error` whose message starts `lite-yggdrasil: clear() corrupt view: ` (not a `RangeError`, no token). That guard targets damaged state, not API misuse: a forged `_len` that is still inside `[0, live]` on a valid root, or a reference that names another view's node, is beyond what it can see. Only `_len` and the root are checked before the first write: a bad child reference or a cycle found during the multi-view free-walk throws the same `Error` after some nodes were already freed, and the arena is not trusted after it.

### Counters

```js
const out = new Int32Array(12);
seq.readCounters(out);                       // copies the 12 counters into out
out[SumSequence.COUNTERS.fingerHits];        // read one by name
seq.resetCounters();
```

`SumSequence.COUNTERS` is a frozen, read-only static binding. In strict code (every ES module), assigning to it or to one of its fields throws `TypeError`.

| Name | Index | Counts |
|---|---|---|
| `touches` | 0 | tree nodes visited by descents |
| `pulls` | 1 | node summaries recomputed on the way back up |
| `moves` | 2 | elements moved between slots or leaves |
| `splits` | 3 | leaf splits |
| `merges` | 4 | leaf merges |
| `equalizes` | 5 | leaf equalizations |
| `rotSingle` | 6 | single rotations |
| `rotDouble` | 7 | double rotations |
| `fingerHits` | 8 | positional ops that skipped the descent |
| `fingerMisses` | 9 | positional ops that descended |
| `joinSteps` | 10 | internal nodes pushed on a join stack |
| `seamRepairs` | 11 | seam repairs in `append` / `splitAt` |

Counters are per view and wrap as 32-bit integers; read a window as `(after - before) | 0`. `readCounters` requires a genuine `Int32Array` (brand checked through the internal slot, so another realm's `Int32Array` counts) whose true length is `>= 12` (extra slots are left alone); an own `length` property is ignored. Anything else throws `RangeError 'counters'`.

### Contract constants

| Constant | Value |
|---|---|
| Entity domain | integers in `[0, 2^30 - 1]` (`-0` is stored as `0`) |
| Measure domain | integers in `[0, 2^53 - 1]`; every total stays `<= 2^53 - 1` |
| `dims` | 1 to 4 (default 1) |
| `leafSize` | 4, 8, 16, 32 (default 16) |
| `capacity` | integer `>= 1` and `<= 2^28 - (leafSize / 4) * count` |
| Arena bytes | the typed arrays of one arena total `<= 2^32` bytes |
| Views per arena | `count` in `1..min(capacity, 4096)` |
| Counters | 12 `Int32` slots per view |
| Cursors | 1 per view |

The byte cap binds first in practice. Exact arithmetic (reference formula in the ADR, rejection of the next capacity checked against the engine): the largest accepted `capacity` for one view is 72,796,032 at `leafSize` 16 and `dims` 1, and 18,199,008 at `leafSize` 4 and `dims` 4.

### Errors

Every argument error is a `RangeError` whose message is a token, a space and a detail (for example `index must be an integer in [0, length]`). The sequence is unchanged after one.

| Token | Raised when |
|---|---|
| `index` | `i` is not an integer in range (a NaN too) |
| `dim` | `d` is not an integer in `[0, dims)` |
| `entity` | `e` is not an integer in `[0, 2^30 - 1]` |
| `measure` | a measure is not a number, not an integer, or out of `[0, 2^53 - 1]` |
| `extra` | an `insertAt` slot at or beyond `dims` is not `undefined` |
| `capacity` | the arena is full, or the constructor's capacity / byte cap is exceeded |
| `headroom` | a total would exceed `2^53 - 1` |
| `seek` | `y` is not a finite number `>= 0` |
| `options` | `options` is not a plain object, or has an unknown key or a bad `leafSize` |
| `dims` | `dims` is not an integer in 1..4 |
| `count` | `arena()` `count` is outside `1..min(capacity, 4096)` |
| `operand` | `splitAt` / `append` got a non-view, `this`, a view of another arena, or a non-empty `out` |
| `counters` | `readCounters` got a non-`Int32Array` (a fake, Proxy or plain array) or an `Int32Array` whose true length is `< 12` |
| `pool` | internal node pool exhausted; unreachable by the pool-sizing argument, kept as a fail-closed backstop |

Check order inside `insertAt`: index, entity, measures, extra slots, capacity, headroom.

## Composability

`SumSequence` has no peer dependencies, so the end-to-end example uses only this package: a chat log with two dimensions (rendered height in px, payload bytes), virtual scrolling, a resize, a byte budget, and a range split.

```js
import { SumSequence } from '@zakkster/lite-yggdrasil';

// A chat log: dim 0 = rendered height in px, dim 1 = payload bytes, entity = message id.
// Two views of ONE arena: the live window and an archive (no copy when messages move).
const [live, archive] = SumSequence.arena(10000, { dims: 2 }, 2);

for (let id = 0; id < 100; id++) live.insertAt(live.length, id, 24 + (id % 3) * 16, 80 + id);

// 1. Virtual scroll: which message is under scrollTop = 1000 px, and which ones are visible?
const scrollTop = 1000, viewport = 300;
const cur = live.cursor();
cur.seekSum(0, scrollTop);
const first = cur.index;
const visible = [];
do { visible.push(cur.entity); } while (cur.next() && cur.offset(0) < scrollTop + viewport);
console.log('first visible index', first, 'visible ids', visible.join(','));

// 2. An image finishes loading: message 40 grows from its row height to 200 px. Offsets below it move
//    with no per-row bookkeeping.
const before = live.sumBefore(0, 41);
live.setMeasure(40, 0, 200);
console.log('px above message 41:', before, '->', live.sumBefore(0, 41));

// 3. Payload budget: how many messages fit in the first 4000 bytes (dim 1)?
console.log('messages within 4000 bytes:', live.indexAtSum(1, 4000));

// 4. Split the log at index 30 with no element copied: live keeps [0, 30), archive takes [30, 100).
live.splitAt(30, archive);
console.log('live', live.length, 'archive', archive.length, 'archive bytes', archive.total(1));
live.append(archive);                      // join them back: live = 100, archive = 0
console.log('live', live.length, 'archive', archive.length, 'total px', live.total(0));
```

Observed output (Node v26.8.2, run verbatim, 2026-10-27), and checked by hand from the row heights (24, 40, 56 repeating) and byte sizes (80 + id):

```
first visible index 25 visible ids 25,26,27,28,29,30,31,32
px above message 41: 1624 -> 1784
messages within 4000 bytes: 40
live 30 archive 70 archive bytes 10115
live 100 archive 0 total px 4144
```

Capacity is fixed, so to grow a sequence pre-size it, watch `available`, or rebuild into a bigger arena: walk the old view with its cursor and `insertAt(bigger.length, cur.entity, cur.measure(0), ...)` each element into a new, larger `SumSequence` (O(n log n)). `append` joins views of one arena only; across arenas it throws `RangeError 'operand'`.

## Zero-GC design notes

<details>
<summary>What the hot path allocates, on exactly which operations and values, and what is gated.</summary>

### The claim, qualified

The claim is not "zero allocation everywhere". It is the table below. A JavaScript engine may box a number into a heap object when a fractional, large or negative-large value crosses a call it does not inline; on Node that is 16 bytes. Two things decide whether `SumSequence` can box: the size of the value (the lanes below are split at 2^30) and the operation.

- **Smi lane**: every measure and `y` below 2^30. The gated operations allocate 0 bytes per call.
- **Big lane**: measures drawn from `[2^30, 2^40]` with 4096 live elements, `y` from `[2^30, total)` with a fractional part. Each operation has a bound of `16 * b + 1` B/op, where `b` is the number of boxed boundary values per call: `b = 1` for `setMeasure`, `sumBefore`, `total`, `indexAtSum`, `getMeasure`, `seekSum`, and the cursor's `offset` / `measure`; `b = 0` for `removeAt`, `entityAt`, `seekIndex`, `next`, `splitAt` and `append`. The big `removeAt` lane runs on its own arena of 2^14 elements with measures in `[2^30, 2^38]`.
- **`insertAt` has a documented limit: `b = dims`**, so on the big lane it may allocate up to `16 * dims + 1` B/op (`<= 17` at `dims` 1, up to `<= 65` at `dims` 4), one boxed double per measure argument. With every measure below 2^30 it allocates 0 (gated at `dims` 4).
- Other V8 builds (Chrome, Electron, other Node versions) and values or call shapes outside these lanes are not gated.

### Allocation table (DETERMINISTIC gate, `npm run torture`)

Measured B/op is the minimum over the steady-state windows, less the empty-loop baseline, windows with a GC event excluded. Source: one `npm run verify` run, 2026-10-27 07:34Z, Node v26.8.2, host QUIET (load1 3.10, quiet-lock baseline 2.21, 12 cores), 1 run (log `.handoff/evidence/af2/close/verify.log`, repo only).

| Lane | Operation | Measured B/op | Gate (bound) |
|---|---|---|---|
| Smi | `seekIndex` + 50 `next()` | 0 | < 1 |
| Smi | `seekSum` + 50 `next()` | 0 | < 1 |
| Smi | `getMeasure` | 0 | < 1 |
| Smi | `entityAt` | 0 | < 1 |
| Smi | `insertAt` + `removeAt`, `dims` 4 | 0 | < 1 |
| Big | `getMeasure` | 0 | <= 1 (R-G4 row, see below) |
| Big | cursor `offset(d)` | 0 | <= 1 (R-G4 row) |
| Big | cursor `measure(d)` | 0 | <= 1 (R-G4 row) |
| Big | `sumBefore` | 0 | <= 17 (b = 1) |
| Big | `total` | 0 | <= 17 (b = 1) |
| Big | `indexAtSum` | 0 | <= 17 (b = 1) |
| Big | `setMeasure` | 15.98 | <= 17 (b = 1) |
| Big | `seekSum` | 16 | <= 17 (b = 1) |
| Big | `entityAt` | 0 | <= 1 (b = 0) |
| Big | `seekIndex` | 0 | <= 1 (b = 0) |
| Big | `next` | 0 | <= 1 (b = 0) |
| Big | `splitAt` + `append` | 0 | <= 1 (b = 0) |
| Big | `removeAt` | 0 | <= 1 (b = 0) |
| Big | `insertAt` + `removeAt`, `dims` 1 | 15.98 | <= 17 (16 * 1 + 1) |
| Big | `insertAt` + `removeAt`, `dims` 2 | 31.97 | <= 33 (16 * 2 + 1) |
| Big | `insertAt` + `removeAt`, `dims` 3 | 47.95 | <= 49 (16 * 3 + 1) |
| Big | `insertAt` + `removeAt`, `dims` 4 | 63.94 | <= 65 (16 * 4 + 1) |

That is 22 lanes. Readings of 0 on the `b = 1` rows (`sumBefore`, `total`, `indexAtSum`) are the V8 tier of this node being better than the bound; the bound is the contract. The three R-G4 rows (`getMeasure`, `offset`, `measure`) are tighter than the contract: they are regression gates at 0, valid for optimised (TurboFan) code on this Node build only, which is why the `torture` script pins `--no-concurrent-recompilation` so every run reads the same code tier. If a different V8 does not inline them, expect up to the `b = 1` bound.

Six controls must behave as stated, so the gate can fail: a one-box lane on Smi values reads 16.00 B/op (must exceed the Smi gate), a one-box and a two-box lane on big values read 16 and 32 (the first must pass the `b = 1` bound, the second must fail it), an array-passing `insertAt` mutant reads 80.01 B/op (must fail the Smi gate), a descent mutant that returns its running sum through a non-inlined helper reads 164.37 (must fail the `b = 1` bound), and a global-NaN `measure` mutant reads 16 (must fail the R-G4 bound).

GC verdict for the engine windows (166 of 166 windows gated): 0 major GCs, 9 minor GCs, max pause 0.67 ms. The max pause is REPORTED, not gated; only `maxMajor 0` is. The whole torture window (including idle-time work after the retention phase) read 1 major and 16 minor, also REPORTED.

### Retention and the nil-guard

- **Retention**: 1000 arena cycles with 100,000 caught rejects; every view is tracked by `@zakkster/lite-leak` and must be untracked only once back in its constructed state; the tracker ends at size 0. A control (a `clear()` that keeps the finger) must leak, and dropped views of a shared arena must be collected (7 of 7), with a strong-reference control that must keep them alive.
- **NIL-guard JIT gate**: 5 of 5 positional ops keep their finger guard in optimised code; 0 of 5 dropped.

### Allocation by operation

| Operation | Allocates |
|---|---|
| construction, `arena()` | all typed arrays, once, up front (cold path) |
| every method on the table above | see the table; none allocates a structure |
| `cursor()` | nothing: the view's one cursor is created at construction |
| `readCounters(out)` | nothing; you own `out` |
| a thrown `RangeError` | the error object itself (cold path) |

</details>

## Benchmarks

PENDING for 0.1.1. This release ships no benchmark numbers and no timing claims, and no earlier release has a measured table to point back to. Performance is stated as exact operation counts (the counters above), which are gated.

## Design decisions worth knowing

- **Fixed capacity, no growth.** `capacity` is arena-wide and fixed so nothing is allocated after construction. A bulk "rebuild bigger" constructor is queued, not shipped.
- **Counts are the performance contract.** The engine exposes `touches`, `pulls`, `moves` and the rest because an exact count is deterministic and gateable; wall-clock time is not. Counters are per view and `clear()` keeps them.
- **Strict seeks.** `indexAtSum` / `seekSum` use `>`, so a zero-measure element is never landed on, and seeking exactly at the total is "off the end".
- **The end is not an element.** A seek to the end and `next()` off the last element leave the cursor invalid, the same state as an empty view. A walk is `while (cur.valid)`.
- **The cursor dies on mutation.** One cursor per view, invalidated by any successful mutation, so a stale cursor can never read a moved element.
- **Entity ids are yours.** The tree stores a 30-bit id per element and never looks it up in reverse; there is no entity-to-index map in 0.1.1.
- **Shared arena, many views.** `SumSequence.arena()` gives views that share storage, so `splitAt` / `append` move ranges without an element-by-element copy.
- **NaN and bad values fail closed.** Guards are written so a NaN takes the throw branch, and a mutating call throws before it writes anything.
- **`COUNTERS` is a read-only binding.** In strict mode, assigning `SumSequence.COUNTERS = ...` throws `TypeError` (a sloppy-mode script silently ignores it).
- **No statistical claims.** There is no timing or speed tier: every claim in this README is either gated (DETERMINISTIC) or REPORTED with provenance.

Repo-only documents (not in the npm package): [ROADMAP.md](ROADMAP.md) (the plan), [RESEARCH.md](RESEARCH.md) (research notes), [SCOPE.md](SCOPE.md) (founding scope), and `decisions/` (the ADRs; `decisions/0005-sumsequence-current.md` is the binding spec of `SumSequence`).

## Testing

**856 tests, all pass** (`node --test`, 0 failed, 0 skipped; one `npm run verify` run, 2026-10-27, Node v26.8.2, QUIET host), plus engine lanes, a type test and a torture gate.

```bash
npm test            # 856 node:test cases: contract, boundary, oracle, walker, mutants, counts
npm run test:types  # tsc type test against Yggdrasil.d.ts
npm run test:lanes  # exhaustive engine-size lanes (BFS, sweep, deep, finger on == finger off)
npm run torture     # node --expose-gc --min-semi-space-size=4 --max-semi-space-size=4 --no-concurrent-recompilation test/torture.mjs
npm run verify      # test -> test:types -> test:lanes -> torture, the publish gate
```

The torture phases (`test/torture.mjs`, exit 0 only if every GATE line is ok): **retention** (1000 arena cycles, 100,000 caught rejects, leak tracking, the shared-arena collection check, each with a control that must fail), **alloc** (the 22 lanes and 6 controls above, inside a GC profiler window with `maxMajor 0`), and **jit** (the nil-guard gate). `torture` refuses to run without its four flags.

Verification tiers. Every claim in this README belongs to one of two tiers:

- **DETERMINISTIC**: correctness, error tokens, the types, finger on/off parity, exact operation counts, allocation B/op per lane, and the engine-window major-GC count (`maxMajor 0`). Gated on every `npm run verify`.
- **REPORTED**: figures printed with provenance and gating nothing (the max GC pause, the engine-window minor-GC count, and the whole-window GC counts above).

There is no statistical tier in 0.1.1: no timing ratio or speed number is claimed anywhere.

## What this is not

- **Not growable.** Capacity is fixed at construction (see [Composability](#composability) for the rebuild recipe).
- **Not a keyed map or an interval tree.** `SumSequence` is positional. A keyed `SumMap` and an `IntervalMap` are planned (see ROADMAP.md, repo only), not part of this release.
- **Not an entity index.** There is no entity-to-index lookup and no `readRange`; walk with the cursor.
- **Not a benchmarked package.** Counts are gated; no speed numbers ship.
- **Not tested outside Node.** The allocation gates are measured on Node v26.8.2 only; the browser build of V8 may box where Node does not.
- **Not thread-safe.** One sequence, one thread.

## Ecosystem

Part of the **@zakkster** zero-GC stack:

- [`lite-logn`](https://www.npmjs.com/package/@zakkster/lite-logn) -- zero-GC O(log n) data structures (heap and friends), the family `lite-yggdrasil` follows
- [`lite-loglogn`](https://www.npmjs.com/package/@zakkster/lite-loglogn) -- sub-logarithmic bounded-integer predecessor / successor structures
- [`lite-leak`](https://www.npmjs.com/package/@zakkster/lite-leak) -- leak diagnostic; the retention phase of this package's torture gate uses it
- [`lite-gc-profiler`](https://www.npmjs.com/package/@zakkster/lite-gc-profiler) -- GC and heap profiler; the alloc phase uses it
- **`lite-yggdrasil`** -- this package

---

## License

MIT (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>
