// E1 A live 4-track: with a jam in the feed, turn the Studio to the feed's
// face, tap the ribbon where the jam began (the mark), GRAB from the mark onto
// the cue lane, DROP it on the armed track, loop it, press play, arm another
// track and CATCH a pass over it. One of Gabe's two journeys, end to end
// (docs/plan/the-calm-studio.md, "How Gabe uses the Studio": "a kind of live 4
// track experience").
// docs/flows.md#e1
//
// `todo` until the two faces are built (the-calm-studio.md, step 5). The
// contract the build follows, which this flow presses:
//  - main#view-studio carries data-face="tape" or "feed" (absent: the tape's).
//  - In the tape's face the feed is a thin strip whose key is #face-feed (a
//    tap turns to the feed's face); in the feed's face the tape is a thin
//    strip whose key is #face-tape.
//  - On the feed's face the ribbon (#viz-wrap), GRAB and KEEP (#studio-keep)
//    work as they do today.
//  - A GRAB on the feed's face does not turn the Studio: the cue lane and its
//    drawer are on both faces. The flow turns back with #face-tape before it
//    works on the lanes.
import { mini, pullUp, putAway } from './player.mjs';

// The number of presses the journey takes: every tap, hold and drag after the
// Givens. It only goes down (the-calm-studio.md, "How it stays calm"): the day
// a change makes the journey shorter, lower it; if a change makes it longer,
// the change is wrong, not this number.
const PRESSES_MAX = 10;
// On a phone the Loop and Catch keys are in the player pulled up, and the
// lanes under it: each costs a press to pull up and one to put away.
const PLAYER_PRESSES = 2;

const parts = (s) => (s.tracks ?? []).reduce((n, tr) => n + (tr.clips?.length ?? 0), 0);

export default {
  id: 'E1',
  title: 'A live 4-track: mark the jam, GRAB, DROP, loop, play, CATCH over it',
  status: 'todo', // the faces are not built
  async run(t) {
    const { page, api } = t;
    let presses = 0;
    // A press is one thing the user does after the Givens, counted as it is done.
    const press = (name, fn) => t.step(name, async () => { presses++; return fn(); });
    const tapKey = (name, locator) => press(name, () => t.tap(locator));

    await t.given('a fresh 4-bar tape at 96 BPM, with the loop off', async () => {
      const made = await api.tape('Live four-track');
      await api.patch(`/api/tapes?id=${encodeURIComponent(made.id)}`, { loop: { ...(await api.tapeState()).loop, on: false } });
      return made;
    });
    await t.given('25s of the jam in the feed', () => api.ringHas(25));
    await t.given('no flags on the feed', () => api.del('/api/flag?all=1'));
    await t.given('the Studio is open', () => page.goto(`${t.base}/tape.html`));
    await page.locator('#viz-wrap').waitFor({ state: 'visible' });
    const state0 = await api.tapeState();
    const secs = (frames) => frames / 48000;
    const face = () => page.evaluate(() => document.getElementById('view-studio')?.dataset.face ?? 'tape');
    t.expect('the Studio starts on the tape’s face', (await face()) === 'tape');

    await tapKey('tap the feed’s strip, to turn to the feed', page.locator('#face-feed'));
    t.expect('the Studio is on the feed’s face', await t.poll(() => document.getElementById('view-studio')?.dataset.face === 'feed', null, 3000), await face());
    const ribbon = page.locator('#viz-wrap');
    await ribbon.waitFor({ state: 'visible' });
    await t.poll(() => document.querySelector('#viz-wrap .rb-tick'), null, 8000); // drawn

    // The mark: a tap says "from here" (J1.3).
    await press('tap the ribbon where the jam began', async () => {
      const box = await ribbon.boundingBox();
      const x = box.x + box.width * 0.45, y = box.y + box.height / 2;
      return t.profile.startsWith('desktop') ? page.mouse.click(x, y) : page.touchscreen.tap(x, y);
    });
    t.expect('the mark is on the ribbon', await t.poll(() => !!document.querySelector('#viz-wrap .rb-mark-clear:not([hidden])')));
    t.expect('GRAB says it grabs from the mark', await t.poll(() => /mark/.test(document.querySelector('.buffer-grab')?.textContent || '')), await page.locator('.buffer-grab').innerText());

    await tapKey('tap GRAB', page.locator('.buffer-grab-key').first());
    const clip = await api.until(async () => (await api.tapeState()).cue?.clips?.at(-1), 'the grab on the cue lane', 8000).catch(() => null);
    t.expect('the cue lane holds the jam from the mark', !!clip && secs(clip.frames) > 1, clip);
    t.expect('its drawer opens', await t.poll(() => !document.getElementById('buffer')?.hidden, null, 8000));
    t.expect('GRAB did not turn the Studio', (await face()) === 'feed', await face());

    await tapKey('tap the tape’s strip, to turn back to the tape', page.locator('#face-tape'));
    t.expect('the Studio is on the tape’s face, the drawer still open', await t.poll(() => (document.getElementById('view-studio')?.dataset.face ?? 'tape') === 'tape'
      && !document.getElementById('buffer')?.hidden, null, 3000), await face());

    const armed = (await api.tapeState()).rec_track;
    await t.poll(() => /track \d/i.test(document.getElementById('buffer-drop')?.textContent ?? ''), null, 8000);
    await tapKey('tap DROP', page.locator('#buffer-drop'));
    const landed = await api.until(async () => parts(await api.tapeState()) === 1, 'a part on the tape', 8000).catch(() => false);
    const placed = (await api.tapeState()).tracks[armed - 1]?.clips ?? [];
    t.expect('the part is on the armed track', landed && placed.length === 1, { armed, clips: placed });

    // On a phone the bar's keys beyond ▶ are in the player pulled up.
    const withPlayer = async (fn) => {
      const phone = await mini(page);
      if (phone) await press('pull the player up', () => pullUp(t));
      await fn();
      if (phone) await press('put the player away', () => putAway(t));
    };
    await withPlayer(() => tapKey('tap Loop', page.locator('#np-loop')));
    t.expect('the tape loops', await api.until(async () => (await api.tapeState()).loop.on === true, 'the loop on', 5000).catch(() => false), (await api.tapeState()).loop);

    // Play it, then arm another track and catch a pass over it.
    await tapKey('press ▶', page.locator('#np-play'));
    const other = armed === 2 ? 3 : 2;
    await tapKey(`arm track ${other}`, page.locator('#lanes .tt-arm').nth(other - 1));
    t.expect(`the Pi has track ${other} armed`, await api.until(async () => (await api.tapeState()).rec_track === other, 'the other track armed', 5000).catch(() => false));
    const pass = state0.grid.frames / 48000; // the loop, in seconds (the tape's rate)
    await t.wait(pass * 1000 + 1500); // a pass has gone round, over the part
    await withPlayer(() => tapKey('tap Catch', page.locator('#np-catch-pass')));
    const toast = page.locator('#toasts .toast').filter({ hasText: /Caught/ }).first();
    t.expect('a "Caught" toast', await toast.waitFor({ timeout: 10_000 }).then(() => true, () => false));
    const over = await api.until(async () => ((await api.tapeState()).tracks[other - 1]?.clips ?? []).length === 1, `a pass on track ${other}`, 8000).catch(() => false);
    t.expect(`track ${other} holds the pass played over the part`, over && parts(await api.tapeState()) === 2, (await api.tapeState()).tracks.map((tr) => tr.clips.length));
    await press('press ▶ again to stop', () => t.tap(page.locator('#np-play')));

    const max = PRESSES_MAX + (await mini(page) ? 2 * PLAYER_PRESSES : 0);
    t.expect(`the journey took ${presses} presses`, presses <= max, `${presses} presses, more than the ${max} it may take`);
  },
};
