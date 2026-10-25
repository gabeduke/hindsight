// J2.1 + J2.2 A tap plays, and the bar keeps playing across rooms, both
// ways, without a page load. The switch turns the camera from one wall of
// the room to the other (the Studio on the left), while the header holds
// still and the bar stays on a layer of its own, never turned with the room;
// a tap on ▶ while it turns lands. docs/flows.md#j22
// ▶ says it plays by its .playing, whatever it draws (❚❚ for a take).
import { watchDesk, desk, rects, same, during } from './desk.mjs';

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

    await watchDesk(page);
    await t.step('open the Listening Room', () => page.goto(`${t.base}/takes.html`));
    await page.evaluate(() => { window.__flowMarker = true; }); // gone if the page reloads
    const cassette = page.locator('#view-room .room-cassette').first();
    await cassette.waitFor({ state: 'visible' });

    await t.step('tap a take', () => t.tap(cassette));
    const playing = await t.poll(() => document.getElementById('np')?.dataset.source === 'take' && document.getElementById('np-play')?.classList.contains('playing'));
    t.expect('the bar plays it', playing, await page.evaluate(bar));
    t.expect('the bar holds a take', (await page.evaluate(bar)).source === 'take', await page.evaluate(bar));
    t.expect('no sheet opened', !(await page.locator('dialog[open]').count()));

    // The desk as the room was: where the header and the bar are.
    const a = await page.evaluate(bar);
    const before = await rects(page);
    await desk(page); // what the watcher saw until now is not this switch's
    await t.step('go to the Studio', () => page.locator('.appnav a[data-tab="studio"]').click());
    await page.waitForURL(/tape\.html/);
    await t.wait(1500);
    const b = await page.evaluate(bar);
    t.expect('no page load on the way (pushState)', b.marker, b);
    t.expect('still playing in the Studio', b.playing && b.source === 'take', b);
    t.expect('time moved on', secs(b.time) > secs(a.time), { before: a.time, after: b.time });

    const seen = await desk(page);
    const after = await rects(page);
    const head = during(seen.samples, 'appbar');
    const np = during(seen.samples, 'np');
    t.expect('the camera turned left, to the Studio’s wall, and the Studio made its entrance',
      head.turned && seen.samples.some((s) => s.turn === 'left' && s.arriving === 'studio'),
      { turns: [...new Set(seen.samples.map((s) => `${s.turn}/${s.arriving}`))], frames: seen.samples.length });
    t.expect('the header held still: the same box before, on every frame of the turn, and after',
      head.frames > 0 && same(before.appbar, after.appbar) && head.laidOut.every((r) => same(r, before.appbar))
        && head.drawn.every((d) => d.flat && d.image === 'none' && same(d.box, before.appbar)),
      { before: before.appbar, after: after.appbar, frames: head.frames, drawn: head.drawn.slice(0, 3) });
    t.expect('the bar stayed on its own layer, never turned with the room',
      np.frames > 0 && np.drawn.every((d) => d.flat && d.image === 'none'),
      { frames: np.frames, drawn: np.drawn.slice(0, 3) });

    await t.step('back to the Listening Room', () => page.locator('.appnav a[data-tab="room"]').click());
    await page.waitForURL(/takes\.html/);
    await t.wait(1500);
    const c = await page.evaluate(bar);
    t.expect('still playing back in the room', c.playing && c.source === 'take' && c.marker, c);
    t.expect('time kept moving', secs(c.time) > secs(b.time), { before: b.time, after: c.time });
    const back = await desk(page);
    t.expect('the camera turned right, back to the shelves',
      back.samples.some((s) => s.turn === 'right' && s.arriving === 'room'),
      [...new Set(back.samples.map((s) => `${s.turn}/${s.arriving}`))]);

    // A tap on the desk while the camera turns: under the turn the page is
    // the Studio already, so ▶ is where it will be.
    await t.step('go to the Studio, and tap ▶ as the camera turns', async () => {
      await page.locator('.appnav a[data-tab="studio"]').click();
      const at = await (await page.waitForFunction(() => {
        if (!document.documentElement.getAttribute('data-turn') || document.getElementById('view-studio')?.hidden) return null;
        const r = document.getElementById('np-play').getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      }, null, { polling: 'raf', timeout: 5000 })).jsonValue();
      if (t.profile === 'desktop') await page.mouse.click(at.x, at.y);
      else await page.touchscreen.tap(at.x, at.y);
    });
    const stopped = await t.poll(() => !document.getElementById('np-play')?.classList.contains('playing'));
    const taps = await desk(page);
    // Chromium gives a press under a View Transition to <html>: the router
    // ends the turn and hands its click to ▶ (lib/shell/router.js).
    t.expect('the tap came while the camera was turning', taps.downs.some((d) => d.turn), taps.downs);
    t.expect('▶ took it: the take stopped, the tap was not lost', stopped, await page.evaluate(bar));
    t.expect('in the Studio, with no page load', await page.evaluate(() => location.pathname === '/tape.html' && window.__flowMarker === true));
  },
};
