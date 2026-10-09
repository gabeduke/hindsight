// Renders the PNG icons from the SVGs that scripts/icons/icon.mjs writes.
// Needs playwright (see scripts/screenshots.mjs for how to get it); the
// browser draws the SVG, so the PNGs match what the brand mark in the bar
// looks like.
//
//   node scripts/icons/icon.mjs && node scripts/icons/render.mjs

import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '../../web/static/icons');

// [svg, png, size, transparent corners?]
const JOBS = [
  ['icon.svg', 'icon-192.png', 192, true],
  ['icon.svg', 'icon-512.png', 512, true],
  ['icon-full.svg', 'icon-maskable-512.png', 512, false],
  ['icon-full.svg', 'apple-touch-icon.png', 180, false],
  ['icon-small.svg', 'favicon-32.png', 32, true],
];

const browser = await chromium.launch();
for (const [src, out, size, alpha] of JOBS) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  const svg = readFileSync(join(DIR, src), 'utf8').replace(/width="512" height="512"/, `width="${size}" height="${size}"`);
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.locator('svg').screenshot({ path: join(DIR, out), omitBackground: alpha });
  console.log(`${out} (${size}px)`);
  await page.close();
}
await browser.close();
