// J1.9 Lay out a song: sections on the strip (hold and drag, name, resize,
// select, remove), a range on the ruler (Copy, Delete time), Duplicate
// section, and ↶/↷ through all of it. Every outcome is read back from the
// tape on the Pi. docs/flows.md#j19

// press is a hold then a drag, the way each device does it: a finger held
// (real touch events) or the mouse held down. holdMs 0 is a plain drag.
async function press(t, a, b, holdMs = 450) {
  const { page } = t;
  const steps = 8;
  const at = (i) => ({ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps });
  if (t.profile === 'desktop') {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    if (holdMs) await page.waitForTimeout(holdMs);
    for (let i = 1; i <= steps; i++) { const p = at(i); await page.mouse.move(p.x, p.y); }
    await page.mouse.up();
    return;
  }
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [a] });
  if (holdMs) await page.waitForTimeout(holdMs);
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [at(i)] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

export default {
  id: 'J1.9',
  title: 'Lay out a song: sections, ranges, undo',
  async run(t) {
    const { page, api } = t;
    // A 4-bar tape at 96 BPM with a take's first 4 bars on track 1.
    const tape = await api.tape('Song');
    const take = await api.keep(20);
    const st0 = await api.tapeState();
    const bar = st0.grid.frames / st0.grid.bars;
    const q = `id=${encodeURIComponent(tape.id)}`;
    const to4 = Math.min(Math.round(4 * bar), Math.floor(take.duration_seconds * take.sample_rate));
    await api.post(`/api/tapes/drop?${q}`, { take: take.name, from: 0, to: to4, track: 1, at: 0 });
    const sections = async () => (await api.tapeState()).sections ?? [];
    const near = (a, b) => Math.abs(a - b) <= 1;
    const undo = () => t.tap(page.locator('#tape-undo'));
    const redo = () => t.tap(page.locator('#tape-redo'));
    const tapAt = (x, y) => (t.profile === 'desktop' ? page.mouse.click(x, y) : page.touchscreen.tap(x, y));

    await t.step('open the Studio', () => page.goto(`${t.base}/tape.html`));
    const strip = page.locator('#tape-sections');
    await strip.waitFor({ state: 'visible' });
    await t.wait(1500);
    // The lanes, the ruler and the strip show the loop and a bar either side
    // (geometry.js editView), and follow the loop as it changes: where a
    // frame is on screen is worked out again before each gesture.
    const geo = async (loc) => {
      await loc.scrollIntoViewIfNeeded();
      const l = (await api.tapeState()).loop;
      const from = Math.max(0, Math.round(l.in - bar)), to = Math.round(l.out + bar);
      const b = await loc.boundingBox();
      return { x: (f) => b.x + ((f - from) / (to - from)) * b.width, y: b.y + b.height / 2 };
    };
    let g = await geo(strip);

    // Sections.
    await t.step('hold and drag the strip over bars 1–2', () => press(t, { x: g.x(0.2 * bar), y: g.y }, { x: g.x(1.8 * bar), y: g.y }));
    let secs = await api.until(async () => { const s = await sections(); return s.length ? s : null; }, 'a section', 4000).catch(() => []);
    t.expect('a section, on the bar lines of bars 1–2', secs.length === 1 && secs[0].at === 0 && near(secs[0].end, 2 * bar), secs);
    t.expect('its sheet opens', await t.poll(() => document.getElementById('section-sheet')?.open));
    await t.step('call it Verse', () => t.tap(page.locator('#section-names button', { hasText: 'Verse' })));
    secs = await api.until(async () => { const s = await sections(); return s[0]?.name === 'Verse' ? s : null; }, 'the name', 4000).catch(() => sections());
    t.expect('it is named Verse', secs[0]?.name === 'Verse', secs);
    await t.step('Done', () => t.tap(page.locator('#section-done')));
    await t.poll(() => !document.getElementById('section-sheet')?.open);
    const verse = secs[0];

    g = await geo(strip);
    await t.step('drag its right edge a bar on', () => press(t, { x: g.x(verse.end) - 3, y: g.y }, { x: g.x(verse.end + bar) - 3, y: g.y }, 0));
    const grown = await api.until(async () => { const s = (await sections())[0]; return s && s.end !== verse.end ? s : null; }, 'the edge', 4000).catch(() => null);
    t.expect('the section is bars 1–3, in whole frames', grown && Number.isInteger(grown.end) && near(grown.end, 3 * bar), grown);
    await t.step('↶', undo);
    const back = await api.until(async () => { const s = (await sections())[0]; return s && s.end === verse.end ? s : null; }, 'the undo', 4000).catch(() => null);
    t.expect('↶ puts it back to bars 1–2', back, await sections());
    await t.step('↷', redo);
    const again = await api.until(async () => { const s = (await sections())[0]; return s && near(s.end, 3 * bar) ? s : null; }, 'the redo', 4000).catch(() => null);
    t.expect('↷ makes it bars 1–3 again', again, await sections());
    await t.step('↶ again', undo);
    await api.until(async () => (await sections())[0]?.end === verse.end, 'the undo', 4000).catch(() => {});

    await t.wait(500); // the page's next poll
    g = await geo(strip);
    await t.step('tap the Verse', () => tapAt(g.x(bar), g.y));
    const loop = await api.until(async () => { const l = (await api.tapeState()).loop; return l.in === verse.at && l.out === verse.end ? l : null; }, 'the loop on the verse', 4000).catch(() => null);
    t.expect('a tap makes its bars the loop', loop, (await api.tapeState()).loop);
    await t.wait(500);
    g = await geo(strip);
    await t.step('tap it again', () => tapAt(g.x(bar), g.y));
    t.expect('a second tap opens its sheet', await t.poll(() => document.getElementById('section-sheet')?.open));
    await t.step('Duplicate section', () => t.tap(page.locator('#section-dup')));
    secs = await api.until(async () => { const s = await sections(); return s.length === 2 ? s : null; }, 'the copy', 4000).catch(() => sections());
    t.expect('the Verse twice in a row', secs.length === 2 && secs[1].name === 'Verse' && secs[1].at === verse.end, secs);
    await t.step('↶', undo);
    t.expect('↶ takes the copy back', await api.until(async () => (await sections()).length === 1, 'the undo', 4000).catch(() => false));

    if (await page.evaluate(() => document.getElementById('section-sheet')?.open)) await t.tap(page.locator('#section-done'));
    await t.poll(() => !document.getElementById('section-sheet')?.open);
    await t.step('tap the Verse, then again for its sheet', async () => {
      g = await geo(strip);
      await tapAt(g.x(bar), g.y);
      await t.wait(700);
      g = await geo(strip);
      if (!(await page.evaluate(() => document.getElementById('section-sheet')?.open))) await tapAt(g.x(bar), g.y);
    });
    await t.poll(() => document.getElementById('section-sheet')?.open);
    await t.step('Remove', () => t.tap(page.locator('#section-remove')));
    t.expect('Remove takes it away', await api.until(async () => (await sections()).length === 0, 'the removal', 4000).catch(() => false));
    await t.step('↶', undo);
    t.expect('↶ brings it back', await api.until(async () => (await sections()).length === 1, 'the undo', 4000).catch(() => false));

    // A range: the ruler held in bar 3 is bar 3 on every track.
    await api.patch(`/api/tapes?${q}`, { loop: { in: 0, out: Math.round(4 * bar), on: true } });
    // Let go of the section's range: a tap past the clip on track 1.
    await t.wait(500);
    g = await geo(page.locator('.tt-lane').first());
    await t.step('tap past the clip', () => tapAt(g.x(4.5 * bar), g.y));
    t.expect('the range lets go', await t.poll(() => document.getElementById('multi-bar')?.hidden !== false, null, 3000));
    g = await geo(page.locator('#tape-ruler'));
    await t.step('hold the ruler in bar 3', () => press(t, { x: g.x(2.5 * bar), y: g.y }, { x: g.x(2.5 * bar), y: g.y }, 600));
    const named = await t.poll(() => document.getElementById('multi-count')?.textContent ?? '', null, 3000);
    t.expect('the action bar names bar 3 on every track', named === 'All tracks · bar 3', named);
    await t.wait(400); // the bar ignores a click in its first 300 ms
    await t.step('Copy', () => t.tap(page.locator('#range-copy')));
    const cb = await api.until(async () => (await api.get('/api/clipboard'))?.clipboard, 'the clipboard', 4000).catch(() => null);
    t.expect('Copy takes the bar, a clipboard track for each track', cb && cb.tracks.length === st0.tracks.length && near(cb.frames, bar), cb && [cb.tracks.length, cb.frames]);
    const len = async () => (await api.tapeState()).tracks[0].clips.reduce((a, c) => a + c.frames, 0);
    const len0 = await len();
    await t.step('Delete time', () => t.tap(page.locator('#range-delete')));
    // A touch screen asks first (Ask first is on): the second tap does it.
    if (t.profile !== 'desktop') {
      await t.wait(500);
      await t.tap(page.locator('#range-delete'));
    }
    const shorter = await api.until(async () => { const l = await len(); return near(len0 - l, bar) ? l : null; }, 'a bar out', 4000).catch(() => null);
    t.expect('Delete time takes the bar out and closes the gap', shorter, { before: len0, after: await len() });
    await t.step('↶', undo);
    t.expect('↶ puts the bar back', await api.until(async () => (await len()) === len0, 'the undo', 4000).catch(() => false));
  },
};
