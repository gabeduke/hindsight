import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, normalize, dirname, relative, sep } from 'node:path';

// Every module path in the app, resolved against the disk.
//
// Nothing else catches this. A module whose import no longer resolves still
// passes lint, still passes every unit test that does not import it, and
// fails only in a browser, as a blank page -- and a precache entry pointing
// at a file that moved makes the service worker's addAll reject, which takes
// the whole offline shell with it. Both are one-line mistakes that a file
// move makes easy, and the object library moved nine files.

const ROOT = fileURLToPath(new URL('..', import.meta.url)); // web/static

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|html)$/.test(name)) out.push(p);
  }
  return out;
}

const files = walk(ROOT);

test('every relative and absolute module import resolves', () => {
  const broken = [];
  let checked = 0;
  for (const p of files) {
    const src = readFileSync(p, 'utf8');
    for (const m of src.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      let target;
      if (spec.startsWith('/')) target = join(ROOT, spec.slice(1));
      else if (spec.startsWith('.')) target = normalize(join(dirname(p), spec));
      else continue; // a bare specifier would be a bundler, and there isn't one
      checked++;
      try { statSync(target); } catch { broken.push(`${p.slice(ROOT.length)} -> ${spec}`); }
    }
  }
  assert.ok(checked > 100, `only ${checked} imports found; the walk is probably wrong`);
  assert.deepEqual(broken, []);
});

test('every <script src> on a page resolves', () => {
  const broken = [];
  for (const p of files.filter((f) => f.endsWith('.html'))) {
    for (const m of readFileSync(p, 'utf8').matchAll(/src=["'](\/[^"']+\.js)["']/g)) {
      try { statSync(join(ROOT, m[1].slice(1))); } catch { broken.push(`${p.slice(ROOT.length)} -> ${m[1]}`); }
    }
  }
  assert.deepEqual(broken, []);
});

test('every stylesheet a page links resolves', () => {
  const broken = [];
  for (const p of files.filter((f) => f.endsWith('.html'))) {
    for (const m of readFileSync(p, 'utf8').matchAll(/<link[^>]+href=["'](\/[^"']+\.css)["']/g)) {
      try { statSync(join(ROOT, m[1].slice(1))); } catch { broken.push(`${p.slice(ROOT.length)} -> ${m[1]}`); }
    }
  }
  assert.deepEqual(broken, []);
});

test('every file the service worker precaches exists', () => {
  // caches.addAll rejects as a whole if any one request fails, so a single
  // stale entry here costs the entire offline shell rather than one file.
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  const block = /SHELL\s*=\s*\[([\s\S]*?)\]/.exec(sw);
  assert.ok(block, 'sw.js should still have a SHELL list');
  const paths = [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.ok(paths.length > 50, `only ${paths.length} shell entries; the match is probably wrong`);
  const missing = paths
    .filter((p) => /\.(js|css|html|woff2|png|svg)$/.test(p))
    .filter((p) => { try { statSync(join(ROOT, p.slice(1))); return false; } catch { return true; } });
  assert.deepEqual(missing, []);
});

test('CI runs the tests in every directory that has any', () => {
  // The globs in ci.yml name each directory one by one, so a new directory
  // under lib/ is invisible to CI until it is added -- a whole suite can sit
  // in the repo, passing locally, never once run on a PR. That happened.
  const ci = readFileSync(fileURLToPath(new URL('../../../.github/workflows/ci.yml', import.meta.url)), 'utf8');
  const line = /run:\s*node --test (.+)/.exec(ci);
  assert.ok(line, 'ci.yml should still run node --test');
  const globs = [...line[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

  // Every directory holding a *.test.js, relative to web/static.
  const dirs = new Set();
  for (const p of files.filter((f) => f.endsWith('.test.js'))) {
    dirs.add(relative(ROOT, dirname(p)).split(sep).join('/'));
  }

  const missing = [...dirs].filter((d) => !globs.includes(`web/static/${d}/*.test.js`));
  assert.deepEqual(missing.sort(), [],
    'these directories have tests that CI never runs; add them to the node --test globs in ci.yml');
});

test('every module a cached page imports is cached with it', () => {
  // The offline shell is only whole if everything its pages import is in
  // SHELL: a module left out loads from the cache's page and then fails to
  // fetch offline, which is a blank page on a phone with no signal. A new
  // directory of modules under lib/ (lib/scene) is the easy way to miss one.
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  const shell = new Set([.../SHELL\s*=\s*\[([\s\S]*?)\]/.exec(sw)[1].matchAll(/'([^'?]+)(?:\?[^']*)?'/g)].map((m) => m[1]));
  const seen = new Set();
  const missing = [];
  const visit = (file, from) => {
    const rel = '/' + relative(ROOT, file).split(sep).join('/');
    if (seen.has(rel)) return;
    seen.add(rel);
    if (!shell.has(rel)) missing.push(`${rel} (imported by ${from})`);
    for (const m of readFileSync(file, 'utf8').matchAll(/(?:from|import)\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      if (spec.startsWith('/')) visit(join(ROOT, spec.slice(1)), rel);
      else if (spec.startsWith('.')) visit(normalize(join(dirname(file), spec)), rel);
    }
  };
  for (const page of [...shell].filter((p) => p.endsWith('.html'))) {
    const html = readFileSync(join(ROOT, page.slice(1)), 'utf8');
    for (const m of html.matchAll(/<script[^>]+src=["'](\/[^"']+\.js)["']/g)) visit(join(ROOT, m[1].slice(1)), page);
    for (const m of html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)) {
      for (const i of m[1].matchAll(/(?:from|import)\s+['"](\/[^'"]+)['"]/g)) visit(join(ROOT, i[1].slice(1)), page);
    }
  }
  assert.ok(seen.size > 60, `only ${seen.size} modules reached; the walk is probably wrong`);
  assert.deepEqual(missing, []);
});
