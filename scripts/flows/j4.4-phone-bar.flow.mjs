// J4.4 The Studio on a phone: the bar is a mini player above the tabs (its
// window, |◀, ▶ and Catch); |◀ goes back to the loop's start; a tap on the
// window pulls the player up with the transport, Rec and Catch; Back puts
// it away and stays in the Studio. A tapped clip's bar floats just above the
// player, and Insert asks before it moves the tape. The ruler's keys are one
// key, ⌗. In the Listening Room a take's mini player has |◀ beside ▶ as
// well.
//
// Back reaches the player as the stack's close request (lib/ui/layers.js).
// In Chromium that is Android's Back or Escape -- page.goBack() is the
// browser's own Back button, a move in the history, which leaves the page a
// flow opened. Without CloseWatcher (Safari) the stack keeps a history
// entry, and Back is page.goBack(): the end of the flow checks that too.
// docs/flows.md#j44
const look = () => {
  const on = (s) => { const b = document.querySelector(s)?.getBoundingClientRect(); return !!b && b.width > 0 && b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth; };
  const tabs = document.querySelector('.appnav')?.getBoundingClientRect();
  const c = document.getElementById('catch-pass')?.getBoundingClientRect();
  // |◀ beside ▶: on its row, just to its left, and a thumb wide.
  const s = document.getElementById('np-start')?.getBoundingClientRect();
  const p = document.getElementById('np-play')?.getBoundingClientRect();
  const beside = !!s && !!p && s.width >= 44 && s.height >= 44 && Math.abs(s.top - p.top) <= 4 && s.right <= p.left && p.left - s.right <= 12;
  return {
    window: on('#np-expand'), start: on('#np-start'), play: on('#np-play'), loop: on('#np-loop'), rec: on('#rec'), catch: on('#catch-pass'),
    name: on('#np-name'), note: on('#np-note'), beside,
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
    t.expect('the mini player shows its window, |◀, ▶ and Catch, not the rest of the transport', mini.window && mini.start && mini.play && mini.catch && !mini.loop, mini);
    t.expect('|◀ sits beside ▶, a thumb wide', mini.beside, mini);
    t.expect('the mini player sits above the tabs', mini.aboveTabs, mini);

    // |◀ from the mini player: play into the second bar, then back.
    const live = async () => (await api.get(`/api/tapes/state?${q}`)).live;
    await t.step('tap ▶', () => t.tap(page.locator('#np-play')));
    await api.until(async () => (await live())?.heard >= st.loop.in + bar, 'the tape into its second bar', 10_000).catch(() => {});
    await t.step('tap |◀', () => t.tap(page.locator('#np-start')));
    const rewound = await api.until(async () => {
      const h = (await live())?.heard;
      return h >= st.loop.in && h < st.loop.in + bar ? { h } : null;
    }, 'the tape back at the loop’s start', 3000).catch(() => false);
    t.expect('|◀ goes back to the loop’s start, on the Pi', rewound !== false, { heard: (await live())?.heard, in: st.loop.in, bar });
    await t.step('tap ▶ to stop', () => t.tap(page.locator('#np-play')));
    await api.until(async () => !(await live())?.playing, 'the tape to stop', 5000).catch(() => {});

    await t.step('tap the window', () => t.tap(page.locator('#np-expand')));
    const opened = await t.poll(() => document.body.classList.contains('player-open'));
    const big = await page.evaluate(look);
    t.expect('the player comes up with ▶, Loop, Rec and Catch on screen', opened && big.play && big.loop && big.rec && big.catch, big);

    await t.step('Back (a close request: Escape, in Chromium)', () => page.keyboard.press('Escape'));
    const shut = await t.poll(() => !document.body.classList.contains('player-open'));
    const back = await page.evaluate(look);
    t.expect('Back puts the player away, on the same page', shut && back.window && back.path === '/tape.html', back);

    // The same in a browser without CloseWatcher (Safari): the player up
    // holds one history entry, so the browser's Back puts it away, and the
    // Studio stays. A second tab of this phone, with CloseWatcher taken out.
    const safari = await page.context().newPage();
    const errs = [];
    safari.on('pageerror', (e) => errs.push(e.message));
    await safari.addInitScript(() => { delete window.CloseWatcher; });
    const until = (fn) => safari.waitForFunction(fn, null, { timeout: 5000 }).then(() => true, () => false);
    await t.step('open the Studio in a browser without CloseWatcher', () => safari.goto(`${t.base}/tape.html`));
    await safari.locator('#np-expand').waitFor({ state: 'visible' });
    await safari.waitForTimeout(800);
    await t.step('tap the window there', () => safari.locator('#np-expand').tap());
    const upThere = await until(() => document.body.classList.contains('player-open') && typeof window.CloseWatcher === 'undefined');
    await t.step('Back (the browser’s)', () => safari.goBack());
    const awayThere = await until(() => !document.body.classList.contains('player-open') && location.pathname === '/tape.html');
    t.expect('there, Back puts the player away too, in the Studio', upThere && awayThere && !errs.length,
      { upThere, awayThere, errs, at: await safari.evaluate(look).catch((e) => e.message) });
    await safari.close();

    // A tap on the clip: the clip bar comes up after half a second (a second
    // tap could still make it a double), then the lane scrolls clear of it.
    const lane = page.locator('.tt-lane').first();
    // The feed comes first on a phone, so the lanes start low: scroll the
    // first up clear of the player, as a thumb would, before tapping it.
    await t.step('scroll to the lanes', async () => {
      for (let i = 0; i < 12; i++) {
        const clear = await page.evaluate(() => document.querySelector('.tt-lane').getBoundingClientRect().bottom
          < document.getElementById('np').getBoundingClientRect().top - 8);
        if (clear) break;
        await page.mouse.wheel(0, 120);
        await t.wait(150);
      }
    });
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

    // The ruler's keys are one key on a phone, so its row stays one line.
    const rk = await page.evaluate(() => ({
      row: Math.round(document.getElementById('tape-ruler').parentElement.getBoundingClientRect().height),
      key: !!document.getElementById('ruler-more')?.offsetParent,
      chips: !!document.getElementById('snap-btn')?.offsetParent,
    }));
    t.expect('the ruler’s keys are one key, ⌗, and its row one line', rk.key && !rk.chips && rk.row <= 30, rk);
    await page.locator('#ruler-more').scrollIntoViewIfNeeded();
    await t.step('tap ⌗ beside the ruler', () => t.tap(page.locator('#ruler-more')));
    await t.step('tap Beat', () => t.tap(page.locator('#ruler-menu [data-snap="beat"]')));
    const snapped = await page.locator('#ruler-more-snap').innerText();
    // The pick shuts the menu, which fades out (lib/ui/menu.js) and is then gone.
    const menuShut = await page.locator('#ruler-menu').waitFor({ state: 'hidden', timeout: 2000 }).then(() => true, () => false);
    t.expect('the key says a drag snaps to beats now, and its menu has shut', snapped === 'Beat' && menuShut, { snapped, menuShut });

    // A take in the bar has a mini player of its own: no window, the strip
    // under its keys, and |◀ beside ▶ here too.
    await t.step('go to the Listening Room', () => t.tap(page.locator('.appnav a[data-tab="room"]')));
    const cassette = page.locator('#view-room .room-cassette').first();
    await cassette.waitFor({ state: 'visible' });
    await t.step('tap a take', () => t.tap(cassette));
    const heard = await t.poll(() => document.getElementById('np')?.dataset.source === 'take' && document.getElementById('np-play')?.classList.contains('playing'));
    const room = await page.evaluate(look);
    t.expect('the take plays in the mini player', heard, room);
    t.expect('|◀ sits beside ▶, a thumb wide', room.start && room.beside, room);
    t.expect('its name and ✎ are on the screen too', room.name && room.note, room);
    await t.wait(1500);
    const at = () => Number(document.getElementById('np-scrub')?.getAttribute('aria-valuenow') ?? NaN);
    const before = await page.evaluate(at);
    await t.step('tap |◀', () => t.tap(page.locator('#np-start')));
    const restarted = await t.poll((sr) => Number(document.getElementById('np-scrub')?.getAttribute('aria-valuenow')) < sr, take.sample_rate);
    t.expect('|◀ takes the take back to its start', restarted && before >= take.sample_rate, { before, after: await page.evaluate(at), rate: take.sample_rate });
    await t.step('tap ❚❚', () => t.tap(page.locator('#np-play')));
  },
};
