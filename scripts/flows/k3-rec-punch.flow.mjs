// K3 Press REC to punch in on the armed track and again to punch out (from
// a stop, REC starts the tape), then find what I played on the tape. Todo:
// REC KEEPs today (the SMK-37 profile binds note 17 to keep).
// docs/flows.md#k3, the-instrument.md step 7, *What the Pi does with them*.

const REC = [0x9f, 17, 127, 0x8f, 17, 0];
const PLAY = [0x9f, 16, 127, 0x8f, 16, 0];

export default {
  id: 'K3',
  title: 'Punch in and out on the armed track with REC',
  status: 'todo',
  profiles: ['tablet'],
  async run(t) {
    const { api } = t;
    await t.given('a fresh tape (which arms track 1)', () => api.tape('Keys'));
    const kb = await t.given('the keyboard, on Hindsight’s firmware, has Hindsight’s screen',
      () => api.keyboard({ firmware: true }));
    try {
      await api.until(async () => (await kb.status())?.screen, 'the Pi to take the keyboard’s screen', 8000);
      await t.step('press PLAY, then REC on the keyboard', async () => { kb.press(PLAY); await t.wait(300); kb.press(REC); });
      const on = await api.until(async () => (await api.tapeStateLive())?.record?.state === 'on', 'a punch', 4000).catch(() => false);
      t.expect('REC punches in on the armed track', !!on);
      await t.step('press REC again', () => kb.press(REC));
      const off = await api.until(async () => (await api.tapeStateLive())?.record?.state !== 'on', 'the punch to end', 4000).catch(() => false);
      t.expect('REC punches out', !!off);
      t.expect('what I played is on track 1', ((await api.tapeState())?.tracks?.[0]?.clips?.length ?? 0) > 0);
      kb.press(PLAY);
    } finally {
      kb.unplug();
    }
  },
};
