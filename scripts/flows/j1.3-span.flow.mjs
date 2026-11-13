// J1.3 Turn the Studio to the feed's face, tap the feed where the jam began
// and KEEP from there to now, dragging the mark to move it; or hold on the
// ribbon and drag to select a span, then KEEP just that as a take, or GRAB
// it onto the cue lane. docs/flows.md#j13

// tapAt is one tap on the ribbon, a part of the way along it: a finger on a
// touch profile, the mouse otherwise.
async function tapAt(t, locator, pct) {
  const box = await locator.boundingBox();
  const x = box.x + box.width * pct;
  const y = box.y + box.height / 2;
  if (!t.profile.startsWith('desktop')) return t.page.touchscreen.tap(x, y);
  return t.page.mouse.click(x, y);
}

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

// dragKey drags a key on the ribbon to a part of the way along it: a finger
// on a touch profile (its own touch events, no hold first), the mouse
// otherwise.
async function dragKey(t, key, ribbon, pct) {
  const { page } = t;
  const k = await key.boundingBox();
  const r = await ribbon.boundingBox();
  const x0 = k.x + k.width / 2, y = k.y + k.height / 2, x1 = r.x + r.width * pct;
  const steps = 8;
  if (!t.profile.startsWith('desktop')) {
    const cdp = await t.cdp();
    const touch = (type, x) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: x == null ? [] : [{ x, y }] });
    await touch('touchStart', x0);
    for (let i = 1; i <= steps; i++) { await touch('touchMove', x0 + ((x1 - x0) * i) / steps); await page.waitForTimeout(16); }
    await touch('touchEnd');
    return;
  }
  await page.mouse.move(x0, y);
  await page.mouse.down();
  await page.mouse.move(x1, y, { steps });
  await page.mouse.up();
}

// A key's length, "28s" or "1m5s" (lib/rooms/keeplabel.js lengthWords), in seconds.
const wordsSeconds = (w) => {
  const m = /(?:(\d+)m)?(?:([\d.]+)s)?/.exec((w || '').trim());
  return m && (m[1] || m[2]) ? (+(m[1] ?? 0)) * 60 + (+(m[2] ?? 0)) : NaN;
};

// "0:14 · 0:18–0:03 ago" → 14
const selSeconds = (text) => {
  const m = /(?:(\d+):)?(\d+):(\d\d)\s*·/.exec(text);
  return m ? (+(m[1] ?? 0)) * 3600 + (+m[2]) * 60 + (+m[3]) : NaN;
};

export default {
  id: 'J1.3',
  title: 'On the feed’s face, mark or select a span of the feed; KEEP or GRAB just that',
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
    // The Studio opens on the tape's face, where the feed is a thin row and
    // its ribbon one key: the mark and the span are the feed's face's.
    await t.step('tap the feed’s strip, to turn to the feed', () => t.tap(page.locator('#face-feed')));
    t.expect('the Studio is on the feed’s face, the ribbon taller than the strip was', await t.poll(() => document.getElementById('view-studio')?.dataset.face === 'feed'
      && document.getElementById('viz-wrap').getBoundingClientRect().height > 80, null, 3000),
    await page.evaluate(() => ({ face: document.getElementById('view-studio')?.dataset.face, h: Math.round(document.getElementById('viz-wrap').getBoundingClientRect().height) })));
    await t.poll(() => document.querySelector('#viz-wrap .rb-tick'), null, 8000); // drawn: it can name frames
    const bar = page.locator('#rb-sel');

    // The mark: a tap says "from here", and KEEP keeps from it to now.
    await t.step('tap the ribbon where the jam began', () => tapAt(t, ribbon, 0.45));
    t.expect('the mark is on the ribbon, with its own key to take it off', await t.poll(() => !!document.querySelector('#viz-wrap .rb-mark-clear:not([hidden])')),
      await page.evaluate(() => JSON.stringify({ band: document.querySelector('#viz-wrap .rb-sel-band')?.style.cssText ?? null, readout: document.querySelector('#viz-wrap .rb-readout')?.textContent, keep: document.getElementById('studio-keep')?.textContent })));
    t.expect('no bar opens for a mark: the lanes stay where they are', await page.evaluate(() => document.getElementById('rb-sel').hidden));
    t.expect('KEEP says it keeps from the mark', await t.poll(() => /mark/.test(document.getElementById('studio-keep-sub')?.textContent || '')),
      await page.locator('#studio-keep').innerText());
    t.expect('and GRAB that it grabs from it', await t.poll(() => /mark/.test(document.querySelector('.buffer-grab')?.textContent || '')),
      await page.locator('.buffer-grab').innerText());
    const marked = wordsSeconds(await page.locator('#studio-keep-len').innerText());
    // A drag of the mark's key moves the mark: later along the ribbon is
    // nearer now, so KEEP and GRAB name a shorter stretch.
    const markKey = page.locator('#viz-wrap .rb-mark-clear:not([hidden])');
    const keyAt = async () => Math.round((await markKey.boundingBox()).x);
    const x0 = await keyAt();
    await t.step('drag the mark’s key later along the ribbon', () => dragKey(t, markKey, ribbon, 0.75));
    const moved = await t.poll((was) => {
      const k = document.querySelector('#viz-wrap .rb-mark-clear:not([hidden])');
      const len = document.getElementById('studio-keep-len')?.textContent || '';
      return !!k && k.getBoundingClientRect().x > was + 20 && /mark/.test(document.getElementById('studio-keep-sub')?.textContent || '') && len;
    }, x0, 3000);
    t.expect('the mark moves with it, and KEEP names the shorter stretch from it', !!moved && wordsSeconds(moved) < marked - 1,
      { was: marked, now: moved, key: [x0, await keyAt().catch(() => null)] });
    await t.step('tap the mark’s key', () => t.tap(page.locator('#viz-wrap .rb-mark-clear:not([hidden])')));
    t.expect('the mark is off, and KEEP is its length again', await t.poll(() => !document.querySelector('#viz-wrap .rb-mark-clear:not([hidden])') && !/mark/.test(document.getElementById('studio-keep-sub')?.textContent || '')));
    await t.step('mark again', () => tapAt(t, ribbon, 0.45));
    await t.poll(() => !!document.querySelector('#viz-wrap .rb-mark-clear:not([hidden])'));
    await t.step('tap KEEP', () => t.tap(page.locator('#studio-keep')));
    const fromMark = await api.until(async () => (await api.takes()).find((x) => !before.has(x.name) && x.has_peaks), 'the take from the mark');
    t.expect('the take runs from the mark to now', fromMark.duration_seconds >= marked - 1.5 && fromMark.duration_seconds <= marked + 4,
      `marked ${marked} s ago, kept ${fromMark.duration_seconds.toFixed(2)} s`);
    t.expect('the mark lets go', await t.poll(() => !document.querySelector('#viz-wrap .rb-mark-clear:not([hidden])')));
    // Taken back, so this flow leaves the shelf one take longer, as it did
    // before the mark: J5.1's List check on a phone depends on the run's
    // count of takes (docs/plan/STATE.md, Known bugs).
    await api.del(`/api/delete?file=${encodeURIComponent(fromMark.name)}`);
    await api.del(`/api/trash?file=${encodeURIComponent(fromMark.name)}`); // and out of Recently deleted, which later flows' screens would show
    before.add(fromMark.name);

    // Keep: a span well inside the feed, not reaching now.
    await t.step('hold and drag across the ribbon', () => holdDrag(t, ribbon, 0.35, 0.7));
    t.expect('the selection bar opens', await bar.isVisible());
    const text = await page.locator('#rb-sel .rb-sel-text').innerText();
    const len = selSeconds(text);
    t.expect('it names the span, not reaching now', len >= 2 && !/to now/.test(text), `"${text}"`);

    await t.step('tap KEEP, which keeps the selection', () => t.tap(page.locator('#studio-keep')));
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
    t.expect('its drawer opens', await t.poll(() => !document.getElementById('buffer')?.hidden, null, 8000));
    const clip = await api.until(async () => (await api.tapeState()).cue?.clips?.at(-1), 'the grab on the cue lane', 8000).catch(() => null);
    const secs = clip ? clip.frames / 48000 : NaN; // the tape's rate
    t.expect('the cue lane holds that span', Math.abs(secs - len2) <= 1.5,
      `selected ${len2} s, on the lane ${secs.toFixed(2)} s`);
  },
};
