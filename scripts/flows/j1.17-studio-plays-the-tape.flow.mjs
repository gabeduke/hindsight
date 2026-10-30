// J1.17 ▶ in the Studio plays the tape: a take played in the Listening Room
// and stopped there doesn't stay in the bar when I come to the Studio, so ▶
// plays the tape, the bar says TAPE, and the playhead moves on the lanes and
// the ruler. On a Mac, ▶ once played that take instead ("BAR -1.4 · SOURCE:
// TAKE"), and the tape, never moving, showed no playhead. A take still
// playing when I change rooms keeps playing (J2.2). docs/flows.md#j117
//
// The playhead is a 2 px line each frame draws over the lanes and the ruler
// (lib/tape/playhead.js paintHead): an init script notes where each one is
// drawn, which is the playhead as the screen shows it.
const bar = () => ({
  source: document.getElementById('np')?.dataset.source,
  playing: !!document.getElementById('np-play')?.classList.contains('playing'),
  path: location.pathname,
});

export default {
  id: 'J1.17',
  title: '▶ in the Studio plays the tape after a take',
  profiles: ['desktop', 'tablet', 'phone'],
  async run(t) {
    const { page, api } = t;
    const tape = await t.given('a fresh tape', () => api.tape('Back to the tape'));
    const take = await t.given('a take on the shelf', () => api.keep(12));
    const live = async () => (await api.get(`/api/tapes/state?id=${encodeURIComponent(tape.id)}`)).live;
    await t.given('the playhead’s lines are noted as they are drawn', () => page.addInitScript(() => {
      window.__heads = [];
      const fill = CanvasRenderingContext2D.prototype.fillRect;
      CanvasRenderingContext2D.prototype.fillRect = function (x, y, w, h) {
        const c = this.canvas;
        if (w === 2 && y === 0 && (c.id === 'tape-ruler' || c.classList?.contains('tt-lane'))) {
          window.__heads.push({ on: c.id || 'lane', x, at: performance.now() });
        }
        return fill.call(this, x, y, w, h);
      };
    }));

    await t.step('open the Listening Room', () => page.goto(`${t.base}/takes.html`));
    // The shelf's spine, or the List's row on a phone.
    const spine = page.locator(`.room-cassette[data-key="take:${take.name}"]:visible, #takes .take.spine[data-name="${take.name}"]:visible`).first();
    await spine.waitFor({ state: 'visible' });
    await t.step('tap the take', () => t.tap(spine));
    t.expect('the bar plays the take', await t.poll(() => document.getElementById('np')?.dataset.source === 'take'
      && document.getElementById('np-play')?.classList.contains('playing'), null, 8000), await page.evaluate(bar));
    await t.wait(800);
    await t.step('tap ▶ to stop it', () => t.tap(page.locator('#np-play')));
    t.expect('the take stops, still in the bar', await t.poll(() => document.getElementById('np')?.dataset.source === 'take'
      && !document.getElementById('np-play')?.classList.contains('playing')), await page.evaluate(bar));

    await t.step('go to the Studio', () => t.tap(page.locator('.appnav a[data-tab="studio"]')));
    t.expect('the bar holds the tape in the Studio, now nothing plays',
      await t.poll(() => location.pathname === '/tape.html' && document.getElementById('np')?.dataset.source === 'tape', null, 5000), await page.evaluate(bar));
    await page.locator('.tt-lane').first().waitFor({ state: 'visible' });
    await t.wait(600);

    await page.evaluate(() => { window.__heads.length = 0; });
    await t.step('tap ▶', () => t.tap(page.locator('#np-play')));
    const playing = await api.until(async () => (await live())?.playing, 'the tape to play', 8000).catch(() => false);
    t.expect('the Pi plays the tape', playing, await live());
    t.expect('the bar says TAPE, playing', await t.poll(() => document.getElementById('np')?.dataset.source === 'tape'
      && document.getElementById('np-play')?.classList.contains('playing')), await page.evaluate(bar));
    await t.wait(1500);
    const heads = await page.evaluate(() => {
      const by = (on) => window.__heads.filter((h) => h.on === on).map((h) => h.x);
      const lane = by('lane'), ruler = by('tape-ruler');
      return { lane: lane.length, laneFrom: lane[0], laneTo: lane.at(-1), ruler: ruler.length, rulerFrom: ruler[0], rulerTo: ruler.at(-1) };
    });
    t.expect('the playhead moves on the lanes', heads.lane > 10 && heads.laneTo > heads.laneFrom, heads);
    t.expect('it moves on the ruler too', heads.ruler > 10 && heads.rulerTo > heads.rulerFrom, heads);

    await t.step('tap ▶ to stop the tape', () => t.tap(page.locator('#np-play')));
    t.expect('the Pi stops', await api.until(async () => !(await live())?.playing, 'the tape to stop', 5000).catch(() => false));
  },
};
