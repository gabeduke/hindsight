// J1.13 The bar keeps its shape: the tape, the live feed and a take, in the
// Studio and in the Listening Room, each in the one bar, with ▶ where it was
// for all of them and nothing past the screen's edge -- on a tablet on its
// side, a Pixel Tablet's 1280×800 and one held upright at 800. ▶ once stood
// at three places on one tablet, and the bar ran up to 336 px off its right
// edge with a take in it. docs/flows.md#j113
const look = () => {
  const np = document.getElementById('np');
  const play = document.getElementById('np-play').getBoundingClientRect();
  // Every key of the bar that shows, and how far right the last one ends.
  const keys = [...np.querySelectorAll('button, a[href], [role=slider]')]
    .filter((e) => e.offsetParent !== null && e.getBoundingClientRect().width > 0)
    .map((e) => ({ id: e.id || e.className.split(' ')[0], right: Math.round(e.getBoundingClientRect().right) }));
  return {
    source: np.dataset.source, path: location.pathname,
    play: Math.round(play.left),
    W: innerWidth, scrollW: document.scrollingElement.scrollWidth,
    past: keys.filter((k) => k.right > innerWidth).map((k) => `${k.id} ends at ${k.right}`),
  };
};

export default {
  id: 'J1.13',
  title: 'The bar keeps its shape for the tape, the feed and a take, in both rooms',
  profiles: ['upright', 'tablet', 'pixel'],
  async run(t) {
    const { page, api } = t;
    await t.given('a fresh tape', () => api.tape('Shape'));
    await t.given('a take on the shelf', () => api.keep(10));
    await t.given('the feed has something in it', () => api.ringHas(8));
    const seen = [];
    const check = async (where) => {
      await t.wait(400);
      const l = await page.evaluate(look);
      seen.push({ where, ...l });
      t.expect(`${where}: no sideways scroll, and every key on the screen`, l.scrollW <= l.W && !l.past.length, l);
      t.expect(`${where}: ▶ is where it was`, Math.abs(l.play - seen[0].play) <= 2, { first: seen[0].where, at: seen[0].play, now: l.play });
    };
    const source = page.locator('#np-source');
    const choose = async (id) => {
      await t.tap(source);
      const row = page.locator(`#np-source-menu [data-source="${id}"]`);
      await row.waitFor({ state: 'visible' });
      await t.tap(row);
    };
    const holds = (kind) => t.poll((k) => document.getElementById('np')?.dataset.source === k && !document.getElementById('np').hidden, kind, 8000);

    await t.step('open the Studio, the tape in the bar', () => page.goto(`${t.base}/tape.html`));
    await holds('tape');
    await check('the Studio, the tape');

    await t.step('choose the live feed on the display', () => choose('feed'));
    t.expect('the bar holds the feed', await holds('feed'));
    await check('the Studio, the feed');

    await t.step('go to the Listening Room', () => t.tap(page.locator('.appnav a[data-tab="room"]')));
    await page.waitForURL(/takes\.html/);
    await check('the Listening Room, the feed');

    await t.step('choose the tape on the display', () => choose('tape'));
    t.expect('the bar holds the tape', await holds('tape'));
    await check('the Listening Room, the tape');

    const cassette = page.locator('#view-room .room-cassette').first();
    await cassette.waitFor({ state: 'visible' });
    await t.step('tap a take', () => t.tap(cassette));
    t.expect('the bar holds the take', await holds('take'));
    await check('the Listening Room, a take');

    await t.step('go to the Studio, the take still in the bar', () => t.tap(page.locator('.appnav a[data-tab="studio"]')));
    await page.waitForURL(/tape\.html/);
    t.expect('the take stays in the bar', await holds('take'));
    await check('the Studio, a take');
  },
};
