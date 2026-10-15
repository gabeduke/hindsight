// Smoke-test the move off the shelf and into the deck (Rooms R2) in a real
// browser, against a running demo instance: what the node tests, which drive
// the models with a fake dt, can't reach -- that the picture holds its frame
// rate on a throttled CPU, and that the sound starts on the clock, not on a
// frame.
//
//   npm install --no-save playwright@1.49.0   # at the repo root, as for
//   npx playwright install chromium          # scripts/screenshots.mjs
//
//   RING_SECONDS=120 OUTPUT_DIR=/tmp/hindsight-smoke PORT=15391 \
//     go run ./cmd/hindsight --demo &
//   HINDSIGHT_URL=http://127.0.0.1:15391 node scripts/smoke-shelf-to-deck.mjs
//
// The demo needs a take on its shelf (trigger one from the Capture page, or
// POST /api/trigger?seconds=12). It exits non-zero on any failure. Frame
// times are measured with Chromium's CPU throttled 4x (CDP
// Emulation.setCPUThrottlingRate) and printed; a real phone is the real test.
import { chromium } from 'playwright';

const BASE = process.env.HINDSIGHT_URL ?? 'http://127.0.0.1:5000';
const THROTTLE = Number(process.env.THROTTLE ?? 4);
const failures = [];
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` -- ${detail}` : ''}`);
  if (!ok) failures.push(name);
};

const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });

// What the page records for us: frames, and the moment audio is told to play.
const instrument = () => {
  localStorage.setItem('hindsight.tapeOn', 'true');
  window.__plays = [];
  window.__pauses = [];
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...a) { window.__plays.push(performance.now()); return play.apply(this, a); };
  const pause = HTMLMediaElement.prototype.pause;
  HTMLMediaElement.prototype.pause = function (...a) { window.__pauses.push(performance.now()); return pause.apply(this, a); };
  window.__record = (ms) => new Promise((res) => {
    const f = []; const t0 = performance.now();
    const loop = (t) => { f.push(t); if (t - t0 < ms) requestAnimationFrame(loop); else res(f); };
    requestAnimationFrame(loop);
  });
};

const open = async ({ rooms, reduced = false, w = 1440, h = 900 }) => {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: reduced ? 'reduce' : 'no-preference' });
  await ctx.addInitScript(instrument);
  if (rooms) await ctx.addInitScript(() => localStorage.setItem('hindsight.rooms', '1'));
  const p = await ctx.newPage();
  const requested = [];
  const errors = [];
  p.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.endsWith('.js')) requested.push(u.pathname); });
  p.on('pageerror', (e) => errors.push(e.message));
  await p.goto(`${BASE}/takes.html`);
  return [ctx, p, requested, errors];
};

const stats = (f) => {
  const d = f.slice(1).map((t, i) => t - f[i]);
  const span = f.at(-1) - f[0];
  return { frames: f.length, fps: 1000 * d.length / span, max: Math.max(...d), over34: d.filter((x) => x > 34).length };
};

// With the flag off, nothing of it loads, draws or listens.
{
  const [ctx, p, requested, errors] = await open({ rooms: false });
  await p.waitForTimeout(2000);
  const mine = requested.filter((u) => /\/lib\/(room\/(carry|hifi|doorway)|scene\/(choreo|flight|deck))\.js$/.test(u));
  check('flag off: none of shelf-to-deck is fetched', mine.length === 0, mine.join(' '));
  const dom = await p.evaluate(() => document.querySelectorAll('.room-carry, .room-deck-window, .room-deck-eject').length);
  check('flag off: none of its markup is made', dom === 0);
  check('flag off: no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// With it on: pick, PUT IT ON, eject -- at a throttled CPU.
{
  const [ctx, p, , errors] = await open({ rooms: true });
  await p.waitForSelector('.room-shelf-takes .room-cassette', { timeout: 10000 });
  await p.waitForTimeout(2000);
  const cdp = await ctx.newCDPSession(p);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE });
  await p.waitForTimeout(500);

  await p.evaluate(() => document.querySelector('.room-shelf-takes .room-cassette').click());
  await p.waitForTimeout(900); // pulled out, held while the card is open
  const held = await p.evaluate(() => ({
    ghost: !!document.querySelector('.room-carry:not([hidden])'),
    gap: !!document.querySelector('.room-shelf-takes .room-cassette.room-out'),
  }));
  check('a picked take is out of its slot, its gap open, while its card is open', held.ghost && held.gap, JSON.stringify(held));

  // A long frame lands before SEAT: the sound must not wait for it.
  const run = await p.evaluate(async () => {
    const rec = window.__record(1500);
    window.__plays.length = 0;
    const t0 = performance.now();
    document.querySelector('.room-takecard .room-put').click();
    setTimeout(() => { const e = performance.now() + 200; while (performance.now() < e); }, 300);
    // A name worn twice at once would abort a View Transition.
    const worn = [];
    const watch = setInterval(() => worn.push([...document.querySelectorAll('*')].map((e) => e.style.viewTransitionName).filter((n) => n && n !== 'none')), 40);
    const f = await rec;
    clearInterval(watch);
    return { t0, f, plays: window.__plays.slice(), worn };
  });
  const soundAt = run.plays.length ? run.plays[0] - run.t0 : null;
  // From the hold (300 ms) to SEAT (920 ms) is 620 ms; a little over for the handler.
  check('the sound starts at SEAT, 620 ms after PUT IT ON, through a 200 ms long frame', soundAt !== null && soundAt >= 600 && soundAt < 720, `${soundAt === null ? 'never' : soundAt.toFixed(0)} ms`);
  check('and only once', run.plays.length === 1, String(run.plays.length));
  const twice = run.worn.filter((names) => new Set(names).size !== names.length);
  check('no view-transition-name is worn twice at once', run.worn.length > 10 && twice.length === 0, `${run.worn.length} looks, ${twice.length} with a repeat`);
  const s = stats(run.f.filter((t) => t >= run.t0));
  console.log(`     put on at ${THROTTLE}x: ${s.frames} frames, ${s.fps.toFixed(1)} fps, longest ${s.max.toFixed(0)} ms, ${s.over34} over 34 ms (a 200 ms block was injected)`);
  check('put on holds its frames: at most that block and a frame after it dropped', s.over34 <= 2 && s.fps > 40);
  const seated = await p.evaluate(() => ({
    deck: document.querySelector('.room-deck').className,
    door: document.querySelector('.room-deck-door').style.transform,
    ghost: !!document.querySelector('.room-carry:not([hidden])'),
  }));
  check('seated: the deck holds a cassette, door shut, nothing in the air', /room-has-cassette/.test(seated.deck) && /(^| )playing/.test(seated.deck) && /, 0px, 0px\)/.test(seated.door) && !seated.ghost, JSON.stringify(seated));

  // Eject: the sound stops at the press, and it is home in about 700 ms.
  const ej = await p.evaluate(async () => {
    const rec = window.__record(1100);
    window.__pauses.length = 0;
    const t0 = performance.now();
    document.querySelector('.room-deck-eject').click();
    // Paused inside the press itself, before any frame.
    const stopped = window.__pauses.length > 0;
    let home = null;
    const watch = setInterval(() => { if (home === null && !document.querySelector('.room-carry:not([hidden])')) home = performance.now() - t0; }, 10);
    const f = await rec;
    clearInterval(watch);
    return { t0, f, stopped, home };
  });
  const e = stats(ej.f.filter((t) => t >= ej.t0));
  console.log(`     eject at ${THROTTLE}x: ${e.frames} frames, ${e.fps.toFixed(1)} fps, longest ${e.max.toFixed(0)} ms, home after ${ej.home?.toFixed(0)} ms`);
  check('eject: the sound stops at the press', ej.stopped);
  check('eject: it is home in about 700 ms', ej.home !== null && ej.home > 600 && ej.home < 900, `${ej.home?.toFixed(0)} ms`);
  check('eject holds its frames', e.over34 <= 2 && e.fps > 40);
  check('no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// Reduced motion: a cross-fade, no flight, the sound at once.
{
  const [ctx, p, , errors] = await open({ rooms: true, reduced: true });
  await p.waitForSelector('.room-shelf-takes .room-cassette', { timeout: 10000 });
  await p.waitForTimeout(1500);
  await p.evaluate(() => document.querySelector('.room-shelf-takes .room-cassette').click());
  await p.waitForTimeout(300);
  const r = await p.evaluate(async () => {
    window.__plays.length = 0;
    // The held pick's ghost is pulled out and still; a flight would move it.
    let faded = false;
    const poses = new Set();
    const t0 = performance.now();
    document.querySelector('.room-takecard .room-put').click();
    const watch = setInterval(() => {
      const g = document.querySelector('.room-carry:not([hidden])');
      if (g) poses.add(g.style.transform);
      if (document.documentElement.classList.contains('room-xfade')) faded = true;
    }, 8);
    await new Promise((res) => setTimeout(res, 1300));
    clearInterval(watch);
    return { flew: poses.size > 1, faded, soundAt: window.__plays.length ? window.__plays[0] - t0 : null, deck: document.querySelector('.room-deck').className };
  });
  check('reduced motion: nothing flies', !r.flew);
  check('reduced motion: the change is a cross-fade', r.faded);
  check('reduced motion: the sound starts at once', r.soundAt !== null && r.soundAt < 150, `${r.soundAt === null ? 'never' : r.soundAt.toFixed(0)} ms`);
  check('reduced motion: the cassette is in the deck', /room-has-cassette/.test(r.deck));
  check('reduced motion: no page errors', errors.length === 0, errors.join(' | '));
  await ctx.close();
}

await browser.close();
if (failures.length) {
  console.log(`\n${failures.length} failed`);
  process.exit(1);
}
console.log('\nall passed');
