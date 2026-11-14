// The display's keys (web/static/lib/components/display), in the harness:
// node scripts/components.mjs display. Each case is mounted at every size
// and in both schemes, and the flows' layout checks run on its root.

// LONG_AT is where the keys say it all (css/display.css's container query).
const LONG_AT = 420;

export default {
  id: 'display',
  // A root given the id np names its keys #np-tempo and #np-source, as the
  // bar's are now: the tempo's key is where it plays too (step 7b).
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
    out.push({ name: 'there is no key for the output of its own', ok: await page.evaluate(() => !document.getElementById('np-output')), detail: null });
    // The tempo's key says both to a screen reader, and a press on it reaches
    // the tempo's panel, or OUT where the surface handed no tempo.
    const key = await page.evaluate(() => { const k = document.getElementById('np-tempo'); return { label: k?.getAttribute('aria-label') ?? '', text: k?.textContent ?? '', disabled: !!k?.disabled }; });
    out.push({ name: 'the tempo’s key names where it plays, in words and to a screen reader', ok: /jam room|phone|both|out/i.test(key.text) && /play|out/i.test(key.label), detail: key });
    if (!key.disabled) {
      await tap(page.locator('#np-tempo'));
      const after = await page.evaluate(() => window.__harness.pressed.slice());
      out.push({ name: 'the tempo’s key opens what the surface handed it', ok: after.includes('tempo') || after.includes('output'), detail: after });
    }
    return out;
  },
};
