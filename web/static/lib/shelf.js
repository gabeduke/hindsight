// web/static/lib/shelf.js
// What the takes page shows: which takes match the search and the filters,
// in what order, under which month and day. Pure, so it is tested without a
// browser.
//
// The server lists starred takes first (lib/takes.js keeps that order for
// the main page); the shelf groups by day instead, so a starred take sits
// on the day it was played and the Starred filter is how to see them alone.

import { takeTitle } from './rooms/takename.js';

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** NEW_MS is how long a take wears the NEW sticker, on its spine and its row: a day. */
export const NEW_MS = 24 * 3600 * 1000;

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
 * searchText is everything a search finds a take by, lowercased: what is
 * printed on its spine (lib/rooms/takename.js) and its own name; the day it
 * was made as a person says it (today, yesterday, saturday, october, 24 oct,
 * oct 24, the year) and the time it was caught; its tempo (96, 96 bpm,
 * 96.0); its tag, with and without its #; the words of its notes; and what
 * the filters call it (starred, midi, phone, a mixdown). Never the file's
 * name or its date stamp: nobody sees those.
 */
export function searchText(t, { tags = [], now = Date.now() } = {}) {
  const words = [takeTitle(t), t.label || ''];
  const ms = when(t);
  if (!Number.isNaN(ms)) {
    const d = new Date(ms);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (dayKey(d) === dayKey(new Date(now))) words.push('today');
    if (dayKey(d) === dayKey(yesterday)) words.push('yesterday');
    const mon = MONTH_NAMES[d.getMonth()], n = d.getDate();
    words.push(DAY_NAMES[d.getDay()], mon, `${n} ${mon}`, `${mon} ${n}`, `${n} ${mon.slice(0, 3)}`, `${mon.slice(0, 3)} ${n}`, String(d.getFullYear()),
      `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`);
  }
  if (Number.isFinite(t.bpm)) words.push(`${Math.round(t.bpm)} bpm`, t.bpm.toFixed(1));
  const tag = tagOf(t, tags);
  if (tag) words.push(tag.name, `#${tag.name}`);
  for (const f of t.flags || []) if (f.label) words.push(f.label);
  if (t.starred) words.push('starred');
  if (t.has_midi) words.push('midi');
  if (t.origin === 'phone') words.push('phone');
  if (t.origin === 'tape') words.push('mixdown bounce');
  return words.join('\n').toLowerCase();
}

/** weekStart is the Monday that began the week `now` is in, at midnight. */
export function weekStart(now = Date.now()) {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/**
 * matches says whether a take passes the search and every filter that is
 * on. The search is words, each of which must be in what the take is found
 * by (searchText), in any order: "oct riff" finds October's riffs. `tag` is
 * a tag's id, or 'none' for the untagged; '' is off. `week` is this week's
 * takes, from Monday.
 */
export function matches(t, { query = '', starred = false, midi = false, phone = false, tape = false, week = false, tag = '', tags = [], now = Date.now() } = {}) {
  if (starred && !t.starred) return false;
  if (tag) {
    const own = tagOf(t, tags);
    if (tag === 'none' ? own : own?.id !== tag) return false;
  }
  if (midi && !t.has_midi) return false;
  if (phone && t.origin !== 'phone') return false;
  if (tape && t.origin !== 'tape') return false;
  if (week && !(when(t) >= weekStart(now))) return false;
  const q = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!q.length) return true;
  const hay = searchText(t, { tags, now });
  return q.every((w) => hay.includes(w));
}

// --- families: cuts and mixdowns fold into a spine ---------------------------

const atMs = (t) => { const w = when(t); return Number.isNaN(w) ? -Infinity : w; };
const isMix = (t) => t.origin === 'tape';

// tapeKeys says which tape each mixdown is of: its tape_id. A mixdown made
// before tape_id existed goes by its label -- the tape's name when it was
// mixed -- and joins the one tape whose newer mixdowns carry that label, so
// a tape mixed down before and after the field came in is still one family.
function tapeKeys(takes) {
  const labelsOf = new Map(); // tape_id -> the labels its mixdowns wear
  for (const t of takes) {
    if (!isMix(t) || !t.tape_id) continue;
    if (!labelsOf.has(t.tape_id)) labelsOf.set(t.tape_id, new Set());
    labelsOf.get(t.tape_id).add(t.label || '');
  }
  const keys = new Map();
  for (const t of takes) {
    if (!isMix(t)) continue;
    if (t.tape_id) { keys.set(t.name, `id:${t.tape_id}`); continue; }
    const ids = [...labelsOf].filter(([, labels]) => labels.has(t.label || '')).map(([id]) => id);
    keys.set(t.name, ids.length === 1 ? `id:${ids[0]}` : `label:${t.label || ''}`);
  }
  return keys;
}

/**
 * fold decides which takes stand on the shelf. A cut folds into the take it
 * was cut from (the first one up its line that is in `takes`); mixdowns of
 * one tape fold into the newest of them. `shelf` keeps the input's order;
 * `cuts` (oldest first) and `mixes` (newest first) are keyed by the spine
 * they fold into; `under` maps each folded take to that spine, which is
 * always on the shelf.
 */
export function fold(takes) {
  const byName = new Map(takes.map((t) => [t.name, t]));
  const keyOf = tapeKeys(takes);
  const newestMix = new Map();
  for (const t of takes) {
    const k = keyOf.get(t.name);
    if (!k) continue;
    const cur = newestMix.get(k);
    if (!cur || atMs(t) > atMs(cur) || (atMs(t) === atMs(cur) && t.name > cur.name)) newestMix.set(k, t);
  }
  const mixUnder = new Map();
  for (const t of takes) {
    const s = keyOf.has(t.name) && newestMix.get(keyOf.get(t.name));
    if (s && s !== t) mixUnder.set(t.name, s);
  }
  // Up the line to the first take, through the mix that stands in for an
  // earlier one. A line that loops (no real list has one) leaves the take on
  // the shelf.
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
  const under = new Map();
  for (const t of takes) {
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

/** familyCounts is what a spine's sticker counts: its cuts, and its tape's
 *  mixdowns -- itself included -- when earlier ones are folded into it. */
export function familyCounts(members) {
  const cuts = members.filter((m) => m.source).length;
  const earlier = members.length - cuts;
  return { cuts, mixes: earlier ? earlier + 1 : 0 };
}

/** familySticker is a spine's printed count: "✂3", "MIX ×4", or both. */
export function familySticker({ cuts, mixes }) {
  return [cuts ? `✂${cuts}` : '', mixes ? `MIX ×${mixes}` : ''].filter(Boolean).join(' · ');
}

/** cutsBack is a delete toast's note that the cuts folded into what was
 *  deleted are back on the shelf: "its" one take's, "their" several's. */
export function cutsBack(n, several = false) {
  if (!n) return '';
  const whose = several ? 'their' : 'its';
  return n === 1 ? ` · ${whose} cut is back on the shelf` : ` · ${whose} ${n} cuts are back on the shelf`;
}

/** freedBy is how many of a family's takes were cut from `name` itself:
 *  the ones that come back onto the shelf when it's deleted. */
export function freedBy(name, members) {
  return members.filter((m) => m.source?.name === name).length;
}

/** tapeName is what a tape's mixdowns are called: the label most of them
 *  wear (the tape's name when each was mixed), newest first on a tie. */
export function tapeName(mixes) {
  const n = new Map();
  for (const m of mixes) if (m.label) n.set(m.label, (n.get(m.label) || 0) + 1);
  let best = '';
  for (const [label, k] of n) if (!best || k > n.get(best)) best = label;
  return best;
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

/** monthLabel names a month's header in the List: "OCTOBER", with the year when it isn't this one's. */
export function monthLabel(ms, now = Date.now()) {
  const d = new Date(ms);
  const name = MONTH_NAMES[d.getMonth()].toUpperCase();
  return d.getFullYear() === new Date(now).getFullYear() ? name : `${name} ${d.getFullYear()}`;
}

/** SORTS are the List's and the shelves' orders, as Sort ▾ names them. */
export const SORTS = Object.freeze([
  { id: 'newest', word: 'Newest' },
  { id: 'oldest', word: 'Oldest' },
  { id: 'longest', word: 'Longest' },
  { id: 'name', word: 'Name' },
]);

/** sortKey is a sort that is one of SORTS, or newest. */
export const sortKey = (s) => (SORTS.some((x) => x.id === s) ? s : 'newest');

/**
 * sorted is the takes in a sort's order: newest or oldest made first (a take
 * with no date last either way), longest first, or by name (what is printed
 * on the spine, the numbers in it read as numbers).
 */
export function sorted(takes, sort = 'newest') {
  const at = (t) => { const w = when(t); return Number.isNaN(w) ? null : w; };
  const byDate = (dir) => (a, b) => {
    const x = at(a), y = at(b);
    if (x === null || y === null) return (x === null) - (y === null);
    return dir * (x - y) || (a.name < b.name ? -dir : a.name > b.name ? dir : 0);
  };
  const list = [...takes];
  switch (sortKey(sort)) {
    case 'oldest': return list.sort(byDate(1));
    case 'longest': return list.sort((a, b) => (b.duration_seconds || 0) - (a.duration_seconds || 0) || byDate(-1)(a, b));
    case 'name': return list.sort((a, b) => takeTitle(a).localeCompare(takeTitle(b), undefined, { numeric: true, sensitivity: 'base' }) || byDate(-1)(a, b));
    default: return list.sort(byDate(-1));
  }
}

/**
 * shelve filters the takes, folds what's left (see fold), and puts the spines
 * in groups to show. By date (newest or oldest first): a month's header
 * (kind 'month', no takes of its own), then its days, each a group of its
 * takes; a take with no readable date goes in a last group, EARLIER. By
 * length or by name: one group. Each group's `members` holds, for each of
 * its spines with a family, the takes folded into it.
 */
export function shelve(takes, opts = {}, now = Date.now()) {
  const f = fold(takes.filter((t) => matches(t, { now, ...opts })));
  if (!f.shelf.length) return [];
  return shelveGroups(f.shelf, opts, now).map((g) => ({ ...g, members: membersOf(f, g.takes) }));
}

function shelveGroups(shown, opts, now) {
  const sort = sortKey(opts.sort);
  if (sort === 'longest') return [{ label: 'LONGEST FIRST', kind: 'day', takes: sorted(shown, 'longest') }];
  if (sort === 'name') return [{ label: 'BY NAME', kind: 'day', takes: sorted(shown, 'name') }];
  const groups = [];
  let month = '';
  const undated = [];
  for (const t of sorted(shown, sort)) {
    const ms = when(t);
    if (Number.isNaN(ms)) { undated.push(t); continue; }
    const m = monthLabel(ms, now);
    if (m !== month) {
      month = m;
      groups.push({ label: m, kind: 'month', takes: [] });
    }
    const label = dayLabel(ms, now);
    const last = groups[groups.length - 1];
    if (last.kind === 'day' && last.label === label) last.takes.push(t);
    else groups.push({ label, kind: 'day', takes: [t] });
  }
  if (undated.length) groups.push({ label: 'EARLIER', kind: 'day', takes: undated });
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

/**
 * dropoutsText says a take lost audio where it was recorded -- "⚠ 2
 * dropouts" -- or '' when it didn't (step C4).
 */
export function dropoutsText(take) {
  const n = (take.dropouts || []).length;
  return n ? `⚠\u00a0${n} dropout${n === 1 ? '' : 's'}` : ''; // the ⚠ stays with its count
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
