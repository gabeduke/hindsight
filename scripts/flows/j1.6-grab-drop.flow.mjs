// J1.6 Lift a moment: GRAB the last bars of the jam into the buffer, then
// DROP them on the armed track. How many bars is on GRAB's ▾.
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
    await t.step('GRAB’s ▾, then 2 bars', async () => {
      await t.tap(page.locator('.buffer-grab-more'));
      await t.tap(page.locator('.buffer-grab-pop .buffer-bars button[data-n="2"]'));
    });
    t.expect('GRAB says it takes 2 bars, from the armed track’s input', await t.poll(() => {
      const k = document.querySelector('.buffer-grab-key')?.textContent ?? '';
      return /2 bars/i.test(k) && /armed/.test(k);
    }), await grab.innerText());
    await t.step('tap GRAB', () => t.tap(grab));
    t.expect('the panel shuts', await t.poll(() => document.querySelector('.buffer-grab-pop')?.hidden));
    t.expect('the buffer opens with the grab', await t.poll(() => !document.getElementById('buffer')?.hidden, null, 8000));
    // The buffer opens as GRAB goes; the Pi's grab lands a moment later.
    const grabbed = await api.until(async () => (await api.get('/api/clipboard'))?.clipboard?.grab, 'the grab on the Pi', 8000).catch(() => null);
    t.expect('the Pi grabbed 2 bars', grabbed?.bars === 2, grabbed);

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
