// J1.15 See on the bar what I pressed on the keyboard: PLAY, STOP and a
// refused CATCH pressed on the SMK-37 (a FIFO standing in for its rawmidi
// node, in the demo's MIDI watcher) each show their words over the bar's
// display, marked as the keyboard's, for about a second, and light what they
// changed; a refusal is amber and lights nothing; ▶ never moves. In the
// Studio (its socket hands the press to the bar) and in the Listening Room
// (the bar's own socket). docs/flows.md#j115, docs/architecture.md, *The
// keyboard's press*.

const PLAY = [0x9f, 16, 127, 0x8f, 16, 0]; // PLAY on its panel: note 16, channel 16
const CATCH = [0x99, 50, 100, 0x89, 50, 0]; // CATCH's pad: note 50, channel 10

export default {
  id: 'J1.15',
  title: 'See on the bar what was pressed on the keyboard',
  profiles: ['tablet', 'desktop', 'phone'],
  async run(t) {
    const { page, api } = t;
    const tape = await t.given('a fresh tape', () => api.tape('Keys'));
    // listening resolves when a /api/tapes/changes socket opened from now on
    // has carried its first message: the page hears the Pi.
    const listening = () => new Promise((resolve) => {
      const quit = setTimeout(() => { page.off('websocket', onWs); resolve(false); }, 5000);
      function onWs(ws) {
        if (!ws.url().includes('/api/tapes/changes')) return;
        ws.once('framereceived', () => { clearTimeout(quit); page.off('websocket', onWs); resolve(true); });
      }
      page.on('websocket', onWs);
    });
    const studioListens = listening();
    await t.given('the Studio is open', () => page.goto(`${t.base}/tape.html`));
    await page.locator('#np-play').waitFor({ state: 'visible' });
    t.expect('the Studio shows the tape', await t.poll((n) => document.getElementById('tape-name-text')?.textContent === n, tape.name));
    t.expect('the Studio hears the Pi', await studioListens);
    const kb = await t.given('the keyboard is plugged in', () => api.keyboard());

    try {
      // What the bar shows of a press, read in the page.
      const note = () => {
        const n = document.getElementById('np-press');
        const lcd = n?.closest('.np-lcd')?.getBoundingClientRect();
        const r = n?.getBoundingClientRect();
        return n && !n.hidden ? {
          words: document.getElementById('np-press-words')?.textContent,
          role: n.dataset.kb,
          marked: !!n.querySelector('use[href$="#keyboard"]'),
          over: !!(lcd && r && Math.abs(r.left - lcd.left) < 1 && Math.abs(r.right - lcd.right) < 1 && Math.abs(r.top - lcd.top) < 1),
          playLit: !!document.getElementById('np-play')?.classList.contains('kb-lit'),
        } : null;
      };
      const gone = () => {
        const n = document.getElementById('np-press');
        return !!n && n.hidden && !document.querySelector('.kb-lit');
      };
      // Where ▶ is laid out, without the 1 px a latched key sinks by (its
      // transform) while the tape plays.
      const playAt = () => page.evaluate(() => {
        let x = 0, y = 0;
        for (let e = document.getElementById('np-play'); e; e = e.offsetParent) { x += e.offsetLeft; y += e.offsetTop; }
        return { x, y };
      });
      const press = async (bytes, what) => {
        const before = await playAt();
        const sent = Date.now();
        kb.press(bytes);
        const seen = await t.poll(note, null, 1000);
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

      // The Listening Room: the bar's own socket hears the keyboard.
      const barListens = listening();
      await t.step('go to the Listening Room', () => t.tap(page.locator('.appnav a[data-tab="room"]')));
      t.expect('the Listening Room is shown', await t.poll(() => location.pathname === '/takes.html'));
      t.expect('the bar hears the Pi', await barListens);
      r = await t.step('press PLAY on the keyboard in the Listening Room', () => press(PLAY, 'PLAY in the Listening Room'));
      t.expect('PLAY shows over the bar\'s display there too', r.seen?.words === 'PLAY' && r.seen?.role === 'play' && r.seen?.over, r.seen);
      await lasts(r.sent, 'PLAY in the Listening Room');
      await t.step('press PLAY on the keyboard to stop the tape', () => press(PLAY, 'STOP in the Listening Room'));
      t.expect('the tape stops', await t.poll(() => !document.getElementById('np-play')?.classList.contains('playing'), null, 2000));
    } finally {
      kb.unplug();
    }
  },
};
