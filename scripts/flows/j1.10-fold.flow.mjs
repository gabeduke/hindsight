// J1.10 Fold the deck: the bar folds by the grabber on its top edge (a tap,
// or a drag down; a drag up unfolds it) and the lanes from ⌗'s View menu
// (Fold the tracks, ticked while they're folded), for room;
// they stay folded for the visit, and the playhead keeps moving. The bar
// slides as it folds: it is one row, and ▶ stays where it was across.
// docs/flows.md#j110
const at = () => {
  const r = (id) => document.getElementById(id)?.getBoundingClientRect();
  const play = r('np-play'), np = r('np');
  return { play: play ? Math.round(play.left) : null, height: np ? Math.round(np.height) : 0, strip: !!document.getElementById('tape-overview')?.offsetParent };
};

export default {
  id: 'J1.10',
  title: 'Fold the bar and the lanes in the Studio',
  profiles: ['tablet', 'desktop'], // a phone's bar is its mini player, which doesn't fold
  async run(t) {
    const { page, api } = t;
    await t.given('a fresh tape', () => api.tape('Fold'));
    await t.given('the Studio is open', () => page.goto(`${t.base}/tape.html`));
    const grabber = page.locator('#np-grabber');
    await grabber.waitFor({ state: 'visible' });
    await t.wait(400);
    const open = await page.evaluate(at);

    await t.step('tap the grabber on the bar’s top edge', () => t.tap(grabber));
    t.expect('the bar folds', await t.poll(() => document.body.classList.contains('np-fold')));
    await t.wait(600); // its slide
    const folded = await page.evaluate(at);
    t.expect('folded, it is one row of keys, its strip gone', folded.height < open.height - 40 && !folded.strip, { open, folded });
    t.expect('▶ stays where it was', Math.abs(folded.play - open.play) <= 2, { open, folded });
    t.expect('the fold is remembered for the visit',
      await page.evaluate(() => sessionStorage.getItem('hindsight.npFold')) !== null);

    // A drag up on the grabber unfolds it, and a drag down folds it again.
    const drag = async (dy) => {
      const b = await grabber.boundingBox();
      const x = b.x + b.width / 2, y = b.y + b.height / 2;
      if (t.profile === 'tablet') {
        const cdp = await page.context().newCDPSession(page);
        const pt = (yy) => [{ x, y: yy }];
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(y) });
        for (let i = 1; i <= 6; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(y + (dy * i) / 6) });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await cdp.detach();
      } else {
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x, y + dy, { steps: 6 });
        await page.mouse.up();
      }
    };
    await t.step('drag the grabber up', () => drag(-60));
    t.expect('a drag up unfolds the bar', await t.poll(() => !document.body.classList.contains('np-fold')));
    await t.wait(600);
    t.expect('its strip is back', (await page.evaluate(at)).strip);
    await t.step('drag the grabber down', () => drag(60));
    t.expect('a drag down folds it again', await t.poll(() => document.body.classList.contains('np-fold')));
    await t.wait(600);

    await t.step('tap ⌗ beside the ruler', () => t.tap(page.locator('#ruler-more')));
    await t.poll(() => document.getElementById('ruler-menu')?.dataset.state === 'open');
    await t.step('tap Fold the tracks', () => t.tap(page.locator('#tracks-fold-btn')));
    t.expect('the lanes fold, and the View menu has shut', await t.poll(() => document.body.classList.contains('tracks-fold') && document.getElementById('ruler-menu')?.hidden));
    t.expect('Fold the tracks is ticked', await page.evaluate(() => document.getElementById('tracks-fold-btn')?.getAttribute('aria-checked') === 'true'));

    await t.step('play', () => t.tap(page.locator('#np-play')));
    const a = await page.locator('#np-time').innerText();
    await t.wait(1200);
    const b = await page.locator('#np-time').innerText();
    t.expect('the playhead moves while folded', a !== b, { a, b });

    await t.step('reload', () => page.reload());
    t.expect('still folded after a reload', await t.poll(() => document.body.classList.contains('np-fold')));
  },
};
