// The display's keys (web/static/lib/components/display), in the harness:
// node scripts/components.mjs display. Each case is mounted at every size
// and in both schemes, and the flows' layout checks run on its root.

// LONG_AT is where the keys say it all (css/display.css's container query).
const LONG_AT = 420;

export default {
  id: 'display',
  // A root given the id np names its keys #np-tempo, #np-source and
  // #np-output, as the bar's are now.
  rootId: 'np',
  cases: [
    { name: 'a stopped tape, every key live', fixtures: { tape: 'tape/stopped.json' }, props: ['tempo', 'source', 'output'] },
    { name: 'a long name, playing on a phone', fixtures: { tape: 'tape/playing-on-a-phone.json' }, props: ['tempo', 'source', 'output'] },
    { name: 'no tempo yet, and no tempo menu here', fixtures: { tape: 'tape/no-tempo.json' }, props: ['source', 'output'] },
  ],
  // What it should do besides keep its shape: the long forms only where
  // there is room for them, and a press reaches what the surface handed it.
  async expect(page, { tap }) {
    const out = [];
    const { width, long, short } = await page.evaluate(() => {
      const root = document.getElementById('np');
      const seen = (sel) => getComputedStyle(root.querySelector(sel)).display !== 'none';
      return { width: root.getBoundingClientRect().width, long: seen('[data-part="tempo-long"]'), short: seen('[data-part="tempo-short"]') };
    });
    const wide = width >= LONG_AT;
    out.push({ name: `${wide ? 'the long forms' : 'the short forms'} at ${Math.round(width)} px`, ok: long === wide && short === !wide, detail: { width, long, short } });
    await tap(page.locator('#np-source'));
    const pressed = await page.evaluate(() => window.__harness.pressed.slice());
    out.push({ name: 'SOURCE opens what the surface handed it', ok: pressed.includes('source'), detail: pressed });
    return out;
  },
};
