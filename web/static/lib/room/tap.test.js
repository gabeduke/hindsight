// web/static/lib/room/tap.test.js
// A tap on a take plays it in the bar, where you are (docs/superpowers/specs/
// 2026-10-15-flow-design.md, "A tap plays"): the one function every surface
// calls, and the List's rows wired to it. The take list, its players and the
// bar are stand-ins; the rows are real elements of a stand-in document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakeDoc, FakeEl } from '../play/fake-dom.js';
import { createTap, wireRack, askedTake } from './tap.js';

// A take list with players that remember what was done to them.
function stage({ encoding = [], noPlayer = [], readyAfter = {}, slow = false, refuse = false, flyThrows = false } = {}) {
  const log = [];
  const all = ['a', 'b', 'c'].map((n) => ({ name: `jam_${n}.wav`, label: n, has_preview: !encoding.includes(n) }));
  const players = new Map();
  const slowDone = [];
  const takes = {
    all,
    selecting: false,
    selected: new Set(),
    async player(name) {
      log.push(`player ${name}`);
      if (noPlayer.includes(name)) return null;
      if (!players.has(name)) {
        const audio = { paused: true };
        // The sound is asked for the moment toggle is called; `slow` makes it answer later, as a phone does.
        players.set(name, {
          audio,
          toggle: () => {
            if (refuse && audio.paused) { log.push(`refused ${name}`); return Promise.resolve(); }
            audio.paused = !audio.paused;
            log.push(`${audio.paused ? 'pause' : 'play'} ${name}`);
            return slow ? new Promise((r) => { slowDone.push(r); }) : Promise.resolve();
          },
        });
      }
      return players.get(name);
    },
    enterSelect(name) { this.selecting = true; this.selected = new Set(name ? [name] : []); log.push(`select ${name}`); },
    toggleSelected(name) { if (this.selected.has(name)) this.selected.delete(name); else this.selected.add(name); log.push(`toggle ${name}`); },
  };
  // The Pi finishing a preview: take `n` has one after that many looks at the list.
  const looks = {};
  takes.refresh = async () => {
    log.push('refresh');
    for (const t of all) {
      const n = t.name.slice(4, -4);
      looks[n] = (looks[n] || 0) + 1;
      if (readyAfter[n] && looks[n] >= readyAfter[n]) t.has_preview = true;
    }
  };
  // The bar: its take, whether anything in it is playing (the take, or the tape), and how
  // many times the person has used it (pageBar's `touches`).
  const np = {
    takeName: null,
    touches: 0,
    playingNow: false,
    playing() { return this.playingNow; },
    loadTake(t, p) { this.takeName = t.name; log.push(`bar ${t.name}`); this.player = p; },
  };
  const toasts = [];
  const picks = [];
  const went = [];
  // A clock turned by hand: a retry is waiting on it.
  const timers = [];
  const later = (fn, ms) => { timers.push({ fn, ms }); };
  const tick = async () => { const t = timers.shift(); if (t) await t.fn(); return !!t; };
  // A toast that can be put away, as lib/toast.js's is.
  const shown = [];
  const toast = (m, k, o) => { const t = { m, k, o, live: true, dismiss() { this.live = false; } }; toasts.push([m, k, o]); shown.push(t); return t; };
  const tap = createTap({
    takes, bar: () => np, toast, pick: (n) => picks.push(n), go: (u) => went.push(u), later,
    onPlay: (n, o) => { log.push(`fly ${n} ${o.placed ? 'placed' : 'resumed'}`); if (flyThrows) throw new Error('no flight'); },
    onStop: (n) => log.push(`stop ${n}`),
  });
  const live = () => shown.filter((t) => t.live).map((t) => t.m);
  return { takes, np, tap, log, toasts, picks, players, went, timers, tick, slowDone, shown, live };
}

test('a tap puts the take in the bar and plays it', async () => {
  const s = stage();
  assert.equal(await s.tap.tap('jam_a.wav'), 'played');
  assert.deepEqual(s.log, ['player jam_a.wav', 'bar jam_a.wav', 'play jam_a.wav', 'fly jam_a.wav placed']);
  assert.equal(s.np.takeName, 'jam_a.wav');
  assert.deepEqual(s.picks, ['jam_a.wav'], 'picked, so Play all goes on from here');
});

test('tapping it again pauses it, and the bar keeps it', async () => {
  const s = stage();
  await s.tap.tap('jam_a.wav');
  assert.equal(await s.tap.tap('jam_a.wav'), 'paused');
  assert.equal(s.players.get('jam_a.wav').audio.paused, true);
  assert.equal(s.np.takeName, 'jam_a.wav');
  assert.equal(await s.tap.tap('jam_a.wav'), 'played', 'and a third tap plays on');
});

test('another take replaces it in the bar and plays', async () => {
  const s = stage();
  await s.tap.tap('jam_a.wav');
  await s.tap.tap('jam_b.wav');
  assert.equal(s.np.takeName, 'jam_b.wav');
  assert.ok(s.log.includes('play jam_b.wav'));
});

test('a take still encoding says so and plays nothing', async () => {
  const s = stage({ encoding: ['a'] });
  assert.equal(await s.tap.tap('jam_a.wav'), 'encoding');
  assert.equal(s.np.takeName, null);
  assert.deepEqual(s.toasts.map((t) => t[0]), ['Still encoding — a moment']);
  assert.ok(!s.log.some((l) => l.startsWith('play')));
});

test('a take that cannot play can still be opened: the toast has Open, and Open goes to its page', async () => {
  const s = stage({ encoding: ['a'] });
  await s.tap.tap('jam_a.wav');
  const [msg, kind, opts] = s.toasts[0];
  assert.equal(msg, 'Still encoding — a moment');
  assert.equal(kind, 'warn');
  assert.equal(opts.action.label, 'Open');
  opts.action.run();
  assert.deepEqual(s.went, ['/wave.html?file=jam_a.wav']);
  // And a take whose player is not ready (no peaks yet) is the same.
  const n = stage({ noPlayer: ['jam_c.wav'] });
  await n.tap.tap('jam_c.wav');
  assert.equal(n.toasts[0][2].action.label, 'Open');
  n.toasts[0][2].action.run();
  assert.deepEqual(n.went, ['/wave.html?file=jam_c.wav']);
});

test('a take still encoding is looked for again, and once it is ready it is in the bar, paused, ▶ ready: never played behind the person’s back', async () => {
  const s = stage({ encoding: ['a'], readyAfter: { a: 2 } });
  await s.tap.tap('jam_a.wav');
  assert.equal(s.timers.length, 1, 'a retry is waiting');
  assert.equal(s.timers[0].ms, 1500);
  assert.equal(s.np.takeName, null);
  await s.tick(); // first look: still no preview
  assert.equal(s.np.takeName, null);
  assert.equal(s.timers.length, 1);
  await s.tick(); // second look: ready
  assert.equal(s.np.takeName, 'jam_a.wav', 'loaded in the bar');
  assert.equal(s.players.get('jam_a.wav').audio.paused, true, 'paused');
  assert.ok(!s.log.some((l) => l.startsWith('play ')), 'nothing played: the retry is not inside the tap');
  assert.equal(s.timers.length, 0, 'and it stops looking');
  assert.equal(s.toasts.at(-1)[0], 'Ready — tap to play');
});

test('a take that never finishes is looked for ten times, then said so once, with Open', async () => {
  const s = stage({ encoding: ['a'] });
  await s.tap.tap('jam_a.wav');
  let looks = 0;
  while (looks < 50 && await s.tick()) looks++;
  assert.equal(looks, 10);
  assert.equal(s.np.takeName, null);
  assert.deepEqual(s.live(), ['Still no preview — open it to see why'], 'the old toast is replaced by the last word');
  assert.equal(s.shown.at(-1).o.action.label, 'Open');
  s.shown.at(-1).o.action.run();
  assert.deepEqual(s.went, ['/wave.html?file=jam_a.wav']);
});

// What the retry may do when the take turns up is what the person has not undone: it
// is F4's lesson (never override what they did). Nothing is loaded, and so nothing
// is paused or replaced, if anything is playing, if the bar's take is no longer
// what it was when the retry began, or if the person has used the bar since.
async function arrives(setup) {
  const s = stage({ encoding: ['a'], readyAfter: { a: 2 } });
  await s.tap.tap('jam_a.wav');
  await s.tick();
  setup(s);
  await s.tick();
  return s;
}
const notLoaded = (s, why) => {
  assert.equal(s.np.takeName, s.np.takeName === 'jam_a.wav' ? null : s.np.takeName, why);
  assert.ok(!s.log.includes('bar jam_a.wav'), why);
  assert.equal(s.live().at(-1), 'a is ready — tap it', why);
};

test('late arrival while something is playing (a take, or the tape) loads nothing and just says so', async () => {
  const s = await arrives((st) => { st.np.playingNow = true; });
  notLoaded(s, 'something is playing');
  assert.ok(!s.log.some((l) => /^(play|pause) /.test(l)));
});

test('late arrival after the bar moved to another take loads nothing: the bar’s take is what the person has now', async () => {
  const s = await arrives((st) => { st.np.takeName = 'jam_b.wav'; });
  assert.equal(s.np.takeName, 'jam_b.wav');
  assert.ok(!s.log.includes('bar jam_a.wav'));
  assert.equal(s.live().at(-1), 'a is ready — tap it');
});

test('late arrival after the person used the bar (its keys, its strip, ⏏) loads nothing', async () => {
  const s = await arrives((st) => { st.np.touches++; });
  notLoaded(s, 'the bar was used');
});

test('late arrival after the person tapped another take loads nothing, even one that did not change the bar', async () => {
  const s = await arrives(() => {});
  assert.equal(s.np.takeName, 'jam_a.wav', 'control: with nothing done it does load');
  const t = stage({ encoding: ['a'], readyAfter: { a: 2 } });
  await t.tap.tap('jam_a.wav');
  await t.tick();
  await t.tap.tap('jam_c.wav'); // plays: the bar now holds c, and plays it
  t.np.playingNow = true;
  await t.tick();
  assert.equal(t.np.takeName, 'jam_c.wav');
  assert.ok(!t.log.includes('bar jam_a.wav'));
});

test('late arrival after the person tapped another take that cannot play either loads nothing: the last tap is the choice', async () => {
  const s = stage({ encoding: ['a', 'b'], readyAfter: { a: 1 } });
  await s.tap.tap('jam_a.wav');
  await s.tap.tap('jam_b.wav'); // the bar, its keys and what plays are untouched
  await s.tick();
  assert.equal(s.np.takeName, null);
  assert.ok(!s.log.includes('bar jam_a.wav'));
  assert.ok(s.live().includes('a is ready — tap it'));
});

test('a retry that began with a paused take in the bar still loads: nothing has changed', async () => {
  const s = stage({ encoding: ['a'], readyAfter: { a: 2 } });
  s.np.takeName = 'jam_b.wav'; // paused in the bar all along
  await s.tap.tap('jam_a.wav');
  await s.tick();
  await s.tick();
  assert.equal(s.np.takeName, 'jam_a.wav');
});

// --- one toast per take, never a pile ---------------------------------------------------

test('tapping a take that cannot play again puts the old toast away rather than stacking', async () => {
  const s = stage({ encoding: ['a'] });
  await s.tap.tap('jam_a.wav');
  await s.tap.tap('jam_a.wav');
  assert.deepEqual(s.live(), ['Still encoding — a moment']);
  assert.equal(s.shown.length, 2);
});

test('Ready replaces Still encoding, and does not sit beside it', async () => {
  const s = stage({ encoding: ['a'], readyAfter: { a: 1 } });
  await s.tap.tap('jam_a.wav');
  assert.deepEqual(s.live(), ['Still encoding — a moment']);
  await s.tick();
  assert.deepEqual(s.live(), ['Ready — tap to play']);
});

test('tapping it again while it is looked for does not start a second look; tapping another take drops the first', async () => {
  const s = stage({ encoding: ['a', 'b'], readyAfter: { a: 1, b: 1 } });
  await s.tap.tap('jam_a.wav');
  await s.tap.tap('jam_a.wav');
  assert.equal(s.timers.length, 1);
  await s.tap.tap('jam_b.wav');
  for (let i = 0; i < 50 && await s.tick(); i++);
  assert.equal(s.np.takeName, 'jam_b.wav', 'the take tapped last is the one that is loaded');
  assert.ok(!s.log.includes('bar jam_a.wav'));
});

test('a take whose player is not ready says so, and the bar is left as it was', async () => {
  const s = stage({ noPlayer: ['jam_c.wav'] });
  assert.equal(await s.tap.tap('jam_c.wav'), 'encoding');
  assert.equal(s.np.takeName, null);
  assert.equal(s.toasts.length, 1);
});

test('a take that is not in the list, or a bar that has not come up yet, does nothing', async () => {
  const s = stage();
  assert.equal(await s.tap.tap('gone.wav'), 'missing');
  const early = createTap({ takes: s.takes, bar: () => null, toast: () => {}, pick: () => {} });
  assert.equal(await early.tap('jam_a.wav'), 'no bar');
  assert.ok(!s.log.some((l) => l.startsWith('play')));
});

test('warm fetches the player before the press is over, so the play is inside the tap', async () => {
  const s = stage();
  s.tap.warm('jam_b.wav');
  assert.deepEqual(s.log, ['player jam_b.wav']);
  s.tap.warm('gone.wav'); // nothing to warm: no throw
  assert.deepEqual(s.log, ['player jam_b.wav']);
});

// --- the List's rows --------------------------------------------------------------

function rack(s, { selecting = false } = {}) {
  const doc = fakeDoc();
  const container = doc.createElement('div');
  doc.body.append(container);
  const rows = new Map();
  for (const t of s.takes.all) {
    const row = doc.createElement('article');
    row.className = 'take spine';
    row.dataset.name = t.name;
    const name = doc.createElement('button');
    name.className = 'take-name';
    const wave = doc.createElement('div');
    wave.className = 'wave';
    row.append(name, wave);
    container.append(row);
    rows.set(t.name, { row, name, wave });
  }
  s.takes.selecting = selecting;
  wireRack(container, { takes: s.takes, tap: s.tap });
  return { container, rows };
}
const fire = (el, type, extra = {}) => {
  const e = { type, target: el, defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...extra };
  // Bubble, as the page does.
  for (let n = el; n; n = n.parent) { if (n instanceof FakeEl) n.dispatchEvent(e); }
  return e;
};
const settle = () => new Promise((r) => setTimeout(r, 0));

test('a click on a row’s body plays it in the bar, and nothing opens', async () => {
  const s = stage();
  const { rows } = rack(s);
  fire(rows.get('jam_b.wav').row, 'click', { detail: 1, clientX: 10, clientY: 10 });
  await settle();
  assert.equal(s.np.takeName, 'jam_b.wav');
  assert.ok(s.log.includes('play jam_b.wav'));
});

// The waveform of a row is the scrub surface, not a play target (the spec says a
// tap on a take plays; a row's wave is where a finger goes to move the playhead).
// On a spine the wave has pointer-events: none, so the click's target is the row
// and the place the click landed is what says it was on the waveform.
test('a click on a row’s waveform neither plays nor pauses it', async () => {
  const s = stage();
  const { rows } = rack(s);
  const r = rows.get('jam_b.wav');
  r.wave.getBoundingClientRect = () => ({ left: 100, right: 250, top: 5, bottom: 31, width: 150, height: 26 });
  // The click lands on the wave itself (a row that is not a spine) ...
  fire(r.wave, 'click', { detail: 1, clientX: 180, clientY: 18 });
  fire(r.wave, 'click', { detail: 1, clientX: 20, clientY: 18 }); // a click that is the wave's, wherever it says it landed
  // ... or on the row, over the place the wave is (a spine's wave lets the press through).
  fire(r.row, 'click', { detail: 1, clientX: 180, clientY: 18 });
  fire(r.row, 'click', { detail: 1, shiftKey: true, clientX: 120, clientY: 18 });
  await settle();
  assert.equal(s.np.takeName, null);
  assert.equal(s.takes.selecting, false);
  assert.ok(!s.log.some((l) => /^(play|pause|player)/.test(l)));
  // Beside the wave, the row plays.
  fire(r.row, 'click', { detail: 1, clientX: 20, clientY: 18 });
  await settle();
  assert.equal(s.np.takeName, 'jam_b.wav');
});

test('a click on one of a row’s own controls keeps its press', async () => {
  const s = stage();
  const { rows } = rack(s);
  fire(rows.get('jam_b.wav').name, 'click', { detail: 1 });
  await settle();
  assert.equal(s.np.takeName, null);
});

test('with a selection on, a click on a row is left to select mode: nothing plays', async () => {
  const s = stage();
  const { rows } = rack(s, { selecting: true });
  fire(rows.get('jam_b.wav').row, 'click', { detail: 1, clientX: 10, clientY: 10 });
  await settle();
  assert.equal(s.np.takeName, null);
});

test('⇧-click on a row starts a selection with it', async () => {
  const s = stage();
  const { rows } = rack(s);
  fire(rows.get('jam_c.wav').row, 'click', { detail: 1, shiftKey: true, clientX: 10, clientY: 10 });
  await settle();
  assert.ok(s.takes.selecting);
  assert.deepEqual([...s.takes.selected], ['jam_c.wav']);
  assert.equal(s.np.takeName, null, 'it did not also play');
});

test('Enter and Space on a focused row play it; ⇧-Enter selects; while selecting they toggle', async () => {
  const s = stage();
  const { rows } = rack(s);
  const row = rows.get('jam_a.wav').row;
  const e = fire(row, 'keydown', { key: 'Enter' });
  await settle();
  assert.ok(e.defaultPrevented);
  assert.equal(s.np.takeName, 'jam_a.wav');
  fire(row, 'keydown', { key: ' ', shiftKey: true });
  assert.ok(s.takes.selecting);
  assert.deepEqual([...s.takes.selected], ['jam_a.wav']);
  fire(rows.get('jam_b.wav').row, 'keydown', { key: 'Enter' });
  assert.deepEqual([...s.takes.selected].sort(), ['jam_a.wav', 'jam_b.wav'], 'a key while selecting picks the row in');
  // A key inside the row's own control is that control's.
  s.takes.selecting = false;
  const before = s.log.length;
  fire(rows.get('jam_c.wav').name, 'keydown', { key: 'Enter' });
  await settle();
  assert.equal(s.log.length, before);
});

test('the finger going down on a row warms its player', () => {
  const s = stage();
  const { rows } = rack(s);
  fire(rows.get('jam_c.wav').wave, 'pointerdown', { button: 0 });
  assert.deepEqual(s.log, ['player jam_c.wav']);
});

// --- "Name it" -------------------------------------------------------------------------

test('with the rooms on, ?take=NAME is Open (where a take is named); off, it is the sheet’s', () => {
  assert.equal(askedTake({ rooms: true, search: '?take=jam_a.wav' }), '/wave.html?file=jam_a.wav');
  assert.equal(askedTake({ rooms: true, search: '?take=a%20b%26c.wav' }), '/wave.html?file=a%20b%26c.wav');
  assert.equal(askedTake({ rooms: true, search: '' }), null);
  assert.equal(askedTake({ rooms: false, search: '?take=jam_a.wav' }), null);
});

// --- the flight: after the sound, never before it, never waited for -------------------------

test('the flight is asked for after the sound is, and does not wait for the sound to be heard', async () => {
  const s = stage({ slow: true });
  const tapped = s.tap.tap('jam_a.wav');
  await new Promise((r) => setImmediate(r));
  // The sound is asked for, and the flight with it, while the player's answer is still to come.
  assert.deepEqual(s.log, ['player jam_a.wav', 'bar jam_a.wav', 'play jam_a.wav', 'fly jam_a.wav placed']);
  s.slowDone.shift()();
  assert.equal(await tapped, 'played');
});

test('a take already in the bar that plays again is resumed, not put on the deck: it does not fly', async () => {
  const s = stage();
  await s.tap.tap('jam_a.wav');
  await s.tap.tap('jam_a.wav'); // paused
  s.log.length = 0;
  await s.tap.tap('jam_a.wav'); // resumed
  assert.deepEqual(s.log, ['player jam_a.wav', 'bar jam_a.wav', 'play jam_a.wav', 'fly jam_a.wav resumed']);
});

test('a take that was in the bar from another page flies when it is tapped, and one that replaces another does too', async () => {
  const s = stage();
  await s.tap.tap('jam_a.wav');
  s.log.length = 0;
  await s.tap.tap('jam_b.wav');
  assert.ok(s.log.includes('fly jam_b.wav placed'));
});

test('a tap that pauses stops the flight', async () => {
  const s = stage();
  await s.tap.tap('jam_a.wav');
  s.log.length = 0;
  await s.tap.tap('jam_a.wav');
  assert.deepEqual(s.log, ['player jam_a.wav', 'bar jam_a.wav', 'pause jam_a.wav', 'stop jam_a.wav']);
});

test('a play the browser refused stops the flight: there is no sound for it to run beside', async () => {
  const s = stage({ refuse: true });
  assert.equal(await s.tap.tap('jam_a.wav'), 'played');
  assert.deepEqual(s.log.slice(-3), ['refused jam_a.wav', 'fly jam_a.wav placed', 'stop jam_a.wav']);
});

test('a flight that throws does not stop the tap: the take plays and the tap answers', async () => {
  const s = stage({ flyThrows: true });
  assert.equal(await s.tap.tap('jam_a.wav'), 'played');
  assert.equal(s.players.get('jam_a.wav').audio.paused, false);
});

test('a take that cannot play flies nothing', async () => {
  const s = stage({ encoding: ['a'] });
  assert.equal(await s.tap.tap('jam_a.wav'), 'encoding');
  assert.ok(!s.log.some((l) => l.startsWith('fly')));
});
