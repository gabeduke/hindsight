// J3.3 Share the mix from a phone: with the tape playing on the phone (as
// with the interface off), ⋯ → Share the mix renders the whole tape as an
// MP3 on the Pi, and the toast's Share hands it to the share sheet. Bounce,
// which needs the jam room, says so and offers Share the mix.
// docs/flows.md#j33
const clipCount = (tape) => tape.tracks.reduce((n, tr) => n + tr.clips.length, 0);

export default {
  id: 'J3.3',
  title: 'Share the mix from a phone',
  profiles: ['phone'],
  checksMenus: ['#tape-actions'], // the layout checks see ⋯ open, on a phone
  async run(t) {
    const { page, api } = t;
    const tape = await t.given('a fresh tape', () => api.tape('For my brother'));
    const take = await t.given('a take on the shelf', () => api.keep(20));
    const st = await api.tapeState();
    const q = `id=${encodeURIComponent(tape.id)}`;
    const bar = st.grid.frames / st.grid.bars;
    const to = Math.min(Math.round(4 * bar), Math.floor(take.duration_seconds * take.sample_rate));
    await t.given('the take\'s first 4 bars on track 1', () => api.post(`/api/tapes/drop?${q}`, { take: take.name, from: 0, to, track: 1, at: st.loop.in }));
    // The share sheet, as a phone has one: what it is handed is kept to look at.
    await t.given('a phone\'s share sheet', () => page.addInitScript(() => {
      window.__shared = [];
      navigator.canShare = (d) => !!d && Array.isArray(d.files);
      navigator.share = async (d) => {
        const f = d.files[0];
        const head = [...new Uint8Array(await f.slice(0, 4).arrayBuffer())];
        window.__shared.push({ name: f.name, type: f.type, size: f.size, head, title: d.title });
      };
    }));
    const shelf = (await api.takes()).length;
    await t.given('the tape plays on this phone', () => api.put('/api/tapes/output', { mode: 'phone' }));
    const live = async () => (await api.get(`/api/tapes/state?${q}`)).live;
    try {
      await t.step('open the Studio', () => page.goto(`${t.base}/tape.html`));
      await page.locator('#np-expand').waitFor({ state: 'visible' });
      await t.wait(800);
      await t.step('tap ▶', () => t.tap(page.locator('#np-play')));
      const playing = await api.until(async () => (await live())?.playing, 'the tape to play', 8000).catch(() => false);
      t.expect('the tape plays, on this phone', playing && (await live())?.output_mode === 'phone', await live());

      // Bounce can't run here, and says what can.
      await t.step('tap ⋯', () => t.tap(page.locator('#tape-more')));
      await t.step('tap Bounce the whole tape', () => t.tap(page.locator('#tape-mixdown-all')));
      const refused = await t.poll(() => {
        const d = document.getElementById('jam-only');
        return d?.open && /Bounce/.test(document.getElementById('jam-only-title')?.textContent ?? '') && !document.getElementById('jam-only-share')?.hidden;
      });
      t.expect('Bounce says it needs the jam room, and offers Share the mix', refused,
        await page.evaluate(() => document.getElementById('jam-only')?.innerText));
      await t.step('Share the mix', () => t.tap(page.locator('#jam-only-share')));
      const ready = await t.poll(() => [...document.querySelectorAll('#toasts .toast-action')].some((b) => b.textContent.trim() === 'Share'), null, 30_000);
      t.expect('a toast says the mix is ready, with Share', ready, await page.locator('#toasts').innerText());
      await t.step('tap Share', () => t.tap(page.locator('#toasts .toast-action', { hasText: 'Share' }).last()));
      const shared = await t.poll(() => window.__shared.length > 0 && window.__shared[0], null, 5000);
      const day = new Date().toLocaleDateString('en-CA'); // the Pi's day, as YYYY-MM-DD
      const mp3 = !!shared && shared.type === 'audio/mpeg' && shared.size > 1024
        && ((shared.head[0] === 0x49 && shared.head[1] === 0x44 && shared.head[2] === 0x33) || (shared.head[0] === 0xff && (shared.head[1] & 0xe0) === 0xe0));
      t.expect('the share sheet gets an MP3', mp3, shared);
      t.expect('named after the tape and the day', !!shared && shared.name === `For my brother ${day}.mp3`, shared?.name);

      // From the menu, with nothing in the way.
      await t.step('tap ⋯ again', () => t.tap(page.locator('#tape-more')));
      await t.step('tap Share the mix', () => t.tap(page.locator('#tape-share-mix')));
      const again = await t.poll(() => [...document.querySelectorAll('#toasts .toast-action')].some((b) => b.textContent.trim() === 'Share' && !b.disabled), null, 30_000);
      t.expect('⋯ → Share the mix renders it again', again, await page.locator('#toasts').innerText());
      await t.step('tap Share', () => t.tap(page.locator('#toasts .toast-action:not([disabled])', { hasText: 'Share' }).last()));
      t.expect('the share sheet gets it again', await t.poll(() => window.__shared.length === 2), await page.evaluate(() => window.__shared));

      const after = await live();
      t.expect('the tape is still playing on this phone', after?.playing && after?.output_mode === 'phone', after);
      t.expect('nothing went on the shelf', (await api.takes()).length === shelf, { before: shelf, after: (await api.takes()).length });
      t.expect('nothing changed on the tape', clipCount(await api.tapeState()) === 1);
    } finally {
      // The flows share one demo: put the tape back in the jam room, stopped.
      await api.post(`/api/tapes/transport?${q}`, { action: 'stop' }).catch(() => {});
      await api.put('/api/tapes/output', { mode: 'jam' }).catch(() => {});
    }
  },
};
