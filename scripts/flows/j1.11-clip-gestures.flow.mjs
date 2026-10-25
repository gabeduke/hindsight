// J1.11 Edit a part with a finger (lib/tape/clipgestures.js): a tap selects
// it (the clip bar names it, nothing pops up), Enter or a double tap opens
// its sheet, Escape closes the sheet and keeps it selected, → moves it a
// bar and a second Escape lets go, all in the Studio; with a track's
// inspector open as the part is tapped, Escape closes the inspector first,
// then lets go of the part; a quick drag pans the lanes and leaves it be,
// and a hold then a drag slides it a bar, which ↶ takes back.
// docs/flows.md#j111
// Ported from the retired scripts/smoke-tape.mjs ("A clip's gestures").

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default {
  id: 'J1.11',
  title: 'Tap, open, nudge, pan and slide a part',
  async run(t) {
    const { page, api } = t;
    const touch = t.profile !== 'desktop';

    // A 4-bar tape at 96 BPM with the first 4 bars of a take on track 1 at
    // the loop's start.
    const tape = await t.given('a fresh tape', () => api.tape('Clip gestures'));
    const take = await t.given('a take on the shelf', () => api.keep(20)); // a kept take is trimmed to its bars: 12 s keeps under 4
    const st = await api.tapeState();
    const bar = st.grid.frames / st.grid.bars;
    const loop = st.loop;
    const dropped = await t.given('the take\'s first 4 bars on track 1', () => api.post(`/api/tapes/drop?id=${encodeURIComponent(tape.id)}`,
      { take: take.name, from: 0, to: Math.round(4 * bar), track: 1, at: loop.in }));
    t.expect('the tape has a part on track 1', dropped?.clip, dropped);
    if (!dropped?.clip) return;
    const id = dropped.clip.id ?? dropped.clip;
    const clip = async () => (await api.tapeState()).tracks.flatMap((tr, i) => tr.clips.map((c) => ({ ...c, track: i + 1 }))).find((c) => c.id === id);
    const c0 = await clip();

    await t.given('the Studio is open', () => page.goto(`${t.base}/tape.html`));
    await page.locator('.tt-lane').first().waitFor({ state: 'visible' });
    await t.wait(800); // the lanes draw after the first state poll

    // Where the part's first bar is on screen: the lanes show the loop and a
    // bar either side (geometry.js editView) until something pans them.
    const spot = async () => {
      const r = await page.locator('.tt-lane').first().boundingBox();
      const from = Math.max(0, loop.in - bar), to = loop.out + bar;
      return { x: r.x + ((c0.at + bar / 2 - from) / (to - from)) * r.width, y: r.y + r.height / 2, perBar: (bar / (to - from)) * r.width };
    };
    // A finger on a touch profile (real touch events), the mouse otherwise.
    const cdp = touch ? await page.context().newCDPSession(page) : null;
    const finger = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    const tapAt = (x, y) => (touch ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));
    const doubleTap = async (x, y) => {
      if (!touch) return page.mouse.dblclick(x, y);
      await page.touchscreen.tap(x, y);
      await sleep(80);
      await page.touchscreen.tap(x, y);
    };
    const drag = async (x, y, dx, dy, { hold = 0, steps = 8 } = {}) => {
      if (touch) await finger('touchStart', x, y);
      else { await page.mouse.move(x, y); await page.mouse.down(); }
      if (hold) await sleep(hold);
      for (let i = 1; i <= steps; i++) {
        const px = x + (dx * i) / steps, py = y + (dy * i) / steps;
        if (touch) await finger('touchMove', px, py);
        else await page.mouse.move(px, py);
        await sleep(16);
      }
      if (touch) await finger('touchEnd');
      else await page.mouse.up();
    };
    const sheetOpen = () => page.evaluate(() => !!document.getElementById('clip-sheet')?.open);
    // What has the keys, for a failure's detail: the selection's keys work
    // only from the page, not from a focused key or field.
    const where = () => page.evaluate(() => {
      const a = document.activeElement;
      return { focus: a ? `${a.tagName}#${a.id}` : null, selected: document.getElementById('multi-bar')?.hidden === false };
    });

    let s = await spot();
    await t.step('tap the part', () => tapAt(s.x, s.y));
    t.expect('the clip bar comes up naming track 1, and nothing pops up',
      await t.poll(() => document.getElementById('multi-bar')?.hidden === false
        && /^Track 1 ·/.test(document.getElementById('multi-count')?.textContent ?? ''), null, 3000) && !(await sheetOpen()),
      await page.locator('#multi-count').innerText().catch(() => ''));
    t.expect('a tap moves nothing on the Pi', (await clip()).at === c0.at);

    // A tap in the Studio focuses its view root (lib/shell/view.js gives it
    // tabindex="-1"); page.js's selection keys once skipped every target
    // inside a [tabindex], so Enter and ← → did nothing (fixed 2026-10-19).
    const keysAt = await where();
    await t.step('press Enter', () => page.keyboard.press('Enter'));
    t.expect('Enter opens its sheet', await t.poll(() => !!document.getElementById('clip-sheet')?.open, null, 2000), keysAt);
    // Escape (the tablet's Back, in Chromium) closes the top of what is
    // open: the sheet, not the selection under it, and never the room.
    const kept = () => page.evaluate(() => ({ path: location.pathname, sheet: !!document.getElementById('clip-sheet')?.open, selected: document.getElementById('multi-bar')?.hidden === false }));
    await t.step('press Escape', () => page.keyboard.press('Escape'));
    await t.poll(() => !document.getElementById('clip-sheet')?.open, null, 2000);
    const shut = await kept();
    t.expect('Escape closes the sheet, the part stays selected, and the Studio stays', !shut.sheet && shut.selected && shut.path === '/tape.html', shut);
    await t.wait(300);
    await t.step('press →', () => page.keyboard.press('ArrowRight'));
    const moved = await api.until(async () => Math.abs((await clip()).at - (c0.at + bar)) <= 1, 'the part a bar later', 3000).catch(() => false);
    t.expect('→ moves it a bar, on the Pi', moved, { at: `${c0.at} → ${(await clip()).at}`, ...(await where()) });
    // ↶ with nothing moved would take the drop back instead.
    if (moved) {
      await t.step('tap ↶', () => t.tap(page.locator('#tape-undo')));
      t.expect('↶ puts it back', await api.until(async () => (await clip())?.at === c0.at, 'the part back', 4000).catch(() => false));
    }
    await t.step('press Escape', () => page.keyboard.press('Escape'));
    t.expect('Escape lets go of it', await t.poll(() => document.getElementById('multi-bar')?.hidden !== false, null, 2000));

    s = await spot();
    await t.step(touch ? 'double-tap the part' : 'double-click the part', () => doubleTap(s.x, s.y));
    t.expect(`a ${touch ? 'double tap' : 'double-click'} opens its sheet`, await t.poll(() => !!document.getElementById('clip-sheet')?.open, null, 2000));
    t.expect('and moves nothing on the Pi', (await clip()).at === c0.at);
    await t.step('press Escape', () => page.keyboard.press('Escape'));
    await t.poll(() => !document.getElementById('clip-sheet')?.open, null, 2000);
    const first = await kept();
    t.expect('the first Escape closes its sheet and keeps the part selected', !first.sheet && first.selected && first.path === '/tape.html', first);
    await t.wait(300);
    await t.step('press Escape again', () => page.keyboard.press('Escape'));
    await t.poll(() => document.getElementById('multi-bar')?.hidden !== false, null, 2000);
    const second = await kept();
    t.expect('the second lets go of it, still in the Studio', !second.selected && second.path === '/tape.html', second);
    await t.wait(300);

    // A track's inspector left open, then the part tapped: the selection is
    // the newer, but a sheet closes before a selection (lib/ui/layers.js
    // RANK), so Escape closes the inspector and keeps the part, then lets go.
    const seen = (p) => p.evaluate(() => ({
      path: location.pathname,
      inspector: !!document.getElementById('track-sheet')?.open,
      selected: document.getElementById('multi-bar')?.hidden === false,
    }));
    await t.step('open track 2’s inspector', async () => {
      await t.tap(page.locator('.tt-name').nth(1));
      await t.wait(300);
      await t.tap(page.locator('.tt-name').nth(1));
    });
    t.expect('the inspector opens', await t.poll(() => !!document.getElementById('track-sheet')?.open, null, 2000));
    s = await spot();
    await t.step('tap the part', () => tapAt(s.x, s.y));
    await t.poll(() => document.getElementById('multi-bar')?.hidden === false, null, 3000);
    const both = await seen(page);
    t.expect('the part is selected, and the inspector stays open', both.selected && both.inspector, both);
    await t.step('press Escape', () => page.keyboard.press('Escape'));
    await t.poll(() => !document.getElementById('track-sheet')?.open, null, 2000);
    const sheetFirst = await seen(page);
    t.expect('Escape closes the inspector first, and the part stays selected', !sheetFirst.inspector && sheetFirst.selected && sheetFirst.path === '/tape.html', sheetFirst);
    await t.wait(300);
    await t.step('press Escape again', () => page.keyboard.press('Escape'));
    await t.poll(() => document.getElementById('multi-bar')?.hidden !== false, null, 2000);
    const letGo = await seen(page);
    t.expect('the second lets go of the part, still in the Studio', !letGo.selected && letGo.path === '/tape.html', letGo);
    await t.wait(300);

    s = await spot();
    await t.step('swipe across the part', () => drag(s.x, s.y, s.perBar, 0, { steps: 4 }));
    await t.wait(600);
    t.expect('a quick drag pans the lanes (Fit appears)', await page.isVisible('#view-fit'));
    t.expect('and leaves the part where it is, on the Pi', (await clip()).at === c0.at, `${c0.at} → ${(await clip()).at}`);

    await t.step('reload', () => page.reload());
    await page.locator('.tt-lane').first().waitFor({ state: 'visible' });
    await t.wait(800);
    s = await spot();
    await t.step('hold the part, then drag it a bar', () => drag(s.x, s.y, s.perBar, 0, { hold: 450 }));
    const slid = await api.until(async () => Math.abs((await clip()).at - (c0.at + bar)) <= 1, 'the part slid a bar', 4000).catch(() => false);
    t.expect('a hold then a drag slides it a bar, on the Pi', slid, `${c0.at} → ${(await clip()).at}, a bar is ${bar}`);
    t.expect('it stays on track 1', (await clip()).track === 1);
    if (slid) {
      await t.step('tap ↶', () => t.tap(page.locator('#tape-undo')));
      t.expect('↶ puts it back', await api.until(async () => (await clip())?.at === c0.at, 'the part back', 4000).catch(() => false),
        `${(await clip())?.at}`);
    }
    if (cdp) await cdp.detach();
  },
};
