import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { start } from './mount.js';

// A document that fails the test if anything so much as looks at it.
const untouchable = () => new Proxy({}, {
  get(_, k) { throw new Error(`the page was touched: document.${String(k)}`); },
  set(_, k) { throw new Error(`the page was touched: document.${String(k)} =`); },
  has(_, k) { throw new Error(`the page was touched: ${String(k)} in document`); },
});

test('with the flag off the tape page draws no feed: nothing loaded, nothing touched', () => {
  let loaded = 0;
  const r = start({ flagOn: () => false, load: () => { loaded++; return Promise.resolve({}); }, doc: untouchable() });
  assert.equal(r, null);
  assert.equal(loaded, 0, "the Studio's module isn't even fetched");
});

test('with the flag on the Studio is loaded and mounted on the page', async () => {
  const doc = {};
  let got = null;
  const r = start({ flagOn: () => true, load: async () => ({ mountStudio: (d) => { got = d; return 'mounted'; } }), doc });
  assert.equal(await r, 'mounted');
  assert.equal(got, doc);
});

// The default reader is the real flag: the tests above pass their own.
test('by default it asks the flag in this device’s storage', async () => {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'localStorage');
  const prev = globalThis.localStorage;
  const m = new Map();
  globalThis.localStorage = { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
  try {
    let loaded = 0;
    const load = async () => { loaded++; return { mountStudio: () => 'mounted' }; };
    assert.equal(start({ load, doc: untouchable() }), null, 'no flag: off');
    m.set('hindsight.rooms', '1');
    assert.equal(await start({ load, doc: {} }), 'mounted');
    assert.equal(loaded, 1);
    m.set('hindsight.rooms', 'true');
    assert.equal(start({ load, doc: untouchable() }), null, 'only the exact value counts');
  } finally {
    if (had) globalThis.localStorage = prev; else delete globalThis.localStorage;
  }
});

// The page itself: the feed and its foot are templates, so the tape page as
// served -- the flag off -- has none of Capture's parts in it.
const tape = readFileSync(new URL('../../tape.html', import.meta.url), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const live = tape.replace(/<template\b[\s\S]*?<\/template>/g, '');
const templates = [...tape.matchAll(/<template id="([^"]+)">([\s\S]*?)<\/template>/g)].map((m) => [m[1], m[2]]);
const inTemplate = (id) => templates.find(([t]) => t === id)?.[1] || '';

test('with the flag off the tape page has no feed and no about line', () => {
  for (const id of ['viz-wrap', 'rb-sel', 'vu', 'meters', 'studio-keep', 'version', 'settings-btn', 'update-btn', 'releases-btn', 'rb-flag-sheet', 'settings-sheet', 'update-sheet']) {
    assert.ok(!live.includes(`id="${id}"`), `#${id} is in the tape page outside the Studio's templates`);
  }
  assert.ok(!/class="[^"]*\babout\b/.test(live), 'the about line is in the tape page outside the Studio');
  assert.ok(!/class="[^"]*\bstudio-/.test(live), 'a studio- class is in the tape page outside the Studio');
});

test("the Studio's templates carry the feed, KEEP, the about line and its sheets", () => {
  const feed = inTemplate('studio-feed-tpl');
  for (const id of ['viz-wrap', 'rb-sel', 'vu', 'meters', 'dur-seg', 'studio-keep']) assert.ok(feed.includes(`id="${id}"`), `the feed lacks #${id}`);
  const foot = inTemplate('studio-foot-tpl');
  assert.match(foot, /<p class="about">/);
  for (const id of ['version', 'releases-btn', 'settings-btn', 'update-btn']) assert.ok(foot.includes(`id="${id}"`), `the foot lacks #${id}`);
  assert.ok(foot.includes('href="/guide.html"'), 'the foot links the guide');
  const sheets = inTemplate('studio-sheets-tpl');
  for (const id of ['rb-flag-sheet', 'settings-sheet', 'update-sheet']) assert.ok(sheets.includes(`id="${id}"`), `the sheets lack #${id}`);
});

test('the tape page loads the Studio only through its flag', () => {
  assert.ok(live.includes('<script type="module" src="/lib/rooms/mount.js"></script>'));
  assert.ok(!live.includes('/lib/rooms/studio.js'), 'studio.js is loaded by mount.js, with the flag on, never by the page');
});

// The Studio and the tape page share a page but import nothing of each
// other's; they speak in events, as Play mode does. A grab that replaces a
// buffer nobody dropped puts it in the crate (the Studio's selection no
// longer offers Keep as clip: F1), so the buffer and the tape page must name
// the same event, and the tape page must read the crate on it.
test("the buffer's crated grab reaches the tape page's crate", () => {
  const buffer = readFileSync(new URL('../buffer/buffer.js', import.meta.url), 'utf8');
  const tapePage = readFileSync(new URL('../tape/page.js', import.meta.url), 'utf8');
  const sent = /b\.crated[^\n]*dispatchEvent\(new CustomEvent\('([^']+)'\)\)/.exec(buffer);
  assert.ok(sent, 'buffer.js dispatches an event when a grab puts the old buffer in the crate');
  const heard = new RegExp(`addEventListener\\('${sent[1]}', \\(\\) => fetchCrate\\(\\)\\)`);
  assert.match(tapePage, heard, `lib/tape/page.js reads the crate again on ${sent[1]}`);
});
