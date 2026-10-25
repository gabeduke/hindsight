// The bar's shape (css/bar.css, slots.js), read from the stylesheet and the
// pages' markup: nothing in node lays a page out (the flows measure it: J1.13
// fails when ▶ moves or the page scrolls sideways), so these pin what the
// layout rests on -- named zones in a fixed order, each key saying which
// sources it is for, positive variants, widths from the bar's own row, and
// a height nobody writes down.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { cssOf, decls, fileCss, linksOf, rules, stripComments } from '../stylesheets.js';
import { fakeDoc, parseHTML } from '../play/fake-dom.js';
import { SLOTS, SOURCES, slotOf, putIn, barSize, hereWord, measureBar } from './slots.js';

const bar = fileCss('css/bar.css');
const barRules = rules(bar);
const page = (name) => {
  const doc = fakeDoc();
  doc.body.append(...parseHTML(doc, readFileSync(new URL(`../../${name}`, import.meta.url), 'utf8')).nodes);
  return doc;
};
const shell = page('shell.html');
const wave = page('wave.html');
const FOR = new Set(['tape', 'studio', 'away', 'take', 'feed']);

test('every page with the bar takes its stylesheet, after the chrome', () => {
  for (const p of ['shell.html', 'wave.html']) assert.deepEqual(linksOf(p), ['/objects.css', '/styles.css', '/css/chrome.css', '/css/bar.css'], p);
  // And the pages without one don't.
  for (const p of ['rig.html', 'guide.html', 'objects.html']) assert.ok(!linksOf(p).includes('/css/bar.css'), p);
});

test('the bar is its zones, in the one order, on both pages that have it', () => {
  for (const [name, doc] of [['shell.html', shell], ['wave.html', wave]]) {
    const zones = doc.querySelector('#np .np-zones').children.map((z) => z.getAttribute('data-slot'));
    assert.deepEqual(zones, ['deck', 'transport', 'verb', 'modes', 'end'], name);
    assert.equal(doc.querySelector('#np .np-row-2').getAttribute('data-slot'), 'strip', name);
  }
  assert.deepEqual([...SLOTS], ['deck', 'transport', 'verb', 'modes', 'end', 'strip']);
});

test('|◀ ▶ then ●, Record beside Play; ↺ 5 s in ●’s place; Catch the verb; ⟲ then the metronome; ⏏ Open › ✎ at the end', () => {
  const ids = (slot) => slotOf(shell, slot).children.map((e) => e.id || e.className.split(' ')[1]);
  assert.deepEqual(ids('transport'), ['np-start', 'np-play', 'rec', 'np-back5']);
  assert.deepEqual(ids('verb'), ['np-catch-split', 'np-feed-grab']);
  assert.deepEqual(ids('modes'), ['np-loop', 'click']);
  assert.deepEqual(ids('end'), ['np-eject', 'np-open', 'np-note']);
  // On Open, the same transport: ▶ second, where it is in the rooms.
  assert.deepEqual(slotOf(wave, 'transport').children.map((e) => e.id), ['to-start', 'play', 'back5']);
  // ● and the metronome are pictures, not typed.
  assert.ok(shell.getElementById('rec').querySelector('svg.i-rec'));
  assert.ok(shell.getElementById('click').querySelector('svg.i-metro'));
});

test('each key says which sources it shows for, in the full bar and the mini player, by names the stylesheet knows', () => {
  for (const [name, doc] of [['shell.html', shell], ['wave.html', wave]]) {
    for (const slot of ['transport', 'verb', 'modes', 'end', 'strip']) {
      for (const key of slotOf(doc, slot).children) {
        const f = key.getAttribute('data-for');
        assert.ok(f, `${name}: #${key.id || key.className} in ${slot} says nothing of where it shows`);
        for (const w of [...f.split(' '), ...(key.getAttribute('data-mini') || '').split(' ').filter(Boolean)]) {
          assert.ok(FOR.has(w), `${name}: #${key.id} is for "${w}"`);
        }
      }
    }
  }
  // The mini player keeps |◀ ▶ for each, Catch and its ▾ in the Studio, ✎
  // and Open › for a take, and GRAB for the feed.
  const mini = (id) => shell.getElementById(id).getAttribute('data-mini') || '';
  assert.equal(mini('np-start'), 'tape take feed');
  assert.equal(mini('np-play'), 'tape take feed');
  assert.equal(shell.querySelector('.np-catch-split').getAttribute('data-mini'), 'studio');
  assert.equal(mini('np-open'), 'take');
  assert.equal(mini('np-note'), 'take');
  assert.equal(mini('np-feed-grab'), 'feed');
});

test('what shows is said positively: one rule shows each source’s keys, with no :not() list and no !important anywhere in the bar', () => {
  const bare = stripComments(bar);
  assert.doesNotMatch(bare, /!\s*important/, 'the bar wins by its selectors, not by !important');
  // (Bar a page's "while the bar shows": :not([hidden]), which says no key.)
  for (const r of barRules) for (const s of r.sel) assert.doesNotMatch(s.replaceAll(':not([hidden])', ''), /:not\(/, `${r.line}: ${s}`);
  const show = barRules.find((r) => decls(r.body).some((d) => d.prop === 'display' && d.value === 'inline-flex')
    && r.sel.some((s) => s.includes('[data-for~="take"]')));
  assert.ok(show, 'a rule shows the keys for what the bar holds');
  for (const src of SOURCES) {
    assert.ok(show.sel.some((s) => s.includes(`[data-size="full"][data-source="${src}"] [data-for~="${src}"]`)), `full, ${src}`);
    assert.ok(show.sel.some((s) => s.includes(`[data-size="mini"][data-source="${src}"] [data-mini~="${src}"]`)), `mini, ${src}`);
  }
  assert.ok(show.sel.some((s) => s.startsWith('body.tape-page') && s.includes('[data-for~="studio"]')), 'the Studio’s keys, in the Studio');
  // A key a script has hidden (⏏ with no tape) stays hidden: #np outranks them all.
  assert.ok(barRules.some((r) => r.sel.includes('#np [hidden]') && /display:\s*none/.test(r.body)));
});

test('the phone’s mini player lists its zones for each source, and its tail is one width, so ▶ stands still', () => {
  const at = (sel) => barRules.find((r) => r.sel.includes(sel) && r.media.includes('max-width: 699.98px'));
  for (const [src, tail] of [['tape', 'verb'], ['take', 'end'], ['feed', 'verb']]) {
    const r = at(`.np[data-size="mini"][data-source="${src}"] .np-zones`);
    assert.ok(r, src);
    assert.match(r.body, new RegExp(`grid-template-areas:\\s*"deck transport ${tail}"`), src);
  }
  const cols = at('.np[data-size="mini"] .np-zones');
  assert.match(cols.body, /grid-template-columns:\s*minmax\(0, 1fr\) auto \d+px/, 'the deck takes what the transport and a fixed tail leave');
});

test('wider, the deck’s width hangs on the bar’s row alone, so ▶ stands at one x whatever the bar holds', () => {
  const tiers = barRules.filter((r) => r.at.some((a) => a.startsWith('@container bar')) && r.sel.includes('.np-zones'));
  assert.ok(tiers.length >= 2, 'a tablet’s tier and a wider one');
  for (const r of tiers) {
    const d = Object.fromEntries(decls(r.body).map((x) => [x.prop, x.value]));
    if (d['grid-template-columns']) assert.match(d['grid-template-columns'], /^var\(--deck-w\) auto /, r.at.join(' '));
    // Its width: the row's (cqi) and numbers, never a share of what's left.
    assert.match(d['--deck-w'], /^clamp\(\d+px, calc\(100cqi - \d+px\), \d+px\)$/, r.at.join(' '));
  }
  // The container is the first row: not the bar, nor the dock, whose fixed
  // descendants (the phone's player, the menus) a container would hold.
  const holders = rules(cssOf()).filter((r) => decls(r.body).some((d) => d.prop === 'container' || d.prop === 'container-type'));
  assert.deepEqual(holders.flatMap((r) => r.sel).filter((s) => /\.np\b|#np|np-dock/.test(s)), ['.np-row-1']);
});

test('the bar’s height is measured, never written: no stylesheet sets --np-h', () => {
  const set = rules(cssOf()).flatMap((r) => decls(r.body).filter((d) => d.prop === '--np-h').map(() => `${r.line}: ${r.sel.join(', ')}`));
  assert.deepEqual(set, []);
  // Every read of it has its fallback, for the frame before it is measured.
  for (const m of stripComments(cssOf()).matchAll(/var\(--np-h([^)]*)\)/g)) assert.equal(m[1], ', 0px');
});

test('measureBar writes the bar’s height to the root as it changes, once per change', () => {
  const writes = [];
  const root = { style: { setProperty: (k, v) => writes.push(`${k}=${v}`) } };
  let cb = null;
  class RO { constructor(f) { cb = f; } observe() {} disconnect() {} }
  const np = { ownerDocument: { documentElement: root } };
  measureBar(np, { RO });
  cb([{ borderBoxSize: [{ blockSize: 125.4 }] }]);
  cb([{ borderBoxSize: [{ blockSize: 125 }] }]);
  cb([{ borderBoxSize: [{ blockSize: 53 }] }]);
  cb([{ borderBoxSize: [{ blockSize: 0 }] }]);
  assert.deepEqual(writes, ['--np-h=125px', '--np-h=53px', '--np-h=0px']);
});

test('a script puts into a slot by its name, and a name the bar hasn’t got throws', () => {
  const doc = page('shell.html');
  const mark = doc.createElement('span');
  putIn(doc, 'strip', mark);
  assert.equal(slotOf(doc, 'strip').children.at(-1), mark);
  const first = doc.createElement('i');
  putIn(doc, 'end', first, { first: true });
  assert.equal(slotOf(doc, 'end').children[0], first);
  assert.throws(() => slotOf(doc, 'own'), /no slot "own"/);
});

test('the size is the mini player only on a phone with the player down; the display says where a take plays by the device', () => {
  assert.equal(barSize({ phone: true, open: false }), 'mini');
  assert.equal(barSize({ phone: true, open: true }), 'full');
  assert.equal(barSize({ phone: false, open: false }), 'full');
  assert.equal(hereWord({ phone: true }), 'THIS PHONE');
  assert.equal(hereWord({ coarse: true }), 'THIS TABLET');
  assert.equal(hereWord({}), 'THIS COMPUTER');
});
