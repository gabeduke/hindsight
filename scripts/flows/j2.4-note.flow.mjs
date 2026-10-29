// J2.4 Jot a note without stopping: ✎ on the bar opens the notes drawer
// at the moment heard, the URL stays, and the take keeps playing; the
// words and Enter put the note there, a line with its number and time, and
// a tap on its time goes there. docs/flows.md#j24
export default {
  id: 'J2.4',
  title: 'Jot a note while a take plays',
  // And on a Pixel Tablet's own 1280×800, where ✎ was cut at the edge.
  profiles: ['tablet', 'desktop', 'pixel'],
  async run(t) {
    const { page, api } = t;
    const take = await t.given('a take on the shelf', () => api.keep(20));
    await t.given('the Listening Room is open', () => page.goto(`${t.base}/takes.html`));
    await t.given('the take is playing', () => t.tap(page.locator('#view-room .room-cassette').first()));
    await t.poll(() => document.getElementById('np')?.dataset.source === 'take' && document.getElementById('np-play')?.classList.contains('playing'));
    // A second or two in, so the moment heard is not the start (✎ says it).
    await t.poll(() => /A note at 0:0[2-9]/.test(document.getElementById('np-note')?.getAttribute('aria-label') || ''), null, 8000);
    const url = page.url();

    await t.step('tap ✎', () => t.tap(page.locator('#np-note')));
    const open = await t.poll(() => {
      const d = document.getElementById('notes-drawer');
      return !!d && !d.hidden && d.getBoundingClientRect().height > 0;
    });
    t.expect('the notes drawer comes up in the room', open);
    t.expect('the URL did not change', page.url() === url, page.url());
    const at = await page.evaluate(() => document.getElementById('notes-at')?.textContent.trim());
    t.expect('it says where the words go: the moment ✎ was pressed, not the start', /at 0:0[1-9]$/.test(at || ''), at);
    t.expect('the words are ready to type in', await page.evaluate(() => document.activeElement?.id === 'notes-words'));

    await t.step('type “the drop”, Enter', async () => {
      await page.keyboard.type('the drop');
      await page.keyboard.press('Enter');
    });
    const row = await t.poll(() => {
      const r = document.querySelector('#notes-list .notes-row');
      return r && { n: r.querySelector('.notes-n').textContent, at: r.querySelector('.notes-time').textContent, words: r.querySelector('.notes-row-words').value };
    });
    t.expect('the note is a line: its number, its time, its words', row && row.n === '1' && row.words === 'the drop' && `at ${row.at}` === at, row);
    const flags = await api.until(async () => (await api.takes()).find((x) => x.name === take.name)?.flags?.filter((f) => f.label === 'the drop'), 'the note to reach the Pi', 5000).catch(() => null);
    t.expect('the Pi has the note, with its words', flags && flags.length === 1, flags);
    t.expect('the take is still playing', await page.evaluate(() => document.getElementById('np')?.dataset.source === 'take' && document.getElementById('np-play')?.classList.contains('playing')));

    await t.step('tap the note’s time', () => t.tap(page.locator('#notes-list .notes-time').first()));
    const back = await t.poll(() => {
      const [m, s] = (document.querySelector('#notes-list .notes-time')?.textContent || '').split(':').map(Number);
      const lcd = document.getElementById('np-time')?.textContent || '';
      const [lm, ls] = (lcd.match(/(\d+):(\d+)/) || []).slice(1).map(Number);
      return Number.isFinite(lm) && Math.abs(lm * 60 + ls - (m * 60 + s)) <= 1;
    }, null, 3000);
    t.expect('the take goes back there, and plays on', back);
  },
};
