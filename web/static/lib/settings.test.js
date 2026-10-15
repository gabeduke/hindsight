import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hubLine, revealOnOpen, deviceGroup } from './settings.js';

const url = 'https://mike.hindsight.leetserve.com';

test('no hub, no line', () => {
  assert.equal(hubLine(null), null);
  assert.equal(hubLine(undefined), null);
});

test('the secure address is linked once there is a certificate', () => {
  assert.deepEqual(hubLine({ name: 'mike.hindsight.leetserve.com', url, error: '', cert_not_after: '2027-01-07T00:00:00Z' }), { href: url, error: '' });
  // A failing heartbeat doesn't take the link away; the certificate still serves.
  assert.deepEqual(hubLine({ url, error: 'heartbeat: 502 Bad Gateway', cert_not_after: '2027-01-07T00:00:00Z' }), { href: url, error: 'heartbeat: 502 Bad Gateway' });
});

test('without a certificate, why not', () => {
  assert.deepEqual(hubLine({ url, error: 'the hub is still getting a certificate for mike.hindsight.leetserve.com', cert_not_after: null }),
    { href: '', error: 'the hub is still getting a certificate for mike.hindsight.leetserve.com' });
  assert.deepEqual(hubLine({ name: '', url: '', error: '', cert_not_after: null }), { href: '', error: 'waiting for the hub' });
});

// A fake <details>: what revealOnOpen listens to, and where it scrolls.
function fakeDetails() {
  const d = { open: false, scrolled: [], on: {} };
  d.addEventListener = (type, fn) => { d.on[type] = fn; };
  d.scrollIntoView = (opts) => d.scrolled.push(opts);
  return d;
}

// What a browser does when a person taps a summary: a click on it, then the
// group's toggle. A group opened by the code that builds the sheet gets the
// toggle alone.
const tapSummary = (d) => d.on.click({ target: { closest: (sel) => (sel === 'summary' ? {} : null) } });

test('opening a settings group by hand scrolls it into view, so its rows are not left under the fold', () => {
  const d = revealOnOpen(fakeDetails());
  tapSummary(d);
  d.open = true;
  d.on.toggle();
  assert.deepEqual(d.scrolled, [{ block: 'nearest' }]);
});

test('a group that starts open does not scroll the sheet when it is built', () => {
  // The sheet opened scrolled partway down: every group that starts open fired
  // a toggle, and the last one scrolled the body to itself.
  const d = revealOnOpen(fakeDetails());
  d.open = true;
  d.on.toggle();
  assert.deepEqual(d.scrolled, []);
  // ...and that ignored toggle does not leave the next one armed.
  d.open = false;
  d.on.toggle();
  d.open = true;
  d.on.toggle();
  assert.deepEqual(d.scrolled, []);
});

test('a tap that is not on the summary does not arm the reveal', () => {
  const d = revealOnOpen(fakeDetails());
  d.on.click({ target: { closest: () => null } });
  d.open = true;
  d.on.toggle();
  assert.deepEqual(d.scrolled, []);
});

test('closing a group leaves the scroll where it is', () => {
  const d = revealOnOpen(fakeDetails());
  tapSummary(d);
  d.on.toggle();
  assert.deepEqual(d.scrolled, []);
});

// A device switch that needs the page reloaded ended in a sentence -- "Reload
// the page for this to take effect." -- with no button, and an installed
// phone app has no reload of its own. The sheet's other pending thing is the
// Pi's Restart, which empties the ring: the Reload is this page's alone, and
// says so.
function fakeDocument() {
  const mk = (tag) => {
    const n = {
      tag, className: '', textContent: '', hidden: false, type: '', checked: false, open: false, children: [], on: {},
      append(...kids) { for (const k of kids) this.children.push(typeof k === 'string' ? { tag: '#text', textContent: k, children: [], on: {} } : k); },
      addEventListener(type, fn) { this.on[type] = fn; },
      *walk() { for (const c of this.children) { yield c; if (c.walk) yield* c.walk(); } },
    };
    return n;
  };
  return { createElement: mk };
}
const find = (root, pred) => [...root.walk()].find(pred);

function group(over = {}) {
  let reloads = 0;
  const saved = globalThis.document;
  globalThis.document = fakeDocument();
  const prefs = [
    { id: 'play', label: 'Play mode', note: 'Preview: the instrument.', reload: true },
    { id: 'quiet', label: 'Quiet', note: 'Takes effect now.', reload: false },
  ];
  const d = deviceGroup({
    prefs,
    read: () => ({ play: false, quiet: false }),
    write: (id) => ({ ok: true, reload: id === 'play' }),
    reload: () => { reloads++; },
    ...over,
  });
  globalThis.document = saved;
  const box = (id) => [...d.walk()].filter((n) => n.tag === 'input')[id];
  const buttons = () => [...d.walk()].filter((n) => n.tag === 'button');
  return { d, box, reloads: () => reloads, buttons, button: () => buttons()[0] };
}

test('a switch that needs a reload offers one, and the button reloads this page', () => {
  const g = group();
  assert.ok(g.button(), 'the group has a Reload button');
  assert.equal(g.button().hidden, true, 'hidden until a switch needs it');
  g.box(0).checked = true;
  g.box(0).on.change();
  assert.equal(g.button().hidden, false);
  assert.match(g.button().textContent, /^Reload this page$/);
  g.button().on.click();
  assert.equal(g.reloads(), 1);
});

test('the Reload says it is this page only, apart from the Pi’s Restart', () => {
  const g = group();
  g.box(0).checked = true;
  g.box(0).on.change();
  const said = [...g.d.walk()].map((n) => n.textContent).join(' ');
  assert.match(said, /this page/i);
  assert.match(said, /Hindsight keeps running/);
  assert.ok(!/^Restart$/.test(g.button().textContent), 'its label is not the Pi’s Restart');
});

test('a switch that takes effect at once offers no reload', () => {
  const g = group();
  g.box(1).checked = true;
  g.box(1).on.change();
  assert.deepEqual(g.buttons().map((b) => b.hidden), [true, true]);
  g.box(0).checked = true;
  g.box(0).on.change();
  assert.deepEqual(g.buttons().map((b) => b.hidden), [false, true], 'only the row that needs it');
});
