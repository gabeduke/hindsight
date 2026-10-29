// J4.1 Record from this phone, from its mini player: away from the Studio
// the mini player's big red ● is this phone's, and a tap records at once
// (a fake microphone here, allowed without asking: flows.mjs launches
// Chromium so); ● is pressed and says the time while it records, a second
// tap stops it, and the take is on the shelf, labelled Phone. Its ▾ says
// what ● does now, lists the inputs and opens the recorder with its meter.
// In the Studio ● is the tape's: a hold on it offers this phone, on the
// same ▾.
// docs/flows.md#j41
const keys = () => {
  const on = (s) => { const b = document.querySelector(s)?.getBoundingClientRect(); return !!b && b.width > 0 && b.top >= 0 && b.bottom <= innerHeight; };
  const rec = document.getElementById('np-phone-rec');
  return {
    rec: on('#np-phone-rec'), more: on('#np-phone-more'), tapeRec: on('#rec'),
    pressed: rec?.getAttribute('aria-pressed'), said: rec?.getAttribute('aria-label'),
    red: rec ? getComputedStyle(rec).color : '',
  };
};

export default {
  id: 'J4.1',
  title: 'Record from this phone, from its mini player',
  profiles: ['phone'],
  checksMenus: ['#np-phone-menu'],
  async run(t) {
    const { page, api } = t;
    await t.given('a fresh tape', () => api.tape('Phone take'));
    const before = new Set((await api.takes()).map((x) => x.name));

    await t.step('open the Listening Room', () => page.goto(`${t.base}/takes.html`));
    await page.locator('#np-phone-rec').waitFor({ state: 'visible' });
    const mini = await page.evaluate(keys);
    t.expect('the mini player has a big red ●, this phone’s, with its ▾', mini.rec && mini.more && !mini.tapeRec && mini.said === 'Record from this phone', mini);

    // Its ▾: what ● does, the inputs, the meter.
    await t.step('tap ▾ beside ●', () => t.tap(page.locator('#np-phone-more')));
    const menu = await t.poll(() => {
      const m = document.getElementById('np-phone-menu');
      if (!m || m.dataset.state !== 'open') return null;
      const r = m.getBoundingClientRect();
      return {
        rows: [...m.querySelectorAll('.menu-item')].map((b) => b.querySelector('.menu-word').textContent),
        on: r.top >= 0 && r.bottom <= document.getElementById('np').getBoundingClientRect().top + 1,
      };
    });
    t.expect('its menu, over the mini player: Record from this phone, the inputs, the level', !!menu && menu.on
      && menu.rows[0] === 'Record from this phone' && menu.rows.at(-1) === 'The level and input…' && menu.rows.length >= 3, menu);
    await t.step('Back, to shut it', () => page.keyboard.press('Escape'));
    await t.poll(() => document.getElementById('np-phone-menu').hidden);

    await t.step('tap ●', () => t.tap(page.locator('#np-phone-rec')));
    const recording = await t.poll(() => document.getElementById('np-phone-rec').getAttribute('aria-pressed') === 'true', null, 8000);
    t.expect('it records at once: ● pressed, the sheet still down', recording && !(await page.evaluate(() => document.getElementById('phone-sheet').open)), await page.evaluate(keys));
    await t.wait(3000);
    const timed = await page.evaluate(keys);
    t.expect('● says it is recording, and for how long', /^Stop recording from this phone, 0:0[2-9]/.test(timed.said ?? ''), timed);

    await t.step('tap ● again', () => t.tap(page.locator('#np-phone-rec')));
    const take = await api.until(async () => (await api.takes()).find((x) => !before.has(x.name)), 'the phone’s take on the shelf', 15_000).catch(() => null);
    t.expect('the take is on the shelf, labelled Phone', !!take && /Phone/.test(JSON.stringify(take)), take);
    const stopped = await t.poll(() => document.getElementById('np-phone-rec').getAttribute('aria-pressed') === 'false');
    t.expect('● is up again', stopped, await page.evaluate(keys));

    // In the Studio ● is the tape's: a hold offers this phone, on the ▾.
    await t.step('go to the Studio', () => t.tap(page.locator('.appnav a[data-tab="studio"]')));
    await page.locator('#rec').waitFor({ state: 'visible' });
    const studio = await page.evaluate(keys);
    t.expect('in the Studio ● is the tape’s, with the phone’s ▾ beside it', studio.tapeRec && studio.more && !studio.rec, studio);
    await t.step('hold ●', () => t.hold(page.locator('#rec')));
    const offered = await t.poll(() => {
      const m = document.getElementById('np-phone-menu');
      return m?.dataset.state === 'open' && m.querySelector('.menu-word')?.textContent;
    });
    t.expect('a hold on it offers Record from this phone', offered === 'Record from this phone', offered);
    await t.step('Back', () => page.keyboard.press('Escape'));
  },
};
