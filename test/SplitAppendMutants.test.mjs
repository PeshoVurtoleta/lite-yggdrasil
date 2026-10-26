// test/SplitAppendMutants.test.mjs -- rung 6 (S-R2): must-FAIL mutant rows MS-3..MS-8 and the join-stack size row
// for append / join. ADR 0005 C-21 (seam repair), C-24 (joinSteps <= HB), C-25 (touches), C-5 / C-6 (NIL, _cv),
// C-10 (operand paragraph: arena + headroom), C-23 (stack H(Lmax)), C-35 / C-46 (mutant style); 0001 T-3 / M-3.
//
// Oracle independence: every expected value is a spec rule written out in a comment (3+2 -> one leaf, u = the right
// short leaf, merge moves |u| = 2 (C-18); 2^53-2 + 2 > 2^53-1 headroom; the walker invariants I-5 / I-9a), never a
// value read back from the engine. Every MUTANT scenario runs in a CHILD process (mkdtemp dir; spawnSync with a
// timeout and SIGKILL) against a count-checked patched copy of Yggdrasil.js and a copy of test/adapter.mjs repointed
// at it; each row also runs the same scenario on the REAL build as its control. The scenarios compare against the
// plain-array model in test/oracle.mjs and the walker in test/walker.mjs.
//
// MIT (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>. ASCII only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { engineFactory } from './adapter.mjs';
import { SumSequence } from '../Yggdrasil.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..', 'Yggdrasil.js');
const ADAPTER = join(HERE, 'adapter.mjs');
const WALKER_URL = pathToFileURL(join(HERE, 'walker.mjs')).href;
const ORACLE_URL = pathToFileURL(join(HERE, 'oracle.mjs')).href;

// ---- ANCHORS. The coder reports exact single-match anchors; the orchestrator fills them. A null anchor FAILS its
// row (never skips). Each mutant value is [[anchor, replacement, count], ...] for patchSource below.
//   ms3 : append does no seam repair             ms4 : the repair is left-first (u = the left leaf)
//   ms5 : append keeps other's finger            ms6 : no cross-arena operand check
//   ms7 : no append headroom check               ms8 : (unused; MS-8 is the static gate + the poisoned stack)
//   joinAlloc : the join stack is allocated with HL - 1 entries
//   joinStack : NAME of the join-stack field on view._ar (a string), for the poisoned-stack check
const ANCHORS = {
  ms3: [['  if ((la < m) | (lb < m)) {', '  if (false) {', 1]],
  ms4: [['    if (lb < m) rep = ygRepair(v, o, ~rb, ~ra, 0, js, db, ss, da, 0);', '    if (!(la < m)) rep = ygRepair(v, o, ~rb, ~ra, 0, js, db, ss, da, 0);', 1]],
  ms5: [['    other._fl = YG_NIL;\n', '', 1]],
  ms6: [['    if (other._hdr !== this._hdr) {', '    if (false) {', 1]],
  ms7: [["      if (tR > YG_MAX - tL) ygFail('headroom', 'total would exceed 2^53-1');\n", '', 1]],
  // ms8: ygJoin recurses into itself (a recursive join) instead of walking the spine on the join stack
  ms8: [['  let top = 0;\n  while (!((3 * wc >= wo) & (3 * wo >= wc))) {', '  let top = 0;\n  if (!((3 * wc >= wo) & (3 * wo >= wc))) {\n    const p = c;\n    if (heavyA !== 0) right[p] = ygJoin(v, right[p], b);\n    else left[p] = ygJoin(v, a, left[p]);\n    ygPullW(v, p);\n    const l = left[p];\n    const r = right[p];\n    const wl = l < 0 ? 1 : weight[l];\n    const wr = r < 0 ? 1 : weight[r];\n    if (!((3 * wl >= wr) & (3 * wr >= wl))) {\n      if (heavyA !== 0) ygJoinRotL(v, p, wl);\n      else ygJoinRotR(v, p, wr);\n    }\n    v._n[YG_JOINS] += 1;\n    return p;\n  }\n  while (false) {', 1]],
  joinAlloc: [['  const jstack = new Int32Array(HL);', '  const jstack = new Int32Array(HL - 1);', 1]],
  joinStack: 'jstack',
  // the split/append seam stack sstack is allocated with HL - 1 entries (C-23: H(Lmax) - 1 must FAIL)
  splitAlloc: [['  const sstack = new Int32Array(HL);', '  const sstack = new Int32Array(HL - 1);', 1]],
};

// ---- mutant sandbox ----

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

// The child: argv = [yggPath, adapterPath, scenario]. Prints ONE JSON line. Scenario data is computed from spec rules.
const CHILD = `
import { pathToFileURL } from 'node:url';
const [yggPath, adapterPath, scn, extraJson] = process.argv.slice(2);
const extra = JSON.parse(extraJson);
const { SumSequence } = await import(pathToFileURL(yggPath).href);
const { engineFactory } = await import(pathToFileURL(adapterPath).href);
const { walk } = await import(${JSON.stringify(WALKER_URL)});
const { Oracle } = await import(${JSON.stringify(ORACLE_URL)});
const NC = 12;
const out = {};
function answersOk(v, arr) {
  if (v.length !== arr.length) return false;
  for (let i = 0; i < arr.length; i++) if (v.entityAt(i) !== arr[i] || v.getMeasure(i, 0) !== arr[i] + 1) return false;
  return true;
}
function ins(v, arr, i, e) { v.insertAt(i, e, e + 1); arr.splice(i, 0, e); }
function wk(f, B) { const w = walk(f.snapshot(), { B, dims: 1 }); return w === null ? null : w.code + ': ' + w.detail; }
try {
  if (scn === 'ms3') { // multi-leaf A (48 end inserts at B=16) ++ one 2-entry leaf: b = 2 < m = 4 -> a repair is due
    const B = 16, f = engineFactory(200, { leafSize: B, dims: 1 }, 2, undefined);
    const [a, b] = f.views; const A = [], Bv = [];
    for (let i = 0; i < 48; i++) ins(a, A, i, 100 + i);
    for (let i = 0; i < 2; i++) ins(b, Bv, i, 500 + i);
    a.append(b);
    out.walk = wk(f, B); out.answers = answersOk(a, A.concat(Bv)); out.otherLen = b.length;
  } else if (scn === 'ms4') { // 3 + 2, one leaf each: both short, u = the right leaf, merge (2*5 <= 16): moves = |u| = 2
    const f = engineFactory(64, { leafSize: 16, dims: 1 }, 2, undefined);
    const [a, b] = f.views; const A = [], Bv = [];
    for (let i = 0; i < 3; i++) ins(a, A, i, 10 + i);
    for (let i = 0; i < 2; i++) ins(b, Bv, i, 50 + i);
    const c0 = new Int32Array(NC), c1 = new Int32Array(NC);
    a.readCounters(c0); a.append(b); a.readCounters(c1);
    const K = SumSequence.COUNTERS;
    out.moves = c1[K.moves] - c0[K.moves]; out.merges = c1[K.merges] - c0[K.merges];
    out.walk = wk(f, 16); out.answers = answersOk(a, A.concat(Bv));
  } else if (scn === 'ms5') { // other's finger set by a positional op; after append other is empty -> finger NIL (I-9a)
    const B = 8, f = engineFactory(64, { leafSize: B, dims: 1 }, 2, undefined);
    const [a, b] = f.views; const A = [], Bv = [];
    for (let i = 0; i < 10; i++) ins(a, A, i, 10 + i);
    for (let i = 0; i < 10; i++) ins(b, Bv, i, 50 + i);
    b.getMeasure(3, 0);
    out.fingerSet = b._fl !== f.snapshot().NIL;
    a.append(b);
    out.walk = wk(f, B); out.answers = answersOk(a, A.concat(Bv));
  } else if (scn === 'ms6') { // operand from another arena
    const a = SumSequence.arena(10, { leafSize: 4, dims: 1 }, 2)[0];
    const b = SumSequence.arena(10, { leafSize: 4, dims: 1 }, 2)[0];
    a.insertAt(0, 1, 1); b.insertAt(0, 2, 1);
    try { a.append(b); out.threw = false; } catch (e) { out.threw = true; out.msg = String(e && e.message); out.name = e && e.constructor && e.constructor.name; }
    out.lens = [a.length, b.length];
  } else if (scn === 'ms7') { // (2^53-2) ++ 2 = 2^53 > 2^53-1
    const [a, b] = SumSequence.arena(10, { leafSize: 4, dims: 1 }, 2);
    a.insertAt(0, 1, 2 ** 53 - 2); b.insertAt(0, 2, 2);
    try { a.append(b); out.threw = false; } catch (e) { out.threw = true; out.msg = String(e && e.message); }
    out.lens = [a.length, b.length]; out.total = a.total(0);
  } else if (scn === 'jsize') {
    // Full-height use of the join stack is the SEAM PATH of append (ygSeamJoin writes other's first-leaf path, db
    // entries, into jstack). B = 8 (m = 2; at B = 4, m = 1, no leaf is short). this = ONE leaf of 1 entry (< m); other =
    // the worst-case 1:3 tree S(w) with the heavy side on the LEFT: S(1) = a 2-entry leaf (>= m), S(w) = S(w-ceil(w/4))
    // ++ S(ceil(w/4)) (balanced at the root, so built by plain appends, no seam repair). Its leftmost leaf is at depth
    // H(w). C is chosen so that H(Lmax) == H(w) (C-23 attainment), Lmax = ceil(C/m) + k, hence d_b == HL.
    const B = 8, m = 2;
    const Hh = (L) => { let h = 0; for (let w = L; w > 1; w = Math.floor(3 * w / 4)) h++; return h; };
    let W = 0, k = 0, C = 0, hh = 0;
    for (hh = extra.h; ; hh--) { // the smallest w with H(w) == hh; its Lmax range must stay inside H == hh
      let w = 1; while (Hh(w) < hh) w++;
      k = hh + 5; C = 2 * w + 2;
      if (Hh(Math.ceil(C / m) + k) === hh) { W = w; break; }
      if (hh < 3) break;
    }
    const f = engineFactory(C, { leafSize: B, dims: 1 }, k, undefined);
    const HL = f.views[0]._ar.HL;
    out.W = W; out.HL = HL; out.Hw = Hh(W);
    const free = f.views.slice(); const arrs = new Map(); let next = 1000;
    const build = (w) => {
      if (w === 1) { const v = free.pop(); const arr = []; ins(v, arr, 0, next++); ins(v, arr, 1, next++); arrs.set(v, arr); return v; }
      const a = Math.ceil(w / 4);
      const x = build(w - a); const y = build(a);
      const ax = arrs.get(x), ay = arrs.get(y);
      x.append(y); free.push(y);
      arrs.set(x, ax.concat(ay)); return x;
    };
    const other = build(W);
    const thisV = free.pop(); const ta = []; ins(thisV, ta, 0, 7);
    // d_b by an own traversal of the snapshot (left spine of other, internal nodes above the first leaf)
    const sn = f.snapshot(); let r = sn.views.length ? other._root : 0, db = 0;
    while (r >= 0) { db++; r = sn.int.left[r]; }
    out.db = db;
    const want = ta.concat(arrs.get(other));
    thisV.append(other);
    out.walk = wk(f, B); out.answers = answersOk(thisV, want); out.len = thisV.length;
  } else if (scn === 'jsizeR') {
    // Mirror of jsize: append's seam path writes this's last-leaf path (d_a entries) into sstack. B = 8, m = 2.
    // this = the worst-case 1:3 tree S(w) with the heavy side on the RIGHT (S(w) = S(ceil(w/4)) ++ S(w - ceil(w/4)));
    // other = ONE leaf of 1 entry (< m), so a repair reads all of sstack; C as in jsize, hence d_a == HL.
    const B = 8, m = 2;
    const Hh = (L) => { let h = 0; for (let w = L; w > 1; w = Math.floor(3 * w / 4)) h++; return h; };
    let W = 0, k = 0, C = 0, hh = 0;
    for (hh = extra.h; ; hh--) { // the smallest w with H(w) == hh; its Lmax range must stay inside H == hh
      let w = 1; while (Hh(w) < hh) w++;
      k = hh + 5; C = 2 * w + 2;
      if (Hh(Math.ceil(C / m) + k) === hh) { W = w; break; }
      if (hh < 3) break;
    }
    const f = engineFactory(C, { leafSize: B, dims: 1 }, k, undefined);
    const HL = f.views[0]._ar.HL;
    out.W = W; out.HL = HL; out.Hw = Hh(W);
    const free = f.views.slice(); const arrs = new Map(); let next = 1000;
    const build = (w) => {
      if (w === 1) { const v = free.pop(); const arr = []; ins(v, arr, 0, next++); ins(v, arr, 1, next++); arrs.set(v, arr); return v; }
      const a = Math.ceil(w / 4);
      const x = build(a); const y = build(w - a);
      const ax = arrs.get(x), ay = arrs.get(y);
      x.append(y); free.push(y);
      arrs.set(x, ax.concat(ay)); return x;
    };
    const thisV = build(W);
    const other = free.pop(); const oa = []; ins(other, oa, 0, 7); // one entry, 1 < m = 2
    // d_a by an own traversal of the snapshot (right spine of this, internal nodes above the last leaf)
    const sn = f.snapshot(); let r = thisV._root, da = 0;
    while (r >= 0) { da++; r = sn.int.right[r]; }
    out.da = da;
    const want = arrs.get(thisV).concat(oa);
    thisV.append(other);
    out.walk = wk(f, B); out.answers = answersOk(thisV, want); out.len = thisV.length;
  } else if (scn === 'poison') { // join stack poisoned; d = the real build's joinSteps for this scenario
    const f = engineFactory(60, { leafSize: 4, dims: 1 }, 2, undefined);
    const [a, b] = f.views;
    for (let i = 0; i < 40; i++) a.insertAt(i, i, 1);
    for (let i = 0; i < 4; i++) b.insertAt(i, 100 + i, 1);
    const st = a._ar[extra.stack]; st.fill(-12345);
    a.append(b);
    let un = 0; for (let i = 0; i < extra.d; i++) if (st[i] === -12345) un++;
    out.untouched = un;
  }
} catch (e) {
  out.threw = true; out.msg = String(e && e.message); out.stack = String(e && e.stack).slice(0, 300);
}
process.stdout.write(JSON.stringify(out) + '\\n');
`;

function runChild(scn, patches, extra) {
  const dir = mkdtempSync(join(tmpdir(), 'ygg-sam-'));
  const ygg = join(dir, 'Yggdrasil.js');
  writeFileSync(ygg, patches === null ? readFileSync(SRC, 'utf8') : patchSource(readFileSync(SRC, 'utf8'), patches));
  const ad = join(dir, 'adapter.mjs');
  const adSrc = readFileSync(ADAPTER, 'utf8');
  assert.equal(countOf(adSrc, "'../Yggdrasil.js'"), 1, 'adapter import anchor');
  writeFileSync(ad, adSrc.replace("'../Yggdrasil.js'", JSON.stringify(pathToFileURL(ygg).href)));
  const child = join(dir, 'child.mjs');
  writeFileSync(child, CHILD);
  const r = spawnSync(process.execPath, [child, ygg, ad, scn, JSON.stringify(extra || {})], { timeout: 20000, killSignal: 'SIGKILL', encoding: 'utf8' });
  let verdict = null;
  if (r.stdout) { try { verdict = JSON.parse(r.stdout.trim().split('\n').pop()); } catch (e) { verdict = null; } }
  rmSync(dir, { recursive: true, force: true });
  return { verdict, status: r.status, timedOut: !!(r.error && r.error.code === 'ETIMEDOUT'), stderr: String(r.stderr || '').slice(0, 300) };
}

function needAnchor(key) {
  assert.ok(ANCHORS[key] !== null && ANCHORS[key] !== undefined, 'ANCHORS.' + key + ' is null: the coder has not reported it (a null anchor FAILS its row)');
  return ANCHORS[key];
}

function good(r, what) {
  const v = r.verdict;
  assert.ok(v !== null, what + ': no verdict (status ' + r.status + ', timedOut ' + r.timedOut + ', stderr ' + r.stderr + ')');
  if (what !== 'allowThrow') assert.ok(v.threw !== true, what + ': scenario threw ' + JSON.stringify(v));
  return v;
}

// ---- MS-3: no seam repair -> walker I-5 ----
test('MS-3 append without a seam repair leaves a short seam leaf: walker I-5 (real build: clean)', () => {
  const real = good(runChild('ms3', null), 'real');
  assert.equal(real.walk, null, 'real build: walker ' + real.walk);
  assert.equal(real.answers, true);
  assert.equal(real.otherLen, 0);
  const mut = good(runChild('ms3', needAnchor('ms3')), 'mutant');
  assert.ok(typeof mut.walk === 'string' && mut.walk.startsWith('I-5'), 'mutant not caught by I-5: ' + JSON.stringify(mut));
});

// ---- MS-4: left-first repair -> moves 5 not 2 ----
test('MS-4 left-first seam repair moves 5, the spec repairs the right short leaf: moves delta 2 (real build)', () => {
  const real = good(runChild('ms4', null), 'real');
  // spec: 3 + 2, both < m = 4 -> u = the right leaf (C-21); t = 5, 2t = 10 <= 16 -> merge; moves = |u| = 2 (C-18)
  assert.equal(real.moves, 2, 'real build moves delta');
  assert.equal(real.merges, 1);
  assert.equal(real.walk, null);
  assert.equal(real.answers, true);
  const mut = good(runChild('ms4', needAnchor('ms4')), 'mutant');
  assert.notEqual(mut.moves, 2, 'mutant not caught: moves ' + mut.moves);
  assert.equal(mut.moves, 5, 'mutant moves');
});

// ---- MS-5: other's finger kept -> walker I-9a on other ----
test('MS-5 append that keeps other\'s finger: walker I-9a on the emptied operand (real build: clean)', () => {
  const real = good(runChild('ms5', null), 'real');
  assert.equal(real.fingerSet, true, 'scenario must set other\'s finger first');
  assert.equal(real.walk, null, 'real build: walker ' + real.walk);
  assert.equal(real.answers, true);
  const mut = good(runChild('ms5', needAnchor('ms5')), 'mutant');
  assert.ok(typeof mut.walk === 'string' && mut.walk.startsWith('I-9a'), 'mutant not caught by I-9a: ' + JSON.stringify(mut));
});

// ---- MS-6: no arena check ----
test('MS-6 append without the arena check does not throw /operand/ (real build: /operand/ and /SumSequence.arena/)', () => {
  const real = good(runChild('ms6', null), 'allowThrow');
  assert.equal(real.threw, true);
  assert.match(real.msg, /operand/);
  assert.match(real.msg, /SumSequence\.arena/);
  assert.deepEqual(real.lens, [1, 1], 'a rejected append is a no-op');
  const mut = good(runChild('ms6', needAnchor('ms6')), 'allowThrow');
  assert.ok(!(mut.threw === true && /operand/.test(mut.msg || '')), 'mutant still threw /operand/: ' + JSON.stringify(mut));
});

// ---- MS-7: no headroom check ----
test('MS-7 append without the headroom check does not throw /headroom/ at (2^53-2) ++ 2 (real build: throws, no-op)', () => {
  const real = good(runChild('ms7', null), 'allowThrow');
  assert.equal(real.threw, true);
  assert.match(real.msg, /headroom/);
  assert.deepEqual(real.lens, [1, 1]);
  assert.equal(real.total, 2 ** 53 - 2);
  const mut = good(runChild('ms7', needAnchor('ms7')), 'allowThrow');
  assert.ok(!(mut.threw === true && /headroom/.test(mut.msg || '')), 'mutant still threw /headroom/: ' + JSON.stringify(mut));
});

// ---- MS-8 (a): static gate, no join / split / walk function calls itself ----

// Skips strings, template literals, comments, regex-free approximation (the sources use none of the tricky forms).
function stripNoise(s) {
  let o = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; o += '\n'; continue; }
    if (c === '/' && s[i + 1] === '*') { i += 2; while (i < s.length && !(s[i] === '*' && s[i + 1] === '/')) { if (s[i] === '\n') o += '\n'; i++; } i++; continue; }
    if (c === '"' || c === "'" || c === '`') {
      const q = c; o += q; i++;
      while (i < s.length && s[i] !== q) { if (s[i] === '\\') i++; if (s[i] === '\n') o += '\n'; i++; }
      o += q; continue;
    }
    o += c;
  }
  return o;
}

// {name, body} of every function whose name matches NAME: `function name(`, and class / object methods `name(...) {`.
const NAME = /join|split|walk/i;
const NOT_METHOD = new Set(['if', 'for', 'while', 'switch', 'catch', 'function', 'return', 'else', 'typeof', 'new']);
function functionsOf(src) {
  const s = stripNoise(src);
  const out = [];
  const re = /(?:\bfunction\s+([A-Za-z_$][\w$]*)\s*\(|^[ \t]*(?:static\s+|async\s+)*([A-Za-z_$][\w$]*)\s*\([^()\n]*\)\s*\{)/gm;
  let m;
  while ((m = re.exec(s)) !== null) {
    const name = m[1] || m[2];
    if (!name || NOT_METHOD.has(name) || !NAME.test(name)) continue;
    let i = s.indexOf('{', m.index + m[0].length - (m[1] ? 0 : 1));
    if (i < 0) continue;
    let depth = 0; const start = i;
    for (; i < s.length; i++) { if (s[i] === '{') depth++; else if (s[i] === '}') { depth--; if (depth === 0) break; } }
    out.push({ name, body: s.slice(start + 1, i), start: start });
  }
  return out;
}

function selfCallers(src) {
  const bad = [];
  const fns = functionsOf(src);
  for (const f of fns) {
    const call = new RegExp('(?<![\\w$])' + f.name.replace(/\$/g, '\\$') + '\\s*\\(');
    if (call.test(f.body)) bad.push(f.name);
  }
  return { count: fns.length, bad };
}

test('MS-8a static gate: no join / split / walk function in Yggdrasil.js or walker.mjs calls itself', () => {
  for (const p of [SRC, join(HERE, 'walker.mjs')]) {
    const r = selfCallers(readFileSync(p, 'utf8'));
    assert.ok(r.count >= 1, p + ': the gate matched no join / split / walk function (it would pass vacuously)');
    assert.deepEqual(r.bad, [], p + ': self-calling function(s)');
  }
});

test('MS-8a control: a copy where one join / split / walk function calls itself FAILS the gate', () => {
  for (const p of [SRC, join(HERE, 'walker.mjs')]) {
    const src = readFileSync(p, 'utf8');
    const f = functionsOf(src)[0];
    assert.ok(f, p + ': no function to mutate');
    // functionsOf works on the noise-stripped text, whose offsets equal the source's (strings keep their quotes only):
    // locate the same header in the raw text instead.
    const hdr = new RegExp('(?:\\bfunction\\s+' + f.name.replace(/\$/g, '\\$') + '\\s*\\(|^[ \\t]*(?:static\\s+|async\\s+)*' + f.name.replace(/\$/g, '\\$') + '\\s*\\([^()\\n]*\\)\\s*\\{)', 'm').exec(src);
    assert.ok(hdr, 'header of ' + f.name);
    const at = src.indexOf('{', hdr.index + hdr[0].length - (hdr[0].endsWith('{') ? 1 : 0));
    const mutated = src.slice(0, at + 1) + '\n  ' + f.name + '();\n' + src.slice(at + 1);
    const r = selfCallers(mutated);
    assert.ok(r.bad.includes(f.name), p + ': the self-call in ' + f.name + ' was not detected: ' + JSON.stringify(r));
  }
});

// ---- MS-8 (b): poisoned join stack ----
const POISON = -12345;

function poisonRun(withAppend) {
  const stackName = needAnchor('joinStack');
  assert.equal(typeof stackName, 'string', 'ANCHORS.joinStack must be a field name string');
  const B = 4;
  const f = engineFactory(60, { leafSize: B, dims: 1 }, 2, undefined);
  const [a, b] = f.views;
  for (let i = 0; i < 40; i++) a.insertAt(i, i, 1); // ~ B=4 leaves: a deep tree
  for (let i = 0; i < 4; i++) b.insertAt(i, 100 + i, 1); // one leaf: the join descends a's spine
  const stack = a._ar[stackName];
  assert.ok(stack && typeof stack.fill === 'function' && stack.length > 0, 'view._ar.' + stackName + ' is not a typed array');
  stack.fill(POISON);
  const K = SumSequence.COUNTERS;
  const c0 = new Int32Array(12), c1 = new Int32Array(12);
  a.readCounters(c0);
  if (withAppend) a.append(b);
  a.readCounters(c1);
  return { stack, d: c1[K.joinSteps] - c0[K.joinSteps] };
}

test('MS-8b poisoned join stack: after a join descending d >= 2 levels, entries [0, d) were written', () => {
  const { stack, d } = poisonRun(true);
  assert.ok(d >= 2, 'scenario must descend >= 2 levels, joinSteps delta ' + d);
  for (let i = 0; i < d; i++) assert.notEqual(stack[i], POISON, 'join stack entry ' + i + ' of ' + d + ' never written');
});

test('MS-8b control: the same check on a refilled stack with no append FAILS (entries still poison)', () => {
  const { stack } = poisonRun(false);
  let untouched = 0;
  for (let i = 0; i < 2; i++) if (stack[i] === POISON) untouched++;
  assert.equal(untouched, 2, 'control: poison must still be in place');
});

// ---- join stack size: a stack with HL - 1 entries fails the seam path of an append over a depth-HL left spine ----
test('join stack of HL - 1 entries FAILS a B=8 seam-path append whose other has its first leaf at depth HL (real build passes)', () => {
  const real = good(runChild('jsize', null, { h: 12 }), 'real');
  assert.equal(real.db, real.HL, 'attainment: d_b ' + real.db + ' vs HL ' + real.HL + ' (W ' + real.W + ', H(W) ' + real.Hw + ')');
  assert.equal(real.walk, null, 'real build: walker ' + real.walk);
  assert.equal(real.answers, true);
  const mut = runChild('jsize', needAnchor('joinAlloc'), { h: 12 });
  const v = mut.verdict;
  // killed = the child timed out, died, threw, or reported a walker failure / wrong answers
  const killed = mut.timedOut || mut.status !== 0 || v === null || v.threw === true || v.walk !== null || v.answers !== true;
  assert.ok(killed, 'the HL - 1 join stack survived: ' + JSON.stringify(v));
});

// ---- C-23 mirror: sstack of HL - 1 entries fails the same seam path with this's last leaf at depth HL ----
test('split stack of HL - 1 entries FAILS a B=8 seam-path append whose this has its last leaf at depth HL (real build passes)', () => {
  const real = good(runChild('jsizeR', null, { h: 12 }), 'real');
  assert.equal(real.da, real.HL, 'attainment: d_a ' + real.da + ' vs HL ' + real.HL + ' (W ' + real.W + ')');
  assert.equal(real.walk, null, 'real build: walker ' + real.walk);
  assert.equal(real.answers, true);
  const mut = runChild('jsizeR', needAnchor('splitAlloc'), { h: 12 });
  const v = mut.verdict;
  const killed = mut.timedOut || mut.status !== 0 || v === null || v.threw === true || v.walk !== null || v.answers !== true;
  assert.ok(killed, 'the HL - 1 split stack survived: ' + JSON.stringify(v));
});

// ---- MS-8 mutant: a recursive ygJoin is killed by (a) the static gate and (b) the poisoned stack ----
test('MS-8 mutant (recursive ygJoin): (a) the static self-call gate FAILS on its source', () => {
  const src = patchSource(readFileSync(SRC, 'utf8'), needAnchor('ms8'));
  const r = selfCallers(src);
  assert.ok(r.bad.includes('ygJoin'), 'static gate missed the recursive ygJoin: ' + JSON.stringify(r));
});

test('MS-8 mutant (recursive ygJoin): (b) entries [0, d) of the join stack stay poisoned', () => {
  const { d } = poisonRun(true);
  assert.ok(d >= 2);
  const real = good(runChild('poison', null, { stack: needAnchor('joinStack'), d }), 'real');
  assert.equal(real.untouched, 0, 'real build: poison left in [0, d)');
  const mut = runChild('poison', needAnchor('ms8'), { stack: needAnchor('joinStack'), d });
  const v = mut.verdict;
  const killed = mut.timedOut || mut.status !== 0 || v === null || v.threw === true || v.untouched > 0;
  assert.ok(killed, 'recursive join still wrote the whole stack prefix: ' + JSON.stringify(v));
});
