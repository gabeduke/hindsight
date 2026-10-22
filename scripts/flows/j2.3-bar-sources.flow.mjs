// J2.3 Switch the bar between Feed, Tape and Shelf: one bar, three things it
// can hold, and the switch says which. docs/flows.md#j23
const bar = () => {
  const sw = document.querySelector('#np .np-source-switch');
  return {
    pressed: sw ? [...sw.querySelectorAll('button[data-source]')].filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.source) : null,
    marquee: document.getElementById('np-marquee')?.textContent.trim() ?? '',
    name: document.getElementById('np-name')?.hidden === false ? document.getElementById('np-name').textContent.trim() : '',
    grab: document.getElementById('np-feed-grab')?.hidden === false,
    play: document.getElementById('np-play')?.textContent.trim(),
    path: location.pathname,
  };
};

export default {
  id: 'J2.3',
  title: 'Switch the bar between Feed, Tape and Shelf',
  async run(t) {
    const { page, api } = t;
    const tape = await t.given('a fresh tape', () => api.tape('Sources'));
    await t.given('a take on the shelf', () => api.keep(10));
    await t.given('12s of the jam in the feed', () => api.ringHas(12));
    const key = (kind) => page.locator(`#np .np-source-switch button[data-source="${kind}"]`);
    const now = () => page.evaluate(bar);

    await t.step('open the Studio', () => page.goto(`${t.base}/tape.html`));
    await key('tape').waitFor({ state: 'visible' });
    const onTape = await t.poll(({ name }) => {
      const m = document.getElementById('np-marquee')?.textContent ?? '';
      return m.toUpperCase().startsWith(name.toUpperCase());
    }, { name: tape.name });
    let b = await now();
    t.expect('the Studio opens on the tape', onTape && b.pressed?.join() === 'tape', b);

    await t.step('tap Feed', () => t.tap(key('feed')));
    const onFeed = await t.poll(() => /^STUDIO FEED/.test(document.getElementById('np-marquee')?.textContent ?? ''));
    b = await now();
    t.expect('Feed: the switch and the bar say the feed', onFeed && b.pressed?.join() === 'feed', b);
    t.expect('Feed: GRAB is offered on the bar', b.grab, b);

    await t.step('GRAB from the feed', () => t.tap(page.locator('#np-feed-grab')));
    const grabbed = await api.until(async () => (await api.get('/api/clipboard'))?.clipboard, 'the feed GRAB in the buffer', 8000).catch(() => null);
    t.expect('the feed GRAB lands in the buffer', grabbed?.frames > 0, grabbed);

    await t.step('tap Shelf with no take in the bar', () => t.tap(key('take')));
    await page.waitForURL(/takes\.html/, { timeout: 5000 }).catch(() => {});
    t.expect('Shelf goes to the Listening Room to pick one', /takes\.html/.test(page.url()), page.url());

    const cassette = page.locator('#view-room .room-cassette').first();
    await cassette.waitFor({ state: 'visible' });
    await t.step('tap a take', () => t.tap(cassette));
    const onTake = await t.poll(() => document.getElementById('np-play')?.textContent.trim() === '❚❚'
      && document.querySelector('#np .np-source-switch button[data-source="take"]')?.getAttribute('aria-pressed') === 'true');
    b = await now();
    t.expect('Shelf: the take plays and the switch says Shelf', onTake, b);
    t.expect('Shelf: the bar names the take', b.name.length > 0, b);

    await t.step('tap Tape', () => t.tap(key('tape')));
    const back = await t.poll(({ name }) => (document.getElementById('np-marquee')?.textContent ?? '').toUpperCase().startsWith(name.toUpperCase())
      && document.querySelector('#np .np-source-switch button[data-source="tape"]')?.getAttribute('aria-pressed') === 'true', { name: tape.name });
    b = await now();
    t.expect('Tape: the bar holds the tape again', back && !b.name, b);
    t.expect('Tape: the room stays put', b.path === '/takes.html', b);

    // Tape lets the take go (engine.js backToTape), so Shelf in the room has
    // nothing to put back: a take is picked from the shelf again.
    await t.step('tap the take again', () => t.tap(cassette));
    const again = await t.poll(() => document.querySelector('#np .np-source-switch button[data-source="take"]')?.getAttribute('aria-pressed') === 'true'
      && document.getElementById('np-name')?.hidden === false);
    b = await now();
    t.expect('a take tapped puts the bar back on Shelf', again && b.path === '/takes.html', b);
  },
};
