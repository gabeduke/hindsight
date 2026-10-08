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
const getJSON = async (path) => (await fetch(`${BASE}${path}`)).json();
const postJSON = async (path, body = {}) => (await fetch(`${BASE}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})).json();
const loadedState = async () => getJSON(`/api/tapes/state?id=${encodeURIComponent((await getJSON('/api/tapes')).loaded)}`);

// The checks want a loaded tape with a tempo and a clip on track 1 at the
// loop's start. A fresh demo has neither: make a 4-bar tape at 96 BPM and put
// the first 4 bars of a take there (capturing a take first if none is long
// enough). This changes the tape it finds, so it runs only against an
// address it's given.
if (!process.env.HINDSIGHT_URL) {
  console.log('Set HINDSIGHT_URL to a demo instance: this script changes the tape it finds.');
  process.exit(2);
}
{
  const list = await getJSON('/api/tapes');
  let st = list.loaded ? await loadedState() : null;
  if (!st || !st.tape.grid) {
    const t = await postJSON('/api/tapes', { name: 'Smoke', bpm: 96, bars: 4 });
    await postJSON(`/api/tapes/load?id=${encodeURIComponent(t.id)}`);
    st = await loadedState();
  }
  const l = st.tape.loop;
  if (!st.tape.tracks[0].clips.some((c) => c.at <= l.in && l.in < c.at + c.frames)) {
    const bar = st.tape.grid.frames / st.tape.grid.bars;
    const need = Math.round(4 * bar);
    const long = async () => {
      const j = await getJSON('/api/jams');
      return (j.jams || j.takes || j).find((t) => t.duration_seconds * (t.sample_rate || 48000) >= need);
    };
    let take = await long();
    if (!take) {
      await fetch(`${BASE}/api/trigger?seconds=30`, { method: 'POST' });
      take = await long();
    }
    if (!take) throw new Error('no take of 4 bars or more to put on the tape: is the demo older than 10 s?');
    const d = await postJSON(`/api/tapes/drop?id=${encodeURIComponent(st.tape.id)}`, { take: take.name, from: 0, to: need, track: 1, at: l.in });
    if (!d.clip) throw new Error(`could not put a take on the tape: ${JSON.stringify(d)}`);
  }
}

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

// Recording on the track: a track's ● makes it the record track, on the Pi,
// and Catch says so, and again disarms it; an input chip opens a menu of the
// inputs, and an input chosen there or in the inspector is that track's.
// They're put back after.
{
  const p = await (await browser.newContext({ viewport: { width: 1024, height: 768 } })).newPage();
  await p.goto(`${BASE}/tape.html`);
  await p.waitForTimeout(1500);
  const meta = () => p.evaluate(async () => {
    const st = await (await fetch('/api/tapes/state?id=' + (await (await fetch('/api/tapes')).json()).loaded)).json();
    return { rec: st.tape.rec_track || 1, inputs: st.tape.inputs || [], sources: (st.sources || []).map((x) => x.name) };
  });
  const lit = () => p.evaluate(() => [...document.querySelectorAll('.tt-arm')].map((b) => b.getAttribute('aria-pressed')).join());
  const was = await meta();
  // From track 1 armed: ● on the armed track would disarm it.
  if (was.rec !== 1) {
    await p.evaluate(async () => {
      const id = (await (await fetch('/api/tapes')).json()).loaded;
      await fetch('/api/tapes?id=' + id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rec_track: 1 }) });
    });
    await p.reload();
    await p.waitForTimeout(1500);
  }
  await p.locator('.tt-arm').nth(2).click();
  await p.waitForTimeout(800);
  const armed = await meta();
  check('the record track: track 3’s ● makes it the record track, on the Pi', armed.rec === 3, JSON.stringify(armed));
  check('the record track: its ● is lit, and only its', (await lit()) === 'false,false,true,false');
  check('the record track: Catch names it', (await p.textContent('#catch-pass .np-catch-sub')).includes('track 3'));
  // A tap on another lane selects that track here, for the edits; the record
  // track, everyone's, stays.
  const lane1 = await p.evaluate(() => { const b = document.querySelectorAll('.tt-lane')[0].getBoundingClientRect(); return { x: b.right - 6, y: b.top + b.height / 2 }; });
  await p.mouse.click(lane1.x, lane1.y);
  await p.waitForTimeout(800);
  check('the record track: a tap on another lane leaves it where it is', (await meta()).rec === 3 && await p.evaluate(() => document.querySelectorAll('.tape-track')[0].classList.contains('selected')));
  // Another track's input: a menu of the inputs, nothing armed or opened.
  await p.locator('.tt-in').nth(3).click();
  await p.waitForTimeout(400);
  check('the input menu: a track’s input opens it, and not the inspector', await p.evaluate(() => !document.getElementById('input-menu').hidden && !document.getElementById('track-sheet').open
    && document.querySelector('#input-menu .menu-head').textContent.includes('Track 4')));
  const pick4 = armed.sources.find((x) => x !== (armed.inputs[3] || '')) || armed.sources[0];
  await p.locator(`#input-menu button[data-name="${pick4}"]`).click();
  await p.waitForTimeout(800);
  const menuGiven = await meta();
  check('the input menu: the input chosen is that track’s, on the Pi, and it stays unarmed', menuGiven.inputs[3] === pick4 && menuGiven.rec === 3
    && (await p.textContent('.tape-track:nth-child(4) .tt-in-v')) === pick4 && await p.evaluate(() => document.getElementById('input-menu').hidden), JSON.stringify(menuGiven));
  // The inspector's Input row: the record track's name, twice.
  await p.locator('.tt-name').nth(2).click();
  await p.locator('.tt-name').nth(2).click();
  await p.waitForTimeout(500);
  const pickSrc = armed.sources.find((x) => x !== (armed.inputs[2] || '')) || armed.sources[0];
  await p.locator(`#sources button[data-name="${pickSrc}"]`).click();
  await p.waitForTimeout(800);
  const given = await meta();
  check('the record track: an input chosen in its inspector is that track’s, on the Pi', given.inputs[2] === pickSrc && (await p.textContent('.tape-track:nth-child(3) .tt-in-v')) === pickSrc, JSON.stringify(given.inputs));
  await p.keyboard.press('Escape');
  // ● again disarms it, on the Pi, and Catch asks for a track; once more arms it.
  await p.locator('.tt-arm').nth(2).click();
  await p.waitForTimeout(800);
  check('disarm: the armed ● again leaves none armed, on the Pi', (await meta()).rec === -1 && (await lit()) === 'false,false,false,false'
    && (await p.textContent('#catch-pass .np-catch-sub')) === 'arm a track');
  await p.locator('.tt-arm').nth(2).click();
  await p.waitForTimeout(800);
  check('disarm: ● arms it again', (await meta()).rec === 3 && (await lit()) === 'false,false,true,false');
  // Put them back: every track's input, "" for one that had none.
  await p.evaluate(async ({ rec, inputs, tracks }) => {
    const id = (await (await fetch('/api/tapes')).json()).loaded;
    const send = (body) => fetch('/api/tapes?id=' + id, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    await send({ rec_track: rec });
    await send({ inputs: Array.from({ length: tracks }, (_, i) => ({ n: i + 1, source: inputs[i] || '' })) });
  }, { rec: was.rec, inputs: was.inputs, tracks: await p.evaluate(() => document.querySelectorAll('.tape-track').length) });
  await p.context().close();
}

// The crate's drawer: from 700 px the lanes take the full width with it
// closed; it opens above the bar and pushes the lanes up without hiding the
// bar, its key says so, and Escape closes it. On the bench every lane keeps
// 48 px with it open.
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
  await p.click('#np-drawer-crate');
  await p.waitForTimeout(400);
  const open = await measure();
  const exp = await p.getAttribute('#np-drawer-crate', 'aria-expanded');
  check(`${w}x${h}: Crate opens its drawer above the bar`, open.drawer.length === 1 && open.drawer[0][1] <= open.npTop + 1 && exp === 'true', JSON.stringify(open.drawer));
  check(`${w}x${h}: the bar stays on screen`, open.npBottom <= h + 1, `bar bottom ${open.npBottom}`);
  const room = await p.evaluate(() => ({
    keys: ['drop', 'insert', 'clip-clear'].map((id) => Math.round(document.getElementById(id).getBoundingClientRect().width)),
    toasts: parseFloat(getComputedStyle(document.getElementById('toasts')).bottom),
    dock: document.getElementById('np-dock').getBoundingClientRect().height,
  }));
  check(`${w}x${h}: the clipboard's keys keep their words`, room.keys.every((x) => x >= 40), JSON.stringify(room.keys));
  check(`${w}x${h}: toasts rise over the open drawer`, room.toasts >= room.dock, `toasts ${room.toasts}, dock ${Math.round(room.dock)}`);
  // Shorter, unless they were already as short as their heads.
  check(`${w}x${h}: the lanes are pushed up, 48 px or more`, open.h.every((x) => x >= 48) && (open.h[0] < closed.h[0] || closed.h[0] <= 72), `${JSON.stringify(closed.h)} → ${JSON.stringify(open.h)}`);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  check(`${w}x${h}: Escape closes it`, (await p.getAttribute('#np-drawer-crate', 'aria-expanded')) === 'false');
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

// On a phone, a tapped clip's bar floats just above the player, on screen,
// and on its side the tapped lane stays in view above it.
for (const [w, h] of [[390, 844], [667, 375]]) {
  const p = await (await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true, isMobile: true })).newPage();
  await p.goto(`${BASE}/tape.html`);
  await p.waitForTimeout(2000);
  const t = (await loadedState()).tape;
  const c = t.tracks[0].clips.find((x) => x.at <= t.loop.in && t.loop.in < x.at + x.frames);
  const r = await p.evaluate(() => { const b = document.querySelector('.tt-lane').getBoundingClientRect(); return { x: b.left + b.width * 0.3, y: b.top + b.height / 2 }; });
  await p.touchscreen.tap(r.x, r.y);
  await p.waitForTimeout(1500); // the bar comes up after half a second, then the lane scrolls
  const g = await p.evaluate(() => {
    const bar = document.getElementById('multi-bar').getBoundingClientRect(), np = document.getElementById('np').getBoundingClientRect();
    const lane = document.querySelector('.tt-lane').getBoundingClientRect();
    const el = document.getElementById('multi-bar');
    return { bar: [bar.top, bar.bottom], np: np.top, lane: lane.bottom, vh: innerHeight, shown: !el.hidden && !el.classList.contains('idle') };
  });
  check(`${w}x${h}: a tapped clip's bar sits just above the player`, !!c && g.shown && g.bar[0] >= 0 && Math.abs(g.bar[1] - g.np) <= 2, JSON.stringify(g));
  check(`${w}x${h}: and the tapped lane isn't under it`, g.lane <= g.bar[0] + 1, JSON.stringify(g));
  await p.context().close();
}

// On the 1024 bench, a double-click on track 4's clip opens its sheet: the
// clip bar, which takes the lanes' height, comes up after the second click,
// not between the two. Moved there and back through the API.
{
  const p = await (await browser.newContext({ viewport: { width: 1024, height: 600 } })).newPage();
  const t = (await loadedState()).tape;
  const c = t.tracks[0].clips.find((x) => x.at <= t.loop.in && t.loop.in < x.at + x.frames);
  const q = `id=${encodeURIComponent(t.id)}`;
  await postJSON(`/api/tapes/edit?${q}`, { op: 'move', track: 1, clips: [c.id], dt: 0, dtrack: 3 });
  await p.goto(`${BASE}/tape.html`);
  await p.waitForTimeout(2000);
  const bar = t.grid.frames / t.grid.bars;
  const from = Math.max(0, t.loop.in - bar), to = t.loop.out + bar;
  const r = await p.evaluate(() => { const b = document.querySelectorAll('.tt-lane')[3].getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
  const x = r.x + ((c.at + Math.min(c.frames, bar) / 2 - from) / (to - from)) * r.w;
  await p.mouse.dblclick(x, r.y + r.h * 0.75);
  await p.waitForTimeout(600);
  const after = (await loadedState()).tape;
  const still = after.tracks[3].clips.find((x2) => x2.id === c.id);
  check('1024x600: a double-click on track 4’s clip opens its sheet, and nothing else',
    await p.evaluate(() => document.getElementById('clip-sheet').open) && !!still && still.at === c.at, JSON.stringify(still && still.at));
  await p.context().close();
  await postJSON(`/api/tapes/undo?${q}`);
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

// A clip's gestures (lib/tape/clipgestures.js): a tap selects it (the clip
// bar names it; nothing pops up), a double-click or Enter opens its sheet, →
// moves it a bar and Escape lets go; a quick drag pans the lanes and leaves
// the clip be, and a hold then a drag slides it a bar, which ↶ takes back.
{
  await postJSON(`/api/tapes/transport?id=${encodeURIComponent((await getJSON('/api/tapes')).loaded)}`, { action: 'stop' });
  const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(e.message));
  // The clip on track 1 at the loop's start, the top one if they're layered;
  // after a slide, the same clip wherever it went.
  let followId = null;
  const first = async () => {
    const st = await loadedState();
    const t = st.tape;
    const bar = t.grid.frames / t.grid.bars;
    const cl = t.tracks[0].clips;
    const c = followId ? cl.find((x) => x.id === followId)
      : cl.filter((x) => x.at <= t.loop.in && t.loop.in < x.at + x.frames).reduce((a, b) => (b.layer > a.layer ? b : a));
    return { id: c.id, at: c.at, frames: c.frames, bar, loop: t.loop };
  };
  // Where the clip's middle is on screen: the lanes show the loop and a bar
  // either side (geometry.js editView) until something zooms or pans them.
  const spot = async (c) => {
    const r = await p.evaluate(() => { const b = document.querySelector('.tt-lane').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; });
    const from = Math.max(0, c.loop.in - c.bar), to = c.loop.out + c.bar;
    const mid = c.at + Math.min(c.frames, c.bar) / 2;
    return { x: r.x + ((mid - from) / (to - from)) * r.w, y: r.y + r.h / 2, perBar: (c.bar / (to - from)) * r.w };
  };
  await p.goto(`${BASE}/tape.html`);
  await p.waitForTimeout(2000);
  const c0 = await first();
  followId = c0.id;
  const barOn = () => p.isVisible('#multi-bar');
  const laneBox = () => p.evaluate(() => { const b = document.querySelector('.tt-lane').getBoundingClientRect(); return [b.top, b.height].map(Math.round).join(','); });
  const sheetOpen = () => p.evaluate(() => document.getElementById('clip-sheet').open);
  let s = await spot(c0);
  const box0 = await laneBox();
  await p.mouse.click(s.x, s.y);
  await p.waitForTimeout(250);
  check('a clip: a tap selects it, the lanes staying put while a second click could come', (await laneBox()) === box0 && !(await barOn()) && !(await sheetOpen()), `${box0} → ${await laneBox()}`);
  await p.waitForTimeout(550);
  check('a clip: then the clip bar comes up naming it, and nothing pops up', !(await sheetOpen()) && await barOn()
    && (await p.textContent('#multi-count')).startsWith('Track 1 ·'), await p.textContent('#multi-count'));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  s = await spot(c0);
  await p.mouse.dblclick(s.x, s.y);
  await p.waitForTimeout(400);
  check('a clip: a double-click opens its sheet', await sheetOpen());
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  await p.keyboard.press('Enter');
  await p.waitForTimeout(400);
  check('a clip: Enter opens it too', await sheetOpen());
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  await p.keyboard.press('ArrowRight');
  await p.waitForTimeout(900);
  check('a clip: → moves it a bar', Math.abs((await first()).at - (c0.at + c0.bar)) <= 1, `${c0.at} → ${(await first()).at}`);
  await p.click('#tape-undo');
  await p.waitForTimeout(900);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  check('a clip: Escape lets go of it', !(await barOn()) && (await first()).at === c0.at);
  s = await spot(c0);
  await p.mouse.move(s.x, s.y);
  await p.mouse.down();
  await p.mouse.move(s.x + s.perBar, s.y, { steps: 4 });
  await p.mouse.up();
  await p.waitForTimeout(800);
  check('a clip: a quick drag pans the lanes and leaves it where it is',
    (await first()).at === c0.at && await p.isVisible('#view-fit'));
  await p.reload();
  await p.waitForTimeout(2000);
  s = await spot(c0);
  await p.mouse.move(s.x, s.y);
  await p.mouse.down();
  await p.waitForTimeout(450);
  await p.mouse.move(s.x + s.perBar, s.y, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(1000);
  const slid = await first();
  check('a clip: hold, then drag a bar, slides it a bar', slid.at === c0.at + Math.round(c0.bar) || Math.abs(slid.at - (c0.at + c0.bar)) <= 1, `${c0.at} → ${slid.at}, a bar is ${c0.bar}`);
  await p.click('#tape-undo');
  await p.waitForTimeout(1000);
  check('a clip: ↶ puts it back', (await first()).at === c0.at);
  // Tapped, it's selected, with grips on its edges: drag the right one a bar
  // left to trim a bar off its end, then ↶.
  await p.mouse.click(s.x, s.y);
  await p.waitForTimeout(800);
  const c1 = await first();
  s = await spot(c1);
  const lane = await p.evaluate(() => { const b = document.querySelector('.tt-lane').getBoundingClientRect(); return { x: b.left, w: b.width }; });
  const from = Math.max(0, c1.loop.in - c1.bar), to = c1.loop.out + c1.bar;
  const gx = lane.x + ((c1.at + c1.frames - from) / (to - from)) * lane.w - 12;
  await p.mouse.move(gx, s.y);
  await p.mouse.down();
  await p.mouse.move(gx - s.perBar, s.y, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(1000);
  const cut = await first();
  check('a clip: its right grip trims a bar off its end', Math.abs(cut.frames - (c1.frames - c1.bar)) <= 1 && cut.at === c1.at, `${c1.frames} → ${cut.frames}`);
  await p.click('#tape-undo');
  await p.waitForTimeout(1000);
  check('a clip: ↶ puts the trimmed bar back', (await first()).frames === c1.frames);
  // Held and dragged a lane down, it goes onto track 2, outlined on the way;
  // ↶ puts it back on track 1.
  const pitch = await p.evaluate(() => { const l = [...document.querySelectorAll('.tt-lane')]; return l[1].getBoundingClientRect().top - l[0].getBoundingClientRect().top; });
  await p.mouse.move(s.x, s.y);
  await p.mouse.down();
  await p.waitForTimeout(450);
  await p.mouse.move(s.x, s.y + pitch, { steps: 8 });
  const lit = await p.evaluate(() => [...document.querySelectorAll('.tape-track')].map((r) => r.classList.contains('drop-target')));
  await p.mouse.up();
  await p.waitForTimeout(1000);
  const onTwo = await loadedState();
  check('a clip: dragged a lane down, track 2 is outlined', lit[1] && !lit[0], JSON.stringify(lit));
  check('a clip: and it lands on track 2, where it was', onTwo.tape.tracks[1].clips.some((x) => x.id === c0.id && x.at === c0.at) && !onTwo.tape.tracks[0].clips.some((x) => x.id === c0.id));
  await p.click('#tape-undo');
  await p.waitForTimeout(1000);
  check('a clip: ↶ puts it back on track 1', (await loadedState()).tape.tracks[0].clips.some((x) => x.id === c0.id));
  // Its ⟳ corner, dragged to the lane's end and held there, scrolls the
  // view on and lays copies end to end, as many as it reached; ↶ takes them
  // back.
  const n0 = (await loadedState()).tape.tracks[0].clips.length;
  const rx = lane.x + ((c0.at + c0.frames - from) / (to - from)) * lane.w - 12;
  const ry = await p.evaluate(() => { const b = document.querySelector('.tt-lane').getBoundingClientRect(); return b.top + b.height - 12; }); // bottom right
  await p.mouse.move(rx, ry);
  await p.mouse.down();
  await p.mouse.move(lane.x + lane.w - 8, ry, { steps: 8 });
  await p.waitForTimeout(2500);
  await p.mouse.up();
  await p.waitForTimeout(1000);
  const reps = (await loadedState()).tape.tracks[0].clips.filter((x) => x.at >= c0.at + c0.frames);
  const endToEnd = reps.length >= 1 && reps.every((x) => (x.at - c0.at) % c0.frames === 0 && x.frames === c0.frames && x.layer === 0);
  check('a clip: its ⟳ corner held at the lane’s end lays copies end to end', endToEnd, JSON.stringify(reps.map((x) => [x.at, x.layer])));
  await p.click('#tape-undo');
  await p.waitForTimeout(1000);
  check('a clip: ↶ takes the copies back', (await loadedState()).tape.tracks[0].clips.length === n0);
  // Several clips: a tap selects one, ⌘D or Ctrl-D lays a copy after it and
  // selects the copy, Shift-click adds the first again, then drag the pair a
  // lane down together; ↶; Delete; ↶.
  // (Reloaded: the corner's drag scrolled the view.)
  await p.reload();
  await p.waitForTimeout(2000);
  // Its fade handle, the square at its top right, dragged in a bar: a fade
  // out a bar long, on the bar snap; ↶ takes it off.
  s = await spot(c0);
  await p.mouse.click(s.x, s.y);
  await p.waitForTimeout(800);
  const fy = await p.evaluate(() => document.querySelector('.tt-lane').getBoundingClientRect().top + 10);
  const fx = lane.x + ((c0.at + c0.frames - from) / (to - from)) * lane.w - 8;
  await p.mouse.move(fx, fy);
  await p.mouse.down();
  await p.mouse.move(fx - s.perBar, fy, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(1000);
  const faded = (await loadedState()).tape.tracks[0].clips.find((x) => x.id === c0.id);
  check('a clip: its fade handle dragged in a bar fades it out over a bar', !!faded && Math.abs((faded.fade_out || 0) - c1.bar) <= 1, JSON.stringify(faded && faded.fade_out));
  await p.click('#tape-undo');
  await p.waitForTimeout(1000);
  check('a clip: ↶ takes the fade off', !((await loadedState()).tape.tracks[0].clips.find((x) => x.id === c0.id) || {}).fade_out);
  s = await spot(c0);
  await p.mouse.click(s.x, s.y);
  await p.waitForTimeout(800);
  check('several clips: a tap brings up the clip bar, naming the clip', await barOn() && (await p.textContent('#multi-count')).startsWith('Track 1 ·'));
  await p.keyboard.press('ControlOrMeta+KeyD');
  await p.waitForTimeout(1000);
  const dup = (await loadedState()).tape.tracks[0].clips.find((x) => x.at === c0.at + c0.frames);
  check('several clips: ⌘D lays a copy right after it, and selects the copy', !!dup && (await p.textContent('#multi-count')).startsWith('Track 1 ·'));
  s = await spot(c0);
  const pitch2 = await p.evaluate(() => { const l = [...document.querySelectorAll('.tt-lane')]; return l[1].getBoundingClientRect().top - l[0].getBoundingClientRect().top; });
  await p.keyboard.down('Shift');
  await p.mouse.click(s.x, s.y);
  await p.keyboard.up('Shift');
  await p.waitForTimeout(300);
  check('several clips: Shift-click adds the first again', (await p.textContent('#multi-count')) === '2 clips');
  await p.mouse.move(s.x, s.y);
  await p.mouse.down();
  await p.waitForTimeout(450);
  await p.mouse.move(s.x, s.y + pitch2, { steps: 8 });
  await p.mouse.up();
  await p.waitForTimeout(1000);
  const moved = (await loadedState()).tape.tracks[1].clips.map((x) => x.id);
  check('several clips: dragging one moves both a lane down', moved.includes(c0.id) && dup && moved.includes(dup.id), JSON.stringify(moved));
  await p.click('#tape-undo');
  await p.waitForTimeout(1000);
  check('several clips: ↶ puts both back', (await loadedState()).tape.tracks[0].clips.filter((x) => x.id === c0.id || x.id === dup?.id).length === 2);
  // ⌘A or Ctrl+A selects every clip on the tape; Escape lets go.
  await p.keyboard.press('ControlOrMeta+KeyA');
  await p.waitForTimeout(400);
  const everyClip = (await loadedState()).tape.tracks.reduce((n, tr) => n + tr.clips.length, 0);
  const allText = await p.textContent('#multi-count');
  check('several clips: ⌘A selects every clip', everyClip >= 2 && allText === `${everyClip} clips`, `${allText}, ${everyClip} on the tape`);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  check('several clips: Escape lets go of them all', !(await barOn()));
  await p.keyboard.press('ControlOrMeta+KeyA');
  await p.waitForTimeout(300);
  await p.keyboard.press('Delete');
  await p.waitForTimeout(1000);
  const left = (await loadedState()).tape.tracks[0].clips;
  check('several clips: Delete removes them', !left.some((x) => x.id === c0.id || x.id === dup?.id) && !(await barOn()));
  await p.click('#tape-undo');
  await p.waitForTimeout(800);
  await p.click('#tape-undo');
  await p.waitForTimeout(1000);
  check('several clips: ↶ ↶ → the clip alone, as it was', (await loadedState()).tape.tracks[0].clips.length === n0);
  // Align has the clip to itself: the clip bar goes while it's open, and
  // comes back, the clip still selected, when it closes.
  s = await spot(c0);
  await p.mouse.dblclick(s.x, s.y);
  await p.waitForTimeout(400);
  await p.click('#clip-align');
  await p.waitForTimeout(2000);
  if (await p.isVisible('#clip-editor')) {
    check('align: the clip bar goes while a clip is aligned', !(await p.isVisible('#multi-bar')));
    await p.keyboard.press('Escape');
    await p.waitForTimeout(600);
    check('align: and comes back, the clip still selected, when it closes', await barOn() && (await p.textContent('#multi-count')).startsWith('Track 1 ·'));
    await p.keyboard.press('Escape');
    await p.waitForTimeout(300);
  } else {
    console.log('skip align: its editor did not open');
    if (await sheetOpen()) await p.keyboard.press('Escape');
  }
  // Sections: hold and drag on the strip over bars 1–2 → a section and its
  // sheet; call it Verse; tap it → its bars are the loop; remove it; ↶.
  {
    const strip = await p.evaluate(() => { const b = document.getElementById('tape-sections').getBoundingClientRect(); return { x: b.left, y: b.top + b.height / 2, w: b.width }; });
    const fx = (f) => strip.x + ((f - from) / (to - from)) * strip.w;
    const loop0 = (await loadedState()).tape.loop;
    await p.mouse.move(fx(c0.bar * 0.2), strip.y);
    await p.mouse.down();
    await p.waitForTimeout(450);
    await p.mouse.move(fx(c0.bar * 1.8), strip.y, { steps: 6 });
    await p.mouse.up();
    await p.waitForTimeout(1000);
    let secs = (await loadedState()).tape.sections || [];
    check('sections: hold and drag makes one, on bar lines', secs.length === 1 && secs[0].at === 0 && Math.abs(secs[0].end - 2 * c0.bar) <= 1, JSON.stringify(secs));
    check('sections: its sheet opens', await p.evaluate(() => document.getElementById('section-sheet').open));
    await p.locator('#section-names button', { hasText: 'Verse' }).click();
    await p.waitForTimeout(800);
    secs = (await loadedState()).tape.sections || [];
    check('sections: Verse names it', secs[0]?.name === 'Verse');
    await p.keyboard.press('Escape');
    await p.waitForTimeout(300);
    // Its right edge dragged a bar on: bars 1–3, in whole frames.
    await p.mouse.move(fx(secs[0].end) - 3, strip.y);
    await p.mouse.down();
    await p.mouse.move(fx(secs[0].end + c0.bar) - 3, strip.y, { steps: 6 });
    await p.mouse.up();
    await p.waitForTimeout(800);
    const grown = ((await loadedState()).tape.sections || [])[0];
    check('sections: its edge drags a bar on', grown && Number.isInteger(grown.end) && Math.abs(grown.end - 3 * c0.bar) <= 1, JSON.stringify(grown));
    await p.click('#tape-undo');
    await p.waitForTimeout(800);
    await p.mouse.click(fx(c0.bar), strip.y);
    await p.waitForTimeout(800);
    const lp = (await loadedState()).tape.loop;
    check('sections: a tap selects its bars', lp.in === secs[0].at && lp.out === secs[0].end, JSON.stringify(lp));
    await p.mouse.click(fx(c0.bar), strip.y);
    await p.waitForTimeout(500);
    await p.click('#section-remove');
    await p.waitForTimeout(800);
    check('sections: Remove takes it away', ((await loadedState()).tape.sections || []).length === 0);
    await p.click('#tape-undo');
    await p.waitForTimeout(800);
    check('sections: ↶ brings it back', ((await loadedState()).tape.sections || []).length === 1);
    // Put the tape as it was for what follows: no section, the old loop.
    await postJSON(`/api/tapes/edit?id=${encodeURIComponent((await getJSON('/api/tapes')).loaded)}`, { op: 'section-remove', section: secs[0].id });
    await fetch(`${BASE}/api/tapes?id=${encodeURIComponent((await getJSON('/api/tapes')).loaded)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ loop: loop0 }) });
    await p.waitForTimeout(500);
  }
  // Insert and Delete time: hovering Insert previews it on the lanes; a
  // click inserts the clipboard at bar 2, every track after it moved on; ↶.
  // Delete time on bars 2–3 closes the gap; ↶. Duplicate section copies one.
  {
    const id = (await getJSON('/api/tapes')).loaded;
    const tq = `id=${encodeURIComponent(id)}`;
    const patchTape = (body) => fetch(`${BASE}/api/tapes?${tq}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const st0 = await loadedState();
    const loop0 = st0.tape.loop;
    await patchTape({ loop: { in: 0, out: Math.round(c0.bar), on: true } });
    await postJSON(`/api/tapes/edit?${tq}`, { op: 'copy', track: 1 });
    await postJSON(`/api/tapes/transport?${tq}`, { action: 'locate', pos: Math.round(c0.bar) });
    await p.reload();
    await p.waitForTimeout(2000);
    if ((await p.getAttribute('#np-drawer-crate', 'aria-expanded')) !== 'true') await p.click('#np-drawer-crate');
    await p.waitForTimeout(400);
    const lanePic = () => p.evaluate(() => document.querySelector('.tt-lane').toDataURL());
    const before = await lanePic();
    await p.hover('#insert');
    await p.waitForTimeout(400);
    check('insert: hovering it previews it on the lanes', (await lanePic()) !== before);
    const n1 = (await loadedState()).tape.tracks[0].clips.length;
    await p.click('#insert');
    await p.waitForTimeout(1000);
    const after = (await loadedState()).tape.tracks[0].clips.map((x) => [x.at, x.frames]).sort((a, b) => a[0] - b[0]);
    check('insert: the clipboard goes in at the playhead, and the rest moves on', after.length === n1 + 2 && after[1][0] === Math.round(c0.bar) && after[2][0] === Math.round(2 * c0.bar), JSON.stringify(after));
    await p.click('#tape-undo');
    await p.waitForTimeout(800);
    check('insert: ↶ puts it as it was', (await loadedState()).tape.tracks[0].clips.length === n1);
    // At the tape's start: 0 is a place, and the toast says bar 1.
    await postJSON(`/api/tapes/transport?${tq}`, { action: 'locate', pos: 0 });
    await p.waitForTimeout(700);
    await p.click('#insert');
    await p.waitForTimeout(1000);
    const said0 = await p.locator('#toasts .toast').last().textContent();
    const at0 = (await loadedState()).tape.tracks[0].clips.map((x) => x.at).sort((a, b) => a - b);
    check('insert: at the start, where it showed, and the toast says bar 1', /at bar 1 ·/.test(said0) && at0[0] === 0 && at0[1] === Math.round(c0.bar), `${said0} ${JSON.stringify(at0)}`);
    await p.click('#tape-undo');
    await p.waitForTimeout(800);
    // A range: the loop on bar 2 shows bars 1–3, so the ruler held in its
    // middle and let go is bar 2 on every track; the action bar names it,
    // and its Copy takes four tracks. Then its Delete time.
    await patchTape({ loop: { in: Math.round(c0.bar), out: Math.round(2 * c0.bar), on: true } });
    await p.reload();
    await p.waitForTimeout(2000);
    const rb = await p.locator('#tape-ruler').boundingBox();
    await p.mouse.move(rb.x + rb.width / 2, rb.y + rb.height / 2);
    await p.mouse.down();
    await p.waitForTimeout(450);
    await p.mouse.up();
    await p.waitForTimeout(600);
    check('a range: held on the ruler, bar 2 on every track, named on the action bar', !(await p.isHidden('#range-cut')) && (await p.textContent('#multi-count')) === 'All tracks · bar 2', await p.textContent('#multi-count'));
    await p.click('#range-copy');
    await p.waitForTimeout(800);
    const cb = (await getJSON('/api/clipboard')).clipboard;
    check('a range: its Copy takes its bar, a clipboard track for each track', cb && cb.tracks.length === 4 && Math.abs(cb.frames - c0.bar) <= 1, JSON.stringify(cb && [cb.tracks.length, cb.frames]));
    const len = (await loadedState()).tape.tracks[0].clips.reduce((a, x) => a + x.frames, 0);
    await p.click('#range-delete');
    await p.waitForTimeout(1000);
    const len2 = (await loadedState()).tape.tracks[0].clips.reduce((a, x) => a + x.frames, 0);
    check('delete time: a bar comes out and the gap closes', Math.abs(len - len2 - c0.bar) <= 1 && Math.max(...(await loadedState()).tape.tracks[0].clips.map((x) => x.at + x.frames)) <= 3 * c0.bar + 1, `${len} → ${len2}`);
    await p.click('#tape-undo');
    await p.waitForTimeout(800);
    // The crate's drawer is open: Escape closes it first, then lets the range go.
    await p.keyboard.press('Escape');
    await p.keyboard.press('Escape');
    await p.waitForTimeout(300);
    check('a range: Escape lets it go', await p.isHidden('#multi-bar'));
    // Duplicate section: a Verse on bar 1, its sheet (the strip from the
    // keys: Enter selects it, Enter again opens it), Duplicate.
    const v = (await postJSON(`/api/tapes/edit?${tq}`, { op: 'section-add', name: 'Verse', at: 0, end: Math.round(c0.bar) })).edit.section;
    await p.waitForTimeout(600);
    await p.focus('#tape-sections');
    await p.keyboard.press('Enter');
    await p.waitForTimeout(500);
    await p.keyboard.press('Enter');
    await p.waitForTimeout(400);
    await p.click('#section-dup');
    await p.waitForTimeout(1000);
    const secs = (await loadedState()).tape.sections || [];
    check('duplicate section: the Verse twice in a row', secs.length === 2 && secs[1].name === 'Verse' && secs[1].at === v.end, JSON.stringify(secs));
    await p.click('#tape-undo');
    await p.waitForTimeout(800);
    check('duplicate section: ↶ takes the copy back', ((await loadedState()).tape.sections || []).length === 1);
    // No section left for the next run: selecting it with Enter was a step
    // of its own, so it goes by name.
    for (const sc of (await loadedState()).tape.sections || []) await postJSON(`/api/tapes/edit?${tq}`, { op: 'section-remove', section: sc.id });
    // J: back five seconds of tape.
    const srJ = st0.tape.sample_rate;
    await postJSON(`/api/tapes/transport?${tq}`, { action: 'locate', pos: 10 * srJ });
    await p.waitForTimeout(700);
    await p.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => {});
    await p.keyboard.press('j');
    await p.waitForTimeout(900);
    const heardJ = (await loadedState()).live.heard;
    check('J goes back five seconds of tape', Math.abs(heardJ - 5 * srJ) <= srJ * 0.1, `${heardJ / srJ} s`);
    await patchTape({ loop: loop0 });
    await p.waitForTimeout(500);
  }
  // Fades: in the clip's sheet (a double-click), Fade in → 1 beat, then off.
  s = await spot(c0);
  await p.mouse.dblclick(s.x, s.y);
  await p.waitForTimeout(400);
  const beat = c0.bar / 4;
  await p.locator('#clip-fade-in button', { hasText: '1 beat' }).click();
  await p.waitForTimeout(800);
  const fin = (await loadedState()).tape.tracks[0].clips.find((x) => x.id === c0.id);
  check('fades: Fade in → 1 beat fades the clip in over a beat', Math.abs((fin.fade_in || 0) - beat) <= 1, `${fin.fade_in} vs ${beat}`);
  check('fades: the sheet lights it', (await p.getAttribute('#clip-fade-in button:nth-child(5)', 'aria-pressed')) === 'true');
  await p.locator('#clip-fade-in button', { hasText: 'off' }).click();
  await p.waitForTimeout(800);
  check('fades: off takes it off', !((await loadedState()).tape.tracks[0].clips.find((x) => x.id === c0.id).fade_in));
  await p.keyboard.press('Escape');
  await p.waitForTimeout(300);
  // The crate: Keep the clip from the action bar, open Crate ▴, Paste it on
  // track 3; ↶. And a take's span kept, shown on its own with ?crate=.
  const crateBefore = (await getJSON('/api/crate')).clips.length;
  s = await spot(c0);
  await p.mouse.click(s.x, s.y);
  await p.waitForTimeout(900); // the bar up, and taking clicks
  await p.click('#multi-keep');
  await p.waitForTimeout(800);
  await p.keyboard.press('Escape'); // let go: the clip bar off the dock
  await p.waitForTimeout(300);
  const kept = (await getJSON('/api/crate')).clips;
  check('the crate: Keep puts the clip on it, by reference', kept.length === crateBefore + 1 && kept[0].source.kind === 'tape', JSON.stringify(kept[0]));
  await p.keyboard.press('3');
  await p.click('#np-drawer-crate');
  await p.waitForTimeout(800);
  check('the crate: Crate ▴ lists it', (await p.locator('#crate-list .crate-row').count()) === kept.length);
  await p.locator('#crate-list .crate-drop').first().click();
  await p.waitForTimeout(1000);
  const t3 = (await loadedState()).tape.tracks[2].clips;
  check('the crate: Paste puts it on the selected track', t3.length === 1 && t3[0].file === kept[0].file, JSON.stringify(t3));
  await p.click('#tape-undo');
  await p.waitForTimeout(800);
  check('the crate: ↶ takes the drop back', (await loadedState()).tape.tracks[2].clips.length === 0);
  const jams = await getJSON('/api/jams');
  const take = (jams.jams || jams.takes || jams)[0];
  if (take) {
    const k = await postJSON('/api/crate', { take: take.name, from: 0, to: 48000 });
    await p.goto(`${BASE}/tape.html?crate=${encodeURIComponent(take.name)}`);
    await p.waitForTimeout(1500);
    const rows = await p.locator('#crate-list .crate-name').allTextContents();
    check('the crate: ?crate= opens it on that take’s clips', await p.isVisible('#crate-from') && rows.some((r) => r.includes(k.clip.name)) && rows.length === (await getJSON(`/api/crate?take=${encodeURIComponent(take.name)}`)).clips.length, JSON.stringify(rows));
    await p.click('#np-drawer-crate');
    // Split here on the take page: two clips on the crate, A and B, and the
    // take as it was. The split is at 3 s, so the take needs to be longer.
    if (take.duration_seconds < 4) console.log(`skip split here: ${take.name} is under 4 s`);
    else {
    const before = (await getJSON(`/api/crate?take=${encodeURIComponent(take.name)}`)).clips.length;
    const len = take.duration_seconds;
    const sr = take.sample_rate || 48000;
    await p.goto(`${BASE}/wave.html?file=${encodeURIComponent(take.name)}`);
    await p.waitForTimeout(2000);
    await p.focus('#overview-canvas');
    for (let i = 0; i < 3; i++) await p.keyboard.press('ArrowRight'); // the playhead to 0:03
    await p.click('#more-btn');
    await p.click('#split-here');
    await p.waitForTimeout(1200);
    const split = (await getJSON(`/api/crate?take=${encodeURIComponent(take.name)}`)).clips;
    const [a, b] = split;
    check('split here: two clips on the crate, A then B', split.length === before + 2 && a.name.endsWith(' · A') && b.name.endsWith(' · B') && a.frames === 3 * sr, JSON.stringify(split.slice(0, 2).map((x) => [x.name, x.frames])));
    const all = await getJSON('/api/jams');
    const again = (all.jams || all).find((x) => x.name === take.name);
    check('split here: the take is as it was', again && Math.abs(again.duration_seconds - len) < 1e-6);
    check('split here: the take page’s ◫ chip counts them', (await p.textContent('#crate-chip')) === `◫ ${split.length}`);
    }
  }
  check('a clip: no page errors', errors.length === 0, errors.join('; '));
  await p.context().close();
}

// On a phone Insert asks first: one tap shows what it will do, a second does
// it. (The clipboard from the checks above.)
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const p = await ctx.newPage();
  await p.goto(`${BASE}/tape.html`);
  await p.waitForTimeout(2000);
  const count = async () => (await loadedState()).tape.tracks.reduce((a, t) => a + t.clips.length, 0);
  const n0 = await count();
  await p.locator('#insert').scrollIntoViewIfNeeded();
  await p.tap('#insert');
  await p.waitForTimeout(800);
  check('phone: a first tap on Insert only shows it', (await count()) === n0 && await p.evaluate(() => document.getElementById('insert').classList.contains('confirming')));
  await p.tap('#insert');
  await p.waitForTimeout(1000);
  check('phone: a second tap inserts', (await count()) > n0);
  await p.tap('#tape-undo');
  await p.waitForTimeout(800);
  check('phone: ↶ after it', (await count()) === n0);
  await ctx.close();
}

// Playing on a phone: a browser that isn't listening shows the banner, and
// Rec explains that it needs the jam room.
{
  const put = (mode) => fetch(`${BASE}/api/tapes/output`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ mode }) });
  const p = await (await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true })).newPage();
  // A track armed, for its inspector below: track 1 if none is.
  const t0 = (await loadedState()).tape;
  const armIt = (rec) => fetch(`${BASE}/api/tapes?id=${encodeURIComponent(t0.id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rec_track: rec }) });
  if (t0.rec_track === -1) await armIt(1);
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
    // The recording is in the record track's inspector: its name, twice.
    await p.locator('.tape-track.rec .tt-name').click();
    await p.locator('.tape-track.rec .tt-name').click();
    await p.waitForTimeout(500);
    check('phone mode: the track inspector says Rec and Catch wait', await p.locator('#jam-only-note').isVisible());
    check('phone mode: its Input, Catch the last and the passes wait too',
      !(await p.locator('.tb-row.sources').isVisible()) && !(await p.locator('.tb-row.catch').isVisible()) && !(await p.locator('.tb-row.passes').isVisible()));
    await p.keyboard.press('Escape');
    await put('jam');
    await p.waitForTimeout(4000);
    check('jam mode: the banner hides again', !(await p.locator('#out-banner').isVisible()));
  } finally {
    await put('jam');
    if (t0.rec_track === -1) await armIt(-1);
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
    await p.click('#out-btn');
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
