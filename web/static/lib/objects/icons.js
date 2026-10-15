// web/static/lib/objects/icons.js
// The pictures drawn from code: where the tape plays -- a speaker for the
// jam room, headphones for a phone, both side by side for both. Line art in
// currentColor, so each takes the ink of the key it sits on.
//
// The app's own icon (a cassette) is a set of files, icons/*.svg and the
// PNGs made from them, because the manifest and the browser tab ask for
// files: scripts/icons/icon.mjs draws them, and its header says how to
// ship a new one. The few glyphs that are part of a page from its first
// paint -- the tab bar's list and reels, |◂, search, the bin, the loop's
// lock -- are inline in that page's markup, so they never wait on a
// script. The bench shows the icon files beside these.

const SPEAKER = '<path d="M3 9.5h3.5L11 5.5v13l-4.5-4H3z"/><path d="M14.5 9a4 4 0 0 1 0 6"/><path d="M17 6.5a7.5 7.5 0 0 1 0 11"/>';
const PHONES = '<path d="M4 16v-3.5a8 8 0 0 1 16 0V16"/><rect x="3" y="14" width="4.5" height="7" rx="1.5" fill="currentColor"/><rect x="16.5" y="14" width="4.5" height="7" rx="1.5" fill="currentColor"/>';
const svg = (vw, w, inner) => `<svg class="out-ico" width="${w}" height="22" viewBox="0 0 ${vw} 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

/** OUT_MODES is every place the tape can play, each with its own picture. */
export const OUT_MODES = ['jam', 'phone', 'both'];

/** outIcon is the output button's picture for `mode`: jam, phone or both. */
export function outIcon(mode) {
  if (mode === 'phone') return svg(24, 22, PHONES);
  if (mode === 'both') return svg(42, 38, `${SPEAKER}<g transform="translate(18 0)">${PHONES}</g>`);
  return svg(24, 22, SPEAKER);
}
