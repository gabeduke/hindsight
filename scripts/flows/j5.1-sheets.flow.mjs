// J5.1 / J5.2 The header's one menu, from either room: Settings and
// Releases open and close, help mode explains a control instead of using
// it until Done, the guide and the rig are its links, and Escape or a tap
// elsewhere shuts it and leaves you in the room. Switching rooms shuts it
// too (it once stayed open over the room Back went to). It opens under ☰,
// on the screen (lib/ui/menu.js places it), and from a keyboard ↓ on ☰
// opens it on its first item, ↓ moves along it (and arms no other track in
// the Studio), and Tab shuts it. On a take's page ☰ is the same menu, in
// the same corner.
//
// The frame (css/chrome.css): every page's header is three zones -- what
// you're working on, Studio | Listening Room, the tools -- and on a tablet
// or a computer the switch is at one place on the Studio, the Listening
// Room, Capture and Open (it was top left in the rooms and top centre on
// Open and Capture, so a tap where it usually was landed on the brand).
// On a phone the header is the context, ↶ and ☰, and the rooms are tabs
// along the bottom, each with its own picture: ☰ is only the menu.
// docs/flows.md#j51

// Where the header's zones are, on the page shown: the switch's box, ☰'s,
// what the start zone holds, and the tabs' pictures.
const frame = () => {
  const box = (el) => { const r = el?.getBoundingClientRect(); return r && r.width ? [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)] : null; };
  const shown = (el) => !!el && el.getBoundingClientRect().width > 0 && getComputedStyle(el).visibility !== 'hidden';
  const header = document.querySelector('.appbar');
  const start = document.querySelector('.appbar-start');
  return {
    nav: box(document.querySelector('.appnav')),
    menu: box(document.getElementById('app-menu-btn')),
    header: box(header),
    // ☰ the last key of the tools, at the header's right.
    menuLast: [...document.querySelectorAll('.appbar-end button, .appbar-end a[href]')].filter(shown).at(-1)?.id === 'app-menu-btn',
    start: [...(start?.querySelectorAll('button, a[href], input') ?? [])].filter(shown).map((e) => e.id || e.className.split(' ')[0]),
    tabs: [...document.querySelectorAll('.appnav a')].map((a) => a.querySelector('svg.i use')?.getAttribute('href')?.split('#')[1] ?? null),
    brand: shown(document.querySelector('.brand')),
    W: innerWidth,
  };
};
const PAGES = [
  ['the Studio', '/tape.html', '#tape-name'],
  ['the Listening Room', '/takes.html', '#shelf-q'],
  ['Capture', '/', '#view-capture:not([hidden])'],
];

export default {
  id: 'J5.1',
  title: 'Settings, Releases, help, the guide and the rig from the menu in both rooms',
  profiles: ['tablet', 'desktop', 'phone'],
  checksMenus: ['#app-menu'], // the layout checks see ☰ open
  allowHttpErrors: true, // the demo has no route to GitHub's releases
  async run(t) {
    const { page, api } = t;
    // A phone's List long enough to reach under help mode's tip: eight rows
    // at 844 px did, and its last rows could not be scrolled out from under
    // it (the page kept no room for it).
    const many = t.profile === 'phone' ? await t.given('a dozen takes on the shelf', async () => {
      const one = await api.keep(5);
      return api.copies(one.name, Array.from({ length: 11 }, (_, i) => new Date(Date.now() - (i + 1) * 3_600_000)));
    }) : null;
    const menuOpen = () => t.poll(() => !document.getElementById('app-menu')?.hidden);
    const menuShut = () => t.poll(() => document.getElementById('app-menu')?.hidden);
    const pick = async (name, sel) => {
      await t.step(`☰, then ${name}`, async () => {
        await t.tap(page.locator('#app-menu-btn'));
        await t.tap(page.locator(sel));
      });
    };
    for (const room of ['tape.html', 'takes.html']) {
      await t.given(`${room} is open`, () => page.goto(`${t.base}/${room}`));
      await page.locator('#app-menu-btn').waitFor({ state: 'visible' });

      await t.step('tap ☰', () => t.tap(page.locator('#app-menu-btn')));
      t.expect(`the menu opens in ${room}`, await menuOpen());
      const items = await page.evaluate(() => [...document.querySelectorAll('#app-menu > *')]
        .filter((e) => !e.hidden).map((e) => e.querySelector('.menu-word')?.textContent));
      t.expect('it holds Settings, the rig, help mode, the guide and Releases',
        JSON.stringify(items) === JSON.stringify(['Settings', 'The rig', 'Help mode', 'The guide', 'Releases']), items);
      const where = await page.evaluate(() => {
        const b = document.getElementById('app-menu-btn').getBoundingClientRect();
        const m = document.getElementById('app-menu').getBoundingClientRect();
        return { right: Math.round(b.right - m.right), gap: Math.round(m.top - b.bottom), inside: m.left >= 0 && m.right <= innerWidth && m.bottom <= innerHeight };
      });
      t.expect('it hangs under ☰, its right edge on ☰’s, all of it on the screen',
        Math.abs(where.right) <= 1 && where.gap >= 0 && where.gap <= 12 && where.inside, where);
      t.expect('the rig is its link to the rig', await page.locator('.app-menu-rig').getAttribute('href') === '/rig.html');
      t.expect('the guide is its link to the guide', /^\/guide\.html/.test(await page.locator('#app-menu .appbar-guide-link').getAttribute('href')));
      await t.step('press Escape', () => page.keyboard.press('Escape'));
      t.expect('Escape shuts it', await menuShut());
      t.expect(`and leaves you in ${room}`, await page.evaluate(() => location.pathname) === `/${room}`);

      // From a keyboard: ↓ on ☰ opens it on its first item; Tab leaves it shut.
      await t.step('focus ☰ and press ↓', async () => {
        await page.locator('#app-menu-btn').focus();
        await page.keyboard.press('ArrowDown');
      });
      t.expect('the menu opens with the keyboard on Settings', await menuOpen()
        && await t.poll(() => document.activeElement?.id === 'appbar-settings-btn'));
      // In the Studio ↓ and ↑ also pick the record track: not while a menu
      // has the keyboard (they once did both).
      const armed = async () => (room === 'tape.html' ? JSON.stringify((await t.api.tapeState())?.rec_tracks ?? null) : '');
      const armedBefore = await armed();
      await t.step('press ↓ again', () => page.keyboard.press('ArrowDown'));
      t.expect('the keyboard moves on to the rig', await t.poll(() => document.activeElement?.classList.contains('app-menu-rig')));
      await page.waitForTimeout(600); // an arm would be on its way to the Pi by now
      t.expect('the record track stays as it was', await armed() === armedBefore, { before: armedBefore, after: await armed() });
      await t.step('press Tab', () => page.keyboard.press('Tab'));
      t.expect('Tab shuts it', await menuShut());

      await t.step('tap ☰, then elsewhere', async () => {
        await t.tap(page.locator('#app-menu-btn'));
        await t.tap(page.locator('.appnav a[aria-current="page"]'));
      });
      t.expect('a tap elsewhere shuts it', await menuShut());

      await pick('Settings', '#appbar-settings-btn');
      t.expect(`Settings opens in ${room}`, await t.poll(() => document.getElementById('settings-sheet')?.open));
      t.expect('and the menu shuts behind it', await menuShut());
      await page.keyboard.press('Escape');
      t.expect(`Settings closes in ${room}`, await t.poll(() => !document.getElementById('settings-sheet')?.open));

      await pick('Releases', '#appbar-releases-btn');
      t.expect(`Releases opens in ${room}`, await t.poll(() => document.getElementById('update-sheet')?.open));
      await page.keyboard.press('Escape');
      t.expect(`Releases closes in ${room}`, await t.poll(() => !document.getElementById('update-sheet')?.open));

      // Help mode: a control explains itself and does nothing, until Done.
      await pick('Help mode', '#help');
      t.expect('help mode is on, and its item checked', await t.poll(() => document.body.classList.contains('help-mode')
        && document.getElementById('help').getAttribute('aria-checked') === 'true'));
      if (many && room === 'takes.html') {
        await t.step('scroll to the end of the List', async () => {
          await page.mouse.wheel(0, 4000);
          await t.wait(500);
        });
        const end = await page.evaluate(() => {
          const rows = [...document.querySelectorAll('#takes .take.spine:not(.folded)')].filter((r) => r.getClientRects().length);
          return { rows: rows.length, last: Math.round(rows.at(-1)?.getBoundingClientRect().bottom ?? NaN), tip: Math.round(document.querySelector('.tip-pop').getBoundingClientRect().top) };
        });
        t.expect('its tip floats over the foot of the page, and the List still scrolls its last take clear of it', end.rows >= 12 && end.last <= end.tip, end);
      }
      const before = await page.evaluate(() => location.pathname);
      await t.step('tap the other room’s tab', () => t.tap(page.locator('.appnav a:not([aria-current="page"])')));
      t.expect('it explains the tab and stays in the room', await t.poll(() => !!document.querySelector('.tip-pop:not([hidden]) .tip-pop-done'))
        && await page.evaluate(() => location.pathname) === before);
      await t.step('tap Done', () => t.tap(page.locator('.tip-pop-done')));
      t.expect('Done leaves help mode', await t.poll(() => !document.body.classList.contains('help-mode')));

      // Switching rooms with ☰ open: in Chromium the browser's Back is a
      // move in the history, not a close request (Escape is), so it goes
      // to the room before -- and ☰ must not come along.
      await t.step('tap the other room’s tab', () => t.tap(page.locator('.appnav a:not([aria-current="page"])')));
      const other = await t.poll((r) => location.pathname !== `/${r}` && location.pathname, room);
      await t.step('tap ☰', () => t.tap(page.locator('#app-menu-btn')));
      t.expect(`the menu opens in ${other}`, await menuOpen());
      await t.step('Back, to the room before', () => page.goBack());
      const landed = await t.poll((r) => location.pathname === `/${r}` && location.pathname, room);
      t.expect(`Back switches rooms with ☰ shut: it is not left open over ${room}`, !!landed && await menuShut(),
        await page.evaluate(() => ({ path: location.pathname, menu: !document.getElementById('app-menu')?.hidden })));
      await t.step('Forward, to the other room again', () => page.goForward());
      await t.poll((r) => location.pathname !== `/${r}`, room);
      t.expect('☰ is still shut there', await menuShut());
    }

    // On a take's page, ☰ is the same menu, in the same corner.
    const take = await t.given('a take on the shelf', () => api.keep(5));
    const open = `/wave.html?file=${encodeURIComponent(take.name)}`;
    await t.given('the take’s page is open', () => page.goto(`${t.base}${open}`));
    await page.locator('#app-menu-btn').waitFor({ state: 'visible' });
    await t.step('tap ☰ on the take’s page', () => t.tap(page.locator('#app-menu-btn')));
    t.expect('the menu opens there too, with the same items', await menuOpen() && JSON.stringify(await page.evaluate(() => [...document.querySelectorAll('#app-menu > *')]
      .filter((e) => !e.hidden).map((e) => e.querySelector('.menu-word')?.textContent))) === JSON.stringify(['Settings', 'The rig', 'Help mode', 'The guide', 'Releases']));
    await t.step('press Escape', () => page.keyboard.press('Escape'));
    t.expect('Escape shuts it, on the take’s page', await menuShut() && await page.evaluate(() => location.pathname) === '/wave.html');
    await many?.clear();

    // The frame: the same header on every page.
    const seen = {};
    for (const [name, path, ready] of [...PAGES, ['the take’s page', open, '#take-name']]) {
      if (path === '/') {
        // Capture is the Studio's tab with the tape off: the Pi says so with a 404.
        await page.evaluate(() => { try { localStorage.setItem('hindsight.tapeOn', 'false'); } catch { /* fine */ } });
        await page.route(/\/api\/tapes(\?.*)?$/, (r) => r.fulfill({ status: 404, body: 'no tape' }));
      }
      await t.given(`${name} is open`, () => page.goto(`${t.base}${path}`));
      await page.locator(ready).first().waitFor({ state: 'attached', timeout: 15_000 });
      await t.wait(600);
      seen[name] = await page.evaluate(frame);
      if (path === '/') {
        await page.unroute(/\/api\/tapes(\?.*)?$/);
        await page.evaluate(() => { try { localStorage.setItem('hindsight.tapeOn', 'true'); } catch { /* fine */ } });
      }
    }
    const looks = Object.values(seen);
    t.expect('every page’s tabs have their own pictures, the Studio’s faders and the Listening Room’s spines, never ☰’s',
      looks.every((f) => JSON.stringify(f.tabs) === JSON.stringify(['studio', 'shelf'])), seen);
    t.expect('☰ is the last of the tools, at the header’s right, on every page', looks.every((f) => f.menuLast && f.menu && f.menu[0] + f.menu[2] >= f.W - 20), seen);
    t.expect('each page’s start holds what it is working on: the tape’s name, the search, the feed (Capture), ‹ and the take’s name',
      seen['the Studio'].start.includes('tape-name') && seen['the Listening Room'].start.includes('shelf-q')
      && seen.Capture.start.every((k) => k === 'brand') && seen['the take’s page'].start.includes('take-name'), seen);
    if (t.profile === 'phone') {
      t.expect('on a phone the header is one row, and the rooms are tabs along the bottom', looks.every((f) => f.header[3] <= 60 && f.nav[1] > f.header[3] * 4), seen);
    } else {
      // The switch, at one place on every page of this width: centred.
      const at = JSON.stringify(seen['the Studio'].nav);
      t.expect('the room switch sits at the same place on the Studio, the Listening Room, Capture and Open', looks.every((f) => JSON.stringify(f.nav) === at), seen);
      const mid = seen['the Studio'].nav[0] + seen['the Studio'].nav[2] / 2;
      t.expect('in the middle of the header', Math.abs(mid - seen['the Studio'].W / 2) <= 1, { mid, W: seen['the Studio'].W });
      t.expect(seen['the Studio'].W >= 1280 ? 'the brand shows, from 1280 px' : 'the brand waits for a screen 1280 px wide', looks.every((f) => f.brand === (f.W >= 1280)), seen);
    }
  },
};
