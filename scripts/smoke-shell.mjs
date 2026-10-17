// Smoke-test the single shell document, persistent player, and view switching
// in a real browser against a running demo server:
//
//   npm install --no-save playwright@1.49.0 && npx playwright install chromium
//   HINDSIGHT_URL=http://127.0.0.1:5173 node scripts/smoke-shell.mjs
//
// Exits non-zero on any failure.

import { chromium } from 'playwright';

const BASE = process.env.HINDSIGHT_URL ?? 'http://127.0.0.1:5173';
const SHOTS = (process.argv.find((a) => a.startsWith('shots=')) || '').slice(6);
const failures = [];
let passes = 0;

const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`);
  if (ok) passes++;
  else failures.push(name);
};

if (!process.env.HINDSIGHT_URL) {
  console.log(`Note: HINDSIGHT_URL not set; defaulting to ${BASE}`);
}

const browser = await chromium.launch({
  args: ['--autoplay-policy=no-user-gesture-required'],
});

const getJSON = async (path) => (await fetch(`${BASE}${path}`)).json();
const postJSON = async (path, body = {}) => (await fetch(`${BASE}${path}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})).json();

// Seed a take and a tape on the demo if missing
try {
  const jams = await getJSON('/api/jams');
  if (!(jams.length || jams.takes?.length)) {
    await fetch(`${BASE}/api/trigger?seconds=30`, { method: 'POST' });
  }
  const tapes = await getJSON('/api/tapes');
  if (!tapes.loaded) {
    const t = await postJSON('/api/tapes', { name: 'ShellSmoke', bpm: 96, bars: 4 });
    if (t?.id) await postJSON(`/api/tapes/load?id=${encodeURIComponent(t.id)}`);
  }
} catch (e) {
  console.warn(`Seed check: could not reach ${BASE}: ${e.message}`);
}

const PROFILES = [
  { tag: 'laptop-desktop', size: { width: 1440, height: 900 }, hasTouch: false },
  { tag: 'tablet-touch', size: { width: 1024, height: 768 }, hasTouch: true },
];

for (const { tag, size, hasTouch } of PROFILES) {
  console.log(`\n=== Running Shell Flows [${tag}] ===`);
  const ctx = await browser.newContext({ viewport: size, hasTouch });
  const p = await ctx.newPage();
  const pageErrors = [];
  p.on('pageerror', (e) => {
    pageErrors.push(e.message);
    check(`${tag}: pageerror: ${e.message}`, false);
  });

  // Flow 1: Boot at /tape.html -> Studio view mounts
  await p.goto(`${BASE}/tape.html`);
  await p.waitForTimeout(1500);

  const studioShown = await p.evaluate(() => {
    const v = document.getElementById('view-studio');
    return v && !v.hidden && v.classList.contains('view');
  });
  check(`${tag}: Studio view (#view-studio) mounted and visible at /tape.html`, studioShown);

  const npVisible = await p.evaluate(() => {
    const np = document.getElementById('np');
    return np && !np.hidden;
  });
  check(`${tag}: Media player (#np) mounted in dock`, npVisible);

  // Flow 2: Global Dialogs are available in DOM from boot (no missing phone-sheet or settings)
  const dialogsCheck = await p.evaluate(() => {
    const settings = document.getElementById('settings-sheet');
    const update = document.getElementById('update-sheet');
    const phone = document.getElementById('phone-sheet');
    return {
      settings: !!settings,
      update: !!update,
      phone: !!phone,
    };
  });
  check(
    `${tag}: Global dialog sheets exist in DOM at boot`,
    dialogsCheck.settings && dialogsCheck.update && dialogsCheck.phone,
    JSON.stringify(dialogsCheck),
  );

  // Flow 3: Switch from Studio to Listening Room gaplessly
  await p.click('.appnav a[data-tab="room"]');
  await p.waitForTimeout(1500);

  const roomState = await p.evaluate(() => {
    const room = document.getElementById('view-room');
    const studio = document.getElementById('view-studio');
    const navRoom = document.querySelector('.appnav a[data-tab="room"]');
    return {
      roomVisible: room && !room.hidden,
      studioHidden: studio && studio.hidden,
      navCurrent: navRoom?.getAttribute('aria-current') === 'page',
      url: location.pathname,
    };
  });
  check(
    `${tag}: Switched to Listening Room via pushState`,
    roomState.roomVisible && roomState.studioHidden && roomState.navCurrent && roomState.url === '/takes.html',
    JSON.stringify(roomState),
  );

  // Flow 4: Media player persistence across room moves
  const shelfTakes = await p.evaluate(() => document.querySelectorAll('#takes .take-row, .room-cassette').length);
  if (shelfTakes > 0) {
    // Click first take to start playing
    await p.locator('#takes .take-row, .room-cassette').first().click();
    await p.waitForTimeout(1000);

    const playingBefore = await p.evaluate(() => {
      const btn = document.getElementById('np-play');
      const time = document.getElementById('np-time');
      return { play: btn?.textContent?.trim(), time: time?.textContent?.trim() };
    });

    // Move back to Studio while take is playing
    await p.click('.appnav a[data-tab="studio"]');
    await p.waitForTimeout(1500);

    const playingAfter = await p.evaluate(() => {
      const btn = document.getElementById('np-play');
      const time = document.getElementById('np-time');
      const studio = document.getElementById('view-studio');
      return {
        play: btn?.textContent?.trim(),
        time: time?.textContent?.trim(),
        studioVisible: studio && !studio.hidden,
      };
    });

    check(
      `${tag}: Audio playback persists across room transition`,
      playingAfter.studioVisible && playingAfter.play === '❚❚',
      `before: ${JSON.stringify(playingBefore)}, after: ${JSON.stringify(playingAfter)}`,
    );
  } else {
    console.log(`${tag}: (skip playback carry check: no shelf takes found)`);
  }

  // Flow 5: Collapsible Media Player Transport and Lanes Fold
  await p.click('.appnav a[data-tab="studio"]');
  await p.waitForTimeout(500);

  const foldToggle = await p.evaluate(() => {
    const btn = document.getElementById('np-fold-btn');
    if (!btn) return false;
    btn.click();
    return document.body.classList.contains('np-folded');
  });
  check(`${tag}: Transport fold toggle collapses player dock`, foldToggle);

  if (SHOTS) {
    await p.screenshot({ path: `${SHOTS}/shell-${tag}.png` });
  }

  check(`${tag}: Zero unhandled page errors during session`, pageErrors.length === 0, `${pageErrors.length} errors`);
  await ctx.close();
}

await browser.close();

console.log(`\n========================================`);
console.log(`Summary: ${passes} passed, ${failures.length} failed`);
if (failures.length > 0) {
  console.log(`Failed checks:`);
  for (const f of failures) console.log(`  - ${f}`);
  process.exit(1);
}
console.log('All shell user flows passed cleanly.');
process.exit(0);
