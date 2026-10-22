import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { hubLine, revealOnOpen, deviceGroup, featuresGroup, groupOrder, RESTART_NOTE, changes, aboutLine } from './settings.js';
import { fakeDoc, parseHTML } from './play/fake-dom.js';

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

// The device switches are previews, and they used to sit in a folded group
// called "This device", last under MIDI and Tape: nobody found them. They are
// now their own section, always open, at the top of the sheet, each a real
// switch. A reload is one button for the section, not one per row, and it will
// not throw away a phone recording that is running.
function fakeDocument() {
  const kid = (s) => ({ tag: '#text', textContent: s, children: [], on: {}, attrs: {}, dataset: {} });
  const mk = (tag) => {
    const n = {
      tag, className: '', textContent: '', hidden: false, type: '', open: false, id: '', children: [], on: {}, attrs: {}, dataset: {},
      append(...kids) { for (const k of kids) this.children.push(typeof k === 'string' ? kid(k) : k); },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return this.attrs[k] ?? null; },
      addEventListener(type, fn) { this.on[type] = fn; },
      *walk() { for (const c of this.children) { yield c; if (c.walk) yield* c.walk(); } },
    };
    return n;
  };
  return { createElement: mk };
}
const text = (n) => [n, ...n.walk()].map((x) => (x.children.length ? '' : x.textContent)).join(' ');

function features(over = {}) {
  let reloads = 0;
  const saved = globalThis.document;
  globalThis.document = fakeDocument();
  const store = over.store || { play: false, quiet: false };
  const session = over.session || { start: { ...store }, pending: new Set() };
  delete over.store; delete over.session;
  const prefs = [
    { id: 'play', feature: true, label: 'Play mode', note: 'The instrument strip.', reload: true },
    { id: 'quiet', feature: true, label: 'Quiet', note: 'Takes effect now.', reload: false },
  ];
  const g = featuresGroup({
    prefs,
    read: () => ({ ...store }),
    write: (id, v) => { store[id] = v; return { ok: true, reload: id === 'play' }; },
    reload: () => { reloads++; },
    busy: () => false,
    session,
    ...over,
  });
  globalThis.document = saved;
  const all = () => [...g.walk()];
  const switches = () => all().filter((n) => n.attrs.role === 'switch');
  const reloadBtn = () => all().find((n) => n.tag === 'button' && n.className.includes('set-reload'));
  const bar = () => all().find((n) => n.className === 'set-reload-bar');
  const flip = (i) => switches()[i].on.click();
  return { g, store, session, switches, reloadBtn, bar, flip, reloads: () => reloads, all };
}

test('each feature is a real switch, off or on in its aria-checked', () => {
  const f = features({ read: () => ({ play: true, quiet: false }) });
  const sw = f.switches();
  assert.equal(sw.length, 2);
  assert.deepEqual(sw.map((s) => s.tag), ['button', 'button']);
  assert.deepEqual(sw.map((s) => s.attrs['aria-checked']), ['true', 'false']);
  assert.ok(sw.every((s) => s.attrs['aria-labelledby']), 'named by its label');
  assert.ok(sw.every((s) => s.attrs['aria-describedby']), 'described by its note');
});

test('the switch shows On or Off in words, not by colour alone', () => {
  const f = features({ read: () => ({ play: true, quiet: false }) });
  assert.match(text(f.switches()[0]), /\bOn\b/);
  assert.match(text(f.switches()[1]), /\bOff\b/);
  f.flip(1);
  assert.match(text(f.switches()[1]), /\bOn\b/);
  assert.equal(f.switches()[1].attrs['aria-checked'], 'true');
});

test('each feature says it is for this device only, the Pi and the other kits untouched', () => {
  const f = features();
  assert.match(text(f.g), /this device only/i);
  assert.match(text(f.g), /other kits/i);
});

test('the section is open markup, not a folded details', () => {
  const f = features();
  assert.notEqual(f.g.tag, 'details');
  assert.ok(!f.all().some((n) => n.tag === 'details' || n.tag === 'summary'), 'nothing inside folds');
  assert.match(text(f.g), /Preview features/);
});

test('a switch saves as it is clicked, with no Save', () => {
  const f = features();
  f.flip(0);
  assert.equal(f.store.play, true);
  f.flip(0);
  assert.equal(f.store.play, false);
});

test('one that needs a reload offers a single Reload, and its button reloads this page', () => {
  const f = features();
  assert.equal(f.bar().hidden, true, 'nothing to apply yet');
  f.flip(0);
  assert.equal(f.bar().hidden, false);
  assert.match(f.reloadBtn().textContent, /^Reload to apply$/);
  assert.equal(f.all().filter((n) => n.tag === 'button' && n.className.includes('set-reload')).length, 1);
  f.reloadBtn().on.click();
  assert.equal(f.reloads(), 1);
});

test('the Reload says it is this page alone, apart from the Pi’s Restart', () => {
  const f = features();
  f.flip(0);
  assert.match(text(f.g), /Hindsight keeps running/);
  assert.ok(!/^Restart$/.test(f.reloadBtn().textContent));
});

test('flipping it back before reloading leaves nothing to apply', () => {
  const f = features();
  f.flip(0);
  f.flip(0);
  assert.equal(f.bar().hidden, true);
});

test('a switch that takes effect at once offers no reload', () => {
  const f = features();
  f.flip(1);
  assert.equal(f.bar().hidden, true);
});

test('a phone recording that is running is not thrown away by the reload', () => {
  const f = features({ busy: () => true });
  f.flip(0);
  f.reloadBtn().on.click();
  assert.equal(f.reloads(), 0, 'did not reload');
  assert.match(text(f.g), /phone recording/i);
});

test('storage that refuses puts the switch back and says so', () => {
  const f = features({ write: () => ({ ok: false, reload: false }) });
  f.flip(0);
  assert.equal(f.switches()[0].attrs['aria-checked'], 'false');
  assert.match(text(f.g), /could not be saved on this device/);
  assert.equal(f.bar().hidden, true);
});

test('device prefs that are not features stay in a folded This device group; features are not in it', () => {
  const saved = globalThis.document;
  globalThis.document = fakeDocument();
  const prefs = [
    { id: 'play', feature: true, label: 'Play mode', note: 'n', reload: true },
    { id: 'tz', label: 'Clock', note: 'n', reload: false },
  ];
  const d = deviceGroup({ prefs, read: () => ({}), write: () => ({ ok: true, reload: false }), reload() {}, busy: () => false });
  const none = deviceGroup({ prefs: [prefs[0]], read: () => ({}), write() {}, reload() {}, busy: () => false });
  globalThis.document = saved;
  const labels = [...d.walk()].map((n) => n.textContent);
  assert.ok(labels.includes('Clock'));
  assert.ok(!labels.includes('Play mode'), 'a feature is not under the fold');
  assert.equal(none, null, 'no group at all when nothing is left for it');
});

test('the Pi’s groups keep a fixed order, most used first, unknown ones last', () => {
  assert.deepEqual(groupOrder(['Tape', 'MIDI', 'Saving', 'Buffer', 'Input']), ['Input', 'Buffer', 'Saving', 'MIDI', 'Tape']);
  assert.deepEqual(groupOrder(['Zzz', 'Input']), ['Input', 'Zzz']);
});

test('one statement says the Pi’s settings apply on restart, and that a restart empties the feed', () => {
  assert.match(RESTART_NOTE, /restart/i);
  assert.match(RESTART_NOTE, /empt/i);
});

test('the recorder is what says a phone recording is running, under the name the sheet reads', () => {
  const rec = readFileSync(new URL('./phone/recorder.js', import.meta.url), 'utf8');
  const sheet = readFileSync(new URL('./settings.js', import.meta.url), 'utf8');
  assert.match(rec, /dataset\.phoneBusy = mode === 'recording' \|\| mode === 'saving'/);
  assert.match(sheet, /dataset\.phoneBusy === '1'/);
});

// The sheet is redrawn on every open and every Save. What is owed is measured
// from what the page LOADED with, not from what the sheet last saw.
const again = (f, over = {}) => features({ store: f.store, session: f.session, ...over });
const statusOf = (f, i) => f.all().filter((n) => n.attrs.role === 'status' && n.className.includes('set-pref-status'))[i];

test('A: flip, close, reopen: the Reload is still owed', () => {
  const f = features();
  f.flip(0);
  const g = again(f);
  assert.equal(g.bar().hidden, false, 'the page is still in the old mode');
  assert.equal(g.switches()[0].attrs['aria-checked'], 'true');
  assert.match(statusOf(g, 0).textContent, /Will be on after a reload/);
  assert.match(text(g.bar()), /Reload this page/);
});

test('B: a Save elsewhere in the sheet redraws it without forgetting a flipped switch', () => {
  const f = features();
  f.flip(0);
  const g = again(f); // what draw() does after put()
  const h = again(g);
  assert.equal(h.bar().hidden, false);
});

test('C: flip on, reopen, flip back to what the page loaded with: nothing is owed', () => {
  const f = features();
  f.flip(0);
  const g = again(f);
  g.flip(0);
  assert.equal(g.store.play, false);
  assert.equal(g.bar().hidden, true);
  assert.equal(statusOf(g, 0).hidden, true);
  assert.equal(statusOf(g, 0).textContent, '');
});

test('flipping back clears the row’s own line, not only the bar', () => {
  const f = features();
  f.flip(0);
  assert.match(statusOf(f, 0).textContent, /after a reload/);
  f.flip(0);
  assert.equal(statusOf(f, 0).textContent, '');
});

test('the bar’s words are put back after a refused reload, on the next flip', () => {
  const f = features({ busy: () => true });
  f.flip(0);
  f.reloadBtn().on.click();
  assert.match(text(f.bar()), /phone recording/);
  f.flip(1); // an unrelated switch
  f.flip(1);
  assert.doesNotMatch(text(f.bar()), /phone recording/);
  assert.match(text(f.bar()), /Reload this page to apply/);
});

test('the bar is un-hidden before its words are set, so a screen reader announces them', () => {
  const f = features();
  const bar = f.bar();
  const order = [];
  let hidden = bar.hidden;
  Object.defineProperty(bar, 'hidden', { get: () => hidden, set: (v) => { hidden = v; order.push('hidden=' + v); } });
  const t = f.all().find((n) => n.className === 'set-reload-text');
  let tc = t.textContent;
  Object.defineProperty(t, 'textContent', { get: () => tc, set: (v) => { tc = v; order.push('text'); } });
  f.flip(0);
  assert.deepEqual(order.slice(0, 2), ['hidden=false', 'text']);
});

// Every row of the registry is drawn, "Plays the tape" (the strip's
// controller) included, and the saved body is what changed.
const REG = [
  { key: 'MIDI_IGNORE', group: 'MIDI', value: '' },
  { key: 'TAPE_CONTROLLER', group: 'MIDI', value: 'SMK' },
  { key: 'TAPE', group: 'Tape', value: 'true' },
];

test('the saved body is every field that changed, and nothing else', () => {
  assert.deepEqual(changes(REG, { MIDI_IGNORE: 'x', TAPE: 'false' }), { MIDI_IGNORE: 'x', TAPE: 'false' });
  assert.deepEqual(changes(REG, { MIDI_IGNORE: '', TAPE_CONTROLLER: ' SMK ' }), {});
});

// On a phone the header has room for Settings alone (styles.css hides its
// Releases and Guide there), so the Settings sheet carries them: the about
// line under its title. Every page's sheet: the Studio's template, and the
// one settings.js makes elsewhere.
test('the Settings sheet carries Releases and the guide, under its title, on every page', () => {
  const sheets = [
    ['shell.html', (html) => /<template id="studio-sheets-tpl">([\s\S]*?)<\/template>/.exec(html)[1]],
  ];
  for (const [page, part] of sheets) {
    const doc = fakeDoc();
    doc.body.append(...parseHTML(doc, part(readFileSync(new URL(`../${page}`, import.meta.url), 'utf8'))).children);
    const sheet = doc.getElementById('settings-sheet');
    assert.ok(sheet, `${page} has a Settings sheet`);
    const line = aboutLine(sheet, doc);
    const inner = sheet.querySelector('.settings-inner');
    assert.equal(inner.children[0].tagName, 'H3', `${page}: the sheet opens with its title`);
    assert.equal(inner.children[1], line, `${page}: the line is straight under the title`);
    assert.equal(line.querySelector('.settings-guide').getAttribute('href'), '/guide.html');
    assert.equal(line.querySelector('.settings-releases').tagName, 'BUTTON');
    // A phone's rooms have no room for the rig's chip in their header (the
    // header's tools): the line is its way to the rig too.
    assert.equal(line.querySelector('.settings-rig').getAttribute('href'), '/rig.html');
    assert.equal(aboutLine(sheet, doc), line, 'once, however often it is asked');
    assert.equal(sheet.querySelectorAll('.settings-about').length, 1);
  }
  const made = readFileSync(new URL('./settings.js', import.meta.url), 'utf8');
  assert.match(made, /const about = aboutLine\(sheet\);/, 'initSettings puts the line in whichever sheet it wires');
});

test('Releases in the Settings sheet closes it and asks for the Releases sheet', () => {
  const doc = fakeDoc();
  doc.body.append(...parseHTML(doc, '<dialog id="settings-sheet"><div class="sheet-inner settings-inner"><h3>Settings</h3><div class="settings-body"></div></div></dialog>').children);
  const sheet = doc.getElementById('settings-sheet');
  let closed = 0;
  sheet.close = () => { closed++; };
  const asked = [];
  doc.addEventListener('hindsight:releases', (e) => asked.push(e.type));
  aboutLine(sheet, doc).querySelector('.settings-releases').dispatchEvent({ type: 'click' });
  assert.equal(closed, 1);
  assert.deepEqual(asked, ['hindsight:releases']);
  const update = readFileSync(new URL('./update.js', import.meta.url), 'utf8');
  assert.match(update, /export const RELEASES_EVENT = 'hindsight:releases';/);
  assert.equal((update.match(/document\.addEventListener\(RELEASES_EVENT, /g) || []).length, 2, 'update.js opens its sheet on it, with an updater and without');
});
