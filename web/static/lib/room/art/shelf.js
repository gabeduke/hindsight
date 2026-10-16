// web/static/lib/room/art/shelf.js
// What else lives on the shelves, besides the takes: a row of books and a
// plant on the top shelf, and LPs on the bottom one. The shelves themselves
// are the page's markup; these are pictures set into their cubbies
// (aria-hidden), drawn in a box of their own units -- w across, h up -- and
// stretched to fit by the browser.

import { f, fill, rng } from './kit.js';

const BOOKS = ['--room-book-1', '--room-book-2', '--room-book-3', '--room-book-4', '--room-book-5', '--room-paper', '--room-cardboard-lo', '--room-lp-2'];

/** top is the top two shelves: reel boxes and a photo; then books upright, one leaning, a stack lying down, a trailing plant. */
export function shelfTop(w = 200, h = 40) {
  const r = rng(23);
  let s = '';
  let x = 4;
  while (x < w * 0.5) {
    const bw = 2.4 + r() * 3.4, bh = h * (0.6 + r() * 0.34);
    const c = BOOKS[Math.floor(r() * BOOKS.length)];
    s += `<rect x="${f(x)}" y="${f(h - bh)}" width="${f(bw)}" height="${f(bh)}" ${fill(c)}/>`;
    // A band or two on the spine, and its title as a pale bar.
    s += `<rect x="${f(x)}" y="${f(h - bh + 3)}" width="${f(bw)}" height=".8" ${fill('--room-plate-hi', 0.55)}/>`;
    if (r() > 0.4) s += `<rect x="${f(x + bw * 0.3)}" y="${f(h - bh * 0.7)}" width="${f(bw * 0.4)}" height="${f(bh * 0.35)}" ${fill('--room-paper', 0.3)}/>`;
    s += `<rect x="${f(x + bw - 0.5)}" y="${f(h - bh)}" width=".5" height="${f(bh)}" ${fill('--room-shadow', 0.4)}/>`;
    x += bw + 0.15;
  }
  // One leaning against the rest.
  const lb = h * 0.82;
  s += `<rect x="${f(x + 1)}" y="${f(h - lb)}" width="4.2" height="${f(lb)}" ${fill('--room-book-3')} transform="rotate(14 ${f(x + 5)} ${f(h)})"/>`;
  x += 16;
  // A stack, lying down, with a small brass bookend... and a cassette on top.
  let y = h;
  for (let i = 0; i < 4; i++) {
    const bh = 2.6 + r() * 2, bw = 22 + r() * 8;
    y -= bh;
    s += `<rect x="${f(x + (r() - 0.5) * 3)}" y="${f(y)}" width="${f(bw)}" height="${f(bh)}" ${fill(BOOKS[Math.floor(r() * BOOKS.length)])}/>`;
    s += `<rect x="${f(x)}" y="${f(y + bh - 0.4)}" width="${f(bw)}" height=".4" ${fill('--room-shadow', 0.4)}/>`;
  }
  s += `<rect x="${f(x + 4)}" y="${f(y - 2.6)}" width="16" height="2.6" rx=".4" ${fill('--cas-mid')}/><rect x="${f(x + 5)}" y="${f(y - 2.2)}" width="14" height="1.2" ${fill('--paper-hi')}/>`;
  x += 38;
  // The plant: a terracotta pot, leaves spilling over the shelf's edge.
  const px = Math.min(w - 22, x + 18);
  s += `<path d="M${f(px - 9)},${f(h - 15)}h18l-2,15h-14z" ${fill('--room-pot')}/><rect x="${f(px - 10)}" y="${f(h - 17)}" width="20" height="3" ${fill('--room-pot-hi')}/>`;
  for (let i = 0; i < 16; i++) {
    const a = -Math.PI * (0.05 + r() * 0.9);
    const len = 8 + r() * 12;
    const lx = px + Math.cos(a) * len * 0.9, ly = h - 17 + Math.sin(a) * len * 0.8;
    s += `<path d="M${f(px)},${f(h - 16)}Q${f((px + lx) / 2)},${f(ly - 3)} ${f(lx)},${f(ly)}" fill="none" style="stroke:var(--room-leaf-lo)" stroke-width=".5"/>`;
    s += `<ellipse cx="${f(lx)}" cy="${f(ly)}" rx="${f(2.4 + r())}" ry="${f(1.3 + r() * 0.6)}" transform="rotate(${f((a * 180) / Math.PI + 90)} ${f(lx)} ${f(ly)})" ${fill(i % 3 ? '--room-leaf' : '--room-leaf-hi')}/>`;
  }
  // Trailing down over the edge.
  for (let i = 0; i < 6; i++) {
    const tx = px + 6 + i * 1.6, ty = h - 4 + i * 2.8;
    s += `<ellipse cx="${f(tx)}" cy="${f(ty)}" rx="2" ry="1.2" ${fill(i % 2 ? '--room-leaf' : '--room-leaf-lo')}/>`;
  }
  // The shelf above: reel boxes standing spine out, their masking-tape
  // labels scribbled on, and a photo leant at the end; then its board.
  const up = h; // the upper cubby is as tall as the lower
  let u = '';
  const rb = rng(47);
  let ux = 6;
  const boxes = ['--room-box-1', '--room-box-2', '--room-box-3', '--room-box-4', '--room-cardboard-hi'];
  for (let i = 0; i < 9; i++) {
    const bw = 4.2 + rb() * 1.6, bh = up * (0.6 + rb() * 0.12);
    u += `<rect x="${f(ux)}" y="${f(up - bh)}" width="${f(bw)}" height="${f(bh)}" ${fill(boxes[Math.floor(rb() * boxes.length)])}/>`;
    u += `<rect x="${f(ux + 0.7)}" y="${f(up - bh * 0.62)}" width="${f(bw - 1.4)}" height="${f(bh * 0.26)}" ${fill('--room-mask', 0.75)}/>`;
    u += `<path d="M${f(ux + bw / 2)},${f(up - bh * 0.6)}v${f(bh * 0.2)}" style="stroke:var(--marker)" stroke-width=".5" stroke-opacity=".6"/>`;
    u += `<rect x="${f(ux + bw - 0.4)}" y="${f(up - bh)}" width=".4" height="${f(bh)}" ${fill('--room-shadow', 0.45)}/>`;
    ux += bw + 0.2;
  }
  ux += 10;
  u += `<g transform="rotate(-8 ${f(ux + 8)} ${f(up)})"><rect x="${f(ux)}" y="${f(up - 22)}" width="16" height="22" ${fill('--room-walnut-deep')}/><rect x="${f(ux + 2)}" y="${f(up - 20)}" width="12" height="18" ${fill('--room-sky-lo')}/><circle cx="${f(ux + 8)}" cy="${f(up - 12)}" r="3.4" ${fill('--room-poster-sun', 0.8)}/><rect x="${f(ux + 2)}" y="${f(up - 8)}" width="12" height="6" ${fill('--room-city-mid')}/></g>`;
  ux += 40;
  // A small stack of cassettes.
  for (let i = 0; i < 3; i++) u += `<rect x="${f(ux + (i % 2) * 1.5)}" y="${f(up - 2.6 * (i + 1))}" width="16" height="2.5" rx=".4" ${fill('--cas-mid')}/><rect x="${f(ux + 1 + (i % 2) * 1.5)}" y="${f(up - 2.6 * (i + 1) + 0.5)}" width="14" height="1.2" ${fill('--paper-hi', 0.6)}/>`;
  const board = `<rect x="-4" y="${f(up)}" width="${w + 8}" height="4" ${fill('--room-walnut')}/><rect x="-4" y="${f(up)}" width="${w + 8}" height=".6" ${fill('--room-walnut-hi')}/><rect x="-4" y="${f(up + 4)}" width="${w + 8}" height="5" ${fill('--room-shadow', 0.45)}/>`;
  const shade = `<rect x="-4" y="0" width="${w + 8}" height="7" ${fill('--room-shadow', 0.35)}/>`;
  return `<svg class="room-art-deco" viewBox="0 0 ${w} ${up + 4 + h}" preserveAspectRatio="xMinYMax meet" overflow="visible" aria-hidden="true" focusable="false">${u}${board}<g transform="translate(0 ${up + 4})">${shade}${s}</g></svg>`;
}

/** bottom is the bottom shelf: LPs in a long row, some sleeves facing out. */
export function shelfBottom(w = 200, h = 34) {
  const r = rng(31);
  const LPS = ['--room-lp-1', '--room-lp-2', '--room-lp-3', '--room-lp-4', '--room-lp-5', '--room-paper', '--room-cardboard-hi', '--room-book-2'];
  let s = '';
  let x = 2;
  // A sleeve facing out, leant at the left, then the spines.
  s += `<rect x="2" y="${f(h - 31)}" width="31" height="31" ${fill('--room-lp-4')}/><circle cx="17.5" cy="${f(h - 15.5)}" r="9" ${fill('--room-poster-sun')}/><circle cx="17.5" cy="${f(h - 15.5)}" r="3" ${fill('--room-lp-4')}/>`;
  s += `<rect x="2" y="${f(h - 31)}" width="31" height="31" fill="none" style="stroke:var(--room-shadow)" stroke-opacity=".4" stroke-width=".5"/>`;
  x = 36;
  while (x < w - 4) {
    const bw = 0.7 + r() * 1.1;
    s += `<rect x="${f(x)}" y="${f(h - 31.5 + r() * 1.5)}" width="${f(bw)}" height="31.5" ${fill(LPS[Math.floor(r() * LPS.length)])}/>`;
    x += bw + 0.1;
    if (r() > 0.97) x += 2;
  }
  return `<svg class="room-art-deco" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" overflow="visible" aria-hidden="true" focusable="false">${s}</svg>`;
}
