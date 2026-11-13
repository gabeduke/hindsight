// E2 A light DAW on the tablet: with two takes on the shelf, GRAB 4 bars from
// the first take's page and DROP them on track 1, do the same from the second
// take onto track 2, then select a part, copy it on along the tape, cut the
// other and take both back with ↶. One of Gabe's two journeys, end to end
// (docs/plan/the-calm-studio.md, "How Gabe uses the Studio").
// docs/flows.md#e2

// The number of presses the journey takes: every tap, hold and drag after the
// Givens. It only goes down (the-calm-studio.md, "How it stays calm"): the
// day a change makes the journey shorter, lower it; the day the journey wants
// more, the change is wrong, not this number.
const PRESSES_MAX = 14;

const parts = (s) => (s.tracks ?? []).reduce((n, tr) => n + (tr.clips?.length ?? 0), 0);

export default {
  id: 'E2',
  title: 'Arrange parts from two takes: GRAB, DROP, copy, cut, undo',
  async run(t) {
    const { page, api } = t;
    const touch = t.profile !== 'desktop';
    let presses = 0;
    // A press is one thing the user does after the Givens: counted here, as
    // it is done.
    const press = (name, fn) => t.step(name, async () => { presses++; return fn(); });
    const tapKey = (name, locator) => press(name, () => t.tap(locator));

    const tape = await t.given('a fresh 4-bar tape', () => api.tape('Arrange')); // a take's GRAB starts at the loop's 4 bars
    const first = await t.given('a take on the shelf', () => api.keep(20));
    const second = await t.given('another take on the shelf', () => api.keep(20));
    const bar = (await api.tapeState()).grid.frames / (await api.tapeState()).grid.bars;
    const all = async () => (await api.tapeState()).tracks.flatMap((tr, i) => tr.clips.map((c) => ({ ...c, track: i + 1 })));
    const onTrack = async (n) => (await all()).filter((c) => c.track === n);
    t.expect('the tape starts empty', parts(await api.tapeState()) === 0);

    await t.given('the first take’s page is open', () => page.goto(`${t.base}/wave.html?file=${encodeURIComponent(first.name)}`));
    const grab = page.locator('#take-grab');
    await grab.waitFor({ state: 'visible' });
    await t.poll(() => /4 bars/i.test(document.getElementById('take-grab')?.textContent ?? ''));

    // The first take, onto track 1 (armed on a fresh tape).
    await tapKey('tap GRAB 4 BARS on the first take', grab);
    await page.waitForURL(/tape\.html/, { timeout: 10_000 });
    t.expect('the Studio opens on the clip’s drawer', await t.poll(() => !document.getElementById('buffer')?.hidden, null, 8000));
    await t.poll(() => /track 1\b/i.test(document.getElementById('buffer-drop')?.textContent ?? ''), null, 8000);
    await tapKey('tap DROP', page.locator('#buffer-drop'));
    const one = await api.until(async () => (await onTrack(1)).length === 1, 'a part on track 1', 8000).catch(() => false);
    t.expect('track 1 has a part from the first take', one, await all());

    // The second, onto another track: arm it first, in the Studio.
    await tapKey('arm track 2', page.locator('#lanes .tt-arm').nth(1));
    t.expect('the Pi has track 2 armed', await api.until(async () => (await api.tapeState()).rec_track === 2, 'track 2 armed', 5000).catch(() => false));
    await tapKey('go to the Listening Room', page.locator('a[data-tab="room"]:visible').first());
    await page.waitForURL(/takes\.html/, { timeout: 10_000 });
    const spine = page.locator(`#view-room .room-cassette[data-key="take:${second.name}"]:visible, #takes .take[data-name="${second.name}"]:visible`).first();
    await spine.waitFor({ state: 'visible', timeout: 8000 });
    await t.wait(500);
    await tapKey('tap the second take', spine);
    await t.poll(() => document.getElementById('np')?.dataset.source === 'take', null, 8000);
    await tapKey('tap Open › on the bar', page.locator('#np-open'));
    await page.waitForURL(/wave\.html\?file=/, { timeout: 10_000 });
    t.expect('the second take’s page opens', page.url().includes(encodeURIComponent(second.name)) || page.url().includes(second.name), page.url());
    await page.locator('#take-grab').waitFor({ state: 'visible' });
    await tapKey('tap GRAB 4 BARS on the second take', page.locator('#take-grab'));
    await page.waitForURL(/tape\.html/, { timeout: 10_000 });
    await t.poll(() => /track 2\b/i.test(document.getElementById('buffer-drop')?.textContent ?? ''), null, 8000);
    t.expect('DROP says track 2', /track 2\b/i.test(await page.locator('#buffer-drop').innerText()), await page.locator('#buffer-drop').innerText());
    await tapKey('tap DROP', page.locator('#buffer-drop'));
    const two = await api.until(async () => (await onTrack(2)).length === 1, 'a part on track 2', 8000).catch(() => false);
    t.expect('track 2 has a part from the second take, track 1 keeps the first', two && (await onTrack(1)).length === 1, await all());
    const c1 = (await onTrack(1))[0], c2 = (await onTrack(2))[0];
    t.expect('the two parts are of different takes', !!c1 && !!c2 && c1.file !== c2.file, [c1?.file, c2?.file]);

    // Arrange. Close the drawer's selection by tapping a part: a lane's
    // geometry is read like J1.11's.
    await t.wait(800);
    const spot = async (n, atFrames) => {
      const r = await page.locator('.tt-lane').nth(n - 1).boundingBox();
      const st = await api.tapeState();
      const from = Math.max(0, st.loop.in - bar), to = st.loop.out + bar;
      return { x: r.x + ((atFrames - from) / (to - from)) * r.width, y: r.y + r.height / 2 };
    };
    const tapAt = (x, y) => (touch ? page.touchscreen.tap(x, y) : page.mouse.click(x, y));
    const selected = () => page.evaluate(() => document.getElementById('multi-bar')?.hidden === false);

    let s = await spot(1, c1.at + c1.frames / 2);
    await press('tap the part on track 1', () => tapAt(s.x, s.y));
    t.expect('the clip bar names track 1', await t.poll(() => /^Track 1 ·/.test(document.getElementById('multi-count')?.textContent ?? ''), null, 3000),
      await page.locator('#multi-count').innerText().catch(() => ''));
    const before = parts(await api.tapeState());
    await t.wait(400); // the bar ignores a click in its first 300 ms
    await tapKey('tap Duplicate', page.locator('#multi-dup'));
    const dup = await api.until(async () => parts(await api.tapeState()) === before + 1, 'the copy', 5000).catch(() => false);
    const t1 = await onTrack(1);
    t.expect('a copy of it lies right after it on track 1', dup && t1.length === 2 && t1.some((c) => Math.abs(c.at - (c1.at + c1.frames)) <= 1), t1.map((c) => [c.at, c.frames]));
    t.expect('both are still the first take’s', t1.every((c) => c.file === c1.file), t1.map((c) => c.file));

    await tapKey('tap ↶', page.locator('#tape-undo'));
    t.expect('↶ takes the copy back', await api.until(async () => (await onTrack(1)).length === 1 && parts(await api.tapeState()) === before, 'the undo', 5000).catch(() => false), await all());

    // Cut the second take's part, from its own lane.
    await t.wait(400);
    s = await spot(2, c2.at + c2.frames / 2);
    await press('tap the part on track 2', () => tapAt(s.x, s.y));
    t.expect('the clip bar names track 2', await t.poll(() => /^Track 2 ·/.test(document.getElementById('multi-count')?.textContent ?? ''), null, 3000),
      await page.locator('#multi-count').innerText().catch(() => ''));
    await t.wait(400);
    await tapKey('tap Cut', page.locator('#multi-cut'));
    t.expect('Cut takes it off track 2', await api.until(async () => (await onTrack(2)).length === 0, 'the cut', 5000).catch(() => false), await all());
    const cb = (await api.get('/api/clipboard'))?.clipboard;
    t.expect('and it is on the clipboard, ready to paste', !!cb && cb.tracks?.some((x) => x.clips?.length || x.length), cb);
    await tapKey('tap ↶', page.locator('#tape-undo'));
    const back = await api.until(async () => (await onTrack(2)).length === 1 && (await onTrack(2))[0].at === c2.at, 'the undo', 5000).catch(() => false);
    t.expect('↶ puts it back where it was', back && (await onTrack(1)).length === 1, await all());
    t.expect('the Studio never left', page.url().includes('/tape.html'), page.url());

    t.expect(`the journey took ${presses} presses`, presses <= PRESSES_MAX, `${presses} presses, more than the ${PRESSES_MAX} it may take`);
  },
};
