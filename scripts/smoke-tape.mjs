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
