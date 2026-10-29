// K4 Press HOME to give the keyboard its own screen (to pick one of the
// synth's voices there), then hold HOME a second and let go to hand the
// screen back. What the keyboard does with its own screen is the
// keyboard's; what the Pi sees is RELEASE, then OFFER, and the Pi stays off
// the screen between them, even as the keyboard answers again.
// docs/flows.md#k4, docs/architecture/keyboard.md.

export default {
  id: 'K4',
  title: 'Hand the keyboard’s screen back with HOME, and take it again',
  profiles: ['tablet'],
  async run(t) {
    const { api } = t;
    const kb = await t.given('the keyboard, on Hindsight’s firmware, has Hindsight’s screen',
      () => api.keyboard({ firmware: true }));
    try {
      await api.until(async () => (await kb.status())?.screen, 'the Pi to take the keyboard’s screen', 8000);
      await t.step('press HOME on the keyboard', () => kb.home());
      const homed = await api.until(async () => {
        const k = await kb.status();
        return k?.homed && !k.screen && k;
      }, 'the screen to be the keyboard’s', 3000).catch(() => null);
      t.expect('the screen is the keyboard’s, and the Pi knows HOME gave it back', !!homed, homed);
      await t.wait(2500); // past a probe: the keyboard answers again
      const still = await kb.status();
      t.expect('the Pi doesn’t take it back on its own', still?.homed && !still.screen, still);
      await t.step('hold HOME a second and let go', () => kb.offer());
      const back = await api.until(async () => {
        const k = await kb.status();
        return k?.screen && !k.homed && k;
      }, 'the Pi to take the screen again', 3000).catch(() => null);
      t.expect('the Pi takes the screen again', !!back, back);
    } finally {
      kb.unplug();
    }
  },
};
