// J1.3 Select a span of the feed: hold on the ribbon and drag, then KEEP
// just that span as a take, or GRAB it into the buffer. docs/flows.md#j13

// holdDrag is the ribbon's select gesture: a press held past the hold time,
// then a drag. A finger on a touch profile (real touch events), the mouse
// otherwise: the ribbon takes a held mouse button too.
async function holdDrag(t, locator, fromPct, toPct) {
  const { page } = t;
  const box = await locator.boundingBox();
  const y = box.y + box.height / 2;
  const x0 = box.x + box.width * fromPct;
  const x1 = box.x + box.width * toPct;
  const steps = 8;
  if (!t.profile.startsWith('desktop')) {
    const cdp = await t.cdp();
    const touch = (type, x) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: x == null ? [] : [{ x, y }] });
    await touch('touchStart', x0);
    await page.waitForTimeout(600);
    for (let i = 1; i <= steps; i++) { await touch('touchMove', x0 + ((x1 - x0) * i) / steps); await page.waitForTimeout(16); }
    await touch('touchEnd');
    return;
  }
  await page.mouse.move(x0, y);
  await page.mouse.down();
  await page.waitForTimeout(600);
  await page.mouse.move(x1, y, { steps });
  await page.mouse.up();
}

// "0:14 · 0:18–0:03 ago" → 14
const selSeconds = (text) => {
  const m = /(?:(\d+):)?(\d+):(\d\d)\s*·/.exec(text);
  return m ? (+(m[1] ?? 0)) * 3600 + (+m[2]) * 60 + (+m[3]) : NaN;
};

export default {
  id: 'J1.3',
  title: 'Select a span of the feed; KEEP or GRAB just that',
  async run(t) {
    const { page, api } = t;
    await t.given('a fresh tape', () => api.tape('Span'));
    await t.given('25s of the jam in the feed', () => api.ringHas(25));
    // A press on a flag is the flag's (it opens its options), never a
    // selection, and the flags an earlier flow left (J1.2) drift along the
    // ribbon as they age: one under 0.4 once took the second hold, and GRAB
    // was never offered. The span is selected on a feed with none.
    await t.given('no flags on the feed', () => api.del('/api/flag?all=1'));
    const before = new Set((await api.takes()).map((x) => x.name));

    await t.given('the Studio is open', () => page.goto(`${t.base}/tape.html`));
    const ribbon = page.locator('#viz-wrap');
    await ribbon.waitFor({ state: 'visible' });
    await t.poll(() => document.querySelector('#viz-wrap .rb-tick'), null, 8000); // drawn: it can name frames
    const bar = page.locator('#rb-sel');

    // Keep: a span well inside the feed, not reaching now.
    await t.step('hold and drag across the ribbon', () => holdDrag(t, ribbon, 0.35, 0.7));
    t.expect('the selection bar opens', await bar.isVisible());
    const text = await page.locator('#rb-sel .rb-sel-text').innerText();
    const len = selSeconds(text);
    t.expect('it names the span, not reaching now', len >= 2 && !/to now/.test(text), `"${text}"`);

    await t.step('tap the selection’s Keep', () => t.tap(page.locator('#rb-sel .rb-sel-save')));
    const take = await api.until(async () => (await api.takes()).find((x) => !before.has(x.name) && x.has_peaks), 'the kept span');
    t.expect('the take is that span', Math.abs(take.duration_seconds - len) <= 1.5,
      `selected ${len} s, kept ${take.duration_seconds.toFixed(2)} s`);
    t.expect('the selection lets go', await t.poll(() => document.getElementById('rb-sel')?.hidden));

    // GRAB: the same gesture, the other verb.
    await t.step('select again', () => holdDrag(t, ribbon, 0.4, 0.75));
    const text2 = await page.locator('#rb-sel .rb-sel-text').innerText();
    const len2 = selSeconds(text2);
    const grab = page.locator('#rb-sel .buffer-grab-sel');
    t.expect('the selection offers GRAB', await grab.isVisible(), `"${text2}"`);
    await t.step('tap the selection’s GRAB', () => t.tap(grab));
    t.expect('the buffer opens', await t.poll(() => !document.getElementById('buffer')?.hidden, null, 8000));
    const clip = await api.until(async () => (await api.get('/api/clipboard')).clipboard, 'the grab in the buffer', 8000).catch(() => null);
    const secs = clip ? clip.frames / 48000 : NaN; // the tape's rate
    t.expect('the buffer holds that span', Math.abs(secs - len2) <= 1.5,
      `selected ${len2} s, buffer ${secs.toFixed(2)} s`);
  },
};
