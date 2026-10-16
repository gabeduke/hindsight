import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STATIC = path.resolve(HERE, '..');

function read(rel) {
  return fs.readFileSync(path.join(STATIC, rel), 'utf8');
}

test('Guardrail 1: doorway.js uses ReelWindow and controller subscriptions, not 2Hz DOM scraping or static CSS reels', () => {
  const doorway = read('lib/room/doorway.js');
  assert.ok(
    doorway.includes('ReelWindow'),
    'doorway.js must mount ReelWindow from lib/objects/reel-window.js for the Hi-Fi deck',
  );
  assert.ok(
    !doorway.includes('room-deck-reel'),
    'doorway.js must not build static .room-deck-reel spans',
  );
  assert.ok(
    !doorway.includes('setInterval('),
    'doorway.js must not poll DOM state with setInterval',
  );
});

test('Guardrail 2: styles.css has no custom @keyframes room-spin animation outside lib/objects/', () => {
  const css = read('styles.css');
  assert.ok(
    !css.includes('@keyframes room-spin'),
    'Reel rotation must come from ReelMotion on the shared 60fps ticker, not @keyframes room-spin',
  );
});

test('Guardrail 3: tape/page.js interpolates playhead at 60fps on the shared ticker Loop', () => {
  const tapePage = read('lib/tape/page.js');
  assert.ok(
    tapePage.includes('Loop') && tapePage.includes('../objects/motion.js'),
    'tape/page.js must use Loop from ../objects/motion.js to step the playhead at 60fps',
  );
  assert.ok(
    tapePage.includes('heardNow('),
    'tape/page.js must interpolate heardNow() between 200ms network polls',
  );
});

test('Guardrail 4: styles.css gates legacy containers under :root[data-rooms] at frame 0 to prevent FOUC', () => {
  const css = read('styles.css');
  assert.match(
    css,
    /:root\[data-rooms\][^{]*#takes/,
    'styles.css must hide #takes under :root[data-rooms] before JS finishes loading',
  );
  assert.match(
    css,
    /:root\[data-rooms\][^{]*\.about/,
    'styles.css must hide legacy .about footer under :root[data-rooms]',
  );
});

test('Guardrail 5: Unified Media Player provides FeedSource and 3-way source selector (Feed · Tape · Shelf)', () => {
  const feedSourcePath = path.join(STATIC, 'lib/bar/feed-source.js');
  assert.ok(
    fs.existsSync(feedSourcePath),
    'lib/bar/feed-source.js must exist for the live studio feed source',
  );
  const barJs = read('lib/bar/bar.js');
  assert.ok(
    barJs.includes('np-source-switch') || barJs.includes('setSource'),
    'lib/bar/bar.js must expose the 3-way source switcher (feed, tape, take)',
  );
});

test('Guardrail 6: Instrument strip mounts inside #np Media Player and Studio swimlanes have a collapse toggle', () => {
  const stripJs = read('lib/play/strip.js');
  assert.ok(
    stripJs.includes('np.prepend(') || stripJs.includes('np.insertBefore('),
    'lib/play/strip.js must mount #play-strip inside #np as part of the Media Player object',
  );
  const tapeHtml = read('tape.html');
  assert.ok(
    tapeHtml.includes('id="tracks-fold-btn"'),
    'tape.html must include #tracks-fold-btn to collapse/expand Studio tape swimlanes',
  );
});

test('Guardrail 7: Top-right .appbar-end houses Settings, Releases, and Guide across pages when rooms is on', () => {
  const navJs = read('lib/nav.js');
  assert.ok(
    navJs.includes('appbar-settings-btn') &&
      navJs.includes('appbar-releases-btn') &&
      navJs.includes('appbar-guide-link'),
    'lib/nav.js must mount Settings, Releases, and Guide controls in .appbar-end when roomsOn() is true',
  );
});
