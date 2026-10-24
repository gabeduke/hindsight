// The motion tokens for styles.css, written from lib/objects/motion.js:
// the times, the eases and the springs as CSS linear() curves, the nearest
// cubic-bézier for a browser without linear(), and the one block that
// zeroes travel for less motion.
//
//   node scripts/motion-tokens.mjs           # print the block
//   node scripts/motion-tokens.mjs --write   # put it in styles.css, between its markers
//
// Change a time or a spring in motion.js, run this with --write, and
// lib/objects/motion-tokens.test.js passes again: it fails while styles.css
// and motion.js disagree.
//
// Dev only: nothing here ships.
import { readFileSync, writeFileSync } from 'node:fs';
import { BEGIN, END, motionCss } from '../web/static/lib/objects/motion-css.js';

const block = motionCss();
if (!process.argv.includes('--write')) {
  console.log(block);
  process.exit(0);
}
const file = new URL('../web/static/styles.css', import.meta.url);
const css = readFileSync(file, 'utf8');
const from = css.indexOf(BEGIN);
const to = css.indexOf(END);
if (from < 0 || to < from) {
  console.error(`styles.css has no generated block: paste the printed one where the tokens belong, markers and all.`);
  process.exit(1);
}
const next = css.slice(0, from) + block + css.slice(to + END.length);
if (next === css) console.log('styles.css already has these tokens.');
else {
  writeFileSync(file, next);
  console.log('styles.css: the motion tokens are written. Bump CACHE in web/static/sw.js.');
}
