// J1.14 The Studio follows a press it didn't make: ▶ and ■ pressed at the
// Pi (through the API, as a controller presses them) and a rename show on
// the page within 100 ms, told by /api/tapes/changes rather than found by
// the next 200 ms poll; and the bar in the Listening Room, after the Studio,
// follows ▶ too. docs/flows.md#j114, docs/plan/pushing-tape-state.md.
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
    // heard(n) resolves when the n-th /api/tapes/changes socket the page
    // opens from now on has carried its first message, the ones before it
    // closed: the page is listening, on the socket that stays. Loading the
    // Studio opens two (the bar's, then the Studio's, which takes the tape
    // from it as the Studio is shown); going to the Listening Room, one
    // (the bar's, back). False if that doesn't happen within 5 s.
    const heard = (n) => new Promise((resolve) => {
      const made = [];
      const done = (ok) => { clearTimeout(quit); page.off('websocket', onWs); resolve(ok); };
      const check = () => {
        if (made.length >= n && made[n - 1].heard && made.slice(0, n - 1).every((m) => m.closed)) done(true);
      };
      const quit = setTimeout(() => done(false), 5000);
      function onWs(ws) {
        if (!ws.url().includes('/api/tapes/changes')) return;
        const m = { heard: false, closed: false };
        made.push(m);
        ws.once('framereceived', () => { m.heard = true; check(); });
        ws.once('close', () => { m.closed = true; check(); });
      }
      page.on('websocket', onWs);
    });
    const studioListens = heard(2);
    await t.given('the Studio is open', () => page.goto(`${t.base}/tape.html`));
    await page.locator('#np-play').waitFor({ state: 'visible' });
    t.expect('the Studio shows the tape', await t.poll((n) => document.getElementById('tape-name-text')?.textContent === n, tape.name));
    t.expect('the Studio is listening to the Pi', await studioListens);

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
    const barListens = heard(1);
    await t.step('go to the Listening Room', () => t.tap(page.locator('.appnav a[data-tab="room"]')));
    t.expect('the Listening Room is shown', await t.poll(() => location.pathname === '/takes.html'));
    t.expect('the bar is listening to the Pi', await barListens);
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
