// web/static/lib/ui/measure.js
// A height the stylesheets read is measured, never written into them: one
// observer writes an element's height, as it is drawn, into a custom
// property on the page's <html>, now and whenever it changes. Hidden, it
// is 0. The bar's --np-h (lib/bar/slots.js measureBar) and help mode's tip,
// --tip-h (lib/help/help.js), are its.

/**
 * measureInto writes `el`'s height into the custom property `prop` on
 * `root` (the page's <html>), once per change, whatever changed it.
 * Answers its disconnect.
 */
export function measureInto(el, prop, { root = el?.ownerDocument?.documentElement, RO = globalThis.ResizeObserver } = {}) {
  if (!el || !root || typeof RO !== 'function') return () => {};
  let last = null;
  const write = (h) => {
    const v = `${Math.round(h)}px`;
    if (v === last) return;
    last = v;
    root.style.setProperty(prop, v);
  };
  const ro = new RO(([e]) => {
    const b = e?.borderBoxSize?.[0];
    write(b ? b.blockSize : (el.getBoundingClientRect?.().height || 0));
  });
  ro.observe(el);
  return () => ro.disconnect();
}
