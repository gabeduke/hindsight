// web/static/lib/help/mode.test.js
// Help mode from the header's menu (lib/help/help.js, lib/nav.js): its item
// is checked while it's on, every tip it shows carries Done, and Done or
// the item again leaves it. Its old way out, "tap ? again", went with ?.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeDoc, parseHTML } from '../play/fake-dom.js';
import { initHelp } from './help.js';
import { mountHeaderTools } from '../nav.js';

globalThis.MutationObserver ??= class { observe() {} };

function shell() {
  const html = readFileSync(new URL('../../shell.html', import.meta.url), 'utf8');
  const doc = fakeDoc();
  doc.body.append(...parseHTML(doc, /<header class="appbar">[\s\S]*?<\/header>/.exec(html)[0]).nodes);
  doc.body.append(...parseHTML(doc, '<main><button id="np-play" data-tip="tape-play">▶</button></main>').nodes);
  // As boot.js has it: help first, then the header's tools.
  const help = initHelp({ page: 'tape', doc });
  mountHeaderTools(doc);
  return { doc, help, item: doc.getElementById('help'), pop: doc.querySelector('.tip-pop') };
}
const click = (doc, el) => {
  const e = { type: 'click', target: el, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() {}, stopImmediatePropagation() { this.stopped = true; } };
  doc.dispatchEvent(e); // help mode's capture, on the document
  if (!e.stopped) el.dispatchEvent(e);
  return e;
};

test('Help mode in the menu is checked while on, and every tip carries Done', () => {
  const { doc, item, pop } = shell();
  click(doc, item);
  assert.ok(doc.body.classList.contains('help-mode'));
  assert.equal(item.getAttribute('aria-checked'), 'true', 'a menu’s item is checked, not pressed');
  assert.equal(item.hasAttribute('aria-pressed'), false);
  assert.ok(pop.querySelector('.tip-pop-done'), 'the way out is on its first tip');
  assert.doesNotMatch(pop.textContent, /Tap \?/, 'no ? to tap any more');

  // A control explains itself instead of working, and its tip has Done too.
  const play = doc.getElementById('np-play');
  let played = 0;
  play.addEventListener('click', () => { played++; });
  const e = click(doc, play);
  assert.equal(played, 0, 'in help mode ▶ only explains itself');
  assert.ok(e.defaultPrevented);
  assert.match(pop.textContent, /Play or stop the tape/);
  const done = pop.querySelector('.tip-pop-done');
  assert.ok(done);

  done.dispatchEvent({ type: 'click' });
  assert.ok(!doc.body.classList.contains('help-mode'), 'Done leaves it');
  assert.equal(item.getAttribute('aria-checked'), 'false');
  assert.equal(pop.hidden, true);
});

test('the menu’s Help mode again leaves it', () => {
  const { doc, item } = shell();
  click(doc, item);
  click(doc, item);
  assert.ok(!doc.body.classList.contains('help-mode'));
});

test('the menu’s guide opens at the page you’re on', () => {
  const { doc, help } = shell();
  const guide = doc.querySelector('.appbar-guide-link');
  click(doc, guide);
  assert.equal(guide.getAttribute('href'), '/guide.html#8-tape');
  help.setPage('takes');
  click(doc, guide);
  assert.equal(guide.getAttribute('href'), '/guide.html#31-the-takes-page');
});
