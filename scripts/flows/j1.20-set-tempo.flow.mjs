// J1.20 Set the tempo with audio down: the tempo on the bar's display opens
// its panel, where I type a tempo, nudge it a BPM with +1 and −1, or TAP
// it; the bar lines move to it and the part on track 1 and the loop stay
// where they were (a re-grid: docs/decisions/0062). docs/flows.md#j120

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bpmOf = (g) => (g ? (g.bars * 4 * 60 * 48000) / g.frames : 0);
const near = (a, b) => Math.abs(a - b) < 0.05;

export default {
  id: 'J1.20',
  title: 'Set the tempo with audio down',
  checksMenus: ['#tempo-menu'],
  async run(t) {
    const { page, api } = t;
    const tape = await t.given('a fresh tape at 96 BPM', () => api.tape('Tempo', 96, 4));
    const take = await t.given('a take on the shelf', () => api.keep(20));
    const st = await api.tapeState();
    const bar = st.grid.frames / st.grid.bars;
    const dropped = await t.given('4 bars of it on track 1', () => api.post(`/api/tapes/drop?id=${encodeURIComponent(tape.id)}`,
      { take: take.name, from: 0, to: Math.round(4 * bar), track: 1, at: st.loop.in }));
    t.expect('the tape has a part on track 1', dropped?.clip, dropped);
    if (!dropped?.clip) return;
    const before = await api.tapeState();
    const clip = JSON.stringify(before.tracks[0].clips);
    const loop = JSON.stringify(before.loop);

    await t.given('the Studio is open', () => page.goto(`${t.base}/tape.html`));
    await t.step('tap the tempo on the bar’s display', () => t.tap(page.locator('#np-tempo')));
    const field = page.locator('#tempo-bpm');
    t.expect('its panel opens with the tempo to type', await t.poll(() => {
      const f = document.getElementById('tempo-bpm');
      return f && !document.getElementById('tempo-menu').hidden && f.value;
    }) === '96', await field.inputValue().catch(() => null));

    await t.step('press +1', () => t.tap(page.locator('#tempo-up')));
    let g = await api.until(async () => { const s = await api.tapeState(); return near(bpmOf(s.grid), 97) && s.grid; }, 'the tape at 97', 5000).catch(() => null);
    t.expect('+1 makes it 97 BPM', !!g, g);

    await t.step('type 92', async () => {
      await field.fill('92');
      await field.press('Enter');
    });
    g = await api.until(async () => { const s = await api.tapeState(); return near(bpmOf(s.grid), 92) && s.grid; }, 'the tape at 92', 5000).catch(() => null);
    t.expect('the tape is at 92 BPM', !!g, g);

    await t.step('TAP four times, half a second apart', async () => {
      for (let i = 0; i < 4; i++) {
        await t.tap(page.locator('#tempo-tap'));
        if (i < 3) await sleep(500);
      }
    });
    const tapped = await api.until(async () => { const s = await api.tapeState(); const b = bpmOf(s.grid); return b > 100 && b < 140 && b; }, 'a tapped tempo', 5000).catch(() => null);
    t.expect('the taps set a tempo near 120', !!tapped, { tapped });
    t.expect('the bar’s display reads it', await t.poll((b) => document.getElementById('np-tempo')?.textContent.includes(String(Math.floor(Math.round(b * 10) / 10))), tapped || 0));

    const after = await api.tapeState();
    t.expect('the part on track 1 has not moved or changed', JSON.stringify(after.tracks[0].clips) === clip, { before: clip, after: after.tracks[0].clips });
    t.expect('the loop has not moved', JSON.stringify(after.loop) === loop, { before: loop, after: after.loop });

    await t.step('press Escape', () => page.keyboard.press('Escape'));
    t.expect('Escape shuts the panel', await t.poll(() => document.getElementById('tempo-menu')?.hidden));
  },
};
