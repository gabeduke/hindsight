// web/static/lib/play/mount.js
// Play mode's way onto the tape page, and the per-device flag that decides
// whether it exists at all. With the flag on it loads the instrument strip
// (strip.js), a drawer above the bar
// (docs/superpowers/specs/2026-10-15-instrument-strip-design.md); with it
// off it reads one localStorage key and stops -- strip.js isn't even
// fetched, so nothing is drawn, listened for or asked of the Pi.
//
// A separate module loaded by tape.html rather than a change inside
// lib/tape/page.js, so Play mode can be read, reviewed and removed in one
// piece, and so a bug in it cannot take the tape page down with it.

import { on, setOn } from './flag.js';

// Re-exported so lib/play has one front door, while the flag itself stays in
// a module with no side effects (the Settings sheet reads it without starting
// Play mode).
export { on, setOn };

/**
 * start builds the strip, or returns null when the flag is off without
 * touching the page. `load` fetches the strip's module; tests pass their own.
 */
export function start({ flagOn = on, load = () => import('./strip.js'), ...opts } = {}) {
  if (!flagOn()) return null;
  return load().then((mod) => mod.startStrip(opts));
}

// On the tape page, on load. Everything above stays importable and testable.
if (typeof document !== 'undefined' && document.body?.classList.contains('tape-page')) {
  start()?.catch((e) => console.error('Play mode could not start:', e));
}
