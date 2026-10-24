// A snapshot of what the stylesheets do to the app: every element's
// computed style (and its ::before and ::after) on the main screens, at a
// tablet, a phone and a desktop, in both schemes. Take one before a change
// to the CSS that should change nothing, and diff against it after:
//
//   node scripts/css-snapshot.mjs --out=/tmp/before.json
//   …edit web/static/styles.css…
//   node scripts/css-snapshot.mjs --diff=/tmp/before.json   # exit 1 on any difference
//
// It boots its own demo as the flows do (scripts/flows/harness.mjs: `go run
// ./cmd/hindsight --demo`, or HINDSIGHT_BIN; STATIC_DIR serves another
// tree), seeds two takes and a tape through the API, and visits each screen
// in a fresh page. --diff prints each element and property that differs,
// before → after; --from=file diffs a saved snapshot instead of taking one;
// --only=phone/dark (a prefix of "profile/scheme/screen") narrows the run.
//
// The same tree gives the same snapshot: run it twice and the diff is
// empty. What would make it flaky is fixed or masked, the same way on every
// run, before anything is read:
//   - the seed: the takes are named and tagged (an untagged take's stripe,
//     and its cassette's tone, hang on its file name, which is the time it
//     was cut; the tones are dealt out in shelf order), and the take page
//     gets the same two lanes of notes (the demo's sequencer plays on, so
//     what a take caught of it varies);
//   - text: every run of digits reads 0 (clocks, counters, durations, dates,
//     the meters' dB, the ring's "3S AGO"), and Capture's "last saved" (a
//     file name) and the ribbon's readout (its words hang on how much the
//     ring holds at that moment: "last 30s", or "— only 12s buffered")
//     fixed ones, so a second's difference doesn't change a box's width;
//   - live inline styles: every number in a `style` attribute reads 0 (the
//     reels' turn, the needles, the playheads, the meters' fill, a canvas's
//     size), as the ticker and the polls write them at every frame;
//   - the rig's ropes are drawn as a point, as each run's physics settles
//     them a little differently;
//   - toasts are taken out, as they come and go on a timer;
//   - animations and transitions, last: a finite one is finished, an
//     endless one held at its start, so nothing is read mid-flight;
//   - the pointer is parked in the window's bottom-right corner.
// What a mask hides is hidden before and after alike, so a stylesheet that
// changed what one of those draws still shows wherever else it reaches.
//
// Dev only: nothing here ships.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { apiFor, bootDemo, PROFILES } from './flows/harness.mjs';

const args = process.argv.slice(2);
const opt = (k) => args.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const out = opt('out');
const against = opt('diff');
const from = opt('from');
const only = opt('only');
if (!out && !against) {
  console.error('usage: node scripts/css-snapshot.mjs --out=snapshot.json | --diff=snapshot.json [--from=other.json] [--only=phone/dark]');
  process.exit(2);
}

const SCHEMES = ['light', 'dark'];

// The take page's notes (see capture): a bass line and a drum pattern.
const MIDI = {
  ppq: 960, sample_rate: 48000, frames: 240000, tempo: [{ frame: 0, bpm: 96 }], downbeat_frame: 0,
  tracks: [
    { name: 'Demo sequencer ch1', device: 'Demo sequencer', channel: 1, kind: 'notes',
      notes: [{ s: 0, e: 120000, p: 43, v: 100 }, { s: 120000, e: 240000, p: 45, v: 100 }] },
    { name: 'Demo sequencer ch10', device: 'Demo sequencer', channel: 10, kind: 'drums',
      notes: Array.from({ length: 16 }, (_, i) => ({ s: i * 15000, e: i * 15000 + 4800, p: i % 2 ? 42 : 36, v: i % 2 ? 80 : 120 })) },
  ],
};

// The screens: where each starts, what is done there, and which profiles
// it is for. `ready` is what the screen has once it has drawn.
const SCREENS = [
  { id: 'studio', path: '/tape.html', ready: '.tt-lane' },
  { id: 'studio-menu', path: '/tape.html', ready: '.tt-lane', act: (p, tap) => tap(p.locator('#app-menu-btn')), done: '#app-menu:not([hidden])' },
  { id: 'studio-more', path: '/tape.html', ready: '.tt-lane', act: (p, tap) => tap(p.locator('#tape-more')), done: '#tape-more[aria-expanded="true"]' },
  { id: 'studio-player', path: '/tape.html', ready: '#np-expand', profiles: ['phone'], act: (p, tap) => tap(p.locator('#np-expand')), done: 'body.player-open' },
  { id: 'room', path: '/takes.html', ready: '#view-room .room-cassette' },
  { id: 'room-menu', path: '/takes.html', ready: '#view-room .room-cassette', act: (p, tap) => tap(p.locator('#app-menu-btn')), done: '#app-menu:not([hidden])' },
  { id: 'take', path: (seed) => `/wave.html?file=${encodeURIComponent(seed.takes[0])}`, ready: '#take-name' },
  // Capture is the Studio's tab with the tape off: the Pi says so with a 404.
  { id: 'capture', path: '/', ready: '#view-capture:not([hidden])', tapeOff: true },
  { id: 'rig', path: '/rig.html', ready: '#rig-desk .rig-sock' },
];

// In the page: mask what moves, then read every element's computed style.
// It answers tables (properties, values, styles) and one row per element:
// [path, own, ::before, ::after], each style an index, -1 for a pseudo
// element with no content.
function read() {
  for (const el of document.querySelectorAll('#toasts > *')) el.remove();
  // Capture's "last saved" is the newest take's file name, which is the time.
  for (const el of document.querySelectorAll('#last-saved')) el.textContent = 'jam.wav';
  // The ribbon's readout says whether the ring holds the span yet, which
  // depends on when the page was read.
  for (const el of document.querySelectorAll('.rb-readout')) el.textContent = 'last 0s';
  // The rig's ropes hang where their physics settled, a little differently
  // each time.
  for (const el of document.querySelectorAll('.rig-wires path')) el.setAttribute('d', 'M 0 0');
  // A cassette's J-card tone hangs on its file's name, which is the time it
  // was cut: deal the four out in shelf order instead.
  document.querySelectorAll('.room-cassette').forEach((el, i) => {
    for (const c of [...el.classList]) if (/^room-tone-\d+$/.test(c)) el.classList.replace(c, `room-tone-${i % 4}`);
  });
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (/\d/.test(n.data)) n.data = n.data.replace(/[-−]?\d+/g, '0');
  }
  for (const el of document.querySelectorAll('[style]')) {
    const s = el.getAttribute('style');
    // A number, not a digit in a name (var(--stripe-3) stays itself).
    const z = s.replace(/(?<![\w-])-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/gi, '0');
    if (z !== s) el.setAttribute('style', z);
  }
  // Last, as what was masked may have started a transition of its own.
  void document.body.offsetWidth;
  for (const a of document.getAnimations()) {
    try { a.finish(); } catch { a.pause(); a.currentTime = 0; }
  }
  const props = new Map(), values = new Map(), styles = new Map();
  const index = (map, k) => {
    let i = map.get(k);
    if (i === undefined) map.set(k, (i = map.size));
    return i;
  };
  const styleOf = (cs) => {
    const flat = [];
    for (let i = 0; i < cs.length; i++) {
      const p = cs[i];
      flat.push(index(props, p), index(values, cs.getPropertyValue(p)));
    }
    return index(styles, flat.join(','));
  };
  const pseudo = (el, which) => {
    const cs = getComputedStyle(el, which);
    return cs.content === 'none' || cs.content === 'normal' ? -1 : styleOf(cs);
  };
  const unique = (id) => { try { return document.querySelectorAll(`#${CSS.escape(id)}`).length === 1; } catch { return false; } };
  const pathOf = (el) => {
    const parts = [];
    for (let e = el; e; e = e.parentElement) {
      if (e.id && unique(e.id)) { parts.unshift(`#${e.id}`); break; }
      let n = 0, of = 0;
      for (const s of e.parentElement ? e.parentElement.children : [e]) {
        if (s.localName !== e.localName) continue;
        of++;
        if (s === e) n = of;
      }
      parts.unshift(of > 1 ? `${e.localName}[${n}]` : e.localName);
    }
    return parts.join('>');
  };
  const rows = [];
  for (const el of [document.documentElement, document.body, ...document.body.querySelectorAll('*')]) {
    rows.push([pathOf(el), styleOf(getComputedStyle(el)), pseudo(el, '::before'), pseudo(el, '::after')]);
  }
  return { props: [...props.keys()], values: [...values.keys()], styles: [...styles.keys()], rows };
}

async function seed(api) {
  // Two takes, named and tagged, so the shelf has a pair whose names are
  // the same words on every run, and whose stripes are their tags' (an
  // untagged take's stripe hangs on its file's name, which is the time).
  await api.put('/api/tags', { tags: [{ id: 't5a0001', name: 'Snap', color: 3 }, { id: 't5a0002', name: 'Shot', color: 6 }] });
  const takes = [];
  for (const [label, tag] of [['Snapshot one', 't5a0001'], ['Snapshot two', 't5a0002']]) {
    const t = await api.keep(5);
    await api.patch(`/api/take?file=${encodeURIComponent(t.name)}`, { label, tag });
    takes.push(t.name);
  }
  // A tape with the first take's first two bars on track 1, so the lanes
  // and the bar have something on them.
  const tape = await api.tape('Snapshot', 96, 4);
  const st = await api.tapeState();
  const bar = st.grid.frames / st.grid.bars;
  const first = (await api.takes()).find((t) => t.name === takes[0]);
  const to = Math.min(Math.round(2 * bar), Math.floor(first.duration_seconds * first.sample_rate));
  await api.post(`/api/tapes/drop?id=${encodeURIComponent(tape.id)}`, { take: takes[0], from: 0, to, track: 1, at: st.loop.in });
  return { takes };
}

async function capture(browser, base, seeded, profile, scheme, screen) {
  const context = await browser.newContext({ ...PROFILES[profile], colorScheme: scheme, serviceWorkers: 'block' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // A take's notes are the demo sequencer's, as it played while the take was
  // cut, so which lanes it has, in what order, changes from run to run: the
  // take page is given the same two lanes every time.
  await page.route(/\/api\/midi\?/, (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(MIDI) }));
  if (screen.tapeOff) {
    await context.addInitScript(() => { try { localStorage.setItem('hindsight.tapeOn', 'false'); } catch { /* fine */ } });
    await page.route(/\/api\/tapes(\?.*)?$/, (r) => r.fulfill({ status: 404, body: 'no tape' }));
  }
  const tap = (loc) => (PROFILES[profile].hasTouch ? loc.tap() : loc.click());
  try {
    const path = typeof screen.path === 'function' ? screen.path(seeded) : screen.path;
    await page.goto(`${base}${path}`);
    await page.locator(screen.ready).first().waitFor({ state: 'attached', timeout: 15_000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1500);
    if (screen.act) {
      await screen.act(page, tap);
      await page.locator(screen.done).first().waitFor({ state: 'attached', timeout: 5000 });
      await page.waitForTimeout(800);
    }
    const { width, height } = PROFILES[profile].viewport;
    if (!PROFILES[profile].hasTouch) await page.mouse.move(width - 1, height - 1);
    await page.waitForTimeout(300);
    return { ...await page.evaluate(read), errors };
  } finally {
    await context.close();
  }
}

// The snapshot keeps each distinct style once, as its differences from the
// commonest value of each property, and each element as a hash of its
// three styles and their indexes.
function pack(screens) {
  const props = new Map(), values = new Map();
  const index = (map, k) => {
    let i = map.get(k);
    if (i === undefined) map.set(k, (i = map.size));
    return i;
  };
  const decoded = []; // global style id -> Map(prop -> value)
  const ids = new Map(); // style string -> global style id
  const rowsOf = {};
  for (const [key, snap] of Object.entries(screens)) {
    const local = snap.styles.map((s) => {
      const nums = s ? s.split(',').map(Number) : [];
      const pairs = [];
      for (let i = 0; i < nums.length; i += 2) pairs.push([index(props, snap.props[nums[i]]), index(values, snap.values[nums[i + 1]])]);
      const k = pairs.map((p) => p.join(':')).join(',');
      let id = ids.get(k);
      if (id === undefined) {
        ids.set(k, (id = decoded.length));
        decoded.push(new Map(pairs));
      }
      return id;
    });
    rowsOf[key] = snap.rows.map(([path, own, before, after]) => [path, local[own], before < 0 ? -1 : local[before], after < 0 ? -1 : local[after]]);
  }
  // The commonest value of each property, over every style.
  const counts = [...props.keys()].map(() => new Map());
  for (const m of decoded) for (const [p, v] of m) counts[p].set(v, (counts[p].get(v) || 0) + 1);
  const base = counts.map((c) => [...c].sort((a, b) => b[1] - a[1])[0]?.[0] ?? -1);
  const styles = decoded.map((m) => {
    const d = [];
    for (let p = 0; p < base.length; p++) {
      const v = m.has(p) ? m.get(p) : -1;
      if (v !== base[p]) d.push(p, v);
    }
    return d;
  });
  // A hash of what the styles say, by property name, so it doesn't hang on
  // the order the tables were filled in or on the commonest values.
  const names = [...props.keys()], vals = [...values.keys()];
  const canon = decoded.map((m) => [...m].map(([p, v]) => `${names[p]}:${vals[v]}`).sort().join(';'));
  const hash = (own, before, after) => createHash('sha1').update(`${canon[own]}|${before < 0 ? '' : canon[before]}|${after < 0 ? '' : canon[after]}`).digest('hex').slice(0, 16);
  const shots = {};
  for (const [key, rows] of Object.entries(rowsOf)) {
    shots[key] = {};
    for (const [path, own, before, after] of rows) {
      // Two elements on one path (an id used twice): keep both, numbered.
      let k = path, n = 1;
      while (shots[key][k]) k = `${path}#${++n}`;
      shots[key][k] = [hash(own, before, after), own, before, after];
    }
  }
  return { version: 1, props: [...props.keys()], values: [...values.keys()], base, styles, screens: shots };
}

/** styleOf is one style of a packed snapshot, as { prop: value }. */
function styleOf(snap, id) {
  if (id < 0) return null;
  const out = {};
  snap.base.forEach((v, p) => { if (v >= 0) out[snap.props[p]] = snap.values[v]; });
  const d = snap.styles[id];
  for (let i = 0; i < d.length; i += 2) {
    const p = snap.props[d[i]];
    if (d[i + 1] < 0) delete out[p];
    else out[p] = snap.values[d[i + 1]];
  }
  return out;
}

function diff(before, after) {
  const lines = [];
  let elements = 0;
  for (const key of new Set([...Object.keys(before.screens), ...Object.keys(after.screens)])) {
    const a = before.screens[key], b = after.screens[key];
    if (!a || !b) { lines.push(`${key}: only ${a ? 'before' : 'after'}`); continue; }
    for (const path of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const x = a[path], y = b[path];
      if (!x || !y) { elements++; lines.push(`${key}  ${path}: only ${x ? 'before' : 'after'}`); continue; }
      if (x[0] === y[0]) continue;
      elements++;
      ['', '::before', '::after'].forEach((pseudo, i) => {
        const s = styleOf(before, x[i + 1]), t = styleOf(after, y[i + 1]);
        if (!s && !t) return;
        if (!s || !t) { lines.push(`${key}  ${path}${pseudo}: ${s ? 'drawn' : 'none'} → ${t ? 'drawn' : 'none'}`); return; }
        for (const p of new Set([...Object.keys(s), ...Object.keys(t)])) {
          if (s[p] !== t[p]) lines.push(`${key}  ${path}${pseudo}  ${p}: ${s[p] ?? '(none)'} → ${t[p] ?? '(none)'}`);
        }
      });
    }
  }
  return { lines, elements };
}

let snap;
if (from) {
  snap = JSON.parse(readFileSync(from, 'utf8'));
} else {
  const demo = await bootDemo({ log: console.log });
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const screens = {};
  try {
    const seeded = await seed(apiFor(demo.base));
    for (const profile of ['tablet', 'phone', 'desktop']) {
      for (const scheme of SCHEMES) {
        for (const screen of SCREENS) {
          if (screen.profiles && !screen.profiles.includes(profile)) continue;
          const key = `${profile}/${scheme}/${screen.id}`;
          if (only && !key.startsWith(only)) continue;
          const got = await capture(browser, demo.base, seeded, profile, scheme, screen);
          for (const e of got.errors) console.log(`  ${key}: page error: ${e}`);
          screens[key] = got;
          console.log(`${key}: ${got.rows.length} elements, ${got.styles.length} styles`);
        }
      }
    }
  } finally {
    await browser.close();
    demo.stop();
  }
  snap = pack(screens);
}
if (out) {
  writeFileSync(out, JSON.stringify(snap));
  console.log(`wrote ${out}: ${Object.keys(snap.screens).length} screens, ${Object.values(snap.screens).reduce((n, s) => n + Object.keys(s).length, 0)} elements, ${snap.styles.length} styles`);
}
if (against) {
  const before = JSON.parse(readFileSync(against, 'utf8'));
  // A narrowed run is compared with the same part of the other.
  if (only) for (const k of Object.keys(before.screens)) if (!k.startsWith(only)) delete before.screens[k];
  const { lines, elements } = diff(before, snap);
  const MAX = 400;
  for (const l of lines.slice(0, MAX)) console.log(l);
  if (lines.length > MAX) console.log(`… and ${lines.length - MAX} more lines`);
  console.log(lines.length ? `${elements} elements differ (${lines.length} lines)` : 'no difference');
  process.exit(lines.length ? 1 : 0);
}
