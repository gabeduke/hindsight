// J1.12 The bar runs the tape: its reels are drawn, its line names the tape,
// its counter moves while the tape plays, and |◂ goes back to the loop's
// start. docs/flows.md#j112
// Ported from scripts/smoke-tape.mjs ("The bar runs").
export default {
  id: 'J1.12',
  title: 'The bar plays the tape and rewinds it',
  async run(t) {
    const { page, api } = t;
    const tape = await api.tape('Transport');
    const live = async () => (await api.get(`/api/tapes/state?id=${encodeURIComponent(tape.id)}`));

    await page.goto(`${t.base}/tape.html`);
    await page.locator('#np-play').waitFor({ state: 'visible' });
    t.expect('the reels are drawn', await t.poll(() => !!document.querySelector('#np-reel-l .np-pack')));
    const marquee = () => document.getElementById('np-marquee')?.textContent ?? '';
    t.expect('its line names the tape', await t.poll((n) => (document.getElementById('np-marquee')?.textContent ?? '').startsWith(n), tape.name.toUpperCase()),
      await page.evaluate(marquee));

    await t.step('tap ▶', () => t.tap(page.locator('#np-play')));
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
