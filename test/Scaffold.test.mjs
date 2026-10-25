// test/Scaffold.test.mjs -- package-shape gates for the pre-release scaffold.
//
// Every check is a PURE function over (pkgJson, Map<filename, Buffer>) that
// returns a list of violations (empty = clean). Each check runs twice:
//   (a) on the REAL package on disk  -> must report zero violations;
//   (b) on an in-memory MUTATED copy of a known-good fixture -> must report at
//       least one violation (the must-fail controls).
// A meta-test pins that every check owns at least one must-fail control, so
// deleting a control is itself a failure. ASCII-only.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const SHIPPED = [
  'Yggdrasil.js',
  'Yggdrasil.d.ts',
  'llms.txt',
  'README.md',
  'CHANGELOG.md',
  'LICENSE',
];
const AUTHOR = 'Zahary Shinikchiev';
const EMAIL = ' <shinikchiev@yahoo.com>';
// Assembled from parts so this file never contains the banned name itself.
const BANNED_NAME = ['kara', 'djov'].join('');
const BANNED_CAP = 'K' + BANNED_NAME.slice(1);
const RUNTIME_DEP_KEYS = [
  'dependencies',
  'optionalDependencies',
  'peerDependencies',
  'bundleDependencies',
  'bundledDependencies',
];

// ---- pure checks -----------------------------------------------------------

function checkFilesList(pkg) {
  const out = [];
  const f = pkg.files;
  if (!Array.isArray(f)) return ['files[] is not an array'];
  if (f.length !== SHIPPED.length) {
    out.push('files[] has ' + f.length + ' entries, expected ' + SHIPPED.length);
  }
  if (new Set(f).size !== f.length) out.push('files[] has duplicate entries');
  for (const name of SHIPPED) {
    if (!f.includes(name)) out.push('files[] is missing ' + name);
  }
  for (const name of f) {
    if (!SHIPPED.includes(name)) out.push('files[] has unexpected entry ' + String(name));
  }
  return out;
}

function checkSideEffects(pkg) {
  return pkg.sideEffects === false
    ? []
    : ['sideEffects must be false, got ' + JSON.stringify(pkg.sideEffects)];
}

function checkNoRuntimeDeps(pkg) {
  const out = [];
  for (const key of RUNTIME_DEP_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(pkg, key)) continue;
    const v = pkg[key];
    const empty = Array.isArray(v)
      ? v.length === 0
      : v !== null && typeof v === 'object' && Object.keys(v).length === 0;
    if (!empty) out.push(key + ' must be absent or empty, got ' + JSON.stringify(v));
  }
  return out;
}

function checkAuthorAndName(pkg, files) {
  const out = [];
  const author = typeof pkg.author === 'string'
    ? pkg.author
    : pkg.author && typeof pkg.author.name === 'string' ? pkg.author.name : '';
  if (!author.includes(AUTHOR + EMAIL)) out.push('author must contain "' + AUTHOR + EMAIL + '"');
  if (pkg.license !== 'MIT') out.push('license must be "MIT", got ' + JSON.stringify(pkg.license));
  const lic = files.has('LICENSE') ? files.get('LICENSE').toString('utf8') : '';
  if (!/^MIT License$/m.test(lic)) out.push('LICENSE must contain a "MIT License" line');
  if (!lic.includes(AUTHOR + EMAIL)) out.push('LICENSE must name "' + AUTHOR + EMAIL + '"');
  if (JSON.stringify(pkg).toLowerCase().includes(BANNED_NAME)) {
    out.push('package.json contains the banned name');
  }
  for (const [name, buf] of files) {
    if (buf.toString('latin1').toLowerCase().includes(BANNED_NAME)) {
      out.push(name + ' contains the banned name');
    }
  }
  return out;
}

// Every byte < 0x80, except the exact UTF-8 encodings of U+00D7 (C3 97) and
// U+00B5 (C2 B5). A lone / truncated lead byte is a violation.
function asciiViolation(buf) {
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b < 0x80) continue;
    const n = i + 1 < buf.length ? buf[i + 1] : -1;
    if ((b === 0xc3 && n === 0x97) || (b === 0xc2 && n === 0xb5)) { i++; continue; }
    return i;
  }
  return -1;
}

function checkAscii(pkg, files) {
  const out = [];
  for (const [name, buf] of files) {
    const at = asciiViolation(buf);
    if (at !== -1) {
      out.push(name + ' has a non-ASCII byte 0x' + buf[at].toString(16) + ' at offset ' + at);
    }
  }
  return out;
}

function checkFilesExist(pkg, files) {
  const out = [];
  const f = Array.isArray(pkg.files) ? pkg.files : [];
  if (f.length === 0) out.push('files[] is empty: nothing to verify');
  for (const name of f) {
    if (!files.has(name)) out.push('shipped file missing on disk: ' + String(name));
  }
  return out;
}

// packList: the `path` strings npm pack reports.
function comparePackList(pkg, packList) {
  const out = [];
  const want = new Set([...(Array.isArray(pkg.files) ? pkg.files : []), 'package.json']);
  if (!Array.isArray(packList) || packList.length === 0) return ['npm pack listed no files'];
  if (new Set(packList).size !== packList.length) out.push('pack list has duplicates');
  for (const p of packList) if (!want.has(p)) out.push('pack ships unexpected file ' + p);
  for (const w of want) if (!packList.includes(w)) out.push('pack does not ship ' + w);
  return out;
}

// ns: a module namespace (or a stand-in object).
function checkExports(pkg, ns) {
  const out = [];
  const keys = Object.keys(ns).sort();
  if (keys.length !== 1 || keys[0] !== 'VERSION') {
    out.push('exports must be exactly [VERSION], got ' + JSON.stringify(keys));
  }
  if (ns.VERSION !== pkg.version) {
    out.push('VERSION ' + JSON.stringify(ns.VERSION) + ' !== package.json version ' +
      JSON.stringify(pkg.version));
  }
  return out;
}

// main / module / types and every exports["."] condition must point at a
// shipped file as './<name>'.
function checkEntryPoints(pkg) {
  const out = [];
  const ex = pkg.exports !== null && typeof pkg.exports === 'object' ? pkg.exports['.'] : undefined;
  const plain = ex !== null && typeof ex === 'object' && !Array.isArray(ex) &&
    Object.getPrototypeOf(ex) === Object.prototype;
  if (!plain) out.push('exports["."] must be a plain object');
  else if (Object.keys(ex).length === 0) out.push('exports["."] must not be empty');
  const sites = [['main', pkg.main], ['module', pkg.module], ['types', pkg.types]];
  if (plain) for (const k of Object.keys(ex)) sites.push(['exports["."].' + k, ex[k]]);
  for (const [label, v] of sites) {
    if (typeof v !== 'string' || !v.startsWith('./') || !SHIPPED.includes(v.slice(2))) {
      out.push(label + ' must be "./<shipped file>", got ' + JSON.stringify(v));
    }
  }
  return out;
}

// Version trinity, llms.txt leg (the Yggdrasil.js leg is checkExports).
function checkVersionSites(pkg, files) {
  const out = [];
  const m = /^Version: (\S+)$/m.exec(files.has('llms.txt') ? files.get('llms.txt').toString('utf8') : '');
  if (!m || m[1] !== pkg.version) out.push('llms.txt Version: must equal ' + pkg.version);
  return out;
}

// The names Yggdrasil.d.ts declares must equal the module's runtime exports.
function checkDtsExports(files, ns) {
  const dts = files.has('Yggdrasil.d.ts') ? files.get('Yggdrasil.d.ts').toString('utf8') : '';
  const declared = [...dts.matchAll(/export declare const (\w+)/g)].map((m) => m[1]).sort();
  const actual = Object.keys(ns).sort();
  return JSON.stringify(declared) === JSON.stringify(actual)
    ? []
    : ['Yggdrasil.d.ts declares ' + JSON.stringify(declared) + ', module exports ' +
       JSON.stringify(actual)];
}

const CHECKS = {
  checkFilesList,
  checkSideEffects,
  checkNoRuntimeDeps,
  checkAuthorAndName,
  checkAscii,
  checkFilesExist,
  checkEntryPoints,
  checkVersionSites,
};

// ---- real package ----------------------------------------------------------

const PKG_BYTES = readFileSync(join(ROOT, 'package.json'));
const PKG = JSON.parse(PKG_BYTES.toString('utf8'));

// The map holds package.json plus every name in files[] AND the expected set
// that exists on disk; a missing shipped file is simply absent from the map,
// so checkFilesExist reports it instead of passing vacuously (a directory
// entry counts as missing: files[] names files only).
// The ASCII and banned-name scans also cover repo sources that do not ship:
// test/*.mjs, test/types/*, and the root *.md files.
function listDir(rel, keep) {
  const st = statSync(join(ROOT, rel), { throwIfNoEntry: false });
  if (!st || !st.isDirectory()) return [];
  return readdirSync(join(ROOT, rel)).filter(keep).map((n) => (rel === '.' ? n : rel + '/' + n));
}

function loadRealFiles() {
  const m = new Map();
  m.set('package.json', PKG_BYTES);
  const names = new Set([
    ...SHIPPED,
    ...(Array.isArray(PKG.files) ? PKG.files : []),
    ...listDir('test', (n) => n.endsWith('.mjs')),
    ...listDir('test/types', () => true),
    ...listDir('.', (n) => n.endsWith('.md')),
  ]);
  for (const name of names) {
    const p = join(ROOT, name);
    const st = statSync(p, { throwIfNoEntry: false });
    if (st && st.isFile()) m.set(name, readFileSync(p));
  }
  return m;
}

const REAL_FILES = loadRealFiles();

test('real package: the scan map covers repo sources, not only shipped files', () => {
  for (const n of ['test/Scaffold.test.mjs', 'test/types/smoke.ts', 'test/types/tsconfig.json',
    'ROADMAP.md', 'RESEARCH.md', 'SCOPE.md']) {
    assert.ok(REAL_FILES.has(n), 'scan map is missing ' + n);
  }
});

for (const [name, fn] of Object.entries(CHECKS)) {
  test('real package: ' + name + ' reports no violations', () => {
    assert.deepEqual(fn(PKG, REAL_FILES), []);
  });
}

test('real package: npm pack --dry-run lists exactly files[] + package.json', () => {
  const r = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  assert.equal(r.status, 0, 'npm pack failed: ' + r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.ok(Array.isArray(parsed) && parsed.length === 1, 'expected one pack entry');
  const list = parsed[0].files.map((f) => f.path);
  assert.deepEqual(comparePackList(PKG, list), []);
});

test('real package: the exports map resolves to exactly VERSION === package.json version', async () => {
  const ns = await import('@zakkster/lite-yggdrasil');
  assert.deepEqual(checkExports(PKG, ns), []);
  assert.deepEqual(checkDtsExports(REAL_FILES, ns), []);
});

// ---- must-fail controls ----------------------------------------------------

function goodPkg() {
  return {
    name: '@zakkster/lite-yggdrasil',
    author: 'Zahary Shinikchiev <shinikchiev@yahoo.com>',
    version: '0.0.0',
    license: 'MIT',
    main: './Yggdrasil.js',
    module: './Yggdrasil.js',
    types: './Yggdrasil.d.ts',
    exports: {
      '.': {
        types: './Yggdrasil.d.ts',
        node: './Yggdrasil.js',
        import: './Yggdrasil.js',
        default: './Yggdrasil.js',
      },
    },
    files: SHIPPED.slice(),
    sideEffects: false,
    devDependencies: { typescript: '^7.0.2' },
  };
}

function goodFiles() {
  const m = new Map();
  for (const name of SHIPPED) m.set(name, Buffer.from('plain ascii ' + name + '\n', 'utf8'));
  m.set('llms.txt', Buffer.from('plain ascii llms.txt\nVersion: 0.0.0\n', 'utf8'));
  m.set('LICENSE', Buffer.from('MIT License\nCopyright (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>\n', 'utf8'));
  m.set('Yggdrasil.d.ts', Buffer.from('export declare const VERSION: string;\n', 'utf8'));
  return m;
}

// The clean fixture must pass every check, so each control's failure is
// attributable to its single mutation.
for (const [name, fn] of Object.entries(CHECKS)) {
  test('fixture baseline: ' + name + ' passes on the clean fixture', () => {
    assert.deepEqual(fn(goodPkg(), goodFiles()), []);
  });
}
test('fixture baseline: comparePackList / checkExports / checkDtsExports pass on clean inputs', () => {
  assert.deepEqual(comparePackList(goodPkg(), [...SHIPPED, 'package.json']), []);
  assert.deepEqual(checkExports(goodPkg(), { VERSION: '0.0.0' }), []);
  assert.deepEqual(checkDtsExports(goodFiles(), { VERSION: '0.0.0' }), []);
});

// Each control: [check name, label, () => violations]. Every entry MUST fail.
const CONTROLS = [
  ['checkFilesList', '7-entry files[]', () => {
    const p = goodPkg(); p.files.push('demo/index.html');
    return checkFilesList(p);
  }],
  ['checkFilesList', '5-entry files[]', () => {
    const p = goodPkg(); p.files = p.files.filter((f) => f !== 'LICENSE');
    return checkFilesList(p);
  }],
  ['checkSideEffects', 'sideEffects: true', () => {
    const p = goodPkg(); p.sideEffects = true;
    return checkSideEffects(p);
  }],
  ['checkSideEffects', 'sideEffects missing', () => {
    const p = goodPkg(); delete p.sideEffects;
    return checkSideEffects(p);
  }],
  ['checkNoRuntimeDeps', 'one runtime dependency', () => {
    const p = goodPkg(); p.dependencies = { '@zakkster/lite-signal': '^1.5.0' };
    return checkNoRuntimeDeps(p);
  }],
  ['checkNoRuntimeDeps', 'one optional dependency', () => {
    const p = goodPkg(); p.optionalDependencies = { leftpad: '1.0.0' };
    return checkNoRuntimeDeps(p);
  }],
  ['checkNoRuntimeDeps', 'one peer dependency', () => {
    const p = goodPkg(); p.peerDependencies = { x: '1' };
    return checkNoRuntimeDeps(p);
  }],
  ['checkNoRuntimeDeps', 'bundleDependencies', () => {
    const p = goodPkg(); p.bundleDependencies = ['x'];
    return checkNoRuntimeDeps(p);
  }],
  ['checkNoRuntimeDeps', 'bundledDependencies', () => {
    const p = goodPkg(); p.bundledDependencies = ['x'];
    return checkNoRuntimeDeps(p);
  }],
  ['checkAuthorAndName', 'banned name injected into README.md', () => {
    const f = goodFiles(); f.set('README.md', Buffer.from('# x\n(c) Zahary ' + BANNED_CAP + '\n'));
    return checkAuthorAndName(goodPkg(), f);
  }],
  ['checkAuthorAndName', 'banned name in package.json', () => {
    const p = goodPkg(); p.contributors = ['Z. ' + BANNED_CAP];
    return checkAuthorAndName(p, goodFiles());
  }],
  ['checkAuthorAndName', 'wrong author', () => {
    const p = goodPkg(); p.author = 'Someone Else';
    return checkAuthorAndName(p, goodFiles());
  }],
  ['checkAuthorAndName', 'license ISC', () => {
    const p = goodPkg(); p.license = 'ISC';
    return checkAuthorAndName(p, goodFiles());
  }],
  ['checkAuthorAndName', 'LICENSE holder swapped', () => {
    const f = goodFiles();
    f.set('LICENSE', Buffer.from('MIT License\nCopyright (c) 2026 Someone Else <shinikchiev@yahoo.com>\n'));
    return checkAuthorAndName(goodPkg(), f);
  }],
  ['checkAuthorAndName', 'author email swapped', () => {
    const p = goodPkg(); p.author = 'Zahary Shinikchiev <someone@example.com>';
    return checkAuthorAndName(p, goodFiles());
  }],
  ['checkAuthorAndName', 'LICENSE not MIT', () => { const f = goodFiles(); f.set('LICENSE', Buffer.from('ISC License\nCopyright (c) 2026 Zahary Shinikchiev <shinikchiev@yahoo.com>\n')); return checkAuthorAndName(goodPkg(), f); }],
  ['checkAscii', 'U+2014 em dash in README.md', () => {
    const f = goodFiles(); f.set('README.md', Buffer.from('a ' + String.fromCharCode(0x2014) + ' b\n', 'utf8'));
    return checkAscii(goodPkg(), f);
  }],
  ['checkAscii', 'lone 0xC3 lead byte at end of buffer', () => {
    const f = goodFiles(); f.set('llms.txt', Buffer.from([0x61, 0xc3]));
    return checkAscii(goodPkg(), f);
  }],
  ['checkAscii', 'U+00E9 (C3 A9: same lead byte as U+00D7)', () => {
    const f = goodFiles(); f.set('README.md', Buffer.from([0x61, 0xc3, 0xa9]));
    return checkAscii(goodPkg(), f);
  }],
  ['checkAscii', 'U+00B4 (C2 B4: same lead byte as U+00B5)', () => {
    const f = goodFiles(); f.set('README.md', Buffer.from([0x61, 0xc2, 0xb4]));
    return checkAscii(goodPkg(), f);
  }],
  ['checkEntryPoints', 'exports["."].import typo', () => {
    const p = goodPkg(); p.exports['.'].import = './Yggdrasil.mjs';
    return checkEntryPoints(p);
  }],
  ['checkEntryPoints', 'types deleted', () => {
    const p = goodPkg(); delete p.types;
    return checkEntryPoints(p);
  }],
  ['checkVersionSites', 'llms.txt Version: 0.0.1', () => {
    const f = goodFiles(); f.set('llms.txt', Buffer.from('x\nVersion: 0.0.1\n'));
    return checkVersionSites(goodPkg(), f);
  }],
  ['checkVersionSites', 'llms.txt without a Version line', () => {
    const f = goodFiles(); f.set('llms.txt', Buffer.from('x\n'));
    return checkVersionSites(goodPkg(), f);
  }],
  ['checkFilesExist', 'LICENSE missing from the file map', () => {
    const f = goodFiles(); f.delete('LICENSE');
    return checkFilesExist(goodPkg(), f);
  }],
  ['comparePackList', 'pack list with an extra file', () =>
    comparePackList(goodPkg(), [...SHIPPED, 'package.json', 'test/Scaffold.test.mjs'])],
  ['comparePackList', 'pack list missing README.md', () =>
    comparePackList(goodPkg(), [...SHIPPED.filter((f) => f !== 'README.md'), 'package.json'])],
  ['checkExports', 'fake namespace with an extra export', () =>
    checkExports(goodPkg(), { VERSION: '0.0.0', Tree: function Tree() {} })],
  ['checkExports', 'VERSION differs from package.json version', () =>
    checkExports(goodPkg(), { VERSION: '0.0.1' })],
  ['checkDtsExports', '.d.ts declares an extra Ghost', () => {
    const f = goodFiles();
    f.set('Yggdrasil.d.ts', Buffer.from('export declare const VERSION: string;\nexport declare const Ghost: number;\n'));
    return checkDtsExports(f, { VERSION: '0.0.0' });
  }],
];

for (const [check, label, run] of CONTROLS) {
  test('control MUST fail: ' + check + ' / ' + label, () => {
    const v = run();
    assert.ok(Array.isArray(v) && v.length > 0, 'control passed: ' + check + ' / ' + label);
  });
}

// Positive control: the two allowed non-ASCII code points stay allowed.
test('control MUST pass: checkAscii allows U+00D7 and U+00B5', () => {
  const f = goodFiles();
  f.set('README.md', Buffer.from('4 ' + String.fromCharCode(0xd7) + ' 4 grid, 12 ' +
    String.fromCharCode(0xb5) + 's\n', 'utf8'));
  const b = f.get('README.md');
  assert.ok(b.includes(Buffer.from([0xc3, 0x97])) && b.includes(Buffer.from([0xc2, 0xb5])),
    'fixture lost its non-ASCII bytes');
  assert.deepEqual(checkAscii(goodPkg(), f), []);
});

// Meta: every check owns at least one must-fail control.
test('meta: every check has a must-fail control', () => {
  assert.deepEqual(Object.keys(CHECKS), [
    'checkFilesList',
    'checkSideEffects',
    'checkNoRuntimeDeps',
    'checkAuthorAndName',
    'checkAscii',
    'checkFilesExist',
    'checkEntryPoints',
    'checkVersionSites',
  ]);
  const names = [...Object.keys(CHECKS), 'comparePackList', 'checkExports', 'checkDtsExports'];
  const covered = new Set(CONTROLS.map((c) => c[0]));
  for (const n of names) assert.ok(covered.has(n), 'no must-fail control for ' + n);
  for (const c of covered) assert.ok(names.includes(c), 'control for unregistered check ' + c);
  assert.equal(CONTROLS.length, 30, 'control count changed: update this pin deliberately');
});
