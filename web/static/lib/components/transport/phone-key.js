// web/static/lib/components/transport/phone-key.js
// Recording from a phone, from its mini player (the studio space's
// decisions, "Recording from a phone"; docs/architecture/bar.md): a big red
// ● that records from this phone, and its input on a ▾ beside it. In the
// Studio with the tape, the mini player's ● is the tape's own (#np-rec,
// tape-keys.js: a tap records the jam room, a hold offers this phone's
// (offer), and with the tape playing on this phone a tap records here),
// and its ▾ is ●'s own (#np-rec-more), whose menu holds Catch's rows and
// then these (rows, opened): one ▾ beside ●, never two. Everywhere else ●
// and the ▾ are these.
//
// Both keys are the page's markup, in the transport, shown in the mini
// player alone (data-mini). The recording is the page's one recorder
// (lib/phone/recorder.js phoneRecorder): the sheet, the rooms' ● Phone and
// these all show the same one.

import { menu, menuItem, menuRows } from '../../ui/menu.js';
import { fmtClock } from '../../phone/recorder.js';
import { partOf } from '../../bar/slots.js';

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
 * (#np-phone-more, opening #np-phone-menu), inside the bar's `root`.
 * `recorder()` is the page's recorder, asked for when a key is pressed (the
 * shell makes it at boot); `whenRecorder(fn)` hands it over (the bar
 * passes the boot's, once; by default, `recorder()`'s, if there is one
 * now), so the keys show a recording started anywhere. `layers` and `floor` are the stack the ▾ opens on
 * and where it stops above the bar (a component's cx.layers and cx.floor).
 * `playerUp()` is whether the phone's player is pulled up (its sheet's
 * isOpen). Answers, or null on a bar without the keys:
 *
 *   menu            the ▾'s menu (lib/ui/menu.js menu)
 *   paint(state)    ● and the ▾ drawn for the recorder's state
 *   rows(panel)     appends this ▾'s rows to `panel`, another menu's (●'s
 *                   ▾ in the Studio, tape-keys.js), each doing what it does
 *                   here: what ● does now, the inputs, the level and input
 *   opened(host)    `host` (menu()'s answer) has opened holding them, as it
 *                   says each time it opens (its onOpen, however it was
 *                   opened): the inputs are asked for, and it is filled
 *                   again as they come and as the recorder changes while it
 *                   is open
 *   offer(host)     a hold on the Studio's ● (tape-keys.js): `host` opened,
 *                   or with the player up, where the mini player's ▾
 *                   isn't, the recorder's sheet
 */
export function phoneKey({ root, recorder, layers, floor, whenRecorder = (fn) => { const r = recorder(); if (r) fn(r); }, playerUp = () => false }) {
  const part = partOf(root);
  const rec = part('phone-rec');
  const more = part('phone-more');
  const panel = part('phone-menu');
  if (!rec || !more || !panel) return null;
  let inputs = [];
  let listening = null;
  // The other menu holding these rows (●'s, in the Studio), as it opened
  // last: filled again with this one.
  let host = null;
  const refresh = () => { for (const x of [m, host]) if (x?.isOpen()) x.refresh(); };

  const paint = (state) => {
    const busy = state.mode === 'recording' || state.mode === 'saving';
    for (const k of [rec, more]) k.classList.toggle('recording', busy);
    setAttr(rec, 'aria-pressed', String(state.mode === 'recording'));
    setAttr(rec, 'aria-label', said(state));
    setAttr(rec, 'title', said(state));
  };
  // The recorder may come later than the keys: heard from when it is there.
  const listen = (r) => {
    if (!r || listening === r) return r;
    listening = r;
    r.onChange((s) => { paint(s); refresh(); });
    paint(r.state());
    return r;
  };
  const hear = () => listen(recorder());
  // Its inputs are asked for as a menu with its rows opens; it shows the
  // last answer until the new one comes.
  const ask = () => { hear()?.inputs().then((list) => { inputs = list; refresh(); }, () => {}); };

  // The rows, made in the panel they go in (this ▾'s, or the host's), each
  // doing what it does here.
  const rowsIn = (p) => {
    const r = hear();
    const rows = phoneRows({ state: r ? r.state() : undefined, inputs, input: r ? r.input() : '' });
    const item = (row, role = 'menuitem') => {
      const el = menuItem(p, { word: row.word, sub: row.sub, role, checked: row.checked, attrs: { 'data-phone': row.id } });
      if (row.disabled) el.setAttribute('aria-disabled', 'true');
      else el.addEventListener('click', () => pick(row.id));
      return el;
    };
    return menuRows(p, [
      [item(rows.now)],
      { label: 'Input', rows: rows.inputs.map((r) => item(r, 'menuitemradio')) },
      [item(rows.sheet)],
    ]);
  };
  const render = (p) => p.replaceChildren(...rowsIn(p));
  // Over the mini player, clear of its top edge (the ▾ is 7 px in from it).
  const m = menu(more, panel, { layers, side: 'above', gap: 10, floor, render, focus: 'first', popover: true });

  function pick(id) {
    const r = hear();
    if (!r) return;
    if (id === 'record' || id === 'stop') r.quick();
    else if (id === 'sheet') r.open();
    else if (id.startsWith('input:')) r.setInput(id.slice(6));
  }

  rec.addEventListener('click', () => { hear()?.quick(); });
  more.addEventListener('click', () => { if (m.isOpen()) ask(); });
  const opened = (h) => { host = h; ask(); };
  const offer = (h) => {
    if (h.isOpen()) return;
    // The ▾ is the mini player's; with the player up, the sheet offers it.
    if (playerUp()) { hear()?.open(); return; }
    h.open();
  };
  whenRecorder(listen);
  return { menu: m, paint, rows: (p) => { p.append(...rowsIn(p)); }, opened, offer };
}
