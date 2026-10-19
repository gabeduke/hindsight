// J2.6 Tidy up: select takes, delete them, and get them back with Undo.
// docs/flows.md#j26
export default {
  id: 'J2.6',
  title: 'Select, delete and undo on the shelf',
  async run(t) {
    const { page, api } = t;
    await t.given('a take on the shelf', () => api.keep(5));
    const take = await t.given('another take on the shelf', () => api.keep(5));
    const count = (await api.takes()).length;
    await t.given('the Listening Room is open', () => page.goto(`${t.base}/takes.html`));
    await page.locator('#view-room .room-cassette').first().waitFor();

    // Hold a spine to start selecting (⇧-click with a mouse); the held take
    // is the first one picked.
    await t.step('hold a spine', () => t.hold(page.locator('#view-room .room-cassette').first()));
    t.expect('the select bar comes up', await t.poll(() => !document.getElementById('select-bar')?.hidden));
    await t.step('delete it', () => page.locator('#sel-delete').click());
    const toast = page.locator('#toasts .toast').filter({ hasText: /Deleted/ }).first();
    await toast.waitFor({ timeout: 5000 });
    const fewer = await api.until(async () => (await api.takes()).length === count - 1, 'one take fewer', 5000).catch(() => false);
    t.expect('the Pi has one take fewer', fewer);

    await t.step('Undo', () => toast.getByRole('button', { name: /Undo/ }).click());
    const back = await api.until(async () => (await api.takes()).length === count, 'the take back', 5000).catch(() => false);
    t.expect('Undo brings it back', back, take.name);
  },
};
