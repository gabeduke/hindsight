// The phone's bar as a person uses it (docs/architecture/bar.md): the mini
// player, and the player pulled up over the page. The display's keys (the
// tempo, the source, where it plays) are in the player pulled up, not in the
// mini player, so a flow that taps them on a phone pulls it up first. J4.4
// is the flow of the player itself; these are for the flows that pass
// through it.

// mini says whether the bar is the phone's mini player, the player down.
export const mini = (page) => page.evaluate(() => document.getElementById('np')?.dataset.size === 'mini'
  && !document.body.classList.contains('player-open'));

// pullUp pulls the player up by a tap on the mini player's window, and
// waits for it to settle. With no mini player it does nothing. It answers
// whether the player is up.
export async function pullUp(t) {
  if (!(await mini(t.page))) return t.page.evaluate(() => document.body.classList.contains('player-open'));
  await t.tap(t.page.locator('#np-expand'));
  return !!await t.poll(() => document.body.classList.contains('player-open')
    && getComputedStyle(document.getElementById('np-dock') || document.getElementById('np')).transform === 'none');
}

// putAway puts the player away with Back (Android's is a close request,
// which Chromium takes as Escape), if it is up, and waits for the mini
// player. It answers whether the player is down.
export async function putAway(t) {
  if (!(await t.page.evaluate(() => document.body.classList.contains('player-open')))) return true;
  await t.page.keyboard.press('Escape');
  return !!await t.poll(() => !document.body.classList.contains('player-open'));
}
