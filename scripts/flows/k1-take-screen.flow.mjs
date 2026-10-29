// K1 Plug the keyboard in and see Hindsight take its screen. The part built:
// a keyboard on Hindsight's firmware (the harness's stand-in, which acks
// what the Pi sends) answers HELLO, and the Pi takes its screen, as
// /api/status says. What the screen shows (the counter, the transport, the
// knobs, the pad page and its map, the levels) waits for the virtual
// keyboard's link, which can see what was drawn: K1's widgets are todo.
// docs/flows.md#k1, docs/architecture/keyboard.md.

export default {
  id: 'K1',
  title: 'Plug the keyboard in and see Hindsight take its screen',
  profiles: ['tablet'],
  async run(t) {
    const { api } = t;
    const kb = await t.given('the keyboard, on Hindsight’s firmware, is plugged in', () => api.keyboard({ firmware: true }));
    try {
      const s = await t.step('wait for the Pi to find it', () => api.until(async () => {
        const k = await kb.status();
        return k?.screen && k;
      }, 'the Pi to take the keyboard’s screen', 8000).catch(() => null));
      t.expect('the Pi takes its screen', !!s?.screen, s);
      t.expect('it speaks version 2, with local echo and the quiet clock', s?.version === 2 && s?.features === 7, s);
      t.expect('it was not homed', s && !s.homed, s);
    } finally {
      kb.unplug();
    }
  },
};
