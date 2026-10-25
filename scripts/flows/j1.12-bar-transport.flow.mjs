// J1.12 The bar runs the tape: its reels are drawn, its line names the tape,
// its counter moves while the tape plays, and |◂ goes back to the loop's
// start. ▶ goes down the moment it is touched, and a quick tap still shows
// it down (lib/ui/keys.js). docs/flows.md#j112
// Ported from the retired scripts/smoke-tape.mjs ("The bar runs").
export default {
  id: 'J1.12',
  title: 'The bar plays the tape and rewinds it',
  async run(t) {
    const { page, api } = t;
    const tape = await t.given('a fresh tape', () => api.tape('Transport'));
    const live = async () => (await api.get(`/api/tapes/state?id=${encodeURIComponent(tape.id)}`));

    await t.given('the Studio is open', () => page.goto(`${t.base}/tape.html`));
    await page.locator('#np-play').waitFor({ state: 'visible' });
    t.expect('the reels are drawn', await t.poll(() => !!document.querySelector('#np-reel-l .np-pack')));
    const marquee = () => document.getElementById('np-marquee')?.textContent ?? '';
    t.expect('its line names the tape', await t.poll((n) => (document.getElementById('np-marquee')?.textContent ?? '').startsWith(n), tape.name.toUpperCase()),
      await page.evaluate(marquee));

    // Watch ▶ as it is tapped: the first frame after the finger lands, and
    // how long its down pose lasts. A tap from the harness is as quick as a
    // tap gets, so this is the case the down pose has to outlast.
    await page.evaluate(() => {
      const key = document.getElementById('np-play');
      const seen = window.__press = { at: null, first: null, upAt: null };
      addEventListener('pointerdown', (e) => {
        if (seen.at !== null || !key.contains(e.target)) return;
        seen.at = performance.now();
        requestAnimationFrame(() => { seen.first = getComputedStyle(key).transform; });
      }, { capture: true });
      new MutationObserver(() => {
        if (seen.at !== null && seen.upAt === null && !key.classList.contains('down')) seen.upAt = performance.now();
      }).observe(key, { attributes: true, attributeFilter: ['class'] });
    });
    await t.step('tap ▶', () => t.tap(page.locator('#np-play')));
    const press = await t.poll(() => (window.__press?.upAt != null ? window.__press : null), null, 3000);
    t.expect('▶ is down in the first frame after the touch, 2 px', /matrix\(1, 0, 0, 1, 0, 2\)/.test(press?.first ?? ''), press);
    t.expect('a quick tap still shows ▶ down for 80 ms', press && press.upAt - press.at >= 79, press && Math.round(press.upAt - press.at));
    t.expect('▶ shows it playing', await t.poll(() => document.getElementById('np-play')?.classList.contains('playing')));
    const playing = await api.until(async () => (await live()).live?.playing, 'the Pi to play the tape', 8000).catch(() => false);
    t.expect('the Pi plays the tape', playing);
    const a = await page.locator('#position').innerText();
    await t.wait(1500);
    const b = await page.locator('#position').innerText();
    t.expect('the counter moves while it plays', a !== b, `${a} → ${b}`);

    // Wait into the second bar, so |◂ has somewhere to go back from.
    const st = await live();
    const bar = st.tape.grid.frames / st.tape.grid.bars;
    const { in: loopIn } = st.tape.loop;
    await api.until(async () => (await live()).live.heard >= loopIn + bar, 'the tape into its second bar', 10_000).catch(() => {});
    await t.step('tap |◂', () => t.tap(page.locator('#np-start')));
    const back = await api.until(async () => {
      const h = (await live()).live.heard;
      return h >= loopIn && h < loopIn + bar ? { h } : null;
    }, 'the tape back at the loop’s start', 3000).catch(() => false);
    t.expect('|◂ goes back to the loop’s start, on the Pi', back !== false, { heard: (await live()).live.heard, in: loopIn, bar });

    await t.step('tap ▶ to stop', () => t.tap(page.locator('#np-play')));
    const stopped = await api.until(async () => !(await live()).live.playing, 'the tape to stop', 5000).catch(() => false);
    t.expect('the Pi stops', stopped);

    // Space plays and stops from the page. After a tap the focus is on the
    // view's root, which the key once took for a focused control.
    await page.locator('#view-studio').focus();
    await t.step('press Space', () => page.keyboard.press(' '));
    t.expect('Space plays the tape', await api.until(async () => (await live()).live.playing, 'the tape to play', 5000).catch(() => false));
    await t.step('press Space again', () => page.keyboard.press(' '));
    t.expect('Space stops it', await api.until(async () => !(await live()).live.playing, 'the tape to stop', 5000).catch(() => false));
  },
};
