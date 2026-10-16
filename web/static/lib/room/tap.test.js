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
function stage({ encoding = [], noPlayer = [] } = {}) {
  const log = [];
  const all = ['a', 'b', 'c'].map((n) => ({ name: `jam_${n}.wav`, label: n, has_preview: !encoding.includes(n) }));
  const players = new Map();
  const takes = {
    all,
    selecting: false,
    selected: new Set(),
    async player(name) {
      log.push(`player ${name}`);
      if (noPlayer.includes(name)) return null;
      if (!players.has(name)) {
        const audio = { paused: true };
        players.set(name, { audio, toggle: async () => { audio.paused = !audio.paused; log.push(`${audio.paused ? 'pause' : 'play'} ${name}`); } });
      }
      return players.get(name);
    },
    enterSelect(name) { this.selecting = true; this.selected = new Set(name ? [name] : []); log.push(`select ${name}`); },
    toggleSelected(name) { if (this.selected.has(name)) this.selected.delete(name); else this.selected.add(name); log.push(`toggle ${name}`); },
  };
  const np = {
    takeName: null,
    loadTake(t, p) { this.takeName = t.name; log.push(`bar ${t.name}`); this.player = p; },
  };
  const toasts = [];
  const picks = [];
  const tap = createTap({ takes, bar: () => np, toast: (m, k) => toasts.push([m, k]), pick: (n) => picks.push(n) });
  return { takes, np, tap, log, toasts, picks, players };
}

test('a tap puts the take in the bar and plays it', async () => {
  const s = stage();
  assert.equal(await s.tap.tap('jam_a.wav'), 'played');
  assert.deepEqual(s.log, ['player jam_a.wav', 'bar jam_a.wav', 'play jam_a.wav']);
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
  fire(rows.get('jam_b.wav').wave, 'click', { detail: 1 });
  await settle();
  assert.equal(s.np.takeName, 'jam_b.wav');
  assert.ok(s.log.includes('play jam_b.wav'));
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
  fire(rows.get('jam_b.wav').wave, 'click', { detail: 1 });
  await settle();
  assert.equal(s.np.takeName, null);
});

test('⇧-click on a row starts a selection with it', async () => {
  const s = stage();
  const { rows } = rack(s);
  fire(rows.get('jam_c.wav').wave, 'click', { detail: 1, shiftKey: true });
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
