// K5 On the FX page, hold pads for the tape's tricks and effects, with
// nothing in undo, and turn the tape's FX on the encoders. The pads and the
// four mod knobs (CC 21-24, the SMK-37 profile's) are built; their values on
// the keyboard's screen are drawn by internal/surface and seen by the
// virtual keyboard, not here. docs/flows.md#k5.

const BREAK_DOWN = [0x99, 40, 100];
const BREAK_UP = [0x89, 40, 0];
const DRIVE_TO = (v) => [0xbf, 23, v]; // encoder 3, CC 23 on channel 16: mod.drive

export default {
  id: 'K5',
  title: 'Hold the keyboard’s pads for the tape’s tricks, and turn the tape’s FX',
  profiles: ['tablet'],
  async run(t) {
    const { api } = t;
    await t.given('a fresh tape', () => api.tape('Keys'));
    const kb = await t.given('the keyboard, on Hindsight’s firmware, has Hindsight’s screen',
      () => api.keyboard({ firmware: true }));
    try {
      await api.until(async () => (await kb.status())?.screen, 'the Pi to take the keyboard’s screen', 8000);
      const undoBefore = (await api.tapeStateFull()).undo;
      await t.step('hold BREAK on the keyboard', () => kb.press(BREAK_DOWN));
      const held = await api.until(async () => (await api.tapeStateLive())?.tricks?.includes('break'), 'BREAK to be held', 3000).catch(() => false);
      t.expect('the tape holds BREAK', !!held);
      await t.step('let BREAK go', () => kb.press(BREAK_UP));
      const let_ = await api.until(async () => !(await api.tapeStateLive())?.tricks?.includes('break'), 'BREAK to be let go', 3000).catch(() => false);
      t.expect('BREAK is let go', !!let_);
      t.expect('nothing went in undo', (await api.tapeStateFull()).undo === undoBefore);
      await t.step('turn DRIVE up on the keyboard', async () => {
        for (const v of [40, 70, 100]) { kb.press(DRIVE_TO(v)); await t.wait(30); }
      });
      const drive = await api.until(async () => {
        const d = (await api.tapeState())?.style?.drive;
        return Math.abs((d ?? 0) - 100 / 127) < 0.01 && d;
      }, 'the tape’s DRIVE to be where the knob is', 4000).catch(() => null);
      t.expect('the tape’s DRIVE is where the knob stands', !!drive, { drive });
    } finally {
      kb.unplug();
    }
  },
};
