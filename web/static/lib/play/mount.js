// web/static/lib/play/mount.js
// Play mode's entry point on the tape page, and the per-device flag that
// decides whether it exists at all.
//
// This is a separate module loaded by tape.html rather than a change inside
// lib/tape/page.js, so Play mode can be read, reviewed and removed in one
// piece, and so a bug in it cannot take the tape page down with it.
//
// It learns what the tape is doing from one `hindsight:tape-state` event the
// page dispatches after each poll. That is the whole coupling: no imports
// from page.js, no reaching into its state.

import { Surface } from './surface.js';
import { bindKeyboard } from './keymap.js';
import { mountPlay } from './screen.js';
import { ticker } from '../objects/motion.js';
import { on, setOn } from './flag.js';
import { gridFrom, ringAt } from './clock.js';

// Re-exported so lib/play has one front door, while the flag itself stays in
// a module with no side effects (the Settings sheet reads it without starting
// Play mode).
export { on, setOn };

/**
 * start builds Play mode and returns a handle, or null when the flag is off.
 * Nothing is built and no listener is added while it is off, so a device that
 * has not asked for it pays nothing -- which is what lets this ship in every
 * release while two other people are testing the kit.
 */
export function start({ root = document.getElementById('play-mode'), doc = document } = {}) {
  if (!on() || !root) return null;

  const surface = new Surface({ bpm: 120, originMs: 0, division: '16th' });
  let ui = null;
  let tape = null;   // the last tape state the page sent
  let grid = null;   // the grid taken from it (clock.js)
  let unbindKeys = null;
  let unstep = null;

  const open = () => {
    if (ui) return;
    root.hidden = false;
    doc.body.classList.add('play-open');
    ui = mountPlay(root, surface, { onCommand: command });
    unbindKeys = bindKeyboard(surface, { onCommand: command });
    // The surface needs ticking for pads to land on their grid lines; the
    // shared ticker already runs a frame loop, so it does not need a second.
    // The ring is drawn here too, carried forward from the last poll, so it
    // sweeps every frame rather than in five steps a second.
    unstep = ticker.add(() => {
      const now = performance.now();
      surface.tick(now);
      ui?.setLoop(ringAt(tape, now));
      return !!ui;
    });
    ticker.start();
  };

  const close = () => {
    if (!ui) return;
    surface.releaseAll(performance.now()); // never leave a pad held behind us
    unbindKeys?.(); unbindKeys = null;
    unstep?.(); unstep = null;
    ui.destroy(); ui = null;
    root.hidden = true;
    doc.body.classList.remove('play-open');
  };

  function command(name) {
    if (name === 'exit') close();
    else if (name === 'transport') {
      // The page owns the transport; Play mode asks rather than reaching in.
      doc.dispatchEvent(new CustomEvent('hindsight:play-transport'));
    }
  }

  // What the tape is doing: the frame being heard and when the page heard
  // about it. clock.js turns that into the grid the pads land on -- the
  // tape's own bars, not a grid of Play mode's invention -- and the ring.
  const onState = (e) => {
    tape = e.detail || null;
    const g = gridFrom(tape, grid);
    if (g) { grid = g; surface.setGrid(g); }
  };
  doc.addEventListener('hindsight:tape-state', onState);

  return {
    open,
    close,
    get isOpen() { return !!ui; },
    destroy() {
      close();
      doc.removeEventListener('hindsight:tape-state', onState);
    },
  };
}

/**
 * enterButton is Play mode's own way in. It is made here rather than put in
 * tape.html so the whole feature lives in lib/play: with the flag off there
 * is no button, no listener and no markup, and removing the feature is
 * removing a directory.
 */
export function enterButton(onOpen, doc = document) {
  const b = doc.createElement('button');
  b.type = 'button';
  b.className = 'play-enter';
  b.textContent = 'Play';
  b.title = 'Play mode (preview)';
  b.addEventListener('click', onOpen);
  doc.body.appendChild(b);
  return b;
}

// Auto-start on the tape page. Everything above stays importable and
// testable; this is the only part that runs on load.
if (typeof document !== 'undefined' && document.getElementById('play-mode')) {
  const play = start();
  if (play) enterButton(() => play.open());
}
