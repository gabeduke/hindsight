// web/static/lib/room/shelves.js
// What stands on the Listening Room's shelf wall (docs/architecture/
// rooms.md, "The library"): one shelf per month, newest first, then ★, then
// a shelf per tag. A take stands on its month's shelf, and on ★ and its
// tag's as well, so each shelf is whole. Tapes are not on them: they live in
// the Studio only, and a tape's bounces stand here as takes. Pure, so it is
// tested without a browser.
//
// Takes fold into families exactly as the List folds them (lib/shelf.js
// fold): a cut stands with the take it was cut from, a tape's mixdowns with
// the newest of them. A family stands on the shelf of its spine's month, so
// a cut made this month from last month's take is on last month's shelf, as
// it is under last month's day in the List.

import { fold, membersOf, matches, sorted, sortKey, tagOf, NEW_MS } from '../shelf.js';

export { NEW_MS };

const MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

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

const plural = (n) => `${n} ${n === 1 ? 'take' : 'takes'}`;

/**
 * monthWords names a month's shelf: its plate ("OCTOBER", with the year when
 * it isn't this one's) and what a screen reader hears ("September 2025, 4
 * takes"). key '' is the shelf for takes with no date.
 */
export function monthWords(key, count, now = Date.now()) {
  if (!key) return { plate: 'EARLIER', title: `Earlier, with no date: ${plural(count)}` };
  const [y, m] = key.split('-').map(Number);
  const year = new Date(now).getFullYear() === y ? '' : ` ${y}`;
  return { plate: `${MONTH[m - 1].toUpperCase()}${year}`, short: `${MON[m - 1]}${year}`, title: `${MONTH[m - 1]}${year}: ${plural(count)}` };
}

/** monthName is a month's name for its plate: "OCTOBER". */
export function monthName(now = Date.now()) {
  return MONTH[new Date(now).getMonth()].toUpperCase();
}

/**
 * wallShelves sorts the takes onto the wall.
 *
 * takes is the takes list (GET /api/jams); opts is the List's filter and
 * sort (lib/shelf.js matches, sorted), which every shelf follows; tags the
 * tags, in their order. Each shelf is
 *   { key, kind: 'month' | 'starred' | 'tag', plate, title, count, tag?,
 *     spines: [{take, members, isNew}] }
 * key is 'month:2026-10' ('month:' for the undated), 'starred' or
 * 'tag:<id>'. The months come newest first (oldest first with Sort: Oldest),
 * the undated last; a shelf with nothing on it isn't there.
 */
export function wallShelves(takes, opts = {}, now = Date.now()) {
  const tags = opts.tags || [];
  const shown = takes.filter((t) => matches(t, { now, ...opts }));
  const f = fold(shown);
  const spines = sorted(f.shelf, opts.sort);
  const members = membersOf(f, spines);
  const entry = (t) => ({ take: t, members: members.get(t.name) || [], isNew: at(t) <= now + 60000 && now - at(t) < NEW_MS });
  const months = new Map();
  for (const t of spines) {
    const k = monthKey(at(t));
    if (!months.has(k)) months.set(k, []);
    months.get(k).push(entry(t));
  }
  const up = sortKey(opts.sort) === 'oldest' ? 1 : -1;
  const out = [...months].sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : up * a.localeCompare(b)))
    .map(([key, list]) => ({ key: `month:${key}`, kind: 'month', count: list.length, spines: list, ...monthWords(key, list.length, now) }));
  const starred = spines.filter((t) => t.starred).map(entry);
  if (starred.length) out.push({ key: 'starred', kind: 'starred', plate: 'STARRED', title: `Starred: ${plural(starred.length)}`, count: starred.length, spines: starred });
  for (const g of tags) {
    const mine = spines.filter((t) => tagOf(t, tags)?.id === g.id).map(entry);
    if (mine.length) out.push({ key: `tag:${g.id}`, kind: 'tag', tag: g, plate: `#${g.name.toUpperCase()}`, title: `Tagged ${g.name}: ${plural(mine.length)}`, count: mine.length, spines: mine });
  }
  return out;
}

/**
 * shelfNames is the names of the takes a shelf's All › opens the List to:
 * every take whose family's spine stands on that shelf (a cut with the take
 * it was cut from). The List folds what it's given again itself.
 */
export function shelfNames(takes, key, opts = {}, now = Date.now()) {
  const tags = opts.tags || [];
  const rest = takes.filter((t) => matches(t, { now, ...opts }));
  const f = fold(rest);
  const byName = new Map(rest.map((t) => [t.name, t]));
  const on = (spine) => {
    if (key === 'starred') return !!spine.starred;
    if (key.startsWith('tag:')) return tagOf(spine, tags)?.id === key.slice(4);
    if (key.startsWith('month:')) return monthKey(at(spine)) === key.slice(6);
    return false;
  };
  const names = new Set();
  for (const t of rest) {
    const spine = byName.get(f.under.get(t.name) || t.name) || t;
    if (on(spine)) names.add(t.name);
  }
  return names;
}

/**
 * filterWords is the List's filter in force, as the room says it: one phrase
 * per thing it's narrowed by, or none. The filter is remembered on the
 * device, so one left on must say so where the shelves are, or they just
 * look empty.
 */
export function filterWords(opts = {}, tags = []) {
  const out = [];
  const q = (opts.query || '').trim();
  if (q) out.push(`“${q}”`);
  if (opts.starred) out.push('starred');
  if (opts.tag === 'none') out.push('untagged');
  else if (opts.tag) out.push(`tagged ${(tags.find((g) => g.id === opts.tag) || {}).name || 'with a tag'}`);
  if (opts.week) out.push('from this week');
  if (opts.midi) out.push('with MIDI');
  if (opts.phone) out.push('from a phone');
  if (opts.tape) out.push('mixdowns');
  return out;
}
