// The Transport, the bar (web/static/lib/components/transport), in the
// harness: node scripts/components.mjs transport. Each case is mounted at
// every size and in both schemes, on the fixtures' bar, transport, tape,
// takes and recorder, with the shell's props made by its surface module
// (transport.surface.js), and the flows' layout checks run on its root.
// Nothing here presses ▶: the harness plays no sound.

const MODELS = { tape: 'tape/stopped.json', takes: 'takes/three.json' };

export default {
  id: 'transport',
  // The shell mounts it on #np, so its parts are #np-play, #np-source, …
  rootId: 'np',
  // Its props are more than keys to press: transport.surface.js.
  surface: true,
  cases: [
    { name: 'the tape, stopped, in the Studio', fixtures: MODELS, props: ['output'], surface: { room: 'studio' } },
    { name: 'the tape, stopped, in the Listening Room', fixtures: MODELS, props: ['output'], surface: { room: 'room' } },
  ],
  // What it should do besides keep its shape: hold the tape, as the mini
  // player on a phone and the full bar wider; say the room on its root;
  // the Studio's keys only in the Studio; the source's menu opens in the
  // top layer; and OUT reaches what the surface handed it.
  async expect(page, { tap, profile }) {
    const out = [];
    const phone = profile === 'phone';
    const at = await page.evaluate(() => {
      const root = document.getElementById('np');
      const seen = (id) => { const el = document.getElementById(id); return !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden'; };
      return {
        hidden: root.hidden, source: root.dataset.source, size: root.dataset.size, room: root.dataset.room ?? null,
        play: seen('np-play'), rec: seen('np-rec'), recMore: seen('np-rec-more'), catchKey: !!document.getElementById('np-catch-pass'),
      };
    });
    out.push({ name: 'it holds the tape', ok: !at.hidden && at.source === 'tape', detail: at });
    out.push({ name: phone ? 'the mini player on a phone' : 'the full bar', ok: at.size === (phone ? 'mini' : 'full'), detail: at });
    out.push({ name: '▶ is there', ok: at.play, detail: at });
    const room = await page.evaluate(() => document.getElementById('np').dataset.room ?? null);
    const studio = room === 'studio';
    out.push({ name: 'it says the room on its root', ok: room === 'studio' || room === 'room', detail: room });
    out.push({ name: studio ? '● and its ▾ in the Studio, and no Catch key' : 'no ● nor its ▾ away from the Studio', ok: at.rec === studio && at.recMore === studio && !at.catchKey, detail: at });
    if (!phone) {
      await tap(page.locator('#np-source'));
      const open = await page.evaluate(() => document.getElementById('np-source-menu').matches(':popover-open'));
      out.push({ name: 'SOURCE opens what plays, in the top layer', ok: open, detail: open });
      await page.keyboard.press('Escape');
      await tap(page.locator('#np-output'));
      const pressed = await page.evaluate(() => window.__harness.pressed.slice());
      out.push({ name: 'OUT opens what the surface handed it', ok: pressed.includes('output'), detail: pressed });
    }
    return out;
  },
};
