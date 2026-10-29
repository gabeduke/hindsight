// web/static/lib/play/latency.js
// What the Pi has measured of control to ear, in words: the Rig's line and
// the dev overlay (docs/plan/the-instrument.md, step 1).
//
// The Pi times every press, set and release to the moment it is heard
// (internal/tape/latency.go) and keeps the figures; GET /api/latency says
// them. Nothing here measures: it reads, and draws. Each way in to each ear
// is a path: a page's touch to the jam room's speakers, to the phone
// listening, a controller on the Pi to the room.

const WAYS = { page: 'Page', midi: 'Controller' };
const EARS = { room: 'room', phone: 'phone' };

const ms = (x) => `${Math.round(x)} ms`;

/** pathName is a path in words: "Controller → room". */
export function pathName(p) {
  return `${WAYS[p.via] ?? p.via} → ${EARS[p.ear] ?? p.ear}`;
}

/** spreadText is a figure's median, 95th percentile and worst. */
export function spreadText(s) {
  if (!s || !s.n) return '–';
  return `${ms(s.p50_ms)} (95% ${Math.round(s.p95_ms)}, worst ${Math.round(s.max_ms)})`;
}

/** gaps is every underflow so far, the phone's with them. */
function gaps(u = {}) {
  return (u.render || 0) + (u.device || 0) + (u.phone || 0);
}

/**
 * line is the Rig's: each path's total, then what it was taken with. Empty
 * until anything has been timed.
 */
export function line(rep) {
  if (!rep?.paths?.length) return '';
  const paths = rep.paths.map((p) => `${pathName(p)} ${spreadText(p.total)}`);
  const b = rep.buffers || {};
  const taken = [`rendered ${ms(b.ahead_ms ?? 0)} ahead`, `the device asked for ${ms(b.output_latency_ms ?? 0)}`];
  if (rep.phone) taken.push(`the phone buffers ${ms(rep.phone.fill_ms)}`);
  const g = gaps(rep.underflows);
  taken.push(g === 1 ? '1 underflow' : `${g} underflows`);
  return `Control to ear: ${paths.join(' · ')}; ${taken.join(', ')}.`;
}

/**
 * rows are the overlay's: a path a row, with its legs, then the buffers.
 * Each is [label, text].
 */
export function rows(rep) {
  if (!rep) return [['latency', 'the Pi did not answer']];
  const out = [];
  for (const p of rep.paths || []) {
    out.push([pathName(p), `${spreadText(p.total)} · n ${p.count}`]);
    const legs = [];
    if (p.touch_to_send) legs.push(`page ${Math.round(p.touch_to_send.p50_ms)}`);
    if (p.send_to_pi) legs.push(`wi-fi ${Math.round(p.send_to_pi.p50_ms)}`);
    legs.push(`pi→ear ${Math.round(p.pi_to_ear?.p50_ms ?? 0)}`);
    out.push(['', legs.join(' · ')]);
  }
  if (!out.length) out.push(['latency', 'nothing timed yet: play a pad']);
  const b = rep.buffers || {};
  out.push(['buffers', `ahead ${ms(b.ahead_ms ?? 0)} · device ${ms(b.output_latency_ms ?? 0)}${Number.isFinite(b.lead_ms) ? ` · lead ${ms(b.lead_ms)}` : ''}`]);
  if (rep.phone) out.push(['phone', `buffer ${ms(rep.phone.fill_ms)} · output ${ms(rep.phone.output_ms)}`]);
  const u = rep.underflows || {};
  out.push(['underflows', `render ${u.render || 0} · device ${u.device || 0}${u.phone != null ? ` · phone ${u.phone}` : ''}`]);
  if (rep.quantised) out.push(['quantised', `${rep.quantised} waited for a line, not timed`]);
  return out;
}

/** fetchLatency asks the Pi; null when it doesn't answer. */
export async function fetchLatency(fetchFn = (...a) => globalThis.fetch(...a)) {
  try {
    const r = await fetchFn('/api/latency', { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

/**
 * poll calls draw with the Pi's figures every `every` ms while the page is
 * shown, and returns a stop.
 */
function poll(draw, { fetchFn, every, doc, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null;
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    if (!doc?.hidden) draw(await fetchLatency(fetchFn));
    if (!stopped) timer = setTimer(tick, every);
  };
  tick();
  return () => { stopped = true; clearTimer(timer); };
}

/** mountLine keeps the Rig's line, `el`, current; hidden while it is empty. */
export function mountLine(el, { fetchFn, every = 2000, doc = globalThis.document, ...timers } = {}) {
  return poll((rep) => {
    const text = line(rep);
    el.textContent = text;
    el.hidden = !text;
  }, { fetchFn, every, doc, ...timers });
}

/** mountOverlay puts the dev overlay over the page, a second at a time. */
export function mountOverlay(doc = globalThis.document, { fetchFn, every = 1000, ...timers } = {}) {
  if (!doc?.body || doc.getElementById('latency-overlay')) return () => {};
  const box = doc.createElement('div');
  box.id = 'latency-overlay';
  box.className = 'latency-overlay';
  box.setAttribute('role', 'status');
  box.setAttribute('aria-label', 'Latency');
  doc.body.append(box);
  return poll((rep) => {
    box.replaceChildren(...rows(rep).map(([k, v]) => {
      const row = doc.createElement('div');
      const b = doc.createElement('b');
      b.textContent = k;
      row.append(b, doc.createTextNode(` ${v}`));
      return row;
    }));
  }, { fetchFn, every, doc, ...timers });
}
