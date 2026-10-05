// Smoke-test the Capture page in a real browser, against a running demo
// instance: the layout states and the wiring the node tests can't reach. Set
// up as for scripts/smoke-takes.mjs; run the demo with the default ring
// (RING_SECONDS=900), not a short one, so the ribbon is what a Pi shows.
//
//   HINDSIGHT_URL=http://127.0.0.1:15391 node scripts/smoke-capture.mjs
//
// It may capture one take. It exits non-zero on any failure.
import { chromium } from 'playwright';

const BASE = process.env.HINDSIGHT_URL ?? 'http://127.0.0.1:5000';
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures.push(name);
};
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
const open = async (w, h, setup) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 900 });
  const p = await ctx.newPage();
  if (setup) await setup(p);
  await p.goto(`${BASE}/`);
  await p.waitForTimeout(2000);
  return [ctx, p];
};

// Disk free reads in full on a phone, at a size a Pi's card has.
for (const [w, h] of [[390, 844], [360, 780]]) {
  const [ctx, p] = await open(w, h);
  const clipped = await p.evaluate(() => {
    const v = document.getElementById('stat-disk');
    v.textContent = '99.5 GB';
    return v.scrollWidth > v.clientWidth;
  });
  check(`disk free "99.5 GB" fits at ${w}px`, !clipped);
  await ctx.close();
}

// A take still encoding says so when pressed, rather than doing nothing.
{
  const [ctx, p] = await open(1440, 900, (page) => page.route('**/api/jams', async (route) => {
    // Ask without the ETag, so there's always a list to edit.
    const headers = { ...route.request().headers() };
    delete headers['if-none-match'];
    const res = await route.fetch({ headers });
    const list = await res.json().catch(() => null);
    if (!Array.isArray(list)) { await route.fulfill({ response: res }); return; }
    if (list[0]) list[0].has_preview = false;
    await route.fulfill({ response: res, json: list });
  }));
  // force: aria-disabled makes Playwright wait for it to enable; a finger doesn't.
  await p.locator('.take.spine').first().click({ force: true });
  await p.waitForTimeout(400);
  const toast = await p.locator('#toasts .toast').count();
  check('pressing a take still encoding shows a toast', toast > 0);
  const dis = await p.locator('.take.spine').first().getAttribute('aria-disabled');
  check('a take still encoding is marked so', dis === 'true', `aria-disabled=${dis}`);
  await ctx.close();
}

// The key glows after a save even when the list is slow to refresh.
{
  const [ctx, p] = await open(1440, 900, (page) => page.route('**/api/jams', async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.continue();
  }));
  await p.locator('#capture-btn').click();
  let glowed = false;
  for (let i = 0; i < 60 && !glowed; i++) {
    await p.waitForTimeout(100);
    glowed = await p.evaluate(() => {
      const b = document.getElementById('capture-btn');
      return b.classList.contains('saved') && getComputedStyle(b).boxShadow.includes('34px');
    });
  }
  check('the key glows after a save, list slow', glowed);
  await ctx.close();
}

// Opening Input channels on the bench keeps Capture's row on screen.
{
  const [ctx, p] = await open(1024, 600);
  await p.locator('#chan-diag summary').click();
  await p.waitForTimeout(300);
  const bottom = await p.evaluate(() => Math.round(document.getElementById('capture-btn').getBoundingClientRect().bottom));
  check('Input channels open: Capture stays above 600 on the bench', bottom <= 600, `bottom ${bottom}`);
  await ctx.close();
}

// A phone held sideways shows as many spines as its two-column layout holds.
{
  const [ctx, p] = await open(932, 430);
  // A folded take's row is a hidden spine: count the ones on the shelf.
  const n = await p.locator('.take.spine:not(.folded)').count();
  check('a sideways phone shelves 3 takes', n <= 3, `${n} shown`);
  await ctx.close();
}

// A tap on the readout reaches what's under it.
{
  const [ctx, p] = await open(390, 844);
  const hit = await p.evaluate(() => {
    const r = document.querySelector('.rb-readout').getBoundingClientRect();
    const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return e?.className || '';
  });
  check('the readout lets a tap through', !/rb-readout/.test(hit), hit);
  await ctx.close();
}

// The now-playing bar on Capture: the tape when there is one; a spine pressed
// plays its take in the bar, and ⏏ puts the tape back.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage();
  await p.goto(BASE);
  await p.waitForTimeout(2500);
  const bar = () => p.evaluate(() => ({
    shown: !document.getElementById('np').hidden,
    open: document.getElementById('np-open').textContent,
    eject: !document.getElementById('np-eject').hidden,
    play: document.getElementById('np-play').textContent,
  }));
  const tapeOn = (await fetch(`${BASE}/api/tapes`)).ok;
  const a = await bar();
  if (tapeOn) check('capture: the bar holds the tape', a.shown && /^Open /.test(a.open) && a.open !== 'Open the take ›', JSON.stringify(a));
  const spine = p.locator('.shelf-panel .take.spine').first();
  if (await spine.count()) {
    await spine.click();
    await p.waitForTimeout(1800);
    const b = await bar();
    check('capture: a spine plays its take in the bar', b.shown && b.open === 'Open the take ›' && b.play === '❚❚', JSON.stringify(b));
    if (tapeOn) {
      await p.click('#np-eject');
      await p.waitForTimeout(1200);
      const c = await bar();
      check('capture: ⏏ puts the tape back', c.open !== 'Open the take ›' && !c.eject, JSON.stringify(c));
    }
  }
  await ctx.close();
}

await browser.close();
if (failures.length) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}
console.log('\nall passed');
