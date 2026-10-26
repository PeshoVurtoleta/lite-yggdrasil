// test/mutant-build.mjs -- exact-count source patches of a temp copy
// (ADR 0005 C-46 M-8: buildMutant; the StubCounts pattern). Test harness only.
//
//   buildMutant(path, patches) -> Promise<{ ...moduleNamespace, cleanup }>
//     patches = [[anchor, replacement, count], ...], applied in order, each on
//     the text left by the previous one. An anchor must occur EXACTLY `count`
//     times (non-overlapping, counted with indexOf) else the call throws an
//     Error naming the anchor and the found count; nothing is written then.
//     The patched source is written to a fresh mkdtemp dir under the same
//     base name, dynamic-imported, and returned with a cleanup() that removes
//     the dir. The source file itself is never modified.
//     Note: a module namespace is frozen, so the result is a plain object
//     copy of its exports plus cleanup (and `dir`, `file`).
//
// ASCII-only. MIT (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

function countOf(hay, needle) {
  let c = 0;
  for (let at = hay.indexOf(needle); at >= 0; at = hay.indexOf(needle, at + needle.length)) c++;
  return c;
}

export async function buildMutant(path, patches) {
  if (typeof path !== 'string') throw new TypeError('buildMutant: path must be a string');
  if (!Array.isArray(patches)) throw new TypeError('buildMutant: patches must be an array');
  let src = readFileSync(path, 'utf8');
  for (let i = 0; i < patches.length; i++) {
    const p = patches[i];
    if (!Array.isArray(p) || p.length !== 3 || typeof p[0] !== 'string' || p[0].length === 0 ||
        typeof p[1] !== 'string' || !Number.isInteger(p[2]) || p[2] < 1) {
      throw new TypeError('buildMutant: patch ' + i + ' must be [anchor, replacement, count>=1]');
    }
    const found = countOf(src, p[0]);
    if (found !== p[2]) {
      throw new Error('buildMutant: anchor ' + JSON.stringify(p[0]) + ' found ' + found +
        ' times, expected ' + p[2]);
    }
    src = src.split(p[0]).join(p[1]);
  }
  const dir = mkdtempSync(join(tmpdir(), 'ygg-mutant-'));
  const file = join(dir, basename(path));
  writeFileSync(file, src);
  let ns;
  try {
    ns = await import(pathToFileURL(file).href);
  } catch (e) {
    rmSync(dir, { recursive: true, force: true });
    throw e;
  }
  const out = { ...ns };
  out.dir = dir;
  out.file = file;
  out.cleanup = () => { rmSync(dir, { recursive: true, force: true }); };
  return out;
}
