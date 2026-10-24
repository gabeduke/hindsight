// web/static/lib/theme.js
// Colours for canvas code. Every colour lives in styles.css as a custom
// property, redefined for the dark scheme, so a canvas reads the property at
// draw time instead of hard-coding a hex -- and redraws when the device flips
// between light and dark, which a canvas, unlike CSS, will not do by itself.

/**
 * withAlpha turns a token's colour (#rgb, #rrggbb, rgb() or rgba()) into
 * rgba() with alpha `a`. A colour it cannot read is returned unchanged, so a
 * bad token degrades to an opaque colour rather than an invalid one.
 */
export function withAlpha(color, a) {
  const c = String(color).trim();
  let m = /^#([0-9a-f]{3})$/i.exec(c);
  if (m) {
    const [r, g, b] = m[1].split('').map((h) => parseInt(h + h, 16));
    return `rgba(${r},${g},${b},${a})`;
  }
  m = /^#([0-9a-f]{6})$/i.exec(c);
  if (m) {
    const n = parseInt(m[1], 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,[^)]*)?\)$/i.exec(c);
  if (m) return `rgba(${m[1]},${m[2]},${m[3]},${a})`;
  return color;
}

/** token reads a custom property off `el` (the root by default). */
export function token(name, fallback, el = document.documentElement) {
  return getComputedStyle(el).getPropertyValue(name).trim() || fallback;
}

/**
 * tokenCache reads custom properties off `el()` once each and keeps them,
 * for code that draws often: reading one is a style read, which after a
 * DOM write is a forced style recalculation. `get(name, fallback)` is
 * token's; `clear()` forgets them, for when the scheme flips (onSchemeChange)
 * or the page is shown again.
 */
export function tokenCache(el = () => document.documentElement) {
  const kept = new Map();
  let css = null;
  return {
    get(name, fallback) {
      let v = kept.get(name);
      if (v === undefined) {
        css ||= getComputedStyle(el());
        v = css.getPropertyValue(name).trim();
        kept.set(name, v);
      }
      return v || fallback;
    },
    clear() { kept.clear(); css = null; },
  };
}

/** onSchemeChange calls `cb` whenever the device flips light <-> dark. */
export function onSchemeChange(cb) {
  if (typeof matchMedia !== 'function') return;
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => cb());
}
