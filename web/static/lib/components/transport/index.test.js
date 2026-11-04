// The Transport's mount (index.js): what is done to its template before
// NowPlaying draws on it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { barPage } from '../../bar/bar-harness.js';
import { tipFor } from '../../help/tips.js';

test('help’s titles land on the template as it is filled, before the bar sets its keys’ tips: ⟲ says the tape’s Loop, as it did from shell.html', async () => {
  const page = await barPage();
  const loop = page.$('np-loop');
  // NowPlaying has moved ⟲'s tip to the bar's own (take-keys.js) ...
  assert.equal(loop.dataset.tip, 'np-loop');
  // ... but its title is the template's, given as the root was filled.
  assert.equal(loop.title, tipFor('tape-loop'));
  assert.equal(page.$('np-play').title, tipFor('tape-play'));
  page.np.unmount();
});

test('the shell hands the Transport help’s titles', () => {
  const boot = readFileSync(new URL('../../shell/boot.js', import.meta.url), 'utf8');
  assert.match(boot, /\btitles: applyTitles\b/);
});
