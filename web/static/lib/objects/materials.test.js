import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// objects.css holds the materials. The rule that makes it safe is that every
// token in it is the same in both schemes -- which is why it has no dark
// block. A token that follows the scheme must stay in styles.css, where its
// dark value lives.
//
// The failure this guards is the quiet one: move --panel into objects.css and
// nothing breaks in the light scheme, nothing fails to parse, and the dark
// scheme silently loses a colour. Nobody notices until someone opens the app
// at night.

const read = (p) => readFileSync(fileURLToPath(new URL(`../../${p}`, import.meta.url)), 'utf8');
const styles = read('styles.css');
const objects = read('objects.css');

/** declarations returns every `--token: value` inside the given text. */
function declarations(text) {
  return [...text.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)]
    .map((m) => [m[1], m[2].trim().replace(/\s+/g, ' ')]);
}

/** darkTokens is every token the dark scheme redefines in styles.css. */
function darkTokens() {
  const at = styles.indexOf('@media (prefers-color-scheme: dark)');
  assert.ok(at > 0, 'styles.css should still have a dark scheme block');
  // Walk braces from the @media to its close, so this keeps working if the
  // block moves or grows.
  let depth = 0, end = at;
  for (let i = at; i < styles.length; i++) {
    if (styles[i] === '{') depth++;
    else if (styles[i] === '}' && --depth === 0) { end = i; break; }
  }
  return new Set(declarations(styles.slice(at, end)).map(([t]) => t));
}

test('objects.css declares no token that the dark scheme redefines', () => {
  const dark = darkTokens();
  const offenders = declarations(objects).map(([t]) => t).filter((t) => dark.has(t));
  assert.deepEqual(offenders, [],
    'these follow the scheme, so they belong in styles.css where their dark value is');
});

test('objects.css has no dark block of its own', () => {
  // If one ever becomes necessary, the file's premise has changed and its
  // header comment is now a lie -- so this should fail and be read, not
  // deleted.
  assert.ok(!objects.includes('prefers-color-scheme'));
  assert.ok(!objects.includes('data-theme'));
});

test('the two stylesheets declare disjoint tokens', () => {
  // Both set custom properties on :root at the same specificity, so a token
  // in both would be decided by load order -- a trap worth not having.
  const inStyles = new Set(declarations(styles).map(([t]) => t));
  const both = [...new Set(declarations(objects).map(([t]) => t))].filter((t) => inStyles.has(t));
  assert.deepEqual(both, []);
});

test('objects.css carries the materials it claims to', () => {
  // A smoke test against the file being emptied or half-moved: each object
  // the header names should have brought its tokens with it.
  const tokens = new Set(declarations(objects).map(([t]) => t));
  for (const t of ['--reel-metal', '--oxide', '--trace', '--paper-hi', '--stripe-1',
    '--cas-mid', '--hub', '--pack', '--vu-face', '--vu-needle', '--tape-pack', '--pad-face', '--pad-lit',
    '--lcd-ink', '--grease-mark', '--marker',
    // The Listening Room's (Rooms P5): a room is a place, not chrome.
    '--room-wall', '--room-ink', '--room-plate-hi', '--room-walnut', '--room-paper', '--room-paper-ink',
    '--room-cardboard-hi', '--room-silver', '--room-key-ink']) {
    assert.ok(tokens.has(t), `${t} should be in objects.css`);
  }
});

test('every page that loads styles.css loads objects.css first', () => {
  // objects.css carries tokens styles.css uses. A page that takes one and not
  // the other renders with missing colours -- and only on that page, which is
  // exactly the kind of bug that reaches a Pi.
  // Every page there is, not a list: the rooms grow these pages, and a page
  // added later is the one a list would miss. The six known ones must be
  // among them, so a wrong directory can't pass by finding none.
  const pages = readdirSync(fileURLToPath(new URL('../../', import.meta.url))).filter((f) => f.endsWith('.html'));
  for (const page of ['index.html', 'takes.html', 'tape.html', 'wave.html', 'guide.html', 'objects.html', 'rig.html']) {
    assert.ok(pages.includes(page), `${page} should be one of the pages`);
  }
  for (const page of pages) {
    const html = read(page);
    const o = html.indexOf('/objects.css');
    const s = html.indexOf('/styles.css"');
    assert.ok(o > 0, `${page} should load objects.css`);
    assert.ok(s > 0 && o < s, `${page} should load objects.css before styles.css`);
  }
});

test('the service worker precaches both stylesheets', () => {
  const sw = read('sw.js');
  assert.ok(sw.includes("'/objects.css'"), 'objects.css should be in the shell');
  assert.ok(sw.includes("'/styles.css'"));
});
