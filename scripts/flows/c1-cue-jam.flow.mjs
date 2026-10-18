// C1 The jam on the tablet (Gabe, 2026-10-17): GRAB, throw it to the cue
// lane, launch it on the next bar, drag it to a track. NOT BUILT: the cue
// lane exists, but nothing in the UI adds to it and nothing plays it.
// docs/flows.md#c1
export default {
  id: 'C1',
  title: 'Throw a grab to the cue lane and launch it',
  status: 'todo',
  async run(t) {
    const { page, api } = t;
    await api.tape('Cue');
    await api.ringHas(15);
    await page.goto(`${t.base}/tape.html`);
    await t.tap(page.locator('.buffer-grab-key').first());
    await t.poll(() => !document.getElementById('buffer')?.hidden, null, 8000);

    const cue = page.getByRole('button', { name: /^cue$/i }).first();
    t.expect('the buffer offers Cue as a place to drop', await cue.count() > 0);
    if (!(await cue.count())) return;
    await t.step('throw it to the cue lane', () => t.tap(cue));
    const staged = await api.until(async () => (await api.tapeState()).cue?.clips?.length, 'a clip on the cue lane', 5000).catch(() => false);
    t.expect('the cue lane holds the clip', staged);
    t.expect('the clip launches on the next bar', false, 'launch is not specified as checkable yet');
  },
};
