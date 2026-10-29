// C1 The jam on the tablet (Gabe, 2026-10-17): GRAB lands on the cue lane,
// launch it on the next bar, open its drawer with a hold, drag it to a
// track (the-studio-on-one-screen.md, step 5). docs/flows.md#c1

// holdPad holds a pad on the cue lane: a finger held on a touch profile; the
// mouse's button held down otherwise, since a pad's ⇧-click is a launch.
async function holdPad(t, locator) {
  if (t.profile.hasTouch || !t.profile.startsWith('desktop')) return t.hold(locator);
  const b = await locator.boundingBox();
  await t.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await t.page.mouse.down();
  await t.page.waitForTimeout(600);
  await t.page.mouse.up();
}

export default {
  id: 'C1',
  title: 'GRAB onto the cue lane, launch it, open it, drag it to tape',
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
    const lane = await api.until(async () => (await api.tapeState()).cue?.clips?.[0], 'a clip on the cue lane', 8000).catch(() => null);
    t.expect('GRAB lands on the cue lane, looping, with a lane per input and its handles',
      lane?.loop && lane.lanes?.length >= 1 && lane.grab?.before > 0, JSON.stringify(lane));
    if (!lane) return;
    const chip = page.locator(`#cue-row .cue-clip-chip[data-id="${lane.id}"]`);
    t.expect('the lane shows it', await chip.waitFor({ timeout: 5000 }).then(() => true, () => false));
    t.expect('its drawer opens above the bar', await t.poll(() => {
      const d = document.getElementById('buffer');
      return d && !d.hidden && d.parentElement?.id === 'np-dock';
    }, null, 8000));
    t.expect('the pad has nothing small on it to miss: no × or ⟲', await chip.locator('button').count() === 0);

    await t.step('close the drawer', () => t.tap(page.locator('#buffer-close')));
    t.expect('it shuts', await t.poll(() => document.getElementById('buffer')?.hidden, null, 3000));
    await t.step('hold the clip', () => holdPad(t, chip.locator('.cue-clip-name')));
    t.expect('the drawer opens on it', await t.poll((id) => !document.getElementById('buffer')?.hidden
      && document.querySelector(`#cue-row .cue-clip-chip[data-id="${id}"]`)?.getAttribute('aria-expanded') === 'true', lane.id, 5000));
    t.expect('a hold launches nothing', !((await live()).cue?.playing ?? []).includes(lane.id));
    await t.step('Escape closes it', () => page.keyboard.press('Escape'));
    t.expect('it shuts on Escape', await t.poll(() => document.getElementById('buffer')?.hidden, null, 3000));

    await t.step('play the tape', () => api.post(`/api/tapes/transport?${q}`, { action: 'play' }));
    await t.step('tap the clip', () => t.tap(chip.locator('.cue-clip-name')));
    // Waiting for its bar line, the hand on its dial goes round the bar; a
    // tap just before the line may find it playing already.
    t.expect('while it waits, its dial counts to the bar line', await t.poll((id) => {
      const c = document.querySelector(`#cue-row .cue-clip-chip[data-id="${id}"]`);
      if (c?.classList.contains('playing')) return 'already playing';
      const h = c?.querySelector('.cue-dial-hand');
      return c?.classList.contains('queued') && getComputedStyle(h).opacity === '1' && /rotate\((?!0deg)/.test(h.style.transform) && 'turning';
    }, lane.id, 3000));
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
    // The lane and track 2 are brought into sight.
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
