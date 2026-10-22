// J2.4 Jot a note without stopping: ✎ on the bar opens the note in the room,
// the URL stays, and the take keeps playing. docs/flows.md#j24
export default {
  id: 'J2.4',
  title: 'Jot a note while a take plays',
  async run(t) {
    const { page, api } = t;
    await t.given('a take on the shelf', () => api.keep(20));
    await t.given('the Listening Room is open', () => page.goto(`${t.base}/takes.html`));
    await t.given('the take is playing', () => t.tap(page.locator('#view-room .room-cassette').first()));
    await t.poll(() => document.getElementById('np-play')?.textContent.trim() === '❚❚');
    const url = page.url();

    await t.step('tap ✎', () => page.locator('#np-note').click());
    const open = await t.poll(() => !!document.querySelector('#room-sketchbook[open], #room-sketchbook:not([hidden])'));
    t.expect('the sketchbook opens in the room', open);
    t.expect('the URL did not change', page.url() === url, page.url());
    await t.wait(1000);
    t.expect('the take is still playing', (await page.locator('#np-play').innerText()).trim() === '❚❚');
  },
};
