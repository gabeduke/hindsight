// web/static/lib/ui/keys.test.js
// A key goes down the moment a finger is on it, a quick tap still shows it
// down, and nothing about it holds up or swallows the tap (lib/ui/keys.js);
// the stylesheet draws that pose for every key, at once (styles.css).
// The document, the window and the clock are stand-ins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KEYS, DOWN_MS, showPresses } from './keys.js';
import { decls, fileCss, rules } from '../stylesheets.js';

function clock() {
  let now = 0, id = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimer: (fn, ms) => { timers.set(++id, { fn, at: now + ms }); return id; },
    clearTimer: (i) => timers.delete(i),
    advance(ms) {
      now += ms;
      for (const [i, t] of [...timers]) if (t.at <= now) { timers.delete(i); t.fn(); }
    },
    pending: () => timers.size,
  };
}

/** target is an event target that keeps its listeners and their options, and dispatches in registration order. */
function target() {
  const heard = [];
  return {
    heard,
    addEventListener: (type, fn, opts) => heard.push({ type, fn, opts }),
    removeEventListener: (type, fn) => {
      const i = heard.findIndex((h) => h.type === type && h.fn === fn);
      if (i >= 0) heard.splice(i, 1);
    },
    fire(type, e) { for (const h of heard.filter((x) => x.type === type)) h.fn({ type, ...e }); },
  };
}

/** key is an element that is a key (closest finds itself), or a child of one. */
function key({ disabled = false, ariaDisabled = null } = {}) {
  const classes = new Set();
  const k = {
    disabled,
    classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) },
    getAttribute: (a) => (a === 'aria-disabled' ? ariaDisabled : null),
    closest: (sel) => (sel === KEYS ? k : null),
  };
  return k;
}
const inside = (k) => ({ closest: (sel) => k.closest(sel) });
const notAKey = { closest: () => null };

// An event that would fail the test if anything tried to stop or prevent it.
const strict = (e) => ({
  ...e,
  preventDefault() { throw new Error('a press must never be prevented'); },
  stopPropagation() { throw new Error('a press must never be stopped'); },
  stopImmediatePropagation() { throw new Error('a press must never be stopped'); },
});

function rig() {
  const doc = target(), win = target(), c = clock();
  const off = showPresses(doc, { win, now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer });
  const down = (el, id = 1, extra = {}) => doc.fire('pointerdown', strict({ target: el, pointerId: id, button: 0, ...extra }));
  const up = (id = 1) => win.fire('pointerup', strict({ pointerId: id }));
  const cancel = (id = 1) => win.fire('pointercancel', strict({ pointerId: id }));
  return { doc, win, c, off, down, up, cancel };
}

test('a key is down the moment the finger is on it, not a frame later', () => {
  const { down } = rig();
  const k = key();
  down(k);
  assert.ok(k.classList.contains('down'));
});

test('a quick tap still shows the key down for DOWN_MS, then lets it up', () => {
  assert.equal(DOWN_MS, 80);
  const { down, up, c } = rig();
  const k = key();
  down(k);
  c.advance(30);
  up();
  assert.ok(k.classList.contains('down'), 'still down after a 30 ms tap');
  c.advance(49);
  assert.ok(k.classList.contains('down'), 'at 79 ms');
  c.advance(1);
  assert.ok(!k.classList.contains('down'), 'up at 80 ms');
});

test('a press longer than DOWN_MS comes up the moment it is let go', () => {
  const { down, up, c } = rig();
  const k = key();
  down(k);
  c.advance(400);
  assert.ok(k.classList.contains('down'));
  up();
  assert.ok(!k.classList.contains('down'));
  assert.equal(c.pending(), 0);
});

test('a press that turns into a scroll comes up at once: a scroll is not a press', () => {
  const { down, cancel, c } = rig();
  const k = key();
  down(k);
  c.advance(10);
  cancel();
  assert.ok(!k.classList.contains('down'));
});

test('a second tap while the first is still shown keeps the key down, and is held its own DOWN_MS', () => {
  const { down, up, c } = rig();
  const k = key();
  down(k);
  c.advance(20);
  up();
  c.advance(40); // 60 ms in: the first tap's hold has 20 to go
  down(k);
  c.advance(30); // the first tap's timer would have let it up here
  assert.ok(k.classList.contains('down'));
  up();
  c.advance(49);
  assert.ok(k.classList.contains('down'));
  c.advance(1);
  assert.ok(!k.classList.contains('down'));
});

test('two fingers on one key: it comes up with the last', () => {
  const { down, up, c } = rig();
  const k = key();
  down(k, 1);
  down(k, 2);
  c.advance(200);
  up(1);
  assert.ok(k.classList.contains('down'));
  up(2);
  assert.ok(!k.classList.contains('down'));
});

test('a press on what a key holds (its glyph, its LED) presses the key', () => {
  const { down } = rig();
  const k = key();
  down(inside(k));
  assert.ok(k.classList.contains('down'));
});

test('no key, a disabled key, or a right button: nothing goes down', () => {
  const { down } = rig();
  down(notAKey);
  const off = key({ disabled: true });
  down(off);
  assert.ok(!off.classList.contains('down'));
  const k = key();
  down(k, 1, { button: 2 });
  assert.ok(!k.classList.contains('down'));
});

test('a key that is only aria-disabled still goes down: Catch, waiting for its pass, answers a press with why', () => {
  const { down } = rig();
  const k = key({ ariaDisabled: 'true' });
  down(k);
  assert.ok(k.classList.contains('down'));
});

test('a press whose lift the window never heard is put right by the next', () => {
  const { down, win, c } = rig();
  const a = key(), b = key();
  down(a, 1);
  c.advance(500);
  down(b, 1); // the same pointer, down again: its last press is over
  assert.ok(!a.classList.contains('down'));
  assert.ok(b.classList.contains('down'));
  win.fire('blur', {});
  assert.ok(!b.classList.contains('down'), 'and losing the window lets every key up');
});

test('every listener is passive; the lift is heard first, on the window, so nothing a key does can leave it stuck down', () => {
  const { doc, win } = rig();
  const of = (t, type) => t.heard.filter((h) => h.type === type);
  for (const h of [...doc.heard, ...win.heard.filter((x) => x.type !== 'blur')]) assert.equal(h.opts?.passive, true, h.type);
  for (const type of ['pointerup', 'pointercancel']) assert.equal(of(win, type)[0].opts.capture, true, type);
  // The press is heard as it bubbles to the document: help mode's capture
  // listener (lib/help/help.js) stops a press in help mode before it, so a
  // tap there shows its tip and moves no key.
  assert.equal(of(doc, 'pointerdown').length, 1);
  assert.ok(!of(doc, 'pointerdown')[0].opts.capture);
  // iPad Safari applies :active only where something listens for touchstart.
  assert.equal(of(doc, 'touchstart').length, 1);
});

test('taking it off leaves no listener, no timer and no key down', () => {
  const { doc, win, c, off, down, up } = rig();
  const k = key();
  down(k);
  up();
  off();
  assert.equal(doc.heard.length, 0);
  assert.equal(win.heard.length, 0);
  assert.equal(c.pending(), 0);
  assert.ok(!k.classList.contains('down'));
});

// ---------- the pages wire it, once, after help ----------

test('each page with keys wires the press once, after help mode', () => {
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
  for (const [file, help] of [['shell/boot.js', 'initHelp('], ['wave/page.js', 'initHelp('], ['rig/page.js', 'help({']]) {
    const src = read(file);
    const calls = [...src.matchAll(/showPresses\(/g)].length;
    assert.equal(calls, 1, `${file} wires the press once`);
    assert.ok(src.indexOf(help) >= 0 && src.indexOf(help) < src.indexOf('showPresses('), `${file}: after help`);
  }
});

// ---------- the stylesheet draws the pose, at once ----------

const css = fileCss('styles.css');
const all = rules(css);
const twin = (sel) => sel.replace(/:active(?=[^:]*$)/, '.down');

test('every key’s :active rule draws .down too, in the same rule', () => {
  const missing = [];
  for (const r of all) {
    for (const sel of r.sel) {
      if (!/:active$/.test(sel)) continue;
      const base = sel.replace(/:active$/, '');
      // Only the keys this presses: a selector ending on one of KEYS (a
      // more particular key, .np-catch, included).
      if (!KEYS.split(', ').some((k) => base.endsWith(k) || base.split(/[\s>]+/).pop().startsWith(k))) continue;
      if (!r.sel.includes(twin(sel))) missing.push(`${r.line}: ${sel}`);
    }
  }
  assert.deepEqual(missing, [], 'these press with :active only: a touch never shows them down');
});

test('every key goes down with no transition: its pressed rule zeroes the time', () => {
  const instant = all.filter((r) => decls(r.body).some((d) => d.prop === 'transition-duration' && d.value === 'var(--t-press)'));
  const listed = new Set(instant.flatMap((r) => r.sel));
  for (const k of KEYS.split(', ')) {
    for (const sel of [`${k}:active`, `${k}.down`]) assert.ok(listed.has(sel), `${sel} goes down at once`);
  }
});

test('a key’s release is the snap spring over its own time', () => {
  const springs = all.filter((r) => decls(r.body).some((d) => d.prop === 'transition'
    && /(?:^|,\s*)(?:transform|translate) var\(--t-spring-snap\) var\(--spring-snap\)/.test(d.value)));
  const sprung = new Set(springs.flatMap((r) => r.sel));
  for (const sel of ['.icon-btn', '.chip', '.nudge', '.phone-btn', '.passes-row .pass', '.seg button', '.mark-btn',
    '.capture-btn', '.tape-pill', '.room-cassette', '.take.spine', '.cue-clip-chip']) {
    assert.ok(sprung.has(sel), `${sel} comes back up on the snap spring`);
  }
});

test('a key held down under the mouse is down: no hover rule of a key outranks its press', () => {
  const keys = KEYS.split(', ').filter((k) => k !== '.sinks'); // a spine sinks by its translate, whatever hover does
  const loose = [];
  for (const r of all) {
    for (const sel of r.sel) {
      if (!/:hover$/.test(sel)) continue;
      const last = sel.split(/[\s>]+/).pop();
      const of = keys.find((k) => { const tail = k.split(' ').pop(); return last.startsWith(tail) && (k === tail || sel.includes(k.split(' ')[0])); });
      if (!of) continue;
      if (!(sel.includes(':not(:active)') && sel.includes(':not(.down)'))) loose.push(`${r.line}: ${sel}`);
    }
  }
  assert.deepEqual(loose, [], 'these hover rules would hold a pressed key up');
});
