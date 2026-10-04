// Levels on the tape page: each source's meter, and what to say about a
// catch that came back silent or very quiet.

/** SILENT is the dBFS the Pi reports for digital silence. */
export const SILENT = -120;

/** QUIET is the peak below which a catch is worth a word: -50 dBFS. */
export const QUIET = -50;

/** dB is a level as the page writes it, with a real minus sign. */
export function dB(db) {
  const n = Math.round(db);
  return `${n < 0 ? '−' : ''}${Math.abs(n)} dB`;
}

/**
 * meterFill is how full a source's meter is for a peak in dBFS: 0 at -60
 * and below, 1 at 0.
 */
export function meterFill(db) {
  if (typeof db !== 'number' || !(db > -60)) return 0;
  return Math.min(1, (db + 60) / 60);
}

/**
 * quietNote is what to add to a catch's toast when it came back silent or
 * very quiet, or null when it didn't (or the Pi didn't say). The toast has
 * already named the source.
 */
export function quietNote(clip) {
  const db = clip && clip.peak_db;
  if (typeof db !== 'number') return null;
  if (isSilent(db)) return 'it’s silent: nothing came in. Pick the source whose meter moves';
  if (db < QUIET) return `it’s very quiet (peak ${dB(db)}): is that source’s level up?`;
  return null;
}

/** isSilent says whether a peak in dBFS is the Pi's digital silence. */
export function isSilent(db) {
  return typeof db === 'number' && db <= SILENT + 0.05;
}

/** levelText is a meter's reading for its title. */
export function levelText(db) {
  if (typeof db !== 'number') return '';
  if (isSilent(db)) return 'silent';
  return `peak ${dB(db)}`;
}
