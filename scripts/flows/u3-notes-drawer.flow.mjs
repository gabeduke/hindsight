// U3 The notes drawer, the same in both rooms and on Open: the note written
// in the Listening Room is there when ✎ is pressed in the Studio and on the
// take's page; Back puts the drawer away and leaves the room where it was;
// the Sketchbook is gone. docs/flows.md#u3, listening-back.md.
import { aTake } from './room.mjs';

export default {
  id: 'U3',
  title: 'One notes drawer, in both rooms and on Open',
  profiles: ['tablet', 'desktop', 'phone'],
  async run(t) {
    const { page, api } = t;
    const take = await t.given('a take on the shelf', () => api.keep(20));
    await t.given('the Listening Room is open', () => page.goto(`${t.base}/takes.html`));
    await t.given('the take is playing', () => t.tap(aTake(page)));
    await t.poll(() => document.getElementById('np')?.dataset.source === 'take' && document.getElementById('np-play')?.classList.contains('playing'));
    const up = () => t.poll(() => {
      const d = document.getElementById('notes-drawer');
      return !!d && !d.hidden && d.getBoundingClientRect().height > 0 && document.activeElement?.id === 'notes-words';
    });
    const away = () => t.poll(() => document.getElementById('notes-drawer')?.hidden !== false);
    const rows = () => page.evaluate(() => [...document.querySelectorAll('#notes-list .notes-row-words')].map((w) => w.value));

    await t.step('tap ✎ in the Listening Room', () => t.tap(page.locator('#np-note')));
    t.expect('the drawer comes up', await up());
    t.expect('it has the take’s name, ★ and tag', await page.evaluate(() => ['notes-name', 'notes-star', 'notes-tag'].every((id) => document.getElementById(id))));
    t.expect('no Sketchbook', await page.evaluate(() => !document.getElementById('room-sketchbook')));
    await t.step('write “verse”, Enter', async () => { await page.keyboard.type('verse'); await page.keyboard.press('Enter'); });
    t.expect('the note is in the drawer', await t.poll(() => document.querySelectorAll('#notes-list .notes-row').length === 1));
    await api.until(async () => (await api.takes()).find((x) => x.name === take.name)?.flags?.some((f) => f.label === 'verse'), 'the note to reach the Pi', 5000);
    // Android's Back is a close request, sent as Escape (J4.4).
    await t.step('press Back (Escape)', () => page.keyboard.press('Escape'));
    t.expect('Back puts the drawer away', await away());
    t.expect('and leaves me in the Listening Room', /takes\.html/.test(page.url()), page.url());

    await t.step('go to the Studio', () => t.tap(page.locator('.appnav a[data-tab="studio"]')));
    await page.waitForURL(/tape\.html|\/$/, { timeout: 10_000 });
    await t.poll(() => document.getElementById('np')?.dataset.source === 'take' && !document.getElementById('np-note')?.closest('[hidden]'), null, 8000);
    await t.step('tap ✎ in the Studio', () => t.tap(page.locator('#np-note')));
    t.expect('the same drawer comes up in the Studio', await up());
    t.expect('with the note written in the Listening Room', JSON.stringify(await rows()) === '["verse"]', await rows());
    t.expect('the URL is still the Studio’s', /tape\.html|\/$/.test(page.url()), page.url());
    await t.step('put it away with Done', () => t.tap(page.locator('#notes-done')));
    t.expect('Done puts it away', await away());

    await t.step('open the take’s page', () => page.goto(`${t.base}/wave.html?file=${encodeURIComponent(take.name)}`));
    await t.poll(() => !!document.getElementById('room-open-note'), null, 10_000);
    await t.step('tap ✎ Note', () => t.tap(page.locator('.room-open-note-btn')));
    t.expect('the drawer comes up on Open', await up());
    t.expect('with the same note', JSON.stringify(await rows()) === '["verse"]', await rows());
    await t.step('write “chorus”, Enter', async () => { await page.keyboard.type('chorus'); await page.keyboard.press('Enter'); });
    t.expect('the second note is in it', await t.poll(() => document.querySelectorAll('#notes-list .notes-row').length === 2));
    const both = await api.until(async () => {
      const f = (await api.takes()).find((x) => x.name === take.name)?.flags || [];
      return f.some((x) => x.label === 'chorus') && f;
    }, 'the second note to reach the Pi', 5000).catch(() => null);
    t.expect('the Pi has both', both && both.length === 2, both);
  },
};
