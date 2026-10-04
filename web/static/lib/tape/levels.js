// Levels on the tape page: each source's meter, and what to say about a
// catch that came back silent or very quiet.

/** SILENT is the dBFS the Pi reports for digital silence. */
export const SILENT = -120;

/** QUIET is the peak below which a catch is worth a word: -50 dBFS. */
export const QUIET = -50;

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
 * very quiet, or null when it didn't (or the Pi didn't say).
 */
export function quietNote(clip) {
  const db = clip && clip.peak_db;
  if (typeof db !== 'number') return null;
  const src = clip.source || 'that source';
  if (db <= SILENT + 0.05) return `nothing came in on ${src}: it’s silent. Pick the source whose meter moves`;
  if (db < QUIET) return `very quiet on ${src} (peak ${Math.round(db)} dB): is its level up?`;
  return null;
}

/** levelText is a meter's reading for its title. */
export function levelText(db) {
  if (typeof db !== 'number') return '';
  if (db <= SILENT + 0.05) return 'silent';
  return `peak ${Math.round(db)} dB`;
}
