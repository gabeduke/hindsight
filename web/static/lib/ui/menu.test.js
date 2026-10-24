// web/static/lib/ui/menu.test.js
// One menu module (lib/ui/menu.js): where a panel goes beside its key
// (place, which took in the ⋯ menu's fit, the ▾ panels', Catch's and the
// input menu's), how a menu opens and closes on the page's stack, the keys
// that move along it, a key's ▾, and the one row style. The ⋯ menu's fit
// (lib/tape/menu-fit.test.js) and the ▾ panels' (lib/rooms/keymenu.test.js)
// are ported here as place's and splitKey's cases.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeDoc, parseHTML } from '../play/fake-dom.js';
import { createLayers } from './layers.js';
import { menu, place, splitKey, menuItem, menuRows } from './menu.js';

const rect = (left, top, width, height) => ({ left, top, right: left + width, bottom: top + height, width, height });
const PHONE = { width: 390, height: 844 };
const TABLET = { width: 1024, height: 768 };

// --- place: across --------------------------------------------------------------

// The ⋯ menu was right-aligned to its button, which is at a phone's left edge:
// its first item read "ame this tape…", 44 and 144 px short.
test('place: a panel that fits stays on its anchor', () => {
  assert.equal(place(rect(20, 40, 44, 44), { width: 200, height: 100 }, PHONE, { align: 'start' }).left, 20);
  assert.equal(place(rect(200, 40, 44, 44), { width: 200, height: 100 }, PHONE).left, 44, 'its right edge on the anchor’s');
  assert.equal(place(rect(8, 40, 44, 44), { width: 374, height: 100 }, PHONE, { align: 'start' }).left, 8, 'exactly at the margins');
});

test('place: a panel off the left edge moves right, to the margin', () => {
  assert.equal(place(rect(100, 40, 56, 44), { width: 200, height: 100 }, PHONE).left, 8); // it was at -44
  assert.equal(place(rect(0, 40, 56, 44), { width: 200, height: 100 }, PHONE).left, 8); // and at -144
});

test('place: a panel off the right edge moves left, to the margin', () => {
  assert.equal(place(rect(250, 40, 44, 44), { width: 200, height: 100 }, PHONE, { align: 'start' }).left, 182);
});

test('place: a panel wider than the screen lines up on its left edge, not cut at both', () => {
  assert.equal(place(rect(300, 40, 80, 44), { width: 410, height: 100 }, { width: 360, height: 640 }).left, 8);
});

// --- place: up and down ----------------------------------------------------------

test('place: under its key (KEEP ▾, GRAB ▾), its right edge on the pair’s', () => {
  const pair = rect(600, 90, 160, 44);
  const at = place(pair, { width: 320, height: 200 }, TABLET);
  assert.deepEqual([at.left, at.top, at.maxHeight, at.side], [440, 140, null, 'below']);
  assert.equal(at.origin, '320px 0', 'it grows from the pair’s corner, its own top right');
});

test('place: over its key where the key is at the foot of the page (Catch ▾ in the dock)', () => {
  const key = rect(900, 700, 100, 56);
  const at = place(key, { width: 230, height: 180 }, TABLET, { side: 'above' });
  assert.deepEqual([at.left, at.top, at.side], [770, 700 - 6 - 180, 'above']);
  assert.equal(at.origin, '230px 100%', 'from its bottom right, the key’s corner');
  // Taller than the room over it: it stops at the top margin and scrolls.
  const tall = place(rect(900, 150, 100, 56), { width: 230, height: 400 }, TABLET, { side: 'above' });
  assert.deepEqual([tall.top, tall.maxHeight], [8, 150 - 6 - 8]);
});

test('place: under its chip, or over it where the bar at the foot leaves no room (a track’s input menu)', () => {
  const floor = 768 - 120; // #np's top
  const high = place(rect(200, 300, 60, 28), { width: 240, height: 200 }, TABLET, { align: 'start', floor });
  assert.deepEqual([high.left, high.top, high.side], [200, 334, 'below']);
  assert.equal(high.origin, '0px 0', 'from its top left, the chip’s corner');
  const low = place(rect(200, 500, 60, 28), { width: 240, height: 200 }, TABLET, { align: 'start', floor });
  assert.deepEqual([low.top, low.side], [500 - 6 - 200, 'above'], 'it would have gone under the bar');
  // Too tall either way: on the side with more room, scrolling.
  const both = place(rect(200, 400, 60, 28), { width: 240, height: 500 }, TABLET, { align: 'start', floor });
  assert.deepEqual([both.side, both.top, both.maxHeight], ['above', 8, 400 - 6 - 8]);
  const roomy = place(rect(200, 200, 60, 28), { width: 240, height: 500 }, TABLET, { align: 'start', floor });
  assert.deepEqual([roomy.side, roomy.top, roomy.maxHeight], ['below', 234, floor - 8 - 234]);
});

test('place: the anchor’s corner stays its origin when the panel is moved in from a side', () => {
  const at = place(rect(10, 40, 44, 44), { width: 200, height: 100 }, PHONE);
  assert.equal(at.left, 8);
  assert.equal(at.origin, '46px 0', 'the ▾’s right edge, 2 px in from the screen’s margin');
});

// --- menu ---------------------------------------------------------------------------

// A page: a button, its panel of three items (one hidden), and something
// elsewhere; a window to place against and listen on; a stack with
// CloseWatcher, so Escape and Back are close requests.
function aPage(html = `<button id="b">☰</button>
  <div id="m" hidden><button id="i1">One</button><a id="i2" hidden>Two</a><a id="i3" href="/x">Three</a></div>
  <button id="elsewhere">x</button>`) {
  const doc = fakeDoc();
  doc.body.append(...parseHTML(doc, html).nodes);
  const $ = (id) => doc.getElementById(id);
  const heard = [];
  const win = {
    innerWidth: 1024,
    innerHeight: 768,
    addEventListener(type, fn, opts) { heard.push({ type, fn, capture: opts === true || !!opts?.capture }); },
    removeEventListener(type, fn) { const i = heard.findIndex((x) => x.type === type && x.fn === fn); if (i >= 0) heard.splice(i, 1); },
    fire(type, e = {}) {
      const ev = { type, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...e };
      for (const x of [...heard].sort((a, b) => b.capture - a.capture)) if (x.type === type) x.fn(ev);
      return ev;
    },
    count: (type) => heard.filter((x) => x.type === type).length,
  };
  const live = [];
  class CloseWatcher { constructor() { live.push(this); } destroy() { const k = live.indexOf(this); if (k >= 0) live.splice(k, 1); } }
  const layers = createLayers({ doc, win, CloseWatcher });
  const request = () => live.pop()?.onclose?.(); // Escape, or Android's Back
  const key = (k, at = doc) => {
    const ev = { type: 'keydown', key: k, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; } };
    at.dispatchEvent(ev);
    return ev;
  };
  const press = (el) => win.fire('pointerdown', { target: el });
  return { doc, $, win, layers, request, key, press };
}

test('menu: the button says what it opens, and opens and shuts it', () => {
  const p = aPage();
  const m = menu(p.$('b'), p.$('m'), { layers: p.layers, win: p.win });
  const b = p.$('b'), panel = p.$('m');
  assert.equal(b.getAttribute('aria-haspopup'), 'menu');
  assert.equal(b.getAttribute('aria-controls'), 'm');
  assert.equal(b.getAttribute('aria-expanded'), 'false');
  assert.equal(panel.getAttribute('role'), 'menu');
  assert.equal(panel.dataset.state, 'closed');
  b.dispatchEvent({ type: 'click' });
  assert.ok(m.isOpen());
  assert.ok(!panel.hidden);
  assert.equal(panel.dataset.state, 'open', 'styles.css grows it in by this');
  assert.equal(b.getAttribute('aria-expanded'), 'true');
  assert.equal(p.layers.top()?.el, panel, 'on the page’s stack');
  b.dispatchEvent({ type: 'click' });
  assert.ok(!m.isOpen());
  assert.ok(panel.hidden);
  assert.equal(panel.dataset.state, 'closed', 'and fades it out by this');
  assert.ok(panel.inert, 'taking no press or focus while it fades');
  assert.equal(p.layers.size, 0);
});

test('menu: a panel with no id gets one, for its button to name', () => {
  const p = aPage('<button id="b">▾</button><div class="pop" hidden><button>1</button></div>');
  const panel = p.doc.querySelector('.pop');
  menu(p.$('b'), panel, { layers: p.layers, win: p.win, role: 'dialog' });
  assert.ok(panel.id);
  assert.equal(p.$('b').getAttribute('aria-controls'), panel.id);
  assert.equal(p.$('b').getAttribute('aria-haspopup'), 'dialog');
  assert.equal(panel.getAttribute('role'), 'dialog');
});

test('menu: it closes only through its layer: a press outside, Escape or Back, a pick, a switch of rooms', () => {
  const p = aPage();
  const m = menu(p.$('b'), p.$('m'), { layers: p.layers, win: p.win });
  m.open();
  p.press(p.$('i1'));
  assert.ok(m.isOpen(), 'a press inside leaves it');
  p.press(p.$('b'));
  assert.ok(m.isOpen(), 'a press on its button is the button’s');
  p.press(p.$('elsewhere'));
  assert.ok(!m.isOpen(), 'a press elsewhere shuts it');

  m.open();
  p.$('i1').focus();
  p.request();
  assert.ok(!m.isOpen(), 'Escape or Back shuts it');
  assert.equal(p.doc.activeElement, p.$('b'), 'and the keyboard is back on its button');

  m.open();
  p.$('m').dispatchEvent({ type: 'click', target: p.$('i1') });
  assert.ok(!m.isOpen(), 'a pick shuts it');

  m.open();
  p.layers.closeAll({ kinds: ['menu', 'popover'], reason: 'navigate' }); // the router, before a switch
  assert.ok(!m.isOpen(), 'a switch of rooms shuts it');
  m.open();
  assert.ok(m.isOpen(), 'and it opens again after');
});

test('menu: a pick says how it closed: a link leaves the history to the page it loads', () => {
  const p = aPage();
  const why = [];
  const layers = { open: (spec) => p.layers.open({ ...spec, onClose: (r) => { why.push(r); spec.onClose(r); } }) };
  const m = menu(p.$('b'), p.$('m'), { layers, win: p.win });
  m.open();
  p.$('m').dispatchEvent({ type: 'click', target: p.$('i1') });
  m.open();
  p.$('m').dispatchEvent({ type: 'click', target: p.$('i3') });
  assert.deepEqual(why, ['pick', 'navigate']);
});

test('menu: an item that can’t go stays, and says why itself', () => {
  const p = aPage('<button id="b">▾</button><div id="m" hidden><button id="no" aria-disabled="true">No</button></div>');
  const m = menu(p.$('b'), p.$('m'), { layers: p.layers, win: p.win });
  m.open();
  p.$('m').dispatchEvent({ type: 'click', target: p.$('no') });
  assert.ok(m.isOpen());
});

test('menu: ↑ ↓ move along the shown items, round and round; Home and End go to the ends', () => {
  const p = aPage(`<button id="b"></button><div id="m" hidden>
    <button id="i1"></button><a id="i2" hidden></a><button id="i3"></button><button id="i4" disabled></button><button id="i5"></button></div>`);
  menu(p.$('b'), p.$('m'), { layers: p.layers, win: p.win });
  p.$('b').dispatchEvent({ type: 'click' });
  p.key('ArrowDown');
  assert.equal(p.doc.activeElement?.id, 'i1', 'into it, from nowhere (Safari doesn’t focus a button it clicks)');
  p.key('ArrowDown');
  assert.equal(p.doc.activeElement?.id, 'i3', 'past the hidden one');
  p.key('ArrowDown');
  assert.equal(p.doc.activeElement?.id, 'i5', 'past the disabled one');
  p.key('ArrowDown');
  assert.equal(p.doc.activeElement?.id, 'i1', 'round again');
  p.key('ArrowUp');
  assert.equal(p.doc.activeElement?.id, 'i5');
  p.key('Home');
  assert.equal(p.doc.activeElement?.id, 'i1');
  p.key('End');
  assert.equal(p.doc.activeElement?.id, 'i5');
});

test('menu: the arrows are the page’s again once it closes, and in a field elsewhere', () => {
  const p = aPage(`<button id="b"></button><div id="m" hidden><button id="i1"></button></div><input id="f">`);
  const m = menu(p.$('b'), p.$('m'), { layers: p.layers, win: p.win });
  m.open();
  p.$('f').focus();
  p.key('ArrowDown');
  assert.equal(p.doc.activeElement?.id, 'f', 'a field keeps its own');
  m.close();
  p.$('b').focus();
  p.key('ArrowDown');
  assert.equal(p.doc.activeElement?.id, 'b');
  assert.equal(p.doc.listenerCount('keydown'), 0, 'nothing of it listens while it is shut');
});

test('menu: ↓ or ↑ on the button, or Enter (a click with no pointer), opens it with the keyboard in it', () => {
  const p = aPage();
  const m = menu(p.$('b'), p.$('m'), { layers: p.layers, win: p.win });
  p.key('ArrowDown', p.$('b'));
  assert.ok(m.isOpen());
  assert.equal(p.doc.activeElement?.id, 'i1', 'on its first item');
  m.close();
  p.key('ArrowUp', p.$('b'));
  assert.equal(p.doc.activeElement?.id, 'i3', 'or, by ↑, its last');
  m.close();
  p.$('b').dispatchEvent({ type: 'click', detail: 0 });
  assert.equal(p.doc.activeElement?.id, 'i1');
  m.close();
  p.$('b').focus();
  p.$('b').dispatchEvent({ type: 'click', detail: 1 });
  assert.equal(p.doc.activeElement?.id, 'b', 'a tap leaves the focus be');
});

test('menu: opened by a key, a panel puts the keyboard on what is chosen', () => {
  const p = aPage(`<button id="b"></button><div id="m" hidden>
    <button id="a" aria-pressed="false">30s</button><button id="c" aria-pressed="true">2m</button></div>`);
  const m = menu(p.$('b'), p.$('m'), { layers: p.layers, win: p.win, role: 'dialog', focus: 'checked' });
  m.open({ byKey: true });
  assert.equal(p.doc.activeElement?.id, 'c');
  p.key('ArrowRight');
  assert.equal(p.doc.activeElement?.id, 'a', '← → move along a panel’s choices too');
});

test('menu: Tab closes it, and the keyboard goes on from its button', () => {
  const p = aPage();
  const m = menu(p.$('b'), p.$('m'), { layers: p.layers, win: p.win });
  m.open({ byKey: true });
  const ev = p.key('Tab');
  assert.ok(!m.isOpen());
  assert.equal(p.doc.activeElement, p.$('b'));
  assert.equal(ev.defaultPrevented, false, 'the Tab itself goes on, from the button');
});

test('menu: placed beside its anchor as it opens, and again as the page scrolls or the window changes size', () => {
  const p = aPage();
  const b = p.$('b'), panel = p.$('m');
  let at = rect(900, 10, 44, 44);
  b.getBoundingClientRect = () => at;
  panel.getBoundingClientRect = () => rect(0, 0, 250, 300);
  let rendered = 0;
  const m = menu(b, panel, { layers: p.layers, win: p.win, render: () => { rendered++; } });
  m.open();
  assert.equal(rendered, 1, 'filled as it opens');
  assert.deepEqual([panel.style.left, panel.style.top, panel.style.maxHeight], ['694px', '60px', '']);
  assert.equal(panel.style.transformOrigin, '250px 0', 'grown from the button’s corner');
  at = rect(900, 300, 44, 44);
  p.win.fire('scroll', { target: p.doc });
  assert.equal(panel.style.top, '350px');
  p.win.fire('scroll', { target: panel });
  at = rect(900, 20, 44, 44);
  p.win.fire('scroll', { target: panel });
  assert.equal(panel.style.top, '350px', 'its own scrolling moves nothing');
  p.win.fire('resize');
  assert.equal(panel.style.top, '70px');
  m.refresh();
  assert.equal(rendered, 2, 'refresh fills it again');
  m.close();
  assert.equal(p.win.count('scroll') + p.win.count('resize'), 0, 'it stops following once shut');
});

// GRAB's panel opened 65 px right of its ▾: measured where it stood (its
// width squeezed by the screen's edge), it was placed for a narrower panel.
test('menu: measured at the screen’s corner, so where it stood before can’t squeeze it', () => {
  const p = aPage();
  const b = p.$('b'), panel = p.$('m');
  b.getBoundingClientRect = () => rect(700, 100, 40, 44);
  // As a fixed box shrinks to fit: no wider than the room right of its left.
  panel.getBoundingClientRect = () => {
    const left = parseFloat(panel.style.left) || 0;
    return rect(left, 0, Math.min(520, 1024 - left), 160);
  };
  panel.style.left = '900px';
  const m = menu(b, panel, { layers: p.layers, win: p.win });
  m.open();
  assert.equal(panel.style.left, `${740 - 520}px`, 'its right edge on the button’s');
});

test('menu: the floor keeps it off the bar at the foot of the page', () => {
  const p = aPage();
  const b = p.$('b'), panel = p.$('m');
  b.getBoundingClientRect = () => rect(100, 500, 44, 44);
  panel.getBoundingClientRect = () => rect(0, 0, 200, 150);
  const m = menu(b, panel, { layers: p.layers, win: p.win, align: 'start', floor: () => 640 });
  m.open();
  assert.equal(panel.style.top, `${500 - 6 - 150}px`, 'over its button, not under the bar');
});

test('menu: shown again after a page hid it under its open layer', () => {
  // Open hides every .menu as one of its own opens (lib/wave/page.js).
  const p = aPage();
  const m = menu(p.$('b'), p.$('m'), { layers: p.layers, win: p.win });
  m.open();
  p.$('m').hidden = true;
  assert.ok(!m.isOpen());
  p.$('b').dispatchEvent({ type: 'click' });
  assert.ok(m.isOpen());
  assert.equal(p.layers.size, 1, 'on the one layer it had');
});

// --- splitKey: a key and its ▾ (was lib/rooms/keymenu.test.js) ----------------------

function aPair() {
  const p = aPage(`
    <span id="pair"><button id="key">KEEP</button><button id="more">▾</button></span>
    <div id="pop" hidden><button id="a">30s</button><button id="c">2m</button></div>
    <button id="elsewhere">x</button>`);
  const m = splitKey(p.$('key'), p.$('more'), p.$('pop'), { layers: p.layers, win: p.win });
  return { ...p, m };
}

test('splitKey: the ▾ opens the panel and shuts it again; it says it has a panel', () => {
  const { $, m } = aPair();
  const more = $('more');
  assert.equal(more.getAttribute('aria-haspopup'), 'dialog');
  assert.equal(more.getAttribute('aria-controls'), 'pop');
  more.dispatchEvent({ type: 'click' });
  assert.ok(m.isOpen());
  assert.equal(more.getAttribute('aria-expanded'), 'true');
  more.dispatchEvent({ type: 'click' });
  assert.ok(!m.isOpen());
  assert.equal(more.getAttribute('aria-expanded'), 'false');
});

test('splitKey: a press on the verb, elsewhere, or Escape shuts it; a choice in it leaves it', () => {
  const { $, m, press, request } = aPair();
  $('more').dispatchEvent({ type: 'click' });
  press($('a'));
  $('pop').dispatchEvent({ type: 'click', target: $('a') });
  assert.ok(m.isOpen(), 'a choice in the panel leaves it open, for the next');
  press($('key'));
  assert.ok(!m.isOpen(), 'a press on the verb: it goes with what is chosen, and the panel shuts');

  $('more').dispatchEvent({ type: 'click' });
  $('key').dispatchEvent({ type: 'click' }); // Enter on the verb: no press first
  assert.ok(!m.isOpen(), 'so does the verb from the keyboard');

  $('more').dispatchEvent({ type: 'click' });
  press($('elsewhere'));
  assert.ok(!m.isOpen());

  $('more').dispatchEvent({ type: 'click' });
  request();
  assert.ok(!m.isOpen());
});

test('splitKey: ↓ on the ▾ opens it with the focus on its first choice', () => {
  const { doc, $, m, key } = aPair();
  key('ArrowDown', $('more'));
  assert.ok(m.isOpen());
  assert.equal(doc.activeElement, $('a'));
});

test('splitKey: placed under the pair, its right edge on the pair’s', () => {
  const { $, m } = aPair();
  $('pair').getBoundingClientRect = () => rect(600, 90, 160, 44);
  $('pop').getBoundingClientRect = () => rect(0, 0, 320, 200);
  m.open();
  assert.deepEqual([$('pop').style.left, $('pop').style.top], ['440px', '140px']);
});

// --- the rows -----------------------------------------------------------------------

test('menuItem: a row in the one style: its word, a line under it, a check’s column for a checkbox', () => {
  const doc = fakeDoc();
  const a = menuItem(doc, { word: 'Settings', attrs: { id: 'set' } });
  assert.equal(a.tagName, 'BUTTON');
  assert.equal(a.getAttribute('type'), 'button');
  assert.equal(a.getAttribute('role'), 'menuitem');
  assert.equal(a.className, 'menu-item');
  assert.equal(a.querySelector('.menu-word').textContent, 'Settings');
  assert.equal(a.querySelector('.menu-sub'), null, 'no line unless it has one');
  const l = menuItem(doc, { word: 'Releases', sub: '', subClass: 'releases-version', href: '/r' });
  assert.equal(l.tagName, 'A');
  assert.equal(l.getAttribute('href'), '/r');
  assert.ok(l.querySelector('.menu-sub.releases-version'), 'a line for a module to fill, found by its class');
  const c = menuItem(doc, { word: 'Help mode', sub: 'tap a control', role: 'menuitemcheckbox', checked: false });
  assert.equal(c.getAttribute('aria-checked'), 'false');
  assert.deepEqual(c.children.map((x) => x.className), ['menu-check', 'menu-word', 'menu-sub']);
});

test('menuRows: dividers between the groups, a group’s name, and what destroys last, after its own divider', () => {
  const doc = fakeDoc();
  const row = (word, danger) => menuItem(doc, { word, danger });
  const rows = menuRows(doc, [
    [row('New tape'), row('Delete this tape…', true), row('Rename…')],
    { label: 'Share', rows: [row('Share the mix'), row('Bounce the loop')] },
  ]);
  const said = rows.map((r) => (r.className === 'menu-divider' ? '—' : r.className === 'menu-group' ? `[${r.textContent}]` : r.querySelector('.menu-word').textContent));
  assert.deepEqual(said, ['New tape', 'Rename…', '—', '[Share]', 'Share the mix', 'Bounce the loop', '—', 'Delete this tape…']);
  assert.ok(rows.at(-1).classList.contains('danger'), 'red: styles.css’s .menu > .danger');
  assert.equal(rows[2].getAttribute('role'), 'separator');
});
