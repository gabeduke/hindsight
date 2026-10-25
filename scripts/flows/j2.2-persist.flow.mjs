// J2.1 + J2.2 A tap plays, and the bar keeps playing across rooms, both
// ways, without a page load. docs/flows.md#j22
// ▶ says it plays by its .playing, whatever it draws (❚❚ for a take).
const bar = () => ({
  playing: !!document.getElementById('np-play')?.classList.contains('playing'),
  time: document.getElementById('np-time')?.textContent.trim(),
  source: document.getElementById('np')?.dataset.source,
  path: location.pathname,
  loads: performance.getEntriesByType('navigation').length,
  marker: window.__flowMarker === true,
});
const secs = (s) => {
  const m = /(\d+):(\d+(?:\.\d+)?)/.exec(s ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
};

export default {
  id: 'J2.2',
  title: 'Tap plays; playback carries across rooms',
  async run(t) {
    const { page, api } = t;
    await t.given('a take on the shelf', () => api.keep(20));

    await t.step('open the Listening Room', () => page.goto(`${t.base}/takes.html`));
    await page.evaluate(() => { window.__flowMarker = true; }); // gone if the page reloads
    const cassette = page.locator('#view-room .room-cassette').first();
    await cassette.waitFor({ state: 'visible' });

    await t.step('tap a take', () => t.tap(cassette));
    const playing = await t.poll(() => document.getElementById('np')?.dataset.source === 'take' && document.getElementById('np-play')?.classList.contains('playing'));
    t.expect('the bar plays it', playing, await page.evaluate(bar));
    t.expect('the bar holds a take', (await page.evaluate(bar)).source === 'take', await page.evaluate(bar));
    t.expect('no sheet opened', !(await page.locator('dialog[open]').count()));

    const a = await page.evaluate(bar);
    await t.step('go to the Studio', () => page.locator('.appnav a[data-tab="studio"]').click());
    await page.waitForURL(/tape\.html/);
    await t.wait(1500);
    const b = await page.evaluate(bar);
    t.expect('no page load on the way (pushState)', b.marker, b);
    t.expect('still playing in the Studio', b.playing && b.source === 'take', b);
    t.expect('time moved on', secs(b.time) > secs(a.time), { before: a.time, after: b.time });

    await t.step('back to the Listening Room', () => page.locator('.appnav a[data-tab="room"]').click());
    await page.waitForURL(/takes\.html/);
    await t.wait(1500);
    const c = await page.evaluate(bar);
    t.expect('still playing back in the room', c.playing && c.source === 'take' && c.marker, c);
    t.expect('time kept moving', secs(c.time) > secs(b.time), { before: b.time, after: c.time });
  },
};
