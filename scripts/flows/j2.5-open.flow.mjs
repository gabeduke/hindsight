// J2.5 Open a take from the bar and star it. docs/flows.md#j25
export default {
  id: 'J2.5',
  title: 'Open a take from the bar and star it',
  async run(t) {
    const { page, api } = t;
    const take = await api.keep(10);
    const { name } = take;
    await page.goto(`${t.base}/takes.html`);
    await t.tap(page.locator('#view-room .room-cassette').first());
    await t.poll(() => document.getElementById('np-play')?.textContent.trim() === '❚❚');

    await t.step('tap the take name on the bar', () => page.locator('#np-name').click());
    await page.waitForURL(/wave\.html\?file=/, { timeout: 10_000 });
    t.expect('the take page opens for that take', page.url().includes(encodeURIComponent(name)) || page.url().includes(name), page.url());

    await t.step('star it', () => page.locator('#take-star').click());
    const starred = await api.until(async () => (await api.takes()).find((x) => x.name === name && x.starred), 'the star to reach the Pi', 5000).catch(() => null);
    t.expect('the Pi has the star', starred);
  },
};
