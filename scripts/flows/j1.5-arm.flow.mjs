// J1.5 Multi-arm by cables: a tap on ● arms that track alone, a hold adds
// it (or takes it off), Catch names where it lands, and a track's input chip
// or its inspector picks what it records from. The chip's menu opens by it
// (lib/ui/menu.js), and from a keyboard on the input chosen. Another
// track's mute: on a touch screen in its inspector, which › opens; with a
// mouse M in its head.
// docs/flows.md#j15
// Ported from the retired scripts/smoke-tape.mjs ("Recording on the track"). The flow
// makes its own tape, so the arms and inputs it changes are that tape's.

// The Pi's armed tracks: rec_tracks, or the one rec_track an older tape has.
const armed = (tape) => (tape.rec_tracks?.length ? tape.rec_tracks : (tape.rec_track > 0 ? [tape.rec_track] : []));
const same = (a, b) => [...a].sort().join() === [...b].sort().join();

export default {
  id: 'J1.5',
  title: '● arms one track; a hold adds another',
  checksMenus: ['#input-menu'], // the layout checks see it open
  async run(t) {
    const { page, api } = t;
    const tape = await t.given('a fresh tape', () => api.tape('Arm'));
    const full = async () => api.get(`/api/tapes/state?id=${encodeURIComponent(tape.id)}`);
    const lit = () => page.evaluate(() => [...document.querySelectorAll('.tt-arm')].map((b) => b.getAttribute('aria-pressed') === 'true'));
    const arm = (i) => page.locator('.tt-arm').nth(i);

    await t.given('the Studio is open', () => page.goto(`${t.base}/tape.html`));
    await arm(3).waitFor({ state: 'visible' });

    await t.step('tap track 3’s ●', () => t.tap(arm(2)));
    const three = await api.until(async () => same(armed(await api.tapeState()), [3]), 'track 3 armed', 5000).catch(() => false);
    t.expect('a tap arms track 3 alone, on the Pi', three, armed(await api.tapeState()));
    t.expect('its ● is lit, and only its', (await t.poll(() => [...document.querySelectorAll('.tt-arm')].map((b) => b.getAttribute('aria-pressed')).join() === 'false,false,true,false')),
      (await lit()).join());

    await t.step('hold track 1’s ●', () => t.hold(arm(0)));
    const both = await api.until(async () => same(armed(await api.tapeState()), [1, 3]), 'tracks 1 and 3 armed', 5000).catch(() => false);
    t.expect('a hold arms track 1 as well, on the Pi', both, armed(await api.tapeState()));
    t.expect('both ● are lit', await t.poll(() => [...document.querySelectorAll('.tt-arm')].map((b) => b.getAttribute('aria-pressed')).join() === 'true,false,true,false'),
      (await lit()).join());

    // A waiting Catch says what it waits for ("press ▶"); it names the tracks
    // once a pass has gone round (4 bars at 96 BPM, about 10 s).
    await t.step('play a pass', () => t.tap(page.locator('#np-play')));
    const ready = await t.poll(() => !document.getElementById('catch-pass')?.classList.contains('waits'), null, 25_000);
    const says = (await page.locator('#catch-pass .np-catch-sub').innerText()).replace(/\s+/g, ' ');
    t.expect('Catch names both armed tracks', ready && /\b1\b/.test(says) && /\b3\b/.test(says), `ready=${ready} "${says}"`);
    await t.step('stop', () => t.tap(page.locator('#np-play')));

    await t.step('hold track 1’s ● again', () => t.hold(arm(0)));
    const back = await api.until(async () => same(armed(await api.tapeState()), [3]), 'track 1 taken off', 5000).catch(() => false);
    t.expect('a second hold takes track 1 off, leaving 3', back, armed(await api.tapeState()));

    // Another track's input: its chip opens a menu of the inputs, and arms
    // nothing.
    const { sources = [] } = await full();
    const names = sources.map((s) => s.name).filter(Boolean);
    t.expect('the Pi offers inputs', names.length > 0, sources);
    if (!names.length) return;
    // On a laptop's height track 4 is under the bar: scroll to it first, as
    // a person would, and let the scroll land (the menu follows its chip, but
    // the tap should land where the chip is).
    await page.locator('.tt-in').nth(3).scrollIntoViewIfNeeded();
    await t.wait(300);
    await t.step('tap track 4’s input', () => t.tap(page.locator('.tt-in').nth(3)));
    t.expect('the input menu opens for track 4, not the inspector', await t.poll(() => !document.getElementById('input-menu')?.hidden
      && !document.getElementById('track-sheet')?.open
      && /Track 4/.test(document.querySelector('#input-menu .menu-head')?.textContent ?? '')));
    const beside = await page.evaluate(() => {
      const c = document.querySelectorAll('.tt-in')[3].getBoundingClientRect();
      const m = document.getElementById('input-menu').getBoundingClientRect();
      const np = document.getElementById('np').getBoundingClientRect();
      return { left: Math.round(m.left - c.left), under: m.top >= c.bottom, over: m.bottom <= c.top, clear: !np.height || m.bottom <= np.top + 1, chip: document.querySelectorAll('.tt-in')[3].getAttribute('aria-expanded') };
    });
    t.expect('it opens by the chip, its left edge on the chip’s, clear of the bar', Math.abs(beside.left) <= 1 && (beside.under || beside.over) && beside.clear && beside.chip === 'true', beside);
    const was = (await api.tapeState()).inputs ?? [];
    const pick4 = names.find((n) => n !== (was[3] || '')) ?? names[0];
    await t.step(`choose ${pick4}`, () => t.tap(page.locator(`#input-menu button[data-name="${pick4}"]`)));
    const given = await api.until(async () => ((await api.tapeState()).inputs ?? [])[3] === pick4, 'track 4’s input', 5000).catch(() => false);
    t.expect('track 4 records from it, on the Pi', given, (await api.tapeState()).inputs);
    t.expect('track 4 stays unarmed and its chip names the input', same(armed(await api.tapeState()), [3])
      && await t.poll((n) => document.querySelectorAll('.tt-in-v')[3]?.textContent === n && document.getElementById('input-menu').hidden, pick4));

    // From a keyboard: ↓ on the chip opens its menu on the input the track
    // records from, without arming another track; Escape shuts it, back on
    // the chip.
    await t.step('focus track 4’s input and press ↓', async () => {
      await page.locator('.tt-in').nth(3).focus();
      await page.keyboard.press('ArrowDown');
    });
    t.expect('the menu opens with the keyboard on the input chosen', await t.poll((n) => !document.getElementById('input-menu').hidden
      && document.activeElement?.dataset.name === n && document.activeElement.getAttribute('aria-checked') === 'true', pick4),
    await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 120)));
    await page.waitForTimeout(600); // an arm would be on its way to the Pi by now
    t.expect('and the record track stays track 3', same(armed(await api.tapeState()), [3]), armed(await api.tapeState()));
    await t.step('press Escape', () => page.keyboard.press('Escape'));
    t.expect('Escape shuts it, back on the chip', await t.poll(() => document.getElementById('input-menu').hidden
      && document.activeElement === document.querySelectorAll('.tt-in')[3]));

    // The record track's inspector: its name, tapped twice.
    await t.step('open track 3’s inspector', async () => {
      await t.tap(page.locator('.tt-name').nth(2));
      await t.wait(300);
      await t.tap(page.locator('.tt-name').nth(2));
    });
    t.expect('the inspector opens', await t.poll(() => document.getElementById('track-sheet')?.open));
    const pick3 = names.find((n) => n !== (was[2] || '')) ?? names[0];
    await t.step(`choose ${pick3} in it`, () => t.tap(page.locator(`#sources button[data-name="${pick3}"]`)));
    const given3 = await api.until(async () => ((await api.tapeState()).inputs ?? [])[2] === pick3, 'track 3’s input', 5000).catch(() => false);
    t.expect('track 3 records from it, on the Pi', given3, (await api.tapeState()).inputs);
    await t.step('press Escape', () => page.keyboard.press('Escape'));
    t.expect('the inspector closes', await t.poll(() => !document.getElementById('track-sheet').open));

    // Another track's mute, with track 3 armed. On a touch screen M, S and
    // the level are in the inspector, and › at the head's end opens it in
    // one tap, on that track, moving no arm; with a mouse they're in the
    // head, and there's no ›.
    const muted = async () => !!(await api.tapeState()).tracks[1].mute;
    if (t.profile === 'desktop') {
      const head = await page.evaluate(() => {
        const row = document.querySelectorAll('#lanes .tt-head')[1];
        const on = (sel) => !!row.querySelector(sel)?.getClientRects().length;
        return { mute: on('.tt-mute'), solo: on('.tt-solo'), gain: on('.tt-gain'), more: on('.tt-more') };
      });
      t.expect('with a mouse the head has M, S and the level, and no ›', head.mute && head.solo && head.gain && !head.more, head);
      await t.step('click track 2’s M', () => page.locator('#lanes .tt-mute').nth(1).click());
      t.expect('track 2 is muted, on the Pi', await api.until(muted, 'track 2 muted', 5000).catch(() => false));
      await t.step('click it again', () => page.locator('#lanes .tt-mute').nth(1).click());
      t.expect('track 2 is heard again, on the Pi', await api.until(async () => !(await muted()), 'track 2 heard', 5000).catch(() => false));
      return;
    }
    const head = await page.evaluate(() => {
      const row = document.querySelectorAll('#lanes .tt-head')[1];
      const on = (sel) => !!row.querySelector(sel)?.getClientRects().length;
      const arm = row.querySelector('.tt-arm').getBoundingClientRect();
      return { mute: on('.tt-mute'), solo: on('.tt-solo'), gain: on('.tt-gain'), more: on('.tt-more'), arm: Math.round(Math.min(arm.width, arm.height)) };
    });
    t.expect('on a touch screen the head has ● a finger wide and ›, and no M, S or level', !head.mute && !head.solo && !head.gain && head.more && head.arm >= 44, head);
    await t.step('tap track 2’s ›', () => t.tap(page.locator('#lanes .tt-more').nth(1)));
    const onTwo = () => document.getElementById('track-sheet').open && /^Track 2\b/.test(document.getElementById('track-title').textContent);
    const opened = await t.poll(onTwo);
    await t.wait(600); // a poll or two: it once went back to the record track
    t.expect('track 2’s inspector opens, and stays on it', opened && await page.evaluate(onTwo),
      await page.evaluate(() => document.getElementById('track-title').textContent));
    t.expect('and the record track stays track 3', same(armed(await api.tapeState()), [3]), armed(await api.tapeState()));
    await t.step('tap Mute in it', () => t.tap(page.locator('#track-mute')));
    t.expect('track 2 is muted, on the Pi', await api.until(muted, 'track 2 muted', 5000).catch(() => false));
    t.expect('its Mute and its › are lit', await t.poll(() => document.getElementById('track-mute').getAttribute('aria-pressed') === 'true'
      && document.querySelectorAll('#lanes .tt-more')[1].dataset.heard === 'mute'));
    await t.step('tap Mute again', () => t.tap(page.locator('#track-mute')));
    t.expect('track 2 is heard again, its › unlit', await api.until(async () => !(await muted()), 'track 2 heard', 5000).catch(() => false)
      && await t.poll(() => !document.querySelectorAll('#lanes .tt-more')[1].dataset.heard));
    await t.step('press Escape', () => page.keyboard.press('Escape'));
    t.expect('the inspector closes', await t.poll(() => !document.getElementById('track-sheet').open));
  },
};
