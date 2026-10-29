// K2 Press PLAY on the keyboard to play and stop the tape, and see the
// tablet follow. On Hindsight's firmware PLAY is a button to the Pi (note
// 16 on channel 16); the realtime Start and Stop the keyboard sends of its
// own (a screen take sent several Stops, which stopped the tape on the rig,
// 2026-10-29) move nothing. docs/flows.md#k2,
// docs/architecture/keyboard.md, *Learnt on the unit*.

const PLAY = [0x9f, 16, 127, 0x8f, 16, 0];
const STOP = [0xfc];
const START = [0xfa];

export default {
  id: 'K2',
  title: 'Play and stop the tape from the keyboard',
  async run(t) {
    const { page, api } = t;
    await t.given('a fresh tape', () => api.tape('Keys'));
    await t.given('the Studio is open', () => page.goto(`${t.base}/tape.html`));
    await page.locator('#np-play').waitFor({ state: 'visible' });
    const kb = await t.given('the keyboard, on Hindsight’s firmware, has Hindsight’s screen',
      () => api.keyboard({ firmware: true }));
    try {
      await api.until(async () => (await kb.status())?.screen, 'the Pi to take the keyboard’s screen', 8000);
      const playing = async () => (await api.tapeStateLive())?.playing;
      const pagePlays = () => !!document.getElementById('np-play')?.classList.contains('playing');
      await t.step('press PLAY on the keyboard', () => kb.press(PLAY));
      t.expect('the tape plays', !!await api.until(playing, 'the tape to play', 3000).catch(() => false));
      t.expect('the tablet’s ▶ follows', await t.poll(pagePlays, null, 2000));
      await t.step('the keyboard sends a MIDI Stop of its own, as a screen take did', () => kb.press(STOP));
      await t.wait(600);
      t.expect('the tape still plays', await playing());
      t.expect('the tablet’s ▶ still shows it playing', await page.evaluate(pagePlays));
      await t.step('press PLAY on the keyboard again', () => kb.press(PLAY));
      t.expect('the tape stops', !!await api.until(async () => (await playing()) === false, 'the tape to stop', 3000).catch(() => false));
      t.expect('the tablet’s ▶ follows', await t.poll(() => !document.getElementById('np-play')?.classList.contains('playing'), null, 2000));
      await t.step('the keyboard sends a MIDI Start of its own', () => kb.press(START));
      await t.wait(600);
      t.expect('the tape stays stopped', (await playing()) === false);
    } finally {
      kb.unplug();
    }
  },
};
