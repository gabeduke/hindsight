// J5.1 / J5.2 Settings and Releases open from either room and close again.
// docs/flows.md#j51
export default {
  id: 'J5.1',
  title: 'Settings and Releases open in both rooms',
  profiles: ['tablet', 'desktop'],
  allowHttpErrors: true, // the demo has no route to GitHub's releases
  async run(t) {
    const { page } = t;
    for (const room of ['tape.html', 'takes.html']) {
      await t.given(`${room} is open`, () => page.goto(`${t.base}/${room}`));
      await t.step(`Settings in ${room}`, () => page.locator('#appbar-settings-btn').click());
      t.expect(`Settings opens in ${room}`, await t.poll(() => document.getElementById('settings-sheet')?.open));
      await page.keyboard.press('Escape');
      t.expect(`Settings closes in ${room}`, await t.poll(() => !document.getElementById('settings-sheet')?.open));

      await t.step(`Releases in ${room}`, () => page.locator('#appbar-releases-btn').click());
      t.expect(`Releases opens in ${room}`, await t.poll(() => document.getElementById('update-sheet')?.open));
      await page.keyboard.press('Escape');
      t.expect(`Releases closes in ${room}`, await t.poll(() => !document.getElementById('update-sheet')?.open));
    }
  },
};
