// web/static/lib/ui/icons.js
// The app's icons: one drawn set, icons/ui.svg, in place of the unicode
// glyphs (↶ ⋯ ▾ ✎ ⏏ …) that each platform drew in a fallback font of its
// own, with its own width and baseline -- which is how a key fitted on a
// laptop ran off a tablet in CI's fonts. Line art on a 24 grid in
// currentColor, so each takes the ink of the key it sits on.
//
// A page puts an icon in its markup, so it is there at the first paint:
//   <svg class="i i-undo" width="22" height="22" aria-hidden="true"><use href="/icons/ui.svg?v=…#undo"/></svg>
// and a script asks icon('undo') for the same string, or setIcon(key,
// 'pause') to change the one a key shows. Every name a page or a script uses
// is in the sprite and in ICONS, or icons.test.js fails.
//
// The app's own icon (a cassette) is a set of files beside the sprite,
// icons/icon*.svg and the PNGs made from them, because the manifest and the
// browser tab ask for files: scripts/icons/icon.mjs draws those.

/**
 * SPRITE is the one file every icon is drawn from, at an address that moves
 * whenever the file does: its ?v= is the first 8 hex of the sprite's
 * sha-256. A browser keeps the SVG a <use> names by its URL -- across a
 * reload, and from its HTTP cache when the app is opened again -- so a
 * sprite changed at the same address draws the old copy on, and a symbol
 * new to it as a blank key. icons.test.js works the hash out and fails,
 * naming the new address, until it is here, in sw.js's SHELL and in every
 * <use> the pages write.
 */
export const SPRITE = '/icons/ui.svg?v=c634899d';

/** ICONS is every icon in the sprite, by its id. */
export const ICONS = Object.freeze([
  // the transport
  'play', 'pause', 'stop', 'rec', 'prev', 'back5', 'repeat', 'metro', 'eject', 'catch', 'note',
  // the header
  'undo', 'redo', 'more', 'menu', 'tape', 'studio', 'shelf', 'search',
  // where the tape plays
  'speaker', 'phones',
  // the ruler: ⌗, and the loop's lock in two parts (the shackle lifts)
  'view', 'lock-body', 'lock-shackle',
  // ways in and out
  'down', 'right', 'left', 'close', 'check', 'minus', 'plus',
  // the library
  'star', 'list',
  // the keyboard's press, on the bar
  'keyboard',
]);

const known = new Set(ICONS);
const href = (name) => `${SPRITE}#${name}`;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function check(name) {
  // A name the sprite hasn't got draws nothing, silently: say so instead.
  if (!known.has(name)) throw new TypeError(`no icon "${name}" in ${SPRITE}`);
}

/**
 * icon is the markup for icon `name`: `size` px square (CSS may size it
 * otherwise), hidden from a screen reader -- the key it sits on says what it
 * does -- unless it is given a `label` of its own. `cls` adds classes.
 */
export function icon(name, { size = 20, label = null, cls = '' } = {}) {
  check(name);
  const said = label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"';
  return `<svg class="i i-${name}${cls ? ` ${cls}` : ''}" width="${size}" height="${size}" ${said}><use href="${href(name)}"/></svg>`;
}

/**
 * setIcon makes `el` (a key, or the icon itself) show icon `name`, writing
 * only when it changes: the bar's ▶ is set every frame something plays. A
 * key with no icon yet gets one.
 */
export function setIcon(el, name, opts) {
  check(name);
  const svg = el.matches?.('svg.i') ? el : el.querySelector('svg.i');
  const use = svg?.querySelector('use');
  if (!use) {
    el.innerHTML = icon(name, opts);
    return;
  }
  if (use.getAttribute('href') === href(name)) return;
  use.setAttribute('href', href(name));
  svg.setAttribute('class', String(svg.getAttribute('class') || 'i').replace(/\bi-[\w-]+/, `i-${name}`));
}

/** iconOf is the name of the icon `el` shows (the first, in a key), or null. */
export function iconOf(el) {
  const svg = el?.matches?.('svg.i') ? el : el?.querySelector?.('svg.i');
  const h = svg?.querySelector('use')?.getAttribute('href') || '';
  return h.startsWith(`${SPRITE}#`) ? h.slice(SPRITE.length + 1) : null;
}

/** OUT_MODES is every place the tape can play, each with its own picture. */
export const OUT_MODES = ['jam', 'phone', 'both'];

/**
 * outIcon is the output button's picture for `mode`: a speaker for the jam
 * room, headphones for a phone, both side by side for both.
 */
export function outIcon(mode) {
  if (mode === 'phone') return icon('phones', { size: 22, cls: 'out-ico' });
  if (mode === 'both') {
    return `<svg class="i i-speaker i-phones out-ico" width="38" height="22" viewBox="0 0 42 24" aria-hidden="true"><use href="${href('speaker')}" width="24" height="24"/><use href="${href('phones')}" x="18" width="24" height="24"/></svg>`;
  }
  return icon('speaker', { size: 22, cls: 'out-ico' });
}
