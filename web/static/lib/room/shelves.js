// web/static/lib/room/shelves.js
// What stands on the Listening Room's shelves
// (docs/superpowers/specs/2026-10-15-listening-room-design.md, "The
// shelves"): the tapes, this month's takes, and the archive by month. Pure,
// so it is tested without a browser.
//
// Takes fold into families exactly as the rack folds them (lib/shelf.js
// fold): a cut stands with the take it was cut from, a tape's mixdowns with
// the newest of them. A family stands on the shelf of its spine's month, so
// a cut made this month from last month's take is in last month's box, as
// it is under last month's day in the rack. (There is no Records shelf any
// more: a take that was marked a record, Meta.Record, is an ordinary take
// here, on the shelf of its date.)

import { fold, membersOf, matches } from '../shelf.js';

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** NEW_MS is how long a take wears the NEW sticker: a day. */
export const NEW_MS = 24 * 3600 * 1000;

/** at is when a take was made, in ms, or -Infinity with no readable date. */
export function at(t) {
  const w = t && t.created ? Date.parse(t.created) : NaN;
  return Number.isNaN(w) ? -Infinity : w;
}

/** monthKey is a time's local calendar month, "2026-09", or '' for none. */
export function monthKey(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/**
 * monthWords names a month's box: its plate ("SEP · 22", with the year when
 * it isn't this one's) and what a screen reader hears ("September 2025, 4
 * takes"). key '' is the box for takes with no date.
 */
export function monthWords(key, count, now = Date.now()) {
  const n = `${count} ${count === 1 ? 'take' : 'takes'}`;
  if (!key) return { plate: `EARLIER · ${count}`, title: `Earlier, with no date: ${n}` };
  const [y, m] = key.split('-').map(Number);
  const thisYear = new Date(now).getFullYear() === y;
  return {
    plate: `${MON[m - 1]}${thisYear ? '' : ` ${y}`} · ${count}`,
    title: `${MONTH[m - 1]}${thisYear ? '' : ` ${y}`}: ${n}`,
  };
}

/** monthName is this month's name for its shelf's plate: "OCTOBER". */
export function monthName(now = Date.now()) {
  return MONTH[new Date(now).getMonth()].toUpperCase();
}

/**
 * roomShelves sorts the takes and tapes onto the shelves.
 *
 * takes is the takes list (GET /api/jams); tapes is GET /api/tapes's answer
 * ({loaded, tapes}), or null with the tape off; opts is the rack's filter
 * (lib/shelf.js matches), which the search applies to every shelf, and to
 * tapes by name.
 *
 * It answers {tapes, month, archive}:
 * - tapes: [{...summary, loaded}], newest first as the Pi lists them, or
 *   null when there are none to have;
 * - month: {key, spines: [{take, members, isNew}]}, this month's spines,
 *   newest first, each with the takes folded into it;
 * - archive: [{key, count, plate, title}], one box per earlier month, newest
 *   first, counting the spines in it.
 */
export function roomShelves(takes, tapes, opts = {}, now = Date.now()) {
  const shown = takes.filter((t) => matches(t, opts));
  const f = fold(shown);
  const thisMonth = monthKey(now);
  const mine = [];
  const boxes = new Map();
  for (const s of f.shelf) {
    const k = monthKey(at(s));
    if (k === thisMonth) mine.push(s);
    else boxes.set(k, (boxes.get(k) || 0) + 1);
  }
  mine.sort((a, b) => at(b) - at(a) || (b.name > a.name ? 1 : -1));
  const members = membersOf(f, mine);
  const spines = mine.map((t) => ({
    take: t,
    members: members.get(t.name) || [],
    isNew: at(t) <= now + 60000 && now - at(t) < NEW_MS,
  }));
  // Newest month first; the undated box last.
  const archive = [...boxes].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : b.localeCompare(a)))
    .map(([key, count]) => ({ key, count, ...monthWords(key, count, now) }));
  const q = (opts.query || '').trim().toLowerCase();
  const tapeShelf = tapes && Array.isArray(tapes.tapes)
    ? tapes.tapes.filter((s) => !q || (s.name || '').toLowerCase().includes(q)).map((s) => ({ ...s, loaded: s.id === tapes.loaded }))
    : null;
  return { tapes: tapeShelf, month: { key: thisMonth, spines }, archive };
}

/**
 * inMonth is the names of the takes a month's box opens to in the rack:
 * every take whose family stands in that month (a cut with the take it was
 * cut from). The rack folds what it's given again itself.
 */
export function inMonth(takes, key, opts = {}) {
  const rest = takes.filter((t) => matches(t, opts));
  const f = fold(rest);
  const byName = new Map(rest.map((t) => [t.name, t]));
  const names = new Set();
  for (const t of rest) {
    const spine = byName.get(f.under.get(t.name) || t.name) || t;
    if (monthKey(at(spine)) === key) names.add(t.name);
  }
  return names;
}

/**
 * filterWords is the rack's filter in force, as the room says it: one phrase
 * per thing it's narrowed by, or none. The rack's filter is remembered on
 * the device, and the room keeps the rack's tools out of sight, so a filter
 * left on must say so where the shelves are, or they just look empty.
 */
export function filterWords(opts = {}, tags = []) {
  const out = [];
  const q = (opts.query || '').trim();
  if (q) out.push(`“${q}”`);
  if (opts.starred) out.push('starred');
  if (opts.tag === 'none') out.push('untagged');
  else if (opts.tag) out.push(`tagged ${(tags.find((g) => g.id === opts.tag) || {}).name || 'with a tag'}`);
  if (opts.midi) out.push('with MIDI');
  if (opts.phone) out.push('from a phone');
  if (opts.tape) out.push('mixdowns');
  return out;
}

/**
 * playOrder is the order Play all from here walks in the room: the shelf
 * `name` stands on -- this month's takes, newest first -- and nothing past
 * it. Just `name` if it isn't among them.
 */
export function playOrder(shelves, name) {
  const month = shelves.month.spines.map((x) => x.take.name);
  return month.includes(name) ? month : [name];
}
