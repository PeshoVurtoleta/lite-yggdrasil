// benchmark/rivals/variant.mjs -- build a BlockedArray variant by count-checked text replacement.
//
// MIT (c) Zahary Shinikchiev <shinikchiev@yahoo.com>
//
// loadVariant(name, extraHunks?) reads benchmark/rivals/BlockedArray.js, applies the variant's hunks
// and then extraHunks (each [anchor, replacement]; the anchor must occur EXACTLY once in the text it
// is applied to, else this throws -- a drifted anchor never yields a silent identity variant), and
// imports the result from a data: URL. Returns the module namespace ({ BlockedArray }).
//
// Variants (RESEARCH 12.3, the unroll hypothesis):
//   'unrolled' -- the file as written (identity; _locate and indexAtSum carry the 4x-unrolled
//                 directory loop).
//   'plain'    -- the 4x-unrolled block of _locate and of indexAtSum removed, so each falls through to
//                 its plain stride-1 tail loop over the whole directory. sumBefore's directory loop is
//                 already plain in the draft; its anchor is still count-checked (identity hunk) so an
//                 edit that unrolls it later makes 'plain' throw instead of silently staying unrolled.
// Cold: build-time text work only; nothing here runs on a measured path.

import { readFileSync } from 'node:fs';

const BA_SOURCE_URL = new URL('./BlockedArray.js', import.meta.url);

const ANCHOR_LOCATE_UNROLLED =
  '    const n4 = n - 3;\n' +
  '    while (dirIdx < n4) {\n' +
  '      const s0 = dirSize[dirIdx];\n' +
  '      if (rem < s0) { this._n[C_DIR_SCANS] = (this._n[C_DIR_SCANS] + dirIdx + 1) | 0; this._locDir = dirIdx; this._locLocal = rem; return; }\n' +
  '      rem -= s0;\n' +
  '\n' +
  '      const s1 = dirSize[dirIdx + 1];\n' +
  '      if (rem < s1) { this._n[C_DIR_SCANS] = (this._n[C_DIR_SCANS] + dirIdx + 2) | 0; this._locDir = dirIdx + 1; this._locLocal = rem; return; }\n' +
  '      rem -= s1;\n' +
  '\n' +
  '      const s2 = dirSize[dirIdx + 2];\n' +
  '      if (rem < s2) { this._n[C_DIR_SCANS] = (this._n[C_DIR_SCANS] + dirIdx + 3) | 0; this._locDir = dirIdx + 2; this._locLocal = rem; return; }\n' +
  '      rem -= s2;\n' +
  '\n' +
  '      const s3 = dirSize[dirIdx + 3];\n' +
  '      if (rem < s3) { this._n[C_DIR_SCANS] = (this._n[C_DIR_SCANS] + dirIdx + 4) | 0; this._locDir = dirIdx + 3; this._locLocal = rem; return; }\n' +
  '      rem -= s3;\n' +
  '\n' +
  '      dirIdx += 4;\n' +
  '    }\n' +
  '\n';

const ANCHOR_INDEXATSUM_UNROLLED =
  '    const n4 = n - 3;\n' +
  '    while (dirIdx < n4) {\n' +
  '      const s0 = dirSums[sumBase + dirIdx];\n' +
  '      if (rem < s0) break;\n' +
  '      rem -= s0;\n' +
  '      globalIdx += dirSize[dirIdx];\n' +
  '\n' +
  '      const s1 = dirSums[sumBase + dirIdx + 1];\n' +
  '      if (rem < s1) { dirIdx += 1; break; }\n' +
  '      rem -= s1;\n' +
  '      globalIdx += dirSize[dirIdx + 1];\n' +
  '\n' +
  '      const s2 = dirSums[sumBase + dirIdx + 2];\n' +
  '      if (rem < s2) { dirIdx += 2; break; }\n' +
  '      rem -= s2;\n' +
  '      globalIdx += dirSize[dirIdx + 2];\n' +
  '\n' +
  '      const s3 = dirSums[sumBase + dirIdx + 3];\n' +
  '      if (rem < s3) { dirIdx += 3; break; }\n' +
  '      rem -= s3;\n' +
  '      globalIdx += dirSize[dirIdx + 3];\n' +
  '\n' +
  '      dirIdx += 4;\n' +
  '    }\n' +
  '\n';

const ANCHOR_SUMBEFORE_PLAIN =
  '    while (dirIdx < this.dirLen) {\n' +
  '      const sz = dirSize[dirIdx];\n' +
  '      if (rem < sz) break;\n' +
  '      rem -= sz;\n' +
  '      acc += dirSums[sumBase + dirIdx];\n' +
  '      dirIdx++;\n' +
  '    }\n';

export const VARIANTS = Object.freeze({
  unrolled: Object.freeze([]),
  plain: Object.freeze([
    Object.freeze([ANCHOR_LOCATE_UNROLLED, '']),
    Object.freeze([ANCHOR_INDEXATSUM_UNROLLED, '']),
    Object.freeze([ANCHOR_SUMBEFORE_PLAIN, ANCHOR_SUMBEFORE_PLAIN]),
  ]),
});

function variantCount(text, anchor) {
  let n = 0;
  let at = text.indexOf(anchor);
  while (at >= 0) {
    n++;
    at = text.indexOf(anchor, at + 1); // step 1: self-overlapping matches count too
  }
  return n;
}

function variantApply(text, hunks, label) {
  let out = text;
  for (let k = 0; k < hunks.length; k++) {
    const h = hunks[k];
    if (!Array.isArray(h) || h.length !== 2 || typeof h[0] !== 'string' || typeof h[1] !== 'string' || h[0] === '') {
      throw new TypeError('variant ' + label + ' hunk ' + k + ': must be [anchor, replacement] strings, anchor non-empty');
    }
    const n = variantCount(out, h[0]);
    if (n !== 1) {
      throw new Error('variant ' + label + ' hunk ' + k + ': anchor matched ' + n + ' times, expected exactly 1');
    }
    const at = out.indexOf(h[0]);
    out = out.slice(0, at) + h[1] + out.slice(at + h[0].length);
  }
  return out;
}

/** The variant's source text (for inlining-budget-diff driver mode, or a reviewer's diff). */
export function variantSource(name, extraHunks) {
  if (typeof name !== 'string' || !Object.prototype.hasOwnProperty.call(VARIANTS, name)) {
    throw new RangeError('variant must be one of: ' + Object.keys(VARIANTS).join(', '));
  }
  if (extraHunks !== undefined && !Array.isArray(extraHunks)) {
    throw new TypeError('variant extraHunks must be an array of [anchor, replacement]');
  }
  const base = readFileSync(BA_SOURCE_URL, 'utf8');
  const named = variantApply(base, VARIANTS[name], name);
  return extraHunks === undefined ? named : variantApply(named, extraHunks, name + '+extra');
}

/** Import the variant from a data: URL; resolves to its module namespace ({ BlockedArray }). */
export async function loadVariant(name, extraHunks) {
  const src = variantSource(name, extraHunks);
  const url = 'data:text/javascript;base64,' + Buffer.from(src, 'utf8').toString('base64');
  return import(url);
}
