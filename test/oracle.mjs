// test/oracle.mjs -- plain-array reference model of SumSequence (test harness).
//
// Role: an INDEPENDENT oracle for the engine (decisions/0005 C-29). It imports
// nothing and shares no code or geometry with Yggdrasil.js: one array of
// entities plus one plain array per dim, every query a linear scan over the
// TRUE definition. Not a hot path: clarity beats speed, allocation is fine.
//
// Rules it models (0005 wins over older text):
//   C-9   entity domain [0, 2^30-1]: typeof e === 'number' && (e & 0x3FFFFFFF) === e;
//         -0 stored as 0.
//   C-10  check order before the first write: index, entity, dim, measures (M-3,
//         slots < dims), extra slots (slots >= dims must be undefined;
//         present-as-undefined is legal), headroom. Indexes validated, never
//         clamped (typeof + integer; -0 acts as 0).
//         Order choices C-10 does not place, pinned by test/Oracle.test.mjs:
//         splitAt validates index before operand; indexAtSum validates dim
//         before seek; -0 acts as 0 for both index and dim.
//
// Deliberately NOT modeled:
//   (a) capacity -- its C-10 slot sits between extra slots and headroom. The
//       lane driver owns the `live + 1 > C` check and must apply it BEFORE
//       calling the oracle (the oracle would accept that insert).
//   (b) the "operand from another arena" rule (0004 A-3): there is no arena
//       here, so any same-dims Oracle is a legal operand.
//   C-12  getMeasure(i, d) -> number, entityAt(i) -> entity, removeAt(i) -> entity,
//         total(d) -> number.
//   C-29  plain-array model per RESEARCH I-3 / I-4 and 0002 M-1..M-8.
//   M-1   measures are integers 0 <= m <= MAX = 2^53-1.   M-2  -0 stored as +0.
//   M-3   one error class (RangeError), no coercion, no valueOf / toString call:
//         typeof, then !(m >= 0 && m <= MAX) (NaN fails), then the integer test.
//   M-4   total_d <= MAX after every op: insert m > MAX - total_d; setMeasure
//         m_new > MAX - (total_d - m_old); append tR_d > MAX - tL_d.
//   M-5   validate everything before the first write: a rejected op leaves this
//         model (and `out` / `other`) unchanged.
//   M-6   integers <= MAX add exactly, so every scan sum is exact.
//   M-7   indexAtSum(d, y) = smallest i with S_i + m_i > y (STRICT), else length.
//   M-8   seek y accepted iff typeof number && y >= 0 && y !== Infinity
//         (fractional ok; finite y > total -> length).
//   A-4   (0004) splitAt(i, out): this keeps [0, i), out gets [i, length).
//         append(other): this := this ++ other, other := empty. Both return this.
//
// Every rejection is a RangeError whose message starts with exactly one check
// token and a space: index, entity, dim, measure, extra, headroom, seek, operand,
// dims. Messages never embed an argument (no string conversion of user input).
// ASCII only.

export const MAX = 9007199254740991; // 2^53-1

function oracleFail(token, detail) {
  throw new RangeError(token + ' ' + detail);
}

function oracleIsInt(x) {
  return typeof x === 'number' && Number.isInteger(x);
}

// M-3: typeof, then range (NaN fails), then the integer test.
function oracleCheckMeasure(m) {
  if (typeof m !== 'number') oracleFail('measure', 'must be a number');
  if (!(m >= 0 && m <= MAX)) oracleFail('measure', 'must be in [0, 2^53-1]');
  if (!Number.isInteger(m)) oracleFail('measure', 'must be an integer');
}

function oracleSum(col, from, to) {
  let s = 0;
  for (let k = from; k < to; k++) s += col[k];
  return s;
}

export class Oracle {
  #dims;
  #ent;
  #m;
  #ci; // model cursor index: -1 = invalid (K-R1, 0005 C-6 / C-7 / R-E3)
  #cur; // the ONE model cursor object (identity stable)

  constructor(dims = 1) {
    if (!oracleIsInt(dims) || dims < 1 || dims > 4) {
      oracleFail('dims', 'must be an integer in 1..4');
    }
    this.#dims = dims;
    this.#ent = [];
    this.#m = [];
    for (let d = 0; d < dims; d++) this.#m.push([]);
    this.#ci = -1;
    const self = this;
    this.#cur = {
      get valid() { return self.#ci >= 0; },
      get index() { return self.#ci; },
      get entity() { return self.#ci >= 0 ? self.#ent[self.#ci] : -1; },
      // dim checked first (valid or not), then NaN when invalid
      offset(d) {
        const dd = self.#dim(d);
        return self.#ci >= 0 ? oracleSum(self.#m[dd], 0, self.#ci) : NaN;
      },
      measure(d) {
        const dd = self.#dim(d);
        return self.#ci >= 0 ? self.#m[dd][self.#ci] : NaN;
      },
      // i in [0, length] (token 'index'); i = length leaves the cursor invalid (R-E3)
      seekIndex(i) {
        const at = self.#index(i, true);
        self.#ci = at < self.#ent.length ? at : -1;
        return self.#ci >= 0;
      },
      // dim then y (M-8), then the indexAtSum answer; y >= total leaves it invalid (R-E3)
      seekSum(d, y) {
        const k = self.indexAtSum(d, y);
        self.#ci = k < self.#ent.length ? k : -1;
        return self.#ci >= 0;
      },
    };
  }

  // K-R1: the one model cursor of this Oracle. Every successful mutator invalidates it AFTER its checks;
  // a rejected mutation and every read leave it unchanged (C-6).
  cursor() {
    return this.#cur;
  }

  get dims() {
    return this.#dims;
  }

  get length() {
    return this.#ent.length;
  }

  // ---- validation (read-only) ---------------------------------------------

  // Index in [0, length) (closed === false) or [0, length] (closed === true).
  #index(i, closed) {
    if (!oracleIsInt(i)) oracleFail('index', 'must be an integer');
    const n = this.#ent.length;
    if (i < 0 || (closed ? i > n : i >= n)) oracleFail('index', 'out of range');
    return i + 0;
  }

  #dim(d) {
    if (!oracleIsInt(d) || d < 0 || d >= this.#dims) {
      oracleFail('dim', 'must be an integer in [0, dims)');
    }
    return d + 0;
  }

  #operand(o, needEmpty) {
    if (typeof o !== 'object' || o === null || !(#ent in o)) {
      oracleFail('operand', 'must be an Oracle');
    }
    if (o === this) oracleFail('operand', 'must not be this');
    if (needEmpty && o.#ent.length !== 0) oracleFail('operand', 'out must be empty');
    if (o.#dims !== this.#dims) oracleFail('operand', 'dims differ');
  }

  // ---- mutation ------------------------------------------------------------

  insertAt(i, e, m0, m1, m2, m3) {
    const at = this.#index(i, true);
    if (!(typeof e === 'number' && (e & 0x3FFFFFFF) === e)) {
      oracleFail('entity', 'must be an integer in [0, 2^30-1]');
    }
    const dims = this.#dims;
    const slots = [m0, m1, m2, m3];
    for (let d = 0; d < dims; d++) oracleCheckMeasure(slots[d]);
    for (let d = dims; d < 4; d++) {
      if (slots[d] !== undefined) oracleFail('extra', 'slot beyond dims must be undefined');
    }
    for (let d = 0; d < dims; d++) {
      if (slots[d] > MAX - this.total(d)) oracleFail('headroom', 'total would exceed 2^53-1');
    }
    // first write
    this.#ci = -1;
    this.#ent.splice(at, 0, e + 0);
    for (let d = 0; d < dims; d++) this.#m[d].splice(at, 0, slots[d] + 0);
    return undefined;
  }

  removeAt(i) {
    const at = this.#index(i, false);
    const e = this.#ent[at];
    this.#ci = -1;
    this.#ent.splice(at, 1);
    for (let d = 0; d < this.#dims; d++) this.#m[d].splice(at, 1);
    return e;
  }

  setMeasure(i, d, m) {
    const at = this.#index(i, false);
    const dd = this.#dim(d);
    oracleCheckMeasure(m);
    const old = this.#m[dd][at];
    if (m > MAX - (this.total(dd) - old)) oracleFail('headroom', 'total would exceed 2^53-1');
    this.#ci = -1;
    this.#m[dd][at] = m + 0;
  }

  splitAt(i, out) {
    const at = this.#index(i, true);
    this.#operand(out, true);
    // first write
    this.#ci = -1;
    out.#ci = -1;
    out.#ent = this.#ent.slice(at);
    this.#ent.length = at;
    for (let d = 0; d < this.#dims; d++) {
      out.#m[d] = this.#m[d].slice(at);
      this.#m[d].length = at;
    }
    return this;
  }

  append(other) {
    this.#operand(other, false);
    for (let d = 0; d < this.#dims; d++) {
      if (other.total(d) > MAX - this.total(d)) oracleFail('headroom', 'total would exceed 2^53-1');
    }
    // first write
    this.#ci = -1;
    other.#ci = -1;
    for (const e of other.#ent) this.#ent.push(e);
    other.#ent = [];
    for (let d = 0; d < this.#dims; d++) {
      for (const m of other.#m[d]) this.#m[d].push(m);
      other.#m[d] = [];
    }
    return this;
  }

  clear() {
    this.#ci = -1;
    this.#ent = [];
    for (let d = 0; d < this.#dims; d++) this.#m[d] = [];
  }

  // ---- queries -------------------------------------------------------------

  getMeasure(i, d) {
    const at = this.#index(i, false);
    const dd = this.#dim(d);
    return this.#m[dd][at];
  }

  entityAt(i) {
    return this.#ent[this.#index(i, false)];
  }

  total(d) {
    const dd = this.#dim(d);
    return oracleSum(this.#m[dd], 0, this.#ent.length);
  }

  sumBefore(d, i) {
    const at = this.#index(i, true);
    const dd = this.#dim(d);
    return oracleSum(this.#m[dd], 0, at);
  }

  indexAtSum(d, y) {
    const dd = this.#dim(d);
    if (!(typeof y === 'number' && y >= 0 && y !== Infinity)) {
      oracleFail('seek', 'must be a number in [0, Infinity)');
    }
    const col = this.#m[dd];
    const n = this.#ent.length;
    let acc = 0;
    for (let k = 0; k < n; k++) {
      if (acc + col[k] > y) return k;
      acc += col[k];
    }
    return n;
  }

  dump() {
    const measures = [];
    for (let d = 0; d < this.#dims; d++) measures.push(this.#m[d].slice());
    return { entities: this.#ent.slice(), measures };
  }
}
