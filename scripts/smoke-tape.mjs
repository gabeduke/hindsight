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

// On a phone, upright or sideways, the bar is a mini player above the tabs:
// its window, ▶ and Catch. A tap on the window pulls the player up, with
// the transport, Rec and Catch on screen; Back puts it away.
for (const [w, h] of [[390, 844], [844, 390]]) {
  const p = await (await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true })).newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${BASE}/tape.html`);
  await p.waitForTimeout(2000);
  const look = () => p.evaluate(() => {
    const on = (s) => { const b = document.querySelector(s)?.getBoundingClientRect(); return !!b && b.width > 0 && b.top >= 0 && b.bottom <= innerHeight; };
    const tabs = document.querySelector('.appnav')?.getBoundingClientRect();
    const c = document.querySelector('#catch-pass').getBoundingClientRect();
    return { window: on('#np-expand'), play: on('#play'), loop: on('#loop'), rec: on('#rec'), catch: on('#catch-pass'),
      open: document.body.classList.contains('player-open'),
      aboveTabs: !tabs || tabs.top < innerHeight / 2 || c.bottom <= tabs.top + 1 };
  });
  const mini = await look();
  check(`${w}x${h}: the mini player shows its window, ▶ and Catch`, mini.window && mini.play && mini.catch && !mini.loop, JSON.stringify(mini));
  check(`${w}x${h}: the mini player sits above the tabs`, mini.aboveTabs);
  await p.click('#np-expand');
  await p.waitForTimeout(300);
  const big = await look();
  check(`${w}x${h}: the player has Play, Loop, Rec and Catch on screen`, big.open && big.play && big.loop && big.rec && big.catch, JSON.stringify(big));
  await p.goBack();
  await p.waitForTimeout(300);
  const back = await look();
  check(`${w}x${h}: Back puts the player away, on the same page`, !back.open && back.window && p.url().endsWith('/tape.html'), p.url());
  check(`${w}x${h}: no page errors`, errors.length === 0, errors.join('; '));
  await p.context().close();
}

// The bar runs: its reels are drawn, its line names the tape, its counter
// moves while the tape plays, and |◂ goes back to the loop's start.
{
  const p = await (await browser.newContext({ viewport: { width: 1024, height: 768 } })).newPage();
  await p.goto(`${BASE}/tape.html`);
  await p.waitForTimeout(1500);
  const before = await p.evaluate(async () => {
    const st = await (await fetch('/api/tapes/state?id=' + (await (await fetch('/api/tapes')).json()).loaded)).json();
    return { name: st.tape.name, grid: !!st.tape.grid, loopOn: st.tape.loop.on && st.tape.loop.out > st.tape.loop.in,
      pack: !!document.querySelector('#np-reel-l .np-pack'), marquee: document.getElementById('np-marquee').textContent,
      playing: document.getElementById('play').classList.contains('playing') };
  });
  check('the bar: the reels are drawn', before.pack);
  check('the bar: its line names the tape', before.marquee.startsWith(before.name.toUpperCase()), before.marquee);
  if (!before.playing) await p.click('#play');
  const a = await p.textContent('#position');
  await p.waitForTimeout(1500);
  const b = await p.textContent('#position');
  const t = await p.textContent('#np-time');
  check('the bar: the counter moves while the tape plays', a !== b || t !== '', `${a} → ${b} (${t})`);
  if (before.grid && before.loopOn) {
    await p.click('#to-start');
    await p.waitForTimeout(600);
    const pos = await p.evaluate(async () => {
      const st = await (await fetch('/api/tapes/state?id=' + (await (await fetch('/api/tapes')).json()).loaded)).json();
      return { heard: st.live.heard, in: st.tape.loop.in, bar: st.tape.grid.frames / st.tape.grid.bars };
    });
    check('the bar: |◂ goes back to the loop’s start', pos.heard >= pos.in && pos.heard < pos.in + pos.bar, JSON.stringify(pos));
  }
  if (!before.playing) await p.click('#play');
  await p.context().close();
}

// The drawers: from 700 px the lanes take the full width with both closed;
// a drawer opens above the bar and pushes the lanes up without hiding the
// bar, its key says so, and Escape closes it. On the bench every lane keeps
// 48 px with Edit open.
for (const [w, h] of [[1024, 768], [1024, 600], [768, 1024], [1470, 900]]) {
  const p = await (await browser.newContext({ viewport: { width: w, height: h } })).newPage();
  await p.goto(`${BASE}/tape.html`);
  await p.waitForTimeout(1500);
  const measure = () => p.evaluate(() => {
    const lanes = [...document.querySelectorAll('.tt-lane')].map((c) => c.getBoundingClientRect());
    const np = document.getElementById('np').getBoundingClientRect();
    const open = [...document.querySelectorAll('.np-drawer.open')].map((d) => d.getBoundingClientRect());
    return { h: lanes.map((r) => Math.round(r.height)), right: Math.round(Math.max(...lanes.map((r) => r.right))),
      npTop: Math.round(np.top), npBottom: Math.round(np.bottom), drawer: open.map((r) => [Math.round(r.top), Math.round(r.bottom)]) };
  });
  const closed = await measure();
  check(`${w}x${h}: with the drawers closed the lanes take the width`, closed.right >= w - 40, `right ${closed.right}`);
  if (w === 1024 && h === 768) check('1024x768: four lanes of 100 px or more', closed.h.every((x) => x >= 100), JSON.stringify(closed.h));
  await p.click('#np-drawer-edit');
  await p.waitForTimeout(400);
  const open = await measure();
  const exp = await p.getAttribute('#np-drawer-edit', 'aria-expanded');
  check(`${w}x${h}: Edit opens its drawer above the bar`, open.drawer.length === 1 && open.drawer[0][1] <= open.npTop + 1 && exp === 'true', JSON.stringify(open.drawer));
  check(`${w}x${h}: the bar stays on screen`, open.npBottom <= h + 1, `bar bottom ${open.npBottom}`);
  const room = await p.evaluate(() => ({
    keys: ['ed-lift', 'ed-copy', 'ed-split', 'ed-x2'].map((id) => Math.round(document.getElementById(id).getBoundingClientRect().width)),
    toasts: parseFloat(getComputedStyle(document.getElementById('toasts')).bottom),
    dock: document.getElementById('np-dock').getBoundingClientRect().height,
  }));
  check(`${w}x${h}: the edit keys keep their words`, room.keys.every((x) => x >= 40), JSON.stringify(room.keys));
  check(`${w}x${h}: toasts rise over the open drawer`, room.toasts >= room.dock, `toasts ${room.toasts}, dock ${Math.round(room.dock)}`);
  // Shorter, unless they were already as short as their heads.
  check(`${w}x${h}: the lanes are pushed up, 48 px or more`, open.h.every((x) => x >= 48) && (open.h[0] < closed.h[0] || closed.h[0] <= 72), `${JSON.stringify(closed.h)} → ${JSON.stringify(open.h)}`);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  check(`${w}x${h}: Escape closes it`, (await p.getAttribute('#np-drawer-edit', 'aria-expanded')) === 'false');
  await p.context().close();
}

// Track heads fit their lanes (no key wraps to a row of its own), the lanes
// end above the now-playing bar on a tablet or computer (the bench included),
// and every track shows its number.
for (const [w, h] of [[390, 844], [600, 960], [1024, 600], [1024, 768], [1280, 800], [844, 390], [1440, 900], [1470, 900]]) {
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
    const np = document.getElementById('np').getBoundingClientRect().top;
    return { tall, numbered, last: Math.round(last), np: Math.round(np) };
  });
  check(`${w}x${h}: track heads are no taller than their lanes`, r.tall.every((d) => d <= 2), JSON.stringify(r.tall));
  check(`${w}x${h}: every track shows its number`, r.numbered);
  if (w >= 700 && h > 440) check(`${w}x${h}: the lanes end above the bar`, r.last <= r.np + 1, `lanes ${r.last}, bar ${r.np}`);
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

// Playing on a phone: a browser that isn't listening shows the banner, and
// Rec explains that it needs the jam room.
{
  const put = (mode) => fetch(`${BASE}/api/tapes/output`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }) });
  const p = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })).newPage();
  try {
    await put('phone');
    await p.goto(`${BASE}/tape.html`);
    await p.waitForTimeout(2500);
    check('phone mode: the banner shows on a browser that is not listening', await p.locator('#out-banner').isVisible());
    await p.click('#np-expand'); // Rec is in the player
    await p.locator('#rec').click({ force: true }); // aria-disabled, but pressable
    check('phone mode: Rec opens the jam-room sheet', await p.evaluate(() => document.getElementById('jam-only').open));
    await p.locator('#jam-only-close').click();
    await p.click('#np-expand');
    check('phone mode: the panel says Rec and Catch wait', await p.locator('#jam-only-note').isVisible());
    check('phone mode: Record from, Catch the last and the passes wait too',
      !(await p.locator('.tb-row.sources').isVisible()) && !(await p.locator('.tb-row.catch').isVisible()) && !(await p.locator('.tb-row.passes').isVisible()));
    await put('jam');
    await p.waitForTimeout(4000);
    check('jam mode: the banner hides again', !(await p.locator('#out-banner').isVisible()));
  } finally {
    await put('jam');
    await p.context().close();
  }
}

// The tape on this phone, across pages: Takes joins the stream again as it
// opens, the tape plays on, and ▶ is the tap its sound waits for (held back
// here as a phone holds it: a page's sound starts only from a tap on it).
{
  const put = (mode) => fetch(`${BASE}/api/tapes/output`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }) });
  const id = (await (await fetch(`${BASE}/api/tapes`)).json()).loaded;
  const live = async () => (await (await fetch(`${BASE}/api/tapes/state?id=${id}`)).json()).live;
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 768 } });
  await ctx.addInitScript(() => {
    const AC = window.AudioContext;
    window.AudioContext = class extends AC {
      constructor(...a) { super(...a); if (!navigator.userActivation.isActive) super.suspend(); }
      resume() { return navigator.userActivation.isActive ? super.resume() : Promise.reject(new Error('needs a tap')); }
    };
  });
  const p = await ctx.newPage();
  try {
    await p.goto(`${BASE}/tape.html`);
    await p.waitForTimeout(1500);
    await p.click('#tape-out');
    await p.click('.out-choice[data-mode="phone"]');
    await p.waitForTimeout(1500);
    await p.click('#out-close');
    if (!(await live()).playing) await p.click('#play');
    await p.waitForTimeout(1000);
    await p.goto(`${BASE}/takes.html`);
    await p.waitForTimeout(2000);
    const bar = () => p.evaluate(() => ({ note: document.getElementById('np-marquee').textContent, label: document.getElementById('np-play').getAttribute('aria-label') }));
    const brief = async () => { const l = await live(); return { ...(await bar()), playing: l.playing, listeners: l.stream.listeners }; };
    const a = await brief();
    check('across pages: Takes joins the stream again, and the tape plays on', a.playing && a.listeners === 1, JSON.stringify(a));
    check('across pages: the bar asks for ▶', a.note === 'tap ▶ to play here' && a.label === 'Play here', JSON.stringify(a));
    await p.click('#np-play');
    await p.waitForTimeout(1000);
    const b = await brief();
    check('across pages: ▶ wakes the sound without stopping the tape', b.note !== 'tap ▶ to play here' && b.label === 'Stop' && b.playing, JSON.stringify(b));
  } finally {
    await fetch(`${BASE}/api/tapes/transport?id=${id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'stop' }) });
    await put('jam');
    await ctx.close();
  }
}

await browser.close();
if (failures.length) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}
console.log('\nall passed');
