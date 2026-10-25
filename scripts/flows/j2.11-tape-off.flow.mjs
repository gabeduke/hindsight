// J2.11 With the tape off, the Studio's tab is Capture: from the Listening
// Room, Capture's meters move on the first visit, and while I'm in the
// Listening Room, Capture -- mounted out of sight before its first visit
// (lib/shell/router.js prewarm) -- asks the Pi for nothing: no live socket,
// no ribbon. docs/flows.md#j211
//
// The tape is off as a Pi without the tape says so: /api/tapes answers 404
// (lib/nav.js tapeAnswer), and the last answer kept says off.

const LIVE = /\/api\/live/;
const RIBBON = /\/api\/envelope/;

// The meters' fills, as drawn now.
const fills = () => [...document.querySelectorAll('#capture-meters .meter .fill')].map((f) => f.style.width).join(' ');

export default {
  id: 'J2.11',
  title: 'With the tape off, Capture is live on its first visit and quiet while I am away',
  allowHttpErrors: true, // the 404 that says the tape is off
  async run(t) {
    const { page } = t;
    const sockets = [];
    page.on('websocket', (ws) => {
      if (!LIVE.test(ws.url())) return;
      const s = { frames: 0, closed: false };
      sockets.push(s);
      ws.on('framereceived', () => { s.frames++; });
      ws.on('close', () => { s.closed = true; });
    });
    let ribbon = 0;
    page.on('request', (r) => { if (RIBBON.test(r.url())) ribbon++; });
    const open = () => sockets.filter((s) => !s.closed);
    const frames = () => sockets.reduce((n, s) => n + s.frames, 0);

    await t.given('the tape is off', async () => {
      await page.route('**/api/tapes**', (r) => r.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"the tape is off"}' }));
      await page.addInitScript(() => { try { localStorage.setItem('hindsight.tapeOn', 'false'); } catch { /* fine */ } });
    });
    await t.given('the Listening Room is open', () => page.goto(`${t.base}/takes.html`));
    await page.locator('.appnav a[data-tab="studio"]').waitFor({ state: 'visible' });
    // Capture is mounted out of sight once the room is up: its socket opens
    // as it mounts and closes when it is put away.
    await t.given('Capture has been made ready out of sight', async () => {
      const end = Date.now() + 10_000;
      while (!(sockets.length && !open().length) && Date.now() < end) await t.wait(100);
      await t.wait(500);
    });
    t.expect('Capture was made ready, and put away', sockets.length > 0 && open().length === 0, { sockets });

    ribbon = 0;
    await t.wait(3000);
    t.expect('in the Listening Room, Capture asks for nothing: no live socket, no ribbon', open().length === 0 && ribbon === 0, { open: open().length, ribbon });

    await t.step('tap the Studio tab', () => t.tap(page.locator('.appnav a[data-tab="studio"]')));
    await page.waitForURL((u) => u.pathname === '/');
    await t.wait(1500);
    const before = frames();
    const a = await page.evaluate(fills);
    await t.wait(2000);
    const b = await page.evaluate(fills);
    t.expect('Capture is shown, with no page load', await page.evaluate(() => !document.getElementById('view-capture')?.hidden && performance.getEntriesByType('navigation').length === 1));
    t.expect('its live socket is open and the levels come in', open().length === 1 && frames() > before, { open: open().length, frames: frames() - before });
    t.expect('its meters move', !!a && a !== b, { a, b });
    t.expect('its ribbon is drawn from the ring again', ribbon > 0, { ribbon });

    await t.step('back to the Listening Room', () => t.tap(page.locator('.appnav a[data-tab="room"]')));
    await page.waitForURL(/takes\.html/);
    await t.wait(1000);
    ribbon = 0;
    await t.wait(3000);
    t.expect('Capture is quiet again: its socket closed, its ribbon stopped', open().length === 0 && ribbon === 0, { open: open().length, ribbon });
  },
};
