import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

// The rooms are the only layout, and the three old tabs must never paint. lib/nav.js
// rewrites them only once the page's modules have loaded, so each page with
// the switch carries a classic inline script in its head that marks the
// document first, and styles.css keeps a marked document's switch out of
// sight until nav.js has rewritten it.

const dir = new URL('../../', import.meta.url);
const read = (f) => readFileSync(new URL(f, dir), 'utf8');
const pages = readdirSync(dir).filter((f) => f.endsWith('.html'));
const withNav = pages.filter((f) => read(f).includes('class="appnav"'));
const early = (html) => /<script id="rooms-early">([\s\S]*?)<\/script>/.exec(html);

function run(code, store, { throwing = false } = {}) {
  const documentElement = { dataset: {} };
  const localStorage = {
    getItem(k) {
      if (throwing) throw new Error('denied');
      return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
    },
  };
  new Function('localStorage', 'document', code)(localStorage, { documentElement });
  return documentElement.dataset;
}

test('every page with the switch marks itself before it can paint', () => {
  assert.ok(withNav.length >= 5, `only ${withNav.length} pages with the switch`);
  const scripts = new Set();
  for (const page of withNav) {
    const html = read(page);
    const m = early(html);
    assert.ok(m, `${page} has no rooms-early script`);
    const at = html.indexOf('<script id="rooms-early">');
    assert.ok(at < html.indexOf('<link rel="stylesheet"') && at < html.indexOf('<body'), `${page}: in the head, before the stylesheets`);
    scripts.add(m[1]);
  }
  assert.equal(scripts.size, 1, 'every page runs the same script');
});

test('the early script marks every document, whatever this device stored', () => {
  const code = early(read('takes.html'))[1];
  assert.deepEqual(run(code, {}), { rooms: '' });
  assert.deepEqual(run(code, { 'hindsight.rooms': '0' }), { rooms: '' });
  assert.deepEqual(run(code, {}, { throwing: true }), { rooms: '' }, 'no storage: still the rooms, and no throw');
});

test('a marked switch is out of sight until nav.js has rewritten it, and never for good', () => {
  const css = read('styles.css');
  const rule = /:root\[data-rooms\] \.appnav:not\(\.appnav-rooms\)\s*\{([^}]*)\}/.exec(css);
  assert.ok(rule, 'styles.css hides a marked switch until it is .appnav-rooms');
  assert.match(rule[1], /visibility:\s*hidden/, 'hidden, but in its place: nothing jumps when it shows');
  // If nav.js never runs, the switch must still show: it's the way between
  // the pages (AGENTS.md: never hide the only route to something).
  const anim = /animation:\s*([\w-]+)\s+0s\s+\w+\s+([\d.]+)s\s+forwards/.exec(rule[1]);
  assert.ok(anim, 'it shows itself after a delay, whatever happens');
  assert.ok(Number(anim[2]) <= 3, 'within a few seconds');
  assert.match(css, new RegExp(`@keyframes ${anim[1]}\\s*\\{\\s*to\\s*\\{\\s*visibility:\\s*visible`));
  assert.ok(!/display:\s*none/.test(rule[1]));
});
