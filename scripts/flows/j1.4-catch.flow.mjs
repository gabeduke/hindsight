// J1.4 Catch the last pass: start a tape from a tempo, arm a track, play,
// and CATCH the pass that just went by onto the armed track.
// docs/flows.md#j14
const BPM = 120;
const BARS = 2; // a 4 s pass, so the flow waits two of them, not twenty

export default {
  id: 'J1.4',
  title: 'Set a tempo, play, CATCH the last pass onto the armed track',
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
    const pill = await t.poll((bpm) => document.getElementById('tape-sub')?.textContent.includes(bpm) && document.getElementById('tape-sub').textContent, String(BPM));
    t.expect('the tempo pill reads it', pill, await page.locator('#tape-sub').innerText());

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

    await t.step('press ▶ again to stop', () => t.tap(page.locator('#np-play')));
  },
};
