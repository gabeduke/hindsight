// J2.5 Open a take from the bar and star it: with a take in the bar, Open ›
// is at the bar's right end, on the screen, a tap away -- no sideways
// scroll to reach it. Its page's header is the frame's (css/chrome.css):
// ‹ Takes, the take's name, its star; the switch; ↶ and ☰. The name is the
// take's menu -- Rename…, the takes either side by name, the downloads,
// Delete last -- and the ◂ ▸ and ⋯ beside it are gone. Rename… names it
// in place. And a double tap on its spine opens it too, playing on into its
// page (its first tap started it). docs/flows.md#j25
export default {
  id: 'J2.5',
  title: 'Open a take from the bar, star it, rename it from its name',
  checksMenus: ['#take-menu'], // the layout checks see the take's menu open
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

    await t.step('star it', () => t.tap(page.locator('#take-star')));
    const starred = await api.until(async () => (await api.takes()).find((x) => x.name === name && x.starred), 'the star to reach the Pi', 5000).catch(() => null);
    t.expect('the Pi has the star', starred);

    // The other way in: a double tap on the take's spine.
    await t.step('go back to the Listening Room', () => page.goto(`${t.base}/takes.html`));
    const spine = page.locator(`#view-room .room-cassette[data-key="take:${name}"]`);
    await spine.waitFor({ state: 'visible' });
    await t.wait(500);
    await t.step('double tap its spine', async () => {
      if (!t.profile || t.profile === 'desktop') return spine.dblclick();
      const b = await spine.boundingBox();
      const x = b.x + b.width / 2, y = b.y + b.height / 2;
      await page.touchscreen.tap(x, y);
      await page.touchscreen.tap(x, y);
    });
    const opened = await page.waitForURL(/wave\.html\?file=/, { timeout: 10_000 }).then(() => true, () => false);
    t.expect('a double tap opens it on its page', opened && (page.url().includes(encodeURIComponent(name)) || page.url().includes(name)), page.url());
    t.expect('playing on: its first tap started it', await t.poll(() => document.getElementById('play')?.classList.contains('playing'), null, 8000));

    // Its header, on the page the double tap opened.
    const head = await page.evaluate(() => {
      const shown = (el) => !!el && el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== 'hidden';
      return [...document.querySelectorAll('.appbar button, .appbar a[href]')].filter(shown).filter((e) => !e.closest('.appnav, .menu'))
        .map((e) => e.id || e.className.split(' ')[0]).filter((k) => k !== 'brand');
    });
    t.expect('its header: ‹, the take’s name, its star and tag, then ↶ and ☰; no ◂ ▸, ⋯ or 🗑 of their own',
      head[0] === 'back' && head[1] === 'take-name' && head[2] === 'take-star' && head.slice(-2).join() === 'take-undo,app-menu-btn'
      && !head.some((k) => ['take-prev', 'take-next', 'menu-btn', 'take-trash'].includes(k)), head);
    await t.step('tap the take’s name', () => t.tap(page.locator('#take-name')));
    const menu = await t.poll(() => {
      const m = document.getElementById('take-menu');
      if (!m || m.hidden) return null;
      const b = document.getElementById('take-name').getBoundingClientRect();
      const r = m.getBoundingClientRect();
      const rows = [...m.children].filter((e) => e.matches('.menu-item') && e.getBoundingClientRect().height > 0);
      return {
        under: Math.abs(r.left - b.left) <= 1 && r.top >= b.bottom && r.top - b.bottom <= 12,
        on: r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight,
        words: rows.map((e) => e.querySelector('.menu-word').textContent),
        last: rows.at(-1)?.classList.contains('danger'),
        // A take either side says which, by its name.
        named: rows.filter((e) => /^(Previous|Next) take$/.test(e.querySelector('.menu-word').textContent) && !e.disabled)
          .every((e) => (e.querySelector('.menu-sub')?.textContent ?? '').trim() !== ''),
      };
    });
    t.expect('its menu opens under it, on the screen: Rename…, the previous and next take by name, the downloads, Delete last and red',
      menu?.under && menu.on && menu.words[0] === 'Rename…' && menu.words.includes('Previous take') && menu.words.includes('Next take')
      && menu.words.includes('Download WAV') && menu.words.at(-1) === 'Delete this take' && menu.last && menu.named, menu);
    await t.step('tap Rename…', () => t.tap(page.locator('#take-rename')));
    const field = await t.poll(() => document.activeElement?.id === 'take-name-input' && document.getElementById('take-name').hidden);
    t.expect('the name becomes its field, ready to type', field);
    await t.step('type a name and press Enter', async () => {
      await page.keyboard.type('Bridge idea');
      await page.keyboard.press('Enter');
    });
    const renamed = await api.until(async () => (await api.takes()).find((x) => x.name === name && x.label === 'Bridge idea'), 'the name to reach the Pi', 5000).catch(() => null);
    t.expect('the Pi has the name, and the header says it', renamed && await t.poll(() => document.getElementById('take-name-text')?.textContent === 'Bridge idea'));

  },
};
