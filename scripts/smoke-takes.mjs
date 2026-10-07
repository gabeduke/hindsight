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

// The take's now-playing bar: its overview is the bar's scrubber, ▶ turns to
// ❚❚ and the lamp lights, a tap on the scrubber moves the playhead, and on a
// phone, upright or sideways, the mini player has ▶ and its pulled-up player
// ▶, In and the scrubber.
{
  const takes = await (await fetch(`${BASE}/api/jams`)).json();
  const url = `${BASE}/wave.html?file=${encodeURIComponent(takes[0].name)}`;
  const p = await (await browser.newContext({ viewport: { width: 1024, height: 768 } })).newPage();
  await p.goto(url);
  await p.waitForTimeout(2000);
  check('a take: the overview is the bar\'s scrubber', await p.evaluate(() => !!document.querySelector('#np #overview-canvas')));
  await p.click('#play');
  await p.waitForTimeout(1200);
  const playing = await p.evaluate(() => ({ glyph: document.getElementById('play').textContent, lamp: document.getElementById('np-status').dataset.state }));
  check('a take: ▶ turns to ❚❚ and the lamp lights', playing.glyph === '❚❚' && playing.lamp === 'play', JSON.stringify(playing));
  await p.click('#play');
  const box = await p.locator('#overview-canvas').boundingBox();
  await p.mouse.click(box.x + box.width * 0.75, box.y + box.height / 2);
  await p.waitForTimeout(400);
  const at = await p.evaluate(() => Number(document.getElementById('overview-canvas').getAttribute('aria-valuenow')) / Number(document.getElementById('overview-canvas').getAttribute('aria-valuemax')));
  check('a take: a tap on the scrubber moves the playhead there', Math.abs(at - 0.75) < 0.03, at.toFixed(3));
  await p.context().close();
  for (const [w, h] of [[390, 844], [844, 390]]) {
    const q = await (await browser.newContext({ viewport: { width: w, height: h }, hasTouch: true })).newPage();
    await q.goto(url);
    await q.waitForTimeout(1800);
    const on = (sel) => q.evaluate((sel) => sel.every((s) => {
      const b = document.querySelector(s).getBoundingClientRect();
      return b.width > 0 && b.top >= 0 && b.bottom <= innerHeight;
    }), sel);
    check(`a take, ${w}x${h}: the mini player has its window and ▶`, await on(['#np-expand', '#play']));
    await q.click('#np-expand');
    await q.waitForTimeout(300);
    const big = await on(['#play', '#set-in', '#overview-canvas']);
    check(`a take, ${w}x${h}: the player has ▶, In and the scrubber on screen`, big);
    await q.context().close();
  }
}

// The now-playing bar on a wide takes page: it holds the picked take (the
// cassette's own Play gives way to it), ▶ turns the cassette's hubs, a press
// on another spine puts that take in the bar, and ⏏ puts the tape back.
{
  const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await p.goto(`${BASE}/takes.html`);
  await p.waitForTimeout(2500);
  const bar = () => p.evaluate(() => ({
    shown: !document.getElementById('np').hidden,
    marquee: document.getElementById('np-marquee').textContent,
    open: document.getElementById('np-open').textContent,
    eject: !document.getElementById('np-eject').hidden,
    picked: document.querySelector('.take.picked')?.dataset.name || '',
    hubs: !!document.querySelector('.cassette.playing'),
    detailPlay: getComputedStyle(document.querySelector('.detail-play')).display,
  }));
  const a = await bar();
  check('takes: the bar holds the picked take', a.shown && a.open === 'Open the take ›' && a.detailPlay === 'none', JSON.stringify(a));
  await p.click('#np-play');
  await p.waitForTimeout(1200);
  check('takes: ▶ in the bar turns the cassette', (await bar()).hubs);
  await p.click('#np-play');
  const other = await p.evaluate(() => [...document.querySelectorAll('.take.spine')].find((e) => !e.hidden && !e.classList.contains('picked'))?.dataset.name);
  if (other) {
    await p.click(`.take[data-name="${other}"]`);
    await p.waitForTimeout(1500);
    const b = await bar();
    check('takes: another spine puts its take in the bar', b.picked === other && b.marquee !== a.marquee, JSON.stringify(b));
  }
  if (a.eject) {
    await p.click('#np-eject');
    await p.waitForTimeout(1200);
    const c = await bar();
    check('takes: ⏏ puts the tape back', /^Open (?!the take)/.test(c.open) && !c.eject, JSON.stringify(c));
  }
  await p.context().close();
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

// Save as take asks for a name first, offering the one it would get anyway.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(BASE);
  const jam = await p.evaluate(async () => {
    const r = await fetch('/api/trigger?seconds=12', { method: 'POST' }).then((x) => x.json());
    await fetch(`/api/take?file=${encodeURIComponent(r.name)}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: 'smoke jam', trim: { start_frame: 96000, end_frame: 240000 } }),
    });
    return r.name;
  });
  await p.goto(`${BASE}/wave.html?file=${encodeURIComponent(jam)}`);
  await settle(p, 2000);
  await p.locator('#save-take').click();
  const offered = await p.locator('#save-name-input').inputValue();
  check('Save as take offers the name it would get', offered === 'smoke jam · 0:02.0–0:05.0', offered);
  await p.locator('#save-name-input').fill('smoke riff');
  await p.keyboard.press('Enter');
  await settle(p, 1500);
  const saved = await p.evaluate((src) => fetch('/api/jams').then((r) => r.json())
    .then((l) => l.filter((t) => t.source?.name === src).map((t) => t.label)), jam);
  check('Enter saves it under the name typed', saved.includes('smoke riff'), JSON.stringify(saved));
  check('the verbs come back after a save', await p.locator('.tb-row.verbs').isVisible());
  await ctx.close();
}

// 🗑 on the take page: one tap, and on to the next take in the list's
// order; its Undo opens the deleted one again. From the last, the one
// before it opens.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(BASE);
  const order = await p.evaluate(async () => {
    // The takes these saves made, not the list's first three (starred first).
    const o = [];
    for (let i = 0; i < 3; i++) o.push((await fetch('/api/trigger?seconds=8', { method: 'POST' }).then((r) => r.json())).name);
    sessionStorage.setItem('hindsight.order', JSON.stringify(o));
    return o;
  });
  const shown = () => new URL(p.url()).searchParams.get('file');
  await p.goto(`${BASE}/wave.html?file=${encodeURIComponent(order[1])}`);
  await settle(p, 1500);
  await p.locator('#take-trash').click();
  await p.waitForURL((u) => u.searchParams.get('file') !== order[1], { timeout: 8000 }).catch(() => {});
  await settle(p, 1200);
  check('🗑 opens the next take', shown() === order[2], shown());
  const said = await p.locator('#toasts .toast').last().textContent();
  check('the next take says "Deleted … · Undo"', /^Deleted .*Undo$/.test(said), said);
  const prev = await p.evaluate(() => JSON.parse(sessionStorage.getItem('hindsight.order')));
  check('the list\'s order no longer has it', JSON.stringify(prev) === JSON.stringify([order[0], order[2]]), JSON.stringify(prev));
  await p.locator('#toasts .toast-action', { hasText: 'Undo' }).last().click();
  await p.waitForURL((u) => u.searchParams.get('file') === order[1], { timeout: 8000 }).catch(() => {});
  await settle(p, 1500);
  const t = await p.evaluate((n) => fetch(`/api/take?file=${encodeURIComponent(n)}`).then((r) => r.json()), order[1]);
  check('Undo opens it again, starred', shown() === order[1] && t.starred === true, shown());
  const again = await p.evaluate(() => JSON.parse(sessionStorage.getItem('hindsight.order')));
  check('and puts it back in the order', JSON.stringify(again) === JSON.stringify(order), JSON.stringify(again));
  await p.goto(`${BASE}/wave.html?file=${encodeURIComponent(order[2])}`);
  await settle(p, 1500);
  await p.locator('#take-trash').click();
  await p.waitForURL((u) => u.searchParams.get('file') !== order[2], { timeout: 8000 }).catch(() => {});
  await settle(p, 1000);
  check('🗑 on the last opens the one before', shown() === order[1], shown());
  await p.evaluate((n) => fetch(`/api/trash/restore?file=${encodeURIComponent(n)}`, { method: 'POST' }), order[2]);
  // A take the list's order doesn't have (a cut opened from its toast):
  // back to the list, and the order is left as it was.
  await p.evaluate((o) => sessionStorage.setItem('hindsight.order', JSON.stringify([o[0], o[2]])), order);
  await p.goto(`${BASE}/takes.html`);
  await settle(p, 1000);
  await p.evaluate((o) => sessionStorage.setItem('hindsight.order', JSON.stringify([o[0], o[2]])), order);
  await p.goto(`${BASE}/wave.html?file=${encodeURIComponent(order[1])}`);
  await settle(p, 1500);
  await p.locator('#take-trash').click();
  await p.waitForURL((u) => u.pathname.endsWith('/takes.html'), { timeout: 8000 }).catch(() => {});
  await settle(p, 800);
  const kept = await p.evaluate(() => sessionStorage.getItem('hindsight.order'));
  check('🗑 on a take the list didn\'t show goes back to the list', p.url().includes('/takes.html') && !kept.includes(order[1]), `${p.url()} ${kept}`);
  await p.evaluate((n) => fetch(`/api/trash/restore?file=${encodeURIComponent(n)}`, { method: 'POST' }), order[1]);
  await ctx.close();
}

// 🗑 on a phone with the notes pane open: the next take opens, and Back
// goes to the list, not to the deleted take.
{
  const ctx = await browser.newContext(phone);
  const p = await ctx.newPage();
  await p.goto(BASE);
  const two = await p.evaluate(async () => {
    const o = [];
    for (let i = 0; i < 2; i++) o.push((await fetch('/api/trigger?seconds=8', { method: 'POST' }).then((r) => r.json())).name);
    return o;
  });
  await p.goto(`${BASE}/takes.html`);
  await settle(p, 1500);
  await p.evaluate((o) => sessionStorage.setItem('hindsight.order', JSON.stringify(o)), two);
  await p.goto(`${BASE}/wave.html?file=${encodeURIComponent(two[0])}`);
  await settle(p, 2000);
  const notes = await p.locator('#notes-open').isVisible();
  if (notes) {
    await p.click('#notes-open');
    await settle(p, 600);
  }
  await p.locator('#take-trash').click();
  await p.waitForURL((u) => u.searchParams.get('file') === two[1], { timeout: 8000 }).catch(() => {});
  await settle(p, 1200);
  await p.goBack();
  await settle(p, 1200);
  check(`🗑 with the notes pane ${notes ? 'open' : '(none: no MIDI)'}: Back goes to the list, not the deleted take`, p.url().includes('/takes.html'), p.url());
  await p.evaluate((n) => fetch(`/api/trash/restore?file=${encodeURIComponent(n)}`, { method: 'POST' }), two[0]);
  await ctx.close();
}

// ▶ Play all: the takes shown, each from its In to its Out, one after
// another, the playing spine ringed; a take picked by hand stops it. And
// ⚑▸ past a take's last flag opens the next take at its first flag.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(BASE);
  const made = await p.evaluate(async () => {
    const names = [];
    for (let i = 0; i < 2; i++) names.push((await fetch('/api/trigger?seconds=6', { method: 'POST' }).then((r) => r.json())).name);
    // Each a second's selection, so Play all moves on quickly.
    for (const n of names) {
      await fetch(`/api/take?file=${encodeURIComponent(n)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trim: { start_frame: 48000, end_frame: 96000 } }) });
    }
    return names.reverse(); // newest first, as the list shows them
  });
  await p.waitForTimeout(3000); // their previews
  await p.goto(`${BASE}/takes.html`);
  await settle(p, 2000);
  await p.locator(`.take[data-name="${made[0]}"]`).click();
  await settle(p, 800);
  await p.click('#play-all');
  const seen = [];
  for (let i = 0; i < 40; i++) {
    await p.waitForTimeout(100);
    const n = await p.evaluate(() => document.querySelector('.take.play-all')?.dataset.name || null);
    if (n && seen[seen.length - 1] !== n) seen.push(n);
    if (seen.length >= 2) break;
  }
  check('▶ Play all plays the picked take, then the next, ringed', seen[0] === made[0] && seen[1] === made[1], JSON.stringify(seen));
  check('the key says ■ Stop while it plays', (await p.textContent('#play-all')).includes('Stop'));
  const other = await p.evaluate((skip) => [...document.querySelectorAll('.take:not(.folded)')].map((e) => e.dataset.name).find((n) => !skip.includes(n)), made);
  await p.locator(`.take[data-name="${other}"]`).click();
  await settle(p, 600);
  check('a take picked by hand stops Play all', (await p.textContent('#play-all')).includes('Play all') && !(await p.locator('.take.play-all').count()));
  // Select mode stops it and turns its key off; Done turns the key on.
  await p.locator(`.take[data-name="${made[0]}"]`).click();
  await settle(p, 400);
  await p.click('#play-all');
  await settle(p, 600);
  await p.click('#select-btn');
  await settle(p, 300);
  check('Select stops Play all, and its key is off meanwhile', !(await p.locator('.take.play-all').count()) && await p.isDisabled('#play-all'));
  await p.click('#select-btn');
  await settle(p, 300);
  check('leaving Select turns the key on again', !(await p.isDisabled('#play-all')));
  // With no animation frames (a hidden page, a phone's screen off), the
  // take's audio still moves it on.
  const pg = await ctx.newPage();
  await pg.addInitScript(() => { window.__noFrames = true; });
  await pg.goto(`${BASE}/takes.html`);
  await settle(pg, 2000);
  await pg.locator(`.take[data-name="${made[0]}"]`).click();
  await settle(pg, 600);
  await pg.evaluate(() => { window.requestAnimationFrame = () => 0; });
  await pg.click('#play-all');
  let movedOn = false;
  for (let i = 0; i < 40 && !movedOn; i++) {
    await pg.waitForTimeout(150);
    movedOn = await pg.evaluate((n) => document.querySelector('.take.play-all')?.dataset.name === n, made[1]);
  }
  check('with no animation frames, Play all still moves on', movedOn);
  await pg.close();
  // A take whose audio won't load is skipped, not stuck on.
  const pe = await ctx.newPage();
  await pe.route(new RegExp(`/api/download\\?file=${made[0].replace('.wav', '_preview.mp3').replace(/\./g, '\\.')}`), (route) => route.fulfill({ status: 404, body: 'gone' }));
  await pe.goto(`${BASE}/takes.html`);
  await settle(pe, 2000);
  await pe.locator(`.take[data-name="${made[0]}"]`).click();
  await settle(pe, 600);
  await pe.click('#play-all');
  let skipped = false;
  for (let i = 0; i < 40 && !skipped; i++) {
    await pe.waitForTimeout(150);
    skipped = await pe.evaluate((n) => document.querySelector('.take.play-all')?.dataset.name === n, made[1]);
  }
  check('a take whose audio won’t load is skipped', skipped);
  await pe.click('#play-all').catch(() => {});
  await pe.close();

  // ⚑▸ past the last flag: the next take in the list's order, at its first flag.
  await p.evaluate(async ([a, b]) => {
    await fetch(`/api/take?file=${encodeURIComponent(b)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flags: [{ id: 'f1', frame: 96000 }, { id: 'f2', frame: 192000 }] }) });
    sessionStorage.setItem('hindsight.order', JSON.stringify([a, b]));
  }, made);
  await p.goto(`${BASE}/wave.html?file=${encodeURIComponent(made[0])}`);
  await settle(p, 1500);
  await p.click('#flag-next');
  await p.waitForURL((u) => u.searchParams.get('file') === made[1], { timeout: 8000 }).catch(() => {});
  await settle(p, 1500);
  const where = await p.evaluate(() => `${document.getElementById('position').textContent} ${document.getElementById('np-time').textContent}`);
  check('⚑▸ past the last flag opens the next take at its first flag', new URL(p.url()).searchParams.get('file') === made[1] && where.includes('0:02.0'), where);
  await p.click('#flag-prev');
  await settle(p, 300);
  await p.click('#flag-prev');
  await p.waitForURL((u) => u.searchParams.get('file') === made[0], { timeout: 8000 }).catch(() => {});
  check('◂⚑ past the first flag goes back to the take before', new URL(p.url()).searchParams.get('file') === made[0], p.url());
  await ctx.close();
}

// The flags as a list on the take page, a tap plays from one; J (↺ 5 s)
// goes back five seconds; and the takes page's bar has ↺ 5 s too.
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(BASE);
  const name = await p.evaluate(async () => {
    const n = (await fetch('/api/trigger?seconds=20', { method: 'POST' }).then((r) => r.json())).name;
    await fetch(`/api/take?file=${encodeURIComponent(n)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ trim: null, flags: [{ id: 'f2', frame: 480000, label: 'chorus' }, { id: 'f1', frame: 96000 }] }) });
    return n;
  });
  await p.waitForTimeout(3000);
  // The time in the bar's window, in seconds: the small line with a tempo,
  // else the big one.
  const secsNow = () => p.evaluate(() => {
    const m = `${document.getElementById('np-time').textContent} ${document.getElementById('position').textContent}`.match(/(\d+):(\d\d(?:\.\d)?)/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
  });
  await p.goto(`${BASE}/wave.html?file=${encodeURIComponent(name)}`);
  await settle(p, 1500);
  check('⚑ N counts the flags', (await p.textContent('#flags-count')) === '2');
  await p.click('#flags-list');
  await settle(p, 300);
  const items = await p.locator('#flags-items .flags-item').allTextContents();
  check('the flags list: in time order, named, with times', items.length === 2 && /flag.*0:02/.test(items[0]) && /chorus.*0:10/.test(items[1]), JSON.stringify(items));
  await p.locator('#flags-items .flags-item').nth(1).click();
  await settle(p, 1200);
  const playing = await p.getAttribute('#play', 'aria-label');
  const at = await secsNow();
  check('a tap plays from it, and the sheet closes', playing === 'Pause' && at >= 10 && at < 12 && !(await p.evaluate(() => document.getElementById('flags-sheet').open)), `${playing} ${at}`);
  await p.keyboard.press('j');
  await settle(p, 300);
  const back = await secsNow();
  check('J goes back five seconds and plays on', back >= 5 && back < 7.5 && (await p.getAttribute('#play', 'aria-label')) === 'Pause', `${at} → ${back}`);
  await p.click('#play');
  await settle(p, 300);
  // Under the open list, J moves nothing.
  const still = await secsNow();
  await p.click('#flags-list');
  await settle(p, 300);
  await p.keyboard.press('j');
  await settle(p, 300);
  check('J under the open list moves nothing', Math.abs((await secsNow()) - still) < 0.05, `${still} → ${await secsNow()}`);
  await p.click('#flags-done');
  // With a selection looping, a flag outside it turns Loop off and plays
  // from the flag, not from In.
  await p.evaluate((n) => fetch(`/api/take?file=${encodeURIComponent(n)}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ trim: { start_frame: 48000, end_frame: 144000 } }) }), name);
  await p.reload();
  await settle(p, 1500);
  await p.click('#loop');
  await settle(p, 300);
  await p.click('#flags-list');
  await settle(p, 300);
  await p.locator('#flags-items .flags-item').nth(1).click();
  await settle(p, 1200);
  const fromFlag = await secsNow();
  check('a flag outside a looping selection plays from the flag, Loop off', fromFlag >= 10 && fromFlag < 12 && (await p.getAttribute('#loop', 'aria-pressed')) === 'false', `${fromFlag}`);
  await p.click('#play');
  // The takes page's bar.
  await p.goto(`${BASE}/takes.html`);
  await settle(p, 1800);
  await p.locator(`.take[data-name="${name}"]`).click();
  await settle(p, 1000);
  const sc = await p.locator('#np-scrub').boundingBox();
  await p.mouse.click(sc.x + sc.width * 0.5, sc.y + sc.height / 2);
  await settle(p, 400);
  const mid = await secsNow();
  await p.click('#np-back5');
  await settle(p, 400);
  const less = await secsNow();
  check('the takes page’s ↺ 5 s goes back five seconds', Math.abs(mid - less - 5) < 0.3, `${mid} → ${less}`);
  await ctx.close();
}

// Dropouts: the demo reports an overflow on SIGUSR1, as an interface does
// when the Pi falls behind it; a capture over it says ⚠ 1 dropout on its
// page, in its flags list, and on its cassette. Needs the demo's pid:
// HINDSIGHT_PID=… (skipped without it).
if (process.env.HINDSIGHT_PID) {
  process.kill(Number(process.env.HINDSIGHT_PID), 'SIGUSR1');
  await new Promise((r) => setTimeout(r, 3000));
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(BASE);
  const name = await p.evaluate(() => fetch('/api/trigger?seconds=10', { method: 'POST' }).then((r) => r.json()).then((b) => b.name));
  await p.waitForTimeout(3000);
  const tk = await p.evaluate((n) => fetch(`/api/take?file=${encodeURIComponent(n)}`).then((r) => r.json()), name);
  check('dropouts: a capture over an overflow has one', (tk.dropouts || []).length === 1, JSON.stringify(tk.dropouts));
  await p.goto(`${BASE}/wave.html?file=${encodeURIComponent(name)}`);
  await settle(p, 1500);
  check('dropouts: the take page says ⚠ 1 dropout', (await p.textContent('#take-drops')) === '⚠ 1 dropout' && await p.isVisible('#take-drops'));
  await p.click('#flags-list');
  await settle(p, 300);
  const rows = await p.locator('#flags-items .flags-item.dropout').count();
  check('dropouts: ⚑ N lists it, and doesn’t count it', rows === 1 && (await p.textContent('#flags-count')) === '0');
  await p.keyboard.press('Escape');
  await p.goto(`${BASE}/takes.html`);
  await settle(p, 1800);
  await p.locator(`.take[data-name="${name}"]`).click();
  await settle(p, 1500);
  check('dropouts: the cassette wears the sticker', (await p.locator('#take-detail .cas-drops').textContent()) === '⚠ 1 dropout' && await p.locator('#take-detail .cas-drops').isVisible());
  await ctx.close();
} else {
  console.log('skip dropouts: set HINDSIGHT_PID to the demo\'s pid');
}

await browser.close();
if (failures.length) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}
console.log('\nall passed');
