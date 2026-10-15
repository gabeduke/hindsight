// web/static/lib/objects/bench-still.js
// A still of the bench: its objects, as they are on screen right now, as a
// PNG to download -- so two versions of an object can be put side by side
// after the page that drew one of them has changed.
//
// There is no library for this and the Pi has no route to one, so it is
// done the way the browser allows: the bench is copied into an SVG's
// foreignObject with everything it needs inlined -- the two stylesheets,
// their fonts, every canvas as an image, every image as data, and the
// colours of the scheme it is showing pinned on the copy -- and the SVG is
// drawn onto a canvas. A browser that will not read such a canvas back (it
// marks it as tainted) gets the SVG itself instead, which opens anywhere.
//
// Bench-only: nothing shipped imports this.

/** fontUrls is every url(...) in some CSS, once each, in order. */
export function fontUrls(css) {
  const out = [];
  for (const m of css.matchAll(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** inlineUrls replaces each url(...) in css whose address is in `data` with its data URL. */
export function inlineUrls(css, data) {
  return css.replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g, (all, u) => (data[u] ? `url("${data[u]}")` : all));
}

/** tokenNames is every custom property some CSS declares, once each. */
export function tokenNames(css) {
  return [...new Set([...css.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)].map((m) => m[1]))];
}

/** pinned is an inline style that fixes each token at its value now: {name: value}. */
export function pinned(values) {
  return Object.entries(values).filter(([, v]) => v !== '').map(([k, v]) => `${k}: ${v};`).join(' ');
}

/** stillName is the file a still downloads as: the scheme and the width, so two can be told apart. */
export function stillName({ scheme, width, ext = 'png' }) {
  return `hindsight-bench-${scheme}-${Math.round(width)}px.${ext}`;
}

/** svgOf wraps serialized XHTML in an SVG of w x h CSS px. */
export function svgOf(xhtml, w, h) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`
    + `<foreignObject x="0" y="0" width="${w}" height="${h}">${xhtml}</foreignObject></svg>`;
}

const asDataUrl = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});
const fetchData = async (url) => asDataUrl(await (await fetch(url)).blob());

/**
 * still renders `node` (the bench's objects) as it is now. It answers
 * {blob, name}: a PNG, or the SVG when the browser won't read the canvas
 * back. `skip` is a selector for what to leave out of the picture (the
 * bench's own controls).
 */
export async function still(node, { sheets = ['/objects.css', '/styles.css'], skip = '', scale = Math.min(2, globalThis.devicePixelRatio || 1) } = {}) {
  const doc = node.ownerDocument;
  const win = doc.defaultView;

  // The CSS the page has: its stylesheets and its own <style>s, fonts inlined.
  let css = (await Promise.all(sheets.map(async (s) => (await fetch(s)).text()))).join('\n');
  for (const s of doc.querySelectorAll('style')) css += `\n${s.textContent}`;
  const data = {};
  await Promise.all(fontUrls(css).map(async (u) => { try { data[u] = await fetchData(u); } catch { /* the face falls back */ } }));
  css = inlineUrls(css, data);

  // The scheme on screen, pinned: every token at the value it has now, set
  // on the copy, so the picture shows this scheme whatever the image's own
  // context would pick.
  const rootStyle = win.getComputedStyle(doc.documentElement);
  const values = {};
  for (const t of tokenNames(css)) values[t] = rootStyle.getPropertyValue(t).trim();

  // The copy, with canvases as pictures of themselves and images as data.
  const copy = node.cloneNode(true);
  const live = [...node.querySelectorAll('canvas')];
  [...copy.querySelectorAll('canvas')].forEach((c, i) => {
    const r = live[i].getBoundingClientRect();
    const img = doc.createElement('img');
    img.className = c.className;
    try { img.src = live[i].toDataURL('image/png'); } catch { /* a canvas we may not read */ }
    img.style.cssText = c.style.cssText;
    img.style.width = `${r.width}px`;
    img.style.height = `${r.height}px`;
    c.replaceWith(img);
  });
  await Promise.all([...copy.querySelectorAll('img')].map(async (img) => {
    const src = img.getAttribute('src') || '';
    if (!src || src.startsWith('data:')) return;
    try { img.setAttribute('src', await fetchData(src)); } catch { /* left as it was */ }
  }));
  if (skip) for (const n of copy.querySelectorAll(skip)) n.remove();

  // Laid out at the window's width, so the stylesheet's media queries make
  // the same choices they made on screen.
  const width = doc.documentElement.clientWidth;
  const wrap = doc.createElement('div');
  wrap.setAttribute('style', `${pinned(values)} width: ${width}px; background: var(--bg); color: var(--ink); font-family: var(--font); font-size: 16px; line-height: 1.45;`);
  const style = doc.createElement('style');
  style.textContent = css;
  const inner = doc.createElement('div');
  inner.className = node.parentElement?.className || '';
  inner.append(copy);
  wrap.append(style, inner);

  // Measured in the page, off screen, then taken away again.
  wrap.style.position = 'absolute';
  wrap.style.left = '-100000px';
  wrap.style.top = '0';
  doc.body.append(wrap);
  const height = Math.ceil(wrap.getBoundingClientRect().height);
  wrap.remove();
  wrap.style.position = '';
  wrap.style.left = '';
  wrap.style.top = '';

  const svg = svgOf(new win.XMLSerializer().serializeToString(wrap), width, height);
  const scheme = win.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  const svgBlob = new Blob([svg], { type: 'image/svg+xml' });

  const img = new win.Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = doc.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, width, height);
  try {
    const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no PNG'))), 'image/png'));
    return { blob, name: stillName({ scheme, width }) };
  } catch {
    // Tainted: this browser draws the picture but won't hand it back.
    return { blob: svgBlob, name: stillName({ scheme, width, ext: 'svg' }) };
  }
}

/** download saves a blob as `name`. */
export function download(blob, name, doc = document) {
  const a = doc.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  doc.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
