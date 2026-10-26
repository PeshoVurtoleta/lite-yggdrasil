// test/Witness.test.mjs -- rung 7 (G-B4): the rotation witnesses W-DEL / W-INS / W-TIE and the delete-trigger tie row,
// each with its must-FAIL mutant. ADR 0001 DB-8 M-2 + Assertion A1 ("W-INS / W-DEL / W-TIE pass at gamma = 2; each
// mutant fails its witness"), T-2 (single iff inner < 2*outer, STRICT; delete trigger 3*lw < rw | 3*rw < lw),
// RESEARCH.md B-15 (Adams size-only weights is NOT a witness); ADR 0005 C-32 (join-built), C-28 (walker), C-20 (pulls),
// C-18 (moves), C-25 (touches).
//
// READING of the 0001 M-2 tuple notation (the text does not fix it; RESEARCH I-1 / T-2 say weight = LEAF COUNT):
//   (x, y) is an internal node whose two children hold x and y LEAVES; a bare number n is a SUBTREE of n leaves whose
//   inner shape the tuple does not fix. W-DEL (3, ((3,1), 4)): root = (3 | 8), its right node = ((3,1) | 4) = (4 | 4),
//   (3,1) = a 3-leaf subtree and ONE leaf. Every inner n-subtree is the shape a plain append chain builds when the two
//   operands already pass I-1 (a join of balanced trees is the fresh node, T-3): 3 = ((1,1),1), 4 = ((1,1),(1,1)),
//   5 = (3,2), 9 = (4,5). W-DEL: remove in a: 3 -> 2, root 2 vs 8 (3*2 < 8) rotates; at the rotation inner = (3,1) = 4
//   and outer = 4: gamma = 2 strict: 4 < 2*4 -> SINGLE; gamma = 1 (4 < 1*4 false) -> double -> a (1,4) node.
//   W-INS (2, ((2,2), 2)): insert inside b = the (2,2): 4 -> 5, root 2 vs 7 rotates, inner 5 vs outer 2: 5 < 2*2 false
//   -> DOUBLE; gamma = 3 (5 < 6) -> single -> root 7 vs 2. W-TIE the same pre-shape, a leaf removed from a (2 -> 1):
//   root 1 vs 6, inner (2,2) = 4 vs outer 2: 4 < 2*2 is an exact TIE at gamma = 2: strict -> DOUBLE; the `<=` mutant
//   -> single -> a (1,4) node.
// READING (not fixed by the text): W-INS and W-TIE share the TREE shape; their leaf SIZES differ (INS: every leaf full,
//   B = 8, so the insert splits; TIE / DEL: every leaf holds m = 2 entries, so the remove underflows and merges).
// B = 8 (m = B/4 = 2): the smallest B where a leaf at exactly m = 2 entries underflows on one remove and merges
//   (t = 1 + 2 = 3, 2t = 6 <= 8). At B = 4, m = 1: no leaf is ever short, so no remove underflows.
// Rows, each built by append (joins) of single-leaf views of ONE arena, walker-checked after the build and after the
// op, the pre-shape asserted by this file's OWN traversal of the adapter snapshot: DEL / INS / TIE, each in BOTH
// mirror images (the left-heavy branch is ygRotate's `wr > wl` half, the right-heavy one its other half), plus a DTIE
// row (the delete trigger's own tie: root (3 | 9) after a remove from (4 | 9): 3*3 == 9 is VALID, so the correct
// build does not rotate; the `<=` trigger mutant rotates a valid node and leaves a still-valid tree, so ONLY the
// shape / rotation counters catch it -- the walker does not).
// Oracle independence: every expected shape, size, counter and touch depth is written out from the spec rules in this
// file (the leaf-count notation, T-2, C-18 moves, C-20 pulls = 1 fresh + 1 per ancestor + 2 single / 3 double, C-25
// touches = d(w) + d'(t')), by a SPEC-TREE reference (path / depthAt below), never read back from the engine.
// Mutants run in a CHILD process against a count-checked patched copy of Yggdrasil.js (anchors are single-match TEXT).
//
// MIT (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>. ASCII only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'Yggdrasil.js');
const ADAPTER = join(HERE, 'adapter.mjs');
const WALKER_URL = pathToFileURL(join(HERE, 'walker.mjs')).href;

// ---- mutants: single-match TEXT anchors (a patch that matches more than once aborts) ----
// L = the `wr > wl` half of ygRotate (left side lost weight), R = the mirror half.
const ANC_GL = '    if ((yl < 0 ? 1 : weight[yl]) < 2 * (yr < 0 ? 1 : weight[yr])) {';
const ANC_GR = '  if ((yr < 0 ? 1 : weight[yr]) < 2 * (yl < 0 ? 1 : weight[yl])) {';
const ANC_TRIG = '        if ((3 * lw < rw) | (3 * rw < lw)) pulls += ygRotate(v, x, lw, rw); // T-2, delete side';
const MUTANTS = {
  g1L: [[ANC_GL, ANC_GL.replace('< 2 * (', '< 1 * ('), 1]], // gamma = 1 on the left-heavy half
  g1R: [[ANC_GR, ANC_GR.replace('< 2 * (', '< 1 * ('), 1]],
  g3L: [[ANC_GL, ANC_GL.replace('< 2 * (', '< 3 * ('), 1]], // gamma = 3
  g3R: [[ANC_GR, ANC_GR.replace('< 2 * (', '< 3 * ('), 1]],
  leL: [[ANC_GL, ANC_GL.replace('< 2 * (', '<= 2 * ('), 1]], // `<=` (tie goes single)
  leR: [[ANC_GR, ANC_GR.replace('< 2 * (', '<= 2 * ('), 1]],
  trig: [[ANC_TRIG, ANC_TRIG.replace('(3 * lw < rw) | (3 * rw < lw)', '(3 * lw <= rw) | (3 * rw <= lw)'), 1]],
};

// ---- the spec-tree reference (leaf = 1, node = [left, right]); no engine value is read here ----
const B = 8;
const M = 2; // m = B / 4
function mirror(s) { return s === 1 ? 1 : [mirror(s[1]), mirror(s[0])]; }
function nLeaves(s) { return s === 1 ? 1 : nLeaves(s[0]) + nLeaves(s[1]); }
// path to in-order leaf k: array of sides (0 = left, 1 = right); its length = the number of internal ancestors
function path(s, k) {
  const out = [];
  let node = s, kk = k;
  while (node !== 1) {
    const nl = nLeaves(node[0]);
    if (kk < nl) { out.push(0); node = node[0]; } else { out.push(1); kk -= nl; node = node[1]; }
  }
  return out;
}
function depthAt(s, sizes, idx) { // internal ancestors of the leaf holding element idx
  let k = 0, acc = 0;
  while (idx >= acc + sizes[k]) { acc += sizes[k]; k++; }
  return path(s, k).length;
}
const S3 = [[1, 1], 1];
const S4 = [[1, 1], [1, 1]];
const S31 = [S3, 1];
const S5 = [S3, [1, 1]];
const T9 = [S4, S5];

// Row = { id, kind, pre, post, mutPost, sizes, k (leaf), p (position in leaf), rot: [single, double], pulls }
// pulls (C-20, written out per row; symmetric under mirroring):
//   DEL : 1 (w's own path below the shared part: the pair (l1,l2)) + 1 (root) + 2 (one single rotation) = 4
//   TIE : 0 (w = l1 is a leaf child: no path) + 1 (root) + 3 (one double rotation) = 4
//   DTIE: 0 + 1 (the (4) node) + 1 (root) + 0 (no rotation) = 2
//   INS : 1 (fresh node) + 4 (ancestors: pair, z, y, root) + 3 (one double rotation) = 8
const BASE = [
  { id: 'DEL', kind: 'rm', pre: [S3, [S31, S4]], post: [[[1, 1], S31], S4],
    mutPost: [[[1, 1], S3], [1, S4]], // gamma 1: double -> ((A, zl), (zr, yr)) with the (1 | 4) node
    sizeAll: M, k: 2, p: 1, rot: [1, 0], mutRot: [0, 1], pulls: 4 },
  { id: 'INS', kind: 'ins', pre: [[1, 1], [[[1, 1], [1, 1]], [1, 1]]],
    post: [[[1, 1], [[1, 1], 1]], [[1, 1], [1, 1]]], // double: ((A, P'), (Q, yr)), P' = ((1,1),1)
    mutPost: [[[1, 1], [[[1, 1], 1], [1, 1]]], [1, 1]], // gamma 3: single: ((A, z), yr) = (7 | 2)
    sizeAll: B, k: 2, p: 4, rot: [0, 1], mutRot: [1, 0], pulls: 8 },
  { id: 'TIE', kind: 'rm', pre: [[1, 1], [[[1, 1], [1, 1]], [1, 1]]],
    post: [[1, [1, 1]], [[1, 1], [1, 1]]],
    mutPost: [[1, [[1, 1], [1, 1]]], [1, 1]],
    sizeAll: M, k: 1, p: 1, rot: [0, 1], mutRot: [1, 0], pulls: 4 },
  { id: 'DTIE', kind: 'rm', pre: [S4, T9], post: [[1, [1, 1]], T9],
    mutPost: [[[1, [1, 1]], S4], S5],
    sizeAll: M, k: 1, p: 1, rot: [0, 0], mutRot: [1, 0], pulls: 2 },
];
function mkRow(b, flip) {
  const pre = flip ? mirror(b.pre) : b.pre;
  const N = nLeaves(pre);
  const sizes = new Array(N).fill(b.sizeAll);
  const k = flip ? N - 1 - b.k : b.k;
  let at = 0;
  for (let i = 0; i < k; i++) at += sizes[i];
  at += b.p;
  return {
    id: b.id + (flip ? '-R' : '-L'), kind: b.kind, flip: flip, pre: pre,
    post: flip ? mirror(b.post) : b.post, mutPost: flip ? mirror(b.mutPost) : b.mutPost,
    sizes: sizes, k: k, p: b.p, at: at, rot: b.rot, mutRot: b.mutRot, pulls: b.pulls,
  };
}
// the expected counter deltas and post sizes, from the spec rules
function expectOf(r) {
  const n = r.sizes.reduce((a, b) => a + b, 0);
  const pathU = path(r.pre, r.k);
  if (r.kind === 'ins') {
    const a = 2 * r.p <= B ? (B >> 1) + 1 : B >> 1; // 0001 Table 3, interior split
    const post = r.sizes.slice();
    post.splice(r.k, 1, a, B + 1 - a);
    return {
      sizes: post,
      d: { touches: pathU.length + depthAt(r.post, post, r.at), pulls: r.pulls, moves: r.p < a ? B - r.p : B - a, splits: 1, merges: 0, equalizes: 0,
        rotSingle: r.rot[0], rotDouble: r.rot[1] },
    };
  }
  const uLeft = pathU[pathU.length - 1] === 0;
  const w = uLeft ? r.k + 1 : r.k - 1;
  const sU = r.sizes[r.k] - 1; // after the removal
  const sW = r.sizes[w];
  const t = sU + sW;
  assert.ok(2 * t <= B, 'row ' + r.id + ' must merge (2t <= B)'); // T-6: merge iff 2t <= B
  const rep = uLeft ? (sU > 0 ? t : 0) : sU; // C-18 merge rep(sL, sR, uLeft)
  const post = r.sizes.slice();
  post[w] = t;
  post.splice(r.k, 1);
  return {
    sizes: post,
    d: { touches: path(r.pre, w).length + depthAt(r.post, post, Math.min(r.at, n - 2)), pulls: r.pulls,
      moves: (M - 1 - r.p) + rep, splits: 0, merges: 1, equalizes: 0, rotSingle: r.rot[0], rotDouble: r.rot[1] },
  };
}
const ROWS = [];
for (const b of BASE) { ROWS.push(mkRow(b, false)); ROWS.push(mkRow(b, true)); }

// ---- the child: argv = [yggPath, adapterPath, rowsJson]. Prints ONE JSON line: per row, the observations. ----
const CHILD = `
import { pathToFileURL } from 'node:url';
const [yggPath, adapterPath, rowsJson] = process.argv.slice(2);
const rows = JSON.parse(rowsJson);
const { SumSequence } = await import(pathToFileURL(yggPath).href);
const { engineFactory } = await import(pathToFileURL(adapterPath).href);
const { walk } = await import(${JSON.stringify(WALKER_URL)});
const Bv = ${B};
const NAMES = ['touches', 'pulls', 'moves', 'splits', 'merges', 'equalizes', 'rotSingle', 'rotDouble'];
function wk(f) { const w = walk(f.snapshot(), { B: Bv, dims: 1 }); return w === null ? null : w.code + ': ' + w.detail; }
// own traversal of the snapshot: nested shape (leaf = 1) and the in-order leaf sizes
function shapeOf(sn, root) {
  const sizes = [];
  const go = (ref) => {
    if (ref < 0) { sizes.push(sn.leaf.len[~ref]); return 1; }
    const l = go(sn.int.left[ref]); const r = go(sn.int.right[ref]);
    return [l, r];
  };
  const shape = go(root);
  return { shape, sizes };
}
const out = {};
for (const row of rows) {
  const o = {};
  try {
    const N = row.sizes.length;
    const total = row.sizes.reduce((a, b) => a + b, 0);
    const f = engineFactory(200, { leafSize: Bv, dims: 1 }, N, undefined);
    const model = [];
    let next = 0;
    for (let k = 0; k < N; k++) for (let j = 0; j < row.sizes[k]; j++) { const e = 1000 + next; f.views[k].insertAt(j, e, e + 1); model.push(e); next++; }
    const build = (s, lo) => { // s = spec; leaves are f.views[lo...]; returns [view, nextLeaf]
      if (s === 1) return [f.views[lo], lo + 1];
      const a = build(s[0], lo); const b = build(s[1], a[1]);
      a[0].append(b[0]);
      return [a[0], b[1]];
    };
    const root = build(row.pre, 0)[0];
    o.buildWalk = wk(f);
    const sn0 = f.snapshot();
    const pre = shapeOf(sn0, root._root);
    o.preShape = pre.shape; o.preSizes = pre.sizes;
    const c0 = new Int32Array(12), c1 = new Int32Array(12);
    o.fl0 = root._fl; // C-5: append left the finger NIL on the result view
    root.readCounters(c0);
    if (row.kind === 'rm') { const e = root.removeAt(row.at); model.splice(row.at, 1); o.removed = e === 1000 + row.at; }
    else { root.insertAt(row.at, 99999, 1); model.splice(row.at, 0, 99999); }
    root.readCounters(c1);
    o.walk = wk(f);
    const sn1 = f.snapshot();
    const post = shapeOf(sn1, root._root);
    o.postShape = post.shape; o.postSizes = post.sizes;
    o.fh = c1[SumSequence.COUNTERS.fingerHits] - c0[SumSequence.COUNTERS.fingerHits];
    o.fm = c1[SumSequence.COUNTERS.fingerMisses] - c0[SumSequence.COUNTERS.fingerMisses];
    o.d = {};
    for (const nm of NAMES) o.d[nm] = c1[SumSequence.COUNTERS[nm]] - c0[SumSequence.COUNTERS[nm]];
    let ok = root.length === model.length;
    for (let i = 0; ok && i < model.length; i++) if (root.entityAt(i) !== model[i]) ok = false;
    o.answers = ok;
  } catch (e) {
    o.threw = String(e && e.message);
  }
  out[row.id] = o;
}
process.stdout.write(JSON.stringify(out) + '\\n');
`;

function countOf(hay, needle) {
  let c = 0;
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + needle.length)) c++;
  return c;
}
function patchSource(src, patches) {
  for (const p of patches) {
    const found = countOf(src, p[0]);
    if (found !== p[2]) throw new Error('anchor ' + JSON.stringify(p[0]) + ' found ' + found + ' times, expected ' + p[2]);
    src = src.split(p[0]).join(p[1]);
  }
  return src;
}
function runChild(patches) {
  const dir = mkdtempSync(join(tmpdir(), 'ygg-wit-'));
  try {
    const ygg = join(dir, 'Yggdrasil.js');
    writeFileSync(ygg, patches === null ? readFileSync(SRC, 'utf8') : patchSource(readFileSync(SRC, 'utf8'), patches));
    const ad = join(dir, 'adapter.mjs');
    const adSrc = readFileSync(ADAPTER, 'utf8');
    assert.equal(countOf(adSrc, "'../Yggdrasil.js'"), 1, 'adapter import anchor');
    writeFileSync(ad, adSrc.replace("'../Yggdrasil.js'", JSON.stringify(pathToFileURL(ygg).href)));
    const child = join(dir, 'child.mjs');
    writeFileSync(child, CHILD);
    const rows = ROWS.map((r) => ({ id: r.id, kind: r.kind, pre: r.pre, sizes: r.sizes, at: r.at }));
    const r = spawnSync(process.execPath, [child, ygg, ad, JSON.stringify(rows)], { timeout: 30000, killSignal: 'SIGKILL', encoding: 'utf8' });
    let verdict = null;
    if (r.stdout) { try { verdict = JSON.parse(r.stdout.trim().split('\n').pop()); } catch (e) { verdict = null; } }
    assert.ok(verdict !== null, 'no verdict (status ' + r.status + ', stderr ' + String(r.stderr || '').slice(0, 300) + ')');
    return verdict;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
const J = (x) => JSON.stringify(x);

// The named failing checks of one row's observation against the spec.
function failures(row, o, useMut) {
  const ex = expectOf(row);
  const f = [];
  if (o.threw !== undefined) return ['threw'];
  if (o.buildWalk !== null) f.push('build-walker');
  if (J(o.preShape) !== J(row.pre) || J(o.preSizes) !== J(row.sizes)) f.push('pre-shape');
  if (o.walk !== null) f.push('walker:' + o.walk.slice(0, 3));
  if (J(o.postShape) !== J(useMut ? row.mutPost : row.post)) f.push('post-shape');
  if (J(o.postSizes) !== J(ex.sizes)) f.push('post-sizes');
  const exd = Object.assign({}, ex.d);
  if (useMut) { exd.rotSingle = row.mutRot[0]; exd.rotDouble = row.mutRot[1]; }
  for (const nm of Object.keys(exd)) if (o.d[nm] !== exd[nm]) f.push('counter:' + nm);
  if (o.answers !== true) f.push('answers');
  // C-4 / C-5 / C-26: every row's op is a MISS (the pre-shape is append-built, so the finger is NIL, and the trigger
  // is structural anyway: a full leaf splits, an m-entry leaf underflows), so touches above is d(w) + d'(t'), never 0
  if (o.fl0 !== 0 || o.fh !== 0 || o.fm !== 1) f.push('finger-miss');
  return f;
}

const REAL = runChild(null);
const MUT = {};
for (const k of Object.keys(MUTANTS)) MUT[k] = runChild(MUTANTS[k]);

// ---- the real build: every row, full surface ----
for (const row of ROWS) {
  test('W-' + row.id + ' real build: pre-shape, walker, post-shape, sizes, counters, answers (gamma = 2 strict, T-2)', () => {
    const o = REAL[row.id];
    assert.equal(o.threw, undefined, 'threw ' + o.threw);
    assert.equal(o.buildWalk, null, 'join-built pre-shape walker: ' + o.buildWalk);
    assert.equal(J(o.preShape), J(row.pre), 'pre-shape (own traversal of the snapshot)');
    assert.equal(J(o.preSizes), J(row.sizes), 'pre leaf sizes');
    assert.equal(o.walk, null, 'walker after the op: ' + o.walk);
    assert.equal(J(o.postShape), J(row.post), 'post-shape');
    const ex = expectOf(row);
    assert.equal(J(o.postSizes), J(ex.sizes), 'post leaf sizes');
    assert.deepEqual(o.d, ex.d, 'counters touched by the op (touches, pulls, moves, splits, merges, equalizes, rotSingle, rotDouble)');
    assert.equal(o.answers, true, 'entityAt answers against the plain-array model');
    assert.deepEqual([o.fl0, o.fh, o.fm], [0, 0, 1], 'NIL finger before the op; the op is one miss, 0 hits (C-4, C-5, C-26)');
    if (row.kind === 'rm') assert.equal(o.removed, true, 'removeAt returned the removed entity');
    assert.deepEqual(failures(row, o, false), []);
  });
}

// ---- the mutants: each FAILS its witness; the named check ----
// expect: row id -> the checks that must be among its failures (walker I-1 for the balance rows; for DTIE the tree is
// still VALID (walker clean), so only the shape and the rotation counters catch the `<=` trigger).
const KILLS = {
  g1L: { row: 'DEL-L', checks: ['walker:I-1', 'post-shape', 'counter:rotSingle', 'counter:rotDouble'], other: 'DEL-R' },
  g1R: { row: 'DEL-R', checks: ['walker:I-1', 'post-shape', 'counter:rotSingle', 'counter:rotDouble'], other: 'DEL-L' },
  g3L: { row: 'INS-L', checks: ['walker:I-1', 'post-shape', 'counter:rotSingle', 'counter:rotDouble'], other: 'INS-R' },
  g3R: { row: 'INS-R', checks: ['walker:I-1', 'post-shape', 'counter:rotSingle', 'counter:rotDouble'], other: 'INS-L' },
  leL: { row: 'TIE-L', checks: ['walker:I-1', 'post-shape', 'counter:rotSingle', 'counter:rotDouble'], other: 'TIE-R' },
  leR: { row: 'TIE-R', checks: ['walker:I-1', 'post-shape', 'counter:rotSingle', 'counter:rotDouble'], other: 'TIE-L' },
};
for (const key of Object.keys(KILLS)) {
  const kl = KILLS[key];
  test('mutant ' + key + ' FAILS ' + kl.row + ' (named checks ' + kl.checks.join(', ') + ') and leaves the other half ' + kl.other + ' passing', () => {
    const row = ROWS.find((r) => r.id === kl.row);
    const o = MUT[key][kl.row];
    // vs the SPEC (real expectations) the mutant must fail with the named checks
    const vsSpec = failures(row, o, false);
    for (const c of kl.checks) assert.ok(vsSpec.includes(c), 'mutant ' + key + ' not caught by ' + c + ': ' + vsSpec.join(','));
    // and it produces exactly the hand-derived wrong shape / rotation kind
    assert.deepEqual(failures(row, o, true).filter((c) => c !== 'walker:I-1' && c !== 'counter:touches' && c !== 'counter:pulls'), [], 'mutant ' + key + ' behaves as the hand-derived mutant');
    assert.equal(J(o.postShape), J(row.mutPost));
    const other = ROWS.find((r) => r.id === kl.other);
    assert.deepEqual(failures(other, MUT[key][kl.other], false), [], 'the other half is untouched by ' + key);
  });
}
test('mutant trig (delete trigger `<=`) FAILS DTIE-L and DTIE-R by shape and rotation counters; the walker stays CLEAN (a valid tree)', () => {
  for (const id of ['DTIE-L', 'DTIE-R']) {
    const row = ROWS.find((r) => r.id === id);
    const o = MUT.trig[id];
    const vsSpec = failures(row, o, false);
    for (const c of ['post-shape', 'counter:rotSingle']) assert.ok(vsSpec.includes(c), id + ' not caught by ' + c + ': ' + vsSpec.join(','));
    assert.equal(o.walk, null, id + ': the rotated tie node is still I-1 valid (tie is 3*lw == rw, allowed)');
    assert.deepEqual(failures(row, o, true).filter((c) => c !== 'counter:touches' && c !== 'counter:pulls'), [], id + ' behaves as the hand-derived mutant');
    assert.equal(J(o.postShape), J(row.mutPost));
  }
  // the other rows have no delete tie at an ancestor: the trig mutant leaves them passing
  for (const id of ['DEL-L', 'DEL-R', 'TIE-L', 'TIE-R', 'INS-L', 'INS-R']) {
    const row = ROWS.find((r) => r.id === id);
    assert.deepEqual(failures(row, MUT.trig[id], false), [], id + ' unaffected by the trigger mutant');
  }
});
test('control: every row on the real build passes all checks (the mutant rows are not vacuous)', () => {
  for (const row of ROWS) assert.deepEqual(failures(row, REAL[row.id], false), [], row.id);
});
