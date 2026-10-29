// K7 Scrub the tape on the master knob while the Pi has the screen, with the
// counter on the keyboard's screen; SHIFT and the master knob set the
// synth's volume. Todo: the master knob plays the keyboard's synth, and the
// firmware sends the Pi nothing for it; what it would send (a CC on channel
// 16, say) is the map's to name (docs/plan/the-map.md). docs/flows.md#k7.

const MASTER = (v) => [0xbf, 20, v]; // a placeholder: the map names the real one

export default {
  id: 'K7',
  title: 'Scrub the tape on the master knob',
  status: 'todo',
  profiles: ['tablet'],
  async run(t) {
    const { api } = t;
    await t.given('a fresh tape', () => api.tape('Keys'));
    const kb = await t.given('the keyboard, on Hindsight’s firmware, has Hindsight’s screen',
      () => api.keyboard({ firmware: true }));
    try {
      await api.until(async () => (await kb.status())?.screen, 'the Pi to take the keyboard’s screen', 8000);
      const before = (await api.tapeStateLive())?.heard ?? 0;
      await t.step('turn the master knob forward', async () => { for (const v of [70, 80, 90, 100]) { kb.press(MASTER(v)); await t.wait(40); } });
      const moved = await api.until(async () => ((await api.tapeStateLive())?.heard ?? 0) > before, 'the tape to move', 2000).catch(() => false);
      t.expect('the tape moves forward under the knob, stopped', !!moved);
    } finally {
      kb.unplug();
    }
  },
};
