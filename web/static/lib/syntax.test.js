// web/static/lib/syntax.test.js
// A page-breaking slip in code no unit test imports -- a redeclared `const` in
// tape/page.js, an import of a name another file does not export -- blanks the
// page in a browser and nothing in the node suite notices (the page modules
// need a document). Two cheap checks on every script under web/static:
//
//  1. it parses (`node --check`, as a module), so a SyntaxError -- a
//     redeclared binding, a stray brace -- fails here;
//  2. every named import of a relative script names something that script exports.
//
// Limits of the second: a tokenizer, not a parser. It skips comments, strings,
// template literals and regex literals before it looks, so nothing inside one
// can pass for a statement, and it reads every static `import` and `export`
// form (lists across lines, comments inside lists, `export const a = 1, b = 2`,
// destructured exports, `export * from`, `export * as ns from`,
// `export { x as y } from`). It guesses whether a `/` opens a regex or
// divides from the token before it; a regex right after `)` (`if (x) /a/.test(y)`)
// would be read as a division. A declaration list with no `;` is ended by a
// line that starts a statement. It does not follow dynamic `import()` (it is
// skipped, not checked), imports from absolute URLs or packages, or
// `import * as ns` (nothing named to check). paths.test.js checks that each
// specifier's file exists; this checks what is imported from it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { join, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url)); // web/static/

function scripts(dir = root, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) scripts(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out.sort();
}

/** syntaxError runs `node --check` on source, as a module; '' when it parses, else node's message. */
function syntaxError(source) {
  return new Promise((done) => {
    const child = execFile(process.execPath, ['--check', '--input-type=module'], { timeout: 20000 }, (err, _out, stderr) => {
      done(err ? (stderr.split('\n').find((l) => /Error/.test(l)) || String(err)).trim() : '');
    });
    child.stdin.on('error', () => {}); // node may exit on a syntax error before it has read it all
    child.stdin.end(source);
  });
}

/** inPool runs fn over items, `n` at a time. */
async function inPool(items, n, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }));
  return results;
}

// --- imports and exports ---------------------------------------------------------

const REGEX_AFTER = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);
const isIdentChar = (c) => /[\w$]/.test(c) || c > '\x7f';

/**
 * tokens is source cut into code tokens, as [{t, v, nl, depth}]: `t` is
 * 'word' | 'str' | 'num' | 'regex' | 'tpl' | 'punct'; `v` is the text of a
 * word, a punctuation char, or a string's contents; `nl` is true when a line
 * break came before it; `depth` is how many brackets (or `${`) are open
 * around it. Comments are dropped, and what is inside a string, a template
 * literal or a regex literal never becomes a token, so nothing in there can
 * look like a statement. A tokenizer, not a parser: the one guess it makes is
 * whether a `/` opens a regex or divides, decided by the token before it.
 */
export function tokens(source) {
  const out = [];
  const src = source.startsWith('#!') ? '//' + source : source;
  const open = []; // one entry per open bracket; 'tpl' for the `${` of a template
  let i = 0;
  let nl = false;
  const push = (t, v) => { out.push({ t, v, nl, depth: open.length }); nl = false; };
  const quoted = (q) => { // i is on the opening quote; leaves i after the closing one
    let v = '';
    for (i++; i < src.length && src[i] !== q; i++) {
      if (src[i] === '\\') { i++; v += src[i] ?? ''; } else v += src[i];
    }
    i++;
    return v;
  };
  const template = () => { // i is past a ` or past the } that closes a ${; stops past the closing ` or past the next ${
    for (; i < src.length; i++) {
      if (src[i] === '\\') i++;
      else if (src[i] === '`') { i++; return; }
      else if (src[i] === '$' && src[i + 1] === '{') { i += 2; open.push('tpl'); return; }
    }
  };
  while (i < src.length) {
    const c = src[i];
    if (c === '\n') { nl = true; i++; }
    else if (/\s/.test(c)) i++;
    else if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; }
    else if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? src.length : end + 2;
      if (src.slice(i, stop).includes('\n')) nl = true;
      i = stop;
    } else if (c === '"' || c === "'") push('str', quoted(c));
    else if (c === '`') { i++; template(); push('tpl', ''); }
    else if (c === '/') {
      const prev = out[out.length - 1];
      const property = prev?.t === 'word' && isP(out[out.length - 2], '.'); // `loop.in / n`: `in` here is a name
      const divides = prev && (prev.t === 'num' || prev.t === 'str' || prev.t === 'tpl' || prev.t === 'regex'
        || (prev.t === 'word' && (property || !REGEX_AFTER.has(prev.v))) || (prev.t === 'punct' && [')', ']', '}'].includes(prev.v)));
      if (divides) { push('punct', '/'); i++; } else {
        let inClass = false;
        for (i++; i < src.length && src[i] !== '\n' && (inClass || src[i] !== '/'); i++) {
          if (src[i] === '\\') i++;
          else if (src[i] === '[') inClass = true;
          else if (src[i] === ']') inClass = false;
        }
        i++;
        while (i < src.length && isIdentChar(src[i])) i++; // flags
        push('regex', '');
      }
    } else if (/\d/.test(c)) {
      let j = i;
      while (j < src.length && (isIdentChar(src[j]) || (src[j] === '.' && /\d/.test(src[j + 1] || '')))) j++;
      push('num', src.slice(i, j));
      i = j;
    } else if (isIdentChar(c)) {
      let j = i;
      while (j < src.length && isIdentChar(src[j])) j++;
      push('word', src.slice(i, j));
      i = j;
    } else if (c === '}' && open[open.length - 1] === 'tpl') {
      open.pop(); i++; template(); push('tpl', '');
    } else {
      if (c === '(' || c === '[' || c === '{') { push('punct', c); open.push(c); }
      else if (c === ')' || c === ']' || c === '}') { open.pop(); push('punct', c); }
      else push('punct', c);
      i++;
    }
  }
  return out;
}

const isP = (tok, v) => tok?.t === 'punct' && tok.v === v;
const isW = (tok, v) => tok?.t === 'word' && tok.v === v;
// A line that starts with one of these ends a `const a = 1, b = 2` that ran on without a `;`.
const STATEMENT_WORDS = new Set(['export', 'import', 'const', 'let', 'var', 'function', 'class', 'async', 'if', 'for', 'while', 'return', 'try', 'switch', 'do', 'throw']);

/** group is the tokens inside the bracket at toks[i], and the index just past its closer. */
function group(toks, i) {
  let j = i + 1;
  while (j < toks.length && toks[j].depth > toks[i].depth) j++;
  return { inner: toks.slice(i + 1, j), next: j + 1 };
}

/** items splits the tokens inside a bracket at its own top-level commas. */
function items(inner) {
  const out = [[]];
  const base = inner.length ? inner[0].depth : 0;
  for (const tok of inner) {
    if (tok.depth === base && isP(tok, ',')) out.push([]); else out[out.length - 1].push(tok);
  }
  return out.filter((x) => x.length);
}

/** patternNames is the names a binding pattern declares: `x`, `{a, b: c, ...d}`, `[e, , f = 1]`, `{g: {h}}`. */
function patternNames(toks) {
  const out = [];
  const walk = (list) => {
    if (!list.length) return;
    if (isP(list[0], '{') || isP(list[0], '[')) {
      const object = list[0].v === '{';
      for (const item of items(group(list, 0).inner)) {
        const plain = item.filter((x) => !isP(x, '.') || x.depth !== item[0].depth); // `...rest`
        // `key: target = default` in an object pattern, `target = default` in an array one
        const eq = plain.findIndex((x) => isP(x, '=') && x.depth === plain[0].depth);
        const colon = object ? plain.findIndex((x) => isP(x, ':') && x.depth === plain[0].depth) : -1;
        walk(colon >= 0 && (eq < 0 || colon < eq) ? plain.slice(colon + 1) : plain);
      }
    } else if (list[0].t === 'word') out.push(list[0].v); // what follows is `= default`
  };
  walk(toks);
  return out;
}

/** importsOf is the named imports of source from a relative or root-absolute script: [{from, names: [...]}]. */
export function importsOf(source) {
  const out = [];
  const toks = tokens(source);
  for (let i = 0; i < toks.length; i++) {
    if (!isW(toks[i], 'import') || toks[i].depth !== 0 || isP(toks[i - 1], '.')) continue;
    let j = i + 1;
    if (isP(toks[j], '(') || isP(toks[j], '.')) continue; // import(...) and import.meta
    const wanted = [];
    if (toks[j]?.t === 'word') { wanted.push('default'); j++; if (isP(toks[j], ',')) j++; }
    if (isP(toks[j], '{')) {
      const g = group(toks, j);
      for (const item of items(g.inner)) wanted.push(item[0].v); // `a as b` imports a; "a-b" as c, a string
      j = g.next;
    } else if (isP(toks[j], '*')) j += 3; // * as ns
    if (isW(toks[j], 'from')) j++;
    const spec = toks[j]?.t === 'str' ? toks[j].v : '';
    if (wanted.length && /^(\.{1,2})?\//.test(spec)) out.push({ from: spec, names: wanted });
  }
  return out;
}

/** exportsOf is what source exports: {names: Set, stars: [specifier of each `export * from`]}. */
export function exportsOf(source) {
  const got = new Set();
  const stars = [];
  const toks = tokens(source);
  for (let i = 0; i < toks.length; i++) {
    if (!isW(toks[i], 'export') || toks[i].depth !== 0 || isP(toks[i - 1], '.')) continue;
    let j = i + 1;
    const w = toks[j];
    if (isW(w, 'default')) got.add('default');
    else if (isP(w, '{')) {
      for (const item of items(group(toks, j).inner)) {
        const as = item.findIndex((x) => isW(x, 'as'));
        got.add(as > 0 ? item[as + 1].v : item[0].v);
      }
    } else if (isP(w, '*')) {
      if (isW(toks[j + 1], 'as')) got.add(toks[j + 2].v);
      else if (isW(toks[j + 1], 'from') && toks[j + 2]?.t === 'str') stars.push(toks[j + 2].v);
    } else if (isW(w, 'async') || isW(w, 'function') || isW(w, 'class')) {
      if (isW(w, 'async')) j++;
      j++;
      if (isP(toks[j], '*')) j++;
      if (toks[j]?.t === 'word') got.add(toks[j].v);
    } else if (isW(w, 'const') || isW(w, 'let') || isW(w, 'var')) {
      // declarators: pattern [= initializer] {, pattern [= initializer]}
      j++;
      for (;;) {
        const start = j;
        j = isP(toks[j], '{') || isP(toks[j], '[') ? group(toks, j).next : j + 1;
        for (const n of patternNames(toks.slice(start, j))) got.add(n);
        while (j < toks.length && (toks[j].depth > 0
          || !(isP(toks[j], ',') || isP(toks[j], ';') || (toks[j].nl && toks[j].t === 'word' && STATEMENT_WORDS.has(toks[j].v))))) j++;
        if (!isP(toks[j], ',')) break;
        j++;
      }
    }
  }
  return { names: got, stars };
}

/**
 * badImports is every relative named import in `files` (a Map of path
 * to source) whose y.js exists in it but does not export x.
 */
export function badImports(files) {
  const exportsCache = new Map();
  const allExports = (path, seen = new Set()) => {
    if (exportsCache.has(path)) return exportsCache.get(path);
    if (seen.has(path)) return new Set();
    seen.add(path);
    const { names: own, stars } = exportsOf(files.get(path));
    const all = new Set(own);
    for (const s of stars) {
      const target = resolve(dirname(path), s);
      if (files.has(target)) for (const n of allExports(target, seen)) if (n !== 'default') all.add(n);
    }
    exportsCache.set(path, all);
    return all;
  };
  const bad = [];
  for (const [path, source] of files) {
    for (const { from, names: wanted } of importsOf(source)) {
      const target = resolve(dirname(path), from);
      if (!files.has(target)) continue; // not a script here: paths.test.js's business
      const have = allExports(target);
      for (const n of wanted) if (!have.has(n)) bad.push(`${path}: imports { ${n} } from ${from}, which exports ${[...have].sort().join(', ') || 'nothing'}`);
    }
  }
  return bad;
}

// --- the checks on the real tree ----------------------------------------------------

test('every script under web/static parses (a redeclared const, a stray brace, would blank the page)', async () => {
  const files = scripts().filter((p) => !p.endsWith('.test.js')); // the runner parses the tests itself
  assert.ok(files.length > 100, `found ${files.length} scripts`);
  const errors = (await inPool(files, 8, async (p) => {
    const e = await syntaxError(readFileSync(p, 'utf8'));
    return e ? `${relative(root, p)}: ${e}` : '';
  })).filter(Boolean);
  assert.deepEqual(errors, []);
});

test('every named import from a script in web/static names something that script exports', () => {
  const files = new Map(scripts().map((p) => [p, readFileSync(p, 'utf8')]));
  assert.deepEqual(badImports(files).map((b) => b.split(sep).slice(-4).join(sep)), []);
});

// --- the checks, checked --------------------------------------------------------------

// The samples below are fake modules. paths.test.js reads every script's
// `from` clause and checks the file exists, so the samples spell it FROM.
const lit = (s) => s.replaceAll('FROM', 'from').replaceAll('IMPORT', 'import');
const syntaxErrorS = (s) => syntaxError(lit(s));
const importsOfS = (s) => importsOf(lit(s));
const exportsOfS = (s) => exportsOf(lit(s));

test('a parse check fails a redeclared const, a stray brace, and passes what parses', async () => {
  assert.equal(await syntaxError('export const a = 1;\nexport function f() { return a; }\n'), '');
  assert.match(await syntaxError('const q = 1;\nfunction f() {}\nconst q = 2;\n'), /already been declared/);
  assert.match(await syntaxError('function f() {\n'), /SyntaxError/);
  assert.match(await syntaxErrorS('import { a } FROM "./x.js";\nlet a;\n'), /already been declared/);
});

test('the import check reads statements as written, and ignores what is not code', () => {
  assert.deepEqual(importsOfS("import { a, b as c } FROM './m.js';"), [{ from: './m.js', names: ['a', 'b'] }]);
  assert.deepEqual(importsOfS("import {\n  a,\n  b,\n} FROM '../n.js';"), [{ from: '../n.js', names: ['a', 'b'] }]);
  assert.deepEqual(importsOfS("import d, { a } FROM './m.js';"), [{ from: './m.js', names: ['default', 'a'] }]);
  assert.deepEqual(importsOfS("import d, * as ns FROM './m.js';"), [{ from: './m.js', names: ['default'] }]);
  assert.deepEqual(importsOfS("import * as ns FROM './m.js';\nIMPORT './side.js';\nimport { x } FROM 'node:fs';"), []);
  assert.deepEqual(importsOfS("/**\n * import { gone } FROM './m.js';\n */\nimport { a } FROM './m.js';"), [{ from: './m.js', names: ['a'] }]);
  assert.deepEqual(importsOfS("// import { gone } FROM './m.js';\nimport { a } FROM './m.js'; // import { gone2 } FROM './m.js';"), [{ from: './m.js', names: ['a'] }]);
});

test('a comment inside an import or export list is not a name', () => {
  assert.deepEqual(importsOfS("import { a, /* c */ b } FROM './m.js';"), [{ from: './m.js', names: ['a', 'b'] }]);
  assert.deepEqual(importsOfS("import {\n  a, // the first\n  b, /* the\n second */\n} FROM './m.js';"), [{ from: './m.js', names: ['a', 'b'] }]);
  assert.deepEqual([...exportsOfS("export { a, // c\n b /* d */ as e };").names].sort(), ['a', 'e']);
});

test('text that only looks like a statement is not one', () => {
  // A template literal, a string and a regex are not code, however a line inside them starts.
  assert.deepEqual(importsOfS("const t = `\nIMPORT { x } FROM './m.js';\n`;"), []);
  assert.deepEqual(importsOfS("const t = `a ${ `\nIMPORT { x } FROM './m.js';` } b`;"), []);
  assert.deepEqual(importsOfS("const s = 'a\\\nIMPORT { x } FROM \"./m.js\"';"), []);
  assert.deepEqual(exportsOfS("const t = `\nexport const ghost = 1;\n`;").names.size, 0);
  // and a quote inside a regex, or a division, does not swallow the code after it
  const after = exportsOfS("const w = loop.in / 2, v = '/', k = \"`\";\nconst r = /'[`]/g;\nconst q = a / b / c;\nexport const real = 1;\nconst u = `${ q }`;\nexport const real2 = 2;");
  assert.deepEqual([...after.names].sort(), ['real', 'real2']);
  assert.deepEqual(importsOfS("const r = x.import;\nconst o = { import: 1 };"), []);
});

test('every way to export is read', () => {
  const names = (src) => [...exportsOfS(src).names].sort();
  assert.deepEqual(names('export const a = 1, b = 2;'), ['a', 'b']);
  assert.deepEqual(names('export const a = f(1, 2), b = [3, 4], c = { d: 5, e: 6 };'), ['a', 'b', 'c']);
  assert.deepEqual(names('export let x\nexport var y = 1, z\nlet notExported = 1, alsoNot = 2;'), ['x', 'y', 'z']);
  assert.deepEqual(names('export const a = () => 1, b = 2\nconst c = 3, d = 4'), ['a', 'b']);
  assert.deepEqual(names('export function f() {}\nexport function* g() {}\nexport async function h() {}\nexport async function* i() {}'), ['f', 'g', 'h', 'i']);
  assert.deepEqual(names('export class K {}\nexport default class {}'), ['K', 'default']);
  assert.deepEqual(names('export default function () {}'), ['default']);
  assert.deepEqual(names('export default 3;'), ['default']);
  assert.deepEqual(names('export const { p, q: r = 1, ...rest } = obj;\nexport const [s0, , t0 = 2] = pair;'), ['p', 'r', 'rest', 's0', 't0']);
  assert.deepEqual(names('export const { a: { b }, c: [d] } = obj;'), ['b', 'd']);
  assert.deepEqual(names("export { l, m as n };\nexport { o as default };"), ['default', 'l', 'n']);
  assert.deepEqual(names("export { x as y } FROM './m.js';"), ['y']);
  assert.deepEqual(names("export * as ns FROM './m.js';"), ['ns']);
  assert.deepEqual(exportsOfS("export * FROM './z.js';\nexport * FROM \"../y.js\";").stars, ['./z.js', '../y.js']);
  assert.deepEqual(names('  // export const hidden = 1;\n/* export const hidden2 = 1; */\nexport const shown = 1;'), ['shown']);
});

test('the import check fails an import of a name the file no longer exports, and follows export *', () => {
  const m = (s) => join(sep, 'w', s);
  const files = new Map([
    [m('a.js'), "import { kept, renamed } FROM './b.js';\nimport { viaStar } FROM './c.js';"],
    [m('b.js'), 'export const kept = 1;\nexport const nowCalledSomethingElse = 2;'],
    [m('c.js'), "export * FROM './d.js';"],
    [m('d.js'), 'export function viaStar() {}'],
  ].map(([path, source]) => [path, lit(source)]));
  const bad = badImports(files);
  assert.equal(bad.length, 1);
  assert.match(bad[0], /imports \{ renamed \} from \.\/b\.js, which exports kept, nowCalledSomethingElse/);
  files.set(m('b.js'), 'export const kept = 1;\nexport const renamed = 2;');
  assert.deepEqual(badImports(files), []);
});
