// J3.2 Bounce: the tape becomes a take on the shelf. docs/flows.md#j32
export default {
  id: 'J3.2',
  title: 'Bounce the tape to a take',
  async run(t) {
    const { page, api } = t;
    await t.given('a fresh tape', () => api.tape('Bounce'));
    await t.given('15s of the jam in the feed', () => api.ringHas(15));
    // Something on the tape to bounce: a grab dropped on track 1.
    await t.given('the Studio is open', () => page.goto(`${t.base}/tape.html`));
    await t.given('a grab dropped on track 1', async () => {
      await t.tap(page.locator('.buffer-grab-key').first());
      await t.poll(() => !document.getElementById('buffer')?.hidden, null, 8000);
      await t.tap(page.locator('#buffer-drop'));
      await page.locator('#toasts .toast').filter({ hasText: /Dropped/ }).first().waitFor({ timeout: 8000 });
    });
    const before = (await api.takes()).length;

    await t.step('open the tape menu', () => t.tap(page.locator('#tape-more')));
    await t.step('Bounce the whole tape', () => t.tap(page.locator('#tape-mixdown-all')));
    const toast = page.locator('#toasts .toast').filter({ hasText: /Bounced/ }).first();
    t.expect('a "Bounced as a take" toast', await toast.waitFor({ timeout: 20_000 }).then(() => true, () => false));
    const take = await api.until(async () => (await api.takes()).length > before, 'the bounce on the shelf', 20_000).catch(() => false);
    t.expect('the bounce is a take on the shelf', take);
  },
};
