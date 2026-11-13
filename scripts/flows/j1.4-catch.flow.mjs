// J1.4 Catch the last pass: start a tape from a tempo, arm a track, play,
// and CATCH the pass that just went by onto the armed track, from ●'s ▾.
// docs/flows.md#j14
import { mini, pullUp, putAway } from './player.mjs';

const BPM = 120;
const BARS = 2; // a 4 s pass, so the flow waits two of them, not twenty

export default {
  id: 'J1.4',
  title: 'Set a tempo, play, CATCH the last pass onto the armed track',
  checksMenus: ['#tempo-menu', '#np-rec-menu'], // the layout checks see them open
  async run(t) {
    const { page, api } = t;
    // An empty tape, with no tempo: the Studio asks for one.
    await t.given('a fresh tape with no tempo', async () => {
      const tape = await api.post('/api/tapes', { name: 'Catch' });
      await api.post(`/api/tapes/load?id=${encodeURIComponent(tape.id)}`);
      await api.del('/api/clipboard').catch(() => {});
    });
    await t.given('10s of the jam in the feed', () => api.ringHas(10));

    await t.given('the Studio is open', () => page.goto(`${t.base}/tape.html`));
    await page.locator('#tape-empty').waitFor({ state: 'visible' });
    await t.step('set the BPM and bars', async () => {
      await page.locator('#new-bpm').fill(String(BPM));
      await page.locator('#new-bars').fill(String(BARS));
      await t.tap(page.locator('#set-tempo'));
    });
    const grid = await api.until(async () => (await api.tapeState()).grid, 'the tape to have a tempo', 8000).catch(() => null);
    // The grid is the loop in frames and bars: 4 beats a bar.
    const bpm = grid ? (grid.bars * 4 * 60 * 48000) / grid.frames : 0;
    t.expect('the tape has that tempo', grid?.bars === BARS && Math.round(bpm) === BPM, JSON.stringify(grid));
    // The tempo is on the bar's display, not in the header (whose tempo pill
    // went: css/chrome.css), and it opens the tempo's panel (lib/ui/menu.js): the
    // bar counts the loop could be, beside it; Escape shuts it and stays in
    // the Studio.
    const shown = await t.poll((bpm) => document.getElementById('np-tempo')?.textContent.includes(bpm) && document.getElementById('np-tempo').textContent, String(BPM));
    t.expect('the bar’s display reads the tempo', shown, await page.locator('#np-tempo').innerText());
    t.expect('and the header has no tempo of its own', await page.evaluate(() => !document.querySelector('.appbar #tape-sub, .appbar .tape-sub')));
    // On a phone the display is the player's, pulled up.
    const phone = await mini(page);
    if (phone) t.expect('the player comes up', await t.step('pull the player up', () => pullUp(t)));
    await t.step('tap the tempo on the bar’s display', () => t.tap(page.locator('#np-tempo')));
    const tempo = await t.poll(() => {
      const m = document.getElementById('tempo-menu');
      if (!m || m.hidden) return null;
      const b = document.getElementById('np-tempo').getBoundingClientRect();
      const r = m.getBoundingClientRect();
      // Beside its key: its left edge on the key's, over it or under it, on the screen.
      const beside = Math.abs(r.left - b.left) <= 1 && (r.bottom <= b.top + 1 || r.top >= b.bottom - 1);
      return { beside, on: r.top >= 0 && r.bottom <= innerHeight, rows: [...m.querySelectorAll('.menu-item')].map((i) => i.textContent) };
    });
    t.expect('its menu opens beside it with the bar counts, this one among them', !!tempo?.beside && tempo.on && tempo.rows.includes(`${BARS} bars at ${BPM.toFixed(1)} BPM`), tempo);
    await t.step('press Escape', () => page.keyboard.press('Escape'));
    t.expect('Escape shuts it, in the Studio', await t.poll(() => document.getElementById('tempo-menu')?.hidden && location.pathname === '/tape.html'));
    if (phone) t.expect('the player goes down', await t.step('put the player away', () => putAway(t)));

    // ● on track 2 arms it alone.
    const arm = page.locator('#lanes .tt-arm').nth(1);
    await t.step('arm track 2', () => t.tap(arm));
    const armed = await api.until(async () => (await api.tapeState()).rec_track === 2, 'track 2 armed', 5000).catch(() => false);
    t.expect('the Pi has track 2 armed', armed);

    await t.step('press ▶', () => t.tap(page.locator('#np-play')));
    const pass = (60 / BPM) * 4 * BARS;
    await t.wait(pass * 2 * 1000 + 500);

    // Catch is on ●'s ▾ since step 7a (docs/plan/the-calm-studio.md): the
    // bar has no Catch key, ▾ or menu of its own. ●'s ▾ is a key of its own
    // beside ●, as GRAB's and KEEP's are: it opens what to catch over the
    // pair, and a pick catches. On a phone the pair is the mini player's, so
    // it is there without pulling the player up.
    t.expect('the bar has no Catch key, no Catch ▾ and no Catch menu',
      await page.evaluate(() => !document.getElementById('np-catch-pass') && !document.getElementById('np-catch-more') && !document.getElementById('np-catch-menu')));
    // It goes down under the finger as a key does, in the first frame: 1 px.
    await page.evaluate(() => {
      const key = document.getElementById('np-rec-more');
      const seen = window.__morePress = { first: null };
      addEventListener('pointerdown', (e) => {
        if (seen.first !== null || !key.contains(e.target)) return;
        requestAnimationFrame(() => {
          seen.first = { transform: getComputedStyle(key).transform };
        });
      }, { capture: true });
    });
    await t.step('tap ●’s ▾', () => t.tap(page.locator('#np-rec-more')));
    const pressed = await t.poll(() => window.__morePress?.first, null, 3000);
    t.expect('●’s ▾ is down in the first frame after the touch, 1 px', /matrix\(1, 0, 0, 1, 0, 1\)/.test(pressed?.transform ?? ''), pressed);
    const readMenu = () => t.poll(() => {
      const m = document.getElementById('np-rec-menu');
      if (!m || m.hidden) return null;
      const key = document.getElementById('np-rec').getBoundingClientRect();
      const more = document.getElementById('np-rec-more').getBoundingClientRect();
      const r = m.getBoundingClientRect();
      return {
        apart: more.left >= key.right - 1 && more.width >= 44 && Math.abs(more.height - key.height) <= 1,
        over: Math.abs(r.right - more.right) <= 1 && r.bottom <= key.top && key.top - r.bottom <= 12,
        head: m.querySelector('.menu-sub')?.textContent ?? '',
        // Catch's rows come first; on a phone the phone's follow a line.
        rows: [...m.querySelectorAll('.menu-word')].map((w) => w.textContent).slice(0, 4),
      };
    });
    const cm = await readMenu();
    t.expect('●’s ▾ is a key of its own beside ●, a finger wide and as tall', cm?.apart, cm);
    t.expect('its menu opens over the pair: where it lands, then the last pass, the last 1, 2 or 4 bars', cm?.over && cm.head === 'Catch onto track 2'
      && JSON.stringify(cm.rows) === JSON.stringify(['The last pass', 'The last 1 bar', 'The last 2 bars', 'The last 4 bars']), cm);
    await t.step('tap The last pass', () => t.tap(page.locator('#np-rec-menu .menu-item', { hasText: 'The last pass' })));
    const toast = page.locator('#toasts .toast').filter({ hasText: /Caught/ }).first();
    t.expect('a "Caught the last pass → 2" toast', await toast.waitFor({ timeout: 10_000 }).then(() => true, () => false));
    const toastText = await toast.innerText().catch(() => '');
    t.expect('the toast names track 2', /(→|track)\s*2\b/i.test(toastText), toastText);
    t.expect('and the menu shuts', await page.locator('#np-rec-menu').waitFor({ state: 'hidden', timeout: 2000 }).then(() => true, () => false));
    const clips = await api.until(async () => (await api.tapeState()).tracks[1].clips, 'a clip on track 2', 8000).then((c) => c, () => []);
    const len = clips[0] ? clips[0].frames / 48000 : 0;
    t.expect('track 2 holds one pass', clips.length === 1 && Math.abs(len - pass) < 0.1,
      `track 2: ${clips.length} clip(s), ${len.toFixed(2)} s; a pass is ${pass} s`);

    await t.step('tap ●’s ▾ again', () => t.tap(page.locator('#np-rec-more')));
    await readMenu();
    await t.step('tap The last 1 bar', () => t.tap(page.locator('#np-rec-menu .menu-item', { hasText: 'The last 1 bar' })));
    const bar1 = page.locator('#toasts .toast').filter({ hasText: /Caught last 1 bar/ }).first();
    t.expect('a "Caught last 1 bar → 2" toast', await bar1.waitFor({ timeout: 10_000 }).then(() => true, () => false));
    t.expect('and the menu shuts', await page.locator('#np-rec-menu').waitFor({ state: 'hidden', timeout: 2000 }).then(() => true, () => false));
    const more = await api.until(async () => (await api.tapeState()).tracks[1].clips.length > 1, 'the bar on track 2', 8000).catch(() => false);
    t.expect('track 2 holds the bar as well', more);

    // C still catches the last pass, with no key to press (a keyboard is a
    // desktop's).
    if (t.profile.startsWith('desktop')) {
      await page.evaluate(() => document.querySelectorAll('#toasts .toast').forEach((e) => e.setAttribute('data-seen', '')));
      const before = JSON.stringify((await api.tapeState()).tracks[1].clips);
      await t.step('press C', () => page.keyboard.press('c'));
      const again = await t.poll(() => [...document.querySelectorAll('#toasts .toast:not([data-seen])')].some((e) => /Caught/.test(e.textContent)), null, 10_000);
      t.expect('C catches the last pass: a "Caught" toast', again);
      const changed = await api.until(async () => JSON.stringify((await api.tapeState()).tracks[1].clips) !== before, 'track 2 to change', 8000).catch(() => false);
      t.expect('and track 2 changed on the Pi', changed);
    }

    await t.step('press ▶ again to stop', () => t.tap(page.locator('#np-play')));
  },
};
