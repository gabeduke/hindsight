// docs/plan/reach-back/mockups.mjs
// The reach-back's mockups (docs/plan/reach-back.md), drawn on a running
// demo: the Studio as it is, with a cue clip's drawer re-dressed as the
// reach-back, so the look is the app's own stylesheets and the window is
// the drawer's own drawWindow (lib/buffer/draw.js), fed the demo's feed.
// A mockup, not a feature: nothing here is in the app.
//
//   D=$(mktemp -d); RING_SECONDS=900 PORT=15287 OUTPUT_DIR=$D/takes \
//     TAPE_DIR=$D/tapes SETTINGS_FILE=$D/settings.env CGO_ENABLED=0 \
//     go run ./cmd/hindsight --demo &
//   (wait ten minutes: the jam wants 8:30 of feed)
//   node docs/plan/reach-back/mockups.mjs http://127.0.0.1:15287
//
// It plays a tape named "Sunday jam" (96 BPM, 4 bars, a pass on tracks 1
// and 3, track 2 armed), making it if there is none. Playwright as
// docs/development.md, *Screenshots*, installs it.

import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:15287';
const out = new URL('.', import.meta.url).pathname;
const SR = 48000;
const BAR = 2.5; // s, at 96 BPM
const PASS = 4 * BAR;
const JAM = 372; // s: since you started, 6:12
const VIEW = 510; // s: the jam's window, 8:30
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function call(method, path, body) {
  const r = await fetch(base + path, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} -> ${r.status} ${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}

// seed plays Sunday jam, making it first if there is none: passes caught
// onto tracks 1 and 3, track 2 armed. A tape loaded again starts its
// passes again, so one already loaded is left as it is.
async function seed() {
  const list = await call('GET', '/api/tapes');
  const had = (list.tapes || []).find((t) => t.name === 'Sunday jam');
  if (had) {
    const q = `id=${encodeURIComponent(had.id)}`;
    if (list.loaded !== had.id) await call('POST', `/api/tapes/load?${q}`);
    if (!(await call('GET', `/api/tapes/state?${q}`)).live?.playing) {
      await call('POST', `/api/tapes/transport?${q}`, { action: 'play' });
      await sleep(PASS * 1000 + 800);
    }
    return had.id;
  }
  const tape = await call('POST', '/api/tapes', { name: 'Sunday jam' });
  const q = `id=${encodeURIComponent(tape.id)}`;
  await call('POST', `/api/tapes/load?${q}`);
  await call('PATCH', `/api/tapes?${q}`, { tempo: { bpm: 96, bars: 4 } });
  await call('PATCH', `/api/tapes?${q}`, { inputs: [1, 2, 3].map((n) => ({ n, source: 'main' })) });
  for (const [n, name] of [[1, 'beat'], [2, 'chords'], [3, 'bass']]) await call('PATCH', `/api/tapes?${q}`, { track: { n, name } });
  await call('PATCH', `/api/tapes?${q}`, { rec_track: 1 });
  await call('POST', `/api/tapes/transport?${q}`, { action: 'play' });
  await sleep(PASS * 2000 + 600);
  await call('POST', `/api/tapes/catch?${q}`, { track: 1, source: 'main', pass: 1 });
  await call('PATCH', `/api/tapes?${q}`, { rec_track: 3 });
  await sleep(PASS * 1000 + 300);
  await call('POST', `/api/tapes/catch?${q}`, { track: 3, source: 'main', bars: 2 });
  await call('PATCH', `/api/tapes?${q}`, { rec_track: 2, click: false });
  return tape.id;
}

// feed keeps the last `seconds` of the ring as a take and answers its peaks,
// one level per bucket, 0..1: the feed, as the reach-back would read it.
async function feed(seconds, buckets) {
  const kept = await call('POST', `/api/trigger?seconds=${seconds}`);
  for (let i = 0; i < 60; i++) {
    const j = await call('GET', '/api/jams');
    const t = (Array.isArray(j) ? j : (j?.takes ?? [])).find((x) => x.name === kept.name);
    if (t?.has_peaks) {
      const F = Math.round(t.duration_seconds * SR);
      const pd = await call('GET', `/api/peaks?file=${encodeURIComponent(kept.name)}&from=0&to=${F}&buckets=${buckets}`);
      const lv = new Array(pd.buckets).fill(0);
      for (const ch of pd.data) for (let i = 0; i < pd.buckets; i++) lv[i] = Math.max(lv[i], -ch[2 * i], ch[2 * i + 1]);
      // Out of the shelf again: the mockup's peaks were all it was for.
      await call('DELETE', `/api/delete?file=${encodeURIComponent(kept.name)}`).catch(() => {});
      return { levels: lv, seconds: t.duration_seconds };
    }
    await sleep(500);
  }
  throw new Error('the feed’s take never got its peaks');
}

// dress re-dresses the open cue drawer as the reach-back. Runs in the page.
async function dress(m) {
  const { drawWindow, RULER_H, FADE_BOX } = await import('/lib/buffer/draw.js');
  const { token } = await import('/lib/theme.js');
  const src = document.getElementById('buffer');
  const d = src.cloneNode(true);
  d.id = 'reach';
  d.querySelectorAll('[id]').forEach((e) => { e.id = `reach-${e.id}`; });
  src.after(d);
  src.style.display = 'none';
  const $ = (s) => d.querySelector(s);
  const chip = (label, on) => `<button type="button" class="chip buffer-source" aria-pressed="${on}"><span class="buffer-source-name">${label}</span></button>`;
  const chips = (cls, labels, lit) => `<div class="buffer-sources ${cls}" role="group">${labels.map((l) => chip(l, l === lit)).join('')}</div>`;

  // The head: Feed, the span in words, the zoom, the snap.
  $('.buffer-title').textContent = 'Feed';
  $('.buffer-meta').textContent = m.meta;
  $('.buffer-note').textContent = '';
  $('.buffer-snap span').textContent = m.snap;
  $('.buffer-loop').remove();
  $('.buffer-unfold').outerHTML = chips('reach-zoom', ['Fit', '1 min', '5 min', 'All'], m.zoom);
  // On a phone the zoom takes the inputs' row; the input is in the line.
  if (m.phone) $('.buffer-sources:not(.reach-zoom)').replaceWith($('.reach-zoom'));

  // The sends: CATCH onto the track where DROP was, then GRAB and KEEP.
  $('.buffer-drop-word').textContent = m.catchWord;
  $('.buffer-drop-sub').textContent = m.catchSub;
  const keep = $('.buffer-keep');
  keep.innerHTML = 'Keep<kbd class="buffer-kbd" aria-hidden="true">K</kbd>';
  const grab = $('.buffer-toss');
  grab.innerHTML = 'Grab<kbd class="buffer-kbd" aria-hidden="true">G</kbd>';
  keep.before(grab);

  // The foot: IN and OUT as a cue clip's, then the passes or NOW.
  const foot = $('.buffer-foot');
  foot.querySelectorAll('.buffer-gain, .buffer-shape, .buffer-hint').forEach((e) => e.remove());
  foot.insertAdjacentHTML('beforeend', `<span class="buffer-edge" role="group"><span class="buffer-edge-name" aria-hidden="true">${m.footLabel}</span>${chips('reach-foot', m.footChips, m.footLit)}</span>`);
  // On a phone the sends come straight under the window, in the thumb's
  // reach at the sheet's half height; the steps and the passes under them.
  // The sheet stands as tall as what it holds, for the mockup.
  if (m.phone) {
    $('.buffer-acts').style.order = '3';
    foot.querySelectorAll('.buffer-edge').forEach((e) => { e.style.order = '4'; });
    d.style.height = 'auto';
  }

  // The window: the feed's levels, the bar lines or the minutes, the span.
  const cv = $('canvas');
  const r = cv.getBoundingClientRect();
  const dpr = devicePixelRatio || 1;
  cv.width = Math.round(r.width * dpr);
  cv.height = Math.round(r.height * dpr);
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const colors = {
    oxide: token('--oxide', '#5b3a20'), oxideLo: token('--oxide-lo', '#4a2e19'),
    trace: token('--trace', '#f6e7c4'), grease: token('--grease-mark', '#f0c419'),
    label: token('--oxide-label', '#cdb894'), tick: token('--oxide-tick', 'rgba(255,236,210,.35)'),
    ruler: token('--oxide-ruler', '#1d1209'), shade: 'rgba(0,0,0,.55)', fade: token('--trace-hot', '#fff8e8'),
    play: token('--go', '#6faa32'), mono: token('--mono', 'monospace'), font: token('--font', 'sans-serif'),
    rec: token('--rec', '#dc322f'),
  };
  // Frames as the drawer counts them: 0 is IN; the window is [lo, hi).
  const f = (s) => Math.round(s * m.sr);
  const lo = -f(m.span.in - m.view.from), hi = f(m.view.to - m.span.in);
  const frames = f(m.span.out - m.span.in);
  const cols = Math.round(r.width);
  const levels = new Float32Array(cols);
  const per = m.levels.length / m.levelsSeconds;
  const span = m.view.to - m.view.from;
  for (let c = 0; c < cols; c++) {
    const s0 = m.view.from + (c / cols) * span, s1 = m.view.from + ((c + 1) / cols) * span;
    let v = 0;
    for (let i = Math.floor(s0 * per); i < Math.max(Math.floor(s0 * per) + 1, Math.ceil(s1 * per)); i++) v = Math.max(v, m.levels[i] ?? 0);
    // The quiet before the jam is drawn in: the demo never stops.
    if (m.quietBefore != null && s1 < m.quietBefore) v *= 0.025;
    levels[c] = v;
  }
  const lines = m.lines.map((l) => ({ frame: f(l.at - m.span.in), label: '' }));
  // The feed has no fades: their squares, the only FADE_BOX-square fills, are left out.
  const fill = ctx.fillRect.bind(ctx);
  ctx.fillRect = (x0, y0, w, h) => (w === FADE_BOX && h === FADE_BOX ? undefined : fill(x0, y0, w, h));
  drawWindow(ctx, { W: r.width, H: r.height, lo, hi, frames, lanes: [{ levels, name: '', gain: 0.9 }], lines, win: { in: 0, out: frames }, colors });
  ctx.fillRect = fill;
  // The ruler again, in the feed's words: bars or minutes, and NOW.
  const x = (s) => ((s - m.view.from) / span) * r.width;
  ctx.fillStyle = colors.ruler;
  ctx.fillRect(0, 0, r.width, RULER_H);
  ctx.font = `600 10px ${colors.mono}`;
  ctx.textBaseline = 'middle';
  for (const l of m.lines) {
    if (l.strong) { ctx.fillStyle = colors.label; ctx.fillRect(Math.round(x(l.at)), 0, 1, r.height); }
    ctx.fillStyle = l.strong ? colors.trace : colors.label;
    if (l.label && x(l.at) < r.width - 58) ctx.fillText(l.label, x(l.at) + 3, RULER_H / 2);
  }
  ctx.fillStyle = colors.rec;
  ctx.fillRect(r.width - 2, 0, 2, r.height);
  const now = '● NOW';
  ctx.fillText(now, r.width - ctx.measureText(now).width - 6, RULER_H / 2);
  // The passes, named at their starts in the oxide: −1 the newest.
  ctx.font = `700 10px ${colors.mono}`;
  ctx.textBaseline = 'top';
  for (const p of m.passes || []) {
    ctx.fillStyle = p.lit ? colors.grease : colors.label;
    ctx.fillText(p.label, x(p.at) + 5, RULER_H + 5);
  }

  // The span marked on the ribbon, as the drawer marks a clip's (.buffer-mark).
  const wrap = document.getElementById('viz-wrap');
  if (wrap && m.ribbon) {
    const st = document.createElement('style');
    // KEEP's lengths go (D1), so their pills, marks, band and readout do.
    st.textContent = '#viz-wrap .buffer-mark:not(.reach-mark), #viz-wrap .rb-layer .rb-band, #viz-wrap .rb-label, #viz-wrap .rb-mark, #viz-wrap .rb-readout { visibility: hidden; }';
    document.head.append(st);
    const mark = document.createElement('div');
    mark.className = 'buffer-mark reach-mark';
    mark.style.left = `${m.ribbon.left}%`;
    mark.style.width = `${m.ribbon.right - m.ribbon.left}%`;
    mark.innerHTML = `<span class="buffer-mark-label">${m.ribbon.label}</span>`;
    wrap.append(mark);
  }

  // Where a catch lands, outlined on the armed track's lane.
  // The lanes are fitted to the loop with a quarter more after it, so the
  // loop's bars are their first four fifths.
  const lane = document.querySelector('.tape-track.rec .tt-lane');
  if (lane && m.lands) {
    const lr = lane.getBoundingClientRect();
    const left = lr.left + 1;
    const right = m.lands === 'loop' ? lr.left + 0.8 * lr.width : lr.right - 2;
    const o = document.createElement('div');
    o.style.cssText = `position:fixed;left:${left}px;top:${lr.top + 1}px;width:${right - left}px;height:${lr.height - 2}px;border:2px dashed var(--accent);border-radius:6px;background:color-mix(in srgb, var(--accent) 14%, transparent);z-index:5;pointer-events:none;font:700 11px var(--mono);color:var(--accent-hi);display:flex;align-items:center;padding-left:8px;letter-spacing:.06em;text-transform:uppercase;white-space:nowrap;overflow:hidden`;
    o.textContent = m.landsSays;
    document.body.append(o);
  }
}

// retext puts the span's words on the keys outside the drawer, just before
// a shot: the page writes its own back on its next look.
function retext(m) {
  document.querySelectorAll('#toasts > *').forEach((t) => t.remove());
  const words = [['.buffer-grab-n', m.grabLen], ['.buffer-grab-from', m.why], ['#studio-keep-len', m.keepLen], ['#studio-keep-sub', m.why], ['.np-catch-sub', m.barSub]];
  const put = () => {
    for (const [sel, text] of words) {
      document.querySelectorAll(sel).forEach((e) => { if (!e.closest('#reach') && e.textContent !== text) e.textContent = text; });
    }
  };
  put();
  // Held against the page's own next look, which writes its words back.
  new MutationObserver(put).observe(document.body, { subtree: true, childList: true, characterData: true });
}

async function shoot(browser, name, opts, m) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await page.goto(`${base}/`);
  await page.locator('.tape-track').first().waitFor();
  await page.waitForTimeout(2500);
  await page.locator('.buffer-grab-key').first().tap();
  await page.locator('#buffer:not([hidden])').waitFor();
  await page.waitForTimeout(2000);
  await page.evaluate(dress, m);
  await page.waitForTimeout(400);
  await page.evaluate(retext, m);
  await page.screenshot({ path: `${out}${name}.png` });
  console.log('wrote', `${name}.png`);
  await ctx.close();
}

const id = await seed();
const q = `id=${encodeURIComponent(id)}`;
const env = await call('GET', '/api/envelope?buckets=1');
const ribbonAt = (age) => (1 - Math.log(Math.max(age, env.edge_seconds) / env.edge_seconds) / Math.log(env.ring_seconds / env.edge_seconds)) * 100;
const browser = await chromium.launch();
const tablet = { viewport: { width: 1280, height: 800 }, hasTouch: true, deviceScaleFactor: 1 };
const phone = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 };

// The pass: the tape playing its 4-bar loop; IN and OUT on the last pass.
{
  const live = (await call('GET', `/api/tapes/state?${q}`));
  const loop = live.tape.grid.frames;
  const into = (((live.live.heard % loop) + loop) % loop) / SR; // s into this pass
  const fd = await feed(50, 2400);
  const now = fd.seconds;
  const passEnd = now - into;
  const view = { from: passEnd - 3 * PASS - 2.5, to: now };
  const lines = [];
  const passes = [];
  for (let k = 3; k >= 0; k--) {
    const start = passEnd - k * PASS;
    for (let b = 0; b < 4; b++) {
      const at = start + b * BAR;
      if (at > view.from && at < view.to) lines.push({ at, label: String(b + 1), strong: b === 0 });
    }
    if (k) passes.push({ at: start, label: `PASS −${k}`, lit: k === 1 });
  }
  const m = {
    sr: SR, levels: fd.levels, levelsSeconds: fd.seconds, view, lines, passes,
    span: { in: passEnd - PASS, out: passEnd },
    meta: 'the last pass · 4 bars · 10.0 s · 96 BPM', snap: 'Pass', zoom: 'Fit',
    catchWord: 'Catch onto track 2', catchSub: 'bars 1–4 · layered',
    footLabel: 'Pass', footChips: ['−4', '−3', '−2', '−1'], footLit: '−1',
    why: 'the last pass', grabLen: '4 BARS', keepLen: '10s', barSub: 'last pass → 2',
    lands: 'loop', landsSays: 'Catch lands here · bars 1–4',
    ribbon: { left: ribbonAt(into + PASS), right: ribbonAt(into), label: '−1' },
  };
  await shoot(browser, 'tablet-pass', tablet, m);
  await shoot(browser, 'tablet-pass-dark', { ...tablet, colorScheme: 'dark' }, m);
  await shoot(browser, 'phone-pass', phone, { ...m, phone: true, meta: 'the last pass · 4 bars · from main', catchWord: 'Catch onto 2', footLabel: '', passes: m.passes.map((p) => ({ ...p, label: p.label.replace('PASS ', '') })) });
}

// The jam: the tape stopped at bar 1; IN where the playing began, 6:12 ago;
// OUT on NOW.
{
  await call('POST', `/api/tapes/transport?${q}`, { action: 'stop' });
  await call('POST', `/api/tapes/transport?${q}`, { action: 'locate', pos: 0 }).catch(() => {});
  const fd = await feed(VIEW, 2400);
  const now = fd.seconds;
  const view = { from: now - VIEW, to: now };
  const lines = [];
  for (let min = 8; min >= 1; min--) lines.push({ at: now - min * 60, label: `${min}m`, strong: false });
  const m = {
    sr: SR, levels: fd.levels, levelsSeconds: fd.seconds, view, lines,
    span: { in: now - JAM, out: now }, quietBefore: now - JAM - 0.3,
    meta: 'since you started · 6:12 · from main', snap: 'Attack', zoom: 'Fit',
    catchWord: 'Catch onto track 2', catchSub: 'at bar 1 · runs past the loop',
    footLabel: 'Out', footChips: ['on NOW'], footLit: 'on NOW',
    why: 'since you started', grabLen: '6:12', keepLen: '6:12', barSub: '6:12 → 2',
    lands: 'past', landsSays: 'Catch lands here · from bar 1, 6:12 →',
    ribbon: { left: ribbonAt(JAM), right: 100, label: '6:12' },
  };
  await shoot(browser, 'tablet-jam', tablet, m);
  await shoot(browser, 'phone-jam', phone, { ...m, phone: true, meta: 'since you started · 6:12 · main', catchWord: 'Catch onto 2' });
  await call('POST', `/api/tapes/transport?${q}`, { action: 'play' });
}

await browser.close();
