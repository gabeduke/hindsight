// J1.14 The Studio follows a press it didn't make: ▶ and ■ pressed at the
// Pi (through the API, as a controller presses them) and a rename show on
// the page within 100 ms, told by /api/tapes/changes rather than found by
// the next 200 ms poll; and the bar in the Listening Room, after the Studio,
// follows ▶ too, on the page's one changes socket, which the switch
// neither closes nor replaces. docs/flows.md#j114, docs/architecture/push.md.
//
// One sample under the 200 ms poll lands inside 100 ms about half the time,
// so each change is made several times and the slowest is what is checked;
// the pauses between them are jittered, so that they can't fall into step
// with the poll and land just after one every time.

const BUDGET_MS = 100;
const TRIES = 5;

export default {
  id: 'J1.14',
  title: 'The Studio follows a press made at the Pi',
  async run(t) {
    const { page, api } = t;
    const tape = await t.given('a fresh tape', () => api.tape('Follow'));
    const q = `?id=${encodeURIComponent(tape.id)}`;
    const post = (path, body) => fetch(`${t.base}${path}${q}`, {
      method: path === '/api/tapes' ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).then((r) => { if (!r.ok) throw new Error(`${path}: ${r.status}`); });

    // seen times a change from just before the request leaves to the first
    // frame the page shows it in. Both clocks are this machine's.
    const seen = async (make, shows, arg) => {
      await page.evaluate(([src, a]) => {
        const shows = new Function('a', `return (${src})(a)`);
        window.__seen = null;
        const look = () => {
          if (shows(a)) { window.__seen = Date.now(); return; }
          requestAnimationFrame(look);
        };
        look();
      }, [shows.toString(), arg]);
      const sent = Date.now();
      await make();
      const at = await t.poll(() => window.__seen, null, 3000);
      return at ? at - sent : Infinity;
    };
    const playing = () => !!document.getElementById('np-play')?.classList.contains('playing');
    const stopped = () => !document.getElementById('np-play')?.classList.contains('playing');
    const named = (n) => document.getElementById('tape-name-text')?.textContent === n;
    const worst = (xs) => Math.max(...xs);
    const pause = () => t.wait(150 + Math.round(Math.random() * 200));
    // The page's changes sockets (/api/tapes/changes), from before the Studio
    // loads: the page holds one, the transport's, whatever room is shown
    // (docs/architecture/push.md), so a room switch never closes it or
    // opens another (over TLS, a handshake and a deaf gap each time), and
    // none is ever closed while it is still connecting (Chrome says so in
    // the console: "closed before the connection is established").
    const socks = [];
    page.on('websocket', (ws) => {
      if (!ws.url().includes('/api/tapes/changes')) return;
      const s = { frames: 0, closed: false };
      socks.push(s);
      ws.on('framereceived', () => { s.frames++; });
      ws.on('close', () => { s.closed = true; });
    });
    const unborn = [];
    page.on('console', (m) => { if (/closed before the connection is established/.test(m.text())) unborn.push(m.text()); });
    // heard resolves once the page's one socket has carried a frame (false
    // if not within 5 s): the page is listening.
    const heard = async () => {
      for (let i = 0; i < 50; i++) {
        if (socks.some((s) => s.frames > 0 && !s.closed)) return true;
        await t.wait(100);
      }
      return false;
    };
    await t.given('the Studio is open', () => page.goto(`${t.base}/tape.html`));
    await page.locator('#np-play').waitFor({ state: 'visible' });
    t.expect('the Studio shows the tape', await t.poll((n) => document.getElementById('tape-name-text')?.textContent === n, tape.name));
    t.expect('the Studio is listening to the Pi', await heard());
    t.expect('on one socket, none closed while it was connecting', socks.length === 1 && unborn.length === 0, { sockets: socks.length, unborn });

    const plays = [], stops = [], names = [];
    for (let i = 0; i < TRIES; i++) {
      await t.step(`▶ pressed at the Pi (${i + 1} of ${TRIES})`, async () => {
        plays.push(await seen(() => post('/api/tapes/transport', { action: 'play' }), playing));
      });
      await pause();
      await t.step(`■ pressed at the Pi (${i + 1} of ${TRIES})`, async () => {
        stops.push(await seen(() => post('/api/tapes/transport', { action: 'stop' }), stopped));
      });
      await pause();
      const n = `Follow ${i + 1}`;
      await t.step(`the tape renamed at the Pi (${i + 1} of ${TRIES})`, async () => {
        names.push(await seen(() => post('/api/tapes', { name: n }), named, n));
      });
      await pause();
    }
    t.expect(`▶ from the Pi shows within ${BUDGET_MS} ms`, worst(plays) <= BUDGET_MS, plays);
    t.expect(`■ from the Pi shows within ${BUDGET_MS} ms`, worst(stops) <= BUDGET_MS, stops);
    t.expect(`a rename at the Pi shows within ${BUDGET_MS} ms`, worst(names) <= BUDGET_MS, names);

    // The Listening Room, after the Studio: the bar is the bar's again, and
    // follows the Pi as the Studio did.
    await t.step('go to the Listening Room', () => t.tap(page.locator('.appnav a[data-tab="room"]')));
    t.expect('the Listening Room is shown', await t.poll(() => location.pathname === '/takes.html'));
    // Listening: the socket goes on carrying frames (the beat, each second).
    const framesAtSwitch = socks[0]?.frames ?? 0;
    let more = false;
    for (let i = 0; i < 30 && !more; i++) { more = (socks[0]?.frames ?? 0) > framesAtSwitch; if (!more) await t.wait(100); }
    t.expect('the bar is listening to the Pi', more);
    t.expect('on the same socket: the switch closed none and opened none', socks.length === 1 && !socks[0].closed && unborn.length === 0, { sockets: socks.length, closed: socks.map((x) => x.closed), unborn });
    const roomPlays = [];
    for (let i = 0; i < TRIES; i++) {
      await t.step(`▶ pressed at the Pi, in the Listening Room (${i + 1} of ${TRIES})`, async () => {
        roomPlays.push(await seen(() => post('/api/tapes/transport', { action: 'play' }), playing));
      });
      await pause();
      await post('/api/tapes/transport', { action: 'stop' });
      await t.poll(stopped, null, 3000);
      await pause();
    }
    t.expect(`in the Listening Room, the bar shows ▶ from the Pi within ${BUDGET_MS} ms`, worst(roomPlays) <= BUDGET_MS, roomPlays);
  },
};
