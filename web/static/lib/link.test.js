import { test } from 'node:test';
import assert from 'node:assert/strict';
import { timedFetch, onResume, createLink, reconnectNote } from './link.js';

// A clock the test moves by hand: setTimeout/setInterval that only run when
// advance() says time has passed.
function fakeClock() {
  let t = 0, id = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimeout: (fn, ms) => { timers.set(++id, { fn, at: t + ms }); return id; },
    clearTimeout: (i) => timers.delete(i),
    setInterval: (fn, ms) => { timers.set(++id, { fn, at: t + ms, every: ms }); return id; },
    clearInterval: (i) => timers.delete(i),
    advance(ms) {
      const end = t + ms;
      for (;;) {
        let next = null;
        for (const [i, x] of timers) if (x.at <= end && (!next || x.at < next[1].at)) next = [i, x];
        if (!next) break;
        const [i, x] = next;
        t = x.at;
        if (x.every) x.at += x.every; else timers.delete(i);
        x.fn();
      }
      t = end;
    },
    // The page was frozen: time passes, and a timer due meanwhile runs once
    // when the page is back, not once for every tick it missed.
    freeze(ms) { t += ms; for (const x of timers.values()) x.at = Math.max(x.at, t); },
    get pending() { return timers.size; },
  };
}

function fakeEnv(clock) {
  const listeners = { doc: {}, win: {} };
  const add = (where) => (type, fn) => { (listeners[where][type] ??= new Set()).add(fn); };
  const del = (where) => (type, fn) => { listeners[where][type]?.delete(fn); };
  const doc = { hidden: false, addEventListener: add('doc'), removeEventListener: del('doc') };
  const win = { addEventListener: add('win'), removeEventListener: del('win') };
  return {
    doc, win, ...clock,
    emit(where, type) { for (const f of [...(listeners[where][type] ?? [])]) f({}); },
    count(where, type) { return listeners[where][type]?.size ?? 0; },
  };
}

test('timedFetch rejects a request that is never answered', async () => {
  let signal;
  const hang = (_url, init) => new Promise((_, reject) => {
    signal = init.signal;
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
  });
  await assert.rejects(timedFetch('/x', {}, 20, hang), { name: 'AbortError' });
  assert.ok(signal.aborted);
});

test('timedFetch passes an answer through and keeps the caller\'s init', async () => {
  let seen;
  const ok = async (url, init) => { seen = { url, init }; return { ok: true }; };
  const res = await timedFetch('/x', { method: 'POST', cache: 'no-store' }, 1000, ok);
  assert.equal(res.ok, true);
  assert.equal(seen.url, '/x');
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.cache, 'no-store');
});

test('timedFetch also stops when the caller\'s own signal aborts', async () => {
  const caller = new AbortController();
  const hang = (_url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
  const p = timedFetch('/x', { signal: caller.signal }, 60000, hang);
  caller.abort();
  await assert.rejects(p, /aborted/);
});

test('onResume fires on visible, pageshow and online, not on hidden', () => {
  const env = fakeEnv(fakeClock());
  const got = [];
  onResume((why) => got.push(why), env);
  env.doc.hidden = true;
  env.emit('doc', 'visibilitychange');
  assert.deepEqual(got, []);
  env.doc.hidden = false;
  env.emit('doc', 'visibilitychange');
  env.emit('win', 'pageshow');
  env.emit('win', 'online');
  assert.deepEqual(got, ['visible', 'pageshow', 'online']);
});

test('onResume notices a clock that jumped while the page was frozen', () => {
  const clock = fakeClock();
  const env = fakeEnv(clock);
  const got = [];
  onResume((why) => got.push(why), env);
  clock.advance(5000); // a running page ticks every second
  assert.deepEqual(got, []);
  clock.freeze(120000); // two minutes asleep, no event fired
  clock.advance(1000);
  assert.deepEqual(got, ['wake']);
  clock.advance(3000);
  assert.deepEqual(got, ['wake'], 'one wake, not a stream');
});

test('onResume does not call a wake while the page is hidden', () => {
  const clock = fakeClock();
  const env = fakeEnv(clock);
  const got = [];
  onResume((why) => got.push(why), env);
  env.doc.hidden = true;
  clock.freeze(60000);
  clock.advance(1000);
  assert.deepEqual(got, []);
});

test('onResume stops listening', () => {
  const clock = fakeClock();
  const env = fakeEnv(clock);
  const stop = onResume(() => {}, env);
  assert.equal(env.count('doc', 'visibilitychange'), 1);
  stop();
  assert.equal(env.count('doc', 'visibilitychange'), 0);
  assert.equal(env.count('win', 'pageshow'), 0);
  assert.equal(env.count('win', 'online'), 0);
  assert.equal(clock.pending, 0);
});

test('the note waits out a quick failure and never shows', () => {
  const clock = fakeClock();
  const changes = [];
  const link = createLink({ onChange: (d) => changes.push(d), env: fakeEnv(clock) });
  link.fail('tape');
  clock.advance(600);
  link.ok('tape');
  clock.advance(5000);
  assert.deepEqual(changes, []);
  assert.equal(link.shown, false);
});

test('the note shows after a second down, and goes when the link is back', () => {
  const clock = fakeClock();
  const changes = [];
  const link = createLink({ onChange: (d) => changes.push(d), env: fakeEnv(clock) });
  link.fail('tape');
  clock.advance(999);
  assert.deepEqual(changes, []);
  clock.advance(2);
  assert.deepEqual(changes, [true]);
  link.fail('tape'); // still failing: said once
  clock.advance(3000);
  assert.deepEqual(changes, [true]);
  link.ok('tape');
  assert.deepEqual(changes, [true, false]);
  assert.equal(link.down, false);
});

test('with two sources, one answering does not clear the other', () => {
  const clock = fakeClock();
  const changes = [];
  const link = createLink({ onChange: (d) => changes.push(d), env: fakeEnv(clock) });
  link.fail('live');
  link.fail('status');
  clock.advance(1500);
  link.ok('status');
  assert.deepEqual(changes, [true]);
  assert.equal(link.down, true);
  link.ok('live');
  assert.deepEqual(changes, [true, false]);
});

test('a link calls onResume with why the page came back', () => {
  const clock = fakeClock();
  const env = fakeEnv(clock);
  const got = [];
  const link = createLink({ onResume: (why) => got.push(why), env });
  env.emit('win', 'online');
  assert.deepEqual(got, ['online']);
  link.stop();
  env.emit('win', 'online');
  assert.deepEqual(got, ['online']);
});

test('stopping a link cancels a note that was waiting', () => {
  const clock = fakeClock();
  const changes = [];
  const link = createLink({ onChange: (d) => changes.push(d), env: fakeEnv(clock) });
  link.fail('tape');
  link.stop();
  clock.advance(5000);
  assert.deepEqual(changes, []);
});

test('the note says Reconnecting… and is hidden until shown', () => {
  const made = [];
  const doc = {
    body: { appendChild: (e) => made.push(e) },
    createElement: () => ({ attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }),
  };
  const show = reconnectNote(doc);
  const el = made[0];
  assert.equal(el.textContent, 'Reconnecting…');
  assert.equal(el.className, 'link-note');
  assert.equal(el.hidden, true);
  show(true);
  assert.equal(el.hidden, false);
  show(false);
  assert.equal(el.hidden, true);
});
