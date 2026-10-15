// web/static/lib/buffer/styles.test.js
// The buffer's CSS reaches only the buffer. It's behind the two rooms'
// per-device flag, but styles.css is on every page of every kit, so a bare
// rule here would restyle the kits that never turned it on (AGENTS.md, CSS).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8');

function p2Block() {
  const start = css.indexOf('/* ---------- Rooms P2:');
  assert.ok(start >= 0, 'the Rooms P2 block');
  const next = css.slice(start + 1).search(/\/\* -{4,} /);
  return css.slice(start, next < 0 ? undefined : start + 1 + next).replace(/\/\*[\s\S]*?\*\//g, '');
}

test('every rule in the buffer’s block hangs off a buffer- class', () => {
  const loose = [];
  for (const m of p2Block().matchAll(/([^{}]+)\{/g)) {
    if (m[1].trim().startsWith('@')) continue; // a media query, or the glow's keyframes
    for (const sel of m[1].split(',').map((x) => x.trim())) {
      if (!sel || sel.startsWith('@') || /^(from|to|\d+%)$/.test(sel)) continue;
      if (!/\.buffer-[a-z0-9-]+/.test(sel)) loose.push(sel);
    }
  }
  assert.deepEqual(loose, [], 'these could match something that is not the buffer');
});

test('nothing but the buffer wears a buffer- class', () => {
  // Its markup is tape.html's buffer templates; its script is lib/buffer.
  const root = new URL('../../', import.meta.url);
  const files = readdirSync(root, { recursive: true }).filter((f) =>
    (f.endsWith('.html') || f.endsWith('.js')) && !f.endsWith('.test.js') && !f.includes('lib/buffer/'));
  const borrowed = [];
  for (const f of files) {
    const text = readFileSync(new URL(f, root), 'utf8')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<template id="buffer-[a-z-]+">[\s\S]*?<\/template>/g, '')
      .replace(/\sid="[^"]*"/g, '')
      .replace(/\sdata-tip="[^"]*"/g, '') // a tip's name, not a class
      .replace(/ids: \[[^\]]*\]/g, '') // the tips' names in lib/help/tips.js
      .replace(/'\.\.\/buffer\/[a-z]+\.js'/g, '');
    for (const m of text.matchAll(/(?:^|[^\w-])(buffer-[a-z0-9-]+)/g)) borrowed.push(`${f}: ${m[1]}`);
  }
  assert.deepEqual(borrowed, [], 'these files use a class the buffer styles');
});
