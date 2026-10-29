// K6 Hold SHIFT for the Mixer page: mute, select, solo and arm tracks 1-4
// on the pads (track n in column n: mute and select on the top row, solo and
// arm on the bottom), and see the tablet follow. Todo: SHIFT only lights
// itself today, and the pads keep the FX page. Its map comes first
// (docs/plan/the-map.md). docs/flows.md#k6.

const SHIFT_DOWN = [0x9f, 0, 127];
const SHIFT_UP = [0x8f, 0, 0];
const pad = (i) => [0x99, 36 + i, 100, 0x89, 36 + i, 0];

export default {
  id: 'K6',
  title: 'Mute, solo and arm tracks on the Mixer page under SHIFT',
  status: 'todo',
  async run(t) {
    const { page, api } = t;
    await t.given('a fresh tape', () => api.tape('Keys'));
    await t.given('the Studio is open', () => page.goto(`${t.base}/tape.html`));
    await page.locator('#np-play').waitFor({ state: 'visible' });
    const kb = await t.given('the keyboard, on Hindsight’s firmware, has Hindsight’s screen',
      () => api.keyboard({ firmware: true }));
    try {
      await api.until(async () => (await kb.status())?.screen, 'the Pi to take the keyboard’s screen', 8000);
      await t.step('hold SHIFT and press pad 2 (mute track 2)', async () => { kb.press(SHIFT_DOWN); kb.press(pad(1)); kb.press(SHIFT_UP); });
      const muted = await api.until(async () => (await api.tapeState())?.tracks?.[1]?.mute, 'track 2 to be muted', 3000).catch(() => false);
      t.expect('track 2 is muted', !!muted);
      t.expect('the tablet shows track 2 muted', await t.poll(() => !!document.querySelectorAll('#lanes .tape-track')[1]?.querySelector('[aria-pressed="true"][data-act="mute"]'), null, 2000));
      await t.step('hold SHIFT and press pad 16 (arm track 4)', async () => { kb.press(SHIFT_DOWN); kb.press(pad(15)); kb.press(SHIFT_UP); });
      const armed = await api.until(async () => (await api.tapeState())?.tracks?.[3]?.armed, 'track 4 to be armed', 3000).catch(() => false);
      t.expect('track 4 is armed', !!armed);
      await t.step('press pad 2 without SHIFT', () => kb.press(pad(1)));
      t.expect('it is BREAK again, not a mute', (await api.tapeState())?.tracks?.[1]?.mute === true);
    } finally {
      kb.unplug();
    }
  },
};
