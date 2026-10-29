// J1.16 The Studio on one screen, on a tablet: what serves catching,
// building and jamming stays on it, the rest one tap away
// (docs/plan/the-studio-on-one-screen.md). At rest it holds no more controls
// than its budget (layout.mjs, STUDIO_BUDGET), next to none under 32 px,
// every track's ● a finger wide, and all four tracks above the bar; M, S
// and the level are in the track's inspector, which › opens. docs/flows.md#j116
import { STUDIO_BUDGET, studioBudget } from './layout.mjs';

export default {
  id: 'J1.16',
  title: 'The Studio on one screen: four tracks above the bar, keys a finger wide',
  profiles: ['tablet', 'pixel', 'upright'],
  async run(t) {
    const { page, api } = t;
    await t.given('a fresh tape', () => api.tape('One screen'));
    await t.given('the Studio is open', () => page.goto(`${t.base}/tape.html`));
    await page.locator('#lanes .tt-arm').nth(3).waitFor({ state: 'visible' });
    await t.wait(600);

    const b = await studioBudget(page);
    t.expect(`at most ${STUDIO_BUDGET.controls} controls on the screen`, b.controls <= STUDIO_BUDGET.controls, b);
    t.expect(`at most ${STUDIO_BUDGET.under32} of them under 32 px`, b.under32 <= STUDIO_BUDGET.under32, b.small);
    t.expect(`every track’s ● is ${STUDIO_BUDGET.jam} px or more`, b.jam >= STUDIO_BUDGET.jam, b.jam);
    t.expect('all four tracks are above the bar', b.tracks === 4 && b.above === 4, b);
    const heads = await page.evaluate(() => {
      const on = (sel) => [...document.querySelectorAll(sel)].filter((el) => el.getClientRects().length).length;
      return { mute: on('#lanes .tt-mute'), solo: on('#lanes .tt-solo'), gain: on('#lanes .tt-gain'), more: on('#lanes .tt-more') };
    });
    t.expect('the heads have a › each, and no M, S or level', heads.more === 4 && !heads.mute && !heads.solo && !heads.gain, heads);

    // M, S and the level, one tap away: › on track 2, with track 1 armed.
    await t.step('tap track 2’s ›', () => t.tap(page.locator('#lanes .tt-more').nth(1)));
    t.expect('track 2’s inspector opens, with Mute, Solo and the level', await t.poll(() => document.getElementById('track-sheet').open
      && /Track 2/.test(document.getElementById('track-title').textContent)
      && ['track-mute', 'track-solo', 'track-gain'].every((id) => document.getElementById(id).getClientRects().length)));
  },
};
