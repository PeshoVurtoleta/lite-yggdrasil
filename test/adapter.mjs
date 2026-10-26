// test/adapter.mjs -- engine adapter for the harness lanes (ADR 0005 C-44).
//
//   engineFactory(C, { leafSize, dims }, count, cfg) -> { views, snapshot() }
//     Same signature as the stub factories in test/stubs.mjs. `views` is the
//     array from SumSequence.arena(C, o, count). snapshot() returns a fresh
//     plain object in the test/walker.mjs header contract (C-27), every array
//     a deep copy (no aliasing of any engine column). cfg must be undefined or
//     a key-less plain object; any key is a RangeError whose message has 'cfg'
//     (the engine takes none). NIL and EMPTY_ROOT are read from the fresh
//     views, never written as literals (C-27).
//
// Layout read (C-44), each item from exactly ONE place and fail closed: the
// constants C, B, dims, Lmax from views[0]._ar; hdr (Int32Array(5) [live, lbump,
// lfree, ibump, ifree], END = -1) and every column from views[0] as '_' + name:
// _left, _right, _weight, _count, _inext, _sums[d], _llen, _lnext, _ent,
// _meas[d]. A missing field throws 'engine column X not found (C-44)'.
//
// ASCII-only. MIT (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>

import * as Y from '../Yggdrasil.js';

function col(v, name) {
  const x = v['_' + name];
  if (x === undefined) throw new Error('adapter: engine column ' + name + ' not found (C-44)');
  return x;
}

export function engineFactory(C, o, count, cfg) {
  if (cfg !== undefined) {
    if (cfg === null || typeof cfg !== 'object' || Array.isArray(cfg)) {
      throw new RangeError('cfg must be undefined or a plain object');
    }
    const keys = Reflect.ownKeys(cfg);
    if (keys.length > 0) throw new RangeError('cfg takes no keys (found ' + String(keys[0]) + ')');
  }
  const views = Y.SumSequence.arena(C, o, count);
  const v0 = views[0];
  const NIL = v0._fl;
  const EMPTY_ROOT = v0._root;
  const ar = v0._ar;
  const dims = ar.dims;
  const B = ar.B;

  function snapshot() {
    const hdr = col(v0, 'hdr');
    const Lmax = ar.Lmax;
    const leaf = {
      size: Lmax, bump: hdr[1], free: hdr[2],
      next: col(v0, 'lnext').slice(), len: col(v0, 'llen').slice(),
      ent: col(v0, 'ent').slice(), meas: [],
    };
    const meas = col(v0, 'meas');
    const sums = col(v0, 'sums');
    for (let d = 0; d < dims; d++) leaf.meas.push(meas[d].slice());
    const int = {
      size: Lmax - 1, bump: hdr[3], free: hdr[4],
      next: col(v0, 'inext').slice(),
      left: col(v0, 'left').slice(), right: col(v0, 'right').slice(),
      weight: col(v0, 'weight').slice(), count: col(v0, 'count').slice(),
      sum: [],
    };
    for (let d = 0; d < dims; d++) int.sum.push(sums[d].slice());
    const vs = [];
    for (let i = 0; i < views.length; i++) {
      const w = views[i];
      vs.push({
        _root: w._root, _len: w._len, _fl: w._fl, _fb: w._fb, _fdepth: w._fdepth,
        _fpath: new Int32Array(w._fpath), _cv: w._cv,
      });
    }
    return {
      C: ar.C, B: B, dims: dims, NIL: NIL, EMPTY_ROOT: EMPTY_ROOT, live: hdr[0],
      int: int, leaf: leaf, views: vs,
    };
  }

  return { views: views, snapshot: snapshot };
}
