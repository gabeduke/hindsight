import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { start } from './mount.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');

test('with the flag off the room loads nothing and touches nothing', () => {
  let loaded = 0;
  const handle = new Proxy({}, { get: () => assert.fail('the handle was read with the flag off') });
  assert.equal(start('doorway', handle, { flagOn: () => false, load: () => { loaded++; return Promise.resolve({ mount() {} }); } }), null);
  assert.equal(start('chair', handle, { flagOn: () => false, load: () => { loaded++; return Promise.resolve({ mount() {} }); } }), null);
  assert.equal(loaded, 0);
});

test('with the flag on it loads the page’s room and mounts it with the page’s handle', async () => {
  const handle = { page: 'takes' };
  let got = null;
  const r = await start('doorway', handle, { flagOn: () => true, load: async () => ({ mount: (h) => { got = h; return 'mounted'; } }) });
  assert.equal(r, 'mounted');
  assert.equal(got, handle);
});

test('a page the room doesn’t know is refused, not ignored', async () => {
  await assert.rejects(start('kitchen', {}, { flagOn: () => true }), /no room for kitchen/);
});

// The pages only reach the room through start(), so the flag decides; and
// their own markup carries none of it -- the room builds its markup when it
// mounts. The flag off is the page as it was.
test('the takes and take pages reach the room only through start()', () => {
  const shelf = read('../shelf-page.js');
  const wave = read('../wave/page.js');
  for (const [name, src] of [['shelf-page.js', shelf], ['wave/page.js', wave]]) {
    assert.ok(!/import\(['"][^'"]*room\//.test(src), `${name} imports a room module by itself`);
    assert.ok(!/from ['"][^'"]*room\/(?!mount\.js)/.test(src), `${name} imports a room module other than mount.js`);
  }
  assert.match(shelf, /startRoom\('doorway'/);
  assert.match(wave, /startRoom\('chair'/);
  for (const page of ['../../takes.html', '../../wave.html']) {
    const html = read(page).replace(/<!--[\s\S]*?-->/g, '');
    assert.ok(!/class="[^"]*\b(room|chair|book)-/.test(html), `${page} carries room markup`);
    assert.ok(!html.includes('/lib/room/'), `${page} loads a room module itself`);
  }
});

// The room builds its markup in script, so help.test.js's scan of data-tip="…"
// doesn't see its tips: every one it names must be in tips.js all the same.
test('every tip the room names is in tips.js', async () => {
  const { tipFor } = await import('../help/tips.js');
  const { readdirSync } = await import('node:fs');
  const missing = [];
  for (const f of readdirSync(new URL('./', import.meta.url)).filter((x) => x.endsWith('.js') && !x.endsWith('.test.js'))) {
    const src = read(`./${f}`);
    const ids = [
      ...[...src.matchAll(/'data-tip':\s*'([^']+)'/g)].map((m) => m[1]),
      ...[...src.matchAll(/dataset\.tip\s*=\s*'([^']+)'/g)].map((m) => m[1]),
      ...[...src.matchAll(/\bkey\([^)]*,\s*'([a-z0-9-]+)'\)/g)].map((m) => m[1]),
    ];
    for (const id of ids) if (!tipFor(id)) missing.push(`${f}: ${id}`);
  }
  assert.deepEqual(missing, []);
});

// caches.addAll is all or nothing, and a module missing from the shell is a
// room that doesn't open offline.
test('every room module is in the service worker’s shell', async () => {
  const { readdirSync } = await import('node:fs');
  const sw = read('../../sw.js');
  const missing = readdirSync(new URL('./', import.meta.url))
    .filter((x) => x.endsWith('.js') && !x.endsWith('.test.js'))
    .filter((x) => !sw.includes(`'/lib/room/${x}'`));
  assert.deepEqual(missing, []);
});
