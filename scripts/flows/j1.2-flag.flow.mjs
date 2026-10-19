// J1.2 Flag a moment now: Flag now in the Studio drops a flag on the feed,
// and the next KEEP carries it, at the moment it was pressed. docs/flows.md#j12
export default {
  id: 'J1.2',
  title: 'Flag now; the flag rides into the next take',
  async run(t) {
    const { page, api } = t;
    await api.ringHas(10);
    const before = new Set((await api.takes()).map((x) => x.name));

    await page.goto(`${t.base}/tape.html`);
    const mark = page.locator('#mark-btn');
    await mark.waitFor({ state: 'visible' });
    await t.poll(() => !document.getElementById('mark-btn')?.disabled);
    const flags0 = await page.locator('#viz-wrap .rb-flag').count();

    await t.step('tap Flag now', () => t.tap(mark));
    const flags1 = await t.poll((n) => document.querySelectorAll('#viz-wrap .rb-flag').length > n && document.querySelectorAll('#viz-wrap .rb-flag').length, flags0, 5000);
    t.expect('the flag is on the feed', flags1 > flags0, `flags on the ribbon: ${flags0} → ${flags1}`);

    // A beat later, as a player would: the flag sits that far before the end.
    await t.wait(2000);
    await t.step('tap KEEP', () => t.tap(page.locator('#studio-keep')));
    const take = await api.until(async () => (await api.takes()).find((x) => !before.has(x.name) && x.has_peaks), 'the kept take');
    // Flags from earlier flows can still be in the feed: look for this one.
    const ages = (take.flags ?? []).map((f) => take.duration_seconds - f.frame / take.sample_rate);
    t.expect('the take carries the flag, where it was pressed (about 2 s before KEEP)', ages.some((a) => a > 1 && a < 6),
      `flags at ${ages.map((a) => a.toFixed(2)).join(', ') || 'none'} s before the end`);
  },
};
