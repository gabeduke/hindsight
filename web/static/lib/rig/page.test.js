import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { start } from './page.js';

// With the two rooms off, the rig page says where the switch is and stops:
// nothing asked of the Pi, nothing listened for, nothing drawn.
test('with the rooms off the rig page draws nothing and asks the Pi nothing', () => {
  const els = { 'rig-off': { hidden: true }, 'rig-back': { href: '' }, 'rig-room': { hidden: true } };
  const doc = { getElementById: (id) => { if (!els[id]) throw new Error(`touched #${id}`); return els[id]; } };
  const win = {
    localStorage: { getItem: () => 'true' },
    addEventListener: () => { throw new Error('listened for something'); },
  };
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('asked the Pi'); };
  try {
    assert.equal(start({ flagOn: () => false, doc, win, nav: () => {}, help: () => {} }), false);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.equal(els['rig-off'].hidden, false);
  assert.equal(els['rig-room'].hidden, true);
  assert.equal(els['rig-back'].href, '/tape.html');
});

test('the rig page has no Settings: its one way in stays the Studio’s foot', () => {
  const html = readFileSync(new URL('../../rig.html', import.meta.url), 'utf8');
  assert.ok(!html.includes('settings-btn'));
  assert.ok(html.includes('<script type="module" src="/lib/rig/page.js"></script>'));
});
