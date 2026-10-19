// C1 The jam on the tablet (Gabe, 2026-10-17): GRAB, throw it to the cue
// lane, launch it on the next bar, drag it to a track. docs/flows.md#c1
export default {
  id: 'C1',
  title: 'Throw a grab to the cue lane and launch it',
  async run(t) {
    const { page, api } = t;
    const { id } = await t.given('a fresh tape', () => api.tape('Jam on the cue lane'));
    const q = `id=${encodeURIComponent(id)}`;
    const live = async () => (await api.get(`/api/tapes/state?${q}`)).live ?? {};
    await t.given('15s of the jam in the feed', () => api.ringHas(15));
    await t.given('the Studio is open', () => page.goto(`${t.base}/tape.html`));

    const grab = page.locator('.buffer-grab-key').first();
    await grab.waitFor({ state: 'visible' });
    await t.step('tap GRAB', () => t.tap(grab));
    t.expect('the buffer opens with the grab', await t.poll(() => !document.getElementById('buffer')?.hidden, null, 8000));

    const cue = page.locator('#buffer-cue');
    t.expect('the buffer offers Cue', await t.poll(() => {
      const b = document.getElementById('buffer-cue');
      return b && !b.disabled;
    }, null, 8000));
    await t.step('throw it to the cue lane', () => t.tap(cue));
    const lane = await api.until(async () => (await api.tapeState()).cue?.clips?.[0], 'a clip on the cue lane', 8000).catch(() => null);
    t.expect('the cue lane holds the clip, looping', lane?.loop, JSON.stringify(lane));
    if (!lane) return;
    const chip = page.locator(`#cue-row .cue-clip-chip[data-id="${lane.id}"]`);
    t.expect('the lane shows it', await chip.waitFor({ timeout: 5000 }).then(() => true, () => false));

    await t.step('play the tape', () => api.post(`/api/tapes/transport?${q}`, { action: 'play' }));
    await t.step('tap the clip', () => t.tap(chip.locator('.cue-clip-name')));
    const started = await api.until(async () => ((await live()).cue?.playing ?? []).includes(lane.id) && (await live()).cue,
      'the clip to play', 10_000).catch(() => null);
    t.expect('the Pi plays it', !!started, JSON.stringify(started));
    const g = (await api.tapeState()).grid;
    const bar = g ? g.frames / g.bars : 0;
    const at = started?.starts?.[lane.id];
    const off = bar && at >= 0 ? at % bar : NaN;
    t.expect('it started on a bar line', bar > 0 && (off < 2 || bar - off < 2), `started at ${at}, bar ${bar}`);
    t.expect('the clip is lit', await t.poll((id) => document.querySelector(`#cue-row .cue-clip-chip[data-id="${id}"]`)?.classList.contains('playing'), lane.id, 5000));

    await t.step('tap it again', () => t.tap(chip.locator('.cue-clip-name')));
    const stopped = await api.until(async () => !((await live()).cue?.playing ?? []).includes(lane.id), 'the clip to stop', 10_000).catch(() => false);
    t.expect('it stops on the next bar', stopped);
    await t.step('stop the tape', () => api.post(`/api/tapes/transport?${q}`, { action: 'stop' }));

    // Drag it down onto track 2: a copy on the tape, the lane keeps its clip.
    // The buffer is put away first (on a laptop's height it folds the
    // lanes), and the lane and track 2 are brought into sight.
    if (await page.locator('#buffer-close').isVisible()) {
      await t.step('put the buffer away', () => t.tap(page.locator('#buffer-close')));
      await t.poll(() => document.getElementById('buffer')?.hidden, null, 3000);
    }
    await page.locator('#lanes > .tape-track').nth(1).scrollIntoViewIfNeeded();
    await chip.scrollIntoViewIfNeeded();
    await t.wait(300);
    const from = await chip.locator('.cue-clip-name').boundingBox();
    const to = await page.locator('#lanes > .tape-track').nth(1).locator('.tt-lane').boundingBox();
    t.expect('track 2 is on screen', !!(from && to));
    if (!from || !to) return;
    await t.step('drag it onto track 2', async () => {
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2 + 20, { steps: 4 });
      await page.mouse.move(to.x + to.width / 4, to.y + to.height / 2, { steps: 10 });
      await page.mouse.up();
    });
    const placed = await api.until(async () => (await api.tapeState()).tracks?.[1]?.clips?.length, 'a part on track 2', 8000).catch(() => false);
    t.expect('track 2 has it', placed);
    t.expect('the lane still has its clip', (await api.tapeState()).cue?.clips?.length === 1);
  },
};
