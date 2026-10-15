import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deskClick, release, dropSeed, remade } from './gesture.js';

// --- the click that ends a drag -----------------------------------------------------

test('the click a drop leaves behind is spent, not a tap on whatever rope is under the drop', () => {
  // Chrome sends the click to the common ancestor of where the press and the
  // let-go were: the desk, not a button, so the desk's handler sees it.
  assert.equal(deskClick({ suppress: true }, false), 'spent');
  // A rope under the drop point makes no difference: it is spent first.
  assert.equal(deskClick({ suppress: true }, true), 'spent');
});

test('a click with no drag behind it is a tap on a rope, unless it is on a control', () => {
  assert.equal(deskClick(null, false), 'rope');
  assert.equal(deskClick(undefined, false), 'rope');
  // A drag under way, or one that has not moved yet, is not a suppressed click.
  assert.equal(deskClick({ from: 'kit.tap.aux', moved: true }, false), 'rope');
  assert.equal(deskClick({ from: 'kit.tap.aux', moved: false }, false), 'rope');
  assert.equal(deskClick(null, true), 'control');
});

// --- letting go ----------------------------------------------------------------------

test('let go snapped into a socket the plug can go into, it is a patch', () => {
  assert.equal(release({ over: 'kit.track.3', from: 'kit.tap.aux', canPatch: true, holding: 'input:3', out: false, onSocket: true }), 'patch');
  // A new cable out of a bare socket, snapped to a target.
  assert.equal(release({ over: 'kit.track.1', from: 'kit.tap.ch1', canPatch: true, holding: null, out: false, onSocket: false }), 'patch');
});

test('a plug pulled out and let go in the open is unplugged', () => {
  assert.equal(release({ over: null, from: 'kit.tap.aux', canPatch: false, holding: 'input:3', out: true, onSocket: false }), 'unplug');
});

test('a plug pulled out and let go over a socket that cannot take it changes nothing', () => {
  // AUX's plug, let go over a device's input jack: a mis-drop, not a pull.
  assert.equal(release({ over: null, from: 'kit.tap.aux', canPatch: false, holding: 'input:3', out: true, onSocket: true }), 'nothing');
});

test('a plug let go in or near its own socket is not unplugged, whether it is out or not', () => {
  assert.equal(release({ over: null, from: 'kit.tap.aux', canPatch: false, holding: 'input:3', out: false, onSocket: false }), 'nothing');
  // Over its own button but past the pull: the button is a socket, so no.
  assert.equal(release({ over: null, from: 'kit.tap.aux', canPatch: false, holding: 'input:3', out: true, onSocket: true }), 'nothing');
  assert.equal(release({ over: 'kit.tap.aux', from: 'kit.tap.aux', canPatch: false, holding: 'input:3', out: false, onSocket: true }), 'nothing');
});

test('with nothing in the hand, letting go anywhere changes nothing', () => {
  assert.equal(release({ over: null, from: 'kit.tap.ch1', canPatch: false, holding: null, out: false, onSocket: false }), 'nothing');
  assert.equal(release({ over: null, from: 'kit.tap.ch1', canPatch: false, holding: null, out: true, onSocket: true }), 'nothing');
});

test('a drop the Pi would refuse by now is not a patch', () => {
  // The graph was re-read in the meantime and the write no longer exists.
  assert.equal(release({ over: 'kit.track.3', from: 'kit.tap.aux', canPatch: false, holding: null, out: false, onSocket: true }), 'nothing');
});

// --- a drop carries on from the rope in the hand ---------------------------------------

const pts = [{ x: 0, y: 0 }, { x: 5, y: 9 }, { x: 10, y: 20 }];
const dropped = { from: 'kit.tap.ch1', to: 'kit.track.4', points: pts };

test('a cable made by a drop starts from the rope that was in the hand', () => {
  assert.deepEqual(dropSeed(dropped, { from: 'kit.tap.ch1', to: 'kit.track.4' }), pts);
  // A cable that runs the other way starts from the same rope, end for end.
  assert.deepEqual(dropSeed(dropped, { from: 'kit.track.4', to: 'kit.tap.ch1' }), [...pts].reverse());
});

test('any other cable has no seed', () => {
  assert.equal(dropSeed(dropped, { from: 'kit.tap.main', to: 'kit.track.4' }), undefined);
  assert.equal(dropSeed(dropped, { from: 'kit.tap.ch1', to: 'kit.track.3' }), undefined);
  assert.equal(dropSeed(null, { from: 'kit.tap.ch1', to: 'kit.track.4' }), undefined);
  assert.equal(dropSeed({ ...dropped, points: null }, { from: 'kit.tap.ch1', to: 'kit.track.4' }), undefined);
});

test('a rope already there is made again when the drop re-patched it, and only then', () => {
  const c = { from: 'kit.tap.ch1', to: 'kit.track.4' };
  // Track 4 was cabled to MAIN; the drop moved its input to CH1: same id, new ends.
  assert.equal(remade({ from: 'kit.tap.main', to: 'kit.track.4' }, c, dropped), true);
  // The rope was made from the drop already: leave it be.
  assert.equal(remade({ from: 'kit.tap.ch1', to: 'kit.track.4' }, c, dropped), false);
  // Not the dropped cable: leave it be, whatever its ends did.
  assert.equal(remade({ from: 'kit.tap.main', to: 'kit.track.4' }, { from: 'kit.tap.main', to: 'kit.track.3' }, dropped), false);
  // No drop to carry on from, or no rope to remake.
  assert.equal(remade({ from: 'kit.tap.main', to: 'kit.track.4' }, c, null), false);
  assert.equal(remade(null, c, dropped), false);
  assert.equal(remade(undefined, c, dropped), false);
});

// --- the page uses them ---------------------------------------------------------------

// page.js can't run under node, so what it does with these is held to by
// reading it: a decision here is no use if the page stops asking.
test('page.js lets these calls decide, and no longer decides them itself', () => {
  const page = readFileSync(new URL('./page.js', import.meta.url), 'utf8');
  assert.match(page, /from '\.\/gesture\.js'/);
  assert.match(page, /deskClick\(state\.drag,/, 'the desk click asks whether it is spent');
  assert.match(page, /release\(\{[^}]*onSocket/, 'letting go says whether any socket is under the finger');
  assert.match(page, /remade\(obj\.state, c, drop\)/, 'a rope a drop re-patched is made again');
  assert.match(page, /dropSeed\(drop, c\)/);
  // The old inline test for a pulled-out plug, which didn't look at sockets.
  assert.ok(!/if \(d\.holding && d\.out\)/.test(page), 'the unplug test is release()');
});
