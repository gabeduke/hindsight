// web/static/lib/play/fxwire.js
// The punch-in FX, the bend and the tape mods, wired between what's drawn
// (fx.js, mods.js) and the Pi (link.js): what goes down the socket, and
// when. Out of strip.js so the order of what's sent is tested against a
// fake socket (fxwire.test.js), not only looked at in a browser.

import { mountFX } from './fx.js';
import { mountMods } from './mods.js';
import { styleField, FX_PADS } from './controls.js';

const FX = new Set(FX_PADS);

/** BEND_DEAD is how near the centre the bend counts as let go. */
export const BEND_DEAD = 0.02;

/**
 * linkOptions are what link.js needs of the amounts (strip.js passes them
 * to connect): an FX pressed carries its amount, and a pad's or the bend's
 * or a mod's release goes after its last move, never before it.
 */
export function linkOptions(amounts) {
  return {
    amountOf: (pad) => (FX.has(pad) ? amounts.get(pad) : undefined),
    flush: (pad) => amounts.flush(pad),
  };
}

/**
 * wireFX mounts the FX and the mods into the strip's slots (`ui`) and wires
 * them to `link`, their amounts kept in `amounts`. `far` is what other
 * hands hold (far.js), so the bend stays lit while one does; `tapeId()` is
 * the loaded tape, whose mods a knob saves to; `onNote(text)` tells the
 * player what went wrong. Returns null-safe handles and the bend.
 */
export function wireFX({
  ui, surface, link, amounts, far, doc = globalThis.document,
  fetchImpl = (...a) => globalThis.fetch(...a), tapeId = () => null, onNote = () => {},
  modsOptions = {},
}) {
  let bending = false;
  const fx = mountFX(ui, surface, amounts, { doc, onBend: bendTo, onBendEnd: () => bendTo(0) });

  // The bend from this page: held while it's off its centre, let go as it
  // springs back, landing at once (the Pi takes it now, whatever ⌗ says).
  function bendTo(v) {
    if (Math.abs(v) <= BEND_DEAD) {
      if (!bending) return;
      bending = false;
      link.release('bend');
      amounts.note('bend', 0);
      fx?.setBend(far.has('bend'));
      return;
    }
    if (!bending) {
      bending = true;
      amounts.note('bend', v);
      link.press('bend', v);
      fx?.setBend(true);
      return;
    }
    amounts.move('bend', v);
  }

  const mods = mountMods(ui.slot('mods'), amounts, {
    doc,
    // One step of undo when a gesture ends; then the preview goes, and the
    // tape's own value -- the one just saved -- is what's heard.
    // The knob's last move goes first, if it's waiting its turn, then the
    // save; the release (link.js flushes again) is the last word.
    onCommit: (mod, v) => {
      amounts.flush(mod);
      return patchStyle({ [styleField(mod)]: v }).finally(() => link.release(mod));
    },
    onFormula: (name) => patchStyle({ formula: name }),
    ...modsOptions,
  });

  async function patchStyle(change) {
    const id = tapeId();
    if (!id) return;
    try {
      const res = await fetchImpl(`/api/tapes?id=${encodeURIComponent(id)}`, {
        method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ style: change }),
      });
      const b = await res.json().catch(() => ({}));
      if (!res.ok) { onNote(`Tape mods: ${b.error || res.status}`); return; }
      if (b.tape) mods?.setStyle(b.tape.style);
    } catch { /* the Pi out of reach: the link says so */ }
  }

  return {
    fx,
    mods,
    bendTo,
    patchStyle,
    /** bending says this page holds the bend. */
    get bending() { return bending; },
    /** farChanged: another hand's pad lit or went dark; the bend stays lit while anyone bends. */
    farChanged(pad, on) { if (pad === 'bend') fx?.setBend(on || bending); },
    /** setMixdown is the mixdown's state: the FX wait while the Pi refuses them. */
    setMixdown(state) { fx?.setMixdown(state === 'playing' || state === 'tail'); },
    destroy() {
      bendTo(0);
      fx?.destroy();
      mods?.destroy();
    },
  };
}
