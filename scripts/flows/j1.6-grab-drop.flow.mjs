// J1.6 Lift a moment: GRAB the last bars of the jam onto the cue lane, its
// drawer open above the bar, then DROP them on the armed track. How many bars is on GRAB's ▾, whose bars
// open under it (lib/ui/menu.js splitKey). The drawer opens small, and Trim
// opens the rest in the order Gabe reaches for it (docs/plan/the-calm-studio.md,
// step 6a).
// docs/flows.md#j16
const parts = (s) => (s.tracks ?? []).reduce((n, tr) => n + (tr.clips?.length ?? 0), 0);

// In the page: the drawer's keys a person can see, in the order they are in it.
function shownKeys() {
  return [...document.querySelectorAll('#buffer button')]
    .filter((k) => k.getClientRects().length && getComputedStyle(k).visibility !== 'hidden')
    .map((k) => k.id || [...k.classList].find((c) => c.startsWith('buffer-')));
}

// In the page: Trim's order as a person reads it (the-calm-studio.md, step
// 6a), by where each part is, top to bottom and then left to right: under
// DROP, Audition, Repeat, Reverse and the fades (`first`: one row, but on a
// phone two); then IN, OUT, the gain, Normalize, the inputs and last To the
// shelf (`rest`). `short` names the keys under a finger's 44 px. Null until
// they are all laid out.
function trimOrder() {
  const box = (id) => document.getElementById(id)?.getBoundingClientRect();
  const drop = box('buffer-drop');
  const play = ['buffer-audition', 'buffer-repeat', 'buffer-reverse', 'buffer-fades'].map(box);
  const rest = ['buffer-in-back', 'buffer-out-back', 'buffer-gain', 'buffer-normalize', 'buffer-sources', 'buffer-keep'].map(box);
  if (![drop, ...play, ...rest].every((r) => r && r.width > 0 && r.height > 0)) return null;
  const mid = (r) => (r.top + r.bottom) / 2;
  const before = (a, b) => mid(a) < mid(b) - 4 || (Math.abs(mid(a) - mid(b)) <= 4 && a.left < b.left);
  const inOrder = (rs) => rs.every((r, i) => !i || before(rs[i - 1], r));
  const phone = innerWidth < 700;
  const oneRow = play.every((r) => Math.abs(mid(r) - mid(play[0])) <= 4);
  const keys = [...document.querySelectorAll('#buffer button')].filter((k) => k.getClientRects().length && getComputedStyle(k).visibility !== 'hidden');
  return {
    first: play[0].top >= drop.bottom - 1 && inOrder(play) && (phone || oneRow),
    rest: inOrder([play.at(-1), ...rest]) && keys.at(-1)?.id === 'buffer-keep',
    short: keys.filter((k) => k.getBoundingClientRect().height < 44 && !k.classList.contains('buffer-sheet-grip')).map((k) => k.id || k.className),
  };
}

export default {
  id: 'J1.6',
  title: 'GRAB the last bars, DROP them on a track',
  async run(t) {
    const { page, api } = t;
    await t.given('a fresh tape', () => api.tape('Grab and drop'));
    await t.given('15s of the jam in the feed', () => api.ringHas(15));
    const before = parts(await api.tapeState());

    await t.given('the Studio is open', () => page.goto(`${t.base}/tape.html`));
    const grab = page.locator('.buffer-grab-key').first();
    await grab.waitFor({ state: 'visible' });
    await t.step('GRAB’s ▾', () => t.tap(page.locator('.buffer-grab-more')));
    // The bars once opened about 370 px left of the finger: the inputs' row
    // makes the panel wide, and the bars sat at its far end. On a phone the
    // panel is wider than the room left of the ▾, so it spans the screen
    // under it instead, and its bars cross the finger's line. By the device,
    // not the page's shape: a tablet in the phone's shape is the regression.
    const phone = t.profile === 'phone';
    const where = await page.evaluate(() => {
      const r = (sel) => document.querySelector(sel).getBoundingClientRect();
      const more = r('.buffer-grab-more'), pop = r('.buffer-grab-pop'), bars = r('.buffer-grab-pop .buffer-bars');
      return {
        pop: Math.round(pop.right - more.right), bars: Math.round(more.right - bars.right), under: Math.round(pop.top - more.bottom),
        on: pop.left >= 0 && pop.right <= innerWidth, across: bars.left <= more.right && bars.right >= more.left,
      };
    });
    t.expect(phone ? 'its bars open under the ▾, across the finger’s line, the panel on the screen'
      : 'its bars open under the ▾, by the finger, the panel’s right edge on the ▾’s',
    where.under >= 0 && where.under <= 12 && (phone
      ? where.on && where.across
      : Math.abs(where.pop) <= 2 && where.bars >= 0 && where.bars <= 60), where);
    await t.step('tap 2 bars', () => t.tap(page.locator('.buffer-grab-pop .buffer-bars button[data-n="2"]')));
    t.expect('GRAB says it takes 2 bars, from the armed track’s input', await t.poll(() => {
      const k = document.querySelector('.buffer-grab-key')?.textContent ?? '';
      return /2 bars/i.test(k) && /armed/.test(k);
    }), await grab.innerText());
    await t.step('tap GRAB', () => t.tap(grab));
    t.expect('the panel shuts', await t.poll(() => document.querySelector('.buffer-grab-pop')?.hidden));
    const grabbed = await api.until(async () => (await api.tapeState()).cue?.clips?.[0]?.grab, 'the grab on the cue lane', 8000).catch(() => null);
    t.expect('the Pi grabbed 2 bars onto the cue lane', grabbed?.bars === 2, grabbed);
    t.expect('its drawer opens above the bar', await t.poll(() => {
      const d = document.getElementById('buffer');
      return d && !d.hidden && d.parentElement?.id === 'np-dock';
    }, null, 8000));
    // DROP is pressed seeing where it lands: every track is above the drawer.
    // On a phone the drawer is a sheet over the foot of the page, docked
    // above the mini player: it brings the cue lane and the armed track into
    // sight above it, under the header, and the rest are a scroll away.
    if (!phone) {
      t.expect('the tracks are above the drawer, none under the bar', await t.poll(() => {
        const top = document.getElementById('buffer').getBoundingClientRect().top;
        const rows = [...document.querySelectorAll('#lanes > .tape-track')];
        return rows.length > 0 && rows.every((r) => { const b = r.getBoundingClientRect(); return b.height > 0 && b.bottom <= top + 1; });
      }, null, 3000));
      // The drawer opens small, so the lanes aren't strips: each is a finger
      // tall (docs/plan/the-calm-studio.md, decision 2).
      t.expect('each track is a finger tall: the drawer opens small', await t.poll(() =>
        [...document.querySelectorAll('#lanes > .tape-track')].every((r) => r.getBoundingClientRect().height >= 44), null, 3000),
      await page.evaluate(() => [...document.querySelectorAll('#lanes > .tape-track')].map((r) => Math.round(r.getBoundingClientRect().height)).join(' ')));
      // Small, it is the clip, DROP, Trim, Toss and ✕ (the calm Studio,
      // decision 6): KEEP is the feed's word, and the rest is Trim's.
      const small = await page.evaluate(shownKeys);
      t.expect('the small panel is the clip, DROP, Trim, Toss and ✕', small.join(' ') === 'buffer-grip buffer-drop buffer-trim buffer-toss buffer-close', small);
      await t.step('tap Trim', () => t.tap(page.locator('#buffer-trim')));
      const trim = await t.poll(trimOrder, null, 3000);
      t.expect('Trim opens on Audition, Repeat, Reverse and the fades, in a row under the clip', !!trim?.first, trim);
      t.expect('then IN and OUT, the gain, Normalize and its inputs, and last To the shelf', !!trim?.rest, trim);
      if (t.profile !== 'desktop') {
        t.expect('its keys are a finger tall', trim?.short.length === 0, trim?.short);
      }
      await t.step('tap Trim again', () => t.tap(page.locator('#buffer-trim')));
      t.expect('it shuts, and the tracks are a finger tall again', await t.poll(() => document.getElementById('buffer').dataset.trim === 'shut'
        && [...document.querySelectorAll('#lanes > .tape-track')].every((r) => r.getBoundingClientRect().height >= 44), null, 3000));
    } else {
      // A phone's sheet has no small state: it holds the small panel's keys,
      // then Trim's, in that order, a pull of its grip away.
      const order = await page.evaluate(trimOrder);
      t.expect('the sheet is the clip, DROP and Toss, then Audition, Repeat, Reverse and the fades', !!order?.first, order);
      t.expect('then IN and OUT, the gain, Normalize and its inputs, and last To the shelf', !!order?.rest, order);
      t.expect('its keys are a finger tall', order?.short.length === 0, order?.short);
      const armed = (await api.tapeState()).rec_track;
      t.expect('the cue lane and the armed track are in sight above the drawer, under the header', await t.poll((n) => {
        const top = document.getElementById('buffer').getBoundingClientRect().top;
        const head = document.querySelector('.appbar').getBoundingClientRect().bottom;
        return [document.getElementById('cue-row'), document.querySelectorAll('#lanes > .tape-track')[n - 1]]
          .every((r) => { const b = r?.getBoundingClientRect(); return !!b && b.height > 0 && b.top >= head - 1 && b.bottom <= top + 1; });
      }, armed, 3000),
      await page.evaluate(() => ({ drawer: document.getElementById('buffer').getBoundingClientRect().top, rows: [...document.querySelectorAll('#cue-row, #lanes > .tape-track')].map((r) => Math.round(r.getBoundingClientRect().top)) })));
      t.expect('and ▶ is not under it', await page.evaluate(() => document.getElementById('np-play').getBoundingClientRect().top
        >= document.getElementById('buffer').getBoundingClientRect().bottom - 1));
      await t.step('scroll the lanes up, clear of the drawer', async () => {
        await page.mouse.move(200, 120);
        for (let i = 0; i < 8; i++) {
          const clear = await page.evaluate(() => [...document.querySelectorAll('#lanes > .tape-track')].at(-1).getBoundingClientRect().bottom
            <= document.getElementById('buffer').getBoundingClientRect().top - 4);
          if (clear) break;
          await page.mouse.wheel(0, 60);
          await t.wait(200);
        }
      });
      t.expect('the rest are a scroll away: the last track comes up above the drawer', await page.evaluate(() => [...document.querySelectorAll('#lanes > .tape-track')].at(-1).getBoundingClientRect().bottom
        <= document.getElementById('buffer').getBoundingClientRect().top + 1));
    }

    // The key reads "Drop on track N · bars a–b" once the grab is placed.
    const label = () => document.getElementById('buffer-drop')?.textContent.replace(/\s+/g, ' ').trim() ?? '';
    await t.poll(() => /track \d/i.test(document.getElementById('buffer-drop')?.textContent ?? ''));
    const sub = await page.evaluate(label);
    t.expect('DROP says where it lands', /track \d/i.test(sub) && !/no room/i.test(sub), `label: "${sub}"`);

    await t.step('tap DROP', () => t.tap(page.locator('#buffer-drop')));
    const toast = page.locator('#toasts .toast').filter({ hasText: /Dropped/ }).first();
    t.expect('a "Dropped on track N" toast', await toast.waitFor({ timeout: 8000 }).then(() => true, () => false));
    const landed = await api.until(async () => parts(await api.tapeState()) > before, 'a part on the tape', 8000).catch(() => false);
    t.expect('the tape has the part', landed);
  },
};
