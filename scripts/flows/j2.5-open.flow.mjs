// J2.5 Open a take from the bar and star it: with a take in the bar, Open ›
// is at the bar's right end, on the screen, a tap away -- no sideways
// scroll to reach it. docs/flows.md#j25
export default {
  id: 'J2.5',
  title: 'Open a take from the bar and star it',
  // And on a Pixel Tablet's own 1280×800, where ✎ was cut at the edge.
  profiles: ['tablet', 'desktop', 'pixel'],
  async run(t) {
    const { page, api } = t;
    const take = await t.given('a take on the shelf', () => api.keep(10));
    const { name } = take;
    await t.given('the Listening Room is open', () => page.goto(`${t.base}/takes.html`));
    await t.given('the take is playing', () => t.tap(page.locator('#view-room .room-cassette').first()));
    await t.poll(() => document.getElementById('np')?.dataset.source === 'take' && document.getElementById('np-play')?.classList.contains('playing'));

    const end = await page.evaluate(() => {
      const r = document.getElementById('np-open').getBoundingClientRect();
      return { left: Math.round(r.left), right: Math.round(r.right), W: innerWidth, scrollW: document.scrollingElement.scrollWidth };
    });
    t.expect('Open › is on the screen, at the bar’s end, and the page has no sideways scroll', end.left >= 0 && end.right <= end.W && end.scrollW <= end.W, end);
    await t.step('tap Open › on the bar', () => t.tap(page.locator('#np-open')));
    await page.waitForURL(/wave\.html\?file=/, { timeout: 10_000 });
    t.expect('the take page opens for that take', page.url().includes(encodeURIComponent(name)) || page.url().includes(name), page.url());
    // Its title fills in once the take loads ("…" until then).
    t.expect('it shows the take\'s name', await t.poll(() => (document.getElementById('take-name')?.textContent ?? '…').trim() !== '…', null, 8000));

    await t.step('star it', () => page.locator('#take-star').click());
    const starred = await api.until(async () => (await api.takes()).find((x) => x.name === name && x.starred), 'the star to reach the Pi', 5000).catch(() => null);
    t.expect('the Pi has the star', starred);
  },
};
