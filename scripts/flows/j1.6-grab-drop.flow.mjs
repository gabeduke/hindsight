// J1.6 Lift a moment: GRAB the last bars of the jam onto the cue lane, its
// drawer open above the bar, then DROP them on the armed track. How many bars is on GRAB's ▾, whose bars
// open under it (lib/ui/menu.js splitKey).
// docs/flows.md#j16
const parts = (s) => (s.tracks ?? []).reduce((n, tr) => n + (tr.clips?.length ?? 0), 0);

export default {
  id: 'J1.6',
  title: 'GRAB the last bars, DROP them on a track',
  async run(t) {
    const { page, api } = t;
    await t.given('a fresh tape', () => api.tape('Grab and drop'));
    await t.given('15s of the jam in the feed', () => api.ringHas(15));
    const before = parts(await api.tapeState());

    await t.given('the Studio is open', () => page.goto(`${t.base}/tape.html`));
    const grab = page.locator('.buffer-grab-key').first();
    await grab.waitFor({ state: 'visible' });
    await t.step('GRAB’s ▾', () => t.tap(page.locator('.buffer-grab-more')));
    // The bars once opened about 370 px left of the finger: the inputs' row
    // makes the panel wide, and the bars sat at its far end.
    const where = await page.evaluate(() => {
      const r = (sel) => document.querySelector(sel).getBoundingClientRect();
      const more = r('.buffer-grab-more'), pop = r('.buffer-grab-pop'), bars = r('.buffer-grab-pop .buffer-bars');
      return { pop: Math.round(pop.right - more.right), bars: Math.round(more.right - bars.right), under: Math.round(pop.top - more.bottom) };
    });
    t.expect('its bars open under the ▾, by the finger, the panel’s right edge on the ▾’s',
      Math.abs(where.pop) <= 2 && where.bars >= 0 && where.bars <= 60 && where.under >= 0 && where.under <= 12, where);
    await t.step('tap 2 bars', () => t.tap(page.locator('.buffer-grab-pop .buffer-bars button[data-n="2"]')));
    t.expect('GRAB says it takes 2 bars, from the armed track’s input', await t.poll(() => {
      const k = document.querySelector('.buffer-grab-key')?.textContent ?? '';
      return /2 bars/i.test(k) && /armed/.test(k);
    }), await grab.innerText());
    await t.step('tap GRAB', () => t.tap(grab));
    t.expect('the panel shuts', await t.poll(() => document.querySelector('.buffer-grab-pop')?.hidden));
    const grabbed = await api.until(async () => (await api.tapeState()).cue?.clips?.[0]?.grab, 'the grab on the cue lane', 8000).catch(() => null);
    t.expect('the Pi grabbed 2 bars onto the cue lane', grabbed?.bars === 2, grabbed);
    t.expect('its drawer opens above the bar', await t.poll(() => {
      const d = document.getElementById('buffer');
      return d && !d.hidden && d.parentElement?.id === 'np-dock';
    }, null, 8000));
    // DROP is pressed seeing where it lands: every track is above the drawer.
    // On a phone the drawer is a sheet over the foot of the page, docked
    // above the mini player: it brings the cue lane and the armed track into
    // sight above it, under the header, and the rest are a scroll away.
    const sheet = await page.evaluate(() => getComputedStyle(document.getElementById('buffer')).position === 'fixed');
    if (!sheet) {
      t.expect('the tracks are above the drawer, none under the bar', await t.poll(() => {
        const top = document.getElementById('buffer').getBoundingClientRect().top;
        const rows = [...document.querySelectorAll('#lanes > .tape-track')];
        return rows.length > 0 && rows.every((r) => { const b = r.getBoundingClientRect(); return b.height > 0 && b.bottom <= top + 1; });
      }, null, 3000));
    } else {
      const armed = (await api.tapeState()).rec_track;
      t.expect('the cue lane and the armed track are in sight above the drawer, under the header', await t.poll((n) => {
        const top = document.getElementById('buffer').getBoundingClientRect().top;
        const head = document.querySelector('.appbar').getBoundingClientRect().bottom;
        return [document.getElementById('cue-row'), document.querySelectorAll('#lanes > .tape-track')[n - 1]]
          .every((r) => { const b = r?.getBoundingClientRect(); return !!b && b.height > 0 && b.top >= head - 1 && b.bottom <= top + 1; });
      }, armed, 3000),
      await page.evaluate(() => ({ drawer: document.getElementById('buffer').getBoundingClientRect().top, rows: [...document.querySelectorAll('#cue-row, #lanes > .tape-track')].map((r) => Math.round(r.getBoundingClientRect().top)) })));
      t.expect('and ▶ is not under it', await page.evaluate(() => document.getElementById('np-play').getBoundingClientRect().top
        >= document.getElementById('buffer').getBoundingClientRect().bottom - 1));
      await t.step('scroll the lanes up, clear of the drawer', async () => {
        await page.mouse.move(200, 120);
        for (let i = 0; i < 8; i++) {
          const clear = await page.evaluate(() => [...document.querySelectorAll('#lanes > .tape-track')].at(-1).getBoundingClientRect().bottom
            <= document.getElementById('buffer').getBoundingClientRect().top - 4);
          if (clear) break;
          await page.mouse.wheel(0, 60);
          await t.wait(200);
        }
      });
      t.expect('the rest are a scroll away: the last track comes up above the drawer', await page.evaluate(() => [...document.querySelectorAll('#lanes > .tape-track')].at(-1).getBoundingClientRect().bottom
        <= document.getElementById('buffer').getBoundingClientRect().top + 1));
    }

    // The key reads "Drop on track N · bars a–b" once the grab is placed.
    const label = () => document.getElementById('buffer-drop')?.textContent.replace(/\s+/g, ' ').trim() ?? '';
    await t.poll(() => /track \d/i.test(document.getElementById('buffer-drop')?.textContent ?? ''));
    const sub = await page.evaluate(label);
    t.expect('DROP says where it lands', /track \d/i.test(sub) && !/no room/i.test(sub), `label: "${sub}"`);

    await t.step('tap DROP', () => t.tap(page.locator('#buffer-drop')));
    const toast = page.locator('#toasts .toast').filter({ hasText: /Dropped/ }).first();
    t.expect('a "Dropped on track N" toast', await toast.waitFor({ timeout: 8000 }).then(() => true, () => false));
    const landed = await api.until(async () => parts(await api.tapeState()) > before, 'a part on the tape', 8000).catch(() => false);
    t.expect('the tape has the part', landed);
  },
};
