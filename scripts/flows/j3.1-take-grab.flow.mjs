// J3.1 Lift bars from an old take: on its page, GRAB 4 BARS takes them into
// the Studio's buffer, and DROP puts them on the armed track.
// docs/flows.md#j31
const parts = (s) => (s.tracks ?? []).reduce((n, tr) => n + (tr.clips?.length ?? 0), 0);

export default {
  id: 'J3.1',
  title: 'GRAB 4 bars from a take’s page, DROP them in the Studio',
  async run(t) {
    const { page, api } = t;
    await api.tape('Take grab'); // a 4-bar loop: the take's GRAB starts at 4 bars
    const take = await api.keep(20);
    const before = parts(await api.tapeState());

    await page.goto(`${t.base}/wave.html?file=${encodeURIComponent(take.name)}`);
    const grab = page.locator('.room-open-grab');
    await grab.waitFor({ state: 'visible' });
    const words = await t.poll(() => /4 bars/i.test(document.querySelector('.room-open-grab')?.textContent ?? '') && document.querySelector('.room-open-grab').textContent);
    t.expect('the key reads GRAB 4 BARS', words, await grab.innerText());

    await t.step('tap GRAB 4 BARS', () => t.tap(grab));
    await page.waitForURL(/tape\.html/, { timeout: 10_000 });
    t.expect('the Studio opens with the buffer', await t.poll(() => !document.getElementById('buffer')?.hidden, null, 8000));
    const clip = await api.until(async () => (await api.get('/api/clipboard')).clipboard, 'the grab in the buffer', 8000).catch(() => null);
    const bars4 = (4 * 4 * 60) / (take.bpm || 96);
    const secs = clip ? clip.frames / 48000 : 0;
    t.expect('the buffer holds 4 bars of the take', Math.abs(secs - bars4) < 0.2,
      `buffer ${secs.toFixed(2)} s, 4 bars at ${take.bpm} BPM = ${bars4.toFixed(2)} s, from "${clip?.from}"`);

    await t.poll(() => /track \d/i.test(document.getElementById('buffer-drop')?.textContent ?? ''));
    const sub = await page.locator('#buffer-drop').innerText();
    t.expect('DROP says where it lands', /track \d/i.test(sub), `label: "${sub}"`);
    await t.step('tap DROP', () => t.tap(page.locator('#buffer-drop')));
    const landed = await api.until(async () => parts(await api.tapeState()) > before, 'a part on the tape', 8000).catch(() => false);
    t.expect('the tape has the part', landed);
  },
};
