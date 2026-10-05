// Smoke-test the tape page in a real browser, against a running demo
// instance (set up as for scripts/smoke-takes.mjs):
//
//   HINDSIGHT_URL=http://127.0.0.1:15391 node scripts/smoke-tape.mjs
//
// It exits non-zero on any failure.
import { chromium } from 'playwright';

const BASE = process.env.HINDSIGHT_URL ?? 'http://127.0.0.1:5000';
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures.push(name);
};
const browser = await chromium.launch();

// On a phone, upright or sideways, the transport and Catch are on screen.
for (const [w, h] of [[390, 844], [844, 390]]) {
  const p = await (await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true })).newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${BASE}/tape.html`);
  await p.waitForTimeout(2000);
  const r = await p.evaluate(() => {
    const on = (s) => { const b = document.querySelector(s)?.getBoundingClientRect(); return !!b && b.top >= 0 && b.bottom <= innerHeight; };
    const tabs = document.querySelector('.appnav')?.getBoundingClientRect();
    const c = document.querySelector('#catch-pass').getBoundingClientRect();
    return { play: on('#play'), loop: on('#loop'), rec: on('#rec'), catch: on('#catch-pass'), aboveTabs: !tabs || tabs.top < innerHeight / 2 || c.bottom <= tabs.top + 1 };
  });
  check(`${w}x${h}: Play, Loop, Rec and Catch on screen`, r.play && r.loop && r.rec && r.catch, JSON.stringify(r));
  check(`${w}x${h}: the dock sits above the tabs`, r.aboveTabs);
  check(`${w}x${h}: no page errors`, errors.length === 0, errors.join('; '));
  await p.context().close();
}

// Track heads fit their lanes (no key wraps to a row of its own), the bench
// keeps all four tracks on screen, and every track shows its number.
for (const [w, h] of [[390, 844], [600, 960], [1024, 600], [1280, 800], [844, 390], [1440, 900]]) {
  const p = await (await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 900 })).newPage();
  await p.goto(`${BASE}/tape.html`);
  await p.waitForTimeout(1800);
  const r = await p.evaluate(() => {
    const rows = [...document.querySelectorAll('.tape-track')];
    const tall = rows.map((row) => Math.round(row.querySelector('.tt-head').getBoundingClientRect().height - row.querySelector('.tt-lane').getBoundingClientRect().height));
    const numbered = rows.every((row, i) => {
      const ring = row.querySelector('.tt-num');
      if (ring && getComputedStyle(ring).display !== 'none' && ring.textContent === String(i + 1)) return true;
      return getComputedStyle(row.querySelector('.tt-name'), '::before').content.includes(String(i + 1));
    });
    const last = rows.at(-1)?.getBoundingClientRect().bottom;
    return { tall, numbered, last: Math.round(last) };
  });
  check(`${w}x${h}: track heads are no taller than their lanes`, r.tall.every((d) => d <= 2), JSON.stringify(r.tall));
  check(`${w}x${h}: every track shows its number`, r.numbered);
  if (w === 1024 && h === 600) check('1024x600: track 4 is on screen', r.last <= 600, `bottom ${r.last}`);
  await p.context().close();
}

// The dock stays under the header's menus: a tap on a menu item is the item's.
{
  const p = await (await browser.newContext({ viewport: { width: 667, height: 375 }, hasTouch: true })).newPage();
  await p.goto(`${BASE}/tape.html`);
  await p.waitForTimeout(1500);
  await p.locator('#tape-more').click();
  await p.waitForTimeout(300);
  const hit = await p.evaluate(() => {
    const items = [...document.querySelectorAll('#tape-actions > button, #tape-actions > a')].filter((e) => e.offsetParent);
    const last = items.at(-1).getBoundingClientRect();
    const e = document.elementFromPoint(last.left + last.width / 2, last.top + last.height / 2);
    return e?.closest('#tape-actions') ? 'menu' : (e?.id || e?.className || '');
  });
  check("667x375: the ⋯ menu's last item takes its own tap", hit === 'menu', hit);
  await p.context().close();
}

// Catch is the page's one main action: orange.
{
  const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await p.goto(`${BASE}/tape.html`);
  await p.waitForTimeout(1500);
  const bg = await p.evaluate(() => {
    const b = document.getElementById('catch-pass');
    b.disabled = false;
    return getComputedStyle(b).backgroundImage;
  });
  check('Catch is orange', /linear-gradient/.test(bg) && /\b(20[0-9]|19[0-9]|21[0-9]), (7[0-9]|8[0-9]|6[0-9]), (2[0-9]|3[0-9]|1[0-9])\b/.test(bg), bg.slice(0, 80));
  await p.context().close();
}

// A lane draws: its canvas has something on it.
{
  const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await p.goto(`${BASE}/tape.html`);
  await p.waitForTimeout(2000);
  const drawn = await p.evaluate(() => {
    const cv = document.querySelector('.tt-lane');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    for (let i = 3; i < d.length; i += 4 * 97) if (d[i] > 0) return true;
    return false;
  });
  check('a lane draws', drawn);
  await p.context().close();
}

await browser.close();
if (failures.length) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}
console.log('\nall passed');
