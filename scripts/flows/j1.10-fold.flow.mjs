// J1.10 Fold the deck: the bar and the lanes fold away for room and stay
// folded for the visit; the playhead keeps moving. docs/flows.md#j110
export default {
  id: 'J1.10',
  title: 'Fold the bar and the lanes in the Studio',
  profiles: ['tablet', 'desktop'], // the fold key is hidden under 700px
  async run(t) {
    const { page, api } = t;
    await t.given('a fresh tape', () => api.tape('Fold'));
    await t.given('the Studio is open', () => page.goto(`${t.base}/tape.html`));
    await page.locator('#np-fold-btn').waitFor({ state: 'visible' });

    await t.step('fold the bar', () => t.tap(page.locator('#np-fold-btn')));
    t.expect('the bar folds', await t.poll(() => document.body.classList.contains('np-fold')));
    t.expect('the fold is remembered for the visit',
      await page.evaluate(() => sessionStorage.getItem('hindsight.npFold')) !== null);

    await t.step('fold the lanes', () => t.tap(page.locator('#tracks-fold-btn')));
    t.expect('the lanes fold', await t.poll(() => document.body.classList.contains('tracks-fold')));

    await t.step('play', () => t.tap(page.locator('#np-play')));
    const a = await page.locator('#np-time').innerText();
    await t.wait(1200);
    const b = await page.locator('#np-time').innerText();
    t.expect('the playhead moves while folded', a !== b, { a, b });

    await t.step('reload', () => page.reload());
    t.expect('still folded after a reload', await t.poll(() => document.body.classList.contains('np-fold')));
  },
};
