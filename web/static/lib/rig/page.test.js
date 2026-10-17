import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// The page's module loads in node, with no document: it starts only on rig.html.
import './page.js';

test('the rig page has no Settings of its own: the header’s, on every page, is the way in', () => {
  const html = readFileSync(new URL('../../rig.html', import.meta.url), 'utf8');
  assert.ok(!html.includes('settings-btn'));
  assert.ok(html.includes('<script type="module" src="/lib/rig/page.js"></script>'));
});
