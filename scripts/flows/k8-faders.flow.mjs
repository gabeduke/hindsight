// K8 Set the levels of tracks 1-4 on the faders, always, with no bank (FADER
// BANK stays the keyboard's). Todo: the faders send CC 28-31 on channel 16
// and nothing binds them. docs/flows.md#k8.

const FADER = (i, v) => [0xbf, 28 + i, v];

export default {
  id: 'K8',
  title: 'Set the tracks’ levels on the faders',
  status: 'todo',
  profiles: ['tablet'],
  async run(t) {
    const { api } = t;
    await t.given('a fresh tape', () => api.tape('Keys'));
    const kb = await t.given('the keyboard, on Hindsight’s firmware, has Hindsight’s screen',
      () => api.keyboard({ firmware: true }));
    try {
      await api.until(async () => (await kb.status())?.screen, 'the Pi to take the keyboard’s screen', 8000);
      const before = (await api.tapeState())?.tracks?.[1]?.gain_db;
      await t.step('pull fader 2 down', async () => { for (const v of [100, 70, 40]) { kb.press(FADER(1, v)); await t.wait(30); } });
      const after = await api.until(async () => {
        const g = (await api.tapeState())?.tracks?.[1]?.gain_db;
        return g !== undefined && g !== before && g < (before ?? 0) && g;
      }, 'track 2’s level to come down', 3000).catch(() => null);
      t.expect('track 2 is quieter', after !== null, { before, after });
      t.expect('track 1 is as it was', (await api.tapeState())?.tracks?.[0]?.gain_db === before);
    } finally {
      kb.unplug();
    }
  },
};
