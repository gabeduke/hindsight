// web/static/lib/play/fx.js
// The punch-in FX on the instrument strip (docs/superpowers/specs/2026-10-15-punch-in-fx-design.md),
// drawn into the place P3 left for them (screen.js, slot('fx')):
//
//   - ROLL, FILTER, ECHO and CRUSH as pads, held like the tricks and played
//     by every hand the strip has -- T Y U I, a touch, notes 46–49 on a
//     controller. Each shows its amount: what it does at it (1/16, 2.0 kHz,
//     send 50 %, 8 bits) and a meter. A finger held on one moves it by
//     sliding up or down; the mod wheel and aftertouch move it too, and every
//     screen draws it from the Pi's word (amounts.js).
//   - the bend: a strip a finger drags left or right, springing back to the
//     centre when it lifts, as the pitch wheel does.
//
// In a mixdown the FX wait: it prints the tape and its mods, never what's
// held. The group says so while one plays.

import { FX_PADS, amountText } from './controls.js';
import { ARMED, ON } from './surface.js';

/** SLIDE_PX: a finger sliding this far on a held pad moves its amount end to end. */
export const SLIDE_PX = 140;

/** BEND_PX: dragging the bend strip this far from where it was touched is a full bend. */
export const BEND_PX = 120;

/** slideAmount is a held pad's amount after a slide of `dy` px (up is more). */
export function slideAmount(v0, dy, px = SLIDE_PX) {
  return Math.max(0, Math.min(1, v0 - dy / px));
}

/** bendAmount is the bend after a drag of `dx` px from where it was touched. */
export function bendAmount(dx, px = BEND_PX) {
  return Math.max(-1, Math.min(1, dx / px));
}

/**
 * mountFX draws the FX into the strip `ui` (screen.js), their pads played on
 * `surface` and their amounts in `amounts`. onBend(v) moves the bend from
 * the strip, onBendEnd() lets it go.
 */
export function mountFX(ui, surface, amounts, {
  doc = globalThis.document, onBend = () => {}, onBendEnd = () => {},
} = {}) {
  const slot = ui.slot('fx');
  if (!slot) return null;
  const el = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const offs = [];
  const group = el('section', 'play-group play-fx-group');
  group.append(el('h3', 'play-group-title', 'Punch-in FX · held, with an amount'));
  const grid = el('div', 'play-fx');
  group.append(grid);

  const shown = new Map(); // id → {text, fill}
  for (const id of FX_PADS) {
    const b = ui.addPad(grid, id, 'play-fx-pad');
    b.dataset.tip = 'play-fx';
    const text = el('span', 'play-fx-amt');
    const meter = el('span', 'play-meter');
    const fill = el('i');
    meter.append(fill);
    b.querySelector('.play-face').after(text);
    b.append(meter);
    shown.set(id, { text, fill });
    // A finger on a held pad slides its amount: up is more.
    let slide = null;
    const down = (e) => { slide = { id: e.pointerId, y: e.clientY, v: amounts.get(id) }; };
    const move = (e) => {
      if (!slide || slide.id !== e.pointerId) return;
      const s = surface.state(id);
      if (s !== ARMED && s !== ON) return;
      const v = slideAmount(slide.v, e.clientY - slide.y);
      if (v !== amounts.get(id)) amounts.move(id, v);
    };
    const up = () => { slide = null; };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointermove', move);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    offs.push(() => {
      b.removeEventListener('pointerdown', down);
      b.removeEventListener('pointermove', move);
      b.removeEventListener('pointerup', up);
      b.removeEventListener('pointercancel', up);
    });
  }

  // The bend: dragged, and back to the centre when let go.
  const bend = el('div', 'play-bend');
  bend.setAttribute('role', 'slider');
  bend.setAttribute('aria-label', 'Bend: drag left or right to nudge the speed; it springs back');
  bend.setAttribute('aria-valuemin', '-8');
  bend.setAttribute('aria-valuemax', '8');
  bend.setAttribute('aria-valuenow', '0');
  bend.dataset.tip = 'play-bend';
  const bendName = el('span', 'play-bend-name', 'Bend');
  const track = el('span', 'play-bend-track');
  const bendFill = el('i');
  track.append(el('b'), bendFill);
  const bendText = el('span', 'play-bend-val', amountText('bend', 0));
  bend.append(bendName, track, bendText);
  group.append(bend);
  let drag = null;
  const bdown = (e) => {
    e.preventDefault();
    try { bend.setPointerCapture?.(e.pointerId); } catch { /* not all pointers */ }
    drag = { id: e.pointerId, x: e.clientX, on: false };
  };
  const bmove = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    const v = bendAmount(e.clientX - drag.x);
    if (!drag.on && Math.abs(v) < 0.02) return;
    drag.on = true;
    onBend(v);
  };
  const bup = (e) => {
    if (!drag || drag.id !== e.pointerId) return;
    try { bend.releasePointerCapture?.(e.pointerId); } catch { /* already gone */ }
    if (drag.on) onBendEnd();
    drag = null;
  };
  bend.addEventListener('pointerdown', bdown);
  bend.addEventListener('pointermove', bmove);
  bend.addEventListener('pointerup', bup);
  bend.addEventListener('pointercancel', bup);
  offs.push(() => {
    bend.removeEventListener('pointerdown', bdown);
    bend.removeEventListener('pointermove', bmove);
    bend.removeEventListener('pointerup', bup);
    bend.removeEventListener('pointercancel', bup);
  });

  const note = el('p', 'play-fx-note');
  note.hidden = true;
  note.setAttribute('role', 'status');
  group.append(note);

  slot.replaceChildren(group);
  slot.hidden = false;

  const draw = (id, v) => {
    if (id === 'bend') {
      const pct = Math.round(v * 50);
      bendFill.style.left = `${50 + Math.min(0, pct)}%`;
      bendFill.style.width = `${Math.abs(pct)}%`;
      bendText.textContent = amountText('bend', v);
      bend.setAttribute('aria-valuenow', (v * 8).toFixed(1));
      return;
    }
    const s = shown.get(id);
    if (!s) return;
    s.text.textContent = amountText(id, v);
    s.fill.style.width = `${Math.round(v * 100)}%`;
  };
  for (const id of [...FX_PADS, 'bend']) draw(id, amounts.get(id));
  offs.push(amounts.on((id, v) => draw(id, v)));

  return {
    group,
    /** setMixdown says the FX wait while a mixdown plays. */
    setMixdown(on) {
      group.classList.toggle('play-fx-waiting', !!on);
      note.textContent = on ? 'A mixdown is playing: the FX wait. It prints the tape and its mods, never what’s held.' : '';
      note.hidden = !on;
    },
    /** setBend lights the bend while any hand holds it. */
    setBend(on) { bend.classList.toggle('on', !!on); },
    destroy() {
      for (const off of offs) off();
      slot.replaceChildren();
      slot.hidden = true;
    },
  };
}
