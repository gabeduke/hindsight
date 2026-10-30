// The component contract (lib/components/mount.js): a component mounted on
// a root, handed its models and cx, gated while hidden, and taken off for
// good by unmount, so a second mount binds nothing twice. Stand-ins for the
// document, the view's ctx and the models.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeDoc } from '../play/fake-dom.js';
import { createLayers } from '../ui/layers.js';
import { mountComponent, lacks } from './mount.js';

// A model as the contract has it: snapshot() the same object until it
// moves, onChange(fn) with a way off.
function model(state) {
  let snap = Object.freeze({ ...state });
  const fns = new Set();
  return {
    snapshot: () => snap,
    onChange(fn) { fns.add(fn); return () => fns.delete(fn); },
    move(next) { snap = Object.freeze({ ...snap, ...next }); for (const f of [...fns]) f(snap); },
    poke() { for (const f of [...fns]) f(snap); },
    get listeners() { return fns.size; },
  };
}

// A view's ctx, as lib/shell/view.js makes it, for what a component takes
// from it: on (the listener stays registered; the view gates it), loop, the
// view's scope of the stack, toast and go.
function viewCtx(doc) {
  const stack = createLayers({ doc });
  const loops = [];
  return {
    doc,
    loops,
    stack,
    on(target, type, fn, opts) { target.addEventListener(type, fn, opts); return () => target.removeEventListener(type, fn, opts); },
    loop(fn) {
      const l = { fn, running: false, start() { l.running = true; }, stop() { l.running = false; }, step() { if (l.running && fn(16, 0) === false) l.running = false; } };
      loops.push(l);
      return l;
    },
    layers: stack.scope(),
    toast() {},
    go() {},
  };
}

function rootIn(doc, id = 'np') {
  const root = doc.createElement('section');
  root.id = id;
  doc.body.append(root);
  return root;
}

// A component that does one of each thing through cx, and counts.
function probe() {
  const seen = { draws: [], keys: 0, shows: 0, hides: 0, unmounts: 0, loop: null, cx: null };
  const def = {
    id: 'probe',
    root: 'probe',
    needs: ['tape'],
    css: 'css/probe.css',
    mount(root, { tape }, cx) {
      seen.cx = cx;
      root.innerHTML = '<button type="button" data-part="go">go</button>';
      root.querySelector('[data-part="go"]').id = cx.id('go');
      cx.watch(tape, (s) => seen.draws.push(s.n));
      cx.on(root.ownerDocument, 'keydown', () => { seen.keys++; });
      seen.loop = cx.loop(() => true);
      seen.loop.start();
      return { show() { seen.shows++; }, hide() { seen.hides++; }, unmount() { seen.unmounts++; } };
    },
  };
  return { def, seen };
}

test('a component exports { id, root, needs, css, mount }, and is mounted only with the models it needs, once a root', () => {
  assert.deepEqual(lacks(probe().def), []);
  assert.deepEqual(lacks({ id: 'x', needs: 'tape', css: '', mount: 1 }), ['root', 'needs', 'css', 'mount']);
  assert.deepEqual(lacks(null), ['id', 'root', 'needs', 'css', 'mount']);
  const doc = fakeDoc();
  const ctx = viewCtx(doc);
  const root = rootIn(doc);
  assert.throws(() => mountComponent({ id: 'x' }, root, {}, ctx), /exports \{ id, root, needs, css, mount \}/);
  assert.throws(() => mountComponent(probe().def, root, {}, ctx), /needs the tape model/);
  assert.throws(() => mountComponent(probe().def, root, { tape: { snapshot() {} } }, ctx), /needs the tape model/);
  const tape = model({ n: 1 });
  const c = mountComponent(probe().def, root, { tape }, ctx);
  assert.throws(() => mountComponent(probe().def, root, { tape }, ctx), /mounted on it already/);
  c.unmount();
});

test('mount draws from the snapshot now, puts its class on the root and names its parts from the root’s id', () => {
  const doc = fakeDoc();
  const ctx = viewCtx(doc);
  const root = rootIn(doc, 'np');
  const tape = model({ n: 1 });
  const { def, seen } = probe();
  const c = mountComponent(def, root, { tape }, ctx, { open: () => 'opened' });
  assert.equal(c.shown, true);
  assert.deepEqual(seen.draws, [1]);
  assert.ok(root.classList.contains('probe'));
  assert.ok(doc.getElementById('np-go'), 'cx.id makes np-go from the root np');
  assert.equal(seen.cx.props.open(), 'opened');
  assert.ok(Object.isFrozen(seen.cx.props));
  const bare = rootIn(doc, '');
  assert.throws(() => mountComponent(probe().def, bare, { tape }, ctx), /no id to name its parts by/);
  assert.equal(bare.classList.contains('probe'), false, 'a mount that throws leaves nothing on its root');
  c.unmount();
});

test('hidden, it hears nothing: its watchers, keys and loops wake on show, and a watcher draws once if its snapshot moved', () => {
  const doc = fakeDoc();
  const ctx = viewCtx(doc);
  const tape = model({ n: 1 });
  const { def, seen } = probe();
  const c = mountComponent(def, rootIn(doc), { tape }, ctx);
  const [l] = ctx.loops;
  assert.equal(l.running, true);
  tape.move({ n: 2 });
  tape.poke();
  assert.deepEqual(seen.draws, [1, 2], 'a change it has drawn already is not drawn twice');
  doc.dispatchEvent({ type: 'keydown' });
  assert.equal(seen.keys, 1);
  c.hide();
  assert.equal(c.shown, false);
  assert.equal(seen.hides, 1);
  assert.equal(l.running, false, 'its loop is parked');
  tape.move({ n: 3 });
  tape.move({ n: 4 });
  doc.dispatchEvent({ type: 'keydown' });
  assert.deepEqual(seen.draws, [1, 2]);
  assert.equal(seen.keys, 1);
  c.show();
  assert.deepEqual(seen.draws, [1, 2, 4], 'on show, the snapshot as it is now, once');
  assert.equal(seen.shows, 1);
  assert.equal(l.running, true);
  c.hide();
  c.show();
  assert.deepEqual(seen.draws, [1, 2, 4], 'nothing moved: nothing to draw');
  c.unmount();
});

test('a loop that parks itself stays parked through a show', () => {
  const doc = fakeDoc();
  const ctx = viewCtx(doc);
  let steps = 0;
  const def = { ...probe().def, mount(root, m, cx) { const lp = cx.loop(() => { steps++; return false; }); lp.start(); } };
  const c = mountComponent(def, rootIn(doc), { tape: model({}) }, ctx);
  ctx.loops[0].step();
  assert.equal(steps, 1);
  assert.equal(ctx.loops[0].running, false);
  c.hide();
  c.show();
  assert.equal(ctx.loops[0].running, false);
  c.unmount();
});

test('what it opens on the stack closes when it is hidden, and nothing of the view’s', () => {
  const doc = fakeDoc();
  const ctx = viewCtx(doc);
  let mine = null;
  const def = { ...probe().def, mount(root, m, cx) { mine = cx.layers; } };
  const c = mountComponent(def, rootIn(doc), { tape: model({}) }, ctx);
  const closed = [];
  const menu = doc.createElement('div');
  const viewsOwn = doc.createElement('div');
  mine.open({ el: menu, kind: 'menu', onClose: (r) => closed.push(['mine', r]) });
  ctx.layers.open({ el: viewsOwn, kind: 'sheet', onClose: (r) => closed.push(['view', r]) });
  assert.equal(mine.size, 1);
  c.hide();
  assert.deepEqual(closed, [['mine', 'navigate']]);
  assert.equal(mine.size, 0);
  assert.equal(ctx.stack.size, 1, 'the view’s sheet is still open');
  c.unmount();
});

test('unmount takes off everything that went through cx, and a second mount binds each listener once', () => {
  const doc = fakeDoc();
  const ctx = viewCtx(doc);
  const root = rootIn(doc);
  const tape = model({ n: 1 });
  const base = doc.listenerCount('keydown'); // the stack's own
  const first = probe();
  const c = mountComponent(first.def, root, { tape }, ctx);
  assert.equal(doc.listenerCount('keydown'), base + 1);
  assert.equal(tape.listeners, 1);
  c.unmount();
  assert.equal(first.seen.unmounts, 1);
  assert.equal(first.seen.hides, 1, 'a shown component is hidden first');
  assert.equal(doc.listenerCount('keydown'), base);
  assert.equal(tape.listeners, 0);
  assert.equal(ctx.loops[0].running, false);
  assert.equal(root.textContent, '', 'its root is emptied');
  assert.equal(root.classList.contains('probe'), false);
  c.unmount();
  c.show();
  assert.equal(first.seen.unmounts, 1, 'unmounted is for good');

  const again = probe();
  const c2 = mountComponent(again.def, root, { tape }, ctx);
  assert.equal(doc.listenerCount('keydown'), base + 1, 'one key listener, not two');
  assert.equal(tape.listeners, 1);
  doc.dispatchEvent({ type: 'keydown' });
  assert.equal(again.seen.keys, 1);
  assert.equal(first.seen.keys, 0);
  c2.unmount();
});

test('a watcher that throws is reported, and the others still draw', () => {
  const doc = fakeDoc();
  const ctx = viewCtx(doc);
  const tape = model({ n: 1 });
  const drawn = [];
  const reported = [];
  const was = globalThis.reportError;
  globalThis.reportError = (e) => reported.push(e.message);
  try {
    const def = { ...probe().def, mount(root, m, cx) { cx.watch(m.tape, () => { throw new Error('bad draw'); }); cx.watch(m.tape, (s) => drawn.push(s.n)); } };
    const c = mountComponent(def, rootIn(doc), { tape }, ctx);
    tape.move({ n: 2 });
    assert.deepEqual(drawn, [1, 2]);
    assert.deepEqual(reported, ['bad draw', 'bad draw']);
    c.unmount();
  } finally {
    globalThis.reportError = was;
  }
});

test('unmount quiets it before its own unmount runs: nothing draws then, and its menu has closed', () => {
  const doc = fakeDoc();
  const ctx = viewCtx(doc);
  const tape = model({ n: 1 });
  const log = [];
  const def = {
    ...probe().def,
    mount(root, m, cx) {
      cx.watch(m.tape, (s) => log.push(`draw ${s.n}`));
      cx.layers.open({ el: doc.createElement('div'), kind: 'menu', onClose: (r) => log.push(`menu ${r}`) });
      return { unmount() { log.push('unmount'); tape.move({ n: 2 }); } };
    },
  };
  mountComponent(def, rootIn(doc), { tape }, ctx).unmount();
  assert.deepEqual(log, ['draw 1', 'menu navigate', 'unmount']);
});

test('it is handed the models it needs and no others, and cx takes nothing once it is unmounted', () => {
  const doc = fakeDoc();
  const ctx = viewCtx(doc);
  let seen = null;
  let kept = null;
  const def = { ...probe().def, mount(root, m, cx) { seen = m; kept = cx; } };
  const c = mountComponent(def, rootIn(doc), { tape: model({}), takes: model({}) }, ctx);
  assert.deepEqual(Object.keys(seen), ['tape']);
  c.unmount();
  assert.throws(() => kept.watch(model({}), () => {}), /unmounted/);
  assert.throws(() => kept.on(doc, 'keydown', () => {}), /unmounted/);
  assert.throws(() => kept.loop(() => {}), /unmounted/);
});

test('once means once while it is shown: an event while it is hidden doesn’t use it up', () => {
  const doc = fakeDoc();
  const ctx = viewCtx(doc);
  let heard = 0;
  const def = { ...probe().def, mount(root, m, cx) { cx.on(doc, 'keyup', () => { heard++; }, { once: true }); } };
  const c = mountComponent(def, rootIn(doc), { tape: model({}) }, ctx);
  c.hide();
  doc.dispatchEvent({ type: 'keyup' });
  c.show();
  doc.dispatchEvent({ type: 'keyup' });
  doc.dispatchEvent({ type: 'keyup' });
  assert.equal(heard, 1);
  c.unmount();
});
