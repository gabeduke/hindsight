// K11 See on the tablet what the keyboard's 16 pads do now: a strip just
// above the bar, lit as the keyboard lights them, switching page with
// SHIFT, hidden by a switch on this device. Todo: the-instrument.md, step
// 7, the surface's build order, step 6. docs/flows.md#k11.

const SHIFT_DOWN = [0x9f, 0, 127];
const SHIFT_UP = [0x8f, 0, 0];

export default {
  id: 'K11',
  title: 'See the keyboard’s pads on the tablet',
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
      const strip = () => {
        const s = document.getElementById('pad-strip');
        return s && !s.hidden ? { pads: s.querySelectorAll('[data-pad]').length, page: s.dataset.page } : null;
      };
      const seen = await t.poll(strip, null, 3000);
      t.expect('a strip of the 16 pads shows above the bar, on the FX page', seen?.pads === 16 && seen?.page === 'fx', seen);
      await t.step('hold SHIFT on the keyboard', () => kb.press(SHIFT_DOWN));
      t.expect('the strip shows the Mixer page', await t.poll(() => document.getElementById('pad-strip')?.dataset.page === 'mixer', null, 2000));
      kb.press(SHIFT_UP);
    } finally {
      kb.unplug();
    }
  },
};
