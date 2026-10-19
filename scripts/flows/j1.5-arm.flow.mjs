// J1.5 Multi-arm by cables: a tap on ● arms that track alone, a hold adds
// it (or takes it off), Catch names where it lands, and a track's input chip
// or its inspector picks what it records from. docs/flows.md#j15
// Ported from the retired scripts/smoke-tape.mjs ("Recording on the track"). The flow
// makes its own tape, so the arms and inputs it changes are that tape's.

// The Pi's armed tracks: rec_tracks, or the one rec_track an older tape has.
const armed = (tape) => (tape.rec_tracks?.length ? tape.rec_tracks : (tape.rec_track > 0 ? [tape.rec_track] : []));
const same = (a, b) => [...a].sort().join() === [...b].sort().join();

export default {
  id: 'J1.5',
  title: '● arms one track; a hold adds another',
  async run(t) {
    const { page, api } = t;
    const tape = await api.tape('Arm');
    const full = async () => api.get(`/api/tapes/state?id=${encodeURIComponent(tape.id)}`);
    const lit = () => page.evaluate(() => [...document.querySelectorAll('.tt-arm')].map((b) => b.getAttribute('aria-pressed') === 'true'));
    const arm = (i) => page.locator('.tt-arm').nth(i);

    await page.goto(`${t.base}/tape.html`);
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
    // a person would, and let the scroll land. The menu closes when the page
    // scrolls under it, and a scroll the tap itself made can land after the
    // menu opened.
    await page.locator('.tt-in').nth(3).scrollIntoViewIfNeeded();
    await t.wait(300);
    await t.step('tap track 4’s input', () => t.tap(page.locator('.tt-in').nth(3)));
    t.expect('the input menu opens for track 4, not the inspector', await t.poll(() => !document.getElementById('input-menu')?.hidden
      && !document.getElementById('track-sheet')?.open
      && /Track 4/.test(document.querySelector('#input-menu .menu-head')?.textContent ?? '')));
    const was = (await api.tapeState()).inputs ?? [];
    const pick4 = names.find((n) => n !== (was[3] || '')) ?? names[0];
    await t.step(`choose ${pick4}`, () => t.tap(page.locator(`#input-menu button[data-name="${pick4}"]`)));
    const given = await api.until(async () => ((await api.tapeState()).inputs ?? [])[3] === pick4, 'track 4’s input', 5000).catch(() => false);
    t.expect('track 4 records from it, on the Pi', given, (await api.tapeState()).inputs);
    t.expect('track 4 stays unarmed and its chip names the input', same(armed(await api.tapeState()), [3])
      && await t.poll((n) => document.querySelectorAll('.tt-in-v')[3]?.textContent === n && document.getElementById('input-menu').hidden, pick4));

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
    await page.keyboard.press('Escape');
  },
};
