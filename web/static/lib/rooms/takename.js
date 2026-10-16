// web/static/lib/rooms/takename.js
// A take in a toast, named as the Listening Room names it (docs/superpowers/
// specs/2026-10-15-flow-design.md, "Every word on screen today"): its own name
// when it has one, else the time it was caught -- with the day when it was not
// today, so two takes at 21:04 can be told apart -- and how long it is. Never
// the file, jam_….wav. The file name stays where a request needs it; this is
// only what a person reads.

import { fmtLen } from '../room/deck.js';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const KINDS = { cut: ' (cut)', bounce: ' (bounce)' };

/**
 * takeTitle is a take as a toast says it.
 *   name     the file, which only says when it was made
 *   seconds  its length, when the request carried it
 *   label    its given name: it wins, as on the spine
 *   kind     'cut' or 'bounce': made from another take, which has the same
 *            time in its name, so it says what it is
 *   now      today, for the tests
 */
export function takeTitle(name, seconds, label = '', { kind = '', now = Date.now() } = {}) {
  let title = label || '';
  if (!title) {
    const file = String(name || '');
    const m = /(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})/.exec(file);
    if (m) {
      const day = new Date(+m[1], +m[2] - 1, +m[3]);
      const time = `${m[4]}:${m[5]}:${m[6]}`;
      const today = day.toDateString() === new Date(now).toDateString();
      title = today ? time : `${DAYS[day.getDay()]} ${day.getDate()} ${MONTHS[day.getMonth()]} ${time}`;
      if (/^phone_/.test(file)) title = `Phone ${title}`;
    } else {
      title = file.replace(/^(jam|phone)_/, '').replace(/\.(wav|webm|mp3|m4a|ogg)$/, '');
    }
  }
  if (!title) title = 'a take';
  title += KINDS[kind] || '';
  return Number.isFinite(seconds) && seconds > 0 ? `${title} · ${fmtLen(seconds)}` : title;
}
