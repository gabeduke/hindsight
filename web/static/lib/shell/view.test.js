// The view contract (view.js): a room mounted once and then only shown and
// hidden, and the ctx that keeps "hidden" true of what it does at window and
// document level -- its listeners, its polls, its frame loops, what it adds
// to the header, the dock and the bar, and its title. Stand-ins for the
// document, the window, the timers and the ticker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeDoc } from '../play/fake-dom.js';
import { createView, classesOf } from './view.js';

// A window or a document as addEventListener sees it: a listener is one
// (type, fn, capture), removal needs the same capture, and `once` is the
// platform's own -- used up by the first event, whatever the listener did.
class Target {
  constructor() { this.l = []; }
  static cap(o) { return typeof o === 'boolean' ? o : !!o?.capture; }
  addEventListener(type, fn, opts) {
    const capture = Target.cap(opts);
    if (this.l.some((x) => x.type === type && x.fn === fn && x.capture === capture)) return;
    this.l.push({ type, fn, capture, once: !!opts?.once });
  }
  removeEventListener(type, fn, opts) {
    const capture = Target.cap(opts);
    this.l = this.l.filter((x) => !(x.type === type && x.fn === fn && x.capture === capture));
  }
  fire(type, e = {}) {
    const ev = { type, ...e };
    for (const x of [...this.l]) {
      if (x.type !== type) continue;
      if (x.once) this.removeEventListener(type, x.fn, x.capture);
      x.fn.call(this, ev);
    }
    return ev;
  }
  count(type) { return this.l.filter((x) => x.type === type).length; }
}

// setInterval on a clock the test moves.
function fakeTimers() {
  let now = 0;
  let next = 1;
  const live = new Map();
  return {
    setInterval(fn, ms) { const id = next++; live.set(id, { fn, ms, due: now + ms }); return id; },
    clearInterval(id) { live.delete(id); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let soonest = null;
        for (const t of live.values()) if (t.due <= end && (!soonest || t.due < soonest.due)) soonest = t;
        if (!soonest) break;
        now = soonest.due;
        soonest.due += soonest.ms || 1;
        soonest.fn();
      }
      now = end;
    },
    get armed() { return live.size; },
  };
}

// The ticker, one frame at a time.
function fakeClock() {
  const steps = new Set();
  let t = 0;
  return {
    add(step) { steps.add(step); return () => steps.delete(step); },
    frame(dt = 16) { t += dt; for (const s of [...steps]) s(dt, t); },
  };
}

const tick = () => new Promise((r) => setImmediate(r));

// A shell around one view: its section, the header with its tools at the
// end, the dock with the bar in it, and the bar's own ▶ and scrubber.
function aView(def = {}, opts = {}) {
  const doc = fakeDoc();
  doc.visibilityState = 'visible';
  doc.title = 'Hindsight';
  const el = (tag, id) => { const e = doc.createElement(tag); if (id) e.id = id; return e; };
  const root = el('section', 'view-room');
  const header = el('header', 'appbar');
  const end = el('div', 'appbar-end');
  header.append(end);
  const dock = el('div', 'np-dock');
  const np = el('div', 'np');
  const open = el('a', 'np-open');
  const scrub = el('canvas', 'np-scrub');
  np.append(open, scrub);
  dock.append(np);
  doc.body.append(header, root, dock);
  const timers = fakeTimers();
  const clock = fakeClock();
  const errors = [];
  const calls = [];
  const view = {
    id: 'room',
    title: 'Takes — Hindsight',
    mount: () => {
      calls.push('mount');
      return {
        show: (a) => { calls.push(['show', a]); },
        hide: () => { calls.push('hide'); },
        destroy: () => { calls.push('destroy'); },
      };
    },
    ...def,
  };
  const v = createView(view, {
    root,
    slots: { header: { parent: header, before: end }, dock: { parent: dock, before: np }, bar: { parent: np } },
    shared: { engine: 'the engine', go: () => 'went' },
    doc, timers, clock,
    onError: (e) => errors.push(e),
    ...opts,
  });
  return { v, doc, el, root, header, end, dock, np, open, scrub, timers, clock, errors, calls };
}

// A view whose mount is `fn(ctx)`; the test keeps the ctx.
function withCtx(fn = () => {}, def = {}) {
  const box = {};
  const t = aView({ ...def, mount: (ctx) => { box.ctx = ctx; t.calls.push('mount'); return fn(ctx) || {}; } });
  t.box = box;
  return t;
}

test('a view is mounted once, on its first visit, and shown on every visit', async () => {
  const t = aView();
  assert.deepEqual(t.calls, [], 'nothing runs until the first visit');
  await t.v.show({ url: 'https://kit.example/takes.html', from: null });
  await t.v.hide();
  await t.v.show({ url: 'https://kit.example/takes.html', from: 'studio' });
  assert.deepEqual(t.calls, [
    'mount',
    ['show', { url: 'https://kit.example/takes.html', from: null, first: true }],
    'hide',
    ['show', { url: 'https://kit.example/takes.html', from: 'studio', first: false }],
  ]);
});

test('the root is hidden until the view is shown and while it is hidden; its template is cloned in once', async () => {
  const t = aView();
  const tpl = t.el('template');
  tpl.content = t.el('template');
  tpl.content.isFragment = true;
  tpl.content.append(t.el('p', 'room-shelves'));
  const root = t.el('section');
  t.doc.body.append(root);
  const v = createView({ id: 'room', mount: () => ({}) }, { root, template: tpl, doc: t.doc, timers: t.timers, clock: t.clock });
  assert.equal(root.hidden, true, 'hidden from the start: two views never show at once');
  await v.show();
  assert.equal(root.hidden, false);
  assert.equal(root.children.length, 1);
  assert.equal(root.getAttribute('tabindex'), '-1', 'the router can move focus to it');
  await v.hide();
  assert.equal(root.hidden, true);
  await v.show();
  assert.equal(root.children.length, 1, 'the template is not cloned again');
});

test('ctx.on does nothing while the view is hidden, and hears again when it is shown', async () => {
  const win = new Target();
  let heard = 0;
  const t = withCtx((ctx) => { ctx.on(win, 'keydown', () => { heard++; }); });
  await t.v.show();
  win.fire('keydown');
  assert.equal(heard, 1);
  await t.v.hide();
  win.fire('keydown');
  assert.equal(heard, 1, 'the Studio’s Space does not press ▶ from the Room');
  assert.equal(win.count('keydown'), 1, 'still registered, so its order among the window’s listeners never changes');
  await t.v.show();
  win.fire('keydown');
  assert.equal(heard, 2);
});

test('ctx.on is removed by its off, by its signal and by destroy, with the capture it was added with', async () => {
  const win = new Target();
  const doc = new Target();
  const own = new AbortController();
  let off;
  const t = withCtx((ctx) => {
    off = ctx.on(doc, 'click', () => {}, true);
    ctx.on(win, 'pointerup', () => {}, { capture: true, signal: own.signal });
    ctx.on(win, 'keydown', () => {}, { capture: true, passive: true });
  });
  await t.v.show();
  assert.equal(doc.count('click'), 1);
  off();
  assert.equal(doc.count('click'), 0, 'a capture listener comes off only with capture');
  own.abort();
  assert.equal(win.count('pointerup'), 0, 'the caller’s own signal removes it');
  t.v.destroy();
  assert.equal(win.count('keydown'), 0);
});

test('ctx.on once: an event that comes while the view is hidden does not use it up', async () => {
  const win = new Target();
  let heard = 0;
  const t = withCtx((ctx) => { ctx.on(win, 'pageshow', () => { heard++; }, { once: true }); });
  await t.v.show();
  await t.v.hide();
  win.fire('pageshow');
  assert.equal(heard, 0);
  await t.v.show();
  win.fire('pageshow');
  win.fire('pageshow');
  assert.equal(heard, 1);
  assert.equal(win.count('pageshow'), 0);
});

test('ctx.every polls while the view is shown, arms nothing while it is hidden, and polls once on show', async () => {
  let n = 0;
  const t = withCtx((ctx) => { ctx.every(() => { n++; }, 1000); });
  await t.v.show();
  assert.equal(n, 1, 'the first show polls once, right after mount');
  t.timers.advance(3000);
  assert.equal(n, 4);
  await t.v.hide();
  assert.equal(t.timers.armed, 0, 'a hidden view has no timer at all');
  t.timers.advance(5000);
  assert.equal(n, 4);
  await t.v.show();
  assert.equal(n, 5, 'back: it polls at once, not a whole interval later');
  t.timers.advance(1000);
  assert.equal(n, 6);
});

test('ctx.every skips while the document is hidden, and polls once when it is visible again', async () => {
  let n = 0;
  const t = withCtx((ctx) => { ctx.every(() => { n++; }, 1000); });
  await t.v.show();
  t.doc.visibilityState = 'hidden';
  t.doc.dispatchEvent({ type: 'visibilitychange' });
  t.timers.advance(3000);
  assert.equal(n, 1);
  t.doc.visibilityState = 'visible';
  t.doc.dispatchEvent({ type: 'visibilitychange' });
  assert.equal(n, 2);
  await t.v.hide();
  t.doc.dispatchEvent({ type: 'visibilitychange' });
  assert.equal(n, 2, 'a hidden view is not woken by the document coming back');
});

test('a poll that throws or rejects is reported, and the others still run', async () => {
  let n = 0;
  const t = withCtx((ctx) => {
    ctx.every(() => { throw new Error('status 500'); }, 1000);
    ctx.every(async () => { throw new Error('offline'); }, 1000);
    ctx.every(() => { n++; }, 1000);
  });
  await t.v.show();
  await tick();
  assert.equal(n, 1);
  assert.deepEqual(t.errors.map((e) => e.message).sort(), ['offline', 'status 500']);
});

test('ctx.loop parks while the view is hidden and picks up again on show', async () => {
  let steps = 0;
  let loop;
  const t = withCtx((ctx) => { loop = ctx.loop(() => { steps++; }); loop.start(); });
  await t.v.show();
  t.clock.frame();
  assert.equal(steps, 1);
  await t.v.hide();
  assert.equal(loop.running, false);
  t.clock.frame();
  assert.equal(steps, 1, 'no frames from a hidden Studio’s playhead');
  await t.v.show();
  assert.equal(loop.running, true);
  t.clock.frame();
  assert.equal(steps, 2);
});

test('a loop that parked itself stays parked on show; one started while hidden waits for show', async () => {
  let more = true;
  let a;
  let b;
  const t = withCtx((ctx) => { a = ctx.loop(() => more); b = ctx.loop(() => true); a.start(); });
  await t.v.show();
  t.clock.frame();
  more = false;
  t.clock.frame();
  assert.equal(a.running, false, 'paused: off the ticker');
  await t.v.hide();
  b.start();
  assert.equal(b.running, false, 'started while hidden: not yet');
  await t.v.show();
  assert.equal(a.running, false, 'show does not wake a loop that had nothing to move');
  assert.equal(b.running, true);
  b.stop();
  await t.v.hide();
  await t.v.show();
  assert.equal(b.running, false, 'stopped by the view: stays stopped');
});

test('ctx.active is true only while the view is shown and the document is visible', async () => {
  const t = withCtx();
  await t.v.show();
  const { ctx } = t.box;
  assert.equal(ctx.active(), true);
  t.doc.visibilityState = 'hidden';
  assert.equal(ctx.active(), false);
  t.doc.visibilityState = 'visible';
  await t.v.hide();
  assert.equal(ctx.active(), false);
});

test('what a view adds to a slot is in the page only while it is shown, and goes back where it was', async () => {
  const t = withCtx((ctx) => {
    ctx.headerSlot.add(part);
    ctx.dockSlot.add(editor);
    ctx.barSlot.add(sit, { after: t.open });
    ctx.barSlot.add(strip, 'first');
  });
  const part = t.el('div', 'room-header');
  const editor = t.el('div', 'clip-editor');
  const sit = t.el('button', 'room-sit');
  const strip = t.el('div', 'play-strip');
  const ids = (e) => e.children.map((c) => c.id);
  await t.v.show();
  assert.deepEqual(ids(t.header), ['room-header', 'appbar-end']);
  assert.deepEqual(ids(t.dock), ['clip-editor', 'np'], 'the dock’s part goes in before #np, with no wrapper');
  assert.deepEqual(ids(t.np), ['play-strip', 'np-open', 'room-sit', 'np-scrub']);
  await t.v.hide();
  assert.deepEqual(ids(t.header), ['appbar-end'], 'a hidden view leaves nothing in the header');
  assert.deepEqual(ids(t.dock), ['np']);
  assert.deepEqual(ids(t.np), ['np-open', 'np-scrub']);
  await t.v.show();
  assert.deepEqual(ids(t.header), ['room-header', 'appbar-end']);
  assert.deepEqual(ids(t.dock), ['clip-editor', 'np']);
  assert.deepEqual(ids(t.np), ['play-strip', 'np-open', 'room-sit', 'np-scrub']);
});

test('a slot’s remove takes the node out for good', async () => {
  let remove;
  const sit = aView().el('button', 'room-sit');
  const t = withCtx((ctx) => { remove = ctx.barSlot.add(sit, { after: t.open }); });
  await t.v.show();
  remove();
  assert.deepEqual(t.np.children.map((c) => c.id), ['np-open', 'np-scrub']);
  await t.v.hide();
  await t.v.show();
  assert.deepEqual(t.np.children.map((c) => c.id), ['np-open', 'np-scrub']);
});

test('a slot the shell does not have is an error when a view adds to it, not a node that never shows', async () => {
  const t = aView({ mount: (ctx) => { ctx.dockSlot.add(t.el('div')); return {}; } }, { slots: {} });
  await assert.rejects(t.v.show(), /no dockSlot/);
});

test('the view’s title is document.title while it is shown; one set while it is hidden waits for show', async () => {
  const t = withCtx();
  await t.v.show();
  assert.equal(t.doc.title, 'Takes — Hindsight');
  t.box.ctx.setTitle('3 takes — Hindsight');
  assert.equal(t.doc.title, '3 takes — Hindsight');
  await t.v.hide();
  t.doc.title = 'jam — tape — Hindsight'; // the Studio's, now shown
  t.box.ctx.setTitle('4 takes — Hindsight');
  assert.equal(t.doc.title, 'jam — tape — Hindsight', 'a hidden view does not retitle the page');
  await t.v.show();
  assert.equal(t.doc.title, '4 takes — Hindsight');
});

test('hide runs the view’s own hide while it is still shown, then quiets it', async () => {
  let seen = null;
  const t = withCtx((ctx) => {
    ctx.every(() => {}, 1000);
    return { hide: () => { seen = ctx.active(); } };
  });
  await t.v.show();
  await t.v.hide();
  assert.equal(seen, true, 'its hide can still close what it has open');
  assert.equal(t.timers.armed, 0);
  assert.equal(t.v.shown, false);
});

test('a hide that throws is reported and the view is hidden all the same', async () => {
  const win = new Target();
  let heard = 0;
  const t = withCtx((ctx) => {
    ctx.on(win, 'keydown', () => { heard++; });
    return { hide: () => { throw new Error('the inspector would not close'); } };
  });
  await t.v.show();
  await t.v.hide();
  win.fire('keydown');
  assert.equal(heard, 0);
  assert.equal(t.root.hidden, true);
  assert.deepEqual(t.errors.map((e) => e.message), ['the inspector would not close']);
});

test('destroy undoes everything that went through ctx and aborts its signal', async () => {
  const win = new Target();
  let loop;
  const part = aView().el('div', 'room-header');
  const t = withCtx((ctx) => {
    ctx.on(win, 'keydown', () => {});
    ctx.every(() => {}, 1000);
    loop = ctx.loop(() => true);
    loop.start();
    ctx.headerSlot.add(part);
  });
  await t.v.show();
  const { signal } = t.box.ctx;
  t.v.destroy();
  assert.equal(win.count('keydown'), 0);
  assert.equal(t.timers.armed, 0);
  assert.equal(loop.running, false);
  assert.equal(part.parentElement, null);
  assert.equal(signal.aborted, true);
  await assert.rejects(t.v.show(), /destroyed/);
  loop.start();
  assert.equal(loop.running, false, 'a destroyed view’s loop does not start');
});

test('destroy calls the view’s own hide and destroy', async () => {
  const t = aView();
  await t.v.show();
  t.v.destroy();
  assert.deepEqual(t.calls.slice(-2), ['hide', 'destroy']);
});

test('a mount that throws leaves nothing behind and is not tried again', async () => {
  const win = new Target();
  const part = aView().el('div', 'room-header');
  let mounts = 0;
  const t = aView({
    mount: (ctx) => {
      mounts++;
      ctx.on(win, 'keydown', () => {});
      ctx.every(() => {}, 1000);
      ctx.headerSlot.add(part);
      throw new Error('no such element: #takes');
    },
  });
  await assert.rejects(t.v.show(), /no such element/);
  assert.equal(win.count('keydown'), 0, 'a second mount would otherwise add every listener twice');
  assert.equal(t.timers.armed, 0);
  assert.equal(part.parentElement, null);
  assert.equal(t.root.hidden, true);
  assert.equal(t.v.state, 'failed');
  await assert.rejects(t.v.show(), /failed to mount/);
  assert.equal(mounts, 1);
});

test('createView refuses a view without an id, a mount or a root', () => {
  const doc = fakeDoc();
  const root = doc.createElement('section');
  assert.throws(() => createView({ mount() {} }, { root, doc }), /id/);
  assert.throws(() => createView({ id: 'room' }, { root, doc }), /mount/);
  assert.throws(() => createView({ id: 'room', mount() {} }, { doc }), /root/);
});

test('ctx carries what the shell shares, frozen, and the shell’s own names win', async () => {
  const t = withCtx();
  const v = createView({ id: 'room', mount: (ctx) => { t.box.mine = ctx; return {}; } }, {
    root: t.el('section'), doc: t.doc, timers: t.timers, clock: t.clock,
    shared: { engine: 'the engine', go: () => 'went', on: 'not the gate' },
  });
  await v.show();
  const ctx = t.box.mine;
  assert.equal(ctx.engine, 'the engine');
  assert.equal(ctx.go(), 'went');
  assert.equal(typeof ctx.on, 'function');
  assert.equal(ctx.id, 'room');
  assert.ok(Object.isFrozen(ctx));
});

test('classesOf reads a view’s bodyClass as a string, a spaced string or an array', () => {
  assert.deepEqual(classesOf({ bodyClass: 'tape-page' }), ['tape-page']);
  assert.deepEqual(classesOf({ bodyClass: ' main-page  capture ' }), ['main-page', 'capture']);
  assert.deepEqual(classesOf({ bodyClass: ['shelf-page', 'room-on'] }), ['shelf-page', 'room-on']);
  assert.deepEqual(classesOf({}), []);
});
