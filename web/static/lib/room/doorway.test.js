// web/static/lib/room/doorway.test.js
// The Listening Room's doorway (lib/room/doorway.js), the real module mounted
// on takes.html's real markup, built on a stand-in document: a tap plays, a
// hold selects, the sheet is gone, tapes are not on the shelves, and the deck
// is a picture of the bar (docs/superpowers/specs/2026-10-15-flow-design.md,
// F5a). The take list, its players, the bar and the Pi are stand-ins; the
// clock is the test's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { room, take, iso, MIN, click, roomDialogs, TAPES } from './harness.js';

// --- a tap plays -----------------------------------------------------------------

test('a tap on a spine plays the take through the bar, and no sheet opens', async () => {
  const r = await room();
  const b = r.spine('jam_b.wav');
  r.touch(b, "pointerdown"); r.touch(b, "pointerup"); click(b);
  await r.settle();
  assert.deepEqual(r.np.loads, ['jam_b.wav'], 'the take is in the bar');
  assert.ok(r.log.includes('play jam_b.wav'), 'and playing');
  assert.equal(r.sheet.opened, 0, 'nothing was opened');
  assert.deepEqual(roomDialogs(r), [], 'no sheet, no card, no question to answer');
});

test('tapping it again pauses it', async () => {
  const r = await room();
  const b = r.spine('jam_a.wav');
  click(b); await r.settle();
  click(b); await r.settle();
  assert.deepEqual(r.log.filter((l) => /^(play|pause)/.test(l)), ['play jam_a.wav', 'pause jam_a.wav']);
  assert.equal(r.sheet.opened, 0);
});

test('the finger going down warms the player, so the play is inside the tap', async () => {
  const r = await room();
  r.touch(r.spine('jam_c.wav'), 'pointerdown');
  await r.settle();
  assert.ok(r.players.has('jam_c.wav'), 'fetched at the press');
});

test('a spine says which take is in the bar and whether it plays, as the bar changes', async () => {
  const r = await room({ barTake: 'jam_a.wav' });
  const a = r.spine('jam_a.wav');
  assert.ok(a.classList.contains('on-deck'));
  assert.match(a.getAttribute('aria-label'), /in the bar/);
  assert.equal(a.getAttribute('aria-pressed'), 'false', 'in the bar, not playing');
  assert.equal(r.spine('jam_b.wav').classList.contains('on-deck'), false);
  r.doc.getElementById('np-play').classList.add('playing');
  r.tick();
  assert.equal(r.spine('jam_a.wav').getAttribute('aria-pressed'), 'true', 'playing');
  r.np.takeName = 'jam_b.wav'; // a tap on another take
  r.tick();
  assert.equal(r.spine('jam_a.wav').classList.contains('on-deck'), false);
  assert.ok(r.spine('jam_b.wav').classList.contains('on-deck'));
  assert.equal(r.spine('jam_b.wav').getAttribute('aria-pressed'), 'true');
});

// --- a hold selects ----------------------------------------------------------------

test('holding a spine selects it, and the lift does not also play it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const r = await room();
  const b = r.spine('jam_b.wav');
  r.touch(b, 'pointerdown');
  t.mock.timers.tick(500);
  assert.equal(r.list.selecting, true);
  assert.deepEqual([...r.list.selected], ['jam_b.wav']);
  assert.ok(b.classList.contains('selected'), 'the spine shows it');
  assert.equal(b.getAttribute('aria-pressed'), 'true');
  r.touch(b, 'pointerup'); click(b);
  assert.deepEqual(r.np.loads, [], 'it did not play');
  assert.deepEqual([...r.list.selected], ['jam_b.wav']);
});

test('with a selection on, a tap on a spine picks it in and out, and nothing plays', async () => {
  const r = await room();
  r.list.enterSelect('jam_a.wav');
  const c = r.spine('jam_c.wav');
  click(c);
  assert.deepEqual([...r.list.selected].sort(), ['jam_a.wav', 'jam_c.wav']);
  assert.ok(c.classList.contains('selected'));
  click(r.spine('jam_a.wav'));
  assert.deepEqual([...r.list.selected], ['jam_c.wav']);
  assert.equal(r.spine('jam_a.wav').classList.contains('selected'), false);
  assert.deepEqual(r.np.loads, []);
});

test('⇧-click starts a selection (a mouse’s way in); a mouse’s press never holds', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const r = await room();
  const b = r.spine('jam_a.wav');
  r.touch(b, 'pointerdown', { pointerType: 'mouse' });
  t.mock.timers.tick(5000);
  assert.equal(r.list.selecting, false);
  r.touch(b, 'pointerup', { pointerType: 'mouse' });
  click(b, { shiftKey: true });
  assert.equal(r.list.selecting, true);
  assert.deepEqual([...r.list.selected], ['jam_a.wav']);
});

test('⇧-click during a selection picks the take in or out, as a tap does: it does not start a new selection', async () => {
  const r = await room();
  r.list.enterSelect('jam_a.wav');
  click(r.spine('jam_b.wav'), { shiftKey: true });
  assert.deepEqual([...r.list.selected].sort(), ['jam_a.wav', 'jam_b.wav']);
  click(r.spine('jam_a.wav'), { shiftKey: true });
  assert.deepEqual([...r.list.selected], ['jam_b.wav']);
});

test('a finger that is cancelled or leaves the spine before the hold is up selects nothing', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const ev of ['pointercancel', 'pointerleave']) {
    const r = await room();
    const b = r.spine('jam_a.wav');
    r.touch(b, 'pointerdown');
    t.mock.timers.tick(300);
    r.touch(b, ev);
    t.mock.timers.tick(1000);
    assert.equal(r.list.selecting, false, `${ev} ends the hold`);
  }
});

// What the page tells the room when its list changes (a poll that brought a take, a
// rename, a tag): the shelves are drawn again, but never for a poll that changed
// nothing -- a rebuild under a finger loses the lift that must not play.
test('a change in the list draws the shelf again', async () => {
  const r = await room();
  assert.equal(r.spine('jam_d.wav'), null);
  r.list.all = [...r.list.all, take('d')];
  r.changed();
  assert.ok(r.spine('jam_d.wav'), 'the new take stands on the shelf');
  r.list.all = r.list.all.filter((x) => x.name !== 'jam_a.wav');
  r.changed();
  assert.equal(r.spine('jam_a.wav'), null, 'and a take that has gone is off it');
});

test('a poll that changed nothing leaves the very spines that are there', async () => {
  const r = await room();
  const before = r.spine('jam_b.wav');
  r.changed();
  r.changed();
  assert.ok(r.spine('jam_b.wav') === before, 'the same button, not a rebuilt one');
  r.list.all = r.list.all.map((x) => (x.name === 'jam_b.wav' ? { ...x, label: 'renamed' } : x));
  r.changed();
  assert.ok(r.spine('jam_b.wav') !== before, 'a change does rebuild it');
});

test('a rebuild gives the focus back to the spine that had it', async () => {
  const r = await room();
  r.spine('jam_c.wav').focus();
  assert.ok(r.doc.activeElement === r.spine('jam_c.wav'));
  r.list.all = r.list.all.map((x) => (x.name === 'jam_b.wav' ? { ...x, label: 'renamed' } : x));
  r.changed();
  assert.ok(r.doc.activeElement === r.spine('jam_c.wav'), 'a keyboard user is not dropped on the page');
});

test('a selection made elsewhere (the List, Select) shows on the spines, and Done clears them', async () => {
  const r = await room();
  r.list.enterSelect('jam_b.wav');
  r.list.toggleSelected('jam_c.wav');
  assert.deepEqual(['jam_a.wav', 'jam_b.wav', 'jam_c.wav'].map((n) => r.spine(n).classList.contains('selected')), [false, true, true]);
  r.list.exitSelect();
  assert.deepEqual(['jam_a.wav', 'jam_b.wav', 'jam_c.wav'].map((n) => r.spine(n).classList.contains('selected')), [false, false, false]);
  assert.equal(r.spine('jam_b.wav').getAttribute('aria-pressed'), 'false');
});

test('the long-press menu is held back while a finger is on a spine', async () => {
  const r = await room();
  const b = r.spine('jam_a.wav');
  const seen = [];
  r.touch(b, 'pointerdown');
  b.dispatchEvent({ type: 'contextmenu', target: b, preventDefault() { seen.push('prevented'); } });
  assert.deepEqual(seen, ['prevented']);
});

// --- no sheet ------------------------------------------------------------------------

test('the room makes no sheet, card, PUT IT ON, TO THE STUDIO, Play all from here or Swap it', async () => {
  const r = await room();
  const words = [...r.doc.documentElement.descendants()].filter((e) => e.tagName === 'BUTTON' || e.tagName === 'A').map((e) => e.textContent);
  for (const gone of [/PUT IT ON/, /TO THE STUDIO/, /Play all from here/, /Swap it/, /Leave it/, /SIT DOWN/i, /Sit down/, /Back on the shelf/]) {
    assert.ok(!words.some((w) => gone.test(w)), `${gone} is on the page`);
  }
  assert.deepEqual(roomDialogs(r), []);
  assert.equal(r.sheet.opened, 0);
});

// --- tapes are not on the shelves ----------------------------------------------------


test('no tapes on the shelves, whatever the Pi lists; their bounces stand there as takes', async () => {
  const takes = [
    take('b1', { origin: 'tape', tape_id: 't1', label: 'Tuesday groove', created: iso(3 * MIN) }),
    take('b2', { origin: 'tape', tape_id: 't1', label: 'Tuesday groove', created: iso(2 * MIN) }),
    take('k', { created: iso(1 * MIN) }),
  ];
  const r = await room({ takes, tapes: TAPES });
  assert.equal(r.q('.room-shelf-tapes'), null, 'no TAPES shelf');
  assert.equal(r.doc.querySelectorAll('[data-key^="tape:"]').length, 0, 'no tape spine');
  assert.equal(r.doc.querySelectorAll('.room-reel').length, 0);
  const spines = r.doc.querySelectorAll('.room-cassette');
  assert.deepEqual(spines.map((b) => b.dataset.key), ['take:jam_k.wav', 'take:jam_b2.wav'], 'the bounces are takes, folded into the newest');
  assert.match(r.spine('jam_b2.wav').getAttribute('aria-label'), /Tuesday groove/);
  assert.ok(r.spine('jam_b2.wav').querySelector('.room-fam'), 'its earlier bounce is its sticker');
});

// --- the deck is a picture of the bar --------------------------------------------------

test('the deck has no keys: nothing on it plays, puts on or sits down, and its one control is Open', async () => {
  const r = await room({ barTake: 'jam_a.wav' });
  const deck = r.q('.room-deck');
  assert.equal(deck.querySelectorAll('.room-deck-keys, .room-deck-play, .room-deck-sit').length, 0);
  assert.deepEqual(deck.querySelectorAll('button, a').map((e) => e.className), ['room-place room-deck-place']);
});

test('the deck follows the bar: empty, then a take in it, playing, how far, then another', async () => {
  const r = await room();
  const place = () => r.q('.room-deck-place').textContent;
  assert.equal(place(), 'The bar · empty');
  assert.ok(r.q('.room-deck').classList.contains('empty'));
  assert.equal(r.q('.room-deck-lcd').textContent, '--:--');

  r.np.takeName = 'jam_b.wav';
  r.doc.getElementById('position').textContent = '0:30';
  r.doc.getElementById('np-scrub').setAttribute('aria-valuemax', '120');
  r.doc.getElementById('np-scrub').setAttribute('aria-valuenow', '30');
  r.tick();
  assert.equal(place(), 'In the bar: b');
  assert.equal(r.q('.room-deck').classList.contains('empty'), false);
  assert.equal(r.q('.room-deck').classList.contains('playing'), false);
  assert.equal(r.q('.room-deck-lcd').textContent, '0:30');
  assert.equal(r.q('.room').style['--room-played'], '0.2500', 'how far it has got');
  assert.equal(r.q('.room-deck-meta').textContent, 'take · 1:59');

  r.doc.getElementById('np-play').classList.add('playing');
  r.tick();
  assert.ok(r.q('.room-deck').classList.contains('playing'), 'its reels turn while the bar plays');
  assert.equal(r.q('.room-deck-meta').textContent, 'take · 1:59 · playing');

  r.np.takeName = 'jam_c.wav'; // a tap on another take, or a take carried from another page
  r.tick();
  assert.equal(place(), 'In the bar: c');
  r.doc.getElementById('np-play').classList.remove('playing');
  r.tick();
  assert.equal(r.q('.room-deck').classList.contains('playing'), false);
});

test('with a tape loaded and no take in the bar, the deck is the tape the bar holds', async () => {
  const r = await room({ tapes: TAPES });
  assert.equal(r.q('.room-deck-place').textContent, 'In the bar: Tuesday groove');
  assert.equal(r.q('.room-deck-meta').textContent, 'tape · in the Studio');
});

test('tapping the deck is Open: a take opens its page; a tape opens in the Studio, saying it is for the tape', async () => {
  const a = await room({ barTake: 'jam_a.wav' });
  click(a.q('.room-deck-place'));
  assert.deepEqual(a.w.navigated, ['/wave.html?file=jam_a.wav']);
  assert.equal(a.np.loads.length, 0, 'it opened; it did not play');

  const t = await room({ tapes: TAPES });
  click(t.q('.room-deck-place'));
  assert.deepEqual(t.w.navigated, ['/tape.html']);
  const rec = JSON.parse(t.w.session.getItem('hindsight.bar.carry'));
  assert.equal(rec.for, 'tape', 'so the bar’s take does not go along (F4)');
});

test('tapping an empty deck goes nowhere: it points at the shelf', async () => {
  const r = await room();
  click(r.q('.room-deck-place'));
  assert.deepEqual(r.w.navigated, []);
});

test('the dock’s Open is for the tape, to the Studio: a take in the bar opens by its name, so the dock stands down', async () => {
  const r = await room({ barTake: 'jam_a.wav' });
  const dock = r.q('.room-sit');
  assert.equal(dock.hidden, true, 'the bar’s own name is the way into a take: one route, not two');
  r.np.takeName = 'jam_c.wav';
  r.tick();
  assert.equal(dock.hidden, true);

  const t = await room({ tapes: TAPES });
  assert.equal(t.q('.room-sit').textContent, 'Open');
  assert.equal(t.q('.room-sit').hidden, false);
  assert.equal(t.q('.room-sit').getAttribute('href'), '/tape.html');
  click(t.q('.room-sit'));
  assert.equal(JSON.parse(t.w.session.getItem('hindsight.bar.carry')).for, 'tape');

  const e = await room();
  assert.equal(e.q('.room-sit').hidden, true, 'nothing in the bar: nothing to open');
});

test('the sketchbook strip says Open in its name, as the deck and the dock do, and keeps its visible word in it', async () => {
  const r = await room({ barTake: 'jam_a.wav' });
  const b = r.q('.room-book-place');
  assert.match(b.getAttribute('aria-label'), /^Open the sketchbook: 0 notes on a/);
  assert.match(b.textContent, /Sketchbook/);
  assert.match(b.getAttribute('aria-label').toLowerCase(), /sketchbook/, 'the visible word is in the accessible name');
  const e = await room();
  assert.doesNotMatch(e.q('.room-book-place').getAttribute('aria-label'), /^Open/, 'nothing in the bar: nothing to open');
});

test('the sketchbook never takes you to the Studio: with the tape in the bar it stays in the room', async () => {
  const t = await room({ tapes: TAPES });
  click(t.q('.room-book-place'));
  assert.deepEqual(t.w.navigated, [], 'no navigation');
  assert.doesNotMatch(t.q('.room-book-place').getAttribute('aria-label'), /^Open/);
});

// --- the List's rows and the select bar ----------------------------------------------

test('the List’s rows play on a tap too: a row of the rack is wired as a spine is', async () => {
  const r = await room();
  const rack = r.doc.getElementById('takes');
  const row = r.doc.createElement('article');
  row.className = 'take spine';
  row.dataset.name = 'jam_c.wav';
  const wave = r.doc.createElement('div');
  wave.className = 'wave';
  row.append(wave);
  rack.append(row);
  rack.dispatchEvent({ type: 'click', target: row, detail: 1, clientX: 10, clientY: 10 });
  await r.settle();
  assert.deepEqual(r.np.loads, ['jam_c.wav']);
  assert.ok(r.log.includes('pick jam_c.wav'), 'and picked, so Play all goes on from it');
  assert.equal(r.sheet.opened, 0);
});

test('the select bar gets Tag, which is on only while something is selected', async () => {
  const r = await room();
  const bar = r.doc.getElementById('select-bar');
  assert.deepEqual(bar.querySelectorAll('button').map((b) => b.id), ['sel-done', 'sel-star', 'sel-tag', 'sel-export', 'sel-delete']);
  const tag = bar.querySelector('#sel-tag');
  assert.equal(tag.disabled, true);
  r.list.enterSelect('jam_a.wav');
  assert.equal(tag.disabled, false, 'the room’s selection hook turns it on');
  r.list.exitSelect();
  assert.equal(tag.disabled, true);
});

// --- Name it -----------------------------------------------------------------------------

test('?take=NAME (a toast’s Name it) goes to Open, where a take is named; the room does not draw first', async () => {
  const r = await room({ search: '?take=jam_a.wav' });
  assert.deepEqual(r.w.navigated, ['replace /wave.html?file=jam_a.wav']);
  assert.equal(r.q('.room'), null, 'nothing was drawn for a page that is leaving');
});

// --- the flight: the sound at the tap, the cassette alongside ---------------------------------

const rect = (x, y, w, h) => () => ({ left: x, top: y, width: w, height: h, right: x + w, bottom: y + h });
// A laptop's room: the spines on the shelf to the right, the deck's art to the left.
function laid(r) {
  for (const n of ['a', 'b', 'c']) r.spine(`jam_${n}.wav`).getBoundingClientRect = rect(1000 + 40 * 'abc'.indexOf(n), 330, 30, 112);
  r.q('.room-deck-art').getBoundingClientRect = rect(300, 380, 200, 190);
  return r;
}

test('a tap on a spine plays at once and a cassette flies from the shelf to the deck beside the sound', async () => {
  const r = laid(await room());
  const b = r.spine('jam_b.wav');
  click(b);
  await r.settle();
  assert.ok(r.log.includes('play jam_b.wav'), 'it plays');
  assert.equal(r.ghosts().length, 1, 'and its cassette is in the air');
  assert.equal(r.spine('jam_b.wav').getAttribute('data-key'), 'take:jam_b.wav', 'the shelf’s own spine stays, ringed, as the control');
  assert.ok(r.spine('jam_b.wav').classList.contains('on-deck'));
  assert.equal(r.ghosts()[0].querySelector('.room-face-name').textContent, 'b', 'wearing the take’s name');
  r.run(1100);
  assert.equal(r.ghosts().length, 0, 'it lands, and nothing is left in the air');
  r.run(600);
  assert.equal(r.clock.timers.length, 0, 'and no timer, once the deck has settled');
  assert.equal(r.clock.raf.length, 0, 'no frame asked for');
});

test('the deck settles once as it lands, and not before', async () => {
  const r = laid(await room());
  click(r.spine('jam_b.wav'));
  await r.settle();
  assert.equal(r.q('.room-deck').classList.contains('room-seat'), false);
  r.run(1100);
  assert.equal(r.q('.room-deck').classList.contains('room-seat'), true, 'seated');
  r.run(500);
  assert.equal(r.q('.room-deck').classList.contains('room-seat'), false, 'and settled: it does not stay lit');
  assert.equal(r.clock.timers.length, 0);
});

test('a take already in the bar that plays again is not put on the deck again: no flight', async () => {
  const r = laid(await room());
  const b = r.spine('jam_b.wav');
  click(b); await r.settle(); // plays, flies
  r.run(1100);
  click(b); await r.settle(); // pauses
  click(b); await r.settle(); // resumes: it is on the deck already
  assert.ok(r.log.filter((l) => l === 'play jam_b.wav').length === 2, 'it played again');
  assert.equal(r.ghosts().length, 0, 'but nothing flew');
});

test('a tap that pauses takes the cassette out of the air', async () => {
  const r = laid(await room());
  const b = r.spine('jam_b.wav');
  click(b); await r.settle();
  r.run(300);
  assert.equal(r.ghosts().length, 1);
  click(b); await r.settle();
  assert.equal(r.ghosts().length, 0);
  r.run(1100);
  assert.equal(r.q('.room-deck').classList.contains('room-seat'), false, 'it did not land');
});

test('a tap on another take mid-flight flies that one instead, from its own spine', async () => {
  const r = laid(await room());
  click(r.spine('jam_a.wav')); await r.settle();
  r.run(300);
  click(r.spine('jam_c.wav')); await r.settle();
  assert.equal(r.ghosts().length, 1);
  assert.equal(r.ghosts()[0].querySelector('.room-face-name').textContent, 'c');
});

test('with reduced motion nothing flies, and the sound plays all the same', async () => {
  const r = laid(await room());
  r.w.reducedMotion = true;
  click(r.spine('jam_b.wav')); await r.settle();
  assert.ok(r.log.includes('play jam_b.wav'));
  assert.equal(r.ghosts().length, 0);
  assert.equal(r.clock.timers.length, 0);
});

test('a row of the List has no spine to fly from (the room is behind it): it plays and nothing flies', async () => {
  const r = laid(await room());
  r.spine('jam_c.wav').getBoundingClientRect = rect(0, 0, 0, 0); // display: none, under the List
  const row = r.doc.createElement('article');
  row.className = 'take spine';
  row.dataset.name = 'jam_c.wav';
  r.h.rack.append(row);
  r.h.rack.dispatchEvent({ type: 'click', target: row, detail: 1, clientX: 10, clientY: 10 });
  await r.settle();
  assert.ok(r.log.includes('play jam_c.wav'));
  assert.equal(r.ghosts().length, 0);
});

test('on a phone, where there is no deck, the cassette flies to the bar', async () => {
  const r = laid(await room());
  r.q('.room-deck-art').getBoundingClientRect = rect(0, 0, 0, 0); // display: none
  const np = r.doc.getElementById('np');
  np.hidden = false;
  np.getBoundingClientRect = rect(0, 738, 390, 106);
  click(r.spine('jam_a.wav')); await r.settle();
  assert.equal(r.ghosts().length, 1, 'it flies to the bar');
  r.run(1100);
  assert.equal(np.classList.contains('room-seat'), true, 'the bar is where it lands');
  assert.equal(r.q('.room-deck').classList.contains('room-seat'), false);
});

test('a tap while no deck and no bar is on the screen plays and flies nothing', async () => {
  const r = laid(await room());
  r.q('.room-deck-art').getBoundingClientRect = rect(0, 0, 0, 0);
  r.doc.getElementById('np').hidden = true;
  click(r.spine('jam_a.wav')); await r.settle();
  assert.ok(r.log.includes('play jam_a.wav'));
  assert.equal(r.ghosts().length, 0);
});

test('the deck is drawn from the bar at the tap, not at the next look', async () => {
  const r = laid(await room());
  click(r.spine('jam_b.wav')); await r.settle();
  assert.equal(r.q('.room-deck-place').textContent, 'In the bar: b', 'before any interval has run');
});
