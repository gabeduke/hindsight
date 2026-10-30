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

test('Guardrail 1: doorway.js follows the bar by its controller, not 2Hz DOM scraping, and draws no reels of its own', () => {
  // The deck, which mounted ReelWindow for its reels, left the room with the
  // library (docs/plan/the-studio-space.md): the bar is the one with reels.
  const doorway = read('lib/room/doorway.js');
  assert.ok(doorway.includes('np?.onChange?.('), 'doorway.js hears the bar change through its controller');
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

test('Guardrail 2b: no stylesheet turns a reel or a hub by @keyframes: they turn by their models, on the ticker', () => {
  // The cassette's hubs went round by a CSS spin, at one speed whatever the
  // packs, until they were rendered (lib/objects/spin.js) and turned by
  // lib/scene/cassette.js.
  for (const file of ['styles.css', 'objects.css', 'css/bar.css', 'css/chrome.css', 'css/notes.css', 'css/rooms-motion.css']) {
    const css = fileCss(file);
    for (const [, name, body] of css.matchAll(/@keyframes\s+([\w-]+)\s*\{([\s\S]*?\})\s*\}/g)) {
      assert.ok(!/rotate\(\s*360deg|turn\)/.test(body), `${file}: @keyframes ${name} spins something`);
    }
  }
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

test('Guardrail 6: Studio swimlanes have a collapse toggle', () => {
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
      if (url === '/api/tapes/cue/grab') {
        return {
          ok: true,
          json: async () => ({ edit: { op: 'cue-grab', cue_clip: { id: 'c1' } } }),
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
  const grabCall = calls.find((c) => c.url === '/api/tapes/cue/grab');
  assert.ok(grabCall, 'grabToStudio must POST to /api/tapes/cue/grab: the loaded tape’s cue lane');
  src.destroy();
});

test('Guardrail 9: one notes drawer, the shell’s and Open’s, renames, stars and tags a take without leaving the room; no room has notes of its own', () => {
  const drawer = read('lib/room/drawer.js');
  for (const id of ['notes-name', 'notes-star', 'notes-tag', 'notes-words']) assert.ok(drawer.includes(`'${id}'`), `drawer.js makes #${id}`);
  assert.match(drawer, /createSheet\(/, 'the drawer is a sheet (lib/ui/sheet.js), not a drag of its own');
  assert.match(read('lib/shell/boot.js'), /createNotesDrawer\(/, 'the shell mounts it');
  assert.match(read('lib/room/open.js'), /createNotesDrawer\(/, 'and Open does');
  for (const f of ['lib/room/doorway.js', 'lib/shell/views/room.js', 'lib/shell/views/studio.js']) {
    assert.doesNotMatch(read(f), /setOnNote|room-book|Sketchbook/, `${f}: ✎ is the shell’s drawer`);
  }
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



// ---- one press: the gestures' times live in lib/ui/press.js -----------------
// A components audit found eleven holds with four thresholds, three slops and
// three double-tap rules, each a copy with its own number. GESTURE is now the
// one table of them, and this is the ratchet that keeps it so. Outside
// lib/ui/press.js (and tests), with comments stripped, it fails on:
//   A. a name for a hold, a double, a tap, a slop or a grace -- a word of
//      HOLD_MS, holdMs, DOUBLE_PX, TAP_MOVE, CLICK_GRACE_MS, SLOP_PX, or
//      MOVE_PX -- given a bare number (`HOLD_MS = 350`, `hold: 500`);
//   B. a setTimeout or setTimer whose delay is a bare number equal to one of
//      GESTURE's thresholds (`setTimeout(fn, 300)`: an inline hold);
//   C. a difference compared with a bare number equal to one of them
//      (`now - lastTap < 300`: an inline double tap).
// What it finds that is no gesture is listed below, with why. Name a new
// gesture's time in GESTURE and import it; a number that only looks like one
// goes on the list, with its reason.
const NOT_GESTURES = [
  // [where: what, how many, why it is no gesture]
  ['lib/meter.js: CAPTURE_ERR_HOLD_MS = 3500', 1, 'how long a capture error stays on screen'],
  ['lib/bar/handoff.js: HOLD_MS = 4000', 1, 'how long the bar stays blank for a carried take'],
  ['lib/models/transport.js: HOLD_MS = 1000', 1, 'how long a press or a locate is shown over polls already on their way'],
  ['lib/tape/overview.js: GRAB_SLOP = 8', 1, 'a hit margin either side of the window, not a finger’s travel'],
  ['lib/wave/page.js: setTimeout(…, 300)', 4, 'saves and fetches after a pause (debounces)'],
  ['lib/settings.js: setTimeout(…, 600)', 1, 'a reload once a restart is under way'],
  ['lib/rig/page.js: setTimeout(…, 600)', 1, 'a reload once a restart is under way'],
  ['lib/tape/page.js: barShownAt < 300', 1, 'the action bar’s click shield, timed with waitForBar to the browser’s own double-click'],
  ['lib/tape/page.js: pressedOutside < 400', 1, 'a focusout this soon after a press outside an inspector is the press’s, not a refill’s'],
];

function gestureLiterals() {
  const files = [];
  const walk = (dir) => {
    for (const d of fs.readdirSync(path.join(STATIC, dir), { withFileTypes: true })) {
      const rel = dir ? `${dir}/${d.name}` : d.name;
      if (d.isDirectory()) { if (rel !== 'fonts') walk(rel); } else if (d.name.endsWith('.js') && !d.name.endsWith('.test.js')) files.push(rel);
    }
  };
  walk('');
  return files.filter((f) => f !== 'lib/ui/press.js').map((f) => [f, read(f)]);
}

test('Guardrail 11: no hold or double-tap time is a literal outside lib/ui/press.js', async () => {
  const { GESTURE } = await import('./ui/press.js');
  // GESTURE's thresholds: the holds, and every *_MS but the repeat's step.
  const times = new Set([...Object.values(GESTURE.HOLD),
    ...Object.entries(GESTURE).filter(([k, v]) => k.endsWith('_MS') && k !== 'REPEAT_MS' && typeof v === 'number').map(([, v]) => v)]);
  const GESTURE_WORDS = new Set(['hold', 'double', 'tap', 'slop', 'grace']);
  const words = (name) => name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase().split(/_+/);
  const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  const found = new Map();
  const add = (k) => found.set(k, (found.get(k) || 0) + 1);
  for (const [f, raw] of gestureLiterals()) {
    const src = strip(raw);
    // A. A gesture's name, given a bare number.
    for (const m of src.matchAll(/\b([A-Za-z_$][\w$]*)\s*(?:=(?!=)|:)\s*([1-9][\d_]*(?:\.\d+)?)\b/g)) {
      if (words(m[1]).some((w) => GESTURE_WORDS.has(w)) || /move_?px/i.test(m[1])) add(`${f}: ${m[1]} = ${m[2]}`);
    }
    // B. A timer whose delay is a bare number, one of GESTURE's: the delay is
    // the call's last argument, found by matching its brackets.
    for (const m of src.matchAll(/\b(setTimeout|setTimer)\(/g)) {
      let i = m.index + m[0].length, depth = 1, quote = null, lastComma = -1;
      for (; i < src.length && depth; i++) {
        const c = src[i];
        if (quote) { if (c === '\\') i++; else if (c === quote) quote = null; continue; }
        if (c === '"' || c === "'" || c === '`') quote = c;
        else if ('([{'.includes(c)) depth++;
        else if (')]}'.includes(c)) depth--;
        else if (c === ',' && depth === 1) lastComma = i;
      }
      const delay = lastComma < 0 ? '' : src.slice(lastComma + 1, i - 1).trim();
      if (/^\d+$/.test(delay) && times.has(Number(delay))) add(`${f}: ${m[1]}(…, ${delay})`);
    }
    // C. A time difference held against a bare number, one of GESTURE's.
    for (const m of src.matchAll(/-\s*([\w$.]+(?:\(\))?)\s*(<=?)\s*(\d+)\b/g)) {
      if (times.has(Number(m[3]))) add(`${f}: ${m[1]} ${m[2]} ${m[3]}`);
    }
  }
  const allowed = new Map(NOT_GESTURES.map(([k, n]) => [k, n]));
  const extra = [...found].filter(([k, n]) => n > (allowed.get(k) || 0)).map(([k, n]) => `${k} (×${n})`);
  assert.deepEqual(extra, [],
    'a gesture time written out where GESTURE (lib/ui/press.js) should be imported; if it is no gesture, add it to NOT_GESTURES with why');
  // The ratchet only turns one way: one that has gone comes off the list.
  const gone = [...allowed].filter(([k, n]) => (found.get(k) || 0) < n).map(([k, n]) => `${k} (×${n}, found ${found.get(k) || 0})`);
  assert.deepEqual(gone, [], 'these are on NOT_GESTURES but no longer in the code: lower or remove them');
});

// ---- one way to close things: the stack in lib/ui/layers.js ---------------------
// Three schemes for Back once grew (the phone's player, the cassette sheet,
// Open's notes pane), each with its own history entry, and Escape ladders
// that had to know about each other's menus. Back and Escape now close the
// top of one stack (docs/architecture/shell.md, "One way to close
// things"). The ratchet: only the router and the stack write history
// entries; what still keeps its own is listed, with why, and comes off the
// list when it moves onto the stack.
const OWN_HISTORY = [
  // [file, how many pushState calls, why it is still its own]
  ['lib/shell/router.js', 1, 'a room’s entry'],
  ['lib/ui/layers.js', 1, 'the stack’s one entry, where there is no CloseWatcher'],
  ['lib/wave/page.js', 1, 'Open’s notes pane on a phone, until it is the notes drawer (listening-back.md, step 2)'],
];

test('Guardrail 12: only the router and the stack (lib/ui/layers.js) push history entries', () => {
  const found = new Map();
  for (const [f, raw] of gestureLiterals()) {
    if (f.endsWith('bar-harness.js') || f.endsWith('fake-dom.js')) continue; // stand-ins for tests
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
    const n = (src.match(/\.pushState\(/g) || []).length;
    if (n) found.set(f, n);
  }
  const allowed = new Map(OWN_HISTORY.map(([f, n]) => [f, n]));
  const extra = [...found].filter(([f, n]) => n > (allowed.get(f) || 0)).map(([f, n]) => `${f} (×${n})`);
  assert.deepEqual(extra, [], 'a history entry of its own: open the thing on the page’s stack (lib/ui/layers.js) instead, and Back closes it');
  const gone = [...allowed].filter(([f, n]) => (found.get(f) || 0) < n).map(([f, n]) => `${f} (×${n}, found ${found.get(f) || 0})`);
  assert.deepEqual(gone, [], 'these are on OWN_HISTORY but no longer push: take them off');
});

test('Guardrail 12: the Studio’s Escape is the stack’s; its page keeps it only for a preview', () => {
  const src = read('lib/tape/page.js');
  const escapes = src.match(/key === 'Escape'/g) || [];
  assert.equal(escapes.length, 1, 'lib/tape/page.js handles Escape itself only for a previewed Insert, Delete time or Paste');
  assert.match(src, /e\.key === 'Escape' && state\.preview && underSelection\(\)\) \{\s*e\.preventDefault\(\);/,
    'and it claims the press (preventDefault), so the stack leaves it be');
  assert.doesNotMatch(src, /menuWasOpen/, 'no ladder that has to know whether a menu was open');
});

// ---- one menu: lib/ui/menu.js ----------------------------------------------------
// Six menus had grown five ways of being placed, two of being dismissed,
// arrow keys in some, and rows of 40 px beside rows of 48. A menu, or a
// key's ▾ panel, is now menu() or splitKey() (lib/ui/menu.js), which says
// so to assistive tech itself. The ratchet: a button that says it opens
// something (aria-haspopup) is set up in menu.js, and what still does it
// on its own is listed, with why, and comes off the list when it moves.
const OWN_MENUS = [
  // [file, how many aria-haspopup, why it is still its own]
  ['lib/wave/lanes.js', 1, 'Open’s lane menus, until Open’s pass (step 10)'],
  ['lib/wave/page.js', 1, 'Open’s menus shut one another by it, until Open’s pass'],
  ['lib/room/open.js', 1, 'the tag key opens a sheet, not a menu'],
];

test('Guardrail 13: a menu or a ▾ panel is lib/ui/menu.js’s', () => {
  const found = new Map();
  for (const [f, raw] of gestureLiterals()) {
    if (f === 'lib/ui/menu.js' || f.endsWith('bar-harness.js') || f.endsWith('fake-dom.js')) continue;
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
    const n = (src.match(/aria-haspopup/g) || []).length;
    if (n) found.set(f, n);
  }
  const allowed = new Map(OWN_MENUS.map(([f, n]) => [f, n]));
  const extra = [...found].filter(([f, n]) => n > (allowed.get(f) || 0)).map(([f, n]) => `${f} (×${n})`);
  assert.deepEqual(extra, [], 'a menu of its own: make it with menu() or splitKey() (lib/ui/menu.js) instead');
  const gone = [...allowed].filter(([f, n]) => (found.get(f) || 0) < n).map(([f, n]) => `${f} (×${n}, found ${found.get(f) || 0})`);
  assert.deepEqual(gone, [], 'these are on OWN_MENUS but no longer set up a menu of their own: take them off');
});

test('Guardrail 14: only the takes model (lib/models/takes.js) asks /api/jams; every list of takes is the page’s', () => {
  // docs/architecture/push.md, *The takes' revision*: one list a page, asked
  // for when the Pi says it moved. A module with a fetch of its own asks the
  // Pi again for what the page already holds. The takes model reads them by
  // noun from the protocol client, the one module that names the route.
  const found = [];
  for (const [f, raw] of gestureLiterals()) {
    if (f === 'lib/models/protocol.js') continue;
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
    if (/['"`]\/api\/jams\b/.test(src)) found.push(f);
  }
  assert.deepEqual(found, [], 'asks /api/jams itself: take the page’s takes (ctx.takes, the engine’s, or createTakes on a page of its own) instead');
});

// ---- the components: lib/components/ ---------------------------------------
// The kit (docs/architecture/components.md; docs/plan/components.md, 1.5): a
// component draws inside the root it is given, from its models' snapshots,
// and does at window or document level only what goes through cx
// (lib/components/mount.js). Enforced by directory, over every file under
// lib/components/ (comments stripped, tests left out), with no list of
// exceptions: a module moves in once it keeps every rule.
const COMPONENT_RULES = [
  [/\bfetch\(/, 'fetches: asking the Pi is a model’s'],
  [/\bWebSocket\b|\bconnectSocket\b/, 'opens a socket: the push is a model’s'],
  [/['"`]\/api\//, 'names a route: that is lib/models/protocol.js’s'],
  [/\bdocument\s*\.\s*(getElementById|querySelector|querySelectorAll|body)\b/, 'reaches outside its root (a sheet or a drag’s ghost is a lib/ui interface)'],
  [/\b(window|document|globalThis|self)\s*\.\s*addEventListener\b|(^|[^.\w$])addEventListener\(/m, 'listens on the window or the document: cx.on'],
  [/\bsetInterval\(/, 'polls: a model asks, and cx.loop steps what is drawn'],
  [/hindsight:/, 'says or hears a page-wide event: a model’s onChange, a verb, or a callback the surface passes'],
  [/\bnew\s+Audio\b/, 'makes audio: the engine’s'],
  [/\blocation\s*[.=]|\bhistory\s*\./, 'moves the page: cx.go, or the stack'],
  [/\bid="|\.id\s*=\s*['"`]|setAttribute\(\s*['"]id['"]/, 'writes an id of its own: cx.id(), from its root’s'],
];

/** componentFiles is every module under lib/components/, tests left out. */
function componentFiles() {
  const out = [];
  const walk = (dir) => {
    for (const d of fs.readdirSync(path.join(STATIC, dir), { withFileTypes: true })) {
      const rel = `${dir}/${d.name}`;
      if (d.isDirectory()) walk(rel);
      else if (d.name.endsWith('.js') && !d.name.endsWith('.test.js')) out.push(rel);
    }
  };
  walk('lib/components');
  return out;
}

test('Guardrail 15: a component draws inside its root, from its models, and reaches the page only through cx', () => {
  const files = componentFiles();
  assert.ok(files.includes('lib/components/mount.js'), 'the walk finds lib/components/');
  const found = [];
  for (const f of files) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
    for (const [re, why] of COMPONENT_RULES) if (re.test(src)) found.push(`${f}: ${why}`);
    // A hold of its own: a timer beside a press.
    if (/\bsetTimeout\(/.test(src) && /pointerdown/.test(src)) found.push(`${f}: a hold of its own: pressMachine or bindPress (lib/ui/press.js)`);
  }
  assert.deepEqual(found, []);
});

// reaches is what a selector reaches into: its compounds before the last,
// with what is inside :has() left out (laying out around a root is not
// reaching into it) and the spaces inside brackets closed up.
function reaches(sel) {
  return sel.replace(/\(([^()]*)\)/g, (m) => m.replace(/\s+/g, '')).replace(/:has\([^()]*\)/g, '')
    .split(/\s*[>+~]\s*|\s+/).filter(Boolean).slice(0, -1);
}

test('Guardrail 15: each component is { id, root, needs, css, mount }, has its harness check, and its stylesheet is its own', async () => {
  const { lacks } = await import('./components/mount.js');
  const { rules } = await import('./stylesheets.js');
  const dirs = fs.readdirSync(path.join(STATIC, 'lib/components'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  assert.ok(dirs.length > 0, 'a component, or this checks nothing');
  const sheets = fs.readdirSync(STATIC, { recursive: true }).filter((f) => f.endsWith('.css')).map((f) => f.split(path.sep).join('/'));
  const problems = [];
  for (const id of dirs) {
    const file = `lib/components/${id}/index.js`;
    if (!fs.existsSync(path.join(STATIC, file))) { problems.push(`${id}: a component is its directory’s index.js`); continue; }
    const def = (await import(`./components/${id}/index.js`)).default;
    const missing = lacks(def);
    if (missing.length) { problems.push(`${file}: exports no good ${missing.join(', ')}`); continue; }
    if (def.id !== id) problems.push(`${file}: its id is ${def.id}, its directory ${id}`);
    if (!fs.existsSync(path.join(STATIC, '..', '..', 'scripts', 'components', `${id}.check.mjs`))) problems.push(`${id}: no harness check (scripts/components/${id}.check.mjs)`);
    if (!sheets.includes(def.css)) { problems.push(`${id}: its stylesheet ${def.css} is not under web/static`); continue; }
    const cls = def.root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const at = new RegExp(`\\.${cls}(?![\\w-])`);
    const starts = new RegExp(`^\\.${cls}(?![\\w-])`);
    for (const r of rules(read(def.css), { file: def.css })) {
      for (const sel of r.sel) if (!starts.test(sel)) problems.push(`${def.css}:${r.line}: ${sel} doesn’t start at its root, .${def.root}`);
    }
    for (const sheet of sheets.filter((f) => f !== def.css)) {
      for (const r of rules(read(sheet), { file: sheet })) {
        for (const sel of r.sel) if (reaches(sel).some((c) => at.test(c))) problems.push(`${sheet}:${r.line}: ${sel} reaches inside .${def.root}, the ${id} component’s`);
      }
    }
  }
  assert.deepEqual(problems, []);
});
