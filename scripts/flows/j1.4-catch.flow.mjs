// J1.4 Catch the last pass: start a tape from a tempo, arm a track, play,
// and CATCH the pass that just went by onto the armed track.
// docs/flows.md#j14
const BPM = 120;
const BARS = 2; // a 4 s pass, so the flow waits two of them, not twenty

export default {
  id: 'J1.4',
  title: 'Set a tempo, play, CATCH the last pass onto the armed track',
  checksMenus: ['#tempo-menu', '#catch-menu'], // the layout checks see them open
  async run(t) {
    const { page, api } = t;
    // An empty tape, with no tempo: the Studio asks for one.
    await t.given('a fresh tape with no tempo', async () => {
      const tape = await api.post('/api/tapes', { name: 'Catch' });
      await api.post(`/api/tapes/load?id=${encodeURIComponent(tape.id)}`);
      await api.del('/api/clipboard').catch(() => {});
    });
    await t.given('10s of the jam in the feed', () => api.ringHas(10));

    await t.given('the Studio is open', () => page.goto(`${t.base}/tape.html`));
    await page.locator('#tape-empty').waitFor({ state: 'visible' });
    await t.step('set the BPM and bars', async () => {
      await page.locator('#new-bpm').fill(String(BPM));
      await page.locator('#new-bars').fill(String(BARS));
      await t.tap(page.locator('#set-tempo'));
    });
    const grid = await api.until(async () => (await api.tapeState()).grid, 'the tape to have a tempo', 8000).catch(() => null);
    // The grid is the loop in frames and bars: 4 beats a bar.
    const bpm = grid ? (grid.bars * 4 * 60 * 48000) / grid.frames : 0;
    t.expect('the tape has that tempo', grid?.bars === BARS && Math.round(bpm) === BPM, JSON.stringify(grid));
    // The tempo is on the bar's display, not in the header (whose tempo pill
    // went: css/chrome.css), and it is the tempo's menu (lib/ui/menu.js): the
    // bar counts the loop could be, beside it; Escape shuts it and stays in
    // the Studio.
    const shown = await t.poll((bpm) => document.getElementById('np-tempo')?.textContent.includes(bpm) && document.getElementById('np-tempo').textContent, String(BPM));
    t.expect('the bar’s display reads the tempo', shown, await page.locator('#np-tempo').innerText());
    t.expect('and the header has no tempo of its own', await page.evaluate(() => !document.querySelector('.appbar #tape-sub, .appbar .tape-sub')));
    await t.step('tap the tempo on the bar’s display', () => t.tap(page.locator('#np-tempo')));
    const tempo = await t.poll(() => {
      const m = document.getElementById('tempo-menu');
      if (!m || m.hidden) return null;
      const b = document.getElementById('np-tempo').getBoundingClientRect();
      const r = m.getBoundingClientRect();
      // Beside its key: its left edge on the key's, over it or under it, on the screen.
      const beside = Math.abs(r.left - b.left) <= 1 && (r.bottom <= b.top + 1 || r.top >= b.bottom - 1);
      return { beside, on: r.top >= 0 && r.bottom <= innerHeight, rows: [...m.querySelectorAll('[role=menuitem]')].map((i) => i.textContent) };
    });
    t.expect('its menu opens beside it with the bar counts, this one among them', !!tempo?.beside && tempo.on && tempo.rows.includes(`${BARS} bars at ${BPM.toFixed(1)} BPM`), tempo);
    await t.step('press Escape', () => page.keyboard.press('Escape'));
    t.expect('Escape shuts it, in the Studio', await t.poll(() => document.getElementById('tempo-menu')?.hidden && location.pathname === '/tape.html'));

    // ● on track 2 arms it alone.
    const arm = page.locator('#lanes .tt-arm').nth(1);
    await t.step('arm track 2', () => t.tap(arm));
    const armed = await api.until(async () => (await api.tapeState()).rec_track === 2, 'track 2 armed', 5000).catch(() => false);
    t.expect('the Pi has track 2 armed', armed);

    await t.step('press ▶', () => t.tap(page.locator('#np-play')));
    const pass = (60 / BPM) * 4 * BARS;
    await t.wait(pass * 2 * 1000 + 500);

    await t.step('tap Catch', () => t.tap(page.locator('#catch-pass')));
    const toast = page.locator('#toasts .toast').filter({ hasText: /Caught/ }).first();
    t.expect('a "Caught the last pass → 2" toast', await toast.waitFor({ timeout: 10_000 }).then(() => true, () => false));
    const toastText = await toast.innerText().catch(() => '');
    t.expect('the toast names track 2', /(→|track)\s*2\b/i.test(toastText), toastText);
    const clips = await api.until(async () => (await api.tapeState()).tracks[1].clips, 'a clip on track 2', 8000).then((c) => c, () => []);
    const len = clips[0] ? clips[0].frames / 48000 : 0;
    t.expect('track 2 holds one pass', clips.length === 1 && Math.abs(len - pass) < 0.1,
      `track 2: ${clips.length} clip(s), ${len.toFixed(2)} s; a pass is ${pass} s`);

    // Catch's ▾ is a key of its own beside it, as GRAB's and KEEP's are (it
    // was a corner of the Catch key, 10 px from the bar's fold): it opens
    // what to catch over the pair, and a pick catches.
    // It goes down under the finger as Catch does, in the first frame: a
    // key's 1 px, and darker, since its orange (Catch's) hides a key's own
    // down face.
    await page.evaluate(() => {
      const key = document.getElementById('catch-more');
      const seen = window.__morePress = { first: null };
      addEventListener('pointerdown', (e) => {
        if (seen.first !== null || !key.contains(e.target)) return;
        requestAnimationFrame(() => {
          const cs = getComputedStyle(key);
          seen.first = { transform: cs.transform, filter: cs.filter };
        });
      }, { capture: true });
    });
    await t.step('tap Catch’s ▾', () => t.tap(page.locator('#catch-more')));
    const pressed = await t.poll(() => window.__morePress?.first, null, 3000);
    t.expect('Catch’s ▾ is down in the first frame after the touch, 1 px and darker',
      /matrix\(1, 0, 0, 1, 0, 1\)/.test(pressed?.transform ?? '') && /brightness\(0\.9\d*\)/.test(pressed?.filter ?? ''), pressed);
    const cm = await t.poll(() => {
      const m = document.getElementById('catch-menu');
      if (!m || m.hidden) return null;
      const key = document.getElementById('catch-pass').getBoundingClientRect();
      const more = document.getElementById('catch-more').getBoundingClientRect();
      const r = m.getBoundingClientRect();
      return {
        apart: more.left >= key.right - 1 && more.width >= 44 && Math.abs(more.height - key.height) <= 1,
        over: Math.abs(r.right - more.right) <= 1 && r.bottom <= key.top && key.top - r.bottom <= 12,
        rows: [...m.querySelectorAll('.menu-word')].map((w) => w.textContent),
      };
    });
    t.expect('Catch’s ▾ is a key of its own beside Catch, a finger wide and as tall', cm?.apart, cm);
    t.expect('its menu opens over the pair: the last pass, the last 1, 2 or 4 bars', cm?.over
      && JSON.stringify(cm.rows) === JSON.stringify(['The last pass', 'The last 1 bar', 'The last 2 bars', 'The last 4 bars']), cm);
    await t.step('tap The last 1 bar', () => t.tap(page.locator('#catch-menu .menu-item', { hasText: 'The last 1 bar' })));
    const bar1 = page.locator('#toasts .toast').filter({ hasText: /Caught last 1 bar/ }).first();
    t.expect('a "Caught last 1 bar → 2" toast', await bar1.waitFor({ timeout: 10_000 }).then(() => true, () => false));
    t.expect('and the menu shuts', await page.locator('#catch-menu').waitFor({ state: 'hidden', timeout: 2000 }).then(() => true, () => false));
    const more = await api.until(async () => (await api.tapeState()).tracks[1].clips.length > 1, 'the bar on track 2', 8000).catch(() => false);
    t.expect('track 2 holds the bar as well', more);

    await t.step('press ▶ again to stop', () => t.tap(page.locator('#np-play')));
  },
};
