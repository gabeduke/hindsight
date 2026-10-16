// web/static/lib/syntax.test.js
// A page-breaking slip in code no unit test imports -- a redeclared `const` in
// tape/page.js, an import of a name another file does not export -- blanks the
// page in a browser and nothing in the node suite notices (the page modules
// need a document). Cheap checks on every script under web/static and on the
// inline <script> blocks of its pages:
//
//  1. each parses as the kind it is loaded as: a module (the default; also
//     the two audio worklets, since addModule() evaluates a module), or a
//     classic script (sw.js, registered with no `type`; an inline block with
//     no type or a JavaScript one). A function declared twice is legal in a
//     classic script and an error in a module, so the kind matters. LOADED
//     lists the exceptions with the reason, and a test fails if a `new Worker`,
//     `importScripts`, `addModule` or `serviceWorker.register` turns up that
//     it does not account for;
//  2. every named import of a relative or root-absolute (`/lib/x.js`) script,
//     in a script or an inline module block, names something that script exports.
//
// Limits of the second check: a tokenizer, not a parser. It skips comments, strings,
// template literals and regex literals before it looks, so nothing inside one
// can pass for a statement, and it reads every static `import` and `export`
// form (lists across lines, comments inside lists, `export const a = 1, b = 2`,
// destructured exports, `export * from`, `export * as ns from`,
// `export { x as y } from`). It guesses whether a `/` opens a regex or
// divides from the token before it; a regex right after `)` (`if (x) /a/.test(y)`)
// would be read as a division. A declaration list with no `;` is ended by a
// line that starts a statement. It does not follow dynamic `import()` (it is
// skipped, not checked), imports from full URLs or packages, or
// `import * as ns` (nothing named to check). A page's inline blocks are cut
// out by regex, so a `</script>` inside a string would end one early; the
// pages here have none. paths.test.js checks that each specifier's file
// exists; this checks what is imported from it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { execFile } from 'node:child_process';
import vm from 'node:vm';
import { join, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url)); // web/static/

function filesWith(ext, dir = root, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules') continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) filesWith(ext, p, out);
    else if (name.endsWith(ext)) out.push(p);
  }
  return out.sort();
}
const scripts = () => filesWith('.js');
const pages = () => filesWith('.html');

/**
 * syntaxError parses source as a `kind` of script and says what is wrong with
 * it: '' when it parses, else the engine's message. A 'module' goes through
 * `node --check`; a 'classic' script through vm.Script, which parses it the
 * way a plain <script> or a classic worker would -- a function declared twice
 * is legal there, a top-level `await` and an `import` are not.
 */
function syntaxError(source, kind = 'module') {
  if (kind === 'classic') {
    try { new vm.Script(source); return Promise.resolve(''); } catch (e) { return Promise.resolve(`${e.name}: ${e.message}`); }
  }
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
 * badImports is every relative or root-absolute named import in `files` (a
 * Map of path to source) whose y.js exists in it but does not export x. A
 * specifier that starts with / is resolved against `base`, which is web/static
 * on the real tree: the way the server serves it, and paths.test.js reads it.
 */
export function badImports(files, base = root) {
  const target = (path, spec) => (spec.startsWith('/') ? join(base, spec.slice(1)) : resolve(dirname(path), spec)).replace(/[?#].*$/, '');
  const exportsCache = new Map();
  const allExports = (path, seen = new Set()) => {
    if (exportsCache.has(path)) return exportsCache.get(path);
    if (seen.has(path)) return new Set();
    seen.add(path);
    const { names: own, stars } = exportsOf(files.get(path));
    const all = new Set(own);
    for (const s of stars) {
      const to = target(path, s);
      if (files.has(to)) for (const n of allExports(to, seen)) if (n !== 'default') all.add(n);
    }
    exportsCache.set(path, all);
    return all;
  };
  const bad = [];
  for (const [path, source] of files) {
    for (const { from, names: wanted } of importsOf(source)) {
      const to = target(path, from);
      if (!files.has(to)) continue; // not a script here: paths.test.js's business
      const have = allExports(to);
      for (const n of wanted) if (!have.has(n)) bad.push(`${path}: imports { ${n} } from ${from}, which exports ${[...have].sort().join(', ') || 'nothing'}`);
    }
  }
  return bad;
}

// --- how each script is loaded -----------------------------------------------------

/**
 * Every script is parsed as a module (a <script type="module">, an import)
 * unless it is listed here. These are the ones that are loaded some other way,
 * or that only look like they are; the reason is beside each, and the test
 * below fails if a load call turns up that is not accounted for.
 *   - audioWorklet.addModule() always evaluates its file as a module, never
 *     as a classic script, so the two worklets are modules like the rest;
 *   - the service worker is registered with no `{ type: 'module' }`, so it is
 *     a classic worker script (importScripts would work in it, import would not).
 */
const LOADED = {
  'sw.js': { kind: 'classic', how: "navigator.serviceWorker.register('/sw.js') in app.js and lib/rooms/studio.js, with no options" },
  'lib/phone/worklet.js': { kind: 'module', how: "audioWorklet.addModule('/lib/phone/worklet.js') in lib/phone/recorder.js and lib/tape/away-sheet.js; addModule evaluates a module" },
  'lib/tape/stream-worklet.js': { kind: 'module', how: "audioWorklet.addModule('/lib/tape/stream-worklet.js') in lib/tape/stream-player.js; addModule evaluates a module" },
};
const kindOf = (path) => LOADED[relative(root, path)]?.kind ?? 'module';

/**
 * loadedScripts is the calls in source that load a script some way other than
 * import or <script>: [{how, target, options}]. `target` is the literal path
 * (null when it is not a literal); `options` is true when a second argument
 * follows, which for register() and Worker() could change the kind.
 */
export function loadedScripts(source) {
  const out = [];
  const toks = tokens(source);
  toks.forEach((tok, i) => {
    if (tok.t !== 'word' || !isP(toks[i + 1], '(')) return;
    const how = tok.v === 'addModule' || tok.v === 'importScripts' ? tok.v
      : tok.v === 'register' && isP(toks[i - 1], '.') && isW(toks[i - 2], 'serviceWorker') ? 'register'
        : tok.v === 'Worker' && isW(toks[i - 1], 'new') ? 'Worker' : null;
    if (!how) return;
    const arg = toks[i + 2];
    const literal = arg?.t === 'str' && (isP(toks[i + 3], ',') || isP(toks[i + 3], ')'));
    out.push({ how, target: literal ? arg.v : null, options: literal && isP(toks[i + 3], ',') });
  });
  return out;
}

/**
 * inlineScripts is the <script> blocks in an HTML page that have code in
 * them: [{kind, source, line, id}]. A block with a `src`, an empty one, one
 * inside an HTML comment, and a data block (`application/json`,
 * `text/template`, anything that is not JavaScript) are left out.
 */
export function inlineScripts(html) {
  const out = [];
  const bare = html.replace(/<!--[\s\S]*?-->/g, (c) => c.replace(/[^\n]/g, ' ')); // keeps the line numbers
  for (const m of bare.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    const attrs = m[1];
    if (/\bsrc\s*=/i.test(attrs) || !m[2].trim()) continue;
    const type = /\btype\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    const t = (type ? (type[1] ?? type[2] ?? type[3]) : '').trim().toLowerCase();
    const kind = t === 'module' ? 'module' : /^(|(text|application)\/(javascript|ecmascript))$/.test(t) ? 'classic' : null;
    if (!kind) continue;
    out.push({ kind, source: m[2], line: bare.slice(0, m.index).split('\n').length, id: /\bid\s*=\s*["']([^"']+)/i.exec(attrs)?.[1] });
  }
  return out;
}

// --- the checks on the real tree ----------------------------------------------------

test('every script under web/static parses as the kind it is loaded as (a redeclared const, a stray brace, would blank the page)', async () => {
  const files = scripts().filter((p) => !p.endsWith('.test.js')); // the runner parses the tests itself
  assert.ok(files.length > 100, `found ${files.length} scripts`);
  const errors = (await inPool(files, 8, async (p) => {
    const e = await syntaxError(readFileSync(p, 'utf8'), kindOf(p));
    return e ? `${relative(root, p)} (${kindOf(p)}): ${e}` : '';
  })).filter(Boolean);
  assert.deepEqual(errors, []);
});

test('every inline <script> in a page parses as its type says', async () => {
  const blocks = pages().flatMap((p) => inlineScripts(readFileSync(p, 'utf8')).map((b) => ({ ...b, page: relative(root, p) })));
  assert.ok(blocks.length > 5 && blocks.some((b) => b.kind === 'module') && blocks.some((b) => b.kind === 'classic'), `found ${blocks.length} inline scripts`);
  const errors = (await inPool(blocks, 8, async (b) => {
    const e = await syntaxError(b.source, b.kind);
    return e ? `${b.page}:${b.line}${b.id ? ` #${b.id}` : ''} (${b.kind}): ${e}` : '';
  })).filter(Boolean);
  assert.deepEqual(errors, []);
});

test('every script loaded by a worker, a worklet or the service worker registration is listed above', () => {
  const found = new Map(); // target -> where it is loaded from
  const problems = [];
  for (const p of scripts().filter((f) => !f.endsWith('.test.js'))) {
    for (const { how, target, options } of loadedScripts(readFileSync(p, 'utf8'))) {
      const at = `${relative(root, p)}: ${how}(${target ?? '...'})`;
      if (target === null) problems.push(`${at} is not a literal path, so its kind cannot be checked: list it by hand`);
      else if (options) problems.push(`${at} passes options, which may make it a module worker: check the kind and list it`);
      else if (!(target.slice(1) in LOADED)) problems.push(`${at} is not in LOADED`);
      else found.set(target.slice(1), at);
    }
  }
  for (const path of Object.keys(LOADED)) if (!found.has(path)) problems.push(`LOADED lists ${path}, but nothing loads it any more (or no longer the way it says)`);
  assert.deepEqual(problems, []);
});

test('every named import from a script in web/static names something that script exports', () => {
  const files = new Map(scripts().map((p) => [p, readFileSync(p, 'utf8')]));
  // an inline module block in a page imports too, and a slip there is as blank a page
  for (const p of pages()) {
    inlineScripts(readFileSync(p, 'utf8')).filter((b) => b.kind === 'module').forEach((b, n) => files.set(`${p}#inline${n}`, b.source));
  }
  assert.deepEqual(badImports(files).map((b) => b.replace(root, '')), []);
});

// --- the checks, checked --------------------------------------------------------------

// The samples below are fake modules. paths.test.js reads every script's
// `from` clause and checks the file exists, so the samples spell it FROM.
const lit = (s) => s.replaceAll('FROM', 'from').replaceAll('IMPORT', 'import');
const syntaxErrorS = (s, kind) => syntaxError(lit(s), kind);
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

test('a root-absolute import is resolved against web/static, as the server does', () => {
  const m = (s) => join(sep, 'w', s);
  const files = new Map([
    [m('app.js'), "import { connectLive, gone } FROM '/lib/live.js';\nimport { fine } FROM '/lib/deep/x.js?v=2';"],
    [m('lib/live.js'), 'export function connectLive() {}'],
    [m('lib/deep/x.js'), "export const fine = 1;"],
    [m('lib/deep/y.js'), "import { connectLive } FROM '/lib/live.js';\nimport { connectLive as c2 } FROM '../live.js';"],
  ].map(([path, source]) => [path, lit(source)]));
  const bad = badImports(files, m(''));
  assert.equal(bad.length, 1);
  assert.match(bad[0], /app\.js: imports \{ gone \} from \/lib\/live\.js, which exports connectLive/);
  files.set(m('lib/live.js'), 'export function connectLive() {}\nexport const gone = 1;');
  assert.deepEqual(badImports(files, m('')), []);
  // and the real tree: the entry page's own imports are checked
  const real = new Map(scripts().map((p) => [p, readFileSync(p, 'utf8')]));
  const fromApp = [...real].filter(([p]) => p === join(root, 'app.js')).flatMap(([, src]) => importsOf(src));
  assert.ok(fromApp.filter((i) => i.from.startsWith('/lib/')).length > 5, 'app.js imports from /lib/ should be seen');
});

test('a script is parsed as the kind it is loaded as: classic allows a repeated function, a module does not', async () => {
  const twice = 'function f() { return 1; }\nfunction f() { return 2; }\n';
  assert.equal(await syntaxError(twice, 'classic'), '');
  assert.match(await syntaxError(twice, 'module'), /already been declared/);
  const awaits = 'await Promise.resolve(1);\n';
  assert.match(await syntaxError(awaits, 'classic'), /SyntaxError|await/i);
  assert.equal(await syntaxError(awaits, 'module'), '');
  assert.match(await syntaxError('const a = 1;\nconst a = 2;\n', 'classic'), /already been declared/);
  assert.match(await syntaxErrorS('import { a } FROM "./x.js";\n', 'classic'), /import/i);
  assert.equal(await syntaxError('', 'classic'), '');
});

test('inline script blocks are found, with the kind their type says, and data blocks are left alone', () => {
  const html = [
    '<script id="early">try { x(); } catch (e) {}</script>',
    '<script type="module">\nimport { a } FROM "/lib/a.js";\n</script>',
    '<script type="text/javascript">var c = 1;</script>',
    '<script type="application/json" id="d">{"a": 1,}</script>',
    '<script type="text/template"><div>${not js</div></script>',
    '<script type="module" src="/lib/page.js"></script>',
    '<script src="/old.js"></script>',
    '<!-- <script>this is commented out(</script> -->',
    '<script></script>',
  ].join('\n');
  const found = inlineScripts(lit(html));
  assert.deepEqual(found.map((b) => [b.kind, b.id ?? '', b.line]), [['classic', 'early', 1], ['module', '', 2], ['classic', '', 5]]);
  assert.match(found[1].source, /import \{ a \}/);
});

test('the places a script is loaded from are found, so a new worker or worklet has to be listed', () => {
  const loads = (src) => loadedScripts(src);
  assert.deepEqual(loads("await ctx.audioWorklet.addModule('/lib/a/w.js');"), [{ how: 'addModule', target: '/lib/a/w.js', options: false }]);
  assert.deepEqual(loads("navigator.serviceWorker.register('/sw.js').catch(() => {});"), [{ how: 'register', target: '/sw.js', options: false }]);
  assert.deepEqual(loads("navigator.serviceWorker.register('/sw.js', { type: 'module' });"), [{ how: 'register', target: '/sw.js', options: true }]);
  assert.deepEqual(loads("const w = new Worker('/lib/w.js');\nimportScripts('/x.js');"), [{ how: 'Worker', target: '/lib/w.js', options: false }, { how: 'importScripts', target: '/x.js', options: false }]);
  assert.deepEqual(loads('new Worker(url);'), [{ how: 'Worker', target: null, options: false }]);
  // a comment, a string, and a bare register() (somebody's own function) are not loads
  assert.deepEqual(loads("// addModule('/not.js')\nconst s = \"register('/nor.js')\";\nregister('/yes.js');"), []);
});
