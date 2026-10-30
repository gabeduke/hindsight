import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { start } from './mount.js';

test('the Studio is loaded and mounted on the page', async () => {
  const doc = {};
  let got = null;
  const r = start({ load: async () => ({ mountStudio: (d) => { got = d; return 'mounted'; } }), doc });
  assert.equal(await r, 'mounted');
  assert.equal(got, doc);
});

// The page itself: the feed and its foot are templates that studio.js
// clones, so the tape page as served has none of Capture's parts outside
// them.
const tape = readFileSync(new URL('../../shell.html', import.meta.url), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
const live = tape.replace(/<template\b[\s\S]*?<\/template>/g, '');
const templates = [...tape.matchAll(/<template id="([^"]+)">([\s\S]*?)<\/template>/g)].map((m) => [m[1], m[2]]);
const inTemplate = (id) => templates.find(([t]) => t === id)?.[1] || '';

test('outside its templates the tape page has no feed, and nowhere an about line', () => {
  for (const id of ['viz-wrap', 'rb-sel', 'vu', 'meters', 'studio-keep', 'rb-flag-sheet', 'settings-sheet', 'update-sheet']) {
    assert.ok(!live.includes(`id="${id}"`), `#${id} is in the tape page outside the Studio's templates`);
  }
  assert.ok(!/class="[^"]*\babout\b/.test(tape), 'the about line is gone: Settings, Releases and the guide are the header’s');
  assert.ok(!/class="[^"]*\bstudio-/.test(live), 'a studio- class is in the tape page outside the Studio');
});

test("the Studio's templates carry the feed, KEEP, the input diagnostic and its sheets", () => {
  const feed = inTemplate('studio-feed-tpl');
  for (const id of ['viz-wrap', 'rb-sel', 'vu', 'meters', 'dur-seg', 'studio-keep', 'studio-keep-more', 'studio-keep-pop', 'studio-lamp']) assert.ok(feed.includes(`id="${id}"`), `the feed lacks #${id}`);
  // The input diagnostic and the readouts are behind the feed's lamp, in its
  // sheet (docs/plan/the-studio-on-one-screen.md): no foot under the lanes.
  assert.ok(!tape.includes('studio-foot-tpl'), 'the foot is gone');
  const sheets = inTemplate('studio-sheets-tpl');
  for (const id of ['rb-flag-sheet', 'settings-sheet', 'update-sheet', 'feed-sheet', 'chan-diag', 'chan-grid', 'chan-saving', 'chan-device', 'midi-devices', 'stat-disk', 'stat-xruns', 'stat-tempo', 'studio-health']) {
    assert.ok(sheets.includes(`id="${id}"`), `the sheets lack #${id}`);
  }
});

test('the tape page loads the Studio through mount.js', () => {
  const studioViewSrc = readFileSync(new URL('../shell/views/studio.js', import.meta.url), 'utf8');
  assert.ok(live.includes('<script type="module" src="/lib/shell/boot.js"></script>'));
  assert.match(studioViewSrc, /from '\.\.\/\.\.\/rooms\/mount\.js'/);
  assert.ok(!live.includes('/lib/rooms/studio.js'), 'studio.js is loaded by mount.js, never by the page');
  assert.ok(!studioViewSrc.includes('rooms/studio.js'), 'studio.js is loaded by mount.js, never by the view');
});

// The Studio and the tape page share a page but import nothing of each
// other's; they speak in events. A GRAB onto the cue lane
// is an edit of the tape, which the drawer asks the page to look at again;
// nothing tells the tape page about a crate (F3).
test('the drawer tells the tape page the tape changed, and nothing about a crate', () => {
  const buffer = readFileSync(new URL('../buffer/buffer.js', import.meta.url), 'utf8');
  const tapePage = readFileSync(new URL('../tape/page.js', import.meta.url), 'utf8');
  assert.match(buffer, /new CustomEvent\('hindsight:tape-changed'\)/);
  assert.match(tapePage, /addEventListener\('hindsight:tape-changed', \(\) => \{ if \(viewActive\(\)\) poll\(true\); \}\)/);
  assert.doesNotMatch(buffer, /crate-changed/);
  assert.doesNotMatch(tapePage, /crate-changed/);
});
