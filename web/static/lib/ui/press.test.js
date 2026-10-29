// web/static/lib/ui/press.test.js
// One press for every key that taps, double taps and holds (lib/ui/press.js).
// Its cases were two machines' -- a spine's in the Listening Room (a tap
// plays, a hold selects: lib/room/press.js) and a track's ● in the Studio (a
// tap arms it, a hold arms it as well: lib/rig/armpress.js) -- and each runs
// once per key, with the options that key is bound with: SPINE_PRESS and
// ARM_PRESS, which its caller spreads and sets nothing over (the last test
// here reads both callers to see). So neither key's feel can move without a
// test seeing. The clock and the pointer are stand-ins, so no finger is needed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GESTURE, SPINE_PRESS, ARM_PRESS, pressMachine, bindPress } from './press.js';

// The keys that hold today, with their callers' options: a spine
// (lib/room/doorway.js) and a track's ● (lib/tape/page.js), which never had a
// slop -- a finger that wanders on it still holds; a scroll cancels it.
const KINDS = [
  { name: 'a spine', ...SPINE_PRESS },
  { name: 'a ● key', ...ARM_PRESS },
];
// A kind's options, as its caller binds them.
const optsOf = ({ name, ...press }) => press;

// A clock the test turns by hand.
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

function rig(kind, opts = {}) {
  const c = clock();
  const log = [];
  const m = pressMachine({
    ...optsOf(kind),
    onTap: () => log.push('tap'),
    onHold: () => log.push('hold'),
    onDouble: opts.double ? () => log.push('double') : null,
    selecting: () => !!opts.selecting,
    now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer,
  });
  return { m, c, log };
}
const touch = (x = 10, y = 10) => ({ pointerType: 'touch', button: 0, clientX: x, clientY: y });
const pen = () => ({ pointerType: 'pen', button: 0, clientX: 10, clientY: 10 });
const mouse = (extra = {}) => ({ pointerType: 'mouse', button: 0, clientX: 10, clientY: 10, ...extra });
const click = (extra = {}) => ({ detail: 1, shiftKey: false, preventDefault() { this.prevented = true; }, ...extra });
// A finger's whole tap: down, lift, its click, where it landed.
const tapAt = (m, x = 10, y = 10) => { m.down(touch(x, y)); m.up(); m.click(click({ clientX: x, clientY: y })); };

test('the table is the values the app used before it was one table', () => {
  assert.deepEqual(GESTURE, {
    HOLD: { select: 500, tape: 300, wave: 350, ribbon: 350, lift: 350, repeat: 500 },
    REPEAT_MS: 120,
    TAP_MS: 300,
    SLOP_PX: 8,
    SLOP_FINE_PX: 6,
    DOUBLE_MS: 300,
    DOUBLE_PX: 20,
    DOUBLE_WIDE_PX: 24,
    GRACE_MS: 600,
    LIFT_GRACE_MS: 400,
    OUTRANK_MS: 400,
  });
  assert.ok(Object.isFrozen(GESTURE) && Object.isFrozen(GESTURE.HOLD), 'nothing changes them at run time');
});

test('a hold needs its time: a machine that holds with none is a mistake, said at once', () => {
  assert.throws(() => pressMachine({ onTap() {}, onHold() {} }), TypeError);
  assert.doesNotThrow(() => pressMachine({ onTap() {} }), 'a key that only taps needs none');
});

for (const k of KINDS) {
  test(`${k.name}: the hold is its own, to the millisecond`, () => {
    const { m, c, log } = rig(k);
    m.down(touch());
    c.advance(k.hold - 1);
    assert.deepEqual(log, [], 'not yet');
    c.advance(1);
    assert.deepEqual(log, ['hold']);
  });

  test(`${k.name}: a quick press and its click is a tap, once, and nothing holds later`, () => {
    const { m, c, log } = rig(k);
    m.down(touch());
    c.advance(k.hold - 50);
    m.up();
    m.click(click());
    assert.equal(c.pending(), 0, 'no timer left to hold it later');
    c.advance(k.hold * 3);
    assert.deepEqual(log, ['tap']);
  });

  test(`${k.name}: a quick tap whose lift never clicks holds nothing later`, () => {
    const { m, c, log } = rig(k);
    m.down(touch());
    c.advance(k.hold - 50);
    m.up(); // the phone sent no click
    assert.equal(c.pending(), 0, 'the lift ends the wait for a hold');
    c.advance(k.hold * 3);
    assert.deepEqual(log, []);
  });

  test(`${k.name}: a hold fires while the finger is down, and the click that ends it does not also tap`, () => {
    const { m, c, log } = rig(k);
    m.down(touch());
    c.advance(k.hold);
    assert.deepEqual(log, ['hold'], 'it fires at the hold, not at lift-off');
    m.up();
    const e = click();
    m.click(e);
    assert.deepEqual(log, ['hold']);
    assert.ok(e.prevented, 'the lift’s click is swallowed');
    // The next press is a fresh one.
    m.down(touch());
    m.up();
    m.click(click());
    assert.deepEqual(log, ['hold', 'tap']);
  });

  test(`${k.name}: a pen holds like a finger`, () => {
    const { m, c, log } = rig(k);
    m.down(pen());
    c.advance(k.hold);
    assert.deepEqual(log, ['hold']);
  });

  test(`${k.name}: a mouse’s press never holds -- it would catch a slow click -- and is just a tap`, () => {
    const { m, c, log } = rig(k);
    m.down(mouse());
    assert.equal(c.pending(), 0, 'no hold timer runs for a mouse');
    c.advance(k.hold * 4);
    assert.deepEqual(log, [], 'nothing fires while the button is down');
    m.up();
    m.click(click());
    assert.deepEqual(log, ['tap']);
  });

  test(`${k.name}: a mouse holds only where its caller lets it`, () => {
    const c = clock();
    const log = [];
    const m = pressMachine({
      onTap: () => log.push('tap'), onHold: () => log.push('hold'), hold: k.hold, holdBy: ['touch', 'pen', 'mouse'],
      setTimer: c.setTimer, clearTimer: c.clearTimer,
    });
    m.down(mouse());
    c.advance(k.hold);
    assert.deepEqual(log, ['hold']);
  });

  test(`${k.name}: a press with no pointer type is not a hold either`, () => {
    const { m, c, log } = rig(k);
    m.down({ button: 0, detail: 1 });
    c.advance(k.hold * 3);
    assert.deepEqual(log, []);
  });

  test(`${k.name}: a right or middle button is not a press: it neither taps nor holds`, () => {
    const { m, c, log } = rig(k);
    m.down({ ...touch(), button: 2 });
    assert.equal(c.pending(), 0);
    c.advance(k.hold * 3);
    assert.deepEqual(log, []);
  });

  test(`${k.name}: a press that leaves the key, or a scroll that takes the touch, does nothing`, () => {
    const { m, c, log } = rig(k);
    m.down(touch());
    c.advance(k.hold - 50);
    m.cancel();
    assert.equal(c.pending(), 0, 'no timer is left running');
    c.advance(k.hold * 3);
    assert.deepEqual(log, []);
  });

  test(`${k.name}: ⇧-click holds (a mouse’s way in), on a pointer and as ⇧-Enter, a click with no pointer`, () => {
    const { m, log } = rig(k);
    m.down(mouse({ shiftKey: true }));
    m.up();
    m.click(click({ shiftKey: true }));
    m.click(click({ shiftKey: true, detail: 0 }));
    assert.deepEqual(log, ['hold', 'hold']);
  });

  test(`${k.name}: Enter and Space on the focused key are a tap (a click with no pointer)`, () => {
    const { m, log } = rig(k);
    m.click(click({ detail: 0 }));
    assert.deepEqual(log, ['tap']);
  });

  test(`${k.name}: with a selection on, a hold does nothing new and a tap is the tap that picks`, () => {
    const { m, c, log } = rig(k, { selecting: true });
    m.down(touch());
    assert.equal(c.pending(), 0, 'no hold to wait for: the selection is already on');
    m.up();
    m.click(click());
    m.click(click({ shiftKey: true }));
    assert.deepEqual(log, ['tap', 'hold'], 'the caller turns both into a toggle');
  });

  test(`${k.name}: a hold whose lift never clicks does not swallow the next tap`, () => {
    const { m, c, log } = rig(k);
    m.down(touch());
    c.advance(k.hold);
    m.up(); // the phone sent no click
    m.down(touch());
    m.up();
    m.click(click());
    assert.deepEqual(log, ['hold', 'tap']);
  });

  test(`${k.name}: a hold whose finger slid off never swallows the next keyboard press`, () => {
    const { m, c, log } = rig(k);
    m.down(touch());
    c.advance(k.hold);
    m.cancel(); // slid off: no click will come
    m.click(click({ detail: 0 })); // Enter on the focused key
    assert.deepEqual(log, ['hold', 'tap']);
  });

  test(`${k.name}: a keyboard click is never the swallowed lift of a hold`, () => {
    const { m, c, log } = rig(k);
    m.down(touch());
    c.advance(k.hold);
    m.up();
    m.click(click({ detail: 0 }));
    assert.deepEqual(log, ['hold', 'tap']);
  });

  // A finger's pointerleave comes after its pointerup and before the click:
  // it must not make the hold's click look like a tap.
  test(`${k.name}: a pointerleave after the lift does not turn the hold’s click into a tap`, () => {
    const { m, c, log } = rig(k);
    m.down(touch());
    c.advance(k.hold);
    m.up();
    m.cancel();
    m.click(click());
    assert.deepEqual(log, ['hold']);
  });

  test(`${k.name}: active says a finger is on it (or a hold just fired), so a long-press menu is held back; a mouse never is`, () => {
    const { m, c } = rig(k);
    assert.equal(m.active(), false);
    m.down(touch());
    assert.equal(m.active(), true);
    c.advance(k.hold);
    m.up();
    assert.equal(m.active(), true, 'the hold fired: its lift and its menu are still to come');
    m.click(click());
    assert.equal(m.active(), false);
    m.down(mouse());
    assert.equal(m.active(), false);
  });

  test(`${k.name}: two quick taps in one place are a tap, then a double -- the first never waits for the second`, () => {
    const { m, c, log } = rig(k, { double: true });
    tapAt(m);
    assert.deepEqual(log, ['tap'], 'the first tap is a tap at once');
    c.advance(GESTURE.DOUBLE_MS - 1);
    tapAt(m, 12, 14);
    assert.deepEqual(log, ['tap', 'double'], 'the second is the double, in place of its tap');
    // A third is a fresh first.
    tapAt(m);
    assert.deepEqual(log, ['tap', 'double', 'tap']);
  });

  test(`${k.name}: two taps too far apart, in time or on the key, are two taps`, () => {
    const slow = rig(k, { double: true });
    tapAt(slow.m);
    slow.c.advance(GESTURE.DOUBLE_MS);
    tapAt(slow.m);
    assert.deepEqual(slow.log, ['tap', 'tap']);
    const far = rig(k, { double: true });
    tapAt(far.m, 10, 10);
    tapAt(far.m, 10 + GESTURE.DOUBLE_PX, 10);
    assert.deepEqual(far.log, ['tap', 'tap']);
  });

  // On a Pixel Tablet's size, a first tap on a spine started the take and
  // held the page up: the second tap's click was handled 306 ms after the
  // first's, though the finger lifted 23 ms after it, and the double tap
  // that opens a take was read as two taps.
  test(`${k.name}: two taps are timed by their events, not by when the page got round to them`, () => {
    const { m, c, log } = rig(k, { double: true });
    m.down(touch()); m.up(); m.click(click({ clientX: 10, clientY: 10, timeStamp: 1296 }));
    c.advance(GESTURE.DOUBLE_MS + 6); // the page, busy with the first
    m.down(touch()); m.up(); m.click(click({ clientX: 10, clientY: 10, timeStamp: 1319 }));
    assert.deepEqual(log, ['tap', 'double']);
    // And two taps the hand made far apart stay two, however soon they're handled.
    const late = rig(k, { double: true });
    late.m.down(touch()); late.m.up(); late.m.click(click({ clientX: 10, clientY: 10, timeStamp: 1000 }));
    late.m.down(touch()); late.m.up(); late.m.click(click({ clientX: 10, clientY: 10, timeStamp: 1000 + GESTURE.DOUBLE_MS }));
    assert.deepEqual(late.log, ['tap', 'tap']);
  });

  test(`${k.name}: with no onDouble every tap is a tap, however quick`, () => {
    const { m, log } = rig(k);
    tapAt(m);
    tapAt(m);
    assert.deepEqual(log, ['tap', 'tap']);
  });

  test(`${k.name}: a mouse double-clicks as a finger double taps`, () => {
    const { m, log } = rig(k, { double: true });
    for (let i = 0; i < 2; i++) { m.down(mouse()); m.up(); m.click(click({ clientX: 10, clientY: 10 })); }
    assert.deepEqual(log, ['tap', 'double']);
  });

  test(`${k.name}: a hold, a ⇧-click, a keyboard click or a pick is never half of a double`, () => {
    // A hold, then a quick tap: the tap is a tap.
    const h = rig(k, { double: true });
    tapAt(h.m);
    h.m.down(touch());
    h.c.advance(k.hold);
    h.m.up();
    h.m.click(click({ clientX: 10, clientY: 10 }));
    tapAt(h.m);
    assert.deepEqual(h.log, ['tap', 'hold', 'tap']);
    // A ⇧-click between two taps.
    const s = rig(k, { double: true });
    tapAt(s.m);
    s.m.click(click({ shiftKey: true, clientX: 10, clientY: 10 }));
    tapAt(s.m);
    assert.deepEqual(s.log, ['tap', 'hold', 'tap']);
    // Enter, Enter.
    const kb = rig(k, { double: true });
    kb.m.click(click({ detail: 0 }));
    kb.m.click(click({ detail: 0 }));
    tapAt(kb.m);
    assert.deepEqual(kb.log, ['tap', 'tap', 'tap']);
    // Enter between two quick taps: the second tap's first half is gone.
    const tkt = rig(k, { double: true });
    tapAt(tkt.m);
    tkt.m.click(click({ detail: 0 }));
    tapAt(tkt.m);
    assert.deepEqual(tkt.log, ['tap', 'tap', 'tap']);
    // With a selection on, two quick taps are two picks.
    const p = rig(k, { double: true, selecting: true });
    tapAt(p.m);
    tapAt(p.m);
    assert.deepEqual(p.log, ['tap', 'tap']);
    // A pick between two quick taps, the selection on for it alone.
    const on = { double: true };
    const tpt = rig(k, on);
    tapAt(tpt.m);
    on.selecting = true;
    tapAt(tpt.m);
    on.selecting = false;
    tapAt(tpt.m);
    assert.deepEqual(tpt.log, ['tap', 'tap', 'tap']);
  });
}

// The spine's slop: a finger that moves past it is a scroll or a drag, not a hold.
test('a spine: a finger that moves past the slop holds nothing; a small wobble is still a hold', () => {
  const k = KINDS[0];
  const moved = rig(k);
  moved.m.down(touch());
  moved.c.advance(k.hold - 50);
  moved.m.move({ clientX: 10 + GESTURE.SLOP_PX + 1, clientY: 10 });
  moved.c.advance(k.hold);
  assert.deepEqual(moved.log, []);
  const { m, c, log } = rig(k);
  m.down(touch());
  m.move({ clientX: 14, clientY: 12 });
  c.advance(k.hold);
  assert.deepEqual(log, ['hold']);
});

test('a ● key: a finger that wanders on the key still holds, as it always did', () => {
  const k = KINDS[1];
  const { m, c, log } = rig(k);
  m.down(touch());
  m.move({ clientX: 40, clientY: 10 });
  c.advance(k.hold);
  assert.deepEqual(log, ['hold']);
});

// bindPress on a stand-in element: Node's EventTarget, and events with the
// fields a browser's pointer events carry.
function element() {
  const el = new EventTarget();
  const fire = (type, fields = {}) => {
    const e = Object.assign(new Event(type, { cancelable: true }), fields);
    el.dispatchEvent(e);
    return e;
  };
  return { el, fire };
}

test('bindPress wires the pointer, the click and the menu to one machine', () => {
  const { el, fire } = element();
  const c = clock();
  const log = [];
  bindPress(el, {
    onTap: () => log.push('tap'), onHold: () => log.push('hold'), onDouble: () => log.push('double'),
    onDown: (e) => log.push(`down:${e.pointerType}`),
    ...SPINE_PRESS, now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer,
  });
  // A tap, then a double.
  for (let i = 0; i < 2; i++) {
    fire('pointerdown', touch());
    fire('pointerup', touch());
    fire('click', { detail: 1, clientX: 10, clientY: 10 });
  }
  assert.deepEqual(log, ['down:touch', 'tap', 'down:touch', 'double'], 'onDown comes first, every time');
  // A finger on it holds the menu back; a hold too, until its click.
  log.length = 0;
  c.advance(1000);
  fire('pointerdown', touch());
  assert.equal(fire('contextmenu').defaultPrevented, true);
  c.advance(GESTURE.HOLD.select);
  fire('pointerup', touch());
  fire('pointerleave', touch());
  assert.equal(fire('contextmenu').defaultPrevented, true, 'the hold fired: its menu is not wanted');
  const lift = fire('click', { detail: 1, clientX: 10, clientY: 10 });
  assert.ok(lift.defaultPrevented, 'the lift’s click is swallowed');
  assert.deepEqual(log, ['down:touch', 'hold']);
  // A mouse's right button gets its menu.
  assert.equal(fire('contextmenu').defaultPrevented, false);
  // A finger that moves away holds nothing.
  log.length = 0;
  fire('pointerdown', touch());
  fire('pointermove', { clientX: 40, clientY: 10 });
  c.advance(GESTURE.HOLD.select);
  assert.deepEqual(log, ['down:touch']);
  fire('pointercancel');
});

for (const k of KINDS) {
  test(`bindPress, ${k.name}: a finger that slides off, a scroll that takes it, or a lift that never clicks holds nothing`, () => {
    const c = clock();
    const log = [];
    const { el, fire } = element();
    bindPress(el, {
      ...optsOf(k), onTap: () => log.push('tap'), onHold: () => log.push('hold'),
      now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer,
    });
    fire('pointerdown', touch());
    fire('pointerleave', touch()); // slid off the key, still down
    c.advance(k.hold * 3);
    fire('pointerdown', touch());
    fire('pointercancel'); // the page's scroll took it
    c.advance(k.hold * 3);
    fire('pointerdown', touch());
    fire('pointerup', touch());
    fire('pointerleave', touch()); // a finger's leave after its lift; then no click
    c.advance(k.hold * 3);
    assert.deepEqual(log, []);
    assert.equal(c.pending(), 0, 'no hold is left waiting');
  });
}

test('bindPress with the ● key’s options never lets the browser’s menu open on it', () => {
  const { el, fire } = element();
  bindPress(el, { onTap() {}, onHold() {}, ...ARM_PRESS });
  assert.equal(fire('contextmenu').defaultPrevented, true);
});

// The cases above are a spine's and a ● key's (a track's, and the bar's in
// the Studio) only while their callers bind them with exactly these options: each spreads its own and sets none of a
// press's feel (hold, slop, holdBy, menu) over it.
test('a spine and a ● key are bound with SPINE_PRESS and ARM_PRESS, and nothing over them', () => {
  for (const [file, name] of [['../room/doorway.js', 'SPINE_PRESS'], ['../tape/page.js', 'ARM_PRESS']]) {
    const src = fs.readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
    const calls = [...src.matchAll(/\bbindPress\(\s*[\w$.]+\s*,\s*\{/g)].map((m) => {
      let i = m.index + m[0].length, depth = 1;
      for (; i < src.length && depth; i++) depth += src[i] === '{' ? 1 : src[i] === '}' ? -1 : 0;
      return src.slice(m.index + m[0].length, i - 1);
    });
    assert.ok(calls.length >= 1, `${file} binds its keys`);
    // Each of them: a track's ● and the bar's ● are both ● keys.
    for (const call of calls) {
      assert.match(call, new RegExp(`\\.\\.\\.${name}\\b`), `${file} spreads ${name}`);
      assert.doesNotMatch(call, /(?:^|[\s,{])(?:hold|slop|holdBy|menu)\s*:/, `${file} sets its own feel over ${name}`);
    }
  }
});
