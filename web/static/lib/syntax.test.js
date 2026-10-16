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
// Limits of the second: a line-anchored pass, not a parser. It reads
// `import`/`export` statements that start a line (a multi-line import list
// is fine), ignores comment blocks that start a line, and follows
// `export * from` and `export { x } from`. It does not see dynamic
// `import()`, imports from absolute URLs or packages, nested destructuring
// in an export (`export const { a: { b } } = ...`), or an export inside a
// string that looks like a statement. paths.test.js checks that each specifier's
// file exists; this checks what is imported from it.
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

const withoutBlockComments = (src) => src.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, '');
const names = (list) => list.split(',').map((s) => s.trim()).filter(Boolean);
const exported = (item) => { // "a", "a as b", "a as default": what the importer sees
  const m = /^(?:type\s+)?([\w$]+)(?:\s+as\s+([\w$]+))?$/.exec(item);
  return m ? (m[2] || m[1]) : item;
};
const imported = (item) => item.replace(/^type\s+/, '').split(/\s+as\s+/)[0].trim();

/** importsOf is the relative named imports of source: [{from, names: [...]}]. */
export function importsOf(source) {
  const out = [];
  const re = /^import\s+(?:([\w$]+)\s*,?\s*)?(?:\{([^}]*)\}\s*)?(?:\*\s+as\s+[\w$]+\s*)?from\s*['"](\.{1,2}\/[^'"]+)['"]/gm;
  for (const m of withoutBlockComments(source).matchAll(re)) {
    const wanted = [];
    if (m[1]) wanted.push('default');
    if (m[2]) wanted.push(...names(m[2]).map(imported));
    if (wanted.length) out.push({ from: m[3], names: wanted });
  }
  return out;
}

/** exportsOf is what source exports: {names: Set, stars: [specifier of each `export * from`]}. */
export function exportsOf(source) {
  const src = withoutBlockComments(source);
  const got = new Set();
  const stars = [];
  for (const m of src.matchAll(/^export\s+(?:async\s+)?(?:function\*?|const|let|var|class)\s+([\w$]+)/gm)) got.add(m[1]);
  // export const { a, b: c } = ...; export const [d, e] = ...
  for (const m of src.matchAll(/^export\s+(?:const|let|var)\s*[{[]([^}\]]*)[}\]]/gm)) {
    for (const item of names(m[1])) got.add(item.replace(/^\.\.\./, '').split('=')[0].split(':').pop().trim());
  }
  if (/^export\s+default\b/m.test(src)) got.add('default');
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) for (const item of names(m[1])) got.add(exported(item));
  for (const m of src.matchAll(/^export\s*\*\s*as\s+([\w$]+)\s+from/gm)) got.add(m[1]);
  for (const m of src.matchAll(/^export\s*\*\s*from\s*['"]([^'"]+)['"]/gm)) stars.push(m[1]);
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
  assert.deepEqual(importsOfS("import * as ns FROM './m.js';\nIMPORT './side.js';\nimport { x } FROM 'node:fs';"), []);
  assert.deepEqual(importsOfS("/**\n * import { gone } FROM './m.js';\n */\nimport { a } FROM './m.js';"), [{ from: './m.js', names: ['a'] }]);
  const ex = exportsOfS("export function f() {}\nexport async function g() {}\nexport const h = 1, i = 2;\nexport class K {}\nexport const { p, q: r = 1, ...rest } = obj;\nexport const [s0, t0] = pair;\nexport { l, m as n };\nexport default 3;\nexport * FROM './z.js';\n  // export const hidden = 1;");
  assert.deepEqual([...ex.names].sort(), ['K', 'default', 'f', 'g', 'h', 'l', 'n', 'p', 'r', 'rest', 's0', 't0']);
  assert.deepEqual(ex.stars, ['./z.js']);
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
