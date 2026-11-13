// J1.20 Set the tempo with audio down: the tempo on the bar's display opens
// its panel, where I type a tempo, nudge it a BPM with +1 and −1, or TAP
// it; the bar lines move to it and the part on track 1 and the loop stay
// where they were (a re-grid: docs/decisions/0062). docs/flows.md#j120

import { mini, pullUp, putAway } from './player.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bpmOf = (g) => (g ? (g.bars * 4 * 60 * 48000) / g.frames : 0);
const near = (a, b) => Math.abs(a - b) < 0.05;

export default {
  id: 'J1.20',
  title: 'Set the tempo with audio down',
  checksMenus: ['#tempo-menu'],
  async run(t) {
    const { page, api } = t;
    const tape = await t.given('a fresh tape at 96 BPM', () => api.tape('Tempo', 96, 4));
    // A take already on the shelf (a long one), else one kept: every kept take
    // stays in the run's library, and the List's flows read how long it is.
    const take = await t.given('a take on the shelf', async () => (await api.takes()).find((x) => x.duration_seconds >= 12 && x.has_peaks) || api.keep(20));
    const st = await api.tapeState();
    const bar = st.grid.frames / st.grid.bars;
    const dropped = await t.given('4 bars of it on track 1', () => api.post(`/api/tapes/drop?id=${encodeURIComponent(tape.id)}`,
      { take: take.name, from: 0, to: Math.round(4 * bar), track: 1, at: st.loop.in }));
    t.expect('the tape has a part on track 1', dropped?.clip, dropped);
    if (!dropped?.clip) return;
    const before = await api.tapeState();
    const clip = JSON.stringify(before.tracks[0].clips);
    const loop = JSON.stringify(before.loop);

    await t.given('the Studio is open', () => page.goto(`${t.base}/tape.html`));
    // On a phone the tempo is in the player pulled up, not on the mini player.
    const phone = await mini(page);
    if (phone) t.expect('the player comes up', await t.step('pull the player up', () => pullUp(t)));
    // The display has one key for the tempo and where it plays (step 7b): its
    // value and legend say both, and the output's key of its own is gone. In
    // a phone's player pulled up the foot says where it plays, so the key
    // there is the tempo alone.
    await t.poll(() => /96/.test(document.getElementById('np-tempo')?.textContent ?? ''));
    const key = await page.locator('#np-tempo').innerText();
    if (phone) {
      const foot = await page.locator('#np-out-foot').innerText();
      t.expect('the tempo’s key says the tempo alone, and the foot where it plays', /96/.test(key) && !/JAM ROOM/i.test(key) && /JAM ROOM/i.test(foot), { key, foot });
    } else t.expect('the tempo’s key says the tempo and where it plays', /96/.test(key) && /JAM ROOM/i.test(key), key);
    t.expect('and its label says both to a screen reader', await page.evaluate(() => { const l = document.getElementById('np-tempo')?.getAttribute('aria-label') ?? ''; return /96/.test(l) && /jam room/i.test(l); }),
      await page.locator('#np-tempo').getAttribute('aria-label'));
    t.expect('the bar has no key for the output of its own', await page.evaluate(() => !document.getElementById('np-output')));
    await t.step('tap the tempo on the bar’s display', () => t.tap(page.locator('#np-tempo')));
    const field = page.locator('#tempo-bpm');
    t.expect('its panel opens with the tempo to type', await t.poll(() => {
      const f = document.getElementById('tempo-bpm');
      return f && !document.getElementById('tempo-menu').hidden && f.value;
    }) === '96', await field.inputValue().catch(() => null));

    await t.step('press +1', () => t.tap(page.locator('#tempo-up')));
    let g = await api.until(async () => { const s = await api.tapeState(); return near(bpmOf(s.grid), 97) && s.grid; }, 'the tape at 97', 5000).catch(() => null);
    t.expect('+1 makes it 97 BPM', !!g, g);

    await t.step('type 92', async () => {
      await field.fill('92');
      await field.press('Enter');
    });
    g = await api.until(async () => { const s = await api.tapeState(); return near(bpmOf(s.grid), 92) && s.grid; }, 'the tape at 92', 5000).catch(() => null);
    t.expect('the tape is at 92 BPM', !!g, g);

    await t.step('TAP four times, half a second apart', async () => {
      for (let i = 0; i < 4; i++) {
        await t.tap(page.locator('#tempo-tap'));
        if (i < 3) await sleep(500);
      }
    });
    const tapped = await api.until(async () => { const s = await api.tapeState(); const b = bpmOf(s.grid); return b > 100 && b < 140 && b; }, 'a tapped tempo', 5000).catch(() => null);
    t.expect('the taps set a tempo near 120', !!tapped, { tapped });
    t.expect('the bar’s display reads it', await t.poll((b) => document.getElementById('np-tempo')?.textContent.includes(String(Math.floor(Math.round(b * 10) / 10))), tapped || 0));

    const after = await api.tapeState();
    t.expect('the part on track 1 has not moved or changed', JSON.stringify(after.tracks[0].clips) === clip, { before: clip, after: after.tracks[0].clips });
    t.expect('the loop has not moved', JSON.stringify(after.loop) === loop, { before: loop, after: after.loop });

    // The click is a switch in this panel (the bar has no key for it, step
    // 7a): it flips what the Pi has, and says so by aria-pressed.
    const clickOn = async () => !!(await api.tapeState()).click;
    const was = await clickOn();
    await t.step('tap Click', () => t.tap(page.locator('#tempo-click')));
    t.expect('Click flips, on the Pi and on its switch', await api.until(async () => (await clickOn()) === !was, 'the click to flip', 5000).catch(() => false)
      && await t.poll((on) => document.getElementById('tempo-click')?.getAttribute('aria-pressed') === String(on), !was), { was, now: await clickOn() });
    await t.step('tap Click again', () => t.tap(page.locator('#tempo-click')));
    t.expect('and flips back', await api.until(async () => (await clickOn()) === was, 'the click to flip back', 5000).catch(() => false)
      && await t.poll((on) => document.getElementById('tempo-click')?.getAttribute('aria-pressed') === String(on), was), { was, now: await clickOn() });
    // Its lamp says so in the panel: no toast for a tap there.
    const clickToasts = () => [...document.querySelectorAll('#toasts .toast')].map((e) => e.textContent.trim()).filter((w) => /^Click (on|off)$/.test(w));
    t.expect('a tap on the switch in the open panel says nothing in a toast', (await page.evaluate(clickToasts)).length === 0, await page.evaluate(clickToasts));

    // Where it plays is the panel's last row, under a line: a tap on it shuts
    // the panel and opens the Output sheet (the jam room is where it plays).
    const last = await page.evaluate(() => {
      const m = document.getElementById('tempo-menu');
      const kids = m ? [...m.querySelectorAll('.menu-item, [role="separator"]')] : [];
      const out = document.getElementById('tempo-out');
      const at = kids.indexOf(out);
      return { id: kids.at(-1)?.id ?? null, text: out?.textContent.trim() ?? null, afterLine: at > 0 && kids[at - 1].getAttribute('role') === 'separator' };
    });
    t.expect('the panel’s last row is where it plays, under a line', last.id === 'tempo-out' && last.afterLine, last);
    t.expect('and it says the tape plays in the jam room', /jam room/i.test(last.text ?? ''), last);
    await t.step('tap where it plays', () => t.tap(page.locator('#tempo-out')));
    t.expect('the panel shuts', await t.poll(() => document.getElementById('tempo-menu')?.hidden));
    t.expect('and the Output sheet opens', await t.poll(() => document.getElementById('out-sheet')?.open));
    await t.step('press Done on the Output sheet', () => t.tap(page.locator('#out-close')));
    t.expect('the sheet closes', await t.poll(() => !document.getElementById('out-sheet')?.open));
    // The panel again, for Escape and M below.
    await t.step('tap the tempo again', () => t.tap(page.locator('#np-tempo')));
    t.expect('its panel opens again', await t.poll(() => document.getElementById('tempo-menu') && !document.getElementById('tempo-menu').hidden));
    await t.step('press Escape', () => page.keyboard.press('Escape'));
    t.expect('Escape shuts the panel', await t.poll(() => document.getElementById('tempo-menu')?.hidden));
    // M still turns it, from the keyboard (a desktop's), and with the panel
    // shut, where its lamp isn't, a toast says which way it went.
    if (t.profile.startsWith('desktop')) {
      const said = (word) => page.locator('#toasts .toast').filter({ hasText: new RegExp(`^\\s*${word}\\s*$`) }).first().waitFor({ timeout: 3000 }).then(() => true, () => false);
      const word = (on) => (on ? 'Click on' : 'Click off');
      await t.step('press M', () => page.keyboard.press('m'));
      t.expect('M turns the click, on the Pi', await api.until(async () => (await clickOn()) === !was, 'the click to flip by M', 5000).catch(() => false));
      t.expect(`a toast says “${word(!was)}”`, await said(word(!was)));
      await t.step('press M again', () => page.keyboard.press('m'));
      t.expect('and back', await api.until(async () => (await clickOn()) === was, 'the click to flip back by M', 5000).catch(() => false));
      t.expect(`a toast says “${word(was)}”`, await said(word(was)));
    }
    if (phone) t.expect('the player goes down', await t.step('put the player away', () => putAway(t)));
  },
};
