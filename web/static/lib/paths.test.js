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
    // Static imports, and import('…') -- the Studio's module is loaded that
    // way, only with its flag on, so a static scan would never see it.
    for (const m of src.matchAll(/(?:from|import)\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const spec = m[1] ?? m[2];
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

test('everything the Studio loads is in the offline shell', () => {
  // The Studio can be the installed app's first page (lib/rooms), so the
  // modules it loads -- through mount.js, and the import() of studio.js --
  // are precached, as Capture's are. lib/settings.js was missed once.
  const sw = readFileSync(join(ROOT, 'sw.js'), 'utf8');
  const shell = new Set([.../SHELL\s*=\s*\[([\s\S]*?)\]/.exec(sw)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
  const seen = new Set();
  const walkFrom = (abs) => {
    if (seen.has(abs)) return;
    seen.add(abs);
    const src = readFileSync(join(ROOT, abs.slice(1)), 'utf8');
    const re = /^\s*(?:import|export)\b[^;]*?\bfrom\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gm;
    for (const m of src.matchAll(re)) {
      const spec = m[1] ?? m[2] ?? m[3];
      const target = spec.startsWith('/') ? spec : '/' + relative(ROOT, normalize(join(ROOT, dirname(abs.slice(1)), spec))).split(sep).join('/');
      walkFrom(target);
    }
  };
  walkFrom('/lib/rooms/mount.js');
  assert.ok(seen.has('/lib/rooms/studio.js') && seen.size > 15, `walked only ${seen.size} modules`);
  assert.deepEqual([...seen].filter((p) => !shell.has(p)).sort(), []);
});
