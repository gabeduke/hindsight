// The stylesheet's half of a take in the bar (take-keys.js, F5b), checked from
// the CSS text: nothing in node lays a page out, so these pin the rules the
// phone's mini player for a take rests on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8');
const PHONE = '@media (max-width: 699.98px), (orientation: landscape) and (max-height: 440px) {';

// The phone block that holds the take's mini player, brace-matched.
function phoneBlock() {
  const at = css.indexOf(PHONE, css.indexOf('.np.np-take #np-open'));
  assert.ok(at > 0, 'the phone block for a take follows its wide-screen rules');
  let depth = 0;
  for (let i = css.indexOf('{', at); i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(at, i);
  }
  throw new Error('unbalanced');
}
const hasRule = (text, selector, decl) => {
  const re = new RegExp(`${selector.replace(/[.[\]()*+?^$|\\#"=:>]/g, '\\$&')}\\s*\\{[^}]*${decl.replace(/[.()]/g, '\\$&')}`);
  return re.test(text);
};

test('a take in the bar hides Open ›: its name is the way in', () => {
  assert.ok(hasRule(css, '.np.np-take #np-open', 'display: none'));
});

test('the phone’s mini player for a take shows its name, ✎ and ⏏, over the rule that hides a bar’s extras', () => {
  const p = phoneBlock();
  assert.match(p, /\.np\.np-take \.np-own > :is\(\.np-name, \.np-note, \.np-eject:not\(\[hidden\]\)\) \{ display: inline-flex !important; \}/);
});

test('the phone’s mini player for a take has no window and no ▾: there is no player to pull up', () => {
  assert.ok(hasRule(phoneBlock(), 'body:not(.player-open) .np.np-take .np-window', 'display: none'));
});

test('the phone’s mini player for a take shows its strip', () => {
  assert.ok(hasRule(phoneBlock(), 'body:not(.player-open) .np.np-take #np-scrub', 'display: block !important'));
});

test('Repeat, when it is on, shows on the phone’s mini player for a take, so it can be turned off', () => {
  assert.ok(hasRule(phoneBlock(), 'body:not(.player-open) .np.np-take .np-keys > #np-loop[aria-pressed="true"]', 'display: inline-flex !important'));
});
