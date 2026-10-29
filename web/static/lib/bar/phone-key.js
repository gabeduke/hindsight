// web/static/lib/bar/phone-key.js
// Recording from a phone, from its mini player (the studio space's
// decisions, "Recording from a phone"; docs/architecture/bar.md): a big red
// ● that records from this phone, and its input on a ▾ beside it. In the
// Studio with the tape, the mini player's ● is the tape's own (#rec, the
// Studio's page wires it: a tap records the jam room, a hold offers this
// phone's, and with the tape playing on this phone a tap records here);
// everywhere else it is this one. The ▾ is the same for both.
//
// Both keys are the page's markup, in the transport, shown in the mini
// player alone (data-mini). The recording is the page's one recorder
// (lib/phone/recorder.js phoneRecorder): the sheet, the rooms' ● Phone and
// these all show the same one.

import { menu, menuItem, menuRows } from '../ui/menu.js';
import { fmtClock, onPhoneRecorder } from '../phone/recorder.js';

const setAttr = (el, k, v) => { if (el && el.getAttribute(k) !== v) el.setAttribute(k, v); };

/**
 * phoneRows are the ▾'s rows: what a tap on ● does now, then the inputs,
 * the one kept ticked (the first, the default, when none is), then the
 * sheet with its meter. Each { id, word, sub, checked? }. Pure, for the tests.
 */
export function phoneRows({ state = { mode: 'closed', seconds: 0 }, inputs = [], input = '' }) {
  const busy = state.mode === 'recording' || state.mode === 'saving';
  const now = state.mode === 'recording'
    ? { id: 'stop', word: 'Stop recording', sub: `from this phone · ${fmtClock(state.seconds)}` }
    : state.mode === 'saving'
      ? { id: 'sheet', word: 'Saving the phone’s take…', sub: 'it goes on the shelf' }
      : { id: 'record', word: 'Record from this phone', sub: 'its take goes on the shelf' };
  const kept = inputs.some((i) => i.id === input) ? input : inputs[0]?.id;
  const ins = inputs.map((i) => ({ id: `input:${i.id}`, word: i.label, checked: i.id === kept, disabled: busy }));
  return {
    now,
    inputs: ins.length ? ins : [{ id: 'input:', word: 'This phone’s microphone', checked: true, disabled: busy }],
    sheet: { id: 'sheet', word: 'The level and input…', sub: 'its meter, before you record' },
  };
}

/** said is what ● says to a screen reader and a pointer, for the recorder's `state`. */
export function said(state) {
  if (state.mode === 'recording') return `Stop recording from this phone, ${fmtClock(state.seconds)}`;
  if (state.mode === 'saving') return 'Saving the phone’s take';
  return 'Record from this phone';
}

/**
 * phoneKey wires the mini player's ● (#np-phone-rec) and its ▾
 * (#np-phone-more, opening #np-phone-menu). `recorder()` is the page's
 * recorder, asked for when a key is pressed (the rooms make it as they
 * mount); `whenRecorder(fn)` hands it over as soon as there is one, so the
 * keys show a recording started anywhere. `playerUp()` is whether the
 * phone's player is pulled up (its sheet's isOpen), where the ▾ isn't. The
 * Studio's ● asks for the ▾ on a hold (`hindsight:phone-offer`).
 * Answers { menu, paint(state) }, or null on a page without the keys.
 */
export function phoneKey({ doc = document, recorder, layers, floor, whenRecorder = (fn) => onPhoneRecorder(doc, fn), playerUp = () => false }) {
  const rec = doc.getElementById('np-phone-rec');
  const more = doc.getElementById('np-phone-more');
  const panel = doc.getElementById('np-phone-menu');
  if (!rec || !more || !panel) return null;
  let inputs = [];
  let listening = null;

  const paint = (state) => {
    const busy = state.mode === 'recording' || state.mode === 'saving';
    for (const k of [rec, more]) k.classList.toggle('recording', busy);
    setAttr(rec, 'aria-pressed', String(state.mode === 'recording'));
    setAttr(rec, 'aria-label', said(state));
    setAttr(rec, 'title', said(state));
  };
  // The recorder is made by a room: heard from when it is there.
  const listen = (r) => {
    if (!r || listening === r) return r;
    listening = r;
    r.onChange((s) => { paint(s); if (m.isOpen()) m.refresh(); });
    paint(r.state());
    return r;
  };
  const hear = () => listen(recorder());

  const render = (p) => {
    const r = hear();
    const rows = phoneRows({ state: r ? r.state() : undefined, inputs, input: r ? r.input() : '' });
    const item = (row, role = 'menuitem') => {
      const el = menuItem(doc, { word: row.word, sub: row.sub, role, checked: row.checked, attrs: { 'data-phone': row.id } });
      if (row.disabled) el.setAttribute('aria-disabled', 'true');
      else el.addEventListener('click', () => pick(row.id));
      return el;
    };
    p.replaceChildren(...menuRows(doc, [
      [item(rows.now)],
      { label: 'Input', rows: rows.inputs.map((r) => item(r, 'menuitemradio')) },
      [item(rows.sheet)],
    ]));
  };
  // Over the mini player, clear of its top edge (the ▾ is 7 px in from it).
  const m = menu(more, panel, { layers, doc, side: 'above', gap: 10, floor, render, focus: 'first' });

  function pick(id) {
    const r = hear();
    if (!r) return;
    if (id === 'record' || id === 'stop') r.quick();
    else if (id === 'sheet') r.open();
    else if (id.startsWith('input:')) r.setInput(id.slice(6));
  }

  rec.addEventListener('click', () => { hear()?.quick(); });
  // Its inputs are asked for as it opens; it shows the last answer until
  // the new one comes.
  more.addEventListener('click', () => {
    if (!m.isOpen()) return;
    hear()?.inputs().then((list) => { inputs = list; if (m.isOpen()) m.refresh(); }, () => {});
  });
  doc.addEventListener('hindsight:phone-offer', () => {
    if (m.isOpen()) return;
    // The ▾ is the mini player's; with the player up, the sheet offers it.
    if (playerUp()) { hear()?.open(); return; }
    m.open();
    hear()?.inputs().then((list) => { inputs = list; if (m.isOpen()) m.refresh(); }, () => {});
  });
  whenRecorder(listen);
  return { menu: m, paint };
}
