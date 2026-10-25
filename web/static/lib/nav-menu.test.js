// web/static/lib/nav-menu.test.js
// The header's one menu (lib/nav.js mountHeaderTools, on lib/ui/menu.js;
// docs/plan/the-studio-on-one-screen.md): what is in it, that nothing else
// is left in the header, and how it opens and shuts -- against the shell's
// and Open's own header markup.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeDoc, parseHTML } from './play/fake-dom.js';
import { mountHeaderTools } from './nav.js';
import { iconOf } from './ui/icons.js';

const header = (page) => {
  const html = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8');
  const doc = fakeDoc();
  doc.body.append(...parseHTML(doc, /<header class="appbar[^"]*">[\s\S]*?<\/header>/.exec(html)[0]).nodes);
  return doc;
};
const words = (el) => el.querySelector('.menu-word')?.textContent;

for (const page of ['shell.html', 'wave.html']) {
  test(`${page}: one menu holds Settings, the rig, help mode, the guide and Releases`, () => {
    const doc = header(page);
    const help = doc.getElementById('help');
    mountHeaderTools(doc);
    const menu = doc.getElementById('app-menu');
    assert.ok(menu, 'the menu');
    assert.equal(menu.getAttribute('role'), 'menu');
    assert.deepEqual(menu.children.map(words), ['Settings', 'The rig', 'Help mode', 'The guide', 'Releases']);
    // Each finds its module by the id or class it had in the header.
    assert.equal(menu.children[0].id, 'appbar-settings-btn');
    assert.ok(menu.children[1].classList.contains('app-menu-rig'));
    assert.equal(menu.children[3].getAttribute('href'), '/guide.html');
    assert.equal(menu.children[4].id, 'appbar-releases-btn');
    assert.ok(menu.children[4].querySelector('.releases-version'), 'a line for update.js’s version');
    // The page's ? is the menu's Help mode, the same element help.js holds.
    assert.equal(menu.children[2], help);
    assert.equal(help.getAttribute('role'), 'menuitemcheckbox');
    assert.equal(help.getAttribute('aria-checked'), 'false');
    // And the header holds nothing else of the tools: no ? of its own, no
    // Releases, Guide or Settings beside the menu.
    const bar = doc.querySelector('.appbar');
    const end = doc.querySelector('.appbar-end');
    assert.deepEqual(end.children.map((c) => c.id || c.className).filter((c) => c !== 'out-btn'), ['menu-anchor app-menu-anchor']);
    for (const el of bar.querySelectorAll('[data-tip]')) {
      if (['help', 'settings', 'releases', 'guide', 'rig-chip'].includes(el.dataset.tip)) {
        assert.ok(menu.contains(el), `${el.dataset.tip} is outside the menu`);
      }
    }
    const btn = doc.getElementById('app-menu-btn');
    assert.equal(btn.getAttribute('aria-haspopup'), 'menu');
    assert.ok(btn.hasAttribute('data-tip-pass'), 'help mode explains ☰ and still opens it: Help mode is inside');
    assert.equal(iconOf(btn), 'menu', '☰ is the sprite’s, as every header key is');
    assert.equal(btn.getAttribute('aria-label'), 'Menu');
    assert.equal(mountHeaderTools(doc), null, 'once');
  });
}

test('a page without help mode has no Help mode item', () => {
  const doc = header('rig.html');
  mountHeaderTools(doc);
  assert.deepEqual(doc.getElementById('app-menu').children.map(words), ['Settings', 'The rig', 'The guide', 'Releases']);
});

test('the output button and the ring’s health go into the tools, before the menu', () => {
  const doc = fakeDoc();
  doc.body.append(...parseHTML(doc, '<header class="appbar"><nav class="appnav"></nav><button id="out-btn" class="out-btn" hidden></button><div class="health"></div></header>').nodes);
  mountHeaderTools(doc);
  assert.deepEqual(doc.querySelector('.appbar-end').children.map((c) => c.id || c.className), ['out-btn', 'health', 'menu-anchor app-menu-anchor']);
});

test('the menu opens from its button and shuts on a second press, a pick, Escape or a press elsewhere', () => {
  const doc = header('shell.html');
  mountHeaderTools(doc);
  const btn = doc.getElementById('app-menu-btn');
  const menu = doc.getElementById('app-menu');
  const outside = doc.querySelector('.appnav');
  const open = () => !menu.hidden && btn.getAttribute('aria-expanded') === 'true';
  assert.ok(!open());
  btn.dispatchEvent({ type: 'click' });
  assert.ok(open(), 'a press opens it');
  btn.dispatchEvent({ type: 'click' });
  assert.ok(!open(), 'a second shuts it');

  btn.dispatchEvent({ type: 'click' });
  menu.dispatchEvent({ type: 'click', target: doc.getElementById('appbar-settings-btn').firstChild });
  assert.ok(!open(), 'a pick shuts it');

  btn.dispatchEvent({ type: 'click' });
  doc.dispatchEvent({ type: 'pointerdown', target: menu.children[0] });
  assert.ok(open(), 'a press inside leaves it');
  doc.dispatchEvent({ type: 'pointerdown', target: outside });
  assert.ok(!open(), 'a press elsewhere shuts it (the page’s other menus stop their clicks)');

  btn.dispatchEvent({ type: 'click' });
  doc.dispatchEvent({ type: 'keydown', key: 'Escape' });
  assert.ok(!open(), 'Escape shuts it');
});

// ↑ ↓ along its items, Tab, and where it opens: lib/ui/menu.test.js, as for
// every menu.
