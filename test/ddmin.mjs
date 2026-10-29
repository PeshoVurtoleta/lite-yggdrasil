// test/ddmin.mjs -- delta debugging for SumSequence op streams (RESEARCH 11.8).
// A debugging tool, run AFTER a failure; never part of a gate (not a *.test.mjs,
// not in package.json files[]).
//
//   ddmin(items, test, opts?) -> { minimal, tests, cached, capped }
//     Zeller's ddmin over contiguous blocks, order preserved, 1-minimal unless
//     capped. test(subset) returns FAIL / PASS / UNRESOLVED, or { outcome, upto }
//     where upto = how many leading items of subset the failure needed (the
//     rest is cut at once). Removal is by position, never by identity, so
//     repeated or primitive items are safe. Outcomes are cached per kept-index
//     set. opts.maxTests stops early and returns the best so far (capped: true).
//
//   Legalizing (inside runStream, op by op): each op is reduced against the
//     ORACLES' lengths at that moment, never a precomputed model, so an op that
//     throws on both sides cannot shift later ones: insertAt i mod (len + 1);
//     removeAt / setMeasure i mod len (dropped at len 0); seekIndex i mod
//     (len + 1); splitAt needs an empty out != v; append needs other != v; an
//     insert is dropped once the views hold `C` elements (arena-wide capacity).
//   normalizeOps(ops, cfg) -> the ops as runStream would play them (Oracle-only
//     replay, each tagged .src = index in ops; .throws = token when the Oracle
//     rejects it). For printing a result.
//
//   runStream(factory, cfg, ops) -> null | { sig, at, upto, detail }
//     Fresh arena + one Oracle per view; every op runs on both, then every view
//     is compared (length, entities, measures, cursor) and, with a snapshot, the
//     walker runs. sig names the FIRST failure: 'oracle:<field>', 'walker:<code>',
//     'throw:engine:<token>' / 'throw:oracle:<token>' (only one side threw),
//     'cursor:<field>'. A throw on BOTH sides with the same token is legal (the
//     sequence is unchanged after a throw, llms.txt Errors) and is skipped.
//
//   minimize(ops, factory, cfg, target?, opts?) -> { sig, minimal, tests, fixpoint, ... }
//     Shrinks while the SAME sig fails (target defaults to the original's):
//     ddmin, then argument simplification, repeated until a pass changes
//     nothing (fixpoint: true) or opts.maxPasses / opts.maxTests run out.
//
//   randomOps(seed, n, cfg) -> ops    seeded xorshift32 stream over cfg.count views.
//
//   node test/ddmin.mjs demo          plants a bug in a temp copy of the engine
//                                     (buildMutant), finds a failing seed, shrinks it,
//                                     and replays the result on the real build.
//
// cfg = { C, leafSize, dims, count }; factory = engineFactory (test/adapter.mjs)
// or any (C, o, count) -> { views, snapshot? }.
//
// ASCII-only. MIT (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>

import { Oracle } from './oracle.mjs';
import { walk } from './walker.mjs';

export const PASS = 'PASS';
export const FAIL = 'FAIL';
export const UNRESOLVED = 'UNRESOLVED';

// ---- core ddmin --------------------------------------------------------------

export function ddmin(items, test, opts) {
  const maxTests = opts && opts.maxTests !== undefined ? opts.maxTests : Infinity;
  if (!(maxTests >= 1)) throw new Error('ddmin: maxTests must be >= 1');
  const cache = new Map();
  let tests = 0;
  let cached = 0;
  let capped = false;

  // run(idx) -> { outcome, upto } with idx an array of indices into items.
  function run(idx) {
    const key = idx.join(',');
    const hit = cache.get(key);
    if (hit !== undefined) { cached++; return hit; }
    if (tests >= maxTests) { capped = true; return { outcome: UNRESOLVED, upto: idx.length }; }
    tests++;
    const r = test(idx.map((k) => items[k]));
    const res = typeof r === 'string' ? { outcome: r, upto: idx.length } : r;
    const upto = Number.isInteger(res.upto) && res.upto >= 1 && res.upto <= idx.length ? res.upto : idx.length;
    const out = { outcome: res.outcome, upto };
    cache.set(key, out);
    return out;
  }

  let cur = [];
  for (let k = 0; k < items.length; k++) cur.push(k);
  const first = run(cur);
  if (first.outcome !== FAIL) throw new Error('ddmin: the full input does not FAIL (' + first.outcome + ')');
  cur = cur.slice(0, first.upto);

  let n = 2;
  while (cur.length >= 2 && !capped) {
    const blocks = [];
    for (let b = 0, start = 0; b < n; b++) {
      const size = Math.ceil((cur.length - start) / (n - b));
      blocks.push([start, start + size]);
      start += size;
    }
    let next = null;
    // 1. a block alone fails
    for (const [s, e] of blocks) {
      if (e <= s) continue;
      const cand = cur.slice(s, e);
      const r = run(cand);
      if (r.outcome === FAIL) { next = cand.slice(0, r.upto); n = 2; break; }
    }
    // 2. a complement fails (at n = 2 the complements are the blocks: skip)
    if (next === null && n > 2) {
      for (const [s, e] of blocks) {
        if (e <= s) continue;
        const cand = cur.slice(0, s).concat(cur.slice(e));
        const r = run(cand);
        if (r.outcome === FAIL) { next = cand.slice(0, r.upto); n = Math.max(n - 1, 2); break; }
      }
    }
    if (next !== null) { cur = next; continue; }
    if (n >= cur.length) break; // 1-minimal
    n = Math.min(n * 2, cur.length);
  }
  return { minimal: cur.map((k) => items[k]), tests, cached, capped };
}

// ---- op streams --------------------------------------------------------------

function mod(i, n) {
  return ((i % n) + n) % n;
}

// One op legalized against the current lengths; null = dropped.
function normOne(o, lens, live, count, capacity) {
  const v = o.v;
  if (!Number.isInteger(v) || v < 0 || v >= count) return null;
  const n = lens[v];
  const peer = (w) => Number.isInteger(w) && w >= 0 && w < count && w !== v;
  switch (o.op) {
    case 'insertAt': return live >= capacity ? null : { ...o, i: mod(o.i, n + 1) };
    case 'removeAt':
    case 'setMeasure': return n === 0 ? null : { ...o, i: mod(o.i, n) };
    case 'splitAt': return peer(o.out) && lens[o.out] === 0 ? { ...o, i: mod(o.i, n + 1) } : null;
    case 'append': return peer(o.other) ? { ...o } : null;
    case 'seekIndex': return { ...o, i: mod(o.i, n + 1) };
    case 'clear':
    case 'seekSum':
    case 'next': return { ...o };
    default: return null; // unknown op
  }
}

function lengths(orc, lens) {
  let live = 0;
  for (let k = 0; k < orc.length; k++) { lens[k] = orc[k].length; live += lens[k]; }
  return live;
}

export function normalizeOps(ops, cfg) {
  const orc = [];
  for (let k = 0; k < cfg.count; k++) orc.push(new Oracle(cfg.dims));
  const lens = new Array(cfg.count).fill(0);
  const out = [];
  for (let src = 0; src < ops.length; src++) {
    const op = normOne(ops[src], lens, lengths(orc, lens), cfg.count, cfg.C);
    if (op === null) continue;
    op.src = src;
    try { apply(orc[op.v], op, orc); } catch (e) { op.throws = token(e); }
    out.push(op);
  }
  return out;
}

function token(e) {
  const m = e && typeof e.message === 'string' ? e.message : String(e);
  return (e && e.name === 'RangeError' ? '' : (e && e.name ? e.name + ':' : '')) + m.split(' ')[0];
}

function apply(x, o, peers) {
  switch (o.op) {
    case 'insertAt': return x.insertAt(o.i, o.e, ...o.m);
    case 'removeAt': return x.removeAt(o.i);
    case 'setMeasure': return x.setMeasure(o.i, o.d, o.m);
    case 'splitAt': return x.splitAt(o.i, peers[o.out]);
    case 'append': return x.append(peers[o.other]);
    case 'clear': return x.clear();
    case 'seekIndex': return x.cursor().seekIndex(o.i);
    case 'seekSum': return x.cursor().seekSum(o.d, o.y);
    case 'next': return x.cursor().next();
    default: return undefined;
  }
}

function compareView(v, o, dims) {
  const n = o.length;
  if (v.length !== n) return ['oracle:length', 'engine ' + v.length + ' oracle ' + n];
  for (let i = 0; i < n; i++) {
    if (v.entityAt(i) !== o.entityAt(i)) return ['oracle:entity', 'at ' + i];
    for (let d = 0; d < dims; d++) {
      if (v.getMeasure(i, d) !== o.getMeasure(i, d)) return ['oracle:measure', 'at ' + i + ' dim ' + d];
    }
  }
  for (let d = 0; d < dims; d++) {
    if (v.total(d) !== o.total(d)) return ['oracle:total', 'dim ' + d];
  }
  const a = v.cursor();
  const b = o.cursor();
  if (a.valid !== b.valid) return ['cursor:valid', String(a.valid)];
  if (a.index !== b.index) return ['cursor:index', a.index + ' vs ' + b.index];
  if (a.entity !== b.entity) return ['cursor:entity', a.entity + ' vs ' + b.entity];
  for (let d = 0; a.valid && d < dims; d++) {
    if (a.offset(d) !== b.offset(d) || a.measure(d) !== b.measure(d)) return ['cursor:dim', 'dim ' + d];
  }
  return null;
}

export function runStream(factory, cfg, ops) {
  const o = { leafSize: cfg.leafSize, dims: cfg.dims };
  const eng = factory(cfg.C, o, cfg.count);
  const views = eng.views;
  const orc = [];
  for (let k = 0; k < cfg.count; k++) orc.push(new Oracle(cfg.dims));
  const lens = new Array(cfg.count).fill(0);
  const walkEvery = cfg.walk !== false && typeof eng.snapshot === 'function';
  let j = 0;
  for (let src = 0; src < ops.length; src++) {
    const op = normOne(ops[src], lens, lengths(orc, lens), cfg.count, cfg.C);
    if (op === null) continue;
    const at = j++;
    const fail = (sig, detail) => ({ sig, at, upto: src + 1, detail });
    let te = null;
    let to = null;
    let re;
    let ro;
    try { ro = apply(orc[op.v], op, orc); } catch (e) { to = token(e); }
    try { re = apply(views[op.v], op, views); } catch (e) { te = token(e); }
    if (te !== to) return fail(te !== null ? 'throw:engine:' + te : 'throw:oracle:' + to, op.op);
    if (te === null && (op.op === 'seekIndex' || op.op === 'seekSum' || op.op === 'next' ||
        op.op === 'removeAt') && re !== ro) {
      return fail('oracle:return', op.op + ' ' + re + ' vs ' + ro);
    }
    for (let k = 0; k < cfg.count; k++) {
      const c = compareView(views[k], orc[k], cfg.dims);
      if (c !== null) return fail(c[0], 'view ' + k + ': ' + c[1] + ' after ' + op.op);
    }
    if (walkEvery) {
      const w = walk(eng.snapshot(), { B: cfg.leafSize, dims: cfg.dims });
      if (w !== null) return fail('walker:' + w.code, w.detail);
    }
  }
  return null;
}

export function minimize(ops, factory, cfg, target, opts) {
  const first = runStream(factory, cfg, ops);
  if (first === null) throw new Error('minimize: the stream does not fail');
  const sig = target || first.sig;
  const maxTests = opts && opts.maxTests !== undefined ? opts.maxTests : Infinity;
  const maxPasses = opts && opts.maxPasses !== undefined ? opts.maxPasses : 4;
  const test = (cand) => {
    let r;
    try { r = runStream(factory, cfg, cand); } catch (e) { return UNRESOLVED; }
    if (r === null) return PASS;
    return r.sig === sig ? { outcome: FAIL, upto: r.upto } : UNRESOLVED;
  };
  let cur = ops;
  let tests = 0;
  let cached = 0;
  let capped = false;
  let passes = 0;
  let fixpoint = false;
  // Alternate ddmin (fewer ops) and argument simplification (smaller values)
  // until a pass changes nothing (the LiteSignal bench/soak/shrink.mjs loop).
  while (passes < maxPasses && !capped) {
    passes++;
    const res = ddmin(cur, test, { maxTests: maxTests - tests });
    tests += res.tests;
    cached += res.cached;
    capped = res.capped;
    const before = JSON.stringify(res.minimal);
    const s = simplify(res.minimal, test, maxTests - tests);
    tests += s.tests;
    capped = capped || s.capped;
    cur = s.ops;
    if (JSON.stringify(cur) === before) { fixpoint = !capped; break; }
  }
  return { sig, original: ops.length, firstAt: first.upto, minimal: cur, tests, cached, capped, passes, fixpoint };
}

// Each numeric argument (i, e, d, y, every m slot) is lowered to 0, then 1,
// then half while the same failure survives. Every accepted change strictly
// lowers a non-negative integer, so the loop ends without a budget.
function simplify(ops, test, budget) {
  const cur = ops.map((o) => ({ ...o, m: Array.isArray(o.m) ? o.m.slice() : o.m }));
  let tests = 0;
  const fails = (cand) => {
    if (tests >= budget) return false;
    tests++;
    const r = test(cand);
    return typeof r === 'object' && r.outcome === FAIL;
  };
  for (let k = 0; k < cur.length; k++) {
    for (const f of ['i', 'e', 'd', 'y', 'm']) {
      const val = cur[k][f];
      if (val === undefined) continue;
      const slots = Array.isArray(val) ? val.length : 1;
      for (let s = 0; s < slots; s++) {
        for (;;) {
          const v = Array.isArray(val) ? cur[k][f][s] : cur[k][f];
          let took = false;
          for (const c of [0, 1, Math.floor(v / 2)]) {
            if (!(c >= 0 && c < v)) continue;
            const cand = cur.slice();
            const op = { ...cur[k] };
            if (Array.isArray(val)) { op[f] = op[f].slice(); op[f][s] = c; } else op[f] = c;
            cand[k] = op;
            if (fails(cand)) { cur[k] = op; took = true; break; }
          }
          if (!took) break;
        }
      }
    }
  }
  return { ops: cur, tests, capped: tests >= budget };
}

// ---- seeded generator --------------------------------------------------------

export function randomOps(seed, n, cfg) {
  let x = (seed >>> 0) || 1;
  const r = (k) => {
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0;
    return x % k;
  };
  const ops = [];
  for (let j = 0; j < n; j++) {
    const v = r(cfg.count);
    const p = r(100);
    const i = r(1 << 20);
    if (p < 45) {
      const m = [];
      for (let d = 0; d < cfg.dims; d++) m.push(r(8));
      ops.push({ op: 'insertAt', v, i, e: r(1 << 16), m });
    } else if (p < 70) ops.push({ op: 'removeAt', v, i });
    else if (p < 78) ops.push({ op: 'setMeasure', v, i, d: r(cfg.dims), m: r(8) });
    else if (p < 82) ops.push({ op: 'splitAt', v, i, out: r(cfg.count) });
    else if (p < 86) ops.push({ op: 'append', v, other: r(cfg.count) });
    else if (p < 87) ops.push({ op: 'clear', v });
    else if (p < 92) ops.push({ op: 'seekIndex', v, i });
    else if (p < 96) ops.push({ op: 'seekSum', v, d: r(cfg.dims), y: r(64) });
    else ops.push({ op: 'next', v });
  }
  return ops;
}

// ---- demo ----------------------------------------------------------------------

async function demo() {
  const { fileURLToPath, pathToFileURL } = await import('node:url');
  const path = await import('node:path');
  const { buildMutant } = await import('./mutant-build.mjs');
  const { engineFactory } = await import('./adapter.mjs');
  const here = path.dirname(fileURLToPath(import.meta.url));
  const SRC = path.join(here, '..', 'Yggdrasil.js');
  // Planted bug: the equalize branch of ygRepair moves one element too few when
  // the LEFT leaf is the short one and the pair shares (2t > B): a remove that
  // underflows a leaf, or an append / splitAt whose seam leaf is short.
  let eng = null;
  let ad = null;
  try {
    eng = await buildMutant(SRC, [[
      'ygMove(v, br, br + h - sL, sR - (h - sL));',
      'ygMove(v, br, br + h - sL, sR - (h - sL) - 1);', 1]]);
    ad = await buildMutant(path.join(here, 'adapter.mjs'), [[
      "'../Yggdrasil.js'", JSON.stringify(pathToFileURL(eng.file).href), 1]]);
    const cfg = { C: 64, leafSize: 8, dims: 2, count: 3 };
    const N = 400;
    let seed = 0;
    let ops = null;
    let first = null;
    for (let s = 1; s <= 500 && first === null; s++) {
      const cand = randomOps(s, N, cfg);
      first = runStream(ad.engineFactory, cfg, cand);
      if (first !== null) { seed = s; ops = cand; }
    }
    if (first === null) { console.log('demo: no failing seed in 1..500'); process.exitCode = 1; return; }
    console.log('mutant fails: seed ' + seed + ', ' + N + ' ops, first failure ' + first.sig +
      ' at source op ' + (first.upto - 1) + ' (' + first.detail + ')');
    const t0 = Date.now();
    const m = minimize(ops, ad.engineFactory, cfg);
    console.log('ddmin: ' + m.original + ' ops -> prefix ' + m.firstAt + ' -> ' + m.minimal.length +
      ' ops, sig ' + m.sig + ', ' + m.tests + ' runs, ' + m.cached + ' cache hits, ' + (Date.now() - t0) + ' ms' +
      (m.capped ? ' (CAPPED)' : '') + (m.fixpoint ? '' : ' (no fixpoint)'));
    const norm = normalizeOps(m.minimal, cfg);
    for (const o of norm) {
      const { src, ...rest } = o;
      console.log('  ' + JSON.stringify(rest));
    }
    const again = runStream(ad.engineFactory, cfg, m.minimal);
    const real = runStream(engineFactory, cfg, m.minimal);
    console.log('replay on the mutant: ' + (again === null ? 'PASS' : again.sig) +
      '; on the real build: ' + (real === null ? 'PASS' : real.sig));
    if (again === null || again.sig !== m.sig || real !== null) process.exitCode = 1;
  } finally {
    if (ad !== null) ad.cleanup();
    if (eng !== null) eng.cleanup();
  }
}

if (process.argv[2] === 'demo' && import.meta.url === (await import('node:url')).pathToFileURL(process.argv[1]).href) {
  await demo();
}
