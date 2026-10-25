# lite-yggdrasil

> A zero-GC engine for mutable ordered sequences where the position of anything is a running total (planned).

**Status: pre-release -- nothing is built yet; the engine (SumSequence, v0.1.0) is planned, not shipped.**

The only current export is `VERSION`.

## The one idea (planned)

The engine is built around one idea: the summary with dimensions. Every element is planned to carry a
small vector of integer measures, every node to cache the sum (or the max) of its subtree, and a cursor
to descend by any one of those dimensions. That would let one structure seek by any running total --
count, pixels, bytes, milliseconds, volume -- and splice anywhere in a mutable ordered sequence.

None of this is implemented or measured yet.

## Documents (repo only, not in the npm package)

- [ROADMAP.md](ROADMAP.md) -- the plan and the session order
- [RESEARCH.md](RESEARCH.md) -- research notes behind the design
- [SCOPE.md](SCOPE.md) -- the founding scope note

## License

MIT (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>
