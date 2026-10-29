// web/static/lib/rooms/takename.js
// What a take is called, the one way it is called everywhere a person reads
// it: on its spine, in the bar, in a search, in Recently deleted, in a toast
// and in what a screen reader says (docs/architecture/rooms.md, Vocabulary). Its
// own name when it has one; else the time it was caught, which is what is
// printed on its spine. Never the file (jam_….wav) or its date stamp
// (2026-10-24_083527): those stay where a request needs them.
//
// Where nothing around it says the day (a toast, Recently deleted), the day
// goes before the time, so two takes at 21:04 can be told apart; and a toast
// may add the length. The title itself is the same.

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const KINDS = { cut: ' (cut)', bounce: ' (bounce)' };
const STAMP = /(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})/;

/** fmtLen is a length as the cards say it: "1:59". */
export function fmtLen(s) {
  if (!Number.isFinite(s) || s <= 0) return '0:00';
  const m = Math.floor(s / 60), r = Math.round(s % 60);
  return `${m}:${String(r === 60 ? 59 : r).padStart(2, '0')}`;
}

/**
 * takeTitle is a take as a person reads it.
 *   take     the take ({name, label}), or its file's name
 *   seconds  its length, to say after it ("· 0:30")
 *   label    its given name, when `take` is only a file's name: it wins
 *   day      say the day before the time when it was not today (where
 *            nothing around it says the day: a toast, Recently deleted)
 *   kind     'cut' or 'bounce': made from another take, which has the same
 *            time in its name, so it says what it is
 *   now      today, for the tests
 */
export function takeTitle(take, { seconds, label = '', day = false, kind = '', now = Date.now() } = {}) {
  const t = take && typeof take === 'object' ? take : { name: take, label };
  let title = t.label || '';
  if (!title) {
    const file = String(t.name || '');
    const m = STAMP.exec(file);
    if (m) {
      const when = new Date(+m[1], +m[2] - 1, +m[3]);
      const time = `${m[4]}:${m[5]}:${m[6]}`;
      const today = when.toDateString() === new Date(now).toDateString();
      title = day && !today ? `${DAYS[when.getDay()]} ${when.getDate()} ${MONTHS[when.getMonth()]} ${time}` : time;
      if (/^phone_/.test(file)) title = `Phone ${title}`;
    } else {
      title = file.replace(/^(jam|phone)_/, '').replace(/\.(wav|webm|mp3|m4a|ogg)$/, '');
    }
  }
  if (!title) title = 'a take';
  title += KINDS[kind] || '';
  return Number.isFinite(seconds) && seconds > 0 ? `${title} · ${fmtLen(seconds)}` : title;
}
