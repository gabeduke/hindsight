// J1.15 See on the bar what I pressed on the keyboard: PLAY, STOP, a refused
// CATCH, GRAB and DROP pressed on the SMK-37 (a FIFO standing in for its
// rawmidi node, in the demo's MIDI watcher) each show their words over the
// bar's display, marked as the keyboard's, for about a second, and light
// what they changed (▶, the dropped-on track's head); a refusal is amber and
// lights nothing; ▶ never moves. In the Studio (its socket hands the press
// to the bar) and in the Listening Room (the bar's own socket), with a take
// in the bar as well: the keyboard plays the tape whatever the bar holds.
// docs/flows.md#j115, docs/architecture/push.md, *The keyboard's press*.

const PLAY = [0x9f, 16, 127, 0x8f, 16, 0]; // PLAY on its panel: note 16, channel 16
const CATCH = [0x99, 50, 100, 0x89, 50, 0]; // CATCH's pad: note 50, channel 10
const GRAB = [0x99, 51, 100, 0x89, 51, 0];
const DROP = [0x99, 52, 100, 0x89, 52, 0];

export default {
  id: 'J1.15',
  title: 'See on the bar what was pressed on the keyboard',
  profiles: ['tablet', 'desktop', 'phone'],
  async run(t) {
    const { page, api } = t;
    const tape = await t.given('a fresh tape', () => api.tape('Keys'));
    // listening resolves when a /api/tapes/changes socket carries a message
    // from now on: the page hears the Pi. The page holds one such socket
    // across rooms (docs/architecture/push.md, *One socket a page*), so it
    // may be the one already open or one opened after the call.
    const socks = [];
    page.on('websocket', (ws) => {
      if (!ws.url().includes('/api/tapes/changes')) return;
      const s = { frames: 0 };
      socks.push(s);
      ws.on('framereceived', () => { s.frames++; });
    });
    const listening = () => {
      const seen = socks.map((s) => s.frames);
      return (async () => {
        for (let i = 0; i < 50; i++) {
          if (socks.some((s, j) => s.frames > (seen[j] ?? 0))) return true;
          await t.wait(100);
        }
        return false;
      })();
    };
    const studioListens = listening();
    await t.given('the Studio is open', () => page.goto(`${t.base}/tape.html`));
    await page.locator('#np-play').waitFor({ state: 'visible' });
    t.expect('the Studio shows the tape', await t.poll((n) => document.getElementById('tape-name-text')?.textContent === n, tape.name));
    t.expect('the Studio hears the Pi', await studioListens);
    const kb = await t.given('the keyboard is plugged in', () => api.keyboard());

    try {
      // What the bar shows of a press, read in the page.
      // A press shows while #np-press has its role; the live region itself
      // is always in the page. "over" is the note covering the display (on
      // a phone, the whole window, the display with it).
      const note = () => {
        const n = document.getElementById('np-press');
        const lcd = n?.closest('.np-lcd')?.getBoundingClientRect();
        const r = n?.getBoundingClientRect();
        return n && n.dataset.kb ? {
          words: document.getElementById('np-press-words')?.textContent,
          role: n.dataset.kb,
          marked: !!n.querySelector('use[href$="#keyboard"]'),
          over: !!(lcd && r && r.left <= lcd.left + 1 && r.right >= lcd.right - 1 && r.top <= lcd.top + 1 && r.bottom >= lcd.bottom - 1)
            && getComputedStyle(n).opacity === '1',
          live: n.getAttribute('role') === 'status' && !n.hidden,
          playLit: !!document.getElementById('np-play')?.classList.contains('kb-lit'),
          headsLit: [...document.querySelectorAll('#lanes .tape-track')].map((row, i) => (row.querySelector('.tt-head.kb-lit') ? i + 1 : 0)).filter(Boolean),
        } : null;
      };
      const gone = () => {
        const n = document.getElementById('np-press');
        return !!n && !n.dataset.kb && !document.getElementById('np-press-words').textContent
          && !n.hidden && !document.querySelector('.kb-lit');
      };
      // Where ▶ is laid out, without the 1 px a latched key sinks by (its
      // transform) while the tape plays.
      const playAt = () => page.evaluate(() => {
        let x = 0, y = 0;
        for (let e = document.getElementById('np-play'); e; e = e.offsetParent) { x += e.offsetLeft; y += e.offsetTop; }
        return { x, y };
      });
      // within: how long the press may take to say something. GRAB waits
      // for the bar after it, and says so when it is done.
      const press = async (bytes, what, within = 1000) => {
        const before = await playAt();
        const sent = Date.now();
        kb.press(bytes);
        const seen = await t.poll(note, null, within);
        const took = Date.now() - sent;
        const during = await playAt();
        t.expect(`${what}: ▶ stays where it was`, before.x === during.x && before.y === during.y, { before, during });
        return { seen, took, sent };
      };
      const lasts = async (sent, what) => {
        const off = await t.poll(gone, null, 2500);
        const after = Date.now() - sent;
        t.expect(`${what}: the note goes after about a second`, off && after >= 700 && after <= 2000, { after });
      };

      let r = await t.step('press PLAY on the keyboard', () => press(PLAY, 'PLAY'));
      t.expect('PLAY shows over the bar\'s display, marked as the keyboard\'s, within half a second',
        r.seen && r.seen.words === 'PLAY' && r.seen.marked && r.seen.over && r.took < 500, r);
      t.expect('PLAY is green, and lights ▶', r.seen?.role === 'play' && r.seen?.playLit, r.seen);
      t.expect('it is a live region a screen reader hears', r.seen?.live, r.seen);
      t.expect('the tape plays', await t.poll(() => !!document.getElementById('np-play')?.classList.contains('playing'), null, 2000));
      await lasts(r.sent, 'PLAY');

      r = await t.step('press PLAY on the keyboard again', () => press(PLAY, 'STOP'));
      t.expect('STOP shows, and lights ▶', r.seen?.words === 'STOP' && r.seen?.role === 'stop' && r.seen?.playLit, r.seen);
      await lasts(r.sent, 'STOP');

      r = await t.step('press CATCH on the keyboard, with no pass played', () => press(CATCH, 'CATCH'));
      t.expect('why it was refused shows, in amber, lighting nothing',
        r.seen?.role === 'refused' && !!r.seen?.words && !r.seen?.playLit
          && await page.evaluate(() => !document.querySelector('.kb-lit')), r.seen);
      t.expect('the refusal is in amber', await page.evaluate(() => {
        const n = document.getElementById('np-press');
        const warn = getComputedStyle(document.documentElement).getPropertyValue('--warn').trim();
        const probe = document.createElement('span');
        probe.style.color = `color-mix(in srgb, ${warn} 88%, ${getComputedStyle(document.documentElement).getPropertyValue('--lcd').trim()})`;
        document.body.append(probe);
        const want = getComputedStyle(probe).color;
        probe.remove();
        return getComputedStyle(n).backgroundColor === want;
      }));
      await lasts(r.sent, 'the refusal');

      // GRAB the last bars of the armed track's input, then DROP them: the
      // drop lights the head of the track it went on (track 1, armed on a
      // fresh tape). Not on a phone: there a full buffer brings its sheet up
      // over the bar and the lanes, which the layout checks flag, and GRAB
      // and DROP's own story (J1.6) is the tablet's and the desktop's.
      if (t.profile !== 'phone') {
        r = await t.step('press GRAB on the keyboard', () => press(GRAB, 'GRAB', 5000));
        t.expect('GRAB says what it grabbed', /^GRABBED /.test(r.seen?.words ?? ''), r.seen);
        await lasts(Date.now() - 300, 'GRAB'); // its second is from when it was done, not the press
        r = await t.step('press DROP on the keyboard', () => press(DROP, 'DROP'));
        t.expect('DROP says where it went, and lights that track\'s head and no other',
          r.seen?.words === 'DROPPED ON T1' && r.seen?.role === 'verb' && r.seen?.headsLit.join() === '1', r.seen);
        await lasts(r.sent, 'DROP');
      }

      // A take on the shelf, kept before the room is opened, for the bar to
      // hold there.
      const take = t.profile === 'phone' ? null : await t.given('a take on the shelf', () => api.keep(5));

      // The Listening Room: the page's socket, the bar's again, hears the keyboard.
      const barListens = listening();
      await t.step('go to the Listening Room', () => t.tap(page.locator('.appnav a[data-tab="room"]')));
      t.expect('the Listening Room is shown', await t.poll(() => location.pathname === '/takes.html'));
      t.expect('the bar hears the Pi', await barListens);
      r = await t.step('press PLAY on the keyboard in the Listening Room', () => press(PLAY, 'PLAY in the Listening Room'));
      t.expect('PLAY shows over the bar\'s display there too', r.seen?.words === 'PLAY' && r.seen?.role === 'play' && r.seen?.over, r.seen);
      await lasts(r.sent, 'PLAY in the Listening Room');
      await t.step('press PLAY on the keyboard to stop the tape', () => press(PLAY, 'STOP in the Listening Room'));
      t.expect('the tape stops', await t.poll(() => !document.getElementById('np-play')?.classList.contains('playing'), null, 2000));

      // With a take in the bar, the keyboard still plays the tape, and says
      // so over the take's display. (Not on a phone, whose room starts on
      // the List, not the shelf: the bar's socket is the same there.)
      if (take) {
        const cassette = page.locator('#view-room .room-cassette').first();
        await cassette.waitFor({ state: 'visible' });
        await lasts(Date.now() - 1000, 'STOP in the Listening Room');
        await t.step('tap a take on the shelf', () => t.tap(cassette));
        t.expect('the bar holds the take', await t.poll(() => document.getElementById('np')?.dataset.source === 'take'));
        r = await t.step('press PLAY on the keyboard, with the take in the bar', () => press(PLAY, 'PLAY over a take'));
        t.expect('PLAY shows over the take\'s display', r.seen?.words === 'PLAY' && r.seen?.role === 'play' && r.seen?.over, r.seen);
        await lasts(r.sent, 'PLAY over a take');
        r = await t.step('press PLAY on the keyboard again, to stop the tape', () => press(PLAY, 'STOP over a take'));
        t.expect('STOP shows over the take\'s display', r.seen?.words === 'STOP', r.seen);
        await lasts(r.sent, 'STOP over a take');
      }
    } finally {
      kb.unplug();
    }
  },
};
