// J5.1 / J5.2 The header's one menu, from either room: Settings and
// Releases open and close, help mode explains a control instead of using
// it until Done, the guide and the rig are its links, and Escape or a tap
// elsewhere shuts it. docs/flows.md#j51
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
        .filter((e) => !e.hidden).map((e) => e.querySelector('.app-menu-word')?.textContent));
      t.expect('it holds Settings, the rig, help mode, the guide and Releases',
        JSON.stringify(items) === JSON.stringify(['Settings', 'The rig', 'Help mode', 'The guide', 'Releases']), items);
      t.expect('the rig is its link to the rig', await page.locator('.app-menu-rig').getAttribute('href') === '/rig.html');
      t.expect('the guide is its link to the guide', /^\/guide\.html/.test(await page.locator('#app-menu .appbar-guide-link').getAttribute('href')));
      await page.keyboard.press('Escape');
      t.expect('Escape shuts it', await menuShut());

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
    }
  },
};
