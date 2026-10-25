// J5.1 / J5.2 The header's one menu, from either room: Settings and
// Releases open and close, help mode explains a control instead of using
// it until Done, the guide and the rig are its links, and Escape or a tap
// elsewhere shuts it and leaves you in the room. Switching rooms shuts it
// too (it once stayed open over the room Back went to). It opens under ☰,
// on the screen (lib/ui/menu.js places it), and from a keyboard ↓ on ☰
// opens it on its first item and Tab shuts it. docs/flows.md#j51
export default {
  id: 'J5.1',
  title: 'Settings, Releases, help, the guide and the rig from the menu in both rooms',
  profiles: ['tablet', 'desktop', 'phone'],
  allowHttpErrors: true, // the demo has no route to GitHub's releases
  async run(t) {
    const { page } = t;
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
  },
};
