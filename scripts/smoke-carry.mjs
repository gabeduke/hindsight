// Smoke-test the bar's hand-off between pages (F4, docs/superpowers/plans/
// 2026-10-15-f4.md) in a real browser, against running demos -- the wiring
// the node tests can't reach (the pages' own calls into lib/bar/carry.js).
//
//   npm install --no-save playwright@1.49.0 && npx playwright install chromium
//
//   # one demo with a tape (TAPE=true), one without (the Studio is Capture there);
//   # always give them their own TAPE_DIR / OUTPUT_DIR / SETTINGS_FILE:
//   RING_SECONDS=120 OUTPUT_DIR=… TAPE_DIR=… SETTINGS_FILE=… PORT=15733 TAPE=true go run ./cmd/hindsight --demo
//   RING_SECONDS=120 OUTPUT_DIR=… SETTINGS_FILE=… PORT=15734 go run ./cmd/hindsight --demo
//   HINDSIGHT_URL=http://127.0.0.1:15733 HINDSIGHT_URL_NOTAPE=http://127.0.0.1:15734 \
//     node scripts/smoke-carry.mjs [refuse] [shots=<dir>]
//
// `refuse` runs the browser with autoplay held back (as Safari does), so the
// reload lands paused and ready. The demos need a long take (a minute) at
// the newest, and the tape-less one six takes with a long one sixth newest
// (off a phone's three spines): the script makes what is missing, but those
// are best made by hand against a full ring.
// Exits non-zero on any failure.
import { chromium } from 'playwright';

const TAPE = process.env.HINDSIGHT_URL ?? 'http://127.0.0.1:15733';
const NOTAPE = process.env.HINDSIGHT_URL_NOTAPE ?? 'http://127.0.0.1:15734';
const REFUSE = process.argv.includes('refuse');
// ONLY=reload,studio,... runs just those flows (reload, studio, open, capture, slow, takepage, off).
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const run = (flow) => !ONLY.length || ONLY.includes(flow);
const SHOTS = (process.argv.find((a) => a.startsWith('shots=')) || '').slice(6);
const fails = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) fails.push(name);
};
const browser = await chromium.launch({ args: [`--autoplay-policy=${REFUSE ? 'document-user-activation-required' : 'no-user-gesture-required'}`] });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const bar = (p) => p.evaluate(() => ({
  hidden: document.getElementById('np').hidden,
  play: document.getElementById('np-play').textContent,
  time: document.getElementById('np-time').textContent,
  marquee: document.getElementById('np-marquee').textContent,
  loop: document.getElementById('np-loop').getAttribute('aria-pressed'),
  toasts: [...document.querySelectorAll('#toasts > *')].map((e) => e.textContent.trim()),
}));
const secs = (t) => { const m = /(\d+):(\d+\.\d)/.exec(t); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };
const shot = async (p, name) => { if (SHOTS) await p.screenshot({ path: `${SHOTS}/${name}.png` }); };
const tab = (p, label) => p.evaluate((l) => [...document.querySelectorAll('.appnav a')].find((x) => x.textContent.includes(l)).click(), label);

async function jams(base) { return (await (await fetch(`${base}/api/jams`)).json()); }
async function ensureTakes(base, n) {
  for (let tries = 0; (await jams(base)).length < n && tries < 8; tries++) {
    await fetch(`${base}/api/trigger?seconds=60`, { method: 'POST' });
    await sleep(tries === 0 ? 100 : 20000);
  }
}
async function context(size, scheme, rooms = true) {
  const ctx = await browser.newContext({ viewport: size, colorScheme: scheme, hasTouch: size.width < 700 });
  await ctx.addInitScript((r) => { try { if (r) localStorage.setItem('hindsight.rooms', '1'); } catch {} }, rooms);
  const p = await ctx.newPage();
  p.on('pageerror', (e) => check('no page error', false, e.message));
  return { ctx, p };
}
// A take off the Room's shelf: a tap on its spine plays it in the bar (F5a: there is
// no sheet and no PUT IT ON any more).
async function putOn(p, base, nth = 0) {
  await p.goto(`${base}/takes.html`);
  await p.waitForTimeout(2500);
  await p.locator('.room-cassette').nth(nth).click();
  await p.waitForTimeout(2000);
}

const SIZES = [
  { tag: 'laptop-light', size: { width: 1440, height: 900 }, scheme: 'light' },
  { tag: 'phone-dark', size: { width: 390, height: 844 }, scheme: 'dark' },
];

await ensureTakes(TAPE, 1);
await ensureTakes(NOTAPE, 6);
const hasTape = !!(await (await fetch(`${TAPE}/api/tapes`)).json()).loaded;

for (const { tag, size, scheme } of SIZES) {
  console.log(`\n== ${tag}${REFUSE ? ' (autoplay refused)' : ''}`);

  // 1. A reload while playing; Repeat on across it.
  if (run('reload')) {
    const { ctx, p } = await context(size, scheme);
    await putOn(p, TAPE);
    await p.evaluate(() => document.getElementById('np-loop').click());
    await p.waitForTimeout(800);
    let b = await bar(p);
    check(`${tag}: playing in the bar, Repeat on`, b.play === '❚❚' && b.loop === 'true', JSON.stringify(b));
    const before = secs(b.time);
    await p.reload();
    await p.waitForTimeout(3500);
    b = await bar(p);
    if (REFUSE) check(`${tag}: reload under refused autoplay lands paused, ▶ ready, at the same frame, no toast`, b.play === '▶' && Math.abs(secs(b.time) - before) < 2.5 && !b.toasts.some((t) => /block|fail|error/i.test(t)), JSON.stringify(b));
    else check(`${tag}: reload while playing: playing again, further on`, b.play === '❚❚' && secs(b.time) > before + 1, JSON.stringify(b));
    check(`${tag}: Repeat is still on after the reload`, b.loop === 'true', JSON.stringify(b));
    await shot(p, `${tag}-reload${REFUSE ? '-refused' : ''}`);
    await ctx.close();
  }

  // 2. Room -> the Studio by its tab -> Room: the take is still there.
  if (hasTape && run('studio')) {
    const { ctx, p } = await context(size, scheme);
    await putOn(p, TAPE);
    const t0 = secs((await bar(p)).time);
    await tab(p, 'Studio');
    await p.waitForTimeout(3000);
    check(`${tag}: reached the Studio`, /tape\.html/.test(p.url()), p.url());
    check(`${tag}: the Studio's bar holds the tape`, await p.evaluate(() => /SMOKE|tape/i.test(document.getElementById('np-marquee').textContent) || !document.getElementById('np-dock').hidden));
    await shot(p, `${tag}-studio-by-tab`);
    await tab(p, 'Listening Room');
    await p.waitForTimeout(3500);
    const b = await bar(p);
    check(`${tag}: back in the Room the take is there, further on (${t0} -> ${secs(b.time)})`, !b.hidden && /\d{4}/.test(b.marquee) && secs(b.time) > t0, JSON.stringify(b));
    await ctx.close();

    // 3. Room -> Open in the Studio (the dock's Open, with the tape back in the bar by ⏏: tapes are
    //    not on the Room's shelf any more) -> Room: not resurrected.
    if (run('open')) {
      const c = await context(size, scheme);
      await putOn(c.p, TAPE);
      await c.p.evaluate(() => document.getElementById('np-eject').click());
      await c.p.waitForTimeout(500);
      await c.p.evaluate(() => document.querySelector('.room-sit').click());
      await c.p.waitForTimeout(3000);
      check(`${tag}: Open in the Studio reached tape.html`, /tape\.html/.test(c.p.url()), c.p.url());
      await tab(c.p, 'Listening Room');
      await c.p.waitForTimeout(3500);
      const b2 = await bar(c.p);
      check(`${tag}: after Open in the Studio the old take is not brought back`, b2.hidden || !/\d{4}-\d\d-\d\d_\d+/.test(b2.marquee), JSON.stringify(b2));
      await c.ctx.close();
    }
  }

  // 4. Capture as the Studio (no tape): a take on its shelf goes along; one off its shelf waits.
  if (run('capture')) {
    const { ctx, p } = await context(size, scheme);
    await putOn(p, NOTAPE, 0); // the newest: on Capture's shelf
    await tab(p, 'Studio');
    await p.waitForTimeout(3500);
    let b = await bar(p);
    check(`${tag}: Capture as the Studio: a take on its shelf goes along`, !b.hidden && /\d{4}-\d\d-\d\d_\d+/.test(b.marquee) && (REFUSE ? b.play !== '' : b.play === '❚❚'), JSON.stringify(b));
    await shot(p, `${tag}-capture-studio`);
    await ctx.close();

    const old = await context(size, scheme);
    await putOn(old.p, NOTAPE, 5); // the sixth newest: off a phone's three spines
    const t0 = secs((await bar(old.p)).time);
    await tab(old.p, 'Studio');
    await old.p.waitForTimeout(3500);
    b = await bar(old.p);
    check(`${tag}: a take off Capture's shelf is not in its bar`, b.hidden || !/\d{4}-\d\d-\d\d_\d+/.test(b.marquee) || size.width > 700, JSON.stringify(b));
    await tab(old.p, 'Listening Room');
    await old.p.waitForTimeout(3500);
    b = await bar(old.p);
    check(`${tag}: and back in the Room it is still there (${t0} -> ${secs(b.time)})`, !b.hidden && /\d{4}-\d\d-\d\d_\d+/.test(b.marquee) && secs(b.time) >= t0, JSON.stringify(b));
    await old.ctx.close();
  }

  // 5. The take page, opened and left alone: back in the Room the take is still there, playing on.
  if (run('takepage')) {
    const { ctx, p } = await context(size, scheme);
    await putOn(p, TAPE);
    const t0 = secs((await bar(p)).time);
    const href = await p.evaluate(() => document.getElementById('np-open').getAttribute('href'));
    await p.goto(`${TAPE}${href}`);
    await p.waitForTimeout(2500);
    await tab(p, 'Listening Room');
    await p.waitForTimeout(3500);
    const b = await bar(p);
    check(`${tag}: Room -> the take page left alone -> Room: the take is there, playing on (${t0} -> ${secs(b.time)})`, !b.hidden && secs(b.time) > t0 + 2 && (REFUSE || b.play === '❚❚'), JSON.stringify(b));
    await ctx.close();
  }

  // 5b. Repeat on in the Room, the take played on its own page, back: Repeat is still on.
  if (run('takepage')) {
    const { ctx, p } = await context(size, scheme);
    await putOn(p, TAPE);
    await p.evaluate(() => document.getElementById('np-loop').click());
    const href = await p.evaluate(() => document.getElementById('np-open').getAttribute('href'));
    await p.goto(`${TAPE}${href}`);
    await p.waitForTimeout(2500);
    await p.evaluate(() => document.getElementById('play').click());
    await p.waitForTimeout(1500);
    await p.evaluate(() => document.getElementById('play').click()); // paused again
    await tab(p, 'Listening Room');
    await p.waitForTimeout(3500);
    const b = await bar(p);
    check(`${tag}: Room (Repeat on) -> the take page, played -> Room: Repeat is still on`, !b.hidden && b.loop === 'true', JSON.stringify(b));
    await ctx.close();
  }

  // 6. A slow list: the blank is capped at 4 s, the take still arrives.
  if (run('slow')) {
    const { ctx, p } = await context(size, scheme);
    await putOn(p, TAPE);
    await p.route('**/api/jams', async (route) => { await sleep(6000); await route.continue(); });
    await p.reload();
    await p.waitForTimeout(2500);
    const early = await bar(p);
    await p.waitForTimeout(2500);
    const capped = await bar(p);
    await p.waitForTimeout(7000);
    const late = await bar(p);
    check(`${tag}: slow list: the bar is blank, not the tape, while the take is looked for`, early.hidden, JSON.stringify(early));
    check(`${tag}: slow list: past the 4 s cap the tape shows`, !capped.hidden && /SMOKE/i.test(capped.marquee), JSON.stringify(capped));
    check(`${tag}: slow list: the take arrives when the list does, over the tape`, !late.hidden && /\d{4}-\d\d-\d\d_\d+/.test(late.marquee), JSON.stringify(late));
    await ctx.close();
  }

  // 6b. A slow list, and the person presses the tape's ▶ once the cap has shown it: the late take does not override that.
  if (run('slow') && hasTape) {
    const { ctx, p } = await context(size, scheme);
    await putOn(p, TAPE);
    await p.route('**/api/jams', async (route) => { await sleep(7000); await route.continue(); });
    await p.reload();
    await p.waitForTimeout(5200);
    await p.evaluate(() => document.getElementById('np-play').click()); // the tape's ▶
    await p.waitForTimeout(6000);
    const b = await bar(p);
    check(`${tag}: slow list, the tape pressed meanwhile: the late take does not replace the tape`, !b.hidden && /SMOKE/i.test(b.marquee), JSON.stringify(b));
    await p.evaluate(() => document.getElementById('np-play').click()); // stop the tape again
    await ctx.close();
  }
}

// 7. Rooms off: nothing written, nothing read.
if (run('off')) {
  console.log('\n== rooms off');
  const { ctx, p } = await context(SIZES[0].size, 'light', false);
  await p.goto(`${TAPE}/takes.html`);
  await p.waitForTimeout(2500);
  await p.locator('.take').first().click();
  await p.evaluate(() => document.getElementById('np-play').click());
  await p.waitForTimeout(1200);
  await p.evaluate(() => { window.dispatchEvent(new Event('pagehide')); });
  await p.evaluate(() => { Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true }); document.dispatchEvent(new Event('visibilitychange')); });
  check('rooms off: nothing in sessionStorage after pagehide / hidden', await p.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('hindsight.bar')).length) === 0);
  await ctx.close();
}

await browser.close();
console.log(fails.length ? `\nFAILED: ${fails.join('; ')}` : '\nall ok');
process.exit(fails.length ? 1 : 0);
