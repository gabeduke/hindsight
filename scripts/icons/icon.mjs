// The app icon: a take, as the shelf draws one -- a cassette in black
// plastic, its J-card label in cream with an orange stripe, the two reels
// in the window and the take's waveform between them in the wave's teal.
// The colours are the cassette's own (web/static/styles.css, :root: --cas-*,
// --paper-*, --stripe-1, --hub*, --wave).
//
//   node scripts/icons/icon.mjs      writes web/static/icons/*.svg
//   node scripts/icons/render.mjs    renders the PNGs from them
//
// One drawing, three cuts:
//   icon.svg        rounded square, transparent corners: the brand mark in
//                   the bar and the manifest's "any" icon
//   icon-full.svg   full bleed, the cassette shrunk into the maskable safe
//                   zone (a circle 80% of the side), for "maskable" and the
//                   apple-touch icon, which the OS rounds itself
//   icon-small.svg  fewer, heavier parts for 32 px and under, where screws,
//                   teeth and the waveform turn to mud

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '../../web/static/icons');

const P = {
  casHi: '#3a3b40', casMid: '#1d1e21', casLo: '#121315', slot: '#0c0c0d',
  paperHi: '#f8f1de', paperLo: '#eadfc2', paperRule: 'rgba(28,36,48,.16)',
  stripe: '#e0662a', under: '#1c2430',
  hub: '#efe9d8', hubCore: '#1a1b1d', tooth: '#d9d4c6',
  pack: '#4a2e18', sheen: '#8a5a32',
  wave: '#4ebeb4', waveHot: '#7fe6dc',
};

const f = (n) => +n.toFixed(2);

const defs = `<defs>
  <radialGradient id="shell" cx=".3" cy="0" r="1.15">
    <stop offset="0" stop-color="${P.casHi}"/><stop offset=".55" stop-color="${P.casMid}"/><stop offset="1" stop-color="${P.casLo}"/>
  </radialGradient>
  <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${P.paperHi}"/><stop offset="1" stop-color="${P.paperLo}"/>
  </linearGradient>
  <linearGradient id="win" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#0a0a0b"/><stop offset="1" stop-color="#232427"/>
  </linearGradient>
  <radialGradient id="pack" cx=".4" cy=".35" r=".75">
    <stop offset="0" stop-color="#6a4426"/><stop offset=".72" stop-color="${P.pack}"/><stop offset="1" stop-color="#2a180b"/>
  </radialGradient>
  <linearGradient id="foot" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${P.casMid}"/><stop offset="1" stop-color="${P.casLo}"/>
  </linearGradient>
  <linearGradient id="wave" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${P.waveHot}"/><stop offset=".5" stop-color="${P.wave}"/><stop offset="1" stop-color="${P.waveHot}"/>
  </linearGradient>
</defs>`;

const shell = `<rect width="512" height="512" fill="url(#shell)"/>`;

function hub(cx, cy, r, small) {
  if (small) {
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${P.hub}"/><circle cx="${cx}" cy="${cy}" r="${f(r * 0.5)}" fill="${P.hubCore}"/>`;
  }
  // A ring with six teeth pointing in, round a dark core: the spool.
  let teeth = '';
  for (let k = 0; k < 6; k++) {
    const a = (k * 60 * Math.PI) / 180;
    const x = cx + r * 0.52 * Math.cos(a), y = cy + r * 0.52 * Math.sin(a);
    teeth += `<rect x="${f(x - 4)}" y="${f(y - 6)}" width="8" height="12" rx="2" fill="${P.tooth}" transform="rotate(${k * 60 + 90} ${f(x)} ${f(y)})"/>`;
  }
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${P.hubCore}"/>
    <circle cx="${cx}" cy="${cy}" r="${f(r - 5)}" fill="none" stroke="${P.hub}" stroke-width="10"/>${teeth}
    <circle cx="${cx}" cy="${cy}" r="${f(r * 0.2)}" fill="${P.hub}" opacity=".9"/>`;
}

// A title in marker on the label, too small to read: loops and a dash, the
// way the shelf's handwritten names look from across the room.
function scribble(x, y) {
  let d = `M${x} ${y}`;
  const loops = [[14, 12], [12, 16], [16, 10], [10, 14], [14, 12], [12, 15], [16, 11]];
  let cx = x;
  for (const [w, h] of loops) {
    d += `c${f(w * 0.3)} ${-h} ${f(w * 0.9)} ${-h} ${w} ${f(-h * 0.2)}s${f(-w * 0.4)} ${f(h * 0.9)} ${f(w * 0.2)} ${f(h * 0.2)}`;
    cx += w * 1.2;
  }
  d += `M${f(cx + 16)} ${y - 4}l26 -2M${f(cx + 54)} ${y}c6 -12 14 -12 16 0s10 10 18 -2c4 -8 10 -8 14 0`;
  return d;
}

function cassette({ small = false } = {}) {
  // The label (J-card): most of the face, stripe across its top.
  const lx = small ? 34 : 56, ly = small ? 44 : 74, lw = 512 - 2 * lx, lh = small ? 330 : 270, lr = small ? 22 : 18;
  const band = small ? 66 : 50, under = small ? 0 : 7;
  // The window, a pill across the label's lower half, the reels in it.
  const wy = ly + band + under + (small ? 36 : 40), wh = small ? 150 : 124, wx = lx + (small ? 22 : 42), ww = lw - 2 * (small ? 22 : 42);
  const cy = wy + wh / 2;
  const hl = wx + wh / 2 + (small ? 4 : 10), hr = wx + ww - wh / 2 - (small ? 4 : 10);
  const packL = small ? 64 : 54, packR = small ? 44 : 36, hubR = small ? 26 : 26;

  // The take's waveform between the packs, a phrase that swells and falls.
  let bars = '';
  if (!small) {
    const x0 = hl + packL + 10, x1 = hr - packR - 10, n = 9, step = (x1 - x0) / n;
    const env = [0.32, 0.55, 0.8, 0.62, 1, 0.74, 0.9, 0.5, 0.36];
    env.forEach((e, i) => {
      const h = e * (wh - 40), x = x0 + i * step + step / 2;
      bars += `<rect x="${f(x - 3)}" y="${f(cy - h / 2)}" width="6" height="${f(h)}" rx="3" fill="url(#wave)"/>`;
    });
  }

  const screws = small ? '' : [[42, 42], [470, 42], [42, 470], [470, 470]].map(([x, y]) =>
    `<circle cx="${x}" cy="${y}" r="10" fill="${P.casHi}" stroke="${P.slot}" stroke-width="2"/>` +
    `<path d="M${x - 5} ${y - 5}L${x + 5} ${y + 5}" stroke="${P.slot}" stroke-width="2.6" stroke-linecap="round"/>`).join('');

  // The foot: the ridge along the bottom edge with the four tape slots.
  const fy = ly + lh + (small ? 22 : 34), ft = small ? 150 : 132, fb = small ? 190 : 176;
  const foot = `<path d="M${256 - fb} 512L${256 - ft} ${fy}Q${256 - ft + 4} ${fy - 6} ${256 - ft + 12} ${fy - 6}L${256 + ft - 12} ${fy - 6}Q${256 + ft - 4} ${fy - 6} ${256 + ft} ${fy}L${256 + fb} 512Z" fill="url(#foot)" stroke="#000" stroke-opacity=".5" stroke-width="2"/>
    <path d="M${256 - ft + 12} ${fy - 4}L${256 + ft - 12} ${fy - 4}" stroke="#fff" stroke-opacity=".1" stroke-width="2"/>` +
    (small ? '' : [-1.5, -0.5, 0.5, 1.5].map((k) =>
      `<rect x="${f(256 + k * 58 - 14)}" y="${f(fy + 26)}" width="28" height="22" rx="5" fill="${P.slot}"/>`).join(''));

  return `
  ${screws}
  ${foot}
  <rect x="${lx}" y="${ly + 4}" width="${lw}" height="${lh}" rx="${lr}" fill="#000" opacity=".35"/>
  <clipPath id="lab"><rect x="${lx}" y="${ly}" width="${lw}" height="${lh}" rx="${lr}"/></clipPath>
  <g clip-path="url(#lab)">
    <rect x="${lx}" y="${ly}" width="${lw}" height="${lh}" fill="url(#paper)"/>
    <rect x="${lx}" y="${ly}" width="${lw}" height="${band}" fill="${P.stripe}"/>
    ${under ? `<rect x="${lx}" y="${ly + band + 4}" width="${lw}" height="${under - 3}" fill="${P.under}"/>` : ''}
    ${small ? '' : `<path d="M${lx + 30} ${ly + band + under + 30}H${lx + lw - 30}" stroke="${P.paperRule}" stroke-width="3"/>
    <path d="${scribble(lx + 34, ly + band + under + 22)}" fill="none" stroke="${P.under}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>`}
  </g>
  <rect x="${wx}" y="${wy}" width="${ww}" height="${wh}" rx="${wh / 2}" fill="url(#win)" stroke="#000" stroke-opacity=".55" stroke-width="2"/>
  <clipPath id="w"><rect x="${wx + 3}" y="${wy + 3}" width="${ww - 6}" height="${wh - 6}" rx="${wh / 2 - 3}"/></clipPath>
  <g clip-path="url(#w)">
    <circle cx="${hl}" cy="${cy}" r="${packL}" fill="url(#pack)"/>
    <circle cx="${hr}" cy="${cy}" r="${packR}" fill="url(#pack)"/>
    ${small ? '' : `<circle cx="${hl}" cy="${cy}" r="${packL - 1.5}" fill="none" stroke="${P.sheen}" stroke-opacity=".5" stroke-width="1.5"/>
    <circle cx="${hr}" cy="${cy}" r="${packR - 1.5}" fill="none" stroke="${P.sheen}" stroke-opacity=".5" stroke-width="1.5"/>`}
    ${bars}
  </g>
  ${hub(hl, cy, hubR, small)}
  ${hub(hr, cy, hubR, small)}
  <rect x="${wx + wh / 2}" y="${wy + 6}" width="${ww - wh}" height="${small ? 6 : 4}" rx="2" fill="#fff" opacity=".07"/>`;
}

// A rounded cut gets a hairline of light round its edge, so the black shell
// still has an edge on a dark home screen or tab strip.
const svg = (body, rx) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${defs}${
  rx ? `<clipPath id="sq"><rect width="512" height="512" rx="${rx}"/></clipPath><g clip-path="url(#sq)">${body}</g>` +
    `<rect x="2" y="2" width="508" height="508" rx="${rx - 2}" fill="none" stroke="#fff" stroke-opacity=".14" stroke-width="4"/>` : body
}</svg>\n`;

const inset = (art, s) => {
  const o = f((512 * (1 - s)) / 2);
  return `${shell}<g transform="translate(${o} ${o}) scale(${s})">${art}</g>`;
};

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, 'icon.svg'), svg(`${shell}${cassette()}`, 96));
writeFileSync(join(OUT, 'icon-full.svg'), svg(inset(cassette(), 0.76)));
writeFileSync(join(OUT, 'icon-small.svg'), svg(`${shell}${cassette({ small: true })}`, 88));
console.log('wrote icon.svg, icon-full.svg, icon-small.svg');
