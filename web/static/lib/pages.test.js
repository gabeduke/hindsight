// web/static/lib/pages.test.js
// What the pages' own markup promises, checked without a browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const dir = new URL('../', import.meta.url);
const pages = readdirSync(dir).filter((f) => f.endsWith('.html'));

// getElementById returns the first of two elements sharing an id, so the
// second can never be reached by it -- and nothing says so. Play mode's
// overlay was given the ▶ key's id, `play`, and mounted itself into the key:
// the transport lost its ▶ and Play mode never appeared.
test('no page uses an id twice', () => {
  assert.ok(pages.length >= 5, `found only ${pages.length} pages`);
  for (const page of pages) {
    // Comments first: commented-out markup is not on the page.
    const html = readFileSync(new URL(page, dir), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    const seen = new Map();
    for (const m of html.matchAll(/\sid="([^"]+)"/g)) seen.set(m[1], (seen.get(m[1]) || 0) + 1);
    const twice = [...seen].filter(([, n]) => n > 1).map(([id]) => id);
    assert.deepEqual(twice, [], `${page} uses these ids more than once`);
  }
});

// Settings has one way in, on every page: the header's (lib/nav.js
// mountHeaderTools), which styles.test.js keeps from being hidden. The about
// line that used to carry it at a page's foot is gone, and no page carries a
// second Settings of its own.
test('Settings is the header’s on every page, and no page has the old about line', () => {
  for (const page of pages) {
    const html = readFileSync(new URL(page, dir), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
    assert.ok(!html.includes('id="settings-btn"'), `${page} carries a Settings of its own`);
    assert.ok(!/class="about"/.test(html), `${page} still has the about line`);
  }
  const nav = readFileSync(new URL('lib/nav.js', dir), 'utf8');
  assert.match(nav, /set\.id = 'appbar-settings-btn'/, 'the header makes Settings on every page');
});

// With the tape on, `/` goes to the Studio, so Capture can't be reached at
// all: whatever Capture had must be in the Studio (the tape
// page, its own markup or the Studio's templates), or somewhere else named
// here. A control left behind with no way in is the AGENTS.md rule broken
// -- the Phone key and Flag now were, once.
const ELSEWHERE = {
  'studio-redirect': "index.html's own: the redirect itself",
  awake: 'the Studio holds the wake lock without the header icon',
  'health-dot': "the Studio tab's lamp, and #studio-health in the feed",
  'health-text': '#studio-health in the feed, with the full text in its title and a toast',
  'stat-buffered': "the ribbon's readout says how much is buffered",
  'capture-btn': 'KEEP, #studio-keep',
  'cap-word': 'KEEP, #studio-keep-word',
  'cap-sub': 'KEEP, #studio-keep-sub',
  'last-saved': "KEEP's toast names the take; it's on the Listening Room's shelf",
  takes: 'the Listening Room (takes.html)',
  'takes-empty': 'the Listening Room (takes.html)',
  'all-takes': 'the Listening Room tab',
  'all-count': 'the Listening Room (takes.html)',
  'np-start': "the tape page's own deck (#to-start)",
  'np-back5': "the tape page's J key; a take's ↺ 5 s is the Listening Room's bar",
  'np-play': "the tape page's own deck (#play)",
  'np-loop': "the tape page's own deck (#loop)",
  'np-eject': "the Listening Room's bar, which holds a take pressed on a spine",
  'np-open': 'the Studio is the tape',
  'np-scrub': "the tape page's own deck (#tape-overview)",
  'np-out': "the tape page's own deck (#tape-out)",
};
test('everything on Capture has a way in from the Studio', () => {
  const ids = (page) => new Set([...readFileSync(new URL(page, dir), 'utf8').replace(/<!--[\s\S]*?-->/g, '')
    .matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  const studio = ids('tape.html');
  const stranded = [...ids('index.html')].filter((id) => !studio.has(id) && !(id in ELSEWHERE));
  assert.deepEqual(stranded, [], "Capture's, and nowhere in the Studio: bring them in, or say where they went");
  for (const id of Object.keys(ELSEWHERE)) assert.ok(!studio.has(id), `#${id} is in the Studio now: take it off the list`);
});
