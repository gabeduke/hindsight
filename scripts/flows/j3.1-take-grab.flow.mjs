// J3.1 Lift bars from an old take: on its page, GRAB 4 BARS takes them onto
// the Studio's cue lane, the Studio opens on its drawer, and DROP puts them
// on the armed track.
// docs/flows.md#j31
const parts = (s) => (s.tracks ?? []).reduce((n, tr) => n + (tr.clips?.length ?? 0), 0);

export default {
  id: 'J3.1',
  title: 'GRAB 4 bars from a take’s page, DROP them in the Studio',
  async run(t) {
    const { page, api } = t;
    await t.given('a fresh 4-bar tape', () => api.tape('Take grab')); // the take's GRAB starts at the loop's 4 bars
    const take = await t.given('a take on the shelf', () => api.keep(20));
    const before = parts(await api.tapeState());

    await t.given('the take\'s page is open', () => page.goto(`${t.base}/wave.html?file=${encodeURIComponent(take.name)}`));
    const grab = page.locator('.room-open-grab');
    await grab.waitFor({ state: 'visible' });
    const words = await t.poll(() => /4 bars/i.test(document.querySelector('.room-open-grab')?.textContent ?? '') && document.querySelector('.room-open-grab').textContent);
    t.expect('the key reads GRAB 4 BARS', words, await grab.innerText());

    await t.step('tap GRAB 4 BARS', () => t.tap(grab));
    await page.waitForURL(/tape\.html/, { timeout: 10_000 });
    t.expect('the Studio opens on the clip’s drawer', await t.poll(() => !document.getElementById('buffer')?.hidden, null, 8000));
    const clip = await api.until(async () => (await api.tapeState()).cue?.clips?.at(-1), 'the grab on the cue lane', 8000).catch(() => null);
    const bars4 = (4 * 4 * 60) / (take.bpm || 96);
    const secs = clip ? clip.frames / 48000 : 0;
    t.expect('the cue lane holds 4 bars of the take, with handles of its own audio', Math.abs(secs - bars4) < 0.2 && clip?.grab?.take,
      `on the lane ${secs.toFixed(2)} s, 4 bars at ${take.bpm} BPM = ${bars4.toFixed(2)} s, from "${clip?.name}"`);

    await t.poll(() => /track \d/i.test(document.getElementById('buffer-drop')?.textContent ?? ''));
    const sub = await page.locator('#buffer-drop').innerText();
    t.expect('DROP says where it lands', /track \d/i.test(sub), `label: "${sub}"`);
    await t.step('tap DROP', () => t.tap(page.locator('#buffer-drop')));
    const landed = await api.until(async () => parts(await api.tapeState()) > before, 'a part on the tape', 8000).catch(() => false);
    t.expect('the tape has the part', landed);
  },
};
