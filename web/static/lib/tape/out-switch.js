// web/static/lib/tape/out-switch.js
// Where the tape plays, from any page that can play it: the Output sheet's
// three choices, opened from OUT on the bar's display (it was a button in
// the header once), and the switch a choice makes. The tape page adds its
// strip and banner (output-ui.js); the rooms use this as it is (engine.js).

import { rememberListener } from './listener.js';
import { say } from '../rooms/words.js';

export const OUT_NAMES = { jam: 'Jam room', phone: 'Phone', both: 'Both' };

/** outName is what the Output sheet calls `mode`. */
export const outName = (mode) => OUT_NAMES[mode] || OUT_NAMES.jam;

const SHEET = `
  <div class="sheet-inner out-inner">
    <h3 id="out-title">Output</h3>
    <p class="sheet-hint">Where <span id="out-tape-name">this tape</span> plays. Switching keeps the tape rolling from the same spot.</p>
    <div class="out-choices" role="group" aria-label="Output">
      <button type="button" class="icon-btn out-choice" data-mode="jam" aria-pressed="true" data-tip="out-choice"><b>Jam room</b><span>${say('Through the Sidekick downstairs. Rec, Catch and mixdown work.')}</span><span class="out-led"></span></button>
      <button type="button" class="icon-btn out-choice" data-mode="phone" aria-pressed="false" data-tip="out-choice"><b>This phone</b><span>A backing track here, about 0.8 s behind. The jam room stays silent.</span><span class="out-led"></span></button>
      <button type="button" class="icon-btn out-choice" data-mode="both" aria-pressed="false" data-tip="out-choice"><b>Both</b><span>The jam room plays and records as usual; this phone hears it 0.8 s late.</span><span class="out-led"></span></button>
    </div>
    <p id="out-measured" class="out-measured" hidden><span id="out-delay" class="lcd mono">0.8 s</span> late, measured. The playhead and meters here move back by this much, so what you see is what you hear.</p>
    <p class="sheet-hint">One phone at a time: choosing This phone on another device moves the tape there.</p>
    <div class="sheet-actions"><button class="icon-btn" id="out-close" type="button">Done</button></div>
  </div>`;

/** outSheet is the page's Output sheet, made the first time it's asked for. */
export function outSheet(doc = document) {
  let d = doc.getElementById('out-sheet');
  if (d) return d;
  d = doc.createElement('dialog');
  d.className = 'sheet';
  d.id = 'out-sheet';
  d.setAttribute('aria-labelledby', 'out-title');
  d.innerHTML = SHEET;
  doc.body.append(d);
  return d;
}

/**
 * wireOutput hooks the keys that say where the tape plays (`keys`: OUT on
 * the bar's display) to the Output sheet: a key opens it, a choice calls
 * choose(mode). name() is the loaded tape's name, for the sheet's first
 * line; onOpen() runs as it opens. Answers the sheet.
 */
export function wireOutput({ choose, name, onOpen = () => {}, keys = [] }) {
  const sheet = outSheet();
  const open = () => {
    document.getElementById('out-tape-name').textContent = name() || 'this tape';
    onOpen();
    sheet.showModal();
  };
  for (const b of keys.filter(Boolean)) b.addEventListener('click', open);
  document.getElementById('out-close').addEventListener('click', () => sheet.close());
  for (const b of sheet.querySelectorAll('.out-choice')) b.addEventListener('click', () => choose(b.dataset.mode));
  return sheet;
}

/** paintOutSheet marks the choice in force, and how late a phone hears it. */
export function paintOutSheet(mode, delay) {
  const sheet = document.getElementById('out-sheet');
  if (!sheet) return;
  for (const b of sheet.querySelectorAll('.out-choice')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  document.getElementById('out-measured').hidden = mode === 'jam';
  document.getElementById('out-delay').textContent = delay;
}

/** outDelay is a phone's delay in words: 0.8 s. */
export const outDelay = (ms) => `${((ms || 800) / 1000).toFixed(1)} s`;

async function putMode(mode) {
  const res = await fetch('/api/tapes/output', {
    method: 'PUT', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }),
  });
  const b = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(b.error || `HTTP ${res.status}`);
}

/**
 * switchOutput moves the tape to `mode`, playing it on `player` (a
 * StreamPlayer) for phone and both. The sound starts inside the tap that
 * chose it, before any await: a phone's browser only lets a tap start it.
 * A phone that never starts doesn't leave the jam room silent. Answers
 * whether it switched.
 */
export async function switchOutput(mode, { player, poll = () => {}, toast }) {
  // Already listening, with the sound held back: this tap wakes it.
  if (mode !== 'jam' && player.active) player.resume();
  const starting = mode !== 'jam' && !player.active ? player.start() : null;
  // If the PUT fails first, a later start failure must not go unhandled.
  if (starting) starting.catch(() => {});
  let put = false;
  try {
    await putMode(mode);
    put = true;
    await starting;
    if (mode === 'jam') player.stop();
    // The next page joins the stream again (listener.js).
    rememberListener(mode !== 'jam' && player.active);
    setTimeout(poll, 100);
    return true;
  } catch (e) {
    if (starting) player.stop();
    if (put && mode !== 'jam') {
      try { await putMode('jam'); } catch { /* best effort */ }
      poll();
    }
    toast(e.message, 'bad');
    return false;
  }
}
