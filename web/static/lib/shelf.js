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

/** tagOf is the tag a take carries, or null: untagged, or tagged with one the list has dropped. */
export function tagOf(t, tags = []) {
  return (t.tag && tags.find((g) => g.id === t.tag)) || null;
}

/** tagCounts is how many of the takes carry each tag, by id, with '' for untagged. */
export function tagCounts(takes, tags = []) {
  const n = { '': 0 };
  for (const g of tags) n[g.id] = 0;
  for (const t of takes) n[tagOf(t, tags)?.id ?? '']++;
  return n;
}

/**
 * matches says whether a take passes the search and every filter that is
 * on. The search looks at the label, the timestamp in the name, the tempo and
 * the tag's name. `tag` is a tag's id, or 'none' for the untagged; '' is off.
 */
export function matches(t, { query = '', starred = false, midi = false, phone = false, tape = false, tag = '', tags = [] } = {}) {
  if (starred && !t.starred) return false;
  if (tag) {
    const own = tagOf(t, tags);
    if (tag === 'none' ? own : own?.id !== tag) return false;
  }
  if (midi && !t.has_midi) return false;
  if (phone && t.origin !== 'phone') return false;
  if (tape && t.origin !== 'tape') return false;
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = [t.label || '', stamp(t), t.bpm == null ? '' : t.bpm.toFixed(1), tagOf(t, tags)?.name || ''].join(' ').toLowerCase();
  return hay.includes(q);
}

// --- families: cuts and mixdowns fold into a spine ---------------------------

const atMs = (t) => { const w = when(t); return Number.isNaN(w) ? -Infinity : w; };
const isMix = (t) => t.origin === 'tape';
// A tape's mixdowns share its id; ones made before tape_id share its name.
const tapeKey = (t) => (t.tape_id ? `id:${t.tape_id}` : `label:${t.label || ''}`);

/**
 * fold decides which takes stand on the shelf. A cut folds into the take it
 * was cut from (the first one up its line that is in `takes`); mixdowns of
 * one tape fold into the newest of them. `shelf` keeps the input's order;
 * `cuts` (oldest first) and `mixes` (newest first) are keyed by the spine
 * they fold into; `under` maps each folded take to that spine.
 */
export function fold(takes) {
  const byName = new Map(takes.map((t) => [t.name, t]));
  const newestMix = new Map();
  for (const t of takes) {
    if (!isMix(t)) continue;
    const k = tapeKey(t), cur = newestMix.get(k);
    if (!cur || atMs(t) > atMs(cur) || (atMs(t) === atMs(cur) && t.name > cur.name)) newestMix.set(k, t);
  }
  const mixUnder = new Map();
  for (const t of takes) {
    const s = isMix(t) && newestMix.get(tapeKey(t));
    if (s && s !== t) mixUnder.set(t.name, s);
  }
  // Up the line to the first take, then to the mix that stands in for it.
  // A line that loops (no real list has one) leaves the take on the shelf.
  const spineOf = (t) => {
    const seen = new Set([t.name]);
    let cur = t;
    for (;;) {
      const up = mixUnder.get(cur.name) || (cur.source && byName.get(cur.source.name));
      if (!up) return cur;
      if (seen.has(up.name)) return t;
      seen.add(up.name);
      cur = up;
    }
  };
  const under = new Map([...mixUnder].map(([n, s]) => [n, s.name]));
  for (const t of takes) {
    if (!t.source) continue;
    const s = spineOf(t);
    if (s !== t) under.set(t.name, s.name);
  }
  const cuts = new Map(), mixes = new Map();
  for (const t of takes) {
    const s = under.get(t.name);
    if (!s) continue;
    const m = t.source ? cuts : mixes;
    if (!m.has(s)) m.set(s, []);
    m.get(s).push(t);
  }
  for (const l of cuts.values()) l.sort((a, b) => atMs(a) - atMs(b));
  for (const l of mixes.values()) l.sort((a, b) => atMs(b) - atMs(a));
  return { shelf: takes.filter((t) => !under.has(t.name)), cuts, mixes, under };
}

/** membersOf is each spine's folded takes: its cuts, then its earlier mixes. */
export function membersOf(f, spines) {
  const m = new Map();
  for (const t of spines) {
    const l = [...(f.cuts.get(t.name) || []), ...(f.mixes.get(t.name) || [])];
    if (l.length) m.set(t.name, l);
  }
  return m;
}

/** familyOf is the spine a take is on, and that spine's cuts and earlier mixes. */
export function familyOf(f, name) {
  const spineName = f.under.get(name) || name;
  const spine = f.shelf.find((t) => t.name === spineName) || null;
  return { spine, cuts: f.cuts.get(spineName) || [], mixes: f.mixes.get(spineName) || [] };
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
 * shelve filters the takes, folds what's left (see fold), and puts the spines
 * in groups to show: by day, newest first; with sort 'longest' in one group,
 * longest first; with sort 'tag' one group per tag. A take with no readable
 * date goes in a last group, EARLIER. Each group's `members` holds, for each
 * of its spines with a family, the takes folded into it.
 */
export function shelve(takes, opts = {}, now = Date.now()) {
  const f = fold(takes.filter((t) => matches(t, opts)));
  if (!f.shelf.length) return [];
  return shelveGroups(f.shelf, opts, now).map((g) => ({ ...g, members: membersOf(f, g.takes) }));
}

function shelveGroups(shown, opts, now) {
  if (opts.sort === 'longest') {
    return [{ label: 'LONGEST FIRST', takes: [...shown].sort((a, b) => (b.duration_seconds || 0) - (a.duration_seconds || 0)) }];
  }
  if (opts.sort === 'tag') {
    // One group per tag, in the list's order, newest first inside; the
    // untagged last. A tag nobody wears gets no heading.
    const tags = opts.tags || [];
    const newestFirst = (a, b) => (Number.isNaN(when(b)) ? -Infinity : when(b)) - (Number.isNaN(when(a)) ? -Infinity : when(a));
    const groups = [];
    for (const g of tags) {
      const mine = shown.filter((t) => tagOf(t, tags)?.id === g.id).sort(newestFirst);
      if (mine.length) groups.push({ label: g.name.toUpperCase(), tag: g.id, takes: mine });
    }
    const none = shown.filter((t) => !tagOf(t, tags)).sort(newestFirst);
    if (none.length) groups.push({ label: tags.length ? 'UNTAGGED' : 'NO TAGS YET', tag: '', takes: none });
    return groups;
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
