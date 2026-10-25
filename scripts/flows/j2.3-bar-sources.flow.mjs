// J2.3 Choose what the bar plays from its display: the source on the LCD
// says what plays (TAPE, FEED or the take's name), and a tap on it opens a
// menu of the tape, the live feed, the last few takes and the shelf. The
// feed brings GRAB to the bar (the feed into the Studio's buffer); the shelf
// is the Listening Room. One bar, three things it can hold, and ▶ in one
// place for all three. docs/flows.md#j23
const bar = () => {
  const np = document.getElementById('np');
  const r = (id) => document.getElementById(id)?.getBoundingClientRect();
  const on = (id) => { const b = r(id); return !!b && b.width > 0 && document.getElementById(id).offsetParent !== null; };
  return {
    source: np?.dataset.source ?? null,
    lcd: document.getElementById('np-source-short')?.textContent.trim() ?? '',
    grab: on('np-feed-grab'),
    open: on('np-open'),
    note: on('np-note'),
    play: Math.round(r('np-play')?.left ?? -1),
    playing: !!document.getElementById('np-play')?.classList.contains('playing'),
    path: location.pathname,
  };
};

export default {
  id: 'J2.3',
  title: 'Choose what the bar plays from its display',
  checksMenus: ['#np-source-menu'], // the layout checks see it open
  async run(t) {
    const { page, api } = t;
    await t.given('a fresh tape', () => api.tape('Sources'));
    const take = await t.given('a take on the shelf', () => api.keep(10));
    await t.given('12s of the jam in the feed', () => api.ringHas(12));
    const now = () => page.evaluate(bar);
    const source = page.locator('#np-source');
    const pick = (id) => page.locator(`#np-source-menu [data-source="${id}"]`);

    await t.step('open the Studio', () => page.goto(`${t.base}/tape.html`));
    await source.waitFor({ state: 'visible' });
    const onTape = await t.poll(() => document.getElementById('np')?.dataset.source === 'tape' && document.getElementById('np-source-short')?.textContent === 'TAPE');
    let b = await now();
    t.expect('the Studio opens on the tape, and the display says TAPE', onTape, b);
    const play = b.play;

    await t.step('tap the source on the display', () => t.tap(source));
    const menu = await t.poll(() => {
      const m = document.getElementById('np-source-menu');
      if (!m || m.hidden) return null;
      const rows = [...m.querySelectorAll('[data-source]')].map((e) => e.dataset.source);
      const checked = m.querySelector('[aria-checked="true"]')?.dataset.source ?? null;
      return { rows, checked };
    });
    t.expect('its menu has the tape (checked), the live feed and the shelf', menu && menu.rows.includes('tape') && menu.rows.includes('feed') && menu.rows.includes('shelf') && menu.checked === 'tape', menu);
    const listed = await t.poll((n) => !!document.querySelector(`#np-source-menu [data-source="take:${n}"]`), take.name, 6000);
    t.expect('and the takes just kept', listed, menu);

    await t.step('choose the live feed', () => t.tap(pick('feed')));
    const onFeed = await t.poll(() => document.getElementById('np')?.dataset.source === 'feed' && document.getElementById('np-source-short')?.textContent === 'FEED');
    b = await now();
    t.expect('the bar holds the feed, and the display says FEED', onFeed, b);
    t.expect('the feed’s GRAB is on the bar', b.grab, b);
    t.expect('▶ has not moved', Math.abs(b.play - play) <= 2, { play, now: b.play });

    await t.step('GRAB from the feed', () => t.tap(page.locator('#np-feed-grab')));
    const grabbed = await api.until(async () => (await api.get('/api/clipboard'))?.clipboard, 'the feed GRAB in the buffer', 8000).catch(() => null);
    t.expect('the feed GRAB lands in the buffer', grabbed?.frames > 0, grabbed);
    await page.waitForURL(/tape\.html/, { timeout: 5000 }).catch(() => {});

    await t.step('tap the source again', () => t.tap(source));
    await pick('shelf').waitFor({ state: 'visible' });
    await t.step('choose Go to the shelf', () => t.tap(pick('shelf')));
    await page.waitForURL(/takes\.html/, { timeout: 5000 }).catch(() => {});
    t.expect('the shelf is the Listening Room', /takes\.html/.test(page.url()), page.url());

    const cassette = page.locator('#view-room .room-cassette').first();
    await cassette.waitFor({ state: 'visible' });
    await t.step('tap a take', () => t.tap(cassette));
    const onTake = await t.poll(() => document.getElementById('np')?.dataset.source === 'take' && document.getElementById('np-play')?.classList.contains('playing'));
    b = await now();
    t.expect('the take plays, and the display names it', onTake && b.lcd.length > 0 && b.lcd !== 'TAPE' && b.lcd !== 'FEED', b);
    t.expect('Open › and ✎ are at the bar’s end', b.open && b.note, b);
    t.expect('▶ has not moved, in this room either', Math.abs(b.play - play) <= 2, { play, now: b.play });

    await t.step('tap the source, and choose the tape', async () => {
      await t.tap(source);
      await pick('tape').waitFor({ state: 'visible' });
      await t.tap(pick('tape'));
    });
    const back = await t.poll(() => document.getElementById('np')?.dataset.source === 'tape' && document.getElementById('np-source-short')?.textContent === 'TAPE');
    b = await now();
    t.expect('the bar holds the tape again', back, b);
    t.expect('the room stays put', b.path === '/takes.html', b);

    // A take from the menu: the last few are there, and one plays at once.
    await t.step('tap the source, and choose the take just kept', async () => {
      await t.tap(source);
      await pick(`take:${take.name}`).waitFor({ state: 'visible' });
      await t.tap(pick(`take:${take.name}`));
    });
    const again = await t.poll((n) => document.getElementById('np')?.dataset.source === 'take'
      && document.getElementById('np-play')?.classList.contains('playing')
      && (document.getElementById('np-open')?.getAttribute('href') ?? '').includes(encodeURIComponent(n)), take.name, 8000);
    b = await now();
    t.expect('it plays in the bar, from the menu', again, b);
  },
};
