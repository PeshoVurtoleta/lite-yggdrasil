// test/torture-jit.mjs -- the C-4 (A11-2) NIL-guard bytecode-presence gate (PLAN-G2 TASK 7; ADR 0005 C-4).
// DETERMINISTIC and untimed: no quiet-lock (PLAN-G2 OA-3). NOT a *.test file, so `node --test test/*.test.mjs`
// does not load it; test/torture.mjs imports runJit() dynamically in its `jit` branch (OA-1).
//
// What it gates: dropping `ref !== YG_NIL && ` from the 5 finger guards (insertAt, removeAt, setMeasure, getMeasure,
// entityAt) is behaviorally EQUIVALENT (llen[~0] = llen[-1] reads undefined, every comparison after it is false), so
// no behavioral test can kill it; test/Finger.test.mjs only pins the anchor count (5) textually. This gate adds what
// the textual pin cannot: each of the 5 named functions really carries the guard in its compiled bytecode.
//
// How (relative, never pinned to a V8 output format):
// - Two builds on the SAME node binary: LIVE (default ../Yggdrasil.js) and NILDROPPED (buildMutant of ../Yggdrasil.js
//   with [['ref !== YG_NIL && ', '', 5]], exact count, temp copy, removed after). One child per (build, fn):
//   `node --print-bytecode --print-bytecode-filter=<fn>` running DRIVER, which calls <fn> on a NIL finger (an
//   append() target: non-empty, _fl === YG_NIL) and then on the warmed finger, and exits 1 unless both states were
//   reached (so a driver that never compiles <fn> is a FAIL, not a pass).
// - Per dump, keep the instruction lines of the FIRST bytecode block of <fn> and normalize each to its mnemonic +
//   operands, masking everything that an inserted instruction shifts: hex addresses, `@ offset`, bracketed integers
//   (jump displacements, feedback / context slots) and constant-pool indices (`[15:"x"]` -> `[:"x"]`).
// - The guard signature is DERIVED at run time: an LCS diff NILDROPPED -> LIVE of the normalized sequences. The rule
//   (each clause fails closed):
//     R1 both dumps non-empty (vacuity: a filter that yields no bytecode is FAIL);
//     R2 exactly ONE hunk that is not a pure register rename (the mutation is one local edit; any other difference
//        means the builds differ in more than the guard and the diff cannot be attributed to it). A RENAME hunk has
//        equal-length sides that match line for line once register names are masked: dropping the guard lets the
//        register optimizer read an alias of the same value (insertAt: `Ldar r16` for `Ldar r1`, k = at), which
//        changes no instruction, only which equal register it names;
//     R3 the hunk's LIVE side is non-empty, longer than its NILDROPPED side (the guard adds code; the NILDROPPED side
//        may hold a register-optimizer rename of the next operand) and at most MAX_SIG lines (the guard is one
//        compare + branch, not a block);
//     R4 the LIVE side names the NIL binding, whose identifier is parsed from the ANCHOR text itself (YG_NIL), so the
//        rule depends on the source, not on a V8 mnemonic; V8 prints a module binding's name with its hole check.
//        A future V8 that elides that check fails R4 closed (FAIL, never a silent pass) -- re-derive the rule then.
//   live    = the derived signature (the LIVE side, as a contiguous run) is found in the LIVE dump;
//   dropped = the same run is found in the NILDROPPED dump;
//   ok      = R1..R4 && live && !dropped.
// - Why not --trace-deopt: the llen[-1] read is never a deopt (PLAN-G2 SPEC; TASK 0b logs under
//   .handoff/evidence/g2/b3/ are the REPORTED proof), so a deopt trace has no teeth here.
//
// Controls with teeth (logs under .handoff/evidence/g2/b3/, driver controls.mjs there): `--live <nilDropped copy>`
// FAILs 5/5 (no hunk, R2 hunks=0); `--live <getMeasure-only mutant>` FAILs exactly the getMeasure row.
//
// Interface: export async function runJit(opts) -> { ok, rows }, rows[i] = { fn, live, dropped, ok, sig, renames, reason }.
// opts.live = path of the build gated as live (default ../Yggdrasil.js). Standalone: `node test/torture-jit.mjs
// [--live <path>]` prints one row per fn + a GATE line; exit code 1 on FAIL.
//
// ASCII-only. MIT (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildMutant } from './mutant-build.mjs';

const HERE = (p) => fileURLToPath(new URL(p, import.meta.url));
const ENGINE = HERE('../Yggdrasil.js');
export const FNS = ['insertAt', 'removeAt', 'setMeasure', 'getMeasure', 'entityAt'];
export const ANCHOR = 'ref !== YG_NIL && ';
const NIL_NAME = /!==\s*([A-Za-z_$][\w$]*)/.exec(ANCHOR)[1]; // 'YG_NIL', from the source anchor (R4)
const MAX_SIG = 8;
const CHILD_MS = 60000;

// The child: one view `a` of a 2-view arena; nil() leaves `a` non-empty with a NIL finger (append clears both
// fingers, Yggdrasil.js append). Each op runs once on the NIL finger, once warmed (finger set by the first call).
const DRIVER = [
  "const { SumSequence } = await import(process.env.YGG_JIT_BUILD);",
  "const [a, b] = SumSequence.arena(256, { dims: 1 }, 2);",
  "let nils = 0, warms = 0;",
  "const nil = () => { a.clear(); b.clear(); for (let i = 0; i < 8; i++) b.insertAt(i, i + 1, 2); a.append(b);",
  "  if (a._fl === 0 && a.length === 8) nils++; };",
  "const warm = () => { if (a._fl !== 0) warms++; };",
  "nil(); a.insertAt(3, 99, 1); warm(); a.insertAt(3, 98, 1); warm();",
  "nil(); a.removeAt(3); warm(); a.removeAt(3); warm();",
  "nil(); a.setMeasure(3, 0, 7); warm(); a.setMeasure(3, 0, 6); warm();",
  "nil(); a.getMeasure(3, 0); warm(); a.getMeasure(3, 0); warm();",
  "nil(); a.entityAt(3); warm(); a.entityAt(3); warm();",
  "if (nils !== 5 || warms !== 10) { console.error('DRIVER nils=' + nils + ' warms=' + warms); process.exit(1); }",
].join('\n');

const INSN = /@\s*\d+ : (?:[0-9a-f]{2} )+\s*(\S.*)$/;

// One bytecode dump of `fn` from `build`: the normalized instruction lines of the first block, or an error reason.
function dump(build, fn) {
  const r = spawnSync(process.execPath,
    ['--print-bytecode', '--print-bytecode-filter=' + fn, '--input-type=module', '-e', DRIVER],
    { env: { ...process.env, NODE_OPTIONS: '', YGG_JIT_BUILD: pathToFileURL(build).href },
      encoding: 'utf8', timeout: CHILD_MS, killSignal: 'SIGKILL', maxBuffer: 1 << 26 });
  if (r.error || r.status !== 0) {
    return { lines: [], reason: 'child ' + (r.error ? r.error.code : 'status ' + r.status + ' ' + r.signal) +
      ' ' + String(r.stderr).trim().split('\n').slice(-1)[0] };
  }
  const src = r.stdout.split('\n');
  const head = '[generated bytecode for function: ' + fn + ' ';
  let i = 0;
  while (i < src.length && !src[i].startsWith(head)) i++;
  const lines = [];
  let started = false;
  for (i++; i < src.length; i++) {
    const m = INSN.exec(src[i]);
    if (m === null) { if (started) break; continue; }
    started = true;
    lines.push(m[1].replace(/0x[0-9a-f]+/g, '0x').replace(/@\s*\d+/g, '@')
      .replace(/\[\d+\]/g, '[]').replace(/\[\d+:/g, '[:').trimEnd());
  }
  return { lines, reason: lines.length === 0 ? 'no bytecode for ' + fn : '' };
}

// LCS edit script a -> b, grouped into hunks { del: a-lines, add: b-lines }. Cold test code (O(n*m) table).
function hunks(a, b) {
  const n = a.length, m = b.length, w = m + 1;
  const t = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      t[i * w + j] = a[i] === b[j] ? t[(i + 1) * w + j + 1] + 1 : Math.max(t[(i + 1) * w + j], t[i * w + j + 1]);
    }
  }
  const out = [];
  let cur = null, i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { cur = null; i++; j++; continue; }
    if (cur === null) { cur = { del: [], add: [] }; out.push(cur); }
    if (j < m && (i === n || t[i * w + j + 1] >= t[(i + 1) * w + j])) cur.add.push(b[j++]);
    else cur.del.push(a[i++]);
  }
  return out;
}

const REG = (s) => s.replace(/\br\d+\b/g, 'r');
function isRename(h) {
  if (h.del.length !== h.add.length) return false;
  for (let i = 0; i < h.del.length; i++) if (REG(h.del[i]) !== REG(h.add[i])) return false;
  return true;
}

function hasRun(hay, run) {
  if (run.length === 0) return false;
  for (let i = 0; i + run.length <= hay.length; i++) {
    let k = 0;
    while (k < run.length && hay[i + k] === run[k]) k++;
    if (k === run.length) return true;
  }
  return false;
}

function row(fn, L, D) {
  const r = { fn, live: false, dropped: false, ok: false, sig: [], renames: 0, reason: '' };
  if (L.reason !== '' || D.reason !== '') { r.reason = 'R1 ' + (L.reason || D.reason); return r; }
  const all = hunks(D.lines, L.lines);
  const h = all.filter((x) => !isRename(x));
  r.renames = all.length - h.length;
  if (h.length !== 1) { r.reason = 'R2 hunks=' + h.length + ' renames=' + r.renames; return r; }
  const { add, del } = h[0];
  if (!(add.length > del.length && add.length <= MAX_SIG)) {
    r.reason = 'R3 add=' + add.length + ' del=' + del.length; return r;
  }
  if (!add.some((s) => s.includes('"' + NIL_NAME + '"'))) { r.reason = 'R4 no ' + NIL_NAME + ' in hunk'; return r; }
  r.sig = add;
  r.live = hasRun(L.lines, add);
  r.dropped = hasRun(D.lines, add);
  r.ok = r.live && !r.dropped;
  if (!r.ok) r.reason = 'live=' + r.live + ' dropped=' + r.dropped;
  return r;
}

export async function runJit(opts = {}) {
  const live = resolve(opts.live === undefined ? ENGINE : opts.live);
  if (!existsSync(live)) throw new Error('runJit: live build not found: ' + live);
  const mu = await buildMutant(ENGINE, [[ANCHOR, '', 5]]);
  const rows = [];
  try {
    for (const fn of FNS) rows.push(row(fn, dump(live, fn), dump(mu.file, fn)));
  } finally {
    mu.cleanup();
  }
  return { ok: rows.length === FNS.length && rows.every((r) => r.ok), rows };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const k = process.argv.indexOf('--live');
  const res = await runJit(k > 0 ? { live: process.argv[k + 1] } : {});
  for (const r of res.rows) {
    console.log('  ' + (r.ok ? 'ok  ' : 'FAIL') + ' ' + r.fn + ' live=' + r.live + ' dropped=' + r.dropped +
      ' renames=' + r.renames + (r.reason ? ' (' + r.reason + ')' : '') + ' sig=' + JSON.stringify(r.sig));
  }
  const n = res.rows.filter((r) => r.ok).length;
  console.log('GATE jit nil-guard ' + n + '/' + FNS.length + ' | ' + (res.ok ? 'ok' : 'FAIL'));
  if (!res.ok) process.exitCode = 1;
}
