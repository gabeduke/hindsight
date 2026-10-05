// Smoke-test the takes page's rack, cassette and phone sheet in a real
// browser, against a running demo instance -- the wiring the node tests
// can't reach (focus, history, the audio-driven cassette, select mode).
//
//   npm install --no-save playwright@1.49.0   # at the repo root, as for
//   npx playwright install chromium          # scripts/screenshots.mjs
//
//   RING_SECONDS=120 OUTPUT_DIR=/tmp/hindsight-smoke PORT=15391 \
//     go run ./cmd/hindsight --demo &
//   HINDSIGHT_URL=http://127.0.0.1:15391 node scripts/smoke-takes.mjs
//
// The demo needs at least two takes, one of them with a selection; the
// script makes them if they're missing. It exits non-zero on any failure.
import { chromium } from 'playwright';

const BASE = process.env.HINDSIGHT_URL ?? 'http://127.0.0.1:5000';
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

// Two takes, the newest with a selection.
{
  const page = await browser.newPage();
  await page.goto(BASE);
  let takes = await page.evaluate(() => fetch('/api/jams').then((r) => r.json()).then((j) => j.jams || j.takes || j));
  for (let i = takes.length; i < 2; i++) {
    await page.request.post(`${BASE}/api/trigger?seconds=30`);
    await page.waitForTimeout(2500);
  }
  takes = await page.evaluate(() => fetch('/api/jams').then((r) => r.json()).then((j) => j.jams || j.takes || j));
  const t = takes[0];
  if (!t.trim) {
    const sr = t.sample_rate || 48000;
    await page.evaluate(([name, a, b]) => fetch(`/api/take?file=${encodeURIComponent(name)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trim: { start_frame: a, end_frame: b } }),
    }), [t.name, Math.round(sr * 4), Math.round(sr * 14)]);
  }
  await page.close();
}

const phone = { viewport: { width: 390, height: 844 }, hasTouch: true };
const settle = (p, ms = 1200) => p.waitForTimeout(ms);

// A cassette opened over a take that is already playing keeps moving.
{
  const ctx = await browser.newContext(phone);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/takes.html`);
  await settle(p);
  await p.locator('.take.spine').first().click();
  await settle(p);
  await p.locator('.detail-play').click();
  await settle(p, 1500);
  await p.locator('.sheet-back').click();
  await settle(p, 400);
  await p.locator('.take.spine').first().click();
  await settle(p, 800);
  const a = await p.evaluate(() => document.querySelector('.cas-canvas').toDataURL());
  await settle(p, 900);
  const b = await p.evaluate(() => document.querySelector('.cas-canvas').toDataURL());
  check('a cassette reopened over playing audio moves', a !== b);
  await ctx.close();
}

// Select mode works from the keyboard.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/takes.html`);
  await settle(p);
  await p.locator('#select-btn').click();
  // A folded take's row is a hidden spine: count the ones on the shelf.
  const spine = p.locator('.take.spine:not(.folded)').nth(1);
  await spine.focus();
  await p.keyboard.press('Enter');
  await settle(p, 200);
  const n = await p.locator('.take.spine.selected').count();
  check('Enter on a spine in select mode selects it', n === 1, `${n} selected`);
  const pressed = await spine.getAttribute('aria-pressed');
  check('a selected spine says so', pressed === 'true', `aria-pressed=${pressed}`);
  await ctx.close();
}

// Widening past the pane's breakpoint with the sheet open leaves history clean.
{
  const ctx = await browser.newContext(phone);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/takes.html`);
  await settle(p);
  await p.locator('.take.spine').first().click();
  await settle(p, 600);
  await p.setViewportSize({ width: 1440, height: 900 });
  await settle(p, 600);
  const s = await p.evaluate(() => ({ state: history.state, focus: document.activeElement.tagName }));
  check('widening with the sheet open drops its history entry', s.state === null, JSON.stringify(s.state));
  check('widening with the sheet open keeps focus off the body', s.focus !== 'BODY', s.focus);
  await ctx.close();
}

// A reload with the sheet's history entry doesn't leave a dead Back.
{
  const ctx = await browser.newContext(phone);
  const p = await ctx.newPage();
  await p.goto(`${BASE}/takes.html`);
  await settle(p);
  await p.locator('.take.spine').first().click();
  await settle(p, 600);
  await p.reload();
  await settle(p);
  const s = await p.evaluate(() => ({ state: history.state, open: document.body.classList.contains('cassette-open') }));
  check('a reload with a sheet entry opens the sheet or clears the entry', s.open || s.state === null, JSON.stringify(s));
  await ctx.close();
}

// Leaving the rename field with Tab goes on, not back.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/takes.html`);
  await settle(p);
  await p.locator('.detail-rename').click();
  await p.keyboard.press('Escape');
  await p.locator('.detail-rename').click();
  await p.keyboard.press('Tab');
  await settle(p, 600);
  const cls = await p.evaluate(() => document.activeElement.className);
  check('Tab out of the rename field moves on', !/detail-rename/.test(cls), cls);
  await ctx.close();
}

// A browser without canvas roundRect still draws a take with a selection.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { delete CanvasRenderingContext2D.prototype.roundRect; });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${BASE}/takes.html`);
  await settle(p, 2000);
  check('no roundRect: the cassette draws without an error', errors.length === 0, errors.join('; '));
  await ctx.close();
}

// The take page draws its take on tape -- brown oxide with a cream trace on
// it, without an error -- and a phone's notes strip draws it too.
{
  const takes = await (await fetch(`${BASE}/api/jams`)).json();
  const url = `${BASE}/wave.html?file=${encodeURIComponent(takes[0].name)}`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(url);
  await p.waitForTimeout(2500);
  const r = await p.evaluate(() => {
    const cv = document.querySelector('.wave-canvas');
    const g = cv.getContext('2d');
    const mid = g.getImageData(Math.round(cv.width * 0.5), Math.round(cv.height * 0.3), 1, 1).data;
    // Somewhere down one column of the body, the trace: a light, warm pixel.
    const col = g.getImageData(Math.round(cv.width * 0.6), 0, 1, cv.height).data;
    let trace = false;
    for (let i = 0; i < col.length; i += 4) if (col[i] > 180 && col[i + 1] > 150 && col[i] >= col[i + 2]) trace = true;
    return { oxide: mid[0] > mid[1] && mid[1] > mid[2], trace };
  });
  check('the take view is on tape (brown under the trace)', r.oxide);
  check('the take view draws its trace', r.trace);
  check('the take page draws without an error', errors.length === 0, errors.join('; '));
  await ctx.close();

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true });
  const q = await phone.newPage();
  await q.goto(url);
  await q.waitForTimeout(2500);
  const lit = await q.evaluate(async () => {
    document.getElementById('notes-open').click();
    await new Promise((res) => setTimeout(res, 800));
    const cv = document.getElementById('notes-strip');
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  });
  check("a phone's notes strip draws the take", lit > 0, `${lit} px`);
  await phone.close();
}

// Families: cuts fold into the take they were cut from, and come back out
// when it's deleted.
{
  const ctx = await browser.newContext({ viewport: { width: 1470, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(BASE);
  const jam = await p.evaluate(async () => {
    const r = await fetch('/api/trigger?seconds=12', { method: 'POST' }).then((x) => x.json());
    const cut = (a, b) => fetch(`/api/cut?file=${encodeURIComponent(r.name)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ start_frame: a, end_frame: b, label: '' }),
    }).then((x) => x.json());
    // Cuts are named by the second they're made: one second apart.
    const c1 = await cut(48000, 144000);
    await new Promise((res) => setTimeout(res, 1100));
    const c2 = await cut(240000, 384000);
    return { name: r.name, cuts: [c1.name, c2.name] };
  });
  await p.goto(`${BASE}/takes.html`);
  await settle(p, 1500);
  const spine = p.locator(`.take[data-name="${jam.name}"]`);
  check('a take with two cuts wears ✂2', (await spine.locator('.spine-fold').textContent()) === '✂2');
  const folded = await p.evaluate((names) => names.map((n) => document.querySelector(`.take[data-name="${n}"]`)?.hidden), jam.cuts);
  check('its cuts ride hidden behind it', folded.every((h) => h === true), JSON.stringify(folded));
  await spine.click();
  await settle(p, 600);
  check('its cassette lists both cuts', (await p.locator('.detail-cuts .detail-member').count()) === 2);
  await p.locator('.detail-cuts .detail-member').first().click();
  await settle(p, 500);
  const inCut = await p.evaluate(() => ({ up: !document.querySelector('.detail-up').hidden, from: document.querySelector('.detail-from').textContent }));
  check('a cut shows in the cassette, with ‹ and where it came from', inCut.up && /^Cut from /.test(inCut.from), JSON.stringify(inCut));
  await p.locator('.detail-up').click();
  await settle(p, 500);
  check('‹ goes back to the take', !(await p.locator('.detail-cuts').isHidden()));
  await p.locator('.detail-delete').click();
  await settle(p, 2500);
  const toastText = await p.locator('.toast').last().textContent();
  check('deleting it says its cuts are back', /its 2 cuts are back on the shelf/.test(toastText), toastText);
  const out = await p.evaluate((names) => names.map((n) => document.querySelector(`.take[data-name="${n}"]`)?.hidden), jam.cuts);
  check('its cuts are spines again', out.every((h) => h === false), JSON.stringify(out));
  await p.locator('.toast button', { hasText: 'Undo' }).last().click();
  await settle(p, 2500);
  const back = await p.evaluate((names) => names.map((n) => document.querySelector(`.take[data-name="${n}"]`)?.hidden), jam.cuts);
  check('Undo folds them in again', back.every((h) => h === true), JSON.stringify(back));
  await ctx.close();
}

await browser.close();
if (failures.length) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}
console.log('\nall passed');
