// web/static/lib/room/doorway.test.js
// The Listening Room's doorway (lib/room/doorway.js), the real module mounted
// on takes.html's real markup, built on a stand-in document: a tap plays, a
// hold selects, the sheet is gone, tapes are not on the shelves, and the deck
// is a picture of the bar (docs/architecture/rooms.md, Vocabulary;
// the flow spec's F5a). The take list, its players, the bar and the Pi are stand-ins; the
// clock is the test's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { room, take, iso, MIN, NOW, click, roomDialogs, TAPES } from './harness.js';
import { GESTURE } from '../ui/press.js';

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

// A second tap later than a double tap's.
const apart = () => new Promise((res) => setTimeout(res, GESTURE.DOUBLE_MS + 30));

test('tapping it again pauses it', async () => {
  const r = await room();
  const b = r.spine('jam_a.wav');
  click(b); await r.settle();
  await apart();
  click(b); await r.settle();
  assert.deepEqual(r.log.filter((l) => /^(play|pause)/.test(l)), ['play jam_a.wav', 'pause jam_a.wav']);
  assert.equal(r.sheet.opened, 0);
  assert.deepEqual(r.w.navigated, [], 'two taps apart open nothing');
});

test('a double tap on a spine opens the take on its page, its first tap having started it', async () => {
  const r = await room();
  const b = r.spine('jam_b.wav');
  click(b); click(b);
  await r.settle(); await r.settle();
  assert.deepEqual(r.log.filter((l) => /^(play|pause)/.test(l)), ['play jam_b.wav'], 'it plays on into its page: the second tap does not pause it');
  assert.deepEqual(r.w.navigated, ['/wave.html?file=jam_b.wav']);
});

test('a double tap on the take already playing opens it playing, though its first tap paused it', async () => {
  const r = await room();
  const b = r.spine('jam_c.wav');
  click(b); await r.settle();
  await apart();
  click(b); click(b);
  await r.settle(); await r.settle();
  assert.deepEqual(r.log.filter((l) => /^(play|pause)/.test(l)), ['play jam_c.wav', 'pause jam_c.wav', 'play jam_c.wav']);
  assert.deepEqual(r.w.navigated, ['/wave.html?file=jam_c.wav']);
});

test('selecting, two quick taps are two picks, and open nothing', async () => {
  const r = await room({ selecting: true });
  const b = r.spine('jam_a.wav');
  click(b); click(b);
  await r.settle();
  assert.equal(r.list.selected.has('jam_a.wav'), false, 'in, then out');
  assert.deepEqual(r.w.navigated, []);
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

// --- the shelf wall (docs/architecture/rooms.md, "The library") -------------------

const MONTHS_AGO = (n, d = 10) => { const x = new Date(NOW); x.setDate(d); x.setMonth(x.getMonth() - n); return x.toISOString(); };
const shelves = (r) => r.doc.querySelectorAll('.room-shelf').map((s) => [s.dataset.shelf, s.querySelectorAll('.room-cassette').map((b) => b.dataset.key.slice(5))]);

test('the wall is a shelf per month, newest first, then ★, then a shelf per tag; a take stands on each it belongs to', async () => {
  const tags = [{ id: 'g1', name: 'riffs', color: 6 }];
  const takes = [
    take('a', { created: MONTHS_AGO(0, 2), starred: true }),
    take('b', { created: MONTHS_AGO(0, 1), tag: 'g1' }),
    take('c', { created: MONTHS_AGO(1, 5), tag: 'g1', starred: true }),
  ];
  const r = await room({ takes, tags });
  const key = (n) => { const d = new Date(MONTHS_AGO(n)); return `month:${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  assert.deepEqual(shelves(r), [[key(0), ['jam_a.wav', 'jam_b.wav']], [key(1), ['jam_c.wav']], ['starred', ['jam_a.wav', 'jam_c.wav']], ['tag:g1', ['jam_b.wav', 'jam_c.wav']]]);
  const plate = r.q('.room-shelf-starred .room-plate');
  assert.match(plate.textContent, /STARRED · 2/);
  assert.match(r.q('.room-shelf-tag .room-plate').textContent, /#RIFFS · 2/);
  for (const sec of r.doc.querySelectorAll('.room-shelf')) {
    assert.equal(sec.getAttribute('aria-labelledby'), sec.querySelector('.room-plate').id, 'each shelf is named by its plate');
    assert.ok(sec.querySelector('.room-all'), 'and has its All ›');
  }
  (await import('../tags.js')).tagStore.set([]);
});

test('the deck and the Sketchbook have left the room: no deck, no place on its floor, and ✎ on the bar still opens the notes', async () => {
  const r = await room({ barTake: 'jam_a.wav' });
  assert.equal(r.q('.room-deck'), null);
  assert.equal(r.q('.room-place'), null);
  assert.equal(r.q('.room-book-place'), null);
  assert.ok(r.q('.room-backdrop'), 'the drawn room is behind the wall');
  assert.equal(r.q('.room-backdrop').getAttribute('aria-hidden'), 'true', 'a picture, hidden from a screen reader');
  r.mounted.openSketchbook('jam_a.wav');
  assert.ok(r.doc.getElementById('room-sketchbook'), 'the engine’s ✎ (setOnNote) reaches the Sketchbook’s notes');
  assert.match(r.doc.getElementById('room-book-title').textContent, /^Sketchbook · a$/);
});

test('the room adds no Open of its own to the bar: the bar’s Open › opens a take, or the tape in the Studio', async () => {
  for (const r of [await room({ barTake: 'jam_a.wav' }), await room({ tapes: TAPES }), await room()]) {
    assert.equal(r.q('.room-sit'), null, 'one route in, not two');
    const open = r.doc.getElementById('np-open');
    assert.deepEqual(open.getAttribute('data-for').split(' '), ['take', 'away'], 'the bar’s own, for a take and for the tape away from the Studio');
  }
});

test('an empty wall says how a take gets onto it; a filter that hides everything says so, with Show everything', async () => {
  const e = await room({ takes: [] });
  assert.equal(e.q('.room-empty').hidden, false);
  assert.match(e.q('.room-empty').textContent, /KEEP in the Studio/);
  assert.equal(e.q('.room-filtered').hidden, true);
  const f = await room({ opts: { starred: true } });
  assert.equal(f.q('.room-filtered').hidden, false);
  assert.match(f.q('.room-filtered-text').textContent, /starred/);
  assert.equal(f.doc.querySelectorAll('.room-cassette').length, 0);
});

// --- All ›, Shelf | List, the search ------------------------------------------------------

test('a shelf’s All › opens the List to that shelf, on the stack; ‹ The room goes back to the wall', async () => {
  const takes = [take('a', { created: MONTHS_AGO(0) }), take('b', { created: MONTHS_AGO(1) }), take('c', { created: MONTHS_AGO(1, 3) })];
  const r = await room({ takes });
  const body = r.doc.body.classList;
  assert.equal(body.contains('room-rack'), false, 'a tablet starts on the wall');
  const last = r.doc.querySelectorAll('.room-shelf')[1];
  click(last.querySelector('.room-all'));
  await r.settle();
  assert.ok(body.contains('room-rack') && body.contains('room-drill'), 'the List shows');
  assert.deepEqual(r.listed(), ['jam_b.wav', 'jam_c.wav'], 'that month’s takes, and only those');
  assert.match(r.q('.room-rack-title').textContent, /· 2$/);
  assert.equal(r.q('.room-rack-back').hidden, false);
  assert.equal(r.layers.open.length, 1, 'on the page’s stack, so Back and Escape close it');

  click(r.q('.room-rack-back'));
  await r.settle();
  assert.equal(body.contains('room-rack'), false, 'back on the wall');
  assert.deepEqual(r.listed(), ['jam_a.wav', 'jam_b.wav', 'jam_c.wav'], 'the List’s filter is off again');
  assert.equal(r.layers.open.length, 0);

  click(last.querySelector('.room-all'));
  await r.settle();
  r.layers.top().close('back'); // the tablet's Back
  await r.settle();
  assert.equal(body.contains('room-rack'), false, 'Back goes back to the wall too');
});

test('Shelf | List switches the room and is remembered on this device; a phone starts on the List', async () => {
  const r = await room();
  const body = r.doc.body.classList;
  const key = (v) => r.doc.querySelector(`#shelf-view button[data-show="${v}"]`);
  assert.equal(key('shelf').getAttribute('aria-pressed'), 'true');
  click(key('list'));
  await r.settle();
  assert.ok(body.contains('room-rack'), 'the List shows');
  assert.equal(key('list').getAttribute('aria-pressed'), 'true');
  assert.equal(r.w.local.getItem('hindsight.library'), 'list', 'remembered');
  assert.equal(body.contains('room-drill'), false, 'the List itself: no way back to say, the switch is it');

  const again = await room({ stored: 'list' });
  assert.ok(again.doc.body.classList.contains('room-rack'), 'the next visit opens on the List');

  const phone = await room({ narrow: true });
  assert.ok(phone.doc.body.classList.contains('room-rack'), 'a phone’s library is the List');
  const wall = await room({ narrow: true, stored: 'shelf' });
  assert.equal(wall.doc.body.classList.contains('room-rack'), false, 'until the wall was picked on it');
});

test('the search opens the List with the field pinned, on the stack; Cancel empties it and goes back', async () => {
  const r = await room();
  const body = r.doc.body.classList;
  const field = r.doc.getElementById('shelf-q');
  field.dispatchEvent({ type: 'focus', target: field });
  assert.ok(body.contains('room-rack') && body.contains('room-search'), 'the List, searching');
  assert.equal(r.q('.room-search-done').hidden, false, 'Cancel shows');
  assert.equal(r.layers.open.length, 1);
  field.dispatchEvent({ type: 'input', target: field });
  assert.equal(r.layers.open.length, 1, 'once');

  click(r.q('.room-search-done'));
  assert.equal(body.contains('room-search'), false);
  assert.equal(body.contains('room-rack'), false, 'back on the wall it came from');
  assert.ok(r.log.includes('clear query'), 'the search is emptied');
  assert.equal(r.layers.open.length, 0);

  // From the List (a phone), Back after a search lands on the List.
  const p = await room({ narrow: true });
  const pf = p.doc.getElementById('shelf-q');
  pf.dispatchEvent({ type: 'input', target: pf });
  p.layers.top().close('back');
  assert.ok(p.doc.body.classList.contains('room-rack') && !p.doc.body.classList.contains('room-search'));
});

test('a shelf opened to the List is put away when the search is used, and the other way round', async () => {
  const r = await room();
  click(r.q('.room-all'));
  await r.settle();
  const field = r.doc.getElementById('shelf-q');
  field.dispatchEvent({ type: 'focus', target: field });
  await r.settle();
  assert.equal(r.layers.open.length, 1, 'one thing open: the search');
  assert.ok(r.doc.body.classList.contains('room-search'));
  assert.equal(r.log.at(-1), 'no filter', 'the shelf’s filter is off, so the search looks at every take');
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
// A tablet's room: the spines on the wall, the bar along the foot.
function laid(r) {
  for (const n of ['a', 'b', 'c']) r.spine(`jam_${n}.wav`).getBoundingClientRect = rect(100 + 46 * 'abc'.indexOf(n), 140, 44, 108);
  const np = r.doc.getElementById('np');
  np.hidden = false;
  np.getBoundingClientRect = rect(0, 640, 1024, 128);
  return r;
}

test('a tap on a spine plays at once and a cassette flies from the shelf to the bar beside the sound', async () => {
  const r = laid(await room());
  const b = r.spine('jam_b.wav');
  click(b);
  await r.settle();
  assert.ok(r.log.includes('play jam_b.wav'), 'it plays');
  assert.equal(r.ghosts().length, 1, 'and its cassette is in the air');
  assert.equal(r.spine('jam_b.wav').getAttribute('data-key'), 'take:jam_b.wav', 'the shelf’s own spine stays, ringed, as the control');
  assert.ok(r.spine('jam_b.wav').classList.contains('on-deck'), 'pulled out, a little proud of the row, at the tap');
  assert.equal(r.ghosts()[0].querySelector('.room-face-name').textContent, 'b', 'wearing the take’s name');
  r.run(1100);
  assert.equal(r.ghosts().length, 0, 'it lands, and nothing is left in the air');
  r.run(600);
  assert.equal(r.clock.timers.length, 0, 'and no timer, once the bar has settled');
  assert.equal(r.clock.raf.length, 0, 'no frame asked for');
});

test('the bar settles once as it lands, and not before', async () => {
  const r = laid(await room());
  const np = r.doc.getElementById('np');
  click(r.spine('jam_b.wav'));
  await r.settle();
  assert.equal(np.classList.contains('room-seat'), false);
  r.run(1100);
  assert.equal(np.classList.contains('room-seat'), true, 'seated');
  r.run(500);
  assert.equal(np.classList.contains('room-seat'), false, 'and settled: it does not stay lit');
  assert.equal(r.clock.timers.length, 0);
});

test('a take already in the bar that plays again does not fly again', async () => {
  const r = laid(await room());
  const b = r.spine('jam_b.wav');
  click(b); await r.settle(); // plays, flies
  r.run(1100);
  await apart();
  click(b); await r.settle(); // pauses
  await apart();
  click(b); await r.settle(); // resumes: it is in the bar already
  assert.ok(r.log.filter((l) => l === 'play jam_b.wav').length === 2, 'it played again');
  assert.equal(r.ghosts().length, 0, 'but nothing flew');
});

test('a tap that pauses takes the cassette out of the air', async () => {
  const r = laid(await room());
  const b = r.spine('jam_b.wav');
  click(b); await r.settle();
  r.run(300);
  assert.equal(r.ghosts().length, 1);
  await apart(); // a second tap, not half of a double (which would open the take)
  click(b); await r.settle();
  assert.equal(r.ghosts().length, 0);
  r.run(1100);
  assert.equal(r.doc.getElementById('np').classList.contains('room-seat'), false, 'it did not land');
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

test('a row of the List has no spine to fly from (the wall is behind it): it plays and nothing flies', async () => {
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

test('a tap while the bar is not on the screen plays and flies nothing', async () => {
  const r = laid(await room());
  r.doc.getElementById('np').hidden = true;
  click(r.spine('jam_a.wav')); await r.settle();
  assert.ok(r.log.includes('play jam_a.wav'));
  assert.equal(r.ghosts().length, 0);
});
