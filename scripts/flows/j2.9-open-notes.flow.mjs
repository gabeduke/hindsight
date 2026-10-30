// J2.9 Write notes on a take as it plays, on its page: ✎, the words, its pin
// on the waveform (a tap on the pin is its note), a tap on its time goes
// there, ✕ takes it out, and Undo brings it back. docs/flows.md#j29
export default {
  id: 'J2.9',
  title: 'Write notes on a take’s page as it plays',
  profiles: ['tablet', 'desktop', 'pixel'],
  async run(t) {
    const { page, api } = t;
    const take = await t.given('a take on the shelf', () => api.keep(20));
    await t.given('its page is open', () => page.goto(`${t.base}/wave.html?file=${encodeURIComponent(take.name)}`));
    await t.poll(() => !!document.getElementById('notes-drawer'), null, 10_000);
    t.expect('the notes drawer is docked beside the waveform, its words not taking the keys',
      await page.evaluate(() => {
        const d = document.getElementById('notes-drawer');
        const w = document.getElementById('wave-canvas').getBoundingClientRect();
        const r = d.getBoundingClientRect();
        return d.parentElement?.id === 'notes-dock' && r.height > 0 && r.left >= w.right && document.activeElement?.id !== 'notes-words';
      }));

    await t.step('tap ▶', () => t.tap(page.locator('#play')));
    await t.poll(() => document.getElementById('play')?.classList.contains('playing'));
    await t.poll(() => /^0:0[2-9]/.test(document.getElementById('np-time')?.textContent || ''), null, 8000);
    await t.step('tap ✎', () => t.tap(page.locator('#note-now')));
    t.expect('the words are ready to type in', await t.poll(() => document.activeElement?.id === 'notes-words'));
    const at = await page.evaluate(() => document.getElementById('notes-at')?.textContent.trim());
    t.expect('it says where the words go: where the take was, not the start', /at 0:0[1-9]$/.test(at || ''), at);
    await t.step('type “the turnaround”, Enter', async () => {
      await page.keyboard.type('the turnaround');
      await page.keyboard.press('Enter');
    });
    const row = await t.poll(() => {
      const r = document.querySelector('#notes-list .notes-row');
      return r && { n: r.querySelector('.notes-n').textContent, at: r.querySelector('.notes-time').textContent, words: r.querySelector('.notes-row-words').value };
    });
    t.expect('the note is a line: its number, its time, its words', row && row.n === '1' && row.words === 'the turnaround' && `at ${row.at}` === at, row);
    t.expect('the take is still playing', await page.evaluate(() => document.getElementById('play')?.classList.contains('playing')));
    const note = await api.until(async () => (await api.takes()).find((x) => x.name === take.name)?.flags?.find((f) => f.label === 'the turnaround'), 'the note to reach the Pi', 5000).catch(() => null);
    t.expect('the Pi has the note, with its words', !!note, note);

    await t.step('pause', () => t.tap(page.locator('#play')));
    // Its pin, in the ruler's top, where the note is on the waveform.
    const pin = await page.evaluate((frame) => {
      const c = document.getElementById('wave-canvas').getBoundingClientRect();
      const total = Number(document.getElementById('overview-canvas').getAttribute('aria-valuemax'));
      return { x: c.left + (frame / total) * c.width, y: c.top + 8 };
    }, note?.frame ?? 0);
    await t.step('tap the note’s pin on the waveform', () => (t.profile === 'desktop' ? page.mouse.click(pin.x, pin.y) : page.touchscreen.tap(pin.x, pin.y)));
    t.expect('its pin is its note: the cursor is in its words', await t.poll(() => document.activeElement?.classList.contains('notes-row-words') && document.activeElement.value === 'the turnaround'));

    await t.step('tap the start of the take on the scrubber', () => t.tap(page.locator('#to-start')));
    await t.step('tap the note’s time', () => t.tap(page.locator('#notes-list .notes-time').first()));
    const there = await t.poll(() => {
      const [m, s] = (document.querySelector('#notes-list .notes-time')?.textContent || '').split(':').map(Number);
      const [lm, ls] = ((document.getElementById('np-time')?.textContent || '').match(/(\d+):(\d+)/) || []).slice(1).map(Number);
      return Number.isFinite(lm) && Math.abs(lm * 60 + ls - (m * 60 + s)) <= 1;
    }, null, 3000);
    t.expect('the take goes there', there);

    await t.step('✕ the note', () => t.tap(page.locator('#notes-list .notes-out').first()));
    t.expect('it is out of the list', await t.poll(() => document.querySelectorAll('#notes-list .notes-row').length === 0));
    const undo = page.locator('#toasts button', { hasText: 'Undo' }).first();
    await undo.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
    await t.step('tap Undo on its toast', () => t.tap(undo));
    t.expect('Undo brings it back', await t.poll(() => [...document.querySelectorAll('#notes-list .notes-row-words')].some((w) => w.value === 'the turnaround'), null, 5000));
    const back = await api.until(async () => (await api.takes()).find((x) => x.name === take.name)?.flags?.some((f) => f.label === 'the turnaround'), 'the note back on the Pi', 5000).catch(() => false);
    t.expect('and the Pi has it again', back);
  },
};
