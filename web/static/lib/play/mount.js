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

const FLAG = 'hindsight.play';

/** on says whether this device has Play mode turned on. */
export function on() {
  try { return localStorage.getItem(FLAG) === '1'; } catch { return false; }
}

/** setOn turns it on or off for this device. */
export function setOn(v) {
  try {
    if (v) localStorage.setItem(FLAG, '1');
    else localStorage.removeItem(FLAG);
  } catch { /* private mode: this session only, which is fine */ }
}

/**
 * start builds Play mode and returns a handle, or null when the flag is off.
 * Nothing is built and no listener is added while it is off, so a device that
 * has not asked for it pays nothing -- which is what lets this ship in every
 * release while two other people are testing the kit.
 */
export function start({ root = document.getElementById('play'), doc = document } = {}) {
  if (!on() || !root) return null;

  const surface = new Surface({ bpm: 120, originMs: 0, division: '16th' });
  let ui = null;
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
    unstep = ticker.add(() => { surface.tick(performance.now()); return !!ui; });
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

  // What the tape is doing. `bpm` and `origin_ms` set the grid the pads land
  // on, so they land on the tape's bars rather than on a grid of their own.
  const onState = (e) => {
    const s = e.detail || {};
    if (s.bpm || s.origin_ms != null) {
      surface.setGrid({ bpm: s.bpm || undefined, originMs: s.origin_ms ?? undefined });
    }
    ui?.setLoop({ frac: s.loop_frac || 0, bar: s.bar ?? null, bars: s.loop_bars ?? null });
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
if (typeof document !== 'undefined' && document.getElementById('play')) {
  const play = start();
  if (play) enterButton(() => play.open());
}
