// web/static/lib/shelf.js
// What the takes page shows: which takes match the search and the filters,
// in what order, under which day. Pure, so it is tested without a browser.
//
// The server lists starred takes first (lib/takes.js keeps that order for
// the main page); the shelf groups by day instead, so a starred take sits
// on the day it was played and the Starred filter is how to see them alone.

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const stamp = (t) => t.name.replace(/^jam_|\.wav$/g, '');

/** when is a take's created time in ms, or NaN when it has none to read. */
function when(t) {
  return t.created ? Date.parse(t.created) : NaN;
}

/**
 * matches says whether a take passes the search and every filter that is
 * on. The search looks at the label, the timestamp in the name and the tempo.
 */
export function matches(t, { query = '', starred = false, midi = false, phone = false, tape = false } = {}) {
  if (starred && !t.starred) return false;
  if (midi && !t.has_midi) return false;
  if (phone && t.origin !== 'phone') return false;
  if (tape && t.origin !== 'tape') return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [t.label || '', stamp(t), t.bpm == null ? '' : t.bpm.toFixed(1)].join(' ').toLowerCase();
  return hay.includes(q);
}

// dayKey is a local calendar day, comparable as a number.
const dayKey = (d) => d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();

function dayLabel(ms, now) {
  const d = new Date(ms), today = new Date(now);
  const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
  const short = `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  if (dayKey(d) === dayKey(today)) return `TODAY · ${short}`;
  if (dayKey(d) === dayKey(yesterday)) return `YESTERDAY · ${short}`;
  if (d.getFullYear() !== today.getFullYear()) return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  return short;
}

/**
 * shelve filters the takes and puts them in groups to show: by day, newest
 * first, or with sort 'longest' in one group, longest first. A take with no
 * readable date goes in a last group, EARLIER.
 */
export function shelve(takes, opts = {}, now = Date.now()) {
  const shown = takes.filter((t) => matches(t, opts));
  if (!shown.length) return [];
  if (opts.sort === 'longest') {
    return [{ label: 'LONGEST FIRST', takes: [...shown].sort((a, b) => (b.duration_seconds || 0) - (a.duration_seconds || 0)) }];
  }
  const dated = shown.filter((t) => !Number.isNaN(when(t))).sort((a, b) => when(b) - when(a));
  const undated = shown.filter((t) => Number.isNaN(when(t)));
  const groups = [];
  for (const t of dated) {
    const label = dayLabel(when(t), now);
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.takes.push(t);
    else groups.push({ label, takes: [t] });
  }
  if (undated.length) groups.push({ label: 'EARLIER', takes: undated });
  return groups;
}

/** latest is the newest take by when it was made, or null for none. */
/** newest is the `n` newest takes, newest first; a take with no date goes last. */
export function newest(takes, n) {
  const at = (t) => { const w = when(t); return Number.isNaN(w) ? -Infinity : w; };
  return [...takes].sort((a, b) => at(b) - at(a)).slice(0, n);
}

export function latest(takes) {
  let best = null;
  for (const t of takes) {
    if (!best || when(t) > when(best) || (Number.isNaN(when(best)) && !Number.isNaN(when(t)))) best = t;
  }
  return best;
}

/**
 * listFrom is the list a take page was opened from -- '/' or '/takes.html'
 * -- read off the referrer, or null when it came from anywhere else.
 */
export function listFrom(referrer, origin) {
  try {
    const ref = new URL(referrer);
    if (ref.origin !== origin) return null;
    return ref.pathname === '/' || ref.pathname === '/takes.html' ? ref.pathname : null;
  } catch {
    return null;
  }
}

/** flagChips is a take's flags in time order: each one's label, m:ss into the take, and frame. */
export function flagChips(take) {
  const sr = take.sample_rate || 48000;
  return [...(take.flags || [])].sort((a, b) => a.frame - b.frame).map((f) => {
    const s = Math.floor(f.frame / sr);
    return { label: f.label || 'flag', at: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`, frame: f.frame };
  });
}

/**
 * parseBpm reads a tempo typed by hand: empty clears it (null, which the
 * server reads as "clear"), a positive number sets it, anything else is
 * refused -- 0 would store a tempo no take can have.
 */
export function parseBpm(raw) {
  const t = String(raw).trim();
  if (t === '') return { ok: true, value: null };
  const v = Number(t);
  return Number.isFinite(v) && v > 0 ? { ok: true, value: v } : { ok: false };
}

/**
 * sheetState is what the phone's cassette sheet does next: which take is
 * open, and what to do to history. Opening pushes one entry (another take
 * replaces it), so the device's Back closes the sheet; its own key goes back,
 * and the popstate that follows finds it closed already.
 */
export function sheetState(prev, ev) {
  switch (ev.type) {
    case 'open': return { open: ev.name, history: prev.open ? 'replace' : 'push' };
    case 'close': return { open: null, history: prev.open ? 'back' : null };
    // Back lands on an entry without a cassette; Forward on one with.
    case 'popstate': return { open: ev.state?.cassette ?? null, history: null };
    // Wide enough for the pane: the sheet goes, and its entry with it.
    case 'widen': return { open: null, history: prev.open ? 'back' : null };
    default: return { open: prev.open, history: null };
  }
}

/**
 * spineTitle is what a spine prints: the take's name, or -- for one never
 * named -- the time it was caught, which is what tells today's takes apart
 * (the rack already groups them by day). The full name stays in its label.
 */
export function spineTitle(take) {
  if (take.label) return take.label;
  const m = /_(\d{2})(\d{2})(\d{2})\.wav$/.exec(take.name || '');
  return m ? `${m[1]}:${m[2]}:${m[3]}` : (take.name || '').replace(/^jam_|\.wav$/g, '');
}
