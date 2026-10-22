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

// Settings has one way in, on every page: the header's menu (lib/nav.js
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
  assert.match(nav, /id: 'appbar-settings-btn'/, 'the header’s menu makes Settings on every page');
});

// The shell puts #np inside #np-dock in every room (Phase 1, step 4), so both
// rooms share one bar at .np-dock > .np and the dock sticks at the foot.
test('the Listening Room’s bar sits in .np-dock > .np, as the Studio’s does', () => {
  const shell = readFileSync(new URL('shell.html', dir), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  assert.match(shell, /<div id="np-dock" class="np-dock">[\s\S]*?<section id="np" class="np"/, 'shell.html wraps #np in #np-dock');
  const css = readFileSync(new URL('styles.css', dir), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /\.np-dock\s*\{[^}]*position:\s*sticky;\s*bottom:\s*0/, '.np-dock is sticky at bottom: 0');
  assert.doesNotMatch(css, /(?:main-page|shelf-page|room-on|selecting)[^,{]*>\s*\.np\b/, 'no room selector assumes body > .np');
});


// The rooms are siblings. Capture was once added inside the Studio's <main>,
// which had no </main>: the Listening Room became a child of the hidden
// Studio and never showed on a Pi, while every test passed.
test('shell.html: each room view is a top-level <main>, not inside another', () => {
  const html = readFileSync(new URL('shell.html', dir), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const opens = [...html.matchAll(/<main\b|<\/main>/g)].map((m) => m[0]);
  let depth = 0;
  for (const t of opens) {
    depth += t === '</main>' ? -1 : 1;
    assert.ok(depth >= 0 && depth <= 1, 'a <main> opened inside another, or closed twice');
  }
  assert.equal(depth, 0, 'a <main> is never closed');
  assert.equal(opens.length / 2, 3, 'studio, capture and room: one <main> each');
});
