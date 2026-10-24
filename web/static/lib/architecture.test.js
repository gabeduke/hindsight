import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileCss } from './stylesheets.js';

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
  const css = fileCss('styles.css');
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

test('Guardrail 4: styles.css hides what a room replaces from frame 0, not after an async class', () => {
  const css = fileCss('styles.css');
  // The doorway's rack is out of sight before lib/room/mount.js has put
  // .room-on on the body: a rule that needs no class a module adds.
  const rules = [...css.matchAll(/([^{}]*#takes\b[^{}]*)\{([^}]*)\}/g)]
    .filter((m) => /display\s*:\s*none/.test(m[2]))
    .flatMap((m) => m[1].split(/,(?![^(]*\))/).map((x) => x.trim()));
  assert.ok(
    rules.some((sel) => /^body:not\(\.room-rack\) /.test(sel) && !sel.includes('.room-on')),
    'styles.css must hide #takes on the doorway before JS finishes loading',
  );
  // The two rooms are the only layout: nothing sets :root[data-rooms] any
  // more, so a rule gated on it would never match.
  assert.doesNotMatch(css, /data-rooms/, 'styles.css must not gate a rule on the retired :root[data-rooms]');
});

test('Guardrail 5: Unified Media Player provides FeedSource and 3-way source selector (Feed · Tape · Shelf)', () => {
  const feedSourcePath = path.join(STATIC, 'lib/bar/feed-source.js');
  assert.ok(
    fs.existsSync(feedSourcePath),
    'lib/bar/feed-source.js must exist for the live studio feed source',
  );
  // The bar draws it (bar.js, take-keys.js); its engine switches (engine.js).
  const barJs = read('lib/bar/bar.js') + read('lib/bar/engine.js');
  assert.ok(
    barJs.includes('np-source-switch') || barJs.includes('setSource'),
    'lib/bar/bar.js and engine.js must expose the 3-way source switcher (feed, tape, take)',
  );
});

test('Guardrail 6: Instrument strip mounts inside #np Media Player and Studio swimlanes have a collapse toggle', () => {
  const stripJs = read('lib/play/strip.js');
  assert.ok(
    stripJs.includes('np.prepend(') || stripJs.includes('np.insertBefore('),
    'lib/play/strip.js must mount #play-strip inside #np as part of the Media Player object',
  );
  const tapeHtml = read('shell.html');
  assert.ok(
    tapeHtml.includes('id="tracks-fold-btn"'),
    'shell.html must include #tracks-fold-btn to collapse/expand Studio tape swimlanes',
  );
});

test('Guardrail 7: the header’s one menu, top right, houses Settings, the rig, help, the guide and Releases', () => {
  const navJs = read('lib/nav.js');
  assert.ok(
    ['app-menu', 'appbar-settings-btn', 'app-menu-rig', 'app-menu-help', 'appbar-guide-link', 'appbar-releases-btn'].every((k) => navJs.includes(k)),
    'lib/nav.js must mount the menu and its items in .appbar-end',
  );
});

test('Guardrail 8: FeedSource polls live envelope, draws waveform trace on #np-scrub, and supports grabToStudio()', async () => {
  const { feedSource } = await import('./bar/feed-source.js');
  const calls = [];
  const src = feedSource({
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      if (url === '/api/status') {
        return {
          ok: true,
          json: async () => ({
            ring_seconds: 180,
            buffered_seconds: 120,
            capture_healthy: true,
            channel_rms: [-14.2, -16.0],
          }),
        };
      }
      if (url.startsWith('/api/envelope')) {
        return {
          ok: true,
          json: async () => ({
            bins: [0.2, 0.5, 0.8, 0.4],
          }),
        };
      }
      if (url === '/api/clipboard') {
        return {
          ok: true,
          json: async () => ({ status: 'ok' }),
        };
      }
      return { ok: false };
    },
    forTape: () => {},
  });

  src.play();
  await new Promise((r) => setTimeout(r, 10));
  src.pause();

  assert.equal(src.length, 120 * 48000);
  src.seek(60 * 48000);
  assert.equal(src.offsetSeconds, 60);

  const href = await src.grabToStudio({ seconds: 15 });
  assert.equal(href, '/tape.html');
  const clipCall = calls.find((c) => c.url === '/api/clipboard');
  assert.ok(clipCall, 'grabToStudio must POST to /api/clipboard');
  src.destroy();
});

test('Guardrail 9: Listening Room inline Sketchbook supports renaming, starring, and tagging without leaving the room', () => {
  const doorway = read('lib/room/doorway.js');
  assert.ok(
    doorway.includes('room-book-star') &&
      doorway.includes('room-book-tag') &&
      doorway.includes('room-book-name-input'),
    'doorway.js must provide inline star, tag, and name controls inside #room-sketchbook',
  );
});

test('Guardrail 10: Studio swimlane collapse state persists in sessionStorage and auto-unfolds on hindsight:tape-changed', () => {
  const tapePage = read('lib/tape/page.js');
  assert.ok(
    tapePage.includes('hindsight.tracksFold'),
    'tape/page.js must persist tracks-fold state in sessionStorage under hindsight.tracksFold',
  );
  assert.ok(
    tapePage.includes('applyTracksFold(false)'),
    'tape/page.js must unfold lanes when hindsight:tape-changed fires',
  );
});

test('Step 5a: only lib/bar writes the LCD ids (#position, #np-time, #np-unit, #np-status, #np-marquee, #np-mini) in the rooms', () => {
  const lcdIds = ['position', 'np-time', 'np-unit', 'np-status', 'np-marquee', 'np-mini'];
  const writeRe = new RegExp(`\\$\\(['"](${lcdIds.join('|')})['"]\\)`);
  const roomFiles = [
    'app.js',
    'lib/tape/page.js',
    'lib/shell/views/room.js',
  ];
  for (const rel of roomFiles) {
    const src = read(rel);
    assert.doesNotMatch(
      src,
      writeRe,
      `${rel} must not write LCD ids directly; NowPlaying (lib/bar/bar.js) owns the LCD`,
    );
  }
});

test('Step 5c: rooms/studio.js does not construct its own Audio or shadow .np-source-switch', () => {
  const src = read('lib/rooms/studio.js');
  assert.equal(/\bnew\s+Audio\s*\(/.test(src), false, 'rooms/studio.js must not construct new Audio(); engine.js owns the bar’s audio');
  assert.equal(/np-source-switch/.test(src), false, 'rooms/studio.js must not build a shadow .np-source-switch; takeKeys in bar.js owns it');
});

test('Step 8: room views and bar engine do not hardcode location assignments to room paths', () => {
  const roomRe = /(?:location\.href\s*=|location\.(?:assign|replace)\()\s*['"`](?:\/|\/index\.html|\/tape\.html|\/takes\.html)['"`]/;
  const files = [
    'lib/bar/engine.js',
    'lib/shell/views/room.js',
    'lib/shell/views/studio.js',
    'lib/shell/views/capture.js',
  ];
  for (const rel of files) {
    const src = read(rel);
    assert.doesNotMatch(
      src,
      roomRe,
      `${rel} must not assign location to a room path directly; navigation must go through router/ctx.go`,
    );
  }
});



