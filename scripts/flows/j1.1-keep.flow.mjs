// J1.1 Keep the last N: the take I already played is saved, and I can take
// it back. docs/flows.md#j11
export default {
  id: 'J1.1',
  title: 'Keep the last N from the Studio',
  async run(t) {
    const { page, api } = t;
    await t.given('8s of the jam in the feed', () => api.ringHas(8));
    const before = (await api.takes()).length;

    await t.step('open the Studio', () => page.goto(`${t.base}/tape.html`));
    await page.locator('#studio-keep').waitFor({ state: 'visible' });
    // The length comes with the first status poll, a moment after the key shows.
    t.expect('KEEP names its length', await t.poll(() => /\d/.test(document.getElementById('studio-keep')?.textContent ?? '')),
      await page.locator('#studio-keep').innerText());

    await t.step('tap KEEP', () => page.locator('#studio-keep').click());
    const toast = page.locator('#toasts .toast').filter({ hasText: /Kept/ }).first();
    await toast.waitFor({ timeout: 10_000 });
    t.expect('a "Kept" toast says so', true);
    const take = await api.until(async () => (await api.takes()).length > before, 'the take to be listed');
    t.expect('the Pi lists one more take', take);

    await t.step('go to the Listening Room', () => page.locator('.appnav a[data-tab="room"]').click());
    await page.waitForURL(/takes\.html/);
    const shelf = await t.poll(() => document.querySelectorAll('#view-room .room-cassette').length);
    t.expect('the shelf shows the take', shelf > 0, `cassettes: ${shelf}`);
  },
};
