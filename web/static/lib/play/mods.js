// web/static/lib/play/mods.js
// The tape mods on the instrument strip (docs/superpowers/specs/2026-10-15-punch-in-fx-design.md),
// drawn into the place P3 left for them (screen.js, slot('mods')): the
// formula -- CLEAN, CHROME, FERRIC, WORN -- and four knobs, WOW, FLUTTER,
// DRIVE and AGE.
//
// Unlike the tricks and the FX they belong to the tape: saved in it, and
// undone like any edit. So a knob is one step of undo per gesture, not per
// value:
//   - dragged on screen, it is heard as it moves (a preview over the play
//     socket, saved nowhere) and saved once, when the finger lifts;
//   - stepped with the keys, it is saved once the keys have been still a
//     moment;
//   - turned on a controller plugged into this computer, once it has been
//     still for a second. (A controller in the Pi does the same there.)
//
// Every screen draws what the tape says, and another hand's preview while
// it's moving (amounts.js).

import { MODS, FORMULAS, control, bindingLabel, styleField, amountText } from './controls.js';
import { say } from '../rooms/words.js';

/** KNOB_PX: a drag this far up or down turns a knob end to end. */
export const KNOB_PX = 150;

/** KEYS_QUIET_MS: how long the keys are still before a knob they turned is saved. */
export const KEYS_QUIET_MS = 700;

/** TURN_QUIET_MS: how long a controller's knob is still before it's saved. */
export const TURN_QUIET_MS = 1000;

/** PREVIEW_MS: another hand's preview outranks the tape's value this long. */
export const PREVIEW_MS = 1500;

/** knobAngle is where a knob's pointer stands at v: -135° to 135°. */
export const knobAngle = (v) => -135 + 270 * Math.max(0, Math.min(1, v));

/** knobDrag is a knob's value after a drag of `dy` px from v0 (up is more). */
export const knobDrag = (v0, dy, px = KNOB_PX) => Math.max(0, Math.min(1, v0 - dy / px));

/** formulaOf is the formula a tape's style reads as; a tape with none is clean. */
export const formulaOf = (style) => (style && style.formula) || 'clean';

/** knobStep is a key's step on a knob, or null for a key that isn't one. */
export function knobStep(key, shift = false) {
  const fine = shift ? 0.01 : 0.05;
  switch (key) {
    case 'ArrowUp': case 'ArrowRight': return { by: fine };
    case 'ArrowDown': case 'ArrowLeft': return { by: -fine };
    case 'PageUp': return { by: 0.25 };
    case 'PageDown': return { by: -0.25 };
    case 'Home': return { to: 0 };
    case 'End': return { to: 1 };
    default: return null;
  }
}

/**
 * mountMods draws the mods into `slot` with their values in `amounts`. The
 * strip saves them: onCommit(mod, v) when a gesture ends, onFormula(name)
 * for a formula. A knob moving is previewed through amounts.move, which the
 * strip sends to the Pi as a `set`.
 */
export function mountMods(slot, amounts, {
  doc = globalThis.document, onCommit = () => {}, onFormula = () => {},
  now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout,
} = {}) {
  if (!slot) return null;
  const el = (tag, cls, text) => {
    const n = doc.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const offs = [];
  const timers = new Map();   // mod → its save, waiting for the knob to be still
  const saving = new Set();   // mods saved and not yet heard back
  const previewed = new Map(); // mod → when another hand's preview was last heard
  let style = null;

  const group = el('section', 'play-group play-mods-group');
  group.append(el('h3', 'play-group-title', 'Tape mods · latched'));
  const formulas = el('div', 'play-formulas');
  formulas.setAttribute('role', 'radiogroup');
  formulas.setAttribute('aria-label', 'Tape formula');
  const fbtn = new Map();
  for (const name of FORMULAS) {
    const b = el('button', 'play-formula', name);
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', 'false');
    b.dataset.formula = name;
    b.dataset.tip = 'play-formula';
    b.addEventListener('click', () => onFormula(name));
    fbtn.set(name, b);
    formulas.append(b);
  }
  const custom = el('span', 'play-custom', 'custom');
  custom.hidden = true;
  formulas.append(custom);
  group.append(formulas);

  const knobsEl = el('div', 'play-knobs');
  const knobs = new Map(); // mod → {k, ptr, val, legend}
  for (const mod of MODS) {
    const c = control(mod);
    const k = el('div', 'play-knob');
    k.tabIndex = 0;
    k.dataset.mod = mod;
    k.dataset.tip = 'play-knob';
    k.setAttribute('role', 'slider');
    k.setAttribute('aria-label', say(`${c.face}: ${c.what}`));
    k.setAttribute('aria-valuemin', '0');
    k.setAttribute('aria-valuemax', '100');
    const cap = el('span', 'play-knob-cap');
    const ptr = el('i', 'play-knob-ptr');
    cap.append(ptr);
    const val = el('span', 'play-knob-val');
    const legend = el('kbd', 'play-knob-cc', bindingLabel(c.midi[0]));
    k.append(cap, el('span', 'play-knob-name', c.face), val, legend);
    knobsEl.append(k);
    knobs.set(mod, { k, ptr, val, legend });

    // Dragged: heard as it moves, saved once when the finger lifts.
    let drag = null;
    const down = (e) => {
      e.preventDefault();
      try { k.setPointerCapture?.(e.pointerId); } catch { /* not all pointers */ }
      drag = { id: e.pointerId, y: e.clientY, v: amounts.get(mod), moved: false };
      k.focus?.({ preventScroll: true });
    };
    const move = (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      const v = knobDrag(drag.v, e.clientY - drag.y);
      if (v === amounts.get(mod)) return;
      drag.moved = true;
      amounts.move(mod, v);
    };
    const up = (e) => {
      if (!drag || drag.id !== e.pointerId) return;
      try { k.releasePointerCapture?.(e.pointerId); } catch { /* already gone */ }
      const moved = drag.moved;
      drag = null;
      if (moved) save(mod);
    };
    // Stepped with the keys: saved once they've been still a moment.
    const key = (e) => {
      const st = knobStep(e.key, e.shiftKey);
      if (!st) return;
      e.preventDefault();
      e.stopPropagation(); // the arrows are the knob's here, not the page's
      const v = st.to != null ? st.to : Math.max(0, Math.min(1, amounts.get(mod) + st.by));
      amounts.move(mod, v);
      later(mod, KEYS_QUIET_MS);
    };
    k.addEventListener('pointerdown', down);
    k.addEventListener('pointermove', move);
    k.addEventListener('pointerup', up);
    k.addEventListener('pointercancel', up);
    k.addEventListener('keydown', key);
    offs.push(() => {
      k.removeEventListener('pointerdown', down);
      k.removeEventListener('pointermove', move);
      k.removeEventListener('pointerup', up);
      k.removeEventListener('pointercancel', up);
      k.removeEventListener('keydown', key);
    });
  }
  group.append(knobsEl);
  group.append(el('p', 'play-mods-note', 'The tape’s own: saved with it, undone with ↶.'));
  slot.replaceChildren(group);
  slot.hidden = false;

  function save(mod) {
    const t = timers.get(mod);
    if (t) { clearTimer(t); timers.delete(mod); }
    saving.add(mod);
    Promise.resolve(onCommit(mod, amounts.get(mod))).finally(() => saving.delete(mod));
  }
  function later(mod, ms) {
    const t = timers.get(mod);
    if (t) clearTimer(t);
    timers.set(mod, setTimer(() => { timers.delete(mod); save(mod); }, ms));
  }

  const draw = (mod, v) => {
    const n = knobs.get(mod);
    if (!n) return;
    n.ptr.style.transform = `rotate(${knobAngle(v).toFixed(1)}deg)`;
    n.val.textContent = amountText(mod, v);
    n.k.setAttribute('aria-valuenow', String(Math.round(v * 100)));
  };
  for (const mod of MODS) draw(mod, amounts.get(mod));
  offs.push(amounts.on((id, v) => draw(id, v)));

  const paintFormula = () => {
    const f = formulaOf(style);
    for (const [name, b] of fbtn) b.setAttribute('aria-checked', String(name === f));
    custom.hidden = f !== 'custom';
  };
  paintFormula();

  return {
    group,
    /**
     * setStyle draws the tape's own mods. A knob a hand is on -- this one's,
     * mid-gesture or being saved, or another's preview -- keeps what it shows.
     */
    setStyle(next) {
      style = next || null;
      paintFormula();
      const t = now();
      for (const mod of MODS) {
        if (amounts.busy(mod) || saving.has(mod) || timers.has(mod)) continue;
        if (t - (previewed.get(mod) ?? -Infinity) < PREVIEW_MS) continue;
        amounts.note(mod, (style && style[styleField(mod)]) || 0);
      }
    },
    /** heardPreview: another hand is moving mod (an `at` with `move`). */
    heardPreview(mod) { previewed.set(mod, now()); },
    /** turn is a controller's knob here: heard at once, saved once it's still a second. */
    turn(mod, v) {
      amounts.move(mod, v);
      later(mod, TURN_QUIET_MS);
    },
    /** setLegends shows a controller's bindings under the knobs, or the defaults. */
    setLegends(bindings) {
      for (const [mod, n] of knobs) {
        const b = (bindings && bindings[mod] && bindings[mod][0]) || control(mod).midi[0];
        n.legend.textContent = bindingLabel(b);
      }
    },
    destroy() {
      for (const t of timers.values()) clearTimer(t);
      timers.clear();
      for (const off of offs) off();
      slot.replaceChildren();
      slot.hidden = true;
    },
  };
}
