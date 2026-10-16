import { test } from 'node:test';
import assert from 'node:assert/strict';
import { studioBusy, recording, swapQuestion, loadTape, putTapeOn, wireOpenInStudio } from './swap.js';

function fakePi(script) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push(`${init.method || 'GET'} ${url}${init.body ? ` ${init.body}` : ''}`);
    const step = script.shift();
    assert.ok(step, `unexpected request ${url}`);
    const [match, status, body] = step;
    assert.ok(url.startsWith(match), `${url} should start ${match}`);
    return { ok: status < 300, status, json: async () => body };
  };
  return { fetchImpl, calls };
}

test('the Studio’s tape is busy when it plays, counts in, records, is armed, or mixes down', () => {
  assert.equal(studioBusy(null), false);
  assert.equal(studioBusy({ playing: false, count_in: 0 }), false);
  assert.equal(studioBusy({ playing: true }), true);
  assert.equal(studioBusy({ count_in: 1200 }), true);
  assert.equal(studioBusy({ record: { state: 'armed' } }), true);
  assert.equal(studioBusy({ record: { state: 'on' } }), true);
  assert.equal(studioBusy({ mixdown: { state: 'tail' } }), true);
  assert.equal(studioBusy({ mixdown: { state: 'done' } }), false);
  assert.equal(recording({ record: { state: 'armed' } }), true);
  assert.equal(recording({ playing: true }), false);
  assert.equal(swapQuestion('Tuesday groove'), 'Studio is using “Tuesday groove”. Swap it?');
});

test('a tape goes on without asking when the Studio’s is idle', async () => {
  const pi = fakePi([
    ['/api/tapes', 200, { loaded: 'a', tapes: [] }],
    ['/api/tapes/state?id=a', 200, { tape: { name: 'Old' }, live: { playing: false } }],
    ['/api/tapes/load?id=b', 200, {}],
    ['/api/tapes/transport?id=b', 200, {}],
  ]);
  let asked = 0;
  const r = await putTapeOn('b', { fetchImpl: pi.fetchImpl, ask: async () => { asked++; return true; } });
  assert.deepEqual(r, { loaded: true, already: false, live: null, played: true });
  assert.equal(asked, 0);
  assert.equal(pi.calls.at(-1), 'POST /api/tapes/transport?id=b {"action":"play"}');
});

test('a tape on the deck while the Studio records on another asks first, and no leaves it', async () => {
  const pi = fakePi([
    ['/api/tapes', 200, { loaded: 'a', tapes: [] }],
    ['/api/tapes/state?id=a', 200, { tape: { name: 'Tuesday groove' }, live: { playing: true, record: { state: 'on' } } }],
  ]);
  const questions = [];
  const r = await putTapeOn('b', { fetchImpl: pi.fetchImpl, ask: async (q) => { questions.push(q); return false; } });
  assert.deepEqual(questions, ['Studio is using “Tuesday groove”. Swap it?']);
  assert.equal(r.loaded, false);
  assert.equal(r.played, false);
  assert.ok(!pi.calls.some((c) => c.includes('/load')), 'nothing was loaded');
});

test('yes swaps it', async () => {
  const pi = fakePi([
    ['/api/tapes', 200, { loaded: 'a', tapes: [] }],
    ['/api/tapes/state?id=a', 200, { tape: { name: 'Tuesday groove' }, live: { record: { state: 'armed' } } }],
    ['/api/tapes/load?id=b', 200, {}],
  ]);
  const r = await loadTape('b', { fetchImpl: pi.fetchImpl, ask: async () => true });
  assert.equal(r.loaded, true);
});

test('the tape already on the deck is not pressed again while it plays, or when ▶ would record', async () => {
  for (const live of [{ playing: true }, { record: { state: 'armed' } }]) {
    const pi = fakePi([
      ['/api/tapes', 200, { loaded: 'a', tapes: [] }],
      ['/api/tapes/state?id=a', 200, { tape: { name: 'X' }, live }],
    ]);
    const r = await putTapeOn('a', { fetchImpl: pi.fetchImpl, ask: async () => assert.fail('nothing to ask') });
    assert.deepEqual([r.loaded, r.already, r.played], [true, true, false]);
    assert.equal(pi.calls.length, 2);
  }
  // Stopped and nothing armed: it plays.
  const pi = fakePi([
    ['/api/tapes', 200, { loaded: 'a', tapes: [] }],
    ['/api/tapes/state?id=a', 200, { tape: { name: 'X' }, live: { playing: false } }],
    ['/api/tapes/transport?id=a', 200, {}],
  ]);
  assert.equal((await putTapeOn('a', { fetchImpl: pi.fetchImpl })).played, true);
});

test('nothing loaded: it loads without asking', async () => {
  const pi = fakePi([
    ['/api/tapes', 200, { loaded: '', tapes: [] }],
    ['/api/tapes/load?id=b', 200, {}],
  ]);
  assert.equal((await loadTape('b', { fetchImpl: pi.fetchImpl })).loaded, true);
});

test('a refused load says why', async () => {
  const pi = fakePi([
    ['/api/tapes', 200, { loaded: '' }],
    ['/api/tapes/load?id=b', 409, { error: 'a mixdown is playing; wait for it' }],
  ]);
  await assert.rejects(loadTape('b', { fetchImpl: pi.fetchImpl }), /a mixdown is playing/);
});

// --- Open in the Studio: the real click handler, on a stand-in button ---------------

function aButton() {
  const l = [];
  return { addEventListener: (ev, fn) => { if (ev === 'click') l.push(fn); }, click: () => Promise.all(l.map((f) => f())) };
}

test('Open in the Studio loads the tape, says it is going for the tape, then goes: in that order', async () => {
  const log = [];
  const b = aButton();
  wireOpenInStudio(b, {
    id: () => 't1', ask: () => true, toast: () => log.push('toast'), before: () => log.push('before'),
    load: async (id) => { log.push(`load ${id}`); return { loaded: true }; },
    forTape: () => log.push('forTape'), go: (u) => log.push(`go ${u}`),
  });
  await b.click();
  assert.deepEqual(log, ['before', 'load t1', 'forTape', 'go /tape.html']);
});

test('Open in the Studio answered no (Swap it? no): nothing is said and nothing goes', async () => {
  const log = [];
  const b = aButton();
  wireOpenInStudio(b, { id: () => 't1', toast: () => log.push('toast'), load: async () => ({ loaded: false }), forTape: () => log.push('forTape'), go: () => log.push('go') });
  await b.click();
  assert.deepEqual(log, []);
});

test('Open in the Studio refused by the Pi says why and does not go, nor mark the leave for the tape', async () => {
  const log = [];
  const b = aButton();
  wireOpenInStudio(b, { id: () => 't1', toast: (m, k) => log.push(`${k}: ${m}`), load: async () => { throw new Error('no tape'); }, forTape: () => log.push('forTape'), go: () => log.push('go') });
  await b.click();
  assert.deepEqual(log, ['bad: Couldn’t load it in the Studio: no tape']);
});

test('Open in the Studio with no tape picked does nothing', async () => {
  const log = [];
  const b = aButton();
  wireOpenInStudio(b, { id: () => null, toast: () => {}, load: async () => { log.push('load'); return { loaded: true }; }, forTape: () => log.push('forTape'), go: () => log.push('go') });
  await b.click();
  assert.deepEqual(log, []);
});
