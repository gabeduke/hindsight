// J4.4 The Studio on a phone: the bar is a mini player above the tabs (its
// window, ▶ and Catch); a tap on the window pulls the player up with the
// transport, Rec and Catch; Back puts it away. A tapped clip's bar floats
// just above the player, and Insert asks before it moves the tape.
// docs/flows.md#j44
const look = () => {
  const on = (s) => { const b = document.querySelector(s)?.getBoundingClientRect(); return !!b && b.width > 0 && b.top >= 0 && b.bottom <= innerHeight; };
  const tabs = document.querySelector('.appnav')?.getBoundingClientRect();
  const c = document.getElementById('catch-pass')?.getBoundingClientRect();
  return {
    window: on('#np-expand'), play: on('#np-play'), loop: on('#np-loop'), rec: on('#rec'), catch: on('#catch-pass'),
    open: document.body.classList.contains('player-open'),
    aboveTabs: !tabs || !c || tabs.top < innerHeight / 2 || c.bottom <= tabs.top + 1,
    path: location.pathname,
  };
};
const clipCount = (tape) => tape.tracks.reduce((n, tr) => n + tr.clips.length, 0);

export default {
  id: 'J4.4',
  title: 'The Studio’s bar on a phone',
  profiles: ['phone'],
  async run(t) {
    const { page, api } = t;
    // A 4-bar tape with the first 4 bars of a take on track 1.
    const tape = await t.given('a fresh tape', () => api.tape('Phone'));
    const take = await t.given('a take on the shelf', () => api.keep(20)); // a kept take can come out a little short
    const st = await api.tapeState();
    const bar = st.grid.frames / st.grid.bars;
    const q = `id=${encodeURIComponent(tape.id)}`;
    const to = Math.min(Math.round(4 * bar), Math.floor(take.duration_seconds * take.sample_rate));
    await t.given('the take\'s first 4 bars on track 1', () => api.post(`/api/tapes/drop?${q}`, { take: take.name, from: 0, to, track: 1, at: st.loop.in }));

    await t.given('the part copied', () => api.post(`/api/tapes/edit?${q}`, { op: 'copy', track: 1 }));

    await t.step('open the Studio', () => page.goto(`${t.base}/tape.html`));
    await page.locator('#np-expand').waitFor({ state: 'visible' });
    await t.wait(800);
    const mini = await page.evaluate(look);
    t.expect('the mini player shows its window, ▶ and Catch, not the transport', mini.window && mini.play && mini.catch && !mini.loop, mini);
    t.expect('the mini player sits above the tabs', mini.aboveTabs, mini);

    await t.step('tap the window', () => t.tap(page.locator('#np-expand')));
    const opened = await t.poll(() => document.body.classList.contains('player-open'));
    const big = await page.evaluate(look);
    t.expect('the player comes up with ▶, Loop, Rec and Catch on screen', opened && big.play && big.loop && big.rec && big.catch, big);

    await t.step('Back', () => page.goBack());
    const shut = await t.poll(() => !document.body.classList.contains('player-open'));
    const back = await page.evaluate(look);
    t.expect('Back puts the player away, on the same page', shut && back.window && back.path === '/tape.html', back);

    // A tap on the clip: the clip bar comes up after half a second (a second
    // tap could still make it a double), then the lane scrolls clear of it.
    const lane = page.locator('.tt-lane').first();
    const r = await lane.boundingBox();
    await t.step('tap the clip', () => page.touchscreen.tap(r.x + r.width * 0.3, r.y + r.height / 2));
    const shown = await t.poll(() => document.getElementById('multi-bar')?.hidden === false, null, 4000);
    await t.wait(700);
    const g = await page.evaluate(() => {
      const b = document.getElementById('multi-bar').getBoundingClientRect();
      const np = document.getElementById('np').getBoundingClientRect();
      const ln = document.querySelector('.tt-lane').getBoundingClientRect();
      return { bar: [Math.round(b.top), Math.round(b.bottom)], np: Math.round(np.top), lane: Math.round(ln.bottom), count: document.getElementById('multi-count')?.textContent };
    });
    t.expect('the clip bar names the clip', shown && /^Track 1/.test(g.count ?? ''), g);
    t.expect('it sits just above the player', g.bar[0] >= 0 && Math.abs(g.bar[1] - g.np) <= 2, g);
    t.expect('and the tapped lane is not under it', g.lane <= g.bar[0] + 1, g);
    const sx = await page.evaluate(() => scrollX);
    t.expect('the page has not scrolled sideways', sx === 0, { scrollX: sx });
    // A phone has no Escape: a tap on an empty part of a lane lets go (the
    // view is the loop and a bar after it, so past the clip on track 1).
    const empty = await lane.boundingBox();
    await t.step('tap past the clip', () => page.touchscreen.tap(empty.x + empty.width * 0.95, empty.y + empty.height / 2));
    const gone = await t.poll(() => document.getElementById('multi-bar')?.hidden !== false, null, 3000);
    t.expect('a tap on an empty lane lets go of the clip', gone, await page.locator('#multi-count').textContent());

    // Insert asks first on a phone: one tap shows it, a second does it.
    // Insert is on a range's action bar: a finger held on the ruler makes
    // one, a bar on every track. The clipboard is the clip, copied above.
    const n0 = clipCount(await api.tapeState());
    // A held touch lands where the ruler is on screen, so bring it there.
    await page.locator('#tape-ruler').scrollIntoViewIfNeeded();
    await t.step('hold the ruler', () => t.hold(page.locator('#tape-ruler')));
    const ranged = await t.poll(() => /^All tracks/.test(document.getElementById('multi-count')?.textContent ?? '')
      && !document.getElementById('range-insert')?.hidden, null, 4000);
    t.expect('a held ruler makes a range on every track', ranged, await page.locator('#multi-count').textContent());
    const insert = page.locator('#range-insert');
    // The bar ignores a click in its first 300 ms (page.js: it comes up
    // where the finger may be), as a person's next tap would.
    await t.wait(400);
    await t.step('tap Insert once', () => t.tap(insert));
    await t.wait(500);
    const asking = await page.evaluate(() => document.getElementById('range-insert')?.classList.contains('confirming'));
    t.expect('a first tap only shows what Insert will do', asking && clipCount(await api.tapeState()) === n0, { asking, toasts: await page.locator('#toasts .toast').allTextContents() });
    await t.step('tap Insert again', () => t.tap(insert));
    const grew = await api.until(async () => clipCount(await api.tapeState()) > n0, 'the insert', 5000).catch(() => false);
    t.expect('a second tap inserts', grew);
    await t.step('↶', () => t.tap(page.locator('#tape-undo')));
    const undone = await api.until(async () => clipCount(await api.tapeState()) === n0, 'the undo', 5000).catch(() => false);
    t.expect('↶ takes the insert back', undone);
  },
};
